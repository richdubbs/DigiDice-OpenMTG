/**
 * Commander lane attack-requirements (concept round), round edh-d-75: the round's readings and engine changes played through the engine with synthetic cards (invented names and wordings,
 * design 6.10), in 4-player games with a played declare-attackers / declare-blockers step, with negative cases. Alice (p1) is the active player of turn 1. CR cites are from the
 * Comprehensive Rules of 2026-09-25 (media.wizards.com text, fetched 2026-11-04).
 *
 *   CR 508.1d, 506.4                "Each opponent must attack with at least one creature each combat if able." (Seeker of Slaanesh)
 *   CR 508.1d, 508.1b               "Each opponent must attack you or a planeswalker you control with at least one creature each combat if able." (Trove of Temptation)
 *   CR 509.1c                       "This creature must be blocked by exactly one creature if able." (Nacatl War-Pride)
 *   CR 508.4, 707.2, 107.3          "Whenever ~ attacks, create X tokens that are copies of it and that are tapped and attacking, where X is the number of creatures defending player controls." (Nacatl War-Pride)
 *   CR 701.15a, 608.2c, 208.1       "... goad each creature your opponents control. Put a +1/+1 counter on ~ for each creature goaded this way." / "... where X is the total power of creatures goaded this way." (Kaima, Havoc Eater)
 *   CR 701.15a-c, 611.2a            "It's goaded for the rest of the game." (Jon Irenicus, Shattered One)
 *   CR 508.1d, 603.4                "... if that creature had to attack this combat, you put a +1/+1 counter on ~ and you draw a card." (Firkraag, Cunning Instigator; ruling 2022-06-10)
 */
import { describe, expect, it } from 'vitest';
import { obeyRequirements, type DeclareAttackersDecision, type DecisionAnswer, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { requirementsFor } from '../../../src/rules/requirements';
import { act, answer, find, findAll, mpScenario, pass, reject } from '../../m12/rules/helpers';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';
import { card, counters, full, resolveAll, settle } from '../cmd3/helpers';

const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '3']);
const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '5']);
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', ['1', '1']);
const ids = (s: GameState, name: string, p: PlayerId): ObjectId[] => findAll(s, name, 'battlefield', p);
const attackDecision = (s: GameState, attacks: [ObjectId, PlayerId | ObjectId][]): { type: 'answer'; player: PlayerId; decisionId: string; answer: DecisionAnswer } =>
  ({ type: 'answer', player: s.pending!.player as PlayerId, decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: attacks.map(([attacker, defender]) => ({ attacker, defender })) } });
const blockDecision = (s: GameState, blocks: [ObjectId, ObjectId][]): { type: 'answer'; player: PlayerId; decisionId: string; answer: DecisionAnswer } =>
  ({ type: 'answer', player: s.pending!.player as PlayerId, decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: blocks.map(([blocker, attacker]) => ({ blocker, attacker })) } });

// ---- Seeker of Slaanesh: a requirement on each opponent's whole group ------------------------------------------------------------------------------------------------
const SEEKER = card('Test Slaan Seeker', 'Creature — Demon', 'Each opponent must attack with at least one creature each combat if able.', ['2', '2']);
describe('CR 508.1d, 506.4: "Each opponent must attack with at least one creature each combat if able." (Seeker of Slaanesh)', () => {
  const start = (): GameState => mpScenario({ defs: [SEEKER, BEAR, GOBLIN], zones: { p1: { battlefield: ['Test Bear', 'Test Goblin'] }, p2: { battlefield: ['Test Slaan Seeker'] } } });
  it('is automated', () => expect(full(SEEKER)).toBe(true));
  it('the active player has ONE requirement for the group of their creatures (not one for each creature)', () => {
    const reqs = requirementsFor(start(), 'attack', 'p1');
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.group).toHaveLength(2);
  });
  it('declaring no attackers is illegal: the requirement is not obeyed (CR 508.1d)', () => {
    const s = toDeclareAttackers(start());
    expect(reject(s, attackDecision(s, [])).rules).toContain('CR 508.1d');
  });
  it('one attacker of the group, at any player, obeys it; both attacking obey it too', () => {
    const s0 = toDeclareAttackers(start());
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const gob = find(s0, 'Test Goblin', 'battlefield', 'p1');
    expect(declareAttackers(s0, [[gob, 'p4']]).combat?.attackers.length).toBe(1);
    expect(declareAttackers(s0, [[bear, 'p3'], [gob, 'p2']]).combat?.attackers.length).toBe(2);
  });
  it("negative: the Seeker's own controller is bound by nothing (its opponents' requirement is not its own), and with no creature able to attack there is no requirement", () => {
    expect(requirementsFor(start(), 'attack', 'p2')).toEqual([]);
    const tapped = tweak(start(), (x) => { for (const id of [...findAll(x, 'Test Bear', 'battlefield', 'p1'), ...findAll(x, 'Test Goblin', 'battlefield', 'p1')]) x.objects[id]!.tapped = true; });
    expect(requirementsFor(tapped, 'attack', 'p1')).toEqual([]);
  });
});

