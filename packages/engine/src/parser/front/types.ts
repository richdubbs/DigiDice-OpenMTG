/**
 * Parser front end (WP5): the types shared by preprocess, segment and tokenize. Nothing here imports the game (design 5.4: the parser runs without one).
 *
 * Coordinates. Every range in the front end is a half-open `[start, end)` range of the NORMALIZED text of the face (`PreprocessedFace.normalized`):
 * ledger entries, tokens, labels, lines and segments all use it (the `LedgerEntry` contract of parser/types.ts). `PreprocessedFace.offsets` maps a
 * normalized index back to the original Oracle text for the UI.
 */
import type { Diagnostic, LedgerEntry, ParseOptions } from '../types';

export type Range = [number, number];

/** What the front end needs to know about one face of a card. Built from an OracleCard by `faceContexts`. */
export interface FaceContext {
  /** Full name of this face (the whole card name for single-faced cards). */
  name: string;
  typeLine: string;
  /** Lower-case card types, supertypes and subtypes read from the type line. */
  types: string[];
  supertypes: string[];
  subtypes: string[];
  layout: string;
  /** Oracle text exactly as stored (line breaks kept). */
  text: string;
  /** Names of the OTHER faces of the same card (CR 201.5b: they mean this object). Meld partners are NOT listed: they are other cards. */
  otherNames: string[];
  /** The face is a token (layout token / double_faced_token or a Token type line): "this token" is itself. */
  isToken: boolean;
  /** T35: the printed power and toughness of the face, when it has them (a Spacecraft's P/T box is its station symbol's, CR 721.2b). */
  power?: string;
  toughness?: string;
  /**
   * CMD2 ADDITION (optional): the card is unsanctioned (CR 100.7; `OracleCard.unsanctioned`, set by the card index): cards/unsanctioned.ts#markUnsanctioned
   * makes every automated ability of it manual (without its effect) after the parse, so a lowering that newly automates an ability can skip such a card and
   * leave its manual ability as it was (lower/cast-self.ts).
   */
  unsanctioned?: true;
}

/** Options of the front end: the part of ParseOptions it reads. A full `ParseOptions` can be passed as it is. */
export type FrontEndOptions = Partial<Pick<ParseOptions, 'lexicon' | 'keywords' | 'cardNames'>>;

/** `pronoun` (FAST5X E24): a gendered pronoun (he, him, his, she, her) of a legendary face that names one character or, by FAST5 T49, a he/him/his after the same line named it (CR 201.5, design 6.4; selfref.ts). */
export type SelfVia = 'cardname' | 'name' | 'short-name' | 'other-face' | 'this-noun' | 'pronoun' | 'grantor';

/** A place where the text referred to the object itself and was replaced by "~" (design 6.2 step 3). */
export interface SelfRef {
  range: Range;
  via: SelfVia;
  /** `quote`: inside a quoted ability, where `this <noun>` is the object that has the quoted ability (CR 201.5a), not the outer card. */
  scope: 'face' | 'quote';
  /** The words that were replaced, as written. */
  text: string;
  /**
   * FAST5X E24 (INTERFACE CHANGE, optional): what the parse text holds in place of the words, as long as `range` and with exactly one "~" ("his" ->
   * "~'s", "he's" -> "~ is"). Absent: spaces and a "~" at the last character (applySelfRefs).
   */
  as?: string;
  /**
   * r4-static (INTERFACE CHANGE, optional): the mark written at the last character instead of "~". `'¤'` (via `grantor`): the OUTER card's name inside a quoted
   * ability, the object whose ability grants the quoted one ("Equipped creature has "{T}, Sacrifice Blazing Torch: ...""; CR 201.5a);
   * the tokenizer reads it as a GRANTOR token.
   */
  mark?: '¤';
}

export interface Reminder {
  range: Range;
  /** Index of the line that contains it. */
  line: number;
}

export type LabelKind = 'ability-word' | 'flavor-word';

export interface LineLabel {
  /** The label words as written ("Landfall"), without the dash. */
  text: string;
  /** The label plus the dash and the spaces after it. */
  range: Range;
  kind: LabelKind;
}

/** A keyword written with a dash: `Ward--Pay 3 life`, `Escape--{3}{R}{R}, Exile ...`, `Boast--{1}: ...`. NOT a label: the keyword has rules meaning. */
export interface KeywordDash {
  /** The keyword name as written. */
  text: string;
  /** Canonical name from the lexicon / registry. */
  name: string;
  nameRange: Range;
  /** The dash itself (after normalization "--"). */
  dashRange: Range;
}

/** One line of the face (split at "\n" of the normalized text). */
export interface PreLine {
  index: number;
  /** The whole line without its line break. */
  range: Range;
  /** Nothing but spaces. */
  blank: boolean;
  /** Nothing but reminder text and spaces (design 6.2 table row 1). */
  reminderOnly: boolean;
  /** After the label, trimmed; equal to the trimmed line when there is no label. The parse text of this range has reminders blanked and self references as "~". */
  body: Range;
  label?: LineLabel;
  /** FAST5 T49: the flavor word between a Saga chapter's numerals and its effect ("I -- Judgment Bolt -- ..."); blanked in the parse text. */
  chapterLabel?: LineLabel;
  keywordDash?: KeywordDash;
}

export interface PreprocessedFace {
  context: FaceContext;
  original: string;
  /** Normalized text: straight quotes, ASCII dashes, single spaces, "\n" between lines (design 6.2 step 1). */
  normalized: string;
  /** `offsets[i]` = index in `original` of the character that produced `normalized[i]`; `offsets[normalized.length]` = `original.length`. */
  offsets: number[];
  /**
   * Same length as `normalized`. Reminder text is blank (spaces), a self reference is "~" followed by blanks, everything else is unchanged.
   * Tokens are read from this text; their ranges are valid in `normalized` as well.
   */
  parse: string;
  lines: PreLine[];
  reminders: Reminder[];
  selfRefs: SelfRef[];
  /** Entries decided by the preprocessor: `reminder` spans and `label` spans. The rest of the text is still unclaimed. */
  ledger: LedgerEntry[];
  diagnostics: Diagnostic[];
}

