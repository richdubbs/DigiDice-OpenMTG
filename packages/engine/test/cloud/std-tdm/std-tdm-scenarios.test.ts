/**
 * Cloud batch 2, slice std-tdm (the Standard backlog of Tarkir: Dragonstorm, tuning half): the templates of parser/templates/zz-cloud/std-tdm.json and the
 * lowering, renderer and engine support they needed, played through the engine with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 122.1b, 608.2c           "Put a +1/+1 counter, a trample counter, and a vigilance counter on target creature."
 *   CR 122.6, 400.7             "Return target creature card ... to the battlefield with a +1/+1 counter and a menace counter on it."
 *   CR 601.2i, 603.2            "Whenever you cast an instant spell or a Goblin spell, ..."
 *   CR 614.15, 701.23a          "... then shuffle and put that card on top. If you control a Wizard, put that card onto the battlefield tapped instead."
 *   CR 701.8a, 702.12b, 608.2c  "Destroy all ... . Draw a card / gain 2 life / lose 2 life / put a +1/+1 counter for each <noun> destroyed this way."
 *   CR 601.2d, 603.3d           "it deals X damage divided as you choose among any number of target creatures ..., where X is the number of lands you control."
 *   CR 401.4, 609.3             "Put two cards from your graveyard on top of your library in any order."
 *   CR 608.2c, 406.1            "Mill a card. Then if your library has no cards in it, exile this artifact and you gain 5 life."
 *   CR 702.66a-b, 613.1f        delve, and "Spells you cast have delve."
 *   CR 602.5b                   "Activate only during your turn and only if a card left your graveyard this turn." / "only if an opponent lost life this turn"
 *   CR 608.2c, 121.1            "draw a card if ... . If you don't draw a card this way, put a +1/+1 counter on this creature."
 *   CR 601.2a, 603.4            "Whenever a creature you control enters, if you cast it, ..."
 *   CR 107.3, 118.3, 701.21a    "{T}, Sacrifice a creature you control with mana value X other than this creature: Return target creature card with mana value X plus 1 ..."
 *   CR 603.7, 603.3d            "Whenever you cast a noncreature spell this turn, target creature you control gains double strike until end of turn."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, legal, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const tokensOf = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);
const ptOf = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const onField = (s: GameState, name: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => nameOf(s, id) === name && (p === undefined || s.objects[id]!.controller === p));

type Target = { kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId };
/** The answers a test gives, in order, per decision; anything else gets the default (automatic payment, the first allowed choices, "yes"). */
interface Script {
  targets?: Target[][];
  objects?: ((options: readonly ObjectId[], s: GameState) => ObjectId[])[];
  numbers?: number[];
  divisions?: number[][];
  yes?: boolean[];
  /** Filled with the kind of every decision answered. */
  seen?: string[];
}
function drive(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    sc.seen?.push(p.kind);
    let a: DecisionAnswer;
    if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'chooseTargets') a = { kind: 'chooseTargets', targets: sc.targets?.shift() ?? [] };
    else if (p.kind === 'chooseOption') a = { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) };
    else if (p.kind === 'chooseObjects') a = { kind: 'chooseObjects', ids: sc.objects?.shift()?.(p.options, s) ?? p.options.slice(0, p.min) };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: sc.yes?.shift() ?? true };
    else if (p.kind === 'chooseNumber') a = { kind: 'chooseNumber', n: sc.numbers?.shift() ?? 0 };
    else if (p.kind === 'chooseDivision') a = { kind: 'chooseDivision', amounts: sc.divisions?.shift() ?? [] };
    else if (p.kind === 'order') a = { kind: 'order', ids: p.items.map((x) => x.id) };
    else throw new Error(`unexpected decision ${p.kind}`);
    s = answer(s, a);
  }
  return s;
}
function resolveAll(s0: GameState, sc: Script = {}): GameState {
  let s = drive(s0, sc);
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), sc);
  return s;
}
const cast = (s: GameState, name: string, sc: Script = {}): GameState => resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), sc);
function activation(s: GameState, name: string, player: PlayerId = 'p1') {
  const src = onField(s, name)[0];
  return legal(s, player, 'activate').find((x) => x.object === src);
}
const activate = (s: GameState, name: string, sc: Script = {}): GameState => {
  const a = activation(s, name);
  if (a === undefined) throw new Error(`no activation of ${name}`);
  return resolveAll(act(s, a.action), sc);
};
const castable = (s: GameState, name: string): boolean => legalActions(s, 'p1').some((a) => a.kind === 'cast' && s.objects[a.object!] !== undefined && nameOf(s, a.object!) === name);
const pick = (...names: string[]) => (options: readonly ObjectId[], s: GameState): ObjectId[] => {
  const left = [...options];
  return names.map((n) => { const i = left.findIndex((id) => nameOf(s, id) === n); return left.splice(i, 1)[0]!; });
};
const full = (d: CardDef): boolean => d.automation.level === 'full';

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}{G}' });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '3'], cost: '{2}{R}' });
const BIRD = card('Test Bird', 'Creature — Bird', 'Flying', { pt: ['1', '1'] });
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', 'Indestructible', { pt: ['1', '1'] });
const RELIC = card('Test Relic', 'Artifact', '');
const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.');
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', { pt: ['1', '1'] });
const ELK = card('Test Elk', 'Creature — Elk', '', { pt: ['2', '2'] });
const WIZARD = card('Test Wizard', 'Creature — Human Wizard', '', { pt: ['1', '1'] });
const RECALL = card('Test Recall', 'Sorcery', 'Return target creature card from your graveyard to the battlefield with a +1/+1 counter and a menace counter on it.');
const BASE = [BEAR, OGRE, BIRD, GOLEM, RELIC, ZAP, GOBLIN, ELK, WIZARD, RECALL];

