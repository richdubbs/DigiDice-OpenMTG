/**
 * FAST1 T5: the static and continuous shapes of parser/templates/zz-fast1/t5.json played through the engine with synthetic cards compiled by the game's
 * default compiler (wordings are invented, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 611.3a, 500.1   "During your turn, ~ has first strike" is "as long as it's your turn"
 *   CR 613.4c, 509.1b  "~ gets +2/+2 and can't block"; "All creatures get -1/-1" reaches every player's creatures
 *   CR 602.5           "can't attack or block, and its activated abilities can't be activated" (Arrest-style)
 *   CR 502.3, 602.5    "doesn't untap during its controller's untap step and its activated abilities can't be activated"
 *   CR 508.1d          "All creatures attack each combat if able" is a requirement of every player's creatures
 *   CR 509.1b          "can't be blocked except by Walls" is "can't be blocked by non-Wall creatures"
 *   CR 614.1c-d        "enters tapped unless your opponents control eight or more lands", "unless you have two or more opponents",
 *                      "unless you control two or fewer other lands",
 *                      "enters tapped with two charge counters on it"
 *   CR 601.2f, 604.5   "This spell costs {2} less to cast if you control a Wizard": castCheck and the cast agree (statics/costmods.ts reads the condition)
 *   CR 205.2a, 611.3a  "as long as there are four or more card types among cards in your graveyard"
 *   CR 702.85a         "This spell has cascade as long as ..." functions on the stack: never automated by a static that runs on the battlefield
 */
