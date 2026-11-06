/**
 * edh-next-60 (Commander lane prevent: damage prevention and redirection; CR cites checked against the Comprehensive Rules text of 2026-09-25).
 *
 *   "All damage that would be dealt this turn to you and permanents you control is dealt to the chosen permanent instead." (Gideon's Sacrifice, Saving Grace)
 *   "Until end of turn, all damage that would be dealt to you and creatures you control is dealt to the chosen creature instead." (Heroic Sacrifice)
 *
 * (CR 614.9, 611.2a, 120.3): the two redirections of one resolved effect, one for the damage you would be dealt and one for the damage the permanents of a group would be
 * dealt, both to the same recipient, for one duration. Parser: zz-cloud/edh-next-60.json (eff.edhn60.redirect.all.youAnd.*). Anything else is not said here (null).
 */
import type { AbilityDef, EffectStep, ObjRef } from '../types/ability';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt } from './text';

type EffectOp = Extract<EffectStep, { op: 'effect' }>;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The sentence (no final period) of the redirections of `s` (the damage you would be dealt, if the first one is yours, and the damage the permanents of a group would be dealt), or null when `s` is not exactly that shape. */
export function redirectAllYouAnd(s: EffectOp, st: RenderState): string | null {
  if (s.duration === undefined || s.duration.d === 'permanent' || (s.effects.length !== 1 && s.effects.length !== 2)) return null;
  const rs = s.effects;
  for (const r of rs) {
    if (r.s !== 'replace' || r.condition !== undefined || r.optional !== undefined || r.selfReplacement !== undefined || r.shield !== undefined) return null;
    if (r.body.b !== 'redirect' || r.body.amount !== undefined || r.replaces.ev !== 'damage') return null;
  }
  const first = rs[0]!;
  const last = rs[rs.length - 1]!;
  if (first.s !== 'replace' || last.s !== 'replace' || first.body.b !== 'redirect' || last.body.b !== 'redirect') return null;
  if (!rs.every((r) => r.s === 'replace' && r.body.b === 'redirect' && same(r.body.to, (first.body as { to: unknown }).to))) return null;
  const withYou = rs.length === 2;
  if (withYou && !same(first.replaces, { ev: 'damage', recipient: { player: 'you' } })) return null;
  const ev = last.replaces;
  if (ev.ev !== 'damage' || !same(Object.keys(ev).sort(), ['ev', 'recipient']) || ev.recipient?.object === undefined || ev.recipient.player !== undefined || !same(Object.keys(ev.recipient), ['object']) || ev.recipient.object.is !== undefined) return null;
  const group = K.np(ev.recipient.object, st, { plural: true, det: 'none' });
  const tail = `to ${withYou ? 'you and ' : ''}${group} is dealt to ${K.obj(first.body.to as ObjRef, st, 'object').text} instead`;
  const dur = K.dur(s.duration, st);
  if (dur === '') return null;
  const lead = `${dur}, all damage that would be dealt ${tail}`;
  return s.duration.d === 'endOfTurn' ? alt(`all damage that would be dealt this turn ${tail}`, lead) : lead;
}

/**
 * "The next time target creature would deal combat damage to one or more players this combat, prevent that damage. If damage is prevented this way, create that many ... tokens ..."
 * (Ria Ivor, Bane of Bladehold; CR 615.1, 615.5, 615.7, 510.2): one use of a prevention of the combat damage one object would deal to a player, for a duration, with its additional
 * instructions (`then`, which read the damage prevented). Parser: eff.edhn60.prevent.nextTime.objCombatToPlayers.then. Anything else is not said here (null).
 */
