/**
 * CLOUD std-otj (Outlaws of Thunder Junction backlog, tuning half): the shapes of parser/templates/zz-cloud/std-otj.json and the parser/renderer readings they needed,
 * played through the engine with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 613.4c, 611.2a      "It gets an additional -1/-1 until end of turn for each Desert you control": the first change and the scaled one are both in layer 7c
 *   CR 701.23a, 701.24a    "Search your library for a card, then shuffle and put that card on top" (CR 401.2: the top of a shuffled library is the found card)
 *   CR 107.1a, 701.21a     "Target opponent sacrifices half the creatures they control of their choice, rounded up" / "discards half the cards in their hand, rounded up"
 *   CR 613.4c, 608.2h      "Until end of turn, up to one target creature gets +2/+2 for each Treasure you control" counts the Treasure just created
 *   CR 601.2i, 608.2h      "2 plus the number of other spells you've cast this turn" does not count the spell that is resolving
 *   CR 208.1, 608.2b       "Destroy target creature if no other creature has greater power"
 *   CR 115.1, 601.2c       "Any number of target players each discard a card" (from none to all of them)
 *   CR 608.2c, 614.15      "Return it to your hand. Return it to the battlefield instead if you control a Mount."
 *   CR 608.2c, 608.2d      "If a permanent was returned this way, ..."; "Put a land card from among the milled cards into your hand. If you can't, ..."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, battlefieldNames, find, findAll, life, pass, scenario, zoneNames } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: PlayerId): TargetChoice => ({ kind: 'player', id });

function settle(s0: GameState, targets: TargetChoice[] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Cast the named spell from p1's hand at the given targets and let it resolve (the game stops at the first decision of the spell). */
function castAt(s0: GameState, name: string, targets: TargetChoice[] = [], answers: DecisionAnswer[] = []): GameState {
  const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), targets);
  return settle(pass(pass(s)), [], answers);
}
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;
const pt = (s: GameState, id: ObjectId): [number, number] => [Number(chars(s, id).power), Number(chars(s, id).toughness)];
const onBf = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name);
const options = (s: GameState): ObjectId[] => (s.pending?.kind === 'chooseObjects' ? [...s.pending.options] : []);
const pick = (s: GameState, ...names: string[]): DecisionAnswer => ({
  kind: 'chooseObjects',
  ids: names.map((n) => {
    const id = options(s).find((o) => s.objects[o]!.defId === n);
    if (id === undefined) throw new Error(`${n} is not offered`);
    return id;
  }),
});
/** Treasure tokens p1 controls (a token's defId starts with token:<name>). */
const treasures = (s: GameState): number => battlefieldNames(s, 'p1').filter((n) => n.startsWith('token:Treasure')).length;
const counters = (s: GameState, id: ObjectId): Record<string, number> => (s.objects[id]!.counters ?? {}) as Record<string, number>;

const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['4', '4']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const IMP = card('Test Imp', 'Creature — Imp', '', ['1', '1']);
const DESERT = card('Test Desert', 'Land — Desert', '');
const TREASURE_ROCK = card('Test Gem', 'Artifact — Treasure', '');
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');

describe('CR 613.4c: "Target creature gets -2/-2 until end of turn. It gets an additional -1/-1 until end of turn for each Desert you control."', () => {
  const DUE = card('Test Due', 'Instant', 'Target creature gets -2/-2 until end of turn. It gets an additional -1/-1 until end of turn for each Desert you control.');
  const game = (deserts: number): GameState => scenario([], { p1: { hand: ['Test Due'], battlefield: ['Test Ogre', ...Array<string>(deserts).fill('Test Desert')] }, defs: [DUE, OGRE, DESERT] });
  it('is automated', () => expect(full(DUE)).toBe(true));
  it('without a Desert the creature gets only -2/-2', () => {
    const s0 = game(0);
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p1');
    expect(pt(castAt(s0, 'Test Due', [obj(ogre)]), ogre)).toEqual([2, 2]);
  });
  it('with two Deserts it gets -4/-4 in all: a 4/4 dies', () => {
    const s0 = game(2);
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p1');
    const s = castAt(s0, 'Test Due', [obj(ogre)]);
    expect(onBf(s, 'Test Ogre')).toEqual([]);
  });
  it('with one Desert it is a 1/1', () => {
    const s0 = game(1);
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p1');
    expect(pt(castAt(s0, 'Test Due', [obj(ogre)]), ogre)).toEqual([1, 1]);
  });
});