import { describe, expect, it } from 'vitest';
import { compileCard, requirementsFor, type CardDef, type GameState, type ManaSymbol, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { ruleDenial } from '../../../src/statics/hooks';
import { modifiedPlan } from '../../../src/actions/cast';
import { emptyPlan } from '../../../src/rules/cost';
import { act, advanceTo, castAuto, find, legal, put, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const level = (d: CardDef): string => d.automation.level;
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const text = (m: readonly ManaSymbol[]): string => m.map((x) => (x.kind === 'generic' ? `{${x.amount}}` : x.kind === 'colored' ? `{${x.color}}` : `{${x.kind}}`)).join('') || '{0}';

const BEARS = card('Test Bears', 'Creature — Bear', '', ['2', '2']);
const WALL = card('Test Wall', 'Creature — Wall', 'Defender', ['0', '4']);
const WIZARD = card('Test Wizard', 'Creature — Human Wizard', '', ['1', '1']);

describe('CR 611.3a, 500.1: "During your turn, ..."', () => {
  const KNIGHT = card('Test Turn Knight', 'Creature — Knight', 'During your turn, this creature has first strike.', ['2', '2']);
  const SQUIRE = card('Test Turn Squire', 'Creature — Human', 'During your turn, this creature gets +2/+0.', ['1', '1']);

  it('CR 611.3a: the compiled cards are fully automated (sta.duringturn.grant, sta.duringturn.pump)', () => {
    expect(level(KNIGHT)).toBe('full');
    expect(level(SQUIRE)).toBe('full');
  });

  it('CR 611.3a, 500.1: first strike and +2/+0 while it is its controller\'s turn, not during the opponent\'s turn', () => {
    const s = scenario([], { p1: { battlefield: ['Test Turn Knight', 'Test Turn Squire'] }, defs: [KNIGHT, SQUIRE] });
    const knight = find(s, 'Test Turn Knight', 'battlefield');
    const squire = find(s, 'Test Turn Squire', 'battlefield');
    expect(s.turn.activePlayer).toBe('p1');
    expect(hasKeyword(getChars(s, knight)!, 'first strike')).toBe(true);
    expect(pt(s, squire)).toBe('3/1');
    const theirs = tweak(s, (t) => { t.turn.activePlayer = 'p2'; });
    expect(hasKeyword(getChars(theirs, knight)!, 'first strike')).toBe(false);
    expect(pt(theirs, squire)).toBe('1/1');
  });
});

describe('CR 613.4c, 509.1b: a P/T change and a restriction in one sentence; "All creatures"', () => {
  const BRUTE = card('Test Brute', 'Creature — Ogre', "This creature gets +2/+2 and can't block.", ['1', '1']);
  const BLIGHT = card('Test Blight', 'Enchantment', 'All creatures get -1/-1.');

  it('CR 613.4c, 509.1b: "~ gets +2/+2 and can\'t block" is both effects; "All creatures get -1/-1" affects both players\' creatures', () => {
    expect(level(BRUTE)).toBe('full');
    expect(level(BLIGHT)).toBe('full');
    const s = scenario([], { p1: { battlefield: ['Test Brute', 'Test Blight'] }, p2: { battlefield: ['Test Bears'] }, defs: [BRUTE, BLIGHT, BEARS] });
    const brute = find(s, 'Test Brute', 'battlefield');
    expect(pt(s, brute)).toBe('2/2'); // 1/1 +2/+2 -1/-1
    expect(pt(s, find(s, 'Test Bears', 'battlefield', 'p2'))).toBe('1/1');
    expect(ruleDenial(s, { action: 'block', subject: brute })).not.toBeNull();
    expect(ruleDenial(s, { action: 'attack', subject: brute })).toBeNull();
  });
});

describe('CR 602.5, 502.3: Arrest-style bans on the enchanted permanent', () => {
  const ARREST = card('Test Arrest', 'Enchantment — Aura', "Enchant creature\nEnchanted creature can't attack or block, and its activated abilities can't be activated.");
  const FREEZE = card('Test Freeze', 'Enchantment — Aura', "Enchant land\nEnchanted land doesn't untap during its controller's untap step and its activated abilities can't be activated.");
  const PINGER = card('Test Pinger', 'Creature — Human', '{T}: Draw a card.', ['1', '1']);

  it('CR 602.5, 508.1c, 509.1b: the enchanted creature can\'t attack, block or activate; another creature can', () => {
    expect(level(ARREST)).toBe('full');
    const s0 = scenario([], { p1: { battlefield: ['Test Pinger', 'Test Bears'] }, defs: [ARREST, PINGER, BEARS] });
    const pinger = find(s0, 'Test Pinger', 'battlefield');
    // an Aura put onto the battlefield by the test, attached at once (a lone Aura would be put into the graveyard, CR 704.5m)
    const s = tweak(s0, (t) => { t.objects[put(t, 'p1', 'battlefield', 'Test Arrest')]!.attachedTo = pinger; });
    expect(ruleDenial(s, { action: 'attack', subject: pinger })).not.toBeNull();
    expect(ruleDenial(s, { action: 'block', subject: pinger })).not.toBeNull();
    expect(ruleDenial(s, { action: 'activate', subject: pinger, other: pinger })).not.toBeNull();
    expect(legal(s, 'p1', 'activate').filter((a) => a.label.includes('Test Pinger'))).toEqual([]);
    expect(ruleDenial(s, { action: 'attack', subject: find(s, 'Test Bears', 'battlefield') })).toBeNull();
  });

  it('CR 502.3, 602.5: the enchanted land doesn\'t untap in the untap step and its mana ability can\'t be activated', () => {
    expect(level(FREEZE)).toBe('full');
    const s0 = scenario(['Forest'], { p1: { battlefield: ['Forest'] }, defs: [FREEZE] });
    const forest = find(s0, 'Forest', 'battlefield');
    const s = tweak(s0, (t) => { t.objects[put(t, 'p1', 'battlefield', 'Test Freeze')]!.attachedTo = forest; });
    expect(ruleDenial(s, { action: 'untapDuringUntapStep', subject: forest })).not.toBeNull();
    expect(ruleDenial(s, { action: 'activate', subject: forest, other: forest })).not.toBeNull();
  });
});

describe('CR 508.1d: "All creatures attack each combat if able"', () => {
  const MELEE = card('Test Melee', 'Enchantment', 'All creatures attack each combat if able.');

  it('CR 508.1d: the active player\'s creature carries the requirement and declaring no attackers is refused', () => {
    expect(level(MELEE)).toBe('full');
    const s = scenario([], { p1: { battlefield: ['Test Melee', 'Test Bears'] }, p2: { battlefield: ['Test Bears'] }, defs: [MELEE, BEARS] });
    expect(requirementsFor(s, 'attack', 'p1').map((r) => r.creature)).toEqual([find(s, 'Test Bears', 'battlefield', 'p1')]);
    // passing through the declare attackers step without attacking breaks it (the opponent's creature is in the same set: the filter names no controller)
    expect(() => advanceTo(s, 2, 'main1')).toThrow(/CR 508\.1d/);
  });
});

describe('CR 509.1b: "can\'t be blocked except by Walls"', () => {
  const SNEAK = card('Test Sneak', 'Creature — Rogue', "This creature can't be blocked except by Walls.", ['2', '1']);

  it('CR 509.1b: a Wall may block it, any other creature may not', () => {
    expect(level(SNEAK)).toBe('full');
    const s = scenario([], { p1: { battlefield: ['Test Sneak'] }, p2: { battlefield: ['Test Wall', 'Test Bears'] }, defs: [SNEAK, WALL, BEARS] });
    const sneak = find(s, 'Test Sneak', 'battlefield');
    expect(ruleDenial(s, { action: 'beBlockedBy', subject: sneak, other: find(s, 'Test Wall', 'battlefield', 'p2') })).toBeNull();
    expect(ruleDenial(s, { action: 'beBlockedBy', subject: sneak, other: find(s, 'Test Bears', 'battlefield', 'p2') })).not.toBeNull();
  });
});

describe('CR 614.1c-d, 614.12: "enters tapped unless ..." and "enters tapped with ..."', () => {
  const TURBULENT = card('Test Turbulent Flat', 'Land', 'This land enters tapped unless your opponents control eight or more lands.\n{T}: Add {G}.');
  const PARTY = card('Test Party Flat', 'Land', 'This land enters tapped unless you have two or more opponents.\n{T}: Add {G}.');
  const CHARGED = card('Test Charged Flat', 'Land', 'This land enters tapped with two charge counters on it.\n{T}: Add {G}.');
  const play = (s: GameState, name: string): GameState => act(s, { type: 'playLand', player: 'p1', card: find(s, name, 'hand') });

  it('CR 614.1d: untapped when the opponents control eight lands, tapped with seven', () => {
    expect(level(TURBULENT)).toBe('full');
    const forests = (n: number): string[] => Array(n).fill('Forest') as string[];
    const eight = play(scenario(['Forest'], { p1: { hand: ['Test Turbulent Flat'] }, p2: { battlefield: forests(8) }, defs: [TURBULENT] }), 'Test Turbulent Flat');
    expect(eight.objects[find(eight, 'Test Turbulent Flat', 'battlefield')]!.tapped).toBe(false);
    const seven = play(scenario(['Forest'], { p1: { hand: ['Test Turbulent Flat'] }, p2: { battlefield: forests(7) }, defs: [TURBULENT] }), 'Test Turbulent Flat');
    expect(seven.objects[find(seven, 'Test Turbulent Flat', 'battlefield')]!.tapped).toBe(true);
  });

  it('CR 614.1d: "unless you control two or fewer other lands" (render family comparison) counts the lands already there, not itself', () => {
    const FAST = card('Test Fast Flat', 'Land', 'This land enters tapped unless you control two or fewer other lands.\n{T}: Add {G}.');
    expect(level(FAST)).toBe('full');
    const two = play(scenario(['Forest'], { p1: { hand: ['Test Fast Flat'], battlefield: ['Forest', 'Forest'] }, defs: [FAST] }), 'Test Fast Flat');
    expect(two.objects[find(two, 'Test Fast Flat', 'battlefield')]!.tapped).toBe(false);
    const three = play(scenario(['Forest'], { p1: { hand: ['Test Fast Flat'], battlefield: ['Forest', 'Forest', 'Forest'] }, defs: [FAST] }), 'Test Fast Flat');
    expect(three.objects[find(three, 'Test Fast Flat', 'battlefield')]!.tapped).toBe(true);
  });

  it('CR 614.1d, 102.3: a two-player game has one opponent, so it enters tapped', () => {
    expect(level(PARTY)).toBe('full');
    const s = play(scenario([], { p1: { hand: ['Test Party Flat'] }, defs: [PARTY] }), 'Test Party Flat');
    expect(s.objects[find(s, 'Test Party Flat', 'battlefield')]!.tapped).toBe(true);
  });

  it('CR 614.1c-d, 122.6: it enters tapped with the two counters', () => {
    expect(level(CHARGED)).toBe('full');
    const s = play(scenario([], { p1: { hand: ['Test Charged Flat'] }, defs: [CHARGED] }), 'Test Charged Flat');
    const o = s.objects[find(s, 'Test Charged Flat', 'battlefield')]!;
    expect(o.tapped).toBe(true);
    expect(o.counters.charge).toBe(2);
  });
});

describe('CR 601.2f, 604.5: "This spell costs {2} less to cast if you control a Wizard"', () => {
  const BOLT = card('Test Wizard Bolt', 'Instant', 'This spell costs {2} less to cast if you control a Wizard.\nTest Wizard Bolt deals 3 damage to any target.', undefined, '{2}{R}');
  const costOf = (s: GameState): string => {
    const id = find(s, 'Test Wizard Bolt', 'hand');
    const m = modifiedPlan(s, 'p1', id, { ...emptyPlan(), mana: (BOLT.faces[0]!.manaCost ?? []).filter((x) => x.kind !== 'variable') });
    return 'plan' in m ? text(m.plan.mana) : `denied: ${m.denial.message}`;
  };

  it('CR 601.2f: the reduction applies only while the caster controls a Wizard', () => {
    expect(level(BOLT)).toBe('full');
    expect(costOf(scenario([], { p1: { hand: ['Test Wizard Bolt'], battlefield: ['Test Wizard'] }, defs: [BOLT, WIZARD] }))).toBe('{R}');
    expect(costOf(scenario([], { p1: { hand: ['Test Wizard Bolt'], battlefield: ['Test Bears'] }, defs: [BOLT, BEARS] }))).toBe('{2}{R}');
    // the opponent's Wizard is not "you control"
    expect(costOf(scenario([], { p1: { hand: ['Test Wizard Bolt'] }, p2: { battlefield: ['Test Wizard'] }, defs: [BOLT, WIZARD] }))).toBe('{2}{R}');
  });

  it('CR 601.2f, 604.5: castCheck (the card in hand) and the cast (the spell on the stack) agree: one Mountain casts it with a Wizard, not without', () => {
    const MOUNTAIN = card('Test Mountain', 'Basic Land — Mountain', '({T}: Add {R}.)');
    const withWizard = scenario([], { p1: { hand: ['Test Wizard Bolt'], battlefield: ['Test Wizard', 'Test Mountain'] }, defs: [BOLT, WIZARD, MOUNTAIN] });
    expect(legal(withWizard, 'p1', 'cast').map((a) => a.label)).toContain('Cast Test Wizard Bolt');
    const cast = castAuto(withWizard, 'Test Wizard Bolt', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }] });
    expect(cast.zones.stack.length).toBe(1);
    expect(cast.objects[find(cast, 'Test Mountain', 'battlefield')]!.tapped).toBe(true);
    const without = scenario([], { p1: { hand: ['Test Wizard Bolt'], battlefield: ['Test Bears', 'Test Mountain'] }, defs: [BOLT, BEARS, MOUNTAIN] });
    expect(legal(without, 'p1', 'cast').map((a) => a.label)).not.toContain('Cast Test Wizard Bolt');
  });
});

