/**
 * edh-next-125 (must-finish round: becomes a creature, counters, artifacts): the fold of its template eff.edhn125.becomes.ptArtifactCreature.countersOnEachThatBecame
 * (parser/templates/zz-cloud/edh-next-125.json), called from render/fold.ts#foldAt.
 *
 * (CR 205.1b, 611.2c, 613.1d, 613.4b, 122.1; Rise and Shine): "Target noncreature artifact you control becomes a 0/0 artifact creature. Put four +1/+1 counters on each artifact
 * that became a creature this way.": a permanent continuous effect that ADDS the artifact and creature types and sets a numeric base power and toughness of its objects, bound
 * (`as`, op:effect.as), then counters on each bound object that is an artifact creature now (the objects that effect made creatures). Exactly the two steps the template builds.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';
import { K } from './kernel';
import { numWord } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function becomesThenCountersOnEachThatBecame(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [e, c] = [list[i], list[i + 1]];
  if (e?.op !== 'effect' || c?.op !== 'putCounters' || e.as === undefined || e.guard !== undefined || c.guard !== undefined) return null;
  if (!same(e.duration, { d: 'permanent' }) || e.effects.length !== 1) return null;
  for (const k of Object.keys(e)) if (!['op', 'duration', 'effects', 'as', 'sentence'].includes(k)) return null;
  const x = e.effects[0]!;
  if (x.s !== 'continuous' || x.cda === true || x.mods.length !== 2) return null;
  for (const k of Object.keys(x)) if (!['s', 'affects', 'mods'].includes(k)) return null;
  const [m4, m7] = x.mods;
  if (!same(m4, { layer: 4, types: { add: ['Artifact', 'Creature'] } })) return null;
  if (m7?.layer !== '7b' || typeof m7.power !== 'number' || typeof m7.toughness !== 'number' || Object.keys(m7).length !== 3) return null;
  if ((x.affects.ref !== 'target' && x.affects.ref !== 'each') || !('id' in x.affects || 'filter' in x.affects)) return null;
  if (!same(c.on, { ref: 'bound', name: e.as, which: { allTypes: ['Artifact', 'Creature'] } }) || typeof c.count !== 'number') return null;
  for (const k of Object.keys(c)) if (!['op', 'on', 'kind', 'count', 'sentence'].includes(k)) return null;
  if (list.slice(i + 2).some((s) => JSON.stringify(s).includes(`"${e.as}"`))) return null;
  // review (CR 611.2c, 205.1b): "each artifact that became a creature this way" is every bound object only when none of them was a creature before (the description of what the
  // effect takes says "noncreature"); a target or group that may already be a creature has no reading here (the counters step reads "is an artifact creature now")
  const taken = x.affects.ref === 'target' ? st.specs.get(x.affects.id)?.filter : 'filter' in x.affects ? x.affects.filter : undefined;
  if (taken === undefined || !(taken.notTypes ?? []).includes('Creature') || taken.anyOf !== undefined || taken.not !== undefined) return null;
  const subject = K.obj(x.affects as ObjRef, st, 'subject');
  const verb = subject.plural ? 'become' : 'becomes';
  const counters = `${numWord(c.count)} ${c.kind} counter${c.count === 1 ? '' : 's'}`;
  return { clauses: [plain(`${subject.text} ${verb} a ${m7.power}/${m7.toughness} artifact creature. put ${counters} on each artifact that became a creature this way`, { standalone: true })], consumed: 2 };
}

/** The folds of edh-next-125 (render/fold.ts#foldAt). */
export function foldEdhN125(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return becomesThenCountersOnEachThatBecame(list, i, st);
}
