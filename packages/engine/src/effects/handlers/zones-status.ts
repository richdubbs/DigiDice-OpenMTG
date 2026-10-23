/**
 * Ops that change a permanent without moving it: `tap`, `untap` (CR 701.26), `attach` (CR 701.3), `phaseOut` (CR 702.26),
 * `regenerate` (CR 701.19), `removeFromCombat` (CR 506.4) and `exchange` (CR 701.12). Owner: WP14.
 *
 * None of these events has a `Proposed` form (design 8.5), so stage 4 of design 8.6 calls the performer of the action (effects/perform-direct.ts, WP31:
 * over rules/status.ts, rules/phasing.ts, rules/combat-state.ts; effects/perform.ts#performRegenerationShield); life changes of an exchange go through the
 * pipeline like any life change. WP31: "can't untap" and "can't transform" effects are consulted (rules/cant.ts, CR 101.2).
 * Forms the M5 build does not run (named by the capability walker so cards using them are not classified automated) are resolved by hand: a regeneration
 * shield with another duration, and exchanges other than life totals. M6-0: `changeFace` moved to effects/handlers/change-face.ts (`CHANGE_FACE`, m6 design 2.6).
 */
import type { EffectStep, ObjRef } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { GameObject, ObjHandle } from '../../types/state';
import { auraCanEnchantObject, enchantRestriction, isAura, isEquipment, isFortification } from '../../rules/attachment';
import { charsOfObject, controllerOf, ptNumbers } from '../../rules/characteristics';
import { cantDo } from '../../rules/cant';
import { attackerState, isBlocking } from '../../rules/combat-state';
import { gameOf, hookpoints } from '../../rules/hookpoints';
import { playerRestricted } from '../../rules/restrictions';
import type { ExecCtx, StepHandler, StepResult } from '../api';
import { performRegenerationShield } from '../perform';
import { performAttach, performControlSync, performEffectRecord, performPhaseOut, performRemoveFromCombat, performTap, performUnattach, performUntap } from '../perform-direct';
import { resolveRecipients } from '../refs';
import { actOn, bindAs, byHand, did, namesOf, NOTHING, permanentsOf } from './zones-util';
import { proposeMeasured } from './lifedamage';

type Step<K extends EffectStep['op']> = Extract<EffectStep, { op: K }>;

// ---- tap, untap (CR 701.26) -------------------------------------------------------------------------------------------------------------------------------

/** "Tap target creature", "tap all creatures your opponents control". Only untapped permanents can be tapped (CR 701.26a); `count` is how many changed. */
export const tap: StepHandler<Step<'tap'>> = (cx, st) => {
  // FAST5X E20 (CR 701.26a): the controller of the spell or ability taps it ("whenever you tap an untapped creature an opponent controls")
  const done = permanentsOf(cx, st.what).filter((h) => performTap(cx.g, h.id, cx.controller));
  if (done.length > 0) cx.g.log(`${namesOf(cx.g, done)} become${done.length === 1 ? 's' : ''} tapped.`, { rules: ['CR 701.26a'], level: 'action' });
  bindAs(cx, st.as, done);
  return did(done.length);
};

/** "Untap target land", "untap all creatures you control". Only tapped permanents can be untapped (CR 701.26b); WP31: not one that "can't untap" (CR 101.2). */
export const untap: StepHandler<Step<'untap'>> = (cx, st) => {
  const done = permanentsOf(cx, st.what).filter((h) => {
    const cant = cx.g.s.objects[h.id]?.tapped ? cantDo(cx.g.s, 'untap', h.id) : null;
    if (cant) cx.g.log(`${cx.g.nameOf(h.id)} can't untap. ${cant.message}`, { rules: ['CR 701.26b', 'CR 101.2'], level: 'info' });
    return cant === null && performUntap(cx.g, h.id);
  });
  if (done.length > 0) cx.g.log(`${namesOf(cx.g, done)} become${done.length === 1 ? 's' : ''} untapped.`, { rules: ['CR 701.26b'], level: 'action' });
  bindAs(cx, st.as, done);
  return did(done.length);
};

