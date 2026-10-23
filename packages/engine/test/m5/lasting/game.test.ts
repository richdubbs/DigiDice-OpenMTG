/**
 * The ops about the game itself (effects/handlers/game.ts): extra turns (CR 500.7), extra phases (500.8), ending the turn (724.1), winning and losing (104),
 * emblems (114), dice (706) and coins (705), designations (725 the monarch, 731 day and night), and keyword actions through the library's macros (701).
 * Real turns; the spine, the pipeline and the ops of other families are the fakes of neighbors.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AbilityDef, EffectStep, GameState, Step } from '../../../src/index';
import { getChars } from '../../../src/index';
import { SRC_ROOT, advanceTo, answer, attackUnblocked, find, pass, passBoth, scenario } from '../helpers';
import { neighbors } from './neighbors';
import { cast, castAndResolve, creatureTarget, instant, objectTarget, permanent, playerTarget, lastLog, pt, setup, targets } from './support';

vi.mock('../../../src/effects/propose', async (o) => (await import('./neighbors')).proposeMock(await o()));
vi.mock('../../../src/effects/manual', async (o) => (await import('./neighbors')).manualMock(await o()));
vi.mock('../../../src/effects/run', async (o) => (await import('./neighbors')).runMock(await o()));
vi.mock('../../../src/core/resolve', async (o) => (await import('./neighbors')).resolveMock(await o()));

beforeEach(setup);

const sorcery = (name: string, steps: EffectStep[], t = [] as Parameters<typeof instant>[2]) => instant(name, steps, t, 'Sorcery');
const pump = (power: number | { q: 'dieResult' }, toughness = 0): EffectStep => ({
  op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'target', id: 't0' }, mods: [{ layer: '7c', power, toughness }] }],
});
const playerSpec = { id: 't0', kind: 'player' as const, min: 1, max: 1, text: 'target player' };
const activeOf = (s: GameState, turn: number): string => advanceTo(s, turn, 'upkeep').turn.activePlayer;

describe('CR 500.7: extra turns', () => {
  it('"Take an extra turn after this one.": the next turn is yours again, an extra turn; then the normal order goes on', () => {
    const WALK = sorcery('Walk Test', [{ op: 'extraTurn', who: { ref: 'you' }, count: 1 }]);
    const s = castAndResolve(scenario([], { p1: { hand: ['Walk Test'] }, defs: [WALK] }), 'Walk Test');
    expect(s.turn.extraTurns).toEqual(['p1']);
    const t2 = advanceTo(s, 2, 'upkeep');
    expect([t2.turn.activePlayer, t2.turn.extra]).toEqual(['p1', true]);
    const t3 = advanceTo(t2, 3, 'upkeep');
    expect([t3.turn.activePlayer, t3.turn.extra]).toEqual(['p2', undefined]);
  });

  it('"Target player takes an extra turn after this one." on the opponent: their extra turn, then their normal turn (added directly after this turn)', () => {
    const WARP = sorcery('Warp Test', [{ op: 'extraTurn', who: { ref: 'target', id: 't0' }, count: 1 }], [playerSpec]);
    const s = castAndResolve(scenario([], { p1: { hand: ['Warp Test'] }, defs: [WARP] }), 'Warp Test', [targets(playerTarget('p2'))]);
    expect([2, 3, 4].map((n) => activeOf(s, n))).toEqual(['p2', 'p2', 'p1']);
    expect(advanceTo(s, 2, 'upkeep').turn.normalActive).toBe('p1'); // the turn the extra turn was added after
    expect('normalActive' in advanceTo(s, 3, 'upkeep').turn).toBe(false); // kept only while extra turns run: other games keep their state shape
  });

  it('several players: added one at a time in APNAP order, the most recently created taken first', () => {
    const ALL = sorcery('All Turns', [{ op: 'extraTurn', who: { ref: 'each', who: 'player' }, count: 1 }]);
    const s = castAndResolve(scenario([], { p1: { hand: ['All Turns'] }, defs: [ALL] }), 'All Turns');
    expect(s.turn.extraTurns).toEqual(['p2', 'p1']);
    expect([2, 3, 4].map((n) => activeOf(s, n))).toEqual(['p2', 'p1', 'p2']);
  });

  it('"two extra turns": both are added', () => {
    const TWO = sorcery('Two Turns', [{ op: 'extraTurn', who: { ref: 'you' }, count: 2 }]);
    const s = castAndResolve(scenario([], { p1: { hand: ['Two Turns'] }, defs: [TWO] }), 'Two Turns');
    expect([2, 3, 4].map((n) => activeOf(s, n))).toEqual(['p1', 'p1', 'p2']);
  });
});

/** The steps in which a player gets priority, from now until (turn, step) begins. */
function stepsUntil(s: GameState, turn: number, step: Step): Step[] {
  const out: Step[] = [];
  let guard = 0;
  while (!(s.turn.number === turn && s.turn.step === step)) {
    if (++guard > 200) throw new Error('stepsUntil: no progress');
    if (s.pending?.kind === 'priority' && s.pending.player === s.turn.activePlayer && out[out.length - 1] !== s.turn.step) out.push(s.turn.step);
    s = pass(s);
  }
  return out;
}

