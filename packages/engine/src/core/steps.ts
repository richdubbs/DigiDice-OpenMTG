/**
 * Turn-based actions at the start and end of steps (CR 703, 502-514).
 */
import { hasSimpleDuration, type ManaUnit, type Step } from '../types/state';
import type { Game } from './game';
import { zoneArray, moveObject } from './zones';
import { performStateBasedActions } from './sba';
import { beginCombat, declareAttackers, declareBlockers } from './combat';
import { combatDamageStep } from './combat-damage';
import { collectPendingTriggers } from './triggers';
import { damageKeptInCleanup, mayNotUntap, maxHandSize, unspentManaRules, untapLimits, untapPrevented, untapsDuringOthersUntapStep } from '../statics/hooks';
import type { ManaType } from '../types/mana';
import type { PlayerId } from '../types/ids';
import { cantDo } from '../rules/cant';
import { phaseInForUntapStep } from '../rules/phasing';
import { stunInsteadOfUntap } from '../rules/status';
import { expireAfterUntapStep, expireSimple } from './durations';
import { syncControl } from './control';
import { initiativeUpkeep, monarchEndStep } from './designations';
import { TURN_BASED } from './registries';
import { fixAllowedAttackers } from './turn-effects';
import { proposeNested } from '../effects/nested';
import { playerControlAtCombatEnd } from './player-control';

/**
 * Perform the turn-based actions for the beginning of a step.
 * Returns whether players receive priority in this step (CR 117.3a, 500.3).
 */
