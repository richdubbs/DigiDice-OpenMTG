/**
 * Risk flags and critical words for LLM output (design 11.3 gates 6 and 9). Pure.
 *
 * `highRiskFlags` names the nodes where a plausible-looking error does the most damage (replacement effects, layers 1-3, layer 2 control, exchange,
 * delayed triggers, copy, piles, emblems). It mirrors the engine's `cards/pack.ts#highRiskNodes` (not exported by the engine); the engine's `trusted()`
 * computes the same nodes on its own, so an entry whose flags were lost is still never auto-trusted. A test checks both agree.
 *
 * `CRITICAL_WORDS` mirrors the parser's guard G3 list (`parser/lower/units.ts#CRITICAL_WORDS` = `model/taint.ts#MODIFIER_WORDS` plus a few); a test
 * compares the two lists, so they cannot drift.
 */

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

const HIGH_RISK_OPS: Readonly<Record<string, string>> = { exchange: 'exchange', delay: 'delayed', copy: 'copy', piles: 'piles', createEmblem: 'emblem' };

/** `highRisk:*` flags of stored or hydrated abilities, sorted (empty: none). */
export function highRiskFlags(abilities: readonly unknown[]): string[] {
  const found = new Set<string>();
  const visit = (x: unknown): void => {
    if (Array.isArray(x)) {
      for (const y of x) visit(y);
      return;
    }
    if (!isRec(x)) return;
    const op = x['op'];
    if (typeof op === 'string' && HIGH_RISK_OPS[op] !== undefined) found.add(`highRisk:${HIGH_RISK_OPS[op]}`);
    if (x['s'] === 'replace') found.add('highRisk:replacement');
    const layer = x['layer'];
    if (layer === 2) found.add('highRisk:control');
    else if (layer === '1a' || layer === '1b' || layer === 3) found.add('highRisk:layers');
    for (const v of Object.values(x)) visit(v);
  };
  visit(abilities);
  return [...found].sort();
}

export const MODIFIER_WORDS: readonly string[] = [
  'instead', 'rather than', 'except', 'unless', "can't", 'cannot', 'additional', 'also', 'in addition', 'as though', 'if able', 'only', 'each other',
  'each time', 'still', 'this way', 'would', 'until', 'twice', 'half', 'double', 'triple', 'again', 'extra', 'that many', 'that much', 'no more than',
  'at least', 'up to', 'any number', 'random', 'chosen', 'different', 'same',
];

export const CRITICAL_WORDS: readonly string[] = [...MODIFIER_WORDS, 'each', 'all', 'another', 'other', 'may', 'if', 'whenever', 'when', 'not', 'never', 'must'];

const words = (s: string): string => ` ${s.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9'~]+/g, ' ').trim()} `;

/**
 * Gate 6 (G3 applied to the source sentence): the first critical word or phrase of the Oracle text that the rendered text lacks, or null. Counted as
 * words, so "each" inside "each other" is matched by the longer phrase first and not double-counted.
 */
export function missingCriticalWord(oracle: string, rendered: string): string | null {
  const o = words(oracle);
  const r = words(rendered);
  const count = (hay: string, phrase: string): number => hay.split(` ${phrase} `).length - 1;
  // longest phrases first; a phrase's occurrences are removed so its words are not counted again
  let oRest = o;
  let rRest = r;
  for (const w of [...CRITICAL_WORDS].sort((a, b) => b.length - a.length)) {
    const want = count(oRest, w);
    if (want > 0 && count(rRest, w) < want) return w;
    oRest = oRest.split(` ${w} `).join('  ');
    rRest = rRest.split(` ${w} `).join('  ');
  }
  return null;
}
