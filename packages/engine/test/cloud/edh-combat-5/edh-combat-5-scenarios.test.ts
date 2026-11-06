/**
 * Commander lane edh-combat, round edh-combat-5: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the
 * game's default compiler. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules text of 2026-09-25 (fetched from
 * media.wizards.com; rules/cr/ is not in the cloud checkout).
 *
 *   CR 508.1, 613.4c, 400.7      "Each creature you control gets +1/+0 for each time it has attacked this turn.": one per declaration of that creature (two with an added combat), none for a creature that
 *                                did not attack or that entered attacking, gone with the turn
 *   CR 500.8, 603.7a, 505.1      "..., there's an additional combat phase after this phase. At the beginning of that combat, untap all creatures you control.": the untap happens at the beginning of THAT combat
 *                                only (not the regular one), for each landfall its own added combat, the one added last first
 *   CR 500.8, 506.1, 603.4       "If it's the first combat phase of your turn, there is an additional combat phase after this phase.": only the first combat, only on the controller's turn
 *   CR 702.3b, 510.1a, 611.2a    "Until end of turn, target creature with defender gains haste, can attack as though it didn't have defender, and assigns combat damage equal to its toughness rather than its power.":
 *                                the one target for this turn only
 *   CR 508.1, 603.2c             "Whenever you attack with ~ and another legendary creature, draw a card.": the same declaration, another legendary attacker, not for a lone attack
 *   CR 608.2c, 702.1             "creatures you control gain K until end of turn if a creature you control has K. The same is true for ...": each keyword on its own, checked as the ability resolves
 */
