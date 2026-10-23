/**
 * FAST5 T47 (T-ANIMATE): the shapes of parser/templates/zz-fast5/t47.json ("becomes a creature" animation with colors, creature types, keywords and quoted
 * abilities, the "it's still a land" riders, "in addition to its other types", an artifact creature with base power and toughness, "all creature types",
 * Enduring's "It's an enchantment" after the return) played through applyAction with synthetic cards compiled by the game's default compiler (wordings are
 * invented, design 6.10).
 *
 *   CR 205.1a, 205.1b     a set card type replaces the old ones; "still a land" and "in addition to its other types" keep them (and a land keeps its land types)
 *   CR 205.3d             a creature type of a permanent that is no creature is not kept; a land type stays with the land
 *   CR 613.1d-f, 613.4b   layers 4, 5, 6 and 7b: types, colors, abilities, base power and toughness; "until end of turn" ends at cleanup (CR 514.2)
 *   CR 702.73a            "all creature types"
 *   CR 603.10a, 603.4     "When ~ dies, if it was a creature": the object as it last existed; a noncreature that goes to the graveyard does not return
 *   CR 400.7, 205.1a      "return it to the battlefield ... It's an enchantment": the new object is an enchantment, not a creature
 */
import { describe, expect, it } from 'vitest';
import { charsOfObject, compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, legal, pass, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"')).map((a) => a.text);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const ch = (s: GameState, id: ObjectId) => charsOfObject(s, s.objects[id]!);
const has = (s: GameState, id: ObjectId, kw: string): boolean => ch(s, id).keywords.some((k) => k.keyword === kw);
const pt = (s: GameState, id: ObjectId): string => `${ch(s, id).power}/${ch(s, id).toughness}`;
const typesOf = (s: GameState, id: ObjectId): string => [...ch(s, id).types].sort().join(' ');

/** Answer the decisions that come up: costs automatically, targets from the queue, yes/no with `yes`; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...targets];
  const rest = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: queue.shift() ?? [] });
    else if (s.pending.kind === 'yesNo') s = answer(s, rest.length > 0 ? rest.shift()! : { kind: 'yesNo', yes: true });
    else if (rest.length > 0) s = answer(s, rest.shift()!);
    else break;
  }
  return s;
}
/** Both players pass until the stack is empty. */
function resolveAll(s0: GameState, targets: TargetChoice[][] = []): GameState {
  let s = settle(s0, targets);
  for (let guard = 0; guard < 40; guard++) {
    if (s.zones.stack.length === 0 && s.pending?.kind === 'priority') return s;
    s = settle(s.pending?.kind === 'priority' ? pass(s) : s, targets);
  }
  throw new Error(`the stack did not empty: ${JSON.stringify(s.pending)}`);
}
const activate = (s0: GameState, name: string, targets: TargetChoice[][] = []): GameState => {
  const id = find(s0, name, 'battlefield');
  const la = legal(s0, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no activation of ${name}`);
  return resolveAll(settle(act(s0, la.action), targets.slice(0, 1)), targets.slice(1));
};
const cast = (s0: GameState, name: string, targets: TargetChoice[][] = []): GameState =>
  resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), targets.slice(0, 1)), targets.slice(1));
const nextTurn = (s: GameState): GameState => advanceTo(s, s.turn.number + 1, 'upkeep');

describe('CR 205.1b, 613.1d-f, 613.4b: "Until end of turn, ~ becomes a 2/3 black and red Insect creature with menace. It\'s still a land."', () => {
  const VENTS = card('Test Vents', 'Land', '{T}: Add {B} or {R}.\n{0}: Until end of turn, Test Vents becomes a 2/3 black and red Insect creature with menace. It\'s still a land.');
  it('is automated', () => expect(manualParts(VENTS)).toEqual([]));
  it('it is a Land Creature, black and red, an Insect, 2/3 with menace, and keeps its mana ability', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Vents'] }, defs: [VENTS] });
    const id = find(s0, 'Test Vents', 'battlefield');
    expect(typesOf(s0, id)).toBe('Land');
    const s = activate(s0, 'Test Vents');
    expect(typesOf(s, id)).toBe('Creature Land');
    expect(ch(s, id).subtypes).toEqual(['Insect']);
    expect([...ch(s, id).colors].sort()).toEqual(['B', 'R']);
    expect(pt(s, id)).toBe('2/3');
    expect(has(s, id, 'menace')).toBe(true);
    expect(legal(s, 'p1', 'activate').some((a) => a.object === id && a.isMana)).toBe(true);
  });
  it('CR 514.2: at the next turn it is a colorless land again', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Vents'] }, defs: [VENTS] });
    const id = find(s0, 'Test Vents', 'battlefield');
    const s = nextTurn(activate(s0, 'Test Vents'));
    expect(typesOf(s, id)).toBe('Land');
    expect(ch(s, id).subtypes).toEqual([]);
    expect(ch(s, id).colors).toEqual([]);
    expect(has(s, id, 'menace')).toBe(false);
  });
});

describe('CR 613.1f: "... creature with \\"During your turn, this creature has first strike.\\"" (a quoted ability, duration first)', () => {
  const SPIRE = card('Test Spire', 'Land', '{0}: Until end of turn, Test Spire becomes a 2/1 blue and red Elemental creature with "During your turn, this creature has first strike." It\'s still a land.');
  it('is automated; on its controller\'s turn it has first strike, 2/1 blue and red', () => {
    expect(manualParts(SPIRE)).toEqual([]);
    const s0 = scenario([], { p1: { battlefield: ['Test Spire'] }, defs: [SPIRE] });
    const id = find(s0, 'Test Spire', 'battlefield');
    const s = activate(s0, 'Test Spire');
    expect(typesOf(s, id)).toBe('Creature Land');
    expect([...ch(s, id).colors].sort()).toEqual(['R', 'U']);
    expect(pt(s, id)).toBe('2/1');
    expect(has(s, id, 'first strike')).toBe(true);
  });
});

describe('CR 205.1b, 205.3d: "~ becomes a 3/3 Elemental creature until end of turn. It\'s still a Cave land." (the land keeps its land type)', () => {
  const MAW = card('Test Maw', 'Land — Cave', '{0}: Test Maw becomes a 3/3 Elemental creature until end of turn. It\'s still a Cave land.');
  it('is automated; it is a Cave and an Elemental, a Land Creature, 3/3', () => {
    expect(manualParts(MAW)).toEqual([]);
    const s0 = scenario([], { p1: { battlefield: ['Test Maw'] }, defs: [MAW] });
    const id = find(s0, 'Test Maw', 'battlefield');
    const s = activate(s0, 'Test Maw');
    expect(typesOf(s, id)).toBe('Creature Land');
    expect([...ch(s, id).subtypes].sort()).toEqual(['Cave', 'Elemental']);
    expect(pt(s, id)).toBe('3/3');
  });
  it('CR 514.2: after the turn it is a Land — Cave only', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Maw'] }, defs: [MAW] });
    const id = find(s0, 'Test Maw', 'battlefield');
    const s = nextTurn(activate(s0, 'Test Maw'));
    expect(typesOf(s, id)).toBe('Land');
    expect(ch(s, id).subtypes).toEqual(['Cave']);
  });
});

describe('CR 702.73a, 611.2a: "~ becomes a 3/3 creature with vigilance and all creature types. It\'s still a land." (no duration: for good)', () => {
  const SANCTUARY = card('Test Sanctuary', 'Land', '{0}: Test Sanctuary becomes a 3/3 creature with vigilance and all creature types. It\'s still a land.');
  it('is automated; it keeps being a 3/3 Land Creature with vigilance and every creature type after the turn ends', () => {
    expect(manualParts(SANCTUARY)).toEqual([]);
    const s0 = scenario([], { p1: { battlefield: ['Test Sanctuary'] }, defs: [SANCTUARY] });
    const id = find(s0, 'Test Sanctuary', 'battlefield');
    let s = activate(s0, 'Test Sanctuary');
    expect(typesOf(s, id)).toBe('Creature Land');
    expect(ch(s, id).subtypes).toEqual(expect.arrayContaining(['Elf', 'Goblin', 'Human', 'Wizard']));
    expect(pt(s, id)).toBe('3/3');
    expect(has(s, id, 'vigilance')).toBe(true);
    s = nextTurn(s);
    expect(typesOf(s, id)).toBe('Creature Land');
    expect(ch(s, id).subtypes).toContain('Goblin');
  });
});

describe('CR 205.1b: "~ becomes a 7/7 Beast creature in addition to its other types." (adds, never sets)', () => {
  const SHOOP = card('Test Shoop', 'Enchantment', '{0}: Test Shoop becomes a 7/7 Beast creature in addition to its other types.');
  const BARK = card('Test Bark', 'Enchantment', '{0}: Test Bark becomes a 4/4 Treefolk creature with reach in addition to its other types.');
  it('is automated; an Enchantment Creature, Beast, 7/7, for good', () => {
    expect(manualParts(SHOOP)).toEqual([]);
    const s0 = scenario([], { p1: { battlefield: ['Test Shoop'] }, defs: [SHOOP] });
    const id = find(s0, 'Test Shoop', 'battlefield');
    let s = activate(s0, 'Test Shoop');
    expect(typesOf(s, id)).toBe('Creature Enchantment');
    expect(ch(s, id).subtypes).toEqual(['Beast']);
    expect(pt(s, id)).toBe('7/7');
    s = nextTurn(s);
    expect(typesOf(s, id)).toBe('Creature Enchantment');
  });
  it('with keywords: reach and a 4/4 Treefolk', () => {
    expect(manualParts(BARK)).toEqual([]);
    const s0 = scenario([], { p1: { battlefield: ['Test Bark'] }, defs: [BARK] });
    const id = find(s0, 'Test Bark', 'battlefield');
    const s = activate(s0, 'Test Bark');
    expect(typesOf(s, id)).toBe('Creature Enchantment');
    expect(pt(s, id)).toBe('4/4');
    expect(has(s, id, 'reach')).toBe(true);
  });
});

describe('CR 205.1b, 301.7b, 613.4b: "Until end of turn, target artifact or creature becomes an artifact creature with base power and toughness 4/5."', () => {
  const PROTOCOL = card('Test Protocol', 'Instant', 'Until end of turn, target artifact or creature becomes an artifact creature with base power and toughness 4/5.\nDraw a card.');
  const ROCK = card('Test Rock', 'Artifact', '');
  it('is automated; a noncreature artifact becomes a 4/5 artifact creature until end of turn', () => {
    expect(manualParts(PROTOCOL)).toEqual([]);
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Test Protocol'], battlefield: ['Test Rock'] }, defs: [PROTOCOL, ROCK] });
    const rock = find(s0, 'Test Rock', 'battlefield');
    let s = cast(s0, 'Test Protocol', [[obj(rock)]]);
    expect(typesOf(s, rock)).toBe('Artifact Creature');
    expect(pt(s, rock)).toBe('4/5');
    s = nextTurn(s);
    expect(typesOf(s, rock)).toBe('Artifact');
  });
  it('a creature keeps being a creature and becomes an artifact too, with base 4/5 (a +1/+1 counter still adds, CR 613.4c)', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Test Protocol'], battlefield: [{ name: 'Grizzly Bears', counters: { '+1/+1': 1 } }] }, defs: [PROTOCOL] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = cast(s0, 'Test Protocol', [[obj(bears)]]);
    expect(typesOf(s, bears)).toBe('Artifact Creature');
    expect(pt(s, bears)).toBe('5/6');
  });
});

describe('CR 301.7b, 611.2a: "~ becomes an artifact creature." (an exhaust Vehicle: for good) and "Until end of turn, ~ becomes an artifact creature and gains flying."', () => {
  const CRUISER = card('Test Cruiser', 'Artifact — Vehicle', '{0}: Test Cruiser becomes an artifact creature.', ['4', '4']);
  const GLIDER = card('Test Glider', 'Artifact — Vehicle', '{0}: Until end of turn, Test Glider becomes an artifact creature and gains flying.', ['2', '3']);
  it('the first stays an artifact creature after the turn', () => {
    expect(manualParts(CRUISER)).toEqual([]);
    const s0 = scenario([], { p1: { battlefield: ['Test Cruiser'] }, defs: [CRUISER] });
    const id = find(s0, 'Test Cruiser', 'battlefield');
    let s = activate(s0, 'Test Cruiser');
    expect(typesOf(s, id)).toBe('Artifact Creature');
    expect(ch(s, id).subtypes).toEqual(['Vehicle']);
    s = nextTurn(s);
    expect(typesOf(s, id)).toBe('Artifact Creature');
  });
  it('the second is a flying artifact creature until end of turn only', () => {
    expect(manualParts(GLIDER)).toEqual([]);
    const s0 = scenario([], { p1: { battlefield: ['Test Glider'] }, defs: [GLIDER] });
    const id = find(s0, 'Test Glider', 'battlefield');
    let s = activate(s0, 'Test Glider');
    expect(typesOf(s, id)).toBe('Artifact Creature');
    expect(has(s, id, 'flying')).toBe(true);
    s = nextTurn(s);
    expect(typesOf(s, id)).toBe('Artifact');
    expect(has(s, id, 'flying')).toBe(false);
  });
});

describe('CR 205.3, 613.4b, 613.1f: "Until end of turn, ~ becomes a Dinosaur Hero with base power and toughness 3/5 and gains reach and vigilance."', () => {
  const REPTIL = card('Test Reptil', 'Legendary Creature — Human Hero', '{0}: Until end of turn, Test Reptil becomes a Dinosaur Hero with base power and toughness 3/5 and gains reach and vigilance.', ['1', '2']);
  it('is automated; the creature types are replaced, the base power and toughness set, the keywords granted, until end of turn', () => {
    expect(manualParts(REPTIL)).toEqual([]);
    const s0 = scenario([], { p1: { battlefield: ['Test Reptil'] }, defs: [REPTIL] });
    const id = find(s0, 'Test Reptil', 'battlefield');
    let s = activate(s0, 'Test Reptil');
    expect([...ch(s, id).subtypes].sort()).toEqual(['Dinosaur', 'Hero']);
    expect(pt(s, id)).toBe('3/5');
    expect(has(s, id, 'reach') && has(s, id, 'vigilance')).toBe(true);
    s = nextTurn(s);
    expect([...ch(s, id).subtypes].sort()).toEqual(['Hero', 'Human']);
    expect(pt(s, id)).toBe('1/2');
  });
  it('without a duration it lasts for good (Tenth District Hero\'s first ability)', () => {
    const DETECTIVE = card('Test Detective', 'Creature — Human', '{0}: Test Detective becomes a Human Detective with base power and toughness 4/4 and gains vigilance.', ['2', '3']);
    expect(manualParts(DETECTIVE)).toEqual([]);
    const s0 = scenario([], { p1: { battlefield: ['Test Detective'] }, defs: [DETECTIVE] });
    const id = find(s0, 'Test Detective', 'battlefield');
    const s = nextTurn(activate(s0, 'Test Detective'));
    expect([...ch(s, id).subtypes].sort()).toEqual(['Detective', 'Human']);
    expect(pt(s, id)).toBe('4/4');
    expect(has(s, id, 'vigilance')).toBe(true);
  });
});

describe('CR 205.1b: "Until end of turn, target land you control becomes a 4/4 Dinosaur creature with reach and haste. It\'s still a land."', () => {
  const SLUMBER = card('Test Slumber', 'Instant', 'Until end of turn, target land you control becomes a 4/4 Dinosaur creature with reach and haste. It\'s still a land.');
  it('is automated; the targeted land is a 4/4 Dinosaur Land Creature with reach and haste', () => {
    expect(manualParts(SLUMBER)).toEqual([]);
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Slumber'], battlefield: ['Forest'] }, defs: [SLUMBER] });
    const forest = find(s0, 'Forest', 'battlefield');
    const s = cast(s0, 'Test Slumber', [[obj(forest)]]);
    expect(typesOf(s, forest)).toBe('Creature Land');
    expect([...ch(s, forest).subtypes].sort()).toEqual(['Dinosaur', 'Forest']);
    expect(pt(s, forest)).toBe('4/4');
    expect(has(s, forest, 'reach') && has(s, forest, 'haste')).toBe(true);
  });
});

describe('CR 608.2d, 205.1b: "Put two +1/+1 counters on ~. Then you may have it become a 0/0 Elemental creature until end of turn. It\'s still a land."', () => {
  const BARRENS = card('Test Barrens', 'Land', '{0}: Put two +1/+1 counters on Test Barrens. Then you may have it become a 0/0 Elemental creature until end of turn. It\'s still a land.');
  const drive = (yes: boolean): { s: GameState; id: ObjectId } => {
    const s0 = scenario([], { p1: { battlefield: ['Test Barrens'] }, defs: [BARRENS] });
    const id = find(s0, 'Test Barrens', 'battlefield');
    const la = legal(s0, 'p1', 'activate').find((a) => a.object === id && !a.isMana)!;
    let s = settle(act(s0, la.action));
    s = settle(pass(pass(s)), [], [{ kind: 'yesNo', yes }]);
    return { s: resolveAll(s), id };
  };
  it('is automated', () => expect(manualParts(BARRENS)).toEqual([]));
  it('yes: a 2/2 Elemental land creature until end of turn (the counters make it 2/2)', () => {
    const { s, id } = drive(true);
    expect(typesOf(s, id)).toBe('Creature Land');
    expect(ch(s, id).subtypes).toEqual(['Elemental']);
    expect(pt(s, id)).toBe('2/2');
  });
  it('no: it stays a land with the two counters', () => {
    const { s, id } = drive(false);
    expect(typesOf(s, id)).toBe('Land');
    expect(s.objects[id]!.counters['+1/+1']).toBe(2);
  });
});

describe('CR 205.1b, 608.2c: "Put three +1/+1 counters on up to one target land you control. That land becomes a 0/0 Elemental creature in addition to its other types. It gains haste until your next turn."', () => {
  const SURVIVOR = card('Test Survivor', 'Sorcery', 'Put three +1/+1 counters on up to one target land you control. That land becomes a 0/0 Elemental creature in addition to its other types. It gains haste until your next turn.');
  it('is automated; the targeted land is a 3/3 Elemental land creature with haste, and it is one for good', () => {
    expect(manualParts(SURVIVOR)).toEqual([]);
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Survivor'], battlefield: ['Forest'] }, defs: [SURVIVOR] });
    const forest = find(s0, 'Forest', 'battlefield');
    let s = cast(s0, 'Test Survivor', [[obj(forest)]]);
    expect(typesOf(s, forest)).toBe('Creature Land');
    expect([...ch(s, forest).subtypes].sort()).toEqual(['Elemental', 'Forest']);
    expect(pt(s, forest)).toBe('3/3');
    expect(has(s, forest, 'haste')).toBe(true);
    s = nextTurn(s);
    expect(typesOf(s, forest)).toBe('Creature Land');
    expect(pt(s, forest)).toBe('3/3');
  });
});

describe('CR 608.2c, 400.7, 301.7b: "Return target artifact card from your graveyard to the battlefield. If it\'s a Vehicle, it becomes an artifact creature."', () => {
  const TUNE = card('Test Tune', 'Sorcery', 'Return target artifact card from your graveyard to the battlefield. If it\'s a Vehicle, it becomes an artifact creature.');
  const CART = card('Test Cart', 'Artifact — Vehicle', '', ['3', '3']);
  const ROCK = card('Test Rock', 'Artifact', '');
  it('is automated; a returned Vehicle is an artifact creature for good, a returned Rock is not', () => {
    expect(manualParts(TUNE)).toEqual([]);
    for (const [name, expected] of [['Test Cart', 'Artifact Creature'], ['Test Rock', 'Artifact']] as const) {
      const s0 = scenario([], { p1: { hand: ['Test Tune'], graveyard: [name] }, defs: [TUNE, CART, ROCK] });
      const s = nextTurn(cast(s0, 'Test Tune', [[obj(find(s0, name, 'graveyard', 'p1'))]]));
      expect(typesOf(s, find(s, name, 'battlefield')), name).toBe(expected);
    }
  });
});

describe('CR 608.2c, 205.1b: "Put three +1/+1 counters on up to one other target artifact or creature you control. If it isn\'t a creature, it becomes a 0/0 Mutant creature in addition to its other types."', () => {
  const GROW = card('Test Grow', 'Sorcery', 'Put three +1/+1 counters on up to one target artifact or creature you control. If it isn\'t a creature, it becomes a 0/0 Mutant creature in addition to its other types.');
  const ROCK = card('Test Rock', 'Artifact', '');
  it('is automated', () => expect(manualParts(GROW)).toEqual([]));
  it('an artifact that is no creature becomes a 3/3 Mutant artifact creature', () => {
    const s0 = scenario([], { p1: { hand: ['Test Grow'], battlefield: ['Test Rock'] }, defs: [GROW, ROCK] });
    const rock = find(s0, 'Test Rock', 'battlefield');
    const s = cast(s0, 'Test Grow', [[obj(rock)]]);
    expect(typesOf(s, rock)).toBe('Artifact Creature');
    expect(ch(s, rock).subtypes).toEqual(['Mutant']);
    expect(pt(s, rock)).toBe('3/3');
  });
  it('a creature just gets the counters (the "if" is false) and gains no creature type', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Test Grow'], battlefield: ['Grizzly Bears'] }, defs: [GROW] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = cast(s0, 'Test Grow', [[obj(bears)]]);
    expect(pt(s, bears)).toBe('5/5');
    expect(ch(s, bears).subtypes).toEqual(['Bear']);
  });
});

describe('CR 109.2, 115.3, 613.1d: a manland\'s "other creatures you control" excludes the land itself (it is a creature when it attacks)', () => {
  const PRAIRIE = card('Test Prairie', 'Land', '{0}: Test Prairie becomes a 3/3 green and white Llama creature until end of turn. It\'s still a land.\nWhenever Test Prairie attacks, other creatures you control get +1/+1 until end of turn.');
  it('is automated; the other attacker gets +1/+1 and the land itself does not', () => {
    expect(manualParts(PRAIRIE)).toEqual([]);
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Test Prairie', 'Grizzly Bears'] }, defs: [PRAIRIE] });
    const land = find(s0, 'Test Prairie', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = activate(s0, 'Test Prairie');
    s = declareAttackers(toDeclareAttackers(s), [[land], [bears]]);
    s = resolveAll(passUntil(s, (x) => x.zones.stack.length > 0 || x.pending?.kind === 'declareBlockers', 'the attack trigger'));
    expect(pt(s, land)).toBe('3/3');
    expect(pt(s, bears)).toBe('3/3');
  });
});

describe('CR 608.2c, 608.2d: a rider after "you may [create X]" modifies X (lower/riders.ts: through a `may`)', () => {
  const SPAWN = card('Test Spawner', 'Sorcery', 'You may create a 0/1 colorless Eldrazi Spawn creature token. It has "Sacrifice this creature: Add {C}."');
  it('is automated; yes: the token has the mana ability; no: no token', () => {
    expect(manualParts(SPAWN)).toEqual([]);
    for (const yes of [true, false]) {
      const s0 = scenario([], { p1: { hand: ['Test Spawner'] }, defs: [SPAWN] });
      const s = resolveAll(settle(pass(pass(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Spawner', 'hand', 'p1') })))), [], [{ kind: 'yesNo', yes }]));
      const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
      expect(tokens.length).toBe(yes ? 1 : 0);
      if (yes) expect(legal(s, 'p1', 'activate').some((a) => a.object === tokens[0] && a.isMana)).toBe(true);
    }
  });
});

describe('CR 603.10a, 603.4, 205.1a, 400.7: Enduring — "When ~ dies, if it was a creature, return it to the battlefield under its owner\'s control. It\'s an enchantment."', () => {
  const ENDURING = card('Test Enduring', 'Enchantment Creature — Dog Glimmer', 'Whenever another creature enters, you gain 1 life.\nWhen Test Enduring dies, if it was a creature, return it to the battlefield under its owner\'s control. It\'s an enchantment. (It\'s not a creature.)', ['3', '3']);
  const SMITE = card('Test Smite', 'Instant', 'Destroy target permanent.');
  const lifeOf = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.life;
  it('is automated', () => expect(manualParts(ENDURING)).toEqual([]));
  it('it dies as a creature and comes back as an enchantment that is not a creature (and its creature types are gone)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Smite'], battlefield: ['Test Enduring'] }, defs: [ENDURING, SMITE] });
    const old = find(s0, 'Test Enduring', 'battlefield');
    const s = cast(s0, 'Test Smite', [[obj(old)]]);
    const back = find(s, 'Test Enduring', 'battlefield');
    expect(back).not.toBe(old);
    expect(typesOf(s, back)).toBe('Enchantment');
    expect(ch(s, back).subtypes).toEqual([]);
    // the old object is the card in the graveyard no more: it returned
    expect(s.zones.graveyard.p1!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Enduring')).toBe(false);
  });
  it('CR 700.4: it does not die as an enchantment, so it stays in the graveyard the second time and the "if it was a creature" check holds nothing back', () => {
    const s0 = scenario([], { p1: { hand: ['Test Smite', 'Test Smite'], battlefield: ['Test Enduring'] }, defs: [ENDURING, SMITE] });
    let s = cast(s0, 'Test Smite', [[obj(find(s0, 'Test Enduring', 'battlefield'))]]);
    const back = find(s, 'Test Enduring', 'battlefield');
    s = cast(s, 'Test Smite', [[obj(back)]]);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Enduring')).toBe(false);
    expect(s.zones.graveyard.p1!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Enduring')).toBe(true);
  });
  it('the returned permanent is no creature when the triggers look: a creature entering later is a creature, the returned enchantment did not gain life for itself', () => {
    const s0 = scenario([], { p1: { hand: ['Test Smite'], battlefield: ['Test Enduring', 'Test Enduring'] }, defs: [ENDURING, SMITE] });
    const first = findFirst(s0);
    const s = cast(s0, 'Test Smite', [[obj(first)]]);
    // the other Enduring permanent (a creature) saw the first one enter only if it entered as a creature: it entered, then was an enchantment before any trigger was collected
    expect(lifeOf(s)).toBe(20);
  });
});

function findFirst(s: GameState): ObjectId {
  return s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Enduring')!;
}

describe('CR 603.4, 603.10a: a noncreature permanent that goes to the graveyard does not satisfy "if it was a creature"', () => {
  const LAMP = card('Test Lamp', 'Artifact', 'When Test Lamp dies, if it was a creature, you gain 3 life.');
  const SMITE = card('Test Smite', 'Instant', 'Destroy target permanent.');
  it('it is no creature (the trigger needs a creature as it last existed): no life', () => {
    expect(manualParts(LAMP)).toEqual([]);
    const s0 = scenario([], { p1: { hand: ['Test Smite'], battlefield: ['Test Lamp'] }, defs: [LAMP, SMITE] });
    const s = cast(s0, 'Test Smite', [[obj(find(s0, 'Test Lamp', 'battlefield'))]]);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(20);
  });
});
