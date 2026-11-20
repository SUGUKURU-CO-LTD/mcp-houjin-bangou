# Examples / 動作サンプル

## ファイル一覧

- [`claude-desktop-config.json`](claude-desktop-config.json) - Claude Desktop 用の `mcpServers` 設定 + 動作サンプルプロンプト 5 件
- [`cursor-mcp.json`](cursor-mcp.json) - Cursor 用の `mcpServers` 設定（`streamable-http`）

## 動作サンプルプロンプト (UC-1〜UC-5)

### UC-1: 法人番号で照会

> スグクル株式会社の法人番号 9340001026142 について、本店所在地や法人種別を教えてください。

使用ツール: `lookup_corporate_by_number`（MCP Apps 対応環境では `ui://corporate-card/mcp-app.html` を表示）

### UC-2: 法人名で検索

> 鹿児島県の「スグクル」を含む法人を検索してください。結果を一覧で表示してください。

使用ツール: `search_corporate_by_name` (`prefecture="46"`、MCP Apps 対応環境では `ui://search-results/mcp-app.html` を表示)

### UC-3: インボイス登録番号の取引日時点の有効確認

> 登録番号 T9340001026142 が 2026-10-01 時点で適格請求書発行事業者として有効な登録期間内にあるか確認してください。

使用ツール: `lookup_invoice_issuer`（※ホスト版 `https://houjin.mcp.sugu-kuru.co.jp/mcp` またはローカル `DATA_SOURCE=db` モードで利用可能。MCP Apps 対応環境では `ui://corporate-card/mcp-app.html` のインボイス確認カードを表示）

### UC-4: 会社名の表記揺れ正規化 → 検索

> 「（株）髙橋商事」という会社名から正規化候補を作って検索し、法人番号と本店所在地を教えてください。

使用ツール: `normalize_company_name` → `search_corporate_by_name`

### UC-5: チェックデジット検証（外部通信なし）

> 法人番号 9340001026142 は有効な番号ですか？チェックデジットだけローカルで確認してください。

使用ツール: `validate_corporate_number`

## セットアップ手順 / Setup

### 1. ホスト版（リモート Streamable HTTP）を利用する場合（推奨）

事前の API キー取得やローカルプロセス起動は不要で、全 5 ツール（`lookup_invoice_issuer` を含む）を利用できます。

- **Claude Desktop / ChatGPT**: アプリ内の「設定 → コネクタ」から `https://houjin.mcp.sugu-kuru.co.jp/mcp` をカスタムコネクタとして追加してください（`claude_desktop_config.json` で設定する場合は [`claude-desktop-config.json`](claude-desktop-config.json) の `mcp-remote` 設定を使用します）。
- **Claude Code**: `claude mcp add --transport http houjin-bangou https://houjin.mcp.sugu-kuru.co.jp/mcp`
- **Cursor**:

```json
{
  "mcpServers": {
    "houjin-bangou": {
      "type": "streamable-http",
      "url": "https://houjin.mcp.sugu-kuru.co.jp/mcp"
    }
  }
}
```

### 2. ローカル HTTP サーバー（セルフホスト）を利用する場合

1. 国税庁 法人番号 Web-API のアプリケーション ID を取得します（無料）:
   https://www.invoice-kohyo.nta.go.jp/web-api/pre-reg/
2. ローカル環境で HTTP サーバーを起動します（既定ポート: `3001`）:
   ```bash
   NTA_APPLICATION_ID="<あなたのアプリケーションID>" npx @sugukuru/mcp-houjin-bangou
   ```
   ※ `DATA_SOURCE=web-api`（既定）では UC-1, UC-2, UC-4, UC-5 が利用可能です（UC-3 のインボイス照会はホスト版または `DATA_SOURCE=db` が必要です）。
3. クライアント設定（`cursor-mcp.json` や `claude-desktop-config.json`）で以下を設定して再起動します:
   ```json
   {
     "mcpServers": {
       "houjin-bangou-local": {
         "type": "streamable-http",
         "url": "http://localhost:3001/mcp"
       }
     }
   }
   ```
