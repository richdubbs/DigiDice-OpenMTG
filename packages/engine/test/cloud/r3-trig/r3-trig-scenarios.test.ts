/**
 * Standard round 3, slice r3-trig (trigger conditions, CR 603): the engine behavior of the trigger conditions and intervening "if" clauses this slice reads, played
 * through applyAction with synthetic cards compiled by the game's default compiler (invented wordings, design 6.10). Nothing is mocked. Each describe is named
 * after the rule it checks; the template, lowering and render side is in r3-trig-templates.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type AbilityDef, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, legal, life, pass, passBoth, put, scenario } from '../../m3/scenario';
import { runCombat, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): AbilityDef[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
type Opts = { targets?: TargetChoice[][]; yes?: boolean; modes?: string[][]; picks?: ObjectId[][] };

/** Answer the decisions in front of us: targets in order, automatic payment, yes/no by `yes` (default no), modes and object picks in order, triggers in any order. */
function settle(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  for (let i = 0; i < 40 && s.pending && s.pending.kind !== 'priority'; i++) {
    const d = s.pending as { kind: string };
    if (d.kind === 'chooseTargets' && (o.targets?.length ?? 0) > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets!.shift()! });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes === true } as DecisionAnswer);
    else if (d.kind === 'chooseOption' && (o.modes?.length ?? 0) > 0) s = answer(s, { kind: 'chooseOption', ids: o.modes!.shift()! });
    else if (d.kind === 'chooseObjects' && (o.picks?.length ?? 0) > 0) s = answer(s, { kind: 'chooseObjects', ids: o.picks!.shift()! });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else break;
  }
  return s;
}
const cast = (s: GameState, name: string, o: Opts = {}, player = 'p1'): GameState => settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), o);
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
const BASICS = ['Mountain', 'Island', 'Swamp', 'Forest', 'Plains'];

describe('CR 120.2, 510.2, 603.2c: "Whenever ~ deals 4 or more damage" counts all the damage it dealt at once', () => {
  const WEAVER = card('Test Web Weaver', 'Creature — Spider', 'Whenever this creature deals 4 or more damage, draw a card.', '{0}', ['4', '4']);
  const SMALL = card('Test Small Weaver', 'Creature — Spider', 'Whenever this creature deals 4 or more damage, draw a card.', '{0}', ['3', '3']);
  const PUP = card('Test Wall Pup', 'Creature — Dog', '', '{0}', ['2', '2']);
  const DEFS = [WEAVER, SMALL, PUP];
  it('is automated', () => expect(manualParts(WEAVER)).toEqual([]));
  it('4 combat damage to a player triggers it; 3 does not', () => {
    let s = scenario(BASICS, { p1: { battlefield: ['Test Web Weaver', 'Test Small Weaver'] }, defs: DEFS });
    s = tweak(s, (x) => { for (const id of x.zones.battlefield) x.objects[id]!.controlledSinceTurn = 0; });
    const big = find(s, 'Test Web Weaver', 'battlefield', 'p1');
    const small = find(s, 'Test Small Weaver', 'battlefield', 'p1');
    const hand = handSize(s, 'p1');
    s = runCombat(s, { attack: [[big, 'p2'], [small, 'p2']] });
    s = resolveAll(s);
    expect(life(s, 'p2')).toBe(13);
    expect(handSize(s, 'p1')).toBe(hand + 1); // one trigger: the 4/4's
  });
  it('2 damage to each of two blockers is 4 damage dealt at once: one trigger', () => {
    let s = scenario(BASICS, { p1: { battlefield: ['Test Web Weaver'] }, p2: { battlefield: ['Test Wall Pup', 'Test Wall Pup'] }, defs: DEFS });
    s = tweak(s, (x) => { for (const id of x.zones.battlefield) x.objects[id]!.controlledSinceTurn = 0; });
    const big = find(s, 'Test Web Weaver', 'battlefield', 'p1');
    const [a, b] = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2');
    const hand = handSize(s, 'p1');
    s = runCombat(s, { attack: [[big, 'p2']], block: [[a!, big], [b!, big]], assign: { [big]: [{ id: a!, amount: 2 }, { id: b!, amount: 2 }] } });
    s = resolveAll(s);
    expect(handSize(s, 'p1')).toBe(hand + 1);
  });
});

