/**
 * pc-exile-play-4: the fold of its template eff.pcep4.cast.anyNumber.linked.free (parser/templates/zz-cloud/pc-exile-play-4.json), called from render/fold.ts#foldAt.
 *
 * `castAnyLinkedFree`: "Cast any number of cards exiled with ~ without paying their mana costs." (Izzet Chemister; CR 607.2a, 601.2, 118.9, 305.9, 608.2g): you choose any
 * number of the nonland cards the object's linked ability exiled (a land is never cast) and cast each during the resolution without paying its mana cost. Only that shape:
 * one choice by you of any number among the linked exiled cards, then the free cast by you of exactly the chosen cards, nothing reading the choice afterwards.
 */
import type { EffectStep } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function castAnyLinkedFree(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'cast' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 0 || a.max !== 'any' || a.groupLimit !== undefined) return null;
  if (b.guard !== undefined || b.as !== undefined || b.who.ref !== 'you' || b.free !== true || b.optional !== undefined || b.costChange !== undefined || b.transformed !== undefined
    || b.copyIn !== undefined || b.play !== undefined || b.anyManaType !== undefined || !same(b.what, { ref: 'bound', name: a.as })) return null;
  if (a.from.ref !== 'each' || !same(a.from.filter, { notTypes: ['Land'], is: { ref: 'linked', link: 'exiled' }, zone: 'any' })) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null;
  const self = K.obj({ ref: 'self' }, st, 'object').text;
  const text = `cast any number of cards exiled with ${alt(self, 'it')} without paying their mana costs`;
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 2 };
}

export function foldPcEp4(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return castAnyLinkedFree(list, i, st);
}
