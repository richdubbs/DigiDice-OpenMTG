/**
 * edh-next-129 (must-finish round "dice, coins and random", EDHREC 5,001-10,000): the folds of its templates (parser/templates/zz-cloud/edh-next-129.json), called from
 * render/fold.ts#foldAt. Each applies only when every part is exactly what the idiom says, with no guard, name, duration or link on any step it does not expect.
 */
import type { AbilityDef, EffectStep, Quantity } from '../types/ability';
import { abilityList } from './mods';
import { cloneState } from './state';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { alt, numWord } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * `copyThenReselectRandom` (CR 707.10, 115.7, 608.2c; Chef's Kiss, eff.edhn129.copy.thenReselectRandom and rid.edhn129.newTargets.notYours): "Copy it, then reselect the targets at random
 * for the spell and the copy. The new targets can't be you or a permanent you control.": a copy of one spell by you, bound, then the targets of that spell and of the copy reselected at
 * random, never you nor a permanent you control. Only those two steps, in that order.
 */
function copyThenReselectRandom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c, r] = [list[i], list[i + 1]];
  if (c?.op !== 'copy' || c.result !== 'spell' || !same(c.who, { ref: 'you' }) || c.as === undefined || c.guard !== undefined) return null;
  const extra = Object.keys(c).filter((k) => !['op', 'what', 'result', 'who', 'as', 'span', 'sentence'].includes(k) && (c as unknown as Record<string, unknown>)[k] !== undefined);
  if (extra.length > 0) return null;
  if (r?.op !== 'chooseNewTargets' || r.random !== true || r.notYours !== true || r.guard !== undefined || r.as !== undefined || !same(r.who, { ref: 'you' })) return null;
  if (!same(r.what, { ref: 'union', of: [c.what, { ref: 'bound', name: c.as }] })) return null;
  const it = K.obj(c.what, st, 'object').text;
  return { clauses: [plain(`copy ${it}, then reselect the targets at random for the spell and the copy. the new targets can't be you or a permanent you control`, { standalone: true })], consumed: 2 };
}

/**
 * `flipUntilLoseOrStop` (CR 705.1, 705.2, 608.2c; Fiery Gambit, eff.edhn129.flipUntilLoseOrStop, rid.edhn129.lostFlip.noEffect, eff.edhn129.ifWonFlips.orMore): "Flip a coin until you lose a
 * flip or choose to stop flipping. If you lose a flip, ~ has no effect. If you win one or more flips, ... If you win two or more flips, ...": the flips by you that may stop after a win, a
 * lost one counting none, then every `if` right after it that compares the number of flips won with a number ("N or more").
 */
function flipUntilLoseOrStop(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'flipCoin' || f.mayStop !== true || f.untilLose !== true || f.as === undefined || f.guard !== undefined || !same(f.who, { ref: 'you' })) return null;
  if (f.count !== undefined || f.onWin !== undefined || f.onLose !== undefined || f.onTails !== undefined || f.called !== undefined) return null;
  const parts = [`flip a coin until you lose a flip or choose to stop flipping${f.lostVoids === true ? '. if you lose a flip, ~ has no effect' : ''}`];
  let j = i + 1;
  for (; j < list.length; j++) {
    const s = list[j]!;
    if (s.op !== 'if' || s.guard !== undefined || (s.else?.length ?? 0) > 0 || s.cond.cond !== 'compare' || s.cond.op !== '>=' || typeof s.cond.right !== 'number') break;
    if (!same(s.cond.left, { q: 'resultCount', step: f.as })) break;
    parts.push(`if you win ${numWord(s.cond.right)} or more flips, ${K.steps(s.then, st)}`);
  }
  return { clauses: [plain(parts.join('. '), { standalone: true })], consumed: j - i };
}

/**
 * `flipWithLifeStakes` (CR 705.2, 119.3, 608.2c; Game of Chaos, eff.edhn129.ifFlip.win.decideAgain, eff.edhn129.ifFlip.lose.playerDecidesAgain, rid.edhn129.doubleLifeStakes): "Flip a coin. If
 * you win the flip, you gain 1 life and target opponent loses 1 life, and you decide whether to flip again. If you lose the flip, you lose 1 life and that opponent gains 1 life, and that
 * player decides whether to flip again. Double the life stakes with each flip.": one coin by you whose branches are plain life gains and losses, each said "<player> gains / loses N life".
 */
