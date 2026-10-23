/**
 * Copy effects as the interpreter begins them (CR 707.4, 707.5; m6 design 3.3). Owner: M6-2.
 *
 *   beginCopy           CR 707.2b, 707.9: take the copiable values of `of` NOW (layer 1 only, statics/copy.ts#copiableOrWhy), make the effect's exceptions
 *                       concrete (statics/copy.ts#concreteSnapshot) and store the record with a new timestamp through
 *                       effects/perform-direct.ts#performEffectRecord. Later changes to the original never change the copy (CR 707.2b).
 *   COPY_SNAPSHOT_HOOK  CR 707.4: an `effect` step whose record has a 1a `copyOf` ("<ref> becomes a copy of <ref> [until end of turn], except ...") is stored by
 *                       effects/handlers/lasting.ts, which calls this hook to write `rec.copy` (the line M6-0 inserted). It emits `becameCopy` (no enters or
 *                       leaves triggers); noncopy effects keep applying (Giant Growth, CR 707.4 example), because they are other records.
 *
 * What can't be copied exactly (a split card outside the stack, a permanent made of several cards; a retained name or mana cost) is never copied wrong: the
 * record stays without a snapshot (layer 1a applies nothing for it) and the log asks the players to apply it by hand.
 */
import type { Game } from '../core/game';
import type { CopyExcept } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { ContinuousEffectRec, GameObject } from '../types/state';
import { matchesFilter } from '../rules/filter';
import { filterCtxOutside } from '../rules/filter-env';
import { concreteSnapshot, copiableOrWhy, copyRecord } from '../statics/copy';
import { performEffectRecord } from './perform-direct';

/** Writes `rec.copy` for a record with a 1a `copyOf` modification (m6 design 2.6). */
export type CopySnapshotHook = (g: Game, rec: ContinuousEffectRec) => void;

/** The object a fixed reference names, as it is or as it last existed (CR 608.2h). */
function objectAt(g: Game, h: { id: ObjectId } | undefined): GameObject | undefined {
  if (!h) return undefined;
  return g.s.objects[h.id] ?? g.s.lki[h.id]?.object;
}

