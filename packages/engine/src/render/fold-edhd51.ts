/**
 * edh-d-51 (Commander coordinator D, lane d-rank-1): the folds of its readings, called from render/fold.ts#foldAtPlain. A fold file never imports a value from fold.ts.
 *
 * `gainForEachExiledLead` (CR 119.3, 608.2h, 406.1; The Binding of the Titans; family lead-for-each-exiled-this-way): the life gained once for each card the instruction right before
 * exiled, said first: "For each creature card exiled this way, you gain 1 life." is also "You gain 1 life for each creature card exiled this way." (the one `gainLife` of the
 * controller, counting the objects of an earlier `move` to exile by its binding). Only a `gainLife` step that directly follows that `move`.
 */
import type { EffectStep } from '../types/ability';
import { acting, plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { countParts } from './qty';
import { restOfExiled } from './refs';
import { cloneState, type RenderState } from './state';
import { alt } from './text';

function gainForEachExiledLead(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  const prev = list[i - 1];
  if (s?.op !== 'gainLife' || prev?.op !== 'move' || s.guard !== undefined || s.as !== undefined || s.who.ref !== 'you' || prev.as === undefined || prev.to.zone !== 'exile') return null;
  if (Object.keys(s).some((k) => !['op', 'who', 'amount'].includes(k))) return null;
  const a = s.amount;
  if (typeof a !== 'object' || a.q !== 'count' || a.of.ref !== 'each') return null;
  const f = a.of.filter;
  if (f.zone !== 'exile' || (f.is as { ref?: string; name?: string } | undefined)?.ref !== 'bound' || (f.is as { name?: string }).name !== prev.as) return null;
  const before = cloneState(st);
  const parts = countParts(a, before);
  if (parts === null) return null;
  const c = K.clause(s, st);
  if (c.empty === true || c.standalone === true || c.actor !== 'you') return null;
  return { clauses: [plain(alt(c.sub, `for each ${parts.singular}, you gain 1 life`), { standalone: true })], consumed: 1 };
}

/**
 * `castFromExiledTop` (CR 608.2g, 601.2, 118.9, 305.9, 406.1; Sanwell, Avenger Ace; Herald of Amity; family cast-from-among-the-exiled-top): after "Exile the top N cards of your library",
 * "You may cast a Vehicle or artifact creature spell from among them [without paying its mana cost]": you choose up to one nonland card of that spell description among the exiled cards (a
 * land is never cast, CR 305.9) and cast it during the resolution (`free` or paying its mana cost). Only that shape: one optional choice by you, then the cast by you of exactly that card; a
 * later step may name the choice only as what "the rest" left out.
 */
function castFromExiledTop(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'cast' || a.as === undefined || a.random === true || a.who.ref !== 'you' || a.min !== 0 || a.max !== 1 || a.groupLimit !== undefined || a.guard !== undefined) return null;
  if (b.guard !== undefined || b.as !== undefined || b.who.ref !== 'you' || b.optional !== undefined || b.costChange !== undefined || b.transformed !== undefined || b.copyIn !== undefined
    || b.play !== undefined || b.anyManaType !== undefined || b.exactManaValue !== undefined || b.select !== undefined || b.maxManaValue !== undefined || b.what.ref !== 'bound' || b.what.name !== a.as) return null;
  if (b.free !== undefined && b.free !== true) return null;
  const from = a.from;
  if (from.ref !== 'each' || from.filter.zone !== 'exile' || from.filter.is?.ref !== 'bound') return null;
  const { is, zone: _zone, anyOf, notTypes, ...rest } = from.filter;
  if (Object.values(rest).some((v) => v !== undefined) || anyOf?.length !== 1 || notTypes?.length !== 1 || notTypes[0] !== 'Land') return null;
  const needle = `"name":"${a.as}"`;
  const unread = !list.slice(i + 2).some((x) => JSON.stringify(x).includes(needle) && !(x.op === 'move' && x.what.ref === 'each' && restOfExiled(x.what.filter) && (x.what.filter.not?.is as { name?: string } | undefined)?.name === a.as));
  if (!unread) return null;
  const group = K.obj(is, st, 'object');
  if (!group.plural) return null;
  const spell = K.np({ ...anyOf[0]!, stackKind: 'spell' }, st, { det: 'a' });
  const text = `you may cast ${spell} from among ${alt('them', group.text)}${b.free === true ? ' without paying its mana cost' : ''}`;
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 2 };
}

/**
 * `restOfExiledTopToBottom` (CR 608.2c, 401.4, 406.1; Sanwell, Avenger Ace; Herald of Amity): after "Exile the top N cards of your library" and a choice among them, "Then put the rest on the
 * bottom of your library in a random order." The cards the choice left in exile go to the bottom of THEIR OWNER's library, which is yours because they came off the top of your own library
 * (only when an earlier `move` of the top cards of your library bound the group). Only that move.
 */
function restOfExiledTopToBottom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  if (m?.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.what.ref !== 'each' || !restOfExiled(m.what.filter)) return null;
  if (Object.keys(m.to).sort().join(',') !== 'order,position,zone' || m.to.zone !== 'library' || m.to.position !== 'bottom' || m.to.order !== 'random') return null;
  const group = (m.what.filter.is as { name?: string } | undefined)?.name;
  const exiled = list.slice(0, i).some((x) => x.op === 'move' && x.as === group && x.what.ref === 'topCards' && x.what.player.ref === 'you' && x.what.zone === undefined && x.to.zone === 'exile');
  if (!exiled) return null;
  void st;
  const text = 'put the rest on the bottom of your library in a random order';
  return { clauses: [acting('you', text, `you ${text}`, { leadThen: true })], consumed: 1 };
}

export function foldEdhD51(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return gainForEachExiledLead(list, i, st) ?? castFromExiledTop(list, i, st) ?? restOfExiledTopToBottom(list, i, st);
}
