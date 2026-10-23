/**
 * WP2: the gate is exact (design 6.8, G6). A parse that says something other than the card fails the gate: a swapped filter, a dropped duration, a
 * missing "unless", a wrong number, a wrong player, a lost rider. Each case takes a worked example of design section 13 and breaks ONE thing.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../../../src/types/ability';
import { renderGate } from '../../../src/index';
import { examples } from './examples';

interface Example {
  name: string;
  oracle: string[];
  card: { abilities?: AbilityDef[]; faces?: { name: string; abilities: AbilityDef[] }[] };
}

type Json = unknown;
const walk = (root: Json, path: string): { parent: Record<string, Json>; key: string } => {
  const keys = path.split('.');
  const key = keys.pop()!;
  const parent = keys.reduce<Json>((n, k) => (n as Record<string, Json>)[k], root) as Record<string, Json>;
  return { parent, key };
};
const set = (root: Json, path: string, value: Json): void => {
  const { parent, key } = walk(root, path);
  parent[key] = value;
};
const del = (root: Json, path: string): void => {
  const { parent, key } = walk(root, path);
  delete parent[key];
};
const get = (root: Json, path: string): Json => {
  const { parent, key } = walk(root, path);
  return parent[key];
};

const byName = new Map((examples as unknown as Example[]).map((e) => [e.name, e]));
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** The ability at `index` of a card, its Oracle lines (as the unbroken ability covers them), and a context. */
function load(name: string, index: number, selfTypes?: string[]): { def: Json; lines: string[]; ctx: { selfNames: string[]; selfTypes?: string[] } } {
  const ex = byName.get(name)!;
  const def = clone(ex.card.abilities![index]!) as Json;
  const lines = ex.oracle.filter((l) => !l.startsWith('(') || !l.endsWith(')'));
  const ctx = { selfNames: [name, ...(name.includes(',') ? [name.split(',')[0]!] : [])], selfTypes };
  // the lines this ability covers: the shortest run from some start that the unbroken ability passes
  for (let start = 0; start < lines.length; start++) {
    for (let k = 1; start + k <= lines.length; k++) {
      if (renderGate(clone(ex.card.abilities![index]!), lines.slice(start, start + k), ctx).ok) return { def, lines: lines.slice(start, start + k), ctx };
    }
  }
  throw new Error(`${name} #${index} does not pass the gate unbroken`);
}

function expectRejected(name: string, index: number, break_: (def: Json) => void, selfTypes?: string[]): void {
  const { def, lines, ctx } = load(name, index, selfTypes);
  break_(def);
  const r = renderGate(def as AbilityDef, lines, ctx);
  expect(r.ok, `${name}: the broken ability must not pass\nrendered: ${r.rendered}\nexpected: ${r.expected}`).toBe(false);
  expect(r.firstDiff).toBeGreaterThanOrEqual(0);
}

describe('CR 608.2 (control): the unbroken examples pass', () => {
  it.each([
    ['Doom Blade', 0], ['Giant Growth', 0], ['Mana Leak', 0], ['Rabid Bite', 0], ['Swords to Plowshares', 0], ['Wrath of God', 0], ['Memory Lapse', 0], ['Lightning Bolt', 0],
  ] as [string, number][])('%s', (name, index) => {
    const { def, lines, ctx } = load(name, index);
    expect(renderGate(def as AbilityDef, lines, ctx).ok).toBe(true);
  });
});

describe('CR 109.3 and 205: a swapped or changed filter fails the gate', () => {
  it('Doom Blade: "nonblack" turned into "black"', () => {
    expectRejected('Doom Blade', 0, (d) => {
      del(d, 'effect.targets.0.filter.notColors');
      set(d, 'effect.targets.0.filter.colors', ['B']);
    });
  });
  it('Doom Blade: nonblack turned into nonred', () => expectRejected('Doom Blade', 0, (d) => set(d, 'effect.targets.0.filter.notColors', ['R'])));
  it('Doom Blade: the creature type dropped', () => expectRejected('Doom Blade', 0, (d) => set(d, 'effect.targets.0.filter.types', [])));
  it('Rabid Bite: the two targets swapped', () =>
    expectRejected('Rabid Bite', 0, (d) => {
      set(d, 'effect.steps.0.source.id', 't1');
      set(d, 'effect.steps.0.to.id', 't0');
      set(d, 'effect.steps.0.amount.of.id', 't1');
    }));
  it('Rabid Bite: "you control" removed from the first target', () => expectRejected('Rabid Bite', 0, (d) => del(d, 'effect.targets.0.filter.controller')));
  it('Wrath of God: all creatures turned into all creatures you control', () => expectRejected('Wrath of God', 0, (d) => set(d, 'effect.steps.0.what.filter.controller', 'you')));
  it('Glorious Anthem: "you control" turned into "an opponent controls"', () => expectRejected('Glorious Anthem', 0, (d) => set(d, 'effects.0.affects.filter.controller', 'opponent')));
  it('Humility: creatures turned into artifacts', () => expectRejected('Humility', 0, (d) => set(d, 'effects.0.affects.filter.types', ['Artifact'])));
  it('Cryptic Command: a mode that targets a creature instead of a permanent', () =>
    expectRejected('Cryptic Command', 0, (d) => set(d, 'effect.modes.options.1.program.targets.0.filter', { types: ['Creature'] })));
});

