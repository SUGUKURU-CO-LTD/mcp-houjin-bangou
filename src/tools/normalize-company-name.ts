/**
 * T5: normalize_company_name
 * 企業名の表記ゆれを正規化 (ローカル処理)
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1.5, §3.1, §4, §6.2 (v1.4 凍結仕様)
 *   国税庁仕様書 第二編 §4.6.2 (target=1 の内蔵あいまい検索の挙動補完)
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normalizeCompanyName, type KindHint } from '../domain/normalizer.js';
import { getToolAnnotations } from '../domain/tool-annotations.js';
import { createSuccessResponse, createErrorResponse } from '../lib/tool-response.js';

const InputSchema = z
  .object({
    raw_name: z
      .string()
      .min(1, '正規化する企業名を指定してください')
      .max(200, '企業名は200文字以内で指定してください')
      .describe('Raw company name string to normalize'),
  })
  .strict();

const OutputSchema = z
  .object({
    normalized_name: z.string().describe('正規化された企業名'),
    legal_type: z.string().nullable().describe('検出された法人種別（未検出の場合は null）'),
    search_query_optimized: z.string().describe('検索用に最適化されたコア企業名'),
  })
  .strict();

export type NormalizeCompanyNameInput = z.infer<typeof InputSchema>;
export type NormalizeCompanyNameOutput = z.infer<typeof OutputSchema>;

const DESCRIPTION_JA =
  '企業名の表記ゆれ（全角・半角英数字、(株)や株式会社の表記位置、特殊記号、スペース等）を正規化します（ローカル処理）。';

const KIND_HINT_TO_LABEL: Record<KindHint, string | null> = {
  kabushiki_kaisha: '株式会社',
  yugen_kaisha: '有限会社',
  gomei_kaisha: '合名会社',
  goshi_kaisha: '合資会社',
  godo_kaisha: '合同会社',
  ippan_shadan_hojin: '一般社団法人',
  ippan_zaidan_hojin: '一般財団法人',
  koueki_shadan_hojin: '公益社団法人',
  koueki_zaidan_hojin: '公益財団法人',
  npo_hojin: '特定非営利活動法人',
  state_agency: '国の機関',
  local_government: '地方公共団体',
  other_registered: 'その他の設立登記法人',
  foreign_company: '外国会社等',
  other: null,
  unknown: null,
};

export function registerNormalizeCompanyNameTool(server: McpServer): void {
  const annotations = getToolAnnotations('normalize_company_name', 'web-api');

  server.registerTool(
    'normalize_company_name',
    {
      title: annotations.title,
      description: DESCRIPTION_JA,
      inputSchema: InputSchema.shape,
      outputSchema: OutputSchema.shape,
      annotations: {
        title: annotations.title,
        readOnlyHint: annotations.readOnlyHint,
        destructiveHint: annotations.destructiveHint,
        idempotentHint: annotations.idempotentHint,
        openWorldHint: annotations.openWorldHint,
      },
    },
    async (args) => {
      const parsedArgs = InputSchema.safeParse(args);
      if (!parsedArgs.success) {
        return createErrorResponse(
          'INVALID_INPUT',
          `企業名の入力形式が不正です: ${parsedArgs.error.issues.map((e) => e.message).join(', ')}`,
        );
      }

      const { raw_name } = parsedArgs.data;
      const result = normalizeCompanyName(raw_name);

      const topCandidate = result.normalized_candidates[0];
      const legalType = topCandidate ? (KIND_HINT_TO_LABEL[topCandidate.kind_hint] ?? null) : null;
      const searchQueryOptimized = result.extracted_core_name || raw_name.trim();

      // (株) などの略称を正式名称に展開した商号を生成
      let normalizedName = topCandidate?.name ?? searchQueryOptimized;
      if (topCandidate && legalType && searchQueryOptimized) {
        if (topCandidate.prefix_or_suffix === 'mae_kabu') {
          normalizedName = `${legalType}${searchQueryOptimized}`;
        } else if (topCandidate.prefix_or_suffix === 'ato_kabu') {
          normalizedName = `${searchQueryOptimized}${legalType}`;
        }
      }

      const structuredContent: NormalizeCompanyNameOutput = {
        normalized_name: normalizedName,
        legal_type: legalType,
        search_query_optimized: searchQueryOptimized,
      };

      const summary = `会社名の正規化結果: "${normalizedName}"（法人種別: ${legalType ?? '未検出'}、検索最適化名: "${searchQueryOptimized}"）`;

      return createSuccessResponse(summary, structuredContent);
    },
  );
}
