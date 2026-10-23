/**
 * "No Wizards or Scryfall content" (updates.md; design 11.4 "Stored form = no Oracle text", 12.5): the checks that keep card names and Oracle text out of
 * LLM cache entries and rules packs. Pure.
 *
 * Free text is never kept: every `reason` (of a manual ability or a manual step, the only free-text fields of the stored form) is replaced by the fixed
 * `STORED_REASON` (`freeTextFree`). Every other string of an entry is checked by `cardTextIn` for containment of card text, not equality: a string that
 * contains a card or face name, or a run of RUN or more words of the Oracle text, in the printed form or in the "~" form the model was shown.
 */
import { GENERATED_LEXICON, keywordRegistry, type CompiledCardEntry, type OracleCard } from '@openmtg/engine';
import { faceViews } from '../llm/face-lines';

/** The only `reason` a stored entry may carry: what the manual node stands for is the player's own text at its `src` line. */
export const STORED_REASON = 'not representable in the ability model';

/** Words of a run of Oracle text that make a string "card text". */
export const RUN = 4;

const words = (s: string): string[] => s.toLowerCase().replace(/[’‘]/g, "'").split(/[^a-z0-9'~]+/).filter((w) => w !== '');

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

/** A deep copy of stored abilities with every `reason` replaced by STORED_REASON. */
export function freeTextFree<T>(x: T): T {
  if (Array.isArray(x)) return x.map((y) => freeTextFree(y as unknown)) as T;
  if (!isRec(x)) return x;
  const out: Rec = {};
  for (const [k, v] of Object.entries(x)) out[k] = k === 'reason' && typeof v === 'string' ? STORED_REASON : freeTextFree(v);
  return out as T;
}

/** The first `reason` that is not STORED_REASON (free text), or null. */
export function freeTextIn(x: unknown): string | null {
  if (Array.isArray(x)) {
    for (const y of x) {
      const f = freeTextIn(y);
      if (f !== null) return f;
    }
    return null;
  }
  if (!isRec(x)) return null;
  for (const [k, v] of Object.entries(x)) {
    if (k === 'reason' && typeof v === 'string' && v !== STORED_REASON) return v;
    const f = freeTextIn(v);
    if (f !== null) return f;
  }
  return null;
}

let vocabulary: Set<string> | undefined;

/**
 * The rules vocabulary of the ability model (CR 205 types and subtypes, CR 702 keyword names and aliases, keyword actions, counter kinds, predefined
 * tokens, colors, ability words), normalized. A string equal to one of these is structure ("Planeswalker", "double strike", "More Than Meets the Eye"),
 * never card text, even when the card's text uses the same words.
 */
function rulesVocabulary(): Set<string> {
  if (vocabulary) return vocabulary;
  const L = GENERATED_LEXICON;
  const terms = [
    ...L.cardTypes, ...L.supertypes, ...L.subtypes.flatMap((s) => [s.singular, s.plural]), ...L.colors.map((c) => c.word), ...L.keywordAbilities.map((k) => k.name),
    ...L.keywordActions.flatMap((k) => [k.name, ...k.forms]), ...L.counterKinds, ...L.predefinedTokens.map((t) => t.name), ...L.abilityWords,
    ...keywordRegistry.all().flatMap((k) => [k.name, ...(k.aliases ?? [])]),
  ];
  vocabulary = new Set(terms.map((t) => words(t).join(' ')).filter((t) => t !== ''));
  return vocabulary;
}

/** The card's names and every RUN-word window of its text (printed form and the "~" lines of the prompt), normalized. */
function cardTextIndex(card: OracleCard): { names: string[]; runs: Set<string>; texts: string[] } {
  const names = [card.name, ...(card.card_faces ?? []).map((f) => f.name)].flatMap((n) => n.split(/\s*\/\/\s*/)).map((n) => words(n).join(' ')).filter((n) => n !== '');
  const sources = [card.oracle_text ?? '', ...(card.card_faces ?? []).map((f) => f.oracle_text ?? ''), ...faceViews(card).flatMap((v) => v.lines)];
  const runs = new Set<string>();
  const texts: string[] = [];
  for (const s of sources) {
    for (const line of s.split('\n')) {
      const w = words(line);
      if (w.length === 0) continue;
      texts.push(` ${w.join(' ')} `);
      for (let i = 0; i + RUN <= w.length; i++) runs.add(w.slice(i, i + RUN).join(' '));
    }
  }
  return { names, runs, texts };
}

/**
 * A string of the entry that contains card text, or null: a card or face name (as whole words), a run of RUN or more words of the Oracle text, or a
 * whole short phrase of it (two or more words, 12+ characters; a single word that is not a name is structure). Both the printed text and the "~"-normalized lines the model was shown count. Rules vocabulary (type,
 * keyword and counter names) is structure, not card text.
 */
export function cardTextIn(entry: Pick<CompiledCardEntry, 'faces'>, card: OracleCard): string | null {
  const { names, runs, texts } = cardTextIndex(card);
  const vocab = rulesVocabulary();
  let found: string | null = null;
  const visit = (x: unknown): void => {
    if (found !== null) return;
    if (typeof x === 'string') {
      const w = words(x);
      if (vocab.has(w.join(' '))) return;
      const joined = ` ${w.join(' ')} `;
      if (names.some((n) => joined.includes(` ${n} `))) found = x;
      else if (w.some((_, i) => i + RUN <= w.length && runs.has(w.slice(i, i + RUN).join(' ')))) found = x;
      else if (w.length >= 2 && joined.length - 2 >= 12 && texts.some((t) => t.includes(joined))) found = x;
      return;
    }
    if (Array.isArray(x)) x.forEach(visit);
    else if (isRec(x)) Object.values(x).forEach(visit);
  };
  visit(entry.faces);
  return found;
}
