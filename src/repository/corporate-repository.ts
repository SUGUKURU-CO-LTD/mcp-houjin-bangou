/**
 * Corporate Data Provider Interface & Database Implementation
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1, §6.1, §6.2 (v1.9 凍結仕様)
 *   実装指示書v1 §5(B4):
 *     - データ源の切り替え（ホスト版はDB、ローカル版はWeb-API）は、設定1か所で行う。
 *     - 名前検索の一致方式: 1〜2文字は前方一致、3文字以上は部分一致（半角/全角英数字の双方に一致）
 *     - 処理区分 '99'（削除）は検索・照会結果から除外
 *     - DB エラーログに入力値（\nparams:）を残さない
 */

import { eq, and, or, isNull, ne, like, ilike, desc, asc } from 'drizzle-orm';
import type { DbClient } from '../db/client.js';
import { datasetVersions, corporateNumbers } from '../db/schema.js';
import { Result } from '../lib/result.js';
import { formatErrorWithCause } from '../lib/errors.js';
import { kindLabel } from '../domain/kind-codes.js';
import { closeCauseLabel } from '../domain/close-cause-codes.js';
import { encodeNameSearchCursor, validateNameSearchCursor } from '../lib/pagination.js';
import { NTA_CORPORATE_HOST_ATTRIBUTION } from '../lib/tool-response.js';

/**
 * PostgreSQL LIKE / ILIKE 検索用ワイルドカード文字のエスケープ
 * %, _, \ をエスケープして通常のリテラル文字として解釈させる。
 */
export function escapeLikeWildcards(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * 全角英数記号 (U+FF01..U+FF5E) を半角 ASCII (U+0021..U+007E) に変換する
 */
export function toHalfWidthAscii(input: string): string {
  return input.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/**
 * 半角 ASCII 英数記号 (U+0021..U+007E) を全角 (U+FF01..U+FF5E) に変換する
 */
export function toFullWidthAscii(input: string): string {
  return input.replace(/[\x21-\x7E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0));
}

/**
 * 商業登記・国税庁 CSV では英数字が全角（例: 株式会社ＮＴＴデータ、ＫＤＤＩ株式会社）で格納される一方、
 * normalize_company_name (NFKC) や手入力では半角（NTTデータ、KDDI）になるため、
 * 半角または全角 ASCII を含む検索語は双方の表記バリエーションを展開する。
 */
export function buildAsciiWidthSearchVariants(
  query: string,
  includeCaseVariantsForLike = false,
): string[] {
  const hasHalfAscii = /[\x21-\x7E]/.test(query);
  const hasFullAscii = /[\uFF01-\uFF5E]/.test(query);
  if (!hasHalfAscii && !hasFullAscii) {
    return [query];
  }

  const half = toHalfWidthAscii(query);
  const halfUpper = half.toUpperCase();
  const halfLower = half.toLowerCase();

  const variants = new Set<string>([
    query,
    half,
    toFullWidthAscii(half),
    toFullWidthAscii(halfUpper),
    toFullWidthAscii(halfLower),
  ]);

  if (includeCaseVariantsForLike) {
    variants.add(halfUpper);
    variants.add(halfLower);
  }

  return Array.from(variants);
}

/**
 * PostgreSQL クエリタイムアウト（エラーコード 57014: query_canceled）の判定
 */
export function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === '57014' ||
    (typeof e.message === 'string' &&
      (e.message.includes('statement timeout') || e.message.includes('canceling statement')))
  );
}

function writeCorporateRepositoryErrorLog(operation: string, err: unknown): void {
  const errorType = err instanceof Error ? err.name : 'UnknownError';
  const msg = formatErrorWithCause(err);
  process.stderr.write(
    JSON.stringify({
      level: 'error',
      severity: 'ERROR',
      time: new Date().toISOString(),
      logger: 'corporate_repository',
      operation,
      error_type: errorType,
      msg,
    }) + '\n',
  );
}

export interface CorporationInfo {
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
  successorCorporateNumber: string | null;
  address_may_be_outdated?: boolean;
}

export type CorporateRecord = CorporationInfo;

export interface LookupCorporateResult {
  corporation: CorporationInfo;
  data_as_of: string;
  attribution: string;
}

export interface SearchCorporationItem {
  corporate_number: string;
  name: string;
  legal_type: string;
  location: string;
  update_date: string;
  status: 'active' | 'closed';
  address_may_be_outdated?: boolean;
}

export interface SearchCorporateResult {
  results: SearchCorporationItem[];
  total_count?: number | null;
  next_cursor: string | null;
  data_as_of: string;
  attribution: string;
}

