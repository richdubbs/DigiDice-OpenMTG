/**
 * CLOUD std-dft (Aetherdrift Standard backlog): the engine behaviour of what the slice added, played through the engine with synthetic cards compiled by the
 * game's default compiler (wordings invented, design 6.10).
 *
 *   CR 107.3a, 702.29a     the X of "Cycling {X}{1}" is announced as the cycling ability is activated; "when you cycle ~" reads it (triggers/stack.ts)
 *   CR 702.29c, 609.7a     "when you cycle ~, it deals 2 damage to each opponent": the cycled card (in the graveyard) is the source
 *   CR 603.4, 102.1        "if it's not their turn": the intervening condition reads the turn of the player who cast the spell
 *   CR 122.1, 608.2c       "then if it has an odd number of counters on it"
 *   CR 614.1a, 120.3       "it deals that much damage plus 1 instead" to an opponent or a permanent an opponent controls only
 *   CR 603.2c, 406.1       "whenever one or more cards are put into exile from graveyards and/or the battlefield during your turn": one trigger per event batch
 *   CR 603.2, 701.26a      "whenever ~ becomes tapped during your turn, untap it" (and "This ability triggers only once each turn", CR 603.2h)
 *   CR 701.17a, 115.1      "any number of target players each mill two cards"; "... cards equal to the number of cards in their graveyard"
 *   CR 701.23a, 701.24a    "search your library and/or graveyard ...": the searcher picks the zones; "if you search your library this way, shuffle"
 *   CR 611.3a, 613.1d      "during turns other than yours, this Vehicle is an artifact creature"
 *   CR 613.4b, 205.1b      "creatures you control have base power and toughness 6/6 and are Oozes in addition to their other types"
 *   CR 613.4b, 608.2h      "you may have the base power and toughness of each other creature you control become equal to ~'s power" (fixed as it resolves)
 *   CR 109.2, 611.2c       "each other nonartifact creature gets -1/-1 until end of turn"
 *   CR 702.21a, 613.1f     'Artifacts you control have "Ward--Pay 2 life."'
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability automated and the card full (an experimental template would cap it at partial). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const ctr = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]?.counters[kind] ?? 0;
const pt = (s: GameState, id: ObjectId): [number, number] => [Number(getChars(s, id)!.power), Number(getChars(s, id)!.toughness)];
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const lib = (s: GameState, p: string): ObjectId[] => s.zones.library[p]!;
const yard = (s: GameState, p: string): ObjectId[] => s.zones.graveyard[p]!;
const tokens = (s: GameState, p: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);

/** Answer the decisions that come up: pay costs automatically, then the queued answers in order; stop at priority. */
function settle(s0: GameState, answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
const resolve = (s: GameState, answers: DecisionAnswer[] = []): GameState => settle(pass(pass(s)), answers);
/** Cast a card from a player's hand, answering the decisions, and leave it on the stack. */
const cast = (s: GameState, name: string, answers: DecisionAnswer[] = [], player = 'p1'): GameState => settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), answers);
/** Activate the non-mana ability of an object (the first one, or the one whose text contains `text`). */
function activate(s: GameState, id: ObjectId, answers: DecisionAnswer[] = [], text?: string, player = 'p1'): GameState {
  const la = legal(s, player, 'activate').find((a) => a.object === id && !a.isMana && (text === undefined || a.label.includes(text)));
  if (!la) throw new Error(`no ability to activate on ${s.objects[id]?.defId}${text ? ` (${text})` : ''}`);
  return settle(act(s, la.action), answers);
}

