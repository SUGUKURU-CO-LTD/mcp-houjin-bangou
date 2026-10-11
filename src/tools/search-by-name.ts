/**
 * T2: search_corporate_by_name
 * 法人名で国税庁公表サイトから法人情報を検索 (ページング対応)
 *
 * 根拠 / Source: 国税庁仕様書 第六編 §4, 第二編 §4
 * エンドポイント: GET /4/name?id=...&name=<UTF-8 URLenc>&type=02&...
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
import { Result } from '../lib/result.js';
import { computeNextCursor, decodeCursor } from '../lib/pagination.js';

const InputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(150)
      .describe('商号又は名称 (日本語 150文字以内 / 英語 300文字以内)。UTF-8。'),
    match_mode: z
      .enum(['prefix', 'partial'])
      .default('prefix')
      .describe(
        '検索方式。prefix=前方一致 (法人種別を除いた先頭から、mode=1)、partial=部分一致 (法人種別を含めて全体から、mode=2)。',
      ),
    search_target: z
      .enum(['fuzzy', 'exact', 'english'])
      .default('fuzzy')
      .describe(
        '検索対象。fuzzy=JIS第一・第二水準のあいまい検索 (target=1、ひらがな↔カタカナ・英大小文字・中点空白無視)、exact=JIS第一〜第四水準の完全一致 (target=2)、english=英語表記検索 (target=3)。',
      ),
    prefecture: z
      .string()
      .regex(/^(?:\d{2}|\d{5})$/)
      .optional()
      .describe(
        '都道府県コード (2桁 JIS X 0401、01-47 or 99=国外) または 都道府県+市区町村 (5桁)。',
      ),
    kind: z
      .array(z.enum(['01', '02', '03', '04']))
      .max(4)
      .optional()
      .describe(
        '法人種別フィルタ。01=国の機関, 02=地方公共団体, 03=設立登記法人, 04=外国会社等・その他。最大4件。',
      ),
    include_history: z
      .boolean()
      .default(false)
      .describe('過去情報を検索対象に含めるか (change=1)。最新情報のみなら false。'),
    include_closed: z
      .boolean()
      .default(true)
      .describe('登記記録の閉鎖等があった法人も含めるか (close=1、デフォルト true)。'),
    cursor: z
      .string()
      .optional()
      .describe('ページング用の不透明カーソル (MCP 仕様準拠、opaque string)。'),
  })
  .strict();

const OutputSchema = z
  .object({
    total: z.number().int().nonnegative().describe('該当件数 (国税庁レスポンスヘッダ count)'),
    page_number: z.number().int().positive(),
    page_size: z.number().int().positive(),
    corporations: z.array(CorporationSchema),
    next_cursor: z.string().nullable().describe('次ページの cursor (最終ページなら null)'),
    last_update_date: z.string().describe('国税庁公表DB の最終更新日 (YYYY-MM-DD)'),
    attribution: AttributionSchema,
  })
  .strict();

export type SearchByNameInput = z.infer<typeof InputSchema>;
export type SearchByNameOutput = z.infer<typeof OutputSchema>;

const DESCRIPTION = `会社名で国税庁公表サイトから法人情報を検索します。国税庁 API 内蔵のあいまい検索 (target=1) が ひらがな↔カタカナ・英大小文字・中点削除 を自動で処理するので、多少の表記揺れは吸収できます。

USE THIS WHEN:
- 会社名 (日本語・英語) だけ分かっていて法人番号・住所を知りたい
- 「鹿児島県の○○商事」を全部探したい (prefecture で絞り込み)
- 営業リストを一括で enrich したい

DO NOT USE WHEN:
- 法人番号 (13桁) が分かっている → lookup_corporate_by_number を使う方が速くて確実
- (株)/K.K./Co.,Ltd. などの表記揺れが激しい → まず normalize_company_name で候補化
- 検索結果が多すぎる場合 (国税庁エラー 400-180): prefecture や kind で絞り込む

ページング: 2000件超過時は国税庁側で分割レスポンスになります。次ページは next_cursor で取得。

根拠: 国税庁 法人番号 Web-API 仕様書 第六編 §4、第二編 §4.6.1・§4.6.2 (target=1 内蔵あいまい検索の挙動)`;

export function registerSearchByNameTool(
  server: McpServer,
  deps: { ntaClient: NtaClient; logger: McpLogger },
): void {
  server.registerTool(
    'search_corporate_by_name',
    {
      title: 'Search Japanese corporations by name',
      description: DESCRIPTION,
      inputSchema: InputSchema.shape,
      outputSchema: OutputSchema.shape,
      _meta: {
        ui: { resourceUri: 'ui://search-results/mcp-app.html' },
      },
      annotations: {
        title: 'Search Japanese corporations by name',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      const startTime = performance.now();
      const input = InputSchema.parse(args);

      const cursorPayload = decodeCursor(input.cursor);
      const divide = cursorPayload?.divide ?? 1;

      const mode = input.match_mode === 'prefix' ? '1' : '2';
      const target =
        input.search_target === 'fuzzy' ? '1' : input.search_target === 'exact' ? '2' : '3';

      const apiResult = await deps.ntaClient.searchByName({
        name: input.name,
        mode,
        target,
        ...(input.prefecture !== undefined && { address: input.prefecture }),
        ...(input.kind !== undefined && input.kind.length > 0 && { kind: input.kind.join(',') }),
        change: input.include_history ? '1' : '0',
        close: input.include_closed ? '1' : '0',
        divide,
      });

      if (Result.isErr(apiResult)) {
        const err = apiResult.error;
        deps.logger.error('tool_access', {
          tool: 'search_corporate_by_name',
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
                    guidance:
                      err.httpStatus === 400
                        ? '検索結果が多すぎる可能性があります。prefecture や kind で絞り込んでください。'
                        : err.httpStatus === 403
                          ? 'レート制限中。しばらく待ってから再試行してください。'
                          : undefined,
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

      deps.logger.info('tool_access', {
        tool: 'search_corporate_by_name',
        count: parsed.corporations.length,
        duration_ms: Math.round(performance.now() - startTime),
      });

      const queryKey = JSON.stringify([
        input.name,
        mode,
        target,
        input.prefecture,
        input.kind,
        input.include_history,
        input.include_closed,
      ]);
      const nextCursor = computeNextCursor(
        parsed.header.divideNumber,
        parsed.header.divideSize,
        queryKey,
      );

      const output: SearchByNameOutput = {
        total: parsed.header.count,
        page_number: parsed.header.divideNumber,
        page_size: parsed.header.divideSize,
        corporations: parsed.corporations,
        next_cursor: nextCursor,
        last_update_date: parsed.header.lastUpdateDate,
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
