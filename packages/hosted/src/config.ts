/**
 * Configuration (design 10.1): environment variables, validated at start by `parseConfig` (pure: the environment and the machine's core count come in as
 * arguments). A value that does not parse is an error, never silently replaced by a default; secrets (`DATABASE_URL`, `METRICS_TOKEN`, `LEDGER_SECRET`)
 * come only from the environment or a secret store, are never echoed in an error and are hidden by `describeConfig` (the line the server logs at start).
 *
 * Also here: the fixed limits of the design that are not environment variables (game caps and size limits, per-command and per-address limits), so
 * every package reads them from one place.
 */
import { isIP } from 'node:net';
import type { RateConfig } from '@openmtg/net/server-kit';
import { DEFAULT_CLOCKS, HOSTED_FORMATS, isHostedFormat, type ClockSettings, type HostedFormatId } from './api';
import { DEFAULT_ADMISSION_LIMITS, DEFAULT_UNITS, type UnitWeights } from './admission/api';
import { LOG_LEVELS, type LogLevel } from './obs';
import type { RetentionPolicy } from './store/api';

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Fixed limits (design 2.1-2.3, 3.5, 3.6, 4.1, 4.2, 4.8, 11)

/** The table actor's per-game caps and size limits (design 2.2, D9, D15). */
export const GAME_LIMITS = {
  /** Logged actions per game: 4,000 1v1, 8,000 in a pod; at a cap the game is void ("limit"); at 90% a `limitWarning`. */
  actions1v1: 4_000,
  actionsPod: 8_000,
  /** Wall-clock time per game (server outages not counted): 2 hours 1v1, 4 hours in a pod. */
  wallClock1v1Ms: 2 * 3_600_000,
  wallClockPodMs: 4 * 3_600_000,
  warnAt: 0.9,
  /** After every apply: objects, `state.log` entries, `state.history` entries; an action past one is refused (`limitReached`). */
  maxObjects: 5_000,
  maxLogEntries: 50_000,
  maxHistoryEntries: 50_000,
  /** A snapshot's serialized state at most (measured at each snapshot). */
  maxSnapshotBytes: 16 * 1024 * 1024,
  snapshotEvery: 100,
  /** By-hand change proposals per decision (D12); then notes only. */
  proposalsPerDecision: 2,
} as const;

/** The runtime's fixed values (design 2.1-2.3, 3.5). */
export const RUNTIME_LIMITS = {
  /** The watchdog: a worker message (an action, a recovery step, a snapshot) past this terminates the worker. */
  watchdogMs: 5_000,
  /** Group commit: every 10 ms or 64 records, whichever comes first. */
  commitEveryMs: 10,
  commitMaxRecords: 64,
  /** The deck pool: a deadline per deck and a bounded queue (a full queue answers `busy`). */
  deckDeadlineMs: 10_000,
  deckQueue: 64,
  /** Default heap per game worker (the memory plan of design 9.2). */
  workerHeapMb: 1_280,
  /** Recoveries before a table is quarantined (D5). */
  maxRecoveries: 2,
  /** Per connection: the socket is written while its buffered bytes are under 256 KB; queued plus buffered past 1 MB puts it behind. */
  socketHighWaterBytes: 256 * 1024,
  connectionBudgetBytes: 1024 * 1024,
  /** The total outbound budget: above 80% the largest backlogs go behind; at 100% the largest offenders are closed. */
  outboundBehindAt: 0.8,
} as const;

/** Per-connection command limits (design 3.6): rate per second and burst. The seated `GuestGate` (net's `DEFAULT_GUEST_LIMITS`) covers act and chat. */
export const COMMAND_LIMITS: Readonly<Record<
  'browse' | 'watchLobby' | 'create' | 'join' | 'codes' | 'queue' | 'ready' | 'vote' | 'leave' | 'report' | 'history' | 'spectate' | 'ping',
  RateConfig
>> = {
  // M13-6 (additive): every command is limited (design 3.6, review 12): `history`, the reserved `spectate` and the keep-alive `ping` too.
  history: { rate: 1 / 5, burst: 2 },
  spectate: { rate: 1, burst: 2 },
  ping: { rate: 1, burst: 5 },
  browse: { rate: 2, burst: 4 },
  watchLobby: { rate: 1 / 5, burst: 1 },
  create: { rate: 1 / 10, burst: 1 },
  join: { rate: 1, burst: 2 },
  codes: { rate: 1 / 10, burst: 1 },
  /** `queue` and `unqueue` share one bucket. */
  queue: { rate: 1 / 5, burst: 1 },
  ready: { rate: 2, burst: 4 },
  vote: { rate: 2, burst: 4 },
  leave: { rate: 1, burst: 2 },
  report: { rate: 1 / 60, burst: 1 },
};

