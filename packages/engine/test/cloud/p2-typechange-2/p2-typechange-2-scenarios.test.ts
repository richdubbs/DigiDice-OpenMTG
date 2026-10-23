/**
 * p2-typechange-2 (Phase 2 lane p2-typechange): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 305.6, 205.3i    "gets +1/+1 until end of turn for each basic land type among lands you control": each basic land type counted once
 *   CR 105.3, 205.1b    "Enchanted creature gets -1/-1 and is a black Zombie in addition to its other colors and types"; "Until end of turn, target creature you
 *                       control becomes a blue artifact in addition to its other colors and types"
 *   CR 205.1a, 613.7    "~ becomes an enchantment" after an earlier "it becomes a 2/4 Soldier creature": the later type change wins, the creature type goes
 *   CR 611.2c, 613.1f   "Until end of turn, creatures target player controls lose all abilities and have base power and toughness 0/2": the group is fixed
 *   CR 305.6, 205.1b    "Nontoken creatures you control are Forest lands in addition to their other types": they are lands and Forests
 *   CR 611.3b, 613.4b   "As long as you control three or more enchantments, each other non-Aura enchantment you control is a creature ... equal to its mana value"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, pass, put, scenario } from '../../m5/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const types = (s: GameState, id: ObjectId): string[] => [...getChars(s, id)!.types].sort();
const subtypes = (s: GameState, id: ObjectId): string[] => [...getChars(s, id)!.subtypes].sort();
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };

/** Answer pending decisions (costs, targets, yes to a may, the queued answers) until a player has priority with an empty stack. */
function settle(s0: GameState, answers: DecisionAnswer[] = [], targets: ObjectId[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; guard < 60 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.map((id) => ({ kind: 'object' as const, id })) });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (queue.length > 0 && queue[0]!.kind === d.kind) s = answer(s, queue.shift()!);
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
  }
  return s;
}
const activate = (s: GameState, source: ObjectId): GameState => {
  const a = legalActions(s, s.pending!.player).find((x) => x.kind === 'activate' && x.object === source && !x.isMana);
  if (!a) throw new Error('no activation');
  return settle(act(s, a.action));
};
const cast = (s: GameState, name: string, answers: DecisionAnswer[] = [], targets: ObjectId[] = []): GameState =>
  settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), answers, targets);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const CHARM = card('Test Charm', 'Enchantment', '', { cost: '{2}' });

describe('CR 305.6, 205.3i: "for each basic land type among lands you control" (the Qty hole after "for each")', () => {
  const RISE = card('Test Rise', 'Instant', 'Target creature gets +1/+1 until end of turn for each basic land type among lands you control.');
  const DUAL = card('Test Dual', 'Land — Plains Island', '');
  it('is automated; Plains, Island and a Plains Island give +2/+2 (each type once)', () => {
    expect(full(RISE)).toBe(true);
    let s = scenario(['Plains', 'Island'], { p1: { battlefield: ['Test Bear', 'Plains', 'Island', 'Test Dual'], hand: ['Test Rise'] }, defs: [RISE, BEAR, DUAL] });
    s = advanceTo(s, 1, 'main1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Rise', [], [bear]);
    expect(pt(s, bear)).toBe('4/4');
  });
});

describe('CR 105.3, 205.1b, 613.1d-e: "... is a black Zombie in addition to its other colors and types" and "becomes a blue artifact in addition to its other colors and types"', () => {
  const ROT = card('Test Rot', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets -1/-1 and is a black Zombie in addition to its other colors and types.');
  const RED = compileCard({ name: 'Test Red Bear', layout: 'normal', mana_cost: '{0}', type_line: 'Creature — Bear', oracle_text: '', colors: ['R'], keywords: [], power: '2', toughness: '2' } as OracleCard);
  const FORGE = card('Test Forge', 'Artifact', '{1}: Until end of turn, target creature you control becomes a blue artifact in addition to its other colors and types.');
  it('both are automated', () => {
    expect(full(ROT)).toBe(true);
    expect(full(FORGE)).toBe(true);
  });
  it('the enchanted red Bear is a red and black Bear Zombie 1/1', () => {
    let s = scenario([], { p1: { battlefield: ['Test Red Bear'], hand: ['Test Rot'] }, defs: [ROT, RED] });
    s = advanceTo(s, 1, 'main1');
    const bear = find(s, 'Test Red Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Rot', [], [bear]);
    expect([...getChars(s, bear)!.colors].sort()).toEqual(['B', 'R']);
    expect(subtypes(s, bear)).toEqual(['Bear', 'Zombie']);
    expect(types(s, bear)).toEqual(['Creature']);
    expect(pt(s, bear)).toBe('1/1');
  });
  it('the target red Bear is a red and blue artifact creature until end of turn', () => {
    let s = scenario([], { p1: { battlefield: ['Test Forge', 'Test Red Bear', 'Plains'] }, defs: [FORGE, RED] });
    s = advanceTo(s, 1, 'main1');
    const bear = find(s, 'Test Red Bear', 'battlefield', 'p1');
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === find(s, 'Test Forge', 'battlefield', 'p1'));
    s = settle(act(s, a!.action), [], [bear]);
    expect([...getChars(s, bear)!.colors].sort()).toEqual(['R', 'U']);
    expect(types(s, bear)).toEqual(['Artifact', 'Creature']);
    s = advanceTo(s, 2, 'main1');
    expect(types(s, bear)).toEqual(['Creature']);
    expect(getChars(s, bear)!.colors).toEqual(['R']);
  });
});