describe('CR 122.1b, 608.2c: "Put a +1/+1 counter, a trample counter, and a vigilance counter on target creature."', () => {
  const TOTEM = card('Test Totem', 'Artifact', '{0}: Put a +1/+1 counter, a trample counter, and a vigilance counter on target creature.');
  it('is full', () => expect(full(TOTEM)).toBe(true));
  it('the one target creature gets one counter of each kind: +1/+1, trample and vigilance (keyword counters give the keyword)', () => {
    const s0 = scenario([], { defs: [...BASE, TOTEM], p1: { battlefield: ['Test Totem', 'Test Bear'] } });
    const bear = onField(s0, 'Test Bear')[0]!;
    const s = activate(s0, 'Test Totem', { targets: [[{ kind: 'object', id: bear }]] });
    expect(s.objects[bear]!.counters).toEqual({ '+1/+1': 1, trample: 1, vigilance: 1 });
    expect(ptOf(s, bear)).toBe('3/3');
    expect(hasKeyword(getChars(s, bear)!, 'trample')).toBe(true);
    expect(hasKeyword(getChars(s, bear)!, 'vigilance')).toBe(true);
  });
});

describe('CR 122.6, 400.7: "Return target creature card from your graveyard to the battlefield with a +1/+1 counter and a menace counter on it."', () => {
  it('is full', () => expect(full(RECALL)).toBe(true));
  it('the card returns as a new permanent that enters with one +1/+1 counter and one menace counter', () => {
    const s0 = scenario([], { defs: BASE, p1: { hand: ['Test Recall'], graveyard: ['Test Bear'] } });
    const inYard = find(s0, 'Test Bear', 'graveyard', 'p1');
    const s = cast(s0, 'Test Recall', { targets: [[{ kind: 'object', id: inYard }]] });
    const bear = onField(s, 'Test Bear', 'p1');
    expect(bear).toHaveLength(1);
    expect(s.objects[bear[0]!]!.counters).toEqual({ '+1/+1': 1, menace: 1 });
    expect(ptOf(s, bear[0]!)).toBe('3/3');
    expect(hasKeyword(getChars(s, bear[0]!)!, 'menace')).toBe(true);
  });
});

