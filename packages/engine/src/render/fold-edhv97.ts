/**
 * edh-c-97 (coordinator C, EDHREC ranks 20,001-20,500, third pass): the folds of its templates, called from render/fold.ts#foldAt.
 *
 * `tokenThenDamageX` (CR 107.3, 608.2h, 111.1, 120.3; Chainer's Torment): "Create an X/X black Nightmare Horror creature token, where X is half your life total,
 * rounded up. It deals X damage to you.": the X the token's size defines with "where X is" is also the X of the damage the token deals in the sentence right after
 * it (the one computed number both use; the token is a creature, so it deals the damage, CR 120.3). The same two steps are also said with the amount in full.
 * Only a token creation of an X/X token followed by that token's damage to you; the plain wording stays a reading (family where-x-then-damage-x).
 */
import type { EffectStep } from '../types/ability';
import { cloneState } from './state';
import type { RenderState } from './state';
import { K } from './kernel';
import type { Folded } from './fold';
import { alt } from './text';
import { plain } from './clause';

/**
 * `putHitShuffleRest` (CR 701.20a-b, 701.24a, 401.3, 608.2c; eff.edhv97.put.revealedHit.shuffleRest; Thicket Elemental): "Put that card onto the battlefield and shuffle all
 * other cards revealed this way into your library.": the card a reveal-until stopped at goes onto the battlefield under your control; the other revealed cards are still
 * in the library, so shuffling them into it is shuffling the library. Only a move of that one card (a binding of `revealUntil`) to the battlefield under your control, then
 * your shuffle (the plain wording, "put it onto the battlefield and shuffle", stays a reading; family reveal-hit-shuffle-rest).
 */
function putHitShuffleRest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  const sh = list[i + 1];
  if (m?.op !== 'move' || sh?.op !== 'shuffle' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  if (sh.guard !== undefined || sh.as !== undefined || sh.ifSearched !== undefined || sh.who.ref !== 'you' || m.what.ref !== 'bound') return null;
  if (Object.keys(m).sort().join(',') !== 'op,to,what' || JSON.stringify(m.to) !== '{"zone":"battlefield","controller":{"ref":"you"}}') return null;
  if (st.info.get(`b:${m.what.name}`)?.revealedUntilHit !== true) return null;
  const plainFirst = K.clause(m, cloneState(st));
  const plainSecond = K.clause(sh, cloneState(st));
  const text = alt(`${plainFirst.imp}. ${plainSecond.imp.charAt(0).toUpperCase()}${plainSecond.imp.slice(1)}`, 'put that card onto the battlefield and shuffle all other cards revealed this way into your library');
  return { clauses: [plain(text, { standalone: true })], consumed: 2 };
}

export function foldEdhV97(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return tokenThenDamageX(list, i, st) ?? putHitShuffleRest(list, i, st);
}

function tokenThenDamageX(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'createToken' || b?.op !== 'damage' || a.guard !== undefined || b.guard !== undefined || a.as === undefined || b.as !== undefined) return null;
  const p = a.token.power;
  const t = a.token.toughness;
  if (typeof p !== 'object' || p === null || typeof t !== 'object' || t === null || JSON.stringify(p) !== JSON.stringify(t)) return null;
  if (['X', 'var', 'eventAmount', 'resultCount', 'ask', 'live'].includes((p as { q: string }).q)) return null;
  if (JSON.stringify(b.amount) !== JSON.stringify(p) || JSON.stringify(b.source) !== JSON.stringify({ ref: 'bound', name: a.as }) || b.to.ref !== 'you') return null;
  const first = K.clause(a, st);
  const plainSecond = K.clause(b, cloneState(st));
  const second = K.clause({ ...b, amount: { q: 'X' } } as EffectStep, st);
  const [imp, sub] = (['imp', 'sub'] as const).map((k) => alt(plainSecond[k], second[k])) as [string, string]; // one reviewed group (family where-x-then-damage-x)
  return { clauses: [first, { ...second, imp, sub }], consumed: 2 };
}
