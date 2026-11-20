# Multi-stage Dockerfile for @sugukuru/mcp-houjin-bangou
# Service (node dist/server.js) and Jobs (node dist/db/migrate.js, node dist/ingest/cli.js)
# share the same image and switch entrypoint commands at runtime.

FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.34.7 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json vite.config.ts ./
COPY scripts ./scripts
COPY src ./src

RUN pnpm run build
RUN pnpm prune --prod

FROM node:22-bookworm-slim AS runner

LABEL org.opencontainers.image.title="@sugukuru/mcp-houjin-bangou" \
      org.opencontainers.image.description="MCP server for Japan's National Corporate Number and Qualified Invoice Issuer lookup" \
      org.opencontainers.image.source="https://github.com/SUGUKURU-CO-LTD/mcp-houjin-bangou" \
      org.opencontainers.image.vendor="SUGUKURU CO., LTD." \
      org.opencontainers.image.licenses="MIT"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder --chown=root:root /app/package.json ./package.json
COPY --from=builder --chown=root:root /app/node_modules ./node_modules
COPY --from=builder --chown=root:root /app/dist ./dist
COPY --chown=root:root drizzle ./drizzle

USER node

EXPOSE 8080

CMD ["node", "dist/server.js"]
