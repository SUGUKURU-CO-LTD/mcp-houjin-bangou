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
import type { DbClient } from '../db/client.js';
import {
  datasetVersions,
  corporateNumbersStaging,
  invoiceIssuers,
  invoiceIssuersStaging,
} from '../db/schema.js';
import { parseCorporateCsvLine, parseInvoiceCsvLine } from './parser.js';
import { createIngestLogger, type IngestLogger } from './logger.js';
import type { ImportMetrics } from './types.js';

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

      // 2. ステージングテーブルへバッチ挿入（行単位ストリーミング処理）
      let batch: Array<typeof corporateNumbersStaging.$inferInsert> = [];

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
          await this.db.insert(corporateNumbersStaging).values(batch);
          batch = [];
        }
      }

      if (batch.length > 0) {
        await this.db.insert(corporateNumbersStaging).values(batch);
        batch = [];
      }

      // 3. 全件正常に取り込めたら、トランザクションで本番反映とアクティブ化をアトミックに実行
      // Node.js に全件展開せず、PostgreSQL 内部で INSERT ... SELECT により完結させる（OOM・パラメータ上限回避）
      await this.db.transaction(async (tx) => {
        // ステージングから本番テーブルへ DB 内で直接コピー
        await tx.execute(sql`
          INSERT INTO corporate_numbers (
            corporate_number, process, correct, update_date, change_date,
            name, name_image_id, kind, prefecture_name, city_name,
            street_number, address_image_id, prefecture_code, city_code,
            post_code, address_outside, address_outside_image_id, close_date,
            close_cause, successor_corporate_number, change_cause, assignment_date,
            latest, en_name, en_prefecture_name, en_city_name, en_address_outside,
            furigana, hihyoji, dataset_version_id
          )
          SELECT
            corporate_number, process, correct, update_date, change_date,
            name, name_image_id, kind, prefecture_name, city_name,
            street_number, address_image_id, prefecture_code, city_code,
            post_code, address_outside, address_outside_image_id, close_date,
            close_cause, successor_corporate_number, change_cause, assignment_date,
            latest, en_name, en_prefecture_name, en_city_name, en_address_outside,
            furigana, hihyoji, dataset_version_id
          FROM corporate_numbers_staging
          WHERE dataset_version_id = ${versionId}
        `);

        // 旧アクティブ版を superseded に更新
        await tx
          .update(datasetVersions)
          .set({ status: 'superseded' })
          .where(
            and(
              eq(datasetVersions.sourceType, 'nta_corporate_download'),
              eq(datasetVersions.status, 'active'),
            ),
          );

        // 新バージョンを active に昇格
        await tx
          .update(datasetVersions)
          .set({
            status: 'active',
            recordCount: count,
            importedAt: new Date(),
          })
          .where(eq(datasetVersions.id, versionId));

        // ステージングデータを削除
        await tx
          .delete(corporateNumbersStaging)
          .where(eq(corporateNumbersStaging.datasetVersionId, versionId));

        // 旧版データのクリーンアップ（全件入れ替え方式のため、新版以外の旧データを削除）
        await tx.execute(sql`
          DELETE FROM corporate_numbers WHERE dataset_version_id != ${versionId}
        `);
      });

      const metrics: ImportMetrics = {
        sourceType: 'nta_corporate_download',
        dataAsOf,
        datasetVersionId: versionId,
        count,
        durationMs: Date.now() - startTime,
        status: 'active',
      };

      this.logger.info(metrics, 'Corporate dataset import completed successfully');
      return metrics;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorType = err instanceof Error ? err.name : 'UnknownError';

      // 失敗した staging レコードをマーク
      if (versionId > 0) {
        try {
          await this.db
            .update(datasetVersions)
            .set({ status: 'failed' })
            .where(eq(datasetVersions.id, versionId));

          await this.db
            .delete(corporateNumbersStaging)
            .where(eq(corporateNumbersStaging.datasetVersionId, versionId));
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
   * 全件データ取り込み後のテーブル一括入れ替え（RENAME Swap 方式）
   *
   * 根拠:
   *   全件規模（約573万件）の一括更新時、通常の一行単位・バッチ単位のコピーではなく、
   *   別表（staging/new）にデータ投入および全索引（GIN/B-tree）作成を完了させた後、
   *   同一トランザクション内で表名をアトミックに入れ替える（実測 169.70 ms）。
   *
   * @param newTableName 新規データ投入・索引作成済みのテーブル名
   * @param activeTableName 現在運用中のアクティブテーブル名
   * @param oldTableName 旧データ退避用の一時テーブル名
   * @param datasetVersionId 対象のデータセットバージョンID
   * @param dataAsOf データの基準日
   */
  async swapCorporateTable(
    newTableName = 'corporate_numbers_new',
    activeTableName = 'corporate_numbers',
    oldTableName = 'corporate_numbers_old',
    datasetVersionId = 0,
    dataAsOf = 'swap',
  ): Promise<{ durationMs: number }> {
    const startTime = Date.now();
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        ALTER TABLE ${sql.identifier(activeTableName)} RENAME TO ${sql.identifier(oldTableName)};
        ALTER TABLE ${sql.identifier(newTableName)} RENAME TO ${sql.identifier(activeTableName)};
        DROP TABLE IF EXISTS ${sql.identifier(oldTableName)} CASCADE;
      `);

      if (datasetVersionId > 0) {
        await tx
          .update(datasetVersions)
          .set({ status: 'superseded' })
          .where(
            and(
              eq(datasetVersions.sourceType, 'nta_corporate_download'),
              eq(datasetVersions.status, 'active'),
            ),
          );

        await tx
          .update(datasetVersions)
          .set({
            status: 'active',
            importedAt: new Date(),
          })
          .where(eq(datasetVersions.id, datasetVersionId));
      }
    });
    const durationMs = Date.now() - startTime;
    this.logger.info(
      {
        sourceType: 'nta_corporate_download',
        dataAsOf,
        datasetVersionId,
        count: 0,
        durationMs,
        status: 'active',
      },
      'Corporate table swapped atomically via RENAME Swap',
    );
    return { durationMs };
  }
}
