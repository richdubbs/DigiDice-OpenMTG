/**
 * FAST5X E16: excess damage played through the engine (rules/damage.ts computes it, effects/handlers/lifedamage.ts records it per step, `{q:'excessDamage'}`
 * reads it, triggers/match.ts matches "are dealt excess damage"). Synthetic cards are compiled by the game's default compiler with invented wordings
 * (design 6.10); the real cards are fixture cards.
 *
 *   CR 120.4a   excess damage: beyond lethal damage for a creature (its toughness minus the damage already marked on it), beyond loyalty for a planeswalker
 *   CR 702.2c   any nonzero damage from a source with deathtouch is lethal damage for that purpose (and CR 120.4a: "greater than 1 is excess")
 *   CR 120.4b   prevented damage is not dealt, so it is not excess damage
 *   CR 120.10   "is dealt excess damage" triggers; CR 603.2c "one or more" triggers once per event
 *   CR 608.2c   "this way": the damage or fight instruction just before
 *   CR 603.12   "When excess damage is dealt to ... this way": a reflexive trigger, its target chosen when it is put on the stack
 *   CR 701.14   fight (CR 701.14d: fight damage is not combat damage)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, life, pass, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', loyalty?: string): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...(loyalty ? { loyalty } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

interface Picks { targets?: TargetChoice[][]; x?: number }
/** Answer the decisions in front of us until a player has priority: each target decision takes the next list of `targets`. */
function settle(s0: GameState, p: Picks = {}): GameState {
  let s = s0;
  const queue = [...(p.targets ?? [])];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: p.x ?? 0 });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: queue.shift() ?? [] });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else break;
  }
  return s;
}
function resolveAll(s0: GameState, p: Picks = {}): GameState {
  let s = settle(s0, p);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(pass(s), p);
  return s;
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
/** Pass priority until the top object of the stack has resolved (both players pass, CR 608.1); answers the decisions that follow with `p`. */
function resolveTop(s0: GameState, p: Picks = {}): GameState {
  const top = s0.zones.stack.at(-1);
  let s = s0;
  for (let guard = 0; top !== undefined && s.zones.stack.includes(top) && guard < 10; guard++) s = settle(pass(s), p);
  return s;
}
function cast(s: GameState, name: string, p: Picks = {}, player = 'p1'): GameState {
  return settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), p);
}
const tokensOf = (s: GameState, player: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === player);
const tokenNames = (s: GameState, player: string): string[] => tokensOf(s, player).map((id) => getChars(s, id)!.name).sort();

