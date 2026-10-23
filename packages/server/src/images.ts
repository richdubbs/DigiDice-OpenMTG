/**
 * POST /api/images/match { fileNames, deckNames? } (docs/design/m8-client.md, "Server API" and "Images" screen; ARCHITECTURE.md "Card images" A).
 *
 * Only file NAMES reach the server, never the images (they stay in the player's browser). Each file name is turned into card-name candidates
 * (image-names.ts) and resolved with the image-slot resolver of @openmtg/cards (`matchImageName`: full and face names, loose spelling, token variants,
 * Art Series names), one slot per printed side (design 12.2). Names from the player's decklist win ties and guide fuzzy matches.
 *
 * Confidence (the client sends anything below its threshold to the review screen):
 *   1.0   the name is exactly one card side (strict spelling)
 *   0.95  the same with a loose spelling (punctuation, case) or after cleaning the file name (set code, numbering, copy marker)
 *   0.9   several slots matched and the decklist (or a front/back marker) picked one
 *   0.6   several slots matched and nothing told them apart (token variants, a name that is a card and a token): alternatives listed
 *   <0.85 a fuzzy match (similarity times 0.85 for a deck name, 0.7 for any other card); below 0.6 similarity no match is proposed
 */
import { looseName, matchImageName, normalizeName, slotsOfCard, type CardDatabase, type ImageMatch } from '@openmtg/cards';
import type { ImageFileMatch, ImageSlotMatch } from './api';
import { cardStore, storeError } from './cache';
import { badRequest, type Handler } from './context';
import { nameCandidates, similarity, type NameCandidate, type Side } from './image-names';

export const MAX_FILES = 2000;
export const MAX_DECK_NAMES = 500;
/** Unmatched files that get a fuzzy search over the whole index per request (each scans about 40k names). */
const MAX_INDEX_FUZZY = 300;
const MIN_SIMILARITY = 0.6;

const slot = (m: Pick<ImageMatch, 'key' | 'label' | 'card'>): ImageSlotMatch => ({ key: m.key, label: m.label, card: m.card });

function dedupe(matches: ImageSlotMatch[]): ImageSlotMatch[] {
  const seen = new Set<string>();
  return matches.filter((m) => !seen.has(m.key) && seen.add(m.key) !== undefined);
}

/** What the decklist tells the matcher: its cards' Oracle names, their face names, and the slot keys of the tokens they make. */
export interface DeckHints {
  cards: ReadonlySet<string>;
  /** Loose names (full and face names) of the deck's cards, for fuzzy matching. */
  names: ReadonlyMap<string, string>;
  tokenKeys: ReadonlySet<string>;
}

export function deckHints(db: CardDatabase, deckNames: readonly string[]): DeckHints {
  const cards = new Set<string>();
  const names = new Map<string, string>();
  const tokenKeys = new Set<string>();
  for (const n of deckNames) {
    const card = db.lookup(n);
    if (!card || cards.has(card.name)) continue;
    cards.add(card.name);
    names.set(looseName(card.name), card.name);
    for (const f of card.card_faces ?? []) names.set(looseName(f.name), f.name);
    const creators = new Set([card.name, ...(card.card_faces ?? []).map((f) => f.name)]);
    for (const part of card.all_parts ?? []) {
      if (part.component !== 'token' || part.name === card.name) continue;
      const variants = db.lookupTokens(part.name);
      const made = variants.filter((t) => (t.all_parts ?? []).some((p) => creators.has(p.name)));
      for (const t of made.length ? made : variants) for (const s of slotsOfCard(t)) tokenKeys.add(s.key);
    }
  }
  return { cards, names, tokenKeys };
}

const inDeck = (hints: DeckHints, m: ImageSlotMatch): boolean => hints.cards.has(m.card) || hints.tokenKeys.has(m.key);

/**
 * The slots a candidate name means, with a front/back marker applied to a card with several printed sides. `artSeries`: also read the name as an Art
 * Series name ("A // B" depicting A and B); off in the first pass, so "Delver of Secrets - back" is not read as the Art Series pair "Delver of Secrets // back".
 */
function slotsFor(db: CardDatabase, name: string, side: Side | undefined, artSeries: boolean): ImageSlotMatch[] {
  const found = matchImageName(db, name)
    .filter((m) => artSeries || m.via !== 'artSeries')
    .map(slot);
  if (!side || found.length === 0) return found;
  const card = db.lookup(name);
  const all = card ? slotsOfCard(card) : [];
  if (all.length < 2) return found;
  const picked = all[side === 'front' ? 0 : 1]!;
  return dedupe([slot({ key: picked.key, label: picked.label, card: card!.name }), ...all.map((s) => slot({ key: s.key, label: s.label, card: card!.name })), ...found]);
}

