/**
 * Proposing turns, phases and steps so "skip" effects can replace them (CR 614.10; m6 design E10, 3.2). Owner: M6-1.
 *
 * "Skip" is a replacement effect (CR 614.1b, 614.10): before a turn, a phase or a step would begin, core/turn.ts proposes it through the pipeline
 * (core/registries.ts#TURN_BASED.propose); a `skip` body (or any body that leaves no event) means it does not happen and the turn structure goes on with what
 * follows. Because each occurrence is proposed, "skip your next draw step" waits for the first draw step that is not skipped otherwise (CR 614.10a), and an
 * effect that would skip a step of a phase that is skipped as a whole is not used up.
 *
 * The pipeline is reached through effects/nested.ts (installed by effects/funnels.ts, which every game loads), so this core module needs no value import of
 * the interpreter's dispatchers (no import cycle through core/registries.ts).
 */
import type { Proposed } from '../effects/api';
import { proposeNested } from '../effects/nested';
import type { Game } from './game';

export const TURN_SKIP_PROPOSE: ((g: Game, what: Extract<Proposed, { ev: 'turn' | 'phase' | 'step' }>) => boolean) | null = (g, what) => proposeNested(g, what) !== null;
