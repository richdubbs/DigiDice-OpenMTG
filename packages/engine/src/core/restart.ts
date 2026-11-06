/**
 * edh-next-137 (CR 727, 104.1, 104.6, 103; Karn Liberated): restarting the game. A game that is restarted ends at once; no player wins, loses or draws it (CR 727.1). The players
 * still in it begin a new game by the procedure of CR 103, except that the player who controlled the ability that restarted it is the starting player (CR 727.1a). Every card of
 * the ended game is in the new one (CR 727.2), its owner unchanged, except the cards the effect exempts (CR 727.5): those are not in their owner's deck and begin the new game in
 * exile. Nothing else carries over (the rulings of 2020-08-07): tokens, emblems, counters, continuous and delayed effects, designations, life totals, commander casts and commander
 * damage are gone; a commander begins in the command zone (CR 903.6) unless it was exempted (CR 727.5a: it stays that deck's commander). A player who left the game earlier is not in
 * the new one (they stay out). After the pregame procedure (shuffles, opening hands, mulligans, opening-hand actions: CR 103.3-103.6), the effect finishes resolving just before the
 * first turn's untap step (CR 727.4): the exempted cards are put onto the battlefield under the restarting player's control; the abilities that trigger then go on the stack the
 * first time a player receives priority. The request is made by the `restartGame` handler (effects/handlers/game.ts) and carried out here once the ability has left the stack
 * (core/turn.ts#allPassed): the old state is replaced as a whole (as a shortcut does, core/apply.ts), so the resolution that asked for it has nothing left to do.
 */
import type { GameObject, GameState, PlayerState } from '../types/state';
import type { ObjectId, PlayerId } from '../types/ids';
import type { Game } from './game';
import { drawCards, moveObject, shuffleLibrary } from './zones';
import { mulligans } from './mulligans';
import { openingHandActions } from './pregame';

/** What the `restartGame` instruction asked for: who restarts it, and the cards (still in exile) that are left out of the new game's decks. */
export interface RestartRequest { controller: PlayerId; keep: ObjectId[]; toBattlefield: boolean }

/** The players of the new game: the same seats and names, everything else as a game begins (CR 103.4, 727.1). Who left before stays out (rulings 2020-08-07). */
function freshPlayer(p: PlayerState, life: number): PlayerState {
  return {
    id: p.id, name: p.name, life, poison: 0, manaPool: [], landsPlayedThisTurn: 0, lastTurnStarted: 0, drewFromEmptyLibrary: false,
    hasLost: p.hasLost, ...(p.lostReason !== undefined ? { lostReason: p.lostReason } : {}), conceded: p.conceded, mulligans: 0, keptHand: p.hasLost, stops: p.stops, counters: {},
    turnStats: { lifeGained: 0, lifeLost: 0, spellsCast: 0, cardsDrawn: 0 },
    // CR 903.8, 903.10a; ruling 2020-08-07: the commander casts and the commander damage start over; the commanders are the same cards (CR 727.5a)
    ...(p.commanders !== undefined ? { commanders: p.commanders.map((c) => ({ ...c, casts: 0 })) } : {}),
    ...(p.left !== undefined ? { left: p.left } : {}), ...(p.companion !== undefined ? { companion: p.companion } : {}),
  };
}

