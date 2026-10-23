/**
 * Standard round G (std-rg; slot G of the parallel rounds F-J): the engine behavior of the readings the round added, played through applyAction with synthetic cards
 * compiled by the game's default compiler (invented names, design 6.10). Nothing is mocked. Each describe is named after the rule it checks, with its negative case;
 * the template, lowering and render side is in std-rg-templates.test.ts.
 *
 *   CR 301.5, 701.3, 205.4   "Enchanted creature gets +2/+2, ..., and is a legendary Soldier in addition to its other types." and
 *                            "Whenever enchanted creature attacks or blocks, attach any number of target Equipment you control to it."
 *   CR 603.12, 614.1a        "{T}: Put a coin counter on ~. When you do, you may cast target sorcery card with mana value equal to the number of coin counters ... If that
 *                            spell would be put into your graveyard, exile it instead." and the same after "you may pay {X}"
 *   CR 122.1, 602.5b, 401.2  "Activate only if there are N or more loyalty counters among Jaces you control." and "Exile all but the bottom card of each opponent's library."
 *   CR 702.11d, 105.2, 115.1 "Each other creature you control has hexproof from each of its colors."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, cast, drive, find, lands, onField, pass, put, resolveTop, scenario, until } from '../../m6/dfc/support';
import { tweak } from '../../m5/helpers';
import { declareAttackers, declareBlockers, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; loyalty?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}), ...(o.loyalty ? { loyalty: o.loyalty } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual') && !JSON.stringify(f.abilities).includes('"cond":"ask"'));
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const handSize = (s: GameState, p: 'p1' | 'p2' = 'p1'): number => s.zones.hand[p]!.length;
const target = (...ids: string[]): DecisionAnswer => ({ kind: 'chooseTargets', targets: ids.map((id) => (id === 'p1' || id === 'p2' ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) });
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
/** Answer the decisions of a resolution: yes to every "may", the first options of every choice, automatic payments, the offered order of triggers. */
function auto(s0: GameState, max = 40): GameState {
  let s = s0;
  for (let i = 0; i < max && s.pending && s.pending.kind !== 'priority'; i++) {
    const p = s.pending as unknown as { kind: string; options?: unknown[]; objects?: unknown[]; min?: number; max?: number; items?: { id: string }[] };
    let a: DecisionAnswer;
    if (p.kind === 'yesNo') a = yes;
    else if (p.kind === 'chooseObjects') a = { kind: 'chooseObjects', ids: (p.options as string[]).slice(0, Math.max(1, p.min ?? 1)) };
    else if (p.kind === 'chooseOption') a = { kind: 'chooseOption', ids: [(p.options as { id: string }[])[0]!.id] };
    else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'chooseTargets') a = target(...(p.objects as string[]).slice(0, Math.max(p.min ?? 1, 1)));
    else if (p.kind === 'order') a = { kind: 'order', ids: p.items!.map((x) => x.id) };
    else throw new Error(`auto: ${p.kind}`);
    s = answer(s, a);
  }
  return s;
}
/** Pass priority until the stack is empty, answering as `auto` does. */
function settle(s0: GameState): GameState {
  let s = auto(s0);
  for (let i = 0; i < 20 && s.zones.stack.length > 0; i++) s = auto(pass(pass(s)));
  return s;
}
const activateOf = (s: GameState, id: ObjectId, label?: RegExp) => legalActions(s, s.pending!.player).find((a) => a.kind === 'activate' && a.object === id && (!label || label.test(a.label)));
const stranger = (n: string): CardDef => card(n, 'Creature — Shade', '', { pt: ['1', '1'] });

// ---- Super-Soldier Serum's wording: the Aura and its trigger ----------------------------------------------------------------------------------------------------

