/**
 * desktop/carryOver.ts against a real local server (its library stores in a fresh folder): the desktop app's decks, card pictures, replays and settings
 * go over once, what the server already has stays as it is, and a server without the stores gets nothing.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '@openmtg/server';
import { carryOver, CARRIED_KEYS, type CarryOverEnv } from '../src/desktop/carryOver';
import type { Deck } from '../src/decks/model';
import { MemoryDeckStore } from '../src/decks/store';
import type { StoredImage } from '../src/images/store';
import { encodeReplay, type LibraryEntry } from '../src/replays/library';
import { aiGame, replayFileOf } from './connection/replay-files';

// A 1x1 PNG.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

let server: RunningServer;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'openmtg-carry-'));
  server = await startServer({ port: 0, clientDist: null, cacheDir: path.join(dir, 'scryfall'), version: '9.9.9', online: false, table: false, sounds: false } as never);
}, 30_000);

afterAll(async () => {
  await server?.close();
  rmSync(dir, { recursive: true, force: true });
});

const request = async (p: string, body?: unknown): Promise<unknown> => {
  const r = await fetch(`${server.url}${p}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return r.ok ? r.json() : null;
};

const deck = (id: string, name: string, updatedAt: string): Deck => ({
  id, name, format: 'casual', main: [{ name: 'Forest', count: 20 }, { name: 'Grizzly Bears', count: 20 }], sideboard: [], commander: [], companion: [],
  notes: 'kept', createdAt: '2026-10-01T00:00:00.000Z', updatedAt,
});

describe('the desktop library carried over to the local server', () => {
  it('sends what the server lacks once, keeps what it has, and sends a deck again once it changed', async () => {
    const decks = new MemoryDeckStore();
    await decks.put(deck('d-one', 'Green stompy', '2026-10-20T10:00:00.000Z'));
    await decks.put(deck('d-two', 'Old deck', '2026-10-10T10:00:00.000Z'));
    // The server already holds a later version of d-two (changed in the new app): it stays.
    expect(await request('/api/library/decks/save', { deck: { ...deck('d-two', 'Changed in the new app', '2026-10-25T10:00:00.000Z') }, expected: null })).toBeTruthy();
    const picture: StoredImage = {
      key: 'slot:grizzly', card: 'Grizzly Bears', label: 'Grizzly Bears', fileName: 'bears.png', type: 'image/png', size: PNG.length, addedAt: 1,
      blob: { arrayBuffer: async () => PNG.buffer.slice(0) } as unknown as Blob,
    };
    // A library id as the client makes them (replays/file.ts newReplayId).
    const file = { ...replayFileOf(aiGame('carry-over')), id: 'r-0123456789abcdef0123' };
    const entry = { summary: { id: file.id, title: file.title }, keep: true } as unknown as LibraryEntry;
    const local = new Map<string, string>([[CARRIED_KEYS[0], JSON.stringify({ animationSpeed: 'fast', playerNames: ['Ann', 'Bo', 'Cy', 'Di'] })]]);
    const env: CarryOverEnv = {
      decks, images: { list: async () => [picture] },
      replays: { list: async () => [entry], read: async () => ({ ok: true, value: file }) },
      encodeReplay, request, storage: { getItem: (k) => local.get(k) ?? null }, now: () => new Date('2026-10-29T12:00:00.000Z'),
    };

    const first = await carryOver(env);
    expect(first).toEqual({ server: true, decks: 1, images: 1, replays: 1, settings: true, failures: [] });
    const held = (await request('/api/library/decks')) as { decks: Deck[] };
    expect(held.decks.map((d) => [d.id, d.name]).sort()).toEqual([['d-one', 'Green stompy'], ['d-two', 'Changed in the new app']]);
    expect(held.decks.find((d) => d.id === 'd-one')).toMatchObject({ notes: 'kept', main: [{ name: 'Forest', count: 20 }, { name: 'Grizzly Bears', count: 20 }] });
    expect(((await request('/api/library/images')) as { images: { key: string; size: number }[] }).images).toMatchObject([{ key: 'slot:grizzly', size: PNG.length }]);
    const replays = ((await request('/api/library/replays')) as { replays: { id: string; keep: boolean; title: string }[] }).replays;
    expect(replays).toMatchObject([{ id: file.id, keep: true, title: file.title }]);
    const settings = ((await request('/api/library/settings')) as { settings: { desktop: Record<string, unknown> } }).settings;
    expect(settings.desktop).toEqual({ [CARRIED_KEYS[0]]: { animationSpeed: 'fast', playerNames: ['Ann', 'Bo', 'Cy', 'Di'] }, [CARRIED_KEYS[1]]: null, carriedAt: '2026-10-29T12:00:00.000Z' });

    // Again: nothing to send.
    expect(await carryOver(env)).toEqual({ server: true, decks: 0, images: 0, replays: 0, settings: false, failures: [] });

    // A deck changed on this side goes over again; a setting changed too.
    await decks.put(deck('d-one', 'Green stompy, tuned', '2026-10-28T10:00:00.000Z'));
    local.set(CARRIED_KEYS[0], JSON.stringify({ animationSpeed: 'slow' }));
    expect(await carryOver(env)).toMatchObject({ decks: 1, images: 0, replays: 0, settings: true });
    expect(((await request('/api/library/decks')) as { decks: Deck[] }).decks.find((d) => d.id === 'd-one')?.name).toBe('Green stompy, tuned');
  }, 120_000);

  it('a server without the library stores gets nothing', async () => {
    const calls: string[] = [];
    const result = await carryOver({
      decks: new MemoryDeckStore(), images: { list: async () => [] }, replays: { list: async () => [], read: async () => ({ ok: false, error: { message: 'none' } }) },
      encodeReplay, storage: null, request: async (p) => (calls.push(p), null),
    });
    expect(result).toEqual({ server: false, decks: 0, images: 0, replays: 0, settings: false, failures: [] });
    expect(calls).toEqual(['/api/library/decks']);
  });
});