import { describe, expect, it } from 'vitest';
import { getChars, type CardDef, type GameState, type ObjectId } from '../../../src/index';
import { act, answer, find, scenario } from '../../m3/scenario';
import { passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';
import { card, full, pt, settle } from '../cmd3/helpers';

const FURY = card('Test Fury', 'Creature — Minotaur', "Each creature you control gets +1/+0 for each time it has attacked this turn.\nLandfall — Whenever a land you control enters, if it's your main phase, there's an additional combat phase after this phase. At the beginning of that combat, untap all creatures you control.", ['3', '3']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const FIST = card('Test Fist', 'Creature — Monk', "Trample\nWhenever one or more creatures you control with power 7 or greater deal combat damage to a player, untap all creatures you control. If it's the first combat phase of your turn, there is an additional combat phase after this phase.", ['1', '1']);
const TITAN = card('Test Titan', 'Creature — Giant', '', ['7', '7']);
const KNIGHT = card('Test Knight', 'Legendary Creature — Knight', 'Haste\nWhenever you attack with ~ and another legendary creature, draw a card.', ['2', '2']);
const HERO = card('Test Hero', 'Legendary Creature — Human', '', ['2', '2']);
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', 'Defender\n{2}: Until end of turn, target creature with defender gains haste, can attack as though it didn\'t have defender, and assigns combat damage equal to its toughness rather than its power. Activate only as a sorcery.', ['0', '3']);
const WALL = card('Test Wall', 'Creature — Wall', 'Defender', ['0', '4']);
const MARSHAL = card('Test Marshal', 'Legendary Creature — Soldier', 'At the beginning of each combat, creatures you control gain first strike until end of turn if a creature you control has first strike. The same is true for flying and trample.', ['2', '2']);
const MARSHAL2 = card('Test Marshal Two', 'Legendary Creature — Soldier', 'At the beginning of each combat, creatures you control gain flying until end of turn if a creature you control has flying. The same is true for hexproof and trample.', ['2', '2']);
const WARDEN = card('Test Warden', 'Creature — Knight', 'Hexproof from blue', ['2', '2']);
const STALWART = card('Test Stalwart', 'Creature — Knight', 'Hexproof', ['2', '2']);
const STRIKER = card('Test Striker', 'Creature — Soldier', 'First strike', ['1', '1']);
const FLYER = card('Test Flyer', 'Creature — Bird', 'Flying', ['1', '1']);
const BRUTE = card('Test Brute', 'Creature — Beast', 'Trample', ['3', '3']);
const RAMP = card('Test Rampant', 'Sorcery', 'You may play an additional land this turn.');
const LAND = card('Test Forest', 'Basic Land — Forest', '');
const FLASH = card('Test Rally', 'Instant', "If it's the first combat phase of your turn, you gain 3 life.", undefined, '{0}');
const DEFS: CardDef[] = [MARSHAL2, WARDEN, STALWART, LAND, FURY, BEAR, FIST, TITAN, KNIGHT, HERO, GOLEM, WALL, MARSHAL, STRIKER, FLYER, BRUTE, RAMP, FLASH];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const attack = (ids: ObjectId[]) => ({ kind: 'declareAttackers' as const, attacks: ids.map((attacker) => ({ attacker, defender: 'p2' })) });
const candidates = (s: GameState): ObjectId[] => (s.pending?.kind === 'declareAttackers' ? s.pending.candidates.map((c) => c.id) : []);
/** Pass until the next declare-attackers decision, or the postcombat main phase (nothing to declare). */
const noBlocks = (s: GameState): GameState => (s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : s);
/** Pass priority, declaring no blocks when asked, until `done`. */
function run(s0: GameState, done: (s: GameState) => boolean, what: string, max = 200): GameState {
  let s = s0;
  for (let i = 0; i < max; i++) {
    if (done(s)) return s;
    if (s.result) throw new Error(`The game ended while waiting for ${what}`);
    if (s.pending?.kind === 'declareBlockers') s = noBlocks(s);
    else if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
    else throw new Error(`Waiting for ${what} but a ${s.pending?.kind} decision is pending`);
  }
  throw new Error(`Never reached ${what}`);
}
const toNextCombat = (s: GameState): GameState => run(s, (x) => x.pending?.kind === 'declareAttackers' || x.turn.step === 'main2' || x.turn.number > 1, 'the next declare attackers decision or the second main phase');

describe('CR 508.1, 613.4c, 400.7: "Each creature you control gets +1/+0 for each time it has attacked this turn."', () => {
  it('+1/+0 for the one attack this turn, kept after combat, only for the creature that attacked and only for the controller', () => {
    const s0 = scenario1({ p1: { battlefield: ['Test Fury', 'Test Bear', 'Test Hero'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const hero = find(s0, 'Test Hero', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Bear', 'battlefield', 'p2');
    expect(pt(s0, bear)).toBe('2/2');
    const s = answer(toDeclareAttackers(s0), attack([bear]));
    expect(pt(s, bear), 'attacked once').toBe('3/2');
    expect(pt(s, hero), 'did not attack').toBe('2/2');
    expect(pt(s, theirs), 'not a creature of the controller').toBe('2/2');
    const t = run(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase');
    expect(pt(t, bear), 'the count is for the whole turn').toBe('3/2');
  });
  it('the count starts again each turn', () => {
    const s0 = scenario1({ p1: { battlefield: ['Test Fury', 'Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let s = answer(toDeclareAttackers(s0), attack([bear]));
    s = run(s, (x) => x.turn.number >= 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'the next own turn', 600);
    expect(pt(s, bear)).toBe('2/2');
  });
});

describe('CR 500.8, 603.7a, 505.1: "... there\'s an additional combat phase after this phase. At the beginning of that combat, untap all creatures you control."', () => {
  const land = (s: GameState): GameState => settle(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Forest', 'hand', 'p1') }));
  it('a land played in the first main phase: the added combat comes first and untaps at its beginning, not at the beginning of the regular combat', () => {
    const s0 = tweak(scenario1({ p1: { battlefield: ['Test Fury', 'Test Bear'], hand: ['Test Forest'] } }), (g) => { for (const id of g.zones.battlefield) g.objects[id]!.tapped = true; });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    expect(s0.objects[bear]!.tapped).toBe(true);
    let s = land(s0);
    s = run(s, (x) => x.pending?.kind === 'declareAttackers', 'the added combat declare attackers decision');
    expect(s.pending?.kind).toBe('declareAttackers');
    expect(candidates(s), 'untapped at the beginning of the added combat').toContain(bear);
    s = answer(s, attack([bear]));
    expect(pt(s, bear)).toBe('3/2');
    s = toNextCombat(s);
    expect(candidates(s), 'the regular combat does not untap: the Bear is tapped and has no vigilance').not.toContain(bear);
  });
  it('a land played in the second main phase: the added combat follows the second main phase and untaps there, once', () => {
    const s0 = scenario1({ p1: { battlefield: ['Test Fury', 'Test Bear'], hand: ['Test Forest'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let s = answer(toDeclareAttackers(s0), attack([bear]));
    s = run(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase');
    expect(s.objects[bear]!.tapped).toBe(true);
    s = land(s);
    s = run(s, (x) => x.pending?.kind === 'declareAttackers', 'the added combat after the second main phase');
    expect(candidates(s), 'untapped at the beginning of that combat').toContain(bear);
    s = answer(s, attack([bear]));
    expect(pt(s, bear), 'its second attack this turn').toBe('4/2');
  });
  it('two landfalls in one main phase make two added combats, each untapping at its own beginning (the last added first)', () => {
    const s0 = scenario1({ p1: { battlefield: ['Test Fury', 'Test Bear'], hand: ['Test Forest', 'Test Forest', 'Test Rampant'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let s = land(s0);
    s = settle(s);
    s = passUntil(s, (x) => x.zones.stack.length === 0 && x.pending?.kind === 'priority', 'the first landfall to resolve', 10);
    s = tweak(s, (g) => { g.objects[bear]!.tapped = true; });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rampant', 'hand', 'p1') });
    s = passUntil(s, (x) => x.zones.stack.length === 0 && x.pending?.kind === 'priority', 'the sorcery to resolve', 10);
    s = land(s);
    s = passUntil(s, (x) => x.zones.stack.length === 0 && x.pending?.kind === 'priority', 'the second landfall to resolve', 10);
    s = tweak(s, (g) => { g.objects[bear]!.tapped = true; });
    s = run(s, (x) => x.pending?.kind === 'declareAttackers', 'the first added combat');
    expect(candidates(s), 'untapped by the delayed trigger of the first added combat').toContain(bear);
    s = answer(s, attack([bear]));
    s = toNextCombat(s);
    expect(s.pending?.kind, 'a second added combat').toBe('declareAttackers');
    expect(candidates(s), 'the second added combat has its own untap').toContain(bear);
    s = answer(s, attack([bear]));
    expect(pt(s, bear), 'its second attack this turn').toBe('4/2');
    s = toNextCombat(s);
    expect(candidates(s), 'the regular combat does not untap').not.toContain(bear);
  });
});

const scenario1 = (o: { p1?: Record<string, string[]>; p2?: Record<string, string[]> }): GameState => scenario([], { p1: o.p1 ?? {}, p2: o.p2 ?? {}, defs: DEFS });
const hasKeyword = (s: GameState, id: ObjectId, k: string): boolean => getChars(s, id)!.keywords.some((x) => x.keyword === k);

describe('CR 500.8, 506.1, 603.4: "If it\'s the first combat phase of your turn, there is an additional combat phase after this phase."', () => {
  const titanCombat = (s0: GameState, who: ObjectId[]): GameState => answer(toDeclareAttackers(s0), attack(who));
  it('a creature with power 7 deals combat damage: all untap and one added combat follows; its damage in that combat untaps again but adds no third combat', () => {
    const s0 = scenario1({ p1: { battlefield: ['Test Fist', 'Test Titan'] } });
    const titan = find(s0, 'Test Titan', 'battlefield', 'p1');
    let s = titanCombat(s0, [titan]);
    s = run(s, (x) => x.pending?.kind === 'declareAttackers' || x.turn.step === 'main2', 'the added combat');
    expect(s.pending?.kind, 'the added combat').toBe('declareAttackers');
    expect(lifeOf(s, 'p2'), 'the first combat damage').toBe(13);
    expect(candidates(s), 'untapped by the trigger').toContain(titan);
    s = answer(s, attack([titan]));
    s = run(s, (x) => x.pending?.kind === 'declareAttackers' || x.turn.step === 'main2', 'the end of the added combat');
    expect(s.pending?.kind, 'no third combat: the second combat is not the first of the turn').not.toBe('declareAttackers');
    expect(lifeOf(s, 'p2')).toBe(6);
    expect(s.objects[titan]!.tapped, 'the second damage untapped all creatures again').toBe(false);
  });
  it('a creature with power 6 deals combat damage: nothing untaps and there is no added combat', () => {
    const s0 = scenario1({ p1: { battlefield: ['Test Fist', 'Test Bear', 'Test Hero'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = run(titanCombat(tweak(s0, (g) => { g.objects[bear]!.counters['+1/+1'] = 4; }), [bear]), (x) => x.pending?.kind === 'declareAttackers' || x.turn.step === 'main2', 'main 2');
    expect(s.pending?.kind).not.toBe('declareAttackers');
    expect(s.objects[bear]!.tapped, 'a 6/6 deals no untap').toBe(true);
  });
  it('the condition is the first combat of the controller\'s turn: true in the controller\'s first combat, false in an opponent\'s combat', () => {
    const s0 = scenario1({ p1: { battlefield: ['Test Bear'], hand: ['Test Rally'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let s = answer(toDeclareAttackers(s0), attack([bear]));
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rally', 'hand', 'p1') }));
    s = run(s, (x) => x.zones.stack.length === 0 && x.pending?.kind === 'priority', 'the instant to resolve');
    expect(lifeOf(s, 'p1'), 'cast in the controller\'s first combat').toBe(23);
    // an opponent's turn: p1 casts it in p2's combat
    const t0 = scenario1({ p1: { hand: ['Test Rally'] }, p2: { battlefield: ['Test Bear'] } });
    let t = run(t0, (x) => x.turn.activePlayer === 'p2' && x.pending?.kind === 'declareAttackers', 'p2 declare attackers', 600);
    t = answer(t, { kind: 'declareAttackers', attacks: [{ attacker: find(t, 'Test Bear', 'battlefield', 'p2'), defender: 'p1' }] });
    t = run(t, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p1', 'p1 priority in the declare attackers step', 20);
    t = settle(act(t, { type: 'cast', player: 'p1', card: find(t, 'Test Rally', 'hand', 'p1') }));
    t = run(t, (x) => x.zones.stack.length === 0 && x.pending?.kind === 'priority', 'the instant to resolve');
    expect(lifeOf(t, 'p1'), 'cast in an opponent\'s first combat: nothing').toBe(20);
  });
});

describe('CR 702.3b, 510.1a, 611.2a: "{2}: Until end of turn, target creature with defender gains haste, can attack as though it didn\'t have defender, and assigns combat damage equal to its toughness rather than its power."', () => {
  const setup = (): { s: GameState; wall: ObjectId; golem: ObjectId } => {
    const s0 = scenario1({ p1: { battlefield: [{ name: 'Test Golem' } as never, { name: 'Test Wall', since: 1 } as never, 'Test Forest', 'Test Forest'] }, p2: {} });
    return { s: s0, wall: find(s0, 'Test Wall', 'battlefield', 'p1'), golem: find(s0, 'Test Golem', 'battlefield', 'p1') };
  };
  const activate = (s0: GameState, golem: ObjectId, wall: ObjectId): GameState =>
    settle(act(s0, { type: 'activate', player: 'p1', source: golem, ability: 'p:0:1' }), { targets: [{ kind: 'object', id: wall }] });
  it('the target (summoning sick) may attack this turn and deals combat damage equal to its toughness; without the ability it is not even a candidate', () => {
    const { s: s0, wall, golem } = setup();
    let s = activate(s0, golem, wall);
    s = run(s, (x) => x.pending?.kind === 'priority' && x.zones.stack.length === 0, 'the ability to resolve', 5);
    s = toDeclareAttackers(s);
    expect(candidates(s)).toContain(wall);
    expect(candidates(s), 'only the target').not.toContain(golem);
    s = answer(s, attack([wall]));
    s = run(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase');
    expect(lifeOf(s, 'p2'), 'a 0/4 assigns 4').toBe(16);
    expect(getChars(s, wall)!.power, 'its power is not changed').toBe('0');
  });
  it('it lasts until end of turn only: next turn the wall is a defender again', () => {
    const { s: s0, wall, golem } = setup();
    let s = activate(s0, golem, wall);
    s = run(s, (x) => x.turn.number >= 3 && x.turn.activePlayer === 'p1' && x.turn.step === 'main2' && x.pending?.kind === 'priority', 'p1 second main phase on turn 3', 800);
    expect(s.objects[wall]!.tapped, 'a defender did not attack on turn 3').toBe(false);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(hasKeyword(s, wall, 'haste')).toBe(false);
  });
});

describe('CR 508.1, 603.2c: "Whenever you attack with ~ and another legendary creature, draw a card."', () => {
  const drawn = (s: GameState): number => s.zones.hand['p1']!.length;
  const base = (): GameState => scenario1({ p1: { battlefield: ['Test Knight', 'Test Hero', 'Test Bear'] } });
  const attackWith = (s0: GameState, names: string[]): GameState => {
    const s = answer(toDeclareAttackers(s0), attack(names.map((n) => find(s0, n, 'battlefield', 'p1'))));
    return run(s, (x) => x.zones.stack.length === 0 && x.pending?.kind === 'priority' && x.turn.step === 'declareAttackers', 'the trigger to resolve', 10);
  };
  it('with another legendary creature in the same declaration: one card', () => {
    const s0 = base();
    expect(drawn(attackWith(s0, ['Test Knight', 'Test Hero'])) - drawn(s0)).toBe(1);
  });
  it('with a creature that is not legendary, alone, or with only the other legendary creature: no card', () => {
    const s0 = base();
    expect(drawn(attackWith(s0, ['Test Knight', 'Test Bear'])) - drawn(s0), 'not legendary').toBe(0);
    expect(drawn(attackWith(s0, ['Test Knight'])) - drawn(s0), 'alone').toBe(0);
    expect(drawn(attackWith(s0, ['Test Hero', 'Test Bear'])) - drawn(s0), 'not this creature').toBe(0);
  });
});

describe('CR 608.2c, 702.1: "creatures you control gain K until end of turn if a creature you control has K. The same is true for flying and trample."', () => {
  const atCombat = (s0: GameState): GameState => run(s0, (x) => x.zones.stack.length === 0 && x.turn.step === 'beginCombat' && x.pending?.kind === 'priority', 'the beginning of combat', 30);
  it('each keyword a creature has is shared; a keyword no creature has is not', () => {
    const s0 = scenario1({ p1: { battlefield: ['Test Marshal', 'Test Striker', 'Test Flyer', 'Test Bear'] } });
    const s = atCombat(s0);
    for (const n of ['Test Marshal', 'Test Bear', 'Test Striker', 'Test Flyer']) {
      const id = find(s, n, 'battlefield', 'p1');
      expect(hasKeyword(s, id, 'first strike'), `${n} first strike`).toBe(true);
      expect(hasKeyword(s, id, 'flying'), `${n} flying`).toBe(true);
      expect(hasKeyword(s, id, 'trample'), `${n} trample (nobody has it)`).toBe(false);
    }
  });
  it('a keyword an opponent\'s creature has is not shared, and the grants end with the turn', () => {
    const s0 = scenario1({ p1: { battlefield: ['Test Marshal', 'Test Bear'] }, p2: { battlefield: ['Test Brute'] } });
    const s = atCombat(s0);
    expect(hasKeyword(s, find(s, 'Test Bear', 'battlefield', 'p1'), 'trample')).toBe(false);
    const t = run(s, (x) => x.turn.number >= 2 && x.turn.step === 'upkeep', 'the next turn', 400);
    expect(hasKeyword(t, find(t, 'Test Marshal', 'battlefield', 'p1'), 'first strike')).toBe(false);
  });
  it('the ability triggers at the beginning of each combat, an opponent\'s too', () => {
    const s0 = scenario1({ p1: { battlefield: ['Test Marshal', 'Test Brute'] } });
    const t = run(s0, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'beginCombat' && x.zones.stack.length === 0 && x.pending?.kind === 'priority', 'p2 beginning of combat', 600);
    expect(hasKeyword(t, find(t, 'Test Marshal', 'battlefield', 'p1'), 'trample')).toBe(true);
  });
});

describe('CR 702.11d-f, ruling 2020-01-24: Odric shares the specific variants of hexproof', () => {
  const quals = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.filter((k) => k.keyword === 'hexproof').map((k) => String(k.quality ?? 'plain')).sort();
  const atCombat = (s0: GameState): GameState => run(s0, (x) => x.zones.stack.length === 0 && x.turn.step === 'beginCombat' && x.pending?.kind === 'priority', 'the beginning of combat', 30);
  it('a creature with "hexproof from blue" makes the others gain hexproof from blue, not plain hexproof', () => {
    const s = atCombat(scenario1({ p1: { battlefield: ['Test Marshal Two', 'Test Warden', 'Test Bear'] } }));
    expect(quals(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toHaveLength(1);
    expect(quals(s, find(s, 'Test Bear', 'battlefield', 'p1'))[0]).not.toBe('plain');
  });
  it('a creature with plain hexproof makes the others gain plain hexproof', () => {
    const s = atCombat(scenario1({ p1: { battlefield: ['Test Marshal Two', 'Test Stalwart', 'Test Bear'] } }));
    expect(quals(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toEqual(['plain']);
  });
  it('with no hexproof among the creatures nobody gains it', () => {
    const s = atCombat(scenario1({ p1: { battlefield: ['Test Marshal Two', 'Test Bear'] } }));
    expect(quals(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toEqual([]);
  });
});
