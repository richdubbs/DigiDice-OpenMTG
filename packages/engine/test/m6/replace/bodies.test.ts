/**
 * M6-1: the replacement bodies (m6 design 3.2; CR 614.1a, 614.6, 614.7a, 614.9, 614.10): `modify` with an amount, a count or another player, `instead`,
 * `redirect` (with and without a budget) and `skip` applied to a single event.
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { proposeResult } from '../../../src/effects/propose';
import { find, scenario, synth } from '../../m5/helpers';
import { enchantment, eventsOf, LAB_MANIAC, pariah, run, shieldRecord } from './support';

const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const handSize = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;

describe('CR 614.1a: modify an amount, a count, the player', () => {
  it('CR 614.1a: "If you would gain life, you gain that much life plus 1 instead"; an opponent\'s gain is not changed', () => {
    const plus = enchantment('Test Plus One', [{ s: 'replace', replaces: { ev: 'life', change: 'gain', player: 'you' }, body: { b: 'modify', amount: { add: 1 } } }]);
    const s = scenario([], { p1: { battlefield: ['Test Plus One'] }, defs: [plus] });
    const mine = run(s, (g) => proposeResult(g, { ev: 'life', change: 'gain', player: 'p1', amount: 3 }));
    expect(mine.result!.amount).toBe(4);
    expect(lifeOf(mine.g.s, 'p1')).toBe(24);
    const theirs = run(s, (g) => proposeResult(g, { ev: 'life', change: 'gain', player: 'p2', amount: 3 }));
    expect(lifeOf(theirs.g.s, 'p2')).toBe(23);
  });

  it('CR 614.1a, 107.1a: "half that many, rounded down" (mul 0.5): 3 counters become 1; 1 becomes 0, which is no event (CR 614.7a)', () => {
    const half = enchantment('Test Half', [{ s: 'replace', replaces: { ev: 'counters', change: 'put', on: { types: ['Creature'] } }, body: { b: 'modify', count: { mul: 0.5, round: 'down' } } }]);
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Test Half', 'Grizzly Bears'] }, defs: [half] });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const three = run(s, (g) => proposeResult(g, { ev: 'counters', change: 'put', on: { id: bears, zone: 'battlefield' }, kind: '+1/+1', count: 3 }));
    expect(three.g.s.objects[bears]!.counters['+1/+1']).toBe(1);
    const one = run(s, (g) => proposeResult(g, { ev: 'counters', change: 'put', on: { id: bears, zone: 'battlefield' }, kind: '+1/+1', count: 1 }));
    expect(one.result).toBeNull();
    expect(one.g.s.objects[bears]!.counters['+1/+1'] ?? 0).toBe(0);
  });

  it('CR 614.1a: "if an opponent would draw a card, you draw it instead" (modify.to): the other player draws', () => {
    const thief = enchantment('Test Thief', [{ s: 'replace', replaces: { ev: 'draw', player: 'opponent' }, body: { b: 'modify', to: { ref: 'you' } } }]);
    const s = scenario([], { p1: { battlefield: ['Test Thief'] }, defs: [thief] });
    const r = run(s, (g) => proposeResult(g, { ev: 'draw', player: 'p2' }));
    expect(handSize(r.g.s, 'p1')).toBe(handSize(s, 'p1') + 1);
    expect(handSize(r.g.s, 'p2')).toBe(handSize(s, 'p2'));
  });

  it('a modify body with a field the pipeline does not run (min) is never applied half (fail closed)', () => {
    const odd = enchantment('Test Floor', [{ s: 'replace', replaces: { ev: 'life', change: 'gain', player: 'you' }, body: { b: 'modify', amount: { add: 1, min: 5 } } }]);
    const s = scenario([], { p1: { battlefield: ['Test Floor'] }, defs: [odd] });
    expect(lifeOf(run(s, (g) => proposeResult(g, { ev: 'life', change: 'gain', player: 'p1', amount: 1 })).g.s, 'p1')).toBe(21);
  });
});

describe('CR 614.6: instead', () => {
  it('CR 614.6: Laboratory Maniac: drawing from an empty library wins the game instead; with cards in the library the draw happens', () => {
    const s = scenario([], { p1: { battlefield: ['Laboratory Maniac'] }, defs: [LAB_MANIAC] });
    const normal = run(s, (g) => proposeResult(g, { ev: 'draw', player: 'p1' }));
    expect(handSize(normal.g.s, 'p1')).toBe(handSize(s, 'p1') + 1);
    expect(normal.g.s.result).toBeFalsy();
    const empty = { ...s, zones: { ...s.zones, library: { ...s.zones.library, p1: [] } } };
    const r = run(empty, (g) => proposeResult(g, { ev: 'draw', player: 'p1' }));
    expect(r.result).toBeNull();
    expect(r.g.s.result?.winner).toBe('p1');
  });

  it('CR 614.11a-b, 614.6: the steps read the replaced event ("that much"): "if you would lose life, you gain that much life instead"', () => {
    const flip = enchantment('Test Reversal', [{ s: 'replace', replaces: { ev: 'life', change: 'loss', player: 'you' }, body: { b: 'instead', do: [{ op: 'gainLife', who: { ref: 'you' }, amount: { q: 'eventAmount' } }] } }]);
    const s = scenario([], { p1: { battlefield: ['Test Reversal'] }, defs: [flip] });
    const r = run(s, (g) => proposeResult(g, { ev: 'life', change: 'loss', player: 'p1', amount: 4 }));
    expect(lifeOf(r.g.s, 'p1')).toBe(24);
    expect(eventsOf(r.g, 'lifeChanged').every((e) => e.delta > 0)).toBe(true);
  });
});

describe('CR 614.9: redirect', () => {
  it('CR 614.9: Pariah: damage that would be dealt to you is dealt to the enchanted creature instead, by the same source', () => {
    const s = scenario(['Hill Giant', 'Grizzly Bears', 'Pariah'], { p1: { battlefield: ['Hill Giant'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [pariah()] });
    const s1 = (() => {
      const t = structuredClone(s);
      const giant = find(t, 'Hill Giant', 'battlefield');
      const id = `o${t.counters.object++}`;
      t.objects[id] = { ...t.objects[giant]!, id, defId: 'Pariah', cardId: `c${t.counters.card++}`, attachedTo: giant, timestamp: t.counters.timestamp++, counters: {} };
      t.zones.battlefield.push(id);
      return t;
    })();
    const giant = find(s1, 'Hill Giant', 'battlefield');
    const bears = find(s1, 'Grizzly Bears', 'battlefield');
    const r = run(s1, (g) => proposeResult(g, { ev: 'damage', source: { id: bears, zone: 'battlefield' }, to: 'p1', amount: 2, combat: false, unpreventable: false }));
    expect(lifeOf(r.g.s, 'p1')).toBe(20);
    expect(r.g.s.objects[giant]!.damage).toBe(2);
    expect(eventsOf(r.g, 'damageDealt')[0]).toMatchObject({ source: bears, target: giant, amount: 2 });
  });

  it('CR 614.9: a redirection to a creature that has left the battlefield does nothing: the damage is dealt to the original recipient', () => {
    const toFixed = (id: string) => synth({ name: 'Test Redirector', type: 'Enchantment', abilities: [{ kind: 'static', text: 'x', effects: [{ s: 'replace', replaces: { ev: 'damage', recipient: { player: 'you' } }, body: { b: 'redirect', to: { ref: 'fixed', objects: [{ id, zone: 'battlefield' }] } } }] }] });
    const s = scenario(['Grizzly Bears'], { p2: { battlefield: ['Grizzly Bears'] }, p1: { graveyard: ['Grizzly Bears'] }, defs: [] });
    const gone = find(s, 'Grizzly Bears', 'graveyard');
    const t = structuredClone(s);
    t.defs['Test Redirector'] = toFixed(gone);
    const id = `o${t.counters.object++}`;
    t.objects[id] = { ...t.objects[find(t, 'Grizzly Bears', 'battlefield')]!, id, defId: 'Test Redirector', owner: 'p1', controller: 'p1', cardId: `c${t.counters.card++}` };
    t.zones.battlefield.push(id);
    const bears = find(t, 'Grizzly Bears', 'battlefield');
    const r = run(t, (g) => proposeResult(g, { ev: 'damage', source: { id: bears, zone: 'battlefield' }, to: 'p1', amount: 2, combat: false, unpreventable: false }));
    expect(lifeOf(r.g.s, 'p1')).toBe(18);
  });

  it('CR 614.9 with a budget: "the next 2 damage that would be dealt to you this turn is dealt to that creature instead": 3 damage is split 2 / 1', () => {
    const s = scenario(['Hill Giant', 'Grizzly Bears'], { p1: { battlefield: ['Hill Giant'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const giant = find(s, 'Hill Giant', 'battlefield');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const t = structuredClone(s);
    t.continuousEffects.push(shieldRecord('e80', { s: 'replace', replaces: { ev: 'damage', recipient: { player: 'you' } }, body: { b: 'redirect', to: { ref: 'fixed', objects: [{ id: giant, zone: 'battlefield' }] }, amount: 2 }, shield: { uses: 'all', amount: 2 } }));
    const r = run(t, (g) => proposeResult(g, { ev: 'damage', source: { id: bears, zone: 'battlefield' }, to: 'p1', amount: 3, combat: false, unpreventable: false }));
    expect(r.g.s.objects[giant]!.damage).toBe(2);
    expect(lifeOf(r.g.s, 'p1')).toBe(19);
    expect(r.g.s.continuousEffects.find((x) => x.id === 'e80')).toBeUndefined(); // used up
  });
});

describe('CR 614.10: skip', () => {
  it('CR 614.10: "skip that draw": the draw does not happen', () => {
    const skipper = enchantment('Test No Draws', [{ s: 'replace', replaces: { ev: 'draw', player: 'opponent' }, body: { b: 'skip' } }]);
    const s = scenario([], { p1: { battlefield: ['Test No Draws'] }, defs: [skipper] });
    const r = run(s, (g) => proposeResult(g, { ev: 'draw', player: 'p2' }));
    expect(r.result).toBeNull();
    expect(handSize(r.g.s, 'p2')).toBe(handSize(s, 'p2'));
  });
});