// ---- attach (CR 701.3) ------------------------------------------------------------------------------------------------------------------------------------

/**
 * Can the attachment `a` (characteristics read now) be attached to the permanent `host`? CR 701.3b: if not, it doesn't move. An Aura needs its enchant
 * restriction (CR 303.4a, `null`: the compiler did not read it, so the engine can't tell); an Equipment a creature, a Fortification a land, neither may be a
 * creature itself (CR 301.5c, 301.6); protection and "can't be equipped" come through the hookpoints (CR 702.16c-d). Also used by `move` for an Equipment put
 * onto the battlefield "attached to" something (CR 301.5e).
 */
export function attachable(cx: ExecCtx, a: GameObject, host: GameObject): boolean | null {
  const s = cx.g.s;
  if (a.id === host.id || host.zone !== 'battlefield' || host.phasedOut) return false; // CR 303.4d, 301.5c: never to itself
  const ac = charsOfObject(s, a);
  if (isAura(ac)) {
    const kw = enchantRestriction(ac);
    if (!kw) return null;
    return kw.player === undefined && auraCanEnchantObject(s, a, ac, kw, host);
  }
  const equipment = isEquipment(ac);
  if (!equipment && !isFortification(ac)) return false; // only Auras, Equipment and Fortifications attach (CR 701.3a)
  if (ac.types.includes('Creature')) return false; // CR 301.5c, 301.6: an Equipment or Fortification that's also a creature can't be attached
  if (!charsOfObject(s, host).types.includes(equipment ? 'Creature' : 'Land')) return false;
  return hookpoints.canAttach(gameOf(s), a.id, host.id) === null;
}

/**
 * "Attach ~ to target creature you control" (equip, CR 702.6a), "attach it to that creature", and `to: null` "unattach ~" (CR 701.3d). Attaching to what it's
 * already attached to does nothing (CR 701.3b); attaching gives it a new timestamp (CR 701.3c, 613.7e, in rules/status.ts).
 * Cloud std-fin: `what` may name several objects ("attach any number of Equipment you control to target creature you control": the Equipment a choice bound):
 * each of them is attached (or unattached), one at a time in the order named; one that can't be attached to it doesn't move (CR 701.3b). When the engine can't
 * tell for one of them, the whole instruction is the player's, before anything moved.
 */
export const attach: StepHandler<Step<'attach'>> = (cx, st) => {
  const g = cx.g;
  const hs = permanentsOf(cx, st.what);
  if (hs.length === 0) return NOTHING;
  if (st.to === null) {
    const off = hs.filter((h) => performUnattach(g, h.id));
    for (const h of off) g.log(`${g.nameOf(h.id)} becomes unattached.`, { rules: ['CR 701.3d'], level: 'action' });
    return off.length > 0 ? did(off.length) : NOTHING;
  }
  const [hh] = permanentsOf(cx, st.to);
  if (!hh) return NOTHING;
  const host = g.s.objects[hh.id]!;
  const moving = hs.filter((h) => g.s.objects[h.id]!.attachedTo !== host.id); // CR 701.3b
  if (moving.length === 0) return NOTHING;
  const verdicts = moving.map((h) => attachable(cx, g.s.objects[h.id]!, host));
  const unknown = verdicts.indexOf(null);
  if (unknown >= 0) return byHand(cx, st, `the engine can't tell what ${g.nameOf(moving[unknown]!.id)} may enchant (its enchant ability is manual text)`);
  const done: ObjHandle[] = [];
  moving.forEach((h, k) => {
    if (!verdicts[k]) {
      g.log(`${g.nameOf(h.id)} can't be attached to ${g.nameOf(host.id)} and doesn't move.`, { rules: ['CR 701.3b'], level: 'info' });
      return;
    }
    performAttach(g, h.id, host.id);
    g.log(`${g.nameOf(h.id)} becomes attached to ${g.nameOf(host.id)}.`, { rules: ['CR 701.3a', 'CR 701.3c'], level: 'action' });
    done.push(h);
  });
  if (done.length === 0) return NOTHING;
  bindAs(cx, st.as, done);
  return did(done.length);
};

