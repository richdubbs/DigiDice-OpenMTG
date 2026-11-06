/**
 * edh-next-106 (CR 607.2d, 205.1b, 205.3i; Thran Portal): "As this land enters, choose a basic land type. This land is the chosen type in addition to its other types.": the static
 * ability's template (sta.c5.self.chosenType.inaddition) reads the link `type` of a creature type choice, while the land type choice (rep.enters.choose.landtype) stores its answer
 * under the link `landType`. When a face has no producer of the link `type` and exactly one producer of any type choice, a land type choice, the reader of `type` reads that choice's
 * link. Nothing else changes; a face with a creature type or card type choice, or with two choices, is left exactly as it was (it stays as manual as before).
 */
import type { AbilityDef } from '../types/ability';

type Node = Record<string, unknown>;
const isNode = (x: unknown): x is Node => typeof x === 'object' && x !== null && !Array.isArray(x);

function walk(x: unknown, f: (n: Node) => void): void {
  if (Array.isArray(x)) { for (const y of x) walk(y, f); return; }
  if (!isNode(x)) return;
  f(x);
  for (const v of Object.values(x)) walk(v, f);
}

export function aliasChosenLandTypeLink(abilities: AbilityDef[]): AbilityDef[] {
  let readsType = false;
  const producers: { link: string; what: string }[] = [];
  walk(abilities, (n) => {
    const s = n['subtypes'];
    if (isNode(s) && s['chosen'] === 'type') readsType = true;
    if (typeof n['link'] === 'string' && (n['what'] === 'creatureType' || n['what'] === 'landType' || n['what'] === 'cardType')) producers.push({ link: n['link'], what: n['what'] as string });
  });
  if (!readsType || producers.length !== 1 || producers[0]!.what !== 'landType' || producers[0]!.link === 'type') return abilities;
  const to = producers[0]!.link;
  const copy = JSON.parse(JSON.stringify(abilities)) as AbilityDef[];
  walk(copy, (n) => {
    const s = n['subtypes'];
    if (isNode(s) && s['chosen'] === 'type') s['chosen'] = to;
  });
  return copy;
}
