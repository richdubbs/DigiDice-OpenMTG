/**
 * Commander lane edh-next, round edh-next-25: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case.
 *
 *   CR 701.17a, 400.7j, 608.2d   "Mill five cards, then put any number of creature cards milled this way into your hand." (Vivien on the Hunt)
 *   CR 119.3, 701.17a            "Target player loses 2 life and mills two cards." (Krydle of Baldur's Gate)
 *   CR 701.20a, 122.1, 608.2d    "If it's a creature card, you may reveal it and put a quest counter on this enchantment." (Quest for Ula's Temple)
 *   CR 608.2c                    "Target player mills three cards, then you return a land card from your graveyard to your hand." (Witherbloom Command, Unseal the Necropolis)
 *   CR 701.20a, 608.2c           "You may put that card onto the battlefield if it's a permanent card with mana value 3 or less. Otherwise, put that card into your hand." (Matter Reshaper)
 *   CR 608.2c, 119.3, 118.9      "Exile the top card of your library. Target opponent loses life equal to its mana value. If it's an instant or sorcery card, you may cast it ..." (Hidetsugu and Kairi)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const settle = (t: GameState): GameState => {
  let s = t;
  for (let g = 0; g < 20 && s.pending && s.pending.kind === 'payCost'; g++) s = answer(s, { kind: 'payCost', auto: true });
  return s;
};
/** Resolve everything on the stack. `yes` answers every yes/no; `take` picks which of the offered objects a choice takes (default: one). */
const resolveAll = (s0: GameState, yes = true, take: 'one' | 'all' | 'none' = 'one'): GameState => {
  let s = settle(s0);
  for (let g = 0; g < 60 && s.pending !== null && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); g++) {
    const d = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number };
    if (d.kind === 'priority') s = settle(pass(s));
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes } as DecisionAnswer);
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } as DecisionAnswer);
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: take === 'none' ? [] : take === 'all' ? (d.options ?? []) : (d.options ?? []).slice(0, Math.max(1, d.min ?? 1)) } as DecisionAnswer);
    else s = settle(s);
  }
  return s;
};
type Tgt = ObjectId | { player: 'p1' | 'p2' };
const cast = (s: GameState, name: string, targets: Tgt[] = [], yes = true, take: 'one' | 'all' | 'none' = 'one'): GameState => {
  let t = settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') } as never));
  if (t.pending?.kind === 'chooseTargets') t = settle(answer(t, { kind: 'chooseTargets', targets: targets.map((x) => (typeof x === 'string' ? { kind: 'object' as const, id: x } : { kind: 'player' as const, id: x.player })) } as DecisionAnswer));
  return resolveAll(t, yes, take);
};
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id)!.name;
const lib = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.library[p]!.map((id) => nameOf(s, id));
const gy = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.graveyard[p]!.map((id) => nameOf(s, id));
const handNames = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.hand[p]!.map((id) => nameOf(s, id));
const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const count = (xs: string[], n: string): number => xs.filter((x) => x === n).length;

const LAND = card('Test Moor', 'Land', '');
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const BIG = card('Test Giant', 'Creature — Giant', '', { pt: ['6', '6'], cost: '{5}{G}' });
const TOP = (...names: string[]): string[] => names;

describe('CR 701.17a, 400.7j, 608.2d: "Mill five cards, then put any number of creature cards milled this way into your hand."', () => {
  const DIG = card('Test Dig', 'Sorcery', 'Mill five cards, then put any number of creature cards milled this way into your hand.');
  const setup = (): GameState => scenario([], { defs: [DIG, BEAR, LAND], p1: { hand: ['Test Dig'], library: TOP('Test Bear', 'Test Moor', 'Test Bear', 'Test Bear', 'Test Moor'), graveyard: ['Test Bear'] } });
  it('is automated', () => { expect(noManual(DIG)).toEqual([]); });
  it('puts the creature cards the mill milled into your hand when you take them all, and leaves the lands in the graveyard', () => {
    const s = cast(setup(), 'Test Dig', [], true, 'all');
    expect(count(handNames(s, 'p1'), 'Test Bear')).toBe(3);
    expect(count(gy(s, 'p1'), 'Test Moor')).toBe(2);
  });
  it('takes only the cards milled this way: a creature card already in the graveyard stays there', () => {
    const s = cast(setup(), 'Test Dig', [], true, 'all');
    expect(count(gy(s, 'p1'), 'Test Bear')).toBe(1);
  });
  it('may take none of them (any number includes zero)', () => {
    const s = cast(setup(), 'Test Dig', [], true, 'none');
    expect(count(handNames(s, 'p1'), 'Test Bear')).toBe(0);
    expect(count(gy(s, 'p1'), 'Test Bear')).toBe(4);
  });
});

