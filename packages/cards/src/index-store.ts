/**
 * Build the compact local index from the Oracle Cards bulk file and persist it as two JSONL
 * files (cards.jsonl, tokens.jsonl) in the cache directory. Streams line by line.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import type { OracleCard } from '@openmtg/engine';
import { NameIndex } from './name-index';
import type { IndexedCard } from './legalities';
import { classifyCard, trimCard, type RawCard } from './trim';
import { fileExists, renameRetrying } from './fsutil';
import type { CacheFiles } from './paths';

export type BulkFormat = 'jsonl.gz' | 'json';

/**
 * Version of what an index on disk holds. 1: milestone 2. 2 (WP24): legalities kept, CR 100.7 cards flagged `unsanctioned`, same-name variants renamed.
 * 3 (2026-10-14): each picture's `artist` kept with its `image_uris` (the artist credit shown with Scryfall images).
 * An index of an older schema is rebuilt from the bulk file on disk (no network) by the next refresh (bulk.ts `indexMatchesOptions`).
 */
export const INDEX_SCHEMA = 3;

export interface IndexStats {
  /** INDEX_SCHEMA of the build (absent: schema 1, before WP24). */
  schema?: number;
  /** Non-empty lines read from the bulk file. */
  lines: number;
  parseErrors: number;
  cards: number;
  tokenVariants: number;
  excludedArtSeries: number;
  excludedFrontCard: number;
  /** Silver-border or acorn-stamped cards (the field keeps its old name). */
  excludedFunny: number;
  /**
   * Silver-border or acorn-stamped cards KEPT (flagged `unsanctioned`) because the index was built with --include-unsanctioned (design 12.3, WP24).
   * Present only in such an index: its presence is how a later refresh knows which kind of index is on disk.
   */
  includedUnsanctioned?: number;
  /** Playtest cards (CR 100.7) kept in the index flagged `unsanctioned` (present when there are any). */
  flaggedPlaytest?: number;
  /**
   * Flagged cards indexed under "Name (SET number)" because another card of the index has their name (present when there are any): with
   * --include-unsanctioned, the Unstable / Unglued variants (10 names, 56 cards); in either index, the few playtest cards named like another card.
   */
  unsanctionedVariants?: number;
}

/**
 * Options of the index build (WP24). The default index is the one milestone 2 defined, plus Scryfall's legalities, with its playtest cards flagged
 * `unsanctioned` (CR 100.7) and the few named like another card indexed as "Name (SET number)".
 */
export interface IndexOptions {
  /**
   * Keep silver-border and acorn-stamped cards as manual-only cards flagged `unsanctioned` (design 12.3): recognizable in
   * decklists and image uploads, excluded from format validation. Off by default.
   */
  includeUnsanctioned?: boolean;
}

/** Yield the lines of a bulk file, decompressing .jsonl.gz on the fly. */
export async function* bulkLines(file: string, format: BulkFormat): AsyncGenerator<string> {
  const source = createReadStream(file);
  let input: NodeJS.ReadableStream = source;
  if (format === 'jsonl.gz') {
    const gunzip = createGunzip();
    source.on('error', (e) => gunzip.destroy(e));
    input = source.pipe(gunzip);
  }
  const rl = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of rl) yield line;
  } finally {
    rl.close();
    source.destroy();
  }
}

/**
 * Parse one line. JSONL: one object per line. Plain JSON array (old download_uri format):
 * one object per line with a trailing comma, plus lines with just "[" and "]".
 */
export function parseBulkLine(line: string, format: BulkFormat): RawCard | null | 'error' {
  let text = line.trim();
  if (!text || text === '[' || text === ']') return null;
  if (format === 'json' && text.endsWith(',')) text = text.slice(0, -1);
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as RawCard) : 'error';
  } catch {
    return 'error';
  }
}

const byName = (a: OracleCard, b: OracleCard) => (a.name < b.name ? -1 : a.name > b.name ? 1 : (a.oracle_id ?? '') < (b.oracle_id ?? '') ? -1 : 1);

export interface BuiltIndex {
  cards: OracleCard[];
  tokens: OracleCard[];
  stats: IndexStats;
}

/**
 * Stream bulk lines into trimmed cards and tokens (art_series and front_card dropped; silver-border/acorn-stamped cards dropped too, or kept
 * flagged `unsanctioned` with `includeUnsanctioned`).
 */
