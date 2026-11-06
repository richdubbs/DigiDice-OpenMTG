/**
 * edh-next-3 (Commander lane edh-next): the folds of its templates (parser/templates/zz-cloud/edh-next-3.json), called from render/fold.ts#foldAt.
 *
 * `eachPlayerFractions` (CR 107.1a, 608.2e, 101.4, 119.3, 701.9a, 701.21a; Fraying Omnipotence, Pox; eff.edhn3.eachPlayer.half.creatures.roundUp and
 * eff.edhn3.eachPlayer.third.creaturesLands.roundUp): "Each player loses half their life, then discards half the cards in their hand, then sacrifices half the creatures they
 * control of their choice. Round up each time." and its "a third" form with a second sacrifice (of lands): for each player, a loss, a discard and one or two sacrifices of one
 * kind of permanent, each amount a fraction (a half or a third) of that player's own life, hand or permanents of that kind, rounded up. Only those exact shapes.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';

const it = { ref: 'iterating' };
const each = JSON.stringify({ ref: 'each', who: 'player' });

function eachPlayerFractions(list: EffectStep[], i: number): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'loseLife' || b?.op !== 'discard') return null;
  for (const [d, word] of [[2, 'half'], [3, 'a third of']] as const) {
    const frac = (q: unknown): string => JSON.stringify({ q: 'math', op: 'ceilDiv', args: [q, d] });
    if (JSON.stringify(a.amount) !== frac({ q: 'life', of: it }) || JSON.stringify(b.count) !== frac({ q: 'zoneSize', zone: 'hand', of: it })) continue;
    const sacrifices = d === 2 ? [['Creature', 'creatures']] : [['Creature', 'creatures'], ['Land', 'lands']];
    const steps: EffectStep[] = [a, b];
    for (let k = 0; k < sacrifices.length; k++) {
      const c = list[i + 2 + k];
      const [type] = sacrifices[k]!;
      const filter = { types: [type], controller: it };
      if (c?.op !== 'sacrificeChoice' || c.mode !== undefined || c.cantAs !== undefined || c.exploit !== undefined) return null;
      if (JSON.stringify(c.filter) !== JSON.stringify(filter) || JSON.stringify(c.count) !== frac({ q: 'count', of: { ref: 'each', filter } })) return null;
      steps.push(c);
    }
    if (steps.some((x) => x.guard !== undefined || x.as !== undefined || JSON.stringify((x as { who?: unknown }).who) !== each) || b.filter !== undefined || b.mode !== undefined || b.cantAs !== undefined) return null;
    const sac = sacrifices.map(([, plural]) => `sacrifices ${word} the ${plural} they control of their choice`).join(', then ');
    const text = `each player loses ${word} their life, then discards ${word} the cards in their hand, then ${sac}. round up each time`;
    return { clauses: [plain(text, { standalone: true })], consumed: steps.length };
  }
  return null;
}

export function foldEdhN3(list: EffectStep[], i: number): Folded | null {
  return eachPlayerFractions(list, i);
}
