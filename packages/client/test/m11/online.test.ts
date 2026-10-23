/**
 * M11-2 with M11-3's INTERFACE CHANGE (`OnlineDeck.commander`): a commander deck goes to the host's server with its commander section (the 99 in `main`);
 * a deck without one sends none, exactly as before.
 */
import { describe, expect, it } from 'vitest';
import { toOnlineDeck } from '../../src/online/setup';

describe('M11-2: the deck sent online', () => {
  it('CR 903.3: the commander section travels with the deck (one card, or two partners)', () => {
    const deck = toOnlineDeck({
      main: [{ name: 'Forest', count: 98 }],
      sideboard: [{ name: 'Gone', count: 0 }],
      commander: [{ name: 'Test Kraum', count: 1 }, { name: 'Test Tymna', count: 1 }],
    });
    expect(deck).toEqual({ main: [{ name: 'Forest', count: 98 }], sideboard: [], commander: [{ name: 'Test Kraum', count: 1 }, { name: 'Test Tymna', count: 1 }] });
  });

  it('a deck without a commander is sent as before (no commander field)', () => {
    expect(toOnlineDeck({ main: [{ name: 'Forest', count: 40 }], sideboard: [], commander: [] })).toEqual({ main: [{ name: 'Forest', count: 40 }], sideboard: [] });
  });
});
