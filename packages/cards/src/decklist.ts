/**
 * Decklist text parser. Accepts plain lists ("4 Lightning Bolt", "4x Lightning Bolt", "Lightning Bolt"),
 * Arena/MTGO exports ("4 Lightning Bolt (M10) 146"), section headers, MTGO-style blank-line
 * sideboards, "SB:" prefixes, comments (// or #) and stray whitespace. Pure: no I/O.
 */
export type DeckSection = 'main' | 'sideboard' | 'commander' | 'companion' | 'maybeboard';

export interface DeckLine {
  count: number;
  name: string;
  /** 1-based line number in the input. */
  line: number;
  /** Set code from "(M10)" if present (informational). */
  set?: string;
  collectorNumber?: string;
}

export interface DeckParseError {
  line: number;
  text: string;
  message: string;
}

export interface ParsedDecklist {
  main: DeckLine[];
  sideboard: DeckLine[];
  commander: DeckLine[];
  companion: DeckLine[];
  /** Parsed but not part of the game (maybeboard / considering). */
  maybeboard: DeckLine[];
  errors: DeckParseError[];
}

const MAX_COUNT = 999;

const HEADERS: Record<string, DeckSection | 'about'> = {
  deck: 'main',
  main: 'main',
  mainboard: 'main',
  'main deck': 'main',
  maindeck: 'main',
  sideboard: 'sideboard',
  'side board': 'sideboard',
  side: 'sideboard',
  sb: 'sideboard',
  commander: 'commander',
  commanders: 'commander',
  companion: 'companion',
  maybeboard: 'maybeboard',
  'maybe board': 'maybeboard',
  maybe: 'maybeboard',
  considering: 'maybeboard',
  about: 'about',
};

function headerOf(text: string): DeckSection | 'about' | undefined {
  const key = text.replace(/[:\s]+$/, '').toLowerCase();
  return HEADERS[key];
}

// "4 Lightning Bolt", "4x Lightning Bolt", "4 x Lightning Bolt". A bare number is not an entry.
const COUNT_RE = /^(\d+)\s*[xX]?\s+(.+)$/;
// "Lightning Bolt (M10) 146" / "(M10)" / with finish marker "*F*" or "*E*".
const SET_RE = /^(.*?)\s+\(([A-Za-z0-9]{2,6})\)(?:\s+(\S+))?(?:\s+\*[A-Za-z]+\*)?$/;

export function parseDecklist(text: string): ParsedDecklist {
  const out: ParsedDecklist = { main: [], sideboard: [], commander: [], companion: [], maybeboard: [], errors: [] };
  let section: DeckSection | 'about' = 'main';
  let sawHeader = false;
  let blankSwitchUsed = false;
  let sectionHasEntries = false;

  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    let line = rawLine.replace(/ /g, ' ').trim();

    if (line === '') {
      // MTGO format: a blank line after the main deck starts the sideboard (only without explicit headers).
      if (!sawHeader && !blankSwitchUsed && section === 'main' && sectionHasEntries) {
        section = 'sideboard';
        blankSwitchUsed = true;
        sectionHasEntries = false;
      }
      return;
    }
    if (line.startsWith('//') || line.startsWith('#')) return;

    const header = headerOf(line);
    if (header) {
      section = header;
      sawHeader = true;
      sectionHasEntries = false;
      return;
    }
    if (section === 'about') return; // Arena "About" block: "Name My Deck"

    let target: DeckSection = section;
    const sb = /^SB:\s*(.*)$/i.exec(line);
    if (sb) {
      target = 'sideboard';
      line = (sb[1] ?? '').trim();
    }

    let count = 1;
    let rest = line;
    const c = COUNT_RE.exec(line);
    if (c) {
      count = Number(c[1]);
      rest = (c[2] ?? '').trim();
    } else if (/^\d+$/.test(line)) {
      out.errors.push({ line: lineNo, text: rawLine, message: 'Missing card name after the count' });
      return;
    }
    if (count < 1) {
      out.errors.push({ line: lineNo, text: rawLine, message: `Count must be at least 1 (got ${count})` });
      return;
    }
    if (count > MAX_COUNT) {
      out.errors.push({ line: lineNo, text: rawLine, message: `Count ${count} is unreasonably large (max ${MAX_COUNT})` });
      return;
    }

    const entry: DeckLine = { count, name: rest, line: lineNo };
    const s = SET_RE.exec(rest);
    if (s && s[1]) {
      entry.name = s[1].trim();
      entry.set = s[2]!;
      if (s[3]) entry.collectorNumber = s[3];
    }
    entry.name = entry.name.replace(/\s+/g, ' ');
    if (!entry.name || !/[\p{L}\p{N}]/u.test(entry.name)) {
      out.errors.push({ line: lineNo, text: rawLine, message: 'Missing card name' });
      return;
    }
    out[target].push(entry);
    if (target === section) sectionHasEntries = true;
  });
  return out;
}

/** Total number of cards in a list of entries. */
export function totalCount(entries: Array<{ count: number }>): number {
  return entries.reduce((n, e) => n + e.count, 0);
}
