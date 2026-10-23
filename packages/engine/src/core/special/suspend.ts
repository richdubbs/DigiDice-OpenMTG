/**
 * Suspend, the special action (CR 702.62a, 116.2f). Owner: std-rx22.
 *
 * "Suspend N--[cost]" means "If you could begin to cast this card by putting it onto the stack from your hand, you may pay [cost] and exile it with N time
 * counters on it. This action doesn't use the stack" (CR 702.62a); taking it is a special action (CR 116.2f: "any time the player has priority and could cast
 * that card"). Listed (core/legal.ts, for the player with priority) for each card with suspend in the player's hand when the card's timing allows casting it now
 * (rules/timing.ts#castTiming: an instant or a card with flash at any time, otherwise a main phase of the player's own turn with an empty stack) and the cost
 * can be paid now. A card with no mana cost may be suspended (it has a suspend cost; casting it is never begun). Performing it pays the cost (cancellable
 * decisions, CR 733.1), exiles the card and puts N time counters on the card in exile: it is then suspended (CR 702.62b: in exile, has suspend, and has a time
 * counter). The two triggered abilities that work from exile are the keyword's expansion (keywords/data/suspend.json); the second gives the cast creature its haste (audit-fix-2).
 *
 * Not here (fail closed): a suspend amount that is not a fixed number ("Suspend X", CR 702.62a with X chosen as the action is taken), a cost with X, and effects
 * that suspend a card or give it suspend (CR 702.62c-d) are not offered, so the cards that say so stay manual.
 *
 * The payment and the zone change are performed by effects/handlers/suspend-ops.ts, which installs itself here when it loads (an import cycle otherwise, as
 * core/special/plot.ts).
 */
import type { CostDef } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import { formatManaCost } from '../../types/mana';
import type { GameObject, GameState } from '../../types/state';
import { charsOfObject } from '../../rules/characteristics';
import { castTiming } from '../../rules/timing';
import { IllegalAction, type Game } from '../game';
import type { SpecialActionHandler } from '../registries';

/** A card's suspend: its number of time counters and its cost (CR 702.62a). */
export interface SuspendTerms {
  amount: number;
  cost: CostDef;
}

/** What performs the action (installed by effects/handlers/suspend-ops.ts, see the file comment). */
export interface SuspendImpl {
  /** Could `player` pay this suspend cost now (CR 118.3)? */
  payable(s: GameState, player: PlayerId, id: ObjectId, cost: CostDef): boolean;
  /** Pay the cost (cancellable decisions, CR 733.1), exile the card from the hand and put the time counters on it (CR 702.62a). */
  perform(g: Game, player: PlayerId, id: ObjectId, terms: SuspendTerms): void;
}
let impl: SuspendImpl | null = null;
export function installSuspend(f: SuspendImpl | null): void {
  impl = f;
}

/**
 * The suspend of the card as it is in the hand (its characteristics, CR 702.62a), or null when it has none this build can use: no suspend, a number of time
 * counters that is not a fixed positive number, no cost, or two different suspends (the action names neither; no printed card has two).
 */
export function suspendTermsOf(s: GameState, o: GameObject): SuspendTerms | null {
  const all = charsOfObject(s, o).keywords.filter((k) => k.keyword === 'suspend');
  if (all.length === 0) return null;
  const terms = all.map((k) => (typeof k.amount === 'number' && Number.isInteger(k.amount) && k.amount >= 1 && k.cost !== undefined ? { amount: k.amount, cost: k.cost } : null));
  const first = terms[0];
  if (!first) return null;
  const key = JSON.stringify(first);
  return terms.every((t) => t !== null && JSON.stringify(t) === key) ? first : null;
}

const costText = (c: CostDef): string => (c.mana ? formatManaCost(c.mana) : 'its suspend cost');

function listed(g: Game, player: PlayerId): { object: ObjectId; label: string; cost: CostDef; terms: SuspendTerms }[] {
  if (!impl) return []; // fail closed: nothing to perform it with
  const s = g.s;
  const out: { object: ObjectId; label: string; cost: CostDef; terms: SuspendTerms }[] = [];
  for (const id of s.zones.hand[player] ?? []) {
    const o = s.objects[id];
    if (!o || o.kind !== 'card' || o.owner !== player) continue;
    const terms = suspendTermsOf(s, o);
    if (!terms) continue;
    const chars = charsOfObject(s, o);
    // CR 702.62a, 116.2f: when the player could begin to cast it from the hand (its timing); a land is never cast (CR 305.1)
    if (chars.types.includes('Land') || castTiming(s, player, id, chars) !== null) continue;
    if (!impl.payable(s, player, id, terms.cost)) continue;
    out.push({ object: id, label: `Suspend ${chars.name} (${terms.amount} time counter${terms.amount === 1 ? '' : 's'}, ${costText(terms.cost)})`, cost: terms.cost, terms });
  }
  return out;
}

export const SUSPEND_HANDLERS: readonly SpecialActionHandler[] = [
  {
    kind: 'suspend',
    list: (g, player) => listed(g, player).map(({ object, label, cost }) => ({ object, label, cost })),
    perform: (g, action) => {
      const pick = action.object === undefined ? undefined : listed(g, action.player).find((x) => x.object === action.object);
      if (!pick) throw new IllegalAction("That card can't be suspended now.", ['CR 116.1', 'CR 116.2f', 'CR 702.62a']);
      impl!.perform(g, action.player, pick.object, pick.terms);
    },
  },
];
