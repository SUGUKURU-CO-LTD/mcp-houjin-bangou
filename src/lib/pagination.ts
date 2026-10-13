/**
 * MCP cursor-based pagination ↔ 国税庁 divide/divideSize / offset 変換
 * MCP cursor-based pagination ↔ NTA divide/divideSize translation
 *
 * 根拠 / Source:
 *   MCP 公式仕様 server/utilities/pagination (opaque cursor string)
 *   国税庁仕様書 第二編 §3.5, §4.5 (2000件超過時に divide 1-99999 で分割)
 *   docs/plan/corp-check-interface-v1.md §1.2, §11 (B2要件: cursor は data_as_of に結び付け、古い cursor は INVALID_INPUT)
 */

export interface CursorPayload {
  divide: number;
  /** 元クエリの識別子 (cursor が他クエリで使い回しされないよう識別子に使う) */
  queryKey?: string;
}

/**
 * 名前検索用カーソルペイロード (B2)
 */
export interface NameSearchCursorPayload {
  offset: number;
  data_as_of: string;
  queryKey?: string;
  divide?: number;
}

/**
 * 国税庁の分割番号 (divide) + query key を MCP の opaque cursor に encode
 */
export function encodeCursor(divide: number, queryKey?: string): string {
  const payload: CursorPayload = queryKey !== undefined ? { divide, queryKey } : { divide };
  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
}

/**
 * MCP cursor を decode (不正な cursor は null)
 */
export function decodeCursor(cursor: string | undefined): CursorPayload | null {
  if (cursor === undefined || cursor === '') return null;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'divide' in parsed &&
      typeof (parsed as CursorPayload).divide === 'number' &&
      (parsed as CursorPayload).divide >= 1 &&
      (parsed as CursorPayload).divide <= 99999
    ) {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 国税庁レスポンスヘッダ (divideNumber, divideSize) から次のページの cursor を生成
 * Returns null when no more pages (divideNumber >= divideSize)
 */
export function computeNextCursor(
  divideNumber: number,
  divideSize: number,
  queryKey?: string,
): string | null {
  if (divideNumber >= divideSize) return null;
  return encodeCursor(divideNumber + 1, queryKey);
}

/**
 * B2: data_as_of と offset を含む名前検索用カーソルを encode
 */
export function encodeNameSearchCursor(payload: NameSearchCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
}

/**
 * B2: 名前検索用カーソルを decode (不正な形式は null)
 */
export function decodeNameSearchCursor(cursor: string | undefined): NameSearchCursorPayload | null {
  if (cursor === undefined || cursor === '') return null;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'offset' in parsed &&
      typeof (parsed as NameSearchCursorPayload).offset === 'number' &&
      (parsed as NameSearchCursorPayload).offset >= 0 &&
      'data_as_of' in parsed &&
      typeof (parsed as NameSearchCursorPayload).data_as_of === 'string'
    ) {
      return parsed as NameSearchCursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export type CursorValidationResult =
  | { valid: true; payload: NameSearchCursorPayload }
  | { valid: false; reason: 'malformed' | 'stale'; message: string };

/**
 * B2: カーソルを検証し、形式不正や data_as_of 不一致（更新後の古いカーソル）を検出
 */
export function validateNameSearchCursor(
  cursor: string | undefined,
  currentDataAsOf: string,
): CursorValidationResult {
  if (cursor === undefined || cursor === '') {
    return { valid: false, reason: 'malformed', message: 'カーソルが指定されていません。' };
  }
  const payload = decodeNameSearchCursor(cursor);
  if (payload === null) {
    return { valid: false, reason: 'malformed', message: 'カーソルの形式が無効です。' };
  }
  if (payload.data_as_of !== currentDataAsOf) {
    return {
      valid: false,
      reason: 'stale',
      message:
        '公表データが更新されたため、カーソルが無効になりました。最初から再検索してください。',
    };
  }
  return { valid: true, payload };
}
