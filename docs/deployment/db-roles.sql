-- =============================================================================
-- @sugukuru/mcp-houjin-bangou
-- PostgreSQL 16 ロール分離定義 (3ロール最小権限構成)
--
-- 根拠:
--   - docs/plan/corp-check-interface-v1.md §1.3 制約6 (DB権限の最小化)
--   - PR 78 申し送り事項 / Linear SLA2-327 (PR A)
--
-- ロール構成:
--   1. houjin_admin  : 管理用ロール（pg_trgm 拡張の作成、マイグレーション実行、権限付与）
--   2. houjin_ingest : 取り込み用ロール（dataset_versions 更新、_new テーブル作成と RENAME 入れ替え）
--   3. houjin_reader : 読み取り専用ロール（MCP ツールからの SELECT のみ。書き込み・DDL 不可）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Phase 1: ロールの作成（スーパーユーザーまたは cloudsqlsuperuser で実行）
-- ※ 本番環境では LOGIN パスワードまたは IAM データベース認証を設定してください。
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'houjin_admin') THEN
    CREATE ROLE houjin_admin NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'houjin_ingest') THEN
    CREATE ROLE houjin_ingest NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'houjin_reader') THEN
    CREATE ROLE houjin_reader NOLOGIN;
  END IF;
END
$$;

-- 管理用ロールは取り込み用ロールが所有するスワップ対象テーブルに対してもマイグレーションできるよう継承する
GRANT houjin_ingest TO houjin_admin;

-- -----------------------------------------------------------------------------
-- Phase 2: 拡張の作成とスキーマ基本権限の制限（管理用ロールまたはスーパーユーザーで実行）
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  EXECUTE format('GRANT CREATE ON DATABASE %I TO houjin_admin', current_database());
END
$$;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- PUBLIC ロールからのデフォルト CREATE 権限を剥奪（PostgreSQL 15+ 既定だが明示）
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

-- 各ロールへのスキーマ権限付与
GRANT USAGE, CREATE ON SCHEMA public TO houjin_admin;
GRANT USAGE, CREATE ON SCHEMA public TO houjin_ingest;
GRANT USAGE ON SCHEMA public TO houjin_reader;

-- -----------------------------------------------------------------------------
-- Phase 3: マイグレーション適用後のテーブル別権限設定
-- ※ drizzle-kit migrate（0000〜0003）実行後に適用する
-- -----------------------------------------------------------------------------

-- 1. dataset_versions は管理用ロール所有のまま、取り込み用ロールに SELECT/INSERT/UPDATE/REFERENCES を付与
ALTER TABLE public.dataset_versions OWNER TO houjin_admin;
REVOKE ALL ON TABLE public.dataset_versions FROM houjin_ingest, houjin_reader;
GRANT SELECT, INSERT, UPDATE, REFERENCES ON TABLE public.dataset_versions TO houjin_ingest;
GRANT USAGE, SELECT ON SEQUENCE public.dataset_versions_id_seq TO houjin_ingest;

-- 2. corporate_numbers / invoice_issuers は RENAME 入れ替え（ALTER TABLE ... RENAME / DROP _old / ANALYZE）を
--    取り込み用ロールが実行するため、所有権を houjin_ingest に移譲する
ALTER TABLE public.corporate_numbers OWNER TO houjin_ingest;
ALTER TABLE public.invoice_issuers OWNER TO houjin_ingest;

-- 3. 読み取り専用ロール（houjin_reader）には全3テーブルの SELECT のみを付与
GRANT SELECT ON TABLE
  public.dataset_versions,
  public.corporate_numbers,
  public.invoice_issuers
TO houjin_reader;

-- 4. 重要: 取り込み用ロール（houjin_ingest）が RENAME 入れ替え時に CREATE TABLE *_new で
--    新規作成したテーブルに対しても、自動的に houjin_reader の SELECT 権限が付与されるよう
--    デフォルト権限（ALTER DEFAULT PRIVILEGES）を設定する
ALTER DEFAULT PRIVILEGES FOR ROLE houjin_admin IN SCHEMA public
  GRANT SELECT ON TABLES TO houjin_reader;

ALTER DEFAULT PRIVILEGES FOR ROLE houjin_ingest IN SCHEMA public
  GRANT SELECT ON TABLES TO houjin_reader;
