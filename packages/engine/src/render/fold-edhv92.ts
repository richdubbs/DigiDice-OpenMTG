/**
 * edh-c-92 (Commander effort, coordinator C): the folds of its templates (parser/templates/zz-cloud/edh-c-92.json), called from render/fold.ts#foldAt. Each applies only
 * when every part is exactly what the idiom says. CR cites are from the Comprehensive Rules text of 2026-09-25.
 *
 * `eachOpponentMayReturnFromGraveyard` (CR 101.4, 608.2d, 110.2a, 400.7; Enslaved Horror): "Each other player may return a creature card from their graveyard to the
 * battlefield.": each opponent in APNAP order chooses up to one of the described cards in their own graveyard, then every card chosen is put onto the battlefield at the same
 * time under its owner's control. "Each other player" is the same set of players as "each opponent" (no teams; family each-other-player-opponent). Exactly the two steps of
 * template eff.edhv92.eachOpponent.may.returnGraveyard.bf.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { bind } from './steps-util';
import { alt } from './text';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const ITERATING = { ref: 'iterating' };

function eachOpponentMayReturnFromGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.guard !== undefined || a.random !== undefined || a.groupLimit !== undefined || a.startingWith !== undefined || a.min !== 0 || a.max !== 1) return null;
  if (!same(a.who, ITERATING) || !same(a.perPlayer, { ref: 'each', who: 'opponent' }) || a.from.ref !== 'each' || a.as === undefined) return null;
  const f = a.from.filter;
  if (f.anyOf?.length !== 1 || f.zone !== 'graveyard' || !same(f.owner, ITERATING) || f.isCard !== true || Object.keys(f).some((k) => !['anyOf', 'zone', 'owner', 'isCard'].includes(k))) return null;
  if (b?.op !== 'move' || b.guard !== undefined || b.as !== undefined || b.until !== undefined || b.link !== undefined || !same(b.what, { ref: 'bound', name: a.as })) return null;
  if (!same(b.to, { zone: 'battlefield', controller: 'owner' })) return null;
  const kind = f.anyOf[0]!;
  bind(st, a.as, { nouns: [...K.nounsOf(kind), 'card'], plural: true, eachChoseMoved: 'opponent' }); // edh-next-91: and the opponents who did, counted by "for each opponent who does" (steps-flow.ts#repeat)
  const card = K.np({ ...kind, isCard: true, zone: 'graveyard' }, st, { det: 'a', noZone: true });
  return { clauses: [plain(`${alt('each opponent', 'each other player')} may return ${card} from their graveyard to the battlefield`, { standalone: true })], consumed: 2 };
}

/** The folds of edh-c-92 (render/fold.ts#foldAt). */
export function foldEdhV92(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return eachOpponentMayReturnFromGraveyard(list, i, st);
}
