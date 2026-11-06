/**
 * edh-d-5 (CR 702.16a-e, 702.16j, 205.3m; Gor Muldrak, Amphinologist): `ProtFrom`, "protection from Salamanders" (one quality only), the quality being a color, a card
 * type, a creature type or "<creature type> creatures" and nothing else (a quality the player's protection cannot state as an object description is not read: fail closed). Value:
 *   `{ abilities: [<the protection keyword ability>], filter: <the object description of the quality> }`:
 * a template gives the keyword abilities to permanents and the descriptions to the player's own protection (not enchanted, targeted or damaged by a source that matches, CR 702.16j).
 */
import type { HoleCtx, HoleFn } from './core';
import { P, phraseAt, spanOf } from './core';
import { qualityAt } from './misc';

const W_PROTECTION_FROM = P('protection from');

/** The object description of a quality string of rules/quality.ts, or null when it is not a color, a card type or a creature type. */
function filterOf(ctx: HoleCtx, quality: string): Record<string, unknown> | null {
  const color = /^color:([WUBRG])$/.exec(quality);
  if (color !== null) return { colors: [color[1]!] };
  const type = /^type:([A-Z][a-z]+)$/.exec(quality);
  if (type !== null) return { types: [type[1]!] };
  const sub = /^subtype:([a-z]+)$/.exec(quality);
  const typed = /^type:Creature&subtype:([a-z]+)$/.exec(quality);
  const plural = (sub ?? typed)?.[1];
  const name = plural !== undefined ? ctx.vocab.subtypes.get(plural)?.name : undefined;
  if (name === undefined) return null;
  return typed !== null ? { types: ['Creature'], subtypes: [name] } : { subtypes: [name] };
}

export const protFrom: HoleFn = (ctx, pos) => {
  const start = phraseAt(ctx, pos, W_PROTECTION_FROM);
  if (start < 0) return [];
  const out: { end: number; value: unknown }[] = [];
  for (const q of qualityAt(ctx, start)) {
    const filter = filterOf(ctx, q.quality);
    if (filter === null) continue;
    out.push({ end: q.end, value: { abilities: [{ kind: 'keyword', keyword: 'protection', quality: q.quality, text: spanOf(ctx, pos, q.end) }], filter } });
  }
  return out;
};
