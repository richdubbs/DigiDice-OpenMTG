/**
 * FAST3 T16: the combat and targeting restrictions of parser/templates/zz-fast3/t16.json and the engine support they needed, played through the engine with
 * synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 506.2, 508.1c   "~ can't attack unless defending player controls an Island": judged once per possible defender with THAT attack's defending player
 *                      (statics/hooks.ts#canAttack sets EvalCx.defending), so your own Island never counts and a multiplayer game asks each opponent
 *   CR 508.1c, 509.1b  "~ can't attack or block unless you control another Giant" / "unless you have the city's blessing" (CR 702.131c)
 *   CR 701.19c         "Target creature can't be regenerated this turn": the shield is not applied to the destruction
 *   CR 611.2a          "Target creature can't attack or block this turn": until the end of the turn only
 *   CR 115.1, 113.7a   "can't be the target of black spells or abilities from black sources": the spell's color, or the color of the ability's source
 *   CR 509.1b          "can't be blocked this turn except by creatures with flying"; "can't be blocked by creatures with greater power"
 *   CR 611.2c          "Creatures without defender can't block ~ this turn" also binds a creature that enters after it resolved (a rule effect, not a
 *                      characteristic change)
 *   CR 509.1b          "Black creatures can't attack or block"; "White creatures and blue creatures can't block"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { ruleDenial } from '../../../src/statics/hooks';
import { attackCandidates } from '../../../src/rules/combat-rules';
import { gameOf, hookpoints } from '../../../src/rules/hookpoints';
import { act, advanceTo, answer, find, passBoth, put, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated, and the card full (the template is stable). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
/** Every ability automated (an experimental template caps the card at partial, design 6.9). */
const automatedCard = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

function cast(s0: GameState, name: string, targets: TargetChoice[] = []): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}
function activate(s0: GameState, source: ObjectId, targets: TargetChoice[] = [], ability = 'p:0:0'): GameState {
  let s = act(s0, { type: 'activate', player: 'p1', source, ability });
  while (s.pending && s.pending.kind !== 'priority') {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}
const obj = (id: string): TargetChoice => ({ kind: 'object', id });
const attackers = (s: GameState): Record<string, string[]> => Object.fromEntries(attackCandidates(s, 'p1').map((c) => [s.defs[s.objects[c.id]!.defId]!.name, c.defenders.map(String)]));

const BEARS = card('Test Bears', 'Creature — Bear', '', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
const ISLE = card('Test Isle', 'Land — Island', '');
const SERPENT = card('Test Serpent', 'Creature — Serpent', "Test Serpent can't attack unless defending player controls an Island.", ['5', '5']);
const WALKER = card('Test Walker', 'Legendary Planeswalker — Test', '+1: You gain 1 life.');

describe('CR 506.2, 508.1c: "~ can\'t attack unless defending player controls an Island"', () => {
  const defs = [SERPENT, ISLE, BEARS, WALKER];
  it('is automated and full (rst.t16.cantattack.unless.defending.controls is stable)', () => {
    expect(full(SERPENT)).toBe(true);
  });
  it('the defending player\'s Island counts; the attacker\'s own Island never does', () => {
    let s = scenario([], { p1: { battlefield: ['Test Serpent', 'Test Bears', 'Test Isle'] }, defs });
    expect(attackers(s)).toEqual({ 'Test Bears': ['p2'] });
    put(s, 'p2', 'battlefield', 'Test Isle');
    s = { ...s };
    expect(attackers(s)).toEqual({ 'Test Serpent': ['p2'], 'Test Bears': ['p2'] });
  });
  it('a planeswalker is attacked with its controller as the defending player (CR 506.2): the same Island decides', () => {
    let s = scenario([], { p1: { battlefield: ['Test Serpent'] }, p2: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } }] }, defs });
    const walker = find(s, 'Test Walker', 'battlefield');
    expect(attackers(s)).toEqual({});
    put(s, 'p2', 'battlefield', 'Test Isle');
    s = { ...s };
    expect(attackers(s)).toEqual({ 'Test Serpent': ['p2', walker] });
  });
  it('each possible defender is asked with its own defending player (the multiplayer rule): only the player who controls an Island can be attacked', () => {
    // Two-player scenario, but the hook is asked as attackOptions asks it in a game with several opponents: once per defender
    const s = scenario([], { p1: { battlefield: ['Test Serpent', 'Test Isle'] }, defs });
    const serpent = find(s, 'Test Serpent', 'battlefield');
    expect(hookpoints.canAttack(gameOf(s), serpent, 'p2')).not.toBeNull();
    expect(hookpoints.canAttack(gameOf(s), serpent, 'p1')).toBeNull(); // p1 controls an Island: an attack on p1 would be allowed
    expect(ruleDenial(s, { action: 'attack', subject: serpent, other: 'p2' })).not.toBeNull(); // asked without a defending player: applied (fail closed)
  });
});

