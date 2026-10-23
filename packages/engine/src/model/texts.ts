/**
 * The Oracle text behind an ability, from the normalized lines of its face and the ability's `src` indices (design 2.3: `AbilityBase.src`,
 * `StepBase.sentence`). Shared by hydration (model/strip.ts) and the degrade pass (model/degrade.ts), which both need the words of a unit. Owner: WP1.
 */
import type { FaceLines } from './api';

type Rec = Record<string, unknown>;

export interface AbilityTexts {
  /** The `src` lines joined by "\n". */
  text: string;
  /** The sentences of those lines in order: the indexing of `StepBase.sentence`. */
  sentences: string[];
  /** The cost words of an activated ability (before the first ":"), else the whole text. */
  costText: string;
}

/** null when the ability has no `src` or a `src` index is outside the card's lines. */
export function textsOf(node: Rec, lines: FaceLines): AbilityTexts | null {
  const src = node['src'];
  if (!Array.isArray(src)) return null;
  const picked: string[] = [];
  const sentences: string[] = [];
  for (const i of src) {
    const line = typeof i === 'number' ? lines.lines[i] : undefined;
    if (line === undefined) return null;
    picked.push(line);
    sentences.push(...(lines.sentences[i as number] ?? []));
  }
  const text = picked.join('\n');
  const colon = text.indexOf(':');
  return { text, sentences, costText: node['kind'] === 'activated' && colon > 0 ? text.slice(0, colon).trim() : text };
}
