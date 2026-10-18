# MCP 7 Primitive Activation Playbook — 技術チートシート

> [!NOTE]
> 本文書は v0.1.0 / v0.2.0 当時の技術チートシート・実装パターン記録です。現行の v1.0.0（Streamable HTTP トランスポート、リモートホスト版、最新のプロトコル仕様）とは一部の記述やサンプルコードが異なる場合があります。現行の実装パターンについては最新のコードベースおよびルートの README を参照してください。

次作 MCP（`mcp-jp-subsidy-hub` 等）で**統合時間を半減**させるためのテクニカル参照。
本プロジェクトで実証済みのコードパターンを完全コピペ可能な形で集約。

## 公式 7 primitive

| # | Primitive | 必須 capability 宣言 | 用途 |
|---|---|---|---|
| 1 | Tools | `tools: { listChanged: true }` | 実行系の機能 |
| 2 | Prompts | `prompts: { listChanged: true }` | ワークフローテンプレート |
| 3 | Resources | （resources capability に含む） | 静的なドキュメント・出典 |
| 4 | Resource Templates | `resources: { listChanged: true, subscribe: false }` | URI 引数で参照可能なデータ |
| 5 | Completion | `completions: {}` | 引数の auto-complete 候補 |
| 6 | Logging | `logging: {}` | 構造化ログを client に送信 |
| 7 | Pagination | （capability 不要、cursor 実装のみ） | list / search の段階的取得 |

## Capability 宣言テンプレート（`src/mcp.ts`）

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function createServer(deps: { ... }): McpServer {
  return new McpServer({
    name: '@org/mcp-XXX',
    version: VERSION,
  }, {
    capabilities: {
      tools:       { listChanged: true },
      prompts:     { listChanged: true },
      resources:   { listChanged: true, subscribe: false },
      completions: {},
      logging:     {},
    },
    instructions: [
      "This server provides ... All operations are READ-ONLY.",
      "Tools: tool1, tool2, ...",
      "Prompts: prompt1, prompt2, ...",
      "Resources: resource://...",
    ].join('\n'),
  });
}
```

## Primitive 1: Tools

### コードパターン

```ts
// src/tools/example-tool.ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const InputSchema = z.object({
  param1: z.string().min(1).describe('Description'),
  optional: z.boolean().default(false),
}).strict();

const OutputSchema = z.object({
  // ...
  attribution: AttributionSchema,  // 必須
}).strict();

const DESCRIPTION = `Tool's purpose in 1-2 sentences.

USE THIS WHEN:
- Specific scenario 1
- Specific scenario 2

DO NOT USE WHEN:
- Use other_tool instead because XXX
- Skip if YYY

根拠: 対象 API 仕様書 §X.Y`;

export function registerExampleTool(server: McpServer, deps: ...): void {
  server.registerTool('example_tool', {
    title: 'Display name',
    description: DESCRIPTION,
    inputSchema: InputSchema.shape,
    outputSchema: OutputSchema.shape,
    annotations: {
      title: 'Display name',
      readOnlyHint: true,         // 必ず明示
      destructiveHint: false,     // 必ず明示
      idempotentHint: true,       // 必ず明示
      openWorldHint: true,        // API 呼出ありなら true
    },
  }, async (args) => {
    const input = InputSchema.parse(args);
    // ... business logic
    const output = { ..., attribution: buildAttribution() };
    return {
      content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
    };
  });
}
```

### Tool 数の上限

- 5-15 本に収める（LLM の tool selection 精度が落ちる）
- 超える場合は progressive disclosure pattern で関連ツールをグルーピング

## Primitive 2: Prompts

### コードパターン

```ts
// src/prompts/example-prompt.ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const argsSchema = z.object({
  user_input: z.string().min(1).max(5000).describe('...'),
  output_format: z.enum(['markdown', 'json', 'csv']).default('markdown'),
});

