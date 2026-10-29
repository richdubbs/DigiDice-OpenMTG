/**
 * How a change of a screen's view travels to a screen in another thread or process (review 2026-10-26 F1, Godot plan phase 1): the whole view, or the
 * patch that turns the last view sent into it (`diffViews`, engine core/view-patch.ts), so the receiver keeps the parts that did not change as the same
 * objects and a normal change is small. Used by the client's game worker (connection/gameHost.ts) and the local server's table channel
 * (packages/server/src/table). Only ever a view (`viewFor`, CR 400.2), never a state.
 */
import { diffViews, type GameView, type PatchOp } from '@openmtg/engine';

/** A view patch of more operations than this is sent as the whole view (a new turn's big changes; cheaper to send whole than to patch). */
export const MAX_PATCH_OPS = 400;

export type ViewDelta =
  /** The view did not change (the same object as the last one sent). */
  | { readonly kind: 'same' }
  | { readonly kind: 'whole'; readonly view: GameView }
  | { readonly kind: 'patch'; readonly ops: PatchOp[] };

/**
 * The change from `prev` (the last view sent; null: none yet) to `next`. Whole when `whole` is set (a new receiver, a resync), when there is no
 * previous view, when the viewer changed (a patch never turns one player's view into another's: the receiver's `nextView` would refuse it), or when the
 * patch is longer than `maxOps`.
 */
export function viewDelta(prev: GameView | null, next: GameView, opts: { whole?: boolean; maxOps?: number } = {}): ViewDelta {
  if (!opts.whole && prev === next) return { kind: 'same' };
  if (opts.whole || prev === null || prev.viewer !== next.viewer) return { kind: 'whole', view: next };
  const ops = diffViews(prev, next);
  return ops.length <= (opts.maxOps ?? MAX_PATCH_OPS) ? { kind: 'patch', ops } : { kind: 'whole', view: next };
}
