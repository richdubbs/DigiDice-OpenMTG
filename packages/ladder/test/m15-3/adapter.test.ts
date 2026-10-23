/**
 * M15-3: the intake adapter, toRatedGame (design 8.2, 13.2, D8, 17.5): every check of 8.2's table from a fixture record, in the table's order, and
 * the registry seat's authority over the ledger placement.
 */
import { describe, expect, it } from 'vitest';
import { initialState, type LadderId } from '../../src/api';
import { capProblem, isIntakeSkip, toRatedGame } from '../../src/intake/adapter';
import type { IntakeSkip, LedgerGameRecord, RankedStart, RatedGame } from '../../src/ledger';
import { acc, ended, gid, recordOf, text } from './fixtures';

const T = '2026-10-15T12:00:00.000Z';
const A = acc(1);
const B = acc(2);

function startOf(game: string, accounts: (string | null)[], o: { ladder?: LadderId; status?: RankedStart['status'] } = {}): RankedStart {
  const ladder = o.ladder ?? '1v1-standard';
  return {
    game, match: `m${game}`, ladder, startedAt: T,
    seats: accounts.map((account, i) => ({
      seat: (i + 1) as 1 | 2 | 3 | 4, account: account as RankedStart['seats'][number]['account'],
      row: { state: initialState(ladder === 'pod-commander' ? 'wenglin' : 'glicko2'), season: '2026-10', lastRatedAt: null }, games: 0,
    })),
    status: o.status ?? 'running', closedAt: null,
  };
}

const all = () => true;
const rec = (o: Partial<LedgerGameRecord> = {}, accounts: (string | null)[] = [A, B], ladder: LadderId = '1v1-standard'): LedgerGameRecord => ({
  ...ended(recordOf({ game: gid(1), ladder, accounts: accounts as never, startedAt: T }), {}),
  ...o,
});

function skipOf(x: RatedGame | IntakeSkip): IntakeSkip {
  expect(isIntakeSkip(x), text(x)).toBe(true);
  return x as IntakeSkip;
}

