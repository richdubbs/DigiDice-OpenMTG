/**
 * Front end step 3: tokens (design 6.1 step 4, 6.2). Owner: WP5.
 *
 * `tokenize(parseText, opts)` turns (a range of) the parse text of a face into tokens:
 *
 *   WORD    a word, lower-cased in `norm`, with `cap` when it was written with a capital; apostrophes and hyphens inside a word stay ("creature's", "face-down");
 *           number words carry `value`; "non" in "nonblack" / "non-Human" is split off as its own WORD (both pieces `split`); a card name after "named" or
 *           "partner with" is one WORD with `name`; `'s` after "~" is a WORD "'s"
 *   NUM     a number ("3", "10")
 *   X       a standalone X
 *   MANA    one mana symbol of CR 107.4 in braces: {2} {R} {W/U} {2/W} {C/W} {W/P} {W/U/P} {X} {Y} {S} {C}, and {E} (energy, CR 107.14); `norm` is the body.
 *           Any other brace group is an ERR: {CHAOS} {PW} {TK} {P} {H} are symbols of the rules that are not mana ("unsupported symbol"), the rest is unknown
 *   TAP     {T} (norm "T") or {Q} (norm "Q", the untap symbol)
 *   PT      a power/toughness pair: 2/2, star/star, X/X, 1+star/2+star (`pt`)
 *   MOD     a power/toughness modification: +1/+1, -2/-0, +X/+X (`mod`)
 *   ROMAN   a Roman numeral 1-20 written in capitals (I, II, IV...); a lone X is an X
 *   SELF    "~", the object itself; its range covers the words it replaced
 *   PUNCT   . , ; : ! ? ( ) [ ] / + - -- | = * & % # @ < >
 *   BULLET  the modal bullet
 *   QUOTE   a quoted ability: `sub` holds its tokens (a sub-stream with its own self scope, design 6.2), `quote` the delimiter
 *   ERR     a character or construct the parser has no word for (unknown symbol, unmatched quote). A unit that contains one can never be accepted (guard G1/G2).
 *
 * All ranges are absolute in the string that was passed in. Pure and total: it never throws.
 */
import { GENERATED_LEXICON, lexiconIndex, NUMBER_WORDS, type LexiconIndex } from './front/lexicon-index';
import { scanQuotes, type QuoteSpan } from './front/quotes';
import { nameIndex } from './front/names';
import type { Lexicon, ParseOptions } from './types';

export const OWNER = 'WP5' as const;

export type TokenKind = 'WORD' | 'NUM' | 'X' | 'MANA' | 'TAP' | 'PT' | 'MOD' | 'ROMAN' | 'SELF' | 'GRANTOR' | 'PUNCT' | 'BULLET' | 'QUOTE' | 'ERR';

export interface Token {
  kind: TokenKind;
  /** The characters covered by `range`. */
  text: string;
  /** Canonical form: lower-case word, upper-case symbol body, the number as written, "~" for SELF, the punctuation, the quoted text for QUOTE. */
  norm: string;
  range: [number, number];
  /** NUM, ROMAN and number words ("three"). */
  value?: number;
  /** WORD: written with a capital letter. */
  cap?: boolean;
  /** WORD: the whole word is a card name (after "named" or "partner with"). */
  name?: boolean;
  /** WORD: this token and its neighbor came from one written word ("non" + "black"). */
  split?: boolean;
  /** PT: power and toughness as written ("2", "*", "X", "1+*"). */
  pt?: { power: string; toughness: string };
  /** MOD: power and toughness modifiers as written, with their signs ("+1", "-X"). */
  mod?: { power: string; toughness: string };
  /** QUOTE: the tokens inside the delimiters. */
  sub?: Token[];
  /** QUOTE: the delimiter that was used. */
  quote?: '"' | "'";
  /** ERR: why. */
  reason?: string;
}

export interface TokenizeOptions {
  lexicon?: Lexicon;
  /** Card names of the index, for "named X" and "partner with X" (the comma inside "Bruna, the Fading Light" does not split). */
  cardNames?: ParseOptions['cardNames'];
  /** Tokenize only `text[from, to)`; token ranges stay absolute. */
  from?: number;
  to?: number;
  /** Where preprocess replaced words by "~": position of the "~" -> range of the words it replaced, so a SELF token covers what it replaced. */
  selfExtents?: ReadonlyMap<number, readonly [number, number]>;
  /** The range is the inside of a quoted span: a single quote can open a nested one. */
  inside?: '"' | "'";
}

