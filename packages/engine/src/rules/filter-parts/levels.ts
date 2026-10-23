/**
 * M6-6's filter part (m6 design 2.6): the status fields whose `filter:` / `sfilter:` capability is advertised because a mechanism of M6-6 sets them: `solved`
 * (CR 719.3b: effects/handlers/levels.ts, the "To solve" trigger of statics/levels.ts) and `prototyped` (CR 718.3b: actions/cast-opt/prototype.ts,
 * core/move-parts/prototype.ts) and `prepared` (CR 722.3a: core/prepare.ts).
 */
import type { FilterStatusField } from '../registries';

export const LEVELS_FILTER_PARTS: readonly FilterStatusField[] = ['solved', 'prepared', 'prototyped'];