describe('CR 205.2a, 611.3a: "as long as there are four or more card types among cards in your graveyard"', () => {
  const GHOUL = card('Test Delirium Ghoul', 'Creature — Zombie', 'This creature gets +2/+2 as long as there are four or more card types among cards in your graveyard.', ['1', '1']);
  const SORC = card('Test Sorcery', 'Sorcery', 'Draw a card.');
  const ART = card('Test Trinket', 'Artifact', '');

  it('CR 205.2a: land, creature, sorcery and artifact in the graveyard turn it on; three types do not', () => {
    expect(level(GHOUL)).toBe('full');
    const s3 = scenario(['Forest'], { p1: { battlefield: ['Test Delirium Ghoul'], graveyard: ['Forest', 'Test Bears', 'Test Sorcery'] }, defs: [GHOUL, BEARS, SORC, ART] });
    expect(pt(s3, find(s3, 'Test Delirium Ghoul', 'battlefield'))).toBe('1/1');
    const s4 = tweak(s3, (t) => { put(t, 'p1', 'graveyard', 'Test Trinket'); });
    expect(pt(s4, find(s4, 'Test Delirium Ghoul', 'battlefield'))).toBe('3/3');
  });
});

describe('CR 702.85a, 113.6: a static of ~ granting ~ a keyword of casting is never automated', () => {
  it('CR 702.85a: "This spell has cascade as long as ..." stays manual (it would be dead on the battlefield); "This creature has trample as long as ..." is full', () => {
    const CASCADER = card('Test Cascader', 'Creature — Ogre', 'This spell has cascade as long as there are four or more card types among cards in your graveyard.', ['3', '3'], '{3}{R}');
    expect(level(CASCADER)).not.toBe('full');
    expect(CASCADER.faces[0]!.abilities.some((a) => a.kind === 'manual')).toBe(true);
    const STOMPER = card('Test Stomper', 'Creature — Ogre', 'This creature has trample as long as there are four or more card types among cards in your graveyard.', ['3', '3'], '{3}{R}');
    expect(level(STOMPER)).toBe('full');
  });
});
