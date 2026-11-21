import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerAllPrompts } from '../../src/prompts/index.js';
import { registerCompletionHandler } from '../../src/completion/handler.js';
import { createMcpLogger } from '../../src/lib/mcp-logger.js';
import {
  INVOICE_TAX_DISCLAIMER,
  NTA_CORPORATE_HOST_ATTRIBUTION,
  NTA_CORPORATE_WEB_API_ATTRIBUTION,
  NTA_INVOICE_HOST_ATTRIBUTION,
} from '../../src/lib/tool-response.js';
import type { DataSourceMode } from '../../src/domain/tool-annotations.js';

async function setupClient(dataSource: DataSourceMode = 'web-api'): Promise<Client> {
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
  registerAllPrompts(server, { dataSource });
  registerCompletionHandler(server.server, { logger });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.1' }, { capabilities: {} });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

describe('MCP Prompts integration (§2)', () => {
  it('prompts/list returns 4 prompts', async () => {
    const client = await setupClient();
    const result = await client.listPrompts();
    const names = result.prompts.map((p) => p.name).sort();
    expect(names).toEqual([
      'company-master-record',
      'customer-master-dedup',
      'invoice-verification-check',
      'sales-list-enrichment',
    ]);
  });

  it('all prompts require personal contact exclusion in descriptions and avoid forbidden terms', async () => {
    const client = await setupClient();
    const result = await client.listPrompts();

    for (const prompt of result.prompts) {
      expect(prompt.description).toContain('※個人の連絡先情報は入力しないでください。');
      expect(prompt.description).not.toContain('名刺');
      expect(prompt.description).not.toContain('登記');
    }
  });

  describe('company-master-record prompt (§2.1)', () => {
    it('renders with company_name and optional location_hint in web-api and db modes', async () => {
      const client = await setupClient('web-api');
      const result = await client.getPrompt({
        name: 'company-master-record',
        arguments: {
          company_name: 'スグクル株式会社',
          location_hint: '鹿児島県霧島市',
        },
      });

      expect(result.messages.length).toBeGreaterThan(0);
      const first = result.messages[0];
      expect(first?.role).toBe('user');
      const text = (first?.content as { type: string; text: string }).text;
      expect(text).toContain('スグクル株式会社');
      expect(text).toContain('所在地の手がかり: 鹿児島県霧島市');
      expect(text).toContain('search_query_optimized');
      expect(text).toContain(NTA_CORPORATE_WEB_API_ATTRIBUTION);
      expect(text).not.toContain('名刺');
      expect(text).not.toContain('登記');

      const dbClient = await setupClient('db');
      const dbRes = await dbClient.getPrompt({
        name: 'company-master-record',
        arguments: { company_name: 'スグクル株式会社' },
      });
      const dbText = (dbRes.messages[0]?.content as { type: string; text: string }).text;
      expect(dbText).toContain(NTA_CORPORATE_HOST_ATTRIBUTION);
      expect(dbText).not.toContain(NTA_CORPORATE_WEB_API_ATTRIBUTION);
      expect(dbText).not.toContain('名刺');
      expect(dbText).not.toContain('登記');
    });

    it('renders without location_hint', async () => {
      const client = await setupClient();
      const result = await client.getPrompt({
        name: 'company-master-record',
        arguments: {
          company_name: 'スグクル株式会社',
        },
      });

      const text = (result.messages[0]?.content as { type: string; text: string }).text;
      expect(text).toContain('スグクル株式会社');
      expect(text).not.toContain('所在地の手がかり:');
    });

    it('rejects missing company_name', async () => {
      const client = await setupClient();
      await expect(
        client.getPrompt({
          name: 'company-master-record',
          arguments: {},
        }),
      ).rejects.toThrow();
    });
  });

  describe('customer-master-dedup prompt (§2.2)', () => {
    it('renders with target_company_name and current_address', async () => {
      const client = await setupClient();
      const result = await client.getPrompt({
        name: 'customer-master-dedup',
        arguments: {
          target_company_name: 'スグクル株式会社',
          current_address: '鹿児島県霧島市国分中央１丁目２−３２',
        },
      });

      const text = (result.messages[0]?.content as { type: string; text: string }).text;
      expect(text).toContain('スグクル株式会社');
      expect(text).toContain('照合用住所: 鹿児島県霧島市国分中央１丁目２−３２');
      expect(text).toContain(NTA_CORPORATE_WEB_API_ATTRIBUTION);
      expect(text).not.toContain('名刺');
      expect(text).not.toContain('登記');
    });

    it('renders without current_address', async () => {
      const client = await setupClient();
      const result = await client.getPrompt({
        name: 'customer-master-dedup',
        arguments: {
          target_company_name: 'スグクル株式会社',
        },
      });

      const text = (result.messages[0]?.content as { type: string; text: string }).text;
      expect(text).toContain('スグクル株式会社');
      expect(text).not.toContain('照合用住所:');
    });

    it('rejects missing target_company_name', async () => {
      const client = await setupClient();
      await expect(
        client.getPrompt({
          name: 'customer-master-dedup',
          arguments: {},
        }),
      ).rejects.toThrow();
    });
  });

  describe('sales-list-enrichment prompt (§2.3)', () => {
    it('renders valid list within 20 companies in web-api and db modes', async () => {
      const client = await setupClient('web-api');
      const companies = Array.from({ length: 20 }, (_, i) => `テスト株式会社${i + 1}`).join('\n');
      const result = await client.getPrompt({
        name: 'sales-list-enrichment',
        arguments: {
          company_list_text: companies,
        },
      });

      const text = (result.messages[0]?.content as { type: string; text: string }).text;
      expect(text).toContain('全20社');
      expect(text).toContain('1. テスト株式会社1');
      expect(text).toContain('20. テスト株式会社20');
      expect(text).toContain(NTA_CORPORATE_WEB_API_ATTRIBUTION);
      expect(text).not.toContain('名刺');
      expect(text).not.toContain('登記');

      const dbClient = await setupClient('db');
      const dbResult = await dbClient.getPrompt({
        name: 'sales-list-enrichment',
        arguments: { company_list_text: 'スグクル株式会社' },
      });
      const dbText = (dbResult.messages[0]?.content as { type: string; text: string }).text;
      expect(dbText).toContain(NTA_CORPORATE_HOST_ATTRIBUTION);
      expect(dbText).not.toContain('名刺');
      expect(dbText).not.toContain('登記');
    });

    it('rejects more than 20 companies (21 companies) with error', async () => {
      const client = await setupClient();
      const companies21 = Array.from({ length: 21 }, (_, i) => `企業${i + 1}`).join('\n');

      await expect(
        client.getPrompt({
          name: 'sales-list-enrichment',
          arguments: {
            company_list_text: companies21,
          },
        }),
      ).rejects.toThrow(/一度に指定できる企業数は最大20社です/);
    });

    it('rejects empty company_list_text', async () => {
      const client = await setupClient();
      await expect(
        client.getPrompt({
          name: 'sales-list-enrichment',
          arguments: {
            company_list_text: '   \n\n  ',
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('invoice-verification-check prompt (§2.4)', () => {
    it('renders verification workflow with T-number, transaction_date, and issuer_name in web-api and db modes', async () => {
      const client = await setupClient('db');
      const result = await client.getPrompt({
        name: 'invoice-verification-check',
        arguments: {
          registration_number: 'T9340001026142',
          transaction_date: '2026-10-01',
          issuer_name: '（株）スグクル',
        },
      });

      const text = (result.messages[0]?.content as { type: string; text: string }).text;
      expect(text).toContain('T9340001026142');
      expect(text).toContain('9340001026142');
      expect(text).toContain('取引年月日（基準日）: 2026-10-01');
      expect(text).toContain('請求書記載の発行元法人名: （株）スグクル');
      expect(text).toContain('lookup_invoice_issuer');
      expect(text).toContain('lookup_corporate_by_number');
      expect(text).toContain(NTA_INVOICE_HOST_ATTRIBUTION);
      expect(text).toContain(NTA_CORPORATE_HOST_ATTRIBUTION);
      expect(text).toContain(INVOICE_TAX_DISCLAIMER);
      expect(text).not.toContain('名刺');
      expect(text).not.toContain('登記');

      // Normalizes 13-digit input without leading T
      const webClient = await setupClient('web-api');
      const webRes = await webClient.getPrompt({
        name: 'invoice-verification-check',
        arguments: {
          registration_number: '9340001026142',
        },
      });
      const webText = (webRes.messages[0]?.content as { type: string; text: string }).text;
      expect(webText).toContain('registration_number="T9340001026142"');
      expect(webText).toContain(NTA_CORPORATE_WEB_API_ATTRIBUTION);
      expect(webText).not.toContain('名刺');
      expect(webText).not.toContain('登記');
    });

    it('rejects malformed registration_number and impossible calendar dates', async () => {
      const client = await setupClient('db');
      await expect(
        client.getPrompt({
          name: 'invoice-verification-check',
          arguments: { registration_number: 'T12345' },
        }),
      ).rejects.toThrow();

      await expect(
        client.getPrompt({
          name: 'invoice-verification-check',
          arguments: {
            registration_number: 'T9340001026142',
            transaction_date: '2026-02-31',
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('Completion on prompt arguments', () => {
    it('company_name triggers deduplicated normalizer completion', async () => {
      const client = await setupClient();
      const result = await client.complete({
        ref: { type: 'ref/prompt', name: 'company-master-record' },
        argument: { name: 'company_name', value: '株式会社スグクル' },
      });
      expect(result.completion.values.length).toBeGreaterThan(0);
      expect(result.completion.values).toContain('株式会社スグクル');
      expect(new Set(result.completion.values).size).toBe(result.completion.values.length);
    });

    it('target_company_name and issuer_name trigger normalizer completion', async () => {
      const client = await setupClient();
      const result = await client.complete({
        ref: { type: 'ref/prompt', name: 'customer-master-dedup' },
        argument: { name: 'target_company_name', value: 'スグクル' },
      });
      expect(result.completion.values.length).toBeGreaterThan(0);

      const invComp = await client.complete({
        ref: { type: 'ref/prompt', name: 'invoice-verification-check' },
        argument: { name: 'issuer_name', value: '（株）スグクル' },
      });
      expect(invComp.completion.values).toContain('株式会社スグクル');
    });
  });
});
