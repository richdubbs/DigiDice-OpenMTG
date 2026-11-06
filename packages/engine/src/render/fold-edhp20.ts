/**
 * edh-players-20 (Commander lane edh-players): the folds of its templates (parser/templates/zz-cloud/edh-players-20.json), called from render/fold.ts#foldAtPlain.
 *
 * `youAndPlayerEachDrawLose` (CR 121.1, 119.3, 101.4, 608.2c; Karazikar, the Eye Tyrant, eff.edhp20.drawLose.youAndPlayer): "you and the attacking player each draw a card and lose 1 life":
 * the controller and one other named player each draw the same fixed number of cards and lose the same fixed amount of life, said once with "each". Only those four steps in that
 * order (draw you, draw them, lose you, lose them); nothing bound or guarded.
 */
import type { EffectStep } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { alt } from './text';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function youAndPlayerEachDrawLose(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [d1, d2, l1, l2] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (d1?.op !== 'draw' || d2?.op !== 'draw' || l1?.op !== 'loseLife' || l2?.op !== 'loseLife') return null;
  if (d1.who.ref !== 'you' || l1.who.ref !== 'you' || d2.who.ref === 'you' || d2.who.ref === 'each' || !same(d2.who, l2.who)) return null;
  if (typeof d1.count !== 'number' || d1.count !== d2.count || typeof l1.amount !== 'number' || l1.amount !== l2.amount) return null;
  for (const s of [d1, d2, l1, l2]) if (s.guard !== undefined || s.as !== undefined) return null;
  const other = K.player(d2.who, st, 'subject');
  if (other.person !== 'sg') return null;
  const draw = K.clause(d1, st);
  const lose = K.clause(l1, st);
  if (!draw.imp.startsWith('draw ') || !lose.imp.startsWith('lose ') || draw.standalone === true || lose.standalone === true) return null;
  const text = `you and ${other.text} each ${draw.imp} and ${lose.imp}`;
  return { clauses: [acting('you', text, text)], consumed: 4 };
}

/**
 * `drawThenDrawAnotherIf` (CR 121.2, 608.2c; Tevesh Szat, Doom of Fools, eff.edhp20.then.draw.another.ifCond): "draw two cards, then draw another card if the sacrificed permanent was a
 * commander": your draw of a fixed number of cards, then one more card of yours when a condition holds, said in one sentence. Only those two draws by "you", the second a single card with a guard.
 */
function drawThenDrawAnotherIf(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'draw' || b?.op !== 'draw' || a.who.ref !== 'you' || b.who.ref !== 'you' || typeof a.count !== 'number' || b.count !== 1 || a.guard !== undefined || b.guard === undefined) return null;
  if (a.as !== undefined || b.as !== undefined || a.upTo === true || b.upTo === true) return null;
  const first = K.clause(a, st);
  if (!first.imp.startsWith('draw ') || first.standalone === true) return null;
  const cond = K.cond(b.guard, st);
  const text = alt(`${first.imp}, then draw another card if ${cond}`, `${first.imp}. then draw another card if ${cond}`, `${first.imp}. draw another card if ${cond}`);
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/** The folds of edh-players-20's templates (render/fold.ts#foldAtPlain). */
export function foldEdhP20(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return youAndPlayerEachDrawLose(list, i, st) ?? drawThenDrawAnotherIf(list, i, st);
}