// ---- Trove of Temptation: the requirement names its defender --------------------------------------------------------------------------------------------------------------
const TROVE = card('Test Temptation Trove', 'Enchantment', 'Each opponent must attack you or a planeswalker you control with at least one creature each combat if able.');
describe('CR 508.1d, 508.1b: "Each opponent must attack you or a planeswalker you control with at least one creature each combat if able." (Trove of Temptation)', () => {
  const start = (): GameState => mpScenario({ defs: [TROVE, BEAR, GOBLIN], zones: { p1: { battlefield: ['Test Bear', 'Test Goblin'] }, p2: { battlefield: ['Test Temptation Trove'] } } });
  it('is automated', () => expect(full(TROVE)).toBe(true));
  it("the requirement is obeyed only by attacking its controller (here p2): one creature is enough, the other may attack another player", () => {
    const reqs = requirementsFor(start(), 'attack', 'p1');
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.among).toEqual(['p2']);
    const s0 = toDeclareAttackers(start());
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const gob = find(s0, 'Test Goblin', 'battlefield', 'p1');
    expect(declareAttackers(s0, [[bear, 'p2'], [gob, 'p3']]).combat?.attackers.length).toBe(2);
    expect(declareAttackers(s0, [[gob, 'p2']]).combat?.attackers.length).toBe(1);
  });
  it('negative: attacking only other players (or nobody) does not obey it and is refused', () => {
    const s0 = toDeclareAttackers(start());
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const gob = find(s0, 'Test Goblin', 'battlefield', 'p1');
    expect(reject(s0, attackDecision(s0, [[bear, 'p3'], [gob, 'p4']])).rules).toContain('CR 508.1d');
    reject(s0, attackDecision(s0, []));
  });
});

describe('bots and clients: the decision carries the group requirement and the declaration that obeys it (rules/requirements.ts#obeyRequirements)', () => {
  it('Seeker: an empty answer becomes ONE attacker (a smaller example than every creature of the group); Trove: that attacker attacks the Trove controller', () => {
    const seeker = toDeclareAttackers(mpScenario({ defs: [SEEKER, BEAR, GOBLIN], zones: { p1: { battlefield: ['Test Bear', 'Test Goblin'] }, p2: { battlefield: ['Test Slaan Seeker'] } } }));
    const d1 = seeker.pending as DeclareAttackersDecision;
    expect(d1.requirements).toHaveLength(1);
    expect(d1.candidates.some((c) => c.mustAttack === true)).toBe(false); // no one creature must attack
    expect(obeyRequirements(d1, [])).toHaveLength(1);
    const trove = toDeclareAttackers(mpScenario({ defs: [TROVE, BEAR, GOBLIN], zones: { p1: { battlefield: ['Test Bear', 'Test Goblin'] }, p2: { battlefield: ['Test Temptation Trove'] } } }));
    const fixed = obeyRequirements(trove.pending as DeclareAttackersDecision, []);
    expect(fixed).toHaveLength(1);
    expect(fixed[0]!.defender).toBe('p2');
    // an answer that already obeys it is kept as it is
    const gob = find(trove, 'Test Goblin', 'battlefield', 'p1');
    expect(obeyRequirements(trove.pending as DeclareAttackersDecision, [{ attacker: gob, defender: 'p2' }])).toEqual([{ attacker: gob, defender: 'p2' }]);
  });
});

describe('CR 508.1d, 506.5: a creature that can\'t attack alone may be the lone attacker when a group requirement is all that applies (review: the game must not stall)', () => {
  const FLUNKY = card('Test Flunky', 'Creature — Goblin', "~ can't attack alone.", ['1', '1']);
  it('the lone attack is accepted (no declaration could obey the requirement otherwise)', () => {
    const s0 = toDeclareAttackers(mpScenario({ defs: [SEEKER, FLUNKY], zones: { p1: { battlefield: ['Test Flunky'] }, p2: { battlefield: ['Test Slaan Seeker'] } } }));
    expect(declareAttackers(s0, [[find(s0, 'Test Flunky', 'battlefield', 'p1'), 'p2']]).combat?.attackers.length).toBe(1);
  });
});

