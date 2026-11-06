/**
 * edh-next-120 (CR 612.5, 701.12h, 613.1c, 614.12; Deadpool, Trading Card): an exchange of the text boxes of two permanents. Each permanent's rules text becomes the previous rules text
 * of the other: two layer 3 effects (`{layer:3, rulesTextOf}`), one on each permanent, each carrying the snapshot of the other's copiable values as the exchange begins
 * (`ContinuousEffectRec.textOf`; statics/text-exchange.ts applies it). Both effects begin at once, with one timestamp (CR 613.7b), and last for good: each ends only when its
 * permanent stops being that object (CR 400.7). Fail closed: when either permanent's copiable values can't be read exactly (statics/copy.ts#copiableOrWhy: a face-down permanent
 * with set characteristics, a split card, a bestowed Aura ...), nothing is exchanged and the players settle it by hand.
 */
import type { Game } from '../core/game';
import type { PlayerId } from '../types/ids';
import type { ContinuousEffectRec, GameObject, ObjHandle } from '../types/state';
import { copiableOrWhy } from '../statics/copy';
import { performEffectRecord } from './perform-direct';

export interface TextExchangeOptions {
  source: ObjHandle | null;
  sourceName: string;
  controller: PlayerId;
}

/** Exchange the text boxes of `a` and `b` (both on the battlefield). Returns the two records, or why it can't be done exactly (nothing is stored then). */
export function beginTextExchange(g: Game, a: GameObject, b: GameObject, opts: TextExchangeOptions): ContinuousEffectRec[] | { reason: string } {
  if (a.id === b.id) return { reason: 'a text box exchanged with itself changes nothing' };
  const ca = copiableOrWhy(g.s, a);
  if ('reason' in ca) return ca;
  const cb = copiableOrWhy(g.s, b);
  if ('reason' in cb) return cb;
  const timestamp = g.newTimestamp();
  const rec = (target: GameObject, other: GameObject, textOf: typeof ca): ContinuousEffectRec => ({
    id: g.newEffectId(),
    source: opts.source,
    sourceName: opts.sourceName,
    controller: opts.controller,
    timestamp,
    startedTurn: g.s.turn.number,
    duration: { d: 'permanent' },
    effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id: target.id, zone: target.zone }] }, mods: [{ layer: 3, rulesTextOf: { ref: 'fixed', objects: [{ id: other.id, zone: other.zone }] } }] },
    textOf: { ...textOf, except: [...textOf.except] },
  });
  const recs = [rec(a, b, cb), rec(b, a, ca)];
  for (const r of recs) performEffectRecord(g, r);
  g.log(`${opts.sourceName}: ${g.nameOf(a.id)} and ${g.nameOf(b.id)} exchange their text boxes.`, { rules: ['CR 612.5', 'CR 701.12h'], level: 'action' });
  return recs;
}