describe('CR 107.3a, 702.29a: "Cycling {X}{1}" and "When you cycle this card, ... X": the X announced for the cycling cost', () => {
  const SURGE = card('Test Surge', 'Creature — Bird', 'Cycling {X}{1}\nWhen you cycle this card, create X 1/1 white Soldier creature tokens.', ['2', '2'], '{3}{W}');
  const SNARE = card('Test Snare', 'Creature — Spider', 'Cycling {X}{1}\nWhen you cycle this card, destroy up to one target artifact with mana value X.', ['2', '2'], '{2}{G}');
  const RELIC = card('Test Relic', 'Artifact', '', undefined, '{2}');
  const IDOL = card('Test Idol', 'Artifact', '', undefined, '{3}');
  it('the cards are automated; an X-reading cycle trigger of a card whose cycling cost has no X is not (CR 107.3)', () => {
    expect(full(SURGE)).toBe(true);
    expect(full(SNARE)).toBe(true);
    expect(full(card('Test Plain Cycler', 'Creature — Bird', 'Cycling {1}\nWhen you cycle this card, create X 1/1 white Soldier creature tokens.', ['2', '2']))).toBe(false);
    expect(full(card('Test Wrong X', 'Creature — Bird', 'Cycling {X}{1}\nWhen this creature enters, create X 1/1 white Soldier creature tokens.', ['2', '2']))).toBe(false);
  });
  it('X = 2: two tokens; X = 0: none', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Surge'], battlefield: ['Plains', 'Plains', 'Plains'] }, defs: [SURGE] });
    let s = activate(s0, find(s0, 'Test Surge', 'hand', 'p1'), [{ kind: 'chooseNumber', n: 2 }]);
    expect(s.zones.stack.length).toBe(2); // the cycling ability and the trigger (from the graveyard, CR 702.29c)
    s = resolve(resolve(s));
    expect(tokens(s, 'p1').length).toBe(2);
    const z0 = scenario(['Plains'], { p1: { hand: ['Test Surge'], battlefield: ['Plains', 'Plains', 'Plains'] }, defs: [SURGE] });
    let z = activate(z0, find(z0, 'Test Surge', 'hand', 'p1'), [{ kind: 'chooseNumber', n: 0 }]);
    z = resolve(resolve(z));
    expect(tokens(z, 'p1').length).toBe(0);
  });
  it('X = 2: the artifact with mana value 2 can be the target and is destroyed; the one with mana value 3 stays', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Snare'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Relic', 'Test Idol'] }, defs: [SNARE, RELIC, IDOL] });
    const relic = find(s0, 'Test Relic', 'battlefield');
    let s = activate(s0, find(s0, 'Test Snare', 'hand', 'p1'), [{ kind: 'chooseNumber', n: 2 }, { kind: 'chooseTargets', targets: [obj(relic)] }]);
    s = resolve(resolve(s));
    expect(findAll(s, 'Test Relic', 'battlefield')).toEqual([]);
    expect(findAll(s, 'Test Idol', 'battlefield').length).toBe(1);
  });
});

