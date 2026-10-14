/**
 * Invoice Issuer Data Provider Interface & Database Implementation
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1.3, §3.1, §4, §6.1, §6.2 (v1.6 凍結仕様)
 *   実装指示書v1 §5(B5):
 *     - インボイス公表データの登録番号 (T+13桁) から公表事実（登録状態、登録日、取消・失効日、法人等の名称・所在地）を確認
 *     - 個人事業者の場合は氏名・屋号・所在地を返却しない
 *     - not_found は status: not_found で返し、エラーコード NOT_FOUND は使用しない
 *     - 税理士法に配慮し、税務免責事項 (tax_disclaimer) を必須で返却
 */

import { eq, and, desc } from 'drizzle-orm';
import type { DbClient } from '../db/client.js';
import { datasetVersions, invoiceIssuers } from '../db/schema.js';
import { Result } from '../lib/result.js';
import { NTA_INVOICE_HOST_ATTRIBUTION, INVOICE_TAX_DISCLAIMER } from '../lib/tool-response.js';

export type InvoiceIssuerStatus = 'registered' | 'cancelled' | 'expired' | 'not_found';
export type InvoiceBusinessType = 'corporation' | 'individual' | 'other' | 'unknown';

export interface LookupInvoiceIssuerResult {
  registration_number: string;
  status: InvoiceIssuerStatus;
  business_type: InvoiceBusinessType;
  registration_date: string | null;
  cancellation_date: string | null;
  expiration_date: string | null;
  corporate_name: string | null;
  location: string | null;
  was_registered_on_reference_date: boolean | null;
  data_as_of: string;
  attribution: string;
  tax_disclaimer: string;
}

export interface InvoiceError {
  code: 'INVALID_INPUT' | 'DATA_UNAVAILABLE' | 'INTERNAL_ERROR';
  message: string;
}

export interface InvoiceDataProvider {
  readonly mode: 'db';
  lookupByRegistrationNumber(
    registrationNumber: string,
    referenceDate?: string,
  ): Promise<Result<LookupInvoiceIssuerResult, InvoiceError>>;
}

/**
 * ホスト版: 自社 PostgreSQL データベースから公表インボイス事業者情報を検索・取得するプロバイダー
 */
export class DbInvoiceDataProvider implements InvoiceDataProvider {
  readonly mode = 'db' as const;

  constructor(private db: DbClient) {}

  /**
   * 現在 active な最新のインボイスデータセットバージョンを取得
   */
  private async getActiveVersion(): Promise<{ id: number; dataAsOf: string } | null> {
    const versions = await this.db
      .select({ id: datasetVersions.id, dataAsOf: datasetVersions.dataAsOf })
      .from(datasetVersions)
      .where(
        and(
          eq(datasetVersions.sourceType, 'nta_invoice_download'),
          eq(datasetVersions.status, 'active'),
        ),
      )
      .orderBy(desc(datasetVersions.importedAt))
      .limit(1);

    const first = versions[0];
    return first ?? null;
  }

