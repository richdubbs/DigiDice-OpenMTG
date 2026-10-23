/**
 * Standard round 6 (single-sentence gaps of Standard cards): the templates of parser/templates/zz-cloud/std-r6.json and the parser, lowering and renderer
 * support of the round, played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10).
 * Each test is named after the rule it checks.
 *
 *   CR 119.1, 102.3, 608.2c   "You gain 3 life if an opponent has more life than you." (Beza, the Bounding Spring)
 *   CR 604.3, 305.6, 205.3i   "~'s power is equal to the number of basic land types among lands you control." (domain as a quantity)
 *   CR 701.24a, 303.4, 401.1  "Enchanted creature's owner shuffles it into their library." (Watery Grasp)
 *   CR 121.1, 119.7, 614.17   "Players can't draw cards or gain life." (Mornsong Aria)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, legal, life, pass, put, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const library = (s: GameState, p: PlayerId): number => s.zones.library[p]!.length;
const setLife = (s: GameState, p: PlayerId, n: number): void => { s.players.find((x) => x.id === p)!.life = n; };

/** Answer the decisions that come up until priority (payments automatic; targets in order; other choices the first allowed). */
function drive(s0: GameState, targets: ObjectId[][] = []): GameState {
  let s = s0;
  const q = [...targets];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (q.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, targets?: ObjectId[][]): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), targets);
  return s;
}
const cast = (s: GameState, name: string, targets?: ObjectId[][]): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets), targets);

describe('CR 119.1, 102.3, 608.2c: "You gain 3 life if an opponent has more life than you." (an instruction done only if its own comparison holds)', () => {
  const HERALD = card('Test Herald', 'Creature — Elk', 'When this creature enters, you gain 3 life if an opponent has more life than you.', { pt: ['2', '2'] });
  it('is understood', () => expect(noManual(HERALD)).toBe(true));
  it('an opponent with more life than you: you gain 3 life', () => {
    const s0 = scenario([], { defs: [HERALD], p1: { hand: ['Test Herald'] } });
    setLife(s0, 'p1', 10);
    setLife(s0, 'p2', 12);
    expect(life(cast(s0, 'Test Herald'), 'p1')).toBe(13);
  });
  it('an opponent with as much life as you (a tie is not more): no life gained', () => {
    const s0 = scenario([], { defs: [HERALD], p1: { hand: ['Test Herald'] } });
    setLife(s0, 'p1', 12);
    setLife(s0, 'p2', 12);
    expect(life(cast(s0, 'Test Herald'), 'p1')).toBe(12);
  });
});

describe('CR 604.3, 613.4a, 305.6: "~\'s power is equal to the number of basic land types among lands you control." (domain, a characteristic-defining ability)', () => {
  const SCOUT = card('Test Scout', 'Creature — Homunculus', "This creature's power is equal to the number of basic land types among lands you control.", { pt: ['*', '3'] });
  const SNOW = card('Test Snowfield', 'Land — Island Swamp', '');
  it('is understood', () => expect(noManual(SCOUT)).toBe(true));
  it('counts each basic land type once, among lands with several types too; an opponent\'s lands do not count; the toughness stays the printed one', () => {
    const s = scenario(['Island', 'Forest'], { defs: [SCOUT, SNOW], p1: { battlefield: ['Test Scout', 'Plains', 'Plains', 'Island', 'Test Snowfield'] }, p2: { battlefield: ['Forest'] } });
    const c = getChars(s, find(s, 'Test Scout', 'battlefield'));
    expect(Number(c.power)).toBe(3); // Plains, Island, Swamp (the dual land's Island is counted once)
    expect(Number(c.toughness)).toBe(3);
  });
  it('no lands: power 0', () => {
    const s = scenario([], { defs: [SCOUT], p1: { battlefield: ['Test Scout'] } });
    s.zones.battlefield = s.zones.battlefield.filter((id) => s.objects[id]!.defId !== 'Plains');
    expect(Number(getChars(s, find(s, 'Test Scout', 'battlefield')).power)).toBe(0);
  });
});

describe('CR 701.24a, 303.4, 401.1: "{2}: Enchanted creature\'s owner shuffles it into their library."', () => {
  const GRIP = card('Test Undertow', 'Enchantment — Aura', "Enchant creature\n{2}: Enchanted creature's owner shuffles it into their library.");
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '3'] });
  it('is understood', () => expect(noManual(GRIP)).toBe(true));
  it('the creature the Aura is attached to goes into its owner\'s library (an opponent\'s), which is then shuffled; the Aura goes to its owner\'s graveyard (CR 704.5m)', () => {
    const s0 = scenario([], { defs: [GRIP, OGRE], p1: { battlefield: ['Plains', 'Plains'] }, p2: { battlefield: ['Test Ogre'] } });
    const ogre = find(s0, 'Test Ogre', 'battlefield');
    const aura = put(s0, 'p1', 'battlefield', 'Test Undertow'); // attached as it is put (an Aura attached to nothing is put into the graveyard, CR 704.5m)
    s0.objects[aura]!.attachedTo = ogre;
    const lib2 = library(s0, 'p2');
    const lib1 = library(s0, 'p1');
    const activation = legal(s0, 'p1', 'activate').find((a) => a.action.type === 'activate' && a.action.source === aura && !a.isMana);
    expect(activation?.action).toMatchObject({ ability: 'p:0:1' }); // the second ability of the face (the first is "Enchant creature")
    const s = resolveAll(drive(act(s0, activation!.action)));
    expect(findAll(s, 'Test Ogre', 'battlefield')).toHaveLength(0);
    expect(findAll(s, 'Test Ogre', 'library', 'p2')).toHaveLength(1);
    expect(library(s, 'p2')).toBe(lib2 + 1);
    expect(library(s, 'p1')).toBe(lib1);
    expect(findAll(s, 'Test Undertow', 'graveyard', 'p1')).toHaveLength(1);
  });
});

describe('CR 121.1, 119.7, 614.17: "Each player can\'t draw cards or gain life."', () => {
  const ARIA = card('Test Hush', 'Enchantment', "Each player can't draw cards or gain life.");
  const STUDY = card('Test Study', 'Sorcery', 'Draw two cards.');
  const SALVE = card('Test Salve', 'Sorcery', 'You gain 4 life.');
  it('is understood', () => expect(noManual(ARIA)).toBe(true));
  it('a draw spell draws nothing and a life gain gains nothing while it is on the battlefield', () => {
    const s0 = scenario([], { defs: [ARIA, STUDY, SALVE], p1: { hand: ['Test Study', 'Test Salve'], battlefield: ['Test Hush'] } });
    const h0 = hand(s0, 'p1');
    const s1 = cast(s0, 'Test Study');
    expect(hand(s1, 'p1')).toBe(h0 - 1);
    const s2 = cast(s1, 'Test Salve');
    expect(life(s2, 'p2')).toBe(life(s0, 'p2'));
    expect(life(s2, 'p1')).toBe(life(s0, 'p1'));
  });
  it('the opponent\'s draw step draws no card either (CR 504.1, 121.1)', () => {
    let s = scenario([], { defs: [ARIA], p1: { battlefield: ['Test Hush'] } });
    const h2 = hand(s, 'p2');
    for (let i = 0; i < 80 && !(s.turn.activePlayer === 'p2' && s.turn.step === 'main1'); i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    expect(s.turn.activePlayer).toBe('p2');
    expect(hand(s, 'p2')).toBe(h2);
  });
});
