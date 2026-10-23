/**
 * CardDatabase: the library API for a Node server or tool.
 *   const db = await CardDatabase.open();            // loads the local index from the cache dir
 *   db.lookup('lim-dul\'s vault')                    // OracleCard | undefined (local, synchronous)
 *   await db.resolveDecklist(text, { fetchMissing }) // {main, sideboard, unknown, errors, ...}
 * Name suggestions come from the local index only.
 */
import type { OracleCard } from '@openmtg/engine';
import { rebuildIndex, refreshBulk, readMeta, type BulkMeta, type RefreshResult } from './bulk';
import { parseDecklist, type DeckLine, type DeckParseError, type DeckSection } from './decklist';
import { fileExists } from './fsutil';
import { ScryfallClient, systemClock, type Clock } from './http';
import { indexFilesExist, indexFromCards, readIndexFiles, type IndexOptions } from './index-store';
import { LookupCache } from './lookup-cache';
import { NameIndex } from './name-index';
import { cacheFiles, defaultCacheDir, type CacheFiles } from './paths';
import { fetchMissingCards } from './remote';

export interface OpenOptions {
  /** Default: OPENMTG_CACHE_DIR or <repo root>/.cache/scryfall. */
  cacheDir?: string;
  client?: ScryfallClient;
  clock?: Clock;
  log?: (message: string) => void;
  /** Open with an empty index when no bulk data has been downloaded yet. */
  allowEmpty?: boolean;
}

/**
 * One client (so one request queue and one set of spacing rules) for every CardDatabase that uses the
 * real clock and no client of its own. Scryfall's limits are per client IP, not per object.
 */
let sharedClient: ScryfallClient | undefined;

/** Add the cards found by earlier one-off lookups (and the names Scryfall resolved to them) to an index. */
function mergeLookups(index: NameIndex, lookups: LookupCache): void {
  for (const c of lookups.cards()) index.add(c);
  for (const [name, c] of lookups.named()) index.addNameAlias(name, c);
}

export class CardDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardDatabaseError';
  }
}

export interface ResolvedName {
  name: string;
  card: OracleCard | null;
  source: 'local' | 'fetched' | 'none';
  /** Full names of the cards the name could mean, when it is a face name shared by several cards (then `card` is null). */
  ambiguous?: string[];
}

export interface ResolveOptions {
  /** Ask Scryfall (POST /cards/collection) for names the local index lacks. Default false. */
  fetchMissing?: boolean;
}

export interface ResolvedEntry {
  count: number;
  card: OracleCard;
}

export interface UnknownName {
  name: string;
  /** Line of the first occurrence in the decklist text. */
  line: number;
  section: Exclude<DeckSection, 'maybeboard'>;
  suggestions: string[];
  /** Set when the name is a face name shared by several cards: their full names (also the suggestions). */
  ambiguous?: string[];
}

/** A deck entry whose name the index does not know: the input of the stub hook (stubs.ts, design 12.1 C4). */
export interface UnresolvedEntry {
  section: Exclude<DeckSection, 'maybeboard'>;
  /** The name as written on the first line that used it. */
  name: string;
  /** Total count over the section's lines with this name. */
  count: number;
}

export interface ResolvedDecklist {
  main: ResolvedEntry[];
  sideboard: ResolvedEntry[];
  commander: ResolvedEntry[];
  companion: ResolvedEntry[];
  unknown: UnknownName[];
  /** WP24: the entries of `unknown`, per section with their counts, so a client can turn the ones the player confirms into stub cards (stubs.ts). */
  unresolved: UnresolvedEntry[];
  /** Per-line parse errors. */
  errors: DeckParseError[];
  /** Set when asking Scryfall failed (the rest of the result is still valid). */
  fetchError?: string;
  /** Entries in the maybeboard section, ignored. */
  ignoredMaybeboard: number;
}

export interface DatabaseStats {
  cacheDir: string;
  meta?: BulkMeta;
  cards: number;
  aliases: number;
  /** Face names shared by more than one card. */
  sharedAliases: number;
  tokenNames: number;
  tokenVariants: number;
  lookups: { found: number; notFound: number };
}

