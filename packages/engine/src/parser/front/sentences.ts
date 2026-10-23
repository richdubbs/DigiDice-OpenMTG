/**
 * Sentences (design 6.2 step 6): a run of tokens is split after each period that is not inside a quoted ability or a brace group (QUOTE and MANA tokens are single
 * tokens, so a period inside them is invisible here). A sentence that begins with `Then`, `If you do`, `If you don't`, `Otherwise`, `It`, `They` or `That`
 * continues the previous one: it says what happens next or because of what just happened.
 */
import type { Token } from '../tokenize';
import type { Range } from './types';

export interface Sentence {
  /** Index of the Oracle line the sentence is on. */
  line: number;
  /** From the first token to the last (the period included). */
  range: Range;
  tokens: Token[];
  /** Continues the previous sentence (design 6.2). False for the first sentence of an ability. */
  continuation: boolean;
}

// Design 6.2 lists It, They and That; their contractions ("It's still a land.", design 6.7) continue the previous sentence too.
const CONTINUES = new Set(['then', 'otherwise', 'it', 'they', 'that', "it's", "they're", "that's"]);

export function isContinuation(tokens: readonly Token[]): boolean {
  const first = tokens[0];
  if (!first || first.kind !== 'WORD') return false;
  if (CONTINUES.has(first.norm)) return true;
  return first.norm === 'if' && tokens[1]?.norm === 'you' && (tokens[2]?.norm === 'do' || tokens[2]?.norm === "don't");
}

/**
 * FAST5X E3: a quoted ability whose last sentence ends inside the quotes ('... with "This token saddles ... 2 greater." Activate only as a sorcery.') ends the
 * sentence that holds it when a capitalized word follows: Oracle puts the period of the outer sentence inside the closing quote, so no period token follows.
 */
function endsQuotedSentence(t: Token, next: Token | undefined): boolean {
  return t.kind === 'QUOTE' && /\.["'”]$/.test(t.text) && next !== undefined && next.kind === 'WORD' && next.cap === true && next.name !== true;
}

/** Splits `tokens` (all on `line`) into sentences. Nothing is dropped: every token belongs to exactly one sentence. */
export function splitSentences(tokens: readonly Token[], line: number): Sentence[] {
  const out: Sentence[] = [];
  let cur: Token[] = [];
  const flush = (): void => {
    if (cur.length === 0) return;
    const onlyDots = cur.every((t) => t.kind === 'PUNCT' && t.norm === '.');
    const prev = out[out.length - 1];
    if (onlyDots && prev) {
      // "..." after a sentence belongs to it.
      prev.tokens.push(...cur);
      prev.range = [prev.range[0], cur[cur.length - 1]!.range[1]];
    } else {
      out.push({ line, range: [cur[0]!.range[0], cur[cur.length - 1]!.range[1]], tokens: cur, continuation: out.length > 0 && isContinuation(cur) });
    }
    cur = [];
  };
  tokens.forEach((t, i) => {
    cur.push(t);
    if (t.kind === 'PUNCT' && t.norm === '.') {
      // Do not split inside "..." (consecutive periods).
      flush();
    } else if (endsQuotedSentence(t, tokens[i + 1])) {
      flush();
    }
  });
  flush();
  return out;
}
