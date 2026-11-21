/**
 * Tool integration tests — MCP McpServer を実際にインスタンス化し、
 * in-memory transport 経由で tools/list + tools/call を叩いて end-to-end 動作を検証する。
 */

import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerAllTools } from '../../src/tools/index.js';
import { registerAllResources } from '../../src/resources/index.js';
import { registerAllPrompts } from '../../src/prompts/index.js';
import { registerCompletionHandler } from '../../src/completion/handler.js';
import { createMcpLogger, type McpLogger } from '../../src/lib/mcp-logger.js';
import { NtaApiError, RateLimitError } from '../../src/lib/errors.js';
import type { NtaClient } from '../../src/api/nta-client.js';
import { encodeNameSearchCursor } from '../../src/lib/pagination.js';
import { Result } from '../../src/lib/result.js';

const sampleActiveCorporation = {
  sequence_number: 1,
  corporate_number: '5111101000006',
  process: '01',
  correct: '1' as const,
  update_date: '2019-04-03',
  change_date: '2015-10-05',
  name: '株式会社検索対象除外',
  name_image_id: '',
  kind: '301',
  prefecture_name: '東京都',
  city_name: '千代田区',
  street_number: '神田小川町',
  address_image_id: '',
  prefecture_code: '13',
  city_code: '101',
  post_code: '1000000',
  address_outside: '',
  address_outside_image_id: '',
  close_date: '',
  close_cause: '',
  successor_corporate_number: '',
  change_cause: '',
  assignment_date: '2015-10-05',
  latest: '1' as const,
  en_name: '',
  en_prefecture_name: '',
  en_city_name: '',
  en_address_outside: '',
  furigana: 'カブシキガイシャケンサクタイショウジョガイ',
  hihyoji: '1' as const,
};

const sampleMergedCorporation = {
  sequence_number: 2,
  corporate_number: '9340001026142',
  process: '21',
  correct: '0' as const,
  update_date: '2026-07-15',
  change_date: '2026-07-15',
  name: '閉鎖サンプル株式会社',
  name_image_id: '',
  kind: '301',
  prefecture_name: '鹿児島県',
  city_name: '霧島市',
  street_number: '国分中央１丁目２−３２',
  address_image_id: '',
  prefecture_code: '46',
  city_code: '218',
  post_code: '8994332',
  address_outside: '',
  address_outside_image_id: '',
  close_date: '2026-08-01',
  close_cause: '11', // 合併による解散等
  successor_corporate_number: '5111101000006',
  change_cause: '',
  assignment_date: '2023-12-01',
  latest: '1' as const,
  en_name: '',
  en_prefecture_name: '',
  en_city_name: '',
  en_address_outside: '',
  furigana: 'ヘイササンプルカブシキガイシャ',
  hihyoji: '0' as const,
};

const sampleDeletedCorporation = {
  ...sampleActiveCorporation,
  corporate_number: '8000000000001',
  process: '99',
  name: '削除済みレコード株式会社',
  latest: '1' as const,
};

