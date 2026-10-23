/**
 * M6-7 (design m6 3.9, section 5 M6-7): requirements that name the other creature of the action (CR 508.1d, 509.1c): Lure and Prized Unicorn ("All
 * creatures able to block ~ do so."), Hunt Down and Rampant Elephant ("blocks target creature / ~ this turn if able"), "must be blocked by a [filter] if
 * able", and the resolved "attacks / blocks / must be blocked this turn if able" (templates of parser/templates/zz-m6/requirements.json).
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, DeclareAttackersDecision, DeclareBlockersDecision, GameState, ObjectId, PlayerId } from '../../../src/index';
import { obeyRequirements, requirementsFor } from '../../../src/index';
import { act, answer, declareAttackers, find, findAll, passUntil, scenario, toDeclareAttackers, toDeclareBlockers, tweak } from '../../m4/helpers';
import { putAttached, withRuleEffect } from '../../m5/rulehooks/fixtures';
import { cards } from './cards';

const blocks = (s: GameState, pairs: [ObjectId, ObjectId][]) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareBlockers' as const, blocks: pairs.map(([blocker, attacker]) => ({ blocker, attacker })) } });
const attacks = (s: GameState, pairs: [ObjectId, PlayerId | ObjectId][]) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareAttackers' as const, attacks: pairs.map(([attacker, defender]) => ({ attacker, defender })) } });
const blockDecision = (s: GameState): DeclareBlockersDecision => s.pending as DeclareBlockersDecision;
const attackDecision = (s: GameState): DeclareAttackersDecision => s.pending as DeclareAttackersDecision;
const sorted = <T extends { blocker: string }>(xs: readonly T[]): T[] => [...xs].sort((a, b) => a.blocker.localeCompare(b.blocker));

const BASE = ['Grizzly Bears', 'Hill Giant', 'Elephant-Rat', 'Serra Angel', 'Giant Spider', 'Wall of Stone', 'Forest', 'Mountain'];
const DEFS = (): CardDef[] => cards('Lure', 'Prized Unicorn', 'Hunt Down', "Gaea's Protector", 'Rampant Elephant', 'Boiling Blood', 'Culling Mark', 'Irresistible Prey', 'Alluring Scent');

/** p1 attacks with every creature named in `attackers`, p2 is asked to declare blockers. */
function toBlocks(s: GameState, attackers: string[]): GameState {
  s = toDeclareAttackers(s);
  s = declareAttackers(s, [...new Set(attackers)].flatMap((n) => findAll(s, n, 'battlefield', 'p1')).map((id) => [id] as [ObjectId]));
  return toDeclareBlockers(s);
}

const board = (p1: string[], p2: string[]): GameState => scenario(BASE, { defs: DEFS(), p1: { battlefield: p1 }, p2: { battlefield: p2 } });

/** `caster` casts `name` from hand with these targets (in the order of the spell's targets) and both players pass so it resolves. */
function castResolve(s: GameState, caster: PlayerId, name: string, targets: ObjectId[]): GameState {
  if (s.pending!.player !== caster) s = act(s, { type: 'pass', player: s.pending!.player });
  s = act(s, { type: 'cast', player: caster, card: find(s, name, 'hand', caster) });
  for (const id of targets) if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id }] }); // one per target (CR 601.2c)
  s = answer(s, { kind: 'payCost', auto: true });
  return passUntil(s, (x) => x.zones.stack.length === 0 && x.pending?.kind === 'priority', `${name} resolving`);
}

