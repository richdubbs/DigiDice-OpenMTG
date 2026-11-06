/**
 * edh-zones-12 ADDITION: the `AdjCard` hole, "a historic card", "a legendary card", "a multicolored card": the card description of an article, adjectives alone and the card noun (CR 700.6, 205.4a,
 * 105.2, 108.1). The value is the filter without `isCard` (as DiscardDesc's), and nothing with a card type, a subtype, a number or a characteristic to compare: those descriptions are the
 * `Filter` hole's (a template that reads "{f:Filter} card" owns them), so a template using this hole never competes with theirs (Weatherlight: "You may reveal a historic card from
 * among them and put it into your hand").
 */
import type { Alt, HoleFn } from './core';
import { npAlts } from './filter';

const ADJECTIVE_KEYS: ReadonlySet<string> = new Set(['anyOf', 'supertypes', 'notSupertypes', 'colors', 'colorless', 'multicolored', 'monocolored']);

export const adjCard: HoleFn = (ctx, pos) => {
  const t = ctx.toks[pos]?.norm;
  if (t !== 'a' && t !== 'an') return [];
  const out: Alt[] = [];
  for (const n of npAlts(ctx, pos + 1)) {
    if (n.number !== 'singular' || n.head !== 'card' || n.filter.zone !== undefined) continue;
    const { isCard: _isCard, ...rest } = n.filter;
    const keys = Object.keys(rest).filter((k) => (rest as Record<string, unknown>)[k] !== undefined);
    if (keys.length === 0 || !keys.every((k) => ADJECTIVE_KEYS.has(k))) continue;
    // an `anyOf` is the historic reading's alternatives (an artifact, a legendary permanent, a Saga), not a list of card types or other descriptions
    if (rest.anyOf !== undefined && JSON.stringify(rest) !== JSON.stringify({ anyOf: [{ types: ['Artifact'] }, { supertypes: ['Legendary'] }, { subtypes: ['Saga'] }] })) continue;
    const flags = n.flags.filter((f) => f !== 'zone-unstated');
    out.push({ end: n.end, value: rest, ...(n.weak ? { weak: n.weak } : {}), ...(flags.length > 0 ? { flags } : {}) });
  }
  return out;
};
