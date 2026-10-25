/**
 * What every part of the board shares: the view, the card renderer, and the interaction props the prompts package (C5) drives. The board itself never acts on
 * the game: clicks and stop toggles are reported through callbacks.
 */
import { createContext, useContext } from 'react';
import type { LegalAction } from '@openmtg/engine';
import type { GameView, ObjectId, PlayerId, SetStopsAction } from './types';
import type { ArtistHook, CardRenderer } from './cardRenderer';

/** Highlights and clicks, driven by the prompts package (docs/design/m8-client.md screen 7). Every field is optional: without them the board is read-only. */
export interface BoardInteraction {
  /** Objects and players the current decision lets the player pick (chooseTargets, chooseObjects, declareAttackers ...): highlighted and clickable. */
  selectable?: readonly string[];
  /** Objects and players picked so far in the current decision. */
  selected?: readonly string[];
  /**
   * Short text the current decision shows next to an object or player ("Attacking Bob", "Blocking Grizzly Bears", click order "1"), drawn in the marker
   * strip outside the card image. C6 addition (INTERFACE CHANGE): pending attackers and blockers show on the board before they are declared.
   */
  marks?: Readonly<Record<string, string>>;
  /** A card or permanent was clicked (playable, mana source or selectable). */
  onObjectClick?: (id: ObjectId) => void;
  /**
   * M12-4a (INTERFACE CHANGE for M12-4b, m12 design D15, 5.3 item 2): the target picked so far for each attacker being declared (attacker id -> the player,
   * planeswalker or battle it attacks). The board points each attacker's arrow at its own target; an attacker without one has no arrow (there is no default
   * with several possible defenders). Absent: a two-player game's attackers point at the one opponent, as before.
   */
  attackTargets?: Readonly<Record<ObjectId, string>>;
  /** A player's panel was clicked (only when the player is selectable, e.g. as a target, CR 115.1). */
  onPlayerClick?: (id: PlayerId) => void;
  /** The pointer entered (id) or left (null) a visible card: for card zoom. */
  onObjectHover?: (id: ObjectId | null) => void;
  /** The viewer toggled a stop: send this `setStops` action through the connection. Without it the stops are shown read-only. */
  onSetStops?: (action: SetStopsAction) => void;
}

export interface BoardContextValue {
  view: GameView;
  renderCard: CardRenderer;
  /** The artist of the picture `renderCard` draws (a hook, the same for the board's whole life): credited in names, tooltips and under large pictures. */
  useArtist: ArtistHook;
  /** M11-2: the shown player's legal priority actions (GameBoardProps.legalActions), for the command zone panel's Cast buttons (CommandZone.tsx). */
  legalActions: readonly LegalAction[];
  playable: ReadonlySet<ObjectId>;
  manaOnly: ReadonlySet<ObjectId>;
  /** FAST3 CL1: objects whose only legal actions are by-hand tools for manual text (CR 603.2, 604.1): marked, not drawn as playable. */
  byHand: ReadonlySet<ObjectId>;
  selectable: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  /** Targets of spells and abilities on the stack (object or player id -> stack objects targeting it). */
  targeted: ReadonlyMap<string, ObjectId[]>;
  /** The stack object whose targets are emphasized (pointer over it in the stack panel). */
  focusStack: ObjectId | null;
  setFocusStack: (id: ObjectId | null) => void;
  /**
   * The visible card under the pointer or keyboard focus (zoom). `anchor` is the card's element: the zoom is drawn on the side of the board away from it, so
   * it never covers the card or the stack.
   */
  setZoom: (id: ObjectId | null, anchor?: Element | null) => void;
  /** The one open zone viewer (graveyard, exile, command), by key; null when none is open. */
  openZone: string | null;
  setOpenZone: (key: string | null) => void;
  /**
   * The table's layer the open zone viewer is drawn in (over the whole table, the stage, the result and the log included; under the zoom). Drawn where its
   * button is, a viewer stayed inside its seat's part of the table, and the hand, the disc and the cards drawn after it came out over it. Absent outside a
   * board: drawn in place.
   */
  zoneLayer?: HTMLElement | null;
  interaction: BoardInteraction;
  /**
   * The order each player arranged their own hand in by dragging, by player. Local to this screen and never sent to the game (a
   * hand's order means nothing to the rules, CR 402); kept by the board, so it survives a hot-seat hand-off. Hand.tsx reads and writes it.
   */
  handOrders: Map<PlayerId, ObjectId[]>;
}

export const BoardContext = createContext<BoardContextValue | null>(null);

/**
 * The board's places for the current prompt, given to the prompt the board renders; null outside a board (the
 * prompt then keeps everything in itself). `actions`: the action buttons, at the bottom right of the table (prompts/PromptActions.tsx). `stage`: a
 * decision drawn large over the dimmed table, such as the opening hand or assigning combat damage (prompts/stage.tsx).
 */
export interface PromptSlots {
  actions: HTMLElement | null;
  stage: HTMLElement | null;
  /** Card pictures may overlap on the stage too (false while Scryfall images can be on screen: GameBoardProps.cardsMayOverlap). */
  cardsMayOverlap: boolean;
}

export const PromptSlotsContext = createContext<PromptSlots | null>(null);

/**
 * M12-4a (m12 design 5.1 "Readability"): the cards of this part of the board are drawn with a compact face (name, mana cost, P/T; counters and the tapped
 * state stay outside the face as everywhere): a seat far across the shared table, whose cards are under about 70 px on screen. The zoom still shows the
 * whole card.
 */
export const CompactContext = createContext(false);

export function useBoard(): BoardContextValue {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error('Board components must be rendered inside <GameBoard>.');
  return ctx;
}
