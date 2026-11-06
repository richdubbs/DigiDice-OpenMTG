/**
 * Commander lane edh-next, round edh-next-45 (EDHREC ranks 18,751-20,000, second pass): the round's readings played through the engine with synthetic cards (invented names),
 * compiled by the game's default compiler. Alice (p1) acts. Each test is named after the rule it checks, with its negative case. CR cites are from memory unless noted
 * (cloud session, checked against the Comprehensive Rules text of 2026-09-25 where the round's record says so).
 *
 *   CR 106.12, 614.1a, 106.1b   "If a land is tapped for mana, it produces {B} instead of any other type."
 *   CR 601.2b, 118.3, 701.21a   "As an additional cost to cast this spell, sacrifice all creatures you control." + "total power of the sacrificed creatures"
 *   CR 702.59a, 119.4, 608.2h   "Recover--Pay half your life, rounded up."
 *   CR 107.3, 122.1, 608.2h     "Remove all <kind> counters from ~: Look at the top X cards ..., where X is the number of <kind> counters removed this way"
 *   CR 702.24a, 118.3           "Cumulative upkeep--Pay {B} and 1 life."
 */
import { describe, expect, it } from 'vitest';
import { activatedAbilities, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, find, legal, life, pass, pool, put, scenario, zoneNames } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { counters, full, resolveAll, settle } from '../cmd3/helpers';

function card(name: string, type: string, text: string, ptv?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(ptv ? { power: ptv[0], toughness: ptv[1] } : {}) } as OracleCard);
}
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const BIG = card('Test Big Bear', 'Creature — Bear', '', ['3', '5']);
const FOREST = card('Test Forest', 'Basic Land — Forest', '{T}: Add {G}.');
const TWIN = card('Test Twin Land', 'Land', '{T}: Add {W}{W}.');

describe('CR 106.12, 614.1a, 106.1b: "If a land is tapped for mana, it produces {B} instead of any other type."', () => {
  const DARK = card('Test Dark Ritual Field', 'Enchantment', 'If a land is tapped for mana, it produces {B} instead of any other type.');
  const GREEN_SPELL = card('Test Green Spell', 'Sorcery', 'You gain 1 life.', undefined, '{G}', ['G']);
  const BLACK_SPELL = card('Test Black Spell', 'Sorcery', 'You gain 1 life.', undefined, '{B}', ['B']);
  const DEFS = [DARK, FOREST, TWIN, GREEN_SPELL, BLACK_SPELL];
  const tap = (s: GameState, name: string, who = 'p1'): GameState => {
    const src = find(s, name, 'battlefield', who);
    return settle(act(s, { type: 'activate', player: who, source: src, ability: activatedAbilities(s, s.objects[src]!)[0]!.key } as never));
  };
  const castable = (s: GameState, who = 'p1'): string[] => legal(s, who, 'cast').map((a) => s.objects[(a as { object: ObjectId }).object]!.defId);
  it('is automated', () => expect(full(DARK)).toBe(true));
  it('a Forest tapped for {G} produces {B}; a land that would add {W}{W} adds {B}{B} (the amount is unchanged)', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Dark Ritual Field', 'Test Forest', 'Test Twin Land'] } });
    expect(pool(tap(s0, 'Test Forest'), 'p1')).toBe('B');
    expect(pool(tap(s0, 'Test Twin Land'), 'p1')).toBe('BB');
  });
  it('the payment planner agrees: {B} can be paid with the Forest, {G} cannot; an opponent\'s lands are affected too', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Green Spell', 'Test Black Spell'], battlefield: ['Test Dark Ritual Field', 'Test Forest'] } });
    expect(castable(s0)).toContain('Test Black Spell');
    expect(castable(s0)).not.toContain('Test Green Spell');
    const s1 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Forest'] }, p2: { battlefield: ['Test Dark Ritual Field'] } });
    expect(pool(tap(s1, 'Test Forest'), 'p1')).toBe('B');
  });
  it('negative: without it the Forest adds {G} and {B} cannot be paid', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Green Spell', 'Test Black Spell'], battlefield: ['Test Forest'] } });
    expect(pool(tap(s0, 'Test Forest'), 'p1')).toBe('G');
    expect(castable(s0)).toContain('Test Green Spell');
    expect(castable(s0)).not.toContain('Test Black Spell');
  });
});

