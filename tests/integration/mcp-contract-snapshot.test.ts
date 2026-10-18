/**
 * MCP Contract Snapshot Tests
 *
 * 根拠 / Source: Linear issue SLA2-328
 * - tools/list と prompts/list の出力を丸ごと保存して比較するスナップショットテスト。
 * - 今後の SDK v2・ext-apps 2.x 移行時にも、ツールの定義（名前・説明文・引数スキーマ・
 *   出力スキーマ・アノテーション・_meta）およびプロンプトの定義が1文字も変わらないことを保証する。
 *   （ChatGPT Directory は掲載後のツール定義変更で再審査となるため）
 */

import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/mcp.js';
import type { DataSourceMode } from '../../src/domain/tool-annotations.js';

async function createConnectedClient(dataSource: DataSourceMode): Promise<Client> {
  const server = createServer({ dataSource });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'mcp-contract-snapshot-tester', version: '1.0.0' },
    { capabilities: {} },
  );
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

describe('MCP Contract Snapshot Tests (SLA2-328)', () => {
  describe('tools/list snapshots and invariant contracts', () => {
    it('matches snapshot for hosted DB mode (提出用・自社DB保持データ)', async () => {
      const client = await createConnectedClient('db');
      const response = await client.listTools();

      // スナップショット検証: ツール定義の完全一致（順序・スキーマ・文言・アノテーション・_meta）
      expect(response).toMatchSnapshot();

      // 契約不変表明 (Invariants)
      expect(response.tools).toHaveLength(5);
      const toolNames = response.tools.map((t) => t.name).sort();
      expect(toolNames).toEqual([
        'lookup_corporate_by_number',
        'lookup_invoice_issuer',
        'normalize_company_name',
        'search_corporate_by_name',
        'validate_corporate_number',
      ]);

      // ホストDB版のアノテーション契約（仕様 v1.8：照会ツール3種は openWorldHint: true、純粋関数2種は false）
      for (const tool of response.tools) {
        expect(tool.annotations?.readOnlyHint).toBe(true);
        expect(tool.annotations?.destructiveHint).toBe(false);
        expect(tool.annotations?.idempotentHint).toBe(true);
      }
      expect(response.tools.find((t) => t.name === 'lookup_corporate_by_number')?.annotations?.openWorldHint).toBe(true);
      expect(response.tools.find((t) => t.name === 'search_corporate_by_name')?.annotations?.openWorldHint).toBe(true);
      expect(response.tools.find((t) => t.name === 'lookup_invoice_issuer')?.annotations?.openWorldHint).toBe(true);
      expect(response.tools.find((t) => t.name === 'validate_corporate_number')?.annotations?.openWorldHint).toBe(false);
      expect(response.tools.find((t) => t.name === 'normalize_company_name')?.annotations?.openWorldHint).toBe(false);

      // UIメタデータ (_meta.ui.resourceUri) の登録対象確認
      const numberTool = response.tools.find((t) => t.name === 'lookup_corporate_by_number');
      const searchTool = response.tools.find((t) => t.name === 'search_corporate_by_name');
      const invoiceTool = response.tools.find((t) => t.name === 'lookup_invoice_issuer');
      const validateTool = response.tools.find((t) => t.name === 'validate_corporate_number');
      const normalizeTool = response.tools.find((t) => t.name === 'normalize_company_name');

      const numberMeta = numberTool?._meta as { ui?: { resourceUri?: string } } | undefined;
      const searchMeta = searchTool?._meta as { ui?: { resourceUri?: string } } | undefined;
      expect(numberMeta?.ui?.resourceUri).toBe('ui://corporate-card/mcp-app.html');
      expect(searchMeta?.ui?.resourceUri).toBe('ui://search-results/mcp-app.html');
      expect(invoiceTool?._meta).toBeUndefined();
      expect(validateTool?._meta).toBeUndefined();
      expect(normalizeTool?._meta).toBeUndefined();
    });

    it('matches snapshot for local Web-API mode (ローカル実行版)', async () => {
      const client = await createConnectedClient('web-api');
      const response = await client.listTools();

      // スナップショット検証
      expect(response).toMatchSnapshot();

      // ローカルWeb-API版では外部通信を行うツールのみ openWorldHint が true
      const numberTool = response.tools.find((t) => t.name === 'lookup_corporate_by_number');
      const searchTool = response.tools.find((t) => t.name === 'search_corporate_by_name');
      const invoiceTool = response.tools.find((t) => t.name === 'lookup_invoice_issuer');
      const validateTool = response.tools.find((t) => t.name === 'validate_corporate_number');
      const normalizeTool = response.tools.find((t) => t.name === 'normalize_company_name');

      expect(numberTool?.annotations?.openWorldHint).toBe(true);
      expect(searchTool?.annotations?.openWorldHint).toBe(true);
      expect(invoiceTool?.annotations?.openWorldHint).toBe(true);
      expect(validateTool?.annotations?.openWorldHint).toBe(false);
      expect(normalizeTool?.annotations?.openWorldHint).toBe(false);
    });
  });

  describe('prompts/list snapshots and invariant contracts', () => {
    it('matches snapshot for prompts/list', async () => {
      const client = await createConnectedClient('db');
      const response = await client.listPrompts();

      // スナップショット検証: プロンプト定義の完全一致
      expect(response).toMatchSnapshot();

      // 契約不変表明
      expect(response.prompts).toHaveLength(3);
      const promptNames = response.prompts.map((p) => p.name).sort();
      expect(promptNames).toEqual([
        'company-master-record',
        'customer-master-dedup',
        'sales-list-enrichment',
      ]);

      // 全プロンプトで個人情報除外の注記と禁止用語の不使用を検証
      for (const prompt of response.prompts) {
        expect(prompt.description).toContain('※個人の連絡先情報は入力しないでください。');
        expect(prompt.description).not.toContain('名刺');
        expect(prompt.description).not.toContain('登記');
        expect(prompt.arguments).toBeDefined();
      }
    });
  });

  describe('resources/list snapshots and invariant contracts', () => {
    it('matches snapshot for resources/list (リソースはUIリソースのみ)', async () => {
      const client = await createConnectedClient('db');
      const response = await client.listResources();

      // スナップショット検証: UIリソース2件のみ
      expect(response).toMatchSnapshot();

      expect(response.resources).toHaveLength(2);
      const uris = response.resources.map((r) => r.uri).sort();
      expect(uris).toEqual([
        'ui://corporate-card/mcp-app.html',
        'ui://search-results/mcp-app.html',
      ]);
    });
  });
});
