/** Renders a cost (`{2}{R}, {T}, Sacrifice a creature`) from its JSON. Owner: WP2. */
import type { CostDef } from '../types/ability';
import type { RenderContext } from './api';
import './boot';
import { cost } from './costs';
import { stateFor } from './state';
import { shown } from './text';

export function renderCost(c: CostDef, ctx: RenderContext): string {
  return shown(cost(c, stateFor(ctx)), ctx);
}
