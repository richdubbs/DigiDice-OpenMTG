/**
 * Top-rank round edh-next-84 (code edhn84): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names,
 * design 6.10). Each test is named after the rule it checks, with its negative case. CR cites are from memory of the 2026-09-25 text (no rules/cr folder in this session): unverified.
 *
 *   CR 122.1, 603.10a, 608.2h      "... if it had one or more counters on it, you may put that number of +1/+1 counters on target creature." (Yuna, Grand Summoner)
 *   CR 608.2h, 109.2               "Other Rats you control get +X/+X until end of turn, where X is the number of Rats you control." (Ashcoat of the Shadow Swarm)
 *   CR 506.3, 508.1b, 508.5        "Whenever one or more creatures attack, you may pay {1}{R}. If you do, creatures attacking your opponents and/or planeswalkers they control get +2/+0 until end of turn." (Roar of Resistance)
 *   CR 509.1b, 611.2a, 602.2b      "{3}, {T}: Up to X target creatures you control each gain haste until end of turn and can't be blocked this turn except by creatures with haste, where X is the number of Bobbleheads you control as you activate this ability." (Agility Bobblehead)
 *   CR 115.1, 601.2c, 110.2        "Destroy any number of target tapped creatures with different controllers." (Cloud's Limit Break)
 *   CR 202.3, 608.2h, 400.7        "Return target spell or nonland permanent an opponent controls to its owner's hand. You may cast an instant or sorcery spell with equal or lesser mana value from your hand without paying its mana cost." (Press the Enemy)
 */
import { describe, expect, it } from 'vitest';
import { getChars } from '../../../src/index';
import type { GameState, ObjectId } from '../../../src/index';
import { pass } from '../../m3/scenario';
import { act, advanceTo, answer, card, cast, find, full, legal, named, obj, resolveAll, scenario } from '../r4-cost/support';
import { declareAttackers, declareBlockers, lifeOf, passUntil, toDeclareAttackers, toDeclareBlockers, tweak } from '../../m4/helpers';
import type { PlayerId } from '../../../src/index';

const power = (s: GameState, id: ObjectId): number => Number(getChars(s, id)!.power);
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]!.counters[kind] ?? 0;

