/**
 * edh-next-138 (CR 701.20a, 608.2c, 608.2d; Fisher's Talent, eff.edhn138.may.reveal.obj.if): "You may reveal it if it's a land card. Create a 1/1 blue Fish creature token if you revealed
 * it this way.": an `if` whose only instruction is your option to reveal one named card, followed by one instruction done only if that option was taken (its trailing "if", a `guard`),
 * which says its condition last. Null for any other shape (the general renderers then say it or refuse).
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

type MayStep = Extract<EffectStep, { op: 'may' }>;

function revealIfThenThisWay(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'if' || b === undefined || a.else !== undefined || a.guard !== undefined) return null;
  const may = a.then.length === 1 && a.then[0]!.op === 'may' ? (a.then[0] as MayStep) : null;
  if (may === null || may.who.ref !== 'you' || may.otherwise !== undefined || may.guard !== undefined || typeof may.as !== 'string' || may.do.length !== 1) return null;
  const rev = may.do[0]!;
  if (rev.op !== 'reveal' || rev.who.ref !== 'you' || rev.what.ref !== 'bound' || rev.guard !== undefined || rev.as !== undefined) return null;
  // the instruction after it, done only if the option was taken: its own condition (a trailing "if", `guard`) is that it was
  const g = b.guard;
  if (g === undefined || g.cond !== 'did' || g.step !== may.as || g.not === true || Object.keys(g).length !== 2 || b.op === 'if' || b.op === 'may') return null;
  const { guard: _g, ...bare } = b;
  const first = `you may reveal ${K.obj(rev.what, st, 'object').text} if ${K.cond(a.cond, st)}`;
  const then = K.steps([bare as EffectStep], st);
  return { clauses: [plain(`${first}. ${then} if you revealed it this way`, { standalone: true })], consumed: 2 };
}

/**
 * edh-next-138 (CR 614.15, 608.2c, 107.3a; From Under the Floorboards, eff.edhn138.tappedTokensAndLife.insteadX): "Create three tapped 2/2 black Zombie creature tokens and you gain 3 life. If
 * this spell's madness cost was paid, instead create X of those tokens and you gain X life.": an `if` whose `else` is the token creation and the life gain said first and whose `then` is
 * the same two instructions with X as the number and the amount. Null for any other shape.
 */
function tokensAndLifeInsteadX(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  if (s?.op !== 'if' || s.guard !== undefined || s.else === undefined || s.then.length !== 2 || s.else.length !== 2) return null;
  const [t1, l1] = s.then;
  const [t0, l0] = s.else;
  if (t0?.op !== 'createToken' || t1?.op !== 'createToken' || l0?.op !== 'gainLife' || l1?.op !== 'gainLife') return null;
  const X = JSON.stringify({ q: 'X' });
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  if (!same({ ...t1, count: null }, { ...t0, count: null }) || JSON.stringify(t1.count) !== X || t0.tapped !== true || t0.as !== undefined || t1.as !== undefined) return null;
  if (!same({ ...l1, amount: null }, { ...l0, amount: null }) || JSON.stringify(l1.amount) !== X || l0.who.ref !== 'you') return null;
  const first = K.steps([t0, l0], st);
  return { clauses: [plain(`${first}. if ${K.cond(s.cond, st)}, instead create x of those tokens and you gain x life`, { standalone: true })], consumed: 1 };
}

/** The folds of this round's templates, called from render/fold.ts#foldAtPlain. */
export function foldEdhN138(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return revealIfThenThisWay(list, i, st) ?? tokensAndLifeInsteadX(list, i, st);
}
