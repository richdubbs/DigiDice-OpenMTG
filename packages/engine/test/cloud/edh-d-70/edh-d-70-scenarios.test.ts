/**
 * Concept round edh-d-70 (lane player-counters, code edhd70): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by
 * the game's default compiler. Each test is named after the rule it checks, with its negative case. Four-player games where the number of players matters. CR cites are from the
 * Comprehensive Rules of 2026-09-25 as I remember them (a cloud session has no rules text): unverified.
 *
 *   CR 107.14, 122.1, 601.2f, 118.7  "This spell costs {1} less to cast for each {E} you've paid or lost this turn." (Blaster Hulk)
 *   CR 701.9a, 122.1, 608.2h          "You get an experience counter for each player who discarded a card this turn." + "gets +1/+1 for each experience counter you have" (Azula)
 *   CR 122.1f, 601.2c, 603.12         "return up to X target cards ..., where X is the number of opponents who have three or more poison counters." (Glissa's Retriever, four players)
 *   CR 508.1b, 506.3, 603.2c, 122.1   "Whenever a player attacks you with one or more creatures, that player gets twice that many rad counters." (Struggle for Project Purity)
 *   CR 121.1, 608.2c                  "Each opponent draws a card. You draw a card for each card drawn this way." (Struggle for Project Purity, Brotherhood)
 *   CR 603.2, 603.2c, 122.1           "Whenever you attack with one or more Gods and whenever a God dies, you get an experience counter." (Kratos, Stoic Father)
 *   CR 107.14, 608.2d, 608.2c         "You may get {E}{E}. If you don't, you may play that card this turn." (Synth Eradicator)
 *   CR 604.1, 613.4c, 122.1           "Creatures you control get +1/+0 for each experience counter you have." (Minthara, Merciless Soul: the static part)
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { getChars } from '../../../src/index';
import { act, card, cast, drive, find, full, legal, named, obj, resolveAll, scenario } from '../r4-cost/support';
import { declareAttackers, toDeclareAttackers, passUntil, toStep, tweak } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

const energyOf = (s: GameState, p = 'p1'): number => s.players.find((x) => x.id === p)!.counters['energy'] ?? 0;
const countersOf = (s: GameState, kind: string, p = 'p1'): number => s.players.find((x) => x.id === p)!.counters[kind] ?? 0;
const setCounters = (s: GameState, p: string, kind: string, n: number): GameState => tweak(s, (t) => { t.players.find((x) => x.id === p)!.counters[kind] = n; });
const power = (s: GameState, id: ObjectId): number => Number(getChars(s, id)!.power);
const toughness = (s: GameState, id: ObjectId): number => Number(getChars(s, id)!.toughness);

// ---- Blaster Hulk ---------------------------------------------------------------------------------------------------------------------------------
describe('CR 107.14, 601.2f: "This spell costs {1} less to cast for each {E} you\'ve paid or lost this turn."', () => {
  const SPELL = card('Test Costly Idea', 'Sorcery', "This spell costs {1} less to cast for each {E} you've paid or lost this turn.\nYou gain 1 life.", '{4}');
  const CELL = card('Test Energy Cell', 'Artifact', 'Pay {E}{E}: You gain 2 life.');
  const defs = [SPELL, CELL];
  const board = (): GameState => setCounters(scenario([], { defs, p1: { hand: ['Test Costly Idea'], battlefield: ['Test Energy Cell', 'Plains', 'Plains'] } }), 'p1', 'energy', 4);
  it('is full', () => expect(full(SPELL)).toBe(true));
  it('paying {E}{E} first makes a {4} spell cost {2}: castable with two lands', () => {
    const s0 = board();
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Energy Cell', 'battlefield', 'p1'))!;
    const s1 = resolveAll(drive(act(s0, a.action)));
    expect(energyOf(s1)).toBe(2);
    const s2 = resolveAll(cast(s1, 'Test Costly Idea'));
    expect(s2.zones.graveyard['p1']!.some((id) => s2.objects[id]!.defId === 'Test Costly Idea')).toBe(true);
  });
  it('negative: with no energy paid or lost this turn the {4} spell cannot be cast with two lands', () => {
    const s0 = board();
    expect(() => cast(s0, 'Test Costly Idea')).toThrow();
  });
});

// ---- Azula, Ruthless Firebender --------------------------------------------------------------------------------------------------------------------
describe('CR 701.9a, 122.1: "You get an experience counter for each player who discarded a card this turn." and the pump by experience counters', () => {
  const FIRE = card('Test Firebrand', 'Legendary Creature — Human', 'Whenever ~ attacks, you may discard a card. Then you get an experience counter for each player who discarded a card this turn.\n{0}: Until end of turn, ~ gets +1/+1 for each experience counter you have and gains menace.', '{0}', ['2', '2']);
  const FORCE = card('Test Forced Loss', 'Instant', 'Target player discards a card.');
  const defs = [FIRE, FORCE];
  const board = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Plains'], battlefield: ['Test Firebrand'] }, p2: { hand: ['Plains'] }, p3: { hand: ['Plains'] } } });
  const attack = (s: GameState, discard: boolean): GameState => {
    const a = declareAttackers(toDeclareAttackers(s), [[named(s, 'Test Firebrand')[0]!, 'p4']]);
    return resolveAll(a, { yes: [discard] });
  };
  const named = (s: GameState, n: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === n);
  it('is full', () => expect(full(FIRE)).toBe(true));
  it('you discard and nobody else did: one counter', () => expect(countersOf(attack(board(), true), 'experience')).toBe(1));
  it('negative: nobody discarded this turn (you decline): no counter', () => expect(countersOf(attack(board(), false), 'experience')).toBe(0));
  it('an opponent discarded earlier this turn too: two counters (each player counted once)', () => {
    let s = board();
    s = tweak(s, (t) => { t.players.find((x) => x.id === 'p1')!.counters['experience'] = 0; });
    const d = full(FORCE);
    expect(d).toBe(true);
    // p1 casts the instant on p2 in the first main phase (the discard is p2's)
    const withForce = mpScenario({ defs, zones: { p1: { hand: ['Plains', 'Test Forced Loss'], battlefield: ['Test Firebrand'] }, p2: { hand: ['Plains'] } } });
    const s1 = resolveAll(cast(withForce, 'Test Forced Loss', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(s1.zones.hand['p2']!.length).toBe(0);
    expect(countersOf(attack(s1, true), 'experience')).toBe(2);
    void s;
  });
  it('the pump: +1/+1 per experience counter, menace until end of turn; counters gained later do not change a pump that has resolved', () => {
    let s = setCounters(board(), 'p1', 'experience', 2);
    const fire = named(s, 'Test Firebrand')[0]!;
    const a = legal(s, 'p1', 'activate').find((x) => x.object === fire)!;
    s = resolveAll(drive(act(s, a.action)));
    expect(power(s, fire)).toBe(4);
    expect(toughness(s, fire)).toBe(4);
    const later = setCounters(s, 'p1', 'experience', 5);
    expect(power(later, fire)).toBe(4);
  });
});

// ---- Glissa's Retriever ---------------------------------------------------------------------------------------------------------------------------
describe('CR 122.1f, 601.2c, 603.12: "return up to X target cards from your graveyard to your hand, where X is the number of opponents who have three or more poison counters"', () => {
  const BEAST = card('Test Corrupt Beast', 'Creature — Beast', 'When ~ dies, exile it. When you do, return up to X target cards from your graveyard to your hand, where X is the number of opponents who have three or more poison counters.', '{0}', ['1', '1']);
  const KILL = card('Test Slayer', 'Instant', 'Destroy target creature.');
  const defs = [BEAST, KILL];
  const board = (poison: Record<string, number>): GameState => {
    let s = mpScenario({ defs, zones: { p1: { hand: ['Test Slayer'], battlefield: ['Test Corrupt Beast'], graveyard: ['Plains', 'Plains', 'Plains'] } } });
    for (const [p, n] of Object.entries(poison)) s = tweak(s, (t) => { t.players.find((x) => x.id === p)!.poison = n; });
    return s;
  };
  const kill = (s0: GameState, pick: number): GameState => {
    const beast = s0.zones.battlefield.find((id) => s0.objects[id]!.defId === 'Test Corrupt Beast')!;
    let s = cast(s0, 'Test Slayer', { targets: [[obj(beast)]] });
    // resolve the destroy, then the dies trigger, then the reflexive trigger: choose `pick` cards of the graveyard
    const grave = s0.zones.graveyard['p1']!.slice(0, pick);
    s = resolveAll(s, { objects: [grave], targets: [grave.map(obj)] });
    return s;
  };
  it('is full', () => expect(full(BEAST)).toBe(true));
  it('two of three opponents have three or more poison counters (one has two): up to two cards come back', () => {
    const s = kill(board({ p2: 3, p3: 5, p4: 2 }), 2);
    expect(s.zones.hand['p1']!.length - 1 /* the turn's draw */).toBe(2);
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Corrupt Beast')).toBe(true);
  });
  it('negative: no opponent is poisoned enough: no card comes back (up to zero)', () => {
    const s = kill(board({ p2: 2, p3: 1 }), 0);
    expect(s.zones.hand['p1']!.length - 1 /* the turn's draw */).toBe(0);
  });
});

