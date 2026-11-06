/**
 * Commander lane edh-next, round edh-next-6: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default compiler, in
 * 4-player games. Each test is named after the rule it checks and the groups have their negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 615.1a, 510.2, 611.2a          "Prevent all combat damage that would be dealt this turn to Dogs you control." / "... to creatures you control this turn."
 *   CR 119.3, 701.9a, 701.21a, 101.4  "Each player loses 1 life, discards a card, sacrifices a creature of their choice, then sacrifices a land of their choice."
 *   CR 400.3, 608.2c                  "Return to their owners' hands all creatures with toughness less than or equal to the number of Islands you control."
 *   CR 502.3, 611.2a, 611.2c          "Each attacking creature doesn't untap during its controller's next untap step." (the set is fixed as the spell resolves)
 *   CR 506.1, 603.2, 601.2i           "Whenever you cast a spell during combat, you get an experience counter."
 *   CR 701.6a, 118.12, 701.9a         "Counter target spell unless its controller discards their hand."
 */
import { describe, expect, it } from 'vitest';
import { getChars, hasKeyword, legalActions, type DecisionAnswer, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act as mact, answer as manswer, find as mfind, mpScenario, pass as mpass, passUntil, reject } from '../../m12/rules/helpers';
import { card, full, pt, tokens } from '../cmd3/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const hand = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.defId).filter((n) => n !== 'Plains');
const yard = (s: GameState, p: PlayerId): string[] => (s.zones.graveyard[p] ?? []).map((id) => s.objects[id]!.defId);
const bf = (s: GameState, defId: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));

interface Script {
  targets?: ObjectId[];
  playerTargets?: PlayerId[];
  yes?: boolean | ((prompt: string, who: PlayerId) => boolean);
  objects?: (options: ObjectId[], prompt: string, state: GameState, who: PlayerId) => ObjectId[];
  numbers?: number[];
  /** Keeps passing priority (and declares no blockers) until this holds, as well as emptying the stack. */
  until?: (state: GameState) => boolean;
}
/** Answers whatever is asked, from the script, and passes priority until the stack is empty (or `until` holds). */
function run(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  const targets = [...(sc.targets ?? [])];
  const players = [...(sc.playerTargets ?? [])];
  const numbers = [...(sc.numbers ?? [])];
  for (let i = 0; i < 300; i++) {
    const p = s.pending;
    if (p === null || p === undefined) break;
    let a: DecisionAnswer | undefined;
    const d = p as unknown as { min?: number; max?: number; prompt: string; player: PlayerId };
    if (p.kind === 'chooseTargets') {
      const t = p as unknown as { objects?: ObjectId[]; min?: number };
      a = { kind: 'chooseTargets', targets: targets.length > 0 ? [{ kind: 'object', id: targets.shift()! }] : players.length > 0 ? [{ kind: 'player', id: players.shift()! }] : (t.objects ?? []).slice(0, t.min ?? 0).map((id) => ({ kind: 'object' as const, id })) } as DecisionAnswer;
    } else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: typeof sc.yes === 'function' ? sc.yes(d.prompt, d.player) : sc.yes ?? true };
    else if (p.kind === 'chooseObjects') {
      const o = (p as unknown as { options: ObjectId[] }).options;
      a = { kind: 'chooseObjects', ids: sc.objects !== undefined ? sc.objects(o, d.prompt, s, d.player) : o.slice(0, d.min ?? 0) };
    } else if (p.kind === 'chooseOption') a = { kind: 'chooseOption', ids: [(p as unknown as { options: { id: string }[] }).options[0]!.id] };
    else if (p.kind === 'chooseNumber') a = { kind: 'chooseNumber', n: numbers.shift() ?? d.min ?? 0 } as DecisionAnswer;
    else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) };
    else if (p.kind === 'declareBlockers') a = { kind: 'declareBlockers', blocks: [] };
    else if (p.kind === 'priority') { if (s.zones.stack.length === 0 && (sc.until === undefined || sc.until(s))) break; s = mpass(s); continue; }
    else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
    s = manswer(s, a);
  }
  return s;
}
/** Passes priority to the main phase of the given turn's active player. */
const toMain = (s: GameState, player: PlayerId): GameState => passUntil(s, (x) => x.turn.activePlayer === player && x.turn.step === 'main1' && x.pending?.kind === 'priority', `${player}'s main phase`);
const attack = (s: GameState, id: ObjectId, defender: PlayerId): GameState => declareAttackers(toDeclareAttackers(s), [[id, defender]]);
const afterDamage = (s: GameState): boolean => s.turn.step === 'endCombat' || s.turn.step === 'main2';