export class CardDatabase {
  /** Requests in progress by name, so concurrent callers share one request. */
  private readonly inflight = new Map<string, Promise<unknown>>();

  private constructor(
    readonly cacheDir: string,
    private index: NameIndex,
    private readonly lookups: LookupCache,
    private readonly clock: Clock,
    private readonly log: (message: string) => void,
    private client: ScryfallClient | undefined,
    private readonly persistent: boolean,
  ) {}

  /** Open the local index. Throws CardDatabaseError with instructions when there is no bulk data. */
  static async open(options: OpenOptions = {}): Promise<CardDatabase> {
    const cacheDir = options.cacheDir ?? defaultCacheDir();
    const files = cacheFiles(cacheDir);
    const clock = options.clock ?? systemClock;
    const log = options.log ?? (() => {});
    let index: NameIndex;
    if (await indexFilesExist(files)) index = await readIndexFiles(files);
    else if (options.allowEmpty) index = new NameIndex();
    else throw new CardDatabaseError(`No card index in ${cacheDir}. Download the Scryfall Oracle Cards bulk data first: npm run cards -- refresh`);
    const lookups = await LookupCache.load(files.lookups);
    mergeLookups(index, lookups);
    return new CardDatabase(cacheDir, index, lookups, clock, log, options.client, true);
  }

  /** In-memory database (tests): no disk, no network unless a client is given. */
  static fromCards(cards: Iterable<OracleCard>, options: { tokens?: Iterable<OracleCard>; client?: ScryfallClient; clock?: Clock; log?: (m: string) => void; lookupFile?: string } = {}): CardDatabase {
    return new CardDatabase(
      '(memory)',
      indexFromCards(cards, options.tokens),
      new LookupCache(options.lookupFile),
      options.clock ?? systemClock,
      options.log ?? (() => {}),
      options.client,
      false,
    );
  }

  private getClient(): ScryfallClient {
    if (this.client) return this.client;
    if (this.clock === systemClock) {
      sharedClient ??= new ScryfallClient({ clock: systemClock });
      sharedClient.log = this.log;
      this.client = sharedClient;
    } else {
      this.client = new ScryfallClient({ clock: this.clock, log: this.log });
    }
    return this.client;
  }

