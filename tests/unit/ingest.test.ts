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

  it('インボイス公表CSV（公式24列・法人 kind=2）を正常にパースできる', () => {
    // 出典: 国税庁 適格請求書発行事業者公表システム「ダウンロードデータ（全件データ・差分データ）のリソース定義書」1.5版（項番7〜30の24列）
    // URL: https://www.invoice-kohyo.nta.go.jp/files/k-resource-dl.pdf （確認日: 2026-10-14）
    // 0:一連番号, 1:登録番号, 2:事業者処理区分, 3:訂正区分, 4:人格区分(2=法人), 5:国内外区分(1=国内), 6:最新履歴(1),
    // 7:登録年月日, 8:更新年月日, 9:取消年月日, 10:失効年月日,
    // 11:本店所在地(法人), 12:都道府県コード(法人), 13:市区町村コード(法人),
    // 14:所在地(公表申出), 15:都道府県コード(公表申出), 16:市区町村コード(公表申出),
    // 17:カナ, 18:氏名又は名称, 19:国内事務所所在地, 20:国内事務所都道府県コード, 21:国内事務所市区町村コード,
    // 22:主たる屋号, 23:通称・旧姓
    const line = [
      '1',
      '"T1000000000001"',
      '"01"',
      '"0"',
      '"2"',
      '"1"',
      '"1"',
      '"2023-10-01"',
      '"2026-04-01"',
      '""',
      '""',
      '"東京都千代田区霞が関一丁目１番１号"',
      '"13"',
      '"101"',
      '""',
      '""',
      '""',
      '"テストカブシキガイシャ"',
      '"テスト株式会社"',
      '""',
      '""',
      '""',
      '""',
      '""',
    ].join(',');

    const parsed = parseInvoiceCsvLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed?.sequenceNumber).toBe('1');
    expect(parsed?.registrationNumber).toBe('T1000000000001');
    expect(parsed?.process).toBe('01');
    expect(parsed?.correct).toBe('0');
    expect(parsed?.kind).toBe('2');
    expect(parsed?.country).toBe('1');
    expect(parsed?.latest).toBe('1');
    expect(parsed?.registrationDate).toBe('2023-10-01');
    expect(parsed?.updateDate).toBe('2026-04-01');
    expect(parsed?.headOfficeAddress).toBe('東京都千代田区霞が関一丁目１番１号');
    expect(parsed?.headOfficePrefectureCode).toBe('13');
    expect(parsed?.headOfficeCityCode).toBe('101');
    expect(parsed?.kana).toBe('テストカブシキガイシャ');
    expect(parsed?.legalName).toBe('テスト株式会社');
  });

  it('インボイス公表CSV（公式24列・人格のない社団等 kind=2・公表申出所在地あり）を正常にパースできる', () => {
    // リソース定義書1.5版: 人格のない社団等は人格区分「2（法人（人格のない社団等を含む））」に含まれ、
    // 所在地は列15〜17（項番21〜23: 本店又は主たる事務所の所在地（公表申出））に格納される。
    const line = [
      '2',
      '"T7000000000002"',
      '"01"',
      '"0"',
      '"2"',
      '"1"',
      '"1"',
      '"2023-10-01"',
      '"2026-04-01"',
      '""',
      '""',
      '""',
      '""',
      '""',
      '"大阪府大阪市北区中之島一丁目３番２０号"',
      '"27"',
      '"127"',
      '"テストキョウドウクミアイ"',
      '"テスト協同組合"',
      '""',
      '""',
      '""',
      '""',
      '""',
    ].join(',');

    const parsed = parseInvoiceCsvLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed?.sequenceNumber).toBe('2');
    expect(parsed?.registrationNumber).toBe('T7000000000002');
    expect(parsed?.kind).toBe('2');
    expect(parsed?.headOfficeAddress).toBeUndefined();
    expect(parsed?.declaredAddress).toBe('大阪府大阪市北区中之島一丁目３番２０号');
    expect(parsed?.declaredPrefectureCode).toBe('27');
    expect(parsed?.declaredCityCode).toBe('127');
    expect(parsed?.kana).toBe('テストキョウドウクミアイ');
    expect(parsed?.legalName).toBe('テスト協同組合');
  });

  it('【制約遵守】個人（kind=1）のインボイス行から名称・所在地・カナ・屋号・通称が除外される', () => {
    // 出典: リソース定義書1.5版 第2編 12〜13ページ 注記、および国税庁お知らせ（https://www.invoice-kohyo.nta.go.jp/news/r04/r04news04.html）
    // 令和4年9月26日から個人のダウンロードファイルでは氏名・屋号・通称・所在地が空文字になっているが、
    // 念のため、CSVに値が入っていたとしても kind='1' の行では名称・所在地・カナ・屋号・通称を保持しない。
    const line = [
      '3',
      '"T9999999999999"',
      '"01"',
      '"0"',
      '"1"',
      '"1"',
      '"1"',
      '"2023-10-01"',
      '"2026-04-01"',
      '""',
      '""',
      '"東京都港区芝公園一丁目"',
      '"13"',
      '"103"',
      '"東京都港区芝公園二丁目"',
      '"13"',
      '"103"',
      '"ヤマダタロウ"',
      '"山田太郎"',
      '"東京都港区芝公園三丁目"',
      '"13"',
      '"103"',
      '"山田商店"',
      '"旧姓山田"',
    ].join(',');

    const parsed = parseInvoiceCsvLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed?.sequenceNumber).toBe('3');
    expect(parsed?.registrationNumber).toBe('T9999999999999');
    expect(parsed?.kind).toBe('1');
    expect(parsed?.registrationDate).toBe('2023-10-01');
    expect(parsed?.updateDate).toBe('2026-04-01');
    // 名称・所在地・カナは保持しない
    expect(parsed?.legalName).toBeUndefined();
    expect(parsed?.kana).toBeUndefined();
    expect(parsed?.headOfficeAddress).toBeUndefined();
    expect(parsed?.headOfficePrefectureCode).toBeUndefined();
    expect(parsed?.headOfficeCityCode).toBeUndefined();
    expect(parsed?.declaredAddress).toBeUndefined();
    expect(parsed?.declaredPrefectureCode).toBeUndefined();
    expect(parsed?.declaredCityCode).toBeUndefined();
    expect(parsed?.domesticOfficeAddress).toBeUndefined();
    expect(parsed?.domesticOfficePrefectureCode).toBeUndefined();
    expect(parsed?.domesticOfficeCityCode).toBeUndefined();
    // 屋号・通称のプロパティ自体が存在しないこと
    expect('tradeName' in (parsed ?? {})).toBe(false);
    expect('commonName' in (parsed ?? {})).toBe(false);
  });

  it('【制約遵守】人格区分が不明な行（kind が 1 でも 2 でもない行）でも名称・所在地・カナ・屋号・通称が除外される', () => {
    const line = [
      '4',
      '"T8888888888888"',
      '"01"',
      '"0"',
      '"9"',
      '"1"',
      '"1"',
      '"2023-10-01"',
      '"2026-04-01"',
      '""',
      '""',
      '"東京都新宿区西新宿二丁目"',
      '"13"',
      '"104"',
      '"東京都新宿区西新宿二丁目"',
      '"13"',
      '"104"',
      '"フメイテスト"',
      '"不明区分テスト名称"',
      '"東京都新宿区西新宿二丁目"',
      '"13"',
      '"104"',
      '"不明屋号"',
      '"不明通称"',
    ].join(',');

    const parsed = parseInvoiceCsvLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed?.registrationNumber).toBe('T8888888888888');
    expect(parsed?.kind).toBe('9');
    expect(parsed?.legalName).toBeUndefined();
    expect(parsed?.kana).toBeUndefined();
    expect(parsed?.headOfficeAddress).toBeUndefined();
    expect(parsed?.declaredAddress).toBeUndefined();
    expect(parsed?.domesticOfficeAddress).toBeUndefined();
  });

  it('インボイス公表CSVで同じ登録番号の履歴複数行（latest=0 と latest=1）をそれぞれパースし、登録・取消・失効年月日を保持できる', () => {
    const historyLine = [
      '10',
      '"T1234567890123"',
      '"01"',
      '"0"',
      '"2"',
      '"1"',
      '"0"',
      '"2023-10-01"',
      '"2023-10-01"',
      '""',
      '""',
      '"東京都千代田区旧住所１−１"',
      '"13"',
      '"101"',
      '""',
      '""',
      '""',
      '"テストカブシキガイシャ"',
      '"テスト株式会社（旧）"',
      '""',
      '""',
      '""',
      '""',
      '""',
    ].join(',');

    const latestLine = [
      '11',
      '"T1234567890123"',
      '"03"',
      '"0"',
      '"2"',
      '"1"',
      '"1"',
      '"2023-10-01"',
      '"2025-04-01"',
      '"2025-03-31"',
      '"2025-04-01"',
      '"東京都千代田区新住所２−２"',
      '"13"',
      '"101"',
      '""',
      '""',
      '""',
      '"テストカブシキガイシャ"',
      '"テスト株式会社（新）"',
      '""',
      '""',
      '""',
      '""',
      '""',
    ].join(',');

    const parsedHistory = parseInvoiceCsvLine(historyLine);
    const parsedLatest = parseInvoiceCsvLine(latestLine);

    expect(parsedHistory).not.toBeNull();
    expect(parsedLatest).not.toBeNull();
    expect(parsedHistory?.sequenceNumber).toBe('10');
    expect(parsedHistory?.latest).toBe('0');
    expect(parsedHistory?.registrationDate).toBe('2023-10-01');
    expect(parsedHistory?.cancelDate).toBeUndefined();

    expect(parsedLatest?.sequenceNumber).toBe('11');
    expect(parsedLatest?.latest).toBe('1');
    expect(parsedLatest?.registrationDate).toBe('2023-10-01');
    expect(parsedLatest?.updateDate).toBe('2025-04-01');
    expect(parsedLatest?.cancelDate).toBe('2025-03-31');
    expect(parsedLatest?.expireDate).toBe('2025-04-01');
  });

  it('列数や列の並びが公式24列仕様と違うインボイスCSV行を与えたら失敗（null）する', () => {
    // 1. 旧14列仕様の行（列数不足）
    const old14ColLine =
      '1,"T1000000000001","01","0","2023-10-01","01","テスト株式会社","東京都","千代田区","霞が関一丁目","1000000000001","2023-10-01","",""';
    expect(parseInvoiceCsvLine(old14ColLine)).toBeNull();

    // 2. 24列あるが、列の並びが公式仕様と違う行（5列目の人格区分に更新年月日、6列目に旧事業者区分が入っているケース）
    const misaligned24ColLine = [
      '1',
      '"T1000000000001"',
      '"01"',
      '"0"',
      '"2023-10-01"', // 本来は kind (1 or 2) の列に日付が入っている
      '"01"', // 本来は country (1,2,3) の列に旧仕様の 01 が入っている
      '"テスト株式会社"', // 本来は latest (0,1) の列に商号が入っている
      '"東京都"',
      '"千代田区"',
      '"霞が関一丁目"',
      '"1000000000001"',
      '"2023-10-01"',
      '""',
      '""',
      '""',
      '""',
      '""',
      '""',
      '""',
      '""',
      '""',
      '""',
      '""',
      '""',
    ].join(',');
    expect(parseInvoiceCsvLine(misaligned24ColLine)).toBeNull();
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
  it('ログ出力に法人番号・登録番号・名称が含まれない（件数・所要時間・エラー種別・区分不明件数のみ）', () => {
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
        sourceType: 'nta_invoice_download',
        dataAsOf: '2026-10-01',
        datasetVersionId: 123,
        count: 500,
        durationMs: 120,
        status: 'active',
        unknownKindCount: 2,
      },
      'Invoice dataset import completed successfully',
    );

    expect(outputLogs.length).toBe(1);
    const parsedLog = JSON.parse(outputLogs[0] ?? '{}') as Record<string, unknown>;

    // 出力されているべきフィールド
    expect(parsedLog.count).toBe(500);
    expect(parsedLog.duration_ms).toBe(120);
    expect(parsedLog.status).toBe('active');
    expect(parsedLog.source_type).toBe('nta_invoice_download');
    expect(parsedLog.unknown_kind_count).toBe(2);

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
        return { rows: [{ acquired: true }] };
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

  it('ロック取得の予備経路（接続プールなし）で結果が読めない場合は取得失敗（skipped）として扱う', async () => {
    const mockDb = {
      execute: async () => {
        // rows が undefined または空の場合、acquired === true ではないためロック未取得となる
        return {};
      },
    } as unknown as DbClient;

    const importer = new DatasetImporter(mockDb);
    const testCsv = [
      '1,"1000000000001","01","1","2026-04-01","2026-04-01","テスト株式会社","","301","北海道","札幌市中央区","北一条西一丁目","","01","101","0600001","","","","","","","","1","","","","","","0"',
    ];

    const corpMetrics = await importer.importCorporateDataset(testCsv, '2026-10-01', 10);
    expect(corpMetrics.status).toBe('skipped');
    expect(corpMetrics.count).toBe(0);

    const invMetrics = await importer.importInvoiceDataset([], '2026-10-01', 10);
    expect(invMetrics.status).toBe('skipped');
    expect(invMetrics.count).toBe(0);
  });

  it('取り込み途中でエラーが発生した場合、failed となりトランザクションがロールバックされる', async () => {
    let failedVersionStatus = '';

    const mockDb = {
      execute: async () => ({ rows: [{ acquired: true }] }),
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
          return { rows: [{ acquired: true }] };
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

  it('importInvoiceDataset: 法人・人格のない社団等・個人・区分不明・履歴複数行を取り込み、区分不明件数をログに出す（値は出さない）', async () => {
    const insertedBatches: unknown[] = [];
    const executedSqls: unknown[] = [];
    const outputLogs: string[] = [];
    let updatedStatus = '';

    const mockStream = {
      write: (chunk: string) => {
        outputLogs.push(chunk);
        return true;
      },
    };

    const mockDb = {
      execute: async (query: unknown) => {
        executedSqls.push(query);
        return { rows: [{ acquired: true }] };
      },
      insert: () => ({
        values: (val: unknown) => {
          insertedBatches.push(val);
          return {
            returning: async () => [{ id: 77 }],
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
        };
        return cb(mockTx);
      },
    } as unknown as DbClient;

    const importer = new DatasetImporter(mockDb, {
      logger: createIngestLogger(mockStream as unknown as NodeJS.WritableStream),
    });

    const invoiceLines = [
      // 1. 法人（過去履歴 latest=0）
      '1,"T1000000000001","01","0","2","1","0","2023-10-01","2023-10-01","","","東京都千代田区旧１−１","13","101","","","","テストカブシキガイシャ","テスト株式会社（旧）","","","","",""',
      // 2. 法人（最新履歴 latest=1）
      '2,"T1000000000001","03","0","2","1","1","2023-10-01","2026-04-01","","","東京都千代田区新２−２","13","101","","","","テストカブシキガイシャ","テスト株式会社（新）","","","","",""',
      // 3. 人格のない社団等（kind=2, 公表申出所在地）
      '3,"T7000000000002","01","0","2","1","1","2023-10-01","2026-04-01","","","","","","大阪府大阪市北区１−１","27","127","テストキョウドウクミアイ","テスト協同組合","","","","",""',
      // 4. 個人（kind=1）
      '4,"T9999999999999","01","0","1","1","1","2023-10-01","2026-04-01","","","東京都港区１−１","13","103","","","","ヤマダタロウ","山田太郎","","","","山田商店","旧姓山田"',
      // 5. 区分不明（kind=9）
      '5,"T8888888888888","01","0","9","1","1","2023-10-01","2026-04-01","","","東京都新宿区１−１","13","104","","","","フメイ","不明名称","","","","不明屋号","不明通称"',
    ];

    const metrics = await importer.importInvoiceDataset(invoiceLines, '2026-10-01', 10);

    expect(metrics.status).toBe('active');
    expect(metrics.count).toBe(5);
    expect(metrics.unknownKindCount).toBe(1);
    expect(updatedStatus).toBe('active');

    // ログに unknown_kind_count=1 が出力され、かつ生の値や登録番号・名称が出力されていないこと
    expect(outputLogs.length).toBe(1);
    const logObj = JSON.parse(outputLogs[0] ?? '{}') as Record<string, unknown>;
    expect(logObj.unknown_kind_count).toBe(1);
    expect(logObj.count).toBe(5);
    expect(outputLogs[0]).not.toContain('T8888888888888');
    expect(outputLogs[0]).not.toContain('不明名称');
  });

  it('importInvoiceDataset: 並びが違う行が含まれる場合はエラーとなり failed になる', async () => {
    let failedStatus = '';

    const mockDb = {
      execute: async () => ({ rows: [{ acquired: true }] }),
      insert: () => ({
        values: () => ({
          returning: async () => [{ id: 88 }],
          execute: async () => {},
        }),
      }),
      update: () => ({
        set: (setVal: { status: string }) => ({
          where: () => {
            failedStatus = setVal.status;
            return Promise.resolve();
          },
        }),
      }),
    } as unknown as DbClient;

    const importer = new DatasetImporter(mockDb);
    const misalignedLines = [
      '1,"T1000000000001","01","0","2023-10-01","01","テスト株式会社","東京都","千代田区","霞が関一丁目","1000000000001","2023-10-01","",""',
    ];

    await expect(
      importer.importInvoiceDataset(misalignedLines, '2026-10-01', 10),
    ).rejects.toThrow();
    expect(failedStatus).toBe('failed');
  });
});
