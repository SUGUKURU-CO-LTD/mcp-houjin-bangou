# PostgreSQL ロール分離手順書（3ロール最小権限構成）

本ドキュメントは、`docs/plan/corp-check-interface-v1.md` §1.3 制約6（DB権限の最小化）および Linear `SLA2-327`（PR A / PR B）に基づき、PostgreSQL 16 のロールを以下の **3ロール** に分離し、MCP ツール（HTTP サーバー）からは書き込みやテーブル変更が一切できないようにする手順を定めます。

SQL 定義ファイルは [`docs/deployment/db-roles.sql`](./db-roles.sql) に配置されています。

---

## 1. 3ロールの責務と権限一覧

| ロール名 | 用途（接続元） | スキーマ権限 (`public`) | `dataset_versions` | `corporate_numbers` / `invoice_issuers` | 拡張・マイグレーション |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`houjin_admin`** | 管理・マイグレーション実行（`src/db/migrate.ts` / Cloud Run Job） | `USAGE`, `CREATE` | `OWNER`（全権限） | `houjin_ingest` ロール継承により変更可 | `pg_trgm` 拡張作成、`drizzle` マイグレーション適用 |
| **`houjin_ingest`** | データ取り込みバッチ（`src/ingest/cli.ts` / Cloud Run Job） | `USAGE`, `CREATE` | `SELECT`, `INSERT`, `UPDATE`, `REFERENCES` + シーケンス `USAGE, SELECT` | `OWNER`（`_new` 作成、索引・FK 付与、`RENAME` 入れ替え、`_old` `DROP`、`ANALYZE`） | 不可（`dataset_versions` の `DROP` や `DELETE` も不可） |
| **`houjin_reader`** | MCP サーバー本体（`src/server.ts` / Cloud Run Service） | `USAGE` のみ（`CREATE` 不可） | `SELECT` のみ | `SELECT` のみ（スワップ後も自動維持） | 不可（`INSERT` / `UPDATE` / `DELETE` / DDL すべて不可） |

---

## 2. RENAME 入れ替え（Swap）方式における権限維持の仕組み

本システムの CSV 取り込み（`src/ingest/importer.ts`、CLI エントリポイントは `src/ingest/cli.ts`）は、法人番号データ・適格請求書発行事業者（インボイス）データの双方において、検索無停止での全件更新を実現するため以下の手順を実行します。

1. `CREATE TABLE corporate_numbers_new (LIKE corporate_numbers INCLUDING DEFAULTS);`（`invoice_issuers_new` も同様）
2. 行単位ストリーミングによるバッチ `INSERT`
3. 主キー・インデックス（`pg_trgm` GIN インデックス含む）・`dataset_versions(id)` への外部キー制約の追加
4. トランザクション内での `ALTER TABLE corporate_numbers RENAME TO corporate_numbers_old;` → `ALTER TABLE corporate_numbers_new RENAME TO corporate_numbers;` → `DROP TABLE corporate_numbers_old;`

この方式では、毎回 `houjin_ingest` ロールが新しいテーブル（`*_new`）を作成して本番テーブル名に `RENAME` するため、以下の2点が不可欠です。

1. **`corporate_numbers` / `invoice_issuers` の所有権（`OWNER`）を `houjin_ingest` にすること**：
   PostgreSQL では `ALTER TABLE ... RENAME`、`DROP TABLE`、`ANALYZE` の実行にテーブル所有権が必要です。
2. **`ALTER DEFAULT PRIVILEGES FOR ROLE houjin_ingest` を設定すること**：
   `houjin_ingest` が新規作成した `*_new` テーブルが `corporate_numbers` / `invoice_issuers` にリネームされた直後も、MCP サーバー（`houjin_reader`）が途切れなく `SELECT` できるよう、以下のデフォルト権限を設定します。
   ```sql
   ALTER DEFAULT PRIVILEGES FOR ROLE houjin_ingest IN SCHEMA public
     GRANT SELECT ON TABLES TO houjin_reader;
   ```

---

## 3. 適用手順

### Step 1: ロールと `pg_trgm` 拡張の作成（Phase 1 & 2）

データベース管理者（`postgres`）で接続し、`db-roles.sql` の Phase 1・Phase 2 を実行します。各ロール（`houjin_admin`, `houjin_ingest`, `houjin_reader`）に直接 `LOGIN PASSWORD` を付与し、ローカルの `cloud-sql-proxy` 経由でパスワードを画面に出力せずに設定・Secret Manager へ登録します。

psql コマンドのパス（`PSQL`）は、Apple Silicon の Mac では `/opt/homebrew/opt/libpq/bin/psql`、Intel の Mac では `/usr/local/opt/libpq/bin/psql` を指定してください。

