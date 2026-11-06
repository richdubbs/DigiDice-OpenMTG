/**
 * edh-zones-8 (Commander lane edh-zones): the folds of its templates (parser/templates/zz-cloud/edh-zones-8.json), called from render/fold.ts#foldAt.
 *
 * `putThenShuffleRestOfRevealed` (CR 701.20a, 701.24a, 608.2c; Kindred Summons): "Put those cards onto the battlefield, then shuffle the rest of the revealed cards into your
 * library.": the cards a "reveal until" stopped at go onto the battlefield under your control, then every other revealed card still in the library goes into the library
 * and you shuffle. Only that exact shape: a move of a bound group, a move of the revealed cards that are not that group (still in the library) to a library with no
 * position, order or owner named, and your shuffle, with no guard, name, duration or link on any of them.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { alt } from './text';
import type { RenderState } from './state';

function putThenShuffleRestOfRevealed(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const c = list[i + 2];
  if (a?.op !== 'move' || b?.op !== 'move' || c?.op !== 'shuffle' || a.what.ref !== 'bound' || b.what.ref !== 'each') return null;
  if ([a, b, c].some((s) => s.guard !== undefined || s.as !== undefined) || [a, b].some((s) => s.until !== undefined || s.link !== undefined || s.remember !== undefined) || c.ifSearched !== undefined) return null;
  if (JSON.stringify(a.to) !== JSON.stringify({ zone: 'battlefield', controller: { ref: 'you' } }) || JSON.stringify(b.to) !== JSON.stringify({ zone: 'library' }) || JSON.stringify(c.who) !== JSON.stringify({ ref: 'you' })) return null;
  const f = b.what.filter;
  if (Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join(',') !== 'is,not,zone' || f.zone !== 'library' || f.is?.ref !== 'bound' || f.not?.is === undefined || JSON.stringify(f.not.is) !== JSON.stringify(a.what)) return null;
  if (st.info.get(`b:${f.is.name}`) === undefined) return null;
  const them = K.obj(a.what, st, 'object');
  if (!them.plural) return null;
  // edh-next-101 (family shuffle-the-rest-short; Selvala's Stampede): also "the rest"
  const text = `put ${them.text} onto the battlefield, then shuffle ${alt('the rest of the revealed cards', 'the rest')} into your library`;
  return { clauses: [plain(text, { standalone: true })], consumed: 3 };
}

export function foldEdhZones8(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return putThenShuffleRestOfRevealed(list, i, st);
}