describe('CR 611.2a: a dropped duration fails the gate', () => {
  it('Giant Growth: no end of turn', () => expectRejected('Giant Growth', 0, (d) => set(d, 'effect.steps.0.duration', { d: 'permanent' })));
  it('Giant Growth: until end of combat', () => expectRejected('Giant Growth', 0, (d) => set(d, 'effect.steps.0.duration', { d: 'endOfCombat' })));
  it('Aspect of Hydra: the "where X is" quantity changed from green devotion to blue', () =>
    expectRejected('Aspect of Hydra', 0, (d) => set(d, 'effect.steps.0.effects.0.mods.0.power.to', ['U'])));
  it('Mutavault: the duration removed', () => expectRejected('Mutavault', 1, (d) => set(d, 'effect.steps.0.duration', { d: 'permanent' })));
  it('Mutavault: the rider "It\'s still a land" lost (types.set instead of types.add)', () =>
    expectRejected('Mutavault', 1, (d) => set(d, 'effect.steps.0.effects.0.mods.0.types', { set: get(d, 'effect.steps.0.effects.0.mods.0.types.add') }), ['Land']));
  it('Magma Spray: the manual shield loses its words', () => expectRejected('Magma Spray', 0, (d) => set(d, 'effect.steps.1.text', 'If that creature would die this turn, destroy it instead.')));
});

describe('CR 118.12a and 608.2d: a missing "unless" or "may" fails the gate', () => {
  it('Mana Leak: no payment at all', () => expectRejected('Mana Leak', 0, (d) => set(d, 'effect.steps', [get(d, 'effect.steps.0.else.0')])));
  it('Mana Leak: the caster pays instead of the spell\'s controller', () => expectRejected('Mana Leak', 0, (d) => set(d, 'effect.steps.0.who', { ref: 'you' })));
  it('Mana Leak: three mana instead of {3} of another cost', () => expectRejected('Mana Leak', 0, (d) => set(d, 'effect.steps.0.cost.mana.0.amount', 4)));
  it('Rhystic Study: the draw is not optional', () => expectRejected('Rhystic Study', 0, (d) => set(d, 'effect.steps.0.else', [{ op: 'draw', who: { ref: 'you' }, count: 1 }])));
  it('Rhystic Study: the opponent pays 2', () => expectRejected('Rhystic Study', 0, (d) => set(d, 'effect.steps.0.cost.mana.0.amount', 2)));
  it('Pact of Negation: the loss of the game removed', () => expectRejected('Pact of Negation', 0, (d) => set(d, 'effect.steps.1.do.0.else', [])));
  it('Fiend Hunter: not optional ("you may" removed)', () => expectRejected('Fiend Hunter', 0, (d) => set(d, 'effect.steps', get(d, 'effect.steps.0.do'))));
  it('Path to Exile: the land goes untapped', () => expectRejected('Path to Exile', 0, (d) => set(d, 'effect.steps.1.do.1.to.tapped', false)));
  it('Path to Exile: the search is for any card', () => expectRejected('Path to Exile', 0, (d) => set(d, 'effect.steps.1.do.0.filter', { zone: 'library' })));
});