// ---- Nacatl War-Pride: blocked by exactly one creature -------------------------------------------------------------------------------------------------------------------
const LONE = card('Test Lone Quarry', 'Creature — Cat', 'This creature must be blocked by exactly one creature if able.', ['2', '2']);
describe('CR 509.1c: "This creature must be blocked by exactly one creature if able." (Nacatl War-Pride)', () => {
  const start = (extra: Partial<Record<PlayerId, { battlefield: string[] }>> = {}): GameState =>
    mpScenario({ defs: [LONE, WALL], zones: { p1: { battlefield: ['Test Lone Quarry'] }, p2: { battlefield: ['Test Wall', 'Test Wall'] }, ...extra } });
  const atBlockers = (s0: GameState): GameState => passUntil(declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Lone Quarry', 'battlefield', 'p1'), 'p2']]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
  it('is automated', () => expect(full(LONE)).toBe(true));
  it('exactly one blocker obeys it; no block, or two blockers, does not (CR 509.1c)', () => {
    const s = atBlockers(start());
    const quarry = find(s, 'Test Lone Quarry', 'battlefield', 'p1');
    const [w1, w2] = ids(s, 'Test Wall', 'p2');
    expect(reject(s, blockDecision(s, [])).rules).toContain('CR 509.1c');
    expect(reject(s, blockDecision(s, [[w1!, quarry], [w2!, quarry]])).rules).toContain('CR 509.1c');
    expect(declareBlockers(s, [[w1!, quarry]]).combat?.blockers.length).toBe(1);
  });
  it('negative: when no creature can block it there is no requirement and no block is asked (ruling 2007-05-01: the requirement binds only if it can be obeyed)', () => {
    const tapped = tweak(start(), (x) => { for (const id of findAll(x, 'Test Wall', 'battlefield', 'p2')) x.objects[id]!.tapped = true; });
    const s = declareAttackers(toDeclareAttackers(tapped), [[find(tapped, 'Test Lone Quarry', 'battlefield', 'p1'), 'p2']]);
    expect(passUntil(s, (x) => x.turn.step === 'combatDamage' || x.pending?.kind === 'declareBlockers', 'damage').pending?.kind).not.toBe('declareBlockers');
  });
});

const NACATL = card('Test Pride Quarry', 'Creature — Cat', 'Whenever ~ attacks, create X tokens that are copies of it and that are tapped and attacking, where X is the number of creatures defending player controls. Exile the tokens at the beginning of the next end step.', ['2', '2']);
describe('CR 508.4, 707.2, 107.3: "Whenever ~ attacks, create X tokens that are copies of it and that are tapped and attacking, where X is the number of creatures defending player controls." (Nacatl War-Pride)', () => {
  const start = (): GameState => mpScenario({ defs: [NACATL, WALL, GOBLIN], zones: { p1: { battlefield: ['Test Pride Quarry'] }, p2: { battlefield: ['Test Wall', 'Test Wall', 'Test Wall'] }, p3: { battlefield: ['Test Goblin'] } } });
  it('is automated', () => expect(full(NACATL)).toBe(true));
  it('attacking p2 (three creatures): three tapped and attacking copies; they are exiled at the beginning of the next end step', () => {
    const s0 = toDeclareAttackers(start());
    const s = resolveAll(declareAttackers(s0, [[find(s0, 'Test Pride Quarry', 'battlefield', 'p1'), 'p2']]));
    const copies = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1');
    expect(copies).toHaveLength(3);
    expect(copies.every((id) => s.objects[id]!.tapped && s.combat?.attackers.some((a) => a.id === id && a.defender === 'p2'))).toBe(true);
    // nobody blocks; the game runs to the end step, where the delayed trigger exiles the copies
    let t = s;
    for (let i = 0; i < 80 && !(t.turn.step === 'end' && t.pending?.kind === 'priority' && t.zones.stack.length > 0); i++) {
      if (t.pending?.kind === 'declareBlockers') t = declareBlockers(t, []);
      else if (t.pending?.kind === 'priority') t = pass(t);
      else t = settle(t);
    }
    const tokensOf = (x: GameState): ObjectId[] => x.zones.battlefield.filter((id) => x.objects[id]!.kind === 'token' && x.objects[id]!.controller === 'p1');
    expect(tokensOf(t)).toHaveLength(3); // still there as the end step begins (the trigger is on the stack)
    const rest = resolveAll(t);
    expect(tokensOf(rest)).toHaveLength(0);
  });
  it('negative: attacking p3 (one creature): a single copy, counted from the defending player', () => {
    const s0 = toDeclareAttackers(start());
    const s = resolveAll(declareAttackers(s0, [[find(s0, 'Test Pride Quarry', 'battlefield', 'p1'), 'p3']]));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1')).toHaveLength(1);
  });
});

// ---- goad "this way" counts -----------------------------------------------------------------------------------------------------------------------------------------------------
const GOAD_COUNT = card('Test Goad Counter', 'Creature — Dragon', 'When ~ enters, goad each creature your opponents control. Put a +1/+1 counter on ~ for each creature goaded this way.', ['1', '1']);
const GOAD_POWER = card('Test Goad Eater', 'Creature — Dragon', 'When ~ enters, goad each creature your opponents control. Put X +1/+1 counters on ~, where X is the total power of creatures goaded this way.', ['1', '1']);
describe('CR 701.15a, 608.2c, 208.1: "for each creature goaded this way" / "the total power of creatures goaded this way" (Kaima, Havoc Eater)', () => {
  const play = (name: string, p2: string[], p3: string[]): GameState => {
    const s0 = mpScenario({ defs: [GOAD_COUNT, GOAD_POWER, BEAR, WALL, GOBLIN], zones: { p1: { hand: [name] }, p2: { battlefield: p2 }, p3: { battlefield: p3 } } });
    return resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }));
  };
  it('are automated', () => { expect(full(GOAD_COUNT)).toBe(true); expect(full(GOAD_POWER)).toBe(true); });
  it('three creatures of two opponents goaded: three +1/+1 counters; they are goaded by Alice', () => {
    const s = play('Test Goad Counter', ['Test Bear', 'Test Wall'], ['Test Goblin']);
    expect(counters(s, find(s, 'Test Goad Counter', 'battlefield', 'p1'), '+1/+1')).toBe(3);
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p2')]!.goaded).toEqual([{ by: 'p1' }]);
  });
  it('the total power of the goaded creatures: 3 + 0 + 1 = four counters', () => {
    const s = play('Test Goad Eater', ['Test Bear', 'Test Wall'], ['Test Goblin']);
    expect(counters(s, find(s, 'Test Goad Eater', 'battlefield', 'p1'), '+1/+1')).toBe(4);
  });
  it('negative: no opponent controls a creature: nothing is goaded and no counter is put', () => {
    const s = play('Test Goad Counter', [], []);
    expect(counters(s, find(s, 'Test Goad Counter', 'battlefield', 'p1'), '+1/+1')).toBe(0);
    const s2 = play('Test Goad Eater', [], []);
    expect(counters(s2, find(s2, 'Test Goad Eater', 'battlefield', 'p1'), '+1/+1')).toBe(0);
  });
});