/** Carry out a restart request on the game (see the file comment). */
/** `beginTurn`: core/turn.ts#beginNextTurn, passed by its caller (core/turn.ts imports this module; no import cycle). */
export function restartGame(g: Game, req: RestartRequest, beginTurn: (g: Game) => void): void {
  const old = g.s;
  const inGame = (p: PlayerId): boolean => old.players.some((x) => x.id === p && !x.hasLost);
  const keep = new Set(req.keep.filter((id) => old.objects[id]?.zone === 'exile' && old.objects[id]!.kind === 'card' && inGame(old.objects[id]!.owner)));
  // CR 727.1a: the restarting player first, the seats in the same order
  const seats = old.players;
  const at = Math.max(0, seats.findIndex((p) => p.id === req.controller));
  const players = [...seats.slice(at), ...seats.slice(0, at)].map((p) => freshPlayer(p, old.options.startingLife));
  const commanderCards = new Set(players.flatMap((p) => (p.commanders ?? []).map((c) => c.card)));
  const s: GameState = {
    schema: old.schema, seed: old.seed, rng: old.rng, options: old.options, defs: old.defs, players,
    objects: {},
    zones: { library: {}, hand: {}, graveyard: {}, battlefield: [], stack: [], exile: [], command: [] },
    turn: { number: 0, activePlayer: req.controller, step: 'untap', startingPlayer: req.controller, extraTurns: [], skipSteps: [] },
    stage: 'mulligan', priority: { player: null, passes: 0 }, combat: null, continuousEffects: [], pendingTriggers: [], turnActivations: {}, delayedTriggers: [],
    history: [], designations: {}, reminders: [], lki: {}, pending: null, suspended: null, log: old.log, result: null, counters: old.counters, actionCount: old.actionCount,
    ...(old.outside !== undefined ? { outside: old.outside } : {}), // CR 727.2: cards outside the game stay outside it
  };
  for (const p of players) { s.zones.library[p.id] = []; s.zones.hand[p.id] = []; s.zones.graveyard[p.id] = []; }
  // CR 727.2, 400.7: every card of the ended game, in any zone, as a new object of its owner (a token or a copy of a spell is no card and is gone): the exempted cards in exile,
  // a commander in the command zone (CR 903.6), every other card in its owner's library; in the order of the old objects, the library shuffled below (CR 103.3)
  const fresh = (o: Pick<GameObject, 'id' | 'cardId' | 'defId' | 'owner'>, zone: 'library' | 'exile' | 'command'): void => {
    const id = `o${s.counters.object++}`;
    s.objects[id] = {
      id, kind: 'card', ...(o.cardId !== undefined ? { cardId: o.cardId } : {}), defId: o.defId, owner: o.owner, controller: o.owner, zone,
      timestamp: s.counters.timestamp++, tapped: false, flipped: false, faceDown: false, phasedOut: false, face: 0,
      controlledSinceTurn: 0, counters: {}, damage: 0, deathtouchDamaged: false,
    };
    if (zone === 'library') s.zones.library[o.owner]!.push(id);
    else s.zones[zone].push(id);
    if (keep.has(o.id)) newIds.set(o.id, id);
  };
  const newIds = new Map<ObjectId, ObjectId>();
  for (const o of Object.values(old.objects).sort((a, b) => a.timestamp - b.timestamp)) {
    // a merged or melded permanent is several cards (CR 730.2, 712.8g): each card component is a card of its owner in the new game (a token component is gone);
    // such a permanent is never one of the kept cards (those are cards in exile)
    if (o.components !== undefined && o.components.length > 0) {
      for (const [k, c] of o.components.entries()) {
        if (c.kind !== 'card' || !inGame(c.owner)) continue;
        fresh({ id: `${o.id}#${k}`, cardId: c.cardId, defId: c.defId, owner: c.owner }, c.cardId !== undefined && commanderCards.has(c.cardId) ? 'command' : 'library');
      }
      continue;
    }
    if (o.kind !== 'card' || !inGame(o.owner)) continue;
    fresh(o, keep.has(o.id) ? 'exile' : o.cardId !== undefined && commanderCards.has(o.cardId) ? 'command' : 'library');
  }
  g.s = s;
  g.log('The game is restarted: it ends, and its players begin a new game.', { rules: ['CR 727.1', 'CR 104.1', 'CR 104.6'], level: 'action' });
  g.log(`${g.player(req.controller).name} will take the first turn.`, { rules: ['CR 727.1a', 'CR 103.1'] });
  // CR 103.3-103.6: shuffle, opening hands, mulligans, opening-hand actions
  for (const p of s.players) if (!p.hasLost) shuffleLibrary(g, p.id);
  const handSize = s.options.startingHandSize;
  for (const p of s.players) if (!p.hasLost) drawCards(g, p.id, handSize);
  if (!s.options.skipMulligans) mulligans(g, handSize);
  for (const p of s.players) p.keptHand = true;
  openingHandActions(g);
  // CR 727.4: the effect finishes resolving just before the first turn's untap step: the exempted cards onto the battlefield under the restarting player's control
  s.stage = 'playing';
  if (req.toBattlefield) for (const id of newIds.values()) if (g.s.objects[id]?.zone === 'exile') moveObject(g, id, 'battlefield', { controller: req.controller, cause: 'resolve' });
  g.emit({ type: 'gameStarted', startingPlayer: req.controller });
  g.log('The new game begins.', { rules: ['CR 727.4', 'CR 103.8'], level: 'action' });
  beginTurn(g);
}
