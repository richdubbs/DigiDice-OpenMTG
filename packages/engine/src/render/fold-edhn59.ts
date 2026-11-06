/**
 * edh-next-59 (Commander lane graveyard): the folds of its templates (parser/templates/zz-cloud/edh-next-59.json), called from render/fold.ts#foldAt. CR cites from the
 * Comprehensive Rules of 2026-09-25 unless marked unverified.
 *
 * `returnSelfThenAttach` (CR 113.6m, 400.7, 301.5c, 701.3a; Sword of the Meek): "return ~ from your graveyard to the battlefield, then attach it to that creature.": the move of
 * the card itself to the battlefield under your control (remembered as `moved`), then the attach of that new permanent to the creature of the trigger event. Only that exact pair.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function returnSelfThenAttach(list: EffectStep[], i: number): Folded | null {
  const m = list[i];
  const a = list[i + 1];
  if (m?.op !== 'move' || a?.op !== 'attach' || m.guard !== undefined || m.until !== undefined || m.remember !== undefined || m.link !== undefined || m.as !== 'moved') return null;
  if (!same(m.what, { ref: 'self' }) || !same(m.to, { zone: 'battlefield', controller: { ref: 'you' } })) return null;
  if (a.guard !== undefined || a.as !== undefined || !same(a.what, { ref: 'bound', name: 'moved' }) || !same(a.to, { ref: 'event', role: 'subject' })) return null;
  return { clauses: [plain('return ~ from your graveyard to the battlefield, then attach it to that creature', { standalone: true })], consumed: 2 };
}

export function foldEdhN59(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  return returnSelfThenAttach(list, i);
}