export interface CorporateError {
  code: 'INVALID_INPUT' | 'NOT_FOUND' | 'DATA_UNAVAILABLE' | 'INTERNAL_ERROR';
  message: string;
}

export interface CorporateDataProvider {
  readonly mode: 'db' | 'web-api';
  lookupByNumber(corporateNumber: string): Promise<Result<LookupCorporateResult, CorporateError>>;
  searchByName(
    name: string,
    prefecture?: string,
    cursor?: string,
    limit?: number,
  ): Promise<Result<SearchCorporateResult, CorporateError>>;
}

/**
 * ホスト版: 自社 PostgreSQL データベースから公表法人情報を検索・取得するプロバイダー
 */
export class DbCorporateDataProvider implements CorporateDataProvider {
  readonly mode = 'db' as const;

  constructor(private db: DbClient) {}

  /**
   * 現在 active な最新の法人データセットバージョンを取得
   */
  private async getActiveVersion(): Promise<{ id: number; dataAsOf: string } | null> {
    const versions = await this.db
      .select({ id: datasetVersions.id, dataAsOf: datasetVersions.dataAsOf })
      .from(datasetVersions)
      .where(
        and(
          eq(datasetVersions.sourceType, 'nta_corporate_download'),
          eq(datasetVersions.status, 'active'),
        ),
      )
      .orderBy(desc(datasetVersions.importedAt))
      .limit(1);

    const first = versions[0];
    return first ?? null;
  }

  async lookupByNumber(
    corporateNumber: string,
  ): Promise<Result<LookupCorporateResult, CorporateError>> {
    try {
      const activeVersion = await this.getActiveVersion();
      if (!activeVersion) {
        return Result.err({
          code: 'INTERNAL_ERROR',
          message: 'Active corporate dataset not found in database',
        });
      }

      const rows = await this.db
        .select()
        .from(corporateNumbers)
        .where(
          and(
            eq(corporateNumbers.corporateNumber, corporateNumber),
            eq(corporateNumbers.datasetVersionId, activeVersion.id),
          ),
        )
        .limit(1);

      const row = rows[0];
      // 処理区分 '99'（削除）は公表対象外（削除済み）のため該当なし扱いとする
      if (!row || row.process === '99') {
        return Result.err({
          code: 'NOT_FOUND',
          message: `指定された法人番号 (${corporateNumber}) に該当する公表データは見つかりませんでした。`,
        });
      }

      const isClosed = Boolean(row.closeDate || row.closeCause);

      const locationParts = [
        row.prefectureName,
        row.cityName,
        row.streetNumber,
        row.addressOutside,
      ].filter(Boolean);
      const location = locationParts.join('') || '所在地不明';

      const successorVal =
        row.successorCorporateNumber && row.successorCorporateNumber.trim() !== ''
          ? row.successorCorporateNumber.trim()
          : null;

      const info = {
        corporate_number: row.corporateNumber,
        name: row.name,
        name_kana: row.furigana ?? null,
        legal_type: kindLabel(row.kind),
        location,
        post_code: row.postCode ?? null,
        update_date: row.updateDate,
        status: (isClosed ? 'closed' : 'active') as 'active' | 'closed',
        close_date: row.closeDate ?? null,
        close_cause: row.closeCause ? closeCauseLabel(row.closeCause) : null,
        ...(successorVal !== null ? { successor_corporate_number: successorVal } : {}),
        address_may_be_outdated: row.hihyoji === '1',
      } as CorporationInfo;

      // camelCase アクセサを非列挙プロパティとして定義し、strict OutputSchema (additionalProperties: false) と両立させる
      Object.defineProperty(info, 'successorCorporateNumber', {
        value: successorVal,
        enumerable: false,
        configurable: true,
        writable: true,
      });

      return Result.ok({
        corporation: info,
        data_as_of: activeVersion.dataAsOf,
        attribution: NTA_CORPORATE_HOST_ATTRIBUTION,
      });
    } catch (err) {
      if (isTimeoutError(err)) {
        return Result.err({
          code: 'DATA_UNAVAILABLE',
          message: 'データベースの検索が上限時間を超過しました。時間をおいて再試行してください。',
        });
      }
      writeCorporateRepositoryErrorLog('lookupByNumber', err);
      return Result.err({
        code: 'INTERNAL_ERROR',
        message: 'データベースで予期しないエラーが発生しました。時間をおいて再試行してください。',
      });
    }
  }

