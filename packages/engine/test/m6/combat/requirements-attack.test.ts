/**
 * R1 (M6-7a): attack requirements, CR 508.1d. The declare attackers decision lists the requirements, how many a legal declaration obeys and one such
 * declaration; an answer that obeys fewer is rejected (CR 733) with the requirement it left out.
 */
import { describe, expect, it } from 'vitest';
import type { DeclareAttackersDecision, GameState } from '../../../src/index';
import { obeyRequirements, requirementsFor } from '../../../src/index';
import { maximize } from '../../../src/rules/requirements';
import { act, find, scenario, toDeclareAttackers, tweak } from '../../m4/helpers';
import { VANILLA, putAttached, withRuleEffect } from '../../m5/rulehooks/fixtures';
import { cards } from './cards';

const attacks = (s: GameState, ids: string[]) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareAttackers' as const, attacks: ids.map((attacker) => ({ attacker, defender: 'p2' })) } });
const decision = (s: GameState): DeclareAttackersDecision => s.pending as DeclareAttackersDecision;

function board(p1: (string | { name: string; tapped?: boolean; since?: number })[]): GameState {
  return toDeclareAttackers(scenario(['Grizzly Bears'], { defs: cards('Goblin Brigand', 'Bloodrock Cyclops', 'Juggernaut', 'Razorgrass Screen'), p1: { battlefield: p1 } }));
}

