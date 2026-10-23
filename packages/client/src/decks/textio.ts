/**
 * Decklist text in and out (docs/design/decks-and-formats.md "Import" / "Export"). Export writes Arena, MTGO or plain text that the existing parser
 * (packages/cards/src/decklist.ts, behind POST /api/decks/resolve) reads back; import turns a resolve answer into a deck. Pure: no I/O.
 */
import type { ResolveResponse } from '@openmtg/server/api';
import { findFormatId, formatOption } from './formats';
import { emptyDeck, mergeEntries, type Deck, type DeckEntry, type DeckSection } from './model';

export type ExportFormat = 'arena' | 'mtgo' | 'plain';

export const EXPORT_FORMATS: readonly { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'arena', label: 'Arena', hint: 'MTG Arena import: About/Name, Commander, Companion, Deck and Sideboard blocks.' },
  { id: 'mtgo', label: 'MTGO', hint: 'MTGO text: main deck, a blank line, then the sideboard. MTGO has no commander block, so the commander and companion go in the sideboard.' },
  { id: 'plain', label: 'Plain text', hint: 'Readable text with a header per section; also keeps the deck name, format, cover card and notes (best for a backup).' },
];

const lines = (entries: readonly DeckEntry[]) => entries.map((e) => `${e.count} ${e.name}`);

function block(header: string, entries: readonly DeckEntry[]): string[] {
  return entries.length ? [header, ...lines(entries), ''] : [];
}

/** The deck as text in one of the export formats (ends with a newline). */
export function exportDeck(deck: Deck, format: ExportFormat): string {
  let out: string[];
  switch (format) {
    case 'arena':
      out = ['About', `Name ${deck.name}`, '', ...block('Commander', deck.commander), ...block('Companion', deck.companion), 'Deck', ...lines(deck.main), ''];
      if (deck.sideboard.length) out.push('Sideboard', ...lines(deck.sideboard), '');
      break;
    case 'mtgo': {
      const side = [...deck.commander, ...deck.companion, ...deck.sideboard];
      if (deck.main.length) {
        out = [...lines(deck.main)];
        if (side.length) out.push('', ...lines(side));
      } else {
        // Without main-deck lines the parser cannot tell where the sideboard starts, so mark each line (the parser reads "SB:").
        out = side.map((e) => `SB: ${e.count} ${e.name}`);
      }
      out.push('');
      break;
    }
    case 'plain':
      out = [`// ${deck.name}`, `// Format: ${formatOption(deck.format).name}`, ...headerExtras(deck), '', ...block('Commander', deck.commander), ...block('Companion', deck.companion)];
      out.push(...block('Main', deck.main), ...block('Sideboard', deck.sideboard));
      if (!deck.main.length && !deck.sideboard.length && !deck.commander.length && !deck.companion.length) out.push('Main', '');
      break;
  }
  return out.join('\n').replace(/\n+$/, '\n');
}

/** The plain export's cover and notes comments ("// Cover: ...", "// Notes: ..." then one "// " line per further notes line). */
function headerExtras(deck: Deck): string[] {
  const out: string[] = [];
  if (deck.cover) out.push(`// Cover: ${deck.cover}`);
  const notes = deck.notes.replace(/\s+$/, '');
  if (notes) notes.split(/\r\n|\r|\n/).forEach((l, i) => out.push(i === 0 ? `// Notes: ${l}` : l ? `// ${l}` : '//'));
  return out;
}

/** A file name for the downloaded text. */
export function exportFileName(deck: Deck, format: ExportFormat): string {
  const base = deck.name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'deck';
  return `${base} (${format === 'plain' ? 'text' : format}).txt`;
}

export interface DeckHeader {
  name?: string;
  format?: string;
  cover?: string;
  notes?: string;
}

/**
 * Deck details written in the text itself: Arena "About / Name ...", or the plain export's leading comments ("// name", "// Format: ...",
 * "// Cover: ...", then "// Notes: ..." and every further comment line as the notes).
 */
