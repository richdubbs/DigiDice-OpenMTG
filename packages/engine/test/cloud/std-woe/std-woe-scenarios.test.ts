/**
 * Cloud std-woe (the Wilds of Eldraine Standard backlog): the shapes of parser/templates/zz-cloud/std-woe.json and the readings this slice added, played through
 * the engine with synthetic cards compiled by the game's default compiler (invented names, numbers and wordings, design 6.10). Each test is named after the
 * rule it checks.
 *
 *   CR 702.166a-b, 614.15, 601.2c   bargain: "If this spell was bargained, instead it deals N damage to that permanent and you scry M" (the new instructions
 *                                   replace the old one as a whole; the choice was made as the spell was cast)
 *   CR 614.1a, 700.4, 120.3, 400.7  "If a permanent dealt damage by ~ would die this turn, exile it instead": the permanents the spell itself dealt damage to
 *   CR 701.22a                      "you scry N" with its player said
 *   CR 601.2f, 602.2b, 605.1a       "Activated abilities of lands you control cost {1} less to activate": mana abilities too (CR 605.3a: a filter ability's mana cost)
 *   CR 702.166b, 614.15, 608.2c     bargain riders: "twice X damage to that permanent instead"; "look at the top four instead" read again by a later "them"; a
 *                                   conditional look that keeps up to N on top and puts the rest into the graveyard (CR 701.20e, 401.4)
 *   CR 608.2d, 613.1b, 108.4        "Choose another player. That player gains control of ...", "Target player gains control of ...", "Choose an opponent. That
 *                                   player ..."; "each opponent gains control" is not automated (one controller)
 *   CR 601.2f, 608.2h               "Spells you cast this turn that are black and/or red cost {X} less, where X is the amount of life you lost this turn": X fixed
 *                                   as the ability resolves; a colorless spell is not reduced (CR 105.2)
 *   CR 120.3, 603.2, 510.2          "Whenever a source you control deals noncombat damage to an opponent": not for damage to you, nor combat damage
 *   CR 113.6m                       "... return ~ from your graveyard to your hand" triggers only while the card is in the graveyard
 *   CR 613.1d, 613.1f, 613.4b       "As long as C, ~ is a Dragon with base power and toughness 4/4, flying, and "..."" (loses its other creature types)
 *   CR 508.1k, 603.2, 105.2         "If a Rat is attacking, ~ gains trample"; "Whenever you cast a spell that's white, blue, black, or red"
 *   CR 701.17a, 608.2d, 110.2       a mandatory pick from among the milled cards; "return a land card from your graveyard to the battlefield tapped"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, hasKeyword, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, legal, passBoth, pool, scenario } from '../../m3/scenario';
import { attackUnblocked, declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string], colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** The answers to the decisions of a cast or a resolution, in order of kind; payment is automatic. Stops at the next priority decision. */
interface Script { yes?: boolean[]; targets?: TargetChoice[][]; objects?: ObjectId[][]; options?: string[][]; x?: number[] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])], options: [...(script.options ?? [])], x: [...(script.x ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: q.options.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: q.x.shift() ?? p.min });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const cast = (s: GameState, name: string, script?: Script, player = 'p1'): GameState => drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script);
/** Both players pass until the stack is empty (triggers included), answering what comes up with the script. */
function resolveAll(s0: GameState, script?: Script): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const named = (s: GameState, name: string, zone: 'battlefield' | 'exile' = 'battlefield'): ObjectId[] => s.zones[zone].filter((id) => s.objects[id]!.defId === name);
const inGraveyard = (s: GameState, name: string, owner: string): boolean => s.zones.graveyard[owner]!.some((id) => s.objects[id]!.defId === name);

const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{1}', ['4', '4']);
const TRINKET = card('Test Trinket', 'Artifact', '', '{1}');

// ---- Torch the Tower's shapes --------------------------------------------------------------------------------------------------------------------------

const SCORCH = card('Test Scorch', 'Instant', 'Bargain\nTest Scorch deals 1 damage to target creature or planeswalker. If this spell was bargained, instead it deals 4 damage to that permanent and you scry 2.\nIf a permanent dealt damage by Test Scorch would die this turn, exile it instead.');
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
const SCORCH_DEFS = [SCORCH, KILL, BEAR, OGRE, TRINKET];

