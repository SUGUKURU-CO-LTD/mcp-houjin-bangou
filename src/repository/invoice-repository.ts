/**
 * Invoice Issuer Data Provider Interface & Database Implementation
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1.3, §3.1, §4, §6.1, §6.2 (v1.9 凍結仕様)
 *   実装指示書v1 §5(B5):
 *     - インボイス公表データの登録番号 (T+13桁) から公表事実（登録状態、登録日、取消・失効日、法人等の名称・所在地）を確認
 *     - 個人事業者および人格区分不明行の場合は氏名・屋号・所在地を返却しない（kind='2' のみ許可）
 *     - 処理区分 '99'（削除）は not_found として扱う
 *     - not_found は status: not_found で返し、エラーコード NOT_FOUND は使用しない
 *     - DB エラー時に SQL 文やバインドパラメータ（登録番号等）をクライアントやログに漏洩しない
 *     - 税理士法に配慮し、税務免責事項 (tax_disclaimer) を必須で返却
 */

import { eq, and, desc } from 'drizzle-orm';
import type { DbClient } from '../db/client.js';
import { datasetVersions, invoiceIssuers } from '../db/schema.js';
import { Result } from '../lib/result.js';
import { formatErrorWithCause } from '../lib/errors.js';
import { NTA_INVOICE_HOST_ATTRIBUTION, INVOICE_TAX_DISCLAIMER } from '../lib/tool-response.js';
import { isTimeoutError } from './corporate-repository.js';

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

function writeRepositoryErrorLog(operation: string, err: unknown): void {
  const errorType = err instanceof Error ? err.name : 'UnknownError';
  const msg = formatErrorWithCause(err);
  process.stderr.write(
    JSON.stringify({
      level: 'error',
      severity: 'ERROR',
      time: new Date().toISOString(),
      logger: 'invoice_repository',
      operation,
      error_type: errorType,
      msg,
    }) + '\n',
  );
}

