/**
 * Ops that take objects away: `destroy` (CR 701.8, 701.19), `sacrifice` and `sacrificeChoice` (CR 701.21), `counter` (CR 701.6). Owner: WP14.
 *
 * Every one acts through the proposal pipeline (design 8.5): a destruction is a `destroy` proposal (its performer, rules/destroy.ts, owns indestructible and
 * regeneration, CR 702.12b, 701.19), a sacrifice or a countered spell a `zoneChange` with its cause (the trigger normalizer reads "sacrifice" as the action, CR
 * 701.21a, and the zone change looks back, CR 603.10a). An ability is countered by removing it from the stack (it is not a card, CR 113.7a, 701.6a).
 */
import type { EffectStep } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { ObjHandle } from '../../types/state';
import { charsOfObject, controllerOf } from '../../rules/characteristics';
import { leavingTogether } from '../../core/zones';
import { costUseDenial } from '../../rules/cant';
import { findObjects, matchesFilter } from '../../rules/filter';
import { gameOf, hookpoints } from '../../rules/hookpoints';
import type { StepHandler, StepResult } from '../api';
import { evalQty } from '../eval';
import { performAction } from '../perform';
import { performRemoveFromStack } from '../perform-direct';
import { proposeTogether } from '../propose';
import { LASTING_HANDLERS } from './lasting';
import { filterCtxOf, rebase, resolvePlayers } from '../refs';
import { actOn, bindMoved, byHand, did, exiledLeavingStack, libraryPosition, movedResult, newObjectOf, NOTHING, permanentsOf, proposeMove, type Moved } from './zones-util';

type Step<K extends EffectStep['op']> = Extract<EffectStep, { op: K }>;

// ---- destroy (CR 701.8) ---------------------------------------------------------------------------------------------------------------------------------

/**
 * "Destroy target creature", "Destroy all creatures. They can't be regenerated." (Wrath of God: `regeneration: 'cant'`, CR 701.19c). Each permanent is its own
 * `destroy` proposal (design 8.5, the Wrath of God trace): with `canRegenerate: false` a regeneration shield does not apply. The permanents are destroyed at the
 * same time (CR 608.2f): every one is chosen before the first is proposed. `as` binds the cards that went to a graveyard ("the creatures destroyed this way").
 */
export const destroy: StepHandler<Step<'destroy'>> = (cx, st) => {
  const g = cx.g;
  const targets = permanentsOf(cx, st.what);
  const moved: Moved[] = [];
  // FAST5X E28 review (CR 603.10a): destroyed at the same time, each one is as it was before the first one left (a persist granted by another one destroyed)
  leavingTogether(g, targets.map((h) => h.id), () => {
    // trek-8 review (CR 608.2f, 701.8a): every destruction is proposed before any permanent leaves, so a replacement effect of one of them (Doctor McCoy) applies to the
    // others whatever order they are in; then they are destroyed together (effects/propose.ts#proposeTogether)
    const live = targets.filter((h) => g.s.objects[h.id] !== undefined && g.s.objects[h.id]!.zone === 'battlefield');
    proposeTogether(g, live.map((h) => ({ ev: 'destroy' as const, object: h, canRegenerate: st.regeneration !== 'cant' }))); // CR 701.8a; logged by rules/destroy.ts
    for (const h of live) {
      if (g.s.objects[h.id]) continue; // indestructible, regenerated or replaced: it is still here (CR 702.12b, 701.19a)
      const to = newObjectOf(g, h.id);
      rebase(cx, h.id, to); // CR 400.7j, design 3.1 rule 2: "destroy it ... return it" finds the card in the graveyard
      moved.push(movedResult(cx, h.id, to)); // CR 712.21c: with every card a melded permanent became
    }
  });
  bindMoved(cx, st.as, moved);
  // FAST5X E17 (CR 608.2c, 608.2h): what was destroyed, as it last existed on the battlefield ("if a creature you controlled was destroyed this way")
  // (only for a named step: only a named step's result can be read)
  // std-rw9 (CR 701.8a, 614.6): and where each went ("if a creature card is put into a graveyard this way": not one a replacement exiled instead)
  const r = reported(st.as, moved);
  return st.as === undefined ? r : { ...r, beforeTo: moved.flatMap((m) => (m.before ? [m.to?.zone ?? null] : [])) };
};

/**
 * Cloud C7 (CR 608.2c, 608.2h): the result of a step that moved `moved`, with what it moved as each last existed (`StepResult.before`: "for each creature
 * destroyed this way", "if a Goblin was sacrificed this way"); only a named step reports it (only a named step's result can be read).
 */
