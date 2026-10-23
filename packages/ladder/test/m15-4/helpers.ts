/**
 * M15-4 test helpers: a fake matcher context (sets the tests fill), entries with readable account numbers, and the fake clock and the counter of
 * match ids that 17.7 asks for (test/support).
 */
import { expect } from 'vitest';
import type { AccountId } from '../../src/accounts';
import type { LadderId } from '../../src/api';
import {
  DEFAULT_RANKED_POLICY, type RankedEntry, type RankedMatch, type RankedMatcher, type RankedMatcherContext, type RankedMatchPolicy,
} from '../../src/match/api';
import { createRatedMatcher } from '../../src/match/index';
import { FakeClock } from '../support/clock';
import { counterIds } from '../support/random';

export const SEC = 1_000;
export const MIN = 60_000;

/** Account n: `acc_` and n in 26 digits (the ULID shape of m14's ids), so ids sort as the numbers do. */
export function acc(n: number): AccountId {
  return `acc_${String(n).padStart(26, '0')}`;
}

/** The number of an account made by acc. */
export function num(a: AccountId): number {
  return Number(a.slice(4));
}

/** The account numbers of each match, in its entries' order. */
export function who(ms: readonly RankedMatch[]): number[][] {
  return ms.map((m) => m.entries.map((e) => num(e.account)));
}

export interface EntrySpec extends Partial<Omit<RankedEntry, 'recent'>> {
  /** Opponents of the last games, newest first, as account numbers. */
  recent?: number[][];
}

/** Account n's entry: session s<n>, address key ip<n>, deck d<n>, deviation 60, not in placement, no recent games, 1v1 Standard. */
export function entry(n: number, rating: number, enteredAt: number, o: EntrySpec = {}): RankedEntry {
  const { recent, ...rest } = o;
  return {
    account: acc(n),
    session: `s${n}`,
    addressKey: `ip${n}`,
    ladder: '1v1-standard',
    deck: `d${n}`,
    enteredAt,
    rating,
    deviation: 60,
    placement: false,
    recent: (recent ?? []).map((g) => g.map(acc)),
    ...rest,
  };
}

export interface Harness {
  clock: FakeClock;
  ctx: RankedMatcherContext;
  m: RankedMatcher;
  busySessions: Set<string>;
  busyAccounts: Set<AccountId>;
  /** The end of each account's cooldown (ms). */
  cooling: Map<AccountId, number>;
  off: Set<LadderId>;
  /** Enters account n at the clock's time (or `o.enteredAt`) and expects it to be accepted; returns the entry. */
  join(n: number, rating: number, o?: EntrySpec): RankedEntry;
  /** tick at the clock's time. */
  tick(): RankedMatch[];
  /** The account numbers waiting in a ladder, oldest first. */
  waiting(ladder?: LadderId): number[];
}

export function harness(policy: Partial<RankedMatchPolicy> = {}): Harness {
  const clock = new FakeClock();
  const busySessions = new Set<string>();
  const busyAccounts = new Set<AccountId>();
  const cooling = new Map<AccountId, number>();
  const off = new Set<LadderId>();
  const ctx: RankedMatcherContext = {
    sessionBusy: (s) => busySessions.has(s),
    accountBusy: (a) => busyAccounts.has(a),
    cooldown: (a, now) => (cooling.get(a) ?? -Infinity) > now,
    offered: (l) => !off.has(l),
    newMatchId: counterIds(),
    policy: { ...DEFAULT_RANKED_POLICY, ...policy },
  };
  const m = createRatedMatcher(ctx);
  return {
    clock, ctx, m, busySessions, busyAccounts, cooling, off,
    join(n, rating, o = {}) {
      const e = entry(n, rating, o.enteredAt ?? clock.now(), o);
      expect(m.enter(e, clock.now()), `account ${n} enters`).toBeNull();
      return e;
    },
    tick: () => m.tick(clock.now()),
    waiting: (ladder = '1v1-standard') => m.accounts(ladder).map(num),
  };
}

/** A pod-commander entry spec. */
export const POD = { ladder: 'pod-commander' } as const satisfies EntrySpec;
