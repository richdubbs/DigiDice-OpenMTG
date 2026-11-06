/**
 * edh-c-25 (Commander effort, coordinator C; ranks 20,501-21,000): the folds of its readings, called from render/fold.ts#foldAtPlain.
 *
 * `createThenThoseGain` (CR 608.2c, 611.2a, 111.1; family create-and-those-tokens-gain; Warren Weirding): a creation of tokens and the ability they gain, joined in one sentence,
 * "Create two 1/1 black Goblin Rogue creature tokens, and those tokens gain haste until end of turn." (the model's own form, "..., and they gain haste ..." after a sentence break, stays
 * the display). Only a `createToken` of two or more tokens with its binding and the one `effect` step right after it that affects exactly that binding.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function createThenThoseGain(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'createToken' || b?.op !== 'effect' || a.as === undefined || a.guard !== undefined || b.guard !== undefined || b.as !== undefined || b.effects.length !== 1) return null;
  if (typeof a.count !== 'number' || a.count < 2) return null;
  // plain tokens only: a token with abilities of its own is said with a quote, and the joiner's own sentence break after it (family quote-ends-sentence) stays as it was
  if (Object.keys(a.token).some((k) => !['colors', 'types', 'subtypes', 'power', 'toughness'].includes(k))) return null;
  const e = b.effects[0]!;
  if (e.s !== 'continuous' || !same(e.affects, { ref: 'bound', name: a.as })) return null;
  const made = K.clause(a, st);
  if (made.empty === true || made.standalone === true) return null;
  const grant = K.clause(b, st);
  if (grant.empty === true || grant.standalone === true || grant.actor !== null) return null;
  // (the clause of the grant already says its subject as "they" / "those tokens" / "the tokens", render/mods.ts)
  // (the two-sentence form is the joiner's own and stays a reading: this fold must not take it away from the cards that print it)
  const lead = made.actor === null ? [made.imp] : [made.imp, made.sub];
  return { clauses: [plain(alt(...lead.flatMap((m) => [`${m}, and ${grant.imp}`, `${m}. ${grant.imp}`])), { standalone: true })], consumed: 2 };
}

export function foldEdhV25(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return createThenThoseGain(list, i, st);
}
