/**
 * Set search (Scryfall's s:, set:, e:, edition: in the deckbuilder's search, and the Advanced search form's Set field): which Oracle cards have a
 * printing in a set. The local card index has one entry per Oracle card and no printings, so the lists come from the Scryfall API the first time a set
 * is searched and are kept next to the card data, in <cache>/../scryfall-sets (the folder and per-set file format scripts/coverage-stats.ts uses):
 *
 *   _all-sets.json   every set: code, name, type, release date, card count (Scryfall /sets); fetched again after a week
 *   <code>.json      the set's Oracle ids, sorted (/cards/search?q=e:<code>&unique=cards, every page); a set not out yet or released in the last
 *                    30 days is fetched again after a day (its previews add cards), any other is kept
 *
 * Offline: a kept list is used however old; without one, the search says the internet is needed once (SetsUnavailableError).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ScryfallClient, ScryfallHttpError } from '@openmtg/cards';
import type { SetSummary } from './api';
import type { ServerContext } from './context';
import { fold } from './search-query';

const API = 'https://api.scryfall.com';
const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_MAX_AGE_MS = 7 * DAY_MS;
const RECENT_SET_MS = 30 * DAY_MS;
const RECENT_LIST_MAX_AGE_MS = DAY_MS;

/** A set list could not be fetched and none is kept: the player is told the internet is needed once. */
export class SetsUnavailableError extends Error {}

interface ScryfallSet {
  code: string;
  name: string;
  set_type: string;
  released_at?: string;
  card_count: number;
  digital?: boolean;
}
interface ScryfallPage {
  data?: { oracle_id?: string; card_faces?: { oracle_id?: string }[] }[];
  has_more?: boolean;
  next_page?: string;
}

/** The Oracle id the card index keys a card by (a reversible card has it on its faces only). */
export const oracleIdOf = (card: { oracle_id?: string; card_faces?: readonly { oracle_id?: string }[] }): string | undefined => card.oracle_id ?? card.card_faces?.[0]?.oracle_id;

export class SetLists {
  private sets: Promise<SetSummary[]> | null = null;
  private readonly cards = new Map<string, Promise<ReadonlySet<string>>>();

  constructor(
    private readonly dir: string,
    private readonly client: ScryfallClient,
    private readonly now: () => number = Date.now,
  ) {}

  /** Every set, newest first. */
  all(): Promise<SetSummary[]> {
    if (!this.sets) {
      const p = this.load('_all-sets.json', LIST_MAX_AGE_MS, async () => {
        const r = await this.client.getJson<{ data?: ScryfallSet[] }>(`${API}/sets`);
        return (r.data ?? [])
          .filter((s) => s.card_count > 0)
          .map((s) => ({ code: s.code, name: s.name, type: s.set_type, released: s.released_at ?? '', cards: s.card_count, ...(s.digital ? { digital: true } : {}) }))
          .sort((a, b) => b.released.localeCompare(a.released) || a.name.localeCompare(b.name));
      });
      // A failed fetch is tried again by the next search.
      p.catch(() => {
        if (this.sets === p) this.sets = null;
      });
      this.sets = p;
    }
    return this.sets;
  }

  /** The Oracle ids of the cards with a printing in the set. */
  cardsOf(set: SetSummary): Promise<ReadonlySet<string>> {
    let p = this.cards.get(set.code);
    if (!p) {
      const recent = !set.released || Date.parse(set.released) > this.now() - RECENT_SET_MS;
      p = this.load(`${set.code}.json`, recent ? RECENT_LIST_MAX_AGE_MS : Infinity, () => this.fetchCards(set.code)).then((ids) => new Set(ids));
      p.catch(() => this.cards.delete(set.code));
      this.cards.set(set.code, p);
    }
    return p;
  }

  private async fetchCards(code: string): Promise<string[]> {
    const ids = new Set<string>();
    let url: string | undefined = `${API}/cards/search?q=${encodeURIComponent(`e:${code}`)}&unique=cards&include_extras=true&include_variations=true`;
    while (url) {
      let page: ScryfallPage;
      try {
        page = await this.client.getJson<ScryfallPage>(url);
      } catch (e) {
        if (e instanceof ScryfallHttpError && e.status === 404) break; // no cards
        throw e;
      }
      for (const c of page.data ?? []) {
        const id = oracleIdOf(c);
        if (id) ids.add(id);
      }
      url = page.has_more ? page.next_page : undefined;
    }
    return [...ids].sort();
  }

  /** A kept file when it is young enough, else a fresh fetch (kept); offline, the kept file however old. */
  private async load<T>(file: string, maxAgeMs: number, fetch: () => Promise<T>): Promise<T> {
    const at = path.join(this.dir, file);
    const kept = existsSync(at) ? (JSON.parse(readFileSync(at, 'utf8')) as T) : undefined;
    if (kept !== undefined && this.now() - statSync(at).mtimeMs < maxAgeMs) return kept;
    try {
      const fresh = await fetch();
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(at, JSON.stringify(fresh));
      return fresh;
    } catch (e) {
      if (kept !== undefined) return kept;
      throw new SetsUnavailableError(`Searching by set needs an internet connection the first time: the set lists come from Scryfall (${e instanceof Error ? e.message : String(e)})`);
    }
  }
}

/** The set a search names: its code (dmu), or its name in full (Dominaria United) or in part when only one set's name has it. A string is the error. */
export function findSet(sets: readonly SetSummary[], text: string): SetSummary | string {
  const want = fold(text.trim());
  const byCode = sets.find((s) => s.code === want);
  if (byCode) return byCode;
  const byName = sets.filter((s) => fold(s.name) === want);
  if (byName.length === 1) return byName[0]!;
  const partial = sets.filter((s) => fold(s.name).includes(want));
  if (partial.length === 1) return partial[0]!;
  const list = (ss: readonly SetSummary[]) => ss.slice(0, 6).map((s) => `${s.code} (${s.name})`).join(', ');
  if (partial.length > 1) return `"${text}" is in the name of ${partial.length} sets: use a set code, e.g. ${list(partial)}`;
  return `No set has the code or name "${text}". Set codes are the three to five letters Scryfall shows, e.g. dmu for Dominaria United`;
}

const bySetsDir = new Map<string, SetLists>();

/** The set lists of a server (one per card-data folder, so every search shares the kept lists and the Scryfall client's rate limits). */
export function setLists(ctx: ServerContext): SetLists {
  const dir = path.join(path.dirname(ctx.cacheDir), 'scryfall-sets');
  let lists = bySetsDir.get(dir);
  if (!lists) {
    lists = new SetLists(dir, ctx.scryfall ?? new ScryfallClient());
    // A client injected by a test is that test's own: do not keep it for the next context.
    if (!ctx.scryfall) bySetsDir.set(dir, lists);
  }
  return lists;
}
