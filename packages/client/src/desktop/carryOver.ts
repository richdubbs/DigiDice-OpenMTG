/**
 * The desktop app's library carried over to the local server's stores (packages/server src/library/), where the Godot app that replaces the desktop app
 * reads it. Until now the decks, the card pictures, the replays and the settings lived only in this page's browser storage (IndexedDB, localStorage),
 * which the Godot app cannot read.
 *
 * At every start of a page the local server serves (app/nav.tsx), in the background: what the server already has is left alone (a deck it holds at the
 * same or a later time, a picture of the same slot, a replay of the same id), what it lacks is sent; the settings and the look profiles are kept there
 * whole under `desktop` (the Godot app takes them on at its first start). Nothing here is changed or removed. A server without the stores (the hosted
 * web client's, an older one) gets nothing. Never throws: what cannot be sent is logged and tried again at the next start.
 */
import type { LibraryDeck, LibraryDecksResponse, LibraryImagesResponse } from '@openmtg/server/api';
import type { Deck } from '../decks/model';
import type { DeckStore } from '../decks/store';
import type { StoredImage } from '../images/store';
import type { LibraryEntry } from '../replays/library';
import type { ReplayFile } from '@openmtg/engine';

/** The settings and look profiles' keys in localStorage (settings/settings.ts SETTINGS_KEY, profiles/profiles.ts PROFILES_KEY). */
export const CARRIED_KEYS = ['openmtg.settings.v1', 'openmtg.profiles.v1'] as const;

/** What the carrying over needs: this page's stores and its server. */
export interface CarryOverEnv {
  decks: Pick<DeckStore, 'list'>;
  images: { list(): Promise<StoredImage[]> };
  replays: { list(): Promise<LibraryEntry[]>; read(id: string): Promise<{ ok: true; value: ReplayFile } | { ok: false; error: { message: string } }> };
  /** A replay file's bytes as the library keeps them (replays/library.ts `encodeReplay`). */
  encodeReplay(file: ReplayFile): Promise<Uint8Array>;
  storage: Pick<Storage, 'getItem'> | null;
  /** A JSON request to this page's server: the parsed body, or null when it did not answer 2xx. */
  request(path: string, body?: unknown): Promise<unknown>;
  now?: () => Date;
}

export interface CarryOverResult {
  /** False when the server has no stores to carry over to. */
  server: boolean;
  decks: number;
  images: number;
  replays: number;
  settings: boolean;
  failures: string[];
}

