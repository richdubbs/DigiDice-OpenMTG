/**
 * Deckbuilder behavior from the C3 review: card images (opt-in Scryfall and the C2 card-component slot), the full search filters, paging the submitted
 * search, the casual format on the wire, keeping problems on screen while re-checking, focus and announcements, the deck name, the preview coming into
 * view (now a dialog), a deck changed in another tab, and plain words when the local server is not running.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CardSummary, SearchResponse, ValidateResponse } from '@openmtg/server/api';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { NavProvider } from '../src/app/nav';
import type { CardViewProps } from '../src/decks/CardPreview';
import { DecksProvider } from '../src/decks/context';
import { DeckbuilderScreen } from '../src/decks/DeckbuilderScreen';
import type { Deck } from '../src/decks/model';
import { MemoryDeckStore } from '../src/decks/store';
import { setShowScryfallImages } from '../src/images/settings';
import { byName, deckFixture, fakeServer, type FakeServer } from './decks-fixtures';

const NOW = '2026-10-12T12:00:00.000Z';
const SERVER_DOWN = 'The OpenMTG server is not running. Start it with npm run play, then try again.';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderBuilder(deck: Deck | null = deckFixture(), server: FakeServer = {}, env: { showScryfallImages?: boolean; cardView?: (p: CardViewProps) => JSX.Element } = {}) {
  const fetchMock = fakeServer(server);
  const store = new MemoryDeckStore(deck ? [deck] : []);
  render(
    <DecksProvider store={store} {...env}>
      <NavProvider>
        <DeckbuilderScreen {...(deck ? { deckId: deck.id } : {})} now={() => NOW} validateDelayMs={0} autoSearch={false} />
      </NavProvider>
    </DecksProvider>,
  );
  return { store, fetchMock };
}

const page = (cards: (string | CardSummary)[], extra: Partial<SearchResponse> = {}): SearchResponse => ({
  cards: cards.map((n) => (typeof n === 'string' ? byName.get(n)! : n)),
  page: 1,
  pageSize: 20,
  total: cards.length,
  ...extra,
});
const calls = (m: ReturnType<typeof fakeServer>, prefix: string) => m.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith(prefix));
const params = (u: string) => Object.fromEntries(new URL(u, 'http://x').searchParams);
const searchRegion = () => screen.getByRole('region', { name: 'Card search' });
const section = (name: RegExp) => screen.getByRole('region', { name });
const runSearch = () => fireEvent.click(within(searchRegion()).getByRole('button', { name: 'Search' }));

describe('deckbuilder: card images (ARCHITECTURE.md "Card images" A + B)', () => {
  it('asks for Scryfall image URLs only when the player opted in', async () => {
    const on = renderBuilder(deckFixture(), { search: () => page(['Forest']) }, { showScryfallImages: true });
    await screen.findByDisplayValue('Gruul Test');
    runSearch();
    await within(searchRegion()).findByRole('list', { name: 'Search results' });
    expect(params(calls(on.fetchMock, '/api/cards/search')[0]!).images).toBe('1');
    await waitFor(() => expect(calls(on.fetchMock, '/api/cards/Lightning').length).toBeGreaterThan(0));
    expect(calls(on.fetchMock, '/api/cards/Lightning')[0]).toBe('/api/cards/Lightning%20Bolt?images=1');
  });

  it('without the opt-in no image URLs are asked for', async () => {
    const off = renderBuilder(deckFixture(), { search: () => page(['Forest']) });
    await screen.findByDisplayValue('Gruul Test');
    runSearch();
    await within(searchRegion()).findByRole('list', { name: 'Search results' });
    expect(params(calls(off.fetchMock, '/api/cards/search')[0]!)).not.toHaveProperty('images');
    await waitFor(() => expect(calls(off.fetchMock, '/api/cards/Lightning')).toEqual(['/api/cards/Lightning%20Bolt']));
  });

  it('the preview shows the Scryfall image the server sent (opt-in), with the badge outside the picture', async () => {
    const bolt = byName.get('Lightning Bolt')!;
    const withImage: CardSummary = { ...bolt, name: 'Pictured Bolt', faces: [{ ...bolt.faces[0]!, name: 'Pictured Bolt', imageUris: { normal: 'https://cards.scryfall.io/normal/x.jpg', artist: 'Christopher Rush' } }] };
    // The page-wide setting (C2) decides what the card component shows; the deck screens follow it.
    setShowScryfallImages(true);
    onTestFinished(() => setShowScryfallImages(false));
    renderBuilder(deckFixture(), { search: () => page([withImage]) }, { showScryfallImages: true });
    await screen.findByDisplayValue('Gruul Test');
    runSearch();
    fireEvent.click(await within(searchRegion()).findByRole('button', { name: 'Pictured Bolt' }));
    const preview = screen.getByRole('region', { name: 'Card preview' });
    // The picture's accessible name and tooltip carry its artist.
    const img = within(preview).getByRole('img', { name: 'Pictured Bolt, illustrated by Christopher Rush' }) as HTMLImageElement;
    expect(img.title).toBe('Pictured Bolt, illustrated by Christopher Rush');
    expect(img.src).toBe('https://cards.scryfall.io/normal/x.jpg');
    expect(img.closest('.card-preview-info')).toBeNull();
    expect(within(preview).getByLabelText('Automation: full').closest('.card-preview-info')).not.toBeNull();
    // The Scryfall image is credited to its artist, under the picture (never on it), in the shared credit line.
    const credit = within(preview).getByText('Illustrated by Christopher Rush');
    expect(credit.closest('.card-preview-art')).not.toBeNull();
    expect(credit.classList.contains('artist-credit')).toBe(true);
    expect(img.contains(credit)).toBe(false);
    // The search result's thumbnail names the artist too (tooltip and accessible name), with no visible line in the list.
    const thumb = within(searchRegion()).getByRole('img', { name: 'Pictured Bolt, illustrated by Christopher Rush' });
    expect(thumb.title).toBe('Pictured Bolt, illustrated by Christopher Rush');
    expect(within(searchRegion()).queryByText(/Illustrated by/)).toBeNull();
  });

  it('no artist credit without the opt-in (our own frame needs none)', async () => {
    const bolt = byName.get('Lightning Bolt')!;
    const withImage: CardSummary = { ...bolt, name: 'Pictured Bolt', faces: [{ ...bolt.faces[0]!, name: 'Pictured Bolt', imageUris: { normal: 'https://cards.scryfall.io/normal/x.jpg', artist: 'Christopher Rush' } }] };
    renderBuilder(deckFixture(), { search: () => page([withImage]) });
    await screen.findByDisplayValue('Gruul Test');
    runSearch();
    fireEvent.click(await within(searchRegion()).findByRole('button', { name: 'Pictured Bolt' }));
    const preview = screen.getByRole('region', { name: 'Card preview' });
    expect(within(preview).queryByText(/Illustrated by/)).toBeNull();
  });

  it('the preview renders the card component the app provides (C2: uploaded image > Scryfall > placeholder) for each face', async () => {
    const cardView = ({ card, face }: CardViewProps) => <div data-testid="card-view">{`${card.name} face ${face ?? 0}`}</div>;
    renderBuilder(deckFixture(), {}, { cardView });
    await screen.findByDisplayValue('Gruul Test');
    await waitFor(() => expect(within(section(/Sideboard/)).getByLabelText('Automation: partial')).toBeTruthy());
    fireEvent.click(within(section(/Sideboard/)).getByRole('button', { name: 'Ancient Grudge' }));
    expect(screen.getAllByTestId('card-view').map((e) => e.textContent)).toEqual(['Ancient Grudge face 0']);
  });
});

describe('deckbuilder: search filters (decks-and-formats.md "Deckbuilder")', () => {
  it('CR 903.4, 208.1, 702.1: sends color identity, power, toughness and keywords', async () => {
    const { fetchMock } = renderBuilder(deckFixture(), { search: () => page([]) });
    await screen.findByDisplayValue('Gruul Test');
    const s = searchRegion();
    fireEvent.click(within(s).getByLabelText('Identity Green'));
    fireEvent.click(within(s).getByLabelText('Identity Red'));
    fireEvent.change(within(s).getByLabelText('Power'), { target: { value: '>= 3' } });
    fireEvent.change(within(s).getByLabelText('Toughness'), { target: { value: '<=2' } });
    fireEvent.change(within(s).getByLabelText('Keywords'), { target: { value: 'flying , lifelink' } });
    runSearch();
    await within(s).findByText('No cards found.');
    expect(params(calls(fetchMock, '/api/cards/search')[0]!)).toMatchObject({ identity: 'RG', pow: '>=3', tou: '<=2', keywords: 'flying,lifelink' });
  });

  it("CR 903.4: in a commander deck the identity filter starts at the commander's color identity", async () => {
    const { fetchMock } = renderBuilder(deckFixture({ format: 'commander', commander: [{ name: 'Grizzly Bears', count: 1 }], main: [], sideboard: [] }), { search: () => page([]) });
    await screen.findByDisplayValue('Gruul Test');
    await waitFor(() => expect((within(searchRegion()).getByLabelText('Identity Green') as HTMLInputElement).checked).toBe(true));
    runSearch();
    await within(searchRegion()).findByText('No cards found.');
    expect(params(calls(fetchMock, '/api/cards/search')[0]!).identity).toBe('G');
    // The player can widen it.
    fireEvent.click(within(searchRegion()).getByLabelText('Identity Blue'));
    runSearch();
    await waitFor(() => expect(calls(fetchMock, '/api/cards/search')).toHaveLength(2));
    expect(params(calls(fetchMock, '/api/cards/search')[1]!).identity).toBe('UG');
  });
});

describe('deckbuilder: paging', () => {
  const paged: FakeServer = {
    search: (p) => (p.get('page') === '2' ? page(['Forest'], { page: 2, pageSize: 2, total: 3 }) : page(['Lightning Bolt', 'Mountain'], { pageSize: 2, total: 3 })),
  };

  it('Next pages through the submitted search, not filters changed since; results stay on screen (and focus on the pager) while loading', async () => {
    const { fetchMock } = renderBuilder(deckFixture(), paged);
    await screen.findByDisplayValue('Gruul Test');
    fireEvent.change(within(searchRegion()).getByLabelText('Name or rules text'), { target: { value: 'a' } });
    runSearch();
    await within(searchRegion()).findByText('3 cards, page 1 of 2');
    fireEvent.click(within(searchRegion()).getByLabelText('White'));
    expect(within(searchRegion()).getByText(/Filters changed: press Search/)).toBeTruthy();
    const next = within(searchRegion()).getByRole('button', { name: 'Next' });
    next.focus();
    fireEvent.click(next);
    expect(next.isConnected).toBe(true);
    expect(document.activeElement).toBe(next);
    await within(searchRegion()).findByText('3 cards, page 2 of 2');
    expect(params(calls(fetchMock, '/api/cards/search').at(-1)!)).toEqual({ q: 'a', format: 'modern', page: '2' });
    expect(document.activeElement).toBe(next);
  });
});

describe('deckbuilder: validation', () => {
  const problems: ValidateResponse = {
    format: 'modern',
    checkedAs: 'modern',
    valid: false,
    status: 'illegal',
    problems: [{ kind: 'banned', severity: 'error', message: 'Ancient Grudge is banned in Modern.', card: 'Ancient Grudge', rules: ['CR 100.6'] }],
  };

  it('a casual deck is checked as "freeform", the contract value for no card-pool checks', async () => {
    const validate = vi.fn((_: { deck: Deck; format: string }) => ({ format: 'freeform', checkedAs: 'casual', valid: true, status: 'legal' as const, problems: [] }));
    const { store } = renderBuilder(deckFixture({ format: 'casual' }), { validate });
    await screen.findByText('Legal in Casual (no restrictions).');
    expect(validate.mock.calls[0]![0].format).toBe('freeform');
    expect((await store.get('deck-1'))!.format).toBe('casual');
  });

  it('CR 100.6: problems stay on screen (marked as re-checking) until the new answer arrives, so rows do not jump', async () => {
    renderBuilder(deckFixture(), { validate: () => problems });
    await screen.findByText('Not legal in Modern: 1 problem.');
    fireEvent.click(screen.getByRole('button', { name: 'Add one Lightning Bolt' }));
    const grudge = within(section(/Sideboard/)).getByRole('listitem', { name: '2 Ancient Grudge' });
    expect(within(grudge).getByRole('note').textContent).toBe('Ancient Grudge is banned in Modern. (CR 100.6)');
    const panel = screen.getByRole('region', { name: 'Format check' });
    expect(within(panel).getByText('Re-checking…')).toBeTruthy();
    expect(within(panel).getByRole('list', { name: 'Deck problems' })).toBeTruthy();
    await waitFor(() => expect(within(panel).queryByText('Re-checking…')).toBeNull());
    expect(within(grudge).getByRole('note')).toBeTruthy();
  });

  it('says the server is not running when the check cannot reach it', async () => {
    renderBuilder(deckFixture(), {
      validate: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const panel = await screen.findByRole('region', { name: 'Format check' });
    expect((await within(panel).findByRole('alert')).textContent).toBe(`Could not check the deck: ${SERVER_DOWN}`);
  });
});

describe('deckbuilder: server not running', () => {
  it('search says the server is not running instead of the browser error', async () => {
    renderBuilder(deckFixture(), {
      search: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await screen.findByDisplayValue('Gruul Test');
    runSearch();
    expect((await within(searchRegion()).findByRole('alert')).textContent).toBe(`Search failed: ${SERVER_DOWN}`);
  });
});

describe('deckbuilder: focus and announcements', () => {
  it('removing the last copy moves focus to the next row; a move focuses the card in its new section and is announced', async () => {
    renderBuilder(deckFixture({ main: [{ name: 'Lightning Bolt', count: 1 }, { name: 'Mountain', count: 10 }] }));
    await screen.findByDisplayValue('Gruul Test');
    fireEvent.click(screen.getByRole('button', { name: 'Remove one Lightning Bolt' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove one Mountain' }));
    expect(screen.getByTestId('deck-announcer').textContent).toBe('Removed Lightning Bolt from the main deck.');

    fireEvent.click(screen.getByRole('button', { name: 'Move Ancient Grudge to main deck' }));
    expect(document.activeElement).toBe(within(section(/Main deck/)).getByRole('button', { name: 'Move Ancient Grudge to sideboard' }));
    expect(screen.getByTestId('deck-announcer').textContent).toBe('Moved Ancient Grudge to the main deck.');

    // The sideboard is now empty: removing from it is no longer possible, and removing the main deck's last row focuses the section heading.
    fireEvent.click(screen.getByRole('button', { name: 'Move Ancient Grudge to sideboard' }));
    for (let i = 0; i < 10; i++) fireEvent.click(screen.getByRole('button', { name: 'Remove one Mountain' }));
    expect(document.activeElement).toBe(within(section(/Main deck/)).getByRole('heading'));
  });

  it('opening a card shows it large in a dialog and moves focus to the preview', async () => {
    renderBuilder();
    await screen.findByDisplayValue('Gruul Test');
    await waitFor(() => expect(within(section(/Main deck/)).getAllByLabelText(/Automation:/).length).toBeGreaterThan(0));
    const opener = within(section(/Main deck/)).getByRole('button', { name: 'Grizzly Bears' });
    // A real click focuses the button first.
    opener.focus();
    fireEvent.click(opener);
    const preview = screen.getByRole('region', { name: 'Card preview' });
    expect(document.activeElement).toBe(preview);
    expect(screen.getByRole('dialog', { name: 'Grizzly Bears, large' }).contains(preview)).toBe(true);
    // Escape closes it and puts focus back on the name that opened it.
    fireEvent.keyDown(preview, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Card preview' })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('deckbuilder: deck name', () => {
  it('an empty name is never saved; the last name comes back when the field is left', async () => {
    const { store } = renderBuilder();
    const field = (await screen.findByDisplayValue('Gruul Test')) as HTMLInputElement;
    fireEvent.change(field, { target: { value: '   ' } });
    expect(screen.getByText(/A deck needs a name/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add one Lightning Bolt' }));
    await waitFor(async () => expect((await store.get('deck-1'))!.main[0]!.count).toBe(5));
    expect((await store.get('deck-1'))!.name).toBe('Gruul Test');
    fireEvent.blur(field);
    expect(field.value).toBe('Gruul Test');
    fireEvent.change(field, { target: { value: 'Gruul Smash' } });
    await waitFor(async () => expect((await store.get('deck-1'))!.name).toBe('Gruul Smash'));
  });
});

describe('deckbuilder: the same deck open in two tabs', () => {
  it('does not overwrite changes made elsewhere; it offers to reload them', async () => {
    const { store } = renderBuilder();
    await screen.findByDisplayValue('Gruul Test');
    // Another tab saves its own version of the deck.
    await store.put(deckFixture({ name: 'Other tab', main: [{ name: 'Mountain', count: 21 }], updatedAt: '2026-10-11T00:00:00.000Z' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add one Lightning Bolt' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/changed in another tab/);
    expect((await store.get('deck-1'))!.main).toEqual([{ name: 'Mountain', count: 21 }]);
    fireEvent.click(screen.getByRole('button', { name: 'Reload the deck' }));
    expect(await screen.findByDisplayValue('Other tab')).toBeTruthy();
    expect(within(section(/Main deck/)).getByRole('listitem', { name: '21 Mountain' })).toBeTruthy();
    // After reloading, changes save again.
    fireEvent.click(screen.getByRole('button', { name: 'Add one Mountain' }));
    await waitFor(async () => expect((await store.get('deck-1'))!.main).toEqual([{ name: 'Mountain', count: 22 }]));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
