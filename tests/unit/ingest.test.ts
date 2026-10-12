/**
 * Ingest Engine Unit Tests
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §6.1, §6.2 (ホスト版データ取り込み)
 *   実装指示書v1 §5(B4)
 *
 * 【テストデータの性格】
 *   本テストで使用しているデータはすべてテスト用に作成した「合成データ」であり、
 *   実在する事業者や個人の情報、国税庁本番データではありません。
 */

import { describe, it, expect } from 'vitest';
import {
  parseCorporateCsvLine,
  parseInvoiceCsvLine,
} from '../../src/ingest/parser.js';
import { createIngestLogger } from '../../src/ingest/logger.js';
import { DatasetImporter } from '../../src/ingest/importer.js';
import type { DbClient } from '../../src/db/client.js';

describe('Ingest Parser (合成テストデータ使用)', () => {
  it('基本3情報CSV（29項目）を正常にパースできる', () => {
    // 国税庁ファイルレイアウト仕様（29項目）に基づく合成テストデータ
    // 1:一連番号, 2:法人番号, 3:処理区分, 4:訂正区分, 5:更新年月日, 6:変更年月日, 7:商号, 8:商号イメージID, 9:法人種別,
    // 10:都道府県名, 11:市区町村名, 12:町名番地, 13:所在地イメージID, 14:都道府県コード, 15:市区町村コード, 16:郵便番号...
    const line =
      '1,"1000000000001","01","1","2026-04-01","2026-04-01","テスト株式会社","","301","北海道","札幌市中央区","北一条西一丁目","","01","101","0600001","","","","","","","","1","","","","",""';

    const parsed = parseCorporateCsvLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed?.corporateNumber).toBe('1000000000001');
    expect(parsed?.name).toBe('テスト株式会社');
    expect(parsed?.kind).toBe('301');
    expect(parsed?.prefectureName).toBe('北海道');
    expect(parsed?.cityName).toBe('札幌市中央区');
    expect(parsed?.streetNumber).toBe('北一条西一丁目');
    expect(parsed?.prefectureCode).toBe('01');
    expect(parsed?.cityCode).toBe('101');
    expect(parsed?.postCode).toBe('0600001');
  });

  it('インボイス公表CSV（法人 kind=01）を正常にパースできる', () => {
    // 国税庁インボイス公表ファイル仕様に基づく合成テストデータ
    // 0:一連番号, 1:登録番号, 2:処理区分, 3:訂正区分, 4:更新年月日, 5:事業者区分(01), 6:商号, 7:都道府県, 8:市区町村, 9:町名番地, 10:法人番号, 11:登録年月日...
    const line =
      '1,"T1000000000001","01","1","2023-10-01","01","テスト株式会社","東京都","千代田区","霞が関一丁目","1000000000001","2023-10-01","",""';

    const parsed = parseInvoiceCsvLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed?.registrationNumber).toBe('T1000000000001');
    expect(parsed?.corporateNumber).toBe('1000000000001');
    expect(parsed?.kind).toBe('01');
    expect(parsed?.legalName).toBe('テスト株式会社');
    expect(parsed?.prefectureName).toBe('東京都');
    expect(parsed?.cityName).toBe('千代田区');
    expect(parsed?.streetNumber).toBe('霞が関一丁目');
  });

  it('【制約遵守】個人事業者（kind=02）のインボイス行から氏名・屋号・所在地が除外される', () => {
    // 国税庁のダウンロードデータでは個人事業者の氏名等は削除されている（国税庁インボイスQ&A 問21）。念のため、パーサーでも除外している。
    // 事業者区分 02 の出典: 国税庁適格請求書発行事業者公表システム「リソース定義書（全件データ・差分データ）」
    // 合成テストデータ（個人事業者 kind=02、テスト用氏名）
    // 0:一連番号, 1:登録番号, 2:処理区分, 3:訂正区分, 4:更新年月日, 5:事業者区分(02), 6:屋号・氏名, 7:都道府県, 8:市区町村, 9:町名番地, 10:法人番号(""), 11:登録年月日...
    const line =
      '2,"T9999999999999","01","1","2023-10-01","02","山田商店","東京都","港区","芝公園一丁目","","2023-10-01","",""';

    const parsed = parseInvoiceCsvLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed?.registrationNumber).toBe('T9999999999999');
    expect(parsed?.kind).toBe('02');
    // 法人番号は存在しない (undefined)
    expect(parsed?.corporateNumber).toBeUndefined();
    // 氏名・屋号・所在地は除外されて undefined
    expect(parsed?.legalName).toBeUndefined();
    expect(parsed?.prefectureName).toBeUndefined();
    expect(parsed?.cityName).toBeUndefined();
    expect(parsed?.streetNumber).toBeUndefined();
  });
});

