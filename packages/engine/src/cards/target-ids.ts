/**
 * Target ids of a split card's halves made unique across the card (CR 702.102d, design 1.1.6). Owner: WP18.
 *
 * The parser compiles each half of a split card on its own, so both halves' spell abilities name their first target `t0`. A fused split spell (CR 702.102a)
 * is announced and resolved as ONE spell with the instructions of both halves (CR 702.102c-d), whose target ids must be unique (design 1.1.6, D1): with two
 * `t0`, the announcement could not tell the halves' targets apart. This renames the targets of the later halves (`t0` -> `t1`, ...) in every place the
 * model names a target of the same ability: `TargetSpec.id`, `TargetSpec.distinctFrom`, `{ref:'target', id}` and `{q:'targetCount', id}`. Abilities nested
 * inside an ability (a granted or quoted ability) have targets of their own and are left alone. Pure: returns new objects only where something changed.
 */
import type { AbilityDef } from '../types/ability';
import type { FaceDef } from '../types/card';

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const ABILITY_KINDS: ReadonlySet<unknown> = new Set(['spell', 'activated', 'triggered', 'static', 'keyword', 'manual', 'chapter', 'classLevel', 'levelBracket']);
/** An ability nested in another (a TargetSpec of kind 'spell' has min and max, an ability never does). */
const isAbility = (x: Rec): boolean => ABILITY_KINDS.has(x['kind']) && typeof x['text'] === 'string' && !('min' in x && 'max' in x);

/** The ids of the target specs of an ability's own effect (and its modes). */
function ownTargetIds(def: AbilityDef): string[] {
  const ids: string[] = [];
  const visit = (x: unknown, root: boolean): void => {
    if (Array.isArray(x)) return x.forEach((v) => visit(v, false));
    if (!isRec(x)) return;
    if (!root && isAbility(x)) return; // a nested ability
    if (Array.isArray(x['targets'])) for (const t of x['targets']) if (isRec(t) && typeof t['id'] === 'string') ids.push(t['id']);
    for (const v of Object.values(x)) visit(v, false);
  };
  visit(def, true);
  return ids;
}

function renamed(def: AbilityDef, map: ReadonlyMap<string, string>): AbilityDef {
  const walk = (x: unknown, root: boolean): unknown => {
    if (Array.isArray(x)) return x.map((v) => walk(v, false));
    if (!isRec(x)) return x;
    if (!root && isAbility(x)) return x;
    const out: Rec = {};
    for (const [k, v] of Object.entries(x)) out[k] = walk(v, false);
    const id = out['id'];
    const isRef = out['ref'] === 'target' || out['q'] === 'targetCount';
    const isSpec = typeof out['kind'] === 'string' && 'min' in out && 'max' in out;
    if (typeof id === 'string' && map.has(id) && (isRef || isSpec)) out['id'] = map.get(id);
    if (isSpec && Array.isArray(out['distinctFrom'])) out['distinctFrom'] = (out['distinctFrom'] as unknown[]).map((d) => (typeof d === 'string' && map.has(d) ? map.get(d) : d));
    return out;
  };
  return walk(def, true) as AbilityDef;
}

/** The faces of a split card with target ids unique across all its spell abilities. */
export function uniqueSplitTargetIds(faces: FaceDef[]): FaceDef[] {
  const used = new Set<string>();
  let next = 0;
  return faces.map((face) => ({
    ...face,
    abilities: face.abilities.map((a) => {
      if (a.kind !== 'spell') return a;
      const ids = ownTargetIds(a);
      const map = new Map<string, string>();
      for (const id of ids) {
        if (!used.has(id)) {
          used.add(id);
          continue;
        }
        while (used.has(`t${next}`) || ids.includes(`t${next}`)) next++;
        map.set(id, `t${next}`);
        used.add(`t${next}`);
      }
      return map.size === 0 ? a : renamed(a, map);
    }),
  }));
}
