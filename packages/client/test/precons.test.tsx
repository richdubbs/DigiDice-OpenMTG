/**
 * The Commander precons a player can pick (game/precons.ts): the generated data is up to date with docs/decks/commander-precons.md (scripts/gen-precons.ts),
 * every deck is a whole Commander deck, and the deck pickers list them in their own group with their commanders.
 */
import { readFileSync } from 'node:fs';
import { cleanup, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PRECONS_MD, PRECONS_PATH, generatePrecons, meldResultsOf, oracleName, serializePrecons } from '../../../scripts/gen-precons';
import { unplayableReason } from '../src/game/config';
import { DeckOptions, deckOptionLabel } from '../src/game/DeckOptions';
import { PRACTICE_DECKS } from '../src/game/practiceDecks';
import { preconDecks, type PreconRow } from '../src/game/precons';
import type { GameDeck } from '../src/game/services';

afterEach(cleanup);

const md = (): string => readFileSync(PRECONS_MD, 'utf8');

describe('the generated precon data', () => {
  it('is up to date with docs/decks/commander-precons.md (run `npx tsx scripts/gen-precons.ts`)', () => {
    expect(readFileSync(PRECONS_PATH, 'utf8').replace(/\r\n/g, '\n')).toBe(serializePrecons(generatePrecons(md())));
  });

  it('a reversible card ("Name // Name") and a meld card ("Front // Meld result") are their Oracle names; split cards keep both halves', () => {
    expect(oracleName('Okaun, Eye of Chaos // Okaun, Eye of Chaos')).toBe('Okaun, Eye of Chaos');
    const meld = meldResultsOf(md());
    expect([...meld]).toEqual(['Brisela, Voice of Nightmares']);
    expect(oracleName('Bruna, the Fading Light // Brisela, Voice of Nightmares', meld)).toBe('Bruna, the Fading Light');
    expect(oracleName('Fire // Ice', meld)).toBe('Fire // Ice');
  });
});

describe('the precon decks', () => {
  it('are 197 whole Commander decks, newest first: one commander or two (partners), 100 cards, playable in a Commander game', async () => {
    const decks = await preconDecks();
    expect(decks).toHaveLength(197);
    expect(new Set(decks.map((d) => d.id)).size).toBe(197);
    const released = decks.map((d) => d.precon!.released);
    expect(released).toEqual([...released].sort().reverse());
    for (const d of decks) {
      expect(d.format).toBe('commander');
      expect(d.builtIn).toBe(true);
      expect([1, 2]).toContain(d.deck.commander!.length);
      expect([...d.deck.commander!, ...d.deck.main].reduce((n, e) => n + e.count, 0), d.name).toBe(100);
      expect(unplayableReason(d.deck, 'commander'), d.name).toBeNull();
    }
  });

  it('a precon is named with its set and year and lists its commander', async () => {
    const counterpunch = (await preconDecks()).find((d) => d.id === 'precon:counterpunch-cmd')!;
    expect(counterpunch.name).toBe('Counterpunch (CMD 2011)');
    expect(counterpunch.deck.commander).toEqual([{ count: 1, name: 'Ghave, Guru of Spores' }]);
    expect(deckOptionLabel(counterpunch)).toBe('Counterpunch (CMD 2011) · Ghave, Guru of Spores');
    const partners = (await preconDecks()).find((d) => d.deck.commander!.length === 2)!;
    expect(partners.precon!.commanders).toBe(partners.deck.commander!.map((e) => e.name).join(' and '));
  });
});

describe('DeckOptions', () => {
  const saved: GameDeck = { id: 'saved:1', name: 'My deck', deck: { main: [{ name: 'Forest', count: 60 }], sideboard: [] } };
  const row = (id: string, name: string, commander: string): PreconRow => ({
    id, name, set: 'TST', released: '2026-01-01', colors: 'G', commander: [[1, commander]], main: [[99, 'Forest']],
  });

  it('groups the decks: yours, the built-in ones, then the precons with their commanders', async () => {
    const { preconDeck } = await import('../src/game/precons');
    const decks = [saved, PRACTICE_DECKS[0]!, preconDeck(row('precon:a', 'Alpha', 'Test Bear')), preconDeck(row('precon:b', 'Beta', 'Test Elk'))];
    const { container } = render(
      <select aria-label="Deck">
        <DeckOptions decks={decks} />
      </select>,
    );
    const groups = [...container.querySelectorAll('optgroup')];
    expect(groups.map((g) => g.label)).toEqual(['Your decks', 'Built-in decks', 'Commander precons (2)']);
    expect(within(groups[2]!).getAllByRole('option').map((o) => o.textContent)).toEqual(['Alpha (TST 2026) · Test Bear', 'Beta (TST 2026) · Test Elk']);
  });

  it('leaves out a group with no decks', () => {
    const { container } = render(
      <select aria-label="Deck">
        <DeckOptions decks={[saved]} />
      </select>,
    );
    expect([...container.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['Your decks']);
  });
});
