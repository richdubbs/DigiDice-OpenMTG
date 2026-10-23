/**
 * UPD1: GET/POST /api/update, the Update button's server side (docs/design/updates.md "Two sources, one button"). Every download goes to a fake fetch:
 * a fake Scryfall (bulk-data list and a gzipped Oracle file) and a fake pack host (manifest and pack). Nothing here reaches the network.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { ScryfallClient, type Clock } from '@openmtg/cards';
import { ABILITY_MODEL_VERSION } from '@openmtg/engine';
import type { UpdateStatusResponse } from '../src/api';
import { cardStore, closeCardStores } from '../src/cache';
import type { ServerContext, UpdateIo } from '../src/context';
import { matchRoute } from '../src/routes';
import { getStatus } from '../src/status';
import { clearUpdates, getUpdate, postUpdate, updateFinished } from '../src/update';
import { makeFixtureCache, req, type FixtureCache } from './fixture-cache';

const BULK_LIST = 'https://api.scryfall.com/bulk-data';
const FILE_URL = 'https://data.scryfall.io/oracle-cards/oracle-cards-upd1.jsonl.gz';
const MANIFEST_URL = 'https://packs.example.invalid/openmtg/openmtg-rules-pack.manifest.json';
const PACK_URL = 'https://packs.example.invalid/openmtg/openmtg-rules-pack.json';
const PACK_VERSION = '2026.10.13-1';
const NEW_CARD = 'Upd Test Spark';

/** A made-up card (not a Wizards card): the "new set" the fake Scryfall adds. */
const newCard = {
  object: 'card', id: 'id-upd1-spark', oracle_id: 'oid-upd1-spark', name: NEW_CARD, layout: 'normal', mana_cost: '{R}', cmc: 1, type_line: 'Instant',
  oracle_text: `${NEW_CARD} deals 2 damage to any target.`, colors: ['R'], color_identity: ['R'], keywords: [], legalities: { modern: 'legal' },
};