describe('M15-3: toRatedGame, the checks of 8.2 in order', () => {
  it('1-2: no registry entry: unranked (nothing stored) or unregistered (stored, no entry to close, nobody told)', () => {
    expect(skipOf(toRatedGame(rec({ ranked: false, ladder: null }), null, all))).toMatchObject({ skip: 'unranked', closeStartAs: null, notRated: false });
    expect(skipOf(toRatedGame(rec(), null, all))).toMatchObject({ skip: 'unregistered', closeStartAs: null, notRated: false });
  });

  it('3-4: an entry that is not running: lost (stays lost, the seats told) or closed (nothing more)', () => {
    expect(skipOf(toRatedGame(rec(), startOf(gid(1), [A, B], { status: 'lost' }), all))).toMatchObject({ skip: 'lost', closeStartAs: null, notRated: true });
    for (const status of ['applied', 'void', 'skipped'] as const) {
      expect(skipOf(toRatedGame(rec(), startOf(gid(1), [A, B], { status }), all))).toMatchObject({ skip: 'closed', closeStartAs: null, notRated: false });
    }
    // the registry decides before the record: a lost entry stays lost even for an unranked or void record
    expect(skipOf(toRatedGame(rec({ ranked: false }), startOf(gid(1), [A, B], { status: 'lost' }), all)).skip).toBe('lost');
  });

  it('5: a running entry and a record that is not ranked is a mismatch; 6: a void record is void', () => {
    expect(skipOf(toRatedGame(rec({ ranked: false }), startOf(gid(1), [A, B]), all))).toMatchObject({ skip: 'mismatch', closeStartAs: 'skipped', notRated: true });
    const v = skipOf(toRatedGame(rec({ outcome: 'void', reason: 'abandoned', placements: [] }), startOf(gid(1), [A, B]), all));
    expect(v).toMatchObject({ skip: 'void', closeStartAs: 'void', notRated: true });
    expect(v.detail).toContain('abandoned');
  });

  it('7: the ladder, the format, the seat count and the seats must be the entry\'s', () => {
    const s = startOf(gid(1), [A, B]);
    for (const r of [
      rec({ ladder: '1v1-pioneer' }), rec({ ladder: null }), rec({ format: 'pioneer' }), rec({ seats: 3 }),
      rec({ placements: rec().placements.slice(0, 1) }), rec({ placements: [rec().placements[0]!, { ...rec().placements[1]!, seat: 3 }] }),
      rec({ placements: [rec().placements[0]!, { ...rec().placements[1]!, seat: 1 }] }),
    ]) {
      expect(skipOf(toRatedGame(r, s, all)), text(r.ladder)).toMatchObject({ skip: 'mismatch', closeStartAs: 'skipped', notRated: true });
    }
  });

  it('8: a placement naming another account than its registry seat is a mismatch; a null one is rated', () => {
    const s = startOf(gid(1), [A, B]);
    const r = rec();
    r.placements[1]!.account = acc(9);
    expect(skipOf(toRatedGame(r, s, all))).toMatchObject({ skip: 'mismatch', closeStartAs: 'skipped' });
    const anonymised = rec();
    anonymised.placements[1]!.account = null;
    anonymised.placements[1]!.name = 'Deleted player';
    const g = toRatedGame(anonymised, s, all) as RatedGame;
    expect(isIntakeSkip(g)).toBe(false);
    // the registry seat says which account a seat is (D8), never the ledger
    expect(g.seats.map((x) => x.account)).toEqual([A, B]);
  });

  it('8: a registry seat erased while the game ran is the deleted one, whatever its placement still names', () => {
    const s = startOf(gid(1), [A, null]);
    const g = toRatedGame(rec(), s, all) as RatedGame;
    expect(isIntakeSkip(g)).toBe(false);
    expect(g.seats.map((x) => x.account)).toEqual([A, null]);
  });

  it('9: the shared-place rule and the outcome must agree, and the placements be well formed', () => {
    const s = startOf(gid(1), [A, B]);
    const malformed = [
      rec({ placements: rec().placements.map((p) => ({ ...p, place: 2 as const })) }), // 2, 2
      rec({ outcome: 'draw' }), // a draw with places 1, 2
      ended(rec(), { places: [1, 1], outcome: 'win' }), // a win with places 1, 1
      rec({ outcome: 'loss' as never }),
      rec({ turns: -1 }),
      rec({ endedAt: '2026-10-15 12:20' }),
      rec({ placements: [{ ...rec().placements[0]! }, { ...rec().placements[1]!, loss: 'gaveUp' as never }] }),
      rec({ placements: [{ ...rec().placements[0]! }, { ...rec().placements[1]!, outTurn: 2.5 }] }),
    ];
    for (const r of malformed) expect(skipOf(toRatedGame(r, s, all)), text(r.outcome)).toMatchObject({ skip: 'malformed', closeStartAs: 'skipped', notRated: true });
    const draw = toRatedGame(ended(rec(), { places: [1, 1] }), s, all) as RatedGame;
    expect([draw.outcome, draw.seats.map((x) => x.place)]).toEqual(['draw', [1, 1]]);
    // pods: 1, 2, 3, 3 and 1, 2, 2, 4 and 1, 1, 3, 4 pass; 1, 2, 2, 3 fails
    const accounts = [acc(1), acc(2), acc(3), acc(4)];
    const ps = startOf(gid(1), accounts, { ladder: 'pod-commander' });
    const pod = rec({}, accounts, 'pod-commander');
    for (const places of [[1, 2, 3, 3], [1, 2, 2, 4], [4, 1, 3, 2]] as const) expect(isIntakeSkip(toRatedGame(ended(pod, { places: [...places] }), ps, all))).toBe(false);
    expect(isIntakeSkip(toRatedGame(ended(pod, { places: [1, 1, 3, 4] }), ps, all))).toBe(false);
    expect(skipOf(toRatedGame(ended(pod, { places: [1, 2, 2, 3] }), ps, all)).skip).toBe('malformed');
  });

  it('9: cap evidence must be of the game\'s seats and well formed', () => {
    const s = startOf(gid(1), [A, B]);
    const cap = { kind: 'actions' as const, verdict: { kind: 'driver' as const, seat: 2 as const, share: 0.81 }, seats: [{ seat: 1 as const, initiated: 400, chargedMs: 1 }, { seat: 2 as const, initiated: 1700, chargedMs: 2 }] };
    const g = toRatedGame(rec({ cap }), s, all) as RatedGame;
    expect(g.cap).toEqual(cap);
    for (const bad of [
      { ...cap, kind: 'size' }, { ...cap, verdict: { kind: 'driver', seat: 3, share: 0.8 } }, { ...cap, verdict: { kind: 'driver', seat: 1, share: 2 } },
      { ...cap, verdict: { kind: 'maybe' } }, { ...cap, seats: [] }, { ...cap, seats: [cap.seats[0], cap.seats[0]] }, { ...cap, seats: [{ seat: 1, initiated: -1, chargedMs: 0 }] },
    ]) {
      expect(capProblem(bad as never, [1, 2]), text(bad)).not.toBeNull();
      expect(skipOf(toRatedGame(rec({ cap: bad as never }), s, all)).skip).toBe('malformed');
    }
    expect(capProblem(undefined, [1, 2])).toBeNull();
    // copied field by field: nothing else hosted adds rides along
    const extra = toRatedGame(rec({ cap: { ...cap, secret: 'x', seats: cap.seats.map((x) => ({ ...x, session: 'gs_x' })) } as never }), s, all) as RatedGame;
    expect(text(extra.cap)).not.toMatch(/secret|gs_x/);
  });

  it('10: a ladder no longer offered is ladderOff, and only after every other check', () => {
    const s = startOf(gid(1), [A, B]);
    expect(skipOf(toRatedGame(rec(), s, () => false))).toMatchObject({ skip: 'ladderOff', closeStartAs: 'skipped', notRated: true });
    expect(skipOf(toRatedGame(rec({ turns: -1 }), s, () => false)).skip).toBe('malformed');
  });

  it('a rated game carries only what 8.2 lists: no sessions, deck fingerprints or timings', () => {
    const g = toRatedGame(rec(), startOf(gid(1), [A, B]), all) as RatedGame;
    expect(g).toMatchObject({ game: gid(1), ladder: '1v1-standard', season: '2026-10', outcome: 'win', turns: 9, cap: null });
    expect(Object.keys(g.seats[0]!).sort()).toEqual(['account', 'lossRule', 'loss', 'name', 'outTurn', 'place', 'seat'].sort());
    expect(text(g)).not.toMatch(/SESSIONFIXTURE|deckhash|Fixture Burn Deck|timeUsedMs|disconnectedMs|timeouts/);
  });

  it('never throws, even for a record that is not one', () => {
    expect(skipOf(toRatedGame({} as LedgerGameRecord, null, all)).skip).toBe('unranked');
    expect(skipOf(toRatedGame({ ...rec(), placements: null } as unknown as LedgerGameRecord, startOf(gid(1), [A, B]), all)).skip).toBe('mismatch');
  });
});
