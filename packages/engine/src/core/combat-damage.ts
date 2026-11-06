/**
 * The combat damage step (CR 510): assignment (510.1), dealing (510.2), and the extra step for first strike and double strike (CR 510.4).
 *
 * This edition of the rules has no damage assignment order (CR 510.1c-d): a creature with several blockers (or blocked by several) divides
 * its damage as its controller chooses. A creature with trample first has to assign lethal damage to everything blocking it before any damage
 * goes to the player / planeswalker / battle it attacks (CR 702.19b), and deathtouch makes 1 damage lethal (CR 702.2c). The player is asked
 * (an `assignDamage` decision) only when there is a real choice; otherwise the damage is assigned automatically.
 */
import type { ObjectId, PlayerId } from '../types/ids';
import type { AttackerState } from '../types/state';
import { charsOfObject, hasKeyword, ptNumbers, type Chars } from '../rules/characteristics';
import { dealSimultaneousDamage, settleLifelink, type LifelinkLedger } from '../rules/damage';
import { hasBanding } from '../rules/combat-rules';
import { assignsCombatDamageAsToughness, assignsNegativePowerAsPositive, assignsNoCombatDamage, lethalThreshold, mayAssignAsUnblocked, mustAssignAsUnblocked } from '../statics/hooks';
import type { Game } from './game';
import type { GameEvent } from '../types/events';
import { commanderCardOf } from '../statics/commander';
import { addCommanderDamage, commanderName } from './commander-damage';

/**
 * M11-1 (m11 design 2), CR 903.10a, 704.6c, 702.124d: combat damage a commander deals to a player is added to that player's tally for that commander CARD
 * (`PlayerState.commanderDamage`, whoever controls the commander; a melded or merged commander counts for its commander card, CR 903.3b-c), and a
 * `commanderDamage` event follows right after the `damageDealt` event it counts. The damage actually dealt is counted (after prevention and redirection,
 * CR 615, 614.9), from infect too (it is still combat damage dealt, CR 120.3b). Noncombat damage never counts. Not in a variant without the rule
 * (`damageLimit: null`: Brawl, CR 903.12h; Duel Commander). The listener is installed once per run (a run is one action), as a combat damage step is reached.
 *
 * Review finding 2 (CR 400.2, 708.2): the damage of a FACE-DOWN commander is kept private on the permanent (core/commander-damage.ts) and only its controller
 * is told, by a private text on the damage's own log line (`notePrivately`), so the other players learn nothing a face-down permanent would not show.
 */
const TALLYING = new WeakSet<Game>();
interface PrivateNote { from: number; target: string; controller: PlayerId; text: string }
const NOTES = new WeakMap<Game, PrivateNote[]>();
function tallyCommanderDamage(g: Game): void {
  const opts = g.s.options.commander;
  if (opts === undefined || opts.damageLimit === null || TALLYING.has(g)) return;
  TALLYING.add(g);
  g.onEvent((game: Game, e: GameEvent) => {
    if (e.type !== 'damageDealt' || !e.combat || e.amount <= 0) return;
    const p = game.s.players.find((x) => x.id === e.target);
    if (!p) return;
    const live = game.s.objects[e.source];
    const src = live ?? game.s.lki[e.source]?.object;
    const card = src ? commanderCardOf(game.s, src) : undefined;
    if (card === undefined) return;
    if (live && live.zone === 'battlefield' && live.faceDown) {
      const hidden = { ...live.hiddenCommanderDamage, [p.id]: (live.hiddenCommanderDamage?.[p.id] ?? 0) + e.amount };
      live.hiddenCommanderDamage = hidden;
      const total = (p.commanderDamage?.[card] ?? 0) + hidden[p.id]!;
      const notes = NOTES.get(game) ?? [];
      notes.push({ from: game.s.log.length, target: p.name, controller: live.controller, text: `(Your face-down commander ${commanderName(game.s, card)}: ${total} commander damage to ${p.name} in total; CR 903.10a.)` });
      NOTES.set(game, notes);
      return;
    }
    const total = addCommanderDamage(game, p.id, card, e.source, e.amount);
    game.log(`${game.nameOf(e.source)} has dealt ${total} combat damage to ${p.name} as a commander.`, { rules: ['CR 903.10a'], level: 'info' });
  });
}

