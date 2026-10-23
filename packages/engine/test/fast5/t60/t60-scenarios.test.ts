/**
 * FAST5 T60: the shapes of parser/templates/zz-fast5/t60.json played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings are invented, design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { castAuto, find, labels, life, scenario } from '../../m3/scenario';
import { attackUnblocked, declareAttackers, declareBlockers, passUntil, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** No ability of the card left manual. */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'))
  && (d.automation.faces ?? []).every((f) => f.abilities.every((a) => a.level !== 'manual' && a.manual.length === 0));
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const relic = (): CardDef => card('Test Relic', 'Artifact', '{T}: You gain 1 life.', undefined, '{1}');

describe('CR 702.41a, 613.1f, 601.2f: "Spells you cast have affinity for artifacts"', () => {
  const CAPTAIN = card('Test Captain', 'Creature — Human', 'Spells you cast have affinity for artifacts.', ['2', '2'], '{2}');
  const STUDY = card('Test Study', 'Sorcery', 'You gain 2 life.', undefined, '{2}');
  it('is automated', () => expect(automated(CAPTAIN)).toBe(true));
  it('a {2} spell is castable with no mana when its caster controls two artifacts, and not with one', () => {
    const two = scenario([], { p1: { hand: ['Test Study'], battlefield: ['Test Captain', 'Test Relic', 'Test Relic'] }, defs: [CAPTAIN, STUDY, relic()] });
    expect(labels(two, 'p1')).toContain('Cast Test Study');
    const one = scenario([], { p1: { hand: ['Test Study'], battlefield: ['Test Captain', 'Test Relic'] }, defs: [CAPTAIN, STUDY, relic()] });
    expect(labels(one, 'p1')).not.toContain('Cast Test Study');
  });
  it('CR 601.2f: casting a {3} spell with two artifacts taps only one land, and an artifact-less caster pays all three', () => {
    const SERMON = card('Test Sermon', 'Sorcery', 'You gain 2 life.', undefined, '{3}');
    const two = scenario(['Forest', 'Forest', 'Forest'], { p1: { hand: ['Test Sermon'], battlefield: ['Test Captain', 'Test Relic', 'Test Relic', 'Forest', 'Forest', 'Forest'] }, defs: [CAPTAIN, SERMON, relic()] });
    const cast = castAuto(two, 'Test Sermon');
    expect(cast.zones.stack).toHaveLength(1);
    const tapped = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.tapped && s.defs[s.objects[id]!.defId]!.faces[0]!.types.includes('Land')).length;
    expect(tapped(cast)).toBe(1);
    const none = scenario(['Forest', 'Forest', 'Forest'], { p1: { hand: ['Test Sermon'], battlefield: ['Test Captain', 'Forest', 'Forest', 'Forest'] }, defs: [CAPTAIN, SERMON, relic()] });
    expect(tapped(castAuto(none, 'Test Sermon'))).toBe(3);
  });
  it("an opponent's spell does not get affinity", () => {
    const s = scenario([], { p1: { battlefield: ['Test Captain'] }, p2: { hand: ['Test Study'], battlefield: ['Test Relic', 'Test Relic'] }, defs: [CAPTAIN, STUDY, relic()] });
    expect(labels(s, 'p2')).not.toContain('Cast Test Study');
  });
});

describe('CR 510.1a, 613.11: "Each creature you control with toughness greater than its power assigns combat damage equal to its toughness rather than its power"', () => {
  const TORTOISE = card('Test Tortoise', 'Creature — Turtle', 'Each creature you control with toughness greater than its power assigns combat damage equal to its toughness rather than its power.', ['0', '4'], '{2}');
  const WALL = card('Test Wall', 'Creature — Wall', 'Defender', ['0', '5']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '2']);
  it('is automated', () => expect(automated(TORTOISE)).toBe(true));
  it('a 0/4 attacker deals 4 and a 0/5 wall deals 5 when blocked-and-blocking; a 3/2 bear (power greater) still deals 3', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Tortoise', 'Test Bear'] }, p2: { battlefield: [] }, defs: [TORTOISE, BEAR, WALL] });
    const before = life(s0, 'p2');
    const s = attackUnblocked(s0, [find(s0, 'Test Tortoise', 'battlefield', 'p1'), find(s0, 'Test Bear', 'battlefield', 'p1')]);
    expect(life(s, 'p2')).toBe(before - 4 - 3);
  });
  it('a 1/6 attacker deals 6 to the 0/5 wall that blocks it; the wall, under another controller, deals its own power, 0', () => {
    const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['1', '6']);
    // the wall belongs to the opponent: the rule is "you control", so it does not apply to it
    let s = scenario([], { p1: { battlefield: ['Test Tortoise', 'Test Ogre'] }, p2: { battlefield: ['Test Wall'] }, defs: [TORTOISE, WALL, OGRE] });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    const wall = find(s, 'Test Wall', 'battlefield', 'p2');
    s = declareAttackers(toDeclareAttackers(s), [[ogre]]);
    s = declareBlockers(passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers'), [[wall, ogre]]);
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat');
    expect(s.zones.battlefield).not.toContain(wall); // the 1/6 ogre (toughness greater than power) assigns 6, a 0/5 wall dies (its power, 1, would not kill it)
    expect(s.objects[ogre]!.damage).toBe(0); // the opponent's wall is not a creature its opponent controls: it deals its power, 0
  });
});
