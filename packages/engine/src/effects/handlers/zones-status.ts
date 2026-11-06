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
import type { Duration, EffectStep, ObjRef, PlayerRef } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { GameObject, ObjHandle } from '../../types/state';
import { auraCanEnchantObject, auraCanEnchantPlayer, enchantRestriction, isAura, isEquipment, isFortification } from '../../rules/attachment';
import { charsOfObject, controllerOf, hasKeyword, ptNumbers } from '../../rules/characteristics';
import { cantDo } from '../../rules/cant';
import { attackerState, isBlocking } from '../../rules/combat-state';
import { gameOf, hookpoints } from '../../rules/hookpoints';
import { playerRestricted } from '../../rules/restrictions';
import type { ExecCtx, StepHandler, StepResult } from '../api';
import { performRegenerationShield } from '../perform';
import { performAttach, performControlSync, performEffectRecord, performPhaseIn, performPhaseOut, performRemoveFromCombat, performTap, performUnattach, performUntap, performUntilMove } from '../perform-direct';
import { isCurrent, resolveObjs, resolveRecipients } from '../refs';
import { actOn, bindAs, byHand, did, enterAttacking, namesOf, NOTHING, permanentsOf, proposeMove } from './zones-util';
import { leavingTogether, zoneArray } from '../../core/zones';
import { costUseDenial } from '../../rules/cant';
import { proposeMeasured } from './lifedamage';

type Step<K extends EffectStep['op']> = Extract<EffectStep, { op: K }>;

// ---- tap, untap (CR 701.26) -------------------------------------------------------------------------------------------------------------------------------

/** "Tap target creature", "tap all creatures your opponents control". Only untapped permanents can be tapped (CR 701.26a); `count` is how many changed. */
export const tap: StepHandler<Step<'tap'>> = (cx, st) => {
  // FAST5X E20 (CR 701.26a): the controller of the spell or ability taps it ("whenever you tap an untapped creature an opponent controls")
  const named = permanentsOf(cx, st.what);
  const done = named.filter((h) => performTap(cx.g, h.id, cx.controller));
  if (done.length > 0) cx.g.log(`${namesOf(cx.g, done)} become${done.length === 1 ? 's' : ''} tapped.`, { rules: ['CR 701.26a'], level: 'action' });
  // edh-players-4 (CR 608.2c, 701.26a; as untap below): "Tap all creatures your opponents control. They gain ..." names every object the instruction was about, also one that was tapped already
  // edh-d-94 (CR 701.26a, 608.2c; Suppression Ray ruling 2024-06-07): "creatures tapped this way" are only those this step tapped (`changedOnly`)
  bindAs(cx, st.as, st.changedOnly === true ? done : named);
  // edh-next-134 (CR 508.4, 506.3; Midnight Crusader Shuttle): "tap it, and it's attacking that player": each named creature joins the combat in progress attacking that player
  if (st.attacking !== undefined) enterAttacking(cx, named.filter((h) => h.zone === 'battlefield').map((h) => h.id), st.attacking);
  return did(done.length);
};
/** edh-d-94: the value forms of the tap step (model/cap-walk.ts). */
export const TAP_OP_FORMS: readonly string[] = ['op:tap.changedOnly'];

/** "Untap target land", "untap all creatures you control". Only tapped permanents can be untapped (CR 701.26b); WP31: not one that "can't untap" (CR 101.2). */
export const untap: StepHandler<Step<'untap'>> = (cx, st) => {
  const named = permanentsOf(cx, st.what);
  const done = named.filter((h) => {
    const cant = cx.g.s.objects[h.id]?.tapped ? cantDo(cx.g.s, 'untap', h.id) : null;
    if (cant) cx.g.log(`${cx.g.nameOf(h.id)} can't untap. ${cant.message}`, { rules: ['CR 701.26b', 'CR 101.2'], level: 'info' });
    return cant === null && performUntap(cx.g, h.id);
  });
  if (done.length > 0) cx.g.log(`${namesOf(cx.g, done)} become${done.length === 1 ? 's' : ''} untapped.`, { rules: ['CR 701.26b'], level: 'action' });
  // edh-replace-2 (CR 608.2c, 701.26b): "them" / "it" after "Untap all attacking creatures. Goad them." names the objects the instruction was about, also those that were untapped
  // already (an attacker with vigilance): the next instruction acts on all of them. The step still counts only what changed (`did`).
  bindAs(cx, st.as, named);
  return did(done.length);
};

