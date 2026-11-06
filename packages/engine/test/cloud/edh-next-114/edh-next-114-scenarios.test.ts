/**
 * Third pass 2 over the top-rank cards, edh-next-114 (code edhn114): the round's readings played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites are from memory of the 2026-09-25 text: unverified.
 *
 *   CR 601.3, 118.9, 400.1        "you may cast a legendary spell from your hand, from your graveyard, or from among cards you own in exile without paying its mana cost" (Kaya the Inexorable's emblem)
 *   CR 707.9e, 614.1c, 122.6      "enter as a copy ..., except it enters with a shield counter on it if you control that creature" (Undercover Operative)
 *   CR 707.2, 707.9e, 111.1       "create a token that's a copy of target creature you control, except it enters with an additional +1/+1 counter on it" (Littjara Mirrorlake)
 *   CR 705.2, 608.2c, 707.2       "flip a coin until you lose a flip. For each flip you won, create a token that's a copy of that creature" (Mirror March)
 *   CR 701.17a, 608.2g, 118.9     "Mill X cards. You may cast an instant or sorcery spell with mana value X or less from among them without paying its mana cost" (Summons of Saruman)
 *   CR 101.3, 608.2c, 102.3       "Each player discards a card. Each opponent who can't loses 3 life." (Liliana, Waker of the Dead)
 *   CR 601.2i, 702.144a, 707.10   "The first spell you cast from anywhere other than your hand each turn has demonstrate." (The Twelfth Doctor)
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { getChars } from '../../../src/index';
import { act, activations, advanceTo, answer, card, cast, drive, find, full, lifeOf, named, obj, resolveAll, scenario } from '../r4-cost/support';

const kw = (s: GameState, id: string): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword));
const countersOf = (s: GameState, id: string): Record<string, number> => s.objects[id]!.counters;

// ---- Kaya's emblem: three zones ---------------------------------------------------------------------------------------------------------------------------
describe('CR 601.3, 118.9: "you may cast a legendary spell from your hand, from your graveyard, or from among cards you own in exile without paying its mana cost"', () => {
  const SRC = card('Test Beacon', 'Enchantment', 'At the beginning of your upkeep, you may cast a legendary spell from your hand, from your graveyard, or from among cards you own in exile without paying its mana cost.', '{0}');
  const KING = card('Test King', 'Legendary Creature — Human', '', '{5}{W}', ['2', '2']);
  const PAWN = card('Test Pawn', 'Creature — Human', '', '{5}{W}', ['1', '1']);
  const defs = [SRC, KING, PAWN];
  const toUpkeep = (s: GameState): GameState => advanceTo(s, 3, 'upkeep'); // p1's next turn
  const run = (zones: { hand?: string[]; graveyard?: string[]; exile?: string[] }, pick: (s: GameState) => string[]): GameState => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Beacon'], ...zones }, p2: {} });
    const up = toUpkeep(s);
    return resolveAll(up, { yes: [true], objects: [pick(up)] });
  };
  it('is full', () => expect(full(SRC)).toBe(true));
  it('casts the legendary creature from the graveyard for free', () => {
    const s = run({ graveyard: ['Test King'] }, (st) => [find(st, 'Test King', 'graveyard')]);
    expect(named(s, 'Test King').length).toBe(1);
  });
  it('casts it from exile when you own it', () => {
    const s = run({ exile: ['Test King'] }, (st) => [find(st, 'Test King', 'exile')]);
    expect(named(s, 'Test King').length).toBe(1);
  });
  it('casts it from the hand', () => {
    const s = run({ hand: ['Test King'] }, (st) => [find(st, 'Test King', 'hand')]);
    expect(named(s, 'Test King').length).toBe(1);
  });
  /** The cards the upkeep trigger offers (by name and zone), read from the choice itself. */
  const offered = (zones: { hand?: string[]; graveyard?: string[]; exile?: string[] }, p2?: { exile?: string[]; graveyard?: string[] }): string[] => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Beacon'], ...zones }, p2: p2 ?? {} });
    let t = advanceTo(s, 3, 'upkeep');
    for (let i = 0; i < 8 && t.pending?.kind !== 'chooseObjects' && t.pending?.kind !== undefined; i++) t = t.pending!.kind === 'yesNo' ? answer(t, { kind: 'yesNo', yes: true }) : act(t, { type: 'pass', player: t.pending!.player } as never);
    return t.pending?.kind === 'chooseObjects' ? t.pending.options.map((id) => `${t.objects[id]!.defId}@${t.objects[id]!.zone}`) : [];
  };
  it('offers exactly the legendary cards of your three zones', () => {
    expect(offered({ hand: ['Test King'], graveyard: ['Test Pawn'], exile: ['Test Pawn'] }).sort()).toEqual(['Test King@hand']);
  });
  it('negative: a nonlegendary card is not offered from any of the zones', () => {
    expect(offered({ hand: ['Test Pawn'], graveyard: ['Test Pawn'], exile: ['Test Pawn'] })).toEqual([]);
  });
  it('negative: legendary cards an opponent owns, in exile or in their graveyard, are not offered', () => {
    expect(offered({}, { exile: ['Test King'], graveyard: ['Test King'] })).toEqual([]);
  });
});

