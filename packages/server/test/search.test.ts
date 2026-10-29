/** GET /api/cards/search and GET /api/cards/:name over fixture cards (no network), plus the classification index behind them and /api/status. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CardDetailResponse, SearchResponse } from '../src/api';
import { cardStore, closeCardStores, compareCardNames, coverageCounts, sortByCardName } from '../src/cache';
import { versionDir } from '../src/compiled';
import { cardDetail, searchCards } from '../src/search';
import { colorTest, numberTest, relevance, terms, type SearchRow } from '../src/search-query';
import { costColors } from '../src/summary';
import { makeFixtureCache, MELD_RESULT, req, SHARED_FACE, TEST_ARTIST, TEST_IMAGE, type FixtureCache } from './fixture-cache';

// Compiling fixture cards (search pages, definitions, the classification index) takes seconds on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });
// The classification-index tests also pass it themselves: in a full `npm test` run (shared worker threads) they timed out at the 5 s default.

let fx: FixtureCache;

beforeAll(() => {
  fx = makeFixtureCache();
});

afterAll(async () => {
  await closeCardStores();
  fx.cleanup();
});

async function search(query: Record<string, string>): Promise<SearchResponse> {
  const r = await searchCards(req({ query }), fx.ctx);
  if (r.status !== 200) throw new Error(`search ${JSON.stringify(query)} -> ${r.status} ${r.body.error}`);
  return r.body;
}
const names = (r: SearchResponse): string[] => r.cards.map((c) => c.name);

describe('query parsing', () => {
  it('reads comparisons, color sets and quoted phrases', () => {
    expect([1, 2, 3].filter(numberTest('<=2')!)).toEqual([1, 2]);
    expect([1, 2, 3].filter(numberTest('3')!)).toEqual([3]);
    expect(numberTest('lots')).toBeNull();
    const at = colorTest('WU', '>=')!;
    expect([1, 3, 2, 7].map(at)).toEqual([false, true, false, true]);
    expect(colorTest('=C', '>=')!(0)).toBe(true);
    expect(colorTest('WC', '>=')).toBeNull();
    expect(terms('deals "3 damage" to')).toEqual(['deals', '3 damage', 'to']);
  });
});

describe('GET /api/cards/search', () => {
  it('finds cards by name or rules-text words, in Oracle-name order, with summaries', async () => {
    expect(names(await search({ q: 'bolt' }))).toEqual(["Electro's Bolt", 'Firebolt', 'Intimidation Bolt', 'Lightning Bolt', 'Plasma Bolt']); // substring match, Oracle-name order (Plasma Bolt: fixture card since FAST5X E2; Electro's Bolt: FAST5X E6; Intimidation Bolt: std-ry4)
    const r = await search({ q: 'lightning bolt' });
    expect(names(r)).toEqual(['Lightning Bolt']);
    const bolt = r.cards[0]!;
    expect(bolt).toMatchObject({ manaValue: 1, colors: ['R'], colorIdentity: ['R'], layout: 'normal', legalities: { modern: 'legal' } });
    expect(bolt.oracleId).toMatch(/^[0-9a-f-]{36}$/);
    expect(bolt.faces).toEqual([{ name: 'Lightning Bolt', manaCost: '{R}', typeLine: 'Instant', oracleText: 'Lightning Bolt deals 3 damage to any target.', colors: ['R'] }]);
    expect(['full', 'partial', 'manual']).toContain(bolt.automation);
    const text = await search({ q: '"deals 3 damage"' });
    expect(names(text)).toContain('Lightning Bolt');
    expect(names(text)).toEqual([...names(text)].sort());
  });

  it('includes image URLs, with their artist, only when the client says the player opted in (images=1)', async () => {
    expect((await search({ name: 'lightning bolt' })).cards[0]!.faces[0]!.imageUris).toBeUndefined();
    expect((await search({ name: 'lightning bolt', images: '0' })).cards[0]!.faces[0]!.imageUris).toBeUndefined();
    expect((await search({ name: 'lightning bolt', images: '1' })).cards[0]!.faces[0]!.imageUris).toEqual({ ...TEST_IMAGE, artist: TEST_ARTIST });
  });

  it('filters by name, rules text, types and subtypes, keywords, mana value, power and toughness', async () => {
    expect(names(await search({ name: 'grizzly' }))).toEqual(['Grizzly Bears']);
    expect(names(await search({ text: 'counter target spell' }))).toContain('Counterspell');
    const elves = names(await search({ types: 'creature,elf' }));
    expect(elves).toContain('Llanowar Elves');
    expect(elves.every((n) => n !== 'Grizzly Bears')).toBe(true);
    expect(names(await search({ types: 'legendary,planeswalker' }))).toEqual(expect.arrayContaining(['Chandra, Torch of Defiance', 'Liliana of the Veil']));
    const fliers = names(await search({ keywords: 'flying,vigilance' }));
    expect(fliers).toContain('Serra Angel');
    expect(fliers).not.toContain('Air Elemental');
    expect(names(await search({ types: 'creature', mv: '<=1', pow: '>=2' }))).not.toContain('Llanowar Elves');
    expect(names(await search({ name: 'bears', pow: '2', tou: '=2' }))).toEqual(['Grizzly Bears']);
    const twelve = names(await search({ pow: '>=11' }));
    expect(twelve).toContain('Darksteel Colossus');
  });

  it('filters by colors (at least, exactly, within, colorless) and color identity (CR 903.4)', async () => {
    const red = names(await search({ colors: 'R', types: 'instant' }));
    expect(red).toContain('Lightning Bolt');
    expect(red).not.toContain('Counterspell');
    const exactlyWU = await search({ colors: '=WU', pageSize: '200' });
    expect(names(exactlyWU)).toEqual(expect.arrayContaining(["Galina's Knight", 'Vassal Soul']));
    for (const c of exactlyWU.cards) expect(c.colors, c.name).toEqual(['W', 'U']);
    const colorless = names(await search({ colors: 'C', types: 'artifact', pageSize: '200' })); // std-ra: more colorless artifacts in the fixtures than one default page
    expect(colorless).toContain('Sol Ring');
    expect(colorless).toContain('Bonesplitter');
    expect(names(await search({ colors: 'C' }))).not.toContain('Lightning Bolt');
    const monoGreenIdentity = names(await search({ identity: 'G', types: 'creature', pageSize: '200' })); // std-r9: more fixture cards, a wider page (never fewer cards)
    expect(monoGreenIdentity).toContain('Grizzly Bears');
    expect(monoGreenIdentity).not.toContain('Serra Angel');
  });

  it('a double-faced card has its front face colors (CR 712.8a) and every face in the summary', async () => {
    const r = await search({ name: 'delver of secrets' });
    expect(r.cards[0]!.faces.map((f) => f.name)).toEqual(['Delver of Secrets', 'Insectile Aberration']);
    expect(names(await search({ name: 'insectile' }))).toEqual(['Delver of Secrets // Insectile Aberration']);
    // Agadeem's Awakening // Agadeem, the Undercrypt: a black front face and a colorless land back face. Its colors are the front face's only.
    const agadeem = (await search({ name: "agadeem's awakening" })).cards[0]!;
    expect(agadeem.faces.map((f) => f.colors)).toEqual([['B'], []]);
    expect(agadeem.colors).toEqual(['B']);
    expect(names(await search({ colors: 'C', pageSize: '200' }))).not.toContain(agadeem.name);
    expect(names(await search({ colors: '=B', name: 'agadeem' }))).toEqual([agadeem.name]);
  });

  it('each face of a split, adventure, prepare or flip card has the colors of its own mana cost (CR 202.2, 709.4, 715.3b, 710.1c)', async () => {
    const faceColors = async (name: string) => (await search({ name, pageSize: '200' })).cards.find((c) => c.name.startsWith(name))!.faces.map((f) => [f.name, f.colors]);
    expect(await faceColors('Fire // Ice')).toEqual([['Fire', ['R']], ['Ice', ['U']]]);
    expect(await faceColors('Wear // Tear')).toEqual([['Wear', ['R']], ['Tear', ['W']]]);
    expect(await faceColors('Bonecrusher Giant')).toEqual([['Bonecrusher Giant', ['R']], ['Stomp', ['R']]]);
    expect(await faceColors('Strife Scholar')).toEqual([['Strife Scholar', ['R']], ['Awaken the Ages', ['R']]]);
    // CR 710.1c: the flipped half has no mana cost of its own and keeps the card's color.
    expect(await faceColors('Akki Lavarunner')).toEqual([['Akki Lavarunner', ['R']], ['Tok-Tok, Volcano Born', ['R']]]);
    expect(costColors('{2}{W/U}{G/P}{2/B}{S}{C}{X}')).toEqual(['W', 'U', 'B', 'G']);
  });

  it('orders name and q matches by relevance: exact name, then name start, then name words, then rules text; Oracle-name order within each', async () => {
    expect(names(await search({ q: 'swamp' }))).toEqual(['Swamp', 'Swamp Mosquito' /* std-rx35 fixture card */, 'Foggy Swamp Vinebender' /* FAST5X E10 fixture card */, 'Foggy Swamp Visions' /* std-rx32 fixture card */, 'Leatherhead, Swamp Stalker' /* FAST5X E24 fixture card */, 'Snow-Covered Swamp', 'Bog Raiders', 'Corrupt' /* std-rx20 fixture card */, 'Infernal Harvest' /* std-ry4 fixture card: returns Swamps */, 'Lake of the Dead' /* p2-replace-events-1 fixture card */, 'Magical Hack', 'Quagmire' /* p2-attack-block-1 fixture card: swampwalk */, 'Troll of Khazad-dûm' /* FAST5 T57 fixture card: Swampcycling */, 'Urborg, Tomb of Yawgmoth', "Witch's Cottage" /* std-rx19 fixture card: other Swamps */]);
    expect(names(await search({ q: 'island' }))[0]).toBe('Island');
    expect(names(await search({ name: 'shock' }))).toEqual(['Shock', 'Shocker' /* p2-zone-moves-1 fixture card */, 'Barbed Shocker' /* p2-zone-moves-1 fixture card */, 'Stoneshock Giant' /* std-rx18 fixture card */, 'Sudden Shock']);
    // A card whose full name is the query comes before a card that only has a face of that name ("Emeritus of Conflict // Lightning Bolt").
    const rank = relevance('lightning bolt', ['lightning', 'bolt']);
    const row = (full: string, ...faces: string[]) => ({ nameList: [full, ...faces], names: [full, ...faces].join('\n') }) as unknown as SearchRow;
    expect(rank(row('lightning bolt'))).toBeLessThan(rank(row('emeritus of conflict // lightning bolt', 'emeritus of conflict', 'lightning bolt')));
    expect(names(await search({ types: 'land', pageSize: '200' }))).toEqual([...names(await search({ types: 'land', pageSize: '200' }))].sort((a, b) => compareCardNames(a, b)));
  });

  it('a meld result is no deck card (CR 712.4b): not listed by search, not counted in coverage', async () => {
    expect((await search({ name: MELD_RESULT })).total).toBe(0);
    const opened = await cardStore(fx.ctx);
    if (!opened.ok) throw new Error(opened.error);
    expect(opened.store.cards.map((c) => c.name)).not.toContain(MELD_RESULT);
    expect(opened.store.db.lookup(MELD_RESULT)?.name).toBe(MELD_RESULT); // still known for lookups and image slots
  });

  it('sorts names by their folded form, so accented names sit among their letter, not after Z', () => {
    expect(['Zur the Enchanter', 'Éowyn, Lady of Rohan', 'Elvish Mystic', 'Óin the Brave', 'Okiba'].sort(compareCardNames)).toEqual([
      'Elvish Mystic',
      'Éowyn, Lady of Rohan',
      'Óin the Brave',
      'Okiba',
      'Zur the Enchanter',
    ]);
  });

  it('sorts cards in the same order with each name folded once (the store sort)', () => {
    const names = ['Zur the Enchanter', 'Éowyn, Lady of Rohan', 'elvish mystic', 'Elvish Mystic', 'Óin the Brave', 'Okiba', '"Ach! Hans, Run!"'];
    expect(sortByCardName(names.map((name) => ({ name }))).map((c) => c.name)).toEqual([...names].sort(compareCardNames));
  });

  it('filters by format legality from the index (legal or restricted; no data is left out)', async () => {
    const vintage = names(await search({ format: 'vintage' }));
    expect(vintage).toEqual(expect.arrayContaining(['Lightning Bolt', 'Sol Ring', 'Counterspell']));
    expect(vintage).not.toContain('Shock'); // no legality data in the fixture: never shown as legal
    expect(names(await search({ format: 'modern' }))).not.toContain('Sol Ring');
    expect(names(await search({ format: 'legacy' }))).not.toContain('Sol Ring'); // banned
  });

  it('pages results in a stable order', async () => {
    const all = await search({ types: 'creature', pageSize: '200' });
    const p1 = await search({ types: 'creature', pageSize: '10' });
    const p2 = await search({ types: 'creature', pageSize: '10', page: '2' });
    expect(p1.total).toBe(all.total);
    expect(p1).toMatchObject({ page: 1, pageSize: 10 });
    expect([...names(p1), ...names(p2)]).toEqual(names(all).slice(0, 20));
    expect((await search({ types: 'creature', page: '999' })).cards).toEqual([]);
  });

  it('answers 400 for malformed filters instead of ignoring them', async () => {
    for (const query of <Record<string, string>[]>[
      { mv: 'many' },
      { colors: 'XYZ' },
      { automation: 'some' },
      { page: '0' },
      { pageSize: '500' },
      { format: 'not a format!' },
      { pow: '>=' },
      { cmc: '1', color: 'R' }, // unknown parameter names are never ignored
      { q: 'bolt', colour: 'R' },
      { q: '"draw a card' }, // unbalanced quote
      { format: 'modrn' }, // no card has legality data for it
    ]) {
      const r = await searchCards(req({ query }), fx.ctx);
      expect(r.status, JSON.stringify(query)).toBe(400);
    }
    const unknownParam = await searchCards(req({ query: { colour: 'R' } }), fx.ctx);
    if (unknownParam.status === 400) expect(unknownParam.body.error).toContain('colour');
    const typo = await searchCards(req({ query: { format: 'modrn' } }), fx.ctx);
    if (typo.status === 400) expect(typo.body.error).toContain('modern');
  });

  it('reads format aliases (edh = commander) and freeform / casual as no card-pool filter', async () => {
    const all = (await search({})).total;
    expect((await search({ format: 'freeform' })).total).toBe(all);
    expect((await search({ format: 'casual' })).total).toBe(all);
    expect(names(await search({ format: 'edh', pageSize: '200' }))).toEqual(names(await search({ format: 'commander', pageSize: '200' })));
    expect(names(await search({ format: 'EDH' }))).toContain('Lightning Bolt');
  });

  it('reads a typed type line: spaces and dashes separate words like commas ("Legendary Creature", "Creature — Elf")', async () => {
    expect(names(await search({ types: 'Legendary Planeswalker' }))).toEqual(names(await search({ types: 'legendary,planeswalker' })));
    expect(names(await search({ types: 'Creature — Elf' }))).toEqual(names(await search({ types: 'creature,elf' })));
    expect(names(await search({ types: 'creature - elf' }))).toContain('Llanowar Elves');
  });

  it('reads "//" with or without spaces as the split-card separator', async () => {
    expect(names(await search({ q: 'fire//ice' }))).toEqual(['Fire // Ice']);
    expect(names(await search({ name: 'Fire //Ice' }))).toEqual(['Fire // Ice']);
  });

  it('filters by automation level once the classification index is built, and persists it on disk', async () => {
    const opened = await cardStore(fx.ctx);
    if (!opened.ok) throw new Error(opened.error);
    await opened.store.automation.start();
    const full = await search({ automation: 'full', pageSize: '200' });
    const manual = await search({ automation: 'manual', pageSize: '200' });
    expect(full.cards.every((c) => c.automation === 'full')).toBe(true);
    expect(manual.cards.every((c) => c.automation === 'manual')).toBe(true);
    // by name: the first page of 200 full cards (alphabetical) no longer reaches "G" now that the fixture set has grown (FAST5 batch 4)
    expect(names(await search({ automation: 'full', name: 'grizzly' }))).toEqual(['Grizzly Bears']);
    const counts = await coverageCounts(fx.ctx);
    expect(counts).not.toBeNull();
    expect(counts!.full + counts!.partial + counts!.manual).toBe(counts!.total);
    expect(counts!.total).toBe(fx.deckCards.length);
    const file = path.join(versionDir(fx.ctx.compiledDir), 'classification.jsonl');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8').trim().split('\n').length).toBeGreaterThanOrEqual(fx.deckCards.length);
  }, 60_000);
});

