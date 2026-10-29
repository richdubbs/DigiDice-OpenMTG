/**
 * The player's deck library in the server's data folder (`<data>/library/decks/<id>.json`, one file per deck), for the Godot app and for decks copied
 * over from the desktop client's browser storage. Same record and same conflict rule as the desktop client's store (client/src/decks/store.ts): a save
 * may name the version it replaces (`expected`, the stored `updatedAt`; null: the deck must not exist yet), and a save against another version writes
 * nothing and answers 409 with the stored deck.
 *
 * GET /api/library/decks, GET /api/library/decks/:id, POST /api/library/decks/save, POST /api/library/decks/delete.
 */
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { DeckEntry, LibraryDeck } from '../api';
import { badRequest, type Handler, type ServerContext } from '../context';
import { readJsonFile, serialized, writeAtomic } from './files';

/** A deck id: letters, digits, `-` and `_` (the desktop client's UUIDs and `deck-…` ids), at most 64. It is the file's name. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_NAME = 200;
const MAX_FORMAT = 40;
const MAX_NOTES = 20_000;
const MAX_ENTRIES = 1000;
const MAX_COUNT = 9999;
const MAX_DATE = 40;
const SECTIONS = ['main', 'sideboard', 'commander', 'companion'] as const;

/** The folder of the deck files. */
export function decksDir(ctx: ServerContext): string {
  return path.join(libraryDir(ctx), 'decks');
}

/** The library folder: the context's, else `library` next to the card cache. */
export function libraryDir(ctx: ServerContext): string {
  return ctx.libraryDir ?? path.join(path.dirname(ctx.cacheDir), 'library');
}

export function isDeckId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

function entries(v: unknown): DeckEntry[] | string {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return 'is not a list';
  if (v.length > MAX_ENTRIES) return `has more than ${MAX_ENTRIES} entries`;
  const out: DeckEntry[] = [];
  for (const e of v as unknown[]) {
    const r = e as Record<string, unknown> | null;
    if (!r || typeof r !== 'object' || !text(r['name'], MAX_NAME) || r['name'] === '') return 'has an entry without a card name';
    const count = r['count'];
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_COUNT) return `has a count that is not a whole number from 1 to ${MAX_COUNT}`;
    const oracleId = r['oracleId'];
    if (oracleId !== undefined && !text(oracleId, 64)) return 'has an Oracle id that is not text';
    out.push({ name: r['name'], count, ...(typeof oracleId === 'string' && oracleId !== '' ? { oracleId } : {}) });
  }
  return out;
}

/**
 * The deck in `v` with only the record's fields (others are dropped; missing sections and notes are empty), or what is wrong with it. Stored files are
 * read through it too, so a file edited by hand into something else is skipped, not served.
 */
export function readDeck(v: unknown): LibraryDeck | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'The deck is not an object.';
  const d = v as Record<string, unknown>;
  if (!isDeckId(d['id'])) return 'The deck id must be 1 to 64 letters, digits, "-" or "_".';
  if (!text(d['name'], MAX_NAME)) return `The deck name must be text of at most ${MAX_NAME} characters.`;
  if (!text(d['format'], MAX_FORMAT)) return `The format must be text of at most ${MAX_FORMAT} characters.`;
  if (d['notes'] !== undefined && !text(d['notes'], MAX_NOTES)) return `The notes must be text of at most ${MAX_NOTES} characters.`;
  if (!text(d['createdAt'], MAX_DATE) || !text(d['updatedAt'], MAX_DATE)) return 'createdAt and updatedAt must be dates (ISO text).';
  if (d['cover'] !== undefined && !text(d['cover'], MAX_NAME)) return 'The cover must be a card name.';
  const sections = {} as Record<(typeof SECTIONS)[number], DeckEntry[]>;
  for (const s of SECTIONS) {
    const list = entries(d[s]);
    if (typeof list === 'string') return `The ${s} section ${list}.`;
    sections[s] = list;
  }
  return {
    id: d['id'],
    name: d['name'],
    format: d['format'],
    main: sections.main,
    sideboard: sections.sideboard,
    commander: sections.commander,
    companion: sections.companion,
    notes: typeof d['notes'] === 'string' ? d['notes'] : '',
    createdAt: d['createdAt'],
    updatedAt: d['updatedAt'],
    ...(typeof d['cover'] === 'string' && d['cover'] !== '' ? { cover: d['cover'] } : {}),
  };
}

