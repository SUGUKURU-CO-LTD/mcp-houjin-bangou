/**
 * Tool integration tests — MCP McpServer を実際にインスタンス化し、
 * in-memory transport 経由で tools/call を叩いて end-to-end 動作を検証する。
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md (v1.4 凍結仕様)
 *   B2 要件: 応答の最小化、3.1節共通レスポンス、アノテーション、カーソルと data_as_of
 */

import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerAllTools } from '../../src/tools/index.js';
import { registerAllResources } from '../../src/resources/index.js';
import { registerCompletionHandler } from '../../src/completion/handler.js';
import { createMcpLogger, type McpLogger } from '../../src/lib/mcp-logger.js';
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

const sampleClosedCorporation = {
  sequence_number: 2,
  corporate_number: '9340001026142',
  process: '01',
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
  close_cause: '01', // 清算の結了等
  successor_corporate_number: '',
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

const mockNtaClient: NtaClient = {
  async lookupByNumber(params) {
    if (params.numbers.includes('5111101000006')) {
      return Result.ok({
        header: { lastUpdateDate: '2019-04-05', count: 1, divideNumber: 1, divideSize: 1 },
        corporations: [sampleActiveCorporation],
      });
    }
    if (params.numbers.includes('9340001026142')) {
      return Result.ok({
        header: { lastUpdateDate: '2026-08-05', count: 1, divideNumber: 1, divideSize: 1 },
        corporations: [sampleClosedCorporation],
      });
    }
    return Result.ok({
      header: { lastUpdateDate: '2019-04-05', count: 0, divideNumber: 1, divideSize: 1 },
      corporations: [],
    });
  },
  async searchByName(params) {
    if (params.name === '多数件') {
      const corps = Array.from({ length: 25 }, (_, i) => ({
        ...sampleActiveCorporation,
        corporateNumber: String(1000000000000 + i),
        name: `テスト法人第${i + 1}号`,
      }));
      return Result.ok({
        header: { lastUpdateDate: '2026-10-12', count: 25, divideNumber: 1, divideSize: 1 },
        corporations: corps,
      });
    }
    if (params.name === '複数件') {
      return Result.ok({
        header: { lastUpdateDate: '2026-10-12', count: 2, divideNumber: 1, divideSize: 1 },
        corporations: [sampleActiveCorporation, sampleClosedCorporation],
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
        completions: {},
      },
    },
  );
  const logger = customLogger ?? createMcpLogger(server.server, 'info');
  registerAllTools(server, { ntaClient: mockNtaClient, logger });
  registerAllResources(server, { ntaClient: mockNtaClient, logger });
  registerCompletionHandler(server.server, { logger });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'test-client', version: '0.0.1' },
    { capabilities: { sampling: undefined } },
  );
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

describe('MCP Tools integration (via in-memory transport)', () => {
  it('tools/list returns 4 tools in v1.4 spec (get_attribution removed per O1)', async () => {
    const client = await setupClient();
    const result = await client.listTools();
    expect(result.tools.length).toBe(4);
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'lookup_corporate_by_number',
      'normalize_company_name',
      'search_corporate_by_name',
      'validate_corporate_number',
    ]);
  });

  it('all tools have descriptive Japanese text in description', async () => {
    const client = await setupClient();
    const result = await client.listTools();
    for (const tool of result.tools) {
      expect(tool.description).toBeDefined();
      expect(tool.description?.length).toBeGreaterThan(10);
    }
  });

  it('all tools declare valid MCP annotations per v1.4 spec', async () => {
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
        // Web-API版では外部通信を行うため openWorldHint は true
        expect(ann?.openWorldHint).toBe(true);
      }
    }
  });

  it('lookup/search tools expose UI resource metadata', async () => {
    const client = await setupClient();
    const result = await client.listTools();
    const lookup = result.tools.find((t) => t.name === 'lookup_corporate_by_number');
    const search = result.tools.find((t) => t.name === 'search_corporate_by_name');
    expect((lookup?._meta?.['ui'] as { resourceUri?: string } | undefined)?.resourceUri).toBe(
      'ui://corporate-card/mcp-app.html',
    );
    expect((search?._meta?.['ui'] as { resourceUri?: string } | undefined)?.resourceUri).toBe(
      'ui://search-results/mcp-app.html',
    );
  });

  it('lookup_corporate_by_number returns active corporation with v1.4 schema and summary text', async () => {
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
    expect(structured.data_as_of).toBe('2019-04-05');
    expect(typeof structured.attribution).toBe('string');

    // 3.1節: 要約テキスト1つに data_as_of と 出典表示を含む
    const textContent = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(textContent).toContain('2019-04-05');
    expect(textContent).toContain(structured.attribution);
  });

  it('lookup_corporate_by_number returns closed corporation with close_date and close_cause', async () => {
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
      };
    };
    expect(structured.corporation.status).toBe('closed');
    expect(structured.corporation.close_date).toBe('2026-08-01');
    expect(structured.corporation.close_cause).toBe('清算の結了等');
  });

  it('lookup_corporate_by_number returns NOT_FOUND when corporate number is not in NTA dataset', async () => {
    const client = await setupClient();
    const result = await client.callTool({
      name: 'lookup_corporate_by_number',
      arguments: { corporate_number: '4111101000007' }, // 有効なチェックデジットだが未登録
    });
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as {
      error: { code: string; message: string };
    };
    expect(structured.error.code).toBe('NOT_FOUND');
  });

  it('lookup_corporate_by_number rejects invalid check digit with INVALID_INPUT', async () => {
    const client = await setupClient();
    const result = await client.callTool({
      name: 'lookup_corporate_by_number',
      arguments: { corporate_number: '1111111111111' },
    });
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as {
      error: { code: string; message: string };
    };
    expect(structured.error.code).toBe('INVALID_INPUT');
    expect(structured.error.message).toContain('チェックデジット');
  });

  it('search_corporate_by_name returns corporations with status and pagination meta', async () => {
    const client = await setupClient();
    const result = await client.callTool({
      name: 'search_corporate_by_name',
      arguments: { name: 'テスト' },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      total_count: number;
      next_cursor: string | null;
      results: Array<{ corporate_number: string; status: string }>;
      data_as_of: string;
      attribution: string;
    };
    expect(structured.total_count).toBe(1);
    expect(structured.next_cursor).toBeNull();
    expect(structured.results.length).toBe(1);
    expect(structured.results[0]?.status).toBe('active');
    expect(structured.data_as_of).toBe('2019-04-05');
    expect(typeof structured.attribution).toBe('string');

    // 要約テキストに data_as_of と 出典が含まれること
    const textContent = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(textContent).toContain('2019-04-05');
    expect(textContent).toContain(structured.attribution);
  });

  it('search_corporate_by_name returns next_cursor when limit is smaller than total items', async () => {
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
    expect(structured.total_count).toBe(2);
    expect(structured.results.length).toBe(1);
    expect(structured.next_cursor).not.toBeNull();
  });

  it('search_corporate_by_name rejects stale cursor with INVALID_INPUT when data_as_of differs', async () => {
    const client = await setupClient();
    // 古いデータ時点 '2015-01-01' に結びついたカーソルを生成
    const staleCursor = encodeNameSearchCursor({
      offset: 10,
      data_as_of: '2015-01-01',
      divide: 1,
    });

    const result = await client.callTool({
      name: 'search_corporate_by_name',
      arguments: { name: 'テスト', cursor: staleCursor },
    });
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as {
      error: { code: string; message: string };
    };
    expect(structured.error.code).toBe('INVALID_INPUT');
    expect(structured.error.message).toContain('公表データが更新されたため');
  });

  it('search_corporate_by_name enforces result size upper bound and limit rules (default 10, max 20, rejects limit > 20 with INVALID_INPUT)', async () => {
    const client = await setupClient();

    // 1. limit 未指定 (既定値 10 件上限)
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

    // 2. limit: 20 (最大値 20 件上限)
    const maxRes = await client.callTool({
      name: 'search_corporate_by_name',
      arguments: { name: '多数件', limit: 20 },
    });
    expect(maxRes.isError).toBeFalsy();
    const maxStructured = maxRes.structuredContent as {
      total_count: number;
      next_cursor: string | null;
      results: Array<unknown>;
    };
    expect(maxStructured.results.length).toBe(20);
    expect(maxStructured.next_cursor).not.toBeNull();

    // 3. limit: 21 (上限 20 件の超過は INVALID_INPUT で拒否)
    const invalidRes = await client.callTool({
      name: 'search_corporate_by_name',
      arguments: { name: '多数件', limit: 21 },
    });
    expect(invalidRes.isError).toBe(true);
    const contentText = (invalidRes.content as Array<{ text: string }>)[0]?.text;
    expect(contentText).toMatch(/20|too_big|INVALID_INPUT/);
  });

  it('validate_corporate_number — valid case (no API call)', async () => {
    const client = await setupClient();
    const result = await client.callTool({
      name: 'validate_corporate_number',
      arguments: { corporate_number: '5111101000006' },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      is_valid_format: boolean;
      is_valid_check_digit: boolean;
      error_reason: string | null;
    };
    expect(structured.is_valid_format).toBe(true);
    expect(structured.is_valid_check_digit).toBe(true);
    expect(structured.error_reason).toBeNull();
  });

  it('validate_corporate_number — invalid case indicates error reason', async () => {
    const client = await setupClient();
    const result = await client.callTool({
      name: 'validate_corporate_number',
      arguments: { corporate_number: '1111111111111' },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      is_valid_format: boolean;
      is_valid_check_digit: boolean;
      error_reason: string | null;
    };
    expect(structured.is_valid_format).toBe(true);
    expect(structured.is_valid_check_digit).toBe(false);
    expect(structured.error_reason).toBe('check_digit_mismatch');
  });

  it('normalize_company_name — normalizes company names locally per v1.4 spec', async () => {
    const client = await setupClient();
    const result = await client.callTool({
      name: 'normalize_company_name',
      arguments: { raw_name: '（株）高橋商事' },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      normalized_name: string;
      legal_type: string | null;
      search_query_optimized: string;
    };
    expect(structured.normalized_name).toBe('株式会社高橋商事');
    expect(structured.legal_type).toBe('株式会社');
    expect(structured.search_query_optimized).toBe('高橋商事');
  });

  it('all tools do not include request ID, trace ID, or internal timestamp in outputs (§6.2)', async () => {
    const client = await setupClient();

    const lookupRes = await client.callTool({
      name: 'lookup_corporate_by_number',
      arguments: { corporate_number: '5111101000006' },
    });
    const searchRes = await client.callTool({
      name: 'search_corporate_by_name',
      arguments: { name: 'テスト' },
    });
    const validateRes = await client.callTool({
      name: 'validate_corporate_number',
      arguments: { corporate_number: '5111101000006' },
    });
    const normRes = await client.callTool({
      name: 'normalize_company_name',
      arguments: { raw_name: '株式会社スグクル' },
    });

    const responses = [lookupRes, searchRes, validateRes, normRes];
    for (const res of responses) {
      const jsonStr = JSON.stringify(res.structuredContent);
      expect(jsonStr).not.toMatch(
        /requestId|traceId|trace_id|request_id|internal_timestamp|processed_at/i,
      );
    }
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
  it('completion/complete on unregistered resource returns empty values', async () => {
    const client = await setupClient();
    const result = await client.complete({
      ref: { type: 'ref/resource', uri: 'corp://5111101000006' },
      argument: { name: 'corporate_number', value: '511' },
    });
    expect(result.completion.values).toEqual([]);
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
    // 法人番号が含まれていないことを検証
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
    // 検索語が含まれていないことを検証
    expect(JSON.stringify(accessLog?.data)).not.toContain(queryWord);
  });
});
