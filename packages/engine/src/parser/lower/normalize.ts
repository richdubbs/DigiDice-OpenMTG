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
import { groupMayActs, perGroupAmounts } from './targets';
import { isRec, leftoverMarker, namesIn, rewrite, setManual, visit } from './util';

/** A damage step (anywhere in the unit) dealt by an object other than this one whose recipients or amount say "other" (see the header). */
function otherOfAnotherSource(steps: unknown): boolean {
  let found = false;
  visit(steps, (n) => {
    if (found) return false;
    if (n['op'] !== 'damage' || !isRec(n['source']) || n['source']['ref'] === 'self') return;
    visit([n['to'], n['amount'], n['also']], (f) => { if (f['other'] === true) found = true; }); // edh-next-23: and the `also` recipients
  });
  return found;
}

/** CR 603.7c: the bound names a delayed trigger's instructions read but do not bind themselves, sorted (the capture is a set). */
export function delayCaptures(steps: readonly unknown[]): string[] {
  const inside = new Set(namesIn(steps));
  const read = new Set<string>();
  visit(steps, (n) => { if (n['ref'] === 'bound' && typeof n['name'] === 'string' && !inside.has(n['name'])) read.add(n['name']); });
  // edh-d-98 (CR 603.7c, 608.2h; Synthetic Destiny: "Exile all creatures you control. At the beginning of the next end step, reveal ... until you reveal that many creature cards"): the
  // count of what an instruction of the creating ability did ("that many", `resultCount` of its step) is read as the delayed trigger is created (effects/handlers/lasting-fix.ts#prepareDeferred
  // fixes it to a number then), so the delayed trigger captures that step's name too
  visit(steps, (n) => { if (n['q'] === 'resultCount' && typeof n['step'] === 'string' && n['which'] === undefined && !inside.has(n['step'])) read.add(n['step']); });
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
      // edh-players-1 (CR 608.2h, 603.7c): "its controller" / "its owner" of an object this resolution moved names a PLAYER, which the delayed trigger takes with the
      // last known information of the object as it is created (effects/handlers/lasting-fix.ts#prepareDeferred fixes it), not an object it would find in another zone
      // (Arcane Denial: "Counter target spell. Its controller may draw up to two cards at the beginning of the next turn's upkeep.")
      visit(st['do'], (n) => {
        if (n['ref'] === 'controllerOf' || n['ref'] === 'ownerOf') return false;
        const k = handleKey(n);
        if (k !== null && moved.has(k)) hit = k;
      });
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
    // edh-zones-22 (CR 608.2c, 707.12; Wondrous Crucible): "Exile a nonland card at random from your graveyard. Copy it.": the card this resolution chose and exiled is named by the choice (`chosen`), which the exile moves
    if (n['op'] === 'move' && isRec(to) && to['zone'] === 'exile' && n['faceDown'] === undefined && isRec(n['what']) && n['what']['ref'] === 'bound' && typeof n['what']['name'] === 'string') exiled.add(n['what']['name']);
    // edh-zones-12 (CR 608.2c, 707.12; Mizzix's Mastery): "For each card exiled this way, copy it, ...": the loop's variable stands for one of the cards this resolution
    // exiled (a loop over the cards of the exile binding that are still in exile, or over the binding itself)
    if (n['op'] === 'forEach' && typeof n['as'] === 'string' && isRec(n['over'])) {
      const over = n['over'];
      const filter = isRec(over['filter']) ? over['filter'] : null;
      const group = over['ref'] === 'bound' ? over : filter !== null && over['ref'] === 'each' && filter['zone'] === 'exile' && isRec(filter['is']) ? filter['is'] : null;
      if (group !== null && group['ref'] === 'bound' && typeof group['name'] === 'string' && exiled.has(group['name'])) exiled.add(n['as']);
    }
    // edh-next-127 (CR 608.2c, 608.2d, 707.12; Mysterious Stranger): "choose one of them at random and copy it": a choice among the cards of an exile binding still in exile stands for one of them
    if (n['op'] === 'chooseObjects' && typeof n['as'] === 'string' && isRec(n['from']) && n['from']['ref'] === 'each' && isRec(n['from']['filter'])) {
      const f = n['from']['filter'] as Record<string, unknown>;
      if (f['zone'] === 'exile' && isRec(f['is']) && f['is']['ref'] === 'bound' && typeof f['is']['name'] === 'string' && exiled.has(f['is']['name'])) exiled.add(n['as']);
    }
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
    // edh-cast-1 (CR 607.2a, 707.12; Isochron Scepter): a copy of the card the object's linked ability exiled, which is still in exile (the handler copies it from there)
    if (isRec(what) && what['ref'] === 'linked' && what['link'] === 'exiled') return;
    // edh-next-132 (CR 707.12, 608.2h; God-Eternal Kefnet, ruling 2019-05-03): a copy created in the hand of the card the trigger's event revealed there ("copy that card and you may cast
    // the copy"; the handler copies it from where it is, or from its last known information once it left the hand)
    if (n['copyIn'] === 'hand' && isRec(what) && what['ref'] === 'event' && what['role'] === 'subject') return;
    // edh-zones-12 (CR 607.2a, 707.12; Arcane Bombardment): or a copy of each card of the linked exile, which are all still in exile (the handler copies each from there)
    if (isRec(what) && what['ref'] === 'each' && isRec(what['filter']) && what['filter']['zone'] === 'exile' && isRec(what['filter']['is']) && what['filter']['is']['ref'] === 'linked' && what['filter']['is']['link'] === 'exiled') return;
    if (!isRec(what) || what['ref'] !== 'bound' || typeof what['name'] !== 'string' || !exiled.has(what['name'])) bad = true;
  });
  return bad;
}

