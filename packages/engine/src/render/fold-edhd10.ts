/**
 * edh-d-10 (Commander coordinator D, EDHREC ranks 10,001-11,250, third pass): the renderer parts of its templates (parser/templates/zz-cloud/edh-d-10.json). CR cites are from the
 * Comprehensive Rules text of 2026-09-25 (fetched in the session). Imports no value from render/fold.ts (an import cycle).
 *
 * `mustAttackCantAttackYou` (CR 508.1b, 508.1d, 604.1; Fealty to the Realm; sta.edhd10.attached.mustAttack.cantAttackYou): "<object> attacks each combat if able and can't attack you": a `mustIfAble`
 * attack of one object followed by a `cant` attackPlayer of the same object whose player is the controller. Called from render/stat.ts#staticEffectsApart; only these two exact shapes (one object, not a
 * group), the number of effects used and their sentence, otherwise null. No Oracle card prints the two as separate sentences, so (as for edh-top-5's Xantcha) the combined wording is the only one.
 */
import { isPlayerOnlyRefKind, type ObjRef, type StaticEffect } from '../types/ability';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const onlyKeys = (e: object, keys: string[]): boolean => Object.keys(e).every((k) => keys.includes(k));

export function mustAttackCantAttackYou(effects: readonly StaticEffect[], i: number, st: RenderState): { text: string; n: number } | null {
  const [a, b] = [effects[i], effects[i + 1]];
  if (a?.s !== 'restrict' || b?.s !== 'restrict' || a.mode !== 'mustIfAble' || a.action !== 'attack' || !onlyKeys(a, ['s', 'subject', 'mode', 'action'])) return null;
  const subject = a.subject;
  if (subject.ref === 'each' || isPlayerOnlyRefKind(subject.ref)) return null;
  if (b.mode !== 'cant' || b.action !== 'attackPlayer' || !same(b.subject, subject) || !same(b.otherPlayer, { ref: 'you' }) || !onlyKeys(b, ['s', 'subject', 'mode', 'action', 'otherPlayer'])) return null;
  return { text: `${K.obj(subject as ObjRef, st, 'subject').text} attacks each combat if able and can't attack you`, n: 2 };
}
