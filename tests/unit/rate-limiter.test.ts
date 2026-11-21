import { describe, it, expect } from 'vitest';
import { TokenBucket } from '../../src/api/rate-limiter.js';
import { RateLimitError } from '../../src/lib/errors.js';

describe('TokenBucket', () => {
  it('初期容量から即座に acquire できる', async () => {
    const bucket = new TokenBucket({ rps: 1 });
    const start = Date.now();
    await bucket.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it('容量超過時は refill を待つ', async () => {
    const bucket = new TokenBucket({ rps: 10, maxBurst: 1 });
    await bucket.acquire();
    const start = Date.now();
    await bucket.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(80); // 10 RPS → 100ms/req
  });

  it('triggerBackoff は指数バックオフスケジュールを返す', () => {
    const bucket = new TokenBucket({ rps: 1 });
    expect(bucket.triggerBackoff()).toBe(30_000);
    expect(bucket.triggerBackoff()).toBe(60_000);
    expect(bucket.triggerBackoff()).toBe(300_000);
    expect(bucket.triggerBackoff()).toBe(1_800_000);
    // 上限を超えたら最大値を維持
    expect(bucket.triggerBackoff()).toBe(1_800_000);
  });

  it('バックオフ期間中の acquire() は最大30分ハングせず即座に RateLimitError で fail-fast する', async () => {
    const bucket = new TokenBucket({ rps: 1 });
    bucket.triggerBackoff(); // 30_000ms backoff
    const start = Date.now();
    await expect(bucket.acquire()).rejects.toBeInstanceOf(RateLimitError);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('トークン待機中に別リクエストが triggerBackoff() を発動した場合も起床時に RateLimitError を投げる', async () => {
    const bucket = new TokenBucket({ rps: 10, maxBurst: 1 });
    await bucket.acquire(); // トークン消費 (次まで約100ms待機)
    const pendingAcquire = bucket.acquire();
    setTimeout(() => {
      bucket.triggerBackoff();
    }, 20);
    await expect(pendingAcquire).rejects.toBeInstanceOf(RateLimitError);
  });

  it('resetBackoff でリセットされ再び acquire 可能になる', async () => {
    const bucket = new TokenBucket({ rps: 10 });
    bucket.triggerBackoff();
    bucket.resetBackoff();
    await expect(bucket.acquire()).resolves.toBeUndefined();
  });

  it('getTokens は現在のトークン数を返す', async () => {
    const bucket = new TokenBucket({ rps: 1, maxBurst: 5 });
    expect(bucket.getTokens()).toBeCloseTo(5, 0);
    await bucket.acquire();
    expect(bucket.getTokens()).toBeLessThan(5);
  });
});