// ---- Jon Irenicus: "It's goaded for the rest of the game" ---------------------------------------------------------------------------------------------------------------
const GIFT = card('Test Cursed Gift', 'Creature — Wizard', "When ~ enters, target opponent gains control of ~. It's goaded for the rest of the game.", ['2', '2']);
describe("CR 701.15a-c, 611.2a: \"It's goaded for the rest of the game.\" (Jon Irenicus, Shattered One)", () => {
  const start = (): GameState => {
    const s0 = mpScenario({ defs: [GIFT, BEAR], zones: { p1: { hand: ['Test Cursed Gift'], battlefield: ['Test Bear'] }, p2: { battlefield: [] } } });
    return resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Cursed Gift', 'hand', 'p1') }), { targets: [{ kind: 'player', id: 'p2' }] });
  };
  it('is automated', () => expect(full(GIFT)).toBe(true));
  it('the opponent controls it and it must attack, never Alice (the goader), on their turn and on later turns too (the goad does not end at Alice\'s next turn)', () => {
    const s = start();
    const gift = find(s, 'Test Cursed Gift', 'battlefield', 'p1'); // (owner Alice)
    expect(s.objects[gift]!.controller).toBe('p2');
    // advance to Bob's turn (nobody else attacks), and again to his second turn, after Alice's next turn has begun: the goad of the goad action would have ended then
    const toBob = (from: GameState, n: number): GameState => {
      let t = from;
      let bobs = 0;
      for (let i = 0; i < 600; i++) {
        if (t.pending?.kind === 'declareAttackers') {
          if (t.turn.activePlayer === 'p2' && ++bobs >= n) return t;
          t = answer(t, { kind: 'declareAttackers', attacks: t.turn.activePlayer === 'p2' ? [{ attacker: gift, defender: 'p3' }] : [] });
        } else if (t.pending?.kind === 'priority') t = pass(t);
        else t = settle(t);
      }
      throw new Error("never reached Bob's turn");
    };
    const check = (bob: GameState): void => {
      const reqs = requirementsFor(bob, 'attack', 'p2');
      expect(reqs.some((r) => r.creature === gift && r.among === undefined)).toBe(true); // attacks each combat if able
      expect(reqs.some((r) => r.creature === gift && (r.among ?? []).includes('p1'))).toBe(false); // never Alice, the goader
      expect(reqs.some((r) => r.creature === gift && (r.among ?? []).includes('p3'))).toBe(true);
    };
    check(toBob(s, 1));
    const second = toBob(s, 2);
    expect(second.turn.number).toBeGreaterThan(4);
    check(second);
  });
  it('negative: the other creatures are not goaded', () => {
    const s = start();
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p1')]!.goaded).toBeUndefined();
  });
});

