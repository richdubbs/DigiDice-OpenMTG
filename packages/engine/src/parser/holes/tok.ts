/**
 * The token shape the chart parser and the hole grammars read (design 6.1 step 4, 6.3). Owner: WP6.
 *
 * WP5 owns the real tokenizer (`parser/tokenize.ts`); the chart parser must not depend on its internals, so this file states the CONTRACT the
 * grammars need and ships a small reference lexer (`lex`) that produces exactly that shape. WP17 adapts WP5's tokens to `Tok` (a few lines) or
 * WP5 emits `Tok` directly. The contract:
 *
 *   - `norm` is the lower-case text; grammars match on `norm`, never on `text`.
 *   - `{T}` and `{Q}` are kind `TAP` (norm `{t}` / `{q}`); every other `{...}` symbol is kind `MANA` (norm `{2}`, `{w}`, `{e}`, `{x}`, ...), ONE token per symbol.
 *   - A possessive splits into the base word and a `WORD` token `'s` (or `'` after a plural ending in s): "creature's" is [creature]['s]. Contractions stay
 *     one word ("don't", "it's", "isn't", "that's").
 *   - `+2/+2`, `-1/-1`, `+X/+X`, `3/3`, `X/X` are one `PT` token. A signed number (`+1`, `-2`, `+X`, `-X`: loyalty costs) is one `MOD` token. An unsigned
 *     number is `NUM` (norm = the digits), a lone `x` is `X`.
 *   - `~` is `SELF`. Punctuation (`, . : ; --`) is `PUNCT` with norm = the mark. A quoted ability is one `QUOTE` token whose `sub` holds the tokens inside the quotes
 *     (quoted abilities are parsed recursively by the caller, see `SubParser`).
 *   - Card names from the local name index are one WORD token (spaces allowed inside `text`/`norm`).
 */

export type TokKind = 'WORD' | 'NUM' | 'X' | 'MANA' | 'TAP' | 'PT' | 'MOD' | 'ROMAN' | 'SELF' | 'GRANTOR' | 'PUNCT' | 'BULLET' | 'QUOTE' | 'ERR';

export interface Tok {
  kind: TokKind;
  /** Exact source text of the token. */
  text: string;
  /** Lower-case matching form. */
  norm: string;
  /** Character offsets in the unit text (end exclusive). */
  start: number;
  end: number;
  /** QUOTE tokens: the tokens inside the quotation marks. */
  sub?: Tok[];
}

const KEEP_WHOLE = new Set(["it's", "that's", "there's", "here's", "let's", "who's", "what's", "he's", "she's", "where's"]);

/**
 * Reference lexer for unit text (reminder text and `~` substitution already done by the front end). Total: unknown characters become `ERR` tokens, so a
 * grammar can never silently skip them. Not used by the chart itself; tests and tools use it.
 */
