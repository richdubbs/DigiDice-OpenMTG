/**
 * M14-6: the moderation part (design section 9, 11.3 ModerationPart), under the name src/compose.ts passes to createAccountService and src/index.ts
 * re-exports (`export *`, so only these names leave this file): blocks and mutes (./relations.ts), the report queue (./reports.ts), appeals
 * (./appeals.ts), the expiry of sanctions at tick (./expiry.ts), and the operator's moderation commands (src/admin/moderation.ts: sanctions and
 * their ends, forced renames, reserved names, revocations, the reads). The service wraps every client method (answers, never throws) and runs the
 * session check of RESTRICTED_CALLS through the core's ServiceGuard; the operator's commands throw AccountsAdminError.
 *
 * The factory takes PartDeps, and optionally the service's name rules and a clock (ModerationDeps, ./context.ts); src/compose.ts passes PartDeps
 * alone, and the part then builds its rules as the composition does and reads the system clock.
 */
import type { CreateModerationPart, ModerationPart } from '../service/api';
import { createModerationAdmin } from '../admin/moderation';
import { appeal } from './appeals';
import { modOf, type ModerationDeps } from './context';
import { expireSanctions, newExpiryState } from './expiry';
import { relations, setRelation } from './relations';
import { report } from './reports';

export type { ModerationDeps } from './context';

/** The moderation part: `createModerationPart(deps)`, with ModerationDeps' optional additions. */
export const createModerationPart: CreateModerationPart & ((deps: ModerationDeps) => ModerationPart) = (deps: ModerationDeps): ModerationPart => {
  const m = modOf(deps);
  const expiry = newExpiryState();
  return {
    block: (ctx, auth, other, on) => setRelation(m, ctx, auth, other, on, 'block'),
    mute: (ctx, auth, other, on) => setRelation(m, ctx, auth, other, on, 'mute'),
    relations: (ctx, auth) => relations(m, ctx, auth),
    report: (ctx, reporter, r) => report(m, ctx, reporter, r),
    appeal: (ctx, auth, sanction, text, proof) => appeal(m, ctx, auth, sanction, text, proof),
    admin: createModerationAdmin(m),
    tick: (now) => expireSanctions(m, now, expiry),
  };
};