describe('CR 205.4, 613.1d, 701.3, 508.1, 509.1: "... is a legendary Soldier in addition to its other types." and "Whenever enchanted creature attacks or blocks, attach any number of target Equipment you control to it."', () => {
  const SERUM = card('Test Elixir', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+2, has first strike and vigilance, and is a legendary Soldier in addition to its other types.\nWhenever enchanted creature attacks or blocks, attach any number of target Equipment you control to it.');
  const SWORD = card('Test Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {3}');
  const SHIELD = card('Test Buckler', 'Artifact — Equipment', 'Equipped creature gets +0/+1.\nEquip {3}');
  const GRUNT = card('Test Grunt', 'Creature — Human', '', { pt: ['2', '2'] });
  const FOE = card('Test Foe', 'Creature — Ogre', '', { pt: ['3', '3'] });
  const DEFS = [SERUM, SWORD, SHIELD, GRUNT, FOE];
  const ready = (s: GameState): GameState => tweak(s, (x) => { for (const id of x.zones.battlefield) x.objects[id]!.controlledSinceTurn = 0; });
  const board = (): GameState => {
    const s0 = ready(scenario([], { defs: DEFS, p1: { hand: ['Test Elixir'], battlefield: ['Test Grunt', 'Test Blade', 'Test Buckler'] }, p2: { battlefield: ['Test Foe'] } }));
    return settle(cast(s0, 'Test Elixir', [target(onField(s0, 'Test Grunt'))]));
  };
  it('is automated', () => expect(noManual(SERUM)).toBe(true));
  it('the enchanted creature is 4/4 with first strike and vigilance, a legendary Soldier and still a Human (added, not set)', () => {
    const s = board();
    const c = getChars(s, onField(s, 'Test Grunt'));
    expect(Number(c.power)).toBe(4);
    expect(Number(c.toughness)).toBe(4);
    expect(c.supertypes).toContain('Legendary');
    expect(c.subtypes).toEqual(expect.arrayContaining(['Human', 'Soldier']));
    expect(c.keywords.map((k) => k.keyword)).toEqual(expect.arrayContaining(['first strike', 'vigilance']));
  });
  it('whenever it attacks, the Equipment you chose (any number) become attached to it; the ones you did not choose stay where they are', () => {
    let s = board();
    const grunt = onField(s, 'Test Grunt');
    const sword = onField(s, 'Test Blade');
    const buckler = onField(s, 'Test Buckler');
    s = declareAttackers(toDeclareAttackers(s), [[grunt]]);
    expect(s.pending?.kind).toBe('chooseTargets');
    s = settle(answer(s, target(sword)));
    expect(s.objects[sword]!.attachedTo).toBe(grunt);
    expect(s.objects[buckler]!.attachedTo ?? null).toBe(null);
  });
  it('choosing none of them is allowed (any number includes zero) and nothing is attached', () => {
    let s = board();
    const grunt = onField(s, 'Test Grunt');
    s = declareAttackers(toDeclareAttackers(s), [[grunt]]);
    s = settle(answer(s, target()));
    expect(s.zones.battlefield.every((id) => s.objects[id]!.attachedTo === undefined || nameOf(s, id) === 'Test Elixir')).toBe(true);
  });
  it('whenever it blocks, the same (the other pattern of the disjunction), on the opponent\'s turn', () => {
    let s = board();
    const grunt = onField(s, 'Test Grunt');
    const foe = onField(s, 'Test Foe', 'p2');
    const sword = onField(s, 'Test Blade');
    s = tweak(s, (x) => { for (const id of x.zones.battlefield) x.objects[id]!.controlledSinceTurn = 0; });
    s = until(s, (t) => t.turn.activePlayer === 'p2' && t.pending?.kind === 'declareAttackers');
    s = declareAttackers(s, [[foe, 'p1']]);
    s = toDeclareBlockers(s);
    s = declareBlockers(s, [[grunt, foe]]);
    expect(s.pending?.kind).toBe('chooseTargets');
    s = settle(answer(s, target(sword)));
    expect(s.objects[sword]!.attachedTo).toBe(grunt);
  });
  it('an Equipment an opponent controls is not a legal target (you control)', () => {
    const s0 = ready(scenario([], { defs: DEFS, p1: { hand: ['Test Elixir'], battlefield: ['Test Grunt'] }, p2: { battlefield: ['Test Blade'] } }));
    let s = settle(cast(s0, 'Test Elixir', [target(onField(s0, 'Test Grunt'))]));
    s = declareAttackers(toDeclareAttackers(s), [[onField(s, 'Test Grunt')]]);
    const pending = s.pending as unknown as { kind: string; specs?: { options?: unknown[] }[] } | undefined;
    // no Equipment of yours: the trigger has no target to choose and goes on the stack with none, or is skipped
    expect(JSON.stringify(pending ?? {})).not.toContain(onField(s, 'Test Blade', 'p2'));
  });
});

// ---- the cast permission of a reflexive trigger and its rider ------------------------------------------------------------------------------------------------

describe('CR 603.12, 614.1a, 118.9: "... When you do, you may cast target sorcery card with mana value equal to the number of coin counters ... If that spell would be put into your graveyard, exile it instead."', () => {
  const WELL = card('Test Coin Well', 'Artifact', '{T}: Put a coin counter on this artifact. When you do, you may cast target sorcery card with mana value equal to the number of coin counters on this artifact from your graveyard without paying its mana cost. If that spell would be put into your graveyard, exile it instead.');
  const ONE = card('Test Spark One', 'Sorcery', 'You gain 1 life.', { cost: '{1}' });
  const TWO = card('Test Spark Two', 'Sorcery', 'You gain 2 life.', { cost: '{2}' });
  const DEFS = [WELL, ONE, TWO];
  it('is automated', () => expect(noManual(WELL)).toBe(true));
  it('the first activation puts one coin counter; the sorcery with mana value 1 is cast for free, does its work, and is exiled instead of going to the graveyard', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Coin Well'], graveyard: ['Test Spark One', 'Test Spark Two'] } });
    let s = drive(act(s0, activateOf(s0, onField(s0, 'Test Coin Well'))!.action));
    s = settle(s);
    expect(s.objects[onField(s, 'Test Coin Well')]!.counters['coin']).toBe(1);
    expect(lifeOf(s, 'p1')).toBe(21);
    expect(s.zones.exile.map((id) => nameOf(s, id))).toContain('Test Spark One');
    expect(s.zones.graveyard['p1']!.map((id) => nameOf(s, id))).toEqual(['Test Spark Two']);
  });
  it('with no sorcery of that mana value in the graveyard there is no target: the trigger does nothing', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Coin Well'], graveyard: ['Test Spark Two'] } });
    const s = settle(drive(act(s0, activateOf(s0, onField(s0, 'Test Coin Well'))!.action)));
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(s.zones.graveyard['p1']!.map((id) => nameOf(s, id))).toEqual(['Test Spark Two']);
  });
});

