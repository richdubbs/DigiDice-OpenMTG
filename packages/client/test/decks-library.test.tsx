/** Deck library screen: list, new, import (paste, upload, link steps, unknown names), export, rename, duplicate, delete. Fake server, memory store. */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App, preloadScreens } from '../src/app/App';
import { DecksProvider } from '../src/decks/context';
import { MemoryDeckStore } from '../src/decks/store';
import { deckFixture, fakeServer } from './decks-fixtures';

// The screens are separate chunks (App.tsx); load them once before the tests, under this hook's own timeout, so a busy machine's module loading is not
// counted against a test's or a findBy's timeout (CL3, the same cause as the decks-arena.test.tsx flake).
beforeAll(() => preloadScreens(), 120_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderLibrary(store = new MemoryDeckStore()) {
  render(
    <DecksProvider store={store}>
      <App initial={{ screen: 'decks' }} />
    </DecksProvider>,
  );
  // The Decks screen is loaded on first use (app/App.tsx).
  await screen.findByRole('heading', { level: 1, name: 'Decks' });
  return store;
}

const openImport = () => fireEvent.click(screen.getByRole('button', { name: 'Import' }));
const paste = (text: string) => fireEvent.change(screen.getByLabelText('Decklist or deck link'), { target: { value: text } });
const submitImport = () => fireEvent.click(within(screen.getByRole('region', { name: 'Import a deck' })).getByRole('button', { name: 'Import deck' }));

describe('deck library', () => {
  it('lists saved decks newest first with format and counts, and says when the browser cannot keep them', async () => {
    await renderLibrary(new MemoryDeckStore([deckFixture({ id: 'a', name: 'Older', updatedAt: '2026-01-01T00:00:00Z' }), deckFixture({ id: 'b', name: 'Newer' })]));
    const list = await screen.findByRole('list', { name: 'Your decks' });
    expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Newer', 'Older']);
    expect(within(list).getAllByText(/Modern · 20 main · 2 sideboard/)).toHaveLength(2);
    expect(screen.getByRole('note').textContent).toMatch(/last only until the page is closed/);
  });

  it('a deck with a cover card shows it on its box; the others keep the card back', async () => {
    fakeServer();
    await renderLibrary(new MemoryDeckStore([deckFixture({ id: 'a', name: 'Covered', cover: 'Ancient Grudge' }), deckFixture({ id: 'b', name: 'Plain', updatedAt: '2026-01-01T00:00:00Z' })]));
    const covered = await screen.findByRole('listitem', { name: 'Covered' });
    await waitFor(() => expect(covered.querySelector('.deck-box-cover')?.getAttribute('data-cover')).toBe('Ancient Grudge'));
    const plain = screen.getByRole('listitem', { name: 'Plain' });
    expect(plain.querySelector('.deck-box-cover')).toBeNull();
    expect(plain.querySelector('img.deck-box-face')).toBeTruthy();
  });

  it('New deck saves an empty casual deck and opens it in the deckbuilder', async () => {
    fakeServer();
    const store = await renderLibrary();
    await screen.findByText(/No decks yet/);
    fireEvent.click(screen.getByRole('button', { name: 'New deck' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Deckbuilder' })).toBeTruthy();
    const [deck] = await store.list();
    expect(deck).toMatchObject({ name: 'New deck', format: 'casual', main: [] });
    expect((screen.getByLabelText('Deck name') as HTMLInputElement).value).toBe('New deck');
  });

  it('imports a pasted Arena list with its name and the chosen format', async () => {
    const fetchMock = fakeServer();
    const store = await renderLibrary();
    openImport();
    paste('About\nName Burn\n\nDeck\n4 Lightning Bolt\n20 Mountain\n\nSideboard\n2 Ancient Grudge\n');
    fireEvent.change(within(screen.getByRole('region', { name: 'Import a deck' })).getByLabelText('Format'), { target: { value: 'modern' } });
    submitImport();
    await screen.findByText('Imported “Burn” (24 main-deck cards).');
    const [deck] = await store.list();
    expect(deck).toMatchObject({ name: 'Burn', format: 'modern' });
    expect(deck!.main).toEqual([
      { name: 'Lightning Bolt', count: 4, oracleId: 'oid-lightning-bolt' },
      { name: 'Mountain', count: 20, oracleId: 'oid-mountain' },
    ]);
    expect(deck!.sideboard).toEqual([{ name: 'Ancient Grudge', count: 2, oracleId: 'oid-ancient-grudge' }]);
    const resolveCall = fetchMock.mock.calls.find(([u]) => String(u) === '/api/decks/resolve')!;
    expect(JSON.parse(String(resolveCall[1]!.body))).toEqual({ text: expect.stringContaining('4 Lightning Bolt') });
    expect(screen.getByRole('list', { name: 'Your decks' })).toBeTruthy();
  });

  it('imports an uploaded .txt file, named after the file', async () => {
    fakeServer();
    const store = await renderLibrary();
    openImport();
    const file = new File(['4 Lightning Bolt\n4 Grizzly Bears\n'], 'Zoo.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('Upload a decklist file'), { target: { files: [file] } });
    await waitFor(() => expect((screen.getByLabelText('Decklist or deck link') as HTMLTextAreaElement).value).toContain('Grizzly Bears'));
    submitImport();
    await screen.findByText('Imported “Zoo” (8 main-deck cards).');
    expect((await store.list())[0]).toMatchObject({ name: 'Zoo', format: 'casual' });
  });

  it('a deck-site link gets the site export steps from the server and nothing is imported', async () => {
    fakeServer({
      resolve: (text) => ({
        cards: [],
        unknown: [],
        errors: [],
        ignored: 0,
        links: [{ site: 'Moxfield', url: text, exportSteps: ['On your deck page choose Export, then "Copy for MTGO".', 'Paste the text here.'] }],
      }),
    });
    const store = await renderLibrary();
    openImport();
    paste('https://www.moxfield.com/decks/abc123');
    submitImport();
    const steps = await screen.findByRole('region', { name: 'Deck link' });
    expect(within(steps).getByText(/does not download decks from Moxfield/)).toBeTruthy();
    expect(within(steps).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['On your deck page choose Export, then "Copy for MTGO".', 'Paste the text here.']);
    expect(await store.list()).toEqual([]);
  });

  it('a link the server cannot answer (or an unknown site) still gets generic export-and-paste steps', async () => {
    fakeServer({ resolve: () => ({ status: 501, body: { error: 'not implemented' } }) });
    await renderLibrary();
    openImport();
    paste('https://decks.example.org/d/42');
    submitImport();
    const steps = await screen.findByRole('region', { name: 'Deck link' });
    expect(within(steps).getByText(/Export option to copy the list as text/)).toBeTruthy();
  });

  it('lists unknown names with suggestions and unreadable lines before importing the cards that were found', async () => {
    fakeServer({
      resolve: () => ({
        cards: [{ section: 'main', count: 4, name: 'Lightning Bolt', oracleId: 'oid-lightning-bolt', automation: 'full' }],
        unknown: [{ section: 'main', name: 'Lightning Blot', count: 2, line: 2, suggestions: ['Lightning Bolt'] }],
        errors: [{ line: 3, text: '7', message: 'Missing card name after the count' }],
        links: [],
        ignored: 0,
      }),
    });
    const store = await renderLibrary();
    openImport();
    paste('4 Lightning Bolt\n2 Lightning Blot\n7');
    submitImport();
    const review = await screen.findByRole('region', { name: 'Import review' });
    expect(within(review).getByText('Line 2: 2 Lightning Blot (did you mean: Lightning Bolt?)')).toBeTruthy();
    expect(within(review).getByText(/Line 3: “7”: Missing card name after the count/)).toBeTruthy();
    expect(await store.list()).toEqual([]);
    fireEvent.click(within(review).getByRole('button', { name: 'Import the 4 cards found' }));
    await screen.findByText(/Imported “Imported deck”/);
    expect((await store.list())[0]!.main).toEqual([{ name: 'Lightning Bolt', count: 4, oracleId: 'oid-lightning-bolt' }]);
  });

  it('renames, duplicates and deletes (after confirming) a deck', async () => {
    const store = await renderLibrary(new MemoryDeckStore([deckFixture()]));
    const row = await screen.findByRole('listitem', { name: 'Gruul Test' });
    fireEvent.click(within(row).getByRole('button', { name: 'Rename' }));
    fireEvent.change(within(row).getByLabelText('New name'), { target: { value: 'Gruul Smash' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save name' }));
    await screen.findByText('Renamed to “Gruul Smash”.');
    expect((await store.get('deck-1'))!.name).toBe('Gruul Smash');

    fireEvent.click(within(screen.getByRole('listitem', { name: 'Gruul Smash' })).getByRole('button', { name: 'Duplicate' }));
    await screen.findByRole('listitem', { name: 'Copy of Gruul Smash' });
    const all = await store.list();
    expect(all).toHaveLength(2);
    expect(all.find((d) => d.name === 'Copy of Gruul Smash')!.main).toEqual(deckFixture().main);

    const original = screen.getByRole('listitem', { name: 'Gruul Smash' });
    fireEvent.click(within(original).getByRole('button', { name: 'Delete' }));
    const confirm = within(original).getByRole('alertdialog');
    expect(confirm.textContent).toMatch(/cannot be undone/);
    expect(await store.get('deck-1')).toBeDefined();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete deck' }));
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Gruul Smash' })).toBeNull());
    expect(await store.get('deck-1')).toBeUndefined();
  });

  it('exports in each text format and copies to the clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await renderLibrary(new MemoryDeckStore([deckFixture()]));
    const row = await screen.findByRole('listitem', { name: 'Gruul Test' });
    fireEvent.click(within(row).getByRole('button', { name: 'Export' }));
    const text = () => (within(row).getByLabelText('Exported decklist') as HTMLTextAreaElement).value;
    expect(text().startsWith('About\nName Gruul Test\n\nDeck\n4 Lightning Bolt\n')).toBe(true);
    fireEvent.click(within(row).getByLabelText('MTGO'));
    expect(text()).toBe('4 Lightning Bolt\n4 Grizzly Bears\n10 Mountain\n2 Stomping Ground\n\n2 Ancient Grudge\n');
    fireEvent.click(within(row).getByLabelText('Plain text'));
    expect(text().startsWith('// Gruul Test\n// Format: Modern\n')).toBe(true);
    fireEvent.click(within(row).getByRole('button', { name: 'Copy' }));
    await within(row).findByText('Copied to the clipboard.');
    expect(writeText).toHaveBeenCalledWith(text());
  });

  it('opens a deck in the deckbuilder', async () => {
    fakeServer();
    await renderLibrary(new MemoryDeckStore([deckFixture()]));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Deckbuilder' })).toBeTruthy();
    expect(await screen.findByDisplayValue('Gruul Test')).toBeTruthy();
  });
});
