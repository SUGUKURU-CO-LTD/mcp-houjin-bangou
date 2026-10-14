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

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, it, expect } from 'vitest';
import { parseCorporateCsvLine, parseInvoiceCsvLine } from '../../src/ingest/parser.js';
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

  it('30項目目の検索対象除外フラグ（hihyoji）を正常にパースできる', () => {
    // 30列目に "1"（検索対象外）が指定された合成テストデータ
    const lineWithHihyoji1 =
      '1,"1000000000001","01","1","2026-04-01","2026-04-01","テスト株式会社","","301","東京都","千代田区","霞が関一丁目","","13","101","1000001","","","","","","","","1","","","","","","1"';
    const parsed1 = parseCorporateCsvLine(lineWithHihyoji1);
    expect(parsed1?.hihyoji).toBe('1');

    // 30列目が "0"（検索対象）の合成テストデータ
    const lineWithHihyoji0 =
      '2,"1000000000002","01","1","2026-04-01","2026-04-01","テスト株式会社2","","301","東京都","千代田区","霞が関一丁目","","13","101","1000001","","","","","","","","1","","","","","","0"';
    const parsed0 = parseCorporateCsvLine(lineWithHihyoji0);
    expect(parsed0?.hihyoji).toBe('0');

    // 29項目（30列目なし）の場合はデフォルト "0" になること
    const line29Cols =
      '3,"1000000000003","01","1","2026-04-01","2026-04-01","テスト株式会社3","","301","東京都","千代田区","霞が関一丁目","","13","101","1000001","","","","","","","","1","","","","",""';
    const parsedDefault = parseCorporateCsvLine(line29Cols);
    expect(parsedDefault?.hihyoji).toBe('0');
  });

  it('処理区分99（削除）などカラム数が少ない行でも正常にパースできる', () => {
    // 処理区分99（削除）で最低限の項目（一連番号、法人番号、処理区分、訂正区分、更新年月日）のみが存在する合成テストデータ
    const deleteLine = '10,"9000000000009","99","0","2026-04-01"';
    const parsed = parseCorporateCsvLine(deleteLine);
    expect(parsed).not.toBeNull();
    expect(parsed?.corporateNumber).toBe('9000000000009');
    expect(parsed?.process).toBe('99');
    expect(parsed?.correct).toBe('0');
    expect(parsed?.updateDate).toBe('2026-04-01');
    expect(parsed?.name).toBe('');
    expect(parsed?.hihyoji).toBe('0');
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
  it('正常時は新テーブル（corporate_numbers_new）へ全件投入され RENAME で本番テーブルへ入れ替わり active に昇格する', async () => {
    const insertedStagingBatches: unknown[] = [];
    const executedSqls: unknown[] = [];
    let updatedVersionStatus = '';

    const mockDb = {
      execute: async (query: unknown) => {
        executedSqls.push(query);
      },
      insert: () => ({
        values: (val: unknown) => {
          insertedStagingBatches.push(val);
          return {
            returning: async () => [{ id: 42 }],
            execute: async () => {},
          };
        },
      }),
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        const mockTx = {
          execute: async (query: unknown) => {
            executedSqls.push(query);
          },
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
      '1,"1000000000001","01","1","2026-04-01","2026-04-01","テスト株式会社","","301","北海道","札幌市中央区","北一条西一丁目","","01","101","0600001","","","","","","","","1","","","","","","0"',
    ];

    const metrics = await importer.importCorporateDataset(testCsv, '2026-10-01', 10);

    expect(metrics.status).toBe('active');
    expect(metrics.count).toBe(1);
    expect(updatedVersionStatus).toBe('active');
    // 新テーブルへのバッチ挿入が行われたこと
    expect(insertedStagingBatches.length).toBeGreaterThan(0);
    // Node.js メモリ展開ではなく DB 内 SQL による RENAME 入れ替え・旧表削除・ANALYZE が行われたこと
    expect(executedSqls.length).toBeGreaterThanOrEqual(2);
  });

  it('取り込み途中でエラーが発生した場合、failed となりトランザクションがロールバックされる', async () => {
    let failedVersionStatus = '';

    const mockDb = {
      execute: async () => {},
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

    await expect(importer.importCorporateDataset(testCsv, '2026-10-01', 10)).rejects.toThrow();

    // 途中で失敗した版は failed となり、前の active 版には影響を与えない
    expect(failedVersionStatus).toBe('failed');
  });

  it('swapCorporateTable: 全件取り込み後のテーブル一括入れ替え（RENAME Swap）がトランザクション内で実行される', async () => {
    let executedSql = false;
    let versionUpdated = false;

    let droppedOldTable = false;

    const mockDb = {
      execute: async () => {
        droppedOldTable = true;
      },
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        const mockTx = {
          execute: async () => {
            executedSql = true;
          },
          update: () => ({
            set: () => ({
              where: () => {
                versionUpdated = true;
                return Promise.resolve();
              },
            }),
          }),
        };
        return cb(mockTx);
      },
    } as unknown as DbClient;

    const importer = new DatasetImporter(mockDb);
    const result = await importer.swapCorporateTable(101, 10, '2026-10-01');

    expect(executedSql).toBe(true);
    expect(droppedOldTable).toBe(true);
    expect(versionUpdated).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('importCorporateFiles: 複数分割ファイルを行単位ストリーミングで読み込み staging に投入できる', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-test-'));
    const file1 = path.join(tmpDir, 'corp_part1.csv');
    const file2 = path.join(tmpDir, 'corp_part2.csv');

    const csvLine1 =
      '1,"1000000000001","01","1","2026-04-01","2026-04-01","テスト株式会社1","","301","東京都","千代田区","霞が関一丁目","","13","101","1000001","","","","","","","","1","","","","","","0"\n';
    const csvLine2 =
      '2,"1000000000002","01","1","2026-04-01","2026-04-01","テスト株式会社2","","301","東京都","千代田区","霞が関二丁目","","13","101","1000002","","","","","","","","1","","","","","","0"\n';

    fs.writeFileSync(file1, csvLine1, 'utf-8');
    fs.writeFileSync(file2, csvLine2, 'utf-8');

    try {
      const insertedBatches: unknown[] = [];
      const executedSqls: unknown[] = [];
      let updatedStatus = '';

      const mockDb = {
        execute: async (query: unknown) => {
          executedSqls.push(query);
        },
        insert: () => ({
          values: (val: unknown) => {
            insertedBatches.push(val);
            return {
              returning: async () => [{ id: 55 }],
              execute: async () => {},
            };
          },
        }),
        transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            execute: async (query: unknown) => {
              executedSqls.push(query);
            },
            update: () => ({
              set: (setVal: { status: string }) => ({
                where: () => {
                  updatedStatus = setVal.status;
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
      const metrics = await importer.importCorporateFiles([file1, file2], '2026-10-01', 1);

      expect(metrics.status).toBe('active');
      expect(metrics.count).toBe(2);
      expect(updatedStatus).toBe('active');
      expect(insertedBatches.length).toBeGreaterThanOrEqual(2);
      expect(executedSqls.length).toBeGreaterThanOrEqual(2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
