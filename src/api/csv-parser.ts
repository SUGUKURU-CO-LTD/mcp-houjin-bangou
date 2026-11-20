/**
 * 国税庁 Web-API Ver.4.0 の CSV レスポンスを JSON 化
 * Parse NTA Web-API Ver.4.0 CSV responses into JSON
 *
 * 根拠 / Source:
 *   国税庁仕様書 第二編 別紙1 リソース定義書 (36 項目、CSV 順序は同表に準拠)
 *   レスポンス形式: type=02 (CSV/UTF-8/JIS 第一〜第四水準)
 *
 * 1行目: ヘッダー (lastUpdateDate, count, divideNumber, divideSize)
 * 2行目以降: 法人データ (30列 = 項番7〜36)
 *
 * CSVエスケープ:
 *   - フィールド値はダブルクォーテーション（"）で囲まれる
 *   - 値内の " は "" にエスケープ
 */

import type { Corporation } from '../domain/corporate-number.js';

export interface NtaResponseHeader {
  lastUpdateDate: string;
  count: number;
  divideNumber: number;
  divideSize: number;
}

export interface ParsedNtaResponse {
  header: NtaResponseHeader;
  corporations: Corporation[];
}

/**
 * NTA CSV をパースして構造化
 *
 * @param csvText UTF-8 でデコード済みの CSV 本体
 */
export function parseNtaCsv(csvText: string): ParsedNtaResponse {
  const withoutBom = csvText.startsWith('\uFEFF') ? csvText.slice(1) : csvText;
  const lines = splitCsvLines(withoutBom);
  if (lines.length === 0) {
    throw new Error('Empty NTA CSV response');
  }

  const headerLine = lines[0];
  if (headerLine === undefined) {
    throw new Error('Missing header line in NTA CSV');
  }
  const headerFields = parseCsvLine(headerLine);
  if (headerFields.length < 4) {
    throw new Error(`Invalid header line: expected 4 fields, got ${headerFields.length}`);
  }

  const header: NtaResponseHeader = {
    lastUpdateDate: headerFields[0] ?? '',
    count: toInt(headerFields[1]),
    divideNumber: toInt(headerFields[2]),
    divideSize: toInt(headerFields[3]),
  };

  const corporations: Corporation[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.trim() === '') continue;
    const fields = parseCsvLine(line);
    if (fields.length < 30) {
      // 項番7〜36 の 30 列を期待 (項番7=一連番号から項番36=検索対象除外まで)
      continue;
    }
    corporations.push(rowToCorporation(fields));
  }

  return { header, corporations };
}

function toInt(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * CSV 1行をフィールド配列に分解 (RFC 4180、ダブルクォート + "" エスケープ対応)
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      fields.push(current);
      current = '';
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  fields.push(current);
  return fields;
}

/**
 * CSV 本体を行に分割。ダブルクォート内の改行を無視し、CRLF / LF を扱う。
 */
function splitCsvLines(csv: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          current += '""';
          i += 1;
          continue;
        }
        inQuotes = false;
      }
      current += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      current += ch;
      continue;
    }
    if (ch === '\r') {
      if (csv[i + 1] === '\n') i += 1;
      if (current.length > 0) {
        lines.push(current);
        current = '';
      }
      continue;
    }
    if (ch === '\n') {
      if (current.length > 0) {
        lines.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/**
 * CSV 1行を Corporation オブジェクトに変換
 * フィールド順は 第二編 別紙1 の項番7〜36 (30項目)
 */
function rowToCorporation(f: string[]): Corporation {
  const g = (idx: number): string => f[idx] ?? '';
  return {
    sequence_number: toInt(g(0)),
    corporate_number: g(1),
    process: g(2),
    correct: (g(3) === '1' ? '1' : '0') as '0' | '1',
    update_date: g(4),
    change_date: g(5),
    name: g(6),
    name_image_id: g(7),
    kind: g(8),
    prefecture_name: g(9),
    city_name: g(10),
    street_number: g(11),
    address_image_id: g(12),
    prefecture_code: g(13),
    city_code: g(14),
    post_code: g(15),
    address_outside: g(16),
    address_outside_image_id: g(17),
    close_date: g(18),
    close_cause: g(19),
    successor_corporate_number: g(20),
    change_cause: g(21),
    assignment_date: g(22),
    latest: (g(23) === '0' ? '0' : '1') as '0' | '1',
    en_name: g(24),
    en_prefecture_name: g(25),
    en_city_name: g(26),
    en_address_outside: g(27),
    furigana: g(28),
    hihyoji: (g(29) === '1' ? '1' : '0') as '0' | '1',
  };
}
