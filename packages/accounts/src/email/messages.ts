/**
 * M14-8: the text of every mail (design 3.4): verification codes, reset codes and the security notices. Plain text in plain words, never marketing.
 * A verification mail goes to an address nobody has proved yet, so it names no account and carries nothing anyone typed but the code itself; the
 * reset mails and the notices go only to a verified address and name the account. No mail holds a password, a token, an address tag or a link.
 */
import type { AccountTiming } from '../api';
import type { NoticeKind } from './api';
import { formatEmailCode } from './codes';

export interface MailMessage { subject: string; text: string }

const MINUTE = 60_000, DAY = 86_400_000;

function minutes(ms: number): string {
  const n = Math.max(1, Math.round(ms / MINUTE));
  return n === 1 ? '1 minute' : `${n} minutes`;
}

function days(ms: number): string {
  const n = Math.max(1, Math.round(ms / DAY));
  return n === 1 ? '1 day' : `${n} days`;
}

const SIGN_OFF = 'OpenMTG (an unofficial, free fan project). We only send mail about your account\'s security.';
const NOT_YOU =
  'If this was not you, sign in with your password, or with a recovery code if you no longer know it, and change your password; then sign out ' +
  'everywhere from the account page.';

function lines(...parts: string[]): string {
  return `${parts.join('\n\n')}\n`;
}

/** The code that verifies this address (3.4). */
export function verifyMail(code: string, timing: Pick<AccountTiming, 'emailCodeMs'>): MailMessage {
  return {
    subject: 'Your OpenMTG verification code',
    text: lines(
      'Someone entered this email address for an OpenMTG account. To confirm that it is yours, enter this code:',
      formatEmailCode(code),
      `The code works once, for ${minutes(timing.emailCodeMs)}.`,
      'If you did not ask for this, you can ignore this message: the address stays unconfirmed and gets no more mail from this request.',
      SIGN_OFF,
    ),
  };
}

/** A password reset code for the account `name` (3.4). */
export function resetMail(name: string, code: string, timing: Pick<AccountTiming, 'emailCodeMs'>): MailMessage {
  return {
    subject: 'Your OpenMTG password reset code',
    text: lines(
      `A new password was asked for the OpenMTG account "${name}". To set one, enter this code with the new password:`,
      formatEmailCode(code),
      `The code works once, for ${minutes(timing.emailCodeMs)}. Using it signs out every other session of the account.`,
      'If you did not ask for this, ignore this message: nothing changes without the code, and your password stays as it is.',
      SIGN_OFF,
    ),
  };
}

const NOTICE_SUBJECTS: Readonly<Record<NoticeKind, string>> = {
  passwordChanged: 'Your OpenMTG password was changed',
  recoveryUsed: 'A recovery code was used on your OpenMTG account',
  recoveryCodesRenewed: 'New recovery codes for your OpenMTG account',
  emailChanged: 'The email address of your OpenMTG account was changed',
  emailRemoved: 'The email address of your OpenMTG account was removed',
  providerLinked: 'A sign-in method was linked to your OpenMTG account',
  providerUnlinked: 'A sign-in method was removed from your OpenMTG account',
  deletionRequested: 'Your OpenMTG account is going to be deleted',
  emailResetUsed: 'Your OpenMTG password was reset by email',
  inactive: 'Your OpenMTG account is going to be deleted for inactivity',
  forcedRename: 'A moderator changed the name of your OpenMTG account',
};

function noticeBody(kind: NoticeKind, name: string, timing: Pick<AccountTiming, 'deleteGraceMs'>): string[] {
  const account = `the OpenMTG account "${name}"`;
  switch (kind) {
    case 'passwordChanged':
      return [`The password of ${account} was changed. Every other session was signed out.`, NOT_YOU];
    case 'recoveryUsed':
      return [`A recovery code was used to sign in to ${account} and set a new password. Every other session was signed out.`, NOT_YOU];
    case 'recoveryCodesRenewed':
      return [`New recovery codes were made for ${account}. The old codes no longer work.`, NOT_YOU];
    case 'emailChanged':
      return [
        `The email address of ${account} was changed. This address will no longer get its codes or notices.`,
        NOT_YOU,
      ];
    case 'emailRemoved':
      return [`The email address of ${account} was removed. This address will no longer get its codes or notices.`, NOT_YOU];
    case 'providerLinked':
      return [`Another way to sign in was linked to ${account}.`, NOT_YOU];
    case 'providerUnlinked':
      return [`A way to sign in was removed from ${account}.`, NOT_YOU];
    case 'deletionRequested':
      return [
        `Deleting ${account} was asked for. It is deleted for good after ${days(timing.deleteGraceMs)}; until then, signing in and cancelling the ` +
          'deletion on the account page keeps it.',
        'If this was not you, sign in, cancel the deletion and change your password.',
      ];
    case 'emailResetUsed':
      return [
        `A reset code sent to this address was used to set a new password for ${account}. Every other session was signed out, and new ` +
          'recovery codes were made: the old ones no longer work.',
        NOT_YOU,
      ];
    case 'inactive':
      return [
        `Nobody has signed in to ${account} for a long time, so it is going to be deleted soon. Signing in once keeps it.`,
        'If you no longer want it, you need not do anything.',
      ];
    case 'forcedRename':
      // the new name only: the old one was taken away for a reason, and stays out of the mail
      return [
        `A moderator changed the name of your OpenMTG account. Its name is now "${name}": sign in with it. The old name still signs you in, ` +
          'and still works for a recovery code or a password reset, while it stays blocked.',
        'You can choose a new name once, without waiting for the rename cooldown, and you can appeal the change on the account page.',
      ];
  }
}

/** A security notice to the account's verified address, or to its old one for an email change or removal (3.4). */
export function noticeMail(kind: NoticeKind, name: string, timing: Pick<AccountTiming, 'deleteGraceMs'>): MailMessage {
  return { subject: NOTICE_SUBJECTS[kind], text: lines(...noticeBody(kind, name, timing), SIGN_OFF) };
}
