/**
 * edh-d-36 (Commander coordinator D, lane counter-modes): the folds of its templates (parser/templates/zz-cloud/edh-d-36.json), called from render/fold.ts#foldAt. Each applies only when
 * every part is exactly what the idiom says. A new fold file never imports a value from render/fold.ts (an import cycle).
 *
 * `lookPutOneBackRestGraveyard` (CR 701.20a, 401.4, 404.1, 608.2c, 608.2d; Dimir Charm, eff.edhd36.look.putOneBack.restGraveyard): "Look at the top three cards of target player's library. Put one
 * back and the rest into that player's graveyard.": you look at the top cards of a player's library, choose one of them, it goes back on top of that library, and every other one of the cards you
 * looked at goes to its owner's graveyard.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import { K } from './kernel';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function lookPutOneBackRestGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, c, m1, m2] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (a?.op !== 'look' || c?.op !== 'chooseObjects' || m1?.op !== 'move' || m2?.op !== 'move' || a.as === undefined || c.as === undefined) return null;
  if (a.guard !== undefined || !same(a.who, { ref: 'you' }) || a.at.ref !== 'topCards' || Object.keys(a).some((k) => !['op', 'who', 'at', 'as'].includes(k))) return null;
  const seen = { ref: 'bound', name: a.as };
  const kept = { ref: 'bound', name: c.as };
  if (c.guard !== undefined || !same(c.who, { ref: 'you' }) || c.min !== 1 || c.max !== 1 || c.random === true || c.groupLimit !== undefined || c.perPlayer !== undefined) return null;
  if (!same(c.from, { ref: 'each', filter: { is: seen, zone: 'library' } })) return null;
  if (m1.guard !== undefined || !same(m1.what, kept) || !same(m1.to, { zone: 'library', position: 'top' }) || Object.keys(m1).some((k) => !['op', 'what', 'to'].includes(k))) return null;
  if (m2.guard !== undefined || !same(m2.what, { ref: 'each', filter: { is: seen, not: { is: kept }, zone: 'library' } }) || !same(m2.to, { zone: 'graveyard' }) || Object.keys(m2).some((k) => !['op', 'what', 'to'].includes(k))) return null;
  if (list.slice(i + 4).some((x) => JSON.stringify(x).includes(`"${a.as}"`) || JSON.stringify(x).includes(`"${c.as}"`))) return null;
  const look = K.steps([a], st);
  const them = K.player(a.at.player, st, 'possessive').text;
  return { clauses: [plain(look, { standalone: true }), plain(`put one back and the rest into ${them} graveyard`, { standalone: true })], consumed: 4 };
}

export function foldEdhD36(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return lookPutOneBackRestGraveyard(list, i, st);
}
