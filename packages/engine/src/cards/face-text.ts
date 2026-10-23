/**
 * The text side of a face for the compile pipeline: the front end's view of the Oracle text (normalized text, reminders, labels, line structure) and the
 * `FaceLines` (model/api.ts) that hydration (packs, LLM cache) and the degrade pass read. Owner: WP18.
 *
 * Indexing is the parser's: `lines[i]` is line i of the normalized Oracle text (blank lines included, so `AbilityBase.src` from parseCard and from a stored
 * entry mean the same line), with reminder text removed, the label removed and "~" for the object's own name; `sentences[i]` are the sentences the front
 * end found on that line, in text order (the `{line, sentence}` of `CompiledCardEntry.covers` and the `StepBase.sentence` of a stored ability index them).
 * Pure, never throws (a front-end failure gives empty lines: hydration then refuses the entry, which is the safe direction).
 */
import type { FaceDef, OracleCard } from '../types/card';
import type { FaceLines } from '../model/api';
import type { FrontEndOptions, FaceContext, PreprocessedFace } from '../parser/preprocess';
import { collapse, faceContexts, typeWords } from '../parser/preprocess';
import { frontEnd, type AbilitySegment, type Sentence } from '../parser/segment';

export interface FaceText {
  pre: PreprocessedFace | null;
  lines: FaceLines;
}

const EMPTY: FaceLines = { lines: [], sentences: [] };

function collectSentences(seg: AbilitySegment, out: Sentence[]): void {
  out.push(...seg.sentences);
  for (const m of seg.modal?.modes ?? []) out.push(...m.sentences);
  for (const r of seg.rollTable ?? []) {
    out.push(...r.sentences);
    for (const more of r.more ?? []) out.push(...more.sentences);
  }
  for (const c of seg.children ?? []) collectSentences(c, out);
}

/** The FaceText of one face context. */
export function faceTextOf(ctx: FaceContext, opts: FrontEndOptions): FaceText {
  try {
    const seg = frontEnd(ctx, opts);
    const pre = seg.pre;
    const lines = pre.lines.map((l) => (l.blank || l.reminderOnly ? '' : collapse(pre.parse, [l.body])));
    const all: Sentence[] = [];
    for (const s of seg.abilities) collectSentences(s, all);
    const sentences: string[][] = lines.map(() => []);
    for (const s of [...all].sort((a, b) => a.range[0] - b.range[0])) {
      const text = collapse(pre.parse, [s.range]);
      if (text !== '' && sentences[s.line] !== undefined) sentences[s.line]!.push(text);
    }
    return { pre, lines: { lines, sentences } };
  } catch {
    return { pre: null, lines: EMPTY };
  }
}

/** One FaceText per rules face of an Oracle card (the faces of cards/faces.ts and parser/preprocess.ts are the same). */
export function cardFaceTexts(card: OracleCard, opts: FrontEndOptions): FaceText[] {
  try {
    return faceContexts(card, opts).map((ctx) => faceTextOf(ctx, opts));
  } catch {
    return [];
  }
}

/** The front end's context for a face of a compiled definition (the UI paints a CardDef, it has no OracleCard). */
export function contextOfFace(face: FaceDef, layout: string, otherNames: string[], opts: FrontEndOptions): FaceContext {
  const words = typeWords(face.typeLine, new Set((opts.lexicon?.supertypes ?? ['basic', 'legendary', 'ongoing', 'snow', 'world']).map((s) => s.toLowerCase())));
  return {
    name: face.name,
    typeLine: face.typeLine,
    ...words,
    layout,
    text: face.oracleText,
    otherNames,
    isToken: layout === 'token' || layout === 'double_faced_token' || /\bToken\b/.test(face.typeLine),
  };
}
