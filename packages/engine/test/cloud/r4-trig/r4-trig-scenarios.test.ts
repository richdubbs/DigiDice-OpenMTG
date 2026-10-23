/**
 * Standard round 4, slice r4-trig (trigger conditions, CR 603, both halves): the engine behavior of the trigger events and intervening "if" clauses this slice reads,
 * played through applyAction with synthetic cards compiled by the game's default compiler (invented wordings, design 6.10). Nothing is mocked. Each describe is
 * named after the rule it checks; the template, lowering and render side is in r4-trig-templates.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type AbilityDef, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, life, passBoth, put, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, runCombat, toDeclareAttackers, toDeclareBlockers, toStep, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): AbilityDef[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
type Opts = { targets?: TargetChoice[][]; yes?: boolean; picks?: ObjectId[][] };

/** Answer the decisions in front of us: targets in order, automatic payment, yes/no by `yes` (default no), object picks in order, triggers in any order. */
function settle(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  for (let i = 0; i < 40 && s.pending && s.pending.kind !== 'priority'; i++) {
    const d = s.pending as { kind: string };
    if (d.kind === 'chooseTargets' && (o.targets?.length ?? 0) > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets!.shift()! });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes === true } as DecisionAnswer);
    else if (d.kind === 'chooseObjects' && (o.picks?.length ?? 0) > 0) s = answer(s, { kind: 'chooseObjects', ids: o.picks!.shift()! });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else break;
  }
  return s;
}
const cast = (s: GameState, name: string, o: Opts = {}, player = 'p1', zone: 'hand' | 'graveyard' = 'hand'): GameState => settle(act(s, { type: 'cast', player, card: find(s, name, zone, player) }), o);
/** Pass priority until the stack is empty, answering as `settle` does. */
function resolveAll(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  for (let i = 0; i < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
    if (s.pending?.kind === 'priority') { s = passBoth(s); continue; }
    const before = s;
    s = settle(s, o);
    if (s === before) break;
  }
  return s;
}
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const counters = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['+1/+1'] ?? 0;
const ready = (s: GameState): GameState => tweak(s, (x) => { for (const id of x.zones.battlefield) x.objects[id]!.controlledSinceTurn = 0; });
const mine = (s: GameState, p = 'p1'): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p);
const named = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name);
const BASICS = ['Mountain', 'Island', 'Swamp', 'Forest', 'Plains'];
const BEAR = card('Test Grove Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const WALL = card('Test Moss Wall', 'Creature — Wall', '', '{0}', ['0', '4']);
const OGRE = card('Test Tall Ogre', 'Creature — Ogre', '', '{0}', ['4', '1']);

describe('CR 702.100a-b, 603.4: "if it has greater power or toughness than ~" compares each statistic with its own (evolve\'s comparison)', () => {
  const GROWER = card('Test Kin Grower', 'Creature — Skrull', 'Whenever another creature you control enters, if it has greater power or toughness than this creature, put a +1/+1 counter on this creature.', '{0}', ['2', '2']);
  const PEER = card('Test Even Peer', 'Creature — Bear', '', '{0}', ['2', '2']);
  const DEFS = [GROWER, WALL, OGRE, PEER];
  it('is automated, as evolve is (keywords/data/evolve.json)', () => {
    expect(manualParts(GROWER)).toEqual([]);
    const t = GROWER.faces[0]!.abilities.find((a) => a.kind === 'triggered') as { interveningIf?: unknown };
    expect(t.interveningIf).toMatchObject({ cond: 'matches', filter: { anyOf: [{ power: { op: '>' } }, { toughness: { op: '>' } }] } });
  });
  it('a 0/4 (greater toughness) and a 4/1 (greater power) each add a counter; a 2/2 does not', () => {
    for (const [name, want] of [['Test Moss Wall', 1], ['Test Tall Ogre', 1], ['Test Even Peer', 0]] as const) {
      let s = scenario(BASICS, { p1: { hand: [name], battlefield: ['Test Kin Grower'] }, defs: DEFS });
      s = resolveAll(cast(s, name));
      expect(counters(s, named(s, 'Test Kin Grower')[0]!), name).toBe(want);
    }
  });
});

describe('CR 508.1, 603.2: "Whenever ~ and at least one other creature attack" (battalion\'s form with one other)', () => {
  const SCOUT = card('Test Wing Scout', 'Creature — Soldier', 'Whenever this creature and at least one other creature attack, draw a card.', '{0}', ['1', '1']);
  const DEFS = [SCOUT, BEAR];
  it('is automated', () => expect(manualParts(SCOUT)).toEqual([]));
  it('attacking with another creature draws; attacking alone, or the other creature attacking alone, does not', () => {
    const start = (): GameState => ready(scenario(BASICS, { p1: { battlefield: ['Test Wing Scout', 'Test Grove Bear'] }, defs: DEFS }));
    let s = start();
    const hand = handSize(s, 'p1');
    const scout = named(s, 'Test Wing Scout')[0]!;
    const bear = named(s, 'Test Grove Bear')[0]!;
    expect(handSize(resolveAll(runCombat(s, { attack: [[scout, 'p2'], [bear, 'p2']], until: 'declareBlockers' })), 'p1')).toBe(hand + 1);
    s = start();
    expect(handSize(resolveAll(runCombat(s, { attack: [[named(s, 'Test Wing Scout')[0]!, 'p2']], until: 'declareBlockers' })), 'p1')).toBe(hand);
    s = start();
    expect(handSize(resolveAll(runCombat(s, { attack: [[named(s, 'Test Grove Bear')[0]!, 'p2']], until: 'declareBlockers' })), 'p1')).toBe(hand);
  });
});

describe('CR 506.5, 508.1b: "Whenever a creature you control attacks a player alone"', () => {
  const LONE = card('Test Lone Banner', 'Enchantment', 'Whenever a creature you control attacks a player alone, put a +1/+1 counter on that creature.', '{0}');
  const DEFS = [LONE, BEAR];
  it('is automated, the defender a player', () => {
    expect(manualParts(LONE)).toEqual([]);
    expect(LONE.faces[0]!.abilities[0]).toMatchObject({ trigger: { on: [{ ev: 'attacks', alone: true, defender: 'any' }] } });
  });
  it('one attacker gets the counter; two attackers trigger nothing', () => {
    let s = ready(scenario(BASICS, { p1: { battlefield: ['Test Lone Banner', 'Test Grove Bear', 'Test Grove Bear'] }, defs: DEFS }));
    const [a, b] = named(s, 'Test Grove Bear');
    s = resolveAll(runCombat(s, { attack: [[a!, 'p2']], until: 'declareBlockers' }));
    expect(counters(s, a!)).toBe(1);
    let t = ready(scenario(BASICS, { p1: { battlefield: ['Test Lone Banner', 'Test Grove Bear', 'Test Grove Bear'] }, defs: DEFS }));
    const [c, d] = named(t, 'Test Grove Bear');
    t = resolveAll(runCombat(t, { attack: [[c!, 'p2'], [d!, 'p2']], until: 'declareBlockers' }));
    expect(counters(t, c!) + counters(t, d!)).toBe(0);
    void b;
  });
});

describe('CR 701.9a, 608.2h: "put a +1/+1 counter on that creature for each card you\'ve discarded this turn"', () => {
  const HONE = card('Test Whetstone Rite', 'Enchantment', 'Whenever a creature you control attacks, discard a card, then draw a card. Then put a +1/+1 counter on that creature for each card you\'ve discarded this turn.', '{0}');
  const PURGE = card('Test Purge', 'Sorcery', 'Discard a card.', '{0}');
  const DEFS = [HONE, PURGE, BEAR];
  it('is automated', () => expect(manualParts(HONE)).toEqual([]));
  it('counts every discard of the turn, the one the ability made included', () => {
    let s = ready(scenario(BASICS, { p1: { hand: ['Test Purge', 'Mountain', 'Island'], battlefield: ['Test Whetstone Rite', 'Test Grove Bear'] }, defs: DEFS }));
    s = resolveAll(cast(s, 'Test Purge'), { picks: [[find(s, 'Mountain', 'hand', 'p1')]] });
    const bear = named(s, 'Test Grove Bear')[0]!;
    s = resolveAll(runCombat(s, { attack: [[bear, 'p2']], until: 'declareBlockers' }), { picks: [[find(s, 'Island', 'hand', 'p1')]] });
    expect(counters(s, bear)).toBe(2);
  });
});

describe('CR 500.8, 505.1a, 603.4: "if it\'s the first combat phase of the turn, untap it. After this phase, there is an additional combat phase."', () => {
  const GLOVE = card('Test Twin Gauntlet', 'Creature — Monk', "Whenever this creature attacks, if it's the first combat phase of the turn, untap it. After this phase, there is an additional combat phase.", '{0}', ['2', '2']);
  const DEFS = [GLOVE];
  it('is automated with the condition firstCombat', () => {
    expect(manualParts(GLOVE)).toEqual([]);
    expect(GLOVE.faces[0]!.abilities[0]).toMatchObject({ interveningIf: { cond: 'firstCombat' } });
  });
  it('the first attack untaps it and adds a combat phase; attacking in that additional phase adds none', () => {
    let s = ready(scenario(BASICS, { p1: { battlefield: ['Test Twin Gauntlet'] }, defs: DEFS }));
    const g = named(s, 'Test Twin Gauntlet')[0]!;
    s = runCombat(s, { attack: [[g, 'p2']] }); // the trigger resolves in the declare attackers step
    expect(s.objects[g]!.tapped).toBe(false);
    expect(life(s, 'p2')).toBe(18);
    s = runCombat(s, { attack: [[g, 'p2']], until: 'declareBlockers' }); // the additional combat phase (CR 500.8)
    s = resolveAll(s);
    expect(s.turn.number).toBe(1);
    expect(s.combat?.number).toBe(2);
    expect(s.objects[g]!.tapped).toBe(true); // the intervening "if" is false: no untap and no third combat phase
    expect(s.turn.extraPhases ?? []).toEqual([]);
  });
});

describe('CR 508.1, 603.4: "if you attacked with a Hero this turn or a Hero entered the battlefield under your control this turn"', () => {
  const RALLY = card('Test Rally Horn', 'Enchantment', 'At the beginning of each end step, if you attacked with a Hero this turn or a Hero entered the battlefield under your control this turn, draw a card.', '{0}');
  const HERO = card('Test Hall Hero', 'Creature — Human Hero', '', '{0}', ['2', '2']);
  const DEFS = [RALLY, HERO, BEAR];
  it('is automated', () => expect(manualParts(RALLY)).toEqual([]));
  it('a Hero that attacked draws at the end step; a Bear that attacked does not', () => {
    let s = ready(scenario(BASICS, { p1: { battlefield: ['Test Rally Horn', 'Test Hall Hero'] }, defs: DEFS }));
    const hand = handSize(s, 'p1');
    s = runCombat(s, { attack: [[named(s, 'Test Hall Hero')[0]!, 'p2']] });
    s = resolveAll(toStep(s, 'end'));
    expect(handSize(s, 'p1')).toBe(hand + 1);
    let t = ready(scenario(BASICS, { p1: { battlefield: ['Test Rally Horn', 'Test Grove Bear'] }, defs: DEFS }));
    t = runCombat(t, { attack: [[named(t, 'Test Grove Bear')[0]!, 'p2']] });
    t = resolveAll(toStep(t, 'end'));
    expect(handSize(t, 'p1')).toBe(hand);
  });
});

describe('CR 120.2, 510.2, 603.2c, 506.2: "Whenever you\'re dealt combat damage, the attacking player gains control of ~ and untaps it."', () => {
  const BALL = card('Test Loose Ball', 'Artifact', "Whenever you're dealt combat damage, the attacking player gains control of this artifact and untaps it.\n{T}: You gain 1 life.", '{0}');
  const DEFS = [BALL, BEAR];
  it('is automated', () => expect(manualParts(BALL)).toEqual([]));
  it('two attackers dealing combat damage to its controller trigger it once; the attacking player gains control and it is untapped', () => {
    let s = ready(scenario(BASICS, { p1: { battlefield: ['Test Grove Bear', 'Test Grove Bear'] }, p2: { battlefield: [{ name: 'Test Loose Ball', tapped: true }] }, defs: DEFS }));
    const ball = named(s, 'Test Loose Ball')[0]!;
    s = runCombat(s, { attack: mine(s).map((id) => [id, 'p2'] as [ObjectId, string]), until: 'combatDamage' });
    expect(s.zones.stack.length).toBe(1); // one occurrence for the step's damage to that player
    s = resolveAll(s);
    expect(life(s, 'p2')).toBe(16);
    expect(s.objects[ball]!.controller).toBe('p1');
    expect(s.objects[ball]!.tapped).toBe(false);
  });
});

describe('CR 601.2a, 400.3, 603.4: "When this Equipment enters, if it was cast from your graveyard, attach it to target creature you control."', () => {
  const GLIDER = card('Test Ash Glider', 'Artifact — Equipment', 'You may cast this card from your graveyard.\nWhen this Equipment enters, if it was cast from your graveyard, attach it to target creature you control.\nEquipped creature gets +1/+0.\nEquip {3}', '{0}');
  const DEFS = [GLIDER, BEAR];
  it('is automated, the zone of the cast record and its owner (wasCast.fromOwner)', () => {
    expect(manualParts(GLIDER)).toEqual([]);
    expect(GLIDER.faces[0]!.abilities.find((a) => a.kind === 'triggered')).toMatchObject({ interveningIf: { cond: 'wasCast', from: 'graveyard', fromOwner: 'you' } });
  });
  it('cast from its owner\'s graveyard it attaches; cast from the hand it does not trigger', () => {
    let s = scenario(BASICS, { p1: { graveyard: ['Test Ash Glider'], battlefield: ['Test Grove Bear'] }, defs: DEFS });
    const bear = named(s, 'Test Grove Bear')[0]!;
    s = resolveAll(cast(s, 'Test Ash Glider', {}, 'p1', 'graveyard'), { targets: [[obj(bear)]] });
    expect(s.objects[named(s, 'Test Ash Glider')[0]!]!.attachedTo).toBe(bear);
    let t = scenario(BASICS, { p1: { hand: ['Test Ash Glider'], battlefield: ['Test Grove Bear'] }, defs: DEFS });
    t = resolveAll(cast(t, 'Test Ash Glider'), { targets: [[obj(named(t, 'Test Grove Bear')[0]!)]] });
    expect(t.objects[named(t, 'Test Ash Glider')[0]!]!.attachedTo).toBeUndefined();
  });
});

describe('CR 208.1: "Whenever a creature you control with toughness greater than its power enters" (the object\'s own two values)', () => {
  const SHELL = card('Test Shell Keeper', 'Enchantment', 'Whenever a creature you control with toughness greater than its power enters, you gain 1 life.', '{0}');
  const DEFS = [SHELL, WALL, BEAR, OGRE];
  it('is automated with the filter toughnessGreaterThanPower', () => {
    expect(manualParts(SHELL)).toEqual([]);
    expect(SHELL.faces[0]!.abilities[0]).toMatchObject({ trigger: { on: [{ subject: { toughnessGreaterThanPower: true } }] } });
  });
  it('a 0/4 gains 1 life; a 2/2 and a 4/1 do not', () => {
    for (const [name, want] of [['Test Moss Wall', 21], ['Test Grove Bear', 20], ['Test Tall Ogre', 20]] as const) {
      let s = scenario(BASICS, { p1: { hand: [name], battlefield: ['Test Shell Keeper'] }, defs: DEFS });
      s = resolveAll(cast(s, name));
      expect(life(s, 'p1'), name).toBe(want);
    }
  });
});

describe('CR 701.21a, 109.2: "Whenever a player sacrifices another creature"', () => {
  const ALTAR = card('Test Grim Idol', 'Artifact Creature — Construct', 'Whenever a player sacrifices another creature, put a +1/+1 counter on this creature.\nSacrifice a creature: You gain 1 life.', '{0}', ['1', '1']);
  const DEFS = [ALTAR, BEAR];
  it('is automated, the object other than the source', () => {
    expect(manualParts(ALTAR)).toEqual([]);
    expect(ALTAR.faces[0]!.abilities[0]).toMatchObject({ trigger: { on: [{ ev: 'action', verb: 'sacrifice', actor: 'any', object: { other: true } }] } });
  });
  it('an opponent sacrificing a creature adds a counter', () => {
    const OFFER = card('Test Grim Offer', 'Sorcery', 'Sacrifice a creature.', '{0}');
    let s = scenario(BASICS, { p1: { battlefield: ['Test Grim Idol'] }, p2: { hand: ['Test Grim Offer'], battlefield: ['Test Grove Bear'] }, defs: [...DEFS, OFFER] });
    s = tweak(s, (x) => { x.turn.activePlayer = 'p2'; x.priority.player = 'p2'; (x.pending as { player: string }).player = 'p2'; });
    s = resolveAll(cast(s, 'Test Grim Offer', { picks: [[named(s, 'Test Grove Bear')[0]!]] }, 'p2'));
    expect(counters(s, named(s, 'Test Grim Idol')[0]!)).toBe(1);
  });
});

describe('CR 305.1, 601.2a: "Whenever you play a land or cast a spell from anywhere other than your hand"', () => {
  const SHADE = card('Test Ember Shade', 'Enchantment', 'You may play lands from your graveyard.\nWhenever you play a land or cast a spell from anywhere other than your hand, this enchantment deals 1 damage to each opponent.', '{0}');
  const DEFS = [SHADE];
  it('is automated: a land play with `notFrom` hand and a cast not from the hand', () => {
    expect(manualParts(SHADE)).toEqual([]);
    expect(SHADE.faces[0]!.abilities.find((a) => a.kind === 'triggered')).toMatchObject({ trigger: { on: [{ ev: 'action', verb: 'playLand', notFrom: 'hand' }, { ev: 'cast', spell: { not: { castFrom: 'hand' } } }] } });
  });
  it('a land played from the graveyard deals 1 damage; a land played from the hand does not', () => {
    let s = scenario(BASICS, { p1: { graveyard: ['Mountain'], battlefield: ['Test Ember Shade'] }, defs: DEFS });
    s = resolveAll(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Mountain', 'graveyard', 'p1') }));
    expect(life(s, 'p2')).toBe(19);
    let t = scenario(BASICS, { p1: { hand: ['Mountain'], battlefield: ['Test Ember Shade'] }, defs: DEFS });
    t = resolveAll(act(t, { type: 'playLand', player: 'p1', card: find(t, 'Mountain', 'hand', 'p1') }));
    expect(life(t, 'p2')).toBe(20);
  });
});

describe('CR 115.9b, 102.3: "Whenever you cast a spell that targets an opponent or a creature an opponent controls"', () => {
  const SPEAR = card('Test Spite Lancer', 'Creature — Soldier', 'Whenever you cast a spell that targets an opponent or a creature an opponent controls, put a +1/+1 counter on this creature.', '{0}', ['1', '1']);
  const JAB = card('Test Jab', 'Instant', 'Test Jab deals 1 damage to any target.', '{0}');
  const DEFS = [SPEAR, JAB, BEAR];
  it('is automated, one target description of either kind', () => expect(manualParts(SPEAR)).toEqual([]));
  it('targeting the opponent or the opponent\'s creature adds a counter; targeting your own creature or yourself does not', () => {
    const run = (target: (s: GameState) => TargetChoice): number => {
      let s = scenario(BASICS, { p1: { hand: ['Test Jab'], battlefield: ['Test Spite Lancer', 'Test Grove Bear'] }, p2: { battlefield: ['Test Grove Bear'] }, defs: DEFS });
      s = resolveAll(cast(s, 'Test Jab', { targets: [[target(s)]] }));
      return counters(s, named(s, 'Test Spite Lancer')[0]!);
    };
    expect(run(() => ({ kind: 'player', id: 'p2' }))).toBe(1);
    expect(run((s) => obj(mine(s, 'p2')[0]!))).toBe(1);
    expect(run((s) => obj(named(s, 'Test Grove Bear').find((id) => s.objects[id]!.controller === 'p1')!))).toBe(0);
    expect(run(() => ({ kind: 'player', id: 'p1' }))).toBe(0);
  });
});

describe('CR 700.4: "Whenever another artifact or creature is put into a graveyard from the battlefield" (a mixed-type subject)', () => {
  const SOUL = card('Test Grave Blade', 'Artifact — Equipment', 'Whenever another artifact or creature is put into a graveyard from the battlefield, you gain 1 life.\nEquip {2}', '{0}');
  const TRINKET = card('Test Tin Trinket', 'Artifact', '', '{0}');
  const BREAK = card('Test Shatter Call', 'Instant', 'Destroy target artifact or creature.', '{0}');
  const DEFS = [SOUL, TRINKET, BREAK, BEAR];
  it('is automated', () => expect(manualParts(SOUL)).toEqual([]));
  it('an artifact and a creature put into a graveyard each trigger it', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Shatter Call', 'Test Shatter Call'], battlefield: ['Test Grave Blade', 'Test Tin Trinket', 'Test Grove Bear'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Shatter Call', { targets: [[obj(named(s, 'Test Tin Trinket')[0]!)]] }));
    s = resolveAll(cast(s, 'Test Shatter Call', { targets: [[obj(named(s, 'Test Grove Bear')[0]!)]] }));
    expect(life(s, 'p1')).toBe(22);
  });
});

