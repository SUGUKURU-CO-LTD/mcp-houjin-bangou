/**
 * T2: search_corporate_by_name
 * 法人名（商号）から法人番号や所在地を検索 (ページネーション対応)
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1.2, §3.1, §4, §6.1, §6.2, §11
 *   国税庁仕様書 第六編 §4, 第二編 §4
 *   国税庁仕様書 第二編 別紙1 項番15 (法人種別), 項番26 (登記記録の閉鎖等の事由)
 *   国税庁 法人番号システムWeb-API機能利用規約 第6条 [出典-A1]
 */

import { z } from 'zod';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NtaClient } from '../api/nta-client.js';
import type { McpLogger } from '../lib/mcp-logger.js';
import { RateLimitError } from '../lib/errors.js';
import { extractTraceFromMcpExtra } from '../lib/trace-context.js';
import { kindLabel } from '../domain/kind-codes.js';
import { getToolAnnotations, type DataSourceMode } from '../domain/tool-annotations.js';
import type { DbCorporateDataProvider } from '../repository/corporate-repository.js';
import {
  encodeNameSearchCursor,
  decodeNameSearchCursor,
  validateNameSearchCursor,
} from '../lib/pagination.js';
import {
  createSuccessResponse,
  createErrorResponse,
  NTA_CORPORATE_WEB_API_ATTRIBUTION,
  formatAttributionLine,
} from '../lib/tool-response.js';
import { Result } from '../lib/result.js';

const MAX_CURSOR_OFFSET = 10_000;

const InputSchema = z
  .object({
    name: z
      .string()
      .min(1, '検索する法人名を指定してください')
      .max(100, '法人名は100文字以内で指定してください')
      .describe("Corporate name to search (kanji, kana, or romaji, e.g., 'スグクル')"),
    prefecture: z
      .string()
      .regex(/^(0[1-9]|[1-3][0-9]|4[0-7])$/, '都道府県コードは01〜47の2桁で指定してください')
      .optional()
      .describe('Optional 2-digit prefecture code (01-47)'),
    cursor: z
      .string()
      .optional()
      .describe('Opaque cursor for pagination returned from previous search'),
    limit: z
      .number()
      .int()
      .min(1, '1件以上を指定してください')
      .max(20, '最大20件まで指定できます')
      .default(10)
      .describe('Number of results to return (default: 10, max: 20)'),
  })
  .strict();

export const SearchResultItemSchema = z
  .object({
    corporate_number: z.string().describe('13-digit Japanese national corporate number'),
    name: z.string().describe('Official published corporate name'),
    legal_type: z.string().describe('Corporate kind label in Japanese'),
    location: z.string().describe('Published head office location'),
    update_date: z.string().describe('Last record update date (YYYY-MM-DD)'),
    status: z.enum(['active', 'closed']).describe("Registration status ('active' or 'closed')"),
    address_may_be_outdated: z
      .boolean()
      .optional()
      .describe(
        'True if registered address may differ from current address due to residential address implementation (from NTA hihyoji flag)',
      ),
  })
  .strict();

const OutputSchema = z
  .object({
    results: z.array(SearchResultItemSchema).describe('Page of matching corporate records'),
    total_count: z
      .number()
      .int()
      .nullable()
      .describe('Total number of matched corporations if known'),
    next_cursor: z
      .string()
      .nullable()
      .describe('Cursor token for fetching the next page; null if no more items'),
    data_as_of: z
      .string()
      .describe(
        'Date of the public dataset (YYYY-MM-DD; updated monthly with end-of-previous-month snapshot / 月1回、前月末時点の全件データで更新)',
      ),
    attribution: z.string().describe('Attribution text required by NTA terms of service'),
  })
  .strict();

export type SearchByNameInput = z.infer<typeof InputSchema>;
export type SearchByNameOutput = z.infer<typeof OutputSchema>;

const DESCRIPTION_JA =
  '法人名（商号）から法人番号や所在地を検索します。検索結果は既定10件（最大20件）ずつ返却され、続きがある場合はカーソルを使用してページネーション取得できます。一致方式は、ホスト版では1〜2文字の検索語は前方一致、3文字以上は部分一致で検索します（ローカル版は国税庁Web-APIの前方一致検索）。';