/** Base64 of bytes, in pieces small enough for `String.fromCharCode`. */
export function base64Of(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The deck as the server's store keeps it (server library/decks.ts readDeck). */
function libraryDeck(d: Deck): LibraryDeck {
  const entries = (list: readonly { name: string; count: number; oracleId?: string }[] | undefined) =>
    (list ?? []).map((e) => ({ name: e.name, count: e.count, ...(e.oracleId ? { oracleId: e.oracleId } : {}) }));
  return {
    id: d.id,
    name: d.name,
    format: d.format,
    main: entries(d.main),
    sideboard: entries(d.sideboard),
    commander: entries(d.commander),
    companion: entries(d.companion),
    notes: d.notes ?? '',
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    ...(d.cover ? { cover: d.cover } : {}),
  };
}

const jsonOf = (text: string | null): unknown => {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export async function carryOver(env: CarryOverEnv): Promise<CarryOverResult> {
  const out: CarryOverResult = { server: false, decks: 0, images: 0, replays: 0, settings: false, failures: [] };
  const fail = (what: string, e: unknown) => out.failures.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);

  const serverDecks = (await env.request('/api/library/decks').catch(() => null)) as LibraryDecksResponse | null;
  if (!isRecord(serverDecks) || !Array.isArray(serverDecks.decks)) return out;
  out.server = true;

  // Decks: the ones the server lacks, or holds at an earlier time.
  try {
    const held = new Map(serverDecks.decks.map((d) => [d.id, d.updatedAt]));
    for (const deck of await env.decks.list()) {
      const there = held.get(deck.id);
      if (there !== undefined && there >= deck.updatedAt) continue;
      const r = await env.request('/api/library/decks/save', { deck: libraryDeck(deck), expected: there ?? null });
      if (r) out.decks++;
      else out.failures.push(`deck ${deck.name}: the server refused it`);
    }
  } catch (e) {
    fail('decks', e);
  }

  // Card pictures: the slots the server has none for.
  try {
    const listed = (await env.request('/api/library/images')) as LibraryImagesResponse | null;
    const held = new Set((listed?.images ?? []).map((i) => i.key));
    for (const image of await env.images.list()) {
      if (held.has(image.key)) continue;
      const data = base64Of(new Uint8Array(await image.blob.arrayBuffer()));
      const r = await env.request('/api/library/images/add', { key: image.key, card: image.card, label: image.label, fileName: image.fileName, data });
      if (r) out.images++;
      else out.failures.push(`picture ${image.label}: the server refused it`);
    }
  } catch (e) {
    fail('pictures', e);
  }

  // Replays: the ids the server has none of, with their Keep marks.
  try {
    const listed = (await env.request('/api/library/replays')) as { replays?: { id: string }[] } | null;
    const held = new Set((listed?.replays ?? []).map((r) => r.id));
    for (const entry of await env.replays.list()) {
      const id = entry.summary.id;
      if (held.has(id)) continue;
      const read = await env.replays.read(id);
      if (!read.ok) {
        out.failures.push(`replay ${entry.summary.title}: ${read.error.message}`);
        continue;
      }
      const data = base64Of(await env.encodeReplay(read.value));
      const r = await env.request('/api/library/replays/import', { data, ...(entry.keep ? { keep: true } : {}) });
      if (r) out.replays++;
      else out.failures.push(`replay ${entry.summary.title}: the server refused it`);
    }
  } catch (e) {
    fail('replays', e);
  }

  // Settings and look profiles: kept whole under `desktop`, beside whatever else the store holds; sent when they changed.
  try {
    const desktop: Record<string, unknown> = {};
    for (const key of CARRIED_KEYS) desktop[key] = jsonOf(env.storage?.getItem(key) ?? null);
    const current = (await env.request('/api/library/settings')) as { settings?: Record<string, unknown> | null } | null;
    const all = isRecord(current?.settings) ? current.settings : {};
    const before = isRecord(all['desktop']) ? all['desktop'] : null;
    const same = before !== null && CARRIED_KEYS.every((k) => JSON.stringify(before[k] ?? null) === JSON.stringify(desktop[k] ?? null));
    if (!same) {
      const r = await env.request('/api/library/settings', {
        settings: { ...all, desktop: { ...desktop, carriedAt: (env.now?.() ?? new Date()).toISOString() } },
      });
      if (r) out.settings = true;
      else out.failures.push('settings: the server refused them');
    }
  } catch (e) {
    fail('settings', e);
  }
  return out;
}

/** The page's own stores and server (same origin), and the log of what went over. */
export async function carryOverOnStart(): Promise<void> {
  try {
    const [{ defaultDeckStore }, { idbImageStore }, { pageReplays }, { encodeReplay }] = await Promise.all([
      import('../decks/store'), import('../images/store'), import('../replays/env'), import('../replays/library'),
    ]);
    const request = async (path: string, body?: unknown): Promise<unknown> => {
      const r = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return r.ok ? r.json() : null;
    };
    const library = pageReplays().library;
    const result = await carryOver({
      decks: defaultDeckStore(), images: idbImageStore(), replays: library, encodeReplay, request,
      storage: typeof localStorage !== 'undefined' ? localStorage : null,
    });
    if (result.server && (result.decks || result.images || result.replays || result.settings)) {
      console.info(`[OpenMTG] carried over to the new app's storage: ${result.decks} decks, ${result.images} pictures, ${result.replays} replays${result.settings ? ', the settings' : ''}`);
    }
    for (const f of result.failures) console.warn(`[OpenMTG] not carried over yet (tried again at the next start): ${f}`);
  } catch (e) {
    console.error('[OpenMTG] the library could not be carried over', e);
  }
}
