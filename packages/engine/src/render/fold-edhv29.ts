/**
 * edh-c-29 (Commander lane edh-c, EDHREC ranks 22,501-23,000): the folds of its templates (parser/templates/zz-cloud/edh-c-29.json), called from render/fold.ts#foldAt.
 *
 * `playerPutsCountersOnOne` (CR 122.1, 122.6, 608.2d; Hunted Nightmare; template eff.edhv29.player.putsCounters.onOneTheyControl): a player other than the controller
 * (a target, or any player reference) chooses one permanent of a description they control and puts counters on it themselves (`chooseObjects` by that player, then a
 * `putCounters` by that player on the object chosen): "target opponent puts a deathtouch counter on a creature they control". Only that exact shape.
 */
import type { EffectStep } from '../types/ability';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { byPlayer, bind } from './steps-util';
import { countersText } from './steps-life';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function playerPutsCountersOnOne(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'putCounters' || a.random === true || a.guard !== undefined || b.guard !== undefined || b.as !== undefined || a.groupLimit !== undefined || a.link !== undefined) return null;
  if (a.who.ref === 'iterating' || a.who.ref === 'you' || a.min !== 1 || a.max !== 1 || a.perPlayer !== undefined || a.startingWith !== undefined || a.eachCardType !== undefined || a.distinct !== undefined || a.damageSource !== undefined || a.as === undefined) return null;
  if (b.on.ref !== 'bound' || b.on.name !== a.as || b.upTo !== undefined || b.distribute !== undefined || b.kindOfChoice !== undefined || !same(b.by, a.who)) return null;
  const from = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (from === null || Object.keys(from).sort().join(',') !== 'anyOf,controller' || !same(from.controller, a.who) || from.anyOf?.length !== 1) return null;
  const kind = from.anyOf[0]!;
  const clause = byPlayer(a.who, st, 'put', () => `${countersText(b.count, b.kind, st)} on ${K.np(kind, st, { det: 'a' })} they control`);
  bind(st, a.as, { nouns: K.nounsOf(kind), plural: false });
  return { clauses: [clause], consumed: 2 };
}

export function foldEdhV29(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return playerPutsCountersOnOne(list, i, st);
}
