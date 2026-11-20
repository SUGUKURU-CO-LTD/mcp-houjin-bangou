/**
 * Prompt: invoice-verification-check
 *
 * 受領した請求書・領収書の適格請求書発行事業者登録番号（T番号）・取引年月日・発行元法人名から、
 * 国税庁公表データ上の登録状態・取引日時点の有効性・法人の存続および合併承継状況を一括照合し、
 * 経理・購買業務向けの客観的確認記録を生成するワークフロー。
 *
 * 根拠 / Source:
 * - 「名刺」「登記」の語を含まない
 * - 個人の連絡先情報（PII）を入力項目・出力項目から除外し、個人事業者の氏名・屋号を推測・出力しない
 * - 税理士法第2条・第52条に配慮し、仕入税額控除の可否等の税務判断は行わない
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DataSourceMode } from '../domain/tool-annotations.js';
import { isValidCalendarDate } from '../domain/invoice-number.js';
import {
  INVOICE_TAX_DISCLAIMER,
  NTA_CORPORATE_HOST_ATTRIBUTION,
  NTA_CORPORATE_WEB_API_ATTRIBUTION,
  NTA_INVOICE_HOST_ATTRIBUTION,
} from '../lib/tool-response.js';

const argsSchema = z.object({
  registration_number: z
    .string()
    .regex(
      /^T?[0-9]{13}$/,
      '登録番号は T + 半角数字13桁（または13桁の数字）で指定してください / Must be T + 13 digits',
    )
    .describe(
      "請求書・領収書に記載された適格請求書発行事業者登録番号（例: T9340001026142） / Invoice registration number on the invoice (e.g., 'T9340001026142')",
    ),
  transaction_date: z
    .string()
    .regex(
      /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/,
      '取引年月日は YYYY-MM-DD 形式で指定してください / Transaction date must be in YYYY-MM-DD format',
    )
    .refine((d) => isValidCalendarDate(d), {
      message:
        '実在するカレンダー日付を YYYY-MM-DD 形式で指定してください / Must be a valid calendar date',
    })
    .optional()
    .describe(
      '請求書・領収書の取引年月日（YYYY-MM-DD形式、任意） / Optional transaction date in YYYY-MM-DD format',
    ),
  issuer_name: z
    .string()
    .max(300)
    .optional()
    .describe(
      '請求書に記載された発行元法人名（商号の一致確認用、任意。個人氏名は入力しないでください） / Optional corporate issuer name on the invoice for cross-checking',
    ),
});

export function registerInvoiceVerificationCheckPrompt(
  server: McpServer,
  options?: { dataSource?: DataSourceMode },
): void {
  const corporateAttribution =
    options?.dataSource === 'db'
      ? NTA_CORPORATE_HOST_ATTRIBUTION
      : NTA_CORPORATE_WEB_API_ATTRIBUTION;

  server.registerPrompt(
    'invoice-verification-check',
    {
      title: 'Invoice & corporate verification check for received invoices',
      description:
        '受領した請求書・領収書の適格請求書発行事業者登録番号（T番号）・取引年月日・発行元法人名をもとに、国税庁公表データ上の登録状態と法人の存続・承継状況を一括照合し、確認記録を生成します。※個人の連絡先情報は入力しないでください。',
      argsSchema: argsSchema.shape,
    },
    (args) => {
      const parsed = argsSchema.parse(args);
      const tNumber = parsed.registration_number.startsWith('T')
        ? parsed.registration_number
        : `T${parsed.registration_number}`;
      const digits13 = tNumber.slice(1);
      const dateLine = parsed.transaction_date
        ? `\n取引年月日（基準日）: ${parsed.transaction_date}`
        : '';
      const issuerLine = parsed.issuer_name
        ? `\n請求書記載の発行元法人名: ${parsed.issuer_name}`
        : '';

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `受領した請求書・領収書について、国税庁公表データに基づき適格請求書発行事業者の登録事実および法人の存続状況を照合し、確認記録を作成してください。

【確認対象情報】
登録番号: ${tNumber}${dateLine}${issuerLine}

【実行手順】
1. lookup_invoice_issuer ツールに registration_number="${tNumber}"${parsed.transaction_date ? ` および reference_date="${parsed.transaction_date}"` : ''} を渡して1件照会し、公表データ上の登録状態（status）、事業者区分（business_type）、登録・取消・失効年月日、基準日時点の有効性（was_registered_on_reference_date）を確認する（※ローカル web-api モードで DATA_UNAVAILABLE が返った場合は、ホスト版または DATA_SOURCE=db が必要である旨を案内し、手順2以降の法人照会のみ実施する）
2. 事業者区分が法人（corporation）の場合（または validate_corporate_number で 13桁番号 "${digits13}" の検査用数字が一致し法人である可能性がある場合）、lookup_corporate_by_number ツールに corporate_number="${digits13}" を渡して照会し、法人の状態（active / closed）、閉鎖年月日・閉鎖事由、承継先法人番号（successor_corporate_number）、所在地注記フラグ（address_may_be_outdated）を確認する（承継先法人番号がある場合は承継先も1件照会して社名変更・合併承継の事実を補足する）
3. 発行元法人名が指定されており、かつ事業者区分が個人事業者（individual）でない場合は、normalize_company_name ツールで表記ゆれを正規化し、公表名称（corporate_name / name）との一致・表記差・旧社名の可能性を確認する
4. 以下の構成で客観的な確認記録を整理して提示:
   - 照会した登録番号 (${tNumber})
   - 事業者区分 (法人 / 個人事業者 / 人格のない社団等 / 不明 ※個人事業者の場合は氏名・屋号・所在地は非公表である旨を明記し推測しない)
   - インボイス公表状態 (registered / cancelled / expired / not_found ※not_found は公表データに該当がないことを示し、未登録を確定するものではない旨を明記)
   - 登録年月日・取消年月日・失効年月日 (該当がある項目のみ)
   - 取引年月日時点の登録有効性事実 (取引年月日指定時のみ was_registered_on_reference_date の結果と、取引年月日が data_as_of より後の場合は月次データ未反映期間の注記)
   - 法人の公表情報・存続状態 (法人の場合のみ: 正式名称・本店所在地・active/closed・閉鎖事由・承継先法人番号)
   - 発行元名称との照合結果 (発行元法人名が指定された法人の場合のみ)
   - データの時点 (各ツール出力の data_as_of)
5. 末尾に必ず使用した各ツールの出力に含まれる attribution（出典表示: インボイスは「${NTA_INVOICE_HOST_ATTRIBUTION}」、法人番号は「${corporateAttribution}」）および tax_disclaimer（「${INVOICE_TAX_DISCLAIMER}」）をそのまま記載

【注意事項】
- 個人の連絡先情報（氏名・役職・電話番号・メールアドレス等）や個人事業者の氏名・屋号は取り扱いません。
- 本確認記録は公表データの客観的事実の整理にとどまります。仕入税額控除の可否や経過措置の適用等の税務判断は行わず、個別判断が必要な場合は税理士または所轄税務署へ確認するよう案内してください。
`,
            },
          },
        ],
      };
    },
  );
}
