/**
 * edh-players-8 (Commander lane edh-players): the folds of its templates (parser/templates/zz-cloud/edh-players-8.json), called from render/fold.ts#foldAt. CR cites from
 * memory, unverified unless the record says otherwise.
 *
 * `playerChoosesUpToSacrificesRest` (CR 101.4, 608.2d, 701.21a; Archfiend of Depravity): "that player chooses up to two creatures they control, then sacrifices the rest."
 * One player (the player of the trigger's event) chooses at most N of their permanents of a kind, then sacrifices every other permanent of that kind they control. Exactly
 * the two steps of template eff.edhp8.player.chooses.upTo.sacrificesRest.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';
import { numWord } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function playerChoosesUpToSacrificesRest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.guard !== undefined || a.random === true || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined || a.eachCardType !== undefined
    || a.link !== undefined || a.distinct !== undefined || a.damageSource !== undefined || a.as === undefined || a.min !== 0 || typeof a.max !== 'number' || a.max < 1) return null;
  if (a.who.ref !== 'event' || a.who.role !== 'player' || a.from.ref !== 'each' || !('filter' in a.from)) return null;
  const f = a.from.filter;
  const kinds = f.anyOf;
  if (kinds?.length !== 1 || !same(f.controller, a.who) || Object.keys(f).length !== 2) return null;
  if (b?.op !== 'sacrificeChoice' || b.guard !== undefined || b.mode !== 'all' || b.as !== undefined || b.cantAs !== undefined || b.exploit !== undefined || !same(b.who, a.who)) return null;
  if (!same(b.filter, { anyOf: kinds, controller: a.who, not: { is: { ref: 'bound', name: a.as } } })) return null;
  const n = a.max;
  const things = n === 1 ? `one ${K.np(kinds[0]!, st, { det: 'none' })}` : `${numWord(n)} ${K.np(kinds[0]!, st, { det: 'none', plural: true })}`;
  const subj = K.player(a.who, st, 'subject').text;
  bind(st, a.as, { nouns: K.nounsOf(kinds[0]!), plural: n !== 1 });
  return { clauses: [plain(`${subj} chooses up to ${things} they control, then sacrifices the rest`, { standalone: true })], consumed: 2 };
}

/** The folds of edh-players-8 (render/fold.ts#foldAt). */
export function foldEdhP8(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return playerChoosesUpToSacrificesRest(list, i, st);
}
