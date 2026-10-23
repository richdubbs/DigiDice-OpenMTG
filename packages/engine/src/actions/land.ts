/**
 * Playing a land (CR 305, 116.2a): a special action that doesn't use the stack, so the player keeps
 * priority afterwards (CR 116.2a, 117.3c). By default one land per turn, during the player's own main
 * phase with an empty stack (CR 305.1, 305.2).
 */
import type { Action } from '../types/actions';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameState } from '../types/state';
import { IllegalAction, type Game } from '../core/game';
import { warnUnsupportedText } from '../core/manual';
import { moveObject } from '../core/zones';
import { canSee } from '../core/view';
import { faceChars, hasType } from '../rules/characteristics';
import { assertAllowed, deny, type Denial } from '../rules/denial';
import { gameOf, hookpoints } from '../rules/hookpoints';
import { sorceryTiming } from '../rules/timing';
import { additionalLandPlays } from '../statics/hooks';
import { graveyardLandKey, namedPermit, namedPermitLandTapped, namedSingleKey, playPermitted, topPermitFor } from '../statics/play-permits';
import { installResolutionLandPlayer } from '../effects/cast-hook';

/** How many lands the player can play this turn (CR 305.2: one, plus what rule modifications and permissions add; WP16: statics/hooks.ts#additionalLandPlays). */
export function landsAllowed(s: GameState, player: PlayerId): number {
  return 1 + additionalLandPlays(s, player);
}

/** The one denial for playing a card the player can't see as a land (M1). */
export const HIDDEN_LAND = "You can't play that card.";

/** CR 305.1: may this player play this card as a land now? Pure. Returns the face that enters. */
export function landCheck(s: GameState, player: PlayerId, id: ObjectId, requestedFace?: number): { denial: Denial } | { face: number } {
  const o = s.objects[id];
  // M1 (audit 2026-10-12; CR 400.2): a card the player can't see, or an id that names nothing, gets one answer whatever it is.
  if (!o || !canSee(s, o, player)) return { denial: deny(HIDDEN_LAND, 'CR 305.1', 'CR 400.2') };
  if (o.kind !== 'card') return { denial: deny('That card is not here.') };
  const def = s.defs[o.defId];
  if (!def) return { denial: deny('Unknown card.') };
  // FAST4 T31 (CR 305.1, 611.2): "you may play that card this turn": an effect allows this player to play this very card from where it is (statics/play-permits.ts)
  if ((o.zone !== 'hand' || o.owner !== player) && !playPermitted(s, player, id, true)) return { denial: deny('You can only play lands from your hand.', 'CR 305.1') };
  // FAST5X E14 (CR 305.1, 401.5): a card on top of the library that only a top-card permission allows ("You may play lands from the top of your library")
  const byTop = o.zone === 'library' && !namedPermit(s, player, id, true);

  // CR 712.12: a modal double-faced card is played as a land by choosing one of its faces that is a land.
  const candidates = def.layout === 'modal_dfc' ? def.faces.map((_, i) => i) : [0];
  const landFaces = candidates.filter((i) => hasType(faceChars(def, i), 'Land'));
  if (landFaces.length === 0) return { denial: deny(`${def.name} is not a land card.`, 'CR 305.1') };
  const face = requestedFace ?? landFaces[0]!;
  if (!candidates.includes(face)) return { denial: deny('That face of the card can\'t be played.', 'CR 712.12') };
  if (!landFaces.includes(face)) return { denial: deny(`${faceChars(def, face).name} is not a land.`, 'CR 712.12', 'CR 305.1') };
  // FAST5X E14: the permission's qualities are checked on the face played (statics/play-permits.ts#topPermitFor)
  if (byTop && topPermitFor(s, player, id, true, faceChars(def, face)) === null) return { denial: deny(`No effect lets you play ${faceChars(def, face).name} from the top of your library.`, 'CR 305.1') };

  const timing = sorceryTiming(s, player, 'play a land', 'CR 305.1');
  if (timing) return { denial: timing };
  const p = s.players.find((x) => x.id === player)!;
  if (p.landsPlayedThisTurn >= landsAllowed(s, player)) return { denial: deny('You have already played a land this turn.', 'CR 305.2', 'CR 305.2a') };
  const hook = hookpoints.canPlayLand(gameOf(s), id, player, face); // restrictions from static abilities (WP16); WP31 review: with the face played (CR 712.12, 614.17d)
  if (hook) return { denial: hook };
  return { face };
}

