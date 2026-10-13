/**
 * 法人番号のチェックデジット計算
 * Corporate number check digit computation
 * Komputasi check digit nomor perusahaan
 *
 * 根拠 / Source / Sumber:
 *   国税庁「法人番号システム Web-API 機能仕様書 第二編 1.2版」
 *   第二編 §2「法人番号を指定して情報を取得する機能」
 *   法人番号 = 13桁 = チェックデジット (1桁) + 基礎番号 (12桁)
 *
 * 計算式:
 *   c = 9 - ( Σ_{n=1}^{12} (P_n × Q_n) mod 9 )
 *   ただし c が 0 のとき c = 9 として扱う
 *
 *   P_n: 12 桁の基礎番号の各桁 (右から 1 桁目を P_1)
 *   Q_n: n が偶数なら 1, 奇数なら 2
 */

/**
 * 12 桁の基礎番号からチェックデジット (1桁) を計算
 * Compute check digit from 12-digit basis number
 * Menghitung check digit dari 12 digit basis
 *
 * 実検証により、P_n は左から n 桁目 (1-indexed) として扱う必要がある。
 * 奇数位置 (n=1,3,5,...) は Q_n=2、偶数位置 (n=2,4,6,...) は Q_n=1。
 * 国税庁公表の check_digit.pdf の計算例 5111101000006 等で検証済み。
 */
export function computeCheckDigit(twelveDigits: string): number {
  if (!/^\d{12}$/.test(twelveDigits)) {
    throw new Error('twelveDigits must be exactly 12 digit characters');
  }
  let sum = 0;
  for (let n = 1; n <= 12; n++) {
    const digitChar = twelveDigits[n - 1];
    if (digitChar === undefined) {
      throw new Error('Unexpected index out of range');
    }
    const digit = Number(digitChar);
    const q = n % 2 === 0 ? 1 : 2;
    sum += digit * q;
  }
  const mod = sum % 9;
  const c = 9 - mod;
  return c === 0 ? 9 : c;
}

/**
 * 13 桁文字列がチェックデジットとして妥当かを検証
 * Verify 13-digit string has a valid check digit
 * Memverifikasi bahwa string 13-digit memiliki check digit valid
 */
export function isValidCheckDigit(thirteenDigits: string): boolean {
  if (!/^\d{13}$/.test(thirteenDigits)) return false;
  const firstChar = thirteenDigits[0];
  if (firstChar === undefined) return false;
  const checkDigit = Number(firstChar);
  if (checkDigit === 0) {
    // 先頭が 0 の場合、チェックデジットとして無効 (1-9)
    return false;
  }
  const basis = thirteenDigits.slice(1);
  return computeCheckDigit(basis) === checkDigit;
}

/**
 * 文字列の正規化 + チェックデジット検証を一括実施
 * Normalize (full-width, hyphens, spaces) + validate check digit
 * Normalisasi lalu verifikasi check digit
 */
export function normalizeAndValidateCorporateNumber(
  raw: string,
): { isValid: true; normalized: string } | { isValid: false; reason: ValidationReason } {
  if (raw.length === 0) {
    return { isValid: false, reason: 'not_13_digits' };
  }

  // 全角数字を半角に、ハイフン/空白を除去
  const normalized = raw
    .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-\u2010-\u2015\u30FC]/g, '');

  if (!/^\d+$/.test(normalized)) {
    return { isValid: false, reason: 'invalid_characters' };
  }
  if (normalized.length !== 13) {
    return { isValid: false, reason: 'not_13_digits' };
  }
  if (normalized[0] === '0') {
    return { isValid: false, reason: 'first_digit_zero' };
  }
  if (!isValidCheckDigit(normalized)) {
    return { isValid: false, reason: 'check_digit_mismatch' };
  }
  return { isValid: true, normalized };
}

export type ValidationReason =
  'not_13_digits' | 'check_digit_mismatch' | 'invalid_characters' | 'first_digit_zero';