describe('CR 601.2b, 118.3, 701.21a, 608.2h: "As an additional cost to cast this spell, sacrifice all creatures you control." / "equal to the total power of the sacrificed creatures"', () => {
  const BLAST = card('Test Final Blast', 'Instant', 'As an additional cost to cast this spell, sacrifice all creatures you control.\nTest Final Blast deals damage to any target equal to the total power of the sacrificed creatures.');
  const DEFS = [BLAST, BEAR, BIG];
  it('is automated', () => expect(full(BLAST)).toBe(true));
  it('every creature you control is sacrificed (not the opponent\'s) and the damage is their total power', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Final Blast'], battlefield: ['Test Bear', 'Test Big Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const s1 = resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Final Blast', 'hand', 'p1') }), { targets: [{ kind: 'player', id: 'p2' }] }));
    expect(life(s1, 'p2')).toBe(20 - 5);
    expect(s1.zones.battlefield.filter((id) => s1.objects[id]!.controller === 'p1')).toHaveLength(0);
    expect(s1.zones.battlefield.filter((id) => s1.objects[id]!.controller === 'p2')).toHaveLength(1);
  });
  it('CR 603.10a, 608.2h: the creatures leave together, so a sacrificed lord still pumps the others in the total (2+2 power, +1 each, = 5 in either order)', () => {
    const LORD = card('Test Lord', 'Creature — Elf', 'Other creatures you control get +1/+1.', ['2', '2']);
    for (const order of [['Test Lord', 'Test Bear'], ['Test Bear', 'Test Lord']]) {
      const s0 = scenario([], { defs: [...DEFS, LORD], p1: { hand: ['Test Final Blast'], battlefield: order } });
      const s1 = resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Final Blast', 'hand', 'p1') }), { targets: [{ kind: 'player', id: 'p2' }] }));
      expect(life(s1, 'p2'), order.join()).toBe(20 - 5);
    }
  });
  it('negative: with no creature the spell is still castable (a cost of nothing) and deals 0', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Final Blast'] } });
    expect(legal(s0, 'p1', 'cast').length).toBe(1);
    const s1 = resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Final Blast', 'hand', 'p1') }), { targets: [{ kind: 'player', id: 'p2' }] }));
    expect(life(s1, 'p2')).toBe(20);
  });
});

describe('CR 702.59a, 119.4, 608.2h: "Recover--Pay half your life, rounded up."', () => {
  const MUMMY = card('Test Recovering Mummy', 'Creature — Zombie', 'Recover—Pay half your life, rounded up.', ['1', '1']);
  const ZAP = card('Test Zap', 'Instant', 'Destroy target creature.', undefined, '{0}');
  const DEFS = [MUMMY, BEAR, ZAP];
  const run = (lifeTotal: number, yes: boolean): GameState => {
    const s0 = tweak(scenario([], { defs: DEFS, p1: { hand: ['Test Zap'], battlefield: ['Test Bear'], graveyard: ['Test Recovering Mummy'] } }), (t) => { t.players.find((p) => p.id === 'p1')!.life = lifeTotal; });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    return resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Zap', 'hand', 'p1') }), { targets: [{ kind: 'object', id: bear }], yes }), { yes });
  };
  it('is automated', () => expect(full(MUMMY)).toBe(true));
  it('paying half your life rounded up (20 -> 10; 7 -> 3) returns it to hand', () => {
    const a = run(20, true);
    expect(life(a, 'p1')).toBe(10);
    expect(zoneNames(a, 'hand', 'p1')).toContain('Test Recovering Mummy');
    const b = run(7, true);
    expect(life(b, 'p1')).toBe(3);
    expect(zoneNames(b, 'hand', 'p1')).toContain('Test Recovering Mummy');
  });
  it('negative: not paying exiles it and costs no life', () => {
    const a = run(20, false);
    expect(life(a, 'p1')).toBe(20);
    expect(zoneNames(a, 'hand', 'p1')).not.toContain('Test Recovering Mummy');
    expect(a.zones.exile.some((id) => a.objects[id]!.defId === 'Test Recovering Mummy')).toBe(true);
  });
});