describe('CR 500.8: extra phases', () => {
  it('"After this main phase, there is an additional combat phase followed by an additional main phase."', () => {
    const ASSAULT = sorcery('Assault Test', [{ op: 'extraPhase', phase: 'combat' }, { op: 'extraPhase', phase: 'main', after: 'endCombat' }]);
    const s = castAndResolve(scenario([], { p1: { hand: ['Assault Test'] }, defs: [ASSAULT] }), 'Assault Test');
    expect(s.turn.extraPhases).toEqual([{ after: 'main', phase: 'combat' }, { after: 'combat', phase: 'main' }]);
    expect(stepsUntil(s, 1, 'end')).toEqual([
      'main1', 'beginCombat', 'declareAttackers', 'endCombat', 'main2', // the added combat phase and the added main phase (CR 505.1a: a postcombat main phase)
      'beginCombat', 'declareAttackers', 'endCombat', 'main2', // the turn's own combat and postcombat main phase
    ]);
    const t = advanceTo(s, 1, 'end');
    expect(t.turn.combats).toBe(2);
    expect(t.turn.extraPhases).toBeUndefined();
  });

  it('two combat phases added after the same main phase: both happen, one after the other', () => {
    const TWICE = sorcery('Twice Test', [{ op: 'extraPhase', phase: 'combat' }, { op: 'extraPhase', phase: 'combat' }]);
    const s = castAndResolve(scenario([], { p1: { hand: ['Twice Test'] }, defs: [TWICE] }), 'Twice Test');
    expect(stepsUntil(s, 1, 'main2').filter((x) => x === 'beginCombat')).toHaveLength(3);
  });
});

describe('CR 724.1: ending the turn', () => {
  const STOP = instant('Stop Test', [{ op: 'endTurn' }]);
  const DUMMY = instant('Dummy Spell', []);
  const LATER = instant('Later Test', [{ op: 'delay', when: { at: 'step', step: 'end', next: true }, do: [] }]);

  it('724.1b: every object on the stack is exiled, the resolving one included; 724.1d-e: the game skips to the cleanup step, so the end step never happens', () => {
    let s = castAndResolve(scenario([], { p1: { hand: ['Stop Test', 'Dummy Spell', 'Later Test'] }, defs: [STOP, DUMMY, LATER] }), 'Later Test');
    s = cast(cast(s, 'Dummy Spell'), 'Stop Test');
    s = passBoth(s);
    expect(s.zones.stack).toEqual([]);
    expect(s.zones.exile.map((id) => s.objects[id]!.defId).sort()).toEqual(['Dummy Spell', 'Stop Test']);
    expect(neighbors.proposals.map((p) => p.ev === 'zoneChange' && p.to)).toEqual(['exile', 'exile']);
    expect(s.turn.number).toBe(2); // nothing waited in the cleanup step, so nobody got priority there (CR 724.1f)
    expect(s.delayedTriggers).toHaveLength(1); // "at the beginning of the next end step" did not trigger: the end step was skipped (CR 724.1e)
    expect(s.log.some((l) => /skips to the cleanup step/.test(l.text) && l.rules?.includes('CR 724.1d'))).toBe(true);
    const t = passBoth(advanceTo(s, 2, 'end')); // it triggers at the next end step instead
    expect(t.delayedTriggers).toEqual([]);
  });

  it('724.1d: during combat, the combat phase ends with it', () => {
    let s = advanceTo(scenario([], { p1: { hand: ['Stop Test'] }, defs: [STOP] }), 1, 'beginCombat');
    s = passBoth(cast(s, 'Stop Test'));
    expect(s.combat).toBeNull();
    expect(s.turn.number).toBe(2);
  });
});

