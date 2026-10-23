/**
 * p2-modal-2 (lane p2-modal): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings invented,
 * design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 700.2, 601.2b, 603.3c   "Choose one at random --": nobody is asked; one mode is picked with the game's random number generator, the same one for the same seed
 *   CR 700.2a                  a mode that can't be chosen (no legal target) is never picked at random
 *   CR 700.2, 603.3c           "If you discarded a card this turn, you choose one instead.": the player chooses, only after a discard this turn
 *   CR 714.2, 700.2            a chapter ability with modes chosen at random ("I, II -- Choose one at random --")
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState } from '../../../src/index';
import { legalActions } from '../../../src/index';
import { act, answer } from '../../m5/helpers';
import { castWith, drive, resolveAll, scenario, synthetic } from '../../m6/costs/support';

const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const lands = (name: string, n: number): string[] => Array(n).fill(name) as string[];
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const handOf = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;

const DICE = synthetic('Test Dice Seer', 'Creature — Human', '{1}{G}', 'When ~ enters, choose one at random --\n• Draw a card.\n• You gain 2 life.', { power: '1', toughness: '1' });
const RUST = synthetic('Test Rust Gambler', 'Creature — Human', '{1}{G}', 'When ~ enters, choose one at random --\n• Destroy target artifact.\n• You gain 2 life.', { power: '1', toughness: '1' });
const WHIM = synthetic('Test Whim Seer', 'Creature — Human', '{1}{G}', 'When ~ enters, choose one at random. If you discarded a card this turn, you choose one instead.\n• Draw a card.\n• You gain 2 life.', { power: '1', toughness: '1' });
const TOSS = synthetic('Test Toss Aside', 'Sorcery', '{G}', 'Discard a card.');
const ODDS = synthetic('Test Odd Spell', 'Sorcery', '{G}', 'Choose one at random --\n• Draw a card.\n• You gain 2 life.');
const TALE = synthetic('Test Tale of Chance', 'Enchantment — Saga', '{1}{G}', '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after II.)\nI, II -- Choose one at random --\n• Draw a card.\n• You gain 2 life.');
const SCORN = synthetic('Test White Scorn', 'Instant', '{3}{W}', 'If you\'ve cast another white spell this turn, you may cast this spell without paying its mana cost.\nDestroy all artifacts.', { colors: ['W'] });
const GLEAM = synthetic('Test White Gleam', 'Instant', '{W}', 'You gain 1 life.', { colors: ['W'] });
const MOSS = synthetic('Test Green Moss', 'Instant', '{G}', 'You gain 1 life.', { colors: ['G'] });
const DEFS = [DICE, RUST, WHIM, TOSS, ODDS, TALE, SCORN, GLEAM, MOSS];

/** Cast a creature and let it resolve: its enters trigger is put on the stack (modes chosen then, CR 603.3c). */
function enter(s0: GameState, name: string): GameState {
  let s = castWith(s0, name);
  s = drive(act(s, { type: 'pass', player: 'p1' }));
  return drive(act(s, { type: 'pass', player: s.pending!.player }));
}
/** What the mode did: 'draw' (a card more in hand) or 'life' (2 life more). */
function outcome(before: GameState, after: GameState, handDelta = 0): 'draw' | 'life' | 'none' {
  if (handOf(after, 'p1') === handOf(before, 'p1') + handDelta + 1) return 'draw';
  if (lifeOf(after, 'p1') === lifeOf(before, 'p1') + 2) return 'life';
  return 'none';
}

