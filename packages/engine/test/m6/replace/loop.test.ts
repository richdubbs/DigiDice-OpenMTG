/**
 * M6-1: the replacement loop for every source (m6 design 3.1, D3, E2; CR 614.5, 616.1, 616.2). The CR worked examples by name, on the real fixture cards with
 * the JSON their templates produce (test/m6/replace/support.ts).
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState } from '../../../src/index';
import { proposeResult } from '../../../src/effects/propose';
import { klassOf } from '../../../src/effects/replacements';
import { proposeSimultaneous } from '../../../src/effects/funnels';
import { addPlayerRestriction } from '../../../src/rules/restrictions';
import { find, scenario } from '../../m5/helpers';
import {
  DOUBLING_SEASON, enchantment, FURNACE, HARDENED_SCALES, run, staticAbility, THOUGHT_REFLECTION, withAbilities,
} from './support';

const handSize = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;

describe('CR 614.5: an effect gets one opportunity at an event and at the events that replace it (per branch)', () => {
  it('CR 614.5: two "double that damage" effects (Furnace of Rath x2): 2 damage becomes 8, each doubles once', () => {
    const s = scenario(['Grizzly Bears', 'Furnace of Rath'], { p1: { battlefield: ['Furnace of Rath', 'Furnace of Rath'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [FURNACE] });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const r = run(s, (g) => proposeResult(g, { ev: 'damage', source: { id: bears, zone: 'battlefield' }, to: 'p1', amount: 2, combat: false, unpreventable: false }));
    expect(r.need).toBeUndefined(); // two doublings commute: no question (m6 design 3.1.4)
    expect(r.result!.amount).toBe(8);
    expect(lifeOf(r.g.s, 'p1')).toBe(12);
  });

  it('CR 614.5: two draw-two-instead effects draw four (Thought Reflection x2): each of the two draws is replaced by the other once', () => {
    const s = scenario(['Thought Reflection'], { p1: { battlefield: ['Thought Reflection', 'Thought Reflection'] }, defs: [THOUGHT_REFLECTION] });
    const before = handSize(s, 'p1');
    const r = run(s, (g) => proposeResult(g, { ev: 'draw', player: 'p1' }));
    // the two Reflections are both class 4 "instead" effects: the affected player picks the first; whichever it is, the result is four cards
    expect(r.need?.kind).toBe('chooseReplacement');
    for (const o of r.need!.kind === 'chooseReplacement' ? r.need!.options : []) {
      const done = run(s, (g) => proposeResult(g, { ev: 'draw', player: 'p1' }), [{ kind: 'chooseReplacement', id: o.id }]);
      expect(done.need).toBeUndefined(); // each of the two draws has one candidate left: the other Reflection
      expect(handSize(done.g.s, 'p1') - before).toBe(4);
    }
  });

  it('CR 614.5 (m6 design E2): gain 3 -> draw 3 instead -> each draw gains 1 instead: 3 life and no card', () => {
    const lifeToDraw = enchantment('Test Life Into Cards', [{ s: 'replace', replaces: { ev: 'life', change: 'gain', player: 'you' }, body: { b: 'instead', do: [{ op: 'draw', who: { ref: 'you' }, count: { q: 'eventAmount' } }] } }]);
    const drawToLife = enchantment('Test Cards Into Life', [{ s: 'replace', replaces: { ev: 'draw', player: 'you' }, body: { b: 'instead', do: [{ op: 'gainLife', who: { ref: 'you' }, amount: 1 }] } }]);
    const s = scenario([], { p1: { battlefield: ['Test Life Into Cards', 'Test Cards Into Life'] }, defs: [lifeToDraw, drawToLife] });
    const before = handSize(s, 'p1');
    const r = run(s, (g) => proposeResult(g, { ev: 'life', change: 'gain', player: 'p1', amount: 3 }));
    expect(r.need).toBeUndefined();
    expect(handSize(r.g.s, 'p1')).toBe(before);
    expect(lifeOf(r.g.s, 'p1')).toBe(23);
  });
});

describe('CR 616.2: after an effect is applied, the effects that now apply are looked up again', () => {
  it('CR 616.2: "gain life -> draw instead" and "draw -> return a card instead": gaining 1 returns one card from the graveyard', () => {
    const lifeToDraw = enchantment('Test Life Into Cards', [{ s: 'replace', replaces: { ev: 'life', change: 'gain', player: 'you' }, body: { b: 'instead', do: [{ op: 'draw', who: { ref: 'you' }, count: { q: 'eventAmount' } }] } }]);
    const drawToReturn = enchantment('Test Return Instead', [{
      s: 'replace', replaces: { ev: 'draw', player: 'you' },
      body: { b: 'instead', do: [{ op: 'move', what: { ref: 'each', filter: { zone: 'graveyard', owner: 'you', isCard: true } }, to: { zone: 'hand' } }] },
    }]);
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Test Life Into Cards', 'Test Return Instead'], graveyard: ['Grizzly Bears'] }, defs: [lifeToDraw, drawToReturn] });
    const before = handSize(s, 'p1');
    const r = run(s, (g) => proposeResult(g, { ev: 'life', change: 'gain', player: 'p1', amount: 1 }));
    expect(r.need).toBeUndefined();
    expect(handSize(r.g.s, 'p1')).toBe(before + 1);
    expect(r.g.s.zones.graveyard.p1).toEqual([]);
    expect(lifeOf(r.g.s, 'p1')).toBe(20);
  });
});

describe('CR 616.1: the order of the effects', () => {
  const putOne = (s: GameState, id: string, cause?: 'rule') => (g: Parameters<Parameters<typeof run>[1]>[0]) =>
    proposeResult(g, { ev: 'counters', change: 'put', on: { id, zone: 'battlefield' }, kind: '+1/+1', count: 1, ...(cause ? { cause } : {}) });

  it('CR 616.1e: Hardened Scales and Doubling Season: the creature\'s controller chooses the order; (1+1)x2 = 4 or 1x2+1 = 3', () => {
    const s = scenario(['Grizzly Bears', 'Hardened Scales', 'Doubling Season'], { p1: { battlefield: ['Grizzly Bears', 'Hardened Scales', 'Doubling Season'] }, defs: [HARDENED_SCALES, DOUBLING_SEASON] });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const r = run(s, putOne(s, bears));
    expect(r.need?.kind).toBe('chooseReplacement');
    expect(r.need!.player).toBe('p1');
    const opts = r.need!.kind === 'chooseReplacement' ? r.need!.options : [];
    const scalesFirst = opts.find((o) => /Hardened Scales/.test(o.label))!.id;
    const seasonFirst = opts.find((o) => /Doubling Season/.test(o.label))!.id;
    expect(run(s, putOne(s, bears), [{ kind: 'chooseReplacement', id: scalesFirst }]).g.s.objects[bears]!.counters['+1/+1']).toBe(4);
    expect(run(s, putOne(s, bears), [{ kind: 'chooseReplacement', id: seasonFirst }]).g.s.objects[bears]!.counters['+1/+1']).toBe(3);
  });

  it('CR 614.16: a counter the rules put (cause "rule") is not "put by an effect": Doubling Season does not double it, Hardened Scales still applies', () => {
    const s = scenario(['Grizzly Bears', 'Hardened Scales', 'Doubling Season'], { p1: { battlefield: ['Grizzly Bears', 'Hardened Scales', 'Doubling Season'] }, defs: [HARDENED_SCALES, DOUBLING_SEASON] });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const r = run(s, putOne(s, bears, 'rule'));
    expect(r.need).toBeUndefined();
    expect(r.g.s.objects[bears]!.counters['+1/+1']).toBe(2);
  });

  it('CR 614.16, 122.6: Doubling Season doubles the counters a permanent enters with (an "enters with" replacement is an effect)', () => {
    const hydra: CardDef = withAbilities('Grizzly Bears', [staticAbility('~ enters with two +1/+1 counters on it.', [{
      s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', counters: [{ kind: '+1/+1', count: 2 }] },
    }], { zone: ['stack', 'battlefield'] })]);
    const s = scenario(['Grizzly Bears', 'Doubling Season'], { p1: { battlefield: ['Doubling Season'], graveyard: ['Grizzly Bears'] }, defs: [DOUBLING_SEASON, hydra] });
    const bears = find(s, 'Grizzly Bears', 'graveyard');
    const r = run(s, (g) => proposeResult(g, { ev: 'zoneChange', object: { id: bears, zone: 'graveyard' }, from: 'graveyard', to: 'battlefield', destination: {} }));
    expect(r.need).toBeUndefined();
    const id = r.result!.newIds[0]!;
    expect(r.g.s.objects[id]!.counters['+1/+1']).toBe(4);
  });

  it('CR 616.1a-e: klassOf puts self-replacement, control, copy and back-face effects in classes 0-3, everything else in 4', () => {
    const z = { ev: 'zoneChange' as const, subject: { self: true }, to: 'battlefield' as const };
    expect(klassOf({ s: 'replace', replaces: z, body: { b: 'modify', destination: { zone: 'exile' } }, selfReplacement: true })).toBe(0); // 616.1a
    expect(klassOf({ s: 'replace', replaces: z, body: { b: 'enters', under: { ref: 'you' } } })).toBe(1); // 616.1b
    expect(klassOf({ s: 'replace', replaces: { ev: 'zoneChange', subject: {}, to: 'graveyard' }, body: { b: 'modify', destination: { zone: 'battlefield', controller: { ref: 'you' } } } })).toBe(1); // 616.1b
    expect(klassOf({ s: 'replace', replaces: z, body: { b: 'enters', copy: { of: { types: ['Creature'] }, optional: true } } })).toBe(2); // 616.1c
    expect(klassOf({ s: 'replace', replaces: z, body: { b: 'enters', transformed: true } })).toBe(3); // 616.1d
    expect(klassOf({ s: 'replace', replaces: { ev: 'zoneChange', subject: {}, to: 'graveyard' }, body: { b: 'modify', destination: { zone: 'battlefield', controller: 'owner', transformed: true } } })).toBe(3); // 616.1d
    expect(klassOf({ s: 'replace', replaces: { ev: 'damage' }, body: { b: 'modify', amount: { mul: 2 } } })).toBe(4); // 616.1e
  });

  it('CR 614.17c: an event that cannot happen admits only self-replacement effects: a gain-more effect does not apply to life that cannot be gained', () => {
    const more = enchantment('Test More Life', [{ s: 'replace', replaces: { ev: 'life', change: 'gain', player: 'you' }, body: { b: 'modify', amount: { add: 1 } } }]);
    const s = scenario([], { p1: { battlefield: ['Test More Life'] }, defs: [more] });
    const r = run(s, (g) => {
      addPlayerRestriction(g, 'p1', 'cantGainLife');
      return proposeResult(g, { ev: 'life', change: 'gain', player: 'p1', amount: 3 });
    });
    expect(r.result).toBeNull();
    expect(lifeOf(r.g.s, 'p1')).toBe(20);
  });
});

describe('CR 616.1, 101.4 (m6 design D4, 3.1.8): simultaneous events', () => {
  it('proposeSimultaneous: the choices for simultaneous events are made in APNAP order (the active player\'s first), then all of them are performed', () => {
    // two "double that damage" effects with a prevention effect: each damage event to a creature asks its controller to order the effects
    const ward = enchantment('Test Ward', [{ s: 'replace', replaces: { ev: 'damage', recipient: { object: { types: ['Creature'] } } }, body: { b: 'prevent', amount: 1 } }]);
    const s = scenario(['Grizzly Bears', 'Hill Giant', 'Furnace of Rath'], {
      p1: { battlefield: ['Furnace of Rath', 'Hill Giant'] }, p2: { battlefield: ['Test Ward', 'Grizzly Bears'] }, defs: [FURNACE, ward],
    });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const giant = find(s, 'Hill Giant', 'battlefield');
    const dmg = (src: string, to: string) => ({ ev: 'damage' as const, source: { id: src, zone: 'battlefield' as const }, to: { id: to, zone: 'battlefield' as const }, amount: 1, combat: true, unpreventable: false });
    // listed Bob's creature first: Alice (active) is asked first anyway
    const r = run(s, (g) => proposeSimultaneous(g, [dmg(giant, bears), dmg(bears, giant)]));
    expect(r.need?.kind).toBe('chooseReplacement');
    expect(r.need!.player).toBe('p1');
    expect(r.g.events.filter((e) => e.type === 'damageDealt')).toEqual([]); // nothing performed before every choice is made
  });
});
