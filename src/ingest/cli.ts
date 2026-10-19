/**
 * Dataset Ingestion CLI Entrypoint
 *
 * 根拠 / Source:
 *   Linear SLA2-327 (B6 PR B):
 *     - node dist/ingest/cli.js --type corporate --dir /mnt/ingest/corporate/2026-10 --data-as-of 2026-09-30
 *     - --type は corporate か invoice
 *     - ディレクトリ直下の .csv をファイル名の順に読む。.csv が1つもなければ失敗
 *     - 終了コード: 0 = 入れ替え完了（active）、1 = 失敗（検証で中止、エラー）、2 = 別の取り込みが実行中でスキップ
 *     - 結果は既存の ingest logger で JSON 1行に出す（件数、所要時間、状態）
 *     - 取り込み処理のログに、法人番号・登録番号・名称を出さない
 */

import * as fs from 'node:fs';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createIngestDbClient } from '../db/client.js';
import { DatasetImporter } from './importer.js';
import { createIngestLogger, type IngestLogger } from './logger.js';

export type IngestCliType = 'corporate' | 'invoice';

export interface IngestCliArgs {
  type: IngestCliType;
  dir: string;
  dataAsOf: string;
}

const DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidCalendarDate(dateStr: string): boolean {
  const match = DATE_REGEX.exec(dateStr);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * CLI 引数を解析・検証する。
 */
export function parseIngestCliArgs(argv: string[]): IngestCliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      type: { type: 'string' },
      dir: { type: 'string' },
      'data-as-of': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  if (positionals.length > 0) {
    throw new Error('Unexpected positional arguments');
  }

  const type = values.type;
  if (type !== 'corporate' && type !== 'invoice') {
    throw new Error('Invalid or missing --type: must be "corporate" or "invoice"');
  }

  const dir = values.dir?.trim();
  if (!dir) {
    throw new Error('Missing required argument: --dir');
  }

  const dataAsOf = values['data-as-of']?.trim();
  if (!dataAsOf || !isValidCalendarDate(dataAsOf)) {
    throw new Error('Invalid or missing --data-as-of: must be YYYY-MM-DD');
  }

  return {
    type,
    dir,
    dataAsOf,
  };
}

/**
 * 指定ディレクトリ直下の .csv ファイルをファイル名順（昇順）に列挙する。
 * ディレクトリが存在しない場合や .csv が1件もない場合はエラーを投げる。
 */
export function resolveCsvFilesInDir(dirPath: string): string[] {
  const resolvedDir = path.resolve(dirPath);
  if (!fs.existsSync(resolvedDir)) {
    throw new Error('Target directory does not exist');
  }

  const stat = fs.statSync(resolvedDir);
  if (!stat.isDirectory()) {
    throw new Error('Target path is not a directory');
  }

  const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
  const csvFileNames = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.csv'))
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  if (csvFileNames.length === 0) {
    throw new Error('No .csv files found in target directory');
  }

  return csvFileNames.map((name) => path.join(resolvedDir, name));
}

export interface RunIngestCliOptions {
  connectionString?: string;
  logger?: IngestLogger;
  output?: NodeJS.WritableStream;
}

/**
 * 取り込み CLI のメイン実行関数。
 * 終了コード:
 *   0 = 入れ替え完了 (active)
 *   1 = 失敗 (検証で中止、引数不正、ファイルなし、エラー)
 *   2 = 別の取り込みが実行中でスキップ (skipped)
 */
export async function runIngestCli(
  argv: string[] = process.argv.slice(2),
  options?: RunIngestCliOptions,
): Promise<number> {
  const startTime = Date.now();
  const logger = options?.logger ?? createIngestLogger(options?.output ?? process.stderr);

  let parsedArgs: IngestCliArgs;
  try {
    parsedArgs = parseIngestCliArgs(argv);
  } catch (err) {
    const errorType = err instanceof Error ? err.name : 'InvalidArgumentError';
    logger.error(
      {
        count: 0,
        durationMs: Date.now() - startTime,
        errorType,
      },
      err instanceof Error ? err.message : 'Invalid CLI arguments',
    );
    return 1;
  }

  const sourceType =
    parsedArgs.type === 'corporate' ? 'nta_corporate_download' : 'nta_invoice_download';

  let filePaths: string[];
  try {
    filePaths = resolveCsvFilesInDir(parsedArgs.dir);
  } catch (err) {
    const errorType = err instanceof Error ? err.name : 'DirectoryError';
    logger.error(
      {
        sourceType,
        dataAsOf: parsedArgs.dataAsOf,
        count: 0,
        durationMs: Date.now() - startTime,
        errorType,
      },
      err instanceof Error ? err.message : 'Failed to resolve CSV files in directory',
    );
    return 1;
  }

  let pool: ReturnType<typeof createIngestDbClient>['pool'] | undefined;
  let importerCalled = false;

  try {
    const client = createIngestDbClient(
      options?.connectionString ? { connectionString: options.connectionString } : undefined,
    );
    pool = client.pool;

    const importer = new DatasetImporter(client.db, { logger });
    importerCalled = true;

    const metrics =
      parsedArgs.type === 'corporate'
        ? await importer.importCorporateFiles(filePaths, parsedArgs.dataAsOf)
        : await importer.importInvoiceFiles(filePaths, parsedArgs.dataAsOf);

    if (metrics.status === 'skipped') {
      return 2;
    }
    if (metrics.status === 'active') {
      return 0;
    }
    return 1;
  } catch (err) {
    if (!importerCalled) {
      const errorType = err instanceof Error ? err.name : 'DatabaseConnectionError';
      logger.error(
        {
          sourceType,
          dataAsOf: parsedArgs.dataAsOf,
          count: 0,
          durationMs: Date.now() - startTime,
          errorType,
        },
        err instanceof Error ? err.message : 'Failed to initialize database client for ingestion',
      );
    }
    return 1;
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

export function checkIsIngestCliMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    const scriptPath = realpathSync(process.argv[1]);
    const currentPath = realpathSync(fileURLToPath(import.meta.url));
    return scriptPath === currentPath;
  } catch {
    return false;
  }
}

if (checkIsIngestCliMainModule()) {
  runIngestCli()
    .then((code) => {
      process.exit(code);
    })
    .catch(() => {
      process.exit(1);
    });
}
