# Security Policy / セキュリティポリシー

## 脆弱性の報告 / Reporting Vulnerabilities

脆弱性を発見した場合は、公開 Issue ではなく GitHub の Private Security Advisory もしくは `info@sugu-kuru.co.jp` までご連絡ください。

If you discover a security vulnerability, please report it privately via GitHub's Private Security Advisory feature or email `info@sugu-kuru.co.jp`.

**脆弱性の公開前連絡をお願いします。72 時間以内に初回応答します。 / Please allow up to 72 hours for an initial response before public disclosure.**

## 取扱対象 / In Scope

- プロンプトインジェクション（Tool Poisoning / Rug Pull / Tool Shadowing / Response-Mediated Injection）
- 国税庁 API アプリケーション ID・DB 接続情報・入力クエリ（法人番号・T番号・商号）のログ漏洩やエラー文への露出
- Streamable HTTP トランスポートでの DNS Rebinding / Origin 検証バイパス / レート制限回避（`X-Forwarded-For` 偽装等）/ DoS
- Zod スキーマ（`.strict()` / `additionalProperties: false`）やカーソル検証のバイパス
- MCP Apps UI レスポンス経由の XSS / DOM インジェクション / CSP バイパス

## 設計上のセキュリティ前提 / Security Architecture

- 本 MCP サーバーは **read-only** であり、書込・削除・コマンド実行系のツールを持ちません。
- アプリケーション ID や DB 接続情報は環境変数のみから読み取り、ツール引数経由では受け取りません。
- すべてのツール説明文は静的定数であり、`initialize` で `listChanged: false` を返却し、ランタイムでの定義変更を行いません。
- すべてのツール `inputSchema` に `.strict()`（`"additionalProperties": false`）を適用し、未定義フィールドへの隠し命令注入を拒否します。
- すべてのデータ参照ツールのレスポンスには `data_as_of` および `attribution` フィールドを必須付与します。
- HTTP トランスポートでは `Origin` ヘッダ許可リスト検証、接続元 IP 単位のレート制限（`Retry-After` 付与）、および 64KB のリクエストボディ上限を実施します。
- PostgreSQL データベースは `houjin_admin`（DDL）・`houjin_ingest`（月次 CSV アトミック取込）・`houjin_reader`（MCP サーバー用 `SELECT` 専用）の 3 ロールに権限分離しています（[`docs/deployment/db-roles.md`](docs/deployment/db-roles.md)）。
- プロンプトインジェクション防御の詳細は [`docs/security/prompt-injection-defense.md`](docs/security/prompt-injection-defense.md) を参照してください。

## 国税庁データの取得方式とアプリケーション ID の取扱 / NTA Data & Application ID Handling

国税庁「法人番号システム Web-API 機能利用規約」第9条第1項第5号では、Web-API のアプリケーション ID を第三者に譲渡・貸与・開示することが禁止されています。

- **ホスト版（`DATA_SOURCE=db`）**: 国税庁の法人番号公表サイトおよび適格請求書発行事業者公表サイトの公開ダウンロードデータ（全件 CSV）を月1回取得して自社管理のデータベース（Cloud SQL）に格納し、そのデータベースに対して検索・照会を行います。ホスト版では国税庁 Web-API およびアプリケーション ID を使用しません。
- **ローカル版（`DATA_SOURCE=web-api`、セルフホスト）**: 利用者自身が国税庁から取得したアプリケーション ID を環境変数 `NTA_APPLICATION_ID` に設定して法人番号照会・検索を利用します（`lookup_invoice_issuer` はデータベース接続時のみ動作します）。

The Hosted Edition serves responses from our PostgreSQL database populated monthly from the National Tax Agency's public bulk CSV downloads, without using an NTA Web-API Application ID. Self-hosted users querying the NTA Web-API directly must obtain and configure their own `NTA_APPLICATION_ID`.

## サプライチェーンセキュリティ / Supply Chain Security

- `pnpm-lock.yaml` をコミット管理し、`pnpm-workspace.yaml` の `minimumReleaseAge: 20160`（14日公開遅延ルール）および `overrides` により全依存・孫依存を保護しています。
- GitHub Actions CI（`.github/workflows/ci.yml`）で `pnpm audit --prod --audit-level=high` および静的プロンプトインジェクション検査を実行しています。
- Dependabot による週次依存更新、GitHub CodeQL 静的解析（`codeql.yml`）、CycloneDX SBOM 生成（`sbom.yml`）を有効化しています。
- npm パッケージ公開（`release.yml`）には GitHub OIDC による **npm Trusted Publishing（Provenance 署名付き・長期 `NPM_TOKEN` 不使用）** を使用しています。
