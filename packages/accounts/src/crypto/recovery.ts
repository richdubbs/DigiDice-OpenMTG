/**
 * M14-3: recovery-code helpers on top of CredentialTools (design 4.4), for the service (M14-5) to use as it likes. Server only.
 *
 * - `recoveryCodeRows`: the store rows for a new set of codes (one generation, slots 0-9, only the hashes).
 * - `findRecoverySlot`: the unused slot a typed code matches, checked against EVERY unused slot with the injected comparison and without stopping at a
 *   match (4.4), so the time and the calls of `equal` depend on how many slots are unused, never on which one matched.
 */
import type { AccountId } from '../api';
import type { RecoveryCodeRow } from '../store/api';
import type { CredentialTools } from './api';

const HEX64 = /^[0-9a-f]{64}$/u;

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(32);
  if (!HEX64.test(hex)) return out; // a damaged stored hash: compared like any other, matches nothing a SHA-256 gives
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** The rows of a new generation of codes (4.4): slot i holds the hash of codes[i]. */
export function recoveryCodeRows(
  tools: Pick<CredentialTools, 'recoveryCodeHash'>, account: AccountId, codes: readonly string[], generation: number, at: string,
): RecoveryCodeRow[] {
  return codes.map((code, slot) => ({ account, slot, hash: tools.recoveryCodeHash(account, code), generation, createdAt: at, usedAt: null }));
}

/**
 * The unused slot whose hash is the code's, or null. Every unused slot is compared, with `tools.equal`, whatever matched before; the answer carries
 * the slot's hash for the store's compare-and-set (`spendRecoveryCode(account, slot, hash, at)`).
 */
export function findRecoverySlot(
  tools: Pick<CredentialTools, 'recoveryCodeHash' | 'equal'>,
  account: AccountId,
  code: string,
  rows: readonly Pick<RecoveryCodeRow, 'slot' | 'hash' | 'usedAt'>[],
): { slot: number; hash: string } | null {
  const want = hexBytes(tools.recoveryCodeHash(account, code));
  let found: { slot: number; hash: string } | null = null;
  for (const row of rows) {
    if (row.usedAt !== null) continue;
    const match = tools.equal(want, hexBytes(row.hash));
    if (match && found === null) found = { slot: row.slot, hash: row.hash };
  }
  return found;
}
