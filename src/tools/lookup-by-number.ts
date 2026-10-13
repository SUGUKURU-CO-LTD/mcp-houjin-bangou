/**
 * T1: lookup_corporate_by_number
 * 13桁の法人番号で法人情報を取得
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1.1, §3.1, §4, §6.1, §6.2 (v1.4 凍結仕様)
 *   国税庁仕様書 第六編 §2, 第二編 §2
 *   国税庁仕様書 第二編 別紙1 項番15 (法人種別), 項番26 (登記記録の閉鎖等の事由)
 *   国税庁 法人番号システムWeb-API機能利用規約 第6条 [出典-A1]
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NtaClient } from '../api/nta-client.js';
import type { McpLogger } from '../lib/mcp-logger.js';
import { normalizeAndValidateCorporateNumber } from '../domain/check-digit.js';
import { kindLabel } from '../domain/kind-codes.js';
import { closeCauseLabel } from '../domain/close-cause-codes.js';
import { getToolAnnotations } from '../domain/tool-annotations.js';
import {
  createSuccessResponse,
  createErrorResponse,
  NTA_CORPORATE_WEB_API_ATTRIBUTION,
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

export const CorporationInfoSchema = z.object({
  corporate_number: z.string(),
  name: z.string(),
  name_kana: z.string().nullable(),
  legal_type: z.string(),
  location: z.string(),
  post_code: z.string().nullable(),
  update_date: z.string(),
  status: z.enum(['active', 'closed']),
  close_date: z.string().nullable().describe('Date of closure (YYYY-MM-DD); null if active'),
  close_cause: z
    .string()
    .nullable()
    .describe('Reason for closure as published (e.g., liquidation, merger); null if active'),
});

const OutputSchema = z.object({
  corporation: CorporationInfoSchema,
  data_as_of: z.string().describe('Date of the public dataset (YYYY-MM-DD)'),
  attribution: z.string().describe('Attribution text required by NTA terms of service'),
});

import type { DbCorporateDataProvider } from '../repository/corporate-repository.js';
import type { DataSourceMode } from '../domain/tool-annotations.js';

export type LookupByNumberInput = z.infer<typeof InputSchema>;
export type LookupByNumberOutput = z.infer<typeof OutputSchema>;

const DESCRIPTION_JA =
  '13桁の法人番号を指定して、国税庁が公表している法人の基本3情報（名称・所在地・法人番号）と、法人種別・更新年月日・閉鎖の有無を返します。データの時点を併せて返します。';

export interface LookupByNumberDeps {
  ntaClient?: NtaClient;
  dbProvider?: DbCorporateDataProvider;
  dataSource?: DataSourceMode;
  logger: McpLogger;
}

export function registerLookupByNumberTool(server: McpServer, deps: LookupByNumberDeps): void {
  const isDb =
    deps.dataSource === 'db' ||
    deps.dataSource === 'database' ||
    (deps.dbProvider !== undefined && deps.ntaClient === undefined);
  const annotations = getToolAnnotations('lookup_corporate_by_number', isDb ? 'db' : 'web-api');

  server.registerTool(
    'lookup_corporate_by_number',
    {
      title: annotations.title,
      description: DESCRIPTION_JA,
      inputSchema: InputSchema.shape,
      outputSchema: OutputSchema.shape,
      _meta: {
        ui: { resourceUri: 'ui://corporate-card/mcp-app.html' },
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
          tool: 'lookup_corporate_by_number',
          count: 0,
          duration_ms: Math.round(performance.now() - startTime),
          error_type: 'invalid_input',
        });
        return createErrorResponse(
          'INVALID_INPUT',
          `法人番号の入力形式が不正です: ${parsedArgs.error.issues.map((e) => e.message).join(', ')}`,
        );
      }

      const { corporate_number } = parsedArgs.data;

      // チェックデジットのローカル検証
      const checkDigitResult = normalizeAndValidateCorporateNumber(corporate_number);
      if (!checkDigitResult.isValid) {
        deps.logger.warn('tool_access', {
          tool: 'lookup_corporate_by_number',
          count: 0,
          duration_ms: Math.round(performance.now() - startTime),
          error_type: 'check_digit_mismatch',
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
          });
          return createErrorResponse(
            err.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'DATA_UNAVAILABLE',
            err.message,
          );
        }

        const val = dbResult.value;
        deps.logger.info('tool_access', {
          tool: 'lookup_corporate_by_number',
          count: 1,
          duration_ms: Math.round(performance.now() - startTime),
        });

        const output: LookupByNumberOutput = {
          corporation: val.corporation,
          data_as_of: val.data_as_of,
          attribution: val.attribution,
        };

        const statusLabel = val.corporation.status === 'closed' ? '（閉鎖）' : '';
        const summaryText = `${val.corporation.name}${statusLabel}（法人番号: ${corporate_number}）の公表情報を取得しました。所在地: ${val.corporation.location}`;

        return createSuccessResponse(summaryText, output);
      }

      // ローカル版 (国税庁 Web-API 直接呼出) モード
      if (!deps.ntaClient) {
        return createErrorResponse('INTERNAL_ERROR', 'NTA client is not initialized');
      }

      const apiResult = await deps.ntaClient.lookupByNumber({
        numbers: [corporate_number],
        history: '0',
      });

      if (Result.isErr(apiResult)) {
        const err = apiResult.error;
        deps.logger.error('tool_access', {
          tool: 'lookup_corporate_by_number',
          duration_ms: Math.round(performance.now() - startTime),
          error_type: err.code,
        });

        if (err.httpStatus === 429) {
          return createErrorResponse(
            'RATE_LIMITED',
            '利用上限（レート制限）に達しました。しばらく待ってから再試行してください。',
          );
        }
        return createErrorResponse(
          'DATA_UNAVAILABLE',
          '国税庁公表データの取得に失敗しました。時間をおいて再試行してください。',
        );
      }

      const parsed = apiResult.value;
      const rawCorp = parsed.corporations.find((c) => c.corporate_number === corporate_number);

      if (!rawCorp) {
        deps.logger.info('tool_access', {
          tool: 'lookup_corporate_by_number',
          count: 0,
          duration_ms: Math.round(performance.now() - startTime),
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
      };

      const structuredContent: LookupByNumberOutput = {
        corporation: corporationOutput,
        data_as_of: dataAsOf,
        attribution,
      };

      const summary = [
        `${corporationOutput.name}（法人番号: ${corporationOutput.corporate_number}）の公表情報です。`,
        `状態: ${corporationOutput.status === 'active' ? '登記中 (active)' : `閉鎖 (closed${closeDate ? ` / 閉鎖日: ${closeDate}` : ''}${closeCause ? ` / 事由: ${closeCause}` : ''})`}`,
        `法人種別: ${corporationOutput.legal_type}`,
        `所在地: ${corporationOutput.location}`,
        `データ時点: ${dataAsOf}`,
        `出典: ${attribution}`,
      ].join('\n');

      return createSuccessResponse(summary, structuredContent);
    },
  );
}
