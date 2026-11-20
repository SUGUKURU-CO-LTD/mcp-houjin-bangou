import { describe, it, expect } from 'vitest';
import {
  parseTraceparent,
  formatTraceparent,
  generateTraceId,
  generateSpanId,
  deriveChildSpan,
  sanitizeTracestate,
  extractTraceFromMcpExtra,
} from '../../src/lib/trace-context.js';

describe('parseTraceparent', () => {
  it('valid traceparent', () => {
    const ctx = parseTraceparent('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01');
    expect(ctx).not.toBeNull();
    expect(ctx?.version).toBe('00');
    expect(ctx?.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(ctx?.parentId).toBe('b7ad6b7169203331');
    expect(ctx?.flags).toBe('01');
  });

  it('uppercase normalized to lowercase', () => {
    const ctx = parseTraceparent('00-0AF7651916CD43DD8448EB211C80319C-B7AD6B7169203331-01');
    expect(ctx?.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
  });

  it('invalid format and forbidden version ff return null', () => {
    expect(parseTraceparent('invalid')).toBeNull();
    expect(parseTraceparent('')).toBeNull();
    expect(parseTraceparent(undefined)).toBeNull();
    expect(parseTraceparent('00-short-b7ad6b7169203331-01')).toBeNull();
    expect(parseTraceparent('ff-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')).toBeNull();
  });

  it('all-zero IDs are rejected', () => {
    expect(parseTraceparent('00-00000000000000000000000000000000-0000000000000000-01')).toBeNull();
  });
});

describe('formatTraceparent', () => {
  it('round-trip', () => {
    const original = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    const ctx = parseTraceparent(original);
    expect(ctx).not.toBeNull();
    if (ctx !== null) {
      expect(formatTraceparent(ctx)).toBe(original);
    }
  });
});

describe('generateTraceId / generateSpanId', () => {
  it('traceId is 32 lowercase hex', () => {
    const id = generateTraceId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('spanId is 16 lowercase hex', () => {
    const id = generateSpanId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('ids are unique', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateTraceId());
    }
    expect(ids.size).toBe(100);
  });
});

describe('deriveChildSpan', () => {
  it('null parent creates new trace', () => {
    const child = deriveChildSpan(null);
    expect(child.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(child.flags).toBe('01');
  });

  it('inherits traceId and flags from parent', () => {
    const parent = parseTraceparent('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01');
    expect(parent).not.toBeNull();
    if (parent !== null) {
      const child = deriveChildSpan(parent);
      expect(child.traceId).toBe(parent.traceId);
      expect(child.flags).toBe(parent.flags);
      expect(child.parentId).not.toBe(parent.parentId);
    }
  });
});

describe('SEP-414 extractTraceFromMcpExtra & sanitizeTracestate', () => {
  it('prioritizes extra._meta.traceparent over HTTP headers', () => {
    const metaTp = '00-11111111111111111111111111111111-2222222222222222-01';
    const httpTp = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';
    const extracted = extractTraceFromMcpExtra({
      _meta: { traceparent: metaTp, tracestate: 'vendor=abc' },
      requestInfo: { headers: { traceparent: httpTp } },
    });

    expect(extracted.source).toBe('mcp_meta');
    expect(extracted.traceContext.traceId).toBe('11111111111111111111111111111111');
    expect(extracted.traceContext.parentId).not.toBe('2222222222222222');
    expect(extracted.tracestate).toBe('vendor=abc');
  });

  it('falls back to HTTP requestInfo.headers.traceparent when _meta is absent', () => {
    const httpTp = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';
    const extracted = extractTraceFromMcpExtra({
      requestInfo: { headers: { traceparent: httpTp, tracestate: 'congo=t61rcWkgMzE' } },
    });

    expect(extracted.source).toBe('http_header');
    expect(extracted.traceContext.traceId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(extracted.tracestate).toBe('congo=t61rcWkgMzE');
  });

  it('generates a new trace when neither _meta nor HTTP traceparent is valid', () => {
    const extracted = extractTraceFromMcpExtra({
      _meta: { traceparent: 'invalid-header' },
    });
    expect(extracted.source).toBe('generated');
    expect(extracted.traceContext.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(extracted.tracestate).toBeUndefined();
  });

  it('rejects control characters and overlong values in sanitizeTracestate', () => {
    expect(sanitizeTracestate('vendor=1\r\nevil=2')).toBeUndefined();
    expect(sanitizeTracestate('x'.repeat(600))).toBeUndefined();
    expect(sanitizeTracestate('  vendor=ok  ')).toBe('vendor=ok');
  });
});