describe('GET /api/cards/:name', () => {
  async function detail(name: string): Promise<CardDetailResponse> {
    const r = await cardDetail(req({ params: { name } }), fx.ctx);
    if (r.status !== 200) throw new Error(`${name} -> ${r.status} ${r.body.error}`);
    return r.body;
  }

  it('returns the Oracle data, a compiled summary and no manual parts for a fully automated card', async () => {
    const d = await detail('lightning bolt');
    expect(d.card.name).toBe('Lightning Bolt');
    expect(d.card.automation).toBe('full');
    expect(d.manualParts).toEqual([]);
    expect(d.compiled.faces).toEqual([{ name: 'Lightning Bolt', abilities: 1, manual: 0 }]);
    expect(d.compiled.compilerVersion).toBeTruthy();
  });

  it('lists the manual parts of a card that is not fully automated, per face', async () => {
    const opened = await cardStore(fx.ctx);
    if (!opened.ok) throw new Error(opened.error);
    await opened.store.automation.start();
    const notFull = (await search({ automation: 'partial', pageSize: '200' })).cards.concat((await search({ automation: 'manual', pageSize: '200' })).cards);
    expect(notFull.length).toBeGreaterThan(0);
    for (const card of notFull.slice(0, 10)) {
      const d = await detail(card.name);
      expect(d.card.automation, card.name).not.toBe('full');
      expect(d.manualParts.length, card.name).toBeGreaterThan(0);
      for (const p of d.manualParts) {
        expect(p.face).toBeLessThan(d.card.faces.length);
        // A player-facing sentence and a coarse category; the compiler's diagnostic stays in `reason` for an expandable detail view.
        expect(['not-understood', 'needs-engine', 'capped', 'rejected']).toContain(p.category);
        expect(p.summary).toMatch(/by hand/);
        expect(p.summary).not.toBe(p.reason);
      }
    }
  });

  it('accepts face names and loose spellings', async () => {
    expect((await detail('Insectile Aberration')).card.name).toBe('Delver of Secrets // Insectile Aberration');
    expect((await detail('THALIA GUARDIAN OF THRABEN')).card.name).toBe('Thalia, Guardian of Thraben');
  });

  it('answers 404 with suggestions for an unknown name and 409 with the full names for an ambiguous face name', async () => {
    const unknown = await cardDetail(req({ params: { name: 'Lightnig Bolt' } }), fx.ctx);
    expect(unknown.status).toBe(404);
    if (unknown.status === 404) expect(unknown.body.suggestions).toContain('Lightning Bolt');
    const shared = await cardDetail(req({ params: { name: SHARED_FACE } }), fx.ctx);
    expect(shared.status).toBe(409);
    if (shared.status === 409) expect(shared.body.suggestions).toEqual([`Alpha Echo // ${SHARED_FACE}`, `Beta Echo // ${SHARED_FACE}`]);
  });
});

