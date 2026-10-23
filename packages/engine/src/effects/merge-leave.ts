/**
 * CR 730.3e (m6 design 3.7): the replacement effects that move the card components of a merged permanent that is a token. Owner: M6-9.
 *
 * A merged permanent leaves the battlefield as ONE event (core/move-parts/components.ts): a replacement effect applied to it applies to every component
 * (CR 730.3d). A replacement that applies to a "card" being put into a zone but not to tokens (Leyline of the Void) does not apply to that event when the
 * merged permanent is a token; then "the merged permanent and its token components are put into the appropriate zone, and the components that are cards are
 * moved by the replacement effect". So for each card component the pipeline is asked what would happen to that card put into the same zone from the
 * battlefield (steps 1-4 of effects/propose.ts#runPipeline, which perform nothing themselves: the replacement effects, chosen by its owner as the affected
 * player, CR 616.1), and core puts the card where the final event says. Loading this module installs the question into core (core may not import the
 * pipeline); effects/funnels.ts loads it.
 */
import { installComponentDestination } from '../core/move-parts/components';
import { runPipeline } from './propose';

installComponentDestination((g, card, to, opts) => {
  const final = runPipeline(g, { ev: 'zoneChange', object: { id: card, zone: 'battlefield' }, from: 'battlefield', to, destination: opts.cause !== undefined ? { cause: opts.cause } : {} });
  if (!final || final.ev !== 'zoneChange' || final.object.id !== card) return null;
  const d = final.destination;
  return { to: final.to, ...(d.position !== undefined ? { position: d.position } : {}), ...(d.shuffle === true && final.to === 'library' ? { shuffle: true } : {}) };
});
