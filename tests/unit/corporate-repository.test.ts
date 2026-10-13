/**
 * Corporate Repository Unit Tests
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §1.1, §1.2, §6.1, §11 (ホスト版DB検索と部分一致)
 *   実装指示書v1 §5(B4)
 *
 * 【テストデータの性格】
 *   本テストで使用しているデータはすべてテスト用に作成した「合成データ」であり、
 *   実在する事業者や個人の情報、国税庁本番データではありません。
 */

import { describe, it, expect } from 'vitest';
import {
  DbCorporateDataProvider,
  escapeLikeWildcards,
  isTimeoutError,
} from '../../src/repository/corporate-repository.js';
import { encodeNameSearchCursor } from '../../src/lib/pagination.js';
import { NTA_CORPORATE_HOST_ATTRIBUTION } from '../../src/lib/tool-response.js';
import type { DbClient } from '../../src/db/client.js';

describe('escapeLikeWildcards (LIKE/ILIKE特殊文字エスケープ)', () => {
  it('%、_、\\ をエスケープすること', () => {
    expect(escapeLikeWildcards('100%')).toBe('100\\%');
    expect(escapeLikeWildcards('A_B')).toBe('A\\_B');
    expect(escapeLikeWildcards('C\\D')).toBe('C\\\\D');
    expect(escapeLikeWildcards('50%_OFF\\SALE')).toBe('50\\%\\_OFF\\\\SALE');
  });

  it('特殊文字を含まない通常の文字列はそのまま維持されること', () => {
    expect(escapeLikeWildcards('スグクル株式会社')).toBe('スグクル株式会社');
    expect(escapeLikeWildcards('Test-Company. 123')).toBe('Test-Company. 123');
  });
});