const pendingOf = (s: GameState) => s.pending;
const castIt = (s: GameState, player: PlayerId, name: string): GameState => mact(s, { type: 'cast', player, card: mfind(s, name, 'hand', player) });
const counterOf = (s: GameState, p: PlayerId, kind: string): number => ((s.players.find((x) => x.id === p) as unknown as { counters?: Record<string, number> }).counters ?? {})[kind] ?? 0;
const blocksAnswer = (s: GameState, blocks: [ObjectId, ObjectId][]): GameState => manswer(s, { kind: 'declareBlockers', blocks: blocks.map(([blocker, attacker]) => ({ blocker, attacker })) } as DecisionAnswer);

// ---- Pack Leader / Loyal Unicorn: prevent all combat damage that would be dealt to a group -------------------------------------------------------------------------------
describe('CR 615.1a, 510.2, 611.2a: "Prevent all combat damage that would be dealt this turn to Dogs you control." and "... to creatures you control this turn."', () => {
  const HOUND = card('Test Pack Hound', 'Creature — Dog', 'Whenever ~ attacks, prevent all combat damage that would be dealt this turn to Dogs you control.', ['1', '1']);
  const DOG = card('Test Plain Dog', 'Creature — Dog', '', ['1', '1']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['1', '1']);
  const BIG = card('Test Big Wall', 'Creature — Wall', '', ['3', '3']);
  const BIGDOG = card('Test Big Dog', 'Creature — Dog', '', ['1', '1']);
  const WARD = card('Test Ward Rite', 'Instant', 'Prevent all combat damage that would be dealt to creatures you control this turn.');
  const defs = [HOUND, DOG, BEAR, BIG, BIGDOG, WARD];
  it('are automated', () => { for (const d of [HOUND, WARD]) expect(full(d)).toBe(true); });
  it('Dogs of the attacking player take no combat damage, a Bear does, and an opponent\'s Dog still does (only "Dogs you control")', () => {
    let s = toMain(mpScenario({ defs, zones: { p2: { battlefield: ['Test Pack Hound', 'Test Plain Dog', 'Test Plain Bear'] }, p3: { battlefield: ['Test Big Wall', 'Test Big Wall', 'Test Big Dog'] } } }), 'p2');
    const hound = mfind(s, 'Test Pack Hound', 'battlefield', 'p2'), dog = mfind(s, 'Test Plain Dog', 'battlefield', 'p2'), bear = mfind(s, 'Test Plain Bear', 'battlefield', 'p2');
    s = declareAttackers(toDeclareAttackers(s), [[hound, 'p3'], [dog, 'p3'], [bear, 'p3']]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision');
    const walls = bf(s, 'Test Big Wall', 'p3');
    const bigDog = bf(s, 'Test Big Dog', 'p3')[0]!;
    // the Wall blocks the Bear, a second Wall blocks the Dog; p3's own Dog blocks the Hound
    s = blocksAnswer(s, [[walls[0]!, bear], [walls[1]!, dog], [bigDog, hound]]);
    s = run(s, { until: (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2' });
    expect(bf(s, 'Test Pack Hound', 'p2')).toHaveLength(1);
    expect(bf(s, 'Test Plain Dog', 'p2')).toHaveLength(1);
    expect(bf(s, 'Test Plain Bear', 'p2')).toHaveLength(0);
    expect(bf(s, 'Test Big Dog', 'p3')).toHaveLength(0); // p3's Dog took the Hound's damage: Dogs of the player who does not control the ability are not protected
  });
  it('"to creatures you control": a creature that entered the battlefield after the instant resolved is protected too (Loyal Unicorn ruling 2018-07-13), an opponent\'s creature is not', () => {
    let s = toMain(mpScenario({ defs, zones: { p2: { battlefield: ['Test Plain Bear'], hand: ['Test Ward Rite', 'Test Plain Dog'] }, p3: { battlefield: ['Test Big Wall'] } } }), 'p2');
    s = run(castIt(s, 'p2', 'Test Ward Rite'));
    const bear = mfind(s, 'Test Plain Bear', 'battlefield', 'p2');
    s = declareAttackers(toDeclareAttackers(s), [[bear, 'p3']]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision');
    s = blocksAnswer(s, [[bf(s, 'Test Big Wall', 'p3')[0]!, bear]]);
    s = run(s, { until: (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2' });
    expect(bf(s, 'Test Plain Bear', 'p2')).toHaveLength(1);
    expect(lifeOf(s, 'p3')).toBe(20);
  });
  it('the prevention ends with the turn: the next turn\'s combat damage is dealt again', () => {
    let s = toMain(mpScenario({ defs, zones: { p2: { hand: ['Test Ward Rite'] }, p3: { battlefield: ['Test Plain Bear'] } } }), 'p2');
    s = run(castIt(s, 'p2', 'Test Ward Rite'));
    s = toMain(s, 'p3');
    const bear = mfind(s, 'Test Plain Bear', 'battlefield', 'p3');
    s = declareAttackers(toDeclareAttackers(s), [[bear, 'p2']]);
    s = run(s, { until: afterDamage });
    expect(lifeOf(s, 'p2')).toBe(19); // p2 is a player, not a creature: the instant never stops damage to players, and the new turn has no prevention
  });
});

// ---- Smallpox ---------------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 119.3, 701.9a, 701.21a, 101.4: "Each player loses 1 life, discards a card, sacrifices a creature of their choice, then sacrifices a land of their choice."', () => {
  const POX = card('Test Pox Rite', 'Sorcery', 'Each player loses 1 life, discards a card, sacrifices a creature of their choice, then sacrifices a land of their choice.');
  const RAT = card('Test Pox Rat', 'Creature — Rat', '', ['1', '1']);
  const FEN = card('Test Pox Fen', 'Land', '{T}: Add {B}.');
  const LOT = card('Test Pox Lot', 'Sorcery', '');
  const defs = [POX, RAT, FEN, LOT];
  const start = (): GameState => mpScenario({ defs, zones: {
    p1: { hand: ['Test Pox Rite', 'Test Pox Lot'], battlefield: ['Test Pox Rat', 'Test Pox Rat', 'Test Pox Fen', 'Test Pox Fen'] },
    p2: { hand: ['Test Pox Lot'], battlefield: ['Test Pox Rat', 'Test Pox Fen'] },
    p3: { hand: ['Test Pox Lot', 'Test Pox Lot'], battlefield: ['Test Pox Rat', 'Test Pox Fen', 'Test Pox Fen'] },
    p4: { hand: [], battlefield: [] },
  } });
  it('is automated', () => expect(full(POX)).toBe(true));
  it('every player (the caster too) loses 1 life, discards one card, sacrifices one creature and one land; a player with nothing to give gives nothing', () => {
    const s = run(castIt(start(), 'p1', 'Test Pox Rite'));
    for (const p of ['p1', 'p2', 'p3', 'p4'] as PlayerId[]) expect(lifeOf(s, p), p).toBe(19);
    expect(hand(s, 'p1')).toEqual([]); // the Rite left the hand as it was cast, the Lot was discarded
    expect(hand(s, 'p2')).toEqual([]);
    expect(hand(s, 'p3')).toEqual(['Test Pox Lot']);
    expect(bf(s, 'Test Pox Rat', 'p1')).toHaveLength(1);
    expect(bf(s, 'Test Pox Fen', 'p1')).toHaveLength(1);
    expect(bf(s, 'Test Pox Rat', 'p2')).toHaveLength(0);
    expect(bf(s, 'Test Pox Fen', 'p2')).toHaveLength(0);
    expect(bf(s, 'Test Pox Rat', 'p3')).toHaveLength(0);
    expect(bf(s, 'Test Pox Fen', 'p3')).toHaveLength(1);
    expect(yard(s, 'p4')).toEqual([]);
  });
});

// ---- Engulf the Shore --------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 400.3, 608.2c: "Return to their owners\' hands all creatures with toughness less than or equal to the number of Islands you control."', () => {
  const TIDE = card('Test Tide Rite', 'Instant', "Return to their owners' hands all creatures with toughness less than or equal to the number of Islands you control.");
  const ISLE = card('Test Isle', 'Basic Land — Island', '{T}: Add {U}.');
  const X1 = card('Test Tough One', 'Creature — Rat', '', ['1', '1']);
  const X2 = card('Test Tough Two', 'Creature — Rat', '', ['1', '2']);
  const X3 = card('Test Tough Three', 'Creature — Rat', '', ['1', '3']);
  const defs = [TIDE, ISLE, X1, X2, X3];
  it('is automated', () => expect(full(TIDE)).toBe(true));
  it('with two Islands, creatures of toughness 2 or less of every player go to their OWNERS\' hands (a stolen one too), toughness 3 stays; lands and the Islands stay', () => {
    const s0 = mpScenario({ defs, zones: {
      p1: { hand: ['Test Tide Rite'], battlefield: ['Test Isle', 'Test Isle', 'Test Tough One', 'Test Tough Three'] },
      p2: { battlefield: ['Test Tough Two', 'Test Tough Three'] },
      p3: { battlefield: [] },
    } });
    const two = mfind(s0, 'Test Tough Two', 'battlefield', 'p2');
    const stolen = { ...s0, objects: { ...s0.objects, [two]: { ...s0.objects[two]!, controller: 'p3' as PlayerId } } };
    const s = run(castIt(stolen as GameState, 'p1', 'Test Tide Rite'));
    expect(hand(s, 'p1')).toEqual(['Test Tough One']);
    expect(hand(s, 'p2')).toEqual(['Test Tough Two']);
    expect(hand(s, 'p3')).toEqual([]);
    expect(bf(s, 'Test Tough Three')).toHaveLength(2);
    expect(bf(s, 'Test Isle', 'p1')).toHaveLength(2);
  });
  it('with no Island nothing is returned (toughness at most 0)', () => {
    const s = run(castIt(mpScenario({ defs, zones: { p1: { hand: ['Test Tide Rite'], battlefield: ['Test Tough One'] } } }), 'p1', 'Test Tide Rite'));
    expect(bf(s, 'Test Tough One', 'p1')).toHaveLength(1);
  });
});

// ---- Tangle ------------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 502.3, 611.2a, 611.2c: "Prevent all combat damage that would be dealt this turn. Each attacking creature doesn\'t untap during its controller\'s next untap step."', () => {
  const TANGLE = card('Test Tangle Rite', 'Instant', "Prevent all combat damage that would be dealt this turn.\nEach attacking creature doesn't untap during its controller's next untap step.");
  const KNIGHT = card('Test Tangle Knight', 'Creature — Knight', '', ['2', '2']);
  const SCOUT = card('Test Tangle Scout', 'Creature — Scout', '', ['1', '1']);
  const defs = [TANGLE, KNIGHT, SCOUT];
  it('is automated', () => expect(full(TANGLE)).toBe(true));
  it('the attackers take no damage dealt, stay tapped through THEIR controller\'s next untap step (turn 6), and untap in the one after; a creature that did not attack untaps as usual', () => {
    let s = toMain(mpScenario({ defs, zones: { p2: { battlefield: ['Test Tangle Knight', 'Test Tangle Scout'] }, p3: { hand: ['Test Tangle Rite'] } } }), 'p2');
    const knight = mfind(s, 'Test Tangle Knight', 'battlefield', 'p2'), scout = mfind(s, 'Test Tangle Scout', 'battlefield', 'p2');
    s = declareAttackers(toDeclareAttackers(s), [[knight, 'p3']]);
    s = passUntil(s, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p3' && x.turn.step === 'declareAttackers', "p3's priority in the declare attackers step");
    s = run(castIt(s, 'p3', 'Test Tangle Rite'), { until: afterDamage });
    expect(lifeOf(s, 'p3')).toBe(20); // combat damage prevented
    expect(s.objects[knight]!.tapped).toBe(true);
    s = passUntil(s, (x) => x.turn.number === 6 && x.turn.step === 'upkeep' && x.pending?.kind === 'priority', "turn 6's upkeep");
    expect(s.objects[knight]!.tapped, 'the attacker is still tapped through its controller\'s next untap step').toBe(true);
    expect(s.objects[scout]!.tapped).toBe(false);
    s = passUntil(s, (x) => x.turn.number === 10 && x.turn.step === 'upkeep' && x.pending?.kind === 'priority', "turn 10's upkeep");
    expect(s.objects[knight]!.tapped, 'it untaps in the untap step after that').toBe(false);
  });
  it('the set is fixed as the spell resolves (ruling 2025-09-19): a creature that attacks later is not held', () => {
    let s = toMain(mpScenario({ defs, zones: { p2: { battlefield: ['Test Tangle Knight', 'Test Tangle Scout'] }, p3: { hand: ['Test Tangle Rite'] } } }), 'p2');
    const knight = mfind(s, 'Test Tangle Knight', 'battlefield', 'p2'), scout = mfind(s, 'Test Tangle Scout', 'battlefield', 'p2');
    s = declareAttackers(toDeclareAttackers(s), [[knight, 'p3']]);
    s = passUntil(s, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p3' && x.turn.step === 'declareAttackers', "p3's priority in the declare attackers step");
    s = run(castIt(s, 'p3', 'Test Tangle Rite'), { until: afterDamage });
    s = passUntil(s, (x) => x.turn.number === 6 && x.turn.step === 'main1' && x.pending?.kind === 'priority', "turn 6's main phase");
    s = declareAttackers(toDeclareAttackers(s), [[scout, 'p3']]);
    s = run(s, { until: afterDamage });
    s = passUntil(s, (x) => x.turn.number === 10 && x.turn.step === 'main1' && x.pending?.kind === 'priority', "turn 10's main phase");
    expect(s.objects[scout]!.tapped, 'the creature that attacked later untaps as usual').toBe(false);
    expect(s.objects[knight]!.tapped).toBe(false);
  });
});

// ---- Zuko --------------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 506.1, 603.2, 601.2i: "Whenever you cast a spell during combat, you get an experience counter."', () => {
  const ZUKO = card('Test Combat Muse', 'Creature — Human', 'Whenever you cast a spell during combat, you get an experience counter.', ['2', '2']);
  const FLASH = card('Test Flash Spell', 'Instant', 'You gain 1 life.');
  const SORC = card('Test Slow Spell', 'Sorcery', 'You gain 1 life.');
  const AT = card('Test Attacker', 'Creature — Rat', '', ['1', '1']);
  const defs = [ZUKO, FLASH, SORC, AT];
  it('is automated', () => expect(full(ZUKO)).toBe(true));
  it('casting during combat (even on another player\'s turn) gives a counter; casting in a main phase does not; an opponent\'s cast does not', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { battlefield: ['Test Combat Muse'], hand: ['Test Flash Spell', 'Test Flash Spell'] }, p2: { battlefield: ['Test Attacker'], hand: ['Test Flash Spell'] } } }), 'p2');
    s = passUntil(s, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p1' && x.turn.step === 'main1' && x.turn.activePlayer === 'p2', "p1's priority in p2's main phase");
    s = run(castIt(s, 'p1', 'Test Flash Spell')); // main phase of p2's turn
    expect(counterOf(s, 'p1', 'experience')).toBe(0);
    s = declareAttackers(toDeclareAttackers(s), [[mfind(s, 'Test Attacker', 'battlefield', 'p2'), 'p3']]);
    s = passUntil(s, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p1' && x.turn.step === 'declareAttackers', "p1's priority in combat");
    s = run(castIt(s, 'p1', 'Test Flash Spell'));
    expect(counterOf(s, 'p1', 'experience')).toBe(1);
    s = passUntil(s, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p2' && x.turn.step === 'declareAttackers', "p2's priority in combat");
    s = run(castIt(s, 'p2', 'Test Flash Spell'));
    expect(counterOf(s, 'p1', 'experience')).toBe(1);
    expect(counterOf(s, 'p2', 'experience')).toBe(0);
  });
});

