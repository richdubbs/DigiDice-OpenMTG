/**
 * Standard round std-rq (card wave 2, slice s1): the readings this round added, played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case (CR cites from memory, unverified:
 * rules/cr/ is not in the cloud checkout).
 *
 *   CR 608.2d, 101.4     "Any opponent may sacrifice a creature of their choice. If a player does, ... If no one does, ...": one opponent at most, asked in turn
 *   CR 603.2c, 608.2c    "Whenever you discard one or more cards, target creature gets +2/+0 until end of turn for each card discarded this way."
 *   CR 608.2d, 122.6     "Target player may put a +1/+1 counter on target creature. If they do, they add {C} for each counter on it."
 *   CR 401.1, 608.2h     "Exile cards from the top of your library equal to the number of creatures you control."
 *   CR 601.2, 202.3      "You may cast it without paying its mana cost if that spell's mana value is 2 or less. If you don't, put that card into your hand."
 *   CR 406.1, 400.7      "... deals 1 damage to each opponent for each of those cards that are still exiled": a card played from exile is no longer counted
 *   CR 500.8, 508.1c     "After this phase, there is an additional combat phase. Only artifact creatures can attack during that combat phase."
 *   CR 702.194a          "Whenever this creature becomes tapped to pay a teamwork cost, draw a card.": tapped for teamwork, not tapped otherwise
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, life, pass, pool, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; keywords?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: o.keywords ?? [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const library = (s: GameState, p: PlayerId): number => s.zones.library[p]!.length;
const power = (s: GameState, id: ObjectId): number => Number(getChars(s, id)?.power);
const full = (d: CardDef): boolean => d.automation.level === 'full';

/** The answers a test gives, in order, per decision; anything else gets the default (automatic payment, the first allowed choices, "yes"). */
interface Script {
  targets?: ({ kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId })[][];
  objects?: ((options: readonly ObjectId[], s: GameState) => ObjectId[])[];
  yes?: boolean[];
  /** Filled with every yes/no question asked: the player asked. */
  asked?: PlayerId[];
}
function drive(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    let a: DecisionAnswer;
    if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'chooseTargets') a = { kind: 'chooseTargets', targets: sc.targets?.shift() ?? [] };
    else if (p.kind === 'chooseOption') a = { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) };
    else if (p.kind === 'chooseObjects') a = { kind: 'chooseObjects', ids: sc.objects?.shift()?.(p.options, s) ?? p.options.slice(0, p.min) };
    else if (p.kind === 'yesNo') { sc.asked?.push(p.player); a = { kind: 'yesNo', yes: sc.yes?.shift() ?? true }; }
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
const obj = (id: ObjectId) => ({ kind: 'object' as const, id });
const player = (id: PlayerId) => ({ kind: 'player' as const, id });

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const GOLEM = card('Test Tin Golem', 'Artifact Creature — Golem', '', { pt: ['1', '1'] });

describe('CR 608.2d, 101.4: "Any opponent may sacrifice a creature of their choice. If a player does, ... If no one does, ..."', () => {
  const DARE = card('Test Dare', 'Sorcery', 'Any opponent may sacrifice a creature of their choice. If a player does, you draw a card. If no one does, you gain 3 life.');
  const DEFS = [DARE, BEAR];
  it('is automated', () => expect(full(DARE)).toBe(true));
  it('the opponent sacrifices: their creature is gone and you draw; no life is gained', () => {
    const asked: PlayerId[] = [];
    const s = cast(scenario([], { defs: DEFS, p1: { hand: ['Test Dare'] }, p2: { battlefield: ['Test Bear'] } }), 'Test Dare', { yes: [true], asked });
    expect(asked).toEqual(['p2']);
    expect(findAll(s, 'Test Bear', 'battlefield')).toHaveLength(0);
    expect(hand(s, 'p1')).toBe(1);
    expect(life(s, 'p1')).toBe(20);
  });
  it('the opponent declines: nothing is sacrificed, you gain 3 life and draw nothing', () => {
    const s = cast(scenario([], { defs: DEFS, p1: { hand: ['Test Dare'] }, p2: { battlefield: ['Test Bear'] } }), 'Test Dare', { yes: [false] });
    expect(findAll(s, 'Test Bear', 'battlefield')).toHaveLength(1);
    expect(hand(s, 'p1')).toBe(0);
    expect(life(s, 'p1')).toBe(23);
  });
  it('an opponent with no creature is not asked (CR 608.2d): no one does', () => {
    const asked: PlayerId[] = [];
    const s = cast(scenario([], { defs: DEFS, p1: { hand: ['Test Dare'], battlefield: ['Test Bear'] } }), 'Test Dare', { asked });
    expect(asked).toEqual([]);
    expect(findAll(s, 'Test Bear', 'battlefield')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(23);
  });
});

describe('CR 603.2c, 608.2c: "Whenever you discard one or more cards, target creature gets +2/+0 until end of turn for each card discarded this way."', () => {
  const SHARK = card('Test Reef Shark', 'Creature — Shark', 'Whenever you discard one or more cards, target creature gets +2/+0 until end of turn for each card discarded this way.', { pt: ['1', '1'] });
  const DUMP2 = card('Test Dump Two', 'Sorcery', 'Discard two cards.');
  const DUMP1 = card('Test Dump One', 'Sorcery', 'Discard a card.');
  const DEFS = [SHARK, DUMP2, DUMP1, BEAR];
  it('is automated', () => expect(full(SHARK)).toBe(true));
  it('two cards discarded at once: +4/+0', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Dump Two', 'Plains', 'Plains'], battlefield: ['Test Reef Shark', 'Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = cast(s0, 'Test Dump Two', { targets: [[obj(bear)]] });
    expect(power(s, bear)).toBe(6);
  });
  it('one card discarded: +2/+0', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Dump One', 'Plains'], battlefield: ['Test Reef Shark', 'Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = cast(s0, 'Test Dump One', { targets: [[obj(bear)]] });
    expect(power(s, bear)).toBe(4);
  });
});

