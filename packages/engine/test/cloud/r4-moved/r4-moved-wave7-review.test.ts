/**
 * Wave 7 merge line r4-moved, independent review: "For each opponent who didn't discard two nonland cards this way, you draw a card." (Garruk, Veiled Butcher's -3)
 * with two opponents, each counted on what THAT opponent discarded (CR 608.2c, 608.2h, 701.9a; the NotMoved hole, parser/holes/moved.ts#notMoved).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, mpScenario, resolveStack } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [] } as OracleCard);
}
const RANSACK = card('Test Ransack', 'Sorcery', "Each opponent discards two cards. For each opponent who didn't discard two nonland cards this way, you draw a card.");
const RITE = card('Test Rite', 'Instant', 'You gain 1 life.');
const HYMN = card('Test Hymn', 'Sorcery', 'You gain 2 life.');

function cast(s0: GameState): GameState {
  let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ransack', 'hand', 'p1') });
  for (let i = 0; i < 400 && (t.zones.stack.length > 0 || (t.pending && t.pending.kind !== 'priority')); i++) {
    if (t.pending?.kind === 'priority') { t = act(t, { type: 'pass', player: t.pending.player }); continue; }
    const p = t.pending!;
    if (p.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseObjects') t = answer(t, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return resolveStack(t);
}
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;

describe('CR 608.2c, 608.2h, 701.9a: "For each opponent who didn\'t discard two nonland cards this way" counts each opponent\'s own discarded cards (three players)', () => {
  it('one opponent discards two nonland cards, the other a land and a nonland card: you draw exactly one card', () => {
    const s0 = mpScenario({ players: 3, defs: [RANSACK, RITE, HYMN], zones: { p1: { hand: ['Test Ransack'] }, p2: { hand: ['Test Rite', 'Test Hymn'] }, p3: { hand: ['Plains', 'Test Rite'] } } });
    const before = hand(s0, 'p1');
    const s = cast(s0);
    expect(hand(s, 'p2')).toBe(0);
    expect(hand(s, 'p3')).toBe(0);
    expect(hand(s, 'p1')).toBe(before - 1 + 1);
  });
  it('both opponents discard two nonland cards: you draw none; both discard lands: you draw two', () => {
    const a0 = mpScenario({ players: 3, defs: [RANSACK, RITE, HYMN], zones: { p1: { hand: ['Test Ransack'] }, p2: { hand: ['Test Rite', 'Test Hymn'] }, p3: { hand: ['Test Hymn', 'Test Rite'] } } });
    expect(hand(cast(a0), 'p1')).toBe(hand(a0, 'p1') - 1);
    const b0 = mpScenario({ players: 3, defs: [RANSACK, RITE, HYMN], zones: { p1: { hand: ['Test Ransack'] }, p2: { hand: ['Plains', 'Plains'] }, p3: { hand: ['Plains'] } } });
    expect(hand(cast(b0), 'p1')).toBe(hand(b0, 'p1') - 1 + 2);
  });
});

describe('design 6.4 (fail closed): "For each opponent who didn\'t discard ... this way" with no discard of the opponents to count stays manual', () => {
  const manual = (d: CardDef): boolean => JSON.stringify(d.faces).includes('"op":"manual"') || d.faces.some((f) => f.abilities.some((a) => a.kind === 'manual'));
  it('after a mill, or a draw, the sentence is manual', () => {
    expect(manual(card('Test Mill', 'Sorcery', "Each opponent mills two cards. For each opponent who didn't discard two nonland cards this way, you draw a card."))).toBe(true);
    expect(manual(card('Test Draw', 'Sorcery', "You draw two cards. For each opponent who didn't discard two nonland cards this way, you draw a card."))).toBe(true);
  });
});