function buildNotFoundResult(
  registrationNumber: string,
  dataAsOf: string,
): LookupInvoiceIssuerResult {
  return {
    registration_number: registrationNumber,
    status: 'not_found',
    business_type: 'unknown',
    registration_date: null,
    cancellation_date: null,
    expiration_date: null,
    corporate_name: null,
    location: null,
    was_registered_on_reference_date: null,
    data_as_of: dataAsOf,
    attribution: NTA_INVOICE_HOST_ATTRIBUTION,
    tax_disclaimer: INVOICE_TAX_DISCLAIMER,
  };
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
      if (rows.length === 0) {
        return Result.ok(buildNotFoundResult(registrationNumber, activeVersion.dataAsOf));
      }

      // 一連番号（sequenceNumber）を数値として昇順ソート（varchar だと '10' が '9' より前になるのを防ぐ）
      const sortedRows = [...rows].sort(
        (a, b) => Number(a.sequenceNumber ?? 0) - Number(b.sequenceNumber ?? 0),
      );

      const latestRow =
        sortedRows.find((r) => r.latest === '1') ?? sortedRows[sortedRows.length - 1];
      if (!latestRow) {
        return Result.err({
          code: 'INTERNAL_ERROR',
          message: 'データベースで予期しないエラーが発生しました。時間をおいて再試行してください。',
        });
      }

      // 2. 事業者処理区分 '99'（削除: 登録自体がなかったものとして効力を失ったレコード）は該当なし扱い
      if (latestRow.process === '99') {
        return Result.ok(buildNotFoundResult(registrationNumber, activeVersion.dataAsOf));
      }

      // 登録状態の判定（process='04'取消 / '03'失効 と日付の整合性を考慮）
      const hasCancel = Boolean(latestRow.cancelDate && latestRow.cancelDate.trim() !== '');
      const hasExpire = Boolean(latestRow.expireDate && latestRow.expireDate.trim() !== '');
      let status: InvoiceIssuerStatus;
      if (latestRow.process === '03' && hasExpire) {
        status = 'expired';
      } else if (latestRow.process === '04' && hasCancel) {
        status = 'cancelled';
      } else if (hasCancel) {
        status = 'cancelled';
      } else if (hasExpire) {
        status = 'expired';
      } else {
        status = 'registered';
      }

      // 事業者区分の判定
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

      // 名称・所在地の取得（厳格な許可リスト方式: kind === '2' の場合のみ公開し、個人・区分不明は常に null）
      const canExposeIdentity = latestRow.kind === '2';
      const corporateName = canExposeIdentity ? (latestRow.legalName ?? null) : null;

      let location: string | null = null;
      if (canExposeIdentity) {
        location =
          latestRow.headOfficeAddress ??
          latestRow.declaredAddress ??
          latestRow.domesticOfficeAddress ??
          null;
      }

      // 基準日時点の有効性判定 (was_registered_on_reference_date)
      // 履歴行（削除行 process='99' を除く）を登録年月日ごとにまとめ、各まとまりの最後の行の取消・失効年月日で登録期間を作る。
      let wasRegisteredOnReferenceDate: boolean | null = null;
      if (referenceDate !== undefined) {
        const periods: Array<{
          registrationDate: string;
          cancelDate: string | null;
          expireDate: string | null;
        }> = [];

        const groups = new Map<string, typeof sortedRows>();
        for (const row of sortedRows) {
          if (row.process === '99') continue;
          const regDate = row.registrationDate?.trim();
          if (!regDate) continue;
          const group = groups.get(regDate) ?? [];
          group.push(row);
          groups.set(regDate, group);
        }

        for (const [regDate, groupRows] of groups.entries()) {
          const lastGroupRow = groupRows[groupRows.length - 1];
          const cancelDate =
            lastGroupRow?.cancelDate && lastGroupRow.cancelDate.trim() !== ''
              ? lastGroupRow.cancelDate.trim()
              : null;
          const expireDate =
            lastGroupRow?.expireDate && lastGroupRow.expireDate.trim() !== ''
              ? lastGroupRow.expireDate.trim()
              : null;
          periods.push({
            registrationDate: regDate,
            cancelDate,
            expireDate,
          });
        }

        if (periods.length === 0) {
          wasRegisteredOnReferenceDate = null;
        } else {
          wasRegisteredOnReferenceDate = periods.some((period) => {
            const isAfterOrOnReg = referenceDate >= period.registrationDate;
            const isBeforeCancel = period.cancelDate === null || referenceDate < period.cancelDate;
            const isBeforeExpire = period.expireDate === null || referenceDate < period.expireDate;
            return isAfterOrOnReg && isBeforeCancel && isBeforeExpire;
          });
        }
      }

      return Result.ok({
        registration_number: latestRow.registrationNumber,
        status,
        business_type: businessType,
        registration_date:
          latestRow.registrationDate && latestRow.registrationDate.trim() !== ''
            ? latestRow.registrationDate.trim()
            : null,
        cancellation_date:
          latestRow.cancelDate && latestRow.cancelDate.trim() !== ''
            ? latestRow.cancelDate.trim()
            : null,
        expiration_date:
          latestRow.expireDate && latestRow.expireDate.trim() !== ''
            ? latestRow.expireDate.trim()
            : null,
        corporate_name: corporateName,
        location,
        was_registered_on_reference_date: wasRegisteredOnReferenceDate,
        data_as_of: activeVersion.dataAsOf,
        attribution: NTA_INVOICE_HOST_ATTRIBUTION,
        tax_disclaimer: INVOICE_TAX_DISCLAIMER,
      });
    } catch (err) {
      if (isTimeoutError(err)) {
        return Result.err({
          code: 'DATA_UNAVAILABLE',
          message: 'データベースの検索が上限時間を超過しました。時間をおいて再試行してください。',
        });
      }
      writeRepositoryErrorLog('lookupByRegistrationNumber', err);
      return Result.err({
        code: 'INTERNAL_ERROR',
        message: 'データベースで予期しないエラーが発生しました。時間をおいて再試行してください。',
      });
    }
  }
}
