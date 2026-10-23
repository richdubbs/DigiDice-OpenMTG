/**
 * M14-3: the server's password policy (design 4.2, 4.3): the browser's rules (../api/passwords.ts, passwordRuleProblem) with the name's canonical key
 * added to rule 6, then the blocklist (`common`). The minimum is the server's PASSWORD_MIN (CryptoDeps.passwordMin). Server only: the blocklist is
 * not sent to browsers.
 */
import type { PasswordProblem } from '../api';
import { passwordForm, passwordRuleProblem } from '../api/passwords';
import { BLOCKLIST } from './blocklist';

/**
 * 4.2 with the blocklist. `ctx.emailLocal` follows CredentialTools.passwordProblem's rule (only where the caller may know the address; null
 * otherwise), so before a credential is checked the answer depends only on what the request itself gave.
 */
export function serverPasswordProblem(
  password: unknown,
  ctx: { name: string; key: string; emailLocal: string | null },
  min: number,
  blocklist: ReadonlySet<string> = BLOCKLIST,
): PasswordProblem | null {
  const c = typeof ctx === 'object' && ctx !== null ? ctx : { name: '', key: '', emailLocal: null };
  const problem = passwordRuleProblem(password, { name: c.name, key: c.key, emailLocal: c.emailLocal }, min);
  if (problem !== null) return problem;
  if (blocklist.has(passwordForm(password as string))) return 'common';
  return null;
}
