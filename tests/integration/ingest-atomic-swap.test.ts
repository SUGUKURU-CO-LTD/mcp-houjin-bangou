/**
 * Ingest Atomic Swap Integration Tests
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §6.1, §6.2 (ホスト版データ取り込み・全件入れ替え)
 *   Linear Issue: SLA2-324 完了条件:
 *     - 合成データで「初回取り込み→2回目の全件入れ替え→検索」が通り、
 *     - 2回目の途中で失敗させても前の版と前の data_as_of で検索できることを実証する。
 *
 * 【テストデータの性格】
 *   本テストで使用しているデータはすべてテスト用に作成した「合成データ」であり、
 *   実在する事業者や個人の情報、国税庁本番データではありません。
 */

import { describe, it, expect } from 'vitest';
import { DatasetImporter } from '../../src/ingest/importer.js';
import { DbCorporateDataProvider } from '../../src/repository/corporate-repository.js';
import type { DbClient } from '../../src/db/client.js';

interface DatasetVersionRow {
  id: number;
  sourceType: string;
  dataAsOf: string;
  status: string;
  recordCount: number;
  importedAt: Date | null;
}

interface CorporateRow {
  corporateNumber: string;
  datasetVersionId: number;
  name: string;
  kind: string;
  prefectureCode?: string | null;
  cityCode?: string | null;
  prefectureName?: string | null;
  cityName?: string | null;
  streetNumber?: string | null;
  addressOutside?: string | null;
  postCode?: string | null;
  updateDate: string;
  closeDate?: string | null;
  closeCause?: string | null;
  furigana?: string | null;
  hihyoji?: string | null;
  [key: string]: unknown;
}

function safeStringify(obj: unknown): string {
  const seen = new WeakSet();
  try {
    return JSON.stringify(obj, (_key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return undefined;
        }
        seen.add(value);
      }
      return value;
    });
  } catch {
    return '';
  }
}

/**
 * PostgreSQL のトランザクション・アトミックスワップ挙動をシミュレートするインメモリテストDB
 */
class InMemoryAtomicTestDb {
  public versions: DatasetVersionRow[] = [];
  public staging: CorporateRow[] = [];
  public corporateNumbers: CorporateRow[] = [];
  private nextVersionId = 1;

  public failOnTransaction = false;

  private cloneState() {
    return {
      versions: JSON.parse(JSON.stringify(this.versions)) as DatasetVersionRow[],
      staging: JSON.parse(JSON.stringify(this.staging)) as CorporateRow[],
      corporateNumbers: JSON.parse(JSON.stringify(this.corporateNumbers)) as CorporateRow[],
    };
  }

  private restoreState(state: {
    versions: DatasetVersionRow[];
    staging: CorporateRow[];
    corporateNumbers: CorporateRow[];
  }) {
    this.versions = state.versions;
    this.staging = state.staging;
    this.corporateNumbers = state.corporateNumbers;
  }

