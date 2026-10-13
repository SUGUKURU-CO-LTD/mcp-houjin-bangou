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

export interface InvoiceCsvRow {
  sequenceNumber: string; // 項番1: 一連番号
  registrationNumber: string; // 項番2: 登録番号 (T+13桁)
  process?: string; // 項番3: 処理区分
  correct?: string; // 項番4: 訂正区分
  kind: string; // 項番5: 事業者区分 (01:法人, 02:個人事業者, 03:人格のない社団等)
  corporateNumber?: string; // 項番6: 法人番号
  legalName?: string; // 項番7: 商号又は名称（個人事業者以外）
  prefectureName?: string; // 項番8: 所在地（都道府県）
  cityName?: string; // 項番9: 所在地（市区町村）
  streetNumber?: string; // 項番10: 所在地（町名番地）
  postCode?: string; // 項番11: 郵便番号
  addressOutside?: string; // 項番12: 国外所在地
  registrationDate: string; // 項番13: 登録年月日 (YYYY-MM-DD)
  updateDate: string; // 項番14: 更新年月日 (YYYY-MM-DD)
  cancelDate?: string; // 項番15: 取消年月日
  expireDate?: string; // 項番16: 失効年月日
}

export interface ImportMetrics {
  sourceType: 'nta_corporate_download' | 'nta_invoice_download';
  dataAsOf: string;
  datasetVersionId: number;
  count: number;
  durationMs: number;
  status: 'active' | 'failed';
  errorType?: string;
}
