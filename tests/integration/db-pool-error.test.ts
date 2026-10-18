/**
 * DB Client Pool Error Handling Integration Tests (PostgreSQL 16 実DB実行)
 *
 * 根拠 / Source:
 *   node-postgres は待機中（idle）の接続がサーバー側から切断されると、
 *   プール単位で 'error' イベントを発行する。
 *   リスナーがないと unhandled error で Node プロセスが落ちるため、
 *   createDbClient で error ハンドラを登録し、プロセス終了を防ぎつつ
 *   安全に stderr へログを出すことを検証する（Cloud SQL メンテナンスやネットワーク断に対応）。
 */

import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { createDbClient } from '../../src/db/client.js';

const { Pool } = pg;

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgres://test:test@localhost:55069/test';

describe('Database Pool Error Handling (PostgreSQL 16 実DB)', () => {
  let queryPool: pg.Pool | undefined;
  let adminPool: pg.Pool | undefined;

  afterAll(async () => {
    if (queryPool) {
      await queryPool.end();
    }
    if (adminPool) {
      await adminPool.end();
    }
  });

  it('待機中の接続を別接続から pg_terminate_backend で切断しても、プロセスが落ちず error イベント処理が呼ばれること', async () => {
    // 1. createDbClient でプールを作成
    const client = createDbClient({ connectionString: TEST_DB_URL, max: 2 });
    const targetPool = client.pool;
    queryPool = targetPool;

    // 2. 切断実行用の別プール
    adminPool = new Pool({ connectionString: TEST_DB_URL, max: 1 });

    // 3. プールから接続を1本取得し、PID を取得して待機状態（release）に戻す
    const poolConn = await targetPool.connect();
    const pidRes = await poolConn.query<{ pid: number }>('SELECT pg_backend_pid() AS pid;');
    const backendPid = pidRes.rows[0]?.pid;
    expect(backendPid).toBeDefined();

    poolConn.release(); // 待機中（idle）接続にする

    // 4. stderr への書き込みと pool の error イベントをキャプチャする準備
    const stderrChunks: string[] = [];
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = ((chunk: unknown, ..._args: unknown[]) => {
      if (typeof chunk === 'string') {
        stderrChunks.push(chunk);
      } else if (Buffer.isBuffer(chunk)) {
        stderrChunks.push(chunk.toString('utf-8'));
      }
      return true;
    }) as typeof process.stderr.write;

    const errorPromise = new Promise<Error>((resolve) => {
      targetPool.once('error', (err) => {
        resolve(err);
      });
    });

    try {
      // 5. 別接続から待機中の接続を強制切断 (pg_terminate_backend)
      const terminateRes = await adminPool.query<{ pg_terminate_backend: boolean }>(
        'SELECT pg_terminate_backend($1);',
        [backendPid],
      );
      expect(terminateRes.rows[0]?.pg_terminate_backend).toBe(true);

      // 6. errorPromise の解決またはタイムアウト待機（切断パケット受信待ち）
      const receivedErr = await Promise.race([
        errorPromise,
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout waiting for pool error event')), 5000),
        ),
      ]);

      // 7. 検証:
      // - error イベントが発火したこと
      expect(receivedErr).toBeDefined();
      expect((receivedErr as Error).message).toMatch(/terminating connection/i);

      // - attachPoolErrorHandler による stderr ログが出力されたこと
      const logLine = stderrChunks.find((c) => c.includes('"logger":"db_pool"'));
      expect(logLine).toBeDefined();
      if (logLine) {
        const parsed = JSON.parse(logLine.trim());
        expect(parsed.level).toBe('error');
        expect(parsed.logger).toBe('db_pool');
        expect(parsed.pool_type).toBe('query');
        expect(parsed.error_message).toMatch(/terminating connection/i);
        // パスワードや接続文字列がログに含まれないこと
        expect(logLine).not.toContain(TEST_DB_URL);
        expect(logLine).not.toContain('password');
      }

      // - プロセスが落ちておらず、新しいクエリが正常に実行できること（プールの再接続と生存性）
      const aliveRes = await queryPool.query('SELECT 1 as alive;');
      expect(aliveRes.rows[0]?.alive).toBe(1);
    } finally {
      process.stderr.write = originalStderrWrite;
    }
  });
});