describe('CR 104: winning and losing', () => {
  it('104.2b: "You win the game."', () => {
    const WIN = instant('Win Test', [{ op: 'winGame', who: { ref: 'you' } }]);
    const s = castAndResolve(scenario([], { p1: { hand: ['Win Test'] }, defs: [WIN] }), 'Win Test');
    expect(s.result).toMatchObject({ winner: 'p1' });
  });

  it('104.3e: "Target player loses the game."', () => {
    const LOSE = instant('Lose Test', [{ op: 'loseGame', who: { ref: 'target', id: 't0' } }], [playerSpec]);
    const s = castAndResolve(scenario([], { p1: { hand: ['Lose Test'] }, defs: [LOSE] }), 'Lose Test', [targets(playerTarget('p2'))]);
    expect(s.players.find((p) => p.id === 'p2')!.hasLost).toBe(true);
    expect(s.result).toMatchObject({ winner: 'p1' });
  });

  it('104.4a: every player loses at once: the game is a draw', () => {
    const ALL = instant('Everyone Loses', [{ op: 'loseGame', who: { ref: 'each', who: 'player' } }]);
    const s = castAndResolve(scenario([], { p1: { hand: ['Everyone Loses'] }, defs: [ALL] }), 'Everyone Loses');
    expect(s.result).toMatchObject({ winner: null });
  });
});

describe('CR 114: emblems', () => {
  const ANTHEM: AbilityDef = {
    kind: 'static', text: 'Creatures you control get +1/+1.',
    effects: [{ s: 'continuous', affects: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mods: [{ layer: '7c', power: 1, toughness: 1 }] }],
  };
  const UPKEEP: AbilityDef = { kind: 'triggered', text: 'At the beginning of your upkeep, draw a card.', trigger: { on: [{ ev: 'step', step: 'upkeep', whose: 'you' }] }, effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] } };
  const EMBLEM = sorcery('Emblem Test', [{ op: 'createEmblem', who: { ref: 'you' }, abilities: [ANTHEM, UPKEEP] }]);
  const board = (): GameState => scenario(['Grizzly Bears'], { p1: { hand: ['Emblem Test'], battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [EMBLEM] });

  it('114.2-114.5: the player gets an emblem in the command zone; it has no types, no color and no mana cost; its abilities work from there', () => {
    const s = castAndResolve(board(), 'Emblem Test');
    expect(s.zones.command).toHaveLength(1);
    const e = s.objects[s.zones.command[0]!]!;
    expect([e.kind, e.owner, e.controller, e.zone]).toEqual(['emblem', 'p1', 'p1', 'command']);
    const c = getChars(s, e.id);
    expect([c.types, c.colors, c.manaCost ?? null]).toEqual([[], [], null]);
    expect(pt(s, find(s, 'Grizzly Bears', 'battlefield', 'p1'))).toEqual([3, 3]);
    expect(pt(s, find(s, 'Grizzly Bears', 'battlefield', 'p2'))).toEqual([2, 2]);
  });

  it('114.4: its triggered ability triggers from the command zone', () => {
    const s = advanceTo(castAndResolve(board(), 'Emblem Test'), 3, 'upkeep');
    expect(s.zones.stack).toHaveLength(1);
    const hand = s.zones.hand['p1']!.length;
    expect(passBoth(s).zones.hand['p1']!.length).toBe(hand + 1);
  });
});

