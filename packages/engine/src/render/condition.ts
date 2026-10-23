/** Renders a condition ("you control a creature", "it's your turn") from its JSON, without a leading "if". Owner: WP2. */
import type { Condition } from '../types/ability';
import type { RenderContext } from './api';
import './boot';
import { cond } from './cond';
import { stateFor } from './state';
import { shown } from './text';

export function renderCondition(condition: Condition, ctx: RenderContext): string {
  return shown(cond(condition, stateFor(ctx)), ctx);
}