function flipWithLifeStakes(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'flipCoin' || f.stakes === undefined || f.guard !== undefined || f.as !== undefined || !same(f.who, { ref: 'you' }) || f.count !== undefined || f.untilLose !== undefined || f.called !== undefined || f.onTails !== undefined) return null;
  const { winDecides, loseDecides, doubleLife } = f.stakes;
  if (winDecides === undefined || loseDecides === undefined || doubleLife !== true || !same(winDecides, { ref: 'you' })) return null;
  const seen = new Set<string>();
  const life = (b: EffectStep[] | undefined): string | null => {
    if (b === undefined || b.length === 0) return null;
    const parts: string[] = [];
    for (const x of b) {
      if ((x.op !== 'gainLife' && x.op !== 'loseLife') || typeof x.amount !== 'number' || x.guard !== undefined || Object.keys(x).some((k) => !['op', 'who', 'amount', 'span', 'sentence'].includes(k))) return null;
      const you = same(x.who, { ref: 'you' });
      const named = you ? 'you' : K.player(x.who, st, 'subject').text;
      const again = !you && x.who.ref === 'target' && seen.has(x.who.id);
      if (!you && x.who.ref === 'target') seen.add(x.who.id);
      const who = again ? alt(named, 'that player', 'that opponent') : named; // an opponent named again is also "that opponent"
      parts.push(`${who} ${x.op === 'gainLife' ? (you ? 'gain' : 'gains') : you ? 'lose' : 'loses'} ${x.amount} life`);
    }
    return parts.join(' and ');
  };
  const win = life(f.onWin);
  const lose = life(f.onLose);
  if (win === null || lose === null) return null;
  const decider = K.player(loseDecides, st, 'subject').text;
  const text = `flip a coin. if you win the flip, ${win}, and you decide whether to flip again. if you lose the flip, ${lose}, and ${decider} decides whether to flip again. double the life stakes with each flip`;
  return { clauses: [plain(text, { standalone: true })], consumed: 1 };
}

/**
 * `mayHaveSelfBecomeXX` (CR 608.2d, 613.1d, 613.4b, 205.1a; Ebony Fly, eff.edhn129.may.have.becomeXX.artifactCreature.whereX): "Until end of turn, you may have ~ become an X/X Insect artifact
 * creature with flying, where X is the result.": your option to have this object become an artifact creature with those subtypes and abilities and a base power and toughness of one
 * number. Only that exact shape.
 */
function mayHaveSelfBecomeXX(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  if (m?.op !== 'may' || m.guard !== undefined || m.as !== undefined || m.otherwise !== undefined || !same(m.who, { ref: 'you' }) || m.do.length !== 1) return null;
  const e = m.do[0]!;
  if (e.op !== 'effect' || e.guard !== undefined || e.effects.length !== 1 || e.duration === undefined) return null;
  const c = e.effects[0]!;
  if (c.s !== 'continuous' || !same(c.affects, { ref: 'self' }) || c.mods.length !== 3 || Object.keys(c).some((k) => !['s', 'affects', 'mods'].includes(k))) return null;
  const [t, a, p] = c.mods as unknown as Record<string, unknown>[];
  if (t?.['layer'] !== 4 || !same(t['types'], { set: ['Artifact', 'Creature'] }) || !Array.isArray((t['subtypes'] as { set?: unknown })?.set) || Object.keys(t).length !== 3) return null;
  if (a?.['layer'] !== 6 || !Array.isArray(a['add']) || Object.keys(a).length !== 2) return null;
  if (p?.['layer'] !== '7b' || p['power'] === undefined || !same(p['power'], p['toughness']) || typeof p['power'] !== 'object' || Object.keys(p).length !== 3) return null;
  const subs = ((t['subtypes'] as { set: string[] }).set).join(' ');
  const abil = abilityList(a['add'] as AbilityDef[], cloneState(st), 'object');
  const dur = K.dur(e.duration, st);
  const x = K.qty(p['power'] as Quantity, st);
  const text = `${dur}, you may have ~ become an x/x ${subs} artifact creature with ${abil}, where x is ${x}`;
  return { clauses: [plain(text, { standalone: true })], consumed: 1 };
}

export function foldEdhN129(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return copyThenReselectRandom(list, i, st) ?? flipUntilLoseOrStop(list, i, st) ?? flipWithLifeStakes(list, i, st) ?? mayHaveSelfBecomeXX(list, i, st);
}
