/**
 * The stack (CR 405), drawn like Arena's: a pile of cards whose top object (the next to resolve, CR 405.2) sits in front at the bottom, just above the prompt,
 * with the older objects peeking out behind it. Each entry keeps its controller, X, its text and its targets (CR 601.2c); pointing at an entry emphasizes its
 * targets on the board (the fx layer draws arrows to them), and every target also carries a "Target of ..." marker while the spell or ability is on the
 * stack. Spells show their card; activated and triggered abilities show their source's card with a "Trigger" or "Ability" band (AbilityTile).
 *
 * The entries overlap only when card pictures may overlap (`data-overlap="yes"` on the board: our own frames and uploaded images); while Scryfall images can
 * be on screen they stand one under another, so no picture is ever covered (ARCHITECTURE.md "Card images").
 *
 * When a prompt lets the player choose a spell or ability on the stack ("target spell", CR 115.1), the whole entry is the click target and carries the
 * highlight; the first such entry is scrolled into view when the prompt opens.
 */
import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { useBoard } from './context';
import { CardSlot } from './CardSlot';
import { MarkerStrip, layoutMarkers, stackAutomationMarkers } from './Markers';
import { charsOf, defOf, playerName, shownFace, stackItems, targetName, type StackItem } from './model';
import { OwnerSleeve } from './sleeves';

const KIND_LABEL = { spell: 'Spell', activated: 'Activated ability', triggered: 'Triggered ability' } as const;

/**
 * An ability on the stack: the card it comes from (its source's picture, drawn by the card renderer) with a "Trigger" or "Ability" band, so the player sees
 * which card it is at a glance; on the table's pile, where it is as large as a card, the ability's own text sits along the bottom of the card (board.css).
 * An ability with no card to show (an emblem's, or a source the view has no definition for) is a tile of our own: its source's name and its text.
 */
function AbilityTile({ item }: { item: StackItem }) {
  const { view, renderCard } = useBoard();
  const o = view.objects[item.id];
  const def = o ? defOf(view, o) : null;
  const card = def !== null && def.layout !== 'emblem' && !o?.faceDown && def.faces.length > 0;
  const face = card && o ? Math.min(o.stack?.abilityRef?.face ?? o.face ?? 0, def.faces.length - 1) : 0;
  const kind = item.kind === 'triggered' ? 'Trigger' : 'Ability';
  if (card) {
    return (
      <div className={`ability-tile ability-${item.kind} has-card`} aria-hidden="true">
        <div className="ability-card-picture">{renderCard({ def, face, chars: null, size: 'normal', faceDown: false })}</div>
        <span className="ability-band">
          {item.kind === 'triggered' ? '✦' : '⚡︎'} {kind}
        </span>
        {item.text && <span className="ability-card-text">{item.text}</span>}
      </div>
    );
  }
  return (
    <div className={`ability-tile ability-${item.kind}`} aria-hidden="true">
      <span className="ability-emblem">{item.kind === 'triggered' ? '✦' : '⚡︎'}</span>
      <span className="ability-kind">{kind}</span>
      <span className="ability-source">{item.name}</span>
      {item.text && <span className="ability-text">{item.text}</span>}
    </div>
  );
}

