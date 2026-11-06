/**
 * edh-d-75 (Commander lane attack-requirements, concept round): the folds of its readings, called from render/fold.ts#foldAt. A new fold-*.ts never imports a value from fold.ts.
 *
 * `putCountersAndDraw` (CR 122.1, 121.1, 608.2c; Firkraag, Cunning Instigator): "you put a +1/+1 counter on ~ and you draw a card": the controller puts counters on something and draws one
 * card, said as ONE sentence with the subject repeated. It is one more way to say the pair the generic joiner already says as two sentences ("Put a +1/+1 counter on ~. Draw a card.") or with
 * "and" ("put ... and draw ..."), so the fold offers both: the text of the generic rendering of the two steps (rendered on a copy of the state) and the repeated-subject form. Only when the effect is exactly these two
 * steps (a draw that is followed by a "then" instruction, Malcolm, Alluring Scoundrel, is folded with those by other readings).
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { cloneState, type RenderState } from './state';
import { alt } from './text';

let inside = false; // the generic rendering below asks the folds again about the same two steps

function putCountersAndDraw(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (inside || list.length !== 2 || i !== 0 || a?.op !== 'putCounters' || b?.op !== 'draw' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  if (JSON.stringify(b.who) !== '{"ref":"you"}' || b.count !== 1 || Object.keys(b).length !== 3) return null;
  let generic: string;
  inside = true;
  try {
    generic = K.steps([a, b], cloneState(st));
  } finally {
    inside = false;
  }
  const first = K.clause(a, st);
  if (first.empty === true || !/^[-]*put /.test(first.imp)) return null;
  K.clause(b, st);
  return { clauses: [plain(alt(generic, `you ${first.imp} and you draw a card`), { standalone: true })], consumed: 2 };
}

/** The folds of edh-d-75 (render/fold.ts#foldAt). */
export function foldEdhD75(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return putCountersAndDraw(list, i, st);
}
