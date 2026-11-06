/**
 * edh-d-92 (Commander coordinator D, band 5,001-10,000, group counters): the folds of its templates (parser/templates/zz-cloud/edh-d-92.json), called from render/fold.ts#foldAt.
 * Each applies only when every part is exactly what the idiom says, with no guard, name, duration or link on any step it does not expect.
 */
import type { EffectStep, ObjectFilter } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';
import { alt } from './text';
import { isPlayerRef } from './refs';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const keysAre = (o: object, keys: string[]): boolean => Object.keys(o).filter((k) => (o as Record<string, unknown>)[k] !== undefined).sort().join(',') === [...keys].sort().join(',');

/**
 * `exileOneFromEachGraveyard` (CR 608.2d, 406.1, 404.1, 101.4; Summon: Esper Valigarmanda, eff.edhd92.exile.filterCardFromEachGraveyard): "exile an instant or sorcery card from each
 * graveyard": for each player, you choose one card of that description from their graveyard (none if they have none), then all of them are exiled together. Only that exact shape.
 */
function exileOneFromEachGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, m] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || a.as === undefined || a.random !== undefined || a.guard !== undefined || !same(a.who, { ref: 'you' }) || a.min !== 1 || a.max !== 1 || !same(a.perPlayer, { ref: 'each', who: 'player' })) return null;
  if (!keysAre(a, ['op', 'who', 'from', 'min', 'max', 'perPlayer', 'as'])) return null;
  if (a.from.ref !== 'each') return null;
  const f = a.from.filter;
  if (!keysAre(f, ['zone', 'isCard', 'owner', 'anyOf']) || f.zone !== 'graveyard' || f.isCard !== true || !same(f.owner, { ref: 'iterating' }) || f.anyOf?.length !== 1) return null;
  // the link the face's "exiled with ~" reader adds to the instruction that exiles (parser/parse.ts#linkExiled, CR 607.2a) is the only other key
  if (m?.op !== 'move' || !(keysAre(m, ['op', 'what', 'to']) || (keysAre(m, ['op', 'what', 'to', 'link']) && m.link === 'exiled')) || !same(m.what, { ref: 'bound', name: a.as }) || !same(m.to, { zone: 'exile' })) return null;
  const kind = f.anyOf[0]!;
  const card = K.np({ ...kind, isCard: true, zone: 'graveyard' }, st, { det: 'a', noZone: true });
  bind(st, a.as, { nouns: [...K.nounsOf(kind), 'card'], plural: true, zone: 'exile', thisWay: 'exiled this way' });
  const text = `exile ${card} from each graveyard`;
  return { clauses: [acting('you', text, text, {})], consumed: 2 };
}

/**
 * `castLinkedExiledAnyType` (CR 607.2a, 608.2g, 601.2, 609.4b; Summon: Esper Valigarmanda, eff.edhd92.cast.linkedExiled.anyType): "you may cast an instant or sorcery card exiled with ~,
 * and mana of any type can be spent to cast that spell": while the ability resolves, you may cast one card of that description among the cards the object's linked ability exiled, paying
 * with mana of any type. Only that exact shape.
 */
function castLinkedExiledAnyType(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, c] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || a.as === undefined || !keysAre(a, ['op', 'who', 'from', 'min', 'max', 'as']) || !same(a.who, { ref: 'you' }) || a.min !== 0 || a.max !== 1 || a.from.ref !== 'each') return null;
  const f = a.from.filter;
  if (!keysAre(f, ['is', 'zone', 'isCard', 'anyOf']) || !same(f.is, { ref: 'linked', link: 'exiled' }) || f.zone !== 'any' || f.isCard !== true || f.anyOf?.length !== 1) return null;
  if (c?.op !== 'cast' || !keysAre(c, ['op', 'who', 'what', 'anyManaType']) || c.anyManaType !== true || !same(c.who, { ref: 'you' }) || !same(c.what, { ref: 'bound', name: a.as })) return null;
  const kind = f.anyOf[0]!;
  const card = K.np({ ...kind, isCard: true, zone: 'exile' }, st, { det: 'a', noZone: true });
  const text = `you may cast ${card} exiled with ~, and mana of any type can be spent to cast that spell`;
  return { clauses: [acting('x', text, text, { standalone: true })], consumed: 2 };
}

/**
 * `doubleSelfIfPowerAtMost` (CR 122.1, 701.10e, 608.2c; Lily Bowen, Raging Grandma, eff.edhd92.counters.doubleOnSelf.ifPowerAtMost): "double the number of +1/+1 counters on ~ if its
 * power is 16 or less": the object's counters of that kind are doubled when its power (as the step runs) is at most N; with an `else` ("Otherwise, ...", fl.otherwise) those steps run
 * instead. Only that exact shape: the doubling of the object's own counters by you, the comparison of its own power with a fixed number.
 */
