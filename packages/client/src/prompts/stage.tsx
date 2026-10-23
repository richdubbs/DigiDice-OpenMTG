/**
 * A decision drawn large over the dimmed table, Arena style: a title and a line under it across the top, the decision's cards in
 * the middle, its action buttons big and centred below them, and "View battlefield" at the top right to look at the table underneath (the buttons stay).
 * A prompt puts a `<PromptStage>` beside its usual content; on the game board it fills the board's stage layer (`PromptSlots.stage`) and the prompt's
 * `<PromptActions>` move into it (`StageHostContext`, kept by the prompt bar). Without a board it draws nothing and the prompt is the plain one.
 *
 * Cards on the stage are drawn by the board's card renderer, outside the board's own cards: no `data-object-id` (the animator and the arrows measure the
 * board's cards by it), and nothing is ever drawn over a picture: numbers and highlights sit beside it (ARCHITECTURE.md "Card images").
 */
import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ObjectId } from '@openmtg/engine';
import { BoardCredit } from '../board/BoardCredit';
import { PromptSlotsContext, useBoard } from '../board/context';
import { charsOf, defOf, shownFace } from '../board/model';

/** The stage's place for the prompt's action buttons while a stage is shown (set by the stage, read by PromptActions). */
export interface StageHost {
  actions: HTMLElement | null;
  setActions: (el: HTMLElement | null) => void;
}

export const StageHostContext = createContext<StageHost | null>(null);

export interface PromptStageProps {
  title: string;
  subtitle?: ReactNode;
  /** More controls under "View battlefield" (e.g. "Auto allocate damage"). */
  corner?: ReactNode;
  children: ReactNode;
}

export function PromptStage({ title, subtitle, corner, children }: PromptStageProps) {
  const slots = useContext(PromptSlotsContext);
  const host = useContext(StageHostContext);
  const [peek, setPeek] = useState(false);
  if (!slots?.stage) return null;
  return createPortal(
    <section className={`prompt-stage${peek ? ' is-peeking' : ''}`} aria-label={title}>
      <header className="prompt-stage-head">
        <h2 className="prompt-stage-title">{title}</h2>
        {subtitle && <p className="prompt-stage-sub">{subtitle}</p>}
      </header>
      <div className="prompt-stage-corner">
        <button type="button" className="prompt-stage-peek" aria-pressed={peek} onClick={() => setPeek((p) => !p)}>
          {peek ? 'Back' : 'View battlefield'}
        </button>
        {!peek && corner}
      </div>
      <div className="prompt-stage-body">{children}</div>
      <div className="prompt-stage-actions" ref={host?.setActions} />
    </section>,
    slots.stage,
  );
}

/** Whether cards on the stage may overlap (never while Scryfall images can be on screen: no picture is ever covered, ARCHITECTURE.md "Card images"). */
export function useStageOverlap(): boolean {
  return useContext(PromptSlotsContext)?.cardsMayOverlap === true;
}

export interface StageCardProps {
  id: ObjectId;
  className?: string;
  /** Drawn beside the picture (amounts, labels): never over it. */
  children?: ReactNode;
}

/** A card on the stage: its picture, as large as the stage's CSS makes it; pointing at it shows the zoom like a card on the board. */
export function StageCard({ id, className, children }: StageCardProps) {
  const board = useBoard();
  const o = board.view.objects[id];
  if (!o) return null;
  const def = defOf(board.view, o);
  const face = def ? shownFace(def, o) : 0;
  return (
    <div
      className={`prompt-stage-card${className ? ` ${className}` : ''}`}
      data-stage-id={id}
      onMouseEnter={(e) => board.setZoom(id, e.currentTarget)}
      onMouseLeave={() => board.setZoom(null)}
    >
      <div className="prompt-stage-picture">
        {board.renderCard({ def, face, chars: charsOf(board.view, o), size: 'large', faceDown: false })}
      </div>
      {/* The Scryfall picture's artist, under the picture and above the amounts */}
      <BoardCredit def={def} face={face} className="prompt-stage-credit" />
      {children}
    </div>
  );
}
