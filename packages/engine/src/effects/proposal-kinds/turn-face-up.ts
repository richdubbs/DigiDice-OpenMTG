/**
 * The `turnFaceUp` proposal kind (CR 116.2b, 614.1e, 708.8, 708.11; m6 design 2.4, 3.4). Owner: M6-3.
 *
 * Proposed by the turn-face-up special action (core/special/turn-face-up.ts, through effects/handlers/face-ops.ts) and by an effect that turns a permanent face
 * up (`changeFace faceUp`). Its replacement patterns are `becomes turnedFaceUp` (`feature:replace.on.turnFaceUp`). Its self candidates come from the
 * characteristics the permanent WILL have face up (`selfCandidatesFrom`, CR 708.11: "As this creature is turned face up, ..." applies while it is being turned
 * face up, so its `during` bodies are found on the face-up permanent: Hooded Hydra). The performer is installed by effects/handlers/face-ops.ts, which may run
 * the steps of the `during` bodies (this part file may not import the interpreter: effects/registries.ts imports it).
 */
import { EngineBug } from '../../core/errors';
import type { Game } from '../../core/game';
import { faceUpHypothetical } from '../../core/special/turn-face-up';
import type { PlayerId } from '../../types/ids';
import type { Proposed } from '../api';
import type { Performed } from '../perform-events';
import type { ProposalKind } from '../registries';
import { ruleDenial } from '../../statics/hooks';

type TurnFaceUp = Extract<Proposed, { ev: 'turnFaceUp' }>;

/** The performer (effects/handlers/face-ops.ts installs it when it loads). */
let performer: ((g: Game, e: TurnFaceUp) => Performed | null) | null = null;
export function installTurnFaceUpPerformer(f: ((g: Game, e: TurnFaceUp) => Performed | null) | null): void {
  performer = f;
}

/** The face-down permanent the event is about, if it is still one (CR 400.7: a permanent that left is a new object). */
const faceDownPermanent = (g: Game, e: TurnFaceUp) => {
  const o = g.s.objects[e.object.id];
  return o && o.zone === 'battlefield' && o.zone === e.object.zone && o.faceDown ? o : undefined;
};

export const TURN_FACE_UP_KIND: ProposalKind<TurnFaceUp> = {
  ev: 'turnFaceUp',
  capabilities: ['feature:replace.on.turnFaceUp'],
  semOf: (g, e) => {
    const o = g.s.objects[e.object.id];
    const who = e.by ?? o?.controller; // FAST5X E25: the player who turns it face up (CR 608.2, 116.2b)
    return { seq: 0, batch: 0, before: {}, ev: 'becomes', roles: { subject: { objects: [e.object] }, ...(who !== undefined ? { player: { players: [who] } } : {}) }, data: { what: 'turnedFaceUp' } };
  },
  affectedPlayer: (g, e): PlayerId => g.s.objects[e.object.id]?.controller ?? g.s.turn.activePlayer, // CR 616.1: its controller
  // FAST5X E25 (CR 708.7, 101.2, 614.17): "can't be turned face up" (Karlov Watchdog, Unable to Scream)
  forbidden: (g, e) => {
    const d = ruleDenial(g.s, { action: 'beTurnedFaceUp', subject: e.object.id });
    return d ? `That can't happen (beTurnedFaceUp): ${d.message}` : null;
  },
  perform: (g, e) => {
    if (!performer) throw new EngineBug('turnFaceUp: the performer is not installed (effects/handlers/face-ops.ts was not loaded)');
    return performer(g, e);
  },
  // CR 708.11: the replacement effects of the permanent as it will be face up
  selfCandidatesFrom: (g, e) => {
    const o = faceDownPermanent(g, e);
    return o ? { object: o.id, chars: faceUpHypothetical(g.s, o.id) } : null;
  },
};