  async searchByName(
    name: string,
    prefecture?: string,
    cursor?: string,
    requestedLimit?: number,
  ): Promise<Result<SearchCorporateResult, CorporateError>> {
    try {
      const activeVersion = await this.getActiveVersion();
      if (!activeVersion) {
        return Result.err({
          code: 'INTERNAL_ERROR',
          message: 'Active corporate dataset not found in database',
        });
      }

      const trimmedName = name.trim();
      const queryKey = `${trimmedName}|${prefecture ?? ''}`;

      let offset = 0;
      if (cursor) {
        const validation = validateNameSearchCursor(cursor, activeVersion.dataAsOf, queryKey);
        if (!validation.valid) {
          return Result.err({
            code: 'INVALID_INPUT',
            message: validation.message,
          });
        }
        offset = validation.payload.offset;
      }

      // 1〜2文字の語は前方一致 (LIKE 'prefix%') で text_pattern_ops 索引を活用し、
      // 3文字以上の語は pg_trgm の部分一致 (ILIKE '%query%') を使用する。
      // 英数字が含まれる場合は半角・全角バリエーションを OR 検索し、両方とも GIN / text_pattern_ops 索引を利用する。
      const isShortQuery = trimmedName.length <= 2;
      const variants = buildAsciiWidthSearchVariants(trimmedName, isShortQuery);
      const variantConditions = variants.map((v) => {
        const escaped = escapeLikeWildcards(v);
        return isShortQuery
          ? like(corporateNumbers.name, `${escaped}%`)
          : ilike(corporateNumbers.name, `%${escaped}%`);
      });
      const firstVariantCondition =
        variantConditions[0] ??
        ilike(corporateNumbers.name, `%${escapeLikeWildcards(trimmedName)}%`);
      const nameCondition =
        variantConditions.length === 1
          ? firstVariantCondition
          : (or(...variantConditions) ?? firstVariantCondition);

      // 処理区分 '99'（削除）を除外（process が NULL の行は保持する）
      const notDeletedCondition = or(
        isNull(corporateNumbers.process),
        ne(corporateNumbers.process, '99'),
      );

      const conditions = [
        eq(corporateNumbers.datasetVersionId, activeVersion.id),
        ...(notDeletedCondition ? [notDeletedCondition] : []),
        nameCondition,
      ];

      if (prefecture) {
        conditions.push(eq(corporateNumbers.prefectureCode, prefecture));
      }

      // 既定10件、最大20件。次ページの有無判定のために +1 件取得
      const limit = Math.min(Math.max(requestedLimit ?? 10, 1), 20);
      const fetchLimit = limit + 1;

      const fetchedRows = await this.db
        .select()
        .from(corporateNumbers)
        .where(and(...conditions))
        .orderBy(asc(corporateNumbers.corporateNumber))
        .limit(fetchLimit)
        .offset(offset);

      // モック DB 環境への防御的フィルタ（実 DB では WHERE 句で既に process='99' が除外済み）
      const validFetchedRows = fetchedRows.filter((r) => r.process !== '99');

      const hasNext = validFetchedRows.length > limit;
      const rows = hasNext ? validFetchedRows.slice(0, limit) : validFetchedRows;

      const totalCount: number | null = hasNext ? null : offset + validFetchedRows.length;

      const items: SearchCorporationItem[] = rows.map((row) => {
        const isClosed = Boolean(row.closeDate || row.closeCause);
        const locationParts = [
          row.prefectureName,
          row.cityName,
          row.streetNumber,
          row.addressOutside,
        ].filter(Boolean);
        const location = locationParts.join('') || '所在地不明';

        return {
          corporate_number: row.corporateNumber,
          name: row.name,
          legal_type: kindLabel(row.kind),
          location,
          update_date: row.updateDate,
          status: isClosed ? 'closed' : 'active',
          address_may_be_outdated: row.hihyoji === '1',
        };
      });

      const next_cursor = hasNext
        ? encodeNameSearchCursor({
            offset: offset + limit,
            data_as_of: activeVersion.dataAsOf,
            queryKey,
          })
        : null;

      return Result.ok({
        results: items,
        total_count: totalCount,
        next_cursor,
        data_as_of: activeVersion.dataAsOf,
        attribution: NTA_CORPORATE_HOST_ATTRIBUTION,
      });
    } catch (err) {
      if (isTimeoutError(err)) {
        return Result.err({
          code: 'DATA_UNAVAILABLE',
          message:
            'データベースの検索が上限時間を超過しました。検索条件を絞り込んで再試行してください。',
        });
      }
      writeCorporateRepositoryErrorLog('searchByName', err);
      return Result.err({
        code: 'INTERNAL_ERROR',
        message: 'データベースで予期しないエラーが発生しました。時間をおいて再試行してください。',
      });
    }
  }
}