describe('Cloud std-woe: "If this spell was bargained, instead it deals N damage to that permanent and you scry M" and "a permanent dealt damage by ~"', () => {
  it('is automated', () => {
    expect(full(SCORCH)).toBe(true);
  });
  it('CR 702.166b, 614.15: bargained, it deals 4 damage instead of 1 and you scry 2; the Ogre would die and is exiled instead (CR 614.1a, 700.4)', () => {
    let s = scenario([], { defs: SCORCH_DEFS, p1: { hand: ['Test Scorch'], battlefield: ['Test Trinket'], library: ['Test Bear', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Ogre'] } });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = cast(s, 'Test Scorch', { yes: [true], targets: [[obj(ogre)]], objects: [[find(s, 'Test Trinket', 'battlefield', 'p1')]] });
    s = resolveAll(s);
    expect(named(s, 'Test Ogre')).toEqual([]);
    expect(named(s, 'Test Ogre', 'exile')).toHaveLength(1);
    expect(inGraveyard(s, 'Test Ogre', 'p2')).toBe(false);
  });
  it('CR 702.166b: not bargained, it deals 1 damage only: the Ogre survives', () => {
    let s = scenario([], { defs: SCORCH_DEFS, p1: { hand: ['Test Scorch'], battlefield: ['Test Trinket'] }, p2: { battlefield: ['Test Ogre'] } });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Scorch', { yes: [false], targets: [[obj(ogre)]] }));
    expect(named(s, 'Test Ogre')).toHaveLength(1);
    expect(s.objects[ogre]!.damage).toBe(1);
  });
  it('CR 614.1a, 120.3: a creature dealt damage by the spell that then dies to something else this turn is exiled; one it never damaged goes to the graveyard', () => {
    let s = scenario([], { defs: SCORCH_DEFS, p1: { hand: ['Test Scorch', 'Test Kill', 'Test Kill'], battlefield: ['Test Trinket'] }, p2: { battlefield: ['Test Ogre', 'Test Bear'] } });
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Scorch', { yes: [false], targets: [[obj(ogre)]] }));
    s = resolveAll(cast(s, 'Test Kill', { targets: [[obj(ogre)]] }));
    expect(named(s, 'Test Ogre', 'exile')).toHaveLength(1);
    s = resolveAll(cast(s, 'Test Kill', { targets: [[obj(bear)]] }));
    expect(inGraveyard(s, 'Test Bear', 'p2')).toBe(true);
  });
});

// ---- the woe-owned shape: "Activated abilities of <permanents> you control cost {M} less to activate" -----------------------------------------------------------

const KEEPER = card('Test Grove Keeper', 'Creature — Turtle', 'Activated abilities of lands you control cost {1} less to activate.', '{2}{G}', ['2', '4']);
const RUINS = card('Test Ruins', 'Land', '{T}: Add {C}.\n{2}, {T}: Draw a card.');
const PRISM = card('Test Prism Shore', 'Land', '{1}, {T}: Add one mana of any color.');
const TINKER = card('Test Tinker', 'Creature — Human', '{1}: Test Tinker gets +1/+0 until end of turn.', '{1}', ['1', '1']);
const KEEPER_DEFS = [KEEPER, RUINS, PRISM, TINKER];
/** The legal activations of a permanent of p1 (`mana`: its mana abilities, else the others). */
const activations = (s: GameState, name: string, mana: boolean) => legal(s, 'p1', 'activate').filter((a) => a.object === find(s, name, 'battlefield', 'p1') && (a.isMana === true) === mana);

describe('Cloud std-woe: "Activated abilities of lands you control cost {1} less to activate." (CR 601.2f, 602.2b, 605.1a)', () => {
  it('is automated', () => {
    expect(full(KEEPER)).toBe(true);
    expect(full(RUINS)).toBe(true);
    expect(full(PRISM)).toBe(true);
  });
  it('CR 602.2b, 118.7: a land\'s "{2}, {T}: Draw a card" costs {1}: one other land pays for it; without the keeper it is not offered', () => {
    const s0 = scenario(['Plains'], { defs: KEEPER_DEFS, p1: { battlefield: ['Test Grove Keeper', 'Test Ruins', 'Plains'], library: ['Test Tinker', 'Test Tinker'] } });
    const hand = s0.zones.hand.p1!.length;
    const [draw] = activations(s0, 'Test Ruins', false);
    expect(draw).toBeDefined();
    const s = resolveAll(drive(act(s0, draw!.action)));
    expect(s.zones.hand.p1!.length).toBe(hand + 1);
    const without = scenario(['Plains'], { defs: KEEPER_DEFS, p1: { battlefield: ['Test Ruins', 'Plains'], library: ['Test Tinker'] } });
    expect(activations(without, 'Test Ruins', false)).toEqual([]);
  });
  it('CR 605.1a, 605.3a: a mana ability is an activated ability: "{1}, {T}: Add one mana of any color" costs {T} only, so it is activated with no other mana', () => {
    const s0 = scenario([], { defs: KEEPER_DEFS, p1: { battlefield: ['Test Grove Keeper', 'Test Prism Shore'] } });
    const [mana] = activations(s0, 'Test Prism Shore', true);
    expect(mana).toBeDefined();
    let s = act(s0, mana!.action);
    if (s.pending?.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: 'G' });
    expect(pool(s, 'p1')).toBe('G');
    const without = scenario([], { defs: KEEPER_DEFS, p1: { battlefield: ['Test Prism Shore'] } });
    expect(activations(without, 'Test Prism Shore', true)).toEqual([]);
  });
  it('CR 605.3a: the automatic payer plans the reduced filter ability: a {1} spell is paid by the Prism Shore alone', () => {
    const s0 = scenario([], { defs: KEEPER_DEFS, p1: { hand: ['Test Tinker'], battlefield: ['Test Grove Keeper', 'Test Prism Shore'] } });
    const s = resolveAll(cast(s0, 'Test Tinker'));
    expect(named(s, 'Test Tinker')).toHaveLength(1);
  });
  it('the ability of a creature is not reduced: "{1}: +1/+0" still needs a mana', () => {
    const s0 = scenario([], { defs: KEEPER_DEFS, p1: { battlefield: ['Test Grove Keeper', 'Test Tinker'] } });
    expect(activations(s0, 'Test Tinker', false)).toEqual([]);
  });
});

// ---- bargain: "instead" with a later "them", and a conditional look -----------------------------------------------------------------------------------

/** The cards a pending choice offers (the decision is answered by the caller). */
const offered = (s: GameState): ObjectId[] => (s.pending?.kind === 'chooseObjects' ? [...s.pending.options] : []);
/** Cast, then pass until the resolution asks for a choice of objects (or the stack is empty). */
function castToChoice(s0: GameState, name: string, script: Script): GameState {
  let s = cast(s0, name, script);
  for (let i = 0; i < 6 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; i++) s = passBoth(s);
  return s;
}
const SPLITTER = card('Test Splitter', 'Instant', 'Bargain\nTest Splitter deals X damage to target creature or planeswalker. If this spell was bargained, it deals twice X damage to that permanent instead.', '{X}{R}');
const FORESIGHT = card('Test Foresight', 'Instant', 'Bargain\nLook at the top two cards of your library. If this spell was bargained, look at the top four cards of your library instead. Put one of them into your hand and the rest on the bottom of your library in a random order.');
const GRIM = card('Test Grim Search', 'Instant', 'Bargain\nIf this spell was bargained, look at the top three cards of your library, then put up to one of them back on top of your library in any order and the rest into your graveyard.\nYou draw a card and you lose 1 life.');
const BARGAIN_DEFS = [SPLITTER, FORESIGHT, GRIM, BEAR, OGRE, TRINKET, KILL];

describe('Cloud std-woe: bargain riders (CR 702.166a-b, 614.15, 608.2c)', () => {
  it('is automated', () => {
    for (const d of [SPLITTER, FORESIGHT, GRIM]) expect(full(d), d.name).toBe(true);
  });
  it('CR 702.166b, 107.3: "it deals twice X damage to that permanent instead": X = 2 deals 4 when bargained (the Ogre dies) and 2 when not', () => {
    const base = { defs: BARGAIN_DEFS, p1: { hand: ['Test Splitter'], battlefield: ['Test Trinket', 'Mountain', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Test Ogre'] } };
    let s = scenario(['Mountain'], base);
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Splitter', { yes: [true], x: [2], targets: [[obj(ogre)]], objects: [[find(s, 'Test Trinket', 'battlefield', 'p1')]] }));
    expect(inGraveyard(s, 'Test Ogre', 'p2')).toBe(true);
    let t = scenario(['Mountain'], base);
    t = resolveAll(cast(t, 'Test Splitter', { yes: [false], x: [2], targets: [[obj(find(t, 'Test Ogre', 'battlefield', 'p2'))]] }));
    expect(named(t, 'Test Ogre')).toHaveLength(1);
    expect(t.objects[find(t, 'Test Ogre', 'battlefield', 'p2')]!.damage).toBe(2);
  });
  it('CR 614.15, 608.2c: "look at the top two ... If bargained, look at the top four instead. Put one of them ...": "them" is the cards looked at either way', () => {
    const library = ['Test Bear', 'Test Ogre', 'Test Kill', 'Test Trinket'];
    let s = scenario([], { defs: BARGAIN_DEFS, p1: { hand: ['Test Foresight'], battlefield: ['Test Trinket'], library } });
    s = castToChoice(s, 'Test Foresight', { yes: [true], objects: [[find(s, 'Test Trinket', 'battlefield', 'p1')]] });
    expect(offered(s).map((id) => s.objects[id]!.defId)).toEqual(library);
    const kill = offered(s)[2]!;
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [kill] }));
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Kill']);
    expect(s.zones.library.p1!.slice(-3).map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Bear', 'Test Ogre', 'Test Trinket']);
    let t = scenario([], { defs: BARGAIN_DEFS, p1: { hand: ['Test Foresight'], library } });
    t = castToChoice(t, 'Test Foresight', { yes: [false] });
    expect(offered(t).map((id) => t.objects[id]!.defId)).toEqual(['Test Bear', 'Test Ogre']);
  });
  it('CR 701.20e, 401.4: bargained, up to one of the top three goes back on top and the rest into the graveyard, then you draw the kept card; not bargained, you just draw', () => {
    const library = ['Test Bear', 'Test Ogre', 'Test Kill'];
    let s = scenario([], { defs: BARGAIN_DEFS, p1: { hand: ['Test Grim Search'], battlefield: ['Test Trinket'], library } });
    s = castToChoice(s, 'Test Grim Search', { yes: [true], objects: [[find(s, 'Test Trinket', 'battlefield', 'p1')]] });
    expect(s.pending?.kind === 'chooseObjects' && s.pending.min).toBe(0);
    const ogre = offered(s)[1]!;
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [ogre] }));
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Ogre']);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Bear', 'Test Grim Search', 'Test Kill', 'Test Trinket']);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(19);
    let t = scenario([], { defs: BARGAIN_DEFS, p1: { hand: ['Test Grim Search'], library } });
    t = resolveAll(cast(t, 'Test Grim Search', { yes: [false] }));
    expect(t.zones.hand.p1!.map((id) => t.objects[id]!.defId)).toEqual(['Test Bear']);
    expect(t.zones.graveyard.p1!.map((id) => t.objects[id]!.defId)).toEqual(['Test Grim Search']);
  });
});

