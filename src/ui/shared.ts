/**
 * MCP Apps UI 共通の型定義・純粋変換関数
 *
 * DOM API を一切使用しない純粋関数として定義し、Node.js 環境の単体テストで
 * 実際のツール出力 (structuredContent / _meta) から表示値・再検索引数を直接検証できるようにする。
 */

export const ADDRESS_OUTDATED_WARNING =
  '※登記上の所在地の表記が、住居表示の実施等により現在の住所と異なる可能性があります。';

export const INDIVIDUAL_PRIVACY_NOTICE =
  '個人事業者のため、個人情報保護および公表サイト利用規約に基づき氏名・屋号・所在地は表示されません。';

export const INVOICE_NOT_FOUND_NOTICE =
  '※公表データに該当がないことを示すものであり、未登録であることを確定するものではありません（登録直後で月次公表データに未反映の可能性があります）。';

/**
 * 郵便番号が半角数字7桁のときだけ「471-0826」の形にして表示する。
 * ツールが返す post_code 自体は変えない。表示用の文字列だけを返す。
 */
export function formatPostalCodeDisplay(postCode: string | null): string {
  if (postCode === null || postCode.trim() === '') return '未登録';
  if (/^[0-9]{7}$/.test(postCode)) {
    return `${postCode.slice(0, 3)}-${postCode.slice(3)}`;
  }
  return postCode;
}

export interface CorporationRecord {
  corporate_number: string;
  name: string;
  name_kana: string | null;
  legal_type: string;
  location: string;
  post_code: string | null;
  update_date: string;
  status: 'active' | 'closed';
  close_date: string | null;
  close_cause: string | null;
  successor_corporate_number?: string | null;
  address_may_be_outdated?: boolean;
}

export interface SearchResultRecord {
  corporate_number: string;
  name: string;
  legal_type: string;
  location: string;
  update_date: string;
  status: 'active' | 'closed';
  address_may_be_outdated?: boolean;
}

export interface LookupCorporateOutput {
  corporation?: CorporationRecord | null;
  data_as_of?: string;
  attribution?: string;
  results?: SearchResultRecord[];
}

export interface SearchCorporateOutput {
  results?: SearchResultRecord[];
  total_count?: number | null;
  next_cursor?: string | null;
  data_as_of?: string;
  attribution?: string;
  corporation?: CorporationRecord | null;
}

export type InvoiceRegistrationStatus = 'registered' | 'cancelled' | 'expired' | 'not_found';
export type InvoiceBusinessType = 'corporation' | 'individual' | 'other' | 'unknown';

export interface LookupInvoiceOutput {
  registration_number?: string;
  status?: InvoiceRegistrationStatus;
  business_type?: InvoiceBusinessType;
  entity_type?: InvoiceBusinessType;
  registration_date?: string | null;
  cancellation_date?: string | null;
  expiration_date?: string | null;
  corporate_name?: string | null;
  location?: string | null;
  was_registered_on_reference_date?: boolean | null;
  data_as_of?: string;
  attribution?: string;
  tax_disclaimer?: string;
}

export interface StatusBadgeViewModel {
  status: 'active' | 'closed';
  label: string;
  className: 'active' | 'closed';
}

export interface InvoiceStatusBadgeViewModel {
  status: InvoiceRegistrationStatus;
  label: string;
  glyph: string;
  className: 'registered' | 'cancelled' | 'expired' | 'not-found';
}

export interface CorporateCardViewModel {
  corporate_number: string;
  name: string;
  name_kana: string | null;
  name_kana_display: string;
  legal_type: string;
  location: string;
  post_code: string | null;
  post_code_display: string;
  update_date: string;
  status: 'active' | 'closed';
  status_badge: StatusBadgeViewModel;
  close_date: string | null;
  close_cause: string | null;
  successor_corporate_number: string | null;
  address_may_be_outdated: boolean;
  address_warning: string | null;
  data_as_of: string | null;
  attribution: string | null;
  search_similar_args: { name: string };
}

export interface InvoiceCardViewModel {
  registration_number: string;
  status: InvoiceRegistrationStatus;
  status_badge: InvoiceStatusBadgeViewModel;
  business_type: InvoiceBusinessType;
  entity_type: InvoiceBusinessType;
  business_type_label: string;
  corporate_name: string | null;
  location: string | null;
  registration_date: string | null;
  cancellation_date: string | null;
  expiration_date: string | null;
  was_registered_on_reference_date: boolean | null;
  reference_date_verdict: {
    valid: boolean;
    label: string;
    glyph: string;
    className: 'active' | 'closed';
  } | null;
  derived_corporate_number: string | null;
  lookup_corporate_args: { corporate_number: string } | null;
  individual_privacy_notice: string | null;
  not_found_notice: string | null;
  data_as_of: string | null;
  attribution: string | null;
  tax_disclaimer: string | null;
}