describe('CR 603.12, 107.3, 614.1a: "When this creature enters, you may pay {X}. When you do, you may cast target sorcery card with mana value X from a graveyard without paying its mana cost. If that spell would be put into a graveyard, exile it instead."', () => {
  const SPRITE = card('Test Echo Sprite', 'Creature — Faerie', 'When this creature enters, you may pay {X}. When you do, you may cast target sorcery card with mana value X from a graveyard without paying its mana cost. If that spell would be put into a graveyard, exile it instead.', { pt: ['1', '1'] });
  const ONE = card('Test Spark One', 'Sorcery', 'You gain 1 life.', { cost: '{1}' });
  const TWO = card('Test Spark Two', 'Sorcery', 'You gain 2 life.', { cost: '{2}' });
  const DEFS = [SPRITE, ONE, TWO];
  it('is automated', () => expect(noManual(SPRITE)).toBe(true));
  it('paying X = 2 casts the sorcery with mana value 2 of ANY graveyard (the opponent\'s), and it is exiled instead of being put into a graveyard', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Echo Sprite'], battlefield: lands('Plains', 3) }, p2: { graveyard: ['Test Spark One', 'Test Spark Two'] } });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Echo Sprite', 'hand', 'p1') }));
    s = pass(pass(s));
    // the enters trigger: pay X (X = 2), then choose the target of the reflexive trigger, then cast
    for (let i = 0; i < 30 && s.pending && (s.pending.kind !== 'priority' || s.zones.stack.length > 0); i++) {
      const p = s.pending as unknown as { kind: string; prompt?: string; options?: { id: string; label?: string }[]; items?: { id: string }[]; min?: number };
      if (p.kind === 'priority') { s = pass(pass(s)); continue; }
      if (p.kind === 'yesNo') s = answer(s, yes);
      else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: 2 } as unknown as DecisionAnswer);
      else if (p.kind === 'chooseTargets') {
        const two = Object.values(s.objects).find((o) => s.defs[o.defId]?.name === 'Test Spark Two' && o.zone === 'graveyard')!;
        s = answer(s, target(two.id));
      } else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items!.map((x) => x.id) });
      else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [p.options![0]!.id] });
      else throw new Error(`unexpected decision ${p.kind}: ${p.prompt ?? ''}`);
    }
    expect(lifeOf(s, 'p1')).toBe(22);
    expect(s.zones.exile.map((id) => nameOf(s, id))).toContain('Test Spark Two');
    expect(s.zones.graveyard['p2']!.map((id) => nameOf(s, id))).toEqual(['Test Spark One']);
  });
});

