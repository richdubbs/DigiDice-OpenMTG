/**
 * Commander lane edh-cast, round edh-cast-5: scenarios with synthetic cards (invented names, design 6.10), compiled by the default compiler.
 * CR cites are from the Comprehensive Rules 2026-09-25 (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt) where the round checked them.
 *
 *   CR 118.1, 119.4, 107.4f, 601.2h   "For each {B} in a cost, you may pay 2 life rather than pay that mana." (K'rrik): any cost, each such symbol, never generic mana
 *   CR 118.8, 601.2b, 601.2f, 119.4   "As an additional cost to cast green permanent spells, you may pay 2 life. Those spells cost {G} less ..." (Defiler of Vigor): the spells
 *                                      its filter describes, one symbol of the spell, the pure reduction of one {G}
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, castAuto, find, legal, life, passBoth, put, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [] } as OracleCard);
}

const castable = (s: GameState, player: 'p1' | 'p2', name: string): boolean => legalActions(s, player).some((l) => l.kind === 'cast' && l.object === find(s, name, 'hand', player));
const tappedCount = (s: GameState, name: string): number => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name && s.objects[id]!.tapped).length;

describe('CR 118.1, 119.4, 107.4f: "For each {R} in a cost, you may pay 2 life rather than pay that mana."', () => {
  const GRAVE = card('Test Gravewright', 'Artifact', 'For each {R} in a cost, you may pay 2 life rather than pay that mana.');
  const TWO = card('Test Twin Spark', 'Instant', 'Draw a card.', { cost: '{R}{R}' });
  const GENERIC = card('Test Wide Spark', 'Instant', 'Draw a card.', { cost: '{2}{R}' });
  const HYBRID = card('Test Split Spark', 'Instant', 'Draw a card.', { cost: '{R/G}{R/G}' });
  const MONO = card('Test Cheap Spark', 'Instant', 'Draw a card.', { cost: '{2/R}{2/R}' });
  const BLUE = card('Test Blue Spark', 'Instant', 'Draw a card.', { cost: '{U}{U}' });
  const WELL = card('Test Red Well', 'Artifact', '{R}, {T}: Draw a card.');
  const DEFS = [GRAVE, TWO, GENERIC, HYBRID, MONO, BLUE, WELL];
  it('the synthetic card is automated', () => {
    expect(GRAVE.automation.level).toBe('full');
  });
  it('one Mountain and 2 life pay {R}{R}; the cast takes the life and taps the Mountain', () => {
    const s = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Twin Spark'], battlefield: ['Mountain', 'Test Gravewright'] } });
    expect(castable(s, 'p1', 'Test Twin Spark')).toBe(true);
    const t = castAuto(s, 'Test Twin Spark');
    expect(life(t, 'p1')).toBe(18);
    expect(tappedCount(t, 'Mountain')).toBe(1);
  });
  it('with two Mountains the mana pays and no life is paid (mana is preferred)', () => {
    const s = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Twin Spark'], battlefield: ['Mountain', 'Mountain', 'Test Gravewright'] } });
    const t = castAuto(s, 'Test Twin Spark');
    expect(life(t, 'p1')).toBe(20);
    expect(tappedCount(t, 'Mountain')).toBe(2);
  });
  it('with no Mountain at all, 4 life pay {R}{R}', () => {
    const s = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Twin Spark'], battlefield: ['Test Gravewright'] } });
    expect(castable(s, 'p1', 'Test Twin Spark')).toBe(true);
    expect(life(castAuto(s, 'Test Twin Spark'), 'p1')).toBe(16);
  });
  it('the permission covers an activation cost: {R}, {T} is paid with 2 life', () => {
    const s = scenario(['Mountain'], { defs: DEFS, p1: { battlefield: ['Test Red Well', 'Test Gravewright'] } });
    expect(legalActions(s, 'p1').some((l) => l.kind === 'activate' && l.isMana !== true && l.object === find(s, 'Test Red Well', 'battlefield', 'p1'))).toBe(true);
  });
  it('a hybrid symbol of that color ({R/G}) and the colored half of {2/R} can be paid with life', () => {
    const base = { battlefield: ['Test Gravewright'] };
    expect(castable(scenario(['Mountain'], { defs: DEFS, p1: { ...base, hand: ['Test Split Spark'] } }), 'p1', 'Test Split Spark')).toBe(true);
    expect(castable(scenario(['Mountain'], { defs: DEFS, p1: { ...base, hand: ['Test Cheap Spark'] } }), 'p1', 'Test Cheap Spark')).toBe(true);
  });
  it('the human player is asked: the payment decision lists the symbols payable with life and is never the only way (review finding)', () => {
    const s = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Twin Spark'], battlefield: ['Mountain', 'Mountain', 'Test Gravewright'] } });
    const t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Twin Spark', 'hand', 'p1') });
    expect(t.pending).toMatchObject({ kind: 'payCost', lifeSymbols: [0, 1] });
    expect((t.pending as { onlyWay?: boolean }).onlyWay).toBeUndefined();
    const m = (t.pending as { manaSources: { objectId: string; abilityKey: string }[] }).manaSources[0]!;
    const u = answer(t, { kind: 'payCost', auto: false, activations: [{ objectId: m.objectId, abilityKey: m.abilityKey }], lifeForPhyrexian: [1] });
    expect(life(u, 'p1')).toBe(18);
    expect(tappedCount(u, 'Mountain')).toBe(1);
  });
  it('negative: without the permanent one Mountain does not pay {R}{R}', () => {
    const s = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Twin Spark'], battlefield: ['Mountain'] } });
    expect(castable(s, 'p1', 'Test Twin Spark')).toBe(false);
  });
  it('negative: generic mana is never paid with life ({2}{R} with one Mountain)', () => {
    const s = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Wide Spark'], battlefield: ['Mountain', 'Test Gravewright'] } });
    expect(castable(s, 'p1', 'Test Wide Spark')).toBe(false);
  });
  it('negative: a symbol of another color ({U}{U}) is not paid with life', () => {
    const s = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Blue Spark'], battlefield: ['Test Gravewright'] } });
    expect(castable(s, 'p1', 'Test Blue Spark')).toBe(false);
  });
  it("negative: a player with 1 life can't pay 2 life (CR 119.4)", () => {
    const s = scenario(['Mountain'], { defs: DEFS, life: 1, p1: { hand: ['Test Twin Spark'], battlefield: ['Mountain', 'Test Gravewright'] } });
    expect(castable(s, 'p1', 'Test Twin Spark')).toBe(false);
  });
  it("negative: the opponent's costs are not changed", () => {
    const s0 = scenario(['Mountain'], { defs: DEFS, p1: { battlefield: ['Test Gravewright'] }, p2: { hand: ['Test Twin Spark'], battlefield: ['Mountain'] } });
    const s = castable(s0, 'p2', 'Test Twin Spark');
    expect(s).toBe(false);
  });
});

describe('CR 118.8, 601.2f, 119.4: "As an additional cost to cast red permanent spells, you may pay 2 life. Those spells cost {R} less ..."', () => {
  const SMITH = card('Test Bloodsmith', 'Artifact', 'As an additional cost to cast red permanent spells, you may pay 2 life. Those spells cost {R} less to cast if you paid life this way. This effect reduces only the amount of red mana you pay.');
  const BEAST = card('Test Red Beast', 'Creature — Beast', 'Haste', { cost: '{1}{R}{R}', colors: ['R'] });
  const BOLT = card('Test Red Bolt', 'Instant', 'Draw a card.', { cost: '{R}{R}', colors: ['R'] });
  const GREENBEAST = card('Test Green Beast', 'Creature — Beast', 'Trample', { cost: '{G}{G}', colors: ['G'] });
  const DEFS = [SMITH, BEAST, BOLT, GREENBEAST];
  it('the synthetic card is automated', () => {
    expect(SMITH.automation.level).toBe('full');
  });
  it('a red permanent spell: 2 life take one {R} off, so {1}{R}{R} is paid with {1}{R} and 2 life', () => {
    const s = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Red Beast'], battlefield: ['Mountain', 'Mountain', 'Test Bloodsmith'] } });
    expect(castable(s, 'p1', 'Test Red Beast')).toBe(true);
    const t = castAuto(s, 'Test Red Beast');
    expect(life(t, 'p1')).toBe(18);
    expect(tappedCount(t, 'Mountain')).toBe(2);
  });
  it('only once per spell: {R}{R} with no Mountain is not payable with 4 life', () => {
    const s = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Red Beast'], battlefield: ['Test Bloodsmith'] } });
    expect(castable(s, 'p1', 'Test Red Beast')).toBe(false);
  });
  it('it does not reduce generic mana: {1}{R}{R} with one Mountain and 2 life is not payable', () => {
    const s = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Red Beast'], battlefield: ['Mountain', 'Test Bloodsmith'] } });
    expect(castable(s, 'p1', 'Test Red Beast')).toBe(false);
  });
  it('negative: a red instant is not a permanent spell', () => {
    const s = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Red Bolt'], battlefield: ['Mountain', 'Test Bloodsmith'] } });
    expect(castable(s, 'p1', 'Test Red Bolt')).toBe(false);
  });
  it('negative: a green permanent spell is not red', () => {
    const s = scenario(['Mountain', 'Forest'], { defs: DEFS, p1: { hand: ['Test Green Beast'], battlefield: ['Forest', 'Test Bloodsmith'] } });
    expect(castable(s, 'p1', 'Test Green Beast')).toBe(false);
  });
  it("negative: the opponent's red permanent spell is not changed", () => {
    const s = scenario(['Mountain'], { defs: DEFS, p1: { battlefield: ['Test Bloodsmith'] }, p2: { hand: ['Test Red Beast'], battlefield: ['Mountain', 'Mountain'] } });
    expect(castable(s, 'p2', 'Test Red Beast')).toBe(false);
  });
});

/** Answer every decision but priority from the script (defaults: the minimum, the first `min` options, pay automatically). */
function drive(s0: GameState, numbers: number[] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: numbers.shift() ?? p.min });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: s.zones.stack.filter((id) => s.objects[id]!.kind === 'card').slice(0, 1).map((id) => ({ kind: 'object' as const, id })) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const castDriven = (s: GameState, name: string, numbers?: number[]): GameState => drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), numbers);
const inExile = (s: GameState, name: string): number => s.zones.exile.filter((id) => s.defs[s.objects[id]!.defId]!.name === name).length;

