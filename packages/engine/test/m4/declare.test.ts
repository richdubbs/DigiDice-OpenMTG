/**
 * Declaring attackers (CR 508) and blockers (CR 509): who is offered, what is validated, what becomes tapped, and the status that follows.
 */
import { describe, expect, it } from 'vitest';
import type { DeclareAttackersDecision, DeclareBlockersDecision } from '../../src/index';
import { reject } from '../m3/scenario';
import {
  act, answer, attackUnblocked, creature, declareAttackers, declareBlockers, find, inGraveyard, lifeOf, logHas, pass, passUntil, scenario, toDeclareAttackers, toDeclareBlockers, toStep, tweak,
} from './helpers';

const attackersDecision = (s: ReturnType<typeof scenario>): DeclareAttackersDecision => {
  const d = s.pending!;
  if (d.kind !== 'declareAttackers') throw new Error(`pending is ${d.kind}`);
  return d;
};
const blockersDecision = (s: ReturnType<typeof scenario>): DeclareBlockersDecision => {
  const d = s.pending!;
  if (d.kind !== 'declareBlockers') throw new Error(`pending is ${d.kind}`);
  return d;
};

describe('CR 508.1: declare attackers is a turn-based action', () => {
  it('CR 508.1a: the active player is asked which untapped creatures attack; the decision offers only creatures that can', () => {
    const s0 = scenario(['Grizzly Bears', 'Hill Giant', 'Serra Angel'], { p1: { battlefield: ['Grizzly Bears', { name: 'Hill Giant', tapped: true }, 'Serra Angel'] }, p2: { battlefield: ['Hill Giant'] } });
    const s = toDeclareAttackers(s0);
    const d = attackersDecision(s);
    expect(d.player).toBe('p1');
    expect(d.rules).toContain('CR 508.1');
    expect(d.candidates.map((c) => c.id).sort()).toEqual([find(s, 'Grizzly Bears', 'battlefield', 'p1'), find(s, 'Serra Angel', 'battlefield', 'p1')].sort());
    expect(d.candidates.every((c) => c.defenders.length === 1 && c.defenders[0] === 'p2')).toBe(true);
  });

  it('CR 508.1a: a tapped creature cannot be declared as an attacker (the answer is rejected)', () => {
    const s = toDeclareAttackers(scenario(['Grizzly Bears'], { p1: { battlefield: [{ name: 'Grizzly Bears', tapped: true }, 'Grizzly Bears'] } }));
    // Only one of the two Bears can attack; the decision has exactly one candidate.
    expect(attackersDecision(s).candidates).toHaveLength(1);
    const tapped = s.zones.battlefield.find((id) => s.objects[id]!.tapped)!;
    const err = reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: tapped, defender: 'p2' }] } });
    expect(err.rules).toContain('CR 508.1a');
  });

  it('CR 302.6, 508.1a: a creature that came under your control this turn cannot attack', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: [{ name: 'Grizzly Bears', since: 1 }] } });
    // The only creature is summoning sick, so there is nothing to decide: combat passes without a declare attackers decision.
    const t = passUntil(s, (x) => x.turn.step === 'declareAttackers', 'declare attackers');
    expect(t.pending).toMatchObject({ kind: 'priority' });
    expect(t.combat!.attackers).toEqual([]);
  });

  it('CR 702.10b: haste lets a creature that just came under your control attack (Raging Goblin)', () => {
    const s = toDeclareAttackers(scenario(['Raging Goblin', 'Grizzly Bears'], { p1: { battlefield: [{ name: 'Raging Goblin', since: 1 }, { name: 'Grizzly Bears', since: 1 }] } }));
    expect(attackersDecision(s).candidates.map((c) => c.id)).toEqual([find(s, 'Raging Goblin', 'battlefield')]);
  });

  it('CR 702.3b: a creature with defender cannot attack (Wall of Stone)', () => {
    const s = scenario(['Wall of Stone'], { p1: { battlefield: ['Wall of Stone'] } });
    const t = passUntil(s, (x) => x.turn.step === 'declareAttackers', 'declare attackers');
    expect(t.pending).toMatchObject({ kind: 'priority' }); // no decision: no creature could attack
  });

  it('CR 508.1f: attacking taps the creature (it is not a cost)', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = declareAttackers(toDeclareAttackers(s0), [[bears]]);
    expect(s.objects[bears]!.tapped).toBe(true);
    expect(s.combat!.attackers).toEqual([{ id: bears, defender: 'p2', defendingPlayer: 'p2', blockedBy: [], blocked: false }]);
    expect(s.combat!.attacked).toBe(true);
    expect(logHas(s, /attacks with Grizzly Bears/, 'CR 508.1')).toBe(true);
  });

  it('CR 702.20b: attacking does not cause a creature with vigilance to tap (Serra Angel, Alpine Watchdog)', () => {
    const s0 = scenario(['Serra Angel', 'Alpine Watchdog'], { p1: { battlefield: ['Serra Angel', 'Alpine Watchdog'] } });
    const angel = find(s0, 'Serra Angel', 'battlefield');
    const dog = find(s0, 'Alpine Watchdog', 'battlefield');
    const s = declareAttackers(toDeclareAttackers(s0), [[angel], [dog]]);
    expect(s.objects[angel]!.tapped).toBe(false);
    expect(s.objects[dog]!.tapped).toBe(false);
    expect(s.combat!.attackers.map((a) => a.id)).toEqual([angel, dog]);
  });

  it('CR 508.1: declaring no attackers is allowed; the declare blockers and combat damage steps are skipped (CR 508.8)', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    let s = declareAttackers(toDeclareAttackers(s0), []);
    expect(s.combat!.attacked).toBe(false);
    expect(logHas(s, /declares no attackers/, 'CR 508.8')).toBe(true);
    const steps: string[] = [];
    while (s.turn.step !== 'main2') {
      if (steps[steps.length - 1] !== s.turn.step) steps.push(s.turn.step);
      s = pass(s);
    }
    expect(steps).toEqual(['declareAttackers', 'endCombat']);
    expect(s.combat).toBeNull();
  });

  it('CR 508.1: an attacker that was not offered, or a duplicate declaration, is rejected', () => {
    const s = toDeclareAttackers(scenario(['Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] } }));
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    const giant = find(s, 'Hill Giant', 'battlefield', 'p2');
    const bad = (attacks: { attacker: string; defender: string }[]) => reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks } });
    expect(bad([{ attacker: giant, defender: 'p2' }]).rules).toContain('CR 508.1a'); // the opponent's creature
    expect(bad([{ attacker: bears, defender: 'p1' }]).rules).toContain('CR 508.1b'); // attacking yourself
    expect(bad([{ attacker: bears, defender: 'p2' }, { attacker: bears, defender: 'p2' }]).rules).toContain('CR 508.1');
  });

  it('CR 508.1b: planeswalkers the defending player controls can be attacked; the attacker names which', () => {
    const s0 = scenario(['Grizzly Bears', 'Jace Beleren'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: [{ name: 'Jace Beleren', counters: { loyalty: 3 } }] } });
    const s = toDeclareAttackers(s0);
    const jace = find(s, 'Jace Beleren', 'battlefield', 'p2');
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    expect(attackersDecision(s).candidates[0]!.defenders).toEqual(['p2', jace]);
    const t = declareAttackers(s, [[bears, jace]]);
    expect(t.combat!.attackers[0]).toMatchObject({ id: bears, defender: jace, defendingPlayer: 'p2' });
    expect(logHas(t, /attacks with Grizzly Bears \(Jace Beleren\)/)).toBe(true);
  });

  it('CR 310.9b: a battle can be attacked by the opponents of its protector, but not by its protector', () => {
    // A Siege is protected by an opponent of its controller (CR 310.12a). The test puts the battles on the battlefield without a protector;
    // state-based action 704.5x designates one before anybody has priority.
    const siege = 'Invasion of Ergamon // Truga Cliffcharger';
    const mine = scenario(['Grizzly Bears', siege], { p1: { battlefield: ['Grizzly Bears', { name: siege, counters: { defense: 4 } }] } });
    const s = toDeclareAttackers(mine);
    const battle = find(s, siege, 'battlefield', 'p1');
    expect(s.objects[battle]!.protector).toBe('p2'); // CR 704.5x, 310.12a
    // Alice controls it and Bob protects it, so Alice's creatures can attack it (a Siege can be attacked by its own controller, CR 310.9b).
    expect(attackersDecision(s).candidates[0]!.defenders).toEqual(['p2', battle]);
    // Bob controls a Siege that Alice protects: Alice can't attack it.
    const theirs = scenario(['Grizzly Bears', siege], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: [{ name: siege, counters: { defense: 4 } }] } });
    const t = toDeclareAttackers(theirs);
    expect(t.objects[find(t, siege, 'battlefield', 'p2')]!.protector).toBe('p1');
    expect(attackersDecision(t).candidates[0]!.defenders).toEqual(['p2']);
  });
});

