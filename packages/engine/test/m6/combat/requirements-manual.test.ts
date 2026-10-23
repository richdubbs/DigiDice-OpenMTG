/**
 * R1 (M6-7a) review: requirements are counted against every restriction and cost (CR 508.1d, 509.1c). A manual card the engine does not run can be such a
 * restriction ("No more than one creature can attack each combat.") or such a cost ("Creatures can't attack you unless their controller pays {2} ..."), so
 * while one is in play the engine can't know the maximum: it lists the requirements as hints, tells the player before the choice, accepts the declaration and
 * logs a manual line with a reminder chip (design m6 3.9, D13: never a wrong rejection, never a silent pass).
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, DeclareAttackersDecision, DeclareBlockersDecision, GameState, ObjectId } from '../../../src/index';
import { act, declareAttackers, find, findAll, scenario, toDeclareAttackers, toDeclareBlockers, tweak } from '../../m4/helpers';
import { VANILLA, withRuleEffect } from '../../m5/rulehooks/fixtures';
import { cards } from './cards';

const attacks = (s: GameState, ids: string[]) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareAttackers' as const, attacks: ids.map((attacker) => ({ attacker, defender: 'p2' })) } });
const blocks = (s: GameState, pairs: [ObjectId, ObjectId][]) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareBlockers' as const, blocks: pairs.map(([blocker, attacker]) => ({ blocker, attacker })) } });
const attackDecision = (s: GameState): DeclareAttackersDecision => s.pending as DeclareAttackersDecision;
const blockDecision = (s: GameState): DeclareBlockersDecision => s.pending as DeclareBlockersDecision;
const DEFS = (): CardDef[] => cards('Goblin Brigand', 'Bloodrock Cyclops', "Gaea's Protector", 'Razorgrass Screen', 'Watchdog', 'Lure', 'Ghostly Prison', 'Silent Arbiter', 'Ironclaw Orcs', 'Hipparion', 'Mogg Flunkies');

/** p1 attacks with every creature named in `attackers`, p2 is asked to declare blockers. */
function toBlocks(s: GameState, attackers: string[]): GameState {
  s = toDeclareAttackers(s);
  s = declareAttackers(s, [...new Set(attackers)].flatMap((n) => findAll(s, n, 'battlefield', 'p1')).map((id) => [id] as [ObjectId]));
  return toDeclareBlockers(s);
}

const manualLine = (s: GameState, source: string, rule: string): boolean => s.log.some((l) => l.level === 'manual' && l.text.includes(source) && l.rules?.includes(rule));

