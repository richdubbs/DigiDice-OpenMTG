/**
 * M12-4a (docs/design/m12-multiplayer.md 5.1 "Seats"): one player's place on the shared table: their battlefield with the creature line toward the table's
 * centre and the lands toward their own edge (as at a real table: a seat across the table is drawn like today's top side, mirrored rows, upright cards),
 * their name plate, and for another player their hand of backs (face up in a replay's open view, Hand.tsx), identity disc and piles at their own edge.
 * The viewer's own disc, piles and hand are not here: they stay in the screen-space HUD at the bottom left, beside the hand (the owner's board rules).
 *
 * The name plate names the player's place in turn order relative to the viewer ("next", "previous": left and right at a rectangular table are not obvious,
 * CR 101.4) with a small turn-order arrow, and is the button that looks from that seat (a viewpoint only: the data stays the viewer's own view, CR 400.2).
 * A player who left the game (CR 104.5, 800.4a): the seat is empty (their objects are gone, m12 design D9) and the plate is greyed with their place.
 */
import { memo, type CSSProperties } from 'react';
import { Battlefield } from '../Battlefield';
import { CompactContext, useBoard } from '../context';
import { OtherHand } from '../Hand';
import { Piles, PlayerPanel } from '../PlayerPanel';
import { RELATION_LABEL, RELATION_TITLE, placementLabel, type SeatPlace } from './seats';

const ARROW: Record<SeatPlace['relation'], string> = { you: '', next: '↱', previous: '↰', across: '⇄' };

export interface SeatProps {
  place: SeatPlace;
  /** The viewer's own seat (their HUD is in screen space). */
  own: boolean;
  compact: boolean;
  /** This seat is the one the camera looks from. */
  viewing: boolean;
  onView: (player: string) => void;
}

export function SeatPlate({ place, own, viewing, onView }: Omit<SeatProps, 'compact'>) {
  const { view } = useBoard();
  const p = place.player;
  const out = placementLabel(view, p.id);
  const rel = place.relation;
  const label = own ? (viewing ? 'Your seat' : 'Back to your seat') : `Look from ${p.name}'s seat`;
  return (
    <div className={`seat-plate${out ? ' is-out' : ''}${viewing ? ' is-viewing' : ''}`} data-player-id={p.id} data-relation={rel}>
      <button type="button" className="seat-plate-button" onClick={() => onView(p.id)} aria-pressed={viewing} aria-label={`${label} (key ${place.key})`} title={`${label} (key ${place.key})`}>
        <span className="seat-key" aria-hidden="true">
          {place.key}
        </span>
        <span className="seat-name">{own ? `${p.name} (you)` : p.name}</span>
        {!own && (
          <span className="seat-rel" title={RELATION_TITLE[rel]}>
            <span className="seat-arrow" aria-hidden="true">
              {ARROW[rel]}
            </span>{' '}
            {RELATION_LABEL[rel]}
          </span>
        )}
      </button>
      {out && (
        <span className="seat-placement" title="Left the game (CR 104.5, 800.4a)">
          {out}
        </span>
      )}
    </div>
  );
}

export const Seat = memo(function Seat({ place, own, compact, viewing, onView }: SeatProps) {
  const p = place.player;
  const far = place.row === 'far';
  const style = { gridColumn: place.span === 2 ? '1 / -1' : String(place.col + 1) } as CSSProperties;
  const plate = <SeatPlate key="plate" place={place} own={own} viewing={viewing} onView={onView} />;
  const hud = own ? null : (
    <div key="hud" className="side-bar seat-hud">
      {far && <OtherHand player={p.id} />}
      <div className="seat-cluster">
        <PlayerPanel player={p} position="top" />
        <Piles player={p} />
      </div>
      {!far && <OtherHand player={p.id} />}
    </div>
  );
  const field = <Battlefield key="field" player={p.id} mirrored={far} />;
  return (
    <section
      className={`seat side ${far ? 'side-top seat-far' : 'seat-near'}${own ? ' is-own' : ''}${p.hasLost ? ' is-out' : ''}${compact ? ' is-compact' : ''}`}
      data-seat={place.pos}
      data-player-id={p.id}
      data-relation={place.relation}
      aria-label={`${p.name}'s seat`}
      style={style}
    >
      <CompactContext.Provider value={compact}>{far ? [plate, hud, field] : [field, hud, plate]}</CompactContext.Provider>
    </section>
  );
});

/** The seat's mat on the floor layer (under the cards): its play area in its player's colour, aligned with the seat on the card layer. */
export function SeatMat({ place, own }: { place: SeatPlace; own: boolean }) {
  const style = { gridColumn: place.span === 2 ? '1 / -1' : String(place.col + 1) } as CSSProperties;
  return <div className={`seat-mat seat-mat-${place.row}${own ? ' is-own' : ''}${place.player.hasLost ? ' is-out' : ''}`} data-player-id={place.player.id} style={style} />;
}
