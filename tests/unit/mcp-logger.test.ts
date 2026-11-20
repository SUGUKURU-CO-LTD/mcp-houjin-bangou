import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMcpLogger, sanitizeLogData } from '../../src/lib/mcp-logger.js';

describe('mcp-logger & sanitizeLogData', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('strips query/PII keys including raw_name, company_name, target_company_name, location_hint', () => {
    const input = {
      tool: 'search_corporate_by_name',
      count: 3,
      corporate_number: '5111101000006',
      registration_number: 'T9340001026142',
      invoice_number: 'T1234567890123',
      name: 'スグクル株式会社',
      raw_name: '（株）スグクル',
      company_name: 'スグクル',
      target_company_name: 'トヨタ自動車',
      company_list_text: 'A社\nB社',
      location_hint: '鹿児島県霧島市',
      current_address: '東京都千代田区',
      query: 'テスト',
      search_word: 'テスト',
      user_keyword: 'テスト',
      head_office_address: '鹿児島県',
    };

    const sanitized = sanitizeLogData(input);
    expect(sanitized).toEqual({
      tool: 'search_corporate_by_name',
      count: 3,
    });
  });

  it('masks bare 13-digit numbers, T+13-digit invoice numbers, and id= query params in strings', () => {
    const sanitized = sanitizeLogData({
      detail: 'lookup failed for 5111101000006 and T9340001026142 via ?id=mysecretappid&type=02',
      longHexNotMasked: '1234567890123456',
    });

    expect(sanitized.detail).toBe(
      'lookup failed for ***REDACTED*** and T***REDACTED*** via ?id=***REDACTED***&type=02',
    );
    expect(sanitized.longHexNotMasked).toBe('1234567890123456');
  });

  it('recurses into arrays and nested objects without leaking sensitive fields or numbers', () => {
    const sanitized = sanitizeLogData({
      items: [
        'corp:9340001026142',
        'inv:T1234567890123',
        {
          ok: true,
          raw_name: '秘密商事',
          nested: ['id=secret999', { target_company_name: '除外対象', note: '1111111111111' }],
        },
      ],
      application_id: 'abc12345',
      api_token: 'tok_xyz',
    });

    expect(sanitized).toEqual({
      items: [
        'corp:***REDACTED***',
        'inv:T***REDACTED***',
        {
          ok: true,
          nested: ['id=***REDACTED***', { note: '***REDACTED***' }],
        },
      ],
      application_id: '***REDACTED***',
      api_token: '***REDACTED***',
    });
  });

  it('preserves W3C trace_id and traceparent fields intact', () => {
    const traceId = '0123456789012abcdef0123456789012';
    const traceparent = `00-${traceId}-0123456789012abc-01`;
    const sanitized = sanitizeLogData({
      trace_id: traceId,
      traceparent,
    });

    expect(sanitized.trace_id).toBe(traceId);
    expect(sanitized.traceparent).toBe(traceparent);
  });

  it('writes sanitized JSON lines to process.stderr respecting log level threshold', () => {
    const chunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });

    const logger = createMcpLogger(undefined, 'info');
    expect(logger.getLevel()).toBe('info');

    logger.debug('ignored_debug', { count: 1 });
    expect(chunks).toHaveLength(0);

    logger.info('tool_access', {
      tool: 'lookup_corporate_by_number',
      corporate_number: '5111101000006',
      note: 'checked 5111101000006',
    });
    expect(chunks).toHaveLength(1);
    const parsed = JSON.parse(chunks[0] ?? '{}') as Record<string, unknown>;
    expect(parsed.level).toBe('info');
    expect(parsed.logger).toBe('tool_access');
    expect(parsed.corporate_number).toBeUndefined();
    expect(parsed.note).toBe('checked ***REDACTED***');

    logger.setLevel('debug');
    expect(logger.getLevel()).toBe('debug');
    logger.debug('enabled_debug', { step: 'ok' });
    expect(chunks).toHaveLength(2);
  });
});
