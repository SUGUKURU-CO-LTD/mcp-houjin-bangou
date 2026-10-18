# Multi-stage Dockerfile for @sugukuru/mcp-houjin-bangou
# Service (node dist/server.js) and Jobs (node dist/db/migrate.js, node dist/ingest/cli.js)
# share the same image and switch entrypoint commands at runtime.

FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json vite.config.ts ./
COPY scripts ./scripts
COPY src ./src

RUN pnpm run build
RUN pnpm prune --prod

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node drizzle ./drizzle

USER node

EXPOSE 8080

CMD ["node", "dist/server.js"]