describe('CR 719.3b-c (unverified), 603.2: "When ~ enters and whenever you solve a Case"', () => {
  const AUDIT = card('Test Ledger Clerk', 'Creature — Human Detective', 'When this creature enters and whenever you solve a Case, you gain 2 life.', '{0}', ['1', '1']);
  const CASE = card('Test Case of the Lost Coin', 'Enchantment — Case', 'To solve — You control a creature. (If unsolved, solve at the beginning of your end step.)\nSolved — {T}: You gain 1 life.', '{0}');
  const DEFS = [AUDIT, CASE];
  it('is automated: its own enters and a Case you control becoming solved', () => {
    expect(manualParts(AUDIT)).toEqual([]);
    expect(AUDIT.faces[0]!.abilities[0]).toMatchObject({ trigger: { on: [{ ev: 'zoneChange', subject: { self: true } }, { ev: 'becomes', what: 'solved', object: { subtypes: ['Case'], controller: 'you' } }] } });
  });
  it('entering gains 2 life, and the Case solved at the end step gains 2 more', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Ledger Clerk'], battlefield: ['Test Case of the Lost Coin'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Ledger Clerk'));
    expect(life(s, 'p1')).toBe(22);
    s = resolveAll(toStep(s, 'end'));
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(24);
  });
});

