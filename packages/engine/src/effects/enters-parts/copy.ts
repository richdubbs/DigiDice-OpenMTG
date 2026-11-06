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
import type { CopyExcept, Duration } from '../../types/ability';
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
import { charsOfObject, ptNumbers } from '../../rules/characteristics';

const COPY_PART: EntersPart = {
  field: 'copy',
  capability: 'body:enters.copy',
  extraCapabilities: ['body:enters.copy.ifControlled', 'body:enters.copy.then', 'body:enters.copy.copiedCounters', 'body:enters.copy.duration', 'body:enters.copy.lastKnown', 'body:enters.copy.ifEmbalmed', 'body:enters.copy.noManaCost' /* edh-next-122 */, 'body:enters.copy.exilePair' /* edh-next-133 */],
  apply(g, e, body, c) {
    const spec0 = body.copy;
    const o = g.s.objects[e.object.id];
    if (!spec0 || !o) return {};
    // edh-next-122 (CR 702.128b, 707.9b; Vizier of Many Faces): "except if this creature was embalmed, ...": judged now, for the object entering (a token a resolving embalm ability creates)
    const spec = spec0.except?.some((x) => 'ifEmbalmed' in x) === true ? { ...spec0, except: spec0.except.flatMap((x) => ('ifEmbalmed' in x ? (e.destination.embalmed === true ? x.then : []) : [x])) } : spec0;
    const chooser = e.destination.controller ?? o.controller; // CR 616.1, 614.12: the player it would enter under
    const name = g.nameOf(o.id);
    // The filter is read from the effect's source ("enter as a copy of this enchantment", Essence of the Wild); for Clone that is the entering object itself.
    const source = g.s.objects[c.source.id] ?? o;
    const cx = contextFor(g, source, source.id === o.id ? chooser : c.controller);
    // FAST5 T64 (CR 707.2, 614.12): the copied object is on the battlefield unless the filter names another zone, "a land card in a graveyard" (Echoing Deeps, Superior Spider-Man): a card's copiable values
    const zones = ([] as string[]).concat(spec.of.zone ?? 'battlefield');
    const matching0 = resolveObjs(cx, { ref: 'each', filter: spec.of }).map((h) => h.id).filter((id) => id !== o.id && (zones.includes('any') || zones.includes(g.s.objects[id]?.zone ?? '')));
    // edh-next-122 (CR 608.2h, 707.2; Mystic Reflection ruling 2021-02-05): the one fixed object of `of.is`, copied as it last existed on the battlefield once it has left
    const fixedIs = spec.lastKnown === true && spec.of.is?.ref === 'fixed' && 'objects' in spec.of.is ? spec.of.is.objects : undefined;
    const lastKnown = fixedIs !== undefined && fixedIs.length === 1 && matching0.length === 0 && fixedIs[0]!.id !== o.id && g.s.objects[fixedIs[0]!.id]?.zone !== 'battlefield' ? g.s.lki[fixedIs[0]!.id]?.object : undefined;
    if (lastKnown !== undefined && lastKnown.zone === 'battlefield') return lastKnownCopy(g, e, spec, o, lastKnown, c.sourceName);
    const matching = spec.lastKnown === true && (fixedIs === undefined || fixedIs.length !== 1) ? [] : matching0;
    // Not offered: what this build can't copy exactly, and an Aura (as it entered, the copy would have to be attached to what its controller chooses, CR 303.4f,
    // which nothing does for a copy yet)
    const options = matching.filter((id) => {
      const cv = copiableOrWhy(g.s, g.s.objects[id]!);
      return !('reason' in cv) && !charsFromCopiable(g.s, cv, o.id, chooser).subtypes.includes('Aura');
    });
    // edh-next-133 (CR 614.12a, 707.5, 707.9e; The Mimeoplasm): two cards exiled as it enters, one of them copied, counters equal to the other's power
    if (spec.exilePair !== undefined) return exilePairCopy(g, e, spec, o, matching, new Set(options), chooser, cx, c.sourceName);
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
    // edh-next-114 (CR 707.9e, 614.1c; Undercover Operative): an additional effect that only applies when the player it enters under controls the chosen object, read as the choice is made
    const additional0 = spec.additional?.filter((a) => a.ifCopiedControlled !== true || of.controller === chooser).map((a) => ({ ...a, counters: a.counters.map((k) => ({ ...k, count: evalQty(self, k.count) ?? k.count })) }));
    // trek-4 (CR 614.1c, 707.9; unverified): "If you do, it enters with additional counters on it equal to the same number and kinds of counters the copied
    // permanent has on it": the counters on the chosen object now, as it enters, each kind with its number
    const copied = spec.copiedCounters === true ? Object.entries(of.counters).filter(([, n]) => n > 0).map(([kind, count]) => ({ kind, count })) : [];
    const additional = copied.length > 0 ? [...(additional0 ?? []), { counters: copied }] : additional0;
    const facts: Partial<DestinationFacts> = { copyOf: { id: of.id, zone: of.zone }, copyExcept: spec.except, copyAdditional: additional, ...(spec.tapped === true ? { tapped: true } : {}), ...(spec.duration !== undefined ? { copyDuration: spec.duration } : {}) };
    // r4-copy (CR 603.12, 614.12): "When you do, exile that card.": once the object entered, the steps run in the replacement's context with the copied object bound
    if (spec.then !== undefined) {
      const then = spec.then;
      const cx = replacementCtx(g, e, c);
      const copied = { id: of.id, zone: of.zone };
      deferAfter(() => {
        // edh-next-65 (CR 611.2b, 400.7; Wall of Stolen Identity): "for as long as you control ~" of the steps after the choice: the source is the permanent that entered (on the battlefield now),
        // not the spell the replacement was applied to
        // the permanent is a new object (CR 400.7): the same card on the battlefield now
        const entered = c.source.id !== o.id ? undefined : o.cardId !== undefined ? Object.values(g.s.objects).find((x) => x.cardId === o.cardId && x.zone === 'battlefield') : g.s.objects[o.id]?.zone === 'battlefield' ? g.s.objects[o.id] : undefined; // a token keeps its id
        if (entered !== undefined) cx.source = { id: entered.id, zone: 'battlefield' };
        cx.bindings.set(then.as, { objects: [copied], players: [], snapshots: {} });
        cx.results.set(then.as, { performed: true, count: 1 });
        runNested(cx, then.do);
      });
    }
    if (e.from === null) {
      const rec = beginTokenCopy(g, o, of, spec.except ?? [], c.sourceName, spec.duration);
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
      controller: o.controller, timestamp: o.timestamp, turn: alt.turn.number, ...(facts.copyDuration ? { duration: facts.copyDuration } : {}),
    })];
  },
};

