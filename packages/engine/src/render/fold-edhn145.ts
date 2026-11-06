/**
 * edh-next-145 (must-finish round, group "other"): the folds of its templates (parser/templates/zz-cloud/edh-next-145.json), called from render/fold.ts#foldAt. Each applies only when
 * every part is exactly what the idiom says, with no guard, name, duration or link on any step it does not expect.
 */
import type { EffectStep, Quantity } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * `eachGetsPerListedKeyword` (CR 611.2c, 608.2h, 613.4c, 702.1; Akroma, Vision of Ixidor, eff.edhn145.eachGets.perListedKeyword.dur): "until end of turn, each other creature you control gets
 * +1/+1 if it has flying, +1/+1 if it has first strike, and so on for double strike, ..., and partner": one continuous effect until end of turn on each object of a group, +1/+1 for each listed
 * keyword the object has (`keywordsHad` of the object itself, the same count for power and toughness), the keywords said in their order. Only that shape, three keywords or more.
 */
function eachGetsPerListedKeyword(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const e = list[i];
  if (e?.op !== 'effect' || e.guard !== undefined || e.as !== undefined || !same(e.duration, { d: 'endOfTurn' }) || e.effects.length !== 1) return null;
  const c = e.effects[0]!;
  if (c.s !== 'continuous' || c.affects.ref !== 'each' || !('filter' in c.affects) || Object.keys(c.affects).length !== 2 || c.mods.length !== 1) return null;
  const extra = Object.keys(c).filter((k) => !['s', 'affects', 'mods'].includes(k));
  const m = c.mods[0]!;
  if (extra.length > 0 || m.layer !== '7c' || Object.keys(m).sort().join(',') !== 'layer,power,toughness' || !same(m.power, m.toughness)) return null;
  const q = m.power as Quantity;
  if (typeof q !== 'object' || q.q !== 'keywordsHad' || !same(q.of, { ref: 'subject' }) || q.keywords.length < 3) return null;
  const words = q.keywords.map((k) => (Array.isArray(k) ? k[0]! : k));
  if (words.some((w) => typeof w !== 'string' || w.length === 0)) return null;
  const rest = words.slice(2);
  const group = K.np(c.affects.filter, st, { det: 'each' });
  const text = `until end of turn, ${group} gets +1/+1 if it has ${words[0]}, +1/+1 if it has ${words[1]}, and so on for ${rest.slice(0, -1).join(', ')}, and ${rest[rest.length - 1]}`;
  return { clauses: [acting('x', text, text, { standalone: true })], consumed: 1 };
}

/**
 * `pumpThenPowerBecomes` (CR 603.12, 608.2h, 613.4c; Inferno of the Star Mounts, eff.edhn145.reflexive.powerBecomes, parser/lower/conditions.ts#becomesCondition): "~ gets +1/+0 until end of
 * turn. When its power becomes 20 this way, <instructions>": the power of the one pumped object fixed just before the pump (`let`), the pump (named), and a reflexive trigger that waits for
 * it and asks that the power was not N then and is N now. Only that shape: the same object in the three places, the name read nowhere else.
 */
function pumpThenPowerBecomes(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [l, e, r] = [list[i], list[i + 1], list[i + 2]];
  if (l?.op !== 'let' || l.guard !== undefined || e?.op !== 'effect' || e.guard !== undefined || typeof e.as !== 'string' || r?.op !== 'reflexive' || r.guard !== undefined || r.modes !== undefined) return null;
  const v = l.value;
  if (typeof v !== 'object' || v.q !== 'stat' || v.stat !== 'power' || v.sum !== undefined || v.agg !== undefined || Object.keys(v).length !== 3) return null;
  const obj = v.of;
  if (e.effects.length !== 1 || e.effects[0]!.s !== 'continuous' || !same(e.effects[0]!.affects, obj)) return null;
  const w = r.when;
  if (w.did !== e.as || w.if === undefined || w.if.cond !== 'all' || w.if.of.length !== 2) return null;
  const [was, now] = w.if.of as [any, any];
  const n = was?.right;
  if (typeof n !== 'number' || !same(was, { cond: 'compare', left: { q: 'var', name: l.name }, op: '!=', right: n }) || !same(now, { cond: 'compare', left: { q: 'stat', stat: 'power', of: obj }, op: '==', right: n })) return null;
  const rest = JSON.stringify(list.filter((_, k) => k < i || k > i + 2));
  if (rest.includes(`"name":"${l.name}"`) || rest.includes(`"${e.as}"`)) return null;
  const { as: _as, ...pump } = e;
  const first = K.clause(pump as EffectStep, st);
  const body = r.targets.length > 0 ? K.program({ targets: r.targets, steps: r.do }, st) : K.steps(r.do, st);
  const text = `${first.sub}. when its power becomes ${n} this way, ${body}`;
  return { clauses: [acting('x', text, text, { standalone: true })], consumed: 3 };
}

