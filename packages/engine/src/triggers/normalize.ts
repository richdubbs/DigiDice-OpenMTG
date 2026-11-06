/**
 * Event normalization: the engine events of one simultaneous action become one batch of semantic events, and history entries (design 3.5, 4.1).
 * Owner: WP8. Contract: triggers/api.ts#Normalize.
 *
 * The engine emits `GameEvent`s while it works; it never groups them. A trigger needs more: roles ("that creature", "that player"), last known information of
 * what left a zone, and the knowledge of which events were simultaneous (CR 603.2c: "one or more" triggers once per batch; CR 603.6a, 603.10a: everything that
 * happened together is checked together). `splitBatches` cuts the events since the last time triggers were collected into batches, `normalize` turns one batch
 * into `SemEvent`s. Both are pure functions of the events and the state after them.
 */
import type { Game } from '../core/game';
import type { GameEvent } from '../types/events';
import type { ObjectId, PlayerId } from '../types/ids';
import type { LastKnown, ObjHandle, RoleValue, SemEvent, ZoneKind } from '../types/state';
import type { Normalize } from './api';
import { charsOfObject, ptNumbers } from '../rules/characteristics';

/** Features this module implements (`feature:history`: `GameState.history` is written by `triggers/history.ts` from these events, design 5.2). */
export const FEATURES: readonly string[] = ['history', 'history.sinceYourLastTurn' /* edh-next-135: rules/history.ts#historyInScope, CR 500.1 */];

/** FAST5X E19: the prefix of a cast event's data keys `manaFrom.<Subtype>` (triggers/context.ts collects them into `EventContext.manaFrom`). */
export const MANA_FROM = 'manaFrom.';
/** std-lci: the prefix of a cast event's data keys `manaSource.<ObjectId>` (an object that produced some of the mana spent to cast it, CR 106.3). */
export const MANA_SOURCE = 'manaSource.';

/** Zones whose contents every player can see: an object that moves to one of them can be found there afterwards (CR 400.7e, 603.6). */
export const PUBLIC_ZONES: readonly ZoneKind[] = ['battlefield', 'graveyard', 'stack', 'exile', 'command'];

/** edh-zones-4: the causes of zone changes whose cards are moved one at a time (each its own batch, `splitBatches`). */
const EXILED_ONE_AT_A_TIME: ReadonlySet<string> = new Set(['exileUntil', 'cascade', 'discover']);

/**
 * CR 603.2c, 603.6a, 603.10a: events that happened together form a batch. The engine does not mark simultaneity, so the cut is made where one thing ends and the
 * next begins: a step or turn begins (turn-based actions and everything after them), and a spell or ability finished resolving (what follows, state-based
 * actions, is a separate event, CR 704.3). Casting, activating, a declaration of attackers or blockers and one resolution are each one batch by construction,
 * because the engine collects triggers every time a player would receive priority AND before each state-based action pass (core/turn.ts#advance): combat
 * damage is one window, the pass that kills the creatures it damaged is the next, and a second pass is the one after that.
 */
export function splitBatches(events: readonly GameEvent[]): GameEvent[][] {
  const out: GameEvent[][] = [];
  let cur: GameEvent[] = [];
  const flush = (): void => {
    if (cur.length > 0) out.push(cur);
    cur = [];
  };
  for (const e of events) {
    if (e.type === 'stepBegan' || e.type === 'turnBegan') flush();
    const oneAtATime = e.type === 'zoneChanged' && e.to === 'exile' && e.cause !== undefined && EXILED_ONE_AT_A_TIME.has(e.cause);
    if (oneAtATime) flush(); // what the resolution did before is not simultaneous with the first card
    cur.push(e);
    if (e.type === 'resolved') flush();
    // edh-zones-4 (CR 701.57a, 702.85a; ruling 2024-06-07 on Laelia, the Blade Reforged): the cards "exile cards from the top of your library until ..." (cascade and discover
    // too) exiles are exiled one at a time (effects/handlers/actions-native.ts#exileUntil), so each is its own occurrence of "one or more cards are put into exile"
    if (oneAtATime) flush();
  }
  flush();
  return out;
}

/**
 * The turn number the engine event at `index` of `g.events` happened in: today's turn number minus the turns that began after it. (The opening hands and the
 * shuffles of game setup happen before the first turn begins: turn 0.) Events are collected some time after they happened, so reading `g.s.turn.number` at
 * collection time would stamp them with the wrong turn (design 4.1).
 */
export function turnAt(g: Game, index: number): number {
  let later = 0;
  for (let i = index + 1; i < g.events.length; i++) if (g.events[i]!.type === 'turnBegan') later++;
  return g.s.turn.number - later;
}

const objects = (...handles: ObjHandle[]): RoleValue => ({ objects: handles });
const players = (...ids: PlayerId[]): RoleValue => ({ players: ids });

