/**
 * A copy of a permanent spell becomes a token as it resolves (CR 707.10f, 608.3f; m6 design 3.3). Owner: M6-2.
 *
 * The copy resolves like any permanent spell (core/resolve.ts#resolvePermanentSpell: it enters the battlefield under its controller's control through the
 * proposal pipeline, with the face it had on the stack, CR 707.10g); the spell copy object that arrives on the battlefield is made a token by the copy move part
 * (core/move-parts/copy.ts), before anything can see it. Its characteristics are the copiable values of the spell it copied (CR 707.10, 707.2): the original's
 * definition and face. Nothing here takes the resolution over, so this table stays empty.
 */
import type { ResolvePermanentPart } from '../registries';

export const COPY_TOKEN_RESOLVE_PARTS: readonly ResolvePermanentPart[] = [];
