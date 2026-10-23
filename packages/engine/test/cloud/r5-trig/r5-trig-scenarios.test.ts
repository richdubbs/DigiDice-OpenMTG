/**
 * Standard round 5, slice r5-trig (trigger conditions, CR 603): the engine behavior of the trigger events and intervening "if" clauses this slice reads, played
 * through applyAction with synthetic cards compiled by the game's default compiler (invented wordings, design 6.10). Nothing is mocked. Each describe is named
 * after the rule it checks; the template, lowering and render side is in r5-trig-templates.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type AbilityDef, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, legal, life, passBoth, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { runCombat, tweak } from '../../m4/helpers';

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
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]!.counters[kind] ?? 0;
const ready = (s: GameState): GameState => tweak(s, (x) => { for (const id of x.zones.battlefield) x.objects[id]!.controlledSinceTurn = 0; });
const named = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name);
const BASICS = ['Mountain', 'Island', 'Swamp', 'Forest', 'Plains'];
const BEAR = card('Test Grove Bear', 'Creature — Bear', '', '{0}', ['2', '2']);

describe('CR 603.4, 603.2c: "if it\'s the first time that creature has become tapped this turn" (cond firstTime)', () => {
  const LEGEND = card('Test Rally Legend', 'Legendary Creature — Human Soldier', 'Whenever a creature you control becomes tapped during your turn, if it\'s the first time that creature has become tapped this turn, untap it.', '{0}', ['1', '1']);
  const TAPPER = card('Test Tap Squire', 'Creature — Human', '{T}: You gain 1 life.', '{0}', ['1', '1']);
  const DEFS = [LEGEND, TAPPER, BEAR];
  it('is automated with the condition firstTime over the event\'s creature', () => {
    expect(manualParts(LEGEND)).toEqual([]);
    expect(LEGEND.faces[0]!.abilities[0]).toMatchObject({ interveningIf: { cond: 'firstTime', object: { ref: 'event', role: 'subject' }, event: { ev: 'becomes', what: 'tapped' } } });
  });
  it('the first tap of a creature untaps it; the second tap of the same creature this turn does not; another creature\'s first tap still does', () => {
    let s = ready(scenario(BASICS, { p1: { battlefield: ['Test Rally Legend', 'Test Tap Squire', 'Test Grove Bear'] }, defs: DEFS }));
    const squire = named(s, 'Test Tap Squire')[0]!;
    const bear = named(s, 'Test Grove Bear')[0]!;
    s = resolveAll(settle(act(s, { type: 'activate', player: 'p1', source: squire, ability: 'p:0:0' })));
    expect(s.objects[squire]!.tapped).toBe(false); // the first time: untapped
    s = resolveAll(settle(act(s, { type: 'activate', player: 'p1', source: squire, ability: 'p:0:0' })));
    expect(s.objects[squire]!.tapped).toBe(true); // the second time this turn: stays tapped
    s = resolveAll(runCombat(s, { attack: [[bear, 'p2']], until: 'declareBlockers' }));
    expect(s.objects[bear]!.tapped).toBe(false); // the bear's own first time
  });
});

describe('CR 603.4, 603.2c, 122.1: "if it\'s the first time counters have been put on that creature this turn" (one occurrence per creature; two kinds at once are one time)', () => {
  const HEIR = card('Test Steadfast Heir', 'Creature — Human Soldier', 'Whenever one or more counters are put on a creature you control, if it\'s the first time counters have been put on that creature this turn, put a +1/+1 counter on that creature.', '{0}', ['2', '2']);
  const GROW = card('Test Double Growth', 'Instant', 'Put two +1/+1 counters on target creature.', '{0}');
  const MIXED = card('Test Feathered Boon', 'Instant', 'Put a +1/+1 counter and a flying counter on target creature.', '{0}');
  const DEFS = [HEIR, GROW, MIXED, BEAR];
  it('is automated; "that creature" is the one creature of the occurrence', () => {
    expect(manualParts(HEIR)).toEqual([]);
    expect(HEIR.faces[0]!.abilities[0]).toMatchObject({ trigger: { batch: true }, interveningIf: { cond: 'firstTime', object: { ref: 'event', role: 'subject' }, event: { ev: 'counters', change: 'put' } } });
  });
  it('the first counters get one more; the trigger\'s own counter and a later spell are a second time', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Double Growth', 'Test Double Growth'], battlefield: ['Test Steadfast Heir', 'Test Grove Bear'] }, defs: DEFS });
    const bear = named(s, 'Test Grove Bear')[0]!;
    s = resolveAll(cast(s, 'Test Double Growth', { targets: [[obj(bear)]] }));
    expect(counters(s, bear)).toBe(3);
    s = resolveAll(cast(s, 'Test Double Growth', { targets: [[obj(bear)]] }));
    expect(counters(s, bear)).toBe(5);
  });
  it('a +1/+1 counter and a flying counter put at once are one time: one more counter', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Feathered Boon'], battlefield: ['Test Steadfast Heir', 'Test Grove Bear'] }, defs: DEFS });
    const bear = named(s, 'Test Grove Bear')[0]!;
    s = resolveAll(cast(s, 'Test Feathered Boon', { targets: [[obj(bear)]] }));
    expect(counters(s, bear)).toBe(2);
    expect(counters(s, bear, 'flying')).toBe(1);
  });
  it('an opponent\'s creature is not one "you control"', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Double Growth'], battlefield: ['Test Steadfast Heir'] }, p2: { battlefield: ['Test Grove Bear'] }, defs: DEFS });
    const bear = named(s, 'Test Grove Bear')[0]!;
    s = resolveAll(cast(s, 'Test Double Growth', { targets: [[obj(bear)]] }));
    expect(counters(s, bear)).toBe(2);
  });
});

describe('CR 702.122b, 702.171c: "Whenever this creature saddles a Mount or crews a Vehicle during your main phase" (becomes crewCostPaid / saddleCostPaid by it)', () => {
  const LEAPER = card('Test Canyon Leaper', 'Creature — Human Pilot', 'Whenever this creature saddles a Mount or crews a Vehicle during your main phase, that Mount or Vehicle gains flying until end of turn.', '{0}', ['2', '2']);
  const CART = card('Test Ridge Cart', 'Artifact — Vehicle', 'Crew 1', '{0}', ['3', '3']);
  const HORSE = card('Test Dust Horse', 'Creature — Horse Mount', 'Saddle 1', '{0}', ['3', '3']);
  const DEFS = [LEAPER, CART, HORSE, BEAR];
  /** Activate the one non-mana ability of `id`, tapping `picks` for its cost. */
  const activate = (s: GameState, id: ObjectId, picks: ObjectId[]): GameState => {
    const la = legal(s, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
    if (!la) throw new Error('no activated ability');
    return resolveAll(settle(act(s, la.action), { picks: [picks] }));
  };
  const flying = (s: GameState, id: ObjectId): boolean => getChars(s, id)!.keywords.some((k) => k.keyword === 'flying');
  const start = (): GameState => ready(scenario(BASICS, { p1: { battlefield: ['Test Canyon Leaper', 'Test Ridge Cart', 'Test Dust Horse', 'Test Grove Bear'] }, defs: DEFS }));
  it('is automated: two events with the creature as `by`, the permanent as "that Mount or Vehicle"', () => {
    expect(manualParts(LEAPER)).toEqual([]);
    expect(LEAPER.faces[0]!.abilities[0]).toMatchObject({ trigger: { on: [{ ev: 'becomes', what: 'saddleCostPaid', object: { subtypes: ['Mount'] }, by: { self: true } }, { ev: 'becomes', what: 'crewCostPaid', object: { subtypes: ['Vehicle'] }, by: { self: true } }], while: { cond: 'turnOf', whose: 'you' } } });
  });
  it('crewing a Vehicle with it in a main phase gives the Vehicle flying; crewing with another creature does not', () => {
    let s = start();
    const cart = named(s, 'Test Ridge Cart')[0]!;
    s = activate(s, cart, [named(s, 'Test Canyon Leaper')[0]!]);
    expect(getChars(s, cart)!.types).toContain('Creature');
    expect(flying(s, cart)).toBe(true);
    let t = start();
    const cart2 = named(t, 'Test Ridge Cart')[0]!;
    t = activate(t, cart2, [named(t, 'Test Grove Bear')[0]!]);
    expect(getChars(t, cart2)!.types).toContain('Creature');
    expect(flying(t, cart2)).toBe(false);
  });
  it('saddling a Mount with it gives the Mount flying', () => {
    let s = start();
    const horse = named(s, 'Test Dust Horse')[0]!;
    s = activate(s, horse, [named(s, 'Test Canyon Leaper')[0]!]);
    expect(flying(s, horse)).toBe(true);
    expect(flying(s, named(s, 'Test Ridge Cart')[0]!)).toBe(false);
  });
  it('crewing in the beginning of combat step (not a main phase) does nothing', () => {
    let s = advanceTo(start(), 1, 'beginCombat');
    const cart = named(s, 'Test Ridge Cart')[0]!;
    s = activate(s, cart, [named(s, 'Test Canyon Leaper')[0]!]);
    expect(getChars(s, cart)!.types).toContain('Creature');
    expect(flying(s, cart)).toBe(false);
  });
});

