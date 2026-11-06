/**
 * edh-top-8: the folds of its templates (parser/templates/zz-cloud/edh-top-8.json), called from render/fold.ts#foldAt.
 *
 * `separatePermanentsThenSacrifice` (CR 700.3, 700.3a, 700.3d, 608.2d, 701.21a; templates eff.edht8.piles.separatePermanents and eff.edht8.piles.thatPlayerSacrificesChosen; Liliana of the
 * Veil): "Separate all permanents target player controls into two piles. That player sacrifices all permanents in the pile of their choice.": you separate every permanent one player
 * controls into two piles, that player chooses a pile, and sacrifices all its permanents. Only that exact body (the player named by a target or a reference, the pile names read by
 * nothing after).
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function separatePermanentsThenSacrifice(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const p = list[i];
  const s = list[i + 1];
  if (p?.op !== 'piles' || s?.op !== 'sacrificeChoice' || p.guard !== undefined || s.guard !== undefined || p.faceDown !== undefined) return null;
  if (!same(p.separator, { ref: 'you' }) || p.cards.ref !== 'each' || !('filter' in p.cards)) return null;
  const f = p.cards.filter as unknown as Record<string, unknown>;
  if (Object.keys(f).length !== 1 || !same(f['controller'], p.chooser) || p.chooser.ref === 'you') return null;
  if (!same(s.who, p.chooser) || !same(s.filter, { is: { ref: 'bound', name: p.chosen } }) || s.mode !== 'all' || s.count !== 1 || s.chooser !== undefined || s.cantAs !== undefined || s.exploit !== undefined || s.keepTypes !== undefined || s.keepFilter !== undefined) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"${p.chosen}"`) || JSON.stringify(x).includes(`"${p.other}"`))) return null;
  const who = K.player(p.chooser, st, 'subject');
  if (who.plural) return null;
  return { clauses: [plain(`separate all permanents ${who.text} controls into two piles. that player sacrifices all permanents in the pile of their choice`, { standalone: true })], consumed: 2 };
}

export function foldEdhT8(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return separatePermanentsThenSacrifice(list, i, st);
}
