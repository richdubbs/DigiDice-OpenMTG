/**
 * WP4: the capability tables (design 5.2). A discriminator of the model is a capability exactly when its table has an entry, and the tables cover the
 * model: adding a condition, quantity or reference to types/ability.ts without an evaluator is a compile error here, then a test failure.
 */
import { describe, expect, it } from 'vitest';
import { CARDS_HANDLERS } from '../../../src/effects/handlers/cards';
import { ENGINE_CAPABILITIES } from '../../../src/index';
import { COND_EVALUATORS, DUR_EVALUATORS, QTY_EVALUATORS } from '../../../src/effects/eval';
import { REF_RESOLVERS, resolvePlayers, resolveObjs, readInfo } from '../../../src/effects/refs';
import { OP_HANDLERS } from '../../../src/effects/handlers';
import { recheckAll } from '../../../src/effects/ctx';
import { evalCond, evalQty } from '../../../src/effects/eval';
import type { Condition, ObjRef, PlayerRef, Quantity, TargetSpec } from '../../../src/index';
import { SUPPORTED_FILTER_FIELDS } from '../../../src/rules/filter';
import { synth, spellAbility } from '../helpers';
import { chosenObject, ctxOn, find, putOnStack, scenario } from './helpers';

const CONDITIONS: Record<Condition['cond'], boolean> = {
  all: true, any: true, not: true, compare: true, exists: true, matches: true, turnOf: true, wasCast: true, happened: true, did: true, designation: true, chosen: true, ask: true,
  completedDungeon: true, // MX4 (CR 309.7)
  classLevel: true, eventFlag: true, // M6-0 (m6 design 5, M6-0): evaluated and advertised at once; each fails closed outside its context
  beheld: true, // FAST5X E11 (CR 701.4b)
  asCast: true, // FAST5X E17 (CR 601.2i)
  firstNamedResolution: true, // FAST5X E26 (CR 702.192a)
  controlledSinceUpkeep: true, // CMD3 (CR 702.30a, echo)
  firstCombat: true, // Standard round 4, r4-trig (CR 500.8, 505.1a)
  firstTime: true, someMatch: true, // Standard round 5, r5-trig (CR 603.4, 603.2c)
  prime: true, // std-rx1
  share: true, // std-cardcopy-1 (CR 205.2a, 105.2)
  firstSpellCast: true, // trek-2 (CR 601.2i, 707.10)
};
const QUANTITIES: Record<Exclude<Quantity, number>['q'], boolean> = {
  X: true, var: true, count: true, countPlayers: true, stat: true, life: true, zoneSize: true, counters: true, devotion: true, distinct: true, happenedCount: true, spellsBefore: true, eventAmount: true,
  resultCount: true, targetCount: true, spellTargetCount: true, dieResult: true, speed: true, age: true, level: true, turnNumber: true, cardsDrawnThisTurn: true, spellsCastThisTurn: true,
  lifeGainedThisTurn: true, math: true, live: true, ask: true,
  kickCount: true, preventedAmount: true, faceUpX: true, // M6-0 (m6 design 5, M6-0)
  commanderCasts: true, // M11-0 (m11 design 4.5): exact in every game (0 outside Commander, CR 903.8)
  lifeLostThisTurn: true, colorsSpent: true, // FAST4 T34
  spellManaSpent: true, // FAST5X E9 (increment, CR 702.191a)
  partySize: true, // FAST5 T38 (CR 700.8)
  basePower: true, // std-rx29 (CR 208.1, 613.4)
  mostSharingCreatureType: true, // r5-cost (CR 205.3m)
  spellColorsSpent: true, // FAST5 T51 (CR 601.2h)
  manaSpent: true, // FAST5 T42
  excessDamage: true, // FAST5X E16 (CR 120.4a, 608.2c)
  countersRemoved: true, // std-rx14 (CR 122.1, 608.2c)
  damageDealt: true, // std-rx20 (CR 120.3, 608.2c)
  unspentMana: true, // FAST5X E19 (CR 106.4)
  startingLife: true, // FAST5 T60 (CR 103.4)
  turnsBegun: true, // Standard round 9, std-r9 (CR 500.7): PlayerState.turnsBegun
  modesChosen: true, // Standard round 3, r3-trig (CR 700.2, 601.2b)
  loyaltyRemoved: true, // Standard round 3, r3-trig (CR 606.4)
  resolvedThisTurn: true, // FAST5X E17 (CR 608.2, 400.7)
  descendedThisTurn: true, // FAST5X E22 (CR 700.11)
  lifeLost: true, // M12-3 (CR 119.3, 608.2c)
  votes: true, // M12-3 (CR 701.38a-b)
  opponentsAttacked: true, // M12-3 (CR 702.121a)
  unlockedDoors: true, // cloud std-dsk (CR 709.5c, 709.5j)
  happenedDistinct: true, // CLOUD std-tmt (CR 205.2a, 608.2h)
  chosenNumber: true, // CLOUD std-misc (CR 608.2d, 607.2d)
  manaSymbols: true, // Standard round 5, r5-trig (CR 107.4, 202.1)
  spellTargetTotal: true, costCount: true, // std-costs-1 (CR 601.2f, 601.2b)
  countersPut: true, // trek-6 (CR 122.6, 608.2c)
};
const REFS: Record<ObjRef['ref'] | PlayerRef['ref'], true> = {
  otherOf: true, // std-rx30
  self: true, target: true, bound: true, event: true, attachedTo: true, linked: true, each: true, subject: true, topCards: true, union: true, fixed: true,
  you: true, controllerOf: true, ownerOf: true, anOpponent: true, active: true, defending: true, iterating: true,
  costSacrificed: true, // FAST3 T18
  costTapped: true, // T35
  costBeheld: true, costReturned: true, // std-rx28 (CR 701.4a, 702.188a)
  costExiled: true, // FAST5X E13
  costDiscarded: true, // CLOUD C8
  otherOpponents: true, // M6-12: myriad (CR 702.116a)
  voters: true, // M12F (CR 701.38a)
  costChosen: true, // FAST5X E1: gift's chosen opponent (CR 702.174a)
  seat: true, // M12-1: "the player to your left / right" (m12 design D6; CR 101.4, 103.1)
  controlsMost: true, // C6: "each player who controls the most creatures" (CR 109.4, 101.4)
  grantor: true, // r4-static: the granting object of a granted ability (statics/mods.ts#withGrantor)
  enchantedPlayer: true, // std-rr: "enchanted player", the player the source Aura is attached to (CR 303.4, 702.5a)
  eachWho: true, // std-combat-1: "each opponent who attacked you ... this turn" (CR 608.2c, 508.1)
  costChosenObject: true, // std-costs-2: what a chooseObject additional cost chose (CR 601.2b)
  costRevealed: true, // p2-refs-1 (CR 601.2b, 701.20a)
};