// ---- Perplex -----------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.6a, 118.12, 701.9a: "Counter target spell unless its controller discards their hand."', () => {
  const PERPLEX = card('Test Perplex Rite', 'Instant', 'Counter target spell unless its controller discards their hand.');
  const SPELL = card('Test Gain Spell', 'Sorcery', 'You gain 5 life.');
  const LOT = card('Test Perplex Lot', 'Sorcery', '');
  const defs = [PERPLEX, SPELL, LOT];
  const setup = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Gain Spell', 'Test Perplex Lot', 'Test Perplex Lot'] }, p2: { hand: ['Test Perplex Rite'] } } });
  const play = (decline: boolean): GameState => {
    let s = castIt(setup(), 'p1', 'Test Gain Spell');
    s = passUntil(s, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p2', "p2's priority");
    s = castIt(s, 'p2', 'Test Perplex Rite');
    s = run(s, { targets: [s.zones.stack[0]!], yes: !decline, until: (x) => x.zones.stack.length === 0 });
    return s;
  };
  it('is automated', () => expect(full(PERPLEX)).toBe(true));
  it('the spell\'s controller may discard their whole hand to keep the spell: the spell resolves, the hand is empty', () => {
    const s = play(false);
    expect(lifeOf(s, 'p1')).toBe(25);
    expect(hand(s, 'p1')).toEqual([]);
  });
  it('if they decline the spell is countered and the hand is kept', () => {
    const s = play(true);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(hand(s, 'p1')).toEqual(['Test Perplex Lot', 'Test Perplex Lot']);
    expect(yard(s, 'p1')).toEqual(['Test Gain Spell']);
  });
});

