/**
 * The saved deck (docs/design/decks-and-formats.md "Deck library"): name, format, main deck, sideboard, commander and companion slots, notes, dates and
 * an optional cover card. Cards are referenced by Oracle name and Oracle id so decks survive card-data refreshes. Pure helpers only: no storage here.
 */
import type { DeckEntry, DeckList, DeckSection } from '@openmtg/server/api';

export type { DeckEntry, DeckSection };

export interface Deck {
  id: string;
  name: string;
  /** Format id (formats.ts), e.g. "modern", "commander", "casual". */
  format: string;
  main: DeckEntry[];
  sideboard: DeckEntry[];
  commander: DeckEntry[];
  companion: DeckEntry[];
  notes: string;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  /** Oracle name of the card shown for the deck in the library. */
  cover?: string;
}

export const SECTIONS: readonly DeckSection[] = ['commander', 'companion', 'main', 'sideboard'];

export const SECTION_LABEL: Record<DeckSection, string> = {
  commander: 'Commander',
  companion: 'Companion',
  main: 'Main deck',
  sideboard: 'Sideboard',
};

/** A new id for a deck (random UUID when the browser has one). */
export function newDeckId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `deck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyDeck(name: string, format: string, now: string, id: string = newDeckId()): Deck {
  return { id, name, format, main: [], sideboard: [], commander: [], companion: [], notes: '', createdAt: now, updatedAt: now };
}

/** Number of cards in one section. */
export function sectionCount(deck: Deck, section: DeckSection): number {
  return deck[section].reduce((n, e) => n + e.count, 0);
}

/** Copies of a card in one section (0 when absent). */
export function countOf(deck: Deck, section: DeckSection, name: string): number {
  return deck[section].find((e) => e.name === name)?.count ?? 0;
}

/**
 * Add `delta` copies (negative removes) of a card to a section; entries at 0 disappear. Returns a new deck (the input is not changed). The section keeps
 * its insertion order so the list does not jump around while building.
 */
export function addCard(deck: Deck, section: DeckSection, card: { name: string; oracleId?: string }, delta = 1): Deck {
  const list = deck[section];
  const i = list.findIndex((e) => e.name === card.name);
  let next: DeckEntry[];
  if (i < 0) {
    if (delta <= 0) return deck;
    next = [...list, { name: card.name, count: delta, ...(card.oracleId ? { oracleId: card.oracleId } : {}) }];
  } else {
    const old = list[i]!;
    const count = old.count + delta;
    const entry: DeckEntry = { ...old, count, ...(card.oracleId && !old.oracleId ? { oracleId: card.oracleId } : {}) };
    next = count > 0 ? list.map((e, j) => (j === i ? entry : e)) : list.filter((_, j) => j !== i);
  }
  return { ...deck, [section]: next };
}

/** Move `count` copies (default: all) of a card from one section to another. */
export function moveCard(deck: Deck, from: DeckSection, to: DeckSection, name: string, count?: number): Deck {
  if (from === to) return deck;
  const entry = deck[from].find((e) => e.name === name);
  if (!entry) return deck;
  const n = Math.min(count ?? entry.count, entry.count);
  const card = { name, ...(entry.oracleId ? { oracleId: entry.oracleId } : {}) };
  return addCard(addCard(deck, from, card, -n), to, card, n);
}

/** Merge entries with the same name (counts add up), keeping first-seen order. */
export function mergeEntries(entries: readonly DeckEntry[]): DeckEntry[] {
  const out: DeckEntry[] = [];
  for (const e of entries) {
    const prev = out.find((o) => o.name === e.name);
    if (prev) {
      prev.count += e.count;
      if (!prev.oracleId && e.oracleId) prev.oracleId = e.oracleId;
    } else out.push({ ...e });
  }
  return out;
}

/** The deck as the validation API takes it. */
export function toDeckList(deck: Deck): DeckList {
  const list: DeckList = { main: deck.main, sideboard: deck.sideboard };
  if (deck.commander.length) list.commander = deck.commander;
  if (deck.companion.length) list.companion = deck.companion;
  return list;
}

/** Every distinct Oracle name in the deck, in section order. */
export function deckNames(deck: Deck): string[] {
  const seen = new Set<string>();
  for (const s of SECTIONS) for (const e of deck[s]) seen.add(e.name);
  return [...seen];
}

/** A copy under a new id and name ("Copy of ..."), with fresh dates. */
export function duplicateDeck(deck: Deck, now: string, id: string = newDeckId()): Deck {
  const copy = structuredCloneDeck(deck);
  return { ...copy, id, name: `Copy of ${deck.name}`, createdAt: now, updatedAt: now };
}

function structuredCloneDeck(deck: Deck): Deck {
  const clone = (l: DeckEntry[]) => l.map((e) => ({ ...e }));
  return { ...deck, main: clone(deck.main), sideboard: clone(deck.sideboard), commander: clone(deck.commander), companion: clone(deck.companion) };
}

/** Check that a value read back from storage looks like a deck (old or damaged records are skipped, never half-loaded). */
export function isDeck(v: unknown): v is Deck {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  const entries = (x: unknown) => Array.isArray(x) && x.every((e) => e && typeof e === 'object' && typeof (e as DeckEntry).name === 'string' && typeof (e as DeckEntry).count === 'number');
  return (
    typeof d.id === 'string' &&
    typeof d.name === 'string' &&
    typeof d.format === 'string' &&
    entries(d.main) &&
    entries(d.sideboard) &&
    entries(d.commander) &&
    entries(d.companion) &&
    typeof d.createdAt === 'string' &&
    typeof d.updatedAt === 'string'
  );
}