export interface SearchByNameDeps {
  ntaClient?: NtaClient;
  dbProvider?: DbCorporateDataProvider;
  dataSource?: DataSourceMode;
  logger: McpLogger;
}

export function registerSearchByNameTool(server: McpServer, deps: SearchByNameDeps): void {
  const isDb =
    deps.dataSource === 'db' || (deps.dbProvider !== undefined && deps.ntaClient === undefined);
  const annotations = getToolAnnotations('search_corporate_by_name', isDb ? 'db' : 'web-api');

  registerAppTool(
    server,
    'search_corporate_by_name',
    {
      title: annotations.title,
      description: DESCRIPTION_JA,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      _meta: {
        ui: {
          resourceUri: 'ui://search-results/mcp-app.html',
          visibility: ['model', 'app'],
        },
      },
      annotations: {
        title: annotations.title,
        readOnlyHint: annotations.readOnlyHint,
        destructiveHint: annotations.destructiveHint,
        idempotentHint: annotations.idempotentHint,
        openWorldHint: annotations.openWorldHint,
      },
    },
    async (args, extra) => {
      const startTime = performance.now();
      const trace = extractTraceFromMcpExtra(extra);
      const { name, prefecture, cursor, limit } = args;
      const trimmed = name.trim();
      const queryKey = `${trimmed}|${prefecture ?? ''}`;

      // カーソルが指定されている場合、構文・上限・クエリ一致の事前検証
      let requestedOffset = 0;
      let requestedDivide = 1;
      if (cursor !== undefined && cursor !== '') {
        const decoded = decodeNameSearchCursor(cursor);
        if (
          decoded === null ||
          !Number.isSafeInteger(decoded.offset) ||
          decoded.offset < 0 ||
          decoded.offset > MAX_CURSOR_OFFSET ||
          (decoded.divide !== undefined &&
            (!Number.isSafeInteger(decoded.divide) || decoded.divide < 1 || decoded.divide > 99999))
        ) {
          deps.logger.warn('tool_access', {
            tool: 'search_corporate_by_name',
            count: 0,
            duration_ms: Math.round(performance.now() - startTime),
            error_type: 'invalid_cursor',
            trace_id: trace.traceContext.traceId,
          });
          return createErrorResponse('INVALID_INPUT', 'カーソルの形式が無効です。');
        }
        if (decoded.queryKey !== undefined && decoded.queryKey !== queryKey) {
          deps.logger.warn('tool_access', {
            tool: 'search_corporate_by_name',
            count: 0,
            duration_ms: Math.round(performance.now() - startTime),
            error_type: 'cursor_query_mismatch',
            trace_id: trace.traceContext.traceId,
          });
          return createErrorResponse(
            'INVALID_INPUT',
            '検索条件が変更されたため、カーソルが無効になりました。最初から再検索してください。',
          );
        }
        requestedOffset = decoded.offset;
        requestedDivide = decoded.divide ?? 1;
      }

      // ホスト版 (自社 PostgreSQL DB 参照) モード
      if (isDb) {
        if (!deps.dbProvider) {
          deps.logger.error('tool_access', {
            tool: 'search_corporate_by_name',
            duration_ms: Math.round(performance.now() - startTime),
            error_type: 'INTERNAL_ERROR',
            trace_id: trace.traceContext.traceId,
          });
          return createErrorResponse('INTERNAL_ERROR', 'Database provider is not initialized');
        }

        const dbResult = await deps.dbProvider.searchByName(name, prefecture, cursor, limit);
        if (!dbResult.ok) {
          const err = dbResult.error;
          deps.logger.error('tool_access', {
            tool: 'search_corporate_by_name',
            duration_ms: Math.round(performance.now() - startTime),
            error_type: err.code,
            trace_id: trace.traceContext.traceId,
          });
          return createErrorResponse(
            err.code === 'INVALID_INPUT' ? 'INVALID_INPUT' : 'DATA_UNAVAILABLE',
            err.message,
          );
        }

        const val = dbResult.value;
        deps.logger.info('tool_access', {
          tool: 'search_corporate_by_name',
          count: val.results.length,
          duration_ms: Math.round(performance.now() - startTime),
          trace_id: trace.traceContext.traceId,
        });

        let boundNextCursor: string | null = val.next_cursor;
        if (val.next_cursor !== null) {
          const decodedNext = decodeNameSearchCursor(val.next_cursor);
          if (decodedNext !== null && decodedNext.queryKey === undefined) {
            boundNextCursor = encodeNameSearchCursor({
              ...decodedNext,
              queryKey,
            });
          }
        }

        const output: SearchByNameOutput = {
          results: val.results.map((r) => ({
            corporate_number: r.corporate_number,
            name: r.name,
            legal_type: r.legal_type,
            location: r.location,
            update_date: r.update_date,
            status: r.status,
            address_may_be_outdated: r.address_may_be_outdated,
          })),
          total_count: val.total_count ?? null,
          next_cursor: boundNextCursor,
          data_as_of: val.data_as_of,
          attribution: val.attribution,
        };

        const countText =
          val.total_count !== null && val.total_count !== undefined
            ? `（全 ${val.total_count} 件中 ${val.results.length} 件を表示）`
            : `（${val.results.length} 件を表示）`;

        const firstLine =
          val.results.length === 0
            ? `「${name}」に一致する法人は見つかりませんでした。`
            : `「${name}」の検索結果です${countText}。`;

        const hasOutdated = val.results.some((r) => r.address_may_be_outdated);
        const summary = [
          firstLine,
          ...(hasOutdated
            ? [
                '※登記上の所在地の表記が、住居表示の実施等により現在の住所と異なる可能性があります。',
              ]
            : []),
          ...(boundNextCursor
            ? [
                '※続きの検索結果を取得するには、返却された next_cursor を指定して再実行してください。',
              ]
            : []),
          `データ時点: ${val.data_as_of}`,
          formatAttributionLine(val.attribution),
        ].join('\n');

        return createSuccessResponse(summary, output);
      }

      // ローカル版 (国税庁 Web-API 直接呼出) モード
      if (!deps.ntaClient) {
        return createErrorResponse('INTERNAL_ERROR', 'NTA client is not initialized');
      }

      let apiResult: Awaited<ReturnType<NtaClient['searchByName']>>;
      try {
        apiResult = await deps.ntaClient.searchByName({
          name,
          mode: '1', // 前方一致
          target: '1', // JIS1-2水準あいまい検索
          ...(prefecture !== undefined && { address: prefecture }),
          change: '0',
          close: '1', // 閉鎖法人も含めて検索
          divide: requestedDivide,
        });
      } catch (err) {
        if (err instanceof RateLimitError) {
          deps.logger.warn('tool_access', {
            tool: 'search_corporate_by_name',
            count: 0,
            duration_ms: Math.round(performance.now() - startTime),
            error_type: 'rate_limited',
            trace_id: trace.traceContext.traceId,
          });
          return createErrorResponse(
            'RATE_LIMITED',
            '利用上限（レート制限）に達しました。しばらく待ってから再試行してください。',
          );
        }
        throw err;
      }

      if (Result.isErr(apiResult)) {
        const err = apiResult.error;
        deps.logger.error('tool_access', {
          tool: 'search_corporate_by_name',
          duration_ms: Math.round(performance.now() - startTime),
          error_type: err.code,
          trace_id: trace.traceContext.traceId,
        });

        if (
          (err as unknown) instanceof RateLimitError ||
          err.code === 'http_403' ||
          err.httpStatus === 429
        ) {
          return createErrorResponse(
            'RATE_LIMITED',
            '利用上限（レート制限）に達しました。しばらく待ってから再試行してください。',
          );
        }
        if (err.httpStatus === 400) {
          return createErrorResponse(
            'INVALID_INPUT',
            '検索条件に該当する法人が多すぎるか、指定条件が無効です。都道府県などで絞り込んでください。',
          );
        }
        return createErrorResponse(
          'DATA_UNAVAILABLE',
          '国税庁公表データの検索に失敗しました。時間をおいて再試行してください。',
        );
      }

      const parsed = apiResult.value;
      const dataAsOf = parsed.header.lastUpdateDate;

      // カーソルの data_as_of 検証 (データ更新後の古いカーソルは INVALID_INPUT で返す)
      if (cursor !== undefined && cursor !== '') {
        const validation = validateNameSearchCursor(cursor, dataAsOf);
        if (!validation.valid) {
          deps.logger.warn('tool_access', {
            tool: 'search_corporate_by_name',
            count: 0,
            duration_ms: Math.round(performance.now() - startTime),
            error_type: 'stale_cursor',
            trace_id: trace.traceContext.traceId,
          });
          return createErrorResponse('INVALID_INPUT', validation.message);
        }
        if (validation.payload.queryKey !== undefined && validation.payload.queryKey !== queryKey) {
          deps.logger.warn('tool_access', {
            tool: 'search_corporate_by_name',
            count: 0,
            duration_ms: Math.round(performance.now() - startTime),
            error_type: 'cursor_query_mismatch',
            trace_id: trace.traceContext.traceId,
          });
          return createErrorResponse(
            'INVALID_INPUT',
            '検索条件が変更されたため、カーソルが無効になりました。最初から再検索してください。',
          );
        }
      }

      // process === '99' (削除) レコードを除外
      const corporations = parsed.corporations.filter((c) => c.process !== '99');
      const excludedCount = parsed.corporations.length - corporations.length;
      const totalCount =
        excludedCount > 0 && parsed.header.divideSize <= 1
          ? Math.max(0, parsed.header.count - excludedCount)
          : parsed.header.count;

      // 該当ページ内でのスライス取得
      const pageSlice = corporations.slice(requestedOffset, requestedOffset + limit);

      let nextCursor: string | null = null;
      if (requestedOffset + limit < corporations.length) {
        // 同じ Web-API 応答内に次がある場合
        nextCursor = encodeNameSearchCursor({
          offset: requestedOffset + limit,
          data_as_of: dataAsOf,
          queryKey,
          divide: requestedDivide,
        });
      } else if (parsed.header.divideNumber < parsed.header.divideSize) {
        // 次の Web-API 分割 (divide) がある場合
        nextCursor = encodeNameSearchCursor({
          offset: 0,
          data_as_of: dataAsOf,
          queryKey,
          divide: parsed.header.divideNumber + 1,
        });
      }

      const results: SearchByNameOutput['results'] = pageSlice.map((raw) => {
        const isClosed =
          (raw.close_date && raw.close_date.trim() !== '') ||
          (raw.close_cause && raw.close_cause.trim() !== '');

        const location =
          raw.address_outside && raw.address_outside.trim() !== ''
            ? raw.address_outside.trim()
            : `${raw.prefecture_name ?? ''}${raw.city_name ?? ''}${raw.street_number ?? ''}`;

        return {
          corporate_number: raw.corporate_number,
          name: raw.name,
          legal_type: kindLabel(raw.kind, 'ja'),
          location,
          update_date: raw.update_date,
          status: isClosed ? 'closed' : 'active',
          address_may_be_outdated: raw.hihyoji === '1',
        };
      });

      deps.logger.info('tool_access', {
        tool: 'search_corporate_by_name',
        count: results.length,
        duration_ms: Math.round(performance.now() - startTime),
        trace_id: trace.traceContext.traceId,
      });

      const structuredContent: SearchByNameOutput = {
        results,
        total_count: totalCount,
        next_cursor: nextCursor,
        data_as_of: dataAsOf,
        attribution: NTA_CORPORATE_WEB_API_ATTRIBUTION,
      };

      const hasOutdated = results.some((r) => r.address_may_be_outdated);
      const summary = [
        `「${name}」の検索結果です（全 ${totalCount} 件中 ${results.length} 件を表示）。`,
        ...(hasOutdated
          ? ['※登記上の所在地の表記が、住居表示の実施等により現在の住所と異なる可能性があります。']
          : []),
        ...(nextCursor
          ? ['※続きの検索結果を取得するには、返却された next_cursor を指定して再実行してください。']
          : []),
        `データ時点: ${dataAsOf}`,
        formatAttributionLine(NTA_CORPORATE_WEB_API_ATTRIBUTION),
      ].join('\n');

      return createSuccessResponse(summary, structuredContent);
    },
  );
}
