# Docker 構成ガイド

本ドキュメントは `@sugukuru/mcp-houjin-bangou` をコンテナ環境で実行する際の設計メモです。

## イメージ名（例）

`ghcr.io/sugukuru-co-ltd/mcp-houjin-bangou:v1.0.0`

## Dockerfile 設計方針

- **Distroless multi-stage build** (`gcr.io/distroless/nodejs20-debian12:nonroot`)
- 非 root ユーザで実行
- 最終イメージサイズ < 150MB 目標
- `pnpm deploy` で本番依存のみを bundle

## Dockerfile 例

```dockerfile
# Stage 1: build
FROM node:20.19.0-slim AS build
WORKDIR /build
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm deploy --prod /app

# Stage 2: runtime (distroless)
FROM gcr.io/distroless/nodejs20-debian12:nonroot
WORKDIR /app
COPY --from=build --chown=nonroot:nonroot /app /app
USER nonroot
EXPOSE 3001
ENV NODE_ENV=production
CMD ["dist/server.js"]
```

## 実行

```bash
docker run --rm -p 3001:3001 \
  -e NTA_APPLICATION_ID=your-id \
  ghcr.io/sugukuru-co-ltd/mcp-houjin-bangou:v1.0.0
```

## Health check

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -q -O- http://localhost:3001/health || exit 1
```

## 本番環境への展開

データベースの権限分離およびセルフホスティング運用については、[db-roles.md](db-roles.md) および [self-hosting.md](self-hosting.md) を参照してください。