  public getClient(): DbClient {
    const self = this;

    const client = {
      select: (fields?: unknown) => ({
        from: (_table: unknown) => ({
          where: (whereClause: unknown) => {
            // dataset_versions の問い合わせ判定
            const isVersionQuery =
              fields &&
              typeof fields === 'object' &&
              ('dataAsOf' in (fields as object) || 'id' in (fields as object));

            if (isVersionQuery) {
              const activeVersions = self.versions
                .filter((v) => v.sourceType === 'nta_corporate_download' && v.status === 'active')
                .sort((a, b) => {
                  const timeA = a.importedAt ? new Date(a.importedAt).getTime() : 0;
                  const timeB = b.importedAt ? new Date(b.importedAt).getTime() : 0;
                  return timeB - timeA;
                });

              return {
                orderBy: () => ({
                  limit: (limitCount: number) =>
                    Promise.resolve(
                      activeVersions.slice(0, limitCount).map((v) => ({
                        id: v.id,
                        dataAsOf: v.dataAsOf,
                      })),
                    ),
                }),
                limit: (limitCount: number) =>
                  Promise.resolve(
                    activeVersions.slice(0, limitCount).map((v) => ({
                      id: v.id,
                      dataAsOf: v.dataAsOf,
                    })),
                  ),
              };
            }

            // corporate_numbers のクエリ
            return {
              limit: (limitCount: number) => {
                const activeVersion = self.versions
                  .filter((v) => v.sourceType === 'nta_corporate_download' && v.status === 'active')
                  .sort((a, b) => {
                    const timeA = a.importedAt ? new Date(a.importedAt).getTime() : 0;
                    const timeB = b.importedAt ? new Date(b.importedAt).getTime() : 0;
                    return timeB - timeA;
                  })[0];

                if (!activeVersion) return Promise.resolve([]);

                let match = self.corporateNumbers.filter(
                  (c) => c.datasetVersionId === activeVersion.id,
                );

                const whereStr = safeStringify(whereClause);
                // corporateNumber での検索判定
                for (const row of self.corporateNumbers) {
                  if (whereStr.includes(row.corporateNumber)) {
                    match = match.filter((c) => c.corporateNumber === row.corporateNumber);
                    break;
                  }
                }

                // name での検索判定（LIKE パターン）
                for (const row of self.corporateNumbers) {
                  // 部分一致
                  if (row.name && whereStr.includes(row.name)) {
                    match = match.filter((c) => c.name.includes(row.name));
                    break;
                  }
                }

                return Promise.resolve(match.slice(0, limitCount));
              },
              orderBy: () => ({
                limit: (limitCount: number) => ({
                  offset: (offsetCount: number) => {
                    const activeVersion = self.versions
                      .filter(
                        (v) => v.sourceType === 'nta_corporate_download' && v.status === 'active',
                      )
                      .sort((a, b) => {
                        const timeA = a.importedAt ? new Date(a.importedAt).getTime() : 0;
                        const timeB = b.importedAt ? new Date(b.importedAt).getTime() : 0;
                        return timeB - timeA;
                      })[0];

                    if (!activeVersion) return Promise.resolve([]);
                    let match = self.corporateNumbers.filter(
                      (c) => c.datasetVersionId === activeVersion.id,
                    );

                    const whereStr = safeStringify(whereClause);
                    // 部分一致パターンを whereStr から検索
                    for (const row of self.corporateNumbers) {
                      const prefix = row.name.slice(0, 4);
                      if (whereStr.includes(prefix)) {
                        match = match.filter((c) => c.name.includes(prefix));
                        break;
                      }
                    }

                    return Promise.resolve(match.slice(offsetCount, offsetCount + limitCount));
                  },
                }),
              }),
            };
          },
        }),
      }),

      insert: (_table: unknown) => ({
        values: (values: unknown) => {
          if (Array.isArray(values)) {
            // staging へのバッチ挿入
            for (const row of values) {
              self.staging.push(row as CorporateRow);
            }
            return {
              returning: async () => [],
              execute: async () => {},
            };
          }

          // datasetVersions への単一挿入
          const val = values as Partial<DatasetVersionRow>;
          const newId = self.nextVersionId++;
          const newVersion: DatasetVersionRow = {
            id: newId,
            sourceType: val.sourceType ?? 'nta_corporate_download',
            dataAsOf: val.dataAsOf ?? '',
            status: val.status ?? 'staging',
            recordCount: val.recordCount ?? 0,
            importedAt: null,
          };
          self.versions.push(newVersion);

          return {
            returning: async () => [{ id: newId }],
            execute: async () => {},
          };
        },
      }),

      update: (_table: unknown) => ({
        set: (setVal: Partial<DatasetVersionRow>) => ({
          where: (_clause?: unknown) => {
            // staging が失敗した際のマーク処理 (status: 'failed')
            if (setVal.status === 'failed') {
              const last = self.versions[self.versions.length - 1];
              if (last && last.status === 'staging') {
                last.status = 'failed';
              }
            }
            return Promise.resolve();
          },
        }),
      }),

      delete: (_table: unknown) => ({
        where: () => Promise.resolve(),
      }),

      transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        const snapshot = self.cloneState();

        const mockTx = {
          execute: async (query: { strings?: string[]; queryChunks?: unknown[] }) => {
            if (self.failOnTransaction) {
              throw new Error('Database transaction failure (simulated atomic crash)');
            }

            const queryStr = JSON.stringify(query);

            // DB内完結 INSERT ... SELECT
            if (queryStr.includes('INSERT INTO corporate_numbers') && queryStr.includes('SELECT')) {
              // staging の最新データを corporate_numbers にコピー
              const lastVersion = self.versions[self.versions.length - 1];
              if (lastVersion) {
                const rowsToPromote = self.staging.filter(
                  (r) => r.datasetVersionId === lastVersion.id,
                );
                for (const r of rowsToPromote) {
                  self.corporateNumbers.push({ ...r });
                }
              }
            }

            // 旧版データのクリーンアップ: DELETE FROM corporate_numbers WHERE dataset_version_id != $1
            if (queryStr.includes('DELETE FROM corporate_numbers')) {
              const lastVersion = self.versions[self.versions.length - 1];
              if (lastVersion) {
                self.corporateNumbers = self.corporateNumbers.filter(
                  (c) => c.datasetVersionId === lastVersion.id,
                );
              }
            }
          },

          update: (_table: unknown) => ({
            set: (setVal: Partial<DatasetVersionRow>) => ({
              where: () => {
                if (self.failOnTransaction) {
                  throw new Error('Transaction failure during version update');
                }

                if (setVal.status === 'superseded') {
                  for (const v of self.versions) {
                    if (v.status === 'active') {
                      v.status = 'superseded';
                    }
                  }
                } else if (setVal.status === 'active') {
                  const target = self.versions[self.versions.length - 1];
                  if (target) {
                    target.status = 'active';
                    target.recordCount = setVal.recordCount ?? target.recordCount;
                    target.importedAt = new Date();
                  }
                }
                return Promise.resolve();
              },
            }),
          }),

          delete: (_table: unknown) => ({
            where: () => {
              if (self.failOnTransaction) {
                throw new Error('Transaction failure during staging cleanup');
              }
              // staging 削除
              const lastVersion = self.versions[self.versions.length - 1];
              if (lastVersion) {
                self.staging = self.staging.filter((s) => s.datasetVersionId !== lastVersion.id);
              }
              return Promise.resolve();
            },
          }),
        };

        try {
          return await callback(mockTx);
        } catch (error) {
          // ロールバック
          self.restoreState(snapshot);
          throw error;
        }
      },
    };

