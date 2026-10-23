/**
 * The game board (docs/design/m8-client.md screen 6), laid out like MTG Arena (ui/arena): a table in perspective with the opponents at the top (hand of
 * backs, identity disc, piles, then their battlefield with lands at the far edge), a band with the turn and step across the middle, the viewer at the
 * bottom (battlefield, then piles and identity disc, the hand and the prompt's action buttons along the bottom edge), and a side rail with the stack drawn
 * as a pile of cards, the game log, reminders, the turn structure with the viewer's stops, and the prompt's question and choices.
 *
 * Pure rendering from props: the board reads a `GameView` (never a raw state) and the shown player's legal actions, and reports clicks, hovers and stop toggles
 * through `interaction`; it never calls the engine except the read-only characteristics helpers (model.ts). Local UI state (zoom, stack focus, the log filter,
 * open zone viewers) never reaches the game.
 *
 * Animations (ui/arena): with a `pacer` (the game screen's PacedConnection) the fx layer plays each change's events (attacks, spells, deaths ...) before
 * and after the board shows the new view; without one the board just shows each view.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { decidingPlayer, type GameObject, type GameView, type LegalAction, type ObjectId, type PlayerState } from '@openmtg/engine';
import type { BoardPacer } from '../connection/PacedConnection';
import { Logo3D } from '../branding/Logo3D';
import { RateLimit, gameSfx, soundClock } from '../game/sound';
import { ArenaBackdrop } from './ArenaBackdrop';
import { Battlefield } from './Battlefield';
import { BoardContext, PromptSlotsContext, useBoard, type BoardContextValue, type BoardInteraction } from './context';
import { BoardCredit } from './BoardCredit';
import { defaultCardRenderer, noArtist, type ArtistHook, type CardRenderer } from './cardRenderer';
import { FxLayer } from './fx/FxLayer';
import { TargetArrows } from './fx/TargetArrows';
import { GameLog, LogButton } from './GameLog';
import { HiddenHand, OtherHand, OwnHand } from './Hand';
import { faceDownHow, hasOtherFace, isFaceDownProfile, statusLines } from '../cards/objectStatus';
import { charsOf, defOf, isHidden, isKnownFaceDown, isTokenCopy, objectName, playableObjects, playerName, seating, shownFace, targetedBy } from './model';
import { CenterLine, PhaseBar } from './PhaseBar';
import { Piles, PlayerPanel } from './PlayerPanel';
import { OwnerSleeve, PlayerSleevesContext, type PlayerSleeves } from './sleeves';
import { StackPanel, TableStack } from './StackPanel';
import { useSettings } from '../settings/useSettings';
import { settingsStore, TABLE_LAYOUTS, type TableLayout } from '../settings/settings';
import { SharedTable } from './table/SharedTable';
import { OpponentStrip } from './table/OpponentStrip';
import { autoFocus, boardLayout, focusedOpponent, type BoardLayout } from './table/layout';
import { placementLabel } from './table/seats';
import { prefersReducedMotion } from './table/useTableCamera';
import './board.css';
import './arena.css';
import './table/table.css';

export interface GameBoardProps {
  view: GameView;
  /** The shown player's legal priority actions (`GameConnection.legalActions()`): cards and permanents they can use are highlighted (CR 117.1). */
  legalActions?: readonly LegalAction[];
  /** Highlights and callbacks driven by the prompts package. */
  interaction?: BoardInteraction;
  /** Draws one card image (C2's card component); defaults to the local text placeholder. */
  renderCard?: CardRenderer;
  /**
   * The artist of each picture `renderCard` draws: a hook, passed once for the board's whole
   * life. Thumbnails name the artist in their accessible name (the picture's tooltip too); the zoom, the stage and the zone viewers show "Illustrated by ..."
   * under the picture. Defaults to none (the board's own text frames).
   */
  useArtist?: ArtistHook;
  /** The current prompt and its buttons (C5), shown at the bottom of the side rail. */
  prompt?: ReactNode;
  /** ui/arena: the game screen's pacing connection; the board animates each change for it. Without it nothing animates. */
  pacer?: BoardPacer;
  /** ui/arena: animation time scale (Settings "Animation speed": fast < 1 < slow). */
  animationScale?: number;
  /**
   * ui/arena: whether card pictures may overlap (the stack drawn as an overlapping pile). False while Scryfall images can be on screen: their rules forbid
   * covering any part of a card image, the artist line included (ARCHITECTURE.md "Card images").
   */
  cardsMayOverlap?: boolean;
  /** ui/arena: the players at this screen (both in hot-seat). The end screen says Victory or Defeat only when one player sits here; otherwise who won. */
  seats?: readonly string[];
  /**
   * M12-4a (m12 design 5.1, 5.2; INTERFACE CHANGE for M12-4b): how a game with three or four players is drawn (Settings.tableLayout): the shared table, every
   * opponent across the top, or one focused opponent. Absent: the page's settings (settings/settings.ts `settingsStore`). A two-player game is the same in
   * every layout.
   */
  tableLayout?: TableLayout;
  /** The table's own layout switch was used (M12-4b stores it in the game screen's settings). Absent: the page's settings store is updated. */
  onTableLayout?: (layout: TableLayout) => void;
  /**
   * M12-4a (5.1 "Reduced motion"; INTERFACE CHANGE for M12-4b: Settings "Camera follows the mouse"): false gives the shared table a static camera that frames
   * the whole table (zoom and pan by keys and buttons, without easing), as `prefers-reduced-motion` does. Default true.
   */
  cameraFollow?: boolean;
  /** Each player's deck sleeve for their card backs (board/sleeves.tsx). Absent: everyone has the classic DigiDice back. */
  sleeves?: PlayerSleeves;
}