/**
 * M13-6 INTERFACE CHANGE (additive): the IPv6 aggregate of the per-address limits (review: a /48 holds 65,536 /64s, and each would have its own allowance of
 * ADDRESS_LIMITS, so one network could fill MAX_CONNECTIONS with a few hundred addresses). For an IPv6 client the sockets, new sockets, new sessions and join
 * attempts of its /48 are limited as well, at 16 times the allowance of one /64 (a household or an office with many /64s is far under it); IPv4 keys have none.
 */
export const ADDRESS_AGGREGATE = {
  openSockets: 16 * 8,
  newSockets: { rate: 16, burst: 160 } as RateConfig,
  newSessions: { rate: (16 * 5) / 60, burst: 160 } as RateConfig,
  joinAttempts: { rate: 16, burst: 80 } as RateConfig,
  /** Failed join attempts within the window that lock joining for the /48 (the lock is the /64's: ADDRESS_LIMITS.joinLockMs). */
  joinFailures: 16 * 10,
  /** Unstarted tables of one /48 (the limit of one /64 is ADDRESS_LIMITS.unstartedTables). */
  unstartedTables: 16 * 2,
} as const;

/** Per-address-key (/32 IPv4, /64 IPv6) and per-session limits (design 3.2, 3.6, 4.1-4.6, 11). */
export const ADDRESS_LIMITS = {
  openSockets: 8,
  newSockets: { rate: 1, burst: 10 } as RateConfig,
  newSessions: { rate: 5 / 60, burst: 10 } as RateConfig,
  /** The global session rate is backpressure only: past it, new sessions are refused only for keys with more than 2 in the last 10 minutes. */
  heavySessions: 2,
  heavyWindowMs: 10 * 60_000,
  unstartedTables: 2,
  unstartedTablesPerSession: 1,
  matchEntries: 2,
  waitingStarts: 2,
  lobbyWatchers: 4,
  /** Join attempts (codes and passwords) per session and per address key; 10 failures in 10 minutes refuse joining for 10 minutes. */
  joinAttempts: { rate: 1, burst: 5 } as RateConfig,
  joinFailures: 10,
  joinFailureWindowMs: 10 * 60_000,
  joinLockMs: 10 * 60_000,
} as const;

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Environment

export type StoreKind = 'memory' | 'file' | 'postgres';

/** The clock settings for each table kind and, optionally, per format (`CLOCK_DEFAULTS`). */
export interface ClockConfig {
  '1v1': ClockSettings;
  pod: ClockSettings;
  formats: Partial<Record<HostedFormatId, Partial<Record<'1v1' | 'pod', ClockSettings>>>>;
}

export interface HostedConfig {
  port: number;
  bind: string;
  /** Exact https origins (production: https://play.digidice.net). */
  publicOrigins: string[];
  /** Also accept the desktop app's loopback origins (http://127.0.0.1:<port>, http://localhost:<port>). */
  allowDesktopOrigins: boolean;
  /** The reverse proxy's address: every other TCP peer is refused, and the client address is the rightmost X-Forwarded-For entry. */
  trustProxy: string | null;
  store: StoreKind;
  /** Secret. */
  databaseUrl: string | null;
  dataDir: string;
  cardDataDir: string | null;
  workers: number;
  deckWorkers: number;
  capacityUnits: number;
  capacityQueueMax: number;
  capacityWaitMaxMinutes: number;
  units: UnitWeights;
  maxConnections: number;
  maxLobby: number;
  maxListed: number;
  maxLobbyWatchers: number;
  /** New sessions per minute over all keys before backpressure. */
  sessionRate: number;
  outboundBudgetMb: number;
  podsEnabled: boolean;
  /** Pods start with 3 players after this wait in quick match (design 4.5). */
  podThreeAfterSeconds: number;
  formats: HostedFormatId[];
  clocks: ClockConfig;
  retention: RetentionPolicy & { serverLogDays: number };
  drainMaxMinutes: number;
  moderationWordsFile: string | null;
  logLevel: LogLevel;
  /** The metrics listener's port (on the container network only); null: no metrics listener. */
  metricsPort: number | null;
  /** Secret; required with a metrics port. */
  metricsToken: string | null;
  /** Secret: the deck fingerprints' HMAC key; required with the postgres store. Null (development): the runtime uses a random key per process. */
  ledgerSecret: string | null;
}