function reported(as: string | undefined, moved: readonly Moved[]): StepResult {
  return as === undefined ? did(moved.length) : { ...did(moved.length), before: moved.flatMap((m) => (m.before ? [m.before] : [])) };
}

// ---- sacrifice (CR 701.21) ------------------------------------------------------------------------------------------------------------------------------

/** Sacrifice permanents: each one's controller moves it to its owner's graveyard (CR 701.21a). Not destruction: indestructible and regeneration don't apply. */
function sacrificeAll(cx: Parameters<StepHandler>[0], hs: ObjHandle[]): Moved[] {
  const g = cx.g;
  const out: Moved[] = [];
  return leavingTogether(g, hs.map((h) => h.id), () => { // FAST5X E28 review (CR 603.10a): sacrificed at the same time (CR 608.2e)
    for (const h of hs) {
      const o = g.s.objects[h.id];
      if (!o || o.zone !== 'battlefield' || o.phasedOut) continue;
      const name = g.nameOf(h.id);
      const who = g.player(controllerOf(g.s, o)).name; // CR 613.1b: the controller after layer 2
      const cant = costUseDenial(g.s, controllerOf(g.s, o), h.id, 'sacrifice'); // WP31: "can't be sacrificed", "can't sacrifice" (CR 701.21a, 101.2)
      if (cant) {
        g.log(`${who} can't sacrifice ${name}. ${cant.message}`, { rules: ['CR 701.21a', 'CR 101.2'], level: 'info' });
        continue;
      }
      const m = proposeMove(cx, h, 'graveyard', { cause: 'sacrifice' });
      if (!m.ok) continue;
      out.push(m);
      g.log(`${who} sacrifices ${name}.`, { rules: ['CR 701.21a'], level: 'action' });
    }
    return out;
  });
}

/**
 * "Sacrifice ~", "sacrifice it" (Sneak Attack's delayed "sacrifice the creature"): the step names no player, so the player who sacrifices is the controller of
 * the spell or ability. CR 701.21a: "a player can't sacrifice ... a permanent they don't control", so a permanent that player doesn't control now (after layer 2,
 * CR 613.1b: it was stolen before the delayed trigger resolved) stays, and the log says why.
 */
export const sacrifice: StepHandler<Step<'sacrifice'>> = (cx, st) => {
  const g = cx.g;
  const mine = permanentsOf(cx, st.what).filter((h) => {
    if (controllerOf(g.s, h.id) === cx.controller) return true;
    g.log(`${g.player(cx.controller).name} can't sacrifice ${g.nameOf(h.id)}: ${g.player(controllerOf(g.s, h.id)).name} controls it.`, { rules: ['CR 701.21a'], level: 'info' });
    return false;
  });
  const moved = sacrificeAll(cx, mine);
  bindMoved(cx, st.as, moved);
  return reported(st.as, moved); // Cloud C7: "for each creature sacrificed this way" (CR 608.2c, 608.2h)
};

/**
 * "Each player sacrifices a creature", "target opponent sacrifices two lands", "sacrifice all creatures you control" (`mode: 'all'`). Every player chooses in
 * APNAP order first (CR 608.2e: the choices are made one after another, then the permanents are sacrificed at the same time), among the permanents they control
 * that match the filter (CR 701.21a). With no more such permanents than the count, there is no choice: all of them (CR 608.2d).
 */
/** The value forms of the sacrificeChoice op this module runs (model/cap-walk.ts emits them; model/capabilities.ts registers them). */
export const OP_FORMS: readonly string[] = ['op:sacrificeChoice.keepEachType', 'op:sacrificeChoice.keepTypes', 'op:sacrificeChoice.keepFilter', 'op:sacrificeChoice.chooser', 'op:sacrificeChoice.cantAs', 'op:sacrificeChoice.groupChooser', 'op:sacrificeChoice.perPlayerCount', 'op:sacrificeChoice.exploit', 'op:counter.toIf', 'op:counter.sourceEffect'];

/**
 * C6 (CR 608.2e, 101.4): "Each opponent sacrifices a creature with the greatest power among creatures they control": while one player of a group (`who` is
 * `{ref:'each'}`) chooses, `{ref:'iterating'}` is that player, as in the `may` of a group (effects/handlers/control.ts#mayHandler), so the filter reads "they
 * control" for each player in turn. A singular `who` keeps the `iterating` of an enclosing `forEach`.
 * Standard round 5, r5-refs (CR 608.2e, 101.4, 107.1a): so does the count ("Each player sacrifices half the creatures they control of their choice, rounded down":
 * half of each player's own creatures): it is read for each player in turn (capability `op:sacrificeChoice.perPlayerCount` when it reads that player).
 */