    return client as unknown as DbClient;
  }
}

describe('Ingest Atomic Swap Integration Tests (合成テストデータ使用)', () => {
  it('初回取り込み成功 → 2回目取り込み途中で失敗しても前世代の版とデータで検索可能 → 2回目再試行で全件入れ替えが成功する', async () => {
    const dbSim = new InMemoryAtomicTestDb();
    const dbClient = dbSim.getClient();
    const importer = new DatasetImporter(dbClient);
    const dataProvider = new DbCorporateDataProvider(dbClient);

    // ==========================================
    // 1. 初回取り込み（v1: 2026-09-01 時点）
    // ==========================================
    const initialDataset = [
      '1,"1000000000001","01","1","2026-09-01","2026-09-01","株式会社テスト第一","","301","東京都","千代田区","大手町一丁目","","13","101","1000001","","","","","","","","1","","","","","","0"',
      '2,"1000000000002","01","1","2026-09-01","2026-09-01","株式会社テスト第二","","301","東京都","中央区","日本橋一丁目","","13","102","1030001","","","","","","","","1","","","","","","0"',
    ];

    const v1Metrics = await importer.importCorporateDataset(initialDataset, '2026-09-01', 10);
    expect(v1Metrics.status).toBe('active');
    expect(v1Metrics.count).toBe(2);
    expect(v1Metrics.datasetVersionId).toBe(1);

    // v1 時点での検索確認
    // 単独検索
    const lookup1 = await dataProvider.lookupByNumber('1000000000001');
    expect(lookup1.ok).toBe(true);
    if (lookup1.ok) {
      expect(lookup1.value.data_as_of).toBe('2026-09-01');
      expect(lookup1.value.corporation.name).toBe('株式会社テスト第一');
    }

    // 名前検索
    const search1 = await dataProvider.searchByName('株式会社テスト第一');
    expect(search1.ok).toBe(true);
    if (search1.ok) {
      expect(search1.value.data_as_of).toBe('2026-09-01');
      expect(search1.value.results.length).toBeGreaterThan(0);
      expect(search1.value.results[0]?.corporate_number).toBe('1000000000001');
    }

    // ==========================================
    // 2. 2回目の取り込み（v2: 2026-10-01 時点）で障害発生・ロールバック
    // ==========================================
    // トランザクション内で意図的にクラッシュをシミュレート
    dbSim.failOnTransaction = true;

    const brokenDataset = [
      '1,"1000000000001","01","1","2026-10-01","2026-10-01","株式会社テスト第一（更新版）","","301","東京都","千代田区","丸の内一丁目","","13","101","1000005","","","","","","","","1","","","","","","0"',
      '3,"1000000000003","01","1","2026-10-01","2026-10-01","株式会社テスト第三（新規）","","301","東京都","港区","六本木一丁目","","13","103","1060001","","","","","","","","1","","","","","","0"',
    ];

    await expect(importer.importCorporateDataset(brokenDataset, '2026-10-01', 10)).rejects.toThrow(
      'Database transaction failure',
    );

    // v2 は failed にマークされていること
    const failedVersion = dbSim.versions.find((v) => v.id === 2);
    expect(failedVersion).toBeDefined();
    expect(failedVersion?.status).toBe('failed');

    // 【最重要完了条件】
    // 障害発生後も、前世代（v1）の active 版と data_as_of（2026-09-01）で継続して検索できること
    const lookupAfterFail = await dataProvider.lookupByNumber('1000000000001');
    expect(lookupAfterFail.ok).toBe(true);
    if (lookupAfterFail.ok) {
      expect(lookupAfterFail.value.data_as_of).toBe('2026-09-01');
      expect(lookupAfterFail.value.corporation.name).toBe('株式会社テスト第一');
    }

    const searchAfterFail = await dataProvider.searchByName('株式会社テスト第一');
    expect(searchAfterFail.ok).toBe(true);
    if (searchAfterFail.ok) {
      expect(searchAfterFail.value.data_as_of).toBe('2026-09-01');
      expect(searchAfterFail.value.results[0]?.corporate_number).toBe('1000000000001');
    }

    // ==========================================
    // 3. 2回目の再試行（v3: 2026-10-01 時点）で全件入れ替えが成功
    // ==========================================
    // トランザクション正常化
    dbSim.failOnTransaction = false;

    const retryDataset = [
      '1,"1000000000001","01","1","2026-10-01","2026-10-01","株式会社テスト第一（新本店）","","301","東京都","千代田区","丸の内一丁目","","13","101","1000005","","","","","","","","1","","","","","","0"',
      '3,"1000000000003","01","1","2026-10-01","2026-10-01","株式会社テスト第三（新設）","","301","東京都","港区","六本木一丁目","","13","103","1060001","","","","","","","","1","","","","","","0"',
    ];

    const v3Metrics = await importer.importCorporateDataset(retryDataset, '2026-10-01', 10);
    expect(v3Metrics.status).toBe('active');
    expect(v3Metrics.count).toBe(2);
    expect(v3Metrics.datasetVersionId).toBe(3);

    // v1 は superseded になっていること
    const v1Record = dbSim.versions.find((v) => v.id === 1);
    expect(v1Record?.status).toBe('superseded');

    // 最新の v3 (data_as_of: 2026-10-01) で検索できること
    const lookupAfterSwap = await dataProvider.lookupByNumber('1000000000001');
    expect(lookupAfterSwap.ok).toBe(true);
    if (lookupAfterSwap.ok) {
      expect(lookupAfterSwap.value.data_as_of).toBe('2026-10-01');
      expect(lookupAfterSwap.value.corporation.name).toBe('株式会社テスト第一（新本店）');
    }

    const searchAfterSwap = await dataProvider.searchByName('株式会社テスト');
    expect(searchAfterSwap.ok).toBe(true);
    if (searchAfterSwap.ok) {
      expect(searchAfterSwap.value.data_as_of).toBe('2026-10-01');
      const nums = searchAfterSwap.value.results.map((r) => r.corporate_number);
      expect(nums).toContain('1000000000001');
      expect(nums).toContain('1000000000003');
      // 全件入れ替えにより、v1 にあった 1000000000002 は削除されていること
      expect(nums).not.toContain('1000000000002');
    }
  });

  it('swapCorporateTable: トランザクション内でエラーが発生した場合、テーブル状態およびバージョン状態が巻き戻される', async () => {
    const dbSim = new InMemoryAtomicTestDb();
    // 初期 active 版を設定
    dbSim.versions.push({
      id: 1,
      sourceType: 'nta_corporate_download',
      dataAsOf: '2026-09-01',
      status: 'active',
      recordCount: 10,
      importedAt: new Date(),
    });
    // staging 完了した新版
    dbSim.versions.push({
      id: 2,
      sourceType: 'nta_corporate_download',
      dataAsOf: '2026-10-01',
      status: 'staging',
      recordCount: 12,
      importedAt: null,
    });

    const dbClient = dbSim.getClient();
    const importer = new DatasetImporter(dbClient);

    // スワップ処理中に障害をシミュレート
    dbSim.failOnTransaction = true;

    await expect(
      importer.swapCorporateTable(
        'corporate_numbers_staging',
        'corporate_numbers',
        'corporate_numbers_old',
        2,
        '2026-10-01',
      ),
    ).rejects.toThrow('Database transaction failure');

    // トランザクションがロールバックされ、v1 は依然として active であること
    const v1 = dbSim.versions.find((v) => v.id === 1);
    expect(v1?.status).toBe('active');

    // v2 は active に昇格していないこと
    const v2 = dbSim.versions.find((v) => v.id === 2);
    expect(v2?.status).toBe('staging');
  });
});
