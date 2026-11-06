/**
 * edh-d-23 (Commander coordinator D, lane dig): the folds of its templates (parser/templates/zz-cloud/edh-d-23.json), called from render/fold.ts#foldAt. Each applies only
 * when every part is exactly what the idiom says.
 */
import type { EffectStep } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { groupPool, restOfGroup } from './refs';
import type { RenderState } from './state';
import { bind } from './steps-util';
import { alt, numWord } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A plain choice of exactly one card of the group looked at, by you (no other field of the step set). */
const chooseOne = (s: EffectStep | undefined): s is Extract<EffectStep, { op: 'chooseObjects' }> =>
  s?.op === 'chooseObjects' && s.as !== undefined && same(s.who, { ref: 'you' }) && s.min === 1 && s.max === 1 && s.random !== true && s.guard === undefined && s.distinct === undefined && s.groupLimit === undefined && s.perPlayer === undefined && s.startingWith === undefined;

/** A plain move of the named choice to one place. */
const moveOf = (s: EffectStep | undefined, name: string, to: unknown): boolean =>
  s?.op === 'move' && s.guard === undefined && s.as === undefined && s.until === undefined && s.link === undefined && s.remember === undefined && same(s.what, { ref: 'bound', name }) && same(s.to, to);

/**
 * `oneHandOneTopOneBottom` (CR 701.20e, 608.2c-d, 401.4; Telling Time, eff.edhd23.dig.oneHand.oneTop.oneBottom): "Put one of those cards into your hand, one on top of your
 * library, and one on the bottom of your library.": you choose one card of the group looked at for your hand, then one of the others for the top of your library; the last
 * one (the rest of the group) goes on the bottom. Only that exact shape, with nothing after it reading the choices.
 */
function oneHandOneTopOneBottom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, m1, b, m2, m3] = [list[i], list[i + 1], list[i + 2], list[i + 3], list[i + 4]];
  if (!chooseOne(a) || !chooseOne(b) || m3?.op !== 'move' || m3.guard !== undefined || m3.as !== undefined || m3.until !== undefined || m3.link !== undefined || m3.remember !== undefined) return null;
  if (!moveOf(m1, a.as!, { zone: 'hand' }) || !moveOf(m2, b.as!, { zone: 'library', position: 'top' }) || !same(m3.to, { zone: 'library', position: 'bottom' })) return null;
  const poolA = groupPool(a.from);
  if (poolA === null || poolA.desc !== null) return null;
  // the second choice is among the group less the first choice, the last move is of what both left
  const f2 = b.from.ref === 'each' ? b.from.filter : null;
  if (f2 === null || !same({ ...f2, not: undefined }, { is: poolA.group, zone: 'library', not: undefined }) || !same(f2.not, { is: { ref: 'bound', name: a.as } })) return null;
  if (m3.what.ref !== 'each') return null;
  const rest = restOfGroup(m3.what.filter);
  if (rest === null || rest.chosen !== b.as || !same(m3.what.filter.not, { is: { ref: 'union', of: [{ ref: 'bound', name: a.as }, { ref: 'bound', name: b.as }] } })) return null;
  if (list.slice(i + 5).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`) || JSON.stringify(x).includes(`"name":"${b.as}"`))) return null;
  const them = K.obj(poolA.group, st, 'object');
  if (!them.plural) return null;
  const text = `put one of ${them.text} into your hand, one on top of your library, and one on the bottom of your library`;
  bind(st, a.as!, { nouns: ['card'], plural: false });
  bind(st, b.as!, { nouns: ['card'], plural: false });
  return { clauses: [acting('you', text, `you ${text}`, { closesScope: true })], consumed: 5 };
}

/** The steps "exile any number of the group" and "put the rest back" that both exile-any templates build (the choice, its exile, the move of the rest); null when the shape differs. */
function exileAnyAndRest(list: EffectStep[], i: number, group: string | null): { a: Extract<EffectStep, { op: 'chooseObjects' }>; groupRef: unknown; arranged: boolean } | null {
  const [a, m1, m2] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'chooseObjects' || a.as === undefined || !same(a.who, { ref: 'you' }) || a.min !== 0 || a.max !== 'any') return null;
  if (a.random === true || a.guard !== undefined || a.distinct !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined) return null;
  if (!moveOf(m1, a.as, { zone: 'exile' }) || m2?.op !== 'move' || m2.guard !== undefined || m2.as !== undefined || m2.until !== undefined || m2.link !== undefined || m2.remember !== undefined) return null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc !== null || pool.group.ref !== 'bound' || (group !== null && pool.group.name !== group)) return null;
  if (m2.what.ref !== 'each') return null;
  const rest = restOfGroup(m2.what.filter);
  if (rest === null || rest.chosen !== a.as || rest.group !== pool.group.name) return null;
  const arranged = same(m2.to, { zone: 'library', position: 'top', order: 'chosen', arrangedBy: { ref: 'you' } });
  if (!arranged && !same(m2.to, { zone: 'library', position: 'top', order: 'chosen' })) return null;
  const gname = pool.group.name;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`) || JSON.stringify(x).includes(`"name":"${gname}"`))) return null;
  return { a, groupRef: pool.group, arranged };
}

