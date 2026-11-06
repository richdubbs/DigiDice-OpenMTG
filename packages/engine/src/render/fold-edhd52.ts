/**
 * Commander lane d-rank-2, round edh-d-52 (coordinator D): the folds of the steps its templates build (render/fold.ts#foldAt tries `foldEdhD52` after the other slices' own folds).
 * A fold applies only when every part is exactly what the idiom says. This file imports no value from render/fold.ts (an import cycle); it takes the types only.
 */
import type { EffectStep } from '../types/ability';
import { fragment, plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import { withVariants, type RenderState } from './state';
import { alt, NoRenderer, parseMarked, serializeMarked, type MarkedNode } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * "Target creature you control gets +1/+1 until end of turn and fights target creature you don't control." (Ent's Fury; CR 701.14a, 611.2a, 613.4c, 608.2c): a pump of one object
 * until a duration, then that same object fights another, said as one sentence with the subject once (eff.edhd52.pump.andFights). Exactly a pump step (one continuous effect of
 * one power and toughness change) and a fight of the same object; the two steps written apart stay readings too.
 */
function pumpAndFights(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'effect' || b?.op !== 'fight' || a.guard !== undefined || a.as !== undefined || b.guard !== undefined || b.as !== undefined || b.pairs !== undefined || b.by !== undefined) return null;
  if (a.effects.length !== 1) return null;
  const ce = a.effects[0]!;
  if (ce.s !== 'continuous' || ce.cda !== undefined || ce.mods.length !== 1 || ce.mods[0]!.layer !== '7c' || !same(ce.affects, b.a)) return null;
  // the fight clause without its subject (the pump before it names it)
  const fights = (v: RenderState): string => {
    const nodes = parseMarked(fragment(K.clause(b, v)));
    const head = nodes[0];
    const isSubject = (n: MarkedNode[]): boolean => n.length === 1 && typeof n[0] === 'string';
    if (head === undefined || typeof head === 'string' || !head.alts.every(isSubject) || typeof nodes[1] !== 'string' || !nodes[1].startsWith(' fights ')) {
      throw new NoRenderer('a fight clause after a pump whose words do not begin with its subject');
    }
    return serializeMarked([nodes[1].slice(1), ...nodes.slice(2)]);
  };
  const [one, apart] = withVariants(st, [
    (v) => `${fragment(K.clause(a, v))} and ${fights(v)}`,
    (v) => `${fragment(K.clause(a, v))}${alt('. ', ' and ', ', then ', '. then ')}${fragment(K.clause(b, v))}`,
  ]);
  return { clauses: [plain(alt(one!, apart!), { leadThen: true })], consumed: 2 };
}


/**
 * "Target creature you control fights target creature you don't control. The creature you control gets +2/+2 until end of turn before it fights if you control a creature with
 * power 4 or greater." (Savage Punch; CR 701.14a, 611.2a, 608.2c, 608.2e): the instructions run as "if <condition>, the first creature gets +N/+N until end of turn" and then the fight
 * (rider rid.edhd52.fight.pumpBeforeIfCond puts the pump before the fight); Oracle says the fight first, then the pump with "before it fights". Exactly a conditional pump of the
 * fighting creature right before its fight.
 */
function fightsThenPumpBeforeIfCond(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'if' || b?.op !== 'fight' || a.guard !== undefined || !Array.isArray(a.else) || a.else.length !== 0 || a.as !== undefined || b.guard !== undefined || b.as !== undefined || b.pairs !== undefined || b.by !== undefined) return null;
  if (a.then.length !== 1) return null;
  const p = a.then[0]!;
  if (p.op !== 'effect' || p.guard !== undefined || p.as !== undefined || p.effects.length !== 1 || st.chosenPair !== undefined) return null; // (the rider's own `if` only, marked by its empty `else`: a conditional pump written otherwise keeps its own readings)
  const ce = p.effects[0]!;
  if (ce.s !== 'continuous' || ce.cda !== undefined || ce.mods.length !== 1 || ce.mods[0]!.layer !== '7c' || !same(ce.affects, b.a)) return null;
  const [one] = withVariants(st, [
    (v) => { const f = fragment(K.clause(b, v)); return `${f}. ${fragment(K.clause(p, v))} before it fights if ${K.cond(a.cond, v)}`; },
  ]);
  return { clauses: [plain(one!, { standalone: true })], consumed: 2 };
}

/** The folds of edh-d-52 (render/fold.ts#foldAt). */
export function foldEdhD52(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return pumpAndFights(list, i, st) ?? fightsThenPumpBeforeIfCond(list, i, st);
}
