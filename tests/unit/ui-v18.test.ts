/**
 * MCP Apps UI (v1.8) pure view-model & resource path resolution tests
 *
 * 根拠 / Source:
 *   Linear SLA2-329:
 *     - tools.test.ts と同じ合成データで得たツールの実際の出力（structuredContent）を使い、
 *       表示の値とボタンの引数が v1.8 に合うことを DOM を使わない純粋関数で確かめる
 *     - 出典はツールが返す attribution の文字列をそのまま表示する（固定文に置き換えない）
 *     - innerHTML / insertAdjacentHTML を使わず createElement と textContent に置き換える
 *     - App の version を src/version.ts（package.json の版）にする
 *     - src/resources/ui-resources.ts の HTML 読み込みを import.meta.url 基準にし、別フォルダから起動しても読めることを確かめる
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerAllTools } from '../../src/tools/index.js';
import { registerAllResources } from '../../src/resources/index.js';
import type { NtaClient } from '../../src/api/nta-client.js';
import { createMcpLogger } from '../../src/lib/mcp-logger.js';
import { Result } from '../../src/lib/result.js';
import { VERSION } from '../../src/version.js';
import {
  ADDRESS_OUTDATED_WARNING,
  buildCorporateCardViewModel,
  buildLookupByNumberArgs,
  buildSearchResultsViewModel,
  buildSearchSimilarArgs,
  formatPostalCodeDisplay,
  type LookupCorporateOutput,
  type SearchCorporateOutput,
} from '../../src/ui/shared.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

// tools.test.ts と同一の合成データ
const sampleActiveCorporation = {
  sequence_number: 1,
  corporate_number: '5111101000006',
  process: '01',
  correct: '1' as const,
  update_date: '2019-04-03',
  change_date: '2015-10-05',
  name: '株式会社検索対象除外',
  name_image_id: '',
  kind: '301',
  prefecture_name: '東京都',
  city_name: '千代田区',
  street_number: '神田小川町',
  address_image_id: '',
  prefecture_code: '13',
  city_code: '101',
  post_code: '1000000',
  address_outside: '',
  address_outside_image_id: '',
  close_date: '',
  close_cause: '',
  successor_corporate_number: '',
  change_cause: '',
  assignment_date: '2015-10-05',
  latest: '1' as const,
  en_name: '',
  en_prefecture_name: '',
  en_city_name: '',
  en_address_outside: '',
  furigana: 'カブシキガイシャケンサクタイショウジョガイ',
  hihyoji: '1' as const,
};

const sampleClosedCorporation = {
  sequence_number: 2,
  corporate_number: '9340001026142',
  process: '01',
  correct: '0' as const,
  update_date: '2026-07-15',
  change_date: '2026-07-15',
  name: '閉鎖サンプル株式会社',
  name_image_id: '',
  kind: '301',
  prefecture_name: '鹿児島県',
  city_name: '霧島市',
  street_number: '国分中央１丁目２−３２',
  address_image_id: '',
  prefecture_code: '46',
  city_code: '218',
  post_code: '8994332',
  address_outside: '',
  address_outside_image_id: '',
  close_date: '2026-08-01',
  close_cause: '01', // 清算の結了等
  successor_corporate_number: '',
  change_cause: '',
  assignment_date: '2023-12-01',
  latest: '1' as const,
  en_name: '',
  en_prefecture_name: '',
  en_city_name: '',
  en_address_outside: '',
  furigana: 'ヘイササンプルカブシキガイシャ',
  hihyoji: '0' as const,
};

const mockNtaClient: NtaClient = {
  async lookupByNumber(params) {
    if (params.numbers.includes('5111101000006')) {
      return Result.ok({
        header: { lastUpdateDate: '2019-04-05', count: 1, divideNumber: 1, divideSize: 1 },
        corporations: [sampleActiveCorporation],
      });
    }
    if (params.numbers.includes('9340001026142')) {
      return Result.ok({
        header: { lastUpdateDate: '2026-08-05', count: 1, divideNumber: 1, divideSize: 1 },
        corporations: [sampleClosedCorporation],
      });
    }
    return Result.ok({
      header: { lastUpdateDate: '2019-04-05', count: 0, divideNumber: 1, divideSize: 1 },
      corporations: [],
    });
  },
  async searchByName(params) {
    if (params.name === '多数件') {
      const corps = Array.from({ length: 25 }, (_, i) => ({
        ...sampleActiveCorporation,
        corporate_number: String(1000000000000 + i),
        name: `テスト法人第${i + 1}号`,
      }));
      return Result.ok({
        header: { lastUpdateDate: '2026-10-12', count: 25, divideNumber: 1, divideSize: 1 },
        corporations: corps,
      });
    }
    return Result.ok({
      header: { lastUpdateDate: '2019-04-05', count: 2, divideNumber: 1, divideSize: 1 },
      corporations: [sampleActiveCorporation, sampleClosedCorporation],
    });
  },
  async ping() {
    return Result.ok(true);
  },
};

describe('MCP Apps UI v1.8 View-Model & Resource Resolution', () => {
  let server: McpServer;
  let client: Client;

  beforeAll(async () => {
    const logger = createMcpLogger(new PassThrough());
    server = new McpServer({ name: 'test-ui-v18-server', version: VERSION });
    registerAllTools(server, { ntaClient: mockNtaClient, logger });
    registerAllResources(server);

    client = new Client({ name: 'test-ui-v18-client', version: VERSION });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it('builds corporate-card view model and button args from actual v1.8 lookup_corporate_by_number output (active + address_may_be_outdated)', async () => {
    const res = await client.callTool({
      name: 'lookup_corporate_by_number',
      arguments: { corporate_number: '5111101000006' },
    });

    expect(res.isError).toBeFalsy();
    const structured = res.structuredContent as LookupCorporateOutput;
    expect(structured).toBeDefined();

    const vm = buildCorporateCardViewModel(structured);
    expect(vm).not.toBeNull();
    if (!vm) return;

    expect(vm.corporate_number).toBe('5111101000006');
    expect(vm.name).toBe('株式会社検索対象除外');
    expect(vm.name_kana).toBe('カブシキガイシャケンサクタイショウジョガイ');
    expect(vm.name_kana_display).toBe('カブシキガイシャケンサクタイショウジョガイ');
    expect(vm.legal_type).toBe('株式会社');
    expect(vm.status).toBe('active');
    expect(vm.status_badge).toEqual({
      status: 'active',
      label: '登記中 (active)',
      className: 'active',
    });
    expect(vm.close_date).toBeNull();
    expect(vm.close_cause).toBeNull();
    expect(vm.location).toBe('東京都千代田区神田小川町');
    expect(vm.post_code).toBe('1000000');
    expect(vm.post_code_display).toBe('100-0000');
    expect(vm.update_date).toBe('2019-04-03');
    expect(vm.data_as_of).toBe('2019-04-05');
    expect(vm.address_may_be_outdated).toBe(true);
    expect(vm.address_warning).toBe(ADDRESS_OUTDATED_WARNING);

    // 出典はツールが返す attribution の文字列をそのまま表示する（固定文に置き換えない）
    expect(typeof structured.attribution).toBe('string');
    expect(vm.attribution).toBe(structured.attribution);

    // 「類似商号を検索」は search_corporate_by_name に { name } だけを渡す
    expect(vm.search_similar_args).toEqual({ name: '株式会社検索対象除外' });
    expect(Object.keys(vm.search_similar_args)).toEqual(['name']);
    expect(buildSearchSimilarArgs('株式会社検索対象除外')).toEqual({
      name: '株式会社検索対象除外',
    });
  });

  it('builds corporate-card view model from actual v1.8 lookup_corporate_by_number output (closed corporation)', async () => {
    const res = await client.callTool({
      name: 'lookup_corporate_by_number',
      arguments: { corporate_number: '9340001026142' },
    });

    expect(res.isError).toBeFalsy();
    const structured = res.structuredContent as LookupCorporateOutput;
    const vm = buildCorporateCardViewModel(structured);
    expect(vm).not.toBeNull();
    if (!vm) return;

    expect(vm.corporate_number).toBe('9340001026142');
    expect(vm.name).toBe('閉鎖サンプル株式会社');
    expect(vm.name_kana).toBe('ヘイササンプルカブシキガイシャ');
    expect(vm.legal_type).toBe('株式会社');
    expect(vm.status).toBe('closed');
    expect(vm.status_badge).toEqual({
      status: 'closed',
      label: '閉鎖 (closed)',
      className: 'closed',
    });
    expect(vm.close_date).toBe('2026-08-01');
    expect(vm.close_cause).toBe('清算の結了等');
    expect(vm.location).toBe('鹿児島県霧島市国分中央１丁目２−３２');
    expect(vm.post_code).toBe('8994332');
    expect(vm.post_code_display).toBe('899-4332');
    expect(vm.update_date).toBe('2026-07-15');
    expect(vm.data_as_of).toBe('2026-08-05');
    expect(vm.address_may_be_outdated).toBe(false);
    expect(vm.address_warning).toBeNull();
    expect(vm.attribution).toBe(structured.attribution);
  });

  it('builds search-results view model and row click args from actual v1.8 search_corporate_by_name output', async () => {
    const res = await client.callTool({
      name: 'search_corporate_by_name',
      arguments: { name: 'サンプル' },
    });

    expect(res.isError).toBeFalsy();
    const structured = res.structuredContent as SearchCorporateOutput;
    const vm = buildSearchResultsViewModel(structured);

    expect(vm.total_count).toBe(2);
    expect(vm.returned_count).toBe(2);
    expect(vm.summary_text).toBe('全 2 件中 2 件を表示');
    expect(vm.next_cursor).toBeNull();
    expect(vm.data_as_of).toBe('2019-04-05');
    expect(vm.attribution).toBe(structured.attribution);
    expect(vm.address_warning).toBe(ADDRESS_OUTDATED_WARNING);
    expect(vm.results).toHaveLength(2);

    const firstRow = vm.results[0];
    expect(firstRow).toBeDefined();
    if (!firstRow) return;
    expect(firstRow.corporate_number).toBe('5111101000006');
    expect(firstRow.name).toBe('株式会社検索対象除外');
    expect(firstRow.legal_type).toBe('株式会社');
    expect(firstRow.location).toBe('東京都千代田区神田小川町');
    expect(firstRow.status).toBe('active');
    expect(firstRow.address_may_be_outdated).toBe(true);
    // 行クリックの再取得は lookup_corporate_by_number に { corporate_number } を渡す
    expect(firstRow.lookup_args).toEqual({ corporate_number: '5111101000006' });
    expect(Object.keys(firstRow.lookup_args)).toEqual(['corporate_number']);

    const secondRow = vm.results[1];
    expect(secondRow).toBeDefined();
    if (!secondRow) return;
    expect(secondRow.corporate_number).toBe('9340001026142');
    expect(secondRow.status).toBe('closed');
    expect(secondRow.lookup_args).toEqual({ corporate_number: '9340001026142' });

    expect(buildLookupByNumberArgs('5111101000006')).toEqual({
      corporate_number: '5111101000006',
    });

    // ページネーション（next_cursor あり、既定 limit=10）の検証
    const pagedRes = await client.callTool({
      name: 'search_corporate_by_name',
      arguments: { name: '多数件' },
    });
    const pagedStructured = pagedRes.structuredContent as SearchCorporateOutput;
    const pagedVm = buildSearchResultsViewModel(pagedStructured);
    expect(pagedVm.total_count).toBe(25);
    expect(pagedVm.returned_count).toBe(10);
    expect(pagedVm.summary_text).toBe('全 25 件中 10 件を表示');
    expect(typeof pagedVm.next_cursor).toBe('string');
    expect(pagedVm.next_cursor).toBe(pagedStructured.next_cursor);
  });

  it('verifies UI fixtures match v1.8 view models', () => {
    const cardFixture = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'docs/assets/ui-fixtures/corporate-card.json'), 'utf-8'),
    ) as LookupCorporateOutput;
    const cardVm = buildCorporateCardViewModel(cardFixture);
    expect(cardVm).not.toBeNull();
    expect(cardVm?.corporate_number).toBe('5111101000006');
    expect(cardVm?.legal_type).toBe('株式会社');
    expect(cardVm?.address_may_be_outdated).toBe(true);

    const searchFixture = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'docs/assets/ui-fixtures/search-results.json'), 'utf-8'),
    ) as SearchCorporateOutput;
    const searchVm = buildSearchResultsViewModel(searchFixture);
    expect(searchVm.total_count).toBe(2);
    expect(searchVm.results).toHaveLength(2);
    expect(searchVm.results[0]?.lookup_args).toEqual({ corporate_number: '5111101000006' });
  });

  it('ensures src/ui does not use innerHTML or insertAdjacentHTML and uses VERSION from src/version.ts', () => {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')) as {
      version: string;
    };
    expect(VERSION).toBe(pkgJson.version);

    const uiFiles = [
      path.join(REPO_ROOT, 'src/ui/shared.ts'),
      path.join(REPO_ROOT, 'src/ui/corporate-card/main.ts'),
      path.join(REPO_ROOT, 'src/ui/search-results/main.ts'),
    ];
    for (const filePath of uiFiles) {
      const code = fs.readFileSync(filePath, 'utf-8');
      expect(code).not.toContain('innerHTML');
      expect(code).not.toContain('insertAdjacentHTML');
    }

    const cardMain = fs.readFileSync(
      path.join(REPO_ROOT, 'src/ui/corporate-card/main.ts'),
      'utf-8',
    );
    const searchMain = fs.readFileSync(
      path.join(REPO_ROOT, 'src/ui/search-results/main.ts'),
      'utf-8',
    );
    expect(cardMain).toContain('version: VERSION');
    expect(searchMain).toContain('version: VERSION');
  });

  it('loads built UI HTML resources via import.meta.url even when process.cwd() is a different directory', async () => {
    const originalCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houjin-ui-cwd-test-'));
    try {
      process.chdir(tempDir);
      expect(process.cwd()).not.toBe(REPO_ROOT);

      const cardRes = await client.readResource({ uri: 'ui://corporate-card/mcp-app.html' });
      const cardText = (cardRes.contents[0] as { text?: string })?.text ?? '';
      expect(cardText.toLowerCase()).toContain('<!doctype html>');
      expect(cardText).not.toContain('is not built yet');

      const searchRes = await client.readResource({ uri: 'ui://search-results/mcp-app.html' });
      const searchText = (searchRes.contents[0] as { text?: string })?.text ?? '';
      expect(searchText.toLowerCase()).toContain('<!doctype html>');
      expect(searchText).not.toContain('is not built yet');
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('formatPostalCodeDisplay', () => {
  it('formats exactly seven digits as NNN-NNNN', () => {
    expect(formatPostalCodeDisplay('4710826')).toBe('471-0826');
    expect(formatPostalCodeDisplay('1000000')).toBe('100-0000');
  });

  it('leaves values that are not seven digits unchanged', () => {
    expect(formatPostalCodeDisplay('471-0826')).toBe('471-0826');
    expect(formatPostalCodeDisplay('123')).toBe('123');
    expect(formatPostalCodeDisplay('12345678')).toBe('12345678');
    expect(formatPostalCodeDisplay('１２３４５６７')).toBe('１２３４５６７');
    expect(formatPostalCodeDisplay('471 0826')).toBe('471 0826');
  });

  it('shows 未登録 when the postal code is missing', () => {
    expect(formatPostalCodeDisplay(null)).toBe('未登録');
    expect(formatPostalCodeDisplay('')).toBe('未登録');
    expect(formatPostalCodeDisplay('   ')).toBe('未登録');
  });
});
