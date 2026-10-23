/**
 * M13-7: the ledger's pieces on hand-built states and fixed inputs: loss codes from the engine's citations (commander damage, poison, an empty library
 * on states built by hand), the placement rule for N seats (players out together share one place; draws by CR 104.4a and 104.4c), the record's checks,
 * the append-only writer, the public projection, match history, and the deck fingerprints of prepared decks.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, type GameEvent, type GameState, type PlayerId } from '@openmtg/engine';
import { prepareDeck } from '@openmtg/net/server-kit';
import {
  buildGameRecord, CAUSE_RULE, deckFingerprint, historyFor, ledgerPlacements, ledgerSecret, LedgerError, LOSS_CODES, LOSS_RULES, lossFromRules, lossOf, lossRulesOf,
  preparedDeckHash, PUBLIC_PLACEMENT_KEYS, PUBLIC_RECORD_KEYS, publicRecord, readHistory, summaryOf, writeResult, type GameRecord, type LedgerSeat,
  type SeatNumber,
} from '../../src';
import type { PlacementSeat, SeatOutcome, TableEnd } from '../../src/table';
import { commanderScenario, legend } from '../../../engine/test/m11/rules/helpers';
import { scenario, tweak } from '../../../engine/test/m4/helpers';
import { deck as deckOf, fixtureDb } from '../../../net/test/helpers';
import { ledgerGame, ledgerSeats, MemoryLedgerStore, SECRET } from './helpers';

/** A seat of the placement rule. */
const seat = (n: number, o: Partial<PlacementSeat> = {}): PlacementSeat => ({
  seat: n as SeatNumber, player: `p${n}`, name: `P${n}`, cause: null, outOrder: null, outTurn: null, lossRules: null, timeUsedMs: 1_000 * n, timeouts: 0,
  disconnectedMs: 0, ...o,
});
const out = (n: number, order: number, rules: string[], o: Partial<PlacementSeat> = {}) => seat(n, { outOrder: order, outTurn: 3 + order, lossRules: rules, ...o });

/** A minimal state the placement rule reads: the result and each player's loss. */
const st = (n: number, result: GameState['result'], lost: Record<string, string> = {}, conceded: string[] = []): GameState => ({
  result,
  players: Array.from({ length: n }, (_, i) => `p${i + 1}`).map((id) => ({ id, hasLost: id in lost, lostReason: lost[id], conceded: conceded.includes(id) })),
}) as unknown as GameState;

const brief = (o: SeatOutcome[]) => o.map((p) => [p.seat, p.place, p.loss, p.lossRule]);

/** The end of a game as the table builds it, from the placement rule's outcomes. */
function endOf(state: GameState, seats: PlacementSeat[], o: Partial<TableEnd> = {}): TableEnd {
  const outcomes = ledgerPlacements(state, seats);
  return {
    outcome: state.result!.winner === null ? 'draw' : 'win', reason: state.result!.reason, result: { ...state.result! }, at: 3_600_000, seq: 40, actions: 38, turns: 9,
    seats: outcomes, ...o,
  };
}

const lostOf = (events: readonly GameEvent[]) => lossRulesOf(events);

