/**
 * Invite codes of private tables (design 4.3, review 15): one per open seat, 16 characters from net's `generateJoinCode` (80 random bits, weak codes
 * drawn again), shown in groups of four. The server keeps only SHA-256 of the canonical code (`SeatRow.inviteHash`) and spends a code when it is used;
 * it cannot show a code again, so the creator's client keeps its codes for the session and asks for "New codes" (`codes`) after a reload.
 */
import { generateJoinCode, normalizeJoinCode } from '@openmtg/net/server-kit';
import { sha256Hex } from '../gateway/ids';

/** A new code: its formatted text (for the creator, once) and the hash the server keeps. */
export function newInviteCode(): { code: string; hash: string } {
  const code = generateJoinCode();
  return { code, hash: inviteHash(normalizeJoinCode(code)!) };
}

/** The hash of a canonical code. */
export function inviteHash(canonical: string): string {
  return sha256Hex(`invite|${canonical}`);
}

/** The hash of a typed code (case, spaces, dashes and look-alike letters ignored), or null when it is not a well-formed code. */
export function typedInviteHash(typed: string): string | null {
  const c = normalizeJoinCode(typed);
  return c ? inviteHash(c) : null;
}