// ---- Struggle for Project Purity -----------------------------------------------------------------------------------------------------------------
describe('CR 508.1b, 506.3, 603.2c, 122.1: "Whenever a player attacks you with one or more creatures, that player gets twice that many rad counters."', () => {
  const HALL = card('Test Pact Hall', 'Enchantment', 'As this enchantment enters, choose Khans or Dragons.\n• Khans — At the beginning of your upkeep, each opponent draws a card. You draw a card for each card drawn this way.\n• Dragons — Whenever a player attacks you with one or more creatures, that player gets twice that many rad counters.', '{0}');
  const BEAR = card('Test Raider', 'Creature — Bear', '', '{0}', ['1', '1']);
  const defs = [HALL, BEAR];
  const withHall = (mode: string): GameState => resolveAll(cast(mpScenario({ defs, zones: { p1: { hand: ['Test Pact Hall'] }, p2: { battlefield: ['Test Raider', 'Test Raider', 'Test Raider'] } } }), 'Test Pact Hall'), { options: [[mode]] });
  const toP2Attack = (s: GameState): GameState => toDeclareAttackers(passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'p2 main 1'));
  it('is full', () => expect(full(HALL)).toBe(true));
  it('Dragons: p2 attacks p1 with two creatures and p3 with one: p2 gets four rad counters (twice the two that attack p1)', () => {
    const s0 = withHall('Dragons');
    const s1 = toP2Attack(s0);
    const raiders = s1.zones.battlefield.filter((id) => s1.objects[id]!.defId === 'Test Raider');
    const s2 = resolveAll(declareAttackers(s1, [[raiders[0]!, 'p1'], [raiders[1]!, 'p1'], [raiders[2]!, 'p3']]));
    expect(countersOf(s2, 'rad', 'p2')).toBe(4);
    expect(countersOf(s2, 'rad', 'p1')).toBe(0);
  });
  it('negative: p2 attacks only p3: nothing happens', () => {
    const s1 = toP2Attack(withHall('Dragons'));
    const raiders = s1.zones.battlefield.filter((id) => s1.objects[id]!.defId === 'Test Raider');
    const s2 = resolveAll(declareAttackers(s1, [[raiders[0]!, 'p3'], [raiders[1]!, 'p3']]));
    expect(countersOf(s2, 'rad', 'p2')).toBe(0);
  });
  it('negative: the Khans mode does not trigger on attacks', () => {
    const s1 = toP2Attack(withHall('Khans'));
    const raiders = s1.zones.battlefield.filter((id) => s1.objects[id]!.defId === 'Test Raider');
    const s2 = resolveAll(declareAttackers(s1, [[raiders[0]!, 'p1']]));
    expect(countersOf(s2, 'rad', 'p2')).toBe(0);
  });
  it('Khans: at your upkeep each of the three opponents draws a card and you draw three cards', () => {
    const s0 = resolveAll(cast(mpScenario({ defs, zones: { p1: { hand: ['Test Pact Hall'] } } }), 'Test Pact Hall'), { options: [['Khans']] });
    const s1 = passUntil(s0, (x) => x.turn.activePlayer === 'p1' && x.turn.number > 1 && x.turn.step === 'upkeep' && x.pending?.kind === 'priority' && x.zones.stack.length > 0, "p1's next upkeep with the trigger on the stack", 400);
    const before = Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map((p) => [p, s1.zones.hand[p]!.length]));
    const s2 = resolveAll(s1);
    for (const p of ['p2', 'p3', 'p4']) expect(s2.zones.hand[p]!.length - before[p]!, p).toBe(1);
    expect(s2.zones.hand['p1']!.length - before['p1']!).toBe(3);
  });
});

