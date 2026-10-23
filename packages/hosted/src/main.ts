/**
 * The hosted server process (design 2.1, 10; package M13-6 wiring): configuration, store, runtime (game workers, deck pool, recovery), gateway and
 * tables, the HTTP server (`/ws`, `/healthz`, `/readyz`) and the metrics listener; SIGTERM drains (design 2.3), SIGINT stops.
 *
 *   npm run hosted                        (STORE=file, DATA_DIR=data, BIND=127.0.0.1 by default: config.ts, docs/ops/hosted.md)
 *
 * M13-14: the retention purge runs on its own once a day (ops/purge.ts `startPurgeSchedule`; the first run 10 minutes after the start), with the file and
 * PostgreSQL stores; `ops purge` runs it by hand.
 *
 * Nothing here is public before milestone 16's legal gate (D17): the server binds 127.0.0.1 unless configured otherwise.
 */
import { mkdir } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Admission } from './admission/api';
import { admissionLimitsOf, CapacityAdmission } from './admission/index';
import { HOSTED_TIMING } from './api';
import { clockFor, describeConfig, parseConfig, type HostedConfig } from './config';
import { Gateway, type GatewayOptions } from './gateway/gateway';
import type { GatewayHooks } from './gateway/hooks';
import { createMetricsServer, PrometheusMetrics } from './gateway/metrics';
import { createGatewayServer } from './gateway/server';
import { ReportIntake } from './inbox/intake';
import { takeRunLock } from './inbox/lock';
import { ledgerSecret } from './ledger/fingerprint';
import { MatchAdmission, MatchmakingService } from './match/service';
import { LobbyBrowser } from './lobby/browser';
import { ScryptPasswords } from './lobby/passwords';
import { hideFileOf, HideList } from './moderation/hidden';
import { moderationFromFile } from './moderation/words';
import { StdoutLogger, type Logger, type Metrics } from './obs';
import { startPurgeSchedule, type PurgeSchedule } from './ops/purge';
import { GameRuntime } from './runtime/runtime';
import type { CardSourceSpec, DrainReport, RecoveryReport, RuntimeEvents, RuntimeTuning } from './runtime/api';
import { openStore } from './store/index';
import type { GameStore } from './store/api';
import { StoreTableDirectory } from './tables/directory';
import type { TableLimits } from './table/limits';

/** M13-14: the process's logger is obs/logger.ts's (redacted, scrubbed of the environment's secrets, escaped); re-exported where M13-6 had its own. */
export { StdoutLogger };

export interface StartOptions {
  /** The environment (config.ts `parseConfig`). */
  env: Readonly<Record<string, string | undefined>>;
  /**
   * Tests: listen on this port instead of PORT (0: any free port); the metrics listener likewise. M13-6 INTERFACE CHANGE (additive): `null` opens no
   * listener at all (the gateway is driven through its in-process transport and the servers' request handlers are called directly).
   */
  listenPort?: number | null;
  metricsListenPort?: number | null;
  /** Tests: the deck workers' card source, a store, a logger, metrics, the engine build, admission, shorter timings, table limits, runtime tuning. */
  cards?: CardSourceSpec;
  store?: GameStore;
  logger?: Logger;
  metrics?: Metrics;
  engineBuild?: string;
  admission?: Admission;
  timing?: GatewayOptions['timing'];
  tableLimits?: Partial<TableLimits>;
  tuning?: Partial<RuntimeTuning>;
}

export interface HostedServer {
  config: HostedConfig;
  /** The gateway's port (the real one when `listenPort` was 0; 0 when it was null). */
  port: number;
  metricsPort: number | null;
  gateway: Gateway;
  /** M13-8 INTERFACE CHANGE (additive): the lobby browser (listings, live updates, the admin hide) and the reader of the admin hide command's file (null: none). */
  lobby: LobbyBrowser;
  hidden: HideList | null;
  runtime: GameRuntime;
  store: GameStore;
  recovery: RecoveryReport;
  /**
   * M13-6 INTERFACE CHANGE (additive): the gateway's HTTP server and the metrics server (null without a metrics port), so that tests call their request
   * handlers in process (`server.emit('request', ...)`) instead of opening a socket.
   */
  http: Server;
  metricsHttp: Server | null;
  /** Drain (SIGTERM): no new games; running ones go on until they end (at most DRAIN_MAX_MINUTES). */
  drain(): Promise<DrainReport>;
  /** Stops everything (running games stay 'running' in the store: the next start recovers them). */
  close(): Promise<void>;
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolveListen((server.address() as AddressInfo).port);
    });
  });
}

function closeServer(server: Server | null): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((r) => {
    server.close(() => r());
    server.closeAllConnections?.();
  });
}

