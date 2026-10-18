import { describe, it, expect } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pino from 'pino';
import { createApp } from '../../src/server.js';

const silentLogger = pino({ level: 'silent' });

async function startTestServer(options: Parameters<typeof createApp>[0]): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = createApp({ ...options, logger: silentLogger });
  const server: Server = await new Promise((resolveServer) => {
    const s = app.listen(0, '127.0.0.1', () => resolveServer(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((err) => (err ? rejectClose(err) : resolveClose()));
      }),
  };
}

describe('GET /.well-known/openai-apps-challenge (Linear SLA2-329)', () => {
  it('OPENAI_APPS_CHALLENGE_TOKEN が設定されている場合、200 text/plain で完全一致の値を返す', async () => {
    const token = 'openai-apps-challenge-token-secret-value-12345';
    const { baseUrl, close } = await startTestServer({
      openaiAppsChallengeToken: token,
      allowedOrigins: 'https://chatgpt.com',
    });

    try {
      const res = await fetch(`${baseUrl}/.well-known/openai-apps-challenge`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
      const text = await res.text();
      expect(text).toBe(token);
    } finally {
      await close();
    }
  });

  it('Origin ヘッダーが未許可ドメインであっても Origin 検証の対象外となり 200 で返す', async () => {
    const token = 'challenge-token-with-unauthorized-origin';
    const { baseUrl, close } = await startTestServer({
      openaiAppsChallengeToken: token,
      allowedOrigins: 'https://chatgpt.com',
    });

    try {
      const res = await fetch(`${baseUrl}/.well-known/openai-apps-challenge`, {
        headers: {
          Origin: 'https://unauthorized.evil.example.com',
        },
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe(token);
    } finally {
      await close();
    }
  });

  it('OPENAI_APPS_CHALLENGE_TOKEN が未設定（空文字）の場合、404 を返す', async () => {
    const { baseUrl, close } = await startTestServer({
      openaiAppsChallengeToken: '',
    });

    try {
      const res = await fetch(`${baseUrl}/.well-known/openai-apps-challenge`);
      expect(res.status).toBe(404);
    } finally {
      await close();
    }
  });

  it('OPENAI_APPS_CHALLENGE_TOKEN が空白のみの場合も 404 を返す', async () => {
    const { baseUrl, close } = await startTestServer({
      openaiAppsChallengeToken: '   ',
    });

    try {
      const res = await fetch(`${baseUrl}/.well-known/openai-apps-challenge`);
      expect(res.status).toBe(404);
    } finally {
      await close();
    }
  });
});
