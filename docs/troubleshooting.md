# Troubleshooting / トラブルシューティング

## 起動・接続時エラー

### クライアント接続時にタイムアウト・ハングする（`"command": "npx"` を設定している）

**原因**: 本サーバーは **Streamable HTTP トランスポート専用** であり、stdio トランスポート（標準入出力による JSON-RPC 通信）には対応していません。`claude_desktop_config.json` 等に `"command": "npx", "args": ["-y", "@sugukuru/mcp-houjin-bangou"]` を記述すると、HTTP サーバーがポート `3001` で起動したまま stdio 応答を返し続けずタイムアウトします。

**対処**:

- **ホスト版を使う場合（推奨）**: Claude Desktop / ChatGPT はアプリ内の「設定 → コネクタ」から `https://houjin.mcp.sugu-kuru.co.jp/mcp` を追加、Claude Code / VS Code は `"type": "http"` + `"url"`、Cursor は `"type": "streamable-http"` + `"url"` を設定してください（`claude_desktop_config.json` で設定する場合は `"args": ["-y", "mcp-remote", "https://houjin.mcp.sugu-kuru.co.jp/mcp"]` を使用）。
- **ローカル実行版を使う場合**: 先に別ターミナルで `NTA_APPLICATION_ID="..." npx @sugukuru/mcp-houjin-bangou` を起動したうえで、`http://localhost:3001/mcp` を各クライアント形式で指定してください（[Getting Started](getting-started.md) 参照）。

### `Error: Invalid environment variables: NTA_APPLICATION_ID: Required`

**原因**: デフォルトの `DATA_SOURCE=web-api` モードで起動した際に `NTA_APPLICATION_ID` 環境変数が未設定。

**対処**:

- CLI: `NTA_APPLICATION_ID=xxx npx -y @sugukuru/mcp-houjin-bangou`
- `.env` ファイル: `cp .env.example .env` して `NTA_APPLICATION_ID`（または `DATA_SOURCE=db` と `DATABASE_URL`）を設定

### `EADDRINUSE: address already in use :::3001`

**原因**: ポート `3001` が既に使用中。

**対処**: `PORT=4000` 等で空きポートを指定し、クライアントの接続先 URL も合わせて変更してください。

---

## ツール実行・HTTP セキュリティエラー

### `lookup_invoice_issuer` が `DATA_UNAVAILABLE` を返す

> `[DATA_UNAVAILABLE] インボイス公表データプロバイダーが初期化されていません...`

**原因**: ローカルの `DATA_SOURCE=web-api` モードで起動している。本サーバーの適格請求書発行事業者照会（`lookup_invoice_issuer`）は公開ダウンロードデータを格納した PostgreSQL データベース（`DATA_SOURCE=db`）専用です。

**対処**:

- ホスト版エンドポイント（`https://houjin.mcp.sugu-kuru.co.jp/mcp`）に接続する、または
- ローカルで PostgreSQL 16 を用意し、取り込み CLI（`src/ingest/cli.ts`）でインボイス全件 CSV を投入したうえで `DATA_SOURCE=db DATABASE_URL=...` で起動してください。

### `HTTP 403 Forbidden: Origin not allowed`

**原因**: ブラウザベースのクライアントや MCP Inspector から `Origin` ヘッダー付きでアクセスした際、サーバー側の `ALLOWED_ORIGINS` にそのオリジンが含まれていない（`Origin` ヘッダーを持たない CLI / デスクトップ間通信は既定で許可されます）。

**対処**: セルフホスト環境でブラウザクライアントを許可する場合は、`ALLOWED_ORIGINS="https://claude.ai,https://chatgpt.com,http://localhost:5173"` のようにカンマ区切りで設定してください。

### `HTTP 429 Too Many Requests` / `RATE_LIMITED`

**原因**: 接続元 IP アドレスあたりのリクエスト上限（既定: 60秒間に60リクエスト）を超過した、またはリバースプロキシ配下で `TRUST_PROXY` 設定が合っておらず全クライアントが同一プロキシ IP としてカウントされている。

**対処**:

- レスポンスの `Retry-After` 秒数だけ待ってから再試行してください。
- 自社リバースプロキシ配下でセルフホストしている場合は、プロキシ段数に合わせて `TRUST_PROXY`（直結=`0`、プロキシ1段=`1`）を調整してください。

---

## 国税庁 Web-API エラー（`DATA_SOURCE=web-api` 時）

### 本番 ID が届いた後の最初の確認

```bash
NTA_APPLICATION_ID=your-id pnpm smoke:live
```

このコマンドは ID を画面に出力せず、実在する国税庁の法人番号 `7000012050002` で `/4/num` と `/4/name` の疎通を確認します。

### 国税庁 HTTP 403 (レート制限)

> `NtaApiError: Rate limited by NTA. Backoff 30000ms applied.`

**原因**: 国税庁側で短時間大量アクセスの制限に達した（利用規約 第9条第1項第三号）。

**対処**: 内蔵レートリミッターが自動的に 30秒 → 1分 → 5分 → 30分 の指数バックオフを適用します。複数プロセスで同一 `NTA_APPLICATION_ID` を共有していないか確認し、必要に応じて `NTA_RATE_LIMIT_RPS` を下げてください。

### 国税庁 HTTP 404 (アプリケーション ID 無効)

**原因**: `NTA_APPLICATION_ID` の誤入力、未登録、または 3 年間無利用による停止（第4条第5項）。

**対処**: ID の設定値を確認し、失効している場合は再申請してください（週次 keep-alive `.github/workflows/api-health-check.yml` で失効を防止できます）。

### 国税庁 HTTP 400 (検索結果過多)

**原因**: `search_corporate_by_name` で条件が広すぎ、国税庁 Web-API 側の上限を超えた。

**対処**:

- `prefecture` パラメータで都道府県コード（`'01'`〜`'47'`）を指定する
- `normalize_company_name` ツールを先に実行し、正規化された商号やコア商号で検索する

### タイムアウト

**対処**: `NTA_TIMEOUT_MS`（既定 `8000` ミリ秒）を増やすか、国税庁側のメンテナンス時間を確認してください。

---

## MCP ホスト連携・表記揺れ正規化

### Tool が MCP Host に表示されない

1. 設定ファイルの JSON 構文エラーがないか確認し、クライアントを完全に再起動する
2. `curl -sX POST http://localhost:3001/mcp -H "Accept: application/json, text/event-stream" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` で直接疎通を確認する
3. サーバーログを確認する（`LOG_LEVEL=debug` で詳細化。認証情報や入力クエリは自動マスク・非記録されます）

### 表記揺れが期待通りにヒットしない

1. まず `normalize_company_name`（引数: `raw_name`）を実行し、`normalized_name` と `search_query_optimized` を確認してください（ローカル Web-API 版の `search_corporate_by_name` 単体では `(株)` 展開や旧字体→新字体変換を行いません）。
2. ホスト版（`DATA_SOURCE=db`）では英数字・空白の半角/全角、主要旧字体⇔新字体、小書きカナ、ひらがな→カタカナ、および法人格略称・前後株の双方にマッチしますが、ローカル Web-API 版（`DATA_SOURCE=web-api`）は前方一致検索（`mode=1`, `target=1`）となるため、`normalized_name`（前株/後株を含む正式商号）と `search_query_optimized` の双方を試してください。

---

## それでも解決しない場合

1. [SECURITY.md](../SECURITY.md) に該当するセキュリティ上の問題は `info@sugu-kuru.co.jp` または GitHub Private Security Advisory へ
2. バグ報告・改善要望は [GitHub Issues](https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou/issues) へ投稿してください
