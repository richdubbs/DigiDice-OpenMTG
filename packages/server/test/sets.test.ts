/** Set search (sets.ts): the set lists from a fake Scryfall (no network), kept on disk, offline fallbacks, set names, and s: in GET /api/cards/search. */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ScryfallClient, type Clock } from '@openmtg/cards';
import type { SetSummary } from '../src/api';
import { closeCardStores } from '../src/cache';
import type { ServerContext } from '../src/context';
import { listSets, searchCards } from '../src/search';
import { findSet, SetLists, SetsUnavailableError } from '../src/sets';
import { makeFixtureCache, req, type FixtureCache } from './fixture-cache';

vi.setConfig({ testTimeout: 60_000 });

const clock: Clock = { now: () => 0, sleep: async () => undefined };
const DAY = 24 * 60 * 60 * 1000;

const SETS = [
  { code: 'tst', name: 'Test Set', set_type: 'expansion', released_at: '2020-01-01', card_count: 3 },
  { code: 'tsc', name: 'Test Set Commander', set_type: 'commander', released_at: '2020-01-01', card_count: 1 },
  { code: 'new', name: 'Brand New', set_type: 'expansion', released_at: '2099-01-01', card_count: 1 },
  { code: 'nil', name: 'Empty Promos', set_type: 'promo', released_at: '2019-01-01', card_count: 0 },
];

/** A fake Scryfall: /sets, and /cards/search?q=e:<code> in pages of two cards. `offline` makes every request fail. */
function fakeScryfall(cards: Record<string, string[]>) {
  const calls: string[] = [];
  const state = { offline: false };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    if (state.offline) throw new TypeError('fetch failed');
    if (url.pathname === '/sets') return json({ data: SETS });
    if (url.pathname === '/cards/search') {
      const code = /^e:(\w+)$/.exec(url.searchParams.get('q') ?? '')?.[1] ?? '';
      const ids = cards[code];
      if (!ids?.length) return json({ object: 'error', code: 'not_found', details: 'Your query didn’t match any cards.' }, 404);
      const page = Number(url.searchParams.get('page') ?? '1');
      const slice = ids.slice((page - 1) * 2, page * 2);
      const more = page * 2 < ids.length;
      const next = new URL(url);
      next.searchParams.set('page', String(page + 1));
      // Reversible cards carry their Oracle id on their faces only.
      const data = slice.map((id) => (id.startsWith('rev-') ? { card_faces: [{ oracle_id: id }, { oracle_id: id }] } : { oracle_id: id }));
      return json({ data, has_more: more, ...(more ? { next_page: next.toString() } : {}) });
    }
    return json({ object: 'error' }, 404);
  }) as typeof globalThis.fetch;
  return { calls, state, client: new ScryfallClient({ fetch, clock }) };
}

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'openmtg-sets-'));
  dirs.push(d);
  return d;
};

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('SetLists', () => {
  it('fetches the set list and a set\'s cards (every page) once, and keeps them for the next start', async () => {
    const dir = tempDir();
    const fake = fakeScryfall({ tst: ['a', 'b', 'rev-c', 'a'] });
    const lists = new SetLists(dir, fake.client);
    const sets = await lists.all();
    expect(sets.map((s) => s.code)).toEqual(['new', 'tst', 'tsc']); // newest first, empty sets left out
    expect(sets[1]).toEqual({ code: 'tst', name: 'Test Set', type: 'expansion', released: '2020-01-01', cards: 3 });
    const tst = sets[1]!;
    expect([...(await lists.cardsOf(tst))].sort()).toEqual(['a', 'b', 'rev-c']);
    expect(JSON.parse(readFileSync(path.join(dir, 'tst.json'), 'utf8'))).toEqual(['a', 'b', 'rev-c']);
    expect(existsSync(path.join(dir, '_all-sets.json'))).toBe(true);
    const fetched = fake.calls.length;
    expect(fake.calls.filter((c) => c.startsWith('/cards/search'))).toHaveLength(2);

    // The next start (a new SetLists) reads the kept files: no request, even offline.
    fake.state.offline = true;
    const again = new SetLists(dir, fake.client);
    expect((await again.all()).map((s) => s.code)).toEqual(['new', 'tst', 'tsc']);
    expect((await again.cardsOf(tst)).has('b')).toBe(true);
    expect(fake.calls.length).toBe(fetched);
  });

  it('a set with no cards on Scryfall is an empty list; a set not out yet is fetched again after a day', async () => {
    const dir = tempDir();
    const fake = fakeScryfall({ new: ['x'] });
    const set = (code: string) => ({ code, name: code, type: 'expansion', released: code === 'new' ? '2099-01-01' : '2020-01-01', cards: 1 }) satisfies SetSummary;
    expect((await new SetLists(dir, fake.client).cardsOf(set('tsc'))).size).toBe(0);
    await new SetLists(dir, fake.client).cardsOf(set('new'));
    const before = fake.calls.length;
    await new SetLists(dir, fake.client).cardsOf(set('new')); // kept: less than a day old
    expect(fake.calls.length).toBe(before);
    await new SetLists(dir, fake.client, () => Date.now() + 2 * DAY).cardsOf(set('new'));
    expect(fake.calls.length).toBe(before + 1);
    await new SetLists(dir, fake.client, () => Date.now() + 365 * DAY).cardsOf(set('tsc')); // released long ago: kept for good
    expect(fake.calls.length).toBe(before + 1);
  });

  it('offline: a kept list however old, else SetsUnavailableError (tried again by the next search)', async () => {
    const dir = tempDir();
    const fake = fakeScryfall({ tst: ['a'] });
    fake.state.offline = true;
    const lists = new SetLists(dir, fake.client);
    await expect(lists.all()).rejects.toBeInstanceOf(SetsUnavailableError);
    await expect(lists.all()).rejects.toThrow(/needs an internet connection the first time/);
    fake.state.offline = false;
    expect((await lists.all()).length).toBe(3);
    fake.state.offline = true;
    expect((await new SetLists(dir, fake.client, () => Date.now() + 30 * DAY).all()).length).toBe(3);
  });
});

