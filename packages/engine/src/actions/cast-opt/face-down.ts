/**
 * Casting face down: morph, megamorph, disguise (CR 702.37c, 702.168b, 708.4; m6 design 3.4). Owner: M6-3.
 *
 * A card with morph or megamorph (CR 702.37a-b: megamorph is a variant of morph, cast the same way) may be cast as the method `morph`; a card with disguise as
 * the method `disguise`. Either is an alternative cost of {3} (CR 702.37c, 702.168b, 118.9: cost modifiers apply to it). From the moment it is announced the
 * spell is a face-down 2/2 creature spell with no name, mana cost (so mana value 0) or other characteristics (CR 708.4; disguise adds ward {2}, CR
 * 702.168a): `charsOverride`, which actions/cast.ts#castCheck applies before the timing and prohibition checks, so "can't cast creature spells with mana value 3 or
 * more" does not stop it. The card is turned face down before it is put onto the stack (`faceDown`), so no zone-change event or log line names it; `onStack`
 * records how (the true method: megamorph stays megamorph in the state; views of other players show it as morph, CR 702.37b-c) and the profile.
 *
 * From the hand, and a commander from the command zone (CMDF, CR 702.37a "any zone from which you could play it", 903.8: the tax applies and the cast is
 * counted; cast-opt/zones.ts). An effect that lets a player cast cards from another zone does not offer this method yet; such a card can still be cast face
 * up there.
 */
import type { CostDef, FaceDownProfile } from '../../types/ability';
import type { CardDef } from '../../types/card';
import type { FaceDownInfo } from '../../types/state';
import type { BaseChars } from '../../rules/characteristics';
import { charsOfObject, faceChars } from '../../rules/characteristics';
import { FACE_DOWN_WARD } from '../../statics/face-down';
import type { CastOptionProvider } from '../cast-options';
import { castableFromHandOrCommand } from './zones';

/** CR 702.37c, 702.168b: the face-down spell's cost. */
const THREE: CostDef = { mana: [{ kind: 'generic', amount: 3 }] };

/** CR 708.4, 702.168a: what the spell is from the moment it is announced (a fresh record: every array the caller's own). */
export function faceDownSpellChars(profile: FaceDownProfile): BaseChars {
  const abilities = profile === 'ward2' ? [{ face: 0, index: 0, def: FACE_DOWN_WARD }] : [];
  return {
    name: '', names: [], face: 0, combined: false, manaCost: null, manaValue: 0, colors: [], supertypes: [], types: ['Creature'], subtypes: [], power: '2', toughness: '2',
    abilities, keywords: abilities.map((a) => a.def),
  };
}

/** The keywords of the card's front face that let it be cast this way (the card is in a hand: its characteristics are its own). */
const printedKeywords = (def: CardDef): string[] => faceChars(def, 0).keywords.map((k) => k.keyword);

function provider(name: 'morph' | 'disguise', keywords: readonly string[], profile: FaceDownProfile): CastOptionProvider {
  return {
    name,
    faceDown: true,
    offers: (g, o, player) => castableFromHandOrCommand(g, o, player) && charsOfObject(g.s, o).keywords.some((k) => keywords.includes(k.keyword)),
    cost: () => THREE,
    charsOverride: () => faceDownSpellChars(profile),
    onStack: (g, spell) => {
      const def = g.s.defs[spell.defId];
      const kws = def ? printedKeywords(def) : [];
      const by: FaceDownInfo['by'] = name === 'disguise' ? 'disguise' : kws.includes('morph') || !kws.includes('megamorph') ? 'morph' : 'megamorph';
      spell.faceDown = true; // CR 708.4 (already face down: actions/cast.ts moves it with `faceDown`)
      spell.faceDownInfo = { by, profile };
    },
  };
}

export const FACE_DOWN_CAST_OPTIONS: readonly CastOptionProvider[] = [
  provider('morph', ['morph', 'megamorph'], 'plain'), // CR 702.37c (megamorph: CR 702.37b)
  provider('disguise', ['disguise'], 'ward2'), // CR 702.168b
];
