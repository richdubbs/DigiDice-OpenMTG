/**
 * Commander lane quantities, round edh-next-77: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's
 * default compiler. Alice (p1) is the active player of turn 1.
 *
 *   CR 701.9a, 603.12, 608.2c, 202.3   "... you may discard a card. When you discard a card this way, ~ deals damage equal to that card's mana value ..." and
 *                                      "Discard a card, then draw two cards. When you discard a card this way, ..." (the discard named by the reflexive trigger)
 *   CR 202.3, 608.2h                   "... where X is the number of different mana values among cards in your graveyard"
 * CR cites are from memory (no rules/cr folder in cloud sessions): unverified.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { answer, castAuto, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [] } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const driveAll = (s0: GameState, discard?: string): GameState => {
  let s = s0;
  for (let g = 0; g < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
    const d = s.pending;
    if (d === null) break;
    if (d.kind === 'priority') s = pass(s);
    else if (d.kind === 'chooseObjects') {
      const opts = d.options as string[];
      const pick = discard !== undefined ? opts.find((id) => s.objects[id]?.defId === discard) : undefined;
      s = answer(s, { kind: 'chooseObjects', ids: (pick !== undefined ? [pick] : opts).slice(0, Math.max(d.min, 1)) });
    } else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
};

const BIG = card('Test Big Spell', 'Sorcery', 'You gain 1 life.', { cost: '{4}' });
const LAND = card('Test Plain Land', 'Land', '');
const FILLER = card('Test Filler', 'Sorcery', 'You gain 1 life.', { cost: '{0}' });

describe('CR 701.9a, 603.12: "you may discard a card. When you discard a card this way, ... equal to that card\'s mana value"', () => {
  const SPELL = card('Test Zap', 'Sorcery', 'You may discard a card. When you discard a card this way, ~ deals damage equal to that card\'s mana value to each opponent.');
  it('is automated', () => expect(noManual(SPELL)).toEqual([]));
  it('discarding a mana value 4 card deals 4 to each opponent (the discarded card, not the spell)', () => {
    const s0 = scenario([], { defs: [SPELL, BIG, LAND], p1: { hand: ['Test Zap', 'Test Big Spell'] } });
    const s = driveAll(castAuto(s0, 'Test Zap'), 'Test Big Spell');
    expect(life(s, 'p2')).toBe(16);
  });
});

describe('"Discard a card, then draw two cards. When you discard a card this way, ... that card\'s mana value" (the discard is earlier in the sentence)', () => {
  const SAGA = card('Test Fire', 'Sorcery', 'Discard a card, then draw two cards. When you discard a card this way, ~ deals damage equal to that card\'s mana value to each opponent.');
  it('is automated', () => expect(noManual(SAGA)).toEqual([]));
  it('mana value 4 discarded: 4 damage', () => {
    const s0 = scenario([], { defs: [SAGA, BIG, FILLER], p1: { hand: ['Test Fire', 'Test Big Spell'], library: ['Test Filler', 'Test Filler', 'Test Filler'] } });
    const s = driveAll(castAuto(s0, 'Test Fire'), 'Test Big Spell');
    expect(life(s, 'p2')).toBe(16);
  });
  it('negative: nothing to discard (empty hand) deals no damage', () => {
    const s0 = scenario([], { defs: [SAGA, FILLER], p1: { hand: ['Test Fire'], library: ['Test Filler', 'Test Filler', 'Test Filler'] } });
    const s = driveAll(castAuto(s0, 'Test Fire'));
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 202.3, 608.2h: "where X is the number of different mana values among cards in your graveyard"', () => {
  const ARB = card('Test Arbiter', 'Sorcery', 'You lose X life, where X is the number of different mana values among cards in your graveyard.');
  it('is automated', () => expect(noManual(ARB)).toEqual([]));
  it('mana values 0, 0, 4 count as two different values', () => {
    const s0 = scenario([], { defs: [ARB, BIG, FILLER], p1: { hand: ['Test Arbiter'], graveyard: ['Test Filler', 'Test Filler', 'Test Big Spell'] } });
    const s = driveAll(castAuto(s0, 'Test Arbiter'));
    expect(life(s, 'p1')).toBe(18);
  });
  it('negative: an empty graveyard counts none', () => {
    const s0 = scenario([], { defs: [ARB], p1: { hand: ['Test Arbiter'] } });
    const s = driveAll(castAuto(s0, 'Test Arbiter'));
    expect(life(s, 'p1')).toBe(20);
  });
});
