/**
 * RPL-0 (replays design 4, "Digests, not state hashes"): `gameDigest` is the same for the same game whatever its object ids and however the state was
 * stored, and differs when a fact of the game differs; the checkpoint rule takes a digest at every turn start, every 20th action and the last action.
 */
import { describe, expect, it } from 'vitest';
import {
  checkpointDue, checkpointsOf, CHECKPOINT_EVERY, digestSummary, firstDivergence, gameDigest, replay, type GameState, type ObjectId,
} from '../../src/index';
import { aiGame, botGame, faceDownConfig, type PlayedGame } from './games';
import { collectPendingTriggers, putPendingTriggersOnStack } from '../../src/core/triggers';
import { createDelayedTrigger } from '../../src/triggers/delayed';
import { find, scenario } from '../m3/scenario';
import { castCard } from '../m5/announce/support';
import { gameOf } from '../m5/triggers/helpers';
import { attach, card } from '../fast5/t60/support';

const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** How far `renumber` moves the numbers the engine hands out from its counters (effect ids, trigger ids, timestamps). */
const SHIFT = 1000;
const COUNTER_ID = /^([etd])([0-9]+)$/;
/** Fields that hold a timestamp (CR 613.7) or another number handed out from `counters.timestamp`. */
const TIMESTAMP_FIELDS = new Set(['timestamp', 'createdAt', 'grantedAt']);

/**
 * The same state as another build that hands ids and timestamps out in another order would have it: every object id renamed, consistently and
 * everywhere (object and last-known-information keys, zone lists, attachments, targets, links, history, and inside composite strings such as an
 * ability's key `g:live:o176:p:0:0:0:0`), every effect, trigger and delayed trigger id (`e17`, `t23`, `d4`) and every timestamp shifted, and the
 * counters that hand them out shifted with them (RPL-0 review).
 */
function renumber(state: GameState): GameState {
  const ids = [...new Set([...Object.keys(state.objects), ...Object.keys(state.lki)])];
  const map = new Map<string, string>();
  ids.forEach((id, i) => map.set(id, `o${9000 + ids.length - i}`));
  const token = (t: string): string => {
    const m = COUNTER_ID.exec(t);
    return map.get(t) ?? (m ? `${m[1]}${Number(m[2]) + SHIFT}` : t);
  };
  const str = (x: string): string => x.split(':').map(token).join(':');
  const walk = (x: unknown, key = ''): unknown => {
    if (typeof x === 'string') return str(x);
    if (typeof x === 'number') return TIMESTAMP_FIELDS.has(key) ? x + SHIFT : x;
    if (Array.isArray(x)) return x.map((v) => walk(v));
    if (x && typeof x === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(x)) out[str(k)] = walk(v, k);
      // A delayed trigger's ability reference holds when it was created (a timestamp) as its index; reflexive and miracle keys an effect number.
      const ref = out as { source?: unknown; index?: unknown; key?: unknown };
      if (ref.source === 'delayed' && typeof ref.index === 'number') ref.index += SHIFT;
      if (ref.source === 'reflexive' && typeof ref.key === 'string') ref.key = ref.key.replace(/:([0-9]+)$/, (_, n: string) => `:${Number(n) + SHIFT}`);
      return out;
    }
    return x;
  };
  const out = walk(roundTrip(state)) as GameState;
  out.counters = { ...out.counters, effect: state.counters.effect + SHIFT, timestamp: state.counters.timestamp + SHIFT };
  return out;
}

/** No object id of `s` in its digest's summary, not even inside a longer string (`"g:live:o176:..."`). */
function noIdsIn(s: GameState): void {
  const summary = digestSummary(s);
  for (const id of [...Object.keys(s.objects), ...Object.keys(s.lki)]) expect(summary, id).not.toMatch(new RegExp(`(^|[^A-Za-z0-9])${id}($|[^A-Za-z0-9])`));
}