function asChooser<T>(cx: Parameters<StepHandler>[0], st: Step<'sacrificeChoice'>, p: PlayerId, read: () => T): T {
  if (st.who.ref !== 'each' && st.who.ref !== 'eachWho') return read(); // pc-players-3: and "each opponent who lost life this turn"
  const before = cx.iterating;
  cx.iterating = p;
  try {
    return read();
  } finally {
    if (before === undefined) delete cx.iterating;
    else cx.iterating = before;
  }
}

/** CR 110.4: the permanent types (the card types a permanent can have), in the order the rules list them. */
const PERMANENT_TYPES = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'] as const;

/**
 * FAST5 T66 (CR 110.4, 608.2d-e, 701.21a): "Each opponent chooses a permanent they control of each permanent type and sacrifices the rest." Every player chooses in APNAP
 * order first (CR 101.4, 608.2e), type by type, among the permanents they control that match the filter and have the type; a permanent with several types is among the
 * permanents of each of them (the choice for one type does not use it up for another). With no more such permanents of a type than the count, there is no choice (CR 608.2d).
 * The rest (every matching permanent they control that was not chosen) are sacrificed at the same time (a permanent that can't be sacrificed stays, CR 701.21a, 101.2).
 */
function keepEachType(cx: Parameters<StepHandler>[0], st: Step<'sacrificeChoice'>): ReturnType<StepHandler<Step<'sacrificeChoice'>>> {
  const g = cx.g;
  const keep = evalQty(cx, st.count);
  if (keep === undefined || Number.isNaN(keep)) return NOTHING; // the count fails to determine (CR 608.2b)
  const k = Math.max(0, Math.floor(keep));
  const apnap = g.apnap();
  const players = resolvePlayers(cx, st.who).slice().sort((a, b) => apnap.indexOf(a) - apnap.indexOf(b)); // CR 101.4
  const chosen: ObjHandle[] = [];
  for (const p of players) {
    const mine = asChooser(cx, st, p, () => findObjects(g.s, { ...st.filter, zone: 'battlefield' }, filterCtxOf(cx))).filter((o) => controllerOf(g.s, o) === p && !o.phasedOut);
    // pc-players-1 (CR 205.2a, 608.2d): the kept ones are chosen among `keepFilter` when it is given (Tragic Arrogance: lands may be chosen, never sacrificed), by `chooser` when
    // it is given (you choose for each player); only for `keepTypes` when given (Cataclysmic Gearhulk: not battles)
    const keepPool = st.keepFilter === undefined ? mine
      : asChooser(cx, st, p, () => findObjects(g.s, { ...st.keepFilter!, zone: 'battlefield' }, filterCtxOf(cx))).filter((o) => controllerOf(g.s, o) === p && !o.phasedOut);
    const chooser = st.chooser === undefined ? p : (resolvePlayers(cx, st.chooser)[0] ?? p);
    const kept = new Set<ObjectId>();
    for (const type of st.keepTypes ?? PERMANENT_TYPES) {
      const pool = keepPool.filter((o) => charsOfObject(g.s, o).types.includes(type as (typeof PERMANENT_TYPES)[number])).map((o) => o.id);
      if (pool.length <= k) { for (const id of pool) kept.add(id); continue; }
      const ans = g.choose({
        kind: 'chooseObjects', player: chooser, prompt: `Choose ${k === 1 ? `${/^[aeiou]/i.test(type) ? 'an' : 'a'} ${type.toLowerCase()}` : `${k} ${type.toLowerCase()} permanents`} ${chooser === p ? 'you control' : `${g.player(p).name} controls`} to keep (the rest of ${chooser === p ? 'your' : 'their'} permanents are sacrificed).`,
        options: pool, min: k, max: k, rules: ['CR 110.4', 'CR 608.2d', 'CR 608.2e'],
      });
      for (const id of ans.ids) kept.add(id);
    }
    for (const o of mine) if (!kept.has(o.id) && costUseDenial(g.s, p, o.id, 'sacrifice') === null) chosen.push({ id: o.id, zone: 'battlefield' });
  }
  const moved = sacrificeAll(cx, chosen);
  bindMoved(cx, st.as, moved);
  return reported(st.as, moved); // Cloud C7
}

