/**
 * Full-scale Synthetic Data Benchmark Script
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §6.1, §6.2
 *   Linear Issue: SLA2-324 測定の再現性:
 *     - 合成データのみを使用するベンチマークスクリプトをリポジトリに配置し、
 *       誰でも同じ手順で再測定できるようにする。実データは含めない。
 *     - 合成データ約573万件での取り込み・入れ替え時間を実測し、
 *       2文字語、長語、大量ヒット語の EXPLAIN (ANALYZE, BUFFERS) 測定を行う。
 *   件数の根拠:
 *     国税庁法人番号公表サイト「法人番号に関する情報」公表件数 5,729,508 件
 *     （令和7年12月末時点、令和8年1月13日公表資料）
 *     https://www.houjin-bangou.nta.go.jp/setsumei/houjin-bangou_joho/
 *
 * 【重要: テストデータの性格】
 *   本スクリプトで使用するデータはすべてテスト用の「合成データ」であり、
 *   実在する事業者や個人の情報、国税庁本番データではありません。
 */

import { getDb, getIngestDb, closeDbClient } from '../src/db/client.js';
import { datasetVersions } from '../src/db/schema.js';
import { escapeLikeWildcards } from '../src/repository/corporate-repository.js';
import { sql, and, eq } from 'drizzle-orm';

interface BenchmarkConfig {
  numRecords: number;
  iterations: number;
  skipImport: boolean;
}

const parseArgs = (): BenchmarkConfig => {
  const args = process.argv.slice(2);
  const skipImport = args.includes('--skip-import');
  const recordsArg = process.env.BENCH_RECORDS;
  const numRecords = recordsArg ? parseInt(recordsArg, 10) : 5729508;

  return {
    numRecords,
    iterations: 5,
    skipImport,
  };
};

/**
 * 測定対象クエリ
 */
const QUERIES = [
  {
    name: '1. 長い語で1件だけ当たる検索',
    term: '株式会社スグクルホールディングス鹿児島国分中央特命営業部',
    limit: 10,
    expectedBehavior: 'pg_trgm GIN 索引 (idx_corporate_numbers_name_trgm) による Bitmap Index Scan',
  },
  {
    name: '2. 該当が少ない2文字の語の検索',
    term: '合宿',
    limit: 10,
    expectedBehavior:
      '2文字語のため trigram 未生成。主キー順 (Index Scan) 走査または Seq Scan にフォールバック',
  },
  {
    name: '3. 大量に当たる語の検索（株式会社）',
    term: '株式会社',
    limit: 10,
    expectedBehavior: '多数ヒット。主キー順 Index Scan により LIMIT 10 件到達で早期完了',
  },
];

async function runExplainAnalyze(db: ReturnType<typeof getDb>, term: string, limit: number) {
  const pattern = `%${escapeLikeWildcards(term)}%`;

  // EXPLAIN (ANALYZE, BUFFERS)
  const query = sql`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT
      corporate_number, name, kind, prefecture_name, city_name,
      street_number, address_outside, update_date, close_date, close_cause
    FROM corporate_numbers
    WHERE name ILIKE ${pattern}
    ORDER BY corporate_number ASC
    LIMIT ${limit + 1};
  `;

  const result = await db.execute(query);
  return result;
}

