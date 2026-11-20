/**
 * T1: lookup_corporate_by_number
 * 13桁の法人番号で法人情報を取得
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1.1, §3.1, §4, §6.1, §6.2
 *   国税庁仕様書 第六編 §2, 第二編 §2
 *   国税庁仕様書 第二編 別紙1 項番15 (法人種別), 項番26 (登記記録の閉鎖等の事由), 項番27 (承継先法人番号)
 *   国税庁 法人番号システムWeb-API機能利用規約 第6条 [出典-A1]
 */

import { z } from 'zod';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NtaClient } from '../api/nta-client.js';
import type { McpLogger } from '../lib/mcp-logger.js';
import { RateLimitError } from '../lib/errors.js';
import { extractTraceFromMcpExtra } from '../lib/trace-context.js';
import { normalizeAndValidateCorporateNumber } from '../domain/check-digit.js';
import { kindLabel } from '../domain/kind-codes.js';
import { closeCauseLabel } from '../domain/close-cause-codes.js';
import { getToolAnnotations, type DataSourceMode } from '../domain/tool-annotations.js';
import type { DbCorporateDataProvider } from '../repository/corporate-repository.js';
import {
  createSuccessResponse,
  createErrorResponse,
  NTA_CORPORATE_WEB_API_ATTRIBUTION,
  formatAttributionLine,
} from '../lib/tool-response.js';
import { Result } from '../lib/result.js';

const InputSchema = z
  .object({
    corporate_number: z
      .string()
      .regex(/^[0-9]{13}$/, '13桁の半角数字を指定してください')
      .describe("13-digit Japanese national corporate number (digits only, e.g., '9340001026142')"),
  })
  .strict();

export const CorporationInfoSchema = z
  .object({
    corporate_number: z.string().describe('13-digit Japanese national corporate number'),
    name: z.string().describe('Official published corporate name (商号又は名称)'),
    name_kana: z
      .string()
      .nullable()
      .describe('Furigana reading in katakana if published; null otherwise'),
    legal_type: z.string().describe('Corporate kind label in Japanese (e.g., 株式会社, 合同会社)'),
    location: z.string().describe('Published head office location (本店又は主たる事務所の所在地)'),
    post_code: z.string().nullable().describe('7-digit postal code without hyphen; null if absent'),
    update_date: z.string().describe('Last record update date (YYYY-MM-DD)'),
    status: z.enum(['active', 'closed']).describe("Registration status ('active' or 'closed')"),
    close_date: z.string().nullable().describe('Date of closure (YYYY-MM-DD); null if active'),
    close_cause: z
      .string()
      .nullable()
      .describe('Reason for closure as published (e.g., liquidation, merger); null if active'),
    successor_corporate_number: z
      .string()
      .nullable()
      .optional()
      .describe(
        '13-digit corporate number of the succeeding corporation (e.g., after merger); null if none',
      ),
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
    corporation: CorporationInfoSchema.describe('Published corporate basic record'),
    data_as_of: z
      .string()
      .describe(
        'Date of the public dataset (YYYY-MM-DD; updated monthly with end-of-previous-month snapshot / 月1回、前月末時点の全件データで更新)',
      ),
    attribution: z.string().describe('Attribution text required by NTA terms of service'),
  })
  .strict();

export type LookupByNumberInput = z.infer<typeof InputSchema>;
export type LookupByNumberOutput = z.infer<typeof OutputSchema>;

const DESCRIPTION_JA =
  '13桁の法人番号を指定して、国税庁が公表している法人の基本3情報（名称・所在地・法人番号）と、法人種別・更新年月日・閉鎖の有無（合併等がある場合は承継先法人番号を含む）を返します。データの時点を併せて返します。';

export interface LookupByNumberDeps {
  ntaClient?: NtaClient;
  dbProvider?: DbCorporateDataProvider;
  dataSource?: DataSourceMode;
  logger: McpLogger;
}

