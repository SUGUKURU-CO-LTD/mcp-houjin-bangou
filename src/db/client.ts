/**
 * PostgreSQL Database Client & Drizzle Instance
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1 (ホスト版データベース接続)
 *   Linear SLA2-324:
 *     - 検索の上限時間（statement_timeout 5000ms）と取り込み用の接続を分離（取り込み用はタイムアウトを外す/0）
 *     - 本番環境（NODE_ENV=production）で接続設定がない場合は起動時にエラーで停止
 *     - DB_SSL 時に rejectUnauthorized: false は使用しない
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

let cachedIngestPool: pg.Pool | undefined;
let cachedIngestDb: DbClient | undefined;

/**
 * PostgreSQL プール接続設定の解決
 */
function resolvePoolConfig(config?: DbConfig, forIngest = false): pg.PoolConfig {
  const isProd = process.env.NODE_ENV === 'production';
  const connStr = config?.connectionString ?? process.env.DATABASE_URL;

  if (
    isProd &&
    !connStr &&
    (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD)
  ) {
    throw new Error(
      'Database configuration error: In production, DATABASE_URL or (DB_HOST, DB_USER, DB_PASSWORD) must be explicitly specified.',
    );
  }

  // 取り込み用は既定 0（タイムアウト無制限）、検索用は既定 5000ms
  const statementTimeout =
    config?.statementTimeoutMs ??
    (forIngest
      ? process.env.DB_INGEST_TIMEOUT_MS
        ? parseInt(process.env.DB_INGEST_TIMEOUT_MS, 10)
        : 0
      : process.env.DB_STATEMENT_TIMEOUT_MS
        ? parseInt(process.env.DB_STATEMENT_TIMEOUT_MS, 10)
        : 5000);

  // SSL設定: rejectUnauthorized: false は使用せず、安全なTLS検証を有効化
  const ssl = config?.ssl ?? (process.env.DB_SSL === 'true' ? true : undefined);

  if (connStr) {
    return {
      connectionString: connStr,
      max: config?.max ?? (forIngest ? 2 : 10),
      statement_timeout: statementTimeout,
      ssl,
    };
  }

  return {
    host: config?.host ?? process.env.DB_HOST ?? 'localhost',
    port: config?.port ?? (process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432),
    user: config?.user ?? process.env.DB_USER ?? 'postgres',
    password: config?.password ?? process.env.DB_PASSWORD ?? 'postgres',
    database: config?.database ?? process.env.DB_NAME ?? 'corp_check',
    ssl,
    max: config?.max ?? (forIngest ? 2 : 10),
    statement_timeout: statementTimeout,
  };
}

/**
 * 検索用 DB クライアント作成（statement_timeout: 5000ms 既定）
 */
export function createDbClient(config?: DbConfig): { pool: pg.Pool; db: DbClient } {
  const poolConfig = resolvePoolConfig(config, false);
  const pool = new Pool(poolConfig);
  const db = drizzle(pool, { schema });
  return { pool, db };
}

/**
 * 取り込み専用 DB クライアント作成（statement_timeout: 0 既定・タイムアウトなし）
 */
export function createIngestDbClient(config?: DbConfig): { pool: pg.Pool; db: DbClient } {
  const poolConfig = resolvePoolConfig(config, true);
  const pool = new Pool(poolConfig);
  const db = drizzle(pool, { schema });
  return { pool, db };
}

/**
 * 検索用 DB クライアント（シングルトンキャッシュ）
 */
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

/**
 * 取り込み用 DB クライアント（シングルトンキャッシュ）
 */
export function getIngestDbClient(connStr?: string): { pool: pg.Pool; db: DbClient } {
  if (!cachedIngestPool || !cachedIngestDb) {
    const targetConnStr = connStr ?? process.env.DATABASE_URL;
    const client = createIngestDbClient(
      targetConnStr ? { connectionString: targetConnStr } : undefined,
    );
    cachedIngestPool = client.pool;
    cachedIngestDb = client.db;
  }
  return { pool: cachedIngestPool, db: cachedIngestDb };
}

export function getIngestDb(connStr?: string): DbClient {
  return getIngestDbClient(connStr).db;
}

export async function closeDbClient(): Promise<void> {
  if (cachedPool) {
    await cachedPool.end();
    cachedPool = undefined;
    cachedDb = undefined;
  }
  if (cachedIngestPool) {
    await cachedIngestPool.end();
    cachedIngestPool = undefined;
    cachedIngestDb = undefined;
  }
}
