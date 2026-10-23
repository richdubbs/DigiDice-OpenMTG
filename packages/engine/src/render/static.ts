/** Renders a static effect (continuous, cost modification, restriction, replacement, permission, rule modification) from its JSON. Owner: WP2. */
import type { StaticEffect } from '../types/ability';
import type { RenderContext } from './api';
import './boot';
import { staticEffect } from './stat';
import { stateFor } from './state';
import { shown } from './text';

export function renderStaticEffect(effect: StaticEffect, ctx: RenderContext): string {
  return shown(staticEffect(effect, stateFor(ctx)), ctx);
}