describe('CR 205.1a, 205.3d, 613.7: "This permanent becomes an enchantment." after it became a 2/4 Soldier creature', () => {
  const STATUE = card('Test Statue', 'Enchantment', 'Whenever you cast a creature spell, if this enchantment is an enchantment, it becomes a 2/4 Soldier creature.\n{0}: This permanent becomes an enchantment.');
  it('is automated; the later change makes it an enchantment again with no creature type, and the next creature spell turns it back', () => {
    expect(full(STATUE)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Statue'], hand: ['Test Bear', 'Test Bear'] }, defs: [STATUE, BEAR] });
    s = advanceTo(s, 1, 'main1');
    const statue = find(s, 'Test Statue', 'battlefield', 'p1');
    s = cast(s, 'Test Bear');
    expect(types(s, statue)).toEqual(['Creature']);
    s = activate(s, statue);
    expect(types(s, statue)).toEqual(['Enchantment']);
    expect(subtypes(s, statue)).toEqual([]);
    s = cast(s, 'Test Bear');
    expect(types(s, statue)).toEqual(['Creature']);
    expect(pt(s, statue)).toBe('2/4');
  });
});

describe('CR 611.2a, 611.2c, 613.1f, 613.4b: "Until end of turn, <creatures> lose all abilities and have base power and toughness 0/2"', () => {
  const ROT = card('Test Wilt', 'Instant', 'Until end of turn, creatures target player controls lose all abilities and have base power and toughness 0/2.');
  const ONE = card('Test Sheepify', 'Instant', 'Until end of turn, target creature loses all abilities and has base power and toughness 1/3.');
  const FLYER = card('Test Flyer', 'Creature — Bird', 'Flying', { pt: ['3', '3'] });
  it('both are automated', () => {
    expect(full(ROT)).toBe(true);
    expect(full(ONE)).toBe(true);
  });
  it('the opponent\'s creatures are 0/2 with no abilities; one that enters later is not; mine are untouched', () => {
    let s = scenario([], { p1: { battlefield: ['Test Flyer'], hand: ['Test Wilt'] }, p2: { battlefield: ['Test Flyer'] }, defs: [ROT, FLYER] });
    s = advanceTo(s, 1, 'main1');
    const theirs = find(s, 'Test Flyer', 'battlefield', 'p2');
    const mine = find(s, 'Test Flyer', 'battlefield', 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Wilt', 'hand', 'p1') });
    expect(s.pending?.kind).toBe('chooseTargets');
    s = settle(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }));
    expect(pt(s, theirs)).toBe('0/2');
    expect(getChars(s, theirs)!.keywords).toEqual([]);
    expect(pt(s, mine)).toBe('3/3');
    const late = put(s, 'p2', 'battlefield', 'Test Flyer');
    expect(pt(s, late)).toBe('3/3');
  });
  it('the single target is 1/3 with no abilities until end of turn', () => {
    let s = scenario([], { p1: { hand: ['Test Sheepify'] }, p2: { battlefield: ['Test Flyer'] }, defs: [ONE, FLYER] });
    s = advanceTo(s, 1, 'main1');
    const theirs = find(s, 'Test Flyer', 'battlefield', 'p2');
    s = cast(s, 'Test Sheepify', [], [theirs]);
    expect(pt(s, theirs)).toBe('1/3');
    expect(getChars(s, theirs)!.keywords).toEqual([]);
    s = advanceTo(s, 2, 'main1');
    expect(pt(s, theirs)).toBe('3/3');
  });
});

describe('CR 205.1b, 305.6: "Nontoken creatures you control are Forest lands in addition to their other types."', () => {
  const GROVE = card('Test Grove', 'Enchantment', 'Nontoken creatures you control are Forest lands in addition to their other types.');
  it('is automated; my creature is a Creature Land with Bear and Forest; the opponent\'s is not', () => {
    expect(full(GROVE)).toBe(true);
    const s = scenario([], { p1: { battlefield: ['Test Grove', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs: [GROVE, BEAR] });
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(types(s, mine)).toEqual(['Creature', 'Land']);
    expect(subtypes(s, mine)).toEqual(['Bear', 'Forest']);
    expect(types(s, find(s, 'Test Bear', 'battlefield', 'p2'))).toEqual(['Creature']);
  });
});

describe('CR 611.3b, 613.4b, 202.3: "As long as you control three or more enchantments, each other non-Aura enchantment you control is a creature ..."', () => {
  const NYX = card('Test Nyx', 'Enchantment', 'As long as you control three or more enchantments, each other non-Aura enchantment you control is a creature in addition to its other types and has base power and base toughness each equal to its mana value.');
  it('is automated; with three enchantments the other ones are 2/2 enchantment creatures (mana value 2), ~ is not; with two, none is', () => {
    expect(full(NYX)).toBe(true);
    const s = scenario([], { p1: { battlefield: ['Test Nyx', 'Test Charm', 'Test Charm'] }, defs: [NYX, CHARM] });
    const nyx = find(s, 'Test Nyx', 'battlefield', 'p1');
    for (const id of s.zones.battlefield.filter((x) => s.objects[x]!.defId === 'Test Charm')) {
      expect(types(s, id)).toEqual(['Creature', 'Enchantment']);
      expect(pt(s, id)).toBe('2/2');
    }
    expect(types(s, nyx)).toEqual(['Enchantment']);
    const s2 = scenario([], { p1: { battlefield: ['Test Nyx', 'Test Charm'] }, defs: [NYX, CHARM] });
    expect(types(s2, find(s2, 'Test Charm', 'battlefield', 'p1'))).toEqual(['Enchantment']);
  });
});