describe('CR 113.6k, 603.1, 603.10a: "Whenever a creature you control dies while this card is in your graveyard" (a trigger condition judged as the event happens)', () => {
  const FORE = card('Test Ash Forebear', 'Creature — Spirit Warrior', 'Whenever a creature you control dies while this card is in your graveyard, you may pay {0}. If you do, return this card from your graveyard to your hand.', '{0}', ['3', '1']);
  const WIPE = card('Test Ash Wipe', 'Sorcery', 'Destroy all creatures.', '{0}');
  const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.', '{0}');
  const DEFS = [FORE, WIPE, DOOM, BEAR];
  it('is automated and functions in the graveyard', () => {
    expect(manualParts(FORE)).toEqual([]);
    expect(FORE.faces[0]!.abilities[0]).toMatchObject({ zone: ['graveyard'], trigger: { while: { cond: 'matches', object: { ref: 'self' }, filter: { zone: 'graveyard', owner: 'you' } } } });
  });
  it('in the graveyard, a creature of yours dying returns it to the hand', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Doom'], graveyard: ['Test Ash Forebear'], battlefield: ['Test Grove Bear'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Doom', { targets: [[obj(named(s, 'Test Grove Bear')[0]!)]] }), { yes: true });
    expect(s.zones.hand['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Ash Forebear')).toBe(true);
  });
  it('dying at the same time as another creature, it was not in the graveyard as that creature died: no trigger (unverified ruling)', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Ash Wipe'], battlefield: ['Test Ash Forebear', 'Test Grove Bear'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Ash Wipe'), { yes: true });
    expect(s.zones.graveyard['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Ash Forebear')).toBe(true);
    expect(s.zones.hand['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Ash Forebear')).toBe(false);
  });
});

