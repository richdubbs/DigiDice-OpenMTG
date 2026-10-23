/**
 * M14-8: the mail queue in front of the mailer (design 3.4, 11.3 MailQueue). Server only. The service never waits on mail: `enqueue` only queues,
 * and the queue sends on a later turn of the event loop, after the answer has gone (so an answer's timing shows nothing of what was mailed).
 *
 * - **Bounded**, in memory: at most MAIL_QUEUE_MAX messages waiting. A full queue drops its oldest notice to take a new message (of any kind); a
 *   waiting code (verify, reset) never gives way, so when every waiting message is a code the new message is dropped instead. A dropped code costs
 *   its owner one more request, never an account.
 * - **One message at a time**, in order. A send that fails is logged and not tried again (a code can be asked for again; a notice is best effort).
 * - **Logging** (12.1): only the message's kind and the error's name, never an address, a subject, a body or an error's message (which a mailer
 *   may build from the address).
 */
import type { CreateMailQueue, MailQueue, Mailer } from './api';

/** Messages waiting at most. */
export const MAIL_QUEUE_MAX = 1_000;

/** The queue as the email part and the tests see it: MailQueue, and how to wait until it has sent everything. */
export interface BuiltMailQueue extends MailQueue {
  /** Messages waiting or being sent. */
  readonly size: number;
  /** Resolves once nothing is waiting or being sent. */
  idle(): Promise<void>;
}

export interface MailQueueInternals {
  max?: number;
  /** Runs the sending later (setImmediate by default). */
  schedule?: (f: () => void) => void;
}

type Entry = Parameters<MailQueue['enqueue']>;

export function buildMailQueue(opts: Parameters<CreateMailQueue>[0], internals: MailQueueInternals = {}): BuiltMailQueue {
  const mailer: Mailer = opts.mailer;
  const { log } = opts;
  const max = internals.max ?? MAIL_QUEUE_MAX;
  const schedule = internals.schedule ?? ((f: () => void) => void setImmediate(f));
  const queue: Entry[] = [];
  let sending = 0;
  let scheduled = false;
  let waiters: (() => void)[] = [];

  function settle(): void {
    if (queue.length > 0 || sending > 0 || scheduled) return;
    const w = waiters;
    waiters = [];
    for (const f of w) f();
  }

  async function pump(): Promise<void> {
    scheduled = false;
    while (queue.length > 0) {
      const [to, message, meta] = queue.shift()!;
      sending++;
      try {
        await mailer.send(to, message, meta);
      } catch (e) {
        log.event('accounts.mail.failed', { kind: meta.kind, error: e instanceof Error ? e.name : 'error' });
      } finally {
        sending--;
      }
    }
    settle();
  }

  return {
    enqueue(to, message, meta) {
      if (queue.length >= max) {
        const i = queue.findIndex((m) => m[2].kind === 'notice');
        if (i < 0) {
          // every waiting message is a code: nothing gives way, and the new message is dropped
          log.event('accounts.mail.dropped', { kind: meta.kind });
          return;
        }
        log.event('accounts.mail.dropped', { kind: 'notice' });
        queue.splice(i, 1);
      }
      queue.push([to, { subject: message.subject, text: message.text }, { account: meta.account, kind: meta.kind, expiresAt: meta.expiresAt }]);
      if (sending === 0 && !scheduled) {
        scheduled = true;
        schedule(() => void pump());
      }
    },
    get size() {
      return queue.length + sending;
    },
    idle() {
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
        settle();
      });
    },
  };
}
