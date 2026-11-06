/**
 * edh-b-14: the folds of its templates (parser/templates/zz-cloud/edh-b-14.json), called from render/fold.ts#foldAt. CR cites checked against the CR text of 2026-09-25.
 *
 * `playerReturnsCommanders` (CR 903.9, 408.1, 109.4; Leadership Vacuum, eff.edhb14.player.returns.commanders.theyControl): "Target player returns each commander they control from the
 * battlefield to the command zone.": every commander on the battlefield that the player a target names controls moves to the command zone (the owner's choice of CR 903.9a does not
 * apply: an effect returns the card, it is not a replacement of a graveyard or exile move). Only the target player or opponent as the controller.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

function playerReturnsCommanders(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  if (m?.op !== 'move' || m.guard !== undefined || m.what.ref !== 'each' || !('filter' in m.what)) return null;
  if (Object.keys(m).some((k) => !['op', 'what', 'to'].includes(k)) || JSON.stringify(m.to) !== '{"zone":"command"}') return null;
  const f = m.what.filter;
  if (Object.keys(f).length !== 3 || f.commander !== true || f.zone !== 'battlefield' || f.controller === undefined || typeof f.controller !== 'object' || !('ref' in f.controller) || f.controller.ref !== 'target') return null;
  const subj = K.player(f.controller, st, 'subject').text;
  return { clauses: [plain(`${subj} returns each commander they control from the battlefield to the command zone`, { standalone: true })], consumed: 1 };
}

export function foldEdhB14(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return playerReturnsCommanders(list, i, st);
}
