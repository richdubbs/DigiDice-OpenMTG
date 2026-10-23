/**
 * The worked examples ("Example:" paragraphs) of the Comprehensive Rules that fall inside milestone 4 as scenario tests:
 * CR 120, 302, 506-511, 702.2-702.20 (deathtouch ... vigilance), 702.111 (menace), 704 and 104.
 * Each test is named after the rule that carries the example and uses the real cards of the example when the engine can run
 * them; when a card's effect is not automated yet, the test says which fixture card or synthetic card stands in for it and why.
 * Examples the engine can't run yet are listed at the end of the file.
 *
 * Some of these examples are also exercised, from another angle, in the topic files of this folder (damage, evasion, sba);
 * this file is the one place that follows the Comprehensive Rules paragraph by paragraph.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, getChars, type CardDef, type GameEvent, type GameState, type ObjectId } from '../../src/index';
import { nativeDef } from '../fixtures';
import { reject } from '../m3/scenario';
import {
  act, answer, creature, declareAttackers, declareBlockers, find, inGraveyard, lifeOf, logHas, onBattlefield, pass, passUntil, runCombat, scenario, toDeclareAttackers,
} from './helpers';

/** Attack with p1's `attacker`, pass to the declare blockers decision of p2 and return that state plus the names p2 is offered as blockers. */
function blockOptions(s0: GameState, attacker: ObjectId): { s: GameState; offered: string[] } {
  const s = passUntil(declareAttackers(toDeclareAttackers(s0), [[attacker]]), (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision');
  const d = s.pending;
  if (d?.kind !== 'declareBlockers') throw new Error('no declareBlockers decision');
  const offered = d.candidates.filter((c) => c.attackers.length > 0).map((c) => s.defs[s.objects[c.id]!.defId]!.name);
  return { s, offered: offered.sort() };
}

describe('CR 120.4d, 120.5: damage and its results', () => {
  it('CR 120.5 example: Lightning Bolt deals 3 damage to a 2/2 creature; the creature is destroyed by a state-based action, not by the Bolt', () => {
    const s0 = scenario(['Lightning Bolt', 'Mountain', 'Grizzly Bears'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, p2: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Lightning Bolt', 'hand') });
    // WP18: Bolt's text is automated (the compile pipeline): it targets the creature (CR 601.2c) and the interpreter deals the damage when it resolves
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }] });
    s = pass(answer(s, { kind: 'payCost', auto: true }));
    const r = applyAction(s, { type: 'pass', player: s.pending!.player });
    // Within the one action the damage was dealt, and then (as a separate step) state-based actions destroyed the creature.
    expect(r.state.objects[bears]).toBeUndefined();
    expect(logHas(r.state, /Grizzly Bears is destroyed \(lethal damage\)/, 'CR 704.5g')).toBe(true);
    const texts = r.state.log.map((l) => l.text);
    expect(texts.findIndex((t) => /deals 3 damage to Grizzly Bears/.test(t))).toBeGreaterThanOrEqual(0);
    expect(texts.findIndex((t) => /deals 3 damage to Grizzly Bears/.test(t))).toBeLessThan(texts.findIndex((t) => /Grizzly Bears is destroyed/.test(t)));
    // The destruction is not attributed to the Bolt: the entry that moves the creature cites the state-based action, never the spell.
    expect(r.state.log.find((l) => /Grizzly Bears is destroyed/.test(l.text))!.rules).toContain('CR 704.5g');
    expect(inGraveyard(r.state, 'Grizzly Bears', 'p2')).toBe(true);
  });

  it('CR 120.4d example, reduced (no Boon Reflection, no prevention spell): a 3/3 with wither and lifelink blocked by a 2/2 puts three -1/-1 counters on it, gains 3 life and takes 2 damage', () => {
    // Boon Reflection and the prevention spell are replacement/prevention effects (milestone 6). What is left of the example is the processing of
    // one damage event into its results: counters on the blocker, life gain for the lifelink controller, damage marked on the attacker.
    // A synthetic 3/3 with wither and lifelink stands in for the unnamed creature of the example.
    const wl = creature('Test Wither Lifelinker', ['3', '3'], 'Wither, lifelink', '{3}');
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Test Wither Lifelinker'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [wl] });
    const attacker = find(s0, 'Test Wither Lifelinker', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = runCombat(s0, { attack: [[attacker]], block: [[bears, attacker]] });
    expect(s.lki[bears]!.object.counters['-1/-1']).toBe(3);
    expect(inGraveyard(s, 'Grizzly Bears', 'p2')).toBe(true); // a 2/2 with three -1/-1 counters has toughness -1: CR 704.5f
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(s.objects[attacker]!.damage).toBe(2);
  });
});

describe('CR 302.3: creature subtypes', () => {
  it('CR 302.3 example: "Creature — Goblin Wizard" is a creature with the subtypes Goblin and Wizard (Goblin Wizard)', () => {
    const s = scenario(['Goblin Wizard'], { p1: { battlefield: ['Goblin Wizard'] } });
    const c = getChars(s, find(s, 'Goblin Wizard', 'battlefield'));
    expect(c.types).toEqual(['Creature']);
    expect(c.subtypes).toEqual(['Goblin', 'Wizard']);
  });
});

describe('CR 509.1b: evasion abilities are cumulative', () => {
  it("CR 509.1b example: an attacking creature with flying and shadow can't be blocked by a creature with flying but without shadow", () => {
    // No printed creature has exactly flying + shadow, so two synthetic ones (an attacker and a second one that may block it) stand in.
    const attacker = creature('Test Flying Shadow', ['2', '2'], 'Flying\nShadow', '{2}');
    const both = creature('Test Flying Shadow Blocker', ['1', '1'], 'Flying\nShadow', '{1}');
    const s0 = scenario(['Serra Angel', 'Soltari Foot Soldier', 'Grizzly Bears'], {
      p1: { battlefield: ['Test Flying Shadow'] },
      p2: { battlefield: ['Serra Angel', 'Soltari Foot Soldier', 'Grizzly Bears', 'Test Flying Shadow Blocker'] },
      defs: [attacker, both],
    });
    const { s, offered } = blockOptions(s0, find(s0, 'Test Flying Shadow', 'battlefield'));
    // Serra Angel has flying only; Soltari Foot Soldier has shadow only (and no flying); Bears have neither: only a creature with both may block.
    expect(offered).toEqual(['Test Flying Shadow Blocker']);
    const angel = find(s0, 'Serra Angel', 'battlefield');
    const err = reject(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: angel, attacker: find(s0, 'Test Flying Shadow', 'battlefield') }] } });
    expect(err.rules).toContain('CR 509.1a');
  });
});

