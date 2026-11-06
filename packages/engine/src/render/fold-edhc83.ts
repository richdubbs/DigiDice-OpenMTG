/**
 * edh-c-83 (Commander effort, coordinator C): the folds of its templates (parser/templates/zz-cloud/edh-c-83.json), called from render/fold.ts#foldAtPlain. Each applies only when
 * every part is exactly what the idiom says.
 *
 * `exileEachCardType` (CR 205.2a, 608.2d, 701.13a; Grime Gorger, eff.edhv83.exile.upToOneEachCardType.fromGraveyard): "Exile up to one card of each card type from defending player's
 * graveyard.": your choice of any number of the cards of a graveyard, at most one of each card type (`eachCardType`), and their exile; the cards exiled are "exiled this way" later.
 */
import type { EffectStep } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { bind } from './steps-util';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function exileEachCardType(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || a.as === undefined || a.eachCardType !== true || a.who.ref !== 'you') return null;
  if (a.guard !== undefined || b.guard !== undefined || a.random === true || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined || a.distinct !== undefined) return null;
  if (a.min !== 0 || a.max !== 'any' || a.from.ref !== 'each') return null;
  const f = a.from.filter;
  if (f.zone !== 'graveyard' || f.owner === undefined || f.isCard !== true || !same(Object.keys(f).sort(), ['isCard', 'owner', 'zone'])) return null;
  if (!same(b.what, { ref: 'bound', name: a.as }) || !same(b.to, { zone: 'exile' }) || b.link !== undefined || b.until !== undefined) return null;
  const owner = K.player(f.owner as never, st, 'possessive').text;
  bind(st, a.as, { nouns: ['card'], plural: true, optional: true });
  bind(st, b.as, { nouns: ['card'], plural: true, zone: 'exile', thisWay: 'exiled this way', alts: ['the exiled cards'] });
  const text = `exile up to one card of each card type from ${owner} graveyard`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/** The folds of edh-c-83's templates (render/fold.ts#foldAtPlain). */
export function foldEdhC83(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return exileEachCardType(list, i, st);
}