describe('CR 701.9a, 113.6k: "When you discard this card" triggers from the graveyard the card went to', () => {
  const HEART = card('Test Stone Heart', 'Creature — Giant', 'When you discard this card, you gain 3 life.', '{5}', ['5', '5']);
  const PURGE = card('Test Purge', 'Sorcery', 'Discard a card.', '{0}');
  const DEFS = [HEART, PURGE];
  it('is automated and functions in the graveyard and in exile (CR 702.35a)', () => {
    expect(manualParts(HEART)).toEqual([]);
    expect(HEART.faces[0]!.abilities.find((a) => a.kind === 'triggered')).toMatchObject({ zone: ['graveyard', 'exile'] });
  });
  it('discarding it gains 3 life; discarding another card does not', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Purge', 'Test Stone Heart', 'Mountain'] }, defs: DEFS });
    const heart = find(s, 'Test Stone Heart', 'hand', 'p1');
    s = cast(s, 'Test Purge');
    s = resolveAll(s, { picks: [[heart]] });
    expect(s.zones.graveyard['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Stone Heart')).toBe(true);
    expect(life(s, 'p1')).toBe(23);
    let t = scenario(BASICS, { p1: { hand: ['Test Purge', 'Test Stone Heart', 'Mountain'] }, defs: DEFS });
    const land = find(t, 'Mountain', 'hand', 'p1');
    t = cast(t, 'Test Purge');
    t = resolveAll(t, { picks: [[land]] });
    expect(life(t, 'p1')).toBe(20);
  });
});

describe('CR 611.2a, 613.1d, 613.1f: "Whenever a nontoken, non-Angel creature you control dies, return that card ... It has flying and is an Angel in addition to its other types."', () => {
  const CALL = card('Test Winged Call', 'Enchantment', "Whenever a nontoken, non-Angel creature you control dies, return that card to the battlefield under its owner's control with a +1/+1 counter on it. It has flying and is an Angel in addition to its other types.", '{0}');
  const BEAR = card('Test Grove Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const SEALED = card('Test Sealed Angel', 'Creature — Angel', '', '{0}', ['2', '2']);
  const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.', '{0}');
  const DEFS = [CALL, BEAR, SEALED, DOOM];
  it('is automated', () => expect(manualParts(CALL)).toEqual([]));
  it('the returned creature has a +1/+1 counter, flying and the Angel type for good; an Angel that dies stays dead', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Doom', 'Test Doom'], battlefield: ['Test Winged Call', 'Test Grove Bear', 'Test Sealed Angel'] }, defs: DEFS });
    s = cast(s, 'Test Doom', { targets: [[obj(find(s, 'Test Grove Bear', 'battlefield', 'p1'))]] });
    s = resolveAll(s);
    const bear = find(s, 'Test Grove Bear', 'battlefield', 'p1');
    expect(s.objects[bear]!.counters['+1/+1']).toBe(1);
    const c = getChars(s, bear);
    expect(c.subtypes).toEqual(expect.arrayContaining(['Bear', 'Angel']));
    expect(JSON.stringify(c)).toContain('flying');
    s = cast(s, 'Test Doom', { targets: [[obj(find(s, 'Test Sealed Angel', 'battlefield', 'p1'))]] });
    s = resolveAll(s);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Sealed Angel')).toBe(false);
  });
});

describe('CR 603.4, 113.6k, 707.10: "When you cast this spell, if you\'ve cast another spell this turn, copy this spell."', () => {
  const SAGE = card('Test Sky Sage', 'Creature — Human Monk', "When you cast this spell, if you've cast another spell this turn, copy this spell.", '{0}', ['2', '2']);
  const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.', '{0}');
  const DEFS = [SAGE, SPARK];
  const sages = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Sky Sage');
  it('is automated and functions on the stack', () => {
    expect(manualParts(SAGE)).toEqual([]);
    expect(SAGE.faces[0]!.abilities.find((a) => a.kind === 'triggered')).toMatchObject({ zone: ['stack'], interveningIf: { cond: 'happened' } });
  });
  it('the first spell of the turn is not copied; after another spell it is, and the copy becomes a token (CR 707.10, 111.12)', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Sky Sage'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Sky Sage'));
    expect(sages(s).length).toBe(1);
    let t = scenario(BASICS, { p1: { hand: ['Test Spark', 'Test Sky Sage'] }, defs: DEFS });
    t = resolveAll(cast(t, 'Test Spark'));
    t = resolveAll(cast(t, 'Test Sky Sage'));
    expect(sages(t).length).toBe(2);
    expect(sages(t).filter((id) => t.objects[id]!.kind === 'token').length).toBe(1);
  });
});

