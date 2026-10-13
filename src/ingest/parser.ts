/**
 * NTA Public Data CSV Parser
 *
 * 根拠 / Source:
 *   国税庁 基本3情報ダウンロードCSV仕様 (全29項目)
 *   国税庁 適格請求書発行事業者公表ファイル仕様
 *   実装指示書v1 §5(B4):
 *     - 個人事業者の氏名・屋号の列を作らない（パース時も破棄）
 */

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
 * インボイス公表CSV行のパース
 *
 * 【重要設計制約】
 * 国税庁のダウンロードデータでは個人事業者の氏名等は削除されている（国税庁インボイスQ&A 問21）。
 * 念のため、パーサーでも除外している。
 * 法人（01）および人格のない社団等（03）の公表商号・所在地のみ抽出する。
 *
 * 事業者区分（kind）の出典:
 * 国税庁適格請求書発行事業者公表システム「リソース定義書（全件データ・差分データ）」
 * （01: 法人、02: 個人事業者、03: 人格のない社団等）
 */
export function parseInvoiceCsvLine(line: string): InvoiceCsvRow | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const cols = parseCsvLine(trimmed);
  if (cols.length < 5) {
    return null;
  }

  const clean = (val?: string) => {
    if (!val) return undefined;
    const t = val.trim();
    return t === '' ? undefined : t;
  };

  // 適格請求書発行事業者公表ファイル仕様に基づくマッピング
  // 項番1: 一連番号
  // 項番2: 登録番号 (T+13桁)
  // 項番3: 処理区分
  // 項番4: 訂正区分
  // 項番5: 更新年月日
  // 項番6: 事業者区分 (01:法人, 02:個人事業者, 03:人格のない社団等 - 出典: リソース定義書)
  // 項番7: 商号又は名称 (法人・社団等)
  // 項番8: 国内所在地（都道府県）
  // 項番9: 国内所在地（市区町村）
  // 項番10: 国内所在地（町名番地等）
  // 項番11: 法人番号
  // 項番12: 登録年月日
  // 項番13: 取消年月日
  // 項番14: 失効年月日
  const kind = cols[5]?.trim() || cols[4]?.trim() || '01';
  const isCorporateOrGroup = kind === '01' || kind === '03';

  return {
    sequenceNumber: cols[0] || '',
    registrationNumber: cols[1]?.trim() || '',
    process: clean(cols[2]),
    correct: clean(cols[3]),
    kind,
    // 個人事業者の場合は名称・所在地・法人番号を保持しない
    corporateNumber: isCorporateOrGroup ? clean(cols[10]) : undefined,
    legalName: isCorporateOrGroup ? clean(cols[6]) : undefined,
    prefectureName: isCorporateOrGroup ? clean(cols[7]) : undefined,
    cityName: isCorporateOrGroup ? clean(cols[8]) : undefined,
    streetNumber: isCorporateOrGroup ? clean(cols[9]) : undefined,
    registrationDate: cols[11]?.trim() || cols[4]?.trim() || '',
    updateDate: cols[4]?.trim() || '',
    cancelDate: clean(cols[12]),
    expireDate: clean(cols[13]),
  };
}
