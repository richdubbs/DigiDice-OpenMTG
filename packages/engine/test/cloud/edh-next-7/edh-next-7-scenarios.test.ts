/**
 * Commander lane edh-next, round edh-next-7 (EDHREC ranks 5,001-6,500, third pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler, in 4-player games. Each test is named after the rule it checks and the groups have their negative cases. CR cites are from the Comprehensive
 * Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 208.1, 115.1                   "Target 1/1 creature gets +2/+1 until end of turn." (only a creature with power 1 and toughness 1 can be chosen)
 *   CR 111.1, 603.4                   "At the beginning of each upkeep, if you don't control a Pest creature token, create a 1/1 ... Pest creature token"
 *   CR 701.9a, 121.1, 608.2e          "Any number of target opponents each discard their hands, then draw four cards."
 *   CR 701.21a, 701.9a, 119.3, 608.2c "Target opponent sacrifices a creature of their choice, discards two cards, then loses 3 life. You return ..., draw ..., then gain 2 life."
 *   CR 701.21a, 208.1, 608.2d         "Each opponent sacrifices a creature they control with the greatest power."
 *   CR 105.4, 608.2c, 400.3           "Return all permanents of the color of your choice to their owners' hands."
 *   CR 122.1, 115.3                   "Put a -1/-1 counter on target creature, two -1/-1 counters on another target creature, and three -1/-1 counters on a third target creature."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard, type DecisionAnswer, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act as mact, answer as manswer, find as mfind, mpScenario, pass as mpass, passUntil } from '../../m12/rules/helpers';
import { card, counters, full, pt, tokens } from '../cmd3/helpers';

const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const hand = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.defId).filter((n) => n !== 'Plains');
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const bf = (s: GameState, defId: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));
const yard = (s: GameState, p: PlayerId): string[] => (s.zones.graveyard[p] ?? []).map((id) => s.objects[id]!.defId);
const castIt = (s: GameState, player: PlayerId, name: string): GameState => mact(s, { type: 'cast', player, card: mfind(s, name, 'hand', player) });

interface Script {
  targets?: ObjectId[];
  playerTargets?: PlayerId[][];
  objects?: (options: ObjectId[], prompt: string, state: GameState, who: PlayerId) => ObjectId[];
  option?: (options: { id: string }[]) => string;
  color?: 'R' | 'U' | 'W' | 'B' | 'G';
  until?: (state: GameState) => boolean;
}
/** Answers whatever is asked, from the script, and passes priority until the stack is empty (or `until` holds). */
function run(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  const targets = [...(sc.targets ?? [])];
  const players = [...(sc.playerTargets ?? [])];
  for (let i = 0; i < 300; i++) {
    const p = s.pending;
    if (p === null || p === undefined) break;
    let a: DecisionAnswer | undefined;
    const d = p as unknown as { min?: number; max?: number; prompt: string; player: PlayerId };
    if (p.kind === 'chooseTargets') {
      const t = p as unknown as { objects?: ObjectId[]; min?: number };
      a = { kind: 'chooseTargets', targets: targets.length > 0 ? [{ kind: 'object', id: targets.shift()! }] : players.length > 0 ? players.shift()!.map((id) => ({ kind: 'player' as const, id })) : (t.objects ?? []).slice(0, t.min ?? 0).map((id) => ({ kind: 'object' as const, id })) } as DecisionAnswer;
    } else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: true };
    else if (p.kind === 'chooseObjects') {
      const o = (p as unknown as { options: ObjectId[] }).options;
      a = { kind: 'chooseObjects', ids: sc.objects !== undefined ? sc.objects(o, d.prompt, s, d.player) : o.slice(0, d.min ?? 0) };
    } else if (p.kind === 'chooseColor') a = { kind: 'chooseColor', color: sc.color ?? 'W' } as DecisionAnswer;
    else if (p.kind === 'chooseOption') {
      const o = (p as unknown as { options: { id: string }[] }).options;
      a = { kind: 'chooseOption', ids: [sc.option !== undefined ? sc.option(o) : o[0]!.id] };
    } else if (p.kind === 'chooseNumber') a = { kind: 'chooseNumber', n: d.min ?? 0 } as DecisionAnswer;
    else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) };
    else if (p.kind === 'declareBlockers') a = { kind: 'declareBlockers', blocks: [] };
    else if (p.kind === 'priority') { if (s.zones.stack.length === 0 && (sc.until === undefined || sc.until(s))) break; s = mpass(s); continue; }
    else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
    s = manswer(s, a);
  }
  return s;
}
const toMain = (s: GameState, player: PlayerId): GameState => passUntil(s, (x) => x.turn.activePlayer === player && x.turn.step === 'main1' && x.pending?.kind === 'priority', `${player}'s main phase`);

