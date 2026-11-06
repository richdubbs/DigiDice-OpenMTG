/**
 * edh-d-7 (Commander lane edh-d): the fold of its template eff.edhd7.look.oneHand.oneGraveyard.oneBottom (parser/templates/zz-cloud/edh-d-7.json), called from render/fold.ts#foldAt.
 *
 * (CR 401.2, 608.2c, 608.2d, 400.7; Moment of Truth): "Look at the top three cards of your library. Put one of those cards into your hand, one into your graveyard, and one on the
 * bottom of your library.": the player who looked chooses one of the cards looked at for the hand, then one of those still in the library for the graveyard, and the last one goes on
 * the bottom. Exactly the five steps the template builds.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';
import { alt } from './text';
import { K } from './kernel';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The binding a description of "the cards of it still in a library" names: `each` of `{ is: bound X, zone: 'library' }`, else null. */
function fromBound(from: { ref: string; filter?: unknown }): string | null {
  const f = from.filter as { is?: { ref?: string; name?: string }; zone?: string } | undefined;
  if (from.ref !== 'each' || f === undefined || f.zone !== 'library' || f.is?.ref !== 'bound' || typeof f.is.name !== 'string' || Object.keys(f).length !== 2) return null;
  return f.is.name;
}

function lookOneHandOneGraveyardOneBottom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c1, m1, c2, m2, c3, m3] = [list[i], list[i + 1], list[i + 2], list[i + 3], list[i + 4], list[i + 5]];
  if (c1?.op !== 'chooseObjects' || m1?.op !== 'move' || c2?.op !== 'chooseObjects' || m2?.op !== 'move' || c3?.op !== 'chooseObjects' || m3?.op !== 'move') return null;
  if (c1.as === undefined || c2.as === undefined || c3.as === undefined || new Set([c1.as, c2.as, c3.as]).size !== 3) return null;
  for (const c of [c1, c2, c3]) if (c.guard !== undefined || c.random === true || c.min !== 1 || c.max !== 1 || c.who.ref !== 'you' || c.from.ref !== 'each' || c.perPlayer !== undefined) return null;
  const src = fromBound(c1.from);
  if (src === null || !same(c1.from, c2.from) || !same(c3.from, c1.from) || !same(m3.what, { ref: 'bound', name: c3.as })) return null;
  if (!same(m1.what, { ref: 'bound', name: c1.as }) || !same(m2.what, { ref: 'bound', name: c2.as })) return null;
  for (const m of [m1, m2, m3]) if (m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined) return null;
  if (!same(m1.to, { zone: 'hand' }) || !same(m2.to, { zone: 'graveyard' }) || !same(m3.to, { zone: 'library', position: 'bottom' })) return null;
  const looked = st.info.get(`b:${src}`);
  if (looked === undefined || !looked.plural || looked.zone !== 'library') return null;
  if (list.slice(i + 6).some((x) => JSON.stringify(x).includes(`"${c1.as}"`) || JSON.stringify(x).includes(`"${c2.as}"`) || JSON.stringify(x).includes(`"${c3.as}"`) || JSON.stringify(x).includes(`"${src}"`))) return null;
  const one = alt('one of those cards', 'one of them');
  return { clauses: [plain(`put ${one} into your hand, one into your graveyard, and one on the bottom of your library`)], consumed: 6 };
}

/**
 * (CR 601.2, 118.9, 608.2c; Galvanoth): "You may cast it without paying its mana cost if it's an instant or sorcery spell.": the optional free cast of a card an earlier instruction
 * looked at, only when its card types include Instant or Sorcery (the test is on the card, not on a spell: a card in a library is not on the stack, CR 112.1).
 */
function castFreeIfInstantOrSorcery(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  if (c?.op !== 'cast' || c.who.ref !== 'you' || c.free !== true || c.optional !== true) return null;
  const g = c.guard;
  if (g === undefined || g.cond !== 'matches' || !same(g.filter, { types: ['Instant', 'Sorcery'] }) || !same(g.object, c.what)) return null;
  for (const k of Object.keys(c)) if (!['op', 'who', 'what', 'free', 'optional', 'guard', 'sentence'].includes(k)) return null;
  const it = K.obj(c.what, st, 'object').text;
  const spelled = it === 'it' ? 'it' : it;
  return { clauses: [plain(`you may cast ${spelled} without paying its mana cost if ${it === 'it' ? "it's" : `${it} is`} an instant or sorcery spell`)], consumed: 1 };
}

/** The folds of edh-d-7 (render/fold.ts#foldAt). */
export function foldEdhD7(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return lookOneHandOneGraveyardOneBottom(list, i, st) ?? castFreeIfInstantOrSorcery(list, i, st);
}