export async function buildIndexData(lines: AsyncIterable<string>, format: BulkFormat, options: IndexOptions = {}): Promise<BuiltIndex> {
  const stats: IndexStats = { schema: INDEX_SCHEMA, lines: 0, parseErrors: 0, cards: 0, tokenVariants: 0, excludedArtSeries: 0, excludedFrontCard: 0, excludedFunny: 0 };
  if (options.includeUnsanctioned) stats.includedUnsanctioned = 0;
  const cards: OracleCard[] = [];
  const tokens: OracleCard[] = [];
  /** Flagged cards -> "SET number", the suffix that tells same-name variants apart. */
  const printing = new Map<OracleCard, string>();
  const addCard = (raw: RawCard): void => {
    const card = trimCard(raw, 'card');
    cards.push(card);
    if (card.unsanctioned) printing.set(card, [typeof raw.set === 'string' ? raw.set.toUpperCase() : '', typeof raw.collector_number === 'string' ? raw.collector_number : ''].filter(Boolean).join(' '));
  };
  for await (const line of lines) {
    const raw = parseBulkLine(line, format);
    if (raw === null) continue;
    stats.lines++;
    if (raw === 'error' || typeof raw.name !== 'string' || typeof raw.layout !== 'string') {
      stats.parseErrors++;
      continue;
    }
    switch (classifyCard(raw)) {
      case 'art_series': stats.excludedArtSeries++; break;
      case 'front_card': stats.excludedFrontCard++; break;
      case 'funny':
        if (stats.includedUnsanctioned === undefined) stats.excludedFunny++;
        else {
          stats.includedUnsanctioned++;
          addCard(raw); // flagged `unsanctioned` by trimCard
        }
        break;
      case 'token': tokens.push(trimCard(raw, 'token')); break;
      case 'card':
        addCard(raw); // a playtest card is flagged `unsanctioned` by trimCard (CR 100.7)
        if (printing.has(cards[cards.length - 1]!)) stats.flaggedPlaytest = (stats.flaggedPlaytest ?? 0) + 1;
        break;
    }
  }
  const renamed = renameVariants(cards, printing);
  if (renamed > 0) stats.unsanctionedVariants = renamed;
  cards.sort(byName);
  tokens.sort(byName);
  stats.cards = cards.length;
  stats.tokenVariants = tokens.length;
  return { cards, tokens, stats };
}

/**
 * CR 201.2: a card's name identifies it, but Scryfall has several objects with one name: six Unstable variants of Garbage Elemental with different text and
 * power/toughness, a Mystery Booster playtest Pick Your Poison next to the MKM card. The name index keeps one card per name, so the others would be
 * unreachable and a decklist would silently get whichever came first. Every flagged card (CR 100.7) whose name another card has is renamed
 * "Name (SET number)" (its printed name kept in `variant_of`): a tournament card keeps the bare name, and a name only flagged cards share is reported as
 * ambiguous among them (name-index.ts). Returns how many cards were renamed. Mutates the trimmed cards (fresh objects of this build).
 */
function renameVariants(cards: OracleCard[], printing: ReadonlyMap<OracleCard, string>): number {
  const count = new Map<string, number>();
  for (const c of cards) count.set(c.name, (count.get(c.name) ?? 0) + 1);
  // A face name of another card counts too: a flagged card named "Fast" would otherwise win the exact-name lookup over MH2's Fast // Furious.
  const faceNames = new Set(cards.flatMap((c) => ((c.card_faces?.length ?? 0) > 1 ? c.card_faces!.map((f) => f.name) : [])));
  const used = new Set(cards.map((c) => c.name));
  let renamed = 0;
  for (const c of cards) {
    const suffix = printing.get(c);
    if (suffix === undefined || ((count.get(c.name) ?? 0) < 2 && !faceNames.has(c.name))) continue;
    const base = c.name;
    let name = `${base} (${suffix || 'variant'})`;
    for (let n = 2; used.has(name); n++) name = `${base} (${suffix || 'variant'} ${n})`;
    used.add(name);
    (c as IndexedCard).variant_of = base;
    c.name = name;
    renamed++;
  }
  return renamed;
}

async function writeJsonl(file: string, items: OracleCard[]): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  const out = createWriteStream(tmp, { encoding: 'utf8' });
  for (const item of items) {
    if (!out.write(`${JSON.stringify(item)}\n`)) await once(out, 'drain');
  }
  out.end();
  await once(out, 'finish');
  await renameRetrying(tmp, file); // the local server may be reading the old index (Windows: EPERM until it closes)
}

export async function writeIndexFiles(files: CacheFiles, built: BuiltIndex): Promise<void> {
  await writeJsonl(files.cards, built.cards);
  await writeJsonl(files.tokens, built.tokens);
}

export async function indexFilesExist(files: CacheFiles): Promise<boolean> {
  return (await fileExists(files.cards)) && (await fileExists(files.tokens));
}

async function readJsonl(file: string, onCard: (card: OracleCard) => void): Promise<void> {
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) onCard(JSON.parse(line) as OracleCard);
  }
}

/** Load the persisted index into a NameIndex. */
export async function readIndexFiles(files: CacheFiles): Promise<NameIndex> {
  const index = new NameIndex();
  await readJsonl(files.cards, (c) => index.add(c));
  await readJsonl(files.tokens, (c) => index.addToken(c));
  return index;
}

/** Build a NameIndex from already-trimmed cards (tests, in-memory use). */
export function indexFromCards(cards: Iterable<OracleCard>, tokens: Iterable<OracleCard> = []): NameIndex {
  const index = new NameIndex();
  for (const c of cards) index.add(c);
  for (const t of tokens) index.addToken(t);
  return index;
}
