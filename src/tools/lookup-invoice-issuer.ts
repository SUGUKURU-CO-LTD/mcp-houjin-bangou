/**
 * B5: lookup_invoice_issuer
 * 適格請求書発行事業者の公表事実（登録状態、名称、所在地等）を照会
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1.3, §3.1, §4, §6.1, §6.2 (v1.6 凍結仕様)
 *   実装指示書v1 §5(B5):
 *     - 個人事業者の場合は氏名・屋号・所在地を返却しない
 *     - not_found はエラーではなく status: not_found の正常レスポンスとして返す
 *     - サーバーログに入力された登録番号を記録しない
 *     - 出典表示と税務免責事項を必須で含める
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpLogger } from '../lib/mcp-logger.js';
import { getToolAnnotations, type DataSourceMode } from '../domain/tool-annotations.js';
import {
  createSuccessResponse,
  createErrorResponse,
  type ToolSuccessResponse,
  type ToolErrorResponse,
} from '../lib/tool-response.js';
import type { DbInvoiceDataProvider } from '../repository/invoice-repository.js';

const InputSchema = z
  .object({
    registration_number: z
      .string()
      .regex(
        /^T[0-9]{13}$/,
        '登録番号は T + 半角数字13桁です / Registered invoice number must start with "T" followed by 13 digits',
      )
      .describe(
        "Registered invoice issuer number (starts with 'T' followed by 13 digits, e.g., 'T1234567890123')",
      ),
    reference_date: z
      .string()
      .regex(
        /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/,
        '基準日は YYYY-MM-DD 形式で指定してください / Reference date must be in YYYY-MM-DD format',
      )
      .optional()
      .describe(
        "Optional reference date in 'YYYY-MM-DD' format to check registration status as of that date",
      ),
  })
  .strict();

export type LookupInvoiceIssuerInput = z.infer<typeof InputSchema>;

const OutputSchema = z
  .object({
    registration_number: z.string(),
    status: z.enum(['registered', 'cancelled', 'expired', 'not_found']),
    business_type: z.enum(['corporation', 'individual', 'other', 'unknown']),
    registration_date: z.string().nullable(),
    cancellation_date: z.string().nullable(),
    expiration_date: z.string().nullable(),
    corporate_name: z.string().nullable(),
    location: z.string().nullable(),
    was_registered_on_reference_date: z.boolean().nullable(),
    data_as_of: z
      .string()
      .describe(
        'Date of the public dataset (YYYY-MM-DD; updated monthly with end-of-previous-month snapshot / 月1回、前月末時点の全件データで更新)',
      ),
    attribution: z.string(),
    tax_disclaimer: z.string(),
  })
  .strict();

export type LookupInvoiceIssuerOutput = z.infer<typeof OutputSchema>;

const DESCRIPTION = `適格請求書発行事業者の登録番号（T+13桁）から、国税庁インボイス公表サイトにおける公表事実（登録状態、登録年月日、取消・失効年月日、法人・その他の団体の場合は公表された名称と所在地（その他の団体の所在地は公表データにある場合のみ））を確認します。任意の基準日を指定してその時点での有効性も照会可能です。個人の場合は氏名・屋号を返却せず、税務上の控除判断は行いません。`;

export interface LookupInvoiceIssuerDeps {
  invoiceDbProvider?: DbInvoiceDataProvider;
  dataSource?: DataSourceMode;
  logger: McpLogger;
}

export function registerLookupInvoiceIssuerTool(
  server: McpServer,
  deps: LookupInvoiceIssuerDeps,
): void {
  const isDb =
    deps.dataSource === 'db' || deps.dataSource === 'database' || !!deps.invoiceDbProvider;
  const annotations = getToolAnnotations(
    'lookup_invoice_issuer',
    deps.dataSource ?? (isDb ? 'db' : 'web-api'),
  );

  server.registerTool(
    'lookup_invoice_issuer',
    {
      title: annotations.title,
      description: DESCRIPTION,
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
    async (args): Promise<ToolSuccessResponse<LookupInvoiceIssuerOutput> | ToolErrorResponse> => {
      const startTime = performance.now();

      const parsedArgs = InputSchema.safeParse(args);
      if (!parsedArgs.success) {
        // ログに入力された登録番号は含めない（個人情報保護・設計制約）
        deps.logger.warn('tool_access', {
          tool: 'lookup_invoice_issuer',
          count: 0,
          duration_ms: Math.round(performance.now() - startTime),
          error_type: 'invalid_input',
        });
        return createErrorResponse(
          'INVALID_INPUT',
          `登録番号の入力形式が不正です: ${parsedArgs.error.issues.map((e) => e.message).join(', ')}`,
        );
      }

      const { registration_number, reference_date } = parsedArgs.data;

      if (!deps.invoiceDbProvider) {
        deps.logger.error('tool_access', {
          tool: 'lookup_invoice_issuer',
          duration_ms: Math.round(performance.now() - startTime),
          error_type: 'DATA_UNAVAILABLE',
        });
        return createErrorResponse(
          'DATA_UNAVAILABLE',
          'インボイス公表データプロバイダーが初期化されていません。データベース接続をご確認ください。',
        );
      }

      const result = await deps.invoiceDbProvider.lookupByRegistrationNumber(
        registration_number,
        reference_date,
      );

      if (!result.ok) {
        deps.logger.error('tool_access', {
          tool: 'lookup_invoice_issuer',
          duration_ms: Math.round(performance.now() - startTime),
          error_type: result.error.code,
        });
        return createErrorResponse(result.error.code, result.error.message);
      }

      const val = result.value;

      // ログに入力された登録番号は含めない
      deps.logger.info('tool_access', {
        tool: 'lookup_invoice_issuer',
        count: val.status === 'not_found' ? 0 : 1,
        duration_ms: Math.round(performance.now() - startTime),
      });

      // 要約テキスト（summaryText）の生成
      const summaryLines: string[] = [];

      const businessTypeLabelMap: Record<LookupInvoiceIssuerOutput['business_type'], string> = {
        corporation: '法人',
        individual: '個人事業者',
        other: '人格のない社団等',
        unknown: '不明',
      };
      const businessTypeLabel = businessTypeLabelMap[val.business_type];

      if (val.status === 'not_found') {
        summaryLines.push(
          `指定された登録番号（${registration_number}）に該当する公表データは見つかりませんでした。`,
          '※公表データに該当がないことを示すものであり、未登録であることを確定するものではありません（登録直後で公表データに未反映の可能性があります）。',
        );
      } else if (val.status === 'registered') {
        if (val.business_type === 'individual') {
          summaryLines.push(
            `登録番号: ${registration_number} は、データ時点（${val.data_as_of}）の公表データでは、適格請求書発行事業者として登録されています。`,
            `事業者区分: ${businessTypeLabel}`,
            `登録年月日: ${val.registration_date}`,
          );
        } else {
          summaryLines.push(
            `${val.corporate_name ?? ''}（登録番号: ${registration_number}）は、データ時点（${val.data_as_of}）の公表データでは、適格請求書発行事業者として登録されています。`,
            `事業者区分: ${businessTypeLabel}`,
            `所在地: ${val.location ?? '公表なし'}`,
            `登録年月日: ${val.registration_date}`,
          );
        }
      } else if (val.status === 'cancelled') {
        const namePrefix = val.corporate_name
          ? `${val.corporate_name}（登録番号: ${registration_number}）`
          : `登録番号: ${registration_number}`;
        summaryLines.push(
          `${namePrefix} の適格請求書発行事業者登録は取り消されています。`,
          `事業者区分: ${businessTypeLabel}`,
          `登録年月日: ${val.registration_date}`,
          `取消年月日: ${val.cancellation_date}`,
        );
      } else if (val.status === 'expired') {
        const namePrefix = val.corporate_name
          ? `${val.corporate_name}（登録番号: ${registration_number}）`
          : `登録番号: ${registration_number}`;
        summaryLines.push(
          `${namePrefix} の適格請求書発行事業者登録は失効しています。`,
          `事業者区分: ${businessTypeLabel}`,
          `登録年月日: ${val.registration_date}`,
          `失効年月日: ${val.expiration_date}`,
        );
      }

      // 基準日判定結果の追記
      if (reference_date !== undefined && val.was_registered_on_reference_date !== null) {
        if (val.was_registered_on_reference_date) {
          summaryLines.push(`基準日（${reference_date}）時点で有効な登録事業者でした。`);
        } else {
          summaryLines.push(
            `基準日（${reference_date}）時点では有効な登録事業者ではありませんでした。`,
          );
        }
      }

      // 公表データ共通メタデータ（データ時点と出典）
      summaryLines.push(`データ時点: ${val.data_as_of}`, `出典: ${val.attribution}`);

      // 税務免責事項
      summaryLines.push(val.tax_disclaimer);

      const summaryText = summaryLines.join('\n');

      const structuredContent: LookupInvoiceIssuerOutput = {
        registration_number: val.registration_number,
        status: val.status,
        business_type: val.business_type,
        registration_date: val.registration_date,
        cancellation_date: val.cancellation_date,
        expiration_date: val.expiration_date,
        corporate_name: val.corporate_name,
        location: val.location,
        was_registered_on_reference_date: val.was_registered_on_reference_date,
        data_as_of: val.data_as_of,
        attribution: val.attribution,
        tax_disclaimer: val.tax_disclaimer,
      };

      return createSuccessResponse(summaryText, structuredContent);
    },
  );
}
