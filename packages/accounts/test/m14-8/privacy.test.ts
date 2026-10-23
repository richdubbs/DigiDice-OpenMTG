/**
 * M14-8: no address in any log line or audit detail (design 3.4, 8.5, 12.1). Every email flow runs with distinctive addresses: a registration's
 * address, wrong ones, codes right and wrong, resends up to the limit, a change, a removal, reset requests for every kind of name, reset codes right
 * and wrong, the notices, and a mailer whose failures name the address in their messages. Then every log line, every audit event and every refusal
 * is searched for the addresses, their local parts and domains, the codes and the passwords: none appears, and every audit event has its kind's shape.
 */
import { describe, expect, it } from 'vitest';
import { auditDetailsProblem } from '../../src/audit/details';
import type { AccountResult } from '@openmtg/accounts';
import {
  auditOf, codeOf, ctxFor, inRow, MIN, PW, PW2, RecordingMailer, recordingSetup, registerWith, value, mailSetup, type SentMail,
} from './support';

const ZED = 'zed.secret+tag@private-example.org';
const OTHER = 'other.secret@hidden-example.net';
const FAILS = 'zed.fails@broken-example.org';
const NEW_PW = 'a brand new passphrase';

/** Records every message, and fails (naming the address in the error's message) for addresses at broken-example.org. */
class FailingMailer extends RecordingMailer {
  override async send(to: string, message: { subject: string; text: string }, meta: SentMail['meta']): Promise<void> {
    await super.send(to, message, meta);
    if (to.endsWith('@broken-example.org')) throw Object.assign(new Error(`550 no such mailbox: ${to}`), { name: 'MailError' });
  }
}

describe('M14-8: no address in any log line or audit detail (8.5, 12.1)', () => {
  it('every email flow, searched', async () => {
    const mailer = new FailingMailer();
    const s = mailSetup({ mailer }) as ReturnType<typeof recordingSetup>;
    const refusals: AccountResult<unknown>[] = [];
    const keep = <T>(r: AccountResult<T>): AccountResult<T> => {
      if (!r.ok) refusals.push(r);
      return r;
    };
    const zed = await registerWith(s, 'Zed', ZED);
    const ctx = ctxFor(s, 'zed');
    // wrong addresses, a wrong proof, a wrong code, the right one
    for (const bad of ['zed.secret@private-example', 'Zed <zed.secret@private-example.org>', 'zed.secret@@private-example.org']) {
      keep(inRow('setEmail', await s.service.setEmail(ctx, zed.auth, bad, { password: PW })));
    }
    keep(inRow('setEmail', await s.service.setEmail(ctx, zed.auth, OTHER, { password: PW2 })));
    keep(inRow('verifyEmail', await s.service.verifyEmail(ctx, zed.auth, 'ZZZZZ-ZZZZZ')));
    value(keep(inRow('verifyEmail', await s.service.verifyEmail(ctx, zed.auth, codeOf(mailer.to(ZED)[0])))));
    // a change (the old address gets its notice), a mail that fails, and the limit
    value(keep(inRow('setEmail', await s.service.setEmail(ctx, zed.auth, OTHER, { password: PW }))));
    value(keep(inRow('setEmail', await s.service.setEmail(ctx, zed.auth, FAILS, { password: PW }))));
    keep(inRow('setEmail', await s.service.setEmail(ctx, zed.auth, ZED, { password: PW })));
    await s.idle();
    // removal
    value(keep(inRow('setEmail', await s.service.setEmail(ctx, zed.auth, null, { password: PW }))));
    // resets: an account with a verified address, one without, a name nobody holds; wrong codes, a weak password, the right code
    const ann = await registerWith(s, 'Ann', ZED);
    value(keep(inRow('verifyEmail', await s.service.verifyEmail(ctxFor(s, 'ann'), ann.auth, codeOf(mailer.to(ZED).at(-1))))));
    for (const name of ['Ann', 'Zed', 'zed.secret', ZED]) keep(inRow('requestEmailReset', await s.service.requestEmailReset(ctxFor(s, `asker ${name}`), name)));
    await s.idle();
    const reset = codeOf(mailer.sent.filter((m) => m.meta.kind === 'reset').at(-1));
    keep(inRow('useEmailReset', await s.service.useEmailReset(ctxFor(s, 'guesser'), { name: 'Ann', code: 'ZZZZZ-ZZZZZ', newPassword: NEW_PW })));
    keep(inRow('useEmailReset', await s.service.useEmailReset(ctxFor(s, 'guesser'), { name: ZED, code: reset, newPassword: NEW_PW })));
    keep(inRow('useEmailReset', await s.service.useEmailReset(ctxFor(s, 'ann'), { name: 'Ann', code: reset, newPassword: 'zed.secret is my password' })));
    const signed = value(keep(inRow('useEmailReset', await s.service.useEmailReset(ctxFor(s, 'ann'), { name: 'Ann', code: reset, newPassword: NEW_PW }))));
    // the core's notices through this part
    value(inRow('changePassword', await s.service.changePassword(ctxFor(s, 'ann'), signed.auth, NEW_PW, PW)));
    value(inRow('newRecoveryCodes', await s.service.newRecoveryCodes(ctxFor(s, 'ann'), signed.auth, { password: PW })));
    await s.idle();
    s.clock.advance(20 * MIN);
    const events = await auditOf(s);

    // the flows ran: their events are there, each of its kind's shape
    const kinds = new Set(events.map((e) => e.kind));
    for (const k of ['emailSet', 'emailVerified', 'emailRemoved', 'emailResetRequested', 'emailResetUsed', 'passwordChanged', 'reauthFailed'] as const) {
      expect(kinds.has(k), k).toBe(true);
    }
    for (const e of events) expect(auditDetailsProblem(e.kind, e.details, e.account), e.kind).toBeNull();
    expect(s.log.some((l) => l.name === 'accounts.mail.failed')).toBe(true);
    expect(refusals.map((r) => (r.ok ? 'ok' : r.error.code))).toEqual(
      expect.arrayContaining(['emailInvalid', 'badCredentials', 'emailCodeInvalid', 'limitReached', 'passwordWeak']),
    );

    // and nothing of an address, a code or a password in any of them
    const codes = mailer.sent.flatMap((m) => {
      try {
        return [codeOf(m)];
      } catch {
        return [];
      }
    });
    // four verification codes (the failed mail's included) and a reset code
    expect(codes).toHaveLength(5);
    const secrets = [
      ZED, OTHER, FAILS, 'zed.secret', 'other.secret', 'zed.fails', 'private-example', 'hidden-example', 'broken-example', NEW_PW, PW, PW2,
      'zed.secret is my password', ...codes, ...codes.map((c) => `${c.slice(0, 5)}-${c.slice(5)}`),
    ];
    const texts = [
      ['log', JSON.stringify(s.log)], ['audit', JSON.stringify(events)], ['refusals', JSON.stringify(refusals)],
    ] as const;
    for (const [what, text] of texts) {
      for (const secret of secrets) expect(text.toLowerCase().includes(secret.toLowerCase()), `${what} holds "${secret}"`).toBe(false);
    }
  });
});
