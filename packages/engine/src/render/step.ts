/**
 * Renderers of effect steps, one per op. Owner: WP2. An op without a renderer here is not a capability even if its handler exists (design 5.2): the exact
 * render gate (guard G6) could never accept it, so a card using it would be wrongly "automated". Every op of the model has a renderer.
 */
import type { EffectOp, EffectStep } from '../types/ability';
import type { RenderContext } from './api';
import './boot';
import { fragment } from './clause';
import { CLAUSES, clause } from './steps';
import { stateFor } from './state';
import { capFirst, shown } from './text';

/** Renders one step to a sentence (or fragment). */
export type StepRenderer = (step: EffectStep, ctx: RenderContext) => string;

const renderStep: StepRenderer = (step, ctx) => {
  const st = stateFor(ctx);
  const text = shown(fragment(clause(step, st)), ctx).trim();
  return text === '' ? '' : `${capFirst(text)}.`;
};

/** The ops this build can render (`op:<op>` capabilities need an entry here and a handler in effects/handlers). */
export const RENDERERS: Readonly<Partial<Record<EffectOp, StepRenderer>>> = Object.fromEntries(Object.keys(CLAUSES).map((op) => [op, renderStep])) as Partial<Record<EffectOp, StepRenderer>>;