export interface SearchResultRowViewModel {
  corporate_number: string;
  name: string;
  legal_type: string;
  location: string;
  update_date: string;
  status: 'active' | 'closed';
  status_badge: StatusBadgeViewModel;
  address_may_be_outdated: boolean;
  lookup_args: { corporate_number: string };
}

export interface SearchResultsViewModel {
  results: SearchResultRowViewModel[];
  total_count: number | null;
  returned_count: number;
  summary_text: string;
  next_cursor: string | null;
  data_as_of: string | null;
  attribution: string | null;
  address_warning: string | null;
}

export interface SearchQueryContext {
  name: string;
  prefecture?: string;
  limit?: number;
}

export interface ToolErrorInput {
  isError?: boolean;
  _meta?: Record<string, unknown>;
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type?: string; text?: string }>;
}

export interface ToolErrorViewModel {
  code: string | null;
  message: string;
  is_data_unavailable: boolean;
  is_rate_limited: boolean;
  is_not_found: boolean;
  is_invalid_input: boolean;
}

/**
 * status ('active' | 'closed') から表示用バッジ情報を生成する。
 */
export function statusBadge(status: 'active' | 'closed'): StatusBadgeViewModel {
  if (status === 'closed') {
    return {
      status: 'closed',
      label: '閉鎖 (closed)',
      className: 'closed',
    };
  }
  return {
    status: 'active',
    label: '登記中 (active)',
    className: 'active',
  };
}

/**
 * インボイス登録状態から表示用バッジ情報を生成する。
 */
export function invoiceStatusBadge(status: InvoiceRegistrationStatus): InvoiceStatusBadgeViewModel {
  switch (status) {
    case 'registered':
      return {
        status: 'registered',
        label: '登録有効',
        glyph: '●',
        className: 'registered',
      };
    case 'cancelled':
      return {
        status: 'cancelled',
        label: '登録取消',
        glyph: '■',
        className: 'cancelled',
      };
    case 'expired':
      return {
        status: 'expired',
        label: '登録失効',
        glyph: '▲',
        className: 'expired',
      };
    case 'not_found':
      return {
        status: 'not_found',
        label: '該当なし（未登録または公表対象外）',
        glyph: '○',
        className: 'not-found',
      };
  }
}

const SIMILAR_SEARCH_LEGAL_TYPES: ReadonlyArray<string> = [
  '特定非営利活動法人',
  '社会保険労務士法人',
  '土地家屋調査士法人',
  '地方独立行政法人',
  '有限責任監査法人',
  '商店街振興組合',
  '一般社団法人',
  '一般財団法人',
  '公益社団法人',
  '公益財団法人',
  '医療法人社団',
  '医療法人財団',
  '社会医療法人',
  '社会福祉法人',
  '更生保護法人',
  '国立大学法人',
  '公立大学法人',
  '独立行政法人',
  '司法書士法人',
  '行政書士法人',
  '特許業務法人',
  '農業協同組合',
  '漁業協同組合',
  '生活協同組合',
  '事業協同組合',
  '管理組合法人',
  '特例有限会社',
  '弁護士法人',
  '税理士法人',
  '弁理士法人',
  '株式会社',
  '有限会社',
  '合同会社',
  '合名会社',
  '合資会社',
  '相互会社',
  '医療法人',
  '学校法人',
  '宗教法人',
  '監査法人',
  '信用金庫',
  '信用組合',
  '労働金庫',
  '協同組合',
  '企業組合',
  '協業組合',
  '商工組合',
  '投資法人',
  'NPO法人',
  '（株）',
  '(株)',
  '㈱',
  '㍿',
  '（有）',
  '(有)',
  '㈲',
  '（同）',
  '(同)',
];

/**
 * 「類似商号を検索」ボタンが search_corporate_by_name に渡す引数を生成する。
 * 先頭・末尾の主要法人格を最長一致で除去し、コア商号で類似法人を広くヒットさせる
 * （除去後に空文字となる場合のみ元の文字列を維持する）。
 */
