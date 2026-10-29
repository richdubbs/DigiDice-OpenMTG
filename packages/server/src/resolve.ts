/**
 * POST /api/decks/resolve { text } (docs/design/m8-client.md, "Server API"; docs/design/decks-and-formats.md).
 *
 * Decklist text (Arena, MTGO or plain; the @openmtg/cards parser) -> Oracle cards from the local index only (never a Scryfall request from the API).
 * Unknown names come back with suggestions, and with a stub card the player may confirm instead (WP24, design 12.1) when the line has an explicit count
 * and a plausible card name (never for an ambiguous face name, prose or a CSV header). Deck-site links are recognized and answered with
 * export-and-paste steps; the site is never contacted, and the text around a link is ignored, never read as a card (deck-sites.ts).
 *
 * Cost. Suggestions are the slow part (a fuzzy scan of the whole index per name), so they are computed for the first MAX_SUGGESTED_UNKNOWN unknown names
 * only, in batches that yield to the event loop (other requests keep being answered), and text where most lines are not card names (a collection CSV,
 * an article, the wrong clipboard) answers 400 before any suggestion is scored.
 */
import { parseDecklist, type DeckLine, type IndexedCard, type ResolvedName } from '@openmtg/cards';
import { stubCardDef } from '@openmtg/engine';
import type { DeckSection, ResolvedCard, ResolveResponse, UnknownCard } from './api';
import { cardStore, isMeldResult, storeError } from './cache';
import { badRequest, type Handler } from './context';
import { extractDeckLinks } from './deck-sites';

/** Longest decklist text accepted (a 250-card list with set codes is about 10 KB). */
export const MAX_DECK_TEXT = 200_000;
/** Unknown names that get suggestions per request; the rest get none and an `errors` note says so. */
export const MAX_SUGGESTED_UNKNOWN = 100;
/** Suggestions scored between two yields to the event loop. */
const SUGGEST_BATCH = 10;

const SECTIONS: readonly DeckSection[] = ['main', 'sideboard', 'commander', 'companion'];

type ResolveError = ResolveResponse['errors'][number];

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** "4 Name", "4x Name", "SB: 2 Name": the line states how many copies. */
const EXPLICIT_COUNT = /^\s*(?:SB:\s*)?\d+\s*x?\s+\S/i;