describe('M13-7: loss codes', () => {
  it('every engine citation the engine emits maps to its code; anything else is an effect (CR 104.3e)', () => {
    expect(lossFromRules(['CR 704.5a'])).toEqual({ loss: 'life', lossRule: 'CR 704.5a' });
    expect(lossFromRules(['CR 704.5b'])).toEqual({ loss: 'emptyLibrary', lossRule: 'CR 704.5b' });
    expect(lossFromRules(['CR 704.5c'])).toEqual({ loss: 'poison', lossRule: 'CR 704.5c' });
    expect(lossFromRules(['CR 704.6c'])).toEqual({ loss: 'commanderDamage', lossRule: 'CR 704.6c' });
    expect(lossFromRules(['CR 104.3a'])).toEqual({ loss: 'concession', lossRule: 'CR 104.3a' });
    expect(lossFromRules(['CR 104.3e'])).toEqual({ loss: 'effect', lossRule: 'CR 104.3e' });
    expect(lossFromRules(['CR 104.2b'])).toEqual({ loss: 'opponentWon', lossRule: 'CR 104.2b' });
    expect(lossFromRules(['CR 999.9z'])).toEqual({ loss: 'effect', lossRule: 'CR 999.9z' });
    expect(lossFromRules([])).toBeNull();
    expect(lossFromRules(undefined)).toBeNull();
    // the citations name only codes of design 7, and every code but the table's own and 'draw' is reachable from a citation
    for (const code of Object.values(LOSS_RULES)) expect(LOSS_CODES).toContain(code);
    expect(new Set(Object.values(LOSS_RULES))).toEqual(new Set(LOSS_CODES.filter((c) => !['left', 'timeout', 'disconnect', 'draw'].includes(c))));
  });

  it('the table\'s cause comes first, then the citations, then the reason text', () => {
    expect(lossOf('conceded', 'timeout', ['CR 104.3a'])).toEqual({ loss: 'timeout', lossRule: CAUSE_RULE });
    expect(lossOf('conceded', 'disconnect', ['CR 104.3a'])).toEqual({ loss: 'disconnect', lossRule: CAUSE_RULE });
    expect(lossOf('conceded', 'left', ['CR 104.3a'])).toEqual({ loss: 'left', lossRule: CAUSE_RULE });
    // a reason text that reads like another loss does not override the citation
    expect(lossOf('has 0 or less life', null, ['CR 704.5c'])).toEqual({ loss: 'poison', lossRule: 'CR 704.5c' });
    expect(lossOf('has 0 or less life', null, null)).toEqual({ loss: 'life', lossRule: 'CR 704.5a' });
    expect(lossOf(undefined, null)).toEqual({ loss: 'effect', lossRule: 'CR 104.3e' });
  });

  it('hand-built states: commander damage (CR 704.6c), poison (704.5c), an empty library (704.5b) and both at once (a draw, 104.4a)', () => {
    const titania = legend('Test Titania', '{G}', ['5', '5'], ['G']);
    const bob = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
    const c0 = commanderScenario({ variant: 'commander', p1Commanders: [titania], p2Commanders: [bob] });
    const card = c0.players.find((p) => p.id === 'p1')!.commanders![0]!.card;
    const cases: [string, GameState, Record<PlayerId, string>][] = [
      ['commander', tweak(c0, (t) => { t.players.find((p) => p.id === 'p2')!.commanderDamage = { [card]: 21 }; }), { p2: 'commanderDamage' }],
      ['poison', tweak(scenario([]), (t) => { t.players[1]!.poison = 12; }), { p2: 'poison' }],
      ['library', tweak(scenario([]), (t) => { t.players[0]!.drewFromEmptyLibrary = true; }), { p1: 'emptyLibrary' }],
      ['both', tweak(scenario([]), (t) => { t.players[0]!.poison = 10; t.players[1]!.life = -2; }), { p1: 'draw', p2: 'draw' }],
    ];
    for (const [what, s0, want] of cases) {
      const r = applyAction(s0, { type: 'pass', player: s0.pending!.player });
      expect(r.error, what).toBeUndefined();
      const rules = lostOf(r.events);
      const seats = ['p1', 'p2'].map((id, i) => seat(i + 1, rules.has(id) ? { outOrder: 1, outTurn: r.state.turn.number, lossRules: rules.get(id)! } : {}));
      const end = endOf(r.state, seats);
      expect(end.seats.map((p) => p.loss ?? 'won'), what).toEqual(['p1', 'p2'].map((id) => want[id] ?? 'won'));
      const record = buildGameRecord({ game: ledgerGame(`hand-${what}`), end, seats: ledgerSeats(2) });
      expect(record.outcome).toBe(what === 'both' ? 'draw' : 'win');
      if (what === 'both') expect(rules).toEqual(new Map([['p1', ['CR 704.5c']], ['p2', ['CR 704.5a']]]));
    }
  });
});