export function beginStepTurnBasedActions(g: Game, step: Step): boolean {
  const ap = g.s.turn.activePlayer;
  // M12-2 (m12 design D12, E12; CR 800.4j): the active player left the game during their turn, which goes on without an active player: the turn-based
  // actions of the active player (untap, CR 502.3; the draw, 504.1; the cleanup discard, 514.1) don't happen; the others still do (CR 514.2)
  const noActive = g.player(ap).hasLost;
  switch (step) {
    case 'untap': {
      if (noActive) return false; // CR 502.4: no player receives priority during the untap step
      // CR 502.1: phased-out permanents phase in first (WP14 INTERFACE CHANGE: the `phaseOut` op needs it; the phasing keyword itself and day/night 502.2: later).
      phaseInForUntapStep(g, ap);
      for (const f of TURN_BASED.untapSecondPart) f(g); // M6-0 (m6 design 2.6): CR 502.2, day and night (M6-4, core/day-night.ts); empty in M6-0
      // CR 502.3: the active player untaps all their permanents, except those effects keep from untapping (WP16: statics/hooks.ts#untapPrevented).
      // First determine which permanents will untap, then untap them all simultaneously.
      const untapping: string[] = [];
      for (const id of g.s.zones.battlefield) {
        const o = g.obj(id);
        if (!o.tapped || o.phasedOut) continue;
        if (o.controller !== ap) {
          // T20 (FAST4): "Untap ~ during each other player's untap step" (rule modification, statics/hooks.ts): it untaps with the active player's
          // permanents, simultaneously (CR 502.3), unless it can't untap
          const other = untapsDuringOthersUntapStep(g.s, id);
          if (other?.kept) g.log(`${g.nameOf(id)} doesn't untap. ${other.kept.message}`, { rules: ['CR 502.3', ...other.kept.rules] });
          else if (other) untapping.push(id);
          continue;
        }
        const kept = untapPrevented(g.s, id);
        if (kept) g.log(`${g.nameOf(id)} doesn't untap. ${kept.message}`, { rules: ['CR 502.3', ...kept.rules] });
        else untapping.push(id);
      }
      // std-rx13 (CR 502.3): "You may choose not to untap ~ during your untap step": the active player chooses, once for all such permanents of theirs, which of
      // them stay tapped, before the permanents untap simultaneously
      const optional = untapping.filter((id) => g.obj(id).controller === ap && mayNotUntap(g.s, id));
      if (optional.length > 0) {
        const kept = g.choose({ kind: 'chooseObjects', player: ap, prompt: 'Choose any permanents not to untap during your untap step.', options: optional, min: 0, max: optional.length, rules: ['CR 502.3'] }).ids;
        for (const id of kept) {
          g.log(`${g.player(ap).name} chooses not to untap ${g.nameOf(id)}.`, { rules: ['CR 502.3'] });
          untapping.splice(untapping.indexOf(id), 1);
        }
      }
      // p2-player-rules-1 (CR 502.3): "Players can't untap more than one land during their untap steps": of the active player's own permanents a limit counts,
      // they choose, one at a time, which untap, among those every limit still allows (each limit counts the permanents chosen so far); the rest stay tapped
      const limits = untapLimits(g.s, ap);
      if (limits.length > 0) {
        const own = untapping.filter((id) => g.obj(id).controller === ap);
        const limited = own.filter((id) => limits.some((l) => l.counts(id)));
        const chosen: string[] = [];
        const allowed = (id: string): boolean => limits.every((l) => !l.counts(id) || chosen.filter((c) => l.counts(c)).length < l.max);
        for (;;) {
          const options = limited.filter((id) => !chosen.includes(id) && allowed(id));
          if (options.length === 0) break;
          const pick = options.length === 1 ? options : g.choose({ kind: 'chooseObjects', player: ap, prompt: 'Choose a permanent to untap during your untap step.', options, min: 1, max: 1, rules: ['CR 502.3'] }).ids;
          chosen.push(pick[0]!);
        }
        for (const id of limited) {
          if (chosen.includes(id)) continue;
          g.log(`${g.nameOf(id)} doesn't untap (no more of these permanents can untap during this untap step).`, { rules: ['CR 502.3'] });
          untapping.splice(untapping.indexOf(id), 1);
        }
      }
      for (const id of untapping) {
        if (stunInsteadOfUntap(g, id)) continue; // CR 122.1d: a stun counter is removed instead (T20)
        g.obj(id).tapped = false;
        g.emit({ type: 'untapped', objectId: id, untapStep: true }); // r5-trig: "you untap one or more permanents during your untap step" (CR 502.3)
      }
      expireAfterUntapStep(g, ap); // MX5: "doesn't untap during its controller's next untap step" ends with this untap step (CR 502.3, 611.2a)
      return false; // CR 502.4: no player receives priority during the untap step.
    }
    case 'upkeep':
      initiativeUpkeep(g); // MX4, CR 726.2: "At the beginning of the upkeep of the player who has the initiative, that player ventures into Undercity."
      return true;
    case 'draw':
      if (noActive) return true; // M12-2: CR 800.4j
      // CR 504.1, 121.2, 614.1a, 614.6: the draw of the draw step is an event that replacement effects may replace ("If you would draw a card, ... instead":
      // Thought Reflection, dredge, Laboratory Maniac), so it is proposed through the replacement pipeline like every other draw (effects/handlers/cards-draw.ts);
      // "can't draw" is the pipeline's CR 614.17 check. M6-10 fix: the draw step drew directly, so no replacement effect ever saw that draw.
      // Cloud r4-repl (CR 121.2, 614.1a): the step's draw of one card is a draw of "one or more cards" too (effects/proposal-kinds/draw-many.ts), proposed first
      {
        // r5-repl (CR 504.1): where the cards drawn in this draw step begin ("except the first one you draw in each of your draw steps", effects/replacements.ts)
        g.player(ap).turnStats.drawStepFrom = g.player(ap).turnStats.cardsDrawn;
        const many = proposeNested(g, { ev: 'drawMany', player: ap, count: 1 })?.event;
        const k = many?.ev === 'drawMany' ? many.count : 0;
        for (let i = 0; i < k; i++) proposeNested(g, { ev: 'draw', player: ap });
      }
      return true;
    case 'main1':
      for (const f of TURN_BASED.precombatMainBegins) f(g); // M6-0 (m6 design 2.6): CR 714.3c, the lore counter of Sagas (M6-6, core/lore.ts); empty in M6-0
      return true;
    case 'beginCombat':
      beginCombat(g); // CR 507
      return true;
    case 'declareAttackers':
      fixAllowedAttackers(g); // std-rq (CR 500.8, 508.1c): "Only land creatures can attack during that combat phase"
      declareAttackers(g); // CR 508.1
      return true;
    case 'declareBlockers':
      declareBlockers(g); // CR 509.1
      return true;
    case 'combatDamage':
      combatDamageStep(g); // CR 510.1-510.2
      return true;
    case 'end':
      monarchEndStep(g); // CR 725.2: "At the beginning of the monarch's end step, that player draws a card."
      return true;
    case 'cleanup':
      return cleanup(g, noActive);
    default:
      return true;
  }
}

