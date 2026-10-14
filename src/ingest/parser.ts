/**
 * NTA Public Data CSV Parser
 *
 * 根拠 / Source:
 *   国税庁 基本3情報ダウンロードCSV仕様・リソース定義書 4.0版 (全30項目)
 *   国税庁 適格請求書発行事業者公表システム「ダウンロードデータ（全件データ・差分データ）のリソース定義書」1.5版 (全24項目)
 *     - リソース定義書1.5版（PDF）: https://www.invoice-kohyo.nta.go.jp/files/k-resource-dl.pdf （確認日: 2026-10-14）
 *     - ダウンロードページ: https://www.invoice-kohyo.nta.go.jp/download/index.html （確認日: 2026-10-14）
 *     - お知らせ（令和4年9月26日からの個人項目削除）: https://www.invoice-kohyo.nta.go.jp/news/r04/r04news04.html （確認日: 2026-10-14）
 *   実装指示書v1 §5(B4):
 *     - 個人事業者の氏名・屋号の列を作らない（パース時も破棄）
 */

import {
  isInvoiceCorrectCode,
  isInvoiceCountryCode,
  isInvoiceKindCode,
  isInvoiceLatestCode,
  isInvoiceProcessCode,
} from '../domain/invoice-codes.js';
import type { CorporateCsvRow, InvoiceCsvRow } from './types.js';

/**
 * 標準CSV行の分割（ダブルクォーテーション対応）
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        currentField += '"';
        i++; // 連続した引用符のエスケープをスキップ
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(currentField);
      currentField = '';
    } else {
      currentField += char;
    }
  }
  fields.push(currentField);
  return fields;
}

/**
 * 法人番号公表基本3情報 CSV行のパース
 *
 * 根拠 / Source:
 *   国税庁 基本3情報ダウンロードCSV仕様・リソース定義書 4.0版 (全30項目)
 *   項番30: 検索対象除外（hihyoji） (0:検索対象, 1:検索対象外)
 *   処理区分「99（削除）」は一連番号・法人番号・更新年月日以外が空欄となる場合に対応
 */
export function parseCorporateCsvLine(line: string): CorporateCsvRow | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const cols = parseCsvLine(trimmed);
  // 最低限の必須カラム: 一連番号, 法人番号, 処理区分, 訂正区分, 更新年月日
  if (cols.length < 5) {
    return null;
  }

  const corporateNumber = cols[1]?.trim() || '';
  if (!corporateNumber) {
    return null;
  }

  const clean = (val?: string) => {
    if (!val) return undefined;
    const t = val.trim();
    return t === '' ? undefined : t;
  };

  return {
    sequenceNumber: cols[0] || '',
    corporateNumber,
    process: clean(cols[2]),
    correct: clean(cols[3]),
    updateDate: cols[4]?.trim() || '',
    changeDate: clean(cols[5]),
    name: cols[6]?.trim() || '',
    nameImageId: clean(cols[7]),
    kind: cols[8]?.trim() || '',
    prefectureName: clean(cols[9]),
    cityName: clean(cols[10]),
    streetNumber: clean(cols[11]),
    addressImageId: clean(cols[12]),
    prefectureCode: clean(cols[13]),
    cityCode: clean(cols[14]),
    postCode: clean(cols[15]),
    addressOutside: clean(cols[16]),
    addressOutsideImageId: clean(cols[17]),
    closeDate: clean(cols[18]),
    closeCause: clean(cols[19]),
    successorCorporateNumber: clean(cols[20]),
    changeCause: clean(cols[21]),
    assignmentDate: clean(cols[22]),
    latest: clean(cols[23]) ?? '1',
    enName: clean(cols[24]),
    enPrefectureName: clean(cols[25]),
    enCityName: clean(cols[26]),
    enAddressOutside: clean(cols[27]),
    furigana: clean(cols[28]),
    hihyoji: clean(cols[29]) ?? '0',
  };
}

/**
 * インボイス公表CSV行のパース（公式24列仕様）
 *
 * 出典 / Source:
 *   国税庁 適格請求書発行事業者公表システム
 *   「ダウンロードデータ（全件データ・差分データ）のリソース定義書」1.5版（第2編 10〜13ページ、項番7〜30の24列）
 *   URL: https://www.invoice-kohyo.nta.go.jp/files/k-resource-dl.pdf （確認日: 2026-10-14）
 *   ダウンロードページ: https://www.invoice-kohyo.nta.go.jp/download/index.html （確認日: 2026-10-14）
 *   お知らせ（令和4年9月26日からの個人項目削除）: https://www.invoice-kohyo.nta.go.jp/news/r04/r04news04.html （確認日: 2026-10-14）
 *
 * 【保護制約】
 *   - 令和4年9月26日から、個人のダウンロードファイルでは氏名・屋号・通称・主たる事務所の所在地が空文字になっている（リソース定義書1.5版 第2編 12〜13ページ 注記）。
 *   - 人格区分（kind, 列5 / 項番11）が '1'（個人）の行、および区分が不明な行（!isInvoiceKindCode(kind)）は、名称・所在地・カナ・屋号・通称を保持しない。
 *   - 人格区分が '2'（法人（人格のない社団等を含む））のときのみ、公表名称・所在地・カナを保持する（23列目「主たる屋号」・24列目「通称・旧姓」は個人用項目のため常に破棄する）。
 */
