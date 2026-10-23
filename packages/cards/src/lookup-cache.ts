/**
 * On-disk cache for one-off lookups (names missing from the bulk index).
 * Found cards are kept; "not found" answers are kept with a timestamp and expire after 24 h,
 * so the same name is never requested twice within 24 h.
 */
import type { OracleCard } from '@openmtg/engine';
import { readJsonIfExists, writeFileAtomic } from './fsutil';
import { canonicalKey } from './normalize';
import { REFRESH_WINDOW_MS } from './bulk';

export interface LookupEntry {
  fetched_at: string;
  /** null = Scryfall does not know this name (or it is out of scope). */
  card: OracleCard | null;
  reason?: string;
}

interface LookupFile {
  version: 1;
  entries: Record<string, LookupEntry>;
}

export class LookupCache {
  private entries = new Map<string, LookupEntry>();
  private dirty = false;

  constructor(private readonly file?: string) {}

  static async load(file: string): Promise<LookupCache> {
    const cache = new LookupCache(file);
    const data = await readJsonIfExists<LookupFile>(file);
    if (data?.version === 1) for (const [k, v] of Object.entries(data.entries)) cache.entries.set(k, v);
    return cache;
  }

  static keyOf(name: string): string {
    return canonicalKey(name);
  }

  /** A usable entry: any found card, or a not-found answer younger than 24 h. */
  fresh(name: string, nowMs: number): LookupEntry | undefined {
    const e = this.entries.get(LookupCache.keyOf(name));
    if (!e) return undefined;
    if (e.card) return e;
    const t = Date.parse(e.fetched_at);
    return Number.isFinite(t) && nowMs - t < REFRESH_WINDOW_MS ? e : undefined;
  }

  set(name: string, entry: LookupEntry): void {
    this.entries.set(LookupCache.keyOf(name), entry);
    this.dirty = true;
  }

  /** All cached positive results (to merge into the in-memory index). */
  cards(): OracleCard[] {
    const seen = new Set<string>();
    const out: OracleCard[] = [];
    for (const e of this.entries.values()) {
      if (e.card && !seen.has(e.card.name)) {
        seen.add(e.card.name);
        out.push(e.card);
      }
    }
    return out;
  }

  /** Positive results with the cache key (loose name) they were stored under. */
  named(): Array<[string, OracleCard]> {
    const out: Array<[string, OracleCard]> = [];
    for (const [k, e] of this.entries) if (e.card) out.push([k, e.card]);
    return out;
  }

  get size(): { found: number; notFound: number } {
    let found = 0;
    for (const e of this.entries.values()) if (e.card) found++;
    return { found, notFound: this.entries.size - found };
  }

  async save(): Promise<void> {
    if (!this.file || !this.dirty) return;
    const data: LookupFile = { version: 1, entries: Object.fromEntries([...this.entries].sort(([a], [b]) => (a < b ? -1 : 1))) };
    await writeFileAtomic(this.file, `${JSON.stringify(data, null, 1)}\n`);
    this.dirty = false;
  }
}