```bash
brew install cloud-sql-proxy libpq
PSQL=/opt/homebrew/opt/libpq/bin/psql
PG_PW="$(openssl rand -hex 24)"
ADMIN_PW="$(openssl rand -hex 24)"
INGEST_PW="$(openssl rand -hex 24)"
READER_PW="$(openssl rand -hex 24)"
gcloud sql users set-password postgres --instance=houjin-bangou-pg16 --password="$PG_PW"
cloud-sql-proxy --port 5433 <PROJECT_ID>:asia-northeast1:houjin-bangou-pg16 &
sleep 5
awk '/Phase 3/{exit} {print}' docs/deployment/db-roles.sql > /tmp/db-roles-phase12.sql
PGPASSWORD="$PG_PW" $PSQL "host=127.0.0.1 port=5433 user=postgres dbname=corp_check" -v ON_ERROR_STOP=1 -f /tmp/db-roles-phase12.sql
PGPASSWORD="$PG_PW" $PSQL "host=127.0.0.1 port=5433 user=postgres dbname=corp_check" -v ON_ERROR_STOP=1 -v admin_pw="$ADMIN_PW" -v ingest_pw="$INGEST_PW" -v reader_pw="$READER_PW" <<'SQL'
ALTER ROLE houjin_admin WITH LOGIN PASSWORD :'admin_pw';
ALTER ROLE houjin_ingest WITH LOGIN PASSWORD :'ingest_pw';
ALTER ROLE houjin_reader WITH LOGIN PASSWORD :'reader_pw';
SQL
SUFFIX="localhost/corp_check?host=/cloudsql/<PROJECT_ID>:asia-northeast1:houjin-bangou-pg16"
printf '%s' "postgresql://houjin_admin:${ADMIN_PW}@${SUFFIX}" | gcloud secrets versions add houjin-db-url-admin --data-file=-
printf '%s' "postgresql://houjin_ingest:${INGEST_PW}@${SUFFIX}" | gcloud secrets versions add houjin-db-url-ingest --data-file=-
printf '%s' "postgresql://houjin_reader:${READER_PW}@${SUFFIX}" | gcloud secrets versions add houjin-db-url-reader --data-file=-
kill %1
unset PG_PW ADMIN_PW INGEST_PW READER_PW
```

### Step 2: マイグレーションの実行（`houjin_admin`）

`houjin_admin` ロールで Drizzle マイグレーション（`0000` 〜 `0004`）を実行し、初期テーブル（`dataset_versions`, `corporate_numbers`, `invoice_issuers`）を作成します。

```bash
DATABASE_URL="$ADMIN_DATABASE_URL" node dist/db/migrate.js
```

### Step 3: テーブル別権限とデフォルト権限の適用（Phase 3）

マイグレーション完了後、`docs/deployment/db-roles.sql` の Phase 3 をテーブルの所有者 `houjin_admin` で流し、`corporate_numbers` / `invoice_issuers` の所有権を `houjin_ingest` に移譲し、`houjin_reader` に `SELECT` 権限および `ALTER DEFAULT PRIVILEGES` を設定します。

psql コマンドのパス（`PSQL`）は、Apple Silicon の Mac では `/opt/homebrew/opt/libpq/bin/psql`、Intel の Mac では `/usr/local/opt/libpq/bin/psql` を指定してください。

```bash
PSQL=/opt/homebrew/opt/libpq/bin/psql
ADMIN_PW="$(gcloud secrets versions access latest --secret=houjin-db-url-admin | sed -E 's|^postgresql://[^:]+:([^@]+)@.*|\1|')"
READER_PW="$(gcloud secrets versions access latest --secret=houjin-db-url-reader | sed -E 's|^postgresql://[^:]+:([^@]+)@.*|\1|')"
awk '/Phase 3/{f=1} f' docs/deployment/db-roles.sql > /tmp/db-roles-phase3.sql
cloud-sql-proxy --port 5433 <PROJECT_ID>:asia-northeast1:houjin-bangou-pg16 &
sleep 5
PGPASSWORD="$ADMIN_PW" $PSQL "host=127.0.0.1 port=5433 user=houjin_admin dbname=corp_check" -v ON_ERROR_STOP=1 -f /tmp/db-roles-phase3.sql
PGPASSWORD="$READER_PW" $PSQL "host=127.0.0.1 port=5433 user=houjin_reader dbname=corp_check" -c "SELECT count(*) FROM corporate_numbers;"
kill %1
unset ADMIN_PW READER_PW
```

---

## 4. 環境変数の設定（アプリケーション側）

- **MCP サーバー本体（`src/server.ts`）**:
  - `DATABASE_URL` には必ず **`houjin_reader`** ロールの接続文字列を設定します。
- **データ取り込みバッチ（`src/ingest/cli.ts`）**:
  - `DATABASE_URL` には **`houjin_ingest`** ロールの接続文字列を設定します。

---

## 5. 動作確認コマンド

設定後、`houjin_reader` ロールで以下を確認します。

```sql
SET ROLE houjin_reader;

-- 1. 読み取りは成功すること
SELECT count(*) FROM corporate_numbers;
SELECT count(*) FROM invoice_issuers;
SELECT count(*) FROM dataset_versions;

-- 2. 書き込み・DDL はすべて permission denied (SQLSTATE 42501) で拒否されること
DELETE FROM corporate_numbers;
INSERT INTO dataset_versions (source_type, data_as_of, status, record_count)
  VALUES ('nta_corporate_download', '2026-10-15', 'staging', 1);
DROP TABLE corporate_numbers;
```
