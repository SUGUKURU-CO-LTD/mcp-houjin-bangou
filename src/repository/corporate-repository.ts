/**
 * Corporate Data Provider Interface & Database Implementation
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1, §6.1, §6.2 (v1.6 凍結仕様)
 *   実装指示書v1 §5(B4):
 *     - データ源の切り替え（ホスト版はDB、ローカル版はWeb-API）は、設定1か所で行う。
 *     - 名前検索の一致方式: 部分一致 (Partial match)
 */

import { eq, and, ilike, desc, count } from 'drizzle-orm';
import type { DbClient } from '../db/client.js';
import { datasetVersions, corporateNumbers } from '../db/schema.js';
import { Result } from '../lib/result.js';
import { kindLabel } from '../domain/kind-codes.js';
import { closeCauseLabel } from '../domain/close-cause-codes.js';
import {
  encodeNameSearchCursor,
  validateNameSearchCursor,
} from '../lib/pagination.js';
import { NTA_CORPORATE_HOST_ATTRIBUTION } from '../lib/tool-response.js';

/**
 * PostgreSQL LIKE / ILIKE 検索用ワイルドカード文字のエスケープ
 * %, _, \ をエスケープして通常のリテラル文字として解釈させる。
 */
export function escapeLikeWildcards(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
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
}

export interface SearchCorporateResult {
  results: SearchCorporationItem[];
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
    };

    return Result.ok({
      corporation: info,
      data_as_of: activeVersion.dataAsOf,
      attribution: NTA_CORPORATE_HOST_ATTRIBUTION,
    });
  }

  async searchByName(
    name: string,
    prefecture?: string,
    cursor?: string,
    requestedLimit?: number,
  ): Promise<Result<SearchCorporateResult, CorporateError>> {
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

    const escaped = escapeLikeWildcards(name);
    const conditions = [
      eq(corporateNumbers.datasetVersionId, activeVersion.id),
      ilike(corporateNumbers.name, `%${escaped}%`),
    ];

    if (prefecture) {
      conditions.push(eq(corporateNumbers.prefectureCode, prefecture));
    }

    // 総件数カウント
    const countRows = await this.db
      .select({ total: count() })
      .from(corporateNumbers)
      .where(and(...conditions));

    const totalCount = countRows[0]?.total ?? 0;

    // 既定10件、最大20件
    const limit = Math.min(Math.max(requestedLimit ?? 10, 1), 20);
    const rows = await this.db
      .select()
      .from(corporateNumbers)
      .where(and(...conditions))
      .orderBy(corporateNumbers.corporateNumber)
      .limit(limit)
      .offset(offset);

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
      };
    });

    const nextOffset = offset + rows.length;
    const hasNext = nextOffset < totalCount;
    const next_cursor = hasNext
      ? encodeNameSearchCursor({
          offset: nextOffset,
          data_as_of: activeVersion.dataAsOf,
        })
      : null;

    return Result.ok({
      results: items,
      next_cursor,
      data_as_of: activeVersion.dataAsOf,
      attribution: NTA_CORPORATE_HOST_ATTRIBUTION,
    });
  }
}
