/**
 * GET /api/cards/search and GET /api/cards/:name (docs/design/m8-client.md, "Server API"; docs/design/decks-and-formats.md, "Deckbuilder").
 *
 * Search scans the local index (about 34k cards) with precomputed rows (search-query.ts) in folded Oracle-name order, ranks the matches by relevance
 * when the query names a card (exact name first, so typing "Island" shows Island on page 1), and pages them. Each result carries its automation level
 * from the classification index (automation.ts); a card the background build has not reached is compiled on the spot. The automation filter needs the
 * whole index classified, so until then it answers 503 with `code: 'indexBuilding'` and the progress. Detail compiles the card (compiled.ts) and lists
 * the parts players resolve by hand (design 10), each with a player-facing summary.
 */
import { legalitiesOf, legalityIn } from '@openmtg/cards';
import { COMPILER_VERSION, type CardDef } from '@openmtg/engine';
import type { CardDetailResponse, ManualCategory, ManualPart } from './api';
import { cardStore, storeError, type CardStore } from './cache';
import { badRequest, type Handler, type ServerContext } from './context';
import { parseSearch, searchRow, type SearchRow } from './search-query';
import { findSet, setLists, SetsUnavailableError, setsNamed } from './sets';
import { cardSummary, wantsImages } from './summary';

const rows = (store: CardStore): SearchRow[] => store.derived('searchRows', (s) => s.cards.map(searchRow));
/** Every format key the index has legality data for (sorted). */
const formatKeys = (store: CardStore): readonly string[] =>
  store.derived('formatKeys', (s) => [...new Set(s.cards.flatMap((c) => Object.keys(legalitiesOf(c) ?? {})))].sort());

/** How long a client waits before asking again while the classification index is built. */
export const INDEX_RETRY_MS = 5000;

export const searchCards: Handler<'GET /api/cards/search'> = async (req, ctx) => {
  const parsed = parseSearch(req.query);
  if (typeof parsed === 'string') return badRequest(parsed);
  const opened = await cardStore(ctx);
  if (!opened.ok) return storeError(opened);
  const { store } = opened;
  const tests = [...parsed.tests];
  const known = formatKeys(store);
  // f:, banned: and restricted: in a Scryfall query: a format the index has no data for would match nothing, which looks like a real answer.
  for (const k of parsed.scryFormats) {
    if (!known.includes(k)) return badRequest(`No card has legality data for the format "${k}" (in the Scryfall query); known formats: ${known.join(', ') || 'none'}`);
  }
  // s:, set:, e: and edition: in a Scryfall query: each set's cards come from Scryfall the first time (sets.ts).
  if (parsed.scrySets.length) {
    try {
      const lists = setLists(ctx);
      const sets = await lists.all();
      for (const named of parsed.scrySets) {
        const set = findSet(sets, named);
        if (typeof set === 'string') return badRequest(set);
        parsed.scrySetCards.set(named, await lists.cardsOf(set));
      }
    } catch (e) {
      if (e instanceof SetsUnavailableError) return badRequest(e.message);
      throw e;
    }
  }
  const key = parsed.formatKey;
  if (key !== undefined) {
    if (!known.includes(key)) return badRequest(`No card has legality data for the format "${req.query.format}"; known formats: ${known.join(', ') || 'none'}`);
    tests.push((r) => {
      const l = legalityIn(r.card, key);
      return l === 'legal' || l === 'restricted'; // no data: left out, never shown as legal
    });
  }
  if (parsed.automation && !store.automation.isComplete) {
    void store.automation.start();
    const p = store.automation.progress();
    return {
      status: 503,
      body: {
        error: `The automation index is still being built (${p.done} of ${p.total} cards classified); the automation filter works once it is done.`,
        code: 'indexBuilding',
        progress: { done: p.done, total: p.total },
        retryAfterMs: INDEX_RETRY_MS,
      },
    };
  }
  await store.automation.ready(); // levels cached on disk, so the page does not compile cards the cache knows
  const level = parsed.automation;
  // Plain search text that names a set ("star trek"): the set's cards match too, next to the cards with the text in their name or rules; the other
  // filters (and the format) still apply. Without the set lists (offline, none kept) it is the name and rules-text search alone.
  const inSet = await namedSetsCards(req.query, ctx);
  const bare = inSet ? parseSearch({ ...req.query, q: '', name: '' }) : null;
  const bareTests = bare && typeof bare !== 'string' ? [...bare.tests, ...tests.slice(parsed.tests.length)] : null;
  if (bare && typeof bare !== 'string') for (const [named, cards] of parsed.scrySetCards) bare.scrySetCards.set(named, cards); // the s: filters' lists
  const matchesRow = (r: SearchRow): boolean =>
    tests.every((t) => t(r)) || (inSet !== null && bareTests !== null && r.card.oracle_id !== undefined && inSet.has(r.card.oracle_id) && bareTests.every((t) => t(r)));
  const filtered = rows(store).filter((r) => matchesRow(r) && (!level || store.automation.peek(r.card) === level));
  const rank = parsed.rank;
  // Relevance first when the query names a card; the sort is stable, so Oracle-name order is kept within each tier.
  const matches = rank ? filtered.map((r) => ({ r, t: rank(r) })).sort((a, b) => a.t - b.t).map((x) => x.r) : filtered;
  const start = (parsed.page - 1) * parsed.pageSize;
  const cards = matches.slice(start, start + parsed.pageSize).map((r) => cardSummary(r.card, store.automation.levelOf(r.card), parsed.images));
  return { status: 200, body: { cards, page: parsed.page, pageSize: parsed.pageSize, total: matches.length } };
};

