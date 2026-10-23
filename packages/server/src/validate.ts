/**
 * POST /api/decks/validate { deck, format } (docs/design/m8-client.md, "Server API"; docs/design/decks-and-formats.md, "Format validation").
 *
 * The deck's names (or Oracle ids) are resolved in the local index, then checked by the format validator of @openmtg/cards (F1) through
 * formats-adapter.ts: deck size (CR 100.2a), copies (CR 100.2a, 903.5b), sideboard (CR 100.4a), banned / restricted / not legal (Scryfall legality data),
 * commander and companion rules (CR 903, 702.139). Every problem keeps the validator's rule citation and severity; a warning means something could not be
 * checked, never a pass: `status` is then 'unchecked', not 'legal', even though `valid` (no errors) is true. `format` echoes the request and `checkedAs`
 * names the validator's format ("freeform" is checked as casual).
 */
import type { IndexedCard } from '@openmtg/cards';
import type { DeckEntry, DeckProblem, ValidateRequest, ValidateResponse } from './api';
import { cardStore, storeError, type CardStore } from './cache';
import { badRequest, type ApiResult, type Handler } from './context';
import { f1Adapter, type AdapterDeck, type DeckPart, type FormatAdapter } from './formats-adapter';

const PARTS: readonly DeckPart[] = ['main', 'sideboard', 'commander', 'companion'];
const MAX_ENTRIES = 1000;

/** F1 problem code -> API problem kind. A code this table does not know is reported as `unknown`, never dropped. */
const KIND: Readonly<Record<string, DeckProblem['kind']>> = {
  'deck-too-small': 'size',
  'deck-too-large': 'size',
  'too-many-copies': 'copies',
  'copy-limit-unknown': 'copies',
  restricted: 'restricted',
  'restricted-unknown': 'restricted',
  banned: 'banned',
  'banned-as-commander': 'banned',
  'not-legal': 'notLegal',
  'no-legality-data': 'unknown',
  'unresolved-card': 'unknown',
  'sideboard-too-large': 'sideboard',
  'sideboard-not-allowed': 'sideboard',
  'color-identity': 'identity',
  'no-color-identity': 'identity',
  'commander-not-allowed': 'commander',
  'no-commander': 'commander',
  'too-many-commanders': 'commander',
  'not-a-commander': 'commander',
  'invalid-partners': 'commander',
  'commander-from-sideboard': 'commander',
  'companion-from-sideboard': 'companion',
  'too-many-companions': 'companion',
  'not-a-companion': 'companion',
  'companion-in-deck': 'companion',
  'companion-unchecked': 'companion',
  'companion-condition': 'companion', // CMP1 (CR 702.139a)
  'companion-ambiguous': 'companion', // CMP1 (CR 702.139a)
};

function entriesOf(v: unknown, part: string): DeckEntry[] | string {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return `deck.${part} must be an array`;
  if (v.length > MAX_ENTRIES) return `deck.${part} has more than ${MAX_ENTRIES} entries`;
  const out: DeckEntry[] = [];
  for (const e of v as unknown[]) {
    const x = e as Partial<DeckEntry> | null;
    if (x === null || typeof x !== 'object' || typeof x.name !== 'string' || x.name.trim() === '' || x.name.length > 300) return `Every deck.${part} entry needs a card name`;
    if (typeof x.count !== 'number' || !Number.isInteger(x.count) || x.count < 1 || x.count > 999) return `deck.${part} entry "${x.name}": count must be a whole number from 1 to 999`;
    if (x.oracleId !== undefined && typeof x.oracleId !== 'string') return `deck.${part} entry "${x.name}": oracleId must be a string`;
    out.push({ name: x.name, count: x.count, ...(x.oracleId ? { oracleId: x.oracleId } : {}) });
  }
  return out;
}

/** Parse and check the request body; a string is the 400 message. */
export function parseValidateRequest(body: unknown): ValidateRequest | string {
  const b = body as { deck?: unknown; format?: unknown } | null;
  if (b === null || typeof b !== 'object' || typeof b.format !== 'string' || b.deck === null || typeof b.deck !== 'object') return 'Body must be { "deck": DeckList, "format": string }';
  if (b.format.trim() === '' || b.format.length > 60) return 'format must be a format name, e.g. "modern"';
  const deck = b.deck as Record<string, unknown>;
  const out: ValidateRequest = { format: b.format, deck: { main: [], sideboard: [] } };
  for (const part of PARTS) {
    const entries = entriesOf(deck[part], part);
    if (typeof entries === 'string') return entries;
    if (entries.length || part === 'main' || part === 'sideboard') out.deck[part] = entries;
  }
  return out;
}

/** Deck entries -> index cards (by Oracle id first: decks keep it so they survive renames; then by name); unknown names stay unresolved. */
export function resolveDeck(store: CardStore, deck: ValidateRequest['deck']): AdapterDeck {
  const out: AdapterDeck = { main: [], sideboard: [], commander: [], companion: [], unresolved: [] };
  for (const part of PARTS) {
    const merged = new Map<IndexedCard, number>();
    for (const e of deck[part] ?? []) {
      const card = (e.oracleId ? store.byOracleId(e.oracleId) : undefined) ?? (store.db.lookup(e.name) as IndexedCard | undefined);
      if (card) merged.set(card, (merged.get(card) ?? 0) + e.count);
      else out.unresolved.push({ section: part, name: e.name, count: e.count });
    }
    out[part] = [...merged].map(([card, count]) => ({ card, count }));
  }
  return out;
}

/** Validate with a given adapter (tests pass a fake one). */
export function validateWith(store: CardStore, request: ValidateRequest, adapter: FormatAdapter): ApiResult<'POST /api/decks/validate'> {
  // "freeform" (api.ts) is F1's "casual": no card-pool or construction limits.
  const format = request.format.trim().toLowerCase() === 'freeform' ? 'casual' : request.format;
  const report = adapter.validate(resolveDeck(store, request.deck), format);
  if ('unknownFormat' in report) return badRequest(`Unknown format "${request.format}"${report.known.length ? `; known formats: ${report.known.join(', ')}` : ''}`);
  const problems: DeckProblem[] = report.problems.map((p) => ({
    kind: KIND[p.code] ?? 'unknown',
    severity: p.severity,
    message: p.message,
    ...(p.card !== undefined ? { card: p.card } : {}),
    rules: p.rule ? [p.rule] : [],
  }));
  const body: ValidateResponse = {
    format: request.format, checkedAs: report.formatId, valid: report.valid, status: statusOf(report.valid, problems), problems,
    ...(report.companion !== undefined ? { companion: report.companion } : {}),
  };
  return { status: 200, body };
}

/** 'illegal' with an error; 'unchecked' with a warning (something could not be checked: never shown as legal); 'legal' otherwise (notes are informational). */
export function statusOf(valid: boolean, problems: readonly DeckProblem[]): ValidateResponse['status'] {
  if (!valid || problems.some((p) => p.severity === 'error')) return 'illegal';
  return problems.some((p) => p.severity === 'warning') ? 'unchecked' : 'legal';
}

export const validateDeck: Handler<'POST /api/decks/validate'> = async (req, ctx) => {
  const request = parseValidateRequest(req.body);
  if (typeof request === 'string') return badRequest(request);
  const adapter = f1Adapter();
  const opened = await cardStore(ctx);
  if (!opened.ok) return storeError(opened);
  return validateWith(opened.store, request, adapter);
};