/**
 * edhn78 (CR 603.7c, 400.7, 608.2c; Saltskitter): "Exile this creature. Return this creature to the battlefield under its owner's control at the beginning of the next end
 * step." The delayed trigger names the object the ability itself just moved ("this creature" = "it"): the same object as a later zone's new object, which the move's binding
 * follows (the capture of the delay), not the `self` handle. Rewrites the `self` references of a `delay` after an unconditional top-level `move` of `self` into the binding of
 * that move (given the name `moved` when it has none). Only a move that is not a destination of the battlefield (the object left it), and only the plain case: a delay inside a
 * choice, a loop or a condition is left as it is (the check below refuses it).
 */
function rebindMovedSelf(units: Unit[]): boolean {
  let pending: { u: number; s: number } | null = null;
  let changed = false;
  for (let ui = 0; ui < units.length; ui++) {
    const u = units[ui]!;
    if (u.manual || !Array.isArray(u.steps)) continue;
    for (let si = 0; si < u.steps.length; si++) {
      const st = u.steps[si] as unknown;
      if (!isRec(st)) continue;
      if (st['op'] === 'move' && isRec(st['what']) && st['what']['ref'] === 'self' && isRec(st['to']) && (st['to']['zone'] === 'exile' || st['to']['zone'] === 'graveyard') && st['guard'] === undefined && st['until'] === undefined && !('optional' in st)) { pending = { u: ui, s: si }; continue; }
      if (st['op'] === 'move' && isRec(st['what']) && st['what']['ref'] === 'self') pending = null; // a later move of the object itself (to a hand, a library, the battlefield) ends the plain case
      if (st['op'] !== 'delay' || pending === null) continue;
      if (!isRec(st['when']) || st['when']['at'] !== 'step') continue; // only a delay that waits for a step names no event of its own
      let reads = false;
      visit(st['do'], (n) => { if (n['ref'] === 'controllerOf' || n['ref'] === 'ownerOf') return false; if (n['ref'] === 'self') reads = true; });
      if (!reads) continue;
      // edh-next-79 (review; CR 603.7c, 400.7): an instruction after the delayed return that still acts on ~ ("~ gains haste.") would act on the object before the move: the plain case ends, the check below refuses
      let later = false;
      for (let uj = ui; uj < units.length; uj++) {
        const from = uj === ui ? si + 1 : 0;
        const xs = units[uj]!.manual || !Array.isArray(units[uj]!.steps) ? [] : (units[uj]!.steps as unknown[]).slice(from);
        visit(xs, (n) => { if (n['ref'] === 'controllerOf' || n['ref'] === 'ownerOf') return false; if (n['ref'] === 'self') later = true; });
      }
      if (later) continue;
      const mu = units[pending.u]!;
      const mv = (mu.steps as unknown[])[pending.s] as Record<string, unknown>;
      const taken = new Set<string>(); units.forEach((x) => namesIn(x.steps as unknown[]).forEach((n) => taken.add(n)));
      const name = typeof mv['as'] === 'string' ? mv['as'] : taken.has('moved') ? null : 'moved';
      if (name === null) continue;
      const steps = [...(mu.steps as unknown[])]; steps[pending.s] = { ...mv, as: name }; mu.steps = steps as typeof mu.steps;
      const ds = [...(u.steps as unknown[])];
      ds[si] = rewrite(st, (n) => (n['ref'] === 'controllerOf' || n['ref'] === 'ownerOf' ? n : n['ref'] === 'self' ? { ref: 'bound', name } : undefined));
      u.steps = ds as typeof u.steps;
      changed = true;
    }
  }
  return changed;
}