export const sacrificeChoice: StepHandler<Step<'sacrificeChoice'>> = (cx, st) => {
  const g = cx.g;
  if (st.mode === 'keepEachType') return keepEachType(cx, st);
  // r5-refs: a count that reads the choosing player of a group is read for each of them (asChooser); any other count is one number for all of them
  const perPlayer = st.mode !== 'all' && (st.who.ref === 'each' || st.who.ref === 'eachWho') && JSON.stringify(st.count).includes('"ref":"iterating"');
  const n = st.mode === 'all' ? Infinity : perPlayer ? 1 : evalQty(cx, st.count);
  // C6 review (CR 101.3): with no count to fall short of, nobody "can't" (the name is bound on every path, design 3.1 rule 6)
  const noneCant = (): StepResult => { if (st.cantAs !== undefined) cx.bindings.set(st.cantAs, { objects: [], players: [], snapshots: {} }); return NOTHING; };
  if (n === undefined || Number.isNaN(n)) return noneCant(); // the count fails to determine (CR 608.2b)
  const all = n === Infinity ? Infinity : Math.max(0, Math.floor(n));
  if (all === 0) return noneCant();
  const apnap = g.apnap();
  const players = resolvePlayers(cx, st.who).slice().sort((a, b) => apnap.indexOf(a) - apnap.indexOf(b)); // CR 101.4
  const chosen: ObjHandle[] = [];
  const cant: PlayerId[] = [];
  for (const p of players) {
    const own = perPlayer ? asChooser(cx, st, p, () => evalQty(cx, st.count)) : all;
    if (own === undefined || Number.isNaN(own)) continue; // that player's count fails to determine (CR 608.2b): nothing for that player
    const want = own === Infinity ? Infinity : Math.max(0, Math.floor(own));
    if (want === 0) continue;
    // CR 613.1b; WP31: a permanent its controller can't sacrifice is not a choice (CR 701.21a, 101.2)
    const candidates = asChooser(cx, st, p, () => findObjects(g.s, { ...st.filter, zone: 'battlefield' }, filterCtxOf(cx))).filter((o) => controllerOf(g.s, o) === p && !o.phasedOut && costUseDenial(g.s, p, o.id, 'sacrifice') === null).map((o) => o.id);
    let ids: ObjectId[];
    if (candidates.length < want) cant.push(p); // C6 (CR 101.3, 701.21a): fewer than asked, "each opponent who can't ..."
    if (candidates.length <= want) ids = candidates;
    else {
      const k = want as number;
      ids = g.choose({
        kind: 'chooseObjects', player: p, prompt: `Choose ${k === 1 ? 'a permanent' : `${k} permanents`} to sacrifice.`,
        options: candidates, min: k, max: k, rules: ['CR 701.21a', 'CR 608.2e'],
      }).ids;
    }
    for (const id of ids) chosen.push({ id, zone: 'battlefield' });
  }
  // std-rx17 (CR 702.110b): the source of an exploit ability exploits each creature sacrificed as it resolves; a source that has left the battlefield (it is a new
  // object, CR 400.7) exploits nothing, unless it is the creature sacrificed (its own "when ~ exploits" looks back, CR 603.10a)
  const exploiter = st.exploit === true && g.s.objects[cx.source.id]?.zone === 'battlefield' ? cx.source.id : undefined;
  const moved = sacrificeAll(cx, chosen);
  if (exploiter !== undefined) {
    for (const m of moved) {
      const id = m.before?.object.id;
      if (m.ok && id !== undefined) performAction(g, { verb: 'exploit', actor: cx.controller, objectId: exploiter, exploited: id });
    }
  }
  bindMoved(cx, st.as, moved);
  if (st.cantAs !== undefined) cx.bindings.set(st.cantAs, { objects: [], players: all === Infinity ? [] : cant, snapshots: {} });
  return reported(st.as, moved); // Cloud C7: "if a Goblin is sacrificed this way" (CR 608.2c, 608.2h)
};

// ---- counter (CR 701.6) ---------------------------------------------------------------------------------------------------------------------------------

/**
 * "Counter target spell" (Counterspell), "counter target activated ability", "counter it; put it on top of its owner's library" (`to`, Memory Lapse). A spell that
 * can't be countered stays (CR 101.2: "can't" wins over the instruction). A countered spell goes to its owner's graveyard (CR 701.6a) or where `to` says, except
 * that a flashback spell or an aftermath half cast from a graveyard is exiled (CR 702.34a, 702.127a). An ability ceases to exist (CR 113.7a).
 */