describe('CR 509.1: declare blockers is a turn-based action', () => {
  const board = () => scenario(['Grizzly Bears', 'Hill Giant', 'Serra Angel'], {
    p1: { battlefield: ['Grizzly Bears', 'Serra Angel'] },
    p2: { battlefield: ['Hill Giant', { name: 'Grizzly Bears', tapped: true }, 'Serra Angel'] },
  });

  it('CR 509.1a: the defending player is asked; only untapped creatures that can block are offered', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p1');
    const s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[bears]]));
    const d = blockersDecision(s);
    expect(d.player).toBe('p2');
    expect(d.candidates.map((c) => c.id).sort()).toEqual([find(s, 'Hill Giant', 'battlefield', 'p2'), find(s, 'Serra Angel', 'battlefield', 'p2')].sort()); // the tapped Bears is not offered
    expect(d.candidates.every((c) => c.attackers.length === 1 && c.attackers[0] === bears && c.maxBlocks === 1)).toBe(true);
    expect(d.needsMultiple).toEqual([]);
  });

  it('CR 509.1g, 509.1h: blockers become blocking creatures and the attacker becomes blocked; several creatures may block one attacker', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p1');
    const giant = find(s0, 'Hill Giant', 'battlefield', 'p2');
    const angel = find(s0, 'Serra Angel', 'battlefield', 'p2');
    let s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[bears]]));
    s = declareBlockers(s, [[giant, bears], [angel, bears]]);
    expect(s.combat!.attackers[0]).toMatchObject({ id: bears, blocked: true, blockedBy: [giant, angel] });
    expect(s.combat!.blockers).toEqual([{ id: giant, blocking: [bears], defendingPlayer: 'p2' }, { id: angel, blocking: [bears], defendingPlayer: 'p2' }]);
    expect(logHas(s, /blocks: Hill Giant blocks Grizzly Bears; Serra Angel blocks Grizzly Bears/, 'CR 509.1')).toBe(true);
  });

  it('CR 509.1h: an attacker with no blockers declared is unblocked', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p1');
    const s = declareBlockers(toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[bears]])), []);
    expect(s.combat!.attackers[0]).toMatchObject({ blocked: false, blockedBy: [] });
    expect(logHas(s, /declares no blockers/)).toBe(true);
  });

  it('CR 509.1a: a creature that was not offered, an attacker that is not attacking, or two blocks by one creature is rejected', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p1');
    const angel1 = find(s0, 'Serra Angel', 'battlefield', 'p1');
    const tappedBears = find(s0, 'Grizzly Bears', 'battlefield', 'p2');
    const giant = find(s0, 'Hill Giant', 'battlefield', 'p2');
    const s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[bears]]));
    const bad = (blocks: { blocker: string; attacker: string }[]) => reject(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks } });
    expect(bad([{ blocker: tappedBears, attacker: bears }]).rules).toContain('CR 509.1a');
    expect(bad([{ blocker: giant, attacker: angel1 }]).rules).toContain('CR 509.1b'); // not an attacker
    expect(bad([{ blocker: giant, attacker: bears }, { blocker: giant, attacker: bears }]).rules).toContain('CR 509.1a'); // one creature can't block twice
  });

  it('CR 509.1: no decision is asked when nothing can block (the step still happens)', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = declareAttackers(toDeclareAttackers(s0), [[bears]]);
    s = passUntil(s, (x) => x.turn.step === 'declareBlockers', 'declare blockers');
    expect(s.pending).toMatchObject({ kind: 'priority' });
    expect(s.combat!.attackers[0]!.blocked).toBe(false);
  });

  it('CR 506.1: the combat phase ends with the end of combat step: nobody is attacking or blocking afterwards (CR 511.3)', () => {
    const s0 = board();
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p1');
    let s = attackUnblocked(s0, [bears]);
    expect(s.turn.step).toBe('endCombat');
    expect(s.combat).not.toBeNull(); // still in combat during the end of combat step
    s = toStep(s, 'main2');
    expect(s.combat).toBeNull();
  });
});

