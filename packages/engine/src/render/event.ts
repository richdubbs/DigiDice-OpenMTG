/** Renders an event pattern ("a creature you control dies", "the beginning of your upkeep") from its JSON, without a leading "when". Owner: WP2. */
import type { EventPattern } from '../types/ability';
import type { RenderContext } from './api';
import './boot';
import { event } from './evt';
import { stateFor } from './state';
import { shown } from './text';

export function renderEvent(ev: EventPattern, ctx: RenderContext): string {
  return shown(event(ev, stateFor(ctx), 'present'), ctx);
}
