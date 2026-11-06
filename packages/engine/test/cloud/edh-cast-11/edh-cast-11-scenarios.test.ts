/**
 * edh-cast-11 scenarios (Commander lane edh-cast): each new reading played through the engine with synthetic cards (invented names, design 6.10), with its negative case.
 * Rules (Comprehensive Rules 2026-09-25):
 *   CR 118.9, 601.2b, 202.3, 119.4, 107.3b   "Once during each of your turns, you may cast an enchantment spell by paying life equal to its mana value rather than paying its mana
 *                                             cost" (Demon of Fate's Design)
 *   CR 118.9, 601.2a, 601.3, 401.5            "Once during each of your turns, you may cast a spell from your hand or the top of your library without paying its mana cost"
 *                                             (One with the Multiverse): one use between the two zones
 *   CR 118.9, 601.2b, 202.3, 107.3b           "Once each turn, you may pay {0} rather than pay the mana cost for a spell you cast with mana value X or less, where X is the number of
 *                                             time counters on this enchantment" (As Foretold)
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { isGrantedAltMethod } from '../../../src/statics/play-permits';
import { act, advanceTo, answer, card, drive, find, full, legal, lifeOf, named, obj, resolveAll, scenario } from '../r3-cost/support';

const castMethodsFor = (s: GameState, id: ObjectId, player: PlayerId = 'p1'): (string | undefined)[] =>
  legalActions(s, player).filter((a) => a.kind === 'cast' && a.object === id).map((a) => (a.action as { method?: string }).method);
const granted = (s: GameState, id: ObjectId, player: PlayerId = 'p1'): string | undefined => castMethodsFor(s, id, player).find((m) => isGrantedAltMethod(m));
const castWith = (s: GameState, id: ObjectId, method: string, player: PlayerId = 'p1'): GameState => drive(act(s, { type: 'cast', player, card: id, method }));

describe('CR 118.9, 202.3, 119.4: "Once during each of your turns, you may cast an enchantment spell by paying life equal to its mana value rather than paying its mana cost"', () => {
  const FATE = card('Test Fate Warden', 'Enchantment Creature — Demon', 'Once during each of your turns, you may cast an enchantment spell by paying life equal to its mana value rather than paying its mana cost.', '{3}', ['3', '3']);
  const WARD = card('Test Ward Rune', 'Enchantment', '', '{2}{W}');
  const SIGIL = card('Test Sigil Rune', 'Enchantment', '', '{1}{U}');
  const OX = card('Test Ox', 'Creature — Ox', '', '{3}', ['3', '3']);
  const FORGE = card('Test X Rune', 'Enchantment', '', '{X}{W}');
  const DEFS = [FATE, WARD, SIGIL, OX, FORGE];
  it('is automated', () => { expect(full(FATE)).toBe(true); });
  it('an enchantment spell with mana value 3 is cast with no mana for 3 life; a creature spell is not covered', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Fate Warden'], hand: ['Test Ward Rune', 'Test Ox'] } });
    const rune = find(s, 'Test Ward Rune', 'hand', 'p1');
    expect(granted(s, find(s, 'Test Ox', 'hand', 'p1'))).toBeUndefined();
    const before = lifeOf(s);
    s = resolveAll(castWith(s, rune, granted(s, rune)!));
    expect(named(s, 'Test Ward Rune')).toHaveLength(1);
    expect(lifeOf(s)).toBe(before - 3);
  });
  it('once during each of your turns: the second enchantment spell is not offered for life that turn, and is again on the next turn of yours', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Fate Warden'], hand: ['Test Ward Rune', 'Test Sigil Rune'] } });
    s = resolveAll(castWith(s, find(s, 'Test Ward Rune', 'hand', 'p1'), granted(s, find(s, 'Test Ward Rune', 'hand', 'p1'))!));
    expect(granted(s, find(s, 'Test Sigil Rune', 'hand', 'p1'))).toBeUndefined();
    s = advanceTo(s, 3, 'main1');
    expect(granted(s, find(s, 'Test Sigil Rune', 'hand', 'p1'))).toBeDefined();
  });
  it("CR 500.1: not during an opponent's turn (even a flash enchantment would need the permission to hold during your turn only)", () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Fate Warden'], hand: ['Test Ward Rune'] } });
    const t2 = advanceTo(s, 2, 'main1');
    expect(granted(t2, find(t2, 'Test Ward Rune', 'hand', 'p1'))).toBeUndefined();
  });
  it('CR 119.4: a player cannot pay more life than they have: with 2 life the 3 life alternative is not offered', () => {
    const s = scenario([], { defs: DEFS, life: 2, p1: { battlefield: ['Test Fate Warden'], hand: ['Test Ward Rune', 'Test Sigil Rune'] } });
    expect(granted(s, find(s, 'Test Ward Rune', 'hand', 'p1'))).toBeUndefined();
    expect(granted(s, find(s, 'Test Sigil Rune', 'hand', 'p1'))).toBeDefined(); // mana value 2, life 2
  });
  it('CR 107.3b: an {X} spell cast this way has X = 0 and costs life equal to its mana value with X = 0', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Fate Warden'], hand: ['Test X Rune'] } });
    const rune = find(s, 'Test X Rune', 'hand', 'p1');
    const before = lifeOf(s);
    s = resolveAll(castWith(s, rune, granted(s, rune)!));
    expect(named(s, 'Test X Rune')).toHaveLength(1);
    expect(lifeOf(s)).toBe(before - 1);
  });
  it('without the source nothing is offered; for an opponent nothing is offered', () => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Ward Rune'] }, p2: { battlefield: ['Test Fate Warden'] } });
    expect(granted(s, find(s, 'Test Ward Rune', 'hand', 'p1'))).toBeUndefined();
  });
});

describe('CR 118.9, 601.2a, 401.5: "Once during each of your turns, you may cast a spell from your hand or the top of your library without paying its mana cost" (One with the Multiverse)', () => {
  const SEER = card('Test Multiverse Seer', 'Enchantment', 'You may look at the top card of your library any time.\nYou may play lands and cast spells from the top of your library.\nOnce during each of your turns, you may cast a spell from your hand or the top of your library without paying its mana cost.', '{5}');
  const GIANT = card('Test Hill Giant', 'Creature — Giant', '', '{5}', ['5', '5']);
  const TROLL = card('Test Hill Troll', 'Creature — Troll', '', '{4}', ['4', '4']);
  const DEFS = [SEER, GIANT, TROLL];
  it('is automated', () => { expect(full(SEER)).toBe(true); });
  it('a spell in the hand is cast free, and then the top card is not free that turn (one use between both zones)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Multiverse Seer'], hand: ['Test Hill Giant'], library: ['Test Hill Troll', 'Test Hill Troll'] } });
    const giant = find(s, 'Test Hill Giant', 'hand', 'p1');
    const top = s.zones.library.p1![0]!;
    expect(granted(s, top)).toBeDefined();
    s = resolveAll(castWith(s, giant, granted(s, giant)!));
    expect(named(s, 'Test Hill Giant')).toHaveLength(1);
    expect(granted(s, s.zones.library.p1![0]!)).toBeUndefined();
  });
  it('the top card of the library is cast free, and then a card in the hand is not free that turn', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Multiverse Seer'], hand: ['Test Hill Giant'], library: ['Test Hill Troll', 'Test Hill Troll'] } });
    const top = s.zones.library.p1![0]!;
    s = resolveAll(castWith(s, top, granted(s, top)!));
    expect(named(s, 'Test Hill Troll')).toHaveLength(1);
    expect(granted(s, find(s, 'Test Hill Giant', 'hand', 'p1'))).toBeUndefined();
  });
  it("CR 500.1: not during an opponent's turn; a card in the graveyard is not covered", () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Multiverse Seer'], hand: ['Test Hill Giant'], graveyard: ['Test Hill Troll'] } });
    expect(granted(s, find(s, 'Test Hill Troll', 'graveyard', 'p1'))).toBeUndefined();
    const t2 = advanceTo(s, 2, 'main1');
    expect(granted(t2, find(t2, 'Test Hill Giant', 'hand', 'p1'))).toBeUndefined();
  });
});

describe('CR 118.9, 202.3: "Once each turn, you may pay {0} rather than pay the mana cost for a spell you cast with mana value X or less, where X is the number of time counters on this enchantment" (As Foretold)', () => {
  const CLOCK = card('Test Time Clock', 'Enchantment', 'Once each turn, you may pay {0} rather than pay the mana cost for a spell you cast with mana value X or less, where X is the number of time counters on this enchantment.', '{1}{U}');
  const GIANT = card('Test Hill Giant', 'Creature — Giant', '', '{5}', ['5', '5']);
  const TROLL = card('Test Hill Troll', 'Creature — Troll', '', '{4}', ['4', '4']);
  const HYDRA = card('Test Hydra', 'Creature — Hydra', 'Test Hydra enters with X +1/+1 counters on it.', '{X}{G}', ['0', '0']);
  const DEFS = [CLOCK, GIANT, TROLL, HYDRA];
  const withCounters = (n: number, hand: string[]) => scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Time Clock', counters: { time: n } }], hand } });
  it('is automated', () => { expect(full(CLOCK)).toBe(true); });
  it('with four time counters a spell with mana value 4 is cast for {0} and one with mana value 5 is not covered', () => {
    let s = withCounters(4, ['Test Hill Giant', 'Test Hill Troll']);
    expect(granted(s, find(s, 'Test Hill Giant', 'hand', 'p1'))).toBeUndefined();
    const troll = find(s, 'Test Hill Troll', 'hand', 'p1');
    s = resolveAll(castWith(s, troll, granted(s, troll)!));
    expect(named(s, 'Test Hill Troll')).toHaveLength(1);
  });
  it('the number is counted when the spell is cast: with five counters the 5 is covered; with none only a spell of mana value 0 (a land is not cast)', () => {
    const five = withCounters(5, ['Test Hill Giant']);
    expect(granted(five, find(five, 'Test Hill Giant', 'hand', 'p1'))).toBeDefined();
    const none = withCounters(0, ['Test Hill Giant']);
    expect(granted(none, find(none, 'Test Hill Giant', 'hand', 'p1'))).toBeUndefined();
  });
  it('once each turn: after one spell for {0} the other is not offered that turn', () => {
    let s = withCounters(5, ['Test Hill Giant', 'Test Hill Troll']);
    const troll = find(s, 'Test Hill Troll', 'hand', 'p1');
    s = resolveAll(castWith(s, troll, granted(s, troll)!));
    expect(granted(s, find(s, 'Test Hill Giant', 'hand', 'p1'))).toBeUndefined();
  });
  it('CR 107.3b: an {X} spell cast this way has X = 0 (its mana value is then 1)', () => {
    let s = withCounters(1, ['Test Hydra']);
    const hydra = find(s, 'Test Hydra', 'hand', 'p1');
    expect(granted(s, hydra)).toBeDefined();
    s = resolveAll(castWith(s, hydra, granted(s, hydra)!));
    expect(named(s, 'Test Hydra')).toHaveLength(0); // a 0/0 with no counters dies (CR 704.5f)
  });
});

const passTo = (s0: GameState, kind: 'declareAttackers' | 'declareBlockers'): GameState => {
  let s = s0;
  for (let i = 0; i < 60 && s.pending?.kind !== kind; i++) s = act(s, { type: 'pass', player: s.pending!.player });
  if (s.pending?.kind !== kind) throw new Error(`never reached ${kind}`);
  return s;
};
const tokenOf = (s: GameState, player: PlayerId = 'p1'): ObjectId => s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === player)!;
const attackWith = (s: GameState, ids: ObjectId[]): GameState => resolveAll(answer(s, { kind: 'declareAttackers', attacks: ids.map((attacker) => ({ attacker, defender: 'p2' as const })) }));

describe('CR 603.2, 508.1a, 509.1a, 115.1: "Whenever ~ attacks, blocks, or becomes the target of a spell, it deals damage equal to its power to each opponent" (Giggling Skitterspike)', () => {
  const SPIKE = card('Test Giggle Spike', 'Creature — Construct', 'Whenever ~ attacks, blocks, or becomes the target of a spell, it deals damage equal to its power to each opponent.', '{4}', ['3', '4']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}{G}', ['2', '2']);
  const SPARK = card('Test Spark', 'Instant', 'Test Spark deals 1 damage to target creature.', '{0}');
  const POKER = card('Test Poker', 'Creature — Human', '{0}: Test Poker deals 1 damage to target creature.', '{1}', ['1', '1']);
  const DEFS = [SPIKE, BEAR, SPARK, POKER];
  it('is automated', () => { expect(full(SPIKE)).toBe(true); });
  it("attacks: the opponent loses life equal to its power (3), and its controller loses none", () => {
    let s = passTo(scenario([], { defs: DEFS, p1: { battlefield: ['Test Giggle Spike'] } }), 'declareAttackers');
    s = attackWith(s, [find(s, 'Test Giggle Spike', 'battlefield', 'p1')]);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(lifeOf(s, 'p2')).toBe(17); // the trigger's 3 damage (combat damage comes later)
  });
  it('blocks: when it blocks, the attacker\'s controller (its controller\'s opponent) loses life equal to its power', () => {
    let s = passTo(scenario([], { defs: DEFS, p1: { battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Giggle Spike'] } }), 'declareAttackers');
    s = passTo(attackWith(s, [find(s, 'Test Bear', 'battlefield', 'p1')]), 'declareBlockers');
    const before = lifeOf(s, 'p1');
    s = resolveAll(answer(s, { kind: 'declareBlockers', blocks: [{ blocker: find(s, 'Test Giggle Spike', 'battlefield', 'p2'), attacker: find(s, 'Test Bear', 'battlefield', 'p1') }] }));
    expect(lifeOf(s, 'p1')).toBe(before - 3);
  });
  it('becomes the target of a spell: the opponent of its controller loses 3; an opponent\'s ability that targets it does not trigger it', () => {
    const base = (): GameState => {
      let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Giggle Spike'] }, p2: { hand: ['Test Spark'], battlefield: ['Test Poker'] } });
      s = act(s, { type: 'pass', player: s.pending!.player }); // p2 gets priority in p1's main phase
      return s;
    };
    let s = base();
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Spark', 'hand', 'p2') }), { targets: [[obj(find(s, 'Test Giggle Spike', 'battlefield', 'p1'))]] });
    const before = lifeOf(s, 'p2');
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(before - 3);
    // an ability is not a spell (CR 112.1, 113.1): Test Poker's ability targets it and nothing triggers
    s = base();
    const use = legal(s, 'p2', 'activate').find((a) => /1 damage/.test(a.label))!;
    s = drive(act(s, use.action), { targets: [[obj(find(s, 'Test Giggle Spike', 'battlefield', 'p1'))]] });
    const before2 = lifeOf(s, 'p2');
    s = resolveAll(s);
    expect(lifeOf(s, 'p2')).toBe(before2);
  });
});

describe('CR 611.2c, 508.1a, 305.1: "During any turn you attacked with a token, you may play that card" (Neyali, Suns\' Vanguard)', () => {
  const NEYALI = card('Test Vanguard', 'Creature — Human', 'Whenever one or more tokens you control attack a player, exile the top card of your library. During any turn you attacked with a token, you may play that card.', '{2}', ['2', '2']);
  const MAKER = card('Test Token Press', 'Artifact', '{0}: Create a 1/1 white Soldier creature token.', '{0}');
  const MEADOW = card('Test Meadow', 'Land', '', '');
  const DEFS = [NEYALI, MAKER, MEADOW];
  const playable = (s: GameState, id: ObjectId): boolean => legalActionsOf(s, id).length > 0;
  const legalActionsOf = (s: GameState, id: ObjectId) => legalActions(s, 'p1').filter((a) => a.object === id && (a.kind === 'playLand' || a.kind === 'cast'));
  const makeToken = (s0: GameState): GameState => {
    const use = legal(s0, 'p1', 'activate').find((a) => /Soldier/.test(a.label))!;
    return resolveAll(drive(act(s0, use.action)));
  };
  const setup = (): GameState => scenario([], { defs: DEFS, p1: { battlefield: ['Test Vanguard', 'Test Token Press'], library: ['Test Meadow', 'Test Meadow', 'Test Meadow', 'Test Meadow'] } });
  it('is automated', () => { expect(full(NEYALI)).toBe(true); });
  it('a turn in which you attacked with a token: the exiled card may be played (here a land, in the second main phase)', () => {
    let s = makeToken(setup());
    s = advanceTo(s, 3, 'main1');
    s = passTo(s, 'declareAttackers');
    const soldier = tokenOf(s);
    const libraryBefore = s.zones.library.p1!.length;
    s = attackWith(s, [soldier]);
    const exiled = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Meadow');
    expect(exiled).toBeDefined();
    expect(s.zones.library.p1).toHaveLength(libraryBefore - 1);
    // after combat: the second main phase of the same turn
    while (!(s.turn.number === 3 && s.turn.step === 'main2')) s = s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : act(s, { type: 'pass', player: s.pending!.player });
    expect(playable(s, exiled!)).toBe(true);
  });
  it('a later turn in which you did not attack with a token: the exiled card may not be played; a turn in which you did: it may again', () => {
    let s = makeToken(setup());
    s = advanceTo(s, 3, 'main1');
    s = passTo(s, 'declareAttackers');
    s = attackWith(s, [tokenOf(s)]);
    const exiled = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Meadow')!;
    s = advanceTo(s, 5, 'main1'); // a turn with no attack by a token yet
    expect(playable(s, exiled)).toBe(false);
    s = passTo(s, 'declareAttackers');
    s = attackWith(s, [tokenOf(s)]);
    while (!(s.turn.number === 5 && s.turn.step === 'main2')) s = s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : act(s, { type: 'pass', player: s.pending!.player });
    expect(playable(s, exiled)).toBe(true);
  });
  it('attacking with a nontoken creature does not trigger it and does not let anything be played', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Vanguard', 'Test Token Press'], library: ['Test Meadow', 'Test Meadow'] } });
    s = passTo(s, 'declareAttackers');
    s = attackWith(s, [find(s, 'Test Vanguard', 'battlefield', 'p1')]);
    expect(s.zones.exile.filter((id) => s.objects[id]!.defId === 'Test Meadow')).toHaveLength(0);
  });
});

describe('CR 601.3, 101.2, 109.5: "Each opponent can\'t cast noncreature spells with mana value greater than the number of lands that player controls" (Lavinia, Azorius Renegade)', () => {
  const JUDGE = card('Test Renegade Judge', 'Creature — Human', 'Each opponent can\'t cast noncreature spells with mana value greater than the number of lands that player controls.', '{W}{U}', ['2', '2']);
  const SPARK = card('Test Spark', 'Instant', 'Test Spark deals 1 damage to any target.', '{2}{R}');
  const OX = card('Test Flash Ox', 'Creature — Ox', 'Flash', '{3}{R}', ['3', '3']);
  const ROCK = card('Test Mana Rock', 'Artifact', '{T}: Add {R}.', '{0}');
  const DEFS = [JUDGE, SPARK, OX, ROCK];
  const setup = (lands: number, judge = true, rock = false): GameState => {
    const lands2 = Array.from({ length: lands }, () => 'Mountain');
    const s = scenario(['Plains', 'Mountain'], { defs: DEFS, p1: { battlefield: [...(judge ? ['Test Renegade Judge'] : []), 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] }, p2: { hand: ['Test Spark', 'Test Flash Ox'], battlefield: [...lands2, ...(rock ? ['Test Mana Rock'] : [])] } });
    return act(s, { type: 'pass', player: s.pending!.player }); // p2 has priority in p1's main phase
  };
  const castable = (s: GameState, name: string): boolean => legalActions(s, 'p2').some((a) => a.kind === 'cast' && a.object === find(s, name, 'hand', 'p2'));
  it('is automated', () => { expect(full(JUDGE)).toBe(true); });
  it('a noncreature spell with mana value 3 needs three lands of the CASTING player: two lands is not enough, three is (the controller of the Judge has five lands, which do not count)', () => {
    expect(castable(setup(3), 'Test Spark')).toBe(true);
    expect(castable(setup(2), 'Test Spark')).toBe(false);
    // two lands and a mana rock pay for it, so only the Judge stops it: it is castable without the Judge and not with it (the rock is no land)
    expect(castable(setup(2, false, true), 'Test Spark')).toBe(true);
    expect(castable(setup(2, true, true), 'Test Spark')).toBe(false);
    expect(castable(setup(3, true, true), 'Test Spark')).toBe(true);
  });
  it('a creature spell is not covered (CR 601.3): a flash Ox with mana value 4 is castable by a player with four lands, with or without the Judge, and with two lands it is castable only for lack of mana (not by the Judge)', () => {
    expect(castable(setup(4), 'Test Flash Ox')).toBe(true);
    expect(castable(setup(4, false), 'Test Flash Ox')).toBe(true);
  });
  it('without the Judge nothing is restricted', () => {
    expect(castable(setup(3, false), 'Test Spark')).toBe(true);
  });
});