/** Remove undefined values from `data` (SemEvent.data is JSON). */
function data(d: Record<string, string | number | boolean | undefined | null>): SemEvent['data'] {
  const out: SemEvent['data'] = {};
  for (const [k, v] of Object.entries(d)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

/** Verbs of CR 701 that the engine reports only as a zone change with a cause, seen as actions too (a sacrifice is a move to the graveyard AND a sacrifice). */
// Standard round 3, r3-trig: craft's materials exiled as its cost are an exile too (rules/pay-parts.ts, CR 702.167a)
// p2-trigger-events-1 (CR 701.17a): a milled card (effects/handlers/cards-draw.ts#millHandler, the mill cost of rules/pay-parts.ts) is a mill by its owner, as a discard is
const CAUSE_VERBS: Readonly<Record<string, string>> = { sacrifice: 'sacrifice', discard: 'discard', destroy: 'destroy', exile: 'exile', craft: 'exile', mill: 'mill' };

/** Keyword actions that make a permanent "become" something (the verb the keyword library reports -> the `becomes` kind). */
const BECOMES_VERBS: Readonly<Record<string, 'monstrous' | 'renowned' | 'saddled' | 'crewed'>> = {
  monstrosity: 'monstrous', monstrous: 'monstrous', renown: 'renowned', renowned: 'renowned', saddle: 'saddled', saddled: 'saddled', crew: 'crewed', crewed: 'crewed',
};

/** Normalize one batch (design 3.5). `batch` is the id shared by all the returned events. */
export const normalize: Normalize = (g: Game, events, batch) => {
  const s = g.s;
  const offset = events.length > 0 ? Math.max(0, g.events.indexOf(events[0]!)) : 0;
  const out: SemEvent[] = [];
  let at = offset;
  // edh-c-68 (CR 508.1b, 509.1, 509.3c; Rakdos Roustabout): `defender` of a blocked attacker, the player or planeswalker (or battle) it attacks, however it became blocked
  const defenderOfBlocked = (attacker: ObjectId): SemEvent['roles'] => {
    const att = s.combat?.attackers.find((x) => x.id === attacker);
    return att !== undefined && att.defender !== null ? { defender: isPlayer(att.defender) ? players(att.defender) : objects(handle(att.defender)) } : {};
  };
  const push = (ev: SemEvent['ev'], roles: SemEvent['roles'], d: SemEvent['data'], before: Record<ObjectId, LastKnown> = {}): void => {
    // FAST5 T59: a "becomes" event names its object `subject`, a damage event `object`: a trigger of both ("becomes tapped or is dealt damage") reads `object` in each
    const named = ev === 'becomes' && roles.subject !== undefined && roles.object === undefined ? { ...roles, object: roles.subject } : roles;
    out.push({ ev, seq: at, batch, roles: named, data: d, before }); // seq: index of the engine event in `Game.events` (derived events share it)
  };
  const isPlayer = (id: string): boolean => s.players.some((p) => p.id === id);
  /** Last known information of an object that is no longer where the event found it. */
  const gone = (id: ObjectId): Record<ObjectId, LastKnown> => (!s.objects[id] && s.lki[id] ? { [id]: s.lki[id]! } : {});
  const zoneOf = (id: ObjectId): ZoneKind => s.objects[id]?.zone ?? s.lki[id]?.leftZone ?? 'battlefield';
  const handle = (id: ObjectId): ObjHandle => ({ id, zone: zoneOf(id) });
  const controllerOf = (id: ObjectId): PlayerId | undefined => (s.objects[id] ?? s.lki[id]?.object)?.controller;
  /** `drew` events of one player from event `i` on: the cards drawn this turn before an event are today's total minus those. */
  const drawsFrom = (i: number, player: PlayerId): number => events.slice(i).filter((x) => x.type === 'drew' && x.player === player).length;
  /** FAST1 T4: `spellCast` events of one player from event `i` on (the same count for "the Nth spell you cast each turn"). */
  const castsFrom = (i: number, player: PlayerId): number => events.slice(i).filter((x) => x.type === 'spellCast' && x.player === player).length;
  /** Counters on a thing right after each `countersChanged` event of this batch: today's total minus the changes that come later. */
  const totalAfter = (i: number, target: string, counter: string): number | undefined => {
    const player = s.players.find((p) => p.id === target);
    const now = player ? (counter === 'poison' ? player.poison : player.counters[counter]) : s.objects[target]?.counters[counter];
    if (now === undefined && !player && !s.objects[target]) return undefined;
    let n = now ?? 0;
    for (let j = i + 1; j < events.length; j++) {
      const x = events[j]!;
      if (x.type === 'countersChanged' && x.target === target && x.counter === counter) n -= x.delta;
    }
    return n;
  };

  events.forEach((e, i) => {
    at = offset + i;
    switch (e.type) {
      case 'zoneChanged': {
        const lk = e.before ?? s.lki[e.oldId];
        const created = e.newId === e.oldId; // a token created on the battlefield has no earlier existence
        const newObj = e.newId ? s.objects[e.newId] : undefined;
        // CR 400.7e, 603.6: the subject is the object in the zone it went to when everyone can see that zone and it is still there (a token that ceased to exist
        // is not); otherwise the object as it last was.
        const subject: ObjHandle = PUBLIC_ZONES.includes(e.to) && newObj && e.newId ? { id: e.newId, zone: e.to } : { id: e.oldId, zone: e.from ?? e.to };
        // edh-d-37 (CR 603.6a, 110.2; Overburden, Tunnel Ignus): the player of an event that put an object onto the battlefield is who controls it as it enters (not who controlled the card in
        // a graveyard, a library or a hand before); an object that left the battlefield was controlled by who controlled it there (CR 603.10a)
        const controller = e.to === 'battlefield' ? e.controller : (lk?.object.controller ?? e.controller);
        const before = lk && !created ? { [e.oldId]: lk } : {};
        const d = data({ from: e.from, to: e.to, oldId: e.oldId, newId: e.newId ?? undefined, cause: e.cause, owner: e.owner, name: e.name, faceDown: e.faceDown, tapped: e.tapped, viaSource: e.viaSource }); // faceDown: FAST5X E25; tapped: pc-tokens-2 (entered tapped)
        push('zoneChange', { subject: objects(subject), player: players(controller) }, d, before);
        // CR 701.17 (sacrifice), 701.9 (discard), 701.8 (destroy), 701.13 (exile) as actions: the same happening seen as a verb.
        // p2-trigger-events-1 (CR 701.17a): a mill is a card put into a graveyard from a library; one a replacement sent elsewhere is not reported as milled
        const verb0 = CAUSE_VERBS[e.cause ?? ''];
        const verb = verb0 === 'mill' && (e.from !== 'library' || e.to !== 'graveyard') ? undefined : verb0;
        // edh-players-22 (CR 109.5, 701.8a): a destruction by a spell or ability also names the controller of that spell or ability (`by`)
        const by = verb === 'destroy' ? e.destroyedBy : verb === 'discard' ? e.discardedBy : undefined; // edh-next-132 (CR 701.9a): and a discard by an effect names its controller
        if (verb) push('action', { subject: objects(subject), player: players(verb === 'discard' || verb === 'mill' ? e.owner : controller), ...(by !== undefined ? { by: players(by) } : {}) }, data({ ...d, verb, by }), before);
        if (created || (e.cause === 'create token' && e.from === null)) {
          push('createToken', { newObject: objects({ id: e.newId ?? e.oldId, zone: e.to }), player: players(e.controller) }, data({ oldId: e.oldId, newId: e.newId ?? e.oldId }));
        }
        break;
      }
      case 'spellCast': {
        const o = s.objects[e.objectId];
        // FAST1 T4 (CR 601.2i): "the second spell you cast each turn": the spells this player cast this turn before this event, plus this one (as `drew` below)
        const caster = s.players.find((x) => x.id === e.player);
        const nth = caster && turnAt(g, at) === s.turn.number ? caster.turnStats.spellsCast - castsFrom(i, e.player) + 1 : undefined;
        // FAST5X E19 (CR 106.3): `manaFrom.<Subtype>`, how many of the mana spent came from a source with that subtype ("mana from a Treasure")
        const from: Record<string, number> = {};
        for (const subs of e.manaFrom ?? []) for (const t of new Set(subs)) from[`${MANA_FROM}${t}`] = (from[`${MANA_FROM}${t}`] ?? 0) + 1;
        for (const id of e.manaSources ?? []) from[`${MANA_SOURCE}${id}`] = 1; // std-lci (CR 106.3): "using mana produced by ~"
        // r4-fxz (CR 107.3, 601.2b): the X announced for the spell, for "whenever you cast a spell with {X} in its mana cost, ... X ..." (triggers/stack.ts)
        // Standard round 3, r3-trig (CR 700.2, 601.2b): whether modes were chosen for the spell as it was cast (a modal spell), and how many
        const modes = o?.stack?.modes;
        // edh-perms-21 (CR 115.9c, 608.2h): the one object the spell targets, fixed with the event (a target that leaves before the trigger resolves is read as it last existed)
        const targeted = [...new Set((o?.stack?.targets ?? []).flat().flatMap((t) => (t.kind === 'object' ? [t.id] : [])))];
        const tgt = targeted.length === 1 && (o?.stack?.targets ?? []).flat().every((t) => t.kind === 'object') ? { spellTarget: objects(handle(targeted[0]!)) } : {};
        push('cast', { spell: objects({ id: e.objectId, zone: 'stack' }), player: players(e.player), ...tgt }, data({ copy: false, from: o?.stack?.castFrom /* trek-11 (CR 400.11): 'outside' for a card cast from outside the game: it is no zone, so "from your hand" does not match it and "from anywhere other than your hand" does */, spellsBefore: e.spellsBefore, manaSpent: e.manaSpent, nth, via: o?.stack?.costsPaid.alternative, x: o?.stack?.x, ...from, modal: modes !== undefined, modesChosen: modes?.length, kicked: (o?.stack?.costsPaid.kicked ?? 0) > 0 /* edh-c-59 (CR 702.33d): "the first kicked spell you cast each turn" */ }), gone(e.objectId));
        break;
      }
      case 'spellCopied': {
        const o = s.objects[e.objectId];
        push('cast', { spell: objects({ id: e.objectId, zone: 'stack' }), player: players(o?.controller ?? s.turn.activePlayer) }, data({ copy: true, copyOf: e.copyOf }), gone(e.objectId));
        break;
      }
      case 'abilityActivated': {
        // edh-next-67 (CR 115.1, 602.2b; Professor Hojo): did the ability target a creature its controller controls? (the targets chosen as it was put on the stack)
        const targeted = s.objects[e.objectId]?.stack?.targets.flat().some((t) => { const to = t.kind === 'object' ? s.objects[t.id] : undefined; return to !== undefined && to.zone === 'battlefield' && to.controller === e.player && charsOfObject(s, to).types.includes('Creature'); }) === true;
        // FAST5X E20: `exhaust` (CR 702.177a) and `loyalty` (CR 606.3), the kind of ability activated (triggers/match.ts, `activate.ability`)
        push('activate', { source: objects(handle(e.sourceId)), spell: objects({ id: e.objectId, zone: 'stack' }), player: players(e.player) }, data({ mana: false, exhaust: e.exhaust, loyalty: e.loyalty, ninjutsu: e.ninjutsu, boast: e.boast, loyaltyRemoved: e.loyaltyRemoved, lifePaid: e.lifePaid, xInCost: e.xInCost, manaSpent: e.manaSpent, ...(e.lifePaid !== undefined ? { amount: e.lifePaid } : {}) /* edh-next-74: CR 602.2b, 107.3a */, fromZone: e.fromZone, targetsOwnCreature: targeted ? true : undefined }), gone(e.sourceId)); // r3-trig; edh-zones-19: ninjutsu: loyaltyRemoved (CR 606.4); edh-next-67: targetsOwnCreature
        break;
      }
      case 'attackersDeclared': {
        const count = e.attackers.length;
        // Standard round 3, r3-trig (CR 508.1, 208.1): the total power of the creatures declared as attackers (all the active player's, CR 508.1a), for "whenever you
        // attack with creatures with total power N or greater"
        const totalPower = e.attackers.reduce((n, a) => { const o = s.objects[a.attacker]; return n + (o ? ptNumbers(charsOfObject(s, o)).power ?? 0 : 0); }, 0);
        for (const a of e.attackers) {
          const roles: SemEvent['roles'] = {
            attacker: objects(handle(a.attacker)),
            defender: isPlayer(a.defender) ? players(a.defender) : objects(handle(a.defender)),
            player: players(controllerOf(a.attacker) ?? s.turn.activePlayer),
          };
          // std-rx16 (CR 508.1): `subject` is the attacking creature too, the combatant the event is about (model/lint-roles.ts)
          roles['subject'] = roles['attacker']!;
          // pc-combat-1 (CR 508.5, 603.2c): the player attacked, or the controller of the planeswalker attacked ("one or more creatures attack one of your opponents or a
        // planeswalker they control" is one occurrence for each such player, triggers/occurrences.ts#batchOccurrences)
        const defendingPlayer = isPlayer(a.defender) ? a.defender : (s.objects[a.defender] ?? s.lki[a.defender]?.object)?.protector ?? controllerOf(a.defender); // a battle's defending player is its protector (CR 508.5)
        push('attacks', roles, data({ count, alone: count === 1, defenderIsPlayer: isPlayer(a.defender), totalPower, defendingPlayer, declared: `|${e.attackers.map((x) => x.attacker).join('|')}|` /* edh-combat-5: the ids declared together, CR 508.1 */ }), gone(a.attacker));
        }
        break;
      }
      case 'blockersDeclared': {
        const seen = new Set<ObjectId>();
        const seenBlockers = new Set<ObjectId>();
        for (const b of e.blocks) {
          const roles: SemEvent['roles'] = { blocker: objects(handle(b.blocker)), attacker: objects(handle(b.attacker)), player: players(controllerOf(b.blocker) ?? s.turn.activePlayer) };
          const before = { ...gone(b.blocker), ...gone(b.attacker) };
          // CR 509.3a: "blocks" triggers once per blocker however many attackers it blocks, "blocks a creature" once per attacker (CR 509.3b): the first pair of
          // a blocker is flagged (WP30 review, the counterpart of `becomesBlocked`).
          // FAST3 T14: `object` is the OTHER combatant of the pair (the attacker it blocks; the creature blocking it), so "Whenever ~ blocks or becomes blocked by
          // a creature, destroy that creature" names one role in both patterns (model/lint-roles.ts)
          // std-rx16 (CR 509.1): `subject` is the combatant the event is about, the blocker of "blocks" and the attacker of "becomes blocked"
          push('blocks', { ...roles, object: roles['attacker']!, subject: roles['blocker']! }, data({ count: e.blocks.length, first: !seenBlockers.has(b.blocker) }), before);
          seenBlockers.add(b.blocker);
          // CR 509.3c: "becomes blocked" triggers once per attacker, "becomes blocked by a creature" once per blocker: the first pair of an attacker is flagged.
          // edh-c-48 (CR 509.3e): "becomes blocked by two or more creatures" reads how many creatures blocked this attacker when the blockers were declared (the first pair carries it)
          const firstPair = !seen.has(b.attacker);
          // edh-c-68 (CR 508.1b, 509.1; Rakdos Roustabout): `defender`, the player or planeswalker (or battle) the blocked attacker attacks
          const blockedDefender = defenderOfBlocked(b.attacker);
          push('becomesBlocked', { ...roles, ...blockedDefender, object: roles['blocker']!, subject: roles['attacker']! }, data({ first: firstPair, ...(firstPair ? { blockCountBefore: 0, blockCount: e.blocks.filter((x) => x.attacker === b.attacker).length } : {}) }), before);
          seen.add(b.attacker);
        }
        // std-rx35 (CR 509.1h): each attacker no blocker was declared for "attacks and isn't blocked" (its defending player is read from the combat state, effects/refs.ts)
        // pc-combat-4 (CR 509.1h, 508.1b): `defenderPlayer`, the player attacked (absent when the attacker attacks a planeswalker or battle), for "attack you and aren't blocked"
        for (const a of e.unblocked ?? []) {
          const att = s.combat?.attackers.find((x) => x.id === a);
          push('attacksUnblocked', { attacker: objects(handle(a)), player: players(controllerOf(a) ?? s.turn.activePlayer), ...(att !== undefined && att.defender !== null && isPlayer(att.defender) ? { defender: players(att.defender) } : {}) /* edh-combat-6: "that player" */ }, data({ ...(att !== undefined && att.defender !== null && isPlayer(att.defender) ? { defenderPlayer: att.defender } : {}) }), gone(a));
        }
        break;
      }
      // p2-combat-flow-2 (CR 509.1h, 509.3c): attackers an effect made blocked "become blocked", once each, with no blocker (so "becomes blocked by a creature" waits)
      case 'becameBlocked': {
        for (const a of e.attackers) {
          const attacker = objects(handle(a));
          push('becomesBlocked', { attacker, subject: attacker, ...defenderOfBlocked(a), player: players(controllerOf(a) ?? s.turn.activePlayer) }, data({ first: true }), gone(a));
        }
        break;
      }
      // edh-combat-4 (CR 509.3c-d, 509.3a): a creature put onto the battlefield blocking an attacker makes the attacker "become blocked by a creature" (always), and "become blocked"
      // only if it was an unblocked creature before; it never "blocks" (no `blocks` event)
      case 'blockerEntered': {
        const roles: SemEvent['roles'] = { blocker: objects(handle(e.blocker)), attacker: objects(handle(e.attacker)), player: players(controllerOf(e.blocker) ?? s.turn.activePlayer) };
        push('becomesBlocked', { ...roles, ...defenderOfBlocked(e.attacker), object: roles['blocker']!, subject: roles['attacker']! }, data({ first: !e.attackerWasBlocked, blockCountBefore: e.blockCount - 1, blockCount: e.blockCount }), { ...gone(e.blocker), ...gone(e.attacker) });
        break;
      }
      case 'damageDealt': {
        const roles: SemEvent['roles'] = { source: objects(handle(e.source)) };
        if (isPlayer(e.target)) roles.recipient = players(e.target);
        else roles.object = objects(handle(e.target));
        const controller = controllerOf(e.source);
        if (controller) roles.player = players(controller);
        push('damage', roles, data({ amount: e.amount, combat: e.combat, toPlayer: isPlayer(e.target), target: e.target, group: e.group, excess: e.excess }), { ...gone(e.source), ...(isPlayer(e.target) ? {} : gone(e.target)) });
        break;
      }
      case 'stepBegan':
        push('step', { player: players(e.activePlayer) }, data({ step: e.step, turn: turnAt(g, at), mainPhase: e.mainPhase, upkeepStep: e.upkeepStep, combatPhase: e.combatPhase, addedPhase: e.addedPhase })); // FAST5X E17: CR 505.1b; edh-combat-5: CR 500.8
        break;
      case 'turnBegan':
        push('beginTurn', { player: players(e.activePlayer) }, data({ turn: e.turn }));
        break;
      case 'lifeChanged':
        if (e.delta !== 0) push('life', { player: players(e.player) }, data({ change: e.delta > 0 ? 'gain' : 'loss', amount: Math.abs(e.delta), life: e.life, cause: e.cause, fromDamage: e.delta < 0 && e.cause?.startsWith('damage from') ? true : undefined })); // edh-players-3: fromDamage (rules/damage.ts#dealDamage names the cause "damage from X")
        break;
      // edh-next-109 (CR 119.4; Font of Agonies): "whenever you pay life" (the amount paid is the event's amount)
      case 'lifePaid':
        push('action', { player: players(e.player) }, data({ verb: 'payLife', amount: e.amount }));
        break;
      case 'drew': {
        const p = s.players.find((x) => x.id === e.player);
        // CR 121.2: "the second card you draw each turn": the cards drawn this turn before this event, plus this one.
        // Only for the current turn's draws: `turnStats` counts this turn's, so the opening hands (turn 0) and an earlier turn's draws have no Nth.
        const nth = p && turnAt(g, at) === s.turn.number ? p.turnStats.cardsDrawn - drawsFrom(i, e.player) + 1 : undefined;
        // edh-players-1 (CR 504.1, 121.2; Orcish Bowmasters): the first card the turn player draws in their own draw step (the one the turn-based action draws, where
        // core/steps.ts#drawStepFrom marks the cards drawn before it): "whenever an opponent draws a card except the first one they draw in each of their draw steps"
        // sees every other draw. Judged as the batch is normalized, while the step is still the draw step (the batch of an action is collected before the step ends)
        const firstInDrawStep = p !== undefined && nth !== undefined && s.turn.step === 'draw' && s.turn.activePlayer === e.player && p.turnStats.drawStepFrom !== undefined && nth - 1 === p.turnStats.drawStepFrom;
        push('draw', { player: players(e.player) }, data({ nth, firstInDrawStep }));
        break;
      }
      case 'revealedThisWay': // edh-next-144 (CR 701.20a, 607.2): the card a `revealFirstDraw` rule of `sourceId` revealed (triggers/reveal-draw.ts)
        push('reveal', { player: players(e.player), subject: objects(handle(e.objectId)), source: objects(handle(e.sourceId)) }, data({ thisWay: true }));
        break;
      case 'turnedFaceUp':
        // FAST5X E25 (CR 701.40b, 608.2, 603.4): the event's player is the one who turned it face up ("you turned a permanent face up this turn"); "a permanent
        // you control is turned face up" judges the subject's controller (triggers/match.ts), not this player
        push('becomes', { subject: objects(handle(e.objectId)), player: players(e.by ?? controllerOf(e.objectId) ?? s.turn.activePlayer) }, data({ what: e.type }), gone(e.objectId));
        break;
      // Standard round 5, r5-trig (CR 502.3): an untap by the untap step's turn-based action says so (`untapStep`, "during your untap step")
      case 'untapped':
        push('becomes', { subject: objects(handle(e.objectId)), player: players(controllerOf(e.objectId) ?? s.turn.activePlayer) }, data({ what: e.type, ...(e.untapStep === true ? { untapStep: true, ownUntapStep: (controllerOf(e.objectId) ?? s.turn.activePlayer) === s.turn.activePlayer } : {}) }), gone(e.objectId));
        break;
      case 'tapped':
        // edh-players-20 (CR 508.1f; Verity Circle): the creature was tapped as it was declared as an attacker
        push('becomes', { subject: objects(handle(e.objectId)), player: players(controllerOf(e.objectId) ?? s.turn.activePlayer) }, data({ what: e.type, ...(e.asAttacker === true ? { asAttacker: true } : {}) }), gone(e.objectId));
        break;
      // M6-0 (m6 design 2.3): turning face down (CR 708.2b), flipping (CR 710), mutating (CR 702.140d) and melding (CR 701.42a) are "becomes" changes too
      case 'turnedFaceDown':
      case 'flipped':
      case 'mutated':
      case 'melded':
        push('becomes', { subject: objects(handle(e.objectId)), player: players(controllerOf(e.objectId) ?? s.turn.activePlayer) }, data({ what: e.type }), gone(e.objectId));
        break;
      case 'transformed': {
        // CR 701.27e (M6-0): converting is also transforming for "transforms into"; a converted permanent becomes 'converted' too (CR 701.28)
        const roles = { subject: objects(handle(e.objectId)), player: players(controllerOf(e.objectId) ?? s.turn.activePlayer) };
        push('becomes', roles, data({ what: 'transformed', convert: e.convert }), gone(e.objectId));
        if (e.convert) push('becomes', roles, data({ what: 'converted' }), gone(e.objectId));
        break;
      }
      // Standard round 5, r5-trig (CR 702.122b, 702.171c): a creature tapped to pay a crew / saddle cost: the Vehicle or Mount (`subject`) and the creature (`source`)
      case 'crewTapped':
        push('becomes', { subject: objects(handle(e.objectId)), source: objects(handle(e.by)), player: players(e.player) }, data({ what: e.as === 'crew' ? 'crewCostPaid' : e.as === 'teamwork' ? 'teamworkCostPaid' : 'saddleCostPaid' }), gone(e.objectId));
        break;
      // edh-d-39 (CR 702.26b-c, 603.2, 603.10a): a permanent phases out or in; a permanent that phases out is phased out when the trigger is collected, so the matcher reads it as it was (look back)
      case 'phasedOut':
      case 'phasedIn':
        push('becomes', { subject: objects(handle(e.objectId)), player: players(controllerOf(e.objectId) ?? s.turn.activePlayer) }, data({ what: e.type }), gone(e.objectId));
        break;
      case 'objectDesignation':
        // M6-0: a Case becomes solved (CR 719.3b), a permanent becomes prepared (CR 722.3a), a Class becomes level N (CR 716.2a); becoming unprepared is no pattern
        if (e.what !== 'unprepared' && e.what !== 'unsuspected') push('becomes', { subject: objects(handle(e.objectId)), player: players(controllerOf(e.objectId) ?? s.turn.activePlayer) }, data({ what: e.what, level: e.level }), gone(e.objectId));
        break;
      case 'doorUnlocked': {
        // FAST5X E8 (CR 709.5h-i): a door unlocked (`face`, by `player`), and the Room fully unlocked by it; locking a door is no pattern
        if (e.lock === true) break;
        const roles = { subject: objects(handle(e.objectId)), player: players(e.player) };
        push('becomes', roles, data({ what: 'unlocked', face: e.face }), gone(e.objectId));
        if (e.full) push('becomes', roles, data({ what: 'fullyUnlocked' }), gone(e.objectId));
        break;
      }
      case 'dayNight':
        push('dayNight', {}, data({ to: e.to })); // M6-0: CR 731.1a
        break;
      case 'designationChanged':
        // edh-players-18 (CR 725.1, 725.3): a player becomes the monarch (the previous monarch ceases to be it; day and night have their own `dayNight`; the initiative has no pattern)
        if (e.what === 'monarch' && e.to !== 'day' && e.to !== 'night') push('monarch', { player: players(e.to) }, data({}));
        break;
      case 'becameCopy': // M6-0: CR 707.4, a copy effect begins: no pattern reads it (no enters or leaves triggers)
        break;
      case 'damagePrevented': {
        // edh-replace-3 (CR 615.13): "Some triggered abilities trigger when damage that would be dealt is prevented. Such an ability triggers each time a prevention effect is applied to
        // one or more simultaneous damage events and prevents some or all of that damage." One occurrence for each effect and recipient: the consecutive events of the same effect
        // for the same recipient in the same simultaneous batch (effects/damage-batch.ts) are added up into the first of them, whatever lies between them.
        const same = (x: GameEvent | undefined): x is Extract<GameEvent, { type: 'damagePrevented' }> => x?.type === 'damagePrevented' && x.effect === e.effect && x.batch === e.batch && x.target[0] === e.target[0];
        if (events.slice(0, i).some(same)) break; // already added up into the first of them
        let amount = e.amount;
        const sources = [...e.source];
        for (let j = i + 1; j < events.length; j++) {
          const x = events[j];
          if (!same(x)) continue;
          amount += x.amount;
          for (const src of x.source) if (!sources.includes(src)) sources.push(src);
        }
        const target = e.target[0]!;
        const roles: SemEvent['roles'] = { source: objects(...sources.map(handle)) };
        if (isPlayer(target)) roles.recipient = players(target);
        else roles.object = objects(handle(target));
        const controller = controllerOf(sources[0]!);
        if (controller) roles.player = players(controller);
        push('damagePrevented', roles, data({ amount, toPlayer: isPlayer(target), target }), { ...Object.assign({}, ...sources.map(gone)), ...(isPlayer(target) ? {} : gone(target)) });
        break;
      }
      case 'attached':
        // std-rx31 (CR 701.3a, 603.2): the permanent it became attached to is the event's `object` ("Whenever this Equipment becomes attached to a creature, ... that creature")
        // edh-perms-10 (CR 701.3d, 603.2; Grafted Exoskeleton): the permanent an unattached Equipment left is the event's `object` too ("... becomes unattached from a permanent, sacrifice that permanent")
        push('becomes', { subject: objects(handle(e.objectId)), player: players(controllerOf(e.objectId) ?? s.turn.activePlayer), ...(e.to ? { object: objects(handle(e.to)) } : e.from ? { object: objects(handle(e.from)) } : {}) },
          data({ what: e.to === null ? 'unattached' : 'attached', to: e.to ?? undefined, ...(e.from ? { from: e.from } : {}) }), { ...gone(e.objectId), ...(e.from ? gone(e.from) : {}) });
        break;
      case 'becameTarget': {
        const by = s.objects[e.byStackId] ?? s.lki[e.byStackId]?.object;
        const roles: SemEvent['roles'] = { spell: objects({ id: e.byStackId, zone: 'stack' }), player: players(isPlayer(e.objectId) ? e.objectId : controllerOf(e.objectId) ?? e.byController) };
        if (!isPlayer(e.objectId)) roles.subject = objects(handle(e.objectId));
        const src = by?.stack?.sourceId ?? e.byStackId;
        roles.source = objects(handle(src));
        push('becomes', roles, data({ what: 'targeted', targetIsPlayer: isPlayer(e.objectId), byController: e.byController }), { ...(isPlayer(e.objectId) ? {} : gone(e.objectId)), ...gone(e.byStackId), ...gone(src) });
        break;
      }
      case 'countersChanged': {
        if (e.delta === 0) break;
        const onPlayer = isPlayer(e.target);
        const roles: SemEvent['roles'] = onPlayer ? { player: players(e.target) } : { subject: objects(handle(e.target)), player: players(controllerOf(e.target) ?? s.turn.activePlayer) };
        push('counters', roles, data({ change: e.delta > 0 ? 'put' : 'removed', kind: e.counter, amount: Math.abs(e.delta), total: totalAfter(i, e.target, e.counter), onPlayer, by: e.by }), onPlayer ? {} : gone(e.target)); // FAST5X E21: `by`, who put them (CR 122.6)
        break;
      }
      case 'actionPerformed': {
        const roles: SemEvent['roles'] = { player: players(e.actor) };
        if (e.objectId) roles.subject = objects(handle(e.objectId));
        if (e.exploited) roles.object = objects(handle(e.exploited)); // std-rx17 (CR 702.110b): the creature an exploiting creature sacrificed
        // FAST5X E20 (CR 700.14): an `expend` action carries the mana spent this turn to cast spells before and after the payment (triggers/match.ts reads N)
        // CLOUD std-dft: `x`, the X announced for the cycling cost of a `cycle` action (actions/activate.ts); std-lci: `revealed` of an explore (CR 701.44a)
        // std-rx26: a `discover` action's N is also its amount (CR 701.57a: "discover again for the same value", `{q:'eventAmount'}`)
        push('action', roles, data({ verb: e.verb, spentBefore: e.spent?.before, spentAfter: e.spent?.after, x: e.x, revealed: e.revealed, won: e.won /* p2-player-rules-3 (CR 701.30c) */, ...(e.verb === 'discover' || e.verb === 'scry' /* edh-next-38 (CR 701.22a): the cards looked at */ || e.verb === 'scryBottom' /* edh-d-96: the cards put on the bottom */ ? { amount: e.x } : {}), ...(e.verb === 'search' ? { zone: e.zone, zoneOwner: e.owner } : {}) }), { ...(e.objectId ? gone(e.objectId) : {}), ...(e.exploited ? gone(e.exploited) : {}) }); // r4-trig: the zone a search searched and its owner (CR 701.23a)
        // "becomes monstrous / renowned / saddled / crewed" are the same happenings seen as a state change of the permanent (CR 701.37, 702.112, 702.171, 702.122).
        const became = BECOMES_VERBS[e.verb];
        if (became && e.objectId) push('becomes', { subject: objects(handle(e.objectId)), player: players(e.actor) }, data({ what: became, ...(became === 'monstrous' && e.x !== undefined ? { x: e.x } : {}) /* edh-perms-16 (CR 701.37a): the N of the monstrosity */, ...(became === 'crewed' && e.crewers !== undefined ? { crewers: e.crewers } : {}) /* edh-d-89 (CR 702.122e) */ }), gone(e.objectId));
        break;
      }
      case 'votesFinished':
        // M12F (CR 701.38a): "whenever players finish voting", once per vote. The ballots travel as JSON (SemEvent.data is flat); `byHand` when the vote was
        // resolved by hand and who voted for what is not known.
        push('action', { player: players(e.starter) }, data({ verb: 'votesFinished', byHand: e.ballots === undefined ? true : undefined, ballots: e.ballots ? JSON.stringify(e.ballots) : undefined }));
        break;
      case 'manaAdded': {
        // CR 605.3b: mana added by activating a mana ability is that activation (it never uses the stack, so no `abilityActivated` event exists for it). Only
        // the activation path says so (`viaActivation`, WP13 INTERFACE CHANGE): a triggered mana ability (CR 605.1b, 605.4a) or a spell or ability that adds
        // mana records its source too (CR 106.3), and must not look like an activation (a "tap for mana" trigger would otherwise retrigger on its own mana).
        const src = e.sourceId ? s.objects[e.sourceId] ?? s.lki[e.sourceId]?.object : undefined;
        if (e.viaActivation && e.sourceId && src && src.kind !== 'ability' && src.zone !== 'stack') {
          push('activate', { source: objects(handle(e.sourceId)), player: players(e.player) }, data({ mana: true, produced: e.mana.join(''), exhaust: e.exhaust, tapped: e.tapped }), gone(e.sourceId)); // FAST5X E20: `exhaust` (CR 702.177a); T38: the mana produced, for "any type that land produced"; std-mana-1: `tapped`, the ability had {T} in its cost (CR 106.12)
        }
        break;
      }
      case 'landPlayed':
        // cloud std-spm (CR 305.1): with the zone the land was played from ("whenever you play a land from exile")
        push('action', { player: players(e.player), subject: objects(handle(e.objectId)) }, data({ verb: 'playLand', ...(e.from !== undefined ? { from: e.from } : {}) }));
        break;
      case 'shuffled':
        push('action', { player: players(e.player) }, data({ verb: 'shuffle' }));
        break;
      case 'countered':
      case 'abilityCountered':
        // edh-cast-6 (CR 701.6a): the player in control of the spell or ability that countered it is the actor of a spell's counter ("a spell or ability you control counters a spell")
        push('action', { subject: objects({ id: e.objectId, zone: 'stack' }), ...(e.type === 'countered' && e.by !== undefined ? { player: players(e.by) } : {}) }, data({ verb: 'counter' }), gone(e.objectId));
        break;
      case 'tokenCreated':
        if (!out.some((x) => x.ev === 'createToken' && x.data['newId'] === e.objectId)) {
          push('createToken', { newObject: objects(handle(e.objectId)), player: players(e.player) }, data({ newId: e.objectId }));
        }
        break;
      case 'dieRolled':
        // WP15 INTERFACE CHANGE: the result is also the event's amount, so an ability triggered by the roll reads it as "the result" (q:dieResult, CR 706.2)
        push('dieRoll', { player: players(e.player) }, data({ result: e.result, sides: e.sides, amount: e.result, instruction: e.instruction, natural: e.natural }));
        break;
      case 'coinFlipped':
        // cloud r3-mech (CR 705.2): a called flip and whether its player won it
        push('coinFlip', { player: players(e.player) }, data({ won: e.won }));
        break;
      case 'resolved': {
        // edhn102 (CR 113.7a, 608.2h, 714.2e; Narci, Fable Singer): of an ability, the source it came from (the Saga of a final chapter ability), read as it last existed
        const ab = s.objects[e.objectId] ?? s.lki[e.objectId]?.object;
        const src = ab?.kind === 'ability' ? ab.stack?.sourceId : undefined;
        push('resolves', { subject: objects({ id: e.objectId, zone: 'stack' }), ...(src !== undefined ? { abilitySource: objects(handle(src)) } : {}) }, data({}), { ...gone(e.objectId), ...(src !== undefined ? gone(src) : {}) });
        break;
      }
      case 'controlChanged':
        // Standard round 3, r3-trig (CR 108.4, 613.1b): the control of a permanent passed from one player to another ("whenever an opponent gains control of a permanent
        // from you"): the permanent and the player who gained control
        push('controlChange', { subject: objects(handle(e.objectId)), player: players(e.to) }, data({ from: e.from, to: e.to }));
        break;
      case 'playerLost':
        // M12-3 (CR 603.9): "These abilities trigger when a player loses or leaves the game, regardless of the reason, unless that player leaves the game as the
        // result of a draw." A draw ends the game (CR 104.4a; this build has no range of influence, so no draw for only some players, CR 104.4e-f): a loss
        // that ends in a draw triggers nothing.
        if (s.result !== null && s.result.winner === null) break;
        push('loseGame', { player: players(e.player) }, data({ reason: e.reason }));
        break;
      case 'playerLeft':
        // M12-2 (m12 design D9, 4.4): CR 603.6c, "Leaves-the-battlefield abilities trigger ... when a phased-in permanent leaves the game because its owner leaves
        // the game." Each removed phased-in permanent is a zone change from the battlefield to no zone (no `to`): a pattern with `from: 'battlefield'` and no
        // `to` matches it ("leaves the battlefield"), one with a destination never does (it did not die, was not exiled, CR 603.6c, 700.4); a phased-out one
        // triggers nothing (CR 702.26k). Its last known information is in `lki` (CR 603.10a). Exiled objects have their own `zoneChanged` events.
        for (const id of e.removed) {
          const lk = s.lki[id];
          if (!lk || lk.leftZone !== 'battlefield' || lk.object.phasedOut) continue;
          const d = data({ from: 'battlefield', oldId: id, cause: 'leftGame', owner: lk.object.owner, name: s.defs[lk.object.defId]?.name ?? id });
          push('zoneChange', { subject: objects({ id, zone: 'battlefield' }), player: players(lk.object.controller) }, d, { [id]: lk });
        }
        break;
      default:
        break; // gameStarted, priorityGiven, manaAdded, mulligan, designationChanged, ...: no pattern of the model reads them (yet)
    }
  });
  return out;
};