/**
 * `castOnlyOneMore` (CR 601.2i, 611.2c; Irencrag Feat, eff.edhn145.youCanCastOnlyOneMore.thisTurn): "You can cast only one more spell this turn": a restriction until end of turn on you, at most
 * one spell, counted from the spells you had cast when it began (`countFrom`). Only that shape.
 */
function castOnlyOneMore(list: EffectStep[], i: number): Folded | null {
  const e = list[i];
  if (e?.op !== 'effect' || e.guard !== undefined || e.as !== undefined || !same(e.duration, { d: 'endOfTurn' }) || e.effects.length !== 1) return null;
  if (!same(e.effects[0], { s: 'restrict', subject: { ref: 'you' }, mode: 'cant', action: 'cast', max: 1, countFrom: { q: 'spellsCastThisTurn' } })) return null;
  const text = 'you can cast only one more spell this turn';
  return { clauses: [acting('x', text, text, { standalone: true })], consumed: 1 };
}

/**
 * `equippedOrNamedGetsX` (CR 301.5a, 201.2, 608.2d, 608.2h, 613.4c; Hand of Vecna, eff.edhn145.equippedOrNamed.getsX.dur; ruling 2021-07-23): "equipped creature or a creature you control named
 * Vecna gets +X/+X until end of turn, where X is ...": you choose one creature among the creature this Equipment is attached to and the creatures you control with that name, as the ability
 * resolves, and it gets +X/+X with X read then. Only that shape: the choice read by the pump alone.
 */
function equippedOrNamedGetsX(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c, e] = [list[i], list[i + 1]];
  if (c?.op !== 'chooseObjects' || c.guard !== undefined || c.as === undefined || c.min !== 1 || c.max !== 1 || c.random !== undefined || c.perPlayer !== undefined || !same(c.who, { ref: 'you' })) return null;
  if (c.from.ref !== 'each' || !('filter' in c.from) || Object.keys(c.from).length !== 2) return null;
  const f = c.from.filter;
  const any = f.anyOf;
  if (Object.keys(f).length !== 1 || any === undefined || any.length !== 2 || !same(any[0], { is: { ref: 'attachedTo' } })) return null;
  const named = any[1]!;
  if (Object.keys(named).sort().join(',') !== 'controller,name,types' || named.controller !== 'you' || !same(named.types, ['Creature']) || typeof named.name !== 'string') return null;
  if (e?.op !== 'effect' || e.guard !== undefined || e.as !== undefined || !same(e.duration, { d: 'endOfTurn' }) || e.effects.length !== 1) return null;
  const p = e.effects[0]!;
  if (p.s !== 'continuous' || !same(p.affects, { ref: 'bound', name: c.as }) || p.mods.length !== 1 || Object.keys(p).length !== 3) return null;
  const m = p.mods[0]!;
  if (m.layer !== '7c' || Object.keys(m).sort().join(',') !== 'layer,power,toughness' || !same(m.power, m.toughness) || typeof m.power !== 'object') return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":"${c.as}"`))) return null;
  const text = `equipped creature or a creature you control named ${named.name} gets +x/+x until end of turn, where x is ${K.qty(m.power as Quantity, st)}`;
  return { clauses: [acting('x', text, text, { standalone: true })], consumed: 2 };
}

export function foldEdhN145(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachGetsPerListedKeyword(list, i, st) ?? pumpThenPowerBecomes(list, i, st) ?? castOnlyOneMore(list, i) ?? equippedOrNamedGetsX(list, i, st);
}
