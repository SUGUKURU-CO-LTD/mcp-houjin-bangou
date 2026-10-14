/**
 * Unit tests for DbInvoiceDataProvider
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1.3, §3.1, §4, §6.1, §6.2 (v1.6 凍結仕様)
 *   実装指示書v1 §5(B5):
 *     - インボイス公表データの登録番号 (T+13桁) から公表事実（登録状態、登録日、取消・失効日、法人等の名称・所在地）を確認
 *     - 個人事業者の場合は氏名・屋号・所在地を返却しない
 *     - not_found は status: not_found で返し、エラーコード NOT_FOUND は使用しない
 *     - 税理士法に配慮し、税務免責事項 (tax_disclaimer) を必須で返却
 */

import { describe, it, expect } from 'vitest';
import { DbInvoiceDataProvider } from '../../src/repository/invoice-repository.js';
import type { DbClient } from '../../src/db/client.js';
import {
  NTA_INVOICE_HOST_ATTRIBUTION,
  INVOICE_TAX_DISCLAIMER,
} from '../../src/lib/tool-response.js';

describe('DbInvoiceDataProvider unit tests', () => {
  const currentDataAsOf = '2026-10-01';

  function createMockDb(options: {
    activeVersion?: { id: number; dataAsOf: string } | null;
    rows?: Array<Record<string, unknown>>;
    throwError?: boolean;
  }): DbClient {
    return {
      select: (fields?: unknown) => ({
        from: (_table?: unknown) => ({
          where: () => {
            if (options.throwError) {
              return {
                orderBy: () => ({
                  limit: () => Promise.reject(new Error('Simulated DB error')),
                }),
              };
            }

            // datasetVersions の問い合わせ判定 (fields に dataAsOf があるか、または orderBy / limit を持つチェーン)
            if (fields && typeof fields === 'object' && 'dataAsOf' in fields) {
              return {
                orderBy: () => ({
                  limit: () =>
                    Promise.resolve(
                      options.activeVersion !== undefined
                        ? options.activeVersion
                          ? [options.activeVersion]
                          : []
                        : [{ id: 1, dataAsOf: currentDataAsOf }],
                    ),
                }),
              };
            }

            // invoiceIssuers テーブルの問い合わせ
            return Promise.resolve(options.rows ?? []);
          },
        }),
      }),
    } as unknown as DbClient;
  }

  describe('getActiveVersion / データセットバージョンの確認', () => {
    it('アクティブなデータセットバージョンがない場合、DATA_UNAVAILABLE を返すこと', async () => {
      const mockDb = createMockDb({ activeVersion: null });
      const provider = new DbInvoiceDataProvider(mockDb);

      const result = await provider.lookupByRegistrationNumber('T9340001026142');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DATA_UNAVAILABLE');
        expect(result.error.message).toContain('Active invoice dataset not found');
      }
    });

    it('DB問い合わせで例外が発生した場合、INTERNAL_ERROR を返すこと', async () => {
      const mockDb = createMockDb({ throwError: true });
      const provider = new DbInvoiceDataProvider(mockDb);

      const result = await provider.lookupByRegistrationNumber('T9340001026142');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Simulated DB error');
      }
    });
  });

  describe('レコードが存在しない場合 (not_found)', () => {
    it('status: not_found, business_type: unknown で正常結果を返すこと', async () => {
      const mockDb = createMockDb({ rows: [] });
      const provider = new DbInvoiceDataProvider(mockDb);

      const result = await provider.lookupByRegistrationNumber('T9999999999999');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('not_found');
        expect(result.value.business_type).toBe('unknown');
        expect(result.value.corporate_name).toBeNull();
        expect(result.value.location).toBeNull();
        expect(result.value.registration_date).toBeNull();
        expect(result.value.cancellation_date).toBeNull();
        expect(result.value.expiration_date).toBeNull();
        expect(result.value.was_registered_on_reference_date).toBeNull();
        expect(result.value.data_as_of).toBe(currentDataAsOf);
        expect(result.value.attribution).toBe(NTA_INVOICE_HOST_ATTRIBUTION);
        expect(result.value.tax_disclaimer).toBe(INVOICE_TAX_DISCLAIMER);
      }
    });

    it('基準日指定がある場合、was_registered_on_reference_date: false を返すこと', async () => {
      const mockDb = createMockDb({ rows: [] });
      const provider = new DbInvoiceDataProvider(mockDb);

      const result = await provider.lookupByRegistrationNumber('T9999999999999', '2024-01-01');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.was_registered_on_reference_date).toBe(false);
      }
    });
  });

  describe('登録事業者のステータス・区分判定', () => {
    it('法人 (kind=2, 有効): status: registered, business_type: corporation を返すこと', async () => {
      const mockRows = [
        {
          registrationNumber: 'T9340001026142',
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
      ];

      const mockDb = createMockDb({ rows: mockRows });
      const provider = new DbInvoiceDataProvider(mockDb);

      const result = await provider.lookupByRegistrationNumber('T9340001026142');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('registered');
        expect(result.value.business_type).toBe('corporation');
        expect(result.value.corporate_name).toBe('スグクル株式会社');
        expect(result.value.location).toBe('鹿児島県霧島市国分中央１丁目２−３２');
        expect(result.value.registration_date).toBe('2023-10-01');
        expect(result.value.cancellation_date).toBeNull();
        expect(result.value.expiration_date).toBeNull();
      }
    });

    it('人格のない社団等 (kind=2, headOfficeAddress なし, declaredAddress あり): business_type: other となること', async () => {
      const mockRows = [
        {
          registrationNumber: 'T8000000000000',
          kind: '2',
          latest: '1',
          registrationDate: '2023-10-01',
          legalName: '某任意団体',
          headOfficeAddress: null,
          declaredAddress: '東京都千代田区霞が関１丁目',
          cancelDate: null,
          expireDate: null,
        },
      ];

      const mockDb = createMockDb({ rows: mockRows });
      const provider = new DbInvoiceDataProvider(mockDb);

      const result = await provider.lookupByRegistrationNumber('T8000000000000');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('registered');
        expect(result.value.business_type).toBe('other');
        expect(result.value.corporate_name).toBe('某任意団体');
        expect(result.value.location).toBe('東京都千代田区霞が関１丁目');
      }
    });

    it('個人事業者 (kind=1): 氏名・所在地が null になること（個人情報保護）', async () => {
      const mockRows = [
        {
          registrationNumber: 'T1000000000001',
          kind: '1',
          latest: '1',
          registrationDate: '2023-10-01',
          legalName: '山田 太郎',
          headOfficeAddress: '東京都世田谷区',
          cancelDate: null,
          expireDate: null,
        },
      ];

      const mockDb = createMockDb({ rows: mockRows });
      const provider = new DbInvoiceDataProvider(mockDb);

      const result = await provider.lookupByRegistrationNumber('T1000000000001');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('registered');
        expect(result.value.business_type).toBe('individual');
        expect(result.value.corporate_name).toBeNull();
        expect(result.value.location).toBeNull();
        expect(result.value.registration_date).toBe('2023-10-01');
      }
    });

    it('取消 (cancelDate あり): status: cancelled を返すこと', async () => {
      const mockRows = [
        {
          registrationNumber: 'T2000000000002',
          kind: '2',
          latest: '1',
          registrationDate: '2023-10-01',
          cancelDate: '2024-03-31',
          expireDate: null,
          legalName: '取消企業',
          headOfficeAddress: '東京都千代田区',
        },
      ];

      const mockDb = createMockDb({ rows: mockRows });
      const provider = new DbInvoiceDataProvider(mockDb);

      const result = await provider.lookupByRegistrationNumber('T2000000000002');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('cancelled');
        expect(result.value.cancellation_date).toBe('2024-03-31');
      }
    });

    it('失効 (expireDate あり): status: expired を返すこと', async () => {
      const mockRows = [
        {
          registrationNumber: 'T3000000000003',
          kind: '2',
          latest: '1',
          registrationDate: '2023-10-01',
          cancelDate: null,
          expireDate: '2024-06-30',
          legalName: '失効企業',
          headOfficeAddress: '東京都港区',
        },
      ];

      const mockDb = createMockDb({ rows: mockRows });
      const provider = new DbInvoiceDataProvider(mockDb);

      const result = await provider.lookupByRegistrationNumber('T3000000000003');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('expired');
        expect(result.value.expiration_date).toBe('2024-06-30');
      }
    });

    it('複数履歴レコードが存在する場合、latest = "1" の行で判定されること', async () => {
      const mockRows = [
        {
          registrationNumber: 'T4000000000004',
          kind: '2',
          latest: '0',
          registrationDate: '2023-10-01',
          cancelDate: null,
          expireDate: null,
          legalName: '旧社名株式会社',
          headOfficeAddress: '東京都千代田区',
        },
        {
          registrationNumber: 'T4000000000004',
          kind: '2',
          latest: '1',
          registrationDate: '2023-10-01',
          cancelDate: null,
          expireDate: null,
          legalName: '新社名株式会社',
          headOfficeAddress: '東京都中央区',
        },
      ];

      const mockDb = createMockDb({ rows: mockRows });
      const provider = new DbInvoiceDataProvider(mockDb);

      const result = await provider.lookupByRegistrationNumber('T4000000000004');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.corporate_name).toBe('新社名株式会社');
        expect(result.value.location).toBe('東京都中央区');
      }
    });
  });

  describe('基準日 (reference_date) の有効性判定', () => {
    const row = {
      registrationNumber: 'T5000000000005',
      kind: '2',
      latest: '1',
      registrationDate: '2023-10-01',
      cancelDate: '2024-05-01',
      expireDate: null,
      legalName: '判定テスト企業',
      headOfficeAddress: '東京都千代田区',
    };

    it('登録日より前の基準日の場合: false', async () => {
      const mockDb = createMockDb({ rows: [row] });
      const provider = new DbInvoiceDataProvider(mockDb);

      const result = await provider.lookupByRegistrationNumber('T5000000000005', '2023-09-30');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.was_registered_on_reference_date).toBe(false);
      }
    });

    it('登録日当日の場合: true', async () => {
      const mockDb = createMockDb({ rows: [row] });
      const provider = new DbInvoiceDataProvider(mockDb);

      const result = await provider.lookupByRegistrationNumber('T5000000000005', '2023-10-01');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.was_registered_on_reference_date).toBe(true);
      }
    });

    it('登録期間中の場合: true', async () => {
      const mockDb = createMockDb({ rows: [row] });
      const provider = new DbInvoiceDataProvider(mockDb);

      const result = await provider.lookupByRegistrationNumber('T5000000000005', '2024-04-30');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.was_registered_on_reference_date).toBe(true);
      }
    });

    it('取消日当日の場合: false（取消日前までが有効）', async () => {
      const mockDb = createMockDb({ rows: [row] });
      const provider = new DbInvoiceDataProvider(mockDb);

      const result = await provider.lookupByRegistrationNumber('T5000000000005', '2024-05-01');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.was_registered_on_reference_date).toBe(false);
      }
    });

    it('取消日より後の場合: false', async () => {
      const mockDb = createMockDb({ rows: [row] });
      const provider = new DbInvoiceDataProvider(mockDb);

      const result = await provider.lookupByRegistrationNumber('T5000000000005', '2024-05-02');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.was_registered_on_reference_date).toBe(false);
      }
    });
  });
});