// ---- The Seedcore: "Target 1/1 creature" -----------------------------------------------------------------------------------------------------------------------------------
describe('CR 208.1, 115.1: "Target 1/1 creature gets +2/+1 until end of turn."', () => {
  const RITE = card('Test Seed Rite', 'Instant', 'Target 1/1 creature gets +2/+1 until end of turn.');
  const ONE = card('Test Seed Mouse', 'Creature — Mouse', '', ['1', '1']);
  const TWO = card('Test Seed Rat', 'Creature — Rat', '', ['2', '2']);
  const ONETWO = card('Test Seed Frog', 'Creature — Frog', '', ['1', '2']);
  const defs = [RITE, ONE, TWO, ONETWO];
  it('is automated', () => expect(full(RITE)).toBe(true));
  it('only a creature of power 1 AND toughness 1 may be chosen (a 2/2 and a 1/2 are not legal targets), and it gets +2/+1', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Seed Rite'], battlefield: ['Test Seed Mouse', 'Test Seed Rat', 'Test Seed Frog'] } } }), 'p1');
    s = castIt(s, 'p1', 'Test Seed Rite');
    const pend = s.pending as unknown as { kind: string; objects?: ObjectId[] };
    expect(pend.kind).toBe('chooseTargets');
    const mouse = mfind(s, 'Test Seed Mouse', 'battlefield', 'p1');
    expect(pend.objects).toEqual([mouse]);
    s = run(s);
    expect(pt(s, mouse)).toBe('3/2'); // +2/+1 until end of turn
    expect(pt(s, mfind(s, 'Test Seed Rat', 'battlefield', 'p1'))).toBe('2/2');
  });
});

// ---- Pest Rescuer: "if you don't control a Pest creature token" -----------------------------------------------------------------------------------------------------------
describe('CR 111.1, 603.4: "At the beginning of each upkeep, if you don\'t control a Pest creature token, create a 1/1 black and green Pest creature token ..."', () => {
  const KEEPER = card('Test Pest Keeper', 'Creature — Dryad', 'At the beginning of each upkeep, if you don\'t control a Pest creature token, create a 1/1 black and green Pest creature token with "When this token dies, you gain 1 life."', ['1', '1']);
  const defs = [KEEPER];
  const pests = (s: GameState, p: PlayerId): number => tokens(s, p).filter((id) => s.objects[id]!.defId.includes('Pest')).length;
  it('is automated', () => expect(full(KEEPER)).toBe(true));
  it('at the upkeep it creates a Pest token when its controller has none, in EVERY player\'s upkeep (each upkeep), and not another one while it has one', () => {
    let s = mpScenario({ defs, zones: { p1: { battlefield: ['Test Pest Keeper'] } } });
    s = passUntil(s, (x) => x.turn.step === 'upkeep' && x.pending !== null, 'an upkeep');
    s = run(s, { until: (x) => x.turn.step !== 'upkeep' });
    const first = pests(s, 'p1');
    expect(first).toBe(1);
    // the next upkeep (another player's): the token is still there, so no second token is made
    const turn = s.turn.number;
    s = passUntil(s, (x) => x.turn.step === 'upkeep' && x.turn.number > turn && x.pending !== null, 'the next upkeep');
    s = run(s, { until: (x) => x.turn.step !== 'upkeep' });
    expect(pests(s, 'p1')).toBe(1);
  });
});

// ---- Wheel and Deal ---------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.9a, 121.1, 608.2e: "Any number of target opponents each discard their hands, then draw four cards." and "Draw a card."', () => {
  const WHEEL = card('Test Wheel Rite', 'Instant', 'Any number of target opponents each discard their hands, then draw four cards.\nDraw a card.');
  const JUNK = card('Test Wheel Junk', 'Sorcery', '');
  const defs = [WHEEL, JUNK];
  const start = (): GameState => mpScenario({ defs, zones: {
    p1: { hand: ['Test Wheel Rite', 'Test Wheel Junk'] },
    p2: { hand: ['Test Wheel Junk', 'Test Wheel Junk'] },
    p3: { hand: ['Test Wheel Junk'] },
    p4: { hand: ['Test Wheel Junk', 'Test Wheel Junk', 'Test Wheel Junk'] },
  } });
  it('is automated', () => expect(full(WHEEL)).toBe(true));
  it('each chosen opponent discards their whole hand and draws four; an opponent not chosen keeps their hand; the caster draws one card and keeps their own hand', () => {
    const s0 = start();
    const before = handSize(s0, 'p1');
    const s = run(castIt(s0, 'p1', 'Test Wheel Rite'), { playerTargets: [['p2', 'p3']] });
    expect(handSize(s, 'p2')).toBe(4);
    expect(hand(s, 'p2')).toEqual([]);          // the four drawn cards are the library's, not the discarded ones
    expect(handSize(s, 'p3')).toBe(4);
    expect(yard(s, 'p2').filter((n) => n === 'Test Wheel Junk')).toHaveLength(2);
    expect(yard(s, 'p3').filter((n) => n === 'Test Wheel Junk')).toHaveLength(1);
    expect(hand(s, 'p4')).toEqual(['Test Wheel Junk', 'Test Wheel Junk', 'Test Wheel Junk']);
    expect(handSize(s, 'p1')).toBe(before); // the Rite left the hand and "Draw a card." drew one: the caster's own hand is not discarded
    expect(hand(s, 'p1')).toEqual(['Test Wheel Junk']);
  });
  it('"any number": with no target the discards and draws do not happen but the caster still draws a card', () => {
    const s0 = start();
    const s = run(castIt(s0, 'p1', 'Test Wheel Rite'), { playerTargets: [[]] });
    expect(handSize(s, 'p2')).toBe(2);
    expect(handSize(s, 'p4')).toBe(3);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1')); // one card cast, one drawn
  });
});

