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
import { DbInvoiceDataProvider } from '../../src/repository/invoice-repository.js';
import {
  NTA_CORPORATE_HOST_ATTRIBUTION,
  NTA_INVOICE_HOST_ATTRIBUTION,
  INVOICE_TAX_DISCLAIMER,
} from '../../src/lib/tool-response.js';
import type { DbClient } from '../../src/db/client.js';
import { invoiceIssuers } from '../../src/db/schema.js';

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
      hihyoji: '0',
    },
    {
      corporateNumber: '7000000000002',
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
      hihyoji: '1',
    },
  ];

  const mockInvoiceData = [
    {
      registrationNumber: 'T9340001026142',
      sequenceNumber: 1,
      datasetVersionId: 1,
      process: '01',
      correct: '0',
      kind: '2',
      country: '1',
      latest: '1',
      registrationDate: '2023-10-01',
      updateDate: '2023-10-01',
      disposeDate: null,
      expireDate: null,
      cancelDate: null,
      legalName: 'スグクル株式会社',
      tradeName: null,
      kana: 'スグクルカブシキガイシャ',
      addressPrefecture: '鹿児島県',
      addressCity: '霧島市',
      addressDetail: '国分中央１丁目２−３２',
      headOfficeAddress: '鹿児島県霧島市国分中央１丁目２−３２',
      declaredAddress: null,
      domesticOfficeAddress: null,
    },
    {
      registrationNumber: 'T1000000000001',
      sequenceNumber: 1,
      datasetVersionId: 1,
      process: '01',
      correct: '0',
      kind: '1',
      country: '1',
      latest: '1',
      registrationDate: '2023-10-01',
      updateDate: '2023-10-01',
      disposeDate: null,
      expireDate: null,
      cancelDate: null,
      legalName: '山田 太郎',
      tradeName: null,
      kana: 'ヤマダ タロウ',
      addressPrefecture: '東京都',
      addressCity: '世田谷区',
      addressDetail: '豪徳寺１丁目',
      headOfficeAddress: '東京都世田谷区豪徳寺１丁目',
      declaredAddress: null,
      domesticOfficeAddress: null,
    },
    {
      registrationNumber: 'T2000000000002',
      sequenceNumber: 1,
      datasetVersionId: 1,
      process: '01',
      correct: '0',
      kind: '2',
      country: '1',
      latest: '0',
      registrationDate: '2023-10-01',
      updateDate: '2023-10-01',
      disposeDate: null,
      expireDate: null,
      cancelDate: '2024-03-31',
      legalName: '再登録テスト株式会社',
      tradeName: null,
      kana: 'サイトウロクテストカブシキガイシャ',
      addressPrefecture: '東京都',
      addressCity: '千代田区',
      addressDetail: '丸の内１丁目',
      headOfficeAddress: '東京都千代田区丸の内１丁目',
      declaredAddress: null,
      domesticOfficeAddress: null,
    },
    {
      registrationNumber: 'T2000000000002',
      sequenceNumber: 2,
      datasetVersionId: 1,
      process: '01',
      correct: '0',
      kind: '2',
      country: '1',
      latest: '1',
      registrationDate: '2024-10-01',
      updateDate: '2024-10-01',
      disposeDate: null,
      expireDate: null,
      cancelDate: null,
      legalName: '再登録テスト株式会社',
      tradeName: null,
      kana: 'サイトウロクテストカブシキガイシャ',
      addressPrefecture: '東京都',
      addressCity: '千代田区',
      addressDetail: '丸の内１丁目',
      headOfficeAddress: '東京都千代田区丸の内１丁目',
      declaredAddress: null,
      domesticOfficeAddress: null,
    },
  ];

  function findRegistrationNumber(condition: unknown): string | null {
    const visited = new Set<unknown>();
    function search(node: unknown): string | null {
      if (!node || typeof node !== 'object') {
        if (typeof node === 'string' && /^T\d{13}$/.test(node)) {
          return node;
        }
        return null;
      }
      if (visited.has(node)) return null;
      visited.add(node);

      if (Array.isArray(node)) {
        for (const item of node) {
          const found = search(item);
          if (found) return found;
        }
      } else {
        for (const val of Object.values(node)) {
          const found = search(val);
          if (found) return found;
        }
      }
      return null;
    }
    return search(condition);
  }

  function findCorporateNumber(condition: unknown): string | null {
    const visited = new Set<unknown>();
    function search(node: unknown): string | null {
      if (!node || typeof node !== 'object') {
        if (typeof node === 'string' && /^\d{13}$/.test(node)) {
          return node;
        }
        return null;
      }
      if (visited.has(node)) return null;
      visited.add(node);

      if (Array.isArray(node)) {
        for (const item of node) {
          const found = search(item);
          if (found) return found;
        }
      } else {
        for (const val of Object.values(node)) {
          const found = search(val);
          if (found) return found;
        }
      }
      return null;
    }
    return search(condition);
  }

  function createMockDb(): DbClient {
    return {
      select: (fields?: unknown) => ({
        from: (table?: unknown) => ({
          where: (condition?: unknown) => {
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

            // invoiceIssuers 判定
            if (table === invoiceIssuers) {
              const targetRegNumber = findRegistrationNumber(condition);
              const matched = targetRegNumber
                ? mockInvoiceData.filter((r) => r.registrationNumber === targetRegNumber)
                : [];
              return Promise.resolve(matched);
            }

            const targetCorpNumber = findCorporateNumber(condition);
            const filteredCorporateData = targetCorpNumber
              ? mockCorporateData.filter((r) => r.corporateNumber === targetCorpNumber)
              : mockCorporateData;

            return {
              limit: (limitCount: number) =>
                Promise.resolve(filteredCorporateData.slice(0, limitCount)),
              orderBy: () => ({
                limit: (limitCount: number) => ({
                  offset: (offsetCount: number) =>
                    Promise.resolve(
                      filteredCorporateData.slice(offsetCount, offsetCount + limitCount),
                    ),
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
    const invoiceDbProvider = new DbInvoiceDataProvider(db);

    // NTA_APPLICATION_ID なし・DBモードで MCP サーバー初期化
    const mcpServer = createServer({
      dbProvider,
      invoiceDbProvider,
      dataSource: 'db',
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);

    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);

    return { client, mcpServer };
  }

  it('tools/list で各照会ツールの openWorldHint が true に設定されていること（仕様 v1.8）', async () => {
    const { client } = await setupHostClient();
    const toolsResult = await client.listTools();

    const lookupTool = toolsResult.tools.find((t) => t.name === 'lookup_corporate_by_number');
    const searchTool = toolsResult.tools.find((t) => t.name === 'search_corporate_by_name');
    const invoiceTool = toolsResult.tools.find((t) => t.name === 'lookup_invoice_issuer');

    expect(lookupTool).toBeDefined();
    expect(lookupTool?.annotations?.openWorldHint).toBe(true);

    expect(searchTool).toBeDefined();
    expect(searchTool?.annotations?.openWorldHint).toBe(true);

    expect(invoiceTool).toBeDefined();
    expect(invoiceTool?.annotations?.openWorldHint).toBe(true);
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
    expect(corp.address_may_be_outdated).toBe(false);

    // 要約テキスト（content[0].text）に data_as_of と attribution が含まれること（注記はなし）
    const textContent = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(textContent).toContain(`データ時点: ${currentDataAsOf}`);
    expect(textContent).toContain(`出典: ${NTA_CORPORATE_HOST_ATTRIBUTION}`);
    expect(textContent).not.toContain(
      '※登記上の所在地の表記が、住居表示の実施等により現在の住所と異なる可能性があります。',
    );
  });

  it('lookup_corporate_by_number: hihyoji=1（検索対象除外）の法人は address_may_be_outdated=true となり要約に注記が付くこと', async () => {
    const { client } = await setupHostClient();

    const result = await client.callTool({
      name: 'lookup_corporate_by_number',
      arguments: { corporate_number: '7000000000002' },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    const corp = sc.corporation as Record<string, unknown>;
    expect(corp.name).toBe('テスト物流有限会社');
    expect(corp.address_may_be_outdated).toBe(true);

    const textContent = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(textContent).toContain(
      '※登記上の所在地の表記が、住居表示の実施等により現在の住所と異なる可能性があります。',
    );
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
    expect(results[1]?.address_may_be_outdated).toBe(true);

    // 要約テキスト（content[0].text）に data_as_of と attribution、および検索対象除外の注記が含まれること
    const textContent = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(textContent).toContain(`データ時点: ${currentDataAsOf}`);
    expect(textContent).toContain(`出典: ${NTA_CORPORATE_HOST_ATTRIBUTION}`);
    expect(textContent).toContain(
      '※登記上の所在地の表記が、住居表示の実施等により現在の住所と異なる可能性があります。',
    );
  });

  it('lookup_invoice_issuer: 法人をDBから取得し、法人名・所在地・出典・免責事項を返すこと', async () => {
    const { client } = await setupHostClient();

    const result = await client.callTool({
      name: 'lookup_invoice_issuer',
      arguments: { registration_number: 'T9340001026142', reference_date: '2024-01-01' },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc).toBeDefined();
    expect(sc.registration_number).toBe('T9340001026142');
    expect(sc.status).toBe('registered');
    expect(sc.business_type).toBe('corporation');
    expect(sc.corporate_name).toBe('スグクル株式会社');
    expect(sc.location).toBe('鹿児島県霧島市国分中央１丁目２−３２');
    expect(sc.was_registered_on_reference_date).toBe(true);
    expect(sc.data_as_of).toBe(currentDataAsOf);
    expect(sc.attribution).toBe(NTA_INVOICE_HOST_ATTRIBUTION);
    expect(sc.tax_disclaimer).toBe(INVOICE_TAX_DISCLAIMER);

    const textContent = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(textContent).toContain(
      `スグクル株式会社（登録番号: T9340001026142）は、データ時点（${currentDataAsOf}）の公表データでは、適格請求書発行事業者として登録されています。`,
    );
    expect(textContent).toContain('事業者区分: 法人');
    expect(textContent).toContain('所在地: 鹿児島県霧島市国分中央１丁目２−３２');
    expect(textContent).toContain('基準日（2024-01-01）時点で有効な登録事業者でした。');
    expect(textContent).toContain(`データ時点: ${currentDataAsOf}`);
    expect(textContent).toContain(`出典: ${NTA_INVOICE_HOST_ATTRIBUTION}`);
    expect(textContent).toContain(INVOICE_TAX_DISCLAIMER);
  });

  it('lookup_invoice_issuer: 個人事業者の場合は氏名・屋号・所在地がnullで返ること', async () => {
    const { client } = await setupHostClient();

    const result = await client.callTool({
      name: 'lookup_invoice_issuer',
      arguments: { registration_number: 'T1000000000001' },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc).toBeDefined();
    expect(sc.business_type).toBe('individual');
    expect(sc.corporate_name).toBeNull();
    expect(sc.location).toBeNull();

    const textContent = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(textContent).toContain(
      `登録番号: T1000000000001 は、データ時点（${currentDataAsOf}）の公表データでは、適格請求書発行事業者として登録されています。`,
    );
    expect(textContent).toContain('事業者区分: 個人事業者');
    expect(textContent).not.toContain('山田');
    expect(textContent).not.toContain('世田谷区');
    expect(textContent).toContain(INVOICE_TAX_DISCLAIMER);
  });

  it('lookup_invoice_issuer: 未登録・非公表の番号の場合は status: not_found で返り、基準日指定時も判定文が出ず null となること', async () => {
    const { client } = await setupHostClient();

    const result = await client.callTool({
      name: 'lookup_invoice_issuer',
      arguments: { registration_number: 'T9999999999999', reference_date: '2024-01-01' },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc).toBeDefined();
    expect(sc.status).toBe('not_found');
    expect(sc.business_type).toBe('unknown');
    expect(sc.was_registered_on_reference_date).toBeNull();

    const textContent = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(textContent).toContain('該当する公表データは見つかりませんでした');
    expect(textContent).toContain('未登録であることを確定するものではありません');
    expect(textContent).not.toContain('基準日');
    expect(textContent).toContain(INVOICE_TAX_DISCLAIMER);
  });

  it('lookup_invoice_issuer: 再登録された番号で前の登録期間中の日付が true になること', async () => {
    const { client } = await setupHostClient();

    // 1. 前の登録期間（2023-10-01〜2024-03-31）内の日付を指定: true
    const resultPast = await client.callTool({
      name: 'lookup_invoice_issuer',
      arguments: { registration_number: 'T2000000000002', reference_date: '2023-12-01' },
    });
    expect(resultPast.isError).toBeFalsy();
    const scPast = resultPast.structuredContent as Record<string, unknown>;
    expect(scPast.was_registered_on_reference_date).toBe(true);
    const textPast = (resultPast.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(textPast).toContain('基準日（2023-12-01）時点で有効な登録事業者でした。');

    // 2. 取消中期間（2024-04-01〜2024-09-30）の日付を指定: false
    const resultMiddle = await client.callTool({
      name: 'lookup_invoice_issuer',
      arguments: { registration_number: 'T2000000000002', reference_date: '2024-06-01' },
    });
    expect(resultMiddle.isError).toBeFalsy();
    const scMiddle = resultMiddle.structuredContent as Record<string, unknown>;
    expect(scMiddle.was_registered_on_reference_date).toBe(false);
    const textMiddle = (resultMiddle.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(textMiddle).toContain(
      '基準日（2024-06-01）時点では有効な登録事業者ではありませんでした。',
    );

    // 3. 再登録後期間（2024-10-01〜）の日付を指定: true
    const resultReRegistered = await client.callTool({
      name: 'lookup_invoice_issuer',
      arguments: { registration_number: 'T2000000000002', reference_date: '2024-11-01' },
    });
    expect(resultReRegistered.isError).toBeFalsy();
    const scReRegistered = resultReRegistered.structuredContent as Record<string, unknown>;
    expect(scReRegistered.was_registered_on_reference_date).toBe(true);
    const textReRegistered = (
      resultReRegistered.content as Array<{ type: string; text: string }>
    )[0]?.text;
    expect(textReRegistered).toContain('基準日（2024-11-01）時点で有効な登録事業者でした。');
  });
});