// ---- phase out (CR 702.26) -------------------------------------------------------------------------------------------------------------------------------

/** "Target creature phases out", "creatures you control phase out" (Teferi's Protection). It phases in during its controller's next untap step (CR 502.1). */
export const phaseOut: StepHandler<Step<'phaseOut'>> = (cx, st) => {
  const g = cx.g;
  const done = permanentsOf(cx, st.what).flatMap((h) => performPhaseOut(g, h.id));
  if (done.length > 0) g.log(`${done.map((id) => g.nameOf(id)).join(', ')} phase${done.length === 1 ? 's' : ''} out.`, { rules: ['CR 702.26b', 'CR 702.26g'], level: 'action' });
  return did(done.length);
};

// ---- regenerate (CR 701.19) ------------------------------------------------------------------------------------------------------------------------------

/** "Regenerate target creature": a shield that replaces its next destruction this turn (CR 701.19a; the shield is consumed by rules/destroy.ts). */
export const regenerate: StepHandler<Step<'regenerate'>> = (cx, st) => {
  if (st.duration !== undefined && st.duration.d !== 'endOfTurn') return byHand(cx, st, 'a regeneration shield that lasts beyond this turn is not automated (CR 701.19a)');
  const hs = permanentsOf(cx, st.what);
  for (const h of hs) performRegenerationShield(cx.g, h.id, cx.source.id); // logs CR 701.19a
  return did(hs.length);
};

// ---- remove from combat (CR 506.4) ------------------------------------------------------------------------------------------------------------------------

/** "Remove target attacking creature from combat": it stops being an attacking, blocking, blocked or unblocked creature (CR 506.4). */
export const removeFromCombat: StepHandler<Step<'removeFromCombat'>> = (cx, st) => {
  const g = cx.g;
  const done = permanentsOf(cx, st.what).filter((h) => attackerState(g.s, h.id) !== undefined || isBlocking(g.s, h.id) || (g.s.combat?.attackers.some((a) => a.defender === h.id) ?? false));
  for (const h of done) performRemoveFromCombat(g, h.id);
  if (done.length > 0) g.log(`${namesOf(g, done)} ${done.length === 1 ? 'is' : 'are'} removed from combat.`, { rules: ['CR 506.4'], level: 'action' });
  return did(done.length);
};

// ---- exchange (CR 701.12) ---------------------------------------------------------------------------------------------------------------------------------

/**
 * "Exchange life totals with target player" (CR 701.12c): each player gains or loses the life needed to reach the other's previous total, through the pipeline
 * (replacement effects may modify those gains and losses, and they trigger). If either player can't make their change ("can't gain life", "can't lose life",
 * CR 119.7-119.8), no part of the exchange happens (CR 701.12a). Exchanges of hands and power/toughness are resolved by hand, and the walker names those
 * forms `op:exchange.<what>` so no card using them is classified automated. MX2: exchange of control runs (`exchangeControl` below, `op:exchange.control`),
 * as two layer-2 records, now that the stored controller is the controller after layer 2 (core/control.ts).
 */