/** Review finding 2: the controller of a face-down commander reads its commander damage on the damage's log line (a private text, CR 400.2). */
function notePrivately(g: Game): void {
  const notes = NOTES.get(g);
  if (!notes) return;
  NOTES.delete(g);
  for (const n of notes) {
    const entry = g.s.log.slice(n.from).find((l) => l.privateText === undefined && l.text.includes(`combat damage to ${n.target}`));
    if (entry) entry.privateText = { players: [n.controller], text: `${entry.text} ${n.text}` };
  }
}

interface Assignment {
  target: ObjectId | PlayerId;
  amount: number;
}

/** Stands in for "no limit" when the engine can't evaluate a toughness ("*", milestone 6): that creature never takes trample excess. */
const UNKNOWN = Number.MAX_SAFE_INTEGER;

/** CR 702.19b: damage that is lethal for assignment, taking into account damage marked and damage assigned by other creatures in this step. */
function lethalFor(g: Game, target: ObjectId, deathtouch: boolean, assigned: Map<string, number>): number {
  const o = g.maybeObj(target);
  if (!o) return 0;
  const toughness = lethalThreshold(g.s, o.id, charsOfObject(g.s, o)); // edh-next-145 (CR 702.19b, 120.6): the power instead when a rule says so (Zilortha)
  const room = toughness === null ? UNKNOWN : Math.max(0, toughness - o.damage - (assigned.get(target) ?? 0));
  return deathtouch ? Math.min(1, room) : room; // CR 702.2c
}

function askAssignment(g: Game, source: ObjectId, c: Chars, power: number, recipients: ObjectId[], defender: PlayerId | ObjectId | null, trample: boolean, assigned: Map<string, number>, chooser?: PlayerId, overPw?: OverPlaneswalker): Assignment[] {
  const deathtouch = hasKeyword(c, 'deathtouch');
  const list: { id: ObjectId | PlayerId; lethal: number; trampleTarget?: boolean; attacked?: true }[] = recipients.map((id) => ({ id: id as ObjectId | PlayerId, lethal: overPw !== undefined && id === overPw.walker ? Math.max(lethalFor(g, id, deathtouch, assigned), overPw.room) : lethalFor(g, id, deathtouch, assigned) }));
  // edh-d-90 (CR 702.19c): trample over planeswalkers: the planeswalker attacked (lethal: its loyalty left), then its controller, the trample target
  if (overPw !== undefined) {
    if (!recipients.includes(overPw.walker)) list.push({ id: overPw.walker, lethal: overPw.room, attacked: true }); // a planeswalker that also blocks is a blocker of the list (Thrasta ruling 2021-06-18)
    list.push({ id: overPw.controller, lethal: 0, trampleTarget: true });
  } else if (trample && defender !== null) list.push({ id: defender, lethal: 0, trampleTarget: true });
  const ans = g.choose({
    kind: 'assignDamage',
    player: chooser ?? g.obj(source).controller, // edhv31 (CR 702.22j-k): with banding, the other side's player divides the damage
    prompt: `Assign ${power} combat damage from ${c.name || g.nameOf(source)}${trample ? ' (trample: lethal damage to every blocker before the rest can go to what it attacks)' : ''}.`,
    attacker: source,
    amount: power,
    recipients: list,
    canTrample: (trample && defender !== null) || overPw !== undefined,
    rules: ['CR 510.1c', ...(trample ? ['CR 702.19b'] : []), ...(overPw !== undefined ? ['CR 702.19c'] : [])],
  });
  return ans.amounts.filter((x) => x.amount > 0).map((x) => ({ target: x.id, amount: x.amount }));
}

/** edh-d-90 (CR 702.19c): the planeswalker an attacker with trample over planeswalkers attacks, the damage that is lethal for it (its loyalty left) and its controller. */
interface OverPlaneswalker { walker: ObjectId; room: number; controller: PlayerId }