function fakeClock(start = Date.parse('2026-10-13T12:00:00Z')): Clock & { t: number } {
  const c = { t: start, now: () => c.t, sleep: async (ms: number) => void (c.t += ms) };
  return c;
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The fake Scryfall: the fixture's cards plus one new card, with `updated_at` from `state`. */
function fakeScryfall(fx: FixtureCache, state = { updatedAt: '2026-10-13T09:00:00Z' }, cards: readonly object[] = [...fx.cards, newCard]) {
  const calls: string[] = [];
  const bulk = gzipSync(`${cards.map((c) => JSON.stringify(c)).join('\n')}\n`);
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url === BULK_LIST) return json({ data: [{ type: 'oracle_cards', updated_at: state.updatedAt, jsonl_download_uri: FILE_URL }] });
    if (url === FILE_URL) return new Response(bulk);
    return json({ code: 'not_found' }, 404);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function packBytes(): Uint8Array {
  const pack = {
    format: 'openmtg-rules-pack', formatVersion: 1, packVersion: PACK_VERSION, minEngineVersion: '0.5.0', modelVersion: ABILITY_MODEL_VERSION,
    createdAt: '2026-10-13T00:00:00Z', keywords: [], templates: [], cards: {}, requiresEngine: {},
  };
  return new TextEncoder().encode(JSON.stringify(pack));
}

/** The fake pack host: a manifest and the pack it names. `tamper` serves a pack that does not match the manifest's SHA-256. */
function fakePackHost(opts: { tamper?: boolean } = {}) {
  const calls: string[] = [];
  const bytes = packBytes();
  const manifest = {
    format: 'openmtg-rules-pack-manifest', formatVersion: 1, packVersion: PACK_VERSION, file: 'openmtg-rules-pack.json',
    sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length,
  };
  const served = opts.tamper ? new TextEncoder().encode(new TextDecoder().decode(bytes).replace('"cards":{}', '"cards":[]')) : bytes;
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url === MANIFEST_URL) return json(manifest);
    if (url === PACK_URL) return new Response(served, { headers: { 'Content-Type': 'application/json' } });
    return json({ error: 'not found' }, 404);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const offlineFetch = (async () => {
  throw new TypeError('fetch failed');
}) as typeof globalThis.fetch;

const fixtures: FixtureCache[] = [];

type Scry = ReturnType<typeof fakeScryfall>;

/** A fixture cache and a context over it; `scryfall: true` serves the fake Scryfall (its calls in `scry`), otherwise every Scryfall request fails. */
function setup(
  opts: { packUrl?: string | null; scryfall?: boolean | readonly object[]; pack?: typeof fetch; clock?: Clock; emptyCache?: boolean; sliceMs?: number } = {},
): { fx: FixtureCache; ctx: ServerContext; scry: Scry | null } {
  const fx = makeFixtureCache();
  fixtures.push(fx);
  const clock = opts.clock ?? fakeClock();
  const scry = opts.scryfall ? fakeScryfall(fx, undefined, Array.isArray(opts.scryfall) ? opts.scryfall : undefined) : null;
  const io: UpdateIo = {
    scryfall: new ScryfallClient({ fetch: scry?.fetch ?? offlineFetch, clock }),
    clock,
    packFetch: opts.pack ?? offlineFetch,
    now: () => new Date(clock.now()),
    ...(opts.sliceMs !== undefined ? { sliceMs: opts.sliceMs } : {}),
  };
  // emptyCache: a fresh install (no card data downloaded yet), exactly when a player first clicks "Check for updates"
  const cacheDir = opts.emptyCache ? path.join(fx.dir, 'fresh-install', 'scryfall') : fx.ctx.cacheDir;
  if (opts.emptyCache) mkdirSync(cacheDir, { recursive: true });
  return { fx, scry, ctx: { ...fx.ctx, cacheDir, packUrl: opts.packUrl === undefined ? MANIFEST_URL : opts.packUrl, updateIo: io } };
}

async function get(ctx: ServerContext): Promise<UpdateStatusResponse> {
  const r = await getUpdate(req(), ctx);
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  return r.body;
}

/** POST, wait for the background update, then GET. */
async function update(ctx: ServerContext): Promise<UpdateStatusResponse> {
  const r = await postUpdate(req({ body: {} }), ctx);
  expect(r.status).toBe(200);
  await updateFinished(ctx);
  return get(ctx);
}

afterEach(async () => {
  await closeCardStores();
  clearUpdates();
  for (const fx of fixtures.splice(0)) fx.cleanup();
});

describe('the update routes', () => {
  it('are in the route table: GET reports, POST starts', () => {
    expect(matchRoute('GET', '/api/update')).toMatchObject({ kind: 'found', key: 'GET /api/update' });
    expect(matchRoute('POST', '/api/update')).toMatchObject({ kind: 'found', key: 'POST /api/update' });
  });

  it('GET before any update: no job; says whether the pack part is configured', async () => {
    expect(await get(setup({ packUrl: null }).ctx)).toEqual({ packConfigured: false, packUrl: null, job: null });
    expect(await get(setup().ctx)).toEqual({ packConfigured: true, packUrl: MANIFEST_URL, job: null });
  });

  it('POST takes only an empty object', async () => {
    const { ctx } = setup();
    for (const body of [{ force: true }, [], 'x', null]) expect((await postUpdate(req({ body }), ctx)).status).toBe(400);
    expect((await get(ctx)).job).toBeNull();
  });
});

describe('POST /api/update runs the update CLI flow (fake network)', () => {
  it('refreshes the card data, installs the verified pack and reports cards added, templates and coverage before and after', async () => {
    const pack = fakePackHost();
    const { fx, ctx, scry } = setup({ scryfall: true, pack: pack.fetch });
    // the classification index of the old card data is built: that is the coverage "before"
    const opened = await cardStore(ctx);
    if (!opened.ok) throw new Error('no store');
    await opened.store.automation.start();
    const before = opened.store.automation.counts()!;
    expect(before.total).toBe(fx.deckCards.length);

    const s = await update(ctx);
    const job = s.job!;
    expect(job.state).toBe('done');
    expect(job.phase).toBeNull();
    expect(job.finishedAt).not.toBeNull();
    const r = job.result!;
    expect(r.outcome).toBe('updated');
    expect(r.offline).toBe(false);
    expect(r.cardData.state).toBe('refreshed');
    expect(r.cardsAdded).toBe(1);
    expect(r.newCards).toEqual([NEW_CARD]);
    expect(r.pack).toEqual({ state: 'installed', version: PACK_VERSION, entries: 0, rejected: 0, verified: true });
    expect(r.templates).toEqual({ before: 0, after: 0, added: 0 });
    expect(r.coverage.before).toEqual(before);
    expect(r.delta.newlyAutomated + r.delta.stillManual).toBeGreaterThanOrEqual(0);
    expect(r.needsNewer).toEqual({ count: 0, names: [] });
    expect(job.log.some((l) => l.startsWith(`Rules pack ${PACK_VERSION} installed (SHA-256 verified`))).toBe(true);
    expect(job.log.some((l) => l.startsWith('New cards known: 1'))).toBe(true);
    expect(scry!.calls).toEqual([BULK_LIST, FILE_URL]);
    expect(pack.calls).toEqual([MANIFEST_URL, PACK_URL]);

    // the API now serves the new card data; the coverage "after" arrives once its classification index is built
    const now = await cardStore(ctx);
    if (!now.ok) throw new Error('no store');
    expect(now.store.cards.some((c) => c.name === NEW_CARD)).toBe(true);
    await now.store.automation.start();
    const after = (await get(ctx)).job!.result!.coverage;
    expect(after.afterPending).toBe(false);
    expect(after.after?.total).toBe(before.total + 1);

    // About: the installed pack's version
    const status = await getStatus(req(), ctx);
    expect(status.status === 200 && status.body.rulesPack).toBe(PACK_VERSION);
  }, 120_000);

  it('a first update on an empty card cache (every card is new) keeps the server answering while it compiles the summary', async () => {
    // UPD1 review: on a fresh install every downloaded card is "new", so the summary compiles the whole pool; that must not block the server's event
    // loop (the API, the client's progress polling and online play share it). Made-up cards, not Wizards cards.
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...newCard, id: `id-upd1-spark-${i}`, oracle_id: `oid-upd1-spark-${i}`, name: `${NEW_CARD} ${i}`, oracle_text: `${NEW_CARD} ${i} deals 2 damage to any target.`,
    }));
    const { ctx } = setup({ packUrl: null, scryfall: many, emptyCache: true, sliceMs: 0 });
    expect((await getStatus(req(), ctx)).status).toBe(200);
    expect((await postUpdate(req({ body: {} }), ctx)).status).toBe(200);
    // GET /api/update (the panel's polling) once per turn of the event loop: it answers between the compile's slices. GET /api/status reads files
    // (thread pool I/O, its timing varies with the machine's load), so it runs back to back alongside (one at a time, as a client would ask), and its
    // answers are counted and checked, not timed. It reads bulk-meta.json while the refresh replaces it (Windows: fsutil.ts renameRetrying).
    let answeredMidCompile = 0;
    let last = 0;
    let statusAnswers = 0;
    let polling = true;
    const statusPoll = (async () => {
      while (polling) {
        expect((await getStatus(req(), ctx)).status).toBe(200);
        statusAnswers++;
      }
    })();
    for (;;) {
      const job = (await get(ctx)).job!;
      if (job.state !== 'running') break;
      const p = job.progress;
      if (job.phase === 'compile' && p && p.done > 0 && p.done < p.total) {
        expect(p.total).toBe(many.length);
        expect(p.done).toBeGreaterThanOrEqual(last);
        last = p.done;
        answeredMidCompile++;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    await updateFinished(ctx);
    polling = false;
    await statusPoll;
    expect(answeredMidCompile).toBeGreaterThan(many.length / 2);
    expect(statusAnswers).toBeGreaterThan(0);
    const job = (await get(ctx)).job!;
    expect(job.state).toBe('done');
    expect(job.progress).toBeNull();
    const r = job.result!;
    expect(r.outcome).toBe('updated');
    expect(r.cardsAdded).toBe(many.length);
    expect(r.coverage.before).toBeNull();
    expect(r.delta.newlyAutomated + r.delta.lessAutomated).toBe(0); // no pack: the same sources before and after
  }, 60_000);

  it('answers 409 while an update runs', async () => {
    const { ctx } = setup({ packUrl: null });
    const first = await postUpdate(req({ body: {} }), ctx);
    expect(first.status).toBe(200);
    if (first.status === 200) expect(first.body.job?.state).toBe('running');
    const second = await postUpdate(req({ body: {} }), ctx);
    expect(second).toEqual({ status: 409, body: { error: 'An update is already running.', code: 'updateRunning' } });
    await updateFinished(ctx);
    expect((await get(ctx)).job?.id).toBe(first.status === 200 ? first.body.job?.id : -1);
  });

  it('without a pack URL refreshes the card data only, and a second check within 24 h is "already current"', async () => {
    const clock = fakeClock();
    const { ctx, scry } = setup({ packUrl: null, scryfall: true, clock });
    const first = (await update(ctx)).job!.result!;
    expect(first.outcome).toBe('updated');
    expect(first.pack).toEqual({ state: 'notConfigured', installed: null });
    clock.t += 3600_000;
    const second = (await update(ctx)).job!.result!;
    expect(second.outcome).toBe('current');
    expect(second.cardData.state).toBe('current');
    expect(second.cardsAdded).toBe(0);
    expect(scry!.calls).toEqual([BULK_LIST, FILE_URL]); // the 24 h rule: no second request at all
  });

  it('offline: nothing downloads, the local card data is unchanged, and the result says so', async () => {
    const { fx, ctx } = setup();
    const cardsFile = path.join(fx.ctx.cacheDir, 'cards.jsonl');
    const beforeText = readFileSync(cardsFile, 'utf8');
    const r = (await update(ctx)).job!.result!;
    expect(r.outcome).toBe('failed');
    expect(r.offline).toBe(true);
    expect(r.cardData).toEqual({ state: 'failed', detail: 'fetch failed' });
    expect(r.pack.state).toBe('failed');
    if (r.pack.state === 'failed') {
      expect(r.pack.error).toContain('fetch failed');
      expect(r.pack.kept).toBeNull();
    }
    expect(readFileSync(cardsFile, 'utf8')).toBe(beforeText);
    const status = await getStatus(req(), ctx);
    expect(status.status === 200 && status.body.rulesPack).toBeNull();
  });

  it('a pack that does not match its manifest is not installed; the card refresh still counts (partial)', async () => {
    const { ctx } = setup({ scryfall: true, pack: fakePackHost({ tamper: true }).fetch });
    const r = (await update(ctx)).job!.result!;
    expect(r.outcome).toBe('partial');
    expect(r.offline).toBe(false);
    expect(r.cardData.state).toBe('refreshed');
    expect(r.pack.state).toBe('failed');
    if (r.pack.state === 'failed') expect(r.pack.error).toMatch(/SHA-256|bytes/);
    const status = await getStatus(req(), ctx);
    expect(status.status === 200 && status.body.rulesPack).toBeNull();
  });

  it('a pack host that answers HTTP 404 is a failure, not "offline"', async () => {
    const host = (async () => json({ error: 'nope' }, 404)) as typeof fetch;
    const { ctx } = setup({ pack: host });
    const r = (await update(ctx)).job!.result!;
    expect(r.outcome).toBe('failed');
    expect(r.offline).toBe(false);
    if (r.pack.state === 'failed') expect(r.pack.error).toContain('HTTP 404');
  });
});