export function buildSearchSimilarArgs(name: string): { name: string } {
  const trimmed = name.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
  for (const kw of SIMILAR_SEARCH_LEGAL_TYPES) {
    if (trimmed.startsWith(kw)) {
      const stripped = trimmed.slice(kw.length).replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
      if (stripped.length > 0) {
        return { name: stripped };
      }
    }
    if (trimmed.endsWith(kw)) {
      const stripped = trimmed
        .slice(0, trimmed.length - kw.length)
        .replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
      if (stripped.length > 0) {
        return { name: stripped };
      }
    }
  }
  return { name: trimmed || name };
}

/**
 * 取引先マスタ登録用の一括コピー文字列（タブ区切り TSV 行形式）を生成する。
 * Excel / スプレッドシート / ERP / kintone 等へそのまま貼り付け可能な構成とする。
 */
export function buildCorporateMasterCopyText(
  vm: CorporateCardViewModel,
  invVm?: InvoiceCardViewModel | null,
): string {
  const lines: string[] = [
    `商号又は名称\t${vm.name}`,
    `フリガナ\t${vm.name_kana ?? ''}`,
    `法人番号\t${vm.corporate_number}`,
  ];
  if (invVm) {
    if (invVm.status === 'not_found') {
      lines.push(`適格請求書登録番号\t該当なし (${invVm.registration_number} 照会済)`);
    } else {
      lines.push(`適格請求書登録番号\t${invVm.registration_number} (${invVm.status_badge.label})`);
    }
  }
  lines.push(
    `法人種別\t${vm.legal_type}`,
    `郵便番号\t${vm.post_code_display}`,
    `本店所在地\t${vm.location}`,
    `法人状態\t${vm.status_badge.label}`,
  );
  if (vm.close_date !== null) {
    lines.push(`閉鎖年月日\t${vm.close_date}`);
  }
  if (vm.successor_corporate_number !== null) {
    lines.push(`承継先法人番号\t${vm.successor_corporate_number}`);
  }
  if (vm.data_as_of !== null) {
    lines.push(`データ時点\t${vm.data_as_of}`);
  }
  return lines.join('\n');
}

/**
 * next_cursor トークン単体から元の検索条件 (queryContext) を復元する。
 * ホスト再描画等で toolinput を経由せず toolresult のみ届いた場合のページ送りを維持する。
 */
export function extractQueryContextFromCursor(
  cursor: string | null | undefined,
  pageResultCount?: number,
): SearchQueryContext | null {
  if (typeof cursor !== 'string' || cursor.trim() === '') {
    return null;
  }
  try {
    const base64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const decodedJson = new TextDecoder('utf-8').decode(bytes);
    const parsed = JSON.parse(decodedJson) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed['queryKey'] !== 'string') {
      return null;
    }
    const rawOffset = parsed['offset'];
    const inferredLimit =
      typeof pageResultCount === 'number' &&
      typeof rawOffset === 'number' &&
      Number.isInteger(rawOffset) &&
      rawOffset >= 1 &&
      rawOffset <= 20 &&
      pageResultCount === rawOffset
        ? rawOffset
        : undefined;
    const qk = parsed['queryKey'];
    const sepIdx = qk.lastIndexOf('|');
    if (sepIdx <= 0) {
      if (qk.trim() === '') return null;
      return inferredLimit !== undefined
        ? { name: qk.trim(), limit: inferredLimit }
        : { name: qk.trim() };
    }
    const name = qk.slice(0, sepIdx);
    const prefecture = qk.slice(sepIdx + 1);
    if (name.trim() === '') return null;
    const ctx: SearchQueryContext = prefecture !== '' ? { name, prefecture } : { name };
    if (inferredLimit !== undefined) {
      ctx.limit = inferredLimit;
    }
    return ctx;
  } catch {
    return null;
  }
}

/**
 * toolresult の要約テキストから検索語（「...」の検索結果）を補助抽出する。
 */
export function extractSearchQueryFromContent(
  content: Array<{ type?: string; text?: string }> | undefined,
): string | null {
  const text = content?.find((c) => c.type === 'text' && typeof c.text === 'string')?.text ?? '';
  const match = /^「([^」]+)」(?:の検索結果|に一致する法人)/.exec(text.trim());
  return match?.[1] ?? null;
}

/**
 * lookup_invoice_issuer の要約テキストから基準日（YYYY-MM-DD）を補助抽出する。
 */
