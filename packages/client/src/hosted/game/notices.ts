/**
 * The hosted server's notices, loss reasons and result in plain words for the players (hosted design 3.4 `notice`, 7 `LossCode`). The server's own texts name
 * a seat ("Seat 2 is back."); the page knows the names, so it says "Bob is back." and "You ran out of time".
 */
import type { GameOutcome, LossCode, NoticeKind, PublicPlacement, SeatNumber } from '@openmtg/hosted/api';
import { ordinal } from '../../board/table/seats';
import type { HostedNotice } from '../HostedLink';

/** Who is meant: a seat's name from the table ("You" for this seat), or "A player". */
export type SeatNamer = (seat: SeatNumber | undefined) => string;

/** A notice as one line. Kinds the server words in full (server restarts, limits, table closings) keep the server's text. */
export function noticeText(n: Pick<HostedNotice, 'kind' | 'seat' | 'text'>, who: SeatNamer, mySeat: SeatNumber | null): string {
  const you = n.seat !== undefined && n.seat === mySeat;
  const name = who(n.seat);
  const kind: NoticeKind = n.kind;
  switch (kind) {
    case 'playerDropped':
      return `${name} lost the connection. The game waits for them only when they must decide, and their away time is running.`;
    case 'playerBack':
      return `${name} ${you ? 'are' : 'is'} back.`;
    case 'playerLeft':
      return `${name} left the game and ${you ? 'concede' : 'concedes'}.`;
    case 'timeout':
      return `${name} ran out of time and ${you ? 'concede' : 'concedes'}.`;
    case 'forfeit':
      return `${name} ${you ? 'were' : 'was'} away too long and ${you ? 'concede' : 'concedes'}.`;
    case 'abandoning':
      return 'Nobody in the game is connected. The game ends without a result unless someone comes back.';
    default:
      return n.text;
  }
}

/** How a player lost, in a few words (hosted design 7, `LossCode`; CR 104.3, 704.5, 704.6). */
export function lossText(loss: LossCode | null): string {
  switch (loss) {
    case null:
      return '';
    case 'life':
      return 'life total reached 0';
    case 'emptyLibrary':
      return 'drew from an empty library';
    case 'poison':
      return 'ten poison counters';
    case 'commanderDamage':
      return '21 damage from one commander';
    case 'effect':
      return 'lost to a card';
    case 'opponentWon':
      return 'another player won';
    case 'concession':
      return 'conceded';
    case 'left':
      return 'left the game';
    case 'timeout':
      return 'ran out of time';
    case 'disconnect':
      return 'was away too long';
    case 'draw':
      return 'the game was drawn';
  }
}

/** The headline of a finished game for the standings: who won, or why there is no winner. */
export function outcomeHeadline(outcome: GameOutcome, placements: readonly PublicPlacement[], mySeat: SeatNumber | null): string {
  if (outcome === 'void') return 'The game ended without a result';
  if (outcome === 'draw') return 'The game is a draw';
  const winner = placements.find((p) => p.place === 1);
  if (!winner) return 'The game is over';
  return winner.seat === mySeat ? 'You win' : `${winner.name} wins`;
}

/** "1st: Alice", "2nd: Bob (ran out of time, turn 7)", "2nd: Alice (you, conceded, turn 1)". */
export function placementLine(p: PublicPlacement, mySeat: SeatNumber | null): string {
  const parts = [p.seat === mySeat ? 'you' : '', lossText(p.loss), p.outTurn !== null ? `turn ${p.outTurn}` : ''].filter(Boolean);
  return `${ordinal(p.place)}: ${p.name}${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`;
}