describe('M13-7: placements for N seats (written for pods; tested with 4 seats on fixed states, M13-16 plays them)', () => {
  it('a win: the winner 1st, then the latest out; two players out at once share one place (1, 2, 3, 3; review 11)', () => {
    const s = st(4, { winner: 'p1', reason: 'P1 is the last player remaining' }, { p2: 'conceded', p3: 'has 0 or less life', p4: 'has 0 or less life' }, ['p2']);
    const seats = [seat(1), out(2, 2, ['CR 104.3a'], { cause: 'left' }), out(3, 1, ['CR 704.5a']), out(4, 1, ['CR 704.5a'])];
    expect(brief(ledgerPlacements(s, seats))).toEqual([[1, 1, null, null], [2, 2, 'left', 'CR 104.3a'], [3, 3, 'life', 'CR 704.5a'], [4, 3, 'life', 'CR 704.5a']]);
    const end = endOf(s, seats);
    const record = buildGameRecord({ game: ledgerGame('pod-win', 4), end, seats: ledgerSeats(4) });
    expect(record.placements.map((p) => [p.seat, p.place, p.outOrder])).toEqual([[1, 1, null], [2, 2, 2], [3, 3, 1], [4, 3, 1]]);
  });

  it('players out at different times keep their order: 1, 2, 3, 4 (the first out last)', () => {
    const s = st(4, { winner: 'p3', reason: 'x' }, { p1: 'a', p2: 'b', p4: 'c' });
    const seats = [out(1, 3, ['CR 704.5a']), out(2, 1, ['CR 704.5b']), seat(3), out(4, 2, ['CR 104.3e'])];
    expect(brief(ledgerPlacements(s, seats))).toEqual([[1, 2, 'life', 'CR 704.5a'], [2, 4, 'emptyLibrary', 'CR 704.5b'], [3, 1, null, null], [4, 3, 'effect', 'CR 104.3e']]);
  });

  it('a draw by an effect (CR 104.4c) with one player out before: the three still in share 1st, the one out keeps its loss, 4th', () => {
    const s = st(4, { winner: null, reason: 'Test Draw' }, { p4: 'has ten or more poison counters' });
    const seats = [seat(1), seat(2), seat(3), out(4, 1, ['CR 704.5c'])];
    expect(brief(ledgerPlacements(s, seats))).toEqual([[1, 1, 'draw', 'CR 104.4c'], [2, 1, 'draw', 'CR 104.4c'], [3, 1, 'draw', 'CR 104.4c'], [4, 4, 'poison', 'CR 704.5c']]);
    buildGameRecord({ game: ledgerGame('pod-draw', 4), end: endOf(s, seats), seats: ledgerSeats(4) });
  });

  it('a draw because every player still in lost at once (CR 104.4a): the last set drew, 1st; the earlier loser 3rd', () => {
    const s = st(3, { winner: null, reason: 'all players lost simultaneously' }, { p1: 'x', p2: 'y', p3: 'z' });
    const seats = [out(1, 2, ['CR 704.5a']), out(2, 2, ['CR 704.5b']), out(3, 1, ['CR 704.5a'])];
    expect(brief(ledgerPlacements(s, seats))).toEqual([[1, 1, 'draw', 'CR 104.4a'], [2, 1, 'draw', 'CR 104.4a'], [3, 3, 'life', 'CR 704.5a']]);
    // "every player loses the game at once" (effects/handlers/game.ts) is a draw by CR 104.4a with the players still in
    const e = st(2, { winner: null, reason: 'every player loses the game at once (Test\'s effect)' });
    expect(brief(ledgerPlacements(e, [seat(1), seat(2)]))).toEqual([[1, 1, 'draw', 'CR 104.4a'], [2, 1, 'draw', 'CR 104.4a']]);
  });

  it('a seat the table conceded for is never a drawer, even out in the last set', () => {
    const s = st(3, { winner: null, reason: 'all players lost simultaneously' }, { p1: 'x', p2: 'conceded', p3: 'z' }, ['p2']);
    const seats = [out(1, 1, ['CR 704.5a']), out(2, 1, ['CR 104.3a'], { cause: 'timeout', timeouts: 1 }), out(3, 1, ['CR 704.5a'])];
    expect(brief(ledgerPlacements(s, seats))).toEqual([[1, 1, 'draw', 'CR 104.4a'], [2, 3, 'timeout', 'CR 104.3a'], [3, 1, 'draw', 'CR 104.4a']]);
  });

  it('refuses a game without a result', () => {
    expect(() => ledgerPlacements(st(2, null), [seat(1), seat(2)])).toThrow(/no result/);
  });
});

