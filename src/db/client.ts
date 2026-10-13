/**
 * PostgreSQL Database Client & Drizzle Instance
 *
 * 根拠 / Source: docs/plan/corp-check-interface-v1.md §1 (ホスト版データベース接続)
 */

import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

const { Pool } = pg;

export type DbClient = NodePgDatabase<typeof schema>;

export interface DbConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | object;
  max?: number;
  statementTimeoutMs?: number;
}

let cachedPool: pg.Pool | undefined;
let cachedDb: DbClient | undefined;

export function createDbClient(config?: DbConfig): { pool: pg.Pool; db: DbClient } {
  const statementTimeout =
    config?.statementTimeoutMs ??
    (process.env.DB_STATEMENT_TIMEOUT_MS
      ? parseInt(process.env.DB_STATEMENT_TIMEOUT_MS, 10)
      : 5000);

  const pool = new Pool(
    config?.connectionString
      ? {
          connectionString: config.connectionString,
          max: config.max ?? 10,
          statement_timeout: statementTimeout,
        }
      : {
          host: config?.host ?? process.env.DB_HOST ?? 'localhost',
          port: config?.port ?? (process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432),
          user: config?.user ?? process.env.DB_USER ?? 'postgres',
          password: config?.password ?? process.env.DB_PASSWORD ?? 'postgres',
          database: config?.database ?? process.env.DB_NAME ?? 'corp_check',
          ssl:
            config?.ssl ??
            (process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined),
          max: config?.max ?? 10,
          statement_timeout: statementTimeout,
        },
  );

  const db = drizzle(pool, { schema });
  return { pool, db };
}

export function getDbClient(connStr?: string): { pool: pg.Pool; db: DbClient } {
  if (!cachedPool || !cachedDb) {
    const targetConnStr = connStr ?? process.env.DATABASE_URL;
    const client = createDbClient(targetConnStr ? { connectionString: targetConnStr } : undefined);
    cachedPool = client.pool;
    cachedDb = client.db;
  }
  return { pool: cachedPool, db: cachedDb };
}

export function getDb(connStr?: string): DbClient {
  return getDbClient(connStr).db;
}

export async function closeDbClient(): Promise<void> {
  if (cachedPool) {
    await cachedPool.end();
    cachedPool = undefined;
    cachedDb = undefined;
  }
}