describe('CR 509.1c: menace and blocking requirements', () => {
  it('CR 509.1c example, restriction half: against a creature with menace, blocking with only one of two creatures is illegal; blocking with both or with neither is legal (Elephant-Rat)', () => {
    // The example's first creature "blocks if able" (a requirement, not automated yet); here both defenders are ordinary creatures, so only the menace
    // restriction is checked: "Having only the first/second creature block violates the restriction", "Having neither creature block fulfills the restriction".
    const s0 = scenario(['Elephant-Rat', 'Grizzly Bears', 'Hill Giant'], { p1: { battlefield: ['Elephant-Rat'] }, p2: { battlefield: ['Grizzly Bears', 'Hill Giant'] } });
    const rat = find(s0, 'Elephant-Rat', 'battlefield');
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const { s } = blockOptions(s0, rat);
    const decide = (blocks: { blocker: ObjectId; attacker: ObjectId }[]) => ({ type: 'answer' as const, player: 'p2' as const, decisionId: s.pending!.id, answer: { kind: 'declareBlockers' as const, blocks } });
    expect(reject(s, decide([{ blocker: bears, attacker: rat }])).rules).toContain('CR 702.111b');
    expect(reject(s, decide([{ blocker: giant, attacker: rat }])).rules).toContain('CR 702.111b');
    expect(declareBlockers(s, [[bears, rat], [giant, rat]]).combat!.attackers[0]).toMatchObject({ blocked: true, blockedBy: [bears, giant] });
    expect(declareBlockers(s, []).combat!.attackers[0]!.blocked).toBe(false);
  });
});