describe('CR 702.29c, 609.7a: "When you cycle this card, it deals 2 damage to each opponent" (the cycled card is the source)', () => {
  const EMBER = card('Test Ember', 'Creature — Elemental', 'Cycling {1}\nWhen you cycle this card, it deals 2 damage to each opponent.', ['3', '1'], '{2}{R}');
  it('is automated, and each opponent is dealt 2 damage', () => {
    expect(full(EMBER)).toBe(true);
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Ember'], battlefield: ['Mountain'] }, defs: [EMBER] });
    const s = resolve(resolve(activate(s0, find(s0, 'Test Ember', 'hand', 'p1'))));
    expect(life(s, 'p2')).toBe(18);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 603.4, 102.1: "Whenever a player casts a spell, if it\'s not their turn, this creature deals 2 damage to them."', () => {
  const JOCKEY = card('Test Jockey', 'Creature — Minotaur', "Whenever a player casts a spell, if it's not their turn, this creature deals 2 damage to them.", ['2', '2']);
  const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.');
  it('is automated', () => expect(full(JOCKEY)).toBe(true));
  it("a spell the opponent casts during my turn: the opponent is dealt 2 damage; my own spell during my turn: nothing", () => {
    const s0 = scenario([], { p1: { hand: ['Test Spark'], battlefield: ['Test Jockey'] }, p2: { hand: ['Test Spark'] }, defs: [JOCKEY, SPARK] });
    let s = pass(s0); // p1 passes in their main phase: p2 receives priority (CR 117.3d)
    expect(s.pending?.player).toBe('p2');
    s = cast(s, 'Test Spark', [], 'p2');
    s = resolve(resolve(s)); // the trigger, then the spell
    expect(life(s, 'p2')).toBe(19); // 20 - 2 + 1
    const t0 = scenario([], { p1: { hand: ['Test Spark'], battlefield: ['Test Jockey'] }, defs: [JOCKEY, SPARK] });
    let t = cast(t0, 'Test Spark');
    expect(t.zones.stack.length).toBe(1); // the condition is false as the spell is cast: no trigger (CR 603.4)
    t = resolve(t);
    expect(life(t, 'p1')).toBe(21);
  });
});

describe('CR 122.1, 608.2c: "{T}: Put a +1/+1 counter on this creature. Then if it has an odd number of counters on it, draw a card."', () => {
  const CLOCK = card('Test Clockwork', 'Artifact Creature — Construct', '{T}: Put a +1/+1 counter on this creature. Then if it has an odd number of counters on it, draw a card.', ['1', '1']);
  it('is automated; the first counter (one: odd) draws, the second (two: even) does not', () => {
    expect(full(CLOCK)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Clockwork'] }, defs: [CLOCK] });
    const id = find(s0, 'Test Clockwork', 'battlefield');
    const before = handSize(s0, 'p1');
    let s = resolve(activate(s0, id));
    expect(ctr(s, id)).toBe(1);
    expect(handSize(s, 'p1')).toBe(before + 1);
    s = advanceTo(s, 3, 'main1');
    const mid = handSize(s, 'p1');
    s = resolve(activate(s, id));
    expect(ctr(s, id)).toBe(2);
    expect(handSize(s, 'p1')).toBe(mid);
  });
});

describe('CR 614.1a, 120.3: "If a source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 1 instead."', () => {
  const SPITE = card('Test Spite', 'Enchantment', 'If a source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 1 instead.');
  const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 2 damage to any target.');
  const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '9']);
  it('is automated', () => expect(full(SPITE)).toBe(true));
  it('to the opponent: 3; to a creature the opponent controls: 3; to my own creature: 2', () => {
    const s0 = scenario([], { p1: { hand: ['Test Shock', 'Test Shock', 'Test Shock'], battlefield: ['Test Spite', 'Test Wall'] }, p2: { battlefield: ['Test Wall'] }, defs: [SPITE, SHOCK, WALL] });
    const mine = find(s0, 'Test Wall', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Wall', 'battlefield', 'p2');
    let s = resolve(cast(s0, 'Test Shock', [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]));
    expect(life(s, 'p2')).toBe(17);
    s = resolve(cast(s, 'Test Shock', [{ kind: 'chooseTargets', targets: [obj(theirs)] }]));
    expect(s.objects[theirs]!.damage).toBe(3);
    s = resolve(cast(s, 'Test Shock', [{ kind: 'chooseTargets', targets: [obj(mine)] }]));
    expect(s.objects[mine]!.damage).toBe(2);
  });
});

describe('CR 603.2c, 406.1: "Whenever one or more cards are put into exile from graveyards and/or the battlefield during your turn, you draw a card and lose 1 life."', () => {
  const VIGIL = card('Test Vigil', 'Enchantment', 'Whenever one or more cards are put into exile from graveyards and/or the battlefield during your turn, you draw a card and lose 1 life.');
  const PURGE = card('Test Purge', 'Instant', "Exile target player's graveyard.");
  const BANISH = card('Test Banish', 'Instant', 'Exile target creature.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  it('is automated', () => expect(full(VIGIL)).toBe(true));
  it('three cards exiled from a graveyard at once during my turn: one trigger (draw one, lose 1)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Purge'], battlefield: ['Test Vigil'] }, p2: { graveyard: ['Test Bear', 'Test Bear', 'Test Bear'] }, defs: [VIGIL, PURGE, BEAR] });
    expect(full(PURGE)).toBe(true);
    const before = handSize(s0, 'p1') - 1;
    const s = resolve(resolve(cast(s0, 'Test Purge', [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }])));
    expect(yard(s, 'p2')).toEqual([]);
    expect(handSize(s, 'p1')).toBe(before + 1);
    expect(life(s, 'p1')).toBe(19);
  });
  it("a creature exiled from the battlefield during my turn triggers; during the opponent's turn it does not", () => {
    const s0 = scenario([], { p1: { hand: ['Test Banish', 'Test Banish'], battlefield: ['Test Vigil'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] }, defs: [VIGIL, BANISH, BEAR] });
    const [b1, b2] = findAll(s0, 'Test Bear', 'battlefield', 'p2');
    let s = resolve(resolve(cast(s0, 'Test Banish', [{ kind: 'chooseTargets', targets: [obj(b1!)] }])));
    expect(life(s, 'p1')).toBe(19);
    s = advanceTo(s, 2, 'main1');
    s = pass(s); // p2 passes in their main phase: p1 receives priority
    const lifeBefore = life(s, 'p1');
    s = resolve(cast(s, 'Test Banish', [{ kind: 'chooseTargets', targets: [obj(b2!)] }]));
    expect(findAll(s, 'Test Bear', 'battlefield', 'p2')).toEqual([]);
    expect(s.zones.stack).toEqual([]);
    expect(life(s, 'p1')).toBe(lifeBefore);
  });
});

