/**
 * The Images screen (docs/design/m8-client.md screen 4): upload files or a folder (optionally with a decklist), match by file name (mock API), review
 * unmatched and unsure images with suggestions or the searchable card picker, per-side slots, replace and delete; everything stored in (fake) IndexedDB.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CardDetailResponse, CardSummary, ImageFileMatch, ImageMatchRequest, SearchResponse } from '@openmtg/server/api';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavProvider } from '../../src/app/nav';
import { slotsOfSummary } from '../../src/cards/model';
import { CardImagesProvider, createCardImages, type CardImages } from '../../src/images/context';
import { ImagesScreen } from '../../src/images/ImagesScreen';
import { SETTINGS_KEY } from '../../src/images/settings';
import { idbImageStore } from '../../src/images/store';
import { imageFile, summary, testImages } from '../card-fixtures';
import { fakeObjectUrls } from '../fake-indexeddb';
import { stubFetch } from '../helpers';

const DELVER = 'Delver of Secrets // Insectile Aberration';
const delverSlots = () => slotsOfSummary(summary(DELVER)).map((s) => ({ key: s.key, label: s.label, card: DELVER }));
const KNOWN = ['Forest', 'Island', DELVER, 'Commit // Memory'];

/** The fake server: matching by file name, decklist resolution, search and card details over a few fixture cards. */
function fakeServer(opts: { match?: (req: ImageMatchRequest) => ImageFileMatch[]; matchStatus?: number; search?: (q: string) => CardSummary[] } = {}) {
  const requests: { path: string; body: unknown }[] = [];
  const defaultMatch = (req: ImageMatchRequest): ImageFileMatch[] =>
    req.fileNames.map((fileName) => {
      const n = fileName.toLowerCase();
      if (n.startsWith('forest')) return { fileName, match: { key: 'Forest', label: 'Forest', card: 'Forest' }, confidence: 1, alternatives: [] };
      if (n.startsWith('delver')) {
        const [front, back] = delverSlots();
        return { fileName, match: front!, confidence: req.deckNames?.includes(DELVER) ? 0.95 : 0.6, alternatives: [back!] };
      }
      return { fileName, match: null, confidence: 0, alternatives: [] };
    });
  const mock = stubFetch((url, init) => {
    const u = new URL(url, 'http://127.0.0.1');
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    requests.push({ path: u.pathname + u.search, body });
    if (u.pathname === '/api/images/match') {
      if (opts.matchStatus) return { status: opts.matchStatus, body: { error: 'POST /api/images/match is not implemented yet' } };
      return { status: 200, body: { matches: (opts.match ?? defaultMatch)(body as ImageMatchRequest) } };
    }
    if (u.pathname === '/api/decks/resolve') {
      const text = (body as { text: string }).text;
      const cards = KNOWN.filter((n) => text.includes(n.split(' // ')[0]!)).map((name) => ({ section: 'main', count: 1, name, oracleId: name, automation: 'full' }));
      return { status: 200, body: { cards, unknown: [], errors: [], links: [], ignored: 0 } };
    }
    if (u.pathname === '/api/cards/search') {
      const q = (u.searchParams.get('q') ?? '').toLowerCase();
      const cards = opts.search ? opts.search(q) : KNOWN.filter((n) => n.toLowerCase().includes(q)).map((n) => summary(n));
      const res: SearchResponse = { cards, page: 1, pageSize: 20, total: cards.length };
      return { status: 200, body: res };
    }
    if (u.pathname.startsWith('/api/cards/')) {
      const name = decodeURIComponent(u.pathname.slice('/api/cards/'.length));
      if (!KNOWN.includes(name)) return { status: 404, body: { error: 'unknown card' } };
      const res: CardDetailResponse = { card: summary(name), compiled: { faces: [], compilerVersion: 't' }, manualParts: [] };
      return { status: 200, body: res };
    }
    return { status: 404, body: { error: 'no route' } };
  });
  return { mock, requests };
}

function renderScreen(images: CardImages) {
  return render(
    <NavProvider initial={{ screen: 'images' }}>
      <CardImagesProvider images={images}>
        <ImagesScreen debounceMs={0} />
      </CardImagesProvider>
    </NavProvider>,
  );
}

