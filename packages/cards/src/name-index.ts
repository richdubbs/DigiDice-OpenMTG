/**
 * In-memory name index over trimmed OracleCards.
 * Lookup order (see normalize.ts for the two key levels):
 *   1. exact full name (strict key, so "Glimpse, the Unthinkable" and "Glimpse the Unthinkable" stay apart);
 *   2. full name ignoring punctuation (apostrophes, commas, hyphens): "Smugglers Copter";
 *   3. a name that Scryfall resolved to a card whose real name we could not match (addNameAlias, rare);
 *   4. face name ("Fire" -> "Fire // Ice"); where several cards share a face name, the card where it is
 *      the front face wins, and a tie is reported as ambiguous instead of picking one silently.
 * Token names are not unique, so every token variant is kept under its name (and under each face name).
 */
import type { OracleCard } from '@openmtg/engine';
import type { IndexedCard } from './legalities';
import { looseKeyVariants, looseName, nameKeyVariants, normalizeName } from './normalize';

/**
 * WP24: a card the rules do not cover (CR 100.7, flagged `unsanctioned`) never hides a card they do: it loses a shared full name, and its face names and
 * printed name (`variant_of`) rank after every other card's, so "Fast" is MH2's Fast // Furious, not the Unknown Event playtest card.
 */
const FLAGGED_RANK = 10;
const casual = (card: OracleCard): boolean => card.unsanctioned === true;
/** Memorabilia and flagged cards lose a shared name to any other card. */
const weak = (card: OracleCard): boolean => card.set_type === 'memorabilia' || casual(card);

interface AliasCandidate {
  card: OracleCard;
  /** 0 = front face. Lower rank wins when two cards share a face name. */
  rank: number;
}

export interface Resolution {
  card?: OracleCard;
  /** Cards that match equally well; set (and `card` unset) when the name is ambiguous. */
  ambiguous: OracleCard[];
}

export class NameIndex {
  private readonly full = new Map<string, OracleCard>();
  private readonly looseFull = new Map<string, OracleCard[]>();
  private readonly aliases = new Map<string, AliasCandidate[]>();
  private readonly tokenVariants = new Map<string, OracleCard[]>();
  private readonly tokenAliases = new Map<string, OracleCard[]>();
  private readonly nameAliases = new Map<string, OracleCard>();

  /** Add a game card. A name already present is kept (first wins), except that memorabilia or a flagged card (CR 100.7) loses to any other card. */
  add(card: OracleCard): void {
    const key = normalizeName(card.name);
    if (!key) return;
    const existing = this.full.get(key);
    if (existing) {
      if (weak(existing) && !weak(card)) {
        this.unregister(key, existing);
        this.register(key, card);
      }
      return;
    }
    this.register(key, card);
  }

  private register(key: string, card: OracleCard): void {
    this.full.set(key, card);
    const lk = looseName(card.name);
    const list = this.looseFull.get(lk);
    if (list) list.push(card);
    else this.looseFull.set(lk, [card]);
    const offset = casual(card) ? FLAGGED_RANK : 0;
    const printed = (card as IndexedCard).variant_of;
    if (typeof printed === 'string') this.addAlias(looseName(printed), lk, card, offset);
    const faces = card.card_faces ?? [];
    if (faces.length < 2) return;
    faces.forEach((face, rank) => this.addAlias(looseName(face.name), lk, card, offset + rank));
  }

  private addAlias(alias: string, own: string, card: OracleCard, rank: number): void {
    if (!alias || alias === own) return;
    const cands = this.aliases.get(alias);
    if (!cands) this.aliases.set(alias, [{ card, rank }]);
    else if (!cands.some((c) => c.card === card)) cands.push({ card, rank });
  }

  /** Remove everything `register` stored for a card (used when a real card replaces memorabilia). */
  private unregister(key: string, card: OracleCard): void {
    this.full.delete(key);
    const lk = looseName(card.name);
    const list = (this.looseFull.get(lk) ?? []).filter((c) => c !== card);
    if (list.length) this.looseFull.set(lk, list);
    else this.looseFull.delete(lk);
    const printed = (card as IndexedCard).variant_of;
    for (const face of [...(card.card_faces ?? []), ...(typeof printed === 'string' ? [{ name: printed }] : [])]) {
      const alias = looseName(face.name);
      const cands = (this.aliases.get(alias) ?? []).filter((c) => c.card !== card);
      if (cands.length) this.aliases.set(alias, cands);
      else this.aliases.delete(alias);
    }
  }

  /** Remember that Scryfall answered a request for `name` with `card`, although the card's own names do not match it. */
  addNameAlias(name: string, card: OracleCard): void {
    const k = looseName(name);
    if (k && !this.nameAliases.has(k)) this.nameAliases.set(k, card);
  }

