/**
 * pc-counters-1 (CR 614.12, 616.1): objects put onto the battlefield together by one instruction (handlers/zones-move.ts, perform-events.ts#performCreateToken). A replacement effect of an entering
 * object's "other creatures enter with ..." applies only to objects entering after it, not to those entering at the same time, so a member of the group never
 * counts as the source of a foreign "enters" replacement for the others, whatever order they are moved in. Set only while the group is being moved.
 */
export const ENTERING_TOGETHER = new WeakMap<object, Set<string>>();