describe('CR 701.23a, 701.24a, 401.2: "Search your library for a card, then shuffle and put that card on top."', () => {
  const TUTOR = card('Test Tutor', 'Sorcery', 'Search your library for a card, then shuffle and put that card on top.');
  const ROCK = card('Test Rock', 'Artifact', '');
  it('is automated', () => {
    expect(full(TUTOR)).toBe(true);
  });
  it('the chosen card, whatever it is, ends up on top of the shuffled library', () => {
    const s0 = scenario([], { p1: { hand: ['Test Tutor'], library: ['Test Bear', 'Test Ogre', 'Test Imp', 'Test Rock'] }, defs: [TUTOR, BEAR, OGRE, IMP, ROCK] });
    let s = castAt(s0, 'Test Tutor');
    expect(s.pending?.kind).toBe('chooseObjects');
    s = settle(answer(s, pick(s, 'Test Imp')));
    const lib = s.zones.library['p1']!;
    expect(s.objects[lib[0]!]!.defId).toBe('Test Imp');
    expect(lib.length).toBe(s0.zones.library['p1']!.length);
  });
});

describe('CR 107.1a, 701.21a, 701.9a: "Target opponent sacrifices half the creatures they control of their choice, rounded up." and "... discards half the cards in their hand, rounded up."', () => {
  const EDICT = card('Test Edict', 'Sorcery', 'Target opponent sacrifices half the creatures they control of their choice, rounded up.');
  const EDICT_DOWN = card('Test Edict Down', 'Sorcery', 'Target opponent sacrifices half the creatures they control of their choice, rounded down.');
  const WASTE = card('Test Waste', 'Sorcery', 'Target opponent discards half the cards in their hand, rounded up.');
  it('are automated', () => {
    for (const d of [EDICT, EDICT_DOWN, WASTE]) expect(full(d), d.name).toBe(true);
  });
  it('three creatures: rounded up two are sacrificed, rounded down one; the opponent picks which', () => {
    const mk = (name: string): GameState => scenario([], { p1: { hand: [name] }, p2: { battlefield: ['Test Bear', 'Test Ogre', 'Test Imp'] }, defs: [EDICT, EDICT_DOWN, BEAR, OGRE, IMP] });
    const s0 = mk('Test Edict');
    let s = castAt(s0, 'Test Edict', [plr('p2')]);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(s.pending && 'player' in s.pending ? s.pending.player : null).toBe('p2');
    s = settle(answer(s, pick(s, 'Test Imp', 'Test Bear')));
    expect(battlefieldNames(s, 'p2')).toEqual(['Test Ogre']);
    const d0 = mk('Test Edict Down');
    let d = castAt(d0, 'Test Edict Down', [plr('p2')]);
    d = settle(answer(d, pick(d, 'Test Ogre')));
    expect(battlefieldNames(d, 'p2').sort()).toEqual(['Test Bear', 'Test Imp']);
  });
  it('rounded down: three cards in hand, one is discarded', () => {
    const WASTE_DOWN = card('Test Waste Down', 'Sorcery', 'Target opponent discards half the cards in their hand, rounded down.');
    expect(full(WASTE_DOWN)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Waste Down'] }, p2: { hand: ['Test Bear', 'Test Ogre', 'Test Imp'] }, defs: [WASTE_DOWN, BEAR, OGRE, IMP] });
    let s = castAt(s0, 'Test Waste Down', [plr('p2')]);
    expect(s.pending?.kind).toBe('chooseObjects');
    s = settle(answer(s, { kind: 'chooseObjects', ids: options(s).slice(0, 1) }));
    expect(zoneNames(s, 'hand', 'p2').length).toBe(2);
  });
  it('an opponent with no creatures sacrifices nothing', () => {
    const s = castAt(scenario([], { p1: { hand: ['Test Edict'] }, defs: [EDICT] }), 'Test Edict', [plr('p2')]);
    expect(s.pending?.kind).toBe('priority');
  });
  it('five cards in hand: three are discarded (rounded up)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Waste'] }, p2: { hand: ['Test Bear', 'Test Ogre', 'Test Imp', 'Test Bear', 'Test Ogre'] }, defs: [WASTE, BEAR, OGRE, IMP] });
    let s = castAt(s0, 'Test Waste', [plr('p2')]);
    expect(s.pending?.kind).toBe('chooseObjects');
    s = settle(answer(s, { kind: 'chooseObjects', ids: options(s).slice(0, 3) }));
    expect(zoneNames(s, 'hand', 'p2').length).toBe(2);
    expect(zoneNames(s, 'graveyard', 'p2').length).toBe(3);
  });
});

describe('CR 613.4c, 608.2h: "Create a Treasure token. Until end of turn, up to one target creature gets +2/+2 for each Treasure you control."', () => {
  const RUSH = card('Test Rush', 'Instant', 'Create a Treasure token. Until end of turn, up to one target creature gets +2/+2 for each Treasure you control.');
  it('is automated', () => expect(full(RUSH)).toBe(true));
  it('counts the Treasure it just created: with one other Treasure the creature gets +4/+4', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rush'], battlefield: ['Test Bear', 'Test Gem'] }, defs: [RUSH, BEAR, TREASURE_ROCK] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = castAt(s0, 'Test Rush', [obj(bear)]);
    expect(pt(s, bear)).toEqual([6, 6]);
  });
  it('with no creature chosen the Treasure is still created', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rush'], battlefield: ['Test Bear'] }, defs: [RUSH, BEAR] });
    const s = castAt(s0, 'Test Rush', []);
    expect(treasures(s)).toBe(1);
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toEqual([2, 2]);
  });
});