export function extractReferenceDateFromContent(
  content: Array<{ type?: string; text?: string }> | undefined,
): string {
  const text = content?.find((c) => c.type === 'text' && typeof c.text === 'string')?.text ?? '';
  const match = /基準日（([0-9]{4}-[0-9]{2}-[0-9]{2})）/.exec(text);
  return match?.[1] ?? '';
}

/**
 * ページネーション操作時に search_corporate_by_name に渡す引数を生成する。
 */
export function buildPaginatedSearchArgs(
  query: SearchQueryContext,
  cursor: string | null,
): { name: string; prefecture?: string; limit?: number; cursor?: string } {
  const args: { name: string; prefecture?: string; limit?: number; cursor?: string } = {
    name: query.name,
  };
  if (query.prefecture !== undefined && query.prefecture !== '') {
    args.prefecture = query.prefecture;
  }
  if (typeof query.limit === 'number') {
    args.limit = query.limit;
  }
  if (cursor !== null && cursor !== '') {
    args.cursor = cursor;
  }
  return args;
}

/**
 * 検索結果行クリック時に lookup_corporate_by_number に渡す引数を生成する。
 */
export function buildLookupByNumberArgs(corporateNumber: string): { corporate_number: string } {
  return { corporate_number: corporateNumber };
}

/**
 * 法人カードまたはインボイス再照会から lookup_invoice_issuer に渡す引数を生成する。
 */
export function buildLookupInvoiceArgs(
  numberOrTNumber: string,
  referenceDate?: string | null,
): { registration_number: string; reference_date?: string } {
  const trimmed = numberOrTNumber.trim();
  const registrationNumber = trimmed.startsWith('T') ? trimmed : `T${trimmed}`;
  const cleanDate = referenceDate?.trim() ?? '';
  if (cleanDate !== '') {
    return {
      registration_number: registrationNumber,
      reference_date: cleanDate,
    };
  }
  return { registration_number: registrationNumber };
}

/**
 * 国税庁法人番号公表サイトの変更履歴照会 URL を生成する。
 */
export function buildNtaHistoryUrl(corporateNumber: string): string {
  return `https://www.houjin-bangou.nta.go.jp/henkorireki-johoto.html?selHouzinNo=${encodeURIComponent(corporateNumber)}`;
}

/**
 * ツールが返した attribution 文字列をそのまま取り出す（固定文への置き換えは行わない）。
 */
export function extractAttributionText(attribution: unknown): string | null {
  if (typeof attribution === 'string' && attribution.length > 0) {
    return attribution;
  }
  return null;
}

function nonEmptyOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  return null;
}

/**
 * structuredContent が lookup_invoice_issuer の出力かどうかを判定する。
 */
export function isInvoiceOutput(raw: unknown): raw is LookupInvoiceOutput {
  if (!raw || typeof raw !== 'object') return false;
  const rec = raw as Record<string, unknown>;
  return typeof rec['registration_number'] === 'string' && rec['registration_number'].length > 0;
}

/**
 * lookup_corporate_by_number の出力（または類似商号検索で返った先頭レコード）から
 * Corporate Card 表示用の ViewModel を構築する。
 */
export function buildCorporateCardViewModel(
  output: LookupCorporateOutput | null | undefined,
): CorporateCardViewModel | null {
  if (!output) return null;

  const fallbackFromResults = output.results?.[0];
  const corp: CorporationRecord | null =
    output.corporation ??
    (fallbackFromResults
      ? {
          corporate_number: fallbackFromResults.corporate_number,
          name: fallbackFromResults.name,
          name_kana: null,
          legal_type: fallbackFromResults.legal_type,
          location: fallbackFromResults.location,
          post_code: null,
          update_date: fallbackFromResults.update_date,
          status: fallbackFromResults.status,
          close_date: null,
          close_cause: null,
          successor_corporate_number: null,
          address_may_be_outdated: fallbackFromResults.address_may_be_outdated,
        }
      : null);

  if (!corp || typeof corp.corporate_number !== 'string' || corp.corporate_number === '') {
    return null;
  }

  const isOutdated = corp.address_may_be_outdated === true;
  const normalizedStatus: 'active' | 'closed' = corp.status === 'closed' ? 'closed' : 'active';
  const nameKana = corp.name_kana && corp.name_kana.trim() !== '' ? corp.name_kana : null;
  const postCode = corp.post_code && corp.post_code.trim() !== '' ? corp.post_code : null;
  const closeDate = nonEmptyOrNull(corp.close_date);
  const closeCause = nonEmptyOrNull(corp.close_cause);
  const successorNumber = nonEmptyOrNull(corp.successor_corporate_number);

  return {
    corporate_number: corp.corporate_number,
    name: corp.name,
    name_kana: nameKana,
    name_kana_display: nameKana ?? '未登録',
    legal_type: corp.legal_type,
    location: corp.location,
    post_code: postCode,
    post_code_display: formatPostalCodeDisplay(postCode),
    update_date: corp.update_date,
    status: normalizedStatus,
    status_badge: statusBadge(normalizedStatus),
    close_date: closeDate,
    close_cause: closeCause,
    successor_corporate_number: successorNumber,
    address_may_be_outdated: isOutdated,
    address_warning: isOutdated ? ADDRESS_OUTDATED_WARNING : null,
    data_as_of:
      typeof output.data_as_of === 'string' && output.data_as_of.length > 0
        ? output.data_as_of
        : null,
    attribution: extractAttributionText(output.attribution),
    search_similar_args: buildSearchSimilarArgs(corp.name),
  };
}

