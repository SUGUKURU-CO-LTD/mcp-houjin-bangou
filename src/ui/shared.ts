/**
 * MCP Apps UI 共通の型定義・純粋変換関数 (v1.8 ツール出力準拠)
 *
 * DOM API を一切使用しない純粋関数として定義し、Node.js 環境の単体テストで
 * 実際のツール出力 (structuredContent) から表示値・再検索引数を直接検証できるようにする。
 */

export const ADDRESS_OUTDATED_WARNING =
  '※登記上の所在地の表記が、住居表示の実施等により現在の住所と異なる可能性があります。';

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

export interface StatusBadgeViewModel {
  status: 'active' | 'closed';
  label: string;
  className: 'active' | 'closed';
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
  address_may_be_outdated: boolean;
  address_warning: string | null;
  data_as_of: string | null;
  attribution: string | null;
  search_similar_args: { name: string };
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
 * 「類似商号を検索」ボタンが search_corporate_by_name に渡す引数を生成する。
 * v1.8 仕様に従い { name } のみを渡す。
 */
export function buildSearchSimilarArgs(name: string): { name: string } {
  return { name };
}

/**
 * 検索結果行クリック時に lookup_corporate_by_number に渡す引数を生成する。
 * v1.8 仕様に従い { corporate_number } のみを渡す。
 */
export function buildLookupByNumberArgs(corporateNumber: string): { corporate_number: string } {
  return { corporate_number: corporateNumber };
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
          address_may_be_outdated: fallbackFromResults.address_may_be_outdated,
        }
      : null);

  if (!corp) return null;

  const isOutdated = corp.address_may_be_outdated === true;
  const normalizedStatus: 'active' | 'closed' = corp.status === 'closed' ? 'closed' : 'active';
  const nameKana = corp.name_kana && corp.name_kana.trim() !== '' ? corp.name_kana : null;
  const postCode = corp.post_code && corp.post_code.trim() !== '' ? corp.post_code : null;
  const closeDate = corp.close_date && corp.close_date.trim() !== '' ? corp.close_date : null;
  const closeCause = corp.close_cause && corp.close_cause.trim() !== '' ? corp.close_cause : null;

  return {
    corporate_number: corp.corporate_number,
    name: corp.name,
    name_kana: nameKana,
    name_kana_display: nameKana ?? '未登録',
    legal_type: corp.legal_type,
    location: corp.location,
    post_code: postCode,
    post_code_display: postCode ?? '未登録',
    update_date: corp.update_date,
    status: normalizedStatus,
    status_badge: statusBadge(normalizedStatus),
    close_date: closeDate,
    close_cause: closeCause,
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