type G = Parameters<EntersPart['apply']>[0];

/**
 * edh-next-133 (CR 614.1c, 614.12a, 707.5, 707.9e, 122.6; The Mimeoplasm, rulings 2011-09-22): "As ~ enters, you may exile two creature cards from graveyards. If you do, it enters as a copy of
 * one of those cards with a number of additional +1/+1 counters on it equal to the power of the other card." Exactly two cards (from one graveyard or several; with fewer than two there nothing is
 * asked: "You can't choose to exile just one creature card"); the player it enters under chooses which one it copies and which one counts. The counters are an additional effect of the copy
 * (CR 707.9e), the power read from the other card in exile (CR 400.7: the card there). A pair whose chosen card the engine can't copy exactly is exiled, and the copy is left to the players (logged).
 */
function exilePairCopy(g: G, e: Parameters<EntersPart['apply']>[1], spec: NonNullable<Parameters<EntersPart['apply']>[2]['copy']>, o: GameObject, matching: readonly string[], copiable: ReadonlySet<string>,
  chooser: string, cx: ReturnType<typeof contextFor>, sourceName: string): Partial<DestinationFacts> {
  const name = g.nameOf(o.id);
  const kind = spec.exilePair!.counters;
  if (matching.length < 2) {
    g.log(`${name} enters as itself: there are not two cards it could exile (${sourceName}).`, { rules: ['CR 614.12a', 'CR 707.5'], level: 'info' });
    return {};
  }
  if (spec.optional && !g.choose({ kind: 'yesNo', player: chooser, prompt: `As ${name} enters, you may exile two cards from graveyards (${sourceName}). If you do, it enters as a copy of one of them.`, yesLabel: 'Exile two', noLabel: "Don't", rules: ['CR 614.12a'] }).yes) {
    g.log(`${name} enters as itself (no cards exiled).`, { rules: ['CR 707.5'], level: 'info' });
    return {};
  }
  const pair = matching.length === 2 ? [...matching] : g.choose({ kind: 'chooseObjects', player: chooser, options: [...matching], min: 2, max: 2, prompt: `Choose the two cards ${name} exiles as it enters.`, rules: ['CR 614.12a'] }).ids;
  if (pair.length !== 2) return {};
  const picked = g.choose({ kind: 'chooseObjects', player: chooser, options: pair, min: 1, max: 1, prompt: `Choose the card ${name} enters as a copy of; the other card's power is the number of additional ${kind} counters.`, rules: ['CR 707.5', 'CR 614.12a'] }).ids[0]!;
  const other = pair.find((id) => id !== picked)!;
  const MOVING = '$exilePairAsEnters';
  cx.bindings.set(MOVING, { objects: pair.map((id) => ({ id, zone: g.s.objects[id]!.zone })), players: [], snapshots: {} });
  runNested(cx, [{ op: 'move', what: { ref: 'bound', name: MOVING }, to: { zone: 'exile' } }]);
  cx.bindings.delete(MOVING);
  const now = (id: string): GameObject | undefined => { let x: string | undefined = id; for (let k = 0; k < 4 && x !== undefined && g.s.objects[x]?.zone !== 'exile'; k++) x = g.s.lki[x]?.newId ?? undefined; return x === undefined ? undefined : g.s.objects[x]; };
  const of = now(picked);
  const counted = now(other);
  g.log(`As ${name} enters, ${g.nameOf(picked)} and ${g.nameOf(other)} are exiled.`, { rules: ['CR 614.12a'], level: 'action' });
  if (of?.zone !== 'exile' || !copiable.has(picked)) {
    g.log(`${name} can't enter as a copy of ${g.nameOf(picked)} automatically; apply the copy and its counters by hand.`, { rules: ['CR 707.5'], level: 'manual' });
    return {};
  }
  const power = counted?.zone === 'exile' ? ptNumbers(charsOfObject(g.s, counted)).power : null;
  if (power === null) g.log(`${name}: the power of ${g.nameOf(other)} can't be read; add its +1/+1 counters by hand.`, { rules: ['CR 707.9e'], level: 'manual' });
  const additional = power !== null && power > 0 ? [{ counters: [{ kind, count: power }] }] : [];
  const facts: Partial<DestinationFacts> = { copyOf: { id: of.id, zone: of.zone }, copyExcept: spec.except, copyAdditional: additional };
  if (e.from === null) {
    const rec = beginTokenCopy(g, o, of, spec.except ?? [], sourceName, spec.duration);
    const extra = rec ? additionalCounters(g, o, rec.copy!, additional) : [];
    if (extra.length > 0) facts.counters = [...(e.destination.counters ?? []), ...extra];
  }
  return facts;
}

