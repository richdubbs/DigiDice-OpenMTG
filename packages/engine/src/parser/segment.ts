/**
 * Front end step 2: lines to abilities (the decision list of design 6.2), abilities to sentences. Owner: WP5.
 *
 *   segmentFace(pre, opts)   PreprocessedFace -> SegmentedFace: abilities (kind by shape), their sentences as tokens, the complete character ledger
 *   frontEnd(ctx, opts)      preprocessFace + segmentFace
 *
 * The decision list (first match wins, design 6.2): reminder-only or blank lines are skipped; LEVEL brackets and Class levels (they split the face first);
 * chapters; dice rows folded into the ability above (the threshold rows of a Station card too, with the lines below them, CR 721.2);
 * modal headers with their bullets and Spree lines; loyalty abilities; keyword lines; triggered abilities (when / whenever / at; on a spell face a trigger
 * the spell creates, "At the beginning of your next upkeep", "Whenever ... this turn", is part of the spell ability, CR 603.7); activated abilities (an
 * unquoted colon after something cost-like); on an instant or sorcery face every remaining line is ONE spell ability, except the static forms (costs, additional
 * costs, can't be countered, alternative costs, casting permissions, enters with; front/spellforms.ts); everything else is a static ability. The shape is a best guess: the chart parser re-checks it,
 * and a line it cannot parse becomes a manual ability of this shape, never behavior.
 *
 * Every range is in the normalized text. Structure (chapter numerals, loyalty costs, bullets, dice-row prefixes, level headers) is claimed in the ledger as
 * `structure`; labels and reminder text come from preprocess; everything else starts as `manual` ("not parsed") until a later package consumes it.
 */
import type { Condition } from '../types/ability';
import type { Diagnostic, LedgerEntry } from './types';
import { keywordAt, lexiconIndex, GENERATED_LEXICON, type LexiconIndex } from './front/lexicon-index';
import { bulletLine, chapterPrefix, classLevelLine, COST_STARTS, dicePrefix, levelHeader, loyaltyPrefix, pawprintLine, ptLine, skipSpaces, spreeLine } from './front/shapes';
import { detectLead, firstDash } from './front/labels';
import { splitSentences, isContinuation, type Sentence } from './front/sentences';
import { completeLedger } from './front/ledger';
import { reminderDiagnostics } from './front/reminders';
import { isDelayedTriggerLine, isSpellStaticForm } from './front/spellforms';
import { collapse, trimRange } from './front/text';
import type { FaceContext, FrontEndOptions, LineLabel, PreLine, PreprocessedFace, Range } from './front/types';
import { preprocessFace, selfExtents } from './preprocess';
import { tokenize, type Token } from './tokenize';
import { SIEGE_WORD_SET } from './holes/r3mech';

export const OWNER = 'WP5' as const;

export type { Sentence } from './front/sentences';

export type AbilityShape =
  | 'keyword' | 'triggered' | 'activated' | 'loyalty' | 'spell' | 'static' | 'chapter' | 'levelBracket' | 'classLevel' | 'case' | 'unknown';

/** One keyword of a keyword line: `Flying`, `Kicker {1}{G}`, `Ward--Pay 3 life`. */
export interface KeywordItem {
  /** Canonical name from the lexicon / registry. */
  name: string;
  /** The whole item as written, from the name to its last token. */
  range: Range;
  nameRange: Range;
  /** Everything after the name (cost, number, quality, or after the dash), if anything. */
  paramRange?: Range;
  /** Written with a dash (`Escape--{3}{R}{R}, ...`). */
  dash: boolean;
  tokens: Token[];
}

/** One bullet of a modal spell/ability, or one `+ {cost} -- effect` line of a Spree spell. */
export interface Mode {
  line: number;
  /** The `•` (bullets) or the `+` (spree). */
  marker: Range;
  /** Spree: the additional cost written before the dash; FAST5X E11, tiered: the cost between the mode's name and its effect (CR 702.183a, 700.2h). */
  cost?: Range;
  /**
   * FAST5X E11 ADDITION (optional): the name printed before a mode's effect ("• Street Justice -- Exile ...", "• Fire -- {0} -- ..."): a flavor word with no rules
   * meaning (CR 207.2d), claimed as structure; the range of its words (without the dash).
   */
  label?: Range;
  /** std-blb (CR 700.2i): the number of pawprint symbols `{P}` before a mode of a "Choose up to N {P} worth of modes" spell. */
  pawprints?: number;
  sentences: Sentence[];
}

/**
 * A die-roll result row: `1-9 | effect` (CR 706.2). The same shape carries the threshold rows of a Station card, `8+ | Flying` (CR 721.2): the lines below such
 * a row, up to the next one, are part of it and are listed in `more` (the abilities printed in the same striation as the station symbol).
 */
export interface DiceRow {
  line: number;
  min: number;
  /** null = "or more" (`15+`). */
  max: number | null;
  /** `1-9 | `, claimed as structure. */
  prefix: Range;
  sentences: Sentence[];
  /** Station only: the following lines that belong to this threshold, each with its sentences. */
  more?: { line: number; sentences: Sentence[] }[];
  /**
   * FAST5 T54 ADDITION (optional, Station only): the abilities printed in this threshold's striation (CR 721.2), each classified as a line of its own: first the
   * text after `N+ | ` on the row's line, then every line below it (`more`). `lower/ability.ts#stationAbilities` lowers each like any ability.
   */
  segs?: AbilitySegment[];
  /** T54: a line of the striation is not an ability of a permanent, so `segs` is not the whole striation. */
  segsBroken?: boolean;
}

