/**
 * T3 (push wave) review fixes: cards the T3 promotions made full that played wrong. Synthetic wordings (design 6.10) of the same shapes, compiled by the
 * game's default compiler and played through applyAction. Each test is named after the rule it checks.
 *
 *   CR 608.2d, 118.3, 118.12   "you may sacrifice two ..." / "you may discard two cards" can't be chosen with fewer than two (Giant Opportunity)
 *   CR 701.17b                 "you may mill two cards" can't be chosen with fewer than two cards in library (Mineshaft Spider)
 *   CR 608.2d, 701.9a          "you may discard your hand" with an empty hand: AF1 settles it by the official ruling (an empty hand can be discarded,
 *                              "if you do" is true), see test/fast2/af1/af1-audit-fixes.test.ts; the op:discard.mayHand hold is gone
 *   CR 701.25d, 603.12         "surveil N. When you do" triggers with an empty library: the surveil happened (Dream Eater)
 *   CR 702.35                  a filter on a keyword the engine lacks (madness) is not full (Anje Falkenrath)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, passBoth, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const hand = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;
const life = (s: GameState, p = 'p1'): number => s.players.find((x) => x.id === p)!.life;
const cast = (s: GameState, name: string): GameState => {
  let t = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') });
  while (t.pending && t.pending.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
  return t;
};
/** Keep only the top `n` cards of p1's library (test setup: the scenario keeps 20 Plains there). */
const trimLibrary = (s: GameState, n: number): GameState => {
  const lib = s.zones.library['p1']!;
  for (const id of lib.slice(n)) delete s.objects[id];
  s.zones.library['p1'] = lib.slice(0, n);
  return s;
};

const TRINKET = card('Test Trinket', 'Artifact', '');

describe('CR 608.2d, 118.3, 118.12: a "may" whose action needs more than the player has is not offered', () => {
  const TRADE = card('Test Scrap Trade', 'Sorcery', 'You may sacrifice two artifacts. If you do, draw three cards. Otherwise, you gain 3 life.');
  const DUMP = card('Test Double Dump Offer', 'Sorcery', 'You may discard two cards. If you do, draw three cards.');

  it('CR 608.2d, 118.3: the compiled cards are fully automated (ch.may)', () => {
    expect(TRADE.automation.level).toBe('full');
    expect(DUMP.automation.level).toBe('full');
  });

  it('CR 118.3: "you may sacrifice two artifacts" with one artifact is not offered; the otherwise branch runs (Giant Opportunity shape)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Scrap Trade'], battlefield: ['Test Trinket'] }, defs: [TRADE, TRINKET] });
    let s = cast(s0, 'Test Scrap Trade');
    const before = hand(s);
    s = passBoth(s);
    expect(s.pending?.kind).toBe('priority');
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Trinket')).toBe(true);
    expect(hand(s)).toBe(before);
    expect(life(s)).toBe(23);
  });

  it('CR 608.2d: with two artifacts the player is asked; "yes" sacrifices both and draws three', () => {
    const s0 = scenario([], { p1: { hand: ['Test Scrap Trade'], battlefield: ['Test Trinket', 'Test Trinket'] }, defs: [TRADE, TRINKET] });
    let s = cast(s0, 'Test Scrap Trade');
    const before = hand(s);
    s = passBoth(s);
    expect(s.pending?.kind).toBe('yesNo');
    s = answer(s, { kind: 'yesNo', yes: true });
    while (s.pending?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (s.pending as unknown as { options: string[] }).options.slice(0, 2) });
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Trinket')).toBe(false);
    expect(hand(s)).toBe(before + 3);
  });

  it('CR 118.3: "you may discard two cards" with one card in hand is not offered: nothing is discarded, nothing drawn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Double Dump Offer', 'Plains'] }, defs: [DUMP] });
    let s = cast(s0, 'Test Double Dump Offer');
    expect(hand(s)).toBe(1);
    s = passBoth(s);
    expect(s.pending?.kind).toBe('priority');
    expect(hand(s)).toBe(1);
  });
});

