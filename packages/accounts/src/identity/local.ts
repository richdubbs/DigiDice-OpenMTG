/**
 * M14-5: the local provider, name and password (design 3.2, 4.1). It only answers "this password belongs to this credential": the account service
 * owns the policy check (it runs before `enroll`, since only the service knows the name, its key and the email), the limits and back-off, sessions,
 * the audit log and standing.
 *
 * - `enroll` hashes the password (the hasher's PHC string, 4.1) into a new `local` credential whose subject is the account id.
 * - `verify` checks against the credential's PHC string, or does the same work against the dummy when there is no local credential (an unknown name,
 *   a held or banned key, an account without a password), so every failure costs the same (4.1). After a right password whose string has older
 *   parameters or another pepper, `rehash` is the replacement credential; the service writes it by compare-and-set on the string it verified
 *   (putCredential with expectSecret, 11.2), so a rehash racing a password change can never write the old password back. A rehash that cannot be
 *   made now (a full hashing queue) is skipped: the next sign-in tries again.
 */
import type { CreateLocalProvider, PasswordProvider } from './api';
import type { CredentialRow } from '../store/api';

export const buildLocalProvider: CreateLocalProvider = (deps): PasswordProvider => {
  const { hasher } = deps;
  return {
    id: 'local',
    kind: 'password',
    async enroll(account, password, at, opts) {
      const secret = await hasher.hash(password, opts);
      return { account, provider: 'local', subject: account, secret, meta: {}, createdAt: at, lastUsedAt: null };
    },
    async verify(credential, password, opts) {
      if (credential === null || credential.provider !== 'local' || credential.secret === null) {
        await hasher.dummy(password, opts);
        return { ok: false, rehash: null };
      }
      const r = await hasher.verify(credential.secret, password, opts);
      if (!r.ok) return { ok: false, rehash: null };
      if (!r.needsRehash) return { ok: true, rehash: null };
      let secret: string;
      try {
        secret = await hasher.hash(password, opts);
      } catch {
        return { ok: true, rehash: null };
      }
      const rehash: CredentialRow = {
        account: credential.account, provider: 'local', subject: credential.subject, secret, meta: { ...credential.meta },
        createdAt: credential.createdAt, lastUsedAt: credential.lastUsedAt,
      };
      return { ok: true, rehash };
    },
  };
};