  /** Local lookup (full name or face alias, case/diacritics/whitespace-insensitive). */
  lookup(name: string): OracleCard | undefined {
    return this.index.get(name);
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  /** All token and emblem variants with this name (token names are not unique). */
  lookupTokens(name: string): OracleCard[] {
    return this.index.tokens(name);
  }

  suggest(name: string, limit = 5): string[] {
    return this.index.suggest(name, limit);
  }

  /** Every game card in the index (full names). */
  cards(): IterableIterator<OracleCard> {
    return this.index.cards();
  }

  allTokens(): OracleCard[] {
    return this.index.allTokens();
  }

  /** Resolve names in input order; optionally fetch the missing ones from Scryfall in batches. */
  async resolveNames(names: string[], options: ResolveOptions = {}): Promise<{ resolved: ResolvedName[]; fetchError?: string }> {
    const before = new Set<string>();
    for (const n of names) if (this.index.has(n)) before.add(n);
    let fetchError: string | undefined;
    const missing = names.filter((n) => !this.index.has(n));
    if (options.fetchMissing && missing.length) {
      try {
        await fetchMissingCards(missing, { client: this.getClient(), cache: this.lookups, index: this.index, clock: this.clock, log: this.log, inflight: this.inflight });
      } catch (e) {
        fetchError = e instanceof Error ? e.message : String(e);
      }
    }
    const resolved = names.map<ResolvedName>((name) => {
      const card = this.index.get(name) ?? null;
      const out: ResolvedName = { name, card, source: card ? (before.has(name) ? 'local' : 'fetched') : 'none' };
      if (!card) {
        const ambiguous = this.index.ambiguous(name);
        if (ambiguous.length) out.ambiguous = ambiguous;
      }
      return out;
    });
    return fetchError ? { resolved, fetchError } : { resolved };
  }

  async resolveDecklist(text: string, options: ResolveOptions = {}): Promise<ResolvedDecklist> {
    const parsed = parseDecklist(text);
    const sections: Array<[Exclude<DeckSection, 'maybeboard'>, DeckLine[]]> = [
      ['main', parsed.main],
      ['sideboard', parsed.sideboard],
      ['commander', parsed.commander],
      ['companion', parsed.companion],
    ];
    const names = [...new Set(sections.flatMap(([, lines]) => lines.map((l) => l.name)))];
    const { resolved, fetchError } = await this.resolveNames(names, options);
    const byName = new Map(resolved.map((r) => [r.name, r.card]));
    const ambiguousByName = new Map(resolved.flatMap((r) => (r.ambiguous ? [[r.name, r.ambiguous] as const] : [])));

    const out: ResolvedDecklist = { main: [], sideboard: [], commander: [], companion: [], unknown: [], unresolved: [], errors: parsed.errors, ignoredMaybeboard: parsed.maybeboard.length };
    if (fetchError) out.fetchError = fetchError;
    const unknownSeen = new Set<string>();
    for (const [section, lines] of sections) {
      const merged = new Map<string, ResolvedEntry>();
      const missing = new Map<string, UnresolvedEntry>();
      for (const l of lines) {
        const card = byName.get(l.name);
        if (!card) {
          const m = missing.get(l.name);
          if (m) m.count += l.count;
          else missing.set(l.name, { section, name: l.name, count: l.count });
          if (!unknownSeen.has(l.name)) {
            unknownSeen.add(l.name);
            const ambiguous = ambiguousByName.get(l.name);
            out.unknown.push(
              ambiguous ? { name: l.name, line: l.line, section, suggestions: ambiguous.slice(0, 5), ambiguous } : { name: l.name, line: l.line, section, suggestions: this.suggest(l.name) },
            );
          }
          continue;
        }
        const existing = merged.get(card.name);
        if (existing) existing.count += l.count;
        else merged.set(card.name, { count: l.count, card });
      }
      out[section] = [...merged.values()];
      out.unresolved.push(...missing.values());
    }
    return out;
  }

  /** Download/refresh the Oracle Cards bulk file (see bulk.ts for the policy) and reload the index. */
  async refresh(options: { force?: boolean; index?: IndexOptions } = {}): Promise<RefreshResult> {
    if (!this.persistent) throw new CardDatabaseError('An in-memory database has no cache to refresh');
    const result = await refreshBulk({ client: this.getClient(), cacheDir: this.cacheDir, force: options.force ?? false, clock: this.clock, log: this.log, index: options.index ?? {} });
    if (result.action !== 'skipped') {
      const fresh = await readIndexFiles(cacheFiles(this.cacheDir));
      mergeLookups(fresh, this.lookups); // keep one-off cards the bulk file lacks
      this.index = fresh;
    }
    return result;
  }

  /** Rebuild the index from the bulk file already on disk (no network), e.g. after changing the trimming rules. */
  async reindex(options: IndexOptions = {}): Promise<BulkMeta> {
    const files = cacheFiles(this.cacheDir);
    const meta = await readMeta(files);
    if (!this.persistent || !meta) throw new CardDatabaseError(`No bulk file in ${this.cacheDir}. Run: npm run cards -- refresh`);
    const updated = await rebuildIndex(files, meta, this.clock, this.log, options);
    const fresh = await readIndexFiles(files);
    mergeLookups(fresh, this.lookups);
    this.index = fresh;
    return updated;
  }

  async stats(): Promise<DatabaseStats> {
    const files: CacheFiles = cacheFiles(this.cacheDir);
    const meta = this.persistent && (await fileExists(files.meta)) ? await readMeta(files) : undefined;
    const base: DatabaseStats = {
      cacheDir: this.cacheDir,
      cards: this.index.size,
      aliases: this.index.aliasCount,
      sharedAliases: this.index.sharedAliasCount,
      tokenNames: this.index.tokenNameCount,
      tokenVariants: this.index.tokenCount,
      lookups: this.lookups.size,
    };
    return meta ? { ...base, meta } : base;
  }
}
