/**
 * Card names a player may choose (CR 201.4): the name of each face of a split card but not both together (CR 201.4b, 709.4a), a flip card's or an
 * adventurer card's alternative name (CR 201.4c, 201.4f), either face of a double-faced card (CR 201.4d, 712.19), never a token's name unless a card has it.
 */
import { HIDDEN_DEF, type GameView } from '@openmtg/engine';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Closed-list filter: names that start with the query first, then names that contain it (case and accents ignored). */
export function filterNames(options: readonly string[], query: string): string[] {
  const q = norm(query);
  if (!q) return [...options];
  const starts = options.filter((o) => norm(o).startsWith(q));
  const contains = options.filter((o) => !norm(o).startsWith(q) && norm(o).includes(q));
  return [...starts, ...contains];
}

/** std-rx28 (CR 201.3): a land card name or a nonland card name only (ChooseNameDecision.cardKind); a face says it by its type line or its types. */
export type CardKind = 'land' | 'nonland';
type NameFace = { name: string; typeLine?: string; types?: readonly string[] };
const isLandFace = (f: NameFace): boolean => (f.types !== undefined ? f.types.includes('Land') : /\bLand\b/.test(f.typeLine ?? ''));
const fitsKind = (f: NameFace, kind?: CardKind): boolean => kind === undefined || isLandFace(f) === (kind === 'land');

/** The names a card can be named by: each face's name when it has several faces ("Fire", "Ice"; never "Fire // Ice"), else its name; of `kind` only, when given. */
export function nameableNames(card: { name: string; faces: readonly NameFace[] }, kind?: CardKind): string[] {
  if (kind !== undefined) return [...new Set(card.faces.filter((f) => fitsKind(f, kind)).map((f) => (card.faces.length > 1 ? f.name : card.name)))];
  return card.faces.length > 1 ? [...new Set(card.faces.map((f) => f.name))] : [card.name];
}

/** The nameable names of search results that match the query (the server's search also matches rules text), prefix matches first, without repeats. */
export function namesMatching(cards: readonly { name: string; faces: readonly NameFace[] }[], query: string, kind?: CardKind): string[] {
  return filterNames([...new Set(cards.flatMap((c) => nameableNames(c, kind)))], query);
}

/** The names of the cards in this game (offline fallback when the card search is not available): every non-token card definition the view knows. */
export function gameCardNames(view: GameView, kind?: CardKind): string[] {
  const names = Object.values(view.defs)
    .filter((def) => def.id !== HIDDEN_DEF && !def.isToken)
    .flatMap((def) => nameableNames(def, kind));
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}
