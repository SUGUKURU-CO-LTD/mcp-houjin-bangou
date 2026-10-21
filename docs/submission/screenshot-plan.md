# スクリーンショット撮影計画書 (Screenshot Plan)

本書は、Claude Directory および ChatGPT Directory (App Review) への提出、ならびに公開リポジトリ（README・ドキュメント）掲載用のスクリーンショット撮影手順書です。  
実際の撮影作業は人間（担当者）が実機環境にて実施します。

---

## 1. 前提知識と基本方針

### 1.1 クライアントと MCP Apps UI の対応状況
- **本 MCP サーバーは、MCP Apps UI（`ui://...` リソース）に対応したクライアントにおいて、視覚的で直感的なカード・テーブル表示（`ui://corporate-card/mcp-app.html` および `ui://search-results/mcp-app.html`）を提供します。**
- 同時に、UI を表示できないクライアント（CLI、ターミナル、SDK によるスクリプト連携等）であっても、`content`（要約テキスト）と `structuredContent`（構造化 JSON）のみで各ツールの主たる目的が確実に果たせるフォールバック設計を実証済みです（`tests/integration/ui-fallback-and-headless.test.ts` で検証）。

### 1.2 提出資料としての目的
1. **Claude Directory / ChatGPT Directory 審査用**:
   - ツール呼び出し結果としてインタラクティブ UI が安全（厳格な CSP Hash 適用・外部通信遮断）に描画されることを審査員に示す。
   - プロンプトワークフロー（取引先企業マスタ生成等）を通じて、エージェントが的確にツールを呼び出し、ユーザーが確認・操作できる一連の流れを示す。
2. **README / 利用者向けガイド用**:
   - 導入検討者が一目で機能と利用価値を把握できる視覚的証跡を提供する。

---

## 2. 撮影対象の画面とシナリオ

以下の 4 画面（計 6 点）を撮影対象とします。

| # | 画面種別 | 対象機能・ツール | 使用データ / シナリオ | 撮影環境 | ファイル名（保存先） |
|---|---|---|---|---|---|
| **1** | 法人詳細カード (Active) | `lookup_corporate_by_number` (`ui://corporate-card/mcp-app.html`) | スグクル株式会社 (`9340001026142`) または代表的な存続法人 | Claude Desktop または ChatGPT | `corporate-card-active.png` |
| **2** | 法人詳細カード (Closed) | `lookup_corporate_by_number` (`ui://corporate-card/mcp-app.html`) | 閉鎖法人（清算結了・合併等） | Claude Desktop または ChatGPT | `corporate-card-closed.png` |
| **3** | 法人名検索結果テーブル | `search_corporate_by_name` (`ui://search-results/mcp-app.html`) | 商号「スグクル」等の検索結果一覧 | Claude Desktop または ChatGPT | `search-results-table.png` |
| **4** | エージェント対話ワークフロー | Prompt `company-master-record` | 商号入力から正規化・検索・詳細照会・マスタ生成までの一連の対話 | Claude Desktop または ChatGPT | `chat-master-workflow.png` |
| **5** | インボイス確認 (テキスト＋構造化) | `lookup_invoice_issuer` | 登録番号 `T1234567890123`（※架空の番号例、法人）および `T...`（個人事業者・氏名非公表） | Claude Desktop または ChatGPT | `invoice-lookup-text.png` |
| **6** | UI 非対応環境フォールバック | 全ツール（CLI / ヘッドレス） | ターミナルまたは MCP Inspector のテキスト / JSON 出力 | ターミナル (CLI) / Inspector | `headless-fallback-cli.png` |

---

## 3. 撮影の推奨環境・前提設定

### 3.1 推奨環境
- **OS**: macOS (Retina ディスプレイ推奨、2x 解像度)
- **MCP クライアント**:
  - Claude Desktop (最新版)
  - または ChatGPT
  - または MCP Inspector (`npx @modelcontextprotocol/inspector`)
- **ブラウザ（補助プレビュー用）**: Google Chrome 最新版 または Safari 最新版

### 3.2 ディスプレイとスタイル基準
- **解像度**: Retina 2x（横幅 1200px 〜 1600px 程度にウィンドウを調整）
- **カラーテーマ**:
  - 原則 **ライトモード（Light Mode）** をメインとする（公式ディレクトリカタログで視認性が高いため）。
  - 必要に応じてダークモード（Dark Mode）も 1〜2 点撮影可能（CSS は `@media (prefers-color-scheme: dark)` に対応済み）。
- **言語設定**: 日本語 UI
- **フォント**: システム標準日本語フォント（Hiragino Sans / Noto Sans JP）で美しくレンダリングされていること。

---

## 4. 撮影手順（ステップ・バイ・ステップ）

### ステップ 1: 事前ビルドの実行
撮影前に必ず最新のコードと UI アセットを完全ビルドします。

```bash
cd .

# サーバーコード、UI bundle (singlefile)、CSPハッシュ注入を一括ビルド
pnpm build
```