// ---- Solidarity of Heroes ----------------------------------------------------------------------------------------------------------------------------------------
describe('CR 115.1, 122.1: "Choose any number of target creatures. Double the number of +1/+1 counters on each of them."', () => {
  const RITE = card('Test Double Rite', 'Sorcery', 'Choose any number of target creatures. Double the number of +1/+1 counters on each of them.');
  const GROWER = card('Test Counter Cub', 'Creature — Bear', '', ['1', '1']);
  const defs = [RITE, GROWER];
  const counts = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['+1/+1'] ?? 0;
  it('is automated', () => expect(full(RITE)).toBe(true));
  it('every chosen creature doubles its +1/+1 counters (a creature with none stays at none, an unchosen one is untouched)', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Double Rite'], battlefield: [{ name: 'Test Counter Cub', counters: { '+1/+1': 2 } }, { name: 'Test Counter Cub', counters: { '+1/+1': 3 } }, 'Test Counter Cub'] }, p2: { battlefield: [{ name: 'Test Counter Cub', counters: { '+1/+1': 4 } }] } } });
    const cubs = bf(s0, 'Test Counter Cub', 'p1');
    const [a, b, c] = [cubs.find((id) => counts(s0, id) === 2)!, cubs.find((id) => counts(s0, id) === 3)!, cubs.find((id) => counts(s0, id) === 0)!];
    const theirs = bf(s0, 'Test Counter Cub', 'p2')[0]!;
    let s = castIt(s0, 'p1', 'Test Double Rite');
    s = manswer(s, { kind: 'chooseTargets', targets: [a, b, c, theirs].slice(0, 3).map((id) => ({ kind: 'object' as const, id })) } as DecisionAnswer);
    s = run(s);
    expect(counts(s, a)).toBe(4);
    expect(counts(s, b)).toBe(6);
    expect(counts(s, c)).toBe(0);
    expect(counts(s, theirs)).toBe(4);
  });
});