describe('CR 706: rolling a die', () => {
  const ROLL = instant('Roll Test', [{ op: 'rollDie', who: { ref: 'you' }, sides: 6 }, pump({ q: 'dieResult' })], [creatureTarget()]);
  const TABLE = instant('Table Test', [{ op: 'rollDie', who: { ref: 'you' }, sides: 6, table: [{ min: 1, max: 3, do: [pump(1)] }, { min: 4, max: 6, do: [pump(10)] }] }], [creatureTarget()]);
  const LISTENER = permanent('Dice Fan', 'Creature — Test', [{
    kind: 'triggered', text: 'Whenever you roll a die, draw a card.', trigger: { on: [{ ev: 'dieRoll', player: 'you' }] }, effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] },
  }], ['1', '1']);
  const board = (seed?: string): GameState =>
    scenario(['Grizzly Bears'], { p1: { hand: ['Roll Test', 'Table Test'], battlefield: ['Grizzly Bears', 'Dice Fan'] }, defs: [ROLL, TABLE, LISTENER], ...(seed ? { seed } : {}) });
  const rolled = (s: GameState): number => Number(/rolls a d6: (\d)/.exec(lastLog(s, /rolls a d6/))![1]);

  it('706.1-706.2: the result is from 1 to N, from the game\'s generator, and "the result" reads it (q:dieResult)', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = castAndResolve(s0, 'Roll Test', [targets(objectTarget(bears))]);
    const r = rolled(s);
    expect(r).toBeGreaterThanOrEqual(1);
    expect(r).toBeLessThanOrEqual(6);
    expect(pt(s, bears)).toEqual([2 + r, 2]);
    expect(castAndResolve(s0, 'Roll Test', [targets(objectTarget(bears))]).log.map((l) => l.text)).toEqual(s.log.map((l) => l.text)); // deterministic (design 8.8 rule 2)
  });

  it('706.3a: the results table runs the row the result falls in', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const s0 = board(seed);
      const bears = find(s0, 'Grizzly Bears', 'battlefield');
      const s = castAndResolve(s0, 'Table Test', [targets(objectTarget(bears))]);
      expect(pt(s, bears)[0]).toBe(rolled(s) <= 3 ? 3 : 12);
    }
  });

  it('ev:dieRoll: the roll is an event "whenever you roll a die" triggers on (the rollDie handler emits dieRolled)', () => {
    const s0 = board();
    const s = castAndResolve(s0, 'Roll Test', [targets(objectTarget(find(s0, 'Grizzly Bears', 'battlefield')))]);
    expect(s.zones.stack).toHaveLength(1);
    expect(s.objects[s.zones.stack[0]!]!.stack!.sourceName).toBe('Dice Fan');
  });

  it('a results table for several dice is resolved by hand, never guessed', () => {
    const TWO = instant('Two Dice', [{ op: 'rollDie', who: { ref: 'you' }, sides: 6, count: 2, table: [{ min: 2, max: 12, do: [] }] }]);
    castAndResolve(scenario([], { p1: { hand: ['Two Dice'] }, defs: [TWO] }), 'Two Dice');
    expect(neighbors.manual).toHaveLength(1);
  });
});

describe('CR 705: flipping a coin', () => {
  const FLIP = instant('Flip Test', [{ op: 'flipCoin', who: { ref: 'you' }, onWin: [pump(5)], onLose: [pump(-1, -1)] }], [creatureTarget()]);

  it('705.2: the player calls heads or tails; winning or losing runs the matching instructions', () => {
    for (const call of ['heads', 'tails']) {
      const s0 = scenario(['Hill Giant'], { p1: { hand: ['Flip Test'], battlefield: ['Hill Giant'] }, defs: [FLIP] });
      const giant = find(s0, 'Hill Giant', 'battlefield');
      let s = passBoth(cast(s0, 'Flip Test', [targets(objectTarget(giant))]));
      expect(s.pending).toMatchObject({ kind: 'chooseOption', player: 'p1', rules: ['CR 705.2'] });
      s = answer(s, { kind: 'chooseOption', ids: [call] });
      const won = /wins the flip/.test(lastLog(s, /flips/));
      expect(pt(s, giant)).toEqual(won ? [8, 3] : [2, 2]);
    }
  });

  it('a flip whose result nothing reads asks for no call', () => {
    const PLAIN = instant('Plain Flip', [{ op: 'flipCoin', who: { ref: 'you' } }]);
    const s = castAndResolve(scenario([], { p1: { hand: ['Plain Flip'] }, defs: [PLAIN] }), 'Plain Flip');
    expect(s.pending?.kind).toBe('priority');
    expect(s.log.some((l) => /flips a coin: (heads|tails)/.test(l.text))).toBe(true);
  });
});

