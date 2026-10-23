# Running the hosted game server

Operator notes for `@openmtg/hosted`, the DigiDice game server (milestone 13; design: the private archive's `docs/design/m13-hosted-server.md`,
sections 10 and 11). **Nothing here is public before milestone 16's legal gate**: no server is rented before the launch (owner answer 1), and
everything below runs on the owner's machine.

Contents: [Without Docker](#without-docker) · [The development stack](#the-development-stack) · [Configuration](#configuration) ·
[The database roles](#the-database-roles) · [Migrations](#migrations) · [Starting, draining, stopping](#starting-draining-stopping) ·
[Health and metrics](#health-and-metrics) · [Logs](#logs) · [Operator commands](#operator-commands) · [Retention and backups](#retention-and-backups) ·
[Connecting the game app](#connecting-the-game-app)

## Without Docker

For everyday development and the tests: the file store, bound to 127.0.0.1.

```
npm run cards -- refresh          # once: the card index (.cache/scryfall), which the server needs to check decks
npm run hosted                    # STORE=file, DATA_DIR=./data (git-ignored), ws://127.0.0.1:8787/ws
```

Every setting comes from the environment (the table below). A file store belongs to one process: the server takes a run lock in `DATA_DIR`, and the
operator commands that open the store refuse while it is held ("stop the server, or use PostgreSQL").

## The development stack

`packages/hosted/docker-compose.dev.yml`: Caddy (TLS with a local certificate), the server's image and PostgreSQL 16, each with a volume. Only
Caddy's port is published, on 127.0.0.1 only; the gateway, the metrics listener and the database stay on the compose network.

```
cp packages/hosted/.env.example packages/hosted/.env     # fill in the four secrets: openssl rand -hex 32 (the two passwords may be any text)
docker compose -f packages/hosted/docker-compose.dev.yml --env-file packages/hosted/.env up -d --build postgres
# the schema, once and after every update (see Migrations)
docker compose -f packages/hosted/docker-compose.dev.yml --env-file packages/hosted/.env run --rm \
  -e DATABASE_URL="postgres://openmtg_owner:<POSTGRES_PASSWORD>@postgres:5432/openmtg" hosted \
  node --import tsx packages/hosted/src/ops/main.ts migrate --grant openmtg_service
docker compose -f packages/hosted/docker-compose.dev.yml --env-file packages/hosted/.env up -d --build
```

The game app then connects to `wss://localhost:8443/ws` (start it with `--hosted-url https://localhost:8443`). The browser must trust Caddy's
local certificate authority once (`docker compose ... exec caddy caddy trust` prints where it is), or use the desktop app.

The image (`packages/hosted/Dockerfile`): Node 24 slim, the five packages the server runs and their locked dependencies, installed in the image build
with no install scripts; it runs as the non-root user `node`, read-only except `/data` and `/tmp`; the card index is mounted at `/cards`, never
copied in. `HEALTHCHECK` is `/healthz`; the compose file waits for `/readyz`.

## Configuration

Validated at start: a value that is not valid stops the start with a message that names the variable (never a secret's value). The server logs the
configuration it runs with at start, secrets as `(set)` or `(unset)`. `packages/hosted/.env.example` lists every variable.

| Variable | Default | What it does |
|---|---|---|
| `PORT`, `BIND` | 8787, 127.0.0.1 | The gateway's listener (`/ws`, `/healthz`, `/readyz`). Outside a container keep the loopback. |
| `TRUST_PROXY` | unset | The reverse proxy's address: when set, every other TCP peer is refused, and the client's address is read from the proxy's header. |
| `PUBLIC_ORIGINS` | none | The exact `https://` origins of pages that may open a socket (comma separated). |
| `ALLOW_DESKTOP_ORIGINS` | true | The desktop app's local pages may connect too. |
| `STORE` | file (image: postgres) | `memory` (tests), `file` (one process), `postgres`. |
| `DATABASE_URL` | none | `postgres://...` of the **service** role (secret). |
| `DATA_DIR` | `data` (image: `/data`) | The file store, its run lock, the hide file. |
| `CARD_DATA_DIR` | the cards package's cache | The card index (`cards.jsonl`, `tokens.jsonl`). |
| `WORKERS`, `DECK_WORKERS` | cores - 1, 1 | Game workers and deck workers. |
| `CAPACITY_UNITS`, `CAPACITY_QUEUE_MAX`, `CAPACITY_WAIT_MAX_MINUTES` | 900, 300, 20 | Capacity admission: above the soft limit new starts wait in line; a full line answers "server busy". `CAPACITY_UNITS=1` shows the line at once. |
| `UNITS_1V1`, `UNITS_POD3`, `UNITS_POD4` | 1, 4, 5 | A game's weight in capacity units. |
| `MAX_CONNECTIONS`, `MAX_LOBBY`, `MAX_LISTED`, `MAX_LOBBY_WATCHERS`, `SESSION_RATE`, `OUTBOUND_BUDGET_MB` | 5000, 400, 300, 2000, 200, 256 | Global limits. |
| `PODS_ENABLED`, `POD_THREE_AFTER_SECONDS` | false, 90 | 3-4 player tables and pod matchmaking. |
| `HOSTED_FORMATS`, `CLOCK_DEFAULTS` | all formats, 15/20 min | The formats offered (comma separated ids) and the clocks (JSON: `{"1v1": {"bankMs": ..., "delayMs": ..., "dropMs": ...}, "pod": {...}}`). |
| `RETENTION_*_DAYS` | 90, 7, 90, 30, 14 | Game logs, unstarted tables, void games, sessions, server logs (see Retention). |
| `DRAIN_MAX_MINUTES` | 250 | The longest a drain waits for running games. |
| `MODERATION_WORDS_FILE` | built-in list | The word filter for names and titles (one entry a line; `=word` the whole text, `!word` an exception, `#` a comment). |
| `LOG_LEVEL` | info | `debug`, `info`, `warn`, `error`. |
| `METRICS_PORT`, `METRICS_TOKEN` | unset | The metrics listener and its bearer token (secret, 64 hex digits). |
| `LEDGER_SECRET` | unset | The key of the deck fingerprints in the results (secret, 64 hex digits; required with PostgreSQL). |

**Secrets** (`DATABASE_URL`, `METRICS_TOKEN`, `LEDGER_SECRET`, and the compose stack's two passwords) come from the environment or a secret store only.
They are never committed, never in the image, and never logged: the logger replaces their exact values, tokens, invite codes and URL passwords with
`[redacted]` wherever they appear.

## The database roles

Two roles: the **owner** owns the schema and is used only by `ops migrate`; the **service** role is what the server connects as. It may read and
write the game tables, only add to the results ledger (`results`, `placements`), and never change the schema. The development stack makes
`openmtg_service` at the database's first start (`packages/hosted/deploy/postgres-init.sh`); on another database:

```sql
CREATE ROLE openmtg_service LOGIN PASSWORD '...' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT CONNECT ON DATABASE openmtg TO openmtg_service;
```

## Migrations

```
DATABASE_URL=<the OWNER's postgres:// URL> npx tsx packages/hosted/src/ops/main.ts migrate --grant openmtg_service
```

Applies the accounts package's migrations, then hosted's, each once, and gives the service role its rights. The server itself only checks the
schema's version at start and refuses to run on a schema it does not know. Run it again after every update; it says "already current" when there is
nothing to do.

## Starting, draining, stopping

- **SIGTERM drains**: no new games start (players are told), running games are played to their end (at most `DRAIN_MAX_MINUTES`), then the
  process stops. The compose file's `stop_grace_period` is 4 hours for that reason. A second SIGTERM or SIGINT during a drain stops at once.
- **SIGINT stops at once.** Running games are kept in the store and recovered at the next start (replayed under the same engine build; under
  another build a game whose checkpoints differ is voided).
- An update: drain, update, migrate, start.

## Health and metrics

- `/healthz` on the gateway's port: the process and its main event loop answer.
- `/readyz`: storage reachable, every worker answers within 1 s, not draining.
- `/metrics` on `METRICS_PORT`, Prometheus text format, every request with `Authorization: Bearer <METRICS_TOKEN>`. Never published, never
  proxied: scrape it from the container network.
- `node packages/hosted/src/obs/probe.mjs healthz|readyz|metrics [--print]` checks any of them from inside the container (exit 0 on 200).

## Logs

One JSON object per line on stdout: time, level, event, and the game, seat, action type and durations where they apply. Never a card in a hidden
zone, a decklist, a token, a password, an invite code or chat text; client addresses only in connection events. Keep them `RETENTION_SERVER_LOG_DAYS`
(14) days; with Docker: `docker compose ... logs hosted`.

## Operator commands

Run on the server's machine (in the container: `docker compose ... exec hosted ...`), never over the network:

| Command | What it does |
|---|---|
| `npx tsx packages/hosted/src/ops/main.ts check` | Validates the environment as the server does, looks at the files it names, prints the configuration (secrets hidden). |
| `... ops/main.ts migrate [--grant <role>]` | See Migrations. |
| `... ops/main.ts purge` | Deletes what the retention policy lets go (stop a file-store server first). |
| `... ops/main.ts hide <table>` / `unhide <table>` | Hides a listed table and its title from the lobby for 24 hours, or lists it again (a line in `DATA_DIR/hidden-tables.jsonl`, read within a few seconds). |
| `npm run hosted -w @openmtg/hosted -- inbox [list]` | The bug inbox: new reports (`--status`, `--kind bug|title`, `--since 7d`). |
| `... inbox show <id>` | One report in full (marks it read unless `--keep`). |
| `... inbox read|close|reopen <id>` | A report's status. |
| `... inbox export <id> [--out <file>]` | A hosted game's report as a bug report file for `npm run bug -- replay <file>`. |

## Retention and backups

`ops purge` (run it daily) deletes game logs after 90 days, unstarted tables after 7, void games after 90 and sessions after 30; the results ledger is
kept. Back up the PostgreSQL volume with `pg_dump` (milestone 16 adds point-in-time restore on a managed database). The file store is for
development only.

## Connecting the game app

The game app shows "Play on the DigiDice server" only when it is started with a server address: `--hosted-url <https origin>` or
`OPENMTG_HOSTED_URL`. Its page then allows exactly that origin in its Content-Security-Policy.