describe('CR 702.122c, 603.2: "Whenever a Vehicle crewed by ~ this turn attacks" (filter crewedBySourceThisTurn, read from the history)', () => {
  const PILOT = card('Test Rabbit Pilot', 'Legendary Creature — Human Rabbit', 'Whenever a Vehicle crewed by Test Rabbit Pilot this turn attacks, you gain 3 life.', '{0}', ['2', '2']);
  const CART = card('Test Ridge Cart', 'Artifact — Vehicle', 'Crew 1', '{0}', ['3', '3']);
  const DEFS = [PILOT, CART, BEAR];
  const crew = (s: GameState, cart: ObjectId, by: ObjectId): GameState => {
    const la = legal(s, 'p1', 'activate').find((a) => a.object === cart && !a.isMana);
    if (!la) throw new Error('no crew ability');
    return resolveAll(settle(act(s, la.action), { picks: [[by]] }));
  };
  it('is automated', () => {
    expect(manualParts(PILOT)).toEqual([]);
    expect(PILOT.faces[0]!.abilities[0]).toMatchObject({ trigger: { on: [{ ev: 'attacks', attacker: { subtypes: ['Vehicle'], crewedBySourceThisTurn: true } }] } });
  });
  it('a Vehicle it crewed attacks: you gain 3 life; one another creature crewed: nothing', () => {
    for (const [who, gain] of [['Test Rabbit Pilot', 3], ['Test Grove Bear', 0]] as const) {
      let s = ready(scenario(BASICS, { p1: { battlefield: ['Test Rabbit Pilot', 'Test Ridge Cart', 'Test Grove Bear'] }, defs: DEFS }));
      const cart = named(s, 'Test Ridge Cart')[0]!;
      s = crew(s, cart, named(s, who)[0]!);
      const before = life(s, 'p1');
      s = resolveAll(runCombat(s, { attack: [[cart, 'p2']], until: 'declareBlockers' }));
      expect(life(s, 'p1') - before, who).toBe(gain);
    }
  });
});