const pick = (label: string, files: File[]) => fireEvent.change(screen.getByLabelText(label, { selector: 'input' }), { target: { files } });
const status = () => screen.getByRole('status', { name: 'Upload status' });
const toast = () => screen.getByRole('status', { name: 'Image library status' });
const openSearch = (row: HTMLElement) => fireEvent.click(within(row).getByRole('button', { name: 'Search for the card' }));

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('uploading and matching', () => {
  it('stores confident matches at once and sends unmatched and unsure images to review; only file names reach the server', async () => {
    const { requests } = fakeServer();
    const { images, idb } = testImages();
    renderScreen(images);
    pick('Choose image files', [imageFile('forest.jpg'), imageFile('delver.png', 'image/png'), imageFile('mystery.jpg')]);
    await waitFor(() => expect(status().textContent).toBe('Stored 1 image. 2 images to review.'));
    const match = requests.find((r) => r.path === '/api/images/match')!;
    expect(match.body).toEqual({ fileNames: ['forest.jpg', 'delver.png', 'mystery.jpg'] });
    expect(idb.rows('test-images', 'images').map((r) => r.key)).toEqual(['Forest']);
    expect(screen.getByRole('listitem', { name: 'Review delver.png' })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: 'Review mystery.jpg' })).toBeTruthy();
    expect(await screen.findByRole('listitem', { name: 'Images of Forest' })).toBeTruthy();
  });

  it('review: a suggestion stores the image under that side; the card then shows its other side as an empty slot', async () => {
    fakeServer();
    const { images } = testImages();
    renderScreen(images);
    pick('Choose image files', [imageFile('delver.png', 'image/png')]);
    const item = await screen.findByRole('listitem', { name: 'Review delver.png' });
    expect(within(item).getByText(/Best guess: Delver of Secrets \(front\) \(60%\)/)).toBeTruthy();
    const suggestions = within(item).getByRole('group', { name: 'Suggestions' });
    expect(within(suggestions).getAllByRole('button').map((b) => b.textContent)).toEqual(['Delver of Secrets (front)', 'Insectile Aberration (back)']);
    fireEvent.click(within(suggestions).getByRole('button', { name: 'Insectile Aberration (back)' }));
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Review delver.png' })).toBeNull());
    expect(status().textContent).toBe('Stored delver.png as Insectile Aberration (back).');
    expect((await images.store.get('Insectile Aberration'))?.card).toBe(DELVER);
    const group = await screen.findByRole('listitem', { name: `Images of ${DELVER}` });
    await waitFor(() => expect(within(group).getByRole('listitem', { name: 'Delver of Secrets (front)' })).toBeTruthy());
    expect(within(within(group).getByRole('listitem', { name: 'Delver of Secrets (front)' })).getByText('No image')).toBeTruthy();
    expect(within(within(group).getByRole('listitem', { name: 'Insectile Aberration (back)' })).getByText('delver.png')).toBeTruthy();
  });

  it('review: the searchable card picker finds a card; a two-sided card asks which side', async () => {
    fakeServer();
    const { images } = testImages();
    renderScreen(images);
    pick('Choose image files', [imageFile('mystery.jpg'), imageFile('scan_0042.jpg')]);
    const item = await screen.findByRole('listitem', { name: 'Review mystery.jpg' });
    expect(within(item).getByText('No card matched this file name.')).toBeTruthy();
    openSearch(item);
    const search = within(item).getByLabelText('Or search for the card');
    expect((search as HTMLInputElement).value).toBe('mystery');
    fireEvent.change(search, { target: { value: 'delv' } });
    fireEvent.click(await within(item).findByRole('button', { name: /Delver of Secrets \/\/ Insectile Aberration/ }));
    const sides = within(item).getByRole('group', { name: `Sides of ${DELVER}` });
    fireEvent.click(within(sides).getByRole('button', { name: 'Delver of Secrets (front)' }));
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Review mystery.jpg' })).toBeNull());
    expect((await images.store.get('Delver of Secrets'))?.fileName).toBe('mystery.jpg');

    // A one-picture card is stored at once.
    const other = screen.getByRole('listitem', { name: 'Review scan_0042.jpg' });
    openSearch(other);
    fireEvent.change(within(other).getByLabelText('Or search for the card'), { target: { value: 'memory' } });
    fireEvent.click(await within(other).findByRole('button', { name: /Commit \/\/ Memory/ }));
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Review scan_0042.jpg' })).toBeNull());
    expect((await images.store.get('Commit // Memory'))?.fileName).toBe('scan_0042.jpg');
  });

  it('review: Skip drops the image without storing it', async () => {
    fakeServer();
    const { images } = testImages();
    renderScreen(images);
    pick('Choose image files', [imageFile('mystery.jpg')]);
    const item = await screen.findByRole('listitem', { name: 'Review mystery.jpg' });
    fireEvent.click(within(item).getByRole('button', { name: 'Skip this image' }));
    expect(screen.queryByRole('heading', { name: /Review/ })).toBeNull();
    expect(await images.store.list()).toEqual([]);
  });

  it('a second file for a slot already matched in the same upload goes to review instead of replacing the first', async () => {
    fakeServer();
    const { images } = testImages();
    renderScreen(images);
    pick('Choose image files', [imageFile('forest.jpg'), imageFile('forest-alt.jpg')]);
    const item = await screen.findByRole('listitem', { name: 'Review forest-alt.jpg' });
    expect(within(item).getByText(/same card side/)).toBeTruthy();
    expect((await images.store.get('Forest'))?.fileName).toBe('forest.jpg');
  });

  it('a decklist guides matching: its names are sent with the file names', async () => {
    const { requests } = fakeServer();
    const { images } = testImages();
    renderScreen(images);
    fireEvent.change(screen.getByLabelText(/Decklist \(optional\)/), { target: { value: '4 Delver of Secrets\n20 Island' } });
    pick('Choose image files', [imageFile('delver.png', 'image/png')]);
    await waitFor(() => expect(status().textContent).toBe('Stored 1 image. Decklist used: 2 card names (from the text box).'));
    expect(requests.find((r) => r.path === '/api/images/match')?.body).toEqual({ fileNames: ['delver.png'], deckNames: ['Island', DELVER] });
    expect((await images.store.get('Delver of Secrets'))?.fileName).toBe('delver.png');
  });

  it('a folder: picks images and a .txt decklist inside it, skips other files', async () => {
    const { requests } = fakeServer();
    const { images } = testImages();
    renderScreen(images);
    const folder = screen.getByLabelText('Choose a folder', { selector: 'input' });
    expect(folder.hasAttribute('webkitdirectory')).toBe(true);
    pick('Choose a folder', [imageFile('forest.jpg'), new File(['1 Delver of Secrets'], 'deck.txt', { type: 'text/plain' }), new File(['x'], 'Thumbs.db'), imageFile('delver.png', 'image/png')]);
    await waitFor(() => expect(status().textContent).toBe('Stored 2 images. Ignored 1 file that is not an image. Decklist used: 1 card name (from deck.txt).'));
    expect(requests.find((r) => r.path === '/api/images/match')?.body).toEqual({ fileNames: ['forest.jpg', 'delver.png'], deckNames: [DELVER] });
  });

  it('a decklist file among the chosen files is used together with the text box, not dropped when the text box has a list', async () => {
    const { requests } = fakeServer();
    const { images } = testImages();
    renderScreen(images);
    fireEvent.change(screen.getByLabelText(/Decklist \(optional\)/), { target: { value: '20 Island' } });
    pick('Choose image files', [imageFile('forest.jpg'), new File(['1 Delver of Secrets'], 'deck.txt', { type: 'text/plain' })]);
    await waitFor(() => expect(status().textContent).toBe('Stored 1 image. Decklist used: 2 card names (from the text box and deck.txt).'));
    expect(requests.find((r) => r.path === '/api/images/match')?.body).toEqual({ fileNames: ['forest.jpg'], deckNames: ['Island', DELVER] });
  });

  it('a .txt file that is not a decklist is not used as one, and the status says so', async () => {
    const { requests } = fakeServer();
    const { images } = testImages();
    renderScreen(images);
    const readme = new File(['Scans of my cube, March 2025\nPhotographed with my phone.\nPlease do not share.\nCredits: me'], 'README.txt', { type: 'text/plain' });
    pick('Choose image files', [imageFile('forest.jpg'), readme]);
    await waitFor(() => expect(status().textContent).toBe('Stored 1 image. README.txt does not look like a decklist, so it was not used.'));
    expect(requests.find((r) => r.path === '/api/images/match')?.body).toEqual({ fileNames: ['forest.jpg'] });
  });

  it('an image this browser cannot show (HEIC, a corrupt file) is not stored, and the status says why', async () => {
    fakeServer({ match: (req) => req.fileNames.map((fileName) => ({ fileName, match: { key: fileName.split('.')[0]!, label: fileName.split('.')[0]!, card: fileName.split('.')[0]! }, confidence: 1, alternatives: [] })) });
    const { images } = testImages(undefined, { canShow: async (f) => !(f as File).name.endsWith('.heic') && (f as File).name !== 'Giant Growth.jpg' });
    renderScreen(images);
    pick('Choose image files', [imageFile('Counterspell.heic', 'image/heic'), imageFile('Giant Growth.jpg'), imageFile('Forest.jpg')]);
    await waitFor(() => expect(status().textContent).toMatch(/^Stored 1 image\./));
    expect(status().textContent).toContain('Counterspell.heic and Giant Growth.jpg cannot be shown by this browser; convert them to JPEG or PNG.');
    expect((await images.store.list()).map((i) => i.key)).toEqual(['Forest']);
  });

  it('when the server cannot match, every image goes to review so the player can pick the cards', async () => {
    fakeServer({ matchStatus: 501 });
    const { images } = testImages();
    renderScreen(images);
    pick('Choose image files', [imageFile('forest.jpg')]);
    await waitFor(() => expect(status().textContent).toMatch(/^Stored 0 images\. 1 image to review\. Automatic matching is unavailable/));
    expect(screen.getByRole('listitem', { name: 'Review forest.jpg' })).toBeTruthy();
  });

  it('a large folder is stored in batches: the library reloads once per batch, thumbnails are made once, and the status shows progress', async () => {
    const n = 60;
    const { requests } = fakeServer({ match: (req) => req.fileNames.map((fileName, i) => ({ fileName, match: { key: `Card ${i}`, label: `Card ${i}`, card: `Card ${i}` }, confidence: 1, alternatives: [] })) });
    const { images, urls } = testImages();
    const list = vi.spyOn(images.store, 'list');
    renderScreen(images);
    const seen = new Set<string>();
    const observer = new MutationObserver(() => seen.add(status().textContent ?? ''));
    observer.observe(status(), { childList: true, characterData: true, subtree: true });
    pick('Choose image files', Array.from({ length: n }, (_, i) => imageFile(`card-${i}.jpg`)));
    await waitFor(() => expect(status().textContent).toBe(`Stored ${n} images.`));
    await waitFor(() => expect(screen.getByRole('heading', { name: `Your images (${n})` })).toBeTruthy());
    observer.disconnect();
    expect([...seen].some((t) => /^Storing \d+ of 60…$/.test(t))).toBe(true);
    expect(list.mock.calls.length).toBeLessThanOrEqual(6);
    expect(urls.live.size + urls.revoked.length).toBeLessThanOrEqual(n + 5);
    // One-sided card names need no slot lookup.
    expect(requests.filter((r) => r.path.startsWith('/api/cards/Card')).length).toBe(0);
  });
});