export const exchange: StepHandler<Step<'exchange'>> = (cx, st) => {
  if (st.what === 'control') return exchangeControl(cx, st);
  if (st.what === 'lifeToughness') return exchangeLifeToughness(cx, st);
  if (st.what !== 'life') return byHand(cx, st, `exchanging ${st.what} is not automated yet (CR 701.12)`);
  const g = cx.g;
  // std-rx25 (CR 701.12c, 115.3): one reference to both players, "two target players exchange life totals" (`a` equal to `b`, as MX2's exchange of control):
  // exactly two different players, else nothing is exchanged (an illegal target leaves one, CR 608.2b)
  const both = JSON.stringify(st.a) === JSON.stringify(st.b) ? [...new Set(resolveRecipients(cx, st.a).players)] : null;
  if (both !== null && both.length !== 2) return NOTHING;
  const [pa] = both !== null ? both : resolveRecipients(cx, st.a).players;
  const pb = both !== null ? both[1] : resolveRecipients(cx, st.b).players[0];
  if (pa === undefined || pb === undefined || pa === pb) return NOTHING;
  const la = g.player(pa).life;
  const lb = g.player(pb).life;
  const changes: [PlayerId, number][] = [[pa, lb - la], [pb, la - lb]];
  for (const [p, delta] of changes) {
    if ((delta > 0 && playerRestricted(g.s, p, 'cantGainLife')) || (delta < 0 && playerRestricted(g.s, p, 'cantLoseLife'))) {
      g.log(`The life totals are not exchanged: ${g.player(p).name} can't ${delta > 0 ? 'gain' : 'lose'} life.`, { rules: ['CR 701.12a', 'CR 701.12c', delta > 0 ? 'CR 119.7' : 'CR 119.8'], level: 'info' });
      return NOTHING;
    }
  }
  let n = 0;
  const lostBy = new Map<PlayerId, number>();
  for (const [p, delta] of changes) {
    if (delta === 0) continue;
    const got = proposeMeasured(cx, { ev: 'life', change: delta > 0 ? 'gain' : 'loss', player: p, amount: Math.abs(delta) });
    if (got > 0) n++;
    if (delta < 0 && got > 0) lostBy.set(p, got);
  }
  g.log(`${g.player(pa).name} and ${g.player(pb).name} exchange life totals.`, { rules: ['CR 701.12c'], level: 'action' });
  // cloud std-spm (CR 119.3, 701.12c): the life each player actually lost this way ("If you lost life this way, draw that many cards", `{q:'lifeLost', who}`)
  return { performed: true, count: n, lifeLost: [...lostBy.values()].reduce((a, b) => a + b, 0), lifeLostBy: lostBy };
};

/**
 * MX2 (`op:exchange.control`, core/control.ts#OP_FORMS): "Exchange control of A and B" / "of two target creatures" (one reference to both, `a` equal to `b`).
 * Both permanents must still be there (a target that became illegal or left is not acted on): otherwise no part of the exchange happens (CR 701.12a). If one
 * player controls both, it does nothing (CR 701.12b); else each player gains control of the permanent the other controlled, simultaneously: two layer-2
 * effects with one timestamp and no duration (CR 611.2a, 613.1b, 613.7b), written to the stored controllers at once (core/control.ts#syncControl).
 * E3XP (Perplexing Chimera, "exchange control of this creature and that spell"; CR 701.12a, 108.4): a SPELL on the stack is exchanged the same way, its stored
 * controller synced on the stack like a permanent's (core/control.ts); the effect ends for it when it leaves the stack (CR 400.7: a permanent it becomes is a new
 * object, under the spell's controller, CR 608.3).
 */
/**
 * p2-pt-1 (`op:exchange.lifeToughness`): "Exchange your life total with this creature's toughness" (CR 701.12a, 613.4b, 119.5): the player's life total becomes
 * the creature's toughness (a gain or loss of the difference, through the pipeline, CR 119.5) and the creature's toughness becomes the player's former life total
 * (a layer-7b effect with no duration, CR 611.2a). If the permanent is gone, its toughness can't be determined, or the player can't make their change ("can't gain
 * life", "can't lose life"), no part of the exchange happens (CR 701.12a). Both values are read before either changes.
 */
export const LIFE_TOUGHNESS_OP_FORMS: readonly string[] = ['op:exchange.lifeToughness'];