describe('CR 603.2c, 603.4, 601.2h: "Whenever ~ and/or one or more other nontoken creatures you control enter, if none of them were cast or no mana was spent to cast them"', () => {
  const SPY = card('Test Quiet Spy', 'Creature — Human Ninja', 'Whenever this creature and/or one or more other nontoken creatures you control enter, if none of them were cast or no mana was spent to cast them, draw a card.', '{0}', ['1', '1']);
  const PAID = card('Test Paid Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const FREE = card('Test Free Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const RAISE = card('Test Raise', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.', '{0}');
  const DEFS = [SPY, PAID, FREE, RAISE];
  const hand = (s: GameState): number => s.zones.hand['p1']!.length;
  it('is automated: one batch trigger over the object and the others, every one of them not cast with mana', () => {
    expect(manualParts(SPY)).toEqual([]);
    expect(SPY.faces[0]!.abilities[0]).toMatchObject({ trigger: { batch: true, on: [{ subject: { self: true } }, { subject: { other: true, token: false } }] }, interveningIf: { cond: 'matches', filter: { castWithMana: false } } });
  });
  it('a creature cast with mana spent draws nothing; one cast for {0} draws; one returned from the graveyard (not cast) draws', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Paid Bear', 'Test Free Bear', 'Test Raise'], graveyard: ['Test Free Bear'], battlefield: ['Test Quiet Spy', 'Mountain'] }, defs: DEFS });
    let h = hand(s);
    s = resolveAll(cast(s, 'Test Paid Bear'));
    expect(hand(s)).toBe(h - 1);
    h = hand(s);
    s = resolveAll(cast(s, 'Test Free Bear'));
    expect(hand(s)).toBe(h - 1 + 1);
    h = hand(s);
    s = resolveAll(cast(s, 'Test Raise', { targets: [[obj(find(s, 'Test Free Bear', 'graveyard', 'p1'))]] }));
    expect(hand(s)).toBe(h - 1 + 1);
  });
  it('the object itself entering, cast for mana, draws nothing; cast for {0} draws', () => {
    for (const [cost, draws] of [['{1}', 0], ['{0}', 1]] as const) {
      const me = card('Test Quiet Spy', 'Creature — Human Ninja', 'Whenever this creature and/or one or more other nontoken creatures you control enter, if none of them were cast or no mana was spent to cast them, draw a card.', cost, ['1', '1']);
      let s = scenario(BASICS, { p1: { hand: ['Test Quiet Spy'], battlefield: ['Mountain'] }, defs: [me] });
      const h = hand(s);
      s = resolveAll(cast(s, 'Test Quiet Spy'));
      expect(hand(s), cost).toBe(h - 1 + draws);
    }
  });
});

describe('CR 603.4, 603.6a, 400.7: "if one or more of them entered from exile or was cast from exile" (cond someMatch, filter enteredFrom)', () => {
  const ROAD = card('Test Far Road', 'Enchantment', 'Whenever one or more nontoken creatures enter, if one or more of them entered from exile or was cast from exile, you draw a card.', '{0}');
  const BLINK = card('Test Blink', 'Instant', "Exile target creature you control, then return it to the battlefield under its owner's control.", '{0}');
  const DEFS = [ROAD, BLINK, BEAR];
  const hand = (s: GameState): number => s.zones.hand['p1']!.length;
  it('is automated', () => {
    expect(manualParts(ROAD)).toEqual([]);
    expect(ROAD.faces[0]!.abilities[0]).toMatchObject({ interveningIf: { cond: 'someMatch', filter: { anyOf: [{ enteredFrom: 'exile' }, { castFrom: 'exile' }] } } });
  });
  it('a creature cast from hand draws nothing; a creature returned from exile draws', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Grove Bear', 'Test Blink'], battlefield: ['Test Far Road'] }, defs: DEFS });
    let h = hand(s);
    s = resolveAll(cast(s, 'Test Grove Bear'));
    expect(hand(s)).toBe(h - 1);
    h = hand(s);
    s = resolveAll(cast(s, 'Test Blink', { targets: [[obj(named(s, 'Test Grove Bear')[0]!)]] }));
    expect(hand(s)).toBe(h - 1 + 1);
  });
});