const WORD_START = /\p{L}/u;
/** FAST5 T65: the superscript x of an exponent ("2ˣ", U+02E3). */
const SUPERSCRIPT_X = 'ˣ';
const WORD_RE = /\p{L}[\p{L}\p{N}]*(?:['-][\p{L}\p{N}]+)*/uy;
const PT_RE = /(?:\d+|\*|X)(?:\+\*)?\/(?:\d+|\*|X)(?:\+\*)?/y;
const MOD_RE = /[+-](?:\d+|X|\*)\/[+-](?:\d+|X|\*)/y;

/** The ten hybrid pairs of CR 107.4 (allied and enemy colors), in the order the rules list them. */
const HYBRID_PAIRS = ['W/U', 'W/B', 'U/B', 'U/R', 'B/R', 'B/G', 'R/G', 'R/W', 'G/W', 'G/U'];
/**
 * The mana symbols of CR 107.4 as written in Oracle text, plus {X} / {Y} (CR 107.3, 107.3p) and the energy symbol {E} (CR 107.14): a number, one color or {C},
 * {S}, a hybrid pair, a monocolored hybrid ({2/W}, {C/W}), a Phyrexian symbol and a hybrid Phyrexian symbol. Anything else in braces is not a mana symbol.
 */
const MANA_SYMBOLS: ReadonlySet<string> = new Set([
  ...'WUBRGCSXYE'.split(''),
  ...HYBRID_PAIRS,
  ...['2', 'C'].flatMap((n) => [...'WUBRG'].map((c) => `${n}/${c}`)),
  ...[...'WUBRG'].map((c) => `${c}/P`),
  ...HYBRID_PAIRS.map((p) => `${p}/P`),
]);
/** Braces the rules define that are not mana: unsupported in cost positions today (an ERR says so; WP6 may add a kind for them). */
const OTHER_RULES_SYMBOLS: ReadonlySet<string> = new Set(['PW', 'CHAOS', 'TK', 'P', 'H']);
const isManaSymbol = (body: string): boolean => /^\d+$/.test(body) || MANA_SYMBOLS.has(body);
const ROMAN_RE = /^(?:I|II|III|IV|V|VI|VII|VIII|IX|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX)$/;
const ROMAN_VALUES: Readonly<Record<string, number>> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15, XVI: 16, XVII: 17, XVIII: 18, XIX: 19, XX: 20,
};
const PUNCT = new Set(['.', ',', ';', ':', '!', '?', '(', ')', '[', ']', '/', '+', '|', '=', '*', '&', '%', '#', '@', '<', '>']);
const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isUpper = (s: string): boolean => /^\p{Lu}/u.test(s);

/** Words that can follow "non" in "nonblack" without a hyphen (the rest must be a word the lexicon knows). */
function nonRest(ix: LexiconIndex, rest: string): boolean {
  return ix.colors.has(rest) || ix.cardTypes.has(rest) || ix.supertypes.has(rest) || ix.subtypes.has(rest) || rest === 'token' || rest === 'permanent';
}

/** End of the longest card name that starts at `start` (ending at a word boundary or punctuation), or undefined. */
function nameAt(text: string, start: number, to: number, names: ReadonlySet<string>): number | undefined {
  let best: number | undefined;
  const limit = Math.min(to, start + 100);
  for (let e = start + 1; e <= limit; e++) {
    if (text[e - 1] === ' ') continue;
    if (e < to && isWordChar(text[e])) continue; // inside a word
    if (names.has(text.slice(start, e))) best = e;
  }
  return best;
}

export function tokenize(text: string, opts: TokenizeOptions = {}): Token[] {
  const from = opts.from ?? 0;
  const to = Math.min(opts.to ?? text.length, text.length);
  const ix = lexiconIndex(opts.lexicon ?? GENERATED_LEXICON);
  const scan = scanQuotes(text, from, to, opts.inside);
  const topSpans = new Map<number, QuoteSpan>();
  for (const s of scan.spans) if (s.depth === 0) topSpans.set(s.open, s);
  const unmatched = new Set(scan.unmatched);
  const out: Token[] = [];
  let i = from;

  const err = (start: number, end: number, reason: string): void => {
    out.push({ kind: 'ERR', text: text.slice(start, end), norm: text.slice(start, end), range: [start, end], reason });
  };

  while (i < to) {
    const c = text[i]!;
    if (c === ' ' || c === '\n' || c === '\t') {
      i++;
      continue;
    }
    // --- quoted abilities
    const span = topSpans.get(i);
    if (span) {
      const inner = tokenize(text, { ...opts, from: span.open + 1, to: span.close, inside: span.kind });
      const whole = text.slice(span.open, span.close + 1);
      // r3-static (CR 704.5j): the "legend rule" in quotation marks is the rule's name, not a quoted ability: its words are words of the sentence
      if (/^"legend rule"$/i.test(whole)) {
        // the quotation marks belong to the first and the last word (a token's text is the parse text its range covers; grammars read `norm`, which stays
        // "legend" / "rule"), so every character of the line is still in exactly one token (guard G4)
        const first = inner[0];
        const last = inner[inner.length - 1];
        if (first && last) {
          first.range = [span.open, first.range[1]];
          first.text = text.slice(span.open, first.range[1]);
          last.range = [last.range[0], span.close + 1];
          last.text = text.slice(last.range[0], span.close + 1);
        }
        out.push(...inner);
        i = span.close + 1;
        continue;
      }
      // std-lci: `tokens with "This token can't block," where X is ...`: the comma printed inside the closing quote is the sentence's (", where X is"), not part
      // of the quoted ability; it follows the quote as a token of its own (an empty range: its character is the quote's, so its text is empty and only its
      // norm is the comma: a token's text is always the parse text its range covers)
      const last = inner[inner.length - 1];
      const outerComma = last?.kind === 'PUNCT' && last.norm === ',' && /^\s+where\b/i.test(text.slice(span.close + 1, to));
      out.push({ kind: 'QUOTE', text: whole, norm: whole, range: [span.open, span.close + 1], sub: outerComma ? inner.slice(0, -1) : inner, quote: span.kind });
      if (outerComma) out.push({ kind: 'PUNCT', text: '', norm: ',', range: [span.close + 1, span.close + 1] });
      i = span.close + 1;
      continue;
    }
    if (c === '"') {
      err(i, i + 1, unmatched.has(i) ? 'unmatched quote' : 'stray quote');
      i++;
      continue;
    }
    if (c === '~') {
      const ext = opts.selfExtents?.get(i);
      const start = ext ? ext[0] : i;
      out.push({ kind: 'SELF', text: text.slice(start, i + 1), norm: '~', range: [start, i + 1] });
      i++;
      continue;
    }
    // r4-static: the outer card's name inside a quoted ability (front/selfref.ts, mark '¤'): the object that grants the quoted ability
    if (c === '¤') {
      const ext = opts.selfExtents?.get(i);
      const start = ext ? ext[0] : i;
      out.push({ kind: 'GRANTOR', text: text.slice(start, i + 1), norm: '¤', range: [start, i + 1] });
      i++;
      continue;
    }
    if (c === '•') {
      out.push({ kind: 'BULLET', text: c, norm: c, range: [i, i + 1] });
      i++;
      continue;
    }
    if (c === '{') {
      const close = text.indexOf('}', i);
      if (close < 0 || close >= to) {
        err(i, i + 1, 'unclosed symbol');
        i++;
        continue;
      }
      const body = text.slice(i + 1, close);
      const t = text.slice(i, close + 1);
      if (body === 'T' || body === 'Q') out.push({ kind: 'TAP', text: t, norm: body, range: [i, close + 1] });
      else if (isManaSymbol(body)) out.push({ kind: 'MANA', text: t, norm: body, range: [i, close + 1] });
      else err(i, close + 1, OTHER_RULES_SYMBOLS.has(body) ? `unsupported symbol ${t}` : `unknown symbol ${t}`);
      i = close + 1;
      continue;
    }
    const prevIsWord = i > from && isWordChar(text[i - 1]);
    // --- power/toughness and its modification
    if (!prevIsWord && (c === '+' || c === '-')) {
      MOD_RE.lastIndex = i;
      const m = MOD_RE.exec(text);
      if (m && i + m[0].length <= to && !isWordChar(text[i + m[0].length])) {
        const [p, t] = m[0].split('/') as [string, string];
        out.push({ kind: 'MOD', text: m[0], norm: m[0], range: [i, i + m[0].length], mod: { power: p, toughness: t } });
        i += m[0].length;
        continue;
      }
    }
    if (!prevIsWord && (c === '*' || c === 'X' || (c >= '0' && c <= '9'))) {
      PT_RE.lastIndex = i;
      const m = PT_RE.exec(text);
      if (m && i + m[0].length <= to && !isWordChar(text[i + m[0].length])) {
        const [p, t] = m[0].split('/') as [string, string];
        out.push({ kind: 'PT', text: m[0], norm: m[0], range: [i, i + m[0].length], pt: { power: p, toughness: t } });
        i += m[0].length;
        continue;
      }
    }
    // --- numbers
    if (c >= '0' && c <= '9') {
      let e = i;
      while (e < to && text[e]! >= '0' && text[e]! <= '9') e++;
      // Standard round 5, r5-trig (The Millennium Calendar, "1,000 or more time counters"): a number with thousands separators is one number ("1,000" = 1000);
      // only groups of exactly three digits after a run of one to three, so "1, 2" or a list of numbers never joins
      const isDigit = (k: number): boolean => k < to && text[k]! >= '0' && text[k]! <= '9';
      let grouped = false;
      if (e - i <= 3) while (text[e] === ',' && isDigit(e + 1) && isDigit(e + 2) && isDigit(e + 3) && !isDigit(e + 4)) { e += 4; grouped = true; }
      if (grouped && !(e < to && WORD_START.test(text[e]!))) {
        const digits = text.slice(i, e).replace(/,/g, '');
        out.push({ kind: 'NUM', text: text.slice(i, e), norm: digits, range: [i, e], value: Number(digits) });
        i = e;
        continue;
      }
      // FAST5 T65 (CR 107.3): "2ˣ" (a number raised to the power X, Oracle's superscript form) is the number, then the word "ˣ" that a template reads
      if (e < to && text[e] === SUPERSCRIPT_X && !isWordChar(text[e + 1])) {
        out.push({ kind: 'NUM', text: text.slice(i, e), norm: text.slice(i, e), range: [i, e], value: Number(text.slice(i, e)) });
        out.push({ kind: 'WORD', text: SUPERSCRIPT_X, norm: SUPERSCRIPT_X, range: [e, e + 1] });
        i = e + 1;
        continue;
      }
      if (e < to && WORD_START.test(text[e]!)) {
        // "3rd", "2x": a digit run glued to letters is not a number we understand.
        let w = e;
        while (w < to && isWordChar(text[w])) w++;
        err(i, w, 'number glued to letters');
        i = w;
        continue;
      }
      out.push({ kind: 'NUM', text: text.slice(i, e), norm: text.slice(i, e), range: [i, e], value: Number(text.slice(i, e)) });
      i = e;
      continue;
    }
    // --- words
    if (WORD_START.test(c)) {
      if (text.startsWith('and/or', i) && !isWordChar(text[i + 6])) {
        out.push({ kind: 'WORD', text: 'and/or', norm: 'and/or', range: [i, i + 6] });
        i += 6;
        continue;
      }
      WORD_RE.lastIndex = i;
      const m = WORD_RE.exec(text);
      let word = m ? m[0] : c;
      let end = i + word.length;
      if (end > to) {
        word = text.slice(i, to);
        end = to;
      }
      // A plural possessive ("creatures'") keeps its apostrophe when no letter follows it.
      if (text[end] === "'" && end < to && !isWordChar(end + 1 < to ? text[end + 1] : undefined) && /s$/.test(word)) {
        word += "'";
        end++;
      }
      if (word === 'X') {
        out.push({ kind: 'X', text: word, norm: 'X', range: [i, end] });
      } else if (ROMAN_RE.test(word)) {
        out.push({ kind: 'ROMAN', text: word, norm: word, range: [i, end], value: ROMAN_VALUES[word]! });
      } else {
        const lower = word.toLowerCase();
        if (lower.startsWith('non-') && lower.length > 4) {
          // "non-Human": the prefix is its own word.
          const rest = word.slice(4);
          out.push({ kind: 'WORD', text: word.slice(0, 4), norm: 'non', range: [i, i + 4], split: true }); // the hyphen belongs to "non"
          out.push({ kind: 'WORD', text: rest, norm: rest.toLowerCase(), range: [i + 4, end], split: true, ...(isUpper(rest) ? { cap: true } : {}) });
        } else if (lower.startsWith('non') && lower.length > 3 && nonRest(ix, lower.slice(3))) {
          // "nonblack", "noncreature"
          out.push({ kind: 'WORD', text: word.slice(0, 3), norm: 'non', range: [i, i + 3], split: true });
          out.push({ kind: 'WORD', text: word.slice(3), norm: lower.slice(3), range: [i + 3, end], split: true });
        } else {
          const t: Token = { kind: 'WORD', text: word, norm: lower, range: [i, end] };
          if (isUpper(word)) t.cap = true;
          const nv = NUMBER_WORDS[lower];
          if (nv !== undefined) t.value = nv;
          out.push(t);
        }
      }
      i = end;
      // A card name with a comma is one token wherever it appears.
      const last = out[out.length - 1];
      if (opts.cardNames && last && last.kind === 'WORD' && last.cap && !last.split) {
        const cands = nameIndex(opts.cardNames).comma.get(last.text);
        const full = cands?.find((n) => text.startsWith(n, last.range[0]) && last.range[0] + n.length <= to && !isWordChar(text[last.range[0] + n.length]));
        if (full) {
          out.pop();
          out.push({ kind: 'WORD', text: full, norm: full, range: [last.range[0], last.range[0] + full.length], name: true, cap: true });
          i = last.range[0] + full.length;
          continue;
        }
      }
      // A card name after "named" / "partner with" is one token, commas and all.
      const prev = out[out.length - 1];
      const before = out[out.length - 2];
      if (opts.cardNames && prev && prev.kind === 'WORD' && (prev.norm === 'named' || (prev.norm === 'with' && before?.norm === 'partner'))) {
        let s = i;
        while (s < to && text[s] === ' ') s++;
        const e = nameAt(text, s, to, nameIndex(opts.cardNames).all);
        if (e !== undefined) {
          out.push({ kind: 'WORD', text: text.slice(s, e), norm: text.slice(s, e), range: [s, e], name: true, cap: true });
          i = e;
        }
      }
      continue;
    }
    // --- possessive after "~" or a symbol: "~'s"
    if (c === "'" && text[i + 1] === 's' && !isWordChar(text[i + 2]) && out.length > 0) {
      out.push({ kind: 'WORD', text: "'s", norm: "'s", range: [i, i + 2] });
      i += 2;
      continue;
    }
    // --- the infinity symbol is a keyword written as a symbol (CR 702.186)
    if (c === '∞') {
      out.push({ kind: 'WORD', text: c, norm: c, range: [i, i + 1] });
      i++;
      continue;
    }
    // --- punctuation
    if (c === '-') {
      const dd = text[i + 1] === '-';
      out.push({ kind: 'PUNCT', text: dd ? '--' : '-', norm: dd ? '--' : '-', range: [i, i + (dd ? 2 : 1)] });
      i += dd ? 2 : 1;
      continue;
    }
    if (c === "'" || PUNCT.has(c)) {
      out.push({ kind: 'PUNCT', text: c, norm: c, range: [i, i + 1] });
      i++;
      continue;
    }
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    err(i, i + ch.length, `unknown character U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
    i += ch.length;
  }
  return out;
}

/** The norms of the tokens joined by spaces (quoted abilities in quotes): a compact view for tests and traces. */
export function tokenNorms(tokens: readonly Token[]): string {
  return tokens.map((t) => (t.kind === 'QUOTE' ? `"${tokenNorms(t.sub ?? [])}"` : t.norm)).join(' ');
}
