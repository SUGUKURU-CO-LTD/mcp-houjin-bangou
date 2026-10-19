/**
 * Database Migration Runner Entrypoint
 *
 * 根拠 / Source:
 *   Linear SLA2-327 (B6 PR B):
 *     - drizzle-orm の migrator で drizzle/ を適用する入口
 *     - node dist/db/migrate.js で実行し、成功で 0、失敗で 1 を返す
 */

import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createIngestDbClient } from './client.js';
import { formatErrorWithCause } from '../lib/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MigrateOptions {
  connectionString?: string;
  migrationsFolder?: string;
}

/**
 * drizzle/ 配下のマイグレーションを適用する。
 */
export async function runMigrations(options?: MigrateOptions): Promise<void> {
  const migrationsFolder = options?.migrationsFolder ?? path.resolve(__dirname, '../../drizzle');
  const { pool, db } = createIngestDbClient(
    options?.connectionString ? { connectionString: options.connectionString } : undefined,
  );

  try {
    await migrate(db as unknown as NodePgDatabase<Record<string, unknown>>, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

export function checkIsMigrateMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    const scriptPath = realpathSync(process.argv[1]);
    const currentPath = realpathSync(fileURLToPath(import.meta.url));
    return scriptPath === currentPath;
  } catch {
    return false;
  }
}

/**
 * CLI エントリポイント: 成功で 0、失敗で 1 を返す。
 */
export async function runMigrateCli(
  options?: MigrateOptions,
  output: NodeJS.WritableStream = process.stderr,
): Promise<number> {
  const startTime = Date.now();
  try {
    await runMigrations(options);
    output.write(
      JSON.stringify({
        level: 'info',
        time: new Date().toISOString(),
        logger: 'db_migrate',
        duration_ms: Date.now() - startTime,
        status: 'completed',
      }) + '\n',
    );
    return 0;
  } catch (err) {
    const errorType = err instanceof Error ? err.name : 'UnknownError';
    const msg = formatErrorWithCause(err);
    output.write(
      JSON.stringify({
        level: 'error',
        time: new Date().toISOString(),
        logger: 'db_migrate',
        duration_ms: Date.now() - startTime,
        status: 'failed',
        error_type: errorType,
        msg,
      }) + '\n',
    );
    return 1;
  }
}

if (checkIsMigrateMainModule()) {
  runMigrateCli()
    .then((code) => {
      process.exit(code);
    })
    .catch(() => {
      process.exit(1);
    });
}