export function parseInvoiceCsvLine(line: string): InvoiceCsvRow | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const cols = parseCsvLine(trimmed);
  // 公式リソース定義書1.5版（項番7〜30）の24列と一致しない行は拒否する
  if (cols.length !== 24) {
    return null;
  }

  const clean = (val?: string) => {
    if (!val) return undefined;
    const t = val.trim();
    return t === '' ? undefined : t;
  };

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  // 列1 (項番7): 一連番号 (1〜8桁数字)
  const sequenceNumber = cols[0]?.trim() || '';
  if (!/^\d{1,8}$/.test(sequenceNumber)) {
    return null;
  }

  // 列2 (項番8): 登録番号 (T + 13桁数字)
  const registrationNumber = cols[1]?.trim() || '';
  if (!/^T\d{13}$/.test(registrationNumber)) {
    return null;
  }

  // 列3 (項番9): 事業者処理区分 (01, 02, 03, 04, 99)
  const process = cols[2]?.trim() || '';
  if (!isInvoiceProcessCode(process)) {
    return null;
  }

  // 列4 (項番10): 訂正区分 (0, 1)
  const correct = cols[3]?.trim() || '';
  if (!isInvoiceCorrectCode(correct)) {
    return null;
  }

  // 列5 (項番11): 人格区分 (1: 個人, 2: 法人（人格のない社団等を含む）)
  // 区分が不明な行も件数カウント・履歴保持の対象とするが、列ずれ（日付文字列等）は拒否する
  const kind = cols[4]?.trim() || '';
  if (!kind || kind.length > 2) {
    return null;
  }

  // 列6 (項番12): 国内外区分 (空文字 または 1, 2, 3)
  const country = clean(cols[5]);
  if (country !== undefined && !isInvoiceCountryCode(country)) {
    return null;
  }

  // 列7 (項番13): 最新履歴 (0: 過去情報, 1: 最新情報)
  const latest = cols[6]?.trim() || '';
  if (!isInvoiceLatestCode(latest)) {
    return null;
  }

  // 列8 (項番14): 登録年月日 (空文字 または YYYY-MM-DD)
  const registrationDate = clean(cols[7]);
  if (registrationDate !== undefined && !datePattern.test(registrationDate)) {
    return null;
  }

  // 列9 (項番15): 更新年月日 (YYYY-MM-DD 必須)
  const updateDate = cols[8]?.trim() || '';
  if (!datePattern.test(updateDate)) {
    return null;
  }

  // 列10 (項番16): 取消年月日 (空文字 または YYYY-MM-DD)
  const cancelDate = clean(cols[9]);
  if (cancelDate !== undefined && !datePattern.test(cancelDate)) {
    return null;
  }

  // 列11 (項番17): 失効年月日 (空文字 または YYYY-MM-DD)
  const expireDate = clean(cols[10]);
  if (expireDate !== undefined && !datePattern.test(expireDate)) {
    return null;
  }

  // 人格区分が '2'（法人（人格のない社団等を含む））のときのみ名称・所在地・カナを保持する。
  // '1'（個人）および区分不明（!isInvoiceKindCode(kind)）の行は保持しない。
  const isCorporationOrAssociation = isInvoiceKindCode(kind) && kind === '2';

  // 列23 (cols[22], 項番29: 主たる屋号) および 列24 (cols[23], 項番30: 通称・旧姓) は常に破棄する
  return {
    sequenceNumber,
    registrationNumber,
    process,
    correct,
    kind,
    country,
    latest,
    registrationDate,
    updateDate,
    cancelDate,
    expireDate,
    headOfficeAddress: isCorporationOrAssociation ? clean(cols[11]) : undefined,
    headOfficePrefectureCode: isCorporationOrAssociation ? clean(cols[12]) : undefined,
    headOfficeCityCode: isCorporationOrAssociation ? clean(cols[13]) : undefined,
    declaredAddress: isCorporationOrAssociation ? clean(cols[14]) : undefined,
    declaredPrefectureCode: isCorporationOrAssociation ? clean(cols[15]) : undefined,
    declaredCityCode: isCorporationOrAssociation ? clean(cols[16]) : undefined,
    kana: isCorporationOrAssociation ? clean(cols[17]) : undefined,
    legalName: isCorporationOrAssociation ? clean(cols[18]) : undefined,
    domesticOfficeAddress: isCorporationOrAssociation ? clean(cols[19]) : undefined,
    domesticOfficePrefectureCode: isCorporationOrAssociation ? clean(cols[20]) : undefined,
    domesticOfficeCityCode: isCorporationOrAssociation ? clean(cols[21]) : undefined,
  };
}
