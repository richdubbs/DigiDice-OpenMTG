/**
 * `enters.copy` (CR 707.5, 614.1c, 616.1c; m6 design 3.3). Owner: M6-2.
 *
 * "You may have this creature enter as a copy of <filter>, except ...": a replacement effect of class 2 (CR 616.1c, effects/replacements.ts#klassOf). As the
 * object would enter, the player it would enter under chooses an object matching `copy.of` (none is fine when `copy.optional`, "you may"): a choice made
 * BEFORE it enters (CR 614.12a), not a target (Clone can copy a creature with hexproof or shroud). The facts carry the choice (`copyOf`, `copyExcept`,
 * `copyAdditional`); core/move-parts/copy.ts begins the copy effect as the new object exists and before it enters (so it never exists on the battlefield as the
 * original and enters with the copied loyalty or defense, CR 707.5). A later copy effect in the same entering replaces the facts entirely, so the earlier
 * effect's additional effects are not applied (CR 707.9e: Altered Ego that enters as a copy of a Clone gets no counters).
 *
 * `hypothetical` puts the copy onto the object `asItWouldEnter` builds (a copy of the state, CR 614.12): the replacement effects that apply as it enters are the
 * copied object's (CR 614.12, 616.1c). Its record has the placeholder id `HYPOTHETICAL_COPY`, so a choice an "as enters" ability of the copy makes there is
 * stored under the placeholder's link namespace, which core/move-parts/copy.ts renames to the real copy effect's (E20).
 *
 * A token that is being created (`from: null`) enters through core/zones.ts#createToken, which has no move parts: its copy effect begins here, as the choice is
 * made (the token object exists, in no zone yet, CR 614.12a), with the token's timestamp.
 */
import type { CopyExcept } from '../../types/ability';
import type { CopiableValues, ContinuousEffectRec, GameObject } from '../../types/state';
import { additionalCountersOf, charsFromCopiable, concreteSnapshot, copiableOrWhy, copyRecord, HYPOTHETICAL_COPY } from '../../statics/copy';
import type { DestinationFacts } from '../api';
import { resolveObjs } from '../refs';
import { contextFor } from '../replace-ctx';
import type { EntersPart } from '../registries';
import { beginCopy } from '../copy';
import { evalQty } from '../eval';
import { deferAfter, runNested } from '../nested';
import { replacementCtx } from '../instead';