describe('CR 603.2, 603.2h: "Whenever this creature becomes tapped during your turn, untap it. This ability triggers only once each turn."', () => {
  const ACE = card('Test Ace', 'Artifact Creature — Robot', 'Whenever this creature becomes tapped during your turn, untap it. This ability triggers only once each turn.\n{T}: You gain 1 life.', ['1', '3']);
  it('is automated; tapped for its ability during my turn it untaps once, the second time it stays tapped', () => {
    expect(full(ACE)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Ace'] }, defs: [ACE] });
    const id = find(s0, 'Test Ace', 'battlefield');
    let s = activate(s0, id);
    expect(s.objects[id]!.tapped).toBe(true);
    s = resolve(resolve(s)); // the untap trigger (on top), then the life gain
    expect(s.objects[id]!.tapped).toBe(false);
    expect(life(s, 'p1')).toBe(21);
    s = resolve(activate(s, id));
    expect(s.objects[id]!.tapped).toBe(true);
    expect(life(s, 'p1')).toBe(22);
  });
});

describe('CR 701.17a, 115.1: "Any number of target players each mill ..."', () => {
  const CHURN = card('Test Churn', 'Artifact', '{1}, {T}: Any number of target players each mill two cards.');
  const DEEP = card('Test Deep Churn', 'Artifact', '{T}: Any number of target players each mill cards equal to the number of cards in their graveyard.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  it('are automated; two targets each mill two', () => {
    expect(full(CHURN)).toBe(true);
    expect(full(DEEP)).toBe(true);
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Test Churn', 'Plains'] }, defs: [CHURN] });
    const s = resolve(activate(s0, find(s0, 'Test Churn', 'battlefield'), [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }, { kind: 'player', id: 'p2' }] }]));
    expect(yard(s, 'p1').length).toBe(2);
    expect(yard(s, 'p2').length).toBe(2);
  });
  it('each target player mills as many cards as their own graveyard holds', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Deep Churn'], graveyard: ['Test Bear', 'Test Bear', 'Test Bear'] }, p2: { graveyard: ['Test Bear'] }, defs: [DEEP, BEAR] });
    const s = resolve(activate(s0, find(s0, 'Test Deep Churn', 'battlefield'), [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }, { kind: 'player', id: 'p2' }] }]));
    expect(yard(s, 'p1').length).toBe(6);
    expect(yard(s, 'p2').length).toBe(2);
  });
});