describe('isTimeoutError (PostgreSQL タイムアウトエラー判定)', () => {
  it('PostgreSQL エラーコード 57014 (query_canceled) を検知すること', () => {
    expect(isTimeoutError({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(true);
  });

  it('statement timeout を含むエラーメッセージを検知すること', () => {
    expect(isTimeoutError(new Error('Query failed: canceling statement due to statement timeout'))).toBe(true);
  });

  it('タイムアウト以外のエラーは false を返すこと', () => {
    expect(isTimeoutError(new Error('connection refused'))).toBe(false);
    expect(isTimeoutError({ code: '42P01' })).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
  });
});

describe('DbCorporateDataProvider (合成テストデータ使用)', () => {
  const currentDataAsOf = '2026-10-01';

  // 合成法人データ一覧
  const mockCorporateData = [
    {
      corporateNumber: '1000000000001',
      datasetVersionId: 1,
      name: '株式会社テスト鹿児島',
      kind: '301',
      prefectureCode: '46',
      cityCode: '201',
      prefectureName: '鹿児島県',
      cityName: '鹿児島市',
      streetNumber: '山下町一丁目',
      addressOutside: null,
      postCode: '8920816',
      updateDate: '2026-04-01',
      closeDate: null,
      closeCause: null,
      furigana: 'カブシキガイシャテストカゴシマ',
    },
    {
      corporateNumber: '1000000000002',
      datasetVersionId: 1,
      name: 'テスト物流有限会社',
      kind: '302',
      prefectureCode: '46',
      cityCode: '218',
      prefectureName: '鹿児島県',
      cityName: '霧島市',
      streetNumber: '国分中央一丁目',
      addressOutside: null,
      postCode: '8994332',
      updateDate: '2026-05-01',
      closeDate: null,
      closeCause: null,
      furigana: 'テストブツリュウユウゲンガイシャ',
    },
    {
      corporateNumber: '1000000000003',
      datasetVersionId: 1,
      name: '閉鎖テスト株式会社',
      kind: '301',
      prefectureCode: '13',
      cityCode: '101',
      prefectureName: '東京都',
      cityName: '千代田区',
      streetNumber: '丸の内一丁目',
      addressOutside: null,
      postCode: '1000005',
      updateDate: '2026-06-01',
      closeDate: '2026-06-01',
      closeCause: '01', // 国税庁定義: 01 = 清算の結了等
      furigana: 'ヘイサテストカブシキガイシャ',
    },
  ];

  function createMockDb(records = mockCorporateData, hasActiveVersion = true): DbClient {
    return {
      select: (fields?: unknown) => ({
        from: () => ({
          where: () => {
            // 1. dataset_versions の取得
            if (fields && typeof fields === 'object' && 'dataAsOf' in (fields as object)) {
              return {
                orderBy: () => ({
                  limit: () => Promise.resolve(
                    hasActiveVersion ? [{ id: 1, dataAsOf: currentDataAsOf }] : [],
                  ),
                }),
              };
            }

            // 2. count() の取得
            if (fields && typeof fields === 'object' && 'total' in (fields as object)) {
              return Promise.resolve([{ total: records.length }]);
            }

            // 3. corporate_numbers の取得
            return {
              limit: (limitCount: number) => Promise.resolve(records.slice(0, limitCount)),
              orderBy: () => ({
                limit: (limitCount: number) => ({
                  offset: (offsetCount: number) =>
                    Promise.resolve(records.slice(offsetCount, offsetCount + limitCount)),
                }),
              }),
            };
          },
        }),
      }),
    } as unknown as DbClient;
  }

  describe('lookupByNumber', () => {
    it('存在する法人番号に対して基本情報とホスト版出典表示を返す', async () => {
      const db = createMockDb();
      const provider = new DbCorporateDataProvider(db);

      const result = await provider.lookupByNumber('1000000000001');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.corporation.corporate_number).toBe('1000000000001');
      expect(result.value.corporation.name).toBe('株式会社テスト鹿児島');
      expect(result.value.corporation.legal_type).toBe('株式会社');
      expect(result.value.corporation.status).toBe('active');
      expect(result.value.corporation.location).toBe('鹿児島県鹿児島市山下町一丁目');
      expect(result.value.data_as_of).toBe(currentDataAsOf);
      expect(result.value.attribution).toBe(NTA_CORPORATE_HOST_ATTRIBUTION);
    });

    it('閉鎖された法人の場合 status が closed となり閉鎖事由が返る', async () => {
      const db = createMockDb(mockCorporateData.slice(2, 3));
      const provider = new DbCorporateDataProvider(db);

      const result = await provider.lookupByNumber('1000000000003');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.corporation.status).toBe('closed');
      expect(result.value.corporation.close_date).toBe('2026-06-01');
      expect(result.value.corporation.close_cause).toBe('清算の結了等');
    });

    it('該当がない場合は NOT_FOUND エラーを返す', async () => {
      const db = createMockDb([]);
      const provider = new DbCorporateDataProvider(db);

      const result = await provider.lookupByNumber('9999999999999');
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe('NOT_FOUND');
    });

    it('active なデータセットが存在しない場合は INTERNAL_ERROR を返す', async () => {
      const db = createMockDb([], false);
      const provider = new DbCorporateDataProvider(db);

      const result = await provider.lookupByNumber('1000000000001');
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe('INTERNAL_ERROR');
    });

    it('クエリが上限時間を超過（タイムアウト）した場合は DATA_UNAVAILABLE を返す', async () => {
      const timeoutDb = {
        select: (fields?: unknown) => ({
          from: () => ({
            where: () => {
              // dataset_versions
              if (fields && typeof fields === 'object' && 'dataAsOf' in (fields as object)) {
                return {
                  orderBy: () => ({
                    limit: () => Promise.resolve([{ id: 1, dataAsOf: currentDataAsOf }]),
                  }),
                };
              }
              const err = new Error('canceling statement due to statement timeout');
              (err as unknown as { code: string }).code = '57014';
              return {
                limit: () => Promise.reject(err),
              };
            },
          }),
        }),
      } as unknown as DbClient;

      const provider = new DbCorporateDataProvider(timeoutDb);
      const result = await provider.lookupByNumber('1000000000001');
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe('DATA_UNAVAILABLE');
      expect(result.error.message).toContain('上限時間を超過しました');
    });
  });

  describe('searchByName', () => {
    it('名前検索（部分一致）で該当一覧とホスト版出典表示を返す', async () => {
      const db = createMockDb();
      const provider = new DbCorporateDataProvider(db);

      const result = await provider.searchByName('テスト');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.results.length).toBe(3);
      expect(result.value.total_count).toBe(3);
      expect(result.value.next_cursor).toBeNull();
      expect(result.value.data_as_of).toBe(currentDataAsOf);
      expect(result.value.attribution).toBe(NTA_CORPORATE_HOST_ATTRIBUTION);
    });

    it('取得件数が limit 以下の場合は COUNT(*) を行わずに total_count が即時確定すること', async () => {
      // 3件のデータに対して limit=10 で検索
      const db = createMockDb();
      const provider = new DbCorporateDataProvider(db);

      const result = await provider.searchByName('テスト', undefined, undefined, 10);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.results.length).toBe(3);
      expect(result.value.total_count).toBe(3);
      expect(result.value.next_cursor).toBeNull();
    });

    it('次ページが存在し COUNT(*) がタイムアウトした場合は total_count: null として検索結果を返すこと', async () => {
      // 12件のレコードを用意し、limit=10 で次ページがある状態
      const manyRecords = Array.from({ length: 12 }, (_, i) => ({
        ...mockCorporateData[0],
        corporateNumber: `10000000000${i.toString().padStart(2, '0')}`,
        name: `株式会社テスト企業${i}`,
      }));

      const timeoutCountDb = {
        select: (fields?: unknown) => ({
          from: () => ({
            where: () => {
              // dataset_versions
              if (fields && typeof fields === 'object' && 'dataAsOf' in (fields as object)) {
                return {
                  orderBy: () => ({
                    limit: () => Promise.resolve([{ id: 1, dataAsOf: currentDataAsOf }]),
                  }),
                };
              }

              // COUNT(*) でタイムアウトエラーを発生させる
              if (fields && typeof fields === 'object' && 'total' in (fields as object)) {
                const countErr = new Error('canceling statement due to statement timeout');
                (countErr as unknown as { code: string }).code = '57014';
                return Promise.reject(countErr);
              }

              // corporate_numbers: fetchLimit=11 で 11 件返す
              return {
                orderBy: () => ({
                  limit: (limitCount: number) => ({
                    offset: (offsetCount: number) =>
                      Promise.resolve(manyRecords.slice(offsetCount, offsetCount + limitCount)),
                  }),
                }),
              };
            },
          }),
        }),
      } as unknown as DbClient;

      const provider = new DbCorporateDataProvider(timeoutCountDb);
      const result = await provider.searchByName('テスト', undefined, undefined, 10);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // 10件返却され、次カーソルが発行され、total_count は安全に null にフォールバック
      expect(result.value.results.length).toBe(10);
      expect(result.value.total_count).toBeNull();
      expect(result.value.next_cursor).not.toBeNull();
    });

    it('検索クエリ全体が上限時間を超過した場合は DATA_UNAVAILABLE を返すこと', async () => {
      const timeoutDb = {
        select: (fields?: unknown) => ({
          from: () => ({
            where: () => {
              // dataset_versions は通る
              if (fields && typeof fields === 'object' && 'dataAsOf' in (fields as object)) {
                return {
                  orderBy: () => ({
                    limit: () => Promise.resolve([{ id: 1, dataAsOf: currentDataAsOf }]),
                  }),
                };
              }
              // データ検索でタイムアウト
              const queryErr = new Error('canceling statement due to statement timeout');
              (queryErr as unknown as { code: string }).code = '57014';
              return {
                orderBy: () => ({
                  limit: () => ({
                    offset: () => Promise.reject(queryErr),
                  }),
                }),
              };
            },
          }),
        }),
      } as unknown as DbClient;

      const provider = new DbCorporateDataProvider(timeoutDb);
      const result = await provider.searchByName('テスト');
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe('DATA_UNAVAILABLE');
      expect(result.error.message).toContain('上限時間を超過しました');
    });

    it('古い data_as_of のカーソルを渡した場合は INVALID_INPUT エラーを返す', async () => {
      const db = createMockDb();
      const provider = new DbCorporateDataProvider(db);

      // 旧時点 (2026-09-01) に結びついた古いカーソル
      const staleCursor = encodeNameSearchCursor({
        offset: 10,
        data_as_of: '2026-09-01',
      });

      const result = await provider.searchByName('テスト', undefined, staleCursor);
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.message).toContain('公表データが更新されたため');
    });
  });
});