function exchangeLifeToughness(cx: ExecCtx, st: Step<'exchange'>): StepResult {
  const g = cx.g;
  const [p] = resolveRecipients(cx, st.a).players;
  const objs = actOn(cx, st.b as ObjRef).filter((h) => h.zone === 'battlefield');
  const o = objs.length === 1 ? g.s.objects[objs[0]!.id] : undefined;
  const t = o !== undefined ? ptNumbers(charsOfObject(g.s, o)).toughness : null;
  if (p === undefined || o === undefined || t === null) {
    g.log('The life total and toughness are not exchanged: the player or the creature is no longer there.', { rules: ['CR 701.12a'], level: 'info' });
    return NOTHING;
  }
  const life = g.player(p).life;
  const delta = t - life;
  if ((delta > 0 && playerRestricted(g.s, p, 'cantGainLife')) || (delta < 0 && playerRestricted(g.s, p, 'cantLoseLife'))) {
    g.log(`The life total and toughness are not exchanged: ${g.player(p).name} can't ${delta > 0 ? 'gain' : 'lose'} life.`, { rules: ['CR 701.12a', delta > 0 ? 'CR 119.7' : 'CR 119.8'], level: 'info' });
    return NOTHING;
  }
  if (delta !== 0) proposeMeasured(cx, { ev: 'life', change: delta > 0 ? 'gain' : 'loss', player: p, amount: Math.abs(delta) });
  performEffectRecord(g, {
    id: g.newEffectId(),
    source: { id: cx.source.id, zone: cx.source.zone },
    sourceName: g.nameOf(cx.source.id),
    controller: cx.controller,
    timestamp: g.newTimestamp(),
    startedTurn: g.s.turn.number,
    duration: { d: 'permanent' },
    effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id: o.id, zone: 'battlefield' }] }, mods: [{ layer: '7b', toughness: life }] },
  });
  g.log(`${g.player(p).name} exchanges their life total (${life}) with the toughness of ${g.nameOf(o.id)} (${t}).`, { rules: ['CR 701.12a', 'CR 613.4b'], level: 'action' });
  return { performed: true, count: 1 };
}

function exchangeControl(cx: ExecCtx, st: Step<'exchange'>): StepResult {
  const g = cx.g;
  const same = JSON.stringify(st.a) === JSON.stringify(st.b);
  const first = actOn(cx, st.a as ObjRef);
  const pair = same ? first : first.length === 1 ? [...first, ...actOn(cx, st.b as ObjRef)] : [];
  // an ability on the stack (its controller is never synced, core/control.ts) or a card that is neither a permanent nor a spell is not automated: asked by hand,
  // never skipped
  const exchangeable = (h: ObjHandle): boolean => h.zone === 'battlefield' || (h.zone === 'stack' && g.s.objects[h.id]?.kind !== 'ability');
  if (pair.some((h) => !exchangeable(h))) return byHand(cx, st, 'exchanging control of an ability or of a card that is neither a permanent nor a spell is not automated (CR 701.12)');
  if (pair.length !== 2 || pair[0]!.id === pair[1]!.id) {
    g.log('Control is not exchanged: one of the permanents is no longer there.', { rules: ['CR 701.12a'], level: 'info' });
    return NOTHING;
  }
  const [ha, hb] = pair as [ObjHandle, ObjHandle];
  const pa = controllerOf(g.s, ha.id);
  const pb = controllerOf(g.s, hb.id);
  if (pa === pb) {
    g.log(`Control is not exchanged: ${g.player(pa).name} controls both of them.`, { rules: ['CR 701.12b'], level: 'info' });
    return NOTHING;
  }
  const timestamp = g.newTimestamp(); // CR 613.7b: created together
  for (const [h, to] of [[ha, pb], [hb, pa]] as const) {
    performEffectRecord(g, {
      id: g.newEffectId(),
      source: { id: cx.source.id, zone: cx.source.zone },
      sourceName: g.nameOf(cx.source.id),
      controller: cx.controller,
      timestamp,
      startedTurn: g.s.turn.number,
      duration: { d: 'permanent' },
      effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id: h.id, zone: h.zone === 'stack' ? 'stack' : 'battlefield' }] }, mods: [{ layer: 2, controller: { ref: 'fixed', players: [to] } }] },
    });
  }
  g.log(`${g.player(pa).name} and ${g.player(pb).name} exchange control of ${g.nameOf(ha.id)} and ${g.nameOf(hb.id)}.`, { rules: ['CR 701.12b', 'CR 613.1b'], level: 'action' });
  performControlSync(g);
  return { performed: true, count: 2 };
}
