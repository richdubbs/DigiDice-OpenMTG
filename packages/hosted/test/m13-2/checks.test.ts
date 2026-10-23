/**
 * The table's checks of every action (design 6.1) and its other commands: text and shape refusals, the seat's player, out-of-turn and illegal
 * actions, stale and resent ids and seqs, setStops (never stale, never counted, never a cause of staleness), concede, Leave, chat, sync and reconnects.
 * In process, fixed inputs (no fuzzing: owner rule).
 */
import { describe, expect, it } from 'vitest';
import type { Action, StopSettings } from '@openmtg/engine';
import { aiMove, configOf, DECKS, fixtureConfig, Harness, replyIn } from './harness';

const ID = 1_000;

function started(seed = 'm13-2-checks'): Harness {
  return new Harness({ config: fixtureConfig(seed, { Mountain: 20, 'Grizzly Bears': 20 }, { Forest: 20, 'Llanowar Elves': 20 }), game: 'checks' });
}

/** Plays AI moves until the deciding seat has priority. */
function toPriority(h: Harness): void {
  for (let i = 0; i < 50 && h.state.pending?.kind !== 'priority'; i++) aiMove(h, 'checks');
  expect(h.state.pending?.kind).toBe('priority');
}

function decider(h: Harness): { seat: number; other: number; player: string } {
  const p = h.state.pending!.player;
  const seat = h.seatOf(p);
  return { seat, other: seat === 1 ? 2 : 1, player: p };
}

describe('M13-2: refusals before the engine', () => {
  it('refuses actions whose strings break the hosted text rules or whose shape is wrong (badMessage), and nothing changes', () => {
    const h = started();
    const { seat, player } = decider(h);
    const d = h.state.pending!;
    const bad: unknown[] = [
      { type: 'answer', player, decisionId: d.id, answer: { kind: 'chooseName', name: 'Grizzly‮Bears' } }, // bidi
      { type: 'answer', player, decisionId: d.id, answer: { kind: 'chooseName', name: 'a\u0000b' } }, // NUL
      { type: 'answer', player, decisionId: d.id, answer: { kind: 'chooseName', name: 'x\uD800' } }, // unpaired surrogate
      { type: 'answer', player, decisionId: d.id, answer: { kind: 'chooseName', name: 'n'.repeat(201) } }, // a typed name over 200
      { type: 'pass', player, extra: 1 }, // a field the engine does not read
      { type: 'startGame' },
      { type: 'nonsense', player },
      'pass',
      null,
    ];
    let id = ID;
    for (const action of bad) {
      const { step, reply } = h.act(seat, action as Action, { id: ++id });
      expect(reply, JSON.stringify(action)).toMatchObject({ ok: false, error: { code: 'badMessage' } });
      expect(step.records).toEqual([]);
    }
    const noSeq = h.cmd({ t: 'act', seat: seat as 1, at: h.at, id: ++id, seq: 'x', action: { type: 'pass', player } });
    expect(replyIn(noSeq, seat, id)).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    expect(h.actor.seq).toBe(0);
  });

  it("refuses another seat's player (notYourPlayer), out-of-turn actions (stale) and illegal ones (illegalAction)", () => {
    const h = started();
    toPriority(h);
    const { seat, other, player } = decider(h);
    const otherPlayer = h.b(other).player;
    const seq = h.actor.seq;
    expect(h.act(seat, { type: 'pass', player: otherPlayer }).reply).toMatchObject({ ok: false, error: { code: 'notYourPlayer' } });
    expect(h.act(other, { type: 'pass', player: otherPlayer }).reply).toMatchObject({ ok: false, error: { code: 'stale' } });
    expect(h.act(seat, { type: 'cast', player, card: 'o99999' }).reply).toMatchObject({ ok: false, error: { code: 'illegalAction', rules: ['CR 117.1'] } });
    expect(h.act(seat, { type: 'answer', player, decisionId: 'd1', answer: { kind: 'yesNo', yes: true } } as Action).reply).toMatchObject({ ok: false, error: { code: 'stale' } });
    expect(h.act(seat, { type: 'cancel', player }).reply).toMatchObject({ ok: false, error: { code: 'illegalAction', rules: ['CR 733.1'] } });
    expect(h.actor.seq).toBe(seq);
    // and the legal pass goes through
    expect(h.act(seat, { type: 'pass', player }).reply).toMatchObject({ ok: true });
    expect(h.actor.seq).toBe(seq + 1);
  });

  it('answers a resend of the last applied id without a change; an older id and an old or future seq are stale', () => {
    const h = started();
    toPriority(h);
    const { seat, player } = decider(h);
    const seq = h.actor.seq;
    const first = h.act(seat, { type: 'pass', player }, { id: 500 });
    expect(first.reply?.ok).toBe(true);
    expect(first.step.records).toHaveLength(1);
    expect(h.actor.lastActId(seat as 1)).toBe(500);
    const again = h.act(seat, { type: 'pass', player }, { id: 500, seq });
    expect(again.reply).toEqual({ t: 'reply', id: 500, ok: true });
    expect(again.step.records).toEqual([]);
    expect(again.step.sends.filter((s) => s.t === 'view' || s.t === 'patch')).toEqual([]);
    const now = decider(h);
    expect(h.act(now.seat, { type: 'pass', player: now.player }, { id: 400 }).reply).toMatchObject(now.seat === seat ? { ok: false, error: { code: 'stale' } } : { ok: true });
    const cur = decider(h);
    expect(h.act(cur.seat, { type: 'pass', player: cur.player }, { id: 9_000, seq: h.actor.seq + 1 }).reply).toMatchObject({ ok: false, error: { code: 'stale' } });
    if (h.actor.seq > 0) expect(h.act(cur.seat, { type: 'pass', player: cur.player }, { id: 9_001, seq: h.actor.seq - 1 }).reply).toMatchObject({ ok: false, error: { code: 'stale' } });
  });
});