  async lookupByRegistrationNumber(
    registrationNumber: string,
    referenceDate?: string,
  ): Promise<Result<LookupInvoiceIssuerResult, InvoiceError>> {
    try {
      const activeVersion = await this.getActiveVersion();
      if (!activeVersion) {
        return Result.err({
          code: 'DATA_UNAVAILABLE',
          message: 'Active invoice dataset not found in database',
        });
      }

      // 該当の登録番号の全履歴レコード（最新行 latest='1' および 過去履歴 latest='0'）を取得
      const rows = await this.db
        .select()
        .from(invoiceIssuers)
        .where(
          and(
            eq(invoiceIssuers.registrationNumber, registrationNumber),
            eq(invoiceIssuers.datasetVersionId, activeVersion.id),
          ),
        );

      // 1. レコードが存在しない場合 (not_found)
      // ※ docs/plan/corp-check-interface-v1.md §4 注記:
      //   lookup_invoice_issuer は status: not_found で返すため、エラーではなく正常レスポンスとする
      if (rows.length === 0) {
        return Result.ok({
          registration_number: registrationNumber,
          status: 'not_found',
          business_type: 'unknown',
          registration_date: null,
          cancellation_date: null,
          expiration_date: null,
          corporate_name: null,
          location: null,
          was_registered_on_reference_date: referenceDate !== undefined ? false : null,
          data_as_of: activeVersion.dataAsOf,
          attribution: NTA_INVOICE_HOST_ATTRIBUTION,
          tax_disclaimer: INVOICE_TAX_DISCLAIMER,
        });
      }

      const latestRow = rows.find((r) => r.latest === '1') ?? rows[0];
      if (!latestRow) {
        return Result.err({
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve invoice issuer row',
        });
      }

      // 登録状態の判定
      let status: InvoiceIssuerStatus;
      if (latestRow.cancelDate && latestRow.cancelDate.trim() !== '') {
        status = 'cancelled';
      } else if (latestRow.expireDate && latestRow.expireDate.trim() !== '') {
        status = 'expired';
      } else {
        status = 'registered';
      }

      // 事業者区分の判定
      // kind='1': 個人
      // kind='2': 法人（人格のない社団等を含む）
      //   - 本店所在地がなく公表申出所在地がある場合: other（人格のない社団等）
      //   - それ以外: corporation（法人）
      let businessType: InvoiceBusinessType;
      if (latestRow.kind === '1') {
        businessType = 'individual';
      } else if (latestRow.kind === '2') {
        if (!latestRow.headOfficeAddress && latestRow.declaredAddress) {
          businessType = 'other';
        } else {
          businessType = 'corporation';
        }
      } else {
        businessType = 'unknown';
      }

      // 名称・所在地の取得（個人事業者の場合は公表・返却しない）
      const isIndividual = latestRow.kind === '1';
      const corporateName = isIndividual ? null : (latestRow.legalName ?? null);

      let location: string | null = null;
      if (!isIndividual) {
        location =
          latestRow.headOfficeAddress ??
          latestRow.declaredAddress ??
          latestRow.domesticOfficeAddress ??
          null;
      }

      // 基準日時点の有効性判定 (was_registered_on_reference_date)
      // 仕様: on or after registration_date, and before cancellation/expiration dates
      let wasRegisteredOnReferenceDate: boolean | null = null;
      if (referenceDate !== undefined) {
        const regDate = latestRow.registrationDate;
        const cancelDate =
          latestRow.cancelDate && latestRow.cancelDate.trim() !== '' ? latestRow.cancelDate : null;
        const expireDate =
          latestRow.expireDate && latestRow.expireDate.trim() !== '' ? latestRow.expireDate : null;

        const isAfterOrOnReg = referenceDate >= regDate;
        const isBeforeCancel = cancelDate === null || referenceDate < cancelDate;
        const isBeforeExpire = expireDate === null || referenceDate < expireDate;

        wasRegisteredOnReferenceDate = isAfterOrOnReg && isBeforeCancel && isBeforeExpire;
      }

      return Result.ok({
        registration_number: latestRow.registrationNumber,
        status,
        business_type: businessType,
        registration_date: latestRow.registrationDate,
        cancellation_date:
          latestRow.cancelDate && latestRow.cancelDate.trim() !== '' ? latestRow.cancelDate : null,
        expiration_date:
          latestRow.expireDate && latestRow.expireDate.trim() !== '' ? latestRow.expireDate : null,
        corporate_name: corporateName,
        location,
        was_registered_on_reference_date: wasRegisteredOnReferenceDate,
        data_as_of: activeVersion.dataAsOf,
        attribution: NTA_INVOICE_HOST_ATTRIBUTION,
        tax_disclaimer: INVOICE_TAX_DISCLAIMER,
      });
    } catch (err) {
      return Result.err({
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Database error occurred',
      });
    }
  }
}
