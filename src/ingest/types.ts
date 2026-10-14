/**
 * Ingest Types & Interfaces
 *
 * 根拠 / Source: docs/plan/corp-check-interface-v1.md §6.1, §6.2 (v1.6 凍結仕様)
 */

export interface CorporateCsvRow {
  sequenceNumber: string; // 項番1: 一連番号
  corporateNumber: string; // 項番2: 法人番号 (13桁)
  process?: string; // 項番3: 処理区分
  correct?: string; // 項番4: 訂正区分
  updateDate: string; // 項番5: 更新年月日 (YYYY-MM-DD)
  changeDate?: string; // 項番6: 変更年月日
  name: string; // 項番7: 商号又は名称
  nameImageId?: string; // 項番8: 商号又は名称イメージID
  kind: string; // 項番9: 法人種別 (101, 201, 301, etc.)
  prefectureName?: string; // 項番10: 国内所在地（都道府県）
  cityName?: string; // 項番11: 国内所在地（市区町村）
  streetNumber?: string; // 項番12: 国内所在地（丁目番地等）
  addressImageId?: string; // 項番13: 国内所在地イメージID
  prefectureCode?: string; // 項番14: 都道府県コード (01-47)
  cityCode?: string; // 項番15: 市区町村コード
  postCode?: string; // 項番16: 郵便番号
  addressOutside?: string; // 項番17: 国外所在地
  addressOutsideImageId?: string; // 項番18: 国外所在地イメージID
  closeDate?: string; // 項番19: 登記記録の閉鎖等年月日
  closeCause?: string; // 項番20: 登記記録の閉鎖等の事由
  successorCorporateNumber?: string; // 項番21: 承継先法人番号
  changeCause?: string; // 項番22: 変更事由の詳細
  assignmentDate?: string; // 項番23: 法人番号指定年月日
  latest?: string; // 項番24: 最新履歴区分 (1:最新, 0:過去)
  enName?: string; // 項番25: 商号又は名称（英語表記）
  enPrefectureName?: string; // 項番26: 国内所在地（都道府県）（英語表記）
  enCityName?: string; // 項番27: 国内所在地（市区町村）（英語表記）
  enAddressOutside?: string; // 項番28: 国外所在地（英語表記）
  furigana?: string; // 項番29: フリガナ
  hihyoji?: string; // 項番30: 検索対象除外 (0: 検索対象, 1: 検索対象除外)
}

/**
 * インボイス公表CSV行（公式24列仕様）
 *
 * 出典 / Source:
 *   国税庁 適格請求書発行事業者公表システム
 *   「ダウンロードデータ（全件データ・差分データ）のリソース定義書」1.5版（第2編 10〜13ページ、項番7〜30の24列）
 *   URL: https://www.invoice-kohyo.nta.go.jp/files/k-resource-dl.pdf （確認日: 2026-10-14）
 *   ダウンロードページ: https://www.invoice-kohyo.nta.go.jp/download/index.html （確認日: 2026-10-14）
 *   お知らせ（令和4年9月26日からの個人項目削除）: https://www.invoice-kohyo.nta.go.jp/news/r04/r04news04.html （確認日: 2026-10-14）
 *
 * ※ 23列目（項番29: 主たる屋号）および24列目（項番30: 通称・旧姓）は個人用項目のため保持しない。
 * ※ 人格区分（kind）が '1'（個人）の行、および区分が不明な行は、名称・所在地・カナを保持しない。
 */
export interface InvoiceCsvRow {
  sequenceNumber: string; // 列1 (項番7): 一連番号 (1〜8桁数字)
  registrationNumber: string; // 列2 (項番8): 登録番号 (T+13桁数字)
  process: string; // 列3 (項番9): 事業者処理区分 (01, 02, 03, 04, 99)
  correct: string; // 列4 (項番10): 訂正区分 (0, 1)
  kind: string; // 列5 (項番11): 人格区分 (1:個人, 2:法人（人格のない社団等を含む）)
  country?: string; // 列6 (項番12): 国内外区分 (1:国内, 2:国外, 3:特定国外事業者)
  latest: string; // 列7 (項番13): 最新履歴 (0:過去情報, 1:最新情報)
  registrationDate?: string; // 列8 (項番14): 登録年月日 (YYYY-MM-DD)
  updateDate: string; // 列9 (項番15): 更新年月日 (YYYY-MM-DD)
  cancelDate?: string; // 列10 (項番16): 取消年月日 (YYYY-MM-DD)
  expireDate?: string; // 列11 (項番17): 失効年月日 (YYYY-MM-DD)
  headOfficeAddress?: string; // 列12 (項番18): 本店又は主たる事務所の所在地（法人）
  headOfficePrefectureCode?: string; // 列13 (項番19): 本店又は主たる事務所の所在地都道府県コード（法人）
  headOfficeCityCode?: string; // 列14 (項番20): 本店又は主たる事務所の所在地市区町村コード（法人）
  declaredAddress?: string; // 列15 (項番21): 本店又は主たる事務所の所在地（公表申出）
  declaredPrefectureCode?: string; // 列16 (項番22): 本店又は主たる事務所の所在地都道府県コード（公表申出）
  declaredCityCode?: string; // 列17 (項番23): 本店又は主たる事務所の所在地市区町村コード（公表申出）
  kana?: string; // 列18 (項番24): 日本語（カナ）
  legalName?: string; // 列19 (項番25): 氏名又は名称（法人のみ保持）
  domesticOfficeAddress?: string; // 列20 (項番26): 国内において行う資産の譲渡等に係る事務所等の所在地
  domesticOfficePrefectureCode?: string; // 列21 (項番27): 国内において行う資産の譲渡等に係る事務所等の所在地都道府県コード
  domesticOfficeCityCode?: string; // 列22 (項番28): 国内において行う資産の譲渡等に係る事務所等の所在地市区町村コード
}

export interface ImportMetrics {
  sourceType: 'nta_corporate_download' | 'nta_invoice_download';
  dataAsOf: string;
  datasetVersionId: number;
  count: number;
  durationMs: number;
  status: 'active' | 'failed' | 'skipped';
  unknownKindCount?: number;
  invalidRowCount?: number;
  errorType?: string;
}