// ---- Kratos, Stoic Father --------------------------------------------------------------------------------------------------------------------------
describe('CR 603.2, 603.2c: "Whenever you attack with one or more Gods and whenever a God dies, you get an experience counter."', () => {
  const GOD = card('Test Sky God', 'Legendary Creature — God', 'Whenever you attack with one or more Gods and whenever a God dies, you get an experience counter.', '{0}', ['2', '2']);
  const GOD2 = card('Test Sea God', 'Legendary Creature — God', '', '{0}', ['1', '1']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', '{0}', ['1', '1']);
  const KILL = card('Test Slayer', 'Instant', 'Destroy target creature.');
  const defs = [GOD, GOD2, BEAR, KILL];
  const ids = (s: GameState, n: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === n);
  it('is full', () => expect(full(GOD)).toBe(true));
  it('attacking with two Gods is ONE declaration: one counter', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Sky God', 'Test Sea God'] } } });
    const s1 = resolveAll(declareAttackers(toDeclareAttackers(s0), [[ids(s0, 'Test Sky God')[0]!, 'p2'], [ids(s0, 'Test Sea God')[0]!, 'p2']]));
    expect(countersOf(s1, 'experience')).toBe(1);
  });
  it("a God dying (even an opponent's) gives a counter; a non-God dying does not", () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Slayer', 'Test Slayer'], battlefield: ['Test Sky God'] }, p2: { battlefield: ['Test Sea God', 'Test Plain Bear'] } } });
    const bear = ids(s0, 'Test Plain Bear')[0]!;
    const s1 = resolveAll(cast(s0, 'Test Slayer', { targets: [[obj(bear)]] }));
    expect(countersOf(s1, 'experience')).toBe(0);
    const s2 = resolveAll(cast(s1, 'Test Slayer', { targets: [[obj(ids(s1, 'Test Sea God')[0]!)]] }));
    expect(countersOf(s2, 'experience')).toBe(1);
  });
  it('Gods dying at the same time are separate events: three Gods destroyed together give three counters', () => {
    const WIPE = card('Test Sweep', 'Sorcery', 'Destroy all creatures.');
    const s0 = mpScenario({ defs: [...defs, WIPE], zones: { p1: { hand: ['Test Sweep'], battlefield: ['Test Sky God', 'Test Sea God'] }, p2: { battlefield: ['Test Sea God'] } } });
    const s1 = resolveAll(cast(s0, 'Test Sweep'));
    expect(countersOf(s1, 'experience')).toBe(3);
  });
  it('negative: attacking with a non-God gives nothing', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Sky God', 'Test Plain Bear'] } } });
    const s1 = resolveAll(declareAttackers(toDeclareAttackers(s0), [[ids(s0, 'Test Plain Bear')[0]!, 'p2']]));
    expect(countersOf(s1, 'experience')).toBe(0);
  });
});

