/**
 * Token bucket レートリミッター
 * Token bucket rate limiter for NTA API
 *
 * 根拠 / Source:
 *   国税庁仕様書 第二編 別紙2: HTTP 403 は「同一アプリケーションIDで一定期間内に多数アクセス」で発動
 *   別添1 第9条第1項三号: 短時間における大量アクセスは禁止
 *   → 保守的に 1 RPS デフォルト、403 受信時は指数バックオフ (バックオフ期間中は即座に RateLimitError で fail-fast)
 */

import { RateLimitError } from '../lib/errors.js';

export interface RateLimiterOptions {
  /** リクエスト毎秒 (requests per second) */
  rps: number;
  /** バケット最大容量 (burst 許容量) */
  maxBurst?: number;
}

export class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private lastRefill: number;
  private backoffUntil = 0;
  private backoffLevel = 0;

  constructor(options: RateLimiterOptions) {
    const capacity = options.maxBurst ?? Math.max(1, Math.ceil(options.rps));
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillPerMs = options.rps / 1000;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
      this.lastRefill = now;
    }
  }

  private throwIfBackingOff(): void {
    const now = Date.now();
    if (now < this.backoffUntil) {
      const waitMs = this.backoffUntil - now;
      throw new RateLimitError(`Rate limited by NTA; backoff active for ${waitMs}ms`, waitMs);
    }
  }

  /**
   * 1トークン獲得するまで待機 (バックオフ期間中はハングせず RateLimitError を投げる)
   * Awaits until a token is available (resolves immediately if bucket full; fails fast during backoff)
   */
  async acquire(): Promise<void> {
    this.throwIfBackingOff();
    this.refill();
    while (this.tokens < 1) {
      const neededMs = Math.ceil((1 - this.tokens) / this.refillPerMs);
      await sleep(neededMs);
      this.throwIfBackingOff();
      this.refill();
    }
    this.tokens -= 1;
  }

  /**
   * 403 受信時の指数バックオフを発動 (30s → 1m → 5m → 30m)
   */
  triggerBackoff(): number {
    const schedule = [30_000, 60_000, 5 * 60_000, 30 * 60_000];
    const waitMs = schedule[Math.min(this.backoffLevel, schedule.length - 1)] ?? 30_000;
    this.backoffLevel += 1;
    this.backoffUntil = Date.now() + waitMs;
    return waitMs;
  }

  /** 正常完了時にバックオフをリセット */
  resetBackoff(): void {
    this.backoffLevel = 0;
    this.backoffUntil = 0;
  }

  /** テスト・観測用: 現在のトークン数を返す */
  getTokens(): number {
    this.refill();
    return this.tokens;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
