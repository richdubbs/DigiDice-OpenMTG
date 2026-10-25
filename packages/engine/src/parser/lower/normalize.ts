/**
 * Pass 10, normalize (design 6.5): the last check before the taint pass. Owner: WP17.
 *
 *  - No marker may survive lowering (`$target`, `$anaphor`, `$step`, `'$link'`, a `lower` intermediate node, a `$patchPrevious` that was not folded): a
 *    sentence that still holds one is manual (fail closed, guard G11's compile-time twin). The target specs are checked too: a spec that still holds a
 *    marker (a "$link" with no producer, "of the chosen color"; a pronoun no pass resolved) cannot be announced (CR 601.2c), so it is dropped and the
 *    sentence that introduced it is manual. That sentence still holds a target phrase nobody announces, which the taint pass makes contagious.
 *  - A card noun with no zone ("exile a card": from where?) is a reading the hole grammar flagged `zone-unstated`; the model's default (the battlefield) would
 *    be a guess, so the sentence is manual.
 *  - FAST5 T50 (CR 603.2c): an event hole read as a batch ("one or more ...", "whenever you attack") leaves the unit flag `batch`; an event-timed `delay` of the
 *    unit then carries `batch: true`, so all the events of one batch are ONE occurrence of the delayed trigger (triggers/delayed.ts).
 *  - WP20 INTERFACE CHANGE (review): "other" in a damage step whose source is another object ("Target creature you control deals damage equal to its power
 *    to each other creature") means other than THAT object (CR 608.2c), but the filter field `other` means other than this ability's source
 *    (rules/filter.ts), so the creature would be dealt damage by itself. The sentence is manual until the filter can say "not that object".
 *  - A delayed trigger keeps the objects it refers to (CR 603.7c): every `{ref:'bound'}` name its instructions read that is not bound inside them is written
 *    in the delay's `capture` (WP23). The lint (G7) checks that each one is bound before the delay; anything else a delayed trigger would read from the
 *    resolution that created it (a `did`, a result count) is not captured and is refused there.
 *  - A delayed trigger that acts on `~` or a target handle that the same resolution moved before it is manual (CR 603.7c, 400.7; WP23 review): the handle is
 *    not re-based to the new object, only a captured bound name is.
 * Canonical field order and default removal are model/canonical.ts's job (run by the ability driver on the finished ability).
 */
import type { TargetSpec } from '../../types/ability';
import type { LoweredProgram, LoweredSeq, Unit } from './types';
import { sequenceUnits } from './sequencing';
import { isRec, leftoverMarker, namesIn, rewrite, setManual, visit } from './util';

/** A damage step (anywhere in the unit) dealt by an object other than this one whose recipients or amount say "other" (see the header). */
function otherOfAnotherSource(steps: unknown): boolean {
  let found = false;
  visit(steps, (n) => {
    if (found) return false;
    if (n['op'] !== 'damage' || !isRec(n['source']) || n['source']['ref'] === 'self') return;
    visit([n['to'], n['amount']], (f) => { if (f['other'] === true) found = true; });
  });
  return found;
}

/** CR 603.7c: the bound names a delayed trigger's instructions read but do not bind themselves, sorted (the capture is a set). */
export function delayCaptures(steps: readonly unknown[]): string[] {
  const inside = new Set(namesIn(steps));
  const read = new Set<string>();
  visit(steps, (n) => { if (n['ref'] === 'bound' && typeof n['name'] === 'string' && !inside.has(n['name'])) read.add(n['name']); });
  return [...read].sort();
}

/** Every `delay` step of a step list (nested ones included) gets the capture its instructions need. Returns a new list. */
function withCaptures<T>(steps: T[]): T[] {
  const fix = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(fix);
    if (!isRec(v)) return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = fix(x);
    if (out['op'] === 'delay' && Array.isArray(out['do'])) {
      const cap = delayCaptures(out['do'] as unknown[]);
      if (cap.length > 0) out['capture'] = cap;
    }
    return out;
  };
  return fix(steps) as T[];
}

/** Ops that take the object they act on to another zone (CR 400.7: it becomes a new object there). */
const MOVING_OPS: ReadonlySet<string> = new Set(['move', 'sacrifice', 'destroy', 'counter']);
const STEP_LISTS = ['then', 'else', 'do', 'otherwise', 'onWin', 'onLose'] as const;

/** `self` or `t:<id>` for a reference by the object's own handle (not a bound name), else null. */
function handleKey(ref: unknown): string | null {
  if (!isRec(ref)) return null;
  if (ref['ref'] === 'self') return 'self';
  if (ref['ref'] === 'target' && typeof ref['id'] === 'string') return `t:${ref['id']}`;
  return null;
}

/**
 * CR 603.7c, 400.7: a delayed trigger that acts on `~` or on a target handle that an earlier instruction of the same resolution moved to another zone would
 * find no object (the handle is not re-based, design 3.1; only a bound name the delay captures follows the card). Walks `steps` in order, recording the
 * handles moved in `moved`, and returns the reason when a delay reads one (WP23 review: "Exile ~. Return ~ ... at the beginning of the next end step.").
 */
