/**
 * Seams of the tables layer for the packages that build on it (design 13.1). Each is optional: without it the feature is refused with `notYet`.
 *
 * - `PasswordHook` (M13-8, design 4.3): password-protected listed tables. The tables layer never stores, logs or sends a password; it keeps the hook's
 *   hash and salt in the `games` row (`NewGameRow.passwordHash`, `passwordSalt`) and asks the hook to verify an attempt. Join attempts are limited by
 *   the gateway (per session and address key, with strikes: design 3.6) before the hook is asked.
 * - `ModerationHook` (M13-8, design 4.2): the word filter on display names and table titles (after the hosted text rules of api.ts).
 * - `ListingSink` (M13-8, design 4.2): the listed unstarted tables as they change (the lobby browser's index and live updates).
 */
import type { LobbyListing } from '../api';

export interface PasswordHook {
  /** A new table's password (it passed `checkPassword`): its hash and per-table random salt, hex. */
  hash(password: string): Promise<{ hash: string; salt: string }>;
  /** Whether `password` matches. Must take the same time whatever matches (scrypt does). */
  verify(password: string, hash: string, salt: string): Promise<boolean>;
}

export interface ModerationHook {
  /** Why a display name is refused (a message for the player), or null. */
  nameProblem(name: string): string | null;
  /** Why a table title is refused, or null. */
  titleProblem(title: string): string | null;
}

export interface ListingSink {
  /** A listed unstarted table was added or changed (`listing`), or left the listing (null: started, closed, expired). */
  changed(table: string, listing: LobbyListing | null): void;
}
