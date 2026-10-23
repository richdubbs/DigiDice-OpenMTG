/**
 * Rules text structure for the placeholder frame. Pure.
 *
 * - lines with their offsets in the face's Oracle text (so the engine's display spans, which are ranges in that text, can paint them);
 * - the structured lines of some frames: loyalty abilities (CR 606.3: "+1:", "−2:", "0:"), saga chapters (CR 714.2: "I, II —"), class levels
 *   (CR 716.2: "{1}{W}: Level 2"), leveler bands ("LEVEL 2-6" then "3/3", CR 711.2);
 * - runs: a line split by automation status (engine `spansOf`, design 10.5: manual text is painted).
 */
import { spansOf, type CardDef, type TextSpan } from '@openmtg/engine';

export interface Line {
  text: string;
  start: number;
  end: number;
}

export function linesOf(text: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (const part of text.split('\n')) {
    if (part.trim() !== '') out.push({ text: part, start, end: start + part.length });
    start += part.length + 1;
  }
  return out;
}

/** A loyalty ability line (CR 606.3): its cost tag ("+1", "−3", "0", "−X") and where the rest begins. */
export function loyaltyCost(line: string): { cost: string; rest: number } | null {
  const m = /^([+−-]?(?:\d+|X)):\s*/.exec(line);
  return m ? { cost: m[1]!.replace('-', '−'), rest: m[0].length } : null;
}

/** A saga chapter line (CR 714.2b): its chapter numerals ("I", "II") and where the chapter text begins. */
export function sagaChapters(line: string): { chapters: string[]; rest: number } | null {
  const m = /^((?:[IVX]+)(?:,\s*[IVX]+)*)\s+—\s+/.exec(line);
  return m ? { chapters: m[1]!.split(/,\s*/), rest: m[0].length } : null;
}

/** A class level line (CR 716.2a): "{3}{R}{G}: Level 3". */
export function classLevel(line: string): { cost: string; level: number } | null {
  const m = /^((?:\{[^}]+\})+):\s*Level\s+(\d+)$/.exec(line.trim());
  return m ? { cost: m[1]!, level: Number(m[2]) } : null;
}

/** A leveler band header (CR 711.2a): "LEVEL 2-6", "LEVEL 7+". */
export function levelBand(line: string): string | null {
  const m = /^LEVEL\s+(\d+(?:-\d+|\+))$/.exec(line.trim());
  return m ? m[1]! : null;
}

/** A bare power/toughness line inside a leveler band ("3/3"). */
export const isPtLine = (line: string): boolean => /^[\d*+X-]+\/[\d*+X-]+$/.test(line.trim());

// ---- automation spans --------------------------------------------------------------------------------------------------------------------------------

export type RunStatus = TextSpan['status'] | 'plain';

export interface Run {
  text: string;
  status: RunStatus;
  reason?: string;
}

const SPANS = new WeakMap<CardDef, Map<number, TextSpan[]>>();

/** The engine's display spans of a face, memoized per definition (definitions are immutable). Empty when the engine cannot tell. */
export function faceSpans(def: CardDef | undefined, face: number): TextSpan[] {
  if (!def || !def.faces[face]) return [];
  let byFace = SPANS.get(def);
  if (!byFace) {
    byFace = new Map();
    SPANS.set(def, byFace);
  }
  let spans = byFace.get(face);
  if (!spans) {
    try {
      spans = spansOf(def, face);
    } catch {
      spans = [];
    }
    byFace.set(face, spans);
  }
  return spans;
}

/** The part [start, end) of the text cut into runs by the spans that cover it; text no span covers is 'plain'. */
export function runsOf(text: string, spans: readonly TextSpan[], start: number, end: number): Run[] {
  const out: Run[] = [];
  let at = start;
  const push = (a: number, b: number, status: RunStatus, reason?: string) => {
    if (b <= a) return;
    const last = out[out.length - 1];
    if (last && last.status === status && last.reason === reason) last.text += text.slice(a, b);
    else out.push({ text: text.slice(a, b), status, ...(reason !== undefined ? { reason } : {}) });
  };
  const inside = spans.filter((s) => s.range[1] > start && s.range[0] < end).sort((a, b) => a.range[0] - b.range[0]);
  for (const s of inside) {
    const a = Math.max(s.range[0], at);
    const b = Math.min(s.range[1], end);
    if (b <= a) continue;
    push(at, a, 'plain');
    push(a, b, s.status, s.status === 'manual' ? s.reason : undefined);
    at = b;
  }
  push(at, end, 'plain');
  return out;
}

// ---- the engine's self-reference ---------------------------------------------------------------------------------------------------------------------

/**
 * A fragment of rules text with the engine's self-reference "~" replaced by a name players read (CR 201.5: text that refers to the object it is on by name
 * means that object). The name is the face whose Oracle text holds the rest of the fragment, else `fallback`.
 */
export function selfNamed(fragment: string, faces: readonly { name: string; oracleText: string }[], fallback: string): string {
  if (!fragment.includes('~') && !fragment.includes('¤')) return fragment;
  // r4-static: "¤" is the card's own name inside a quoted ability it grants (engine parser/front/selfref.ts), read the same way
  const pieces = fragment
    .split(/[~¤]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 1);
  const face = faces.find((f) => pieces.every((p) => f.oracleText.includes(p)));
  return fragment.replace(/[~¤]/g, face?.name ?? fallback);
}
