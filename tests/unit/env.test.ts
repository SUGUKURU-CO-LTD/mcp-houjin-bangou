import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getEnv, resetEnvCache } from '../../src/lib/env.js';

describe('env validation', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    resetEnvCache();
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      delete process.env[k];
    }
    Object.assign(process.env, savedEnv);
    resetEnvCache();
  });

  it('NTA_APPLICATION_ID が必須', () => {
    delete process.env['NTA_APPLICATION_ID'];
    expect(() => getEnv()).toThrow(/NTA_APPLICATION_ID/);
  });

  it('デフォルト値が設定される', () => {
    process.env['NTA_APPLICATION_ID'] = 'test-id';
    delete process.env['PORT'];
    delete process.env['LOG_LEVEL'];
    delete process.env['NTA_RATE_LIMIT_RPS'];
    delete process.env['NTA_BASE_URL'];
    delete process.env['ALLOWED_ORIGINS'];
    delete process.env['TRUST_PROXY'];
    delete process.env['RATE_LIMIT_WINDOW_MS'];
    delete process.env['RATE_LIMIT_MAX_REQUESTS'];
    delete process.env['OPENAI_APPS_CHALLENGE_TOKEN'];
    const env = getEnv();
    expect(env.PORT).toBe(3001);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.NTA_RATE_LIMIT_RPS).toBe(1);
    expect(env.NTA_BASE_URL).toBe('https://api.houjin-bangou.nta.go.jp/4');
    expect(env.ALLOWED_ORIGINS).toBe('');
    expect(env.TRUST_PROXY).toBe(1);
    expect(env.RATE_LIMIT_WINDOW_MS).toBe(60_000);
    expect(env.RATE_LIMIT_MAX_REQUESTS).toBe(60);
    expect(env.OPENAI_APPS_CHALLENGE_TOKEN).toBe('');
  });

  it('カスタム PORT を数値化', () => {
    process.env['NTA_APPLICATION_ID'] = 'test-id';
    process.env['PORT'] = '8080';
    const env = getEnv();
    expect(env.PORT).toBe(8080);
  });

  it('不正な LOG_LEVEL を拒否', () => {
    process.env['NTA_APPLICATION_ID'] = 'test-id';
    process.env['LOG_LEVEL'] = 'verbose';
    expect(() => getEnv()).toThrow();
  });

  it('DATA_SOURCE=db の場合は DATABASE_URL が必須、NTA_APPLICATION_ID は不要', () => {
    delete process.env['NTA_APPLICATION_ID'];
    process.env['DATA_SOURCE'] = 'db';
    delete process.env['DATABASE_URL'];
    expect(() => getEnv()).toThrow(/DATABASE_URL/);

    process.env['DATABASE_URL'] = 'postgres://test:test@localhost:5432/test';
    const env = getEnv();
    expect(env.DATA_SOURCE).toBe('db');
    expect(env.DATABASE_URL).toBe('postgres://test:test@localhost:5432/test');
  });

  it('ALLOWED_ORIGINS / TRUST_PROXY / RATE_LIMIT_* のカスタム値を検証', () => {
    process.env['NTA_APPLICATION_ID'] = 'test-id';
    process.env['ALLOWED_ORIGINS'] = 'https://claude.ai,https://chatgpt.com';
    process.env['TRUST_PROXY'] = '0';
    process.env['RATE_LIMIT_WINDOW_MS'] = '30000';
    process.env['RATE_LIMIT_MAX_REQUESTS'] = '15';
    process.env['OPENAI_APPS_CHALLENGE_TOKEN'] = 'test-challenge-token-123';
    const env = getEnv();
    expect(env.ALLOWED_ORIGINS).toBe('https://claude.ai,https://chatgpt.com');
    expect(env.TRUST_PROXY).toBe(0);
    expect(env.RATE_LIMIT_WINDOW_MS).toBe(30000);
    expect(env.RATE_LIMIT_MAX_REQUESTS).toBe(15);
    expect(env.OPENAI_APPS_CHALLENGE_TOKEN).toBe('test-challenge-token-123');
  });
});