/** The Oracle ids of the cards in the sets that the plain search text names (sets.ts setsNamed), or null: no such set, or the set lists are not at hand. */
async function namedSetsCards(query: Record<string, string>, ctx: ServerContext): Promise<ReadonlySet<string> | null> {
  const text = query.q || query.name;
  if (!text) return null;
  try {
    const lists = setLists(ctx);
    const named = setsNamed(await lists.all(), text);
    if (!named.length) return null;
    const ids = new Set<string>();
    for (const set of named) for (const id of await lists.cardsOf(set)) ids.add(id);
    return ids;
  } catch (e) {
    if (e instanceof SetsUnavailableError) return null;
    throw e;
  }
}

/** GET /api/sets: every set, for the Advanced search form's Set field. */
export const listSets: Handler<'GET /api/sets'> = async (_req, ctx) => {
  try {
    return { status: 200, body: { sets: await setLists(ctx).all() } };
  } catch (e) {
    if (e instanceof SetsUnavailableError) return { status: 503, body: { error: e.message } };
    throw e;
  }
};

/** The player-facing sentence of each manual-part category (api.ts ManualPart `summary`). */
export const MANUAL_SUMMARY: Readonly<Record<ManualCategory, string>> = {
  'not-understood': 'OpenMTG does not understand this text yet: you resolve it by hand.',
  'needs-engine': 'OpenMTG reads this text but cannot run it yet: you resolve it by hand.',
  capped: 'OpenMTG cannot run this card yet: you play it by hand.',
  rejected: 'OpenMTG could not read this card: you play it by hand.',
};

/** The summary of a card capped at partial without a manual part of its own: the engine runs it, but not all of it. */
export const PARTIAL_CAP_SUMMARY = 'OpenMTG runs this card only in part: some of it you resolve by hand.';

/** Coarse category of a compiler diagnostic: "needs-engine: ..." reasons name missing engine support; anything else is text the compiler did not read. */
const categoryOf = (reason: string): ManualCategory => (/^needs-engine\b/i.test(reason) ? 'needs-engine' : 'not-understood');