describe('CR 509.1c: Lure and Prized Unicorn ("All creatures able to block ~ do so.")', () => {
  it('CR 509.1c: Lure: every creature able to block the enchanted creature must block it; blocking the other attacker instead is illegal', () => {
    let s = board(['Grizzly Bears', 'Hill Giant'], ['Wall of Stone', 'Elephant-Rat']);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = toBlocks(putAttached(s, 'Lure', bears, 'p1'), ['Grizzly Bears', 'Hill Giant']);
    const wall = find(s, 'Wall of Stone', 'battlefield');
    const rat = find(s, 'Elephant-Rat', 'battlefield');
    const giant = find(s, 'Hill Giant', 'battlefield');
    const d = blockDecision(s);
    expect(d.requirements).toEqual([
      expect.objectContaining({ kind: 'block', creature: wall, among: [bears], sourceName: 'Lure', text: 'All creatures able to block enchanted creature do so.' }),
      expect.objectContaining({ kind: 'block', creature: rat, among: [bears], sourceName: 'Lure' }),
    ]);
    expect(d.mustObey).toBe(2);
    expect(sorted(d.obeying!)).toEqual(sorted([{ blocker: wall, attacker: bears }, { blocker: rat, attacker: bears }]));
    expect(d.unchecked).toBeUndefined();
    expect(() => act(s, blocks(s, []))).toThrow(/CR 509\.1c/);
    expect(() => act(s, blocks(s, [[wall, bears], [rat, giant]]))).toThrow(/Not obeyed: "All creatures able to block enchanted creature do so\." \(Lure\)/);
    expect(act(s, blocks(s, [[wall, bears], [rat, bears]])).combat?.attackers.find((a) => a.id === bears)?.blockedBy).toHaveLength(2);
    expect(requirementsFor(s, 'block', 'p2')).toEqual(d.requirements); // design m6 3.9: the contract lists what the decision carries
  });

  it('CR 509.1c: Lure on an attacker and Gaea\'s Protector: one creature can obey only one of them, so blocking either is legal and no block is not', () => {
    // "every creature able to block it must, unless blocking another required creature obeys as many" (design m6 5, M6-7)
    let s = board(['Grizzly Bears', "Gaea's Protector"], ['Hill Giant']);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = toBlocks(putAttached(s, 'Lure', bears, 'p1'), ['Grizzly Bears', "Gaea's Protector"]);
    const giant = find(s, 'Hill Giant', 'battlefield');
    const protector = find(s, "Gaea's Protector", 'battlefield');
    expect(blockDecision(s).requirements).toHaveLength(2);
    expect(blockDecision(s).mustObey).toBe(1);
    expect(() => act(s, blocks(s, []))).toThrow(/CR 509\.1c/);
    expect(act(s, blocks(s, [[giant, bears]])).combat?.blockers).toHaveLength(1);
    expect(act(s, blocks(s, [[giant, protector]])).combat?.blockers).toHaveLength(1);
  });

  it('CR 509.1c, 702.111b: Lure on a menace attacker: both creatures able to block it must (one alone breaks menace)', () => {
    let s = board(['Elephant-Rat'], ['Grizzly Bears', 'Hill Giant']);
    const rat = find(s, 'Elephant-Rat', 'battlefield');
    s = toBlocks(putAttached(s, 'Lure', rat, 'p1'), ['Elephant-Rat']);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const giant = find(s, 'Hill Giant', 'battlefield');
    expect(blockDecision(s).mustObey).toBe(2);
    expect(() => act(s, blocks(s, [[bears, rat]]))).toThrow(/CR 702\.111b/);
    expect(() => act(s, blocks(s, []))).toThrow(/CR 509\.1c/);
    expect(act(s, blocks(s, [[bears, rat], [giant, rat]])).combat?.blockers).toHaveLength(2);
  });

  it('CR 509.1c: a creature that can\'t block the lured creature (flying) has no requirement; the others still do', () => {
    let s = board(['Serra Angel'], ['Grizzly Bears', 'Giant Spider']);
    const angel = find(s, 'Serra Angel', 'battlefield');
    s = toBlocks(putAttached(s, 'Lure', angel, 'p1'), ['Serra Angel']);
    const spider = find(s, 'Giant Spider', 'battlefield');
    // CR 702.9b: the Bears can't block a flier, so only the Spider (reach, CR 702.17b) has the requirement
    expect(blockDecision(s).requirements).toEqual([expect.objectContaining({ kind: 'block', creature: spider, among: [angel] })]);
    expect(blockDecision(s).mustObey).toBe(1);
    expect(() => act(s, blocks(s, []))).toThrow(/CR 509.1c/);
    expect(act(s, blocks(s, [[spider, angel]])).combat?.blockers).toHaveLength(1);
  });

  it('CR 509.1c: Prized Unicorn: all creatures able to block it must; obeyRequirements turns a bot\'s empty declaration into a legal one', () => {
    const s = toBlocks(board(['Prized Unicorn', 'Hill Giant'], ['Grizzly Bears', 'Wall of Stone']), ['Prized Unicorn', 'Hill Giant']);
    const unicorn = find(s, 'Prized Unicorn', 'battlefield');
    const d = blockDecision(s);
    expect(d.requirements?.map((r) => [r.kind, r.among])).toEqual([['block', [unicorn]], ['block', [unicorn]]]);
    expect(d.mustObey).toBe(2);
    const fixed = obeyRequirements(d, []);
    expect(fixed.every((b) => b.attacker === unicorn)).toBe(true);
    expect(act(s, blocks(s, fixed.map((b) => [b.blocker, b.attacker] as [ObjectId, ObjectId]))).combat?.blockers).toHaveLength(2);
  });

  it('CR 509.1c: the lured creature not attacking imposes nothing (a requirement that can\'t be obeyed is not listed)', () => {
    let s = board(['Grizzly Bears', 'Hill Giant'], ['Wall of Stone']);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = toBlocks(putAttached(s, 'Lure', bears, 'p1'), ['Hill Giant']);
    expect(blockDecision(s).requirements).toBeUndefined();
    expect(act(s, blocks(s, [])).combat?.blockers).toEqual([]);
  });
});

