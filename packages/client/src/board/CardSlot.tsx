/**
 * One card on the board: the card image (drawn by the card renderer, C2) plus everything around it that the board owns: highlight ring, tapped rotation and the
 * marker strip below the image. A hidden card (CR 400.2) is always drawn as the card back, and `back` forces the back for zones whose cards must never be
 * face up on this screen (the opponents' hands and every library), whatever the view contains. A face-down card the viewer may look at (CR 708.5) is also a
 * back on the board, named for the viewer; only the zoom shows its face.
 *
 * Attachments (Auras, Equipment, Fortifications: CR 301.5, 303.4) are tucked UNDER their host, as at a real table: each sits
 * behind the host, moved up so its name bar shows above the host's top edge, the first attached furthest back. They are siblings of the host's slot inside a
 * `.permanent-group`: each card is its own control, so one click never reports two objects and no button sits inside another.
 *
 * A permanent's power/toughness, loyalty, defense and counters are drawn on the card (CardOverlay.tsx); the strip keeps the other states.
 */
import { useContext, useId, useRef, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';
import type { ObjectId } from '@openmtg/engine';
import { ArtistCredit, creditedName } from '../cards';
import { CompactContext, useBoard } from './context';
import type { CardSize } from './cardRenderer';
import { CompactFace } from './table/CompactFace';
import { CardOverlay, hasOverlay, overlayOf } from './CardOverlay';
import { MarkerStrip, automationMarkers, layoutMarkers, permanentMarkers, useNameOf, usePromptMark, useTargetMarkers } from './Markers';
import { attachmentsOf, charsOf, combatRole, defOf, isHidden, isKnownFaceDown, isTokenCopy, objectName, permanentInfo, playerName, shownFace } from './model';
import { OwnerSleeve } from './sleeves';

export interface CardSlotProps {
  id: ObjectId;
  size?: CardSize;
  /** Draw the card back even when the view shows the card (hands of other players, libraries). */
  back?: boolean;
  /** Draw the marker strip (permanents and stack objects); off for compact lists. */
  markers?: boolean;
  /** Off when an enclosing control (a stack entry) is the click target: the card is then never a second button inside it. */
  clickable?: boolean;
  /**
   * The visible artist credit under the picture ("Illustrated by ...", Scryfall pictures only): for places that show cards at a readable size (the zone
   * viewers). Off on the table, where the credit is in the card's accessible name and its picture's tooltip, and the zoom shows the line.
   */
  credit?: boolean;
}

export function CardSlot(props: CardSlotProps) {
  const { view } = useBoard();
  const o = view.objects[props.id];
  if (!o) return null;
  const attachments = o.zone === 'battlefield' ? attachmentsOf(view, o.id) : [];
  if (attachments.length === 0) return <OneCard {...props} />;
  const n = attachments.length;
  const role = combatRole(view, o.id);
  const combat = role.attacking ? ' is-attacking' : role.blocking ? ' is-blocking' : '';
  return (
    <div className={`permanent-group${combat}`} style={{ '--att-n': n } as CSSProperties}>
      <OneCard {...props} />
      <div className="attachments" role="group" aria-label={`Attached to ${objectName(view, o.id)}`}>
        {attachments.map((a, i) => (
          // The first attached is furthest back and shows the most (`--k` steps above the host).
          <div className="attachment" key={a} style={{ '--k': n - i } as CSSProperties}>
            <CardSlot id={a} size="small" markers={false} />
          </div>
        ))}
      </div>
    </div>
  );
}

function OneCard({ id, size = 'normal', back = false, markers = true, clickable: canClick = true, credit = false }: CardSlotProps) {
  const board = useBoard();
  const { view, renderCard, interaction } = board;
  const nameOf = useNameOf();
  const targetMarkers = useTargetMarkers(id);
  const promptMark = usePromptMark(id);
  const markerId = useId();
  const overlayId = useId();
  const o = view.objects[id]!;

  // `hidden`: the viewer may not know the card (CR 400.2); `faceDown`: the viewer knows it, but it is face down on the table (CR 708.5).
  const hidden = back || isHidden(o);
  const faceDown = !hidden && isKnownFaceDown(o);
  const def = hidden ? null : defOf(view, o);
  const chars = hidden ? null : charsOf(view, o);
  const onBattlefield = o.zone === 'battlefield';
  const info = onBattlefield ? permanentInfo(view, o) : null;
  // A token that copies a card (CR 111.10, 707.2) has that card's definition, so its picture is the card's: the board tags it as a token beside its name.
  const tokenCopy = !hidden && !faceDown && isTokenCopy(o, def);
  const baseName = hidden ? (onBattlefield ? 'Face-down permanent' : 'Hidden card') : `${objectName(view, id)}${tokenCopy ? ' (token copy)' : ''}`;
  // Whose card it is: the controller on the battlefield and the stack (CR 108.4), the owner elsewhere; the viewer's own hand needs no suffix.
  const whose = o.zone === 'hand' ? null : playerName(view, onBattlefield || o.zone === 'stack' ? o.controller : o.owner);
  const face = def ? shownFace(def, o) : 0;
  // M12-4a: a permanent on a far seat of the shared table is drawn with a compact face (CompactFace.tsx); it shows no picture.
  const compact = useContext(CompactContext) && onBattlefield && !faceDown && def !== null;
  // The Scryfall picture's artist in the card's accessible name: "Lightning Bolt (Alice), illustrated by ..."; a card drawn as a
  // back (hidden or face down on the table) or with a compact face shows no picture to credit.
  const artist = board.useArtist(faceDown || compact ? null : def, face);
  const name = creditedName(whose ? `${baseName} (${whose})` : baseName, artist);

  // M6-11: the layout and double-faced states (which face is up, chapter, level, prototyped, prepared...) after the permanent's own markers
  const layout = hidden || faceDown ? [] : layoutMarkers(view, o);
  const marks = [...(!markers ? [] : [...(info ? permanentMarkers(info, nameOf) : hidden || faceDown ? [] : automationMarkers(def)), ...layout, ...targetMarkers]), ...promptMark];
  // On the card: P/T, loyalty or defense and the counters of a permanent (a hidden face-down one only its counters: they are public, CR 122.1).
  const overlay = info ? overlayOf(o, def, face, chars, info.isCreature) : null;

  const selected = board.selected.has(id);
  const selectable = board.selectable.has(id);
  const playable = !hidden && board.playable.has(id);
  const mana = !hidden && board.manaOnly.has(id);
  // FAST3 CL1: a permanent whose only actions are by-hand tools (manual text, CR 603.2, 604.1) is drawn quietly as "by hand", never as playable; a click
  // opens its menu in the priority prompt.
  const byHand = !hidden && board.byHand.has(id);
  const focused = board.focusStack !== null && (board.targeted.get(id) ?? []).includes(board.focusStack);
  const highlight = selected ? 'selected' : focused ? 'focus' : byHand ? 'byhand' : selectable ? 'selectable' : playable ? 'playable' : mana ? 'mana' : targetMarkers.length ? 'targeted' : undefined;

  const clickable = canClick && interaction.onObjectClick !== undefined && (selectable || selected || playable || mana || byHand);
  // Each handler stops at this card: an attachment is never also a click on its host (they are siblings now; this keeps any future nesting safe).
  const click = (e: MouseEvent) => {
    e.stopPropagation();
    interaction.onObjectClick?.(id);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      interaction.onObjectClick?.(id);
    }
  };
  const zoomable = !hidden;
  const hover = (on: boolean, e: MouseEvent | FocusEvent) => {
    if (!zoomable) return;
    e.stopPropagation();
    board.setZoom(on ? id : null, on ? e.currentTarget : null);
    interaction.onObjectHover?.(on ? id : null);
  };
  // The zoom follows the pointer, and the keyboard focus (Tab); a focus that comes from a mouse click does not open it, so after a click it closes as soon
  // as the pointer leaves the card, even while the card keeps the focus.
  const pressed = useRef(false);
  const onFocus = (e: FocusEvent) => {
    if (pressed.current) {
      pressed.current = false;
      return;
    }
    hover(true, e);
  };

  // ui/arena: attacking creatures step toward the defender and blockers toward the attackers (CR 508.1, 509.1); the offset sits outside the image.
  const combat = info?.combat;
  const classes = [
    'board-card',
    `slot-${size}`,
    o.tapped && onBattlefield ? 'is-tapped' : '',
    o.phasedOut ? 'is-phased' : '',
    highlight ? `hl-${highlight}` : '',
    clickable ? 'is-clickable' : '',
    combat?.attacking ? 'is-attacking' : '',
    combat?.blocking ? 'is-blocking' : '',
    onBattlefield && info?.isCreature && info.summoningSick ? 'is-sick' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // aria-pressed only while a decision asks to pick objects; a merely playable card is a plain button.
  const pressable = selectable || selected;
  const describedBy = [marks.length > 0 ? markerId : '', hasOverlay(overlay, !compact) ? overlayId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div
      className={classes}
      data-object-id={id}
      data-face={hidden || faceDown ? 'down' : 'up'}
      data-highlight={highlight}
      data-zone={o.zone}
      data-controller={o.controller}
      {...(clickable
        ? { role: 'button', tabIndex: 0, onClick: click, onKeyDown: onKey, 'aria-label': name, ...(pressable ? { 'aria-pressed': selected } : {}) }
        : { role: 'group', 'aria-label': name, ...(zoomable ? { tabIndex: 0 } : {}) })}
      aria-describedby={describedBy}
      onMouseDown={() => (pressed.current = true)}
      onMouseEnter={(e) => hover(true, e)}
      onMouseLeave={(e) => {
        pressed.current = false;
        hover(false, e);
      }}
      onFocus={onFocus}
      onBlur={(e) => hover(false, e)}
    >
      <div className="board-card-image">
        <OwnerSleeve owner={o.owner}>
          {compact && def ? <CompactFace def={def} face={face} chars={chars} /> : renderCard({ def: faceDown ? null : def, face, chars: faceDown ? null : chars, size, faceDown: o.faceDown === true })}
        </OwnerSleeve>
        {overlay && <CardOverlay overlay={overlay} pt={!compact} id={overlayId} />}
        {tokenCopy && (
          <span className="token-tag" aria-hidden="true" title="A token copy of this card (CR 111.10, 707.2)">
            Token
          </span>
        )}
      </div>
      <MarkerStrip markers={marks} id={markerId} />
      {credit && <ArtistCredit artist={artist} className="board-card-credit" />}
    </div>
  );
}
