/**
 * Dataset Importer (Atomic Staging -> Active Swap)
 *
 * 根拠 / Source:
 *   実装指示書v1 §5(B4):
 *     - 新しいデータは別の場所に取り込み、全件そろってから切り替える。途中で失敗した場合は、前のデータと前の data_as_of のまま動き続ける
 *     - 取り込み処理のログに、法人番号・登録番号・名称を出さない（件数・所要時間・エラー種別のみ）
 *   Linear SLA2-324:
 *     - CSV全体を一度にメモリへ読み込まず、行単位でストリーミング処理する
 *     - 1ファイル300MB超の分割ファイルに対応（複数ファイルを1つの版として取り込む）
 *     - 本番反映時にステージング全行をNodeへ読み込まず、DB内 SQL（INSERT ... SELECT）で完結させる
 *     - 項番30「検索対象除外（hihyoji）」を取り込む
 */

import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { eq, and, sql } from 'drizzle-orm';
import { pgTable, varchar, integer } from 'drizzle-orm/pg-core';
import type { DbClient } from '../db/client.js';
import { datasetVersions, invoiceIssuers, invoiceIssuersStaging } from '../db/schema.js';
import { parseCorporateCsvLine, parseInvoiceCsvLine } from './parser.js';
import { createIngestLogger, type IngestLogger } from './logger.js';
import type { ImportMetrics } from './types.js';

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

export interface ImporterOptions {
  batchSize?: number;
  logger?: IngestLogger;
}

export class DatasetImporter {
  private logger: IngestLogger;

  constructor(
    private db: DbClient,
    options?: ImporterOptions,
  ) {
    this.logger = options?.logger ?? createIngestLogger();
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
        for await (const line of rl) {
          if (line.trim().length > 0) {
            yield line;
          }
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
   * 行ストリームを受け取り、staging 投入から本番昇格までをアトミックに実行する内部共通メソッド
   */
  private async importCorporateInternal(
    lines: AsyncIterable<string>,
    dataAsOf: string,
    batchSize = 1000,
  ): Promise<ImportMetrics> {
    const startTime = Date.now();
    let versionId = 0;
    let count = 0;

    try {
      // 1. 新規バージョンレコードを staging 状態で作成
      const [version] = await this.db
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
      await this.db.execute(sql`DROP TABLE IF EXISTS corporate_numbers_new;`);
      await this.db.execute(sql`DROP TABLE IF EXISTS corporate_numbers_old;`);
      await this.db.execute(
        sql`CREATE TABLE corporate_numbers_new (LIKE corporate_numbers INCLUDING DEFAULTS);`,
      );

      // 3. corporate_numbers_new へストリーミングでバッチ挿入
      let batch: Array<typeof corporateNumbersNew.$inferInsert> = [];

      for await (const line of lines) {
        const parsed = parseCorporateCsvLine(line);
        if (!parsed) continue;

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
          await this.db.insert(corporateNumbersNew).values(batch);
          batch = [];
        }
      }

      if (batch.length > 0) {
        await this.db.insert(corporateNumbersNew).values(batch);
        batch = [];
      }

      // 4. データ投入完了後、corporate_numbers_new に制約および全索引を作成（一時名）
      await this.db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);

      await this.db.execute(sql`
        ALTER TABLE corporate_numbers_new
          ADD CONSTRAINT corporate_numbers_new_pk PRIMARY KEY (corporate_number, dataset_version_id);
      `);
      await this.db.execute(sql`
        ALTER TABLE corporate_numbers_new
          ADD CONSTRAINT corporate_numbers_new_dataset_versions_fk
          FOREIGN KEY (dataset_version_id) REFERENCES dataset_versions(id) ON DELETE CASCADE;
      `);

      await this.db.execute(sql`
        CREATE INDEX idx_corporate_numbers_number_new ON corporate_numbers_new (corporate_number);
        CREATE INDEX idx_corporate_numbers_name_new ON corporate_numbers_new (name);
        CREATE INDEX idx_corporate_numbers_name_trgm_new ON corporate_numbers_new USING gin (name gin_trgm_ops);
        CREATE INDEX idx_corporate_numbers_prefecture_new ON corporate_numbers_new (prefecture_code);
        CREATE INDEX idx_corporate_numbers_version_new ON corporate_numbers_new (dataset_version_id);
      `);

      // 5. 単一トランザクション内で表名・索引名・制約名をアトミックに入れ替え、版を active に昇格
      await this.executeAtomicSwap(versionId, count);

      // 6. コミット後、旧表を CASCADE なしで削除
      await this.db.execute(sql`DROP TABLE IF EXISTS corporate_numbers_old;`);

      const metrics: ImportMetrics = {
        sourceType: 'nta_corporate_download',
        dataAsOf,
        datasetVersionId: versionId,
        count,
        durationMs: Date.now() - startTime,
        status: 'active',
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
        await this.db.execute(sql`DROP TABLE IF EXISTS corporate_numbers_new;`);
      } catch {
        // ignore
      }

      // 失敗した staging レコードをマーク
      if (versionId > 0) {
        try {
          await this.db
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
          errorType,
        },
        'Corporate dataset import failed; prior active dataset preserved',
      );

      throw err;
    }
  }