function buildSummaryText(
  corporation: LookupByNumberOutput['corporation'],
  dataAsOf: string,
  attribution: string,
): string {
  const closeDate = corporation.close_date;
  const closeCause = corporation.close_cause;
  const successor = corporation.successor_corporate_number ?? null;

  return [
    `${corporation.name}（法人番号: ${corporation.corporate_number}）の公表情報です。`,
    `状態: ${corporation.status === 'active' ? '登記中 (active)' : `閉鎖 (closed${closeDate ? ` / 閉鎖日: ${closeDate}` : ''}${closeCause ? ` / 事由: ${closeCause}` : ''})`}`,
    ...(successor ? [`承継先法人番号: ${successor}`] : []),
    `法人種別: ${corporation.legal_type}`,
    `所在地: ${corporation.location}`,
    ...(corporation.address_may_be_outdated
      ? ['※登記上の所在地の表記が、住居表示の実施等により現在の住所と異なる可能性があります。']
      : []),
    `データ時点: ${dataAsOf}`,
    formatAttributionLine(attribution),
  ].join('\n');
}

export function registerLookupByNumberTool(server: McpServer, deps: LookupByNumberDeps): void {
  const isDb =
    deps.dataSource === 'db' || (deps.dbProvider !== undefined && deps.ntaClient === undefined);
  const annotations = getToolAnnotations('lookup_corporate_by_number', isDb ? 'db' : 'web-api');

  registerAppTool(
    server,
    'lookup_corporate_by_number',
    {
      title: annotations.title,
      description: DESCRIPTION_JA,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      _meta: {
        ui: {
          resourceUri: 'ui://corporate-card/mcp-app.html',
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
      const { corporate_number } = args;

      // チェックデジットのローカル検証
      const checkDigitResult = normalizeAndValidateCorporateNumber(corporate_number);
      if (!checkDigitResult.isValid) {
        deps.logger.warn('tool_access', {
          tool: 'lookup_corporate_by_number',
          count: 0,
          duration_ms: Math.round(performance.now() - startTime),
          error_type: 'check_digit_mismatch',
          trace_id: trace.traceContext.traceId,
        });
        return createErrorResponse(
          'INVALID_INPUT',
          'チェックデジットが一致しません。入力された法人番号をご確認ください。',
        );
      }

      // ホスト版 (自社 PostgreSQL DB 参照) モード
      if (isDb) {
        if (!deps.dbProvider) {
          deps.logger.error('tool_access', {
            tool: 'lookup_corporate_by_number',
            duration_ms: Math.round(performance.now() - startTime),
            error_type: 'INTERNAL_ERROR',
            trace_id: trace.traceContext.traceId,
          });
          return createErrorResponse('INTERNAL_ERROR', 'Database provider is not initialized');
        }

        const dbResult = await deps.dbProvider.lookupByNumber(corporate_number);
        if (!dbResult.ok) {
          const err = dbResult.error;
          deps.logger.info('tool_access', {
            tool: 'lookup_corporate_by_number',
            count: 0,
            duration_ms: Math.round(performance.now() - startTime),
            error_type: err.code,
            trace_id: trace.traceContext.traceId,
          });
          return createErrorResponse(
            err.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'DATA_UNAVAILABLE',
            err.message,
          );
        }

        const val = dbResult.value;
        const rawDbCorp = val.corporation as typeof val.corporation & {
          successorCorporateNumber?: string | null;
          successor_corporate_number?: string | null;
        };
        const rawDbSuccessor =
          rawDbCorp.successor_corporate_number ?? rawDbCorp.successorCorporateNumber ?? null;
        const successorCorporateNumber =
          rawDbSuccessor && rawDbSuccessor.trim() !== '' ? rawDbSuccessor.trim() : null;

        const corporationOutput: LookupByNumberOutput['corporation'] = {
          corporate_number: val.corporation.corporate_number,
          name: val.corporation.name,
          name_kana: val.corporation.name_kana,
          legal_type: val.corporation.legal_type,
          location: val.corporation.location,
          post_code: val.corporation.post_code,
          update_date: val.corporation.update_date,
          status: val.corporation.status,
          close_date: val.corporation.close_date,
          close_cause: val.corporation.close_cause,
          successor_corporate_number: successorCorporateNumber,
          address_may_be_outdated: val.corporation.address_may_be_outdated,
        };

        deps.logger.info('tool_access', {
          tool: 'lookup_corporate_by_number',
          count: 1,
          duration_ms: Math.round(performance.now() - startTime),
          trace_id: trace.traceContext.traceId,
        });

        const output: LookupByNumberOutput = {
          corporation: corporationOutput,
          data_as_of: val.data_as_of,
          attribution: val.attribution,
        };

        return createSuccessResponse(
          buildSummaryText(corporationOutput, val.data_as_of, val.attribution),
          output,
        );
      }

      // ローカル版 (国税庁 Web-API 直接呼出) モード
      if (!deps.ntaClient) {
        return createErrorResponse('INTERNAL_ERROR', 'NTA client is not initialized');
      }

      let apiResult: Awaited<ReturnType<NtaClient['lookupByNumber']>>;
      try {
        apiResult = await deps.ntaClient.lookupByNumber({
          numbers: [corporate_number],
          history: '0',
        });
      } catch (err) {
        if (err instanceof RateLimitError) {
          deps.logger.warn('tool_access', {
            tool: 'lookup_corporate_by_number',
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
          tool: 'lookup_corporate_by_number',
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
        if (err.code === 'http_404' || err.httpStatus === 404) {
          return createErrorResponse(
            'NOT_FOUND',
            `指定された法人番号 (${corporate_number}) に該当する公表データは見つかりませんでした。`,
          );
        }
        return createErrorResponse(
          'DATA_UNAVAILABLE',
          '国税庁公表データの取得に失敗しました。時間をおいて再試行してください。',
        );
      }

      const parsed = apiResult.value;
      const matchingCorps = parsed.corporations.filter(
        (c) => c.corporate_number === corporate_number,
      );
      const rawCorp =
        matchingCorps.find((c) => c.latest === '1') ?? matchingCorps[matchingCorps.length - 1];

      if (!rawCorp || rawCorp.process === '99') {
        deps.logger.info('tool_access', {
          tool: 'lookup_corporate_by_number',
          count: 0,
          duration_ms: Math.round(performance.now() - startTime),
          trace_id: trace.traceContext.traceId,
        });
        return createErrorResponse(
          'NOT_FOUND',
          `指定された法人番号 (${corporate_number}) に該当する公表データは見つかりませんでした。`,
        );
      }

      deps.logger.info('tool_access', {
        tool: 'lookup_corporate_by_number',
        count: 1,
        duration_ms: Math.round(performance.now() - startTime),
        trace_id: trace.traceContext.traceId,
      });

      const isClosed =
        (rawCorp.close_date && rawCorp.close_date.trim() !== '') ||
        (rawCorp.close_cause && rawCorp.close_cause.trim() !== '');

      const closeDate =
        rawCorp.close_date && rawCorp.close_date.trim() !== '' ? rawCorp.close_date.trim() : null;

      // 閉鎖事由: 国税庁仕様書 第二編 別紙1 項番26 に基づく表記対応 [出典-A1, 項番26]
      const closeCause =
        rawCorp.close_cause && rawCorp.close_cause.trim() !== ''
          ? closeCauseLabel(rawCorp.close_cause.trim(), 'ja')
          : null;

      const successorCorporateNumber =
        rawCorp.successor_corporate_number && rawCorp.successor_corporate_number.trim() !== ''
          ? rawCorp.successor_corporate_number.trim()
          : null;

      const location =
        rawCorp.address_outside && rawCorp.address_outside.trim() !== ''
          ? rawCorp.address_outside.trim()
          : `${rawCorp.prefecture_name ?? ''}${rawCorp.city_name ?? ''}${rawCorp.street_number ?? ''}`;

      const nameKana =
        rawCorp.furigana && rawCorp.furigana.trim() !== '' ? rawCorp.furigana.trim() : null;

      const postCode =
        rawCorp.post_code && rawCorp.post_code.trim() !== '' ? rawCorp.post_code.trim() : null;

      const dataAsOf = parsed.header.lastUpdateDate;
      const attribution = NTA_CORPORATE_WEB_API_ATTRIBUTION;

      const corporationOutput: LookupByNumberOutput['corporation'] = {
        corporate_number: rawCorp.corporate_number,
        name: rawCorp.name,
        name_kana: nameKana,
        legal_type: kindLabel(rawCorp.kind, 'ja'),
        location,
        post_code: postCode,
        update_date: rawCorp.update_date,
        status: isClosed ? 'closed' : 'active',
        close_date: closeDate,
        close_cause: closeCause,
        successor_corporate_number: successorCorporateNumber,
        address_may_be_outdated: rawCorp.hihyoji === '1',
      };

      const structuredContent: LookupByNumberOutput = {
        corporation: corporationOutput,
        data_as_of: dataAsOf,
        attribution,
      };

      return createSuccessResponse(
        buildSummaryText(corporationOutput, dataAsOf, attribution),
        structuredContent,
      );
    },
  );
}
