/**
 * edh-next-79 (Commander lane rest, second round): the folds of its readings, called from render/fold.ts#foldAtPlain.
 *
 * `returnThenThoseGain` (CR 608.2c, 611.2a, 400.7, 603.7; family return-and-those-gain; Legion's Initiative): a move of a bound group onto the battlefield and the ability
 * those objects gain, joined in one sentence: "return those cards to the battlefield under their owner's control and those creatures gain haste until end of turn" (the model's
 * own two-sentence form stays a reading). Only a `move` of a bound name onto the battlefield and the one `effect` step right after it that affects exactly that binding.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function returnThenThoseGain(list: EffectStep[], i: number, st: RenderState): Folded | null {
  if (st.inDelayBody !== true) return null;
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'move' || b?.op !== 'effect' || a.guard !== undefined || b.guard !== undefined || b.as !== undefined || b.effects.length !== 1) return null;
  if (a.what.ref !== 'bound' || a.to.zone !== 'battlefield') return null;
  const e = b.effects[0]!;
  if (e.s !== 'continuous' || !same(e.affects, a.what)) return null;
  const moved = K.clause(a, st);
  if (moved.empty === true || moved.standalone === true) return null;
  const grant = K.clause(b, st);
  if (grant.empty === true || grant.standalone === true || grant.actor !== null) return null;
  const lead = moved.actor === null ? [moved.imp] : [moved.imp, moved.sub];
  return { clauses: [plain(alt(...lead.flatMap((m) => [`${m} and ${grant.imp}`, `${m}, and ${grant.imp}`, `${m}. ${grant.imp}`])), { standalone: true })], consumed: 2 };
}

export function foldEdhN79(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return returnThenThoseGain(list, i, st);
}