/**
 * `exileAnyRestBack` (CR 701.20e, 608.2c-d, 401.4, 406.1; Dimir Machinations, eff.edhd23.dig.exileAny.restBackAnyOrder): after a look at the top cards of a library, "Exile any
 * number of those cards, then put the rest back in any order.": you choose any number (none included) of the group, exile them, and the others go back on top of that library
 * in an order YOU choose (`arrangedBy` you).
 */
function exileAnyRestBack(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const r = exileAnyAndRest(list, i, null);
  if (r === null || !r.arranged) return null;
  const them = K.obj(r.groupRef as never, st, 'object');
  if (!them.plural) return null;
  const text = `exile any number of ${them.text}, then put the rest back in any order`;
  bind(st, r.a.as!, { nouns: ['card'], plural: true });
  return { clauses: [acting('you', text, `you ${text}`, { closesScope: true })], consumed: 3 };
}

/**
 * `lookExileAnyRestTop` (CR 701.20e, 608.2c-d, 401.4, 406.1; Ancestral Knowledge, eff.edhd23.look.exileAny.restTopAnyOrder): "look at the top ten cards of your library, then exile any
 * number of them and put the rest back on top of your library in any order": the look by you at a fixed number of cards of your library, then the same three steps.
 */
function lookExileAnyRestTop(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const l = list[i];
  if (l?.op !== 'look' || l.guard !== undefined || l.as === undefined || !same(l.who, { ref: 'you' }) || l.at.ref !== 'topCards' || !same(l.at.player, { ref: 'you' }) || l.at.zone !== undefined || typeof l.at.count !== 'number') return null;
  const r = exileAnyAndRest(list, i + 1, l.as);
  if (r === null || r.arranged) return null;
  const text = `look at the top ${numWord(l.at.count)} cards of your library, then exile any number of them and put the rest back on top of your library in any order`;
  bind(st, r.a.as!, { nouns: ['card'], plural: true });
  return { clauses: [acting('you', text, `you ${text}`, { closesScope: true })], consumed: 4 };
}

/**
 * `playerPutsHitThenShufflesRest` (CR 701.20a, 701.24a, 110.2a, 400.3, 608.2c; Polymorph, Transmogrify, eff.edhd23.player.putsHit.bf.thenShufflesRest): after ANOTHER player's "reveals
 * cards from the top of their library until they reveal <a card>", "The player puts that card onto the battlefield, then shuffles all other cards revealed this way into their
 * library.": the card goes onto the battlefield under its owner's control (the library is its owner's, CR 110.2a), the other revealed cards stay in that library and the same
 * player shuffles it. Only those three steps right after the other player's reveal.
 */
