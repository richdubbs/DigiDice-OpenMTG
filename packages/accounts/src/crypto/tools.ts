/**
 * M14-3: CredentialTools (design 4.2-4.4, 8.3, 11.3): the server's password policy, recovery codes, device proofs and the one injected comparison.
 * Server only.
 *
 * - Recovery codes: 10 distinct codes of 16 Crockford base32 characters, 80 random bits each (10 bytes of CryptoDeps.random), in the canonical form
 *   (formatRecoveryCode groups them for display). Stored per slot as SHA-256 (hex) of "openmtg/recovery/v1\n" + account id + "\n" + code: a fast hash
 *   is enough for 80 random bits, and the account id makes a stored hash useless for any other account. Never peppered (a lost pepper must not lose
 *   the way back in, 4.1), so CryptoDeps.peppers is not used here.
 * - Device proofs: a token like a session's (32 random bytes as 64 lowercase hex digits, ids.ts newToken) and its SHA-256 (tokenHash); only the hash
 *   is stored (8.3).
 * - The password policy (./policy.ts) with CryptoDeps.passwordMin, which must be at least the blocklist's minLength (8, the lowest PASSWORD_MIN
 *   src/config.ts accepts; RangeError otherwise): the blocklist holds no shorter entries (4.3).
 * - `equal` is CryptoDeps.equal itself, the one comparison every secret check uses (compose passes node:crypto's timingSafeEqual), so a test can
 *   count its calls.
 */
import { createHash } from 'node:crypto';
import type { AccountId } from '../api';
import { ACCOUNT_LIMITS } from '../api/limits';
import { normalizeRecoveryCode, recoveryCodeFromBytes } from '../api/passwords';
import { newToken, tokenHash } from '../ids';
import type { CredentialTools, CryptoDeps } from './api';
import { BLOCKLIST, BLOCKLIST_SOURCE } from './blocklist';
import { serverPasswordProblem } from './policy';

/** The prefix of the recovery-code hash's input (4.4). */
export const RECOVERY_HASH_PREFIX = 'openmtg/recovery/v1\n';
/** Draws before newRecoveryCodes gives up on a random source that keeps repeating itself (a real one repeats with chance 2^-80). */
const RECOVERY_DRAWS_MAX = 100;

/** What tests may replace; createCredentialTools uses the defaults. */
export interface ToolsInternals { blocklist?: ReadonlySet<string> }

export function buildCredentialTools(deps: CryptoDeps, internals: ToolsInternals = {}): CredentialTools {
  if (typeof deps.random !== 'function' || typeof deps.equal !== 'function') throw new TypeError('the credential tools need random and equal');
  const min = deps.passwordMin;
  // the blocklist holds no entry shorter than its minLength (8, the lowest PASSWORD_MIN src/config.ts accepts): a lower minimum would let the most
  // common short passwords through without a word, so it is refused here and compose fails at start
  const floor = BLOCKLIST_SOURCE.minLength;
  if (!Number.isInteger(min) || min < floor || min > ACCOUNT_LIMITS.passwordMax) {
    throw new RangeError(`passwordMin must be a whole number of ${floor}-${ACCOUNT_LIMITS.passwordMax}: the blocklist holds no shorter entries`);
  }
  const blocklist = internals.blocklist ?? BLOCKLIST;
  const random = deps.random;

  const draw = (n: number): Uint8Array => {
    const b = random(n);
    if (!(b instanceof Uint8Array) || b.length < n) throw new RangeError(`the random source gave ${b?.length ?? 0} bytes, not ${n}`);
    return b.slice(0, n);
  };

  return {
    passwordProblem: (password, ctx) => serverPasswordProblem(password, ctx, min, blocklist),
    newRecoveryCodes() {
      const codes = new Set<string>();
      for (let draws = 0; codes.size < ACCOUNT_LIMITS.recoveryCodes; draws++) {
        if (draws >= RECOVERY_DRAWS_MAX) throw new Error('the random source keeps repeating itself: no recovery codes made');
        codes.add(recoveryCodeFromBytes(draw(10)));
      }
      return [...codes];
    },
    recoveryCodeHash(account: AccountId, code: string): string {
      const c = normalizeRecoveryCode(code) ?? String(code);
      return createHash('sha256').update(`${RECOVERY_HASH_PREFIX}${account}\n${c}`, 'utf8').digest('hex');
    },
    newDeviceProof() {
      const proof = newToken(random);
      return { proof, hash: tokenHash(proof) };
    },
    equal: deps.equal,
  };
}
