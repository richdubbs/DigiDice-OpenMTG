/**
 * edh-c-10 (Commander lane edh-c, code edhv10): the folds of its templates (parser/templates/zz-cloud/edh-c-10.json), called from render/fold.ts#foldAt.
 *
 * `damageThenSelfGains` (CR 120.3, 611.2a, 613.1f, 608.2c; Ellie, Vengeful Hunter; eff.edhv10.self.dealsDamage.andGains): "~ deals 2 damage to target player and gains
 * indestructible until end of turn": the damage the object itself deals, then a lasting ability grant to the object itself, with the subject said once. Only ~ itself, a fixed
 * amount, one continuous effect of one layer 6 grant; the two steps written apart stay readings.
 */
import type { EffectStep } from '../types/ability';
import { fragment, plain } from './clause';
import { K } from './kernel';
import { withVariants, type RenderState } from './state';
import type { Folded } from './fold';
import { NoRenderer, parseMarked, serializeMarked, type MarkedNode } from './text';

function damageThenSelfGains(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'damage' || b?.op !== 'effect' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  if (a.source.ref !== 'self' || a.divided !== undefined || a.also !== undefined || a.unpreventable === true) return null;
  if (b.effects.length !== 1 || b.duration === undefined) return null;
  const e = b.effects[0]!;
  if (e.s !== 'continuous' || e.cda === true || e.affects.ref !== 'self' || e.mods.length !== 1 || e.mods[0]!.layer !== 6 || !('add' in e.mods[0]!)) return null;
  // the grant clause without its subject ("it"): the damage before names it
  const gains = (v: RenderState): string => {
    const nodes = parseMarked(fragment(K.clause(b, v)));
    const isSubject = (n: MarkedNode[]): boolean => n.length === 1 && typeof n[0] === 'string' && /^(?:~|it|he|she)$/.test(n[0]);
    // the clause is one group of orderings; the one that starts with the subject is " gains <abilities> <duration>" after it (the other wordings of the parts are kept)
    const outer = nodes.length === 1 && nodes[0] !== undefined && typeof nodes[0] !== 'string' ? nodes[0].alts : [];
    const first = outer[0];
    const subject = first?.[0];
    if (first === undefined || subject === undefined || typeof subject === 'string' || !subject.alts.every(isSubject) || first[1] !== ' ') {
      throw new NoRenderer('a grant clause after the damage of ~ whose words do not begin with its subject');
    }
    const rest = first.slice(2);
    return serializeMarked(rest);
  };
  const [one] = withVariants(st, [(v) => `${fragment(K.clause(a, v))} and ${gains(v)}`]);
  return { clauses: [plain(one!)], consumed: 2 };
}

export function foldEdhV10(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return damageThenSelfGains(list, i, st);
}