describe('CR 601.2i, 603.2: "Whenever you cast an instant spell or a Goblin spell, this creature gets +1/+0 until end of turn."', () => {
  const CALLER = card('Test Stormcaller', 'Creature — Human Wizard', 'Whenever you cast an instant spell or a Goblin spell, this creature gets +1/+0 until end of turn.', { pt: ['1', '1'] });
  const board = () => scenario([], { defs: [...BASE, CALLER], p1: { battlefield: ['Test Stormcaller'], hand: ['Test Zap', 'Test Goblin', 'Test Elk'] } });
  it('is full', () => expect(full(CALLER)).toBe(true));
  it('an instant spell triggers it, a Goblin creature spell triggers it, another creature spell does not', () => {
    let s = board();
    const caller = onField(s, 'Test Stormcaller')[0]!;
    s = cast(s, 'Test Zap');
    expect(ptOf(s, caller)).toBe('2/1');
    s = cast(s, 'Test Goblin');
    expect(ptOf(s, caller)).toBe('3/1');
    s = cast(s, 'Test Elk');
    expect(ptOf(s, caller)).toBe('3/1');
  });
});

describe('CR 614.15, 701.23a: "... then shuffle and put that card on top. If you control a Wizard, put that card onto the battlefield tapped instead."', () => {
  const SENTINEL = card('Test Sentinel', 'Artifact Creature — Chimera', 'When this creature enters, you may search your library for a basic land card, reveal it, then shuffle and put that card on top. If you control a Wizard, put that card onto the battlefield tapped instead.', { pt: ['2', '1'] });
  const board = (withWizard: boolean) => scenario(['Forest'], { defs: [...BASE, SENTINEL], p1: { hand: ['Test Sentinel'], library: ['Forest'], battlefield: withWizard ? ['Test Wizard'] : [] } });
  it('is full', () => expect(full(SENTINEL)).toBe(true));
  it('without a Wizard the found card is on top of the library after the shuffle', () => {
    const s0 = board(false);
    const size = s0.zones.library.p1!.length;
    const s = cast(s0, 'Test Sentinel', { objects: [pick('Forest')] });
    expect(s.zones.library.p1!.length).toBe(size);
    expect(nameOf(s, s.zones.library.p1![0]!)).toBe('Forest');
    expect(onField(s, 'Forest')).toEqual([]);
  });
  it('with a Wizard the found card goes onto the battlefield tapped instead, under its controller\'s control', () => {
    const s0 = board(true);
    const size = s0.zones.library.p1!.length;
    const s = cast(s0, 'Test Sentinel', { objects: [pick('Forest')] });
    expect(s.zones.library.p1!.length).toBe(size - 1);
    const forest = onField(s, 'Forest', 'p1');
    expect(forest).toHaveLength(1);
    expect(s.objects[forest[0]!]!.tapped).toBe(true);
  });
  it('CR 609.3: declining the search does nothing at all (the replacement is part of the optional instruction)', () => {
    const s0 = board(true);
    const s = cast(s0, 'Test Sentinel', { yes: [false] });
    expect(onField(s, 'Forest')).toEqual([]);
    expect(s.zones.library.p1!.length).toBe(s0.zones.library.p1!.length);
  });
});