// ---- Jace, Reality Sculptor's wording: counters among, all but the bottom --------------------------------------------------------------------------------------

describe('CR 122.1, 602.5b, 606.3, 401.2: "Activate only if there are 7 or more loyalty counters among Jaces you control." and "Exile all but the bottom card of each opponent\'s library."', () => {
  const SAGE = card('Test Sage', 'Legendary Planeswalker — Jace', '0: Exile all but the bottom card of each opponent\'s library. Activate only if there are 7 or more loyalty counters among Jaces you control.', { loyalty: '4' });
  const PUPIL = card('Test Pupil', 'Legendary Planeswalker — Jace', '+1: You gain 1 life.', { loyalty: '3' });
  const STRANGER = card('Test Stranger', 'Legendary Planeswalker — Gideon', '+1: You gain 1 life.', { loyalty: '5' });
  const DEFS = [SAGE, PUPIL, STRANGER];
  const board = (extra: { name: string; counters: Record<string, number> }[]): GameState =>
    scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Sage', counters: { loyalty: 4 } }, ...extra] } });
  it('is automated, the restriction understood (not left to the controller)', () => expect(noManual(SAGE)).toBe(true));
  it('with 4 loyalty counters among the Jaces you control the ability can\'t be activated; with 4 + 3 it can', () => {
    expect(activateOf(board([]), onField(board([]), 'Test Sage'))).toBeUndefined();
    const s = board([{ name: 'Test Pupil', counters: { loyalty: 3 } }]);
    expect(activateOf(s, onField(s, 'Test Sage'), /exile/i)).toBeDefined();
  });
  it('the loyalty counters of a planeswalker that is not a Jace, or of an opponent\'s Jace, are not counted', () => {
    const s = board([{ name: 'Test Stranger', counters: { loyalty: 5 } }]);
    expect(activateOf(s, onField(s, 'Test Sage'))).toBeUndefined();
    const t = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Sage', counters: { loyalty: 4 } }] }, p2: { battlefield: [{ name: 'Test Pupil', counters: { loyalty: 3 } }] } });
    expect(activateOf(t, onField(t, 'Test Sage'))).toBeUndefined();
  });
  it('the ability exiles every card of each opponent\'s library but the bottom one; your own library is untouched', () => {
    const s0 = board([{ name: 'Test Pupil', counters: { loyalty: 3 } }]);
    const bottom = s0.zones.library['p2']![s0.zones.library['p2']!.length - 1]!;
    const mineBefore = s0.zones.library['p1']!.length;
    const total = s0.zones.library['p2']!.length;
    const s = settle(drive(act(s0, activateOf(s0, onField(s0, 'Test Sage'), /exile/i)!.action)));
    expect(s.zones.library['p2']).toEqual([bottom]);
    expect(s.zones.exile.length).toBe(total - 1);
    expect(s.zones.library['p1']!.length).toBe(mineBefore);
  });
  it('a library of one card keeps its one card (all but the bottom card of it is nothing)', () => {
    let s0 = board([{ name: 'Test Pupil', counters: { loyalty: 3 } }]);
    s0 = tweak(s0, (x) => { x.zones.library['p2'] = x.zones.library['p2']!.slice(0, 1); });
    const s = settle(drive(act(s0, activateOf(s0, onField(s0, 'Test Sage'), /exile/i)!.action)));
    expect(s.zones.library['p2']!.length).toBe(1);
    expect(s.zones.exile.length).toBe(0);
  });
});

