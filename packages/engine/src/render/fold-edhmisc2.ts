/**
 * edh-misc-2 (Commander lane edh-misc): the folds of its templates (parser/templates/zz-cloud/edh-misc-2.json), called from render/fold.ts#foldAt.
 *
 * `putOneOfThemOntoBattlefield` (CR 608.2c-d, 110.2, 400.7; eff.edhx2.put.oneOfThem.bf; Colossal Grave-Reaver): "put one of them onto the battlefield": the controller
 * chooses exactly one object of a group named before (the cards a "one or more cards are put into your graveyard" trigger is about), no target, then puts the chosen
 * one onto the battlefield under their control. Only that shape: one choice by "you" of exactly one object of a plural reference, then a plain move of what was chosen
 * to the battlefield, and nothing after it reading the choice.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';

const boundTo = (r: ObjRef | null | undefined, name: string | undefined): boolean => r?.ref === 'bound' && name !== undefined && r.name === name;

function putOneOfThemOntoBattlefield(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || a.random === true || a.guard !== undefined || b.guard !== undefined || b.as !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.groupLimit !== undefined || a.perPlayer !== undefined || a.as === undefined || !boundTo(b.what, a.as)) return null;
  if (Object.keys(b).sort().join(',') !== 'op,to,what' || JSON.stringify(b.to) !== '{"zone":"battlefield","controller":{"ref":"you"}}') return null;
  if (JSON.stringify(list.slice(i + 2)).includes(`"name":"${a.as}"`)) return null;
  const from = a.from;
  if (from.ref === 'each') return null; // a filter is read where the zone says (the battlefield by default): the cards of an event are named by the event itself
  const them = K.obj(from, st, 'object');
  if (!them.plural) return null;
  bind(st, a.as, { nouns: K.nounsOf({}), plural: false });
  return { clauses: [plain(`put one of ${them.text} onto the battlefield`)], consumed: 2 };
}

export function foldEdhMisc2(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return putOneOfThemOntoBattlefield(list, i, st);
}