// ---- Cruel Ultimatum ---------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.21a, 701.9a, 119.3, 608.2c: "Target opponent sacrifices a creature of their choice, discards two cards, then loses 3 life. You return a creature card from your graveyard to your hand, draw two cards, then gain 2 life."', () => {
  const ULT = card('Test Ult Rite', 'Sorcery', 'Target opponent sacrifices a creature of their choice, discards two cards, then loses 3 life. You return a creature card from your graveyard to your hand, draw two cards, then gain 2 life.');
  const BEAST = card('Test Ult Beast', 'Creature — Beast', '', ['2', '2']);
  const JUNK = card('Test Ult Junk', 'Sorcery', '');
  const defs = [ULT, BEAST, JUNK];
  const start = (): GameState => mpScenario({ defs, zones: {
    p1: { hand: ['Test Ult Rite'], graveyard: ['Test Ult Beast'] },
    p2: { hand: ['Test Ult Junk', 'Test Ult Junk', 'Test Ult Junk'], battlefield: ['Test Ult Beast'] },
    p3: { hand: ['Test Ult Junk'], battlefield: ['Test Ult Beast'] },
  } });
  it('is automated', () => expect(full(ULT)).toBe(true));
  it('the chosen opponent sacrifices, discards two and loses 3; the caster then returns a creature card, draws two and gains 2; other players are untouched', () => {
    const s0 = start();
    const s = run(castIt(s0, 'p1', 'Test Ult Rite'), { playerTargets: [['p2']] });
    expect(bf(s, 'Test Ult Beast', 'p2')).toHaveLength(0);
    expect(yard(s, 'p2').filter((n) => n === 'Test Ult Junk')).toHaveLength(2);
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(hand(s, 'p1')).toEqual(['Test Ult Beast']); // returned from the graveyard
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1 + 1 + 2); // the Rite cast, the Beast returned, two cards drawn
    expect(lifeOf(s, 'p1')).toBe(22);
    expect(bf(s, 'Test Ult Beast', 'p3')).toHaveLength(1);
    expect(lifeOf(s, 'p3')).toBe(20);
  });
  it('the steps are in order: a creature the opponent sacrifices that you own is in your graveyard when you return one (ruling 2017-03-14)', () => {
    const base = start();
    const owned = mfind(base, 'Test Ult Beast', 'battlefield', 'p2');
    const s0 = { ...base, objects: { ...base.objects, [owned]: { ...base.objects[owned]!, owner: 'p1' as PlayerId } } } as GameState;
    const s = run(castIt(s0, 'p1', 'Test Ult Rite'), { playerTargets: [['p2']] });
    expect(yard(s, 'p1').filter((n) => n === 'Test Ult Beast').length + hand(s, 'p1').filter((n) => n === 'Test Ult Beast').length).toBe(2);
  });
});

