/**
 * Prompt: customer-master-dedup
 *
 * 既存の顧客・取引先マスタの社名・住所から、国税庁の公表法人情報と突合して
 * 正式名称・法人番号を特定し、名寄せ・表記ゆれの統一を支援するワークフロー。
 *
 * 根拠 / Source: docs/plan/corp-check-interface-v1.md §2.2
 * - 「名刺」「登記」の語を含まない
 * - 個人の連絡先情報（PII）を入力項目・出力項目から除外
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DataSourceMode } from '../domain/tool-annotations.js';
import {
  NTA_CORPORATE_HOST_ATTRIBUTION,
  NTA_CORPORATE_WEB_API_ATTRIBUTION,
} from '../lib/tool-response.js';

const argsSchema = z.object({
  target_company_name: z
    .string()
    .min(1)
    .max(500)
    .describe('名寄せ対象の会社名 / Target company name for deduplication'),
  current_address: z
    .string()
    .max(300)
    .optional()
    .describe('照合用の住所 / Optional current address for matching'),
});

export function registerCustomerMasterDedupPrompt(
  server: McpServer,
  options?: { dataSource?: DataSourceMode },
): void {
  const corporateAttribution =
    options?.dataSource === 'db'
      ? NTA_CORPORATE_HOST_ATTRIBUTION
      : NTA_CORPORATE_WEB_API_ATTRIBUTION;

  server.registerPrompt(
    'customer-master-dedup',
    {
      title: 'Customer master dedup via NTA corporate number',
      description:
        '既存の顧客・取引先マスタの社名・住所から、国税庁の公表法人情報と突合して正式名称・法人番号を特定し、名寄せ・表記ゆれの統一を支援します。※個人の連絡先情報は入力しないでください。',
      argsSchema: argsSchema.shape,
    },
    (args) => {
      const parsed = argsSchema.parse(args);
      const addressPart = parsed.current_address ? `\n照合用住所: ${parsed.current_address}` : '';

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `以下の取引先情報の社名・住所を国税庁公表情報と突合し、名寄せ・表記ゆれの統一支援を行ってください。

【照合対象】
会社名: ${parsed.target_company_name}${addressPart}

【実行手順】
1. normalize_company_name ツールに対象会社名を渡し、正規化商号（normalized_name）と検索最適化名（search_query_optimized）を取得
2. search_corporate_by_name ツールに search_query_optimized を渡して検索（照合用住所から都道府県が特定できる場合は、JIS X 0401 の2桁コード 01〜47 を prefecture に指定）
3. 候補法人の lookup_corporate_by_number ツールで公表情報を取得し、照合用住所や商号と照らし合わせて同定（address_may_be_outdated が true の場合は住居表示実施による住所表記差の可能性を考慮し、閉鎖法人の場合は successor_corporate_number による承継先の有無も確認）
4. ホスト版またはDBモード利用時、必要に応じて lookup_invoice_issuer（T + 13桁法人番号）で適格請求書発行事業者の公表状態も1件確認
5. 以下の構成で照合結果を出力:
   - 照合判定 (特定完了 / 候補複数・要確認 / 該当なし)
   - 法人番号 (13桁)
   - 公表正式名称 (国税庁公表商号)
   - 本店所在地 (address_may_be_outdated の注記を含む)
   - 法人の状態 (active: 存続中 / closed: 閉鎖等、閉鎖時は承継先法人番号の有無)
   - 表記ゆれの差分（略称展開、旧字体・新字体の差異、住所表記の変更等の指摘）
   - データの時点 (ツールの出力に含まれる data_as_of)
6. 末尾に必ずツールの出力に含まれる attribution（出典表示）をそのまま記載（標準出典文言: ${corporateAttribution}）

【注意事項】
- 個人の連絡先情報（氏名・役職・電話番号・メールアドレス等）は取り扱いません。
- 本機能は名寄せの提案を行うものであり、マスタデータの統合や更新の確定は利用者の判断に基づいて行ってください。
`,
            },
          },
        ],
      };
    },
  );
}