describe('CR 509.1c: "blocks target creature this turn if able" (Hunt Down, Rampant Elephant)', () => {
  it('CR 509.1c, 611.2a: Hunt Down: the first target must block the second this turn; blocking another attacker instead is illegal', () => {
    let s = scenario(BASE, { defs: DEFS(), p1: { battlefield: ['Forest', 'Grizzly Bears', 'Hill Giant'], hand: ['Hunt Down'] }, p2: { battlefield: ['Wall of Stone'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const giant = find(s, 'Hill Giant', 'battlefield');
    const wall = find(s, 'Wall of Stone', 'battlefield');
    s = castResolve(s, 'p1', 'Hunt Down', [wall, bears]);
    s = toBlocks(s, ['Grizzly Bears', 'Hill Giant']);
    const d = blockDecision(s);
    expect(d.requirements).toEqual([expect.objectContaining({ kind: 'block', creature: wall, among: [bears], sourceName: 'Hunt Down' })]);
    expect(d.mustObey).toBe(1);
    expect(() => act(s, blocks(s, [[wall, giant]]))).toThrow(/CR 509\.1c/);
    expect(() => act(s, blocks(s, []))).toThrow(/CR 509\.1c/);
    expect(act(s, blocks(s, [[wall, bears]])).combat?.blockers).toHaveLength(1);
  });

  it('CR 509.1c: Hunt Down whose second target does not attack imposes nothing', () => {
    let s = scenario(BASE, { defs: DEFS(), p1: { battlefield: ['Forest', 'Grizzly Bears', 'Hill Giant'], hand: ['Hunt Down'] }, p2: { battlefield: ['Wall of Stone'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const wall = find(s, 'Wall of Stone', 'battlefield');
    s = castResolve(s, 'p1', 'Hunt Down', [wall, bears]);
    s = toBlocks(s, ['Hill Giant']);
    expect(blockDecision(s).requirements).toBeUndefined();
    expect(act(s, blocks(s, [])).combat?.blockers).toEqual([]);
  });

  it('CR 611.2a, 514.2: Hunt Down lasts this turn only', () => {
    let s = scenario(BASE, { defs: DEFS(), p1: { battlefield: ['Forest', 'Grizzly Bears'], hand: ['Hunt Down'] }, p2: { battlefield: ['Wall of Stone'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const wall = find(s, 'Wall of Stone', 'battlefield');
    s = castResolve(s, 'p1', 'Hunt Down', [wall, bears]);
    expect(requirementsFor(s, 'block', 'p2')).toEqual([]); // nothing attacks yet
    expect(s.continuousEffects.length).toBeGreaterThan(0);
    s = toDeclareAttackers(s);
    s = act(s, attacks(s, []));
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'the next turn');
    expect(s.continuousEffects.filter((c) => c.effect.s === 'restrict')).toEqual([]);
  });

  it('CR 509.1c, 602.2: Rampant Elephant ("{G}: Target creature blocks ~ this turn if able"): the target must block the Elephant', () => {
    let s = scenario(BASE, { defs: DEFS(), p1: { battlefield: ['Forest', 'Rampant Elephant', 'Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] } });
    const elephant = find(s, 'Rampant Elephant', 'battlefield');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const giant = find(s, 'Hill Giant', 'battlefield');
    s = act(s, { type: 'activate', player: 'p1', source: elephant, ability: 'p:0:0' });
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: giant }] });
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = passUntil(s, (x) => x.zones.stack.length === 0 && x.pending?.kind === 'priority', 'the ability resolving');
    s = toBlocks(s, ['Rampant Elephant', 'Grizzly Bears']);
    expect(blockDecision(s).requirements).toEqual([expect.objectContaining({ kind: 'block', creature: giant, among: [elephant], sourceName: 'Rampant Elephant' })]);
    expect(() => act(s, blocks(s, [[giant, bears]]))).toThrow(/CR 509\.1c/);
    expect(act(s, blocks(s, [[giant, elephant]])).combat?.blockers).toHaveLength(1);
  });
});

describe('CR 508.1d, 509.1c: resolved requirements with a duration ("this turn if able")', () => {
  it('CR 509.1c: Alluring Scent ("All creatures able to block target creature this turn do so.")', () => {
    let s = scenario(BASE, { defs: DEFS(), p1: { battlefield: ['Forest', 'Forest', 'Forest', 'Grizzly Bears', 'Hill Giant'], hand: ['Alluring Scent'] }, p2: { battlefield: ['Wall of Stone'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const giant = find(s, 'Hill Giant', 'battlefield');
    const wall = find(s, 'Wall of Stone', 'battlefield');
    s = toBlocks(castResolve(s, 'p1', 'Alluring Scent', [bears]), ['Grizzly Bears', 'Hill Giant']);
    expect(blockDecision(s).requirements).toEqual([expect.objectContaining({ kind: 'block', creature: wall, among: [bears] })]);
    expect(() => act(s, blocks(s, [[wall, giant]]))).toThrow(/CR 509\.1c/);
    expect(act(s, blocks(s, [[wall, bears]])).combat?.blockers).toHaveLength(1);
  });

  it('CR 509.1c: Culling Mark ("Target creature blocks this turn if able."): no block is illegal, any block obeys it', () => {
    let s = scenario(BASE, { defs: DEFS(), p1: { battlefield: ['Forest', 'Forest', 'Forest', 'Grizzly Bears'], hand: ['Culling Mark'] }, p2: { battlefield: ['Wall of Stone'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const wall = find(s, 'Wall of Stone', 'battlefield');
    s = toBlocks(castResolve(s, 'p1', 'Culling Mark', [wall]), ['Grizzly Bears']);
    expect(blockDecision(s).requirements).toEqual([expect.objectContaining({ kind: 'block', creature: wall })]);
    expect(blockDecision(s).requirements![0]!.among).toBeUndefined();
    expect(() => act(s, blocks(s, []))).toThrow(/CR 509\.1c/);
    expect(act(s, blocks(s, [[wall, bears]])).combat?.blockers).toHaveLength(1);
  });

  it('CR 509.1c: Irresistible Prey ("Target creature must be blocked this turn if able.")', () => {
    let s = scenario(BASE, { defs: DEFS(), p1: { battlefield: ['Forest', 'Grizzly Bears', 'Hill Giant'], hand: ['Irresistible Prey'] }, p2: { battlefield: ['Wall of Stone'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const giant = find(s, 'Hill Giant', 'battlefield');
    const wall = find(s, 'Wall of Stone', 'battlefield');
    s = toBlocks(castResolve(s, 'p1', 'Irresistible Prey', [bears]), ['Grizzly Bears', 'Hill Giant']);
    expect(blockDecision(s).requirements).toEqual([expect.objectContaining({ kind: 'beBlocked', creature: bears })]);
    expect(() => act(s, blocks(s, [[wall, giant]]))).toThrow(/CR 509\.1c/);
    expect(act(s, blocks(s, [[wall, bears]])).combat?.blockers).toHaveLength(1);
  });

  it('CR 508.1d: Boiling Blood ("Target creature attacks this turn if able.") cast on the opponent\'s turn forces their creature to attack', () => {
    let s = scenario(BASE, { defs: DEFS(), p1: { battlefield: ['Grizzly Bears', 'Hill Giant'] }, p2: { battlefield: ['Mountain', 'Mountain', 'Mountain'], hand: ['Boiling Blood'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const giant = find(s, 'Hill Giant', 'battlefield');
    s = castResolve(s, 'p2', 'Boiling Blood', [bears]);
    s = toDeclareAttackers(s);
    const d = attackDecision(s);
    expect(d.requirements).toEqual([expect.objectContaining({ kind: 'attack', creature: bears, sourceName: 'Boiling Blood' })]);
    expect(d.candidates.find((c) => c.id === bears)?.mustAttack).toBe(true);
    expect(d.candidates.find((c) => c.id === giant)?.mustAttack).toBeUndefined();
    expect(() => act(s, attacks(s, [[giant, 'p2']]))).toThrow(/CR 508\.1d/);
    expect(act(s, attacks(s, [[bears, 'p2']])).combat?.attackers).toHaveLength(1);
  });
});

describe('CR 500.8, 508.1d: a "this turn" requirement in an additional combat phase', () => {
  it('CR 500.8, 508.1d: in the second combat of a turn a resolved "attacks this turn if able" is left to the players, said before the choice', () => {
    let s = board(['Grizzly Bears'], []);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = withRuleEffect(s, { s: 'restrict', subject: { ref: 'fixed', objects: [{ id: bears, zone: 'battlefield' }] }, mode: 'mustIfAble', action: 'attack' }, { duration: { d: 'endOfTurn' } });
    expect(attackDecision(toDeclareAttackers(s)).mustObey).toBe(1); // the first combat: enforced
    s = toDeclareAttackers(tweak(s, (x) => { x.turn.combats = 1; })); // as if a combat phase had already happened this turn
    expect(s.turn.combats).toBe(2);
    expect(attackDecision(s).mustObey).toBeUndefined();
    expect(attackDecision(s).unchecked).toEqual([expect.objectContaining({ text: expect.stringMatching(/not the first combat of the turn/) })]);
    expect(act(s, attacks(s, [])).combat?.attackers).toEqual([]);
  });
});

describe('CR 509.1c, 508.1d: the other-creature forms built by hand (no template yet)', () => {
  it('CR 509.1c: "must be blocked by a Wall if able": a Wall blocking obeys it, a non-Wall alone does not', () => {
    let s = board(['Grizzly Bears'], ['Wall of Stone', 'Hill Giant']);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = withRuleEffect(s, { s: 'restrict', subject: { ref: 'fixed', objects: [{ id: bears, zone: 'battlefield' }] }, mode: 'mustIfAble', action: 'beBlocked', other: { subtypes: ['Wall'] } });
    s = toBlocks(s, ['Grizzly Bears']);
    const wall = find(s, 'Wall of Stone', 'battlefield');
    const giant = find(s, 'Hill Giant', 'battlefield');
    expect(blockDecision(s).requirements).toEqual([expect.objectContaining({ kind: 'beBlocked', creature: bears, among: [wall] })]);
    expect(blockDecision(s).mustObey).toBe(1);
    expect(() => act(s, blocks(s, [[giant, bears]]))).toThrow(/CR 509\.1c/);
    expect(act(s, blocks(s, [[wall, bears]])).combat?.blockers).toHaveLength(1);
    expect(act(s, blocks(s, [[wall, bears], [giant, bears]])).combat?.blockers).toHaveLength(2);
  });

  it('CR 509.1c: "must be blocked by a Wall if able" with no Wall able to block imposes nothing', () => {
    let s = board(['Grizzly Bears'], ['Hill Giant']);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = withRuleEffect(s, { s: 'restrict', subject: { ref: 'fixed', objects: [{ id: bears, zone: 'battlefield' }] }, mode: 'mustIfAble', action: 'beBlocked', other: { subtypes: ['Wall'] } });
    s = toBlocks(s, ['Grizzly Bears']);
    expect(blockDecision(s).requirements).toBeUndefined();
    expect(act(s, blocks(s, [])).combat?.blockers).toEqual([]);
  });

  it('CR 508.1d: "attacks a planeswalker if able" with no planeswalker to attack can\'t be obeyed: not listed, nothing to settle by hand', () => {
    let s = board(['Grizzly Bears'], []);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = toDeclareAttackers(withRuleEffect(s, { s: 'restrict', subject: { ref: 'fixed', objects: [{ id: bears, zone: 'battlefield' }] }, mode: 'mustIfAble', action: 'attack', other: { types: ['Planeswalker'] } }));
    expect(attackDecision(s).requirements).toBeUndefined();
    expect(attackDecision(s).unchecked).toBeUndefined();
    const t = act(s, attacks(s, []));
    expect(t.reminders).toEqual([]);
  });

  it('CR 508.1d, design m6 3.9: an `other` filter the engine can\'t evaluate is never enforced: the decision says so before the choice', () => {
    let s = board(['Grizzly Bears'], ['Hill Giant']);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = withRuleEffect(s, { s: 'restrict', subject: { ref: 'each', filter: { types: ['Creature'] } }, mode: 'mustIfAble', action: 'block', other: { dealtDamageThisTurn: true } });
    s = toBlocks(s, ['Grizzly Bears']);
    expect(blockDecision(s).mustObey).toBeUndefined();
    expect(blockDecision(s).unchecked).toEqual([expect.objectContaining({ text: expect.stringMatching(/can't be evaluated/) })]);
    expect(act(s, blocks(s, [])).combat?.blockers).toEqual([]);
  });
});
