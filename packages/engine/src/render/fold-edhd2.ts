/**
 * Commander lane edh-d, round edh-d-2: the fold of the steps its templates build (render/fold.ts#foldAt tries `foldEdhD2` after the other slices' own folds). A fold applies
 * only when every part is exactly what the idiom says. This file imports no value from render/fold.ts (an import cycle); it takes the types only.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { acting, plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt, firstAlt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const isBound = (ref: ObjRef, name: string | undefined): boolean => name !== undefined && ref.ref === 'bound' && ref.name === name;

/**
 * "Search target opponent's library for up to three creature cards and put them into their graveyard." (Life's Finale, Quiet Speculation; CR 701.23a, 701.23b, 404.1,
 * 608.2c): you search another player's library for at most N cards of a description and put the cards found into the graveyard, where each goes to its owner's, which is
 * the searched player's. The default text would say two sentences ("... Put them into their owners' graveyards.").
 */
function searchOtherLibraryToGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'search' || b?.op !== 'move' || a.as === undefined || !isBound(b.what, a.as) || a.zone !== 'library' || a.owner === undefined) return null;
  if (a.who.ref !== 'you' || a.reveal === true || a.and !== undefined || a.guard !== undefined || b.guard !== undefined || b.until !== undefined) return null;
  if ((a.min ?? 0) !== 0 || typeof a.max !== 'number' || a.differentNames !== undefined) return null;
  if (Object.keys(a).some((k) => !['op', 'who', 'zone', 'owner', 'filter', 'min', 'max', 'as'].includes(k))) return null;
  if (b.to.zone !== 'graveyard' || Object.keys(b).some((k) => !['op', 'what', 'to'].includes(k)) || Object.keys(b.to).some((k) => k !== 'zone')) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"${a.as}"`))) return null;
  const ca = K.clause(a, st); // binds the cards found ("them", "those cards") and names the player searched ("target opponent's")
  const imp = firstAlt(ca.imp);
  if (!/^search .+ library for up to /.test(imp)) return null;
  const key = `b:${a.as}`;
  const info = st.info.get(key);
  if (info === undefined || !info.plural) return null;
  st.info.set(key, { ...info, alts: [...(info.alts ?? []), 'them', 'those cards'] });
  K.clause(b, st);
  return { clauses: [plain(`${imp} and put them into ${alt('their', "that player's")} graveyard`)], consumed: 2 };
}

/**
 * "Mill four cards. You may put a permanent card from among them onto the battlefield." (Mole Module; CR 701.17a, 701.17c, 608.2c-d, 110.2): you mill, then choose up to one
 * card of a description among the milled cards (found in the graveyard they moved to, CR 701.17c) and put it onto the battlefield under your control. Only that exact shape,
 * with nothing after it reading either name.
 */
function milledThenMayPutOntoBattlefield(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, c] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'mill' || b?.op !== 'chooseObjects' || c?.op !== 'move' || a.as === undefined || b.as === undefined) return null;
  if (a.guard !== undefined || !same(a.who, { ref: 'you' }) || typeof a.count !== 'number') return null;
  if (b.guard !== undefined || b.random === true || b.distinct !== undefined || b.groupLimit !== undefined || b.perPlayer !== undefined || b.startingWith !== undefined || !same(b.who, { ref: 'you' }) || b.min !== 0 || b.max !== 1) return null;
  if (c.guard !== undefined || c.as !== undefined || c.until !== undefined || c.link !== undefined || c.remember !== undefined || !same(c.what, { ref: 'bound', name: b.as })) return null;
  if (!same(c.to, { zone: 'battlefield', controller: { ref: 'you' } })) return null;
  const from = b.from.ref === 'each' && 'filter' in b.from ? b.from.filter : null;
  if (from === null || Object.keys(from).length !== 3 || from.zone !== 'any' || from.is === undefined || !same(from.is, { ref: 'bound', name: a.as }) || from.anyOf?.length !== 1) return null;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`) || JSON.stringify(x).includes(`"name":"${b.as}"`))) return null;
  const one = K.np({ ...from.anyOf[0]!, zone: 'graveyard' }, st, { det: 'a', noZone: true });
  const mill = `mill ${a.count} card${a.count === 1 ? '' : 's'}`;
  const texts: string[] = [];
  for (const them of ['the milled cards', 'them', 'those cards']) texts.push(`${mill}. you may put ${one} from among ${them} onto the battlefield`);
  return { clauses: [plain(alt(...texts), { standalone: true })], consumed: 3 };
}

/**
 * "Reveal your hand and put all land cards from it onto the battlefield." (Manabond; CR 701.20a, 402.3, 608.2c, 110.2): you reveal your hand, then put every card of a
 * description in it onto the battlefield under your control. "it" is the hand just revealed. Only those two steps.
 */
function revealHandPutAllOntoBattlefield(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [r, m] = [list[i], list[i + 1]];
  if (r?.op !== 'reveal' || m?.op !== 'move' || r.guard !== undefined || m.guard !== undefined || r.as !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  if (!same(r.who, { ref: 'you' }) || r.to !== undefined || !same(r.what, { ref: 'each', filter: { zone: 'hand', owner: { ref: 'you' } } })) return null;
  if (m.what.ref !== 'each' || !same(m.to, { zone: 'battlefield', controller: { ref: 'you' } })) return null;
  const f = m.what.filter;
  if (f.zone !== 'hand' || f.owner !== 'you' || f.isCard !== true || f.anyOf?.length !== 1) return null;
  if (Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join(',') !== 'anyOf,isCard,owner,zone') return null;
  const cards = K.np({ ...f.anyOf[0]!, zone: 'hand' }, st, { det: 'none', plural: true, noZone: true });
  const text = `reveal your hand and put all ${cards} from it onto the battlefield`;
  return { clauses: [acting('you', text, `you ${text}`, { standalone: true })], consumed: 2 };
}

/** The folds of edh-d-2 (render/fold.ts#foldAt). */
export function foldEdhD2(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return searchOtherLibraryToGraveyard(list, i, st) ?? milledThenMayPutOntoBattlefield(list, i, st) ?? revealHandPutAllOntoBattlefield(list, i, st);
}
