/** Renders a keyword ability line ("Flying", "Kicker {2}{G}", "Protection from red") from its JSON. Owner: WP2. Reminder text is never printed (CR 207.2). */
import type { KeywordAbilityDef } from '../types/ability';
import type { RenderContext } from './api';
import './boot';
import { keywordLine } from './kw';
import { stateFor } from './state';

export function renderKeyword(keyword: KeywordAbilityDef, ctx: RenderContext): string {
  return keywordLine(keyword, stateFor(ctx));
}
