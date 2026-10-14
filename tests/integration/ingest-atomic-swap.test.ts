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
import { datasetVersions, corporateNumbers } from '../../src/db/schema.js';
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

    // マイグレーション適用（0000, 0001, 0002）
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
    await db.execute(sql`TRUNCATE TABLE corporate_numbers, dataset_versions CASCADE;`);
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
});