describe('CR 701.8a, 702.12b, 608.2c: "for each <noun> destroyed this way" counts what the destroy instruction actually destroyed', () => {
  const PURGE = card('Test Purge', 'Sorcery', 'Destroy all creatures. Draw a card for each creature destroyed this way.');
  const HARVEST = card('Test Harvest', 'Sorcery', 'Destroy all artifacts. You gain 2 life for each permanent destroyed this way.');
  const DAGGERS = card('Test Daggers', 'Sorcery', 'Destroy all creatures target opponent controls. You lose 2 life for each creature destroyed this way.');
  const HYDRA = card('Test Hydra', 'Creature — Hydra', 'Reach\nWhen this creature enters, destroy all creatures with flying. Put a +1/+1 counter on this creature for each creature destroyed this way.', { pt: ['1', '4'] });
  const DEFS = [...BASE, PURGE, HARVEST, DAGGERS, HYDRA];
  it('is full', () => { for (const d of [PURGE, HARVEST, DAGGERS, HYDRA]) expect(full(d), d.name).toBe(true); });
  it('draw: three creatures are destroyed, the indestructible one is not and is not counted', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Purge'], battlefield: ['Test Bear', 'Test Golem'] }, p2: { battlefield: ['Test Bear', 'Test Ogre'] } });
    const h = hand(s0, 'p1');
    const s = cast(s0, 'Test Purge');
    expect(onField(s, 'Test Bear')).toEqual([]);
    expect(onField(s, 'Test Golem')).toHaveLength(1);
    expect(hand(s, 'p1')).toBe(h - 1 + 3);
  });
  it('gain 2 life: twice the number of artifacts destroyed (the indestructible artifact creature survives and is not counted)', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Harvest'], battlefield: ['Test Relic', 'Test Golem'] }, p2: { battlefield: ['Test Relic', 'Test Relic'] } });
    const s = cast(s0, 'Test Harvest');
    expect(onField(s, 'Test Relic')).toEqual([]);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 6);
  });
  it('lose 2 life: only the target opponent\'s creatures are destroyed and counted', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Daggers'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Ogre'] } });
    const s = cast(s0, 'Test Daggers', { targets: [[{ kind: 'player', id: 'p2' }]] });
    expect(onField(s, 'Test Bear', 'p1')).toHaveLength(1);
    expect(onField(s, 'Test Bear', 'p2')).toEqual([]);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') - 4);
  });
  it('counters: one +1/+1 counter on the creature for each creature with flying destroyed (its own reach creature is not one)', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Hydra'], battlefield: ['Test Bird'] }, p2: { battlefield: ['Test Bird', 'Test Bird', 'Test Bear'] } });
    const s = cast(s0, 'Test Hydra');
    const hydra = onField(s, 'Test Hydra')[0]!;
    expect(onField(s, 'Test Bird')).toEqual([]);
    expect(onField(s, 'Test Bear')).toHaveLength(1);
    expect(s.objects[hydra]!.counters['+1/+1']).toBe(3);
  });
});

describe('CR 601.2d, 603.3d: "it deals X damage divided as you choose among any number of target creatures your opponents control, where X is the number of lands you control"', () => {
  const SINGER = card('Test Singer', 'Creature — Spirit Dragon', 'When this creature enters, it deals X damage divided as you choose among any number of target creatures your opponents control, where X is the number of lands you control.', { pt: ['4', '4'] });
  const QUARRY = card('Test Quarry', 'Land', '{T}: Add {C}.\nSacrifice this land: You gain 1 life.');
  it('is full', () => expect(full(SINGER)).toBe(true));
  it('X is counted as the trigger is put on the stack: the division announced then is dealt, even if a land is gone when it resolves', () => {
    let s = scenario(['Forest'], { defs: [...BASE, SINGER, QUARRY], p1: { hand: ['Test Singer'], battlefield: ['Forest', 'Forest', 'Test Quarry'] }, p2: { battlefield: ['Test Ogre', 'Test Bird'] } });
    const ogre = onField(s, 'Test Ogre')[0]!;
    const bird = onField(s, 'Test Bird')[0]!;
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Singer', 'hand', 'p1') });
    s = pass(pass(drive(s))); // the creature resolves; its trigger is announced
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', player: 'p1' });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: ogre }, { kind: 'object', id: bird }] });
    expect(s.pending).toMatchObject({ kind: 'chooseDivision', what: 'damage', total: 3 });
    s = drive(answer(s, { kind: 'chooseDivision', amounts: [2, 1] }));
    // in response, the third land is sacrificed: the announced division stands (CR 601.2d)
    const sac = legal(s, 'p1', 'activate').find((x) => x.object === onField(s, 'Test Quarry')[0] && x.label.includes('Sacrifice'));
    expect(sac).toBeDefined();
    s = resolveAll(act(s, sac!.action));
    expect(onField(s, 'Test Quarry')).toEqual([]);
    expect(s.objects[ogre]!.damage).toBe(2);
    expect(onField(s, 'Test Bird')).toEqual([]);
  });
});

