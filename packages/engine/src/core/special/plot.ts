/**
 * Plot, the special action (CR 702.170a-b, 116.2k). Owner: FAST5X E6.
 *
 * "Plot [cost]" means "Any time you have priority during your main phase while the stack is empty, you may exile this card from your hand and pay [cost]. It
 * becomes a plotted card." (CR 702.170a); taking it is a special action (CR 702.170b), which CR 116.2k allows "any time they have priority during their own
 * turn while the stack is empty". Listed (core/legal.ts) for each card with plot in the player's hand when it is the player's own main phase, the stack is
 * empty and the plot cost can be paid now. Performing it pays the cost (cancellable decisions, CR 733.1), exiles the card and makes the exiled card plotted:
 * `chosen.plotted` holds the turn number it became plotted (the object in exile: a new object if it leaves exile, CR 400.7, so the designation ends there).
 * A plotted card is cast by actions/cast-opt/plot.ts (CR 702.170d).
 *
 * std-freecast-5 (CR 702.170f, 401.5): and the card on top of the player's library when a static ability says "You may plot nonland cards from the top of your
 * library" and the player may look at it (statics/play-permits.ts#topPlotUses), for its own plot cost or, with "The top card of your library has plot. The plot
 * cost is equal to its mana cost.", its mana cost (two different costs: two actions, `option` 0 and 1).
 *
 * Not here (fail closed): a plot cost with X or with a non-mana part this build can't pay is not listed; plot functioning in any other zone and effects that
 * make a card plotted (CR 702.170c) are not implemented, so the cards that say so stay manual.
 *
 * The payment and the zone change are performed by effects/handlers/plot-ops.ts, which installs itself here when it loads: this module is reached from
 * core/registries.ts, which core/zones.ts imports, so it may import neither the cost payer nor the zone mover (an import cycle; as core/special/turn-face-up.ts).
 */
import type { CostDef } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import { formatManaCost } from '../../types/mana';
import type { GameObject, GameState } from '../../types/state';
import { charsOfObject } from '../../rules/characteristics';
import { sorceryTiming } from '../../rules/timing';
import { modifyMana, plotCostModsFor } from '../../statics/costmods';
import { topPlotUses } from '../../statics/play-permits';
import { IllegalAction, type Game } from '../game';
import type { SpecialActionHandler } from '../registries';

/** The `chosen` key of the plotted designation: the turn number in which the card became plotted (CR 702.170a, 702.170d). */
export const PLOTTED_KEY = 'plotted';

/** The turn in which this card in exile became plotted, or undefined when it is not a plotted card (CR 702.170a). Pure. */
export function plottedTurn(o: GameObject): number | undefined {
  const t = o.zone === 'exile' && o.kind === 'card' ? o.chosen?.[PLOTTED_KEY] : undefined;
  return typeof t === 'number' ? t : undefined;
}

/** What performs the action (installed by effects/handlers/plot-ops.ts, see the file comment). */
export interface PlotImpl {
  /** Could `player` pay this plot cost now (CR 118.3)? */
  payable(s: GameState, player: PlayerId, id: ObjectId, cost: CostDef): boolean;
  /** Pay the cost (cancellable decisions, CR 733.1), exile the card from the hand and make it plotted (CR 702.170a). */
  perform(g: Game, player: PlayerId, id: ObjectId, cost: CostDef): void;
}
let impl: PlotImpl | null = null;
export function installPlot(f: PlotImpl | null): void {
  impl = f;
}

/**
 * The plot cost of the card as it is in the hand (its characteristics, CR 702.170a), or null when it has none this build can use: no plot, or
 * two different plot costs (the action names no cost; no printed card has two).
 */
export function plotCostOf(s: GameState, o: GameObject): CostDef | null {
  const costs = charsOfObject(s, o).keywords.filter((k) => k.keyword === 'plot' && k.cost !== undefined).map((k) => k.cost!);
  if (costs.length === 0) return null;
  const first = JSON.stringify(costs[0]);
  return costs.every((c) => JSON.stringify(c) === first) ? costs[0]! : null;
}