describe('CR 118.8, 601.2b, 601.2f: "you may exile any number of blue cards from your hand. This spell costs {2} less to cast for each card exiled this way."', () => {
  const MIST = card('Test Mistcaller', 'Instant', 'As an additional cost to cast this spell, you may exile any number of blue cards from your hand. This spell costs {2} less to cast for each card exiled this way.\nDraw a card.', { cost: '{4}{U}', colors: ['U'] });
  const BLUE = card('Test Blue Wisp', 'Instant', 'Draw a card.', { cost: '{U}', colors: ['U'] });
  const RED = card('Test Red Wisp', 'Instant', 'Draw a card.', { cost: '{R}', colors: ['R'] });
  const DEFS = [MIST, BLUE, RED];
  const canCast = (s: GameState): boolean => legal(s, 'p1', 'cast').some((a) => a.object === find(s, 'Test Mistcaller', 'hand', 'p1'));
  it('the synthetic card is automated', () => {
    expect(MIST.automation.level).toBe('full');
  });
  it('two blue cards exiled take {4} off {4}{U}: one Island pays the rest', () => {
    const s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Mistcaller', 'Test Blue Wisp', 'Test Blue Wisp'], battlefield: ['Island'] } });
    expect(canCast(s)).toBe(true);
    const t = castDriven(s, 'Test Mistcaller', [2]);
    expect(t.zones.stack).toHaveLength(1);
    expect(inExile(t, 'Test Blue Wisp')).toBe(2);
    expect(tappedCount(t, 'Island')).toBe(1);
  });
  it('announcing 0 exiles nothing and pays the whole cost', () => {
    const s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Mistcaller', 'Test Blue Wisp'], battlefield: ['Island', 'Island', 'Island', 'Island', 'Island'] } });
    const t = castDriven(s, 'Test Mistcaller', [0]);
    expect(t.zones.stack).toHaveLength(1);
    expect(inExile(t, 'Test Blue Wisp')).toBe(0);
    expect(tappedCount(t, 'Island')).toBe(5);
  });
  it('X is the value announced, not what is paid: {X}{U} with X = 3 and two blue cards exiled costs {U} and still draws 3', () => {
    const XMIST = card('Test Surge Mist', 'Instant', 'As an additional cost to cast this spell, you may exile any number of blue cards from your hand. This spell costs {2} less to cast for each card exiled this way.\nDraw X cards.', { cost: '{X}{U}', colors: ['U'] });
    const s = scenario(['Island'], { defs: [XMIST, BLUE], p1: { hand: ['Test Surge Mist', 'Test Blue Wisp', 'Test Blue Wisp'], battlefield: ['Island'] } });
    let t = castDriven(s, 'Test Surge Mist', [2, 3]); // two cards exiled, then X = 3 (the order the game asks in)
    expect(inExile(t, 'Test Blue Wisp')).toBe(2);
    expect(tappedCount(t, 'Island')).toBe(1);
    const before = t.zones.hand['p1']!.length;
    t = drive(passBoth(t));
    expect(t.zones.hand['p1']!.length).toBe(before + 3);
  });
  it('negative: a red card cannot be exiled for it, and one blue card is not enough for one Island', () => {
    const s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Mistcaller', 'Test Blue Wisp', 'Test Red Wisp'], battlefield: ['Island', 'Island'] } });
    // {4}{U} with two Islands: one blue card exiled makes it {2}{U}, still more than two Islands pay; the red card is no help
    expect(canCast(s)).toBe(false);
  });
  it('a number that leaves the cost unpayable is refused', () => {
    const s = scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Mistcaller', 'Test Blue Wisp', 'Test Blue Wisp', 'Test Blue Wisp'], battlefield: ['Island'] } });
    expect(() => castDriven(s, 'Test Mistcaller', [1])).toThrow();
  });
});

