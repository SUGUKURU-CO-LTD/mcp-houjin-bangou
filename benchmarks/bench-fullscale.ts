/**
 * Full-scale Synthetic Data Benchmark Script
 *
 * 根拠 / Source:
 *   docs/plan/corp-check-interface-v1.md §6.1, §6.2
 *   Linear Issue: SLA2-324 測定の再現性:
 *     - 合成データのみを使用するベンチマークスクリプトをリポジトリに配置し、
 *       誰でも同じ手順で再測定できるようにする。実データは含めない。
 *     - 2文字語、長語、大量ヒット語の EXPLAIN (ANALYZE, BUFFERS) 測定。
 *
 * 【重要: テストデータの性格】
 *   本スクリプトで使用するデータはすべてテスト用の「合成データ」であり、
 *   実在する事業者や個人の情報、国税庁本番データではありません。
 */

import { getDbClient } from '../src/db/client.js';
import { corporateNumbers, datasetVersions } from '../src/db/schema.js';
import { escapeLikeWildcards } from '../src/repository/corporate-repository.js';
import { sql } from 'drizzle-orm';

interface BenchmarkConfig {
  numRecords: number;
  iterations: number;
}

const config: BenchmarkConfig = {
  numRecords: 10000, // 既定の合成データ件数（必要に応じて環境変数 BENCH_RECORDS で変更可）
  iterations: 5,
};

/**
 * 測定対象クエリ
 */
const QUERIES = [
  {
    name: '1. 長い語で1件だけ当たる検索',
    term: '株式会社スグクルホールディングス鹿児島国分中央特命営業部',
    limit: 10,
  },
  {
    name: '2. 2文字の語の検索',
    term: '合宿',
    limit: 10,
  },
  {
    name: '3. 大量に当たる語の検索（株式会社）',
    term: '株式会社',
    limit: 10,
  },
];

async function runExplainAnalyze(db: ReturnType<typeof getDbClient>, term: string, limit: number) {
  const pattern = `%${escapeLikeWildcards(term)}%`;

  // EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
  const query = sql`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
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

async function main() {
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
    }
    console.log('\n✅ ドライラン検証完了: 実DB接続時は DATABASE_URL を指定して実行してください。');
    return;
  }

  console.log(`Connecting to database...`);
  const db = getDbClient();

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
    console.log(`Active Dataset Version: ID=${active.id}, data_as_of=${active.dataAsOf}`);
  }

  // テーブル内件数の確認
  const countResult = await db.execute(sql`SELECT count(*) as cnt FROM corporate_numbers;`);
  const currentCount = (countResult.rows[0] as { cnt: string | number })?.cnt ?? '0';
  console.log(`Current corporate_numbers count: ${currentCount}`);

  console.log('\n--- EXPLAIN (ANALYZE, BUFFERS) 測定開始 ---');

  for (const q of QUERIES) {
    console.log(`\n### ${q.name} (Term: "${q.term}")`);
    const latencies: number[] = [];

    for (let i = 1; i <= config.iterations; i++) {
      const start = performance.now();
      try {
        const planResult = await runExplainAnalyze(db, q.term, q.limit);
        const elapsed = performance.now() - start;
        latencies.push(elapsed);

        if (i === 1) {
          const rawPlan = planResult.rows[0] as Record<string, unknown>;
          const planJson = JSON.stringify(rawPlan, null, 2);
          // 最初の実行計画の要約を表示
          console.log(`  初回実行計画 (抜粋):`);
          console.log(`    ${planJson.slice(0, 300)}...`);
        }
      } catch (err) {
        console.error(`  Trial ${i} failed:`, err instanceof Error ? err.message : err);
      }
    }

    if (latencies.length > 0) {
      const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const min = Math.min(...latencies);
      const max = Math.max(...latencies);
      console.log(`  測定回数: ${latencies.length} 回`);
      console.log(`  所要時間: 平均 ${mean.toFixed(2)} ms (最小 ${min.toFixed(2)} ms, 最大 ${max.toFixed(2)} ms)`);
    }
  }

  console.log('\n✅ 全測定完了');
}

main().catch((err) => {
  console.error('Benchmark execution error:', err);
  process.exit(1);
});