describe('M13-7: the record and its checks', () => {
  const s2 = st(2, { winner: 'p1', reason: 'x' }, { p2: 'has 0 or less life' });
  const seats2 = () => [seat(1), out(2, 1, ['CR 704.5a'])];
  const good = () => ({ game: ledgerGame('g1'), end: endOf(s2, seats2()), seats: ledgerSeats(2) });

  it('a won game: placements in seat order with the tables layer\'s identity, times as ISO, ranked false', () => {
    const r = buildGameRecord({ ...good(), seats: [...ledgerSeats(2)].reverse() });
    expect(r).toMatchObject({ game: 'g1', format: 'casual', variant: null, seats: 2, source: 'listed', ranked: false, outcome: 'win', reason: 'x', turns: 9, actions: 38,
      startedAt: '1970-01-01T00:00:00.000Z', endedAt: '1970-01-01T01:00:00.000Z', engineBuild: 'test-build' });
    expect(r.placements).toEqual([
      { seat: 1, name: 'P1', place: 1, loss: null, lossRule: null, outTurn: null, player: 'p1', session: '01JSESSION000000000000000S1', account: null, deckHash: 'a'.repeat(64), outOrder: null, timeUsedMs: 1000, timeouts: 0, disconnectedMs: 0 },
      { seat: 2, name: 'P2', place: 2, loss: 'life', lossRule: 'CR 704.5a', outTurn: 4, player: 'p2', session: '01JSESSION000000000000000S2', account: null, deckHash: 'b'.repeat(64), outOrder: 1, timeUsedMs: 2000, timeouts: 0, disconnectedMs: 0 },
    ]);
    expect(r.seatActions).toEqual([{ seat: 1, actions: 0 }, { seat: 2, actions: 0 }]);
  });

  it('the per-seat actions come from the last record\'s clock readings', () => {
    const last = { game: 'g1', seq: 40, seat: 2, action: { type: 'pass', player: 'p2' } as const, clocks: [{ seat: 2, bankMs: 1, dropMs: 1, delayMs: 0, period: 7, actions: 19 }, { seat: 1, bankMs: 1, dropMs: 1, delayMs: 0, period: 7, actions: 21 }], elapsedMs: 1, at: '1970-01-01T01:00:00.000Z' };
    expect(buildGameRecord({ ...good(), last }).seatActions).toEqual([{ seat: 1, actions: 21 }, { seat: 2, actions: 19 }]);
    expect(() => buildGameRecord({ ...good(), last: { ...last, game: 'other' } })).toThrow(/of game other/);
    expect(() => buildGameRecord({ ...good(), last: { ...last, seq: 39 } })).toThrow(/seq 39/);
  });

  it('refuses records that do not add up (nothing is written)', () => {
    const bad: [string, () => unknown][] = [
      ['seat count', () => buildGameRecord({ ...good(), seats: ledgerSeats(1) })],
      ['duplicate seat', () => buildGameRecord({ ...good(), seats: [ledgerSeats(2)[0]!, ledgerSeats(2)[0]!] })],
      ['seat out of the table', () => buildGameRecord({ ...good(), seats: [ledgerSeats(2)[0]!, { ...ledgerSeats(2)[1]!, seat: 3 }] })],
      ['no session', () => buildGameRecord({ ...good(), seats: [ledgerSeats(2)[0]!, { ...ledgerSeats(2)[1]!, session: '' }] })],
      ['fingerprint', () => buildGameRecord({ ...good(), seats: [ledgerSeats(2)[0]!, { ...ledgerSeats(2)[1]!, deckHash: 'Z'.repeat(64) }] })],
      ['two winners', () => buildGameRecord({ ...good(), end: { ...good().end, seats: good().end.seats.map((p) => ({ ...p, loss: null, lossRule: null, place: 1 as const })) } })],
      ['a draw with a winner', () => buildGameRecord({ ...good(), end: { ...good().end, outcome: 'draw' } })],
      ['a loss without its rule', () => buildGameRecord({ ...good(), end: { ...good().end, seats: good().end.seats.map((p) => ({ ...p, lossRule: null })) } })],
      ['unknown loss code', () => buildGameRecord({ ...good(), end: { ...good().end, seats: good().end.seats.map((p) => (p.loss ? { ...p, loss: 'boredom' as never } : p)) } })],
      ['timeouts 2', () => buildGameRecord({ ...good(), end: { ...good().end, seats: good().end.seats.map((p) => ({ ...p, timeouts: 2 })) } })],
      ['place past the table', () => buildGameRecord({ ...good(), end: { ...good().end, seats: good().end.seats.map((p) => (p.loss ? { ...p, place: 3 as const } : p)) } })],
      ['void with placements', () => buildGameRecord({ ...good(), end: { ...good().end, outcome: 'void', reason: 'limit', result: null } })],
      ['unknown void reason', () => buildGameRecord({ ...good(), end: { ...good().end, outcome: 'void', reason: 'bored', result: null, seats: [] } })],
      ['no game id', () => buildGameRecord({ ...good(), game: { ...good().game, game: '' } })],
    ];
    for (const [what, f] of bad) expect(f, what).toThrow(LedgerError);
  });
});

