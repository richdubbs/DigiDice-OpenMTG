/**
 * trek-17 (lane trek, Star Trek): the folds of its templates (parser/templates/zz-cloud/trek-17.json), called from render/fold.ts#foldAt. Each applies only when every part is
 * exactly what the idiom says.
 *
 * `ownerDrawsThenShuffles` (CR 121.1, 701.24a, 400.3, 108.3; Unification): "The owner of up to one target creature draws two cards, then shuffles that creature into their
 * library.": the owner of one targeted object draws, then that object goes into its owner's library and that library is shuffled. Oracle names the owner by the object ("the owner
 * of ...") and says the object again; one sentence. Exactly the three steps of template eff.trek17.player.draws.thenShufflesIntoLibrary for the owner of a target.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { bind, byPlayer, countedNoun } from './steps-util';
import { countParts } from './qty';
import { withArticle } from './text';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function ownerDrawsThenShuffles(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [d, m, s] = [list[i], list[i + 1], list[i + 2]];
  if (d?.op !== 'draw' || m?.op !== 'move' || s?.op !== 'shuffle') return null;
  if ([d, m, s].some((x) => x.guard !== undefined || x.as !== undefined) || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  const who = d.who;
  if (who.ref !== 'ownerOf' || who.object.ref !== 'target' || typeof d.count !== 'number') return null;
  if (!same(s.who, who) || !same(m.what, who.object) || m.to.zone !== 'library' || !same(m.to.owner, who) || Object.keys(m.to).length !== 2) return null;
  const named = K.obj(who.object, st, 'object').text;
  const again = K.obj(m.what, st, 'object').text;
  return { clauses: [plain(`the owner of ${named} draws ${countedNoun(d.count, 'card', st)}, then shuffles ${again} into their library`)], consumed: 3 };
}

/**
 * `playerRevealsTopThenDraws` (CR 701.20a, 121.1, 401.2; Ambassador K'Ehleyr, Alexander, Ship's Fool): "Each player reveals the top card of their library, then draws a card.": each player
 * of a group (never you: "your library") reveals the top card of their own library, then draws a card. Exactly the two steps of template eff.trek17.player.revealTop.thenDraws.
 */
function playerRevealsTopThenDraws(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [r, d] = [list[i], list[i + 1]];
  if (r?.op !== 'reveal' || d?.op !== 'draw' || r.guard !== undefined || d.guard !== undefined || d.as !== undefined || r.to !== undefined) return null;
  if (r.who.ref === 'you' || !same(d.who, r.who) || d.count !== 1) return null;
  if (r.what.ref !== 'topCards' || r.what.count !== 1 || r.what.allButBottom !== undefined || !same(r.what.player, r.who)) return null;
  const c = byPlayer(r.who, st, 'reveal', 'the top card of their library, then draws a card');
  if (r.as !== undefined) bind(st, r.as, { nouns: ['card'], plural: r.who.ref === 'each' || r.who.ref === 'target', zone: 'library', revealedTop: true, thisWay: 'revealed this way' });
  return { clauses: [c], consumed: 2 };
}

/**
 * `forEachRevealedPutCounter` (CR 122.1, 701.20a, 608.2c; Ambassador K'Ehleyr): "For each nonland card revealed this way, put a +1/+1 counter on ~.": one counter of a kind on one object
 * for each card of a description among the cards an earlier reveal showed (counted in the library or, drawn since, in a hand). Exactly the step of template eff.trek17.forEach.putCounter.
 */
function forEachRevealedPutCounter(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'putCounters' || s.guard !== undefined || s.as !== undefined || s.count === 1 || typeof s.count !== 'object' || s.count.q !== 'count') return null;
  if (s.upTo !== undefined || s.distribute !== undefined || s.kindOfChoice !== undefined || s.kind === 'any') return null;
  const f = s.count.of.ref === 'each' && 'filter' in s.count.of ? s.count.of.filter : null;
  if (f?.is?.ref !== 'bound' || st.info.get(`b:${f.is.name}`)?.thisWay !== 'revealed this way' || (f.zone !== 'any' && f.zone !== 'library')) return null; // edh-c-62: still in the library when the counters go on (Selvala's Enforcer, the draw comes after)
  const parts = countParts(s.count, st);
  if (parts === null) return null;
  const on = K.obj(s.on as never, st, 'object').text;
  return { clauses: [plain(`for each ${parts.singular}, put ${withArticle(`${s.kind} counter`)} on ${on}`, { standalone: true })], consumed: 1 };
}

/** The folds of trek-17 (render/fold.ts#foldAt). */
export function foldTrek17(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return ownerDrawsThenShuffles(list, i, st) ?? playerRevealsTopThenDraws(list, i, st) ?? forEachRevealedPutCounter(list, i, st);
}