/** Layouts printed as one picture with both face names on it (CR 709 split, 710 flip, 715 adventure, 722 prepare). */
const ONE_PICTURE = new Set(['split', 'flip', 'adventure', 'prepare']);
const facePairs = new WeakMap<CardDatabase, ReadonlyMap<string, string>>();

/** Loose "FaceA FaceB" -> full name of each one-picture card with two faces (file names cannot hold "//"; "Fire Ice", "Fire_Ice", "Fire-Ice"). */
function facePairsOf(db: CardDatabase): ReadonlyMap<string, string> {
  let pairs = facePairs.get(db);
  if (!pairs) {
    const map = new Map<string, string>();
    for (const card of db.cards()) {
      const faces = card.card_faces ?? [];
      if (faces.length === 2 && ONE_PICTURE.has(card.layout)) map.set(looseName(`${faces[0]!.name} ${faces[1]!.name}`), card.name);
    }
    pairs = map;
    facePairs.set(db, pairs);
  }
  return pairs;
}

/** The file name's readings, plus the full name of a one-picture card whose two face names a reading holds without "//". */
function candidatesOf(db: CardDatabase, fileName: string): NameCandidate[] {
  const candidates = nameCandidates(fileName);
  const pairs = facePairsOf(db);
  const extra = [...new Set(candidates.flatMap((c) => pairs.get(looseName(c.name)) ?? []))].map((name) => ({ name }));
  return [...candidates, ...extra];
}

function exactMatch(db: CardDatabase, fileName: string, hints: DeckHints): ImageFileMatch | null {
  const candidates = candidatesOf(db, fileName);
  for (const artSeries of [false, true]) {
    const hit = exactMatchPass(db, fileName, candidates, hints, artSeries);
    if (hit) return hit;
  }
  return null;
}

/**
 * A later reading that marks a printed side of the same card (a front/back marker), when the card has several printed sides: it wins over a side-less
 * reading, so a back-face file is never bound to the front.
 */
function sidedReading(db: CardDatabase, candidates: readonly NameCandidate[], from: number, cardName: string): NameCandidate | undefined {
  const card = db.lookup(cardName);
  if (!card || slotsOfCard(card).length < 2) return undefined;
  return candidates.slice(from).find((c) => c.side && db.lookup(c.name)?.name === cardName);
}

function exactMatchPass(db: CardDatabase, fileName: string, candidates: readonly NameCandidate[], hints: DeckHints, artSeries: boolean): ImageFileMatch | null {
  for (const [index, candidate] of candidates.entries()) {
    let i = index;
    let { name, side } = candidate;
    let found = slotsFor(db, name, side, artSeries);
    if (found.length === 0) continue;
    const sided = side ? undefined : sidedReading(db, candidates, index + 1, found[0]!.card);
    if (sided) {
      ({ name, side } = sided);
      found = slotsFor(db, name, side, artSeries);
      i = candidates.indexOf(sided);
    }
    const card = db.lookup(name);
    const preferred = found.filter((m) => inDeck(hints, m));
    let best: ImageSlotMatch;
    let confidence: number;
    if (found.length === 1) {
      best = found[0]!;
      const spelled = card ? [card.name, ...(card.card_faces ?? []).map((f) => f.name)].map(normalizeName) : [normalizeName(best.label)];
      confidence = i === 0 && spelled.includes(normalizeName(name)) ? 1 : 0.95;
    } else if (side && card && slotsOfCard(card).length > 1) {
      best = found[0]!; // slotsFor put the marked side first
      confidence = 0.9;
    } else if (preferred.length === 1) {
      best = preferred[0]!;
      confidence = 0.9;
    } else {
      best = (preferred[0] ?? found[0])!;
      confidence = 0.6;
    }
    return { fileName, match: best, confidence, alternatives: found.filter((m) => m.key !== best.key) };
  }
  return null;
}