/** CR 707.4: the snapshot of a "becomes a copy" record, written once, as the effect begins. */
export const COPY_SNAPSHOT_HOOK: CopySnapshotHook | null = (g, rec) => {
  if (rec.effect.s !== 'continuous') return;
  const mod = rec.effect.mods.find((m) => m.layer === '1a');
  if (!mod || mod.layer !== '1a') return;
  const affects = rec.effect.affects;
  const targets = affects.ref === 'fixed' && 'objects' in affects ? affects.objects : [];
  const ofRef = mod.copyOf;
  const fixed = ofRef.ref === 'fixed' && 'objects' in ofRef ? ofRef.objects : [];
  const why = (reason: string): void => {
    g.log(`${rec.sourceName}: the copy effect can't be applied by the engine (${reason}); apply it by hand.`, { rules: ['CR 707.4', 'CR 707.9'], level: 'manual' });
  };
  let of: GameObject | undefined;
  if (mod.choose !== undefined) {
    // FAST5 T64 (CR 608.2d, 607.2a): "a creature card exiled with it": the effect's controller picks one of the objects that match, as the effect begins
    const cx = filterCtxOutside(g.s, { controller: rec.controller, ...(rec.source ? { sourceId: rec.source.id } : {}) });
    // r4-copy (CR 608.2d, 611.2c): "you may have it become a copy of another creature you control": `copyOf` describes the group (`each` stays live until now),
    // so the choice is among the permanents it describes as the effect begins
    // std-rx31 (CR 707.2, 607.2a, 406.3): "a creature card exiled with this Equipment": a card in exile (or in a graveyard) has copiable values too, its printed ones
    // (statics/copy.ts#copiableOrWhy); the choice is among the cards of that one public zone the filter names. Any other zone is still applied by hand
    const zone = ofRef.ref === 'each' && 'filter' in ofRef ? ofRef.filter.zone : undefined;
    if (zone !== undefined && zone !== 'battlefield' && zone !== 'exile' && zone !== 'graveyard') return why('a chosen copy of an object outside the battlefield');
    const ids = zone === 'exile' ? g.s.zones.exile : zone === 'graveyard' ? Object.values(g.s.zones.graveyard).flat() : g.s.zones.battlefield;
    const pool = ofRef.ref === 'each' && 'filter' in ofRef
      ? ids.map((id) => g.s.objects[id]).filter((o): o is GameObject => o !== undefined && matchesFilter(g.s, o, ofRef.filter, cx))
      : fixed.map((h) => objectAt(g, h));
    const candidates = pool.filter((o): o is GameObject => o !== undefined && matchesFilter(g.s, o, { ...mod.choose!, zone: 'any' }, cx));
    if (candidates.length === 0) {
      g.log(`${rec.sourceName}: there is nothing to become a copy of.`, { rules: ['CR 707.4', 'CR 608.2d'], level: 'info' });
      return;
    }
    const picked = candidates.length === 1 ? [candidates[0]!.id] : g.choose({
      kind: 'chooseObjects', player: rec.controller, options: candidates.map((o) => o.id), min: 1, max: 1,
      prompt: `Choose what ${rec.sourceName} becomes a copy of.`, rules: ['CR 707.4', 'CR 608.2d'],
    }).ids;
    of = candidates.find((o) => o.id === picked[0]);
  } else of = objectAt(g, fixed[0]);
  if (!of) return why('the object to copy is gone');
  const target = objectAt(g, targets[0]);
  if (!target) return;
  if (targets.length > 1 && (mod.except ?? []).some((x) => 'retain' in x || 'if' in x)) return why('several objects becoming copies with exceptions judged per object');
  const cv = copiableOrWhy(g.s, of);
  if ('reason' in cv) return why(cv.reason);
  const snap = concreteSnapshot(g.s, target, cv, mod.except ?? []);
  if ('reason' in snap) return why(snap.reason);
  rec.copy = snap;
  for (const h of targets) {
    g.emit({ type: 'becameCopy', objectId: h.id, of: of.id });
    g.log(`${g.nameOf(h.id)} becomes a copy of ${g.nameOf(of.id)}.`, { rules: ['CR 707.4', 'CR 707.2'], level: 'action' });
  }
};

/** What `beginCopy` needs to know about the effect. */
export interface BeginCopyOptions {
  source: ContinuousEffectRec['source'];
  sourceName: string;
  controller: PlayerId;
  /** CR 613.7: the effect's timestamp (default: a new one, CR 613.7b). */
  timestamp?: number;
  duration?: ContinuousEffectRec['duration'];
}

/**
 * Begin a copy effect that makes `target` a copy of `of` (CR 707.2, 707.5, 707.9). Returns the stored record, or why it can't be applied exactly (nothing is
 * stored then: the caller resolves it by hand).
 */
export function beginCopy(g: Game, target: GameObject, of: GameObject, except: readonly CopyExcept[], opts: BeginCopyOptions): ContinuousEffectRec | { reason: string } {
  const cv = copiableOrWhy(g.s, of);
  if ('reason' in cv) return cv;
  const snapshot = concreteSnapshot(g.s, target, cv, except);
  if ('reason' in snapshot) return snapshot;
  const rec = copyRecord({
    id: g.newEffectId(), target: { id: target.id, zone: target.zone }, snapshot, of: { id: of.id, zone: of.zone }, source: opts.source, sourceName: opts.sourceName,
    controller: opts.controller, timestamp: opts.timestamp ?? g.newTimestamp(), turn: g.s.turn.number, ...(opts.duration ? { duration: opts.duration } : {}),
  });
  performEffectRecord(g, rec);
  return rec;
}
