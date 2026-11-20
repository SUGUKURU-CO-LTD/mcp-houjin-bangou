# Docker 構成ガイド

本ドキュメントは、リポジトリルートの [`Dockerfile`](../../Dockerfile) を用いて `@sugukuru/mcp-houjin-bangou` をコンテナ環境でビルド・実行する手順を説明します。

## Dockerfile の構成方針

ルートの [`Dockerfile`](../../Dockerfile) は、Cloud Run サービスおよびバッチジョブで同一イメージを共有するマルチステージ構成を採用しています：

- **ベースイメージ**: `node:22-bookworm-slim`（マルチステージ `builder` / `runner`）
- **ビルド工程**: `corepack` で `pnpm@10.34.7` を有効化し、`pnpm install --frozen-lockfile` → `pnpm run build`（サーバー本体 + MCP Apps Single-File UI + SHA-256 CSP ハッシュ注入）→ `pnpm prune --prod` を実行
- **非 root 実行**: `USER node` で実行し、`dist/`・本番 `node_modules/`・`drizzle/` マイグレーション SQL のみをランタイムイメージに同梱
- **既定ポート**: コンテナ内 `ENV PORT=8080`（`EXPOSE 8080`）
- **単一イメージ・マルチエントリポイント**:
  - MCP HTTP サーバー（既定 `CMD`）: `node dist/server.js`
  - DB マイグレーションジョブ: `node dist/db/migrate.js`
  - 月次 CSV 取り込みジョブ: `node dist/ingest/cli.js --type <corporate|invoice> --dir <PATH> --data-as-of <YYYY-MM-DD>`

## イメージのビルド

```bash
docker build -t mcp-houjin-bangou:v1.0.2 .
```

## 実行例

### 1. ローカル Web-API モードで起動（ホスト側ポート `3001` → コンテナ `8080`）

```bash
docker run --rm -p 3001:8080 \
  -e DATA_SOURCE=web-api \
  -e NTA_APPLICATION_ID="YOUR_APPLICATION_ID" \
  mcp-houjin-bangou:v1.0.2
```

※ `DATA_SOURCE=web-api` モードでは法人番号ツールが動作します（`lookup_invoice_issuer` を使用する場合は下記の PostgreSQL `db` モードを使用してください）。

### 2. PostgreSQL DB モードで起動（全 5 ツール対応）

```bash
docker run --rm -p 3001:8080 \
  -e DATA_SOURCE=db \
  -e DATABASE_URL="postgresql://houjin_reader:PASSWORD@host.docker.internal:5432/corp_check" \
  -e ALLOWED_ORIGINS="https://claude.ai,https://chatgpt.com" \
  mcp-houjin-bangou:v1.0.2
```

## ヘルスチェック確認

```bash
curl -fsS http://localhost:3001/health
# => {"status":"ok","version":"1.0.2","nta_api_version":"Ver.4.0",...}
```

## 本番環境への展開

- PostgreSQL 3 ロール最小権限分離の手順: [`db-roles.md`](db-roles.md)
- Google Cloud Run / Cloud SQL ホスト版の本番運用手順: [`hosted.md`](hosted.md)
- Linux / systemd / nginx でのセルフホスト運用手順: [`self-hosting.md`](self-hosting.md)
