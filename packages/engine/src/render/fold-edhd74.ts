/**
 * edh-d-74 (coordinator D, lane pay-or-else): the folds of its templates (parser/templates/zz-cloud/edh-d-74.json), called from render/fold.ts#foldAt. Each applies only when every
 * part is exactly what the idiom says.
 *
 * `playerExilesAllLibrary` (CR 701.13a, 406.2, 608.2c; Thought Lash, eff.edhd74.player.exile.allLibrary): "That player exiles all cards from their library.": every card in that
 * player's library goes to exile (one move of each such card, nothing else on the step).
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function playerExilesAllLibrary(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  if (m?.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || !same(m.to, { zone: 'exile' })) return null;
  if (Object.keys(m).sort().join(',') !== 'op,to,what' || m.what.ref !== 'each') return null;
  const f = m.what.filter as unknown as { zone?: unknown; owner?: unknown; isCard?: unknown } & Record<string, unknown>;
  if (Object.keys(f).sort().join(',') !== 'isCard,owner,zone' || f.zone !== 'library' || f.isCard !== true || f.owner === undefined || typeof f.owner !== 'object') return null;
  const who = K.player(f.owner as never, st, 'subject');
  return { clauses: [plain(`${who.text} exiles all cards from their library`)], consumed: 1 };
}

export function foldEdhD74(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return playerExilesAllLibrary(list, i, st);
}