function doubleSelfIfPowerAtMost(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  // with no "Otherwise", the condition stays the doubling's own guard
  if (f?.op === 'action' && f.guard !== undefined) {
    const { guard, ...d } = f;
    return doubleSelfIfPowerAtMost([{ op: 'if', cond: guard, then: [d as EffectStep] } as EffectStep], 0, st);
  }
  if (f?.op !== 'if' || f.guard !== undefined || f.intervening !== undefined || f.then.length !== 1) return null;
  if (!(keysAre(f, ['op', 'cond', 'then']) || keysAre(f, ['op', 'cond', 'then', 'else']))) return null;
  const c = f.cond;
  if (c.cond !== 'compare' || c.op !== '<=' || typeof c.right !== 'number' || !same(c.left, { q: 'stat', stat: 'power', of: { ref: 'self' } })) return null;
  const d = f.then[0]!;
  if (d.op !== 'action' || d.action !== 'doubleCounters' || !keysAre(d, ['op', 'action', 'subject', 'who', 'arg']) || !same(d.subject, { ref: 'self' }) || !same(d.who, { ref: 'you' }) || typeof d.arg !== 'string') return null;
  if (!/^[+\-\d/]+$|^[a-z]+$/.test(d.arg)) return null;
  const first = `double the number of ${d.arg} counters on ~ if its power is ${c.right} or less`;
  const text = f.else === undefined || f.else.length === 0 ? first : `${first}. otherwise, ${K.steps(f.else, st)}`;
  return { clauses: [acting('x', text, text, { standalone: true })], consumed: 1 };
}

/**
 * `removeAllButOneGainPerRemoved` (CR 122.1, 608.2c, 119.3; Lily Bowen, Raging Grandma, eff.edhd92.counters.removeAllButOne.gainPerRemoved): "remove all but one +1/+1 counter from it,
 * then you gain 1 life for each +1/+1 counter removed this way": of the counters of that kind on the object, every one but one comes off (none when it has one or none), and you gain
 * 1 life for each one that came off. Only that exact shape.
 */
function removeAllButOneGainPerRemoved(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [r, g] = [list[i], list[i + 1]];
  if (r?.op !== 'removeCounters' || r.as === undefined || !keysAre(r, ['op', 'from', 'kind', 'count', 'as']) || typeof r.kind !== 'string' || r.kind === 'any') return null;
  if (!same(r.count, { q: 'math', op: 'max', args: [0, { q: 'math', op: '-', args: [{ q: 'counters', on: r.from, kind: r.kind }, 1] }] })) return null;
  if (g?.op !== 'gainLife' || !keysAre(g, ['op', 'who', 'amount']) || !same(g.who, { ref: 'you' }) || !same(g.amount, { q: 'countersRemoved', step: r.as, kind: r.kind })) return null;
  if (!/^[+\-\d/]+$|^[a-z]+$/.test(r.kind)) return null;
  const from = r.from.ref === 'self' ? alt('it', '~') : K.obj(r.from as never, st, 'object').text;
  const text = `remove all but one ${r.kind} counter from ${from}, then you gain 1 life for each ${r.kind} counter removed this way`;
  return { clauses: [acting('you', text, text, { standalone: true })], consumed: 2 };
}

/**
 * `tapUntappedPerCounterOnSelf` (CR 701.26a, 608.2d, 608.2h, 122.1; Tangle Wire, eff.edhd92.player.tapsUntapped.perCounterOnSelf): "that player taps an untapped artifact, creature, or land
 * they control for each fade counter on ~": the player chooses that many untapped permanents of that description they control (all of them when they have fewer), counted as the step
 * runs, and taps them. Only that exact shape.
 */
function tapUntappedPerCounterOnSelf(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, t] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || a.as === undefined || !keysAre(a, ['op', 'who', 'from', 'min', 'max', 'as']) || a.from.ref !== 'each' || !same(a.min, a.max)) return null;
  const n = a.min as unknown as { q?: string; on?: unknown; kind?: unknown };
  if (n.q !== 'counters' || !same(n.on, { ref: 'self' }) || typeof n.kind !== 'string' || !/^[a-z]+$/.test(n.kind) || Object.keys(n).length !== 3) return null;
  const f = a.from.filter as Record<string, unknown>;
  if (f['tapped'] !== false || !same(f['controller'], a.who)) return null;
  if (t?.op !== 'tap' || !keysAre(t, ['op', 'what']) || !same(t.what, { ref: 'bound', name: a.as })) return null;
  const { tapped: _t, controller: _c, ...kind } = f;
  const who = K.player(a.who, st, 'subject').text;
  const what = K.np({ ...(kind as ObjectFilter) }, st, { det: 'none' });
  const text = `${who} taps an untapped ${what} they control for each ${n.kind} counter on ~`;
  return { clauses: [acting('x', text, text, { standalone: true })], consumed: 2 };
}