/** A transforming double-faced card compiled by the default compiler from invented text on each face. */
function transformCard(front: { name: string; type: string; text: string; pt?: [string, string] }, back: { name: string; type: string; text: string; pt?: [string, string] }): CardDef {
  const face = (f: typeof front, cost: string) => ({ name: f.name, type_line: f.type, mana_cost: cost, oracle_text: f.text, colors: [], ...(f.pt ? { power: f.pt[0], toughness: f.pt[1] } : {}) });
  return compileCard({ name: `${front.name} // ${back.name}`, layout: 'transform', type_line: `${front.type} // ${back.type}`, mana_cost: '{1}{R}', colors: [], card_faces: [face(front, '{1}{R}'), face(back, '')] } as unknown as OracleCard);
}

describe('CR 120.1, 510.2, 511.1, 701.3a: "At end of combat on your turn, if a player was dealt 6 or more combat damage this turn, transform this enchantment, then attach it to a creature you control"', () => {
  const QUEST = transformCard(
    { name: 'Test Ball Quest', type: 'Enchantment', text: 'At end of combat on your turn, if a player was dealt 6 or more combat damage this turn, transform this enchantment, then attach it to a creature you control.' },
    { name: 'Test Champion Blade', type: 'Legendary Artifact — Equipment', text: 'Equipped creature gets +2/+0.' },
  );
  const OGRE = card('Test Tall Ogre', 'Creature — Ogre', '', '{0}', ['4', '1']);
  const DEFS = [QUEST, OGRE, BEAR];
  const QN = 'Test Ball Quest // Test Champion Blade';
  it('is automated: the per-player total of the turn\'s combat damage, then a chosen creature', () => {
    expect(manualParts(QUEST)).toEqual([]);
    expect(QUEST.faces[0]!.abilities[0]).toMatchObject({ interveningIf: { cond: 'compare', left: { q: 'happenedCount', per: 'player', sum: 'amount', event: { ev: 'damage', combat: true } }, op: '>=', right: 6 } });
  });
  it('4 + 2 combat damage to one player (two sources) transforms it and attaches it to the chosen creature; 4 alone does nothing', () => {
    let s = ready(scenario(BASICS, { p1: { battlefield: [QN, 'Test Tall Ogre', 'Test Grove Bear'] }, defs: DEFS }));
    const quest = find(s, QN, 'battlefield', 'p1');
    const [ogre, bear] = [named(s, 'Test Tall Ogre')[0]!, named(s, 'Test Grove Bear')[0]!];
    s = resolveAll(runCombat(s, { attack: [[ogre, 'p2'], [bear, 'p2']] }), { picks: [[bear]] });
    expect(getChars(s, quest)!.subtypes).toContain('Equipment');
    expect(s.objects[quest]!.attachedTo).toBe(bear);
    expect(String(getChars(s, bear)!.power)).toBe('4');
    let t = ready(scenario(BASICS, { p1: { battlefield: [QN, 'Test Tall Ogre', 'Test Grove Bear'] }, defs: DEFS }));
    const quest2 = find(t, QN, 'battlefield', 'p1');
    t = resolveAll(runCombat(t, { attack: [[named(t, 'Test Tall Ogre')[0]!, 'p2']] }), { picks: [[named(t, 'Test Grove Bear')[0]!]] });
    expect(getChars(t, quest2)!.types).toContain('Enchantment');
    expect(t.objects[quest2]!.attachedTo).toBeUndefined();
  });
});

