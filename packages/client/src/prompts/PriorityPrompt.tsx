/**
 * Priority (CR 117): pass, or click a playable card (highlighted on the board, listed here): with one action it does it at once, with several it shows
 * what it can do: play it as a land (CR 305.1), cast it (CR 601), activate one of its abilities (CR 602) or a mana ability (CR 605). Every listed action
 * comes from the engine's `legalActions`, so it is accepted.
 * Pass priority stays first, in the same place, however many cards are listed; sources with nothing but mana abilities (often every untapped land) are
 * one "Mana abilities (N)" entry here, while the board still highlights each of them.
 * An ability activated from the hand (channel, cycling, ninjutsu, CR 602.1, 113.6j) is never done by one click, even when it is the card's only action: a
 * click on a card in hand means "play it", so its menu opens instead, and a land card that can't be played right now says why (CR 305.2:
 * Otawara, Soaring City clicked after the turn's land drop must not go straight into its channel ability).
 *
 * By-hand tools (FAST3 CL1, C6 gap 7; docs/design/m8-client.md "the by-hand tools"): the engine lists `manualTrigger` ("it triggered": put a manual
 * triggered ability on the stack by hand, CR 603.2, 603.3) and `manualStatic` (apply a manual static ability by hand, CR 604.1) for the permanents with
 * such text. They are never done by one click: a card clicked on the board with a by-hand tool always opens its menu, where the tools are a group of
 * their own ("By hand"). Sources with nothing but by-hand tools are one "By hand (N)" entry here, like the mana sources, and are marked "by hand" on the
 * board instead of being drawn as playable.
 *
 * Hold priority (AP1): the engine passes for a player who can do nothing but pass and use mana abilities, and right after their
 * own spell or ability (Arena). The "Hold priority" toggle next to Pass (shortcut H) makes the game stop for this player at every priority, also right
 * after their own spell or ability (CR 117.3c), until it is turned off or the turn ends (the engine clears it then). It is the engine's
 * `StopSettings.holdPriority`, sent as a `setStops` action, so it works the same in hot-seat, against the computer and online.
 */
import { useEffect, useRef, useState } from 'react';
import { faceChars, hasType, isByHandKind, type Action, type GameView, type LegalAction, type ObjectId, type PlayerId, type PlayerState } from '@openmtg/engine';
import { gameSfx } from '../game/sound';
import { Chips } from './Chips';
import { useEscape, usePrimary } from './keys';
import { objectName } from './names';
import { usePublishSelection } from './selection';
import type { PromptProps } from './types';
import { PromptActions } from './PromptActions';

/** Legal actions grouped by the card or permanent they are about, in the engine's order. */
export function actionsByObject(legal: readonly LegalAction[]): Map<ObjectId, LegalAction[]> {
  const out = new Map<ObjectId, LegalAction[]>();
  for (const a of legal) {
    if (a.kind === 'pass' || a.object === undefined) continue;
    const list = out.get(a.object) ?? [];
    list.push(a);
    out.set(a.object, list);
  }
  return out;
}

/** The `setStops` action that turns this player's hold-priority toggle on or off (the other stop settings unchanged). */
export function holdPriorityAction(me: PlayerState, on: boolean): Action {
  return { type: 'setStops', player: me.id, stops: { ...me.stops, holdPriority: on } };
}

/** H toggles hold priority: not while typing, not with a modifier (Ctrl+H and the like belong to the browser), not on a key repeat. */
function useHoldKey(toggle: () => void): void {
  const latest = useRef(toggle);
  latest.current = toggle;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'h' && e.key !== 'H') || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** The hold-priority toggle (AP1): on, the game stops for this player at every priority until the end of the turn (CR 117.3c). */
function HoldPriority({ me, act, busy }: { me: PlayerState; act: (a: Action) => void; busy: boolean }) {
  const holding = me.stops.holdPriority === true;
  const full = me.stops.fullControl;
  const toggle = () => {
    if (!busy && !full) act(holdPriorityAction(me, !holding));
  };
  useHoldKey(toggle);
  return (
    <button
      type="button"
      className={`hold-toggle${holding ? ' is-on' : ''}`}
      aria-pressed={holding || full}
      disabled={busy || full}
      onClick={toggle}
      aria-keyshortcuts="H"
      title={
        full
          ? 'Full control is on: the game already stops at every priority'
          : 'H: stop at every priority until the end of this turn, also right after your own spells and abilities (CR 117.3c)'
      }
    >
      {holding ? 'Holding priority' : 'Hold priority'}
    </button>
  );
}

/**
 * CMP1: special actions about no object (the companion's "pay {3}: put it into your hand", CR 116.2g, 702.139a: the card is outside the game, CR 400.11, so
 * there is nothing on the board to click). Each is a button of its own in the action bar, with its rule in the tooltip.
 */
export const objectlessSpecials = (legal: readonly LegalAction[]): LegalAction[] => legal.filter((a) => a.kind === 'special' && a.object === undefined);