// synthetic cards (invented wordings)
const BLAST = card('Test Blast', 'Instant', 'This spell deals 5 damage to target creature. You gain life equal to the excess damage dealt this way.');
const NUDGE = card('Test Nudge', 'Instant', 'This spell deals 1 damage to target creature.');
const SWEEP = card('Test Sweep', 'Sorcery', 'This spell deals 3 damage to each creature.');
const LASH = card('Test Lash', 'Sorcery', 'Target creature you control fights target creature an opponent controls. You gain life equal to the excess damage dealt to the creature an opponent controls this way.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OX = card('Test Ox', 'Creature — Ox', '', ['4', '4']);
const WURM = card('Test Wurm', 'Creature — Wurm', '', ['6', '6']);
const WALL = card('Test Wall', 'Creature — Wall', 'Indestructible', ['0', '4']);
const VIPER = card('Test Viper', 'Creature — Snake', 'Deathtouch', ['3', '1']);
const WARD = card('Test Ward', 'Creature — Spirit', 'Prevent all damage that would be dealt to this creature.', ['2', '2']);
const TRINKET = card('Test Trinket', 'Artifact', '', undefined, '{2}');
const DEFS = [BLAST, NUDGE, SWEEP, LASH, BEAR, OX, WURM, WALL, VIPER, WARD, TRINKET];
const MOUNTAINS = (n: number): string[] => Array(n).fill('Mountain') as string[];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 120.4a: the excess damage of a damage step ("the excess damage dealt this way")', () => {
  const board = (p2: string[], f?: (s: GameState) => void): GameState => {
    const s = scenario(['Mountain'], { p1: { hand: ['Test Blast'] }, p2: { battlefield: p2 }, defs: DEFS });
    return f ? tweak(s, f) : s;
  };
  it('5 damage to a 2/2 is 3 excess damage', () => {
    const s0 = board(['Test Bear']);
    const s = resolveAll(cast(s0, 'Test Blast', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p2'))]] }));
    expect(life(s, 'p1')).toBe(23);
  });
  it('damage already marked on the creature leaves less lethal room: a 4/4 with 2 damage marked takes 3 excess from 5', () => {
    const s0 = board(['Test Ox'], (s) => { s.objects[find(s, 'Test Ox', 'battlefield', 'p2')]!.damage = 2; });
    const s = resolveAll(cast(s0, 'Test Blast', { targets: [[obj(find(s0, 'Test Ox', 'battlefield', 'p2'))]] }));
    expect(life(s, 'p1')).toBe(23);
  });
  it('no excess when the damage is not more than lethal damage (a 6/6 dealt 5)', () => {
    const s0 = board(['Test Wurm']);
    const s = resolveAll(cast(s0, 'Test Blast', { targets: [[obj(find(s0, 'Test Wurm', 'battlefield', 'p2'))]] }));
    expect(life(s, 'p1')).toBe(20);
  });
  it('a creature with lethal damage already marked (indestructible, CR 702.12b) has no room: all of the damage is excess', () => {
    const s0 = board(['Test Wall'], (s) => { s.objects[find(s, 'Test Wall', 'battlefield', 'p2')]!.damage = 4; });
    const s = resolveAll(cast(s0, 'Test Blast', { targets: [[obj(find(s0, 'Test Wall', 'battlefield', 'p2'))]] }));
    expect(life(s, 'p1')).toBe(25);
  });
  it('CR 120.4b: damage that is prevented is not dealt, so none of it is excess', () => {
    const s0 = board(['Test Ward']);
    const s = resolveAll(cast(s0, 'Test Blast', { targets: [[obj(find(s0, 'Test Ward', 'battlefield', 'p2'))]] }));
    expect(s.zones.battlefield).toContain(find(s0, 'Test Ward', 'battlefield', 'p2'));
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 702.2c, 701.14: excess damage in a fight ("dealt to the creature an opponent controls this way")', () => {
  it('a 3-power deathtouch creature fighting a 4/4: 1 damage is lethal, 2 is excess', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Lash'], battlefield: ['Test Viper'] }, p2: { battlefield: ['Test Ox'] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Test Lash', { targets: [[obj(find(s0, 'Test Viper', 'battlefield', 'p1'))], [obj(find(s0, 'Test Ox', 'battlefield', 'p2'))]] }));
    expect(life(s, 'p1')).toBe(22);
    expect(s.zones.graveyard['p2']!.map((id) => s.objects[id]!.defId)).toContain('Test Ox'); // deathtouch (CR 704.5h)
  });
  it('only the damage to the creature an opponent controls counts: the 4/4 deals 3 excess to the 3/1 that is not read', () => {
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Lash'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ox'] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Test Lash', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p1'))], [obj(find(s0, 'Test Ox', 'battlefield', 'p2'))]] }));
    expect(life(s, 'p1')).toBe(20); // the Bear dealt 2 to the 4/4 (no excess); the Ox's 2 excess to the Bear is not "to the creature an opponent controls"
  });
});

