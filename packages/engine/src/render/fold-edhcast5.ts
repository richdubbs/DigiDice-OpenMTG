/**
 * edh-cast-5 (Commander lane edh-cast): the folds of its templates (parser/templates/zz-cloud/edh-cast-5.json), called from render/fold.ts#foldAt.
 *
 * `gainHalfXDrawHalfX` (CR 107.1a, 107.3, 119.1, 121.1; Hydroid Krasis): "You gain half X life and draw half X cards. Round down each time.": you gain half of X, rounded
 * down, then draw half of X, rounded down. Only that exact shape: the two steps by the same player ("you" or a target player) with nothing but the amount (X halved,
 * rounded down), nothing else on either step.
 *
 * `exileTopHalf` (CR 107.1a, 701.13a, 401.1; Ulamog, the Defiler): "Target opponent exiles the top half of their library, rounded up.": the top cards of a player's own library,
 * half their number rounded up, put into exile by the move (the family half-of-own says the same of a mill). Only that shape: the move of those cards to exile and nothing else.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';
import { conjAny } from './text';
import { byPlayer, halfOfOwn } from './steps-util';

const HALF_X = JSON.stringify({ q: 'math', op: 'floorDiv', args: [{ q: 'X' }, 2] });
const YOU = JSON.stringify({ ref: 'you' });
const plainKeys = (step: object, allowed: string[]): boolean => Object.keys(step).every((k) => allowed.includes(k));

function gainHalfXDrawHalfX(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'gainLife' || JSON.stringify(a.amount) !== HALF_X || !plainKeys(a, ['op', 'who', 'amount'])) return null;
  if (b?.op !== 'draw' || JSON.stringify(b.who) !== JSON.stringify(a.who) || JSON.stringify(b.count) !== HALF_X || !plainKeys(b, ['op', 'who', 'count'])) return null;
  if (JSON.stringify(a.who) !== YOU && a.who.ref !== 'target') return null; // one player named by this sentence: you, or a target player
  const subj = K.player(a.who, st, 'subject');
  return { clauses: [plain(`${subj.text} ${conjAny('gain', subj.person)} half x life and ${conjAny('draw', subj.person)} half x cards. round down each time`, { standalone: true })], consumed: 2 };
}

function exileTopHalf(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'move' || a.what.ref !== 'topCards' || JSON.stringify(a.to) !== JSON.stringify({ zone: 'exile' }) || !plainKeys(a, ['op', 'what', 'to'])) return null;
  const who = a.what.player;
  if (who === undefined || halfOfOwn(a.what.count, 'library', who) !== 'up') return null;
  return { clauses: [byPlayer(who, st, 'exile', () => `the top half of ${K.player(who, st, 'possessive').text} library, rounded up`)], consumed: 1 };
}

export function foldEdhCast5(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return gainHalfXDrawHalfX(list, i, st) ?? exileTopHalf(list, i, st);
}
