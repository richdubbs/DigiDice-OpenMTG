/**
 * edh-c-65 (Commander lane edh-c, ranks 21,001-21,500, second pass): the folds of its templates (parser/templates/zz-cloud/edh-c-65.json), called from render/fold.ts#foldAt. Each
 * applies only when every part is exactly what the idiom says.
 *
 * `returnCardAndCard` (CR 400.2, 608.2c-d, 700.2; Sudden Reclamation, eff.edhv65.return.cardAndCard.graveyard.hand): "Return a creature card and a land card from your graveyard to
 * your hand.": your choice of one card of each description in your graveyard (the second a card other than the first) and the move of both into your hand. Exactly those three
 * steps, the choices named by nothing but the move.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function returnCardAndCard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, m] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'chooseObjects' || m?.op !== 'move' || a.as !== 'regrowA' || b.as !== 'regrowB') return null;
  for (const c of [a, b]) {
    if (c.guard !== undefined || c.random !== undefined || c.groupLimit !== undefined || c.perPlayer !== undefined || c.link !== undefined || c.min !== 1 || c.max !== 1 || !same(c.who, { ref: 'you' }) || c.from.ref !== 'each') return null;
  }
  if (a.from.ref !== 'each' || b.from.ref !== 'each') return null;
  const fa = a.from.filter;
  const { not, ...fb } = b.from.filter;
  if (!same(not, { is: { ref: 'bound', name: 'regrowA' } }) || fa.anyOf?.length !== 1 || fb.anyOf?.length !== 1) return null;
  const rest = (f: typeof fa): unknown => ({ ...f, anyOf: undefined });
  if (!same(rest(fa), { zone: 'graveyard', owner: 'you', isCard: true }) || !same(rest(fb), { zone: 'graveyard', owner: 'you', isCard: true })) return null;
  if (m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || !same(m.to, { zone: 'hand' })) return null;
  if (!same(m.what, { ref: 'union', of: [{ ref: 'bound', name: 'regrowA' }, { ref: 'bound', name: 'regrowB' }] })) return null;
  if (list.slice(i + 3).some((x) => /"name":"regrow[AB]"/.test(JSON.stringify(x)))) return null;
  const np = (f: NonNullable<typeof fa.anyOf>[number]): string => K.np({ ...f, zone: 'graveyard', owner: 'you' }, st, { det: 'a', noZone: true });
  const [x, y] = [fa.anyOf![0]!, fb.anyOf![0]!];
  return { clauses: [plain(`return ${np(x)} and ${np(y)} from your graveyard to your hand`)], consumed: 3 };
}

export function foldEdhV65(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return returnCardAndCard(list, i, st);
}
