/**
 * p2-player-rules-2 (CR 701.30, 608.2c): "Clash with an opponent. If you win, X. Otherwise, Y." The sentence after the clash that reads its result ("If you win",
 * template `eff.p2pr2.ifClash.win`: an `if` on a `{cond:'clash', won: true}` marker that only this pass reads; its "Otherwise" rider is the `if`'s `else`) belongs
 * to the clash RIGHT BEFORE it: the last top-level step of the previous understood sentence, a `clash` by you without branches (template `eff.p2pr2.clash`). The
 * `then` moves into that step's `onWin`, the `else` into `onLose` (effects/handlers/cards-library.ts#clashHandler runs the branch of the result; a draw is not a win, CR 701.30c).
 * Anything else (no clash right before, a sentence not understood before it, a second result sentence for the same clash, a guard) is unresolved and manual
 * (design 6.4: no search further back), and so is a clash whose result sentence is not understood (it would be clashed with nobody acting on its result).
 */
import type { Unit } from './types';
import { isRec, setManual, visit } from './util';

const hasClashMarker = (u: Unit): boolean => {
  let found = false;
  visit(u.steps, (n) => {
    if (n['cond'] === 'clash') found = true;
  });
  return found;
};

/** A sentence that reads the result of the clash before it, by its words (it may be manual). */
const RESULT_SENTENCE = /^if you win\b(?! the flip)/i;

export function foldClashes(seq: Unit[]): void {
  seq.forEach((u, i) => {
    const prev = seq.slice(0, i).reverse().find((p) => p.manual !== undefined || p.steps.length > 0);
    const last = prev !== undefined && !prev.manual ? prev.steps[prev.steps.length - 1] : undefined;
    const bare = last !== undefined && last['op'] === 'clash' && last['onWin'] === undefined && last['onLose'] === undefined;
    if (u.manual && RESULT_SENTENCE.test(u.text.trim())) {
      if (bare && prev !== undefined) setManual(prev, { code: 'unbound-reference', reason: 'a clash whose result sentence is not understood (CR 701.30, 608.2c)' });
      return;
    }
    if (u.manual || !hasClashMarker(u)) return;
    const s = u.steps.length === 1 ? u.steps[0]! : undefined;
    const cond = s?.['cond'];
    const fail = (): void => setManual(u, { code: 'unbound-reference', reason: '"if you win" with no clash by you right before it (CR 701.30, 608.2c)', unresolved: true });
    if (s === undefined || s['op'] !== 'if' || !isRec(cond) || cond['cond'] !== 'clash' || cond['won'] !== true || s['guard'] !== undefined || !Array.isArray(s['then'])) return fail();
    if (!bare) return fail();
    const who = last!['who'];
    if (!isRec(who) || who['ref'] !== 'you') return fail();
    last!['onWin'] = s['then'];
    if (Array.isArray(s['else'])) last!['onLose'] = s['else'];
    u.steps = [];
  });
}
