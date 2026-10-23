/**
 * Layouts M6-6 lifts from the layout caps (m6 design 3.7): `case` (CR 719: the "To solve" trigger and the solved designation, statics/levels.ts and
 * effects/handlers/levels.ts), `prototype` (CR 718: actions/cast-opt/prototype.ts, rules/base-parts/prototype.ts) and `prepare` (CR 722: core/prepare.ts).
 */
import type { LayoutSupport } from '../layout-support';

export const LAYOUTS_LAYOUT_SUPPORT: LayoutSupport = { case: true, prototype: true, prepare: true };
