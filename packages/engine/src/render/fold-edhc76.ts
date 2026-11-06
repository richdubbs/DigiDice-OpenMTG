/**
 * edh-c-76 (Commander EDHREC ranks 23,001-23,500, third pass): the folds of its templates (parser/templates/zz-cloud/edh-c-76.json), called from render/fold.ts#foldAt.
 * Each applies only when every part is exactly what the idiom says.
 *
 * `chooseOneDiscardRest` (CR 608.2d, 701.9a; Monomania, eff.edhv76.player.choosesCardInHand.discardsRest): "Target player chooses a card in their hand and discards the
 * rest.": the player chooses exactly one card of their own hand (`chooseObjects`, no other field) and discards the whole hand but that card (`discard` of `hand` with the
 * filter "not the chosen card"). Exactly those two steps, the chosen card named by nothing but the discard.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function chooseOneDiscardRest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'forEach' || f.guard !== undefined || f.as !== 'chooser' || f.gather !== undefined || f.do.length !== 2) return null;
  const [c, d] = f.do;
  const it = { ref: 'iterating' };
  if (c?.op !== 'chooseObjects' || d?.op !== 'discard' || c.guard !== undefined || d.guard !== undefined || c.random !== undefined || c.groupLimit !== undefined || c.link !== undefined || c.perPlayer !== undefined) return null;
  if (c.min !== 1 || c.max !== 1 || c.from.ref !== 'each' || !same(c.who, it) || !same(c.from.filter, { zone: 'hand', owner: it })) return null;
  if (!same(d.who, it) || d.count !== 'hand' || d.mode !== undefined || d.cantAs !== undefined || d.as !== undefined) return null;
  if (!same(d.filter, { not: { is: { ref: 'bound', name: c.as } } })) return null;
  const subj = K.player(f.over as never, st, 'subject');
  return { clauses: [plain(`${subj.text} chooses a card in their hand and discards the rest`)], consumed: 1 };
}

/**
 * `eachCantCastTheirNextTurn` (CR 611.2a, 601.3, 101.2; Sphinx's Decree, eff.edhv76.player.cantCast.filter.thatPlayersNextTurn): a forEach over some players, each getting a lasting ban
 * on casting spells of a description during THEIR OWN next turn (`duringNextTurn` with `whose` the iterating player): "Each opponent can't cast instant or sorcery spells during that
 * player's next turn." The ban is written as the same restriction on the players of the group, the duration as the tail.
 */
function eachCantCastTheirNextTurn(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'forEach' || s.guard !== undefined || s.as === undefined || s.gather !== undefined || s.do.length !== 1) return null;
  const [e] = s.do;
  if (e?.op !== 'effect' || e.guard !== undefined || e.as !== undefined || e.effects.length !== 1) return null;
  if (!same(e.duration, { d: 'duringNextTurn', whose: { ref: 'iterating' } })) return null;
  const r = e.effects[0]!;
  if (r.s !== 'restrict' || r.mode !== 'cant' || r.action !== 'cast' || r.other === undefined || !same(r.subject, { ref: 'iterating' }) || !Object.keys(r).every((k) => ['s', 'subject', 'mode', 'action', 'other'].includes(k))) return null;
  const ban = K.staticEffect({ ...r, subject: s.over as never }, st);
  return { clauses: [plain(`${ban} during that player's next turn`, { standalone: true })], consumed: 1 };
}

/**
 * `exileBattlefieldAndGraveyards` (CR 406.1, 400.3, 608.2c; Shadows' Verdict): "Exile all creatures and planeswalkers with mana value 3 or less from the battlefield and all creature and
 * planeswalker cards with mana value 3 or less from all graveyards.": one exile of two sets of the same description, the permanents on the battlefield and the cards of every graveyard
 * (a `move` to exile of a `union` of two `each` references that differ only in the zone, the second of cards). Exactly that shape.
 */
function exileBattlefieldAndGraveyards(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'move' || s.guard !== undefined || s.as !== undefined || s.until !== undefined || s.link !== undefined || s.remember !== undefined || !same(s.to, { zone: 'exile' })) return null;
  if (s.what.ref !== 'union' || s.what.of.length !== 2) return null;
  const [a, b] = s.what.of;
  if (a?.ref !== 'each' || b?.ref !== 'each' || !('filter' in a) || !('filter' in b)) return null;
  const { zone: za, ...ra } = a.filter;
  const { zone: zb, isCard, ...rb } = b.filter;
  if (za !== 'battlefield' || zb !== 'graveyard' || isCard !== true || !same(ra, rb) || ra.types === undefined || ra.types.length < 2) return null;
  const onBattlefield = K.np(a.filter, st, { det: 'all', plural: true, noZone: true });
  const inGraveyards = K.np(b.filter, st, { det: 'all', plural: true });
  return { clauses: [plain(`exile ${onBattlefield} from the battlefield and ${inGraveyards}`)], consumed: 1 };
}

export function foldEdhC76(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return chooseOneDiscardRest(list, i, st) ?? eachCantCastTheirNextTurn(list, i, st) ?? exileBattlefieldAndGraveyards(list, i, st);
}