const COPY_PART: EntersPart = {
  field: 'copy',
  capability: 'body:enters.copy',
  extraCapabilities: ['body:enters.copy.then'],
  apply(g, e, body, c) {
    const spec = body.copy;
    const o = g.s.objects[e.object.id];
    if (!spec || !o) return {};
    const chooser = e.destination.controller ?? o.controller; // CR 616.1, 614.12: the player it would enter under
    const name = g.nameOf(o.id);
    // The filter is read from the effect's source ("enter as a copy of this enchantment", Essence of the Wild); for Clone that is the entering object itself.
    const source = g.s.objects[c.source.id] ?? o;
    const cx = contextFor(g, source, source.id === o.id ? chooser : c.controller);
    // FAST5 T64 (CR 707.2, 614.12): the copied object is on the battlefield unless the filter names another zone, "a land card in a graveyard" (Echoing Deeps, Superior Spider-Man): a card's copiable values
    const zones = ([] as string[]).concat(spec.of.zone ?? 'battlefield');
    const matching = resolveObjs(cx, { ref: 'each', filter: spec.of }).map((h) => h.id).filter((id) => id !== o.id && (zones.includes('any') || zones.includes(g.s.objects[id]?.zone ?? '')));
    // Not offered: what this build can't copy exactly, and an Aura (as it entered, the copy would have to be attached to what its controller chooses, CR 303.4f,
    // which nothing does for a copy yet)
    const options = matching.filter((id) => {
      const cv = copiableOrWhy(g.s, g.s.objects[id]!);
      return !('reason' in cv) && !charsFromCopiable(g.s, cv, o.id, chooser).subtypes.includes('Aura');
    });
    if (options.length < matching.length) {
      g.log(`${name}: ${matching.length - options.length} object(s) can't be copied by the engine yet and are not offered; copy one by hand if you want it.`, { rules: ['CR 707.5'], level: 'manual' });
    }
    if (options.length === 0) {
      g.log(`${name} enters without copying anything: there is nothing it can copy.`, { rules: ['CR 707.5', 'CR 614.12'], level: 'info' });
      return {};
    }
    const ids = !spec.optional && options.length === 1 ? options : g.choose({
      kind: 'chooseObjects', player: chooser, options, min: spec.optional ? 0 : 1, max: 1,
      prompt: `${spec.optional ? 'You may choose' : 'Choose'} what ${name} enters as a copy of (${c.sourceName}).`, rules: ['CR 707.5', 'CR 614.12a'],
    }).ids;
    const of = ids[0] !== undefined ? g.s.objects[ids[0]] : undefined;
    if (!of) {
      g.log(`${name} enters as itself (no copy chosen).`, { rules: ['CR 707.5'], level: 'info' });
      return {};
    }
    // CR 707.9e, 107.3: the numbers of the additional effects are worked out now, for the entering object (Altered Ego's X is its spell's X)
    const self = contextFor(g, o, chooser);
    const additional = spec.additional?.map((a) => ({ ...a, counters: a.counters.map((k) => ({ ...k, count: evalQty(self, k.count) ?? k.count })) }));
    const facts: Partial<DestinationFacts> = { copyOf: { id: of.id, zone: of.zone }, copyExcept: spec.except, copyAdditional: additional, ...(spec.tapped === true ? { tapped: true } : {}) };
    // r4-copy (CR 603.12, 614.12): "When you do, exile that card.": once the object entered, the steps run in the replacement's context with the copied object bound
    if (spec.then !== undefined) {
      const then = spec.then;
      const cx = replacementCtx(g, e, c);
      const copied = { id: of.id, zone: of.zone };
      deferAfter(() => {
        cx.bindings.set(then.as, { objects: [copied], players: [], snapshots: {} });
        cx.results.set(then.as, { performed: true, count: 1 });
        runNested(cx, then.do);
      });
    }
    if (e.from === null) {
      const rec = beginTokenCopy(g, o, of, spec.except ?? [], c.sourceName);
      // CR 707.9e: the additional effects apply as the token enters (performCreateToken applies the facts' counters)
      const extra = rec ? additionalCounters(g, o, rec.copy!, additional ?? []) : [];
      if (extra.length > 0) facts.counters = [...(e.destination.counters ?? []), ...extra];
    }
    return facts;
  },
  hypothetical(alt, o, facts) {
    if (!facts.copyOf) return;
    const of = alt.objects[facts.copyOf.id] ?? alt.lki[facts.copyOf.id]?.object;
    if (!of) return;
    const cv = copiableOrWhy(alt, of);
    if ('reason' in cv) return;
    const snapshot = concreteSnapshot(alt, o, cv, facts.copyExcept ?? []);
    if ('reason' in snapshot) return;
    alt.continuousEffects = [...alt.continuousEffects, copyRecord({
      id: HYPOTHETICAL_COPY, target: { id: o.id, zone: o.zone }, snapshot, of: { id: of.id, zone: of.zone }, source: { id: o.id, zone: o.zone }, sourceName: '',
      controller: o.controller, timestamp: o.timestamp, turn: alt.turn.number,
    })];
  },
};

type G = Parameters<EntersPart['apply']>[0];

/** A token being created enters as a copy: the effect begins now, with the token's timestamp (see the file comment). */
function beginTokenCopy(g: G, o: GameObject, of: GameObject, except: readonly CopyExcept[], sourceName: string): ContinuousEffectRec | null {
  const name = g.nameOf(o.id);
  const ofName = g.nameOf(of.id);
  const r = beginCopy(g, o, of, except, { source: { id: o.id, zone: 'battlefield' }, sourceName, controller: o.controller, timestamp: o.timestamp });
  if ('reason' in r) {
    g.log(`${name} can't enter as a copy of ${ofName} automatically (${r.reason}); apply the copy by hand.`, { rules: ['CR 707.5'], level: 'manual' });
    return null;
  }
  g.log(`${name} enters as a copy of ${ofName}.`, { rules: ['CR 707.5', 'CR 614.1c'], level: 'action' });
  return r;
}

/** CR 707.9e: the additional counters (statics/copy.ts#additionalCountersOf); a count that is not a number is left to the players (logged). */
function additionalCounters(g: G, o: GameObject, snapshot: CopiableValues, additional: NonNullable<DestinationFacts['copyAdditional']>): { kind: string; count: number }[] {
  const r = additionalCountersOf(g.s, o, snapshot, additional);
  for (const k of r.byHand) g.log(`${g.nameOf(o.id)} enters with additional ${k} counters the engine can't count; add them by hand.`, { rules: ['CR 707.9e', 'CR 614.1c'], level: 'manual' });
  return r.counters;
}

export const COPY_ENTERS_PARTS: readonly EntersPart[] = [COPY_PART];
