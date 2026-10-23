/**
 * The bridge between the prompt and the board (docs/design/m8-client.md screen 7: "clicking a card lists its legal actions", "chooseObjects (click
 * cards)", "only legal targets clickable", "declareAttackers (click creatures)", "manual: click mana sources").
 *
 * One selection store per game: C5's `SelectionStore` (prompts/selection.tsx). The game screen creates it and provides it to the prompt with
 * `PromptSelectionProvider`; the prompts publish which object and player ids may be clicked now, which are selected, and short marks to show next to them
 * (never on a card image, ARCHITECTURE.md "Card images"). This file turns the store into the board's `BoardInteraction` (C4, board/context.ts) and
 * forwards the board's clicks to the prompt. The board never acts on the game itself; stop toggles from its phase bar go to the connection as a
 * `setStops` action (CR 117.3, the engine's stops).
 */
import type { Action, ObjectId, PlayerId } from '@openmtg/engine';
import { useMemo, useSyncExternalStore } from 'react';
import type { GameConnection } from '../connection/GameConnection';
import type { SelectionStore } from '../prompts/selection';

export { PromptSelectionProvider, SelectionStore, usePublishSelection, type SelectionSpec } from '../prompts/selection';

export type SetStopsAction = Extract<Action, { type: 'setStops' }>;

/** The board's side: C4's `BoardInteraction` with every field the game screen provides (the board's own hover stays inside the board). */
export interface BoardInteraction {
  selectable: readonly string[];
  selected: readonly string[];
  /** Short text the prompt shows next to an object or player ("Attacking Bob", "1"), drawn outside the card image. */
  marks: Readonly<Record<string, string>>;
  /**
   * M12-4b (m12 design D15; M12-4a's BoardInteraction.attackTargets): each attacker's picked target while attackers are declared in a game with several
   * possible defenders; absent otherwise.
   */
  attackTargets?: Readonly<Record<ObjectId, string>>;
  onObjectClick: (id: ObjectId) => void;
  onPlayerClick: (id: PlayerId) => void;
  /** The player toggled a stop on the board's phase bar: sent to the game as this action. */
  onSetStops: (action: SetStopsAction) => void;
}

/** For the game screen: the board's interaction from the prompt's selection, with stop toggles sent through the connection. */
export function useBoardInteraction(connection: GameConnection, store: SelectionStore): BoardInteraction {
  const snap = useSyncExternalStore(store.subscribe, store.snapshot);
  return useMemo(
    () => ({
      selectable: [...snap.selectable],
      selected: [...snap.selected],
      marks: snap.marks,
      ...(snap.attackTargets ? { attackTargets: snap.attackTargets } : {}),
      onObjectClick: store.click,
      onPlayerClick: store.click,
      onSetStops: (action: SetStopsAction) => {
        void connection.act(action).then((r) => {
          if (!r.ok) console.error('[GameScreen] setStops rejected', r.error);
        });
      },
    }),
    [snap, store, connection],
  );
}