// ---- Yuna, Grand Summoner ---------------------------------------------------------------------------------------------------------------------------------
describe('CR 122.1, 603.10a, 608.2h: "Whenever another permanent you control is put into a graveyard from the battlefield, if it had one or more counters on it, you may put that number of +1/+1 counters on target creature."', () => {
  const ECHO = card('Test Echo', 'Creature — Spirit', 'Whenever another permanent you control is put into a graveyard from the battlefield, if it had one or more counters on it, you may put that number of +1/+1 counters on target creature.', '{1}', ['1', '1']);
  const CHARGED = card('Test Charged Relic', 'Artifact', '', '{1}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const KILL = card('Test Kill', 'Instant', 'Destroy target artifact.', '{1}');
  const defs = [ECHO, CHARGED, BEAR, KILL];
  const board = (relicCounters: Record<string, number>, owner: 'p1' | 'p2' = 'p1'): GameState => {
    const s = scenario([], { defs, p1: { hand: ['Test Kill'], battlefield: ['Test Echo', 'Test Bear', 'Plains', ...(owner === 'p1' ? ['Test Charged Relic'] : [])] }, ...(owner === 'p2' ? { p2: { battlefield: ['Test Charged Relic'] } } : {}) });
    const relic = find(s, 'Test Charged Relic', 'battlefield', owner);
    s.objects[relic]!.counters = { ...relicCounters };
    return s;
  };
  const kill = (s0: GameState, yes: boolean, target: ObjectId): GameState => {
    const relic = s0.zones.battlefield.find((id) => s0.objects[id]!.defId === 'Test Charged Relic')!;
    const s1 = cast(s0, 'Test Kill', { targets: [[obj(relic)]] });
    return resolveAll(s1, { yes: [yes], targets: [[obj(target)]] });
  };
  it('is full', () => expect(full(ECHO), JSON.stringify(ECHO.automation)).toBe(true));
  it('counts the counters of every kind the permanent had (ruling 2025-06-06) and puts that many +1/+1 counters on the target creature', () => {
    const s0 = board({ '+1/+1': 2, charge: 1 });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = kill(s0, true, bear);
    expect(counters(s, bear)).toBe(3);
    expect(power(s, bear)).toBe(5);
  });
  it('negative: declining the "may" puts nothing', () => {
    const s0 = board({ charge: 2 });
    const bear = find(s0, 'Test Bear', 'battlefield');
    expect(counters(kill(s0, false, bear), bear)).toBe(0);
  });
  it('negative: a permanent with no counters does not trigger it', () => {
    const s0 = board({});
    const bear = find(s0, 'Test Bear', 'battlefield');
    expect(counters(kill(s0, true, bear), bear)).toBe(0);
  });
  it('negative: a permanent an opponent controls does not trigger it', () => {
    const s0 = board({ charge: 3 }, 'p2');
    const bear = find(s0, 'Test Bear', 'battlefield');
    expect(counters(kill(s0, true, bear), bear)).toBe(0);
  });
});

// ---- Ashcoat of the Shadow Swarm --------------------------------------------------------------------------------------------------------------------------
describe('CR 608.2h, 109.2: "Whenever this creature attacks, other Rats you control get +X/+X until end of turn, where X is the number of Rats you control."', () => {
  const LEAD = card('Test Rat Lead', 'Creature — Rat Warlock', 'Whenever this creature attacks, other Rats you control get +X/+X until end of turn, where X is the number of Rats you control.', '{1}', ['2', '2']);
  const RAT = card('Test Rat', 'Creature — Rat', '', '{1}', ['1', '1']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const defs = [LEAD, RAT, BEAR];
  it('is full', () => expect(full(LEAD), JSON.stringify(LEAD.automation)).toBe(true));
  it('X counts every Rat you control, the source included; only the other Rats get the bonus', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Rat Lead', 'Test Rat', 'Test Rat', 'Test Bear'] } });
    const lead = find(s0, 'Test Rat Lead', 'battlefield');
    const rats = named(s0, 'Test Rat');
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = resolveAll(attackWith1(s0, lead));
    expect(power(s, lead)).toBe(2);
    for (const r of rats) expect(power(s, r)).toBe(1 + 3);
    expect(power(s, bear)).toBe(2);
  });
  it('negative: with no other Rat nothing changes (X would be 1, but no creature is in the group)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Rat Lead', 'Test Bear'] } });
    const lead = find(s0, 'Test Rat Lead', 'battlefield');
    const s = resolveAll(attackWith1(s0, lead));
    expect(power(s, lead)).toBe(2);
    expect(power(s, find(s0, 'Test Bear', 'battlefield'))).toBe(2);
  });
});

/** p1 declares `attacker` against p2 and stops with the attack trigger on the stack. */
function attackWith1(s0: GameState, attacker: ObjectId, at?: ObjectId): GameState {
  const s = declareAttackers(toDeclareAttackers(s0), [at === undefined ? [attacker] : [attacker, at]]);
  return passUntil(s, (x) => x.zones.stack.length > 0 || x.pending?.kind === 'declareBlockers', 'the attack trigger');
}