function check(seq: LoweredSeq, bad: ReadonlyMap<string, string>): LoweredSeq {
  let changed = false;
  const units: Unit[] = seq.units.map((u) => ({ ...u }));
  if (rebindMovedSelf(units)) changed = true; // edhn78
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
    if (u.flags.includes('different-mv')) { setManual(u, { code: 'no-template', reason: '"a different mana value" outside a plural target phrase' }); changed = true; return; } // edh-top-3
    if (u.flags.includes('linked-exiled-target')) { setManual(u, { code: 'no-template', reason: '"exiled with ~" as a filter outside a target phrase' }); changed = true; return; } // std-rx5
    if (u.flags.includes('shared-creature-type')) { setManual(u, { code: 'no-template', reason: '"that share a creature type" outside a target phrase of exactly two' }); changed = true; return; } // CLOUD std-ecl
    if (u.flags.includes('zone-unstated')) { setManual(u, { code: 'no-template', reason: 'a card with no zone stated' }); changed = true; return; }
    if (u.flags.includes('batch')) {
      // edh-players-13 (CR 603.2c): the event "to one or more players" is one occurrence for the whole batch (the flag `wholeBatch` of parser/holes/event.ts)
      const whole = u.flags.includes('wholeBatch');
      u.steps = rewrite(u.steps, (n) => (n['op'] === 'delay' && isRec(n['when']) && n['when']['at'] === 'event' ? { ...n, batch: true, ...(whole ? { wholeBatch: true } : {}) } : undefined)) as typeof u.steps;
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
  // edh-zones-3 (lower/targets.ts#perGroupAmounts): a group of players doing one instruction with an amount of their own, one player at a time;
  // edh-players-12 (lower/targets.ts#groupMayActs): the `may` of a group, each player who chose doing it
  const captured = (seq: LoweredSeq): LoweredSeq => ({ ...seq, steps: groupMayActs(perGroupAmounts(withCaptures(seq.steps))) });
  return {
    targets,
    main: captured(check(p.main, bad)),
    ...(p.modes ? { modes: { ...p.modes, options: p.modes.options.map((o) => ({ text: o.text, ...(o.cost ? { cost: o.cost } : {}), ...captured(check(o, bad)) })) } } : {}),
  };
}