describe('the review list', () => {
  it('rows do not search until asked, show at most 5 results, and name card and type separately', async () => {
    const many = ['Forest', 'Island', 'Aardvark Sloth', 'Abzan Charm', 'Act of Treason', 'Air Elemental', 'Akki Raider', 'Alley Assailant'];
    const { requests } = fakeServer({ search: () => many.map((m) => summary(m)) });
    const { images } = testImages();
    renderScreen(images);
    pick('Choose image files', [imageFile('alpha.jpg'), imageFile('bravo.jpg'), imageFile('charlie.jpg')]);
    const row = await screen.findByRole('listitem', { name: 'Review bravo.jpg' });
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    expect(requests.filter((r) => r.path.startsWith('/api/cards/search'))).toHaveLength(0);
    openSearch(row);
    const results = await within(row).findByRole('list', { name: 'Search results' });
    expect(within(results).getAllByRole('button').filter((b) => b.getAttribute('aria-label')?.includes(','))).toHaveLength(5);
    expect(within(results).getByRole('button', { name: 'Aardvark Sloth, Creature — Sloth Beast' })).toBeTruthy();
    fireEvent.click(within(results).getByRole('button', { name: 'Show 3 more' }));
    expect(within(row).getByRole('button', { name: 'Alley Assailant, Creature — Vampire Rogue' })).toBeTruthy();
    expect(requests.filter((r) => r.path.startsWith('/api/cards/search'))).toHaveLength(1);
  });

  it('starts the search from the server guess when it has one', async () => {
    fakeServer();
    const { images } = testImages();
    renderScreen(images);
    pick('Choose image files', [imageFile('delver.png', 'image/png')]);
    const row = await screen.findByRole('listitem', { name: 'Review delver.png' });
    openSearch(row);
    expect((within(row).getByLabelText('Or search for the card') as HTMLInputElement).value).toBe('Delver of Secrets');
  });

  it('Skip all clears the list without storing anything', async () => {
    fakeServer();
    const { images } = testImages();
    renderScreen(images);
    pick('Choose image files', [imageFile('a.jpg'), imageFile('b.jpg')]);
    await screen.findByRole('heading', { name: 'Review (2)' });
    fireEvent.click(screen.getByRole('button', { name: 'Skip all 2 images' }));
    expect(screen.queryByRole('heading', { name: /Review/ })).toBeNull();
    expect(await images.store.list()).toEqual([]);
  });

  it('survives leaving the screen: the images to review are still there when the player comes back', async () => {
    fakeServer();
    const { images } = testImages();
    function Toggle() {
      const [shown, setShown] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setShown((s) => !s)}>
            toggle
          </button>
          {shown && <ImagesScreen debounceMs={0} />}
        </>
      );
    }
    render(
      <NavProvider initial={{ screen: 'images' }}>
        <CardImagesProvider images={images}>
          <Toggle />
        </CardImagesProvider>
      </NavProvider>,
    );
    pick('Choose image files', [imageFile('a.jpg'), imageFile('b.jpg')]);
    await screen.findByRole('heading', { name: 'Review (2)' });
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(screen.queryByRole('heading', { name: /Review/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(screen.getByRole('heading', { name: 'Review (2)' })).toBeTruthy();
  });

  it('after a row is resolved, keyboard focus moves to the next row (or the list heading), never to the page body', async () => {
    fakeServer();
    const { images } = testImages();
    renderScreen(images);
    pick('Choose image files', [imageFile('a.jpg'), imageFile('b.jpg')]);
    const first = await screen.findByRole('listitem', { name: 'Review a.jpg' });
    const skip = within(first).getByRole('button', { name: 'Skip this image' });
    skip.focus();
    fireEvent.click(skip);
    const next = screen.getByRole('listitem', { name: 'Review b.jpg' });
    await waitFor(() => expect(next.contains(document.activeElement)).toBe(true));
    fireEvent.click(within(next).getByRole('button', { name: 'Skip this image' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Upload' })));
  });
});

describe('the stored images', () => {
  it('replace and delete one side; delete all after confirming', async () => {
    fakeServer();
    const { images } = testImages();
    await act(async () => {
      await images.store.put({ key: 'Forest', card: 'Forest', label: 'Forest', fileName: 'old.jpg', type: 'image/jpeg', size: 3, blob: imageFile('old.jpg'), addedAt: 0 });
      await images.store.put({ key: 'Island', card: 'Island', label: 'Island', fileName: 'island.jpg', type: 'image/jpeg', size: 3, blob: imageFile('island.jpg'), addedAt: 0 });
    });
    renderScreen(images);
    expect(await screen.findByRole('heading', { name: 'Your images (2)' })).toBeTruthy();
    const forest = screen.getByRole('listitem', { name: 'Forest' });
    fireEvent.change(within(forest).getByLabelText('Replace Forest', { selector: 'input' }), { target: { files: [imageFile('new.jpg')] } });
    await waitFor(() => expect(within(screen.getByRole('listitem', { name: 'Forest' })).getByText('new.jpg')).toBeTruthy());
    expect((await images.store.get('Forest'))?.fileName).toBe('new.jpg');

    fireEvent.click(within(screen.getByRole('listitem', { name: 'Island' })).getByRole('button', { name: 'Delete Island' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your images (1)' })).toBeTruthy());
    expect(toast().textContent).toBe('Image deleted.');
    // The deleted row's button is gone: focus goes to the library heading, not the page body.
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Your images (1)' }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete all images' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep them' }));
    expect(await images.store.list()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete all images' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete all' }));
    await waitFor(() => expect(screen.getByText('No images stored yet.')).toBeTruthy());
    expect(await images.store.list()).toEqual([]);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Your images (0)' }));
  });

  it('a non-image file is refused as a replacement, and the message shows where the player is (not at the top of the page)', async () => {
    fakeServer();
    const { images } = testImages();
    await act(() => images.store.put({ key: 'Forest', card: 'Forest', label: 'Forest', fileName: 'old.jpg', type: 'image/jpeg', size: 3, blob: imageFile('old.jpg'), addedAt: 0 }));
    renderScreen(images);
    const forest = await screen.findByRole('listitem', { name: 'Forest' });
    fireEvent.change(within(forest).getByLabelText('Replace Forest', { selector: 'input' }), { target: { files: [new File(['x'], 'notes.pdf', { type: 'application/pdf' })] } });
    expect(toast().textContent).toBe('notes.pdf is not an image file.');
    expect(toast().classList.contains('images-toast')).toBe(true);
    expect(status().textContent).toBe('');
    expect((await images.store.get('Forest'))?.fileName).toBe('old.jpg');
  });

  it('adds an image for a chosen card and side directly', async () => {
    fakeServer();
    const { images } = testImages();
    renderScreen(images);
    fireEvent.change(screen.getByLabelText('Add an image for a specific card'), { target: { value: 'aberr' } });
    fireEvent.click(await screen.findByRole('button', { name: /Delver of Secrets \/\/ Insectile Aberration/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Insectile Aberration (back)' }));
    const input = screen.getByLabelText('Choose image for Insectile Aberration (back)', { selector: 'input' });
    // Focus follows the player to the next step instead of falling back to the page body.
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { files: [imageFile('back.png', 'image/png')] } });
    await waitFor(() => expect(toast().textContent).toBe('Stored back.png as Insectile Aberration (back).'));
    expect((await images.store.get('Insectile Aberration'))?.type).toBe('image/png');
  });

  it('without IndexedDB the screen says so and cannot upload', () => {
    fakeServer();
    renderScreen(createCardImages({ store: idbImageStore(undefined), urls: fakeObjectUrls() }));
    expect(screen.getByRole('alert').textContent).toMatch(/cannot store images/);
    expect((screen.getByLabelText('Choose image files', { selector: 'input' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('heading', { name: /Your images/ })).toBeNull();
  });
});

describe('file pickers', () => {
  it('WCAG 2.4.7: each hidden file input comes right before its visible label, so the label can show the focus ring', () => {
    fakeServer();
    const { images } = testImages();
    renderScreen(images);
    for (const name of ['Choose image files', 'Choose a folder']) {
      const input = screen.getByLabelText(name, { selector: 'input' });
      expect(input.nextElementSibling?.tagName).toBe('LABEL');
      expect(input.nextElementSibling?.getAttribute('for')).toBe(input.id);
    }
  });
});

describe('the Scryfall setting (on by default)', () => {
  it('the Images screen has the switch itself, on by default; turning it off is stored in the shared settings record', () => {
    fakeServer();
    const { images } = testImages();
    renderScreen(images);
    const box = screen.getByRole('checkbox', { name: 'Show card images from Scryfall' }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(box.checked).toBe(false);
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).showScryfallImages).toBe(false);
    // No link away from the screen (leaving it used to drop the review list).
    expect(screen.queryByRole('button', { name: 'Change in Settings' })).toBeNull();
  });
});