/** A name that could be a card the index does not know yet: starts with a letter, digit, quote or bracket, holds a letter, is not prose ending in ":". */
function plausibleName(name: string): boolean {
  return name.length <= 150 && /^[\p{L}\p{N}"'(]/u.test(name) && /\p{L}/u.test(name) && !/[:;]$/.test(name) && !/[\t|]|:\/\//.test(name);
}

export const resolveDeck: Handler<'POST /api/decks/resolve'> = async (req, ctx) => {
  const body = req.body as { text?: unknown } | null;
  if (body === null || typeof body !== 'object' || typeof body.text !== 'string') return badRequest('Body must be { "text": string }');
  if (body.text.length > MAX_DECK_TEXT) return badRequest(`Decklist text is longer than ${MAX_DECK_TEXT} characters`);
  const { links, text, ignored } = extractDeckLinks(body.text);
  const errors: ResolveError[] = ignored.map((i) => ({ line: i.line, text: i.text, message: 'Text around a deck link was ignored' }));
  if (!/[\p{L}\p{N}]/u.test(text)) return { status: 200, body: { cards: [], unknown: [], errors, links, ignored: 0 } };

  const opened = await cardStore(ctx);
  if (!opened.ok) return storeError(opened);
  const { store } = opened;
  const parsed = parseDecklist(text);
  const sections = SECTIONS.map((s) => [s, parsed[s]] as const);
  const allLines = sections.flatMap(([, lines]) => lines);
  const { resolved } = await store.db.resolveNames([...new Set(allLines.map((l) => l.name))]); // local index only: fetchMissing stays off
  const byName = new Map<string, ResolvedName>(resolved.map((r) => [r.name, r]));
  const notCards = allLines.filter((l) => !byName.get(l.name)?.card && !byName.get(l.name)?.ambiguous).length;
  if (notCards > MAX_SUGGESTED_UNKNOWN && notCards * 2 > allLines.length) {
    return badRequest(`This does not look like a decklist (${notCards} of ${allLines.length} lines are not card names)`);
  }
  await store.automation.ready();

  const rawLines = text.split(/\r\n|\r|\n/);
  errors.push(...parsed.errors.map((e) => ({ line: e.line, text: e.text, message: e.message })));
  const cards: ResolvedCard[] = [];
  const unknown: UnknownCard[] = [];
  for (const [section, lines] of sections) {
    const merged = new Map<IndexedCard, ResolvedCard>();
    const missing = new Map<string, UnknownCard>();
    for (const l of lines) {
      const r = byName.get(l.name)!;
      const card = r.card as IndexedCard | null;
      if (card && isMeldResult(card)) {
        errors.push({ line: l.line, text: l.name, message: `${card.name} is the back face of a meld pair, not a card of its own (CR 712.4b): put the two cards of the pair in the deck instead` });
      } else if (card) {
        const m = merged.get(card);
        if (m) m.count += l.count;
        else merged.set(card, { section, count: l.count, name: card.name, oracleId: card.oracle_id ?? '', automation: store.automation.levelOf(card) });
      } else {
        const m = missing.get(l.name);
        if (m) m.count += l.count;
        else missing.set(l.name, unknownRow(section, l, r, rawLines[l.line - 1] ?? ''));
      }
    }
    cards.push(...merged.values());
    unknown.push(...missing.values());
  }
  await addSuggestions(unknown, (name) => store.db.suggest(name), errors);
  errors.sort((a, b) => a.line - b.line);
  return { status: 200, body: { cards, unknown, errors, links, ignored: parsed.maybeboard.length } };
};

/** The row of an unknown name in one section, at the line of its first occurrence in that section. */
function unknownRow(section: DeckSection, l: DeckLine, r: ResolvedName, raw: string): UnknownCard {
  const out: UnknownCard = { section, name: l.name, count: l.count, line: l.line, suggestions: [] };
  if (r.ambiguous?.length) {
    out.ambiguous = r.ambiguous;
    out.suggestions = r.ambiguous.slice(0, 5);
  } else if (EXPLICIT_COUNT.test(raw) && plausibleName(l.name)) {
    out.stub = stubCardDef(l.name, 'decklist');
  }
  return out;
}

/**
 * Close names (`suggest`, a fuzzy scan of the whole index) for the first MAX_SUGGESTED_UNKNOWN distinct `names`, yielding to the event loop between
 * batches so other requests keep being answered. Names past the cap are absent from the answer. Also used by POST /api/cards/defs (defs.ts).
 */
export async function pacedSuggestions(names: Iterable<string>, suggest: (name: string) => string[]): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  for (const [i, name] of [...new Set(names)].slice(0, MAX_SUGGESTED_UNKNOWN).entries()) {
    if (i > 0 && i % SUGGEST_BATCH === 0) await yieldToEventLoop();
    found.set(name, suggest(name));
  }
  return found;
}

/** Close names for the first MAX_SUGGESTED_UNKNOWN distinct unknown names, yielding between batches; a note in `errors` when some got none. */
async function addSuggestions(unknown: UnknownCard[], suggest: (name: string) => string[], errors: ResolveError[]): Promise<void> {
  const rows = unknown.filter((u) => !u.ambiguous);
  const found = await pacedSuggestions(rows.map((u) => u.name), suggest);
  for (const u of rows) u.suggestions = found.get(u.name) ?? [];
  const first = rows.find((u) => !found.has(u.name));
  if (first) errors.push({ line: first.line, text: first.name, message: `Suggestions are given for the first ${MAX_SUGGESTED_UNKNOWN} unknown names only` });
}
