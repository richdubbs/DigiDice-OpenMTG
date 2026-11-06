/**
 * edh-players-9 (Commander lane edh-players): the folds of its templates (parser/templates/zz-cloud/edh-players-9.json), called from render/fold.ts#foldAt.
 *
 * `drawLoseCommanderValue` (CR 903.3, 107.3, 608.2h, 121.1, 119.3; Stinging Study, eff.edhp9.drawLose.commanderManaValue): "You draw X cards and you lose X life, where X is the mana
 * value of a commander you own on the battlefield or in the command zone.": you choose one of those commanders as it resolves (one commander, or one of two partners, ruling
 * 2021-04-16), X is its mana value (0 with no commander), fixed once; you draw X cards and lose X life. Only that exact shape: the choice, the `let`, the draw, the loss.
 */
import type { EffectStep, ObjectFilter } from '../types/ability';
import { acting } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';

/** The commanders "you own on the battlefield or in the command zone" (parser/holes/commander-qty.ts). */
const COMMANDERS: ObjectFilter = { commander: true, owner: 'you', zone: ['battlefield', 'command'] };

function drawLoseCommanderValue(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const [c, l, a, b] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (c?.op !== 'chooseObjects' || l?.op !== 'let' || a?.op !== 'draw' || b?.op !== 'loseLife' || c.as === undefined) return null;
  if ([c, l, a, b].some((s) => s.guard !== undefined) || a.as !== undefined || b.as !== undefined || a.who.ref !== 'you' || b.who.ref !== 'you' || c.who.ref !== 'you') return null;
  if (c.min !== 1 || c.max !== 1 || c.random === true || JSON.stringify(c.from) !== JSON.stringify({ ref: 'each', filter: COMMANDERS })) return null;
  if (JSON.stringify(l.value) !== JSON.stringify({ q: 'stat', stat: 'manaValue', of: { ref: 'bound', name: c.as } })) return null;
  const v = JSON.stringify({ q: 'var', name: l.name });
  if (JSON.stringify(a.count) !== v || JSON.stringify(b.amount) !== v) return null;
  if (list.slice(i + 4).some((s) => JSON.stringify(s).includes(`"name":"${c.as}"`) || JSON.stringify(s).includes(`"name":"${l.name}"`))) return null;
  const text = `draw X cards and you lose X life, where X is the mana value of a commander you own on the battlefield or in the command zone`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 4 };
}

export function foldEdhP9(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return drawLoseCommanderValue(list, i, st);
}