const mockNtaClient: NtaClient = {
  async lookupByNumber(params) {
    if (params.numbers.includes('5111101000006')) {
      return Result.ok({
        header: { lastUpdateDate: '2019-04-05', count: 2, divideNumber: 1, divideSize: 1 },
        corporations: [
          { ...sampleActiveCorporation, name: '旧商号株式会社', latest: '0' as const },
          sampleActiveCorporation,
        ],
      });
    }
    if (params.numbers.includes('9340001026142')) {
      return Result.ok({
        header: { lastUpdateDate: '2026-08-05', count: 1, divideNumber: 1, divideSize: 1 },
        corporations: [sampleMergedCorporation],
      });
    }
    if (params.numbers.includes('8000000000001')) {
      return Result.ok({
        header: { lastUpdateDate: '2026-08-05', count: 1, divideNumber: 1, divideSize: 1 },
        corporations: [sampleDeletedCorporation],
      });
    }
    if (params.numbers.includes('7000000000002')) {
      return Result.err(new NtaApiError('Rate limited by NTA', 'http_403', 403));
    }
    if (params.numbers.includes('6000000000003')) {
      throw new RateLimitError('Backoff active', 2000);
    }
    if (params.numbers.includes('5000000000004')) {
      return Result.err(new NtaApiError('Not found', 'http_404', 404));
    }
    return Result.ok({
      header: { lastUpdateDate: '2019-04-05', count: 0, divideNumber: 1, divideSize: 1 },
      corporations: [],
    });
  },
  async searchByName(params) {
    if (params.name === 'レート制限403') {
      return Result.err(new NtaApiError('Rate limited by NTA', 'http_403', 403));
    }
    if (params.name === 'レート制限例外') {
      throw new RateLimitError('Backoff active', 2000);
    }
    if (params.name === '多数件') {
      const corps = Array.from({ length: 25 }, (_, i) => ({
        ...sampleActiveCorporation,
        corporate_number: String(1000000000000 + i),
        name: `テスト法人第${i + 1}号`,
      }));
      return Result.ok({
        header: { lastUpdateDate: '2026-10-12', count: 25, divideNumber: 1, divideSize: 1 },
        corporations: corps,
      });
    }
    if (params.name === '複数件') {
      return Result.ok({
        header: { lastUpdateDate: '2026-10-12', count: 3, divideNumber: 1, divideSize: 1 },
        corporations: [sampleActiveCorporation, sampleMergedCorporation, sampleDeletedCorporation],
      });
    }
    return Result.ok({
      header: { lastUpdateDate: '2019-04-05', count: 1, divideNumber: 1, divideSize: 1 },
      corporations: [sampleActiveCorporation],
    });
  },
  async ping() {
    return Result.ok(true);
  },
};

async function setupClient(customLogger?: McpLogger): Promise<Client> {
  const server = new McpServer(
    { name: 'test-server', version: '0.0.1' },
    {
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
        prompts: { listChanged: false },
        completions: {},
      },
    },
  );
  const logger = customLogger ?? createMcpLogger(server.server, 'info');
  registerAllTools(server, { ntaClient: mockNtaClient, logger });
  registerAllResources(server, { ntaClient: mockNtaClient, logger });
  registerAllPrompts(server);
  registerCompletionHandler(server.server, { logger });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'test-client', version: '0.0.1' },
    { capabilities: { sampling: undefined } },
  );
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  // P0-1: 常に listTools を先行実行し、全テストで SDK Client の outputSchema AJV 検証を通す
  await client.listTools();
  return client;
}

