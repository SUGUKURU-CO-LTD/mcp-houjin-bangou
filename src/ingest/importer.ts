/**
 * Dataset Importer (Atomic Staging -> Active Swap)
 *
 * 根拠 / Source:
 *   実装指示書v1 §5(B4):
 *     - 新しいデータは別の場所に取り込み、全件そろってから切り替える。途中で失敗した場合は、前のデータと前の data_as_of のまま動き続ける
 *     - 取り込み処理のログに、法人番号・登録番号・名称を出さない（件数・所要時間・エラー種別のみ）
 *   Linear SLA2-324 / SLA2-333 / SLA2-325:
 *     - CSV全体を一度にメモリへ読み込まず、行単位でストリーミング処理する
 *     - 1ファイル300MB超の分割ファイルに対応（複数ファイルを1つの版として取り込む）
 *     - 本番反映時にステージング全行をNodeへ読み込まず、別表（corporate_numbers_new / invoice_issuers_new）で索引構築後に RENAME で入れ替える
 *     - 項番30「検索対象除外（hihyoji）」を取り込む
 *     - インボイスCSVは公式24列仕様で取り込み、履歴行を保持し、区分不明行の件数をログに出す
 *     - PostgreSQL のアドバイザリーロックで同時実行を1つに限る
 */

