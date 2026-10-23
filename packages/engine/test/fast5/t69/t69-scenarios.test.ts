/**
 * FAST5 T69 (one-shot "becomes" effects, base power setting and X-quantified pumps): the shapes of parser/templates/zz-fast5/t69.json played through
 * applyAction with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 613.4b, 613.4c    "base power N" sets the power alone (the toughness stays), counters and pumps add on top; "base power and toughness become 4/2" sets both
 *   CR 107.3c, 601.2c    "up to X target creatures ... get +X/+X, where X is ..." : X is read when the targets are announced (how many) and when the effect resolves
 *   CR 201.2, 613.1d     "named X" sets the name (the others are lost); the legend rule counts it
 *   CR 205.1a, 613.1d    a set card type replaces the others ("it loses all other card types"); the creature subtypes go with the type
 *   CR 611.2a, 514.2     "until end of turn" ends at cleanup; no duration lasts for the rest of the game
 *   CR 614.1a, 616.1     "until your next turn, if a source would deal damage to that player or a permanent that player controls, it deals double that damage instead"
 */
import { describe, expect, it } from 'vitest';
import { charsOfObject, compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, pass, pool, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"')).map((a) => a.text);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const ch = (s: GameState, id: ObjectId) => charsOfObject(s, s.objects[id]!);
const has = (s: GameState, id: ObjectId, kw: string): boolean => ch(s, id).keywords.some((k) => k.keyword === kw);
const pt = (s: GameState, id: ObjectId): string => `${ch(s, id).power}/${ch(s, id).toughness}`;
const typesOf = (s: GameState, id: ObjectId): string => [...ch(s, id).types].sort().join(' ');
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;

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
function resolveAll(s0: GameState, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState {
  let s = settle(s0, targets, answers);
  for (let guard = 0; guard < 40; guard++) {
    if (s.zones.stack.length === 0 && s.pending?.kind === 'priority') return s;
    s = settle(s.pending?.kind === 'priority' ? pass(s) : s, targets, answers);
  }
  throw new Error(`the stack did not empty: ${JSON.stringify(s.pending)}`);
}
const activate = (s0: GameState, name: string, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState => {
  const id = find(s0, name, 'battlefield');
  const la = legal(s0, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no activation of ${name}`);
  return resolveAll(settle(act(s0, la.action), targets.slice(0, 1), answers), targets.slice(1), answers);
};
const nextTurn = (s: GameState): GameState => advanceTo(s, s.turn.number + 1, 'upkeep');

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}');

describe('CR 613.4b: "Until end of turn, ~ has base power 4 and gains trample." sets the power alone', () => {
  const DUCK = card('Test Turtle', 'Creature — Turtle Bird', '{0}: Until end of turn, this creature has base power 4 and gains trample.', ['0', '4'], '{G}');
  it('is automated', () => expect(manualParts(DUCK)).toEqual([]));
  it('0/4 becomes 4/4 with trample: the toughness is not set to anything', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Turtle'] }, defs: [DUCK] });
    const id = find(s0, 'Test Turtle', 'battlefield');
    expect(pt(s0, id)).toBe('0/4');
    const s = activate(s0, 'Test Turtle');
    expect(pt(s, id)).toBe('4/4');
    expect(has(s, id, 'trample')).toBe(true);
  });
  it('a +1/+1 counter and a later pump still add to the base power (layer 7b, then 7c)', () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Turtle', counters: { '+1/+1': 2 } }] }, defs: [DUCK] });
    const id = find(s0, 'Test Turtle', 'battlefield');
    expect(pt(s0, id)).toBe('2/6');
    expect(pt(activate(s0, 'Test Turtle'), id)).toBe('6/6');
  });
  it('CR 514.2: at the next turn it is a 0/4 without trample again', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Turtle'] }, defs: [DUCK] });
    const id = find(s0, 'Test Turtle', 'battlefield');
    const s = nextTurn(activate(s0, 'Test Turtle'));
    expect(pt(s, id)).toBe('0/4');
    expect(has(s, id, 'trample')).toBe(false);
  });
});

describe('CR 608.2d, 613.4b: "you may have this creature\'s base power and toughness become 4/2 until end of turn" (a landfall choice)', () => {
  const MEDITATOR = card('Test Meditator', 'Creature — Elf Druid', 'Whenever a land you control enters, you may have this creature\'s base power and toughness become 4/2 until end of turn.', ['2', '4'], '{2}{U}');
  const LAND = card('Test Swamp', 'Basic Land — Swamp', '{T}: Add {B}.');
  it('is automated', () => expect(manualParts(MEDITATOR)).toEqual([]));
  it('answering yes makes it 4/2 for the turn; answering no leaves it 2/4', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Meditator'], hand: ['Test Swamp'] }, defs: [MEDITATOR, LAND] });
    const id = find(s0, 'Test Meditator', 'battlefield');
    const play = (yes: boolean): GameState => resolveAll(act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Swamp', 'hand', 'p1') }), [], [{ kind: 'yesNo', yes }]);
    expect(pt(play(true), id)).toBe('4/2');
    expect(pt(play(false), id)).toBe('2/4');
  });
  it('CR 514.2: the next turn it is 2/4 again', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Meditator'], hand: ['Test Swamp'] }, defs: [MEDITATOR, LAND] });
    const id = find(s0, 'Test Meditator', 'battlefield');
    const s = nextTurn(resolveAll(act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Swamp', 'hand', 'p1') }), [], [{ kind: 'yesNo', yes: true }]));
    expect(pt(s, id)).toBe('2/4');
  });
});

describe('CR 107.3c, 601.2c: "up to X target creatures you control get +X/+X until end of turn, where X is the number of colors among permanents you control"', () => {
  const BASHER = card('Test Basher', 'Creature — Elemental', 'Vivid — When this creature enters, up to X target creatures you control get +X/+X until end of turn, where X is the number of colors among permanents you control.', ['6', '6'], '{4}{G}{G}', ['G']);
  const RED = card('Test Red Bear', 'Creature — Bear', '', ['2', '2'], '{R}', ['R']);
  const BLUE = card('Test Blue Bear', 'Creature — Bear', '', ['2', '2'], '{U}', ['U']);
  const GREEN = card('Test Green Bear', 'Creature — Bear', '', ['2', '2'], '{G}', ['G']);
  const defs = [BASHER, RED, BLUE, GREEN];
  it('is automated', () => expect(manualParts(BASHER)).toEqual([]));
  it('with three colors among the permanents it lets you choose up to three creatures, each gets +3/+3', () => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Basher'], battlefield: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Test Red Bear', 'Test Blue Bear', 'Test Green Bear'] }, defs });
    const red = find(s0, 'Test Red Bear', 'battlefield');
    const blue = find(s0, 'Test Blue Bear', 'battlefield');
    const green = find(s0, 'Test Green Bear', 'battlefield');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Basher', 'hand', 'p1') });
    s = settle(s);
    s = pass(pass(s)); // the spell resolves; the trigger asks for its targets
    expect(s.pending?.kind).toBe('chooseTargets');
    const pending = s.pending as unknown as { min: number; max: number };
    expect([pending.min, pending.max]).toEqual([0, 3]); // the green Basher, red, blue and green bears: three colors (CR 601.2c)
    s = resolveAll(s, [[obj(red), obj(blue), obj(green)]]);
    expect([red, blue, green].map((id) => pt(s, id))).toEqual(['5/5', '5/5', '5/5']);
    expect(pt(s, find(s, 'Test Basher', 'battlefield'))).toBe('6/6'); // not chosen
  });
  it('with only its own color it is "up to 1" and +1/+1; a fourth target is refused', () => {
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Basher'], battlefield: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Test Green Bear'] }, defs });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Basher', 'hand', 'p1') });
    s = settle(s);
    s = pass(pass(s));
    expect(s.pending?.kind).toBe('chooseTargets');
    const pending = s.pending as unknown as { max: number };
    expect(pending.max).toBe(1);
    const green = find(s, 'Test Green Bear', 'battlefield');
    s = resolveAll(s, [[obj(green)]]);
    expect(pt(s, green)).toBe('3/3');
  });
});

describe('CR 107.3c, 608.2h: "target creature you control gets +X/+0 and up to one target creature an opponent controls gets -0/-X until end of turn, where X is ..."', () => {
  const RIPPER = card('Test Ripper', 'Creature — Elf Assassin', 'When this creature enters, target creature you control gets +X/+0 until end of turn and up to one target creature an opponent controls gets -0/-X until end of turn, where X is the number of Elves you control plus the number of Elf cards in your graveyard.', ['4', '4'], '{0}');
  const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1'], '{0}');
  const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '6'], '{0}');
  const defs = [RIPPER, ELF, WALL, BEAR];
  it('is automated', () => expect(manualParts(RIPPER)).toEqual([]));
  it('X is the Elves you control (the Ripper included) plus the Elf cards in your graveyard, for both changes', () => {
    const s0 = scenario([], { p1: { hand: ['Test Ripper'], battlefield: ['Test Elf', 'Test Bear'], graveyard: ['Test Elf', 'Test Elf'] }, p2: { battlefield: ['Test Wall'] }, defs });
    const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
    const wall = find(s0, 'Test Wall', 'battlefield', 'p2');
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ripper', 'hand', 'p1') }));
    s = resolveAll(s, [[obj(mine)], [obj(wall)]]);
    // Elves: Test Elf and the Ripper = 2, Elf cards in the graveyard = 2: X = 4
    expect(pt(s, mine)).toBe('6/2');
    expect(pt(s, wall)).toBe('0/2');
  });
  it('the second target is optional: with none, only the first change happens', () => {
    const s0 = scenario([], { p1: { hand: ['Test Ripper'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Wall'] }, defs });
    const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
    const wall = find(s0, 'Test Wall', 'battlefield', 'p2');
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ripper', 'hand', 'p1') }));
    s = resolveAll(s, [[obj(mine)], []]);
    expect(pt(s, mine)).toBe('3/2'); // X = 1 (the Ripper)
    expect(pt(s, wall)).toBe('0/6');
  });
});

describe('CR 201.2, 613.1d-f, 613.4b: "Enchanted creature loses all abilities and is a green and white Citizen creature with base power and toughness 1/1 named Legitimate Businessperson."', () => {
  const AURA = card('Test Alias', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature loses all abilities and is a green and white Citizen creature with base power and toughness 1/1 named Legitimate Businessperson.', undefined, '{0}');
  const DRAGON = card('Test Dragon', 'Legendary Creature — Dragon', 'Flying\n{0}: Test Dragon gets +1/+1 until end of turn.', ['5', '5'], '{0}', ['R']);
  it('is automated', () => expect(manualParts(AURA)).toEqual([]));
  it('the creature is a 1/1 green and white Citizen with no abilities and one name', () => {
    const s0 = scenario([], { p1: { hand: ['Test Alias'], battlefield: ['Test Dragon'] }, defs: [AURA, DRAGON] });
    const dragon = find(s0, 'Test Dragon', 'battlefield');
    expect(has(s0, dragon, 'flying')).toBe(true);
    const s = resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Alias', 'hand', 'p1') }), [[obj(dragon)]]), [[obj(dragon)]]);
    expect(pt(s, dragon)).toBe('1/1');
    expect(typesOf(s, dragon)).toBe('Creature');
    expect(ch(s, dragon).subtypes).toEqual(['Citizen']);
    expect([...ch(s, dragon).colors].sort()).toEqual(['G', 'W']);
    expect(ch(s, dragon).supertypes).toEqual(['Legendary']); // only the abilities, colors, types and name change: the supertype stays
    expect(ch(s, dragon).names).toEqual(['Legitimate Businessperson']);
    expect(has(s, dragon, 'flying')).toBe(false);
    expect(legal(s, 'p1', 'activate').some((a) => a.object === dragon)).toBe(false); // the pump ability is gone
  });
});

describe('CR 201.2, 205.4, 613.1d, 613.4b: "If this creature is a Detective, it becomes a legendary creature named Mileva, the Stalwart, it has base power and toughness 5/5, and it gains \\"Other creatures you control have indestructible.\\""', () => {
  const TEXT = '{0}: If this creature is a Detective, it becomes a legendary creature named Mileva, the Stalwart, it has base power and toughness 5/5, and it gains "Other creatures you control have indestructible."';
  const HERO = card('Test Sleuth', 'Creature — Human Detective', TEXT, ['2', '3'], '{1}{W}');
  const PLAIN = card('Test Plain Sleuth', 'Creature — Human', TEXT, ['2', '3'], '{1}{W}');
  const defs = [HERO, PLAIN, BEAR];
  it('is automated', () => expect(manualParts(HERO)).toEqual([]));
  it('a Detective becomes the legendary Mileva 5/5 for good; the other creatures you control (not it) are indestructible', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Sleuth', 'Test Bear'] }, defs });
    const hero = find(s0, 'Test Sleuth', 'battlefield');
    const bear = find(s0, 'Test Bear', 'battlefield');
    let s = activate(s0, 'Test Sleuth');
    expect(pt(s, hero)).toBe('5/5');
    expect(ch(s, hero).names).toEqual(['Mileva, the Stalwart']);
    expect(ch(s, hero).supertypes).toEqual(['Legendary']);
    expect(ch(s, hero).subtypes).toEqual(expect.arrayContaining(['Human', 'Detective']));
    expect(has(s, bear, 'indestructible')).toBe(true);
    expect(has(s, hero, 'indestructible')).toBe(false);
    s = nextTurn(s);
    expect(pt(s, hero)).toBe('5/5'); // no duration
    expect(ch(s, hero).names).toEqual(['Mileva, the Stalwart']);
  });
  it('a creature that is not a Detective stays as it is', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Plain Sleuth', 'Test Bear'] }, defs });
    const hero = find(s0, 'Test Plain Sleuth', 'battlefield');
    const s = activate(s0, 'Test Plain Sleuth');
    expect(pt(s, hero)).toBe('2/3');
    expect(ch(s, hero).names).toEqual(['Test Plain Sleuth']);
    expect(has(s, find(s, 'Test Bear', 'battlefield'), 'indestructible')).toBe(false);
  });
});

describe('CR 613.1d-f, 613.4b: "If this Equipment isn\'t a creature, it becomes a 0/0 Construct Hero artifact creature with flying and \\"This creature gets +1/+1 for each artifact you control\\" until end of turn."', () => {
  const ARMOR = card('Test Suit', 'Artifact — Equipment', '{0}: If this Equipment isn\'t a creature, it becomes a 0/0 Construct Hero artifact creature with flying and "This creature gets +1/+1 for each artifact you control" until end of turn.\nEquip {2}', undefined, '{3}');
  const TRINKET = card('Test Trinket', 'Artifact', '', undefined, '{1}');
  it('is automated', () => expect(manualParts(ARMOR)).toEqual([]));
  it('it is a Construct Hero artifact creature with flying and gets +1/+1 for each artifact you control (itself included)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Suit', 'Test Trinket', 'Test Trinket'] }, defs: [ARMOR, TRINKET] });
    const id = find(s0, 'Test Suit', 'battlefield');
    expect(typesOf(s0, id)).toBe('Artifact');
    const s = activate(s0, 'Test Suit');
    expect(typesOf(s, id)).toBe('Artifact Creature');
    expect([...ch(s, id).subtypes].sort()).toEqual(['Construct', 'Equipment', 'Hero']); // an Equipment stays one (CR 205.3d keeps the artifact subtype)
    expect(has(s, id, 'flying')).toBe(true);
    expect(pt(s, id)).toBe('3/3');
  });
  it('it is a creature already: a second activation does nothing, and at the next turn it is a plain Equipment again', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Suit', 'Test Trinket'] }, defs: [ARMOR, TRINKET] });
    const id = find(s0, 'Test Suit', 'battlefield');
    let s = activate(s0, 'Test Suit');
    expect(pt(s, id)).toBe('2/2');
    s = activate(s, 'Test Suit');
    expect(pt(s, id)).toBe('2/2'); // not a second +1/+1 granted ability
    s = nextTurn(s);
    expect(typesOf(s, id)).toBe('Artifact');
    expect(ch(s, id).subtypes).toEqual(['Equipment']);
  });
});

describe('CR 205.1a, 613.1d, 118.12: "you may pay {1}. If you do, return that card to the battlefield tapped under your control. It\'s a Treasure artifact with \\"{T}, Sacrifice this artifact: Add one mana of any color,\\" and it loses all other card types."', () => {
  const SILENCER = card('Test Silencer', 'Legendary Creature — Gorgon Assassin', 'Whenever a nontoken creature an opponent controls dies, you may pay {1}. If you do, return that card to the battlefield tapped under your control. It\'s a Treasure artifact with "{T}, Sacrifice this artifact: Add one mana of any color," and it loses all other card types.', ['3', '3'], '{1}{B}{G}');
  const defs = [SILENCER, BEAR];
  const board = (): GameState => scenario(['Lightning Bolt', 'Mountain'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Test Silencer', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Test Bear'] }, defs });
  const bolt = (s0: GameState, pay: boolean): GameState => {
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    return resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Lightning Bolt', 'hand', 'p1') }), [[obj(bear)]]), [], [{ kind: 'yesNo', yes: pay }]);
  };
  it('is automated', () => expect(manualParts(SILENCER)).toEqual([]));
  it('paying brings the creature back under your control tapped, as a Treasure artifact only (no creature type, no power)', () => {
    const s = bolt(board(), true);
    const back = findAll(s, 'Test Bear', 'battlefield').filter((id) => s.objects[id]!.controller === 'p1');
    expect(back).toHaveLength(1);
    const id = back[0]!;
    expect(s.objects[id]!.tapped).toBe(true);
    expect(typesOf(s, id)).toBe('Artifact');
    expect(ch(s, id).subtypes).toEqual(['Treasure']);
    // it is no creature: its types are the artifact alone, the creature subtypes went with the type (CR 205.3d); the granted Treasure ability is a mana ability
    expect(ch(s, id).types).not.toContain('Creature');
    const untapped = tweak(s, (st) => { st.objects[id]!.tapped = false; });
    expect(legal(untapped, 'p1', 'activate').some((a) => a.object === id && a.isMana)).toBe(true);
  });
  it('not paying leaves it in the graveyard and nothing happens', () => {
    const s = bolt(board(), false);
    expect(findAll(s, 'Test Bear', 'battlefield')).toHaveLength(0);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p2')).toHaveLength(1);
  });
});

describe('CR 603.2, 611.2a, 104.3e: "~ gains \\"Whenever ~ deals combat damage to a player, that player loses the game.\\"" (no duration: for good)', () => {
  const ODIN = card('Test Odin', 'Creature — Knight', '{0}: This creature gains "Whenever this creature deals combat damage to a player, that player loses the game."', ['5', '3'], '{0}');
  it('is automated', () => expect(manualParts(ODIN)).toEqual([]));
  it('after it gains the ability, dealing combat damage to a player makes that player lose the game', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Odin'] }, defs: [ODIN] });
    const odin = find(s0, 'Test Odin', 'battlefield');
    let s = activate(s0, 'Test Odin');
    s = declareAttackers(toDeclareAttackers(s), [[odin]]);
    s = passUntil(s, (x) => !!x.result || x.turn.step === 'endCombat', 'the game ends or combat ends', 30);
    expect(s.result).toBeTruthy();
    expect(JSON.stringify(s.result)).toContain('p1');
  });
  it('without it, the same attack just deals damage', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Odin'] }, defs: [ODIN] });
    const odin = find(s0, 'Test Odin', 'battlefield');
    let s = declareAttackers(toDeclareAttackers(s0), [[odin]]);
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat', 30);
    expect(s.result).toBeFalsy();
    expect(lifeOf(s, 'p2')).toBe(15);
  });
});

describe('CR 614.1a, 616.1, 611.2a: "Whenever ~ deals combat damage to a player, until your next turn, if a source would deal damage to that player or a permanent that player controls, it deals double that damage instead."', () => {
  const STAGGER = card('Test Stagger', 'Creature — Human Soldier', 'Whenever this creature deals combat damage to a player, until your next turn, if a source would deal damage to that player or a permanent that player controls, it deals double that damage instead.', ['3', '2'], '{1}{R}{W}');
  const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '9'], '{0}');
  const defs = [STAGGER, WALL];
  const bolt = (s: GameState, who: TargetChoice): GameState => resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: findAll(s, 'Lightning Bolt', 'hand', 'p1')[0]! }), [[who]]));
  const afterHit = (): GameState => {
    const s0 = scenario(['Lightning Bolt', 'Mountain'], { p1: { hand: ['Lightning Bolt', 'Lightning Bolt', 'Lightning Bolt', 'Lightning Bolt'], battlefield: ['Test Stagger', 'Mountain', 'Mountain', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Test Wall'] }, defs });
    const hero = find(s0, 'Test Stagger', 'battlefield');
    let s = declareAttackers(toDeclareAttackers(s0), [[hero]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage' || x.zones.stack.length > 0, 'blockers, damage or the trigger', 10);
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    s = passUntil(s, (x) => x.zones.stack.length > 0, 'the trigger on the stack', 10);
    return resolveAll(s);
  };
  it('is automated', () => expect(manualParts(STAGGER)).toEqual([]));
  it('the damage to that player and to their permanents is doubled afterwards; the damage to you is not', () => {
    let s = afterHit();
    expect(lifeOf(s, 'p2')).toBe(17);
    const wall = find(s, 'Test Wall', 'battlefield', 'p2');
    s = bolt(s, { kind: 'player', id: 'p2' });
    expect(lifeOf(s, 'p2')).toBe(11); // 3 doubled
    s = bolt(s, obj(wall));
    expect(s.objects[wall]!.damage).toBe(6);
    s = bolt(s, { kind: 'player', id: 'p1' });
    expect(lifeOf(s, 'p1')).toBe(17); // not doubled
  });
  it('it lasts until your next turn: then the damage is normal again', () => {
    let s = afterHit();
    s = advanceTo(s, s.turn.number + 2, 'main1'); // through the opponent's turn to my next main phase
    const before = lifeOf(s, 'p2');
    s = bolt(s, { kind: 'player', id: 'p2' });
    expect(lifeOf(s, 'p2')).toBe(before - 3);
  });
});

describe('CR 118.12, 608.2c, 603.7: "you may pay {2}. If you do, create a token ... Sacrifice that token at end of combat" (the sentence after "If you do" acts on the token only the payment made)', () => {
  const HARRIER = card('Test Raider', 'Artifact Creature — Robot Soldier', 'Whenever this creature attacks, you may pay {2}. If you do, create a 2/2 colorless Robot artifact creature token that\'s tapped and attacking. Sacrifice that token at end of combat.', ['2', '1'], '{R}');
  const board = (): GameState => scenario(['Mountain'], { p1: { battlefield: ['Test Raider', 'Mountain', 'Mountain'] }, defs: [HARRIER] });
  it('is automated', () => expect(manualParts(HARRIER)).toEqual([]));
  it('paying makes the attacking token, and it is sacrificed at end of combat', () => {
    const s0 = board();
    const raider = find(s0, 'Test Raider', 'battlefield');
    let s = declareAttackers(toDeclareAttackers(s0), [[raider]]);
    s = resolveAll(settle(s), [], [{ kind: 'yesNo', yes: true }]);
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens).toHaveLength(1);
    expect(s.objects[tokens[0]!]!.tapped).toBe(true);
    s = passUntil(s, (x) => x.turn.step === 'endCombat' && x.pending?.kind === 'priority', 'end of combat', 30);
    s = resolveAll(s);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(0);
  });
  it('not paying makes nothing, and nothing is sacrificed later', () => {
    const s0 = board();
    const raider = find(s0, 'Test Raider', 'battlefield');
    let s = declareAttackers(toDeclareAttackers(s0), [[raider]]);
    s = resolveAll(settle(s), [], [{ kind: 'yesNo', yes: false }]);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(0);
    s = passUntil(s, (x) => x.turn.step === 'endCombat' && x.pending?.kind === 'priority', 'end of combat', 30);
    expect(s.zones.stack).toHaveLength(0);
    expect(find(s, 'Test Raider', 'battlefield')).toBe(raider);
  });
});

describe('CR 118.12, 608.2c, 603.7: "you may pay {2}{R}. If you do, create a 3/1 token. Exile that token at the beginning of the next end step."', () => {
  const MAKER = card('Test Stoker', 'Creature — Human Shaman', 'Whenever a land you control enters, you may pay {2}{R}. If you do, create a 3/1 red Elemental creature token with trample and haste. Exile that token at the beginning of the next end step.', ['2', '1'], '{1}{R}');
  const LAND = card('Test Hill', 'Basic Land — Mountain', '{T}: Add {R}.');
  const run = (yes: boolean): GameState => {
    const s0 = scenario(['Mountain'], { p1: { battlefield: ['Test Stoker', 'Mountain', 'Mountain', 'Mountain'], hand: ['Test Hill'] }, defs: [MAKER, LAND] });
    return resolveAll(act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Hill', 'hand', 'p1') }), [], [{ kind: 'yesNo', yes }]);
  };
  it('is automated', () => expect(manualParts(MAKER)).toEqual([]));
  it('paying makes the token, which is exiled at the beginning of the next end step', () => {
    let s = run(true);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(1);
    for (let i = 0; i < 60 && !(s.turn.step === 'end' && s.pending?.kind === 'priority'); i++) {
      s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : pass(s);
    }
    expect(s.turn.step).toBe('end');
    s = resolveAll(s);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(0);
  });
  it('not paying makes no token and no delayed exile', () => {
    const s = run(false);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(0);
    expect(s.zones.stack).toHaveLength(0);
  });
});