/** Starts the hosted server. Throws on a configuration error (every problem listed) or when the store cannot be opened. */
export async function startHosted(o: StartOptions): Promise<HostedServer> {
  const parsed = parseConfig(o.env, { cpus: availableParallelism() });
  if (!parsed.ok) throw new Error(`Configuration errors:\n${parsed.errors.map((e) => `  - ${e}`).join('\n')}`);
  const config = parsed.config;
  const logger = o.logger ?? new StdoutLogger(config.logLevel);
  for (const w of parsed.warnings) logger.log('warn', 'configWarning', { detail: w });
  logger.log('info', 'config', Object.fromEntries(Object.entries(describeConfig(config)).map(([k, v]) => [k, typeof v === 'object' && v !== null ? JSON.stringify(v) : (v as string | number | boolean | null)])));
  const prometheus = new PrometheusMetrics(config.workers);
  const metrics = o.metrics ?? prometheus;
  const secret = ledgerSecret(config.ledgerSecret);
  if (secret.ephemeral) logger.log('warn', 'ledgerSecretEphemeral', { detail: 'LEDGER_SECRET is not set: deck fingerprints compare only within this run.' });
  // M13-8: the word filter's list is read before anything starts (a list that is named and cannot be read stops the start)
  const moderation = await moderationFromFile(config.moderationWordsFile);
  const dataDir = resolve(config.dataDir);
  if (config.store === 'file') await mkdir(dataDir, { recursive: true });
  // M13-13: the file store is one process's; the owner's inbox command (cli.ts) refuses a data directory a live server holds (inbox/lock.ts).
  const runLock = config.store === 'file' && !o.store ? await takeRunLock(dataDir) : null;
  if (runLock?.takenOver) logger.log('warn', 'runLockTakenOver', { detail: 'The lock of a process that is gone was taken over.' });
  let store: GameStore;
  try {
    store = o.store ?? (await openStore({ kind: config.store, dataDir, databaseUrl: config.databaseUrl }));
  } catch (e) {
    await runLock?.release();
    throw e;
  }

  // The runtime's events go to the gateway, which exists only after the runtime (it needs the runtime): nobody is connected before it anyway.
  let gateway: Gateway | null = null;
  let matchService: MatchmakingService | null = null;
  const events: RuntimeEvents = {
    // M13-13: a matched game's first deliveries come inside its start, before its seats have their routes: the match service keeps them until then
    deliver: (game, sends) => {
      if (!matchService?.intercept(game, sends)) gateway?.events.deliver(game, sends);
    },
    ended: (e) => gateway?.events.ended?.(e),
    unloaded: (game) => gateway?.events.unloaded?.(game),
  };
  const runtime = new GameRuntime({
    store,
    events,
    directory: new StoreTableDirectory(store, { clock: (f, s) => clockFor(config.clocks, f, s), ...(o.tableLimits ? { limits: o.tableLimits } : {}) }),
    workers: config.workers,
    deckWorkers: config.deckWorkers,
    ...(o.cards ? { cards: o.cards } : {}),
    cardDataDir: config.cardDataDir,
    ...(o.engineBuild ? { engineBuild: o.engineBuild } : {}),
    logger,
    metrics,
    outbound: () => gateway?.outbound() ?? 0,
    pendingVoidsFile: config.store === 'memory' && !o.store ? null : join(dataDir, 'pending-voids.json'),
    tuning: { drainMaxMinutes: config.drainMaxMinutes, ...o.tuning },
    units: config.units, // M13-10: running games counted with the weights admission reserves with
  });
  let recovery: RecoveryReport;
  try {
    recovery = await runtime.open();
  } catch (e) {
    await runtime.close().catch(() => undefined);
    if (!o.store) await store.close().catch(() => undefined);
    await runLock?.release();
    throw e;
  }
  // M13-10: the capacity queue (design 4.6) on the runtime's signals; events a withdraw or begun produce go to the tables at once.
  // M13-13: the matched tables' events go to the match service, the others to the tables (match/service.ts `MatchAdmission`).
  const admission: MatchAdmission = new MatchAdmission(o.admission ?? new CapacityAdmission({
    signals: runtime, limits: admissionLimitsOf(config), metrics, logger, onEvents: (e) => admission.dispatch(e, (others) => gateway?.tables.admissionEvents(others)),
  }));
  // M13-13: quick match (the gateway's `MatchService`, design 4.5) on the matcher, admission and the tables layer.
  const match = new MatchmakingService({
    config, store, runtime, admission, ledgerSecret: secret.secret, logger, metrics,
    tables: {
      busyIn: (session) => gateway?.tables.busyIn(session) ?? null,
      adopt: (game) => gateway?.tables.adopt(game) ?? Promise.resolve(false),
      connected: (session) => gateway?.tables.connected(session),
      disconnected: (session) => gateway?.tables.disconnected(session),
    },
    deliver: (game, sends) => gateway?.events.deliver(game, sends),
    foreign: (e) => gateway?.tables.admissionEvents(e),
    timing: { readyCheckMs: o.timing?.readyCheckMatchMs ?? HOSTED_TIMING.readyCheckMatchMs, queueStatusEveryMs: o.timing?.queueStatusEveryMs ?? HOSTED_TIMING.queueStatusEveryMs },
  });
  admission.owner = match;
  matchService = match;
  // M13-8: the lobby browser is the gateway's `lobby` service and the tables layer's listing sink (`restore` below reports the tables a restart leaves),
  // table passwords are scrypt, names and titles go through the word filter; the admin hide command arrives as a line in DATA_DIR's file.
  const lobby = new LobbyBrowser({ maxWatchers: config.maxLobbyWatchers, source: () => gateway?.tables.listings() ?? [], logger, metrics });
  const hidden = config.store === 'memory' && !o.store ? null : new HideList({ file: hideFileOf(dataDir), lobby, logger });
  // The gateway's seams for the packages that build on it (gateway/hooks.ts). M13-13: reports go to the bug inbox; a title report names a listed table.
  const hooks: GatewayHooks = {
    match,
    lobby,
    reports: new ReportIntake({
      store, logger, metrics,
      titleOf: (table) => {
        const v = gateway?.tables.viewFor(table, null);
        return v && v.source === 'listed' ? { title: v.title, creator: v.creator === null ? null : (v.seats[v.creator - 1]?.name ?? null) } : null;
      },
    }),
  };
  const gw = new Gateway({
    config, store, runtime, admission, ledgerSecret: secret.secret, engineBuild: runtime.engineBuild, logger, metrics, hooks,
    passwords: new ScryptPasswords(), moderation, listings: lobby,
    ...(o.timing ? { timing: o.timing } : {}), ...(o.tableLimits ? { tableLimits: o.tableLimits } : {}),
  });
  gateway = gw;
  let http: ReturnType<typeof createGatewayServer> | null = null;
  let metricsServer: Server | null = null;
  let purge: PurgeSchedule | null = null;
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    purge?.stop();
    match.stop();
    lobby.stop();
    hidden?.stop();
    gw.close();
    http?.wss.close();
    await Promise.all([closeServer(http?.server ?? null), closeServer(metricsServer)]);
    await runtime.close();
    if (!o.store) await store.close();
    await runLock?.release();
    logger.log('info', 'stopped', {});
  };
  // Whatever fails from here until the listeners are up (the store, a port in use) stops what already runs: the workers, the store, the timer.
  try {
    for (const game of recovery.recovered) {
      if (!(await gw.tables.adopt(game))) logger.log('warn', 'adoptFailed', { game });
    }
    const restored = await gw.tables.restore();
    logger.log('info', 'recovered', { games: recovery.recovered.length, voided: recovery.voided.length, tables: restored });
    gw.start();
    match.start();
    lobby.start();
    await hidden?.start();
    // the memory store holds nothing past the process, so it has nothing to purge
    if (config.store !== 'memory') purge = startPurgeSchedule({ store, retention: config.retention, logger });

    http = createGatewayServer({
      gateway: gw,
      ready: () => {
        const r = runtime.ready();
        const reasons: string[] = [...r.reasons];
        if (gw.draining && !reasons.includes('draining')) reasons.push('draining');
        return { ok: reasons.length === 0, reasons };
      },
    });
    const port = o.listenPort === null ? 0 : await listen(http.server, o.listenPort ?? config.port, config.bind);
    let metricsPort: number | null = null;
    if (config.metricsPort !== null && config.metricsToken !== null) {
      metricsServer = createMetricsServer(prometheus, config.metricsToken);
      if (o.metricsListenPort !== null) metricsPort = await listen(metricsServer, o.metricsListenPort ?? config.metricsPort, config.bind);
    }
    logger.log('info', 'listening', { port, bind: config.bind, metricsPort });
    return {
      config, port, metricsPort, gateway: gw, lobby, hidden, runtime, store, recovery, http: http.server, metricsHttp: metricsServer,
      drain: async () => {
        gw.drain();
        match.drain();
        return runtime.drain();
      },
      close,
    };
  } catch (e) {
    await close().catch(() => undefined);
    throw e;
  }
}

