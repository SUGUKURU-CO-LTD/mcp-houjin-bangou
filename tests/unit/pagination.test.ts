import { describe, it, expect } from 'vitest';
import {
  encodeCursor,
  decodeCursor,
  computeNextCursor,
  encodeNameSearchCursor,
  decodeNameSearchCursor,
  validateNameSearchCursor,
} from '../../src/lib/pagination.js';

describe('pagination cursor', () => {
  it('encode/decode round-trip', () => {
    const encoded = encodeCursor(3, 'query-hash-abc');
    const decoded = decodeCursor(encoded);
    expect(decoded?.divide).toBe(3);
    expect(decoded?.queryKey).toBe('query-hash-abc');
  });

  it('undefined cursor returns null', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('invalid cursor returns null', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor('!@#$%')).toBeNull();
  });

  it('divide out of range returns null', () => {
    const bad = Buffer.from(JSON.stringify({ divide: 0 })).toString('base64url');
    expect(decodeCursor(bad)).toBeNull();
    const bad2 = Buffer.from(JSON.stringify({ divide: 100000 })).toString('base64url');
    expect(decodeCursor(bad2)).toBeNull();
  });

  it('computeNextCursor null when on last page', () => {
    expect(computeNextCursor(3, 3)).toBeNull();
    expect(computeNextCursor(5, 3)).toBeNull();
  });

  it('computeNextCursor returns next page cursor', () => {
    const next = computeNextCursor(1, 3, 'key');
    expect(next).not.toBeNull();
    const decoded = decodeCursor(next!);
    expect(decoded?.divide).toBe(2);
    expect(decoded?.queryKey).toBe('key');
  });
});

describe('NameSearchCursor (B2 spec)', () => {
  it('encode/decode round-trip preserves offset and data_as_of', () => {
    const encoded = encodeNameSearchCursor({
      offset: 10,
      data_as_of: '2026-10-12',
      divide: 1,
      queryKey: 'tokyo-search',
    });
    const decoded = decodeNameSearchCursor(encoded);
    expect(decoded?.offset).toBe(10);
    expect(decoded?.data_as_of).toBe('2026-10-12');
    expect(decoded?.divide).toBe(1);
    expect(decoded?.queryKey).toBe('tokyo-search');
  });

  it('validateNameSearchCursor accepts valid cursor matching data_as_of', () => {
    const encoded = encodeNameSearchCursor({
      offset: 20,
      data_as_of: '2026-10-12',
    });
    const result = validateNameSearchCursor(encoded, '2026-10-12');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.offset).toBe(20);
    }
  });

  it('validateNameSearchCursor detects stale cursor when data_as_of differs', () => {
    const encoded = encodeNameSearchCursor({
      offset: 10,
      data_as_of: '2026-10-01',
    });
    const result = validateNameSearchCursor(encoded, '2026-10-12');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('stale');
      expect(result.message).toContain('公表データが更新されたため');
    }
  });

  it('validateNameSearchCursor detects invalid cursor string', () => {
    const result = validateNameSearchCursor('bad-format-string', '2026-10-12');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('malformed');
    }
  });
});
