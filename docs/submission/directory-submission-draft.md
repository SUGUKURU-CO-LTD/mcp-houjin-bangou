# ディレクトリ提出用下書き（Claude コネクタディレクトリ / ChatGPT アプリディレクトリ / 公式 MCP Registry）

最終更新日: 2026年10月18日
対象バージョン: `@sugukuru/mcp-houjin-bangou` v1.0.0（凍結仕様 v1.7）

---

## 1. 基本情報（共通）

| 項目 | 値 |
| :--- | :--- |
| **サーバー名（パッケージ名）** | `@sugukuru/mcp-houjin-bangou` |
| **表示名（日本語）** | 国税庁 法人番号・インボイス確認 MCP |
| **表示名（英語）** | Japan NTA Corporate Number & Invoice Issuer Lookup MCP |
| **バージョン** | `1.0.0` |
| **提供者** | スグクル株式会社（Sugukuru K.K.） |
| **提供者所在地** | 〒899-4332 鹿児島県霧島市国分中央１丁目２−３２ ポーラビル３階 |
| **会社サイト** | `https://sugu-kuru.co.jp` |
| **プライバシーポリシー URL（正式版・会社サイト）** | `https://sugu-kuru.co.jp/privacy`（※公開確定後に記入。リポジトリ同梱版: `https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou/blob/main/docs/policy/privacy-policy.md`） |
| **利用規約 URL** | `https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou/blob/main/docs/policy/terms-of-service.md` |
| **サポート・窓口メールアドレス** | `info@sugu-kuru.co.jp` |
| **ソースコードリポジトリ** | `https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou` |
| **リモート MCP エンドポイント** | `https://<公開ドメイン>/mcp`（※`SLA2-330` 項目5 決定後に記入） |
| **Server Card エンドポイント** | `https://<公開ドメイン>/.well-known/mcp.json` |
| **認証方式** | 不要（公開データの読み取り専用照会、IP単位レート制限あり） |

---

## 2. 掲載文（日本語・英語）

### 2.1 短文概要（1行・最大120文字）

- **日本語**:
  日本の13桁法人番号・会社名・適格請求書（インボイス）発行事業者の登録状況を、国税庁の公表データに基づき照会・正規化する読み取り専用MCPサーバー。
- **英語**:
  Read-only MCP server to look up Japanese 13-digit corporate numbers, company names, and Qualified Invoice Issuer (T-number) status from NTA public data.

### 2.2 詳細説明（日本語）

`@sugukuru/mcp-houjin-bangou` は、国税庁の法人番号公表情報および適格請求書発行事業者公表サイトの公開データをもとに、日本国内の法人基本情報とインボイス登録状況を確認できる読み取り専用の Model Context Protocol (MCP) サーバーです。

**主な機能（5つのツール）**:
1. **法人番号による照会 (`lookup_corporate_by_number`)**: 13桁の法人番号（またはT付き登録番号）から、商号・本店所在地・法人種別・変更履歴を取得します。
2. **会社名による検索 (`search_corporate_by_name`)**: 会社名・都道府県コード（JIS X 0401）・市区町村名・法人種別で法人を検索します。
3. **法人番号のチェックデジット検証 (`validate_corporate_number`)**: ネットワーク通信を行わずに、13桁の法人番号の検査用数字（国税庁検査算式）を検証します。
4. **会社名の表記揺れ正規化 (`normalize_company_name`)**: 前株・後株・略称「（株）」・旧字体・全角半角・英語法人格表記などの表記揺れを正規化し、検索候補を生成します。
5. **適格請求書発行事業者の登録確認 (`lookup_invoice_issuer`)**: インボイス登録番号（`T`+13桁）または法人番号（13桁）から、現在の登録状態および指定した基準日（`as_of`）時点の有効性を確認します。

**特徴**:
- **データの出典明示**: すべてのツール応答に `attribution`（データの出典・データの基準日または取得元）を同梱します。
- **MCP Apps UI 対応 & テキスト完結設計**: MCP Apps の UI 表示に対応するクライアント（Claude、ChatGPT 等）では法人カードや検索結果一覧の UI リソースを利用でき、UI を表示しないクライアントでも `structuredContent` とテキスト要約だけで必要な情報をすべて取得できます。
- **プライバシー配慮**: ツールに渡された入力値（法人番号・登録番号・検索語）をアプリケーションログに記録しません。個人事業者の登録番号照会では、有効状態・登録年月日・取消年月日・失効年月日のみを返し、氏名・屋号・所在地は保持・返却しません。

### 2.3 Detailed Description (English)

`@sugukuru/mcp-houjin-bangou` is a read-only Model Context Protocol (MCP) server for looking up Japanese corporate registrations and Qualified Invoice Issuer (T-number) statuses based on public datasets published by Japan's National Tax Agency (NTA).

**Tools (5 Read-Only Tools)**:
1. **`lookup_corporate_by_number`**: Look up official corporate name, head-office address, corporate kind, and change history by 13-digit corporate number.
2. **`search_corporate_by_name`**: Search corporations by company name, prefecture code (JIS X 0401), municipality name, and corporate kind.
3. **`validate_corporate_number`**: Offline check-digit verification for 13-digit corporate numbers using the official NTA Modulo-9 formula.
4. **`normalize_company_name`**: Offline company name normalization covering kabushiki placement (`(株)`), old-to-new kanji variants, full/half-width characters, and English legal suffixes.
5. **`lookup_invoice_issuer`**: Check Qualified Invoice Issuer registration status and historical validity as of a reference date (`as_of`) by registration number (`T` + 13 digits) or 13-digit corporate number.

