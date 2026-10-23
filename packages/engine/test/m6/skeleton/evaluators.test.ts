/**
 * M6-0 (m6 design 2.1, 5 "M6-0"): the evaluators of the new quantity and condition kinds, registered at once because each can occur only inside a node that
 * a still-missing capability gates, and each fails closed outside its context; the `lastTurn` scope and `per: 'player'` of the history readers; the four
 * status fields of `ObjectFilter`; the renderers of the new nodes.
 */
import { describe, expect, it } from 'vitest';
import { ENGINE_CAPABILITIES, renderAbility, renderGate, type AbilityDef, type Condition, type EffectStep, type EventPattern, type GameState, type HistoryEntry, type Quantity } from '../../../src/index';
import { EVENT_FLAG_VARS, evalCond, evalQty, PREVENTED_AMOUNT_VAR } from '../../../src/effects/eval';
import { matchesFilter, NO_ENV } from '../../../src/rules/filter';
import { evalCondition, evalQuantity, filterMatches } from '../../../src/statics/match';
import { allChars } from '../../../src/rules/characteristics';
import { castWith, resolveTop, topPaid } from '../costs/support';
import { answer, ctxOn, drive, find, scenario, tweak } from '../helpers';

const kickCount: Quantity = { q: 'kickCount' };

/** Three history entries of `cast` by p1 and one by p2 in `turn`, plus one in another turn. */
const castHistory = (turn: number): HistoryEntry[] => [
  ...[1, 2, 3].map((i): HistoryEntry => ({ turn, combat: 0, ev: 'cast', actor: 'p1', subject: `o${900 + i}`, facts: { id: `o${900 + i}`, from: 'hand', copy: false } })),
  { turn, combat: 0, ev: 'cast', actor: 'p2', subject: 'o910', facts: { id: 'o910', from: 'hand', copy: false } },
  { turn: turn + 1, combat: 0, ev: 'cast', actor: 'p2', subject: 'o911', facts: { id: 'o911', from: 'hand', copy: false } },
];

describe('M6-0: q:kickCount (CR 702.33d-e)', () => {
  it('CR 702.33d: kickCount counts each multikicker payment, on the stack and on the permanent the spell became (CR 400.7d)', () => {
    let s = scenario(['Everflowing Chalice', 'Mountain'], { p1: { hand: ['Everflowing Chalice'], battlefield: Array(8).fill('Mountain') as string[] } });
    s = castWith(s, 'Everflowing Chalice');
    s = drive(answer(s, { kind: 'chooseNumber', n: 3 }));
    expect(topPaid(s).kicked).toBe(3);
    const spell = s.zones.stack[s.zones.stack.length - 1]!;
    expect(evalQty(ctxOn(s, spell), kickCount)).toBe(3);
    s = resolveTop(s); // M6-5: "enters with a charge counter on it for each time it was kicked" reads this quantity (rep.m6.enters.counter.kicked)
    const chalice = find(s, 'Everflowing Chalice', 'battlefield');
    expect(s.objects[chalice]!.counters?.['charge']).toBe(3);
    expect(evalQty(ctxOn(s, chalice), kickCount)).toBe(3);
    expect(evalQuantity({ s, all: allChars(s), source: chalice, controller: 'p1' }, kickCount)).toBe(3); // the layer system's evaluator agrees
  });

  it('CR 702.33d: a permanent that was never cast was kicked 0 times', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    expect(evalQty(ctxOn(s, bears), kickCount)).toBe(0);
    expect(ENGINE_CAPABILITIES.has('q:kickCount') && ENGINE_CAPABILITIES.has('sq:kickCount')).toBe(true);
  });
});