// ---- attach (CR 701.3) ------------------------------------------------------------------------------------------------------------------------------------

/**
 * Can the attachment `a` (characteristics read now) be attached to the permanent `host`? CR 701.3b: if not, it doesn't move. An Aura needs its enchant
 * restriction (CR 303.4a, `null`: the compiler did not read it, so the engine can't tell); an Equipment a creature, a Fortification a land, neither may be a
 * creature itself (CR 301.5c, 301.6); protection and "can't be equipped" come through the hookpoints (CR 702.16c-d). Also used by `move` for an Equipment put
 * onto the battlefield "attached to" something (CR 301.5e).
 */
export function attachable(cx: ExecCtx, a: GameObject, host: GameObject, asCreature = false): boolean | null {
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
  // CR 301.5c, 301.6: an Equipment or Fortification that's also a creature can't be attached; edh-mana-keywords-7: except an Equipment with reconfigure (CR 301.5c, 702.151b:
  // attached, it stops being a creature)
  if (ac.types.includes('Creature') && !(equipment && hasKeyword(ac, 'reconfigure'))) return false;
  if (!charsOfObject(s, host).types.includes(equipment ? 'Creature' : 'Land') && !(equipment && asCreature)) return false; // edh-mana-keywords-12 (CR 701.3a, ruling 2022-04-29): "Equip planeswalker" attaches as though the host were a creature
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
    // edh-top-15 (CR 701.3d, 608.2c): the permanents the unattached objects were attached to, noted before they let go ("tap that creature")
    const hosts = st.hostAs === undefined ? [] : hs.flatMap((h) => { const at = g.s.objects[h.id]?.attachedTo; return at === null || at === undefined ? [] : [at]; });
    const off = hs.filter((h) => performUnattach(g, h.id));
    if (st.hostAs !== undefined) bindAs(cx, st.hostAs, off.length === 0 ? [] : [...new Set(hosts)].flatMap((id) => { const o = g.s.objects[id]; return o ? [{ id: o.id, zone: o.zone }] : []; }));
    for (const h of off) g.log(`${g.nameOf(h.id)} becomes unattached.`, { rules: ['CR 701.3d'], level: 'action' });
    return off.length > 0 ? did(off.length) : NOTHING;
  }
  const [hh] = st.to.ref === 'randomOpponent' || st.to.ref === 'anOpponent' ? [] : permanentsOf(cx, st.to); // edh-top-14: a random opponent is a player (Maddening Hex)
  // edh-perms-16 (CR 303.4, 701.3a-b, 115.1): "to target permanent or player": when the target is a player, only an Aura that enchants players can be attached to them
  if (!hh) {
    const [player] = resolveRecipients(cx, st.to).players;
    return player === undefined ? NOTHING : attachToPlayer(cx, st, hs, player);
  }
  const host = g.s.objects[hh.id]!;
  const moving = hs.filter((h) => g.s.objects[h.id]!.attachedTo !== host.id); // CR 701.3b
  if (moving.length === 0) return NOTHING;
  const verdicts = moving.map((h) => attachable(cx, g.s.objects[h.id]!, host, st.asCreature === true));
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

/**
 * edh-perms-16 (CR 303.4, 701.3a-b): attaching to a player. Only an Aura with "enchant player" or "enchant opponent" can be (CR 702.5a, 303.4a); an Equipment,
 * a Fortification or an Aura that enchants something else stays where it is (CR 701.3b). The engine not knowing an Aura's restriction leaves the instruction to the player.
 */