async function runBenchmarkImportAndSwap(
  ingestDb: ReturnType<typeof getIngestDb>,
  numRecords: number,
) {
  console.log('\n====================================================');
  console.log(
    ` [Step 1] 合成データ約573万件 (${numRecords.toLocaleString()} 件) の取り込み＆RENAME Swap 実測`,
  );
  console.log('====================================================');

  const totalStartTime = performance.now();

  // 1. データセットバージョンの準備
  const dataAsOf = '2026-10-01';
  const [version] = await ingestDb
    .insert(datasetVersions)
    .values({
      sourceType: 'nta_corporate_download',
      dataAsOf,
      status: 'staging',
      recordCount: 0,
    })
    .returning({ id: datasetVersions.id });

  if (!version) {
    throw new Error('Failed to create staging dataset version record');
  }
  const versionId = version.id;
  console.log(`- Staging Dataset Version ID: ${versionId} (data_as_of: ${dataAsOf})`);

  // 2. 一時テーブル corporate_numbers_new の初期化
  console.log('- 一時テーブル corporate_numbers_new を初期化中...');
  await ingestDb.execute(sql`DROP TABLE IF EXISTS corporate_numbers_new;`);
  await ingestDb.execute(sql`DROP TABLE IF EXISTS corporate_numbers_old;`);
  await ingestDb.execute(
    sql`CREATE TABLE corporate_numbers_new (LIKE corporate_numbers INCLUDING DEFAULTS);`,
  );

  // 3. 合成データの高速一括生成・投入
  console.log(`- 合成データ ${numRecords.toLocaleString()} 件を生成・投入中 (generate_series)...`);
  const insertStart = performance.now();
  await ingestDb.execute(sql`
    INSERT INTO corporate_numbers_new (
      corporate_number,
      process,
      correct,
      update_date,
      change_date,
      name,
      kind,
      prefecture_name,
      city_name,
      street_number,
      prefecture_code,
      city_code,
      post_code,
      latest,
      hihyoji,
      dataset_version_id
    )
    SELECT
      (1000000000000 + i)::text as corporate_number,
      '01' as process,
      '0' as correct,
      '2026-10-01' as update_date,
      '2026-10-01' as change_date,
      CASE
        WHEN i = 1000000 THEN '株式会社スグクルホールディングス鹿児島国分中央特命営業部'
        WHEN i = 2000000 THEN '合宿教育株式会社'
        WHEN i % 10 = 0 THEN '合同会社サンプル' || lpad(i::text, 8, '0')
        WHEN i % 10 = 1 THEN '有限会社サンプル' || lpad(i::text, 8, '0')
        WHEN i % 10 = 2 THEN '一般社団法人サンプル' || lpad(i::text, 8, '0')
        ELSE '株式会社サンプル' || lpad(i::text, 8, '0')
      END as name,
      '301' as kind,
      '東京都' as prefecture_name,
      '千代田区' as city_name,
      '霞が関1-1-1' as street_number,
      '13' as prefecture_code,
      '101' as city_code,
      '1000001' as post_code,
      '1' as latest,
      '0' as hihyoji,
      ${versionId} as dataset_version_id
    FROM generate_series(1, ${numRecords}) as i;
  `);
  const insertDuration = (performance.now() - insertStart) / 1000;
  console.log(`  ✓ データ投入所要時間: ${insertDuration.toFixed(2)} 秒`);

  // 4. 制約・索引の作成
  console.log('- 制約 (PK, FK) を作成中...');
  const constraintStart = performance.now();
  await ingestDb.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
  await ingestDb.execute(sql`
    ALTER TABLE corporate_numbers_new
      ADD CONSTRAINT corporate_numbers_new_pk PRIMARY KEY (corporate_number, dataset_version_id);
  `);
  await ingestDb.execute(sql`
    ALTER TABLE corporate_numbers_new
      ADD CONSTRAINT corporate_numbers_new_dataset_versions_fk
      FOREIGN KEY (dataset_version_id) REFERENCES dataset_versions(id) ON DELETE CASCADE;
  `);
  const constraintDuration = (performance.now() - constraintStart) / 1000;
  console.log(`  ✓ 制約作成所要時間: ${constraintDuration.toFixed(2)} 秒`);

  console.log('- 索引 (GIN 1本, B-tree 4本) を作成中...');
  const indexStart = performance.now();
  await ingestDb.execute(sql`
    CREATE INDEX idx_corporate_numbers_number_new ON corporate_numbers_new (corporate_number);
    CREATE INDEX idx_corporate_numbers_name_new ON corporate_numbers_new (name);
    CREATE INDEX idx_corporate_numbers_name_trgm_new ON corporate_numbers_new USING gin (name gin_trgm_ops);
    CREATE INDEX idx_corporate_numbers_prefecture_new ON corporate_numbers_new (prefecture_code);
    CREATE INDEX idx_corporate_numbers_version_new ON corporate_numbers_new (dataset_version_id);
  `);
  const indexDuration = (performance.now() - indexStart) / 1000;
  console.log(`  ✓ 索引作成所要時間: ${indexDuration.toFixed(2)} 秒`);

  // 4b. RENAME Swap 直前（旧表＋新表＋両方の索引が同時存在するピーク時）の容量計測
  console.log('- RENAME Swap 直前のピーク時容量を計測中 (pg_total_relation_size)...');
  const peakSizeRes = await ingestDb.execute(sql`
    SELECT
      pg_total_relation_size('corporate_numbers') AS active_total_bytes,
      pg_relation_size('corporate_numbers') AS active_table_bytes,
      pg_indexes_size('corporate_numbers') AS active_indexes_bytes,
      pg_total_relation_size('corporate_numbers_new') AS staging_total_bytes,
      pg_relation_size('corporate_numbers_new') AS staging_table_bytes,
      pg_indexes_size('corporate_numbers_new') AS staging_indexes_bytes,
      pg_size_pretty(
        pg_total_relation_size('corporate_numbers') + pg_total_relation_size('corporate_numbers_new')
      ) AS peak_combined_pretty,
      (pg_total_relation_size('corporate_numbers') + pg_total_relation_size('corporate_numbers_new')) AS peak_combined_bytes;
  `);
  const peakRow = (peakSizeRes.rows[0] ?? {}) as Record<string, string | number>;
  console.log(
    `  ✓ Swap直前 新テーブル (corporate_numbers_new): 合計 ${Number(peakRow.staging_total_bytes ?? 0).toLocaleString()} bytes (表: ${Number(peakRow.staging_table_bytes ?? 0).toLocaleString()} bytes, 索引: ${Number(peakRow.staging_indexes_bytes ?? 0).toLocaleString()} bytes)`,
  );
  console.log(
    `  ✓ Swap直前 ピーク合計 (旧表+新表): ${String(peakRow.peak_combined_pretty ?? '0 bytes')} (${Number(peakRow.peak_combined_bytes ?? 0).toLocaleString()} bytes)`,
  );

  // 5. 単一トランザクション内での RENAME Swap
  console.log(
    '- 単一トランザクション内でテーブル名・索引名・制約名のアトミック入れ替えを実行中...',
  );
  const swapStart = performance.now();
  await ingestDb.transaction(async (tx) => {
    // 1. 旧テーブルを old にリネーム
    await tx.execute(sql`ALTER TABLE corporate_numbers RENAME TO corporate_numbers_old;`);

    // 2. 旧テーブルの制約・索引を old にリネーム（正規名を解放）
    await tx.execute(sql`
      ALTER TABLE corporate_numbers_old
        RENAME CONSTRAINT corporate_numbers_corporate_number_dataset_version_id_pk
        TO corporate_numbers_pk_old;
      ALTER TABLE corporate_numbers_old
        RENAME CONSTRAINT corporate_numbers_dataset_version_id_dataset_versions_id_fk
        TO corporate_numbers_dataset_versions_fk_old;
      ALTER INDEX idx_corporate_numbers_number RENAME TO idx_corporate_numbers_number_old;
      ALTER INDEX idx_corporate_numbers_name RENAME TO idx_corporate_numbers_name_old;
      ALTER INDEX idx_corporate_numbers_name_trgm RENAME TO idx_corporate_numbers_name_trgm_old;
      ALTER INDEX idx_corporate_numbers_prefecture RENAME TO idx_corporate_numbers_prefecture_old;
      ALTER INDEX idx_corporate_numbers_version RENAME TO idx_corporate_numbers_version_old;
    `);

    // 3. 新テーブルを正規名 corporate_numbers にリネーム
    await tx.execute(sql`ALTER TABLE corporate_numbers_new RENAME TO corporate_numbers;`);

    // 4. 新テーブルの制約・索引を正規名にリネーム
    await tx.execute(sql`
      ALTER TABLE corporate_numbers
        RENAME CONSTRAINT corporate_numbers_new_pk
        TO corporate_numbers_corporate_number_dataset_version_id_pk;
      ALTER TABLE corporate_numbers
        RENAME CONSTRAINT corporate_numbers_new_dataset_versions_fk
        TO corporate_numbers_dataset_version_id_dataset_versions_id_fk;
      ALTER INDEX idx_corporate_numbers_number_new RENAME TO idx_corporate_numbers_number;
      ALTER INDEX idx_corporate_numbers_name_new RENAME TO idx_corporate_numbers_name;
      ALTER INDEX idx_corporate_numbers_name_trgm_new RENAME TO idx_corporate_numbers_name_trgm;
      ALTER INDEX idx_corporate_numbers_prefecture_new RENAME TO idx_corporate_numbers_prefecture;
      ALTER INDEX idx_corporate_numbers_version_new RENAME TO idx_corporate_numbers_version;
    `);

    // 5. 旧アクティブ版を superseded に更新
    await tx
      .update(datasetVersions)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(datasetVersions.sourceType, 'nta_corporate_download'),
          eq(datasetVersions.status, 'active'),
        ),
      );

    // 6. 新バージョンを active に昇格
    await tx
      .update(datasetVersions)
      .set({
        status: 'active',
        recordCount: numRecords,
        importedAt: new Date(),
      })
      .where(eq(datasetVersions.id, versionId));
  });
  const swapDurationMs = performance.now() - swapStart;
  console.log(`  ✓ RENAME Swap 所要時間: ${swapDurationMs.toFixed(2)} ms`);

  // 6. 旧テーブルの削除（CASCADE なし）
  console.log('- 旧テーブル corporate_numbers_old を削除中 (DROP TABLE CASCADEなし)...');
  const dropStart = performance.now();
  await ingestDb.execute(sql`DROP TABLE IF EXISTS corporate_numbers_old;`);
  const dropDurationMs = performance.now() - dropStart;
  console.log(`  ✓ 旧テーブル削除所要時間: ${dropDurationMs.toFixed(2)} ms`);

  // 7. 統計情報の収集 (ANALYZE)
  console.log('- 統計情報を収集中 (ANALYZE corporate_numbers)...');
  const analyzeStart = performance.now();
  await ingestDb.execute(sql`ANALYZE corporate_numbers;`);
  const analyzeDuration = (performance.now() - analyzeStart) / 1000;
  console.log(`  ✓ 統計情報収集所要時間: ${analyzeDuration.toFixed(2)} 秒`);

  // 8. 入れ替え完了後の稼働時容量計測 (pg_total_relation_size)
  const postSwapSizeRes = await ingestDb.execute(sql`
    SELECT
      pg_total_relation_size('corporate_numbers') AS total_bytes,
      pg_size_pretty(pg_total_relation_size('corporate_numbers')) AS total_pretty,
      pg_relation_size('corporate_numbers') AS table_bytes,
      pg_size_pretty(pg_relation_size('corporate_numbers')) AS table_pretty,
      pg_indexes_size('corporate_numbers') AS indexes_bytes,
      pg_size_pretty(pg_indexes_size('corporate_numbers')) AS indexes_pretty;
  `);
  const postSwapRow = (postSwapSizeRes.rows[0] ?? {}) as Record<string, string | number>;
  console.log(
    `- 稼働時容量 (corporate_numbers): 合計 ${String(postSwapRow.total_pretty ?? '0 bytes')} (${Number(postSwapRow.total_bytes ?? 0).toLocaleString()} bytes / 表: ${String(postSwapRow.table_pretty ?? '0 bytes')}, 索引: ${String(postSwapRow.indexes_pretty ?? '0 bytes')})`,
  );

  const totalDuration = (performance.now() - totalStartTime) / 1000;
  console.log(`\n🎉 取り込み＆RENAME Swap 全行程完了: 合計 ${totalDuration.toFixed(2)} 秒`);

  return {
    numRecords,
    insertDuration,
    constraintDuration,
    indexDuration,
    swapDurationMs,
    dropDurationMs,
    totalDuration,
    storageBytes: {
      activeTotalBytes: Number(postSwapRow.total_bytes ?? 0),
      activeTableBytes: Number(postSwapRow.table_bytes ?? 0),
      activeIndexesBytes: Number(postSwapRow.indexes_bytes ?? 0),
      peakCombinedBytes: Number(peakRow.peak_combined_bytes ?? 0),
    },
  };
}