describe('GET /api/cards/search with a Scryfall query (scry)', () => {
  it('answers a Scryfall-syntax search over the index, ANDed with the other parameters', async () => {
    expect(names(await search({ scry: 't:instant c:r mv<=1' }))).toContain('Lightning Bolt');
    const both = await search({ scry: 'o:"deals 3 damage" or t:artifact', q: 'bolt' });
    expect(names(both)).toEqual(['Intimidation Bolt' /* std-ry4 fixture card */, 'Lightning Bolt', 'Plasma Bolt']); // Plasma Bolt's void clause also prints "deals 3 damage"
    // f: reads the index's legality data: Sol Ring is restricted in vintage and banned in legacy (test legalities).
    expect(names(await search({ scry: 'name:"sol ring" f:vintage' }))).toEqual(['Sol Ring']);
    expect(names(await search({ scry: 'name:"sol ring" f:legacy' }))).toEqual([]);
    expect(names(await search({ scry: 'name:"sol ring" banned:legacy' }))).toEqual(['Sol Ring']);
    expect(names(await search({ scry: '!"Lightning Bolt"' }))).toEqual(['Lightning Bolt']);
  });

  it('answers 400 naming an unsupported keyword, a syntax error or a format the index has no data for', async () => {
    const bad = async (scry: string) => {
      const r = await searchCards(req({ query: { scry } }), fx.ctx);
      expect(r.status, scry).toBe(400);
      return r.status === 400 ? r.body.error : '';
    };
    expect(await bad('t:creature r:rare')).toMatch(/"r:" \(rarity\) is not supported/);
    expect(await bad('st:core')).toMatch(/"st:" \(set type\)/);
    expect(await bad('wibble:1')).toMatch(/Unknown search keyword "wibble"/);
    expect(await bad('(t:creature')).toMatch(/closing "\)"/);
    expect(await bad('f:notaformat')).toMatch(/No card has legality data for the format "notaformat"/);
  });
});