export const counter: StepHandler<Step<'counter'>> = (cx, st) => {
  const g = cx.g;
  // A countered spell put onto the battlefield or the stack (Desertion's "put that card onto the battlefield under your control instead") is a form this build
  // doesn't run: resolved by hand, never skipped (the capability walker names it `op:counter.to.<zone>`).
  if (st.to?.zone === 'battlefield' || st.to?.zone === 'stack') return byHand(cx, st, `putting a countered spell ${st.to.zone === 'battlefield' ? 'onto the battlefield' : 'onto the stack'} is not automated yet (CR 701.6a)`);
  const moved: Moved[] = [];
  let countered = 0;
  const by = { source: cx.stack?.sourceId ?? cx.stackId ?? cx.source.id, controller: cx.controller };
  for (const h of actOn(cx, st.what).filter((x) => x.zone === 'stack')) {
    const o = g.s.objects[h.id]!;
    const name = g.nameOf(o.id);
    // CR 101.2, 106.6: a spell (or, WP31, an ability) that can't be countered stays on the stack.
    // WP31 review: `by` is what counters it (the spell, or the source of the ability), for "can't be countered by blue spells" (CR 101.2, 701.6a).
    const denial = (o.stack?.flags ?? []).includes('cantBeCountered') ? { message: `${name} can't be countered.` } : hookpoints.canBeCountered(gameOf(g.s), o.id, by);
    if (denial) {
      g.log(`${name} can't be countered.`, { rules: ['CR 101.2', 'CR 701.6a'], level: 'info' });
      continue;
    }
    if (o.kind !== 'ability') {
      // std-rx30 (CR 701.6a, 614.15): `to` only for a spell that matches `toIf` ("if a permanent spell is countered this way, exile it instead")
      const to = st.toIf === undefined || matchesFilter(g.s, o, st.toIf, filterCtxOf(cx)) ? st.to : undefined;
      const dest = exiledLeavingStack(g, o) ? 'exile' : to?.zone ?? 'graveyard';
      // CR 401.3: the library position the step gives (top, bottom, Nth from the top, at random), the same as `move`.
      const pos = dest === 'library' ? libraryPosition(cx, to?.position, o.owner) : undefined;
      if (dest === 'library' && pos === undefined) continue; // "Nth from the top" fails to determine (CR 608.2b)
      const m = proposeMove(cx, h, dest, { cause: 'counter', ...(pos !== undefined ? { position: pos } : {}) });
      if (!m.ok) continue;
      moved.push(m);
      countered++;
      // The trigger normalizer's "counter" action (CR 701.6a, 603.10e). WP14 DEVIATION from design 8.6 stage 4 ("the performers emit"), open for WP11: its
      // zoneChange performer doesn't emit `countered` for cause 'counter'; when it does (or the deviation is recorded in the design), this line goes.
      g.emit({ type: 'countered', objectId: h.id });
      const where = pos === 'top' || pos === 'bottom' ? `on the ${pos} of its owner's library` : "into its owner's library";
      g.log(`${name} is countered${dest !== 'graveyard' ? ` and put ${dest === 'exile' ? 'into exile' : dest === 'library' ? where : `into its owner's ${dest}`}` : ''}.`, {
        rules: ['CR 701.6a', ...(dest === 'exile' && to?.zone !== 'exile' ? ['CR 702.34a'] : [])], level: 'action',
      });
    } else {
      // std-rx30 (CR 113.7, 611.2a; Tishana's Tidebinder): "that permanent loses all abilities ...": the ability's source, a permanent matching the filter as it is countered
      const src = o.stack?.sourceId !== undefined ? g.s.objects[o.stack.sourceId] : undefined;
      const fx = st.sourceEffect;
      const hit = fx !== undefined && src !== undefined && src.zone === 'battlefield' && matchesFilter(g.s, src, { ...fx.filter, zone: 'battlefield' }, filterCtxOf(cx)) ? src : undefined;
      performRemoveFromStack(g, o.id); // CR 701.6a, 113.7a
      rebase(cx, o.id, null); // it ceased to exist: it drops out of every binding
      countered++;
      g.log(`The ${name} is countered.`, { rules: ['CR 701.6a'], level: 'action' });
      if (hit !== undefined && fx !== undefined) {
        LASTING_HANDLERS.effect!(cx, { op: 'effect', duration: fx.duration, effects: [{ s: 'continuous', affects: { ref: 'fixed', objects: [{ id: hit.id, zone: 'battlefield' }] }, mods: fx.mods }] });
      }
    }
  }
  bindMoved(cx, st.as, moved);
  return did(countered);
};