/**
 * std-rx26 (CR 702.170a, 601.2f, 118.7; cites unverified): the plot cost after the modifiers that apply to plotting ("Plotting cards from your hand costs {2}
 * less": statics/costmods.ts#plotCostModsFor); a reduction never takes the mana below {0}. Null when an amount can't be worked out (the action is not listed).
 */
export function plotCostAfterMods(s: GameState, player: PlayerId, cost: CostDef): CostDef | null {
  const hits = plotCostModsFor(s, player);
  if (hits.length === 0) return cost;
  const r = modifyMana(cost.mana ?? [], hits);
  if ('unknown' in r) return null;
  const { mana: _mana, ...rest } = cost;
  return r.mana.length > 0 ? { ...rest, mana: r.mana } : rest;
}

const costText = (c: CostDef): string => (c.mana ? formatManaCost(c.mana) : 'its plot cost');

function listed(g: Game, player: PlayerId): { object: ObjectId; label: string; cost: CostDef; option?: number }[] {
  if (!impl) return []; // fail closed: nothing to perform it with
  const s = g.s;
  // CR 702.170a, 116.2k: your own main phase while the stack is empty (and you have priority: core/legal.ts lists for the player who has it)
  if (sorceryTiming(s, player, 'plot a card', 'CR 702.170a') !== null) return [];
  const out: { object: ObjectId; label: string; cost: CostDef; option?: number }[] = [];
  for (const id of s.zones.hand[player] ?? []) {
    const o = s.objects[id];
    if (!o || o.kind !== 'card' || o.owner !== player) continue;
    const printed = plotCostOf(s, o);
    const cost = printed ? plotCostAfterMods(s, player, printed) : null;
    if (!cost || !impl.payable(s, player, id, cost)) continue;
    out.push({ object: id, label: `Plot ${charsOfObject(s, o).name} (${costText(cost)})`, cost });
  }
  // std-freecast-5 (CR 702.170f): the top card of the library, for each different plot cost it has (its own, its mana cost: CR 702.170a, 601.2b-like choice)
  // "Plotting cards from your hand costs {2} less" (the one plot cost modifier, std-rx26) is not about the library: while any applies, no top card is offered
  // (whether it applies there is unknown: fail closed)
  const top = plotCostModsFor(s, player).length === 0 ? topPlotUses(s, player) : null;
  const o = top !== null ? s.objects[top.id] : undefined;
  if (top !== null && o !== undefined) {
    const own = plotCostOf(s, o);
    const mana = top.manaCost ? charsOfObject(s, o).manaCost : null;
    const costs = [...(own ? [own] : []), ...(mana !== null && mana.length > 0 ? [{ mana: [...mana] } as CostDef] : [])];
    const distinct = costs.filter((c, i) => costs.findIndex((d) => JSON.stringify(d) === JSON.stringify(c)) === i);
    distinct.forEach((printed, i) => {
      const cost = printed;
      if (!impl!.payable(s, player, top.id, cost)) return;
      out.push({ object: top.id, label: `Plot ${charsOfObject(s, o).name} from the top of your library (${costText(cost)})`, cost, ...(distinct.length > 1 ? { option: i } : {}) });
    });
  }
  return out;
}

export const PLOT_HANDLERS: readonly SpecialActionHandler[] = [
  {
    kind: 'plot',
    list: (g, player) => listed(g, player),
    perform: (g, action) => {
      const pick = action.object === undefined ? undefined : listed(g, action.player).find((x) => x.object === action.object && (x.option ?? 0) === (action.option ?? 0));
      if (!pick) throw new IllegalAction("That card can't be plotted now.", ['CR 116.1', 'CR 116.2k', 'CR 702.170a']);
      impl!.perform(g, action.player, pick.object, pick.cost);
    },
  },
];
