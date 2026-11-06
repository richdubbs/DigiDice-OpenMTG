/**
 * edh-players-13 (Commander lane edh-players): the folds of its templates (parser/templates/zz-cloud/edh-players-13.json), called from render/fold.ts#foldAtPlain.
 *
 * `gainControlOfThatPlayersObject` (CR 608.2d, 611.2a, 613.1b, 110.2a; Seize the Spotlight, eff.edhp13.gainControl.aThatPlayerControls.dur): inside "For each player who chose fame,"
 * you choose one object of a description that player controls and gain control of it for a duration: "gain control of a creature that player controls until end of turn".
 * Only that exact pair of steps (the choice by you of exactly one object, the layer-2 control change of it).
 *
 * `untapThemAndTheyGain` (CR 608.2c, 611.2a; Seize the Spotlight): the objects a loop chose, untapped and given an ability together: "Untap those creatures and they gain haste until
 * end of turn." Only after a loop that gathered them (the binding stands for the group, RefInfo.plural).
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import { dur } from './dur';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';
import { pluralize } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function gainControlOfThatPlayersObject(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'effect' || a.as === undefined || a.guard !== undefined || b.guard !== undefined || b.as !== undefined || a.link !== undefined) return null;
  if (!same(a.who, { ref: 'you' }) || a.min !== 1 || a.max !== 1 || a.random === true || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined
    || a.eachCardType !== undefined || a.distinct !== undefined || a.damageSource !== undefined) return null;
  if (a.from.ref !== 'each' || !('filter' in a.from)) return null;
  const f = a.from.filter;
  if (Object.keys(f).sort().join(',') !== 'anyOf,controller' || f.anyOf?.length !== 1 || f.controller === undefined || typeof f.controller !== 'object' || (f.controller as { ref?: string }).ref !== 'bound') return null;
  if (b.effects.length !== 1) return null;
  const e = b.effects[0]!;
  if (e.s !== 'continuous' || !same(e.affects, { ref: 'bound', name: a.as }) || !same(e.mods, [{ layer: 2, controller: { ref: 'you' } }])) return null;
  const kind = f.anyOf[0]!;
  const whose = K.player(f.controller as never, st, 'subject');
  if (whose.person !== 'sg') return null;
  const text = `gain control of ${K.np(kind, st, { det: 'a' })} ${whose.text} controls ${dur(b.duration, st)}`;
  bind(st, a.as, { nouns: K.nounsOf(kind), plural: false });
  return { clauses: [plain(text)], consumed: 2 };
}

function untapThemAndTheyGain(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'untap' || b?.op !== 'effect' || a.guard !== undefined || b.guard !== undefined || b.as !== undefined || a.what.ref !== 'bound' || b.effects.length !== 1) return null;
  const info = st.info.get(`b:${a.what.name}`);
  const noun = info?.nouns[0];
  if (info === undefined || info.plural !== true || noun === undefined || noun === 'object' || noun === 'card') return null;
  const e = b.effects[0]!;
  if (e.s !== 'continuous' || !same(e.affects, a.what)) return null;
  const grant = K.clause(b, st);
  if (grant.empty === true || !grant.imp.startsWith('they ')) return null;
  return { clauses: [plain(`untap those ${pluralize(noun)} and ${grant.imp}`, { standalone: true })], consumed: 2 };
}

export function foldEdhP13(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return gainControlOfThatPlayersObject(list, i, st) ?? untapThemAndTheyGain(list, i, st);
}
