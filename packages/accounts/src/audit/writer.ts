/**
 * M14-5: the audit writer (design 8.5, D15). Server only.
 *
 * - **Month keys.** The address tag of an event is the first 16 hex digits of HMAC-SHA256(month key, address key). The month key is 32 random bytes
 *   made when the month's first event is written; it lives only in this object's memory (never derived from a long-lived secret, never written to
 *   the store, a file or the log) and is destroyed when the month ends: as soon as an event (or `sweep`) of a later month comes, every older key is
 *   dropped. An event dated in a month whose key is gone gets no address tag. A restart makes a new key for the rest of the month (adopted
 *   default 24). The address key is read canonically first (src/abuse/address.ts), so two spellings of one /64 give one tag.
 * - **Name tags** (`nameTag`): the same under the month key, for failed sign-ins on names no account holds; the typed name itself is never kept.
 * - **Details** are checked against their kind's fixed shape (./details.ts); `build` throws on a mismatch (a programming error, never a client's),
 *   `record` logs it and drops the event.
 * - **The queue.** `record` queues an event and flushes within a second (`store.appendAudit`), never holding a request up and never throwing. It holds
 *   at most QUEUE_MAX events; a full queue drops `signInFailed` events first, then the oldest, and counts what it dropped (logged at the flush).
 * - **Failure counts** (`countFailure`): at most one `signInFailed` (or `recoveryFailed`) event per group (the caller's: an account or 'anon', and
 *   an address tag) per minute, with the count of the minute: the first failure opens a window, the next ones in it only count, and the event is
 *   written when the window has passed (`drain`, at the service's tick and at the next failure of the group) or at `flush`. A group's `nameTag`
 *   stays only while every failure of its window had the same one (null once they differ: review A8, M14-15, an anonymous group sums every name
 *   of its address key). `admit`, when given, decides whether a new window may open at all (`anonymous`, for a name no account holds).
 * - **Noisy events** (`once`): a throttle or a work demand is written at most once a minute per key (the caller's: its kind, the account or 'anon',
 *   and the address tag; never a typed name or a raw address key: review A9, M14-15), and the keys are swept at each tick. **Events about names no
 *   account holds** (`anonymous`: their failure counts and noisy events) are written at most ANONYMOUS_EVENTS_PER_MINUTE a minute, every address
 *   key together (review A8); past that they are dropped and counted, and the count of each minute that dropped any is logged
 *   (accounts.audit.anonymousDropped), as the queue counts what it drops. Events about an account are never held to it.
 */
import { createHmac } from 'node:crypto';
import { ACCOUNT_ID, AUDIT_KINDS, type AccountId, type AuditEvent, type AuditKind } from '../api';
import { addressKeys } from '../abuse/address';
import { newAuditId } from '../ids';
import { hostedTextProblem } from '../text';
import type { AuditInput, AuditWriter, CreateAuditWriter } from './api';
import { auditDetailsProblem } from './details';

/** Events queued at most before `record` starts dropping (signInFailed first). */
export const AUDIT_QUEUE_MAX = 1_000;
/** A failure-count window (8.5: one event per group per minute). */
export const FAILURE_WINDOW_MS = 60_000;
const FAILURE_GROUPS_MAX = 10_000;
/** Events about names no account holds written at most a minute (see the header; M14-15, review A8). */
export const ANONYMOUS_EVENTS_PER_MINUTE = 30;
/** Keys of noisy events held at most between two sweeps (the map is cleared if it ever gets there). */
const NOISE_MAX = 10_000;
const FLUSH_MS = 1_000;
/** An operator's name (`admin:<name>`, the free text of `--as`, 9.6): plain text of at most this many UTF-16 units. */
const ACTOR_MAX = 64;

type FailureKind = 'signInFailed' | 'recoveryFailed';

/** The audit writer as the service core uses it: AuditWriter, with the address tag, the failure counts and the month-key sweep. */
export interface ServiceAuditWriter extends AuditWriter {
  /** The address tag of `addressKey` under the month key of `at`, or null (no key, or a month already closed). */
  addressTag(addressKey: string, at: Date): string | null;
  /**
   * One more failure of `group` (8.5's per-minute count): `input` is the event to write for the window, its details' `count` filled in. `admit` is
   * asked before a new window opens; false drops the failure (M14-15, review A8: the budget of events about names no account holds).
   */
  countFailure<K extends FailureKind>(group: string, input: AuditInput<K>, at: Date, admit?: () => boolean): void;
  /** Writes the failure counts whose minute has passed. */
  drain(at: Date): void;
  /**
   * Whether a noisy event of `key` may be written now: once a minute per key (8.5), and an `anonymous` one only within the minute's budget (see the
   * header). M14-15 (reviews A8 and A9): moved here from the sign-in paths, with the budget.
   */
  once(key: string, at: Date, anonymous: boolean): boolean;
  /** One more event about a name no account holds within the minute's budget; false, and the drop counted, once it is spent. */
  anonymous(at: Date): boolean;
  /** The noisy-event keys held now (tests: what stays in memory, and for how long). */
  noiseKeys(): string[];
  /** Destroys the month keys of months before `now`'s and drops the noisy-event keys older than a minute (the service's tick). */
  sweep(now: Date): void;
  /** Events dropped by a full queue so far. */
  readonly dropped: number;
  /** The queued events of `account` (M14-7's erasure: a flush whose store write failed puts its events back). */
  queued(account: AccountId): number;
}

