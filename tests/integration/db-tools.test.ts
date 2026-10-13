/**
 * Host Mode (DB Data Provider) MCP Tools Integration Tests
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1, §6.1, §6.2 (ホスト版統合テスト)
 *   実装指示書v1 §5(B4):
 *     - ホスト版では国税庁のアプリケーションIDを使わない
 *     - DB方式では openWorldHint を false にする
 *     - データ源の切り替えは設定1か所で行う
 *
 * 【テストデータの性格】
 *   本テストで使用しているデータはすべてテスト用に作成した「合成データ」であり、
 *   実在する事業者や個人の情報、国税庁本番データではありません。
 */

import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/mcp.js';
import { DbCorporateDataProvider } from '../../src/repository/corporate-repository.js';
import { NTA_CORPORATE_HOST_ATTRIBUTION } from '../../src/lib/tool-response.js';
import type { DbClient } from '../../src/db/client.js';

describe('Host Mode (DB) Integration Tests (合成テストデータ使用)', () => {
  const currentDataAsOf = '2026-10-01';

  const mockCorporateData = [
    {
      corporateNumber: '9340001026142',
      datasetVersionId: 1,
      name: 'スグクル株式会社',
      kind: '301',
      prefectureCode: '46',
      cityCode: '218',
      prefectureName: '鹿児島県',
      cityName: '霧島市',
      streetNumber: '国分中央一丁目２−３２',
      addressOutside: null,
      postCode: '8994332',
      updateDate: '2026-07-15',
      closeDate: null,
      closeCause: null,
      furigana: 'スグクルカブシキガイシャ',
    },
    {
      corporateNumber: '1000000000002',
      datasetVersionId: 1,
      name: 'テスト物流有限会社',
      kind: '302',
      prefectureCode: '46',
      cityCode: '218',
      prefectureName: '鹿児島県',
      cityName: '霧島市',
      streetNumber: '国分中央一丁目',
      addressOutside: null,
      postCode: '8994332',
      updateDate: '2026-05-01',
      closeDate: null,
      closeCause: null,
      furigana: 'テストブツリュウユウゲンガイシャ',
    },
  ];

  function createMockDb(): DbClient {
    return {
      select: (fields?: unknown) => ({
        from: () => ({
          where: () => {
            if (fields && typeof fields === 'object' && 'dataAsOf' in (fields as object)) {
              return {
                orderBy: () => ({
                  limit: () => Promise.resolve([{ id: 1, dataAsOf: currentDataAsOf }]),
                }),
              };
            }

            if (fields && typeof fields === 'object' && 'total' in (fields as object)) {
              return Promise.resolve([{ total: mockCorporateData.length }]);
            }

            return {
              limit: (limitCount: number) =>
                Promise.resolve(mockCorporateData.slice(0, limitCount)),
              orderBy: () => ({
                limit: (limitCount: number) => ({
                  offset: (offsetCount: number) =>
                    Promise.resolve(mockCorporateData.slice(offsetCount, offsetCount + limitCount)),
                }),
              }),
            };
          },
        }),
      }),
    } as unknown as DbClient;
  }

  async function setupHostClient() {
    const db = createMockDb();
    const dbProvider = new DbCorporateDataProvider(db);

    // NTA_APPLICATION_ID なし・DBモードで MCP サーバー初期化
    const mcpServer = createServer({
      dbProvider,
      dataSource: 'db',
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);

    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);

    return { client, mcpServer };
  }

  it('tools/list で各ツールの openWorldHint が false に設定されていること', async () => {
    const { client } = await setupHostClient();
    const toolsResult = await client.listTools();

    const lookupTool = toolsResult.tools.find((t) => t.name === 'lookup_corporate_by_number');
    const searchTool = toolsResult.tools.find((t) => t.name === 'search_corporate_by_name');

    expect(lookupTool).toBeDefined();
    expect(lookupTool?.annotations?.openWorldHint).toBe(false);

    expect(searchTool).toBeDefined();
    expect(searchTool?.annotations?.openWorldHint).toBe(false);
  });

  it('lookup_corporate_by_number: DBから取得し、ホスト版出典表示を返すこと', async () => {
    const { client } = await setupHostClient();

    const result = await client.callTool({
      name: 'lookup_corporate_by_number',
      arguments: { corporate_number: '9340001026142' },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc).toBeDefined();
    expect(sc.data_as_of).toBe(currentDataAsOf);
    expect(sc.attribution).toBe(NTA_CORPORATE_HOST_ATTRIBUTION);

    const corp = sc.corporation as Record<string, unknown>;
    expect(corp.name).toBe('スグクル株式会社');
    expect(corp.status).toBe('active');
  });

  it('search_corporate_by_name: DBから部分一致検索し、ホスト版出典表示を返すこと', async () => {
    const { client } = await setupHostClient();

    const result = await client.callTool({
      name: 'search_corporate_by_name',
      arguments: { name: 'テスト' },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc).toBeDefined();
    expect(sc.data_as_of).toBe(currentDataAsOf);
    expect(sc.attribution).toBe(NTA_CORPORATE_HOST_ATTRIBUTION);

    const results = sc.results as Array<Record<string, unknown>>;
    expect(results.length).toBe(2);
    expect(results[0]?.name).toBe('スグクル株式会社');
  });
});