**Key Characteristics**:
- **Attribution Included**: Every tool response includes an `attribution` block indicating the data source and dataset date.
- **MCP Apps UI & Text-Only Compatibility**: Provides interactive UI resources (`ui://corporate-card/mcp-app.html` and `ui://corporate-search-results/mcp-app.html`) for clients that support MCP Apps UI (such as Claude and ChatGPT), while ensuring clients that do not render UI can fulfill all use cases via `structuredContent` and text summaries alone.
- **Privacy by Design**: Tool arguments (queried numbers and company names) are never written to application logs. For sole proprietors, only registration status and effective dates are stored and returned; personal names, trade names, and addresses are neither stored nor returned.

---

## 3. 例文プロンプト（3つ）

ディレクトリ掲載フォームに登録する動作確認済みの例文プロンプトです。

### 例文 1: 会社名からの法人番号・インボイス登録の一括確認（取引先マスタ作成）
- **日本語**:
  `「（株）スグクル」（鹿児島県霧島市）の表記揺れを正規化して法人番号を検索し、本店所在地と適格請求書発行事業者（インボイス）の登録状況を確認してください。`
- **英語**:
  `Normalize the company name "(株)スグクル" in Kirishima, Kagoshima, find its 13-digit corporate number, and check its head-office address and Qualified Invoice Issuer registration status.`
- **使用されるツール**: `normalize_company_name` → `search_corporate_by_name` → `lookup_invoice_issuer`

### 例文 2: 請求書に記載されたインボイス登録番号の取引日時点での有効確認
- **日本語**:
  `請求書に記載されている登録番号「T9340001026142」が、取引日 2026-10-01 時点で適格請求書発行事業者として有効に登録されていたか確認してください。`
- **英語**:
  `Check whether the invoice registration number "T9340001026142" was validly registered as a Qualified Invoice Issuer as of the transaction date 2026-10-01.`
- **使用されるツール**: `lookup_invoice_issuer`（`number: "T9340001026142"`, `as_of: "2026-10-01"`）

### 例文 3: 13桁の法人番号の形式検証と変更履歴の照会
- **日本語**:
  `法人番号「9340001026142」のチェックデジットが正しいか検証した上で、最新の商号・本店所在地と過去の変更履歴を取得してください。`
- **英語**:
  `Validate the check digit of corporate number "9340001026142" and retrieve its latest official name, head-office address, and change history.`
- **使用されるツール**: `validate_corporate_number` → `lookup_corporate_by_number`（`include_history: true`）

---

## 4. 各ツールのアノテーション設定値と設定理由

全 5 ツールはデータの作成・更新・削除を一切行わない読み取り専用ツールであり、同一入力に対して副作用を持たないため、`readOnlyHint: true`、`destructiveHint: false`、`idempotentHint: true` を共通設定しています。`openWorldHint` は外部またはデータベースへの問い合わせを行うかどうかによってツールごとに設定しています。

| ツール名 | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` | 設定理由 |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `lookup_corporate_by_number` | `true` | `false` | `true` | `true` | 外部データソース（DB または国税庁 Web-API）の公表法人データを参照する読み取り専用ツールであり、データの変更を行わないため。 |
| `search_corporate_by_name` | `true` | `false` | `true` | `true` | 外部データソース（DB または国税庁 Web-API）に対して会社名・地域条件で検索を行う読み取り専用ツールであり、データの変更を行わないため。 |
| `validate_corporate_number` | `true` | `false` | `true` | `false` | ネットワーク通信や DB 参照を一切行わず、プロセス内の純粋関数（国税庁 Modulo-9 検査算式）のみで完結する決定的な検証ツールであるため。 |
| `normalize_company_name` | `true` | `false` | `true` | `false` | ネットワーク通信や DB 参照を一切行わず、プロセス内の辞書・正規表現ルールのみで表記揺れ候補を生成する決定的な純粋関数ツールであるため。 |
| `lookup_invoice_issuer` | `true` | `false` | `true` | `true` | データベース（適格請求書発行事業者公表データ）を参照して登録状況と履歴を確認する読み取り専用ツールであり、データの変更を行わないため。 |

---

## 5. 各ディレクトリ提出時のチェックリスト

1. **Claude コネクタディレクトリ（Anthropic MCP Directory）**:
   - リモート MCP URL（`https://<公開ドメイン>/mcp`）の疎通確認
   - 会社サイト上のプライバシーポリシー URL（`https://sugu-kuru.co.jp/privacy`）の公開確認
   - 全 5 ツールのアノテーション（`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`）の一致確認
   - 例文プロンプト 3 件の動作確認
2. **ChatGPT アプリ / コネクタ提出（OpenAI）**:
   - Streamable HTTP エンドポイント（`/mcp`）での `initialize` / `tools/list` / `tools/call` 応答確認
   - Origin ホワイトリスト（`https://chatgpt.com`, `https://chat.openai.com`）の許可確認
   - プライバシーポリシー URL およびサポート窓口（`info@sugu-kuru.co.jp`）の記載確認
3. **公式 MCP Registry（`server.json`）**:
   - ルート直下の [`server.json`](../../server.json)（および [`docs/submission/server.json`](server.json)）の `version: "1.0.0"`、npm パッケージ名 `@sugukuru/mcp-houjin-bangou`、リポジトリ URL `https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou` の一致確認