export type ConfigResult = { ok: true; config: HostedConfig; warnings: string[] } | { ok: false; errors: string[] };

/** Every environment variable `parseConfig` reads. */
export const CONFIG_VARIABLES = [
  'PORT', 'BIND', 'PUBLIC_ORIGINS', 'ALLOW_DESKTOP_ORIGINS', 'TRUST_PROXY', 'STORE', 'DATABASE_URL', 'DATA_DIR', 'CARD_DATA_DIR', 'WORKERS',
  'DECK_WORKERS', 'CAPACITY_UNITS', 'CAPACITY_QUEUE_MAX', 'CAPACITY_WAIT_MAX_MINUTES', 'UNITS_1V1', 'UNITS_POD3', 'UNITS_POD4', 'MAX_CONNECTIONS',
  'MAX_LOBBY', 'MAX_LISTED', 'MAX_LOBBY_WATCHERS', 'SESSION_RATE', 'OUTBOUND_BUDGET_MB', 'PODS_ENABLED', 'POD_THREE_AFTER_SECONDS', 'HOSTED_FORMATS',
  'CLOCK_DEFAULTS', 'RETENTION_LOG_DAYS', 'RETENTION_LOBBY_DAYS', 'RETENTION_VOID_DAYS', 'RETENTION_SESSION_DAYS', 'RETENTION_SERVER_LOG_DAYS',
  'DRAIN_MAX_MINUTES', 'MODERATION_WORDS_FILE', 'LOG_LEVEL', 'METRICS_PORT', 'METRICS_TOKEN', 'LEDGER_SECRET',
] as const;
export type ConfigVariable = (typeof CONFIG_VARIABLES)[number];

/**
 * `LEDGER_SECRET` and `METRICS_TOKEN`: 32 random bytes as 64 hex digits (`openssl rand -hex 32`), nothing shorter or chosen by hand, so neither can be
 * guessed: the ledger secret keys the deck fingerprints (an HMAC nobody may test a guessed decklist against), the token guards the metrics listener.
 */
export const SECRET_FORMAT = /^[0-9a-fA-F]{64}$/;
const SECRET_FORMAT_TEXT = '32 random bytes as 64 hex digits (openssl rand -hex 32)';

/** Never echoed in an error, hidden by `describeConfig`. */
export const SECRET_VARIABLES: readonly ConfigVariable[] = ['DATABASE_URL', 'METRICS_TOKEN', 'LEDGER_SECRET'];

/** The longest game allowed (a pod's wall-clock cap): a drain must outlast it (design 2.3). */
const LONGEST_GAME_MINUTES = GAME_LIMITS.wallClockPodMs / 60_000;

type Env = Readonly<Record<string, string | undefined>>;

class Reader {
  readonly errors: string[] = [];
  readonly warnings: string[] = [];
  constructor(private readonly env: Env) {}

  raw(name: ConfigVariable): string | undefined {
    const v = this.env[name];
    return v === undefined || v.trim() === '' ? undefined : v.trim();
  }

  private fail(name: ConfigVariable, what: string): void {
    // A secret's value is never repeated in an error.
    this.errors.push(SECRET_VARIABLES.includes(name) ? `${name}: ${what}.` : `${name}: ${what} (got ${JSON.stringify(this.raw(name))}).`);
  }

  int(name: ConfigVariable, dflt: number, min: number, max: number): number {
    const v = this.raw(name);
    if (v === undefined) return dflt;
    if (!/^\d+$/.test(v) || Number(v) < min || Number(v) > max) {
      this.fail(name, `a whole number from ${min} to ${max}`);
      return dflt;
    }
    return Number(v);
  }

  optInt(name: ConfigVariable, min: number, max: number): number | null {
    return this.raw(name) === undefined ? null : this.int(name, min, min, max);
  }

  bool(name: ConfigVariable, dflt: boolean): boolean {
    const v = this.raw(name)?.toLowerCase();
    if (v === undefined) return dflt;
    if (v === '1' || v === 'true') return true;
    if (v === '0' || v === 'false') return false;
    this.fail(name, '1, 0, true or false');
    return dflt;
  }

