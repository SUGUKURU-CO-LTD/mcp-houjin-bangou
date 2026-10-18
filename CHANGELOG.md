# Changelog

All notable changes to this project will be documented in this file.
本プロジェクトの変更履歴。`Keep a Changelog` 形式、`Semantic Versioning` 準拠。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **ChatGPT Apps ドメイン確認エンドポイント (`GET /.well-known/openai-apps-challenge`)**:
  - 環境変数 `OPENAI_APPS_CHALLENGE_TOKEN` の値をそのまま `text/plain` で返却（未設定時は `404`）。
  - クローラーからの検証リクエストを確実に受けるため、`/mcp` の Origin 検証対象外として実装。
  - Terraform (`infra/terraform/variables.tf`, `infra/terraform/main.tf`) に `openai_apps_challenge_token` 変数および Cloud Run サービス環境変数を追加。`.env.example` にコメント例を追加。

### Changed

- **ツールアノテーションを仕様 v1.8 に更新（ChatGPT ディレクトリ掲載基準への適合 / Linear SLA2-329）**:
  - 公開された公的データを扱う照会ツール 3 種（`lookup_corporate_by_number`, `search_corporate_by_name`, `lookup_invoice_issuer`）の `openWorldHint` を、データ取得方式（ホスト版 DB / ローカル版 Web-API）にかかわらず一律 `true` に統一。純粋計算ツール 2 種（`validate_corporate_number`, `normalize_company_name`）は `false` を維持。
  - `lookup_invoice_issuer` の `title` を `Look up Registered Invoice Issuer by T-number` に統一。
  - インターフェース仕様書 `docs/plan/corp-check-interface-v1.md` を v1.8（凍結）に改訂し、README（日英）のツール表を更新。

## [1.0.0] - 2026-10-18

### Added

- **Qualified Invoice Issuer lookup tool (`lookup_invoice_issuer`)**:
  - Looks up invoice registration numbers (`T` + 13 digits) with optional `reference_date` (`YYYY-MM-DD`) factual period check (`valid_on_reference_date: boolean | null`) and multi-period history (`registration_periods`).
  - Handles re-registrations (multiple periods for the same `T` number) and protects sole proprietors by never storing or returning personal names, trade names, or addresses.
- **PostgreSQL 16 (`pg_trgm`) backend & monthly bulk CSV ingestion for Hosted Edition**:
  - Ingestion CLI (`src/ingest/cli.ts`, `src/ingest/corporate.ts`, `src/ingest/invoice.ts`, `src/ingest/runner.ts`) supporting streaming CSV ingestion from directory (`--dir`), atomic staging table swap, row-count threshold guards (`INGEST_MIN_RECORD_COUNT`), and process code `99` (deletion) handling.
  - Provider architecture: `DbCorporateDataProvider` and `DbInvoiceDataProvider` for PostgreSQL backend (`DATA_SOURCE=db`), and `createNtaClient` for NTA Web-API backend (`DATA_SOURCE=web-api`).
- **Infrastructure as Code & Cloud Operations**:
  - Terraform configuration for Hosted Edition (`terraform/`): Cloud Run services (`houjin-bangou-mcp`), Cloud Run Jobs (`houjin-bangou-ingest-corporate`, `houjin-bangou-ingest-invoice`), Cloud SQL for PostgreSQL 16 (`pg_trgm`), Cloud Load Balancing, Cloud Armor rate limiting, and Cloud Monitoring alert policies.
  - Deployment runbook (`docs/deployment/hosted-edition-runbook.md`).