// ---- "Choose another player. That player gains control of ..." and "<player> gains control of ..." -----------------------------------------------------

const BROKER = card('Test Broker', 'Creature — Human', '{1}: Choose another player. That player gains control of target artifact you control. You draw a card.', '{1}', ['1', '1']);
const GIFT = card('Test Gift', 'Sorcery', 'Target player gains control of target artifact you control.');
const BAD_GIFT = card('Test Bad Gift', 'Sorcery', 'Each opponent gains control of target artifact you control.');
const CHOOSER = card('Test Chooser', 'Sorcery', 'Choose an opponent. That player loses 2 life.');
const PICKER = card('Test Picker', 'Sorcery', 'Choose a player. That player draws a card.');
const CONTROL_DEFS = [BROKER, GIFT, BAD_GIFT, CHOOSER, PICKER, TRINKET, BEAR];
const controllerOf = (s: GameState, name: string): string => s.objects[named(s, name)[0]!]!.controller;

describe('Cloud std-woe: a chosen player and control changes (CR 608.2d, 613.1b, 108.4)', () => {
  it('is automated, and "each opponent gains control of ..." is not (CR 108.4: one controller)', () => {
    expect(full(BROKER)).toBe(true);
    expect(full(GIFT)).toBe(true);
    expect(full(BAD_GIFT)).toBe(false);
  });
  it('CR 608.2d, 613.1b: "Choose another player" offers no one but the other player of a two-player game, who gains control of the target artifact; you draw', () => {
    const s0 = scenario([], { defs: CONTROL_DEFS, p1: { battlefield: ['Test Broker', 'Test Trinket', 'Plains'], library: ['Test Bear'] } });
    const hand = s0.zones.hand.p1!.length;
    const [ab] = activations(s0, 'Test Broker', false);
    expect(ab).toBeDefined();
    const s = resolveAll(drive(act(s0, ab!.action), { targets: [[obj(find(s0, 'Test Trinket', 'battlefield', 'p1'))]] }));
    expect(controllerOf(s, 'Test Trinket')).toBe('p2');
    expect(s.zones.hand.p1!.length).toBe(hand + 1);
  });
  it('CR 115.1, 613.1b, 611.2a: "Target player gains control of target artifact you control" lasts after the turn ends', () => {
    let s = scenario([], { defs: CONTROL_DEFS, p1: { hand: ['Test Gift'], battlefield: ['Test Trinket'] } });
    s = resolveAll(cast(s, 'Test Gift', { targets: [[{ kind: 'player', id: 'p2' }], [obj(find(s, 'Test Trinket', 'battlefield', 'p1'))]] }));
    expect(controllerOf(s, 'Test Trinket')).toBe('p2');
    s = advanceTo(s, 2, 'main1');
    expect(controllerOf(s, 'Test Trinket')).toBe('p2');
  });
  it('CR 608.2d: "Choose an opponent. That player loses 2 life" and "Choose a player. That player draws a card": the chosen player is "that player"', () => {
    let s = scenario([], { defs: CONTROL_DEFS, p1: { hand: ['Test Chooser', 'Test Picker'] } });
    s = resolveAll(cast(s, 'Test Chooser'));
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(18);
    const p2Hand = s.zones.hand.p2!.length;
    s = cast(s, 'Test Picker');
    s = passBoth(s);
    expect(s.pending?.kind).toBe('chooseOption');
    s = resolveAll(answer(s, { kind: 'chooseOption', ids: ['p2'] }));
    expect(s.zones.hand.p2!.length).toBe(p2Hand + 1);
  });
});

