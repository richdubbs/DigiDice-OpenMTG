/**
 * edh-zones-13 (Commander lane edh-zones): the folds of its templates (parser/templates/zz-cloud/edh-zones-13.json), called from render/fold.ts#foldAt. Each applies only when
 * every part is exactly what the idiom says.
 *
 * `eachPlayerMillsThenPutOne` (CR 701.17a, 701.17c, 608.2c-d, 110.2a; Gyruda, Doom of Depths): "Each player mills four cards. Put a creature card with an even mana value from
 * among the milled cards onto the battlefield under your control.": every player mills (one group, all the cards milled), you choose exactly one card of a description among
 * them (a card is found in the graveyard it moved to, CR 701.17c) and put it onto the battlefield under your control. Only that exact shape, with nothing after it reading either name.
 */
import type { EffectStep } from '../types/ability';
import { acting, plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function eachPlayerMillsThenPutOne(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, c] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'mill' || b?.op !== 'chooseObjects' || c?.op !== 'move' || a.as === undefined || b.as === undefined) return null;
  if (a.guard !== undefined || !same(a.who, { ref: 'each', who: 'player' }) || typeof a.count !== 'number') return null;
  if (b.guard !== undefined || b.random === true || b.distinct !== undefined || b.groupLimit !== undefined || b.perPlayer !== undefined || b.startingWith !== undefined || !same(b.who, { ref: 'you' }) || b.min !== 1 || b.max !== 1) return null;
  if (c.guard !== undefined || c.as !== undefined || c.until !== undefined || c.link !== undefined || c.remember !== undefined || !same(c.what, { ref: 'bound', name: b.as })) return null;
  if (!same(c.to, { zone: 'battlefield', controller: { ref: 'you' } })) return null;
  const from = b.from.ref === 'each' && 'filter' in b.from ? b.from.filter : null;
  // CR 701.17c: a milled card is found in the public zone it moved to (`zone: 'any'` beside the binding)
  if (from === null || Object.keys(from).length !== 3 || from.zone !== 'any' || from.is === undefined || !same(from.is, { ref: 'bound', name: a.as }) || from.anyOf?.length !== 1) return null;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`) || JSON.stringify(x).includes(`"name":"${b.as}"`))) return null;
  const one = K.np({ ...from.anyOf[0]!, zone: 'graveyard' }, st, { det: 'a', noZone: true });
  const mill = `each player mills ${a.count} card${a.count === 1 ? '' : 's'}`;
  const texts: string[] = [];
  for (const them of ['the milled cards', 'them', 'those cards']) for (const then of ['', 'then ']) texts.push(`${mill}. ${then}put ${one} from among ${them} onto the battlefield under your control`);
  return { clauses: [plain(alt(...texts), { standalone: true })], consumed: 3 };
}

/**
 * `shuffleThenRevealUntil` (CR 701.24a, 701.20a-b, 608.2c; Creative Technique): "Shuffle your library, then reveal cards from the top of it until you reveal a nonland card.":
 * your shuffle of your library, then the reveal of the cards from its top until one of a description; "it" is the library just shuffled. Exactly the two steps of template
 * eff.edhz13.shuffle.thenRevealUntil.
 */
function shuffleThenRevealUntil(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'shuffle' || b?.op !== 'revealUntil' || a.guard !== undefined || a.as !== undefined || a.ifSearched !== undefined || !same(a.who, { ref: 'you' })) return null;
  if (b.guard !== undefined || !same(b.who, { ref: 'you' }) || (b.count !== undefined && b.count !== 1)) return null;
  const reveal = K.clause(b, st);
  if (!reveal.imp.includes('from the top of your library')) return null;
  const text = `shuffle your library, then ${reveal.imp.replace('from the top of your library', 'from the top of it')}`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/** The folds of edh-zones-13 (render/fold.ts#foldAt). */
export function foldEdhZones13(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachPlayerMillsThenPutOne(list, i, st) ?? shuffleThenRevealUntil(list, i, st);
}
