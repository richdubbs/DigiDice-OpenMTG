/**
 * edh-next-143 (must-finish round: library, draw and search): the fold of its Warp World template (parser/templates/zz-cloud/edh-next-143.json), called from render/fold.ts#foldAt.
 *
 * `warpWorld` (CR 101.4, 701.24a, 701.20a, 608.2c, 110.2, 303.4f, 401.4; Warp World, rulings 2009-10-01): "Each player shuffles all permanents they own into their library, then reveals
 * that many cards from the top of their library. Each player puts all artifact, creature, and land cards revealed this way onto the battlefield, then does the same for enchantment
 * cards, then puts all cards revealed this way that weren't put onto the battlefield on the bottom of their library.": for each player, the move of every permanent they own into
 * their library, their shuffle and the reveal of as many top cards as that move moved (the reveals gathered into one group); then every artifact, creature and land card of the group
 * onto the battlefield under its owner's control, then every enchantment card of it the same way, then the rest of it to the bottom of its owner's library in an order of their choice.
 * Exactly the four steps of template eff.edhn143.eachPlayer.shufflePermanents.revealThatMany.putTypesThenEnchantments.
 */
import type { EffectStep } from '../types/ability';
import { plain } from './clause';
import type { Folded } from './fold';
import type { RenderState } from './state';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function warpWorld(list: EffectStep[], i: number, _st: RenderState): Folded | null {
  const [f, a, b, c] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (f?.op !== 'forEach' || a?.op !== 'move' || b?.op !== 'move' || c?.op !== 'move') return null;
  const each = { ref: 'bound', name: f.as };
  if (f.guard !== undefined || !same(f.over, { ref: 'each', who: 'player' }) || f.gather === undefined || f.inDirection !== undefined || f.do.length !== 3) return null;
  const [m, sh, rv] = f.do;
  if (m?.op !== 'move' || sh?.op !== 'shuffle' || rv?.op !== 'reveal' || typeof m.as !== 'string' || rv.as !== f.gather) return null;
  if (!same({ ...m, as: undefined }, { op: 'move', what: { ref: 'each', filter: { zone: 'battlefield', owner: each } }, to: { zone: 'library', owner: each }, as: undefined })) return null;
  if (!same(sh, { op: 'shuffle', who: each })) return null;
  if (!same(rv, { op: 'reveal', who: each, what: { ref: 'topCards', player: each, count: { q: 'resultCount', step: m.as } }, as: f.gather })) return null;
  const group = { ref: 'bound', name: f.gather };
  if (!same(a, { op: 'move', what: { ref: 'each', filter: { anyOf: [{ types: ['Artifact'] }, { types: ['Creature'] }, { types: ['Land'] }], is: group, zone: 'library' } }, to: { zone: 'battlefield', controller: 'owner' } })) return null;
  if (!same(b, { op: 'move', what: { ref: 'each', filter: { types: ['Enchantment'], is: group, zone: 'library' } }, to: { zone: 'battlefield', controller: 'owner' } })) return null;
  if (!same(c, { op: 'move', what: { ref: 'each', filter: { is: group, zone: 'library' } }, to: { zone: 'library', position: 'bottom', order: 'chosen' } })) return null;
  return {
    clauses: [plain("each player shuffles all permanents they own into their library, then reveals that many cards from the top of their library. each player puts all artifact, creature, and land cards revealed this way onto the battlefield, then does the same for enchantment cards, then puts all cards revealed this way that weren't put onto the battlefield on the bottom of their library", { standalone: true })],
    consumed: 4,
  };
}

export function foldEdhN143(list: EffectStep[], i: number, st: RenderState): Folded | null {
  return warpWorld(list, i, st);
}