describe('CR 508.1c, 509.1b: "~ can\'t attack or block unless ..."', () => {
  const GIANT = card('Test Giant', 'Creature — Giant', "Test Giant can't attack or block unless you control another Giant.", ['4', '4']);
  const OTHER_GIANT = card('Test Hill Giant', 'Creature — Giant', '', ['3', '3']);
  const TOOTH = card('Test Swordtooth', 'Creature — Dinosaur', "Test Swordtooth can't attack or block unless you have the city's blessing.", ['5', '5']);
  it('both cards are automated and full (rst.t16.cantattackblock.unless is stable)', () => {
    expect(full(GIANT)).toBe(true);
    expect(full(TOOTH)).toBe(true);
  });
  it('"unless you control another Giant": neither attack nor block alone; both with another Giant (an opponent\'s Giant does not count)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Giant'] }, p2: { battlefield: ['Test Hill Giant', 'Test Bears'] }, defs: [GIANT, OTHER_GIANT, BEARS] });
    const giant = find(s, 'Test Giant', 'battlefield');
    const bears = find(s, 'Test Bears', 'battlefield');
    expect(attackers(s)).toEqual({});
    expect(ruleDenial(s, { action: 'block', subject: giant, other: bears })).not.toBeNull();
    put(s, 'p1', 'battlefield', 'Test Hill Giant');
    s = { ...s };
    expect(attackers(s)).toEqual({ 'Test Giant': ['p2'], 'Test Hill Giant': ['p2'] });
    expect(ruleDenial(s, { action: 'block', subject: giant, other: bears })).toBeNull();
  });
  it('CR 702.131c: "unless you have the city\'s blessing" reads the designation (yours, not an opponent\'s)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Swordtooth'] }, defs: [TOOTH] });
    expect(attackers(s)).toEqual({});
    s = tweak(s, (t) => { t.designations.citysBlessing = ['p2']; });
    expect(attackers(s)).toEqual({});
    s = tweak(s, (t) => { t.designations.citysBlessing = ['p1']; });
    expect(attackers(s)).toEqual({ 'Test Swordtooth': ['p2'] });
  });
});

describe('CR 701.19c, 611.2a: "Target creature can\'t be regenerated this turn"', () => {
  const UNMEND = card('Test Unmending', 'Instant', "Target creature can't be regenerated this turn.");
  const TROLL = card('Test Troll', 'Creature — Troll', '{0}: Regenerate Test Troll.', ['2', '2']);
  const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
  const defs = [UNMEND, TROLL, DOOM];
  it('is automated and full (eff.t16.cantberegenerated is stable)', () => {
    expect(full(UNMEND)).toBe(true);
    expect(full(TROLL)).toBe(true);
  });
  it('a regeneration shield saves the creature; after "can\'t be regenerated" the same shield does not', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Troll'], hand: ['Test Doom', 'Test Doom', 'Test Unmending'] }, defs });
    const troll = find(s0, 'Test Troll', 'battlefield');
    let s = passBoth(activate(s0, troll));
    s = passBoth(cast(s, 'Test Doom', [obj(troll)]));
    expect(s.objects[troll]?.zone).toBe('battlefield'); // regenerated (CR 701.19a)
    s = passBoth(activate(s, troll));
    s = passBoth(cast(s, 'Test Unmending', [obj(troll)]));
    expect(ruleDenial(s, { action: 'beRegenerated', subject: troll })).not.toBeNull();
    s = passBoth(cast(s, 'Test Doom', [obj(troll)]));
    expect(s.objects[troll]?.zone ?? 'gone').not.toBe('battlefield');
  });
  it('the effect ends with the turn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Unmending'] }, p2: { battlefield: ['Test Troll'] }, defs });
    const troll = find(s0, 'Test Troll', 'battlefield');
    let s = passBoth(cast(s0, 'Test Unmending', [obj(troll)]));
    expect(ruleDenial(s, { action: 'beRegenerated', subject: troll })).not.toBeNull();
    s = advanceTo(s, 2, 'main1');
    expect(ruleDenial(s, { action: 'beRegenerated', subject: troll })).toBeNull();
  });
});