function playerPutsHitThenShufflesRest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [rv, a, b, c] = [list[i - 1], list[i], list[i + 1], list[i + 2]];
  if (rv?.op !== 'revealUntil' || rv.who.ref === 'you' || rv.guard !== undefined || a?.op !== 'move' || b?.op !== 'move' || c?.op !== 'shuffle' || a.what.ref !== 'bound' || b.what.ref !== 'each') return null;
  if ([a, b, c].some((s) => s.guard !== undefined) || [a, b].some((s) => s.as !== undefined || s.until !== undefined || s.link !== undefined || s.remember !== undefined) || c.ifSearched !== undefined) return null;
  if (!same(a.to, { zone: 'battlefield', controller: 'owner' }) || !same(b.to, { zone: 'library' }) || !same(c.who, rv.who)) return null;
  const rest = restOfGroup(b.what.filter);
  if (rest === null || rest.chosen !== a.what.name || rv.as !== a.what.name) return null;
  const that = K.obj(a.what, st, 'object');
  const restText = K.obj(b.what, st, 'object').text;
  const text = `puts ${that.text} onto the battlefield, then shuffles ${alt(restText, 'all other cards revealed this way')} into their library`;
  const sub = alt(`the player ${text}`, `that player ${text}`);
  return { clauses: [acting('x', sub, sub, { standalone: true })], consumed: 3 };
}

/**
 * `revealUpToOneTopRestBottom` (CR 701.20a, 701.20e, 608.2c-d, 401.4; Planar Atlas, Fertile Thicket, eff.edhd23.dig.revealUpToOne.topRestBottom*): "Reveal up to one land card from among
 * them, then put that card on top of your library and the rest on the bottom in a random order (in any order).": you choose at most one card of a description among the group
 * looked at, reveal it, put it on top and the others of the group on the bottom. Only that exact shape, with nothing after it reading the choice.
 */
function revealUpToOneTopRestBottom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, r, m, n] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (a?.op !== 'chooseObjects' || r?.op !== 'reveal' || m?.op !== 'move' || n?.op !== 'move' || a.as === undefined || !same(a.who, { ref: 'you' }) || a.min !== 0 || a.max !== 1) return null;
  if (a.random === true || a.guard !== undefined || a.distinct !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined) return null;
  if (r.guard !== undefined || r.as !== undefined || !same(r.who, { ref: 'you' }) || !same(r.what, { ref: 'bound', name: a.as }) || (r.to !== undefined && r.to !== 'all')) return null;
  if (!moveOf(m, a.as, { zone: 'library', position: 'top' }) || n.guard !== undefined || n.as !== undefined || n.until !== undefined || n.link !== undefined || n.remember !== undefined) return null;
  const order = same(n.to, { zone: 'library', position: 'bottom', order: 'random' }) ? 'a random order' : same(n.to, { zone: 'library', position: 'bottom', order: 'chosen' }) ? 'any order' : null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc === null || order === null || n.what.ref !== 'each') return null;
  if (restOfGroup(n.what.filter)?.chosen !== a.as || n.what.filter.is?.ref !== 'bound' || n.what.filter.is.name !== (pool.group as { name: string }).name) return null;
  if (list.slice(i + 4).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null;
  const them = K.obj(pool.group, st, 'object');
  if (!them.plural) return null;
  const np = K.np({ ...pool.desc, zone: 'library' }, st, { det: 'none', noZone: true });
  const text = `reveal up to one ${np} from among ${them.text}, then put that card on top of your library and the rest on the bottom in ${order}`;
  bind(st, a.as, { nouns: ['card'], plural: false });
  return { clauses: [acting('you', text, `you ${text}`, { closesScope: true })], consumed: 4 };
}