// ---- Rowan, Scion of War's shape: X fixed as the ability resolves ----------------------------------------------------------------------------------------

const ROWAN = card('Test Rowan', 'Creature — Human Wizard', '{T}: Spells you cast this turn that are black and/or red cost {X} less to cast, where X is the amount of life you lost this turn. Activate only as a sorcery.', '{1}{B}{R}', ['2', '2']);
const SMALL_PACT = card('Test Small Pact', 'Sorcery', 'You lose 1 life.');
const BIG_PACT = card('Test Big Pact', 'Sorcery', 'You lose 2 life.');
const NIGHT = card('Test Night Ritual', 'Sorcery', 'Draw a card.', '{2}{B}', undefined, ['B']);
const DUSK = card('Test Dusk Ritual', 'Sorcery', 'Draw a card.', '{1}{B}', undefined, ['B']);
const IDOL = card('Test Idol', 'Artifact', '', '{2}');
const ROWAN_DEFS = [ROWAN, SMALL_PACT, BIG_PACT, NIGHT, DUSK, IDOL, BEAR];
const castable = (s: GameState, name: string): boolean => legal(s, 'p1', 'cast').some((a) => a.object === find(s, name, 'hand', 'p1'));

describe('Cloud std-woe: "Spells you cast this turn that are black and/or red cost {X} less to cast, where X is the amount of life you lost this turn" (CR 601.2f, 608.2h, 611.2c)', () => {
  it('is automated', () => {
    expect(full(ROWAN)).toBe(true);
  });
  it('CR 608.2h: X is the life lost when the ability resolves; life lost later does not change it', () => {
    let s = scenario(['Swamp'], { defs: ROWAN_DEFS, p1: { battlefield: ['Test Rowan', 'Swamp'], hand: ['Test Small Pact', 'Test Big Pact', 'Test Night Ritual', 'Test Dusk Ritual'], library: ['Test Bear', 'Test Bear'] } });
    s = resolveAll(cast(s, 'Test Small Pact'));
    const [ab] = activations(s, 'Test Rowan', false);
    s = resolveAll(drive(act(s, ab!.action)));
    s = resolveAll(cast(s, 'Test Big Pact'));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(17);
    expect(castable(s, 'Test Night Ritual')).toBe(false); // {2}{B} less 1 is {1}{B}: one Swamp is not enough (X stayed 1, not 3)
    expect(castable(s, 'Test Dusk Ritual')).toBe(true); // {1}{B} less 1 is {B}
  });
  it('CR 105.2, 601.2f: a colorless spell is not black or red: it is not reduced', () => {
    let s = scenario(['Swamp'], { defs: ROWAN_DEFS, p1: { battlefield: ['Test Rowan', 'Swamp'], hand: ['Test Small Pact', 'Test Idol', 'Test Dusk Ritual'] } });
    s = resolveAll(cast(s, 'Test Small Pact'));
    const [ab] = activations(s, 'Test Rowan', false);
    s = resolveAll(drive(act(s, ab!.action)));
    expect(castable(s, 'Test Idol')).toBe(false);
    expect(castable(s, 'Test Dusk Ritual')).toBe(true);
  });
});

