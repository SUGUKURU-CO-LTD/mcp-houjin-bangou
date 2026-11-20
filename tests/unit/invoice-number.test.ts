/**
 * T 番号 (適格請求書発行事業者 登録番号) および暦日検証のテスト
 * 根拠: 第二編 1.5版 2.1.3 + リソース定義書 1.5版 項番8 + SLA2-326 監査決定
 */

import { describe, it, expect } from 'vitest';
import {
  InvoiceNumberSchema,
  normalizeAndValidateInvoiceNumber,
  isValidCalendarDate,
} from '../../src/domain/invoice-number.js';

const VALID_T_NUMBER = 'T8040001999013';
const VALID_T_NUMBER_2 = 'T5111101000006';
const VALID_BASE = '8040001999013';

describe('normalizeAndValidateInvoiceNumber (default: verifyCorporateCheckDigit = false)', () => {
  it('有効な T+13桁を正規化する', () => {
    const result = normalizeAndValidateInvoiceNumber(VALID_T_NUMBER);
    expect(result.isValid).toBe(true);
    if (result.isValid) {
      expect(result.normalized).toBe(VALID_T_NUMBER);
      expect(result.corporateNumberPart).toBe(VALID_BASE);
    }
  });

  it('全角 T (Ｔ) / 小文字 t / 全角数字 / ハイフン区切りを半角 T+13桁に正規化する', () => {
    for (const raw of [
      'Ｔ8040001999013',
      't8040001999013',
      'Ｔ８０４０００１９９９０１３',
      'T-8040-0019-99013',
    ]) {
      const result = normalizeAndValidateInvoiceNumber(raw);
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.normalized).toBe(VALID_T_NUMBER);
      }
    }
  });

  it('個人事業者の登録番号想定: 法人モジュラス9に一致しない T+13桁や先頭0も既定では有効として受け入れる', () => {
    const nonMod9 = normalizeAndValidateInvoiceNumber('T8040001999011');
    expect(nonMod9.isValid).toBe(true);
    if (nonMod9.isValid) {
      expect(nonMod9.normalized).toBe('T8040001999011');
    }

    const leadingZero = normalizeAndValidateInvoiceNumber('T0040001999013');
    expect(leadingZero.isValid).toBe(true);
    if (leadingZero.isValid) {
      expect(leadingZero.normalized).toBe('T0040001999013');
    }
  });

  it('T が無い場合は not_prefixed_with_T', () => {
    const result = normalizeAndValidateInvoiceNumber(VALID_BASE);
    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.reason).toBe('not_prefixed_with_T');
    }
  });

  it('T の後が 12桁または空の場合は not_13_digits_after_T', () => {
    const r1 = normalizeAndValidateInvoiceNumber('T804000199901');
    expect(r1.isValid).toBe(false);
    if (!r1.isValid) {
      expect(r1.reason).toBe('not_13_digits_after_T');
    }

    const r2 = normalizeAndValidateInvoiceNumber('T---');
    expect(r2.isValid).toBe(false);
    if (!r2.isValid) {
      expect(r2.reason).toBe('not_13_digits_after_T');
    }
  });

  it('英字混入は invalid_characters、空文字列は not_prefixed_with_T', () => {
    const r1 = normalizeAndValidateInvoiceNumber('T8abc001999013');
    expect(r1.isValid).toBe(false);
    if (!r1.isValid) {
      expect(r1.reason).toBe('invalid_characters');
    }

    const r2 = normalizeAndValidateInvoiceNumber('');
    expect(r2.isValid).toBe(false);
    if (!r2.isValid) {
      expect(r2.reason).toBe('not_prefixed_with_T');
    }
  });
});

describe('normalizeAndValidateInvoiceNumber ({ verifyCorporateCheckDigit: true })', () => {
  it('法人チェックデジット一致時は有効', () => {
    const result = normalizeAndValidateInvoiceNumber(VALID_T_NUMBER, {
      verifyCorporateCheckDigit: true,
    });
    expect(result.isValid).toBe(true);
    if (result.isValid) {
      expect(result.corporateNumberPart).toBe(VALID_BASE);
    }
  });

  it('チェックデジット不一致は check_digit_mismatch', () => {
    const result = normalizeAndValidateInvoiceNumber('T9040001999013', {
      verifyCorporateCheckDigit: true,
    });
    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.reason).toBe('check_digit_mismatch');
    }
  });

  it('T の直後が 0 は first_digit_zero_after_T', () => {
    const result = normalizeAndValidateInvoiceNumber('T0040001999013', {
      verifyCorporateCheckDigit: true,
    });
    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.reason).toBe('first_digit_zero_after_T');
    }
  });
});

describe('isValidCalendarDate', () => {
  it('実在する暦日（うるう年 2024-02-29 含む）を受け入れる', () => {
    expect(isValidCalendarDate('2023-10-01')).toBe(true);
    expect(isValidCalendarDate('2024-02-29')).toBe(true);
    expect(isValidCalendarDate('2026-11-30')).toBe(true);
  });

  it('存在しない暦日（2026-02-29, 2026-02-31, 2026-04-31 等）や不正形式を拒否する', () => {
    expect(isValidCalendarDate('2026-02-29')).toBe(false);
    expect(isValidCalendarDate('2026-02-31')).toBe(false);
    expect(isValidCalendarDate('2026-04-31')).toBe(false);
    expect(isValidCalendarDate('2026-13-01')).toBe(false);
    expect(isValidCalendarDate('2026-00-10')).toBe(false);
    expect(isValidCalendarDate('2026-01-00')).toBe(false);
    expect(isValidCalendarDate('2026/10/01')).toBe(false);
    expect(isValidCalendarDate('')).toBe(false);
  });
});

describe('InvoiceNumberSchema (Zod)', () => {
  it('有効な T番号を受け入れる', () => {
    expect(InvoiceNumberSchema.safeParse(VALID_T_NUMBER).success).toBe(true);
    expect(InvoiceNumberSchema.safeParse(VALID_T_NUMBER_2).success).toBe(true);
    expect(InvoiceNumberSchema.safeParse('T1040001999013').success).toBe(true);
  });

  it('形式エラーを拒否する', () => {
    expect(InvoiceNumberSchema.safeParse(VALID_BASE).success).toBe(false);
    expect(InvoiceNumberSchema.safeParse('T80400019990130').success).toBe(false);
    expect(InvoiceNumberSchema.safeParse('T804000199901A').success).toBe(false);
  });
});
