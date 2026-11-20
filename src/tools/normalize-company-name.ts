/**
 * T5: normalize_company_name
 * 企業名の表記ゆれを正規化 (ローカル処理)
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1.5, §3.1, §4, §6.2
 *   国税庁仕様書 第二編 §4.6.2 (target=1 の内蔵あいまい検索の挙動補完)
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normalizeCompanyName, type KindHint } from '../domain/normalizer.js';
import { getToolAnnotations } from '../domain/tool-annotations.js';
import { createSuccessResponse } from '../lib/tool-response.js';

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
  '企業名の表記ゆれ（全角・半角英数字、(株)や株式会社の表記位置、旧字体・異体字、特殊記号、スペース等）を正規化します（ローカル処理）。';

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

const EXPANDABLE_CORPORATE_KIND_HINTS = new Set<KindHint>([
  'kabushiki_kaisha',
  'yugen_kaisha',
  'gomei_kaisha',
  'goshi_kaisha',
  'godo_kaisha',
  'ippan_shadan_hojin',
  'ippan_zaidan_hojin',
  'koueki_shadan_hojin',
  'koueki_zaidan_hojin',
  'npo_hojin',
]);

const OLD_TO_NEW_KANJI: Readonly<Record<string, string>> = {
  髙: '高',
  﨑: '崎',
  齋: '斎',
  齊: '斉',
  濵: '浜',
  濱: '浜',
  德: '徳',
  眞: '真',
  曻: '昇',
  晄: '晃',
  淸: '清',
  廣: '広',
  禮: '礼',
  藪: '薮',
  邉: '辺',
  邊: '辺',
  澤: '沢',
  國: '国',
  團: '団',
  寳: '宝',
  寶: '宝',
  應: '応',
  靑: '青',
  權: '権',
  氣: '気',
  專: '専',
  單: '単',
  學: '学',
  樂: '楽',
  劍: '剣',
  續: '続',
  圖: '図',
  鐵: '鉄',
  齒: '歯',
  歷: '歴',
  藝: '芸',
  戰: '戦',
  驛: '駅',
  檢: '検',
  營: '営',
  舊: '旧',
  醫: '医',
  號: '号',
  獨: '独',
  讀: '読',
  變: '変',
  體: '体',
  會: '会',
  社: '社',
  櫻: '桜',
  栁: '柳',
  壽: '寿',
  榮: '栄',
  實: '実',
  總: '総',
};

function applyOldToNewKanji(text: string): string {
  let out = text;
  for (const [oldChar, newChar] of Object.entries(OLD_TO_NEW_KANJI)) {
    if (out.includes(oldChar)) {
      out = out.split(oldChar).join(newChar);
    }
  }
  return out;
}

export function registerNormalizeCompanyNameTool(server: McpServer): void {
  const annotations = getToolAnnotations('normalize_company_name', 'web-api');

  server.registerTool(
    'normalize_company_name',
    {
      title: annotations.title,
      description: DESCRIPTION_JA,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: {
        title: annotations.title,
        readOnlyHint: annotations.readOnlyHint,
        destructiveHint: annotations.destructiveHint,
        idempotentHint: annotations.idempotentHint,
        openWorldHint: annotations.openWorldHint,
      },
    },
    async (args) => {
      const { raw_name } = args;
      const result = normalizeCompanyName(raw_name);

      const topCandidate = result.normalized_candidates[0];
      const legalType = topCandidate ? (KIND_HINT_TO_LABEL[topCandidate.kind_hint] ?? null) : null;
      const rawCoreName = result.extracted_core_name || raw_name.trim().normalize('NFKC');
      const searchQueryOptimized = applyOldToNewKanji(rawCoreName);

      // (株) などの略称を正式名称に展開した商号を生成（汎用区分ラベルは上書きしない）
      let normalizedName = topCandidate?.name ?? searchQueryOptimized;
      if (
        topCandidate &&
        legalType &&
        rawCoreName &&
        EXPANDABLE_CORPORATE_KIND_HINTS.has(topCandidate.kind_hint)
      ) {
        if (topCandidate.prefix_or_suffix === 'mae_kabu') {
          normalizedName = `${legalType}${rawCoreName}`;
        } else if (topCandidate.prefix_or_suffix === 'ato_kabu') {
          normalizedName = `${rawCoreName}${legalType}`;
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
