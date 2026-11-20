/**
 * MCP Apps UI pure view-model, CSP hash pipeline & resource resolution tests
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
import { SHARED_UI_META } from '../../src/resources/ui-resources.js';
import type { NtaClient } from '../../src/api/nta-client.js';
import { createMcpLogger } from '../../src/lib/mcp-logger.js';
import { Result } from '../../src/lib/result.js';
import { VERSION } from '../../src/version.js';
import { injectCspIntoHtml, sha256Base64 } from '../../scripts/compute-csp-hashes.js';
import {
  ADDRESS_OUTDATED_WARNING,
  INDIVIDUAL_PRIVACY_NOTICE,
  INVOICE_NOT_FOUND_NOTICE,
  buildCorporateCardViewModel,
  buildCorporateMasterCopyText,
  buildInvoiceCardViewModel,
  buildLookupByNumberArgs,
  buildLookupInvoiceArgs,
  buildNtaHistoryUrl,
  buildPaginatedSearchArgs,
  buildSearchResultsViewModel,
  buildSearchSimilarArgs,
  extractQueryContextFromCursor,
  extractReferenceDateFromContent,
  extractSearchQueryFromContent,
  extractToolErrorViewModel,
  formatPostalCodeDisplay,
  isInvoiceOutput,
  type LookupCorporateOutput,
  type SearchCorporateOutput,
} from '../../src/ui/shared.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

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
  close_cause: '01',
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

describe('MCP Apps UI View-Model & Resource Resolution', () => {
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

  it('builds corporate-card view model and button args from lookup_corporate_by_number output (active + address_may_be_outdated)', async () => {
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
    expect(vm.successor_corporate_number).toBeNull();
    expect(vm.location).toBe('東京都千代田区神田小川町');
    expect(vm.post_code).toBe('1000000');
    expect(vm.post_code_display).toBe('100-0000');
    expect(vm.update_date).toBe('2019-04-03');
    expect(vm.data_as_of).toBe('2019-04-05');
    expect(vm.address_may_be_outdated).toBe(true);
    expect(vm.address_warning).toBe(ADDRESS_OUTDATED_WARNING);

    expect(typeof structured.attribution).toBe('string');
    expect(vm.attribution).toBe(structured.attribution);

    expect(vm.search_similar_args).toEqual({ name: '検索対象除外' });
    expect(Object.keys(vm.search_similar_args)).toEqual(['name']);
    expect(buildSearchSimilarArgs('株式会社検索対象除外')).toEqual({
      name: '検索対象除外',
    });
    expect(buildSearchSimilarArgs('スグクル株式会社')).toEqual({
      name: 'スグクル',
    });
    expect(buildSearchSimilarArgs('医療法人社団葵会')).toEqual({
      name: '葵会',
    });
    expect(buildSearchSimilarArgs('Ａｐｐｌｅ\u3000Ｊａｐａｎ合同会社')).toEqual({
      name: 'Ａｐｐｌｅ\u3000Ｊａｐａｎ',
    });
    // 法人格単独の場合は空文字にせず元の文字列を維持する
    expect(buildSearchSimilarArgs('株式会社')).toEqual({
      name: '株式会社',
    });

    // 取引先マスタ登録用・一括コピー文字列（TSV）の検証
    const masterCopy = buildCorporateMasterCopyText(vm);
    expect(masterCopy).toContain('商号又は名称\t株式会社検索対象除外');
    expect(masterCopy).toContain('フリガナ\tカブシキガイシャケンサクタイショウジョガイ');
    expect(masterCopy).toContain('法人番号\t5111101000006');
    expect(masterCopy).toContain('郵便番号\t100-0000');
    expect(masterCopy).toContain('本店所在地\t東京都千代田区神田小川町');
    expect(masterCopy).toContain('データ時点\t2019-04-05');
  });

  it('builds corporate-card view model from lookup_corporate_by_number output (closed corporation & successor_corporate_number)', async () => {
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
    expect(vm.successor_corporate_number).toBeNull();
    expect(vm.location).toBe('鹿児島県霧島市国分中央１丁目２−３２');
    expect(vm.post_code).toBe('8994332');
    expect(vm.post_code_display).toBe('899-4332');
    expect(vm.update_date).toBe('2026-07-15');
    expect(vm.data_as_of).toBe('2026-08-05');
    expect(vm.address_may_be_outdated).toBe(false);
    expect(vm.address_warning).toBeNull();
    expect(vm.attribution).toBe(structured.attribution);

    // 吸収合併等の承継先法人番号が含まれるケース
    const mergedVm = buildCorporateCardViewModel({
      ...structured,
      corporation: structured.corporation
        ? {
            ...structured.corporation,
            close_cause: '吸収合併',
            successor_corporate_number: '8040001999013',
          }
        : null,
    });
    expect(mergedVm?.successor_corporate_number).toBe('8040001999013');
    expect(buildNtaHistoryUrl('8040001999013')).toBe(
      'https://www.houjin-bangou.nta.go.jp/henkorireki-johoto.html?selHouzinNo=8040001999013',
    );
  });

  it('builds search-results view model and pagination/lookup args from search_corporate_by_name output', async () => {
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
    expect(
      buildPaginatedSearchArgs(
        { name: '多数件', prefecture: '13', limit: 10 },
        pagedVm.next_cursor,
      ),
    ).toEqual({
      name: '多数件',
      prefecture: '13',
      limit: 10,
      cursor: pagedVm.next_cursor,
    });

    // toolinput 無しで toolresult 単体が届いた場合の next_cursor / content からの復元検証
    expect(extractQueryContextFromCursor(pagedVm.next_cursor)).toEqual({
      name: '多数件',
    });
    const prefRes = await client.callTool({
      name: 'search_corporate_by_name',
      arguments: { name: '多数件', prefecture: '46', limit: 5 },
    });
    const prefSc = prefRes.structuredContent as SearchCorporateOutput;
    expect(extractQueryContextFromCursor(prefSc.next_cursor)).toEqual({
      name: '多数件',
      prefecture: '46',
    });
    expect(extractQueryContextFromCursor('not-valid-base64-json')).toBeNull();
    expect(extractQueryContextFromCursor(null)).toBeNull();
    expect(
      extractSearchQueryFromContent([
        { type: 'text', text: '「スグクル」の検索結果です（全 1 件中 1 件を表示）。' },
      ]),
    ).toBe('スグクル');
    expect(
      extractReferenceDateFromContent([
        { type: 'text', text: '基準日（2026-10-01）時点で有効な登録事業者でした。' },
      ]),
    ).toBe('2026-10-01');
  });

  it('builds invoice-card view model across corporation, individual (PII-protected), cancelled, and not_found states', () => {
    const corpRaw = {
      registration_number: 'T9340001026142',
      status: 'registered' as const,
      business_type: 'corporation' as const,
      registration_date: '2023-10-01',
      cancellation_date: null,
      expiration_date: null,
      corporate_name: 'スグクル株式会社',
      location: '鹿児島県霧島市国分中央１丁目２−３２',
      was_registered_on_reference_date: true,
      data_as_of: '2026-10-01',
      attribution: '出典：国税庁適格請求書発行事業者公表サイト',
      tax_disclaimer: '税務判断は行いません。',
    };
    expect(isInvoiceOutput(corpRaw)).toBe(true);
    expect(isInvoiceOutput({ corporation: { corporate_number: '9340001026142' } })).toBe(false);

    const corpVm = buildInvoiceCardViewModel(corpRaw);
    expect(corpVm).not.toBeNull();
    expect(corpVm?.status_badge.label).toBe('登録有効');
    expect(corpVm?.entity_type).toBe('corporation');
    expect(corpVm?.derived_corporate_number).toBe('9340001026142');
    expect(corpVm?.lookup_corporate_args).toEqual({ corporate_number: '9340001026142' });
    expect(corpVm?.reference_date_verdict?.valid).toBe(true);
    expect(corpVm?.individual_privacy_notice).toBeNull();
    expect(buildLookupInvoiceArgs('9340001026142', '2024-04-01')).toEqual({
      registration_number: 'T9340001026142',
      reference_date: '2024-04-01',
    });

    // 個人事業者: 万一 corporate_name / location が渡されても強制マスクされること
    const indivVm = buildInvoiceCardViewModel({
      registration_number: 'T1000000000001',
      status: 'registered',
      business_type: 'individual',
      registration_date: '2023-10-01',
      corporate_name: '表示してはならない氏名',
      location: '表示してはならない住所',
      was_registered_on_reference_date: null,
      data_as_of: '2026-10-01',
      attribution: '出典：国税庁適格請求書発行事業者公表サイト',
      tax_disclaimer: '税務判断は行いません。',
    });
    expect(indivVm?.entity_type).toBe('individual');
    expect(indivVm?.corporate_name).toBeNull();
    expect(indivVm?.location).toBeNull();
    expect(indivVm?.derived_corporate_number).toBeNull();
    expect(indivVm?.individual_privacy_notice).toBe(INDIVIDUAL_PRIVACY_NOTICE);

    // 該当なし (not_found)
    const notFoundVm = buildInvoiceCardViewModel({
      registration_number: 'T9999999999999',
      status: 'not_found',
      business_type: 'unknown',
      was_registered_on_reference_date: false,
      data_as_of: '2026-10-01',
      attribution: '出典',
      tax_disclaimer: '免責',
    });
    expect(notFoundVm?.status_badge.label).toBe('該当なし（未登録または公表対象外）');
    expect(notFoundVm?.not_found_notice).toBe(INVOICE_NOT_FOUND_NOTICE);
    expect(notFoundVm?.reference_date_verdict?.valid).toBe(false);
  });

  it('extracts tool error view model from both _meta.error and structuredContent.error + content fallback', () => {
    expect(
      extractToolErrorViewModel({ isError: false, content: [{ type: 'text', text: 'ok' }] }),
    ).toBeNull();

    // New _meta.error contract (#10)
    const metaErr = extractToolErrorViewModel({
      isError: true,
      _meta: { error: { code: 'DATA_UNAVAILABLE', message: 'DB未接続です' } },
      content: [{ type: 'text', text: '[DATA_UNAVAILABLE] DB未接続です' }],
    });
    expect(metaErr).toEqual({
      code: 'DATA_UNAVAILABLE',
      message: 'DB未接続です',
      is_data_unavailable: true,
      is_rate_limited: false,
      is_not_found: false,
      is_invalid_input: false,
    });

    // Legacy structuredContent.error contract
    const scErr = extractToolErrorViewModel({
      isError: true,
      structuredContent: { error: { code: 'RATE_LIMITED', message: '上限超過' } },
      content: [{ type: 'text', text: '上限超過' }],
    });
    expect(scErr?.code).toBe('RATE_LIMITED');
    expect(scErr?.is_rate_limited).toBe(true);
    expect(scErr?.message).toBe('上限超過');

    // Text-only fallback with [CODE] prefix
    const textOnlyErr = extractToolErrorViewModel({
      isError: true,
      content: [{ type: 'text', text: '[INVALID_INPUT] チェックデジット不一致' }],
    });
    expect(textOnlyErr?.code).toBe('INVALID_INPUT');
    expect(textOnlyErr?.is_invalid_input).toBe(true);
    expect(textOnlyErr?.message).toBe('チェックデジット不一致');
  });

  it('exposes UI resource metadata (description, zero-network CSP, clipboardWrite permission, prefersBorder: false) on list & read', async () => {
    const listed = await client.listResources();
    expect(listed.resources).toHaveLength(2);
    for (const res of listed.resources) {
      expect(typeof res.description).toBe('string');
      expect((res.description ?? '').length).toBeGreaterThan(0);
      expect((res._meta as { ui?: unknown } | undefined)?.ui).toEqual(SHARED_UI_META);
    }

    const readCard = await client.readResource({ uri: 'ui://corporate-card/mcp-app.html' });
    const firstContent = readCard.contents[0] as { _meta?: { ui?: unknown } } | undefined;
    expect(firstContent?._meta?.ui).toEqual(SHARED_UI_META);
  });

  it('verifies UI fixtures match view models', () => {
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

  it('ensures src/ui uses safe DOM creation only and uses VERSION from src/version.ts', () => {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')) as {
      version: string;
    };
    expect(VERSION).toBe(pkgJson.version);

    const uiFiles = [
      path.join(REPO_ROOT, 'src/ui/shared.ts'),
      path.join(REPO_ROOT, 'src/ui/views.ts'),
      path.join(REPO_ROOT, 'src/ui/main.ts'),
      path.join(REPO_ROOT, 'src/ui/corporate-card/main.ts'),
      path.join(REPO_ROOT, 'src/ui/search-results/main.ts'),
    ];
    for (const filePath of uiFiles) {
      const code = fs.readFileSync(filePath, 'utf-8');
      expect(code).not.toContain('innerHTML');
      expect(code).not.toContain('insertAdjacentHTML');
    }

    const sharedMain = fs.readFileSync(path.join(REPO_ROOT, 'src/ui/main.ts'), 'utf-8');
    const cardMain = fs.readFileSync(
      path.join(REPO_ROOT, 'src/ui/corporate-card/main.ts'),
      'utf-8',
    );
    const searchMain = fs.readFileSync(
      path.join(REPO_ROOT, 'src/ui/search-results/main.ts'),
      'utf-8',
    );
    expect(sharedMain).toContain('version: VERSION');
    expect(cardMain).toContain('version: VERSION');
    expect(searchMain).toContain('version: VERSION');

    const stylesCss = fs.readFileSync(path.join(REPO_ROOT, 'src/ui/styles.css'), 'utf-8');
    expect(stylesCss).not.toContain('75vh');
    expect(stylesCss).not.toContain('78vh');
    expect(stylesCss).toContain(":root[data-theme='light']");
    expect(stylesCss).toContain('color-scheme: light;');
    expect(stylesCss).toContain('color-scheme: dark;');
  });

  it('computes exact SHA-256 CSP hashes and keeps <meta charset> first in <head>', () => {
    const sampleScript = 'console.log("hellohoujin");';
    const sampleStyle = 'body { color: CanvasText; }';
    const rawHtml = [
      '<!doctype html>',
      '<html lang="ja">',
      '  <head>',
      '    <meta charset="UTF-8" />',
      `    <style>${sampleStyle}</style>`,
      `    <script type="module">${sampleScript}</script>`,
      '  </head>',
      '  <body><main id="app"></main></body>',
      '</html>',
    ].join('\n');

    const injected = injectCspIntoHtml(rawHtml);
    const charsetIdx = injected.indexOf('<meta charset="UTF-8"');
    const cspIdx = injected.indexOf('http-equiv="Content-Security-Policy"');
    const styleIdx = injected.indexOf('<style>');
    expect(charsetIdx).toBeGreaterThan(-1);
    expect(cspIdx).toBeGreaterThan(charsetIdx);
    expect(styleIdx).toBeGreaterThan(cspIdx);
    expect(injected).toContain(`'sha256-${sha256Base64(sampleScript)}'`);
    expect(injected).toContain(`'sha256-${sha256Base64(sampleStyle)}'`);
    expect(injected).toContain("default-src 'none'");
    expect(injected).toContain("connect-src 'none'");

    // Idempotent re-injection
    const reinjected = injectCspIntoHtml(injected);
    expect(reinjected.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
  });

  it('loads UI HTML resources via import.meta.url even when process.cwd() is a different directory', async () => {
    const sharedDistPath = path.join(REPO_ROOT, 'dist/ui/mcp-app.html');
    const hasBuiltShared = fs.existsSync(sharedDistPath);
    if (hasBuiltShared) {
      const stat = fs.statSync(sharedDistPath);
      expect(stat.size).toBeLessThan(600_000);
    }

    const originalCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houjin-ui-cwd-test-'));
    try {
      process.chdir(tempDir);
      expect(process.cwd()).not.toBe(REPO_ROOT);

      const cardRes = await client.readResource({ uri: 'ui://corporate-card/mcp-app.html' });
      const cardText = (cardRes.contents[0] as { text?: string })?.text ?? '';
      expect(cardText.toLowerCase()).toContain('<!doctype html>');
      expect(cardText).toContain('http-equiv="Content-Security-Policy"');
      expect(cardText).toContain('name="text-scale" content="scale"');
      if (hasBuiltShared) {
        expect(cardText).not.toContain('is not built yet');
        expect(cardText).toContain('data-default-mode="corporate-card"');
      }

      const searchRes = await client.readResource({ uri: 'ui://search-results/mcp-app.html' });
      const searchText = (searchRes.contents[0] as { text?: string })?.text ?? '';
      expect(searchText.toLowerCase()).toContain('<!doctype html>');
      expect(searchText).toContain('http-equiv="Content-Security-Policy"');
      expect(searchText).toContain('name="text-scale" content="scale"');
      if (hasBuiltShared) {
        expect(searchText).not.toContain('is not built yet');
        expect(searchText).toContain('data-default-mode="search-results"');
      }
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