const EMPTY: readonly string[] = [];
const NO_ACTIONS: readonly LegalAction[] = [];
const NO_SLEEVES: PlayerSleeves = {};

/**
 * ui/arena: spells and abilities the animator stands on the stack for a moment although the view on screen (`base`) no longer has them there: they were
 * cast or activated and resolved inside one change (every player passed at once). The board draws them on top of `base`'s stack, on the table and in the
 * rail, so another player's spell is always seen on the stack with its targets before it resolves. Only while `base` is the
 * view on screen: the next view drops them.
 */
export interface StagedStack {
  base: GameView;
  /** The objects as they were on the stack (last known information), in the order they were put there. */
  objects: readonly GameObject[];
  defs: GameView['defs'];
}

export function withStaged(view: GameView, staged: StagedStack | null): GameView {
  if (!staged || staged.base !== view || staged.objects.length === 0) return view;
  const objects = { ...view.objects };
  for (const o of staged.objects) objects[o.id] = { ...o, zone: 'stack' };
  const ids = staged.objects.map((o) => o.id).filter((id) => !view.zones.stack.includes(id));
  return { ...view, objects, defs: { ...staged.defs, ...view.defs }, zones: { ...view.zones, stack: [...view.zones.stack, ...ids] } };
}
/** At most one zoom sound this often (ms). */
export const ZOOM_SOUND_MS = 120;

// The two sides are memoized (ui/arena perf): they read what changed from the board's context, so a draw of the board that changed nothing they show
// (the prompt's text, a status line) does not draw every card again.
const TopSide = memo(function TopSide({ player }: { player: PlayerState }) {
  return (
    <div className={`side side-top${player.hasLost ? ' is-out' : ''}`} data-player-id={player.id}>
      {player.hasLost && <OutLabel player={player} />}
      <div className="side-bar seat-hud">
        <OtherHand player={player.id} />
        <div className="seat-cluster">
          <PlayerPanel player={player} position="top" />
          <Piles player={player} />
        </div>
      </div>
      <Battlefield player={player.id} mirrored />
    </div>
  );
});

/**
 * `actionsSlot` receives the element the prompt's action buttons are drawn in (bottom right of the table). `own`: the hand is drawn face up, the viewer's
 * own (or, in a replay's open view, the bottom seat's: every hand is face up there, Hand.tsx).
 */
const BottomSide = memo(function BottomSide({ player, own, actionsSlot }: { player: PlayerState; own: boolean; actionsSlot: (el: HTMLDivElement | null) => void }) {
  return (
    <div className={`side side-bottom${own ? ' is-own' : ''}`} data-player-id={player.id}>
      <Battlefield player={player.id} mirrored={false} />
      <div className="side-bar seat-hud">
        <div className="seat-cluster">
          <Piles player={player} />
          <PlayerPanel player={player} position="bottom" />
        </div>
        {own ? <OwnHand player={player.id} /> : <HiddenHand player={player.id} />}
        <div className="table-actions" ref={actionsSlot} role="group" aria-label="Prompt actions" />
      </div>
    </div>
  );
});