/** CR 514: cleanup step. */
function cleanup(g: Game, noActive = false): boolean {
  const ap = g.s.turn.activePlayer;
  const p = g.player(ap);
  const hand = noActive ? [] : zoneArray(g, 'hand', ap); // M12-2: CR 800.4j, nobody discards for an active player who left (their hand left with them)
  const max = maxHandSize(g.s, ap); // CR 402.2: normally seven; rule modifications change it or remove it (null: no maximum; WP16)
  // WP31: "can't discard" (CR 101.2) is asked for each card, the card being its `other` ("you can't discard creature cards"); the player discards as many of the
  // others as the rule asks for, and a hand that can't come down to its maximum stays above it.
  const over = max !== null && hand.length > max ? hand.length - max : 0;
  const options = over > 0 ? hand.filter((id) => cantDo(g.s, 'discard', ap, id) === null) : [];
  const cantDiscard = over > options.length ? hand.map((id) => cantDo(g.s, 'discard', ap, id)).find((d) => d !== null) ?? null : null;
  if (cantDiscard) g.log(`${p.name} can't discard ${options.length === 0 ? 'cards' : 'some of these cards'}, so the hand stays above its maximum size. ${cantDiscard.message}`, { rules: ['CR 514.1', 'CR 101.2'], level: 'info' });
  const n = Math.min(over, options.length);
  if (max !== null && n > 0) {
    const ans = n < over ? { ids: options } : g.choose({ // every card that may be discarded goes: nothing to choose
      kind: 'chooseObjects',
      player: ap,
      prompt: `Discard ${n} card${n === 1 ? '' : 's'} (maximum hand size is ${max}).`,
      options,
      min: n,
      max: n,
      rules: ['CR 514.1'],
    });
    for (const id of ans.ids) {
      const name = g.nameOf(id);
      moveObject(g, id, 'graveyard', { cause: 'discard' });
      g.log(`${p.name} discards ${name} to hand size.`, { rules: ['CR 514.1', 'CR 701.9'] });
    }
  }
  // CR 514.2: remove all damage, end "until end of turn" and "this turn" effects (simultaneously).
  for (const id of g.s.zones.battlefield) {
    const o = g.obj(id);
    // r4-mech (CR 514.2): "Damage isn't removed from this creature during cleanup steps"
    if (o.damage > 0 && damageKeptInCleanup(g.s, id)) g.log(`Damage isn't removed from ${g.nameOf(id)}.`, { rules: ['CR 514.2'], level: 'info' });
    else o.damage = 0;
    o.deathtouchDamaged = false;
    // FAST5X E3, CR 702.171b-c: a permanent stays saddled until the end of the turn; "the creatures that saddled it this turn" are this turn's
    if (o.saddled !== undefined) delete o.saddled;
    if (o.saddledBy !== undefined) delete o.saddledBy;
    if (o.crewedBy !== undefined) delete o.crewedBy; // r5-fxb (CR 702.122): "the creatures that crewed it this turn" are this turn's
  }
  g.s.continuousEffects = g.s.continuousEffects.filter((e) => !hasSimpleDuration(e, 'endOfTurn'));
  // Review of wave 6 line trig (CR 514.2, 613.1b, 514.3a): a control-changing effect that ended above gives control back now, so a trigger on that change
  // ("Whenever an opponent gains control of a permanent from you", Zidane, Tantalus Thief) is waiting in this cleanup step, not collected in the next turn
  syncControl(g);
  // CR 514.3a: if SBAs would be performed or triggers are waiting, players get priority and
  // another cleanup step follows. (Triggers caused by the discard above are collected now, or they would not count as waiting.)
  // std-rx32 (CR 603.7b, 514.2): the delayed triggers "this turn" still see what happens in this cleanup step (the control a "until end of turn" effect gave back:
  // "When you lose control of that Equipment this turn, ...", Stolen Uniform); they end after the triggers are collected
  collectPendingTriggers(g);
  expireSimple(g, 'endOfTurn'); // the delayed triggers "this turn" (CR 603.7b) and the manual chips that last until end of turn
  const sba = performStateBasedActions(g);
  if (sba || g.s.pendingTriggers.length > 0) {
    g.s.turn.cleanupAgain = true;
    return true;
  }
  return false;
}

