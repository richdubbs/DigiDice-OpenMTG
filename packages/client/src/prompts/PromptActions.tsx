/**
 * A prompt's row of action buttons (Pass priority, Auto pay, Attack with all, OK ...). On the game board it is drawn on the table at the bottom right, in the
 * board's actions slot, or centred under a decision drawn on the board's stage (stage.tsx), Arena style; without a board (a
 * prompt shown on its own) it stays in the prompt. A portal keeps it in the prompt's React tree, so the prompt bar's handlers (clearing a rejection on a
 * click, the keys) still see its clicks.
 */
import { useContext, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { PromptSlotsContext } from '../board/context';
import { StageHostContext } from './stage';

export function PromptActions({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const stage = useContext(StageHostContext)?.actions ?? null;
  const table = useContext(PromptSlotsContext)?.actions ?? null;
  const slot = stage ?? table;
  const classes = ['prompt-actions', className, stage ? 'prompt-on-stage' : table ? 'prompt-on-table' : undefined].filter(Boolean).join(' ');
  const row = (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
  return slot ? createPortal(row, slot) : row;
}