export function registerExamplePrompt(server: McpServer): void {
  server.registerPrompt('example-prompt', {
    title: 'Workflow title',
    description: 'What this prompt does in 1-2 sentences',
    argsSchema: argsSchema.shape,
  }, (args) => {
    const parsed = argsSchema.parse(args);
    return {
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `LLM への指示テンプレート。

【入力】
"""
${parsed.user_input}
"""

【実行手順】
1. step1_tool を呼ぶ
2. step2_tool を呼ぶ
3. ${parsed.output_format} 形式で出力

【出典ルール】
全ての応答に attribution を含める。`,
        },
      }],
    };
  });
}
```

### Prompt 設計の原則

- 1 プロンプト = 1 ワークフロー
- LLM への指示は具体的に（「step1_tool を呼ぶ」等の明示）
- 出力フォーマットを args で選択可能に
- 引数は 5 個以内に絞る

## Primitive 3: Resources

### コードパターン (静的 Resource)

```ts
// src/resources/attribution.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const URI = 'attribution://target-domain';

export function registerAttributionResource(server: McpServer): void {
  server.registerResource('attribution', URI, {
    title: 'Attribution',
    description: '対象 API 利用規約遵守の出典情報',
    mimeType: 'application/json',
  }, async () => ({
    contents: [{
      uri: URI,
      mimeType: 'application/json',
      text: JSON.stringify(buildAttribution(), null, 2),
    }],
  }));
}
```

## Primitive 4: Resource Templates

### コードパターン (動的 URI)

```ts
// src/resources/entity-template.ts
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerEntityResourceTemplate(server: McpServer, deps: ...): void {
  server.registerResource(
    'entity',
    new ResourceTemplate('entity://{entity_id}', { list: undefined }),
    {
      title: 'Entity by ID',
      description: 'URI テンプレート: entity://{entity_id}',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const rawId = Array.isArray(variables['entity_id'])
        ? variables['entity_id'][0]
        : variables['entity_id'];
      if (typeof rawId !== 'string') {
        throw new Error('Invalid URI');
      }
      // バリデーション + データ取得
      const data = await deps.client.fetch(rawId);
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ data, attribution: buildAttribution() }, null, 2),
        }],
      };
    },
  );
}
```

## Primitive 5: Completion（最重要差別化）

### コードパターン

```ts
// src/completion/handler.ts
import { CompleteRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export function registerCompletionHandler(
  server: Server,
  deps: { logger: McpLogger; normalizer?: ... }
): void {
  server.setRequestHandler(CompleteRequestSchema, async (req) => {
    const { ref, argument } = req.params;

    // Resource Template の引数補完
    if (ref.type === 'ref/resource') {
      const uri = 'uri' in ref ? (ref.uri as string) : '';
      if (uri.startsWith('entity://')) {
        return completeEntityArgument(argument.value, deps.normalizer);
      }
    }

    // Prompt の引数補完
    if (ref.type === 'ref/prompt') {
      return completePromptArgument(ref.name ?? '', argument.name, argument.value);
    }

    return { completion: { values: [], total: 0, hasMore: false } };
  });
}

function completeEntityArgument(value: string, normalizer: ...) {
  // 文字列なら正規化候補を返す
  // 数字なら（API に部分マッチがない場合は）空配列
  if (/^\d+$/.test(value)) {
    return { completion: { values: [], total: 0, hasMore: false } };
  }
  if (value.trim().length > 0 && normalizer) {
    const candidates = normalizer.suggest(value, { max: 20 });
    return {
      completion: {
        values: candidates,
        total: candidates.length,
        hasMore: false,
      },
    };
  }
  return { completion: { values: [], total: 0, hasMore: false } };
}

function completePromptArgument(promptName: string, argName: string, value: string) {
  // Enum 引数の prefix matching
  const enumMap = {
    'example-prompt': {
      output_format: ['markdown', 'json', 'csv'],
    },
  };
  const enumValues = enumMap[promptName]?.[argName];
  if (enumValues) {
    return {
      completion: {
        values: enumValues.filter(v => v.startsWith(value)),
        total: ...,
        hasMore: false,
      },
    };
  }
  return { completion: { values: [], total: 0, hasMore: false } };
}
```

### Completion の威力

Resource Template `corp://{corporate_number}` の引数 typing 中に、
裏で T7 normalizer 等の deterministic ロジックが動く → IDE 補完型 UX 成立。

これが 99% の MCP server に欠けている差別化要素。

## Primitive 6: Logging

### コードパターン

```ts
// src/lib/mcp-logger.ts
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export type LogLevel =
  | 'debug' | 'info' | 'notice' | 'warning'
  | 'error' | 'critical' | 'alert' | 'emergency';

const PRIORITY: Record<LogLevel, number> = {
  debug: 7, info: 6, notice: 5, warning: 4,
  error: 3, critical: 2, alert: 1, emergency: 0,
};

function redactSensitive(data: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (
      (lowerKey.includes('id') && (lowerKey.includes('application') || lowerKey.includes('api_key'))) ||
      lowerKey.includes('token') || lowerKey.includes('secret') || lowerKey.includes('password')
    ) {
      redacted[key] = '***REDACTED***';
    } else if (typeof value === 'string') {
      redacted[key] = value.replace(/id=[^&\s]+/g, 'id=***REDACTED***');
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      redacted[key] = redactSensitive(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export function createMcpLogger(server: Server, initialLevel: LogLevel = 'info') {
  let currentLevel = initialLevel;
  return {
    setLevel: (level: LogLevel) => { currentLevel = level; },
    log(level: LogLevel, logger: string, data: Record<string, unknown>) {
      if (PRIORITY[level] > PRIORITY[currentLevel]) return;
      const redacted = redactSensitive(data);
      try {
        void server.notification({
          method: 'notifications/message',
          params: { level, logger, data: redacted },
        });
      } catch { /* ignore */ }
    },
    debug(l, d)   { this.log('debug', l, d); },
    info(l, d)    { this.log('info', l, d); },
    warning(l, d) { this.log('warning', l, d); },
    error(l, d)   { this.log('error', l, d); },
  };
}
```

## Primitive 7: Pagination

### コードパターン

```ts
// src/lib/pagination.ts
interface CursorPayload {
  page: number;  // 対象 API の分割番号
  queryKey?: string;  // クエリのハッシュ（cursor の使い回し防止）
}

export function encodeCursor(page: number, queryKey?: string): string {
  const payload: CursorPayload = { page, ...(queryKey && { queryKey }) };
  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined): CursorPayload | null {
  if (!cursor) return null;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json);
    if (typeof parsed.page === 'number' && parsed.page >= 1 && parsed.page <= 99999) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function computeNextCursor(
  current: number,
  total: number,
  queryKey?: string,
): string | null {
  if (current >= total) return null;
  return encodeCursor(current + 1, queryKey);
}
```

### Tool 内での使用

```ts
const cursorPayload = decodeCursor(input.cursor);
const page = cursorPayload?.page ?? 1;

const result = await client.fetch({ ..., page });
const queryKey = JSON.stringify([input.query, input.filters]);
const nextCursor = computeNextCursor(
  result.divideNumber,
  result.divideSize,
  queryKey,
);

return {
  // ...
  next_cursor: nextCursor,
  attribution: buildAttribution(),
};
```

## Server Card（補助）

### `/.well-known/mcp.json` 静的ファイル

```json
{
  "name": "@org/mcp-XXX",
  "version": "0.1.0",
  "protocol_version": "2025-11-25",
  "homepage": "https://github.com/org/mcp-XXX",
  "transport": {
    "type": "streamable-http",
    "endpoint": "/mcp",
    "stateless": true
  },
  "authentication": { "required": false },
  "capabilities": {
    "tools":       { "listChanged": true },
    "prompts":     { "listChanged": true },
    "resources":   { "listChanged": true, "subscribe": false },
    "completions": {},
    "logging":     {}
  },
  "primitives": {
    "tools": ["tool1", "tool2", ...],
    "prompts": ["prompt1", ...],
    "resources": ["attribution://..."],
    "resource_templates": ["entity://{entity_id}"]
  },
  "attribution": { ... },
  "safety": {
    "read_only": true,
    "destructive_operations": [],
    "prompt_injection_mitigations": [
      "static_tool_descriptions",
      "no_runtime_schema_mutation",
      "application_id_only_from_env",
      "attribution_required_on_all_outputs",
      "zod_strict_additional_properties_false",
      "ci_grep_for_hidden_instructions"
    ]
  },
  "specs_referenced": [
    "MCP 2025-11-25",
    "SEP-2127 Server Card (Draft)",
    "SEP-1303 Input Validation as Tool Errors",
    "RFC 5424"
  ]
}
```

## サーバー boot（`src/server.ts`）

```ts
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';

export async function bootstrap(): Promise<void> {
  const env = getEnv();
  const client = createApiClient({ ... });
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { ... } }));
  app.use(cors({ origin: true, credentials: false }));
  app.use(express.json({ limit: '64kb' }));

  app.get('/health', (_, res) => res.status(200).json({ status: 'ok', version: VERSION }));
  app.get('/.well-known/mcp.json', (_, res) => res.status(200).json(buildServerCard()));

  app.post('/mcp', async (req, res) => {
    const mcpServer = createServer({ client });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,  // stateless mode
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void mcpServer.close();
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get('/mcp', (_, res) => res.status(405).json({ ... }));
  app.delete('/mcp', (_, res) => res.status(405).json({ ... }));

  app.listen(env.PORT, () => { /* log */ });
}
```

## ファイル構造の繰り返しパターン

```
src/
├── server.ts                          # Express + Streamable HTTP entrypoint
├── mcp.ts                             # McpServer factory + capability 宣言
├── version.ts                         # build-time injected
├── tools/                             # 1 ファイル 1 tool
│   ├── tool1.ts
│   ├── tool2.ts
│   └── index.ts                       # registerAllTools(server, deps)
├── prompts/                           # 1 ファイル 1 prompt
│   ├── prompt1.ts
│   └── index.ts                       # registerAllPrompts(server)
├── resources/                         # 静的 + Template
│   ├── attribution.ts
│   ├── entity-template.ts
│   └── index.ts                       # registerAllResources(server, deps)
├── completion/
│   └── handler.ts                     # completion/complete handler
├── api/                               # 外部 API client（DI seam）
│   ├── client.ts
│   ├── parser.ts                      # CSV/XML/JSON parser
│   └── rate-limiter.ts                # token bucket
├── domain/                            # 純粋ロジック
│   ├── entity-id.ts                   # Branded type
│   ├── normalizer.ts                  # ドメイン固有正規化
│   └── codes.ts                       # コード辞書
└── lib/                               # 横断
    ├── env.ts                         # Zod env validation
    ├── errors.ts                      # 型付きエラー階層
    ├── result.ts                      # Result monad
    ├── mcp-logger.ts                  # MCP Logging emitter
    ├── pagination.ts                  # opaque cursor
    ├── trace-context.ts               # W3C TraceContext (SEP-414 準備)
    └── attribution.ts                 # buildAttribution()
```

## 次作で半減できる根拠

| Phase | 法人番号 MCP | 次作 (mcp-jp-subsidy-hub) | 削減理由 |
|---|---|---|---|
| Spec 読込 | 8h | 4h | 公式 MCP 仕様は再読込不要 |
| ADR 下書き | 6h | 3h | 0001-0010 はテンプレ化済み |
| ディレクトリ構造 | 1h | 0.5h | コピペで完成 |
| MCP 7 機能実装 | 12h | 6h | 全 primitive のコードパターン揃い |
| CI/CD | 4h | 1h | release.yml 等は templating |
| Documentation | 6h | 3h | README / ADR / Architecture テンプレ |
| Testing | 8h | 4h | テスト構造再利用 |
| Distribution | 4h | 2h | 段取り経験済み |
| **合計** | **49h** | **23.5h** | **約 50% 削減** |

## チェック項目（次作着手時）

新規プロジェクトを始める際に順に確認:

- [ ] このプロジェクトを clone or fork した template repo を用意
- [ ] `package.json` の name / description を新ドメインに変更
- [ ] `src/api/` の対象 API client を新 API spec で書き直し
- [ ] `src/domain/` の Branded type と code dictionary を新ドメイン用に
- [ ] `src/tools/` を新ドメイン用に書き直し（5 ツール程度）
- [ ] `src/prompts/` を新ドメイン用に書き直し（3 プロンプト程度）
- [ ] `buildAttribution()` を新 API の規約に合わせて書き換え
- [ ] ADR 0001-0008 の判断を維持、0009-0012 を新ドメイン用に
- [ ] Capability 宣言は無変更で OK
- [ ] CI workflows 5 本は無変更で OK（package name のみ更新）
- [ ] README は構造維持、内容を新ドメイン用に