export interface AuditWriterInternals {
  /** Replaces the flush timer (tests flush by hand). */
  schedule?: (f: () => void, ms: number) => void;
  queueMax?: number;
}

const monthOf = (at: Date): string => at.toISOString().slice(0, 7);

export function buildAuditWriter(opts: Parameters<CreateAuditWriter>[0], internals: AuditWriterInternals = {}): ServiceAuditWriter {
  const { store, log, random } = opts;
  const queueMax = internals.queueMax ?? AUDIT_QUEUE_MAX;
  const schedule =
    internals.schedule ??
    ((f: () => void, ms: number) => {
      const t = setTimeout(f, ms);
      (t as { unref?: () => void }).unref?.();
    });
  const keys = new Map<string, Buffer>();
  let latest = '';
  let queue: AuditEvent[] = [];
  let dropped = 0;
  let droppedLogged = 0;
  let scheduled = false;
  let flushing: Promise<void> = Promise.resolve();
  const failures = new Map<string, { input: AuditInput<FailureKind>; firstAt: Date; count: number }>();
  /** When each noisy-event key last wrote; and the budget of anonymous events of the current minute (see the header). */
  const noise = new Map<string, number>();
  const budget = { minute: -1, used: 0, dropped: 0 };

  function bytes(n: number): Buffer {
    const b = random(n);
    if (!(b instanceof Uint8Array) || b.length < n) throw new RangeError(`the random source gave ${b?.length ?? 0} bytes, not ${n}`);
    return Buffer.from(b.slice(0, n));
  }

  /** The key of `at`'s month: made on first use, null for a month before the latest one seen (its key is destroyed). */
  function monthKey(at: Date): Buffer | null {
    const m = monthOf(at);
    if (m < latest) return null;
    if (m > latest) {
      for (const k of [...keys.keys()]) if (k < m) keys.delete(k);
      latest = m;
    }
    let k = keys.get(m);
    if (k === undefined) {
      k = bytes(32);
      keys.set(m, k);
    }
    return k;
  }

  const tagWith = (key: Buffer, domain: string, value: string): string =>
    createHmac('sha256', key).update(`${domain}\n${value}`, 'utf8').digest('hex').slice(0, 16);

  function addressTag(addressKey: string, at: Date): string | null {
    const key = monthKey(at);
    return key === null ? null : tagWith(key, 'address', addressKeys(addressKey).key);
  }

  function build<K extends AuditKind>(e: AuditInput<K>, at: Date): AuditEvent<K> {
    if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new TypeError('audit: the time is not a Date');
    if (!(AUDIT_KINDS as readonly string[]).includes(e.kind)) throw new TypeError('audit: unknown kind');
    if (e.account !== null && !(typeof e.account === 'string' && ACCOUNT_ID.test(e.account))) throw new TypeError('audit: the account is not an id');
    const actor = e.actor;
    const operator = typeof actor === 'string' && actor.startsWith('admin:') ? actor.slice(6) : null;
    const operatorOk = operator !== null && operator.trim() !== '' && operator.length <= ACTOR_MAX && hostedTextProblem(operator) === null;
    if (!(actor === 'self' || actor === 'system' || operatorOk)) throw new TypeError('audit: the actor is not self, system or admin:<operator>');
    const actorOs = e.actorOs ?? null;
    if (actorOs !== null && (typeof actorOs !== 'string' || actorOs.length > 64 || hostedTextProblem(actorOs) !== null)) {
      throw new TypeError('audit: the OS user is not plain text of at most 64 characters');
    }
    const session = e.session ?? null;
    if (session !== null && !(typeof session === 'string' && /^[0-9A-Za-z_-]{1,64}$/.test(session))) throw new TypeError('audit: the session is not an id');
    const problem = auditDetailsProblem(e.kind, e.details, e.account);
    if (problem !== null) throw new TypeError(`audit: ${problem}`);
    const addressKey = e.addressKey ?? null;
    return {
      id: newAuditId(at, random),
      at: at.toISOString(),
      kind: e.kind,
      account: e.account,
      actor,
      actorOs,
      session,
      addressTag: addressKey === null ? null : addressTag(addressKey, at),
      details: JSON.parse(JSON.stringify(e.details)) as AuditEvent<K>['details'],
    };
  }

  function enqueue(ev: AuditEvent): void {
    if (queue.length >= queueMax) {
      const i = queue.findIndex((x) => x.kind === 'signInFailed');
      queue.splice(i >= 0 ? i : 0, 1);
      dropped++;
    }
    queue.push(ev);
    if (!scheduled) {
      scheduled = true;
      schedule(() => {
        scheduled = false;
        void writer.flush();
      }, FLUSH_MS);
    }
  }

  function record<K extends AuditKind>(e: AuditInput<K>, at: Date): void {
    try {
      enqueue(build(e, at));
    } catch (err) {
      log.event('accounts.audit.refused', { kind: typeof e?.kind === 'string' ? e.kind : null, error: err instanceof Error ? err.name : 'error' });
    }
  }

  function emitFailure(entry: { input: AuditInput<FailureKind>; firstAt: Date; count: number }): void {
    const input = { ...entry.input, details: { ...entry.input.details, count: entry.count } } as AuditInput<FailureKind>;
    record(input, entry.firstAt);
  }

  /** Starts the minute of `at` when it is a new one, logging what the minute before dropped. */
  function turnMinute(at: Date): void {
    const minute = Math.floor(at.getTime() / FAILURE_WINDOW_MS);
    if (minute <= budget.minute) return;
    if (budget.dropped > 0) log.event('accounts.audit.anonymousDropped', { count: budget.dropped });
    budget.minute = minute;
    budget.used = 0;
    budget.dropped = 0;
  }

  function anonymous(at: Date): boolean {
    turnMinute(at);
    if (budget.used >= ANONYMOUS_EVENTS_PER_MINUTE) {
      budget.dropped++;
      return false;
    }
    budget.used++;
    return true;
  }

  function drain(at: Date): void {
    const t = at.getTime();
    for (const [k, e] of failures) {
      if (t - e.firstAt.getTime() >= FAILURE_WINDOW_MS) {
        failures.delete(k);
        emitFailure(e);
      }
    }
  }

  const writer: ServiceAuditWriter = {
    build,
    record,
    nameTag(nameKey, at) {
      // a closed month's key is gone: a throwaway key, so the tag links to nothing
      const key = monthKey(at) ?? bytes(32);
      return tagWith(key, 'name', String(nameKey));
    },
    addressTag,
    countFailure(group, input, at, admit) {
      const e = failures.get(group);
      if (e !== undefined && at.getTime() - e.firstAt.getTime() < FAILURE_WINDOW_MS) {
        e.count++;
        // a window of failures for more than one name keeps no name's tag (see the header)
        const tag = (i: AuditInput<FailureKind>) => (i.details as { nameTag?: string | null }).nameTag;
        if (tag(e.input) !== undefined && tag(e.input) !== tag(input as AuditInput<FailureKind>)) {
          e.input = { ...e.input, details: { ...e.input.details, nameTag: null } } as AuditInput<FailureKind>;
        }
        return;
      }
      if (e !== undefined) {
        failures.delete(group);
        emitFailure(e);
      }
      if (admit !== undefined && !admit()) return;
      if (failures.size >= FAILURE_GROUPS_MAX) {
        const [oldest, first] = failures.entries().next().value as [string, { input: AuditInput<FailureKind>; firstAt: Date; count: number }];
        failures.delete(oldest);
        emitFailure(first);
      }
      failures.set(group, { input: input as AuditInput<FailureKind>, firstAt: at, count: 1 });
    },
    drain,
    once(key, at, anon) {
      const t = at.getTime();
      const last = noise.get(key);
      if (last !== undefined && t - last < FAILURE_WINDOW_MS) return false;
      if (anon && !anonymous(at)) return false;
      if (noise.size >= NOISE_MAX) noise.clear();
      noise.set(key, t);
      return true;
    },
    anonymous,
    noiseKeys: () => [...noise.keys()],
    sweep(now) {
      const m = monthOf(now);
      if (m > latest) latest = m;
      for (const k of [...keys.keys()]) if (k < latest) keys.delete(k);
      drain(now);
      // the noisy-event keys of the minute gone, and that minute's budget closed (review A9)
      const t = now.getTime();
      for (const [k, last] of noise) if (t - last >= FAILURE_WINDOW_MS) noise.delete(k);
      turnMinute(now);
    },
    get dropped() {
      return dropped;
    },
    queued(account) {
      return queue.filter((e) => e.account === account).length;
    },
    flush() {
      for (const [k, e] of failures) {
        failures.delete(k);
        emitFailure(e);
      }
      const run = flushing.then(async () => {
        const batch = queue;
        queue = [];
        if (dropped > droppedLogged) {
          log.event('accounts.audit.dropped', { count: dropped - droppedLogged });
          droppedLogged = dropped;
        }
        if (batch.length === 0) return;
        try {
          await store.appendAudit(batch);
        } catch (err) {
          log.event('accounts.audit.failed', { events: batch.length, error: err instanceof Error ? err.name : 'error' });
          // keep them for the next flush, within the queue's bound
          queue = [...batch, ...queue].slice(-queueMax);
        }
      });
      flushing = run.catch(() => undefined);
      return run;
    },
  };
  return writer;
}
