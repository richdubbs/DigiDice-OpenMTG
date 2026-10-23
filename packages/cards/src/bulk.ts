/**
 * Oracle Cards bulk data: discover the file via GET /bulk-data, download it into the cache,
 * remember its metadata, and rebuild the local index.
 *
 * Refresh policy (Scryfall asks for >= 24 h caching; gameplay data changes rarely):
 * download only if Scryfall's updated_at is newer than what we have AND our last download is
 * older than 24 h, unless forced. Within 24 h of the last download no request is made at all.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { ACCEPT_GZIP, ACCEPT_JSON, API_HOST, systemClock, type Clock, type ScryfallClient } from './http';
import { buildIndexData, bulkLines, INDEX_SCHEMA, indexFilesExist, writeIndexFiles, type BulkFormat, type IndexOptions, type IndexStats } from './index-store';
import { fileExists, fileSize, readJsonIfExists, writeFileAtomic } from './fsutil';
import { cacheFiles, type CacheFiles } from './paths';

export const BULK_LIST_URL = `https://${API_HOST}/bulk-data`;
export const REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000;

/** One entry of GET /bulk-data. */
export interface BulkEntry {
  object?: string;
  id?: string;
  type: string;
  name?: string;
  updated_at: string;
  uri?: string;
  /** Current API: gzip JSONL. */
  jsonl_download_uri?: string;
  /** Old API (removed 2026-07-20): plain JSON array. Supported as a fallback. */
  download_uri?: string;
  compressed_size?: number;
  size?: number;
}

export interface BulkMeta {
  type: 'oracle_cards';
  /** Scryfall's updated_at for the file we hold. */
  updated_at: string;
  /** When we downloaded it (ISO). */
  downloaded_at: string;
  source_uri: string;
  format: BulkFormat;
  /** Bytes of the file on disk (gzip size for jsonl.gz). */
  size: number;
  file: string;
  index?: IndexStats & { built_at: string; aliasCount?: number };
}

export type RefreshAction = 'downloaded' | 'skipped' | 'rebuilt';
export interface RefreshResult {
  action: RefreshAction;
  reason: string;
  meta: BulkMeta;
}

export function pickOracleEntry(list: { data?: BulkEntry[] }): BulkEntry {
  const entry = list.data?.find((e) => e.type === 'oracle_cards');
  if (!entry) throw new Error('Scryfall /bulk-data has no entry with type "oracle_cards"');
  return entry;
}

/** No network needed to decide to skip: a download exists and is younger than 24 h. */
export function canSkipWithoutNetwork(meta: BulkMeta | undefined, nowMs: number, force: boolean, filesPresent: boolean): boolean {
  if (force || !meta || !filesPresent) return false;
  const downloaded = Date.parse(meta.downloaded_at);
  return Number.isFinite(downloaded) && nowMs - downloaded < REFRESH_WINDOW_MS;
}

/** Decide after seeing Scryfall's updated_at. */
export function shouldDownload(meta: BulkMeta | undefined, remoteUpdatedAt: string, nowMs: number, force: boolean, filesPresent: boolean): { download: boolean; reason: string } {
  if (force) return { download: true, reason: 'forced' };
  if (!meta || !filesPresent) return { download: true, reason: 'no local copy' };
  const remote = Date.parse(remoteUpdatedAt);
  const local = Date.parse(meta.updated_at);
  const downloaded = Date.parse(meta.downloaded_at);
  const newer = !Number.isFinite(local) || (Number.isFinite(remote) && remote > local);
  if (!newer) return { download: false, reason: `up to date (Scryfall updated_at ${meta.updated_at})` };
  const old = !Number.isFinite(downloaded) || nowMs - downloaded >= REFRESH_WINDOW_MS;
  if (!old) return { download: false, reason: 'newer data exists but the last download is less than 24 h old' };
  return { download: true, reason: `Scryfall has newer data (${remoteUpdatedAt} > ${meta.updated_at})` };
}

export interface RefreshOptions {
  client: ScryfallClient;
  cacheDir: string;
  force?: boolean;
  clock?: Clock;
  log?: (message: string) => void;
  /** Index options (WP24). An index on disk built with other options is rebuilt from the bulk file already downloaded (no network). */
  index?: IndexOptions;
}

/**
 * Was the index described by `meta` built by this version (INDEX_SCHEMA: an older index lacks the owner-required legalities and the CR 100.7 flags) and with
 * these options? (`includedUnsanctioned` is present only in an index built with --include-unsanctioned.) When not, refresh rebuilds it from the bulk file on
 * disk, without network.
 */
export function indexMatchesOptions(meta: BulkMeta | undefined, options: IndexOptions = {}): boolean {
  if (meta?.index?.schema !== INDEX_SCHEMA) return false;
  return (meta.index.includedUnsanctioned !== undefined) === (options.includeUnsanctioned === true);
}

export async function readMeta(files: CacheFiles): Promise<BulkMeta | undefined> {
  return readJsonIfExists<BulkMeta>(files.meta);
}

