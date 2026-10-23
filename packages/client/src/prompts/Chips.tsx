/**
 * A row of toggle buttons for objects or players: the prompt's own list of choices (the board shows the same ids as clickable cards). Objects are grouped by
 * who controls them ("Yours", "Bob's") when more than one player's objects are listed, and pointing at a card's button (or focusing it) shows that card large
 * in the board's zoom, so a list of names can be read as cards.
 */
import { useContext, type FocusEvent, type MouseEvent } from 'react';
import { HIDDEN_DEF, type GameView } from '@openmtg/engine';
import { BoardContext } from '../board/context';
import { distinctLabels, isPlayer, playerName } from './names';

export interface ChipsProps {
  view: GameView;
  ids: readonly string[];
  selected?: readonly string[];
  /** Text after the label, e.g. the order number "1" or "attacking Bob". */
  marks?: Readonly<Record<string, string>>;
  onClick: (id: string) => void;
  disabled?: boolean;
  /** Accessible name of the group. */
  label: string;
}

/** The ids in groups by controller, the viewer's first, then the other players in seat order; players and unknown ids in a group of their own (key ''). */
export function chipGroups(view: GameView, ids: readonly string[]): { key: string; title: string; ids: string[] }[] {
  const byKey = new Map<string, string[]>();
  for (const id of ids) {
    const o = isPlayer(view, id) ? undefined : (view.objects[id] ?? view.lki[id]?.object);
    const key = o ? o.controller : '';
    byKey.set(key, [...(byKey.get(key) ?? []), id]);
  }
  const order = ['', ...(view.viewer !== null ? [view.viewer] : []), ...view.players.map((p) => p.id).filter((p) => p !== view.viewer)];
  return order
    .filter((k) => byKey.has(k))
    .map((k) => ({ key: k, title: k === '' ? 'Players' : k === view.viewer ? 'Yours' : `${playerName(view, k)}'s`, ids: byKey.get(k)! }));
}

export function Chips({ view, ids, selected = [], marks = {}, onClick, disabled = false, label }: ChipsProps) {
  const board = useContext(BoardContext);
  const labels = distinctLabels(view, ids);
  const groups = chipGroups(view, ids);
  const zoomable = (id: string) => {
    const o = view.objects[id];
    return board !== null && o !== undefined && o.defId !== HIDDEN_DEF;
  };
  const zoom = (id: string, e: MouseEvent | FocusEvent) => {
    if (zoomable(id)) board!.setZoom(id, e.currentTarget);
  };
  const unzoom = (id: string) => {
    if (zoomable(id)) board!.setZoom(null);
  };
  const chip = (id: string) => {
    const on = selected.includes(id);
    const mark = marks[id];
    return (
      <button
        key={id}
        type="button"
        className={on ? 'prompt-chip is-selected' : 'prompt-chip'}
        aria-pressed={on}
        disabled={disabled}
        data-id={id}
        onClick={() => onClick(id)}
        onMouseEnter={(e) => zoom(id, e)}
        onMouseLeave={() => unzoom(id)}
        onFocus={(e) => zoom(id, e)}
        onBlur={() => unzoom(id)}
      >
        {labels[id]}
        {mark ? <span className="prompt-chip-mark"> · {mark}</span> : null}
      </button>
    );
  };
  if (groups.length < 2) {
    return (
      <div className="prompt-chips" role="group" aria-label={label}>
        {ids.map(chip)}
      </div>
    );
  }
  return (
    <div className="prompt-chips prompt-chip-groups" role="group" aria-label={label}>
      {groups.map((g) => (
        <div key={g.key || 'players'} className="prompt-chip-group" role="group" aria-label={`${label}: ${g.title}`}>
          <span className="prompt-chip-group-title" aria-hidden="true">
            {g.title}
          </span>
          {g.ids.map(chip)}
        </div>
      ))}
    </div>
  );
}

/** Rule citations, shown with every prompt and error ("CR 601.2c, CR 115.1"). */
export function Rules({ rules }: { rules?: readonly string[] | undefined }) {
  if (!rules || rules.length === 0) return null;
  return <span className="prompt-rules">{rules.join(', ')}</span>;
}
