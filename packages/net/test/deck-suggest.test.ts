/**
 * Bounded name suggestions for unknown deck cards (audit 2026-10-12, m7): a hello with hundreds of unknown names blocked the host for seconds. The
 * suggestion function and `prepareDeck` are called directly with a fake card source and clock: no sockets.
 */
import { describe, expect, it } from 'vitest';
import { prepareDeck, suggester, SUGGEST, type CardSource } from '../src/game/deck';
import { deck } from './helpers';

/** A card source that knows no card and counts its (slow, in real life) suggestion calls. */
function unknownCards(costMs: number, clock: { t: number }): CardSource & { calls: number } {
  return {
    calls: 0,
    async resolveNames(names: string[]) {
      return { resolved: names.map((name) => ({ name, card: null })) } as unknown as Awaited<ReturnType<CardSource['resolveNames']>>;
    },
    suggest(name: string) {
      this.calls++;
      clock.t += costMs;
      return [`${name}?`];
    },
  };
}

describe('bounded suggestions (audit m7)', () => {
  it('suggests for the first few names only, and never for very long names', () => {
    const clock = { t: 0 };
    const cards = unknownCards(1, clock);
    const s = suggester(cards, () => clock.t);
    expect(s('x'.repeat(SUGGEST.nameLength + 1))).toEqual([]);
    for (let i = 0; i < 10; i++) s(`Card ${i}`);
    expect(cards.calls).toBe(SUGGEST.suggested);
  });

  it('stops suggesting once its time budget is spent', () => {
    const clock = { t: 0 };
    const cards = unknownCards(SUGGEST.budgetMs, clock); // one call spends the whole budget
    const s = suggester(cards, () => clock.t);
    expect(s('Bear')).toEqual(['Bear?']);
    expect(s('Elf')).toEqual([]);
    expect(cards.calls).toBe(1);
  });

  it('a decklist of 265 unknown names lists a few, suggests for fewer, and counts the rest', async () => {
    const clock = { t: 0 };
    const cards = unknownCards(1, clock);
    const names = Object.fromEntries(Array.from({ length: 265 }, (_, i) => [`Unknown card number ${i}`, 1]));
    const r = await prepareDeck(deck(names), { cards, format: 'casual', clock: () => clock.t });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(cards.calls).toBe(SUGGEST.suggested);
    expect(r.errors).toHaveLength(SUGGEST.listed + 1);
    expect(r.errors.at(-1)).toBe(`${265 - SUGGEST.listed} more card names are unknown or ambiguous.`);
  });
});