describe('CR 608.2d, 122.6: "Target player may put a +1/+1 counter on target creature. If they do, they add {C} for each counter on it."', () => {
  const GIFT = card('Test Crowd Gift', 'Sorcery', 'Target player may put a +1/+1 counter on target creature. If they do, they add {C} for each counter on it.');
  const DEFS = [GIFT, BEAR];
  it('is automated', () => expect(full(GIFT)).toBe(true));
  it('the targeted opponent puts the counter: the creature, with a charge counter too, gets it, and that player (not you) adds {C}{C}', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Crowd Gift'], battlefield: [{ name: 'Test Bear', counters: { charge: 1 } }] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = drive(pass(pass(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Crowd Gift', 'hand', 'p1') }), { targets: [[player('p2')], [obj(bear)]] }))), { yes: [true] });
    expect(s.objects[bear]!.counters['+1/+1']).toBe(1);
    expect(pool(s, 'p2')).toBe('CC');
    expect(pool(s, 'p1')).toBe('');
  });
  it('the player declines: no counter, no mana', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Crowd Gift'], battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = drive(pass(pass(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Crowd Gift', 'hand', 'p1') }), { targets: [[player('p2')], [obj(bear)]] }))), { yes: [false] });
    expect(s.objects[bear]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(pool(s, 'p2')).toBe('');
  });
});

describe('CR 401.1, 608.2h: "Exile cards from the top of your library equal to the number of creatures you control."', () => {
  const DIG = card('Test Deep Dig', 'Sorcery', 'Exile cards from the top of your library equal to the number of creatures you control.');
  it('is automated; two creatures exile two cards, none exile none', () => {
    expect(full(DIG)).toBe(true);
    const a0 = scenario([], { defs: [DIG, BEAR], p1: { hand: ['Test Deep Dig'], battlefield: ['Test Bear', 'Test Bear'] } });
    const a = cast(a0, 'Test Deep Dig');
    expect(library(a0, 'p1') - library(a, 'p1')).toBe(2);
    expect(a.zones.exile.filter((id) => s0Owner(a, id) === 'p1')).toHaveLength(2);
    const b0 = scenario([], { defs: [DIG, BEAR], p1: { hand: ['Test Deep Dig'] } });
    const b = cast(b0, 'Test Deep Dig');
    expect(library(b0, 'p1') - library(b, 'p1')).toBe(0);
  });
});
const s0Owner = (s: GameState, id: ObjectId): PlayerId => s.objects[id]!.owner;

describe('CR 601.2, 202.3: "You may cast it without paying its mana cost if that spell\'s mana value is 2 or less. If you don\'t, put that card into your hand."', () => {
  const STORM = card('Test Breach', 'Sorcery', "Exile cards from the top of your library until you exile a nonland card. You may cast it without paying its mana cost if that spell's mana value is 2 or less. If you don't, put that card into your hand.");
  const CHEAP = card('Test Cheap Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}{G}' });
  const DEAR = card('Test Dear Bear', 'Creature — Bear', '', { pt: ['3', '3'], cost: '{2}{G}' });
  const DEFS = [STORM, CHEAP, DEAR];
  it('is automated', () => expect(full(STORM)).toBe(true));
  it('a mana value 2 card is cast for free', () => {
    const s = cast(scenario([], { defs: DEFS, p1: { hand: ['Test Breach'], library: ['Plains', 'Test Cheap Bear'] } }), 'Test Breach', { yes: [true] });
    expect(findAll(s, 'Test Cheap Bear', 'battlefield')).toHaveLength(1);
  });
  it('a mana value 3 card is not cast: it is put into your hand', () => {
    const s = cast(scenario([], { defs: DEFS, p1: { hand: ['Test Breach'], library: ['Plains', 'Test Dear Bear'] } }), 'Test Breach', { yes: [true] });
    expect(findAll(s, 'Test Dear Bear', 'battlefield')).toHaveLength(0);
    expect(findAll(s, 'Test Dear Bear', 'hand', 'p1')).toHaveLength(1);
  });
  it('declined, the mana value 2 card is put into your hand', () => {
    const s = cast(scenario([], { defs: DEFS, p1: { hand: ['Test Breach'], library: ['Test Cheap Bear'] } }), 'Test Breach', { yes: [false] });
    expect(findAll(s, 'Test Cheap Bear', 'hand', 'p1')).toHaveLength(1);
  });
});

