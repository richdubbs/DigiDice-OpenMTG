/**
 * The player's settings as one JSON object in the server's data folder (`<data>/library/settings.json`): what the desktop client keeps in its browser
 * storage, copied over so the Godot app can take it on, and the Godot app's own settings. The server keeps the object as it is sent (any JSON object
 * up to MAX_SETTINGS_BYTES) and does not read it.
 *
 * GET /api/library/settings, POST /api/library/settings.
 */
import path from 'node:path';
import { badRequest, type Handler, type ServerContext } from '../context';
import { libraryDir } from './decks';
import { readJsonFile, serialized, writeAtomic } from './files';

export const MAX_SETTINGS_BYTES = 256 * 1024;

const fileOf = (ctx: ServerContext) => path.join(libraryDir(ctx), 'settings.json');

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export const getLibrarySettings: Handler<'GET /api/library/settings'> = async (_req, ctx) => {
  const saved = await readJsonFile(fileOf(ctx));
  if (!isObject(saved) || !isObject(saved['settings'])) return { status: 200, body: { settings: null, updatedAt: null } };
  return { status: 200, body: { settings: saved['settings'], updatedAt: typeof saved['updatedAt'] === 'string' ? saved['updatedAt'] : null } };
};

export const postLibrarySettings: Handler<'POST /api/library/settings'> = async (req, ctx) => {
  const settings = (req.body as Record<string, unknown> | null)?.['settings'];
  if (!isObject(settings)) return badRequest('Send {"settings": {...}}.');
  const text = JSON.stringify({ settings, updatedAt: new Date().toISOString() }, null, 1);
  if (Buffer.byteLength(text, 'utf8') > MAX_SETTINGS_BYTES) return badRequest(`The settings are larger than ${MAX_SETTINGS_BYTES / 1024} KB.`);
  const updatedAt = (JSON.parse(text) as { updatedAt: string }).updatedAt;
  await serialized(fileOf(ctx), () => writeAtomic(fileOf(ctx), `${text}\n`));
  return { status: 200, body: { updatedAt } };
};
