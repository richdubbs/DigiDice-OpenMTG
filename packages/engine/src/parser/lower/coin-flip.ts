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
const RESULT_SENTENCE = /^(?:then )?(?:if|when) (?:you|they) (?:win|lose) the flip\b/i; // (edh-d-20: "they" for a flip by another player)

const isBareFlipByYou = (s: Rec | undefined): boolean =>
  s !== undefined && s['op'] === 'flipCoin' && s['onWin'] === undefined && s['onLose'] === undefined;

/**
 * The flip a result sentence reads: the last top-level step of the sentence before it, or (std-copy-1, CR 608.2c, 118.12) the last instruction of "If you do, flip a
 * coin." (an `if` on an earlier instruction's result, no else or guard): the result sentence then happens only when that flip does. Else undefined.
 */
function flipOf(s: Rec | undefined): Rec | undefined {
  if (s === undefined) return undefined;
  if (s['op'] === 'flipCoin') return s;
  // edh-d-20 (CR 705.2, 608.2f; Fighting Chance, Mutalith Vortex Beast): "For each blocking creature, flip a coin. If you win the flip, ..." / "Flip a coin for each opponent you have. For each flip you win, ...":
  // the flip is the one instruction of the iteration (`forEach` over the group, one flip each); the result sentences are branches of that flip, read once for each iteration
  const iter = s['do'];
  if (s['op'] === 'forEach' && s['gather'] === undefined && s['as'] === 'each' && Array.isArray(iter) && iter.length === 1 && isRec(iter[0]) && iter[0]['op'] === 'flipCoin') return iter[0];
  // edh-c-19 (CR 705.2, 608.2c, 608.2d; Chaotic Goo): "At the beginning of your upkeep, you may flip a coin. If you win the flip, ..." the flip is the one instruction of the "may" of you; the
  // result sentences happen only when the flip does (they are branches of that flip, inside the option)
  const mayDo = s['do'];
  if (s['op'] === 'may' && isRec(s['who']) && s['who']['ref'] === 'you' && s['otherwise'] === undefined && s['guard'] === undefined && Array.isArray(mayDo) && mayDo.length === 1 && isRec(mayDo[0]) && mayDo[0]['op'] === 'flipCoin') return mayDo[0];
  const cond = s['cond'];
  const then = s['then'];
  if (s['op'] !== 'if' || !isRec(cond) || cond['cond'] !== 'did' || cond['not'] === true || s['else'] !== undefined || s['guard'] !== undefined || !Array.isArray(then)) return undefined;
  const last = then[then.length - 1];
  return isRec(last) && last['op'] === 'flipCoin' ? last : undefined;
}

/**
 * edh-next-128 (CR 705.1, 705.2, 608.2c; Yusri, Fortune's Flame): a flip of several coins by you with no instructions of its own ("Flip three coins.", "Flip that many coins."): the flip
 * "For each flip you win, X" / "For each flip you lose, Y" / "If you won N flips this way, Z" read. All of its coins are flipped first, then each later sentence happens in order (CR 608.2c).
 */
const isSeveralCoinsByYou = (f: Rec | undefined): f is Rec => {
  const who = f?.['who'];
  return f !== undefined && f['op'] === 'flipCoin' && isRec(who) && who['ref'] === 'you' && ((typeof f['count'] === 'number' && f['count'] > 1) || isRec(f['times']))
    && f['onWin'] === undefined && f['onLose'] === undefined && f['onTails'] === undefined && f['untilLose'] === undefined;
};
const FOR_EACH_FLIP = /^for each flip you (win|lose),/i;
/** The largest number of the "choose a number between A and B" (a fixed B) that a quantity `{q:'chosenNumber', link}` reads, among the steps before; else undefined. */
function mostChosen(before: Unit[], times: unknown): number | undefined {
  if (!isRec(times) || times['q'] !== 'chosenNumber' || typeof times['link'] !== 'string') return undefined;
  let most: number | undefined;
  for (const u of before) visit(u.steps, (n) => {
    if (n['op'] === 'chooseValue' && n['what'] === 'number' && n['link'] === times['link']) most = typeof n['max'] === 'number' ? n['max'] : undefined;
  });
  return most;
}