describe('CR 401.4, 609.3: "Put two cards from your graveyard on top of your library in any order."', () => {
  const LOOM = card('Test Loom', 'Artifact', '{0}: Put two cards from your graveyard on top of your library in any order.');
  it('is full', () => expect(full(LOOM)).toBe(true));
  it('the two chosen cards are the top two cards of the library; the third stays in the graveyard', () => {
    const s0 = scenario(['Forest'], { defs: [...BASE, LOOM], p1: { battlefield: ['Test Loom'], graveyard: ['Test Bear', 'Forest', 'Test Bird'] } });
    const s = activate(s0, 'Test Loom', { objects: [pick('Test Bird', 'Test Bear')] });
    expect(s.zones.library.p1!.slice(0, 2).map((id) => nameOf(s, id)).sort()).toEqual(['Test Bear', 'Test Bird']);
    expect(s.zones.graveyard.p1!.map((id) => nameOf(s, id))).toEqual(['Forest']);
  });
  it('with one card in the graveyard, that card is put on top (as much as possible)', () => {
    const s0 = scenario([], { defs: [...BASE, LOOM], p1: { battlefield: ['Test Loom'], graveyard: ['Test Ogre'] } });
    const s = activate(s0, 'Test Loom');
    expect(nameOf(s, s.zones.library.p1![0]!)).toBe('Test Ogre');
    expect(s.zones.graveyard.p1).toEqual([]);
  });
});

