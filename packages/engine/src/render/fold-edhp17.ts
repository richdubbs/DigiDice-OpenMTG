/**
 * edh-players-17 (Commander lane edh-players): the folds of its templates (parser/templates/zz-cloud/edh-players-17.json), called from render/fold.ts#foldAtPlain.
 *
 * `youAndPlayerEachGain` (CR 119.1, 119.3, 101.4; Angel of Destiny, eff.edhp17.gainLife.youAndPlayer): "you and that player each gain 2 life" / "... gain that much life": the
 * controller and one other named player (`also`) gain the same amount in one step, said once with "each" (as render/fold.ts#youAndPlayerEachDraw does for draws). Only a fixed
 * number or the amount of the triggering event, you first, then one other player (never a group); nothing bound or guarded. A player named twice gains both amounts as one event (effects/handlers/lifedamage.ts).
 */
import type { EffectStep } from '../types/ability';
import { acting, plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function youAndPlayerEachGain(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'gainLife' || a.also === undefined || a.who.ref !== 'you' || a.also.ref === 'you' || a.also.ref === 'each' || a.guard !== undefined || a.as !== undefined) return null;
  const amount = a.amount;
  const eventAmount = typeof amount === 'object' && amount.q === 'eventAmount' && Object.keys(amount).length === 1;
  if (typeof amount !== 'number' && !eventAmount) return null;
  const other = K.player(a.also, st, 'subject');
  if (other.person !== 'sg') return null;
  const mine = K.clause({ ...a, also: undefined } as EffectStep, st);
  if (!mine.imp.startsWith('gain ') || mine.standalone === true) return null;
  const text = `you and ${other.text} each ${mine.imp}`;
  return { clauses: [acting('you', text, text)], consumed: 1 };
}

/**
 * `forEachVoteGainControl` (CR 701.38a, 701.38d, 108.3, 608.2d, 608.2f, 613.1b; Expropriate, eff.edhp17.forEachVote.gainControlOwnedByVoter): "For each money vote, choose a permanent
 * owned by the voter and gain control of it.": one iteration per vote cast for the word, over the voter, in which the controller chooses a permanent the voter owns and gains control
 * of it for good. Only that shape: the choice of exactly one permanent by "you" from a description owned by the iteration player, then the permanent control change of what was chosen.
 */
function forEachVoteGainControl(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'forEach' || f.over.ref !== 'votedFor' || f.guard !== undefined || f.as !== 'voter' || f.gather !== undefined || f.do.length !== 2) return null;
  const [a, b] = f.do as [EffectStep, EffectStep];
  if (a.op !== 'chooseObjects' || b.op !== 'effect' || a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.random === true || a.guard !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined || a.as === undefined) return null;
  if (a.from.ref !== 'each' || !('filter' in a.from) || !same(a.from.filter.owner, { ref: 'bound', name: 'voter' }) || a.from.filter.anyOf?.length !== 1) return null;
  const { anyOf, ...rest } = a.from.filter;
  if (Object.keys(rest).length !== 1 || rest.owner === undefined) return null;
  if (b.duration.d !== 'permanent' || b.guard !== undefined || b.effects.length !== 1) return null;
  const e = b.effects[0]!;
  if (e.s !== 'continuous' || !same(e.affects, { ref: 'bound', name: a.as }) || !same(e.mods, [{ layer: 2, controller: { ref: 'you' } }])) return null;
  return { clauses: [plain(`for each ${f.over.votes.choice} vote, choose ${K.np(anyOf[0]!, st, { det: 'a' })} owned by the voter and gain control of it`, { standalone: true })], consumed: 1 };
}

/**
 * `exileEachUnlessOnlyChosenColor` (CR 105.2a, 105.2c, 608.2d, 406.2; Selective Obliteration, eff.edhp17.exileEach.unlessColorlessOrOnlyControllersColor): "Then exile each permanent unless it's
 * colorless or it's only the color its controller chose.": every object of the description on the battlefield that is not colorless and not exactly the one color its own controller chose
 * in the choice before (the choice of each player), exiled together. Only that filter and nothing else on the step.
 */
function exileEachUnlessOnlyChosenColor(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  const c = list[i - 1];
  if (m?.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.to.zone !== 'exile' || Object.keys(m.to).length !== 1 || m.what.ref !== 'each' || !('filter' in m.what)) return null;
  const { anyOf, not, ...rest } = m.what.filter;
  if (anyOf?.length !== 1 || Object.keys(rest).length !== 0 || not === undefined) return null;
  if (!same(not, { anyOf: [{ colorless: true }, { onlyColorChosenByController: 'chosenColor' }] })) return null;
  if (c?.op !== 'chooseValue' || c.what !== 'color' || c.link !== 'chosenColor' || !same(c.who, { ref: 'each', who: 'player' })) return null;
  return { clauses: [plain(`then exile ${K.np(anyOf[0]!, st, { det: 'each' })} unless it's colorless or it's only the color its controller chose`, { standalone: true })], consumed: 1 };
}

export function foldEdhP17(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return youAndPlayerEachGain(list, i, st) ?? forEachVoteGainControl(list, i, st) ?? exileEachUnlessOnlyChosenColor(list, i, st);
}
