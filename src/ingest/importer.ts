/**
 * Dataset Importer (Atomic Staging -> Active Swap)
 *
 * 根拠 / Source:
 *   実装指示書v1 §5(B4):
 *     - 新しいデータは別の場所に取り込み、全件そろってから切り替える。途中で失敗した場合は、前のデータと前の data_as_of のまま動き続ける
 *     - 取り込み処理のログに、法人番号・登録番号・名称を出さない（件数・所要時間・エラー種別のみ）
 */

import { eq, and } from 'drizzle-orm';
import type { DbClient } from '../db/client.js';
import {
  datasetVersions,
  corporateNumbers,
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
   * 法人基本3情報ダウンロードデータの一括取り込み
   * 途中で失敗した場合は前の active なデータ・data_as_of を維持する。
   */
  async importCorporateDataset(
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

      // 2. ステージングテーブルへバッチ挿入
      let batch: Array<typeof corporateNumbersStaging.$inferInsert> = [];

      for (const line of lines) {
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
      await this.db.transaction(async (tx) => {
        // ステージングから本番テーブルへ移行
        const stagingRows = await tx
          .select()
          .from(corporateNumbersStaging)
          .where(eq(corporateNumbersStaging.datasetVersionId, versionId));

        if (stagingRows.length > 0) {
          await tx.insert(corporateNumbers).values(stagingRows);
        }

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
}