describe('CR 707.10, 608.2c: "When you cast this spell, copy it if you gained life this turn. You may choose new targets for the copy."', () => {
  const FAVOR = card('Test Bright Favor', 'Instant', 'When you cast this spell, copy it if you gained life this turn. You may choose new targets for the copy.\nTarget creature gets +2/+4 until end of turn.', '{0}');
  const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.', '{0}');
  const BEAR = card('Test Grove Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const DEFS = [FAVOR, SPARK, BEAR];
  it('is automated', () => expect(manualParts(FAVOR)).toEqual([]));
  it('without life gained it is not copied; after gaining life it is, and the copy may take a new target', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Bright Favor'], battlefield: ['Test Grove Bear'] }, defs: DEFS });
    const bear = find(s, 'Test Grove Bear', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Test Bright Favor', { targets: [[obj(bear)]] }));
    expect(getChars(s, bear)).toMatchObject({ power: '4', toughness: '6' });
    let t = scenario(BASICS, { p1: { hand: ['Test Spark', 'Test Bright Favor'], battlefield: ['Test Grove Bear', 'Test Grove Bear'] }, defs: DEFS });
    const [b1, b2] = t.zones.battlefield.filter((id) => t.defs[t.objects[id]!.defId]!.name === 'Test Grove Bear');
    t = resolveAll(cast(t, 'Test Spark'));
    t = resolveAll(cast(t, 'Test Bright Favor', { targets: [[obj(b1!)], [obj(b2!)]] }), { yes: true, targets: [[obj(b2!)]] });
    expect(getChars(t, b1!)).toMatchObject({ power: '4', toughness: '6' });
    expect(getChars(t, b2!)).toMatchObject({ power: '4', toughness: '6' });
  });
});

describe('CR 603.4, 606.3: "Whenever you attack, if you\'ve activated a loyalty ability this turn, ..."', () => {
  const TIDE = card('Test Tide Keeper', 'Enchantment', "Whenever you attack, if you've activated a loyalty ability this turn, draw a card.", '{0}');
  const WALKER = card('Test Walker', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.', '{0}');
  const BEAR = card('Test Grove Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const DEFS = [TIDE, WALKER, BEAR];
  // the planeswalker is put with its loyalty (CR 306.5b; one put with none would die to state-based actions, CR 704.5i)
  const start = (): GameState => tweak(scenario(BASICS, { p1: { battlefield: ['Test Tide Keeper', 'Test Grove Bear'] }, defs: DEFS }), (x) => {
    for (const id of x.zones.battlefield) x.objects[id]!.controlledSinceTurn = 0;
    const walker = put(x, 'p1', 'battlefield', 'Test Walker');
    x.objects[walker]!.counters['loyalty'] = 3;
  });
  it('is automated', () => expect(manualParts(TIDE)).toEqual([]));
  it('with a loyalty ability activated this turn the attack draws a card; without, it does not', () => {
    let s = start();
    s = resolveAll(settle(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Walker', 'battlefield', 'p1'), ability: 'p:0:0' })));
    const hand = handSize(s, 'p1');
    s = resolveAll(runCombat(s, { attack: [[find(s, 'Test Grove Bear', 'battlefield', 'p1'), 'p2']], until: 'declareBlockers' }));
    expect(handSize(s, 'p1')).toBe(hand + 1);
    let t = start();
    const hand2 = handSize(t, 'p1');
    t = resolveAll(runCombat(t, { attack: [[find(t, 'Test Grove Bear', 'battlefield', 'p1'), 'p2']], until: 'declareBlockers' }));
    expect(handSize(t, 'p1')).toBe(hand2);
  });
});

describe('CR 108.4, 613.1b: "Whenever an opponent gains control of a permanent from you, you create a Treasure token."', () => {
  const THIEF = card('Test Gold Thief', 'Creature — Human Rogue', 'Whenever an opponent gains control of a permanent from you, you create a Treasure token.', '{0}', ['2', '2']);
  const STEAL = card('Test Steal', 'Sorcery', 'Gain control of target creature.', '{0}');
  const BEAR = card('Test Grove Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const DEFS = [THIEF, STEAL, BEAR];
  const treasures = (s: GameState, p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && (getChars(s, id).subtypes ?? []).includes('Treasure')).length;
  it('is automated', () => expect(manualParts(THIEF)).toEqual([]));
  it('an opponent taking a creature makes a Treasure for you; taking an opponent\'s creature yourself does not', () => {
    let s = scenario(BASICS, { p1: { battlefield: ['Test Gold Thief', 'Test Grove Bear'] }, p2: { hand: ['Test Steal'], battlefield: ['Test Grove Bear'] }, defs: DEFS });
    s = tweak(s, (x) => { x.turn.activePlayer = 'p2'; x.pending = { kind: 'priority', player: 'p2', prompt: '' } as never; });
    const mine = s.zones.battlefield.find((id) => s.objects[id]!.controller === 'p1' && s.defs[s.objects[id]!.defId]!.name === 'Test Grove Bear')!;
    s = resolveAll(cast(s, 'Test Steal', { targets: [[obj(mine)]] }, 'p2'));
    expect(s.objects[mine]!.controller).toBe('p2');
    expect(treasures(s, 'p1')).toBe(1);
    let t = scenario(BASICS, { p1: { hand: ['Test Steal'], battlefield: ['Test Gold Thief'] }, p2: { battlefield: ['Test Grove Bear'] }, defs: DEFS });
    const theirs = find(t, 'Test Grove Bear', 'battlefield', 'p2');
    t = resolveAll(cast(t, 'Test Steal', { targets: [[obj(theirs)]] }));
    expect(t.objects[theirs]!.controller).toBe('p1');
    expect(treasures(t, 'p1')).toBe(0);
  });
  // Review of wave 6 line trig (CR 514.2, 514.3a, 613.1b): the effect "until end of turn" ends in the cleanup step and control goes back to its owner then; the
  // trigger is waiting, so players get priority in that cleanup step and the Treasure is made in the same turn (before: the trigger was collected only in the
  // next turn's upkeep)
  it('a creature taken "until end of turn" going back to its owner makes a Treasure in the cleanup step of that turn (CR 514.3a)', () => {
    const BORROW = card('Test Borrow', 'Sorcery', 'Gain control of target creature an opponent controls until end of turn. Untap it. It gains haste until end of turn.', '{0}');
    let s = scenario(BASICS, { p1: { hand: ['Test Borrow'], battlefield: ['Test Gold Thief'] }, p2: { battlefield: ['Test Grove Bear'] }, defs: [...DEFS, BORROW] });
    const bear = find(s, 'Test Grove Bear', 'battlefield', 'p2');
    s = resolveAll(cast(s, 'Test Borrow', { targets: [[obj(bear)]] }));
    expect(s.objects[bear]!.controller).toBe('p1');
    expect(treasures(s, 'p1')).toBe(0);
    for (let i = 0; i < 80 && !(s.turn.step === 'cleanup' && s.zones.stack.length > 0); i++) {
      if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else s = pass(s);
    }
    expect(s.turn.number).toBe(1);
    expect(s.objects[bear]!.controller).toBe('p2');
    s = resolveAll(s);
    expect(treasures(s, 'p1')).toBe(1);
    expect(s.turn.number).toBe(1);
  });
});

describe('CR 508.1, 603.2: "Whenever you attack with creatures with total power N or greater [for the first time each turn]"', () => {
  const WORM = card('Test Sand Worm', 'Enchantment', 'Whenever you attack with creatures with total power 6 or greater for the first time each turn, draw a card.', '{0}');
  const PLAIN = card('Test Sand Drum', 'Enchantment', 'Whenever you attack with creatures with total power 6 or greater, you gain 2 life.', '{0}');
  const BEAR = card('Test Grove Bear', 'Creature — Bear', '', '{0}', ['3', '3']);
  const PUP = card('Test Wall Pup', 'Creature — Dog', '', '{0}', ['2', '2']);
  const DEFS = [WORM, PLAIN, BEAR, PUP];
  it('both forms are automated', () => {
    expect(manualParts(WORM)).toEqual([]);
    expect(manualParts(PLAIN)).toEqual([]);
  });
  const start = (enchantment: string, names: string[]): GameState => tweak(scenario(BASICS, { p1: { battlefield: [enchantment, ...names] }, defs: DEFS }), (x) => { for (const id of x.zones.battlefield) x.objects[id]!.controlledSinceTurn = 0; });
  const attackers = (s: GameState): [ObjectId, string][] => s.zones.battlefield.filter((id) => getChars(s, id).types?.includes('Creature')).map((id) => [id, 'p2']);
  const attack = (s: GameState): GameState => resolveAll(runCombat(s, { attack: attackers(s), until: 'declareBlockers' }));
  it('3 + 3 power attacking triggers each form; 3 + 2 triggers neither', () => {
    let s = start('Test Sand Worm', ['Test Grove Bear', 'Test Grove Bear']);
    const hand = handSize(s, 'p1');
    expect(handSize(attack(s), 'p1')).toBe(hand + 1);
    expect(life(attack(start('Test Sand Drum', ['Test Grove Bear', 'Test Grove Bear'])), 'p1')).toBe(22);
    s = start('Test Sand Worm', ['Test Grove Bear', 'Test Wall Pup']);
    expect(handSize(attack(s), 'p1')).toBe(handSize(s, 'p1'));
    expect(life(attack(start('Test Sand Drum', ['Test Grove Bear', 'Test Wall Pup'])), 'p1')).toBe(20);
  });
  it('"for the first time each turn": in the additional combat phase of the same turn it does not trigger again (CR 603.2, 506.1)', () => {
    const TWICE = card('Test Sand Horn', 'Enchantment', 'Whenever you attack with creatures with total power 6 or greater for the first time each turn, draw a card. After this phase, there is an additional combat phase.', '{0}');
    let s = tweak(scenario(BASICS, { p1: { battlefield: ['Test Sand Horn', 'Test Grove Bear', 'Test Grove Bear'] }, defs: [...DEFS, TWICE] }), (x) => { for (const id of x.zones.battlefield) x.objects[id]!.controlledSinceTurn = 0; });
    expect(manualParts(TWICE)).toEqual([]);
    const hand = handSize(s, 'p1');
    s = runCombat(s, { attack: attackers(s) });
    expect(handSize(s, 'p1')).toBe(hand + 1);
    s = tweak(s, (x) => { for (const id of x.zones.battlefield) x.objects[id]!.tapped = false; });
    s = resolveAll(runCombat(s, { attack: attackers(s), until: 'declareBlockers' })); // the additional combat phase: the same total power attacks again
    expect(s.turn.number).toBe(1);
    expect(handSize(s, 'p1')).toBe(hand + 1);
  });
});

describe('CR 700.2, 603.3c: "Whenever you cast a modal spell, choose up to X, where X is the number of times you chose a mode for that spell"', () => {
  const PATHS = card('Test Path Sage', 'Enchantment', 'Whenever you cast a modal spell, choose up to X, where X is the number of times you chose a mode for that spell --\n• You gain 2 life.\n• Each opponent loses 1 life.\n• Draw a card.', '{0}');
  const CHARM = card('Test Twin Charm', 'Instant', 'Choose one or both --\n• You gain 1 life.\n• Draw a card.', '{0}');
  const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.', '{0}');
  const DEFS = [PATHS, CHARM, SPARK];
  const enabledMax = (s: GameState): number | undefined => (s.pending as unknown as { max?: number }).max;
  it('is automated', () => expect(manualParts(PATHS)).toEqual([]));
  it('a modal spell cast with both modes lets it choose up to two; a spell that is not modal does not trigger it', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Twin Charm', 'Test Spark'], battlefield: ['Test Path Sage'] }, defs: DEFS });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Twin Charm', 'hand', 'p1') }), { modes: [['0', '1']] });
    expect(s.pending?.kind).toBe('chooseOption'); // the trigger's modes, chosen as it is put on the stack (CR 603.3c)
    expect(enabledMax(s)).toBe(2);
    s = resolveAll(settle(s, { modes: [['0', '1']] }));
    expect(life(s, 'p1')).toBe(23); // 2 from the trigger, 1 from the charm
    expect(life(s, 'p2')).toBe(19);
    const stack = s.zones.stack.length;
    s = cast(s, 'Test Spark');
    expect(s.zones.stack.length).toBe(stack + 1); // only the spell: no trigger
  });
});

describe('CR 606.4, 603.4: "Whenever you activate a loyalty ability, if you removed two or more loyalty counters to activate it, ..."', () => {
  const MIND = card('Test Mind Shrine', 'Legendary Enchantment', 'Whenever you activate a loyalty ability, if you removed two or more loyalty counters to activate it, draw a card.', '{0}');
  const WALKER = card('Test Walker', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.\n−1: You gain 2 life.\n−2: You gain 3 life.', '{0}');
  const DEFS = [MIND, WALKER];
  const start = (): GameState => tweak(scenario(BASICS, { p1: { battlefield: ['Test Mind Shrine'] }, defs: DEFS }), (x) => {
    const walker = put(x, 'p1', 'battlefield', 'Test Walker');
    x.objects[walker]!.counters['loyalty'] = 5;
  });
  const activate = (s: GameState, ability: string): GameState => resolveAll(settle(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Walker', 'battlefield', 'p1'), ability })));
  it('is automated', () => expect(manualParts(MIND)).toEqual([]));
  it('the -2 ability draws a card; the -1 and +1 abilities do not', () => {
    const abilities = WALKER.faces[0]!.abilities.map((a, i) => ({ a, i })).filter(({ a }) => a.kind === 'activated');
    const key = (loyalty: number): string => `p:0:${abilities.find(({ a }) => (a as { cost?: { loyalty?: number } }).cost?.loyalty === loyalty)!.i}`;
    for (const [loyalty, drawn] of [[-2, 1], [-1, 0], [1, 0]] as const) {
      const s = start();
      const hand = handSize(s, 'p1');
      expect(handSize(activate(s, key(loyalty)), 'p1'), `loyalty ${loyalty}`).toBe(hand + drawn);
    }
  });
});

describe('CR 702.167a, 603.10a: "When this creature is exiled from the battlefield while you\'re activating a craft ability, ..."', () => {
  const GNOME = card('Test Craft Gnome', 'Artifact Creature — Gnome', "When this creature is exiled from the battlefield while you're activating a craft ability, you gain 1 life and draw a card.", '{0}', ['1', '1']);
  const BENCH = compileCard({
    name: 'Test Work Bench // Test Finished Work', layout: 'transform', mana_cost: '{0}', type_line: 'Artifact // Artifact Creature — Golem', colors: [],
    card_faces: [
      { name: 'Test Work Bench', mana_cost: '{0}', type_line: 'Artifact', oracle_text: 'Craft with artifact {0}' },
      { name: 'Test Finished Work', mana_cost: '', type_line: 'Artifact Creature — Golem', oracle_text: '', power: '4', toughness: '4' },
    ],
  } as unknown as OracleCard as never);
  const DOOM = card('Test Exile Ray', 'Instant', 'Exile target artifact.', '{0}');
  const DEFS = [GNOME, BENCH, DOOM];
  it('is automated', () => expect(manualParts(GNOME)).toEqual([]));
  it('exiled as the material of a craft ability it triggers; exiled by a spell it does not', () => {
    let s = scenario(BASICS, { p1: { battlefield: ['Test Work Bench // Test Finished Work', 'Test Craft Gnome'] }, defs: DEFS });
    const gnome = find(s, 'Test Craft Gnome', 'battlefield', 'p1');
    const bench = find(s, 'Test Work Bench // Test Finished Work', 'battlefield', 'p1');
    const hand = handSize(s, 'p1');
    // the craft ability comes from the keyword's expansion (keywords/data/craft.json): its key is the one the engine lists for the bench
    const craft = legal(s, 'p1', 'activate').find((a) => a.object === bench && !a.isMana)!.action;
    s = resolveAll(settle(act(s, craft), { picks: [[gnome]] }), { picks: [[gnome]] });
    expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Craft Gnome')).toBe(true);
    expect(life(s, 'p1')).toBe(21);
    expect(handSize(s, 'p1')).toBe(hand + 1);
    let t = scenario(BASICS, { p1: { hand: ['Test Exile Ray'], battlefield: ['Test Craft Gnome'] }, defs: DEFS });
    t = resolveAll(cast(t, 'Test Exile Ray', { targets: [[obj(find(t, 'Test Craft Gnome', 'battlefield', 'p1'))]] }));
    expect(life(t, 'p1')).toBe(20);
  });
});
