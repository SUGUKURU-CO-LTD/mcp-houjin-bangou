/**
 * 適格請求書発行事業者 登録番号 (T+13桁) の Branded Type
 * Qualified Invoice Issuer Registration Number (T + 13 digits)
 * Nomor Registrasi Penerbit Invoice Berkualifikasi (T + 13 digit)
 *
 * 根拠 / Source:
 *   国税庁 第二編 1.5版 2.1.3 条件: 登録番号は "T"＋13桁
 *   国税庁 リソース定義書 1.5版 別紙1 項番8: "T"+9999999999999 (14桁)
 *
 * T の次の 13 桁は法人番号 (法人の場合) または 個人事業主の識別番号 (個人の場合) である。
 * 法人番号部分についてはチェックデジット検証が可能だが、個人の識別番号については
 * 一次資料にチェックデジットの定義がないため、lookup_invoice_issuer の入力検証は
 * 形式照合 (^T\d{13}$) のみを行う (SLA2-326 監査決定)。
 */

import { z } from 'zod';
import { normalizeAndValidateCorporateNumber } from './check-digit.js';

/**
 * "T" + 13桁の登録番号 (Branded type)
 * Registered number: literal "T" prefix + 13-digit base
 *
 * 根拠 / Source:
 *   国税庁 適格請求書発行事業者公表システム「リソース定義書 1.5版」別紙1 項番8: "T"+9999999999999 (14桁)
 *   ※ 一次資料において個人の登録番号のチェックデジット定義は存在しないため、
 *      形式検証（^T\d{13}$）のみを行う。
 */
export const InvoiceNumberSchema = z
  .string()
  .regex(/^T\d{13}$/, '登録番号は T + 半角数字13桁です / Must be "T" + 13 half-width digits')
  .brand<'InvoiceNumber'>();

export type InvoiceNumber = z.infer<typeof InvoiceNumberSchema>;

export type InvoiceValidationReason =
  | 'not_prefixed_with_T'
  | 'not_13_digits_after_T'
  | 'check_digit_mismatch'
  | 'invalid_characters'
  | 'first_digit_zero_after_T';

export interface InvoiceValidationOk {
  isValid: true;
  normalized: string;
  corporateNumberPart: string;
}

export interface InvoiceValidationError {
  isValid: false;
  reason: InvoiceValidationReason;
}

export type InvoiceValidationResult = InvoiceValidationOk | InvoiceValidationError;

export interface NormalizeInvoiceNumberOptions {
  /**
   * true の場合、T 以降の 13 桁に対して法人番号のモジュラス9チェックデジットおよび先頭非ゼロ検証を行う。
   * 個人事業者の登録番号は一次資料にチェックデジット計算式の定義がないため、既定値は false（^T\d{13}$ 形式検証のみ）。
   */
  verifyCorporateCheckDigit?: boolean;
}

const ISO_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * YYYY-MM-DD 文字列が実在する暦日であるかを厳密検証する（例: 2026-02-31 や 2026-04-31 を拒否）
 */
export function isValidCalendarDate(dateStr: string): boolean {
  const match = ISO_DATE_REGEX.exec(dateStr);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * T番号文字列の正規化 + 形式検証（オプションで法人番号チェックデジット検証）
 *
 * 入力は以下を許容:
 * - `T1234567890123` (半角)
 * - `ｔ1234567890123` (全角 t)
 * - `T-1234-5678-90123` (ハイフン区切り)
 * - `Ｔ１２３４５６７８９０１２３` (全角 T + 全角数字)
 *
 * @param raw 検証対象の文字列
 * @param options verifyCorporateCheckDigit=true 指定時のみ法人番号モジュラス9を検証（既定: false）
 */
export function normalizeAndValidateInvoiceNumber(
  raw: string,
  options?: NormalizeInvoiceNumberOptions,
): InvoiceValidationResult {
  if (raw.length === 0) {
    return { isValid: false, reason: 'not_prefixed_with_T' };
  }

  // 全角 T/t を半角 T に、全角数字を半角数字に
  const normalizedT = raw
    .replace(/[\uFF34\uFF54]/g, 'T') // Ｔ (U+FF34), ｔ (U+FF54)
    .replace(/^[tT]/, 'T')
    .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));

  if (!normalizedT.startsWith('T')) {
    return { isValid: false, reason: 'not_prefixed_with_T' };
  }

  const afterT = normalizedT.slice(1);

  if (options?.verifyCorporateCheckDigit === true) {
    // 法人限定でモジュラス9チェックデジットまで検証する場合
    const cnResult = normalizeAndValidateCorporateNumber(afterT);
    if (!cnResult.isValid) {
      const mapReason: Record<typeof cnResult.reason, InvoiceValidationReason> = {
        not_13_digits: 'not_13_digits_after_T',
        check_digit_mismatch: 'check_digit_mismatch',
        invalid_characters: 'invalid_characters',
        first_digit_zero: 'first_digit_zero_after_T',
      };
      return { isValid: false, reason: mapReason[cnResult.reason] };
    }

    return {
      isValid: true,
      normalized: `T${cnResult.normalized}`,
      corporateNumberPart: cnResult.normalized,
    };
  }

  // 既定: 個人事業者の登録番号も包含できるよう、ハイフン・空白除去後に 13桁数字形式のみを検証 (SLA2-326)
  const cleanedDigits = afterT.replace(/[\s\-\u2010-\u2015\u30FC]/g, '');
  if (cleanedDigits.length === 0) {
    return { isValid: false, reason: 'not_13_digits_after_T' };
  }
  if (!/^\d+$/.test(cleanedDigits)) {
    return { isValid: false, reason: 'invalid_characters' };
  }
  if (cleanedDigits.length !== 13) {
    return { isValid: false, reason: 'not_13_digits_after_T' };
  }

  return {
    isValid: true,
    normalized: `T${cleanedDigits}`,
    corporateNumberPart: cleanedDigits,
  };
}