describe('CR 601.2i, 608.2h: "~ deals X damage to target creature, where X is 2 plus the number of other spells you\'ve cast this turn."', () => {
  const SALVO = card('Test Salvo', 'Instant', '~ deals X damage to target creature, where X is 2 plus the number of other spells you\'ve cast this turn.');
  const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.');
  const BIG = card('Test Big', 'Creature — Giant', '', ['2', '9']);
  it('is automated', () => expect(full(SALVO)).toBe(true));
  it('alone it deals 2; after one other spell it deals 3 (the Salvo itself is not counted)', () => {
    const mk = (): GameState => scenario([], { p1: { hand: ['Test Salvo', 'Test Zap'] }, p2: { battlefield: ['Test Big'] }, defs: [SALVO, ZAP, BIG] });
    const s0 = mk();
    const big = find(s0, 'Test Big', 'battlefield', 'p2');
    const alone = castAt(s0, 'Test Salvo', [obj(big)]);
    expect(s0.objects[big]!.damage ?? 0).toBe(0);
    expect(alone.objects[big]!.damage).toBe(2);
    const after = castAt(castAt(mk(), 'Test Zap'), 'Test Salvo', [obj(big)]);
    expect(after.objects[big]!.damage).toBe(3);
  });
});

describe('CR 208.1, 608.2b: "Destroy target creature if no other creature has greater power."', () => {
  const SNIPE = card('Test Snipe', 'Instant', 'Destroy target creature if no other creature has greater power.');
  const mk = (): GameState => scenario([], { p1: { hand: ['Test Snipe'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre', 'Test Imp'] }, defs: [SNIPE, BEAR, OGRE, IMP] });
  it('is automated', () => expect(full(SNIPE)).toBe(true));
  it('destroys the creature with the greatest power but not a smaller one', () => {
    const s0 = mk();
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p2');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    expect(onBf(castAt(s0, 'Test Snipe', [obj(ogre)]), 'Test Ogre')).toEqual([]);
    expect(onBf(castAt(mk(), 'Test Snipe', [obj(bear)]), 'Test Bear').length).toBe(1);
  });
  it('a tie for the greatest power still destroys it (no other creature has GREATER power)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Snipe'], battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Ogre'] }, defs: [SNIPE, OGRE] });
    const mine = find(s0, 'Test Ogre', 'battlefield', 'p1');
    expect(onBf(castAt(s0, 'Test Snipe', [obj(mine)]), 'Test Ogre').length).toBe(1);
  });
});

describe('CR 115.1, 601.2c: "Any number of target players each discard a card." / "... each mill a card and lose 1 life."', () => {
  const MEET = card('Test Meet', 'Sorcery', 'Any number of target players each discard a card.');
  const SAP = card('Test Sap', 'Sorcery', 'Any number of target players each mill a card and lose 1 life.');
  it('are automated', () => {
    expect(full(MEET)).toBe(true);
    expect(full(SAP)).toBe(true);
  });
  it('each chosen player discards; a player not chosen does not; none chosen does nothing', () => {
    const mk = (): GameState => scenario([], { p1: { hand: ['Test Meet', 'Test Imp'] }, p2: { hand: ['Test Bear'] }, defs: [MEET, IMP, BEAR] });
    let s = castAt(mk(), 'Test Meet', [plr('p1'), plr('p2')]);
    // each chosen player chooses the card to discard: the one-card hands are discarded without a question, p1 has only the Imp left to discard
    s = settle(s);
    expect(zoneNames(s, 'hand', 'p2')).toEqual([]);
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Bear']);
    expect(zoneNames(s, 'hand', 'p1')).toEqual([]);
    const only = castAt(mk(), 'Test Meet', [plr('p2')]);
    expect(zoneNames(only, 'hand', 'p1')).toEqual(['Test Imp']);
    expect(zoneNames(only, 'graveyard', 'p2')).toEqual(['Test Bear']);
    const none = castAt(mk(), 'Test Meet', []);
    expect(zoneNames(none, 'hand', 'p2')).toEqual(['Test Bear']);
    expect(zoneNames(none, 'hand', 'p1')).toEqual(['Test Imp']);
  });
  it('each chosen player mills a card and loses 1 life', () => {
    const s0 = scenario([], { p1: { hand: ['Test Sap'], library: ['Test Bear', 'Test Bear'] }, p2: { library: ['Test Imp', 'Test Imp'] }, defs: [SAP, BEAR, IMP] });
    const s = castAt(s0, 'Test Sap', [plr('p1'), plr('p2')]);
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Imp']);
    expect(zoneNames(s, 'graveyard', 'p1').filter((n) => n === 'Test Bear').length).toBe(1);
    expect(life(s, 'p2')).toBe(19);
    expect(life(s, 'p1')).toBe(19);
  });
});

describe('CR 608.2c, 614.15: "Return target permanent card from your graveyard to your hand. Return that card to the battlefield instead if you control a Mount."', () => {
  const SHEPHERD = card('Test Shepherd', 'Sorcery', 'Return target permanent card with mana value 3 or less from your graveyard to your hand. Return that card to the battlefield instead if you control a Mount.');
  const MOUNT = card('Test Mount', 'Creature — Mount', '', ['2', '2']);
  it('is automated', () => expect(full(SHEPHERD)).toBe(true));
  it('without a Mount the card goes to the hand; with a Mount it goes to the battlefield', () => {
    const noMount = scenario([], { p1: { hand: ['Test Shepherd'], graveyard: ['Test Bear'] }, defs: [SHEPHERD, BEAR] });
    const bear = find(noMount, 'Test Bear', 'graveyard', 'p1');
    const a = castAt(noMount, 'Test Shepherd', [obj(bear)]);
    expect(zoneNames(a, 'hand', 'p1')).toEqual(['Test Bear']);
    const withMount = scenario([], { p1: { hand: ['Test Shepherd'], graveyard: ['Test Bear'], battlefield: ['Test Mount'] }, defs: [SHEPHERD, BEAR, MOUNT] });
    const b = castAt(withMount, 'Test Shepherd', [obj(find(withMount, 'Test Bear', 'graveyard', 'p1'))]);
    expect(onBf(b, 'Test Bear').length).toBe(1);
    expect(zoneNames(b, 'hand', 'p1')).toEqual([]);
  });
});

describe('CR 608.2c: "Return up to one target nonland permanent you control to its owner\'s hand. If a permanent was returned this way, put a +1/+1 counter on ~."', () => {
  const PIXIE = card('Test Pixie', 'Creature — Faerie', 'When this creature enters, return up to one target non-Faerie, nonland permanent you control to its owner\'s hand. If a permanent was returned this way, put a +1/+1 counter on ~.', ['1', '1']);
  it('is automated', () => expect(full(PIXIE)).toBe(true));
  it('a permanent returned: the Pixie gets a counter; no target chosen: no counter', () => {
    const mk = (): GameState => scenario([], { p1: { hand: ['Test Pixie'], battlefield: ['Test Bear'] }, defs: [PIXIE, BEAR] });
    const s0 = mk();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Pixie', 'hand', 'p1') }));
    s = settle(pass(pass(s)), [obj(bear)]);
    s = settle(pass(pass(s)));
    const pixie = find(s, 'Test Pixie', 'battlefield', 'p1');
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Bear']);
    expect(counters(s, pixie)['+1/+1']).toBe(1);
    let t = settle(act(mk(), { type: 'cast', player: 'p1', card: find(mk(), 'Test Pixie', 'hand', 'p1') }));
    t = settle(pass(pass(t)), []);
    t = settle(pass(pass(t)));
    const pixie2 = find(t, 'Test Pixie', 'battlefield', 'p1');
    expect(counters(t, pixie2)['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 608.2d: "Mill three cards. Put a land card from among the milled cards into your hand. If you can\'t, create a Treasure token."', () => {
  const NATURALIST = card('Test Naturalist', 'Sorcery', 'Mill three cards. Put a land card from among the milled cards into your hand. If you can\'t, create a Treasure token.');
  it('is automated', () => expect(full(NATURALIST)).toBe(true));
  it('a land among the milled cards goes to the hand and no Treasure is made', () => {
    const s0 = scenario(['Swamp'], { p1: { hand: ['Test Naturalist'], library: ['Test Bear', 'Swamp', 'Test Imp', 'Test Ogre'] }, defs: [NATURALIST, BEAR, IMP, OGRE] });
    const s = castAt(s0, 'Test Naturalist');
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Swamp']);
    expect(treasures(s)).toBe(0);
  });
  it('no land among them: a Treasure is created instead', () => {
    const s0 = scenario(['Swamp'], { p1: { hand: ['Test Naturalist'], library: ['Test Bear', 'Test Bear', 'Test Imp', 'Swamp'] }, defs: [NATURALIST, BEAR, IMP] });
    const s = castAt(s0, 'Test Naturalist');
    expect(zoneNames(s, 'hand', 'p1')).toEqual([]);
    expect(treasures(s)).toBe(1);
  });
});