// ---- Death Cloud (held-out, opened for verification: the same template with X) ------------------------------------------------------------------------------------------
describe('CR 107.3, 119.3, 701.9a, 701.21a: "Each player loses X life, discards X cards, sacrifices X creatures of their choice, then sacrifices X lands of their choice."', () => {
  const CLOUD = card('Test Pox Cloud', 'Sorcery', 'Each player loses X life, discards X cards, sacrifices X creatures of their choice, then sacrifices X lands of their choice.', undefined, '{X}');
  const RAT = card('Test Cloud Rat', 'Creature — Rat', '', ['1', '1']);
  const FEN = card('Test Cloud Fen', 'Land', '{T}: Add {B}.');
  const LOT = card('Test Cloud Lot', 'Sorcery', '');
  const defs = [CLOUD, RAT, FEN, LOT];
  it('is automated', () => expect(full(CLOUD)).toBe(true));
  it('with X = 2 every player loses 2 life, discards up to 2 cards, sacrifices up to 2 creatures and up to 2 lands (what they have)', () => {
    const s0 = mpScenario({ defs, zones: {
      p1: { hand: ['Test Pox Cloud', 'Test Cloud Lot', 'Test Cloud Lot', 'Test Cloud Lot'], battlefield: ['Plains', 'Plains', 'Test Cloud Rat', 'Test Cloud Rat', 'Test Cloud Rat', 'Test Cloud Fen', 'Test Cloud Fen', 'Test Cloud Fen'] },
      p2: { hand: ['Test Cloud Lot'], battlefield: ['Test Cloud Rat', 'Test Cloud Fen'] },
    } });
    const s = run(castIt(s0, 'p1', 'Test Pox Cloud'), { numbers: [2], objects: (o) => o.slice(0, 2) });
    for (const p of ['p1', 'p2', 'p3', 'p4'] as PlayerId[]) expect(lifeOf(s, p), p).toBe(18);
    expect(hand(s, 'p1')).toEqual(['Test Cloud Lot']);
    expect(hand(s, 'p2')).toEqual([]);
    expect(bf(s, 'Test Cloud Rat', 'p1')).toHaveLength(1); // 3 creatures, 2 sacrificed
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && getChars(s, id)!.types.includes('Land'))).toHaveLength(3); // 5 lands (two of them the Plains that paid X), 2 sacrificed
    expect(bf(s, 'Test Cloud Rat', 'p2')).toHaveLength(0); // one creature, one land: a player with fewer than X gives all they have
    expect(bf(s, 'Test Cloud Fen', 'p2')).toHaveLength(0);
  });
});