export function lex(text: string, base = 0): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = text.length;
  const push = (kind: TokKind, s: number, e: number, norm?: string, sub?: Tok[]): void => {
    const t = text.slice(s, e);
    const tok: Tok = { kind, text: t, norm: norm ?? t.toLowerCase(), start: base + s, end: base + e };
    if (sub) tok.sub = sub;
    out.push(tok);
  };
  while (i < n) {
    const c = text[i]!;
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (c === '{') {
      const j = text.indexOf('}', i);
      if (j < 0) { push('ERR', i, n); break; }
      const body = text.slice(i + 1, j).toLowerCase();
      push(body === 't' || body === 'q' ? 'TAP' : 'MANA', i, j + 1, `{${body}}`);
      i = j + 1;
      continue;
    }
    if (c === '~') { push('SELF', i, i + 1, '~'); i++; continue; }
    if (c === '"' || c === '“' || c === '”') {
      const close = c === '“' ? '”' : c;
      const j = text.indexOf(close, i + 1);
      if (j < 0) { push('ERR', i, n); break; }
      push('QUOTE', i, j + 1, text.slice(i, j + 1).toLowerCase(), lex(text.slice(i + 1, j), base + i + 1));
      i = j + 1;
      continue;
    }
    if (c === '•') { push('BULLET', i, i + 1, '•'); i++; continue; }
    if (c === '—' || c === '–' || (c === '-' && text[i + 1] === '-')) {
      const e = c === '-' ? i + 2 : i + 1;
      push('PUNCT', i, e, '--');
      i = e;
      continue;
    }
    // signed / P/T numbers: +2/+2, -1/-1, +X/+X, 3/3, X/X, then loyalty-style +1, -2, +X, -X
    const pt = /^[+\-−]?(?:\d+|[xX])\/[+\-−]?(?:\d+|[xX])/.exec(text.slice(i));
    if (pt) {
      push('PT', i, i + pt[0].length, pt[0].toLowerCase().replace(/−/g, '-'));
      i += pt[0].length;
      continue;
    }
    const signed = /^[+\-−](?:\d+|[xX])(?![\w/])/.exec(text.slice(i));
    if (signed) {
      push('MOD', i, i + signed[0].length, signed[0].toLowerCase().replace(/−/g, '-'));
      i += signed[0].length;
      continue;
    }
    const num = /^\d+/.exec(text.slice(i));
    if (num) {
      push('NUM', i, i + num[0].length, num[0]);
      i += num[0].length;
      continue;
    }
    if (c === ',' || c === '.' || c === ':' || c === ';') { push('PUNCT', i, i + 1, c); i++; continue; }
    // a possessive after a non-word token ("~'s power"): the 's alone is a word
    const lone = /^['’]s?(?![A-Za-z])/.exec(text.slice(i));
    if (lone !== null) { push('WORD', i, i + lone[0].length, lone[0].toLowerCase().replace(/’/g, "'")); i += lone[0].length; continue; }
    const word = /^[A-Za-z]+(?:['’\-/][A-Za-z]+)*/.exec(text.slice(i));
    if (word) {
      const w = word[0];
      const start = i;
      i += w.length;
      const norm = w.toLowerCase().replace(/’/g, "'");
      if (norm === 'x') push('X', start, i, 'x');
      else if (norm.endsWith("'s") && !KEEP_WHOLE.has(norm) && norm.length > 2) {
        const baseLen = w.length - 2;
        push('WORD', start, start + baseLen, norm.slice(0, -2));
        push('WORD', start + baseLen, i, "'s");
      } else push('WORD', start, i, norm);
      continue;
    }
    push('ERR', i, i + 1);
    i++;
  }
  return out;
}

/** The text of tokens [a, b) as a readable phrase (single spaces, possessives glued). Used for `text` fields of target specs. */
export function spanText(toks: readonly Tok[], a: number, b: number): string {
  let s = '';
  for (let i = a; i < b; i++) {
    const t = toks[i]!;
    const glue = t.norm === "'s" || t.norm === "'" || t.norm === ',' || t.norm === '.' || t.norm === ':' || t.norm === ';' || t.norm === '--' || toks[i - 1]?.norm === '--' || (t.kind === 'MANA' && toks[i - 1]?.kind === 'MANA');
    if (s !== '' && !glue) s += ' ';
    s += t.text;
  }
  return s;
}

/** A signed power/toughness pair, the shape of `+2/+2`, `-1/-1`, `+1/-1`, `+X/+X` (norm lower-case). */
const SIGNED_PAIR = /^[+-](?:\d+|x)\/[+-](?:\d+|x)$/;

/** A signed pair as written on a modification: WP6's own lexer calls it PT, the tokenizer of WP5 calls it MOD. Both are accepted by the grammars. */
export const isSignedPair = (t: Tok): boolean => (t.kind === 'PT' || t.kind === 'MOD') && SIGNED_PAIR.test(t.norm);

/**
 * What another tokenizer (WP5's `parser/tokenize.ts`) may hand over: the grammars only need `kind` and `text`; everything else is filled in. WP5's tokens
 * fit as they are: they carry `range` instead of `start` / `end`, and `split` on the two halves of "nonland".
 */
export interface RawTok {
  kind: TokKind;
  text: string;
  norm?: string;
  start?: number;
  end?: number;
  range?: readonly [number, number];
  /** WP5: this word and its neighbor came from one written word ("non" + "black"). */
  split?: boolean;
  sub?: readonly RawTok[];
}

const SIGN_WORDS = new Set(['+', '-']);

/**
 * Adapt tokens of another tokenizer to the shape the grammars read: lower-case `norm`, straight apostrophes, a possessive "creature's" split into
 * [creature]['s] (contractions such as "it's" stay whole), signed numbers and mana symbols normalized, offsets taken from `range` or defaulted to the token
 * index. Three differences of WP5's tokens are bridged, because the grammars (and the whole ranking of the top phrases) depend on them:
 *   - "nonland" / "non-Human" arrive as TWO words, `non`/`non-` and the rest, both `split`: they are one word again ("nonland", "non-human");
 *   - a signed pair `+1/+1` arrives as MOD: it is a PT token here (a lone signed number stays MOD);
 *   - a loyalty cost `+1` / `-2` / `-X` arrives as PUNCT followed by NUM or X: when the two touch (known offsets) they become one MOD token.
 * Total and pure.
 */
export function adaptTokens(raw: readonly RawTok[], base = 0): Tok[] {
  const out: Tok[] = [];
  const at = (r: RawTok, idx: number): [number, number] => {
    const s = r.start ?? r.range?.[0] ?? base + idx;
    return [s, r.end ?? r.range?.[1] ?? s + 1];
  };
  const placed = (r: RawTok): boolean => r.range !== undefined || (r.start !== undefined && r.end !== undefined);
  const clean = (t: string): string => t.toLowerCase().replace(/[’‘]/g, "'").replace(/−/g, '-');
  for (let idx = 0; idx < raw.length; idx++) {
    const r = raw[idx]!;
    const next = raw[idx + 1];
    const [start, end] = at(r, idx);
    const norm = clean(r.norm ?? r.text);
    const sub = r.sub !== undefined ? adaptTokens(r.sub, start) : undefined;
    const make = (kind: TokKind, text: string, n: string, s: number, e: number): Tok => ({ kind, text, norm: n, start: s, end: e, ...(sub && kind === 'QUOTE' ? { sub } : {}) });
    if (r.kind === 'WORD' && r.split === true && (norm === 'non' || norm === 'non-') && next !== undefined && next.kind === 'WORD' && next.split === true) {
      const text = r.text + next.text;
      out.push(make('WORD', text, clean(text), start, at(next, idx + 1)[1]));
      idx++;
      continue;
    }
    // FAST5 T68 (CR 606.4): a loyalty cost in brackets inside a quoted ability, `"[+1]: Add {R}."`, `"[-4]: ..."`, `"[0]: ..."` (Oracle's way of writing the cost of a
    // granted loyalty ability): the bracketed sign and number, right before ":", are the same cost token as the bare `+1` / `-4` / `0` of a planeswalker's own ability
    if (r.kind === 'PUNCT' && norm === '[' && placed(r)) {
      const a = raw[idx + 1];
      const b = raw[idx + 2];
      const c = raw[idx + 3];
      const d = raw[idx + 4];
      const touching = (x: RawTok | undefined, y: RawTok | undefined): boolean => x !== undefined && y !== undefined && placed(x) && placed(y) && at(x, 0)[1] === at(y, 0)[0];
      const isPunct = (x: RawTok | undefined, p: string): boolean => x !== undefined && x.kind === 'PUNCT' && clean(x.norm ?? x.text) === p;
      if (a !== undefined && a.kind === 'PUNCT' && SIGN_WORDS.has(clean(a.norm ?? a.text)) && b?.kind === 'NUM' && isPunct(c, ']') && isPunct(d, ':')
        && touching(r, a) && touching(a, b) && touching(b, c) && touching(c, d)) {
        out.push(make('MOD', `[${a.text}${b.text}]`, clean(a.norm ?? a.text) + clean(b.norm ?? b.text), start, at(c!, idx + 3)[1]));
        idx += 3;
        continue;
      }
      // (FAST5 batch 9 integration: "[0]:" is left to FAST5 T55's bracketed loyalty cost, which reads "[0]: Proliferate." of Ichormoon Gauntlet whole; the
      // bare number this branch made of it was no loyalty cost)
    }
    if (r.kind === 'PUNCT' && SIGN_WORDS.has(norm) && next !== undefined && (next.kind === 'NUM' || next.kind === 'X') && placed(r) && placed(next) && end === at(next, idx + 1)[0]) {
      const text = r.text + next.text;
      out.push(make('MOD', text, norm + clean(next.norm ?? next.text), start, at(next, idx + 1)[1]));
      idx++;
      continue;
    }
    if (r.kind === 'WORD' && norm.endsWith("'s") && norm.length > 2 && !KEEP_WHOLE.has(norm)) {
      const cut = r.text.length - 2;
      out.push(make('WORD', r.text.slice(0, cut), norm.slice(0, -2), start, start + cut), make('WORD', r.text.slice(cut), "'s", start + cut, end));
    } else if (r.kind === 'TAP' || r.kind === 'MANA') out.push(make(r.kind, r.text, `{${norm.replace(/[{}]/g, '')}}`, start, end));
    else if (r.kind === 'MOD' && SIGNED_PAIR.test(norm)) out.push(make('PT', r.text, norm, start, end));
    else out.push(make(r.kind, r.text, norm, start, end));
  }
  return out;
}
