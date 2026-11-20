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
  buildSearchNameVariants,
  buildPriorityExactNames,
  MAX_SEARCH_VARIANTS,
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

    // スペースを含む英字商号は全角スペース (U+3000) との組も展開する
    const spaceVariants = buildAsciiWidthSearchVariants('Apple Japan');
    expect(spaceVariants).toContain('Apple Japan');
    expect(spaceVariants).toContain('Ａｐｐｌｅ\u3000Ｊａｐａｎ');
    expect(spaceVariants).toContain('ＡＰＰＬＥ\u3000ＪＡＰＡＮ');
  });

  it('buildSearchNameVariants がスペース・旧字/新字・小書きカナ・ひらがな→カタカナを上限8件で展開する', () => {
    // 1. カタカナ空白（アマゾン ウェブ → 全角空白・中点・空白除去）
    const amazon = buildSearchNameVariants('アマゾン ウェブ');
    expect(amazon).toContain('アマゾン ウェブ');
    expect(amazon).toContain('アマゾン\u3000ウェブ');
    expect(amazon).toContain('アマゾン・ウェブ');
    expect(amazon).toContain('アマゾンウェブ');

    // 3文字クエリで空白除去後が2文字未満になる場合（"A B" → "AB"）は pg_trgm 保護のため 2文字候補を出さない
    const shortSpace = buildSearchNameVariants('A B', false);
    expect(shortSpace.every((v) => v.length >= 3)).toBe(true);

    // 2. 旧字体 ⇔ 新字体 双方向展開（野村証券 ⇔ 野村證券、高橋 ⇔ 髙橋）
    expect(buildSearchNameVariants('野村証券')).toContain('野村證券');
    expect(buildSearchNameVariants('野村證券')).toContain('野村証券');
    expect(buildSearchNameVariants('高橋商事')).toContain('髙橋商事');
    expect(buildSearchNameVariants('髙橋商事')).toContain('高橋商事');

    // 3. 小書きカナ ⇔ 大書きカナ 双方向展開（キャノン ⇔ キヤノン、富士フィルム ⇔ 富士フイルム）
    expect(buildSearchNameVariants('キャノン')).toContain('キヤノン');
    expect(buildSearchNameVariants('キヤノン')).toContain('キャノン');
    expect(buildSearchNameVariants('富士フィルム')).toContain('富士フイルム');
    expect(buildSearchNameVariants('キューピー')).toContain('キユーピー');
    expect(buildSearchNameVariants('シャチハタ')).toContain('シヤチハタ');

    // 4. ひらがな → カタカナ併記（すぐくる → スグクル、すぐくる株式会社 → スグクル株式会社）
    expect(buildSearchNameVariants('すぐくる')).toEqual(['すぐくる', 'スグクル']);
    expect(buildSearchNameVariants('すぐくる株式会社')).toContain('スグクル株式会社');

    // 5. 組合せ爆発の防止（最大 MAX_SEARCH_VARIANTS = 8 件）
    const manyKanji = buildSearchNameVariants('高橋山崎斎藤横浜大沢広島桜井渡辺鉄工');
    expect(manyKanji.length).toBeLessThanOrEqual(MAX_SEARCH_VARIANTS);
    expect(new Set(manyKanji).size).toBe(manyKanji.length);
  });

  it('buildPriorityExactNames が代表法人格の完全一致候補を生成し、法人格単独語では空配列を返す', () => {
    const toyotaPriority = buildPriorityExactNames('トヨタ', ['トヨタ']);
    expect(toyotaPriority).toContain('トヨタ');
    expect(toyotaPriority).toContain('株式会社トヨタ');
    expect(toyotaPriority).toContain('トヨタ株式会社');
    expect(toyotaPriority).toContain('合同会社トヨタ');

    expect(buildPriorityExactNames('株式会社', ['株式会社'])).toEqual([]);

    // 1〜2文字クエリ (isShortQuery=true) では前方一致仕様を守るため前株を除外し後株のみとする
    const shortPriority = buildPriorityExactNames('楽天', ['楽天'], true);
    expect(shortPriority).toContain('楽天株式会社');
    expect(shortPriority).not.toContain('株式会社楽天');
  });

  it('小文字/大文字英語（apple japan / APPLE JAPAN）、スペース入り英和（NTT データ）、略称・前後株逆転（(株)スグクル / 株式会社スグクル）、サロゲートペア（𠮷野 / 吉野家）を網羅する', () => {
    const lowerAppleVariants = buildSearchNameVariants('apple japan');
    expect(lowerAppleVariants).toContain('Ａｐｐｌｅ\u3000Ｊａｐａｎ');
    const lowerApplePriority = buildPriorityExactNames('apple japan', lowerAppleVariants);
    expect(lowerApplePriority).toContain('Ａｐｐｌｅ\u3000Ｊａｐａｎ合同会社');

    const upperAppleVariants = buildSearchNameVariants('APPLE JAPAN');
    expect(upperAppleVariants).toContain('Ａｐｐｌｅ\u3000Ｊａｐａｎ');
    expect(buildPriorityExactNames('APPLE JAPAN', upperAppleVariants)).toContain(
      'Ａｐｐｌｅ\u3000Ｊａｐａｎ合同会社',
    );

    const nttSpaceVariants = buildSearchNameVariants('NTT データ');
    expect(nttSpaceVariants).toContain('ＮＴＴデータ');
    const nttDotVariants = buildSearchNameVariants('NTT・データ');
    expect(nttDotVariants).toContain('ＮＴＴデータ');

    for (const q of ['(株)スグクル', '㈱スグクル', '株式会社スグクル', '株式会社 スグクル']) {
      const v = buildSearchNameVariants(q);
      expect(v).toContain('スグクル株式会社');
      expect(v).toContain('株式会社スグクル');
      const p = buildPriorityExactNames(q, v);
      expect(p).toContain('スグクル株式会社');
    }

    // サロゲートペア2文字 ("𠮷野": UTF-16 length=3, code points=2) は短語前方一致として扱う
    const yoshinoShort = buildPriorityExactNames('𠮷野', buildSearchNameVariants('𠮷野'));
    expect(yoshinoShort).toContain('𠮷野株式会社');
    expect(yoshinoShort).not.toContain('株式会社𠮷野');

    const yoshinoyaVariants = buildSearchNameVariants('吉野家');
    expect(yoshinoyaVariants).toContain('𠮷野家');
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

    it('2段階ランキングで完全一致・存続法人を先頭に配置し、複数ページにまたがるカーソル送りで重複・欠落が発生しないこと', async () => {
      // 若い法人番号に閉鎖法人や部分一致法人が並び、本家の存続「株式会社ソニックス」が大きい法人番号を持つケース
      const allDataset = [
        {
          corporateNumber: '1000000000001',
          datasetVersionId: 1,
          process: '01',
          name: 'ソニックス部品販売有限会社',
          kind: '302',
          prefectureCode: '13',
          prefectureName: '東京都',
          cityName: '港区',
          streetNumber: '芝浦一丁目',
          addressOutside: null,
          postCode: '1050023',
          updateDate: '2026-01-10',
          closeDate: '2020-03-31',
          closeCause: '01',
          furigana: 'ソニックスブヒンハンバイ',
          hihyoji: '0',
        },
        {
          corporateNumber: '1000000000002',
          datasetVersionId: 1,
          process: '01',
          name: '株式会社ソニックス', // 同名の旧閉鎖法人（番号が若い）
          kind: '301',
          prefectureCode: '27',
          prefectureName: '大阪府',
          cityName: '大阪市北区',
          streetNumber: '梅田一丁目',
          addressOutside: null,
          postCode: '5300001',
          updateDate: '2021-05-01',
          closeDate: '2021-04-30',
          closeCause: '11',
          furigana: 'カブシキガイシャソニックス',
          hihyoji: '0',
        },
        ...Array.from({ length: 6 }, (_, i) => ({
          corporateNumber: `200000000000${i + 1}`,
          datasetVersionId: 1,
          process: '01',
          name: `ソニックス開発第${i + 1}株式会社`,
          kind: '301',
          prefectureCode: '13',
          prefectureName: '東京都',
          cityName: '品川区',
          streetNumber: '北品川一丁目',
          addressOutside: null,
          postCode: '1400001',
          updateDate: '2026-04-01',
          closeDate: null,
          closeCause: null,
          furigana: 'ソニックスカイハツ',
          hihyoji: '0',
        })),
        {
          corporateNumber: '8000000000099',
          datasetVersionId: 1,
          process: '01',
          name: '株式会社ソニックス', // 存続中の本家株式会社（法人番号は一番大きい）
          kind: '301',
          prefectureCode: '13',
          prefectureName: '東京都',
          cityName: '港区',
          streetNumber: '港南一丁目',
          addressOutside: null,
          postCode: '1080075',
          updateDate: '2026-09-01',
          closeDate: null,
          closeCause: null,
          furigana: 'カブシキガイシャソニックス',
          hihyoji: '0',
        },
      ];

      // Stage 1 (inArray: exact priority names) と Stage 2 (notInArray + ilike) を模擬する DB
      const prioritySet = new Set(buildPriorityExactNames('ソニックス', ['ソニックス']));
      let queryCallIndex = 0;
      const twoStageDb = {
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
              const currentCall = queryCallIndex++;
              const isStage1 = currentCall % 2 === 0;
              return {
                orderBy: () => ({
                  limit: (limitCount: number) => ({
                    offset: (offsetCount: number) => {
                      const matched = isStage1
                        ? allDataset.filter((r) => prioritySet.has(r.name))
                        : allDataset.filter((r) => !prioritySet.has(r.name));
                      const sorted = [...matched].sort((a, b) =>
                        a.corporateNumber.localeCompare(b.corporateNumber),
                      );
                      return Promise.resolve(sorted.slice(offsetCount, offsetCount + limitCount));
                    },
                  }),
                }),
              };
            },
          }),
        }),
      } as unknown as DbClient;

      const provider = new DbCorporateDataProvider(twoStageDb);

      // limit=4 で全9件を3ページにわたり取得
      const p1 = await provider.searchByName('ソニックス', undefined, undefined, 4);
      expect(p1.ok).toBe(true);
      if (!p1.ok) return;

      // 1件目は存続中の「株式会社ソニックス」(8000000000099)、2件目は同名の閉鎖法人 (1000000000002)
      expect(p1.value.results[0]?.corporate_number).toBe('8000000000099');
      expect(p1.value.results[0]?.status).toBe('active');
      expect(p1.value.results[1]?.corporate_number).toBe('1000000000002');
      expect(p1.value.results[1]?.status).toBe('closed');
      expect(p1.value.next_cursor).not.toBeNull();

      const p2 = await provider.searchByName(
        'ソニックス',
        undefined,
        p1.value.next_cursor ?? undefined,
        4,
      );
      expect(p2.ok).toBe(true);
      if (!p2.ok) return;
      expect(p2.value.results).toHaveLength(4);
      expect(p2.value.next_cursor).not.toBeNull();

      const p3 = await provider.searchByName(
        'ソニックス',
        undefined,
        p2.value.next_cursor ?? undefined,
        4,
      );
      expect(p3.ok).toBe(true);
      if (!p3.ok) return;
      expect(p3.value.results).toHaveLength(1);
      expect(p3.value.next_cursor).toBeNull();
      expect(p3.value.total_count).toBe(9);

      const allReturnedNumbers = [
        ...p1.value.results,
        ...p2.value.results,
        ...p3.value.results,
      ].map((r) => r.corporate_number);
      expect(allReturnedNumbers).toHaveLength(allDataset.length);
      expect(new Set(allReturnedNumbers).size).toBe(allDataset.length);
    });
  });
});
