/**
 * edh-c-32 (coordinator C, EDHREC ranks 24,001-24,500): the folds of its templates (parser/templates/zz-cloud/edh-c-32.json), called from render/fold.ts#foldAt.
 *
 * `revealsHandDiscardsAllNonland` (CR 701.20a, 701.9a, 402.3; eff.edhv32.player.revealsHandDiscardsAll; Amnesia): "Target player reveals their hand and discards all nonland
 * cards.": one player reveals their hand, then discards every card in it that is not a land. Only that shape.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function revealsHandDiscardsAllNonland(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const r = list[i];
  const d = list[i + 1];
  if (r?.op !== 'reveal' || d?.op !== 'discard' || r.guard !== undefined || d.guard !== undefined || r.as !== undefined || d.as !== undefined) return null;
  if (!same(r.what, { ref: 'each', filter: { zone: 'hand', owner: r.who } }) || !same(d.who, r.who) || d.count !== 'hand' || !same(d.filter, { notTypes: ['Land'] }) || d.mode !== undefined || d.cantAs !== undefined) return null;
  if (Object.keys(r).filter((k) => !['op', 'who', 'what'].includes(k) && (r as unknown as Record<string, unknown>)[k] !== undefined).length > 0) return null;
  const who = K.player(r.who, st, 'subject');
  const pl = who.person === 'pl';
  return { clauses: [plain(`${who.text} ${pl ? 'reveal' : 'reveals'} their hand and ${pl ? 'discard' : 'discards'} all nonland cards`, { standalone: true })], consumed: 2 };
}

export function foldEdhV32(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return revealsHandDiscardsAllNonland(list, i, st);
}
