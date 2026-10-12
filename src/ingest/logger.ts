/**
 * Ingestion Metrics Logger
 *
 * 根拠 / Source:
 *   実装指示書v1 §5(B4)
 *   「取り込み処理のログに、法人番号・登録番号・名称を出さない（件数・所要時間・エラー種別のみ）」
 */

import type { ImportMetrics } from './types.js';

export interface IngestLogger {
  info(metrics: Omit<ImportMetrics, 'errorType'>, message?: string): void;
  error(metrics: Partial<ImportMetrics> & { errorType: string }, message?: string): void;
}

export function createIngestLogger(output: NodeJS.WritableStream = process.stderr): IngestLogger {
  const writeJson = (payload: object) => {
    output.write(JSON.stringify(payload) + '\n');
  };

  return {
    info(metrics, message) {
      writeJson({
        level: 'info',
        time: new Date().toISOString(),
        logger: 'dataset_ingest',
        source_type: metrics.sourceType,
        data_as_of: metrics.dataAsOf,
        dataset_version_id: metrics.datasetVersionId,
        count: metrics.count,
        duration_ms: metrics.durationMs,
        status: metrics.status,
        ...(message ? { msg: message } : {}),
      });
    },
    error(metrics, message) {
      writeJson({
        level: 'error',
        time: new Date().toISOString(),
        logger: 'dataset_ingest',
        source_type: metrics.sourceType,
        data_as_of: metrics.dataAsOf,
        dataset_version_id: metrics.datasetVersionId,
        count: metrics.count ?? 0,
        duration_ms: metrics.durationMs ?? 0,
        status: 'failed',
        error_type: metrics.errorType,
        ...(message ? { msg: message } : {}),
      });
    },
  };
}