import * as fs from 'node:fs';
import * as readline from 'node:readline';
import type pg from 'pg';
import { eq, and, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { pgTable, varchar, integer } from 'drizzle-orm/pg-core';
import type { DbClient } from '../db/client.js';
import * as schema from '../db/schema.js';
import { datasetVersions } from '../db/schema.js';
import { isInvoiceKindCode } from '../domain/invoice-codes.js';
import { parseCorporateCsvLine, parseInvoiceCsvLine } from './parser.js';
import { createIngestLogger, type IngestLogger } from './logger.js';
import type { ImportMetrics } from './types.js';

/**
 * 法人番号データの取り込み排他制御用アドバイザリーロックキー
 */
export const CORPORATE_INGEST_LOCK_KEY = 324001;

/**
 * インボイスデータの取り込み排他制御用アドバイザリーロックキー
 */
export const INVOICE_INGEST_LOCK_KEY = 325001;

/**
 * 取り込み作業用の新テーブル定義（corporate_numbers_new）
 * Drizzle クエリビルダーの型安全性とバッチ挿入を活用するために定義。
 * 実テーブルは LIKE corporate_numbers INCLUDING DEFAULTS により動的生成される。
 */
export const corporateNumbersNew = pgTable('corporate_numbers_new', {
  corporateNumber: varchar('corporate_number', { length: 13 }).notNull(),
  process: varchar('process', { length: 2 }),
  correct: varchar('correct', { length: 1 }),
  updateDate: varchar('update_date', { length: 10 }).notNull(),
  changeDate: varchar('change_date', { length: 10 }),
  name: varchar('name', { length: 300 }).notNull(),
  nameImageId: varchar('name_image_id', { length: 8 }),
  kind: varchar('kind', { length: 3 }).notNull(),
  prefectureName: varchar('prefecture_name', { length: 10 }),
  cityName: varchar('city_name', { length: 20 }),
  streetNumber: varchar('street_number', { length: 300 }),
  addressImageId: varchar('address_image_id', { length: 8 }),
  prefectureCode: varchar('prefecture_code', { length: 2 }),
  cityCode: varchar('city_code', { length: 3 }),
  postCode: varchar('post_code', { length: 7 }),
  addressOutside: varchar('address_outside', { length: 300 }),
  addressOutsideImageId: varchar('address_outside_image_id', { length: 8 }),
  closeDate: varchar('close_date', { length: 10 }),
  closeCause: varchar('close_cause', { length: 2 }),
  successorCorporateNumber: varchar('successor_corporate_number', { length: 13 }),
  changeCause: varchar('change_cause', { length: 500 }),
  assignmentDate: varchar('assignment_date', { length: 10 }),
  latest: varchar('latest', { length: 1 }).notNull().default('1'),
  enName: varchar('en_name', { length: 300 }),
  enPrefectureName: varchar('en_prefecture_name', { length: 50 }),
  enCityName: varchar('en_city_name', { length: 50 }),
  enAddressOutside: varchar('en_address_outside', { length: 300 }),
  furigana: varchar('furigana', { length: 500 }),
  hihyoji: varchar('hihyoji', { length: 1 }).notNull().default('0'),
  datasetVersionId: integer('dataset_version_id').notNull(),
});

/**
 * 取り込み作業用の新テーブル定義（invoice_issuers_new）
 * Drizzle クエリビルダーの型安全性とバッチ挿入を活用するために定義。
 * 実テーブルは LIKE invoice_issuers INCLUDING DEFAULTS により動的生成される。
 */
export const invoiceIssuersNew = pgTable('invoice_issuers_new', {
  sequenceNumber: varchar('sequence_number', { length: 8 }).notNull(),
  registrationNumber: varchar('registration_number', { length: 14 }).notNull(),
  process: varchar('process', { length: 2 }).notNull(),
  correct: varchar('correct', { length: 1 }).notNull(),
  kind: varchar('kind', { length: 2 }).notNull(),
  country: varchar('country', { length: 1 }),
  latest: varchar('latest', { length: 1 }).notNull(),
  registrationDate: varchar('registration_date', { length: 10 }),
  updateDate: varchar('update_date', { length: 10 }).notNull(),
  cancelDate: varchar('cancel_date', { length: 10 }),
  expireDate: varchar('expire_date', { length: 10 }),
  headOfficeAddress: varchar('head_office_address', { length: 600 }),
  headOfficePrefectureCode: varchar('head_office_prefecture_code', { length: 2 }),
  headOfficeCityCode: varchar('head_office_city_code', { length: 3 }),
  declaredAddress: varchar('declared_address', { length: 600 }),
  declaredPrefectureCode: varchar('declared_prefecture_code', { length: 2 }),
  declaredCityCode: varchar('declared_city_code', { length: 3 }),
  kana: varchar('kana', { length: 500 }),
  legalName: varchar('legal_name', { length: 300 }),
  domesticOfficeAddress: varchar('domestic_office_address', { length: 300 }),
  domesticOfficePrefectureCode: varchar('domestic_office_prefecture_code', { length: 2 }),
  domesticOfficeCityCode: varchar('domestic_office_city_code', { length: 3 }),
  datasetVersionId: integer('dataset_version_id').notNull(),
});

export interface ImporterOptions {
  batchSize?: number;
  logger?: IngestLogger;
  /**
   * 新しい版の最小許容件数（既定: 環境変数 INGEST_MIN_RECORD_COUNT または 1）
   * 0件（空ファイル等）や最小件数未満での入れ替えを防止する。
   */
  minRecordCount?: number;
  /**
   * 稼働中の版（status='active'）の件数に対する最小許容比率（0〜1、既定: 環境変数 INGEST_MIN_RECORD_COUNT_RATIO または 0.9）
   * 分割ファイルの欠落等で稼働中の版より大きく件数が減った場合に入れ替えを中止する。
   */
  minRecordCountRatio?: number;
  /**
   * 法人番号CSVにおいて解析できない行の最大許容比率（0〜1、既定: 環境変数 INGEST_MAX_INVALID_ROW_RATIO または 0.01）
   * 国税庁のCSV形式変更等で解析不能行が一定割合を超えた場合に入れ替えを中止する。
   */
  maxInvalidRowRatio?: number;
}

/**
 * 取り込み検証の既定しきい値
 * - DEFAULT_MIN_RECORD_COUNT (1): 0件（空ファイル・空配列・全行スキップ）での入れ替えを防ぐ最小件数
 * - DEFAULT_MIN_RECORD_COUNT_RATIO (0.9): 稼働中の版の件数に対する最小許容比率（90%未満＝10%超の減少で中止）
 * - DEFAULT_MAX_INVALID_ROW_RATIO (0.01): 法人番号CSVの解析不能行の最大許容比率（1%超で中止）
 */
export const DEFAULT_MIN_RECORD_COUNT = 1;
export const DEFAULT_MIN_RECORD_COUNT_RATIO = 0.9;
export const DEFAULT_MAX_INVALID_ROW_RATIO = 0.01;

export class DatasetImporter {
  private logger: IngestLogger;
  private minRecordCount: number;
  private minRecordCountRatio: number;
  private maxInvalidRowRatio: number;

  constructor(
    private db: DbClient,
    options?: ImporterOptions,
  ) {
    this.logger = options?.logger ?? createIngestLogger();

    const envMinRecordCount = process.env.INGEST_MIN_RECORD_COUNT
      ? Number(process.env.INGEST_MIN_RECORD_COUNT)
      : undefined;
    const envMinRecordCountRatio = process.env.INGEST_MIN_RECORD_COUNT_RATIO
      ? Number(process.env.INGEST_MIN_RECORD_COUNT_RATIO)
      : undefined;
    const envMaxInvalidRowRatio = process.env.INGEST_MAX_INVALID_ROW_RATIO
      ? Number(process.env.INGEST_MAX_INVALID_ROW_RATIO)
      : undefined;

    this.minRecordCount =
      options?.minRecordCount ??
      (envMinRecordCount !== undefined && !Number.isNaN(envMinRecordCount)
        ? envMinRecordCount
        : DEFAULT_MIN_RECORD_COUNT);
    this.minRecordCountRatio =
      options?.minRecordCountRatio ??
      (envMinRecordCountRatio !== undefined && !Number.isNaN(envMinRecordCountRatio)
        ? envMinRecordCountRatio
        : DEFAULT_MIN_RECORD_COUNT_RATIO);
    this.maxInvalidRowRatio =
      options?.maxInvalidRowRatio ??
      (envMaxInvalidRowRatio !== undefined && !Number.isNaN(envMaxInvalidRowRatio)
        ? envMaxInvalidRowRatio
        : DEFAULT_MAX_INVALID_ROW_RATIO);
  }

  /**
   * 法人基本3情報ダウンロードファイルのストリーミング取り込み（全件規模・分割ファイル対応）
   * 300MB超の分割ファイルや全件規模（約573万件）をメモリ枯渇なく行単位でストリーミング処理する。
   *
   * @param filePaths CSVファイルパスの配列（1ファイルが300MB超で分割される公式仕様に対応）
   * @param dataAsOf データの基準日 (YYYY-MM-DD)
   * @param batchSize 一括INSERTのバッチサイズ (既定 1000)
   */
  async importCorporateFiles(
    filePaths: string[],
    dataAsOf: string,
    batchSize = 1000,
  ): Promise<ImportMetrics> {
    async function* iterateFiles(): AsyncIterable<string> {
      for (const fp of filePaths) {
        const stream = fs.createReadStream(fp, { encoding: 'utf-8' });
        const rl = readline.createInterface({
          input: stream,
          crlfDelay: Infinity,
        });
        try {
          for await (const line of rl) {
            if (line.trim().length > 0) {
              yield line;
            }
          }
        } finally {
          rl.close();
          stream.destroy();
        }
      }
    }

    return this.importCorporateInternal(iterateFiles(), dataAsOf, batchSize);
  }

  /**
   * 法人基本3情報ダウンロードデータの一括取り込み（文字列または配列）
   * 途中で失敗した場合は前の active なデータ・data_as_of を維持する。
   */
  async importCorporateDataset(
    csvContent: string | string[],
    dataAsOf: string,
    batchSize = 1000,
  ): Promise<ImportMetrics> {
    async function* iterateContent(): AsyncIterable<string> {
      if (Array.isArray(csvContent)) {
        for (const line of csvContent) {
          if (line.trim().length > 0) yield line;
        }
      } else {
        const lines = csvContent.split(/\r?\n/);
        for (const line of lines) {
          if (line.trim().length > 0) yield line;
        }
      }
    }

    return this.importCorporateInternal(iterateContent(), dataAsOf, batchSize);
  }

  /**
   * 行ストリームを受け取り、staging 投入から本番昇格までをアトミックに実行する内部共通メソッド（法人番号）
   */
  private async importCorporateInternal(
    lines: AsyncIterable<string>,
    dataAsOf: string,
    batchSize = 1000,
  ): Promise<ImportMetrics> {
    const startTime = Date.now();
    let versionId = 0;
    let count = 0;
    let invalidRowCount = 0;
    let lockClient: pg.PoolClient | undefined;
    let lockAcquired = false;
    let activeDb: DbClient = this.db;

    try {
      // 0. PostgreSQL のアドバイザリーロックで同時実行を1つに限る
      const underlyingPool = (this.db as unknown as { $client?: pg.Pool }).$client;
      if (underlyingPool && typeof underlyingPool.connect === 'function') {
        lockClient = await underlyingPool.connect();
        const lockRes = await lockClient.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_lock($1) AS acquired',
          [CORPORATE_INGEST_LOCK_KEY],
        );
        lockAcquired = lockRes.rows[0]?.acquired === true;
        if (lockAcquired) {
          activeDb = drizzle(lockClient, { schema }) as DbClient;
        }
      } else {
        // 単体テスト用モック DB 向けフォールバック（結果が true のときのみ取得成功とする）
        const lockRes = (await this.db.execute(
          sql`SELECT pg_try_advisory_lock(${CORPORATE_INGEST_LOCK_KEY}) AS acquired;`,
        )) as unknown as { rows?: Array<{ acquired?: boolean }> } | undefined;
        lockAcquired = lockRes?.rows?.[0]?.acquired === true;
      }

      if (!lockAcquired) {
        const skippedMetrics: ImportMetrics = {
          sourceType: 'nta_corporate_download',
          dataAsOf,
          datasetVersionId: 0,
          count: 0,
          durationMs: Date.now() - startTime,
          status: 'skipped',
        };
        this.logger.info(
          skippedMetrics,
          'Corporate dataset import skipped because another import is already running',
        );
        return skippedMetrics;
      }

      // 1. 新規バージョンレコードを staging 状態で作成
      const [version] = await activeDb
        .insert(datasetVersions)
        .values({
          sourceType: 'nta_corporate_download',
          dataAsOf,
          status: 'staging',
          recordCount: 0,
        })
        .returning({ id: datasetVersions.id });

      if (!version) {
        throw new Error('Failed to create dataset version record');
      }

      versionId = version.id;

      // 2. 新規一時テーブル corporate_numbers_new を初期化（残存一時テーブルがあれば事前クリーンアップ）
      await activeDb.execute(sql`DROP TABLE IF EXISTS corporate_numbers_new;`);
      await activeDb.execute(sql`DROP TABLE IF EXISTS corporate_numbers_old;`);
      await activeDb.execute(
        sql`CREATE TABLE corporate_numbers_new (LIKE corporate_numbers INCLUDING DEFAULTS);`,
      );

      // 3. corporate_numbers_new へストリーミングでバッチ挿入
      let batch: Array<typeof corporateNumbersNew.$inferInsert> = [];

      for await (const line of lines) {
        if (!line.trim()) continue;
        const parsed = parseCorporateCsvLine(line);
        if (!parsed) {
          invalidRowCount++;
          continue;
        }

        batch.push({
          corporateNumber: parsed.corporateNumber,
          process: parsed.process,
          correct: parsed.correct,
          updateDate: parsed.updateDate,
          changeDate: parsed.changeDate,
          name: parsed.name,
          nameImageId: parsed.nameImageId,
          kind: parsed.kind,
          prefectureName: parsed.prefectureName,
          cityName: parsed.cityName,
          streetNumber: parsed.streetNumber,
          addressImageId: parsed.addressImageId,
          prefectureCode: parsed.prefectureCode,
          cityCode: parsed.cityCode,
          postCode: parsed.postCode,
          addressOutside: parsed.addressOutside,
          addressOutsideImageId: parsed.addressOutsideImageId,
          closeDate: parsed.closeDate,
          closeCause: parsed.closeCause,
          successorCorporateNumber: parsed.successorCorporateNumber,
          changeCause: parsed.changeCause,
          assignmentDate: parsed.assignmentDate,
          latest: parsed.latest ?? '1',
          enName: parsed.enName,
          enPrefectureName: parsed.enPrefectureName,
          enCityName: parsed.enCityName,
          enAddressOutside: parsed.enAddressOutside,
          furigana: parsed.furigana,
          hihyoji: parsed.hihyoji ?? '0',
          datasetVersionId: versionId,
        });

        count++;

        if (batch.length >= batchSize) {
          await activeDb.insert(corporateNumbersNew).values(batch);
          batch = [];
        }
      }

      if (batch.length > 0) {
        await activeDb.insert(corporateNumbersNew).values(batch);
        batch = [];
      }

      // 3b. 件数・形式の安全確認（0件・大幅減少・形式変更時の入れ替え防止）
      const totalLines = count + invalidRowCount;
      if (totalLines > 0) {
        const invalidRatio = invalidRowCount / totalLines;
        if (invalidRatio > this.maxInvalidRowRatio) {
          throw new Error(
            `Corporate CSV invalid row ratio (${invalidRowCount}/${totalLines}) exceeds maxInvalidRowRatio (${this.maxInvalidRowRatio})`,
          );
        }
      }

      if (count <= 0 || count < this.minRecordCount) {
        throw new Error(
          `Corporate dataset record count (${count}) is below minRecordCount (${this.minRecordCount}); aborting swap to preserve active dataset`,
        );
      }

      const activeVersionRes = (await activeDb.execute(sql`
        SELECT record_count
        FROM dataset_versions
        WHERE source_type = 'nta_corporate_download' AND status = 'active'
        ORDER BY id DESC
        LIMIT 1;
      `)) as unknown as { rows?: Array<{ record_count?: number | string }> } | undefined;
      const activeRecordCount = Number(activeVersionRes?.rows?.[0]?.record_count ?? 0);
      if (activeRecordCount > 0 && count < activeRecordCount * this.minRecordCountRatio) {
        throw new Error(
          `Corporate dataset record count (${count}) dropped below minRecordCountRatio (${this.minRecordCountRatio}) of active dataset (${activeRecordCount}); aborting swap to preserve active dataset`,
        );
      }

      // 4. データ投入完了後、corporate_numbers_new に制約および全索引を作成（一時名）
      // ※ pg_trgm 拡張の作成はマイグレーション 0001 で実行済み
      await activeDb.execute(sql`
        ALTER TABLE corporate_numbers_new
          ADD CONSTRAINT corporate_numbers_new_pk PRIMARY KEY (corporate_number, dataset_version_id);
      `);
      await activeDb.execute(sql`
        ALTER TABLE corporate_numbers_new
          ADD CONSTRAINT corporate_numbers_new_dataset_versions_fk
          FOREIGN KEY (dataset_version_id) REFERENCES dataset_versions(id) ON DELETE CASCADE;
      `);

      await activeDb.execute(sql`
        CREATE INDEX idx_corporate_numbers_number_new ON corporate_numbers_new (corporate_number);
        CREATE INDEX idx_corporate_numbers_name_new ON corporate_numbers_new (name);
        CREATE INDEX idx_corporate_numbers_name_trgm_new ON corporate_numbers_new USING gin (name gin_trgm_ops);
        CREATE INDEX idx_corporate_numbers_prefecture_new ON corporate_numbers_new (prefecture_code);
        CREATE INDEX idx_corporate_numbers_version_new ON corporate_numbers_new (dataset_version_id);
      `);

      // 5. 単一トランザクション内で表名・索引名・制約名をアトミックに入れ替え、版を active に昇格
      await this.executeAtomicSwap(versionId, count, activeDb);

      // 6. コミット後、旧表を CASCADE なしで削除し、ANALYZE を実行
      await activeDb.execute(sql`DROP TABLE IF EXISTS corporate_numbers_old;`);
      await activeDb.execute(sql`ANALYZE corporate_numbers;`);

      const metrics: ImportMetrics = {
        sourceType: 'nta_corporate_download',
        dataAsOf,
        datasetVersionId: versionId,
        count,
        durationMs: Date.now() - startTime,
        status: 'active',
        invalidRowCount,
      };

      this.logger.info(
        metrics,
        'Corporate dataset import completed successfully via atomic RENAME swap',
      );
      return metrics;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorType = err instanceof Error ? err.name : 'UnknownError';

      // 失敗時クリーンアップ: corporate_numbers_new を DROP
      try {
        await activeDb.execute(sql`DROP TABLE IF EXISTS corporate_numbers_new;`);
      } catch {
        // ignore
      }

      // 失敗した staging レコードをマーク
      if (versionId > 0) {
        try {
          await activeDb
            .update(datasetVersions)
            .set({ status: 'failed' })
            .where(eq(datasetVersions.id, versionId));
        } catch {
          // cleanup failure ignored
        }
      }

      this.logger.error(
        {
          sourceType: 'nta_corporate_download',
          dataAsOf,
          datasetVersionId: versionId,
          count,
          durationMs,
          invalidRowCount,
          errorType,
        },
        'Corporate dataset import failed; prior active dataset preserved',
      );

      throw err;
    } finally {
      if (lockAcquired) {
        try {
          if (lockClient) {
            await lockClient.query('SELECT pg_advisory_unlock($1)', [CORPORATE_INGEST_LOCK_KEY]);
          } else {
            await this.db.execute(sql`SELECT pg_advisory_unlock(${CORPORATE_INGEST_LOCK_KEY});`);
          }
        } catch {
          // ignore unlock errors on cleanup
        }
      }
      if (lockClient) {
        lockClient.release();
      }
    }
  }

  /**
   * インボイス公表ダウンロードファイルのストリーミング取り込み（全件規模・分割ファイル対応）
   *
   * @param filePaths CSVファイルパスの配列
   * @param dataAsOf データの基準日 (YYYY-MM-DD)
   * @param batchSize 一括INSERTのバッチサイズ (既定 1000)
   */
  async importInvoiceFiles(
    filePaths: string[],
    dataAsOf: string,
    batchSize = 1000,
  ): Promise<ImportMetrics> {
    async function* iterateFiles(): AsyncIterable<string> {
      for (const fp of filePaths) {
        const stream = fs.createReadStream(fp, { encoding: 'utf-8' });
        const rl = readline.createInterface({
          input: stream,
          crlfDelay: Infinity,
        });
        try {
          for await (const line of rl) {
            if (line.trim().length > 0) {
              yield line;
            }
          }
        } finally {
          rl.close();
          stream.destroy();
        }
      }
    }

    return this.importInvoiceInternal(iterateFiles(), dataAsOf, batchSize);
  }

  /**
   * インボイス公表ダウンロードデータの一括取り込み（文字列または配列）
   * 途中で失敗した場合は前の active なデータ・data_as_of を維持する。
   */
  async importInvoiceDataset(
    csvContent: string | string[],
    dataAsOf: string,
    batchSize = 1000,
  ): Promise<ImportMetrics> {
    async function* iterateContent(): AsyncIterable<string> {
      if (Array.isArray(csvContent)) {
        for (const line of csvContent) {
          if (line.trim().length > 0) yield line;
        }
      } else {
        const lines = csvContent.split(/\r?\n/);
        for (const line of lines) {
          if (line.trim().length > 0) yield line;
        }
      }
    }

    return this.importInvoiceInternal(iterateContent(), dataAsOf, batchSize);
  }

  /**
   * 行ストリームを受け取り、invoice_issuers_new 投入から RENAME 入れ替えまでをアトミックに実行する内部共通メソッド
   */
  private async importInvoiceInternal(
    lines: AsyncIterable<string>,
    dataAsOf: string,
    batchSize = 1000,
  ): Promise<ImportMetrics> {
    const startTime = Date.now();
    let versionId = 0;
    let count = 0;
    let unknownKindCount = 0;
    let lockClient: pg.PoolClient | undefined;
    let lockAcquired = false;
    let activeDb: DbClient = this.db;

    try {
      // 0. PostgreSQL のアドバイザリーロックで同時実行を1つに限る
      const underlyingPool = (this.db as unknown as { $client?: pg.Pool }).$client;
      if (underlyingPool && typeof underlyingPool.connect === 'function') {
        lockClient = await underlyingPool.connect();
        const lockRes = await lockClient.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_lock($1) AS acquired',
          [INVOICE_INGEST_LOCK_KEY],
        );
        lockAcquired = lockRes.rows[0]?.acquired === true;
        if (lockAcquired) {
          activeDb = drizzle(lockClient, { schema }) as DbClient;
        }
      } else {
        // 単体テスト用モック DB 向けフォールバック（結果が true のときのみ取得成功とする）
        const lockRes = (await this.db.execute(
          sql`SELECT pg_try_advisory_lock(${INVOICE_INGEST_LOCK_KEY}) AS acquired;`,
        )) as unknown as { rows?: Array<{ acquired?: boolean }> } | undefined;
        lockAcquired = lockRes?.rows?.[0]?.acquired === true;
      }

      if (!lockAcquired) {
        const skippedMetrics: ImportMetrics = {
          sourceType: 'nta_invoice_download',
          dataAsOf,
          datasetVersionId: 0,
          count: 0,
          durationMs: Date.now() - startTime,
          status: 'skipped',
        };
        this.logger.info(
          skippedMetrics,
          'Invoice dataset import skipped because another import is already running',
        );
        return skippedMetrics;
      }

      // 1. 新規バージョンレコードを staging 状態で作成
      const [version] = await activeDb
        .insert(datasetVersions)
        .values({
          sourceType: 'nta_invoice_download',
          dataAsOf,
          status: 'staging',
          recordCount: 0,
        })
        .returning({ id: datasetVersions.id });

      if (!version) {
        throw new Error('Failed to create dataset version record');
      }

      versionId = version.id;

      // 2. 新規一時テーブル invoice_issuers_new を初期化（残存一時テーブルがあれば事前クリーンアップ）
      await activeDb.execute(sql`DROP TABLE IF EXISTS invoice_issuers_new;`);
      await activeDb.execute(sql`DROP TABLE IF EXISTS invoice_issuers_old;`);
      await activeDb.execute(
        sql`CREATE TABLE invoice_issuers_new (LIKE invoice_issuers INCLUDING DEFAULTS);`,
      );

      // 3. invoice_issuers_new へストリーミングでバッチ挿入
      let batch: Array<typeof invoiceIssuersNew.$inferInsert> = [];

      for await (const line of lines) {
        if (!line.trim()) continue;

        const parsed = parseInvoiceCsvLine(line);
        if (!parsed) {
          throw new Error('Invalid invoice CSV line: failed 24-column validation');
        }

        if (!isInvoiceKindCode(parsed.kind)) {
          unknownKindCount++;
        }

        batch.push({
          sequenceNumber: parsed.sequenceNumber,
          registrationNumber: parsed.registrationNumber,
          process: parsed.process,
          correct: parsed.correct,
          kind: parsed.kind,
          country: parsed.country,
          latest: parsed.latest,
          registrationDate: parsed.registrationDate,
          updateDate: parsed.updateDate,
          cancelDate: parsed.cancelDate,
          expireDate: parsed.expireDate,
          headOfficeAddress: parsed.headOfficeAddress,
          headOfficePrefectureCode: parsed.headOfficePrefectureCode,
          headOfficeCityCode: parsed.headOfficeCityCode,
          declaredAddress: parsed.declaredAddress,
          declaredPrefectureCode: parsed.declaredPrefectureCode,
          declaredCityCode: parsed.declaredCityCode,
          kana: parsed.kana,
          legalName: parsed.legalName,
          domesticOfficeAddress: parsed.domesticOfficeAddress,
          domesticOfficePrefectureCode: parsed.domesticOfficePrefectureCode,
          domesticOfficeCityCode: parsed.domesticOfficeCityCode,
          datasetVersionId: versionId,
        });

        count++;

        if (batch.length >= batchSize) {
          await activeDb.insert(invoiceIssuersNew).values(batch);
          batch = [];
        }
      }

      if (batch.length > 0) {
        await activeDb.insert(invoiceIssuersNew).values(batch);
        batch = [];
      }

      // 3b. 件数の安全確認（0件・大幅減少時の入れ替え防止）
      if (count <= 0 || count < this.minRecordCount) {
        throw new Error(
          `Invoice dataset record count (${count}) is below minRecordCount (${this.minRecordCount}); aborting swap to preserve active dataset`,
        );
      }

      const activeVersionRes = (await activeDb.execute(sql`
        SELECT record_count
        FROM dataset_versions
        WHERE source_type = 'nta_invoice_download' AND status = 'active'
        ORDER BY id DESC
        LIMIT 1;
      `)) as unknown as { rows?: Array<{ record_count?: number | string }> } | undefined;
      const activeRecordCount = Number(activeVersionRes?.rows?.[0]?.record_count ?? 0);
      if (activeRecordCount > 0 && count < activeRecordCount * this.minRecordCountRatio) {
        throw new Error(
          `Invoice dataset record count (${count}) dropped below minRecordCountRatio (${this.minRecordCountRatio}) of active dataset (${activeRecordCount}); aborting swap to preserve active dataset`,
        );
      }

      // 4. データ投入完了後、invoice_issuers_new に制約および全索引を作成（一時名）
      await activeDb.execute(sql`
        ALTER TABLE invoice_issuers_new
          ADD CONSTRAINT invoice_issuers_new_pk
          PRIMARY KEY (registration_number, sequence_number, dataset_version_id);
      `);
      await activeDb.execute(sql`
        ALTER TABLE invoice_issuers_new
          ADD CONSTRAINT invoice_issuers_new_dataset_versions_fk
          FOREIGN KEY (dataset_version_id) REFERENCES dataset_versions(id) ON DELETE CASCADE;
      `);

      await activeDb.execute(sql`
        CREATE INDEX idx_invoice_issuers_reg_number_new ON invoice_issuers_new (registration_number);
        CREATE INDEX idx_invoice_issuers_reg_latest_new ON invoice_issuers_new (registration_number, latest);
        CREATE INDEX idx_invoice_issuers_version_new ON invoice_issuers_new (dataset_version_id);
      `);

      // 5. 単一トランザクション内で表名・索引名・制約名をアトミックに入れ替え、版を active に昇格
      await this.executeInvoiceAtomicSwap(versionId, count, activeDb);

      // 6. コミット後、旧表を CASCADE なしで削除し、ANALYZE を実行
      await activeDb.execute(sql`DROP TABLE IF EXISTS invoice_issuers_old;`);
      await activeDb.execute(sql`ANALYZE invoice_issuers;`);

      const metrics: ImportMetrics = {
        sourceType: 'nta_invoice_download',
        dataAsOf,
        datasetVersionId: versionId,
        count,
        durationMs: Date.now() - startTime,
        status: 'active',
        unknownKindCount,
      };

      this.logger.info(
        metrics,
        'Invoice dataset import completed successfully via atomic RENAME swap',
      );
      return metrics;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorType = err instanceof Error ? err.name : 'UnknownError';

      // 失敗時クリーンアップ: invoice_issuers_new を DROP
      try {
        await activeDb.execute(sql`DROP TABLE IF EXISTS invoice_issuers_new;`);
      } catch {
        // ignore
      }

      if (versionId > 0) {
        try {
          await activeDb
            .update(datasetVersions)
            .set({ status: 'failed' })
            .where(eq(datasetVersions.id, versionId));
        } catch {
          // ignore cleanup failure
        }
      }

      this.logger.error(
        {
          sourceType: 'nta_invoice_download',
          dataAsOf,
          datasetVersionId: versionId,
          count,
          durationMs,
          unknownKindCount,
          errorType,
        },
        'Invoice dataset import failed; prior active dataset preserved',
      );

      throw err;
    } finally {
      if (lockAcquired) {
        try {
          if (lockClient) {
            await lockClient.query('SELECT pg_advisory_unlock($1)', [INVOICE_INGEST_LOCK_KEY]);
          } else {
            await this.db.execute(sql`SELECT pg_advisory_unlock(${INVOICE_INGEST_LOCK_KEY});`);
          }
        } catch {
          // ignore unlock errors on cleanup
        }
      }
      if (lockClient) {
        lockClient.release();
      }
    }
  }

  /**
   * 単一トランザクション内でテーブル名・索引名・制約名をアトミックに入れ替え、
   * 旧版を superseded、新版を active に切り替える（法人番号）
   */
  private async executeAtomicSwap(
    versionId: number,
    recordCount: number,
    dbClient: DbClient = this.db,
  ): Promise<void> {
    await dbClient.transaction(async (tx) => {
      // 1. 旧テーブルを old にリネーム
      await tx.execute(sql`ALTER TABLE corporate_numbers RENAME TO corporate_numbers_old;`);

      // 2. 旧テーブルの制約・索引を old にリネーム（正規名を解放）
      await tx.execute(sql`
        ALTER TABLE corporate_numbers_old
          RENAME CONSTRAINT corporate_numbers_corporate_number_dataset_version_id_pk
          TO corporate_numbers_pk_old;
        ALTER TABLE corporate_numbers_old
          RENAME CONSTRAINT corporate_numbers_dataset_version_id_dataset_versions_id_fk
          TO corporate_numbers_dataset_versions_fk_old;
        ALTER INDEX idx_corporate_numbers_number RENAME TO idx_corporate_numbers_number_old;
        ALTER INDEX idx_corporate_numbers_name RENAME TO idx_corporate_numbers_name_old;
        ALTER INDEX idx_corporate_numbers_name_trgm RENAME TO idx_corporate_numbers_name_trgm_old;
        ALTER INDEX idx_corporate_numbers_prefecture RENAME TO idx_corporate_numbers_prefecture_old;
        ALTER INDEX idx_corporate_numbers_version RENAME TO idx_corporate_numbers_version_old;
      `);

      // 3. 新テーブルを正規名 corporate_numbers にリネーム
      await tx.execute(sql`ALTER TABLE corporate_numbers_new RENAME TO corporate_numbers;`);

      // 4. 新テーブルの制約・索引を正規名にリネーム（drizzle マイグレーション定義と一致させる）
      await tx.execute(sql`
        ALTER TABLE corporate_numbers
          RENAME CONSTRAINT corporate_numbers_new_pk
          TO corporate_numbers_corporate_number_dataset_version_id_pk;
        ALTER TABLE corporate_numbers
          RENAME CONSTRAINT corporate_numbers_new_dataset_versions_fk
          TO corporate_numbers_dataset_version_id_dataset_versions_id_fk;
        ALTER INDEX idx_corporate_numbers_number_new RENAME TO idx_corporate_numbers_number;
        ALTER INDEX idx_corporate_numbers_name_new RENAME TO idx_corporate_numbers_name;
        ALTER INDEX idx_corporate_numbers_name_trgm_new RENAME TO idx_corporate_numbers_name_trgm;
        ALTER INDEX idx_corporate_numbers_prefecture_new RENAME TO idx_corporate_numbers_prefecture;
        ALTER INDEX idx_corporate_numbers_version_new RENAME TO idx_corporate_numbers_version;
      `);

      // 5. 旧アクティブ版を superseded に更新
      await tx
        .update(datasetVersions)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(datasetVersions.sourceType, 'nta_corporate_download'),
            eq(datasetVersions.status, 'active'),
          ),
        );

      // 6. 新バージョンを active に昇格（必須）
      await tx
        .update(datasetVersions)
        .set({
          status: 'active',
          recordCount,
          importedAt: new Date(),
        })
        .where(eq(datasetVersions.id, versionId));
    });
  }

  /**
   * 単一トランザクション内でテーブル名・索引名・制約名をアトミックに入れ替え、
   * 旧版を superseded、新版を active に切り替える（インボイス）
   */
  private async executeInvoiceAtomicSwap(
    versionId: number,
    recordCount: number,
    dbClient: DbClient = this.db,
  ): Promise<void> {
    await dbClient.transaction(async (tx) => {
      // 1. 旧テーブルを old にリネーム
      await tx.execute(sql`ALTER TABLE invoice_issuers RENAME TO invoice_issuers_old;`);

      // 2. 旧テーブルの制約・索引を old にリネーム（正規名を解放）
      await tx.execute(sql`
        ALTER TABLE invoice_issuers_old
          RENAME CONSTRAINT invoice_issuers_reg_num_seq_num_version_id_pk
          TO invoice_issuers_pk_old;
        ALTER TABLE invoice_issuers_old
          RENAME CONSTRAINT invoice_issuers_dataset_version_id_dataset_versions_id_fk
          TO invoice_issuers_dataset_versions_fk_old;
        ALTER INDEX idx_invoice_issuers_reg_number RENAME TO idx_invoice_issuers_reg_number_old;
        ALTER INDEX idx_invoice_issuers_reg_latest RENAME TO idx_invoice_issuers_reg_latest_old;
        ALTER INDEX idx_invoice_issuers_version RENAME TO idx_invoice_issuers_version_old;
      `);

      // 3. 新テーブルを正規名 invoice_issuers にリネーム
      await tx.execute(sql`ALTER TABLE invoice_issuers_new RENAME TO invoice_issuers;`);

      // 4. 新テーブルの制約・索引を正規名にリネーム（drizzle マイグレーション定義と一致させる）
      await tx.execute(sql`
        ALTER TABLE invoice_issuers
          RENAME CONSTRAINT invoice_issuers_new_pk
          TO invoice_issuers_reg_num_seq_num_version_id_pk;
        ALTER TABLE invoice_issuers
          RENAME CONSTRAINT invoice_issuers_new_dataset_versions_fk
          TO invoice_issuers_dataset_version_id_dataset_versions_id_fk;
        ALTER INDEX idx_invoice_issuers_reg_number_new RENAME TO idx_invoice_issuers_reg_number;
        ALTER INDEX idx_invoice_issuers_reg_latest_new RENAME TO idx_invoice_issuers_reg_latest;
        ALTER INDEX idx_invoice_issuers_version_new RENAME TO idx_invoice_issuers_version;
      `);

      // 5. 旧アクティブ版を superseded に更新
      await tx
        .update(datasetVersions)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(datasetVersions.sourceType, 'nta_invoice_download'),
            eq(datasetVersions.status, 'active'),
          ),
        );

      // 6. 新バージョンを active に昇格（必須）
      await tx
        .update(datasetVersions)
        .set({
          status: 'active',
          recordCount,
          importedAt: new Date(),
        })
        .where(eq(datasetVersions.id, versionId));
    });
  }

  /**
   * 全件データ取り込み後のテーブル一括入れ替え（RENAME Swap 方式・法人番号）
   *
   * 根拠:
   *   全件規模（約573万件）の一括更新時、通常の一行単位・バッチ単位のコピーではなく、
   *   別表（new）にデータ投入および全索引（GIN/B-tree）作成を完了させた後、
   *   同一トランザクション内で表名・索引名・制約名をアトミックに入れ替え、
   *   旧版を superseded、新版を active に切り替える。
   *   旧表は CASCADE なしで削除する。
   *
   * @param datasetVersionId 対象のデータセットバージョンID（必須・正の整数）
   * @param recordCount 取り込みレコード件数
   * @param dataAsOf データの基準日
   */
  async swapCorporateTable(
    datasetVersionId: number,
    recordCount = 0,
    dataAsOf = 'swap',
  ): Promise<{ durationMs: number }> {
    if (!datasetVersionId || datasetVersionId <= 0) {
      throw new Error('datasetVersionId must be a positive integer for atomic swap');
    }

    const startTime = Date.now();
    await this.executeAtomicSwap(datasetVersionId, recordCount);
    // コミット後、旧表を CASCADE なしで削除し、ANALYZE を実行
    await this.db.execute(sql`DROP TABLE IF EXISTS corporate_numbers_old;`);
    await this.db.execute(sql`ANALYZE corporate_numbers;`);

    const durationMs = Date.now() - startTime;
    this.logger.info(
      {
        sourceType: 'nta_corporate_download',
        dataAsOf,
        datasetVersionId,
        count: recordCount,
        durationMs,
        status: 'active',
      },
      'Corporate table swapped atomically via RENAME Swap',
    );
    return { durationMs };
  }

  /**
   * 全件データ取り込み後のテーブル一括入れ替え（RENAME Swap 方式・インボイス）
   *
   * @param datasetVersionId 対象のデータセットバージョンID（必須・正の整数）
   * @param recordCount 取り込みレコード件数
   * @param dataAsOf データの基準日
   */
  async swapInvoiceTable(
    datasetVersionId: number,
    recordCount = 0,
    dataAsOf = 'swap',
  ): Promise<{ durationMs: number }> {
    if (!datasetVersionId || datasetVersionId <= 0) {
      throw new Error('datasetVersionId must be a positive integer for atomic swap');
    }

    const startTime = Date.now();
    await this.executeInvoiceAtomicSwap(datasetVersionId, recordCount);
    // コミット後、旧表を CASCADE なしで削除し、ANALYZE を実行
    await this.db.execute(sql`DROP TABLE IF EXISTS invoice_issuers_old;`);
    await this.db.execute(sql`ANALYZE invoice_issuers;`);

    const durationMs = Date.now() - startTime;
    this.logger.info(
      {
        sourceType: 'nta_invoice_download',
        dataAsOf,
        datasetVersionId,
        count: recordCount,
        durationMs,
        status: 'active',
      },
      'Invoice table swapped atomically via RENAME Swap',
    );
    return { durationMs };
  }
}
