/**
 * Tool integration tests — MCP McpServer を実際にインスタンス化し、
 * in-memory transport 経由で tools/call を叩いて end-to-end 動作を検証する。
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
import { Result } from '../../src/lib/result.js';

const sampleCorporation = {
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
  furigana: '',
  hihyoji: '1' as const,
};

const mockNtaClient: NtaClient = {
  async lookupByNumber(params) {
    if (params.numbers.includes('5111101000006')) {
      return Result.ok({
        header: { lastUpdateDate: '2019-04-05', count: 1, divideNumber: 1, divideSize: 1 },
        corporations: [sampleCorporation],
      });
    }
    return Result.ok({
      header: { lastUpdateDate: '2019-04-05', count: 0, divideNumber: 1, divideSize: 1 },
      corporations: [],
    });
  },
  async searchByName(_params) {
    return Result.ok({
      header: { lastUpdateDate: '2019-04-05', count: 1, divideNumber: 1, divideSize: 1 },
      corporations: [sampleCorporation],
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
  it('tools/list returns 5 tools', async () => {
    const client = await setupClient();
    const result = await client.listTools();
    expect(result.tools.length).toBe(5);
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'get_attribution',
      'lookup_corporate_by_number',
      'normalize_company_name',
      'search_corporate_by_name',
      'validate_corporate_number',
    ]);
  });

  it('all tools have "When NOT to use" guidance in description', async () => {
    const client = await setupClient();
    const result = await client.listTools();
    for (const tool of result.tools) {
      expect(tool.description ?? '').toMatch(/DO NOT USE WHEN|USE THIS WHEN/);
    }
  });

  it('all tools declare readOnlyHint=true, destructiveHint=false', async () => {
    const client = await setupClient();
    const result = await client.listTools();
    for (const tool of result.tools) {
      const ann = tool.annotations;
      expect(ann?.readOnlyHint).toBe(true);
      expect(ann?.destructiveHint).toBe(false);
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

  it('lookup_corporate_by_number returns corporation', async () => {
    const client = await setupClient();
    const result = await client.callTool({
      name: 'lookup_corporate_by_number',
      arguments: { corporate_numbers: ['5111101000006'] },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { corporations: Array<{ name: string }> };
    expect(structured.corporations).toHaveLength(1);
    expect(structured.corporations[0]?.name).toBe('株式会社検索対象除外');
  });

  it('lookup_corporate_by_number rejects invalid check digit', async () => {
    const client = await setupClient();
    const result = await client.callTool({
      name: 'lookup_corporate_by_number',
      arguments: { corporate_numbers: ['1111111111111'] },
    });
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as {
      invalid_inputs: Array<{ reason: string }>;
    };
    expect(structured.invalid_inputs[0]?.reason).toBe('check_digit_mismatch');
  });

  it('search_corporate_by_name returns corporations + pagination meta', async () => {
    const client = await setupClient();
    const result = await client.callTool({
      name: 'search_corporate_by_name',
      arguments: { name: 'テスト' },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      total: number;
      next_cursor: string | null;
      corporations: unknown[];
    };
    expect(structured.total).toBe(1);
    expect(structured.next_cursor).toBeNull();
    expect(structured.corporations.length).toBe(1);
  });

  it('validate_corporate_number — valid case (no API call)', async () => {
    const client = await setupClient();
    const result = await client.callTool({
      name: 'validate_corporate_number',
      arguments: { corporate_number: '5111101000006' },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      is_valid: boolean;
      normalized: string | null;
    };
    expect(structured.is_valid).toBe(true);
    expect(structured.normalized).toBe('5111101000006');
  });

  it('validate_corporate_number — invalid case includes guidance', async () => {
    const client = await setupClient();
    const result = await client.callTool({
      name: 'validate_corporate_number',
      arguments: { corporate_number: '1111111111111' },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      is_valid: boolean;
      reason: string;
      guidance: string;
    };
    expect(structured.is_valid).toBe(false);
    expect(structured.reason).toBe('check_digit_mismatch');
    expect(structured.guidance).toMatch(/チェックデジット|番号/);
  });

  it('normalize_company_name — generates candidates with attribution', async () => {
    const client = await setupClient();
    const result = await client.callTool({
      name: 'normalize_company_name',
      arguments: { raw_input: '（株）高橋商事' },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      normalized_candidates: Array<{ name: string; kind_hint: string }>;
      attribution: { license: string };
    };
    expect(structured.normalized_candidates.length).toBeGreaterThan(0);
    expect(structured.attribution.license).toBe('公共データ利用規約 第1.0版');
    const hasKabu = structured.normalized_candidates.some(
      (c) => c.kind_hint === 'kabushiki_kaisha',
    );
    expect(hasKabu).toBe(true);
  });

  it('get_attribution — full format', async () => {
    const client = await setupClient();
    const result = await client.callTool({
      name: 'get_attribution',
      arguments: { format: 'full', language: 'ja' },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      attribution: { service_disclaimer: string };
      formatted_text: string;
    };
    expect(structured.attribution.service_disclaimer).toContain('国税庁法人番号システム Web-API');
    expect(structured.formatted_text).toContain('出典');
  });

  it('get_attribution — citation format is short', async () => {
    const client = await setupClient();
    const result = await client.callTool({
      name: 'get_attribution',
      arguments: { format: 'citation', language: 'ja' },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { formatted_text: string };
    expect(structured.formatted_text).toMatch(/^出典:/);
  });
});

describe('MCP Resources integration', () => {
  it('resources/list returns attribution resource', async () => {
    const client = await setupClient();
    const result = await client.listResources();
    const names = result.resources.map((r) => r.uri);
    expect(names).toContain('attribution://houjin-bangou');
    expect(names).toContain('ui://corporate-card/mcp-app.html');
    expect(names).toContain('ui://search-results/mcp-app.html');
  });

  it('resources/templates/list returns corp template', async () => {
    const client = await setupClient();
    const result = await client.listResourceTemplates();
    const templates = result.resourceTemplates.map((t) => t.uriTemplate);
    expect(templates).toContain('corp://{corporate_number}');
  });

  it('resources/read attribution://houjin-bangou returns JSON', async () => {
    const client = await setupClient();
    const result = await client.readResource({ uri: 'attribution://houjin-bangou' });
    expect(result.contents.length).toBeGreaterThan(0);
    const first = result.contents[0];
    if (first === undefined || !('text' in first) || typeof first.text !== 'string') {
      throw new Error('Expected text resource');
    }
    const parsed = JSON.parse(first.text) as { service_disclaimer: string };
    expect(parsed.service_disclaimer).toContain('国税庁法人番号システム');
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

  it('resources/read corp://{number} with valid number returns corporation', async () => {
    const client = await setupClient();
    const result = await client.readResource({ uri: 'corp://5111101000006' });
    const first = result.contents[0];
    if (first === undefined || !('text' in first) || typeof first.text !== 'string') {
      throw new Error('Expected text resource');
    }
    const parsed = JSON.parse(first.text) as { corporation: { name: string } | null };
    expect(parsed.corporation?.name).toBe('株式会社検索対象除外');
  });
});

describe('MCP Completion integration', () => {
  it('completion/complete on corp template with company name returns candidates', async () => {
    const client = await setupClient();
    const result = await client.complete({
      ref: { type: 'ref/resource', uri: 'corp://{corporate_number}' },
      argument: { name: 'corporate_number', value: '株式会社スグクル' },
    });
    expect(result.completion.values.length).toBeGreaterThan(0);
    expect(result.completion.values).toContain('株式会社スグクル');
  });

  it('completion/complete on corp template with partial digits returns empty (no partial number search)', async () => {
    const client = await setupClient();
    const result = await client.complete({
      ref: { type: 'ref/resource', uri: 'corp://{corporate_number}' },
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
      arguments: { corporate_numbers: [targetNumber] },
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

