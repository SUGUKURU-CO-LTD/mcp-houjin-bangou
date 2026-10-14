/**
 * T 番号 (適格請求書発行事業者 登録番号) のテスト
 * 根拠: 第二編 1.5版 2.1.3 + リソース定義書 1.5版 項番8
 */

import { describe, it, expect } from 'vitest';
import {
  InvoiceNumberSchema,
  normalizeAndValidateInvoiceNumber,
} from '../../src/domain/invoice-number.js';

/**
 * 注意: 仕様書 (第二編) のサンプル番号 T8040001999011 は架空番号で、
 * チェックデジットが実際の計算式 (9 - Σ(P_n×Q_n) mod 9) と一致しない。
 * 本テストでは実在する有効な法人番号 + T プレフィックスを使用する:
 *   - 8040001999013 (第二編 法人番号 §2.3 サンプル、実在する有効番号)
 *   - 5111101000006 (国土交通省の法人番号)
 */
const VALID_T_NUMBER = 'T8040001999013';
const VALID_T_NUMBER_2 = 'T5111101000006';
const VALID_BASE = '8040001999013';

describe('normalizeAndValidateInvoiceNumber', () => {
  it('有効な T+13桁を正規化する', () => {
    const result = normalizeAndValidateInvoiceNumber(VALID_T_NUMBER);
    expect(result.isValid).toBe(true);
    if (result.isValid) {
      expect(result.normalized).toBe(VALID_T_NUMBER);
      expect(result.corporateNumberPart).toBe(VALID_BASE);
    }
  });

  it('全角 T (Ｔ) を半角に正規化', () => {
    const result = normalizeAndValidateInvoiceNumber('Ｔ8040001999013');
    expect(result.isValid).toBe(true);
    if (result.isValid) {
      expect(result.normalized).toBe(VALID_T_NUMBER);
    }
  });

  it('小文字 t を大文字 T に正規化', () => {
    const result = normalizeAndValidateInvoiceNumber('t8040001999013');
    expect(result.isValid).toBe(true);
    if (result.isValid) {
      expect(result.normalized).toBe(VALID_T_NUMBER);
    }
  });

  it('全角数字を含む T番号を正規化', () => {
    const result = normalizeAndValidateInvoiceNumber('Ｔ８０４０００１９９９０１３');
    expect(result.isValid).toBe(true);
    if (result.isValid) {
      expect(result.normalized).toBe(VALID_T_NUMBER);
    }
  });

  it('ハイフン区切りを正規化', () => {
    const result = normalizeAndValidateInvoiceNumber('T-8040-0019-99013');
    expect(result.isValid).toBe(true);
    if (result.isValid) {
      expect(result.normalized).toBe(VALID_T_NUMBER);
    }
  });

  it('T が無い場合は not_prefixed_with_T', () => {
    const result = normalizeAndValidateInvoiceNumber(VALID_BASE);
    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.reason).toBe('not_prefixed_with_T');
    }
  });

  it('T の後が 12桁の場合は not_13_digits_after_T', () => {
    const result = normalizeAndValidateInvoiceNumber('T804000199901');
    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.reason).toBe('not_13_digits_after_T');
    }
  });

  it('チェックデジット不一致は check_digit_mismatch', () => {
    // T9040001999013: 9 は 040001999013 の正しいチェックデジット (8) ではない
    const result = normalizeAndValidateInvoiceNumber('T9040001999013');
    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.reason).toBe('check_digit_mismatch');
    }
  });

  it('T の直後が 0 は first_digit_zero_after_T', () => {
    const result = normalizeAndValidateInvoiceNumber('T0040001999013');
    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.reason).toBe('first_digit_zero_after_T');
    }
  });

  it('英字混入は invalid_characters', () => {
    const result = normalizeAndValidateInvoiceNumber('T8abc001999013');
    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.reason).toBe('invalid_characters');
    }
  });

  it('空文字列は not_prefixed_with_T', () => {
    const result = normalizeAndValidateInvoiceNumber('');
    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.reason).toBe('not_prefixed_with_T');
    }
  });
});

describe('InvoiceNumberSchema (Zod)', () => {
  it('有効な T番号を受け入れる (T8040001999013)', () => {
    const result = InvoiceNumberSchema.safeParse(VALID_T_NUMBER);
    expect(result.success).toBe(true);
  });

  it('形式エラー: T なし', () => {
    const result = InvoiceNumberSchema.safeParse(VALID_BASE);
    expect(result.success).toBe(false);
  });

  it('形式エラー: 14桁以上', () => {
    const result = InvoiceNumberSchema.safeParse('T80400019990130');
    expect(result.success).toBe(false);
  });

  it('T+13桁数字であれば形式上は受け入れる (チェックデジット計算は要求しない)', () => {
    // リソース定義書1.5版 別紙1 項番8 に基づき、個人の番号も包含できるよう形式検証のみ
    const result = InvoiceNumberSchema.safeParse('T1040001999013');
    expect(result.success).toBe(true);
  });

  it('形式エラー: 半角数字以外が含まれる', () => {
    const result = InvoiceNumberSchema.safeParse('T804000199901A');
    expect(result.success).toBe(false);
  });

  it('国土交通省の法人番号 + T プレフィックスも有効', () => {
    const result = InvoiceNumberSchema.safeParse(VALID_T_NUMBER_2);
    expect(result.success).toBe(true);
  });
});

describe('法人番号と T番号の整合性 (normalizeAndValidateInvoiceNumber)', () => {
  it('同じ13桁部分なら法人番号と T番号 両方とも有効', () => {
    const invoiceResult = normalizeAndValidateInvoiceNumber(VALID_T_NUMBER);
    expect(invoiceResult.isValid).toBe(true);
    if (invoiceResult.isValid) {
      expect(invoiceResult.corporateNumberPart).toBe(VALID_BASE);
    }
  });

  it('法人番号チェックデジットと照合する関数では、架空番号 T8040001999011 は拒否される', () => {
    const result = normalizeAndValidateInvoiceNumber('T8040001999011');
    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.reason).toBe('check_digit_mismatch');
    }
  });
});