/**
 * The tooltip of an objectless special action's button. CMP1: the companion's, once per game. trek-11: playing a card you own from outside the game (The Holodeck: "Once
 * during each of your turns, you may play a permanent card you own from outside the game or from your graveyard", CR 400.11b): a land play or a spell cast the ordinary way,
 * not a special action of the stack-less kind, and the permission's one use each turn is shared with the cards in the graveyard.
 */
export const objectlessSpecialTitle = (a: LegalAction): string =>
  a.action.type === 'special' && a.action.kind === 'playOutside'
    ? "A card you own outside the game (your sideboard), played because an effect lets you: a land is played as your land drop, any other permanent card is cast the usual way with its mana cost, so it can be responded to. The effect's use for this turn is spent, and covers your graveyard too (CR 400.11b, 305.1, 601.3)."
    : "A special action: it doesn't use the stack, so nobody can respond; once per game, in a main phase of your turn with an empty stack (CR 116.2g, 702.139a)";

/** FAST5X E6: is this special action plotting a card (CR 116.2k, 702.170a)? */
const isPlot = (a: LegalAction): boolean => a.action.type === 'special' && a.action.kind === 'plot';

/**
 * M6-11 (m6 design 3.4, D8): what the player should know before turning a face-down permanent face up. It is a special action (CR 116.2b): it doesn't use
 * the stack, so nobody can respond to it, and the player may take it any time they have priority. Each way it can be done (its morph, megamorph or disguise
 * cost, or the mana cost of a manifested or cloaked creature card, CR 701.40b, 701.58b) is its own button, so the player chooses how; a cost with X asks
 * for X next (CR 702.37f, 107.3a). A click on the permanent never does it at once: it always opens this menu (the choice is the point).
 * FAST5X E6: plotting a card from the hand (CR 116.2k, 702.170a) is the other special action of this menu; it gets its own hint.
 */
export function specialHint(special: readonly LegalAction[]): string {
  if (special.length > 0 && special.every(isPlot)) {
    return "Plotting is a special action: you pay the plot cost and exile the card without using the stack, so nobody can respond. On a later turn you may cast it from exile without paying its mana cost, during your main phase while the stack is empty (CR 116.2k, 702.170a, 702.170d).";
  }
  const x = special.some((a) => /\{X\}/.test(a.label));
  const ways = special.length > 1 ? ` Choose how: it can be turned face up in ${special.length} ways.` : '';
  return `Turning a face-down permanent face up is a special action: it doesn't use the stack, so nobody can respond (CR 116.2b, 702.37e).${ways}${x ? ' You choose X next (CR 702.37f).' : ''}`;
}

/**
 * Why a land card in `player`'s hand isn't offered as a land play right now (CR 305.1, 305.2), or null when it is, or it isn't a land card (a modal
 * double-faced card counts if either face is a land, CR 712.12). Read from the view: the turn, the step, the stack and the lands played this turn.
 */
export function landPlayHint(view: GameView, player: PlayerId, id: ObjectId, actions: readonly LegalAction[]): string | null {
  const o = view.objects[id];
  const def = o && view.defs[o.defId];
  if (!o || !def || o.zone !== 'hand' || actions.some((a) => a.kind === 'playLand')) return null;
  const faces = def.layout === 'modal_dfc' ? def.faces.map((_, i) => i) : [0];
  if (!faces.some((i) => hasType(faceChars(def, i), 'Land'))) return null;
  const why =
    view.turn.activePlayer !== player ? 'lands are played only during your own turn'
    : (view.turn.step !== 'main1' && view.turn.step !== 'main2') || view.zones.stack.length > 0 ? 'lands are played only in your main phase while the stack is empty'
    : (view.players.find((p) => p.id === player)?.landsPlayedThisTurn ?? 0) > 0 ? 'you have already played a land this turn'
    : 'something stops it';
  return `You can't play it as a land right now: ${why} (CR 305.1, 305.2).`;
}