describe('CR 608.2b-c, 107.1: numbers, players and riders', () => {
  it('Lightning Bolt: 4 damage', () => expectRejected('Lightning Bolt', 0, (d) => set(d, 'effect.steps.0.amount', 4)));
  it('Lightning Bolt: any target turned into target creature', () => expectRejected('Lightning Bolt', 0, (d) => set(d, 'effect.targets.0.kind', 'object')));
  it('Swords to Plowshares: you gain the life instead of its controller', () => expectRejected('Swords to Plowshares', 0, (d) => set(d, 'effect.steps.1.who', { ref: 'you' })));
  it('Swords to Plowshares: life equal to its toughness', () => expectRejected('Swords to Plowshares', 0, (d) => set(d, 'effect.steps.1.amount.stat', 'toughness')));
  it('Wrath of God: "they can\'t be regenerated" lost', () => expectRejected('Wrath of God', 0, (d) => del(d, 'effect.steps.0.regeneration')));
  it('Memory Lapse: the spell goes to the bottom instead of the top', () => expectRejected('Memory Lapse', 0, (d) => set(d, 'effect.steps.0.to.position', 'bottom')));
  it('Memory Lapse: plain counter', () => expectRejected('Memory Lapse', 0, (d) => del(d, 'effect.steps.0.to')));
  it('Raise the Alarm: three tokens', () => expectRejected('Raise the Alarm', 0, (d) => set(d, 'effect.steps.0.count', 3)));
  it('Raise the Alarm: red tokens', () => expectRejected('Raise the Alarm', 0, (d) => set(d, 'effect.steps.0.token.colors', ['R'])));
  it('Blood Artist: you lose the life and they gain it', () =>
    expectRejected('Blood Artist', 0, (d) => {
      set(d, 'effect.steps.0.who', { ref: 'you' });
      set(d, 'effect.steps.1.who', { ref: 'target', id: 't0' });
    }, ['Creature']));
  it('Flametongue Kavu: 3 damage', () => expectRejected('Flametongue Kavu', 0, (d) => set(d, 'effect.steps.0.amount', 3), ['Creature']));
  it('Llanowar Elves: adds red', () => expectRejected('Llanowar Elves', 0, (d) => set(d, 'effect.steps.0.units', [['R']])));
  it('Llanowar Elves: no tap', () => expectRejected('Llanowar Elves', 0, (d) => del(d, 'cost.tap')));
  it('Jace Beleren: -1 became -2', () => expectRejected('Jace Beleren', 1, (d) => set(d, 'cost.loyalty', -2)));
  it('Thalia: costs 2 more', () => expectRejected('Thalia, Guardian of Thraben', 1, (d) => set(d, 'effects.0.change.generic', 2), ['Creature']));
  it('Thalia: creature spells instead of noncreature spells', () => expectRejected('Thalia, Guardian of Thraben', 1, (d) => set(d, 'effects.0.applies.spells', { zone: 'stack', types: ['Creature'] }), ['Creature']));
  it('Kavu Titan: only two counters', () => expectRejected('Kavu Titan', 1, (d) => set(d, 'effects.0.body.counters.0.count', 2), ['Creature']));
  it('Kavu Titan: the keyword is not granted', () => expectRejected('Kavu Titan', 1, (d) => (get(d, 'effects') as Json[]).pop(), ['Creature']));
  it('Hallowed Fountain: pays 3 life', () => expectRejected('Hallowed Fountain', 0, (d) => set(d, 'effects.0.body.tappedUnlessPay.other.0.amount', 3), ['Land']));
  it('Cavern of Souls: the spell can be countered', () => expectRejected('Cavern of Souls', 2, (d) => del(d, 'effect.steps.0.restriction.spellRider'), ['Land']));
});

describe('design 6.8 (G6): a node the renderer cannot print fails the gate instead of being skipped', () => {
  const ctx = { selfNames: ['Test Card'] };
  it('a step whose op is not in the model', () => {
    const def = { kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'frobnicate' }] } } as unknown as AbilityDef;
    const r = renderGate(def, ['Frobnicate.'], ctx);
    expect(r.ok).toBe(false);
    expect(r.rendered).toContain('cannot render');
  });
  it('a target reference with no such target', () => {
    const def: AbilityDef = { kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'destroy', what: { ref: 'target', id: 'nope' } }] } };
    expect(renderGate(def, ['Destroy target creature.'], ctx).ok).toBe(false);
  });
  it('a fixed handle (written only by the engine)', () => {
    const def: AbilityDef = { kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'destroy', what: { ref: 'fixed', objects: [] } }] } };
    expect(renderGate(def, ['Destroy it.'], ctx).ok).toBe(false);
  });
});
