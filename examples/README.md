# Examples / 動作サンプル

## ファイル一覧

- `claude-desktop-config.json` - Claude Desktop 用の `mcpServers` 設定 + 動作サンプルプロンプト 5 件
- `cursor-mcp.json` - Cursor 用の設定

## 動作サンプルプロンプト (UC-1〜UC-5)

### UC-1: 法人番号で照会（インボイス状態併記）

> 株式会社スグクルの法人番号 5111101000006 について、本店所在地・法人種別・インボイス登録状況を教えてください。

使用ツール: `lookup_corporate_by_number`

### UC-2: 法人名で検索

> 鹿児島県の「スグクル」を含む法人を検索してください。結果を一覧で表示してください。

使用ツール: `search_corporate_by_name` (`prefecture_code="46"`)

### UC-3: インボイス登録番号の取引日時点の有効確認

> 登録番号 T5111101000006 が 2026-10-01 時点で適格請求書発行事業者として有効な登録期間内にあるか確認してください。

使用ツール: `lookup_invoice_issuer`

### UC-4: 会社名の表記揺れ正規化 → 検索

> 「（株）髙橋商事」という会社名から正規化候補を作って検索し、法人番号と本店所在地を教えてください。

使用ツール: `normalize_company_name` → `search_corporate_by_name`

### UC-5: チェックデジット検証（外部通信なし）

> 法人番号 5111101000006 は有効な番号ですか？チェックデジットだけローカルで確認してください。

使用ツール: `validate_corporate_number`

## セットアップ / Setup（ローカル Web-API モード）

1. 国税庁アプリケーション ID を取得: https://www.invoice-kohyo.nta.go.jp/web-api/pre-reg/
2. `claude-desktop-config.json` の `<YOUR_NTA_APPLICATION_ID...>` を取得した ID に置換
3. Claude Desktop の設定 (`~/Library/Application Support/Claude/claude_desktop_config.json`) にコピー
4. Claude Desktop を再起動
5. 上記 UC-1〜UC-5 のプロンプトを試す