describe('CR 510.1c: dividing combat damage among several blockers', () => {
  const board = () => scenario(['Elvish Regrower', 'Vampire Spawn', 'Helpful Hunter'], { p1: { battlefield: ['Elvish Regrower'] }, p2: { battlefield: ['Vampire Spawn', 'Helpful Hunter'] } });

  // "can assign all 4 damage to the Hunter, 1 damage to the Spawn and 3 damage to the Hunter, 2 damage to each creature, 3 damage to the Spawn and 1 damage to the Hunter, or all 4 damage to the Spawn."
  it.each([
    { spawn: 0, hunter: 4 },
    { spawn: 1, hunter: 3 },
    { spawn: 2, hunter: 2 },
    { spawn: 3, hunter: 1 },
    { spawn: 4, hunter: 0 },
  ])('CR 510.1c example: Elvish Regrower (4/3) blocked by Vampire Spawn (2/3) and Helpful Hunter (1/1) assigns $spawn to the Spawn and $hunter to the Hunter', ({ spawn, hunter }) => {
    const s0 = board();
    const regrower = find(s0, 'Elvish Regrower', 'battlefield');
    const vs = find(s0, 'Vampire Spawn', 'battlefield');
    const hh = find(s0, 'Helpful Hunter', 'battlefield');
    const s = runCombat(s0, {
      attack: [[regrower]],
      block: [[vs, regrower], [hh, regrower]],
      assign: { [regrower]: [{ id: vs, amount: spawn }, { id: hh, amount: hunter }] },
    });
    // Lethal damage is 3 for the Spawn and 1 for the Hunter (CR 704.5g); damage the controller did not assign to a creature doesn't hurt it.
    expect(onBattlefield(s, 'Vampire Spawn', 'p2')).toBe(spawn < 3);
    expect(onBattlefield(s, 'Helpful Hunter', 'p2')).toBe(hunter < 1);
    if (spawn > 0) expect(logHas(s, new RegExp(`Elvish Regrower deals ${spawn} combat damage to Vampire Spawn`), 'CR 120.2a')).toBe(true);
    if (hunter > 0) expect(logHas(s, new RegExp(`Elvish Regrower deals ${hunter} combat damage to Helpful Hunter`), 'CR 120.2a')).toBe(true);
    // The two blockers deal 2 + 1 = 3 damage back: the 4/3 dies whatever its controller chose.
    expect(inGraveyard(s, 'Elvish Regrower', 'p1')).toBe(true);
    // A blocked creature never deals damage to the player (CR 510.1c).
    expect(lifeOf(s, 'p2')).toBe(20);
  });

  it('CR 510.1c: the whole power has to be assigned to the blockers, and nothing may go to the player (an assignment of 3 or of 5, or any damage to the player, is rejected)', () => {
    const s0 = board();
    const regrower = find(s0, 'Elvish Regrower', 'battlefield');
    const vs = find(s0, 'Vampire Spawn', 'battlefield');
    const hh = find(s0, 'Helpful Hunter', 'battlefield');
    let s = passUntil(declareAttackers(toDeclareAttackers(s0), [[regrower]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    s = passUntil(declareBlockers(s, [[vs, regrower], [hh, regrower]]), (x) => x.pending?.kind === 'assignDamage', 'the damage assignment');
    const attempt = (amounts: { id: string; amount: number }[]) => reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'assignDamage', amounts } });
    expect(attempt([{ id: vs, amount: 2 }, { id: hh, amount: 1 }]).rules).toContain('CR 510.1'); // 3 of 4 assigned
    expect(attempt([{ id: vs, amount: 3 }, { id: hh, amount: 2 }]).rules).toContain('CR 510.1'); // 5 of 4 assigned
    expect(attempt([{ id: vs, amount: 2 }, { id: hh, amount: 1 }, { id: 'p2', amount: 1 }]).rules).toContain('CR 510.1c');
  });
});