// ---- Virtue of Courage's shape: a source you control deals noncombat damage to an opponent -----------------------------------------------------------

const VALOR = card('Test Valor', 'Enchantment', 'Whenever a source you control deals noncombat damage to an opponent, you may exile that many cards from the top of your library. You may play those cards this turn.');
const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 2 damage to any target.');
const VALOR_DEFS = [VALOR, ZAP, BEAR];
const exiledOf = (s: GameState, owner: string): number => s.zones.exile.filter((id) => s.objects[id]!.owner === owner).length;

describe('Cloud std-woe: "Whenever a source you control deals noncombat damage to an opponent, you may exile that many cards from the top of your library" (CR 120.3, 603.2)', () => {
  it('is automated', () => {
    expect(full(VALOR)).toBe(true);
  });
  it('CR 120.3, 603.2: 2 damage from a spell to the opponent exiles the top 2 cards of your library; to yourself it does not trigger', () => {
    let s = scenario([], { defs: VALOR_DEFS, p1: { hand: ['Test Zap', 'Test Zap'], battlefield: ['Test Valor'] } });
    s = resolveAll(cast(s, 'Test Zap', { targets: [[{ kind: 'player', id: 'p2' }]] }), { yes: [true] });
    expect(exiledOf(s, 'p1')).toBe(2);
    s = resolveAll(cast(s, 'Test Zap', { targets: [[{ kind: 'player', id: 'p1' }]] }), { yes: [true] });
    expect(exiledOf(s, 'p1')).toBe(2);
  });
  it('CR 510.2: combat damage does not trigger it', () => {
    let s = scenario([], { defs: VALOR_DEFS, p1: { battlefield: ['Test Valor', 'Test Bear'] } });
    s = attackUnblocked(s, [find(s, 'Test Bear', 'battlefield', 'p1')]);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(18);
    expect(exiledOf(s, 'p1')).toBe(0);
  });
});