describe('CR 119.3, 701.17a: "Target player loses 2 life and mills two cards."', () => {
  const DRAIN = card('Test Drain', 'Sorcery', 'Target player loses 2 life and mills two cards.');
  it('is automated', () => { expect(noManual(DRAIN)).toEqual([]); });
  it('the target player loses the life and mills; you do neither', () => {
    const s0 = scenario([], { defs: [DRAIN, BEAR], p1: { hand: ['Test Drain'] }, p2: { library: TOP('Test Bear', 'Test Bear', 'Test Bear') } });
    const before = s0.zones.library.p2!.length;
    const s = cast(s0, 'Test Drain', [{ player: 'p2' }]);
    expect(life(s, 'p2')).toBe(18);
    expect(s.zones.library.p2!.length).toBe(before - 2);
    expect(gy(s, 'p2')).toEqual(['Test Bear', 'Test Bear']);
    expect(life(s, 'p1')).toBe(20);
    expect(gy(s, 'p1')).toEqual(['Test Drain']);
  });
});

describe('CR 701.20a, 122.1, 608.2d: "If it\'s a creature card, you may reveal it and put a quest counter on this enchantment."', () => {
  const QUEST = card('Test Quest', 'Enchantment', 'At the beginning of your upkeep, you may look at the top card of your library. If it\'s a creature card, you may reveal it and put a quest counter on this enchantment.');
  const quests = (s: GameState): number => (s.objects[find(s, 'Test Quest', 'battlefield')]!.counters?.['quest'] ?? 0);
  const run = (top: string, yes: boolean): GameState => {
    const s0 = scenario([], { defs: [QUEST, BEAR, LAND], p1: { battlefield: ['Test Quest'], library: TOP(top) } });
    return resolveAll(advanceTo(s0, 3, 'upkeep'), yes);
  };
  it('is automated', () => { expect(noManual(QUEST)).toEqual([]); });
  it('puts a quest counter on it when the top card is a creature card and you reveal it', () => { expect(quests(run('Test Bear', true))).toBe(1); });
  it('puts no counter when the top card is not a creature card, or when you do not reveal it', () => {
    expect(quests(run('Test Moor', true))).toBe(0);
    expect(quests(run('Test Bear', false))).toBe(0);
  });
});

describe('CR 608.2c: ", then you <instruction>" and "Then you <instruction>" are done by you, the controller', () => {
  const RECLAIM = card('Test Reclaim', 'Sorcery', 'Target player mills three cards, then you return a land card from your graveyard to your hand.');
  const SEAL = card('Test Seal', 'Sorcery', 'Each player mills two cards. Then you return up to two creature cards from your graveyard to your hand.');
  it('are automated', () => { expect(noManual(RECLAIM)).toEqual([]); expect(noManual(SEAL)).toEqual([]); });
  it('the target player mills, YOU return a land card from YOUR graveyard (a land the target milled stays in theirs)', () => {
    const s0 = scenario([], { defs: [RECLAIM, LAND, BEAR], p1: { hand: ['Test Reclaim'], graveyard: ['Test Moor'] }, p2: { library: TOP('Test Moor', 'Test Moor', 'Test Moor') } });
    const s = cast(s0, 'Test Reclaim', [{ player: 'p2' }]);
    expect(gy(s, 'p2')).toEqual(['Test Moor', 'Test Moor', 'Test Moor']);
    expect(count(handNames(s, 'p1'), 'Test Moor')).toBe(1);
    expect(gy(s, 'p1')).toEqual(['Test Reclaim']);
  });
  it('with no land card in your graveyard nothing is returned', () => {
    const s0 = scenario([], { defs: [RECLAIM, LAND, BEAR], p1: { hand: ['Test Reclaim'] }, p2: { library: TOP('Test Moor', 'Test Moor', 'Test Moor') } });
    const s = cast(s0, 'Test Reclaim', [{ player: 'p2' }]);
    expect(count(handNames(s, 'p1'), 'Test Moor')).toBe(0);
  });
  it('"Each player mills two cards. Then you return ..." takes up to two creature cards from your own graveyard, after the mill (a milled creature counts)', () => {
    const s0 = scenario([], { defs: [SEAL, BEAR], p1: { hand: ['Test Seal'], library: TOP('Test Bear', 'Test Bear') }, p2: { library: TOP('Test Bear', 'Test Bear') } });
    const s = cast(s0, 'Test Seal', [], true, 'all');
    expect(count(handNames(s, 'p1'), 'Test Bear')).toBe(2);
    expect(count(gy(s, 'p2'), 'Test Bear')).toBe(2);
  });
});