describe('CR 701.17b: "you may mill N cards" with fewer than N cards in library', () => {
  const SIFT = card('Test Grave Sift', 'Sorcery', 'You may mill two cards. If you do, you gain 2 life.');

  it('CR 701.17b: with one card in library the player can\'t choose to mill two; no life is gained', () => {
    expect(SIFT.automation.level).toBe('full');
    const s0 = trimLibrary(scenario([], { p1: { hand: ['Test Grave Sift'] }, defs: [SIFT] }), 1);
    let s = cast(s0, 'Test Grave Sift');
    s = passBoth(s);
    expect(s.pending?.kind).toBe('priority');
    expect(s.zones.library['p1']!.length).toBe(1);
    expect(life(s)).toBe(20);
  });

  it('CR 701.17a: with two cards in library the player is asked; "yes" mills both and gains 2 life', () => {
    const s0 = trimLibrary(scenario([], { p1: { hand: ['Test Grave Sift'] }, defs: [SIFT] }), 2);
    let s = cast(s0, 'Test Grave Sift');
    s = passBoth(s);
    expect(s.pending?.kind).toBe('yesNo');
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.zones.library['p1']!.length).toBe(0);
    expect(life(s)).toBe(22);
  });
});

describe('CR 608.2d, 701.9a: "you may discard your hand" with an empty hand', () => {
  const RESET = card('Test Hand Reset', 'Sorcery', 'You may discard your hand. If you do, draw two cards.');
  it('AF1: settled by the official ruling (an empty hand can be discarded), so the card is full again (no op:discard.mayHand)', () => {
    expect(RESET.automation.level).toBe('full');
    expect(RESET.automation.requiresEngine ?? []).not.toContain('op:discard.mayHand');
    expect(card('Test Hand Purge', 'Sorcery', 'Discard your hand, then draw two cards.').automation.level).toBe('full');
  });
});

describe('CR 701.25d, 603.12: "surveil N. When you do, ..." with an empty library', () => {
  const PEEK = card('Test Dream Peek', 'Sorcery', 'Surveil 2. When you do, you gain 2 life.');
  it('CR 701.25d, 603.12: the player surveils even though no card could be looked at, so the reflexive ability triggers', () => {
    expect(PEEK.automation.level).toBe('full');
    const s0 = trimLibrary(scenario([], { p1: { hand: ['Test Dream Peek'] }, defs: [PEEK] }), 0);
    let s = cast(s0, 'Test Dream Peek');
    s = passBoth(s); // the sorcery resolves: surveil 2 with no card, the reflexive trigger goes on the stack (CR 603.12)
    while (s.zones.stack.length > 0) s = passBoth(s);
    expect(life(s)).toBe(22);
  });
});

describe('CR 702.35: a filter on a keyword the engine lacks is not full', () => {
  // cloud r3-mech: foretell is native since then (core/special/foretell.ts); std-rx22: suspend too is implemented now; std-ry7: bestow as well, so the planned
  // keyword of this check is haunt (CR 702.55a)
  it('CR 702.55a: "Whenever you discard a card, if it has haunt, untap ~" needs keyword:haunt (the Anje Falkenrath shape on a planned keyword)', () => {
    const HOST = card('Test Haunt Host', 'Creature — Vampire', 'Whenever you discard a card, if it has haunt, untap ~.', ['3', '1']);
    expect(HOST.automation.level).not.toBe('full');
    expect(HOST.automation.requiresEngine ?? []).toContain('keyword:haunt');
  });
  it('CR 702.35a: the Anje Falkenrath shape ("if it has madness") is full since M6-12 made keyword:madness real', () => {
    const ANJE = card('Test Madness Host', 'Creature — Vampire', 'Whenever you discard a card, if it has madness, untap ~.', ['3', '1']);
    expect(ANJE.automation.level).toBe('full');
  });
  it('CR 702.9: the same shape on a keyword the engine runs (flying) stays full', () => {
    const HOST = card('Test Flying Host', 'Creature — Vampire', 'Whenever you discard a card, if it has flying, untap ~.', ['3', '1']);
    expect(HOST.automation.level).toBe('full');
  });
});