/** A manual part with its category and player-facing summary; `reason` keeps the compiler's diagnostic. */
export function manualPart(face: number, text: string, reason: string, impact: ManualPart['impact'], category: ManualCategory = categoryOf(reason)): ManualPart {
  return { face, text, reason, impact, category, summary: MANUAL_SUMMARY[category] };
}

/** The manual parts of a compiled card, per face (design 10: the text players resolve by hand and why). */
export function manualParts(def: CardDef): ManualPart[] {
  const parts: ManualPart[] = [];
  const seen = new Set<string>();
  const add = (p: ManualPart): void => {
    const k = `${p.face}\u0000${p.text}\u0000${p.reason}`;
    if (!seen.has(k)) {
      seen.add(k);
      parts.push(p);
    }
  };
  const faces = def.automation.faces;
  if (faces) {
    faces.forEach((f, face) => f.abilities.forEach((a) => a.manual.forEach((m) => add(manualPart(face, m.text, m.reason, m.impact)))));
  } else {
    for (const text of def.automation.unsupported) {
      const face = Math.max(0, def.faces.findIndex((f) => f.oracleText.includes(text)));
      add(manualPart(face, text, 'not understood by the compiler', 'ability', 'not-understood'));
    }
  }
  if (parts.length === 0 && def.automation.level !== 'full') {
    // Capped without a manual node of its own (a layout the engine does not implement, an experimental template, a stub): still say why.
    const needs = def.automation.requiresEngine ?? [];
    const part = needs.length ? manualPart(0, '', `needs-engine: ${needs.join(', ')}`, 'ability', 'needs-engine') : manualPart(0, '', `the card is capped at ${def.automation.level}`, 'ability', 'capped');
    // A card capped at partial is still run by the engine in part: say so, not that the whole card is played by hand (that is the manual cap).
    add(def.automation.level === 'partial' && part.category === 'capped' ? { ...part, summary: PARTIAL_CAP_SUMMARY } : part);
  }
  return parts;
}

function compiledSummary(def: CardDef): CardDetailResponse['compiled'] {
  return {
    faces: def.faces.map((f, i) => {
      const units = def.automation.faces?.[i]?.abilities;
      const manual = units ? units.filter((u) => u.level !== 'full').length : f.abilities.filter((a) => a.kind === 'manual').length;
      return { name: f.name, abilities: f.abilities.length, manual };
    }),
    compilerVersion: def.automation.compilerVersion ?? COMPILER_VERSION,
  };
}

export const cardDetail: Handler<'GET /api/cards/:name'> = async (req, ctx) => {
  const name = (req.params.name ?? '').trim();
  if (!name || name.length > 300) return badRequest('A card name (at most 300 characters) is required');
  const opened = await cardStore(ctx);
  if (!opened.ok) return storeError(opened);
  const { store } = opened;
  const card = store.db.lookup(name);
  if (!card) {
    const { resolved } = await store.db.resolveNames([name]);
    const ambiguous = resolved[0]?.ambiguous;
    if (ambiguous?.length) return { status: 409, body: { error: `"${name}" is a face name of several cards: pick one`, suggestions: ambiguous } };
    return { status: 404, body: { error: `No card named "${name}" in the local index`, suggestions: store.db.suggest(name) } };
  }
  let def: CardDef;
  try {
    def = await store.defs.get(card);
  } catch (e) {
    const reason = `the compiler rejected the card: ${e instanceof Error ? e.message : String(e)}`;
    return {
      status: 200,
      body: { card: cardSummary(card, 'manual', wantsImages(req.query)), compiled: { faces: [], compilerVersion: COMPILER_VERSION }, manualParts: [manualPart(0, '', reason, 'ability', 'rejected')] },
    };
  }
  store.automation.record(card, def.automation.level);
  return { status: 200, body: { card: cardSummary(card, def.automation.level, wantsImages(req.query)), compiled: compiledSummary(def), manualParts: manualParts(def) } };
};
