/**
 * The interpreter context a replacement effect is read in (moved unchanged out of effects/replacements.ts by M6-0, m6 design 2.6, so the body kinds of
 * effects/bodies/ can use it without an import cycle through effects/registries.ts; replacements.ts re-exports it).
 */
import type { Game } from '../core/game';
import type { PlayerId } from '../types/ids';
import type { GameObject } from '../types/state';
import type { ExecCtx } from './api';
import { makeCtx } from './ctx';

/** An interpreter context for the object whose ability is consulted, with "you" = `controller` (the player it would enter under, CR 614.12). */
export function contextFor(g: Game, o: GameObject, controller: PlayerId): ExecCtx {
  const cx = makeCtx(g, o, { targets: [], steps: [] });
  cx.controller = controller;
  return cx;
}
