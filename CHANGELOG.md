# Changelog

All notable changes to this project will be documented in this file.
本プロジェクトの変更履歴。`Keep a Changelog` 形式、`Semantic Versioning` 準拠。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **承継先法人番号（`successor_corporate_number`）の出力と UI ドリルダウン**:
  - 吸収合併等で閉鎖された法人を `lookup_corporate_by_number` で照会した際、公表データに承継先法人番号がある場合は `corporation.successor_corporate_number` および要約テキストで返却し、MCP Apps UI からワンクリックで承継先法人カードへ遷移可能に改善。
- **インボイス照会ツールの MCP Apps UI 連携と相互ナビゲーション**:
  - `lookup_invoice_issuer` に `_meta.ui.resourceUri = "ui://corporate-card/mcp-app.html"` を接続し、インボイス登録確認カード表示、基準日（`reference_date`）ピッカーでの再確認、法人カードからのワンクリック・インボイス照合、および検索結果テーブルのカーソルページ送り・状態フィルタ・履歴「戻る」ナビゲーション・`updateModelContext` 同期を追加。
- **Google Antigravity 向けエージェントルール `rules/AGENTS.md` と `.gitattributes` の追加**:
  - Antigravity プラグインローダーが自動認識するプレーン Markdown ルール（`rules/AGENTS.md`）を追加。
  - Windows 環境での `CRLF` 混入による Prettier / シェルスクリプト不整合を防ぐ `.gitattributes`（LF 統一）を追加。

### Changed

- **MCP プロトコル準拠・入力検証・ページネーション強化**:
  - `isError: true` のツールエラー応答で `structuredContent` を省略し `_meta.error` + `[CODE]` テキストで返すよう修正（公式 SDK `Client.callTool()` における `outputSchema` 検証クラッシュを解消）。
  - 全 5 ツールの `inputSchema` に `.strict()`（`"additionalProperties": false`）を適用。
  - `/mcp` の非許可 HTTP メソッド応答（`405`）への `Allow: POST, OPTIONS` ヘッダー付与、不正 JSON（`400`）・64KB 超過ボディ（`413`）の JSON-RPC エラー応答化を実施。
  - `search_corporate_by_name` のカーソルに検索条件（`queryKey`）をバインドし、安全な整数オフセット範囲検証を追加。
  - 3 種の MCP Prompts の出典案内をホスト版（DB）・ローカル版（Web-API）の双方に適合するよう改善。
- **ドメイン正規化・DB 検索・インボイス検証の精度向上**:
  - ホスト版 DB の `search_corporate_by_name` で半角・全角 ASCII 英数字の双方にマッチするよう改善（`NTT` ⇔ `ＮＴＴ` 等）。
  - `normalize_company_name` で略称（`(株)` / `㈱` / `(有)` 等）の正式法人格展開、医療法人・学校法人・社会福祉法人・宗教法人・士業法人等の法人種別対応、および旧字体→新字体変換のコア名・正式名双方への適用を強化。
  - `lookup_invoice_issuer` で実在しない暦日（`2026-02-31` 等）の検証、`reference_date > data_as_of` 時のスナップショット基準日注記、および個人事業者の登録番号を考慮した形式検証を整備。
- **依存関係管理と品質スクリプトの整備**:
  - `package.json` の非推奨 `pnpm.overrides` を `pnpm-workspace.yaml` の `overrides` / `allowBuilds` に移行し、開発依存を含む `pnpm audit` 脆弱性 0 件を達成。
  - `prepublishOnly` の実行順序を `build` → `test` に修正し、`lint` / `format:check` の対象を `scripts`・`benchmarks` まで拡大。

### Security

- DB リポジトリ例外時の SQL 文・バインドパラメータ（`\nparams:` に含まれる法人番号・T番号・検索語）のクライアント応答および標準エラー出力への漏洩を防止し、タイムアウト（PostgreSQL `57014`）を `DATA_UNAVAILABLE` に統一。
- 法人番号・インボイス公表データの処理区分 `99`（削除）レコードの照会除外および人格区分許可リスト判定を厳格化。

## [1.0.2] - 2026-11-18

### Security

- 本番依存・npm配布パッケージの既知の脆弱性を解消（`pnpm audit --prod` 0件を達成）：
  - `hono@4` を `4.13.16` に固定（GHSA-4h7h-rv7c-7m2v, GHSA-3gg2-335m-rxc6）
  - `@hono/node-server@2` を `2.1.6` に固定（GHSA-qv5m-9pm6-hqp3, GHSA-jpvv-r467-5p4w）
  - 両パッケージとも 2026-11-01 / 2026-11-02 公開であり、14日公開遅延ルール（`minimumReleaseAge: 20160`）を完全充足

