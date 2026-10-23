/**
 * Primitives that change a permanent's status without moving it (CR 110.5, 701.3, 701.26, 701.27): tap, untap, attach, unattach, transform. Added by WP14.
 * M6-4: converting (CR 701.28, `transformPermanent(.., convert)`) and flipping (CR 710.4, `flipPermanent`).
 *
 * They are the "performers of non-proposable actions" of design 8.6 stage 4: the proposal pipeline (effects/propose.ts) has no `Proposed` form for these events
 * (design 8.5 lists none), so the op handlers of effects/handlers/zones*.ts call these functions instead of writing the state themselves. Each one changes the
 * object, emits the engine event the trigger normalizer reads (triggers/normalize.ts: `tapped`, `untapped`, `attached`, `transformed`) and logs with its rule.
 * Legality (can this be attached there? can it transform?) is decided by the caller; these only perform.
 *
 * WP14 INTERFACE CHANGE (new module outside WP14's files, declared in the WP14 review): a state-writing performer the design 8.5 performer table does not list
 * yet. It is to be listed there (or moved into effects/perform.ts under WP11) by agreement with WP11; until then test/m5/zones/performers.test.ts pins that the
 * WP14 handlers write the state only through `propose` and the performers named there (WP11's lint reads only src/effects).
 */
import type { Game } from '../core/game';
import type { ObjectId, PlayerId } from '../types/ids';
import { addCounters } from './counters';
import { charsOfObject, controllerOf } from './characteristics';

/**
 * CR 701.26a: tap an untapped permanent. Returns whether it changed (an already tapped permanent can't be tapped again). FAST5X E20 INTERFACE CHANGE (additive):
 * `by`, the player whose effect taps it (the controller of the spell or ability): it is also reported as that player's `tap` action, "whenever you tap an
 * untapped creature an opponent controls" (rules/crime.ts).
 */
export function tapPermanent(g: Game, id: ObjectId, by?: PlayerId): boolean {
  const o = g.obj(id);
  if (o.tapped) return false;
  o.tapped = true;
  g.emit({ type: 'tapped', objectId: id });
  if (by !== undefined) g.emit({ type: 'actionPerformed', verb: 'tap', actor: by, objectId: id, zone: 'battlefield' });
  return true;
}

/**
 * T20 (FAST4) INTERFACE CHANGE: the counter kinds whose rules this module runs (model/cap-walk.ts#counterForms names `counter:<kind>`; model/capabilities.ts
 * registers these). CR 122.1d: stun counters, through `stunInsteadOfUntap` on every path that untaps a permanent (the untap step, core/steps.ts; the
 * `untap` op through `untapPermanent`; an {Q} cost, rules/pay.ts; a mana ability's {Q} cost, rules/mana.ts). The by-hand adjustment of core/manual.ts sets
 * the status as the player says and is not an untap event of the game.
 */
export const RULED_COUNTER_KINDS: readonly string[] = Object.freeze(['stun']);

/**
 * CR 122.1d: "If a permanent with a stun counter on it would become untapped, instead remove a stun counter from it." Only a tapped permanent can become
 * untapped (CR 701.26b), so nothing happens for an untapped one. Returns whether the untapping was replaced (one stun counter removed, the permanent stays
 * tapped). One or more stun counters make a single replacement effect, so one untap event removes exactly one counter.
 */
export function stunInsteadOfUntap(g: Game, id: ObjectId): boolean {
  const o = g.obj(id);
  if (!o.tapped || !Object.hasOwn(o.counters, 'stun') || (o.counters['stun'] ?? 0) <= 0) return false;
  addCounters(g, id, 'stun', -1);
  g.log(`${g.nameOf(id)} doesn't untap: a stun counter is removed from it instead.`, { rules: ['CR 122.1d', 'CR 614.1a'] });
  return true;
}

/** CR 701.26b: untap a tapped permanent; a stun counter replaces that (CR 122.1d). Returns whether it became untapped. */
export function untapPermanent(g: Game, id: ObjectId): boolean {
  const o = g.obj(id);
  if (!o.tapped) return false;
  if (stunInsteadOfUntap(g, id)) return false;
  o.tapped = false;
  g.emit({ type: 'untapped', objectId: id });
  return true;
}

/**
 * CR 701.3a: attach an Aura, Equipment or Fortification to an object or player. It receives a new timestamp (CR 613.7e). The caller has checked that the
 * attachment is legal and that it is not already attached there (CR 701.3b: then nothing happens). Moving it away from what it was attached to makes it
 * "become unattached" from that (CR 701.3d): that event comes first.
 */
export function attachPermanent(g: Game, id: ObjectId, to: ObjectId | PlayerId): void {
  const o = g.obj(id);
  if (o.attachedTo !== undefined && o.attachedTo !== to) g.emit({ type: 'attached', objectId: id, to: null }); // CR 701.3d
  o.attachedTo = to;
  o.timestamp = g.newTimestamp(); // CR 613.7e
  g.emit({ type: 'attached', objectId: id, to });
}