export function nextTimeCombatToPlayers(s: EffectOp, st: RenderState): string | null {
  const r = s.effects.length === 1 ? s.effects[0]! : undefined;
  if (r === undefined || r.s !== 'replace' || s.duration === undefined || s.duration.d === 'permanent' || r.condition !== undefined || r.optional !== undefined || r.selfReplacement !== undefined) return null;
  if (!same(r.shield, { uses: 1 }) || r.body.b !== 'prevent' || r.body.amount !== 'all' || r.body.then === undefined || r.body.then.length === 0 || r.body.as !== undefined) return null;
  const ev = r.replaces;
  if (ev.ev !== 'damage' || ev.combat !== true || ev.amount !== undefined || !same(ev.recipient, { player: 'any' }) || ev.source === undefined || !same(Object.keys(ev.source), ['is'])) return null;
  const dur = K.dur(s.duration, st);
  const who = K.obj(ev.source.is!, st, 'subject').text;
  return `the next time ${who} would deal combat damage to one or more players${dur === '' ? '' : ` ${dur}`}, prevent that damage. if damage is prevented this way, ${K.steps(r.body.then, st)}`;
}

/**
 * "..., prevent that damage and that creature's owner shuffles it into their library." (Weeping Angel; CR 615.5, 701.24a, 400.3): the additional instructions of a prevention
 * (`then`) that put the creature the damage would have been dealt to into its owner's library and shuffle it. Parser: sta.edhn60.combatDamageToCreature.prevent.ownerShuffles.
 * The words after "and" (no final period), or null for any other additional instructions.
 */
export function ownerShufflesItPrevented(then: readonly EffectStep[] | undefined): string | null {
  if (then === undefined || then.length !== 2) return null;
  const ev = { ref: 'event', role: 'object' };
  const own = { ref: 'ownerOf', object: ev };
  const [a, b] = then;
  if (a?.op !== 'move' || b?.op !== 'shuffle' || a.guard !== undefined || b.guard !== undefined) return null;
  if (!same(a.what, ev) || !same(a.to, { zone: 'library', owner: own }) || !same(b.who, own)) return null;
  return "that creature's owner shuffles it into their library";
}

/**
 * "Prevent all damage that would be dealt to you this turn by sources your opponents control. Whenever damage from a creature is prevented this way, each commander creature you
 * control deals damage equal to its power to that creature." (Judgment of Alexander; CR 615.1, 615.5, 603.12, 120.3): a prevention of the damage a group of sources would deal to
 * you for a duration, and for each application, if the damage came from a creature, each object of a description you control deals damage equal to its power to that source.
 * Parser: eff.edhn60.prevent.toYou.byFilter.whenPrevented.eachDealsPower. Anything else is not said here (null).
 */
export function preventWhenPreventedEachDeals(s: EffectOp, st: RenderState): string | null {
  const r = s.effects.length === 1 ? s.effects[0]! : undefined;
  if (r === undefined || r.s !== 'replace' || s.duration === undefined || s.duration.d === 'permanent' || r.condition !== undefined || r.optional !== undefined || r.selfReplacement !== undefined || r.shield !== undefined) return null;
  const b = r.body;
  if (b.b !== 'prevent' || b.amount !== 'all' || b.as !== undefined || b.then === undefined || b.then.length !== 1 || r.replaces.ev !== 'damage') return null;
  const evsrc = { ref: 'event', role: 'source' };
  const i = b.then[0]!;
  if (i.op !== 'if' || i.guard !== undefined || i.else !== undefined || !same(i.cond, { cond: 'matches', object: evsrc, filter: { types: ['Creature'] } })) return null;
  // only when damage was really prevented (CR 615.13: the ability triggers when the effect prevents some or all of the damage)
  const g = i.then.length === 1 ? i.then[0]! : undefined;
  if (g?.op !== 'if' || g.guard !== undefined || g.else !== undefined || g.then.length !== 1 || !same(g.cond, { cond: 'compare', left: { q: 'preventedAmount' }, op: '>=', right: 1 })) return null;
  const d = g.then[0]!;
  if (d.op !== 'damage' || d.guard !== undefined || !same(d.to, evsrc) || d.perSource !== true || !same(d.amount, { q: 'stat', stat: 'power', of: { ref: 'subject' } })) return null;
  if (d.source.ref !== 'each' || !('filter' in d.source) || d.source.filter.anyOf?.length !== 1 || !same(Object.keys(d.source.filter).sort(), ['anyOf', 'controller']) || d.source.filter.controller !== 'you') return null;
  const base = K.staticEffect({ ...r, body: { b: 'prevent', amount: 'all' } }, st, { duration: s.duration });
  const group = K.np(d.source.filter.anyOf[0]!, st, { det: 'each' });
  return `${base}. whenever damage from a creature is prevented this way, ${group} you control deals damage equal to its power to that creature`;
}

