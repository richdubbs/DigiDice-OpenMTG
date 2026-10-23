/**
 * M12-4a (docs/design/m12-multiplayer.md 5.2 "One focused opponent"): an opponent who is not the focused one, as a strip along the top of the table: their
 * identity disc (life, commander damage, counters), the counts of their hand, library and graveyard, and a single row of their creatures (the main line,
 * compact faces; the zoom still shows each whole card). Clicking the strip (anywhere but a card or a choosable disc) brings that opponent forward.
 */
import type { CSSProperties, MouseEvent } from 'react';
import type { PlayerState } from '@openmtg/engine';
import { CardSlot } from '../CardSlot';
import { CompactContext, useBoard } from '../context';
import { battlefieldRows, cardCount } from '../model';
import { PlayerPanel } from '../PlayerPanel';
import { placementLabel } from './seats';

export function OpponentStrip({ player, onFocus }: { player: PlayerState; onFocus: (id: string) => void }) {
  const { view } = useBoard();
  const id = player.id;
  const { creatures } = battlefieldRows(view, id);
  const out = placementLabel(view, id);
  const hand = view.zones.hand[id]?.length ?? 0;
  const library = view.zones.library[id]?.length ?? 0;
  const graveyard = view.zones.graveyard[id]?.length ?? 0;
  const click = (e: MouseEvent) => {
    if ((e.target as Element).closest('.board-card, .player-panel.hl-selectable, .player-panel.hl-selected, button, [role="button"], [role="dialog"]')) return;
    onFocus(id);
  };
  return (
    <section className={`opponent-strip${player.hasLost ? ' is-out' : ''}`} data-player-id={id} aria-label={`${player.name} (strip)`} onClick={click}>
      <button type="button" className="strip-focus" onClick={() => onFocus(id)} title={`Bring ${player.name} forward`}>
        Focus
      </button>
      <PlayerPanel player={player} position="top" />
      <div className="strip-counts">
        <span title="Cards in hand (CR 402)">Hand {hand}</span>
        <span title="Cards in library (CR 401.3)">Lib {library}</span>
        <span title="Cards in graveyard (CR 404)">GY {graveyard}</span>
        {out && <span className="seat-placement">{out}</span>}
      </div>
      <CompactContext.Provider value={true}>
        <div className="strip-creatures bf-row" role="list" aria-label={`${player.name}'s creatures: ${cardCount(creatures.length)}`} style={{ '--n': Math.max(1, creatures.length), '--units': Math.max(1, creatures.length) } as CSSProperties}>
          {creatures.map((c) => (
            <div role="listitem" className="bf-slot" key={c.id}>
              <CardSlot id={c.id} size="small" />
            </div>
          ))}
        </div>
      </CompactContext.Provider>
    </section>
  );
}
