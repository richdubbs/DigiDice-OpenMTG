/**
 * Commander round edh-d-5: the folds of the steps its templates build (render/fold.ts#foldAt tries `foldEdhD5` after the other slices' own folds). A fold applies only when every
 * part is exactly what the idiom says. CR cites are from the Comprehensive Rules text of 2026-09-25 unless marked unverified.
 *
 * `youProtectionChosenColor` (CR 702.16j, 702.16b, 702.16e, 608.2d, 611.2a; Seht's Tiger, eff.edhd5.you.gain.protectionChosenColor): "you gain protection from the color of your choice until end of
 * turn": the choice of a color as the effect resolves and the lasting effect that stops damage, targeting and enchanting by sources of that color (quality `chosen`, fixed as the effect begins).
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
type EffectStepStatic = Record<string, any>; // a static effect of the lasting effect, read by shape only

function youProtectionChosenColor(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseValue' || b?.op !== 'effect') return null;
  if (a.guard !== undefined || a.what !== 'color' || a.options !== undefined || !same(a.who, { ref: 'you' }) || a.link !== 'protectionColor' || a.as !== 'protectionColor') return null;
  if (b.guard !== undefined || b.as !== undefined || b.effects.length !== 3 || Object.keys(b).some((k) => !['op', 'duration', 'effects'].includes(k))) return null;
  const other = { chosen: { link: 'protectionColor', quality: 'color' } };
  const [r, t, e] = b.effects as unknown as [EffectStepStatic, EffectStepStatic, EffectStepStatic];
  const rep = { s: 'replace', replaces: { ev: 'damage', source: other, recipient: { player: 'you' } }, body: { b: 'prevent', amount: 'all' } };
  const ban = (x: EffectStepStatic, action: string): boolean => x.s === 'restrict' && x.mode === 'cant' && same(x.subject, { ref: 'you' }) && same(x.other, other) && Object.keys(x).length === 5 && x.action === action;
  if (!same(r, rep) || !ban(t, 'beTargeted') || !ban(e, 'beEnchanted')) return null;
  const dur = K.dur(b.duration, st);
  if (!dur) return null;
  return { clauses: [plain(`you gain protection from the color of your choice ${dur}`, { standalone: true })], consumed: 2 };
}

/** The folds of edh-d-5 (render/fold.ts#foldAt). */
export function foldEdhD5(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return youProtectionChosenColor(list, i, st);
}