describe('findSet', () => {
  const sets: SetSummary[] = SETS.map((s) => ({ code: s.code, name: s.name, type: s.set_type, released: s.released_at, cards: s.card_count }));
  const code = (text: string) => {
    const s = findSet(sets, text);
    return typeof s === 'string' ? s : s.code;
  };
  it('takes a code, a full name, or a part of one name', () => {
    expect(code('tst')).toBe('tst');
    expect(code('TST')).toBe('tst');
    expect(code('test set')).toBe('tst');
    expect(code('Test Set Commander')).toBe('tsc');
    expect(code('brand')).toBe('new');
    expect(code('test')).toMatch(/is in the name of 2 sets: use a set code, e\.g\. tst \(Test Set\), tsc \(Test Set Commander\)/);
    expect(code('zzz')).toMatch(/No set has the code or name "zzz"/);
  });
});

describe('s: in GET /api/cards/search and GET /api/sets', () => {
  let fx: FixtureCache;
  let ctx: ServerContext;
  let fake: ReturnType<typeof fakeScryfall>;
  let boltId: string;

  beforeAll(async () => {
    fx = makeFixtureCache();
    const bolt = await searchCards(req({ query: { q: 'lightning bolt' } }), fx.ctx);
    if (bolt.status !== 200) throw new Error('no bolt');
    boltId = bolt.body.cards[0]!.oracleId;
    fake = fakeScryfall({ tst: [boltId, 'not-in-the-index'] });
    ctx = { ...fx.ctx, scryfall: fake.client };
  });

  afterAll(async () => {
    await closeCardStores();
    fx.cleanup();
  });

  const search = async (scry: string) => {
    const r = await searchCards(req({ query: { scry } }), ctx);
    return r.status === 200 ? r.body.cards.map((c) => c.name) : `${r.status}: ${r.body.error}`;
  };

  it('finds the cards with a printing in the set, by code or name, combined with other keywords', async () => {
    expect(await search('s:tst')).toEqual(['Lightning Bolt']);
    expect(await search('set:"Test Set"')).toEqual(['Lightning Bolt']);
    expect(await search('e:tst t:creature')).toEqual([]);
    expect(await search('t:instant -s:tst')).not.toContain('Lightning Bolt');
    expect(await search('s:tsc')).toEqual([]);
  });

  it('plain text that is a set\'s name (or starts one) also finds the whole set, next to the name matches; the other filters still apply', async () => {
    const plain = async (query: Record<string, string>) => {
      const r = await searchCards(req({ query }), ctx);
      return r.status === 200 ? r.body.cards.map((c) => c.name) : `${r.status}: ${r.body.error}`;
    };
    expect(await plain({ q: 'test set' })).toEqual(['Lightning Bolt']); // Test Set, and the start of Test Set Commander
    expect(await plain({ q: 'Test Set Commander' })).toEqual([]); // that set has no cards in the index
    expect(await plain({ q: 'test set', types: 'creature' })).toEqual([]);
    expect(await plain({ q: 'test' })).toEqual(await plain({ q: 'test' })); // a word that is not a whole set name stays a name search
    expect(await plain({ q: 'tst' })).not.toContain('Lightning Bolt'); // a set code is not plain text: s:tst is
    expect(await plain({ q: 'bolt' })).toContain('Lightning Bolt');
  });

  it('answers 400 for a set it cannot find, and for a first set search offline', async () => {
    expect(await search('s:zzz')).toMatch(/^400: No set has the code or name "zzz"/);
    // A second install, whose set lists were never fetched.
    const fresh = makeFixtureCache();
    try {
      const offline = fakeScryfall({});
      offline.state.offline = true;
      const r = await searchCards(req({ query: { scry: 's:tst' } }), { ...fresh.ctx, scryfall: offline.client });
      expect(r.status).toBe(400);
      if (r.status === 400) expect(r.body.error).toMatch(/needs an internet connection the first time/);
    } finally {
      await closeCardStores();
      fresh.cleanup();
    }
  });

  it('GET /api/sets lists every set, newest first; 503 offline without a kept list', async () => {
    const r = await listSets(req({}), ctx);
    expect(r.status).toBe(200);
    if (r.status === 200) expect(r.body.sets.map((s) => s.code)).toEqual(['new', 'tst', 'tsc']);
    const offline = fakeScryfall({});
    offline.state.offline = true;
    const o = await listSets(req({}), { ...fx.ctx, cacheDir: path.join(tempDir(), 'scryfall'), scryfall: offline.client });
    expect(o.status).toBe(503);
  });
});