const BUSINESS_TYPE_LABELS: Record<InvoiceBusinessType, string> = {
  corporation: '法人',
  individual: '個人事業者',
  other: '人格のない社団等',
  unknown: '不明',
};

function normalizeInvoiceStatus(value: unknown): InvoiceRegistrationStatus {
  if (
    value === 'registered' ||
    value === 'cancelled' ||
    value === 'expired' ||
    value === 'not_found'
  ) {
    return value;
  }
  return 'not_found';
}

function normalizeBusinessType(value: unknown): InvoiceBusinessType {
  if (
    value === 'corporation' ||
    value === 'individual' ||
    value === 'other' ||
    value === 'unknown'
  ) {
    return value;
  }
  return 'unknown';
}

/**
 * lookup_invoice_issuer の出力から Invoice Card 表示用の ViewModel を構築する。
 * 個人事業者 (individual) の場合は防衛的に corporate_name / location を必ず null とする。
 */
export function buildInvoiceCardViewModel(
  raw: LookupInvoiceOutput | Record<string, unknown> | null | undefined,
): InvoiceCardViewModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as LookupInvoiceOutput;
  const regNum = nonEmptyOrNull(rec.registration_number);
  if (regNum === null) return null;

  const status = normalizeInvoiceStatus(rec.status);
  const entityType = normalizeBusinessType(rec.business_type ?? rec.entity_type);
  const isIndividual = entityType === 'individual';

  const corporateName = isIndividual ? null : nonEmptyOrNull(rec.corporate_name);
  const location = isIndividual ? null : nonEmptyOrNull(rec.location);
  const registrationDate = nonEmptyOrNull(rec.registration_date);
  const cancellationDate = nonEmptyOrNull(rec.cancellation_date);
  const expirationDate = nonEmptyOrNull(rec.expiration_date);

  const wasRegistered =
    typeof rec.was_registered_on_reference_date === 'boolean'
      ? rec.was_registered_on_reference_date
      : null;

  const verdict =
    wasRegistered === null
      ? null
      : wasRegistered
        ? {
            valid: true,
            label: '基準日時点で有効な登録事業者',
            glyph: '●',
            className: 'active' as const,
          }
        : {
            valid: false,
            label: '基準日時点では有効な登録事業者ではありません',
            glyph: '■',
            className: 'closed' as const,
          };

  const corpNumMatch = entityType === 'corporation' ? /^T([0-9]{13})$/.exec(regNum) : null;
  const derivedCorporateNumber = corpNumMatch?.[1] ?? null;

  return {
    registration_number: regNum,
    status,
    status_badge: invoiceStatusBadge(status),
    business_type: entityType,
    entity_type: entityType,
    business_type_label: BUSINESS_TYPE_LABELS[entityType],
    corporate_name: corporateName,
    location,
    registration_date: registrationDate,
    cancellation_date: cancellationDate,
    expiration_date: expirationDate,
    was_registered_on_reference_date: wasRegistered,
    reference_date_verdict: verdict,
    derived_corporate_number: derivedCorporateNumber,
    lookup_corporate_args: derivedCorporateNumber
      ? buildLookupByNumberArgs(derivedCorporateNumber)
      : null,
    individual_privacy_notice: isIndividual ? INDIVIDUAL_PRIVACY_NOTICE : null,
    not_found_notice: status === 'not_found' ? INVOICE_NOT_FOUND_NOTICE : null,
    data_as_of: nonEmptyOrNull(rec.data_as_of),
    attribution: extractAttributionText(rec.attribution),
    tax_disclaimer: nonEmptyOrNull(rec.tax_disclaimer),
  };
}

