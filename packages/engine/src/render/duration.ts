/** Renders a duration ("until end of turn", "for as long as ~ remains tapped") from its JSON; an empty string for a duration with no words. Owner: WP2. */
import type { Duration } from '../types/ability';
import type { RenderContext } from './api';
import './boot';
import { dur } from './dur';
import { stateFor } from './state';
import { shown } from './text';

export function renderDuration(duration: Duration, ctx: RenderContext): string {
  return shown(dur(duration, stateFor(ctx)), ctx);
}
