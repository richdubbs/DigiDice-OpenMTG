/** POST /api/images/match: file names -> image slots (one per printed side, design 12.2), decklist-guided, with confidence and alternatives. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ImageFileMatch } from '../src/api';
import { cardStore, closeCardStores, type CardStore } from '../src/cache';
import { nameCandidates, similarity } from '../src/image-names';
import { matchFileNames, matchFileNamesAsync, matchImages } from '../src/images';
import { makeFixtureCache, req, type FixtureCache } from './fixture-cache';

// Compiling fixture cards (search pages, definitions, the classification index) takes seconds on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

let fx: FixtureCache;
let store: CardStore;

beforeAll(async () => {
  fx = makeFixtureCache();
  const opened = await cardStore(fx.ctx);
  if (!opened.ok) throw new Error(opened.error);
  store = opened.store;
});

afterAll(async () => {
  await closeCardStores();
  fx.cleanup();
});

const one = (fileName: string, deckNames: string[] = []): ImageFileMatch => matchFileNames(store.db, [fileName], deckNames)[0]!;

describe('file name readings', () => {
  it('strips folders, extensions, numbering, set codes, collector numbers and copy markers; reads "__" as "//"', () => {
    const names = (f: string) => nameCandidates(f).map((c) => c.name);
    expect(names('Lightning Bolt.jpg')[0]).toBe('Lightning Bolt');
    expect(names('my deck/03 - Lightning Bolt (M10) 146.jpg')).toContain('Lightning Bolt');
    expect(names('C:\\cards\\Lightning Bolt [M10].png')).toContain('Lightning Bolt');
    expect(names('m10-146-lightning-bolt.jpg')).toContain('lightning-bolt');
    expect(names('Lightning Bolt (1).jpeg')).toContain('Lightning Bolt');
    expect(names('Fire__Ice.png')).toContain('Fire // Ice');
    expect(names('Lightning%20Bolt.jpg')[0]).toBe('Lightning Bolt');
    expect(nameCandidates('Delver of Secrets - back.png').at(-1)).toEqual({ name: 'Delver of Secrets', side: 'back' });
    expect(similarity('lightning bolt', 'lightnig bolt')).toBeGreaterThan(0.9);
  });
});

describe('matching', () => {
  it('an exact card name is one slot with full confidence; a cleaned-up or loose name a little less', () => {
    expect(one('Lightning Bolt.jpg')).toEqual({ fileName: 'Lightning Bolt.jpg', match: { key: 'Lightning Bolt', label: 'Lightning Bolt', card: 'Lightning Bolt' }, confidence: 1, alternatives: [] });
    const numbered = one('07 - Lightning Bolt (M10) 146.jpg');
    expect(numbered.match?.card).toBe('Lightning Bolt');
    expect(numbered.confidence).toBe(0.95);
    expect(one('thalia_guardian_of_thraben.png').match?.card).toBe('Thalia, Guardian of Thraben');
  });

  it('binds per printed side: the back face of a transform card, front/back markers, and one picture for a split card', () => {
    const back = one('Insectile Aberration.jpg');
    expect(back.match).toMatchObject({ card: 'Delver of Secrets // Insectile Aberration', key: 'Insectile Aberration' });
    expect(back.confidence).toBe(1);
    const marked = one('Delver of Secrets - back.png');
    expect(marked.match?.key).toBe(back.match?.key);
    expect(marked.confidence).toBe(0.9);
    expect(marked.alternatives.map((a) => a.key)).toContain(one('Delver of Secrets.png').match?.key);
    const split = one('Fire__Ice.jpg');
    expect(split.match?.card).toBe('Fire // Ice');
    expect(one('Ice.jpg').match?.key).toBe(split.match?.key); // either half resolves to the card's one picture
  });

  it('a bracketed front/back marker ("(back)", "[back]", "(Back)", "(front)", "(back) (1)") picks that printed side, never the other one', () => {
    const front = one('Delver of Secrets.png').match!.key;
    const back = one('Insectile Aberration.png').match!.key;
    expect(front).not.toBe(back);
    for (const f of ['Delver of Secrets (back).jpg', 'Delver of Secrets [back].jpg', 'Delver of Secrets (Back).png', 'Delver of Secrets (back) (1).jpg', 'Delver of Secrets [BACK] - Copy.jpg']) {
      const m = one(f);
      expect(m.match?.key, f).toBe(back);
      expect(m.confidence, f).toBeLessThanOrEqual(0.9);
      expect(m.alternatives.map((a) => a.key), f).toContain(front);
    }
    expect(one('Huntmaster of the Fells (back).jpg').match?.label).toMatch(/Ravager of the Fells/);
    expect(one('Delver of Secrets (front).jpg').match?.key).toBe(front);
    // A real set code in brackets is still stripped.
    expect(one('Lightning Bolt (M10).jpg').match?.card).toBe('Lightning Bolt');
  });

  it('cleans the naming schemes of big image packs: ".full", glued variant digits, double extensions, "{number}"', () => {
    for (const f of ['Lightning Bolt.full.jpg', 'Lightning Bolt1.full.jpg', 'Lightning Bolt.png.png', 'Lightning Bolt [M10] {146}.jpg', 'Lightning Bolt2.jpg']) {
      const m = one(f);
      expect(m.match?.card, f).toBe('Lightning Bolt');
      expect(m.confidence, f).toBeGreaterThanOrEqual(0.9);
    }
    expect(one('Mountain1.jpg').match?.card).toBe('Mountain');
    expect(one('Insectile Aberration.full.jpg').match?.key).toBe(one('Insectile Aberration.jpg').match?.key);
  });

  it('reads the two face names of a split, adventure or flip card written without "//" ("Fire Ice", "Fire_Ice", "Fire-Ice")', () => {
    for (const f of ['Fire Ice.jpg', 'Fire_Ice.jpg', 'Fire-Ice.jpg', 'Fire Ice.full.jpg', 'Bonecrusher Giant Stomp.png']) {
      const m = one(f);
      expect(m.match?.card, f).toMatch(/^(Fire \/\/ Ice|Bonecrusher Giant \/\/ Stomp)$/);
      expect(m.confidence, f).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('matching many names yields to the event loop between batches, so other requests keep being answered', async () => {
    let turns = 0;
    const fileNames = Array.from({ length: 120 }, (_, i) => `IMG_2024${String(i).padStart(4, '0')}.jpg`);
    const spin = (): void => {
      turns++;
      if (turns < 1000) setImmediate(spin);
    };
    setImmediate(spin);
    const matches = await matchFileNamesAsync(store.db, fileNames);
    const seen = turns;
    turns = 1000; // stop the spinner
    expect(matches).toEqual(matchFileNames(store.db, fileNames));
    expect(seen).toBeGreaterThanOrEqual(Math.floor(fileNames.length / 10) - 1);
  });

  it('token names with several variants: the decklist picks the variant its cards make, otherwise alternatives for the review screen', () => {
    const spirits = one('Spirit.jpg');
    expect(spirits.confidence).toBe(0.6);
    expect(spirits.alternatives.length).toBeGreaterThan(0);
    const guided = one('Spirit token.jpg', ['Doomed Traveler']);
    expect(guided.confidence).toBe(0.9);
    expect(guided.match?.label).toMatch(/Spirit/);
    expect(guided.match?.key).not.toBe(guided.alternatives[0]?.key);
  });

  it('token variants with one name get labels the review screen can tell apart (the slot detail of each key)', () => {
    const spirits = one('Spirit.jpg');
    const offered = [spirits.match!, ...spirits.alternatives];
    expect(offered.length).toBeGreaterThan(1);
    const labels = offered.map((m) => m.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const m of offered) expect(m.label).toMatch(/^Spirit token/);
    // A slot whose label is already unique keeps it unchanged.
    expect(one('Lightning Bolt.jpg').match!.label).toBe('Lightning Bolt');
  });

  it('fuzzy matches: decklist names first, then the whole index; nothing proposed for noise', () => {
    const typo = one('Lightnig Blot.jpg', ['Lightning Bolt', 'Counterspell']);
    expect(typo.match?.card).toBe('Lightning Bolt');
    expect(typo.confidence).toBeGreaterThan(0.6);
    expect(typo.confidence).toBeLessThan(0.85);
    const indexOnly = one('Countrspell.jpg');
    expect(indexOnly.match?.card).toBe('Counterspell');
    expect(indexOnly.confidence).toBeLessThan(one('Countrspell.jpg', ['Counterspell']).confidence);
    const noise = one('IMG_20240101_123456.jpg');
    expect(noise.match).toBeNull();
    expect(noise.confidence).toBe(0);
  });

  it('the endpoint validates its body and matches names only (no image data)', async () => {
    const ok = await matchImages(req({ body: { fileNames: ['Shock.png'], deckNames: ['Shock'] } }), fx.ctx);
    expect(ok.status).toBe(200);
    if (ok.status === 200) expect(ok.body.matches[0]!.match?.card).toBe('Shock');
    for (const body of [null, {}, { fileNames: 'a.jpg' }, { fileNames: [1] }, { fileNames: ['a.jpg'], deckNames: 'x' }, { fileNames: Array.from({ length: 2001 }, () => 'a.jpg') }]) {
      expect((await matchImages(req({ body }), fx.ctx)).status, JSON.stringify(body).slice(0, 50)).toBe(400);
    }
  });
});
