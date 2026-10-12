/**
 * T2: search_corporate_by_name
 * 法人名（商号）から法人番号や所在地を検索 (ページネーション対応)
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1.2, §3.1, §4, §6.1, §6.2, §11 (v1.4 凍結仕様)
 *   国税庁仕様書 第六編 §4, 第二編 §4
 *   国税庁仕様書 第二編 別紙1 項番15 (法人種別), 項番26 (登記記録の閉鎖等の事由)
 *   国税庁 法人番号システムWeb-API機能利用規約 第6条 [出典-A1]
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NtaClient } from '../api/nta-client.js';
import type { McpLogger } from '../lib/mcp-logger.js';
import { kindLabel } from '../domain/kind-codes.js';
import { getToolAnnotations } from '../domain/tool-annotations.js';
import {
  encodeNameSearchCursor,
  decodeNameSearchCursor,
  validateNameSearchCursor,
} from '../lib/pagination.js';
import {
  createSuccessResponse,
  createErrorResponse,
  NTA_CORPORATE_WEB_API_ATTRIBUTION,
} from '../lib/tool-response.js';
import { Result } from '../lib/result.js';

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

export const SearchResultItemSchema = z.object({
  corporate_number: z.string(),
  name: z.string(),
  legal_type: z.string(),
  location: z.string(),
  update_date: z.string(),
  status: z.enum(['active', 'closed']),
});

const OutputSchema = z.object({
  results: z.array(SearchResultItemSchema),
  total_count: z
    .number()
    .int()
    .nullable()
    .describe('Total number of matched corporations if known'),
  next_cursor: z
    .string()
    .nullable()
    .describe('Cursor token for fetching the next page; null if no more items'),
  data_as_of: z.string().describe('Date of the public dataset (YYYY-MM-DD)'),
  attribution: z.string().describe('Attribution text required by NTA terms of service'),
});

export type SearchByNameInput = z.infer<typeof InputSchema>;
export type SearchByNameOutput = z.infer<typeof OutputSchema>;

const DESCRIPTION_JA =
  '法人名（商号）から法人番号や所在地を検索します。検索結果は既定10件ずつ返却され、続きがある場合はカーソルを使用してページネーション取得できます。';

export function registerSearchByNameTool(
  server: McpServer,
  deps: { ntaClient: NtaClient; logger: McpLogger },
): void {
  const annotations = getToolAnnotations('search_corporate_by_name', 'web-api');

  server.registerTool(
    'search_corporate_by_name',
    {
      title: annotations.title,
      description: DESCRIPTION_JA,
      inputSchema: InputSchema.shape,
      outputSchema: OutputSchema.shape,
      _meta: {
        ui: { resourceUri: 'ui://search-results/mcp-app.html' },
      },
      annotations: {
        title: annotations.title,
        readOnlyHint: annotations.readOnlyHint,
        destructiveHint: annotations.destructiveHint,
        idempotentHint: annotations.idempotentHint,
        openWorldHint: annotations.openWorldHint,
      },
    },
    async (args) => {
      const startTime = performance.now();

      const parsedArgs = InputSchema.safeParse(args);
      if (!parsedArgs.success) {
        deps.logger.warn('tool_access', {
          tool: 'search_corporate_by_name',
          count: 0,
          duration_ms: Math.round(performance.now() - startTime),
          error_type: 'invalid_input',
        });
        return createErrorResponse(
          'INVALID_INPUT',
          `入力パラメータが不正です: ${parsedArgs.error.issues.map((e) => e.message).join(', ')}`,
        );
      }

      const { name, prefecture, cursor, limit } = parsedArgs.data;

      // カーソルが指定されている場合、事前構文チェック
      let requestedOffset = 0;
      let requestedDivide = 1;
      if (cursor !== undefined && cursor !== '') {
        const decoded = decodeNameSearchCursor(cursor);
        if (decoded === null) {
          deps.logger.warn('tool_access', {
            tool: 'search_corporate_by_name',
            count: 0,
            duration_ms: Math.round(performance.now() - startTime),
            error_type: 'invalid_cursor',
          });
          return createErrorResponse(
            'INVALID_INPUT',
            'カーソルの形式が無効です。',
          );
        }
        requestedOffset = decoded.offset;
        requestedDivide = decoded.divide ?? 1;
      }

      const apiResult = await deps.ntaClient.searchByName({
        name,
        mode: '1', // 前方一致
        target: '1', // JIS1-2水準あいまい検索
        ...(prefecture !== undefined && { address: prefecture }),
        change: '0',
        close: '1', // 閉鎖法人も含めて検索
        divide: requestedDivide,
      });

      if (Result.isErr(apiResult)) {
        const err = apiResult.error;
        deps.logger.error('tool_access', {
          tool: 'search_corporate_by_name',
          duration_ms: Math.round(performance.now() - startTime),
          error_type: err.code,
        });

        if (err.httpStatus === 429) {
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
          });
          return createErrorResponse('INVALID_INPUT', validation.message);
        }
      }

      const corporations = parsed.corporations;
      const totalCount = parsed.header.count;

      // 該当ページ内でのスライス取得
      const pageSlice = corporations.slice(requestedOffset, requestedOffset + limit);

      let nextCursor: string | null = null;
      if (requestedOffset + limit < corporations.length) {
        // 同じ Web-API 応答内に次がある場合
        nextCursor = encodeNameSearchCursor({
          offset: requestedOffset + limit,
          data_as_of: dataAsOf,
          divide: requestedDivide,
        });
      } else if (parsed.header.divideNumber < parsed.header.divideSize) {
        // 次の Web-API 分割 (divide) がある場合
        nextCursor = encodeNameSearchCursor({
          offset: 0,
          data_as_of: dataAsOf,
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
        };
      });

      deps.logger.info('tool_access', {
        tool: 'search_corporate_by_name',
        count: results.length,
        duration_ms: Math.round(performance.now() - startTime),
      });

      const structuredContent: SearchByNameOutput = {
        results,
        total_count: totalCount,
        next_cursor: nextCursor,
        data_as_of: dataAsOf,
        attribution: NTA_CORPORATE_WEB_API_ATTRIBUTION,
      };

      const summary = [
        `「${name}」の検索結果です（全 ${totalCount} 件中 ${results.length} 件を表示）。`,
        ...(nextCursor ? ['※続きの検索結果を取得するには、返却された next_cursor を指定して再実行してください。'] : []),
        `データ時点: ${dataAsOf}`,
        `出典: ${NTA_CORPORATE_WEB_API_ATTRIBUTION}`,
      ].join('\n');

      return createSuccessResponse(summary, structuredContent);
    },
  );
}
