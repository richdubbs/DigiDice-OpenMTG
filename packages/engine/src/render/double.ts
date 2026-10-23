/**
 * FAST4 T22: doubling a creature's power and/or toughness (CR 701.10a-c). The model has no doubling node: "double target creature's power until end of
 * turn" is the resolved effect "+X/+0 until end of turn, where X is its power" (CR 701.10b; a negative power gives -X, CR 701.10c, which is the same sum),
 * and "double the power and toughness of each creature you control until end of turn" is one resolved effect whose values read the object it modifies
 * (`{ref:'subject'}`): the effect handler stores one effect per creature with that creature's own values, all read as the effect begins, before any
 * applies (effects/handlers/lasting.ts#effectsToStore; CR 608.2f, 608.2h, 611.2c). This module recognizes exactly those shapes, so the renderer can say
 * "double".
 */
import type { Duration, ObjRef, Quantity, StaticEffect } from '../types/ability';
import { K } from './kernel';
import { cloneState, type RenderState } from './state';
import { alt, NoRenderer } from './text';

export type Doubled = 'pt' | 'power' | 'toughness' | 'triplePt';

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Is `q` the stated characteristic of the modified object itself: of the object the effect names (one object), or of `subject` (each object it modifies)? */
function ownStat(q: Quantity | undefined, stat: 'power' | 'toughness', affects: unknown): boolean {
  if (typeof q !== 'object' || q.q !== 'stat' || q.stat !== stat || q.sum === true || Object.keys(q).length !== 3) return false;
  const of = q.of as { ref: string };
  if (of.ref === 'subject') return Object.keys(of).length === 1;
  // a set ("each creature") read as a whole is one number for every object: only `subject` names each one's own value
  const a = affects as { ref: string };
  return a.ref !== 'each' && a.ref !== 'union' && sameJson(of, affects);
}

const unchanged = (q: Quantity | undefined): boolean => q === undefined || q === 0;

/** r3-choose (CR 701.11): twice the stated characteristic of the modified object itself (tripling gives +2X: X plus twice X is three times X). */
function twiceOwnStat(q: Quantity | undefined, stat: 'power' | 'toughness', affects: unknown): boolean {
  if (typeof q !== 'object' || q.q !== 'math' || q.op !== '*' || q.args.length !== 2 || q.args[0] !== 2) return false;
  return ownStat(q.args[1], stat, affects);
}

/**
 * What a continuous effect doubles: its single layer-7c change gives each object it modifies +X/+Y where X is that object's own power and Y its own
 * toughness (or +0 for a half that is not doubled). Null for anything else (another layer, a further modification, a value of something else).
 */
export function doubledBy(e: StaticEffect): Doubled | null {
  if (e.s !== 'continuous' || e.cda === true || e.mods.length !== 1) return null;
  const m = e.mods[0]!;
  if (m.layer !== '7c' || Object.keys(m).some((k) => k !== 'layer' && k !== 'power' && k !== 'toughness')) return null;
  const p = ownStat(m.power, 'power', e.affects);
  const t = ownStat(m.toughness, 'toughness', e.affects);
  if (p && t) return 'pt';
  // r3-choose (CR 701.11a-b): "triple target creature's power and toughness until end of turn" (Tifa's Limit Break) is +2X/+2Y, X and Y its power and toughness
  if (twiceOwnStat(m.power, 'power', e.affects) && twiceOwnStat(m.toughness, 'toughness', e.affects)) return 'triplePt';
  if (p && unchanged(m.toughness)) return 'power';
  if (t && unchanged(m.power)) return 'toughness';
  return null;
}

/** "double the power and toughness of X until end of turn", "double X's power until end of turn". */
export function doubledText(kind: Doubled, obj: ObjRef, duration: Duration | undefined, st: RenderState): string {
  const d = duration === undefined ? '' : K.dur(duration, st);
  const tail = d === '' ? '' : ` ${d}`;
  // r3-choose (CR 701.11a): one object's power and toughness tripled, as Oracle prints it ("Triple target creature's power and toughness until end of turn")
  if (kind === 'triplePt') {
    if (obj.ref === 'each' || obj.ref === 'union') throw new NoRenderer('the power and toughness of a group tripled');
    return `triple ${K.obj(obj, st, 'possessive').text} power and toughness${tail}`;
  }
  if (kind === 'pt' && (obj.ref === 'each' || obj.ref === 'union')) return `double the power and toughness of ${K.obj(obj, st, 'object').text}${tail}`;
  // CLOUD std-msh (CR 701.10a): one object's power and toughness is also "double target creature's power and toughness" (Epic Fight)
  if (kind === 'pt') return alt(`double the power and toughness of ${K.obj(obj, cloneState(st), 'object').text}${tail}`, `double ${K.obj(obj, st, 'possessive').text} power and toughness${tail}`);
  if (obj.ref === 'each' || obj.ref === 'union') return `double the ${kind} of ${K.obj(obj, st, 'object').text}${tail}`;
  // FAST5 T41: one object's power or toughness is also "double the power of target creature you control" (family double-pt)
  const other = K.obj(obj, cloneState(st), 'object').text; // the second reading names the object on its own copy of the state, so both are its first mention
  const possessive = `double ${K.obj(obj, st, 'possessive').text} ${kind}${tail}`;
  return alt(possessive, `double the ${kind} of ${other}${tail}`);
}
