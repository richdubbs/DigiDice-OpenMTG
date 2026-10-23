/** Deckbuilder: search with filters (mock API), automation badges, adding/removing/moving cards, live validation with the rule shown inline, stats. */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SearchResponse, ValidateResponse } from '@openmtg/server/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavProvider } from '../src/app/nav';
import { DecksProvider } from '../src/decks/context';
import { DeckbuilderScreen } from '../src/decks/DeckbuilderScreen';
import type { Deck } from '../src/decks/model';
import { MemoryDeckStore } from '../src/decks/store';
import { CARDS, byName, deckFixture, fakeServer, type FakeServer } from './decks-fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const NOW = '2026-10-12T12:00:00.000Z';

function renderBuilder(deck: Deck | null = deckFixture(), server: FakeServer = {}) {
  const fetchMock = fakeServer(server);
  const store = new MemoryDeckStore(deck ? [deck] : []);
  render(
    <DecksProvider store={store}>
      <NavProvider>
        <DeckbuilderScreen {...(deck ? { deckId: deck.id } : {})} now={() => NOW} validateDelayMs={0} autoSearch={false} />
      </NavProvider>
    </DecksProvider>,
  );
  return { store, fetchMock };
}

const page = (cards: string[], extra: Partial<SearchResponse> = {}): SearchResponse => ({ cards: cards.map((n) => byName.get(n)!), page: 1, pageSize: 20, total: cards.length, ...extra });
const searchCalls = (m: ReturnType<typeof fakeServer>) => m.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/cards/search'));
const searchRegion = () => screen.getByRole('region', { name: 'Card search' });
const section = (name: RegExp) => screen.getByRole('region', { name });

describe('deckbuilder: loading', () => {
  it('opens the saved deck: name, format, sections with counts, and an unknown id says so', async () => {
    renderBuilder();
    expect(await screen.findByDisplayValue('Gruul Test')).toBeTruthy();
    expect((screen.getByLabelText('Format') as HTMLSelectElement).value).toBe('modern');
    expect(section(/Main deck/).querySelector('h2')!.textContent).toBe('Main deck (20)');
    expect(within(section(/Sideboard/)).getByRole('listitem', { name: '2 Ancient Grudge' })).toBeTruthy();
    // Card data arrives from GET /api/cards/:name: automation badges appear next to the cards.
    await waitFor(() => expect(within(section(/Sideboard/)).getByLabelText('Automation: partial')).toBeTruthy());
  });

  it('a missing deck id is reported', async () => {
    fakeServer();
    render(
      <DecksProvider store={new MemoryDeckStore()}>
        <NavProvider>
          <DeckbuilderScreen deckId="nope" />
        </NavProvider>
      </DecksProvider>,
    );
    expect((await screen.findByRole('alert')).textContent).toBe('Deck: nope was not found in your deck library.');
  });
});

