/**
 * edh-top-5 (Commander lane edh-top): the folds of its templates (parser/templates/zz-cloud/edh-top-5.json), called last from render/fold.ts#foldAt. CR cites are from the
 * Comprehensive Rules text of 2026-09-25 read in the session.
 *
 * `putThenGoadPut` (CR 122.1, 701.15a, 608.2c; Spectacular Showdown; eff.edht5.counters.put.thenGoadPut): the counters are put, then the creatures that actually received them (the bound
 * objects of the putting step) are goaded: "Put a double strike counter on target creature, then goad each creature that had a double strike counter put on it this way."
 *
 * `eachPlayerMayPutThenGoadPut` (CR 101.4, 122.1, 608.2d, 701.15a; Agitator Ant; eff.edht5.eachPlayerMayPutCounters.thenGoadPut): every player may put counters on a permanent they control (a
 * group `may` that gathers the creatures that received them), then the creatures that had counters put on them this way are goaded.
 */
import { isPlayerOnlyRefKind, type EffectStep, type ObjRef, type StaticEffect } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { countersText } from './steps-life';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** The creatures among the objects a putting step (named `as`) put counters on (CR 701.15a: only a creature is goaded). */
const creaturesOf = (as: string): unknown => ({ ref: 'each', filter: { types: ['Creature'], is: { ref: 'bound', name: as } } });

function putThenGoadPut(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'putCounters' || a.as === undefined || a.guard !== undefined || a.distribute !== undefined || a.upTo !== undefined) return null;
  if (b?.op !== 'action' || b.action !== 'goad' || b.guard !== undefined || b.as !== undefined || !same(b.who, { ref: 'you' }) || !same(b.subject, creaturesOf(a.as)) || b.arg !== undefined) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"${a.as}"`))) return null;
  const first = K.clause(a, st);
  const second = `goad each creature that had a ${a.kind} counter put on it this way`; // "a counter", whatever the number put (the creature had counters put on it)
  return { clauses: [{ ...first, imp: `${first.imp}, then ${second}`, sub: `${first.sub}, then ${second}`, standalone: true }], consumed: 2 };
}

function eachPlayerMayPutThenGoadPut(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  const g = list[i + 1];
  if (m?.op !== 'may' || m.gather === undefined || m.guard !== undefined || m.as !== undefined || m.otherwise !== undefined || m.anyOne !== undefined || m.villainous !== undefined || m.do.length !== 2) return null;
  if (!same(m.who, { ref: 'each', who: 'player' })) return null;
  const [a, b] = m.do as [EffectStep, EffectStep];
  if (a.op !== 'chooseObjects' || b.op !== 'putCounters' || a.random === true || a.guard !== undefined || b.guard !== undefined || a.groupLimit !== undefined || a.link !== undefined) return null;
  if (!same(a.who, { ref: 'iterating' }) || a.min !== 1 || a.max !== 1 || a.perPlayer !== undefined || a.startingWith !== undefined || a.eachCardType !== undefined || a.distinct !== undefined || a.damageSource !== undefined || a.as === undefined) return null;
  if (b.on.ref !== 'bound' || b.on.name !== a.as || b.as !== m.gather || b.upTo !== undefined || b.distribute !== undefined) return null;
  if (g?.op !== 'action' || g.action !== 'goad' || g.guard !== undefined || g.as !== undefined || !same(g.who, { ref: 'you' }) || !same(g.subject, creaturesOf(m.gather)) || g.arg !== undefined) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"${m.gather}"`))) return null;
  const from = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (from === null || Object.keys(from).sort().join(',') !== 'anyOf,controller' || !same(from.controller, { ref: 'iterating' }) || from.anyOf?.length !== 1) return null;
  const kind = from.anyOf[0]!;
  return { clauses: [plain(`each player may put ${countersText(b.count, b.kind, st)} on ${K.np(kind, st, { det: 'a' })} they control. goad each creature that had counters put on it this way`)], consumed: 2 };
}

const onlyKeys = (e: object, keys: string[]): boolean => Object.keys(e).every((k) => keys.includes(k));

/**
 * The static abilities of Xantcha (CR 508.1b-d, 108.3; sta.edht5.obj.mustAttack.cantAttackOwnerOrTheirPlaneswalkers): "<object> attacks each combat if able" (a `mustIfAble` attack of one object) followed by
 * "can't attack its owner or planeswalkers its owner controls" (a `cant` attackPlayer whose player is the owner of the same object and a `cant` attack of the planeswalkers that owner controls). Called from
 * render/stat.ts#staticEffectsApart; only these two exact shapes (one object, not a group), the number of effects used and their sentence, otherwise null.
 */
export function mustAttackOwnerBans(effects: readonly StaticEffect[], i: number, st: RenderState): { text: string; n: number } | null {
  const [a, b, c] = [effects[i], effects[i + 1], effects[i + 2]];
  if (a?.s !== 'restrict' || b?.s !== 'restrict' || a.mode !== 'mustIfAble' || a.action !== 'attack' || !onlyKeys(a, ['s', 'subject', 'mode', 'action'])) return null;
  const subject = a.subject;
  if (subject.ref === 'each' || isPlayerOnlyRefKind(subject.ref)) return null; // one object: "its owner" is the owner of that object
  const owner = { ref: 'ownerOf', object: subject };
  const sameSubject = (r: StaticEffect | undefined): boolean => r?.s === 'restrict' && same(r.subject, subject);
  const banOwner = (r: StaticEffect | undefined): boolean => r?.s === 'restrict' && sameSubject(r) && r.mode === 'cant' && r.action === 'attackPlayer' && same(r.otherPlayer, owner) && onlyKeys(r, ['s', 'subject', 'mode', 'action', 'otherPlayer']);
  const who = (): string => K.obj(subject as ObjRef, st, 'subject').text;
  if (banOwner(b) && sameSubject(c) && c?.s === 'restrict' && c.mode === 'cant' && c.action === 'attack' && same(c.other, { types: ['Planeswalker'], controller: owner }) && onlyKeys(c, ['s', 'subject', 'mode', 'action', 'other'])) {
    return { text: `${who()} attacks each combat if able and can't attack its owner or planeswalkers its owner controls`, n: 3 };
  }
  return null;
}

/** The folds of edh-top-5 (render/fold.ts#foldAt). */
export function foldEdhT5(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return putThenGoadPut(list, i, st) ?? eachPlayerMayPutThenGoadPut(list, i, st);
}
