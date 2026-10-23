/** Engine types the board uses, plus the `setStops` action shape. */
import type { Action } from '@openmtg/engine';

export type { GameView, ObjectId, PlayerId, StopSettings, Step } from '@openmtg/engine';
export type SetStopsAction = Extract<Action, { type: 'setStops' }>;