describe('while the classification index is being built', () => {
  it('the automation filter answers 503 with code indexBuilding, the progress and a retry delay', async () => {
    const ctx = { ...fx.ctx, compiledDir: path.join(fx.dir, 'compiled-fresh') };
    const r = await searchCards(req({ query: { automation: 'full' } }), ctx);
    expect(r.status).toBe(503);
    if (r.status !== 503) return;
    expect(r.body.code).toBe('indexBuilding');
    expect(r.body.progress!.total).toBe(fx.deckCards.length);
    expect(r.body.progress!.done).toBeLessThan(r.body.progress!.total);
    expect(r.body.retryAfterMs).toBeGreaterThan(0);
  });
});

describe('without card data', () => {
  it('every card endpoint answers 503 with the refresh instructions', async () => {
    const ctx = { cacheDir: path.join(fx.dir, 'empty'), compiledDir: path.join(fx.dir, 'compiled-empty'), version: 'test' };
    const r = await searchCards(req({ query: { q: 'bolt' } }), ctx);
    expect(r.status).toBe(503);
    if (r.status === 503) {
      expect(r.body.error).toContain('npm run cards -- refresh');
      expect(r.body.code).toBe('noCardData');
    }
    expect((await cardDetail(req({ params: { name: 'Shock' } }), ctx)).status).toBe(503);
    expect(await coverageCounts(ctx)).toBeNull();
  });
});
