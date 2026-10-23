/**
 * `modify.destination.faceDown` on the battlefield (CR 708.2a, 708.3; m6 design 3.4). Owner: M6-3. "Put it onto the battlefield face down instead": the card is
 * turned face down before it enters (CR 708.3), a plain 2/2 put face down by an effect (CR 708.2a). Face down in exile is milestone 5's (CR 406.3,
 * effects/bodies/m5.ts).
 */
import type { DestinationPart } from '../registries';

export const FACE_DOWN_DESTINATION_PARTS: readonly DestinationPart[] = [
  {
    field: 'faceDown',
    capability: 'body:modify.destination.faceDown',
    fits: (e, d) => e.ev === 'zoneChange' && d.zone === 'battlefield',
    toFacts: () => ({ faceDown: true, faceDownInfo: { by: 'effect', profile: 'plain' } }),
  },
];