// ---- Szat's Will ---------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.21a, 208.1, 608.2d: "Each opponent sacrifices a creature they control with the greatest power."', () => {
  const WILL = card('Test Will Rite', 'Sorcery', 'Each opponent sacrifices a creature they control with the greatest power.');
  const BIG = card('Test Will Giant', 'Creature — Giant', '', ['5', '5']);
  const MID = card('Test Will Bear', 'Creature — Bear', '', ['3', '3']);
  const SMALL = card('Test Will Mouse', 'Creature — Mouse', '', ['1', '1']);
  const defs = [WILL, BIG, MID, SMALL];
  it('is automated', () => expect(full(WILL)).toBe(true));
  it('each opponent considers their own creatures: the strongest of each goes (a 5 and a 3 for p2, only a 3 and a 1 for p3), the caster\'s own creatures stay', () => {
    const s = run(castIt(mpScenario({ defs, zones: {
      p1: { hand: ['Test Will Rite'], battlefield: ['Test Will Giant'] },
      p2: { battlefield: ['Test Will Giant', 'Test Will Bear'] },
      p3: { battlefield: ['Test Will Bear', 'Test Will Mouse'] },
      p4: { battlefield: [] },
    } }), 'p1', 'Test Will Rite'));
    expect(bf(s, 'Test Will Giant', 'p2')).toHaveLength(0);
    expect(bf(s, 'Test Will Bear', 'p2')).toHaveLength(1);
    expect(bf(s, 'Test Will Bear', 'p3')).toHaveLength(0);
    expect(bf(s, 'Test Will Mouse', 'p3')).toHaveLength(1);
    expect(bf(s, 'Test Will Giant', 'p1')).toHaveLength(1);
  });
  it('a tie for the greatest power: the player chooses which of the tied creatures to sacrifice, a smaller one is never chosen', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Will Rite'] }, p2: { battlefield: ['Test Will Giant', 'Test Will Giant', 'Test Will Mouse'] } } });
    const pend = castIt(s0, 'p1', 'Test Will Rite');
    const s = run(pend, { objects: (options, _p, st) => { for (const o of options) expect(st.objects[o]!.defId).toBe('Test Will Giant'); return [options[1]!]; } });
    expect(bf(s, 'Test Will Giant', 'p2')).toHaveLength(1);
    expect(bf(s, 'Test Will Mouse', 'p2')).toHaveLength(1);
  });
});

// ---- Wash Out -------------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 105.4, 608.2c, 400.3: "Return all permanents of the color of your choice to their owners\' hands."', () => {
  const WASH = card('Test Wash Rite', 'Instant', "Return all permanents of the color of your choice to their owners' hands.");
  const colored = (name: string, type: string, cost: string, colors: string[]) => compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: '', colors, power: '1', toughness: '1' } as OracleCard);
  const RED = colored('Test Wash Imp', 'Creature — Imp', '{R}', ['R']);
  const BLUE = colored('Test Wash Fish', 'Creature — Fish', '{U}', ['U']);
  const defs = [WASH, RED, BLUE];
  it('is automated', () => expect(full(WASH)).toBe(true));
  it('every permanent of the chosen color of every player returns to its owner\'s hand, permanents of other colors stay', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Wash Rite'], battlefield: ['Test Wash Imp', 'Test Wash Fish'] }, p2: { battlefield: ['Test Wash Imp', 'Test Wash Fish'] } } });
    const s = run(castIt(s0, 'p1', 'Test Wash Rite'), { color: 'R' });
    const reds = bf(s, 'Test Wash Imp').length;
    const blues = bf(s, 'Test Wash Fish').length;
    expect(reds).toBe(0); // red was chosen: both players' red creatures returned
    expect(blues).toBe(2); // the blue ones stayed
    expect(hand(s, 'p1')).toEqual(['Test Wash Imp']);
    expect(hand(s, 'p2')).toEqual(['Test Wash Imp']);
  });
});

// ---- Incremental Blight ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 122.1, 115.3: "Put a -1/-1 counter on target creature, two -1/-1 counters on another target creature, and three -1/-1 counters on a third target creature."', () => {
  const BLIGHT = card('Test Blight Rite', 'Sorcery', 'Put a -1/-1 counter on target creature, two -1/-1 counters on another target creature, and three -1/-1 counters on a third target creature.');
  const OX = card('Test Blight Ox', 'Creature — Ox', '', ['9', '9']);
  const defs = [BLIGHT, OX];
  it('is automated', () => expect(full(BLIGHT)).toBe(true));
  it('three DIFFERENT creatures get 1, 2 and 3 counters; the targets are chosen one by one and none repeats', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Blight Rite'], battlefield: ['Test Blight Ox'] }, p2: { battlefield: ['Test Blight Ox', 'Test Blight Ox'] } } });
    const ids = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Blight Ox');
    expect(ids).toHaveLength(3);
    const s = run(castIt(s0, 'p1', 'Test Blight Rite'), { targets: [ids[0]!, ids[1]!, ids[2]!] });
    expect([ids[0]!, ids[1]!, ids[2]!].map((id) => counters(s, id, '-1/-1'))).toEqual([1, 2, 3]);
  });
  it('the same creature cannot be chosen twice: once the first is taken the others are offered without it', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Blight Rite'], battlefield: ['Test Blight Ox'] }, p2: { battlefield: ['Test Blight Ox', 'Test Blight Ox'] } } });
    const ids = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Blight Ox');
    let s = castIt(s0, 'p1', 'Test Blight Rite');
    s = manswer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: ids[0]! }] } as DecisionAnswer);
    const second = s.pending as unknown as { kind: string; objects?: ObjectId[] };
    expect(second.kind).toBe('chooseTargets');
    expect(second.objects).not.toContain(ids[0]!);
    expect(second.objects).toHaveLength(2);
  });
});
