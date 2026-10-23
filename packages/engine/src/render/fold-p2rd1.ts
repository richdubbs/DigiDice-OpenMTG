/**
 * p2-replace-damage-1 (Phase 2 lane p2-replace-damage): the folds of its templates (parser/templates/zz-cloud/p2-replace-damage-1.json), called from
 * render/fold.ts#foldAt. As every fold, one applies only when every part is exactly what the idiom says (same players, bound names, nothing else in between).
 * CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import type { EffectStep } from '../types/ability';
import { alt } from './text';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** render/fold.ts#SOURCE_CHOICE_ZONES (FAST5 T36, CR 609.7a), said again here: a value import of fold.ts would be an import cycle (design 5.4). */
const SOURCE_CHOICE_ZONES = ['battlefield', 'stack'];

/**
 * "Prevent all damage a source of your choice would deal this turn." (Pay No Heed), "Prevent all damage a source of your choice would deal to you this turn." (Auriok
 * Replica), "Prevent all damage that would be dealt to you this turn by a source of your choice." (Consulate Surveillance; CR 609.7a, 615.1a, 611.2a): the source is
 * chosen as the effect resolves (`chooseObjects` among the objects that can be a source, render/fold.ts#SOURCE_CHOICE_ZONES), then a prevention of ALL the damage that
 * source would deal for the duration, to anything or to you; not a shield (no `shield`: unlike "the next time", it is not used up). Exactly the two steps of the
 * templates eff.p2rd1.prevent.all.sourceOfChoice.*; the chosen source is named nowhere else. Also "Prevent all combat damage a creature of your choice would deal this
 * turn." (Ajani's Aid; CR 510.2): a creature chosen, its combat damage only (eff.p2rd1.prevent.combat.creatureOfChoice.dur).
 */
function preventAllFromSourceOfChoice(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  const e = list[i + 1];
  if (c?.op !== 'chooseObjects' || c.who.ref !== 'you' || c.guard !== undefined || c.as === undefined || c.min !== 1 || c.max !== 1 || c.random !== undefined) return null;
  const creature = same(c.from, { ref: 'each', filter: { types: ['Creature'] } }); // "a creature of your choice", combat damage only (Ajani's Aid)
  if (!creature && !same(c.from, { ref: 'each', filter: { zone: SOURCE_CHOICE_ZONES } })) return null;
  if (e?.op !== 'effect' || e.guard !== undefined || e.as !== undefined || e.effects.length !== 1 || e.duration === undefined) return null;
  const r = e.effects[0]!;
  if (r.s !== 'replace' || r.condition !== undefined || r.optional !== undefined || r.selfReplacement !== undefined || r.shield !== undefined) return null;
  if (!same(r.body, { b: 'prevent', amount: 'all' })) return null;
  const source = { is: { ref: 'bound', name: c.as } };
  if (creature) {
    if (!same(r.replaces, { ev: 'damage', source, combat: true }) || list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":${JSON.stringify(c.as)}`))) return null;
    const cd = K.dur(e.duration, st);
    return { clauses: [plain(`prevent all combat damage a creature of your choice would deal${cd ? ` ${cd}` : ''}`)], consumed: 2 };
  }
  const toYou = same(r.replaces, { ev: 'damage', source, recipient: { player: 'you' } });
  if (!toYou && !same(r.replaces, { ev: 'damage', source })) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":${JSON.stringify(c.as)}`))) return null;
  const dur = K.dur(e.duration, st);
  const d = dur ? ` ${dur}` : '';
  const text = toYou
    ? alt(`prevent all damage a source of your choice would deal to you${d}`, `prevent all damage that would be dealt to you${d} by a source of your choice`)
    : `prevent all damage a source of your choice would deal${d}`;
  return { clauses: [plain(text)], consumed: 2 };
}

/** The folds of p2-replace-damage-1 (render/fold.ts#foldAt). */
export function foldP2ReplaceDamage1(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return preventAllFromSourceOfChoice(list, i, st);
}