function attachToPlayer(cx: ExecCtx, st: Step<'attach'>, hs: ObjHandle[], player: PlayerId): StepResult {
  const g = cx.g;
  const moving = hs.filter((h) => g.s.objects[h.id]!.attachedTo !== player); // CR 701.3b
  if (moving.length === 0) return NOTHING;
  const verdicts = moving.map((h) => {
    const a = g.s.objects[h.id]!;
    const ac = charsOfObject(g.s, a);
    if (!isAura(ac)) return false; // CR 701.3a, 301.5: only Auras attach to players
    const kw = enchantRestriction(ac);
    return kw ? auraCanEnchantPlayer(g.s, a, kw, player) : null;
  });
  const unknown = verdicts.indexOf(null);
  if (unknown >= 0) return byHand(cx, st, `the engine can't tell what ${g.nameOf(moving[unknown]!.id)} may enchant (its enchant ability is manual text)`);
  const done: ObjHandle[] = [];
  moving.forEach((h, k) => {
    if (!verdicts[k]) {
      g.log(`${g.nameOf(h.id)} can't be attached to ${g.player(player).name} and doesn't move.`, { rules: ['CR 701.3b'], level: 'info' });
      return;
    }
    performAttach(g, h.id, player);
    g.log(`${g.nameOf(h.id)} becomes attached to ${g.player(player).name}.`, { rules: ['CR 701.3a', 'CR 701.3c'], level: 'action' });
    done.push(h);
  });
  if (done.length === 0) return NOTHING;
  bindAs(cx, st.as, done);
  return did(done.length);
}

// ---- phase out (CR 702.26) -------------------------------------------------------------------------------------------------------------------------------

/**
 * edh-perms-22 (CR 702.26b, 610.3): the one `until` a phase-out runs: "phases out until ~ leaves the battlefield" (`{d:'until', event:{ev:'zoneChange', from:'battlefield',
 * subject:{self:true}}}`, nothing else). The capability walker's test (model/cap-walk.ts#phaseUntilForm) is the same.
 */
export function phaseUntilSourceLeaves(until: unknown): boolean {
  const u = (typeof until === 'object' && until !== null ? until : {}) as Record<string, unknown>;
  const e = (typeof u['event'] === 'object' && u['event'] !== null ? u['event'] : {}) as Record<string, unknown>;
  const subj = (typeof e['subject'] === 'object' && e['subject'] !== null ? e['subject'] : {}) as Record<string, unknown>;
  return u['d'] === 'until' && Object.keys(u).length === 2 && e['ev'] === 'zoneChange' && e['from'] === 'battlefield' && Object.keys(e).sort().join() === 'ev,from,subject'
    && subj['self'] === true && Object.keys(subj).length === 1;
}

/** `OP_FORMS` (model/capabilities.ts): "target creature phases out until ~ leaves the battlefield" (CR 702.26b, 610.3). */
export const OP_FORMS: readonly string[] = ['op:phaseOut.until', 'op:tap.attacking' /* edh-next-134: CR 508.4 */];

/**
 * "Target creature phases out", "creatures you control phase out" (Teferi's Protection). It phases in during its controller's next untap step (CR 502.1).
 * edh-perms-22: with `until` (CR 610.3) it stays out until the source leaves the battlefield, then phases in with what is attached to it, tapped when `tapped`
 * (core/durations.ts#endUntilMoves, effects/until-return.ts). The source already gone (it left after the ability went on the stack, CR 610.3a-b): nothing phases out.
 */