describe('CR 701.23a, 701.24a: "Search your library and/or graveyard for a creature card, reveal it, and put it into your hand. If you search your library this way, shuffle."', () => {
  const QUEST = card('Test Quest', 'Sorcery', 'Search your library and/or graveyard for a creature card, reveal it, and put it into your hand. If you search your library this way, shuffle.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  it('is automated', () => expect(full(QUEST)).toBe(true));
  it('the graveyard alone: the card comes from there and the library is not shuffled', () => {
    const s0 = scenario([], { p1: { hand: ['Test Quest'], graveyard: ['Test Bear'] }, defs: [QUEST, BEAR] });
    const libBefore = [...lib(s0, 'p1')];
    const bear = find(s0, 'Test Bear', 'graveyard', 'p1');
    const s = resolve(cast(s0, 'Test Quest'), [{ kind: 'chooseOption', ids: ['graveyard'] }, { kind: 'chooseObjects', ids: [bear] }]);
    expect(findAll(s, 'Test Bear', 'hand', 'p1').length).toBe(1);
    expect(lib(s, 'p1')).toEqual(libBefore); // no new object ids: no shuffle (core/zones.ts#shuffleLibrary renews them)
  });
  it('the library too: the library is shuffled (every card a new object, CR 400.7)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Quest'], graveyard: ['Test Bear'], library: ['Test Bear'] }, defs: [QUEST, BEAR] });
    const libBefore = [...lib(s0, 'p1')];
    const inLib = find(s0, 'Test Bear', 'library', 'p1');
    const s = resolve(cast(s0, 'Test Quest'), [{ kind: 'chooseOption', ids: ['library', 'graveyard'] }, { kind: 'chooseObjects', ids: [inLib] }]);
    expect(findAll(s, 'Test Bear', 'hand', 'p1').length).toBe(1);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1').length).toBe(1);
    expect(lib(s, 'p1').some((id) => libBefore.includes(id))).toBe(false);
  });
});