  /**
   * インボイス公表ダウンロードデータの一括取り込み
   */
  async importInvoiceDataset(
    csvContent: string | string[],
    dataAsOf: string,
    batchSize = 1000,
  ): Promise<ImportMetrics> {
    const startTime = Date.now();
    let versionId = 0;
    let count = 0;

    const lines = Array.isArray(csvContent)
      ? csvContent
      : csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);

    try {
      const [version] = await this.db
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

      let batch: Array<typeof invoiceIssuersStaging.$inferInsert> = [];

      for (const line of lines) {
        const parsed = parseInvoiceCsvLine(line);
        if (!parsed) continue;

        batch.push({
          registrationNumber: parsed.registrationNumber,
          process: parsed.process,
          correct: parsed.correct,
          kind: parsed.kind,
          corporateNumber: parsed.corporateNumber,
          legalName: parsed.legalName,
          prefectureName: parsed.prefectureName,
          cityName: parsed.cityName,
          streetNumber: parsed.streetNumber,
          postCode: parsed.postCode,
          addressOutside: parsed.addressOutside,
          registrationDate: parsed.registrationDate,
          updateDate: parsed.updateDate,
          cancelDate: parsed.cancelDate,
          expireDate: parsed.expireDate,
          datasetVersionId: versionId,
        });

        count++;

        if (batch.length >= batchSize) {
          await this.db.insert(invoiceIssuersStaging).values(batch);
          batch = [];
        }
      }

      if (batch.length > 0) {
        await this.db.insert(invoiceIssuersStaging).values(batch);
        batch = [];
      }

      // トランザクションで本番反映
      await this.db.transaction(async (tx) => {
        const stagingRows = await tx
          .select()
          .from(invoiceIssuersStaging)
          .where(eq(invoiceIssuersStaging.datasetVersionId, versionId));

        if (stagingRows.length > 0) {
          await tx.insert(invoiceIssuers).values(stagingRows);
        }

        await tx
          .update(datasetVersions)
          .set({ status: 'superseded' })
          .where(
            and(
              eq(datasetVersions.sourceType, 'nta_invoice_download'),
              eq(datasetVersions.status, 'active'),
            ),
          );

        await tx
          .update(datasetVersions)
          .set({
            status: 'active',
            recordCount: count,
            importedAt: new Date(),
          })
          .where(eq(datasetVersions.id, versionId));

        await tx
          .delete(invoiceIssuersStaging)
          .where(eq(invoiceIssuersStaging.datasetVersionId, versionId));
      });

      const metrics: ImportMetrics = {
        sourceType: 'nta_invoice_download',
        dataAsOf,
        datasetVersionId: versionId,
        count,
        durationMs: Date.now() - startTime,
        status: 'active',
      };

      this.logger.info(metrics, 'Invoice dataset import completed successfully');
      return metrics;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorType = err instanceof Error ? err.name : 'UnknownError';

      if (versionId > 0) {
        try {
          await this.db
            .update(datasetVersions)
            .set({ status: 'failed' })
            .where(eq(datasetVersions.id, versionId));

          await this.db
            .delete(invoiceIssuersStaging)
            .where(eq(invoiceIssuersStaging.datasetVersionId, versionId));
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
          errorType,
        },
        'Invoice dataset import failed; prior active dataset preserved',
      );

      throw err;
    }
  }

  /**
   * 単一トランザクション内でテーブル名・索引名・制約名をアトミックに入れ替え、
   * 旧版を superseded、新版を active に切り替える
   */
  private async executeAtomicSwap(versionId: number, recordCount: number): Promise<void> {
    await this.db.transaction(async (tx) => {
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

      // 4. 新テーブルの制約・索引を正規名にリネーム（drizzle マイグレーション定義と完全一致させる）
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
   * 全件データ取り込み後のテーブル一括入れ替え（RENAME Swap 方式）
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
    // コミット後、旧表を CASCADE なしで削除
    await this.db.execute(sql`DROP TABLE IF EXISTS corporate_numbers_old;`);

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
}
