/**
 * Opens the store for the owner's commands (package M13-13: `openmtg-hosted inbox`, and `npm run bug -- replay --hosted`): the same configuration the
 * server reads (`STORE`, `DATA_DIR`, `DATABASE_URL`; config.ts `parseConfig`), with the file store guarded by the server's run lock (lock.ts) and the
 * memory store refused (it holds nothing between processes). Never creates a store: a data directory without one is refused, not made.
 */
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseConfig, type StoreKind } from '../config';
import type { GameStore } from '../store/api';
import { openStore } from '../store/index';
import { liveHolder } from './lock';

export type OpenedStore =
  | { ok: true; store: GameStore; kind: StoreKind; close(): Promise<void> }
  /** `code`: 2 for a configuration problem, 1 for a store that cannot be used now. */
  | { ok: false; code: 1 | 2; problems: string[] };

/** Opens the configured store for reading and changing report statuses. */
export async function openConfiguredStore(env: Readonly<Record<string, string | undefined>>): Promise<OpenedStore> {
  const parsed = parseConfig(env, { cpus: 1 });
  if (!parsed.ok) return { ok: false, code: 2, problems: parsed.errors };
  const { store: kind, dataDir, databaseUrl } = parsed.config;
  if (kind === 'memory') return { ok: false, code: 2, problems: ['STORE=memory holds nothing between processes: set STORE=file (and DATA_DIR) or STORE=postgres (and DATABASE_URL).'] };
  if (kind === 'file') {
    const dir = resolve(dataDir);
    const exists = await stat(join(dir, 'store.json')).then((s) => s.isFile(), () => false);
    if (!exists) return { ok: false, code: 1, problems: [`There is no hosted file store in ${dir} (set DATA_DIR to the server's data directory).`] };
    const holder = await liveHolder(dir);
    if (holder !== null) return { ok: false, code: 1, problems: [`The data directory ${dir} is in use by the server (process ${holder.pid}): stop the server first, or use PostgreSQL (the file store is for development).`] };
  }
  try {
    const store = await openStore({ kind, dataDir: resolve(dataDir), databaseUrl });
    return { ok: true, store, kind, close: () => store.close() };
  } catch (e) {
    return { ok: false, code: 1, problems: [`The ${kind} store cannot be opened: ${e instanceof Error ? e.message : String(e)}`] };
  }
}
