/**
 * Hidden library order and hidden cards for the guest (CR 400.2, 401.2, 701.24a). The host sends the guest `viewFor` and `eventsFor` as they are: since H1
 * the engine gives shuffled library cards new object ids and shows hidden cards as blank cards, so the guest cannot follow a card it once knew (its own
 * hand before a mulligan, a card it saw revealed) into a library and through a shuffle. These tests catch the engine (or the host) giving that back.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, createGame, HIDDEN_DEF, legalActions, viewFor, type DecisionAnswer, type GameEvent, type GameState, type GameView, type OracleCard } from '@openmtg/engine';
import { autoAnswer } from '../src/game/autoplay';
import { eventsFor } from '../src/game/redact';
import { fixtureDb } from './helpers';

function newGame(seed: string): GameState {
  const db = fixtureDb();
  const names = ['Forest', 'Grizzly Bears', 'Hill Giant', 'Mountain'];
  const defs = names.map((n) => compileCard(db.lookup(n) as OracleCard));
  const deck = names.flatMap((n) => Array<string>(10).fill(n));
  return createGame({ seed, players: [{ name: 'A', deck }, { name: 'B', deck }], defs, options: { startingPlayer: 'p1' } });
}

/** Answer the pending decision; the state and the events of that action. */
function step(s: GameState, a: DecisionAnswer): { state: GameState; events: GameEvent[] } {
  const d = s.pending!;
  const r = applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: a });
  if (r.error) throw new Error(r.error.message);
  return { state: r.state, events: r.events };
}

const idsIn = (x: unknown): Set<string> => new Set(JSON.stringify(x).match(/"o\d+"/g)?.map((m) => m.slice(1, -1)) ?? []);

/** The fields of a card the viewer cannot see in a hidden zone: nothing about which card it is, or when it was made. */
const BLANK_KEYS = ['controlledSinceTurn', 'controller', 'counters', 'damage', 'deathtouchDamaged', 'defId', 'face', 'faceDown', 'flipped', 'id', 'kind', 'owner', 'phasedOut', 'tapped', 'timestamp', 'zone'];

function expectBlank(v: GameView, id: string): void {
  const o = v.objects[id]!;
  expect(Object.keys(o).sort()).toEqual(BLANK_KEYS);
  expect(o).toMatchObject({ defId: HIDDEN_DEF, timestamp: 0, controlledSinceTurn: 0, face: 0 });
}

describe('hidden library identity for the guest (CR 400.2, 701.24a)', () => {
  it('CR 103.5, 701.24a: the guest\'s own hand, shuffled into its library by a mulligan, cannot be followed there by id', () => {
    let s = newGame('h1-net-mulligan');
    expect(s.pending).toMatchObject({ kind: 'mulligan', player: 'p1' });
    s = step(s, { kind: 'mulligan', keep: true }).state;
    expect(s.pending).toMatchObject({ kind: 'mulligan', player: 'p2' });
    const before = viewFor(s, 'p2');
    const hand = before.zones.hand['p2']!;
    expect(hand.every((id) => before.objects[id]!.defId !== HIDDEN_DEF)).toBe(true); // the guest knows its hand

    const r = step(s, { kind: 'mulligan', keep: false }); // CR 103.5: the hand is shuffled into the library, seven new cards are drawn
    const after = viewFor(r.state, 'p2');
    const lib = after.zones.library['p2']!;
    expect(lib.filter((id) => before.objects[id] !== undefined)).toEqual([]); // no id the guest was shown before is in its library now
    for (const id of lib) expectBlank(after, id);
    // Nothing in the events the guest is sent for that action links an old hand card to a place in the library either.
    const sent = eventsFor(r.state, r.events, 'p2');
    expect(sent.some((e) => e.type === 'shuffled' && e.player === 'p2')).toBe(true);
    const mentioned = idsIn(sent);
    expect(lib.filter((id) => mentioned.has(id))).toEqual([]);
  });

  it('CR 103.5, 701.24a: after the host\'s mulligan no id of the host\'s library or hand the guest was shown is in the host\'s library', () => {
    const s = newGame('h1-net-host-mulligan');
    expect(s.pending).toMatchObject({ kind: 'mulligan', player: 'p1' });
    const v0 = viewFor(s, 'p2');
    for (const id of [...v0.zones.library['p1']!, ...v0.zones.hand['p1']!]) expectBlank(v0, id); // no card id, timestamp or creation turn
    const host = step(s, { kind: 'mulligan', keep: false });
    const r = step(host.state, { kind: 'mulligan', keep: true }); // once both have decided, the host's hand goes into its library, which is shuffled (CR 103.5)
    const v1 = viewFor(r.state, 'p2');
    const lib = v1.zones.library['p1']!;
    expect(r.events.some((e) => e.type === 'shuffled' && e.player === 'p1')).toBe(true);
    expect(lib.filter((id) => v0.objects[id] !== undefined)).toEqual([]);
    for (const id of [...lib, ...v1.zones.hand['p1']!]) expectBlank(v1, id);
    const sent = eventsFor(r.state, [...host.events, ...r.events], 'p2');
    expect(lib.filter((id) => idsIn(sent).has(id))).toEqual([]);
    for (const e of sent) if (e.type === 'zoneChanged' && e.owner === 'p1') expect(e.name).toBe(''); // CR 400.2: the host's cards are not named
  });

  it('CR 400.2: the guest\'s legal actions name only objects of its view (the host sends them as they are)', () => {
    let s = newGame('h1-net-legal');
    while (s.pending && s.pending.kind !== 'priority') s = step(s, autoAnswer(s.pending, s.pending.player) as DecisionAnswer).state;
    const v = viewFor(s, 'p2');
    for (const id of idsIn(legalActions(s, 'p2'))) expect(v.objects[id]).toBeDefined();
  });

  it('CR 401.4, 702.85a: a public card put into a library: the event keeps which card moved but not the library object it became', () => {
    let s = newGame('h1-net-into-library');
    while (s.pending && s.pending.kind !== 'priority') s = step(s, autoAnswer(s.pending, s.pending.player) as DecisionAnswer).state;
    const into = s.zones.library['p1']![5]!; // where the card went: a place nobody but the effect may know
    const moved: GameEvent = { type: 'zoneChanged', oldId: 'o9999', newId: into, from: 'graveyard', to: 'library', owner: 'p1', controller: 'p1', name: 'Grizzly Bears' };
    for (const viewer of ['p1', 'p2'] as const) {
      const [e] = eventsFor(s, [moved], viewer);
      expect(e).toMatchObject({ type: 'zoneChanged', oldId: 'o9999', newId: null, from: 'graveyard', to: 'library', name: '' });
      expect(idsIn(e).has(into)).toBe(false);
    }
  });
});
