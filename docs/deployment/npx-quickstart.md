# npx Quickstart

最も簡単で推奨される起動方法です。`node_modules` も不要、`npm install` も不要。

## 前提

- Node.js 20.19.0 以上
- 国税庁アプリケーション ID ([getting-started.md](../getting-started.md) 参照)

## 起動

```bash
NTA_APPLICATION_ID=your-id npx -y @sugukuru/mcp-houjin-bangou
```

デフォルトでポート 3001 で起動します。

```
{"level":"info","time":"...","port":3001,"version":"1.0.0","mcpEndpoint":"http://localhost:3001/mcp","msg":"listening"}
```

## 起動確認 (smoke test)

別ターミナルで:

```bash
curl http://localhost:3001/health
# => {"status":"ok","version":"1.0.0","nta_api_version":"Ver.4.0",...}

curl http://localhost:3001/.well-known/mcp.json | head -c 200
# => {"name":"@sugukuru/mcp-houjin-bangou","version":"1.0.0",...
```

## Claude Desktop から接続

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "houjin-bangou": {
      "command": "npx",
      "args": ["-y", "@sugukuru/mcp-houjin-bangou"],
      "env": {
        "NTA_APPLICATION_ID": "your-id"
      }
    }
  }
}
```

**Windows の場合** (`%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "houjin-bangou": {
      "command": "npx.cmd",
      "args": ["-y", "@sugukuru/mcp-houjin-bangou"],
      "env": {
        "NTA_APPLICATION_ID": "your-id"
      }
    }
  }
}
```

## 環境変数

| 変数 | デフォルト | 説明 |
|---|---|---|
| `DATA_SOURCE` | `web-api` | データ取得元 (`web-api` または `db`) |
| `DATABASE_URL` | (なし) | `DATA_SOURCE=db` 時の PostgreSQL 接続文字列 |
| `NTA_APPLICATION_ID` | (web-api時必須) | 国税庁発行のアプリケーション ID |
| `NTA_BASE_URL` | `https://api.houjin-bangou.nta.go.jp/4` | API base URL (検証環境を使う場合に上書き) |
| `PORT` | `3001` | HTTP bind port |
| `LOG_LEVEL` | `info` | fatal/error/warn/info/debug/trace |
| `NODE_ENV` | `development` | development/test/production |
| `NTA_RATE_LIMIT_RPS` | `1` | NTA API の秒間リクエスト数 (保守的に 1 推奨) |
| `NTA_TIMEOUT_MS` | `8000` | API タイムアウト |

## アップグレード

`npx -y` は常に最新版を取得します。固定したい場合:

```bash
NTA_APPLICATION_ID=... npx -y @sugukuru/mcp-houjin-bangou@1.0.0
```
