/**
 * edh-mana-keywords-12 (lane edh-mana-keywords): the folds of its templates (parser/templates/zz-cloud/edh-mana-keywords-12.json), called from render/fold.ts#foldAt.
 *
 * `revealAnyNumberFromHand` (CR 701.20a, 402.3, 608.2d; Metalworker): "Reveal any number of artifact cards in your hand.": your choice of any number (none included) of the cards of
 * a description in your hand and their reveal. The reveal is named, so a later "for each card revealed this way" counts it. Only that exact shape.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';
import { alt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function revealAnyNumberFromHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'reveal' || a.as === undefined || b.as === undefined) return null;
  if (a.guard !== undefined || a.random !== undefined || a.distinct !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined) return null;
  if (!same(a.who, { ref: 'you' }) || a.min !== 0 || a.max !== 'any' || a.from.ref !== 'each' || !('filter' in a.from)) return null;
  const f = a.from.filter;
  if (f.zone !== 'hand' || f.owner !== 'you' || f.anyOf?.length !== 1 || Object.keys(f).some((k) => k !== 'zone' && k !== 'owner' && k !== 'anyOf')) return null;
  if (b.guard !== undefined || b.to !== undefined || !same(b.who, { ref: 'you' }) || !same(b.what, { ref: 'bound', name: a.as }) || Object.keys(b).some((k) => !['op', 'who', 'what', 'as', 'anyNumber'].includes(k))) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null; // only the reveal's own name is read afterwards
  const cards = K.np({ ...f.anyOf[0]!, zone: 'hand' }, st, { det: 'none', plural: true, noZone: true });
  st.info.set(`r:${b.as}`, { nouns: ['card'], plural: true, thisWay: 'revealed this way' });
  bind(st, b.as, { nouns: ['card'], plural: true, hand: true });
  // edh-next-135 (family reveal-any-number-from-hand; CR 701.20a, 603.12; Invasion of Tarkir): the reveal that is done with none too (`anyNumber`) is also "from your hand"
  const where = b.anyNumber === true ? alt('in your hand', 'from your hand') : 'in your hand';
  return { clauses: [plain(`reveal any number of ${cards} ${where}`, { standalone: true })], consumed: 2 };
}

export function foldEdhMk12(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return revealAnyNumberFromHand(list, i, st);
}