export interface AbilitySegment {
  shape: AbilityShape;
  /** Indices of the normalized Oracle lines (AbilityBase.src), in order. */
  lines: number[];
  /** The ranges of the ability's own text, one per line (labels excluded, structure included). */
  ranges: Range[];
  /** From the first to the last non-space character of `ranges`. */
  range: Range;
  /** Display text: reminder text removed, "~" for the object, label removed, whitespace collapsed, lines joined with "\n". */
  text: string;
  label?: LineLabel;
  /** Reminder spans inside the ability's lines. */
  reminders: Range[];
  /** The ability's sentences in text order (modal bullets and dice rows are in `modal` / `rollTable`). Tokens of structure (chapter numerals, loyalty cost) are not here. */
  sentences: Sentence[];
  modal?: { kind: 'bullets' | 'spree' | 'pawprint'; modes: Mode[] };
  rollTable?: DiceRow[];
  keywordItems?: KeywordItem[];
  loyalty?: { sign: '+' | '-' | '0'; amount: number | 'X'; range: Range };
  chapters?: number[];
  /** levelBracket: `LEVEL 3-7` and the bracket's power/toughness line. */
  level?: { min: number; max: number | null; header: Range; power?: string; toughness?: string };
  /** classLevel: the level and the mana cost to reach it (absent for level 1). */
  classLevel?: { level: number; cost?: Range };
  /** levelBracket / classLevel / case: the abilities inside (a Case: its "Solved --" ability, CR 719.3c). */
  children?: AbilitySegment[];
  /**
   * M6-6 (CR 719.3a-c): a Case's two keyword lines. `solve` is the condition of "To solve -- [condition]" (its sentences are this segment's); `solvedLine` marks the
   * segment of a "Solved -- [ability]" line until `flat` joins it to the "To solve" segment as its child.
   */
  case?: { solve?: Range; solvedLine?: boolean };
  /** A spell face's line that is one of the static forms (costs less, additional cost, can't be countered, alternative cost, enters with). */
  spellStatic?: boolean;
  /** FAST1 T4: an activated ability written after a wrapper keyword ("Exhaust -- [Cost]: [Effect]", CR 702.177a): the keyword and its words with the dash. */
  wrapper?: { keyword: string; range: Range };
  /**
   * FAST5X-4: a static ability that is a granting keyword's meaning ("Max speed -- [Ability]" is "As long as your speed is 4, this object has [Ability]",
   * CR 702.178a): the keyword, its words with the dash, and the condition it grants under (ParseOptions.keywords[].grants). The granted ability is the one
   * child, classified like any line; lower/ability.ts#grantLine builds the static ability.
   */
  grant?: { keyword: string; range: Range; while: Condition };
  /**
   * Cloud r3-mech (CR 614.12a, 607.2d): a Siege's bulleted ability, "• [Word] -- [Ability]" under "As ~ enters, choose [Word] or [Word].": the permanent has the
   * ability only if that word was chosen as it entered. The word, the choice's link, and the word with its dash; the ability is the one child, classified like
   * any line; lower/ability.ts#grantLine builds a static ability that grants it while the chosen word is this one.
   * Also (word '∞', no link) an Infinity Stone's "∞ -- [Ability]", granted while the permanent is harnessed (CR 701.64).
   */
  chosenMode?: { word: string; link: string; range: Range };
}

export interface SegmentedFace {
  pre: PreprocessedFace;
  abilities: AbilitySegment[];
  /** Complete: every non-space character is in exactly one entry. `manual` entries are text no template has consumed yet. */
  ledger: LedgerEntry[];
  diagnostics: Diagnostic[];
}

const TRIGGER_WORDS = new Set(['when', 'whenever', 'at']);

function hull(ranges: readonly Range[]): Range {
  let a = Infinity;
  let b = -Infinity;
  for (const r of ranges) {
    a = Math.min(a, r[0]);
    b = Math.max(b, r[1]);
  }
  return a <= b ? [a, b] : [0, 0];
}

/** Stateful helper so the decision list reads like the table of the design. */
class Segmenter {
  readonly parse: string;
  readonly lower: string;
  readonly ix: LexiconIndex;
  readonly ctx: FaceContext;
  readonly lines: readonly PreLine[];
  readonly structure: LedgerEntry[] = [];
  readonly diagnostics: Diagnostic[] = [];
  private readonly extents: Map<number, Range>;
  private readonly isSpell: boolean;
  private readonly isPlaneswalker: boolean;
  private readonly isSaga: boolean;

  constructor(readonly pre: PreprocessedFace, readonly opts: FrontEndOptions) {
    this.parse = pre.parse;
    this.lower = pre.parse.toLowerCase();
    this.ix = lexiconIndex(opts.lexicon ?? GENERATED_LEXICON, opts.keywords);
    this.ctx = pre.context;
    this.lines = pre.lines;
    this.extents = selfExtents(pre);
    this.isSpell = this.ctx.types.some((t) => t === 'instant' || t === 'sorcery');
    this.isPlaneswalker = this.ctx.types.includes('planeswalker');
    this.isSaga = this.ctx.subtypes.includes('saga') || this.ctx.layout === 'saga';
  }

  private readonly tokenCache = new Map<string, Token[]>();

  /** Tokens of a range of the parse text (memoized: the decision list looks at a line several times; diagnostics are recorded once). */
  tokens(range: Range): Token[] {
    const key = `${range[0]}:${range[1]}`;
    const hit = this.tokenCache.get(key);
    if (hit) return hit;
    const out = tokenize(this.parse, { ...(this.opts.lexicon ? { lexicon: this.opts.lexicon } : {}), ...(this.opts.cardNames ? { cardNames: this.opts.cardNames } : {}), from: range[0], to: range[1], selfExtents: this.extents });
    this.tokenCache.set(key, out);
    for (const t of out) this.noteErrors(t);
    return out;
  }

  private noteErrors(t: Token): void {
    if (t.kind === 'ERR') this.diagnostics.push({ level: 'warning', code: 'unknown-word', message: t.reason ?? 'unknown character', range: t.range });
    for (const s of t.sub ?? []) this.noteErrors(s);
  }