/**
 * search_corporate_by_name の出力（または行クリック再取得の単一 corporation）から
 * Search Results 表示用の ViewModel を構築する。
 */
export function buildSearchResultsViewModel(
  output: SearchCorporateOutput | null | undefined,
): SearchResultsViewModel {
  const rawItems: SearchResultRecord[] =
    output?.results ?? (output?.corporation ? [output.corporation] : []);

  const rows: SearchResultRowViewModel[] = rawItems.map((item) => {
    const normalizedStatus: 'active' | 'closed' = item.status === 'closed' ? 'closed' : 'active';
    return {
      corporate_number: item.corporate_number,
      name: item.name,
      legal_type: item.legal_type,
      location: item.location,
      update_date: item.update_date,
      status: normalizedStatus,
      status_badge: statusBadge(normalizedStatus),
      address_may_be_outdated: item.address_may_be_outdated === true,
      lookup_args: buildLookupByNumberArgs(item.corporate_number),
    };
  });

  const totalCount =
    typeof output?.total_count === 'number' ? output.total_count : output?.corporation ? 1 : null;
  const returnedCount = rows.length;
  const summaryText =
    totalCount !== null
      ? `全 ${totalCount} 件中 ${returnedCount} 件を表示`
      : `${returnedCount} 件を表示`;

  const hasOutdated = rows.some((r) => r.address_may_be_outdated);

  return {
    results: rows,
    total_count: totalCount,
    returned_count: returnedCount,
    summary_text: summaryText,
    next_cursor:
      typeof output?.next_cursor === 'string' && output.next_cursor.length > 0
        ? output.next_cursor
        : null,
    data_as_of:
      typeof output?.data_as_of === 'string' && output.data_as_of.length > 0
        ? output.data_as_of
        : null,
    attribution: extractAttributionText(output?.attribution),
    address_warning: hasOutdated ? ADDRESS_OUTDATED_WARNING : null,
  };
}

function extractRawErrorObject(
  container: Record<string, unknown> | undefined,
): { code?: string; message?: string } | null {
  if (!container || typeof container !== 'object') return null;
  const err = container['error'];
  if (!err || typeof err !== 'object') return null;
  const errRec = err as Record<string, unknown>;
  const code = typeof errRec['code'] === 'string' ? errRec['code'] : undefined;
  const message = typeof errRec['message'] === 'string' ? errRec['message'] : undefined;
  if (code === undefined && message === undefined) return null;
  return { code, message };
}

/**
 * ツール実行エラー応答 (`_meta.error` または旧 `structuredContent.error` + `content` フォールバック)
 * から UI 表示用のエラー ViewModel を抽出する。
 */
export function extractToolErrorViewModel(
  params: ToolErrorInput | null | undefined,
): ToolErrorViewModel | null {
  if (!params) return null;

  const metaError = extractRawErrorObject(params._meta);
  const structuredError = extractRawErrorObject(params.structuredContent);
  const explicitError = metaError ?? structuredError;

  if (params.isError !== true && explicitError === null) {
    return null;
  }

  const contentText =
    params.content?.find((c) => c.type === 'text' && typeof c.text === 'string')?.text?.trim() ??
    '';

  let code: string | null = explicitError?.code ?? null;
  let message = explicitError?.message?.trim() ?? '';

  if (contentText !== '') {
    const prefixMatch = /^\[([A-Z0-9_]+)\]\s*([\s\S]+)$/.exec(contentText);
    if (prefixMatch) {
      if (code === null && prefixMatch[1]) {
        code = prefixMatch[1];
      }
      if (message === '' && prefixMatch[2]) {
        message = prefixMatch[2].trim();
      }
    } else if (message === '') {
      message = contentText;
    }
  }

  if (code !== null && message.startsWith(`[${code}]`)) {
    message = message.slice(code.length + 2).trim();
  }

  if (message === '') {
    message = 'ツールの実行中にエラーが発生しました。時間をおいて再試行してください。';
  }

  return {
    code,
    message,
    is_data_unavailable: code === 'DATA_UNAVAILABLE',
    is_rate_limited: code === 'RATE_LIMITED',
    is_not_found: code === 'NOT_FOUND',
    is_invalid_input: code === 'INVALID_INPUT',
  };
}