// ---- Firkraag: "had to attack this combat" -------------------------------------------------------------------------------------------------------------------------------
const FIRK = card('Test Firk Instigator', 'Legendary Creature — Dragon', 'Whenever a creature deals combat damage to one of your opponents, if that creature had to attack this combat, you put a +1/+1 counter on ~ and you draw a card.', ['3', '3']);
const FORCED = card('Test Forced March', 'Creature — Goblin', 'This creature attacks each combat if able.', ['2', '2']);
describe('CR 508.1d, 603.4: "Whenever a creature deals combat damage to one of your opponents, if that creature had to attack this combat, you put a +1/+1 counter on ~ and you draw a card." (Firkraag, Cunning Instigator)', () => {
  const start = (extra: CardLike[] = [], p2: string[] = []): GameState => mpScenario({ defs: [FIRK, FORCED, BEAR, SEEKER, ...extra], zones: { p1: { battlefield: ['Test Firk Instigator', 'Test Forced March', 'Test Bear'] }, p2: { battlefield: p2 } } });
  type CardLike = ReturnType<typeof card>;
  const handOf = (s: GameState): number => s.zones.hand['p1']!.length;
  const toDamage = (s: GameState): GameState => settle(resolveAll(passUntil(s, (x) => x.turn.step === 'combatDamage' || x.zones.stack.length > 0, 'combat damage'))); // the trigger waits on the stack, then resolves
  it('is automated', () => expect(full(FIRK)).toBe(true));
  it('a creature that had to attack (attacks each combat) deals combat damage to an opponent: one counter and one card; the creature that was free to stay home does not trigger it', () => {
    const s0 = toDeclareAttackers(start());
    const forced = find(s0, 'Test Forced March', 'battlefield', 'p1');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = toDamage(declareAttackers(s0, [[forced, 'p2'], [bear, 'p3']]));
    expect(counters(s, find(s, 'Test Firk Instigator', 'battlefield', 'p1'), '+1/+1')).toBe(1);
    expect(handOf(s)).toBe(handOf(s0) + 1);
  });
  it("negative (ruling 2022-06-10): a creature obeying only a requirement on its controller's whole group did not 'have to attack'", () => {
    // Alice's Forced March must attack on its own; keep it home by tapping it, so the group requirement (Seeker) is what makes the Bear attack
    const s0 = start([], ['Test Slaan Seeker']);
    const s1 = toDeclareAttackers(tweak(s0, (x) => { x.objects[find(x, 'Test Forced March', 'battlefield', 'p1')]!.tapped = true; }));
    const reqs = requirementsFor(s1, 'attack', 'p1');
    expect(reqs.every((r) => r.group !== undefined)).toBe(true);
    const bear = find(s1, 'Test Bear', 'battlefield', 'p1');
    const s = toDamage(declareAttackers(s1, [[bear, 'p3']]));
    expect(counters(s, find(s, 'Test Firk Instigator', 'battlefield', 'p1'), '+1/+1')).toBe(0);
    expect(handOf(s)).toBe(handOf(s0));
  });
});