/** The cards of a group a choice left, moved to the bottom of the library in the order its player chooses: the last step of both folds below. */
function restToBottomAny(n: EffectStep | undefined, group: string, chosen: string): n is Extract<EffectStep, { op: 'move' }> {
  if (n?.op !== 'move' || n.guard !== undefined || n.as !== undefined || n.until !== undefined || n.link !== undefined || n.remember !== undefined || n.what.ref !== 'each') return false;
  const rest = restOfGroup(n.what.filter);
  return rest !== null && rest.group === group && rest.chosen === chosen && same(n.to, { zone: 'library', position: 'bottom', order: 'chosen' });
}

/**
 * `putOneTopRestBottomAny` (CR 701.20e, 608.2c-d, 401.4; Cream of the Crop, eff.edhd23.dig.putOne.top.restBottomAny): "Put one of those cards on top of your library and the rest on the
 * bottom of your library in any order.": you choose exactly one card of the group looked at, it goes on top, the others on the bottom in the order you choose.
 */
function putOneTopRestBottomAny(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, m, n] = [list[i], list[i + 1], list[i + 2]];
  if (!chooseOne(a) || !moveOf(m, a.as!, { zone: 'library', position: 'top' })) return null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc !== null || pool.group.ref !== 'bound' || !restToBottomAny(n, pool.group.name, a.as!)) return null;
  const gname = pool.group.name;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`) || JSON.stringify(x).includes(`"name":"${gname}"`))) return null;
  const them = K.obj(pool.group, st, 'object');
  if (!them.plural) return null;
  const text = `put one of ${them.text} on top of your library and the rest on the bottom of your library in any order`;
  bind(st, a.as!, { nouns: ['card'], plural: false });
  return { clauses: [acting('you', text, `you ${text}`, { closesScope: true })], consumed: 3 };
}

/**
 * `revealAnyTopRestBottomAny` (CR 701.20a, 701.20e, 608.2c-d, 401.4; Munda, Ambush Leader, eff.edhd23.dig.revealAny.topRestBottomAny): "Reveal any number of Ally cards from among them,
 * then put those cards on top of your library in any order and the rest on the bottom in any order.": you choose any number (none included) of the described cards among the
 * group looked at, reveal them, put them on top in the order you choose and the others of the group on the bottom in the order you choose.
 */
function revealAnyTopRestBottomAny(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, r, m, n] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (a?.op !== 'chooseObjects' || r?.op !== 'reveal' || a.as === undefined || !same(a.who, { ref: 'you' }) || a.min !== 0 || a.max !== 'any') return null;
  if (a.random === true || a.guard !== undefined || a.distinct !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined) return null;
  if (r.guard !== undefined || r.as !== undefined || !same(r.who, { ref: 'you' }) || !same(r.what, { ref: 'bound', name: a.as }) || (r.to !== undefined && r.to !== 'all')) return null;
  if (!moveOf(m, a.as, { zone: 'library', position: 'top', order: 'chosen' })) return null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc === null || pool.group.ref !== 'bound' || !restToBottomAny(n, pool.group.name, a.as)) return null;
  if (list.slice(i + 4).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null;
  const them = K.obj(pool.group, st, 'object');
  if (!them.plural) return null;
  const np = K.np({ ...pool.desc, zone: 'library' }, st, { det: 'none', plural: true, noZone: true });
  const text = `reveal any number of ${np} from among ${them.text}, then put those cards on top of your library in any order and the rest on the bottom in any order`;
  bind(st, a.as, { nouns: ['card'], plural: true });
  return { clauses: [acting('you', text, `you ${text}`, { closesScope: true })], consumed: 4 };
}

export function foldEdhD23(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return oneHandOneTopOneBottom(list, i, st) ?? exileAnyRestBack(list, i, st) ?? playerPutsHitThenShufflesRest(list, i, st) ?? revealUpToOneTopRestBottom(list, i, st) ?? putOneTopRestBottomAny(list, i, st) ?? revealAnyTopRestBottomAny(list, i, st) ?? lookExileAnyRestTop(list, i, st);
}