  /** Claims text as structure in the ledger, leaving out reminder text that sits inside it. */
  claim(range: Range, by: string): void {
    let at = range[0];
    const holes = this.pre.reminders.map((r) => r.range).filter((r) => r[0] < range[1] && r[1] > range[0]);
    const pieces: Range[] = [];
    for (const h of holes) {
      if (h[0] > at) pieces.push([at, h[0]]);
      at = Math.max(at, h[1]);
    }
    if (at < range[1]) pieces.push([at, range[1]]);
    for (const p of pieces) {
      const r = trimRange(this.pre.normalized, p);
      if (r[0] < r[1]) this.structure.push({ range: r, status: 'structure', by });
    }
  }

  sentencesOf(range: Range, line: number): Sentence[] {
    return splitSentences(this.tokens(range), line);
  }

  /**
   * One bullet of a modal ability. FAST5X E11: a name before the effect ("• Street Justice -- Exile target creature ...", a flavor word with no rules meaning,
   * CR 207.2d) is claimed as structure; "• Fire -- {0} -- Fire Magic deals ..." (tiered, CR 702.183a, 700.2h) also has the mode's additional cost between two
   * dashes. Anything else is a bullet as before.
   */
  private bulletMode(line: number, marker: Range, rest: Range): Mode {
    const plain: Mode = { line, marker, sentences: this.sentencesOf(rest, line) };
    if (firstDash(this.parse, rest) <= rest[0]) return plain;
    const lead = detectLead(this.parse, rest, this.ix);
    // p2-modal-2 (CR 207.2d): a mode named with the card's own name ("• Typhoid Mary -- Draw a card."): the name is a flavor word there, never a reference to the object;
    // only a bullet whose whole label is that name (the parse text's "~"), with a body after the dash
    if (lead.label === undefined) {
      const d = firstDash(this.parse, rest);
      const pre = trimRange(this.parse, [rest[0], d]);
      if (this.parse.slice(pre[0], pre[1]) !== '~') return plain; // (the parse text pads the replaced name with blanks before its "~")
      const bodyStart = skipSpaces(this.parse, d + 2, rest[1]);
      if (bodyStart >= rest[1]) return plain;
      this.claim([rest[0], d + 2], 'mode-label');
      return { line, marker, label: trimRange(this.pre.normalized, [rest[0], d]), sentences: this.sentencesOf([bodyStart, rest[1]], line) };
    }
    const label: Range = [rest[0], rest[0] + lead.label.text.length];
    const after = lead.body;
    const d2 = firstDash(this.parse, after);
    if (d2 > after[0]) {
      const costEnd = trimRange(this.parse, [after[0], d2])[1];
      if (/^(?:\{[^}]+\})+$/.test(this.parse.slice(after[0], costEnd))) {
        const effect: Range = [skipSpaces(this.pre.normalized, d2 + 2, rest[1]), rest[1]];
        this.claim([rest[0], after[0]], 'mode-label');
        this.claim([d2, d2 + 2], 'tiered');
        return { line, marker, label, cost: [after[0], costEnd], sentences: this.sentencesOf(effect, line) };
      }
    }
    // FAST5 fix-guards (CR 201.5, 700.2): the label's range runs to where the body starts in the parse text, and a body that opens with a reference to the
    // object itself ("• Kill -- This spell deals 3 damage ...", "• Boil -- Potatoes deals ...") starts at its "~", after the blank padding of the replaced
    // words; the claim ends at the dash (trimmed in the parse text) so it never takes the self reference's words, which are the body's SELF token
    this.claim(trimRange(this.parse, lead.label.range), 'mode-label');
    return { line, marker, label, sentences: this.sentencesOf(after, line) };
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // The top level: levels, class levels, then the flat decision list
  // ---------------------------------------------------------------------------------------------------------------------------------

  run(): AbilitySegment[] {
    const active = this.lines.filter((l) => !l.blank && !l.reminderOnly).map((l) => l.index);
    // Level brackets (CR 711) and class levels (CR 716) split the face first; what is inside them goes through the flat decision list.
    if (active.some((i) => levelHeader(this.parse, this.lines[i]!.body))) return this.levelBrackets(active);
    if (active.some((i) => classLevelLine(this.parse, this.lines[i]!.body))) return this.classLevels(active);
    return this.flat(active);
  }

  private levelBrackets(idxs: number[]): AbilitySegment[] {
    const firstHeader = idxs.findIndex((i) => levelHeader(this.parse, this.lines[i]!.body));
    // What comes before the first LEVEL line (Level up, the creature's own abilities) is ordinary.
    const out: AbilitySegment[] = this.flat(idxs.slice(0, firstHeader));
    let p = firstHeader;
    while (p < idxs.length) {
      const head = this.lines[idxs[p]!]!;
      const lh = levelHeader(this.parse, head.body)!;
      let q = p + 1;
      const inner: number[] = [];
      let power: string | undefined;
      let toughness: string | undefined;
      const lines = [head.index];
      if (q < idxs.length && !levelHeader(this.parse, this.lines[idxs[q]!]!.body)) {
        const pt = ptLine(this.parse, this.lines[idxs[q]!]!.body);
        if (pt) {
          power = pt.power;
          toughness = pt.toughness;
          lines.push(idxs[q]!);
          this.claim(this.lines[idxs[q]!]!.body, 'levelBracket');
          q++;
        }
      }
      while (q < idxs.length && !levelHeader(this.parse, this.lines[idxs[q]!]!.body)) inner.push(idxs[q++]!);
      this.claim(head.body, 'levelBracket');
      const children = this.flat(inner);
      const seg = this.make('levelBracket', [...lines, ...inner]);
      seg.level = { min: lh.min, max: lh.max, header: head.body, ...(power !== undefined ? { power, toughness: toughness! } : {}) };
      seg.children = children;
      out.push(this.finish(seg));
      p = q;
    }
    return out;
  }

