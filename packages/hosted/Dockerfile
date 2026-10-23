# syntax=docker/dockerfile:1
#
# The hosted game server's image (milestone 13, docs/design/m13-hosted-server.md 10.1; package M13-14). Built from the repository root:
#
#   docker build -f packages/hosted/Dockerfile -t openmtg-hosted .
#
# - Node 24 LTS, slim. The dependencies are installed inside the image build (never in a working copy of the repository), from the lockfile, for the
#   five packages the server runs (hosted, accounts, cards, engine, net) and the root's TypeScript loader (tsx); no install scripts run.
# - It runs as the image's non-root user `node`, on a read-only root file system (the compose file sets it): only DATA_DIR (/data) and /tmp are
#   written. The card index (Scryfall-derived data) is mounted at run time at CARD_DATA_DIR (/cards); it is not in the repository and no card image is
#   ever bundled.
# - Nothing secret is in the image: DATABASE_URL, LEDGER_SECRET and METRICS_TOKEN come from the environment at run time (.env.example).
# - SIGTERM drains (running games finish, at most DRAIN_MAX_MINUTES), so `docker stop` needs a long timeout: `docker stop -t 15000` or the compose
#   file's `stop_grace_period`.

ARG NODE_IMAGE=node:24-bookworm-slim

# ---- dependencies
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV npm_config_fund=false npm_config_audit=false npm_config_update_notifier=false
COPY package.json package-lock.json ./
COPY packages/accounts/package.json packages/accounts/
COPY packages/ai/package.json packages/ai/
COPY packages/cards/package.json packages/cards/
COPY packages/client/package.json packages/client/
COPY packages/desktop/package.json packages/desktop/
COPY packages/engine/package.json packages/engine/
COPY packages/hosted/package.json packages/hosted/
COPY packages/ladder/package.json packages/ladder/
COPY packages/net/package.json packages/net/
COPY packages/server/package.json packages/server/
RUN npm ci --ignore-scripts --include-workspace-root \
      -w @openmtg/hosted -w @openmtg/accounts -w @openmtg/cards -w @openmtg/engine -w @openmtg/net

# ---- the server
FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    BIND=0.0.0.0 \
    STORE=postgres \
    DATA_DIR=/data \
    CARD_DATA_DIR=/cards \
    METRICS_PORT=9464 \
    TSX_TSCONFIG_PATH=/app/packages/hosted/tsconfig.json
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig*.json ./
COPY packages/hosted/package.json packages/hosted/tsconfig.json packages/hosted/
COPY packages/hosted/src packages/hosted/src
COPY packages/hosted/migrations packages/hosted/migrations
COPY packages/accounts packages/accounts
COPY packages/cards/package.json packages/cards/
COPY packages/cards/src packages/cards/src
COPY packages/engine/package.json packages/engine/
COPY packages/engine/src packages/engine/src
COPY packages/net/package.json packages/net/
COPY packages/net/src packages/net/src
RUN mkdir -p /data /cards && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787 9464
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 CMD ["node", "packages/hosted/src/obs/probe.mjs", "healthz"]
CMD ["node", "--import", "tsx", "packages/hosted/src/main.ts"]