  oneOf<T extends string>(name: ConfigVariable, dflt: T, values: readonly T[]): T {
    const v = this.raw(name);
    if (v === undefined) return dflt;
    if (!(values as readonly string[]).includes(v)) {
      this.fail(name, `one of ${values.join(', ')}`);
      return dflt;
    }
    return v as T;
  }

  ip(name: ConfigVariable, dflt: string | null): string | null {
    const v = this.raw(name);
    if (v === undefined) return dflt;
    if (isIP(v) === 0) {
      this.fail(name, 'an IPv4 or IPv6 address');
      return dflt;
    }
    return v;
  }

  str(name: ConfigVariable): string | null {
    return this.raw(name) ?? null;
  }

  error(message: string): void {
    this.errors.push(message);
  }
}

/** An exact https origin: scheme, host and optional port; no path, query, fragment, user, wildcard or trailing slash. Null if it is not one. */
export function httpsOrigin(s: string): string | null {
  if (s.includes('*')) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.pathname !== '/') return null;
  return s === u.origin ? u.origin : null;
}

function parseOrigins(r: Reader): string[] {
  const v = r.raw('PUBLIC_ORIGINS');
  if (v === undefined) return [];
  const out: string[] = [];
  for (const part of v.split(',').map((x) => x.trim()).filter(Boolean)) {
    const o = httpsOrigin(part);
    if (!o) r.error(`PUBLIC_ORIGINS: ${JSON.stringify(part)} is not an exact https origin (https://host or https://host:port; no path, no wildcard).`);
    else if (!out.includes(o)) out.push(o);
  }
  return out;
}

function parseFormats(r: Reader): HostedFormatId[] {
  const v = r.raw('HOSTED_FORMATS');
  if (v === undefined) return HOSTED_FORMATS.map((f) => f.id);
  const out: HostedFormatId[] = [];
  for (const part of v.split(',').map((x) => x.trim()).filter(Boolean)) {
    if (!isHostedFormat(part)) r.error(`HOSTED_FORMATS: ${JSON.stringify(part)} is not a hosted format (${HOSTED_FORMATS.map((f) => f.id).join(', ')}).`);
    else if (!out.includes(part)) out.push(part);
  }
  if (!out.length) r.error('HOSTED_FORMATS: no format.');
  return out;
}

/** Bounds of a clock setting given in `CLOCK_DEFAULTS` (seconds). */
const CLOCK_BOUNDS = { bankSeconds: [60, 7_200], delaySeconds: [0, 60], dropSeconds: [30, 1_800] } as const;

function parseClockSetting(r: Reader, where: string, x: unknown): ClockSettings | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) {
    r.error(`CLOCK_DEFAULTS: ${where} is not an object.`);
    return null;
  }
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o);
  const unknown = keys.filter((k) => !(k in CLOCK_BOUNDS));
  if (unknown.length || keys.length !== 3) {
    r.error(`CLOCK_DEFAULTS: ${where} needs exactly bankSeconds, delaySeconds and dropSeconds.`);
    return null;
  }
  const out: number[] = [];
  for (const [k, [min, max]] of Object.entries(CLOCK_BOUNDS)) {
    const n = o[k];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
      r.error(`CLOCK_DEFAULTS: ${where}.${k} must be a whole number from ${min} to ${max}.`);
      return null;
    }
    out.push(n * 1000);
  }
  return { bankMs: out[0]!, delayMs: out[1]!, dropMs: out[2]! };
}

/**
 * `CLOCK_DEFAULTS`: JSON, at most 4 KB, e.g. `{"1v1":{"bankSeconds":900,"delaySeconds":5,"dropSeconds":300},"formats":{"vintage":{"1v1":{...}}}}`;
 * every part optional, the defaults of design 5.2 otherwise.
 */