describe('CR 702.14d: landwalk abilities do not cancel one another', () => {
  it("CR 702.14d example: a player who controls a snow Forest can't block a creature with snow forestwalk even if they control a creature with snow forestwalk (Rime Dryad)", () => {
    const s0 = scenario(['Rime Dryad', 'Snow-Covered Forest'], { p1: { battlefield: [{ name: 'Rime Dryad' }] }, p2: { battlefield: ['Rime Dryad', 'Snow-Covered Forest'] } });
    const attacker = find(s0, 'Rime Dryad', 'battlefield', 'p1');
    const s = passUntil(declareAttackers(toDeclareAttackers(s0), [[attacker]]), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers or damage', 10);
    // The defender's own Rime Dryad (snow forestwalk) is not offered as a blocker: the attacker can't be blocked at all, so there is nothing to decide.
    expect(s.pending?.kind).not.toBe('declareBlockers');
    expect(s.combat!.attackers[0]!.blocked).toBe(false);
    expect(getChars(s, find(s0, 'Rime Dryad', 'battlefield', 'p2')).keywords.map((k) => k.keyword)).toEqual(['landwalk']);
  });
});

describe('CR 702.15e: lifelink and simultaneous damage', () => {
  it('CR 702.15e example, reduced (no Ajani\'s Pridemate): two creatures with lifelink dealing combat damage together cause two separate life gain events', () => {
    // The example's second half (Ajani's Pridemate triggers twice) needs triggered abilities (milestone 5). What the rule itself says -- separate
    // life gain events, one per source (CR 119.9-10) -- is checked here through the events of the damage step.
    const s0 = scenario(['Aardvark Sloth', 'Vampire Nighthawk'], { p1: { battlefield: ['Aardvark Sloth', 'Vampire Nighthawk'] } });
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Aardvark Sloth', 'battlefield')], [find(s0, 'Vampire Nighthawk', 'battlefield')]]);
    const events: GameEvent[] = [];
    while (s.turn.step !== 'endCombat') {
      const d = s.pending!;
      const r = applyAction(s, d.kind === 'declareBlockers' ? { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareBlockers', blocks: [] } } : { type: 'pass', player: d.player });
      s = r.state;
      events.push(...r.events);
    }
    const gains = events.filter((e) => e.type === 'lifeChanged' && e.player === 'p1');
    expect(gains).toHaveLength(2);
    expect(gains.map((e) => (e.type === 'lifeChanged' ? e.delta : 0))).toEqual([3, 2]);
    expect(lifeOf(s, 'p1')).toBe(25);
    expect(lifeOf(s, 'p2')).toBe(15);
  });
});

describe('CR 702.19b: trample and lethal damage', () => {
  it('CR 702.19b example: a 6/6 green creature with trample blocked by a 2/2 with protection from green must assign at least 2 damage to the blocker, though protection prevents it (Colossal Dreadmaw vs Mirran Crusader)', () => {
    // WP18 review (D14): "protection from black and from green" is not printable by the renderer yet: the milestone 4 recognizer's reading (nativeDef)
    const s0 = scenario(['Colossal Dreadmaw'], { defs: [nativeDef('Mirran Crusader')], p1: { battlefield: ['Colossal Dreadmaw'] }, p2: { battlefield: ['Mirran Crusader'] } });
    const maw = find(s0, 'Colossal Dreadmaw', 'battlefield');
    const crusader = find(s0, 'Mirran Crusader', 'battlefield');
    expect(getChars(s0, maw)).toMatchObject({ power: '6', toughness: '6', colors: ['G'] });
    let s = passUntil(declareAttackers(toDeclareAttackers(s0), [[maw]]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    s = passUntil(declareBlockers(s, [[crusader, maw]]), (x) => x.pending?.kind === 'assignDamage', 'the damage assignment');
    const d = s.pending;
    if (d?.kind !== 'assignDamage') throw new Error('no assignDamage');
    expect(d.recipients.find((r) => r.id === crusader)!.lethal).toBe(2); // protection doesn't excuse it
    const tooLittle = reject(s, { type: 'answer', player: 'p1', decisionId: d.id, answer: { kind: 'assignDamage', amounts: [{ id: crusader, amount: 1 }, { id: 'p2', amount: 5 }] } });
    expect(tooLittle.rules).toContain('CR 702.19b');
    // "can divide the rest of the damage as they choose between the blocking creature and the defending player": 3 more to the blocker, 1 to the player.
    s = answer(s, { kind: 'assignDamage', amounts: [{ id: crusader, amount: 5 }, { id: 'p2', amount: 1 }] });
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'the end of combat');
    expect(s.objects[crusader]!.damage).toBe(0); // all of it prevented by protection (CR 702.16e)
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(onBattlefield(s, 'Mirran Crusader', 'p2')).toBe(true);
  });
});

describe('CR 704: state-based actions', () => {
  it('CR 704.4 example, reduced (no Maro): state-based actions pay no attention to what happens during the resolution of a spell', () => {
    // Maro's power and toughness are a characteristic-defining ability counting cards in hand (milestone 6); the engine can't give a creature a
    // toughness that tracks the hand. The same situation is made with counters: a spell puts a creature at toughness 0 and gives it the toughness
    // back before it finishes resolving. The creature survives, because state-based actions are checked only when a player would get priority.
    const s0 = scenario(['Lightning Bolt', 'Mountain', 'Grizzly Bears'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, p2: { battlefield: ['Grizzly Bears'] }, manual: ['Lightning Bolt'] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Lightning Bolt', 'hand') });
    s = pass(pass(answer(s, { kind: 'payCost', auto: true })));
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'counters', object: bears, counter: '-1/-1', delta: 2 }, { op: 'counters', object: bears, counter: '-1/-1', delta: -2 }] });
    expect(s.objects[bears]).toBeDefined();
    expect(s.zones.graveyard.p2).toEqual([]);
  });

  it("CR 704.8 example: Young Wolf with a +1/+1 counter that gets three -1/-1 counters dies; its last known information still shows the +1/+1 counter, so undying does not trigger", () => {
    // What the example turns on is the last known information of a permanent that left in the same state-based action check as the counters were cancelled
    // (CR 704.5q) -- both counter kinds are still in the information, as they were before state-based actions were performed. FAST5X E28: undying is
    // automated (keywords/data/undying.json), so "undying will not trigger" is checked too.
    const s0 = scenario(['Lightning Bolt', 'Mountain', 'Young Wolf'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain', { name: 'Young Wolf', counters: { '+1/+1': 1 } }] }, manual: ['Lightning Bolt'] });
    const wolf = find(s0, 'Young Wolf', 'battlefield');
    expect(getChars(s0, wolf).keywords.map((k) => k.keyword)).toContain('undying'); // FAST5X E28: automated
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Lightning Bolt', 'hand') });
    s = pass(pass(answer(s, { kind: 'payCost', auto: true })));
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'counters', object: wolf, counter: '-1/-1', delta: 3 }] });
    expect(inGraveyard(s, 'Young Wolf', 'p1')).toBe(true);
    expect(s.lki[wolf]!.object.counters).toEqual({ '+1/+1': 1, '-1/-1': 3 });
    // The +1/+1 counter it had when it was last on the battlefield is what undying would have looked at.
    expect(s.lki[wolf]!.object.counters['+1/+1']).toBe(1);
    expect(s.pendingTriggers).toEqual([]); // CR 704.8 example, 603.4: undying's "if it had no +1/+1 counters on it" is false
    expect(s.zones.stack).toEqual([]);
  });
});


