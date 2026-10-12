/**
 * Prompt: sales-list-enrichment
 *
 * 企業名のリストから法人番号・所在地・法人種別を一括検索し、
 * 企業リストを補完するワークフロー（1回あたり最大20社）。
 *
 * 根拠 / Source: docs/plan/corp-check-interface-v1.md §2.3 (v1.4 凍結仕様)
 * - 1回あたり最大20社。21社以上はエラー
 * - 「名刺」「登記」の語を含まない
 * - 個人の連絡先情報（PII）を入力項目・出力項目から除外
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NTA_CORPORATE_WEB_API_ATTRIBUTION } from '../lib/tool-response.js';

export function parseCompanyList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const argsSchema = z.object({
  company_list_text: z
    .string()
    .min(1, '企業名リストを入力してください / company_list_text must not be empty')
    .refine(
      (text: string) => parseCompanyList(text).length <= 20,
      {
        message: '一度に指定できる企業数は最大20社です。 / Maximum 20 companies allowed per request.',
      },
    )
    .describe('企業名一覧。1行に1社、最大20社 / Company name list (one per line, max 20)'),
});

export function registerSalesListEnrichmentPrompt(server: McpServer): void {
  server.registerPrompt(
    'sales-list-enrichment',
    {
      title: 'Bulk sales list enrichment via NTA corporate number (max 20 companies)',
      description:
        '企業名のリストから法人番号・所在地・法人種別を一括検索し、企業リストを補完します（1回あたり最大20社）。※個人の連絡先情報は入力しないでください。',
      argsSchema: argsSchema.shape,
    },
    (args) => {
      const parsed = argsSchema.parse(args);
      const companies = parseCompanyList(parsed.company_list_text);

      if (companies.length === 0) {
        throw new Error('有効な企業名が指定されていません。1行に1社入力してください。 / No valid company names provided.');
      }
      if (companies.length > 20) {
        throw new Error(
          `一度に指定できる企業数は最大20社です。現在${companies.length}社指定されています。 / Maximum 20 companies allowed per request (received ${companies.length}).`,
        );
      }

      const formattedList = companies.map((c, i) => `${i + 1}. ${c}`).join('\n');

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `以下の企業名リスト（全${companies.length}社、最大20社）を国税庁公表サイトの情報で補完し、企業リストを作成してください。

【対象企業名一覧】
${formattedList}

【実行手順】
1. リストの各企業名について順次実行:
   a. normalize_company_name ツールで商号を正規化
   b. search_corporate_by_name ツールで法人番号を検索
   c. 該当する法人の公表情報を取得（必要に応じて lookup_corporate_by_number ツールで詳細照会）
2. 以下の構成の一覧表（マークダウン形式）で出力:
   - 入力企業名
   - 法人番号 (13桁)
   - 公表正式名称
   - 本店所在地
   - 法人種別
   - 法人の状態 (active / closed)
   - 補完結果ステータス (特定完了 / 候補複数・要確認 / 該当なし)
   - データの時点 (data_as_of)
3. 末尾に必ず次の出典表示を記載:
   ${NTA_CORPORATE_WEB_API_ATTRIBUTION}

【注意事項】
- 個人の連絡先情報（氏名・役職・電話番号・メールアドレス等）は取り扱いません。
- 1回あたり最大20社まで対応しています。
`,
            },
          },
        ],
      };
    },
  );
}
