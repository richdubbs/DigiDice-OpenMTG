/**
 * Deck library behavior from the C3 review: maybeboard cards reported, notes kept through a plain-text import, double clicks, unnamed decks, focus after
 * delete, the server not running, local dates, accepting a suggested name, and blocked site storage.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App, preloadScreens } from '../src/app/App';
import { DecksProvider } from '../src/decks/context';
import { BrowserDeckStore, MemoryDeckStore, type DeckStore } from '../src/decks/store';
import { exportDeck, GENERIC_LINK_STEPS } from '../src/decks/textio';
import { deckFixture, fakeResolve, fakeServer } from './decks-fixtures';
import { FakeIdbControls } from './decks-fake-idb';

const SERVER_DOWN = 'The OpenMTG server is not running. Start it with npm run play, then try again.';
const savedTz = process.env.TZ;

// The screens are separate chunks (App.tsx); load them once before the tests, under this hook's own timeout, so a busy machine's module loading is not
// counted against a test's or a findBy's timeout (CL3, the same cause as the decks-arena.test.tsx flake).
beforeAll(() => preloadScreens(), 120_000);

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.TZ = savedTz;
});

async function renderLibrary(store: DeckStore = new MemoryDeckStore()) {
  render(
    <DecksProvider store={store}>
      <App initial={{ screen: 'decks' }} />
    </DecksProvider>,
  );
  // The Decks screen is loaded on first use (app/App.tsx).
  await screen.findByRole('heading', { level: 1, name: 'Decks' });
  return store;
}

const importRegion = () => screen.getByRole('region', { name: 'Import a deck' });
const openImport = () => fireEvent.click(screen.getByRole('button', { name: 'Import' }));
const paste = (text: string) => fireEvent.change(screen.getByLabelText('Decklist or deck link'), { target: { value: text } });
const submitImport = () => fireEvent.click(within(importRegion()).getByRole('button', { name: 'Import deck' }));

describe('import', () => {
  it('says how many maybeboard cards were left out', async () => {
    fakeServer({ resolve: (text) => ({ ...fakeResolve(text), ignored: 3 }) });
    await renderLibrary();
    openImport();
    paste('4 Lightning Bolt');
    submitImport();
    expect(await screen.findByText('Imported “Imported deck” (4 main-deck cards). 3 maybeboard cards were left out.')).toBeTruthy();
  });

  it('the review lists left-out maybeboard cards too', async () => {
    fakeServer({ resolve: (text) => ({ ...fakeResolve(text), ignored: 1 }) });
    await renderLibrary();
    openImport();
    paste('4 Lightning Bolt\n2 Not A Card');
    submitImport();
    const review = await screen.findByRole('region', { name: 'Import review' });
    expect(within(review).getByText('1 maybeboard card will be left out.')).toBeTruthy();
  });

  it('a plain-text backup brings back the notes and the cover', async () => {
    fakeServer();
    const store = await renderLibrary();
    openImport();
    paste(exportDeck(deckFixture({ notes: 'Side in Grudge\nvs. affinity', cover: 'Ancient Grudge' }), 'plain'));
    submitImport();
    await screen.findByText(/Imported “Gruul Test”/);
    expect((await store.list())[0]).toMatchObject({ name: 'Gruul Test', format: 'modern', notes: 'Side in Grudge\nvs. affinity', cover: 'Ancient Grudge' });
  });

  it('a suggested name can be accepted: the line is rewritten and the list read again', async () => {
    const resolve = vi.fn((text: string) => {
      const r = fakeResolve(text);
      return { ...r, unknown: r.unknown.map((u) => ({ ...u, suggestions: ['Lightning Bolt'] })) };
    });
    fakeServer({ resolve });
    const store = await renderLibrary();
    openImport();
    paste('4 Grizzly Bears\nSB: 2 Lightnig Bolt');
    submitImport();
    const review = await screen.findByRole('region', { name: 'Import review' });
    fireEvent.click(within(review).getByRole('button', { name: 'Use Lightning Bolt for line 2' }));
    await screen.findByText(/Imported “Imported deck”/);
    expect(resolve).toHaveBeenLastCalledWith('4 Grizzly Bears\nSB: 2 Lightning Bolt');
    const [deck] = await store.list();
    expect(deck!.sideboard).toEqual([{ name: 'Lightning Bolt', count: 2, oracleId: 'oid-lightning-bolt' }]);
  });

  it('says the server is not running instead of "Failed to fetch"; the generic link steps say each thing once', async () => {
    fakeServer({
      resolve: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await renderLibrary();
    openImport();
    paste('4 Lightning Bolt');
    submitImport();
    expect((await within(importRegion()).findByRole('alert')).textContent).toBe(`Import failed: ${SERVER_DOWN}`);
    expect(GENERIC_LINK_STEPS.some((s) => /does not download/.test(s))).toBe(false);
  });

  it('a double click on "Import the N cards found" saves one deck', async () => {
    fakeServer();
    const store = await renderLibrary();
    openImport();
    paste('4 Lightning Bolt\n2 Not A Card');
    submitImport();
    const review = await screen.findByRole('region', { name: 'Import review' });
    const button = within(review).getByRole('button', { name: 'Import the 4 cards found' });
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByText(/Imported “Imported deck”/);
    expect(await store.list()).toHaveLength(1);
  });
});

describe('library actions', () => {
  it('a double click on New deck creates one deck and opens it once', async () => {
    fakeServer();
    const store = await renderLibrary();
    await screen.findByText(/No decks yet/);
    const button = screen.getByRole('button', { name: 'New deck' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByRole('heading', { level: 1, name: 'Deckbuilder' })).toBeTruthy();
    expect(await store.list()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Decks' })).toBeTruthy();
  });

  it('a double click on Duplicate makes one copy', async () => {
    const store = await renderLibrary(new MemoryDeckStore([deckFixture()]));
    const row = await screen.findByRole('listitem', { name: 'Gruul Test' });
    fireEvent.click(within(row).getByRole('button', { name: 'Duplicate' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Duplicate' }));
    await screen.findByRole('listitem', { name: 'Copy of Gruul Test' });
    await new Promise((r) => setTimeout(r, 20));
    expect(await store.list()).toHaveLength(2);
  });

  it('a deck with an empty name still has a label; Rename will not save a blank name', async () => {
    await renderLibrary(new MemoryDeckStore([deckFixture({ name: '' })]));
    const row = await screen.findByRole('listitem', { name: '(unnamed deck)' });
    expect(within(row).getByRole('button', { name: '(unnamed deck)' })).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Rename' }));
    fireEvent.change(within(row).getByLabelText('New name'), { target: { value: '   ' } });
    expect((within(row).getByRole('button', { name: 'Save name' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(row).getByText('Type a name to save it.')).toBeTruthy();
  });

  it('the delete confirmation takes focus, and after deleting focus goes to the next deck', async () => {
    await renderLibrary(new MemoryDeckStore([deckFixture({ id: 'a', name: 'First' }), deckFixture({ id: 'b', name: 'Second', updatedAt: '2026-01-01T00:00:00Z' })]));
    const first = await screen.findByRole('listitem', { name: 'First' });
    fireEvent.click(within(first).getByRole('button', { name: 'Delete' }));
    const confirm = within(first).getByRole('alertdialog');
    expect(confirm.contains(document.activeElement)).toBe(true);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete deck' }));
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'First' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole('listitem', { name: 'Second' })).getByRole('button', { name: 'Second' })));
  });

  it("shows the date a deck was updated in the player's own time zone", async () => {
    process.env.TZ = 'America/Los_Angeles';
    await renderLibrary(new MemoryDeckStore([deckFixture({ updatedAt: '2026-10-13T01:20:00.000Z' })]));
    const row = await screen.findByRole('listitem', { name: 'Gruul Test' });
    expect(row.textContent).toContain('Updated 2026-10-12');
  });

  it('when the browser blocks site storage the library still works in memory and says decks are not saved', async () => {
    const idb = new FakeIdbControls();
    idb.failOpen();
    fakeServer();
    const store = await renderLibrary(new BrowserDeckStore(idb.factory));
    await screen.findByText(/No decks yet/);
    expect(screen.getByRole('note').textContent).toMatch(/blocking site storage/);
    fireEvent.click(screen.getByRole('button', { name: 'New deck' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Deckbuilder' })).toBeTruthy();
    expect(await store.list()).toHaveLength(1);
  });
});