describe('CR 508.1c, 509.1b, 611.2a: "Target creature can\'t attack or block this turn"', () => {
  const STUN = card('Test Stun', 'Instant', "Target creature can't attack or block this turn.");
  it('is automated and full (eff.t16.cantattackblock is stable)', () => {
    expect(full(STUN)).toBe(true);
  });
  it('the creature can neither attack nor block this turn, and can again on the next turn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Stun'], battlefield: ['Test Ogre', 'Test Bears'] }, defs: [STUN, OGRE, BEARS] });
    const ogre = find(s0, 'Test Ogre', 'battlefield');
    const bears = find(s0, 'Test Bears', 'battlefield');
    let s = passBoth(cast(s0, 'Test Stun', [obj(ogre)]));
    expect(attackers(s)).toEqual({ 'Test Bears': ['p2'] });
    expect(ruleDenial(s, { action: 'block', subject: ogre, other: bears })).not.toBeNull();
    s = advanceTo(s, 2, 'main1');
    expect(ruleDenial(s, { action: 'block', subject: ogre, other: bears })).toBeNull();
    expect(ruleDenial(s, { action: 'attack', subject: ogre, other: 'p2' })).toBeNull();
  });
});

describe('CR 115.1, 113.7a: "~ can\'t be the target of black spells or abilities from black sources"', () => {
  const INFORMER = card('Test Informer', 'Creature — Human', "Test Informer can't be the target of black spells or abilities from black sources.", ['1', '1']);
  const DOOM = card('Test Black Doom', 'Instant', 'Destroy target creature.', undefined, ['B']);
  const BURN = card('Test Red Burn', 'Instant', 'Test Red Burn deals 1 damage to any target.', undefined, ['R']);
  const SHADE = card('Test Shade', 'Creature — Shade', '{0}: Test Shade deals 1 damage to any target.', ['1', '1'], ['B']);
  const MONK = card('Test Monk', 'Creature — Monk', '{0}: Test Monk deals 1 damage to any target.', ['1', '1'], ['W']);
  it('is automated (rst.t16.cantbetargeted.black is experimental: the card is partial)', () => {
    expect(automatedCard(INFORMER)).toBe(true);
  });
  it('a black spell and an ability of a black source can\'t target it; a red spell and an ability of a white source can', () => {
    const s = scenario([], { p1: { hand: ['Test Black Doom', 'Test Red Burn'], battlefield: ['Test Shade', 'Test Monk'] }, p2: { battlefield: ['Test Informer'] }, defs: [INFORMER, DOOM, BURN, SHADE, MONK] });
    const g = gameOf(s);
    const informer = find(s, 'Test Informer', 'battlefield');
    expect(hookpoints.canBeTargeted(g, informer, find(s, 'Test Black Doom', 'hand'), 'p1')).not.toBeNull();
    expect(hookpoints.canBeTargeted(g, informer, find(s, 'Test Red Burn', 'hand'), 'p1')).toBeNull();
    expect(hookpoints.canBeTargeted(g, informer, find(s, 'Test Shade', 'battlefield'), 'p1')).not.toBeNull();
    expect(hookpoints.canBeTargeted(g, informer, find(s, 'Test Monk', 'battlefield'), 'p1')).toBeNull();
  });
});

describe('CR 509.1b: evasion restrictions', () => {
  const COOKIE = card('Test Cookie', 'Artifact Creature — Golem', "{0}: Test Cookie can't be blocked this turn except by creatures with flying.", ['2', '1']);
  const BIRD = card('Test Bird', 'Creature — Bird', 'Flying', ['1', '1']);
  const PET = card('Test Pet', 'Creature — Dinosaur', "Test Pet can't be blocked by creatures with greater power.", ['2', '2']);
  it('both cards are automated and full (eff.t16.cantbeblocked.except.dur and rst.t16.cantbeblocked.greaterpower are stable)', () => {
    expect(full(COOKIE)).toBe(true);
    expect(full(PET)).toBe(true);
  });
  it('"can\'t be blocked this turn except by creatures with flying": only a flier can block it, this turn only', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Cookie'] }, p2: { battlefield: ['Test Bears', 'Test Bird'] }, defs: [COOKIE, BIRD, BEARS] });
    const cookie = find(s0, 'Test Cookie', 'battlefield');
    const bears = find(s0, 'Test Bears', 'battlefield');
    const bird = find(s0, 'Test Bird', 'battlefield');
    expect(ruleDenial(s0, { action: 'beBlockedBy', subject: cookie, other: bears })).toBeNull();
    let s = passBoth(activate(s0, cookie));
    expect(ruleDenial(s, { action: 'beBlockedBy', subject: cookie, other: bears })).not.toBeNull();
    expect(ruleDenial(s, { action: 'beBlockedBy', subject: cookie, other: bird })).toBeNull();
    s = advanceTo(s, 2, 'main1');
    expect(ruleDenial(s, { action: 'beBlockedBy', subject: cookie, other: bears })).toBeNull();
  });
  it('"can\'t be blocked by creatures with greater power": compared with its power at the time (CR 208.1)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Pet'] }, p2: { battlefield: ['Test Bears', 'Test Ogre'] }, defs: [PET, BEARS, OGRE] });
    const pet = find(s, 'Test Pet', 'battlefield');
    const bears = find(s, 'Test Bears', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield');
    expect(ruleDenial(s, { action: 'beBlockedBy', subject: pet, other: ogre })).not.toBeNull();
    expect(ruleDenial(s, { action: 'beBlockedBy', subject: pet, other: bears })).toBeNull(); // equal power is not greater
    s = tweak(s, (t) => { t.objects[pet]!.counters = { '+1/+1': 1 }; });
    expect(ruleDenial(s, { action: 'beBlockedBy', subject: pet, other: ogre })).toBeNull();
  });
});