function parseClocks(r: Reader): ClockConfig {
  const out: ClockConfig = { '1v1': { ...DEFAULT_CLOCKS['1v1'] }, pod: { ...DEFAULT_CLOCKS.pod }, formats: {} };
  const v = r.raw('CLOCK_DEFAULTS');
  if (v === undefined) return out;
  if (v.length > 4096) {
    r.error('CLOCK_DEFAULTS: longer than 4 KB.');
    return out;
  }
  let x: unknown;
  try {
    x = JSON.parse(v);
  } catch {
    r.error('CLOCK_DEFAULTS: not JSON.');
    return out;
  }
  if (typeof x !== 'object' || x === null || Array.isArray(x)) {
    r.error('CLOCK_DEFAULTS: not a JSON object.');
    return out;
  }
  for (const [k, val] of Object.entries(x)) {
    if (k === '1v1' || k === 'pod') {
      const c = parseClockSetting(r, k, val);
      if (c) out[k] = c;
    } else if (k === 'formats') {
      if (typeof val !== 'object' || val === null || Array.isArray(val)) {
        r.error('CLOCK_DEFAULTS: formats is not an object.');
        continue;
      }
      for (const [f, per] of Object.entries(val)) {
        if (!isHostedFormat(f)) {
          r.error(`CLOCK_DEFAULTS: ${JSON.stringify(f)} is not a hosted format.`);
          continue;
        }
        if (typeof per !== 'object' || per === null || Array.isArray(per)) {
          r.error(`CLOCK_DEFAULTS: formats.${f} is not an object.`);
          continue;
        }
        const entry: Partial<Record<'1v1' | 'pod', ClockSettings>> = {};
        for (const [kind, c] of Object.entries(per)) {
          if (kind !== '1v1' && kind !== 'pod') {
            r.error(`CLOCK_DEFAULTS: formats.${f}.${kind}: only 1v1 and pod.`);
            continue;
          }
          const parsed = parseClockSetting(r, `formats.${f}.${kind}`, c);
          if (parsed) entry[kind] = parsed;
        }
        out.formats[f] = entry;
      }
    } else r.error(`CLOCK_DEFAULTS: unknown key ${JSON.stringify(k)} (1v1, pod, formats).`);
  }
  return out;
}

/** A table's clocks: the format's own setting if configured, else the table kind's. */
export function clockFor(clocks: ClockConfig, format: HostedFormatId, seats: number): ClockSettings {
  const kind = seats > 2 ? 'pod' : '1v1';
  return clocks.formats[format]?.[kind] ?? clocks[kind];
}

const isLoopback = (ip: string): boolean => ip === '::1' || ip.startsWith('127.');

