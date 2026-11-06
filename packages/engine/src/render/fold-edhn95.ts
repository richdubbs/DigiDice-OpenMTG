/**
 * edh-next-95 (top-rank second pass 3): the folds of its templates (parser/templates/zz-cloud/edh-next-95.json), called from render/fold.ts#foldAt. Each applies only when every part is
 * exactly what the idiom says.
 *
 * `putAnyNumberFromAmongThem` (CR 608.2d, 110.2a, 400.7j, 406.1; Xenagos, the Reveler; Rampant Frogantua): "You may put any number of creature and/or land cards from among them onto the
 * battlefield." after "Exile the top seven cards of your library." and "Put any number of land cards from among them onto the battlefield tapped." after "you may mill that many cards": your
 * choice of any number of the cards of a description among the group the step before made (`zone: 'any'`: they are in exile or a graveyard now), put onto the battlefield under your control
 * (tapped or not). Exactly the two steps of templates eff.edhn95.put.anyNumber.fromExiledTop.battlefield and eff.edhn95.put.anyNumber.fromMilled.battlefield.
 */
import type { EffectStep } from '../types/ability';
import type { Folded } from './fold';
import { withVariants, type RenderState } from './state';
import { plain } from './clause';
import { K } from './kernel';
import { bind } from './steps-util';
import { alt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const unread = (list: EffectStep[], from: number, name: string): boolean => !list.slice(from).some((x) => JSON.stringify(x).includes(`"name":"${name}"`));
const UNFOLDING = new WeakSet<EffectStep>();

export function foldEdhN95(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return putAnyNumberFromAmongThem(list, i, st);
}

function putAnyNumberFromAmongThem(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || UNFOLDING.has(a) || a.guard !== undefined || b.guard !== undefined || a.as === undefined || b.as !== undefined || b.until !== undefined) return null;
  if (!same(a.who, { ref: 'you' }) || a.min !== 0 || a.max !== 'any' || a.random === true || a.groupLimit !== undefined || a.perPlayer !== undefined) return null;
  if (a.from.ref !== 'each' || !('filter' in a.from)) return null;
  const f = a.from.filter;
  if (Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join(',') !== 'anyOf,is,zone' || f.zone !== 'any' || f.anyOf?.length !== 1 || f.is?.ref !== 'bound') return null;
  const tapped = b.to.tapped === true;
  if (!same(b.what, { ref: 'bound', name: a.as }) || !same({ ...b.to, tapped: undefined }, { zone: 'battlefield', controller: { ref: 'you' }, tapped: undefined }) || b.link !== undefined || b.remember !== undefined) return null;
  if (f.is?.ref !== 'bound') return null;
  const group = f.is.name;
  // the group is bound by a step before (an exile of the top cards records it in the state, a mill only names it with `as`, possibly inside "you may")
  if ((st.info.get(`b:${group}`) === undefined && !list.slice(0, i).some((x) => JSON.stringify(x).includes(`"as":"${group}"`))) || !unread(list, i + 2, a.as)) return null;
  const kind = f.anyOf[0]!;
  const unfold = (v: RenderState): string => {
    UNFOLDING.add(a);
    try { return K.steps([a, b], v); } finally { UNFOLDING.delete(a); }
  };
  const [folded, unfolded] = withVariants(st, [(v) => {
    const np = K.np(kind, v, { det: 'none', plural: true, head: 'card' });
    return alt(`you may put any number of ${np} from among them onto the battlefield${tapped ? ' tapped' : ''}`, `put any number of ${np} from among them onto the battlefield${tapped ? ' tapped' : ''}`);
  }, unfold]);
  bind(st, a.as, { nouns: K.nounsOf(kind), plural: true, optional: true });
  return { clauses: [plain(alt(folded!, unfolded!))], consumed: 2 };
}