describe('the capability tables cover the model', () => {
  it('every condition is advertised; the table has nothing else', () => {
    expect(Object.keys(COND_EVALUATORS).sort()).toEqual(Object.entries(CONDITIONS).filter(([, on]) => on).map(([k]) => k).sort());
  });
  it('every quantity is advertised (dieResult since WP15: the rollDie handler keeps the result); the table has nothing else', () => {
    expect(Object.keys(QTY_EVALUATORS).sort()).toEqual(Object.entries(QUANTITIES).filter(([, on]) => on).map(([k]) => k).sort());
  });
  it('every reference name has a resolver', () => {
    expect(Object.keys(REF_RESOLVERS).sort()).toEqual(Object.keys(REFS).sort());
  });
  it('durations are WP15\'s: every form of Duration but asLongAs is advertised, as core/durations.ts ends it (test/m5/lasting/ pins each one)', () => {
    // not asLongAs: design 3.7 wants it judged live, the build judges it at priority checks (effects/eval.ts, WP15 review)
    expect(Object.keys(DUR_EVALUATORS).sort()).toEqual(['duringNextTurn' /* std-control-1: "during that turn" of the next turn, CR 611.2a */, 'endOfCombat', 'endOfNextTurn' /* FAST5X E29 */, 'endOfTurn', 'permanent', 'remainsExiled' /* FAST5X E29 */, 'throughNextUntap' /* MX5 */, 'until', 'untilExiledWith' /* r5-dig */, 'untilNextStep', 'untilNextTurn', 'whileObject' /* std-rx32 */, 'whileSource']);
  });
});

describe('ENGINE_CAPABILITIES is built from those tables (design 5.2)', () => {
  it('cond:*, q:*, ref:*, filter:* and the durations of WP15 appear; ops only with their handlers', () => {
    for (const [c, on] of Object.entries(CONDITIONS)) expect(ENGINE_CAPABILITIES.has(`cond:${c}`), c).toBe(on);
    for (const [q, on] of Object.entries(QUANTITIES)) expect(ENGINE_CAPABILITIES.has(`q:${q}`), q).toBe(on);
    for (const r of Object.keys(REFS)) expect(ENGINE_CAPABILITIES.has(`ref:${r}`), r).toBe(true);
    for (const f of SUPPORTED_FILTER_FIELDS) expect(ENGINE_CAPABILITIES.has(`filter:${f}`), f).toBe(true);
    expect([...ENGINE_CAPABILITIES].filter((c) => c.startsWith('dur:')).sort()).toEqual(Object.keys(DUR_EVALUATORS).map((d) => `dur:${d}`).sort());
    expect([...ENGINE_CAPABILITIES].filter((c) => c.startsWith('op:') && !Object.hasOwn(OP_HANDLERS, c.slice(3).split('.')[0]!))).toEqual([]); // ops (and M6-2's and M6-3's op value forms) come only with their handlers (WP10-WP15)
    expect(ENGINE_CAPABILITIES.has('feature:history')).toBe(true); // registered by the package that WRITES the history (WP8)
  });
});

describe('evaluation reads the state and never changes it (engine code is pure, docs/ARCHITECTURE.md)', () => {
  it('references, quantities, conditions, last known information and the legality check leave the state untouched', () => {
    const creature: TargetSpec = { id: 't0', kind: 'object', filter: { types: ['Creature'] }, min: 1, max: 1, text: 'target creature' };
    const poke = synth({ name: 'Test Poke', cost: '{R}', type: 'Instant', abilities: [spellAbility('x', [creature])] });
    const s = scenario(['Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] }, defs: [poke] });
    const spell = putOnStack(s, { name: 'Test Poke', targets: [[chosenObject(find(s, 'Hill Giant', 'battlefield', 'p2'))]] });
    const before = JSON.stringify(s);
    const cx = ctxOn(s, spell, { targets: [creature], steps: [] });
    resolveObjs(cx, { ref: 'each', filter: { types: ['Creature'] } });
    resolvePlayers(cx, { ref: 'each', who: 'player' });
    readInfo(cx, cx.source);
    recheckAll(cx);
    evalQty(cx, { q: 'math', op: '+', args: [{ q: 'count', of: { ref: 'each', filter: {} } }, { q: 'stat', stat: 'power', of: { ref: 'target', id: 't0' } }] });
    evalCond(cx, { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'opponent' } } });
    expect(JSON.stringify(s)).toBe(before);
  });
});
