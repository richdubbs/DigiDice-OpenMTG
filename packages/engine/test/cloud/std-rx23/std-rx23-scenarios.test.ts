/**
 * Card wave 2, EDHREC lane rx23 (std-rx23): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 615.1a, 611.2a        "Prevent all damage that would be dealt this turn by creatures you control": a creature of the group deals no damage, a spell
 *                            does; the group is read as damage is dealt (a creature that enters later is in it); the shield ends with the turn
 *   CR 615.1a, 510.1         "Prevent all combat damage that would be dealt this turn by creatures with power 2 or less": a 2/2 attacker deals none, a 3/3
 *                            deals its damage; noncombat damage of a 1/1 is not prevented
 *   CR 120.3, 608.2h         "~ deals damage to each opponent equal to the number of lands that player controls": each opponent is dealt damage counted
 *                            for that opponent; you are not; "twice the number of nonbasic lands that player controls" to each player doubles each count
 *   CR 601.3, 101.2          (std-rx21's reading, played here too) "You can't cast creature spells.": a creature card in hand can't be cast, a sorcery can; with the source gone it can. "... this
 *                            turn": the restriction ends with the turn. "That creature's owner can't cast spells with the same name as that creature until
 *                            your next turn": the owner of a returned creature can't cast it on their turn; another creature card can be cast
 *   CR 608.2c, 301.5a        "put a +1/+1 counter on equipped creature if it's black": a black equipped creature gets the counter, a green one does not
 *   CR 500.7, 305.2a         "takes two extra turns after this one": two extra turns are queued; "You may play up to two additional lands this turn": a
 *                            third land is playable this turn, a fourth is not
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, life, passBoth, scenario } from '../../m3/scenario';
import { runCombat } from '../../m4/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  const colors = ['W', 'U', 'B', 'R', 'G'].filter((c) => cost.includes(`{${c}}`)); // CR 105.2: a card's colors are those of its mana cost
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { targets?: TargetChoice[][] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = [...(script.targets ?? [])];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const resolveAll = (s0: GameState): GameState => {
  let s = s0;
  for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = drive(passBoth(s));
  return s;
};
const cast = (s: GameState, name: string, script?: Script, player: 'p1' | 'p2' = 'p1'): GameState => resolveAll(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script));
const activate = (s: GameState, source: ObjectId, script?: Script): GameState => {
  const a = legal(s, 'p1', 'activate').find((x) => x.object === source && !x.isMana);
  if (!a) throw new Error(`no ability of ${source} to activate`);
  return resolveAll(drive(act(s, a.action), script));
};
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const p2: TargetChoice = { kind: 'player', id: 'p2' };
const castable = (s: GameState, player: 'p1' | 'p2', name: string): boolean =>
  legal(s, player, 'cast').some((a) => s.objects[(a.action as { card?: string }).card ?? '']?.defId === name);

const IMP = card('Test Ember Imp', 'Creature — Imp', '{T}: This creature deals 1 damage to any target.', ['1', '1']);
const FLICK = card('Test Spark Flick', 'Instant', 'Test Spark Flick deals 1 damage to any target.');
const BEAR = card('Test Moor Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
const OGRE = card('Test Moor Ogre', 'Creature — Ogre', '', ['3', '3'], '{2}{R}');

describe('CR 615.1a, 611.2a: "Prevent all damage that would be dealt this turn by creatures you control." (a group source, read as damage is dealt)', () => {
  const VEIL = card('Test Quiet Veil', 'Instant', 'Prevent all damage that would be dealt this turn by creatures you control.');
  const defs = [VEIL, IMP, FLICK];
  const start = (): GameState => scenario([], { defs, p1: { hand: ['Test Quiet Veil', 'Test Spark Flick'], battlefield: ['Test Ember Imp'] } });
  it('is automated, with the group as the damage source', () => {
    expect(full(VEIL)).toBe(true);
    expect(JSON.stringify(VEIL.faces)).toContain('"replaces":{"ev":"damage","source":{"types":["Creature"],"controller":"you"}}');
  });
  it('a creature you control deals no damage this turn; a spell still deals its damage', () => {
    let s = cast(start(), 'Test Quiet Veil');
    s = activate(s, find(s, 'Test Ember Imp', 'battlefield', 'p1'), { targets: [[p2]] });
    expect(life(s, 'p2')).toBe(20);
    s = cast(s, 'Test Spark Flick', { targets: [[p2]] });
    expect(life(s, 'p2')).toBe(19);
  });
  it('without the spell the creature deals its damage (the negative case)', () => {
    const s0 = start();
    const s = activate(s0, find(s0, 'Test Ember Imp', 'battlefield', 'p1'), { targets: [[p2]] });
    expect(life(s, 'p2')).toBe(19);
  });
  it('the shield ends with the turn (CR 514.2): on the next turn of yours the creature deals damage', () => {
    let s = cast(start(), 'Test Quiet Veil');
    s = advanceTo(s, 3, 'main1');
    s = activate(s, find(s, 'Test Ember Imp', 'battlefield', 'p1'), { targets: [[p2]] });
    expect(life(s, 'p2')).toBe(19);
  });
});

describe('CR 615.1a, 510.1: "Prevent all combat damage that would be dealt this turn by creatures with power 2 or less."', () => {
  const MIST = card('Test Low Mist', 'Instant', 'Prevent all combat damage that would be dealt this turn by creatures with power 2 or less.');
  const defs = [MIST, BEAR, OGRE, IMP];
  it('is automated', () => expect(full(MIST)).toBe(true));
  it('a 2/2 attacker deals no combat damage; a 3/3 deals its 3', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Low Mist'], battlefield: ['Test Moor Bear', 'Test Moor Ogre'] } });
    s = cast(s, 'Test Low Mist');
    s = runCombat(s, { attack: [[find(s, 'Test Moor Bear', 'battlefield', 'p1'), 'p2'], [find(s, 'Test Moor Ogre', 'battlefield', 'p1'), 'p2']] });
    expect(life(s, 'p2')).toBe(17);
  });
  it('CR 615.1a: noncombat damage of a 1/1 is not prevented', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Low Mist'], battlefield: ['Test Ember Imp'] } });
    s = cast(s, 'Test Low Mist');
    s = activate(s, find(s, 'Test Ember Imp', 'battlefield', 'p1'), { targets: [[p2]] });
    expect(life(s, 'p2')).toBe(19);
  });
});

describe('CR 120.3, 608.2h: "~ deals damage to each opponent equal to the number of lands that player controls." and "to each player equal to twice the number ..."', () => {
  const QUAKE = card('Test Rift Quake', 'Sorcery', 'Test Rift Quake deals damage to each opponent equal to the number of lands that player controls.');
  const TOLL = card('Test Odd Toll', 'Sorcery', 'Test Odd Toll deals damage to each player equal to twice the number of nonbasic lands that player controls.');
  const ODD = card('Test Odd Grove', 'Land', '{T}: Add {C}.');
  const defs = [QUAKE, TOLL, ODD];
  it('both are automated', () => {
    expect(full(QUAKE)).toBe(true);
    expect(full(TOLL)).toBe(true);
  });
  it('each opponent is dealt damage counted for that opponent; you are not dealt damage', () => {
    let s = scenario(['Plains'], { defs, p1: { hand: ['Test Rift Quake'], battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Plains', 'Plains', 'Test Odd Grove'] } });
    s = cast(s, 'Test Rift Quake');
    expect(life(s, 'p2')).toBe(17);
    expect(life(s, 'p1')).toBe(20);
  });
  it('twice each player\'s own count: one nonbasic land is 2 damage, two are 4, basic lands are not counted', () => {
    let s = scenario(['Plains'], { defs, p1: { hand: ['Test Odd Toll'], battlefield: ['Plains', 'Test Odd Grove'] }, p2: { battlefield: ['Plains', 'Test Odd Grove', 'Test Odd Grove'] } });
    s = cast(s, 'Test Odd Toll');
    expect(life(s, 'p1')).toBe(18);
    expect(life(s, 'p2')).toBe(16);
  });
});

describe('CR 601.3, 101.2: "You can\'t cast creature spells." and "... this turn" (a restriction on casting spells of a description)', () => {
  const ROD = card('Test Iron Rod', 'Artifact', "You can't cast creature spells.");
  const DRAW = card('Test Hush Note', 'Sorcery', "Draw a card. You can't cast creature spells this turn.");
  const SORC = card('Test Small Lesson', 'Sorcery', 'Draw a card.');
  const defs = [ROD, DRAW, SORC, BEAR];
  it('both are automated', () => {
    expect(full(ROD)).toBe(true);
    expect(full(DRAW)).toBe(true);
  });
  it('a creature card can\'t be cast while the permanent is on the battlefield; a sorcery can', () => {
    const s = scenario(['Forest'], { defs, p1: { hand: ['Test Moor Bear', 'Test Small Lesson'], battlefield: ['Test Iron Rod', 'Forest', 'Forest'] } });
    expect(castable(s, 'p1', 'Test Moor Bear')).toBe(false);
    expect(castable(s, 'p1', 'Test Small Lesson')).toBe(true);
  });
  it('without the permanent the creature card can be cast (the negative case)', () => {
    const s = scenario(['Forest'], { defs, p1: { hand: ['Test Moor Bear'], battlefield: ['Forest', 'Forest'] } });
    expect(castable(s, 'p1', 'Test Moor Bear')).toBe(true);
  });
  it('the restriction "this turn" stops creature spells this turn only', () => {
    let s = scenario(['Forest'], { defs, p1: { hand: ['Test Hush Note', 'Test Moor Bear'], battlefield: ['Forest', 'Forest'] } });
    s = cast(s, 'Test Hush Note');
    expect(castable(s, 'p1', 'Test Moor Bear')).toBe(false);
    s = advanceTo(s, 3, 'main1');
    expect(castable(s, 'p1', 'Test Moor Bear')).toBe(true);
  });
});

describe('CR 400.7, 608.2h: "That creature\'s owner can\'t cast spells with the same name as that creature until your next turn." is not full (fail closed)', () => {
  const MAGE = card('Test Mirror Warden', 'Creature — Human Wizard', "When this creature enters, return target creature an opponent controls to its owner's hand. That creature's owner can't cast spells with the same name as that creature until your next turn.", ['3', '2']);
  it('is not automated: the returned creature is a new object, whose name the restriction would not read (std-rx21: feature:restrict.other.lastingSharesWith is never registered)', () => expect(full(MAGE)).toBe(false));
  it('"That creature\'s owner can\'t cast creature spells until your next turn." after the return is automated and stops the owner\'s creature spells on their turn', () => {
    const M = card('Test Probe Mage', 'Creature — Human Wizard', "When this creature enters, return target creature an opponent controls to its owner's hand. That creature's owner can't cast creature spells until your next turn.", ['3', '2']);
    expect(full(M)).toBe(true);
    let s = scenario(['Forest', 'Mountain'], { defs: [M, BEAR, OGRE], p1: { hand: ['Test Probe Mage'] }, p2: { hand: ['Test Moor Ogre'], battlefield: ['Test Moor Bear', 'Forest', 'Forest', 'Mountain', 'Mountain', 'Mountain'] } });
    const bear = find(s, 'Test Moor Bear', 'battlefield', 'p2');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Probe Mage', 'hand', 'p1') }));
    s = resolveAll(drive(passBoth(s), { targets: [[obj(bear)]] })); // the enters trigger targets as it is put on the stack (CR 603.3d)
    expect(findAll(s, 'Test Moor Bear', 'hand', 'p2').length).toBe(1);
    s = advanceTo(s, 2, 'main1');
    expect(castable(s, 'p2', 'Test Moor Bear')).toBe(false);
    expect(castable(s, 'p2', 'Test Moor Ogre')).toBe(false);
    s = advanceTo(s, 4, 'main1');
    expect(castable(s, 'p2', 'Test Moor Ogre')).toBe(true); // "until your next turn" has ended (CR 611.2b)
  });
});

describe('CR 608.2c, 301.5a: "At the beginning of your upkeep, put a +1/+1 counter on equipped creature if it\'s black."', () => {
  const RING = card('Test Onyx Band', 'Artifact — Equipment', "At the beginning of your upkeep, put a +1/+1 counter on equipped creature if it's black.\nEquip {1}");
  const SHADE = card('Test Bog Shade', 'Creature — Shade', '', ['1', '1'], '{B}');
  const defs = [RING, SHADE, BEAR];
  const counters = (bearer: string): number => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Onyx Band', bearer] } });
    const c = find(s, bearer, 'battlefield', 'p1');
    s.objects[find(s, 'Test Onyx Band', 'battlefield', 'p1')]!.attachedTo = c;
    s = advanceTo(s, 3, 'main1');
    return s.objects[c]!.counters['+1/+1'] ?? 0;
  };
  it('is automated, the condition naming the equipped creature', () => {
    expect(full(RING)).toBe(true);
    expect(JSON.stringify(RING.faces)).toContain('"guard":{"cond":"matches","object":{"ref":"attachedTo"},"filter":{"colors":["B"]}}');
  });
  it('a black equipped creature gets the counter', () => expect(counters('Test Bog Shade')).toBe(1));
  it('a green equipped creature does not (the condition is about the creature, not the Equipment)', () => expect(counters('Test Moor Bear')).toBe(0));
});

describe('CR 500.7, 305.2a: "Target player takes two extra turns after this one." and "You may play up to two additional lands this turn."', () => {
  const STRETCH = card('Test Long Hour', 'Sorcery', 'Draw a card. Target player takes two extra turns after this one.');
  const BLOOM = card('Test Wide Bloom', 'Sorcery', 'Draw a card. You may play up to two additional lands this turn.');
  const defs = [STRETCH, BLOOM];
  it('both are automated', () => {
    expect(full(STRETCH)).toBe(true);
    expect(full(BLOOM)).toBe(true);
  });
  it('two extra turns are queued for the target player', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Long Hour'] } });
    s = cast(s, 'Test Long Hour', { targets: [[{ kind: 'player', id: 'p1' }]] });
    expect(s.turn.extraTurns).toEqual(['p1', 'p1']);
  });
  it('after the land of the turn two more lands can be played, a fourth cannot', () => {
    let s = scenario(['Forest'], { defs, p1: { hand: ['Test Wide Bloom', 'Forest', 'Forest', 'Forest', 'Forest'] } });
    s = cast(s, 'Test Wide Bloom');
    for (let i = 0; i < 3; i++) {
      const play = legal(s, 'p1', 'playLand')[0];
      expect(play, `land ${i + 1}`).toBeDefined();
      s = act(s, play!.action);
    }
    expect(legal(s, 'p1', 'playLand')).toEqual([]);
  });
});

describe('CR 305.7, 613.1d: "Nonbasic lands are Swamps." (the land type set; the land loses its own abilities and taps for {B})', () => {
  const HAG = card('Test Bog Crone', 'Creature — Hag', 'Nonbasic lands are Swamps.', ['2', '2']);
  const ODD = card('Test Odd Grove', 'Land', '{T}: Add {C}.');
  const defs = [HAG, ODD];
  const manaOf = (s: GameState, land: ObjectId): string[] => legal(s, 'p1', 'activate').filter((a) => a.object === land && a.isMana).map((a) => JSON.stringify(a.action));
  it('is automated', () => expect(full(HAG)).toBe(true));
  it('a nonbasic land is a Swamp: it taps for {B}, not {C}; a basic land is unchanged', () => {
    const s = scenario(['Forest'], { defs, p1: { battlefield: ['Test Odd Grove', 'Forest'] }, p2: { battlefield: ['Test Bog Crone'] } });
    const odd = find(s, 'Test Odd Grove', 'battlefield', 'p1');
    expect(getChars(s, odd).subtypes).toEqual(['Swamp']);
    expect(getChars(s, find(s, 'Forest', 'battlefield', 'p1')).subtypes).toEqual(['Forest']);
    expect(getChars(s, odd).abilities.some((a) => JSON.stringify(a.def).includes('"C"'))).toBe(false);
    expect(manaOf(s, odd).length).toBeGreaterThan(0);
  });
  it('without the creature the nonbasic land keeps its own ability (the negative case)', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Odd Grove'] } });
    const odd = find(s, 'Test Odd Grove', 'battlefield', 'p1');
    expect(getChars(s, odd).subtypes).toEqual([]);
    expect(getChars(s, odd).abilities.some((a) => JSON.stringify(a.def).includes('"C"'))).toBe(true);
  });
});

describe('CR 509.1h, 615.1a: "unblocked creatures" are attacking creatures with no blocker; a blocking creature is not one (rules/filter.ts)', () => {
  const SNARE = card('Test Bramble Hold', 'Instant', 'Prevent all combat damage that would be dealt by unblocked creatures this turn.');
  const defs = [SNARE, BEAR, OGRE];
  it('is automated', () => expect(full(SNARE)).toBe(true));
  it('the unblocked attacker deals no damage; the blocked attacker and its blocker deal theirs', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Bramble Hold'], battlefield: ['Test Moor Bear', 'Test Moor Bear'] }, p2: { battlefield: ['Test Moor Ogre'] } });
    s = cast(s, 'Test Bramble Hold');
    const [a, b] = findAll(s, 'Test Moor Bear', 'battlefield', 'p1');
    const ogre = find(s, 'Test Moor Ogre', 'battlefield', 'p2');
    s = runCombat(s, { attack: [[a!, 'p2'], [b!, 'p2']], block: [[ogre, b!]] });
    expect(life(s, 'p2')).toBe(20); // the unblocked bear's 2 is prevented
    expect(s.objects[ogre]?.damage).toBe(2); // the blocked bear's damage is dealt
    expect(findAll(s, 'Test Moor Bear', 'battlefield', 'p1').length).toBe(1); // the blocker (not unblocked) killed the blocked bear
  });
});