describe('deckbuilder: search', () => {
  it('sends the filters as the search query and shows results with automation badges', async () => {
    const { fetchMock } = renderBuilder(deckFixture(), { search: () => page(['Lightning Bolt', 'Ancient Grudge', 'Boros Charm']) });
    await screen.findByDisplayValue('Gruul Test');
    const s = searchRegion();
    fireEvent.change(within(s).getByLabelText('Name or rules text'), { target: { value: 'damage' } });
    fireEvent.click(within(s).getByLabelText('Red'));
    fireEvent.click(within(s).getByLabelText('White'));
    fireEvent.change(within(s).getByLabelText('Types'), { target: { value: 'instant , sorcery' } });
    fireEvent.change(within(s).getByLabelText('Mana value'), { target: { value: '<= 2' } });
    fireEvent.change(within(s).getByLabelText('Automation'), { target: { value: 'partial' } });
    fireEvent.click(within(s).getByRole('button', { name: 'Search' }));
    const results = await within(s).findByRole('list', { name: 'Search results' });
    const url = new URL(searchCalls(fetchMock)[0]!, 'http://x');
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'damage', colors: 'WR', types: 'instant,sorcery', mv: '<=2', format: 'modern', automation: 'partial', page: '1' });
    expect(within(results).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Lightning Bolt', 'Ancient Grudge', 'Boros Charm']);
    expect(within(within(results).getByRole('listitem', { name: 'Boros Charm' })).getByLabelText('Automation: manual').textContent).toBe('Manual');
    expect(within(within(results).getByRole('listitem', { name: 'Lightning Bolt' })).getByText('4 in deck')).toBeTruthy();
    expect(within(s).getByText('3 cards')).toBeTruthy();
  });

  it('"Legal in <format>" can be switched off; casual decks never send a format', async () => {
    const { fetchMock } = renderBuilder(deckFixture(), { search: () => page([]) });
    await screen.findByDisplayValue('Gruul Test');
    fireEvent.click(within(searchRegion()).getByLabelText(/Legal in Modern/));
    fireEvent.click(within(searchRegion()).getByRole('button', { name: 'Search' }));
    await within(searchRegion()).findByText('No cards found.');
    expect(searchCalls(fetchMock)[0]).toBe('/api/cards/search?page=1');

    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'casual' } });
    expect(within(searchRegion()).queryByLabelText(/Legal in/)).toBeNull();
    fireEvent.click(within(searchRegion()).getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(searchCalls(fetchMock)).toHaveLength(2));
    expect(new URL(searchCalls(fetchMock)[1]!, 'http://x').searchParams.has('format')).toBe(false);
  });

  it('pages through results', async () => {
    const { fetchMock } = renderBuilder(deckFixture(), {
      search: (p) => (p.get('page') === '2' ? page(['Forest'], { page: 2, pageSize: 2, total: 3 }) : page(['Lightning Bolt', 'Mountain'], { pageSize: 2, total: 3 })),
    });
    await screen.findByDisplayValue('Gruul Test');
    fireEvent.change(within(searchRegion()).getByLabelText('Name or rules text'), { target: { value: 'a' } });
    fireEvent.submit(within(searchRegion()).getByLabelText('Name or rules text'));
    await within(searchRegion()).findByText('3 cards, page 1 of 2');
    expect((within(searchRegion()).getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(searchRegion()).getByRole('button', { name: 'Next' }));
    await within(searchRegion()).findByText('3 cards, page 2 of 2');
    expect(within(searchRegion()).getByRole('listitem', { name: 'Forest' })).toBeTruthy();
    expect(searchCalls(fetchMock).at(-1)).toBe('/api/cards/search?format=modern&page=2&q=a');
  });

  it('shows a search error from the server', async () => {
    renderBuilder();
    await screen.findByDisplayValue('Gruul Test');
    fireEvent.click(within(searchRegion()).getByRole('button', { name: 'Search' }));
    expect((await within(searchRegion()).findByRole('alert')).textContent).toMatch(/Search failed: not implemented/);
  });

  it('adds results to the main deck and sideboard and saves each change', async () => {
    const { store } = renderBuilder(deckFixture(), { search: () => page(['Lightning Bolt', 'Forest']) });
    await screen.findByDisplayValue('Gruul Test');
    fireEvent.click(within(searchRegion()).getByRole('button', { name: 'Search' }));
    await within(searchRegion()).findByRole('list', { name: 'Search results' });
    fireEvent.click(screen.getByRole('button', { name: 'Add Forest to main deck' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Forest to main deck' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Lightning Bolt to sideboard' }));
    expect(within(section(/Main deck/)).getByRole('listitem', { name: '2 Forest' })).toBeTruthy();
    expect(within(section(/Sideboard/)).getByRole('listitem', { name: '1 Lightning Bolt' })).toBeTruthy();
    expect(within(searchRegion()).getByText('5 in deck')).toBeTruthy();
    await waitFor(async () => expect((await store.get('deck-1'))!.main.at(-1)).toEqual({ name: 'Forest', count: 2, oracleId: 'oid-forest' }));
    expect((await store.get('deck-1'))!.updatedAt).toBe(NOW);
  });

  it('CR 903.3, 702.139a: commander formats get a commander slot; the companion slot holds one card and a second replaces the first', async () => {
    const { store } = renderBuilder(deckFixture({ format: 'commander', main: [], sideboard: [] }), { search: () => page(['Grizzly Bears', 'Lurrus of the Dream-Den', 'Jegantha, the Wellspring']) });
    await screen.findByDisplayValue('Gruul Test');
    expect(section(/Commander/).textContent).toMatch(/Empty/);
    fireEvent.click(within(searchRegion()).getByRole('button', { name: 'Search' }));
    await within(searchRegion()).findByRole('list', { name: 'Search results' });
    fireEvent.click(screen.getByRole('button', { name: 'Set Grizzly Bears as commander' }));
    fireEvent.click(screen.getByRole('button', { name: 'Set Grizzly Bears as commander' }));
    expect(within(section(/Commander/)).getByRole('listitem', { name: '1 Grizzly Bears' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Set Grizzly Bears as companion' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Set Lurrus of the Dream-Den as companion' }));
    expect(within(section(/Companion/)).getByRole('listitem', { name: '1 Lurrus of the Dream-Den' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Set Jegantha, the Wellspring as companion' }));
    expect(within(section(/Companion/)).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['1 Jegantha, the Wellspring']);
    await waitFor(async () => expect((await store.get('deck-1'))!.companion.map((e) => e.name)).toEqual(['Jegantha, the Wellspring']));
  });
});

describe('deckbuilder: editing', () => {
  it('+ and − change counts, a card at 0 disappears, and cards move between main deck and sideboard', async () => {
    const { store } = renderBuilder();
    await screen.findByDisplayValue('Gruul Test');
    fireEvent.click(screen.getByRole('button', { name: 'Add one Lightning Bolt' }));
    expect(within(section(/Main deck/)).getByRole('listitem', { name: '5 Lightning Bolt' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move Ancient Grudge to main deck' }));
    expect(within(section(/Main deck/)).getByRole('listitem', { name: '2 Ancient Grudge' })).toBeTruthy();
    expect(section(/Sideboard/).querySelector('h2')!.textContent).toBe('Sideboard (0)');
    for (let i = 0; i < 2; i++) fireEvent.click(screen.getByRole('button', { name: 'Remove one Stomping Ground' }));
    expect(screen.queryByRole('listitem', { name: /Stomping Ground/ })).toBeNull();
    await waitFor(async () => expect((await store.get('deck-1'))!.main.map((e) => `${e.count} ${e.name}`)).toEqual(['5 Lightning Bolt', '4 Grizzly Bears', '10 Mountain', '2 Ancient Grudge']));
  });

  it('drags a card from the sideboard to the main deck', async () => {
    renderBuilder();
    await screen.findByDisplayValue('Gruul Test');
    const data = new Map<string, string>();
    const dataTransfer = { setData: (t: string, v: string) => data.set(t, v), getData: (t: string) => data.get(t) ?? '', get types() { return [...data.keys()]; }, effectAllowed: 'all' };
    fireEvent.dragStart(within(section(/Sideboard/)).getByRole('listitem', { name: '2 Ancient Grudge' }), { dataTransfer });
    fireEvent.dragOver(section(/Main deck/), { dataTransfer });
    fireEvent.drop(section(/Main deck/), { dataTransfer });
    expect(within(section(/Main deck/)).getByRole('listitem', { name: '2 Ancient Grudge' })).toBeTruthy();
  });

  it('renames the deck, changes its format and keeps notes', async () => {
    const { store } = renderBuilder();
    await screen.findByDisplayValue('Gruul Test');
    fireEvent.change(screen.getByLabelText('Deck name'), { target: { value: 'Gruul Aggro' } });
    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'pioneer' } });
    fireEvent.change(screen.getByLabelText('Deck notes'), { target: { value: 'Side in Grudge vs. affinity' } });
    await waitFor(async () => expect(await store.get('deck-1')).toMatchObject({ name: 'Gruul Aggro', format: 'pioneer', notes: 'Side in Grudge vs. affinity' }));
  });
});

describe('deckbuilder: validation', () => {
  const problems: ValidateResponse = {
    format: 'modern',
    checkedAs: 'modern',
    valid: false,
    status: 'illegal',
    problems: [
      { kind: 'size', severity: 'error', message: 'The main deck has 20 cards; it needs at least 60.', rules: ['CR 100.2a'] },
      { kind: 'copies', severity: 'error', message: 'Lightning Bolt: 5 copies; at most 4 are allowed.', card: 'Lightning Bolt', rules: ['CR 100.2a'] },
      { kind: 'banned', severity: 'error', message: 'Ancient Grudge is banned in Modern.', card: 'Ancient Grudge', rules: ['CR 100.6'] },
    ],
  };

  it('CR 100.2a, 100.6: sends the deck and format, lists the problems with their rules, and shows card problems next to the card', async () => {
    const validate = vi.fn((_: { deck: Deck; format: string }) => problems);
    renderBuilder(deckFixture(), { validate });
    const panel = await screen.findByRole('region', { name: 'Format check' });
    await within(panel).findByText('Not legal in Modern: 3 problems.');
    expect(within(within(panel).getByRole('list', { name: 'Deck problems' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'The main deck has 20 cards; it needs at least 60. (CR 100.2a)',
      'Lightning Bolt: 5 copies; at most 4 are allowed. (CR 100.2a)',
      'Ancient Grudge is banned in Modern. (CR 100.6)',
    ]);
    const grudge = within(section(/Sideboard/)).getByRole('listitem', { name: '2 Ancient Grudge' });
    expect(within(grudge).getByRole('note').textContent).toBe('Ancient Grudge is banned in Modern. (CR 100.6)');
    expect(grudge.className).toContain('has-problem');
    expect(within(section(/Main deck/)).getByRole('listitem', { name: '4 Grizzly Bears' }).className).not.toContain('has-problem');
    const sent = validate.mock.calls[0]![0];
    expect(sent.format).toBe('modern');
    expect(sent.deck.main).toEqual(deckFixture().main);
    expect(sent.deck).not.toHaveProperty('commander');
  });

  it('CR 100.6: a deck that is valid but "unchecked" (warnings) is never shown as legal; its warnings are listed, notes are not', async () => {
    const unchecked: ValidateResponse = {
      format: 'modern',
      checkedAs: 'modern',
      valid: true,
      status: 'unchecked',
      problems: [
        { kind: 'unknown', severity: 'warning', message: 'Ancient Grudge has no legality data.', card: 'Ancient Grudge', rules: ['CR 100.6'] },
        { kind: 'sideboard', severity: 'note', message: 'A note only.', rules: [] },
      ],
    };
    renderBuilder(deckFixture(), { validate: vi.fn(() => unchecked) });
    const panel = await screen.findByRole('region', { name: 'Format check' });
    await within(panel).findByText('Not fully checked for Modern: 1 warning.');
    expect(within(panel).queryByText('Legal in Modern.')).toBeNull();
    expect(within(within(panel).getByRole('list', { name: 'Deck problems' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Ancient Grudge has no legality data. (CR 100.6)',
    ]);
  });

  it('checks again after a change and shows a legal deck', async () => {
    const validate = vi.fn(({ deck }: { deck: Deck; format: string }) => (deck.sideboard.length ? problems : { format: 'modern', checkedAs: 'modern', valid: true, status: 'legal' as const, problems: [] }));
    renderBuilder(deckFixture(), { validate });
    await screen.findByText('Not legal in Modern: 3 problems.');
    fireEvent.click(screen.getByRole('button', { name: 'Remove one Ancient Grudge' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove one Ancient Grudge' }));
    expect(await screen.findByText('Legal in Modern.')).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('says when the check is unavailable instead of claiming the deck is legal', async () => {
    renderBuilder(deckFixture(), {
      validate: () => {
        throw new Error('server unreachable');
      },
    });
    const panel = await screen.findByRole('region', { name: 'Format check' });
    expect((await within(panel).findByRole('alert')).textContent).toBe('Could not check the deck: server unreachable');
    expect(within(panel).queryByText(/Legal in/)).toBeNull();
  });
});

describe('deckbuilder: stats and preview', () => {
  it('CR 202.3, 305.6: Deck Details shows land count, the mana value curve and colors once card data has loaded', async () => {
    renderBuilder();
    await screen.findByDisplayValue('Gruul Test');
    // The deckbuilder opens in the build view; statistics are in the Details view (the deck library opens that one).
    expect(screen.queryByRole('region', { name: 'Deck statistics' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Deck Details');
    const stats = await screen.findByRole('region', { name: 'Deck statistics' });
    await waitFor(() => expect(within(stats).getByText(/Lands:/).textContent).toBe('Lands: 12'));
    expect(within(stats).getByLabelText('Mana value 1 or less: 4')).toBeTruthy();
    expect(within(stats).getByLabelText('Mana value 2: 4')).toBeTruthy();
    expect(within(stats).getByText('Average: 1.5')).toBeTruthy();
    // Creatures (Grizzly Bears) and non-creatures (Lightning Bolt) are counted apart.
    expect(within(stats).getByText('Creatures').textContent!.trim()).toBe('Creatures 4');
    expect(within(stats).getByText('NonCreatures').textContent!.trim()).toBe('NonCreatures 4');
    const red = within(stats).getByRole('row', { name: /Red/ });
    expect(within(red).getAllByRole('cell').map((c) => c.textContent)).toEqual(['4', '50%', '12']);
    const types = screen.getByRole('region', { name: 'Card types' });
    expect(within(types).getByText('Creature').parentElement!.textContent).toBe('Creature 4');
    expect(within(types).getByText('Bear').parentElement!.textContent).toBe('Bear 4');
    expect(within(types).getByText('Land').parentElement!.textContent).toBe('Land 12');
  });

  it('previews a card with its automation level and manual parts, and can make it the deck cover', async () => {
    const { store } = renderBuilder();
    await screen.findByDisplayValue('Gruul Test');
    await waitFor(() => expect(within(section(/Sideboard/)).getByLabelText('Automation: partial')).toBeTruthy());
    fireEvent.click(within(section(/Sideboard/)).getByRole('button', { name: 'Ancient Grudge' }));
    const preview = screen.getByRole('region', { name: 'Card preview' });
    // C2's card component draws our text frame (no image uploaded, Scryfall images off).
    expect(within(preview).getByRole('group', { name: 'Ancient Grudge' }).textContent).toContain('Destroy target artifact.');
    await waitFor(() => expect(within(preview).getByText(/Resolved by hand/)).toBeTruthy());
    const part = within(within(preview).getByRole('list', { name: 'Resolved by hand' })).getByRole('listitem');
    // The server's player-facing summary (C1); what the player does, and the compiler's diagnostic, are in the closed "Details".
    expect(part.textContent).toMatch(/^“?Flashback \{G\}”? This ability is done by hand\./);
    expect(part.querySelector('details')!.textContent).toContain('You resolve this ability by hand.');
    // The compiler's diagnostic stays in a closed "Details" element, not in the player's text.
    expect(part.querySelector('details')!.open).toBe(false);
    expect(part.querySelector('details')!.textContent).toContain('no template');
    fireEvent.click(within(preview).getByRole('button', { name: 'Use as deck cover' }));
    await waitFor(async () => expect((await store.get('deck-1'))!.cover).toBe('Ancient Grudge'));
    expect(within(preview).getByRole('button', { name: 'Deck cover' })).toBeTruthy();
  });

  it('shows the chosen cover card on the deck box next to the deck name (it was always the card back)', async () => {
    const { store } = renderBuilder();
    await screen.findByDisplayValue('Gruul Test');
    const thumb = () => document.querySelector('.deck-list-thumb')!;
    // No cover yet: the DigiDice card back.
    expect(thumb().querySelector('.deck-box-cover')).toBeNull();
    expect(thumb().querySelector('img.deck-box-face')).toBeTruthy();
    await waitFor(() => expect(within(section(/Sideboard/)).getByLabelText('Automation: partial')).toBeTruthy());
    fireEvent.click(within(section(/Sideboard/)).getByRole('button', { name: 'Ancient Grudge' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Card preview' })).getByRole('button', { name: 'Use as deck cover' }));
    await waitFor(() => expect(thumb().querySelector('.deck-box-cover')?.getAttribute('data-cover')).toBe('Ancient Grudge'));
    expect(thumb().querySelector('img.deck-box-face')).toBeNull();
    expect(thumb().querySelector('.deck-box-cover')!.textContent).toContain('Destroy target artifact.');
    await waitFor(async () => expect((await store.get('deck-1'))!.cover).toBe('Ancient Grudge'));
  });

  it('a saved cover that is not in the deck is looked up and shown when the deck is opened', async () => {
    renderBuilder(deckFixture({ cover: 'Boros Charm' }));
    await screen.findByDisplayValue('Gruul Test');
    await waitFor(() => expect(document.querySelector('.deck-list-thumb .deck-box-cover')?.getAttribute('data-cover')).toBe('Boros Charm'));
  });

  it('marks deck cards the server does not know', async () => {
    renderBuilder(deckFixture({ main: [{ name: 'Not A Card', count: 1 }] }));
    expect(await within(await screen.findByRole('region', { name: /Main deck/ })).findByText('Unknown card')).toBeTruthy();
  });

  it('does not call a card unknown when the lookup itself failed (server down)', async () => {
    renderBuilder(deckFixture(), { cards: 'down' });
    const main = await screen.findByRole('region', { name: /Main deck/ });
    expect(await within(main).findAllByText('Card data unavailable')).toHaveLength(4);
    expect(within(main).queryByText('Unknown card')).toBeNull();
  });
});

describe('deckbuilder: a new deck without an id', () => {
  it('starts empty and is saved on the first change', async () => {
    const { store } = renderBuilder(null, { search: () => page(['Forest']) });
    expect(await screen.findByDisplayValue('New deck')).toBeTruthy();
    expect(await store.list()).toEqual([]);
    fireEvent.click(within(searchRegion()).getByRole('button', { name: 'Search' }));
    await within(searchRegion()).findByRole('list', { name: 'Search results' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add Forest to main deck' }));
    });
    await waitFor(async () => expect((await store.list())[0]!.main).toEqual([{ name: 'Forest', count: 1, oracleId: CARDS.find((c) => c.name === 'Forest')!.oracleId }]));
  });
});
