/**
 * The model's view of a card's text (design 11.2 USER message): per face, the normalized Oracle lines with the parser's line indices (reminder text
 * removed, "~" for the card's own name, ability-word labels removed), split into sentences. Pure.
 *
 * Line indices are exactly the parser's (the engine's front end, `preprocessFace`), so `src: [i]` in a reply names the same line the pipeline hydrates.
 * Sentences are split here on sentence-ending periods outside quotes; the engine's front end may split a line differently in rare cases. Sentence
 * indices only feed `covers` and the optional `StepBase.sentence` (display spans): an index the front end does not know makes hydration refuse the entry,
 * which is the safe direction (the card stays manual).
 */
import { faceContexts, preprocessFace, type OracleCard, type ParseOptions } from '@openmtg/engine';

export interface FaceView {
  name: string;
  typeLine: string;
  /** Normalized lines ('' for a blank or reminder-only line), in the parser's indexing. */
  lines: string[];
  /** Sentences per line. */
  sentences: string[][];
}

/** Split one line into sentences: after ".", "!" or "?" followed by a space, outside double quotes. */
export function splitSentences(line: string): string[] {
  const out: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    if (!quoted && (c === '.' || c === '!' || c === '?') && line[i + 1] === ' ') {
      out.push(line.slice(start, i + 1).trim());
      start = i + 2;
    }
  }
  const rest = line.slice(start).trim();
  if (rest !== '') out.push(rest);
  return out;
}

/** The faces of a card as the model sees them. Never throws (an unreadable face has no lines). */
export function faceViews(card: OracleCard, opts: Partial<ParseOptions> = {}): FaceView[] {
  let contexts;
  try {
    contexts = faceContexts(card, opts);
  } catch {
    return [];
  }
  return contexts.map((ctx) => {
    try {
      const pre = preprocessFace(ctx, opts);
      const lines = pre.lines.map((l) => (l.blank || l.reminderOnly ? '' : pre.parse.slice(l.body[0], l.body[1]).replace(/\s+/g, ' ').trim()));
      return { name: ctx.name, typeLine: ctx.typeLine, lines, sentences: lines.map(splitSentences) };
    } catch {
      return { name: ctx.name, typeLine: ctx.typeLine, lines: [], sentences: [] };
    }
  });
}
