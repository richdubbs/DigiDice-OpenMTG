/** React bindings for a GameConnection. */
import { useSyncExternalStore } from 'react';
import type { GameView, LegalAction, PlayerId } from '@openmtg/engine';
import type { GameConnection } from './GameConnection';

/** The connection's current view; re-renders on every change. */
export function useGameView(conn: GameConnection): GameView {
  return useSyncExternalStore(conn.subscribe, conn.view);
}

/** The pending hot-seat hand-off (null when none). */
export function useHandoff(conn: GameConnection): PlayerId | null {
  return useSyncExternalStore(conn.subscribe, conn.handoff);
}

/** The shown player's legal priority actions (CR 117.1); empty while a hand-off is pending. */
export function useLegalActions(conn: GameConnection): readonly LegalAction[] {
  return useSyncExternalStore(conn.subscribe, conn.legalActions);
}
