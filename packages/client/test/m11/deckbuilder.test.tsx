/**
 * M11-2 (docs/design/m11-commander.md 5.5): the deckbuilder for a commander deck: "the 99 + commander" count in the header (CR 903.5a), a hint when two
 * commanders cannot partner (the validator's invalid-partners problem, CR 702.124f), and "Play this deck", which opens New game with it.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavProvider, useNav } from '../../src/app/nav';
import { DecksProvider } from '../../src/decks/context';
import { DeckbuilderScreen } from '../../src/decks/DeckbuilderScreen';
import { deckSize } from '../../src/decks/look';
import type { Deck } from '../../src/decks/model';
import { MemoryDeckStore } from '../../src/decks/store';
import { deckFixture, fakeServer, type FakeServer } from '../decks-fixtures';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const commanderDeck = (commander: Deck['commander']): Deck =>
  deckFixture({ format: 'commander', main: [{ name: 'Mountain', count: 99, oracleId: 'oid-mountain' }], sideboard: [], commander });

let route = '';
function Route() {
  const nav = useNav();
  route = JSON.stringify(nav.route);
  return null;
}

function renderBuilder(deck: Deck, server: FakeServer = {}) {
  fakeServer(server);
  const store = new MemoryDeckStore([deck]);
  render(
    <DecksProvider store={store}>
      <NavProvider initial={{ screen: 'deckbuilder', deckId: deck.id }}>
        <Route />
        <DeckbuilderScreen deckId={deck.id} now={() => '2026-10-14T12:00:00.000Z'} validateDelayMs={0} autoSearch={false} />
      </NavProvider>
    </DecksProvider>,
  );
}

describe('M11-2: the deckbuilder for a commander deck', () => {
  it('CR 903.5a: the header counts the 99 and the commander(s); Brawl is a 100-card format, Standard Brawl 60 (CR 903.12d)', async () => {
    renderBuilder(commanderDeck([{ name: 'Grizzly Bears', count: 1, oracleId: 'oid-grizzly-bears' }]));
    await screen.findByDisplayValue('Gruul Test');
    const count = screen.getByLabelText('Deck size');
    expect(count.textContent).toBe('99 + 1/100 Cards');
    expect(count.getAttribute('title')).toBe('99 cards and 1 commander (CR 903.5a)');
    expect([deckSize('brawl'), deckSize('standardbrawl')]).toEqual([100, 60]);
  });

  it('a normal deck keeps its plain count and has no "Play this deck"', async () => {
    renderBuilder(deckFixture());
    await screen.findByDisplayValue('Gruul Test');
    expect(screen.getByLabelText('Deck size').textContent).toBe('20/60 Cards');
    expect(screen.queryByRole('button', { name: 'Play this deck' })).toBeNull();
  });

  it('CR 702.124f: two commanders that cannot partner get a hint with the rule', async () => {
    const pair = commanderDeck([
      { name: 'Grizzly Bears', count: 1, oracleId: 'oid-grizzly-bears' },
      { name: 'Lightning Bolt', count: 1, oracleId: 'oid-lightning-bolt' },
    ]);
    renderBuilder(pair, {
      validate: ({ format }) => ({
        format, checkedAs: format, valid: false, status: 'illegal',
        problems: [{ kind: 'commander', severity: 'error', message: "Grizzly Bears and Lightning Bolt can't be commanders together: they don't share a partner ability.", card: 'Lightning Bolt', rules: ['CR 702.124f'] }],
      }),
    });
    const hint = await screen.findByText(/can't be commanders together/, { selector: '.deck-partner-hint' });
    expect(hint.textContent).toContain("Grizzly Bears and Lightning Bolt can't be commanders together");
    expect(hint.textContent).toContain('(CR 702.124f, 702.124h-j)');
  });

  it('"Play this deck" opens New game with the deck once it is saved', async () => {
    const deck = commanderDeck([{ name: 'Grizzly Bears', count: 1, oracleId: 'oid-grizzly-bears' }]);
    renderBuilder(deck);
    await screen.findByDisplayValue('Gruul Test');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Play this deck' }));
    });
    expect(JSON.parse(route)).toEqual({ screen: 'newGame', deckId: deck.id });
  });
});