// ---- Redtooth Vanguard's shape: a trigger that works only from the graveyard --------------------------------------------------------------------------

const VANGUARD = card('Test Vanguard', 'Creature — Elf Warrior', 'Whenever an enchantment you control enters, you may pay {2}. If you do, return Test Vanguard from your graveyard to your hand.', '{1}{G}', ['3', '1']);
const CHARM = card('Test Charm', 'Enchantment', '');
const VANGUARD_DEFS = [VANGUARD, CHARM, BEAR];

describe('Cloud std-woe: "... return ~ from your graveyard to your hand" triggers only from the graveyard (CR 113.6m, 603.3)', () => {
  it('is automated', () => {
    expect(full(VANGUARD)).toBe(true);
  });
  it('CR 113.6m, 118.12: from the graveyard, an enchantment entering lets you pay {2} to return it to your hand', () => {
    let s = scenario([], { defs: VANGUARD_DEFS, p1: { hand: ['Test Charm'], graveyard: ['Test Vanguard'], battlefield: ['Plains', 'Plains'] } });
    s = resolveAll(cast(s, 'Test Charm'), { yes: [true] });
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Vanguard']);
  });
  it('CR 113.6m: on the battlefield it does not trigger; a creature entering does not trigger it either', () => {
    let s = scenario([], { defs: VANGUARD_DEFS, p1: { hand: ['Test Charm', 'Test Bear'], battlefield: ['Test Vanguard', 'Plains', 'Plains', 'Plains'] } });
    s = resolveAll(cast(s, 'Test Charm'));
    expect(s.pending?.kind).toBe('priority');
    let t = scenario([], { defs: VANGUARD_DEFS, p1: { hand: ['Test Bear'], graveyard: ['Test Vanguard'], battlefield: ['Plains', 'Plains', 'Plains'] } });
    t = resolveAll(cast(t, 'Test Bear'), { yes: [true] });
    expect(t.zones.graveyard.p1!.map((id) => t.objects[id]!.defId)).toEqual(['Test Vanguard']);
  });
});

