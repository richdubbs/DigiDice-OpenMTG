/**
 * std-rx16 (wave 2, slice s11): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings invented,
 * design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 601.2f, 208.1     "Each creature spell you cast with toughness greater than its power costs {1} less to cast": a 2/3 creature spell costs {1} less; a 2/2
 *                        or 3/2 one, a noncreature spell and an opponent's spell do not
 *   CR 508.1, 509.1      "Whenever a creature you control attacks or blocks, it gets +X/+X until end of turn, where X is the difference between its power and
 *                        toughness": the attacking (or blocking) creature itself gets the bonus, never another creature
 *   CR 608.2f, 611.2b    "For each of those cards, its owner may play it for as long as it remains exiled": the owner of each exiled card may play it; the
 *                        controller of the ability may not play an opponent's card
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type CardDef, type GameState, type ManaSymbol, type ObjectId } from '../../../src/index';
import { modifiedPlan } from '../../../src/actions/cast';
import { emptyPlan } from '../../../src/rules/cost';
import { advanceTo, find, scenario } from '../../m3/scenario';
import { attackWith, card, cast, full, pt, resolveAll } from '../cmd3/helpers';
import { runCombat } from '../../m4/helpers';

const manaText = (m: readonly ManaSymbol[]): string => m.map((x) => (x.kind === 'generic' ? `{${x.amount}}` : x.kind === 'colored' ? `{${x.color}}` : `{${x.kind}}`)).join('') || '{0}';
/** The total cost of casting `id` for `player` after the cost modifiers (CR 601.2f). */
function costOf(s: GameState, id: ObjectId, def: CardDef, player = 'p1'): string {
  const m = modifiedPlan(s, player, id, { ...emptyPlan(), mana: (def.faces[0]!.manaCost ?? []).filter((x) => x.kind !== 'variable') });
  return 'plan' in m ? manaText(m.plan.mana) : `denied: ${m.denial.message}`;
}

const ELDER = card('Test Elder', 'Creature — Treefolk', 'Each creature spell you cast with toughness greater than its power costs {1} less to cast.', ['0', '4']);
const WALL = card('Test Wall', 'Creature — Wall', '', ['1', '4'], '{2}{G}');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['2', '3'], '{1}{G}');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
const BRUTE = card('Test Brute', 'Creature — Ogre', '', ['3', '2'], '{1}{R}');
const STUDY = card('Test Study', 'Sorcery', 'You gain 3 life.', undefined, '{2}{G}');
const SAGE = card('Test Sage', 'Creature — Treefolk Druid', 'Whenever a creature you control attacks or blocks, it gets +X/+X until end of turn, where X is the difference between its power and toughness.', ['0', '3']);
const JOURNEY = card('Test Journey', 'Enchantment', 'When this enchantment enters, exile up to two target creatures. For each of those cards, its owner may play it for as long as it remains exiled.');
const DEFS = [ELDER, WALL, OGRE, BEAR, BRUTE, STUDY, SAGE, JOURNEY];