/**
 * `permanentOrSuspendedMayRemoveOrPutTime` (CR 115.1, 702.62b, 122.1, 608.2d; Jhoira's Timebug, eff.edhd92.chooseTarget.permanentOrSuspended.mayRemoveOrPutTime): "Choose target permanent you
 * control or suspended card you own. If that permanent or card has a time counter on it, you may remove a time counter from it or put another time counter on it.": the one target (a
 * permanent you control, or a suspended card you own in exile); if it has a time counter as the ability resolves, you may choose to remove one or put one more. Only that exact shape.
 */
function permanentOrSuspendedMayRemoveOrPutTime(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'if' || !keysAre(f, ['op', 'cond', 'then']) || f.then.length !== 1) return null;
  const c = f.cond;
  if (c.cond !== 'matches' || c.object.ref !== 'target' || !same(c.filter, { counters: { kind: 'time' } })) return null;
  const t = c.object;
  const spec = st.specs.get(t.id);
  const want = { zone: ['battlefield', 'exile'], anyOf: [{ zone: 'battlefield', controller: 'you' }, { zone: 'exile', keyword: 'suspend', counters: { kind: 'time' }, owner: 'you' }] };
  if (spec === undefined || spec.kind !== 'object' || spec.min !== 1 || spec.max !== 1 || !same(spec.filter, want)) return null;
  const m = f.then[0]!;
  if (m.op !== 'may' || !keysAre(m, ['op', 'who', 'do']) || !same(m.who, { ref: 'you' }) || m.do.length !== 3) return null;
  const [v, r, p] = m.do;
  if (v?.op !== 'chooseValue' || !same(v, { op: 'chooseValue', who: { ref: 'you' }, what: 'option', as: v.as, link: v.link, options: ['remove', 'put'] })) return null;
  if (!same(r, { op: 'if', cond: { cond: 'chosen', link: v.link, equals: 'remove' }, then: [{ op: 'removeCounters', from: t, kind: 'time', count: 1 }] })) return null;
  if (!same(p, { op: 'if', cond: { cond: 'chosen', link: v.link, equals: 'put' }, then: [{ op: 'putCounters', on: t, kind: 'time', count: 1 }] })) return null;
  st.used.add(t.id);
  const text = 'choose target permanent you control or suspended card you own. if that permanent or card has a time counter on it, you may remove a time counter from it or put another time counter on it';
  return { clauses: [acting('x', text, text, { standalone: true })], consumed: 1 };
}

/**
 * `amassThenArmyDealsOwnPower` (CR 701.47a, 701.47c, 120.3, 208.1, 608.2h; Widespread Brutality, eff.edhd92.amassZombie.thenArmyDealsOwnPower): "Amass Zombies 2, then the Army you amassed
 * deals damage equal to its power to each non-Army creature.": the Army the amass chose deals damage equal to its own power as the step runs. Only that exact shape.
 */
function amassThenArmyDealsOwnPower(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, d] = [list[i], list[i + 1]];
  if (a?.op !== 'action' || a.action !== 'amass' || a.as === undefined || !keysAre(a, ['op', 'action', 'who', 'n', 'arg', 'as']) || !same(a.who, { ref: 'you' }) || a.arg !== 'Zombie' || typeof a.n !== 'number') return null;
  const army = { ref: 'bound', name: a.as };
  if (d?.op !== 'damage' || !keysAre(d, ['op', 'source', 'to', 'amount']) || !same(d.source, army) || !same(d.amount, { q: 'stat', stat: 'power', of: army })) return null;
  const to = isPlayerRef(d.to as never, st) ? K.player(d.to as never, st, 'object').text : K.obj(d.to as never, st, 'object').text;
  const text = `amass zombies ${a.n}, then the army you amassed deals damage equal to its power to ${to}`;
  return { clauses: [acting('you', text, text, { standalone: true })], consumed: 2 };
}

export function foldEdhD92(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return exileOneFromEachGraveyard(list, i, st) ?? castLinkedExiledAnyType(list, i, st) ?? doubleSelfIfPowerAtMost(list, i, st) ?? removeAllButOneGainPerRemoved(list, i, st) ?? tapUntappedPerCounterOnSelf(list, i, st) ?? permanentOrSuspendedMayRemoveOrPutTime(list, i, st) ?? amassThenArmyDealsOwnPower(list, i, st);
}
