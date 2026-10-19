# Examples / 動作サンプル

## ファイル一覧

- `claude-desktop-config.json` - Claude Desktop 用の `mcpServers` 設定 + 動作サンプルプロンプト 5 件
- `cursor-mcp.json` - Cursor 用の `mcpServers` 設定

## 動作サンプルプロンプト (UC-1〜UC-5)

### UC-1: 法人番号で照会

> スグクル株式会社の法人番号 9340001026142 について、本店所在地や法人種別を教えてください。

使用ツール: `lookup_corporate_by_number`

### UC-2: 法人名で検索

> 鹿児島県の「スグクル」を含む法人を検索してください。結果を一覧で表示してください。

使用ツール: `search_corporate_by_name` (`prefecture="46"`)

### UC-3: インボイス登録番号の取引日時点の有効確認

> 登録番号 T1234567890123（※架空の番号例）が 2026-10-01 時点で適格請求書発行事業者として有効な登録期間内にあるか確認してください。

使用ツール: `lookup_invoice_issuer`

### UC-4: 会社名の表記揺れ正規化 → 検索

> 「（株）髙橋商事」という会社名から正規化候補を作って検索し、法人番号と本店所在地を教えてください。

使用ツール: `normalize_company_name` → `search_corporate_by_name`

### UC-5: チェックデジット検証（外部通信なし）

> 法人番号 9340001026142 は有効な番号ですか？チェックデジットだけローカルで確認してください。

使用ツール: `validate_corporate_number`

## セットアップ手順 / Setup

### 1. ホスト版（リモート Streamable HTTP）を利用する場合（推奨）

事前の API キー取得やローカルプロセス起動は不要です。各クライアントの設定ファイルに以下を追加して再起動してください。

```json
{
  "mcpServers": {
    "houjin-bangou": {
      "url": "https://houjin.mcp.sugu-kuru.co.jp/mcp"
    }
  }
}
```

### 2. ローカル HTTP サーバー（セルフホスト）を利用する場合

1. 国税庁 Web-API のアプリケーション ID を取得します（無料）:
   https://www.invoice-kohyo.nta.go.jp/web-api/pre-reg/
2. ローカル環境で HTTP サーバーを起動します（既定ポート: 3001）:
   ```bash
   NTA_APPLICATION_ID="<あなたのアプリケーションID>" npx @sugukuru/mcp-houjin-bangou
   ```
3. クライアント設定（`claude-desktop-config.json` や `cursor-mcp.json`）で以下を設定して再起動します:
   ```json
   {
     "mcpServers": {
       "houjin-bangou-local": {
         "url": "http://localhost:3001/mcp"
       }
     }
   }
   ```
4. 上記 UC-1〜UC-5 のプロンプトをお試しください。