describe('CR 611.3a, 613.1d: "During turns other than yours, this Vehicle is an artifact creature."', () => {
  const MANGLER = card('Test Mangler', 'Artifact — Vehicle', 'During turns other than yours, this Vehicle is an artifact creature.\nCrew 2', ['4', '4']);
  it('is automated; a creature only during the opponent\'s turn', () => {
    expect(full(MANGLER)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Mangler'] }, defs: [MANGLER] });
    const id = find(s0, 'Test Mangler', 'battlefield');
    expect(getChars(s0, id)!.types).not.toContain('Creature');
    const s = advanceTo(s0, 2, 'main1');
    expect(getChars(s, id)!.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
  });
});

describe('CR 613.4b, 205.1b: "Creatures you control have base power and toughness 6/6 and are Oozes in addition to their other types."', () => {
  const MARCH = card('Test March', 'Enchantment', 'Creatures you control have base power and toughness 6/6 and are Oozes in addition to their other types.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  it('is automated; a 2/2 Bear is a 6/6 Bear Ooze, a counter still counts (layer 7c after 7b), the opponent\'s Bear is unchanged', () => {
    expect(full(MARCH)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test March', 'Test Bear', { name: 'Test Bear', counters: { '+1/+1': 1 } }] }, p2: { battlefield: ['Test Bear'] }, defs: [MARCH, BEAR] });
    const [plain, grown] = findAll(s0, 'Test Bear', 'battlefield', 'p1');
    expect(pt(s0, plain!)).toEqual([6, 6]);
    expect(getChars(s0, plain!)!.subtypes).toEqual(expect.arrayContaining(['Bear', 'Ooze']));
    expect(pt(s0, grown!)).toEqual([7, 7]);
    expect(pt(s0, find(s0, 'Test Bear', 'battlefield', 'p2'))).toEqual([2, 2]);
  });
});

describe('CR 613.4b, 608.2h: "{X}: Put X +1/+1 counters on this creature. Then you may have the base power and toughness of each other creature you control become equal to this creature\'s power until end of turn."', () => {
  const RACER = card('Test Racer', 'Creature — Human Rogue', "{X}: Put X +1/+1 counters on this creature. Then you may have the base power and toughness of each other creature you control become equal to this creature's power until end of turn.", ['1', '1']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  it('is automated; X = 2: it is 3/3 and each other creature I control has base 3/3 (a counter still adds); the opponent\'s Bear is unchanged', () => {
    expect(full(RACER)).toBe(true);
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Test Racer', 'Test Bear', { name: 'Test Bear', counters: { '+1/+1': 1 } }, 'Plains', 'Plains'] }, p2: { battlefield: ['Test Bear'] }, defs: [RACER, BEAR] });
    const racer = find(s0, 'Test Racer', 'battlefield');
    const [plain, grown] = findAll(s0, 'Test Bear', 'battlefield', 'p1');
    const s = resolve(activate(s0, racer, [{ kind: 'chooseNumber', n: 2 }]), [{ kind: 'yesNo', yes: true }]);
    expect(pt(s, racer)).toEqual([3, 3]);
    expect(pt(s, plain!)).toEqual([3, 3]);
    expect(pt(s, grown!)).toEqual([4, 4]);
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p2'))).toEqual([2, 2]);
  });
  it('declined: nothing changes but the counters', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Test Racer', 'Test Bear', 'Plains', 'Plains'] }, defs: [RACER, BEAR] });
    const s = resolve(activate(s0, find(s0, 'Test Racer', 'battlefield'), [{ kind: 'chooseNumber', n: 2 }]), [{ kind: 'yesNo', yes: false }]);
    expect(pt(s, find(s, 'Test Bear', 'battlefield'))).toEqual([2, 2]);
  });
});

describe('CR 109.2, 611.2c: "{T}: Each other nonartifact creature gets -1/-1 until end of turn."', () => {
  const HEX = card('Test Hexer', 'Creature — Human Warlock', '{T}: Each other nonartifact creature gets -1/-1 until end of turn.', ['2', '2']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', ['2', '2']);
  it('is automated; it and artifact creatures are not affected', () => {
    expect(full(HEX)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Hexer', 'Test Bear', 'Test Golem'] }, p2: { battlefield: ['Test Bear'] }, defs: [HEX, BEAR, GOLEM] });
    const s = resolve(activate(s0, find(s0, 'Test Hexer', 'battlefield')));
    expect(pt(s, find(s, 'Test Hexer', 'battlefield'))).toEqual([2, 2]);
    expect(pt(s, find(s, 'Test Golem', 'battlefield'))).toEqual([2, 2]);
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toEqual([1, 1]);
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p2'))).toEqual([1, 1]);
  });
});

describe('CR 702.21a, 613.1f: \'Artifacts you control have "Ward--Pay 2 life."\'', () => {
  const WARDER = card('Test Warder', 'Creature — Human', 'Artifacts you control have "Ward—Pay 2 life."', ['2', '2']);
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', ['2', '2']);
  it('is automated; my artifact has ward with the cost of paying 2 life, the opponent\'s does not', () => {
    expect(full(WARDER)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Warder', 'Test Golem'] }, p2: { battlefield: ['Test Golem'] }, defs: [WARDER, GOLEM] });
    const wards = (id: ObjectId) => getChars(s0, id)!.keywords.filter((k) => k.keyword === 'ward');
    expect(wards(find(s0, 'Test Golem', 'battlefield', 'p1')).length).toBe(1);
    expect(JSON.stringify(wards(find(s0, 'Test Golem', 'battlefield', 'p1'))[0])).toContain('"payLife"');
    expect(wards(find(s0, 'Test Golem', 'battlefield', 'p2')).length).toBe(0);
  });
});

describe('CR 702.12b, 701.8a: "All creatures lose indestructible until end of turn, then destroy all creatures."', () => {
  const PILEUP = card('Test Pileup', 'Sorcery', 'All creatures lose indestructible until end of turn, then destroy all creatures.');
  const IDOL = card('Test Stone Idol', 'Creature — Golem', 'Indestructible', ['3', '3']);
  it('is automated; an indestructible creature is destroyed', () => {
    expect(full(PILEUP)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Pileup'] }, p2: { battlefield: ['Test Stone Idol'] }, defs: [PILEUP, IDOL] });
    const s = resolve(cast(s0, 'Test Pileup'));
    expect(findAll(s, 'Test Stone Idol', 'battlefield')).toEqual([]);
  });
});

describe('CR 701.9a, 608.2c: "Look at target player\'s hand. You may choose a card from it. If you do, that player discards that card, then draws a card."', () => {
  const PROBE = card('Test Probe', 'Sorcery', "Look at target player's hand. You may choose a card from it. If you do, that player discards that card, then draws a card.");
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  it('is automated; the chosen card is discarded and that player draws one', () => {
    expect(full(PROBE)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Probe'] }, p2: { hand: ['Test Bear'] }, defs: [PROBE, BEAR] });
    const bear = find(s0, 'Test Bear', 'hand', 'p2');
    const handBefore = handSize(s0, 'p2');
    const s = resolve(cast(s0, 'Test Probe', [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]), [{ kind: 'chooseObjects', ids: [bear] }]);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p2').length).toBe(1);
    expect(handSize(s, 'p2')).toBe(handBefore);
  });
});