describe('the synthetic cards are automated', () => {
  it('every synthetic card with rules text plays fully', () => {
    for (const d of [ELDER, SAGE, JOURNEY]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 601.2f, 208.1: "Each creature spell you cast with toughness greater than its power costs {1} less to cast"', () => {
  it('a creature spell whose toughness is greater than its power costs {1} less; equal or greater power, or a noncreature spell, costs the same', () => {
    const s = scenario([], { p1: { hand: ['Test Wall', 'Test Ogre', 'Test Bear', 'Test Brute', 'Test Study'], battlefield: ['Test Elder'] }, defs: DEFS });
    expect(costOf(s, find(s, 'Test Wall', 'hand'), WALL)).toBe('{1}{G}');
    expect(costOf(s, find(s, 'Test Ogre', 'hand'), OGRE)).toBe('{G}');
    expect(costOf(s, find(s, 'Test Bear', 'hand'), BEAR)).toBe('{1}{G}');
    expect(costOf(s, find(s, 'Test Brute', 'hand'), BRUTE)).toBe('{1}{R}');
    expect(costOf(s, find(s, 'Test Study', 'hand'), STUDY)).toBe('{2}{G}');
  });
  it('only spells its controller casts: an opponent\'s 2/3 creature spell costs the same', () => {
    const s = scenario([], { p1: { battlefield: ['Test Elder'] }, p2: { hand: ['Test Ogre'] }, defs: DEFS });
    expect(costOf(s, find(s, 'Test Ogre', 'hand', 'p2'), OGRE, 'p2')).toBe('{1}{G}');
  });
});

describe('CR 508.1, 509.1: "Whenever a creature you control attacks or blocks, it gets +X/+X ..., where X is the difference between its power and toughness"', () => {
  it('the attacking 1/4 creature gets +3/+3; the 2/2 that did not attack gets nothing', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Sage', 'Test Wall', 'Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const wall = find(s, 'Test Wall', 'battlefield');
    s = resolveAll(attackWith(s, [wall]));
    expect(pt(s, wall)).toBe('4/7');
    expect(pt(s, find(s, 'Test Bear', 'battlefield'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Sage', 'battlefield'))).toBe('0/3');
  });
  it('a creature with equal power and toughness gets +0/+0 (the difference is 0, never negative)', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Sage', 'Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const bear = find(s, 'Test Bear', 'battlefield');
    s = resolveAll(attackWith(s, [bear]));
    expect(pt(s, bear)).toBe('2/2');
  });
  it('a 3/2 attacker gets +1/+1 (power greater than toughness: the larger minus the smaller)', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Sage', 'Test Brute'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const brute = find(s, 'Test Brute', 'battlefield');
    s = resolveAll(attackWith(s, [brute]));
    expect(pt(s, brute)).toBe('4/3');
  });
  it('the blocking creature gets the bonus, not the attacker it blocks (an opponent\'s creature)', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Sage', 'Test Wall'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    s = advanceTo(s, 4, 'main1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    const wall = find(s, 'Test Wall', 'battlefield', 'p1');
    s = runCombat(s, { attack: [[ogre]], block: [[wall, ogre]], until: 'declareBlockers' });
    s = resolveAll(s);
    expect(pt(s, wall)).toBe('4/7');
    expect(pt(s, ogre)).toBe('2/3');
  });
});

describe('CR 608.2f, 611.2b, 400.7: "For each of those cards, its owner may play it for as long as it remains exiled"', () => {
  const castFromExile = (s: GameState, player: string): string[] =>
    legalActions(s, player).filter((a) => a.kind === 'cast' && s.objects[a.object!]?.zone === 'exile').map((a) => s.objects[a.object!]!.defId);
  const exiled = (): GameState => {
    const s0 = scenario(['Plains', 'Forest'], { p1: { hand: ['Test Journey'], battlefield: ['Test Bear', 'Forest', 'Forest'] }, p2: { battlefield: ['Test Ogre', 'Forest', 'Forest'] }, defs: DEFS });
    const s = advanceTo(s0, 1, 'main1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    return resolveAll(cast(s, 'Test Journey'), { targets: [{ kind: 'object', id: bear }, { kind: 'object', id: ogre }] });
  };
  it('both creatures are exiled; the controller of the ability may cast its own card from exile, never the opponent\'s', () => {
    const s = exiled();
    expect(s.zones.exile.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Bear', 'Test Ogre']);
    expect(castFromExile(s, 'p1')).toEqual(['Test Bear']);
  });
  it('on the opponent\'s turn, the opponent may cast the card it owns from exile, and only that one', () => {
    const s = advanceTo(exiled(), 2, 'main1');
    expect(castFromExile(s, 'p2')).toEqual(['Test Ogre']);
  });
});
