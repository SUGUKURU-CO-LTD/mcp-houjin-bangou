import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  InvoiceNumberSchema,
  normalizeAndValidateInvoiceNumber,
} from '../../src/domain/invoice-number.js';
import { computeCheckDigit } from '../../src/domain/check-digit.js';

const twelveDigitString = fc
  .array(fc.integer({ min: 0, max: 9 }), { minLength: 12, maxLength: 12 })
  .map((digits) => digits.join(''));

const thirteenDigitString = fc
  .array(fc.integer({ min: 0, max: 9 }), { minLength: 13, maxLength: 13 })
  .map((digits) => digits.join(''));

describe('invoice-number property tests', () => {
  it('any T + 13 digits is accepted by default for sole-proprietor compatibility', () => {
    fc.assert(
      fc.property(thirteenDigitString, (digits) => {
        const invoiceNumber = `T${digits}`;
        expect(InvoiceNumberSchema.safeParse(invoiceNumber).success).toBe(true);
        const normalized = normalizeAndValidateInvoiceNumber(invoiceNumber);
        expect(normalized.isValid).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('verifyCorporateCheckDigit=true accepts iff 13-digit part has valid Modulus-9 check digit', () => {
    fc.assert(
      fc.property(twelveDigitString, (basis) => {
        const validBody = `${computeCheckDigit(basis)}${basis}`;
        expect(
          normalizeAndValidateInvoiceNumber(`T${validBody}`, { verifyCorporateCheckDigit: true })
            .isValid,
        ).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('lowercase t and full-width T normalize to uppercase T', () => {
    fc.assert(
      fc.property(thirteenDigitString, fc.boolean(), (body, useFullWidth) => {
        const raw = `${useFullWidth ? 'Ｔ' : 't'}${body}`;
        const result = normalizeAndValidateInvoiceNumber(raw);
        expect(result.isValid).toBe(true);
        if (result.isValid) {
          expect(result.normalized).toBe(`T${body}`);
          expect(result.corporateNumberPart).toBe(body);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('hyphenated T numbers normalize correctly', () => {
    fc.assert(
      fc.property(thirteenDigitString, (body) => {
        const raw = `T-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8)}`;
        const result = normalizeAndValidateInvoiceNumber(raw);
        expect(result.isValid).toBe(true);
        if (result.isValid) {
          expect(result.normalized).toBe(`T${body}`);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('non-T prefix is always rejected regardless of valid body', () => {
    fc.assert(
      fc.property(
        twelveDigitString,
        fc.constantFrom('A', 'x', '0', 'あ', '株', '-', ' '),
        (basis, prefix) => {
          const body = `${computeCheckDigit(basis)}${basis}`;
          const result = normalizeAndValidateInvoiceNumber(`${prefix}${body}`);
          expect(result.isValid).toBe(false);
          if (!result.isValid) {
            expect(result.reason).toBe('not_prefixed_with_T');
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
