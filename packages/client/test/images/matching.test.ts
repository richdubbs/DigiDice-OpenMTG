/** Matching uploads by file name (POST /api/images/match, mocked), decklist names, and sorting the picked files. */
import type { ImageFileMatch, ImageMatchRequest } from '@openmtg/server/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deckNamesOf, fileDeckNames, isImageFile, localDeckNames, looksLikeDecklistLine, sortFiles, MAX_IMAGE_BYTES } from '../../src/images/files';
import { AUTO_ACCEPT, choicesOf, matchFiles, saveImage, saveImages } from '../../src/images/matching';
import { queryFromFileName, queryOf } from '../../src/images/ReviewList';
import { idbImageStore } from '../../src/images/store';
import { imageFile } from '../card-fixtures';
import { fakeIndexedDB } from '../fake-indexeddb';
import { stubFetch } from '../helpers';

afterEach(() => vi.unstubAllGlobals());

const slot = (key: string, card = key) => ({ key, label: key, card });
const answer = (fileName: string, match: ReturnType<typeof slot> | null, confidence: number, alternatives: ReturnType<typeof slot>[] = []): ImageFileMatch => ({ fileName, match, confidence, alternatives });

describe('matchFiles', () => {
  it('sends only file names (and decklist names), accepts confident matches and sends the rest to review', async () => {
    const fetchMock = stubFetch(() => ({
      status: 200,
      body: {
        matches: [
          answer('forest.jpg', slot('Forest'), 1),
          answer('delver.png', slot('Delver of Secrets', 'Delver of Secrets // Insectile Aberration'), 0.6, [slot('Insectile Aberration', 'Delver of Secrets // Insectile Aberration')]),
          answer('IMG_0001.jpg', null, 0),
          answer('forest (2).jpg', slot('Forest'), 0.95),
        ],
      },
    }));
    const files = [imageFile('forest.jpg'), imageFile('delver.png', 'image/png'), imageFile('IMG_0001.jpg'), imageFile('forest (2).jpg')];
    const out = await matchFiles(files, ['Forest', 'Delver of Secrets // Insectile Aberration']);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/images/match');
    const body = JSON.parse(String(init?.body)) as ImageMatchRequest;
    expect(body).toEqual({ fileNames: ['forest.jpg', 'delver.png', 'IMG_0001.jpg', 'forest (2).jpg'], deckNames: ['Forest', 'Delver of Secrets // Insectile Aberration'] });
    expect(out.accepted.map((a) => [a.file.name, a.slot.key])).toEqual([['forest.jpg', 'Forest']]);
    expect(out.review.map((r) => [r.file.name, r.reason])).toEqual([
      ['delver.png', 'unsure'],
      ['IMG_0001.jpg', 'unmatched'],
      ['forest (2).jpg', 'duplicate'],
    ]);
    expect(AUTO_ACCEPT).toBeGreaterThan(0.6);
  });

  it('when two files match the same slot, the most confident one is stored and the other goes to review', async () => {
    const back = slot('Insectile Aberration', 'Delver of Secrets // Insectile Aberration');
    stubFetch(() => ({ status: 200, body: { matches: [answer('delver of secrets back.png', back, 0.9), answer('Insectile Aberration.jpg', back, 1), answer('Forest.jpg', slot('Forest'), 1)] } }));
    const out = await matchFiles([imageFile('delver of secrets back.png'), imageFile('Insectile Aberration.jpg'), imageFile('Forest.jpg')]);
    expect(out.accepted.map((a) => a.file.name)).toEqual(['Insectile Aberration.jpg', 'Forest.jpg']);
    expect(out.review.map((r) => [r.file.name, r.reason])).toEqual([['delver of secrets back.png', 'duplicate']]);
  });

  it('pairs answers by file name if the server reorders them, and treats a missing answer as unmatched', async () => {
    stubFetch(() => ({ status: 200, body: { matches: [answer('b.jpg', slot('Island'), 1), answer('a.jpg', slot('Forest'), 1)] } }));
    const out = await matchFiles([imageFile('a.jpg'), imageFile('b.jpg'), imageFile('c.jpg')]);
    expect(out.accepted.map((a) => [a.file.name, a.slot.key])).toEqual([['a.jpg', 'Forest'], ['b.jpg', 'Island']]);
    expect(out.review.map((r) => [r.file.name, r.reason])).toEqual([['c.jpg', 'unmatched']]);
  });

  it('asks nothing for no files, and omits deckNames when there is no decklist', async () => {
    const fetchMock = stubFetch(() => ({ status: 200, body: { matches: [answer('a.jpg', null, 0)] } }));
    expect(await matchFiles([])).toEqual({ accepted: [], review: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    await matchFiles([imageFile('a.jpg')]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({ fileNames: ['a.jpg'] });
  });

  it('rejects when the server cannot match (the screen then offers manual review)', async () => {
    stubFetch(() => ({ status: 501, body: { error: 'POST /api/images/match is not implemented yet' } }));
    await expect(matchFiles([imageFile('a.jpg')])).rejects.toThrow(/not implemented/);
  });

  it('choicesOf lists the best guess first, then the alternatives, without repeats', () => {
    expect(choicesOf(answer('x', slot('A'), 0.5, [slot('B'), slot('A'), slot('C')])).map((s) => s.key)).toEqual(['A', 'B', 'C']);
    expect(choicesOf(answer('x', null, 0))).toEqual([]);
  });

  it('saveImages stores a batch in a few transactions and reports progress after each', async () => {
    const store = idbImageStore(fakeIndexedDB().factory, 'many');
    const notified = vi.fn();
    store.subscribe(notified);
    const items = Array.from({ length: 60 }, (_, i) => ({ file: imageFile(`c${i}.jpg`), slot: slot(`Card ${i}`) }));
    const progress: [number, number][] = [];
    const out = await saveImages(store, items, { batchSize: 25, now: 7, onProgress: (done, total) => progress.push([done, total]) });
    expect(out).toEqual({ stored: 60, failed: [] });
    expect(progress).toEqual([[25, 60], [50, 60], [60, 60]]);
    expect(notified).toHaveBeenCalledTimes(3);
    expect(await store.list()).toHaveLength(60);
  });

  it('saveImage stores the file under the slot key with its card and label', async () => {
    const idb = fakeIndexedDB();
    const store = idbImageStore(idb.factory, 'save');
    const file = imageFile('delver-back.jpg');
    await saveImage(store, file, { key: 'Insectile Aberration', label: 'Insectile Aberration (back)', card: 'Delver of Secrets // Insectile Aberration' }, 42);
    const got = await store.get('Insectile Aberration');
    expect(got).toMatchObject({ card: 'Delver of Secrets // Insectile Aberration', label: 'Insectile Aberration (back)', fileName: 'delver-back.jpg', type: 'image/jpeg', addedAt: 42 });
    expect(got?.blob).toBe(file);
  });
});

describe('files and decklists', () => {
  it('sorts picked files into images, decklists, too large and ignored', () => {
    const big = imageFile('huge.png', 'image/png');
    Object.defineProperty(big, 'size', { value: MAX_IMAGE_BYTES + 1 });
    const sorted = sortFiles([imageFile('a.jpg'), imageFile('b.WEBP', ''), new File(['4 Forest'], 'deck.txt', { type: 'text/plain' }), big, new File([''], 'notes.pdf'), new File([''], 'x.svg', { type: 'image/svg+xml' })]);
    expect(sorted.images.map((f) => f.name)).toEqual(['a.jpg', 'b.WEBP']);
    expect(sorted.decklists.map((f) => f.name)).toEqual(['deck.txt']);
    expect(sorted.tooLarge.map((f) => f.name)).toEqual(['huge.png']);
    expect(sorted.ignored.map((f) => f.name)).toEqual(['notes.pdf', 'x.svg']);
    expect(isImageFile({ name: 'scan', type: 'image/jpeg' })).toBe(true);
  });

  it('a review search starts from the server guess, or the file name without set codes, copy numbers and side words', () => {
    expect(queryFromFileName('Lightning Bolt (2).jpg')).toBe('Lightning Bolt');
    expect(queryFromFileName('001_delver-of-secrets_front.png')).toBe('delver of secrets');
    expect(queryFromFileName('Æther Vial (MMA) 199.webp')).toBe('Æther Vial');
    expect(queryFromFileName('Forest copy.jpg')).toBe('Forest');
    expect(queryFromFileName('Forest - Copy (3).jpg')).toBe('Forest');
    expect(queryFromFileName('delver_b.jpg')).toBe('delver');
    expect(queryFromFileName('scan_0042.jpg')).toBe('scan');
    expect(queryOf(answer('x.jpg', slot('Insectile Aberration', 'Delver of Secrets // Insectile Aberration'), 0.5))).toBe('Delver of Secrets');
    expect(queryOf(answer('Lightning Bolt (2).jpg', null, 0, [slot('Lightning Bolt')]))).toBe('Lightning Bolt');
    expect(queryOf(answer('Mystery (2).jpg', null, 0))).toBe('Mystery');
  });

  it('a decklist file is used only when it looks like one (counts, SB:, set codes)', async () => {
    expect(looksLikeDecklistLine('4 Lightning Bolt')).toBe(true);
    expect(looksLikeDecklistLine('SB: 2 Duress')).toBe(true);
    expect(looksLikeDecklistLine('Lightning Bolt (M10) 146')).toBe(true);
    expect(looksLikeDecklistLine('Photographed with my phone.')).toBe(false);
    expect(localDeckNames('Scans of my cube, March 2025\nPhotographed with my phone.\n4 Forest', { strict: true })).toEqual(['Forest']);
    stubFetch(() => ({ status: 200, body: { cards: [], unknown: [], errors: [], links: [], ignored: 0 } }));
    const readme = new File(['Scans of my cube, March 2025\nPhotographed with my phone.\nPlease do not share.\nCredits: me'], 'README.txt', { type: 'text/plain' });
    expect(await fileDeckNames(readme)).toEqual({ file: 'README.txt', names: [], decklist: false });
    const deck = new File(['4 Delver of Secrets\n2 Island'], 'deck.txt', { type: 'text/plain' });
    expect(await fileDeckNames(deck)).toEqual({ file: 'deck.txt', names: ['Delver of Secrets', 'Island'], decklist: true });
  });

  it('reads decklist names locally (Arena, MTGO, sideboard lines, set codes)', () => {
    const text = 'Deck\n4 Forest (M21) 274\n2x Delver of Secrets\nSB: 1 Island\n\nSideboard\n3 Commit // Memory\n// comment\n4 Forest';
    expect(localDeckNames(text)).toEqual(['Forest', 'Delver of Secrets', 'Island', 'Commit // Memory']);
  });

  it('deckNamesOf uses the server resolver, and falls back to the local reading when it fails', async () => {
    stubFetch(() => ({ status: 200, body: { cards: [{ section: 'main', count: 4, name: 'Delver of Secrets // Insectile Aberration', oracleId: 'x', automation: 'partial' }], unknown: [], errors: [], links: [], ignored: 0 } }));
    expect(await deckNamesOf('4 Delver of Secrets')).toEqual(['Delver of Secrets // Insectile Aberration']);
    stubFetch(() => ({ status: 501, body: { error: 'not implemented' } }));
    expect(await deckNamesOf('4 Delver of Secrets')).toEqual(['Delver of Secrets']);
    expect(await deckNamesOf('  ')).toEqual([]);
  });
});