/** What `installSignals` needs of `process` (tests pass a fake). */
export interface SignalProcess {
  on(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
  exit(code: number): void;
}

/**
 * SIGTERM drains (design 2.3: running games finish, at most DRAIN_MAX_MINUTES), then stops; SIGINT stops at once. A second signal (either) while a drain
 * runs stops at once, so that Ctrl-C can cut a drain of hours; a signal while it is stopping ends the process.
 */
export function installSignals(server: Pick<HostedServer, 'drain' | 'close'>, proc: SignalProcess = process): void {
  let state: 'running' | 'draining' | 'closing' = 'running';
  const stop = (): void => {
    state = 'closing';
    void server.close().then(() => proc.exit(0), () => proc.exit(1));
  };
  proc.on('SIGTERM', () => {
    if (state === 'closing') return proc.exit(1);
    if (state === 'draining') return stop();
    state = 'draining';
    void server.drain().then(() => (state === 'draining' ? stop() : undefined), () => proc.exit(1));
  });
  proc.on('SIGINT', () => {
    if (state === 'closing') return proc.exit(1);
    stop();
  });
}

/** `node --import tsx src/main.ts` / `npm start -w @openmtg/hosted`: start from the environment; SIGTERM drains, SIGINT stops. */
async function main(): Promise<void> {
  let server: HostedServer;
  try {
    server = await startHosted({ env: process.env });
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}
`);
    process.exit(1);
  }
  installSignals(server);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main();
