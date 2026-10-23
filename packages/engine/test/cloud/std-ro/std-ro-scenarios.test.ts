/**
 * Precon round O (std-ro): the readings of the round played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10). Each test is named after the rule it checks (CR cites from memory, unverified: rules/cr/ is not in the cloud checkout).
 *
 *   CR 701.20a, 608.2c   "Reveal the top N cards of your library. Put all <cards> revealed this way into your hand and the rest into your graveyard."
 *   CR 401.4             "... and the rest on the bottom of your library in any order": the rest goes to the bottom, the cards below the revealed ones move up
 *   CR 700.4, 404.1      "Whenever a creature is put into your graveyard from the battlefield": a creature its owner owns dies, whoever's creature it is not
 *   CR 903.8, 707.10f    "copy it for each time you've cast your commander from the command zone this game" on a creature spell: each copy becomes a token
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { find, findAll, scenario } from '../../m5/helpers';
import { cast, resolveAll, target } from '../../m5/cr-examples/helpers';
import {
  act as act11, answerUntilPriority, card as card11, commanderRec, commanderScenario, drive, find as find11, forests, legend, pass as pass11, tweak,
} from '../../m11/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OX = card('Test Ox', 'Creature — Ox', '', ['3', '3']);
const ROCK = card('Test Rock', 'Artifact', '');
const SIFT = card('Test Land Sift', 'Sorcery', 'Reveal the top four cards of your library. Put all land cards revealed this way into your hand and the rest into your graveyard.');
const CALL = card('Test Beast Call', 'Sorcery', 'Reveal the top three cards of your library. Put all creature cards revealed this way into your hand and the rest on the bottom of your library in any order.');
const MOURNER = card('Test Mourner', 'Enchantment', 'Whenever a nontoken creature is put into your graveyard from the battlefield, you gain 1 life.');
const KEEPER = card('Test Keeper', 'Creature — Spirit', 'When this creature is put into your graveyard from the battlefield, you gain 3 life.', ['1', '1']);
const SLAY = card('Test Slay', 'Instant', 'Destroy target creature.');
const DEFS = [BEAR, OX, ROCK, SIFT, CALL, MOURNER, KEEPER, SLAY];

const names = (s: GameState, ids: readonly ObjectId[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name);
const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;

describe('std-ro cards compile fully', () => {
  it('the synthetic cards of these scenarios are fully automated', () => {
    for (const d of [SIFT, CALL, MOURNER, KEEPER, SLAY]) expect(full(d), d.name).toBe(true);
  });
});

describe('CR 701.20a, 608.2c: "Put all land cards revealed this way into your hand and the rest into your graveyard."', () => {
  it('the land cards among the four revealed go to the hand, the other revealed cards to the graveyard; the fifth card stays on top of the library', () => {
    let s = scenario([], { p1: { hand: ['Test Land Sift'], library: ['Plains', 'Test Bear', 'Plains', 'Test Rock', 'Test Ox'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Land Sift'));
    expect(names(s, s.zones.hand['p1']!).sort()).toEqual(['Plains', 'Plains']);
    expect(names(s, s.zones.graveyard['p1']!).sort()).toEqual(['Test Bear', 'Test Land Sift', 'Test Rock']);
    expect(names(s, [s.zones.library['p1']![0]!])).toEqual(['Test Ox']);
  });
  it('no land card among them: nothing goes to the hand, all four go to the graveyard', () => {
    let s = scenario([], { p1: { hand: ['Test Land Sift'], library: ['Test Bear', 'Test Rock', 'Test Ox', 'Test Bear'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Land Sift'));
    expect(s.zones.hand['p1']).toHaveLength(0);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1')).toHaveLength(2);
    expect(findAll(s, 'Test Ox', 'graveyard', 'p1')).toHaveLength(1);
  });
});

describe('CR 401.4: "... and the rest on the bottom of your library in any order"', () => {
  it('the creature cards go to the hand, the other revealed cards to the bottom; the library keeps its size less the creatures', () => {
    let s = scenario([], { p1: { hand: ['Test Beast Call'], library: ['Test Bear', 'Test Rock', 'Test Ox', 'Test Rock'] }, defs: DEFS });
    const size = s.zones.library['p1']!.length;
    s = resolveAll(cast(s, 'Test Beast Call'));
    expect(names(s, s.zones.hand['p1']!).sort()).toEqual(['Test Bear', 'Test Ox']);
    const lib = s.zones.library['p1']!;
    expect(lib).toHaveLength(size - 2);
    expect(names(s, lib.slice(-1))).toEqual(['Test Rock']); // the one revealed noncreature card is now at the bottom
    expect(names(s, [lib[0]!])).toEqual(['Test Rock']); // the fourth card, not revealed, is the new top card
    expect(findAll(s, 'Test Rock', 'graveyard', 'p1')).toHaveLength(0);
  });
});

describe('CR 700.4, 404.1: "Whenever a nontoken creature is put into your graveyard from the battlefield"', () => {
  it('a creature you own dies: you gain 1 life; a creature an opponent owns dies: nothing', () => {
    let s = scenario([], { p1: { hand: ['Test Slay', 'Test Slay'], battlefield: ['Test Mourner', 'Test Bear'] }, p2: { battlefield: ['Test Ox'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Slay', [target(find(s, 'Test Bear', 'battlefield'))]));
    expect(life(s, 'p1')).toBe(21);
    s = resolveAll(cast(s, 'Test Slay', [target(find(s, 'Test Ox', 'battlefield'))]));
    expect(findAll(s, 'Test Ox', 'graveyard', 'p2')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(21);
  });
  it('CR 404.1: a creature p1 owns but p2 controls goes to p1\'s graveyard: it triggers p1\'s ability', () => {
    let s = scenario([], { p1: { hand: ['Test Slay'], battlefield: ['Test Mourner'] }, p2: { battlefield: [] }, defs: DEFS });
    s = structuredClone(s);
    const bear = `o${s.counters.object}`;
    s.objects[bear] = { ...s.objects[find(s, 'Test Mourner', 'battlefield')]!, id: bear, cardId: `c${s.counters.card++}`, defId: 'Test Bear', controller: 'p2', timestamp: s.counters.timestamp++ };
    s.counters.object++;
    s.zones.battlefield.push(bear);
    s = resolveAll(cast(s, 'Test Slay', [target(bear)]));
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(21);
  });
  it('"When this creature is put into your graveyard from the battlefield": it dies, its owner gains 3 life', () => {
    let s = scenario([], { p1: { hand: ['Test Slay'], battlefield: ['Test Keeper'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Slay', [target(find(s, 'Test Keeper', 'battlefield'))]));
    expect(findAll(s, 'Test Keeper', 'graveyard', 'p1')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(23);
  });
});

describe('CR 903.8, 707.10f: a creature spell copied for each time you\'ve cast your commander from the command zone', () => {
  const TITANIA = legend('Test Titania', '{1}{G}', ['2', '2'], ['G']);
  const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
  const SQUAD = card11('Test Strike Squad', '{2}{G}', 'Creature — Human Warrior', 'When you cast this spell, copy it for each time you\'ve cast your commander from the command zone this game.', ['2', '1']);
  const resolve = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 30 && s.zones.stack.length > 0; i++) s = drive(pass11(pass11(s)));
    return s;
  };
  it('two casts of the commander: the creature and two token copies of it are on the battlefield', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [SQUAD], p1: { battlefield: forests(3), hand: ['Test Strike Squad'] } });
    s = tweak(s, (t) => { commanderRec(t, 'p1', 'Test Titania').casts = 2; });
    s = answerUntilPriority(act11(s, { type: 'cast', player: 'p1', card: find11(s, 'Test Strike Squad', 'hand', 'p1') }));
    s = resolve(s);
    const squads = s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]?.name === 'Test Strike Squad' || s.objects[id]!.kind === 'token');
    expect(squads).toHaveLength(3);
    expect(squads.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(2);
  });
  it('no cast of the commander yet: only the creature', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [SQUAD], p1: { battlefield: forests(3), hand: ['Test Strike Squad'] } });
    s = answerUntilPriority(act11(s, { type: 'cast', player: 'p1', card: find11(s, 'Test Strike Squad', 'hand', 'p1') }));
    s = resolve(s);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(0);
    expect(findAll(s, 'Test Strike Squad', 'battlefield')).toHaveLength(1);
  });
});