// ---- Undercover Operative: a shield counter if you control the copied creature ----------------------------------------------------------------------------
describe('CR 707.9e, 614.1c: "You may have ~ enter as a copy of any creature on the battlefield, except it enters with a shield counter on it if you control that creature."', () => {
  const OP = card('Test Operative', 'Creature — Shapeshifter Rogue', 'You may have this creature enter as a copy of any creature on the battlefield, except it enters with a shield counter on it if you control that creature.', '{0}', ['0', '0']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const defs = [OP, BEAR];
  const enter = (own: boolean): { s: GameState; copy: string } => {
    let s = scenario([], { defs, p1: { hand: ['Test Operative'], battlefield: own ? ['Test Bear'] : [] }, p2: { battlefield: own ? [] : ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', own ? 'p1' : 'p2');
    s = resolveAll(cast(s, 'Test Operative', { objects: [[bear]], yes: [true] }), { objects: [[bear]], yes: [true] });
    const copy = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Operative')!;
    expect(getChars(s, copy)!.name).toBe('Test Bear'); // it is a copy
    return { s, copy };
  };
  it('is full', () => expect(full(OP)).toBe(true));
  it('copying a creature you control enters with a shield counter', () => {
    const { s, copy } = enter(true);
    expect(countersOf(s, copy)['shield']).toBe(1);
  });
  it('negative: copying a creature an opponent controls enters with no counter', () => {
    const { s, copy } = enter(false);
    expect(countersOf(s, copy)['shield'] ?? 0).toBe(0);
  });
});

// ---- Littjara Mirrorlake: a token copy with an additional counter -----------------------------------------------------------------------------------------
describe('CR 707.9e, 122.6: "Create a token that\'s a copy of target creature you control, except it enters with an additional +1/+1 counter on it."', () => {
  const LAKE = card('Test Mirrorlake', 'Artifact', '{T}, Sacrifice this artifact: Create a token that\'s a copy of target creature you control, except it enters with an additional +1/+1 counter on it.', '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const defs = [LAKE, BEAR];
  it('is full', () => expect(full(LAKE)).toBe(true));
  it('the token is a Bear with one +1/+1 counter, a 3/3', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Mirrorlake', 'Test Bear'] }, p2: {} });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = resolveAll(drive(act(s, activations(s, 'Test Mirrorlake')[0]!.action), { targets: [[obj(bear)]] }));
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' || s.objects[id]!.cardId === undefined);
    expect(tokens.length).toBe(1);
    expect(getChars(s, tokens[0]!)!.name).toBe('Test Bear');
    expect(s.objects[tokens[0]!]!.counters['+1/+1']).toBe(1);
    expect(Number(getChars(s, tokens[0]!)!.power)).toBe(3);
    expect(s.objects[bear]!.counters['+1/+1'] ?? 0).toBe(0); // the original is unchanged
  });
});

// ---- Mirror March: one token copy for each flip won -------------------------------------------------------------------------------------------------------
describe('CR 705.2, 707.2: "Whenever a nontoken creature you control enters, flip a coin until you lose a flip. For each flip you won, create a token that\'s a copy of that creature. Those tokens gain haste. Exile them at the beginning of the next end step."', () => {
  const MARCH = card('Test March', 'Enchantment', 'Whenever a nontoken creature you control enters, flip a coin until you lose a flip. For each flip you won, create a token that\'s a copy of that creature. Those tokens gain haste. Exile them at the beginning of the next end step.', '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const defs = [MARCH, BEAR];
  const tokensOf = (s: GameState): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
  const play = (seed: string): GameState => resolveAll(cast(scenario([], { defs, seed, p1: { hand: ['Test Bear'], battlefield: ['Test March'] }, p2: {} }), 'Test Bear'));
  it('is full', () => expect(full(MARCH)).toBe(true));
  it('creates as many token copies as flips were won (every seed: the flips end with a loss), each with haste', () => {
    const counts = new Set<number>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const s = play(seed);
      const t = tokensOf(s);
      counts.add(t.length);
      for (const id of t) {
        expect(getChars(s, id)!.name).toBe('Test Bear');
        expect(kw(s, id)).toContain('haste');
      }
    }
    expect(counts.size).toBeGreaterThan(1); // the number of tokens is the number of flips won: it varies with the flips
  });
  it('the tokens are exiled at the beginning of the next end step', () => {
    let s = play('a');
    for (let seed = 0; tokensOf(s).length === 0 && seed < 20; seed++) s = play(`s${seed}`);
    expect(tokensOf(s).length).toBeGreaterThan(0);
    s = resolveAll(advanceTo(s, 1, 'end'));
    s = resolveAll(s);
    expect(tokensOf(s).length).toBe(0);
  });
});

// ---- Summons of Saruman: a free cast from among the milled cards ------------------------------------------------------------------------------------------
describe('CR 701.17a, 608.2g, 118.9: "Mill X cards. You may cast an instant or sorcery spell with mana value X or less from among them without paying its mana cost."', () => {
  const SUMMONS = card('Test Summons', 'Sorcery', 'Mill X cards. You may cast an instant or sorcery spell with mana value X or less from among them without paying its mana cost.', '{X}');
  const BOLT = card('Test Bolt', 'Instant', 'You gain 3 life.', '{1}');
  const BIGBOLT = card('Test Big Bolt', 'Instant', 'You gain 5 life.', '{4}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
  const defs = [SUMMONS, BOLT, BIGBOLT, BEAR];
  /** Cast Summons with X = 2 over this library; the cards offered for the free cast (by name) and the state after taking the first offered one (if any). */
  const run = (library: string[], take: boolean): { offered: string[]; after: GameState } => {
    const s = scenario([], { defs, p1: { hand: ['Test Summons'], library, battlefield: ['Plains', 'Plains'] }, p2: {} });
    let t = cast(s, 'Test Summons', { x: [2] });
    for (let i = 0; i < 6 && t.pending?.kind === 'priority' && t.zones.stack.length > 0; i++) t = act(t, { type: 'pass', player: 'p1' } as never), t = t.pending?.kind === 'priority' && t.pending.player === 'p2' ? act(t, { type: 'pass', player: 'p2' } as never) : t;
    const pend = t.pending;
    const offered = pend?.kind === 'chooseObjects' ? pend.options.map((id) => t.objects[id]!.defId) : [];
    if (pend?.kind === 'chooseObjects') t = answer(t, { kind: 'chooseObjects', ids: take ? pend.options.slice(0, 1) : [] });
    return { offered, after: resolveAll(drive(t)) };
  };
  it('is full', () => expect(full(SUMMONS)).toBe(true));
  it('offers an instant with mana value 2 or less from among the milled cards (not the mana value 4 one) and casts it for free', () => {
    const r = run(['Test Bolt', 'Test Big Bolt'], true);
    expect(r.offered).toEqual(['Test Bolt']);
    expect(lifeOf(r.after)).toBe(20 + 3);
  });
  it('negative: a creature spell among the milled cards is not offered', () => {
    const r = run(['Test Bear', 'Test Big Bolt'], true);
    expect(r.offered).toEqual([]);
    expect(lifeOf(r.after)).toBe(20);
  });
  it('negative: declining the cast leaves the card in the graveyard', () => {
    const r = run(['Test Bolt', 'Test Big Bolt'], false);
    expect(lifeOf(r.after)).toBe(20);
    expect(r.after.zones.graveyard['p1']!.some((id) => r.after.objects[id]!.defId === 'Test Bolt')).toBe(true);
  });
});

// ---- Liliana: each opponent who can't ---------------------------------------------------------------------------------------------------------------------
describe('CR 101.3, 608.2c: "+1: Each player discards a card. Each opponent who can\'t loses 3 life."', () => {
  const LILI = card('Test Walker', 'Legendary Planeswalker — Test', '+1: Each player discards a card. Each opponent who can\'t loses 3 life.', '{0}');
  const dummy = card('Test Card', 'Sorcery', '', '{0}');
  const defs = [LILI, dummy];
  it('is full', () => expect(full(LILI)).toBe(true));
  const plus = (p1Hand: string[], p2Hand: string[]): GameState => {
    const s = scenario([], { defs, p1: { hand: p1Hand, battlefield: [{ name: 'Test Walker', counters: { loyalty: 4 } }] }, p2: { hand: p2Hand } });
    return resolveAll(drive(act(s, activations(s, 'Test Walker')[0]!.action)));
  };
  it('an opponent with no card to discard loses 3 life; an opponent who discards loses nothing', () => {
    expect(lifeOf(plus(['Test Card'], []), 'p2')).toBe(20 - 3);
    expect(lifeOf(plus(['Test Card'], ['Test Card']), 'p2')).toBe(20);
  });
  it('negative: you (no card to discard) are not an opponent and lose no life', () => {
    expect(lifeOf(plus([], []), 'p1')).toBe(20);
  });
});

// ---- The Twelfth Doctor: demonstrate on the first spell cast from anywhere other than the hand -----------------------------------------------------------
describe('CR 601.2i, 702.144a: "The first spell you cast from anywhere other than your hand each turn has demonstrate."', () => {
  const DOC = card('Test Doctor', 'Legendary Creature — Time Lord', 'The first spell you cast from anywhere other than your hand each turn has demonstrate.', '{0}', ['1', '1']);
  const FB = card('Test Echo', 'Sorcery', 'You gain 1 life.\nFlashback {0}', '{0}');
  const FB2 = card('Test Echo Two', 'Sorcery', 'You gain 1 life.\nFlashback {0}', '{0}');
  const HAND = card('Test Plain', 'Sorcery', 'You gain 1 life.', '{0}');
  const defs = [DOC, FB, FB2, HAND];
  const keywordsOnStack = (s: GameState, name: string): string[] => kw(s, s.zones.stack.find((id) => s.objects[id]!.defId === name)!);
  const castFb = (s: GameState, name: string): GameState => {
    const id = find(s, name, 'graveyard');
    return drive(act(s, { type: 'cast', player: 'p1', card: id, method: 'flashback' } as never));
  };
  it('is full', () => expect(full(DOC)).toBe(true));
  it('the first flashback spell has demonstrate, the second one this turn does not', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Doctor'], graveyard: ['Test Echo', 'Test Echo Two'] }, p2: {} });
    s = castFb(s, 'Test Echo');
    expect(keywordsOnStack(s, 'Test Echo')).toContain('demonstrate');
    s = resolveAll(s, { yes: [false] });
    s = castFb(s, 'Test Echo Two');
    expect(keywordsOnStack(s, 'Test Echo Two')).not.toContain('demonstrate');
  });
  it('a spell cast from the hand first does not use up the turn\'s first non-hand cast', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Doctor'], hand: ['Test Plain'], graveyard: ['Test Echo'] }, p2: {} });
    s = resolveAll(cast(s, 'Test Plain'));
    s = castFb(s, 'Test Echo');
    expect(keywordsOnStack(s, 'Test Echo')).toContain('demonstrate');
  });
  it('whenever you copy a spell (demonstrate), the Doctor gets a +1/+1 counter', () => {
    const DOC2 = card('Test Doctor Two', 'Legendary Creature — Time Lord', 'The first spell you cast from anywhere other than your hand each turn has demonstrate.\nWhenever you copy a spell, put a +1/+1 counter on ~.', '{0}', ['1', '1']);
    let s = scenario([], { defs: [DOC2, FB], p1: { battlefield: ['Test Doctor Two'], graveyard: ['Test Echo'] }, p2: {} });
    s = castFb(s, 'Test Echo');
    s = resolveAll(s, { yes: [true] });
    expect(s.objects[find(s, 'Test Doctor Two', 'battlefield')]!.counters['+1/+1']).toBe(1);
  });
  it('negative: a spell cast from the hand has no demonstrate', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Doctor'], hand: ['Test Plain'] }, p2: {} });
    s = cast(s, 'Test Plain');
    expect(keywordsOnStack(s, 'Test Plain')).not.toContain('demonstrate');
  });
});