/** FAST5 MX6: the combat steps whose end does not lose mana that lasts "until end of combat" (CR 506.1; the end of combat step ends the combat phase). */
const COMBAT_STEPS_BEFORE_END: ReadonlySet<Step> = new Set<Step>(['beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage']);

/** Things that happen as a step ends (CR 500.5): effects expire, then mana pools empty. */
export function endOfStepCleanup(g: Game, step: Step): void {
  if (step === 'endCombat') endCombatPhase(g);
  // FAST5 MX6: mana that lasts "until end of combat" (firebending, CR 702.189a) survives the end of every combat step but the end of combat step
  const keepCombat = COMBAT_STEPS_BEFORE_END.has(step);
  for (const p of g.s.players) {
    if (p.manaPool.length === 0) continue;
    // FAST5X E19 (CR 106.4, 500.5, 614.1): mana a rule says the player doesn't lose stays; the rest is lost, or becomes another type instead and stays
    const rules = unspentManaRules(g.s, p.id);
    // std-mkm: mana that lasts "until end of turn" survives the end of every step and phase but the cleanup step (CR 514.2: the effect ends during it, CR 500.5)
    const kept = (u: ManaUnit): boolean => (keepCombat && u.keep === 'endOfCombat') || (step !== 'cleanup' && u.keep === 'endOfTurn') || rules.keepAll || rules.keepTypes.includes(u.type);
    const stays = p.manaPool.filter(kept);
    const lost = p.manaPool.filter((u) => !kept(u));
    const into = lost.length === 0 ? undefined : becomesType(g, p.id, rules.becomes);
    p.manaPool = into === undefined ? stays : [...stays, ...lost.map((u) => ({ ...u, type: into }))]; // CR 500.5, 106.4
  }
}

/** CR 616.1: the type the player's lost mana becomes; when several replacement effects say different types, the affected player chooses which applies. */
function becomesType(g: Game, player: PlayerId, types: readonly ManaType[]): ManaType | undefined {
  if (types.length <= 1) return types[0];
  const id = g.choose({ kind: 'chooseOption', player, prompt: 'Your unspent mana would be lost: choose what it becomes instead.', min: 1, max: 1, rules: ['CR 616.1', 'CR 106.4'],
    options: types.map((t) => ({ id: t, label: `{${t}}` })) }).ids[0];
  return types.find((t) => t === id) ?? types[0];
}

/** CR 500.5a / 506.4: the combat phase is over: "until end of combat" effects expire and creatures stop being attacking/blocking (also when an effect ends the turn, CR 724.1d). */
export function endCombatPhase(g: Game): void {
  g.s.continuousEffects = g.s.continuousEffects.filter((e) => !hasSimpleDuration(e, 'endOfCombat'));
  expireSimple(g, 'endOfCombat');
  g.s.combat = null;
  playerControlAtCombatEnd(g); // std-control-3 (CR 723.1, 500.5a): "during their next combat phase" ends with it
}
