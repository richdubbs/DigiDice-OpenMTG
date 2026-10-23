/**
 * p2-intervening-2 (lane p2-intervening): the words of the conditions parser/holes/p2iv2.ts reads (CR 603.4 intervening "if" clauses). render/boot.ts wraps
 * render/cond.ts#cond with `withP2iv2`: a condition of one of these shapes is also said the way Oracle prints it, beside the generic wording (or alone when the
 * generic renderer has none). Null for any other shape.
 */
import type { Condition, ObjRef, PlayerRef } from '../types/ability';
import { K } from './kernel';
import { cloneState, type RenderState } from './state';
import { alt, COLOR_WORD, NoRenderer } from './text';

const json = (v: unknown): string => JSON.stringify(v);
const keysAre = (v: object, ks: readonly string[]): boolean => Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().join(',') === [...ks].sort().join(',');
const SELF = json({ ref: 'self' });

function notPhrase(of: Condition, st: RenderState): string | null {
  // "you didn't attack with a creature this turn" (CR 508.1)
  if (json(of) === json({ cond: 'happened', event: { ev: 'attacks', attacker: { types: ['Creature'], controller: 'you' } }, scope: 'turn' })) {
    return alt("you didn't attack with a creature this turn", 'you did not attack with a creature this turn');
  }
  // "that player didn't cast a spell this turn" (CR 601.2i): a player the ability named before
  if (of.cond === 'happened' && keysAre(of, ['cond', 'event', 'scope']) && of.scope === 'turn' && of.event.ev === 'cast' && keysAre(of.event, ['ev', 'player'])
    && typeof of.event.player === 'object' && of.event.player !== null) {
    return `${K.player(of.event.player as PlayerRef, st, 'subject').text} didn't cast a spell this turn`;
  }
  // "it didn't have decayed" (CR 608.2h): one keyword the object did not have as it last existed
  if (of.cond === 'matches' && keysAre(of.filter, ['keyword']) && typeof of.filter.keyword === 'string' && json(of.object) !== SELF) {
    return `${K.obj(of.object, st, 'subject').text} didn't have ${of.filter.keyword}`;
  }
  // "all nonland permanents you control are white" (CR 105.2): no permanent of the description you control that isn't of the color
  if (of.cond === 'exists' && of.atLeast === undefined && of.of.ref === 'each' && 'filter' in of.of) {
    const f = of.of.filter;
    if (f.controller === 'you' && f.notColors?.length === 1 && f.colors === undefined) {
      const { notColors, controller: _you, ...rest } = f;
      if (Object.keys(rest).length > 0) return `all ${K.np(rest, st, { det: 'none', plural: true })} you control are ${COLOR_WORD[notColors[0]!]}`;
    }
  }
  return null;
}

/** The N of "N or more damage was dealt to it this turn": the damage dealt to the source this turn, added up (`happenedCount` with `sum`), or null. */
function damageToSelf(c: Condition): number | null {
  if (c.cond !== 'compare' || c.op !== '>=' || typeof c.right !== 'number') return null;
  return json(c.left) === json({ q: 'happenedCount', event: { ev: 'damage', recipient: { object: { self: true } } }, scope: 'turn', sum: 'amount' }) ? c.right : null;
}