describe('CR 603.2c, 122.6: "Whenever you put one or more +1/+1 counters on one or more other Heroes you control" (one occurrence for the whole batch, TriggerDef.wholeBatch)', () => {
  const LEADER = card('Test Hero Leader', 'Creature — Human Hero', 'Whenever you put one or more +1/+1 counters on one or more other Heroes you control, you gain 1 life.', '{0}', ['2', '2']);
  const SIDEKICK = card('Test Sidekick', 'Creature — Human Hero', '', '{0}', ['1', '1']);
  const RALLY = card('Test Rally', 'Sorcery', 'Put a +1/+1 counter on each creature you control.', '{0}');
  const BOOST = card('Test Boost', 'Instant', 'Put a +1/+1 counter on target creature.', '{0}');
  const DEFS = [LEADER, SIDEKICK, RALLY, BOOST, BEAR];
  it('is automated as one trigger for the batch', () => {
    expect(manualParts(LEADER)).toEqual([]);
    expect(LEADER.faces[0]!.abilities[0]).toMatchObject({ trigger: { batch: true, wholeBatch: true, on: [{ ev: 'counters', by: 'you', kind: '+1/+1', on: { subtypes: ['Hero'], other: true, controller: 'you' } }] } });
  });
  it('counters on two other Heroes at once: 1 life; on itself or on a non-Hero only: nothing', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Rally', 'Test Boost', 'Test Boost'], battlefield: ['Test Hero Leader', 'Test Sidekick', 'Test Sidekick', 'Test Grove Bear'] }, defs: DEFS });
    let l = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Rally'));
    expect(life(s, 'p1') - l).toBe(1);
    l = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Boost', { targets: [[obj(named(s, 'Test Hero Leader')[0]!)]] }));
    expect(life(s, 'p1') - l).toBe(0);
    s = resolveAll(cast(s, 'Test Boost', { targets: [[obj(named(s, 'Test Grove Bear')[0]!)]] }));
    expect(life(s, 'p1') - l).toBe(0);
  });
});

