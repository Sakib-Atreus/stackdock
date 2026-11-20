# syntax=docker/dockerfile:1.7
# StackDock: one image with every project runtime (Node, Python, Go, PHP).
# Targets:
#   production  → the default (last stage): runtime + built app, prod deps only, non-root
#   test        → full source + dev deps, used to run the test suite on Linux

ARG NODE_IMAGE=node:24-trixie-slim
ARG GO_IMAGE=golang:1.27-trixie
ARG COMPOSER_IMAGE=composer:2

FROM ${GO_IMAGE} AS go
FROM ${COMPOSER_IMAGE} AS composer

# ── Runtimes that projects can use ────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime-base
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates git tini curl unzip \
      python3 python3-venv python3-pip \
      php-cli php-mbstring php-xml php-curl php-zip php-pgsql php-sqlite3 php-intl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=go /usr/local/go /usr/local/go
COPY --from=composer /usr/bin/composer /usr/local/bin/composer
ENV PATH=/usr/local/go/bin:$PATH
# yarn ships with the Node image; add pnpm.
RUN npm install -g pnpm@12.15.0 && npm cache clean --force && yarn --version

# ── Build StackDock ───────────────────────────────────────────────────────
FROM runtime-base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM build AS test
ENV NODE_ENV=test
CMD ["pnpm", "--filter", "@stackdock/api", "test"]

# ── Production ────────────────────────────────────────────────────────────
FROM runtime-base AS production
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIST_DIR=/app/apps/web/out \
    TRUST_PROXY=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
WORKDIR /app

# Production dependencies of the API and its workspace packages only.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
RUN pnpm install --prod --frozen-lockfile --filter "@stackdock/api..." \
 && pnpm store prune && rm -rf /root/.cache /root/.local/share/pnpm

# Built output only (no sources, tests or .env).
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/db/prisma packages/db/prisma
COPY --from=build /app/packages/db/prisma.config.ts packages/db/
COPY --from=build /app/apps/web/out apps/web/out
COPY docker-entrypoint.sh /usr/local/bin/stackdock-entrypoint

# Run as an unprivileged user; projects run as this user too.
RUN groupadd --gid 10001 stackdock \
 && useradd --uid 10001 --gid stackdock --create-home --shell /usr/sbin/nologin stackdock \
 && mkdir -p /data && chown stackdock:stackdock /data
USER stackdock

EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" > /dev/null || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "stackdock-entrypoint"]
