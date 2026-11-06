/**
 * Commander lane edh-c, round edh-c-66: the fold of the steps its templates build (render/fold.ts#foldAt tries `foldEdhC66` after the other slices' own folds). A fold applies
 * only when every part is exactly what the idiom says.
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { plain } from './clause';
import { alt, firstAlt } from './text';
import type { Folded } from './fold';
import { K } from './kernel';
import { isComputed } from './steps-util';
import type { RenderState } from './state';

const isBound = (ref: ObjRef, name: string | undefined): boolean => name !== undefined && ref.ref === 'bound' && ref.name === name;

/**
 * "Search target player's library for up to X cards, where X is the number of Swamps you control, and exile them." (Nightmare Incursion; CR 701.23a, 701.23b, 107.3, 608.2h):
 * an unrestricted search of a player's library for at most a computed number of cards (the searcher may find fewer, 701.23b) and the exile of exactly the cards found. The
 * "where X is" clause stands between the description and the "and": the default text would put it after the whole search or break the exile into its own sentence.
 */
function searchUpToXWhereThenExile(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'search' || b?.op !== 'move' || a.as === undefined || !isBound(b.what, a.as) || a.zone !== 'library' || a.owner === undefined) return null;
  if (a.who.ref !== 'you' || a.reveal === true || a.and !== undefined || a.guard !== undefined || b.guard !== undefined || b.until !== undefined) return null;
  if (Object.keys(a.filter).length !== 0 || (a.min ?? 0) !== 0 || typeof a.max !== 'object' || !isComputed(a.max)) return null;
  if (Object.keys(a).some((k) => !['op', 'who', 'zone', 'owner', 'filter', 'min', 'max', 'as'].includes(k))) return null;
  if (b.to.zone !== 'exile' || Object.keys(b).some((k) => !['op', 'what', 'to'].includes(k)) || Object.keys(b.to).some((k) => k !== 'zone')) return null;
  const ca = K.clause(a, st); // binds the cards found ("them", "those cards") and names the player searched ("target player's")
  const owner = /^search (.+) library for /.exec(firstAlt(ca.imp))?.[1]; // the searched player as the search names it
  if (owner === undefined) return null;
  const key = `b:${a.as}`;
  const info = st.info.get(key);
  if (info === undefined || !info.plural) return null;
  st.info.set(key, { ...info, alts: [...(info.alts ?? []), 'them', 'those cards'] });
  K.clause(b, st);
  return { clauses: [plain(`search ${owner} library for up to x cards, where x is ${K.qty(a.max, st)}, and exile them`, { standalone: true })], consumed: 2 };
}


/**
 * "Put that card onto the battlefield and shuffle the rest into your library." (Riptide Shapeshifter) and "Put that card onto the battlefield and put all other cards revealed
 * this way into your graveyard." (Avenging Druid; CR 701.20a, 701.24a, 608.2c, 401.3): the card a "reveal until" stopped at goes onto the battlefield under your control and
 * every other revealed card still in the library goes into the library (and you shuffle) or into the graveyard. The singular twin of edh-zones-8's fold
 * (render/fold-edhzones8.ts): a move of a bound card, a move of the revealed cards that are not that card, and for the library your shuffle, with no guard, name, duration or link.
 */
function putCardThenRestOfRevealed(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'move' || b?.op !== 'move' || a.what.ref !== 'bound' || b.what.ref !== 'each') return null;
  // edh-next-40 (CR 701.20a, 400.3; Smeagol, Curse of Unbinding): the idiom is the player's own library, "your graveyard"; the cards of another player's library go to THEIR graveyard (read by the steps' own words)
  const before = list[i - 1];
  if (before?.op === 'revealUntil' && before.who.ref !== 'you') return null;
  const toLibrary = JSON.stringify(b.to) === JSON.stringify({ zone: 'library' });
  const toGraveyard = JSON.stringify(b.to) === JSON.stringify({ zone: 'graveyard' });
  const c = toLibrary ? list[i + 2] : undefined;
  if (toLibrary && (c?.op !== 'shuffle' || c.guard !== undefined || c.as !== undefined || c.ifSearched !== undefined || JSON.stringify(c.who) !== JSON.stringify({ ref: 'you' }))) return null;
  if (!toLibrary && !toGraveyard) return null;
  if ([a, b].some((s) => s.guard !== undefined || s.as !== undefined || s.until !== undefined || s.link !== undefined || s.remember !== undefined)) return null;
  if (JSON.stringify(a.to) !== JSON.stringify({ zone: 'battlefield', controller: { ref: 'you' } })) return null;
  const f = b.what.filter;
  if (Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join(',') !== 'is,not,zone' || f.zone !== 'library' || f.is?.ref !== 'bound' || f.not?.is === undefined || JSON.stringify(f.not.is) !== JSON.stringify(a.what)) return null;
  if (st.info.get(`b:${f.is.name}`) === undefined) return null;
  const it = K.obj(a.what, st, 'object');
  if (it.plural) return null;
  const rest = toLibrary ? 'shuffle the rest into your library' : 'put all other cards revealed this way into your graveyard';
  // edh-d-86 (CR 701.24a; Aspiring Champion; family put-card-then-shuffle-rest): "Put that card onto the battlefield, then shuffle the rest into your library." says the same two moves and the shuffle
  const text = toLibrary ? alt(`put ${it.text} onto the battlefield and ${rest}`, `put ${it.text} onto the battlefield, then ${rest}`) : `put ${it.text} onto the battlefield and ${rest}`;
  return { clauses: [plain(text, { standalone: true })], consumed: toLibrary ? 3 : 2 };
}

/** The folds of edh-c-66 (render/fold.ts#foldAt). */
export function foldEdhC66(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return searchUpToXWhereThenExile(list, i, st) ?? putCardThenRestOfRevealed(list, i, st);
}