describe('CR 701.20a, 608.2c: Matter Reshaper\'s "You may put that card onto the battlefield if it\'s a permanent card with mana value 3 or less. Otherwise, put that card into your hand."', () => {
  const SHAPER = card('Test Shaper', 'Creature — Construct', 'When this creature enters, reveal the top card of your library. You may put that card onto the battlefield if it\'s a permanent card with mana value 3 or less. Otherwise, put that card into your hand.', { pt: ['1', '1'] });
  const run = (top: string, yes: boolean): GameState => {
    const s0 = scenario([], { defs: [SHAPER, BEAR, BIG, LAND], p1: { hand: ['Test Shaper'], library: TOP(top) } });
    return cast(s0, 'Test Shaper', [], yes);
  };
  it('is automated', () => { expect(noManual(SHAPER)).toEqual([]); });
  it('a permanent card with mana value 3 or less may enter the battlefield', () => {
    expect(findAll(run('Test Bear', true), 'Test Bear', 'battlefield').length).toBe(1);
    expect(findAll(run('Test Moor', true), 'Test Moor', 'battlefield').length).toBe(1);
  });
  it('declining, or a card that is too expensive, puts it into your hand instead (never the creature that entered)', () => {
    const declined = run('Test Bear', false);
    expect(findAll(declined, 'Test Bear', 'battlefield').length).toBe(0);
    expect(handNames(declined, 'p1')).toContain('Test Bear');
    const big = run('Test Giant', true);
    expect(findAll(big, 'Test Giant', 'battlefield').length).toBe(0);
    expect(handNames(big, 'p1')).toContain('Test Giant');
    expect(findAll(big, 'Test Shaper', 'battlefield').length).toBe(1);
  });
});

describe('CR 608.2c, 119.3, 118.9: Hidetsugu and Kairi\'s "Exile the top card of your library. Target opponent loses life equal to its mana value. If it\'s an instant or sorcery card, you may cast it without paying its mana cost."', () => {
  const KAIRI = card('Test Kairi', 'Creature — Spirit', 'When this creature enters, exile the top card of your library. Target opponent loses life equal to its mana value. If it\'s an instant or sorcery card, you may cast it without paying its mana cost.', { pt: ['1', '1'] });
  const GAIN = card('Test Gain', 'Sorcery', 'You gain 3 life.', { cost: '{2}{W}' });
  const run = (top: string, yes: boolean): GameState => {
    const s0 = scenario([], { defs: [KAIRI, GAIN, BEAR, BIG], p1: { hand: ['Test Kairi'], library: TOP(top) } });
    return cast(s0, 'Test Kairi', [], yes);
  };
  it('is automated', () => { expect(noManual(KAIRI)).toEqual([]); });
  it('the opponent loses life equal to the mana value of the EXILED card (not the creature that entered), and an instant or sorcery card may be cast free', () => {
    const s = run('Test Gain', true);
    expect(life(s, 'p2')).toBe(17);
    expect(life(s, 'p1')).toBe(23);
  });
  it('declining the cast leaves the card exiled; a creature card is never cast', () => {
    const declined = run('Test Gain', false);
    expect(life(declined, 'p2')).toBe(17);
    expect(life(declined, 'p1')).toBe(20);
    const giant = run('Test Giant', true);
    expect(life(giant, 'p2')).toBe(14);
    expect(findAll(giant, 'Test Giant', 'battlefield').length).toBe(0);
  });
});
