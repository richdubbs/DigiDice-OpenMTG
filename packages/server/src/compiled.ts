/**
 * Compiled card definitions for the API (docs/design/m8-client.md, "Server API"): the game-path compiler (`compileCardsSafe` of @openmtg/cards, which is
 * the engine's default compile pipeline plus the CR 100.7 unsanctioned cap) with a memory cache and a disk cache under `.cache/compiled/`.
 *
 * Cache keys. The directory is named after `COMPILER_VERSION` plus a fingerprint of everything else the compiler reads that a version bump might miss
 * (the engine's capability set and the template set), so a cached definition is never used by a compiler that would compile the card differently. A card's
 * key is a SHA-256 of its Oracle record (every rules field of every face; image URLs left out, legalities reduced to "has data", which is all the
 * unsanctioned check reads): stricter than the Oracle text alone, so a changed type line or P/T also misses the cache.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compileCardsSafe, type IndexedCard } from '@openmtg/cards';
import { COMPILER_VERSION, ENGINE_CAPABILITIES, TEMPLATE_SET, type CardDef, type OracleCard } from '@openmtg/engine';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** JSON with object keys sorted, so equal records hash equally whatever their key order. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stableJson(x)}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

let fingerprint: string | undefined;

/** Short digest of what the compiler reads besides the card: its version, the engine's capabilities and the template set. */
export function engineFingerprint(): string {
  fingerprint ??= sha256([COMPILER_VERSION, [...ENGINE_CAPABILITIES].sort().join('\n'), stableJson(TEMPLATE_SET)].join('\u0000')).slice(0, 12);
  return fingerprint;
}

/** The cache directory of this compiler: `<compiledDir>/<COMPILER_VERSION>-<fingerprint>` (unsafe file-name characters replaced). */
export function versionDir(compiledDir: string): string {
  return path.join(compiledDir, `${COMPILER_VERSION.replace(/[^A-Za-z0-9._+-]/g, '_')}-${engineFingerprint()}`);
}

const keys = new WeakMap<OracleCard, string>();

/** The cache key of a card (see the file header). Memoized per card object (index cards are never edited). */
export function cardKey(card: OracleCard): string {
  let k = keys.get(card);
  if (k === undefined) {
    const strip = (o: object): Record<string, unknown> => {
      const { image_uris: _i, ...rest } = o as Record<string, unknown>;
      return rest;
    };
    const record = strip(card);
    if (Array.isArray(card.card_faces)) record.card_faces = card.card_faces.map(strip);
    if ((card as IndexedCard).legalities !== undefined) record.legalities = true;
    k = sha256(stableJson(record));
    keys.set(card, k);
  }
  return k;
}

/** Compile one card on the game path; throws with the compiler's message when the engine rejects it. */
export function compileOne(card: OracleCard): CardDef {
  const { defs, failures } = compileCardsSafe([card]);
  if (defs[0]) return defs[0];
  throw new Error(failures[0]?.message ?? 'the compiler returned nothing');
}

const MEMORY_LIMIT = 4000;
let tmpSeq = 0;

/**
 * Compiled definitions by card key: memory (most recently used first out of the limit), then `<versionDir>/defs/<key>.json`, then the compiler. A disk
 * write failure is not an error (the cache is an optimization); an unreadable cache file is compiled again and rewritten.
 */
export class DefCache {
  private readonly memory = new Map<string, CardDef>();
  private readonly dir: string;
  private dirReady: Promise<unknown> | undefined;

  constructor(compiledDir: string) {
    this.dir = path.join(versionDir(compiledDir), 'defs');
  }

  private remember(key: string, def: CardDef): CardDef {
    this.memory.delete(key);
    this.memory.set(key, def);
    if (this.memory.size > MEMORY_LIMIT) this.memory.delete(this.memory.keys().next().value!);
    return def;
  }

  private async readDisk(file: string, card: OracleCard): Promise<CardDef | undefined> {
    try {
      const def = JSON.parse(await readFile(file, 'utf8')) as CardDef;
      return def && def.name === card.name && def.automation?.level !== undefined ? def : undefined;
    } catch {
      return undefined;
    }
  }

  private async writeDisk(file: string, def: CardDef): Promise<void> {
    try {
      this.dirReady ??= mkdir(this.dir, { recursive: true });
      await this.dirReady;
      const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`;
      await writeFile(tmp, JSON.stringify(def), 'utf8');
      await rename(tmp, file);
    } catch {
      // read-only or full disk: the definition is still served from memory
    }
  }

  /** The compiled definition of an index card. Throws when the compiler rejects the card. */
  async get(card: OracleCard): Promise<CardDef> {
    const key = cardKey(card);
    const hit = this.memory.get(key);
    if (hit) return this.remember(key, hit);
    const file = path.join(this.dir, `${key}.json`);
    const cached = await this.readDisk(file, card);
    if (cached) return this.remember(key, cached);
    const def = compileOne(card);
    await this.writeDisk(file, def);
    return this.remember(key, def);
  }
}
