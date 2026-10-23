/**
 * The clock inside the table (design 5, D9, D11; M13-3's clock driven by the actor): time-outs and drop forfeits become the seat's concession (CR
 * 104.3a) with their cause, an action after the deadline finds the seat out, the abandonment void, the wall-clock cap, the cancel cap of 3 per control
 * period with its notice, the per-game action cap, and the clock fields of every record (written after `answered` and the next `decision`).
 * Fake time only.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '@openmtg/engine';
import { chooseAction } from '@openmtg/ai';
import { aiMove, configOf, DECKS, fixtureConfig, Harness, MIN, SEC } from './harness';

function newTable(seed = 'm13-2-clock', o: { clock?: { bankMs: number; delayMs: number; dropMs: number } } = {}): Harness {
  return new Harness({ config: fixtureConfig(seed, { Mountain: 20, 'Grizzly Bears': 20 }, { Forest: 20, 'Llanowar Elves': 20 }), game: 'clock', ...o });
}

describe('M13-2: time-outs, forfeits and voids from the clock', () => {
  it('a bank at 0 is the seat\'s concession, cause "timeout" (CR 104.3a): a record, a notice to everyone, the result', () => {
    const h = newTable();
    const seat = h.seatOf(h.state.pending!.player);
    const deadline = h.actor.nextDeadline()!;
    expect(deadline).toBe(5 * SEC + 15 * MIN); // the free delay, then the bank
    const step = h.cmd({ t: 'tick', at: deadline });
    expect(step.records).toHaveLength(1);
    expect(step.records[0]).toMatchObject({ seat, cause: 'timeout', action: { type: 'concede' } });
    expect(step.records[0]!.at).toBe(new Date(deadline).toISOString());
    for (const s of [1, 2]) expect(h.sent(step, s, 'notice').map((n) => [n.kind, n.seat])).toContainEqual(['timeout', seat]);
    expect(step.end?.outcome).toBe('win');
    expect(step.end!.seats.find((s) => s.seat === seat)).toMatchObject({ loss: 'timeout', place: 2, timeouts: 1 });
    expect(step.end!.seats.find((s) => s.seat !== seat)).toMatchObject({ loss: null, place: 1, timeouts: 0 });
    expect(step.nextDeadline).toBeNull();
  });

  it('an action that arrives after the bank ran out finds the seat out: the concession first, then the refusal', () => {
    const h = newTable();
    const p = h.state.pending!;
    const seat = h.seatOf(p.player);
    const late = h.actor.nextDeadline()! + 1;
    const view = h.b(seat).view!;
    const { step, reply } = h.act(seat, chooseAction(view, view.pending!, 'late'), { at: late });
    expect(step.records.map((r) => r.cause)).toEqual(['timeout']);
    expect(reply).toMatchObject({ ok: false, error: { code: 'illegalAction' } });
    expect(step.end?.outcome).toBe('win');
  });

  it('an action at the very instant the bank reaches 0 is in time (inputs at an instant come first)', () => {
    const h = newTable();
    const seat = h.seatOf(h.state.pending!.player);
    const view = h.b(seat).view!;
    const { step, reply } = h.act(seat, chooseAction(view, view.pending!, 'edge'), { at: h.actor.nextDeadline()! });
    expect(reply?.ok).toBe(true);
    expect(step.records.map((r) => r.cause)).toEqual([undefined]);
  });

  it('a seat away for its whole disconnect allowance forfeits: concession with cause "disconnect"', () => {
    const h = newTable('m13-2-forfeit', { clock: { bankMs: 60 * MIN, delayMs: 5 * SEC, dropMs: 5 * MIN } });
    const away = h.state.pending!.player === h.b(1).player ? 2 : 1; // the seat that is not deciding drops
    h.cmd({ t: 'disconnect', seat: away as 1, at: 1_000 });
    expect(h.actor.nextDeadline()).toBe(1_000 + 5 * MIN);
    const step = h.cmd({ t: 'tick', at: 1_000 + 5 * MIN });
    expect(step.records[0]).toMatchObject({ seat: away, cause: 'disconnect' });
    expect(step.end!.seats.find((s) => s.seat === away)).toMatchObject({ loss: 'disconnect', place: 2, disconnectedMs: 5 * MIN });
    expect(h.sent(step, away === 1 ? 2 : 1, 'notice').map((n) => n.kind)).toContain('forfeit');
  });

  it('nobody connected: the drop clocks pause and the game is void after 5 minutes ("abandoned"), with no records and no placements', () => {
    const h = newTable();
    h.cmd({ t: 'disconnect', seat: 1, at: 1_000 });
    const second = h.cmd({ t: 'disconnect', seat: 2, at: 11_000 });
    expect(second.records).toEqual([]);
    expect(h.actor.nextDeadline()).toBe(11_000 + 5 * MIN);
    const step = h.cmd({ t: 'tick', at: 11_000 + 5 * MIN });
    expect(step.end).toMatchObject({ outcome: 'void', reason: 'abandoned', result: null, seats: [] });
    expect(step.records).toEqual([]);
    expect(step.sends).toEqual([]); // nobody is connected to be told; a returning seat gets the result
    const back = h.cmd({ t: 'connect', seat: 1, at: 11_000 + 6 * MIN });
    expect(h.sent(back, 1, 'result')[0]).toMatchObject({ outcome: 'void', reason: 'abandoned', placements: [] });
  });

  it('the wall-clock cap: a warning at 90%, void ("limit") at 2 hours', () => {
    const h = newTable('m13-2-wall', { clock: { bankMs: 3 * 60 * MIN, delayMs: 5 * SEC, dropMs: 5 * MIN } });
    const warn = h.cmd({ t: 'tick', at: h.actor.nextDeadline()! });
    expect(h.sent(warn, 1, 'notice').map((n) => n.kind)).toEqual(['limitWarning']);
    expect(h.actor.nextDeadline()).toBe(2 * 60 * MIN);
    const end = h.cmd({ t: 'tick', at: 2 * 60 * MIN });
    expect(end.end).toMatchObject({ outcome: 'void', reason: 'limit' });
    expect(h.sent(end, 2, 'notice').map((n) => n.kind)).toContain('voided');
    expect(h.sent(end, 2, 'result')[0]).toMatchObject({ outcome: 'void', placements: [] });
  });

  it('the runtime can void the game (a failed commit): void with that reason, the result to everyone', () => {
    const h = newTable();
    const step = h.cmd({ t: 'void', at: 5_000, reason: 'commit' });
    expect(step.end).toMatchObject({ outcome: 'void', reason: 'commit' });
    for (const s of [1, 2]) expect(h.sent(step, s, 'result')).toHaveLength(1);
  });
});

describe('M13-2: the clock fields of the records and the clock messages', () => {
  it('every record carries the clocks after `answered` and the next `decision`: the deciding seat holds the latest control period', () => {
    const h = new Harness({ config: configOf('m13-2-fields', DECKS[0]!, DECKS[2]!), game: 'fields', scan: false });
    for (let i = 0; i < 80 && !h.actor.ended; i++) aiMove(h, 'fields', 1_300);
    let checked = 0;
    let state = createGame(h.actor.config);
    for (const r of h.records) {
      state = applyAction(state, r.action).state;
      if (!state.result) {
        // the next decision's seat owns the newest control period: the record was written after `decision`
        const deciding = r.clocks.find((c) => c.seat === h.seatOf(state.pending!.player))!;
        expect(deciding.period).toBe(Math.max(...r.clocks.map((c) => c.period)));
      }
      expect(r.clocks).toHaveLength(2);
      for (const c of r.clocks) {
        expect(c.bankMs).toBeGreaterThan(0);
        expect(c.dropMs).toBe(5 * MIN);
      }
      expect(r.elapsedMs).toBe(Date.parse(r.at)); // the game started at 0 and nobody was away
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
    // The clocks sent to the players: one message per change that started or stopped a clock, in table seats.
    const clocks = h.b(1).inbox.filter((m) => m.t === 'clock');
    expect(clocks.length).toBeGreaterThan(10);
    expect(clocks.every((m) => m.t === 'clock' && m.seats.map((s) => s.seat).join() === '1,2')).toBe(true);
    // The total of the readings' action counts is the actions counted toward the cap (answers; no cancels here).
    const last = h.records[h.records.length - 1]!;
    expect(last.clocks.reduce((n, c) => n + (c.actions ?? 0), 0)).toBe(h.actor.actions);
  });
});

describe('M13-2: the cancel cap (3 per control period) and the per-game action cap', () => {
  it('casts and cancels: 3 cancels in a period, a notice when they are used up, the 4th refused (limitReached) until the action is finished', () => {
    const h = new Harness({ config: fixtureConfig('m13-2-cancel', { Mountain: 20, 'Lightning Bolt': 20 }, { Forest: 20, 'Grizzly Bears': 20 }), game: 'cancel' });
    const bolt = () => {
      const s = h.state.pending;
      if (!s || s.kind !== 'priority') return null;
      const b = h.b(h.seatOf(s.player));
      return b.legal.find((l) => l.kind === 'cast') ?? null;
    };
    for (let i = 0; i < 200 && !bolt(); i++) {
      const d = h.state.pending!;
      const b = h.b(h.seatOf(d.player));
      const land = d.kind === 'priority' ? b.legal.find((l) => l.kind === 'playLand') : undefined;
      if (land) h.act(b.seat, land.action);
      else aiMove(h, 'cancel');
    }
    const cast = bolt()!;
    expect(cast).not.toBeNull();
    const seat = h.seatOf(h.state.pending!.player);
    const player = h.b(seat).player;
    for (let n = 1; n <= 3; n++) {
      expect(h.act(seat, cast.action).reply?.ok).toBe(true);
      expect(h.state.pending?.cancellable).toBe(true);
      const { step, reply } = h.act(seat, { type: 'cancel', player });
      expect(reply?.ok, `cancel ${n}`).toBe(true);
      expect(step.records.map((r) => r.action.type)).toEqual(['cancel']);
      const notices = h.sent(step, seat, 'notice').filter((x) => x.kind === 'cancelsUsed'); // M13-6: its own notice kind (was limitWarning)
      expect(notices.length, `notice after cancel ${n}`).toBe(n === 3 ? 1 : 0);
    }
    expect(h.act(seat, cast.action).reply?.ok).toBe(true);
    const fourth = h.act(seat, { type: 'cancel', player });
    expect(fourth.reply).toMatchObject({ ok: false, error: { code: 'limitReached', rules: ['CR 733.1'] } });
    expect(fourth.step.records).toEqual([]);
    // The player finishes the action instead.
    for (let i = 0; i < 10 && h.state.pending?.player === player && h.state.pending.kind !== 'priority'; i++) aiMove(h, 'cancel');
    expect(h.state.zones.stack.length + h.state.zones.graveyard[player]!.length).toBeGreaterThan(0);
    // The 3 cancels counted toward the cap and in the seat's clock actions.
    expect(h.records.filter((r) => r.action.type === 'cancel')).toHaveLength(3);
  });

  it('the per-game action cap: a warning at 90%, void ("limit") at the cap; setStops does not count', () => {
    const h = new Harness({ config: configOf('m13-2-cap', DECKS[0]!, DECKS[1]!), game: 'cap', limits: { actions: 20 } });
    let warned = false;
    for (let i = 0; i < 100 && !h.actor.ended; i++) {
      if (i === 5) {
        const p = h.b(2).player;
        expect(h.act(2, { type: 'setStops', player: p, stops: { ownTurn: ['main1'], opponentTurn: ['end'], fullControl: false } } as never).reply?.ok).toBe(true);
      }
      const n = h.steps.length;
      aiMove(h, 'cap');
      if (h.steps.slice(n).some((s) => s.sends.some((x) => x.t === 'notice' && x.json.includes('"limitWarning"')))) {
        warned = true;
        expect(h.actor.actions).toBe(18);
      }
    }
    expect(warned).toBe(true);
    expect(h.actor.ended).toMatchObject({ outcome: 'void', reason: 'limit', actions: 20 });
    expect(h.records.length).toBe(21); // 20 counted + the setStops
  });
});