  private classLevels(idxs: number[]): AbilitySegment[] {
    const out: AbilitySegment[] = [];
    let cur: { level: number; cost?: Range; head?: number; inner: number[] } = { level: 1, inner: [] };
    const flush = (): void => {
      if (cur.inner.length === 0 && cur.head === undefined) return;
      const seg = this.make('classLevel', [...(cur.head !== undefined ? [cur.head] : []), ...cur.inner]);
      seg.classLevel = { level: cur.level, ...(cur.cost ? { cost: cur.cost } : {}) };
      seg.children = this.flat(cur.inner);
      out.push(this.finish(seg));
    };
    for (const i of idxs) {
      const cl = classLevelLine(this.parse, this.lines[i]!.body);
      if (cl) {
        flush();
        this.claim(this.lines[i]!.body, 'classLevel');
        cur = { level: cl.level, cost: cl.cost, head: i, inner: [] };
      } else cur.inner.push(i);
    }
    flush();
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // The flat decision list
  // ---------------------------------------------------------------------------------------------------------------------------------

  private flat(idxs: number[]): AbilitySegment[] {
    const out: AbilitySegment[] = [];
    let spell: AbilitySegment | undefined; // an instant or sorcery has ONE spell ability (CR 113.3a, 608.2)
    let prev: AbilitySegment | undefined; // the ability that dice rows and stray bullets attach to
    let openRow: DiceRow | undefined; // the Station threshold row that takes the lines below it
    const getSpell = (): AbilitySegment => {
      if (!spell) {
        spell = this.make('spell', []);
        out.push(spell);
      }
      return spell;
    };
    const add = (shape: AbilityShape): AbilitySegment => {
      const s = this.make(shape, []);
      out.push(s);
      return s;
    };

    for (let p = 0; p < idxs.length; p++) {
      const L = this.lines[idxs[p]!]!;
      const body = L.body;

      // Dice rows belong to the ability above (design 6.2 row 4).
      const dice = dicePrefix(this.parse, this.pre.normalized, body);
      if (dice) {
        const target = prev ?? (prev = add('unknown'));
        this.claim(dice.range, 'diceRow');
        this.extend(target, L, body);
        const row: DiceRow = { line: L.index, min: dice.min, max: dice.max, prefix: dice.range, sentences: this.sentencesOf([dice.range[1], body[1]], L.index) };
        (target.rollTable ??= []).push(row);
        openRow = target.keywordItems?.[0]?.name.toLowerCase() === 'station' ? row : undefined; // T35: the registry spells the keyword in lower case
        if (openRow) this.stationSeg(openRow, L, trimRange(this.parse, [dice.range[1], body[1]]));
        continue;
      }
      // Below a Station threshold row every line belongs to that row until the next row (CR 721.2).
      if (openRow && prev) {
        this.extend(prev, L, body);
        (openRow.more ??= []).push({ line: L.index, sentences: this.sentencesOf(body, L.index) });
        this.stationSeg(openRow, L, body);
        continue;
      }
      // Spree lines (row 5): the additional costs and effects of one modal spell.
      const spree = spreeLine(this.parse, this.pre.normalized, body);
      if (spree) {
        const target = this.isSpell ? getSpell() : prev && prev.modal?.kind === 'spree' ? prev : add('static');
        this.claim(spree.plus, 'spree');
        this.claim(spree.dash, 'spree');
        this.extend(target, L, body);
        (target.modal ??= { kind: 'spree', modes: [] }).modes.push({ line: L.index, marker: spree.plus, cost: spree.cost, sentences: this.sentencesOf(spree.rest, L.index) });
        prev = target;
        continue;
      }
      // std-blb (CR 700.2i): the "{P}{P} -- effect" lines of a spell are its modes, each with its pawprints (the header above them is a sentence of the spell)
      const paw = this.isSpell ? pawprintLine(this.parse, this.pre.normalized, body) : undefined;
      if (paw) {
        const target = getSpell();
        this.claim(paw.marker, 'pawprint');
        this.claim(paw.dash, 'pawprint');
        this.extend(target, L, body);
        (target.modal ??= { kind: 'pawprint', modes: [] }).modes.push({ line: L.index, marker: paw.marker, pawprints: paw.pawprints, sentences: this.sentencesOf(paw.rest, L.index) });
        prev = target;
        continue;
      }
      // A bullet with no header above it stays with the ability above (the header may have worded the choice differently).
      const bullet = bulletLine(this.parse, this.pre.normalized, body);
      // Cloud r3-mech: a Siege's "• [Word] -- [Ability]" is an ability of its own, had only if that word was chosen (siegeMode); the header stays `prev`
      const siege = bullet && prev ? this.siegeMode(prev, L, bullet) : undefined;
      if (siege) {
        out.push(siege);
        continue;
      }
      if (bullet) {
        const target = prev ?? (prev = add('unknown'));
        this.claim(bullet.bullet, 'bullet');
        const mode = this.bulletMode(L.index, bullet.bullet, bullet.rest);
        // FAST5X E11 (CR 702.183a): the "• Name -- {cost} -- effect" lines of a tiered spell are the modes of the spell itself (as Spree lines are), not of the
        // keyword line above them
        const owner = mode.cost !== undefined && this.isSpell ? getSpell() : target;
        if (owner !== target) { this.extend(owner, L, body); prev = owner; } else this.extend(target, L, body);
        (owner.modal ??= { kind: 'bullets', modes: [] }).modes.push(mode);
        continue;
      }

      const c = this.classify(L);
      let seg: AbilitySegment;
      if (c.spell) {
        seg = getSpell();
        this.extend(seg, L, body);
        seg.sentences.push(...this.sentencesOf(body, L.index));
        if (L.label && !seg.label) seg.label = L.label;
      } else {
        seg = c.seg;
        out.push(seg);
      }
      prev = seg;

      // A header that ends with a dash takes the bullets below it (row 5).
      if (this.endsWithDash(L)) {
        while (p + 1 < idxs.length) {
          const NL = this.lines[idxs[p + 1]!]!;
          const nb = bulletLine(this.parse, this.pre.normalized, NL.body);
          if (!nb) break;
          this.claim(nb.bullet, 'bullet');
          this.extend(seg, NL, NL.body);
          (seg.modal ??= { kind: 'bullets', modes: [] }).modes.push(this.bulletMode(NL.index, nb.bullet, nb.rest));
          p++;
        }
      }
    }
    return joinCaseLines(out).map((s) => this.finish(s));
  }

  /**
   * FAST5 T54 (CR 721.2): one line of a Station threshold's striation, classified like a line of its own (the text after the symbol on the symbol's line, or a
   * line below it). A line that is not an ability of a permanent marks the row `segsBroken`, which the lowering keeps manual.
   */
  private stationSeg(row: DiceRow, L: PreLine, range: Range): void {
    if (range[0] >= range[1]) return;
    const c = this.classify({ ...L, body: range, label: undefined, keywordDash: undefined });
    if (c.spell) { row.segsBroken = true; return; }
    (row.segs ??= []).push(this.finish(c.seg));
  }

  /** The link of a Siege's choice (the header's template, zz-cloud/r3-mech.json `rep.r3mech.enters.choose.siege`, writes the same name). */
  static readonly SIEGE_LINK = 'siege';

  /**
   * Cloud r3-mech (CR 614.12a, 607.2d): "As this enchantment enters, choose Abzan or Mardu." followed by "• Abzan -- [Ability]" and "• Mardu -- [Ability]" (the
   * Sieges of Fate Reforged and Tarkir: Dragonstorm): each bullet is an ability the permanent has only if its word was chosen as it entered, not a mode of the
   * header. The header is one line of exactly that sentence with two different words of the closed list (parser/holes/r3mech.ts), and the bullet's label is one of
   * them, alone before the dash. The ability after the dash is classified like any line and becomes the one child; a bullet that is not such a line, or whose
   * ability is a spell line, stays a mode of the header as before (and the header is not understood, so the card stays manual).
   */
  private siegeMode(header: AbilitySegment, L: PreLine, bullet: { bullet: Range; rest: Range }): AbilitySegment | undefined {
    if (header.ranges.length !== 1 || header.modal !== undefined) return undefined;
    const head = this.lower.slice(header.ranges[0]![0], header.ranges[0]![1]).replace(/\s+/g, ' ').trim();
    const m = /^as (?:~|this [a-z]+) enters, choose ([a-z]+) or ([a-z]+)\.$/.exec(head);
    if (!m || m[1] === m[2] || !SIEGE_WORD_SET.has(m[1]!) || !SIEGE_WORD_SET.has(m[2]!)) return undefined;
    const rest = bullet.rest;
    const dash = firstDash(this.parse, rest);
    if (dash <= rest[0]) return undefined;
    const label = trimRange(this.parse, [rest[0], dash]);
    const word = this.lower.slice(label[0], label[1]);
    if (word !== m[1] && word !== m[2]) return undefined;
    const after = trimRange(this.parse, [dash + 2, rest[1]]);
    const inner = after[0] < after[1] ? this.classify({ index: L.index, range: L.range, blank: false, reminderOnly: false, body: after }) : undefined;
    if (!inner || inner.spell) return undefined;
    this.claim(bullet.bullet, 'bullet');
    const wrap: Range = [label[0], dash + 2];
    this.claim(wrap, 'siege-mode');
    const s = this.make('static', [L.index]);
    s.ranges = [[label[0], rest[1]]];
    s.children = [this.finish(inner.seg)];
    s.chosenMode = { word: this.parse.slice(label[0], label[1]), link: Segmenter.SIEGE_LINK, range: wrap };
    return s;
  }

  private endsWithDash(L: PreLine): boolean {
    const t = trimRange(this.parse, L.body);
    return t[1] - t[0] >= 2 && this.parse.slice(t[1] - 2, t[1]) === '--';
  }

  /** An empty segment of a shape; `lines` are added at once (their whole bodies are its ranges) or later with `extend`. */
  make(shape: AbilityShape, lines: number[]): AbilitySegment {
    const ranges = lines.map((i) => this.lines[i]!.body);
    return { shape, lines: [...lines], ranges, range: hull(ranges), text: '', reminders: [], sentences: [] };
  }

  /** Adds a line (its body range) to a segment. */
  extend(seg: AbilitySegment, L: PreLine, range: Range): void {
    if (!seg.lines.includes(L.index)) {
      seg.lines.push(L.index);
      seg.ranges.push(range);
    }
  }

  private finish(seg: AbilitySegment): AbilitySegment {
    seg.range = hull(seg.ranges);
    seg.text = collapse(this.parse, seg.ranges, seg.shape === 'chapter' && seg.label ? ' ' : '\n'); // FAST5 T45: the numerals and the text after a flavor word are one line
    seg.reminders = this.pre.reminders.filter((r) => seg.lines.includes(r.line)).map((r) => r.range);
    // Continuations are judged over the whole ability, across lines.
    seg.sentences.forEach((s, i) => {
      s.continuation = i > 0 && isContinuation(s.tokens);
    });
    return seg;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Classifying one head line
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** One head line: a new ability, or (spell: true) a line of the face's single spell ability. */
  private classify(L: PreLine): { spell: false; seg: AbilitySegment } | { spell: true } {
    const body = L.body;
    const single = (shape: AbilityShape, rest: Range, range: Range = body): AbilitySegment => {
      const s = this.make(shape, [L.index]);
      s.ranges = [range];
      if (L.label) s.label = L.label;
      s.sentences = this.sentencesOf(rest, L.index);
      return s;
    };

    // M6-6 (CR 719.3): the two keyword lines of a Case. "To solve -- [condition]" keeps its condition as the segment's sentences; "Solved -- [ability]" is the
    // ability after the dash, classified like any line, and `flat` makes it the child of the "To solve" segment (lower/ability.ts builds the CaseDef).
    const lowerBody = this.lower.slice(body[0], body[1]);
    if (lowerBody.startsWith('to solve --')) {
      const dash = body[0] + 'to solve --'.length;
      this.claim([body[0], dash], 'case');
      const cond = trimRange(this.parse, [dash, body[1]]);
      const s = single('case', cond, body);
      s.case = { solve: cond };
      return { spell: false, seg: s };
    }
    const solvedKeyword = L.keywordDash?.name.toLowerCase() === 'solved' ? L.keywordDash : undefined;
    const solvedDash = solvedKeyword ? solvedKeyword.dashRange[1] : lowerBody.startsWith('solved --') ? body[0] + 'solved --'.length : undefined;
    if (solvedDash !== undefined && this.ctx.subtypes.includes('case')) {
      const start = solvedKeyword ? solvedKeyword.nameRange[0] : body[0];
      const rest = trimRange(this.parse, [solvedDash, body[1]]);
      const inner = rest[0] < rest[1] ? this.classify({ index: L.index, range: L.range, blank: false, reminderOnly: false, body: rest }) : undefined;
      if (!inner || inner.spell) {
        const whole: Range = [start, body[1]];
        return { spell: false, seg: single('case', whole, whole) };
      }
      this.claim([start, solvedDash], 'case');
      const s = this.make('case', [L.index]);
      s.ranges = [[start, body[1]]];
      s.children = [this.finish(inner.seg)];
      s.case = { solvedLine: true };
      return { spell: false, seg: s };
    }
    // Cloud r3-mech (CR 701.64): "∞ -- [Ability]" (an Infinity Stone's ability) functions only while the permanent is harnessed: a static ability that grants
    // [Ability] to itself while it is harnessed, as "Max speed -- [Ability]" below (lower/ability.ts#grantLine); the ability after the dash is the one child
    const ikd = L.keywordDash?.name === '∞' ? L.keywordDash : undefined;
    if (ikd && this.parse.slice(ikd.nameRange[1], ikd.dashRange[0]).trim() === '') {
      const dash = ikd.dashRange[1];
      const rest = trimRange(this.parse, [dash, body[1]]);
      const inner = rest[0] < rest[1] ? this.classify({ index: L.index, range: L.range, blank: false, reminderOnly: false, body: rest }) : undefined;
      if (inner && !inner.spell) {
        const wrap: Range = [ikd.nameRange[0], dash];
        this.claim(wrap, 'infinity');
        const s = this.make('static', [L.index]);
        s.ranges = [[ikd.nameRange[0], body[1]]];
        s.children = [this.finish(inner.seg)];
        s.chosenMode = { word: '∞', link: '', range: wrap };
        return { spell: false, seg: s };
      }
    }
    // FAST5X-4 (CR 702.178a): "Max speed -- [Ability]" is a static ability that grants [Ability] while the keyword's condition holds; the ability after the dash
    // is classified like any line and becomes the one child (lower/ability.ts#grantLine). Only for an implemented granting keyword (ParseOptions.keywords).
    const gkd = L.keywordDash;
    const granting = gkd ? this.opts.keywords?.find((k) => k.name.toLowerCase() === gkd.name.toLowerCase() && k.grants !== undefined) : undefined;
    if (gkd && granting?.grants && this.parse.slice(gkd.nameRange[1], gkd.dashRange[0]).trim() === '') {
      const rest = trimRange(this.parse, [gkd.dashRange[1], body[1]]);
      const inner = rest[0] < rest[1] ? this.classify({ index: L.index, range: L.range, blank: false, reminderOnly: false, body: rest }) : undefined;
      if (inner && !inner.spell) {
        const wrap: Range = [gkd.nameRange[0], gkd.dashRange[1]];
        this.claim(wrap, 'keyword-wrapper');
        const s = this.make('static', [L.index]);
        s.ranges = [[gkd.nameRange[0], body[1]]];
        s.children = [this.finish(inner.seg)];
        s.grant = { keyword: granting.name.toLowerCase(), range: wrap, while: JSON.parse(JSON.stringify(granting.grants)) as Condition };
        return { spell: false, seg: s };
      }
    }
    // Chapters (CR 714.2).
    const chapter = this.isSaga ? chapterPrefix(this.parse, this.pre.normalized, body) : undefined;
    if (chapter) {
      this.claim(chapter.range, 'chapter');
      // FAST5 T45 (CR 207.2d): a flavor word or ability word after the numerals ("III -- Triple -- When you next cast ...") is a label like on any other line:
      // it has no rules meaning and is claimed as a label, never read as part of the chapter's text
      const after = detectLead(this.pre.normalized, [chapter.range[1], body[1]], this.ix);
      const s = single('chapter', after.label ? after.body : [chapter.range[1], body[1]]);
      if (after.label) {
        s.ranges = [[body[0], chapter.range[1]], after.body]; // the display text leaves the label out, as for any labelled line
        s.label = after.label;
        // FAST5 T49: the front end already claims a chapter line's flavor word as a label in its ledger (preprocess.ts, PreLine.chapterLabel)
        if (!L.chapterLabel) this.structure.push({ range: trimRange(this.pre.normalized, after.label.range), status: 'label', by: after.label.kind });
      }
      s.chapters = chapter.chapters;
      if (L.chapterLabel && s.label === undefined) s.label = L.chapterLabel; // FAST5 T49
      return { spell: false, seg: s };
    }
    // Loyalty abilities (CR 606).
    const loyalty = this.isPlaneswalker ? loyaltyPrefix(this.parse, this.pre.normalized, body) : undefined;
    if (loyalty) {
      this.claim(loyalty.range, 'loyalty');
      const s = single('loyalty', [loyalty.range[1], body[1]]);
      s.loyalty = { sign: loyalty.sign, amount: loyalty.amount, range: loyalty.range };
      return { spell: false, seg: s };
    }
    // FAST1 T4 (CR 702.177a): a wrapper keyword with a dash before an activated ability ("Exhaust -- {3}{G}: ...") is that activated ability; the keyword gives
    // its restrictions (ParseOptions.keywords[].wraps, applied by lower/ability.ts)
    const kd = L.keywordDash;
    const wrapping = kd ? this.opts.keywords?.find((k) => k.name.toLowerCase() === kd.name.toLowerCase() && k.wraps !== undefined) : undefined;
    if (kd && wrapping && this.parse.slice(kd.nameRange[1], kd.dashRange[0]).trim() === '' && this.isActivated(this.tokens(body))) {
      const wrap: Range = [kd.nameRange[0], kd.dashRange[1]];
      this.claim(wrap, 'keyword-wrapper');
      const s = single('activated', body, [kd.nameRange[0], body[1]]);
      s.wrapper = { keyword: wrapping.name.toLowerCase(), range: wrap };
      return { spell: false, seg: s };
    }
    // M6-6 (CR 718.1, 702.160): "Prototype {M} -- P/T" is the prototype keyword with its cost; the P/T after the dash is the inset frame's power and toughness
    // box, structure like a leveler's P/T line (cards/faces.ts reads the alternative characteristics into FaceDef.prototype)
    const pkd = L.keywordDash?.name.toLowerCase() === 'prototype' ? L.keywordDash : undefined;
    if (pkd && /^\d+\/\d+$/.test(this.parse.slice(body[0], body[1]).trim())) {
      const keyword = trimRange(this.parse, [pkd.nameRange[0], pkd.dashRange[0]]);
      const param = trimRange(this.parse, [pkd.nameRange[1], keyword[1]]);
      if (/^(?:\{[^}]+\})+$/.test(this.parse.slice(param[0], param[1]))) {
        this.claim([pkd.dashRange[0], body[1]], 'prototype');
        const s = single('keyword', keyword, keyword);
        s.keywordItems = [{ name: pkd.name, range: keyword, nameRange: pkd.nameRange, paramRange: param, dash: false, tokens: this.tokens(keyword) }];
        return { spell: false, seg: s };
      }
    }
    // CMP1 (CR 702.139a): "Companion -- [Condition]" is the companion keyword; the condition is a deck-construction rule ("your starting deck ...", CR
    // 702.139b) that the game never reads: it is checked before the game by packages/cards/src/formats/companion.ts (data per card) and claimed here as
    // structure, like prototype's P/T box above, so the keyword ability is "companion" with no parameter (its special action: core/special/companion.ts).
    const ckd = L.keywordDash?.name.toLowerCase() === 'companion' ? L.keywordDash : undefined;
    if (ckd && this.parse.slice(ckd.nameRange[1], ckd.dashRange[0]).trim() === '' && this.parse.slice(body[0], body[1]).trim() !== '') {
      const keyword = trimRange(this.parse, ckd.nameRange);
      this.claim([ckd.dashRange[0], body[1]], 'companion-condition');
      const s = single('keyword', keyword, keyword);
      s.keywordItems = [{ name: ckd.name, range: keyword, nameRange: ckd.nameRange, dash: false, tokens: this.tokens(keyword) }];
      return { spell: false, seg: s };
    }
    // A keyword with a dash, or a line of keywords (row 7).
    const items = this.keywordItems(L);
    if (items) {
      const whole: Range = L.keywordDash ? [L.keywordDash.nameRange[0], body[1]] : body;
      const s = single('keyword', whole, whole);
      s.keywordItems = items;
      return { spell: false, seg: s };
    }

    const toks = this.tokens(body);
    const first = toks[0];
    // Triggered abilities (row 8). On a spell face a trigger that the spell creates when it resolves ("At the beginning of your next upkeep", "Whenever a
    // creature blocks this turn") is a delayed triggered ability (CR 603.7) and part of the one spell ability (CR 113.3a, 608.2).
    if (first && first.kind === 'WORD' && TRIGGER_WORDS.has(first.norm)) {
      if (this.isSpell && isDelayedTriggerLine(toks)) return { spell: true };
      return { spell: false, seg: single('triggered', body) };
    }
    // Activated abilities (row 9): an unquoted colon after something cost-like.
    if (this.isActivated(toks)) return { spell: false, seg: single('activated', body) };
    // Spell faces (row 10): one spell ability, except the static forms.
    if (this.isSpell) {
      if (!isSpellStaticForm(toks, this.ix)) return { spell: true };
      const s = single('static', body);
      s.spellStatic = true;
      return { spell: false, seg: s };
    }
    // Static abilities (row 11).
    return { spell: false, seg: single('static', body) };
  }

  // ---------------------------------------------------------------------------------------------------------------------------------
  // Recognizers over tokens
  // ---------------------------------------------------------------------------------------------------------------------------------

  /** Items of a keyword line, or undefined when the line is not one (design 6.2 row 7). */
  private keywordItems(L: PreLine): KeywordItem[] | undefined {
    const body = L.body;
    if (L.keywordDash) {
      const d = L.keywordDash;
      const whole: Range = [d.nameRange[0], body[1]];
      const paramStart = trimRange(this.parse, [d.nameRange[1], body[1]])[0];
      return [{ name: d.name, range: whole, nameRange: d.nameRange, ...(paramStart < body[1] ? { paramRange: [paramStart, body[1]] as Range } : {}), dash: true, tokens: this.tokens(whole) }];
    }
    const toks = this.tokens(body);
    if (toks.length === 0 || toks.some((t) => t.kind === 'ERR')) return undefined;
    // r4-fxz (CR 702.181a, 107.3): "Mobilize X, where X is the number of creature cards in your graveyard." is ONE keyword whose number is defined after a comma
    // (keyword templates read the whole item, parser/templates/zz-cloud/r4-fxz.json kw.fxz.mobilize.whereX); the comma is not a list of keywords here
    const xAt = toks.findIndex((t) => t.kind === 'X');
    if (xAt > 0 && toks[xAt + 1]?.norm === ',' && toks[xAt + 2]?.norm === 'where' && toks[xAt + 3]?.kind === 'X' && toks[xAt + 4]?.norm === 'is') {
      const start = toks[0]!.range[0];
      const hit = keywordAt(this.ix, this.lower, start);
      if (hit && start + hit.length <= toks[xAt]!.range[0] && toks.slice(0, xAt).every((t) => t.kind === 'WORD')) {
        const end = toks[toks.length - 1]!.range[1];
        const nameRange: Range = [start, start + hit.length];
        return [{ name: hit.name, range: [start, end], nameRange, paramRange: [toks[xAt]!.range[0], end], dash: false, tokens: toks }];
      }
    }
    // std-rf (CR 702.5a, 205.2a): "Enchant creature, land, or planeswalker" is ONE keyword whose object is a list of kinds: the commas belong to the Filter parameter
    // (the keyword Enchant is alone on its line, never followed by another keyword), so the line is not split into a list of keywords
    if (toks.length > 2 && toks[0]!.kind === 'WORD' && toks.some((t) => t.kind === 'PUNCT' && t.norm === ',') && !toks.some((t) => t.kind === 'PUNCT' && (t.norm === ';' || t.norm === '.' || t.norm === ':' || t.norm === '--'))) {
      const start = toks[0]!.range[0];
      const hit = keywordAt(this.ix, this.lower, start);
      // std-craft-1 (CR 702.167a): so is "Craft with a Dinosaur, a Merfolk, a Pirate, and a Vampire {4}", whose materials are a list
      if (hit && (hit.name.toLowerCase() === 'enchant' || hit.name.toLowerCase() === 'craft')) {
        const end = toks[toks.length - 1]!.range[1];
        const nameRange: Range = [start, start + hit.length];
        const paramStart = trimRange(this.parse, [nameRange[1], end])[0];
        return [{ name: hit.name, range: [start, end], nameRange, ...(paramStart < end ? { paramRange: [paramStart, end] as Range } : {}), dash: false, tokens: toks }];
      }
    }
    const groups: Token[][] = [[]];
    for (const t of toks) {
      if (t.kind === 'PUNCT' && (t.norm === ',' || t.norm === ';')) groups.push([]);
      else groups[groups.length - 1]!.push(t);
    }
    const items: KeywordItem[] = [];
    for (let g of groups) {
      if (g[0]?.kind === 'WORD' && g[0].norm === 'and' && g.length > 1) g = g.slice(1);
      if (g.length === 0 || g.length > 16) return undefined;
      // A sentence end, a colon or a dash inside an item means the line is something else ("Flying. Draw a card.").
      if (g.some((t) => t.kind === 'PUNCT' && (t.norm === '.' || t.norm === ':' || t.norm === '--'))) return undefined;
      const start = g[0]!.range[0];
      const hit = keywordAt(this.ix, this.lower, start);
      if (!hit || start + hit.length > g[g.length - 1]!.range[1]) return undefined;
      const end = g[g.length - 1]!.range[1];
      const nameRange: Range = [start, start + hit.length];
      const paramStart = trimRange(this.parse, [nameRange[1], end])[0];
      items.push({ name: hit.name, range: [start, end], nameRange, ...(paramStart < end ? { paramRange: [paramStart, end] as Range } : {}), dash: false, tokens: g });
    }
    return items;
  }

  /** `cost: effect`: a top-level colon preceded by something cost-like (symbols or a cost verb) and no sentence end. */
  private isActivated(toks: readonly Token[]): boolean {
    const colon = toks.findIndex((t) => t.kind === 'PUNCT' && t.norm === ':');
    if (colon <= 0) return false;
    const left = toks.slice(0, colon);
    if (left.some((t) => t.kind === 'PUNCT' && (t.norm === '.' || t.norm === ';'))) return false;
    const f = left[0]!;
    return f.kind === 'MANA' || f.kind === 'TAP' || (f.kind === 'WORD' && COST_STARTS.has(f.norm));
  }
}

/**
 * M6-6 (CR 719.3): a "To solve" segment followed by a "Solved" segment is one Case ability: the lines of both, the condition's sentences, and the solved
 * ability as its child. A line of a Case without its partner stays a `case` segment of its own, which the lowering keeps manual.
 */
function joinCaseLines(segs: AbilitySegment[]): AbilitySegment[] {
  const out: AbilitySegment[] = [];
  for (const seg of segs) {
    const prev = out[out.length - 1];
    if (seg.case?.solvedLine && prev?.case?.solve !== undefined && prev.children === undefined) {
      prev.lines.push(...seg.lines);
      prev.ranges.push(...seg.ranges);
      prev.children = seg.children;
      continue;
    }
    out.push(seg);
  }
  return out;
}

/** Splits the face into abilities. Pure and total. */
export function segmentFace(pre: PreprocessedFace, opts: FrontEndOptions = {}): SegmentedFace {
  const seg = new Segmenter(pre, opts);
  const abilities = seg.run();
  const ledger = completeLedger(pre.normalized, [...pre.ledger, ...seg.structure]);
  return { pre, abilities, ledger, diagnostics: [...pre.diagnostics, ...seg.diagnostics, ...reminderDiagnostics(pre, abilities, seg.ix, opts)] };
}

/** preprocess + segment for one face. */
export function frontEnd(ctx: FaceContext, opts: FrontEndOptions = {}): SegmentedFace {
  return segmentFace(preprocessFace(ctx, opts), opts);
}
