/**
 * Timing permissions (CR 117.1) and summoning sickness (CR 302.6). Each check returns a Denial
 * or null so it serves both the action handlers (which throw) and legalActions (which filter).
 */
import type { ActivatedAbilityDef } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameObject, GameState } from '../types/state';
import { deny, type Denial } from './denial';
import { charsOfObject, hasKeyword, type Chars } from './characteristics';
import { gameOf, hookpoints } from './hookpoints';
import { activatesAsUnactivated, additionalActivations } from '../statics/hooks';

export const isMainPhase = (s: GameState): boolean => s.turn.step === 'main1' || s.turn.step === 'main2';

/**
 * Sorcery timing (CR 117.1a, 307.1): the player's own main phase with an empty stack.
 * `what` is "cast a sorcery" / "play a land" etc. for the message.
 */
export function sorceryTiming(s: GameState, player: PlayerId, what: string, rule: string): Denial | null {
  if (s.turn.activePlayer !== player) return deny(`You can only ${what} during your own turn.`, rule, 'CR 117.1a');
  if (!isMainPhase(s)) return deny(`You can only ${what} during your main phase.`, rule, 'CR 117.1a');
  if (s.zones.stack.length > 0) return deny(`You can only ${what} when the stack is empty.`, rule, 'CR 117.1a');
  return null;
}

/** Whether a spell with these characteristics may be cast now (CR 117.1a): instants and flash any time, others at sorcery timing. */
export function castTiming(s: GameState, player: PlayerId, spell: ObjectId, c: Chars): Denial | null {
  if (c.types.includes('Instant')) return null; // CR 304.1
  if (hookpoints.castsAsInstant(gameOf(s), spell, player, c)) return null; // flash, CR 702.8a, and "as though it had flash" (rules/hookpoints.ts)
  const kind = c.types.includes('Sorcery') ? 'a sorcery' : 'a spell that is not an instant and has no flash';
  return sorceryTiming(s, player, `cast ${kind}`, c.types.includes('Sorcery') ? 'CR 307.1' : 'CR 117.1a');
}

/** The turn number on which the player's most recent turn began (CR 302.6). */
function recentTurn(s: GameState, player: PlayerId): number {
  return s.players.find((p) => p.id === player)?.lastTurnStarted ?? s.turn.number;
}

/**
 * CR 302.6 / 602.5a: a creature can't use {T} or {Q} abilities unless it has been under its controller's
 * control continuously since their most recent turn began. Haste ignores this (CR 702.10b).
 * `controlledSinceTurn` is the number of the turn during which control began (after that turn began).
 */
export function isSummoningSick(s: GameState, o: GameObject, c: Chars): boolean {
  if (!c.types.includes('Creature')) return false;
  if (!hookpoints.summoningSick(gameOf(s), o.id, o.controller, c)) return false; // haste, CR 702.10b, and "as though it had haste" (rules/hookpoints.ts)
  return o.controlledSinceTurn >= recentTurn(s, o.controller);
}

/**
 * r4-fxz (CR 302.6, 602.5a, 609.4): summoning sickness for the {T} / {Q} abilities of the object: as `isSummoningSick`, unless a permission lets its controller
 * activate its abilities as though it had haste ("You may activate abilities of creatures you control as though those creatures had haste"); attacking is not
 * affected (rules/combat-rules.ts reads `isSummoningSick`).
 */
export function isSummoningSickToActivate(s: GameState, o: GameObject, c: Chars): boolean {
  return isSummoningSick(s, o, c) && !hookpoints.activatesAsThoughHaste(gameOf(s), o.id, o.controller, c);
}

