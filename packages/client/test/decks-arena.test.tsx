/**
 * The Arena-style deck screens: the library as a grid of deck boxes (colors, format check, Deck Details from a click, Edit into the builder, modal
 * actions), the builder's pool (live search, clear, filters drawer, colour toggles, hover preview with keyword reminders), the tinted deck banners, the
 * Build / Details switch and Done.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SearchResponse } from '@openmtg/server/api';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App, preloadScreens } from '../src/app/App';
import { NavProvider } from '../src/app/nav';
import { DecksProvider } from '../src/decks/context';
import { DeckbuilderScreen } from '../src/decks/DeckbuilderScreen';
import { previewPlacement } from '../src/decks/DeckbuilderScreen';
import { MemoryDeckStore } from '../src/decks/store';
import { requestedView, requestView } from '../src/decks/view';
import { byName, card, deckFixture, fakeServer, type FakeServer } from './decks-fixtures';

// The screens are separate chunks (App.tsx); load them once before the tests, under this hook's own timeout, so a busy machine's module loading is not
// counted against a test's or a findBy's timeout (CL3: this file's lazy-loading tests timed out under full-suite load).
beforeAll(() => preloadScreens(), 120_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

const NOW = '2026-10-12T12:00:00.000Z';
const page = (cards: ReturnType<typeof card>[], extra: Partial<SearchResponse> = {}): SearchResponse => ({ cards, page: 1, pageSize: 50, total: cards.length, ...extra });
const searchCalls = (m: ReturnType<typeof fakeServer>) => m.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/cards/search'));
const flyer = card('Wind Drake', { cost: '{2}{U}', type: 'Creature — Drake', text: 'Flying', mv: 3, colors: ['U'], pt: ['2', '2'] });

async function renderLibrary(server: FakeServer = {}) {
  const fetchMock = fakeServer(server);
  const store = new MemoryDeckStore([deckFixture(), deckFixture({ id: 'deck-2', name: 'Empty one', main: [], sideboard: [], updatedAt: '2026-10-01T00:00:00.000Z' })]);
  render(
    <DecksProvider store={store}>
      <App initial={{ screen: 'decks' }} />
    </DecksProvider>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Decks' });
  return { store, fetchMock };
}

describe('deck library as deck boxes', () => {
  it('shows each deck as a box with its colors and the format check, and an empty deck says so without asking the server', async () => {
    const validate = vi.fn(() => ({ format: 'modern', checkedAs: 'modern', valid: true, status: 'legal' as const, problems: [] }));
    const { fetchMock } = await renderLibrary({ validate });
    const row = await screen.findByRole('listitem', { name: 'Gruul Test' });
    expect(await within(row).findByText('Legal')).toBeTruthy();
    expect(await within(row).findByRole('img', { name: 'Colors: Red, Green' })).toBeTruthy();
    expect(within(row).getByText(/Modern · 20 main · 2 sideboard/)).toBeTruthy();
    expect(await within(screen.getByRole('listitem', { name: 'Empty one' })).findByText('Empty')).toBeTruthy();
    // Only the deck with cards is checked.
    expect(validate).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/decks/validate'))).toBe(true);
  });

  it('shows illegal and not fully checked answers as chips, never "Legal"', async () => {
    await renderLibrary({ validate: () => ({ format: 'modern', checkedAs: 'modern', valid: false, status: 'illegal', problems: [{ kind: 'size', severity: 'error', message: 'Too small.', rules: [] }, { kind: 'sideboard', severity: 'note', message: 'A note.', rules: [] }] }) });
    const row = await screen.findByRole('listitem', { name: 'Gruul Test' });
    expect(await within(row).findByText('1 problem')).toBeTruthy();
    expect(within(row).queryByText('Legal')).toBeNull();
  });

  it('clicking a box opens Deck Details (statistics around the deck box); Edit opens the builder', async () => {
    await renderLibrary();
    const row = await screen.findByRole('listitem', { name: 'Gruul Test' });
    fireEvent.click(within(row).getByRole('button', { name: 'Gruul Test' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Deck Details' })).toBeTruthy();
    expect(await screen.findByRole('region', { name: 'Deck statistics' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Card types' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Details' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(within(await screen.findByRole('listitem', { name: 'Gruul Test' })).getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Deckbuilder' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Card search' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Build' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('the library says which view a deck opens in; a deck never opened that way builds', () => {
    requestView('x', 'details');
    expect(requestedView('x')).toBe('details');
    expect(requestedView('never-seen')).toBe('build');
    expect(requestedView(undefined)).toBe('build');
  });

  it('rename opens as a dialog: Escape closes it and focus returns to the button that opened it', async () => {
    await renderLibrary();
    const row = await screen.findByRole('listitem', { name: 'Gruul Test' });
    const rename = within(row).getByRole('button', { name: 'Rename' });
    rename.focus();
    fireEvent.click(rename);
    const dialog = within(row).getByRole('dialog', { name: 'Rename Gruul Test' });
    expect(within(dialog).getByLabelText('New name')).toBe(document.activeElement);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(within(row).queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(rename);
  });

  it('delete is a confirmation dialog whose Cancel takes focus, and a click outside it closes it', async () => {
    await renderLibrary();
    const row = await screen.findByRole('listitem', { name: 'Gruul Test' });
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    const dialog = within(row).getByRole('alertdialog', { name: 'Delete Gruul Test' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(row.querySelector('.deck-modal-backdrop')!);
    expect(within(row).queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('listitem', { name: 'Gruul Test' })).toBeTruthy();
  });
});

describe('builder pool', () => {
  async function renderBuilder(server: FakeServer, deck = deckFixture()) {
    const fetchMock = fakeServer(server);
    const store = new MemoryDeckStore([deck]);
    render(
      <DecksProvider store={store}>
        <NavProvider>
          <DeckbuilderScreen deckId={deck.id} now={() => NOW} validateDelayMs={0} />
        </NavProvider>
      </DecksProvider>,
    );
    await screen.findByDisplayValue(deck.name);
    return { fetchMock, store };
  }
  const pool = () => screen.getByRole('region', { name: 'Card search' });

  it('fills the grid on open, searches again when a color toggle changes, and clears the search box', async () => {
    const search = vi.fn((p: URLSearchParams) => page(p.get('colors') === 'U' ? [flyer] : [byName.get('Lightning Bolt')!, flyer]));
    const { fetchMock } = await renderBuilder({ search });
    // No Search click: the pool is never empty when the screen opens.
    expect(await within(pool()).findByRole('listitem', { name: 'Lightning Bolt' })).toBeTruthy();
    expect(searchCalls(fetchMock)).toEqual(['/api/cards/search?format=modern&page=1']);
    fireEvent.click(within(pool()).getByLabelText('Blue'));
    await waitFor(() => expect(within(pool()).queryByRole('listitem', { name: 'Lightning Bolt' })).toBeNull());
    expect(within(pool()).getByRole('listitem', { name: 'Wind Drake' })).toBeTruthy();
    expect(searchCalls(fetchMock).at(-1)).toBe('/api/cards/search?colors=U&format=modern&page=1');
    expect(within(pool()).queryByRole('button', { name: 'Clear search' })).toBeNull();
    const box = within(pool()).getByLabelText('Name or rules text') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'drake' } });
    fireEvent.click(within(pool()).getByRole('button', { name: 'Clear search' }));
    expect(box.value).toBe('');
  });

  it('keeps the filter drawer closed until Filters is pressed, and counts the filters set inside it', async () => {
    await renderBuilder({ search: () => page([flyer]) });
    await within(pool()).findByRole('listitem', { name: 'Wind Drake' });
    const toggle = within(pool()).getByRole('button', { name: 'Filters' });
    const drawer = document.getElementById('deck-filter-drawer')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(drawer.hidden).toBe(true);
    fireEvent.change(within(pool()).getByLabelText('Types'), { target: { value: 'creature' } });
    expect(within(toggle).getByText('1')).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(drawer.hidden).toBe(false);
  });

  it('pointing at a card shows its big preview with a reminder for each keyword; leaving it hides the preview', async () => {
    await renderBuilder({ search: () => page([flyer]) });
    const art = await within(pool()).findByRole('button', { name: 'Add Wind Drake to main deck' });
    expect(document.querySelector('.deck-hover-preview')).toBeNull();
    fireEvent.mouseEnter(art);
    const preview = document.querySelector('.deck-hover-preview') as HTMLElement;
    expect(preview).not.toBeNull();
    // It only looks: hidden from screen readers (the name under the card opens the same preview as a dialog), and with nothing to click.
    expect(preview.getAttribute('aria-hidden')).toBe('true');
    expect(within(preview).queryAllByRole('button')).toHaveLength(0);
    expect(preview.textContent).toContain("A creature with flying can't be blocked except by creatures with flying or reach.");
    expect(preview.textContent).toContain('CR 702.9');
    fireEvent.mouseLeave(art);
    expect(document.querySelector('.deck-hover-preview')).toBeNull();
    // Keyboard focus asks for it too.
    fireEvent.focus(art);
    expect(document.querySelector('.deck-hover-preview')).not.toBeNull();
    fireEvent.blur(art);
    expect(document.querySelector('.deck-hover-preview')).toBeNull();
  });

  it('clicking a card adds it to the main deck as a banner tinted by its color, with its count in "N in deck"', async () => {
    await renderBuilder({ search: () => page([flyer]) });
    fireEvent.click(await within(pool()).findByRole('button', { name: 'Add Wind Drake to main deck' }));
    fireEvent.click(within(pool()).getByRole('button', { name: 'Add Wind Drake to main deck' }));
    expect(within(pool()).getByText('2 in deck')).toBeTruthy();
    const banner = within(screen.getByRole('region', { name: /Main deck/ })).getByRole('listitem', { name: '2 Wind Drake' });
    expect(within(banner).getByText('2x')).toBeTruthy();
    // Tones: a blue card is blue, lands are their own tone; the data arrives from the card lookups.
    await waitFor(() => expect(within(screen.getByRole('region', { name: /Main deck/ })).getByRole('listitem', { name: '10 Mountain' }).getAttribute('data-tone')).toBe('land'));
    expect(within(screen.getByRole('region', { name: /Main deck/ })).getByRole('listitem', { name: '4 Lightning Bolt' }).getAttribute('data-tone')).toBe('R');
    expect(within(screen.getByRole('region', { name: /Main deck/ })).getByRole('listitem', { name: '4 Grizzly Bears' }).getAttribute('data-tone')).toBe('G');
  });

  it('shows the deck count against the size of the format, and Done leaves the screen', async () => {
    fakeServer({ search: () => page([flyer]) });
    render(
      <DecksProvider store={new MemoryDeckStore([deckFixture()])}>
        <App initial={{ screen: 'deckbuilder', deckId: 'deck-1' }} />
      </DecksProvider>,
    );
    const list = await screen.findByRole('complementary', { name: 'Deck list' });
    expect(within(list).getByLabelText('Deck size').textContent).toBe('20/60 Cards');
    fireEvent.click(within(list).getByRole('button', { name: 'Done' }));
    // Back from the only screen goes Home (its main menu; the top navigation has a Decks tab too).
    const menu = await screen.findByRole('navigation', { name: 'Main menu' });
    expect(within(menu).getByRole('button', { name: 'Decks' })).toBeTruthy();
  });

  it('Build and Details are one deck seen two ways: the same name field and format, and the format check in both', async () => {
    await renderBuilder({});
    await screen.findByDisplayValue('Gruul Test');
    expect(screen.getByRole('region', { name: 'Format check' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.queryByRole('region', { name: 'Card search' })).toBeNull();
    expect(screen.getByDisplayValue('Gruul Test')).toBeTruthy();
    expect((screen.getByLabelText('Format') as HTMLSelectElement).value).toBe('modern');
    expect(screen.getByRole('region', { name: 'Format check' })).toBeTruthy();
    // The pills under the box.
    for (const name of ['Edit deck', 'Export', 'Validate']) expect(screen.getByRole('button', { name })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.getByRole('dialog', { name: 'Export Gruul Test' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit deck' }));
    expect(screen.getByRole('region', { name: 'Card search' })).toBeTruthy();
  });
});

describe('floating preview placement', () => {
  const view = { width: 1400, height: 900 };
  it('goes to the right of the card when there is room, else to the left, and stays inside the window', () => {
    expect(previewPlacement({ left: 100, right: 230, top: 200 }, view)).toEqual({ left: 244, top: 176 });
    // A card at the right edge of the pool: the preview opens to its left.
    const left = previewPlacement({ left: 1000, right: 1130, top: 200 }, view);
    expect(left.left).toBe(1000 - 14 - 600);
    // Near the bottom it moves up so it is never cut off; at the top it keeps the margin.
    expect(previewPlacement({ left: 100, right: 230, top: 800 }, view).top).toBe(900 - 440 - 8);
    expect(previewPlacement({ left: 100, right: 230, top: 0 }, view).top).toBe(8);
    // A narrow window: it is kept on screen.
    expect(previewPlacement({ left: 10, right: 140, top: 100 }, { width: 500, height: 800 }).left).toBeGreaterThanOrEqual(8);
  });
});
