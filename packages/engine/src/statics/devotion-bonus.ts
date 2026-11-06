import type { GameState } from '../types/state';
import type { ObjectId, PlayerId } from '../types/ids';
import type { Chars } from '../rules/characteristics';
import { baseChars } from '../rules/base-chars';

/**
 * edh-next-140 (CR 700.5, 700.5a; Altar of the Pantheon: "Your devotion to each color and each combination of colors is increased by one."): how much greater `player`'s devotion to every
 * color and combination of colors is (once for a devotion to two colors: its ruling 2020-01-24), from the rules `devotionBonus` (a plain number, default 1) of the static abilities of the
 * permanents that player controls. `charsOf` gives an object's characteristics as found (statics/match.ts counts a devotion inside the layers, with the characteristics found so far;
 * effects/eval.ts and actions/announce-cond.ts with the finished ones). A permanent's printed abilities count too: the ruling of 2020-01-24 says its bonus stays when it loses its abilities
 * (the effect applies before the one that removes them). Null when such a rule has a condition, names another player or has a value that isn't a number: the devotion is then not read.
 */
export function devotionBonusOf(s: GameState, charsOf: (id: ObjectId) => Chars | undefined, player: PlayerId): number | null {
  let n = 0;
  for (const id of s.zones.battlefield) {
    const o = s.objects[id];
    if (!o || o.phasedOut) continue; // a phased-out permanent is treated as though it doesn't exist (CR 702.26b)
    const c = charsOf(id);
    const printed = o.faceDown === true ? [] : baseChars(s, o).abilities;
    const seen = new Set<string>();
    for (const a of [...(c?.abilities ?? []), ...printed]) {
      const d = a.def;
      if (d.kind !== 'static') continue;
      for (const e of d.effects) {
        if (e.s !== 'rule' || e.rule !== 'devotionBonus') continue;
        if (d.condition !== undefined || (e.player !== undefined && e.player.ref !== 'you') || (e.value !== undefined && typeof e.value !== 'number')) return null;
        const key = JSON.stringify(d);
        if (seen.has(key)) continue; // the printed ability that is still there counts once
        seen.add(key);
        if ((c?.controller ?? o.controller) === player) n += e.value ?? 1;
      }
    }
  }
  return n;
}