function delayOnMoved(steps: unknown, moved: Set<string>): string | null {
  if (!Array.isArray(steps)) return null;
  for (const st of steps) {
    if (!isRec(st)) continue;
    if (st['op'] === 'delay') {
      let hit: string | null = null;
      visit(st['do'], (n) => { const k = handleKey(n); if (k !== null && moved.has(k)) hit = k; });
      if (hit !== null) return `a delayed trigger acts on ${hit === 'self' ? '~' : 'a target'} that this resolution already moved to another zone: it would find no object (CR 603.7c, 400.7)`;
      continue;
    }
    for (const key of STEP_LISTS) { const why = delayOnMoved(st[key], moved); if (why !== null) return why; }
    const k = typeof st['op'] === 'string' && MOVING_OPS.has(st['op']) ? handleKey(st['what']) : null;
    if (k !== null) moved.add(k);
  }
  return null;
}

/**
 * Review of r3-copy (CR 608.2h, 400.7, 707.2): a copy of an object an earlier instruction moved to a hand or a library ("Return target creature to its owner's
 * hand. You create a token that's a copy of that creature.", Supplant Form). The move's binding is not re-based into a hidden zone and keeps no last known
 * information (effects/refs.ts#rebase), so the copy finds nothing and silently does nothing, where the rules copy the creature as it last existed on the
 * battlefield. Records the names such moves bind (`hidden`, across the units in order) and returns whether `steps` copy one of them (a `copy` step, or a
 * layer-1a `copyOf`).
 */
function copiesHiddenMove(steps: unknown, hidden: Set<string>): boolean {
  visit(steps, (n) => {
    const to = n['to'];
    if (n['op'] === 'move' && typeof n['as'] === 'string' && isRec(to) && (to['zone'] === 'hand' || to['zone'] === 'library')) hidden.add(n['as']);
  });
  let hit = false;
  visit(steps, (n) => {
    const what = n['op'] === 'copy' ? n['what'] : n['copyOf'];
    if (isRec(what) && what['ref'] === 'bound' && typeof what['name'] === 'string' && hidden.has(what['name'])) hit = true;
  });
  return hit;
}

/**
 * r4-copy (CR 707.12, 400.7): "Exile target card from your graveyard. Copy it. You may cast the copy." casts a copy of a card created in exile (`cast` with
 * `copyIn: 'exile'`, effects/handlers/tokens-cast.ts#copiesIn). Only the card an earlier instruction of this resolution moved into exile is such a card: records
 * the names those moves bind (`exiled`, across the units in order, this unit's first) and returns whether `steps` cast a copy of anything else (a spell on the stack, a permanent,
 * a card in another zone), which the handler would copy from the wrong zone, or copy such a card as a spell (which copies nothing).
 */
function castsCopyOfUnexiled(steps: unknown, exiled: Set<string>): boolean {
  // a binding is read only after the instruction that makes it (the move of this unit comes before the cast it names)
  visit(steps, (n) => {
    const to = n['to'];
    if (n['op'] === 'move' && typeof n['as'] === 'string' && isRec(to) && to['zone'] === 'exile' && n['faceDown'] === undefined) exiled.add(n['as']);
  });
  let bad = false;
  visit(steps, (n) => {
    // a spell copy (CR 707.10) of a card this resolution exiled copies nothing on the stack: "Copy it." of a card is only the first half of "... You may cast the copy."
    const w = n['what'];
    // std-cardcopy-7 (CR 707.12, 400.7j): so are the cards the ability's own cost exiled (`costExiled`, the cards in exile: "Copy those exiled cards.")
    const ofCost = isRec(w) && w['ref'] === 'costExiled' && w['self'] === undefined;
    if (n['op'] === 'copy' && n['result'] === 'spell' && isRec(w) && ((w['ref'] === 'bound' && typeof w['name'] === 'string' && exiled.has(w['name'])) || ofCost)) bad = true;
    if (n['op'] !== 'cast' || n['copyIn'] === undefined) return;
    const what = n['what'];
    if (isRec(what) && what['ref'] === 'costExiled' && what['self'] === undefined) return;
    // trek-12 (CR 707.12, 113.6): a copy of the card the ability itself is on ("Create a copy of ~. You may cast the copy."): the lint of the finished ability (model/lint-nodes.ts,
    // case 'cast') allows it only in an activated ability that functions in exile alone
    if (isRec(what) && what['ref'] === 'self') return;
    if (!isRec(what) || what['ref'] !== 'bound' || typeof what['name'] !== 'string' || !exiled.has(what['name'])) bad = true;
  });
  return bad;
}

