/**
 * Shared merge helpers (mutate, CR 702.140, 730; m6 design 3.7). Owner: M6-9.
 *
 *   MUTATE_TARGET       CR 702.140a: the target a mutating creature spell gets from its mutate ability: a non-Human creature with the same owner as the spell (the
 *                       caster casts it from their own hand, actions/cast-opt/mutate.ts, so "you" own it). Announced with the spell's own targets (CR 601.2c)
 *                       as the last target group (actions/cast.ts appends the cast option's `extraTargets`).
 *   isMutating          the spell was cast for its mutate cost (CR 702.140a: "it becomes a mutating creature spell").
 *   mutateTargetOf      the mutate target of a spell on the stack, and whether it is still legal (CR 702.140b, 608.2b).
 *   componentOf         the component an object becomes as something merges with it (CR 730.2), and the one a merging spell becomes.
 *
 * The characteristics of a merged permanent are statics/merge.ts's (the rule-generated 1a effect); merging is core/resolve-parts/mutate.ts; leaving the
 * battlefield as one permanent is core/move-parts/components.ts.
 */
import type { TargetSpec } from '../types/ability';
import type { ObjectId } from '../types/ids';
import type { Component, GameObject, GameState } from '../types/state';
import { charsOfObject } from './characteristics';
import { recheckTargets } from './targets';

/** The cast method of the mutate cost (Action.cast.method, StackInfo.costsPaid.alternative). */
export const MUTATE_METHOD = 'mutate';

/** CR 702.140a: "target non-Human creature with the same owner as this spell". */
export const MUTATE_TARGET: TargetSpec = Object.freeze({
  id: 'mutate', kind: 'object', filter: { types: ['Creature'], notSubtypes: ['Human'], owner: 'you' }, text: 'target non-Human creature you own', min: 1, max: 1,
}) as TargetSpec;

/** CR 702.140a: a spell cast for its mutate cost is a mutating creature spell (until CR 702.140b ends that). */
export const isMutating = (spell: GameObject): boolean => spell.zone === 'stack' && spell.stack?.kind === 'spell' && spell.stack.costsPaid.alternative === MUTATE_METHOD;

/**
 * The mutate target of a spell on the stack (the last target group: actions/cast.ts appends a cast option's targets after the spell's own) and whether it is
 * still legal as the spell resolves (CR 702.140b, 608.2b: still a non-Human creature with the same owner, on the battlefield, targetable by the spell).
 */
export function mutateTargetOf(s: GameState, spell: GameObject): { id: ObjectId; legal: boolean } | null {
  const groups = spell.stack?.targets ?? [];
  const last = groups[groups.length - 1];
  const t = last?.length === 1 ? last[0] : undefined;
  if (!t || t.kind !== 'object') return null;
  const r = recheckTargets(s, [MUTATE_TARGET], [[t]], spell.controller, spell.id, spell.id);
  const o = s.objects[t.id];
  const sameOwner = o !== undefined && o.owner === spell.owner; // CR 702.140a: the same owner as the spell (the filter reads "you", the spell's controller)
  return { id: t.id, legal: r.legal === 1 && sameOwner && o.zone === 'battlefield' && charsOfObject(s, o).types.includes('Creature') };
}

/** CR 730.2: the component an object that has none yet becomes (the "original": no `mergedAt`), keeping its face-down status (CR 730.2e). */
export function componentOf(o: GameObject): Component {
  return { kind: o.kind === 'card' ? 'card' : 'token', defId: o.defId, ...(o.cardId !== undefined ? { cardId: o.cardId } : {}), owner: o.owner, ...(o.faceDown ? { faceDown: true } : {}) };
}

/** CR 730.2, 707.10f: the component a merging spell becomes (a copy of a spell is represented by a copy, not a card: a token component), merged at `at`. */
export function spellComponent(spell: GameObject, at: number): Component {
  return { kind: spell.kind === 'card' ? 'card' : 'token', defId: spell.defId, ...(spell.cardId !== undefined ? { cardId: spell.cardId } : {}), owner: spell.owner, mergedAt: at };
}