/** Newest first, then by name (the desktop client's order). */
export function sortDecks(decks: LibraryDeck[]): LibraryDeck[] {
  return [...decks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));
}

const fileOf = (ctx: ServerContext, id: string) => path.join(decksDir(ctx), `${id}.json`);

async function stored(ctx: ServerContext, id: string): Promise<LibraryDeck | undefined> {
  const d = readDeck(await readJsonFile(fileOf(ctx, id)));
  return typeof d === 'string' || d.id !== id ? undefined : d;
}

/** Every stored deck that reads as a deck. */
export async function listDecks(ctx: ServerContext): Promise<LibraryDeck[]> {
  let names: string[];
  try {
    names = await readdir(decksDir(ctx));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const decks = await Promise.all(names.filter((n) => n.endsWith('.json')).map((n) => stored(ctx, n.slice(0, -'.json'.length))));
  return sortDecks(decks.filter((d): d is LibraryDeck => d !== undefined));
}

export type SaveOutcome = { ok: true; deck: LibraryDeck } | { ok: false; stored: LibraryDeck | undefined };

/** Save `deck` unless `expected` names another version than the stored one (see the file comment). */
export function saveDeck(ctx: ServerContext, deck: LibraryDeck, expected?: string | null): Promise<SaveOutcome> {
  const file = fileOf(ctx, deck.id);
  return serialized(file, async () => {
    if (expected !== undefined) {
      const now = await stored(ctx, deck.id);
      if (expected === null ? now !== undefined : now?.updatedAt !== expected) return { ok: false, stored: now };
    }
    await writeAtomic(file, `${JSON.stringify(deck, null, 1)}\n`);
    return { ok: true, deck };
  });
}

/** Delete a deck; false when there was none. */
export function deleteDeck(ctx: ServerContext, id: string): Promise<boolean> {
  const file = fileOf(ctx, id);
  return serialized(file, async () => {
    const existed = (await readJsonFile(file)) !== undefined;
    await rm(file, { force: true });
    return existed;
  });
}

export const getLibraryDecks: Handler<'GET /api/library/decks'> = async (_req, ctx) => ({ status: 200, body: { decks: await listDecks(ctx) } });

export const getLibraryDeck: Handler<'GET /api/library/decks/:id'> = async (req, ctx) => {
  const id = req.params['id'];
  if (!isDeckId(id)) return badRequest('Invalid deck id.');
  const deck = await stored(ctx, id);
  return deck ? { status: 200, body: { deck } } : { status: 404, body: { error: 'There is no deck with this id.' } };
};

export const postLibraryDeckSave: Handler<'POST /api/library/decks/save'> = async (req, ctx) => {
  const body = req.body as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return badRequest('Send {"deck": {...}, "expected": "<updatedAt>" | null}.');
  const deck = readDeck(body['deck']);
  if (typeof deck === 'string') return badRequest(deck);
  const expected = body['expected'];
  if (expected !== undefined && expected !== null && !text(expected, MAX_DATE)) return badRequest('expected must be the updatedAt of the stored version, or null.');
  const r = await saveDeck(ctx, deck, expected as string | null | undefined);
  if (r.ok) return { status: 200, body: { deck: r.deck } };
  return { status: 409, body: { error: 'This deck was changed somewhere else.', code: 'deckConflict', ...(r.stored ? { stored: r.stored } : {}) } };
};

export const postLibraryDeckDelete: Handler<'POST /api/library/decks/delete'> = async (req, ctx) => {
  const id = (req.body as Record<string, unknown> | null)?.['id'];
  if (!isDeckId(id)) return badRequest('Send {"id": "<deck id>"}.');
  return { status: 200, body: { deleted: await deleteDeck(ctx, id) } };
};
