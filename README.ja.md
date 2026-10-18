# @sugukuru/mcp-houjin-bangou

> **国税庁の法人番号公表データおよび適格請求書発行事業者（インボイス）公表データを照会・検証できる MCP (Model Context Protocol) サーバー。**

[![npm version](https://img.shields.io/npm/v/@sugukuru/mcp-houjin-bangou.svg)](https://www.npmjs.com/package/@sugukuru/mcp-houjin-bangou)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou/actions/workflows/ci.yml/badge.svg)](https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou/actions/workflows/ci.yml)
[![MCP Spec 2025-11-25](https://img.shields.io/badge/MCP-2025--11--25-blue)](https://modelcontextprotocol.io/specification/2025-11-25)

🌐 English README: [README.md](README.md)

## 概要

Claude、ChatGPT、Cursor、VS Code Copilot などの MCP 対応クライアントから、以下の機能を利用できます。

1. **法人番号（13桁）による法人照会** (`lookup_corporate_by_number`) — 1件の法人番号から商号・本店所在地・法人種別・登記閉鎖や吸収合併の承継先情報を取得し、あわせて適格請求書発行事業者（インボイス）の登録状態も確認できます。
2. **法人名による検索** (`search_corporate_by_name`) — 表記揺れの自動正規化・都道府県や市区町村での絞り込み・カーソルページングに対応しています。
3. **適格請求書発行事業者（T+13桁）の照会** (`lookup_invoice_issuer`) — 登録番号（`T` + 13桁）の登録有無、過去の登録期間履歴（`registration_periods`）、および指定した取引基準日（`reference_date`）が有効な登録期間内にあるかの事実確認（`valid_on_reference_date`）を行います。
4. **チェックデジットのローカル検証** (`validate_corporate_number`) — 外部通信を一切行わずに13桁の法人番号の検査用数字（モジュロ9）を検証します。
5. **会社名の表記揺れ正規化** (`normalize_company_name`) — `(株)` / `株式会社` の前後位置展開、法人種別分離、英語表記（K.K. / Inc. 等）の変換、旧字体→新字体変換（髙→高、﨑→崎 等）、異体字セレクタ除去など 7 パターンの正規化候補を生成します。

---

## 2つの動作モード

### 1. ホスト版 / PostgreSQL モード（リモート Streamable HTTP）

- 国税庁の「法人番号公表サイト」および「適格請求書発行事業者公表サイト」の公開ダウンロードデータ（全件 CSV）を月1回取り込んだ PostgreSQL 16（`pg_trgm`）データベースから高速に応答します。
- 実行時に国税庁 Web-API のアプリケーション ID を使用しません。
- `Origin` ヘッダ許可リスト検証、接続元 IP アドレス単位のレート制限、およびデータベースの 3 ロール権限分離（`houjin_admin` / `houjin_ingest` / `houjin_reader`）を備えています。

### 2. ローカル実行 / セルフホストモード（HTTP）

- 利用者自身の環境でローカル HTTP サーバー（既定ポート `3001`）を起動し、利用者自身が取得した国税庁 Web-API アプリケーション ID（`NTA_APPLICATION_ID`）または手元の PostgreSQL（`DATABASE_URL`）を使って利用できます。

```bash
# 国税庁 Web-API モードで起動（既定ポート: 3001）
NTA_APPLICATION_ID="あなたのアプリケーションID" npx @sugukuru/mcp-houjin-bangou
```

#### MCP クライアントでの設定例

##### ホスト版（リモート Streamable HTTP）
```json
{
  "mcpServers": {
    "houjin-bangou": {
      "url": "https://houjin.mcp.sugu-kuru.co.jp/mcp"
    }
  }
}
```

##### ローカル HTTP モード（セルフホスト）
手元で上記起動コマンドを実行後、以下のように接続します。
```json
{
  "mcpServers": {
    "houjin-bangou-local": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

Cursor / VS Code 向けの設定例は [`examples/`](examples/) を参照してください。

---

## ツール一覧（全5ツール）

| ツール名 | 用途 | アノテーション (`readOnly` / `destructive` / `idempotent` / `openWorld`※) | 備考 |
|---|---|---|---|
| `lookup_corporate_by_number` | 13桁の法人番号による単一法人照会 | `true` / `false` / `true` / `false`（ホスト版） | `include_invoice_status`（既定 `true`）でインボイス状態も併記。UI `ui://corporate-card/mcp-app.html` 対応 |
| `search_corporate_by_name` | 法人名による検索 | `true` / `false` / `true` / `false`（ホスト版） | 都道府県コード・市区町村名・閉鎖法人含有・`limit`（1〜50）・`cursor` 対応。UI `ui://search-results/mcp-app.html` 対応 |
| `lookup_invoice_issuer` | 適格請求書発行事業者（T+13桁）の照会 | `true` / `false` / `true` / `false`（ホスト版） | `reference_date`（`YYYY-MM-DD`）指定で基準日時点の有効期間照合に対応。UI `ui://corporate-card/mcp-app.html` 対応 |
| `validate_corporate_number` | 法人番号チェックデジット検証 | `true` / `false` / `true` / `false` | ローカル純粋関数（外部通信なし、共通） |
| `normalize_company_name` | 会社名の表記揺れ正規化 | `true` / `false` / `true` / `false` | ローカル純粋関数（外部通信なし、共通） |

※ **`openWorld` アノテーションに関する注記**:
`openWorldHint` はサーバーがツールごとに宣言する注釈（メタデータ）であり、クライアントから送信されるものではありません。
- **ホスト版**（自社データベース参照）: 外部ネットワークへの問い合わせを行わないため、`false` となります。
- **ローカル版**（国税庁 Web-API 照会モード）: 国税庁 Web-API に問い合わせるため `true` となります（※外部通信を行わない純粋関数の 2 ツール `validate_corporate_number`, `normalize_company_name` は常に `false` です。仕様書 v1.7 準拠）。

---

## プロンプト（3種）と MCP Apps UI リソース（2種）

- **Prompts**:
  - `company-master-record`: 会社名や住所メモから表記揺れを正規化し、法人番号・正式商号・本店所在地を照会して取引先マスタ登録用レコードを作成します（個人名や連絡先等の個人情報は扱いません）。
  - `sales-list-enrichment`: 複数社のリストに対して法人番号・正式名称・所在地を一括付与します。
  - `customer-master-dedup`: 顧客マスタ内の表記揺れ・移転・合併による重複候補を検出します。
- **MCP Apps UI リソース（`@modelcontextprotocol/ext-apps` v1.7）**:
  - `ui://corporate-card/mcp-app.html`: 法人情報およびインボイス登録状態のカード表示。
  - `ui://search-results/mcp-app.html`: 法人名検索結果の一覧表表示（詳細照会へのドリルダウン対応）。
  - UI を表示しないクライアントでも、`structuredContent` とテキスト出力だけで全ての情報を過不足なく利用できます。

---

## プライバシー・セキュリティ・データ更新頻度

- **入力値の非記録**: 利用者が入力した法人番号、インボイス登録番号、検索語はアプリケーションのアクセスログに記録しません。
- **個人事業者情報の保護**: 適格請求書発行事業者のうち個人事業者のデータについては、氏名・屋号・所在地をデータベースに取り込まず、出力もしません（登録番号 `T`+13桁、人格区分、登録・取消・失効等の日付のみを保持し、完全一致照会のみを提供します）。
- **月1回のデータ更新**: ホスト版の公表データは月1回（前月末時点の全件データ）で更新されます。月途中の変更・取消・失効や、法人番号の処理区分「99（削除）」・インボイス公表申出の取り下げ等は次回の月次更新まで反映されません。各応答にはデータの基準日（`data_as_of`）が含まれます。
- **事実照会への限定**: `valid_on_reference_date` を含む本サーバーの出力は公表データ上の日付との事実照合結果であり、個別の税務相談・税務判断を提供するものではありません。

---

## ドキュメント

- [API リファレンス](docs/api-reference.md)
- [はじめに (Getting Started)](docs/getting-started.md)
- [活用クックブック (Usage Cookbook)](docs/usage-cookbook.md)
- [プライバシーポリシー](docs/policy/privacy-policy.md) ([英語版](docs/policy/privacy-policy.en.md))
- [利用規約](docs/policy/terms-of-service.md) ([英語版](docs/policy/terms-of-service.en.md))
- [DB ロール設計と権限分離](docs/deployment/db-roles.md)
- [セルフホストガイド](docs/deployment/self-hosting.md)
- [プロンプトインジェクション防御](docs/security/prompt-injection-defense.md)
- [設計決定記録 (ADR)](docs/adr/)
- [SECURITY](SECURITY.md) / [CONTRIBUTING](CONTRIBUTING.md) / [CODE OF CONDUCT](CODE_OF_CONDUCT.md)

---

## 出典表示

- **法人番号公表データ**: 国税庁法人番号公表サイト（`https://www.houjin-bangou.nta.go.jp/`） — 公共データ利用規約 第1.0版
- **適格請求書発行事業者公表データ**: 国税庁適格請求書発行事業者公表サイト（`https://www.invoice-kohyo.nta.go.jp/`）
- **Web-API 免責表示**:
  > このサービスは、国税庁法人番号システム Web-API 機能を利用して取得した情報をもとに作成しているが、サービスの内容は国税庁によって保証されたものではない。

## ライセンス・運営事業者

- **ライセンス**: MIT © 2026 スグクル株式会社（鹿児島県霧島市）
- **Webサイト**: [https://sugu-kuru.co.jp](https://sugu-kuru.co.jp)
- **連絡先**: `info@sugu-kuru.co.jp`
