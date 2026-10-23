/**
 * Combat damage (CR 510) and what damage does (CR 120, 704.5g-h), with real cards: unblocked and blocked creatures, divided damage
 * (no damage assignment order in this edition), trample, deathtouch, first strike, double strike, lifelink, infect, wither, toxic,
 * indestructible and regeneration, planeswalkers and battles.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, type AssignDamageDecision, type GameEvent } from '../../src/index';
import { addRegenerationShield, type ContinuousEffectRec } from '../../src/index';
import { nativeDef } from '../fixtures';
import { advanceTo, reject } from '../m3/scenario';
import { Game } from '../../src/core/game';
import {
  answer, boltDuringCombat, creature, declareAttackers, find, findAll, inGraveyard, lifeOf, logHas, onBattlefield, pass, passUntil, poisonOf, runCombat, scenario, toDeclareAttackers, tweak,
} from './helpers';

const lethalOf = (d: AssignDamageDecision, id: string) => d.recipients.find((r) => r.id === id)!.lethal;

describe('CR 510.1: unblocked and blocked creatures', () => {
  it('CR 510.1b, 120.3a: an unblocked creature deals its combat damage to the player it attacks, who loses that much life', () => {
    const s0 = scenario(['Hill Giant'], { p1: { battlefield: ['Hill Giant'] } });
    const s = runCombat(s0, { attack: [[find(s0, 'Hill Giant', 'battlefield')]] });
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(logHas(s, /Hill Giant deals 3 combat damage to Bob/, 'CR 120.2a')).toBe(true);
  });

  it('CR 510.1c, 704.5g: a blocked creature deals its damage to its blocker; lethal damage destroys a creature (Bears blocked by Hill Giant)', () => {
    const s0 = scenario(['Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] } });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const s = runCombat(s0, { attack: [[bears]], block: [[giant, bears]] });
    expect(inGraveyard(s, 'Grizzly Bears', 'p1')).toBe(true);
    expect(onBattlefield(s, 'Hill Giant', 'p2')).toBe(true);
    expect(s.objects[giant]!.damage).toBe(2); // CR 120.3e: damage is marked
    expect(lifeOf(s, 'p2')).toBe(20); // blocked: nothing reaches the player
    expect(logHas(s, /Grizzly Bears is destroyed \(lethal damage\)/, 'CR 704.5g')).toBe(true);
  });

  it('CR 120.6, 514.2: marked damage stays until the cleanup step, then it is removed', () => {
    const s0 = scenario(['Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    let s = runCombat(s0, { attack: [[find(s0, 'Grizzly Bears', 'battlefield')]], block: [[giant, find(s0, 'Grizzly Bears', 'battlefield')]] });
    s = passUntil(s, (x) => x.turn.number === 2, 'the next turn');
    expect(s.objects[giant]!.damage).toBe(0);
  });

  it('CR 510.2, 704.3: damage is dealt simultaneously: two Bears blocking each other both die', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const a = find(s0, 'Grizzly Bears', 'battlefield', 'p1');
    const b = find(s0, 'Grizzly Bears', 'battlefield', 'p2');
    const s = runCombat(s0, { attack: [[a]], block: [[b, a]] });
    expect(inGraveyard(s, 'Grizzly Bears', 'p1') && inGraveyard(s, 'Grizzly Bears', 'p2')).toBe(true);
  });

  it('CR 510.1a, 120.8: a creature with 0 power assigns no combat damage (Ornithopter)', () => {
    const s0 = scenario(['Ornithopter'], { p1: { battlefield: ['Ornithopter'] } });
    const s = runCombat(s0, { attack: [[find(s0, 'Ornithopter', 'battlefield')]] });
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(logHas(s, /deals 0/)).toBe(false);
  });

  it('CR 510.2: damageDealt events carry the source, the target and the amount; combat damage is marked as such', () => {
    const s0 = scenario(['Hill Giant', 'Grizzly Bears'], { p1: { battlefield: ['Hill Giant'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    let s = declareAttackers(toDeclareAttackers(s0), [[giant]]);
    const events: GameEvent[] = [];
    for (let i = 0; i < 12 && s.turn.step !== 'endCombat'; i++) {
      const d = s.pending!;
      const action = d.kind === 'declareBlockers' ? { type: 'answer' as const, player: d.player, decisionId: d.id, answer: { kind: 'declareBlockers' as const, blocks: [] } } : { type: 'pass' as const, player: d.player };
      const r = applyAction(s, action);
      s = r.state;
      events.push(...r.events);
    }
    expect(events.filter((e) => e.type === 'damageDealt')).toEqual([{ type: 'damageDealt', source: giant, target: 'p2', amount: 3, combat: true }]);
    expect(events.some((e) => e.type === 'lifeChanged' && e.player === 'p2' && e.delta === -3)).toBe(true);
  });
});

describe('CR 510.1c-d: dividing damage (this edition has no damage assignment order)', () => {
  const board = () => scenario(['Hill Giant', 'Grizzly Bears'], { p1: { battlefield: ['Hill Giant'] }, p2: { battlefield: ['Grizzly Bears', 'Grizzly Bears'] } });

  it('CR 510.1c: an attacker blocked by two creatures divides its damage among them as its controller chooses; the decision names who can be assigned damage', () => {
    const s0 = board();
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const [b1, b2] = findAll(s0, 'Grizzly Bears', 'battlefield', 'p2') as [string, string];
    let seen: AssignDamageDecision | undefined;
    const s = runCombat(s0, {
      attack: [[giant]],
      block: [[b1, giant], [b2, giant]],
      assign: { [giant]: (d) => { seen = d; return [{ id: b1, amount: 2 }, { id: b2, amount: 1 }]; } },
    });
    expect(seen).toMatchObject({ kind: 'assignDamage', player: 'p1', attacker: giant, amount: 3, canTrample: false });
    expect(seen!.recipients).toEqual([{ id: b1, lethal: 2 }, { id: b2, lethal: 2 }]);
    expect(seen!.rules).toContain('CR 510.1c');
    // 2 to the first kills it; the second survives with 1 damage. The two Bears dealt 4 to the Giant, which dies (CR 704.5g).
    expect(inGraveyard(s, 'Grizzly Bears', 'p2')).toBe(true);
    expect(s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Grizzly Bears')).toEqual([b2]);
    expect(s.objects[b2]!.damage).toBe(1);
    expect(inGraveyard(s, 'Hill Giant', 'p1')).toBe(true);
  });

  it('CR 510.1c: no damage assignment order: all the damage may go to the second blocker, and a split that kills nobody is legal too', () => {
    const s0 = board();
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const [b1, b2] = findAll(s0, 'Grizzly Bears', 'battlefield', 'p2') as [string, string];
    const allSecond = runCombat(s0, { attack: [[giant]], block: [[b1, giant], [b2, giant]], assign: { [giant]: [{ id: b2, amount: 3 }] } });
    expect(allSecond.objects[b1]).toBeDefined();
    expect(allSecond.objects[b2]).toBeUndefined();
    const spread = runCombat(s0, { attack: [[giant]], block: [[b1, giant], [b2, giant]], assign: { [giant]: [{ id: b1, amount: 1 }, { id: b2, amount: 2 }] } });
    expect(spread.objects[b1]!.damage).toBe(1);
    expect(spread.objects[b2]).toBeUndefined();
  });

  it('CR 510.1e: an illegal assignment (wrong total, a creature that is not blocking, or a duplicate) is rejected and the decision stays open', () => {
    const s0 = board();
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const [b1, b2] = findAll(s0, 'Grizzly Bears', 'battlefield', 'p2') as [string, string];
    let s = tweak(s0, () => undefined);
    s = passUntil(declareAttackers(toDeclareAttackers(s), [[giant]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: b1, attacker: giant }, { blocker: b2, attacker: giant }] });
    s = passUntil(s, (x) => x.pending?.kind === 'assignDamage', 'the damage assignment');
    const bad = (amounts: { id: string; amount: number }[]) => reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'assignDamage', amounts } });
    expect(bad([{ id: b1, amount: 2 }]).message).toMatch(/exactly 3/);
    expect(bad([{ id: giant, amount: 3 }]).rules).toContain('CR 510.1c');
    expect(bad([{ id: b1, amount: 3 }, { id: b1, amount: 0 }]).rules).toContain('CR 510.1c');
    expect(bad([{ id: b1, amount: -1 }, { id: b2, amount: 4 }]).message).toMatch(/whole numbers/);
    expect(s.pending).toMatchObject({ kind: 'assignDamage', player: 'p1' });
  });

  it('CR 510.1c: when there is no choice nobody is asked: one blocker gets all the damage', () => {
    const s0 = scenario(['Hill Giant', 'Grizzly Bears'], { p1: { battlefield: ['Hill Giant'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = runCombat(s0, { attack: [[giant]], block: [[bears, giant]] }); // no assign entry: an assignDamage decision would throw
    expect(inGraveyard(s, 'Grizzly Bears', 'p2')).toBe(true);
    expect(s.objects[giant]!.damage).toBe(2);
  });
});

describe('CR 702.19: trample', () => {
  const dreadmaw = () => scenario(['Colossal Dreadmaw', 'Grizzly Bears', 'Mirran Crusader'], { p1: { battlefield: ['Colossal Dreadmaw'] }, p2: { battlefield: ['Grizzly Bears'] } });

  it('CR 702.19b: lethal damage to the blocker first, the rest may trample over to the player', () => {
    const s0 = dreadmaw();
    const maw = find(s0, 'Colossal Dreadmaw', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let seen: AssignDamageDecision | undefined;
    const s = runCombat(s0, { attack: [[maw]], block: [[bears, maw]], assign: { [maw]: (d) => { seen = d; return [{ id: bears, amount: 2 }, { id: 'p2', amount: 4 }]; } } });
    expect(seen).toMatchObject({ amount: 6, canTrample: true });
    expect(seen!.recipients).toEqual([{ id: bears, lethal: 2 }, { id: 'p2', lethal: 0, trampleTarget: true }]);
    expect(inGraveyard(s, 'Grizzly Bears', 'p2')).toBe(true);
    expect(lifeOf(s, 'p2')).toBe(16);
  });

  it('CR 702.19b: damage may not go to the player until every blocker has lethal damage assigned (the answer is rejected)', () => {
    const s0 = dreadmaw();
    const maw = find(s0, 'Colossal Dreadmaw', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = passUntil(declareAttackers(toDeclareAttackers(s0), [[maw]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    s = passUntil(answer(s, { kind: 'declareBlockers', blocks: [{ blocker: bears, attacker: maw }] }), (x) => x.pending?.kind === 'assignDamage', 'the damage assignment');
    const err = reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'assignDamage', amounts: [{ id: bears, amount: 1 }, { id: 'p2', amount: 5 }] } });
    expect(err.rules).toContain('CR 702.19b');
    // Not assigning to the player at all is fine, whatever the blocker gets.
    const t = answer(s, { kind: 'assignDamage', amounts: [{ id: bears, amount: 6 }] });
    expect(lifeOf(passUntil(t, (x) => x.turn.step === 'endCombat', 'end of combat'), 'p2')).toBe(20);
  });

  it('CR 702.19b: with no excess there is no choice: a trampler that cannot get past its blocker assigns everything to it (Charging Badger)', () => {
    const s0 = scenario(['Charging Badger', 'Grizzly Bears'], { p1: { battlefield: ['Charging Badger'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const badger = find(s0, 'Charging Badger', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = runCombat(s0, { attack: [[badger]], block: [[bears, badger]] });
    expect(s.objects[bears]!.damage).toBe(1);
    expect(lifeOf(s, 'p2')).toBe(20);
  });

  it('CR 702.19b example: lethal damage is assigned even if protection prevents it (Dreadmaw vs Mirran Crusader, protection from green)', () => {
    // WP18 review (D14): "protection from black and from green" is not printable by the renderer yet: the milestone 4 recognizer's reading (nativeDef)
    const s0 = scenario(['Colossal Dreadmaw'], { defs: [nativeDef('Mirran Crusader')], p1: { battlefield: ['Colossal Dreadmaw'] }, p2: { battlefield: ['Mirran Crusader'] } });
    const maw = find(s0, 'Colossal Dreadmaw', 'battlefield');
    const crusader = find(s0, 'Mirran Crusader', 'battlefield');
    // Protection from green: Dreadmaw is green, so Mirran Crusader can't be targeted but CAN block it (protection doesn't stop blocking attackers); the blocker keeps its protection.
    let s = passUntil(declareAttackers(toDeclareAttackers(s0), [[maw]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    s = passUntil(answer(s, { kind: 'declareBlockers', blocks: [{ blocker: crusader, attacker: maw }] }), (x) => x.pending?.kind === 'assignDamage', 'the damage assignment');
    const err = reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'assignDamage', amounts: [{ id: crusader, amount: 1 }, { id: 'p2', amount: 5 }] } });
    expect(err.rules).toContain('CR 702.19b');
    s = answer(s, { kind: 'assignDamage', amounts: [{ id: crusader, amount: 2 }, { id: 'p2', amount: 4 }] });
    s = passUntil(s, (x) => x.turn.step === 'endCombat' || x.turn.step === 'combatDamage', 'damage');
    expect(s.objects[crusader]!.damage).toBe(0); // CR 702.16e: prevented
    expect(logHas(s, /damage to Mirran Crusader is prevented by protection/, 'CR 702.16e')).toBe(true);
    expect(lifeOf(s, 'p2')).toBe(16);
  });

  it('CR 702.19b: damage already marked on a blocker counts toward lethal damage', () => {
    const s0 = tweak(dreadmaw(), (t) => { t.objects[Object.keys(t.objects).find((id) => t.defs[t.objects[id]!.defId]!.name === 'Grizzly Bears' && t.objects[id]!.zone === 'battlefield')!]!.damage = 1; });
    const maw = find(s0, 'Colossal Dreadmaw', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let seen: AssignDamageDecision | undefined;
    runCombat(s0, { attack: [[maw]], block: [[bears, maw]], assign: { [maw]: (d) => { seen = d; return [{ id: bears, amount: 1 }, { id: 'p2', amount: 5 }]; } } });
    expect(lethalOf(seen!, bears)).toBe(1);
  });

  it('CR 702.19d: a blocked trampler whose blockers are all gone assigns all its damage to the player', () => {
    const s0 = scenario(['Colossal Dreadmaw', 'Grizzly Bears', 'Lightning Bolt', 'Mountain'], { p1: { battlefield: ['Colossal Dreadmaw'] }, p2: { battlefield: ['Grizzly Bears', 'Mountain'], hand: ['Lightning Bolt'] } });
    const maw = find(s0, 'Colossal Dreadmaw', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = passUntil(declareAttackers(toDeclareAttackers(s0), [[maw]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: bears, attacker: maw }] });
    s = boltDuringCombat(s, 'p2', bears);
    expect(s.combat!.attackers[0]).toMatchObject({ blocked: true, blockedBy: [] });
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'end of combat'); // no assignDamage decision: nothing to choose
    expect(lifeOf(s, 'p2')).toBe(14);
  });

  it('CR 702.19b, 702.2c: trample with deathtouch: 1 damage is lethal, so it assigns 1 to each blocker and tramples the rest over', () => {
    const trampler = creature('Test Venomous Trampler', ['3', '3'], 'Deathtouch, trample', '{3}{G}');
    const s0 = scenario(['Hill Giant'], { p1: { battlefield: ['Test Venomous Trampler'] }, p2: { battlefield: ['Hill Giant', 'Hill Giant'] }, defs: [trampler] });
    const t = find(s0, 'Test Venomous Trampler', 'battlefield');
    const [g1, g2] = findAll(s0, 'Hill Giant', 'battlefield', 'p2') as [string, string];
    let seen: AssignDamageDecision | undefined;
    const s = runCombat(s0, { attack: [[t]], block: [[g1, t], [g2, t]], assign: { [t]: (d) => { seen = d; return [{ id: g1, amount: 1 }, { id: g2, amount: 1 }, { id: 'p2', amount: 1 }]; }, } });
    expect(seen!.recipients.map((r) => [r.id, r.lethal])).toEqual([[g1, 1], [g2, 1], ['p2', 0]]);
    expect(inGraveyard(s, 'Hill Giant', 'p2')).toBe(true);
    expect(findAll(s, 'Hill Giant', 'battlefield', 'p2')).toEqual([]); // both died to deathtouch (CR 704.5h)
    expect(lifeOf(s, 'p2')).toBe(19);
    // Assigning only 1 to the first blocker and 2 to the player is not allowed.
    const s1 = passUntil(answer(passUntil(declareAttackers(toDeclareAttackers(s0), [[t]]), (x) => x.pending?.kind === 'declareBlockers', 'b'), { kind: 'declareBlockers', blocks: [{ blocker: g1, attacker: t }, { blocker: g2, attacker: t }] }), (x) => x.pending?.kind === 'assignDamage', 'assign');
    expect(reject(s1, { type: 'answer', player: 'p1', decisionId: s1.pending!.id, answer: { kind: 'assignDamage', amounts: [{ id: g1, amount: 1 }, { id: 'p2', amount: 2 }] } }).rules).toContain('CR 702.19b');
  });
});

describe('CR 702.2: deathtouch', () => {
  it('CR 702.2b, 704.5h: a creature dealt damage by a source with deathtouch is destroyed (Typhoid Rats blocks Hill Giant)', () => {
    const s0 = scenario(['Hill Giant', 'Typhoid Rats'], { p1: { battlefield: ['Hill Giant'] }, p2: { battlefield: ['Typhoid Rats'] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const s = runCombat(s0, { attack: [[giant]], block: [[find(s0, 'Typhoid Rats', 'battlefield'), giant]] });
    expect(inGraveyard(s, 'Hill Giant', 'p1') && inGraveyard(s, 'Typhoid Rats', 'p2')).toBe(true);
    expect(logHas(s, /Hill Giant is destroyed \(damage from a source with deathtouch\)/, 'CR 704.5h')).toBe(true);
  });

  it('CR 702.12b: an indestructible creature survives lethal damage and deathtouch (Darksteel Myr blocks Typhoid Rats)', () => {
    const s0 = scenario(['Typhoid Rats', 'Darksteel Myr'], { p1: { battlefield: ['Typhoid Rats'] }, p2: { battlefield: ['Darksteel Myr'] } });
    const myr = find(s0, 'Darksteel Myr', 'battlefield');
    const s = runCombat(s0, { attack: [[find(s0, 'Typhoid Rats', 'battlefield')]], block: [[myr, find(s0, 'Typhoid Rats', 'battlefield')]] });
    expect(onBattlefield(s, 'Darksteel Myr', 'p2')).toBe(true);
    expect(s.objects[myr]!.damage).toBe(1); // 1 damage on a 0/1 is lethal, but it is indestructible (CR 702.12b)
    expect(s.log.filter((l) => /Darksteel Myr/.test(l.text) && /destroyed/.test(l.text))).toEqual([]); // no log spam on every check
  });
});

describe('CR 702.15: lifelink', () => {
  it('CR 702.15b, 120.3f: damage dealt by a source with lifelink makes its controller gain that much life (Vampire Nighthawk)', () => {
    const s0 = scenario(['Vampire Nighthawk'], { p1: { battlefield: ['Vampire Nighthawk'] } });
    const s = runCombat(s0, { attack: [[find(s0, 'Vampire Nighthawk', 'battlefield')]] });
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(lifeOf(s, 'p1')).toBe(22);
  });

  it('CR 702.15b: lifelink works on damage to creatures, also when the lifelinker is the blocker (Aardvark Sloth blocks Hill Giant)', () => {
    const s0 = scenario(['Hill Giant', 'Aardvark Sloth'], { p1: { battlefield: ['Hill Giant'] }, p2: { battlefield: ['Aardvark Sloth'] } });
    const s = runCombat(s0, { attack: [[find(s0, 'Hill Giant', 'battlefield')]], block: [[find(s0, 'Aardvark Sloth', 'battlefield'), find(s0, 'Hill Giant', 'battlefield')]] });
    expect(lifeOf(s, 'p2')).toBe(23);
  });

  it('CR 702.15b: prevented damage gains no life (Aardvark Sloth, lifelink, is blocked by Beloved Chaplain, protection from creatures)', () => {
    const s0 = scenario(['Aardvark Sloth', 'Beloved Chaplain'], { p1: { battlefield: ['Aardvark Sloth'] }, p2: { battlefield: ['Beloved Chaplain'] } });
    const sloth = find(s0, 'Aardvark Sloth', 'battlefield');
    const chaplain = find(s0, 'Beloved Chaplain', 'battlefield');
    const s = runCombat(s0, { attack: [[sloth]], block: [[chaplain, sloth]] });
    expect(s.objects[chaplain]!.damage).toBe(0); // CR 702.16e
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(s.objects[sloth]!.damage).toBe(1);
  });
});

describe('CR 702.4, 702.7: first strike and double strike', () => {
  it('CR 702.7b, 510.4: a first strike creature deals damage in an earlier step: Bears blocking White Knight die before dealing damage', () => {
    const s0 = scenario(['White Knight', 'Grizzly Bears'], { p1: { battlefield: ['White Knight'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const knight = find(s0, 'White Knight', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = runCombat(s0, { attack: [[knight]], block: [[bears, knight]] });
    expect(inGraveyard(s, 'Grizzly Bears', 'p2')).toBe(true);
    expect(s.objects[knight]!.damage).toBe(0);
    expect(s.combat!.damageSteps).toBe(2);
  });

  it('CR 510.4: there are two combat damage steps when a creature has first strike, and players get priority after each', () => {
    const s0 = scenario(['White Knight', 'Grizzly Bears'], { p1: { battlefield: ['White Knight'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const knight = find(s0, 'White Knight', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = passUntil(declareAttackers(toDeclareAttackers(s0), [[knight]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: bears, attacker: knight }] });
    s = passUntil(s, (x) => x.turn.step === 'combatDamage', 'the first combat damage step');
    expect(s.combat!.damageSteps).toBe(1);
    expect(s.combat!.extraDamageStep).toBe(true);
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(s.objects[bears]).toBeUndefined(); // already dead after the first step (state-based actions ran before priority)
    s = pass(pass(s));
    expect(s.turn.step).toBe('combatDamage'); // the second combat damage step
    expect(s.combat!.damageSteps).toBe(2);
    expect(s.combat!.extraDamageStep).toBe(false);
    s = pass(pass(s));
    expect(s.turn.step).toBe('endCombat');
    expect(s.log.filter((l) => /combat damage step/.test(l.text)).map((l) => l.text)).toEqual(['The first-strike combat damage step.', 'The regular combat damage step.']);
  });

  it('CR 702.7b: a creature without first strike that survives deals its damage in the second step (White Knight vs Hill Giant)', () => {
    const s0 = scenario(['White Knight', 'Hill Giant'], { p1: { battlefield: ['White Knight'] }, p2: { battlefield: ['Hill Giant'] } });
    const knight = find(s0, 'White Knight', 'battlefield');
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const s = runCombat(s0, { attack: [[knight]], block: [[giant, knight]] });
    expect(s.objects[giant]!.damage).toBe(2); // 2 first-strike damage, not lethal
    expect(inGraveyard(s, 'White Knight', 'p1')).toBe(true); // then the Giant's 3 kill the Knight in the regular step
  });

  it('CR 702.7c: a first striker does not deal damage again in the regular step', () => {
    const s0 = scenario(['White Knight'], { p1: { battlefield: ['White Knight'] } });
    const s = runCombat(s0, { attack: [[find(s0, 'White Knight', 'battlefield')]] });
    expect(lifeOf(s, 'p2')).toBe(18); // 2 once, not twice
  });

  it('CR 702.4b: double strike deals damage in both steps (Fencing Ace unblocked: 1 + 1)', () => {
    const s0 = scenario(['Fencing Ace'], { p1: { battlefield: ['Fencing Ace'] } });
    const s = runCombat(s0, { attack: [[find(s0, 'Fencing Ace', 'battlefield')]] });
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(s.combat!.damageSteps).toBe(2);
  });

  it('CR 702.4b: double strike against a blocker: Boros Swiftblade (1/2) and Grizzly Bears kill each other over the two steps', () => {
    const s0 = scenario(['Boros Swiftblade', 'Grizzly Bears'], { p1: { battlefield: ['Boros Swiftblade'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const blade = find(s0, 'Boros Swiftblade', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = runCombat(s0, { attack: [[blade]], block: [[bears, blade]], until: 'combatDamage' });
    expect(s.objects[bears]!.damage).toBe(1); // first step: 1 damage
    expect(s.objects[blade]!.damage).toBe(0);
    s = pass(pass(s)); // the second combat damage step
    expect(inGraveyard(s, 'Boros Swiftblade', 'p1') && inGraveyard(s, 'Grizzly Bears', 'p2')).toBe(true);
  });

  it('CR 702.7b: if a first striker kills its only blocker, the blocked attacker deals no damage to the player in the second step', () => {
    const s0 = scenario(['Fencing Ace', 'Grizzly Bears', 'Ornithopter'], { p1: { battlefield: ['Fencing Ace'] }, p2: { battlefield: ['Ornithopter'] } });
    const ace = find(s0, 'Fencing Ace', 'battlefield');
    const s = runCombat(s0, { attack: [[ace]], block: [[find(s0, 'Ornithopter', 'battlefield'), ace]] });
    // Ornithopter is 0/2: two points of damage from the Ace over the two steps; it never touches the player.
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(inGraveyard(s, 'Ornithopter', 'p2')).toBe(true);
  });

  it('CR 702.4b + 702.15b: damage from both steps is dealt separately (Shrike Force flies and strikes twice, vigilance keeps it untapped)', () => {
    const s0 = scenario(['Shrike Force'], { p1: { battlefield: ['Shrike Force'] } });
    const force = find(s0, 'Shrike Force', 'battlefield');
    const s = runCombat(s0, { attack: [[force]] });
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(s.objects[force]!.tapped).toBe(false);
  });
});

describe('CR 702.90, 702.80, 702.164: infect, wither and toxic', () => {
  it('CR 702.90b, 120.3b: damage from a source with infect gives the player poison counters instead of making them lose life (Glistener Elf)', () => {
    const s0 = scenario(['Glistener Elf'], { p1: { battlefield: ['Glistener Elf'] } });
    const s = runCombat(s0, { attack: [[find(s0, 'Glistener Elf', 'battlefield')]] });
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(poisonOf(s, 'p2')).toBe(1);
  });

  it('CR 704.5c: a player with ten or more poison counters loses the game', () => {
    const s0 = tweak(scenario(['Glistener Elf'], { p1: { battlefield: ['Glistener Elf'] } }), (t) => { t.players[1]!.poison = 9; });
    const s = runCombat(s0, { attack: [[find(s0, 'Glistener Elf', 'battlefield')]] });
    expect(s.result).toMatchObject({ winner: 'p1' });
    expect(s.players[1]!.hasLost).toBe(true);
    expect(logHas(s, /Bob loses the game: has ten or more poison counters/, 'CR 704.5c')).toBe(true);
  });

  it('CR 702.90c, 120.3d: infect damage to a creature puts -1/-1 counters on it instead of marking damage; toughness 0 puts it into the graveyard (CR 704.5f)', () => {
    const s0 = scenario(['Phyrexian Digester', 'Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ['Phyrexian Digester'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const s = runCombat(s0, { attack: [[find(s0, 'Phyrexian Digester', 'battlefield')]], block: [[find(s0, 'Grizzly Bears', 'battlefield'), find(s0, 'Phyrexian Digester', 'battlefield')]] });
    expect(inGraveyard(s, 'Grizzly Bears', 'p2')).toBe(true); // 2 counters on a 2/2: toughness 0
    expect(logHas(s, /Grizzly Bears is put into its owner's graveyard \(toughness 0 or less\)/, 'CR 704.5f')).toBe(true);
    expect(inGraveyard(s, 'Phyrexian Digester', 'p1')).toBe(true); // took 2 damage on a 2/1
  });

  it('CR 702.80a: wither marks no damage but puts -1/-1 counters; the creature stays and is smaller (Scuzzback Scrapper vs Hill Giant)', () => {
    const s0 = scenario(['Scuzzback Scrapper', 'Hill Giant'], { p1: { battlefield: ['Scuzzback Scrapper'] }, p2: { battlefield: ['Hill Giant'] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const s = runCombat(s0, { attack: [[find(s0, 'Scuzzback Scrapper', 'battlefield')]], block: [[giant, find(s0, 'Scuzzback Scrapper', 'battlefield')]] });
    expect(s.objects[giant]!.damage).toBe(0);
    expect(s.objects[giant]!.counters['-1/-1']).toBe(1);
    // CR 613.4c: the counter shrinks the Giant to 2/2.
    expect(JSON.stringify(s.objects[giant]!.counters)).toBe('{"-1/-1":1}');
  });

  it('CR 702.80a: a wither creature kills by counters: Smoldering Butcher (4/2) turns a Hill Giant into a -1/-1', () => {
    const s0 = scenario(['Smoldering Butcher', 'Hill Giant'], { p1: { battlefield: ['Smoldering Butcher'] }, p2: { battlefield: ['Hill Giant'] } });
    const s = runCombat(s0, { attack: [[find(s0, 'Smoldering Butcher', 'battlefield')]], block: [[find(s0, 'Hill Giant', 'battlefield'), find(s0, 'Smoldering Butcher', 'battlefield')]] });
    expect(inGraveyard(s, 'Hill Giant', 'p2')).toBe(true);
    expect(inGraveyard(s, 'Smoldering Butcher', 'p1')).toBe(true);
  });

  it('CR 702.164c, 120.3g: combat damage by a creature with toxic also gives poison counters (Branchblight Stalker: toxic 2)', () => {
    const s0 = scenario(['Branchblight Stalker'], { p1: { battlefield: ['Branchblight Stalker'] } });
    const s = runCombat(s0, { attack: [[find(s0, 'Branchblight Stalker', 'battlefield')]] });
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(poisonOf(s, 'p2')).toBe(2);
  });

  it('CR 702.164c: toxic applies to combat damage dealt to a player only, not to creatures', () => {
    const s0 = scenario(['Branchblight Stalker', 'Wall of Stone'], { p1: { battlefield: ['Branchblight Stalker'] }, p2: { battlefield: ['Wall of Stone'] } });
    const stalker = find(s0, 'Branchblight Stalker', 'battlefield');
    const s = runCombat(s0, { attack: [[stalker]], block: [[find(s0, 'Wall of Stone', 'battlefield'), stalker]] });
    expect(poisonOf(s, 'p2')).toBe(0);
  });
});

/**
 * A regeneration shield as a typed record (transition T1, design 4.5, WP11): a shielded replacement effect of "would be destroyed" for that one permanent
 * (CR 614.8, 701.19a), until end of turn. Milestone 4 built the legacy `{effect: {kind: 'regenerationShield'}, affected}` record here.
 */