void put; void stranger; void resolveTop;

// ---- Tam's wording: hexproof from each of its colors -----------------------------------------------------------------------------------------------------------

describe('CR 702.11d, 105.2, 115.1: "Each other creature you control has hexproof from each of its colors."', () => {
  const CHAPERONE = card('Test Chaperone', 'Creature — Gorgon', 'Each other creature you control has hexproof from each of its colors.', { pt: ['1', '1'], cost: '{G}{U}', colors: ['G', 'U'] });
  const ELF = card('Test Red Elf', 'Creature — Elf', '', { pt: ['1', '1'], cost: '{R}', colors: ['R'] });
  const GOLEM = card('Test Grey Golem', 'Artifact Creature — Golem', '', { pt: ['1', '1'], cost: '{2}' });
  const LULL = card('Test Lull', 'Instant', 'You gain 1 life.');
  const BURN = card('Test Burn', 'Instant', 'Test Burn deals 1 damage to target creature.', { cost: '{R}', colors: ['R'] });
  const FROST = card('Test Frost', 'Instant', 'Test Frost deals 1 damage to target creature.', { cost: '{U}', colors: ['U'] });
  const DEFS = [CHAPERONE, ELF, GOLEM, LULL, BURN, FROST];
  /** p1 casts a harmless instant so that p2 receives priority with something on the stack; p2 starts casting `spell`: the creatures it may target. */
  function targetsOf(spell: string, lands: string): string[] {
    const s0 = scenario(['Mountain', 'Island'], { defs: DEFS, p1: { hand: ['Test Lull'], battlefield: ['Test Chaperone', 'Test Red Elf', 'Test Grey Golem'] }, p2: { hand: [spell], battlefield: [lands] } });
    let s = cast(s0, 'Test Lull');
    s = pass(s);
    expect(s.pending?.player).toBe('p2');
    s = act(s, { type: 'cast', player: 'p2', card: find(s, spell, 'hand', 'p2') });
    const p = s.pending as unknown as { kind: string; objects: ObjectId[] };
    expect(p.kind).toBe('chooseTargets');
    return p.objects.map((id) => nameOf(s, id));
  }
  it('is automated', () => expect(noManual(CHAPERONE)).toBe(true));
  it('a red spell of the opponent can\'t target the red Elf (its color), but can target the colorless Golem and the Chaperone itself ("each other")', () => {
    const names = targetsOf('Test Burn', 'Mountain');
    expect(names).not.toContain('Test Red Elf');
    expect(names).toEqual(expect.arrayContaining(['Test Grey Golem', 'Test Chaperone']));
  });
  it('a blue spell can target the red Elf: hexproof from each of ITS colors says nothing about blue', () => {
    expect(targetsOf('Test Frost', 'Island')).toContain('Test Red Elf');
  });
});