// ---- Goddric's shape: a conditional identity with a "with" list -----------------------------------------------------------------------------------------

const REVELER = card('Test Reveler', 'Creature — Human Noble', 'Haste\nAs long as it\'s your turn, Test Reveler is a Dragon with base power and toughness 4/4, flying, and "{R}: Dragons you control get +1/+0 until end of turn."', '{1}{R}{R}', ['3', '3']);

describe('Cloud std-woe: "As long as C, ~ is a Dragon with base power and toughness 4/4, flying, and "..."" (CR 205.1b, 613.1d, 613.1f, 613.4b, 611.3a)', () => {
  it('is automated', () => {
    expect(full(REVELER)).toBe(true);
  });
  it('CR 613.1d, 613.4b, 613.1f: while the condition holds it is a 4/4 Dragon (no other creature type) with flying and the quoted ability; otherwise a 3/3 Human Noble', () => {
    let s = scenario([], { defs: [REVELER], p1: { battlefield: ['Test Reveler'] } });
    const id = find(s, 'Test Reveler', 'battlefield', 'p1');
    let c = getChars(s, id);
    expect(`${c.power}/${c.toughness}`).toBe('4/4');
    expect(c.subtypes).toEqual(['Dragon']);
    expect(hasKeyword(c, 'flying')).toBe(true);
    expect(hasKeyword(c, 'haste')).toBe(true);
    expect(c.abilities.some((a) => a.def.kind === 'activated')).toBe(true);
    s = advanceTo(s, 2, 'main1');
    c = getChars(s, id);
    expect(`${c.power}/${c.toughness}`).toBe('3/3');
    expect([...c.subtypes].sort()).toEqual(['Human', 'Noble']);
    expect(hasKeyword(c, 'flying')).toBe(false);
  });
});

// ---- Charging Hooligan's and Questing Druid's triggers -------------------------------------------------------------------------------------------------

const HOOLIGAN = card('Test Hooligan', 'Creature — Human Peasant', 'Whenever Test Hooligan attacks, it gets +1/+0 until end of turn for each attacking creature. If a Rat is attacking, Test Hooligan gains trample until end of turn.', '{3}{R}', ['3', '3']);
const RAT = card('Test Rat', 'Creature — Rat', '', '{1}', ['1', '1']);
const DRUID = card('Test Druid', 'Creature — Human Druid', 'Whenever you cast a spell that\'s white, blue, black, or red, put a +1/+1 counter on Test Druid.', '{1}{G}', ['1', '1']);
const SPARK = card('Test Spark', 'Instant', 'Draw a card.', '{R}', undefined, ['R']);
const SPROUT = card('Test Sprout', 'Instant', 'Draw a card.', '{G}', undefined, ['G']);