function bulkPath(files: CacheFiles, format: BulkFormat): string {
  return format === 'jsonl.gz' ? files.bulkJsonlGz : files.bulkJson;
}

/** Rebuild cards.jsonl / tokens.jsonl from the bulk file already on disk. */
export async function rebuildIndex(files: CacheFiles, meta: BulkMeta, clock: Clock = systemClock, log: (m: string) => void = () => {}, options: IndexOptions = {}): Promise<BulkMeta> {
  log(`Building the local card index${options.includeUnsanctioned ? ' with the unsanctioned (silver-border and acorn) cards' : ''} (streaming the bulk file)...`);
  const built = await buildIndexData(bulkLines(bulkPath(files, meta.format), meta.format), meta.format, options);
  await writeIndexFiles(files, built);
  const updated: BulkMeta = { ...meta, index: { ...built.stats, built_at: new Date(clock.now()).toISOString() } };
  await writeFileAtomic(files.meta, `${JSON.stringify(updated, null, 2)}\n`);
  return updated;
}

async function downloadTo(client: ScryfallClient, url: string, accept: string, dest: string): Promise<number> {
  const res = await client.download(url, accept);
  if (!res.body) throw new Error(`Empty response body from ${url}`);
  const part = `${dest}.part`;
  await mkdir(path.dirname(dest), { recursive: true });
  try {
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>), createWriteStream(part));
    await rename(part, dest);
  } catch (e) {
    await rm(part, { force: true });
    throw e;
  }
  return fileSize(dest);
}

export async function refreshBulk(opts: RefreshOptions): Promise<RefreshResult> {
  const clock = opts.clock ?? systemClock;
  const log = opts.log ?? (() => {});
  const files = cacheFiles(opts.cacheDir);
  const force = opts.force ?? false;
  const options = opts.index ?? {};
  const meta = await readMeta(files);
  // A meta without `index` means the download succeeded but the index was never completed.
  const complete = meta ? meta.index !== undefined && (await fileExists(bulkPath(files, meta.format))) && (await indexFilesExist(files)) : false;
  // WP24: an index built with other options (--include-unsanctioned) is rebuilt from the file on disk.
  const present = complete && indexMatchesOptions(meta, options);
  const rebuildReason = complete
    ? meta?.index?.schema !== INDEX_SCHEMA
      ? `the index was built by an older version (schema ${meta?.index?.schema ?? 1}, now ${INDEX_SCHEMA}: rebuilt from the downloaded file, no network)`
      : 'the index was built with other options (rebuilt from the downloaded file, no network)'
    : 'the index was missing or incomplete (rebuilt from the downloaded file, no network)';
  const bulkOnDisk = meta ? await fileExists(bulkPath(files, meta.format)) : false;

  if (meta && !force && canSkipWithoutNetwork(meta, clock.now(), force, bulkOnDisk)) {
    if (!present) return { action: 'rebuilt', reason: rebuildReason, meta: await rebuildIndex(files, meta, clock, log, options) };
    return { action: 'skipped', reason: `last download was ${meta.downloaded_at} (less than 24 h ago); use --force to override`, meta };
  }

  log(`Asking Scryfall for the bulk-data list (${BULK_LIST_URL})...`);
  const entry = pickOracleEntry(await opts.client.getJson<{ data?: BulkEntry[] }>(BULK_LIST_URL));
  const decision = shouldDownload(meta, entry.updated_at, clock.now(), force, bulkOnDisk);
  if (!decision.download) {
    if (meta && !present) return { action: 'rebuilt', reason: rebuildReason, meta: await rebuildIndex(files, meta, clock, log, options) };
    return { action: 'skipped', reason: decision.reason, meta: meta! };
  }

  const url = entry.jsonl_download_uri ?? entry.download_uri;
  if (!url) throw new Error('The oracle_cards bulk entry has neither jsonl_download_uri nor download_uri');
  const format: BulkFormat = entry.jsonl_download_uri ? 'jsonl.gz' : 'json';
  const dest = bulkPath(files, format);
  log(`Downloading ${url}${entry.compressed_size ? ` (${(entry.compressed_size / 1048576).toFixed(1)} MiB)` : ''}...`);
  const size = await downloadTo(opts.client, url, format === 'jsonl.gz' ? ACCEPT_GZIP : ACCEPT_JSON, dest);
  const fresh: BulkMeta = {
    type: 'oracle_cards',
    updated_at: entry.updated_at,
    downloaded_at: new Date(clock.now()).toISOString(),
    source_uri: url,
    format,
    size,
    file: dest.slice(files.dir.length + 1),
  };
  // Remember the download at once (without index stats): if indexing fails or is interrupted, the 24 h rule
  // still holds and `refresh --reindex` (or the next refresh) rebuilds from the file with no network.
  await writeFileAtomic(files.meta, `${JSON.stringify(fresh, null, 2)}
`);
  const withIndex = await rebuildIndex(files, fresh, clock, log, options);
  await rm(bulkPath(files, format === 'jsonl.gz' ? 'json' : 'jsonl.gz'), { force: true });
  return { action: 'downloaded', reason: decision.reason, meta: withIndex };
}