export const phaseOut: StepHandler<Step<'phaseOut'>> = (cx, st) => {
  const g = cx.g;
  if (st.tapped === true && st.until === undefined) return byHand(cx, st, '"tap it as it phases in" without a duration is not automated (CR 702.26b)');
  if (st.until !== undefined && !phaseUntilSourceLeaves(st.until)) return byHand(cx, st, 'a phase-out that lasts until this event happens (CR 610.3) is not automated yet');
  if (st.until !== undefined && !(isCurrent(cx, cx.source) && cx.source.zone === 'battlefield')) {
    g.log(`${g.nameOf(cx.source.id)} has already left the battlefield: nothing phases out.`, { rules: ['CR 610.3a', 'CR 610.3b'], level: 'info' });
    return NOTHING;
  }
  const hs = permanentsOf(cx, st.what).filter((h) => st.until === undefined || h.id !== cx.source.id); // (a source that phases itself out until it leaves can never phase in again: by hand)
  if (st.until !== undefined && hs.length !== permanentsOf(cx, st.what).length) return byHand(cx, st, 'the source would phase itself out until it leaves the battlefield (CR 610.3)');
  const done = hs.flatMap((h) => performPhaseOut(g, h.id));
  if (done.length > 0) g.log(`${done.map((id) => g.nameOf(id)).join(', ')} phase${done.length === 1 ? 's' : ''} out.`, { rules: ['CR 702.26b', 'CR 702.26g'], level: 'action' });
  if (st.until !== undefined && done.length > 0) {
    // CR 610.3: only the permanents asked to phase out wait for the event; what phased out with them (CR 702.26g) phases in with its host (rules/phasing.ts#phaseInPermanent)
    const own = hs.map((h) => h.id).filter((id) => done.includes(id));
    if (own.length > 0) {
      performUntilMove(g, {
        id: g.newEffectId(), source: { id: cx.source.id, zone: 'battlefield' }, controller: cx.controller, duration: st.until as Extract<Duration, { d: 'until' }>,
        objects: own.map((id) => ({ object: { id, zone: 'battlefield' as const }, back: 'battlefield' as const })), sourceName: g.nameOf(cx.source.id), phase: { tapped: st.tapped === true },
      });
    }
  }
  // edh-d-39 (CR 702.26b, 702.26g, 608.2c; Out of Time): "for each creature that phased out this way" counts the permanents the instruction itself phased out, not what phased out
  // with them (an Aura or Equipment attached to one, CR 702.26g); a permanent that was already phased out does not phase out again (rules/phasing.ts#phaseOutPermanent)
  return did(hs.filter((h) => done.includes(h.id)).length);
};

/**
 * edhn102 (CR 702.26b-c, 702.26g, 603.7; The Pandorica): "that permanent phases in". Only a permanent that is phased out and still the object the reference was made for (CR 400.7)
 * phases in; one that left the battlefield, or that "can't phase in" (statics/hooks.ts#phaseInDenied), stays as it is. Its tapped status is not touched; what phased out with it phases in too.
 */
