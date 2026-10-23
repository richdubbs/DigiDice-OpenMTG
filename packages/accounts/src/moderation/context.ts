/**
 * M14-6: what the moderation part's flows share (design section 9, 11.3): the part's dependencies, the clock of the operator's commands, the name
 * rules and the keys under the store's name data version (6.3), the sanction kinds that change a Standing, and the change each one appends (9.7).
 *
 * **Two optional additions to PartDeps** (ModerationDeps). The operator's commands take no time and a forced rename needs the name rules (the key of
 * the new name, the forced-rename series), but PartDeps carries neither. So the part takes `now` and `names` when its caller has them (tests, and a
 * host that wraps the factory) and otherwise uses the system clock and builds its rules exactly as src/compose.ts builds the service's
 * (createNameRules on RESERVED_NAMES_FILE's text, read once, on first use). In the composed service both are then what the core uses; a host that
 * gives the service rules of its own should give the part the same ones (reported: PartDeps could carry them).
 */
import { readFile } from 'node:fs/promises';
import type { LimitRule } from '../abuse/api';
import type { LimitKey, ServiceRateLimiter } from '../abuse/limiter';
import type { AccountChange, AccountId, SanctionKind } from '../api';
import type { NameData, NameRules } from '../names/api';
import { createNameRules } from '../names/rules';
import type { PartDeps } from '../service/api';
import type { NameEntry } from '../store/api';

/** PartDeps, and the two optional additions of the header. */
export interface ModerationDeps extends PartDeps {
  /** The service's name rules; built from the configuration as src/compose.ts does when absent. */
  names?: NameRules;
  /** The clock of the operator's commands (the system clock when absent). Client calls use ctx.now, tick its own time. */
  now?: () => Date;
}

/** Runs `f` after every earlier task of the same key has settled: one at a time per key, in call order (queued, never refused). */
export type Serial = <T>(key: string, f: () => Promise<T>) => Promise<T>;

/** A Serial in memory: it holds a key only while a task of it is queued or running. */
export function createSerial(): Serial {
  const tails = new Map<string, Promise<void>>();
  return <T>(key: string, f: () => Promise<T>): Promise<T> => {
    const run = (tails.get(key) ?? Promise.resolve()).then(f);
    const tail = run.then(() => undefined, () => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}

/** The part's dependencies as its flows use them. */
export interface Mod extends PartDeps {
  clock(): Date;
  /** The name rules (built once, on first use, when the deps carry none). */
  names(): Promise<NameRules>;
  /** One task at a time per key, in this process (the relation cap, ./relations.ts). */
  serial: Serial;
}

export function modOf(deps: ModerationDeps): Mod {
  if (typeof deps !== 'object' || deps === null || typeof deps.store !== 'object' || typeof deps.guard !== 'object') {
    throw new TypeError('the moderation part needs the service\'s PartDeps');
  }
  const given = deps.names;
  let built: Promise<NameRules> | null = null;
  const names = (): Promise<NameRules> => {
    if (given !== undefined) return Promise.resolve(given);
    if (built === null) {
      const file = deps.config.reservedNamesFile;
      built = (file !== null ? readFile(file, 'utf8') : Promise.resolve(null)).then((reservedNamesText) => createNameRules({ reservedNamesText }));
      // a failed read is tried again at the next use
      built.catch(() => {
        built = null;
      });
    }
    return built;
  };
  return {
    store: deps.store, config: deps.config, audit: deps.audit, limits: deps.limits, changes: (c) => deps.changes(c), mail: deps.mail, log: deps.log,
    random: deps.random, guard: deps.guard,
    // the core's notices through the email part (verified addresses only): the forced rename's (review A6, M14-15)
    ...(deps.notify !== undefined ? { notify: deps.notify } : {}),
    clock: deps.now ?? (() => new Date()),
    names,
    serial: createSerial(),
  };
}

export const iso = (d: Date): string => d.toISOString();

/** The kinds whose start or end changes a Standing (9.3: ranked, listed, chat, the status): a `standing` change for hosted and the ladder. */
export const STANDING_KINDS: readonly SanctionKind[] = Object.freeze<SanctionKind[]>(['mute', 'unlist', 'suspend', 'ban']);

/** Appends the `standing` change of a sanction that started or ended, with detail.now for a concession at once (9.7). */
export async function standingChanged(m: Mod, account: AccountId, kind: SanctionKind, at: Date, now = false): Promise<void> {
  if (!STANDING_KINDS.includes(kind)) return;
  const c: Omit<AccountChange, 'seq'> = { at: iso(at), account, kind: 'standing', ...(now ? { detail: { now: true } } : {}) };
  await m.changes(c);
}

/** A name's key under one data version. */
export interface VersionedKey { key: string; version: number }

/**
 * The display's key under the store's name data version (its nameKeyVersion), and under the other loaded version during a rekey (6.3), as the
 * service core's keysOf does. A store version the rules do not load is logged, and the current data used.
 */
export async function keysFor(m: Mod, display: string): Promise<{ primary: VersionedKey; others: VersionedKey[] }> {
  const rules = await m.names();
  const v = await m.store.nameKeyVersion();
  const all: NameData[] = [rules.current, ...(rules.previous !== null ? [rules.previous] : [])];
  let primary = all.find((d) => d.version === v);
  if (primary === undefined) {
    m.log.event('accounts.names.versionUnknown', { store: v, current: rules.current.version });
    primary = rules.current;
  }
  const p = primary;
  return {
    primary: { key: rules.key(display, p), version: p.version },
    others: all.filter((d) => d !== p).map((d) => ({ key: rules.key(display, d), version: d.version })),
  };
}

/** The names entries the keys meet: each key under each version in use (6.3: during a rekey a name is checked under both). */
export async function entriesFor(m: Mod, keys: { primary: VersionedKey; others: VersionedKey[] }): Promise<NameEntry[]> {
  const versions = [keys.primary.version, ...keys.others.map((k) => k.version)];
  const seen = new Set<string>();
  const out: NameEntry[] = [];
  for (const k of [keys.primary, ...keys.others]) {
    for (const v of versions) {
      const id = `${v}\n${k.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const e = await m.store.nameEntry(k.key, v);
      if (e !== null) out.push(e);
    }
  }
  return out;
}

/** A key is free when it has no entry, or its entry has expired (6.5). */
export function isFree(e: NameEntry | null, now: Date): boolean {
  return e === null || (e.until !== null && Date.parse(e.until) <= now.getTime());
}

/**
 * Milliseconds until the limiter's `take` of `rule` would succeed, taking nothing: the core's limiter offers it (ServiceRateLimiter.wait, which
 * PartDeps' RateLimiter type does not show); a limiter without it answers 0, and its `take` then decides alone.
 */
export function waitFor(m: Mod, rule: LimitRule, key: LimitKey, now: Date): number {
  const wait = (m.limits as Partial<Pick<ServiceRateLimiter, 'wait'>>).wait;
  return typeof wait === 'function' ? wait.call(m.limits, rule, key, now) : 0;
}

/** The code of a store refusal (AccountStoreError), or undefined. */
export function storeCode(e: unknown): unknown {
  return (e as { code?: unknown } | null)?.code;
}