describe('real cards', () => {
  it('Orbital Plunge: a Lander token only when excess damage was dealt', () => {
    const s0 = scenario(['Orbital Plunge', 'Mountain', 'Hill Giant'], { p1: { hand: ['Orbital Plunge', 'Orbital Plunge'], battlefield: MOUNTAINS(8) }, p2: { battlefield: ['Hill Giant', 'Test Wurm'] }, defs: DEFS });
    let s = resolveAll(cast(s0, 'Orbital Plunge', { targets: [[obj(find(s0, 'Test Wurm', 'battlefield', 'p2'))]] }));
    expect(tokensOf(s, 'p1')).toEqual([]); // 6 damage to a 6/6 is lethal damage, not more
    s = resolveAll(cast(s, 'Orbital Plunge', { targets: [[obj(find(s, 'Hill Giant', 'battlefield', 'p2'))]] }));
    expect(tokenNames(s, 'p1')).toEqual(['Lander Token']);
  });
  it('Goblin Negotiation: X = 5 to a 2/2 makes three 1/1 red Goblins', () => {
    const s0 = scenario(['Goblin Negotiation', 'Mountain'], { p1: { hand: ['Goblin Negotiation'], battlefield: MOUNTAINS(7) }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Goblin Negotiation', { x: 5, targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p2'))]] }));
    const goblins = tokensOf(s, 'p1');
    expect(goblins).toHaveLength(3);
    for (const id of goblins) expect([getChars(s, id)!.power, getChars(s, id)!.toughness, getChars(s, id)!.subtypes]).toEqual(['1', '1', ['Goblin']]);
  });
  it('Violent Echoes: 6 damage to a planeswalker with loyalty 3 is 3 excess (CR 120.4a): a Jace token with three loyalty counters', () => {
    const s0 = scenario(['Violent Echoes', 'Mountain', 'Liliana of the Veil'], { p1: { hand: ['Violent Echoes'], battlefield: MOUNTAINS(4) }, p2: { battlefield: [{ name: 'Liliana of the Veil', counters: { loyalty: 3 } }] }, defs: DEFS });
    const s = resolveAll(cast(s0, 'Violent Echoes', { targets: [[obj(find(s0, 'Liliana of the Veil', 'battlefield', 'p2'))]] }));
    const jace = tokensOf(s, 'p1');
    expect(jace).toHaveLength(1);
    expect(s.objects[jace[0]!]!.counters['loyalty']).toBe(3);
  });
  it("Rhino's Rampage: the reflexive trigger only when the fight dealt excess damage to the opponent's creature; its target is chosen then (CR 603.12a)", () => {
    const names = ["Rhino's Rampage", 'Mountain', 'Hill Giant', 'Llanowar Elves'];
    // Hill Giant (3/3, +1/+0) fights a 2/2: 2 excess damage, the reflexive trigger destroys the Trinket
    const a0 = scenario(names, { p1: { hand: ["Rhino's Rampage"], battlefield: ['Hill Giant', ...MOUNTAINS(1)] }, p2: { battlefield: ['Test Bear', 'Test Trinket'] }, defs: DEFS });
    let a = cast(a0, "Rhino's Rampage", { targets: [[obj(find(a0, 'Hill Giant', 'battlefield', 'p1'))], [obj(find(a0, 'Test Bear', 'battlefield', 'p2'))]] });
    a = resolveTop(a, { targets: [[obj(find(a0, 'Test Trinket', 'battlefield', 'p2'))]] });
    expect(a.zones.stack).toHaveLength(1); // the reflexive trigger, its target chosen as it was put on the stack
    expect(a.zones.battlefield).toContain(find(a0, 'Test Trinket', 'battlefield', 'p2'));
    a = resolveAll(a);
    expect(a.zones.battlefield).not.toContain(find(a0, 'Test Trinket', 'battlefield', 'p2'));
    // Llanowar Elves (1/1, +1/+0) fights a 4/4: no excess, no trigger
    const b0 = scenario(names, { p1: { hand: ["Rhino's Rampage"], battlefield: ['Llanowar Elves', ...MOUNTAINS(1)] }, p2: { battlefield: ['Test Ox', 'Test Trinket'] }, defs: DEFS });
    let b = cast(b0, "Rhino's Rampage", { targets: [[obj(find(b0, 'Llanowar Elves', 'battlefield', 'p1'))], [obj(find(b0, 'Test Ox', 'battlefield', 'p2'))]] });
    b = resolveTop(b);
    expect(b.zones.stack).toHaveLength(0);
    expect(b.zones.battlefield).toContain(find(b0, 'Test Trinket', 'battlefield', 'p2'));
  });
});

describe('CR 120.10, 603.2c: Magmatic Galleon ("one or more creatures your opponents control are dealt excess noncombat damage")', () => {
  const board = (hand: string[], p1: string[] = [], p2: string[] = ['Test Bear']): GameState =>
    scenario(['Magmatic Galleon', 'Mountain'], { p1: { hand, battlefield: ['Magmatic Galleon', ...p1] }, p2: { battlefield: p2 }, defs: DEFS });
  it('excess noncombat damage to a creature an opponent controls: one Treasure', () => {
    const s0 = board(['Test Blast']);
    let s = cast(s0, 'Test Blast', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p2'))]] });
    s = resolveTop(s);
    expect(s.zones.stack).toHaveLength(1); // the Galleon's trigger
    s = resolveAll(s);
    expect(tokenNames(s, 'p1')).toEqual(['Treasure Token']);
  });
  it('no excess (1 damage to a 2/2): no trigger', () => {
    const s0 = board(['Test Nudge']);
    const s = resolveAll(cast(s0, 'Test Nudge', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p2'))]] }));
    expect(tokensOf(s, 'p1')).toEqual([]);
  });
  it('excess damage to a creature you control: no trigger', () => {
    const s0 = board(['Test Blast'], ['Test Bear'], []);
    const s = resolveAll(cast(s0, 'Test Blast', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p1'))]] }));
    expect(tokensOf(s, 'p1')).toEqual([]);
  });
  it('one damage event that deals excess damage to two of their creatures triggers once (CR 603.2c)', () => {
    const s0 = board(['Test Sweep'], [], ['Test Bear', 'Test Bear']);
    const s = resolveAll(cast(s0, 'Test Sweep'));
    expect(findAll(s0, 'Test Bear', 'battlefield', 'p2')).toHaveLength(2);
    expect(tokenNames(s, 'p1')).toEqual(['Treasure Token']);
  });
});
