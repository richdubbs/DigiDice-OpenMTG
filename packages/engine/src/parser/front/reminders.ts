/**
 * Reminder text of keyword lines against the registry (design 6.2 step 2). Owner: WP5. Pure.
 *
 * A keyword line's reminder text has no rules meaning (CR 207.2a) and is never parsed for behavior. It is compared with `KeywordDefData.reminder` (the wording
 * the registry stores, with `{cost}`, `{n}` and `{quality}` for the parameters) only to flag Oracle errata: a reminder that no longer matches the registry is an
 * `info` diagnostic (code `lint`) on its range, so that the registry's wording can be looked at. Nothing else depends on it.
 */
import type { Diagnostic } from '../types';
import type { AbilitySegment } from '../segment';
import type { LexiconIndex } from './lexicon-index';
import { applySelfRefs, findSelfRefs } from './selfref';
import { escapeRegExp } from './text';
import type { FaceContext, FrontEndOptions, PreprocessedFace } from './types';

const PLACEHOLDER = /\{(?:cost|n|quality)\}/g;

/** Text as compared: the object as "~", whitespace collapsed, no outer parentheses, no final period. */
function comparable(text: string, ctx: FaceContext, ix: LexiconIndex, cardNames: ReadonlySet<string> | undefined): string {
  const inner = text.replace(/^\(/, '').replace(/\)$/, '');
  const withSelf = applySelfRefs(inner, findSelfRefs(inner, ctx, ix, [], cardNames));
  return withSelf.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
}

/** A regular expression for a registry reminder: the placeholders match anything. */
function matcher(template: string, ctx: FaceContext, ix: LexiconIndex, cardNames: ReadonlySet<string> | undefined): RegExp {
  const parts = comparable(template, ctx, ix, cardNames).split(PLACEHOLDER).map(escapeRegExp);
  return new RegExp(`^${parts.join('.+?')}$`, 'is');
}

function walk(abilities: readonly AbilitySegment[], visit: (a: AbilitySegment) => void): void {
  for (const a of abilities) {
    visit(a);
    if (a.children) walk(a.children, visit);
  }
}

/** One `info` diagnostic for each reminder of a keyword line that differs from the registry's wording of every keyword on that line. */
export function reminderDiagnostics(pre: PreprocessedFace, abilities: readonly AbilitySegment[], ix: LexiconIndex, opts: FrontEndOptions): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (!opts.keywords || opts.keywords.length === 0) return out;
  const registry = new Map<string, string>();
  for (const k of opts.keywords) if (k.reminder.trim() !== '') registry.set(k.name.toLowerCase(), k.reminder);
  walk(abilities, (a) => {
    if (a.shape !== 'keyword' || !a.keywordItems) return;
    const templates = a.keywordItems.map((k) => registry.get(k.name.toLowerCase())).filter((t): t is string => t !== undefined);
    if (templates.length === 0) return;
    const matchers = templates.map((t) => matcher(t, pre.context, ix, opts.cardNames));
    for (const r of a.reminders) {
      const written = comparable(pre.normalized.slice(r[0], r[1]), pre.context, ix, opts.cardNames);
      if (matchers.some((re) => re.test(written))) continue;
      out.push({ level: 'info', code: 'lint', message: `reminder text of ${a.keywordItems.map((k) => k.name).join(', ')} differs from the registry's (errata?)`, range: r });
    }
  });
  return out;
}
