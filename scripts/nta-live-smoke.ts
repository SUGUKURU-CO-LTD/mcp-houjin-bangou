#!/usr/bin/env tsx
/**
 * NTA live smoke test.
 *
 * Uses the real NTA Web-API through `NTA_APPLICATION_ID`.
 * Does not print the Application ID.
 */

import { createNtaClient } from '../src/api/nta-client.js';
import { getEnv } from '../src/lib/env.js';
import { Result } from '../src/lib/result.js';
import { normalizeAndValidateCorporateNumber } from '../src/domain/check-digit.js';

// 国税庁の実在法人番号を live smoke 用に使用する。
// 仕様書サンプル番号は本番 API で count=0 になる場合があるため、live smoke では使わない。
const SAMPLE_CORPORATE_NUMBER = '7000012050002';

async function main(): Promise<void> {
  const env = getEnv();
  if (!env.NTA_APPLICATION_ID) {
    throw new Error('NTA_APPLICATION_ID is required for live smoke script');
  }
  const client = createNtaClient({
    applicationId: env.NTA_APPLICATION_ID,
    baseUrl: env.NTA_BASE_URL,
    timeoutMs: env.NTA_TIMEOUT_MS,
    rps: env.NTA_RATE_LIMIT_RPS,
    userAgent: '@sugukuru/mcp-houjin-bangou/live-smoke',
  });

  const validation = normalizeAndValidateCorporateNumber(SAMPLE_CORPORATE_NUMBER);
  if (!validation.isValid) {
    throw new Error(`Internal sample number is invalid: ${validation.reason}`);
  }
  process.stdout.write(`local validation: ${SAMPLE_CORPORATE_NUMBER} OK\n`);

  const lookup = await client.lookupByNumber({
    numbers: [SAMPLE_CORPORATE_NUMBER],
    history: '0',
  });
  if (Result.isErr(lookup)) {
    throw lookup.error;
  }
  process.stdout.write(
    `lookup /4/num: count=${lookup.value.header.count}, lastUpdateDate=${lookup.value.header.lastUpdateDate}\n`,
  );
  const first = lookup.value.corporations[0];
  if (first === undefined) {
    throw new Error('NTA live lookup returned no corporations for sample number');
  }
  process.stdout.write(`lookup /4/num first: ${first.corporate_number} ${first.name}\n`);

  const search = await client.searchByName({
    name: first.name,
    mode: '1',
    target: '1',
    divide: 1,
  });
  if (Result.isErr(search)) {
    throw search.error;
  }
  process.stdout.write(
    `search /4/name: count=${search.value.header.count}, divide=${search.value.header.divideNumber}/${search.value.header.divideSize}\n`,
  );
  process.stdout.write('NTA live smoke: OK\n');
}

main().catch((err) => {
  process.stderr.write(
    `NTA live smoke failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
