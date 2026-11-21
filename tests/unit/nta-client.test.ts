/**
 * NTA Client の fixture テスト (DI seam 経由)
 */

import { describe, it, expect } from 'vitest';
import { createNtaClient } from '../../src/api/nta-client.js';
import { Result } from '../../src/lib/result.js';

function mockFetch(responses: Map<string, { status: number; body: string }>): typeof fetch {
  return async (input: string | URL | Request): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    for (const [key, resp] of responses.entries()) {
      if (url.includes(key)) {
        return new Response(resp.body, {
          status: resp.status,
          headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        });
      }
    }
    return new Response('Not found', { status: 404 });
  };
}

describe('NtaClient.lookupByNumber', () => {
  it('成功レスポンスをパースする', async () => {
    const csv = [
      '2017-05-10,1,1,1',
      '1,5111101000006,01,1,2019-04-03,2015-10-05,"株式会社検索対象除外",,301,"東京都","千代田区","神田",,13,101,1000000,,,,,,,2015-10-05,1,,,,,,1',
    ].join('\n');
    const responses = new Map([['number=5111101000006', { status: 200, body: csv }]]);
    const client = createNtaClient({
      applicationId: 'test-id',
      baseUrl: 'https://api.houjin-bangou.nta.go.jp/4',
      timeoutMs: 5000,
      rps: 100, // テスト高速化
      fetchImpl: mockFetch(responses),
    });
    const result = await client.lookupByNumber({ numbers: ['5111101000006'] });
    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value.corporations.length).toBe(1);
      expect(result.value.corporations[0]?.name).toBe('株式会社検索対象除外');
    }
  });

  it('空 numbers は 400 エラー', async () => {
    const client = createNtaClient({
      applicationId: 'test-id',
      baseUrl: 'https://api.houjin-bangou.nta.go.jp/4',
      timeoutMs: 5000,
      rps: 100,
      fetchImpl: mockFetch(new Map()),
    });
    const result = await client.lookupByNumber({ numbers: [] });
    expect(Result.isErr(result)).toBe(true);
  });

  it('11件以上は 400 エラー (上限10件)', async () => {
    const client = createNtaClient({
      applicationId: 'test-id',
      baseUrl: 'https://api.houjin-bangou.nta.go.jp/4',
      timeoutMs: 5000,
      rps: 100,
      fetchImpl: mockFetch(new Map()),
    });
    const result = await client.lookupByNumber({
      numbers: Array(11).fill('5111101000006') as string[],
    });
    expect(Result.isErr(result)).toBe(true);
  });

  it('403 でバックオフ発動', async () => {
    let backoffTriggered = false;
    const responses = new Map([['num', { status: 403, body: '' }]]);
    const client = createNtaClient({
      applicationId: 'test-id',
      baseUrl: 'https://api.houjin-bangou.nta.go.jp/4',
      timeoutMs: 5000,
      rps: 100,
      fetchImpl: mockFetch(responses),
      onBackoff: () => {
        backoffTriggered = true;
      },
    });
    const result = await client.lookupByNumber({ numbers: ['5111101000006'] });
    expect(Result.isErr(result)).toBe(true);
    expect(backoffTriggered).toBe(true);
    if (Result.isErr(result)) {
      expect(result.error.code).toBe('http_403');
    }
  });

  it('404 は NtaApiError を返す', async () => {
    const responses = new Map([['num', { status: 404, body: '' }]]);
    const client = createNtaClient({
      applicationId: 'test-id',
      baseUrl: 'https://api.houjin-bangou.nta.go.jp/4',
      timeoutMs: 5000,
      rps: 100,
      fetchImpl: mockFetch(responses),
    });
    const result = await client.lookupByNumber({ numbers: ['5111101000006'] });
    expect(Result.isErr(result)).toBe(true);
    if (Result.isErr(result)) {
      expect(result.error.code).toBe('http_404');
    }
  });
});

describe('NtaClient.searchByName', () => {
  it('成功レスポンスをパースする', async () => {
    const csv = [
      '2017-05-10,1,1,1',
      '1,8040001999013,01,0,2017-05-09,2017-05-09,"株式会社商号",,301,"千葉県","千葉市中央区","蘇我",,12,101,2600822,,,,,,,2015-10-05,1,,,,,,0',
    ].join('\n');
    const responses = new Map([['name=', { status: 200, body: csv }]]);
    const client = createNtaClient({
      applicationId: 'test-id',
      baseUrl: 'https://api.houjin-bangou.nta.go.jp/4',
      timeoutMs: 5000,
      rps: 100,
      fetchImpl: mockFetch(responses),
    });
    const result = await client.searchByName({
      name: 'テスト',
      mode: '1',
      target: '1',
    });
    expect(Result.isOk(result)).toBe(true);
  });

  it('空 name は 400 エラー', async () => {
    const client = createNtaClient({
      applicationId: 'test-id',
      baseUrl: 'https://api.houjin-bangou.nta.go.jp/4',
      timeoutMs: 5000,
      rps: 100,
      fetchImpl: mockFetch(new Map()),
    });
    const result = await client.searchByName({ name: '' });
    expect(Result.isErr(result)).toBe(true);
  });
});

describe('NtaClient.ping', () => {
  it('404 は ok 扱い (ダミー番号なので正常)', async () => {
    const responses = new Map([['num', { status: 404, body: '' }]]);
    const client = createNtaClient({
      applicationId: 'test-id',
      baseUrl: 'https://api.houjin-bangou.nta.go.jp/4',
      timeoutMs: 5000,
      rps: 100,
      fetchImpl: mockFetch(responses),
    });
    const result = await client.ping();
    expect(Result.isOk(result)).toBe(true);
  });

  it('403 バックオフ中の後続リクエストはハングせず即座に http_403 (status 429) を返す', async () => {
    const responses = new Map([['num', { status: 403, body: '' }]]);
    const client = createNtaClient({
      applicationId: 'secret-app-id-999',
      baseUrl: 'https://api.houjin-bangou.nta.go.jp/4',
      timeoutMs: 5000,
      rps: 100,
      fetchImpl: mockFetch(responses),
    });
    const first = await client.lookupByNumber({ numbers: ['5111101000006'] });
    expect(Result.isErr(first)).toBe(true);

    const start = Date.now();
    const second = await client.lookupByNumber({ numbers: ['5111101000006'] });
    expect(Date.now() - start).toBeLessThan(100);
    expect(Result.isErr(second)).toBe(true);
    if (Result.isErr(second)) {
      expect(second.error.code).toBe('http_403');
      expect(second.error.httpStatus).toBe(429);
    }
  });

  it('ネットワーク例外メッセージ内の id=... および applicationId シークレットをマスクする', async () => {
    const failingFetch: typeof fetch = async (input) => {
      const u = typeof input === 'string' ? input : input.toString();
      throw new Error(`connect ECONNREFUSED for ${u}`);
    };
    const client = createNtaClient({
      applicationId: 'SUPER_SECRET_APP_ID_123',
      baseUrl: 'https://api.houjin-bangou.nta.go.jp/4',
      timeoutMs: 5000,
      rps: 100,
      fetchImpl: failingFetch,
    });
    const res = await client.lookupByNumber({ numbers: ['5111101000006'] });
    expect(Result.isErr(res)).toBe(true);
    if (Result.isErr(res)) {
      expect(res.error.code).toBe('network_error');
      expect(res.error.message).not.toContain('SUPER_SECRET_APP_ID_123');
      expect(res.error.message).toContain('id=***REDACTED***');
    }
  });
});
