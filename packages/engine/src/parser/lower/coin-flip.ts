/**
 * Cloud r3-mech (CR 705.2, 608.2c): "Flip a coin. If you win the flip, X. If you lose the flip, Y." The sentences after the flip that read its result
 * ("If you win the flip" / "If you lose the flip", templates `eff.r3mech.ifFlip.*`: an `if` on a `{cond:'flip', won}` marker that only this pass reads) belong to the flip
 * RIGHT BEFORE them: the last top-level step of the previous understood sentence, a `flipCoin` by you (template `eff.r3mech.flipCoin`). The sentence moves
 * into that step's `onWin` / `onLose` (the handler, effects/handlers/game.ts#flipCoin, asks for the call and runs the branch, CR 705.2). Anything else
 * (no flip right before, a sentence not understood before it, a second "if you win the flip" for the same flip, an `otherwise`, a flip inside a branch)
 * is unresolved and manual (design 6.4: no search further back).
 * Review (CR 705.1-705.2): a result sentence that is itself not understood ("Then flip a coin. If you lose the flip, [manual]", Goblin Kaboomist) can't be a
 * branch, and the flip right before it would then be flipped with no call (nothing automated cares), leaving the player to resolve "if you lose the flip" for a
 * flip nobody won or lost: when the flip has no branch yet, the sentence of the flip is made manual too (both are resolved by hand).
 */
import type { Draft, Rec, Unit } from './types';
import { freshName, isRec, setManual, visit } from './util';

const hasFlipMarker = (u: Unit): boolean => {
  let found = false;
  visit(u.steps, (n) => {
    if (n['cond'] === 'flip') found = true;
  });
  return found;
};

/** A sentence that reads the result of the flip before it ("If you win the flip, ...", "When you lose the flip, ...", std-copy-1), by its words (it may be manual). */
const RESULT_SENTENCE = /^(?:then )?(?:if|when) you (?:win|lose) the flip\b/i;

const isBareFlipByYou = (s: Rec | undefined): boolean =>
  s !== undefined && s['op'] === 'flipCoin' && s['onWin'] === undefined && s['onLose'] === undefined;

/**
 * The flip a result sentence reads: the last top-level step of the sentence before it, or (std-copy-1, CR 608.2c, 118.12) the last instruction of "If you do, flip a
 * coin." (an `if` on an earlier instruction's result, no else or guard): the result sentence then happens only when that flip does. Else undefined.
 */
function flipOf(s: Rec | undefined): Rec | undefined {
  if (s === undefined) return undefined;
  if (s['op'] === 'flipCoin') return s;
  const cond = s['cond'];
  const then = s['then'];
  if (s['op'] !== 'if' || !isRec(cond) || cond['cond'] !== 'did' || cond['not'] === true || s['else'] !== undefined || s['guard'] !== undefined || !Array.isArray(then)) return undefined;
  const last = then[then.length - 1];
  return isRec(last) && last['op'] === 'flipCoin' ? last : undefined;
}

export function foldFlips(seq: Unit[], d?: Draft): void {
  seq.forEach((u, i) => {
    if (u.manual && RESULT_SENTENCE.test(u.text.trim())) {
      const prev = seq.slice(0, i).reverse().find((p) => p.manual !== undefined || p.steps.length > 0);
      const flip = prev !== undefined && !prev.manual ? flipOf(prev.steps[prev.steps.length - 1]) : undefined;
      if (prev !== undefined && isBareFlipByYou(flip)) {
        setManual(prev, { code: 'unbound-reference', reason: 'a coin flip whose result sentence is not understood: it would be flipped with no call (CR 705.1-705.2)' }); // only that sentence (design 6.7 T1)
      }
      return;
    }
    if (u.manual || !hasFlipMarker(u)) return;
    const s = u.steps.length === 1 ? u.steps[0]! : undefined;
    const cond = s?.['op'] === 'reflexive' ? s['when'] : s?.['cond'];
    const fail = (): void => setManual(u, { code: 'unbound-reference', reason: '"if / when you win / lose the flip" with no coin flip by you right before it (CR 705.2, 608.2c)', unresolved: true });
    if (s === undefined || !isRec(cond) || cond['cond'] !== 'flip') return fail();
    // std-copy-1 (CR 603.12, 705.2): "When you win the flip, X" is a reflexive triggered ability of the flip (lower/conditions.ts#lowerReflexive lifted its targets)
    const reflexive = s['op'] === 'reflexive' && Array.isArray(s['do']) && Array.isArray(s['targets']) && d !== undefined;
    if (!reflexive && (s['op'] !== 'if' || s['else'] !== undefined || s['guard'] !== undefined || !Array.isArray(s['then']))) return fail();
    const prev = seq.slice(0, i).reverse().find((p) => p.manual !== undefined || p.steps.length > 0);
    if (prev === undefined || prev.manual) return fail();
    const flip = flipOf(prev.steps[prev.steps.length - 1]);
    if (flip === undefined) return fail();
    const who = flip['who'];
    const side = cond['won'] === true ? 'onWin' : 'onLose';
    if (!isRec(who) || who['ref'] !== 'you' || flip[side] !== undefined || flip['count'] !== undefined) return fail(); // r4-mech: one coin only
    if (reflexive) {
      // the trigger waits for the flip itself (effects/handlers/game.ts#flipCoin records the flip as done before it runs the branch of its result)
      if (typeof flip['as'] !== 'string') flip['as'] = freshName(d, 'flip');
      flip[side] = [{ ...s, when: { did: flip['as'] } }];
    } else flip[side] = s['then'];
    u.steps = [];
  });
}
