/**
 * edh-next-46 (Commander EDHREC ranks 8,751-10,000, third pass): the folds of its templates and readings, called from render/fold.ts#foldAt. A new fold-*.ts never imports a
 * value from render/fold.ts (an import cycle): the folded shape is returned through the `Folded` type only.
 *
 * `putHitRestBottomRandom` (CR 701.20a, 701.20b, 406.1, 401.4, 608.2c; Venture Forth, Kethek, Crucible Goliath): after YOUR "reveal cards from the top of your library until you
 * reveal <a card>" or "exile cards from the top of your library until you exile <a card>", "Put that card onto the battlefield and the rest on the bottom of your library in a
 * random order." (also "put it onto the battlefield, then put the rest on the bottom ..."): the one card it stopped at goes onto the battlefield under your control and every other
 * card that was revealed (still in the library) or exiled (still in exile) goes to the bottom of your library in a random order. Only your own
 * reveal-until or exile-until followed by those two moves, the rest being exactly the other cards of that group (family put-hit-rest-bottom-random).
 */
import type { EffectStep } from '../types/ability';
import { cloneState } from './state';
import type { RenderState } from './state';
import { acting } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { AMBIGUOUS, restOfExiled, restOfGroup } from './refs';
import { alt } from './text';

function putHitRestBottomRandom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const rv = list[i];
  const a = list[i + 1];
  const b = list[i + 2];
  if ((rv?.op !== 'revealUntil' && rv?.op !== 'exileUntil') || rv.who.ref !== 'you' || a?.op !== 'move' || b?.op !== 'move' || a.what.ref !== 'bound' || b.what.ref !== 'each') return null;
  if (rv.guard !== undefined || [a, b].some((s) => s.guard !== undefined || s.as !== undefined || s.until !== undefined || s.link !== undefined || s.remember !== undefined)) return null;
  if (JSON.stringify(a.to) !== JSON.stringify({ zone: 'battlefield', controller: { ref: 'you' } })) return null;
  if (JSON.stringify(b.to) !== JSON.stringify({ zone: 'library', position: 'bottom', order: 'random' })) return null;
  if (rv.as !== a.what.name) return null;
  // one card, and a description that names no other object ("shares a card type with it", "with the sacrificed creature"): those readings keep their own renderings (templates r3dig.*, edh-next-40)
  if ((rv.op === 'revealUntil' && rv.count !== undefined) || JSON.stringify(rv.filter).includes('"ref"')) return null;
  if (rv.op === 'revealUntil') {
    const rest = restOfGroup(b.what.filter);
    if (rest === null || rest.chosen !== a.what.name || rest.group !== rv.revealed) return null;
  } else {
    const f = b.what.filter;
    if (!restOfExiled(f) || f.is?.ref !== 'bound' || f.is.name !== rv.exiled || f.not?.is?.ref !== 'bound' || f.not.is.name !== a.what.name) return null;
  }
  // where the card it stopped at can't be named (another object is also "that card"), the older readings keep the sentence; probed on a copy of the state
  const probe = cloneState(st);
  K.clause(rv, probe);
  if (K.obj(a.what, probe, 'object').text.includes(AMBIGUOUS)) return null;
  const first = K.clause(rv, st);
  const that = K.obj(a.what, st, 'object');
  K.obj(b.what, st, 'object');
  const tail = 'on the bottom of your library in a random order';
  const imp = alt(`${first.imp}. put ${that.text} onto the battlefield and the rest ${tail}`, `${first.imp}, put ${that.text} onto the battlefield, then put the rest ${tail}`);
  const sub = alt(`${first.sub}. put ${that.text} onto the battlefield and the rest ${tail}`, `${first.sub}, put ${that.text} onto the battlefield, then put the rest ${tail}`);
  return { clauses: [acting('you', imp, sub, { standalone: true })], consumed: 3 };
}

export function foldEdhN46(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return putHitRestBottomRandom(list, i, st);
}
