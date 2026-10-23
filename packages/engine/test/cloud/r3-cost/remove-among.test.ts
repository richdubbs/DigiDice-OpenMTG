/**
 * r3-cost: the cost "Remove N counters from among <permanents>" (types CostPart removeCounters.among; parser/holes/cost.ts, rules/cost.ts#partsDenial,
 * rules/pay-parts.ts#removeCountersAmong), played through the engine with synthetic cards compiled from invented wordings (design 6.10).
 *
 *   CR 118.3, 122.1    "Remove two +1/+1 counters from among artifacts you control": two in all, from one or several of them, the payer's choice; not payable
 *                      with fewer in all; counters on permanents the filter does not describe do not count
 *   CR 122.1           "three counters" names no kind: any kinds, the payer's choice
 *   CR 601.3, 601.2f   "You may cast ~ from your graveyard by removing four counters from among creatures you control in addition to paying its other costs"
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { act, activations, answer, card, drive, find, full, resolveAll, scenario } from './support';

const WORKSHOP = card('Test Gear Workshop', 'Artifact', '{1}, Remove two +1/+1 counters from among artifacts you control: Draw a card.', '{2}');
const GOLEM = card('Test Brass Golem', 'Artifact Creature — Golem', '', '{2}', ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
const SHRINE = card('Test Counter Shrine', 'Enchantment', '{2}, Remove three counters from among creatures you control: You gain 5 life.', '{1}');
const WURM = card('Test Grave Wurm', 'Creature — Wurm', 'Trample\nYou may cast this card from your graveyard by removing four counters from among creatures you control in addition to paying its other costs.', '{1}{G}', ['5', '5']);
const DEFS = [WORKSHOP, GOLEM, BEAR, SHRINE, WURM];

const counters = (s: GameState, name: string, kind = '+1/+1'): number[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name).map((id) => s.objects[id]!.counters[kind] ?? 0);
const lifeOf = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.life;

describe('r3-cost: "Remove N counters from among <permanents>" (CR 118.3, 122.1)', () => {
  it('the cards are automated', () => {
    for (const d of DEFS) expect(full(d), d.name).toBe(true);
  });
  it('two +1/+1 counters, one from each of two Golems, the payer choosing each one; a card is drawn', () => {
    const golem = { name: 'Test Brass Golem', counters: { '+1/+1': 1 } };
    let s = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Gear Workshop', golem, golem, 'Plains'], library: ['Plains', 'Plains'] } });
    const hand = s.zones.hand.p1!.length;
    const [draw] = activations(s, 'Test Gear Workshop');
    expect(draw).toBeDefined();
    s = act(s, draw!.action);
    for (let guard = 0; guard < 10 && s.pending && s.pending.kind !== 'priority'; guard++) {
      const p = s.pending;
      if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [p.options[0]!] });
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected ${p.kind}`);
    }
    s = resolveAll(s);
    expect(s.zones.hand.p1!.length).toBe(hand + 1);
    expect(counters(s, 'Test Brass Golem')).toEqual([0, 0]);
  });
  it('two from one Golem that has two; with one counter in all it is not offered; a creature that is not an artifact does not count', () => {
    let s = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Gear Workshop', { name: 'Test Brass Golem', counters: { '+1/+1': 2 } }, 'Plains'], library: ['Plains'] } });
    s = resolveAll(drive(act(s, activations(s, 'Test Gear Workshop')[0]!.action)));
    expect(counters(s, 'Test Brass Golem')).toEqual([0]);
    const one = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Gear Workshop', { name: 'Test Brass Golem', counters: { '+1/+1': 1 } }, { name: 'Test Bear', counters: { '+1/+1': 3 } }, 'Plains'] } });
    expect(activations(one, 'Test Gear Workshop')).toEqual([]);
  });
  it('CR 122.1: "three counters" of any kinds, from among creatures you control', () => {
    let s = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Counter Shrine', { name: 'Test Bear', counters: { '+1/+1': 2, shield: 1 } }, 'Plains', 'Plains'] } });
    const life = lifeOf(s);
    s = act(s, activations(s, 'Test Counter Shrine')[0]!.action);
    for (let guard = 0; guard < 10 && s.pending && s.pending.kind !== 'priority'; guard++) {
      const p = s.pending;
      if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [p.options[0]!.id] });
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected ${p.kind}`);
    }
    s = resolveAll(s);
    expect(lifeOf(s)).toBe(life + 5);
    const bear = s.objects[find(s, 'Test Bear', 'battlefield', 'p1')]!;
    expect(bear.counters).toEqual({});
  });
  it('CR 601.3, 601.2f: the Wurm is cast from the graveyard by removing four counters from among creatures you control as well as its mana cost', () => {
    const many = { name: 'Test Bear', counters: { '+1/+1': 4 } };
    let s = scenario(['Forest'], { defs: DEFS, p1: { battlefield: [many, 'Forest', 'Forest'], graveyard: ['Test Grave Wurm'] } });
    const wurm = find(s, 'Test Grave Wurm', 'graveyard', 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: wurm });
    for (let guard = 0; guard < 10 && s.pending && s.pending.kind !== 'priority'; guard++) {
      const p = s.pending;
      if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected ${p.kind}`);
    }
    s = resolveAll(s);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Grave Wurm')).toBe(true);
    expect(counters(s, 'Test Bear')).toEqual([0]);
    const few = scenario(['Forest'], { defs: DEFS, p1: { battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 3 } }, 'Forest', 'Forest'], graveyard: ['Test Grave Wurm'] } });
    expect(() => act(few, { type: 'cast', player: 'p1', card: find(few, 'Test Grave Wurm', 'graveyard', 'p1') })).toThrow();
  });
});
