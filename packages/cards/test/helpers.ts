/** Test helpers: fake clock, mocked fetch, temp dirs, synthetic cards. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach } from 'vitest';
import type { OracleCard } from '@openmtg/engine';
import { rebuildIndex } from '../src/bulk';
import { ScryfallClient, type Clock } from '../src/http';
import { looseName } from '../src/normalize';
import { cacheFiles } from '../src/paths';

export interface FakeClock extends Clock {
  t: number;
  sleeps: number[];
}

export function fakeClock(start = Date.parse('2026-10-11T12:00:00Z')): FakeClock {
  const c: FakeClock = {
    t: start,
    sleeps: [],
    now: () => c.t,
    sleep: async (ms) => {
      c.sleeps.push(ms);
      c.t += ms;
    },
  };
  return c;
}

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  at: number;
}

export type Handler = (call: RecordedCall) => Response | Promise<Response>;

export function mockFetch(clock: Clock, handler: Handler): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fn = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const call: RecordedCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      at: clock.now(),
    };
    if (typeof init?.body === 'string') call.body = init.body;
    calls.push(call);
    return handler(call);
  };
  return { fetch: fn as unknown as typeof fetch, calls };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function clientWith(handler: Handler, clock: Clock = fakeClock()) {
  const m = mockFetch(clock, handler);
  return { client: new ScryfallClient({ fetch: m.fetch, clock }), calls: m.calls, clock };
}

const dirs: string[] = [];
export async function tempDir(): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), 'openmtg-cards-test-'));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

export function card(name: string, extra: Partial<OracleCard> = {}): OracleCard {
  return { name, layout: 'normal', type_line: 'Creature — Test', oracle_text: '', ...extra };
}

/** A raw Scryfall-style bulk object (with fields the trimmer must drop). */
export function rawCard(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: 'card',
    id: `id-${name}`,
    oracle_id: `oid-${name}`,
    name,
    layout: 'normal',
    mana_cost: '{1}{R}',
    cmc: 2,
    type_line: 'Instant',
    oracle_text: 'Do a thing.',
    colors: ['R'],
    color_identity: ['R'],
    keywords: [],
    legalities: { standard: 'legal' },
    prices: { usd: '1.00' },
    artist: 'Someone',
    flavor_text: 'Flavor.',
    set: 'xyz',
    set_type: 'expansion',
    border_color: 'black',
    image_uris: { small: 'https://cards.scryfall.io/small/x.jpg', normal: 'https://cards.scryfall.io/normal/x.jpg', large: 'https://cards.scryfall.io/large/x.jpg' },
    ...extra,
  };
}

/** Write a gzip JSONL bulk file plus index files into `dir`, as after a `refresh` (no network). */
export async function makeCache(dir: string, raws: Array<Record<string, unknown>>): Promise<void> {
  const files = cacheFiles(dir);
  await mkdir(dir, { recursive: true });
  await writeFile(files.bulkJsonlGz, gzipSync(`${raws.map((r) => JSON.stringify(r)).join('\n')}\n`));
  await rebuildIndex(files, {
    type: 'oracle_cards',
    updated_at: '2026-01-01T00:00:00Z',
    downloaded_at: '2026-01-01T00:00:00Z',
    source_uri: 'x',
    format: 'jsonl.gz',
    size: 1,
    file: path.basename(files.bulkJsonlGz),
  });
}

/** A fake /cards/collection that matches names the way Scryfall does (ignoring punctuation, case and diacritics) and reports the rest in not_found. */
export function scryfallCollection(cards: Array<Record<string, unknown>>) {
  return (c: RecordedCall): Response => {
    const ids = (JSON.parse(c.body ?? '{}') as { identifiers: Array<{ name: string }> }).identifiers;
    const data: unknown[] = [];
    const not_found: unknown[] = [];
    for (const { name } of ids) {
      const want = looseName(name);
      const hit = cards.find((r) => looseName(String(r.name)) === want || ((r.card_faces as Array<{ name: string }> | undefined) ?? []).some((f) => looseName(f.name) === want));
      if (hit) data.push(hit);
      else not_found.push({ name });
    }
    return json({ object: 'list', not_found, data });
  };
}
