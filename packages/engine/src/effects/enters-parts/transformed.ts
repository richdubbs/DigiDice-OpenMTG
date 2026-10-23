/**
 * `enters.transformed` (CR 712.14a, 614.1c, 616.1d; m6 design 3.6). Owner: M6-4.
 *
 * "It enters transformed" (daybound at night, CR 702.145b; "enters the battlefield transformed" replacement effects): a replacement effect of class 3 (CR
 * 616.1d, effects/replacements.ts#klassOf). A double-faced card or token that can transform enters with its back face up: the facts carry `transformed` and
 * the face (the move puts it onto the battlefield with that face up, core/zones.ts#moveObject). Anything else is not turned over (a card that isn't
 * double-faced, CR 712.14a; a meld card, CR 712.4c): it enters as it would have.
 *
 * `transformedEntry` is the check the performer of a zone change makes BEFORE the move (effects/perform-events.ts): a double-faced card whose back face is an
 * instant or sorcery can't enter transformed. A resolving spell doing so is put into its owner's graveyard instead (CR 712.13a); from any other zone it stays
 * where it is (CR 304.4, 307.4: an instant or sorcery can't enter the battlefield).
 */
import type { CardDef } from '../../types/card';
import type { GameObject, GameState } from '../../types/state';
import { faceChars } from '../../rules/characteristics';
import type { EntersPart } from '../registries';

/** The layouts whose cards and tokens enter transformed (CR 712.14a; a meld card is melded instead, CR 712.14c). */
const TURNS_OVER = ['transform', 'modal_dfc', 'double_faced_token'];
const doubleFaced = (def: CardDef | undefined): def is CardDef => def !== undefined && def.faces.length === 2 && TURNS_OVER.includes(def.layout);

/** Whether this object would enter with its back face up when told to enter transformed (CR 712.14a). Pure. */
export function entersTransformed(s: GameState, o: GameObject): boolean {
  return o.components === undefined && doubleFaced(s.defs[o.defId]);
}

/**
 * CR 712.13a, 304.4, 307.4: where a double-faced object told to enter transformed goes when its back face is an instant or sorcery face: 'graveyard' for a
 * resolving spell, 'stay' for anything else; null when it may enter. Pure.
 */
export function transformedEntry(s: GameState, o: GameObject): 'graveyard' | 'stay' | null {
  const def = s.defs[o.defId];
  if (!doubleFaced(def) || o.components !== undefined) return null; // not turned over: it enters as it would have
  const back = faceChars(def, 1);
  if (!back.types.includes('Instant') && !back.types.includes('Sorcery')) return null;
  return o.zone === 'stack' ? 'graveyard' : 'stay';
}

export const TRANSFORMED_ENTERS_PARTS: readonly EntersPart[] = [
  {
    field: 'transformed',
    capability: 'body:enters.transformed',
    apply: (g, e) => {
      const o = g.s.objects[e.object.id];
      if (!o || !entersTransformed(g.s, o)) {
        if (o) g.log(`${g.nameOf(o.id)} is not a double-faced card or token: it doesn't enter transformed.`, { rules: ['CR 712.14a'], level: 'info' });
        return {};
      }
      return { transformed: true, face: 1 }; // CR 712.14a
    },
    hypothetical: (alt, x, facts) => {
      if (facts.transformed === true && entersTransformed(alt, x)) x.face = 1; // CR 614.12: the object as it would enter (a copy of the state)
    },
  },
];
