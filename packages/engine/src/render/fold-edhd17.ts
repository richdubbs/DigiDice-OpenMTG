/**
 * Commander round edh-d-17: the folds of the steps its templates build (render/fold.ts#foldAt tries `foldEdhD17` after the other slices' own folds). A fold applies only when
 * every part is exactly what the idiom says. CR cites are from memory (unverified in cloud sessions) unless marked checked.
 *
 * `preventAllByChosenColor` (CR 615.1, 615.6, 608.2d, 105.1, 611.2a; Avacyn, Guardian Angel, eff.edhd17.prevent.all.toObj.dur.byChosenColor and
 * eff.edhd17.prevent.all.toPlayerOrPlaneswalker.dur.byChosenColor): "Prevent all damage that would be dealt to another target creature this turn by sources of the color of
 * your choice.": the choice of a color as the effect resolves and the lasting effect that prevents all damage the recipient would be dealt by sources of that color.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
type StaticEffect = Record<string, any>; // a static effect of the lasting effect, read by shape only

function preventAllByChosenColor(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseValue' || b?.op !== 'effect') return null;
  if (a.guard !== undefined || a.what !== 'color' || a.options !== undefined || !same(a.who, { ref: 'you' }) || a.link !== 'preventColor' || a.as !== 'preventColor') return null;
  if (b.guard !== undefined || b.as !== undefined || b.effects.length !== 1 || Object.keys(b).some((k) => !['op', 'duration', 'effects'].includes(k))) return null;
  const e = b.effects[0] as unknown as StaticEffect;
  if (e.s !== 'replace' || !same(e.body, { b: 'prevent', amount: 'all' }) || Object.keys(e).some((k) => !['s', 'replaces', 'body'].includes(k))) return null;
  const r = e.replaces as StaticEffect;
  if (r.ev !== 'damage' || Object.keys(r).length !== 3 || !same(r.source, { chosen: { link: 'preventColor', quality: 'color' } }) || typeof r.recipient !== 'object' || r.recipient === null) return null;
  const rec = r.recipient as StaticEffect;
  const target = rec.object?.is;
  if (target === undefined || (Object.keys(rec).length === 2 ? !same(rec.player, target) : Object.keys(rec).length !== 1)) return null;
  const dur = K.dur(b.duration, st);
  if (!dur) return null;
  const to = K.obj(target, st, 'object').text;
  return { clauses: [plain(`prevent all damage that would be dealt to ${to} ${dur} by sources of the color of your choice`, { standalone: true })], consumed: 2 };
}

/**
 * `eachOtherBecomesCopyOfTarget` (CR 707.2, 707.4, 109.2, 611.2a, 613.1a; Mirrorweave, eff.r4copy.eachOther.becomeCopy.dur): "Each other creature becomes a copy of target nonlegendary
 * creature until end of turn.": every object of a description except the one targeted becomes a copy of that target. The target is named once, after the copy words, as Oracle
 * writes it (the generic wording names it in the subject, "all creatures other than target ...", and says "it" after). Only that exact shape.
 */
function eachOtherBecomesCopyOfTarget(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const b = list[i];
  if (b?.op !== 'effect' || b.guard !== undefined || b.as !== undefined || b.effects.length !== 1 || Object.keys(b).some((k) => !['op', 'duration', 'effects'].includes(k))) return null;
  const e = b.effects[0] as unknown as StaticEffect;
  if (e.s !== 'continuous' || Object.keys(e).some((k) => !['s', 'affects', 'mods'].includes(k)) || e.mods?.length !== 1) return null;
  const m = e.mods[0] as StaticEffect;
  const aff = e.affects as StaticEffect;
  if (m.layer !== '1a' || Object.keys(m).some((k) => !['layer', 'copyOf'].includes(k)) || m.copyOf?.ref !== 'target' || aff?.ref !== 'each' || aff.filter === undefined) return null;
  const f = aff.filter as StaticEffect;
  if (Object.keys(f).filter((k) => f[k] !== undefined).sort().join() !== 'anyOf,not' || f.anyOf.length !== 1 || !same(f.not, { is: m.copyOf })) return null;
  const dur = K.dur(b.duration, st);
  if (!dur) return null;
  const group = K.np(f.anyOf[0], st, { det: 'none', plural: false });
  const target = K.obj(m.copyOf, st, 'object').text;
  return { clauses: [plain(`each other ${group} becomes a copy of ${target} ${dur}`, { standalone: true })], consumed: 1 };
}

/** The folds of edh-d-17 (render/fold.ts#foldAt). */
export function foldEdhD17(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return preventAllByChosenColor(list, i, st) ?? eachOtherBecomesCopyOfTarget(list, i, st);
}