export function StackPanel() {
  const board = useBoard();
  const { view, setFocusStack, focusStack, interaction } = board;
  const items = stackItems(view);
  const list = useRef<HTMLOListElement>(null);
  const firstChoosable = items.find((item) => board.selectable.has(item.id))?.id ?? null;
  useEffect(() => {
    if (firstChoosable === null) return;
    list.current?.querySelector<HTMLElement>(`[data-stack-id="${firstChoosable}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [firstChoosable]);
  return (
    <section className={`stack-panel${items.length === 0 ? ' is-empty' : ''}`} aria-label={`Stack (${items.length})`} data-fx="stack">
      <h2 className="panel-title" title="CR 405: the last object put on the stack resolves first">
        Stack <span className="count">{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="muted stack-empty">Empty</p>
      ) : (
        <ol className="stack-list" ref={list} style={{ '--stack-n': items.length } as CSSProperties}>
          {items.map((item, i) => {
            const selected = board.selected.has(item.id);
            const choosable = interaction.onObjectClick !== undefined && (board.selectable.has(item.id) || selected);
            const choose = () => interaction.onObjectClick?.(item.id);
            const onKey = (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                choose();
              }
            };
            const hl = selected ? ' hl-selected' : choosable ? ' hl-selectable' : '';
            const mine = item.controller === view.viewer;
            return (
              <li
                key={item.id}
                className={`stack-item stack-${item.kind}${i === 0 ? ' is-top' : ''}${mine ? ' is-mine' : ' is-theirs'}${focusStack === item.id ? ' is-focus' : ''}${hl}${choosable ? ' is-clickable' : ''}`}
                data-stack-id={item.id}
                style={{ '--i': i, zIndex: items.length - i } as CSSProperties}
                tabIndex={0}
                {...(choosable ? { role: 'button', onClick: choose, onKeyDown: onKey, 'aria-pressed': selected, 'aria-label': `${item.name} (${playerName(view, item.controller)})` } : {})}
                onMouseEnter={() => setFocusStack(item.id)}
                onMouseLeave={() => setFocusStack(null)}
                onFocus={() => setFocusStack(item.id)}
                onBlur={() => setFocusStack(null)}
              >
                <div className="stack-card">
                  {item.kind === 'spell' ? <CardSlot id={item.id} size="normal" markers={false} clickable={!choosable} /> : <AbilityTile item={item} />}
                </div>
                <div className="stack-info">
                  <div className="stack-head">
                    {i === 0 && <span className="badge badge-top">Top</span>}
                    <span className="stack-name">{item.name}</span>
                    {/* Who cast it, on the name line when the rail is a compact list beside the pile on the table (board.css). */}
                    <span className="stack-by" aria-hidden="true">
                      {playerName(view, item.controller)}
                    </span>
                  </div>
                  <span className="stack-kind">{item.isCopy ? 'Copy of a spell' : KIND_LABEL[item.kind]}</span>
                  <div className="stack-meta">
                    <span>Controller: {playerName(view, item.controller)}</span>
                    {item.x !== undefined && <span>X = {item.x}</span>}
                  </div>
                  {/* Design 10.5: how much of it the engine resolves; manual resolution happens here, at resolution. */}
                  <MarkerStrip markers={view.objects[item.id] ? [...stackAutomationMarkers(view, view.objects[item.id]!), ...layoutMarkers(view, view.objects[item.id]!)] : []} />
                  {item.kind !== 'spell' && item.text && <p className="stack-text">{item.text}</p>}
                  {item.targets.length > 0 && (
                    <div className="stack-targets">
                      Targets:{' '}
                      {item.targets.map((t, j) => (
                        <span key={`${t}-${j}`} className="target-chip" data-target-id={t}>
                          {targetName(view, t)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div className="stack-anchor" data-fx="stack-anchor" aria-hidden="true" />
    </section>
  );
}

/**
 * ui/arena: the stack on the table, as in Arena. The spells and abilities waiting to resolve stand as a pile at the table's right edge, on its middle line:
 * the next to resolve (CR 405.2) in front and largest, each older one a step higher behind it, and its count above. Casts fly onto this pile and resolutions start from it (the fx layer).
 * Pointing at a card shows it large and its targets' arrows; when the prompt lets the player choose a spell or ability on the stack, clicking it chooses it.
 * The rail lists the same objects with their details and is what keyboards and screen readers use, so this pile is decoration for them (aria-hidden, not
 * focusable). It is always on the table while anything is on the stack, creature spells included. While card pictures may
 * not overlap (Scryfall images can be on screen) it shows only the next object to resolve, with the count above, so no picture is ever covered
 * (ARCHITECTURE.md "Card images").
 */
export function TableStack({ overlap = true }: { overlap?: boolean }) {
  const board = useBoard();
  const { view, setFocusStack, setZoom, interaction, renderCard } = board;
  const items = stackItems(view);
  const shown = items.slice(0, overlap ? 4 : 1);
  return (
    <div className={`table-stack${items.length === 0 ? ' is-empty' : ''}`} aria-hidden="true" style={{ '--n': shown.length } as CSSProperties}>
      <span className="table-stack-anchor" data-fx="table-stack-anchor" />
      {items.length > 0 && <span className="table-stack-count">Stack {items.length}</span>}
      {[...shown].reverse().map((item) => {
        const depth = items.indexOf(item);
        const o = view.objects[item.id];
        const def = o ? view.defs[o.defId] ?? null : null;
        const chars = o ? charsOf(view, o) : null;
        const selected = board.selected.has(item.id);
        const choosable = interaction.onObjectClick !== undefined && (board.selectable.has(item.id) || selected);
        const mine = item.controller === view.viewer;
        return (
          <div
            key={item.id}
            className={`table-stack-item${depth === 0 ? ' is-top' : ''}${mine ? ' is-mine' : ' is-theirs'}${selected ? ' hl-selected' : choosable ? ' hl-selectable' : ''}`}
            data-table-stack-id={item.id}
            style={{ '--d': depth } as CSSProperties}
            onMouseEnter={(e) => {
              setFocusStack(item.id);
              setZoom(item.id, e.currentTarget);
            }}
            onMouseLeave={() => {
              setFocusStack(null);
              setZoom(null);
            }}
            {...(choosable ? { onClick: () => interaction.onObjectClick?.(item.id) } : {})}
          >
            {item.kind === 'spell' && def ? (
              // M6-11, CR 708.4: a face-down spell is the card back on the table, whoever looks (its controller sees its card in the zoom)
              <div className="board-card-image">
                {o?.faceDown ? <OwnerSleeve owner={o.owner}>{renderCard({ def: null, face: 0, chars: null, size: 'normal', faceDown: true })}</OwnerSleeve> : renderCard({ def, face: o ? shownFace(def, o) : 0, chars, size: 'normal', faceDown: false })}
              </div>
            ) : (
              <AbilityTile item={item} />
            )}
          </div>
        );
      })}
    </div>
  );
}