describe('CR 107.3, 603.2, 113.6k, 107.1a: "When you cast this spell, you gain half X life and draw half X cards. Round down each time."', () => {
  const KRASIS = card('Test Tidal Hydra', 'Creature — Hydra', 'Flying\nWhen you cast this spell, you gain half X life and draw half X cards. Round down each time.\nThis creature enters with X +1/+1 counters on it.', { cost: '{X}{G}{U}', colors: ['G', 'U'] });
  const DEFS = [KRASIS];
  const lands = (n: number): string[] => ['Forest', 'Island', ...Array<string>(n).fill('Plains')];
  const handSize = (s: GameState): number => s.zones.hand['p1']!.length;
  it('the synthetic card is automated', () => {
    expect(KRASIS.automation.level).toBe('full');
  });
  it('X = 5: the cast trigger reads the X chosen for the spell, 2 life and 2 cards (5 halved, rounded down)', () => {
    const s0 = scenario(['Forest', 'Island'], { defs: DEFS, p1: { hand: ['Test Tidal Hydra'], battlefield: lands(5) } });
    let s = castDriven(s0, 'Test Tidal Hydra', [5]);
    expect(s.zones.stack).toHaveLength(2); // the spell and its cast trigger above it
    const before = { hand: handSize(s), life: life(s, 'p1') };
    s = drive(act(s, { type: 'pass', player: 'p1' })); // the trigger resolves first
    s = drive(act(s, { type: 'pass', player: 'p2' }));
    expect(life(s, 'p1')).toBe(before.life + 2);
    expect(handSize(s)).toBe(before.hand + 2);
  });
  it('X = 1: half of 1 rounds down to 0, nothing is gained or drawn', () => {
    const s0 = scenario(['Forest', 'Island'], { defs: DEFS, p1: { hand: ['Test Tidal Hydra'], battlefield: lands(1) } });
    let s = castDriven(s0, 'Test Tidal Hydra', [1]);
    const before = { hand: handSize(s), life: life(s, 'p1') };
    s = drive(act(s, { type: 'pass', player: 'p1' }));
    s = drive(act(s, { type: 'pass', player: 'p2' }));
    expect(life(s, 'p1')).toBe(before.life);
    expect(handSize(s)).toBe(before.hand);
  });
  it('negative: it is a cast trigger, so a creature put onto the battlefield without being cast gains nothing', () => {
    const s = scenario(['Forest', 'Island'], { defs: DEFS, p1: { battlefield: [{ name: 'Test Tidal Hydra', counters: { '+1/+1': 4 } }] } });
    expect(life(s, 'p1')).toBe(20);
    expect(s.zones.stack).toHaveLength(0);
  });
});

