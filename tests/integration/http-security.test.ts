import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { createApp, buildServerCard } from '../../src/server.js';
import {
  IpRateLimiter,
  normalizeOrigin,
  parseAllowedOrigins,
} from '../../src/lib/http-security.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

async function startTestServer(options: Parameters<typeof createApp>[0]): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = createApp({ ...options, logger: silentLogger });
  const server: Server = await new Promise((resolveServer) => {
    const s = app.listen(0, '127.0.0.1', () => resolveServer(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((err) => (err ? rejectClose(err) : resolveClose()));
      }),
  };
}

describe('SLA2-327 (PR A): Origin検証・IPレート制限・capabilities・Server Card・DBロール分離', () => {
  describe('1. Origin 検証 (MCP Streamable HTTP 仕様 MUST)', () => {
    let baseUrl = '';
    let closeServer: () => Promise<void>;

    beforeAll(async () => {
      const started = await startTestServer({
        allowedOrigins: 'https://claude.ai, https://chatgpt.com/',
        rateLimitMaxRequests: 100,
      });
      baseUrl = started.baseUrl;
      closeServer = started.close;
    });

    afterAll(async () => {
      await closeServer();
    });

    it('normalizeOrigin / parseAllowedOrigins が末尾スラッシュや大文字小文字を正規化する', () => {
      expect(normalizeOrigin('HTTPS://Claude.AI/')).toBe('https://claude.ai');
      expect(normalizeOrigin('null')).toBe('');
      expect(normalizeOrigin('not-a-url')).toBe('');
      const set = parseAllowedOrigins('https://claude.ai/, https://chatgpt.com , ');
      expect(set.has('https://claude.ai')).toBe(true);
      expect(set.has('https://chatgpt.com')).toBe(true);
    });

    it('Origin ヘッダーが無いリクエスト（サーバー間通信・CLI・ヘルスチェック）は許可される', async () => {
      const healthRes = await fetch(`${baseUrl}/health`);
      expect(healthRes.status).toBe(200);

      const mcpRes = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'test-cli', version: '1.0.0' },
          },
        }),
      });
      expect(mcpRes.status).toBe(200);
    });

    it('ALLOWED_ORIGINS に含まれる Origin ヘッダーは許可される', async () => {
      const mcpRes = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          Origin: 'https://claude.ai',
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'browser-client', version: '1.0.0' },
          },
        }),
      });
      expect(mcpRes.status).toBe(200);
      expect(mcpRes.headers.get('access-control-allow-origin')).toBe('https://claude.ai');
    });

    it('ALLOWED_ORIGINS に含まれない不正な Origin ヘッダーはすべてのエンドポイントで HTTP 403 を返す', async () => {
      for (const badOrigin of ['https://evil.example.com', 'http://localhost:9999', 'null']) {
        const mcpRes = await fetch(`${baseUrl}/mcp`, {
          method: 'POST',
          headers: {
            Origin: badOrigin,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }),
        });
        expect(mcpRes.status).toBe(403);
        const body = (await mcpRes.json()) as { error?: { message?: string } };
        expect(body.error?.message).toContain('Forbidden: Origin not allowed');

        const healthRes = await fetch(`${baseUrl}/health`, {
          headers: { Origin: badOrigin },
        });
        expect(healthRes.status).toBe(403);

        const optionsRes = await fetch(`${baseUrl}/mcp`, {
          method: 'OPTIONS',
          headers: {
            Origin: badOrigin,
            'Access-Control-Request-Method': 'POST',
          },
        });
        expect(optionsRes.status).toBe(403);
      }
    });
  });

  describe('2. レート制限（IP単位）と偽の X-Forwarded-For による回避防止', () => {
    it('Cloud Run (trust proxy = 1) 環境で、偽の X-Forwarded-For を毎回変えてもレート制限を回避できない', async () => {
      // Cloud Run の前段 GFE (Google Front End) は、クライアントが送った X-Forwarded-For の末尾に
      // 実際のクライアント IP (ここでは 203.0.113.50) を追記してコンテナへ転送する。
      // Express の trust proxy = 1 は末尾から1ホップ手前の 203.0.113.50 を req.ip として採用し、
      // クライアントが偽装した先頭の IP (198.51.100.x) を無視する。
      const started = await startTestServer({
        trustProxy: 1,
        rateLimitWindowMs: 60_000,
        rateLimitMaxRequests: 3,
      });

      try {
        const sendWithSpoofedXff = async (spoofedIp: string, realClientIp = '203.0.113.50') => {
          return fetch(`${started.baseUrl}/mcp`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json, text/event-stream',
              // クライアントが偽装した spoofedIp の後ろに、GFE が実際のクライアント IP を付与した状態を再現
              'X-Forwarded-For': `${spoofedIp}, ${realClientIp}`,
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {
                protocolVersion: '2025-11-25',
                capabilities: {},
                clientInfo: { name: 'rate-limit-test', version: '1.0.0' },
              },
            }),
          });
        };

        // 毎回異なる偽の X-Forwarded-For 先頭 IP を送る（1〜3回目は上限3以内なので 200）
        const r1 = await sendWithSpoofedXff('198.51.100.1');
        const r2 = await sendWithSpoofedXff('198.51.100.2');
        const r3 = await sendWithSpoofedXff('198.51.100.3');
        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);
        expect(r3.status).toBe(200);

        // 4回目: 別の偽 IP (198.51.100.99) を送っても、実クライアント IP (203.0.113.50) が同一のため HTTP 429 で拒否される
        const r4 = await sendWithSpoofedXff('198.51.100.99');
        expect(r4.status).toBe(429);
        expect(Number(r4.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
        const errBody = (await r4.json()) as {
          error?: { data?: { error_code?: string; retryable?: boolean } };
        };
        expect(errBody.error?.data?.error_code).toBe('RATE_LIMITED');
        expect(errBody.error?.data?.retryable).toBe(true);

        // 別の実クライアント IP (203.0.113.51) からのリクエストは通過する
        const otherClientRes = await sendWithSpoofedXff('198.51.100.1', '203.0.113.51');
        expect(otherClientRes.status).toBe(200);
      } finally {
        await started.close();
      }
    });

    it('プロキシ無し直結 (trust proxy = 0) 環境でも、偽の X-Forwarded-For を毎回変えてもレート制限を回避できない', async () => {
      const started = await startTestServer({
        trustProxy: 0,
        rateLimitWindowMs: 60_000,
        rateLimitMaxRequests: 2,
      });

      try {
        const sendDirectWithSpoofedXff = async (spoofedIp: string) => {
          return fetch(`${started.baseUrl}/mcp`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json, text/event-stream',
              'X-Forwarded-For': spoofedIp,
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {
                protocolVersion: '2025-11-25',
                capabilities: {},
                clientInfo: { name: 'direct-test', version: '1.0.0' },
              },
            }),
          });
        };

        expect((await sendDirectWithSpoofedXff('10.0.0.1')).status).toBe(200);
        expect((await sendDirectWithSpoofedXff('10.0.0.2')).status).toBe(200);

        // 3回目: 偽の X-Forwarded-For を変えてもソケット IP (127.0.0.1) で判定されるため 429 になる
        const r3 = await sendDirectWithSpoofedXff('10.0.0.3');
        expect(r3.status).toBe(429);
      } finally {
        await started.close();
      }
    });

    it('IpRateLimiter がウィンドウ経過後にカウントをリセットする', () => {
      const limiter = new IpRateLimiter({ windowMs: 1000, maxRequests: 2 });
      expect(limiter.consume('203.0.113.1', 1000).allowed).toBe(true);
      expect(limiter.consume('203.0.113.1', 1500).allowed).toBe(true);
      const blocked = limiter.consume('203.0.113.1', 1800);
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterSeconds).toBe(1);

      // ウィンドウ経過後 (t=2001) は再び許可される
      expect(limiter.consume('203.0.113.1', 2001).allowed).toBe(true);
    });
  });

  describe('3. capabilities の listChanged: false と Server Card (/.well-known/mcp.json) の整合性', () => {
    let baseUrl = '';
    let closeServer: () => Promise<void>;

    beforeAll(async () => {
      const started = await startTestServer({});
      baseUrl = started.baseUrl;
      closeServer = started.close;
    });

    afterAll(async () => {
      await closeServer();
    });

    it('MCP initialize レスポンスの capabilities で listChanged がすべて false であり、logging が含まれない', async () => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 10,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'cap-checker', version: '1.0.0' },
          },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result: {
          capabilities: {
            tools?: { listChanged?: boolean };
            resources?: { listChanged?: boolean; subscribe?: boolean };
            prompts?: { listChanged?: boolean };
            logging?: unknown;
          };
        };
      };
      expect(body.result.capabilities.tools).toEqual({ listChanged: false });
      expect(body.result.capabilities.resources).toEqual({
        listChanged: false,
        subscribe: false,
      });
      expect(body.result.capabilities.prompts).toEqual({ listChanged: false });
      expect(body.result.capabilities.logging).toBeUndefined();
    });

    it('MCP initialize レスポンスの instructions に、利用制限と税務免責の日英各2文が含まれること (SLA2-329)', async () => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 11,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'instructions-checker', version: '1.0.0' },
          },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result: {
          instructions?: string;
        };
      };
      const instructions = body.result.instructions ?? '';
      // 日本語 2文
      expect(instructions).toContain(
        'lookup_invoice_issuer は、利用者が示した登録番号を1件ずつ確かめるためのものです。番号の範囲を順に照会したり、登録事業者の一覧を作ったりする用途（法人に限った一覧を含む）には使わないでください。',
      );
      expect(instructions).toContain(
        '仕入税額控除を受けられるかを尋ねられたときは、登録の事実だけを示し、控除の可否はほかの要件にもよるため、税理士や税務署に確認するよう案内してください。',
      );
      // 英語 2文
      expect(instructions).toContain(
        'Use lookup_invoice_issuer only to check registration numbers that the user explicitly provides, one at a time. Do not iterate over number ranges or compile lists of registered issuers, including lists limited to corporations.',
      );
      expect(instructions).toContain(
        'When asked whether an input tax credit can be claimed, state only the registration facts and explain that eligibility depends on other requirements; suggest consulting a tax accountant or the tax office.',
      );
    });

    it('GET /.well-known/mcp.json と .well-known/mcp.json ファイルが一致し、最新のツール・プロンプト・リソース・連絡先を反映している', async () => {
      const res = await fetch(`${baseUrl}/.well-known/mcp.json`);
      expect(res.status).toBe(200);
      const httpCard = (await res.json()) as Record<string, unknown>;

      const filePath = resolve(process.cwd(), '.well-known/mcp.json');
      const fileCard = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;

      expect(httpCard).toEqual(fileCard);
      expect(httpCard).toEqual(buildServerCard());

      // 個別要件の検証
      expect(httpCard['homepage']).toBe('https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou');
      expect(String(httpCard['description'])).not.toContain('7-primitive');

      const auth = httpCard['authentication'] as { required: boolean; note: string };
      expect(auth.required).toBe(false);
      expect(auth.note).not.toContain('OAuth');
      expect(auth.note).not.toContain('SEP-990');

      const caps = httpCard['capabilities'] as Record<string, unknown>;
      expect(caps['tools']).toEqual({ listChanged: false });
      expect(caps['resources']).toEqual({ listChanged: false, subscribe: false });
      expect(caps['prompts']).toEqual({ listChanged: false });
      expect(caps['logging']).toBeUndefined();

      const primitives = httpCard['primitives'] as {
        tools: string[];
        prompts: string[];
        resource_templates: string[];
        resources: string[];
      };
      expect(primitives.tools).toEqual([
        'lookup_corporate_by_number',
        'search_corporate_by_name',
        'lookup_invoice_issuer',
        'validate_corporate_number',
        'normalize_company_name',
      ]);
      expect(primitives.prompts).toEqual([
        'company-master-record',
        'sales-list-enrichment',
        'customer-master-dedup',
      ]);
      expect(primitives.resource_templates).toEqual([]);
      expect(primitives.resources).toEqual([
        'ui://corporate-card/mcp-app.html',
        'ui://search-results/mcp-app.html',
      ]);

      const maintainer = httpCard['maintainer'] as { email: string };
      expect(maintainer.email).toBe('info@sugu-kuru.co.jp');
    });
  });

  describe.skipIf(!process.env['DATABASE_URL'])(
    '4. 実 DB (PostgreSQL 16) における 3ロール分離 (houjin_admin / houjin_ingest / houjin_reader) の検証',
    () => {
      let adminPool: pg.Pool;
      let roleTestPool: pg.Pool;
      const isolatedDbName = 'test_roles_sla2_327';

      beforeAll(async () => {
        const baseDbUrl = process.env['DATABASE_URL'] ?? '';
        adminPool = new pg.Pool({ connectionString: baseDbUrl });
        await adminPool.query(`DROP DATABASE IF EXISTS ${isolatedDbName}`);
        await adminPool.query(`CREATE DATABASE ${isolatedDbName}`);

        const parsedUrl = new URL(baseDbUrl);
        parsedUrl.pathname = `/${isolatedDbName}`;
        roleTestPool = new pg.Pool({ connectionString: parsedUrl.toString() });

        // 1. Drizzle マイグレーション (0000〜0003) を適用
        const drizzleDir = resolve(process.cwd(), 'drizzle');
        const migrationFiles = readdirSync(drizzleDir)
          .filter((f) => f.endsWith('.sql'))
          .sort();
        for (const migrationFile of migrationFiles) {
          const sqlText = readFileSync(resolve(drizzleDir, migrationFile), 'utf8');
          const statements = sqlText
            .split('--> statement-breakpoint')
            .map((s) => s.trim())
            .filter(Boolean);
          for (const stmt of statements) {
            await roleTestPool.query(stmt);
          }
        }

        // 2. docs/deployment/db-roles.sql を適用
        const rolesSql = readFileSync(
          resolve(process.cwd(), 'docs/deployment/db-roles.sql'),
          'utf8',
        );
        await roleTestPool.query(rolesSql);
      });

      afterAll(async () => {
        if (roleTestPool) {
          await roleTestPool.end();
        }
        if (adminPool) {
          await adminPool.query(`DROP DATABASE IF EXISTS ${isolatedDbName}`);
          await adminPool.end();
        }
      });

      it('houjin_ingest で _new 作成と RENAME 入れ替えができ、入れ替え後も houjin_reader は SELECT のみ可能で書き込み・DDL は拒否される', async () => {
        const client = await roleTestPool.connect();
        try {
          // 1. houjin_ingest ロールに切り替えて dataset_versions 登録と RENAME 入れ替え相当の操作を実行
          await client.query('SET ROLE houjin_ingest');

          // dataset_versions の DELETE や DROP TABLE は houjin_ingest でも拒否されること
          await expect(
            client.query("DELETE FROM public.dataset_versions WHERE source_type = '__never__'"),
          ).rejects.toThrow(/permission denied/);
          await expect(client.query('DROP TABLE public.dataset_versions')).rejects.toThrow(
            /must be owner of table dataset_versions/,
          );

          // dataset_versions への INSERT と UPDATE は成功すること
          const verInsert = await client.query<{ id: number }>(
            "INSERT INTO public.dataset_versions (source_type, data_as_of, status, record_count) VALUES ('nta_corporate_download', '2026-10-15', 'active', 1) RETURNING id",
          );
          const versionId = verInsert.rows[0]?.id ?? 0;

          // corporate_numbers の _new 作成 → FK 追加 → RENAME 入れ替え → _old 削除 が成功すること
          await client.query('DROP TABLE IF EXISTS public.corporate_numbers_new');
          await client.query(
            'CREATE TABLE public.corporate_numbers_new (LIKE public.corporate_numbers INCLUDING DEFAULTS)',
          );
          await client.query(
            `INSERT INTO public.corporate_numbers_new (corporate_number, update_date, name, kind, dataset_version_id) VALUES ('5111101000006', '2026-10-15', 'スグクル株式会社', '301', $1)`,
            [versionId],
          );
          await client.query(
            'ALTER TABLE public.corporate_numbers_new ADD PRIMARY KEY (corporate_number, dataset_version_id)',
          );
          await client.query(
            'ALTER TABLE public.corporate_numbers_new ADD CONSTRAINT corporate_numbers_dataset_version_id_fk FOREIGN KEY (dataset_version_id) REFERENCES public.dataset_versions(id)',
          );
          await client.query('BEGIN');
          await client.query('DROP TABLE IF EXISTS public.corporate_numbers_old');
          await client.query(
            'ALTER TABLE public.corporate_numbers RENAME TO corporate_numbers_old',
          );
          await client.query(
            'ALTER TABLE public.corporate_numbers_new RENAME TO corporate_numbers',
          );
          await client.query('DROP TABLE public.corporate_numbers_old');
          await client.query('COMMIT');
          await client.query('ANALYZE public.corporate_numbers');

          // 2. houjin_reader ロールに切り替えて検証
          await client.query('SET ROLE houjin_reader');

          // RENAME 入れ替え後の新テーブルに対しても ALTER DEFAULT PRIVILEGES により SELECT が成功すること
          const corpSelect = await client.query<{ cnt: number }>(
            'SELECT count(*)::int AS cnt FROM public.corporate_numbers',
          );
          expect(corpSelect.rows[0]?.cnt).toBe(1);

          const invSelect = await client.query<{ cnt: number }>(
            'SELECT count(*)::int AS cnt FROM public.invoice_issuers',
          );
          expect(invSelect.rows[0]?.cnt).toBe(0);

          const verSelect = await client.query<{ cnt: number }>(
            'SELECT count(*)::int AS cnt FROM public.dataset_versions',
          );
          expect(verSelect.rows[0]?.cnt).toBe(1);

          // houjin_reader からの書き込み・DDL はすべて拒否されること
          await expect(client.query('DELETE FROM public.corporate_numbers')).rejects.toThrow(
            /permission denied/,
          );
          await expect(client.query('DELETE FROM public.invoice_issuers')).rejects.toThrow(
            /permission denied/,
          );
          await expect(
            client.query(
              "INSERT INTO public.dataset_versions (source_type, data_as_of, status, record_count) VALUES ('nta_corporate_download', '2026-10-15', 'staging', 0)",
            ),
          ).rejects.toThrow(/permission denied/);
          await expect(client.query('CREATE TABLE public.evil_table (id int)')).rejects.toThrow(
            /permission denied/,
          );
          await expect(client.query('DROP TABLE public.corporate_numbers')).rejects.toThrow(
            /must be owner of table|permission denied/,
          );
        } finally {
          await client.query('RESET ROLE');
          client.release();
        }
      });
    },
  );
});
