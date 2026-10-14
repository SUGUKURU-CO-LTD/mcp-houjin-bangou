/**
 * UI Fallback & Headless Client Integration Tests (SLA2-328)
 *
 * 根拠 / Source: Linear issue SLA2-328
 *
 * 【前提方針】
 * - Claude Desktop および ChatGPT は MCP Apps の UI（ui://... リソース）に対応しています。
 * - 本テストスイートでは、UI を表示・解釈できないクライアント（CLI、ターミナル、バッチ処理、
 *   ヘッドレスなエージェント等）であっても、structuredContent（構造化JSON）と content（自然言語文章）
 *   だけで、全5ツールの目的が 100% 完全に果たせることを実証します。
 * - UI（HTML/CSS/JS）にしか存在しないデータは一切なく、すべての情報が structuredContent に網羅され、
 *   情報欠落（Information Loss）がゼロであることを検証します。
 *
 * 【テストデータの性格】
 * 本テストで使用しているデータはすべてテスト用に作成した「合成データ」であり、
 * 実在する事業者や個人の情報、国税庁本番データではありません。
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

describe('UI Fallback & Headless Client Tests (SLA2-328: UI非対応環境での単独成立検証)', () => {
  const currentDataAsOf = '2026-10-01';

  // 合成テストデータ
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
      streetNumber: '国分中央１丁目２−３２',
      addressOutside: null,
      postCode: '8994332',
      updateDate: '2026-07-15',
      closeDate: null,
      closeCause: null,
      furigana: 'スグクルカブシキガイシャ',
      hihyoji: '0',
    },
    {
      corporateNumber: '1000000000008',
      datasetVersionId: 1,
      name: '閉鎖テスト株式会社',
      kind: '301',
      prefectureCode: '13',
      cityCode: '101',
      prefectureName: '東京都',
      cityName: '千代田区',
      streetNumber: '丸の内１丁目１−１',
      addressOutside: null,
      postCode: '1000005',
      updateDate: '2026-08-01',
      closeDate: '2026-08-01',
      closeCause: '01', // 清算結了
      furigana: 'ヘイサテストカブシキガイシャ',
      hihyoji: '0',
    },
    {
      corporateNumber: '7000000000002',
      datasetVersionId: 1,
      name: '検索対象除外有限会社',
      kind: '302',
      prefectureCode: '46',
      cityCode: '218',
      prefectureName: '鹿児島県',
      cityName: '霧島市',
      streetNumber: '国分中央１丁目',
      addressOutside: null,
      postCode: '8994332',
      updateDate: '2026-05-01',
      closeDate: null,
      closeCause: null,
      furigana: 'ケンサクタイショウジョガイユウゲンガイシャ',
      hihyoji: '1', // 検索対象除外（住居表示実施等）
    },
  ];

  const mockInvoiceData = [
    {
      registrationNumber: 'T9340001026142',
      sequenceNumber: 1,
      datasetVersionId: 1,
      process: '01',
      correct: '0',
      kind: '2', // 法人
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
      kind: '1', // 個人事業者
      country: '1',
      latest: '1',
      registrationDate: '2023-10-01',
      updateDate: '2023-10-01',
      disposeDate: null,
      expireDate: null,
      cancelDate: null,
      legalName: '個人事業者ダミー氏名',
      tradeName: null,
      kana: 'コジンジギョウシャダミーシメイ',
      addressPrefecture: '東京都',
      addressCity: '世田谷区',
      addressDetail: '豪徳寺１丁目',
      headOfficeAddress: '東京都世田谷区豪徳寺１丁目',
      declaredAddress: null,
      domesticOfficeAddress: null,
    },
    {
      registrationNumber: 'T3000000000003',
      sequenceNumber: 1,
      datasetVersionId: 1,
      process: '01',
      correct: '0',
      kind: '2',
      country: '1',
      latest: '1',
      registrationDate: '2023-10-01',
      updateDate: '2024-04-01',
      disposeDate: null,
      expireDate: null,
      cancelDate: '2024-03-31', // 取消・失効
      legalName: '取消済テスト株式会社',
      tradeName: null,
      kana: 'トリケシズミテストカブシキガイシャ',
      addressPrefecture: '東京都',
      addressCity: '千代田区',
      addressDetail: '大手町１丁目',
      headOfficeAddress: '東京都千代田区大手町１丁目',
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

  function findNamePattern(condition: unknown): string | null {
    const visited = new Set<unknown>();
    function search(node: unknown): string | null {
      if (!node || typeof node !== 'object') {
        if (typeof node === 'string' && (node.startsWith('%') || node.endsWith('%'))) {
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
              const namePattern = findNamePattern(condition);
              const coreQuery = namePattern ? namePattern.replace(/%/g, '') : null;
              const count = coreQuery
                ? mockCorporateData.filter((r) => r.name.includes(coreQuery)).length
                : mockCorporateData.length;
              return Promise.resolve([{ total: count }]);
            }

            // invoiceIssuers 判定
            if (table === invoiceIssuers) {
              const targetRegNumber = findRegistrationNumber(condition);
              const matched = targetRegNumber
                ? mockInvoiceData.filter((r) => r.registrationNumber === targetRegNumber)
                : [];
              return Promise.resolve(matched);
            }

            // corporateNumbers 判定
            const targetCorpNumber = findCorporateNumber(condition);
            let filteredCorporateData = mockCorporateData;

            if (targetCorpNumber) {
              filteredCorporateData = mockCorporateData.filter(
                (r) => r.corporateNumber === targetCorpNumber,
              );
            } else {
              const namePattern = findNamePattern(condition);
              if (namePattern) {
                const coreQuery = namePattern.replace(/%/g, '');
                filteredCorporateData = mockCorporateData.filter((r) => r.name.includes(coreQuery));
              }
            }

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

  async function setupHeadlessClient() {
    const db = createMockDb();
    const dbProvider = new DbCorporateDataProvider(db);
    const invoiceDbProvider = new DbInvoiceDataProvider(db);

    const mcpServer = createServer({
      dbProvider,
      invoiceDbProvider,
      dataSource: 'db',
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.connect(serverTransport);

    // ヘッドレスクライアント（UI リソース capabilities を持たない標準クライアント）
    const client = new Client(
      { name: 'headless-cli-agent', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(clientTransport);

    return { client };
  }

  describe('Tool 1: lookup_corporate_by_number (UI 非対応環境での成立性)', () => {
    it('Active法人: UIリソースを解釈しなくても、structuredContent と content[0].text のみで完全な法人情報が取得できること', async () => {
      const { client } = await setupHeadlessClient();

      const result = await client.callTool({
        name: 'lookup_corporate_by_number',
        arguments: { corporate_number: '9340001026142' },
      });

      expect(result.isError).toBeFalsy();

      // 1. 自然言語テキスト（content[0].text）だけでユーザー・LLMへの情報伝達が完結すること
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content).toBeDefined();
      expect(content[0]?.type).toBe('text');
      const text = content[0]?.text ?? '';
      expect(text).toContain('法人番号: 9340001026142');
      expect(text).toContain('スグクル株式会社');
      expect(text).toContain('法人種別: 株式会社');
      expect(text).toContain('所在地: 鹿児島県霧島市国分中央１丁目２−３２');
      expect(text).toContain('状態: 登記中 (active)');
      expect(text).toContain(`データ時点: ${currentDataAsOf}`);
      expect(text).toContain(`出典: ${NTA_CORPORATE_HOST_ATTRIBUTION}`);

      // 2. 構造化JSON（structuredContent）だけで基幹システムや自動化フローの処理が完結すること
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc).toBeDefined();
      expect(sc.data_as_of).toBe(currentDataAsOf);
      expect(sc.attribution).toBe(NTA_CORPORATE_HOST_ATTRIBUTION);

      const corp = sc.corporation as Record<string, unknown>;
      expect(corp.corporate_number).toBe('9340001026142');
      expect(corp.name).toBe('スグクル株式会社');
      expect(corp.name_kana).toBe('スグクルカブシキガイシャ');
      expect(corp.legal_type).toBe('株式会社');
      expect(corp.location).toBe('鹿児島県霧島市国分中央１丁目２−３２');
      expect(corp.post_code).toBe('8994332');
      expect(corp.status).toBe('active');
      expect(corp.close_date).toBeNull();
      expect(corp.close_cause).toBeNull();
      expect(corp.address_may_be_outdated).toBe(false);

      // 3. UI テンプレートが表示する全プロパティが structuredContent に 100% 存在すること（欠落ゼロ）
      const uiRequiredFields = [
        'corporate_number',
        'name',
        'legal_type',
        'location',
        'post_code',
        'update_date',
        'status',
      ];
      for (const field of uiRequiredFields) {
        expect(corp[field]).toBeDefined();
        expect(corp[field]).not.toBe('');
      }
    });

    it('Closed法人: 閉鎖情報（閉鎖日・閉鎖事由）がテキストと構造化データの両方で欠落なく伝達されること', async () => {
      const { client } = await setupHeadlessClient();

      const result = await client.callTool({
        name: 'lookup_corporate_by_number',
        arguments: { corporate_number: '1000000000008' },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
      expect(text).toContain('状態: 閉鎖');
      expect(text).toContain('2026-08-01');
      expect(text).toContain('清算の結了等');

      const sc = result.structuredContent as Record<string, unknown>;
      const corp = sc.corporation as Record<string, unknown>;
      expect(corp.status).toBe('closed');
      expect(corp.close_date).toBe('2026-08-01');
      expect(corp.close_cause).toBe('清算の結了等');
    });

    it('検索対象除外（hihyoji=1）: 住居表示注記がテキストおよびフラグで明瞭に取得できること', async () => {
      const { client } = await setupHeadlessClient();

      const result = await client.callTool({
        name: 'lookup_corporate_by_number',
        arguments: { corporate_number: '7000000000002' },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
      expect(text).toContain(
        '※登記上の所在地の表記が、住居表示の実施等により現在の住所と異なる可能性があります。',
      );

      const sc = result.structuredContent as Record<string, unknown>;
      const corp = sc.corporation as Record<string, unknown>;
      expect(corp.address_may_be_outdated).toBe(true);
    });

    it('該当なし: エラーメッセージがテキストで明瞭に返ること', async () => {
      const { client } = await setupHeadlessClient();

      const result = await client.callTool({
        name: 'lookup_corporate_by_number',
        arguments: { corporate_number: '9999999999999' },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
      expect(text).toContain('該当する公表データは見つかりませんでした');
    });
  });

  describe('Tool 2: search_corporate_by_name (UI 非対応環境での成立性)', () => {
    it('複数件ヒット: UIテーブルを表示できなくても、テキスト件数と構造化配列・ページネーション情報で完結すること', async () => {
      const { client } = await setupHeadlessClient();

      const result = await client.callTool({
        name: 'search_corporate_by_name',
        arguments: { name: '株式会社', limit: 10 },
      });

      expect(result.isError).toBeFalsy();

      // 1. テキスト（content[0].text）で検索件数が視認できること
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
      expect(text).toContain('「株式会社」の検索結果です');
      expect(text).toContain(`データ時点: ${currentDataAsOf}`);
      expect(text).toContain(`出典: ${NTA_CORPORATE_HOST_ATTRIBUTION}`);

      // 2. 構造化データ（structuredContent）で全結果とカーソルが完備されていること
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.data_as_of).toBe(currentDataAsOf);
      expect(sc.attribution).toBe(NTA_CORPORATE_HOST_ATTRIBUTION);

      const results = sc.results as Array<Record<string, unknown>>;
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThanOrEqual(1);

      const firstItem = results[0];
      expect(firstItem?.corporate_number).toBe('9340001026142');
      expect(firstItem?.name).toBe('スグクル株式会社');
      expect(firstItem?.legal_type).toBe('株式会社');
      expect(firstItem?.location).toBe('鹿児島県霧島市国分中央１丁目２−３２');
      expect(firstItem?.status).toBe('active');

      // UI テーブルが表示する全列が structuredContent.results に 100% 含まれること
      for (const item of results) {
        expect(item.corporate_number).toBeDefined();
        expect(item.name).toBeDefined();
        expect(item.location).toBeDefined();
        expect(item.status).toBeDefined();
      }
    });

    it('0件ヒット: UIなし環境でも検索ヒット0件であることがテキストと構造化データで明瞭に示されること', async () => {
      const { client } = await setupHeadlessClient();

      const result = await client.callTool({
        name: 'search_corporate_by_name',
        arguments: { name: '存在しない架空の会社名クエリXYZ' },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
      expect(text).toContain('に一致する法人は見つかりませんでした');

      const sc = result.structuredContent as Record<string, unknown>;
      const results = sc.results as Array<Record<string, unknown>>;
      expect(results).toHaveLength(0);
      expect(sc.next_cursor).toBeNull();
    });
  });

  describe('Tool 3: lookup_invoice_issuer (UI 非対応環境での成立性)', () => {
    it('法人登録事業者: 登録番号・適格事業者状態・商号・所在地・基準日判定・免責事項・出典が文章とJSONで完備されること', async () => {
      const { client } = await setupHeadlessClient();

      const result = await client.callTool({
        name: 'lookup_invoice_issuer',
        arguments: {
          registration_number: 'T9340001026142',
          reference_date: '2024-01-01',
        },
      });

      expect(result.isError).toBeFalsy();

      // 自然言語要約の検証
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
      expect(text).toContain('適格請求書発行事業者として登録されています');
      expect(text).toContain('登録番号: T9340001026142');
      expect(text).toContain('スグクル株式会社');
      expect(text).toContain('事業者区分: 法人');
      expect(text).toContain('所在地: 鹿児島県霧島市国分中央１丁目２−３２');
      expect(text).toContain('基準日（2024-01-01）時点で有効な登録事業者でした');
      expect(text).toContain(INVOICE_TAX_DISCLAIMER);
      expect(text).toContain(`出典: ${NTA_INVOICE_HOST_ATTRIBUTION}`);

      // 構造化データの検証
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.registration_number).toBe('T9340001026142');
      expect(sc.status).toBe('registered');
      expect(sc.business_type).toBe('corporation');
      expect(sc.corporate_name).toBe('スグクル株式会社');
      expect(sc.location).toBe('鹿児島県霧島市国分中央１丁目２−３２');
      expect(sc.was_registered_on_reference_date).toBe(true);
      expect(sc.data_as_of).toBe(currentDataAsOf);
      expect(sc.tax_disclaimer).toBe(INVOICE_TAX_DISCLAIMER);
      expect(sc.attribution).toBe(NTA_INVOICE_HOST_ATTRIBUTION);
    });

    it('個人事業者: プライバシー保護として氏名・所在地がnullとなり、登録状態のみ安全に提供されること', async () => {
      const { client } = await setupHeadlessClient();

      const result = await client.callTool({
        name: 'lookup_invoice_issuer',
        arguments: { registration_number: 'T1000000000001' },
      });

      expect(result.isError).toBeFalsy();

      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
      expect(text).toContain('事業者区分: 個人事業者');
      expect(text).toContain('適格請求書発行事業者として登録されています');
      expect(text).not.toContain('個人事業者ダミー氏名');
      expect(text).not.toContain('世田谷区');

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.business_type).toBe('individual');
      expect(sc.corporate_name).toBeNull();
      expect(sc.location).toBeNull();
      expect(sc.status).toBe('registered');
    });

    it('取消・失効事業者: 取り消されている旨が正確に反映され、失効状態が把握できること', async () => {
      const { client } = await setupHeadlessClient();

      const result = await client.callTool({
        name: 'lookup_invoice_issuer',
        arguments: { registration_number: 'T3000000000003' },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
      expect(text).toContain('取り消されています');

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.status).toBe('cancelled');
      expect(sc.cancellation_date).toBe('2024-03-31');
    });
  });

  describe('Tool 4: validate_corporate_number (UI 非対応環境での成立性)', () => {
    it('正常番号: チェックデジット正当性がテキストと構造化データで取得できること', async () => {
      const { client } = await setupHeadlessClient();

      const result = await client.callTool({
        name: 'validate_corporate_number',
        arguments: { corporate_number: '9340001026142' },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
      expect(text).toContain('正常です');

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.is_valid_format).toBe(true);
      expect(sc.is_valid_check_digit).toBe(true);
      expect(sc.error_reason).toBeNull();
    });

    it('チェックサム不一致: 不正な番号であることが明瞭に返ること', async () => {
      const { client } = await setupHeadlessClient();

      const result = await client.callTool({
        name: 'validate_corporate_number',
        arguments: { corporate_number: '9340001026140' }, // 最後のチェックディジット不正
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
      expect(text).toContain('無効です');

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.is_valid_format).toBe(true);
      expect(sc.is_valid_check_digit).toBe(false);
      expect(sc.error_reason).toBe('check_digit_mismatch');
    });
  });

  describe('Tool 5: normalize_company_name (UI 非対応環境での成立性)', () => {
    it('商号正規化: 表記ゆれ・法人格抽出結果がテキストと構造化データで取得できること', async () => {
      const { client } = await setupHeadlessClient();

      const result = await client.callTool({
        name: 'normalize_company_name',
        arguments: { raw_name: '（株）スグクル' },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
      expect(text).toContain('スグクル');
      expect(text).toContain('株式会社');

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.normalized_name).toBe('株式会社スグクル');
      expect(sc.legal_type).toBe('株式会社');
      expect(sc.search_query_optimized).toBe('スグクル');
    });
  });

  describe('UI と structuredContent の完全等価性検証 (Zero Information Loss)', () => {
    it('UI が参照するすべてのフィールドが structuredContent に 100% 存在し、UI非対応クライアントが一切不利にならないこと', async () => {
      const { client } = await setupHeadlessClient();

      // lookup_corporate_by_number の全フィールド検証
      const lookupRes = await client.callTool({
        name: 'lookup_corporate_by_number',
        arguments: { corporate_number: '9340001026142' },
      });
      const lookupSc = lookupRes.structuredContent as Record<string, unknown>;
      const corp = lookupSc.corporation as Record<string, unknown>;

      // UI 側の corporate-card/main.ts がレンダリングするすべてのプロパティ
      const expectedCorpCardFields = [
        'corporate_number',
        'name',
        'legal_type',
        'location',
        'post_code',
        'update_date',
        'status',
      ];
      for (const prop of expectedCorpCardFields) {
        expect(corp).toHaveProperty(prop);
        expect(corp[prop]).not.toBeUndefined();
      }
      expect(lookupSc).toHaveProperty('data_as_of');
      expect(lookupSc).toHaveProperty('attribution');

      // search_corporate_by_name の全フィールド検証
      const searchRes = await client.callTool({
        name: 'search_corporate_by_name',
        arguments: { name: 'スグクル' },
      });
      const searchSc = searchRes.structuredContent as Record<string, unknown>;
      const searchResults = searchSc.results as Array<Record<string, unknown>>;

      // UI 側の search-results/main.ts がテーブルレンダリングするすべてのプロパティ
      const expectedSearchResultsFields = ['corporate_number', 'name', 'location', 'status'];
      expect(searchResults.length).toBeGreaterThan(0);
      for (const item of searchResults) {
        for (const prop of expectedSearchResultsFields) {
          expect(item).toHaveProperty(prop);
          expect(item[prop]).not.toBeUndefined();
        }
      }
      expect(searchSc).toHaveProperty('total_count');
      expect(searchSc).toHaveProperty('next_cursor');
      expect(searchSc).toHaveProperty('data_as_of');
      expect(searchSc).toHaveProperty('attribution');
    });
  });
});