// ---- Roar of Resistance -----------------------------------------------------------------------------------------------------------------------------------
describe('CR 506.3, 508.1b, 508.5: "Whenever one or more creatures attack, you may pay {1}{R}. If you do, creatures attacking your opponents and/or planeswalkers they control get +2/+0 until end of turn."', () => {
  const ROAR = card('Test Roar', 'Enchantment', 'Whenever one or more creatures attack, you may pay {1}{R}. If you do, creatures attacking your opponents and/or planeswalkers they control get +2/+0 until end of turn.', '{1}');
  const RAIDER = card('Test Raider', 'Creature — Goblin', '', '{1}', ['2', '2']);
  const WALKER = card('Test Walker', 'Planeswalker — Test', '', '{1}');
  const defs = [ROAR, RAIDER, WALKER];
  const board = (): GameState => scenario(['Mountain'], { defs, p1: { battlefield: ['Test Roar', 'Test Raider', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Test Raider', { name: 'Test Walker', counters: { loyalty: 5 } }, 'Mountain', 'Mountain'] } });
  const resolveTrigger = (s: GameState, yes: boolean): GameState => resolveAll(s, { yes: [yes] });
  it('is full', () => expect(full(ROAR), JSON.stringify(ROAR.automation)).toBe(true));
  it('paying: an attacker of yours attacking an opponent gets +2/+0 this turn', () => {
    const s0 = board();
    const raider = find(s0, 'Test Raider', 'battlefield', 'p1');
    const s = resolveTrigger(attackWith1(s0, raider), true);
    expect(power(s, raider)).toBe(4);
  });
  it('paying: an attacker attacking a planeswalker an opponent controls gets +2/+0 too', () => {
    const s0 = board();
    const raider = find(s0, 'Test Raider', 'battlefield', 'p1');
    const walker = find(s0, 'Test Walker', 'battlefield', 'p2');
    const s = resolveTrigger(attackWith1(s0, raider, walker), true);
    expect(power(s, raider)).toBe(4);
  });
  it('negative: declining to pay gives no bonus', () => {
    const s0 = board();
    const raider = find(s0, 'Test Raider', 'battlefield', 'p1');
    expect(power(resolveTrigger(attackWith1(s0, raider), false), raider)).toBe(2);
  });
  it('negative: a creature attacking you (the opponent attacks you, on their own turn) gets no bonus, even if you pay', () => {
    const s0 = advanceTo(board(), 2, 'main1');
    expect(s0.turn.activePlayer).toBe('p2');
    const mine = find(s0, 'Test Raider', 'battlefield', 'p2');
    const s = resolveTrigger(attackWith1(s0, mine), true);
    expect(power(s, mine)).toBe(2);
  });
  it('negative: a creature of yours that does not attack is not in the group', () => {
    const s0 = scenario(['Mountain'], { defs, p1: { battlefield: ['Test Roar', 'Test Raider', 'Test Raider', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Test Raider'] } });
    const [a, b] = named(s0, 'Test Raider').filter((id) => s0.objects[id]!.controller === 'p1');
    const s = resolveTrigger(attackWith1(s0, a!), true);
    expect(power(s, a!)).toBe(4);
    expect(power(s, b!)).toBe(2);
  });
});

// ---- Agility Bobblehead -----------------------------------------------------------------------------------------------------------------------------------
describe('CR 509.1b, 611.2a, 602.2b: "{3}, {T}: Up to X target creatures you control each gain haste until end of turn and can\'t be blocked this turn except by creatures with haste, where X is the number of Bobbleheads you control as you activate this ability."', () => {
  const HEAD = card('Test Bobble', 'Artifact — Bobblehead', "{3}, {T}: Up to X target creatures you control each gain haste until end of turn and can't be blocked this turn except by creatures with haste, where X is the number of Bobbleheads you control as you activate this ability.", '{3}');
  const RUNNER = card('Test Runner', 'Creature — Elf', '', '{1}', ['2', '2']);
  const HASTY = card('Test Hasty Guard', 'Creature — Elf', 'Haste', '{1}', ['2', '2']);
  const SLOW = card('Test Slow Guard', 'Creature — Elf', '', '{1}', ['2', '2']);
  const defs = [HEAD, RUNNER, HASTY, SLOW];
  const activate = (s: GameState, targets: ObjectId[]): GameState => {
    const a = legal(s, 'p1', 'activate').find((x) => x.object === find(s, 'Test Bobble', 'battlefield') && x.isMana !== true);
    if (a === undefined) throw new Error('the ability is not offered');
    let t = act(s, a.action);
    for (let i = 0; i < 6; i++) {
      const p = t.pending;
      if (p === null || p.kind === 'priority') break;
      if (p.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: targets.map(obj) });
      else if (p.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
      else if (p.kind === 'chooseNumber') t = answer(t, { kind: 'chooseNumber', n: targets.length });
      else break;
    }
    return resolveAll(t);
  };
  it('is full', () => expect(full(HEAD), JSON.stringify(HEAD.automation)).toBe(true));
  it('the chosen creature gains haste and can be blocked only by creatures with haste: the guard with haste may block it, the one without may not', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Bobble', 'Test Runner', 'Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Hasty Guard', 'Test Slow Guard'] } });
    const runner = find(s0, 'Test Runner', 'battlefield');
    const s = activate(s0, [runner]);
    expect(getChars(s, runner)!.keywords.some((k) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword) === 'haste')).toBe(true);
    const a = declareAttackers(toDeclareAttackers(s), [[runner]]);
    const b = toDeclareBlockers(a);
    const hasty = find(s0, 'Test Hasty Guard', 'battlefield', 'p2');
    const slow = find(s0, 'Test Slow Guard', 'battlefield', 'p2');
    // the blocker without haste is rejected; the one with haste may block
    expect(() => declareBlockers(b, [[slow, runner]])).toThrow();
    expect(declareBlockers(b, [[hasty, runner]]).pending?.kind ?? 'ok').not.toBe('declareBlockers');
  });
  it('negative: a creature that was not chosen can still be blocked by a creature without haste', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Bobble', 'Test Runner', 'Test Runner', 'Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Slow Guard'] } });
    const [chosen, other] = named(s0, 'Test Runner');
    const s = activate(s0, [chosen!]);
    const a = declareAttackers(toDeclareAttackers(tweak(s, (t) => { for (const id of [chosen!, other!]) t.objects[id]!.controlledSinceTurn = 0; })), [[other!]]);
    const b = toDeclareBlockers(a);
    const slow = find(s0, 'Test Slow Guard', 'battlefield', 'p2');
    expect(declareBlockers(b, [[slow, other!]]).pending?.kind ?? 'ok').not.toBe('declareBlockers');
  });
  it('X is the number of Bobbleheads as the ability is activated: with two Bobbleheads two creatures may be chosen, with one only one', () => {
    const two = scenario([], { defs, p1: { battlefield: ['Test Bobble', 'Test Bobble', 'Test Runner', 'Test Runner', 'Plains', 'Plains', 'Plains'] } });
    const [r1, r2] = named(two, 'Test Runner');
    const sTwo = activate(two, [r1!, r2!]);
    for (const r of [r1!, r2!]) expect(getChars(sTwo, r)!.keywords.length).toBeGreaterThan(0);
    const one = scenario([], { defs, p1: { battlefield: ['Test Bobble', 'Test Runner', 'Test Runner', 'Plains', 'Plains', 'Plains'] } });
    const [q1, q2] = named(one, 'Test Runner');
    const a = legal(one, 'p1', 'activate').find((x) => x.object === find(one, 'Test Bobble', 'battlefield') && x.isMana !== true)!;
    let t = act(one, a.action);
    for (let i = 0; i < 6; i++) {
      const p = t.pending;
      if (p === null || p.kind === 'priority') break;
      if (p.kind === 'chooseTargets') { expect(() => answer(t, { kind: 'chooseTargets', targets: [obj(q1!), obj(q2!)] })).toThrow(); break; }
      else if (p.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
      else if (p.kind === 'chooseNumber') t = answer(t, { kind: 'chooseNumber', n: 1 });
      else break;
    }
  });
});

// ---- Cloud's Limit Break ----------------------------------------------------------------------------------------------------------------------------------
describe('CR 115.1, 601.2c, 110.2: "Destroy any number of target tapped creatures with different controllers." (a tiered mode)', () => {
  const LIMIT = card('Test Limit Slash', 'Instant', 'Tiered\n• Cross -- {0} -- Destroy target tapped creature.\n• Beam -- {1} -- Destroy any number of target tapped creatures with different controllers.\n• Wave -- {3} -- Destroy all tapped creatures.', '{1}{W}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const defs = [LIMIT, BEAR];
  const board = (): GameState => {
    const s = scenario([], { defs, p1: { hand: ['Test Limit Slash'], battlefield: ['Plains', 'Plains', 'Plains', { name: 'Test Bear', tapped: true }, { name: 'Test Bear', tapped: true }] }, p2: { battlefield: [{ name: 'Test Bear', tapped: true }, { name: 'Test Bear', tapped: true }, 'Test Bear'] } });
    return s;
  };
  const mine = (s: GameState): ObjectId[] => named(s, 'Test Bear').filter((id) => s.objects[id]!.controller === 'p1');
  const theirs = (s: GameState): ObjectId[] => named(s, 'Test Bear').filter((id) => s.objects[id]!.controller === 'p2');
  it('is full', () => expect(full(LIMIT), JSON.stringify(LIMIT.automation)).toBe(true));
  it('destroys one tapped creature of each controller chosen together, and no more', () => {
    const s0 = board();
    const [m1] = mine(s0);
    const [t1, t2] = theirs(s0).filter((id) => s0.objects[id]!.tapped);
    const s = resolveAll(cast(s0, 'Test Limit Slash', { options: [['1']], targets: [[obj(m1!), obj(t1!)]] }), { targets: [[obj(m1!), obj(t1!)]] });
    expect(s.objects[t2!]!.zone).toBe('battlefield'); // the second tapped creature of the same controller is not a target
    expect(mine(s).length).toBe(1);
    expect(theirs(s).length).toBe(2);
    expect(s.zones.graveyard.p1!.filter((id) => s.objects[id]!.defId === 'Test Bear').length).toBe(1);
    expect(s.zones.graveyard.p2!.filter((id) => s.objects[id]!.defId === 'Test Bear').length).toBe(1);
  });
  it('negative: two targets with one controller are refused when the targets are announced (the choice is asked again)', () => {
    const s0 = board();
    const [t1, t2] = theirs(s0).filter((id) => s0.objects[id]!.tapped);
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Limit Slash', 'hand') });
    for (let i = 0; i < 6 && s.pending?.kind !== 'chooseTargets'; i++) {
      if (s.pending?.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: ['1'] });
      else break;
    }
    expect(s.pending?.kind).toBe('chooseTargets');
    let refused = false;
    try { s = answer(s, { kind: 'chooseTargets', targets: [obj(t1!), obj(t2!)] }); refused = s.pending?.kind === 'chooseTargets'; } catch { refused = true; }
    expect(refused).toBe(true);
  });
  it('negative: an untapped creature is not a legal target', () => {
    const s0 = board();
    const untapped = theirs(s0).find((id) => !s0.objects[id]!.tapped)!;
    const [m1] = mine(s0);
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Limit Slash', 'hand') });
    s = answer(s, { kind: 'chooseOption', ids: ['1'] });
    let refused = false;
    try { s = answer(s, { kind: 'chooseTargets', targets: [obj(m1!), obj(untapped)] }); refused = s.pending?.kind === 'chooseTargets'; } catch { refused = true; }
    expect(refused).toBe(true);
  });
});

// ---- Press the Enemy --------------------------------------------------------------------------------------------------------------------------------------
describe('CR 202.3, 608.2h, 400.7: "Return target spell or nonland permanent an opponent controls to its owner\'s hand. You may cast an instant or sorcery spell with equal or lesser mana value from your hand without paying its mana cost."', () => {
  const PRESS = card('Test Press', 'Instant', "Return target spell or nonland permanent an opponent controls to its owner's hand. You may cast an instant or sorcery spell with equal or lesser mana value from your hand without paying its mana cost.", '{2}{U}{U}');
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', '{3}', ['3', '3']);
  const CHEAP = card('Test Cheap Gain', 'Instant', 'You gain 1 life.', '{1}');
  const FINE = card('Test Fine Gain', 'Sorcery', 'You gain 3 life.', '{3}');
  const DEAR = card('Test Dear Gain', 'Instant', 'You gain 5 life.', '{4}');
  const BLAST = card('Test X Gain', 'Instant', 'You gain X life.', '{X}{U}');
  const defs = [PRESS, GOLEM, CHEAP, FINE, DEAR, BLAST];
  /** Resolves Press (the target given), stops at the choice of the spell to cast and returns the state and the names it offers. */
  const toChoice = (s0: GameState, target: ObjectId): { s: GameState; offered: string[] } => {
    let s = cast(s0, 'Test Press', { targets: [[obj(target)]] });
    s = passBothUntilChoice(s);
    const p = s.pending;
    if (p?.kind !== 'chooseObjects') throw new Error(`no choice, got ${p?.kind}`);
    return { s, offered: p.options.map((id) => s.objects[id]!.defId).sort() };
  };
  const passBothUntilChoice = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 12 && s.pending?.kind !== 'chooseObjects' && s.zones.stack.length > 0; i++) {
      if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else break;
    }
    return s;
  };
  it('is full', () => expect(full(PRESS), JSON.stringify(PRESS.automation)).toBe(true));
  it('a permanent: offers the instants and sorceries of your hand with mana value at most the permanent\'s (3), not a dearer one, and the permanent is in its owner\'s hand', () => {
    const s0 = scenario(['Island'], { defs, p1: { hand: ['Test Press', 'Test Cheap Gain', 'Test Fine Gain', 'Test Dear Gain'], battlefield: ['Island', 'Island', 'Island', 'Island'] }, p2: { battlefield: ['Test Golem'] } });
    const { s, offered } = toChoice(s0, find(s0, 'Test Golem', 'battlefield', 'p2'));
    expect(offered).toEqual(['Test Cheap Gain', 'Test Fine Gain']);
    expect(s.zones.hand.p2!.some((id) => s.objects[id]!.defId === 'Test Golem')).toBe(true);
    const fine = s.pending!.kind === 'chooseObjects' ? s.pending.options.find((id) => s.objects[id]!.defId === 'Test Fine Gain')! : '';
    const t = resolveAll(answer(s, { kind: 'chooseObjects', ids: [fine] }));
    expect(lifeOf(t, 'p1')).toBe(23);
  });
  it('negative: with only a dearer instant in hand nothing can be cast', () => {
    const s0 = scenario(['Island'], { defs, p1: { hand: ['Test Press', 'Test Dear Gain'], battlefield: ['Island', 'Island', 'Island', 'Island'] }, p2: { battlefield: ['Test Golem'] } });
    const s = resolveAll(cast(s0, 'Test Press', { targets: [[obj(find(s0, 'Test Golem', 'battlefield', 'p2'))]] }));
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(s.zones.hand.p1!.some((id) => s.objects[id]!.defId === 'Test Dear Gain')).toBe(true);
  });
  it('a spell with X in its cost: its mana value is read with the X chosen as it was cast (ruling 2023-06-16), here 1 + 3 = 4, so the 4-mana instant is offered (and a permanent with X counts 0 of it)', () => {
    let s = scenario(['Island'], { defs, p1: { hand: ['Test Press', 'Test Dear Gain', 'Test Cheap Gain'], battlefield: ['Island', 'Island', 'Island', 'Island', 'Island'] }, p2: { hand: ['Test X Gain'], battlefield: ['Island', 'Island', 'Island', 'Island'] } });
    s = cast(s, 'Test Cheap Gain'); // p1's own spell, to give p2 a window
    s = pass(s); // p1 passes priority
    s = cast(s, 'Test X Gain', { x: [3] }, 'p2'); // p2 responds with X = 3: mana value 4 on the stack
    const spell = s.zones.stack.find((id) => s.objects[id]!.defId === 'Test X Gain')!;
    s = pass(s); // p2 passes priority
    s = cast(s, 'Test Press', { targets: [[obj(spell)]] });
    s = passBothUntilChoice(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    const offered = s.pending?.kind === 'chooseObjects' ? s.pending.options.map((id) => s.objects[id]!.defId).sort() : [];
    expect(offered).toEqual(['Test Dear Gain']);
  });
});

// ---- Mindslaver, Sorin Markov, Worst Fears ----------------------------------------------------------------------------------------------------------------
describe('CR 723.1, 723.5: "You control target player during that player\'s next turn." is the same controlPlayer step as "... during their next turn"', () => {
  const OLD = card('Test Old Slaver', 'Artifact', '{4}, {T}, Sacrifice this artifact: You control target player during that player\'s next turn.', '{6}');
  const NEW = card('Test New Slaver', 'Artifact', '{4}, {T}, Sacrifice this artifact: You control target player during their next turn.', '{6}');
  it('both wordings are full and compile to one JSON', () => {
    expect(full(OLD), JSON.stringify(OLD.automation)).toBe(true);
    expect(full(NEW)).toBe(true);
    const steps = (d: typeof OLD): unknown => (d.faces[0]!.abilities[0] as unknown as { effect: { steps: unknown } }).effect.steps;
    expect(JSON.stringify(steps(OLD))).toBe(JSON.stringify(steps(NEW)));
    expect(JSON.stringify(steps(OLD))).toContain('"op":"controlPlayer"');
  });
  it('negative: "during your next turn" and a creature target are not this reading', () => {
    expect(full(card('Test Bad Slaver', 'Artifact', '{4}, {T}: You control target player during your next turn.', '{6}'))).toBe(false);
    expect(full(card('Test Bad Slaver Two', 'Artifact', '{4}, {T}: You control target creature during that player\'s next turn.', '{6}'))).toBe(false);
  });
});
