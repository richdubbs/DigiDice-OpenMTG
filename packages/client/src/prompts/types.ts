/** What every decision prompt receives (docs/design/m8-client.md screen 7). */
import type { Action, Decision, DecisionAnswer, DecisionKind, GameView, LegalAction } from '@openmtg/engine';

export interface PromptProps<K extends DecisionKind = DecisionKind> {
  /** The pending decision, addressed to the viewer. */
  d: Extract<Decision, { kind: K }>;
  view: GameView;
  /** The viewer's legal priority actions (CR 117.1); only the priority prompt uses them. */
  legal: readonly LegalAction[];
  /** Answer the decision: sends `{ type: 'answer', player, decisionId, answer }`. */
  answer: (a: DecisionAnswer) => void;
  /** Send any action for the viewer (priority actions). */
  act: (a: Action) => void;
  /** True while an action is on its way: buttons stay disabled so nothing is sent twice. */
  busy: boolean;
}

/**
 * Card-name search for `chooseName` with `what: 'cardName'` (the whole Oracle name index lives on the local server): the names a player may choose that
 * match the query (each face's name, CR 201.4b-f), and whether that is all of them. It rejects when the search is not available.
 */
/** std-rx28: `kind`, only land or only nonland card names (ChooseNameDecision.cardKind, CR 201.3). */
export type CardNameSearch = (query: string, signal: AbortSignal, kind?: 'land' | 'nonland') => Promise<{ names: string[]; complete: boolean }>;