/** M12-4a: a player who left a multiplayer game (CR 104.5, 800.4a): their place and how they lost, over their empty side. */
function OutLabel({ player }: { player: PlayerState }) {
  const { view } = useBoard();
  const label = placementLabel(view, player.id);
  return label ? (
    <div className="seat-out-label" title="Left the game (CR 104.5, 800.4a)">
      {player.name}: {label}
    </div>
  ) : null;
}

const LAYOUT_LABEL: Record<TableLayout, string> = { shared: 'Shared table', acrossTop: 'Across the top', focused: 'Focused' };

/** M12-4a (5.2): the table's own layout switch (also in Settings), on the table, never in the rail. */
function LayoutSwitch({ layout, onChange }: { layout: TableLayout; onChange: (l: TableLayout) => void }) {
  return (
    <div className="table-layout-switch" role="group" aria-label="Table layout">
      {TABLE_LAYOUTS.map((l) => (
        <button key={l} type="button" className="table-chip" aria-pressed={l === layout} onClick={() => onChange(l)}>
          {LAYOUT_LABEL[l]}
        </button>
      ))}
    </div>
  );
}

interface ZoomState {
  id: ObjectId;
  /** Which edge of the table the zoom sits at: away from the card it shows. */
  side: 'left' | 'right';
}

/**
 * The side of the table away from `anchor` (the zoom must not cover the card under the pointer). Cards in the player's own hand always zoom on the right
 * (sweeping along the hand must not make the zoom jump from side to side); the zoom hangs from the top of the table, clear of the
 * hand at the bottom.
 */
function zoomSide(anchor: Element | null | undefined): 'left' | 'right' {
  if (anchor?.closest('.hand-own')) return 'right';
  const main = anchor?.closest('.game-board')?.querySelector('.board-main');
  if (!anchor || !main) return 'right';
  const a = anchor.getBoundingClientRect();
  const m = main.getBoundingClientRect();
  return a.left + a.width / 2 > m.left + m.width / 2 ? 'left' : 'right';
}

/**
 * The card zoom: an overlay over the table (never over the side rail, so the stack with its controller and targets stays readable, CR 405, 601.2c).
 * A face-down card the viewer may look at (CR 708.5) shows its face here only, labelled outside the image.
 */
