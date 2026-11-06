/**
 * edh-cast-15 (Commander lane edh-cast): the folds of its templates (parser/templates/zz-cloud/edh-cast-15.json), called from render/fold.ts#foldAt. Each applies only when every
 * part is exactly what the idiom says.
 *
 * `copyAllSpellsThenOtherAbilities` (CR 707.10, 707.10c, 113.7a, 608.2c; Ulalek, Fused Atrocity, eff.edhc15.copy.all.spells.thenOtherAbilities): "Copy all spells you control, then
 * copy all other activated and triggered abilities you control. You may choose new targets for the copies.": the copy of every spell of yours on the stack, then the copy of every
 * activated and triggered ability of yours on the stack but the one being resolved. The rider sentence gives both copies the option to choose new targets, said once for both.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const YOU = { ref: 'you' };
const SPELLS = { ref: 'each', filter: { controller: 'you', stackKind: 'spell', zone: 'stack' } };
const ABILITIES = { ref: 'each', filter: { anyOf: [{ stackKind: 'activatedAbility' }, { stackKind: 'triggeredAbility' }], controller: 'you', zone: 'stack' } };

function copyAllSpellsThenOtherAbilities(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'copy' || b?.op !== 'copy' || a.result !== 'spell' || b.result !== 'spell' || !same(a.who, YOU) || !same(b.who, YOU) || !same(a.what, SPELLS) || !same(b.what, ABILITIES) || b.exceptThis !== true) return null;
  if (a.exceptThis !== undefined || a.count !== undefined || b.count !== undefined || a.except !== undefined || b.except !== undefined || a.gains !== undefined || b.gains !== undefined || a.noManaCost !== undefined || b.noManaCost !== undefined) return null;
  if (a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined || a.newTargets !== b.newTargets || (a.newTargets !== undefined && a.newTargets !== 'may')) return null;
  const tail = a.newTargets === 'may' ? '. you may choose new targets for the copies' : '';
  return { clauses: [plain(`copy all spells you control, then copy all other activated and triggered abilities you control${tail}`, { standalone: true })], consumed: 2 };
}

/**
 * `blueOrBlackCantCounterOrTarget` (CR 701.6a, 115.1, 101.2, 611.2a; Autumn's Veil, eff.edhc15.cantBeCounteredOrTargeted.byBlueOrBlackSpells.thisTurn): one effect until end of turn
 * of exactly two rules, "Spells you control can't be countered by blue or black spells this turn, and creatures you control can't be the targets of blue or black spells this turn."
 */
function blueOrBlackCantCounterOrTarget(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'effect' || !same(a.duration, { d: 'endOfTurn' }) || a.effects.length !== 2) return null;
  const [x, y] = a.effects;
  const other = { colors: ['U', 'B'], stackKind: 'spell' };
  if (x?.s !== 'restrict' || y?.s !== 'restrict' || !same(x, { s: 'restrict', subject: { ref: 'each', filter: { controller: 'you', stackKind: 'spell', zone: 'stack' } }, mode: 'cant', action: 'beCountered', other })
    || !same(y, { s: 'restrict', subject: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, mode: 'cant', action: 'beTargeted', other })) return null;
  if (a.guard !== undefined || a.as !== undefined) return null;
  return { clauses: [plain("spells you control can't be countered by blue or black spells this turn, and creatures you control can't be the targets of blue or black spells this turn", { standalone: true })], consumed: 1 };
}

export function foldEdhCast15(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return copyAllSpellsThenOtherAbilities(list, i, st) ?? blueOrBlackCantCounterOrTarget(list, i, st);
}
