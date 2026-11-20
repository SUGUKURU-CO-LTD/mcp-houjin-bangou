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

  it('デフォルト値が設定される（DATA_SOURCE=web-api 時の HOST 既定は 127.0.0.1）', () => {
    process.env['NTA_APPLICATION_ID'] = 'test-id';
    delete process.env['DATA_SOURCE'];
    delete process.env['HOST'];
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
    expect(env.HOST).toBe('127.0.0.1');
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

  it('カスタム PORT およびカスタム HOST を反映し、空文字 HOST はモード既定値にフォールバックする', () => {
    process.env['NTA_APPLICATION_ID'] = 'test-id';
    process.env['PORT'] = '8080';
    process.env['HOST'] = '0.0.0.0';
    const env = getEnv();
    expect(env.PORT).toBe(8080);
    expect(env.HOST).toBe('0.0.0.0');

    resetEnvCache();
    process.env['HOST'] = '   ';
    expect(getEnv().HOST).toBe('127.0.0.1');
  });

  it('不正な LOG_LEVEL を拒否', () => {
    process.env['NTA_APPLICATION_ID'] = 'test-id';
    process.env['LOG_LEVEL'] = 'verbose';
    expect(() => getEnv()).toThrow();
  });

  it('DATA_SOURCE=db の場合は DATABASE_URL が必須、NTA_APPLICATION_ID は不要、HOST 既定は 0.0.0.0', () => {
    delete process.env['NTA_APPLICATION_ID'];
    delete process.env['HOST'];
    process.env['DATA_SOURCE'] = 'db';
    delete process.env['DATABASE_URL'];
    expect(() => getEnv()).toThrow(/DATABASE_URL/);

    process.env['DATABASE_URL'] = 'postgres://test:test@localhost:5432/test';
    const env = getEnv();
    expect(env.DATA_SOURCE).toBe('db');
    expect(env.DATABASE_URL).toBe('postgres://test:test@localhost:5432/test');
    expect(env.HOST).toBe('0.0.0.0');
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