describe('CR 509.1b, 611.2c: "Creatures without defender can\'t block ~ this turn"', () => {
  const CAT = card('Test Cat', 'Creature — Cat', "{0}: Creatures without defender can't block Test Cat this turn.", ['2', '1']);
  const WALL = card('Test Wall', 'Creature — Wall', 'Defender', ['0', '4']);
  it('is automated (eff.t16.each.cantblock.self is experimental: the card is partial)', () => {
    expect(automatedCard(CAT)).toBe(true);
  });
  it('a creature without defender can\'t block it (even one that enters later), a Wall can, and other attackers are not affected', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Cat', 'Test Ogre'] }, p2: { battlefield: ['Test Bears', 'Test Wall'] }, defs: [CAT, WALL, BEARS, OGRE] });
    const cat = find(s0, 'Test Cat', 'battlefield');
    const ogre = find(s0, 'Test Ogre', 'battlefield');
    const bears = find(s0, 'Test Bears', 'battlefield');
    const wall = find(s0, 'Test Wall', 'battlefield');
    let s = passBoth(activate(s0, cat));
    expect(ruleDenial(s, { action: 'block', subject: bears, other: cat })).not.toBeNull();
    expect(ruleDenial(s, { action: 'block', subject: wall, other: cat })).toBeNull();
    expect(ruleDenial(s, { action: 'block', subject: bears, other: ogre })).toBeNull();
    const late = put(s, 'p2', 'battlefield', 'Test Bears');
    s = { ...s };
    expect(ruleDenial(s, { action: 'block', subject: late, other: cat })).not.toBeNull();
  });
});

describe('CR 508.1c, 509.1b: restrictions on groups', () => {
  const LIGHT = card('Test Light', 'Enchantment', "Black creatures can't attack or block.");
  const VETO = card('Test Veto', 'Enchantment', "White creatures and blue creatures can't block.");
  const KNIGHT = card('Test Knight', 'Creature — Knight', '', ['2', '2'], ['B']);
  const CLERIC = card('Test Cleric', 'Creature — Cleric', '', ['2', '2'], ['W']);
  const WIZARD = card('Test Wizard', 'Creature — Wizard', '', ['2', '2'], ['U']);
  it('both cards are automated (experimental templates: partial)', () => {
    expect(automatedCard(LIGHT)).toBe(true);
    expect(automatedCard(VETO)).toBe(true);
  });
  it('"Black creatures can\'t attack or block": every black creature, whoever controls it', () => {
    const s = scenario([], { p1: { battlefield: ['Test Light', 'Test Knight', 'Test Bears'] }, p2: { battlefield: ['Test Knight'] }, defs: [LIGHT, KNIGHT, BEARS] });
    expect(attackers(s)).toEqual({ 'Test Bears': ['p2'] });
    const theirs = find(s, 'Test Knight', 'battlefield', 'p2');
    expect(ruleDenial(s, { action: 'block', subject: theirs, other: find(s, 'Test Bears', 'battlefield') })).not.toBeNull();
  });
  it('"White creatures and blue creatures can\'t block": both groups, and nothing else', () => {
    const s = scenario([], { p1: { battlefield: ['Test Veto', 'Test Bears'] }, p2: { battlefield: ['Test Cleric', 'Test Wizard', 'Test Knight'] }, defs: [VETO, CLERIC, WIZARD, KNIGHT, BEARS] });
    const bears = find(s, 'Test Bears', 'battlefield');
    expect(ruleDenial(s, { action: 'block', subject: find(s, 'Test Cleric', 'battlefield'), other: bears })).not.toBeNull();
    expect(ruleDenial(s, { action: 'block', subject: find(s, 'Test Wizard', 'battlefield'), other: bears })).not.toBeNull();
    expect(ruleDenial(s, { action: 'block', subject: find(s, 'Test Knight', 'battlefield'), other: bears })).toBeNull();
  });
});