export const phaseIn: StepHandler<Step<'phaseIn'>> = (cx, st) => {
  const g = cx.g;
  const hs = resolveObjs(cx, st.what).filter((h) => h.zone === 'battlefield' && isCurrent(cx, h) && g.s.objects[h.id]?.phasedOut === true);
  const done = hs.flatMap((h) => performPhaseIn(g, h.id));
  if (done.length > 0) g.log(`${done.map((id) => g.nameOf(id)).join(', ')} phase${done.length === 1 ? 's' : ''} in.`, { rules: ['CR 702.26b', 'CR 702.26c'], level: 'action' });
  return did(hs.filter((h) => done.includes(h.id)).length);
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
  bindAs(cx, st.as, done); // edh-combat-7 (CR 608.2c; Illusionist's Gambit): "those creatures" are the ones removed from combat
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
  if (st.what === 'lifePower') return exchangeLifeToughness(cx, st, 'power'); // edh-next-89
  if (st.what === 'sacrificeReturn') return exchangeSacrificeReturn(cx, st); // edh-zones-26
  if (st.what === 'power') return exchangePower(cx, st); // edh-c-13
  if (st.what === 'handLibrary') return exchangeHandLibrary(cx, st); // edh-b-12
  if (st.what === 'handGraveyard') return exchangeHandGraveyard(cx, st); // edh-c-113
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
    const got = proposeMeasured(cx, (delta > 0 ? { ev: 'life', change: 'gain', player: p, amount: delta, effectController: cx.controller } : { ev: 'life', change: 'loss', player: p, amount: Math.abs(delta) }) /* edh-d-54: Rain of Gore */);
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
export const LIFE_TOUGHNESS_OP_FORMS: readonly string[] = ['op:exchange.lifeToughness', 'op:exchange.lifePower' /* edh-next-89 */];
/** edh-mana-keywords-12 (CR 701.3a; Luxior): `op:attach.asCreature`, the Equipment attached to a non-creature "as though it were a creature" (`attachable`). */
export const ATTACH_OP_FORMS: readonly string[] = ['op:attach.asCreature', 'op:attach.hostAs'];

/** edh-next-89 (`op:exchange.lifePower`, CR 701.12a, 613.4b; Evra, Halcyon Witness): the same exchange with the creature's POWER (`stat`), the layer-7b effect setting its power. */
function exchangeLifeToughness(cx: ExecCtx, st: Step<'exchange'>, stat: 'toughness' | 'power' = 'toughness'): StepResult {
  const g = cx.g;
  const [p] = resolveRecipients(cx, st.a).players;
  const objs = actOn(cx, st.b as ObjRef).filter((h) => h.zone === 'battlefield');
  const o = objs.length === 1 ? g.s.objects[objs[0]!.id] : undefined;
  const t = o !== undefined ? ptNumbers(charsOfObject(g.s, o))[stat] : null;
  if (p === undefined || o === undefined || t === null) {
    g.log(`The life total and ${stat} are not exchanged: the player or the creature is no longer there.`, { rules: ['CR 701.12a'], level: 'info' });
    return NOTHING;
  }
  const life = g.player(p).life;
  const delta = t - life;
  if ((delta > 0 && playerRestricted(g.s, p, 'cantGainLife')) || (delta < 0 && playerRestricted(g.s, p, 'cantLoseLife'))) {
    g.log(`The life total and ${stat} are not exchanged: ${g.player(p).name} can't ${delta > 0 ? 'gain' : 'lose'} life.`, { rules: ['CR 701.12a', delta > 0 ? 'CR 119.7' : 'CR 119.8'], level: 'info' });
    return NOTHING;
  }
  if (delta !== 0) proposeMeasured(cx, (delta > 0 ? { ev: 'life', change: 'gain', player: p, amount: delta, effectController: cx.controller } : { ev: 'life', change: 'loss', player: p, amount: Math.abs(delta) }) /* edh-d-54: Rain of Gore */);
  performEffectRecord(g, {
    id: g.newEffectId(),
    source: { id: cx.source.id, zone: cx.source.zone },
    sourceName: g.nameOf(cx.source.id),
    controller: cx.controller,
    timestamp: g.newTimestamp(),
    startedTurn: g.s.turn.number,
    duration: { d: 'permanent' },
    effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id: o.id, zone: 'battlefield' }] }, mods: [{ layer: '7b', [stat]: life }] },
  });
  g.log(`${g.player(p).name} exchanges their life total (${life}) with the ${stat} of ${g.nameOf(o.id)} (${t}).`, { rules: ['CR 701.12a', 'CR 613.4b'], level: 'action' });
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

/** edh-b-12: the exchange form that swaps a player's hand and library (capability `op:exchange.handLibrary`). */
export const HAND_LIBRARY_OP_FORMS: readonly string[] = ['op:exchange.handLibrary', 'op:exchange.handGraveyard'];

/**
 * edh-b-12 (`op:exchange.handLibrary`; CR 701.12a, 400.1, 401.1; Mordenkainen): "Exchange your hand and library": each card in the player's hand is put into their library and each
 * card in their library is put into their hand, together (both groups are fixed before any card moves; the library is not shuffled until the shuffle step that follows, CR 401.2:
 * the cards put into it keep no order the player chose). `a` is the one player. Each move goes through the pipeline, so a replacement of one card changes only that card.
 */
