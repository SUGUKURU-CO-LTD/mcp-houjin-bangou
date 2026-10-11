import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerAllPrompts } from '../../src/prompts/index.js';
import { registerCompletionHandler } from '../../src/completion/handler.js';
import { createMcpLogger } from '../../src/lib/mcp-logger.js';

async function setupClient(): Promise<Client> {
  const server = new McpServer(
    { name: 'test-server', version: '0.0.1' },
    {
      capabilities: {
        prompts: { listChanged: false },
        completions: {},
      },
    },
  );
  const logger = createMcpLogger(server.server, 'info');
  registerAllPrompts(server);
  registerCompletionHandler(server.server, { logger });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.1' }, { capabilities: {} });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

describe('MCP Prompts integration', () => {
  it('prompts/list returns 3 prompts', async () => {
    const client = await setupClient();
    const result = await client.listPrompts();
    const names = result.prompts.map((p) => p.name).sort();
    expect(names).toEqual([
      'business-card-to-database',
      'customer-master-dedup',
      'sales-list-enrichment',
    ]);
  });

  it('business-card-to-database renders with provided raw text', async () => {
    const client = await setupClient();
    const result = await client.getPrompt({
      name: 'business-card-to-database',
      arguments: {
        raw_business_card_text: '株式会社スグクル\n代表取締役 壁\n鹿児島県鹿児島市',
        target_database_format: 'plain_summary',
      },
    });
    expect(result.messages.length).toBeGreaterThan(0);
    const first = result.messages[0];
    expect(first?.role).toBe('user');
    const text = (first?.content as { type: string; text: string }).text;
    expect(text).toContain('株式会社スグクル');
    expect(text).toContain('normalize_company_name');
    expect(text).toContain('search_corporate_by_name');
    expect(text).toContain('attribution');
  });

  it('sales-list-enrichment accepts prefecture filter', async () => {
    const client = await setupClient();
    const result = await client.getPrompt({
      name: 'sales-list-enrichment',
      arguments: {
        company_names: '（株）高橋商事\n有限会社テスト\nスグクル',
        prefecture_filter: '46',
        output_format: 'markdown_table',
      },
    });
    const text = (result.messages[0]?.content as { text: string }).text;
    expect(text).toContain('（株）高橋商事');
    expect(text).toContain('JIS コード: 46');
    expect(text).toContain('markdown_table');
  });

  it('customer-master-dedup respects dedup criteria', async () => {
    const client = await setupClient();
    const result = await client.getPrompt({
      name: 'customer-master-dedup',
      arguments: {
        records: '{"id":"1","name":"スグクル"}',
        dedup_criteria: 'strict_corporate_number',
      },
    });
    const text = (result.messages[0]?.content as { text: string }).text;
    expect(text).toContain('HUMAN_REVIEW_REQUIRED');
    expect(text).toContain('確定重複');
  });
});

describe('Completion on prompt arguments', () => {
  it('target_database_format enum completion', async () => {
    const client = await setupClient();
    const result = await client.complete({
      ref: { type: 'ref/prompt', name: 'business-card-to-database' },
      argument: { name: 'target_database_format', value: '' },
    });
    expect(result.completion.values).toContain('crm_json');
    expect(result.completion.values).toContain('salesforce_csv');
    expect(result.completion.values).toContain('plain_summary');
  });

  it('output_format prefix filter', async () => {
    const client = await setupClient();
    const result = await client.complete({
      ref: { type: 'ref/prompt', name: 'sales-list-enrichment' },
      argument: { name: 'output_format', value: 'mark' },
    });
    expect(result.completion.values).toEqual(['markdown_table']);
  });

  it('company_name argument triggers T7 normalization', async () => {
    const client = await setupClient();
    const result = await client.complete({
      ref: { type: 'ref/prompt', name: 'business-card-to-database' },
      argument: { name: 'raw_input', value: '株式会社スグクル' },
    });
    expect(result.completion.values.length).toBeGreaterThan(0);
    expect(result.completion.values).toContain('株式会社スグクル');
  });
});
