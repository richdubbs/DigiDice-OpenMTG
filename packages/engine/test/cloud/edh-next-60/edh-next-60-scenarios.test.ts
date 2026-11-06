/**
 * Commander worker, round edh-next-60 (lane prevent: damage prevention and redirection): the round's readings played through the engine with synthetic cards (invented names,
 * design 6.10). Each group has its negative cases. CR cites checked against the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 614.9           "All damage that would be dealt this turn to you and permanents you control is dealt to the chosen permanent instead."
 *   CR 615.1, 615.5    "If equipped creature would be dealt damage, prevent that damage and put that many +1/+1 counters on it." (and remove / create that many)
 *   CR 615.5, 119.3    "The next time target creature would deal damage this turn, prevent that damage. You gain life equal to the damage prevented this way."
 *   CR 615.1, 510.2    "If ~ would deal combat damage to a creature, prevent that damage and that creature's owner shuffles it into their library."
 *   CR 615.5, 122.1    "..., prevent that damage, remove that many +1/+1 counters from it, then give each player a rad counter for each +1/+1 counter removed this way."
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { act, answer, find, life, pass, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { card, cast, counters, full, named, resolveAll, settle, tokens } from '../cmd3/helpers';

const BURST = card('Test Burst', 'Sorcery', 'Test Burst deals 2 damage to each creature and each player.');
const WALL = card('Test Big Wall', 'Creature — Wall', '', ['0', '9']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '3']);
const OPP_BEAR = card('Test Opp Bear', 'Creature — Bear', '', ['2', '3']);
const dmg = (s: GameState, id: ObjectId): number => s.objects[id]?.damage ?? 0;
const one = (s: GameState, defId: string, player = 'p1'): ObjectId => find(s, defId, 'battlefield', player);

describe('CR 614.9: "All damage that would be dealt this turn to you and permanents you control is dealt to the chosen permanent instead."', () => {
  const PLAY = card('Test Sacrifice Play', 'Instant', "Choose a creature or planeswalker you control. All damage that would be dealt this turn to you and permanents you control is dealt to the chosen permanent instead (if it's still on the battlefield).");
  const game = (): GameState => scenario([], { defs: [PLAY, BURST, WALL, BEAR, OPP_BEAR], p1: { hand: ['Test Sacrifice Play', 'Test Burst'], battlefield: ['Test Big Wall', 'Test Bear'] }, p2: { battlefield: ['Test Opp Bear'] } });
  it('is full', () => expect(full(PLAY)).toBe(true));
  it('the damage to you and to your other permanents goes to the chosen creature; the opponent and their permanents take theirs', () => {
    const s0 = game();
    const wall = one(s0, 'Test Big Wall');
    let s = resolveAll(cast(s0, 'Test Sacrifice Play', { objects: [wall] }));
    s = resolveAll(cast(s, 'Test Burst'));
    expect(life(s, 'p1')).toBe(20); // the damage to you was redirected
    expect(dmg(s, one(s, 'Test Bear'))).toBe(0); // and the damage to the other permanent you control
    expect(dmg(s, wall)).toBe(6); // its own 2, you 2, the Bear 2
    expect(life(s, 'p2')).toBe(18); // not redirected
    expect(dmg(s, one(s, 'Test Opp Bear', 'p2'))).toBe(2);
  });
  it('negative: without the instruction the damage is dealt as usual', () => {
    const s0 = game();
    const s = resolveAll(cast(s0, 'Test Burst'));
    expect(life(s, 'p1')).toBe(18);
    expect(dmg(s, one(s, 'Test Bear'))).toBe(2);
    expect(dmg(s, one(s, 'Test Big Wall'))).toBe(2);
  });
  it('negative: it lasts this turn only', () => {
    const s0 = game();
    const wall = one(s0, 'Test Big Wall');
    let s = resolveAll(cast(s0, 'Test Sacrifice Play', { objects: [wall] }));
    for (let i = 0; i < 400 && !(s.turn.number > s0.turn.number && s.turn.step === 'main1' && s.turn.activePlayer === 'p1'); i++) {
      s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : pass(s);
    }
    expect(s.turn.activePlayer).toBe('p1');
    s = resolveAll(cast(s, 'Test Burst'));
    expect(life(s, 'p1')).toBe(18);
  });
});

describe('CR 614.9: "Until end of turn, all damage that would be dealt to you and creatures you control is dealt to the chosen creature instead." (a target)', () => {
  const PLAY = card('Test Heroic Play', 'Instant', 'Choose target creature you control. Until end of turn, all damage that would be dealt to you and creatures you control is dealt to the chosen creature instead (if it\'s still on the battlefield).');
  it('is full', () => expect(full(PLAY)).toBe(true));
  it('redirects the damage to you and to your creatures to the target', () => {
    const s0 = scenario([], { defs: [PLAY, BURST, WALL, BEAR], p1: { hand: ['Test Heroic Play', 'Test Burst'], battlefield: ['Test Big Wall', 'Test Bear'] } });
    const wall = one(s0, 'Test Big Wall');
    let s = resolveAll(cast(s0, 'Test Heroic Play', { targets: [{ kind: 'object', id: wall }] }));
    s = resolveAll(cast(s, 'Test Burst'));
    expect(life(s, 'p1')).toBe(20);
    expect(dmg(s, one(s, 'Test Bear'))).toBe(0);
    expect(dmg(s, wall)).toBe(6);
    expect(life(s, 'p2')).toBe(18);
  });
});

describe('CR 614.9: "Until your next turn, all damage that would be dealt to creatures you control is dealt to that creature instead." (Ascent of the Worthy wording)', () => {
  const PLAY = card('Test Ascent Play', 'Sorcery', 'Choose a creature you control. Until your next turn, all damage that would be dealt to creatures you control is dealt to that creature instead.');
  it('is full', () => expect(full(PLAY)).toBe(true));
  it('redirects the damage to your creatures (not to you) to the chosen creature', () => {
    const s0 = scenario([], { defs: [PLAY, BURST, WALL, BEAR], p1: { hand: ['Test Ascent Play', 'Test Burst'], battlefield: ['Test Big Wall', 'Test Bear'] } });
    const wall = one(s0, 'Test Big Wall');
    let s = resolveAll(cast(s0, 'Test Ascent Play', { objects: [wall] }));
    s = resolveAll(cast(s, 'Test Burst'));
    expect(life(s, 'p1')).toBe(18); // you are not a creature you control
    expect(dmg(s, one(s, 'Test Bear'))).toBe(0);
    expect(dmg(s, wall)).toBe(4); // its own 2 and the Bear's 2
  });
});

describe('CR 615.1, 615.5: "If enchanted creature would be dealt damage, prevent that damage and put that many +1/+1 counters on it."', () => {
  const HABIT = card('Test Panther Habit', 'Enchantment — Aura', 'If enchanted creature would be dealt damage, prevent that damage and put that many +1/+1 counters on it.');
  const game = (): GameState => {
    const s = scenario([], { defs: [HABIT, BURST, BEAR, OPP_BEAR], p1: { hand: ['Test Burst'], battlefield: ['Test Bear', 'Test Panther Habit'] }, p2: { battlefield: ['Test Opp Bear'] } });
    s.objects[one(s, 'Test Panther Habit')]!.attachedTo = one(s, 'Test Bear');
    return s;
  };
  it('is full', () => expect(full(HABIT)).toBe(true));
  it('the enchanted creature takes no damage and gets that many +1/+1 counters', () => {
    const s = resolveAll(cast(game(), 'Test Burst'));
    const bear = one(s, 'Test Bear');
    expect(dmg(s, bear)).toBe(0);
    expect(counters(s, bear, '+1/+1')).toBe(2);
  });
  it('negative: another creature is dealt its damage and gets no counters', () => {
    const s = resolveAll(cast(game(), 'Test Burst'));
    const opp = one(s, 'Test Opp Bear', 'p2');
    expect(dmg(s, opp)).toBe(2);
    expect(counters(s, opp, '+1/+1')).toBe(0);
  });
});

describe('CR 615.1, 615.5: "If damage would be dealt to ~, prevent that damage, remove that many +1/+1 counters from ~, and create that many 1/1 colorless Spirit creature tokens."', () => {
  const SEKI = card('Test Seki', 'Creature — Spirit', 'If damage would be dealt to ~, prevent that damage, remove that many +1/+1 counters from ~, and create that many 1/1 colorless Spirit creature tokens.', ['1', '1']);
  const game = (n: number): GameState => scenario([], { defs: [SEKI, BURST], p1: { hand: ['Test Burst'], battlefield: [{ name: 'Test Seki', counters: { '+1/+1': n } }] } });
  it('is full', () => expect(full(SEKI)).toBe(true));
  it('damage 2 with four counters: two counters removed, two Spirit tokens, no damage', () => {
    const s = resolveAll(cast(game(4), 'Test Burst'));
    const seki = one(s, 'Test Seki');
    expect(dmg(s, seki)).toBe(0);
    expect(counters(s, seki, '+1/+1')).toBe(2);
    expect(tokens(s).length).toBe(2);
  });
  it('damage 2 with one counter: all (one) counter removed, still two tokens (that many = the damage prevented)', () => {
    const s = resolveAll(cast(game(1), 'Test Burst'));
    expect(counters(s, find(s, 'Test Seki', 'battlefield', 'p1'), '+1/+1')).toBe(0);
    expect(tokens(s).length).toBe(2);
  });
  it('negative: damage to another permanent makes no tokens', () => {
    const s0 = scenario([], { defs: [SEKI, BURST, OPP_BEAR], p1: { hand: ['Test Burst'], battlefield: [{ name: 'Test Seki', counters: { '+1/+1': 4 } }] }, p2: { battlefield: ['Test Opp Bear'] } });
    const s = resolveAll(cast(s0, 'Test Burst'));
    expect(dmg(s, one(s, 'Test Opp Bear', 'p2'))).toBe(2);
    expect(counters(s, one(s, 'Test Seki'), '+1/+1')).toBe(2);
    expect(tokens(s).length).toBe(2);
  });
});

describe('CR 615.5, 122.1: "..., prevent that damage, remove that many +1/+1 counters from it, then give each player a rad counter for each +1/+1 counter removed this way."', () => {
  const FLY = card('Test Rad Swarm', 'Creature — Insect', 'If damage would be dealt to ~ while it has a +1/+1 counter on it, prevent that damage, remove that many +1/+1 counters from it, then give each player a rad counter for each +1/+1 counter removed this way.', ['1', '1']);
  const rad = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.counters['rad'] ?? 0;
  it('is full', () => expect(full(FLY)).toBe(true));
  it('damage 2 with five counters: two counters removed and each player gets two rad counters', () => {
    const s0 = scenario([], { defs: [FLY, BURST], p1: { hand: ['Test Burst'], battlefield: [{ name: 'Test Rad Swarm', counters: { '+1/+1': 5 } }] } });
    const s = resolveAll(cast(s0, 'Test Burst'));
    const fly = one(s, 'Test Rad Swarm');
    expect(dmg(s, fly)).toBe(0);
    expect(counters(s, fly, '+1/+1')).toBe(3);
    expect(rad(s, 'p1')).toBe(2);
    expect(rad(s, 'p2')).toBe(2);
  });
  it('negative: with no counter the damage is dealt and no rad counters are given', () => {
    const s0 = scenario([], { defs: [FLY, BURST], p1: { hand: ['Test Burst'], battlefield: ['Test Rad Swarm'] } });
    const s = resolveAll(cast(s0, 'Test Burst'));
    expect(rad(s, 'p1')).toBe(0);
    expect(rad(s, 'p2')).toBe(0);
  });
  it('damage 2 with one counter: one counter removed, one rad counter each (the counters really removed)', () => {
    const s0 = scenario([], { defs: [FLY, BURST], p1: { hand: ['Test Burst'], battlefield: [{ name: 'Test Rad Swarm', counters: { '+1/+1': 1 } }] } });
    const s = resolveAll(cast(s0, 'Test Burst'));
    expect(counters(s, one(s, 'Test Rad Swarm'), '+1/+1')).toBe(0);
    expect(rad(s, 'p1')).toBe(1);
    expect(rad(s, 'p2')).toBe(1);
  });
});

describe('CR 615.5, 119.3: "The next time target creature would deal damage this turn, prevent that damage. You gain life equal to the damage prevented this way."', () => {
  const AWE = card('Test Awe Play', 'Instant', 'The next time target creature would deal damage this turn, prevent that damage. You gain life equal to the damage prevented this way.');
  const game = (): GameState => scenario([], { defs: [AWE, BEAR, OPP_BEAR], p1: { hand: ['Test Awe Play'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Opp Bear'] } });
  const attack = (s: GameState): GameState => {
    let t = declareAttackers(toDeclareAttackers(s), [[one(s, 'Test Bear')]]);
    t = passUntil(t, (x) => x.turn.step === 'main2' || x.pending?.kind === 'declareBlockers', 'blockers or main2', 80);
    if (t.pending?.kind === 'declareBlockers') t = declareBlockers(t, []);
    return passUntil(t, (x) => x.turn.step === 'main2', 'main2', 80);
  };
  it('is full', () => expect(full(AWE)).toBe(true));
  it('the attacker\'s combat damage is prevented and you gain that much life', () => {
    const s0 = game();
    let s = resolveAll(cast(s0, 'Test Awe Play', { targets: [{ kind: 'object', id: one(s0, 'Test Bear') }] }));
    s = attack(s);
    expect(life(s, 'p2')).toBe(20);
    expect(life(s, 'p1')).toBe(22);
  });
  it('negative: aimed at another creature, the attacker\'s damage is dealt and no life is gained', () => {
    const s0 = game();
    let s = resolveAll(cast(s0, 'Test Awe Play', { targets: [{ kind: 'object', id: one(s0, 'Test Opp Bear', 'p2') }] }));
    s = attack(s);
    expect(life(s, 'p2')).toBe(18);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 615.1, 510.2, 701.24a: "If ~ would deal combat damage to a creature, prevent that damage and that creature\'s owner shuffles it into their library."', () => {
  const ANGEL = card('Test Weeping Statue', 'Creature — Angel', "If ~ would deal combat damage to a creature, prevent that damage and that creature's owner shuffles it into their library.", ['2', '4']);
  const game = (): GameState => scenario([], { defs: [ANGEL, OPP_BEAR], p1: { battlefield: ['Test Weeping Statue'] }, p2: { battlefield: ['Test Opp Bear'] } });
  const fight = (s: GameState, block: boolean): GameState => {
    let t = declareAttackers(toDeclareAttackers(s), [[one(s, 'Test Weeping Statue')]]);
    t = toDeclareBlockers(t);
    t = declareBlockers(t, block ? [[one(s, 'Test Opp Bear', 'p2'), one(s, 'Test Weeping Statue')]] : []);
    return passUntil(t, (x) => x.turn.step === 'main2', 'main2', 80);
  };
  it('is full', () => expect(full(ANGEL)).toBe(true));
  it('a creature the Statue would deal combat damage to is shuffled into its owner\'s library instead of being dealt damage', () => {
    const s0 = game();
    const s = fight(s0, true);
    expect(named(s, 'Test Opp Bear').length).toBe(0);
    expect((s.zones.graveyard['p2'] ?? []).some((id) => s.objects[id]!.defId === 'Test Opp Bear')).toBe(false);
    expect((s.zones.library['p2'] ?? []).some((id) => s.objects[id]!.defId === 'Test Opp Bear')).toBe(true);
    expect(dmg(s, one(s, 'Test Weeping Statue'))).toBe(2); // the Bear's damage to the Statue is dealt
  });
  it('negative: combat damage to a player is dealt', () => {
    const s = fight(game(), false);
    expect(life(s, 'p2')).toBe(18);
  });
});

describe('CR 615.1, 615.5: "Choose target creature you control. If damage would be dealt to that creature this turn, prevent that damage and put that many +1/+1 counters on it."', () => {
  const GUARD = card('Test Guard Play', 'Instant', 'Choose target creature you control. If damage would be dealt to that creature this turn, prevent that damage and put that many +1/+1 counters on it.');
  const game = (): GameState => scenario([], { defs: [GUARD, BURST, BEAR, WALL], p1: { hand: ['Test Guard Play', 'Test Burst'], battlefield: ['Test Bear', 'Test Big Wall'] } });
  it('is full', () => expect(full(GUARD)).toBe(true));
  it('the chosen creature takes no damage and gets that many +1/+1 counters; another creature is dealt its damage', () => {
    const s0 = game();
    let s = resolveAll(cast(s0, 'Test Guard Play', { targets: [{ kind: 'object', id: one(s0, 'Test Bear') }] }));
    s = resolveAll(cast(s, 'Test Burst'));
    expect(dmg(s, one(s, 'Test Bear'))).toBe(0);
    expect(counters(s, one(s, 'Test Bear'), '+1/+1')).toBe(2);
    expect(dmg(s, one(s, 'Test Big Wall'))).toBe(2);
    expect(counters(s, one(s, 'Test Big Wall'), '+1/+1')).toBe(0);
  });
  it('negative: without the instruction the damage is dealt', () => {
    const s = resolveAll(cast(game(), 'Test Burst'));
    expect(dmg(s, one(s, 'Test Bear'))).toBe(2);
    expect(counters(s, one(s, 'Test Bear'), '+1/+1')).toBe(0);
  });
});

describe('CR 615.5, 510.2: "The next time target creature would deal combat damage to one or more players this combat, prevent that damage. If damage is prevented this way, create that many 1/1 ... tokens."', () => {
  const MITE = card('Test Mite Play', 'Instant', 'The next time target creature would deal combat damage to one or more players this combat, prevent that damage. If damage is prevented this way, create that many 1/1 colorless Phyrexian Mite artifact creature tokens.');
  it('is full', () => expect(full(MITE)).toBe(true));
  it('the attacker\'s combat damage to the player is prevented and that many Mites are created', () => {
    const s0 = scenario([], { defs: [MITE, BEAR], p1: { hand: ['Test Mite Play'], battlefield: ['Test Bear'] } });
    let t = declareAttackers(toDeclareAttackers(s0), [[one(s0, 'Test Bear')]]);
    t = settle(t);
    t = resolveAll(cast(t, 'Test Mite Play', { targets: [{ kind: 'object', id: one(s0, 'Test Bear') }] }));
    t = passUntil(t, (x) => x.turn.step === 'main2' || x.pending?.kind === 'declareBlockers', 'blockers or main2', 80);
    if (t.pending?.kind === 'declareBlockers') t = declareBlockers(t, []);
    t = passUntil(t, (x) => x.turn.step === 'main2', 'main2', 80);
    expect(life(t, 'p2')).toBe(20);
    expect(tokens(t).length).toBe(2);
  });
  it('negative: without it the damage is dealt and no tokens appear', () => {
    const s0 = scenario([], { defs: [MITE, BEAR], p1: { battlefield: ['Test Bear'] } });
    let t = declareAttackers(toDeclareAttackers(s0), [[one(s0, 'Test Bear')]]);
    t = passUntil(t, (x) => x.turn.step === 'main2' || x.pending?.kind === 'declareBlockers', 'blockers or main2', 80);
    if (t.pending?.kind === 'declareBlockers') t = declareBlockers(t, []);
    t = passUntil(t, (x) => x.turn.step === 'main2', 'main2', 80);
    expect(life(t, 'p2')).toBe(18);
    expect(tokens(t).length).toBe(0);
  });
});

describe('CR 615.1, 615.5, 603.12: "Prevent all damage that would be dealt to you this turn by sources your opponents control. Whenever damage from a creature is prevented this way, each Soldier you control deals damage equal to its power to that creature."', () => {
  const JUDGE = card('Test Judgment Play', 'Instant', 'Prevent all damage that would be dealt to you this turn by sources your opponents control. Whenever damage from a creature is prevented this way, each Soldier you control deals damage equal to its power to that creature.');
  const SOLDIER = card('Test Soldier', 'Creature — Soldier', '', ['3', '3']);
  const PINGER = card('Test Pinger', 'Creature — Wizard', '{0}: ~ deals 1 damage to target player.', ['1', '9']);
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 2 damage to target player.');
  const game = (): GameState => scenario([], { defs: [JUDGE, SOLDIER, PINGER, ZAP], p1: { hand: ['Test Judgment Play'], battlefield: ['Test Soldier'] }, p2: { hand: ['Test Zap'], battlefield: ['Test Pinger'] } });
  it('is full', () => expect(full(JUDGE)).toBe(true));
  it('a creature of the opponent\'s that would deal damage to you is prevented and the Soldier hits it back', () => {
    const s0 = game();
    let s = resolveAll(cast(s0, 'Test Judgment Play'));
    const pinger = one(s, 'Test Pinger', 'p2');
    s = pass(s); // p1 passes the main phase's priority; p2 acts
    s = act2(s, pinger);
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(20);
    expect(dmg(s, pinger)).toBe(3); // the Soldier's power
  });
  it('negative: damage that can\'t be prevented is not prevented, so nothing is dealt back', () => {
    const PING = card('Test Hard Pinger', 'Creature — Wizard', "{0}: ~ deals 1 damage to target player. The damage can't be prevented.", ['1', '9']);
    const s0 = scenario([], { defs: [JUDGE, SOLDIER, PING], p1: { hand: ['Test Judgment Play'], battlefield: ['Test Soldier'] }, p2: { battlefield: ['Test Hard Pinger'] } });
    let s = resolveAll(cast(s0, 'Test Judgment Play'));
    const pinger = one(s, 'Test Hard Pinger', 'p2');
    s = resolveAll(act2(pass(s), pinger));
    expect(life(s, 'p1')).toBe(19);
    expect(dmg(s, pinger)).toBe(0);
  });
  it('negative: damage from a noncreature source of the opponent is prevented but nothing is dealt back; your own damage is not prevented', () => {
    const s0 = game();
    let s = resolveAll(cast(s0, 'Test Judgment Play'));
    s = pass(s);
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Zap', 'hand', 'p2') }), { targets: [{ kind: 'player', id: 'p1' }] });
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(20);
    expect(dmg(s, one(s, 'Test Pinger', 'p2'))).toBe(0);
  });
});
const act2 = (s: GameState, source: ObjectId): GameState => settle(act(s, { type: 'activate', player: 'p2', source, ability: 'p:0:0' } as never), { targets: [{ kind: 'player', id: 'p1' }] });

describe('CR 614.9, 611.2a: "When this Aura enters, all damage that would be dealt this turn to you and permanents you control is dealt to enchanted creature instead." (Saving Grace)', () => {
  const GRACE = card('Test Saving Aura', 'Enchantment — Aura', 'Enchant creature you control\nWhen this Aura enters, all damage that would be dealt this turn to you and permanents you control is dealt to enchanted creature instead.\nEnchanted creature gets +0/+3.');
  const SMITE = card('Test Smite', 'Instant', 'Destroy target Aura.');
  const game = (): GameState => scenario([], { defs: [GRACE, SMITE, BURST, WALL, BEAR], p1: { hand: ['Test Saving Aura', 'Test Smite', 'Test Burst'], battlefield: ['Test Big Wall', 'Test Bear'] } });
  it('is full', () => expect(full(GRACE)).toBe(true));
  it('the damage to you and to your other permanents is dealt to the enchanted creature', () => {
    const s0 = game();
    const wall = one(s0, 'Test Big Wall');
    let s = resolveAll(cast(s0, 'Test Saving Aura', { targets: [{ kind: 'object', id: wall }] }));
    s = resolveAll(cast(s, 'Test Burst'));
    expect(life(s, 'p1')).toBe(20);
    expect(dmg(s, one(s, 'Test Bear'))).toBe(0);
    expect(dmg(s, wall)).toBe(6);
  });
  it('the redirection goes on after the Aura leaves the battlefield (ruling 2017-07-14)', () => {
    const s0 = game();
    const wall = one(s0, 'Test Big Wall');
    let s = resolveAll(cast(s0, 'Test Saving Aura', { targets: [{ kind: 'object', id: wall }] }));
    s = resolveAll(cast(s, 'Test Smite', { targets: [{ kind: 'object', id: one(s, 'Test Saving Aura') }] }));
    expect(named(s, 'Test Saving Aura').length).toBe(0);
    s = resolveAll(cast(s, 'Test Burst'));
    expect(life(s, 'p1')).toBe(20);
    expect(dmg(s, wall)).toBe(6);
  });
});

describe('CR 614.12, 614.1c, 702.138c: "~ enters with six +1/+1 counters on it. It escapes with twelve +1/+1 counters on it instead." (Polukranos, Unchained)', () => {
  const HYDRA = card('Test Hydra Rex', 'Creature — Hydra', '~ enters with six +1/+1 counters on it. It escapes with twelve +1/+1 counters on it instead.\nEscape—{0}, Exile two other cards from your graveyard.', ['0', '0']);
  const FODDER = card('Test Fodder', 'Sorcery', 'You gain 1 life.');
  it('is full', () => expect(full(HYDRA)).toBe(true));
  it('cast from the hand it enters with six counters', () => {
    const s0 = scenario([], { defs: [HYDRA], p1: { hand: ['Test Hydra Rex'] } });
    const s = resolveAll(cast(s0, 'Test Hydra Rex'));
    expect(counters(s, one(s, 'Test Hydra Rex'), '+1/+1')).toBe(6);
  });
  it('cast with escape it enters with twelve counters', () => {
    const s0 = scenario([], { defs: [HYDRA, FODDER], p1: { graveyard: ['Test Hydra Rex', 'Test Fodder', 'Test Fodder'] } });
    const fodder = (s0.zones.graveyard['p1'] ?? []).filter((id) => s0.objects[id]!.defId === 'Test Fodder');
    const s = resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Hydra Rex', 'graveyard', 'p1'), method: 'escape' } as never), { objects: fodder }), { objects: fodder });
    expect(counters(s, one(s, 'Test Hydra Rex'), '+1/+1')).toBe(12);
  });
});
