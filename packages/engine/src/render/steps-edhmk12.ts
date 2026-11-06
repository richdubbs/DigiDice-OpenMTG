/**
 * edh-mana-keywords-12 (CR 708.2a, 613.2b, 708.4; Yedora, Grave Gardener and Cyber Conversion + their rulings): a face-down permanent whose effect gives it set characteristics
 * (`faceDownAs`, types/ability.ts#FaceDownSet): the move or the turning is said as usual, then a sentence of its own, "It's a Forest land." / "It's a 2/2 Cyberman artifact creature."
 */
import type { FaceDownSet, ObjRef } from '../types/ability';
import type { Clause } from './clause';
import { setOfProfile } from '../types/face-down-set';
import type { RenderState } from './state';
import { infoOfRef } from './steps-util';
import { article, NoRenderer, pluralize } from './text';

/** "a Forest land", "a 2/2 Cyberman artifact creature": power and toughness, the subtypes, then the card types in lower case (Oracle's order). */
export function faceDownSetWords(profile: FaceDownSet, plural = false): string {
  const set = setOfProfile(profile);
  if (set === null || set.types.length === 0) throw new NoRenderer('a set face-down profile without card types');
  const words = [...(set.pt === null ? [] : [`${set.pt[0]}/${set.pt[1]}`]), ...set.subtypes, ...set.types.map((t) => t.toLowerCase())].join(' ');
  if (plural) { // edh-d-73 (CR 708.2a; Cybership, Illithid Harvester): "They're 2/2 Cyberman artifact creatures." (the card types in the plural, the last word of the phrase)
    if (set.pt === null) throw new NoRenderer('several face-down permanents with set characteristics but no power and toughness');
    return `${[`${set.pt[0]}/${set.pt[1]}`, ...set.subtypes, ...set.types.slice(0, -1).map((t) => t.toLowerCase()), pluralize(set.types[set.types.length - 1]!.toLowerCase())].join(' ')}`;
  }
  return `${article(set.pt === null ? (set.subtypes[0] ?? set.types[0]!) : words)} ${words}`;
}

/** The clause of a `move` or `changeFace` step with `faceDownAs`: the clause of the step without it, then the sentence of what the face-down permanent is. */
export function withFaceDownSet<S extends { op: string }>(base: (s: S, st: RenderState) => Clause, setOf: (s: S) => FaceDownSet | undefined, strip: (s: S) => S, valid: (s: S) => boolean, whatOf?: (s: S) => ObjRef) {
  return (s: S, st: RenderState): Clause => {
    const profile = setOf(s);
    if (profile === undefined) return base(s, st);
    if (!valid(s)) throw new NoRenderer('set characteristics of something that is not turned or put face down');
    const c = base(strip(s), st);
    // edh-d-73 (CR 708.2a): several objects put or turned face down: "They're 2/2 Cyberman artifact creatures." (their number is known once the clause has named them)
    const plural = whatOf !== undefined && infoOfRef(whatOf(s), st).plural;
    const side = plural ? `they're ${faceDownSetWords(profile, true)}` : `it's ${faceDownSetWords(profile)}`;
    return { ...c, imp: `${c.imp}. ${side}`, sub: `${c.sub}. ${side}`, standalone: true };
  };
}