export function readDeckHeader(text: string): DeckHeader {
  const all = text.replace(/^﻿/, '').split(/\r\n|\r|\n/).map((l) => l.trimEnd());
  const out: DeckHeader = {};
  const about = all.findIndex((l) => /^about:?$/i.test(l.trim()));
  if (about >= 0) {
    const nameLine = all.slice(about + 1).find((l) => l.trim() !== '');
    const m = nameLine && /^name\s+(.+)$/i.exec(nameLine.trim());
    if (m) out.name = m[1]!.trim();
  }
  let notes: string[] | null = null;
  for (const l of all) {
    // Only the leading comment block; blank lines end the notes but not the block.
    if (l.trim() === '') {
      if (notes) break;
      continue;
    }
    const c = /^\s*(?:\/\/|#) ?(.*)$/.exec(l);
    if (!c) break;
    const body = c[1]!;
    if (notes) {
      notes.push(body);
      continue;
    }
    const field = /^(format|cover|notes):\s?(.*)$/i.exec(body.trim());
    const key = field?.[1]!.toLowerCase();
    if (key === 'format') {
      const id = findFormatId(field![2]!);
      if (id) out.format = id;
    } else if (key === 'cover') {
      if (field![2]!.trim()) out.cover = field![2]!.trim();
    } else if (key === 'notes') notes = [field![2]!];
    else if (!out.name && body.trim()) out.name = body.trim();
  }
  if (notes) {
    const text = notes.join('\n').replace(/\s+$/, '');
    if (text) out.notes = text;
  }
  return out;
}

/** The text is just a link (a deck-site URL): resolve answers it with export steps instead of cards. */
export function looksLikeLink(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

/** Steps shown when a link is pasted but the server did not recognize the site (the recognized ones come from POST /api/decks/resolve). */
export const GENERIC_LINK_STEPS = [
  "Open the deck on its site and use the site's Export option to copy the list as text (MTGO or Arena format).",
  'Paste that text here.',
];

/** Build a deck from a resolve answer: resolved cards only (unknown names are reported to the player, not added). */
export function deckFromResolve(res: ResolveResponse, opts: { name: string; format: string; now: string; id?: string; notes?: string; cover?: string }): Deck {
  const deck = emptyDeck(opts.name, opts.format, opts.now, opts.id);
  const by: Record<DeckSection, DeckEntry[]> = { main: [], sideboard: [], commander: [], companion: [] };
  for (const c of res.cards) by[c.section].push({ name: c.name, count: c.count, oracleId: c.oracleId });
  return {
    ...deck,
    main: mergeEntries(by.main),
    sideboard: mergeEntries(by.sideboard),
    commander: mergeEntries(by.commander),
    companion: mergeEntries(by.companion),
    ...(opts.notes ? { notes: opts.notes } : {}),
    ...(opts.cover ? { cover: opts.cover } : {}),
  };
}

/**
 * The list text with one line's card name replaced (the player accepted a suggestion for an unknown name). `line` is 1-based, as the resolve answer
 * reports it; the count, section prefix ("SB:") and set code on the line stay. Returns the text unchanged when the line does not hold that name.
 */
export function replaceLineName(text: string, line: number, from: string, to: string): string {
  const lines = text.split(/\r\n|\r|\n/);
  const l = lines[line - 1];
  if (l === undefined) return text;
  const at = l.toLowerCase().indexOf(from.toLowerCase());
  if (at < 0) return text;
  lines[line - 1] = l.slice(0, at) + to + l.slice(at + from.length);
  return lines.join('\n');
}

/** "3 maybeboard cards were left out." / "1 maybeboard card will be left out." (resolve's `ignored`). */
export function ignoredText(n: number, verb: 'were' | 'will be'): string {
  const v = verb === 'were' ? (n === 1 ? 'was' : 'were') : verb;
  return `${n} maybeboard card${n === 1 ? '' : 's'} ${v} left out.`;
}

/** Total cards a resolve answer would add. */
export function resolvedCount(res: ResolveResponse): number {
  return res.cards.reduce((n, c) => n + c.count, 0);
}
