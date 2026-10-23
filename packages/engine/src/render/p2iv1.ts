/**
 * p2-intervening-1 (lane p2-intervening): the words of the conditions parser/holes/p2iv1.ts reads (CR 603.4 intervening "if" clauses), called from
 * render/cond.ts#cond: Oracle's wording of a condition whose JSON another wording already had (the gate accepts either), or that had none.
 * Null for any other shape.
 */
import type { Condition, ObjectFilter, PlayerRef, Quantity } from '../types/ability';
import { K } from './kernel';
import { spentObjectText } from './qty';
import type { RenderState } from './state';
import { alt, numWord } from './text';

const json = (v: unknown): string => JSON.stringify(v);
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const keysAre = (v: object, ks: readonly string[]): boolean => Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().join(',') === [...ks].sort().join(',');
const eachFilter = (q: Quantity, qName: string): ObjectFilter | null => {
  const r = q as unknown;
  if (!isRec(r) || r['q'] !== qName || !isRec(r['of'])) return null;
  const of = r['of'];
  return of['ref'] === 'each' && isRec(of['filter']) ? of['filter'] as ObjectFilter : null;
};

/** "that player controls more lands than you", "defending player controls more lands than you" (CR 603.4): the same description counted for each. */
function moreThanYou(c: Extract<Condition, { cond: 'compare' }>, st: RenderState): string | null {
  if (c.op !== '>' || typeof c.right !== 'object' || typeof c.left !== 'object' || !keysAre(c.left, ['q', 'of']) || !keysAre(c.right, ['q', 'of'])) return null;
  const theirs = eachFilter(c.left, 'count');
  const mine = eachFilter(c.right, 'count');
  if (theirs === null || mine === null || mine.controller !== 'you' || !isRec(theirs.controller)) return null;
  const { controller: who, ...a } = theirs;
  const { controller: _you, ...b } = mine;
  if (json(a) !== json(b) || Object.keys(a).length === 0) return null;
  return `${K.player(who as PlayerRef, st, 'subject').text} controls more ${K.np(a, st, { det: 'none', plural: true, noController: true })} than you`;
}

/** "you control the artifact with the greatest mana value or tied for the greatest mana value" (CR 202.3; Cloud std-fin's power form, render/cond.ts). */
function greatestManaValue(c: Extract<Condition, { cond: 'all' }>, st: RenderState): string | null {
  if (c.of.length !== 2) return null;
  const [ex, cmp] = c.of;
  if (ex?.cond !== 'exists' || cmp?.cond !== 'compare' || ex.atLeast !== undefined || ex.of.ref !== 'each' || !('filter' in ex.of) || cmp.op !== '>=') return null;
  const mine = ex.of.filter;
  if (mine.controller !== 'you') return null;
  const { controller: _you, ...all } = mine;
  const max = (f: ObjectFilter): string => json({ q: 'stat', stat: 'manaValue', of: { ref: 'each', filter: f }, agg: 'max' });
  if (json(cmp.left) !== max(mine) || json(cmp.right) !== max(all) || Object.keys(all).length === 0) return null;
  return `you control the ${K.np(all, st, { det: 'none', noController: true })} with the greatest mana value or tied for the greatest mana value`;
}

/** "it wasn't cast", "you didn't cast it from your hand": the cast record of the object that entered (parser/lower/ability.ts#resolveCondAnaphors). */
function notCast(c: Extract<Condition, { cond: 'not' }>): string | null {
  const w = c.of;
  if (w.cond !== 'wasCast' || json(w.object) !== json({ ref: 'event', role: 'subject' })) return null;
  if (keysAre(w, ['cond', 'object'])) return alt("it wasn't cast", 'it was not cast');
  if (keysAre(w, ['cond', 'object', 'from']) && w.from === 'hand') return alt("you didn't cast it from your hand", 'you did not cast it from your hand');
  return null;
}

/** "no mana was spent to cast it"; "there are thirty or more counters among artifacts and creatures you control"; "you have 200 or more cards in your library". */
function compares(c: Extract<Condition, { cond: 'compare' }>, st: RenderState): string | null {
  const l = c.left;
  if (typeof l !== 'object') return null;
  if (typeof c.right !== 'number') return moreThanYou(c, st);
  if (l.q === 'spellManaSpent' && c.op === '==' && c.right === 0 && l.of !== undefined && keysAre(l, ['q', 'of'])) return `no mana was spent to cast ${spentObjectText(l.of, st)}`;
  if (l.q === 'counters' && l.kind === 'any' && c.op === '>=' && keysAre(l, ['q', 'on', 'kind']) && l.on.ref === 'each' && 'filter' in l.on) {
    return `there are ${numWord(c.right)} or more counters among ${K.np(l.on.filter, st, { det: 'none', plural: true })}`;
  }
  if (l.q === 'zoneSize' && l.zone === 'library' && c.op === '>=' && keysAre(l, ['q', 'zone', 'of']) && l.of.ref === 'you') return `you have ${numWord(c.right)} or more cards in your library`;
  return moreThanYou(c, st);
}

/** "it doesn't have the same name as another creature you control or a creature card in your graveyard" (CR 201.2; parser/holes/p2iv1.ts#spellAndName). */
function noSharedName(c: Extract<Condition, { cond: 'all' }>, st: RenderState): string | null {
  if (c.of.length !== 2) return null;
  const parts = c.of.map((x) => (x.cond === 'matches' && keysAre(x.filter, ['not']) && x.filter.not !== undefined && keysAre(x.filter.not, ['sharesWith']) ? { object: x.object, sw: x.filter.not.sharesWith! } : null));
  const [a, b] = parts;
  if (!a || !b || json(a.object) !== json(b.object) || a.sw.quality !== 'name' || b.sw.quality !== 'name' || a.sw.other !== true || b.sw.other !== undefined) return null;
  if (a.sw.with.ref !== 'each' || !('filter' in a.sw.with) || b.sw.with.ref !== 'each' || !('filter' in b.sw.with)) return null;
  const o = K.obj(a.object, st, 'subject').text;
  return `${o} doesn't have the same name as another ${K.np(a.sw.with.filter, st, { det: 'none' })} or ${K.np(b.sw.with.filter, st, { det: 'a' })}`;
}

export function p2iv1CondPhrase(c: Condition, st: RenderState): string | null {
  switch (c.cond) {
    case 'compare': return compares(c, st);
    case 'all': return greatestManaValue(c, st) ?? noSharedName(c, st);
    // "~ has loyalty counters on it" (CR 122.1): one or more of that kind on the object itself, as "a loyalty counter on it"
    case 'matches': {
      const k = c.filter.counters;
      return c.object.ref === 'self' && keysAre(c.object, ['ref']) && keysAre(c.filter, ['counters']) && k !== undefined && k.kind !== 'any' && k.cmp === undefined
        ? `${K.obj(c.object, st, 'subject').text} has ${k.kind} counters on it` : null;
    }
    // "that spell was kicked" (CR 702.33d): the spell of a cast trigger (parser/lower/ability.ts#resolveCondAnaphors)
    case 'wasCast': return keysAre(c, ['cond', 'kicked', 'object']) && c.kicked === true && json(c.object) === json({ ref: 'event', role: 'spell' }) ? 'that spell was kicked' : null;
    case 'not': {
      // "no creatures attacked this turn" (CR 508.1): no creature was declared as an attacker this turn, whoever controlled it
      if (json(c.of) === json({ cond: 'happened', event: { ev: 'attacks', attacker: { types: ['Creature'] } }, scope: 'turn' })) return 'no creatures attacked this turn';
      return notCast(c);
    }
    default: return null;
  }
}