/** Timing and per-turn restrictions of an activated ability (CR 117.1b, 602.5, 606.3). Mana abilities are never restricted by timing. */
export function abilityTiming(s: GameState, player: PlayerId, source: GameObject, key: string, def: ActivatedAbilityDef): Denial | null {
  if (def.isMana) return null; // CR 605.3a
  if (def.isLoyalty || def.cost.loyalty !== undefined) {
    // r4-mech (CR 606.3): "you may activate loyalty abilities of ... any time you could cast an instant" lifts the timing, never the one-each-turn limit
    const d = hookpoints.loyaltyAsInstant(gameOf(s), source.id, player) ? null : sorceryTiming(s, player, 'activate a loyalty ability', 'CR 606.3');
    if (d) return d;
    if ((s.turnActivations[`${source.id}|loyalty`] ?? 0) > 0) return deny('Only one loyalty ability of each permanent can be activated each turn.', 'CR 606.3');
  }
  return activationRestrictionDenial(s, player, source, key, def);
}

/**
 * FAST5X E5 INTERFACE CHANGE (additive): the printed restrictions of an activated ability, "Activate only as a sorcery" (CR 602.5d) and "Activate only once
 * each turn" / "only once" (CR 602.5b), split out of `abilityTiming` so a mana ability honors them too: a mana ability may be activated whenever its controller
 * has priority or is paying (CR 605.3a), but it is still an activated ability (CR 605.1a) and keeps the restrictions it prints (rules/mana.ts#manaAbilityDenial).
 */
export function activationRestrictionDenial(s: GameState, player: PlayerId, source: GameObject, key: string, def: ActivatedAbilityDef): Denial | null {
  if (def.sorcerySpeed) {
    const d = sorceryTiming(s, player, 'activate this ability', 'CR 602.5d');
    if (d) return d;
  }
  // "Activate only once each turn." (CR 602.5b), and "only once" per game (exhaust, CR 702.177a): counted on the object, so a new object (CR 400.7) has its use back.
  // A limit per combat needs a combat number the state does not keep yet: such an ability is not offered (it fails closed) rather than being usable without limit.
  const limit = def.limit;
  if (limit && limit.per === 'combat') return deny('This engine build cannot track an activation limit "combat" yet, so the ability is not offered.', 'CR 602.5b');
  // r3-static (CR 602.5b): "Each power-up ability of permanents you control can be activated an additional time" raises the per-game limit of such an ability
  const gameMax = limit?.per === 'game' ? limit.max + additionalActivations(s, source.id, def.keyword) : 0;
  // std-rx27 (CR 602.5b, 702.177a): "you may activate exhaust abilities as though they haven't been activated" lifts that per-game limit while it applies
  if (limit?.per === 'game' && (Number(source.chosen?.[`limit:${key}`] ?? 0) || 0) >= gameMax && !activatesAsUnactivated(s, player, source.id, def.keyword)) {
    // FAST1 T4: an exhaust ability (`keyword`, CR 702.177a) says so
    const what = def.keyword !== undefined ? `This ${def.keyword} ability` : 'This ability';
    return deny(gameMax === 1 ? `${what} can be activated only once.` : `${what} can be activated only ${gameMax} times.`, 'CR 602.5b', 'CR 702.177a');
  }
  // p2-misc-1 (CR 602.5b, 702.142a; unverified): "Creatures you control can boast twice during each of your turns rather than once" raises the per-turn limit too
  const turnMax = limit?.per === 'turn' ? limit.max + additionalActivations(s, source.id, def.keyword) : 0;
  if (limit?.per === 'turn' && (s.turnActivations[`${source.id}|${key}`] ?? 0) >= turnMax) {
    return deny(turnMax === 1 ? 'This ability can be activated only once each turn.' : `This ability can be activated only ${turnMax} times each turn.`, 'CR 602.5b');
  }
  return null;
}

/**
 * CR 702.61a: while a spell with split second is on the stack, players can't cast spells or activate abilities that aren't
 * mana abilities (special actions and mana abilities are fine, CR 702.61b).
 */
export function splitSecondDenial(s: GameState): Denial | null {
  for (const id of s.zones.stack) {
    const o = s.objects[id];
    if (!o || o.kind === 'ability') continue;
    const c = charsOfObject(s, o);
    if (hasKeyword(c, 'split second')) return deny(`${c.name} has split second: nobody can cast spells or activate abilities that aren't mana abilities while it is on the stack.`, 'CR 702.61a');
  }
  return null;
}
