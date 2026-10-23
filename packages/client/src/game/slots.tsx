/**
 * The two parts of the game screen other work packages deliver; the game screen owns the composition:
 * - the board (C4, client/src/board/*) gets the view, the shown player's legal actions, the interaction the prompt publishes (interaction.ts: what may
 *   be clicked, what is selected, the prompt's marks, the clicks, stop toggles sent as `setStops`), and the prompt bar (or the game-over panel) to draw
 *   below the board. Its cards are drawn by C2's card picture (boardCards.tsx).
 * - the prompt (C5, client/src/prompts/*) gets the connection and publishes its board selection to the game's one selection store (C5's
 *   `SelectionStore`, provided by the game screen).
 *
 * Neither ever sees a raw state. The game screen renders them only while no hot-seat hand-off is pending (the pass cover hides everything). Tests pass
 * their own slots.
 */
import type { GameView, LegalAction, PlayerId } from '@openmtg/engine';
import { useCallback, type ComponentType, type ReactNode } from 'react';
import { GameBoard, type PlayerSleeves } from '../board';
import type { GameConnection } from '../connection/GameConnection';
import type { BoardPacer } from '../connection/PacedConnection';
import { PromptBar } from '../prompts';
import { settingsStore, type SettingsStore, type TableLayout } from '../settings/settings';
import { useSettings } from '../settings/useSettings';
import { renderBoardCard, useBoardArtist } from './boardCards';
import type { BoardInteraction } from './interaction';

export interface BoardSlotProps {
  connection: GameConnection;
  view: GameView;
  /** The shown player's legal priority actions (CR 117.1), for highlighting what can be played. */
  legalActions: readonly LegalAction[];
  /** What the current prompt lets the player click, the click callbacks and stop toggles. */
  interaction: BoardInteraction;
  /** The bar below the board: the prompt, or the game-over panel. The board must render it, and keep it on screen. */
  prompt: ReactNode;
  /** ui/arena: the screen's pacing connection; the board animates each change for it. */
  pacer?: BoardPacer;
  /** ui/arena: animation time scale from Settings (fast < 1 < slow). */
  animationScale?: number;
  /** ui/arena: card pictures may overlap (false while Scryfall images can be on screen). */
  cardsMayOverlap?: boolean;
  /** ui/arena: the players at this screen (both in hot-seat): the end screen says Victory or Defeat only to a lone player. */
  seats?: readonly PlayerId[];
  /** M12-4b: the settings the board's table layout and camera come from (default the page's store). */
  settings?: SettingsStore;
  /** Each player's deck sleeve for their card backs. */
  sleeves?: PlayerSleeves;
}

export interface PromptSlotProps {
  connection: GameConnection;
}

export interface GameSlots {
  Board: ComponentType<BoardSlotProps>;
  Prompt: ComponentType<PromptSlotProps>;
}

/**
 * C4's board with C2's card pictures. M12-4b (m12 design 5.1-5.2): the table layout and whether the camera follows the mouse come from Settings
 * (`tableLayout`, `cameraFollow`), and the table's own layout switch stores its choice there, so Settings and the table always show the same layout.
 */
export function BoardSlot({ view, legalActions, interaction, prompt, pacer, animationScale, cardsMayOverlap, seats, settings = settingsStore(), sleeves }: BoardSlotProps) {
  const { tableLayout, cameraFollow } = useSettings(settings);
  const onTableLayout = useCallback((layout: TableLayout) => settings.update({ tableLayout: layout }), [settings]);
  return (
    <GameBoard
      view={view}
      legalActions={legalActions}
      interaction={interaction}
      prompt={prompt}
      renderCard={renderBoardCard}
      useArtist={useBoardArtist}
      {...(pacer ? { pacer } : {})}
      {...(animationScale !== undefined ? { animationScale } : {})}
      {...(cardsMayOverlap !== undefined ? { cardsMayOverlap } : {})}
      {...(seats ? { seats } : {})}
      {...(sleeves ? { sleeves } : {})}
      tableLayout={tableLayout}
      onTableLayout={onTableLayout}
      cameraFollow={cameraFollow}
    />
  );
}

/** C5's prompt bar. */
export function PromptSlot({ connection }: PromptSlotProps) {
  return <PromptBar connection={connection} />;
}

export const DEFAULT_SLOTS: GameSlots = { Board: BoardSlot, Prompt: PromptSlot };
