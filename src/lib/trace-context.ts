/**
 * OpenTelemetry Trace Context (W3C TraceContext) & SEP-414 伝播実装
 * W3C TraceContext propagation (SEP-414 Final compliant)
 *
 * 根拠 / Source:
 *   W3C TraceContext spec: https://www.w3.org/TR/trace-context/
 *   SEP-414 Final: MCP OpenTelemetry Trace Context Propagation Conventions
 *     - JSON-RPC `params._meta.traceparent` / `params._meta.tracestate` からの抽出
 *     - HTTP `traceparent` / `tracestate` ヘッダへのフォールバック
 *
 * `traceparent` ヘッダのフォーマット:
 *   version-trace_id-parent_id-flags
 *   例: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
 */

export interface TraceContext {
  version: string;
  traceId: string;
  parentId: string;
  flags: string;
}

export interface McpTraceEnvelope {
  traceContext: TraceContext;
  traceparent: string;
  tracestate?: string;
  source: 'mcp_meta' | 'http_header' | 'generated';
}

export interface McpHandlerTraceCarrier {
  _meta?: Record<string, unknown>;
  requestInfo?: {
    headers?: Record<string, string | string[] | undefined>;
  };
}

const TRACEPARENT_REGEX = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const MAX_TRACESTATE_LENGTH = 512;

export function parseTraceparent(header: string | undefined): TraceContext | null {
  if (header === undefined || header === '') return null;
  const m = TRACEPARENT_REGEX.exec(header.trim().toLowerCase());
  if (m === null) return null;
  const [, version, traceId, parentId, flags] = m;
  if (
    version === undefined ||
    traceId === undefined ||
    parentId === undefined ||
    flags === undefined
  ) {
    return null;
  }
  if (version === 'ff') return null;
  if (traceId === '0'.repeat(32) || parentId === '0'.repeat(16)) return null;
  return { version, traceId, parentId, flags };
}

export function sanitizeTracestate(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TRACESTATE_LENGTH) return undefined;
  // W3C tracestate allows printable ASCII (0x20..0x7E) excluding control chars/newlines
  if (!/^[\x20-\x7e]+$/.test(trimmed)) return undefined;
  return trimmed;
}

export function formatTraceparent(ctx: TraceContext): string {
  return `${ctx.version}-${ctx.traceId}-${ctx.parentId}-${ctx.flags}`;
}

/**
 * 16進数の ID を生成 (crypto.getRandomValues)
 */
export function generateTraceId(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return bufferToHex(array);
}

export function generateSpanId(): string {
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  return bufferToHex(array);
}

function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 親コンテキストから子 span の context を派生
 */
export function deriveChildSpan(parent: TraceContext | null): TraceContext {
  if (parent === null) {
    return {
      version: '00',
      traceId: generateTraceId(),
      parentId: generateSpanId(),
      flags: '01',
    };
  }
  return {
    version: parent.version,
    traceId: parent.traceId,
    parentId: generateSpanId(),
    flags: parent.flags,
  };
}

function firstHeaderString(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

/**
 * SEP-414 Final: MCP リクエストの `extra._meta` または HTTP ヘッダから W3C TraceContext を抽出し、
 * 子 Span を派生して返す。ツール出力（structuredContent / content）には含めず、構造化ログ相関にのみ用いる。
 */
export function extractTraceFromMcpExtra(extra?: McpHandlerTraceCarrier): McpTraceEnvelope {
  const metaTraceparent =
    typeof extra?._meta?.['traceparent'] === 'string' ? extra._meta['traceparent'] : undefined;
  const parsedMeta = parseTraceparent(metaTraceparent);
  if (parsedMeta !== null) {
    const child = deriveChildSpan(parsedMeta);
    const tracestate = sanitizeTracestate(extra?._meta?.['tracestate']);
    return {
      traceContext: child,
      traceparent: formatTraceparent(child),
      ...(tracestate !== undefined ? { tracestate } : {}),
      source: 'mcp_meta',
    };
  }

  const headers = extra?.requestInfo?.headers;
  const httpTraceparent = firstHeaderString(headers?.['traceparent']);
  const parsedHttp = parseTraceparent(httpTraceparent);
  if (parsedHttp !== null) {
    const child = deriveChildSpan(parsedHttp);
    const tracestate = sanitizeTracestate(firstHeaderString(headers?.['tracestate']));
    return {
      traceContext: child,
      traceparent: formatTraceparent(child),
      ...(tracestate !== undefined ? { tracestate } : {}),
      source: 'http_header',
    };
  }

  const generated = deriveChildSpan(null);
  return {
    traceContext: generated,
    traceparent: formatTraceparent(generated),
    source: 'generated',
  };
}