/**
 * edh-d-90 (CR 702.19c, 702.19e; Thrasta, Tempest's Roar): for an attacker with trample over planeswalkers that attacks a planeswalker still on the battlefield, the planeswalker and its
 * controller (damage at least equal to its loyalty, less what other creatures assign it in this step, is lethal: ruling 2021-06-18; deathtouch changes nothing there); null otherwise. A
 * player who left the game is assigned nothing (CR 800.4e).
 */
function overPlaneswalker(g: Game, att: AttackerState, assigned: Map<string, number>): OverPlaneswalker | null {
  const pw = att.defender !== null ? g.s.objects[att.defender] : undefined;
  if (pw === undefined || pw.zone !== 'battlefield' || !charsOfObject(g.s, pw).types.includes('Planeswalker')) return null;
  const controller = pw.controller;
  if (g.s.players.some((p) => p.id === controller && p.hasLost)) return null;
  return { walker: pw.id, room: Math.max(0, (pw.counters['loyalty'] ?? 0) - (assigned.get(pw.id) ?? 0)), controller };
}

/** How an attacking creature assigns its combat damage (CR 510.1b-c, 702.19). */
function assignAttacker(g: Game, att: AttackerState, c: Chars, power: number, assigned: Map<string, number>): Assignment[] {
  // edh-d-90 (CR 702.19c): trample over planeswalkers is a variant of trample: it assigns as trample does, with the planeswalker attacked's controller after that planeswalker
  const overPws = hasKeyword(c, 'trample over planeswalkers');
  const trample = hasKeyword(c, 'trample') || overPws;
  const deathtouch = hasKeyword(c, 'deathtouch');
  const blockers = att.blockedBy.filter((id) => g.s.objects[id]);
  // M12-2 (m12 design E18): CR 800.4e, combat damage isn't assigned to a player who left the game (core/leave.ts already points such attackers at nothing)
  let defender = att.defender !== null && g.s.players.some((p) => p.id === att.defender && p.hasLost) ? null : att.defender;
  const overPw = overPws ? overPlaneswalker(g, att, assigned) : null;
  // edh-d-90 (CR 702.19e): attacking a planeswalker that was removed from combat (or that left), its damage may go to the defending player once every blocker is assigned lethal damage
  // (only a creature declared attacking a planeswalker, never one attacking a battle or a player: core/combat.ts sets `atPlaneswalker`; state-based actions clear `defender`, CR 506.4c)
  if (overPws && overPw === null && att.atPlaneswalker === true && !g.s.players.find((p) => p.id === att.defendingPlayer)?.hasLost) {
    const pw = defender !== null ? g.s.objects[defender] : undefined;
    if (pw === undefined || pw.zone !== 'battlefield' || !charsOfObject(g.s, pw).types.includes('Planeswalker') || pw.controller !== att.defendingPlayer) defender = att.defendingPlayer;
  }
  if (overPw !== null && power > overPw.room && !mustAssignAsUnblocked(g.s, att.id) && (blockers.length === 0 || !blockers.some((b) => hasBanding(g.s, b)))) {
    // edh-d-90 (CR 702.19c, 702.19d): unblocked (or blocked with no creature left blocking), the planeswalker and then its controller; blocked, the blockers first
    if (!att.blocked || blockers.length === 0) return askAssignment(g, att.id, c, power, [], null, true, assigned, undefined, overPw);
    if (!mayAssignAsUnblocked(g.s, att.id)) return askAssignment(g, att.id, c, power, blockers, null, true, assigned, undefined, overPw);
  }
  if (!att.blocked) return defender !== null ? [{ target: defender, amount: power }] : []; // CR 510.1b (attacking nothing: no damage)
  // FAST5 T37 (CR 510.1b-c; Thorn Elemental): "You may have ~ assign its combat damage as though it weren't blocked": its controller chooses, as the damage is
  // assigned, whether it assigns all of it to what it attacks (it stays blocked, CR 509.1h, 509.3g)
  // edh-d-25 (Outmaneuver): "assign their combat damage this turn as though they weren't blocked" is not a choice (a `mandatory` permission)
  if (mustAssignAsUnblocked(g.s, att.id)) return defender !== null ? [{ target: defender, amount: power }] : []; // CR 510.1b
  if (mayAssignAsUnblocked(g.s, att.id)) {
    const yes = g.choose({
      kind: 'yesNo', player: g.obj(att.id).controller, yesLabel: 'Assign as though unblocked', noLabel: 'Assign to the blockers', rules: ['CR 510.1b', 'CR 510.1c'],
      prompt: `Assign ${power} combat damage from ${c.name || g.nameOf(att.id)} as though it weren't blocked?`,
    }).yes;
    if (yes) return defender !== null ? [{ target: defender, amount: power }] : []; // CR 510.1b (attacking nothing: no damage)
  }
  if (blockers.length === 0) return trample && defender !== null ? [{ target: defender, amount: power }] : []; // CR 510.1c, 702.19d
  // edhv31 (CR 702.22j): blocked by a creature with banding, the defending player (not the active player) divides the attacking creature's damage among the creatures
  // blocking it as they choose; they can't assign it to a player, a planeswalker or a battle (not even with trample)
  if (blockers.some((b) => hasBanding(g.s, b))) {
    if (blockers.length === 1) return [{ target: blockers[0]!, amount: power }];
    return askAssignment(g, att.id, c, power, blockers, null, false, assigned, att.defendingPlayer);
  }
  if (!trample) {
    if (blockers.length === 1) return [{ target: blockers[0]!, amount: power }]; // CR 510.1c
    return askAssignment(g, att.id, c, power, blockers, null, false, assigned);
  }
  // Trample (CR 702.19b): with one blocker and nothing to spare there is no choice.
  const lethalTotal = blockers.reduce((n, id) => n + lethalFor(g, id, deathtouch, assigned), 0);
  if (blockers.length === 1 && (defender === null || power <= lethalTotal)) return [{ target: blockers[0]!, amount: power }];
  return askAssignment(g, att.id, c, power, blockers, defender, true, assigned);
}

