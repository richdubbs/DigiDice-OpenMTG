/** Renders a quantity ("X", "the number of creatures you control", "twice its power") from its JSON. Owner: WP2. */
import type { Quantity } from '../types/ability';
import type { RenderContext } from './api';
import './boot';
import { qty } from './qty';
import { stateFor } from './state';
import { shown } from './text';

export function renderQuantity(quantity: Quantity, ctx: RenderContext): string {
  return shown(qty(quantity, stateFor(ctx)), ctx);
}
