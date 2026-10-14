#!/usr/bin/env node
/**
 * @sugukuru/mcp-houjin-bangou - HTTP entrypoint
 *
 * Express + StreamableHTTPServerTransport (stateless mode)
 *
 * 根拠 / Source:
 *   MCP 公式 "Streamable HTTP" transport
 *   Transport WG (Dec 2025) stateless direction
 *   国税庁 Web-API 仕様書 第一編 §5 (アプリケーションID)
 *   実装指示書v1 §3, §5(B1, B6) / Linear SLA2-327 (PR A):
 *     - アプリのログはすべて標準エラー出力（stderr）へ
 *     - Logging capability宣言を外す
 *     - アクセスログに入力された法人番号・登録番号・検索語を残さない
 *     - すべての接続で Origin ヘッダーを検証し、不正な Origin は HTTP 403 を返す
 *     - Cloud Run 前段に合わせた trust proxy 設定と IP 単位レート制限
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino, { type Logger } from 'pino';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getEnv } from './lib/env.js';
import { createNtaClient, type NtaClient } from './api/nta-client.js';
import { createServer } from './mcp.js';
import { VERSION } from './version.js';
import { SUPPORT_EMAIL } from './config/product.js';
import { getDb } from './db/client.js';
import { DbCorporateDataProvider } from './repository/corporate-repository.js';
import { DbInvoiceDataProvider } from './repository/invoice-repository.js';
import type { DataSourceMode } from './domain/tool-annotations.js';
import {
  parseAllowedOrigins,
  normalizeOrigin,
  createOriginValidationMiddleware,
  IpRateLimiter,
  createIpRateLimitMiddleware,
} from './lib/http-security.js';

export interface CreateAppOptions {
  logger?: Logger;
  ntaClient?: NtaClient;
  dbProvider?: DbCorporateDataProvider;
  invoiceDbProvider?: DbInvoiceDataProvider;
  dataSource?: DataSourceMode;
  allowedOrigins?: string | Set<string>;
  trustProxy?: number;
  rateLimitWindowMs?: number;
  rateLimitMaxRequests?: number;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const logger =
    options.logger ??
    pino(
      {
        level: 'info',
        formatters: {
          level: (label) => ({ level: label }),
        },
      },
      process.stderr,
    );

  const allowedOriginsSet =
    options.allowedOrigins instanceof Set
      ? options.allowedOrigins
      : parseAllowedOrigins(options.allowedOrigins ?? '');

  const trustProxyHops = options.trustProxy ?? 1;
  const rateLimitWindowMs = options.rateLimitWindowMs ?? 60_000;
  const rateLimitMaxRequests = options.rateLimitMaxRequests ?? 60;

  const app = express();
  app.disable('x-powered-by');

  // Cloud Run の前段 (Google Front End) 1段のみを信頼する設定（既定: 1ホップ）。
  // true（全ホップ信頼）にするとクライアントが偽装した X-Forwarded-For の先頭要素を信じてしまうため、
  // 必ずホップ数（1）または 0（false: 直結時）を指定して偽装ヘッダーによるレート制限回避を防ぐ。
  app.set('trust proxy', trustProxyHops === 0 ? false : trustProxyHops);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          connectSrc: ["'self'"],
          baseUri: ["'self'"],
          formAction: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );

  // MCP Streamable HTTP 仕様 MUST: すべての接続で Origin ヘッダーを検証する。
  // Origin ヘッダーが無いリクエスト（ホストのサーバー間通信・CLI・ヘルスチェック）は許可し、
  // Origin ヘッダーがあり ALLOWED_ORIGINS に含まれない場合は HTTP 403 を返す。
  app.use(createOriginValidationMiddleware(allowedOriginsSet));

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        const normalized = normalizeOrigin(origin);
        callback(null, allowedOriginsSet.has(normalized));
      },
      credentials: false,
    }),
  );

  app.use(express.json({ limit: '64kb' }));
  app.use((req, _res, next) => {
    (req as Request & { id: string }).id = randomUUID();
    next();
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      version: VERSION,
      nta_api_version: 'Ver.4.0',
      timestamp: new Date().toISOString(),
    });
  });

  // Server Card (SEP-2127 Draft + Transport WG Dec 2025)
  app.get('/.well-known/mcp.json', (_req, res) => {
    res.status(200).json(buildServerCard());
  });

  const ipRateLimiter = new IpRateLimiter({
    windowMs: rateLimitWindowMs,
    maxRequests: rateLimitMaxRequests,
  });
  const ipRateLimitMiddleware = createIpRateLimitMiddleware(ipRateLimiter, () => {
    logger.warn({ event: 'ip_rate_limited' }, 'IP rate limit exceeded');
  });

  // MCP endpoint
  app.post('/mcp', ipRateLimitMiddleware, async (req, res) => {
    try {
      const mcpServer = createServer({
        ntaClient: options.ntaClient,
        dbProvider: options.dbProvider,
        invoiceDbProvider: options.invoiceDbProvider,
        dataSource: options.dataSource,
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void transport.close();
        void mcpServer.close();
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error({ err }, 'MCP request handling failed');
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // Reject GET /mcp and DELETE /mcp in stateless mode
  app.get('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed (stateless mode, use POST)' },
      id: null,
    });
  });

  app.delete('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed (stateless mode)' },
      id: null,
    });
  });

  // Generic error handler
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err, reqId: (req as Request & { id: string }).id }, 'unhandled error');
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error' });
    }
  });

  return app;
}

export async function bootstrap(): Promise<void> {
  const env = getEnv();

  // アプリのログはすべて標準エラー出力 (process.stderr) へ
  const logger = pino(
    {
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-api-key"]',
          'req.query.id',
          'NTA_APPLICATION_ID',
        ],
        censor: '***REDACTED***',
      },
      formatters: {
        level: (label) => ({ level: label }),
      },
    },
    process.stderr,
  );

  let dbProvider: DbCorporateDataProvider | undefined;
  let invoiceDbProvider: DbInvoiceDataProvider | undefined;
  if (env.DATA_SOURCE === 'db') {
    const db = getDb(env.DATABASE_URL);
    dbProvider = new DbCorporateDataProvider(db);
    invoiceDbProvider = new DbInvoiceDataProvider(db);
  }

  const ntaClient =
    env.DATA_SOURCE === 'web-api' && env.NTA_APPLICATION_ID
      ? createNtaClient({
          applicationId: env.NTA_APPLICATION_ID,
          baseUrl: env.NTA_BASE_URL,
          timeoutMs: env.NTA_TIMEOUT_MS,
          rps: env.NTA_RATE_LIMIT_RPS,
          userAgent: `@sugukuru/mcp-houjin-bangou/${VERSION}`,
          onBackoff: (waitMs) => {
            logger.warn({ waitMs }, 'NTA API rate limit hit, backoff applied');
          },
        })
      : undefined;

  const app = createApp({
    logger,
    ntaClient,
    dbProvider,
    invoiceDbProvider,
    dataSource: env.DATA_SOURCE,
    allowedOrigins: env.ALLOWED_ORIGINS,
    trustProxy: env.TRUST_PROXY,
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
    rateLimitMaxRequests: env.RATE_LIMIT_MAX_REQUESTS,
  });

  app.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        version: VERSION,
        nodeEnv: env.NODE_ENV,
        mcpEndpoint: `http://localhost:${env.PORT}/mcp`,
        serverCardEndpoint: `http://localhost:${env.PORT}/.well-known/mcp.json`,
      },
      '@sugukuru/mcp-houjin-bangou listening',
    );
  });
}

export function buildServerCard(): Record<string, unknown> {
  return {
    name: '@sugukuru/mcp-houjin-bangou',
    version: VERSION,
    description:
      'MCP server for looking up and verifying Japanese corporate numbers and registered invoice issuers published by the National Tax Agency of Japan. Read-only, anonymous access with deterministic company-name normalization.',
    protocol_version: '2025-11-25',
    homepage: 'https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou',
    transport: {
      type: 'streamable-http',
      endpoint: '/mcp',
      stateless: true,
    },
    authentication: {
      required: false,
      note: 'Anonymous read-only access.',
    },
    capabilities: {
      tools: { listChanged: false },
      resources: { listChanged: false, subscribe: false },
      prompts: { listChanged: false },
      completions: {},
    },
    primitives: {
      tools: [
        'lookup_corporate_by_number',
        'search_corporate_by_name',
        'lookup_invoice_issuer',
        'validate_corporate_number',
        'normalize_company_name',
      ],
      prompts: ['company-master-record', 'sales-list-enrichment', 'customer-master-dedup'],
      resource_templates: [],
      resources: ['ui://corporate-card/mcp-app.html', 'ui://search-results/mcp-app.html'],
    },
    attribution: {
      data_source: '国税庁法人番号公表サイト (https://www.houjin-bangou.nta.go.jp/)',
      license: '公共データ利用規約 第1.0版',
      api_version: 'Ver.4.0',
      service_disclaimer:
        'このサービスは、国税庁法人番号システム Web-API 機能を利用して取得した情報をもとに作成しているが、サービスの内容は国税庁によって保証されたものではない。',
    },
    maintainer: {
      name: 'Sugukuru K.K.',
      email: SUPPORT_EMAIL,
      location: 'Kagoshima, Japan',
    },
    license: 'MIT',
    // プロンプトインジェクション防御メタデータ
    safety: {
      read_only: true,
      destructive_operations: [],
      prompt_injection_mitigations: [
        'static_tool_descriptions',
        'no_runtime_schema_mutation',
        'application_id_only_from_env',
        'attribution_required_on_all_outputs',
        'zod_strict_additional_properties_false',
        'ci_grep_for_hidden_instructions',
      ],
    },
    specs_referenced: [
      'MCP 2025-11-25',
      'SEP-2127 Server Card (Draft)',
      'SEP-1303 Input Validation as Tool Errors (Final)',
      'SEP-986 Tool Name Format (Final)',
      'SEP-414 OpenTelemetry Trace Context Propagation (Final)',
      'RFC 5424 Syslog Protocol',
    ],
    data_source_specs: [
      '国税庁 法人番号 Web-API 機能 Ver.4.0 (第一編 4.9版 / 第二編 1.2版 / 第六編 1.2版)',
      '国税庁 適格請求書発行事業者公表システム Web-API 機能・ダウンロードデータ リソース定義書 (1.5版 別紙1)',
    ],
  };
}

export function checkIsMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    const scriptPath = realpathSync(process.argv[1]);
    const currentPath = realpathSync(fileURLToPath(import.meta.url));
    return scriptPath === currentPath;
  } catch {
    return false;
  }
}

if (checkIsMainModule()) {
  bootstrap().catch((err) => {
    process.stderr.write(`bootstrap failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}
