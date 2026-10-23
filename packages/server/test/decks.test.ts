/** POST /api/decks/resolve and POST /api/cards/defs over fixture cards: local index only, deck-site links never requested, stubs (WP24), the disk cache. */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { COMPILER_VERSION } from '@openmtg/engine';
import type { DefsResponse, ResolveResponse } from '../src/api';
import { cardStore, closeCardStores } from '../src/cache';
import { cardKey, DefCache, versionDir } from '../src/compiled';
import { extractDeckLinks } from '../src/deck-sites';
import { compileDefs } from '../src/defs';
import { MAX_SUGGESTED_UNKNOWN, resolveDeck } from '../src/resolve';
import { makeFixtureCache, MELD_RESULT, req, SHARED_FACE, type FixtureCache } from './fixture-cache';

// Compiling fixture cards (search pages, definitions, the classification index) takes seconds on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

let fx: FixtureCache;

beforeAll(() => {
  fx = makeFixtureCache();
});

afterAll(async () => {
  await closeCardStores();
  fx.cleanup();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Fails the test if anything tries the network. */
function forbidNetwork() {
  const fetchSpy = vi.fn(() => {
    throw new Error('network request attempted');
  });
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

async function resolve(text: string): Promise<ResolveResponse> {
  const r = await resolveDeck(req({ body: { text } }), fx.ctx);
  if (r.status !== 200) throw new Error(`${r.status} ${r.body.error}`);
  return r.body;
}

describe('POST /api/decks/resolve', () => {
  it('resolves an Arena export into Oracle names, Oracle ids, sections, counts and automation levels', async () => {
    const fetchSpy = forbidNetwork();
    const r = await resolve(['Deck', '4 Lightning Bolt (M10) 146', '2 grizzly bears', '1 Insectile Aberration', '', 'Sideboard', '3 Counterspell', '', 'Maybeboard', '1 Shock'].join('\n'));
    expect(r.cards.map(({ section, count, name }) => ({ section, count, name }))).toEqual([
      { section: 'main', count: 4, name: 'Lightning Bolt' },
      { section: 'main', count: 2, name: 'Grizzly Bears' },
      { section: 'main', count: 1, name: 'Delver of Secrets // Insectile Aberration' },
      { section: 'sideboard', count: 3, name: 'Counterspell' },
    ]);
    const bolt = fx.cards.find((c) => c.name === 'Lightning Bolt')!;
    expect(r.cards[0]!.oracleId).toBe(bolt.oracle_id);
    expect(r.cards.every((c) => ['full', 'partial', 'manual'].includes(c.automation))).toBe(true);
    expect(r).toMatchObject({ unknown: [], errors: [], links: [], ignored: 1 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports unknown names with suggestions and a stub card to confirm (WP24), and parse errors per line', async () => {
    const r = await resolve(['4 Lightnig Bolt', '2 Totally Unknown Card', '3', 'SB: 1 Totally Unknown Card'].join('\n'));
    expect(r.cards).toEqual([]);
    expect(r.unknown.map(({ section, name, count, line }) => ({ section, name, count, line }))).toEqual([
      { section: 'main', name: 'Lightnig Bolt', count: 4, line: 1 },
      { section: 'main', name: 'Totally Unknown Card', count: 2, line: 2 },
      { section: 'sideboard', name: 'Totally Unknown Card', count: 1, line: 4 }, // its own first line in the sideboard
    ]);
    expect(r.unknown[0]!.suggestions).toContain('Lightning Bolt');
    const stub = r.unknown[1]!.stub!;
    expect(stub).toMatchObject({ name: 'Totally Unknown Card', stub: { origin: 'decklist' }, automation: { level: 'manual' } });
    expect(r.errors).toEqual([{ line: 3, text: '3', message: 'Missing card name after the count' }]);
  });

  it('never offers a stub for an ambiguous face name: the player picks a full name', async () => {
    const r = await resolve(`2 ${SHARED_FACE}`);
    expect(r.unknown).toHaveLength(1);
    expect(r.unknown[0]!.ambiguous).toEqual([`Alpha Echo // ${SHARED_FACE}`, `Beta Echo // ${SHARED_FACE}`]);
    expect(r.unknown[0]!.stub).toBeUndefined();
  });

  it('recognizes deck-site links by host and answers with export-and-paste steps, without any request to the site', async () => {
    const fetchSpy = forbidNetwork();
    const text = [
      'https://moxfield.com/decks/AbCdEf123',
      'www.archidekt.com/decks/123456/my-deck',
      'Check this: https://www.mtgtop8.com/event?e=1&d=2&f=ST.',
      'https://example.org/my/deck',
      '4 Lightning Bolt',
    ].join('\n');
    const r = await resolve(text);
    expect(r.links.map((l) => [l.site, l.url, l.known])).toEqual([
      ['Moxfield', 'https://moxfield.com/decks/AbCdEf123', true],
      ['Archidekt', 'www.archidekt.com/decks/123456/my-deck', true],
      ['MTGTop8', 'https://www.mtgtop8.com/event?e=1&d=2&f=ST', true],
      ['example.org', 'https://example.org/my/deck', false],
    ]);
    expect(r.links[0]!.exportSteps.join(' ')).toContain('Copy for MTGO');
    expect(r.links[3]!.exportSteps.join(' ')).toContain('does not open deck links');
    expect(r.cards.map((c) => c.name)).toEqual(['Lightning Bolt']);
    expect(r.unknown).toEqual([]); // the prose around a link is never offered as a card
    expect(r.errors).toEqual([{ line: 3, text: 'Check this:', message: 'Text around a deck link was ignored' }]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never reads the text around a deck link as a card name, and offers it no stub card', async () => {
    const r = await resolve('Check out my deck at https://moxfield.com/decks/abc\n4 Shock');
    expect(r.links.map((l) => l.site)).toEqual(['Moxfield']);
    expect(r.cards.map((c) => c.name)).toEqual(['Shock']);
    expect(r.unknown).toEqual([]);
    expect(r.errors.map((e) => [e.line, e.text])).toEqual([[1, 'Check out my deck at']]);
  });

  it('removes invisible format characters (Unicode Cf: zero-width space, joiners, BOM) copied from web pages', async () => {
    const r = await resolve('﻿1 Lightning Bolt​\n2 Grizzly‍ Bears\n1 Counter­spell');
    expect(r.cards.map((c) => c.name)).toEqual(['Lightning Bolt', 'Grizzly Bears', 'Counterspell']);
    expect(r.unknown).toEqual([]);
  });

  it('offers a stub card only for a line with an explicit count and a plausible card name', async () => {
    const r = await resolve(['-1 Opt', 'Totally Unknown Card', '2 Totally Other Card', 'Count,Name,Edition'].join('\n'));
    const stubs = Object.fromEntries(r.unknown.map((u) => [u.name, u.stub !== undefined]));
    expect(stubs).toEqual({ '-1 Opt': false, 'Totally Unknown Card': false, 'Totally Other Card': true, 'Count,Name,Edition': false });
  });

  it('a copy of an unknown name in a second section reports the line of its own first occurrence', async () => {
    const r = await resolve('4 Lighting Bolt\n56 Mountain\n\n3 Lighting Bolt\n1 Lighting Bolt');
    expect(r.unknown.map(({ section, count, line }) => ({ section, count, line }))).toEqual([
      { section: 'main', count: 4, line: 1 },
      { section: 'sideboard', count: 4, line: 4 },
    ]);
  });

  it('answers 400 for a paste that is mostly not card names, instead of scoring every line', async () => {
    const text = Array.from({ length: 400 }, (_, i) => `Row ${i} of my spreadsheet`).join('\n');
    const started = Date.now();
    const r = await resolveDeck(req({ body: { text } }), fx.ctx);
    expect(r.status).toBe(400);
    if (r.status === 400) expect(r.body.error).toMatch(/does not look like a decklist \(400 of 400 lines are not card names\)/);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it(`gives suggestions for the first ${MAX_SUGGESTED_UNKNOWN} unknown names only, and says so`, async () => {
    const unknownLines = Array.from({ length: MAX_SUGGESTED_UNKNOWN + 5 }, (_, i) => `1 Unknown Card Number ${i}`);
    const knownLines = Array.from({ length: unknownLines.length + 10 }, () => '1 Shock');
    const r = await resolve([...knownLines, ...unknownLines].join('\n'));
    expect(r.unknown).toHaveLength(unknownLines.length);
    expect(r.unknown.slice(MAX_SUGGESTED_UNKNOWN).every((u) => u.suggestions.length === 0)).toBe(true);
    expect(r.errors.some((e) => e.message.includes(`first ${MAX_SUGGESTED_UNKNOWN} unknown names`))).toBe(true);
  });

  it('reports the back face of a meld pair as no deck card (CR 712.4b)', async () => {
    const r = await resolve(`1 ${MELD_RESULT}\n4 Shock`);
    expect(r.cards.map((c) => c.name)).toEqual(['Shock']);
    expect(r.unknown).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ line: 1, text: MELD_RESULT });
    expect(r.errors[0]!.message).toContain('CR 712.4b');
  });

  it('answers a link-only paste without needing card data, keeps line numbers, and rejects bad bodies', async () => {
    const empty = { cacheDir: path.join(fx.dir, 'none'), compiledDir: path.join(fx.dir, 'none-compiled'), version: 'test' };
    const r = await resolveDeck(req({ body: { text: 'https://tappedout.net/mtg-decks/some-deck/' } }), empty);
    expect(r.status).toBe(200);
    if (r.status === 200) expect(r.body.links[0]!.site).toBe('TappedOut');
    expect(extractDeckLinks('4 Shock\nhttps://moxfield.com/decks/x\n\n2 Murder').text).toBe('4 Shock\n//\n\n2 Murder');
    expect((await resolveDeck(req({ body: { text: 4 } }), fx.ctx)).status).toBe(400);
    expect((await resolveDeck(req({ body: null }), fx.ctx)).status).toBe(400);
    expect((await resolveDeck(req({ body: { text: 'x'.repeat(200_001) } }), fx.ctx)).status).toBe(400);
  });
});

describe('POST /api/cards/defs', () => {
  async function defs(body: unknown): Promise<DefsResponse> {
    const r = await compileDefs(req({ body }), fx.ctx);
    if (r.status !== 200) throw new Error(`${r.status} ${r.body.error}`);
    return r.body;
  }

  it('compiles the named cards with the game-path compiler, keyed by the name as sent', async () => {
    const r = await defs({ names: ['Lightning Bolt', 'grizzly bears', 'Insectile Aberration'] });
    expect(r.compilerVersion).toBe(COMPILER_VERSION);
    expect(r.failed).toEqual([]);
    expect(Object.keys(r.defs)).toEqual(['Lightning Bolt', 'grizzly bears', 'Insectile Aberration']);
    expect(r.defs['Lightning Bolt']).toMatchObject({ id: 'Lightning Bolt', name: 'Lightning Bolt', automation: { level: 'full' } });
    expect(r.defs['grizzly bears']!.id).toBe('Grizzly Bears');
    expect(r.defs['Insectile Aberration']!.faces.map((f) => f.name)).toEqual(['Delver of Secrets', 'Insectile Aberration']);
  });

  it('reports unknown and ambiguous names instead of guessing, and turns confirmed stubs into stub cards', async () => {
    const r = await defs({ names: ['Lightnig Bolt', SHARED_FACE], stubs: ['My Homebrew Card', 'Shock'] });
    expect(r.failed.map((f) => f.name)).toEqual(['Lightnig Bolt', SHARED_FACE]);
    expect(r.failed[0]!.reason).toContain('Lightning Bolt');
    expect(r.failed[1]!.reason).toContain('several cards');
    expect(r.defs['My Homebrew Card']).toMatchObject({ name: 'My Homebrew Card', stub: { origin: 'decklist' } });
    expect(r.defs.Shock).toMatchObject({ name: 'Shock' }); // the index knows it now: the real card, not a stub
    expect(r.defs.Shock!.stub).toBeUndefined();
  });

  it('every failed name carries a structured code (unknown, ambiguous, rejected), so the client never matches the English reason', async () => {
    const r = await defs({ names: ['Lightnig Bolt', SHARED_FACE] });
    expect(r.failed.map((f) => [f.name, f.code])).toEqual([
      ['Lightnig Bolt', 'unknown'],
      [SHARED_FACE, 'ambiguous'],
    ]);
  });

  it('a confirmed stub that is an ambiguous face name is reported in failed with the full names, never turned into a blank stub', async () => {
    const r = await defs({ names: [], stubs: [SHARED_FACE] });
    expect(r.defs[SHARED_FACE]).toBeUndefined();
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]!.reason).toContain(`Alpha Echo // ${SHARED_FACE}`);
  });

  it('a confirmed stub the index knows but the compiler rejects is reported in failed with the reason, never silently replaced', async () => {
    const opened = await cardStore(fx.ctx);
    if (!opened.ok) throw new Error(opened.error);
    const spy = vi.spyOn(opened.store.defs, 'get').mockRejectedValueOnce(new Error('test rejection'));
    try {
      const r = await defs({ names: [], stubs: ['Murder'] });
      expect(r.defs.Murder).toBeUndefined();
      expect(r.failed).toEqual([{ name: 'Murder', code: 'rejected', reason: expect.stringContaining('test rejection') }]);
    } finally {
      spy.mockRestore();
    }
  });

  it('a name sent in both names and stubs (the player confirmed the stub) gets the stub and is not reported in failed', async () => {
    const r = await defs({ names: ['Lighting Bolt', 'Shock'], stubs: ['Lighting Bolt'] });
    expect(r.defs['Lighting Bolt']).toMatchObject({ name: 'Lighting Bolt', stub: { origin: 'decklist' } });
    expect(r.failed).toEqual([]);
    expect(r.defs.Shock!.name).toBe('Shock');
  });

  it('holds the classification build paused while it compiles: a game start waits on this answer', async () => {
    const opened = await cardStore(fx.ctx);
    if (!opened.ok) throw new Error(opened.error);
    const spy = vi.spyOn(opened.store.automation, 'whilePaused');
    try {
      const r = await defs({ names: ['Shock'] });
      expect(r.defs.Shock!.name).toBe('Shock');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('validates the body', async () => {
    for (const body of [null, {}, { names: 'Shock' }, { names: [3] }, { names: [''] }, { names: ['Shock'], stubs: [1] }, { names: Array.from({ length: 501 }, (_, i) => `n${i}`) }]) {
      expect((await compileDefs(req({ body }), fx.ctx)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
  });

  it('caches compiled definitions on disk under the compiler version, keyed by the card record hash', async () => {
    await defs({ names: ['Counterspell'] });
    const dir = path.join(versionDir(fx.ctx.compiledDir), 'defs');
    expect(path.basename(versionDir(fx.ctx.compiledDir)).startsWith(COMPILER_VERSION.replace(/[^A-Za-z0-9._+-]/g, '_'))).toBe(true);
    const opened = await cardStore(fx.ctx);
    if (!opened.ok) throw new Error(opened.error);
    const card = opened.store.db.lookup('Counterspell')!;
    expect(existsSync(path.join(dir, `${cardKey(card)}.json`))).toBe(true);
    // A fresh cache (a later server start) reads the file instead of compiling.
    const fresh = new DefCache(fx.ctx.compiledDir);
    const compiled = await opened.store.defs.get(card);
    expect(await fresh.get(card)).toEqual(compiled);
    expect(readdirSync(dir).every((f) => f.endsWith('.json'))).toBe(true);
  });

  it('a changed card record gets a new cache key (never a stale definition)', () => {
    const bolt = fx.cards.find((c) => c.name === 'Lightning Bolt')!;
    const changed = { ...bolt, oracle_text: 'Lightning Bolt deals 4 damage to any target.' };
    const reordered = Object.fromEntries(Object.entries(bolt).reverse()) as typeof bolt;
    const noImages = { ...bolt, image_uris: undefined };
    expect(cardKey(changed)).not.toBe(cardKey(bolt));
    expect(cardKey(reordered)).toBe(cardKey(bolt));
    expect(cardKey(noImages)).toBe(cardKey(bolt)); // image URLs are display data, not rules
  });
});
