/**
 * Front end step 1: normalize, reminder text, self reference "~", labels and ability words, the character ledger (design 6.2). Owner: WP5.
 *
 *   faceContexts(card)            one FaceContext per face of an Oracle card (the layouts of cards/compile.ts)
 *   preprocessFace(ctx, opts)     PreprocessedFace: normalized text with an offset map, the parse text (reminders blank, "~" for the object), lines with
 *                                 labels, the reminder and self-reference lists, and the first ledger entries (reminder, label)
 *
 * Reminder text (a balanced parenthesised span, CR 207.2a) is blanked in the parse text and never parsed for behavior. Everything the front end decides is
 * recorded as a range of the normalized text so that no character is lost between lines, labels and quotes (guard G4, `ledgerProblems`).
 */
import type { OracleCard } from '../types/card';
import type { Diagnostic, LedgerEntry } from './types';
import { detectLead } from './front/labels';
import { GENERATED_LEXICON, lexiconIndex } from './front/lexicon-index';
import { scanQuotes } from './front/quotes';
import { applySelfRefs, findSelfRefs } from './front/selfref';
import { lineRanges, normalizeText, trimRange } from './front/text';
import type { FaceContext, FrontEndOptions, PreLine, PreprocessedFace, Range, Reminder } from './front/types';

export const OWNER = 'WP5' as const;

export { completeLedger, ledgerProblems, markLedger } from './front/ledger';
/** The checked-in lexicon (design 6.11): what callers without their own `ParseOptions.lexicon` pass to the front end. */
export { GENERATED_LEXICON } from './front/lexicon-index';
export { collapse, normalizeText, originalRange } from './front/text';
export type * from './front/types';

/** Layouts whose Scryfall `card_faces` are separate rules faces (the same set cards/compile.ts uses). Meld pieces are other cards, not faces. */
const MULTI_FACE_LAYOUTS = new Set(['split', 'flip', 'transform', 'modal_dfc', 'adventure', 'prepare', 'double_faced_token', 'reversible_card', 'art_series']);

/** Card types, supertypes and subtypes (lower case) of a type line (CR 205). "Tribal" is the old name of kindred (CR 308). */
export function typeWords(typeLine: string, supertypeWords: ReadonlySet<string>): { types: string[]; supertypes: string[]; subtypes: string[] } {
  const [left = '', right = ''] = typeLine.split(/\s+(?:—|--|-)\s+/, 2);
  const types: string[] = [];
  const supertypes: string[] = [];
  for (const w of left.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (w === '//') continue;
    if (supertypeWords.has(w)) supertypes.push(w);
    else types.push(w === 'tribal' ? 'kindred' : w);
  }
  return { types, supertypes, subtypes: right.toLowerCase().split(/\s+/).filter(Boolean) };
}

/** One FaceContext per rules face of the card. */
export function faceContexts(card: OracleCard, opts: FrontEndOptions = {}): FaceContext[] {
  const ix = lexiconIndex(opts.lexicon ?? GENERATED_LEXICON, opts.keywords);
  const multi = MULTI_FACE_LAYOUTS.has(card.layout) && card.card_faces !== undefined && card.card_faces.length > 1;
  const faces = multi ? card.card_faces! : [card];
  return faces.map((f, i) => {
    const typeLine = f.type_line ?? card.type_line ?? '';
    const words = typeWords(typeLine, ix.supertypes);
    return {
      name: f.name,
      typeLine,
      ...words,
      layout: card.layout,
      text: f.oracle_text ?? '',
      otherNames: multi ? faces.filter((_, j) => j !== i).map((o) => o.name) : [],
      isToken: card.layout === 'token' || card.layout === 'double_faced_token' || /\bToken\b/.test(typeLine),
      ...(typeof f.power === 'string' ? { power: f.power } : {}),
      ...(typeof f.toughness === 'string' ? { toughness: f.toughness } : {}),
      ...(card.unsanctioned === true ? { unsanctioned: true as const } : {}), // CMD2: CR 100.7
    };
  });
}

/** Balanced parenthesised spans (outermost) and the positions of parentheses that never balanced. */
function findReminders(text: string): { spans: Range[]; unbalanced: number[] } {
  const spans: Range[] = [];
  const unbalanced: number[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === ')') {
      if (depth === 0) unbalanced.push(i);
      else if (--depth === 0) spans.push([start, i + 1]);
    }
  }
  if (depth > 0) unbalanced.push(start);
  return { spans, unbalanced };
}

/** The sub-ranges of `r` that are not covered by `holes` (sorted, disjoint). */
function subtract(r: Range, holes: readonly Range[]): Range[] {
  const out: Range[] = [];
  let at = r[0];
  for (const h of holes) {
    if (h[1] <= at || h[0] >= r[1]) continue;
    if (h[0] > at) out.push([at, h[0]]);
    at = Math.max(at, h[1]);
  }
  if (at < r[1]) out.push([at, r[1]]);
  return out;
}

