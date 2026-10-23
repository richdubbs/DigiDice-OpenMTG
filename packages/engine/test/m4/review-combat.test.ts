/**
 * Second review of milestone 4, combat part: controller changes of attacked permanents and blockers (CR 506.4), phased-out lands and
 * landwalk (CR 702.26b), malformed answers (CR 733.1), explanations of rejected declarations, face-down names in logs (CR 708.2a),
 * damage to objects that are not on the battlefield (CR 120.1), and lifelink as one life gain per source (CR 702.15e).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, cloneState, dealDamage, type GameEvent, type GameState } from '../../src/index';
import { Game } from '../../src/core/game';
import { reject } from '../m3/scenario';
import {
  creature, declareAttackers, declareBlockers, find, lifeOf, logHas, pass, passUntil, runCombat, scenario, toDeclareAttackers, toDeclareBlockers, toStep, tweak,
} from './helpers';

const loyaltyOf = (s: GameState, id: string): number | undefined => s.objects[id]?.counters.loyalty;

describe('CR 506.4: a permanent that changes controller leaves combat (second review)', () => {
  const walkerBoard = () => {
    const s0 = scenario(['Hill Giant', 'Jace Beleren'], { p1: { battlefield: ['Hill Giant'] }, p2: { battlefield: [{ name: 'Jace Beleren', counters: { loyalty: 3 } }] } });
    return { s0, giant: find(s0, 'Hill Giant', 'battlefield'), jace: find(s0, 'Jace Beleren', 'battlefield') };
  };

  it('CR 506.4, 506.4c: an attacked planeswalker that the attacking player now controls is removed from combat; its attackers attack nothing and deal no damage', () => {
    const { s0, giant, jace } = walkerBoard();
    let s = declareAttackers(toDeclareAttackers(s0), [[giant, jace]]);
    s = tweak(s, (t) => { t.objects[jace]!.controller = 'p1'; });
    s = pass(s);
    expect(s.combat!.attackers[0]).toMatchObject({ id: giant, defender: null });
    s = toStep(s, 'endCombat');
    expect(loyaltyOf(s, jace)).toBe(3);
    expect(lifeOf(s, 'p2')).toBe(20);
  });

  it('CR 506.4: a blocker whose controller changes after its attacker left combat is removed from combat', () => {
    const s0 = scenario(['Hill Giant', 'Grizzly Bears'], { p1: { battlefield: ['Hill Giant'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = declareBlockers(toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[giant]])), [[bears, giant]]);
    s = tweak(s, (t) => { t.objects[giant]!.controller = 'p2'; });
    s = pass(s); // the Giant is pruned; the Bears block nothing now
    expect(s.combat!.attackers).toEqual([]);
    expect(s.combat!.blockers).toEqual([expect.objectContaining({ id: bears, blocking: [] })]);
    s = tweak(s, (t) => { t.objects[bears]!.controller = 'p1'; });
    s = pass(s);
    expect(s.combat!.blockers).toEqual([]);
  });
});

describe('CR 702.26b with CR 702.14c: a phased-out land does not stop a creature from being blocked', () => {
  it('CR 702.14c, 702.26b: a phased-out Swamp does not give swampwalk (Bog Raiders), so the Bears are offered as blockers', () => {
    const s0 = scenario(['Bog Raiders', 'Grizzly Bears', 'Swamp'], { p1: { battlefield: ['Bog Raiders'] }, p2: { battlefield: ['Grizzly Bears', 'Swamp'] } });
    const swamp = find(s0, 'Swamp', 'battlefield');
    const raiders = find(s0, 'Bog Raiders', 'battlefield');
    // Control: a phased-in Swamp makes the Raiders unblockable.
    let c = declareAttackers(toDeclareAttackers(s0), [[raiders]]);
    c = passUntil(c, (x) => x.turn.step === 'combatDamage', 'combat damage', 10);
    expect(c.pending!.kind).toBe('priority');
    const t0 = tweak(s0, (t) => { t.objects[swamp]!.phasedOut = true; });
    const s = passUntil(declareAttackers(toDeclareAttackers(t0), [[raiders]]), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers or damage', 10);
    expect(s.pending).toMatchObject({ kind: 'declareBlockers' });
    expect(s.pending!.kind === 'declareBlockers' && s.pending.candidates.map((c) => c.id)).toEqual([find(s0, 'Grizzly Bears', 'battlefield')]);
  });
});

describe('CR 733.1: malformed combat answers are rejected, never thrown', () => {
  const garbage: unknown[] = [null, 7, 'x', undefined];

  it('CR 508.1: declare attackers with a null, number or string entry is rejected with an explanation', () => {
    const s = toDeclareAttackers(scenario(['Hill Giant'], { p1: { battlefield: ['Hill Giant'] } }));
    for (const g of garbage) {
      const r = applyAction(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [g] } as never });
      expect(r.error, `entry ${String(g)}`).toBeDefined();
      expect(r.state).toBe(s);
    }
  });

  it('CR 509.1: declare blockers with a null, number or string entry is rejected with an explanation', () => {
    const s0 = scenario(['Hill Giant', 'Grizzly Bears'], { p1: { battlefield: ['Hill Giant'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Hill Giant', 'battlefield')]]));
    for (const g of garbage) {
      const r = applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [g] } as never });
      expect(r.error, `entry ${String(g)}`).toBeDefined();
      expect(r.state).toBe(s);
    }
  });

  it('CR 510.1: assigning damage with a null, number or string entry is rejected with an explanation', () => {
    const s0 = scenario(['Hill Giant', 'Grizzly Bears'], { p1: { battlefield: ['Hill Giant'] }, p2: { battlefield: ['Grizzly Bears', 'Grizzly Bears'] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const [b1, b2] = s0.zones.battlefield.filter((id) => s0.objects[id]!.controller === 'p2');
    let s = declareBlockers(toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[giant]])), [[b1!, giant], [b2!, giant]]);
    s = passUntil(s, (x) => x.pending?.kind === 'assignDamage', 'the damage assignment');
    for (const g of garbage) {
      for (const amounts of [[g], [{ id: b1, amount: 3 }, g]]) {
        const r = applyAction(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'assignDamage', amounts } as never });
        expect(r.error, `entry ${String(g)}`).toBeDefined();
        expect(r.state).toBe(s);
      }
    }
  });
});

describe('CR 508.1a, 509.1a: rejected declarations say why, with the keyword rule', () => {
  const attackAnswer = (s: GameState, attacker: string) => ({ type: 'answer' as const, player: 'p1', decisionId: s.pending!.id, answer: { kind: 'declareAttackers' as const, attacks: [{ attacker, defender: 'p2' }] } });

  it('CR 702.3b: attacking with a creature that has defender names defender', () => {
    const s0 = scenario(['Wall of Stone', 'Hill Giant'], { p1: { battlefield: ['Wall of Stone', 'Hill Giant'] } });
    const s = toDeclareAttackers(s0);
    const err = reject(s, attackAnswer(s, find(s0, 'Wall of Stone', 'battlefield')));
    expect(err.message).toMatch(/defender/);
    expect(err.rules).toContain('CR 702.3b');
  });

  it('CR 302.6: attacking with a creature that came under your control this turn names summoning sickness', () => {
    const s0 = scenario(['Hill Giant', 'Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears', { name: 'Hill Giant', since: 1 }] } });
    const s = toDeclareAttackers(s0);
    const err = reject(s, attackAnswer(s, find(s0, 'Hill Giant', 'battlefield')));
    expect(err.message).toMatch(/came under your control/);
    expect(err.rules).toContain('CR 302.6');
    expect(err.rules).toContain('CR 508.1a');
  });

  it('CR 702.9b: blocking a creature with flying without flying or reach names flying', () => {
    const s0 = scenario(['Serra Angel', 'Hill Giant', 'Giant Spider'], { p1: { battlefield: ['Serra Angel'] }, p2: { battlefield: ['Hill Giant', 'Giant Spider'] } });
    const s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Serra Angel', 'battlefield')]]));
    const err = reject(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: find(s0, 'Hill Giant', 'battlefield'), attacker: find(s0, 'Serra Angel', 'battlefield') }] } });
    expect(err.message).toMatch(/flying/);
    expect(err.rules).toContain('CR 702.9b');
    expect(err.rules).toContain('CR 509.1a');
  });

  it('CR 702.111b: with an extra attacker the declare blockers decision exists; blocking the menace attacker with one creature that is not offered for it names menace', () => {
    const s0 = scenario(['Elephant-Rat', 'Hill Giant', 'Grizzly Bears'], { p1: { battlefield: ['Elephant-Rat', 'Hill Giant'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const rat = find(s0, 'Elephant-Rat', 'battlefield');
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[rat], [giant]]));
    expect(s.pending).toMatchObject({ kind: 'declareBlockers' });
    const err = reject(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: bears, attacker: rat }] } });
    expect(err.message).toMatch(/menace/);
    expect(err.rules).toContain('CR 702.111b');
  });
});

describe('CR 708.2a: a face-down creature has no name in logs and prompts', () => {
  const faceDownGiant = () => {
    const s0 = scenario(['Hill Giant', 'Grizzly Bears'], { p1: { battlefield: ['Hill Giant'] }, p2: { battlefield: ['Grizzly Bears', 'Grizzly Bears'] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    return { s0: tweak(s0, (t) => { t.objects[giant]!.faceDown = true; }), giant };
  };

  it('CR 508.1, 708.2a: the attack declaration log names a face-down attacker "a face-down card", with no double space', () => {
    const { s0, giant } = faceDownGiant();
    const s = declareAttackers(toDeclareAttackers(s0), [[giant]]);
    expect(logHas(s, /attacks with a face-down card \(Bob\)/, 'CR 508.1')).toBe(true);
    expect(s.log.some((l) => /  /.test(l.text))).toBe(false);
  });

  it('CR 510.1c, 708.2a: the damage assignment prompt of a face-down attacker names "a face-down card"', () => {
    const { s0, giant } = faceDownGiant();
    const [b1, b2] = s0.zones.battlefield.filter((id) => s0.objects[id]!.controller === 'p2');
    let s = declareBlockers(toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[giant]])), [[b1!, giant], [b2!, giant]]);
    s = passUntil(s, (x) => x.pending?.kind === 'assignDamage', 'the damage assignment');
    expect(s.pending!.prompt).toMatch(/combat damage from a face-down card/);
  });
});

describe('CR 120.1: only a creature, planeswalker or battle on the battlefield can be dealt damage', () => {
  const lifelinker = () => {
    const s0 = scenario(['Vampire Nighthawk', 'Hill Giant'], { p1: { battlefield: ['Vampire Nighthawk'] }, p2: { graveyard: ['Hill Giant'], hand: ['Hill Giant'] } });
    return { s0, hawk: find(s0, 'Vampire Nighthawk', 'battlefield') };
  };

  it('CR 120.1, 109.2: a creature card in a graveyard or hand is dealt no damage; lifelink gains nothing', () => {
    const { s0, hawk } = lifelinker();
    for (const zone of ['graveyard', 'hand'] as const) {
      const g = new Game(cloneState(s0));
      const target = find(g.s, 'Hill Giant', zone, 'p2');
      expect(dealDamage(g, hawk, target, 3)).toBe(0);
      expect(g.s.objects[target]!.damage).toBe(0);
      expect(g.s.objects[target]!.deathtouchDamaged).toBe(false);
      expect(g.s.players[0]!.life).toBe(20);
    }
  });

  it('CR 120.1: a phased-out creature is dealt no damage', () => {
    const { s0, hawk } = lifelinker();
    const g = new Game(cloneState(s0));
    const giant = find(g.s, 'Hill Giant', 'hand', 'p2');
    g.s.objects[giant]!.zone = 'battlefield';
    g.s.zones.hand.p2 = g.s.zones.hand.p2!.filter((x) => x !== giant);
    g.s.zones.battlefield.push(giant);
    g.s.objects[giant]!.phasedOut = true;
    expect(dealDamage(g, hawk, giant, 3)).toBe(0);
    expect(g.s.objects[giant]!.damage).toBe(0);
    expect(g.s.players[0]!.life).toBe(20);
  });
});

describe('CR 702.15e, 119.9: lifelink is one life gain per source and damage event', () => {
  it('CR 702.15e: a lifelink trampler that assigns damage to its blocker and to the player gains life once, for the total', () => {
    const lt = creature('Lifelink Trampler', ['5', '5'], 'Lifelink, trample');
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Lifelink Trampler'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [lt] });
    const tramp = find(s0, 'Lifelink Trampler', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = declareBlockers(toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[tramp]])), [[bears, tramp]]);
    s = passUntil(s, (x) => x.pending?.kind === 'assignDamage', 'the damage assignment');
    const r = applyAction(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'assignDamage', amounts: [{ id: bears, amount: 2 }, { id: 'p2', amount: 3 }] } });
    expect(r.error).toBeUndefined();
    const events = r.events.filter((e): e is Extract<GameEvent, { type: 'lifeChanged' }> => e.type === 'lifeChanged' && e.player === 'p1');
    expect(events.map((e) => e.delta)).toEqual([5]);
    expect(lifeOf(r.state, 'p1')).toBe(25);
  });

  it('CR 702.15e, 702.4b: a double striker with lifelink gains life once per damage step', () => {
    const ds = creature('Lifelink Striker', ['2', '2'], 'Double strike, lifelink');
    const s0 = scenario([], { p1: { battlefield: ['Lifelink Striker'] }, defs: [ds] });
    const s = runCombat(s0, { attack: [[find(s0, 'Lifelink Striker', 'battlefield')]] });
    expect(lifeOf(s, 'p1')).toBe(24);
    expect(s.log.filter((l) => /gains 2 life/.test(l.text))).toHaveLength(2);
  });
});