// ---- Synth Eradicator ----------------------------------------------------------------------------------------------------------------------------
describe('CR 107.14, 608.2d, 608.2c: "Exile the top card of your library. You may get {E}{E}. If you don\'t, you may play that card this turn."', () => {
  const DRONE = card('Test Spark Drone', 'Artifact Creature — Construct', 'Whenever ~ attacks, exile the top card of your library. You may get {E}{E}. If you don\'t, you may play that card this turn.', '{0}', ['1', '1']);
  const defs = [DRONE];
  const board = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Spark Drone'], library: ['Plains'] } });
  const attack = (yes: boolean): GameState => {
    const s0 = board();
    const d = s0.zones.battlefield.find((id) => s0.objects[id]!.defId === 'Test Spark Drone')!;
    return resolveAll(declareAttackers(toDeclareAttackers(s0), [[d]]), { yes: [yes] });
  };
  it('is full', () => expect(full(DRONE)).toBe(true));
  const playableExiled = (s: GameState): boolean => legal(toStep(s, 'main2'), 'p1').some((a) => (a.kind === 'playLand' || a.kind === 'cast') && s.zones.exile.includes(a.object ?? ''));
  it('you take the energy: two energy counters and the exiled card cannot be played', () => {
    const s = attack(true);
    expect(energyOf(s)).toBe(2);
    expect(s.zones.exile.length).toBe(1);
    expect(playableExiled(s)).toBe(false);
  });
  it('you decline: no energy and the exiled card may be played this turn', () => {
    const s = attack(false);
    expect(energyOf(s)).toBe(0);
    expect(s.zones.exile.length).toBe(1);
    expect(playableExiled(s)).toBe(true);
  });
});

// ---- Minthara, Merciless Soul (the static part) ----------------------------------------------------------------------------------------------------
describe('CR 604.1, 613.4c, 122.1: "Creatures you control get +1/+0 for each experience counter you have."', () => {
  const LEAD = card('Test Soul Leader', 'Legendary Creature — Elf', 'Creatures you control get +1/+0 for each experience counter you have.', '{0}', ['2', '2']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', '{0}', ['1', '1']);
  const defs = [LEAD, BEAR];
  it('each experience counter its controller has is +1/+0 for their creatures only', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Soul Leader', 'Test Plain Bear'] }, p2: { battlefield: ['Test Plain Bear'] } } });
    const s = setCounters(s0, 'p1', 'experience', 3);
    const mine = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Plain Bear' && s.objects[id]!.controller === 'p1')!;
    const theirs = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Plain Bear' && s.objects[id]!.controller === 'p2')!;
    expect(power(s, mine)).toBe(4);
    expect(toughness(s, mine)).toBe(1);
    expect(power(s, theirs)).toBe(1);
    expect(power(s0, mine)).toBe(1);
  });
});
