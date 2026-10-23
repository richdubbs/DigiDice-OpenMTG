/**
 * `enters.faceDown` (CR 708.3, 708.2a; m6 design 3.4). Owner: M6-3. An "as it enters" replacement that puts the permanent onto the battlefield face down: the
 * object is turned face down before it enters (CR 708.3), a plain 2/2 put face down by an effect (CR 708.2a). The capability also needs `layer:1b` (the
 * walker names both, model/cap-walk.ts).
 */
import type { FaceDownInfo, GameObject } from '../../types/state';
import type { EntersPart } from '../registries';

const BY_EFFECT: FaceDownInfo = { by: 'effect', profile: 'plain' };

/** The hypothetical object `asItWouldEnter` builds is a copy of the state's (never the live one): it is turned face down there (CR 614.12). */
const turnHypotheticalFaceDown = (x: GameObject, info: FaceDownInfo): void => void Object.assign(x, { faceDown: true, faceDownInfo: { ...info } });

export const FACE_DOWN_ENTERS_PARTS: readonly EntersPart[] = [
  {
    field: 'faceDown',
    capability: 'body:enters.faceDown',
    apply: () => ({ faceDown: true, faceDownInfo: { ...BY_EFFECT } }),
    hypothetical: (_alt, x, facts) => turnHypotheticalFaceDown(x, facts.faceDownInfo ?? BY_EFFECT),
  },
];
