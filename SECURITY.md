# Security Policy / セキュリティポリシー / Kebijakan Keamanan

## 脆弱性の報告 / Reporting Vulnerabilities / Melaporkan Kerentanan

脆弱性を発見した場合は、GitHub の private security advisory もしくは
`info@sugu-kuru.co.jp` までご連絡ください。

If you discover a security vulnerability, please report it via GitHub's
private security advisory feature, or email `info@sugu-kuru.co.jp`.

Jika Anda menemukan kerentanan keamanan, silakan laporkan melalui fitur
private security advisory di GitHub, atau email `info@sugu-kuru.co.jp`.

**脆弱性の公開前連絡をお願いします。72 時間以内に初回応答します。**

## 取扱対象 / In Scope / Dalam Cakupan

- プロンプトインジェクション（Tool Poisoning / Rug Pull / Tool Shadowing）
- 国税庁 API アプリケーション ID や DB 接続情報のログ出力漏洩
- Streamable HTTP transport での DNS Rebinding / Origin 検証バイパス / DoS / SSRF
- Zod スキーマ経由の Input Validation バイパス
- MCP Apps UI レスポンス経由の XSS / HTML インジェクション / CSP バイパス

## 設計上のセキュリティ前提 / Security Assumptions / Asumsi Keamanan

- 本 MCP サーバは **read-only** で、書込・削除・コマンド実行系 tool を持ちません
- アプリケーション ID や DB 接続情報は環境変数のみから読み取り、tool 引数経由では受け取りません
- すべての tool description は静的定数、ランタイム書換不可
- データ参照ツールのレスポンスはすべて `attribution` フィールド付きで返却
- HTTP トランスポートでは `Origin` ヘッダ検証（許可リスト照合）および接続元 IP 単位のレート制限を実施
- PostgreSQL データベースは `houjin_admin`（DDL）・`houjin_ingest`（月次CSV取込）・`houjin_reader`（MCP サーバ用 SELECT 専用）の 3 ロールに権限分離
- プロンプトインジェクション詳細対策は [`docs/security/prompt-injection-defense.md`](docs/security/prompt-injection-defense.md) 参照

## 国税庁データの取得方式とアプリケーション ID の取扱 / NTA Data & Application ID Handling

国税庁「法人番号システム Web-API 機能利用規約」第9条第1項第5号では、Web-API のアプリケーション ID を第三者に譲渡・貸与・開示することが禁止されています。

- **ホスト版**: 国税庁の法人番号公表サイトおよび適格請求書発行事業者公表サイトの公開ダウンロードデータ（全件 CSV）を月1回取得して自社管理のデータベース（Cloud SQL）に格納し、そのデータベースに対して検索・照会を行います。ホスト版では国税庁 Web-API およびアプリケーション ID を使用しません。
- **ローカル版（セルフホスト）**: 利用者自身が国税庁から取得したアプリケーション ID を環境変数 `NTA_APPLICATION_ID` に設定して利用します。

Host edition serves responses from our PostgreSQL database populated monthly from the National Tax Agency's public bulk CSV downloads, without using an NTA Web-API Application ID. Self-hosted users who query the NTA Web-API directly must obtain and configure their own `NTA_APPLICATION_ID`.

## Supply Chain Security

- `pnpm-lock.yaml` is committed
- Dependabot weekly updates enabled
- GitHub CodeQL enabled
- `npm audit signatures` runs in CI
- All releases use `pnpm publish --provenance` (sigstore-signed)