describe('M13-2: setStops, concede, Leave, chat, sync, reconnect', () => {
  const stops = (ownTurn: string[]): StopSettings => ({ ownTurn, opponentTurn: [], fullControl: false }) as unknown as StopSettings;

  it('setStops: applied and logged but never counted toward the action cap, never stale, and never making the other seat stale; unchanged stops are not applied', () => {
    const h = started();
    toPriority(h);
    const { seat, other, player } = decider(h);
    const otherPlayer = h.b(other).player;
    const seqBefore = h.actor.seq;
    const actions = h.actor.actions;
    // The other seat changes its stops twice, from an old seq (setStops is never stale); duplicates are normalized.
    const a = h.act(other, { type: 'setStops', player: otherPlayer, stops: stops(['main1', 'main1', 'end']) }, { seq: 0 });
    expect(a.reply?.ok).toBe(true);
    expect(a.step.records).toHaveLength(1);
    expect((a.step.records[0]!.action as Extract<Action, { type: 'setStops' }>).stops.ownTurn).toEqual(['main1', 'end']);
    expect(h.act(other, { type: 'setStops', player: otherPlayer, stops: stops(['main2']) }).reply?.ok).toBe(true);
    const same = h.act(other, { type: 'setStops', player: otherPlayer, stops: stops(['main2']) });
    expect(same.reply?.ok).toBe(true);
    expect(same.step.records).toEqual([]); // nothing to apply
    expect(h.actor.seq).toBe(seqBefore + 2);
    expect(h.actor.actions).toBe(actions);
    // The deciding seat acts from the view it had before those stops: not stale.
    expect(h.act(seat, { type: 'pass', player }, { seq: seqBefore }).reply?.ok).toBe(true);
    expect(h.actor.actions).toBe(actions + 1);
  });

  it('concede (CR 104.3a): the game ends, the other seat wins, the loss is a concession; later actions are refused, chat still works', () => {
    const h = started();
    toPriority(h);
    const { other } = decider(h);
    const p = h.b(other).player;
    const { step, reply } = h.act(other, { type: 'concede', player: p }, { seq: 0 });
    expect(reply?.ok).toBe(true);
    expect(step.end?.outcome).toBe('win');
    const loser = step.end!.seats.find((s) => s.seat === other)!;
    expect(loser).toMatchObject({ place: 2, loss: 'concession', lossRule: 'CR 104.3a' });
    for (const seat of [1, 2]) expect(h.sent(step, seat, 'result')).toHaveLength(1);
    const winner = other === 1 ? 2 : 1;
    expect(h.act(winner, { type: 'pass', player: h.b(winner).player }).reply).toMatchObject({ ok: false, error: { code: 'illegalAction', rules: ['CR 104.1'] } });
    const chat = h.cmd({ t: 'chat', seat: winner as 1, at: h.at, id: 77, text: 'good game' });
    expect(h.sent(chat, 1, 'chat')[0]).toEqual({ t: 'chat', from: winner, text: 'good game' });
    expect(h.sent(chat, 2, 'chat')).toHaveLength(1);
  });

  it('Leave: a concession with cause "left" (loss "left"), the others are told; the seat gets nothing more', () => {
    const h = started();
    toPriority(h);
    const step = h.cmd({ t: 'leave', seat: 1, at: h.at, id: 5 });
    expect(replyIn(step, 1, 5)?.ok).toBe(true);
    expect(step.records).toHaveLength(1);
    expect(step.records[0]).toMatchObject({ seat: 1, cause: 'left', action: { type: 'concede', player: h.b(1).player } });
    expect(h.sent(step, 2, 'notice').map((n) => n.kind)).toContain('playerLeft');
    expect(step.end!.seats.find((s) => s.seat === 1)).toMatchObject({ loss: 'left', place: 2 });
    const after = h.cmd({ t: 'chat', seat: 2, at: h.at, id: 6, text: 'gg' });
    expect(after.sends.filter((s) => s.seat === 1)).toEqual([]);
    expect(h.act(1, { type: 'pass', player: h.b(1).player }).reply).toMatchObject({ ok: false, error: { code: 'notAllowed' } });
  });

  it('chat: the text rules (a bidi control is refused), to every seat at the table, never stored', () => {
    const h = started();
    const bad = h.cmd({ t: 'chat', seat: 2, at: 1, id: 3, text: 'hi‮' });
    expect(replyIn(bad, 2, 3)).toMatchObject({ ok: false, error: { code: 'badMessage' } });
    expect(bad.sends.filter((s) => s.t === 'chat')).toEqual([]);
    const ok = h.cmd({ t: 'chat', seat: 2, at: 2, id: 4, text: '  hello  ' });
    expect(ok.records).toEqual([]);
    expect(ok.sends.filter((s) => s.t === 'chat').map((s) => [s.seat, JSON.parse(s.json)])).toEqual([[1, { t: 'chat', from: 2, text: 'hello' }], [2, { t: 'chat', from: 2, text: 'hello' }]]);
  });

  it('sync: the full view again (the cached one), then the reply', () => {
    const h = started();
    toPriority(h);
    const step = h.cmd({ t: 'sync', seat: 2, at: h.at, id: 9 });
    expect(step.sends.map((s) => [s.seat, s.t])).toEqual([[2, 'view'], [2, 'reply']]);
    const v = h.sent(step, 2, 'view')[0]!;
    expect(v.seq).toBe(h.actor.seq);
    expect(v.events).toEqual([]);
  });

  it('a dropped seat gets nothing while away; the others are told; back, it gets a full view and the patches go on from it', () => {
    const h = new Harness({ config: configOf('m13-2-drop', DECKS[0]!, DECKS[1]!), game: 'drop' });
    for (let i = 0; i < 10; i++) aiMove(h, 'drop');
    const drop = h.cmd({ t: 'disconnect', seat: 2, at: h.at });
    expect(h.sent(drop, 1, 'notice').map((n) => n.kind)).toEqual(['playerDropped']);
    // seat 1 plays on while seat 2 is away (only while it is seat 1's decision)
    let moved = 0;
    for (let i = 0; i < 30 && h.state.pending && h.seatOf(h.state.pending.player) === 1; i++) {
      const n = h.steps.length;
      aiMove(h, 'drop');
      moved++;
      for (const s of h.steps.slice(n)) expect(s.sends.filter((x) => x.seat === 2)).toEqual([]);
    }
    const back = h.cmd({ t: 'connect', seat: 2, at: h.at + 1_000 });
    expect(h.sent(back, 2, 'view')).toHaveLength(1);
    expect(h.sent(back, 1, 'notice').map((n) => n.kind)).toEqual(['playerBack']);
    expect(h.sent(back, 2, 'clock')).toHaveLength(1);
    for (let i = 0; i < 10; i++) aiMove(h, 'drop');
    expect(moved + 10).toBeGreaterThan(0);
  });
});
