/**
 * Casting a double-faced card transformed or converted: disturb and more than meets the eye (CR 702.146a, 702.162a, 712.11a, 712.8c; m6 design 3.6). Owner:
 * M6-4.
 *
 * A transforming double-faced card whose FRONT face has disturb [cost] may be cast from its owner's graveyard as the method `disturb`, by paying [cost] rather
 * than its mana cost (CR 702.146a, 118.9: an alternative cost); one whose front face has more than meets the eye [cost] may be cast from the hand as the method
 * `more than meets the eye` (CR 702.162a). Either way the spell is put onto the stack with its back face up (CR 712.11a): from the moment it is announced it
 * has only the characteristics of its back face (`charsOverride`, so the timing and "can't cast" checks are judged on them, CR 712.11c-d), with the mana value
 * of its front face (CR 712.8c). It resolves into a permanent back face up (CR 702.146b, 712.13; core/resolve.ts keeps the face it had on the stack).
 *
 * Only these zones (and, CMDF, a commander from the command zone with more than meets the eye, CR 903.8; cast-opt/zones.ts): an effect that lets a player
 * cast cards from another zone does not offer these methods yet.
 */
import type { CardDef } from '../../types/card';
import { manaValue } from '../../types/mana';
import type { BaseChars } from '../../rules/characteristics';
import { faceChars } from '../../rules/characteristics';
import { costForManaValue, fromFace } from '../../rules/base-chars';
import type { CastOptionProvider } from '../cast-options';
import type { Game } from '../../core/game';
import type { PlayerId } from '../../types/ids';
import type { GameObject } from '../../types/state';
import { castableFromHandOrCommand } from './zones';

/** A transforming double-faced card (CR 712.11a: only it can be cast with its back face up). */
const transforming = (def: CardDef | undefined): def is CardDef => def !== undefined && def.layout === 'transform' && def.faces.length === 2;

/** The cost of `keyword` printed on the front face (CR 702.146a, 702.162a: the ability is on the front face), or null. */
function keywordCost(def: CardDef, keyword: string) {
  return faceChars(def, 0).keywords.find((k) => k.keyword === keyword)?.cost ?? null;
}

/** CR 712.8c: the back face's characteristics, with the mana value of the front face (a fresh record: every array the caller's own). */
export function backFaceSpellChars(def: CardDef): BaseChars {
  const c = fromFace(def.faces[1]!, 1);
  c.manaValue = manaValue(costForManaValue(def, 1, c.manaCost), 0);
  return c;
}

function provider(name: 'disturb' | 'more than meets the eye', zone: 'graveyard' | 'hand'): CastOptionProvider {
  // CMDF, CR 702.162a, 903.8: more than meets the eye "functions in any zone from which the spell may be cast": the hand, and a commander's command zone
  const from = (g: Game, o: GameObject, player: PlayerId): boolean =>
    zone === 'hand' ? castableFromHandOrCommand(g, o, player) : o.zone === zone && o.owner === player && o.kind === 'card' && !o.faceDown;
  return {
    name,
    offers: (g, o, player) => {
      const def = g.s.defs[o.defId];
      return from(g, o, player) && transforming(def) && keywordCost(def, name) !== null;
    },
    cost: (g, o) => {
      const def = g.s.defs[o.defId];
      return transforming(def) ? keywordCost(def, name) : null;
    },
    charsOverride: (def) => backFaceSpellChars(def),
    onStack: (_g, spell) => {
      spell.face = 1; // CR 712.11a: put onto the stack with its back face up
      if (spell.stack) spell.stack.face = 1;
    },
  };
}

export const BACK_FACE_CAST_OPTIONS: readonly CastOptionProvider[] = [
  provider('disturb', 'graveyard'), // CR 702.146a
  provider('more than meets the eye', 'hand'), // CR 702.162a
];