describe('CR 115.1, 603.2, 603.2h: "Whenever a player or permanent becomes the target of an ability you control, draw a card. This ability triggers only once each turn."', () => {
  const TRICK = card('Test Trick God', 'Creature — God', 'Whenever a player or permanent becomes the target of an ability you control, draw a card. This ability triggers only once each turn.', '{0}', ['2', '2']);
  const WAND = card('Test Mend Wand', 'Artifact', '{0}: Target player gains 1 life.\n{0}: Target creature gets +1/+0 until end of turn.\n{0}: Return target creature card from your graveyard to your hand.', '{0}');
  const BOLT = card('Test Jab', 'Instant', 'Test Jab deals 1 damage to any target.', '{0}');
  const DEFS = [TRICK, WAND, BOLT, BEAR];
  const wand = (s: GameState, ability: string, target: TargetChoice): GameState => resolveAll(settle(act(s, { type: 'activate', player: 'p1', source: named(s, 'Test Mend Wand')[0]!, ability }), { targets: [[target]] }));
  it('is automated: a player target and a permanent target, each an event', () => {
    expect(manualParts(TRICK)).toEqual([]);
    expect(TRICK.faces[0]!.abilities[0]).toMatchObject({ trigger: { on: [{ what: 'targeted', player: 'any' }, { what: 'targeted', object: { zone: 'battlefield' } }] }, limit: { per: 'turn', max: 1 } });
  });
  it('an ability targeting a player draws, once each turn; a spell targeting a player does not; an ability targeting a card in a graveyard does not', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Jab'], graveyard: ['Test Grove Bear'], battlefield: ['Test Trick God', 'Test Mend Wand'] }, defs: DEFS });
    const hand = handSize(s, 'p1');
    s = resolveAll(cast(s, 'Test Jab', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(handSize(s, 'p1')).toBe(hand - 1);
    s = wand(s, 'p:0:2', obj(find(s, 'Test Grove Bear', 'graveyard', 'p1')));
    expect(handSize(s, 'p1')).toBe(hand); // the Bear came back; no draw: a card in a graveyard is not a permanent
    s = wand(s, 'p:0:0', { kind: 'player', id: 'p2' });
    expect(handSize(s, 'p1')).toBe(hand + 1);
    s = wand(s, 'p:0:1', obj(named(s, 'Test Trick God')[0]!));
    expect(handSize(s, 'p1')).toBe(hand + 1); // only once each turn
  });
});

describe('CR 508.1, 603.4: "if a Pirate and a Vehicle attacked this combat" (two different attackers, one of each)', () => {
  const SWASH = card('Test Deck Swabber', 'Creature — Fish Pirate', 'Whenever you attack, if a Pirate and a Vehicle attacked this combat, you gain 3 life.', '{0}', ['1', '1']);
  const CART = card('Test War Cart', 'Artifact Creature — Vehicle', '', '{0}', ['3', '3']);
  const BOTH = card('Test Pirate Galley', 'Artifact Creature — Pirate Vehicle', '', '{0}', ['3', '3']);
  const DEFS = [SWASH, CART, BOTH];
  it('is automated', () => expect(manualParts(SWASH)).toEqual([]));
  it('a Pirate and a Vehicle attacking gains 3; the Pirate alone, or one Pirate Vehicle alone, does not', () => {
    const run = (battlefield: string[], attackers: string[]): number => {
      let s = ready(scenario(BASICS, { p1: { battlefield }, defs: DEFS }));
      s = resolveAll(runCombat(s, { attack: attackers.map((n) => [named(s, n)[0]!, 'p2'] as [ObjectId, string]), until: 'declareBlockers' }));
      return life(s, 'p1');
    };
    expect(run(['Test Deck Swabber', 'Test War Cart'], ['Test Deck Swabber', 'Test War Cart'])).toBe(23);
    expect(run(['Test Deck Swabber', 'Test War Cart'], ['Test Deck Swabber'])).toBe(20);
    expect(run(['Test Deck Swabber', 'Test Pirate Galley'], ['Test Pirate Galley'])).toBe(20);
    expect(run(['Test Deck Swabber', 'Test Pirate Galley'], ['Test Pirate Galley', 'Test Deck Swabber'])).toBe(23);
  });
});

describe('CR 508.1, 509.1c, 603.4: "Whenever a Wolf you control attacks, if ~ attacked this combat, target creature an opponent controls blocks that Wolf this combat if able"', () => {
  const ALPHA = card('Test Pack Elder', 'Creature — Elf Scout', 'Whenever a Wolf you control attacks, if this creature attacked this combat, target creature an opponent controls blocks that Wolf this combat if able.', '{0}', ['1', '1']);
  const WOLF = card('Test Gray Wolf', 'Creature — Wolf', '', '{0}', ['3', '3']);
  const DEFS = [ALPHA, WOLF, BEAR];
  it('is automated: "that Wolf" is the attacker', () => {
    expect(manualParts(ALPHA)).toEqual([]);
    expect(ALPHA.faces[0]!.abilities[0]).toMatchObject({ interveningIf: { cond: 'happened', event: { ev: 'attacks', attacker: { self: true } }, scope: 'combat' } });
  });
  it('the Wolf attacking with it makes the target block the Wolf (CR 509.1c); the Wolf attacking without it triggers nothing', () => {
    let s = ready(scenario(BASICS, { p1: { battlefield: ['Test Pack Elder', 'Test Gray Wolf'] }, p2: { battlefield: ['Test Grove Bear'] }, defs: DEFS }));
    const wolf = named(s, 'Test Gray Wolf')[0]!;
    const bear = named(s, 'Test Grove Bear')[0]!;
    s = declareAttackers(toDeclareAttackers(s), [[named(s, 'Test Pack Elder')[0]!, 'p2'], [wolf, 'p2']]);
    expect(s.pending?.kind).toBe('chooseTargets');
    s = resolveAll(settle(s, { targets: [[obj(bear)]] }));
    s = toDeclareBlockers(s);
    expect(() => declareBlockers(s, [])).toThrow(); // the Bear must block the Wolf if able
    s = declareBlockers(s, [[bear, wolf]]);
    expect(s.combat?.blockers.some((b) => b.id === bear)).toBe(true);
    let t = ready(scenario(BASICS, { p1: { battlefield: ['Test Pack Elder', 'Test Gray Wolf'] }, p2: { battlefield: ['Test Grove Bear'] }, defs: DEFS }));
    t = declareAttackers(toDeclareAttackers(t), [[named(t, 'Test Gray Wolf')[0]!, 'p2']]);
    expect(t.pending?.kind).not.toBe('chooseTargets');
    expect(t.zones.stack.length).toBe(0);
  });
});

describe('CR 208.1, 603.4, 107.1a: "if creatures you control have total toughness 10 or greater ... Then if ... 20 ... Then if ... 40 ..., each opponent loses half their life, rounded up"', () => {
  const KIN = card('Test Kin Warden', 'Creature — Spirit', 'At the beginning of your end step, if creatures you control have total toughness 10 or greater, draw a card. Then if creatures you control have total toughness 20 or greater, untap each creature you control. Then if creatures you control have total toughness 40 or greater, each opponent loses half their life, rounded up.', '{0}', ['1', '1']);
  const TALL = (n: number): CardDef => card(`Test Tower ${n}`, 'Creature — Wall', '', '{0}', ['0', String(n)]);
  const DEFS = [KIN, TALL(8), TALL(9), TALL(19), TALL(39)];
  it('is automated', () => expect(manualParts(KIN)).toEqual([]));
  it('10 draws; 20 also untaps; 40 also halves each opponent\'s life, rounded up; 9 does nothing', () => {
    const run = (tower: number, oppLife = 19): GameState => {
      let s = scenario(BASICS, { p1: { battlefield: ['Test Kin Warden', { name: `Test Tower ${tower}`, tapped: true }] }, defs: DEFS });
      s = tweak(s, (x) => { x.players.find((p) => p.id === 'p2')!.life = oppLife; });
      return resolveAll(advanceTo(s, 1, 'end'));
    };
    const hand = handSize(scenario(BASICS, { p1: { battlefield: ['Test Kin Warden'] }, defs: DEFS }), 'p1');
    expect(handSize(run(8), 'p1')).toBe(hand); // 1 + 8 = 9: nothing
    expect(handSize(run(9), 'p1')).toBe(hand + 1); // 1 + 9 = 10: draws
    const s19 = run(19);
    expect(handSize(s19, 'p1')).toBe(hand + 1);
    expect(s19.objects[named(s19, 'Test Tower 19')[0]!]!.tapped).toBe(false);
    expect(life(s19, 'p2')).toBe(19);
    const s39 = run(39);
    expect(life(s39, 'p2')).toBe(9); // 19 - ceil(19 / 2)
  });
});

describe('CR 701.23a: "Whenever an opponent searches their library"', () => {
  const OWL = card('Test Archive Owl', 'Creature — Bird', 'Whenever an opponent searches their library, draw a card.', '{0}', ['1', '1']);
  const TUTOR = card('Test Quick Tutor', 'Instant', 'Search your library for a card, put it into your hand, then shuffle.', '{0}');
  const DEFS = [OWL, TUTOR];
  it('is automated', () => expect(manualParts(OWL)).toEqual([]));
  it('the opponent searching their own library draws you a card; your own search does not', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Quick Tutor'], battlefield: ['Test Archive Owl'] }, p2: { hand: ['Test Quick Tutor'] }, defs: DEFS });
    const hand = handSize(s, 'p1');
    s = resolveAll(cast(s, 'Test Quick Tutor'), { picks: [[s.zones.library['p1']![0]!]] });
    expect(handSize(s, 'p1')).toBe(hand); // cast one, tutored one, no draw
    s = act(s, { type: 'pass', player: 'p1' });
    s = resolveAll(cast(s, 'Test Quick Tutor', { picks: [[s.zones.library['p2']![0]!]] }, 'p2'), { picks: [[s.zones.library['p2']![0]!]] });
    expect(handSize(s, 'p1')).toBe(hand + 1);
  });
});

