import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { normalizeCompanyName } from '../../src/domain/normalizer.js';

const safeJapaneseCompanyLike = fc
  .array(
    fc.constantFrom(
      'ス',
      'グ',
      'ク',
      'ル',
      '高',
      '髙',
      '橋',
      '商',
      '事',
      '齋',
      '斎',
      '﨑',
      '崎',
      '證',
      '會',
      '(株)',
      '㈱',
      '（有）',
      '(同)',
      '(医)',
      '医療法人社団',
      '-',
      '・',
      '\uFE00',
      '\u{E0100}',
      'A',
      'Ｂ',
      '1',
      '２',
      ' ',
      '　',
    ),
    { minLength: 1, maxLength: 20 },
  )
  .map((chars) => chars.join(''));

describe('normalizer property tests', () => {
  it('normalization is deterministic for the same input', () => {
    fc.assert(
      fc.property(safeJapaneseCompanyLike, (input) => {
        const a = normalizeCompanyName(input);
        const b = normalizeCompanyName(input);
        expect(b).toEqual(a);
      }),
      { numRuns: 1000 },
    );
  });

  it('normalization never returns more than 10 candidates and strips IVS selectors', () => {
    fc.assert(
      fc.property(safeJapaneseCompanyLike, (input) => {
        const result = normalizeCompanyName(input);
        expect(result.normalized_candidates.length).toBeLessThanOrEqual(10);
        for (const c of result.normalized_candidates) {
          expect(c.name).not.toMatch(/[\uFE00-\uFE0F]|[\u{E0100}-\u{E01EF}]/u);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('non-empty non-selector trimmed input yields at least one non-empty candidate', () => {
    fc.assert(
      fc.property(safeJapaneseCompanyLike, (input) => {
        const stripped = input
          .normalize('NFKC')
          .replace(/[\uFE00-\uFE0F]|[\u{E0100}-\u{E01EF}]/gu, '')
          .trim();
        fc.pre(stripped.length > 0);
        const result = normalizeCompanyName(input);
        expect(result.normalized_candidates.length).toBeGreaterThan(0);
        expect(result.normalized_candidates[0]?.name.length).toBeGreaterThan(0);
      }),
      { numRuns: 1000 },
    );
  });

  it('candidate names are unique', () => {
    fc.assert(
      fc.property(safeJapaneseCompanyLike, (input) => {
        const result = normalizeCompanyName(input);
        const names = result.normalized_candidates.map((c) => c.name);
        expect(new Set(names).size).toBe(names.length);
      }),
      { numRuns: 1000 },
    );
  });

  it('confidence is always within 0..1', () => {
    fc.assert(
      fc.property(safeJapaneseCompanyLike, (input) => {
        const result = normalizeCompanyName(input);
        for (const candidate of result.normalized_candidates) {
          expect(candidate.confidence).toBeGreaterThanOrEqual(0);
          expect(candidate.confidence).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