/** Validate the environment. `cpus`: the machine's core count (`os.availableParallelism()`), for the default worker count (vCPUs - 1). */
export function parseConfig(env: Env, machine: { cpus: number }): ConfigResult {
  const r = new Reader(env);
  const store = r.oneOf<StoreKind>('STORE', 'file', ['memory', 'file', 'postgres']);
  const databaseUrl = r.str('DATABASE_URL');
  if (store === 'postgres') {
    if (!databaseUrl) r.error('DATABASE_URL: required with STORE=postgres.');
    else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) r.error('DATABASE_URL: must start with postgres:// or postgresql://.');
  }
  const ledgerSecret = r.str('LEDGER_SECRET');
  if (ledgerSecret !== null && !SECRET_FORMAT.test(ledgerSecret)) r.error(`LEDGER_SECRET: ${SECRET_FORMAT_TEXT}.`);
  if (ledgerSecret === null && store === 'postgres') r.error('LEDGER_SECRET: required with STORE=postgres (deck fingerprints must stay comparable across restarts).');
  const metricsPort = r.optInt('METRICS_PORT', 1, 65_535);
  const metricsToken = r.str('METRICS_TOKEN');
  if (metricsToken !== null && !SECRET_FORMAT.test(metricsToken)) r.error(`METRICS_TOKEN: ${SECRET_FORMAT_TEXT}.`);
  else if (metricsPort !== null && metricsToken === null) r.error(`METRICS_TOKEN: required with METRICS_PORT (${SECRET_FORMAT_TEXT}).`);
  const port = r.int('PORT', 8787, 1, 65_535);
  if (metricsPort !== null && metricsPort === port) r.error('METRICS_PORT: must differ from PORT (the metrics listener is a separate server).');
  const bind = r.ip('BIND', '127.0.0.1')!;
  const trustProxy = r.ip('TRUST_PROXY', null);
  const publicOrigins = parseOrigins(r);
  const allowDesktopOrigins = r.bool('ALLOW_DESKTOP_ORIGINS', true);
  if (!publicOrigins.length && !allowDesktopOrigins) r.error('PUBLIC_ORIGINS: empty while ALLOW_DESKTOP_ORIGINS is off: no browser could connect.');
  if (!isLoopback(bind) && trustProxy === null) {
    r.warnings.push(`BIND=${bind} without TRUST_PROXY: the gateway is reachable directly (inside a container, only the proxy's ports may be published).`);
  }
  const workers = r.int('WORKERS', Math.max(1, machine.cpus - 1), 1, 256);
  const drainMaxMinutes = r.int('DRAIN_MAX_MINUTES', 250, 1, 24 * 60);
  if (drainMaxMinutes <= LONGEST_GAME_MINUTES) r.warnings.push(`DRAIN_MAX_MINUTES=${drainMaxMinutes} is not more than the longest game (${LONGEST_GAME_MINUTES} minutes): a drain may void games.`);

  const config: HostedConfig = {
    port,
    bind,
    publicOrigins,
    allowDesktopOrigins,
    trustProxy,
    store,
    databaseUrl,
    dataDir: r.str('DATA_DIR') ?? 'data',
    cardDataDir: r.str('CARD_DATA_DIR'),
    workers,
    deckWorkers: r.int('DECK_WORKERS', 1, 1, 4),
    capacityUnits: r.int('CAPACITY_UNITS', DEFAULT_ADMISSION_LIMITS.capacityUnits, 1, 1_000_000),
    capacityQueueMax: r.int('CAPACITY_QUEUE_MAX', DEFAULT_ADMISSION_LIMITS.queueMax, 0, 100_000),
    capacityWaitMaxMinutes: r.int('CAPACITY_WAIT_MAX_MINUTES', DEFAULT_ADMISSION_LIMITS.waitMaxMs / 60_000, 1, 24 * 60),
    units: {
      two: r.int('UNITS_1V1', DEFAULT_UNITS.two, 1, 100),
      three: r.int('UNITS_POD3', DEFAULT_UNITS.three, 1, 100),
      four: r.int('UNITS_POD4', DEFAULT_UNITS.four, 1, 100),
    },
    maxConnections: r.int('MAX_CONNECTIONS', 5_000, 1, 1_000_000),
    maxLobby: r.int('MAX_LOBBY', 400, 1, 1_000_000),
    maxListed: r.int('MAX_LISTED', 300, 1, 1_000_000),
    maxLobbyWatchers: r.int('MAX_LOBBY_WATCHERS', 2_000, 0, 1_000_000),
    sessionRate: r.int('SESSION_RATE', 200, 1, 1_000_000),
    outboundBudgetMb: r.int('OUTBOUND_BUDGET_MB', 256, 16, 65_536),
    podsEnabled: r.bool('PODS_ENABLED', false),
    podThreeAfterSeconds: r.int('POD_THREE_AFTER_SECONDS', 90, 10, 3_600),
    formats: parseFormats(r),
    clocks: parseClocks(r),
    retention: {
      logsDays: r.int('RETENTION_LOG_DAYS', 90, 1, 3_650),
      lobbyDays: r.int('RETENTION_LOBBY_DAYS', 7, 1, 3_650),
      voidDays: r.int('RETENTION_VOID_DAYS', 90, 1, 3_650),
      sessionDays: r.int('RETENTION_SESSION_DAYS', 30, 1, 3_650),
      serverLogDays: r.int('RETENTION_SERVER_LOG_DAYS', 14, 1, 3_650),
    },
    drainMaxMinutes,
    moderationWordsFile: r.str('MODERATION_WORDS_FILE'),
    logLevel: r.oneOf<LogLevel>('LOG_LEVEL', 'info', LOG_LEVELS),
    metricsPort,
    metricsToken,
    ledgerSecret,
  };
  if (config.units.two > config.units.three || config.units.three > config.units.four) r.error('UNITS_1V1 <= UNITS_POD3 <= UNITS_POD4 is required.');
  // A game that can never fit would wait at the head of the capacity queue for ever: the 1v1 game always, the pods only when this server offers them
  // (with PODS_ENABLED off `CAPACITY_UNITS=1` is a valid way to test the queue).
  if (config.units.two > config.capacityUnits) r.error('CAPACITY_UNITS: smaller than one 1v1 game (UNITS_1V1): no game could start.');
  if (config.podsEnabled && config.units.four > config.capacityUnits) r.error('CAPACITY_UNITS: smaller than one 4-player pod (UNITS_POD4): a pod could never start.');
  return r.errors.length ? { ok: false, errors: r.errors } : { ok: true, config, warnings: r.warnings };
}

/** The configuration as the server logs it at start: secrets as "(set)" or "(unset)". */
export function describeConfig(c: HostedConfig): Record<string, unknown> {
  const hidden = (v: string | null) => (v === null ? '(unset)' : '(set)');
  return { ...c, databaseUrl: hidden(c.databaseUrl), metricsToken: hidden(c.metricsToken), ledgerSecret: hidden(c.ledgerSecret) };
}