/**
 * edh-next-122 (CR 707.2, 608.2h, 614.1c; Mystic Reflection ruling 2021-02-05): the object enters as a copy of an object that has left the battlefield, from its last known information
 * there. No choice is made (the effect names that one object). A token being created begins its copy now (as `apply` does for a chosen object).
 */
function lastKnownCopy(g: G, e: Parameters<EntersPart['apply']>[1], spec: NonNullable<Parameters<EntersPart['apply']>[2]['copy']>, o: GameObject, of: GameObject, sourceName: string): Partial<DestinationFacts> {
  const cv = copiableOrWhy(g.s, of);
  if ('reason' in cv) {
    g.log(`${g.nameOf(o.id)} can't enter as a copy of what ${sourceName} names automatically (${cv.reason}); apply the copy by hand.`, { rules: ['CR 707.5', 'CR 608.2h'], level: 'manual' });
    return {};
  }
  if (e.from === null) beginTokenCopy(g, o, of, spec.except ?? [], sourceName, spec.duration);
  return { copyOf: { id: of.id, zone: of.zone }, copyExcept: spec.except, ...(spec.tapped === true ? { tapped: true } : {}), ...(spec.duration !== undefined ? { copyDuration: spec.duration } : {}) };
}

/** A token being created enters as a copy: the effect begins now, with the token's timestamp (see the file comment). */
function beginTokenCopy(g: G, o: GameObject, of: GameObject, except: readonly CopyExcept[], sourceName: string, duration?: Duration): ContinuousEffectRec | null {
  const name = g.nameOf(o.id);
  const ofName = g.nameOf(of.id);
  const r = beginCopy(g, o, of, except, { source: { id: o.id, zone: 'battlefield' }, sourceName, controller: o.controller, timestamp: o.timestamp, ...(duration ? { duration } : {}) });
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