`dist/ui/corporate-card/mcp-app.html` および `dist/ui/search-results/mcp-app.html` が生成され、`<meta http-equiv="Content-Security-Policy">` にハッシュが正しく注入されていることを確認します。

### ステップ 2: 撮影環境の起動

#### パターン A: Claude Desktop 実機環境での撮影（最優先推奨）
1. `~/Library/Application Support/Claude/claude_desktop_config.json` に本サーバーを設定します（Streamable HTTP 接続）：
   ```json
   {
     "mcpServers": {
       "houjin-bangou": {
         "url": "https://houjin.mcp.sugu-kuru.co.jp/mcp"
       }
     }
   }
   ```
   ※ローカル開発環境のサーバーを使用する場合は、事前にローカルサーバー（`pnpm build && pnpm start`）を起動した上で `"url": "http://localhost:3001/mcp"` を指定します。
2. Claude Desktop を再起動し、右下のハンマーアイコン（ツール一覧）に 5 つのツールが表示されていることを確認します。
3. チャット欄で以下の指示を入力して実行します：
   - **画面 1（Active カード）**:
     > 「法人番号 9340001026142 の法人情報を照会してください。」
     - 表示された `corporate-card` の iframe をきれいに収めてキャプチャ。
     - 「法人番号をコピー」ボタンや「類似商号を検索」ボタンが見えていることを確認。
   - **画面 3（検索結果テーブル）**:
     > 「法人名『スグクル』で法人を検索してください。」
     - 表示された `search-results` テーブルの全行、ページネーション表示、フッターの出典表示が美しく収まるようにキャプチャ。
   - **画面 4（対話ワークフロー）**:
     > プロンプト「Company master record generation from company name」を選択し、会社名「スグクル株式会社」で実行。
     - エージェントがツールを順次呼び出し、最終的な取引先企業マスタレコードを生成するまでの流れをキャプチャ。

#### パターン B: MCP Inspector での撮影（補助・精密撮影）
1. MCP Inspector を起動します（ローカルまたはホスト版の Streamable HTTP エンドポイントを指定）：
   ```bash
   # ホスト版の場合
   npx @modelcontextprotocol/inspector --uri https://houjin.mcp.sugu-kuru.co.jp/mcp

   # ローカル開発版の場合（別ターミナルで pnpm start 起動後）
   npx @modelcontextprotocol/inspector --uri http://localhost:3001/mcp
   ```
2. ブラウザで Inspector（通常 `http://localhost:5173`）を開きます。
3. `lookup_corporate_by_number` または `search_corporate_by_name` を実行し、UI Resource タブで描画された UI を撮影します。

#### パターン C: 静的プレビュー (`docs/assets/ui-preview.html`) による撮影（予備）
実機ホスト接続なしで UI コンポーネント単体の完全な見栄えを撮影したい場合は、同梱の静的プレビューを使用できます：
1. ブラウザで `docs/assets/ui-preview.html` を開きます。
2. `corporate-card` および `search-results` が fixtures データで綺麗にレンダリングされます。
3. ウィンドウ幅を 800px 程度に設定し、コンポーネント単位でスクリーンショットを撮影します。

---

## 5. 画像の保存と配置先

撮影した画像ファイルは以下のディレクトリに配置します：

```text
docs/assets/screenshots/
├── corporate-card-active.png     # 法人詳細カード (Active)
├── corporate-card-closed.png     # 法人詳細カード (Closed)
├── search-results-table.png      # 法人名検索結果テーブル
├── chat-master-workflow.png      # エージェント対話ワークフロー
├── invoice-lookup-text.png       # インボイス確認 (テキスト＋構造化)
└── headless-fallback-cli.png     # UI非対応環境 (CLI / ターミナル)
```

- **フォーマット**: PNG（可逆圧縮、24-bit RGB または 32-bit RGBA）
- **ファイルサイズ目安**: 1枚あたり 300KB 〜 1.5MB 程度（必要に応じて `pngquant` 等で最適化）

---

## 6. 個人情報（PII）・セキュリティ点検チェックリスト

スクリーンショットを公開・提出する前に、人間オペレーターは以下の項目を点検してください：

- [ ] **個人情報の非混入**: 個人の氏名、個人事業者の屋号以外の個人情報、個人の電話番号、私用メールアドレス、個人の銀行口座番号等が画面に写り込んでいないこと。
- [ ] **認証情報の非混入**: API キー、Database パスワード、アクセストークン、シークレット環境変数が画面内に露出していないこと。
- [ ] **公的誤認の排除**: 「公的証明」「登記完了」「国税庁公式アプリ」などの誤解を招く独自ラベルが表示されていないこと。
- [ ] **出典表記の明瞭性**: フッター部分に国税庁利用規約に準拠した所定の出典表記（「出典：国税庁法人番号公表サイト...」）が正確に表示されていること。
- [ ] **税務免責事項**: インボイス関連の表示において「税理士法第2条に定める税務相談・仕入税額控除の可否等の税務上の判断は行いません」の免責事項が確認できること。
