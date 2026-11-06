/**
 * edh-next-144 (must-finish round: library, draw and search): the folds of its templates (parser/templates/zz-cloud/edh-next-144.json), called from render/fold.ts#foldAt.
 * Each applies only when every part is exactly what the idiom says.
 */
import type { EffectStep, ObjectFilter } from '../types/ability';
import { acting, plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const YOU = { ref: 'you' };
const bound = (name: string) => ({ ref: 'bound', name });
const onlyKeys = (s: object, keys: readonly string[]): boolean => Object.keys(s).every((k) => keys.includes(k));

/**
 * `revealChooseAndOr` (CR 608.2c, 608.2d, 701.20a, 107.3, 401.4; Green Sun's Twilight, eff.edhn144.reveal.chooseAndOr.handOrBattlefieldIfX): "Reveal the top X plus one cards of your
 * library. Choose a creature card and/or a land card from among them. Put those cards into your hand and the rest on the bottom of your library in a random order. If X is 5 or more,
 * instead put the chosen cards onto the battlefield or into your hand and the rest on the bottom of your library in a random order.": the reveal names the group; up to one card of
 * the first kind and up to one other card of the second kind are chosen; with X at least N you may put both onto the battlefield, else (or otherwise) both go to your hand (ruling
 * 2023-02-04: never one each way); the rest go to the bottom in a random order. Only that exact shape.
 */
function revealChooseAndOr(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [r, a, b, f, m] = [list[i], list[i + 1], list[i + 2], list[i + 3], list[i + 4]];
  if (r?.op !== 'reveal' || r.guard !== undefined || typeof r.as !== 'string' || !same(r.who, YOU) || !onlyKeys(r, ['op', 'who', 'what', 'as'])) return null;
  if (r.what.ref !== 'topCards' || !same(r.what.player, YOU) || Object.keys(r.what).sort().join() !== 'count,player,ref') return null;
  const seen = r.as;
  const pick = (s: EffectStep | undefined): s is Extract<EffectStep, { op: 'chooseObjects' }> =>
    s?.op === 'chooseObjects' && s.guard === undefined && same(s.who, YOU) && s.min === 0 && s.max === 1 && typeof s.as === 'string'
    && onlyKeys(s, ['op', 'who', 'from', 'min', 'max', 'as']) && s.from.ref === 'each';
  if (!pick(a) || !pick(b) || a.from.ref !== 'each' || b.from.ref !== 'each') return null;
  const fa = a.from.filter as ObjectFilter & { anyOf?: ObjectFilter[] };
  const fb = b.from.filter as ObjectFilter & { anyOf?: ObjectFilter[] };
  if (!onlyKeys(fa, ['anyOf', 'is', 'zone']) || !same(fa.is, bound(seen)) || fa.zone !== 'library' || fa.anyOf?.length !== 1) return null;
  if (!onlyKeys(fb, ['anyOf', 'is', 'not', 'zone']) || !same(fb.is, bound(seen)) || fb.zone !== 'library' || fb.anyOf?.length !== 1 || !same(fb.not, { is: bound(a.as) })) return null;
  const both = { anyOf: [{ is: bound(a.as) }, { is: bound(b.as) }] };
  const chosen = { ref: 'each', filter: { ...both, zone: 'library' } };
  const plainMove = (s: EffectStep | undefined, to: unknown): boolean => s?.op === 'move' && same(s.what, chosen) && same(s.to, to) && onlyKeys(s, ['op', 'what', 'to']);
  const HAND = { zone: 'hand' };
  if (f?.op !== 'if' || f.guard !== undefined || f.then.length !== 1 || f.else?.length !== 1 || !plainMove(f.else[0], HAND) || !onlyKeys(f, ['op', 'cond', 'then', 'else'])) return null;
  const c = f.cond;
  if (c.cond !== 'compare' || !same(c.left, { q: 'X' }) || c.op !== '>=' || !onlyKeys(c, ['cond', 'left', 'op', 'right'])) return null;
  const y = f.then[0]!;
  if (y.op !== 'may' || y.guard !== undefined || !same(y.who, YOU) || !onlyKeys(y, ['op', 'who', 'do', 'otherwise']) || y.do.length !== 1 || y.otherwise?.length !== 1) return null;
  if (!plainMove(y.do[0], { zone: 'battlefield', controller: YOU }) || !plainMove(y.otherwise[0], HAND)) return null;
  if (m?.op !== 'move' || !onlyKeys(m, ['op', 'what', 'to']) || !same(m.to, { zone: 'library', position: 'bottom', order: 'random' })) return null;
  if (!same(m.what, { ref: 'each', filter: { is: bound(seen), not: both, zone: 'library' } })) return null;
  const names = [seen, a.as, b.as];
  if (list.slice(i + 5).some((x) => names.some((n) => JSON.stringify(x).includes(`"name":"${n}"`)))) return null;
  const kind = (x: ObjectFilter): string => K.np({ ...x, zone: 'library' }, st, { det: 'a', noZone: true });
  const rest = 'and the rest on the bottom of your library in a random order';
  const text = `reveal the top ${K.qty(r.what.count, st)} cards of your library. choose ${kind(fa.anyOf[0]!)} and/or ${kind(fb.anyOf[0]!)} from among them. `
    + `put those cards into your hand ${rest}. if x is ${K.qty(c.right, st)} or more, instead put the chosen cards onto the battlefield or into your hand ${rest}`;
  bind(st, seen, { nouns: ['card'], plural: true, zone: 'library' });
  return { clauses: [acting('you', text, `you ${text}`, { standalone: true, closesScope: true })], consumed: 5 };
}

/**
 * `damagePowerOfBeheld` (CR 608.2c, 614.15, 701.4a, 608.2h; Dragon's Fire, rid.edhn144.instead.damage.powerOfBeheld): "~ deals 3 damage to target creature or planeswalker. If you revealed a
 * Dragon card or chose a Dragon as you cast this spell, ~ deals damage equal to the power of that card or creature instead.": an `if` whose condition is the optional behold cost of the
 * spell, whose branch is the same damage of ~ to the same one target with the power of the beheld object (`costBeheld`, its last known power if it left, ruling 2021-07-23), and whose
 * other branch is that damage with a fixed amount. Only that exact shape.
 */
function damagePowerOfBeheld(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'if' || f.guard !== undefined || f.then.length !== 1 || f.else?.length !== 1 || !onlyKeys(f, ['op', 'cond', 'then', 'else'])) return null;
  const c = f.cond;
  if (c.cond !== 'beheld' || !onlyKeys(c, ['cond', 'quality']) || !onlyKeys(c.quality, ['subtypes']) || c.quality.subtypes?.length !== 1) return null;
  const [a, b] = [f.then[0]!, f.else[0]!];
  if (a.op !== 'damage' || b.op !== 'damage' || !onlyKeys(a, ['op', 'source', 'to', 'amount']) || !onlyKeys(b, ['op', 'source', 'to', 'amount'])) return null;
  if (!same(a.source, { ref: 'self' }) || !same(b.source, { ref: 'self' }) || !same(a.to, b.to) || a.to.ref !== 'target' || typeof b.amount !== 'number') return null;
  if (!same(a.amount, { q: 'stat', stat: 'power', of: { ref: 'costBeheld' } })) return null;
  const kind = K.np({ subtypes: c.quality.subtypes }, st, { det: 'a', noZone: true });
  const to = K.obj(a.to, st, 'object').text;
  const text = `~ deals ${b.amount} damage to ${to}. if you revealed ${kind} card or chose ${kind} as you cast ~, ~ deals damage equal to the power of that card or creature instead`;
  return { clauses: [plain(text, { standalone: true })], consumed: 1 };
}

