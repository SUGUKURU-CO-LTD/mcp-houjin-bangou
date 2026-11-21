/**
 * HTTP セキュリティミドルウェア（Origin 検証・IP 単位レート制限）
 *
 * 根拠 / Source:
 *   - MCP Streamable HTTP Transport 仕様:
 *     すべての接続で Origin ヘッダーを検証しなければならない (MUST)。
 *     Origin ヘッダーが存在し、かつ許可リストに含まれない場合は HTTP 403 を返す。
 *   - docs/plan/corp-check-interface-v1.md §1.3 制約6, §3.1, §4:
 *     番号を順に試して一覧を作る行為を防ぐため、IP 単位の利用上限を設け、
 *     超えた場合は RATE_LIMITED を返す。
 *   - Linear SLA2-327 (PR A):
 *     Origin 検証（許可リストは環境変数 ALLOWED_ORIGINS で設定、Origin が無いリクエストの扱いを明記）、
 *     レート制限（Cloud Run 前段に合わせた trust proxy 設定と IP 単位制限）。
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';

export const RATE_LIMIT_ERROR_MESSAGE =
  '利用上限（レート制限）に達しました。しばらく待ってから再試行してください。';

/**
 * Origin 文字列を正規化する（小文字化・末尾スラッシュ除去、不正なURLや 'null' は空文字を返す）
 */
export function normalizeOrigin(origin: string): string {
  const trimmed = origin.trim().replace(/\/+$/, '');
  if (!trimmed || trimmed.toLowerCase() === 'null') {
    return '';
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.origin.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * カンマ区切りの ALLOWED_ORIGINS 環境変数文字列を Set に変換する
 */
export function parseAllowedOrigins(raw: string): Set<string> {
  if (!raw || raw.trim() === '') {
    return new Set();
  }
  const origins = raw
    .split(',')
    .map((item) => normalizeOrigin(item))
    .filter((item) => item.length > 0);
  return new Set(origins);
}

/**
 * MCP Streamable HTTP 用 Origin 検証ミドルウェア
 *
 * 【Origin ヘッダーが無いリクエストの扱い】
 * - `Origin` ヘッダーが存在しないリクエスト（`req.headers.origin === undefined`）は許可（通過）する。
 * - 一方、`Origin` ヘッダーが存在する場合（`Origin: null` を含む）は、環境変数 `ALLOWED_ORIGINS` の
 *   許可リストと厳密照合し、含まれない場合はすべて HTTP 403 Forbidden で拒否する。
 */
export function createOriginValidationMiddleware(allowedOrigins: Set<string>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const rawOrigin = req.headers.origin;

    // Origin ヘッダーが無いリクエスト（サーバー間通信・CLI・ヘルスチェック）は通過
    if (rawOrigin === undefined) {
      next();
      return;
    }

    const normalized = normalizeOrigin(rawOrigin);
    if (!normalized || !allowedOrigins.has(normalized)) {
      res.status(403).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Forbidden: Origin not allowed',
        },
        id: null,
      });
      return;
    }

    next();
  };
}

export interface IpRateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  now?: () => number;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * IP 単位の固定ウィンドウ型レートリミッター
 */
export class IpRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly now: () => number;

  constructor(options: IpRateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
    this.now = options.now ?? (() => Date.now());
  }

  consume(clientIp: string, nowMs?: number): RateLimitCheckResult {
    const currentTime = nowMs ?? this.now();

    // メモリ肥大化を防ぐため、一定数以上のバケットがある場合は期限切れを一括削除
    if (this.buckets.size > 5000) {
      this.cleanupExpired(currentTime);
    }

    const existing = this.buckets.get(clientIp);
    if (!existing || currentTime >= existing.resetAt) {
      const resetAt = currentTime + this.windowMs;
      this.buckets.set(clientIp, { count: 1, resetAt });
      return {
        allowed: true,
        remaining: Math.max(0, this.maxRequests - 1),
        retryAfterSeconds: Math.max(1, Math.ceil(this.windowMs / 1000)),
      };
    }

    existing.count += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - currentTime) / 1000));

    if (existing.count > this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - existing.count),
      retryAfterSeconds,
    };
  }

  private cleanupExpired(currentTime: number): void {
    for (const [key, bucket] of this.buckets.entries()) {
      if (currentTime >= bucket.resetAt) {
        this.buckets.delete(key);
      }
    }
  }
}

function extractJsonRpcId(payload: unknown): string | number | null {
  if (payload !== null && typeof payload === 'object' && 'id' in payload) {
    const rawId = (payload as { id?: unknown }).id;
    if (typeof rawId === 'string' || typeof rawId === 'number') {
      return rawId;
    }
  }
  return null;
}

function buildJsonRpcRateLimitError(
  id: string | number | null,
  retryAfterSeconds: number,
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32000,
      message: `RATE_LIMITED: ${RATE_LIMIT_ERROR_MESSAGE}`,
      data: {
        code: 'RATE_LIMITED',
        error_code: 'RATE_LIMITED',
        retryable: true,
        retryAfterSeconds,
        message: RATE_LIMIT_ERROR_MESSAGE,
      },
    },
  };
}

/**
 * Express 用 IP レート制限ミドルウェア
 *
 * - `app.set('trust proxy', env.TRUST_PROXY)`（Cloud Run 前段 GFE に合わせて既定 1 ホップ）により
 *   算出された `req.ip` を用いてクライアントごとに利用回数を制限する。
 * - 上限超過時は HTTP 429 と Retry-After ヘッダー、および標準 JSON-RPC error (-32000) を返す
 *   （StreamableHTTPClientTransport は非2xx応答で JSON-RPC result を解釈しないため error 形式に統一）。
 */
export function createIpRateLimitMiddleware(
  limiter: IpRateLimiter,
  onRateLimited?: (clientIp: string) => void,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const check = limiter.consume(clientIp);

    if (check.allowed) {
      next();
      return;
    }

    onRateLimited?.(clientIp);
    res.setHeader('Retry-After', String(check.retryAfterSeconds));

    const body: unknown = req.body;
    if (Array.isArray(body) && body.length > 0) {
      res
        .status(429)
        .json(
          body.map((item: unknown) =>
            buildJsonRpcRateLimitError(extractJsonRpcId(item), check.retryAfterSeconds),
          ),
        );
      return;
    }

    res
      .status(429)
      .json(buildJsonRpcRateLimitError(extractJsonRpcId(body), check.retryAfterSeconds));
  };
}
