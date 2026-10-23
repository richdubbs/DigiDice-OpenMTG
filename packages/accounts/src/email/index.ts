/**
 * M14-8: the email part's factories (design 3.4), under the names src/compose.ts imports, the service core imports (the queue) and src/index.ts
 * re-exports (`export *`, so only these names leave this file): the email part (./part.ts), NoMailer and FileMailer (./mailers.ts) and the mail
 * queue (./queue.ts).
 */
import type { CreateEmailPart } from '../service/api';
import type { CreateFileMailer, CreateMailQueue, CreateNoMailer } from './api';
import { buildFileMailer, buildNoMailer } from './mailers';
import { buildEmailPart } from './part';
import { buildMailQueue } from './queue';

/** setEmail, verifyEmail, requestEmailReset, useEmailReset, the notices and the mail files' tick, on the core's PartDeps. */
export const createEmailPart: CreateEmailPart = (deps) => buildEmailPart(deps);
/** MAILER=none, the default: sends nothing, keeps nothing; the service then hides email. */
export const createNoMailer: CreateNoMailer = () => buildNoMailer();
/** MAILER=file (development): one text file per message under `dir`/<account>/, mode 0600, deleted on time and at the account's erasure. */
export const createFileMailer: CreateFileMailer = (opts) => buildFileMailer(opts);
/** The bounded in-memory queue in front of the mailer: the service answers first, then the queue sends. */
export const createMailQueue: CreateMailQueue = (opts) => buildMailQueue(opts);
