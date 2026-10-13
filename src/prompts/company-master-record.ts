/**
 * Prompt: company-master-record
 *
 * 会社名から国税庁公表データを参照して正確な法人情報を特定し、
 * 取引先企業マスタのレコードとして社内データベース等に登録可能な形を生成するワークフロー。
 *
 * 根拠 / Source: docs/plan/corp-check-interface-v1.md §2.1 (v1.4 凍結仕様)
 * - 「名刺」「登記」の語を含まない
 * - 個人の連絡先情報（PII）を入力項目・出力項目から除外
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NTA_CORPORATE_WEB_API_ATTRIBUTION } from '../lib/tool-response.js';

const argsSchema = z.object({
  company_name: z.string().min(1).max(500).describe('対象の会社名・商号 / Target company name'),
  location_hint: z
    .string()
    .max(200)
    .optional()
    .describe(
      '名寄せの絞り込みに用いる都道府県や市区町村 / Optional location hint (prefecture or city)',
    ),
});

export function registerCompanyMasterRecordPrompt(server: McpServer): void {
  server.registerPrompt(
    'company-master-record',
    {
      title: 'Company master record generation from company name',
      description:
        '会社名から法人番号や公表情報を検索・照合し、社内データベース用の取引先企業マスタレコードを生成します。※個人の連絡先情報は入力しないでください。',
      argsSchema: argsSchema.shape,
    },
    (args) => {
      const parsed = argsSchema.parse(args);
      const locationPart = parsed.location_hint
        ? `\n所在地の手がかり: ${parsed.location_hint}`
        : '';

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `次の会社名から公表法人情報を照合し、取引先企業マスタレコードを生成してください。

【対象会社情報】
会社名: ${parsed.company_name}${locationPart}

【実行手順】
1. normalize_company_name ツールに対象会社名を渡し、商号の正規化候補（正式商号や検索用キーワード）を取得
2. search_corporate_by_name ツールで正規化候補を検索（所在地の手がかりがあれば絞り込みの参考に活用）
3. 検索結果から該当する法人の法人番号を特定し、lookup_corporate_by_number ツールで最新の公表情報を照会
4. 以下の構成で取引先企業マスタレコードを提示:
   - 法人番号 (13桁)
   - 商号又は名称 (公表された正式名称)
   - 本店所在地 (都道府県・市区町村・丁目番地)
   - 法人種別 (株式会社、合同会社等)
   - 法人の状態 (active: 存続中 / closed: 閉鎖等)
   - 閉鎖日・閉鎖事由 (閉鎖法人の場合のみ)
   - データの時点 (data_as_of)
5. 末尾に必ず次の出典表示を記載:
   ${NTA_CORPORATE_WEB_API_ATTRIBUTION}

【注意事項】
- 個人の連絡先情報（氏名・役職・電話番号・メールアドレス等）は取り扱いません。
- 同名他社が複数存在する場合は、所在地の手がかり等を参考に候補を絞り込み、特定困難な場合はユーザーに判断を仰いでください。
`,
            },
          },
        ],
      };
    },
  );
}
