/**
 * T1: lookup_corporate_by_number
 * 13桁の法人番号で法人情報を取得 (最大10件カンマ区切り)
 *
 * 根拠 / Source: 国税庁仕様書 第六編 §2, 第二編 §2
 * エンドポイント: GET /4/num?id=...&number=...&type=02&history=0|1
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NtaClient } from '../api/nta-client.js';
import type { McpLogger } from '../lib/mcp-logger.js';
import {
  AttributionSchema,
  CorporationSchema,
  buildAttribution,
} from '../domain/corporate-number.js';
import { normalizeAndValidateCorporateNumber } from '../domain/check-digit.js';
import { Result } from '../lib/result.js';

const InputSchema = z
  .object({
    corporate_numbers: z
      .array(z.string().min(1))
      .min(1)
      .max(10)
      .describe('13桁の法人番号 (最大10件)。半角数字必須。ハイフン・空白は自動除去されます。'),
    include_history: z
      .boolean()
      .default(false)
      .describe('変更履歴 (商号変更・所在地変更等) を含めるか。デフォルト false。'),
    language: z
      .enum(['ja', 'en'])
      .default('ja')
      .describe('ラベル言語 (住所等のデータ値は API のまま、ラベルのみ切替)。'),
  })
  .strict();

const OutputSchema = z
  .object({
    corporations: z.array(CorporationSchema),
    not_found: z.array(z.string()).describe('該当が見つからなかった法人番号のリスト。'),
    invalid_inputs: z
      .array(
        z.object({
          input: z.string(),
          reason: z.string(),
        }),
      )
      .describe('入力エラーの詳細 (SEP-1303 準拠、ツール実行エラーとして返却)。'),
    attribution: AttributionSchema,
  })
  .strict();

export type LookupByNumberInput = z.infer<typeof InputSchema>;
export type LookupByNumberOutput = z.infer<typeof OutputSchema>;

const DESCRIPTION = `法人番号 (13桁) を指定して国税庁公表サイトから法人情報を取得します。最大10件カンマ区切りで一括取得可能。チェックデジット検証をローカルで事前実施し、無効な番号は API を叩かず弾きます。

USE THIS WHEN:
- ユーザーが法人番号 (13桁の数字、例: 1340001023456) を知っていて、社名・住所・登記日を知りたい
- 名刺・契約書・請求書に記載された法人番号が有効か確認したい
- 複数の法人番号を一括で検証・情報取得したい (最大10件)

DO NOT USE WHEN:
- 会社名しか分からない → search_corporate_by_name を使う
- 番号が有効かだけ確認したい (API 呼出不要) → validate_corporate_number を使う
- 表記揺れを含む会社名から検索したい → normalize_company_name で候補化してから search_corporate_by_name

根拠: 国税庁 法人番号 Web-API 仕様書 第六編 §2「法人番号を指定して情報を取得する機能」`;

export function registerLookupByNumberTool(
  server: McpServer,
  deps: { ntaClient: NtaClient; logger: McpLogger },
): void {
  server.registerTool(
    'lookup_corporate_by_number',
    {
      title: 'Lookup Japanese corporation by national corporate number',
      description: DESCRIPTION,
      inputSchema: InputSchema.shape,
      outputSchema: OutputSchema.shape,
      _meta: {
        ui: { resourceUri: 'ui://corporate-card/mcp-app.html' },
      },
      annotations: {
        title: 'Lookup Japanese corporation by national corporate number',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      const startTime = performance.now();
      const input = InputSchema.parse(args);

      const validInputs: string[] = [];
      const invalidInputs: LookupByNumberOutput['invalid_inputs'] = [];

      for (const raw of input.corporate_numbers) {
        const result = normalizeAndValidateCorporateNumber(raw);
        if (result.isValid) {
          validInputs.push(result.normalized);
        } else {
          invalidInputs.push({
            input: raw,
            reason: result.reason,
          });
        }
      }

      if (validInputs.length === 0) {
        deps.logger.warn('tool_access', {
          tool: 'lookup_corporate_by_number',
          count: 0,
          duration_ms: Math.round(performance.now() - startTime),
          error_type: 'invalid_input',
        });
        const output: LookupByNumberOutput = {
          corporations: [],
          not_found: [],
          invalid_inputs: invalidInputs,
          attribution: buildAttribution(),
        };
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify(output, null, 2),
            },
          ],
          structuredContent: output,
        };
      }

      const apiResult = await deps.ntaClient.lookupByNumber({
        numbers: validInputs,
        history: input.include_history ? '1' : '0',
      });

      if (Result.isErr(apiResult)) {
        const err = apiResult.error;
        deps.logger.error('tool_access', {
          tool: 'lookup_corporate_by_number',
          duration_ms: Math.round(performance.now() - startTime),
          error_type: err.code,
        });
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: {
                    code: err.code,
                    message: err.message,
                    httpStatus: err.httpStatus,
                  },
                  attribution: buildAttribution(),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const parsed = apiResult.value;
      const foundNumbers = new Set(parsed.corporations.map((c) => c.corporate_number));
      const notFound = validInputs.filter((n) => !foundNumbers.has(n));

      deps.logger.info('tool_access', {
        tool: 'lookup_corporate_by_number',
        count: parsed.corporations.length,
        duration_ms: Math.round(performance.now() - startTime),
      });

      const output: LookupByNumberOutput = {
        corporations: parsed.corporations,
        not_found: notFound,
        invalid_inputs: invalidInputs,
        attribution: buildAttribution(),
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(output, null, 2),
          },
        ],
        structuredContent: output,
      };
    },
  );
}
