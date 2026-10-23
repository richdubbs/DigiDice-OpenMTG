/**
 * Email for recovery and security notices only (design 3.4, 11.3; M14-1). Built by M14-8 in src/email/* (the factories in src/email/index.ts).
 */
import type { AccountId } from '../api';
import type { AccountsLog } from '../service/api';

export type MailKind = 'verify' | 'reset' | 'notice';
/**
 * INTERFACE CHANGE (M14-15, review A6): 'forcedRename', the notice of a moderator's forced rename (9.4) with the account's new name, so an owner who
 * is signed out everywhere learns it (only to a verified address, like every notice).
 */
export type NoticeKind =
  | 'passwordChanged' | 'recoveryUsed' | 'recoveryCodesRenewed' | 'emailChanged' | 'emailRemoved' | 'providerLinked' | 'providerUnlinked'
  | 'deletionRequested' | 'emailResetUsed' | 'inactive' | 'forcedRename';
export interface Mailer {
  readonly kind: string;                    // 'none', 'file', later the owner's provider
  /** account and expiresAt let FileMailer file the message by account and delete it on time and at erasure (3.4). */
  send(to: string, message: { subject: string; text: string }, meta: { account: AccountId; kind: MailKind; expiresAt: string | null }): Promise<void>;
  /** Deletes an account's stored messages (FileMailer), at erasure; and expired ones, at tick. */
  forget?(account: AccountId | null, now: Date): Promise<number>;
}
/** In memory and bounded: the service answers first, then the queue sends (3.4). A full queue drops the oldest notices first, never a code. */
export interface MailQueue { enqueue(to: string, message: { subject: string; text: string }, meta: Parameters<Mailer['send']>[2]): void }

// ---- Where they come from (src/email/index.ts, M14-8) ---------------------------------------------------------------------------------------
/** MAILER=none, the default: the email field is hidden; `createNoMailer` of src/email/index.ts. */
export type CreateNoMailer = () => Mailer;
/**
 * MAILER=file (development): each message a text file under `dir` (ACCOUNTS_DATA_DIR/mail) in `<account>/`, mode 0600, deleted when its code expires
 * and a notice after `noticeFileMs` (ACCOUNT_TIMING.noticeFileMs); `createFileMailer` of src/email/index.ts.
 */
export type CreateFileMailer = (opts: { dir: string; noticeFileMs: number }) => Mailer;
/** The bounded in-memory queue in front of a mailer: `createMailQueue` of src/email/index.ts, made by the service core for PartDeps.mail. */
export type CreateMailQueue = (opts: { mailer: Mailer; log: AccountsLog }) => MailQueue;
