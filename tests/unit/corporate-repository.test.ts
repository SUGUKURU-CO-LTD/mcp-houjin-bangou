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
  toHalfWidthAscii,
  toFullWidthAscii,
  buildAsciiWidthSearchVariants,
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

describe('ASCII 半角・全角検索バリエーション展開', () => {
  it('半角英数字から全角英数字バリエーション（大文字・小文字）を生成すること', () => {
    expect(toFullWidthAscii('NTTデータ')).toBe('ＮＴＴデータ');
    expect(toHalfWidthAscii('株式会社ＮＴＴデータ')).toBe('株式会社NTTデータ');

    const variants = buildAsciiWidthSearchVariants('DeNA');
    expect(variants).toContain('DeNA');
    expect(variants).toContain('ＤｅＮＡ');
    expect(variants).toContain('ＤＥＮＡ');
    expect(variants).toContain('ｄｅｎａ');

    // 純日本語のみの場合は単一要素のまま余計な OR 条件を増やさない
    expect(buildAsciiWidthSearchVariants('スグクル')).toEqual(['スグクル']);
  });
});

describe('isTimeoutError (PostgreSQL タイムアウトエラー判定)', () => {
  it('PostgreSQL エラーコード 57014 (query_canceled) を検知すること', () => {
    expect(
      isTimeoutError({ code: '57014', message: 'canceling statement due to statement timeout' }),
    ).toBe(true);
  });

  it('statement timeout を含むエラーメッセージを検知すること', () => {
    expect(
      isTimeoutError(new Error('Query failed: canceling statement due to statement timeout')),
    ).toBe(true);
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

  function createMockDb(
    records: ReadonlyArray<Record<string, unknown>> = mockCorporateData,
    hasActiveVersion = true,
  ): DbClient {
    return {
      select: (fields?: unknown) => ({
        from: () => ({
          where: () => {
            // 1. dataset_versions の取得
            if (fields && typeof fields === 'object' && 'dataAsOf' in (fields as object)) {
              return {
                orderBy: () => ({
                  limit: () =>
                    Promise.resolve(hasActiveVersion ? [{ id: 1, dataAsOf: currentDataAsOf }] : []),
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

    it('次ページが存在する場合は COUNT(*) を実行せず total_count: null として検索結果を返すこと（大量ヒット時負荷防止）', async () => {
      // 12件のレコードを用意し、limit=10 で次ページがある状態
      const manyRecords = Array.from({ length: 12 }, (_, i) => ({
        ...mockCorporateData[0],
        corporateNumber: `10000000000${i.toString().padStart(2, '0')}`,
        name: `株式会社テスト企業${i}`,
      }));

      let countQueryExecuted = false;

      const fastCountDb = {
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

              // COUNT(*) が実行されたらフラグを立てる
              if (fields && typeof fields === 'object' && 'total' in (fields as object)) {
                countQueryExecuted = true;
                return Promise.resolve([{ total: 9999 }]);
              }

              // corporate_numbers: fetchLimit=11 で 11 件返す（次ページあり）
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

      const provider = new DbCorporateDataProvider(fastCountDb);
      const result = await provider.searchByName('テスト', undefined, undefined, 10);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // 10件返却され、次カーソルが発行され、COUNT(*) は実行されず total_count は null
      expect(result.value.results.length).toBe(10);
      expect(result.value.total_count).toBeNull();
      expect(result.value.next_cursor).not.toBeNull();
      expect(countQueryExecuted).toBe(false);
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

    it('データベース内部エラー発生時は利用者に固定文を返し詳細メッセージを秘匿すること', async () => {
      const errorDb = {
        select: (fields?: unknown) => ({
          from: () => ({
            where: () => {
              if (fields && typeof fields === 'object' && 'dataAsOf' in (fields as object)) {
                return {
                  orderBy: () => ({
                    limit: () => Promise.resolve([{ id: 1, dataAsOf: currentDataAsOf }]),
                  }),
                };
              }
              return {
                orderBy: () => ({
                  limit: () => ({
                    offset: () =>
                      Promise.reject(
                        new Error('FATAL: connection terminated unexpectedly; secret_table schema'),
                      ),
                  }),
                }),
              };
            },
          }),
        }),
      } as unknown as DbClient;

      const provider = new DbCorporateDataProvider(errorDb);
      const result = await provider.searchByName('テスト');
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe('INTERNAL_ERROR');
      // エラー本文に内部の生エラー文（secret_tableなど）が含まれず固定文であること
      expect(result.error.message).toBe(
        'データベースで予期しないエラーが発生しました。時間をおいて再試行してください。',
      );
      expect(result.error.message).not.toContain('secret_table');
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

    it('検索条件（法人名・都道府県）が異なる queryKey のカーソルを使い回した場合は INVALID_INPUT を返す', async () => {
      const db = createMockDb();
      const provider = new DbCorporateDataProvider(db);

      const otherQueryCursor = encodeNameSearchCursor({
        offset: 10,
        data_as_of: currentDataAsOf,
        queryKey: '別の会社|13',
      });

      const result = await provider.searchByName('テスト', '46', otherQueryCursor);
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.message).toContain('検索条件が変更されたため');
    });

    it('処理区分 99（削除）のレコードは lookupByNumber で NOT_FOUND、searchByName で除外されること', async () => {
      const deletedRow = {
        corporateNumber: '9000000000009',
        datasetVersionId: 1,
        process: '99',
        name: '削除テスト株式会社',
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
        furigana: 'サクジョテストカブシキガイシャ',
      };
      const recordsWithDeleted = [...mockCorporateData, deletedRow];
      const db = createMockDb(recordsWithDeleted);
      const provider = new DbCorporateDataProvider(db);

      const singleDeletedDb = createMockDb([deletedRow]);
      const singleDeletedProvider = new DbCorporateDataProvider(singleDeletedDb);
      const directDeleted = await singleDeletedProvider.lookupByNumber('9000000000009');
      expect(directDeleted.ok).toBe(false);
      if (!directDeleted.ok) {
        expect(directDeleted.error.code).toBe('NOT_FOUND');
      }

      const searchRes = await provider.searchByName('テスト');
      expect(searchRes.ok).toBe(true);
      if (searchRes.ok) {
        expect(searchRes.value.results.map((r) => r.corporate_number)).not.toContain(
          '9000000000009',
        );
      }
    });

    it('吸収合併等で承継先法人番号がある場合 successorCorporateNumber / successor_corporate_number が設定され、非列挙互換であること', async () => {
      const mergedRecord = {
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
        closeCause: '11',
        successorCorporateNumber: '9340001026142',
        furigana: 'ヘイサテストカブシキガイシャ',
      };
      const db = createMockDb([mergedRecord]);
      const provider = new DbCorporateDataProvider(db);

      const res = await provider.lookupByNumber('1000000000003');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.corporation.successorCorporateNumber).toBe('9340001026142');
        expect(res.value.corporation.successor_corporate_number).toBe('9340001026142');
        // strict JSON Schema (additionalProperties: false) を壊さないよう camelCase は非列挙
        expect(Object.keys(res.value.corporation)).not.toContain('successorCorporateNumber');
      }
    });

    it('DBエラー時の stderr ログから SQL バインドパラメータ (\\nparams:) が除去されること', async () => {
      const stderrLogs: string[] = [];
      const origWrite = process.stderr.write;
      process.stderr.write = ((chunk: unknown) => {
        stderrLogs.push(String(chunk));
        return true;
      }) as typeof process.stderr.write;

      try {
        const drizzleErr = new Error(
          'Failed query: select * from "corporate_numbers" where "corporate_number" = $1\nparams: 9340001026142',
        );
        const failingDb = {
          select: (fields?: unknown) => ({
            from: () => ({
              where: () => {
                if (fields && typeof fields === 'object' && 'dataAsOf' in (fields as object)) {
                  return {
                    orderBy: () => ({
                      limit: () => Promise.resolve([{ id: 1, dataAsOf: currentDataAsOf }]),
                    }),
                  };
                }
                return {
                  limit: () => Promise.reject(drizzleErr),
                };
              },
            }),
          }),
        } as unknown as DbClient;

        const provider = new DbCorporateDataProvider(failingDb);
        const res = await provider.lookupByNumber('9340001026142');
        expect(res.ok).toBe(false);

        const logText = stderrLogs.join('');
        expect(logText).toContain('"logger":"corporate_repository"');
        expect(logText).not.toContain('params:');
        expect(logText).not.toContain('9340001026142');
      } finally {
        process.stderr.write = origWrite;
      }
    });
  });
});
