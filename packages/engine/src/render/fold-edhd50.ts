/**
 * edh-d-50 (lane next-cast; Cherished Hatchling): the fold of "you may cast Dinosaur spells this turn as though they had flash, and whenever you cast a Dinosaur spell this turn, it gains
 * "When this creature enters, ..."", called from render/fold.ts#foldAt. Two consecutive instructions: a permission of the turn to cast spells of a description as though they had flash
 * (CR 601.3b, 702.8a, 611.2a), then a delayed trigger of the turn that waits for EVERY cast of a spell of a description of yours and gives that spell an ability (CR 603.7, 613.1f).
 * Only that exact shape; anything else renders as before (two sentences).
 */
import type { EffectStep } from '../types/ability';
import type { Folded } from './fold';
import { plain } from './clause';
import { K } from './kernel';
import type { RenderState } from './state';

export function flashThenGrantEveryCast(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'effect' || a.guard !== undefined || a.as !== undefined || a.duration.d !== 'endOfTurn' || a.effects.length !== 1) return null;
  const p = a.effects[0]!;
  if (p.s !== 'permit' || p.action !== 'haveFlash' || p.who.ref !== 'you') return null;
  if (b?.op !== 'delay' || b.guard !== undefined || b.as !== undefined || b.once === true || b.batch !== undefined || b.wholeBatch !== undefined || b.when.at !== 'event' || b.when.or !== undefined || b.duration?.d !== 'endOfTurn') return null;
  const ev = b.when.event;
  if (ev.ev !== 'cast' || ev.player !== 'you' || Object.keys(ev).some((k) => k !== 'ev' && k !== 'player' && k !== 'spell')) return null;
  if (b.do.length !== 1 || b.do[0]!.op !== 'effect' || (b.targets ?? []).length > 0) return null;
  const first = K.steps([a], st, { nested: true, sentences: true });
  const second = K.steps([b], st, { nested: true, sentences: true });
  return { clauses: [plain(`${first}, and ${second}`)], consumed: 2 };
}