export function foldFlips(seq: Unit[], d?: Draft): void {
  // edh-next-128: the unit and the flip the last "For each flip you win / lose" sentence read, so the next one reads the same flip
  let severalRead: { unit: Unit; flip: Rec } | undefined;
  // edh-next-128 (CR 705.1, 608.2c): "Flip that many coins" (template eff.r4mech.flipCoins.n with a quantity that is not a literal number): the number of coins is read as the flip
  // begins, `times` (a literal stays `count`)
  for (const u of seq) visit(u.steps, (n) => {
    if (n['op'] === 'flipCoin' && isRec(n['count'])) {
      n['times'] = n['count'];
      delete n['count'];
    }
  });
  // edh-d-28 (CR 705.1, 608.2c; Two-Headed Giant): the unit and the name of the flip of two coins the last "If both coins come up heads / tails" sentence read, so the next one reads the same flip
  let bothRead: { unit: Unit; name: string } | undefined;
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
    // edh-d-20 (CR 705.2, 701.8a; Rakdos, the Showstopper): "Destroy each creature whose coin comes up tails." is the flip's lose branch (the creature of the iteration is remembered under `tails`) and, after
    // the loop, one destroy of everything remembered: the creatures whose coins came up tails are destroyed at the same time (ruling 2019-01-25)
    const tailsDestroy = u.steps.length === 2 && isRec(u.steps[1]) && u.steps[1]['op'] === 'destroy' && isRec(u.steps[1]['what']) && u.steps[1]['what']['ref'] === 'bound' && u.steps[1]['what']['name'] === 'tails';
    const s = u.steps.length === 1 || tailsDestroy ? u.steps[0]! : undefined;
    const cond = s?.['op'] === 'reflexive' ? s['when'] : s?.['cond'];
    const fail = (): void => setManual(u, { code: 'unbound-reference', reason: '"if / when you win / lose the flip" with no coin flip by you right before it (CR 705.2, 608.2c)', unresolved: true });
    if (s === undefined || !isRec(cond) || cond['cond'] !== 'flip') return fail();
    // edh-next-128 (CR 705.2, 608.2c; Yusri, Fortune's Flame): the sentences after a flip of several coins: "For each flip you win / lose, X" happens once for each flip won / lost,
    // "If you won N flips this way, Z" when at least N were won. The flips become called (each is won or lost) and the flip is named for the counts
    const eachFlip = FOR_EACH_FLIP.exec(u.text.trim());
    if (eachFlip !== null || cond['wonCount'] !== undefined) {
      const before = seq.slice(0, i).reverse().find((p) => p.manual !== undefined || p.steps.length > 0);
      const last = before !== undefined && !before.manual ? before.steps[before.steps.length - 1] : undefined;
      const flip = before !== undefined && severalRead !== undefined && severalRead.unit === before ? severalRead.flip : isSeveralCoinsByYou(last) ? last : undefined;
      if (flip !== undefined) {
        if (d === undefined || s['op'] !== 'if' || s['else'] !== undefined || s['guard'] !== undefined || !Array.isArray(s['then']) || (s['then'] as unknown[]).length === 0) return fail();
        const keys = Object.keys(cond).sort().join();
        if (eachFlip !== null ? keys !== 'cond,won' || cond['won'] !== (eachFlip[1]!.toLowerCase() === 'win') : keys !== 'cond,wonCount' || typeof cond['wonCount'] !== 'number' || cond['wonCount'] < 2) return fail();
        // review: "If you won N flips this way" only when N is the most coins the flip can flip (then "N flips" and "N or more" are the same; any other N, "exactly N" or "at least N"
        // is not stated): the literal count, or the largest number an earlier "choose a number between A and B" allows
        if (eachFlip === null) {
          const most = typeof flip['count'] === 'number' ? flip['count'] : mostChosen(seq.slice(0, i), flip['times']);
          if (most !== cond['wonCount']) return fail();
        }
        flip['called'] = true;
        if (typeof flip['as'] !== 'string') flip['as'] = freshName(d, 'flip');
        const step = String(flip['as']);
        u.steps = eachFlip !== null
          ? [{ op: 'repeat', times: { q: 'resultCount', step, ...(cond['won'] === true ? {} : { lost: true }) }, do: s['then'] }]
          : [{ op: 'if', cond: { cond: 'compare', left: { q: 'resultCount', step }, op: '>=', right: cond['wonCount'] }, then: s['then'] }];
        severalRead = { unit: u, flip };
        return;
      }
      if (cond['wonCount'] !== undefined) return fail();
    }
    // edh-d-28 (CR 705.1, 608.2c; Two-Headed Giant): "If both coins come up heads / tails, X" after "Flip two coins.": the number of coins of that flip that came up heads (the flip's result
    // count, uncalled: nobody wins or loses) is 2 / 0. The flip is the instruction right before the sentence, or right before the "If both coins ..." sentence(s) just read (same flip)
    if (typeof cond['both'] === 'string') {
      const sentence = u.steps.length === 1 ? u.steps[0]! : undefined;
      if (d === undefined || sentence === undefined || sentence['op'] !== 'if' || sentence['else'] !== undefined || sentence['guard'] !== undefined || !Array.isArray(sentence['then']) || Object.keys(cond).length !== 2) return fail();
      const before = seq.slice(0, i).reverse().find((p) => p.manual !== undefined || p.steps.length > 0);
      if (before === undefined || before.manual) return fail();
      let name: string;
      if (bothRead !== undefined && before === bothRead.unit) name = bothRead.name;
      else {
        const f = before.steps[before.steps.length - 1];
        const who = f?.['who'];
        // a flip of exactly two coins by you with no instructions of its own, called by nobody
        if (f === undefined || f['op'] !== 'flipCoin' || f['count'] !== 2 || !isRec(who) || who['ref'] !== 'you' || f['onWin'] !== undefined || f['onLose'] !== undefined || f['untilLose'] !== undefined || f['called'] !== undefined) return fail();
        if (typeof f['as'] !== 'string') f['as'] = freshName(d, 'flip');
        name = String(f['as']);
      }
      sentence['cond'] = { cond: 'compare', left: { q: 'resultCount', step: name }, op: '==', right: cond['both'] === 'heads' ? 2 : 0 };
      bothRead = { unit: u, name };
      return;
    }
    // std-copy-1 (CR 603.12, 705.2): "When you win the flip, X" is a reflexive triggered ability of the flip (lower/conditions.ts#lowerReflexive lifted its targets)
    const reflexive = s['op'] === 'reflexive' && Array.isArray(s['do']) && Array.isArray(s['targets']) && d !== undefined;
    // edh-d-20 (CR 705.2, 608.2c; Plasma Caster): "If you win the flip, X. Otherwise, Y." (the rider fl.otherwise added an `else`): Y is the branch of the other result
    const elseSteps = Array.isArray(s['else']) ? (s['else'] as Rec[]) : undefined;
    if (!reflexive && (s['op'] !== 'if' || (s['else'] !== undefined && elseSteps === undefined) || s['guard'] !== undefined || !Array.isArray(s['then']))) return fail();
    if (reflexive && s['else'] !== undefined) return fail();
    const prev = seq.slice(0, i).reverse().find((p) => p.manual !== undefined || p.steps.length > 0);
    if (prev === undefined || prev.manual) return fail();
    const flip = flipOf(prev.steps[prev.steps.length - 1]);
    if (flip === undefined) return fail();
    // edh-cast-7 (CR 608.2c, 705.2): "If you win the flip, you may exile ~. If you do, return it transformed ..." with the follow-up not understood: the branch would exile alone
    // and the card could not come back (review finding, Ral, Monsoon Mage); the result sentence stays manual with its follow-up, as before. Only that sentence (no contagion)
    const after = seq[i + 1];
    if (after !== undefined && after.manual !== undefined && /^if you do\b/i.test(after.text.trim())) {
      setManual(u, { code: 'no-template', reason: 'no template matches the sentence' }); // (the reason the sentence had before the results were read in either order)
      return;
    }
    const who = flip['who'];
    const side = tailsDestroy ? 'onTails' : cond['won'] === true ? 'onWin' : 'onLose'; // (edh-d-20: "whose coin comes up tails" is an uncalled flip, nobody wins or loses it)
    // edh-d-20 (CR 705.2, 608.2c; Planar Chaos): "that player flips a coin. If they lose the flip, ...": the results are read by the same player ("they"), the sentence says so; a flip by you
    // is read by "you win / lose the flip" alone
    const theyFlip = /^if they (?:win|lose) the flip\b/i.test(u.text.trim());
    if (!isRec(who) || (theyFlip ? who['ref'] === 'you' : who['ref'] !== 'you') || flip[side] !== undefined || flip['count'] !== undefined) return fail(); // r4-mech: one coin only
    if (reflexive) {
      // the trigger waits for the flip itself (effects/handlers/game.ts#flipCoin records the flip as done before it runs the branch of its result)
      if (typeof flip['as'] !== 'string') flip['as'] = freshName(d, 'flip');
      flip[side] = [{ ...s, when: { did: flip['as'] } }];
    } else {
      flip[side] = s['then'];
      // edh-next-129 (CR 705.2, 119.3; Game of Chaos): "..., and you decide whether to flip again" / "..., and that player decides whether to flip again" and "Double the life stakes with each
      // flip.": who decides after each result, and the doubled life amounts (effects/handlers/game.ts#flipWithStakes); a branch with an `else` takes none of them
      const decides = s['againDecides'];
      if (decides !== undefined || s['doubleLife'] !== undefined) {
        if (elseSteps !== undefined || !isRec(decides)) return fail();
        const stakes = (isRec(flip['stakes']) ? flip['stakes'] : (flip['stakes'] = {})) as Rec;
        stakes[side === 'onWin' ? 'winDecides' : 'loseDecides'] = decides;
        if (s['doubleLife'] === true) stakes['doubleLife'] = true;
      }
      if (elseSteps !== undefined) {
        const other = side === 'onWin' ? 'onLose' : 'onWin';
        if (flip[other] !== undefined) return fail();
        flip[other] = elseSteps;
      }
    }
    if (tailsDestroy) {
      // the flip must be the one of a loop over the creatures (`forEach` named `each`): its remembered creatures are gathered, then destroyed together after it
      const outer = prev.steps[prev.steps.length - 1]!;
      if (outer['op'] !== 'forEach' || outer['as'] !== 'each' || outer['gather'] !== undefined) return fail();
      outer['gather'] = 'tails';
      prev.steps.push(u.steps[1]!);
    }
    u.steps = [];
  });
}
