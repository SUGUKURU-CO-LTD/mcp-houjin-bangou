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
import { createErrorResponse } from './tool-response.js';

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
 * - 理由:
 *   1. MCP ホストのバックエンドサーバー間通信（Claude / ChatGPT サーバーからの呼び出し）、
 *      CLI クライアント、Cloud Run の稼働確認（/health）等はブラウザを介さないため `Origin` ヘッダーを持たない。
 *   2. Streamable HTTP における Origin 検証の目的は、ブラウザの DNS リバインディング攻撃や
 *      悪意ある Web サイトからのクロスオリジン要求（CSRF）の防止にある。
 *      Web ブラウザはクロスオリジンリクエストおよび POST リクエストに必ず `Origin` ヘッダーを自動付与し、
 *      ページ内のスクリプトから `Origin` ヘッダーを削除・偽装することはできない（Fetch Standard Forbidden request-header）。
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

/**
 * Express 用 IP レート制限ミドルウェア
 *
 * - `app.set('trust proxy', env.TRUST_PROXY)`（Cloud Run 前段 GFE に合わせて既定 1 ホップ）により
 *   算出された `req.ip` を用いてクライアントごとに利用回数を制限する。
 * - 上限超過時は HTTP 429 と Retry-After ヘッダーを返し、
 *   MCP tools/call リクエストに対しては凍結仕様 v1.7 §3.1 / §4 の共通エラー形式（code: 'RATE_LIMITED'）を返す。
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

    const body = req.body as
      { jsonrpc?: unknown; id?: unknown; method?: unknown } | undefined | null;

    if (body && typeof body === 'object' && body.method === 'tools/call') {
      res.status(429).json({
        jsonrpc: '2.0',
        id: body.id ?? null,
        result: createErrorResponse('RATE_LIMITED', RATE_LIMIT_ERROR_MESSAGE),
      });
      return;
    }

    res.status(429).json({
      jsonrpc: '2.0',
      id: body && typeof body === 'object' && 'id' in body ? (body.id ?? null) : null,
      error: {
        code: -32000,
        message: `RATE_LIMITED: ${RATE_LIMIT_ERROR_MESSAGE}`,
        data: {
          code: 'RATE_LIMITED',
          error_code: 'RATE_LIMITED',
          retryable: true,
          message: RATE_LIMIT_ERROR_MESSAGE,
        },
      },
    });
  };
}