function fuzzyMatch(db: CardDatabase, fileName: string, hints: DeckHints, searchIndex: boolean): ImageFileMatch {
  const names = [...new Set(candidatesOf(db, fileName).map((c) => c.name))];
  const query = names[names.length - 1] ?? ''; // the most cleaned-up reading
  const scored: { name: string; score: number; deck: boolean }[] = [];
  for (const q of names) {
    const lq = looseName(q);
    for (const [loose, display] of hints.names) scored.push({ name: display, score: similarity(lq, loose), deck: true });
  }
  if (searchIndex && query) for (const n of db.suggest(query, 5)) scored.push({ name: n, score: similarity(looseName(query), looseName(n)), deck: hints.cards.has(n) });
  scored.sort((a, b) => b.score * (b.deck ? 0.85 : 0.7) - a.score * (a.deck ? 0.85 : 0.7));
  const alternatives: ImageSlotMatch[] = [];
  let best: { slot: ImageSlotMatch; confidence: number } | null = null;
  for (const s of scored) {
    if (s.score < (s.deck ? MIN_SIMILARITY : 0.3)) continue;
    const slots = matchImageName(db, s.name).map(slot);
    if (slots.length === 0) continue;
    if (!best && s.score >= MIN_SIMILARITY) best = { slot: slots[0]!, confidence: Math.round(s.score * (s.deck ? 0.85 : 0.7) * 100) / 100 };
    alternatives.push(...slots);
  }
  const alts = dedupe(alternatives).filter((m) => m.key !== best?.slot.key).slice(0, 8);
  return { fileName, match: best?.slot ?? null, confidence: best?.confidence ?? 0, alternatives: alts };
}

/** What tells a slot apart from others with its label: the part of its key in parentheses (a token's look), or else the whole key. */
function slotDetail(m: ImageSlotMatch): string {
  return /\((.+)\)$/.exec(m.key)?.[1] ?? m.key;
}

/**
 * The review screen shows the labels as buttons: slots offered for one file never share a label. Token variants with one name ("Giant token" 4/4 red-blue,
 * 7/7 green, ...) get their look from the key; a label that is already unique is unchanged.
 */
export function withDistinctLabels(m: ImageFileMatch): ImageFileMatch {
  const offered = [...(m.match ? [m.match] : []), ...m.alternatives];
  const count = new Map<string, number>();
  for (const s of offered) count.set(s.label, (count.get(s.label) ?? 0) + 1);
  if ([...count.values()].every((n) => n === 1)) return m;
  const relabel = (s: ImageSlotMatch): ImageSlotMatch => (count.get(s.label)! > 1 ? { ...s, label: `${s.label} (${slotDetail(s)})` } : s);
  return { ...m, match: m.match ? relabel(m.match) : null, alternatives: m.alternatives.map(relabel) };
}

const matchOne = (db: CardDatabase, f: string, hints: DeckHints, searchIndex: boolean): ImageFileMatch =>
  withDistinctLabels(exactMatch(db, f, hints) ?? fuzzyMatch(db, f, hints, searchIndex));

/** Match every file name (pure apart from the database: no I/O). */
export function matchFileNames(db: CardDatabase, fileNames: readonly string[], deckNames: readonly string[] = []): ImageFileMatch[] {
  const hints = deckHints(db, deckNames);
  let fuzzyBudget = MAX_INDEX_FUZZY;
  return fileNames.map((f) => matchOne(db, f, hints, fuzzyBudget-- > 0));
}

/** Files matched between two yields to the event loop (a fuzzy search over the whole index takes tens of milliseconds). */
const MATCH_BATCH = 10;

/** `matchFileNames` for the endpoint: the same answers, yielding to the event loop between batches so other requests keep being answered. */
export async function matchFileNamesAsync(db: CardDatabase, fileNames: readonly string[], deckNames: readonly string[] = []): Promise<ImageFileMatch[]> {
  const hints = deckHints(db, deckNames);
  let fuzzyBudget = MAX_INDEX_FUZZY;
  const out: ImageFileMatch[] = [];
  for (const [i, f] of fileNames.entries()) {
    if (i > 0 && i % MATCH_BATCH === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    out.push(matchOne(db, f, hints, fuzzyBudget-- > 0));
  }
  return out;
}

function stringArray(v: unknown, field: string, max: number): string[] | string {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || x.length > 300)) return `${field} must be an array of strings (at most 300 characters each)`;
  if (v.length > max) return `At most ${max} ${field} per request`;
  return v as string[];
}

export const matchImages: Handler<'POST /api/images/match'> = async (req, ctx) => {
  const body = req.body as { fileNames?: unknown; deckNames?: unknown } | null;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return badRequest('Body must be { "fileNames": string[], "deckNames"?: string[] }');
  const fileNames = stringArray(body.fileNames, 'fileNames', MAX_FILES);
  if (typeof fileNames === 'string') return badRequest(fileNames);
  const deckNames = body.deckNames === undefined ? [] : stringArray(body.deckNames, 'deckNames', MAX_DECK_NAMES);
  if (typeof deckNames === 'string') return badRequest(deckNames);
  if (fileNames.length === 0) return { status: 200, body: { matches: [] } };
  const opened = await cardStore(ctx);
  if (!opened.ok) return storeError(opened);
  return { status: 200, body: { matches: await matchFileNamesAsync(opened.store.db, fileNames, deckNames) } };
};
