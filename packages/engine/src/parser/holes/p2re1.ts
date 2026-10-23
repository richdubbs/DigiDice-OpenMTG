/**
 * p2-replace-events-1 ADDITION: the `ReplStatic` hole, the rest of a sentence read as one complete static ability made only of replacement effects (CR 614.1a),
 * value: its `StaticEffect[]`. For "{d:Dur} , {r:ReplStatic}": "Until end of turn, if one or more tokens would be created under your control, twice that many of
 * those tokens are created instead." is the replacement effect a spell or ability creates for that duration (CR 611.2a, 614.1a), the same effect a static
 * ability with those words has. The words are parsed as a quoted ability is (HoleEnv.subParser, lower/quoted.ts: only a COMPLETELY understood ability comes
 * back), from the hole to the end of the sentence. Fails closed: nothing without a sub-parser; nothing but one static ability whose every effect is a
 * replacement, with no ability-level condition or zone; nothing that mentions the object itself (`self`, "~": inside a quote that is the object that has the
 * ability, here it would be the card that created the effect) or keeps a placeholder ("$..."). Weak (design 6.3 rule 2): a template written for one such
 * sentence keeps it.
 */
import type { HoleFn } from './core';

const isRec = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export const replStatic: HoleFn = (ctx, pos) => {
  if (ctx.subParser === undefined || pos >= ctx.toks.length) return [];
  // only an "if ... would ..." sentence is offered to the sub-parser (it records the templates of what it understood, parser/parse.ts#useQuoted, even when this
  // hole then refuses the reading)
  const words = ctx.toks.slice(pos).map((t) => t.norm);
  if (words[0] !== 'if' || !words.includes('would')) return [];
  // the unit's tokens end where the sentence does (its period is not a token of the unit): the hole is the rest of the sentence
  const sub = ctx.subParser(ctx.toks.slice(pos));
  if (sub === null || sub.length !== 1) return [];
  const a = sub[0];
  if (!isRec(a) || a['kind'] !== 'static' || !Array.isArray(a['effects']) || a['effects'].length === 0) return [];
  if (Object.keys(a).some((k) => !['kind', 'effects', 'text', 'src', 'prov'].includes(k))) return [];
  const effects = a['effects'] as unknown[];
  if (!effects.every((e) => isRec(e) && e['s'] === 'replace')) return [];
  const json = JSON.stringify(effects);
  if (json.includes('"self":true') || json.includes('"ref":"self"') || json.includes('"$')) return [];
  return [{ end: ctx.toks.length, value: effects, weak: 1 }];
};
