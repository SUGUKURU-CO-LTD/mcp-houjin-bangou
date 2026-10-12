#!/usr/bin/env tsx
/**
 * 国税庁 API への週次 ping (3年無利用停止防止)
 * Weekly keep-alive ping to NTA Web-API to avoid 3-year dormancy suspension
 *
 * 根拠 / Source: 国税庁仕様書 第一編 §5.3 + 別添1 第4条第5項
 */

import { getEnv } from '../src/lib/env.js';
import { createNtaClient } from '../src/api/nta-client.js';
import { Result } from '../src/lib/result.js';

async function main(): Promise<void> {
  const env = getEnv();
  if (!env.NTA_APPLICATION_ID) {
    throw new Error('NTA_APPLICATION_ID is required for keepalive script');
  }
  const client = createNtaClient({
    applicationId: env.NTA_APPLICATION_ID,
    baseUrl: env.NTA_BASE_URL,
    timeoutMs: env.NTA_TIMEOUT_MS,
    rps: env.NTA_RATE_LIMIT_RPS,
    userAgent: '@sugukuru/mcp-houjin-bangou/keepalive',
  });

  process.stdout.write('Pinging NTA Web-API...\n');
  const result = await client.ping();
  if (Result.isOk(result)) {
    process.stdout.write('NTA API keep-alive: OK\n');
    process.exit(0);
  } else {
    const err = result.error;
    process.stderr.write(
      `NTA API keep-alive failed: ${err.code} (HTTP ${err.httpStatus ?? 'n/a'}): ${err.message}\n`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`keepalive script error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
