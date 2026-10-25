/**
 * Playing a card from outside the game, the `playOutside` special action (CR 400.11, 400.11a-b, 305.1, 601.3). Owner: trek-11.
 *
 * "Once during each of your turns, you may play a permanent card you own from outside the game or from your graveyard." (The Holodeck): a permission
 * (`PermissionDef.alsoOutside`, statics/play-permits.ts#isPermanentPlayPermit) over the cards a player owns outside the game, their sideboard
 * (`GameState.outside`, CR 400.11a: the same cards the "wish" effects of effects/handlers/outside.ts and learn read). A card outside the game is no object
 * (CR 400.11), so the legal action names it by its definition id (`Action` 'special', `outside`) and carries no `object`. Its graveyard half is no special action: a
 * card in the graveyard is played through the ordinary `cast` and `playLand` actions (core/legal.ts), with the same once-each-turn counter.
 *
 * Listed (core/legal.ts) for the player with priority, for each different card they own outside the game whose front face (CR 712.8a: outside the game a card has its
 * front face's characteristics) is a permanent card that could be played now: a land card as a land play (CR 305.1; the timing and the land plays left are
 * actions/land.ts#landCheck's), any other permanent card as a spell (CR 601.3; its mana cost, its timing and every other check are actions/cast.ts#castCheck's).
 * The checks are made on a copy of the state in which the card is staged (core/zones.ts#stageFromOutside), so offering changes nothing. Performing it stages the card
 * in the real state and runs the ordinary play: the cast or land play spends the permission's use (one counter for the two places) and puts the card on the stack
 * or the battlefield as a card coming from no zone. A refusal or a cancel (CR 733.1) leaves the state it began with: the card is still outside the game.
 *
 * Not here (fail closed): a card that is not a permanent card by its front face, a cast with an alternative cost, a back face, a card the player doesn't own, and every
 * permission but the one form isPermanentPlayPermit honors.
 *
 * The checks and the play are performed by actions/play-outside.ts, which installs itself here when it loads: this module is reached from
 * core/registries.ts, which core/zones.ts imports, so it may import neither the cast path nor the zone mover (an import cycle; as core/special/companion.ts).
 */
import type { DefId, PlayerId } from '../../types/ids';
import type { GameState } from '../../types/state';
import { IllegalAction, type Game } from '../game';
import type { SpecialActionHandler } from '../registries';

/** What checks and performs the action (installed by actions/play-outside.ts). */
export interface PlayOutsideImpl {
  /** The different cards `player` owns outside the game that they could play now, with the label of the action. Pure. */
  offers(s: GameState, player: PlayerId): { defId: DefId; label: string }[];
  /** Play the card (stage it, then the ordinary land play or cast): throws IllegalAction when it can't be played now. */
  perform(g: Game, player: PlayerId, defId: DefId): void;
}
let impl: PlayOutsideImpl | null = null;
export function installPlayOutside(i: PlayOutsideImpl | null): void {
  impl = i;
}

export const PLAY_OUTSIDE_HANDLERS: readonly SpecialActionHandler[] = [
  {
    kind: 'playOutside',
    hidden: true, // the cards a player owns outside the game are a hidden place (CR 400.11a: their sideboard): public questions leave the action out
    list: (g, player) => (impl ? impl.offers(g.s, player).map((o) => ({ outside: o.defId, label: o.label, cost: null })) : []),
    perform: (g, action) => {
      if (!impl) throw new IllegalAction('Playing a card from outside the game is not available in this build.', ['CR 400.11']); // fail closed
      if (action.outside === undefined || action.object !== undefined) {
        throw new IllegalAction('Playing a card from outside the game names the card by its definition, not by an object (a card outside the game is in no zone, CR 400.11).', ['CR 116.1', 'CR 400.11']);
      }
      impl.perform(g, action.player, action.outside);
    },
  },
];
