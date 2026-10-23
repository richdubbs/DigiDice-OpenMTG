/**
 * M13-7: every loss code from real engine games played through the table actor (in process, fake time): the engine's `playerLost.rules` give the loss
 * code and citation (life, empty library, poison, an effect, another player winning), the table's causes give its own (concession, Leave, time-out,
 * disconnect forfeit), a simultaneous loss is a draw shared in 1st place, and void games have no placements but their per-seat action counts. Each
 * end becomes a `GameRecord` through the ledger and the memory store. A rebuilt table (recovery) gives the same placements.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, type GameEvent } from '@openmtg/engine';
import { buildGameRecord, lossFromRules, lossRulesOf, writeResult, type LossCode } from '../../src';
import { TableActor, type TableEnd } from '../../src/table';
import { configOf, DECKS, Harness, MIN, playAi, SEC, type Msg } from '../m13-2/harness';
import { drive, ledgerGame, ledgerSeats, MemoryLedgerStore, scriptedConfig, type SpellKey } from './helpers';

/** A scripted game: p1 casts the spell at p2 (or none), everyone else passes. */
function scripted(seed: string, spell: SpellKey | null, o: { startingLife?: number; p2Cards?: number; target?: 'p1' | 'p2' } = {}): Harness {
  const config = scriptedConfig(seed, spell, o);
  const h = new Harness({ config, game: seed });
  const p1 = h.b(1).player;
  const p2 = h.b(2).player;
  drive(h, spell ? { caster: p1, spell: SPELLS_BY_KEY[spell], target: o.target === 'p1' ? p1 : p2 } : {});
  return h;
}

const SPELLS_BY_KEY: Record<SpellKey, string> = { quake: 'Test Quake', doom: 'Test Doom', triumph: 'Test Triumph', venom: 'Test Venom' };

/** The seat that lost and its placement. */
const loser = (end: TableEnd) => end.seats.find((s) => s.loss !== null)!;

/** The end goes into the ledger: a record with both seats' identity, written once. */
async function ledgerOf(h: Harness, end: TableEnd) {
  const store = new MemoryLedgerStore();
  const record = await writeResult(store, { game: ledgerGame(h.actor.game), end, seats: ledgerSeats(2), last: h.records[h.records.length - 1] ?? null });
  return { store, record };
}

