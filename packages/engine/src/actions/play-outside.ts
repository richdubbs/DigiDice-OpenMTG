/**
 * The `playOutside` special action's checker and performer (CR 400.11, 400.11b, 305.1, 601.3), installed into core/special/play-outside.ts when this module loads
 * (that module can import neither the cast path nor the zone mover: see its file comment; and it lives in actions/ because effects/ may not import actions, design 5.4:
 * core/legal.ts and core/priority-actions.ts import it for its effect). Owner: trek-11.
 *
 * A card outside the game is staged (core/zones.ts#stageFromOutside) as a card in its owner's hand marked `fromOutside`, and the ordinary land play
 * (actions/land.ts) or cast (actions/cast.ts) runs on it: both read the marker, take the permission that covers cards outside the game
 * (statics/play-permits.ts#outsideLandKey, outsideCastUses) in place of the zone rules, and treat the card as coming from no zone. Offering stages a copy of
 * the state, never the real one.
 */
import { Game, IllegalAction } from '../core/game';
import { installPlayOutside } from '../core/special/play-outside';
import { stageFromOutside } from '../core/zones';
import { faceChars, hasType } from '../rules/characteristics';
import { outsidePermitAvailable, PERMANENT_CARD_TYPES } from '../statics/play-permits';
import type { DefId, PlayerId } from '../types/ids';
import type { GameState } from '../types/state';
import { cloneState } from '../util/clone';
import { castCheck, castSpell } from './cast';
import { landCheck, playLand } from './land';

/** What playing this card from outside the game would be, by its front face (CR 712.8a): a land play, a spell, or neither (not a permanent card: never offered). */
function playKind(s: GameState, defId: DefId): 'land' | 'spell' | null {
  const def = s.defs[defId];
  if (!def || def.isToken || def.stub) return null;
  const c = faceChars(def, 0);
  if (hasType(c, 'Land')) return 'land';
  return PERMANENT_CARD_TYPES.some((t) => hasType(c, t)) ? 'spell' : null;
}

/** Could `player` play this card from outside the game now? Checked on a copy of the state in which it is staged; the real one is not touched. */
function playable(s: GameState, player: PlayerId, defId: DefId): 'land' | 'spell' | null {
  const kind = playKind(s, defId);
  if (kind === null) return null;
  const copy = cloneState(s);
  const id = stageFromOutside(new Game(copy), player, defId);
  if (id === null) return null;
  const r = kind === 'land' ? landCheck(copy, player, id, 0) : castCheck(copy, player, id, 0);
  return 'denial' in r ? null : kind;
}

installPlayOutside({
  offers: (s, player) => {
    if (!outsidePermitAvailable(s, player)) return []; // no permission now (or none left this turn), or nothing outside the game: no card is staged
    const out: { defId: DefId; label: string }[] = [];
    for (const defId of new Set(s.outside?.[player] ?? [])) {
      const kind = playable(s, player, defId);
      if (kind === null) continue;
      const name = faceChars(s.defs[defId]!, 0).name;
      out.push({ defId, label: `${kind === 'land' ? 'Play' : 'Cast'} ${name} from outside the game` });
    }
    return out;
  },
  perform: (g, player, defId) => {
    if (!(g.s.outside?.[player] ?? []).includes(defId)) throw new IllegalAction('You own no such card outside the game.', ['CR 400.11', 'CR 400.11a']);
    const kind = playKind(g.s, defId);
    if (kind === null) throw new IllegalAction('Only a permanent card can be played from outside the game by this permission.', ['CR 400.11b', 'CR 110.4']);
    const id = stageFromOutside(g, player, defId);
    if (id === null) throw new IllegalAction('You own no such card outside the game.', ['CR 400.11', 'CR 400.11a']);
    if (kind === 'land') playLand(g, { type: 'playLand', player, card: id, face: 0 });
    else castSpell(g, { type: 'cast', player, card: id, face: 0 });
  },
});