/** Blank (replace by spaces, keep line breaks) the given ranges. */
function blank(text: string, ranges: readonly Range[]): string {
  if (ranges.length === 0) return text;
  const parts: string[] = [];
  let at = 0;
  for (const [a, b] of ranges) {
    parts.push(text.slice(at, a), text.slice(a, b).replace(/[^\n]/g, ' '));
    at = b;
  }
  parts.push(text.slice(at));
  return parts.join('');
}

export function preprocessFace(ctx: FaceContext, opts: FrontEndOptions = {}): PreprocessedFace {
  const ix = lexiconIndex(opts.lexicon ?? GENERATED_LEXICON, opts.keywords);
  const norm = normalizeText(ctx.text);
  const text = norm.text;
  const diagnostics: Diagnostic[] = [];

  // 2. Reminder text.
  const { spans: reminderSpans, unbalanced } = findReminders(text);
  for (const at of unbalanced) {
    diagnostics.push({ level: 'warning', code: 'leftover-text', message: 'unbalanced parenthesis: the text is kept and will not be understood', range: [at, at + 1] });
  }
  const work = blank(text, reminderSpans);

  // 3. Self reference, with the quote scopes of the whole text.
  const quotes = scanQuotes(work);
  const selfRefs = findSelfRefs(work, ctx, ix, quotes.spans, opts.cardNames, { pronouns: true });
  let parse = applySelfRefs(work, selfRefs);
  /** FAST5 T49: the labels inside a Saga chapter line, blanked out of the parse text below ("I -- Judgment Bolt -- ..."). */
  const chapterLabels: Range[] = [];

  // Lines, with the label of each (design 6.2 step 4).
  const lines: PreLine[] = lineRanges(text).map((range, index) => {
    const whole = trimRange(text, range);
    const blankLine = whole[0] >= whole[1];
    const rest = trimRange(parse, range);
    const reminderOnly = !blankLine && rest[0] >= rest[1];
    const line: PreLine = { index, range, blank: blankLine, reminderOnly, body: rest };
    if (!blankLine && !reminderOnly) {
      // The label is read from the text BEFORE self references became "~": "Calim's Breath -- ..." is a flavor word that happens to contain the card's name.
      const lead = detectLead(work, range, ix);
      line.body = lead.body;
      if (lead.label) line.label = lead.label;
      if (lead.keywordDash) line.keywordDash = lead.keywordDash;
      // FAST5X E27 (CR 207.2d): a flavor word before a keyword with a dash ("Chaosbringer -- Equip--Pay 3 life."): the label has no rules meaning, and the rest of
      // the line is that keyword's line
      if (lead.label && !lead.keywordDash) {
        const inner = detectLead(work, lead.body, ix);
        if (inner.keywordDash && !inner.label) {
          line.keywordDash = inner.keywordDash;
          line.body = inner.body;
        }
      }
      // FAST5 T49 (CR 714.2, 207.2c): a Saga chapter may carry a flavor word of its own, "I -- Judgment Bolt -- ~ deals ..."; it has no rules meaning, like any label
      // on a line of its own, so the chapter keeps its prefix and the label is taken out of the text the chapter's effect is read from
      if (!lead.label && !lead.keywordDash && ctx.subtypes.includes('saga')) {
        const chapter = /^[IVX]+(?:, [IVX]+)* -- /.exec(work.slice(lead.body[0], lead.body[1]));
        if (chapter) {
          const inner = detectLead(work, [lead.body[0] + chapter[0].length, lead.body[1]], ix);
          if (inner.label) {
            line.chapterLabel = inner.label;
            chapterLabels.push(inner.label.range);
          }
        }
      }
    }
    return line;
  });
  parse = blank(parse, chapterLabels);

  const reminders: Reminder[] = reminderSpans.map((range) => ({ range, line: lines.findIndex((l) => range[0] >= l.range[0] && range[0] <= l.range[1]) }));

  // The first ledger entries: reminder spans and labels (a label never overlaps a reminder inside it).
  const ledger: LedgerEntry[] = reminderSpans.map((range) => ({ range, status: 'reminder' as const }));
  for (const l of lines) {
    const label = l.label ?? l.chapterLabel;
    if (!label) continue;
    for (const piece of subtract(label.range, reminderSpans)) {
      const r = trimRange(text, piece);
      if (r[0] < r[1]) ledger.push({ range: r, status: 'label', by: label.kind });
    }
  }
  ledger.sort((a, b) => a.range[0] - b.range[0]);

  return { context: ctx, original: ctx.text, normalized: text, offsets: norm.offsets, parse, lines, reminders, selfRefs, ledger, diagnostics };
}

/** Position of each "~" -> the range of the words it replaced, for `tokenize({ selfExtents })`. */
export function selfExtents(pre: Pick<PreprocessedFace, 'selfRefs'>): Map<number, Range> {
  // a replacement with its own text ("~'s", "~ is", FAST5X E24): the "~" is where `as` puts it, and it stands for the replaced word up to it
  return new Map(pre.selfRefs.map((r) => {
    if (r.as === undefined) return [r.range[1] - 1, r.range];
    const at = r.range[0] + r.as.indexOf('~');
    return [at, [r.range[0], r.as.trimEnd().endsWith('~') ? r.range[1] : at + 1]];
  }));
}
