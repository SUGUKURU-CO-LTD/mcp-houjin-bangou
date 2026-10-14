/**
 * Corporate Data Provider Interface & Database Implementation
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1, §6.1, §6.2 (v1.6 凍結仕様)
 *   実装指示書v1 §5(B4):
 *     - データ源の切り替え（ホスト版はDB、ローカル版はWeb-API）は、設定1か所で行う。
 *     - 名前検索の一致方式: 部分一致 (Partial match)
 */

import { eq, and, like, ilike, desc, asc } from 'drizzle-orm';
import type { DbClient } from '../db/client.js';
import { datasetVersions, corporateNumbers } from '../db/schema.js';
import { Result } from '../lib/result.js';
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
  address_may_be_outdated?: boolean;
}

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
      if (!row) {
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

      const info: CorporationInfo = {
        corporate_number: row.corporateNumber,
        name: row.name,
        name_kana: row.furigana ?? null,
        legal_type: kindLabel(row.kind),
        location,
        post_code: row.postCode ?? null,
        update_date: row.updateDate,
        status: isClosed ? 'closed' : 'active',
        close_date: row.closeDate ?? null,
        close_cause: row.closeCause ? closeCauseLabel(row.closeCause) : null,
        address_may_be_outdated: row.hihyoji === '1',
      };

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
      console.error(
        '[CorporateRepository] Database query error in lookupByNumber:',
        err instanceof Error ? (err.stack ?? err.message) : err,
      );
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

      let offset = 0;
      if (cursor) {
        const validation = validateNameSearchCursor(cursor, activeVersion.dataAsOf);
        if (!validation.valid) {
          return Result.err({
            code: 'INVALID_INPUT',
            message: validation.message,
          });
        }
        offset = validation.payload.offset;
      }

      const trimmedName = name.trim();
      const escaped = escapeLikeWildcards(trimmedName);
      // 1〜2文字の語は前方一致 (LIKE 'prefix%') で text_pattern_ops 索引を活用し、
      // 3文字以上の語は pg_trgm の部分一致 (ILIKE '%query%') を使用する。
      const isShortQuery = trimmedName.length <= 2;
      const nameCondition = isShortQuery
        ? like(corporateNumbers.name, `${escaped}%`)
        : ilike(corporateNumbers.name, `%${escaped}%`);

      const conditions = [
        eq(corporateNumbers.datasetVersionId, activeVersion.id),
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

      const hasNext = fetchedRows.length > limit;
      const rows = hasNext ? fetchedRows.slice(0, limit) : fetchedRows;

      // total_count の計算:
      // 次ページが存在する場合（hasNext === true）は、大量ヒット時の COUNT(*) 負荷（約1秒）を防止するため
      // 数えずに null を返す（凍結仕様 docs/plan/corp-check-interface-v1.md §1.2 準拠: total_count?: number | null）。
      // 次ページがない場合（!hasNext）は、offset + fetchedRows.length で確定できるため、追加クエリ不要で正確な件数を返す。
      const totalCount: number | null = hasNext ? null : offset + fetchedRows.length;

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
      console.error(
        '[CorporateRepository] Database query error in searchByName:',
        err instanceof Error ? (err.stack ?? err.message) : err,
      );
      return Result.err({
        code: 'INTERNAL_ERROR',
        message: 'データベースで予期しないエラーが発生しました。時間をおいて再試行してください。',
      });
    }
  }
}
