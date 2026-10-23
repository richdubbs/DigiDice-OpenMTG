/**
 * Passwords, recovery codes, device proofs and the one secret comparison (design section 4, 11.3; M14-1). Built by M14-3 in src/crypto/* (the
 * factories in src/crypto/index.ts).
 */
import type { AccountId, PasswordProblem } from '../api';

export type HashPriority = 'high' | 'normal' | 'low';
export interface PasswordHasher {
  /** A PHC string for the NFKC form of `password` (4.1). Throws HasherBusyError when the queue has no room for the job's class. */
  hash(password: string, opts: { priority: HashPriority }): Promise<string>;
  verify(phc: string, password: string, opts: { priority: HashPriority }): Promise<{ ok: boolean; needsRehash: boolean }>;
  /** The same work against the dummy hash (unknown names). */
  dummy(password: string, opts: { priority: HashPriority }): Promise<void>;
  /** Served high, then normal, then low; a full queue drops the newest lower-class job first (it answers busy) and refuses a new low one. */
  load(): { running: number; queued: Record<HashPriority, number>; capacity: number };
}
/** The hashing queue has no room for a job of its class (4.1); the service answers `busy` with retryAfterMs. */
export class HasherBusyError extends Error {
  constructor(readonly retryAfterMs: number, message = 'The password hashing queue is full.') {
    super(message);
    this.name = 'HasherBusyError';
  }
}
/** Everything else of section 4 that the service needs; createCredentialTools(deps) in src/crypto/index.ts. */
export interface CredentialTools {
  /**
   * 4.2 with the blocklist (server). `emailLocal` is the account's email local part only where the caller may know the address: registration (the
   * request's own address), changePassword (after the current password), and recovery and the email reset only once their code has matched; null
   * otherwise. Before a credential is checked, `ctx` holds only what the request itself gave (its name and that name's key), so the answer never
   * depends on an account's private data (7.4; AccountService.useRecoveryCode). INTERFACE CHANGE (review of M14-1): this rule on the context.
   */
  passwordProblem(password: string, ctx: { name: string; key: string; emailLocal: string | null }): PasswordProblem | null;
  /** 10 codes of 16 characters (4.4). */
  newRecoveryCodes(): string[];
  /** SHA-256 of "openmtg/recovery/v1\n" + account + "\n" + code. */
  recoveryCodeHash(account: AccountId, code: string): string;
  newDeviceProof(): { proof: string; hash: string };
  /** Constant time on equal lengths; the one comparison every secret check uses (a test counts its calls). */
  equal(a: Uint8Array, b: Uint8Array): boolean;
}
export interface CryptoDeps { random(n: number): Uint8Array; equal(a: Uint8Array, b: Uint8Array): boolean; peppers: Pepper[]; passwordMin: number }
export interface Pepper { id: string; secret: string }
export type CreateCredentialTools = (deps: CryptoDeps) => CredentialTools;

/** What src/compose.ts gives the hasher (AccountsConfig's scrypt, HASH_CONCURRENCY, HASH_QUEUE and PASSWORD_PEPPERS, 4.1, 11.7). */
export interface PasswordHasherOptions {
  /** log2 of N, r and p. */
  scrypt: { ln: number; r: number; p: number };
  /** Hashes in flight at once (HASH_CONCURRENCY, 2). */
  concurrency: number;
  /** Queued jobs at most, over the three classes (HASH_QUEUE, 64). */
  queue: number;
  /** Newest last: new hashes use the last one; an empty list hashes without a pepper. */
  peppers: Pepper[];
  random(n: number): Uint8Array;
  /**
   * The one constant-time comparison (4.1, 12.1; compose passes the same function as CryptoDeps.equal): verify and dummy compare the derived key with
   * it, so a counting fake sees that the dummy path does the same work. INTERFACE CHANGE (review of M14-1): added.
   */
  equal(a: Uint8Array, b: Uint8Array): boolean;
}
/** The scrypt hasher and its priority pool: `createPasswordHasher` of src/crypto/index.ts (M14-3). */
export type CreatePasswordHasher = (opts: PasswordHasherOptions) => PasswordHasher;
