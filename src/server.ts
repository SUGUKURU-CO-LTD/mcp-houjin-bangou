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
 *   実装指示書v1 §3, §5(B1):
 *     - アプリのログはすべて標準エラー出力（stderr）へ
 *     - Logging capability宣言を外す
 *     - アクセスログに入力された法人番号・登録番号・検索語を残さない
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { getEnv } from './lib/env.js';
import { createNtaClient } from './api/nta-client.js';
import { createServer } from './mcp.js';
import { VERSION } from './version.js';

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

  const ntaClient = createNtaClient({
    applicationId: env.NTA_APPLICATION_ID,
    baseUrl: env.NTA_BASE_URL,
    timeoutMs: env.NTA_TIMEOUT_MS,
    rps: env.NTA_RATE_LIMIT_RPS,
    userAgent: `@sugukuru/mcp-houjin-bangou/${VERSION}`,
    onBackoff: (waitMs) => {
      logger.warn({ waitMs }, 'NTA API rate limit hit, backoff applied');
    },
  });

  const app = express();
  app.disable('x-powered-by');
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
  app.use(cors({ origin: true, credentials: false }));
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

  // MCP endpoint
  app.post('/mcp', async (req, res) => {
    try {
      const mcpServer = createServer({ ntaClient });
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

function buildServerCard(): object {
  return {
    name: '@sugukuru/mcp-houjin-bangou',
    version: VERSION,
    description:
      'MCP server for Japan National Tax Agency Corporate Number Web-API (Ver.4.0). Read-only, anonymous, full 7-primitive activation.',
    protocol_version: '2025-11-25',
    homepage: 'https://github.com/sugukurukabe/mcp-houjin-bangou',
    transport: {
      type: 'streamable-http',
      endpoint: '/mcp',
      stateless: true,
    },
    authentication: {
      required: false,
      note: 'Anonymous read-only access. v0.5.0 Hosted edition will add OAuth Client Credentials and Enterprise-Managed Authorization (ID-JAG).',
    },
    capabilities: {
      tools: { listChanged: true },
      resources: { listChanged: true, subscribe: false },
      prompts: { listChanged: true },
      completions: {},
    },
    primitives: {
      tools: [
        'lookup_corporate_by_number',
        'search_corporate_by_name',
        'validate_corporate_number',
        'normalize_company_name',
      ],
      prompts: ['business-card-to-database', 'sales-list-enrichment', 'customer-master-dedup'],
      resource_templates: ['corp://{corporate_number}'],
      resources: [
        'attribution://houjin-bangou',
        'ui://corporate-card/mcp-app.html',
        'ui://search-results/mcp-app.html',
      ],
    },
    attribution: {
      data_source: '国税庁法人番号公表サイト (https://www.houjin-bangou.nta.go.jp/)',
      license: '公共データ利用規約 第1.0版',
      api_version: 'Ver.4.0',
    },
    maintainer: {
      name: 'Sugukuru K.K.',
      email: 'engineering@sugukuru.co.jp',
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
      ],
    },
    specs_referenced: [
      'MCP 2025-11-25',
      'SEP-2127 Server Card (Draft)',
      'SEP-1303 Input Validation as Tool Errors',
      'SEP-986 Tool Name Format',
    ],
  };
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  bootstrap().catch((err) => {
    process.stderr.write(`bootstrap failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}