function Zoom({ zoom }: { zoom: ZoomState | null }) {
  const ctx = useBoard();
  const o = zoom ? ctx.view.objects[zoom.id] : undefined;
  if (!zoom || !o || isHidden(o)) return <div className="zoom zoom-empty" aria-hidden="true" />;
  const view = ctx.view;
  const def = defOf(view, o);
  const faceDown = isKnownFaceDown(o);
  // M6-11 (CR 708.5): another player's face-down permanent or spell has only the engine's pseudo-definition: the zoom shows the card back and what is public
  // (a 2/2 creature, how it came to be face down: CR 708.6), never a blank frame that looks like a card.
  if (faceDown && isFaceDownProfile(o)) {
    const chars = charsOf(view, o);
    const pt = chars?.power !== undefined && chars.toughness !== undefined ? ` It is a ${chars.power}/${chars.toughness} creature${chars.keywords.some((k) => k.keyword === 'ward') ? ' with ward {2}' : ''}.` : '';
    return (
      <div className={`zoom zoom-${zoom.side}`} aria-label="Card zoom">
        <div className="zoom-label">{objectName(view, o.id)}</div>
        <div className="zoom-card">
          <OwnerSleeve owner={o.owner}>{ctx.renderCard({ def: null, face: 0, chars: null, size: 'large', faceDown: true })}</OwnerSleeve>
        </div>
        <div className="zoom-note">Face down: only {playerName(view, o.controller)} may look at it (CR 708.5).{pt}</div>
      </div>
    );
  }
  const face = def ? shownFace(def, o) : 0;
  const own = o.controller === view.viewer;
  const lines = statusLines(view, o);
  const how = faceDownHow(o);
  return (
    <div className={`zoom zoom-${zoom.side}`} aria-label="Card zoom">
      {!faceDown && isTokenCopy(o, def) && <div className="zoom-label zoom-token">Token copy of {def?.name ?? 'a card'} (CR 111.10, 707.2)</div>}
      {faceDown && (
        <div className="zoom-label">
          {/* CR 708.5: its controller may look at it; CR 708.9: everybody sees it once it is revealed (the end of the game); a replay's open view shows it */}
          {own ? 'Face down (only you can see it)' : view.open === true ? 'Face down (shown in the open view)' : 'Face down, revealed (CR 708.9)'}
          {how ? ` (${how})` : ''}: {def?.name ?? 'a card'}
        </div>
      )}
      <div className="zoom-card">
        <OwnerSleeve owner={o.owner}>{ctx.renderCard({ def, face, chars: faceDown ? null : charsOf(view, o), size: 'large', faceDown: o.faceDown === true })}</OwnerSleeve>
      </div>
      {/* The Scryfall picture's artist, under the picture, never on it */}
      <BoardCredit def={def} face={face} className="zoom-credit" />
      {lines.length > 0 && (
        <ul className="zoom-status" aria-label="Status">
          {lines.map((l) => (
            <li key={l.key} title={l.rule}>
              {l.text}
            </li>
          ))}
        </ul>
      )}
      {/* M6-11 (CR 712.1, 712.8): a double-faced card shows its other face too, so a player can read the face that is not up */}
      {def && !faceDown && hasOtherFace(def) && (
        <div className="zoom-other" aria-label={`Other face: ${def.faces[1 - face]?.name ?? ''}`}>
          <div className="zoom-other-label">{face === 1 ? 'Front face' : 'Back face'}</div>
          <div className="zoom-card zoom-card-other">{ctx.renderCard({ def, face: 1 - face, chars: null, size: 'large', faceDown: false })}</div>
          {/* The other face's own artist */}
          <BoardCredit def={def} face={1 - face} className="zoom-credit" />
        </div>
      )}
    </div>
  );
}

/**
 * CL3 (STATUS, wave M8-C6 verification gap 5: a hand card's zoom opened by keyboard focus stayed over the board after the pointer moved away): while a
 * zoom is shown it closes when the pointer moves anywhere but its card (also when it was opened by focus, or when the card's element went away with
 * a re-render, so no mouseleave came), on Escape, and on a press anywhere else. Escape is not consumed: it keeps its meaning for the prompt (cancel,
 * CR 733.1) and the zone viewer. Window capture listeners, so a handler that stops the event on its way down cannot keep a zoom open.
 */
