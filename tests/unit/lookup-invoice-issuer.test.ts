/**
 * Unit tests for lookup_invoice_issuer tool
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1.3, §3.1, §4, §6.1, §6.2 (v1.6 凍結仕様)
 *   実装指示書v1 §5(B5):
 *     - 入力形式チェック (T + 13桁数字、YYYY-MM-DD)
 *     - 個人事業者の場合は氏名・屋号・所在地を返却しない
 *     - not_found は status: not_found で返し、isError: false
 *     - サーバーログに入力された登録番号を記録しない（マスキング）
 *     - 出典表示と税務免責事項を必須で含める
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerLookupInvoiceIssuerTool } from '../../src/tools/lookup-invoice-issuer.js';
import type {
  DbInvoiceDataProvider,
  LookupInvoiceIssuerResult,
} from '../../src/repository/invoice-repository.js';
import type { McpLogger } from '../../src/lib/mcp-logger.js';
import { Result } from '../../src/lib/result.js';
import {
  NTA_INVOICE_HOST_ATTRIBUTION,
  INVOICE_TAX_DISCLAIMER,
} from '../../src/lib/tool-response.js';

describe('lookup_invoice_issuer tool unit tests', () => {
  let mockLogger: McpLogger;
  let loggedPayloads: Array<{ level: string; msg: string; data?: unknown }>;

  beforeEach(() => {
    loggedPayloads = [];
    mockLogger = {
      setLevel: vi.fn(),
      getLevel: vi.fn().mockReturnValue('info'),
      log: vi.fn((level: string, msg: string, data?: unknown) => {
        loggedPayloads.push({ level, msg, data });
      }),
      debug: vi.fn((msg: string, data?: unknown) => {
        loggedPayloads.push({ level: 'debug', msg, data });
      }),
      info: vi.fn((msg: string, data?: unknown) => {
        loggedPayloads.push({ level: 'info', msg, data });
      }),
      warn: vi.fn((msg: string, data?: unknown) => {
        loggedPayloads.push({ level: 'warn', msg, data });
      }),
      warning: vi.fn((msg: string, data?: unknown) => {
        loggedPayloads.push({ level: 'warning', msg, data });
      }),
      error: vi.fn((msg: string, data?: unknown) => {
        loggedPayloads.push({ level: 'error', msg, data });
      }),
    };
  });

  async function createTestClient(deps: {
    invoiceDbProvider?: DbInvoiceDataProvider;
    dataSource?: 'db' | 'web-api';
  }) {
    const server = new McpServer({ name: 'test-server', version: '1.0.0' });
    registerLookupInvoiceIssuerTool(server, {
      invoiceDbProvider: deps.invoiceDbProvider,
      dataSource: deps.dataSource ?? 'db',
      logger: mockLogger,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);

    return client;
  }

  describe('入力バリデーション', () => {
    it('Tなしの13桁数字の場合はエラーを返すこと', async () => {
      const client = await createTestClient({});
      const result = await client.callTool({
        name: 'lookup_invoice_issuer',
        arguments: { registration_number: '1234567890123' },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0]?.text;
      expect(text).toContain('登録番号は T + 半角数字13桁です');

      // ログに登録番号が平文で残っていないこと
      const logString = JSON.stringify(loggedPayloads);
      expect(logString).not.toContain('1234567890123');
    });

    it('小文字 t の場合はエラーを返すこと', async () => {
      const client = await createTestClient({});
      const result = await client.callTool({
        name: 'lookup_invoice_issuer',
        arguments: { registration_number: 't1234567890123' },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0]?.text;
      expect(text).toContain('登録番号は T + 半角数字13桁です');
    });

    it('12桁数字の場合はエラーを返すこと', async () => {
      const client = await createTestClient({});
      const result = await client.callTool({
        name: 'lookup_invoice_issuer',
        arguments: { registration_number: 'T123456789012' },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0]?.text;
      expect(text).toContain('登録番号は T + 半角数字13桁です');
    });

    it('基準日フォーマットが不正（スラッシュ区切り）の場合はエラーを返すこと', async () => {
      const client = await createTestClient({});
      const result = await client.callTool({
        name: 'lookup_invoice_issuer',
        arguments: {
          registration_number: 'T1234567890123',
          reference_date: '2026/10/01',
        },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0]?.text;
      expect(text).toContain('基準日は YYYY-MM-DD 形式で指定してください');
    });
  });

  describe('プロバイダー未初期化時', () => {
    it('invoiceDbProvider が undefined の場合は DATA_UNAVAILABLE を返すこと', async () => {
      const client = await createTestClient({ invoiceDbProvider: undefined });
      const result = await client.callTool({
        name: 'lookup_invoice_issuer',
        arguments: { registration_number: 'T1234567890123' },
      });

      expect(result.isError).toBe(true);
      const structured = result.structuredContent as {
        error: { code: string; message: string };
      };
      expect(structured.error.code).toBe('DATA_UNAVAILABLE');
      expect(structured.error.message).toContain(
        'インボイス公表データプロバイダーが初期化されていません',
      );
    });
  });

  describe('正常系レスポンスの検証', () => {
    it('法人 (corporation, registered): 正しく情報と要約テキストを返却すること', async () => {
      const mockResult: LookupInvoiceIssuerResult = {
        registration_number: 'T9340001026142',
        status: 'registered',
        business_type: 'corporation',
        registration_date: '2023-10-01',
        cancellation_date: null,
        expiration_date: null,
        corporate_name: 'スグクル株式会社',
        location: '鹿児島県霧島市国分中央一丁目２−３２',
        was_registered_on_reference_date: null,
        data_as_of: '2026-10-01',
        attribution: NTA_INVOICE_HOST_ATTRIBUTION,
        tax_disclaimer: INVOICE_TAX_DISCLAIMER,
      };

      const mockProvider: DbInvoiceDataProvider = {
        mode: 'db',
        lookupByRegistrationNumber: vi.fn().mockResolvedValue(Result.ok(mockResult)),
      } as unknown as DbInvoiceDataProvider;

      const client = await createTestClient({ invoiceDbProvider: mockProvider });
      const result = await client.callTool({
        name: 'lookup_invoice_issuer',
        arguments: { registration_number: 'T9340001026142' },
      });

      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.registration_number).toBe('T9340001026142');
      expect(sc.status).toBe('registered');
      expect(sc.business_type).toBe('corporation');
      expect(sc.corporate_name).toBe('スグクル株式会社');
      expect(sc.location).toBe('鹿児島県霧島市国分中央一丁目２−３２');
      expect(sc.registration_date).toBe('2023-10-01');
      expect(sc.was_registered_on_reference_date).toBeNull();
      expect(sc.data_as_of).toBe('2026-10-01');
      expect(sc.attribution).toBe(NTA_INVOICE_HOST_ATTRIBUTION);
      expect(sc.tax_disclaimer).toBe(INVOICE_TAX_DISCLAIMER);

      const summaryText = (result.content as Array<{ text: string }>)[0]?.text;
      expect(summaryText).toContain(
        'スグクル株式会社（登録番号: T9340001026142）は、データ時点（2026-10-01）の公表データでは、適格請求書発行事業者として登録されています。',
      );
      expect(summaryText).toContain('事業者区分: 法人');
      expect(summaryText).toContain('所在地: 鹿児島県霧島市国分中央一丁目２−３２');
      expect(summaryText).toContain('登録年月日: 2023-10-01');
      expect(summaryText).toContain('データ時点: 2026-10-01');
      expect(summaryText).toContain(NTA_INVOICE_HOST_ATTRIBUTION);
      expect(summaryText).not.toContain('出典: ' + '出典：');
      expect(summaryText).toContain(INVOICE_TAX_DISCLAIMER);

      // ログに登録番号が含まれないこと
      const logString = JSON.stringify(loggedPayloads);
      expect(logString).not.toContain('T9340001026142');
    });

    it('基準日指定ありで有効な場合: was_registered_on_reference_date: true と要約テキストを含むこと', async () => {
      const mockResult: LookupInvoiceIssuerResult = {
        registration_number: 'T9340001026142',
        status: 'registered',
        business_type: 'corporation',
        registration_date: '2023-10-01',
        cancellation_date: null,
        expiration_date: null,
        corporate_name: 'スグクル株式会社',
        location: '鹿児島県霧島市国分中央一丁目２−３２',
        was_registered_on_reference_date: true,
        data_as_of: '2026-10-01',
        attribution: NTA_INVOICE_HOST_ATTRIBUTION,
        tax_disclaimer: INVOICE_TAX_DISCLAIMER,
      };

      const mockProvider: DbInvoiceDataProvider = {
        mode: 'db',
        lookupByRegistrationNumber: vi.fn().mockResolvedValue(Result.ok(mockResult)),
      } as unknown as DbInvoiceDataProvider;

      const client = await createTestClient({ invoiceDbProvider: mockProvider });
      const result = await client.callTool({
        name: 'lookup_invoice_issuer',
        arguments: {
          registration_number: 'T9340001026142',
          reference_date: '2024-05-01',
        },
      });

      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.was_registered_on_reference_date).toBe(true);

      const summaryText = (result.content as Array<{ text: string }>)[0]?.text;
      expect(summaryText).toContain('基準日（2024-05-01）時点で有効な登録事業者でした。');
    });

    it('個人事業者 (individual): 氏名・屋号・所在地が null で返却されること（個人情報保護）', async () => {
      const mockResult: LookupInvoiceIssuerResult = {
        registration_number: 'T1111111111111',
        status: 'registered',
        business_type: 'individual',
        registration_date: '2023-10-01',
        cancellation_date: null,
        expiration_date: null,
        corporate_name: null,
        location: null,
        was_registered_on_reference_date: null,
        data_as_of: '2026-10-01',
        attribution: NTA_INVOICE_HOST_ATTRIBUTION,
        tax_disclaimer: INVOICE_TAX_DISCLAIMER,
      };

      const mockProvider: DbInvoiceDataProvider = {
        mode: 'db',
        lookupByRegistrationNumber: vi.fn().mockResolvedValue(Result.ok(mockResult)),
      } as unknown as DbInvoiceDataProvider;

      const client = await createTestClient({ invoiceDbProvider: mockProvider });
      const result = await client.callTool({
        name: 'lookup_invoice_issuer',
        arguments: { registration_number: 'T1111111111111' },
      });

      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.business_type).toBe('individual');
      expect(sc.corporate_name).toBeNull();
      expect(sc.location).toBeNull();

      const summaryText = (result.content as Array<{ text: string }>)[0]?.text;
      expect(summaryText).toContain(
        '登録番号: T1111111111111 は、データ時点（2026-10-01）の公表データでは、適格請求書発行事業者として登録されています。',
      );
      expect(summaryText).toContain('事業者区分: 個人事業者');
      expect(summaryText).not.toContain('所在地:');
      expect(summaryText).toContain(INVOICE_TAX_DISCLAIMER);
    });

    it('取消 (cancelled): status: cancelled と取消日を返却すること', async () => {
      const mockResult: LookupInvoiceIssuerResult = {
        registration_number: 'T2222222222222',
        status: 'cancelled',
        business_type: 'corporation',
        registration_date: '2023-10-01',
        cancellation_date: '2024-03-31',
        expiration_date: null,
        corporate_name: '取消済企業株式会社',
        location: '東京都千代田区',
        was_registered_on_reference_date: false,
        data_as_of: '2026-10-01',
        attribution: NTA_INVOICE_HOST_ATTRIBUTION,
        tax_disclaimer: INVOICE_TAX_DISCLAIMER,
      };

      const mockProvider: DbInvoiceDataProvider = {
        mode: 'db',
        lookupByRegistrationNumber: vi.fn().mockResolvedValue(Result.ok(mockResult)),
      } as unknown as DbInvoiceDataProvider;

      const client = await createTestClient({ invoiceDbProvider: mockProvider });
      const result = await client.callTool({
        name: 'lookup_invoice_issuer',
        arguments: {
          registration_number: 'T2222222222222',
          reference_date: '2024-04-01',
        },
      });

      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.status).toBe('cancelled');
      expect(sc.cancellation_date).toBe('2024-03-31');
      expect(sc.was_registered_on_reference_date).toBe(false);

      const summaryText = (result.content as Array<{ text: string }>)[0]?.text;
      expect(summaryText).toContain('取消年月日: 2024-03-31');
      expect(summaryText).toContain(
        '基準日（2024-04-01）時点では有効な登録事業者ではありませんでした。',
      );
      expect(summaryText).toContain(INVOICE_TAX_DISCLAIMER);
    });

    it('失効 (expired): status: expired と失効日を返却すること', async () => {
      const mockResult: LookupInvoiceIssuerResult = {
        registration_number: 'T3333333333333',
        status: 'expired',
        business_type: 'corporation',
        registration_date: '2023-10-01',
        cancellation_date: null,
        expiration_date: '2024-06-30',
        corporate_name: '失効企業株式会社',
        location: '東京都港区',
        was_registered_on_reference_date: null,
        data_as_of: '2026-10-01',
        attribution: NTA_INVOICE_HOST_ATTRIBUTION,
        tax_disclaimer: INVOICE_TAX_DISCLAIMER,
      };

      const mockProvider: DbInvoiceDataProvider = {
        mode: 'db',
        lookupByRegistrationNumber: vi.fn().mockResolvedValue(Result.ok(mockResult)),
      } as unknown as DbInvoiceDataProvider;

      const client = await createTestClient({ invoiceDbProvider: mockProvider });
      const result = await client.callTool({
        name: 'lookup_invoice_issuer',
        arguments: { registration_number: 'T3333333333333' },
      });

      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.status).toBe('expired');
      expect(sc.expiration_date).toBe('2024-06-30');

      const summaryText = (result.content as Array<{ text: string }>)[0]?.text;
      expect(summaryText).toContain('失効年月日: 2024-06-30');
      expect(summaryText).toContain(INVOICE_TAX_DISCLAIMER);
    });

    it('人格区分が空（business_type: unknown）の公表データ: 正常レスポンスを返し、法人名・所在地がnull、事業者区分「不明」が表示されること', async () => {
      const mockResult: LookupInvoiceIssuerResult = {
        registration_number: 'T6000000000005',
        status: 'registered',
        business_type: 'unknown',
        registration_date: '2023-10-01',
        cancellation_date: null,
        expiration_date: null,
        corporate_name: null,
        location: null,
        was_registered_on_reference_date: null,
        data_as_of: '2026-10-01',
        attribution: NTA_INVOICE_HOST_ATTRIBUTION,
        tax_disclaimer: INVOICE_TAX_DISCLAIMER,
      };

      const mockProvider: DbInvoiceDataProvider = {
        mode: 'db',
        lookupByRegistrationNumber: vi.fn().mockResolvedValue(Result.ok(mockResult)),
      } as unknown as DbInvoiceDataProvider;

      const client = await createTestClient({ invoiceDbProvider: mockProvider });
      const result = await client.callTool({
        name: 'lookup_invoice_issuer',
        arguments: { registration_number: 'T6000000000005' },
      });

      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.status).toBe('registered');
      expect(sc.business_type).toBe('unknown');
      expect(sc.corporate_name).toBeNull();
      expect(sc.location).toBeNull();

      const summaryText = (result.content as Array<{ text: string }>)[0]?.text;
      expect(summaryText).toContain('事業者区分: 不明');
      expect(summaryText).toContain('所在地: 公表なし');
      expect(summaryText).toContain(INVOICE_TAX_DISCLAIMER);
    });

    it('公表データ該当なし (not_found): 正常レスポンス (isError: false, status: not_found) を返し、注記を含むこと', async () => {
      const mockResult: LookupInvoiceIssuerResult = {
        registration_number: 'T9999999999999',
        status: 'not_found',
        business_type: 'unknown',
        registration_date: null,
        cancellation_date: null,
        expiration_date: null,
        corporate_name: null,
        location: null,
        was_registered_on_reference_date: null,
        data_as_of: '2026-10-01',
        attribution: NTA_INVOICE_HOST_ATTRIBUTION,
        tax_disclaimer: INVOICE_TAX_DISCLAIMER,
      };

      const mockProvider: DbInvoiceDataProvider = {
        mode: 'db',
        lookupByRegistrationNumber: vi.fn().mockResolvedValue(Result.ok(mockResult)),
      } as unknown as DbInvoiceDataProvider;

      const client = await createTestClient({ invoiceDbProvider: mockProvider });
      const result = await client.callTool({
        name: 'lookup_invoice_issuer',
        arguments: {
          registration_number: 'T9999999999999',
          reference_date: '2024-01-01',
        },
      });

      // エラーではなく正常レスポンスであること
      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.status).toBe('not_found');
      expect(sc.business_type).toBe('unknown');
      expect(sc.was_registered_on_reference_date).toBeNull();

      const summaryText = (result.content as Array<{ text: string }>)[0]?.text;
      expect(summaryText).toContain('該当する公表データは見つかりませんでした');
      expect(summaryText).toContain('未登録であることを確定するものではありません');
      expect(summaryText).not.toContain('基準日');
      expect(summaryText).toContain(INVOICE_TAX_DISCLAIMER);
    });
  });

  describe('ツールメタデータ・アノテーション', () => {
    it('ホスト版 (dbモード) で openWorldHint: true, readOnlyHint: true, idempotentHint: true であること（仕様 v1.8）', async () => {
      const client = await createTestClient({ dataSource: 'db' });
      const toolsResult = await client.listTools();
      const invoiceTool = toolsResult.tools.find((t) => t.name === 'lookup_invoice_issuer');

      expect(invoiceTool).toBeDefined();
      expect(invoiceTool?.annotations?.readOnlyHint).toBe(true);
      expect(invoiceTool?.annotations?.destructiveHint).toBe(false);
      expect(invoiceTool?.annotations?.idempotentHint).toBe(true);
      expect(invoiceTool?.annotations?.openWorldHint).toBe(true);
    });

    it('Web-API / local モードで openWorldHint: true であること', async () => {
      const client = await createTestClient({ dataSource: 'web-api' });
      const toolsResult = await client.listTools();
      const invoiceTool = toolsResult.tools.find((t) => t.name === 'lookup_invoice_issuer');

      expect(invoiceTool).toBeDefined();
      expect(invoiceTool?.annotations?.openWorldHint).toBe(true);
    });
  });
});
