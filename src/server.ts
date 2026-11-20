#!/usr/bin/env node
/**
 * @sugukuru/mcp-houjin-bangou - HTTP entrypoint
 *
 * Express + StreamableHTTPServerTransport (stateless mode)
 *
 * 根拠 / Source:
 *   MCP 公式 "Streamable HTTP" transport (2025-11-25) & RFC 9110 §15.5.6
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
import type { Logger } from 'pino';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getEnv } from './lib/env.js';
import { createPinoLogger } from './lib/logger.js';
import { createNtaClient, type NtaClient } from './api/nta-client.js';
import { createServer } from './mcp.js';
import { SERVER_NAME, VERSION } from './version.js';
import {
  MCP_SERVER_ID,
  PRODUCT_NAME_EN,
  PRODUCT_WEBSITE_URL,
  PUBLIC_BASE_URL,
  REPOSITORY_URL,
  SUPPORT_EMAIL,
} from './config/product.js';
import { getDb, closeDbClient } from './db/client.js';
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
import { parseTraceparent } from './lib/trace-context.js';
import {
  NTA_CORPORATE_HOST_ATTRIBUTION,
  NTA_INVOICE_HOST_ATTRIBUTION,
} from './lib/tool-response.js';

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
  openaiAppsChallengeToken?: string;
}

interface RequestWithMeta extends Request {
  id: string;
  traceId?: string;
}

const SERVER_DESCRIPTION =
  'MCP server for looking up and verifying Japanese corporate numbers and registered invoice issuers published by the National Tax Agency of Japan. Read-only, anonymous access with deterministic company-name normalization.';

export function createApp(options: CreateAppOptions = {}): Express {
  const logger =
    options.logger ??
    createPinoLogger({
      level: 'info',
    });

  const allowedOriginsSet =
    options.allowedOrigins instanceof Set
      ? options.allowedOrigins
      : parseAllowedOrigins(options.allowedOrigins ?? '');

  const trustProxyHops = options.trustProxy ?? 1;
  const rateLimitWindowMs = options.rateLimitWindowMs ?? 60_000;
  const rateLimitMaxRequests = options.rateLimitMaxRequests ?? 60;
  const openaiAppsChallengeToken =
    options.openaiAppsChallengeToken !== undefined
      ? options.openaiAppsChallengeToken
      : (process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? '');

  const app = express();
  app.disable('x-powered-by');

  // Cloud Run の前段 (Google Front End) 1段のみを信頼する設定（既定: 1ホップ）。
  app.set('trust proxy', trustProxyHops === 0 ? false : trustProxyHops);

  // ChatGPT domain verification endpoint (Linear SLA2-329)
  app.get('/.well-known/openai-apps-challenge', (_req, res) => {
    if (!openaiAppsChallengeToken || openaiAppsChallengeToken.trim() === '') {
      res.status(404).type('text/plain').send('Not Found');
      return;
    }
    res.status(200).type('text/plain').send(openaiAppsChallengeToken);
  });

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
      exposedHeaders: ['MCP-Protocol-Version', 'Mcp-Session-Id', 'Retry-After'],
    }),
  );

  app.use((req, _res, next) => {
    const reqMeta = req as RequestWithMeta;
    reqMeta.id = randomUUID();
    const rawTraceparent =
      typeof req.headers.traceparent === 'string' ? req.headers.traceparent : undefined;
    const parsedTrace = parseTraceparent(rawTraceparent);
    if (parsedTrace !== null) {
      reqMeta.traceId = parsedTrace.traceId;
    }
    next();
  });

  app.use(express.json({ limit: '64kb' }));

  // Health check
  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      version: VERSION,
      nta_api_version: 'Ver.4.0',
      timestamp: new Date().toISOString(),
    });
  });

  // Server Card (SEP-2127 + backwards-compatible discovery)
  app.get('/.well-known/mcp.json', (_req, res) => {
    res.status(200).json(buildServerCard());
  });

  // SEP-2127 AI Catalog discovery endpoint
  app.get('/.well-known/ai-catalog.json', (_req, res) => {
    res.status(200).type('application/json').json(buildAiCatalog());
  });

  const ipRateLimiter = new IpRateLimiter({
    windowMs: rateLimitWindowMs,
    maxRequests: rateLimitMaxRequests,
  });
  const ipRateLimitMiddleware = createIpRateLimitMiddleware(ipRateLimiter, () => {
    logger.warn({ event: 'ip_rate_limited' }, 'IP rate limit exceeded');
  });

  // MCP endpoint (stateless POST)
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
      const traceId = (req as RequestWithMeta).traceId;
      logger.error(
        { err, ...(traceId ? { trace_id: traceId } : {}) },
        'MCP request handling failed',
      );
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // Reject all non-POST/OPTIONS methods on /mcp in stateless mode with RFC 9110 Allow header
  app.all('/mcp', (req, res) => {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: `Method ${req.method} not allowed (stateless mode, use POST)`,
      },
      id: null,
    });
  });

  // Express error middleware (body-parser 400 / 413 + generic fallback)
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const reqMeta = req as RequestWithMeta;
    const bodyErr = err as Error & { type?: string; status?: number; statusCode?: number };
    const errType = bodyErr.type;
    const status = bodyErr.status ?? bodyErr.statusCode;

    if (errType === 'entity.parse.failed' || (err instanceof SyntaxError && status === 400)) {
      logger.warn(
        { reqId: reqMeta.id, ...(reqMeta.traceId ? { trace_id: reqMeta.traceId } : {}) },
        'invalid JSON request body',
      );
      if (!res.headersSent) {
        if (req.path === '/mcp') {
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Parse error: Invalid JSON' },
            id: null,
          });
        } else {
          res.status(400).json({ error: 'invalid_json' });
        }
      }
      return;
    }

    if (errType === 'entity.too.large' || status === 413) {
      logger.warn(
        { reqId: reqMeta.id, ...(reqMeta.traceId ? { trace_id: reqMeta.traceId } : {}) },
        'request payload too large',
      );
      if (!res.headersSent) {
        if (req.path === '/mcp') {
          res.status(413).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Payload Too Large: Request body exceeds 64kb limit',
            },
            id: null,
          });
        } else {
          res.status(413).json({ error: 'payload_too_large' });
        }
      }
      return;
    }

    logger.error(
      { err, reqId: reqMeta.id, ...(reqMeta.traceId ? { trace_id: reqMeta.traceId } : {}) },
      'unhandled error',
    );
    if (!res.headersSent) {
      res.status(500).json({ error: 'internal_error' });
    }
  });

  return app;
}

export async function bootstrap(): Promise<void> {
  const env = getEnv();

  // アプリのログはすべて標準エラー出力 (process.stderr) へ
  const logger = createPinoLogger({
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
  });

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
          userAgent: `${SERVER_NAME}/${VERSION}`,
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
    openaiAppsChallengeToken: env.OPENAI_APPS_CHALLENGE_TOKEN,
  });

  const displayHost = env.HOST === '0.0.0.0' || env.HOST === '::' ? 'localhost' : env.HOST;
  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info(
      {
        host: env.HOST,
        port: env.PORT,
        version: VERSION,
        nodeEnv: env.NODE_ENV,
        mcpEndpoint: `http://${displayHost}:${env.PORT}/mcp`,
        serverCardEndpoint: `http://${displayHost}:${env.PORT}/.well-known/mcp.json`,
      },
      `${SERVER_NAME} listening`,
    );
  });

  let shuttingDown = false;
  const handleShutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'graceful shutdown initiated');

    const forceExitTimer = setTimeout(() => {
      logger.warn({ signal }, 'graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, 10_000);
    forceExitTimer.unref();

    server.close((closeErr) => {
      if (closeErr) {
        logger.error({ err: closeErr }, 'HTTP server close error');
      }
      closeDbClient()
        .catch((dbErr: unknown) => {
          logger.error({ err: dbErr }, 'DB pool close error');
        })
        .finally(() => {
          clearTimeout(forceExitTimer);
          process.exit(closeErr ? 1 : 0);
        });
    });
  };

  process.once('SIGTERM', () => handleShutdown('SIGTERM'));
  process.once('SIGINT', () => handleShutdown('SIGINT'));
}

export function buildServerCard(): Record<string, unknown> {
  const attribution = {
    hosted: {
      corporate: NTA_CORPORATE_HOST_ATTRIBUTION,
      invoice: NTA_INVOICE_HOST_ATTRIBUTION,
      license: '公共データ利用規約 第1.0版',
    },
    self_hosted: {
      data_source: '国税庁法人番号公表サイト (https://www.houjin-bangou.nta.go.jp/)',
      license: '公共データ利用規約 第1.0版',
      api_version: 'Ver.4.0',
      service_disclaimer:
        'このサービスは、国税庁法人番号システム Web-API 機能を利用して取得した情報をもとに作成しているが、サービスの内容は国税庁によって保証されたものではない。',
    },
  };

  const maintainer = {
    name: 'SUGUKURU CO., LTD.',
    email: SUPPORT_EMAIL,
    location: 'Kagoshima, Japan',
  };

  const safety = {
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
  };

  return {
    $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
    name: MCP_SERVER_ID,
    title: PRODUCT_NAME_EN,
    version: VERSION,
    description: SERVER_DESCRIPTION,
    websiteUrl: PRODUCT_WEBSITE_URL,
    repository: {
      url: REPOSITORY_URL,
      source: 'github',
    },
    remotes: [
      {
        type: 'streamable-http',
        url: `${PUBLIC_BASE_URL}/mcp`,
        supportedProtocolVersions: ['2025-11-25'],
      },
    ],
    _meta: {
      'jp.co.sugu-kuru/houjin-bangou': {
        npmPackage: SERVER_NAME,
        attribution,
        maintainer,
        safety,
      },
    },
    protocol_version: '2025-11-25',
    homepage: REPOSITORY_URL,
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
    attribution,
    maintainer,
    license: 'MIT',
    safety,
    specs_referenced: [
      'MCP 2025-11-25',
      'SEP-2127 Server Card',
      'SEP-1303 Input Validation as Tool Errors (Final)',
      'SEP-986 Tool Name Format (Final)',
      'SEP-414 OpenTelemetry Trace Context Propagation (Final)',
    ],
    data_source_specs: [
      '国税庁 法人番号 Web-API 機能 Ver.4.0 (第一編 4.9版 / 第二編 1.2版 / 第六編 1.2版)',
      '国税庁 適格請求書発行事業者公表システム Web-API 機能・ダウンロードデータ リソース定義書 (1.5版 別紙1)',
    ],
  };
}

export function buildAiCatalog(): Record<string, unknown> {
  return {
    entries: [
      {
        type: 'application/mcp-server-card+json',
        name: MCP_SERVER_ID,
        title: PRODUCT_NAME_EN,
        description: SERVER_DESCRIPTION,
        url: `${PUBLIC_BASE_URL}/.well-known/mcp.json`,
      },
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