/**
 * `sacrificeRepeatForTwoMore` (CR 701.21a, 608.2c, 608.2d, 119.3; Invoke Despair, eff.edhn144.sacrifice.ifCant.repeatForTwoMore): "Target opponent sacrifices a creature of their choice. If they
 * can't, they lose 2 life and you draw a card. Then repeat this process for an enchantment and a planeswalker.": three times the same pair, a sacrifice of one permanent of a kind by the
 * same player and "if they didn't, they lose N life and you draw a card", for three kinds. Only that exact shape.
 */
function sacrificeRepeatForTwoMore(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const steps = list.slice(i, i + 6);
  if (steps.length !== 6) return null;
  const kinds: ObjectFilter[] = [];
  let who: unknown;
  let life: unknown;
  for (let k = 0; k < 3; k++) {
    const [a, b] = [steps[2 * k]!, steps[2 * k + 1]!];
    if (a.op !== 'sacrificeChoice' || !onlyKeys(a, ['op', 'who', 'filter', 'count', 'as']) || a.count !== 1 || typeof a.as !== 'string' || a.filter === undefined) return null;
    if (b.op !== 'if' || !onlyKeys(b, ['op', 'cond', 'then']) || !same(b.cond, { cond: 'did', step: a.as, not: true }) || b.then.length !== 2) return null;
    const [l, d] = b.then as [EffectStep, EffectStep];
    if (l.op !== 'loseLife' || !onlyKeys(l, ['op', 'who', 'amount']) || !same(l.who, a.who) || d.op !== 'draw' || !onlyKeys(d, ['op', 'who', 'count']) || !same(d.who, YOU) || d.count !== 1) return null;
    if (k === 0) { who = a.who; life = l.amount; } else if (!same(a.who, who) || !same(l.amount, life)) return null;
    if (list.slice(i + 6).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`) || JSON.stringify(x).includes(`"step":"${a.as}"`))) return null;
    kinds.push(a.filter);
  }
  if (typeof life !== 'number' || (who as { ref?: string }).ref !== 'target') return null;
  const kind = (f: ObjectFilter): string => K.np(f, st, { det: 'a' });
  const p = K.player(who as never, st, 'subject').text;
  const text = `${p} sacrifices ${kind(kinds[0]!)} of their choice. if they can't, they lose ${life} life and you draw a card. then repeat this process for ${kind(kinds[1]!)} and ${kind(kinds[2]!)}`;
  return { clauses: [plain(text, { standalone: true })], consumed: 6 };
}

/**
 * `maySacrificeRevealLesser` (CR 701.21a, 701.20a, 202.3, 608.2c, 608.2h; Kethek, Crucible Goliath, eff.edhn144.maySacrifice.revealUntil.lesserMv.rest): "you may sacrifice another creature. If
 * you do, reveal cards from the top of your library until you reveal a nonlegendary creature card with lesser mana value, put it onto the battlefield, then put the rest on the bottom of
 * your library in a random order.": an optional payment of a sacrifice of one other permanent of a kind, then a reveal until a card of a description whose mana value is less than the
 * sacrificed one's (as it last existed), that card onto the battlefield and the other revealed cards to the bottom in a random order. Only that exact shape.
 */
function maySacrificeRevealLesser(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const p = list[i];
  if (p?.op !== 'pay' || !onlyKeys(p, ['op', 'who', 'cost', 'then']) || !same(p.who, YOU) || Object.keys(p.cost).join() !== 'other' || p.cost.other?.length !== 1 || p.then?.length !== 3) return null;
  const sac = p.cost.other[0]!;
  if (sac.kind !== 'sacrifice' || sac.count !== 1 || !onlyKeys(sac, ['kind', 'filter', 'count']) || !onlyKeys(sac.filter, ['anyOf', 'not']) || sac.filter.anyOf?.length !== 1 || !same(sac.filter.not, { self: true })) return null;
  const [r, m, rest] = p.then as [EffectStep, EffectStep, EffectStep];
  if (r.op !== 'revealUntil' || !onlyKeys(r, ['op', 'who', 'filter', 'as', 'revealed']) || !same(r.who, YOU) || typeof r.as !== 'string' || typeof r.revealed !== 'string') return null;
  const { manaValue, ...desc } = r.filter as ObjectFilter & { manaValue?: unknown };
  if (!same(manaValue, { op: '<', value: { q: 'stat', stat: 'manaValue', of: { ref: 'costSacrificed' } } })) return null;
  if (m.op !== 'move' || !onlyKeys(m, ['op', 'what', 'to']) || !same(m.what, bound(r.as)) || !same(m.to, { zone: 'battlefield', controller: YOU })) return null;
  if (rest.op !== 'move' || !onlyKeys(rest, ['op', 'what', 'to']) || !same(rest.to, { zone: 'library', position: 'bottom', order: 'random' })) return null;
  if (!same(rest.what, { ref: 'each', filter: { is: bound(r.revealed), not: { is: bound(r.as) }, zone: 'library' } })) return null;
  if (list.slice(i + 1).some((x) => JSON.stringify(x).includes(`"name":"${r.as}"`) || JSON.stringify(x).includes(`"name":"${r.revealed}"`))) return null;
  const kind = K.np(sac.filter.anyOf[0]!, st, { det: 'none' });
  const card = K.np({ ...desc, zone: 'library' }, st, { det: 'a', noZone: true });
  const text = `you may sacrifice another ${kind}. if you do, reveal cards from the top of your library until you reveal ${card} with lesser mana value, put it onto the battlefield, `
    + 'then put the rest on the bottom of your library in a random order';
  return { clauses: [acting('you', text, `you ${text}`, { standalone: true, closesScope: true })], consumed: 1 };
}

export function foldEdhN144(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return revealChooseAndOr(list, i, st) ?? damagePowerOfBeheld(list, i, st) ?? sacrificeRepeatForTwoMore(list, i, st) ?? maySacrificeRevealLesser(list, i, st);
}