export function PriorityPrompt({ d, view, legal, act, busy }: PromptProps<'priority'>) {
  const [open, setOpen] = useState<ObjectId | null>(null);
  const [showMana, setShowMana] = useState(false);
  const [showByHand, setShowByHand] = useState(false);
  const byObject = actionsByObject(legal);
  const playable = [...byObject.keys()];
  const manaOnly = playable.filter((id) => byObject.get(id)!.every((a) => a.isMana));
  const byHandOnly = playable.filter((id) => byObject.get(id)!.every((a) => isByHandKind(a.kind)));
  const cards = playable.filter((id) => !manaOnly.includes(id) && !byHandOnly.includes(id));
  const passAction = legal.find((a) => a.kind === 'pass')?.action ?? { type: 'pass' as const, player: d.player };
  // Passing (the button or Space) is heard as "acknowledged, moving on" (priority.pass), not as a generic confirm.
  const pass = () => {
    gameSfx('priority.pass');
    act(passAction);
  };
  const click = (id: string) => setOpen((o) => (o === id ? null : id));
  // ui/arena (like Arena): a card clicked on the board with one thing to do does it at once (play the land, cast the spell, tap the land for mana;
  // casting can still be cancelled while targets and costs are chosen, CR 733.1); with several, its list of actions opens here. The chips below keep
  // the explicit list for the keyboard. A by-hand tool is never done by one click (the player reads the text first): its card always opens the menu. Nor
  // is an ability of a card in the hand (Otawara's channel once the land drop is used): the click meant to play the card.
  const inHand = (id: string) => view.objects[id]?.zone === 'hand';
  const boardClick = (id: string) => {
    const list = byObject.get(id) ?? [];
    if (list.length === 1 && !isByHandKind(list[0]!.kind) && list[0]!.kind !== 'special' && !(list[0]!.kind === 'activate' && inHand(id))) {
      setOpen(null);
      act(list[0]!.action);
      return;
    }
    // The table makes no generic click sound (GameBoard): opening the card's list of actions is heard here.
    gameSfx('ui.select');
    click(id);
  };
  const marks: Record<string, string> = { ...Object.fromEntries(manaOnly.map((id) => [id, 'mana'])), ...Object.fromEntries(byHandOnly.map((id) => [id, 'by hand'])) };
  usePrimary(pass);
  useEscape(() => {
    if (open === null) return false;
    setOpen(null);
    return true;
  });
  usePublishSelection({ selectable: playable, selected: open ? [open] : [], marks, click: boardClick });
  const actions = open !== null ? byObject.get(open) : undefined;
  const regular = actions?.filter((a) => !isByHandKind(a.kind) && a.kind !== 'special') ?? [];
  const special = actions?.filter((a) => a.kind === 'special') ?? [];
  const byHand = actions?.filter((a) => isByHandKind(a.kind)) ?? [];
  const landHint = actions && open !== null ? landPlayHint(view, d.player, open, actions) : null;
  const actionButton = (a: LegalAction, i: number) => (
    <button
      key={i}
      type="button"
      disabled={busy}
      onClick={() => {
        setOpen(null);
        act(a.action);
      }}
    >
      {a.label}
    </button>
  );
  const top = view.zones.stack[view.zones.stack.length - 1];
  const me = view.players.find((p) => p.id === d.player);
  const objectless = objectlessSpecials(legal);
  return (
    <>
      <PromptActions>
        <button type="button" className="button-primary" disabled={busy} onClick={pass} title="Space">
          Pass priority
        </button>
        {me && <HoldPriority me={me} act={act} busy={busy} />}
        {objectless.map((a, i) => (
          <button
            key={`special-${i}`}
            type="button"
            className="special-action"
            disabled={busy}
            onClick={() => {
              gameSfx('ui.select');
              act(a.action);
            }}
            title={objectlessSpecialTitle(a)}
          >
            {a.label}
          </button>
        ))}
        {manaOnly.length > 0 && (
          <button type="button" aria-expanded={showMana} onClick={() => setShowMana((v) => !v)}>
            Mana abilities ({manaOnly.length})
          </button>
        )}
        {byHandOnly.length > 0 && (
          <button type="button" aria-expanded={showByHand} onClick={() => setShowByHand((v) => !v)} title="Manual text the engine does not run: apply it by hand">
            By hand ({byHandOnly.length})
          </button>
        )}
      </PromptActions>
      {top !== undefined && <p className="prompt-detail">Top of the stack: {objectName(view, top)}. It resolves when all players pass in succession (CR 117.4).</p>}
      {cards.length > 0 ? (
        <Chips view={view} ids={cards} selected={open ? [open] : []} onClick={click} disabled={busy} label="Playable cards" />
      ) : (
        <p className="prompt-detail">
          Nothing to play right now{manaOnly.length > 0 ? ' except mana abilities' : ''}{byHandOnly.length > 0 ? `${manaOnly.length > 0 ? ' and' : ' except'} by-hand tools` : ''}.
        </p>
      )}
      {showMana && manaOnly.length > 0 && (
        <Chips view={view} ids={manaOnly} selected={open ? [open] : []} marks={marks} onClick={click} disabled={busy} label="Mana abilities" />
      )}
      {showByHand && byHandOnly.length > 0 && (
        <Chips view={view} ids={byHandOnly} selected={open ? [open] : []} marks={marks} onClick={click} disabled={busy} label="By-hand tools" />
      )}
      {actions && open !== null && (
        <div className="prompt-menu" role="group" aria-label={`Actions of ${objectName(view, open)}`}>
          {landHint !== null && <p className="prompt-hint">{landHint}</p>}
          {regular.map(actionButton)}
          {special.length > 0 && (
            <div className="prompt-menu-special" role="group" aria-label={special.every(isPlot) ? 'Plot' : 'Turn face up'}>
              <p className="prompt-hint">{specialHint(special)}</p>
              {special.map(actionButton)}
            </div>
          )}
          {byHand.length > 0 && (
            <div className="prompt-menu-byhand" role="group" aria-label="By hand">
              <p className="prompt-hint">By hand: the engine does not run this text (CR 603.2, 603.3 for a trigger; CR 604.1 for a static ability). You apply its effect with manual adjustments; the log names the card and the text.</p>
              {byHand.map(actionButton)}
            </div>
          )}
          <button type="button" className="button-link" onClick={() => setOpen(null)}>
            Close
          </button>
        </div>
      )}
    </>
  );
}
