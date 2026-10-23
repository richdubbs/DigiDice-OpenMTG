/**
 * P1 (performance): the last few `parseCard` results, so a card parsed twice in a row with the same options is parsed once. The coverage tools parse a card
 * for the parser's own metrics and then compile it with `compileCard`, whose pipeline parses it again with the very same options object
 * (cards/compile.ts#defaultCompileSources): half of a coverage run was that second parse.
 *
 * A result is reused only for the same card CONTENT (its JSON) and the same options: the same options object whose parts are the same objects as when the
 * result was made (template array with the same templates in the same order, capability set of the same size, lexicon, keyword list, card names, budget).
 * Templates, lexicons and capability sets are immutable data in the engine; an options object edited in place that way is parsed again.
 *
 * Results are deep-frozen when they are made, and every caller gets the same frozen result (INTERFACE CHANGE of P1: `parseCard` results are read-only), so
 * a caller that edits one in place fails loudly instead of changing what another caller sees. The compile pipeline copies the parser's abilities into the
 * definition it builds (cards/pipeline.ts), so compiled definitions stay mutable and never share an object with this memo. Pure: a memo of a pure function.
 * A process-wide memo that outlives actions: an accepted deviation (P1, 2026-10-12; see docs/ARCHITECTURE.md) (see rules/characteristics.ts `RECENT`).
 */
import type { OracleCard } from '../types/card';
import type { ParseOptions, ParseResult, Template } from './types';
import { deepFreeze } from '../util/clone';

interface Entry {
  card: string;
  opts: ParseOptions;
  templates: readonly Template[];
  snapshot: readonly Template[];
  capabilities: ReadonlySet<string>;
  capabilityCount: number;
  lexicon: ParseOptions['lexicon'];
  keywords: ParseOptions['keywords'];
  cardNames: ParseOptions['cardNames'];
  budget: ParseOptions['budget'];
  result: ParseResult;
}

const RECENT: Entry[] = [];
const SIZE = 4;

const sameTemplates = (a: readonly Template[], b: readonly Template[]): boolean => a.length === b.length && a.every((t, i) => t === b[i]);

function matches(e: Entry, card: string, o: ParseOptions): boolean {
  return e.card === card && e.opts === o && e.templates === o.templates && sameTemplates(e.snapshot, o.templates) && e.capabilities === o.capabilities
    && e.capabilityCount === o.capabilities.size && e.lexicon === o.lexicon && e.keywords === o.keywords && e.cardNames === o.cardNames && e.budget === o.budget;
}

/** `parse(card, opts)`, or the frozen result of the same parse made a moment ago. */
export function memoParse(card: OracleCard, opts: ParseOptions, parse: (card: OracleCard, opts: ParseOptions) => ParseResult): ParseResult {
  let key: string;
  try {
    key = JSON.stringify(card);
    if (typeof key !== 'string' || !Array.isArray(opts?.templates) || !(opts.capabilities instanceof Set)) return parse(card, opts);
  } catch {
    return parse(card, opts); // a malformed card or options (contract C1: parseCard never throws): parsed without the memo
  }
  const hit = RECENT.find((e) => matches(e, key, opts));
  if (hit !== undefined) return hit.result;
  const result = deepFreeze(parse(card, opts));
  RECENT.unshift({
    card: key, opts, templates: opts.templates, snapshot: [...opts.templates], capabilities: opts.capabilities, capabilityCount: opts.capabilities.size,
    lexicon: opts.lexicon, keywords: opts.keywords, cardNames: opts.cardNames, budget: opts.budget, result,
  });
  if (RECENT.length > SIZE) RECENT.pop();
  return result;
}