describe('M6-0: q:preventedAmount (CR 615.5) and q:faceUpX (CR 702.37f) fail closed outside their context', () => {
  it('preventedAmount: undetermined outside a prevention effect\'s steps; the amount M6-1 puts in its variable inside them', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const cx = ctxOn(s, find(s, 'Grizzly Bears', 'battlefield'));
    expect(evalQty(cx, { q: 'preventedAmount' })).toBeUndefined();
    cx.vars.set(PREVENTED_AMOUNT_VAR, 4);
    expect(evalQty(cx, { q: 'preventedAmount' })).toBe(4);
  });

  it('faceUpX: undetermined for a permanent that was not turned face up by the special action; its X once it was (GameObject.faceUpX)', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    expect(evalQty(ctxOn(s0, bears), { q: 'faceUpX' })).toBeUndefined();
    const s = tweak(s0, (t) => { t.objects[bears]!.faceUpX = 2; });
    expect(evalQty(ctxOn(s, bears), { q: 'faceUpX' })).toBe(2);
    expect(ENGINE_CAPABILITIES.has('sq:faceUpX')).toBe(false); // read by the interpreter only: a static ability that reads it stays manual
  });
});

describe('M6-0: cond:classLevel (CR 716.2a-d) and cond:eventFlag (CR 702.37b)', () => {
  const classLevel = (atLeast: number): Condition => ({ cond: 'classLevel', object: { ref: 'self' }, atLeast });

  it('CR 716.2d: a Class without a level designation is level 1; the designation, never level counters, decides (CR 716.4)', () => {
    const s0 = scenario(['Bard Class', 'Grizzly Bears'], { p1: { battlefield: ['Bard Class', 'Grizzly Bears'] } });
    const bard = find(s0, 'Bard Class', 'battlefield');
    expect(evalCond(ctxOn(s0, bard), classLevel(1))).toBe(true);
    expect(evalCond(ctxOn(s0, bard), classLevel(2))).toBe(false);
    const counters = tweak(s0, (t) => { t.objects[bard]!.counters['level'] = 5; });
    expect(evalCond(ctxOn(counters, bard), classLevel(2))).toBe(false);
    const s = tweak(s0, (t) => { t.objects[bard]!.classLevel = 3; });
    expect(evalCond(ctxOn(s, bard), classLevel(2))).toBe(true);
    expect(evalCond(ctxOn(s, bard), classLevel(4))).toBe(false);
    expect(evalCondition({ s, all: allChars(s), source: bard, controller: 'p1' }, classLevel(3))).toBe(true);
  });

  it('an object that is not a Class has no level designation: false', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    expect(evalCond(ctxOn(s, find(s, 'Grizzly Bears', 'battlefield')), classLevel(1))).toBe(false);
  });

  it('eventFlag: false outside a `during` body; what the body sets inside it', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const cx = ctxOn(s, find(s, 'Grizzly Bears', 'battlefield'));
    const flag: Condition = { cond: 'eventFlag', flag: 'megamorphPaid' };
    expect(evalCond(cx, flag)).toBe(false);
    cx.vars.set(EVENT_FLAG_VARS.megamorphPaid, 1);
    expect(evalCond(cx, flag)).toBe(true);
    expect(ENGINE_CAPABILITIES.has('cond:classLevel') && ENGINE_CAPABILITIES.has('cond:eventFlag') && ENGINE_CAPABILITIES.has('scond:classLevel')).toBe(true);
  });
});

describe('M6-0: the history scope lastTurn and happenedCount.per (the Innistrad werewolves)', () => {
  const withHistory = (s: GameState, entries: HistoryEntry[]): GameState => tweak(s, (t) => { t.history = [...t.history, ...entries]; });
  const spells = { ev: 'cast' as const };

  it('lastTurn counts the entries of the turn before this one only', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const now = s0.turn.number;
    const s = withHistory(s0, castHistory(now - 1));
    const cx = ctxOn(s, find(s, 'Grizzly Bears', 'battlefield'));
    expect(evalQty(cx, { q: 'happenedCount', event: spells, scope: 'lastTurn' })).toBe(4); // three by p1, one by p2; the entry of this turn is not counted
    expect(evalCond(cx, { cond: 'happened', event: spells, scope: 'lastTurn' })).toBe(true);
    const none = ctxOn(s0, find(s0, 'Grizzly Bears', 'battlefield'));
    expect(evalCond(none, { cond: 'happened', event: spells, scope: 'lastTurn' })).toBe(false); // "if no spells were cast last turn"
  });

  it('per: player is the greatest count of one player ("if a player cast two or more spells last turn"), not the total', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const s = withHistory(s0, castHistory(s0.turn.number - 1));
    const cx = ctxOn(s, find(s, 'Grizzly Bears', 'battlefield'));
    expect(evalQty(cx, { q: 'happenedCount', event: spells, scope: 'lastTurn', per: 'player' })).toBe(3);
    const one = withHistory(s0, castHistory(s0.turn.number - 1).filter((e) => e.actor === 'p2'));
    expect(evalQty(ctxOn(one, find(one, 'Grizzly Bears', 'battlefield')), { q: 'happenedCount', event: spells, scope: 'lastTurn', per: 'player' })).toBe(1);
  });
});

