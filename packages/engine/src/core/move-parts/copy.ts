/**
 * The copy move parts (m6 design 3.3, 2.6). Owner: M6-2. Called by core/zones.ts#moveObject after the new object exists in its new zone and BEFORE
 * enterWithPrintedCounters and the zoneChanged event.
 *
 *  - "Enters as a copy" (CR 707.5, 614.1c): the facts of the entering (`opts.enter.copyOf`, `copyExcept`, `copyAdditional`, chosen by
 *    effects/enters-parts/copy.ts) begin the copy effect on the new object now, with the object's timestamp: it never exists on the battlefield as the
 *    original, and it enters with the copied printed loyalty or defense (Spark Double copying a planeswalker, CR 707.5, 306.5b). The additional effects of
 *    CR 707.9e ("it enters with an additional +1/+1 counter on it if it's a creature") are judged with the copy's values and added to the counters it enters
 *    with (core/zones.ts's caller applies them: effects/perform-events.ts#applyEnterFacts). Choices an "as enters" ability of the copy made on the
 *    hypothetical object (CR 614.12, 707.6: a Clone of Voice of All chooses its own color) are renamed from the placeholder's link namespace to this copy
 *    effect's (E20).
 *  - A copy of a permanent spell becomes a token as it resolves (CR 707.10f, 608.3f): the spell copy object that enters the battlefield is a token. (The resolve
 *    part, core/resolve-parts/copy-token.ts, lets the copy resolve like a permanent spell; this is where it becomes the token.)
 *
 * Only statics are imported for values: core/zones.ts imports this module through core/registries.ts, so an import of effects/ or core/zones.ts would be a cycle.
 */
import type { MovePart } from '../registries';
import { additionalCountersOf, concreteSnapshot, copiableOrWhy, copyRecord, HYPOTHETICAL_COPY } from '../../statics/copy';

const COPY_ENTERS: MovePart = {
  beforeEnter(g, o, opts) {
    if (o.zone !== 'battlefield') return;
    if (o.kind === 'spellCopy') {
      o.kind = 'token'; // CR 707.10f, 608.3f: the copy of a permanent spell becomes a token
      g.log(`The copy of ${g.nameOf(o.id)} becomes a token as it resolves.`, { rules: ['CR 707.10f', 'CR 608.3f'], level: 'info' });
    }
    const f = opts.enter;
    if (!f?.copyOf) return;
    const name = g.nameOf(o.id);
    const of = g.s.objects[f.copyOf.id] ?? g.s.lki[f.copyOf.id]?.object;
    const fail = (reason: string): void => {
      g.log(`${name} can't enter as a copy automatically (${reason}); apply the copy by hand.`, { rules: ['CR 707.5'], level: 'manual' });
    };
    if (!of) return fail('the object it would copy is gone');
    const ofName = g.nameOf(of.id);
    const cv = copiableOrWhy(g.s, of);
    if ('reason' in cv) return fail(cv.reason);
    const snapshot = concreteSnapshot(g.s, o, cv, f.copyExcept ?? []);
    if ('reason' in snapshot) return fail(snapshot.reason);
    const rec = copyRecord({
      id: g.newEffectId(), target: { id: o.id, zone: o.zone }, snapshot, of: { id: of.id, zone: of.zone }, source: { id: o.id, zone: o.zone }, sourceName: name,
      controller: o.controller, timestamp: o.timestamp, turn: g.s.turn.number, // CR 613.7: it is a copy from the moment it enters
    });
    g.s.continuousEffects.push(rec);
    // E20: the choices made on the hypothetical copy (CR 614.12) belong to this copy effect's link namespace
    const prefix = `${HYPOTHETICAL_COPY}#`;
    if (f.chosen?.some((ch) => ch.link.startsWith(prefix))) f.chosen = f.chosen.map((ch) => (ch.link.startsWith(prefix) ? { ...ch, link: `${rec.id}#${ch.link.slice(prefix.length)}` } : ch));
    // CR 707.9e: additional effects, judged on the copy it now is
    const extra = additionalCountersOf(g.s, o, snapshot, f.copyAdditional ?? []);
    if (extra.counters.length > 0) f.counters = [...(f.counters ?? []), ...extra.counters];
    for (const k of extra.byHand) g.log(`${ofName}: ${name} enters with additional ${k} counters the engine can't count; add them by hand.`, { rules: ['CR 707.9e'], level: 'manual' });
    g.log(`${name} enters as a copy of ${ofName}.`, { rules: ['CR 707.5', 'CR 614.1c'], level: 'action' });
  },
};

export const COPY_MOVE_PARTS: readonly MovePart[] = [COPY_ENTERS];