function exchangeHandLibrary(cx: ExecCtx, st: Step<'exchange'>): StepResult {
  const g = cx.g;
  const players = [...new Set(resolveRecipients(cx, st.a as PlayerRef).players)];
  if (players.length !== 1) return NOTHING;
  const player = players[0]!;
  const hand = [...zoneArray(g, 'hand', player)];
  const library = [...zoneArray(g, 'library', player)];
  let count = 0;
  for (const id of hand) if (proposeMove(cx, { id, zone: 'hand' }, 'library', { cause: 'effect', position: 'top' }).ok) count++;
  for (const id of library) if (proposeMove(cx, { id, zone: 'library' }, 'hand', { cause: 'effect' }).ok) count++;
  g.log(`${g.player(player).name} exchanges their hand and library (${hand.length} and ${library.length} cards).`, { rules: ['CR 701.12a'], level: 'action' });
  return { performed: count > 0, count };
}

/**
 * edh-c-113 (`op:exchange.handGraveyard`; CR 701.12a, 400.1, 404.1; Harness Infinity): "Exchange your hand and graveyard": each card in the player's hand is put into their graveyard
 * (put, not discarded: no discard trigger) and each card in their graveyard is put into their hand, together (both groups are fixed before any card moves). `a` is the one player.
 */
function exchangeHandGraveyard(cx: ExecCtx, st: Step<'exchange'>): StepResult {
  const g = cx.g;
  const players = [...new Set(resolveRecipients(cx, st.a as PlayerRef).players)];
  if (players.length !== 1) return NOTHING;
  const player = players[0]!;
  const hand = [...zoneArray(g, 'hand', player)];
  const graveyard = [...zoneArray(g, 'graveyard', player)];
  let count = 0;
  for (const id of hand) if (proposeMove(cx, { id, zone: 'hand' }, 'graveyard', { cause: 'effect' }).ok) count++;
  for (const id of graveyard) if (proposeMove(cx, { id, zone: 'graveyard' }, 'hand', { cause: 'effect' }).ok) count++;
  g.log(`${g.player(player).name} exchanges their hand and graveyard (${hand.length} and ${graveyard.length} cards).`, { rules: ['CR 701.12a'], level: 'action' });
  return { performed: count > 0, count };
}

/** edh-c-13: the exchange form that swaps the powers of two creatures (capability `op:exchange.power`). */
export const POWER_OP_FORMS: readonly string[] = ['op:exchange.power'];

/**
 * edh-c-13 (`op:exchange.power`; CR 701.12a, 613.4b, 611.2a; Serene Master): "Exchange its power and the power of target creature it's blocking until end of combat." Each creature's
 * power becomes the other's power as the step runs (both read before either changes): two layer-7b settings of the step's duration. If either is no longer a creature on the battlefield
 * (a target that became illegal, 608.2b) or its power can't be determined, no part of the exchange happens (CR 701.12a).
 */
function exchangePower(cx: ExecCtx, st: Step<'exchange'>): StepResult {
  const g = cx.g;
  const [ha] = actOn(cx, st.a as ObjRef).filter((h) => h.zone === 'battlefield');
  const [hb] = actOn(cx, st.b as ObjRef).filter((h) => h.zone === 'battlefield');
  const oa = ha !== undefined ? g.s.objects[ha.id] : undefined;
  const ob = hb !== undefined ? g.s.objects[hb.id] : undefined;
  const pa = oa !== undefined ? ptNumbers(charsOfObject(g.s, oa)).power : null;
  const pb = ob !== undefined ? ptNumbers(charsOfObject(g.s, ob)).power : null;
  if (oa === undefined || ob === undefined || oa.id === ob.id || pa === null || pb === null || !charsOfObject(g.s, oa).types.includes('Creature') || !charsOfObject(g.s, ob).types.includes('Creature')) {
    g.log('The powers are not exchanged: a creature is no longer there.', { rules: ['CR 701.12a', 'CR 608.2b'], level: 'info' });
    return NOTHING;
  }
  const timestamp = g.newTimestamp(); // CR 613.7b: created together
  for (const [o, power] of [[oa, pb], [ob, pa]] as const) {
    performEffectRecord(g, {
      id: g.newEffectId(),
      source: { id: cx.source.id, zone: cx.source.zone },
      sourceName: g.nameOf(cx.source.id),
      controller: cx.controller,
      timestamp,
      startedTurn: g.s.turn.number,
      duration: st.duration ?? { d: 'permanent' },
      effect: { s: 'continuous', affects: { ref: 'fixed', objects: [{ id: o.id, zone: 'battlefield' }] }, mods: [{ layer: '7b', power }] },
    });
  }
  g.log(`${g.nameOf(oa.id)} (${pa}) and ${g.nameOf(ob.id)} (${pb}) exchange their powers.`, { rules: ['CR 701.12a', 'CR 613.4b'], level: 'action' });
  return { performed: true, count: 2 };
}

