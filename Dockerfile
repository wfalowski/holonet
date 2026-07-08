# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
RUN corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app

# ---- deps + build -----------------------------------------------------
FROM base AS build
# better-sqlite3 needs a native build toolchain
RUN apk add --no-cache python3 make g++

# Workspace manifests first so `pnpm install` is cached across source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN corepack prepare "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")" --activate
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- prod-only dependency set for the server ---------------------------
FROM build AS deploy
RUN pnpm --filter @holonet/server deploy --prod --legacy /out

# ---- runtime -------------------------------------------------------------
FROM node:22-alpine AS runtime
RUN apk add --no-cache wget
WORKDIR /app

COPY --from=deploy /out/node_modules ./node_modules
COPY --from=deploy /out/package.json ./package.json
# `pnpm deploy` follows gitignore-style file selection (no "files" field in
# apps/server/package.json), and apps/server/.gitignore ignores dist/, so the
# compiled server would be dropped from /out. Copy it straight from the build
# stage instead. index.ts resolves migrations as "../drizzle" relative to
# dist/index.js, so drizzle/ must stay a sibling of dist/.
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/server/drizzle ./drizzle
COPY --from=build /app/apps/web/dist ./public

ENV NODE_ENV=production \
    STATIC_DIR=/app/public \
    DATABASE_PATH=/data/holonet.db \
    PORT=3000

RUN mkdir -p /data && chown -R node:node /data /app

USER node
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "dist/index.js"]