describe('Cloud std-woe: "If a Rat is attacking" and a trigger read at the comma (CR 508.1k, 603.4, 603.2)', () => {
  it('is automated', () => {
    expect(full(HOOLIGAN)).toBe(true);
    expect(full(DRUID)).toBe(true);
  });
  it('CR 508.1k, 506.4: attacking with a Rat it gets +2/+0 and trample; alone +1/+0 and no trample', () => {
    let s = scenario([], { defs: [HOOLIGAN, RAT], p1: { battlefield: ['Test Hooligan', 'Test Rat'] } });
    const h = find(s, 'Test Hooligan', 'battlefield', 'p1');
    s = resolveAll(declareAttackers(toDeclareAttackers(s), [[h], [find(s, 'Test Rat', 'battlefield', 'p1')]]));
    expect(String(getChars(s, h).power)).toBe('5');
    expect(hasKeyword(getChars(s, h), 'trample')).toBe(true);
    let t = scenario([], { defs: [HOOLIGAN, RAT], p1: { battlefield: ['Test Hooligan', 'Test Rat'] } });
    const h2 = find(t, 'Test Hooligan', 'battlefield', 'p1');
    t = resolveAll(declareAttackers(toDeclareAttackers(t), [[h2]]));
    expect(String(getChars(t, h2).power)).toBe('4');
    expect(hasKeyword(getChars(t, h2), 'trample')).toBe(false);
  });
  it('CR 603.2, 105.2: a red spell puts a counter on it; a green one does not', () => {
    let s = scenario(['Mountain', 'Forest'], { defs: [DRUID, SPARK, SPROUT, BEAR], p1: { hand: ['Test Spark', 'Test Sprout'], battlefield: ['Test Druid', 'Mountain', 'Forest'], library: ['Test Bear', 'Test Bear'] } });
    const d = find(s, 'Test Druid', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Test Spark'));
    expect(s.objects[d]!.counters['+1/+1']).toBe(1);
    s = resolveAll(cast(s, 'Test Sprout'));
    expect(s.objects[d]!.counters['+1/+1']).toBe(1);
  });
});

// ---- Free the Fae's and Blossoming Tortoise's mills ---------------------------------------------------------------------------------------------------

const FREE = card('Test Free', 'Instant', 'Mill four cards. Then put an instant, sorcery, or Faerie card from among the milled cards into your hand.');
const TORTOISE = card('Test Tortoise', 'Creature — Turtle', 'Whenever Test Tortoise enters or attacks, mill three cards, then return a land card from your graveyard to the battlefield tapped.', '{0}', ['2', '4']);

describe('Cloud std-woe: a pick from among the milled cards, and a land returned tapped (CR 701.17a, 608.2c-d, 110.2)', () => {
  it('is automated', () => {
    expect(full(FREE)).toBe(true);
    expect(full(TORTOISE)).toBe(true);
  });
  it('CR 701.17a, 608.2d: the instant among the four milled cards goes to your hand, the creatures stay in the graveyard', () => {
    let s = scenario([], { defs: [FREE, BEAR, KILL], p1: { hand: ['Test Free'], library: ['Test Bear', 'Test Kill', 'Test Bear', 'Test Bear'] } });
    s = resolveAll(cast(s, 'Test Free'));
    expect(s.zones.hand.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Kill']);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Bear', 'Test Bear', 'Test Bear', 'Test Free']);
  });
  it('CR 608.2d: with no such card among them nothing is put into your hand', () => {
    let s = scenario([], { defs: [FREE, BEAR], p1: { hand: ['Test Free'], library: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] } });
    s = resolveAll(cast(s, 'Test Free'));
    expect(s.zones.hand.p1!).toEqual([]);
  });
  it('CR 110.2, 701.17a: when it enters, it mills three and a land card from the graveyard returns to the battlefield tapped', () => {
    let s = scenario([], { defs: [TORTOISE, BEAR], p1: { hand: ['Test Tortoise'], graveyard: ['Plains'], library: ['Test Bear', 'Test Bear', 'Test Bear'] } });
    s = resolveAll(cast(s, 'Test Tortoise'));
    const plains = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.controller === 'p1');
    expect(plains).toHaveLength(1);
    expect(s.objects[plains[0]!]!.tapped).toBe(true);
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Bear', 'Test Bear', 'Test Bear']);
  });
});
