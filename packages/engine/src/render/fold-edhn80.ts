/**
 * edh-next-80 (Commander effort, lane graveyard, third round): the folds of its templates (parser/templates/zz-cloud/edh-next-80.json), called from render/fold.ts#foldAtPlain.
 * Each applies only when every part is exactly what the idiom says. (Says the constants again: a fold-*.ts never imports a value from fold.ts, an import cycle.)
 *
 * `returnThenAnother` (CR 608.2c, 608.2d, 404.1; Blood for Bones, eff.edhn80.return.bf.thenAnother.hand.fromGraveyard): "Return a creature card from your graveyard to the battlefield,
 * then return another creature card from your graveyard to your hand.": you choose one card of a description in your graveyard and it goes to the battlefield, then you choose one card
 * of a second description in your graveyard that is not the first one and it goes to your hand. Only that shape.
 */
import type { EffectStep, ObjectFilter } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { bind } from './steps-util';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function returnThenAnother(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, c, d] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || c?.op !== 'chooseObjects' || d?.op !== 'move') return null;
  if ([a, b, c, d].some((s) => s.guard !== undefined) || a.as === undefined || c.as === undefined || b.as !== undefined || d.as !== undefined || b.until !== undefined || d.until !== undefined) return null;
  for (const x of [a, c]) {
    if (x.who.ref !== 'you' || x.min !== 1 || x.max !== 1 || x.random === true || x.groupLimit !== undefined || x.perPlayer !== undefined || x.startingWith !== undefined || x.distinct !== undefined || x.link !== undefined) return null;
  }
  if (!same(b.what, { ref: 'bound', name: a.as }) || !same(b.to, { zone: 'battlefield', controller: { ref: 'you' } }) || !same(d.what, { ref: 'bound', name: c.as }) || !same(d.to, { zone: 'hand' })) return null;
  if (a.from.ref !== 'each' || !('filter' in a.from) || c.from.ref !== 'each' || !('filter' in c.from)) return null;
  const { not, ...second } = c.from.filter;
  if (!same(not, { is: { ref: 'bound', name: a.as } })) return null;
  const desc = (f: ObjectFilter): ObjectFilter | null => {
    const { zone, owner, isCard, ...rest } = f;
    return zone === 'graveyard' && owner === 'you' && isCard === true && f.anyOf?.length === 1 && Object.keys(rest).filter((k) => (rest as Record<string, unknown>)[k] !== undefined).join() === 'anyOf' ? f.anyOf[0]! : null;
  };
  const first = desc(a.from.filter);
  const next = desc(second);
  if (first === null || next === null) return null;
  const one = K.np({ ...first, zone: 'graveyard', owner: 'you', isCard: true }, st, { det: 'a' });
  const two = `another ${K.np({ ...next, zone: 'graveyard', owner: 'you', isCard: true }, st, { det: 'none' })}`;
  bind(st, a.as, { nouns: K.nounsOf(first), plural: false });
  bind(st, c.as, { nouns: K.nounsOf(next), plural: false });
  return { clauses: [plain(`return ${one} to the battlefield, then return ${two} to your hand`)], consumed: 4 };
}

export function foldEdhN80(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return returnThenAnother(list, i, st);
}