function phrase(c: Condition, st: RenderState): string | null {
  switch (c.cond) {
    case 'not': return notPhrase(c.of, st);
    // "this creature is enchanted" (CR 303.4)
    case 'matches':
      return json(c.object) === SELF && keysAre(c.filter, ['enchanted']) && c.filter.enchanted === true ? `${K.obj({ ref: 'self' }, st, 'subject').text} is enchanted` : null;
    // "that creature's power is greater than this creature's" (CR 208.1); "4 or more damage was dealt to it this turn" (CR 120.1)
    case 'compare': {
      const dealt = damageToSelf(c);
      if (dealt !== null) return alt(`${dealt} or more damage was dealt to it this turn`, `${dealt} or more damage was dealt to ${K.obj({ ref: 'self' }, st, 'object').text} this turn`);
      const l = c.left as unknown as { q?: string; stat?: string; of?: ObjRef };
      const r = c.right as unknown as { q?: string; stat?: string; of?: ObjRef };
      if (c.op !== '>' || l.q !== 'stat' || r.q !== 'stat' || l.stat !== 'power' || r.stat !== 'power' || !keysAre(l, ['q', 'stat', 'of']) || !keysAre(r, ['q', 'stat', 'of'])) return null;
      if (json(r.of) !== SELF || json(l.of) === SELF) return null;
      return `${K.obj(l.of!, st, 'possessive').text} power is greater than ${K.obj({ ref: 'self' }, st, 'possessive').text}`;
    }
    // "you control no permanents other than this enchantment and have no cards in hand"
    case 'all':
      return json(c) === json({ cond: 'all', of: [{ cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { other: true, controller: 'you' } } } }, { cond: 'compare', left: { q: 'zoneSize', zone: 'hand', of: { ref: 'you' } }, op: '==', right: 0 }] })
        ? `you control no permanents other than ${K.obj({ ref: 'self' }, st, 'object').text} and have no cards in hand` : null;
    // "it's the first time +1/+1 counters have been put on that permanent this turn" (CR 122.6)
    case 'firstTime': {
      const ev = c.event as { ev?: string; change?: string; kind?: string; on?: object };
      if (ev.ev !== 'counters' || ev.change !== 'put' || typeof ev.kind !== 'string' || !keysAre(ev, ['ev', 'change', 'kind', 'on']) || json(ev.on) !== '{}') return null;
      const o = K.obj(c.object, st, 'object').text;
      return alt(`it's the first time ${ev.kind} counters have been put on ${o} this turn`, `it is the first time ${ev.kind} counters have been put on ${o} this turn`);
    }
    // "a +1/+1 counter was put on a permanent under your control this turn" (CR 122.6): by anyone; "it dealt combat damage to a player this turn" (CR 510.2)
    case 'happened': {
      // p2-intervening-4 (CR 509.1h): "it was blocked this turn" of the source that left
      if (json(c) === json({ cond: 'happened', event: { ev: 'blocks', attacker: { self: true } }, scope: 'turn' })) {
        return alt('it was blocked this turn', `${K.obj({ ref: 'self' }, st, 'subject').text} was blocked this turn`);
      }
      if (json(c) === json({ cond: 'happened', event: { ev: 'damage', source: { self: true }, combat: true, recipient: { player: 'any' } }, scope: 'turn' })) {
        return alt('it dealt combat damage to a player this turn', `${K.obj({ ref: 'self' }, st, 'subject').text} dealt combat damage to a player this turn`);
      }
      const ev = c.event as { ev?: string; change?: string; kind?: string; on?: unknown };
      if (c.scope !== 'turn' || c.times !== undefined || c.by !== undefined || ev.ev !== 'counters' || ev.change !== 'put' || typeof ev.kind !== 'string' || !keysAre(ev, ['ev', 'change', 'kind', 'on'])
        || json(ev.on) !== json({ controller: 'you' })) return null;
      return `a ${ev.kind} counter was put on a permanent under your control this turn`;
    }
    default: return null;
  }
}

/** Wraps the condition renderer: the generic wording, and Oracle's for the shapes above (only Oracle's when the generic renderer has none). */
export function withP2iv2(base: (c: Condition, st: RenderState) => string): (c: Condition, st: RenderState) => string {
  return (c, st) => {
    const mine = phrase(c, cloneState(st));
    if (mine === null) return base(c, st);
    // the generic words of a summed damage count say "the number of times it was dealt damage": only Oracle's are right
    if (damageToSelf(c) !== null) return phrase(c, st) ?? mine;
    try {
      return alt(base(c, st), mine);
    } catch (e) {
      if (!(e instanceof NoRenderer)) throw e;
      return phrase(c, st) ?? mine;
    }
  };
}