- **HTTP Transport Security & Database Privilege Separation**:
  - `Origin` header allowlist middleware (`ALLOWED_ORIGINS`) with DNS rebinding protection and no-Origin allowance for non-browser CLI/Server-to-Server clients.
  - Per-IP in-memory rate limiting (`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, default 60 requests / 60 seconds) for `/mcp`, `/health`, and `/.well-known/mcp.json` with `TRUST_PROXY` support for Cloud Run.
  - 3-role PostgreSQL privilege separation (`houjin_admin`, `houjin_ingest`, `houjin_reader`) documented in `docs/deployment/db-roles.sql` and `docs/deployment/db-roles.md`.
- **MCP Apps UI (`@modelcontextprotocol/ext-apps` v1.7) & Snapshot Tests**:
  - Interactive UI views (`ui://corporate-card/mcp-app.html` and `ui://search-results/mcp-app.html`) supporting `lookup_corporate_by_number`, `lookup_invoice_issuer`, and `search_corporate_by_name`.
  - Contract snapshot tests locking `tools/list`, `prompts/list`, and all 5 tools' `structuredContent` outputs (`tests/integration/mcp-contract-snapshot.test.ts`), plus headless fallback tests (`tests/integration/mcp-apps-headless-fallback.test.ts`).
- **MCP Registry Metadata (`server.json`)**:
  - Root `server.json` configured for official MCP Registry submission with `streamable-http` transport and remote endpoint (`https://houjin.mcp.sugu-kuru.co.jp/mcp`).

### Changed (Breaking Changes from v0.2.0)

- **Tool set updated to frozen specification v1.7**:
  - Removed `get_attribution` tool (attribution is embedded in every data tool's `structuredContent.attribution` and text footer).
  - `lookup_corporate_by_number` now accepts a single 13-digit `corporate_number` (instead of up to 10 comma-separated numbers) and an optional `include_invoice_status` boolean (default `true`). Removed internal metadata fields (`update_date`, `change_date`, `process`, `correct`, `kind`) from `record` output.
  - `search_corporate_by_name` input/output schema updated (`query`, `prefecture_code`, `city_name`, `include_closed`, `limit`, `cursor`; outputs `total_count`, `returned_count`, `next_cursor`, `normalized_queries_tried`, `data_as_of`, `results`, `attribution`). 2-character queries use prefix match.
  - `validate_corporate_number` output field renamed from `normalized` to `normalized_number` and `check_digit` typed as `number | null`.
  - `normalize_company_name` output schema simplified to `{ raw_input, extracted_core_name, candidates: [{ name, kind_hint, prefix_or_suffix, confidence, applied_rules }] }`.
  - Tool annotations aligned with v1.7: `readOnlyHint: true` and `destructiveHint: false` across all tools; `openWorldHint` is `false` in Hosted Edition (internal database), and `true` for outbound Web-API tools in Local Edition (`false` for pure local functions).
- **Prompts & Resources**:
  - Renamed prompt `business-card-to-database` to `company-master-record` and removed personal contact arguments to avoid accepting PII.
  - Removed `attribution://houjin-bangou` static resource, `corp://{corporate_number}` resource template, and MCP `logging` capability to keep the surface area minimal and read-only.
- **Policy & Documentation**:
  - Updated `docs/policy/privacy-policy.md` and `docs/policy/terms-of-service.md` to reflect the hosted database architecture, monthly update cycle, sole proprietor data handling, unified office address (`〒899-4332 鹿児島県霧島市国分中央１丁目２−３２ 3F`), and unified contact address (`info@sugu-kuru.co.jp`).

## [0.2.0] - 2026-05-10

### Added (v0.1.1 quality hardening)

- `fast-check` property-based tests
  - `tests/unit/check-digit.property.test.ts`: 5 properties, 4000 generated cases
  - `tests/unit/invoice-number.property.test.ts`: 4 properties, 2500 generated cases
  - `tests/unit/normalizer.property.test.ts`: 5 properties, 5000 generated cases
- `tinybench` benchmark suite (`pnpm bench`)
  - check digit validation
  - invoice number normalization
  - company name normalization
  - NTA CSV parser
- v0.2.0 UI Resources preparation
  - `src/ui/corporate-card/`
  - `src/ui/search-results/`
  - Vite single-file build (`pnpm build:ui`)
  - CSP hash injection (`pnpm build:csp`)
  - `ui://corporate-card/mcp-app.html` and `ui://search-results/mcp-app.html` registered as resources
  - `lookup_corporate_by_number` and `search_corporate_by_name` expose `_meta.ui.resourceUri`
- Release readiness audit fixes
  - Server Card and runtime `initialize` capability alignment (`listChanged=true`)
  - npm Trusted Publishing / GitHub OIDC (removed `NPM_TOKEN` dependency)
  - CycloneDX SBOM workflow

### Verified

- 2026-05-10: NTA live smoke passed with approved application ID
  - local validation: `7000012050002` OK
  - `/4/num`: count=1, first=`7000012050002 国税庁`
  - `/4/name`: count=2, divide=1/1
  - result: `NTA live smoke: OK`

### Added (v0.3.0 準備層)

- `src/domain/invoice-number.ts`: T番号 (T+13桁) Branded type + 正規化検証 (全角/半角/ハイフン/小文字T 対応)
- `src/domain/invoice-codes.ts`: 事業者処理区分 (01/02/03/04/99) + 人格区分 (1/2) + 国内外区分 (1/2/3) + 応答形式 (01/11/21) の辞書
- `tests/unit/invoice-number.test.ts`: 18 ケース
- `docs/adr/0012-invoice-api-integration.md`: 適格請求書発行事業者 Web-API 統合計画 (Ver.1.0 仕様差異マトリクス含む)

## [0.1.0] - 2026-05-22

### Added

- **MCP 公式 7 機能すべて活性化** (Tools / Prompts / Resources / Resource Templates / Completion / Logging / Pagination)
- 5 MCP Tools
  - `lookup_corporate_by_number` (T1): 13桁の法人番号で検索 (国税庁 `/4/num` API、最大10件)
  - `search_corporate_by_name` (T2): 法人名で検索 (国税庁 `/4/name` API、ページング対応)
  - `validate_corporate_number` (T3): チェックデジット検証 (ローカル計算、API 不要)
  - `get_attribution` (T6): 政府標準出典文（公共データ利用規約 第1.0版 + Web-API 機能利用規約 別添1 第6条）
  - `normalize_company_name` (T7): 国税庁 `target=1` 未対応の7パターン表記揺れ補完
- 3 MCP Prompts (v0.2.0 予定から前倒し、ADR-0011)
  - `business-card-to-database`: 名刺OCR → 正規化 → NTA照会 → CRM レコード
  - `sales-list-enrichment`: 営業リスト一括 enrichment
  - `customer-master-dedup`: 顧客マスタ重複検知・名寄せ
- MCP Resources + Resource Templates (`corp://{corporate_number}`, `attribution://houjin-bangou`)
- MCP Completion (`completion/complete` で会社名の auto-complete、T7 駆動 + Prompt 引数の enum 補完)
- MCP Logging (`notifications/message`、RFC 5424 severity、機密情報自動 redact)
- MCP Pagination (opaque cursor、国税庁 `divide`/`divideSize` との変換)
- Server Card at `/.well-known/mcp.json` (SEP-2127 Draft 先行実装)
- Streamable HTTP transport (stateless mode)
- Zod strict schema + `attribution` 必須化 + "When NOT to use" description
- プロンプトインジェクション防御層 (Rug Pull / Tool Shadowing / Tool Poisoning、6 層)
- OpenTelemetry W3C TraceContext 対応 (SEP-414 準備層)
- Application ID redaction + rate limiter (1 RPS + exponential backoff 30s→1m→5m→30m)
- GitHub Actions: ci / release / codeql / dependency-review / api-health-check (週次 keepalive)
- 旧字体→新字体 辞書 45+ パターン (髙/齋/﨑/邉/澤/國/團/寳/應/靑/權/氣/專/單/學/樂/...)
- 3 Prompts 用の動作テストと Completion 補完テスト

### Attribution / 出典

- 国税庁 法人番号 Web-API 機能 Ver.4.0 (政府標準利用規約 = 公共データ利用規約 第1.0版)
- 国税庁法人番号公表サイト (https://www.houjin-bangou.nta.go.jp/)