describe('CR 107.4, 202.1, 111.2: "Whenever you cast a noncreature spell with one or more blue mana symbols in its mana cost, create that many ... tokens"', () => {
  const PRINCE = card('Test Tide Prince', 'Legendary Creature — Merfolk Noble', 'Whenever you cast a noncreature spell with one or more blue mana symbols in its mana cost, create that many 1/1 blue Merfolk creature tokens.', '{0}', ['2', '2']);
  const DOUBLE = card('Test Deep Study', 'Instant', 'Draw a card.', '{U}{U}');
  const HYBRID = card('Test Storm Study', 'Sorcery', 'You gain 1 life.', '{1}{U/R}');
  const PLAIN = card('Test Plain Study', 'Sorcery', 'You gain 1 life.', '{1}');
  const FISH = card('Test Blue Fish', 'Creature — Fish', '', '{U}', ['1', '1']);
  const DEFS = [PRINCE, DOUBLE, HYBRID, PLAIN, FISH];
  const tokens = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1').length;
  const start = (hand: string): GameState => scenario(BASICS, { p1: { hand: [hand], battlefield: ['Test Tide Prince', 'Island', 'Island', 'Mountain'] }, defs: DEFS });
  it('is automated: "that many" is the number of blue mana symbols in that spell\'s mana cost', () => {
    expect(manualParts(PRINCE)).toEqual([]);
    expect(PRINCE.faces[0]!.abilities[0]).toMatchObject({ trigger: { on: [{ ev: 'cast', spell: { manaSymbols: { color: 'U', cmp: { op: '>=', value: 1 } } } }] }, effect: { steps: [{ op: 'createToken', count: { q: 'manaSymbols', color: 'U', of: { ref: 'event', role: 'spell' } } }] } });
  });
  it('{U}{U}: two tokens; {1}{U/R} (a hybrid symbol is blue): one; {1}: none; a blue creature spell: none', () => {
    for (const [name, want] of [['Test Deep Study', 2], ['Test Storm Study', 1], ['Test Plain Study', 0], ['Test Blue Fish', 0]] as const) {
      const s = resolveAll(cast(start(name), name));
      expect(tokens(s), name).toBe(want);
    }
  });
});

describe('CR 502.3, 603.2c, 603.8: "Whenever you untap one or more permanents during your untap step, put that many time counters on ~"; "When there are 1,000 or more ..."', () => {
  const CAL = card('Test Long Calendar', 'Legendary Artifact', 'Whenever you untap one or more permanents during your untap step, put that many time counters on Test Long Calendar.\nWhen there are 1,000 or more time counters on Test Long Calendar, sacrifice it and each opponent loses 1,000 life.', '{1}');
  const DEFS = [CAL, BEAR];
  const time = (s: GameState): number => { const id = named(s, 'Test Long Calendar')[0]; return id === undefined ? -1 : s.objects[id]!.counters['time'] ?? 0; };
  it('is automated: one batch of the untap step\'s untaps, "that many" the number untapped; "1,000" is one number', () => {
    expect(manualParts(CAL)).toEqual([]);
    expect(CAL.faces[0]!.abilities[0]).toMatchObject({ trigger: { batch: true, on: [{ ev: 'becomes', what: 'untapped', untapStep: true, object: { controller: 'you' } }] }, effect: { steps: [{ op: 'putCounters', count: { q: 'eventAmount' } }] } });
    expect(JSON.stringify(CAL.faces[0]!.abilities[1])).toContain('1000');
  });
  it('three of your tapped permanents untap in your untap step: 3 time counters; the opponent\'s untap step adds none', () => {
    let s = scenario(BASICS, { p1: { battlefield: ['Test Long Calendar', 'Mountain', 'Island', 'Test Grove Bear'] }, p2: { battlefield: ['Forest', 'Swamp'] }, defs: DEFS });
    s = tweak(s, (x) => { for (const id of x.zones.battlefield) if (x.defs[x.objects[id]!.defId]!.name !== 'Test Long Calendar') x.objects[id]!.tapped = true; });
    s = resolveAll(advanceTo(s, 2, 'upkeep'));
    expect(time(s)).toBe(0); // the opponent untapped their two lands
    s = resolveAll(advanceTo(s, 3, 'upkeep'));
    expect(time(s)).toBe(3);
  });
  it('1,000 time counters: it is sacrificed and each opponent loses 1,000 life', () => {
    let s = scenario(BASICS, { p1: { battlefield: ['Test Long Calendar'] }, defs: DEFS });
    s = tweak(s, (x) => { x.objects[named(x, 'Test Long Calendar')[0]!]!.counters['time'] = 999; });
    s = resolveAll(tweak(s, (x) => { x.objects[named(x, 'Test Long Calendar')[0]!]!.counters['time'] = 1000; }));
    s = resolveAll(passBoth(s));
    expect(named(s, 'Test Long Calendar')).toEqual([]);
    expect(life(s, 'p2')).toBe(20 - 1000);
  });
});