  addToken(card: OracleCard): void {
    const key = normalizeName(card.name);
    if (!key) return;
    const list = this.tokenVariants.get(key);
    if (list) list.push(card);
    else this.tokenVariants.set(key, [card]);
    const faces = card.card_faces ?? [];
    if (faces.length < 2) return;
    const own = looseName(card.name);
    for (const face of faces) {
      const alias = looseName(face.name);
      if (!alias || alias === own) continue;
      const cands = this.tokenAliases.get(alias);
      if (!cands) this.tokenAliases.set(alias, [card]);
      else if (!cands.includes(card)) cands.push(card);
    }
  }

  /** Resolve a name; reports ambiguity instead of guessing. */
  resolve(name: string): Resolution {
    for (const k of nameKeyVariants(name)) {
      const hit = this.full.get(k);
      if (hit) return { card: hit, ambiguous: [] };
    }
    const loose = looseKeyVariants(name);
    for (const k of loose) {
      const list = this.looseFull.get(k);
      if (list?.length === 1) return { card: list[0]!, ambiguous: [] };
      if (list && list.length > 1) return { ambiguous: [...list] };
    }
    for (const k of loose) {
      const hit = this.nameAliases.get(k);
      if (hit && !this.aliases.has(k)) return { card: hit, ambiguous: [] };
    }
    for (const k of loose) {
      const cands = this.aliases.get(k);
      if (!cands?.length) continue;
      const best = Math.min(...cands.map((c) => c.rank));
      const top = cands.filter((c) => c.rank === best);
      if (top.length === 1) return { card: top[0]!.card, ambiguous: [] };
      return { ambiguous: top.map((c) => c.card) };
    }
    return { ambiguous: [] };
  }

  /** Look a name up. Undefined when unknown or ambiguous (see `ambiguous`). */
  get(name: string): OracleCard | undefined {
    return this.resolve(name).card;
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  /** Full names of the cards a name could mean when it is ambiguous (empty otherwise), sorted. */
  ambiguous(name: string): string[] {
    return this.resolve(name)
      .ambiguous.map((c) => c.name)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /** All token/emblem variants with this name or, for double-faced tokens, with a face of this name (empty if none). */
  tokens(name: string): OracleCard[] {
    for (const k of nameKeyVariants(name)) {
      const hit = this.tokenVariants.get(k);
      if (hit) return hit;
    }
    for (const k of looseKeyVariants(name)) {
      const hit = this.tokenAliases.get(k);
      if (hit) return hit;
    }
    return [];
  }

  cards(): IterableIterator<OracleCard> {
    return this.full.values();
  }

  allTokens(): OracleCard[] {
    return [...this.tokenVariants.values()].flat();
  }

  get size(): number {
    return this.full.size;
  }
  get aliasCount(): number {
    return this.aliases.size;
  }
  /** Face names shared by more than one card (they resolve by front-face rank, or are reported as ambiguous on a tie). */
  get sharedAliasCount(): number {
    let n = 0;
    for (const cands of this.aliases.values()) if (cands.length > 1) n++;
    return n;
  }
  get tokenNameCount(): number {
    return this.tokenVariants.size;
  }
  get tokenCount(): number {
    let n = 0;
    for (const v of this.tokenVariants.values()) n += v.length;
    return n;
  }

  /**
   * Did-you-mean suggestions from the local index only: names that start with / contain the
   * query, then names within a small edit distance. Never touches the network. Face aliases whose
   * name is also a real card name are skipped (they would only list the other card next to it).
   */
  suggest(name: string, limit = 5): string[] {
    const q = looseName(name);
    if (!q) return [];
    const maxDist = q.length < 3 ? 0 : Math.max(1, Math.floor(q.length / 4));
    const scored: Array<{ display: string; tier: number; dist: number }> = [];
    const consider = (key: string, display: string) => {
      let tier = 3;
      let dist = 0;
      if (key.startsWith(q) || (key.length >= 5 && q.startsWith(key))) tier = 0;
      else if (q.length >= 3 && key.includes(q)) tier = 1;
      else if (Math.abs(key.length - q.length) <= maxDist) {
        dist = boundedLevenshtein(key, q, maxDist);
        if (dist <= maxDist) tier = 2;
      }
      if (tier < 3) scored.push({ display, tier, dist });
    };
    for (const [key, cards] of this.looseFull) for (const card of cards) consider(key, card.name);
    for (const [key, cands] of this.aliases) {
      if (this.looseFull.has(key)) continue;
      for (const c of cands) consider(key, c.card.name);
    }
    scored.sort((a, b) => a.tier - b.tier || a.dist - b.dist || a.display.length - b.display.length || (a.display < b.display ? -1 : a.display > b.display ? 1 : 0));
    const out: string[] = [];
    for (const s of scored) {
      if (!out.includes(s.display)) out.push(s.display);
      if (out.length >= limit) break;
    }
    return out;
  }
}

/** Levenshtein distance, giving up (returning max+1) once it must exceed `max`. */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length] ?? max + 1;
}