describe('CR 508.1d: a manual restriction or cost on attacking: the requirements are not enforced', () => {
  it('CR 508.1d: Ghostly Prison (a cost the engine does not run) and Goblin Brigand: declaring no attackers is legal (the player need not pay)', () => {
    const s = toDeclareAttackers(scenario(['Grizzly Bears'], { defs: DEFS(), p1: { battlefield: ['Goblin Brigand'] }, p2: { battlefield: ['Ghostly Prison'] } }));
    const brigand = find(s, 'Goblin Brigand', 'battlefield');
    const d = attackDecision(s);
    expect(d.requirements?.map((r) => r.creature)).toEqual([brigand]); // a hint
    expect(d.mustObey).toBeUndefined();
    expect(d.unchecked).toEqual([expect.objectContaining({ sourceName: 'Ghostly Prison' })]);
    const t = act(s, attacks(s, []));
    expect(t.combat?.attackers).toEqual([]);
    expect(manualLine(t, 'Ghostly Prison', 'CR 508.1d')).toBe(true);
    expect(t.reminders).toEqual(expect.arrayContaining([expect.objectContaining({ sourceName: 'Ghostly Prison', until: { d: 'endOfCombat' } })]));
  });

  it('CR 508.1d worked example in a game: Silent Arbiter and two creatures that attack if able: attacking with one of them is legal', () => {
    const s = toDeclareAttackers(scenario(['Grizzly Bears'], { defs: DEFS(), p1: { battlefield: ['Goblin Brigand', 'Bloodrock Cyclops'] }, p2: { battlefield: ['Silent Arbiter'] } }));
    expect(attackDecision(s).mustObey).toBeUndefined();
    const t = act(s, attacks(s, [find(s, 'Goblin Brigand', 'battlefield')]));
    expect(t.combat?.attackers).toHaveLength(1);
    expect(manualLine(t, 'Silent Arbiter', 'CR 508.1d')).toBe(true);
  });

  it('CR 508.1d, 506.5: Mogg Flunkies (automated by FAST5 T37) are no manual text: the requirement of another creature is enforced, and the Flunkies are flagged as attacking only with others', () => {
    const s = toDeclareAttackers(scenario(['Grizzly Bears'], { defs: DEFS(), p1: { battlefield: ['Goblin Brigand', 'Mogg Flunkies'] } }));
    expect(attackDecision(s).mustObey).toBe(1);
    expect(attackDecision(s).unchecked).toBeUndefined();
    expect(attackDecision(s).candidates.find((c) => c.id === find(s, 'Mogg Flunkies', 'battlefield'))?.onlyWithOthers).toBe(true);
  });

  it('CR 508.1d: a manual ability that says nothing about attacking or blocking does not stop the enforcement', () => {
    const quiet = VANILLA('Test Quiet Sage', ['1', '1'], [{ kind: 'manual', shape: 'static', reason: 'test', text: "Players can't gain life." }]);
    const s = toDeclareAttackers(scenario(['Grizzly Bears'], { defs: [...DEFS(), quiet], p1: { battlefield: ['Goblin Brigand'] }, p2: { battlefield: ['Test Quiet Sage'] } }));
    expect(attackDecision(s).mustObey).toBe(1);
    expect(attackDecision(s).unchecked).toBeUndefined();
    expect(() => act(s, attacks(s, []))).toThrow(/CR 508\.1d/);
  });

  it('CR 508.1d: a reminder chip a manual effect left ("creatures can\'t attack this turn") stops the enforcement', () => {
    let s = scenario(['Grizzly Bears'], { defs: DEFS(), p1: { battlefield: ['Goblin Brigand'] } });
    s = tweak(s, (t) => {
      t.reminders.push({ id: 'chip1', text: "Creatures can't attack this turn.", sourceName: 'Test Fog of War', controller: 'p2', until: { d: 'endOfTurn' }, createdTurn: t.turn.number });
    });
    s = toDeclareAttackers(s);
    expect(attackDecision(s).mustObey).toBeUndefined();
    expect(attackDecision(s).unchecked).toEqual([expect.objectContaining({ sourceName: 'Test Fog of War' })]);
    expect(act(s, attacks(s, [])).combat?.attackers).toEqual([]);
  });

  it('CR 508.1d: a requirement the engine can\'t evaluate is announced in the pending decision, before the choice', () => {
    let s = scenario(['Grizzly Bears'], { defs: DEFS(), p1: { battlefield: ['Goblin Brigand', 'Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = toDeclareAttackers(withRuleEffect(s, { s: 'restrict', subject: { ref: 'fixed', objects: [{ id: bears, zone: 'battlefield' }] }, mode: 'mustIfAble', action: 'attack', other: { dealtDamageThisTurn: true } }));
    const d = attackDecision(s);
    expect(d.unchecked).toEqual([expect.objectContaining({ sourceName: 'Test Effect', text: expect.stringMatching(/not checked by the engine/) })]);
    expect(d.prompt).toMatch(/not checked/);
    // it counts toward the maximum (CR 508.1d), so the Brigand's requirement is not enforced either
    expect(d.mustObey).toBeUndefined();
    expect(act(s, attacks(s, [])).combat?.attackers).toEqual([]);
  });
});

describe('CR 509.1c: a manual restriction on blocking: the requirements are not enforced', () => {
  it('CR 509.1c: Silent Arbiter ("No more than one creature can block") with two Razorgrass Screens: one blocker is legal', () => {
    const s = toBlocks(scenario(['Grizzly Bears', 'Hill Giant'], { defs: DEFS(), p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Razorgrass Screen', 'Razorgrass Screen', 'Silent Arbiter'] } }), ['Grizzly Bears']);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    expect(blockDecision(s).mustObey).toBeUndefined();
    expect(blockDecision(s).unchecked).toEqual(expect.arrayContaining([expect.objectContaining({ sourceName: 'Silent Arbiter', text: expect.stringMatching(/No more than one creature can block/) })]));
    const t = act(s, blocks(s, [[findAll(s, 'Razorgrass Screen', 'battlefield')[0]!, bears]]));
    expect(t.combat?.blockers).toHaveLength(1);
    expect(manualLine(t, 'Silent Arbiter', 'CR 509.1c')).toBe(true);
  });

  it('CR 509.1c: Hipparion (can\'t block power 3 or greater unless its controller pays {1}, manual) is the only creature that could block Gaea\'s Protector: no block is legal', () => {
    const s = toBlocks(scenario(['Grizzly Bears'], { defs: DEFS(), p1: { battlefield: ["Gaea's Protector"] }, p2: { battlefield: ['Hipparion'] } }), ["Gaea's Protector"]);
    expect(blockDecision(s).mustObey).toBeUndefined();
    expect(act(s, blocks(s, [])).combat?.blockers).toEqual([]);
  });

  it('CR 509.1b, 509.1c: Ironclaw Orcs (FAST3 T12: its restriction is automated) can\'t block Gaea\'s Protector, so nothing is required of it', () => {
    expect(DEFS().find((d) => d.name === 'Ironclaw Orcs')!.automation.level).toBe('full');
    let s = toDeclareAttackers(scenario(['Grizzly Bears'], { defs: DEFS(), p1: { battlefield: ["Gaea's Protector"] }, p2: { battlefield: ['Ironclaw Orcs'] } }));
    s = declareAttackers(s, [[find(s, "Gaea's Protector", 'battlefield')]]);
    // no creature of p2 can block it: no declare blockers decision is asked, and the damage is dealt unblocked (CR 509.1b, 510.1a)
    for (let i = 0; i < 10 && s.turn.step !== 'endCombat' && s.pending?.kind === 'priority'; i++) s = act(s, { type: 'pass', player: s.pending.player });
    expect(s.combat?.blockers ?? []).toEqual([]);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(16);
  });

  // M6-7: Lure's requirement is enforced now (test/m6/combat/requirements-other.test.ts, "Lure on an attacker and Gaea's Protector").

  it('CR 509.1c: the chips of the declare attackers step are not manual restrictions: Razorgrass Screen must still block', () => {
    let s = scenario(['Grizzly Bears'], { defs: DEFS(), p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Razorgrass Screen'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = withRuleEffect(s, { s: 'restrict', subject: { ref: 'fixed', objects: [{ id: bears, zone: 'battlefield' }] }, mode: 'mustIfAble', action: 'attack', other: { dealtDamageThisTurn: true } });
    s = toBlocks(s, ['Grizzly Bears']);
    expect(s.reminders.length).toBeGreaterThan(0); // the attack step's chip (CR 508.1d, not checked)
    expect(blockDecision(s).mustObey).toBe(1);
    expect(() => act(s, blocks(s, []))).toThrow(/CR 509\.1c/);
  });
});
