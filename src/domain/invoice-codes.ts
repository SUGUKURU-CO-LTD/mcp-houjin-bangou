/**
 * 適格請求書発行事業者公表システム コード辞書
 * Code dictionaries for the Invoice Issuer Publication System
 *
 * 根拠 / Source:
 *   国税庁 適格請求書発行事業者公表システム「リソース定義書（全件データ・差分データ）1.5版」（令和6年5月改訂）
 *   URL: https://www.invoice-kohyo.nta.go.jp/files/k-resource-dl.pdf
 *   ダウンロードページ: https://www.invoice-kohyo.nta.go.jp/download/index.html （確認日: 2026-10-14）
 *   項番9 事業者処理区分 / 項番10 訂正区分 / 項番11 人格区分 / 項番12 国内外区分 / 項番13 最新履歴
 */

/**
 * 事業者処理区分 (process) — リソース定義書 項番9
 */
export const INVOICE_PROCESS_CODES = {
  '01': { ja: '新規 (登録)', en: 'Newly registered' },
  '02': { ja: '公表内容の変更', en: 'Publication content changed' },
  '03': { ja: '登録の失効', en: 'Registration expired' },
  '04': { ja: '登録の取消', en: 'Registration cancelled' },
  '99': { ja: '削除', en: 'Deleted (差分データのみ)' },
} as const;

export type InvoiceProcessCode = keyof typeof INVOICE_PROCESS_CODES;

export function isInvoiceProcessCode(value: string): value is InvoiceProcessCode {
  return Object.prototype.hasOwnProperty.call(INVOICE_PROCESS_CODES, value);
}

export function invoiceProcessLabel(code: string, lang: 'ja' | 'en' = 'ja'): string {
  if (isInvoiceProcessCode(code)) {
    return INVOICE_PROCESS_CODES[code][lang];
  }
  return `unknown(${code})`;
}

/**
 * 人格区分 (kind) — リソース定義書 項番11
 */
export const INVOICE_KIND_CODES = {
  '1': { ja: '個人', en: 'Individual (sole proprietor)' },
  '2': {
    ja: '法人 (人格のない社団等を含む)',
    en: 'Corporation (incl. unincorporated association)',
  },
} as const;

export type InvoiceKindCode = keyof typeof INVOICE_KIND_CODES;

export function isInvoiceKindCode(value: string): value is InvoiceKindCode {
  return value === '1' || value === '2';
}

export function invoiceKindLabel(code: string, lang: 'ja' | 'en' = 'ja'): string {
  if (isInvoiceKindCode(code)) {
    return INVOICE_KIND_CODES[code][lang];
  }
  return `unknown(${code})`;
}

/**
 * 国内外区分 (country) — リソース定義書 項番12
 */
export const INVOICE_COUNTRY_CODES = {
  '1': { ja: '国内事業者', en: 'Domestic business' },
  '2': { ja: '特定国外事業者', en: 'Specified foreign business' },
  '3': { ja: '特定国外事業者以外の国外事業者', en: 'Other foreign business' },
} as const;

export type InvoiceCountryCode = keyof typeof INVOICE_COUNTRY_CODES;

export function isInvoiceCountryCode(value: string): value is InvoiceCountryCode {
  return value === '1' || value === '2' || value === '3';
}

export function invoiceCountryLabel(code: string, lang: 'ja' | 'en' = 'ja'): string {
  if (isInvoiceCountryCode(code)) {
    return INVOICE_COUNTRY_CODES[code][lang];
  }
  return `unknown(${code})`;
}

/**
 * 最新履歴 (latest) — リソース定義書 項番13
 */
export const INVOICE_LATEST_CODES = {
  '0': { ja: '過去情報', en: 'Past information' },
  '1': { ja: '最新情報', en: 'Latest information' },
} as const;

export type InvoiceLatestCode = keyof typeof INVOICE_LATEST_CODES;

export function isInvoiceLatestCode(value: string): value is InvoiceLatestCode {
  return value === '0' || value === '1';
}

/**
 * 応答形式 (type) — 第二編 2.1.3 条件
 * 注意: 法人番号 API と値が異なる (01=CSV, 11=XML, 21=JSON)
 */
export const INVOICE_RESPONSE_TYPES = {
  '01': { format: 'CSV', encoding: 'UTF-8' },
  '11': { format: 'XML', encoding: 'UTF-8' },
  '21': { format: 'JSON', encoding: 'UTF-8' },
} as const;

export type InvoiceResponseType = keyof typeof INVOICE_RESPONSE_TYPES;

export function isInvoiceResponseType(value: string): value is InvoiceResponseType {
  return value === '01' || value === '11' || value === '21';
}

/**
 * 訂正区分 (correct) — リソース定義書 項番10
 * Web-API 機能では常に「0」(訂正以外) が設定される (§2.3.1 参照)
 * 差分データの場合のみ「1」(訂正) もあり得る
 */
export const INVOICE_CORRECT_CODES = {
  '0': { ja: '訂正以外', en: 'Not corrected' },
  '1': { ja: '訂正', en: 'Corrected' },
} as const;

export type InvoiceCorrectCode = keyof typeof INVOICE_CORRECT_CODES;

export function isInvoiceCorrectCode(value: string): value is InvoiceCorrectCode {
  return value === '0' || value === '1';
}

/**
 * 差分 API で使う人格区分パラメータ (division) — 第二編 3.1.3
 * 法人番号 API の `kind` パラメータとは別物に注意
 */
export const INVOICE_DIVISION_PARAMS = {
  '1': { ja: '個人', en: 'Individual' },
  '2': { ja: '法人', en: 'Corporation' },
} as const;

export type InvoiceDivisionParam = keyof typeof INVOICE_DIVISION_PARAMS;
