/**
 * edh-d-96 (MUST-FINISH round, graveyard, exile and cast part 1): the folds of its templates (parser/templates/zz-cloud/edh-d-96.json), called from render/fold.ts#foldAt. Each applies only
 * when every part is exactly what the idiom says. No value is imported from render/fold.ts (it imports this file).
 *
 * `battlefieldOrHand` (CR 608.2d, 110.2, 400.3; Illuna, Apex of Wishes, eff.edhd96.put.battlefieldOrHand): "Put that card onto the battlefield or into your hand.": you choose one of the two
 * places as the ability resolves, after seeing the card (chooseValue among "battlefield" and "hand"; Illuna ruling 2020-04-17), then one move per option, in that order, of the same object:
 * onto the battlefield (under your control: you put it there) or into your hand. Nothing else reads the choice.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const PLACES = ['battlefield', 'hand'] as const;
const DESTS = [{ zone: 'battlefield', controller: { ref: 'you' } }, { zone: 'hand', owner: { ref: 'you' } }] as const;

/** Does a step after the fold read the choice's link (a later `if` on it, a quality filter)? */
const readsLink = (steps: readonly EffectStep[], link: string): boolean => steps.some((s) => JSON.stringify(s).includes(`"link":"${link}"`));

function battlefieldOrHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  if (c?.op !== 'chooseValue' || c.link === undefined || c.guard !== undefined || c.what !== 'option' || c.min !== undefined || c.max !== undefined || !same(c.who, { ref: 'you' }) || !same(c.options, PLACES)) return null;
  let what: unknown;
  for (let k = 0; k < PLACES.length; k++) {
    const b = list[i + 1 + k];
    if (b?.op !== 'if' || b.else !== undefined || b.guard !== undefined || b.as !== undefined || b.then.length !== 1) return null;
    if (b.cond.cond !== 'chosen' || b.cond.link !== c.link || b.cond.equals !== PLACES[k]) return null;
    const m = b.then[0]!;
    if (m.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || !same(m.to, DESTS[k])) return null;
    if (k === 0) what = m.what;
    else if (!same(m.what, what)) return null;
  }
  if (readsLink(list.slice(i + 1 + PLACES.length), c.link)) return null;
  const obj = K.obj(what as never, st, 'object');
  if (obj.plural) return null;
  return { clauses: [plain(`put ${obj.text} onto the battlefield or into your hand`)], consumed: 1 + PLACES.length };
}

export function foldEdhD96(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return battlefieldOrHand(list, i, st);
}
