# npx Quickstart

ローカル環境で `git clone` や事前ビルドを行わずに `@sugukuru/mcp-houjin-bangou` の HTTP サーバーを起動する手順です。

> [!TIP]
> **API キー取得やローカル起動なしで今すぐ全 5 ツール（インボイス照会を含む）を使いたい場合**は、ホスト版エンドポイント `https://houjin.mcp.sugu-kuru.co.jp/mcp` をクライアントに直接設定してください（[Getting Started](../getting-started.md) 参照）。

## 前提（ローカル Web-API モード）

- Node.js `20.19.0` 以上
- 国税庁 法人番号システム Web-API アプリケーション ID（[取得手順](../getting-started.md)）
- ※ ローカルの既定モード（`DATA_SOURCE=web-api`）では法人番号照会・検索・検証・社名正規化の 4 ツールが利用できます。`lookup_invoice_issuer` は PostgreSQL 公表データ（`DATA_SOURCE=db`）またはホスト版が必要です。

## ステップ 1: ローカル HTTP サーバーの起動

ターミナルを開き、以下のコマンドを実行します（既定でポート `3001` で待ち受けます）：

```bash
NTA_APPLICATION_ID="YOUR_APPLICATION_ID" npx -y @sugukuru/mcp-houjin-bangou
```

起動すると標準エラー出力（`stderr`）に以下のような構造化ログが出力されます：

```json
{"level":"info","severity":"INFO","time":"...","port":3001,"version":"1.1.0","mcpEndpoint":"http://localhost:3001/mcp","msg":"@sugukuru/mcp-houjin-bangou listening"}
```

## ステップ 2: 起動確認 (Smoke Check)

別ターミナルでヘルスチェックと Server Card を確認できます：

```bash
curl http://localhost:3001/health
# => {"status":"ok","version":"1.1.0","nta_api_version":"Ver.4.0",...}

curl http://localhost:3001/.well-known/mcp.json | head -c 200
# => {"name":"@sugukuru/mcp-houjin-bangou","version":"1.1.0",...
```

## ステップ 3: Claude Desktop / Cursor から接続

> [!IMPORTANT]
> 本サーバーは Streamable HTTP 専用です。クライアント設定に `"command": "npx"`（stdio 方式）を指定すると接続が完了しないため、上記ステップ 1 でサーバーを起動した状態で `"url": "http://localhost:3001/mcp"` を指定してください。

`~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）または `%APPDATA%\Claude\claude_desktop_config.json`（Windows）:

```json
{
  "mcpServers": {
    "houjin-bangou-local": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

Cursor（`.cursor/mcp.json` または `~/.cursor/mcp.json`）:

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

## 環境変数一覧

| 変数 | 既定値 | 説明 |
|---|---|---|
| `DATA_SOURCE` | `web-api` | データ取得元 (`web-api` または `db`) |
| `DATABASE_URL` | (なし) | `DATA_SOURCE=db` 時の PostgreSQL 接続文字列 |
| `NTA_APPLICATION_ID` | (`web-api` 時必須) | 国税庁発行の法人番号 Web-API アプリケーション ID |
| `NTA_BASE_URL` | `https://api.houjin-bangou.nta.go.jp/4` | 国税庁 Web-API ベース URL |
| `PORT` | `3001` | HTTP 待受ポート |
| `LOG_LEVEL` | `info` | `fatal` / `error` / `warn` / `info` / `debug` / `trace` |
| `NODE_ENV` | `development` | `development` / `test` / `production` |
| `NTA_RATE_LIMIT_RPS` | `1` | 国税庁 Web-API への秒間リクエスト数上限 |
| `NTA_TIMEOUT_MS` | `8000` | 国税庁 Web-API タイムアウト（ミリ秒） |
| `ALLOWED_ORIGINS` | `''` | カンマ区切りの許可 `Origin` 一覧（ブラウザ経由アクセス制御） |
| `TRUST_PROXY` | `1` | Express `trust proxy` ホップ数（直結時は `0`） |
| `RATE_LIMIT_WINDOW_MS` | `60000` | IP 単位レート制限ウィンドウ（ミリ秒） |
| `RATE_LIMIT_MAX_REQUESTS` | `60` | ウィンドウあたりの 1 IP 最大リクエスト数 |
| `OPENAI_APPS_CHALLENGE_TOKEN` | `''` | ChatGPT Apps ドメイン確認トークン（未設定時は `404`） |

## バージョン固定

`npx -y` は既定で公開済みの最新版を取得します。特定のバージョンに固定する場合：

```bash
NTA_APPLICATION_ID="YOUR_APPLICATION_ID" npx -y @sugukuru/mcp-houjin-bangou@1.1.0
```