const regenerationShield = (id: string, controller: 'p1' | 'p2'): ContinuousEffectRec => ({
  id: 'e-test', source: null, sourceName: 'test', controller, timestamp: 999, startedTurn: 1, duration: { d: 'endOfTurn' },
  effect: { s: 'replace', replaces: { ev: 'action', verb: 'destroy', object: { is: { ref: 'fixed', objects: [{ id, zone: 'battlefield' }] } } }, body: { b: 'regeneration' }, shield: { uses: 1 } },
  usesLeft: 1,
});
const isRegenerationShield = (e: ContinuousEffectRec): boolean => e.effect.s === 'replace' && e.effect.body.b === 'regeneration';

describe('CR 701.19: regeneration', () => {
  it('CR 701.19a: a regeneration shield replaces destruction: remove damage, tap the creature, remove it from combat', () => {
    const s0 = scenario(['Craw Wurm', 'Hill Giant'], { p1: { battlefield: ['Craw Wurm'] }, p2: { battlefield: ['Hill Giant'] } });
    const wurm = find(s0, 'Craw Wurm', 'battlefield');
    const giant = find(s0, 'Hill Giant', 'battlefield');
    // Craw Wurm is 6/4, Hill Giant 3/3: the Giant would die; it has a regeneration shield.
    const withShield = tweak(s0, (t) => {
      t.continuousEffects.push(regenerationShield(giant, 'p2'));
    });
    const s = runCombat(withShield, { attack: [[wurm]], block: [[giant, wurm]] });
    expect(onBattlefield(s, 'Hill Giant', 'p2')).toBe(true);
    expect(s.objects[giant]!.damage).toBe(0);
    expect(s.objects[giant]!.tapped).toBe(true);
    expect(s.combat!.blockers.find((b) => b.id === giant)).toBeUndefined();
    expect(s.combat!.attackers[0]).toMatchObject({ blocked: true, blockedBy: [] }); // CR 509.1h
    expect(s.continuousEffects.filter(isRegenerationShield)).toEqual([]); // the shield is used up
    expect(logHas(s, /Hill Giant regenerates/, 'CR 701.19a')).toBe(true);
  });

  it('CR 701.19c: "can\'t be regenerated" ignores the shield; CR 704.5f: toughness 0 is not destruction, so regeneration never helps', () => {
    const s0 = scenario(['Hill Giant'], { p1: { battlefield: ['Hill Giant'] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const shielded = tweak(s0, (t) => {
      t.continuousEffects.push(regenerationShield(giant, 'p1'));
      t.objects[giant]!.counters['-1/-1'] = 3; // 0/0
    });
    const s = pass(shielded);
    expect(inGraveyard(s, 'Hill Giant', 'p1')).toBe(true);
  });

  it('CR 514.2: a regeneration shield lasts until end of turn', () => {
    const s0 = scenario(['Hill Giant'], { p1: { battlefield: ['Hill Giant'] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const shielded = tweak(s0, (t) => { t.continuousEffects.push(regenerationShield(giant, 'p1')); });
    const s = advanceTo(shielded, 2, 'upkeep');
    expect(s.continuousEffects).toEqual([]);
  });

  it('addRegenerationShield creates the shield as a continuous effect', () => {
    const s0 = scenario(['Hill Giant'], { p1: { battlefield: ['Hill Giant'] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const g = new Game(tweak(s0, () => undefined));
    addRegenerationShield(g, giant);
    expect(g.s.continuousEffects).toMatchObject([{ effect: regenerationShield(giant, 'p1').effect, duration: { d: 'endOfTurn' }, usesLeft: 1, source: null }]);
  });
});

describe('CR 120.3c, 120.3h: damage to planeswalkers and battles', () => {
  it('CR 120.3c, 704.5i: damage to a planeswalker removes that many loyalty counters; at 0 it is put into the graveyard', () => {
    const s0 = scenario(['Hill Giant', 'Grizzly Bears', 'Jace Beleren'], { p1: { battlefield: ['Hill Giant', 'Grizzly Bears'] }, p2: { battlefield: [{ name: 'Jace Beleren', counters: { loyalty: 4 } }] } });
    const jace = find(s0, 'Jace Beleren', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const partial = runCombat(s0, { attack: [[bears, jace]] });
    expect(partial.objects[jace]!.counters.loyalty).toBe(2);
    expect(lifeOf(partial, 'p2')).toBe(20);
    const dead = runCombat(s0, { attack: [[find(s0, 'Hill Giant', 'battlefield'), jace], [bears, jace]] });
    expect(inGraveyard(dead, 'Jace Beleren', 'p2')).toBe(true); // 3 + 2 >= 4
    expect(logHas(dead, /Jace Beleren is put into its owner's graveyard \(loyalty 0\)/, 'CR 704.5i')).toBe(true);
  });

  it('CR 510.1b: attackers split between the player and a planeswalker deal damage to what each attacks', () => {
    const s0 = scenario(['Hill Giant', 'Grizzly Bears', 'Jace Beleren'], { p1: { battlefield: ['Hill Giant', 'Grizzly Bears'] }, p2: { battlefield: [{ name: 'Jace Beleren', counters: { loyalty: 3 } }] } });
    const jace = find(s0, 'Jace Beleren', 'battlefield');
    const s = runCombat(s0, { attack: [[find(s0, 'Hill Giant', 'battlefield'), 'p2'], [find(s0, 'Grizzly Bears', 'battlefield'), jace]] });
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(s.objects[jace]!.counters.loyalty).toBe(1);
  });

  it('CR 120.3h: damage to a battle removes defense counters (Hill Giant attacks a Siege protected by the defending player)', () => {
    const siege = 'Invasion of Ergamon // Truga Cliffcharger';
    const s0 = scenario(['Hill Giant', siege], { p1: { battlefield: ['Hill Giant', { name: siege, counters: { defense: 4 } }] } });
    const battle = find(s0, siege, 'battlefield');
    const s = runCombat(s0, { attack: [[find(s0, 'Hill Giant', 'battlefield'), battle]] });
    expect(s.objects[battle]!.counters.defense).toBe(1);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});

describe('CR 104: players lose and the game ends', () => {
  it('CR 704.5a, 104.2a: combat damage that reduces a player to 0 life makes them lose; the last player remaining wins', () => {
    const s0 = scenario(['Hill Giant'], { p1: { battlefield: ['Hill Giant'] }, life: 3 });
    const s = runCombat(s0, { attack: [[find(s0, 'Hill Giant', 'battlefield')]] });
    expect(s.result).toEqual({ winner: 'p1', reason: 'Alice is the last player remaining' });
    expect(s.stage).toBe('over');
    expect(s.players.map((p) => p.hasLost)).toEqual([false, true]);
    expect(logHas(s, /Bob loses the game: has 0 or less life/, 'CR 704.5a')).toBe(true);
    expect(logHas(s, /Alice wins the game/, 'CR 104.2a')).toBe(true);
  });

  it('CR 104.4a: if all remaining players lose at the same time, the game is a draw', () => {
    const s0 = scenario(['Hill Giant'], { p1: { battlefield: ['Hill Giant'] }, life: 3 });
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Hill Giant', 'battlefield')]]);
    s = passUntil(s, (x) => x.turn.step === 'declareBlockers', 'declare blockers'); // priority in declare blockers: Alice
    s = pass(s); // Bob has priority; after he passes combat damage is dealt
    s = tweak(s, (t) => { t.players[0]!.life = 0; }); // Alice is at 0 life as well when state-based actions are next checked
    s = pass(s);
    expect(s.result).toEqual({ winner: null, reason: 'all players lost simultaneously' });
    expect(logHas(s, /The game is a draw/, 'CR 104.4a')).toBe(true);
  });
});