### Added

- Google Antigravity および Cursor IDE 向けプラグインマニフェストと自動設定ファイルの追加：
  - `plugin.json` (Agent Plugins 1.0.0 標準マニフェスト)
  - `mcp_config.json` (Google Antigravity MCP 設定)
  - `mcp.json` (Agent Plugins MCP 設定)
  - `.cursor/mcp.json` および `.mcp.json` (Cursor IDE 設定)
  - `.cursor/rules/houjin-bangou.mdc` および `rules/houjin-bangou.mdc` (Cursor 取引先照合・インボイス検証ルール)
  - `.cursor-plugin/plugin.json` (Cursor Marketplace プラグイン定義)
  - `skills/lookup-japan-corporate/SKILL.md` (Antigravity & Cursor スキル定義)
  - `assets/logo.svg` および `assets/logo.png` (512x512 高解像度公式ロゴバッジ)

## [1.0.1] - 2026-11-13

### Security

- 依存ライブラリの既知の脆弱性に対処：
  - `body-parser@1` を `1.20.9`、`body-parser@2` を `2.4.0` に固定（GHSA-27r3-jxmh-p828）
  - `fast-uri@3` を `3.1.9` に固定（GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr, GHSA-333x-w4r6-6crp, GHSA-xhq7-xmqj-769h）
  - `qs@6` を `6.16.1` に固定（GHSA-6pq8-jhm2-2vcw、※14日公開遅延ルールを遵守するため 10/27 公開の 6.16.2 ではなく 10/14 公開の 6.16.1 を指定）
  - `zod` を `^4.6.7` に更新（GHSA-mrhx-c7xc-m3w5）

### Changed

- 本番依存の更新：`express` を `5.3.0`、`@modelcontextprotocol/sdk` を `1.32.2`、`drizzle-orm` を `0.45.4` に更新
- パッケージマネージャーを `pnpm@10.34.7` に更新し、`pnpm-workspace.yaml` に `minimumReleaseAge: 20160`（14日公開遅延ルール）を設定して全依存（孫依存を含む）に適用

### Removed

- 未使用の依存関係を削除：
  - `dompurify`: コードベースで使用されていないため削除（GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr, GHSA-c6gr-qvv4-5v3f の解消を含む）
  - `pino-http`: コードベースで使用されていないため削除

### Fixed

- Server Card（`/.well-known/mcp.json`）の `attribution` をホスト版（ダウンロードデータ）とセルフホスト版（Web-API）に分離し、インボイス公表データの出典表示を追記

## [1.0.0] - 2026-10-19

### Added

- **Qualified Invoice Issuer lookup tool (`lookup_invoice_issuer`)**:
  - Looks up invoice registration numbers (`T` + 13 digits) with optional `reference_date` (`YYYY-MM-DD`) factual period check (`was_registered_on_reference_date: boolean | null`).
  - Protects sole proprietors by never storing or returning personal names, trade names, or addresses.
- **ChatGPT Apps ドメイン確認エンドポイント (`GET /.well-known/openai-apps-challenge`)**:
  - 環境変数 `OPENAI_APPS_CHALLENGE_TOKEN` の値をそのまま `text/plain` で返却（未設定時は `404`）。
  - クローラーからの検証リクエストを確実に受けるため、`/mcp` の Origin 検証対象外として実装。
  - Terraform (`infra/terraform/variables.tf`, `infra/terraform/main.tf`) に `openai_apps_challenge_token` 変数および Cloud Run サービス環境変数を追加。`.env.example` にコメント例を追加。
- **PostgreSQL 16 (`pg_trgm`) backend & monthly bulk CSV ingestion for Hosted Edition**:
  - Ingestion CLI (`src/ingest/cli.ts`, `src/ingest/importer.ts`, `src/ingest/parser.ts`) supporting streaming CSV ingestion from directory (`--dir`), atomic staging table swap, row-count threshold guards (`INGEST_MIN_RECORD_COUNT`), and process code `99` (deletion) handling.
  - Provider architecture: `DbCorporateDataProvider` and `DbInvoiceDataProvider` for PostgreSQL backend (`DATA_SOURCE=db`), and `createNtaClient` for NTA Web-API backend (`DATA_SOURCE=web-api`).
- **Infrastructure as Code & Cloud Operations**:
  - Terraform configuration for Hosted Edition (`infra/terraform/`): Cloud Run services (`houjin-bangou-mcp`), Cloud Run Jobs (`houjin-bangou-ingest-corporate`, `houjin-bangou-ingest-invoice`), Cloud SQL for PostgreSQL 16 (`pg_trgm`, `ENTERPRISE` edition), Cloud DNS zone (`mcp.sugu-kuru.co.jp`), Cloud Load Balancing, Cloud Armor rate limiting, and Cloud Monitoring alert policies.
  - Deployment runbook (`docs/deployment/hosted.md`).