function check(seq: LoweredSeq, bad: ReadonlyMap<string, string>): LoweredSeq {
  let changed = false;
  const units: Unit[] = seq.units.map((u) => ({ ...u }));
  const moved = new Set<string>();
  const hidden = new Set<string>();
  const exiled = new Set<string>();
  units.forEach((u) => {
    const dropped = (u.targetIds ?? []).filter((id) => bad.has(id));
    if (dropped.length > 0) {
      // the spec cannot be announced: none of the sentence's targets is (a partial target list would change CR 608.2b)
      const why = bad.get(dropped[0]!)!;
      if (!u.manual) setManual(u, { code: 'lint', reason: why.startsWith('reason:') ? why.slice('reason:'.length) : `an unresolved ${why} marker in the target "${dropped[0]}" after lowering (CR 601.2c)` });
      delete u.targetIds;
      delete u.targetPos;
      changed = true;
      return;
    }
    if (u.manual) return;
    const left = leftoverMarker(u.steps);
    if (left !== null) { setManual(u, { code: 'lint', reason: `an unresolved ${left} marker after lowering` }); changed = true; return; }
    // FAST5 T42: "with different names" says something about the set chosen, which only a target phrase keeps (parser/holes/object.ts); anywhere else it would be dropped
    if (u.flags.includes('different-names')) { setManual(u, { code: 'no-template', reason: '"with different names" outside a plural target phrase' }); changed = true; return; }
    if (u.flags.includes('linked-exiled-target')) { setManual(u, { code: 'no-template', reason: '"exiled with ~" as a filter outside a target phrase' }); changed = true; return; } // std-rx5
    if (u.flags.includes('shared-creature-type')) { setManual(u, { code: 'no-template', reason: '"that share a creature type" outside a target phrase of exactly two' }); changed = true; return; } // CLOUD std-ecl
    if (u.flags.includes('zone-unstated')) { setManual(u, { code: 'no-template', reason: 'a card with no zone stated' }); changed = true; return; }
    if (u.flags.includes('batch')) {
      u.steps = rewrite(u.steps, (n) => (n['op'] === 'delay' && isRec(n['when']) && n['when']['at'] === 'event' ? { ...n, batch: true } : undefined)) as typeof u.steps;
      changed = true;
    }
    // both read the steps before either makes the unit manual (setManual clears them); delayOnMoved also records this unit's moves for the next units
    const why = delayOnMoved(u.steps, moved);
    if (copiesHiddenMove(u.steps, hidden)) { setManual(u, { code: 'lint', reason: 'a copy of an object this resolution moved to a hand or a library: its last known information is not kept (CR 608.2h, 400.7)' }); changed = true; }
    if (castsCopyOfUnexiled(u.steps, exiled)) { setManual(u, { code: 'lint', reason: 'a copy of a card cast from a zone other than exile, or of what this resolution did not exile (CR 707.12)' }); changed = true; }
    if (otherOfAnotherSource(u.steps)) { setManual(u, { code: 'lint', reason: '"other" relative to a damage source that is not this object (CR 608.2c)' }); changed = true; }
    if (why !== null) { setManual(u, { code: 'lint', reason: why }); changed = true; }
  });
  return changed ? sequenceUnits(units) : seq;
}

/**
 * Review of r3-copy (CR 122.2, 406.3): a target CARD in a graveyard, hand or library "with a <kind> counter on it". A card that enters one of those zones has no
 * counters (CR 122.2) and no instruction puts one on such a card, so the phrase is the counter the sentence's own instruction puts on the card it moves:
 * "exile up to one target legendary creature card from a graveyard with a memory counter on it" (The Animus, Altaïr Ibn-La'Ahad) exiles it WITH a memory counter,
 * which no move destination states yet. Read as a filter, the ability never finds a card (and the card's "card in exile with a memory counter on it" ability
 * never has a target): fail closed. A card in exile with counters (suspend, memory) is a real filter and is kept.
 */
function countersOffBattlefield(t: TargetSpec): boolean {
  const f = t.filter as { zone?: unknown; counters?: unknown; isCard?: unknown } | undefined;
  if (!f || f.counters === undefined) return false;
  const zones = Array.isArray(f.zone) ? f.zone : [f.zone];
  return zones.length > 0 && zones.every((z) => z === 'graveyard' || z === 'hand' || z === 'library');
}

/** Pass 10. */
export function lowerNormalize(p: LoweredProgram): LoweredProgram {
  const bad = new Map<string, string>();
  for (const t of p.targets) {
    const left = leftoverMarker(t);
    if (left !== null) bad.set(t.id, left);
    else if (countersOffBattlefield(t)) bad.set(t.id, `reason:"with a counter on it" read as a filter of a card in a ${String(t.filter!.zone)} (target "${t.id}"): counters don't stay on a card that changes zones (CR 122.2), so it is the counter the instruction puts on the card it moves ("exile ... from a graveyard with a memory counter on it"), which this reading drops`);
  }
  const targets: TargetSpec[] = p.targets.filter((t) => !bad.has(t.id));
  const captured = (seq: LoweredSeq): LoweredSeq => ({ ...seq, steps: withCaptures(seq.steps) });
  return {
    targets,
    main: captured(check(p.main, bad)),
    ...(p.modes ? { modes: { ...p.modes, options: p.modes.options.map((o) => ({ text: o.text, ...(o.cost ? { cost: o.cost } : {}), ...captured(check(o, bad)) })) } } : {}),
  };
}