describe('CR 107.3, 122.1, 608.2h: "Remove all eyeball counters from ~: Look at the top X cards of your library, where X is the number of eyeball counters removed this way."', () => {
  const JAR = card('Test Eyeball Jar', 'Artifact', '{1}, {T}, Remove all eyeball counters from ~: Look at the top X cards of your library, where X is the number of eyeball counters removed this way. Put one of them into your hand and the rest on the bottom of your library in any order.');
  const A = card('Test Card A', 'Sorcery', 'You gain 1 life.');
  const B = card('Test Card B', 'Sorcery', 'You gain 1 life.');
  const C = card('Test Card C', 'Sorcery', 'You gain 1 life.');
  const D = card('Test Card D', 'Sorcery', 'You gain 1 life.');
  it('is automated', () => expect(full(JAR)).toBe(true));
  const lookCount = (n: number): { options: number; s: GameState; jar: ObjectId } => {
    if (n === 1) throw new Error('one card needs no choice');
    const s0 = scenario([], { defs: [JAR, A, B, C, D, FOREST], p1: { battlefield: [{ name: 'Test Eyeball Jar', counters: { eyeball: n } }, 'Test Forest'], library: ['Test Card A', 'Test Card B', 'Test Card C', 'Test Card D'] } });
    const jar = find(s0, 'Test Eyeball Jar', 'battlefield', 'p1');
    let s = settle(act(s0, { type: 'activate', player: 'p1', source: jar, ability: activatedAbilities(s0, s0.objects[jar]!)[0]!.key } as never));
    for (let i = 0; i < 6 && s.pending?.kind === 'priority'; i++) s = pass(s);
    const d = s.pending as unknown as { kind: string; options?: ObjectId[] };
    expect(d.kind).toBe('chooseObjects');
    return { options: d.options!.length, s, jar };
  };
  it('with three counters it looks at exactly three cards, and every counter is removed', () => {
    const { options, s, jar } = lookCount(3);
    expect(options).toBe(3);
    expect(counters(s, jar, 'eyeball')).toBe(0);
    const done = resolveAll(s);
    expect(zoneNames(done, 'hand', 'p1')).toHaveLength(1);
  });
  it('negative: with one counter it looks at one card only', () => {
    const s0 = scenario([], { defs: [JAR, A, B, C, D, FOREST], p1: { battlefield: [{ name: 'Test Eyeball Jar', counters: { eyeball: 1 } }, 'Test Forest'], library: ['Test Card A', 'Test Card B', 'Test Card C', 'Test Card D'] } });
    const jar = find(s0, 'Test Eyeball Jar', 'battlefield', 'p1');
    const before = s0.zones.library['p1']!.length;
    const s1 = resolveAll(act(s0, { type: 'activate', player: 'p1', source: jar, ability: activatedAbilities(s0, s0.objects[jar]!)[0]!.key } as never));
    expect(zoneNames(s1, 'hand', 'p1')).toHaveLength(1); // the only card looked at
    expect(s1.zones.library['p1']!.length).toBe(before - 1);
    expect(counters(s1, jar, 'eyeball')).toBe(0);
  });
});

describe('CR 702.24a, 118.3: "Cumulative upkeep--Pay {B} and 1 life."', () => {
  const FIELD = card('Test Upkeep Field', 'Enchantment', 'Cumulative upkeep—Pay {B} and 1 life.');
  it('is automated', () => expect(full(FIELD)).toBe(true));
  it('compiles to the mana and the life as two parts of one cost', () => {
    const k = FIELD.faces[0]!.abilities.find((a) => a.kind === 'keyword') as unknown as { cost?: { mana?: unknown; other?: { kind: string; amount: number }[] } };
    expect(JSON.stringify(k.cost?.mana)).toContain('"B"');
    expect(k.cost?.other).toEqual([{ kind: 'payLife', amount: 1 }]);
  });
});
describe('CR 702.24a, 118.3: Cumulative upkeep--Pay {B} and 1 life, played (paid once for each age counter)', () => {
  const FIELD = card('Test Upkeep Field', 'Enchantment', 'Cumulative upkeep—Pay {B} and 1 life.');
  const SWAMP = card('Test Swamp', 'Basic Land — Swamp', '{T}: Add {B}.');
  const upkeep = (swamps: number, ageStart: number, pay: boolean): GameState => {
    const s0 = scenario([], { defs: [FIELD, SWAMP], p1: { battlefield: [{ name: 'Test Upkeep Field', counters: { age: ageStart } }, ...Array(swamps).fill('Test Swamp')] } });
    let s = advanceTo(s0, 3, 'upkeep');
    for (let i = 0; i < 12 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s, { yes: pay });
    return s;
  };
  it('with one age counter already, two counters are on it at the upkeep: pays {B}{B} and 2 life', () => {
    const s = upkeep(2, 1, true);
    const field = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Upkeep Field')!;
    expect(field).toBeDefined();
    expect(counters(s, field, 'age')).toBe(2);
    expect(life(s, 'p1')).toBe(20 - 2);
  });
  it('negative: without the black mana it is sacrificed and no life is paid', () => {
    const s = upkeep(0, 1, true);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Upkeep Field')).toBe(false);
    expect(life(s, 'p1')).toBe(20);
  });
});
void put;