async function main() {
  const config = parseArgs();
  const databaseUrl = process.env.DATABASE_URL;

  console.log('====================================================');
  console.log(' 法人番号検索 全件規模ベンチマーク (合成データ使用)');
  console.log('====================================================');

  if (!databaseUrl) {
    console.log('ℹ️  DATABASE_URL が設定されていません。');
    console.log('    ドライランモードとして合成データ定義とクエリ生成の整合性を検証します。');
    console.log('\n[測定対象パターン]');
    for (const q of QUERIES) {
      const pattern = `%${escapeLikeWildcards(q.term)}%`;
      console.log(`- ${q.name}: 入力='${q.term}' -> ILIKE '${pattern}' (LIMIT ${q.limit + 1})`);
      console.log(`  想定挙動: ${q.expectedBehavior}`);
    }
    console.log('\n✅ ドライラン検証完了: 実DB接続時は DATABASE_URL を指定して実行してください。');
    return;
  }

  console.log(`Connecting to database... (URL: ${databaseUrl.replace(/:[^:@]+@/, ':***@')})`);
  const ingestDb = getIngestDb();
  const db = getDb();

  // Step 1: 取り込み＆RENAME Swap（スキップフラグがない場合）
  if (!config.skipImport) {
    await runBenchmarkImportAndSwap(ingestDb, config.numRecords);
  } else {
    console.log(
      '\n⏩ --skip-import が指定されたため、データ取り込み・RENAME Swap をスキップします。',
    );
  }

  // 最新 active バージョンの確認
  const activeVersions = await db
    .select({ id: datasetVersions.id, dataAsOf: datasetVersions.dataAsOf })
    .from(datasetVersions)
    .where(sql`status = 'active'`)
    .limit(1);

  const active = activeVersions[0];
  if (!active) {
    console.warn('⚠️  active なデータセットバージョンが見つかりませんでした。');
  } else {
    console.log(`\nActive Dataset Version: ID=${active.id}, data_as_of=${active.dataAsOf}`);
  }

  // テーブル内件数の確認
  const countResult = await db.execute(sql`SELECT count(*) as cnt FROM corporate_numbers;`);
  const currentCount = (countResult.rows[0] as { cnt: string | number })?.cnt ?? '0';
  console.log(`Current corporate_numbers count: ${Number(currentCount).toLocaleString()} 件`);

  // テーブル容量の確認 (pg_total_relation_size)
  const sizeResult = await db.execute(sql`
    SELECT
      pg_total_relation_size('corporate_numbers') AS total_bytes,
      pg_size_pretty(pg_total_relation_size('corporate_numbers')) AS total_pretty,
      pg_relation_size('corporate_numbers') AS table_bytes,
      pg_size_pretty(pg_relation_size('corporate_numbers')) AS table_pretty,
      pg_indexes_size('corporate_numbers') AS indexes_bytes,
      pg_size_pretty(pg_indexes_size('corporate_numbers')) AS indexes_pretty;
  `);
  const sizeRow = (sizeResult.rows[0] ?? {}) as Record<string, string | number>;
  console.log(
    `Current corporate_numbers size: ${String(sizeRow.total_pretty ?? '0 bytes')} (${Number(sizeRow.total_bytes ?? 0).toLocaleString()} bytes / table: ${String(sizeRow.table_pretty ?? '0 bytes')}, indexes: ${String(sizeRow.indexes_pretty ?? '0 bytes')})`,
  );

  // Step 2: 検索クエリの EXPLAIN (ANALYZE, BUFFERS) 測定
  console.log('\n====================================================');
  console.log(' [Step 2] EXPLAIN (ANALYZE, BUFFERS) 測定開始 (各 5 回)');
  console.log('====================================================');

  for (const q of QUERIES) {
    console.log(`\n----------------------------------------------------`);
    console.log(`### ${q.name}`);
    console.log(`    検索語: "${q.term}"`);
    console.log(`    想定挙動: ${q.expectedBehavior}`);
    console.log(`----------------------------------------------------`);

    const latencies: number[] = [];

    for (let i = 1; i <= config.iterations; i++) {
      const start = performance.now();
      try {
        const planResult = await runExplainAnalyze(db, q.term, q.limit);
        const elapsed = performance.now() - start;
        latencies.push(elapsed);

        if (i === 1) {
          console.log(`\n  [実行計画 (EXPLAIN ANALYZE BUFFERS)]:`);
          for (const row of planResult.rows) {
            const planLine = (row as { 'QUERY PLAN': string })['QUERY PLAN'];
            console.log(`    ${planLine}`);
          }
          console.log('');
        }
        console.log(`  Trial ${i}: ${elapsed.toFixed(2)} ms`);
      } catch (err) {
        console.error(`  Trial ${i} failed:`, err instanceof Error ? err.message : err);
      }
    }

    if (latencies.length > 0) {
      const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const min = Math.min(...latencies);
      const max = Math.max(...latencies);
      console.log(`\n  ▶ 測定結果 (${latencies.length} 回):`);
      console.log(`    平均所要時間: ${mean.toFixed(2)} ms`);
      console.log(`    最小所要時間: ${min.toFixed(2)} ms`);
      console.log(`    最大所要時間: ${max.toFixed(2)} ms`);
    }
  }

  console.log('\n====================================================');
  console.log('✅ 全測定完了');
  console.log('====================================================');

  await closeDbClient();
}

main().catch((err) => {
  console.error('Benchmark execution error:', err);
  process.exit(1);
});
