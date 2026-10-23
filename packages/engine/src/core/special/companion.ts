/**
 * The companion special action (CR 702.139a, 116.2g). Owner: CMP1.
 *
 * "Once during the game, any time you have priority and the stack is empty, but only during a main phase of your turn, you may pay {3} and put that card
 * into your hand. This is a special action that doesn't use the stack" (CR 702.139a); CR 116.2g: "only if they haven't done so yet this game". The card is
 * the player's revealed companion (`PlayerState.companion`, from `PlayerConfig.companion`, CR 103.2b), outside the game (`GameState.outside`, CR 400.11).
 *
 * Listed (core/legal.ts) for the player with priority while: they have a revealed companion they have not put into their hand yet, the card is still
 * outside the game, it is their own turn, a main phase, the stack is empty (rules/timing.ts#sorceryTiming, the same three conditions), and {3} can be paid
 * now. The action names no object (the card is in no zone, CR 400.11): `{type:'special', kind:'companion'}`. Performing it pays {3} with the usual
 * (cancellable, CR 733.1) payment, which auto-payment answers like any other cost, then puts the card into its owner's hand as a new object
 * (core/zones.ts#bringIntoGame; CR 400.11b, 702.139c: it stays in the game until the game ends) and records the turn (`CompanionRec.inHand`).
 *
 * The payment and the zone change are performed by effects/handlers/companion-ops.ts, which installs itself here when it loads (this module is reached from
 * core/registries.ts, which core/zones.ts imports: as core/special/plot.ts).
 */
import type { CostDef } from '../../types/ability';
import type { PlayerId } from '../../types/ids';
import type { GameState } from '../../types/state';
import { sorceryTiming } from '../../rules/timing';
import { IllegalAction, type Game } from '../game';
import type { SpecialActionHandler } from '../registries';

/** CR 702.139a, 116.2g: "pay {3}". */
export const COMPANION_COST: CostDef = { mana: [{ kind: 'generic', amount: 3 }] };

/** What performs the action (installed by effects/handlers/companion-ops.ts). */
export interface CompanionImpl {
  /** Could `player` pay {3} for this special action now (CR 118.3)? */
  payable(s: GameState, player: PlayerId): boolean;
  /** Pay {3} (cancellable decisions, CR 733.1) and put the companion into the player's hand (CR 702.139a). */
  perform(g: Game, player: PlayerId): void;
}
let impl: CompanionImpl | null = null;
export function installCompanion(f: CompanionImpl | null): void {
  impl = f;
}

/**
 * Why `player` can't take the companion action now (a short reason, for tests and tooltips), or null when they can. Pure. Priority itself is checked by the
 * caller: core/legal.ts lists actions only for the player who has priority.
 */
export function companionDenial(s: GameState, player: PlayerId): string | null {
  const rec = s.players.find((p) => p.id === player)?.companion;
  if (!rec) return 'You have no companion.';
  if (rec.inHand !== undefined) return 'You already put your companion into your hand this game (CR 116.2g).';
  if (!(s.outside?.[player] ?? []).includes(rec.defId)) return 'Your companion is no longer outside the game.';
  // CR 702.139a, 116.2g: a main phase of your turn, the stack empty
  const timing = sorceryTiming(s, player, 'put your companion into your hand', 'CR 702.139a');
  if (timing) return timing.message;
  if (!impl) return 'The companion action is not available in this build.'; // fail closed
  if (!impl.payable(s, player)) return "You can't pay {3} now.";
  return null;
}

function listed(g: Game, player: PlayerId): { label: string; cost: CostDef }[] {
  if (companionDenial(g.s, player) !== null) return [];
  const name = g.s.defs[g.s.players.find((p) => p.id === player)!.companion!.defId]?.name ?? 'your companion';
  return [{ label: `Companion: pay {3} and put ${name} into your hand`, cost: COMPANION_COST }];
}

export const COMPANION_HANDLERS: readonly SpecialActionHandler[] = [
  {
    kind: 'companion',
    list: (g, player) => listed(g, player),
    perform: (g, action) => {
      const reason = companionDenial(g.s, action.player);
      if (reason !== null || action.object !== undefined) {
        throw new IllegalAction(reason ?? 'The companion action names no object (the card is outside the game, CR 400.11).', ['CR 116.1', 'CR 116.2g', 'CR 702.139a']);
      }
      impl!.perform(g, action.player);
    },
  },
];
