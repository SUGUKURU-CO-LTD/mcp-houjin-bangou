# PostgreSQL ロール分離手順書（3ロール最小権限構成）

本ドキュメントは、`docs/plan/corp-check-interface-v1.md` §1.3 制約6（DB権限の最小化）および Linear `SLA2-327`（PR A）に基づき、PostgreSQL 16 のロールを以下の **3ロール** に分離し、MCP ツール（HTTP サーバー / stdio サーバー）からは書き込みやテーブル変更が一切できないようにする手順を定めます。

SQL 定義ファイルは [`docs/deployment/db-roles.sql`](./db-roles.sql) に配置されています。

---

## 1. 3ロールの責務と権限一覧

| ロール名 | 用途（接続元） | スキーマ権限 (`public`) | `dataset_versions` | `corporate_numbers` / `invoice_issuers` | 拡張・マイグレーション |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`houjin_admin`** | 管理・マイグレーション実行（CI / 管理者手動） | `USAGE`, `CREATE` | `OWNER`（全権限） | `houjin_ingest` ロール継承により変更可 | `pg_trgm` 拡張作成、`drizzle` マイグレーション適用 |
| **`houjin_ingest`** | データ取り込みバッチ（`src/ingest/cli.ts` / Cloud Run Jobs） | `USAGE`, `CREATE` | `SELECT`, `INSERT`, `UPDATE`, `REFERENCES` + シーケンス `USAGE, SELECT` | `OWNER`（`_new` 作成、索引・FK 付与、`RENAME` 入れ替え、`_old` `DROP`、`ANALYZE`） | 不可（`dataset_versions` の `DROP` や `DELETE` も不可） |
| **`houjin_reader`** | MCP サーバー本体（`src/server.ts` / Cloud Run Service） | `USAGE` のみ（`CREATE` 不可） | `SELECT` のみ | `SELECT` のみ（スワップ後も自動維持） | 不可（`INSERT` / `UPDATE` / `DELETE` / DDL すべて不可） |

---

## 2. RENAME 入れ替え（Swap）方式における権限維持の仕組み

本システムの CSV 取り込み（`src/ingest/importer.ts` および `src/ingest/invoice-importer.ts`）は、検索無停止での全件更新を実現するため以下の手順を実行します。

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

データベース管理者（または Cloud SQL の `cloudsqlsuperuser`）で接続し、`db-roles.sql` の Phase 1・Phase 2 を実行します。本番環境でパスワード認証または Cloud SQL IAM 認証を使う場合は、ログイン用のユーザーを作成して各ロールを `GRANT` するか、各ロールに `LOGIN PASSWORD '...'` を付与します。

```sql
-- 例: 接続用ユーザーを作成して各ロールを付与する場合
CREATE USER app_admin WITH PASSWORD '...' IN ROLE houjin_admin;
CREATE USER app_ingest WITH PASSWORD '...' IN ROLE houjin_ingest;
CREATE USER app_reader WITH PASSWORD '...' IN ROLE houjin_reader;

-- セッション接続時にロール権限でオブジェクトを作成させるため、預設ロールを設定
ALTER USER app_admin SET role = 'houjin_admin';
ALTER USER app_ingest SET role = 'houjin_ingest';
ALTER USER app_reader SET role = 'houjin_reader';
```

### Step 2: マイグレーションの実行（`houjin_admin`）

`houjin_admin` ロールで Drizzle マイグレーション（`0000` 〜 `0003`）を実行し、初期テーブル（`dataset_versions`, `corporate_numbers`, `invoice_issuers`）を作成します。

### Step 3: テーブル別権限とデフォルト権限の適用（Phase 3）

マイグレーション完了後、`db-roles.sql` の Phase 3 を実行して以下を完了させます。

```bash
psql "$ADMIN_DATABASE_URL" -f docs/deployment/db-roles.sql
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