describe('CR 508.1d: attack requirements', () => {
  it('CR 508.1d: Goblin Brigand ("attacks each combat if able") must attack; declaring no attackers is illegal', () => {
    const s = board(['Goblin Brigand', 'Grizzly Bears']);
    const brigand = find(s, 'Goblin Brigand', 'battlefield');
    const d = decision(s);
    expect(d.requirements).toEqual([expect.objectContaining({ kind: 'attack', creature: brigand, sourceName: 'Goblin Brigand', text: 'Goblin Brigand attacks each combat if able.' })]);
    expect(d.mustObey).toBe(1);
    expect(d.obeying).toEqual([{ attacker: brigand, defender: 'p2' }]);
    expect(d.candidates.find((c) => c.id === brigand)?.mustAttack).toBe(true);
    expect(d.candidates.find((c) => c.id !== brigand)?.mustAttack).toBeUndefined();
    expect(d.rules).toContain('CR 508.1d');

    const none = act.bind(null);
    expect(() => none(s, attacks(s, []))).toThrow(/CR 508\.1d/);
    expect(() => act(s, attacks(s, [find(s, 'Grizzly Bears', 'battlefield')]))).toThrow(/Not obeyed: "Goblin Brigand attacks each combat if able\." \(Goblin Brigand\)/);
    const t = act(s, attacks(s, [brigand]));
    expect(t.combat?.attackers.map((a) => a.id)).toEqual([brigand]);
    const both = act(s, attacks(s, [brigand, find(s, 'Grizzly Bears', 'battlefield')]));
    expect(both.combat?.attackers).toHaveLength(2);
  });

  it('CR 508.1d, design m6 3.9: requirementsFor lists the requirements the declare attackers decision carries', () => {
    const s = board(['Goblin Brigand', 'Grizzly Bears']);
    expect(requirementsFor(s, 'attack', 'p1')).toEqual(decision(s).requirements);
    expect(requirementsFor(s, 'attack', 'p1')).toHaveLength(1);
    expect(requirementsFor(s, 'attack', 'p2')).toEqual([]); // p2 controls no creature
  });

  it('CR 508.1d: two creatures that attack each combat if able, one tapped: attacking with the untapped one is legal, with none it is not', () => {
    const s = board(['Goblin Brigand', { name: 'Bloodrock Cyclops', tapped: true }]);
    const brigand = find(s, 'Goblin Brigand', 'battlefield');
    expect(decision(s).requirements?.map((r) => r.creature)).toEqual([brigand]); // a tapped creature can't attack: no requirement it could obey
    expect(decision(s).mustObey).toBe(1);
    expect(() => act(s, attacks(s, []))).toThrow(/CR 508\.1d/);
    expect(act(s, attacks(s, [brigand])).combat?.attackers).toHaveLength(1);
  });

  it('CR 508.1a, 508.1d: a summoning-sick creature with a requirement is not required to attack (it can\'t)', () => {
    let s = scenario(['Grizzly Bears'], { defs: cards('Goblin Brigand'), p1: { battlefield: [{ name: 'Goblin Brigand', since: 1 }, 'Grizzly Bears'] } });
    s = toDeclareAttackers(s);
    expect(decision(s).requirements).toBeUndefined();
    expect(act(s, attacks(s, [])).combat?.attackers).toEqual([]);
  });

  it('CR 508.1d: each requirement counts; a creature with two requirements obeys both by attacking', () => {
    let s = board(['Goblin Brigand', 'Grizzly Bears']);
    const brigand = find(s, 'Goblin Brigand', 'battlefield');
    // a resolved "target creature attacks this turn if able" on the Brigand (CR 611.2): two requirements on one creature
    s = withRuleEffect(scenario(['Grizzly Bears'], { defs: cards('Goblin Brigand'), p1: { battlefield: ['Goblin Brigand', 'Grizzly Bears'] } }), { s: 'restrict', subject: { ref: 'fixed', objects: [{ id: brigand, zone: 'battlefield' }] }, mode: 'mustIfAble', action: 'attack' });
    s = toDeclareAttackers(s);
    const d = decision(s);
    expect(d.requirements).toHaveLength(2);
    expect(d.requirements?.[1]?.text).toBe('Goblin Brigand attacks if able (an effect of Test Effect).');
    expect(d.mustObey).toBe(2);
    expect(() => act(s, attacks(s, []))).toThrow(/obeys 0 of the requirements, but 2/);
    expect(act(s, attacks(s, [brigand])).combat?.attackers).toHaveLength(1);
  });

  it('CR 611.2, 508.1d: a resolved requirement on another creature ("target creature attacks this turn if able") is enforced', () => {
    let s = scenario(['Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ['Grizzly Bears', 'Hill Giant'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = toDeclareAttackers(withRuleEffect(s, { s: 'restrict', subject: { ref: 'fixed', objects: [{ id: bears, zone: 'battlefield' }] }, mode: 'mustIfAble', action: 'attack' }));
    expect(decision(s).requirements?.map((r) => r.creature)).toEqual([bears]);
    expect(() => act(s, attacks(s, [find(s, 'Hill Giant', 'battlefield')]))).toThrow(/CR 508\.1d/);
    expect(act(s, attacks(s, [bears])).combat?.attackers).toHaveLength(1);
  });

  it('CR 611.3a: a requirement whose source left the battlefield no longer applies', () => {
    let s = scenario(['Grizzly Bears'], { defs: cards('Goblin Brigand'), p1: { battlefield: ['Goblin Brigand', 'Grizzly Bears'] } });
    const brigand = find(s, 'Goblin Brigand', 'battlefield');
    s = tweak(s, (t) => {
      t.objects[brigand]!.zone = 'graveyard';
      t.zones.battlefield = t.zones.battlefield.filter((id) => id !== brigand);
      t.zones.graveyard['p1']!.push(brigand);
    });
    s = toDeclareAttackers(s);
    expect(decision(s).requirements).toBeUndefined();
    expect(act(s, attacks(s, [])).combat?.attackers).toEqual([]);
  });

  it('CR 508.1d: an Aura\'s requirement binds the enchanted creature, whoever controls the Aura (Bloodshed Fever)', () => {
    let s = scenario(['Grizzly Bears', 'Hill Giant'], { defs: cards('Bloodshed Fever'), p1: { battlefield: ['Grizzly Bears', 'Hill Giant'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = toDeclareAttackers(putAttached(s, 'Bloodshed Fever', bears, 'p2'));
    expect(decision(s).requirements).toEqual([expect.objectContaining({ creature: bears, sourceName: 'Bloodshed Fever', text: 'Enchanted creature attacks each combat if able.' })]);
    expect(() => act(s, attacks(s, [find(s, 'Hill Giant', 'battlefield')]))).toThrow(/CR 508\.1d/);
    expect(act(s, attacks(s, [bears])).combat?.attackers).toHaveLength(1);
  });

  it('CR 611.3a, 508.1d: a requirement with a condition ("as long as you control a Forest") applies only while it holds', () => {
    const def = VANILLA('Test Forest Brute', ['3', '3'], [{ kind: 'static', text: 'This creature attacks each combat if able as long as you control a Forest.', effects: [{ s: 'restrict', subject: { ref: 'self' }, mode: 'mustIfAble', action: 'attack', when: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Forest'], controller: 'you' } } } }] }]);
    const without = toDeclareAttackers(scenario(['Island'], { defs: [def], p1: { battlefield: ['Test Forest Brute', 'Island'] } }));
    expect(decision(without).requirements).toBeUndefined();
    expect(act(without, attacks(without, [])).combat?.attackers).toEqual([]);
    const withForest = toDeclareAttackers(scenario(['Forest'], { defs: [def], p1: { battlefield: ['Test Forest Brute', 'Forest'] } }));
    expect(decision(withForest).mustObey).toBe(1);
    expect(() => act(withForest, attacks(withForest, []))).toThrow(/CR 508\.1d/);
  });

  it('CR 508.1d, 611.2: a requirement the engine can\'t evaluate is never enforced: the declaration is accepted with a manual line and a reminder chip', () => {
    let s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = toDeclareAttackers(withRuleEffect(s, { s: 'restrict', subject: { ref: 'fixed', objects: [{ id: bears, zone: 'battlefield' }] }, mode: 'mustIfAble', action: 'attack', other: { dealtDamageThisTurn: true } }));
    expect(decision(s).requirements).toBeUndefined();
    expect(decision(s).unchecked).toEqual([expect.objectContaining({ sourceName: 'Test Effect', text: expect.stringMatching(/not checked by the engine/) })]); // before the choice (design m6 3.9)
    const t = act(s, attacks(s, []));
    expect(t.log.some((l) => l.level === 'manual' && /not checked by the engine/.test(l.text) && l.rules?.includes('CR 508.1d'))).toBe(true);
    expect(t.reminders).toEqual([expect.objectContaining({ sourceName: 'Test Effect', until: { d: 'endOfCombat' } })]);
  });
});

describe('CR 508.1d worked example (the search, with a restriction on the whole declaration)', () => {
  // "A player controls two creatures: one that 'attacks if able' and one with no abilities. An effect states 'No more than one creature can attack each
  // turn.' The only legal attack is for just the creature that 'attacks if able' to attack." This build has no model for that restriction (such cards are
  // manual), so the example is run on the search itself with the restriction as its check.
  const problem = { choices: [['p2', null], ['p2', null]], requirements: [{ vars: [0], obeyed: (a: readonly (string | null)[]) => a[0] !== null }], checkAfter: (i: number, a: readonly (string | null)[]) => i < 1 || a.filter((x) => x !== null).length <= 1 };

  it('CR 508.1d: the maximum is 1, obeyed only by the creature that attacks if able attacking alone', () => {
    const r = maximize(problem)!;
    expect(r.best).toBe(1);
    expect(r.witness).toEqual(['p2', null]);
    // every assignment, judged as the rules judge it
    const legal = (a: (string | null)[]): boolean => problem.checkAfter(1, a) && problem.requirements.filter((q) => q.obeyed(a)).length === r.best;
    expect(legal(['p2', null])).toBe(true);
    expect(legal([null, 'p2'])).toBe(false); // attacks with the other creature
    expect(legal(['p2', 'p2'])).toBe(false); // attacks with both
    expect(legal([null, null])).toBe(false); // attacks with neither
  });

  it('CR 508.1d, design m6 3.9: over the node budget the search gives up (null), it never guesses', () => {
    const big = { choices: Array.from({ length: 12 }, () => ['a', 'b', null]), requirements: [{ vars: [11], obeyed: () => false }], budget: 1000 };
    expect(maximize(big)).toBeNull();
  });
});

describe('CR 508.1d: obeyRequirements: a client or bot makes its declaration legal from the decision alone', () => {
  it('CR 508.1d: obeyRequirements adds the required attackers to the chosen ones', () => {
    const s = board(['Goblin Brigand', 'Grizzly Bears']);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const brigand = find(s, 'Goblin Brigand', 'battlefield');
    const fixed = obeyRequirements(decision(s), [{ attacker: bears, defender: 'p2' }]);
    expect(fixed.map((a) => a.attacker).sort()).toEqual([bears, brigand].sort());
    expect(act(s, attacks(s, fixed.map((a) => a.attacker))).combat?.attackers).toHaveLength(2);
    const ok = [{ attacker: brigand, defender: 'p2' }];
    expect(obeyRequirements(decision(s), ok)).toBe(ok);
  });
});