describe('CR 725: the monarch', () => {
  const CROWN = sorcery('Crown Test', [{ op: 'designate', who: { ref: 'you' }, what: 'monarch' }]);
  const board = (): GameState => scenario(['Grizzly Bears'], { p1: { hand: ['Crown Test'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [CROWN] });

  it('725.1: the player becomes the monarch; 725.2: at the beginning of the monarch\'s end step, that player draws a card', () => {
    let s = castAndResolve(board(), 'Crown Test');
    expect(s.designations.monarch).toBe('p1');
    s = advanceTo(s, 1, 'end');
    expect(s.zones.stack).toHaveLength(1);
    const hand = s.zones.hand['p1']!.length;
    s = passBoth(s);
    expect(s.zones.hand['p1']!.length).toBe(hand + 1);
    expect(advanceTo(s, 2, 'end').zones.stack).toEqual([]); // not in the opponent's end step
  });

  it('725.2: a creature that deals combat damage to the monarch makes its controller the monarch', () => {
    let s = advanceTo(castAndResolve(board(), 'Crown Test'), 2, 'main1');
    s = attackUnblocked(s, [find(s, 'Grizzly Bears', 'battlefield')]);
    expect(s.designations.monarch).toBe('p2');
    expect(s.log.some((l) => /Bob becomes the monarch/.test(l.text) && l.rules?.includes('CR 725.3'))).toBe(true);
  });
});

describe('CR 731: day and night; CR 726: the initiative', () => {
  it('731.1: "it becomes day"; 731.2a: a turn in which its active player casts no spell makes it night at the next untap step', () => {
    const DAWN = sorcery('Dawn Test', [{ op: 'designate', who: { ref: 'you' }, what: 'day' }]);
    let s = castAndResolve(scenario([], { p1: { hand: ['Dawn Test'] }, defs: [DAWN] }), 'Dawn Test');
    expect(s.designations.dayNight).toBe('day');
    s = advanceTo(s, 2, 'upkeep');
    expect(s.designations.dayNight).toBe('day'); // the active player of turn 1 cast a spell
    s = advanceTo(s, 3, 'upkeep');
    expect(s.designations.dayNight).toBe('night'); // the active player of turn 2 cast none
    s = advanceTo(s, 4, 'upkeep');
    expect(s.designations.dayNight).toBe('night'); // CR 731.2b needs two spells
  });

  it('726.3 (MX4): the player takes the initiative, and its inherent ability "that player ventures into Undercity" triggers (CR 726.2)', () => {
    const INIT = sorcery('Initiative Test', [{ op: 'designate', who: { ref: 'you' }, what: 'initiative', span: 'You take the initiative.' }]);
    const s = castAndResolve(scenario([], { p1: { hand: ['Initiative Test'] }, defs: [INIT] }), 'Initiative Test');
    expect(s.designations.initiative).toBe('p1');
    expect(neighbors.manual).toEqual([]);
    expect(s.pendingTriggers.length + s.zones.stack.length).toBe(1);
  });
});

describe('CR 701: keyword actions through the keyword library\'s macros (design 7.5)', () => {
  it('"Investigate." runs the macro\'s expansion (CR 701.16a: create a Clue token)', () => {
    const CLUE = instant('Clue Test', [{ op: 'action', action: 'investigate', who: { ref: 'you' } }]);
    castAndResolve(scenario([], { p1: { hand: ['Clue Test'] }, defs: [CLUE] }), 'Clue Test');
    expect(neighbors.ran).toContainEqual([{ op: 'createToken', who: { ref: 'you' }, token: { predefined: 'Clue' }, count: 1 }]);
  });

  // PUSH1 T1: proliferate has a native handler now (effects/handlers/actions-native-counters.ts); M12-3: goad too (effects/handlers/goad.ts); FAST5X E28: exert
  // has a macro (keywords/actions/exert-forage.ts, next test); clash has none
  it('an action without a macro is resolved by hand with the library\'s reason (clash, CR 701.30)', () => {
    const CLASH = instant('Clash Test', [{ op: 'action', action: 'clash', who: { ref: 'you' }, span: 'Clash with an opponent.' }]);
    castAndResolve(scenario([], { p1: { hand: ['Clash Test'] }, defs: [CLASH] }), 'Clash Test');
    expect(neighbors.manual).toEqual([{ text: 'Clash with an opponent.', reason: expect.stringContaining('CR 701.30') }]);
  });

  it('"Exert." runs exert\'s macro (FAST5X E28, CR 701.43a); with no permanent to exert, the macro has it resolved by hand', () => {
    const EXERT = instant('Exert Test', [{ op: 'action', action: 'exert', who: { ref: 'you' }, span: 'Exert.' }]);
    const s = castAndResolve(scenario([], { p1: { hand: ['Exert Test'] }, defs: [EXERT] }), 'Exert Test');
    expect(s.log.some((l) => l.rules?.includes('CR 701.43a'))).toBe(true); // the macro's rule, on the action's log line
    expect(neighbors.manual).toEqual([{ text: 'Exert.', reason: 'exert needs the permanent it exerts' }]);
  });
});

describe('review: ending the turn checks state-based actions (CR 724.1c)', () => {
  it('CR 724.1c: a creature given -2/-2 earlier in the resolution that ends the turn dies before the cleanup step', () => {
    const SHRINK_STOP = instant('Shrink Stop', [pump(-2, -2), { op: 'endTurn' }], [creatureTarget()]);
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Shrink Stop'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [SHRINK_STOP] });
    const s = castAndResolve(s0, 'Shrink Stop', [targets(objectTarget(find(s0, 'Grizzly Bears', 'battlefield')))]);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Grizzly Bears')).toBe(false); // the cleanup step would have ended the -2/-2 first (CR 514.2)
    expect(s.zones.graveyard['p2']!.some((id) => s.objects[id]!.defId === 'Grizzly Bears')).toBe(true);
    expect(s.log.some((l) => l.rules?.includes('CR 724.1c'))).toBe(true);
  });
});

describe('review: "the result" of a die roll (CR 706.2)', () => {
  const PUZZLE = permanent('Puzzle Fan', 'Artifact', [{
    kind: 'triggered', text: 'Whenever you roll a die, draw cards equal to the result.', trigger: { on: [{ ev: 'dieRoll', player: 'you' }] },
    effect: { targets: [], steps: [{ op: 'draw', who: { ref: 'you' }, count: { q: 'dieResult' } }] },
  }]);
  const ROLL = instant('Plain Roll', [{ op: 'rollDie', who: { ref: 'you' }, sides: 6 }]);

  it('CR 706.2: in an ability triggered by the roll (Vexing Puzzlebox), "the result" is the triggering roll\'s', () => {
    let s = castAndResolve(scenario([], { p1: { hand: ['Plain Roll'], battlefield: ['Puzzle Fan'] }, defs: [PUZZLE, ROLL] }), 'Plain Roll');
    const r = Number(/rolls a d6: (\d)/.exec(lastLog(s, /rolls a d6/))![1]);
    expect(s.zones.stack).toHaveLength(1);
    const before = s.zones.hand['p1']!.length;
    s = passBoth(s);
    expect(s.zones.hand['p1']!.length).toBe(before + r);
  });

  it('CR 706.2: when several players roll, there is no single "result": an instruction that reads it does nothing (never the meaningless total)', () => {
    const EACH = instant('Each Rolls', [{ op: 'rollDie', who: { ref: 'each', who: 'player' }, sides: 6 }, pump({ q: 'dieResult' })], [creatureTarget()]);
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Each Rolls'], battlefield: ['Grizzly Bears'] }, defs: [EACH] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = castAndResolve(s0, 'Each Rolls', [targets(objectTarget(bears))]);
    expect(s.log.filter((l) => /rolls a d6/.test(l.text))).toHaveLength(2);
    expect(pt(s, bears)).toEqual([2, 2]);
    expect(s.log.some((l) => /can't be determined/.test(l.text))).toBe(true); // CR 608.2b
  });
});

describe('review: design 8.6 stage 4 and 8.5: the handlers act through the performers and the one writer of each state change', () => {
  const source = (rel: string): string => readFileSync(join(SRC_ROOT, rel), 'utf8');

  it('design 8.6: the handlers of this family emit nothing directly (rolling and flipping emit from core/dice.ts)', () => {
    for (const f of ['effects/handlers/game.ts', 'effects/handlers/lasting.ts', 'effects/handlers/lasting-fix.ts']) expect(source(f), f).not.toMatch(/\.emit\(/);
  });

  it('design 8.5: the emblem object is created by core/zones.ts, the one module that creates objects; core/emblems.ts writes no object or zone', () => {
    expect(source('core/emblems.ts')).not.toMatch(/s\.objects\[[^\]]+\]\s*=|zones\.command\.push/);
  });
});

describe('review: CR 114 emblem definitions are classified, not asserted (design 10)', () => {
  const MANUAL_TRIGGER: AbilityDef = {
    kind: 'triggered', text: 'At the beginning of your upkeep, do something odd.', trigger: { on: [{ ev: 'step', step: 'upkeep', whose: 'you' }] },
    effect: { targets: [], steps: [{ op: 'manual', text: 'do something odd', reason: 'not understood' }] },
  };

  it('an emblem whose ability has a manual step is partial, not full', () => {
    const EMBLEM = sorcery('Odd Emblem', [{ op: 'createEmblem', who: { ref: 'you' }, abilities: [MANUAL_TRIGGER] }]);
    const s = castAndResolve(scenario([], { p1: { hand: ['Odd Emblem'] }, defs: [EMBLEM] }), 'Odd Emblem');
    const def = s.defs[s.objects[s.zones.command[0]!]!.defId]!;
    expect(def.automation?.level).toBe('partial');
    expect(def.automation?.unsupported).toEqual(['do something odd']);
  });
});
