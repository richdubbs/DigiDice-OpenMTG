/**
 * Store outages (design 2.3 as built; package M13-5; owner decision 2026-10-15 on the M13-5 review): when the store cannot be reached, the runtime
 * PAUSES instead of voiding: the tables waiting for a commit stay where they are (their messages held back), store calls are retried with a backoff
 * (0.25 s doubling to 5 s) for up to 60 s in all, new starts are refused and readiness fails, and the seats of waiting tables are told the server is
 * busy saving after a few seconds. Only when the bound runs out is a table voided ('commit'). A store that refuses a game's OWN rows (a value it cannot
 * store: `StoreError` other than 'closed') is not an outage: that game fails at once (after one retry).
 */
import { LedgerError } from '../ledger/record';
import { StoreError } from '../store/rules';

export interface OutagePolicy {
  /** How long a store call is retried in all before it fails (60 s). */
  maxMs: number;
  /** The first wait between attempts (0.25 s), doubled each time up to `capMs` (5 s). */
  firstMs: number;
  capMs: number;
  /** After this long, the seats of the tables waiting for a commit get a "busy saving" notice (3 s). */
  noticeMs: number;
}

export const DEFAULT_OUTAGE: Readonly<OutagePolicy> = { maxMs: 60_000, firstMs: 250, capMs: 5_000, noticeMs: 3_000 };

/** PostgreSQL SQLSTATE classes that are about the data or the statement, never the connection: 22 data exception, 23 integrity, 42 syntax/access. */
const PERMANENT_SQLSTATE = /^(22|23|42)[0-9A-Z]{3}$/;

/**
 * Whether a store error may pass by itself (the store unreachable or restarting: a connection error, a closed pool), as opposed to an error that will
 * happen again on every try (M13-5 re-review): a refusal of this game's own data (`StoreError` other than 'closed'), a ledger record that does not add
 * up (`LedgerError`), a programming error (`TypeError`, `RangeError`, `ReferenceError`, `SyntaxError`), or a database error about the data or the
 * statement (SQLSTATE classes 22, 23, 42, in any error's `code`). Only transient errors are retried as an outage.
 */
export function isTransient(e: unknown): boolean {
  if (e instanceof LedgerError) return false;
  if (e instanceof StoreError) return e.code === 'closed';
  if (e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError || e instanceof SyntaxError) return false;
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && PERMANENT_SQLSTATE.test(code)) return false;
  return true;
}

/** A permanent store refusal that means there is nothing left to do (the game is already over, or unknown): a void is then complete. */
export function isSettled(e: unknown): boolean {
  return e instanceof StoreError && (e.code === 'status' || e.code === 'notFound' || e.code === 'exists');
}

export interface RetryHooks {
  /** A transient failure (the outage begins or goes on). */
  failed?(e: unknown): void;
  /** Stop retrying (the runtime is closing): the last error is thrown. */
  stop?(): boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => {
  const t = setTimeout(r, ms);
  t.unref?.();
});

/**
 * Calls `fn` until it succeeds; a transient failure is retried with the policy's backoff for up to `policy.maxMs` (then the last error is thrown); a
 * permanent one is thrown at once.
 */
export async function withRetry<T>(fn: () => Promise<T>, policy: Readonly<OutagePolicy>, hooks: RetryHooks = {}): Promise<T> {
  const start = Date.now();
  let wait = policy.firstMs;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (!isTransient(e)) throw e;
      hooks.failed?.(e);
      const left = policy.maxMs - (Date.now() - start);
      if (left <= 0 || hooks.stop?.()) throw e;
      await sleep(Math.min(wait, left));
      wait = Math.min(wait * 2, policy.capMs);
    }
  }
}