/**
 * ", remove that many +1/+1 counters from it, then give each player a rad counter for each +1/+1 counter removed this way" (Bloatfly Swarm; CR 615.5, 122.1, 608.2c): the additional
 * instructions of a prevention (`then`) that remove the damage prevented as counters of one kind from the permanent and then put counters of another kind on each player, one for
 * each counter removed. Parser: sta.edhn60.damageToSelf.whileCounter.prevent.removeThenGiveRad. The words after "prevent that damage" (no final period), or null.
 */
export function removeThenGivePrevented(then: readonly EffectStep[] | undefined, st: RenderState): string | null {
  if (then === undefined || then.length !== 2) return null;
  const [a, b] = then;
  if (a?.op !== 'removeCounters' || b?.op !== 'putCounters' || a.guard !== undefined || b.guard !== undefined || a.as === undefined || a.upTo !== undefined) return null;
  if (!same(a.from, { ref: 'self' }) || !same(a.count, { q: 'preventedAmount' }) || a.kind === 'any' || typeof a.kind !== 'string') return null;
  if (!same(b.on, { ref: 'each', who: 'player' }) || b.count === undefined || typeof b.kind !== 'string' || !same(b.count, { q: 'countersRemoved', step: a.as, kind: (b.count as { kind?: string }).kind })) return null;
  const removedKind = (b.count as { kind?: string }).kind;
  if (typeof removedKind !== 'string') return null;
  return `, remove that many ${a.kind} counters from ${K.obj({ ref: 'self' }, st, 'object').text}, then give each player a ${b.kind} counter for each ${removedKind} counter removed this way`;
}

/**
 * "~ enters with six +1/+1 counters on it. It escapes with twelve +1/+1 counters on it instead." (Polukranos, Unchained; CR 614.12, 614.1c, 702.138c): two entering replacements of the
 * object itself, the counters it enters with (when it was not cast with escape) and, instead, the counters of an escaped one. Parser: sta.edhn60.entersWith.escapesWith.instead.
 * The sentences (no final period) for a static ability of exactly those two effects, or null.
 */
export function entersEscapesWith(def: Extract<AbilityDef, { kind: 'static' }>, st: RenderState): string | null {
  if (def.effects.length !== 2 || def.condition !== undefined || def.otherwise !== undefined || !same([...(def.zone ?? [])], ['stack', 'battlefield'])) return null;
  const esc = { cond: 'wasCast', via: 'escape' };
  const part = (e: (typeof def.effects)[number], cond: unknown): { kind: string; n: number } | null => {
    if (e.s !== 'replace' || e.shield !== undefined || e.optional !== undefined || e.selfReplacement !== undefined || !same(e.condition, cond)) return null;
    if (!same(e.replaces, { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }) || e.body.b !== 'enters') return null;
    const b = e.body;
    if (Object.keys(b).some((k) => k !== 'b' && k !== 'counters') || b.counters === undefined || b.counters.length !== 1) return null;
    const c = b.counters[0]!;
    return typeof c.kind === 'string' && typeof c.count === 'number' && c.count >= 2 && Object.keys(c).length === 2 ? { kind: c.kind, n: c.count } : null;
  };
  const a = part(def.effects[0]!, { cond: 'not', of: esc });
  const b = part(def.effects[1]!, esc);
  if (a === null || b === null) return null;
  return `${K.obj({ ref: 'self' }, st, 'subject').text} enters with ${a.n} ${a.kind} counters on it. it escapes with ${b.n} ${b.kind} counters on it instead`;
}
