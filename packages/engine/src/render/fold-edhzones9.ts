/**
 * edh-zones-9 (Commander lane edh-zones): the folds of its templates (parser/templates/zz-cloud/edh-zones-9.json), called from render/fold.ts#foldAt. Each applies only
 * when every part is exactly what the idiom says.
 *
 * `eachPlayerPutsOneFromGraveyard` (CR 101.4, 608.2d, 608.2e, 110.2a, 400.7; Exhume): "Each player puts a creature card from their graveyard onto the battlefield.": each
 * player in APNAP order chooses exactly one of the described cards in their own graveyard (fewer when there is none), then every card chosen is put onto the battlefield
 * at the same time under its owner's control (the player who put it). Exactly the two steps of template eff.edhz9.eachPlayer.putFromGraveyard.bf.
 */
import type { EffectStep } from '../types/ability';
import { acting, plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const ITERATING = { ref: 'iterating' };

function eachPlayerPutsOneFromGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.guard !== undefined || a.random !== undefined || a.groupLimit !== undefined || a.startingWith !== undefined || a.min !== a.max || typeof a.min !== 'number' || a.min < 1) return null; // edh-d-7: exactly N (N = 1: "puts a"; more: "returns N ... to the battlefield")
  if (!same(a.who, ITERATING) || !same(a.perPlayer, { ref: 'each', who: 'player' }) || a.from.ref !== 'each') return null;
  const f = a.from.filter;
  if (f.anyOf?.length !== 1 || f.zone !== 'graveyard' || !same(f.owner, ITERATING) || f.isCard !== true || Object.keys(f).some((k) => !['anyOf', 'zone', 'owner', 'isCard'].includes(k))) return null;
  if (b?.op !== 'move' || b.guard !== undefined || b.as !== undefined || b.until !== undefined || b.link !== undefined || !same(b.what, { ref: 'bound', name: a.as })) return null;
  if (!same(b.to, { zone: 'battlefield', controller: 'owner' })) return null;
  if (a.as === undefined || list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"${a.as}"`))) return null;
  const kind = f.anyOf[0]!;
  bind(st, a.as, { nouns: [...K.nounsOf(kind), 'card'], plural: true });
  if (a.min !== 1) {
    // edh-d-7 (CR 101.4, 608.2d; Fall of the Thran): "Each player returns two land cards from their graveyard to the battlefield."
    const cards = K.np({ ...kind, isCard: true, zone: 'graveyard' }, st, { det: 'none', plural: true, noZone: true });
    return { clauses: [plain(`each player returns ${a.min} ${cards} from their graveyard to the battlefield`, { standalone: true })], consumed: 2 };
  }
  const card = K.np({ ...kind, isCard: true, zone: 'graveyard' }, st, { det: 'a', noZone: true });
  return { clauses: [plain(`each player puts ${card} from their graveyard onto the battlefield`, { standalone: true })], consumed: 2 };
}

/**
 * `chooseRandomGraveyardSort` (CR 608.2d, 404.1, 400.7, 700.2 (random choice); Deadbridge Chant): "Choose a card at random in your graveyard. If it's a creature card, put it onto
 * the battlefield. Otherwise, put it into your hand.": one card of your graveyard chosen at random (no player decides), then a creature card goes onto the battlefield under
 * your control and any other card to your hand. Only that exact shape: a random choice of exactly one card of any description in your own graveyard, the `if` on one card type of
 * that card with the move onto the battlefield (you control it) as `then` and the move into a hand as `else`, and the name used by nothing after.
 */
function chooseRandomGraveyardSort(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.guard !== undefined || a.random !== true || a.min !== 1 || a.max !== 1 || a.as === undefined || a.groupLimit !== undefined || a.perPlayer !== undefined
    || a.startingWith !== undefined || a.eachCardType !== undefined || a.link !== undefined || a.distinct !== undefined || a.damageSource !== undefined || !same(a.who, { ref: 'you' })) return null;
  if (a.from.ref !== 'each' || !same(a.from.filter, { zone: 'graveyard', owner: 'you', isCard: true })) return null;
  if (b?.op !== 'if' || b.guard !== undefined || b.intervening !== undefined || b.cond.cond !== 'matches' || !same(b.cond.object, { ref: 'bound', name: a.as })) return null;
  const types = b.cond.filter.types;
  if (types?.length !== 1 || !same(b.cond.filter, { types, isCard: true })) return null;
  const [t, e] = [b.then, b.else];
  if (t.length !== 1 || e?.length !== 1) return null;
  const [mt, me] = [t[0]!, e[0]!];
  if (mt.op !== 'move' || me.op !== 'move' || mt.guard !== undefined || me.guard !== undefined || mt.as !== undefined || me.as !== undefined || mt.until !== undefined || me.until !== undefined) return null;
  if (mt.link !== undefined || me.link !== undefined || mt.remember !== undefined || me.remember !== undefined) return null;
  if (!same(mt.what, { ref: 'bound', name: a.as }) || !same(me.what, { ref: 'bound', name: a.as })) return null;
  if (!same(mt.to, { zone: 'battlefield', controller: { ref: 'you' } }) || !same(me.to, { zone: 'hand' })) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"${a.as}"`))) return null;
  bind(st, a.as, { nouns: ['card'], plural: false, zone: 'graveyard' });
  return { clauses: [plain(`choose 1 card at random in your graveyard. if it is 1 ${types[0]!.toLowerCase()} card, put it onto the battlefield. otherwise, put it into your hand`, { standalone: true })], consumed: 2 };
}

/**
 * `linkedPutAll` (CR 607.2a, 110.2, 400.7; Gisa, Glorious Resurrector): "Put all creature cards exiled with ~ onto the battlefield under your control.": every card of one kind
 * that the object's linked ability exiled, still in exile, enters under the controller's control (the pronoun of the next sentence is that group, bound under the move's `as`).
 * Exactly the one `move` of template eff.edhz9.linked.putAll.bf.
 */
function linkedPutAll(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'move' || a.guard !== undefined || a.until !== undefined || a.link !== undefined || a.remember !== undefined || a.what.ref !== 'each' || !('filter' in a.what)) return null;
  const f = a.what.filter;
  const kinds = f.anyOf;
  if (!same(f.is, { ref: 'linked', link: 'exiled' }) || f.zone !== 'any' || f.isCard !== true || kinds?.length !== 1 || Object.keys(f).some((k) => !['is', 'zone', 'isCard', 'anyOf'].includes(k))) return null;
  if (!same(a.to, { zone: 'battlefield', controller: { ref: 'you' } })) return null;
  const card = K.np(kinds[0]!, st, { det: 'none' });
  const self = K.obj({ ref: 'self' }, st, 'object').text;
  if (a.as !== undefined) bind(st, a.as, { nouns: [...K.nounsOf(kinds[0]!), 'card'], plural: true });
  const text = `put all ${card} cards exiled with ${self} onto the battlefield under your control`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 1 };
}

/** The folds of edh-zones-9 (render/fold.ts#foldAt). */
export function foldEdhZones9(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachPlayerPutsOneFromGraveyard(list, i, st) ?? chooseRandomGraveyardSort(list, i, st) ?? linkedPutAll(list, i, st);
}