describe('the synthetic cards are automated', () => {
  it('every synthetic card with a reading of this round plays fully', () => {
    for (const d of [DICE, RUST, WHIM, ODDS, TALE]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 700.2, 603.3c: "Choose one at random --"', () => {
  const board = (seed: string): GameState => scenario(['Forest'], { seed, defs: DEFS, p1: { hand: ['Test Dice Seer'], battlefield: lands('Forest', 2) } });
  it('CR 700.2: nobody is asked; exactly one mode happens; the same seed gives the same mode, and both modes happen over several seeds', () => {
    const seen = new Set<string>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
      const s0 = board(seed);
      const s1 = enter(s0, 'Test Dice Seer');
      expect(s1.pending?.kind, seed).toBe('priority'); // no mode decision
      const s = resolveAll(s1);
      const o = outcome(s0, s, -1); // the creature left the hand
      expect(o, seed).not.toBe('none');
      seen.add(o);
      expect(outcome(s0, resolveAll(enter(board(seed), 'Test Dice Seer')), -1), seed).toBe(o);
    }
    expect([...seen].sort()).toEqual(['draw', 'life']);
  });
  it('CR 700.2a: a mode that can\'t be chosen (no artifact to target) is never picked: the other one always is', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const s0 = scenario(['Forest'], { seed, defs: DEFS, p1: { hand: ['Test Rust Gambler'], battlefield: lands('Forest', 2) } });
      const s = resolveAll(enter(s0, 'Test Rust Gambler'));
      expect(lifeOf(s, 'p1'), seed).toBe(lifeOf(s0, 'p1') + 2);
    }
  });
  it('CR 601.2b: a spell\'s random mode is picked as it is cast, with no decision', () => {
    const s0 = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Odd Spell'], battlefield: lands('Forest', 1) } });
    const s1 = castWith(s0, 'Test Odd Spell');
    expect(s1.pending?.kind).toBe('priority');
    expect(outcome(s0, resolveAll(s1), -1)).not.toBe('none');
  });
});

describe('CR 700.2, 603.3c: "Choose one at random. If you discarded a card this turn, you choose one instead."', () => {
  it('CR 603.3c: without a discard this turn the mode is picked at random (nobody is asked)', () => {
    const s0 = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Whim Seer'], battlefield: lands('Forest', 2) } });
    expect(enter(s0, 'Test Whim Seer').pending?.kind).toBe('priority');
  });
  it('CR 603.3c: after a discard this turn the controller chooses the mode', () => {
    let s = scenario(['Forest', 'Plains'], { defs: DEFS, p1: { hand: ['Test Toss Aside', 'Test Whim Seer', 'Plains'], battlefield: lands('Forest', 3) } });
    s = resolveAll(castWith(s, 'Test Toss Aside'));
    if (s.pending?.kind === 'chooseObjects') s = drive(answer(s, { kind: 'chooseObjects', ids: [s.pending.options.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Plains')!] }));
    s = resolveAll(s);
    const s1 = enter(s, 'Test Whim Seer');
    expect(s1.pending?.kind).toBe('chooseOption');
    const t = resolveAll(answer(s1, { kind: 'chooseOption', ids: ['1'] }));
    expect(lifeOf(t, 'p1')).toBe(lifeOf(s1, 'p1') + 2);
  });
});

describe('CR 714.2, 700.2: a chapter ability with modes chosen at random', () => {
  it('CR 714.2: the Saga enters, chapter I triggers and one of its modes happens, nobody asked', () => {
    const s0 = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Tale of Chance'], battlefield: lands('Forest', 2) } });
    let s = castWith(s0, 'Test Tale of Chance');
    s = drive(act(s, { type: 'pass', player: 'p1' }));
    s = drive(act(s, { type: 'pass', player: s.pending!.player }));
    expect(s.pending?.kind).toBe('priority');
    s = resolveAll(s);
    expect(outcome(s0, s, -1)).not.toBe('none');
  });
});

describe('CR 118.9, 601.2b: an alternative cost whose condition is this turn\'s history ("If you\'ve cast another white spell this turn")', () => {
  const freeOffered = (s: GameState): boolean => legalActions(s, 'p1').some((a) => a.kind === 'cast' && s.defs[s.objects[a.object!]!.defId]!.name === 'Test White Scorn' && (a.action as { method?: string }).method !== undefined);
  it('CR 118.9: after another white spell this turn the free cast is offered; after a green spell, or before any spell, it is not', () => {
    let s = scenario(['Plains', 'Forest'], { defs: DEFS, p1: { hand: ['Test White Scorn', 'Test White Gleam', 'Test Green Moss'], battlefield: ['Plains', 'Forest'] } });
    expect(freeOffered(s)).toBe(false);
    s = resolveAll(castWith(s, 'Test Green Moss'));
    expect(freeOffered(s)).toBe(false);
    s = resolveAll(castWith(s, 'Test White Gleam'));
    expect(freeOffered(s)).toBe(true);
  });
});