describe('M13-7: loss codes from the engine\'s citations (whole games through the table)', () => {
  const cases: { name: string; spell: SpellKey | null; o?: { startingLife?: number; p2Cards?: number; target?: 'p1' | 'p2' }; loss: LossCode; rule: string; winnerSeat: 1 | 2 }[] = [
    { name: 'empty library (CR 704.5b): p2 has 7 cards and draws an 8th', spell: null, o: { p2Cards: 7 }, loss: 'emptyLibrary', rule: 'CR 704.5b', winnerSeat: 1 },
    { name: 'poison (CR 704.5c): ten poison counters', spell: 'venom', loss: 'poison', rule: 'CR 704.5c', winnerSeat: 1 },
    { name: 'an effect (CR 104.3e): "target player loses the game"', spell: 'doom', loss: 'effect', rule: 'CR 104.3e', winnerSeat: 1 },
    { name: 'another player won (CR 104.2b): "you win the game"', spell: 'triumph', loss: 'opponentWon', rule: 'CR 104.2b', winnerSeat: 1 },
  ];
  for (const c of cases) {
    it(c.name, async () => {
      const h = scripted(`m13-7-${c.loss}`, c.spell, c.o);
      const end = h.actor.ended!;
      expect(end, 'the game ended').not.toBeNull();
      expect(end.outcome).toBe('win');
      const l = loser(end);
      expect(l).toMatchObject({ seat: c.winnerSeat === 1 ? 2 : 1, place: 2, loss: c.loss, lossRule: c.rule, outOrder: 1, timeouts: 0 });
      expect(l.outTurn).toBe(h.state.turn.number);
      expect(end.seats.find((s) => s.loss === null)).toMatchObject({ seat: c.winnerSeat, place: 1, lossRule: null, outTurn: null, outOrder: null });
      // the result both seats received: public placements only, the same codes
      for (const seat of [1, 2]) {
        const res = h.b(seat).inbox.find((m) => m.t === 'result') as Extract<Msg, { t: 'result' }>;
        expect(res.placements.map((p) => [p.seat, p.place, p.loss, p.lossRule])).toEqual([[c.winnerSeat, 1, null, null], [l.seat, 2, c.loss, c.rule]]);
      }
      const { store, record } = await ledgerOf(h, end);
      expect(record).toMatchObject({ game: h.actor.game, outcome: 'win', ranked: false, seats: 2, turns: end.turns, actions: end.actions });
      expect(record.placements.map((p) => [p.seat, p.place, p.loss, p.session])).toEqual(
        [1, 2].map((s) => [s, s === c.winnerSeat ? 1 : 2, s === c.winnerSeat ? null : c.loss, `01JSESSION000000000000000S${s}`]),
      );
      expect(store.finished.get(h.actor.game)?.record).toEqual(record);
      // a rebuilt table finds the same placements (the citations are collected again on replay)
      const { step } = TableActor.recover({ game: h.actor.game, config: h.actor.config, seating: [1, 2], at: h.at + MIN, records: h.records });
      expect(step.end?.seats.map((s) => [s.seat, s.place, s.loss, s.lossRule, s.outOrder, s.outTurn])).toEqual(end.seats.map((s) => [s.seat, s.place, s.loss, s.lossRule, s.outOrder, s.outTurn]));
    }, 60_000);
  }

  it('the loss codes come from the citations, not the reason text: the replayed events give the same code', () => {
    const h = scripted('m13-7-cite', 'venom');
    let s = createGame(h.actor.config);
    const events: GameEvent[] = [];
    for (const r of h.records) {
      const out = applyAction(s, r.action);
      s = out.state;
      events.push(...out.events);
    }
    const rules = lossRulesOf(events);
    const l = loser(h.actor.ended!);
    expect(rules.get(l.player)).toEqual(['CR 704.5c']);
    expect(lossFromRules(rules.get(l.player))).toEqual({ loss: l.loss, lossRule: l.lossRule });
  }, 60_000);

  it('a draw (CR 104.4a): both players at 3 life lose 3 at once and share 1st place, loss "draw", one out order', async () => {
    const h = scripted('m13-7-draw', 'quake', { startingLife: 3 });
    const end = h.actor.ended!;
    expect(end).toMatchObject({ outcome: 'draw', reason: 'all players lost simultaneously', result: { winner: null } });
    expect(end.seats.map((s) => [s.seat, s.place, s.loss, s.lossRule, s.outOrder])).toEqual([[1, 1, 'draw', 'CR 104.4a', 1], [2, 1, 'draw', 'CR 104.4a', 1]]);
    const { record } = await ledgerOf(h, end);
    expect(record.outcome).toBe('draw');
    expect(record.placements.map((p) => [p.place, p.loss])).toEqual([[1, 'draw'], [1, 'draw']]);
  }, 60_000);
});

describe('M13-7: life losses in seeded AI games', () => {
  for (const [seed, d1, d2] of [['m13-7-ai-a', 0, 1], ['m13-7-ai-b', 2, 0]] as const) {
    it(`${seed}: the loser's code is the engine's citation (life, CR 704.5a, in these games), the record adds up`, async () => {
      const h = new Harness({ config: configOf(seed, DECKS[d1]!, DECKS[d2]!), game: seed, scan: false });
      playAi(h, seed);
      const end = h.actor.ended!;
      expect(end.outcome).toBe('win');
      let s = createGame(h.actor.config);
      const events: GameEvent[] = [];
      for (const r of h.records) {
        const out = applyAction(s, r.action);
        s = out.state;
        events.push(...out.events);
      }
      const l = loser(end);
      const cited = lossFromRules(lossRulesOf(events).get(l.player));
      expect(cited).toEqual({ loss: l.loss, lossRule: l.lossRule });
      expect(l.loss).toBe('life');
      const { record } = await ledgerOf(h, end);
      expect(record.placements.find((p) => p.loss === null)?.place).toBe(1);
      expect(record.seatActions!.map((a) => a.seat)).toEqual([1, 2]);
      expect(record.seatActions!.reduce((n, a) => n + a.actions, 0)).toBeGreaterThan(0);
    }, 120_000);
  }
});

