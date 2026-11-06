/**
 * Cleave (CR 702.148a; edh-next-100): the printed text of a spell with cleave is its reading without the bracketed words, with them put back in square brackets. The
 * renderer says the spell's two effects (`SpellAbilityDef.effect`: the brackets taken away and their words kept; `.cleave`: the words removed) and brackets the words only
 * the first has, each run of them once. A pure text comparison of the two renderings (their first wordings), see parser/cleave.ts for the reading side.
 */
const TOKEN = /[^\s.,;:!?]+|[.,;:!?]/g;
const PUNCT = /^[.,;:!?]$/;

const join = (toks: string[]): string => toks.reduce((s, t, i) => (i === 0 || PUNCT.test(t) ? s + t : `${s} ${t}`), '');

/** `plain` with the words `cleaved` lacks in square brackets, or null when `cleaved` is not `plain` less some runs of words. */
export function bracketed(plain: string, cleaved: string): string | null {
  const a: string[] = plain.match(TOKEN) ?? [];
  const b: string[] = cleaved.match(TOKEN) ?? [];
  const out: string[] = [];
  let j = 0;
  for (let i = 0; i < a.length; ) {
    if (j < b.length && a[i] === b[j]) { out.push(a[i]!); i++; j++; continue; }
    // a run of removed words: up to the next word of the cleaved text (the first one that matches again), or the end
    let end = j < b.length ? a.indexOf(b[j]!, i) : a.length;
    if (end < 0) return null;
    // a run does not start with a punctuation mark of its own (the mark before it stays outside): leave that mark out of the run
    out.push(`[${join(a.slice(i, end))}]`);
    i = end;
  }
  if (j !== b.length) return null;
  // the brackets are spaced like words: "spell [that ... hand]." and "a [basic land] card, [reveal it,] put"
  return out.reduce((s, t, i) => (i === 0 || PUNCT.test(t) ? s + t : `${s} ${t}`), '');
}