function useZoomDismiss(shown: boolean, anchor: { readonly current: Element | null }, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!shown) return;
    const away = (e: Event) => {
      const a = anchor.current;
      if (!a || !a.isConnected || !(e.target instanceof Node) || !a.contains(e.target)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    const events = ['pointermove', 'mousemove', 'pointerdown', 'mousedown'] as const;
    for (const type of events) window.addEventListener(type, away, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      for (const type of events) window.removeEventListener(type, away, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [shown, anchor]);
}

/** The zoom's state, outside the board's React state: only `ZoomHost` subscribes to it. */
class ZoomStore {
  private value: ZoomState | null = null;
  private readonly listeners = new Set<() => void>();
  readonly get = (): ZoomState | null => this.value;
  readonly subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  set(next: ZoomState | null): void {
    this.value = next;
    for (const l of [...this.listeners]) l();
  }
}

/** Shows the zoom and closes it when the pointer goes elsewhere (CL3); the only part of the board that draws again as the pointer moves over cards. */
function ZoomHost({ store, anchor, shown }: { store: ZoomStore; anchor: { current: Element | null }; shown: { current: ObjectId | null } }) {
  const ctx = useBoard();
  const zoom = useSyncExternalStore(store.subscribe, store.get);
  const o = zoom ? ctx.view.objects[zoom.id] : undefined;
  useZoomDismiss(o !== undefined && !isHidden(o), anchor, () => {
    anchor.current = null;
    shown.current = null;
    store.set(null);
    ctx.interaction.onObjectHover?.(null);
  });
  return <Zoom zoom={zoom} />;
}

function Reminders({ view }: { view: GameView }) {
  if (view.reminders.length === 0) return null;
  return (
    <section className="reminders" aria-label="Reminders">
      <h2 className="panel-title">Reminders</h2>
      <ul>
        {view.reminders.map((r) => (
          <li key={r.id} className="reminder" title="Not enforced by the engine: apply it by hand (manual text)">
            <strong>{r.sourceName}</strong> ({playerName(view, r.controller)}): {r.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ResultBanner({ view }: { view: GameView }) {
  if (!view.result) return null;
  const w = view.result.winner;
  return (
    <div className="result-banner" role="status">
      {w === null ? 'The game is a draw' : `${playerName(view, w)} wins`} ({view.result.reason})
    </div>
  );
}

/**
 * The end of the game (CR 104), Arena style: the result crosses the whole table in big 3D letters (Victory or Defeat for the player at the screen) over a
 * dimmed board. It is decoration (the result banner and the game-over panel say it to screen readers) and takes no clicks; folding the game-over panel
 * ("Show the board", which marks itself `data-result="folded"`) clears it so the final position can be studied.
 *
 * It sounds once as it appears: victory or defeat for the one player at this screen, otherwise (a draw, or a hot-seat game where both sit here) the
 * neutral end. After the final blow it waits for that blow's crash to land (the animator shows the screen about 0.7 s after it already).
 */
function ResultScreen({ view, seats }: { view: GameView; seats: readonly string[] | undefined }) {
  const w = view.result?.winner ?? null;
  // The one player at this screen (against the computer, or online); in hot-seat both sit here, so the screen names the winner instead.
  const me = seats ? (seats.length === 1 ? seats[0]! : null) : view.viewer;
  const tone = w === null ? 'draw' : me === null ? 'neutral' : w === me ? 'win' : 'lose';
  const over = view.result !== null;
  const heard = useRef(false);
  useEffect(() => {
    if (!over || heard.current) return;
    heard.current = true;
    const blow = soundClock.since('game.finalBlow');
    gameSfx(tone === 'win' ? 'game.victory' : tone === 'lose' ? 'game.defeat' : 'game.drawn', blow < 700 ? { delay: (700 - Math.max(0, blow)) / 1000 } : {});
  }, [over, tone]);
  if (!view.result) return null;
  const title = w === null ? 'Draw' : me === null ? `${playerName(view, w)} wins` : w === me ? 'Victory' : 'Defeat';
  return (
    <div className={`result-screen result-${tone}`} aria-hidden="true">
      <div className="result-hero">
        <Logo3D size={72} track="window" />
        <span className="result-word">{title}</span>
        <span className="result-sub">
          {tone === 'neutral' ? view.result.reason : `${w === null ? 'The game is a draw' : `${playerName(view, w)} wins`} · ${view.result.reason}`}
        </span>
      </div>
    </div>
  );
}

export function GameBoard({
  view: base, legalActions = NO_ACTIONS, interaction = {}, renderCard = defaultCardRenderer, useArtist = noArtist, prompt, pacer, animationScale = 1, cardsMayOverlap = false, seats,
  tableLayout, onTableLayout, cameraFollow = true, sleeves = NO_SLEEVES,
}: GameBoardProps) {
  const [staged, setStaged] = useState<StagedStack | null>(null);
  const view = useMemo(() => withStaged(base, staged), [base, staged]);
  // The animator's stage() resolves once the staged objects are drawn (it measures them next).
  const stagedDrawn = useRef<(() => void) | null>(null);
  const stagedNow = useRef<StagedStack | null>(null);
  useLayoutEffect(() => {
    stagedDrawn.current?.();
    stagedDrawn.current = null;
  }, [staged]);
  const stage = useCallback(
    (s: StagedStack | null) =>
      new Promise<void>((resolve) => {
        if (stagedNow.current === s) return resolve();
        stagedNow.current = s;
        stagedDrawn.current?.();
        stagedDrawn.current = resolve;
        setStaged(s);
      }),
    [],
  );
  const [focusStack, setFocusStack] = useState<ObjectId | null>(null);
  // The zoom lives in its own store, read only by <ZoomHost>: pointing at a card must not draw the whole board again (ui/arena perf).
  const [zoomStore] = useState(() => new ZoomStore());
  const [openZone, setOpenZone] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const [stageSlot, setStageSlot] = useState<HTMLDivElement | null>(null);
  const slots = useMemo(() => ({ actions: actionsSlot, stage: stageSlot, cardsMayOverlap }), [actionsSlot, stageSlot, cardsMayOverlap]);
  const [handOrders] = useState(() => new Map<string, ObjectId[]>());
  // The element the zoom belongs to (the card under the pointer or with the keyboard focus): outside the React state, the dismiss listeners only read it.
  const zoomAnchor = useRef<Element | null>(null);
  // A zoom opening on a new card is heard (softly; sweeping the pointer over a row of cards makes one sound per ZOOM_SOUND_MS, not one per card).
  const zoomSound = useRef(new RateLimit(ZOOM_SOUND_MS));
  const zoomedId = useRef<ObjectId | null>(null);
  const setZoom = useCallback((id: ObjectId | null, anchor?: Element | null) => {
    zoomAnchor.current = id === null ? null : anchor ?? null;
    if (id !== null && id !== zoomedId.current && zoomSound.current.take()) gameSfx('card.zoom');
    zoomedId.current = id;
    zoomStore.set(id === null ? null : { id, side: zoomSide(anchor) });
  }, [zoomStore]);
  const { playable, manaOnly, byHand } = useMemo(() => playableObjects(legalActions), [legalActions]);
  const selectable = useMemo(() => new Set(interaction.selectable ?? EMPTY), [interaction.selectable]);
  const selected = useMemo(() => new Set(interaction.selected ?? EMPTY), [interaction.selected]);
  const targeted = useMemo(() => targetedBy(view), [view]);
  // One context value per change of what it holds: a draw of the board for another reason does not make every card on it draw again.
  const ctx = useMemo<BoardContextValue>(
    () => ({ view, renderCard, useArtist, legalActions, playable, manaOnly, byHand, selectable, selected, targeted, focusStack, setFocusStack, setZoom, openZone, setOpenZone, interaction, handOrders }),
    [view, renderCard, useArtist, legalActions, playable, manaOnly, byHand, selectable, selected, targeted, focusStack, setZoom, openZone, interaction, handOrders],
  );
  // The seat at the bottom stays put while a hot-seat hand-off plays out on the spectator view (the cover comes right after).
  const lastViewer = useRef<string | null>(null);
  if (view.viewer !== null) lastViewer.current = view.viewer;
  const { bottom, top } = seating(view, lastViewer.current);
  // M12-4a: the table's layout (a game with three or four players; a two-player game is always today's board).
  const settings = useSettings();
  const setting = tableLayout ?? settings.tableLayout;
  const layout: BoardLayout = boardLayout(view, setting);
  const changeLayout = useCallback((l: TableLayout) => (onTableLayout ? onTableLayout(l) : settingsStore().update({ tableLayout: l })), [onTableLayout]);
  const layoutSwitch = layout === 'duel' ? null : <LayoutSwitch layout={setting} onChange={changeLayout} />;
  const zoomOpen = useCallback(() => zoomStore.get() !== null, [zoomStore]);
  const [reducedMotion] = useState(prefersReducedMotion);
  // The "one focused opponent" layout (5.2): the focus follows the turn and whoever attacks or targets the viewer; a clicked strip holds it until that changes.
  const [picked, setPicked] = useState<{ player: string; over: string | null } | null>(null);
  const focused = layout === 'focused' ? focusedOpponent(view, bottom.id, picked) : null;
  const pickFocus = useCallback((id: string) => setPicked({ player: id, over: autoFocus(view, bottom.id) }), [view, bottom.id]);
  // The pacer waits for each new view to be on screen before the second half of its animation.
  useLayoutEffect(() => {
    pacer?.committed(base);
  }, [pacer, base]);
  // The table's emblem and beam sit on the band between the two sides (--midline), wherever the rows put it.
  const mainRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const main = mainRef.current;
    const middle = main?.querySelector<HTMLElement>('.board-middle');
    if (!main || !middle) return;
    const place = () => {
      const m = main.getBoundingClientRect();
      const b = middle.getBoundingClientRect();
      if (m.height > 0) main.style.setProperty('--midline', `${Math.round(b.top - m.top + b.height / 2)}px`);
    };
    place();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(place);
    ro.observe(main);
    ro.observe(middle);
    const top = main.querySelector('.board-top');
    if (top) ro.observe(top);
    return () => ro.disconnect();
  }, [layout]);
  const started = view.turn.number > 0;
  return (
    <PlayerSleevesContext.Provider value={sleeves}>
      <BoardContext.Provider value={ctx}>
        <div
          className="game-board"
          data-viewer={view.viewer ?? 'spectator'}
          data-step={view.turn.step}
          data-active={started ? (view.turn.activePlayer === view.viewer ? 'me' : 'them') : 'none'}
          data-overlap={cardsMayOverlap ? 'yes' : 'no'}
          data-seats={top.length + 1}
          data-layout={layout}
          data-over={view.result ? '' : undefined}
          data-decision={view.pending && decidingPlayer(view.pending) === view.viewer ? view.pending.kind : undefined}
        >
          {/* The table makes its own sounds (zoom, picks, piles, drag): the page's generic click and hover sounds stay out of it (audio/uiSounds.ts). */}
          <div className="board-main" ref={mainRef} data-sfx-scope="manual">
            <ArenaBackdrop />
            {layout === 'shared' ? (
              <SharedTable
                key={lastViewer.current ?? 'none'}
                viewer={lastViewer.current}
                actionsSlot={setActionsSlot}
                zoomOpen={zoomOpen}
                reduced={reducedMotion || !cameraFollow}
                banner={<ResultBanner view={view} />}
                overlap={cardsMayOverlap}
                layoutSwitch={layoutSwitch}
              />
            ) : (
              <div className="arena-stage" data-fx="arena">
                <canvas className="fx-under" data-fx="under" aria-hidden="true" />
                <TargetArrows />
                {layout === 'focused' ? (
                  <div className="board-top board-top-focused">
                    <div className="opponent-strips">
                      {top
                        .filter((p) => p.id !== focused)
                        .map((p) => (
                          <OpponentStrip key={p.id} player={p} onFocus={pickFocus} />
                        ))}
                    </div>
                    {top
                      .filter((p) => p.id === focused)
                      .map((p) => (
                        <TopSide key={p.id} player={p} />
                      ))}
                  </div>
                ) : (
                  <div className="board-top">
                    {top.map((p) => (
                      <TopSide key={p.id} player={p} />
                    ))}
                  </div>
                )}
                <div className="board-middle">
                  <ResultBanner view={view} />
                  <CenterLine />
                </div>
                <div className="board-bottom">
                  <BottomSide player={bottom} own={view.viewer === bottom.id || view.open === true} actionsSlot={setActionsSlot} />
                </div>
                <TableStack overlap={cardsMayOverlap} />
                {layoutSwitch && <div className="table-chips table-chips-flat">{layoutSwitch}</div>}
              </div>
            )}
            {/* A decision drawn large over the table (the opening hand, assigning combat damage): the prompt fills it (prompts/stage.tsx). */}
            <div className="decision-stage" ref={setStageSlot} />
            <ResultScreen view={view} seats={seats} />
            <ZoomHost store={zoomStore} anchor={zoomAnchor} shown={zoomedId} />
            {logOpen && <GameLog onClose={() => setLogOpen(false)} />}
          </div>
          {/* The rail never moves: the stack's half above, the prompt's half below, each the same fixed height and scrolling
              inside itself, so the turn structure between them always sits in the middle of the rail. */}
          <aside className="board-side" aria-label="Stack and log">
            <div className="rail-top">
              <LogButton open={logOpen} onToggle={() => setLogOpen((o) => !o)} />
              <StackPanel />
              <Reminders view={view} />
            </div>
            <PhaseBar />
            <div className="board-prompt" {...(prompt !== undefined ? { role: 'region', 'aria-label': 'Prompt' } : {})}>
              <PromptSlotsContext.Provider value={slots}>{prompt}</PromptSlotsContext.Provider>
            </div>
          </aside>
          <FxLayer pacer={pacer} scale={animationScale} stage={stage} />
        </div>
      </BoardContext.Provider>
    </PlayerSleevesContext.Provider>
  );
}