describe('CR 506.4: removal from combat', () => {
  it('CR 509.1h, 510.1c: an attacker stays blocked when its blocker leaves combat, and then deals no combat damage', () => {
    // Bob blocks Alice's Hill Giant with a Grizzly Bears, then Lightning Bolts the Bears: the Giant stays blocked.
    const s0 = scenario(['Hill Giant', 'Grizzly Bears', 'Lightning Bolt', 'Mountain'], { p1: { battlefield: ['Hill Giant'] }, p2: { battlefield: ['Grizzly Bears', 'Mountain'], hand: ['Lightning Bolt'] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = declareBlockers(toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[giant]])), [[bears, giant]]);
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    s = pass(s); // Alice passes, Bob gets priority
    const bolt = find(s, 'Lightning Bolt', 'hand', 'p2');
    s = act(s, { type: 'cast', player: 'p2', card: bolt }); // WP18: Lightning Bolt is automated, its target is chosen as it is cast (CR 601.2c)
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] });
    s = answer(s, { kind: 'payCost', auto: true });
    s = pass(pass(s));
    expect(inGraveyard(s, 'Grizzly Bears', 'p2')).toBe(true); // CR 704.5g
    expect(s.combat!.attackers[0]).toMatchObject({ blocked: true, blockedBy: [] }); // CR 509.1h
    s = toStep(s, 'endCombat');
    expect(lifeOf(s, 'p2')).toBe(20); // blocked, so no damage to the player (CR 510.1c)
  });

  it('CR 506.4: a creature that changes controller is removed from combat', () => {
    const s0 = scenario(['Hill Giant'], { p1: { battlefield: ['Hill Giant'] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    let s = declareAttackers(toDeclareAttackers(s0), [[giant]]);
    expect(s.combat!.attackers).toHaveLength(1);
    s = tweak(s, (t) => { t.objects[giant]!.controller = 'p2'; });
    s = pass(s); // state-based actions prune combat before the next priority
    expect(s.combat!.attackers).toEqual([]);
  });

  it('CR 506.4c: a planeswalker that left combat leaves its attackers attacking nothing: they deal no combat damage', () => {
    const s0 = scenario(['Hill Giant', 'Jace Beleren'], { p1: { battlefield: ['Hill Giant'] }, p2: { battlefield: [{ name: 'Jace Beleren', counters: { loyalty: 3 } }] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const jace = find(s0, 'Jace Beleren', 'battlefield');
    let s = declareAttackers(toDeclareAttackers(s0), [[giant, jace]]);
    s = tweak(s, (t) => { delete t.objects[jace]!.counters.loyalty; }); // Jace is gone by the time damage is dealt: 0 loyalty -> 704.5i
    s = pass(s);
    expect(inGraveyard(s, 'Jace Beleren', 'p2')).toBe(true);
    expect(s.combat!.attackers[0]).toMatchObject({ id: giant, defender: null, defendingPlayer: 'p2' });
    s = toStep(s, 'endCombat');
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});

describe('synthetic helper sanity', () => {
  it('creature() builds a compiled keyword creature', () => {
    const c = creature('Test Trampler', ['3', '3'], 'Deathtouch, trample');
    expect(c.automation.level).toBe('full');
    expect(c.faces[0]!.abilities.map((a) => (a as { keyword?: string }).keyword)).toEqual(['deathtouch', 'trample']);
  });
});
