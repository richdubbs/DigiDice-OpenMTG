/**
 * edh-next-126 (must-finish round: library, manifest and the rest): the folds of its templates (parser/templates/zz-cloud/edh-next-126.json), called from render/fold.ts#foldAt.
 * Each applies only when every part is exactly what the idiom says.
 */
import type { EffectStep } from '../types/ability';
import { acting, plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const YOU = { ref: 'you' };

/** A plain look by you at the top cards of your own library, named `as` (with `rebind` only when asked). */
function topLook(s: EffectStep | undefined, rebind: boolean): s is Extract<EffectStep, { op: 'look' }> {
  return s?.op === 'look' && s.guard === undefined && typeof s.as === 'string' && same(s.who, YOU) && s.at.ref === 'topCards' && same(s.at.player, YOU)
    && Object.keys(s.at).sort().join() === 'count,player,ref' && (s.rebind === true) === rebind;
}

/** A plain move of the named group to the top or bottom of its owner's library, in an order its owner chooses. */
const moveTo = (s: EffectStep | undefined, name: string, position: 'top' | 'bottom'): boolean =>
  s?.op === 'move' && s.guard === undefined && s.as === undefined && s.until === undefined && s.link === undefined && s.remember === undefined
  && same(s.what, { ref: 'bound', name }) && same(s.to, { zone: 'library', position, order: 'chosen' });

/**
 * `lookPayBottomRepeat` (CR 608.2c, 608.2d, 119.4, 401.4, 701.24a; Lim-Dûl's Vault, eff.edhn126.vault.lookPayBottomRepeat): "Look at the top five cards of your library. As many
 * times as you choose, you may pay 1 life, put those cards on the bottom of your library in any order, then look at the top five cards of your library. Then shuffle and put the
 * last cards you looked at this way on top in any order.": the group the first look names is named again by the look of each run (`rebind`), only when the life is paid; the
 * shuffle and the last move come after the repeat. Only that exact shape.
 */
function lookPayBottomRepeat(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, r, sh, m] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (!topLook(a, false) || r?.op !== 'repeat' || sh?.op !== 'shuffle' || m === undefined) return null;
  const name = a.as!;
  if (r.optional !== true || r.times !== 1 || r.until !== undefined || r.again === true || r.process === true || r.guard !== undefined || r.as !== undefined || r.gather !== undefined || r.do.length !== 1) return null;
  const p = r.do[0]!;
  if (p.op !== 'pay' || p.mandatory !== true || p.else !== undefined || p.times !== undefined || p.guard !== undefined || p.as !== undefined || p.upTo !== undefined || p.anyAmount === true
    || p.everyPlayer === true || p.reduceBy !== undefined || p.xMax !== undefined || p.startingWith !== undefined || !same(p.who, YOU)) return null;
  if (Object.keys(p.cost).join() !== 'other' || p.cost.other?.length !== 1 || p.cost.other[0]!.kind !== 'payLife') return null;
  const then = p.then ?? [];
  if (then.length !== 2 || !moveTo(then[0], name, 'bottom') || !topLook(then[1], true) || then[1].as !== name) return null;
  if (sh.guard !== undefined || sh.ifSearched === true || !same(sh.who, YOU) || !moveTo(m, name, 'top')) return null;
  if (list.slice(i + 4).some((x) => JSON.stringify(x).includes(`"name":"${name}"`))) return null;
  const again = then[1] as Extract<EffectStep, { op: 'look' }>;
  if (a.at.ref !== 'topCards' || again.at.ref !== 'topCards') return null;
  const n = K.qty(a.at.count, st);
  const k = K.qty(again.at.count, st);
  const text = `look at the top ${n} cards of your library. as many times as you choose, you may ${K.costVerbs(p.cost, st, 'you')}, put those cards on the bottom of your library in any order, `
    + `then look at the top ${k} cards of your library. then shuffle and put the last cards you looked at this way on top in any order`;
  bind(st, name, { nouns: ['card'], plural: true, zone: 'library' });
  return { clauses: [acting('you', text, `you ${text}`, { standalone: true, closesScope: true })], consumed: 4 };
}

const MANIFESTED = 'edhn126Manifested';
const ITERATING = { ref: 'iterating' };

/**
 * `eachManifestFromHand` (CR 701.40a, 701.40e, 608.2c, 608.2f; Kozilek, the Broken Reality, eff.edhn126.players.eachManifestFromHand and eff.edhn126.draw.forEachManifestedThisWay):
 * "Up to two target players each manifest two cards from their hands. For each card manifested this way, you draw a card.": for each of the players in turn, that player chooses that
 * many cards of their own hand and manifests them; the cards of every player are gathered ("manifested this way"), and the draw that follows counts them. Only that exact shape.
 */
function eachManifestFromHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [f, d] = [list[i], list[i + 1]];
  if (f?.op !== 'forEach' || f.gather !== MANIFESTED || f.guard !== undefined || f.inDirection !== undefined || f.do.length !== 2 || f.over.ref !== 'target') return null;
  const [c, m] = f.do;
  if (c?.op !== 'chooseObjects' || c.as !== MANIFESTED || !same(c.who, ITERATING) || c.guard !== undefined || c.random === true || c.perPlayer !== undefined || c.startingWith !== undefined
    || c.distinct !== undefined || c.groupLimit !== undefined || !same(c.min, c.max) || typeof c.min !== 'number'
    || !same(c.from, { ref: 'each', filter: { zone: 'hand', owner: ITERATING, isCard: true } })) return null;
  if (m?.op !== 'action' || m.action !== 'manifest' || m.guard !== undefined || m.as !== undefined || !same(m.who, ITERATING) || !same(m.subject, { ref: 'bound', name: MANIFESTED })
    || Object.keys(m).some((k) => !['op', 'action', 'who', 'subject'].includes(k))) return null;
  const spec = st.specs.get(f.over.id);
  if (spec?.kind !== 'player' || spec.max === 1) return null;
  const draws = d?.op === 'draw' && d.guard === undefined && d.as === undefined && same(d.who, YOU) && same(d.count, { q: 'count', of: { ref: 'bound', name: MANIFESTED } })
    && Object.keys(d).every((k) => k === 'op' || k === 'who' || k === 'count');
  if (list.slice(i + (draws ? 2 : 1)).some((x) => JSON.stringify(x).includes(`"name":"${MANIFESTED}"`))) return null;
  const players = K.player(f.over, st, 'subject').text;
  const text = `${players} each manifest ${K.qty(c.min, st)} cards from their hands${draws ? '. for each card manifested this way, you draw a card' : ''}`;
  bind(st, MANIFESTED, { nouns: ['card'], plural: true });
  return { clauses: [plain(text, { standalone: true })], consumed: draws ? 2 : 1 };
}

export function foldEdhN126(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return lookPayBottomRepeat(list, i, st) ?? eachManifestFromHand(list, i, st);
}