export function playLand(g: Game, action: Extract<Action, { type: 'playLand' }>): void {
  const { player } = action;
  const check = landCheck(g.s, player, action.card, action.face);
  if ('denial' in check) {
    assertAllowed(check.denial);
    return;
  }
  const old = g.obj(action.card);
  // std-rx27 (CR 305.1): a land played with a one-card permission ("you may play a card exiled with ~") spends it (statics/play-permits.ts#namedSingleKey)
  const single = old.zone !== 'hand' ? namedSingleKey(g.s, player, action.card, true) : null;
  if (single !== null) g.s.turnActivations[single] = (g.s.turnActivations[single] ?? 0) + 1;
  // std-rx27 (CR 305.2): "During each of your turns, you may play a land ... from your graveyard": a once-each-turn graveyard land permission is spent
  const gyLand = old.zone === 'graveyard' && single === null && !namedPermit(g.s, player, action.card, true) ? graveyardLandKey(g.s, player, action.card) : null;
  if (gyLand !== null) g.s.turnActivations[gyLand] = (g.s.turnActivations[gyLand] ?? 0) + 1;
  const name = faceChars(g.s.defs[old.defId]!, check.face).name;
  const from = old.zone; // cloud std-spm: "whenever you play a land from exile" reads the zone it was played from
  // CR 305.1 / 116.2a: the land goes straight onto the battlefield; it is never a spell.
  // std-exile-play-1-3 (CR 614.1c): "Each land played this way enters tapped" on the permission it is played with (statics/play-permits.ts#namedPermitLandTapped)
  const tapped = from !== 'hand' && namedPermitLandTapped(g.s, player, action.card);
  const id = moveObject(g, action.card, 'battlefield', { face: check.face, controller: player, cause: 'play land', ...(tapped ? { tapped: true } : {}) });
  if (!id) throw new IllegalAction('The land could not be put onto the battlefield.', ['CR 305.1']);
  g.player(player).landsPlayedThisTurn++; // CR 305.2a
  g.emit({ type: 'landPlayed', objectId: id, player, from });
  g.log(`${g.player(player).name} plays ${name}.`, { rules: ['CR 305.1', 'CR 116.2a'], level: 'action' });
  warnUnsupportedText(g, id); // e.g. "enters tapped" is not automated yet
}

/**
 * FAST5X E26 (hideaway, CR 702.75a: "you may play the exiled card"): may `player` play the card `id` as a land while an effect resolves? The effect gives the
 * permission the zone and timing rules of CR 305.1 stand for; what stays is CR 305.3 (only during their own turn), CR 305.2a-b (a land play left this turn), a
 * land face (CR 305.9, 712.12: a modal double-faced card's first land face) and the restrictions of static abilities. Pure. Returns the face that enters.
 */
export function landDuringCheck(s: GameState, player: PlayerId, id: ObjectId): { denial: Denial } | { face: number } {
  const o = s.objects[id];
  if (!o || o.kind !== 'card') return { denial: deny('That card is not here.') };
  const def = s.defs[o.defId];
  if (!def || def.stub) return { denial: deny('Unknown card.') };
  const candidates = def.layout === 'modal_dfc' ? def.faces.map((_, i) => i) : [0];
  const face = candidates.find((i) => hasType(faceChars(def, i), 'Land'));
  if (face === undefined) return { denial: deny(`${def.name} is not a land card.`, 'CR 305.1') };
  if (s.turn.activePlayer !== player) return { denial: deny("A land can be played only during its player's own turn.", 'CR 305.3') };
  const p = s.players.find((x) => x.id === player)!;
  if (p.landsPlayedThisTurn >= landsAllowed(s, player)) return { denial: deny('You have already played a land this turn.', 'CR 305.2a', 'CR 305.2b') };
  const hook = hookpoints.canPlayLand(gameOf(s), id, player, face);
  if (hook) return { denial: hook };
  return { face };
}

installResolutionLandPlayer({
  check: (g, player, card) => {
    const r = landDuringCheck(g.s, player, card);
    return 'denial' in r ? r.denial : null;
  },
  play: (g, player, card) => {
    const r = landDuringCheck(g.s, player, card);
    if ('denial' in r) return null;
    const name = faceChars(g.s.defs[g.obj(card).defId]!, r.face).name;
    const from = g.obj(card).zone; // cloud std-spm (CR 305.1): the zone it is played from
    const id = moveObject(g, card, 'battlefield', { face: r.face, controller: player, cause: 'play land' }); // CR 305.1: it never is a spell
    if (!id) return null;
    g.player(player).landsPlayedThisTurn++; // CR 305.2a: it counts as the land played this turn
    g.emit({ type: 'landPlayed', objectId: id, player, from });
    g.log(`${g.player(player).name} plays ${name}.`, { rules: ['CR 305.1', 'CR 305.2a', 'CR 608.2g'], level: 'action' });
    warnUnsupportedText(g, id);
    return id;
  },
});
