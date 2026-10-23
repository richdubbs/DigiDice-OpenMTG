/**
 * Deck sleeves on the board: each player's hidden cards (hand, library, face-down cards) are drawn in the sleeve of the deck they play (branding/sleeves.ts).
 * GameBoard provides the players' sleeves (GameBoardProps.sleeves); a player without one gets the classic DigiDice back.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { PlayerId } from '@openmtg/engine';
import { SleeveContext } from '../cards/CardBack';

/** Sleeve ids by player. */
export type PlayerSleeves = Readonly<Partial<Record<PlayerId, string>>>;

export const PlayerSleevesContext = createContext<PlayerSleeves>({});

/** Card backs drawn inside are in `owner`'s sleeve (a card is sleeved by its owner, whoever controls it). */
export function OwnerSleeve({ owner, children }: { owner: PlayerId | undefined; children: ReactNode }) {
  const sleeves = useContext(PlayerSleevesContext);
  return <SleeveContext.Provider value={(owner !== undefined ? sleeves[owner] : undefined) ?? null}>{children}</SleeveContext.Provider>;
}