describe('M6-0: the status fields of ObjectFilter (CR 719.3b, 722.3a, 718.3b, 710)', () => {
  it('CR 719.3b: matches solved (and prepared, prototyped, flipped) on the object\'s designation, in the general evaluator and the layer system\'s', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const id = find(s0, 'Grizzly Bears', 'battlefield');
    const s = tweak(s0, (t) => Object.assign(t.objects[id]!, { solved: true, prepared: true, prototyped: true, flipped: true }));
    for (const f of ['solved', 'prepared', 'prototyped', 'flipped'] as const) {
      expect(matchesFilter(s0, s0.objects[id]!, { [f]: true }, { you: 'p1', env: NO_ENV }), `${f} (no)`).toBe(false);
      expect(matchesFilter(s0, s0.objects[id]!, { [f]: false }, { you: 'p1', env: NO_ENV }), `${f} (no, negated)`).toBe(true);
      expect(matchesFilter(s, s.objects[id]!, { [f]: true }, { you: 'p1', env: NO_ENV }), f).toBe(true);
      expect(filterMatches({ s, all: allChars(s), source: id, controller: 'p1' }, id, { [f]: true }), `${f} (statics)`).toBe(true);
    }
  });
});

describe('M6-0: renderers of the new nodes (render/*)', () => {
  const ctx = { selfNames: ['Test Card'], selfTypes: ['Creature'] };
  const upkeep: EventPattern = { ev: 'step', step: 'upkeep' };
  const transformSelf: EffectStep = { op: 'changeFace', what: { ref: 'self' }, to: 'transform' };
  const werewolf = (interveningIf: Condition): AbilityDef => ({ kind: 'triggered', text: '', trigger: { on: [upkeep] }, interveningIf, effect: { targets: [], steps: [transformSelf] } });

  it('the werewolf conditions (lastTurn, per player) pass the render gate with their Oracle wording', () => {
    const noSpells: Condition = { cond: 'not', of: { cond: 'happened', event: { ev: 'cast' }, scope: 'lastTurn' } };
    const twoByOne: Condition = { cond: 'compare', left: { q: 'happenedCount', event: { ev: 'cast' }, scope: 'lastTurn', per: 'player' }, op: '>=', right: 2 };
    expect(renderGate(werewolf(noSpells), ['At the beginning of each upkeep, if no spells were cast last turn, transform ~.'], ctx).ok).toBe(true);
    expect(renderGate(werewolf(twoByOne), ['At the beginning of each upkeep, if a player cast two or more spells last turn, transform ~.'], ctx).ok).toBe(true);
    expect(renderGate(werewolf(twoByOne), ['At the beginning of each upkeep, if two or more spells were cast last turn, transform ~.'], ctx).ok).toBe(false); // the total is another thing
  });

  it('the quantities and conditions have words (a node without a renderer would never be automated)', () => {
    const counters = (count: Quantity): AbilityDef => ({ kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'putCounters', on: { ref: 'self' }, kind: '+1/+1', count }] } });
    expect(renderAbility(counters(kickCount), ctx).join(' ')).toMatch(/the number of times .* was kicked/);
    expect(renderAbility(counters({ q: 'preventedAmount' }), ctx).join(' ')).toMatch(/the damage prevented this way/);
    const guarded = (c: Condition): AbilityDef => ({ kind: 'spell', text: '', effect: { targets: [], steps: [{ op: 'if', cond: c, then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }] } });
    expect(renderAbility(guarded({ cond: 'eventFlag', flag: 'megamorphPaid' }), ctx).join(' ')).toMatch(/its megamorph cost was paid/);
    expect(renderAbility(guarded({ cond: 'classLevel', object: { ref: 'self' }, atLeast: 2 }), ctx).join(' ')).toMatch(/is level 2 or greater/);
  });
});