/** CR 701.3d: unattach an attachment; it stays on the battlefield attached to nothing. Returns whether it was attached. */
export function unattachPermanent(g: Game, id: ObjectId): boolean {
  const o = g.obj(id);
  if (o.attachedTo === undefined) return false;
  delete o.attachedTo;
  g.emit({ type: 'attached', objectId: id, to: null });
  return true;
}

/**
 * CR 508.4: a creature put onto the battlefield attacking (or that an effect says is attacking) becomes an attacking creature in the current combat, attacking
 * `defender` (a player, or a planeswalker or battle) of `defendingPlayer`. It was never declared as an attacker: it "attacked" for no trigger (CR 508.4), and
 * during the declare blockers step or later it is unblocked (CR 508.4d). The caller has checked CR 506.3a-c, 506.3f and 508.4a.
 */
export function addAttacker(g: Game, id: ObjectId, defender: PlayerId | ObjectId, defendingPlayer: PlayerId): void {
  const c = g.s.combat;
  if (!c || c.attackers.some((a) => a.id === id)) return;
  c.attackers.push({ id, defender, defendingPlayer, blockedBy: [], blocked: false });
}

/**
 * CR 701.27a, 712.18: turn a double-faced permanent over to its other face. It is the same object (no zone change, effects keep applying) and receives a new
 * timestamp (CR 613.7g). The caller has checked that it can transform (CR 701.27c-f, 712.9, 712.10, 712.15a).
 */
export function transformPermanent(g: Game, id: ObjectId, convert = false): void {
  const o = g.obj(id);
  o.face = o.face === 0 ? 1 : 0;
  o.timestamp = g.newTimestamp(); // CR 613.7g
  o.transformedAt = o.timestamp; // M6-4: CR 701.27f, 701.28e "if it hasn't transformed or converted since ..." (effects/handlers/dfc-ops.ts)
  g.emit({ type: 'transformed', objectId: id, ...(convert ? { convert: true as const } : {}) }); // CR 701.28 (M6-4): converting emits `convert`
}

/**
 * M6-4, CR 710.4: flip a permanent whose copiable values are a flip card's (the caller checked it, CR 110.5c). One way: it stays flipped until it leaves the
 * battlefield (a new object is unflipped, CR 400.7). Returns whether it changed.
 */
export function flipPermanent(g: Game, id: ObjectId): boolean {
  const o = g.obj(id);
  if (o.flipped) return false;
  o.flipped = true;
  g.emit({ type: 'flipped', objectId: id });
  return true;
}

/**
 * FAST5X E7 (CR 702.190b, 508.4, 508.4a, 508.4d, 506.3a-c, 506.3f): the permanent a spell whose sneak cost was paid became is attacking the same player,
 * planeswalker or battle as the creature returned to pay that cost (named by the effect, so its controller doesn't choose, CR 508.4). It is never an
 * attacking creature when it isn't a creature or is a battle, when its controller isn't the attacking player, when there is no combat, or when what it would
 * attack is gone: a player no longer in the game, a planeswalker no longer on the battlefield, no longer a planeswalker or no longer controlled by the
 * defending player, a battle no longer a battle or no longer protected by them, or nothing (the returned creature was attacking a planeswalker that had left
 * combat, CR 506.4c). Put onto the battlefield attacking during the declare blockers step or later, it is unblocked (CR 508.4d: `addAttacker`).
 * (std-typechange-1: moved here from core/resolve.ts; ninjutsu's move `attacking: { asReturned: true }` reads the same, CR 702.49c, effects/handlers/zones-util.ts.)
 * True when it became an attacking creature.
 */
export function entersAttackingAsReturned(g: Game, id: ObjectId, how: { defender: PlayerId | ObjectId | null; defendingPlayer: PlayerId | null }, rule = 'CR 702.190b'): boolean {
  const s = g.s;
  const o = s.objects[id];
  if (!o || !s.combat || how.defender === null || how.defendingPlayer === null) return false;
  const c = charsOfObject(s, o);
  const ctl = controllerOf(s, o); // CR 613.1b
  if (!c.types.includes('Creature') || c.types.includes('Battle') || ctl !== s.turn.activePlayer) return false; // CR 506.3a, 506.3b, 506.3f
  const defending = s.players.find((p) => p.id === how.defendingPlayer);
  if (!defending || defending.hasLost || how.defendingPlayer === ctl) return false; // CR 508.4a
  if (how.defender !== how.defendingPlayer) {
    const d = s.objects[how.defender];
    if (!d || d.zone !== 'battlefield' || d.phasedOut) return false; // CR 508.4a: no longer on the battlefield
    const dc = charsOfObject(s, d);
    const walker = dc.types.includes('Planeswalker') && controllerOf(s, d) === how.defendingPlayer;
    const battle = dc.types.includes('Battle') && d.protector === how.defendingPlayer;
    if (!walker && !battle) return false; // CR 508.4a
  }
  addAttacker(g, id, how.defender, how.defendingPlayer);
  g.log(`${g.nameOf(id)} enters tapped and attacking ${how.defender === how.defendingPlayer ? g.player(how.defendingPlayer).name : g.nameOf(how.defender)}, as the creature returned to pay for it was.`, { rules: [rule, 'CR 508.4', 'CR 508.4d'], level: 'action' });
  return true;
}