describe('CR 305.1, 601.2a, 603.4: "if you\'ve played a land or cast a spell this turn from anywhere other than your hand" (cast and land play `notFrom`, read from the history)', () => {
  const WEB = card('Test Future Web', 'Enchantment', "You may play lands from your graveyard.\nYou may cast creature spells from your graveyard.\nAt the beginning of your end step, if you've played a land or cast a spell this turn from anywhere other than your hand, you gain 3 life.", '{0}');
  const DEFS = [WEB, BEAR];
  const toEnd = (s: GameState): GameState => resolveAll(advanceTo(s, 1, 'end'));
  it('is automated', () => {
    expect(manualParts(WEB)).toEqual([]);
    expect(WEB.faces[0]!.abilities.find((a) => a.kind === 'triggered')).toMatchObject({ interveningIf: { cond: 'any', of: [{ event: { ev: 'action', verb: 'playLand', notFrom: 'hand' } }, { event: { ev: 'cast', notFrom: 'hand' } }] } });
  });
  it('a land played from the graveyard: 3 life; a creature cast from the graveyard: 3 life; a land and a creature from the hand only: nothing', () => {
    let s = scenario(BASICS, { p1: { graveyard: ['Mountain'], battlefield: ['Test Future Web'] }, defs: DEFS });
    s = resolveAll(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Mountain', 'graveyard', 'p1') }));
    expect(life(toEnd(s), 'p1')).toBe(23);
    let t = scenario(BASICS, { p1: { graveyard: ['Test Grove Bear'], battlefield: ['Test Future Web'] }, defs: DEFS });
    t = resolveAll(settle(act(t, { type: 'cast', player: 'p1', card: find(t, 'Test Grove Bear', 'graveyard', 'p1') })));
    expect(life(toEnd(t), 'p1')).toBe(23);
    let u = scenario(BASICS, { p1: { hand: ['Mountain', 'Test Grove Bear'], battlefield: ['Test Future Web'] }, defs: DEFS });
    u = resolveAll(act(u, { type: 'playLand', player: 'p1', card: find(u, 'Mountain', 'hand', 'p1') }));
    u = resolveAll(cast(u, 'Test Grove Bear'));
    expect(life(toEnd(u), 'p1')).toBe(20);
  });
});

describe('CR 601.2i, 603.2: "Whenever you cast a spell during your turn other than your first spell that turn" (cast nthMin 2)', () => {
  const FLESH = card('Test Flesh Sculptor', 'Creature — Human Wizard', 'Whenever you cast a spell during your turn other than your first spell that turn, you gain 1 life.', '{0}', ['2', '2']);
  const SPARK = card('Test Spark', 'Instant', 'You gain 0 life.', '{0}');
  const DEFS = [FLESH, SPARK];
  it('is automated', () => {
    expect(manualParts(FLESH)).toEqual([]);
    expect(FLESH.faces[0]!.abilities[0]).toMatchObject({ trigger: { on: [{ ev: 'cast', player: 'you', nthMin: 2 }], while: { cond: 'turnOf', whose: 'you' } } });
  });
  it('the first spell of the turn: nothing; the second and the third: 1 life each', () => {
    let s = scenario(BASICS, { p1: { hand: ['Test Spark', 'Test Spark', 'Test Spark'], battlefield: ['Test Flesh Sculptor'] }, defs: DEFS });
    const l = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Spark'));
    expect(life(s, 'p1')).toBe(l);
    s = resolveAll(cast(s, 'Test Spark'));
    expect(life(s, 'p1')).toBe(l + 1);
    s = resolveAll(cast(s, 'Test Spark'));
    expect(life(s, 'p1')).toBe(l + 2);
  });
});
