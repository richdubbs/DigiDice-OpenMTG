/**
 * CMP1 (CR 702.139a): a player's revealed companion beside their piles, for every viewer (it is revealed before the game begins, CR 103.2b, so it is public:
 * `PlayerState.companion` and its definition are in every view). It is outside the game (CR 400.11), so it is drawn by the board's card renderer in a dashed
 * frame (like a commander away from the command zone), with where it is: outside the game, or in the game since the turn its owner paid {3} to put it into
 * their hand (CR 116.2g: once per game; CR 702.139c: it stays in the game). The special action itself is a button of the priority prompt (the board never
 * acts on the game). Nothing is drawn for a player without a companion.
 */
import type { PlayerState } from '@openmtg/engine';
import { useBoard } from './context';

export function companionWhere(player: PlayerState): string {
  const rec = player.companion;
  if (!rec) return '';
  return rec.inHand === undefined ? 'Companion: outside the game' : `Companion: put into the hand on turn ${rec.inHand}`;
}

export function CompanionSlot({ player }: { player: PlayerState }) {
  const board = useBoard();
  const rec = player.companion;
  if (!rec) return null;
  const def = board.view.defs[rec.defId] ?? null;
  const name = def?.name ?? 'Companion';
  const where = companionWhere(player);
  const title =
    rec.inHand === undefined
      ? `${name} is ${player.name}'s companion, revealed and outside the game: once per game, in a main phase of their turn with an empty stack, they may pay {3} to put it into their hand (CR 702.139a, 116.2g).`
      : `${name} is ${player.name}'s companion; it was put into the hand on turn ${rec.inHand} and stays in the game (CR 702.139c).`;
  return (
    <div className="companion-slot commander-slot is-away" role="group" aria-label={`${player.name}'s companion, ${name}: ${where}`} title={title} data-companion={rec.defId} data-player-id={player.id}>
      <span className="command-card">
        <span className="command-card-away companion-card" aria-hidden="true">
          {board.renderCard({ def, face: 0, chars: null, size: 'small', faceDown: false })}
        </span>
      </span>
      <span className="commander-info">
        <span className="commander-where">{rec.inHand === undefined ? 'Companion (outside the game)' : `Companion (in the game, turn ${rec.inHand})`}</span>
      </span>
    </div>
  );
}