- **HTTP Transport Security & Database Privilege Separation**:
  - `Origin` header allowlist middleware (`ALLOWED_ORIGINS`) with DNS rebinding protection and no-Origin allowance for non-browser CLI/Server-to-Server clients.
  - Per-IP in-memory rate limiting (`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, default 60 requests / 60 seconds) for `/mcp` with `TRUST_PROXY` support for Cloud Run.
  - 3-role PostgreSQL privilege separation (`houjin_admin`, `houjin_ingest`, `houjin_reader`) documented in `docs/deployment/db-roles.sql` and `docs/deployment/db-roles.md`.
- **MCP Apps UI (`@modelcontextprotocol/ext-apps` v1.7) & Snapshot Tests**:
  - Interactive UI views (`ui://corporate-card/mcp-app.html` and `ui://search-results/mcp-app.html`) supporting `lookup_corporate_by_number` and `search_corporate_by_name`.
  - Contract snapshot tests locking `tools/list`, `prompts/list`, and `resources/list` outputs (`tests/integration/mcp-contract-snapshot.test.ts`), plus headless fallback tests (`tests/integration/ui-fallback-and-headless.test.ts`).
- **MCP Registry Metadata (`server.json`)**:
  - Root `server.json` configured for official MCP Registry submission with `streamable-http` transport and remote endpoint (`https://houjin.mcp.sugu-kuru.co.jp/mcp`).

### Changed (Breaking Changes from v0.2.0)

- **Tool set updated to frozen specification v1.8**:
  - Removed `get_attribution` tool (attribution is embedded in every data tool's `structuredContent.attribution` and text footer).
  - `lookup_corporate_by_number` now accepts a single 13-digit `corporate_number` (instead of up to 10 comma-separated numbers). Outputs `corporation` (`corporate_number`, `name`, `name_kana`, `legal_type`, `location`, `post_code`, `update_date`, `status`, `close_date`, `close_cause`, `address_may_be_outdated`), `data_as_of`, and `attribution`.
  - `search_corporate_by_name` input/output schema updated: accepts `name`, optional `prefecture` (01-47), `cursor`, and `limit` (1-20, default 10); outputs `results` (with `corporate_number`, `name`, `legal_type`, `location`, `update_date`, `status`, `address_may_be_outdated`), `total_count`, `next_cursor`, `data_as_of`, and `attribution`.
  - `validate_corporate_number` accepts 13-digit `corporate_number` and outputs `is_valid_format`, `is_valid_check_digit`, and `error_reason`.
  - `normalize_company_name` accepts `raw_name` and outputs `normalized_name`, `legal_type`, and `search_query_optimized`.
  - Tool annotations aligned with v1.8 (ChatGPT Directory criteria): `readOnlyHint: true` and `destructiveHint: false` across all tools; `openWorldHint` is `true` for all 3 query tools (`lookup_corporate_by_number`, `search_corporate_by_name`, `lookup_invoice_issuer`) in both Hosted and Local modes, and `false` for pure local calculation tools (`validate_corporate_number`, `normalize_company_name`).
  - `lookup_invoice_issuer` title aligned to `Look up Registered Invoice Issuer by T-number`.
- **Prompts & Resources**:
  - Renamed prompt `business-card-to-database` to `company-master-record` and removed personal contact arguments to avoid accepting PII.
  - Removed `attribution://houjin-bangou` static resource, `corp://{corporate_number}` resource template, and MCP `logging` capability to keep the surface area minimal and read-only.
- **Policy & Documentation**:
  - Updated `docs/policy/privacy-policy.md` and `docs/policy/terms-of-service.md` to reflect the hosted database architecture, monthly update cycle, sole proprietor data handling, unified office address (`〒899-4332 鹿児島県霧島市国分中央１丁目２−３２ ポーラビル３階`), company name (`スグクル株式会社` / `SUGUKURU CO., LTD.`), and unified contact address (`info@sugu-kuru.co.jp`).
  - `lookup_invoice_issuer` のツール説明文およびサーバー初期化時の `instructions` に、利用限界（登録番号を1件ずつ確認する用途であり、範囲照会や一覧作成には使わない旨）と仕入税額控除に関する案内（登録事実のみを回答し、控除可否は税理士・税務署への確認を促す旨）を追記（PR 111）。

### Fixed

- ホスト版の照会結果要約テキストにおいて、`attribution` の値が「出典：」で始まる場合に「出典: 出典：...」と見出しが二重に出力される不具合を修正（`formatAttributionLine` の導入）。

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

## [0.1.0] - 2026-04-29

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