describe('CR 107.1a, 701.13a, 603.2, 113.6k: "When you cast this spell, target opponent exiles the top half of their library, rounded up."', () => {
  const TITAN = card('Test Void Titan', 'Creature — Eldrazi', 'When you cast this spell, target opponent exiles the top half of their library, rounded up.', { cost: '{1}' });
  const DEFS = [TITAN];
  function targetOpponent(s: GameState): GameState {
    let t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Void Titan', 'hand', 'p1') });
    for (let guard = 0; guard < 10 && t.pending && t.pending.kind !== 'priority'; guard++) {
      const p = t.pending;
      if (p.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
      else if (p.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${p.kind}`);
    }
    return t;
  }
  it('the synthetic card is automated', () => {
    expect(TITAN.automation.level).toBe('full');
  });
  it('an even library: half of 20 is 10 cards exiled', () => {
    const s = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Void Titan'], battlefield: ['Plains'] } });
    const n = s.zones.library['p2']!.length;
    const t = drive(passBoth(targetOpponent(s)));
    expect(s.zones.library['p2']!.length).toBe(n);
    expect(t.zones.library['p2']!.length).toBe(n - n / 2);
    expect(t.zones.exile).toHaveLength(n / 2);
  });
  it('an odd library rounds up: 21 cards, 11 exiled, 10 left', () => {
    const s = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Void Titan'], battlefield: ['Plains'] } });
    put(s, 'p2', 'library', 'Plains');
    expect(s.zones.library['p2']!.length % 2).toBe(1);
    const n = s.zones.library['p2']!.length;
    const t = drive(passBoth(targetOpponent(s)));
    expect(t.zones.exile).toHaveLength((n + 1) / 2);
    expect(t.zones.library['p2']!.length).toBe((n - 1) / 2);
  });
  it('negative: the caster\'s own library is not touched', () => {
    const s = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Void Titan'], battlefield: ['Plains'] } });
    const mine = s.zones.library['p1']!.length;
    const t = drive(passBoth(targetOpponent(s)));
    expect(t.zones.library['p1']!.length).toBe(mine);
  });
});

describe('CR 702.86a, 107.3, 608.2h: "This creature has annihilator X, where X is the number of +1/+1 counters on it."', () => {
  const HUNGER = card('Test Hunger Titan', 'Creature — Eldrazi', 'This creature has annihilator X, where X is the number of +1/+1 counters on it.', { cost: '{1}' });
  const DEFS = [HUNGER];
  const lands = (s: GameState, p: 'p1' | 'p2'): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]!.name === 'Plains').length;
  function attackWith(counters: number, defenders: number): GameState {
    let s = scenario(['Plains'], { defs: DEFS, p1: { battlefield: [{ name: 'Test Hunger Titan', since: 0, counters: counters > 0 ? { '+1/+1': counters } : {} }] }, p2: { battlefield: Array<string>(defenders).fill('Plains') } });
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Hunger Titan', 'battlefield')]]);
    for (let i = 0; i < 12 && (s.pending?.kind !== 'priority' || s.zones.stack.length > 0 || s.turn.step === 'declareAttackers'); i++) {
      s = s.pending && s.pending.kind !== 'priority' ? drive(s) : passBoth(s);
      if (s.turn.step !== 'declareAttackers' && s.zones.stack.length === 0) break;
    }
    return s;
  }
  it('the synthetic card is automated', () => {
    expect(HUNGER.automation.level).toBe('full');
  });
  it('with three counters on it, the defending player sacrifices three permanents', () => {
    const s = attackWith(3, 5);
    expect(lands(s, 'p2')).toBe(2);
  });
  it('the number is read as the ability resolves: two counters, two permanents', () => {
    expect(lands(attackWith(2, 5), 'p2')).toBe(3);
  });
  it('negative: with no counters X is 0 and nothing is sacrificed', () => {
    expect(lands(attackWith(0, 5), 'p2')).toBe(5);
  });
});

describe('CR 107.3, 601.2c, 608.2b: "counter target spell with mana value X or less, where X is the number of Faeries you control"', () => {
  const SPRITE = card('Test Mist Sprite', 'Creature — Faerie', 'Flash\nFlying\nWhen this creature enters, counter target spell with mana value X or less, where X is the number of Faeries you control.', { cost: '{U}', colors: ['U'] });
  const BOLT = card('Test Spark Bolt', 'Instant', 'Draw a card.', { cost: '{1}{R}', colors: ['R'] });
  const DEFS = [SPRITE, BOLT];
  const onStack = (s: GameState, name: string): boolean => s.zones.stack.some((id) => s.defs[s.objects[id]!.defId]!.name === name);
  /** p1 casts the Bolt, p2 answers with the Sprite (flash); the Sprite's trigger targets the Bolt if it can. */
  function race(faeries: number): GameState {
    const s = scenario(['Mountain', 'Island'], { defs: DEFS, p1: { hand: ['Test Spark Bolt'], battlefield: ['Mountain', 'Mountain'] }, p2: { hand: ['Test Mist Sprite'], battlefield: ['Island', ...Array<string>(faeries - 1).fill('Test Mist Sprite')] } });
    let t = castAuto(s, 'Test Spark Bolt');
    t = act(t, { type: 'pass', player: 'p1' });
    t = drive(castAuto(t, 'Test Mist Sprite', { player: 'p2' }));
    return t;
  }
  it('the synthetic card is automated', () => {
    expect(SPRITE.automation.level).toBe('full');
  });
  it('two Faeries: X = 2, the Bolt (mana value 2) is a legal target and is countered when the trigger resolves', () => {
    let t = race(2);
    expect(onStack(t, 'Test Mist Sprite') || t.zones.stack.length >= 2).toBe(true);
    for (let guard = 0; guard < 4 && t.zones.stack.length > 1; guard++) t = drive(passBoth(t));
    expect(onStack(t, 'Test Spark Bolt')).toBe(false);
    expect(t.zones.graveyard['p1']!.some((id) => t.defs[t.objects[id]!.defId]!.name === 'Test Spark Bolt')).toBe(true);
  });
  it('negative: one Faerie, X = 1: the Bolt has mana value 2, so the trigger has no target and the Bolt is not countered', () => {
    let t = race(1);
    expect(t.zones.stack.filter((id) => t.objects[id]!.kind === 'ability')).toHaveLength(0);
    for (let guard = 0; guard < 4 && t.zones.stack.length > 0; guard++) t = drive(passBoth(t));
    expect(t.zones.hand['p1']!.length).toBeGreaterThan(0); // the Bolt resolved: it drew a card
  });
});