describe('CR 608.2c, 406.1: "Mill a card. Then if your library has no cards in it, exile this artifact and you gain 5 life."', () => {
  const HOURGLASS = card('Test Hourglass', 'Artifact', '{0}: Mill a card. Then if your library has no cards in it, exile this artifact and you gain 5 life.');
  /** The board with exactly `n` cards in p1's library (test setup). */
  const board = (n: number): GameState => {
    const s = scenario([], { defs: [...BASE, HOURGLASS], p1: { battlefield: ['Test Hourglass'] } });
    for (const id of s.zones.library.p1!.slice(n)) delete s.objects[id];
    s.zones.library.p1 = s.zones.library.p1!.slice(0, n);
    return s;
  };
  it('is full', () => expect(full(HOURGLASS)).toBe(true));
  it('the mill empties the library: the artifact is exiled and its controller gains 5 life (both instructions under the one if)', () => {
    const s0 = board(1);
    const s = activate(s0, 'Test Hourglass');
    expect(onField(s, 'Test Hourglass')).toEqual([]);
    expect(findAll(s, 'Test Hourglass', 'exile')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 5);
  });
  it('a card is left in the library: neither happens', () => {
    const s0 = board(2);
    const s = activate(s0, 'Test Hourglass');
    expect(onField(s, 'Test Hourglass')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
  });
});

describe('CR 702.66a, 702.66b: delve', () => {
  const CRUISE = card('Test Cruise', 'Sorcery', 'Delve\nDraw two cards.', { cost: '{4}{U}' });
  const ARBITER = card('Test Arbiter', 'Creature — Spirit Dragon', 'Spells you cast have delve.', { pt: ['3', '3'] });
  const STUDY = card('Test Study', 'Sorcery', 'Draw two cards.', { cost: '{3}{U}' });
  it('is full', () => { for (const d of [CRUISE, ARBITER, STUDY]) expect(full(d), d.name).toBe(true); });
  it('four cards exiled from the graveyard pay for {4}; the land pays {U}', () => {
    let s = scenario(['Island', 'Forest'], { defs: [...BASE, CRUISE], p1: { hand: ['Test Cruise'], battlefield: ['Island'], graveyard: ['Forest', 'Forest', 'Forest', 'Forest'] } });
    expect(castable(s, 'Test Cruise')).toBe(true);
    const h = hand(s, 'p1');
    s = cast(s, 'Test Cruise', { objects: [(options) => [...options]] });
    expect(s.zones.graveyard.p1!.map((id) => nameOf(s, id))).toEqual(['Test Cruise']);
    expect(findAll(s, 'Forest', 'exile')).toHaveLength(4);
    expect(hand(s, 'p1')).toBe(h - 1 + 2);
  });
  it('delve pays generic mana only: three cards and a land cannot pay {4}{U}', () => {
    const s = scenario(['Island', 'Forest'], { defs: [...BASE, CRUISE], p1: { hand: ['Test Cruise'], battlefield: ['Island'], graveyard: ['Forest', 'Forest', 'Forest'] } });
    expect(castable(s, 'Test Cruise')).toBe(false);
  });
  it('CR 613.1f: "Spells you cast have delve" lets a spell without the keyword be paid with graveyard cards', () => {
    let s = scenario(['Island', 'Forest'], { defs: [...BASE, ARBITER, STUDY], p1: { hand: ['Test Study'], battlefield: ['Test Arbiter', 'Island'], graveyard: ['Forest', 'Forest', 'Forest'] } });
    expect(castable(s, 'Test Study')).toBe(true);
    const h = hand(s, 'p1');
    s = cast(s, 'Test Study', { objects: [(options) => [...options]] });
    expect(findAll(s, 'Forest', 'exile')).toHaveLength(3);
    expect(hand(s, 'p1')).toBe(h - 1 + 2);
  });
});

describe('CR 602.5b: two activation restrictions, both read from the game as the ability is activated', () => {
  const ANCHOR = card('Test Anchor', 'Artifact', '{T}: Create a 2/2 black Zombie creature token. Activate only during your turn and only if a card left your graveyard this turn.');
  const SHOVEL = card('Test Shovel', 'Artifact', '{0}: Exile target card from a graveyard.');
  const board = () => scenario([], { defs: [...BASE, ANCHOR, SHOVEL], p1: { battlefield: ['Test Anchor', 'Test Shovel'], graveyard: ['Test Bear', 'Test Ogre'] } });
  it('is full', () => expect(full(ANCHOR)).toBe(true));
  it('not before a card left its controller\'s graveyard; then it can be activated during their turn', () => {
    let s = board();
    expect(activation(s, 'Test Anchor')).toBeUndefined();
    s = activate(s, 'Test Shovel', { targets: [[{ kind: 'object', id: find(s, 'Test Bear', 'graveyard', 'p1') }]] });
    expect(activation(s, 'Test Anchor')).toBeDefined();
    s = activate(s, 'Test Anchor');
    expect(tokensOf(s, 'p1')).toHaveLength(1);
  });
  it('not during an opponent\'s turn, even after a card left its controller\'s graveyard that turn', () => {
    let s = advanceTo(board(), 2, 'upkeep');
    s = pass(s); // the active player (p2) passes: p1 has priority in p2's upkeep
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    const shovel = legal(s, 'p1', 'activate').find((x) => x.object === onField(s, 'Test Shovel')[0])!;
    s = drive(act(s, shovel.action), { targets: [[{ kind: 'object', id: find(s, 'Test Ogre', 'graveyard', 'p1') }]] });
    expect(s.zones.graveyard.p1!.map((id) => nameOf(s, id))).toContain('Test Bear');
    s = drive(pass(pass(s)));
    expect(findAll(s, 'Test Ogre', 'exile')).toHaveLength(1);
    expect(activation(s, 'Test Anchor', 'p1')).toBeUndefined();
  });
  it('"only if an opponent lost life this turn and only once each turn"', () => {
    const CLAW = card('Test Claw', 'Creature — Lizard', '{0}: Put a +1/+1 counter on this creature. Activate only if an opponent lost life this turn and only once each turn.', { pt: ['1', '1'] });
    const NEEDLE = card('Test Needle', 'Artifact', '{0}: Target opponent loses 1 life.');
    expect(full(CLAW)).toBe(true);
    let s = scenario([], { defs: [...BASE, CLAW, NEEDLE], p1: { battlefield: ['Test Claw', 'Test Needle'] } });
    expect(activation(s, 'Test Claw')).toBeUndefined();
    s = activate(s, 'Test Needle', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = activate(s, 'Test Claw');
    expect(s.objects[onField(s, 'Test Claw')[0]!]!.counters['+1/+1']).toBe(1);
    expect(activation(s, 'Test Claw')).toBeUndefined();
  });
});

describe('CR 608.2c, 121.1: "draw a card if you control a creature with a counter on it. If you don\'t draw a card this way, put a +1/+1 counter on this creature."', () => {
  const ENVOY = card('Test Envoy', 'Creature — Dog Soldier', "When this creature enters, draw a card if you control a creature with a counter on it. If you don't draw a card this way, put a +1/+1 counter on this creature.", { pt: ['3', '3'] });
  it('is full', () => expect(full(ENVOY)).toBe(true));
  it('no creature with a counter: no card is drawn, so the counter goes on it', () => {
    const s0 = scenario([], { defs: [...BASE, ENVOY], p1: { hand: ['Test Envoy'], battlefield: ['Test Bear'] } });
    const s = cast(s0, 'Test Envoy');
    expect(hand(s, 'p1')).toBe(hand(s0, 'p1') - 1);
    expect(s.objects[onField(s, 'Test Envoy')[0]!]!.counters['+1/+1']).toBe(1);
  });
  it('a creature with a counter: a card is drawn and no counter is put', () => {
    const s0 = scenario([], { defs: [...BASE, ENVOY], p1: { hand: ['Test Envoy'], battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 1 } }] } });
    const s = cast(s0, 'Test Envoy');
    expect(hand(s, 'p1')).toBe(hand(s0, 'p1'));
    expect(s.objects[onField(s, 'Test Envoy')[0]!]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 601.2a, 603.4: "Whenever a creature you control enters, if you cast it, destroy that creature, then create a 2/2 black Zombie creature token."', () => {
  const CEREMONY = card('Test Ceremony', 'Legendary Enchantment', 'Whenever a creature you control enters, if you cast it, destroy that creature, then create a 2/2 black Zombie creature token.');
  it('is full', () => expect(full(CEREMONY)).toBe(true));
  it('a creature its controller cast is destroyed and replaced by a Zombie token', () => {
    const s0 = scenario([], { defs: [...BASE, CEREMONY], p1: { battlefield: ['Test Ceremony'], hand: ['Test Elk'] } });
    const s = cast(s0, 'Test Elk');
    expect(onField(s, 'Test Elk')).toEqual([]);
    expect(tokensOf(s, 'p1').map((id) => getChars(s, id)!.subtypes)).toEqual([['Zombie']]);
  });
  it('a creature put onto the battlefield without being cast stays (no trigger resolves for it)', () => {
    const s0 = scenario([], { defs: [...BASE, CEREMONY], p1: { battlefield: ['Test Ceremony'], hand: ['Test Recall'], graveyard: ['Test Bear'] } });
    const s = cast(s0, 'Test Recall', { targets: [[{ kind: 'object', id: find(s0, 'Test Bear', 'graveyard', 'p1') }]] });
    expect(onField(s, 'Test Bear')).toHaveLength(1);
    expect(tokensOf(s, 'p1')).toEqual([]);
  });
});

describe('CR 107.3, 118.3, 701.21a: "{T}, Sacrifice a creature you control with mana value X other than this creature: Return target creature card with mana value X plus 1 ..."', () => {
  const REGENT = card('Test Regent', 'Legendary Creature — Zombie Snake', '{T}, Sacrifice a creature you control with mana value X other than this creature: Return target creature card with mana value X plus 1 from your graveyard to the battlefield. Activate only as a sorcery.', { pt: ['1', '3'], cost: '{1}{B}' });
  it('is full', () => expect(full(REGENT)).toBe(true));
  it('X = 2: a mana value 2 creature is sacrificed and the mana value 3 creature card returns', () => {
    const s0 = scenario([], { defs: [...BASE, REGENT], p1: { battlefield: ['Test Regent', 'Test Bear'], graveyard: ['Test Ogre'] } });
    const s = activate(s0, 'Test Regent', { numbers: [2], targets: [[{ kind: 'object', id: find(s0, 'Test Ogre', 'graveyard', 'p1') }]], objects: [pick('Test Bear')] });
    expect(onField(s, 'Test Ogre', 'p1')).toHaveLength(1);
    expect(onField(s, 'Test Bear')).toEqual([]);
    expect(onField(s, 'Test Regent')).toHaveLength(1);
  });
  it('"other than this creature": with no other creature, the cost cannot be paid', () => {
    const s = scenario([], { defs: [...BASE, REGENT], p1: { battlefield: ['Test Regent'], graveyard: ['Test Ogre', 'Test Bear'] } });
    expect(activation(s, 'Test Regent')).toBeUndefined();
  });
  it('CR 118.3: "Sacrifice a creature you control other than this creature" needs another creature', () => {
    const CULTIST = card('Test Cultist', 'Creature — Human Cleric', '{T}, Sacrifice a creature you control other than this creature: Draw a card.', { pt: ['1', '1'] });
    expect(full(CULTIST)).toBe(true);
    expect(activation(scenario([], { defs: [...BASE, CULTIST], p1: { battlefield: ['Test Cultist'] } }), 'Test Cultist')).toBeUndefined();
    const s0 = scenario([], { defs: [...BASE, CULTIST], p1: { battlefield: ['Test Cultist', 'Test Bear'] } });
    const s = activate(s0, 'Test Cultist', { objects: [pick('Test Bear')] });
    expect(onField(s, 'Test Bear')).toEqual([]);
    expect(onField(s, 'Test Cultist')).toHaveLength(1);
    expect(hand(s, 'p1')).toBe(hand(s0, 'p1') + 1);
  });
});

describe('CR 603.7, 603.3d: "Whenever you cast a noncreature spell this turn, target creature you control gains double strike until end of turn."', () => {
  const RALLY = card('Test Rally', 'Sorcery', 'Draw a card. Whenever you cast a noncreature spell this turn, target creature you control gains double strike until end of turn.');
  it('is full', () => expect(full(RALLY)).toBe(true));
  it('the spell announces no target; the delayed trigger chooses its own target each time it triggers', () => {
    let s = scenario([], { defs: [...BASE, RALLY], p1: { hand: ['Test Rally', 'Test Zap', 'Test Goblin'], battlefield: ['Test Bear'] } });
    const bear = onField(s, 'Test Bear')[0]!;
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rally', 'hand', 'p1') });
    expect(s.pending?.kind).not.toBe('chooseTargets');
    s = resolveAll(s);
    expect(hasKeyword(getChars(s, bear)!, 'double strike')).toBe(false);
    s = cast(s, 'Test Goblin'); // a creature spell: no trigger
    expect(hasKeyword(getChars(s, bear)!, 'double strike')).toBe(false);
    const seen: string[] = [];
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Zap', 'hand', 'p1') }), { targets: [[{ kind: 'object', id: bear }]], seen });
    expect(seen).toContain('chooseTargets'); // the trigger's own target, chosen as it is put on the stack
    expect(s.zones.stack).toHaveLength(2);
    s = resolveAll(s);
    expect(hasKeyword(getChars(s, bear)!, 'double strike')).toBe(true);
  });
});
