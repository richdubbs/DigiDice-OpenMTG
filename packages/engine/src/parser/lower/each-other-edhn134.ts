/**
 * edh-next-134 (CR 102.1, 608.2c; Oft-Nabbed Goat): "its owner draws that many cards and each other player loses that much life": in one sentence whose first instruction names ONE
 * player other than you as its subject (its owner, its controller, target player), "each other player" of the next instruction is every player other than THAT player, not other
 * than the controller. The `who` of the later step gets `than`, a copy of the earlier subject ({ref:'each', who:'otherPlayer', than}; effects/refs.ts). Only two top-level steps
 * next to each other in one sentence, the first with a `who` of one of those single-player kinds; nothing else is changed.
 */
import type { Draft, Rec } from './types';
import { clone, isRec } from './util';

const NAMED = new Set(['ownerOf', 'controllerOf', 'target']);

export function eachOtherThanNamed(d: Draft): void {
  for (const u of d.units) {
    if (u.manual !== undefined) continue;
    for (let k = 1; k < u.steps.length; k++) {
      const prev = u.steps[k - 1]!['who'];
      const who = u.steps[k]!['who'];
      if (!isRec(prev) || !isRec(who) || who['ref'] !== 'each' || who['who'] !== 'otherPlayer' || who['than'] !== undefined) continue;
      if (typeof prev['ref'] !== 'string' || !NAMED.has(prev['ref'])) continue;
      if (prev['ref'] === 'target' && !(d.targets.find((t) => t.id === prev['id'])?.kind === 'player')) continue;
      (u.steps[k] as Rec)['who'] = { ...who, than: clone(prev) };
    }
  }
}