describe('CR 400.7, 603.6a, 121.2: "a permanent you control enters from exile" and "you draw your first or second card each turn"', () => {
  const FLAME = card('Test Exile Flame', 'Enchantment', 'Whenever a permanent you control enters from exile, you gain 2 life.', '{0}');
  const BLINK = card('Test Quick Blink', 'Instant', 'Exile target creature you control, then return it to the battlefield under its owner\'s control.', '{0}');
  const INK = card('Test Ink Reader', 'Creature — Octopus', 'Whenever you draw your first or second card each turn, you gain 1 life.', '{0}', ['1', '1']);
  const DRAW3 = card('Test Triple Read', 'Sorcery', 'Draw three cards.', '{0}');
  const DEFS = [FLAME, BLINK, INK, DRAW3, BEAR];
  it('are automated', () => { expect(manualParts(FLAME)).toEqual([]); expect(manualParts(INK)).toEqual([]); });
  it('a creature blinked back from exile gains 2 life; a creature cast from the hand does not', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Quick Blink', 'Test Grove Bear'], battlefield: ['Test Exile Flame', 'Test Grove Bear'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Grove Bear'));
    expect(life(s, 'p1')).toBe(20);
    s = resolveAll(cast(s, 'Test Quick Blink', { targets: [[obj(named(s, 'Test Grove Bear')[0]!)]] }));
    expect(life(s, 'p1')).toBe(22);
  });
  it('drawing three cards in a turn triggers for the first and the second only', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Triple Read'], battlefield: ['Test Ink Reader'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Triple Read'));
    expect(life(s, 'p1')).toBe(22);
  });
});