/** Test Rod (t60) on Test Bear: casting Test Tonic puts the ability the Rod grants on the stack (CR 113.6, 603.2); its key holds the Rod's id. */
function grantedTriggerOnStack(): GameState {
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const TONIC = card('Test Tonic', 'Instant', 'You gain 2 life.', undefined, '{0}');
  const ROD = card('Test Rod', 'Artifact — Equipment', 'Equipped creature gets +1/+0, has "Whenever you cast a noncreature spell, this creature deals 1 damage to each opponent," and is a Wizard in addition to its other types.\nEquip {0}');
  const s0 = attach(scenario([], { p1: { hand: ['Test Tonic'], battlefield: ['Test Rod', 'Test Bear'] }, defs: [ROD, BEAR, TONIC] }), 'Test Rod', 'Test Bear');
  const s = castCard(s0, 'Test Tonic');
  const granted = s.zones.stack.map((id) => s.objects[id]!.stack?.abilityRef).find((r) => r?.source === 'granted');
  expect(granted?.key).toContain(find(s, 'Test Rod', 'battlefield'));
  return s;
}

/** A delayed trigger on the stack (CR 603.7): "at the beginning of the next end step, you gain 1 life", made by the effect and fired at the end step. */
function delayedTriggerOnStack(): GameState {
  const g = gameOf(scenario(['Plains', 'Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } }));
  const bear = find(g.s, 'Grizzly Bears', 'battlefield');
  createDelayedTrigger(g, { source: { id: bear, zone: 'battlefield' }, controller: 'p1', when: { at: 'step', step: 'end', next: true }, do: [{ op: 'gainLife', who: { ref: 'you' }, amount: 1 }] });
  g.s.turn.step = 'end';
  g.emit({ type: 'stepBegan', step: 'end', activePlayer: g.s.turn.activePlayer });
  collectPendingTriggers(g);
  putPendingTriggersOnStack(g);
  const ref = g.s.zones.stack.map((id) => g.s.objects[id]!.stack?.abilityRef).find((r) => r?.source === 'delayed');
  expect(ref).toBeDefined();
  return g.s;
}

let game: PlayedGame | undefined;
const played = (): PlayedGame => (game ??= aiGame('rpl0-digest', 0, 1));

/** A state with a permanent on the battlefield and a graveyard of two different cards. */
function richState(): GameState {
  const s = played().states.find((st) => st.zones.battlefield.length >= 2 && st.players.some((p) => new Set((st.zones.graveyard[p.id] ?? []).map((id) => st.objects[id]!.defId)).size >= 2));
  if (!s) throw new Error('the game never had two different cards in a graveyard');
  return s;
}

describe('RPL-0: gameDigest (replays design 4)', { timeout: 300_000 }, () => {
  it('is "d1:" and 32 hexadecimal digits, and the same for the same state', () => {
    const s = richState();
    expect(gameDigest(s)).toMatch(/^d1:[0-9a-f]{32}$/);
    expect(gameDigest(s)).toBe(gameDigest(s));
  });

  it('is stable across a JSON round trip (a saved and loaded state)', () => {
    for (const s of played().states.filter((_, i) => i % 25 === 0)) expect(gameDigest(roundTrip(s))).toBe(gameDigest(s));
  });

  it('is stable across a replay of the same log (CR 733: the same actions give the same game)', () => {
    const g = played();
    for (const k of [1, Math.floor(g.actions.length / 2), g.actions.length]) {
      const again = replay(roundTrip(g.config), roundTrip(g.actions.slice(0, k)));
      expect(again.errors).toEqual([]);
      expect(gameDigest(again.state)).toBe(gameDigest(g.states[k]!));
    }
    expect(checkpointsOf(g.config, g.actions)).toEqual(checkpointsOf(roundTrip(g.config), roundTrip(g.actions)));
  });

  it('does not change when only object ids are renumbered (object ids are left out)', () => {
    const g = played();
    let checked = 0;
    for (const s of g.states.filter((_, i) => i % 15 === 0)) {
      const r = renumber(s);
      if (Object.keys(s.objects).length > 0) expect(Object.keys(r.objects)).not.toEqual(Object.keys(s.objects));
      expect(gameDigest(r)).toBe(gameDigest(s));
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('does not change when object ids are renumbered in a game with face-down permanents, copies and spells with targets (CR 708, 707, 601.2c)', () => {
    const g = botGame(faceDownConfig('rpl0-digest-fd'), 400);
    let stacked = 0;
    for (const s of g.states.filter((st, i) => i % 9 === 0 || st.zones.stack.length > 0)) {
      if (s.zones.stack.length > 0) stacked++;
      expect(gameDigest(renumber(s))).toBe(gameDigest(s));
      expect(gameDigest(roundTrip(s))).toBe(gameDigest(s));
    }
    expect(stacked).toBeGreaterThan(0);
  });

  it('RPL-0 review: does not change when ids and timestamps are handed out in another order with abilities on the stack (CR 113.6, 603.7)', () => {
    for (const s of [grantedTriggerOnStack(), delayedTriggerOnStack()]) {
      const r = renumber(s);
      expect(r.counters.effect).not.toBe(s.counters.effect);
      expect(JSON.stringify(r.objects)).not.toBe(JSON.stringify(s.objects));
      expect(gameDigest(r)).toBe(gameDigest(s));
      noIdsIn(s);
    }
    // The delayed trigger's reference holds its effect id and its creation timestamp; neither is a fact of the game.
    const s = roundTrip(delayedTriggerOnStack());
    const ab = s.objects[s.zones.stack.find((id) => s.objects[id]!.stack?.abilityRef?.source === 'delayed')!]!.stack!;
    const before = gameDigest(s);
    ab.abilityRef = { source: 'delayed', face: 0, index: 41, key: 'd17' };
    const a = gameDigest(s);
    ab.abilityRef = { source: 'delayed', face: 0, index: 42, key: 'd18' };
    expect(gameDigest(s)).toBe(a);
    expect(a).toBe(before);
  });

  it('CR 702.26: changes when a permanent phases out', () => {
    const s = roundTrip(richState());
    const before = gameDigest(s);
    s.objects[s.zones.battlefield[0]!]!.phasedOut = true;
    expect(gameDigest(s)).not.toBe(before);
  });

  it('CR 712, 710: changes when a permanent shows another face or is flipped', () => {
    const s = roundTrip(richState());
    const before = gameDigest(s);
    s.objects[s.zones.battlefield[0]!]!.face = 1;
    expect(gameDigest(s)).not.toBe(before);
    const t = roundTrip(richState());
    t.objects[t.zones.battlefield[0]!]!.flipped = !t.objects[t.zones.battlefield[0]!]!.flipped;
    expect(gameDigest(t)).not.toBe(before);
  });

  it('CR 106.4: changes when mana is added to a pool', () => {
    const s = roundTrip(richState());
    const before = gameDigest(s);
    s.players[0]!.manaPool = [...s.players[0]!.manaPool, { type: 'G' }];
    expect(gameDigest(s)).not.toBe(before);
  });

  it('CR 506.4, 508.1, 509.1: changes when what attacks or blocks changes, and names attackers and blockers by position', () => {
    const g = played();
    const s = g.states.find((st) => (st.combat?.attackers.length ?? 0) > 0);
    if (!s) throw new Error('nothing ever attacked in the game');
    const before = gameDigest(s);
    const t = roundTrip(s);
    t.combat!.attackers = [];
    t.combat!.blockers = [];
    expect(gameDigest(t)).not.toBe(before);
    expect(gameDigest(renumber(s))).toBe(before);
    noIdsIn(s);
  });

  it('CR 119: changes when a life total changes', () => {
    const s = roundTrip(richState());
    const before = gameDigest(s);
    s.players[0]!.life -= 1;
    expect(gameDigest(s)).not.toBe(before);
  });

  it('CR 701.26: changes when a permanent is tapped or untapped', () => {
    const s = roundTrip(richState());
    const before = gameDigest(s);
    const o = s.objects[s.zones.battlefield[0]!]!;
    o.tapped = !o.tapped;
    expect(gameDigest(s)).not.toBe(before);
  });

  it('CR 122.1: changes when a counter is put on a permanent or a player, and not for an emptied counter that was removed', () => {
    const s = roundTrip(richState());
    const before = gameDigest(s);
    const o = s.objects[s.zones.battlefield[0]!]!;
    o.counters = { ...o.counters, '+1/+1': (o.counters['+1/+1'] ?? 0) + 1 };
    expect(gameDigest(s)).not.toBe(before);
    const t = roundTrip(richState());
    t.players[1]!.counters = { ...t.players[1]!.counters, poison: 0 }; // an amount of zero is no counter (CR 122.1)
    expect(gameDigest(t)).toBe(before);
    t.players[1]!.counters = { ...t.players[1]!.counters, energy: 2 };
    expect(gameDigest(t)).not.toBe(before);
  });

  it('CR 404.1: changes when the order of a graveyard changes', () => {
    const s = roundTrip(richState());
    const before = gameDigest(s);
    const owner = s.players.find((p) => new Set((s.zones.graveyard[p.id] ?? []).map((id) => s.objects[id]!.defId)).size >= 2)!.id;
    const gy = s.zones.graveyard[owner]!;
    const i = gy.findIndex((id) => s.objects[id]!.defId !== s.objects[gy[0]!]!.defId);
    [gy[0], gy[i]] = [gy[i]!, gy[0]!];
    expect(gameDigest(s)).not.toBe(before);
  });

  it('CR 401.1: changes when the order of a library changes, and when damage is marked on a creature (CR 120.3e)', () => {
    const s = roundTrip(richState());
    const before = gameDigest(s);
    const lib = s.zones.library['p1']!;
    const i = lib.findIndex((id) => s.objects[id]!.defId !== s.objects[lib[0]!]!.defId);
    [lib[0], lib[i]] = [lib[i]!, lib[0]!];
    expect(gameDigest(s)).not.toBe(before);
    const t = roundTrip(richState());
    t.objects[t.zones.battlefield[0]!]!.damage += 1;
    expect(gameDigest(t)).not.toBe(before);
  });

  it('CR 613: carries the layered power and toughness of permanents, and names attachments and targets by position, never by id', () => {
    const s = richState();
    const summary = digestSummary(s);
    for (const id of Object.keys(s.objects) as ObjectId[]) expect(summary).not.toContain(`"${id}"`);
    noIdsIn(s);
    expect(summary).toMatch(/"battlefield"/);
  });
});

describe('RPL-0: the checkpoint rule (replays design 4)', { timeout: 300_000 }, () => {
  it('takes a checkpoint at every turn start, every 20th action and the last action, and nowhere else', () => {
    expect(CHECKPOINT_EVERY).toBe(20);
    expect(checkpointDue({ index: 19, turnBefore: 3, turnAfter: 3, last: false })).toBe(true);
    expect(checkpointDue({ index: 39, turnBefore: 3, turnAfter: 3, last: false })).toBe(true);
    expect(checkpointDue({ index: 20, turnBefore: 3, turnAfter: 3, last: false })).toBe(false);
    expect(checkpointDue({ index: 5, turnBefore: 3, turnAfter: 4, last: false })).toBe(true);
    expect(checkpointDue({ index: 0, turnBefore: 0, turnAfter: 1, last: false })).toBe(true);
    expect(checkpointDue({ index: 7, turnBefore: 3, turnAfter: 3, last: true })).toBe(true);
    expect(checkpointDue({ index: 7, turnBefore: 3, turnAfter: 3, last: false })).toBe(false);
  });

  it('checkpointsOf a whole game: one per turn start, every 20th action and the last, each the digest of the state after its action', () => {
    const g = played();
    const { checkpoints, rejected } = checkpointsOf(g.config, g.actions);
    expect(rejected).toBeNull();
    const want = g.actions.map((_, i) => i).filter((i) => (i + 1) % 20 === 0 || i === g.actions.length - 1 || g.states[i + 1]!.turn.number !== g.states[i]!.turn.number);
    expect(checkpoints.map((c) => c.action)).toEqual(want);
    for (const c of checkpoints) {
      expect(c.digest).toBe(gameDigest(g.states[c.action + 1]!));
      expect(c.turn).toBe(g.states[c.action + 1]!.turn.number);
    }
    const turns = new Set(g.states.map((st) => st.turn.number));
    expect(checkpoints.length).toBeGreaterThanOrEqual(turns.size - 1);
  });

  it('firstDivergence: null when every checkpoint matches, else the first one that differs or is missing', () => {
    const g = played();
    const { checkpoints } = checkpointsOf(g.config, g.actions);
    expect(firstDivergence(checkpoints, checkpoints)).toBeNull();
    const changed = checkpoints.map((c, i) => (i === 3 ? { ...c, digest: 'd1:00000000000000000000000000000000' } : c));
    expect(firstDivergence(checkpoints, changed)).toBe(3);
    expect(firstDivergence(checkpoints, checkpoints.slice(0, 5))).toBe(5);
  });

  it('checkpointsOf stops at the first action the engine rejects (CR 733: never half-applied)', () => {
    const g = played();
    const bad = [...g.actions.slice(0, 10), { type: 'pass', player: 'p9' } as const, ...g.actions.slice(10)];
    const run = checkpointsOf(g.config, bad);
    expect(run.rejected?.index).toBe(10);
    expect(run.checkpoints.every((c) => c.action < 10)).toBe(true);
  });
});