describe('CR 406.1, 400.7: "... deals 1 damage to each opponent for each of those cards that are still exiled"', () => {
  const HAWK = card('Test Ember Hawk', 'Sorcery', 'Exile the top two cards of your library. You may play those cards this turn. At the beginning of the next end step, Test Ember Hawk deals 1 damage to each opponent for each of those cards that are still exiled.');
  const DEFS = [HAWK, BEAR];
  it('is automated; both cards still exiled at the end step: 2 damage; one played from exile: 1', () => {
    expect(full(HAWK)).toBe(true);
    let a = cast(scenario([], { defs: DEFS, p1: { hand: ['Test Ember Hawk'], library: ['Plains', 'Plains'] } }), 'Test Ember Hawk');
    a = resolveAll(advanceTo(a, 1, 'end'));
    expect(life(a, 'p2')).toBe(18);
    let b = cast(scenario([], { defs: DEFS, p1: { hand: ['Test Ember Hawk'], library: ['Plains', 'Plains'] } }), 'Test Ember Hawk');
    const land = legalActions(b, 'p1').find((x) => x.kind === 'playLand' && b.objects[x.object!]?.zone === 'exile');
    expect(land).toBeDefined();
    b = act(b, land!.action);
    b = resolveAll(advanceTo(b, 1, 'end'));
    expect(life(b, 'p2')).toBe(19);
  });
});

describe('CR 500.8, 508.1c: "After this phase, there is an additional combat phase. Only artifact creatures can attack during that combat phase."', () => {
  const RALLY = card('Test Iron Rally', 'Sorcery', 'Untap all creatures you control. After this phase, there is an additional combat phase. Only artifact creatures can attack during that combat phase.');
  const DEFS = [RALLY, BEAR, GOLEM];
  it('is automated; in the added combat only the artifact creature can attack; in the next combat the other one can too', () => {
    expect(full(RALLY)).toBe(true);
    let s = cast(scenario([], { defs: DEFS, p1: { hand: ['Test Iron Rally'], battlefield: ['Test Bear', 'Test Tin Golem'] } }), 'Test Iron Rally');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const golem = find(s, 'Test Tin Golem', 'battlefield', 'p1');
    const offered: ObjectId[][] = [];
    for (let guard = 0; guard < 400 && s.turn.number === 1 && offered.length < 2; guard++) {
      const d = s.pending;
      if (d?.kind === 'declareAttackers') {
        offered.push(d.candidates.map((x) => x.id).sort());
        s = answer(s, { kind: 'declareAttackers', attacks: [] });
      } else if (d?.kind === 'priority') s = s.zones.stack.length > 0 ? resolveAll(s) : pass(s);
      else if (d) s = drive(s);
      else break;
    }
    expect(offered[0]).toEqual([golem]);
    expect(offered[1]).toEqual([bear, golem].sort());
  });
});

describe('CR 702.194a: "Whenever this creature becomes tapped to pay a teamwork cost, draw a card."', () => {
  const AGENT = card('Test Field Agent', 'Creature — Human Spy', 'Whenever this creature becomes tapped to pay a teamwork cost, draw a card.', { pt: ['2', '1'] });
  const TEAM = card('Test Team Up', 'Instant', 'Teamwork 2 (As an additional cost to cast this spell, you may tap any number of creatures you control with total power 2 or more.)\nYou gain 1 life.', { keywords: ['Teamwork'] });
  const DEFS = [AGENT, TEAM];
  it('is automated', () => expect(full(AGENT)).toBe(true));
  it('tapped for the teamwork cost: it draws a card', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Team Up'], battlefield: ['Test Field Agent'] } });
    const agent = find(s0, 'Test Field Agent', 'battlefield', 'p1');
    const s = cast(s0, 'Test Team Up', { objects: [() => [agent]] });
    expect(s.objects[agent]!.tapped).toBe(true);
    expect(life(s, 'p1')).toBe(21);
    expect(hand(s, 'p1')).toBe(1);
  });
  it('the spell cast without teamwork: nothing is tapped and nothing is drawn', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Team Up'], battlefield: ['Test Field Agent'] } });
    const agent = find(s0, 'Test Field Agent', 'battlefield', 'p1');
    const s = cast(s0, 'Test Team Up', { yes: [false], objects: [() => []] });
    expect(s.objects[agent]!.tapped).toBe(false);
    expect(hand(s, 'p1')).toBe(0);
  });
});