describe('M13-7: writing the ledger (append-only, through the store interface)', () => {
  const s2 = st(2, { winner: 'p2', reason: 'x' }, { p1: 'conceded' }, ['p1']);
  const input = (game: string) => ({ game: ledgerGame(game), end: endOf(s2, [out(1, 1, ['CR 104.3a']), seat(2)]), seats: ledgerSeats(2) });

  it('finishGame once with the record; the last record goes into the same transaction only when asked', async () => {
    const store = new MemoryLedgerStore();
    const last = { game: 'w1', seq: 40, seat: 1, action: { type: 'concede', player: 'p1' } as const, clocks: [], elapsedMs: 5, at: '1970-01-01T01:00:00.000Z' };
    const r = await writeResult(store, { ...input('w1'), last, commitLast: true });
    expect(store.finished.get('w1')).toEqual({ record: r, last });
    await writeResult(store, { ...input('w2'), last: { ...last, game: 'w2' } });
    expect(store.finished.get('w2')?.last).toBeUndefined();
    // append-only: a second result for the same game is refused by the store
    await expect(writeResult(store, input('w1'))).rejects.toThrow(/append-only/);
    expect(store.finished.get('w1')?.record).toEqual(r);
  });

  it('a record that does not add up is never written', async () => {
    const store = new MemoryLedgerStore();
    await expect(writeResult(store, { ...input('bad'), seats: ledgerSeats(1) })).rejects.toThrow(LedgerError);
    expect(store.finished.size + store.voided.size).toBe(0);
  });

  it('a void game: voidGame with its status; its records must be committed first', async () => {
    const store = new MemoryLedgerStore();
    const end: TableEnd = { outcome: 'void', reason: 'recovery', result: null, at: 10, seq: 0, actions: 0, turns: 1, seats: [] };
    await expect(writeResult(store, { game: ledgerGame('v1'), end, seats: ledgerSeats(2), commitLast: true })).rejects.toThrow(/committed with appendRecords first/);
    const r = await writeResult(store, { game: ledgerGame('v1'), end, seats: ledgerSeats(2) });
    expect(r).toMatchObject({ outcome: 'void', reason: 'recovery', placements: [] });
    // the record goes with it, so the void game reaches results() with its counts (M13-4: voidGame's record)
    expect(store.voided.get('v1')).toEqual({ reason: 'recovery', status: 'void', record: r });
    await expect(writeResult(store, { game: ledgerGame('v1'), end, seats: ledgerSeats(2) })).rejects.toThrow(/append-only/);
  });
});