/** edh-zones-26: the exchange form this module runs besides control, life and life/toughness (capability `op:exchange.sacrificeReturn`). */
export const SACRIFICE_RETURN_OP_FORMS: readonly string[] = ['op:exchange.sacrificeReturn'];

/**
 * edh-zones-26 (`op:exchange.sacrificeReturn`; CR 701.21a, 400.7, 608.2b, 608.2c; Goblin Welder): "If both targets are still legal as this ability resolves, that player
 * simultaneously sacrifices the artifact and returns the artifact card to the battlefield." `a` is the permanent, `b` the card announced in a graveyard of the controller of `a`
 * (ruling 2008-08-01: if either target became illegal, nothing is sacrificed and nothing returns). Legal means the card is still in the graveyard of the player who controls the
 * permanent now (the second target's `owner` reads the controller of the first as the ability resolves too). That player sacrifices it (not destruction: indestructible and
 * regeneration don't apply; "can't be sacrificed" keeps both where they are, as nothing is half-done) and the card enters under their control, the leave-the-battlefield and enter
 * events of the one step being one batch (CR 603.10a; the sacrifice is looked back on with the return, core/zones.ts#leavingTogether).
 */
function exchangeSacrificeReturn(cx: ExecCtx, st: Step<'exchange'>): StepResult {
  const g = cx.g;
  const [perm] = permanentsOf(cx, st.a as ObjRef);
  const [card] = actOn(cx, st.b as ObjRef);
  if (perm === undefined || card === undefined || card.zone !== 'graveyard') {
    g.log('Nothing is sacrificed and nothing returns: a target is no longer legal.', { rules: ['CR 608.2b'], level: 'info' });
    return NOTHING;
  }
  const player = controllerOf(g.s, perm.id);
  if (g.s.objects[card.id]?.owner !== player) {
    g.log(`Nothing is sacrificed and nothing returns: ${g.nameOf(card.id)} is not in ${g.player(player).name}'s graveyard.`, { rules: ['CR 608.2b', 'CR 115.1'], level: 'info' });
    return NOTHING;
  }
  // CR 609.3: an effect that can only do part of what it says does that part. A permanent that can't be sacrificed stays; the card still returns.
  const cant = costUseDenial(g.s, player, perm.id, 'sacrifice', undefined, false, cx.source.id); // edh-next-69: caused by the ability (Sigarda)
  if (cant) g.log(`${g.player(player).name} can't sacrifice ${g.nameOf(perm.id)}. ${cant.message}`, { rules: ['CR 701.21a', 'CR 101.2', 'CR 609.3'], level: 'info' });
  let count = 0;
  leavingTogether(g, [perm.id], () => {
    const sacrificed = cant ? { ok: false } : proposeMove(cx, perm, 'graveyard', { cause: 'sacrifice' });
    if (sacrificed.ok) {
      count++;
      g.log(`${g.player(player).name} sacrifices ${g.nameOf(perm.id)}.`, { rules: ['CR 701.21a'], level: 'action' });
    }
    const returned = proposeMove(cx, card, 'battlefield', { controller: player, viaSource: cx.source.id, cause: 'effect' });
    if (returned.ok) count++;
  });
  return { performed: count > 0, count };
}