describe('M13-7: the table\'s own causes', () => {
  const table = (seed: string) => new Harness({ config: scriptedConfig(seed, null), game: seed });

  it('a concession in game (CR 104.3a): "concession"', async () => {
    const h = table('m13-7-concede');
    h.act(2, { type: 'concede', player: h.b(2).player });
    expect(loser(h.actor.ended!)).toMatchObject({ seat: 2, place: 2, loss: 'concession', lossRule: 'CR 104.3a', timeouts: 0 });
    const { record } = await ledgerOf(h, h.actor.ended!);
    expect(record.placements[1]).toMatchObject({ loss: 'concession', session: '01JSESSION000000000000000S2' });
  });

  it('Leave: "left" (a concession that also left the table)', () => {
    const h = table('m13-7-leave');
    h.cmd({ t: 'leave', seat: 1, at: h.at + SEC, id: 99 });
    expect(loser(h.actor.ended!)).toMatchObject({ seat: 1, place: 2, loss: 'left', lossRule: 'CR 104.3a' });
  });

  it('a time-out: "timeout", timeouts 1, the bank used', async () => {
    const h = table('m13-7-timeout');
    const seat = h.seatOf(h.state.pending!.player);
    h.cmd({ t: 'tick', at: h.actor.nextDeadline()! });
    const l = loser(h.actor.ended!);
    expect(l).toMatchObject({ seat, loss: 'timeout', lossRule: 'CR 104.3a', timeouts: 1 });
    expect(l.timeUsedMs).toBeGreaterThan(0);
    const { record } = await ledgerOf(h, h.actor.ended!);
    expect(record.placements.find((p) => p.seat === seat)).toMatchObject({ timeouts: 1, timeUsedMs: l.timeUsedMs });
  });

  it('a disconnect forfeit: "disconnect", the allowance used', async () => {
    const h = table('m13-7-drop');
    const away = h.state.pending!.player === h.b(1).player ? 2 : 1;
    h.cmd({ t: 'disconnect', seat: away, at: 1_000 });
    h.cmd({ t: 'tick', at: h.actor.nextDeadline()! });
    const l = loser(h.actor.ended!);
    expect(l).toMatchObject({ seat: away, loss: 'disconnect', lossRule: 'CR 104.3a', timeouts: 0, disconnectedMs: 5 * MIN });
    const { record } = await ledgerOf(h, h.actor.ended!);
    expect(record.placements.find((p) => p.seat === away)).toMatchObject({ loss: 'disconnect', disconnectedMs: 5 * MIN });
  });
});

describe('M13-7: void games', () => {
  it('abandoned: no placements, never rated; the store marks it void, the per-seat actions are kept on the record', async () => {
    const h = new Harness({ config: scriptedConfig('m13-7-void', null), game: 'm13-7-void' });
    drive(h, { max: 6 });
    h.cmd({ t: 'disconnect', seat: 1, at: h.at + SEC });
    h.cmd({ t: 'disconnect', seat: 2, at: h.at + 2 * SEC });
    h.cmd({ t: 'tick', at: h.actor.nextDeadline()! });
    const end = h.actor.ended!;
    expect(end).toMatchObject({ outcome: 'void', reason: 'abandoned', seats: [] });
    const store = new MemoryLedgerStore();
    const last = h.records[h.records.length - 1]!;
    const record = await writeResult(store, { game: ledgerGame('m13-7-void'), end, seats: ledgerSeats(2), last });
    expect(record).toMatchObject({ outcome: 'void', reason: 'abandoned', placements: [], ranked: false });
    expect(record.seatActions).toEqual(last.clocks.map((c) => ({ seat: c.seat, actions: c.actions })));
    expect(record.seatActions!.reduce((n, a) => n + a.actions, 0)).toBeGreaterThan(0);
    expect(store.voided.get('m13-7-void')).toEqual({ reason: 'abandoned', status: 'void', record }); // the counts reach results() (M13-4)
    expect(store.finished.size).toBe(0);
  });

  it('the per-game action cap ("limit"): void, with each seat\'s share of the actions for milestone 15 (design 5.5)', async () => {
    const h = new Harness({ config: scriptedConfig('m13-7-cap', null), game: 'm13-7-cap', limits: { actions: 12 } });
    drive(h, { max: 40 });
    const end = h.actor.ended!;
    expect(end).toMatchObject({ outcome: 'void', reason: 'limit', actions: 12 });
    const record = buildGameRecord({ game: ledgerGame('m13-7-cap'), end, seats: ledgerSeats(2), last: h.records[h.records.length - 1]! });
    expect(record.placements).toEqual([]);
    const total = record.seatActions!.reduce((n, a) => n + a.actions, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(12);
  });

  it('the runtime\'s voids (commit, quarantined): quarantine keeps its own status', async () => {
    for (const reason of ['commit', 'quarantined'] as const) {
      const h = new Harness({ config: scriptedConfig(`m13-7-${reason}`, null), game: `m13-7-${reason}` });
      h.cmd({ t: 'void', at: h.at + SEC, reason });
      const store = new MemoryLedgerStore();
      const record = await writeResult(store, { game: ledgerGame(`m13-7-${reason}`), end: h.actor.ended!, seats: ledgerSeats(2), last: null });
      expect(record.seatActions).toEqual([{ seat: 1, actions: 0 }, { seat: 2, actions: 0 }]);
      expect(store.voided.get(`m13-7-${reason}`)?.status).toBe(reason === 'quarantined' ? 'quarantined' : 'void');
    }
  });
});