/*
 * Worked examples inside the scope of this milestone that are NOT turned into tests here, and which milestone should cover them.
 *
 * CR 104 (Ending the Game): has no "Example:" paragraphs.
 * CR 506, 507, 511 (combat phase, beginning of combat, end of combat): no "Example:" paragraphs.
 * CR 702.2-702.13, 702.16-702.18, 702.20, 702.111 (deathtouch, defender, double strike, first strike, flash, flying, haste, hexproof, indestructible,
 *   intimidate, protection, reach, shroud, vigilance, menace): no "Example:" paragraphs. (702.9 flying / 702.17 reach and the others are covered by
 *   the rule-named tests in evasion.test.ts, keywords.test.ts and damage.test.ts.)
 *
 * - CR 120.4d, second example (Worship + Awe Strike): replacement and prevention effects wrapping the damage event ("the next time target creature
 *   would deal damage this turn, prevent that damage", "damage that would reduce your life total to less than 1 reduces it to 1 instead"). Milestone 6.
 * - CR 120.4d, first example, the Boon Reflection and prevention-spell parts ("If you would gain life, you gain twice that much life instead", "prevents
 *   the next 2 damage"): milestone 6. The unmodified half is the reduced test above.
 * - CR 508.1c example ("This creature can't attack alone"): attack restrictions printed on cards need the ability model of milestone 5.
 * - CR 508.1d example ("attacks if able" with "No more than one creature can attack each turn"): attack requirements and the "maximum number of
 *   requirements obeyed" rule need milestone 5 (abilities) and 6 (continuous effects).
 * - CR 508.2a example ("Whenever a green creature attacks, destroy that creature at end of combat"; a blue creature turned green): triggered abilities
 *   and color-changing effects, milestones 5 and 6.
 * - CR 509.1c example, requirement half ("blocks if able"): block requirements, milestone 5. The restriction half (menace) is tested above.
 * - CR 509.3f example ("Whenever this creature becomes blocked by a white creature, destroy that creature at end of combat"; a black creature turned
 *   white): triggered abilities and color-changing effects, milestones 5 and 6.
 * - CR 702.15e example, Ajani's Pridemate triggering twice: triggered abilities, milestone 5. The separate life gain events are tested above.
 * - CR 702.19b, first example (a 2/2 that can block an additional creature blocks a 1/1 and a 3/3 with trample): "can block an additional creature"
 *   is a static ability that needs the ability model (milestone 5); the engine lets each creature block one attacker.
 * - CR 702.19c example (trample over planeswalkers, 7/7 attacking a planeswalker with three loyalty): "trample over planeswalkers" is not among the
 *   keywords the engine implements (it stays manual text), milestone 5.
 * - CR 704.4 example, with Maro: a characteristic-defining ability that counts cards in hand needs milestone 6 (layers, CDAs). The reduced test above
 *   shows the rule itself.
 * - CR 704.7 example (Lich's Mirror replacing the game loss from CR 704.5a and 704.5b): replacement of "lose the game" is milestone 6 (docs/design/m4:
 *   "Replacement effects for losing the game (704.7, Lich's Mirror) wait for milestone 6").
 * - CR 704.8 example, the "undying will not trigger" part: triggered abilities (milestone 5) with last known information, tested above only as far as
 *   the information itself.
 */
