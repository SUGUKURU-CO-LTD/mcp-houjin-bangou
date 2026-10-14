/**
 * Ingest Atomic Swap Integration Tests (PostgreSQL 16 実DB実行)
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §6.1, §6.2 (ホスト版データ取り込み・全件入れ替え)
 *   Linear Issue: SLA2-324 完了条件:
 *     - 合成データで「初回取り込み→2回目の全件入れ替え→検索」が通り、
 *     - 2回目の途中で失敗させても前の版と前の data_as_of で検索できることを実証する。
 *     - Docker 上の実 PostgreSQL 16（ポート 55069 または CI 5432）で実行し、
 *       RENAME 方式のアトミックスワップ、制約・全5本索引の復元、ロールバックを検証する。
 *
 * 【テストデータの性格】
 *   本テストで使用しているデータはすべてテスト用に作成した「合成データ」であり、
 *   実在する事業者や個人の情報、国税庁本番データではありません。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { sql, eq, and } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '../../src/db/schema.js';
import { datasetVersions, corporateNumbers, invoiceIssuers } from '../../src/db/schema.js';
import { DatasetImporter } from '../../src/ingest/importer.js';
import { DbCorporateDataProvider } from '../../src/repository/corporate-repository.js';
import type { DbClient } from '../../src/db/client.js';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgres://test:test@localhost:55069/test';

describe('Ingest Atomic Swap Integration Tests (PostgreSQL 16 実DB・合成テストデータ)', () => {
  let pool: pg.Pool;
  let db: DbClient;
  let importer: DatasetImporter;
  let dataProvider: DbCorporateDataProvider;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: TEST_DB_URL,
      max: 5,
    });
    db = drizzle(pool, { schema }) as DbClient;

    // マイグレーション適用（0000, 0001, 0002, 0003）
    const migrationsFolder = path.resolve(__dirname, '../../drizzle');
    await migrate(db as unknown as NodePgDatabase<Record<string, unknown>>, { migrationsFolder });

    importer = new DatasetImporter(db);
    dataProvider = new DbCorporateDataProvider(db);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  beforeEach(async () => {
    // テーブル状態のリセット
    await db.execute(sql`DROP TABLE IF EXISTS corporate_numbers_new;`);
    await db.execute(sql`DROP TABLE IF EXISTS corporate_numbers_old;`);
    await db.execute(sql`DROP TABLE IF EXISTS invoice_issuers_new;`);
    await db.execute(sql`DROP TABLE IF EXISTS invoice_issuers_old;`);
    await db.execute(
      sql`TRUNCATE TABLE corporate_numbers, invoice_issuers, dataset_versions CASCADE;`,
    );
  });

  it('初回取り込み成功 → 2回目取り込み途中で失敗しても前世代の版とデータで検索可能 → 2回目再試行で全件入れ替えが成功する', async () => {
    // ==========================================
    // 1. 初回取り込み（v1: 2026-09-01 時点）
    // ==========================================
    const initialDataset = [
      '1,"1000000000001","01","1","2026-09-01","2026-09-01","株式会社テスト第一","","301","東京都","千代田区","大手町一丁目","","13","101","1000001","","","","","","","","1","","","","","","0"',
      '2,"1000000000002","01","1","2026-09-01","2026-09-01","株式会社テスト第二","","301","東京都","中央区","日本橋一丁目","","13","102","1030001","","","","","","","","1","","","","","","0"',
    ];

    const v1Metrics = await importer.importCorporateDataset(initialDataset, '2026-09-01', 10);
    expect(v1Metrics.status).toBe('active');
    expect(v1Metrics.count).toBe(2);
    expect(v1Metrics.datasetVersionId).toBeGreaterThan(0);
    const v1Id = v1Metrics.datasetVersionId;

    // v1 時点での検索確認
    // 単独検索
    const lookup1 = await dataProvider.lookupByNumber('1000000000001');
    expect(lookup1.ok).toBe(true);
    if (lookup1.ok) {
      expect(lookup1.value.data_as_of).toBe('2026-09-01');
      expect(lookup1.value.corporation.name).toBe('株式会社テスト第一');
    }

    // 名前検索（GIN 索引 + pg_trgm が動作していることを検証）
    const search1 = await dataProvider.searchByName('株式会社テスト第一');
    expect(search1.ok).toBe(true);
    if (search1.ok) {
      expect(search1.value.data_as_of).toBe('2026-09-01');
      expect(search1.value.results.length).toBeGreaterThan(0);
      expect(search1.value.results[0]?.corporate_number).toBe('1000000000001');
    }

    // ==========================================
    // 2. 2回目の取り込み（v2: 2026-10-01 時点）で障害発生・ロールバック
    // ==========================================
    // DB 列長制約（kind は varchar(3)）を超える不正データにより、バッチ挿入時に DB エラーを発生させる
    const brokenDataset = [
      '1,"1000000000001","01","1","2026-10-01","2026-10-01","株式会社テスト第一（更新版）","","301","東京都","千代田区","丸の内一丁目","","13","101","1000005","","","","","","","","1","","","","","","0"',
      '3,"1000000000003","01","1","2026-10-01","2026-10-01","株式会社テスト第三（異常値）","","TOOLONG_KIND_EXCEEDS_LIMIT","東京都","港区","六本木一丁目","","13","103","1060001","","","","","","","","1","","","","","","0"',
    ];

    await expect(
      importer.importCorporateDataset(brokenDataset, '2026-10-01', 10),
    ).rejects.toThrow();

    // v2 は failed にマークされていること
    const [failedVersion] = await db
      .select()
      .from(datasetVersions)
      .where(
        and(
          eq(datasetVersions.sourceType, 'nta_corporate_download'),
          eq(datasetVersions.status, 'failed'),
        ),
      );
    expect(failedVersion).toBeDefined();
    expect(failedVersion?.status).toBe('failed');

    // 一時テーブル corporate_numbers_new がクリーンアップされていること
    const newTableCheck = await db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_name = 'corporate_numbers_new';`,
    );
    expect(newTableCheck.rows.length).toBe(0);

    // 【最重要完了条件】
    // 障害発生後も、前世代（v1）の active 版と data_as_of（2026-09-01）で継続して検索できること
    const lookupAfterFail = await dataProvider.lookupByNumber('1000000000001');
    expect(lookupAfterFail.ok).toBe(true);
    if (lookupAfterFail.ok) {
      expect(lookupAfterFail.value.data_as_of).toBe('2026-09-01');
      expect(lookupAfterFail.value.corporation.name).toBe('株式会社テスト第一');
    }

    const searchAfterFail = await dataProvider.searchByName('株式会社テスト第一');
    expect(searchAfterFail.ok).toBe(true);
    if (searchAfterFail.ok) {
      expect(searchAfterFail.value.data_as_of).toBe('2026-09-01');
      expect(searchAfterFail.value.results[0]?.corporate_number).toBe('1000000000001');
    }

    // ==========================================
    // 3. 2回目の再試行（v3: 2026-10-01 時点）で全件入れ替えが成功
    // ==========================================
    const retryDataset = [
      '1,"1000000000001","01","1","2026-10-01","2026-10-01","株式会社テスト第一（新本店）","","301","東京都","千代田区","丸の内一丁目","","13","101","1000005","","","","","","","","1","","","","","","0"',
      '3,"1000000000003","01","1","2026-10-01","2026-10-01","株式会社テスト第三（新設）","","301","東京都","港区","六本木一丁目","","13","103","1060001","","","","","","","","1","","","","","","0"',
    ];

    const v3Metrics = await importer.importCorporateDataset(retryDataset, '2026-10-01', 10);
    expect(v3Metrics.status).toBe('active');
    expect(v3Metrics.count).toBe(2);
    expect(v3Metrics.datasetVersionId).toBeGreaterThan(v1Id);

    // v1 は superseded になっていること
    const [v1Record] = await db.select().from(datasetVersions).where(eq(datasetVersions.id, v1Id));
    expect(v1Record?.status).toBe('superseded');

    // corporate_numbers_old が削除されていること（CASCADE なし）
    const oldTableCheck = await db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_name = 'corporate_numbers_old';`,
    );
    expect(oldTableCheck.rows.length).toBe(0);

    // 最新の v3 (data_as_of: 2026-10-01) で検索できること
    const lookupAfterSwap = await dataProvider.lookupByNumber('1000000000001');
    expect(lookupAfterSwap.ok).toBe(true);
    if (lookupAfterSwap.ok) {
      expect(lookupAfterSwap.value.data_as_of).toBe('2026-10-01');
      expect(lookupAfterSwap.value.corporation.name).toBe('株式会社テスト第一（新本店）');
    }

    const searchAfterSwap = await dataProvider.searchByName('株式会社テスト');
    expect(searchAfterSwap.ok).toBe(true);
    if (searchAfterSwap.ok) {
      expect(searchAfterSwap.value.data_as_of).toBe('2026-10-01');
      const nums = searchAfterSwap.value.results.map((r) => r.corporate_number);
      expect(nums).toContain('1000000000001');
      expect(nums).toContain('1000000000003');
      // 全件入れ替え（RENAME Swap）により、v1 にあった 1000000000002 は削除されていること
      expect(nums).not.toContain('1000000000002');
    }

    // 索引名が正規名に復元されていることを検証
    const indexCheck = await db.execute(
      sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'corporate_numbers';`,
    );
    const indexNames = (indexCheck.rows as Array<{ indexname: string }>).map((r) => r.indexname);
    expect(indexNames).toContain('idx_corporate_numbers_number');
    expect(indexNames).toContain('idx_corporate_numbers_name');
    expect(indexNames).toContain('idx_corporate_numbers_name_trgm');
    expect(indexNames).toContain('idx_corporate_numbers_prefecture');
    expect(indexNames).toContain('idx_corporate_numbers_version');
    // _new や _old の索引名が残っていないこと
    expect(indexNames.some((n) => n.endsWith('_new') || n.endsWith('_old'))).toBe(false);
  });

  it('swapCorporateTable: トランザクション内でエラーが発生した場合、テーブル状態およびバージョン状態が巻き戻される', async () => {
    // 1. 初期 active 版を設定
    const [v1] = await db
      .insert(datasetVersions)
      .values({
        sourceType: 'nta_corporate_download',
        dataAsOf: '2026-09-01',
        status: 'active',
        recordCount: 10,
      })
      .returning({ id: datasetVersions.id });

    // 2. 新規 staging 版を作成
    const [v2] = await db
      .insert(datasetVersions)
      .values({
        sourceType: 'nta_corporate_download',
        dataAsOf: '2026-10-01',
        status: 'staging',
        recordCount: 12,
      })
      .returning({ id: datasetVersions.id });

    expect(v1).toBeDefined();
    expect(v2).toBeDefined();
    if (!v1 || !v2) {
      throw new Error('Failed to create test versions');
    }

    // corporate_numbers_new が存在しない状態で swapCorporateTable を呼ぶと、
    // RENAME 処理のトランザクション内で失敗する
    await expect(importer.swapCorporateTable(v2.id, 12, '2026-10-01')).rejects.toThrow();

    // トランザクションがロールバックされ、v1 は依然として active であること
    const [v1After] = await db.select().from(datasetVersions).where(eq(datasetVersions.id, v1.id));
    expect(v1After?.status).toBe('active');

    // v2 は active に昇格せず staging のままであること
    const [v2After] = await db.select().from(datasetVersions).where(eq(datasetVersions.id, v2.id));
    expect(v2After?.status).toBe('staging');
  });

  it('swapCorporateTable: 正常にテーブルとインデックス・制約がスワップされ、旧表が削除される', async () => {
    // 1. 初期 active 版とデータ
    const [v1] = await db
      .insert(datasetVersions)
      .values({
        sourceType: 'nta_corporate_download',
        dataAsOf: '2026-09-01',
        status: 'active',
        recordCount: 1,
      })
      .returning({ id: datasetVersions.id });

    // 2. 新規 staging 版
    const [v2] = await db
      .insert(datasetVersions)
      .values({
        sourceType: 'nta_corporate_download',
        dataAsOf: '2026-10-01',
        status: 'staging',
        recordCount: 1,
      })
      .returning({ id: datasetVersions.id });

    expect(v1).toBeDefined();
    expect(v2).toBeDefined();
    if (!v1 || !v2) {
      throw new Error('Failed to create test versions');
    }

    await db.insert(corporateNumbers).values({
      corporateNumber: '1111111111111',
      name: '旧テスト株式会社',
      kind: '301',
      updateDate: '2026-09-01',
      datasetVersionId: v1.id,
    });

    // 3. corporate_numbers_new を構築
    await db.execute(sql`DROP TABLE IF EXISTS corporate_numbers_new;`);
    await db.execute(
      sql`CREATE TABLE corporate_numbers_new (LIKE corporate_numbers INCLUDING DEFAULTS);`,
    );
    await db.execute(sql`
      INSERT INTO corporate_numbers_new (
        corporate_number, name, kind, update_date, dataset_version_id
      ) VALUES (
        '2222222222222', '新テスト株式会社', '301', '2026-10-01', ${v2.id}
      );
    `);
    // 制約と一時索引を作成
    await db.execute(sql`
      ALTER TABLE corporate_numbers_new
        ADD CONSTRAINT corporate_numbers_new_pk PRIMARY KEY (corporate_number, dataset_version_id);
      ALTER TABLE corporate_numbers_new
        ADD CONSTRAINT corporate_numbers_new_dataset_versions_fk
        FOREIGN KEY (dataset_version_id) REFERENCES dataset_versions(id) ON DELETE CASCADE;
      CREATE INDEX idx_corporate_numbers_number_new ON corporate_numbers_new (corporate_number);
      CREATE INDEX idx_corporate_numbers_name_new ON corporate_numbers_new (name);
      CREATE INDEX idx_corporate_numbers_name_trgm_new ON corporate_numbers_new USING gin (name gin_trgm_ops);
      CREATE INDEX idx_corporate_numbers_prefecture_new ON corporate_numbers_new (prefecture_code);
      CREATE INDEX idx_corporate_numbers_version_new ON corporate_numbers_new (dataset_version_id);
    `);

    // 4. swapCorporateTable を実行
    const swapResult = await importer.swapCorporateTable(v2.id, 1, '2026-10-01');
    expect(swapResult.durationMs).toBeGreaterThanOrEqual(0);

    // v1 は superseded、v2 は active
    const [v1Final] = await db.select().from(datasetVersions).where(eq(datasetVersions.id, v1.id));
    const [v2Final] = await db.select().from(datasetVersions).where(eq(datasetVersions.id, v2.id));
    expect(v1Final?.status).toBe('superseded');
    expect(v2Final?.status).toBe('active');

    // corporate_numbers_old は削除されていること
    const oldTableCheck = await db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_name = 'corporate_numbers_old';`,
    );
    expect(oldTableCheck.rows.length).toBe(0);

    // 新テーブルの内容が検索できること
    const lookup = await dataProvider.lookupByNumber('2222222222222');
    expect(lookup.ok).toBe(true);
    if (lookup.ok) {
      expect(lookup.value.corporation.name).toBe('新テスト株式会社');
    }
  });

  it('取り込みを2つ同時に起動した場合、アドバイザリーロックにより片方が何もせず終了（skipped）し、もう片方が正常に完了する', async () => {
    const datasetA = Array.from({ length: 50 }, (_, i) => {
      const corpNum = String(3000000000001 + i);
      return `${i + 1},"${corpNum}","01","1","2026-10-01","2026-10-01","同時実行テストA_${i + 1}株式会社","","301","東京都","千代田区","霞が関一丁目","","13","101","1000001","","","","","","","","1","","","","","","0"`;
    });

    const datasetB = Array.from({ length: 50 }, (_, i) => {
      const corpNum = String(4000000000001 + i);
      return `${i + 1},"${corpNum}","01","1","2026-10-02","2026-10-02","同時実行テストB_${i + 1}株式会社","","301","東京都","港区","六本木一丁目","","13","103","1060001","","","","","","","","1","","","","","","0"`;
    });

    const outputLogs: string[] = [];
    const mockStream = {
      write: (chunk: string) => {
        outputLogs.push(chunk);
        return true;
      },
    };
    const { createIngestLogger } = await import('../../src/ingest/logger.js');
    const customImporter = new DatasetImporter(db, {
      logger: createIngestLogger(mockStream as unknown as NodeJS.WritableStream),
    });

    // 2つの取り込みを同時に起動（バッチサイズを小さくして実行時間を重ねる）
    const [res1, res2] = await Promise.all([
      customImporter.importCorporateDataset(datasetA, '2026-10-01', 5),
      customImporter.importCorporateDataset(datasetB, '2026-10-02', 5),
    ]);

    const statuses = [res1.status, res2.status].sort();
    // 片方が active（正常完了）、もう片方が skipped（何もせず終了）であること
    expect(statuses).toEqual(['active', 'skipped']);

    const activeResult = res1.status === 'active' ? res1 : res2;
    const skippedResult = res1.status === 'skipped' ? res1 : res2;

    expect(activeResult.count).toBe(50);
    expect(activeResult.datasetVersionId).toBeGreaterThan(0);
    expect(skippedResult.count).toBe(0);
    expect(skippedResult.datasetVersionId).toBe(0);

    // スキップされた旨がログに残っていること
    const parsedLogs = outputLogs.map((l) => JSON.parse(l) as Record<string, unknown>);
    const skippedLog = parsedLogs.find((l) => l.status === 'skipped');
    expect(skippedLog).toBeDefined();
    expect(skippedLog?.msg).toContain('skipped because another import is already running');

    // dataset_versions には active になった1件のみが作られ、不要な staging/failed レコードが作られていないこと
    const versions = await db.select().from(datasetVersions);
    expect(versions.length).toBe(1);
    expect(versions[0]?.status).toBe('active');
    expect(versions[0]?.recordCount).toBe(50);

    // 完了した側のデータが正常に検索でき、ロックも解放されて次の取り込みが可能であること
    const targetCorpNum =
      activeResult.dataAsOf === '2026-10-01' ? '3000000000001' : '4000000000001';
    const lookup = await dataProvider.lookupByNumber(targetCorpNum);
    expect(lookup.ok).toBe(true);
  });

  it('インボイス取り込み（公式24列）: 法人・人格のない社団等・個人・区分不明・履歴複数行を RENAME Swap で取り込み、途中失敗時の旧版保全と同時実行のロック排他が機能する', async () => {
    // 1. 初回取り込み（v1: 法人履歴2行 + 人格のない社団等 + 個人 + 区分不明）
    const invoiceV1 = [
      // 同一登録番号 T1000000000001 の過去履歴（latest=0）と最新履歴（latest=1）
      '1,"T1000000000001","01","0","2","1","0","2023-10-01","2023-10-01","","","東京都千代田区旧１−１","13","101","","","","テストカブシキガイシャ","テスト株式会社（旧）","","","","",""',
      '2,"T1000000000001","03","0","2","1","1","2023-10-01","2025-04-01","2025-03-31","2025-04-01","東京都千代田区新２−２","13","101","","","","テストカブシキガイシャ","テスト株式会社（新）","","","","",""',
      // 人格のない社団等（kind=2, 公表申出所在地）
      '3,"T7000000000002","01","0","2","1","1","2023-10-01","2026-04-01","","","","","","大阪府大阪市北区１−１","27","127","テストキョウドウクミアイ","テスト協同組合","","","","",""',
      // 個人（kind=1, 氏名・所在地・屋号・通称が万一入っていても破棄される）
      '4,"T9999999999999","01","0","1","1","1","2023-10-01","2026-04-01","","","東京都港区１−１","13","103","","","","ヤマダタロウ","山田太郎","","","","山田商店","旧姓山田"',
      // 区分不明（kind=9, 名称・所在地等は破棄され unknownKindCount に計上される）
      '5,"T8888888888888","01","0","9","1","1","2023-10-01","2026-04-01","","","東京都新宿区１−１","13","104","","","","フメイ","不明事業者","","","","不明屋号","不明通称"',
    ];

    const v1Metrics = await importer.importInvoiceDataset(invoiceV1, '2026-09-01', 10);
    expect(v1Metrics.status).toBe('active');
    expect(v1Metrics.count).toBe(5);
    expect(v1Metrics.unknownKindCount).toBe(1);
    const v1Id = v1Metrics.datasetVersionId;

    // DB に5行すべて保存されていること（同じ登録番号 T1000000000001 の2行が両方存在し、日付が保持されていること）
    const rowsV1 = await db
      .select()
      .from(invoiceIssuers)
      .where(eq(invoiceIssuers.datasetVersionId, v1Id));
    expect(rowsV1.length).toBe(5);

    const corpHistory = rowsV1.filter((r) => r.registrationNumber === 'T1000000000001');
    expect(corpHistory.length).toBe(2);
    const oldHistoryRow = corpHistory.find((r) => r.latest === '0');
    const latestHistoryRow = corpHistory.find((r) => r.latest === '1');
    expect(oldHistoryRow?.sequenceNumber).toBe('1');
    expect(oldHistoryRow?.legalName).toBe('テスト株式会社（旧）');
    expect(oldHistoryRow?.registrationDate).toBe('2023-10-01');
    expect(latestHistoryRow?.sequenceNumber).toBe('2');
    expect(latestHistoryRow?.legalName).toBe('テスト株式会社（新）');
    expect(latestHistoryRow?.cancelDate).toBe('2025-03-31');
    expect(latestHistoryRow?.expireDate).toBe('2025-04-01');

    // 人格のない社団等の公表申出所在地が保持されていること
    const assocRow = rowsV1.find((r) => r.registrationNumber === 'T7000000000002');
    expect(assocRow?.declaredAddress).toBe('大阪府大阪市北区１−１');
    expect(assocRow?.legalName).toBe('テスト協同組合');

    // 個人（kind='1'）および区分不明（kind='9'）の名称・所在地・カナが NULL であること
    const individualRow = rowsV1.find((r) => r.registrationNumber === 'T9999999999999');
    expect(individualRow?.legalName).toBeNull();
    expect(individualRow?.kana).toBeNull();
    expect(individualRow?.headOfficeAddress).toBeNull();

    const unknownRow = rowsV1.find((r) => r.registrationNumber === 'T8888888888888');
    expect(unknownRow?.legalName).toBeNull();
    expect(unknownRow?.kana).toBeNull();
    expect(unknownRow?.headOfficeAddress).toBeNull();

    // 2. 2回目の取り込み途中で列の並びが違う不正行により失敗 → 旧版（v1）が active のまま保全されること
    const brokenInvoiceV2 = [
      '1,"T1000000000001","01","0","2","1","1","2023-10-01","2026-10-01","","","東京都千代田区新３−３","13","101","","","","テストカブシキガイシャ","テスト株式会社","","","","",""',
      '2,"T1000000000001","01","0","2026-10-01","01","テスト株式会社"', // 列数・並び不正
    ];
    await expect(
      importer.importInvoiceDataset(brokenInvoiceV2, '2026-10-01', 10),
    ).rejects.toThrow();

    const [v1AfterFail] = await db
      .select()
      .from(datasetVersions)
      .where(eq(datasetVersions.id, v1Id));
    expect(v1AfterFail?.status).toBe('active');
    const rowsAfterFail = await db.select().from(invoiceIssuers);
    expect(rowsAfterFail.length).toBe(5);

    // 3. 同時実行の排他制御（アドバイザリーロックにより片方が active、もう片方が skipped になること）
    const concurrentDatasetA = Array.from({ length: 30 }, (_, i) => {
      const regNum = `T${String(5000000000001 + i)}`;
      return `${i + 1},"${regNum}","01","0","2","1","1","2023-10-01","2026-10-01","","","東京都千代田区１−１","13","101","","","","テスト","同時インボイスA_${i + 1}","","","","",""`;
    });
    const concurrentDatasetB = Array.from({ length: 30 }, (_, i) => {
      const regNum = `T${String(6000000000001 + i)}`;
      return `${i + 1},"${regNum}","01","0","2","1","1","2023-10-01","2026-10-02","","","東京都港区１−１","13","103","","","","テスト","同時インボイスB_${i + 1}","","","","",""`;
    });

    const [invRes1, invRes2] = await Promise.all([
      importer.importInvoiceDataset(concurrentDatasetA, '2026-10-01', 5),
      importer.importInvoiceDataset(concurrentDatasetB, '2026-10-02', 5),
    ]);

    const invStatuses = [invRes1.status, invRes2.status].sort();
    expect(invStatuses).toEqual(['active', 'skipped']);

    // 索引名が正規名に復元されていることを検証
    const invIndexCheck = await db.execute(
      sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'invoice_issuers';`,
    );
    const invIndexNames = (invIndexCheck.rows as Array<{ indexname: string }>).map(
      (r) => r.indexname,
    );
    expect(invIndexNames).toContain('idx_invoice_issuers_reg_number');
    expect(invIndexNames).toContain('idx_invoice_issuers_reg_latest');
    expect(invIndexNames).toContain('idx_invoice_issuers_version');
    expect(invIndexNames.some((n) => n.endsWith('_new') || n.endsWith('_old'))).toBe(false);
  });
});
