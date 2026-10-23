/**
 * FAST3 T13: the type, color and ability changes of parser/templates/zz-fast3/t13.json played through the engine with synthetic cards compiled by the game's
 * default compiler (wordings are invented, design 6.10). The templates are experimental, so cards are `partial` (design 6.9): their automated steps run,
 * which is what these tests check.
 *
 *   CR 702.16a, 608.2d, 607.2d  "target creature you control gains protection from the color of your choice" (also when the cost sacrificed the source)
 *   CR 305.7, 608.2h, 611.2c    "target land becomes the basic land type of your choice": the land type is SET (old types and rules-text abilities lost, the
 *                               new mana ability gained); each effect keeps the value chosen when it began
 *   CR 205.1a, 608.2h           "~ becomes the creature type of your choice": the creature types are replaced
 *   CR 608.2d, 611.2c           "creatures of the creature type of your choice get +0/+3": the set is locked as it resolves
 *   CR 305.7                    "target land becomes an Island until end of turn"; Aura "Enchanted land is a Forest."
 *   CR 205.1a, 613.1d-f, 613.4b Aura "loses all abilities and is a blue Frog creature with base power and toughness 1/1"; "until end of turn, target creature
 *                               loses all abilities and becomes a green Snail with base power and toughness 1/2"
 *   CR 205.1b, 613.4b           "becomes a 4/4 Golem artifact creature with trample"; "becomes an artifact creature with power and toughness each equal to
 *                               its mana value"
 *   CR 613.1f, 702.11e          "until end of turn, ~ loses defender and gains flying"; "permanents your opponents control lose hexproof and indestructible"
 *   CR 608.2d, 613.4c           "gets +1/-1 or -1/+1 until end of turn"
 *   CR 702.14c                  "gains forestwalk until end of turn"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, legal, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const manualSteps = (d: CardDef): boolean => JSON.stringify(d.faces).includes('"op":"manual"') || d.faces.some((f) => f.abilities.some((a) => a.kind === 'manual'));
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };

/** Answer the decisions that come up with `answers` (in order), pay costs automatically, choose `targets` when asked; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}

/** Activate the (one non-mana) activated ability of p1's permanent `name`; the ability is on the stack. */
function activate(s: GameState, name: string, targets: TargetChoice[] = []): GameState {
  const id = find(s, name, 'battlefield', 'p1');
  const la = legal(s, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no activated ability of ${name}`);
  return settle(act(s, la.action), targets);
}

/** Cast p1's card `name` from hand (cost {0}) with these targets; the spell is on the stack. */
function cast(s: GameState, name: string, targets: TargetChoice[] = []): GameState {
  return settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets);
}

/** Both players pass so the top of the stack resolves; decisions while it resolves get `answers`. */
function resolve(s: GameState, answers: DecisionAnswer[] = []): GameState {
  return settle(pass(pass(s)), [], answers);
}

const nextTurn = (s: GameState): GameState => advanceTo(s, s.turn.number + 1, 'upkeep');
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const protections = (s: GameState, id: ObjectId): string[] =>
  getChars(s, id)!.abilities.flatMap((a) => (a.def.kind === 'keyword' && a.def.keyword === 'protection' ? [String(a.def.quality)] : [])).sort();
const keys = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.abilities.map((a) => a.key);

const BEARS = card('Test Bears', 'Creature — Bear', '', ['2', '2']);
const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1']);
/** A nonbasic land with a printed mana ability (rules text a basic land type set by an effect takes away, CR 305.7). */
const GROVE = card('Test Grove', 'Land', '{T}: Add {G}.');
const SPIRE = card('Test Spire', 'Land — Mountain', '');

describe('CR 702.16a, 608.2d, 611.2c: "target creature you control gains protection from the color of your choice until end of turn"', () => {
  const MONK = card('Test Rune Monk', 'Creature — Human Cleric', '{0}: Target creature you control gains protection from the color of your choice until end of turn.', ['1', '1']);
  const MARTYR = card('Test Martyr', 'Creature — Human Cleric', 'Sacrifice Test Martyr: Target creature you control gains protection from the color of your choice until end of turn.', ['1', '1']);

  it('is automated', () => {
    for (const d of [MONK, MARTYR]) expect(manualSteps(d), d.name).toBe(false);
  });

  it('CR 702.16a, 611.2c: the target gains protection from the chosen color until end of turn', () => {
    let s = scenario([], { p1: { battlefield: ['Test Rune Monk', 'Test Bears'] }, defs: [MONK, BEARS] });
    const bears = find(s, 'Test Bears', 'battlefield');
    s = resolve(activate(s, 'Test Rune Monk', [obj(bears)]), [{ kind: 'chooseColor', color: 'B' }]);
    expect(protections(s, bears)).toEqual(['color:B']);
    s = nextTurn(s);
    expect(protections(s, bears)).toEqual([]);
  });

  it('CR 608.2d, 607.2d, 400.7: the choice counts even when the source was sacrificed to pay the cost (it can remember nothing any more)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Martyr', 'Test Bears'] }, defs: [MARTYR, BEARS] });
    const bears = find(s, 'Test Bears', 'battlefield');
    s = resolve(activate(s, 'Test Martyr', [obj(bears)]), [{ kind: 'chooseColor', color: 'R' }]);
    expect(protections(s, bears)).toEqual(['color:R']);
  });
});

describe('CR 305.7, 608.2d: "target land becomes the basic land type of your choice until end of turn"', () => {
  const MYSTIC = card('Test Tide Mystic', 'Creature — Merfolk Wizard', '{0}: Target land becomes the basic land type of your choice until end of turn.', ['1', '1']);

  it('is automated, and the choice is among the five basic land types', () => {
    expect(manualSteps(MYSTIC)).toBe(false);
    let s = scenario([], { p1: { battlefield: ['Test Tide Mystic'] }, p2: { battlefield: ['Test Grove'] }, defs: [MYSTIC, GROVE] });
    s = pass(pass(activate(s, 'Test Tide Mystic', [obj(find(s, 'Test Grove', 'battlefield'))])));
    expect(s.pending).toMatchObject({ kind: 'chooseName', options: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] });
  });

  it('CR 305.7: the land loses its rules-text abilities and gains the mana ability of the chosen type, until end of turn', () => {
    let s = scenario([], { p1: { battlefield: ['Test Tide Mystic'] }, p2: { battlefield: ['Test Grove', 'Test Spire'] }, defs: [MYSTIC, GROVE, SPIRE] });
    const grove = find(s, 'Test Grove', 'battlefield');
    const spire = find(s, 'Test Spire', 'battlefield');
    s = resolve(activate(s, 'Test Tide Mystic', [obj(grove)]), [{ kind: 'chooseName', name: 'Island' }]);
    expect(getChars(s, grove)!.subtypes).toEqual(['Island']);
    expect(keys(s, grove)).toEqual(['r:basic:U']);
    // a land that had a basic land type loses it: the type is set, never added
    s = resolve(activate(s, 'Test Tide Mystic', [obj(spire)]), [{ kind: 'chooseName', name: 'Swamp' }]);
    expect(getChars(s, spire)!.subtypes).toEqual(['Swamp']);
    expect(keys(s, spire)).toEqual(['r:basic:B']);
    s = nextTurn(s);
    expect(getChars(s, grove)!.subtypes).toEqual([]);
    expect(keys(s, grove)).toHaveLength(1);
    expect(keys(s, grove)[0]).not.toBe('r:basic:U');
    expect(getChars(s, spire)!.subtypes).toEqual(['Mountain']);
  });

  it('CR 608.2h, 611.2c: each effect keeps the type chosen when it began; the later one wins by timestamp (CR 613.7)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Tide Mystic'] }, p2: { battlefield: ['Test Grove'] }, defs: [MYSTIC, GROVE] });
    const grove = find(s, 'Test Grove', 'battlefield');
    s = resolve(activate(s, 'Test Tide Mystic', [obj(grove)]), [{ kind: 'chooseName', name: 'Swamp' }]);
    s = resolve(activate(s, 'Test Tide Mystic', [obj(grove)]), [{ kind: 'chooseName', name: 'Forest' }]);
    expect(getChars(s, grove)!.subtypes).toEqual(['Forest']);
    // the stored effects hold the values themselves, never the link the second choice overwrote
    const sets = JSON.stringify(s.continuousEffects);
    expect(sets).toContain('"set":["Swamp"]');
    expect(sets).toContain('"set":["Forest"]');
    expect(sets).not.toContain('"chosenSets"');
  });
});

describe('CR 205.1a, 608.2h: "~ becomes the creature type of your choice until end of turn"', () => {
  const SHIFTER = card('Test Mist Shifter', 'Creature — Illusion', '{0}: Test Mist Shifter becomes the creature type of your choice until end of turn.', ['2', '1']);

  it('the creature types are replaced by the chosen one; a second activation is a newer effect, the first keeps its value', () => {
    expect(manualSteps(SHIFTER)).toBe(false);
    let s = scenario([], { p1: { battlefield: ['Test Mist Shifter'] }, defs: [SHIFTER] });
    const id = find(s, 'Test Mist Shifter', 'battlefield');
    s = resolve(activate(s, 'Test Mist Shifter'), [{ kind: 'chooseName', name: 'Elf' }]);
    expect(getChars(s, id)!.subtypes).toEqual(['Elf']);
    s = resolve(activate(s, 'Test Mist Shifter'), [{ kind: 'chooseName', name: 'Goblin' }]);
    expect(getChars(s, id)!.subtypes).toEqual(['Goblin']);
    expect(JSON.stringify(s.continuousEffects)).toContain('"set":["Elf"]');
    s = nextTurn(s);
    expect(getChars(s, id)!.subtypes).toEqual(['Illusion']);
  });
});

describe('CR 608.2d, 611.2c: "creatures of the creature type of your choice get +0/+3 until end of turn"', () => {
  const HORN = card('Test Rally Horn', 'Artifact', '{0}: Creatures of the creature type of your choice get +0/+3 until end of turn.');

  it('every creature of the chosen type gets it (any controller), others do not; the set is locked as it resolves', () => {
    expect(manualSteps(HORN)).toBe(false);
    let s = scenario([], { p1: { battlefield: ['Test Rally Horn', 'Test Bears', 'Test Elf'] }, p2: { battlefield: ['Test Bears'] }, defs: [HORN, BEARS, ELF] });
    const mine = find(s, 'Test Bears', 'battlefield', 'p1');
    const theirs = find(s, 'Test Bears', 'battlefield', 'p2');
    const elf = find(s, 'Test Elf', 'battlefield');
    s = resolve(activate(s, 'Test Rally Horn'), [{ kind: 'chooseName', name: 'Bear' }]);
    expect(pt(s, mine)).toBe('2/5');
    expect(pt(s, theirs)).toBe('2/5');
    expect(pt(s, elf)).toBe('1/1');
    s = nextTurn(s);
    expect(pt(s, mine)).toBe('2/2');
  });
});

describe('CR 305.7: "target land becomes an Island until end of turn" and the Aura "Enchanted land is a Forest."', () => {
  const WARRIOR = card('Test Tide Warrior', 'Creature — Merfolk Warrior', '{0}: Target land becomes an Island until end of turn.', ['1', '1']);
  const SEAS = card('Test Creeping Woods', 'Enchantment — Aura', 'Enchant land\nEnchanted land is a Forest.');

  it('until end of turn the land is an Island with only the Island mana ability', () => {
    expect(manualSteps(WARRIOR)).toBe(false);
    let s = scenario([], { p1: { battlefield: ['Test Tide Warrior'] }, p2: { battlefield: ['Test Grove'] }, defs: [WARRIOR, GROVE] });
    const grove = find(s, 'Test Grove', 'battlefield');
    s = resolve(activate(s, 'Test Tide Warrior', [obj(grove)]));
    expect(getChars(s, grove)!.subtypes).toEqual(['Island']);
    expect(keys(s, grove)).toEqual(['r:basic:U']);
    s = nextTurn(s);
    expect(getChars(s, grove)!.subtypes).toEqual([]);
  });

  it('the enchanted land is a Forest (its old land type and abilities gone) for as long as the Aura is attached', () => {
    expect(manualSteps(SEAS)).toBe(false);
    let s = scenario([], { p1: { hand: ['Test Creeping Woods'] }, p2: { battlefield: ['Test Spire'] }, defs: [SEAS, SPIRE] });
    const spire = find(s, 'Test Spire', 'battlefield');
    s = resolve(cast(s, 'Test Creeping Woods', [obj(spire)]));
    expect(getChars(s, spire)!.subtypes).toEqual(['Forest']);
    expect(keys(s, spire)).toEqual(['r:basic:G']);
  });
});

describe('CR 205.1a, 613.1d-f, 613.4b: losing all abilities and becoming a [color] [subtype] with base power and toughness N/N', () => {
  const FROGIFY = card('Test Snailify', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature loses all abilities and is a green Snail creature with base power and toughness 1/2.');
  const FLIER = card('Test Flier', 'Artifact Creature — Bird', 'Flying', ['3', '3']);
  const TURN = card('Test Snail Rod', 'Artifact', '{0}: Until end of turn, target creature loses all abilities and becomes a green Snail with base power and toughness 1/2.');

  it('the Aura: a green Snail creature (no other card type, creature type or ability) 1/2, while attached', () => {
    expect(manualSteps(FROGIFY)).toBe(false);
    let s = scenario([], { p1: { hand: ['Test Snailify'] }, p2: { battlefield: ['Test Flier'] }, defs: [FROGIFY, FLIER] });
    const flier = find(s, 'Test Flier', 'battlefield');
    s = resolve(cast(s, 'Test Snailify', [obj(flier)]));
    const c = getChars(s, flier)!;
    expect(c.types).toEqual(['Creature']);
    expect(c.subtypes).toEqual(['Snail']);
    expect(c.colors).toEqual(['G']);
    expect(hasKeyword(c, 'flying')).toBe(false);
    expect(pt(s, flier)).toBe('1/2');
  });

  it('until end of turn: a green Snail 1/2 that keeps its card types, then itself again', () => {
    expect(manualSteps(TURN)).toBe(false);
    let s = scenario([], { p1: { battlefield: ['Test Snail Rod'] }, p2: { battlefield: ['Test Flier'] }, defs: [TURN, FLIER] });
    const flier = find(s, 'Test Flier', 'battlefield');
    s = resolve(activate(s, 'Test Snail Rod', [obj(flier)]));
    const c = getChars(s, flier)!;
    expect([...c.types].sort()).toEqual(['Artifact', 'Creature']);
    expect(c.subtypes).toEqual(['Snail']);
    expect(c.colors).toEqual(['G']);
    expect(hasKeyword(c, 'flying')).toBe(false);
    expect(pt(s, flier)).toBe('1/2');
    s = nextTurn(s);
    expect(getChars(s, flier)!.subtypes).toEqual(['Bird']);
    expect(hasKeyword(getChars(s, flier)!, 'flying')).toBe(true);
    expect(pt(s, flier)).toBe('3/3');
  });
});

describe('CR 205.1b, 613.4b: artifacts that become artifact creatures', () => {
  const EGG = card('Test Golem Egg', 'Artifact', '{0}: Test Golem Egg becomes a 4/4 Golem artifact creature with trample until end of turn.');
  const TOUCH = card('Test Animator', 'Artifact', '{0}: Target noncreature artifact becomes an artifact creature with power and toughness each equal to its mana value until end of turn.');
  const IDOL = card('Test Idol', 'Artifact — Equipment', '', undefined, '{3}');

  it('"becomes a 4/4 Golem artifact creature with trample until end of turn"', () => {
    expect(manualSteps(EGG)).toBe(false);
    let s = scenario([], { p1: { battlefield: ['Test Golem Egg'] }, defs: [EGG] });
    const id = find(s, 'Test Golem Egg', 'battlefield');
    s = resolve(activate(s, 'Test Golem Egg'));
    const c = getChars(s, id)!;
    expect([...c.types].sort()).toEqual(['Artifact', 'Creature']);
    expect(c.subtypes).toEqual(['Golem']);
    expect(hasKeyword(c, 'trample')).toBe(true);
    expect(pt(s, id)).toBe('4/4');
  });

  it('"with power and toughness each equal to its mana value": a mana value 3 Equipment is a 3/3 artifact creature that keeps its subtype', () => {
    expect(manualSteps(TOUCH)).toBe(false);
    let s = scenario([], { p1: { battlefield: ['Test Animator', 'Test Idol'] }, defs: [TOUCH, IDOL] });
    const idol = find(s, 'Test Idol', 'battlefield');
    s = resolve(activate(s, 'Test Animator', [obj(idol)]));
    const c = getChars(s, idol)!;
    expect([...c.types].sort()).toEqual(['Artifact', 'Creature']);
    expect(c.subtypes).toEqual(['Equipment']);
    expect(pt(s, idol)).toBe('3/3');
    s = nextTurn(s);
    expect(getChars(s, idol)!.types).toEqual(['Artifact']);
  });
});

describe('CR 613.1f: losing and gaining abilities', () => {
  const GARGOYLE = card('Test Gargoyle', 'Artifact Creature — Gargoyle', 'Defender\n{0}: Until end of turn, Test Gargoyle loses defender and gains flying.', ['3', '4']);
  const SPEAR = card('Test Truth Spear', 'Artifact', '{0}: Permanents your opponents control lose hexproof and indestructible until end of turn.');
  const WARD = card('Test Warded Golem', 'Artifact Creature — Golem', 'Hexproof from white\nIndestructible', ['2', '2']);
  const WALKER = card('Test Woods Walker', 'Creature — Dryad', '{0}: Target creature gains forestwalk until end of turn.', ['1', '1']);

  it('"until end of turn, ~ loses defender and gains flying"', () => {
    expect(manualSteps(GARGOYLE)).toBe(false);
    let s = scenario([], { p1: { battlefield: ['Test Gargoyle'] }, defs: [GARGOYLE] });
    const id = find(s, 'Test Gargoyle', 'battlefield');
    s = resolve(activate(s, 'Test Gargoyle'));
    expect(hasKeyword(getChars(s, id)!, 'defender')).toBe(false);
    expect(hasKeyword(getChars(s, id)!, 'flying')).toBe(true);
    s = nextTurn(s);
    expect(hasKeyword(getChars(s, id)!, 'defender')).toBe(true);
    expect(hasKeyword(getChars(s, id)!, 'flying')).toBe(false);
  });

  it('CR 702.11e: losing hexproof also loses "hexproof from"; only the opponents\' permanents are affected', () => {
    expect(manualSteps(SPEAR)).toBe(false);
    let s = scenario([], { p1: { battlefield: ['Test Truth Spear', 'Test Warded Golem'] }, p2: { battlefield: ['Test Warded Golem'] }, defs: [SPEAR, WARD] });
    const mine = find(s, 'Test Warded Golem', 'battlefield', 'p1');
    const theirs = find(s, 'Test Warded Golem', 'battlefield', 'p2');
    s = resolve(activate(s, 'Test Truth Spear'));
    expect(hasKeyword(getChars(s, theirs)!, 'hexproof')).toBe(false);
    expect(hasKeyword(getChars(s, theirs)!, 'indestructible')).toBe(false);
    expect(hasKeyword(getChars(s, mine)!, 'hexproof')).toBe(true);
    expect(hasKeyword(getChars(s, mine)!, 'indestructible')).toBe(true);
  });

  it('CR 702.14c: "gains forestwalk until end of turn" is landwalk for Forests', () => {
    expect(manualSteps(WALKER)).toBe(false);
    let s = scenario([], { p1: { battlefield: ['Test Woods Walker', 'Test Bears'] }, defs: [WALKER, BEARS] });
    const bears = find(s, 'Test Bears', 'battlefield');
    s = resolve(activate(s, 'Test Woods Walker', [obj(bears)]));
    const walk = getChars(s, bears)!.abilities.find((a) => a.def.kind === 'keyword' && a.def.keyword === 'landwalk');
    expect(walk?.def).toMatchObject({ keyword: 'landwalk', quality: 'forest' });
    s = nextTurn(s);
    expect(getChars(s, bears)!.abilities.some((a) => a.def.kind === 'keyword' && a.def.keyword === 'landwalk')).toBe(false);
  });
});

describe('CR 608.2d, 613.4c: "gets +1/-1 or -1/+1 until end of turn" is chosen as it resolves', () => {
  const SHAPER = card('Test Tide Shaper', 'Creature — Shapeshifter', '{0}: Test Tide Shaper gets +1/-1 or -1/+1 until end of turn.', ['2', '2']);

  it('the chosen change applies, only that one', () => {
    expect(manualSteps(SHAPER)).toBe(false);
    let s = scenario([], { p1: { battlefield: ['Test Tide Shaper'] }, defs: [SHAPER] });
    const id = find(s, 'Test Tide Shaper', 'battlefield');
    s = pass(pass(activate(s, 'Test Tide Shaper')));
    expect(s.pending).toMatchObject({ kind: 'chooseOption' });
    const options = (s.pending as unknown as { options: { id: string; label: string }[] }).options;
    expect(options.map((o) => o.label)).toEqual(['+1/-1', '-1/+1']);
    s = settle(answer(s, { kind: 'chooseOption', ids: [options[1]!.id] }));
    expect(pt(s, id)).toBe('1/3');
    s = resolve(activate(s, 'Test Tide Shaper'), [{ kind: 'chooseOption', ids: [options[0]!.id] }]);
    expect(pt(s, id)).toBe('2/2');
  });
});
