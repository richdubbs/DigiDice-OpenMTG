/**
 * Casting a plotted card (CR 702.170d). Owner: FAST5X E6.
 *
 * "A plotted card's owner may cast it from exile without paying its mana cost during their main phase while the stack is empty during any turn after the turn
 * in which it became plotted. Casting a spell this way follows the rules for paying alternative costs in rules 601.2b and 601.2f-h. A plotted card may be cast
 * this way even if it doesn't have the plot ability while in exile." The method `plot` is offered for a plotted card in exile (core/special/plot.ts#plottedTurn)
 * to its owner, on a later turn, during that player's own main phase with an empty stack, whatever the card's type (an instant too: CR 702.170d is the timing);
 * its alternative cost is nothing (CR 118.9: "without paying its mana cost"; X is 0, CR 107.3b; additional costs are still paid, CR 118.9d). Every other check
 * of casting (card type, "can't" effects, targets) is the cast path's.
 */
import { plottedTurn } from '../../core/special/plot';
import { sorceryTiming } from '../../rules/timing';
import type { CastOptionProvider } from '../cast-options';

export const PLOT_CAST_OPTIONS: readonly CastOptionProvider[] = [
  {
    name: 'plot',
    offers: (g, o, player) => {
      const t = plottedTurn(o);
      return t !== undefined && !o.faceDown && o.owner === player && g.s.turn.number > t && sorceryTiming(g.s, player, 'cast a plotted card', 'CR 702.170d') === null;
    },
    cost: () => ({}), // CR 702.170d, 118.9: without paying its mana cost
    onStack: () => {},
  },
];
