/**
 * The bridge between the current prompt and the board (docs/design/m8-client.md screen 7: "click cards", "only legal targets clickable"). The prompt
 * publishes which object and player ids may be clicked now, which are selected, and short marks to draw next to them (outside the card image, ARCHITECTURE
 * "Card images"). Every prompt also lists its choices as buttons itself, so it works without a board.
 *
 * The game screen (game/GameScreen.tsx) owns one store per game and provides it with `PromptSelectionProvider`; game/interaction.ts is the only adapter
 * from the store to C4's `BoardInteraction` (including `marks`, which the board draws in its marker strips outside the card images).
 */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';

export interface SelectionSpec {
  /** Object or player ids that can be clicked now. */
  selectable: readonly string[];
  /** Ids currently chosen. */
  selected?: readonly string[];
  /** Short text to show next to an object or player, never on the card image ("Attacking Bob", "2", "Lethal 3"). */
  marks?: Readonly<Record<string, string>>;
  /** What a click on a selectable id does. */
  click: (id: string) => void;
  /**
   * M12-4b (m12 design D15, 5.3 item 2): the declare-attackers prompt of a game with several possible defenders publishes each attacker's target picked so
   * far (attacker id -> player, planeswalker or battle id); the board points each attack arrow at its own target (BoardInteraction.attackTargets). Absent
   * in a two-player game: the arrows point at the one opponent, as before.
   */
  attackTargets?: Readonly<Record<string, string>>;
}

export interface SelectionSnapshot {
  selectable: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  marks: Readonly<Record<string, string>>;
  /** M12-4b: see SelectionSpec.attackTargets. */
  attackTargets?: Readonly<Record<string, string>>;
}

const EMPTY: SelectionSnapshot = { selectable: new Set(), selected: new Set(), marks: {} };

/** Holds the latest spec; notifies the board only when what it draws changed (the click handler is always the latest one). */
export class SelectionStore {
  private snap: SelectionSnapshot = EMPTY;
  private key = '';
  private handler: ((id: string) => void) | null = null;
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  readonly snapshot = (): SelectionSnapshot => this.snap;

  publish(spec: SelectionSpec | null): void {
    this.handler = spec?.click ?? null;
    const selected = spec?.selected ?? [];
    const marks = spec?.marks ?? {};
    const key = spec ? JSON.stringify([spec.selectable, selected, marks, spec.attackTargets ?? null]) : '';
    if (key === this.key) return;
    this.key = key;
    this.snap = spec
      ? { selectable: new Set(spec.selectable), selected: new Set(selected), marks: { ...marks }, ...(spec.attackTargets ? { attackTargets: { ...spec.attackTargets } } : {}) }
      : EMPTY;
    for (const l of [...this.listeners]) l();
  }

  /** A click from the board: ignored unless the id is selectable now. */
  readonly click = (id: string): void => {
    if (this.snap.selectable.has(id)) this.handler?.(id);
  };
}

const SelectionContext = createContext<SelectionStore | null>(null);

export function PromptSelectionProvider({ store, children }: { store?: SelectionStore; children: ReactNode }) {
  const own = useMemo(() => store ?? new SelectionStore(), [store]);
  return <SelectionContext.Provider value={own}>{children}</SelectionContext.Provider>;
}

/** For a prompt: publish its selection on every render, withdraw it when the prompt goes away. */
export function usePublishSelection(spec: SelectionSpec | null): void {
  const store = useContext(SelectionContext);
  useEffect(() => {
    store?.publish(spec);
  });
  useEffect(() => () => store?.publish(null), [store]);
}