describe('MCP Tools integration (via in-memory transport with listTools AJV active)', () => {
  it('tools/list returns 5 tools with strict additionalProperties: false on every inputSchema', async () => {
    const client = await setupClient();
    const result = await client.listTools();
    expect(result.tools.length).toBe(5);
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'lookup_corporate_by_number',
      'lookup_invoice_issuer',
      'normalize_company_name',
      'search_corporate_by_name',
      'validate_corporate_number',
    ]);
    for (const tool of result.tools) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it('rejects unknown extra fields (__sidenote) across tools via strict inputSchema', async () => {
    const client = await setupClient();
    for (const call of [
      {
        name: 'lookup_corporate_by_number',
        arguments: { corporate_number: '5111101000006', __sidenote: 'inject' },
      },
      {
        name: 'search_corporate_by_name',
        arguments: { name: 'テスト', __sidenote: 'inject' },
      },
      {
        name: 'validate_corporate_number',
        arguments: { corporate_number: '5111101000006', __sidenote: 'inject' },
      },
      {
        name: 'normalize_company_name',
        arguments: { raw_name: '株式会社テスト', __sidenote: 'inject' },
      },
    ]) {
      const res = await client.callTool(call);
      expect(res.isError).toBe(true);
      expect(res.structuredContent).toBeUndefined();
    }
  });

  it('all tools have descriptive Japanese text in description', async () => {
    const client = await setupClient();
    const result = await client.listTools();
    for (const tool of result.tools) {
      expect(tool.description).toBeDefined();
      expect(tool.description?.length).toBeGreaterThan(10);
    }
  });

  it('all tools declare valid MCP annotations', async () => {
    const client = await setupClient();
    const result = await client.listTools();
    for (const tool of result.tools) {
      const ann = tool.annotations;
      expect(ann?.readOnlyHint).toBe(true);
      expect(ann?.destructiveHint).toBe(false);
      expect(ann?.idempotentHint).toBe(true);
      if (tool.name === 'validate_corporate_number' || tool.name === 'normalize_company_name') {
        expect(ann?.openWorldHint).toBe(false);
      } else {
        expect(ann?.openWorldHint).toBe(true);
      }
    }
  });

  it('lookup, search, and invoice tools expose registerAppTool UI resource metadata', async () => {
    const client = await setupClient();
    const result = await client.listTools();
    const lookup = result.tools.find((t) => t.name === 'lookup_corporate_by_number');
    const search = result.tools.find((t) => t.name === 'search_corporate_by_name');
    const invoice = result.tools.find((t) => t.name === 'lookup_invoice_issuer');
    expect((lookup?._meta?.['ui'] as { resourceUri?: string } | undefined)?.resourceUri).toBe(
      'ui://corporate-card/mcp-app.html',
    );
    expect((search?._meta?.['ui'] as { resourceUri?: string } | undefined)?.resourceUri).toBe(
      'ui://search-results/mcp-app.html',
    );
    expect((invoice?._meta?.['ui'] as { resourceUri?: string } | undefined)?.resourceUri).toBe(
      'ui://corporate-card/mcp-app.html',
    );
  });

  it('lookup_corporate_by_number prefers latest=1 record and returns active corporation', async () => {
    const client = await setupClient();
    const result = await client.callTool({
      name: 'lookup_corporate_by_number',
      arguments: { corporate_number: '5111101000006' },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      corporation: {
        corporate_number: string;
        name: string;
        legal_type: string;
        location: string;
        status: string;
        close_date: string | null;
        close_cause: string | null;
        successor_corporate_number?: string | null;
      };
      data_as_of: string;
      attribution: string;
    };
    expect(structured.corporation.corporate_number).toBe('5111101000006');
    expect(structured.corporation.name).toBe('株式会社検索対象除外');
    expect(structured.corporation.legal_type).toBe('株式会社');
    expect(structured.corporation.location).toBe('東京都千代田区神田小川町');
    expect(structured.corporation.status).toBe('active');
    expect(structured.corporation.close_date).toBeNull();
    expect(structured.corporation.close_cause).toBeNull();
    expect(structured.corporation.successor_corporate_number).toBeNull();
    expect(structured.data_as_of).toBe('2019-04-05');

    const textContent = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(textContent).toContain('2019-04-05');
    expect(textContent).toContain(structured.attribution);
  });

  it('lookup_corporate_by_number returns closed corporation with successor_corporate_number', async () => {
    const client = await setupClient();
    const result = await client.callTool({
      name: 'lookup_corporate_by_number',
      arguments: { corporate_number: '9340001026142' },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      corporation: {
        status: string;
        close_date: string | null;
        close_cause: string | null;
        successor_corporate_number?: string | null;
      };
    };
    expect(structured.corporation.status).toBe('closed');
    expect(structured.corporation.close_date).toBe('2026-08-01');
    expect(structured.corporation.close_cause).toBe('合併による解散等');
    expect(structured.corporation.successor_corporate_number).toBe('5111101000006');

    const textContent = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(textContent).toContain('承継先法人番号: 5111101000006');
  });

  it('lookup_corporate_by_number treats empty dataset, process=99, and http_404 as NOT_FOUND without AJV crash', async () => {
    const client = await setupClient();
    for (const num of ['4111101000007', '8000000000001', '5000000000004']) {
      const result = await client.callTool({
        name: 'lookup_corporate_by_number',
        arguments: { corporate_number: num },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      const meta = result._meta as { error: { code: string; message: string } };
      expect(meta.error.code).toBe('NOT_FOUND');
      const text = (result.content as Array<{ text: string }>)[0]?.text;
      expect(text).toMatch(/^\[NOT_FOUND\]/);
    }
  });

  it('lookup_corporate_by_number maps http_403 and RateLimitError to RATE_LIMITED', async () => {
    const client = await setupClient();
    for (const num of ['7000000000002', '6000000000003']) {
      const result = await client.callTool({
        name: 'lookup_corporate_by_number',
        arguments: { corporate_number: num },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      const meta = result._meta as { error: { code: string } };
      expect(meta.error.code).toBe('RATE_LIMITED');
    }
  });

  it('lookup_corporate_by_number rejects invalid check digit with INVALID_INPUT', async () => {
    const client = await setupClient();
    const result = await client.callTool({
      name: 'lookup_corporate_by_number',
      arguments: { corporate_number: '1111111111111' },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const meta = result._meta as { error: { code: string; message: string } };
    expect(meta.error.code).toBe('INVALID_INPUT');
    expect(meta.error.message).toContain('チェックデジット');
  });

  it('search_corporate_by_name excludes process=99 records and binds queryKey to next_cursor', async () => {
    const client = await setupClient();
    const result = await client.callTool({
      name: 'search_corporate_by_name',
      arguments: { name: '複数件', limit: 1 },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      total_count: number;
      next_cursor: string | null;
      results: Array<{ corporate_number: string }>;
    };
    // 3 rows in mock, 1 has process=99 -> total_count becomes 2
    expect(structured.total_count).toBe(2);
    expect(structured.results.length).toBe(1);
    expect(structured.next_cursor).not.toBeNull();

    // Reusing next_cursor with a different name or prefecture is rejected with INVALID_INPUT
    const mismatchName = await client.callTool({
      name: 'search_corporate_by_name',
      arguments: { name: '別クエリ', cursor: structured.next_cursor ?? '' },
    });
    expect(mismatchName.isError).toBe(true);
    expect((mismatchName._meta as { error: { code: string } }).error.code).toBe('INVALID_INPUT');

    const mismatchPref = await client.callTool({
      name: 'search_corporate_by_name',
      arguments: { name: '複数件', prefecture: '13', cursor: structured.next_cursor ?? '' },
    });
    expect(mismatchPref.isError).toBe(true);
    expect((mismatchPref._meta as { error: { code: string } }).error.code).toBe('INVALID_INPUT');

    // Reusing next_cursor with the same query succeeds and does not return process=99
    const page2 = await client.callTool({
      name: 'search_corporate_by_name',
      arguments: { name: '複数件', limit: 5, cursor: structured.next_cursor ?? '' },
    });
    expect(page2.isError).toBeFalsy();
    const sc2 = page2.structuredContent as { results: Array<{ corporate_number: string }> };
    expect(sc2.results.map((r) => r.corporate_number)).toEqual(['9340001026142']);
  });

  it('search_corporate_by_name rejects stale cursor and out-of-range offset cursor with INVALID_INPUT', async () => {
    const client = await setupClient();
    const staleCursor = encodeNameSearchCursor({
      offset: 10,
      data_as_of: '2015-01-01',
      queryKey: 'テスト|',
      divide: 1,
    });

    const result = await client.callTool({
      name: 'search_corporate_by_name',
      arguments: { name: 'テスト', cursor: staleCursor },
    });
    expect(result.isError).toBe(true);
    const meta = result._meta as { error: { code: string; message: string } };
    expect(meta.error.code).toBe('INVALID_INPUT');
    expect(meta.error.message).toContain('公表データが更新されたため');

    const hugeCursor = Buffer.from(
      JSON.stringify({ offset: 999999, data_as_of: '2019-04-05' }),
      'utf8',
    ).toString('base64url');
    const hugeRes = await client.callTool({
      name: 'search_corporate_by_name',
      arguments: { name: 'テスト', cursor: hugeCursor },
    });
    expect(hugeRes.isError).toBe(true);
    expect((hugeRes._meta as { error: { code: string } }).error.code).toBe('INVALID_INPUT');
  });

  it('search_corporate_by_name maps http_403 and RateLimitError to RATE_LIMITED', async () => {
    const client = await setupClient();
    for (const q of ['レート制限403', 'レート制限例外']) {
      const res = await client.callTool({
        name: 'search_corporate_by_name',
        arguments: { name: q },
      });
      expect(res.isError).toBe(true);
      expect((res._meta as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
    }
  });

  it('search_corporate_by_name enforces result size upper bound and limit rules (default 10, max 20, rejects limit > 20)', async () => {
    const client = await setupClient();

    const defaultRes = await client.callTool({
      name: 'search_corporate_by_name',
      arguments: { name: '多数件' },
    });
    expect(defaultRes.isError).toBeFalsy();
    const defaultStructured = defaultRes.structuredContent as {
      total_count: number;
      next_cursor: string | null;
      results: Array<unknown>;
    };
    expect(defaultStructured.total_count).toBe(25);
    expect(defaultStructured.results.length).toBe(10);
    expect(defaultStructured.next_cursor).not.toBeNull();

    const maxRes = await client.callTool({
      name: 'search_corporate_by_name',
      arguments: { name: '多数件', limit: 20 },
    });
    expect(maxRes.isError).toBeFalsy();
    const maxStructured = maxRes.structuredContent as {
      results: Array<unknown>;
      next_cursor: string | null;
    };
    expect(maxStructured.results.length).toBe(20);
    expect(maxStructured.next_cursor).not.toBeNull();

    const invalidRes = await client.callTool({
      name: 'search_corporate_by_name',
      arguments: { name: '多数件', limit: 21 },
    });
    expect(invalidRes.isError).toBe(true);
    const contentText = (invalidRes.content as Array<{ text: string }>)[0]?.text;
    expect(contentText).toMatch(/20|too_big|INVALID_INPUT/);
  });

  it('validate_corporate_number — valid & invalid check digit cases', async () => {
    const client = await setupClient();
    const validRes = await client.callTool({
      name: 'validate_corporate_number',
      arguments: { corporate_number: '5111101000006' },
    });
    expect(validRes.isError).toBeFalsy();
    expect(validRes.structuredContent).toEqual({
      is_valid_format: true,
      is_valid_check_digit: true,
      error_reason: null,
    });

    const invalidRes = await client.callTool({
      name: 'validate_corporate_number',
      arguments: { corporate_number: '1111111111111' },
    });
    expect(invalidRes.isError).toBeFalsy();
    expect(invalidRes.structuredContent).toEqual({
      is_valid_format: true,
      is_valid_check_digit: false,
      error_reason: 'check_digit_mismatch',
    });
  });

  it('normalize_company_name — normalizes company names and applies OLD_TO_NEW kanji to search_query_optimized', async () => {
    const client = await setupClient();
    const result = await client.callTool({
      name: 'normalize_company_name',
      arguments: { raw_name: '（株）髙橋商事' },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      normalized_name: string;
      legal_type: string | null;
      search_query_optimized: string;
    };
    expect(structured.legal_type).toBe('株式会社');
    expect(structured.search_query_optimized).toBe('高橋商事');
  });

  it('all tools do not include request ID, trace ID, or internal timestamp in outputs (§6.2) even when SEP-414 traceparent is supplied', async () => {
    const logEntries: Array<{ level: string; logger: string; data?: Record<string, unknown> }> = [];
    const spyLogger: McpLogger = {
      setLevel: () => {},
      getLevel: () => 'info',
      log: (level, logger, data) => logEntries.push({ level, logger, data }),
      debug: (logger, data) => logEntries.push({ level: 'debug', logger, data }),
      info: (logger, data) => logEntries.push({ level: 'info', logger, data }),
      warn: (logger, data) => logEntries.push({ level: 'warn', logger, data }),
      warning: (logger, data) => logEntries.push({ level: 'warn', logger, data }),
      error: (logger, data) => logEntries.push({ level: 'error', logger, data }),
    };

    const client = await setupClient(spyLogger);
    const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

    const lookupRes = await client.callTool({
      name: 'lookup_corporate_by_number',
      arguments: { corporate_number: '5111101000006' },
      _meta: { traceparent },
    });

    const jsonStr = JSON.stringify(lookupRes.structuredContent);
    expect(jsonStr).not.toMatch(
      /requestId|traceId|trace_id|request_id|internal_timestamp|processed_at|0af7651916cd43dd8448eb211c80319c/i,
    );

    const accessLog = logEntries.find((e) => e.logger === 'tool_access');
    expect(accessLog?.data?.trace_id).toBe('0af7651916cd43dd8448eb211c80319c');
  });
});

describe('MCP Resources integration', () => {
  it('resources/list returns UI resources only', async () => {
    const client = await setupClient();
    const result = await client.listResources();
    const names = result.resources.map((r) => r.uri);
    expect(names).not.toContain('attribution://houjin-bangou');
    expect(names).toContain('ui://corporate-card/mcp-app.html');
    expect(names).toContain('ui://search-results/mcp-app.html');
    expect(result.resources).toHaveLength(2);
  });

  it('resources/templates/list returns empty list', async () => {
    const client = await setupClient();
    const result = await client.listResourceTemplates();
    expect(result.resourceTemplates).toEqual([]);
  });

  it('resources/read on unregistered resources rejects', async () => {
    const client = await setupClient();
    await expect(client.readResource({ uri: 'attribution://houjin-bangou' })).rejects.toThrow();
    await expect(client.readResource({ uri: 'corp://5111101000006' })).rejects.toThrow();
  });

  it('resources/read ui://corporate-card/mcp-app.html returns MCP App HTML', async () => {
    const client = await setupClient();
    const result = await client.readResource({ uri: 'ui://corporate-card/mcp-app.html' });
    const first = result.contents[0];
    if (first === undefined || !('text' in first) || typeof first.text !== 'string') {
      throw new Error('Expected text resource');
    }
    expect(first.mimeType).toContain('text/html');
    expect(first.text).toContain('Corporate Card');
  });

  it('resources/read ui://search-results/mcp-app.html returns MCP App HTML', async () => {
    const client = await setupClient();
    const result = await client.readResource({ uri: 'ui://search-results/mcp-app.html' });
    const first = result.contents[0];
    if (first === undefined || !('text' in first) || typeof first.text !== 'string') {
      throw new Error('Expected text resource');
    }
    expect(first.mimeType).toContain('text/html');
    expect(first.text).toContain('Search Results');
  });
});

describe('MCP Completion integration', () => {
  it('completion/complete on unregistered resource or unknown prompt returns empty values', async () => {
    const client = await setupClient();
    const resResource = await client.complete({
      ref: { type: 'ref/resource', uri: 'corp://5111101000006' },
      argument: { name: 'corporate_number', value: '511' },
    });
    expect(resResource.completion.values).toEqual([]);

    const resUnknownPrompt = await client.complete({
      ref: { type: 'ref/prompt', name: 'non-existent-prompt' },
      argument: { name: 'company_name', value: 'スグクル' },
    });
    expect(resUnknownPrompt.completion.values).toEqual([]);
  });

  it('completion/complete completes location_hint prefectures and company_list_text last line', async () => {
    const client = await setupClient();
    const prefRes = await client.complete({
      ref: { type: 'ref/prompt', name: 'company-master-record' },
      argument: { name: 'location_hint', value: '鹿児' },
    });
    expect(prefRes.completion.values).toEqual(['鹿児島県']);

    const prefCodeRes = await client.complete({
      ref: { type: 'ref/prompt', name: 'company-master-record' },
      argument: { name: 'location_hint', value: '46' },
    });
    expect(prefCodeRes.completion.values).toEqual(['鹿児島県']);

    const listRes = await client.complete({
      ref: { type: 'ref/prompt', name: 'sales-list-enrichment' },
      argument: { name: 'company_list_text', value: 'トヨタ自動車株式会社\n（株）スグクル' },
    });
    expect(listRes.completion.values.length).toBeGreaterThan(0);
    expect(listRes.completion.values[0]).toContain('トヨタ自動車株式会社\n');
  });
});

describe('Privacy-preserving access logging in tools', () => {
  it('lookup_corporate_by_number logs tool, count, duration_ms and never the corporate number', async () => {
    const logEntries: Array<{ level: string; logger: string; data?: Record<string, unknown> }> = [];
    const spyLogger: McpLogger = {
      setLevel: () => {},
      getLevel: () => 'info',
      log: (level, logger, data) => logEntries.push({ level, logger, data }),
      debug: (logger, data) => logEntries.push({ level: 'debug', logger, data }),
      info: (logger, data) => logEntries.push({ level: 'info', logger, data }),
      warn: (logger, data) => logEntries.push({ level: 'warn', logger, data }),
      warning: (logger, data) => logEntries.push({ level: 'warn', logger, data }),
      error: (logger, data) => logEntries.push({ level: 'error', logger, data }),
    };

    const client = await setupClient(spyLogger);
    const targetNumber = '5111101000006';
    await client.callTool({
      name: 'lookup_corporate_by_number',
      arguments: { corporate_number: targetNumber },
    });

    const accessLog = logEntries.find((e) => e.logger === 'tool_access');
    expect(accessLog).toBeDefined();
    expect(accessLog?.data?.tool).toBe('lookup_corporate_by_number');
    expect(accessLog?.data?.count).toBe(1);
    expect(typeof accessLog?.data?.duration_ms).toBe('number');
    expect(JSON.stringify(accessLog?.data)).not.toContain(targetNumber);
  });

  it('search_corporate_by_name logs tool, count, duration_ms and never the query word', async () => {
    const logEntries: Array<{ level: string; logger: string; data?: Record<string, unknown> }> = [];
    const spyLogger: McpLogger = {
      setLevel: () => {},
      getLevel: () => 'info',
      log: (level, logger, data) => logEntries.push({ level, logger, data }),
      debug: (logger, data) => logEntries.push({ level: 'debug', logger, data }),
      info: (logger, data) => logEntries.push({ level: 'info', logger, data }),
      warn: (logger, data) => logEntries.push({ level: 'warn', logger, data }),
      warning: (logger, data) => logEntries.push({ level: 'warn', logger, data }),
      error: (logger, data) => logEntries.push({ level: 'error', logger, data }),
    };

    const client = await setupClient(spyLogger);
    const queryWord = 'テスト企業名検索ワード';
    await client.callTool({
      name: 'search_corporate_by_name',
      arguments: { name: queryWord },
    });

    const accessLog = logEntries.find((e) => e.logger === 'tool_access');
    expect(accessLog).toBeDefined();
    expect(accessLog?.data?.tool).toBe('search_corporate_by_name');
    expect(accessLog?.data?.count).toBe(1);
    expect(typeof accessLog?.data?.duration_ms).toBe('number');
    expect(JSON.stringify(accessLog?.data)).not.toContain(queryWord);
  });
});