describe('M13-7: the public projection and match history', () => {
  const record = (game: string, endedAt: string, o: { winner?: 1 | 2; sessions?: [string, string]; format?: string; draw?: boolean } = {}): GameRecord => {
    const s = o.draw ? st(2, { winner: null, reason: 'all players lost simultaneously' }, { p1: 'a', p2: 'b' }) : st(2, { winner: `p${o.winner ?? 1}`, reason: 'x' }, { [`p${o.winner === 2 ? 1 : 2}`]: 'has 0 or less life' });
    const seats = o.draw ? [out(1, 1, ['CR 704.5a']), out(2, 1, ['CR 704.5a'])] : o.winner === 2 ? [out(1, 1, ['CR 704.5a']), seat(2)] : [seat(1), out(2, 1, ['CR 704.5a'])];
    const ids: LedgerSeat[] = ledgerSeats(2).map((x, i) => ({ ...x, session: o.sessions?.[i] ?? x.session, account: 'acct-secret' }));
    const r = buildGameRecord({ game: { ...ledgerGame(game), format: o.format ?? 'standard' }, end: endOf(s, seats), seats: ids });
    return { ...r, endedAt };
  };

  it('publicRecord: exactly the public keys; no session, account, fingerprint, player id, timings, engine build or action counts', () => {
    const r = record('pub1', '2026-10-15T10:00:00.000Z', { winner: 2 });
    const pub = publicRecord(r);
    expect(Object.keys(pub)).toEqual([...PUBLIC_RECORD_KEYS]);
    for (const p of pub.placements) expect(Object.keys(p)).toEqual([...PUBLIC_PLACEMENT_KEYS]);
    expect(pub.placements.map((p) => [p.seat, p.place])).toEqual([[2, 1], [1, 2]]); // best place first
    const text = JSON.stringify(pub);
    for (const secret of ['01JSESSION', 'acct-secret', 'a'.repeat(64), 'b'.repeat(64), '"p1"', '"p2"', 'timeUsedMs', 'disconnectedMs', 'timeouts', 'outOrder', 'test-build', 'seatActions', '"actions"']) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('historyFor: a session\'s games newest first with its own placement; other sessions\' games and void games are left out', () => {
    const me = 'SESSION-ME';
    const records = [
      record('h1', '2026-10-15T10:00:00.000Z', { sessions: [me, 'X'] }),
      record('h2', '2026-10-15T12:00:00.000Z', { sessions: ['Y', me], winner: 1, format: 'pauper' }),
      record('h3', '2026-10-15T11:00:00.000Z', { sessions: ['Y', 'Z'] }),
      record('h4', '2026-10-15T13:00:00.000Z', { sessions: [me, 'Z'], draw: true }),
      { ...record('h5', '2026-10-15T14:00:00.000Z', { sessions: [me, 'Z'] }), outcome: 'void' as const, reason: 'limit', placements: [] },
    ];
    const h = historyFor(records, me);
    expect(h.map((e) => [e.game, e.you.seat, e.you.place, e.you.loss])).toEqual([['h4', 1, 1, 'draw'], ['h2', 2, 2, 'life'], ['h1', 1, 1, null]]);
    expect(historyFor(records, me, 2).map((e) => e.game)).toEqual(['h4', 'h2']);
    expect(JSON.stringify(h)).not.toContain(me);
    expect(summaryOf(h)).toEqual({ games: 3, wins: 1, draws: 1, losses: 1, byFormat: { standard: { games: 2, wins: 1, draws: 1, losses: 0 }, pauper: { games: 1, wins: 0, draws: 0, losses: 1 } } });
  });

  it('readHistory reads the session\'s newest games through the store\'s by-session query (no scan of every result)', async () => {
    const store = new MemoryLedgerStore();
    const me = 'SESSION-ME';
    const times = ['10', '11', '11', '11', '12', '13'].map((h) => `2026-10-15T${h}:00:00.000Z`);
    for (const [i, t] of times.entries()) {
      const r = record(`r${i}`, t, { sessions: [i % 2 === 0 ? me : 'X', 'Y'] });
      await store.finishGame(r.game, r);
    }
    const h = await readHistory(store, me, { since: new Date('2026-10-15T00:00:00.000Z') });
    expect(h.map((e) => e.game)).toEqual(['r4', 'r2', 'r0']);
    expect(store.sessionReads).toEqual([{ session: me, since: '2026-10-15T00:00:00.000Z', limit: 50 }]);
    expect(store.reads).toEqual([]);
    // the earliest end time and the limit go to the store
    const few = await readHistory(store, me, { since: new Date('2026-10-15T10:30:00.000Z'), limit: 1 });
    expect(few.map((e) => e.game)).toEqual(['r4']);
  });
});

describe('M13-7: deck fingerprints of prepared decks', () => {
  it('the same cards give the same fingerprint however the player spelled or ordered them; the secret and every card count matter', async () => {
    const prep = async (main: Record<string, number>, side: Record<string, number> = {}) => {
      const r = await prepareDeck(deckOf(main, side), { cards: fixtureDb(), format: 'casual' });
      if (!r.ok) throw new Error(r.errors.join('; '));
      return r.deck;
    };
    const a = await prep({ Forest: 10, 'grizzly bears': 4 }, { 'Hill Giant': 2 });
    const b = await prep({ 'Grizzly Bears': 4, forest: 10 }, { 'hill giant': 2 });
    const h = preparedDeckHash(SECRET, a);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(preparedDeckHash(SECRET, b)).toBe(h);
    expect(h).toBe(deckFingerprint(SECRET, { main: a.main, sideboard: a.sideboard, commanders: a.commanders }));
    expect(preparedDeckHash(`${SECRET}0`, a)).not.toBe(h);
    expect(preparedDeckHash(SECRET, await prep({ Forest: 10, 'Grizzly Bears': 3 }, { 'Hill Giant': 2 }))).not.toBe(h);
    expect(preparedDeckHash(SECRET, await prep({ Forest: 10, 'Grizzly Bears': 4, 'Hill Giant': 2 }))).not.toBe(h);
    // the fingerprint does not contain the list, and the list cannot be checked against it without the secret
    expect(h).not.toContain('Forest');
  });

  it('the ledger secret: LEDGER_SECRET when set, else a random 64-hex one for this process', () => {
    const configured = 'f'.repeat(64);
    expect(ledgerSecret(configured)).toEqual({ secret: configured, ephemeral: false });
    const r = ledgerSecret(null, (n) => new Uint8Array(n).fill(171));
    expect(r).toEqual({ secret: 'ab'.repeat(32), ephemeral: true });
    const a = ledgerSecret(null);
    expect(a.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(ledgerSecret(null).secret).not.toBe(a.secret);
  });
});
