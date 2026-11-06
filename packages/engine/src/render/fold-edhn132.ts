/**
 * edh-next-132 (must-finish round, group copies): the folds of its templates (parser/templates/zz-cloud/edh-next-132.json), called from render/fold.ts#foldAt. As every fold, one
 * applies only when every part is exactly what the idiom says. No value import of render/fold.ts (an import cycle).
 */
import type { EffectStep, ObjRef } from '../types/ability';
import { acting, plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt } from './text';
import { bind, countedNoun } from './steps-util';

const isBound = (r: ObjRef | undefined, name: string | undefined): boolean => name !== undefined && r !== undefined && r.ref === 'bound' && r.name === name;

/**
 * Shadow Kin (CR 701.17a, 701.17c, 608.2c, 608.2d; template eff.edhn132.milled.may.exile.one): "Each player mills three cards. You may exile a creature card from among the cards milled this
 * way.": a mill by you or by each player, then your optional choice of at most one milled card of a description (found in the public zone it went to, `zone: 'any'`), exiled. The card
 * chosen may be named afterwards ("If you do, ~ becomes a copy of that card"): bound as one card. Only those three steps, nothing else in them.
 */
function millThenMayExileOne(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const c = list[i + 2];
  if (a?.op !== 'mill' || b?.op !== 'chooseObjects' || c?.op !== 'move' || a.as === undefined || b.as === undefined) return null;
  if (a.guard !== undefined || b.guard !== undefined || c.guard !== undefined || typeof a.count !== 'number' || c.until !== undefined) return null;
  const eachPlayer = a.who.ref === 'each' && a.who.who === 'player';
  if ((a.who.ref !== 'you' && !eachPlayer) || b.who.ref !== 'you' || b.min !== 0 || b.max !== 1 || b.random === true || b.distinct !== undefined || b.perPlayer !== undefined || b.groupLimit !== undefined) return null;
  if (!isBound(c.what as ObjRef, b.as) || c.to.zone !== 'exile' || Object.keys(c.to).length !== 1) return null;
  const from = b.from.ref === 'each' && 'filter' in b.from ? b.from.filter : null;
  if (from === null || Object.keys(from).length !== 3 || from.zone !== 'any' || from.is === undefined || !isBound(from.is, a.as) || from.anyOf?.length !== 1) return null;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null; // nothing after it reads the milled cards
  const one = K.np({ ...from.anyOf[0]!, zone: 'graveyard' as const }, st, { det: 'a', noZone: true });
  const n = countedNoun(a.count, 'card', st);
  const mill = eachPlayer ? `each player mills ${n}` : `mill ${n}`;
  const groups = eachPlayer ? ['the cards milled this way', 'the milled cards'] : ['them', 'those cards', 'the milled cards', 'the cards milled this way'];
  const text = alt(...groups.map((g) => `${mill}. you may exile ${one} from among ${g}`));
  bind(st, b.as, { nouns: ['card', ...K.nounsOf(from.anyOf[0]!)], plural: false });
  return eachPlayer ? { clauses: [plain(text, { standalone: true })], consumed: 3 } : { clauses: [acting('you', text, `you ${text}`)], consumed: 3 };
}

/** The folds of edh-next-132 (render/fold.ts#foldAt). */
export function foldEdhN132(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return millThenMayExileOne(list, i, st);
}
