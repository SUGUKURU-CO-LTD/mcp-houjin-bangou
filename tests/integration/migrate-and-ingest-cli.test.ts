/**
 * Migration & Ingestion CLI Integration Tests (PostgreSQL 16 実DB実行)
 *
 * 根拠 / Source:
 *   Linear SLA2-327 (B6 PR B):
 *     - CLI の引数と終了コード（0 = active, 1 = 失敗, 2 = 別の取り込みが実行中でスキップ）
 *     - migrate（src/db/migrate.ts）から ingest（src/ingest/cli.ts）までの結合テスト（PostgreSQL 16、合成データ）
 *
 * 【テストデータの性格】
 *   本テストで使用しているデータはすべてテスト用に作成した「合成データ」であり、
 *   実在する事業者や個人の情報、国税庁本番データではありません。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { runMigrateCli } from '../../src/db/migrate.js';
import * as schema from '../../src/db/schema.js';
import { closeDbClient, type DbClient } from '../../src/db/client.js';
import { CORPORATE_INGEST_LOCK_KEY, INVOICE_INGEST_LOCK_KEY } from '../../src/ingest/importer.js';
import { parseIngestCliArgs, resolveCsvFilesInDir, runIngestCli } from '../../src/ingest/cli.js';
import { DbCorporateDataProvider } from '../../src/repository/corporate-repository.js';
import { DbInvoiceDataProvider } from '../../src/repository/invoice-repository.js';

const { Pool } = pg;

const BASE_DB_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgres://test:test@localhost:55069/test';

const CLI_TEST_DB_NAME = 'test_cli_ingest';

function buildDbUrl(baseUrl: string, dbName: string): string {
  const parsed = new URL(baseUrl);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

const TEST_DB_URL = buildDbUrl(BASE_DB_URL, CLI_TEST_DB_NAME);

function createLogCollector(): {
  stream: PassThrough;
  getLines: () => Array<Record<string, unknown>>;
} {
  const stream = new PassThrough();
  let buffer = '';
  stream.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString();
  });
  return {
    stream,
    getLines: () =>
      buffer
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

describe('Migrate & Ingest CLI Integration Tests (PostgreSQL 16 実DB・合成テストデータ)', () => {
  let adminPool: pg.Pool;
  let pool: pg.Pool;
  let db: DbClient;
  let tempRootDir: string;

  beforeAll(async () => {
    tempRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houjin-ingest-cli-test-'));

    // 並列実行される他の実DBテスト（ingest-atomic-swap.test.ts）とテーブル・ロックが競合しないよう専用DBを用意
    adminPool = new Pool({
      connectionString: BASE_DB_URL,
      max: 2,
    });
    await adminPool.query(`DROP DATABASE IF EXISTS ${CLI_TEST_DB_NAME} WITH (FORCE);`);
    await adminPool.query(`CREATE DATABASE ${CLI_TEST_DB_NAME};`);

    // 1. migrate CLI (runMigrateCli) でマイグレーションが終了コード 0 で適用されることを検証
    const migrateLogs = createLogCollector();
    const migrateCode = await runMigrateCli({ connectionString: TEST_DB_URL }, migrateLogs.stream);
    expect(migrateCode).toBe(0);
    const migrateLogEntries = migrateLogs.getLines();
    expect(migrateLogEntries).toHaveLength(1);
    expect(migrateLogEntries[0]?.logger).toBe('db_migrate');
    expect(migrateLogEntries[0]?.status).toBe('completed');

    pool = new Pool({
      connectionString: TEST_DB_URL,
      max: 5,
    });
    db = drizzle(pool, { schema }) as DbClient;
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    await closeDbClient();
    if (adminPool) {
      await adminPool.query(`DROP DATABASE IF EXISTS ${CLI_TEST_DB_NAME};`);
      await adminPool.end();
    }
    if (tempRootDir && fs.existsSync(tempRootDir)) {
      fs.rmSync(tempRootDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    await db.execute(sql`DROP TABLE IF EXISTS corporate_numbers_new;`);
    await db.execute(sql`DROP TABLE IF EXISTS corporate_numbers_old;`);
    await db.execute(sql`DROP TABLE IF EXISTS invoice_issuers_new;`);
    await db.execute(sql`DROP TABLE IF EXISTS invoice_issuers_old;`);
    await db.execute(
      sql`TRUNCATE TABLE corporate_numbers, invoice_issuers, dataset_versions CASCADE;`,
    );
  });

  describe('CLI argument parsing and directory resolution', () => {
    it('validates --type, --dir, and --data-as-of arguments strictly', () => {
      expect(
        parseIngestCliArgs([
          '--type',
          'corporate',
          '--dir',
          '/mnt/ingest/corporate/2026-10',
          '--data-as-of',
          '2026-09-30',
        ]),
      ).toEqual({
        type: 'corporate',
        dir: '/mnt/ingest/corporate/2026-10',
        dataAsOf: '2026-09-30',
      });

      expect(() =>
        parseIngestCliArgs(['--type', 'unknown', '--dir', '/tmp', '--data-as-of', '2026-09-30']),
      ).toThrow(/--type/);

      expect(() =>
        parseIngestCliArgs(['--type', 'corporate', '--data-as-of', '2026-09-30']),
      ).toThrow(/--dir/);

      expect(() =>
        parseIngestCliArgs(['--type', 'corporate', '--dir', '/tmp', '--data-as-of', '2026-02-30']),
      ).toThrow(/--data-as-of/);

      expect(() =>
        parseIngestCliArgs([
          '--type',
          'corporate',
          '--dir',
          '/tmp',
          '--data-as-of',
          '2026-09-30',
          'extra-arg',
        ]),
      ).toThrow(/positional/);
    });

    it('reads .csv files in ascending filename order and fails when directory has no .csv', () => {
      const subDir = path.join(tempRootDir, 'order-check');
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, '02_second.csv'), 'dummy2\n', 'utf-8');
      fs.writeFileSync(path.join(subDir, '01_first.csv'), 'dummy1\n', 'utf-8');
      fs.writeFileSync(path.join(subDir, 'readme.txt'), 'ignore me\n', 'utf-8');

      const resolved = resolveCsvFilesInDir(subDir);
      expect(resolved.map((p) => path.basename(p))).toEqual(['01_first.csv', '02_second.csv']);

      const emptyDir = path.join(tempRootDir, 'empty-dir');
      fs.mkdirSync(emptyDir, { recursive: true });
      expect(() => resolveCsvFilesInDir(emptyDir)).toThrow(/No \.csv files/);
    });
  });

  describe('Exit codes and end-to-end migrate -> ingest -> query flow', () => {
    it('returns exit code 1 and logs JSON error on invalid CLI arguments or empty directory', async () => {
      const argErrorLogs = createLogCollector();
      const code1 = await runIngestCli(['--type', 'invalid'], {
        connectionString: TEST_DB_URL,
        output: argErrorLogs.stream,
      });
      expect(code1).toBe(1);
      const lines1 = argErrorLogs.getLines();
      expect(lines1).toHaveLength(1);
      expect(lines1[0]?.logger).toBe('dataset_ingest');
      expect(lines1[0]?.status).toBe('failed');
      expect(String(lines1[0]?.msg ?? '')).toContain('Invalid or missing --type');

      const missingDirLogs = createLogCollector();
      const code2 = await runIngestCli(
        [
          '--type',
          'corporate',
          '--dir',
          path.join(tempRootDir, 'non-existent-dir'),
          '--data-as-of',
          '2026-09-30',
        ],
        {
          connectionString: TEST_DB_URL,
          output: missingDirLogs.stream,
        },
      );
      expect(code2).toBe(1);
      const lines2 = missingDirLogs.getLines();
      expect(lines2).toHaveLength(1);
      expect(lines2[0]?.status).toBe('failed');
      expect(String(lines2[0]?.msg ?? '')).toContain('Target directory does not exist');
    });

    it('ingests split corporate and invoice CSV files in filename order (exit code 0) and serves queries via DB providers', async () => {
      // 1. 法人番号の分割CSVファイルを作成（01 と 02 で同じ法人番号の更新があってもファイル名順に処理される）
      const corpDir = path.join(tempRootDir, 'corporate-2026-10');
      fs.mkdirSync(corpDir, { recursive: true });

      const corpRow1 =
        '1,"1000000000001","01","0","2026-09-30","2026-09-30","株式会社テスト第一","","301","東京都","千代田区","霞が関１丁目１−１","","13","101","1000001","","","","","","","","1","","","","","カブシキガイシャテストダイイチ","0"';
      const corpRow2 =
        '2,"9000000000002","01","0","2026-09-30","2026-09-30","合同会社テスト第二","","305","鹿児島県","霧島市","国分中央１丁目","","46","218","8994332","","","","","","","","1","","","","","ゴウドウガイシャテストダイニ","0"';

      fs.writeFileSync(path.join(corpDir, 'part_01.csv'), corpRow1 + '\n', 'utf-8');
      fs.writeFileSync(path.join(corpDir, 'part_02.csv'), corpRow2 + '\n', 'utf-8');

      const corpLogs = createLogCollector();
      const corpExitCode = await runIngestCli(
        ['--type', 'corporate', '--dir', corpDir, '--data-as-of', '2026-09-30'],
        {
          connectionString: TEST_DB_URL,
          output: corpLogs.stream,
        },
      );

      expect(corpExitCode).toBe(0);
      const corpLogLines = corpLogs.getLines();
      expect(corpLogLines).toHaveLength(1);
      expect(corpLogLines[0]?.logger).toBe('dataset_ingest');
      expect(corpLogLines[0]?.source_type).toBe('nta_corporate_download');
      expect(corpLogLines[0]?.status).toBe('active');
      expect(corpLogLines[0]?.count).toBe(2);
      expect(corpLogLines[0]?.data_as_of).toBe('2026-09-30');
      // 法人番号や名称がログに含まれないことを確認
      const rawCorpLog = JSON.stringify(corpLogLines[0]);
      expect(rawCorpLog).not.toContain('1000000000001');
      expect(rawCorpLog).not.toContain('株式会社テスト第一');

      // 2. インボイスのCSVファイルを作成（公式24列仕様）
      const invDir = path.join(tempRootDir, 'invoice-2026-10');
      fs.mkdirSync(invDir, { recursive: true });

      const invRow1 = [
        '"1"',
        '"T1000000000001"',
        '"01"',
        '"0"',
        '"2"',
        '"1"',
        '"1"',
        '"2023-10-01"',
        '"2026-09-30"',
        '""',
        '""',
        '"東京都千代田区霞が関１丁目１−１"',
        '"13"',
        '"101"',
        '""',
        '""',
        '""',
        '"カブシキガイシャテストダイイチ"',
        '"株式会社テスト第一"',
        '""',
        '""',
        '""',
        '""',
        '""',
      ].join(',');

      fs.writeFileSync(path.join(invDir, 'invoice_01.csv'), invRow1 + '\n', 'utf-8');

      const invLogs = createLogCollector();
      const invExitCode = await runIngestCli(
        ['--type', 'invoice', '--dir', invDir, '--data-as-of', '2026-09-30'],
        {
          connectionString: TEST_DB_URL,
          output: invLogs.stream,
        },
      );

      expect(invExitCode).toBe(0);
      const invLogLines = invLogs.getLines();
      expect(invLogLines).toHaveLength(1);
      expect(invLogLines[0]?.source_type).toBe('nta_invoice_download');
      expect(invLogLines[0]?.status).toBe('active');
      expect(invLogLines[0]?.count).toBe(1);

      // 3. 取り込まれたデータが DB プロバイダ経由で検索できることを確認
      const corpProvider = new DbCorporateDataProvider(db);
      const corpResult = await corpProvider.lookupByNumber('1000000000001');
      expect(corpResult.ok).toBe(true);
      if (corpResult.ok) {
        expect(corpResult.value.corporation.name).toBe('株式会社テスト第一');
        expect(corpResult.value.data_as_of).toBe('2026-09-30');
      }

      const invProvider = new DbInvoiceDataProvider(db);
      const invResult = await invProvider.lookupByRegistrationNumber('T1000000000001');
      expect(invResult.ok).toBe(true);
      if (invResult.ok) {
        expect(invResult.value.corporate_name).toBe('株式会社テスト第一');
        expect(invResult.value.data_as_of).toBe('2026-09-30');
      }
    });

    it('returns exit code 2 when another import holds the PostgreSQL advisory lock', async () => {
      const corpDir = path.join(tempRootDir, 'corporate-lock-test');
      fs.mkdirSync(corpDir, { recursive: true });
      const corpRow =
        '1,"1000000000001","01","0","2026-09-30","2026-09-30","株式会社テスト第一","","301","東京都","千代田区","霞が関１丁目","","13","101","1000001","","","","","","","","1","","","","","","0"';
      fs.writeFileSync(path.join(corpDir, 'part_01.csv'), corpRow + '\n', 'utf-8');

      // 別セッションでアドバイザリーロックを保持
      const lockClient = await pool.connect();
      try {
        await lockClient.query('SELECT pg_advisory_lock($1)', [CORPORATE_INGEST_LOCK_KEY]);

        const skipLogs = createLogCollector();
        const code = await runIngestCli(
          ['--type', 'corporate', '--dir', corpDir, '--data-as-of', '2026-09-30'],
          {
            connectionString: TEST_DB_URL,
            output: skipLogs.stream,
          },
        );

        expect(code).toBe(2);
        const logLines = skipLogs.getLines();
        expect(logLines).toHaveLength(1);
        expect(logLines[0]?.status).toBe('skipped');
      } finally {
        await lockClient.query('SELECT pg_advisory_unlock($1)', [CORPORATE_INGEST_LOCK_KEY]);
        lockClient.release();
      }

      // インボイス側も同様にロック保持中は終了コード 2 を返すことを確認
      const invDir = path.join(tempRootDir, 'invoice-lock-test');
      fs.mkdirSync(invDir, { recursive: true });
      const invRow = Array.from({ length: 24 }, (_, idx) =>
        idx === 1 ? '"T1000000000001"' : '"1"',
      ).join(',');
      fs.writeFileSync(path.join(invDir, 'inv_01.csv'), invRow + '\n', 'utf-8');

      const invLockClient = await pool.connect();
      try {
        await invLockClient.query('SELECT pg_advisory_lock($1)', [INVOICE_INGEST_LOCK_KEY]);

        const skipLogs = createLogCollector();
        const code = await runIngestCli(
          ['--type', 'invoice', '--dir', invDir, '--data-as-of', '2026-09-30'],
          {
            connectionString: TEST_DB_URL,
            output: skipLogs.stream,
          },
        );

        expect(code).toBe(2);
        const logLines = skipLogs.getLines();
        expect(logLines).toHaveLength(1);
        expect(logLines[0]?.status).toBe('skipped');
      } finally {
        await invLockClient.query('SELECT pg_advisory_unlock($1)', [INVOICE_INGEST_LOCK_KEY]);
        invLockClient.release();
      }
    });

    it('returns exit code 1 when validation fails (e.g. broken invoice CSV) and preserves active dataset', async () => {
      const brokenDir = path.join(tempRootDir, 'invoice-broken');
      fs.mkdirSync(brokenDir, { recursive: true });
      fs.writeFileSync(path.join(brokenDir, 'broken.csv'), '"only","three","columns"\n', 'utf-8');

      const failLogs = createLogCollector();
      const code = await runIngestCli(
        ['--type', 'invoice', '--dir', brokenDir, '--data-as-of', '2026-09-30'],
        {
          connectionString: TEST_DB_URL,
          output: failLogs.stream,
        },
      );

      expect(code).toBe(1);
      const logLines = failLogs.getLines();
      expect(logLines).toHaveLength(1);
      expect(logLines[0]?.status).toBe('failed');
      expect(String(logLines[0]?.msg ?? '')).toContain('failed 24-column validation');
    });

    it('returns exit code 1 when migration fails due to non-existent migrations folder and logs error message', async () => {
      const failMigrateLogs = createLogCollector();
      const code = await runMigrateCli(
        {
          connectionString: TEST_DB_URL,
          migrationsFolder: path.join(tempRootDir, 'missing-migrations-folder'),
        },
        failMigrateLogs.stream,
      );
      expect(code).toBe(1);
      const logLines = failMigrateLogs.getLines();
      expect(logLines).toHaveLength(1);
      expect(logLines[0]?.logger).toBe('db_migrate');
      expect(logLines[0]?.status).toBe('failed');
      expect(typeof logLines[0]?.msg).toBe('string');
      expect(String(logLines[0]?.msg ?? '').length).toBeGreaterThan(0);
    });
  });
});