describe('Ingest Logger (機密性検証)', () => {
  it('ログ出力に法人番号・登録番号・名称が含まれない（件数・所要時間・エラー種別のみ）', () => {
    const outputLogs: string[] = [];
    const mockStream = {
      write: (chunk: string) => {
        outputLogs.push(chunk);
        return true;
      },
    };

    const logger = createIngestLogger(mockStream as unknown as NodeJS.WritableStream);

    logger.info(
      {
        sourceType: 'nta_corporate_download',
        dataAsOf: '2026-10-01',
        datasetVersionId: 123,
        count: 500,
        durationMs: 120,
        status: 'active',
      },
      'Corporate dataset import completed successfully',
    );

    expect(outputLogs.length).toBe(1);
    const parsedLog = JSON.parse(outputLogs[0] ?? '{}') as Record<string, unknown>;

    // 出力されているべきフィールド
    expect(parsedLog.count).toBe(500);
    expect(parsedLog.duration_ms).toBe(120);
    expect(parsedLog.status).toBe('active');
    expect(parsedLog.source_type).toBe('nta_corporate_download');

    // 含まれていてはならない識別子・個人情報フィールド
    expect(parsedLog.corporate_number).toBeUndefined();
    expect(parsedLog.registration_number).toBeUndefined();
    expect(parsedLog.name).toBeUndefined();
    expect(parsedLog.legal_name).toBeUndefined();

    // ログ文字列自体にも識別子パターン（13桁数字や T+13桁）が含まれないこと
    const fullLogText = outputLogs[0] ?? '';
    expect(fullLogText).not.toMatch(/[0-9]{13}/);
    expect(fullLogText).not.toMatch(/T[0-9]{13}/);
  });
});

describe('DatasetImporter Atomic Switch (合成テストデータ使用)', () => {
  it('正常時は staging から本番テーブルへ全件投入され active に昇格する', async () => {
    const insertedStagingRows: unknown[] = [];
    const insertedActiveRows: unknown[] = [];
    let updatedVersionStatus = '';

    const mockDb = {
      insert: () => ({
        values: (val: unknown) => ({
          returning: async () => [{ id: 42 }],
          execute: async () => {
            insertedStagingRows.push(val);
          },
        }),
      }),
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        const mockTx = {
          select: () => ({
            from: () => ({
              where: () => Promise.resolve([
                {
                  corporateNumber: '1000000000001',
                  process: '01',
                  correct: '1',
                  updateDate: '2026-04-01',
                  changeDate: '2026-04-01',
                  name: 'テスト株式会社',
                  nameImageId: null,
                  kind: '301',
                  prefectureName: '北海道',
                  cityName: '札幌市中央区',
                  streetNumber: '北一条西一丁目',
                  addressImageId: null,
                  prefectureCode: '01',
                  cityCode: '101',
                  postCode: '0600001',
                  addressOutside: null,
                  addressOutsideImageId: null,
                  closeDate: null,
                  closeCause: null,
                  furigana: null,
                  hihyoji: '0',
                },
              ]),
            }),
          }),
          insert: () => ({
            values: (val: unknown) => {
              insertedActiveRows.push(val);
              return Promise.resolve();
            },
          }),
          update: () => ({
            set: (setVal: { status: string; recordCount?: number }) => ({
              where: () => {
                updatedVersionStatus = setVal.status;
                return Promise.resolve();
              },
            }),
          }),
          delete: () => ({
            where: () => Promise.resolve(),
          }),
        };
        return cb(mockTx);
      },
    } as unknown as DbClient;

    const importer = new DatasetImporter(mockDb);

    const testCsv = [
      '1,"1000000000001","01","1","2026-04-01","2026-04-01","テスト株式会社","","301","北海道","札幌市中央区","北一条西一丁目","","01","101","0600001","","","","","","","","1","","","","",""',
    ];

    const metrics = await importer.importCorporateDataset(testCsv, '2026-10-01', 10);

    expect(metrics.status).toBe('active');
    expect(metrics.count).toBe(1);
    expect(updatedVersionStatus).toBe('active');
    expect(insertedActiveRows.length).toBe(1);
  });

  it('取り込み途中でエラーが発生した場合、failed となりトランザクションがロールバックされる', async () => {
    let failedVersionStatus = '';

    const mockDb = {
      insert: () => ({
        values: () => ({
          returning: async () => [{ id: 99 }],
          execute: async () => {
            throw new Error('Disk full error (simulated)');
          },
        }),
      }),
      update: () => ({
        set: (setVal: { status: string }) => ({
          where: () => {
            failedVersionStatus = setVal.status;
            return Promise.resolve();
          },
        }),
      }),
      delete: () => ({
        where: () => Promise.resolve(),
      }),
    } as unknown as DbClient;

    const importer = new DatasetImporter(mockDb);
    const testCsv = ['invalid line that triggers error'];

    await expect(
      importer.importCorporateDataset(testCsv, '2026-10-01', 10),
    ).rejects.toThrow();

    // 途中で失敗した版は failed となり、前の active 版には影響を与えない
    expect(failedVersionStatus).toBe('failed');
  });
});
