/** Renders an object filter as a noun phrase ("creatures you control with flying") from its JSON. Owner: WP2. */
import type { ObjectFilter } from '../types/ability';
import type { RenderContext } from './api';
import './boot';
import { np } from './np';
import { stateFor } from './state';
import { shown } from './text';

export function renderFilter(filter: ObjectFilter, ctx: RenderContext): string {
  return shown(np(filter, stateFor(ctx), { det: 'none', plural: true }), ctx);
}