/** CR 510.1d: a blocking creature assigns its combat damage to the creatures it is blocking. */
function assignBlocker(g: Game, id: ObjectId, c: Chars, power: number, blocking: ObjectId[], assigned: Map<string, number>): Assignment[] {
  const targets = blocking.filter((a) => g.s.objects[a]);
  if (targets.length === 0) return [];
  if (targets.length === 1) return [{ target: targets[0]!, amount: power }];
  // edhv31 (CR 702.22k): blocking a creature with banding, the active player (not the defending player) divides the blocking creature's damage among the creatures it blocks
  if (targets.some((a) => hasBanding(g.s, a))) return askAssignment(g, id, c, power, targets, null, false, assigned, g.s.turn.activePlayer);
  return askAssignment(g, id, c, power, targets, null, false, assigned);
}

/** CR 510.4: first strike and double strike creatures deal damage in an earlier step; the later step follows. */
const strikesFirst = (c: Chars): boolean => hasKeyword(c, 'first strike') || hasKeyword(c, 'double strike');

export function combatDamageStep(g: Game): void {
  const combat = g.s.combat;
  if (!combat) return;
  // M12-2 (m12 design E17): CR 802.5, 510.1: combat damage is assigned in APNAP order: the active player's attackers, then each defending player's blockers in
  // turn order (a stable sort: with one defending player, every two-player game, the order of the blocks as before)
  const order = g.apnap();
  const rank = (p: PlayerId): number => (order.includes(p) ? order.indexOf(p) : order.length);
  const blockers = combat.blockers.map((b, i) => ({ b, i })).sort((x, y) => rank(x.b.defendingPlayer) - rank(y.b.defendingPlayer) || x.i - y.i).map((x) => x.b.id);
  const inCombat = [...combat.attackers.map((a) => a.id), ...blockers].filter((id) => g.s.objects[id]);

  let participants: ObjectId[];
  let label = 'combat damage step';
  if (combat.damageSteps === 0) {
    const first = inCombat.filter((id) => strikesFirst(charsOfObject(g.s, g.obj(id))));
    if (first.length > 0) {
      // CR 510.4: only creatures with first strike or double strike assign damage now; a second step follows.
      combat.firstStrikers = first;
      combat.extraDamageStep = true;
      participants = first;
      label = 'first-strike combat damage step';
    } else participants = inCombat;
  } else {
    // CR 510.4, 702.7c: the remaining creatures that did not have first strike or double strike when the first step began, and those with double strike now.
    combat.extraDamageStep = false;
    participants = inCombat.filter((id) => !combat.firstStrikers.includes(id) || hasKeyword(charsOfObject(g.s, g.obj(id)), 'double strike'));
    label = combat.firstStrikers.length > 0 ? 'regular combat damage step' : label;
  }
  combat.damageSteps++;
  g.log(`The ${label}.`, { rules: ['CR 510', ...(combat.firstStrikers.length > 0 ? ['CR 510.4'] : [])], level: 'info' });

  // CR 510.1: the active player assigns damage for their creatures, then the defending player (participants are in attackers-then-blockers order).
  // edh-d-90 (CR 702.19c, 510.2; Thrasta ruling 2021-06-18): an attacker with trample over planeswalkers assigns after the active player's other attackers, so the damage they assign
  // to the same planeswalker counts toward its loyalty (all of it is dealt at once, CR 510.2: the order of the assignments changes nothing else)
  const overPwLast = (id: ObjectId): number => (combat.attackers.some((a) => a.id === id) && hasKeyword(charsOfObject(g.s, g.obj(id)), 'trample over planeswalkers') ? 1 : 0);
  const isAttacker = (id: ObjectId): boolean => combat.attackers.some((a) => a.id === id);
  participants = [...participants.filter((id) => isAttacker(id) && overPwLast(id) === 0), ...participants.filter((id) => isAttacker(id) && overPwLast(id) === 1), ...participants.filter((id) => !isAttacker(id))];
  const assigned = new Map<string, number>();
  const plan: { source: ObjectId; assignments: Assignment[] }[] = [];
  for (const id of participants) {
    const o = g.obj(id);
    const c = charsOfObject(g.s, o);
    if (assignsNoCombatDamage(g.s, id)) continue; // edh-combat-6 (CR 510.1): "assigns no combat damage this combat"
    const nums = ptNumbers(c);
    // FAST5 T60, CR 510.1a: "assigns combat damage equal to its toughness rather than its power" (Doran, the Siege Tower; Bedrock Tortoise)
    const printed = assignsCombatDamageAsToughness(g.s, id, c) ? nums.toughness : nums.power;
    // r3-static (CR 510.1a): "If ~'s power is negative, ~ assigns combat damage as though ~'s power were positive" (Loot, the Anomaly): the power's absolute value
    const power = printed !== null && printed < 0 && printed === nums.power && assignsNegativePowerAsPositive(g.s, id) ? -printed : printed;
    if (power === null) {
      g.log(`${c.name || g.nameOf(id)} has a power the engine can't evaluate yet ("${c.power}"): it assigns no combat damage; deal it by hand.`, { rules: ['CR 510.1a'], level: 'manual' });
      continue;
    }
    if (power <= 0) continue; // CR 510.1a
    const att = combat.attackers.find((a) => a.id === id);
    const blk = combat.blockers.find((b) => b.id === id);
    const assignments = att ? assignAttacker(g, att, c, power, assigned) : blk ? assignBlocker(g, id, c, power, blk.blocking, assigned) : [];
    for (const a of assignments) assigned.set(a.target, (assigned.get(a.target) ?? 0) + a.amount);
    plan.push({ source: id, assignments });
  }
  // CR 510.2: all combat damage that's been assigned is dealt simultaneously (no state-based actions or priority in between).
  // Lifelink: one life gain per source for everything it dealt in this step (CR 702.15e).
  const lifelink: LifelinkLedger = new Map();
  tallyCommanderDamage(g); // M11-1: CR 903.10a (a Commander game with the rule only)
  // WP11 INTERFACE CHANGE (review): proposed together, so a shield two sources would use is divided by the player it protects (CR 615.7).
  dealSimultaneousDamage(g, plan.flatMap((p) => p.assignments.map((a) => ({ source: p.source, target: a.target, amount: a.amount, opts: { combat: true, lifelink } }))));
  settleLifelink(g, lifelink);
  notePrivately(g); // M11-1 review finding 2
}
