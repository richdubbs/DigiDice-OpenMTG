/**
 * Shared machinery of the hole grammars (design 6.3). Owner: WP6.
 *
 * A hole grammar is a memoized function `(ctx, pos) -> Alt[]` that returns EVERY parse starting at token `pos`, each as `{end, value}`. It never picks one:
 * the chart parser decides, and detects ambiguity by comparing the canonical JSON of the finished derivations. A grammar never skips a token it does not
 * understand (guard G2): an unknown word simply yields no alternative.
 *
 * Placeholders. Some facts belong to later passes and are therefore left as MARKERS inside otherwise model-shaped JSON (all keys start with `$`):
 *   - `$target`  on `{ref:'target', id:''}`: a target phrase (design 6.5 pass 2 numbers them t0, t1, ... in word order and builds the TargetSpecs);
 *   - `$anaphor` on `{ref:'bound', name:''}` / `{q:'eventAmount'}`: a pronoun or "that creature" (design 6.4 resolves it by the unique-candidate rule);
 *   - `$step`    on `{cond:'did', step:''}`: "if you do" (resolved against the previous `may`/`pay` step);
 *   - `link: '$link'`: "the chosen type", "the exiled card" (the CR 607 linking pass chooses the link id).
 * `findMarkers` walks a value and lists them.
 */
import type { Cmp, NumberCmp, ObjectFilter, PlayerPred, PlayerRef, Quantity } from '../../types/ability';
import type { HoleType, Lexicon, ParseOptions } from '../types';
import type { Tok } from './tok';
import { spanText } from './tok';
import type { Vocab } from './vocab';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** One parse of a hole: tokens [pos, end) become `value`. */
export interface Alt {
  end: number;
  value: unknown;
  /** Count of unspecific parts (open-class words such as a card name or an unlisted counter kind). Derivations with fewer win (design 6.3 rule 2). */
  weak?: number;
  /** Notes for later passes ("zone-unstated", "batch", "assumed:..."). Surfaced by the chart in its result. */
  flags?: string[];
}

export type HoleFn = (ctx: HoleCtx, pos: number) => Alt[];

/** Parses the tokens inside a quoted ability ("Sacrifice this creature: Add {C}."). Supplied by the caller (WP17); without it quoted abilities do not parse. */
export type SubParser = (tokens: readonly Tok[]) => unknown[] | null;

/**
 * FAST5 T75 (INTERFACE CHANGE): the groups of cards the sentences BEFORE the one being parsed, in the same ability, made: `milled` (a mill step, "Mill four cards."),
 * `seen` (a look at, or a reveal of, the top cards of a library). The pronoun holes `Seen` and `Milled` read it so that "them" in "You may put a land card from among
 * them into your hand" is the group the ability actually made: two templates with the same words and a different zone for the pool (a milled card is in a
 * graveyard, a card looked at is in the library) would otherwise be two readings of one sentence (guard G5) whichever sentence came before.
 */
export interface Discourse {
  /** edh-next-139 (Boxing Ring): no earlier sentence of the ability (this is its first). */
  readonly first?: boolean;
  readonly milled: boolean;
  readonly seen: boolean;
  /**
   * edh-cast-10: a look at the cards of a HAND ("Look at that player's hand."), which is no `seen` (a group of library cards): the hole `SeenInHand` reads it, so that "those cards" of
   * "You may cast a spell from among those cards" is never two readings (guard G5) with the zone of the pool different.
   */
  readonly handLook?: boolean;
  /** r3-choose (CR 115.1, 601.2c): an earlier sentence only announces targets ("Choose target opponent."), so "the chosen player" / "the chosen card" may name them. */
  readonly chose?: boolean;
  /** edh-next-60 (CR 608.2c, 607.2): an earlier sentence of the same ability chose one object that is no target (`chooseObjects`, "Choose a creature you control."), so "the chosen creature" names it and the link placeholder of another ability is the weaker reading. */
  readonly chosenObject?: boolean;
  /**
   * edh-zones-14 (CR 607.2a, 603.4, 608.2c; Valakut Exploration): the first sentence of the effect of a triggered ability whose intervening "if" counts the cards exiled with its
   * object ("if there are cards exiled with ~, put them into their owner's graveyard"): "them" is those cards (the linked exile), not an earlier group.
   */
  readonly linkedCond?: boolean;
  /**
   * edh-zones-18 (CR 701.20a, 608.2c; Selvala, Explorer Returned): the sentences before this one reveal cards from the top of a library and do nothing else with cards (only reveals and
   * looks), so the cards revealed are still where they were revealed: "for each nonland card revealed this way" counts them in the library (holes/edhz18.ts).
   */
  readonly revealStays?: boolean;
  /**
   * trek-17 (CR 701.20a, 121.1, 608.2c; Ambassador K'Ehleyr, Alexander, Ship's Fool): the sentences before this one reveal cards from the top of libraries and draw cards (only reveals,
   * looks and draws), so the cards revealed are in the library or, once drawn, in a hand: "for each nonland card revealed this way" counts them in either (holes/trek17.ts).
   */
  readonly revealDrawn?: boolean;
  /**
   * edh-zones-22 (CR 701.20a, 608.2c; Old Stickfingers): an earlier sentence reveals cards from the top of a library "until you reveal X <cards>" (a counted reveal until): the
   * cards it stopped at are "<cards> revealed this way" (holes/object.ts#revealedThisWay), still in the library.
   */
  readonly revealedUntil?: boolean;
  /**
   * edh-zones-27 (CR 406.1, 608.2c; Aminatou's Augury): an earlier sentence exiles the top cards of a library ("Exile the top eight cards of your library.") and no sentence looks at or reveals
   * any: "them" is the cards that step exiled, which the `ExiledTop` hole names; the `Seen` hole offers no second reading of the same words (guard G5).
   */
  readonly exiledTop?: boolean;
  /**
   * edh-next-136 (CR 701.23a, 701.20a; Karn, Scion of Urza): an earlier sentence searches a library: only then can "them" / "those cards" be the cards a search found (the `Found`
   * hole); after a reveal of the top cards and no search, "An opponent chooses one of them." is the `Seen` group alone (two readings would be guard G5).
   */
  readonly searched?: boolean;
}

export interface HoleCtx {
  readonly toks: readonly Tok[];
  readonly vocab: Vocab;
  readonly lexicon: Lexicon;
  readonly keywords: ParseOptions['keywords'];
  readonly cardNames?: ReadonlySet<string>;
  readonly subParser?: SubParser;
  /** FAST5 T75: what the sentences before this one in the same ability produced (see `Discourse`); absent: nothing is known. */
  readonly discourse?: Discourse;
  /** All parses of hole `type` at `pos` (memoized; a re-entrant call at the same position yields none, which cuts left recursion). */
  call(type: HoleType, pos: number): Alt[];
  /** Memoize an internal grammar function: `ctx.memo('np', pos, () => ...)`. */
  memo<T>(name: string, pos: number, compute: () => T): T;
}

// ---------------------------------------------------------------------------
// vocabulary of the grammar itself (the words its literals use): needed to tell "unknown word" from "known word in the wrong place"
// ---------------------------------------------------------------------------

const GRAMMAR_WORDS = new Set<string>();
let grammarWordsFixed = false;

/**
 * Declare a literal phrase of a grammar: returns it as an array of lower-case words. While the holes are loading it also registers the words; once
 * `fixGrammarWords` has run (the end of holes/index.ts) it registers nothing, so the set never changes while parsing.
 */
export function P(phrase: string): string[] {
  const ws = phrase.toLowerCase().split(/\s+/).filter((w) => w !== '');
  if (!grammarWordsFixed) for (const w of ws) GRAMMAR_WORDS.add(w);
  return ws;
}

/** Add the static list of every literal of the grammars (grammar-words.ts) and stop registering: the set is a constant from now on. */
export function fixGrammarWords(all: Iterable<string>): void {
  for (const w of all) GRAMMAR_WORDS.add(w);
  grammarWordsFixed = true;
}

/** Whether `word` is a literal of some hole grammar. */
export function isGrammarWord(word: string): boolean {
  return GRAMMAR_WORDS.has(word);
}

// ---------------------------------------------------------------------------
// token helpers
// ---------------------------------------------------------------------------

export const wordAt = (ctx: HoleCtx, pos: number): string | undefined => {
  const t = ctx.toks[pos];
  return t !== undefined && t.kind === 'WORD' ? t.norm : undefined;
};

export const normAt = (ctx: HoleCtx, pos: number): string | undefined => ctx.toks[pos]?.norm;

/** End position after the literal words `ws` starting at `pos`, or -1. */
export function phraseAt(ctx: HoleCtx, pos: number, ws: readonly string[]): number {
  for (let k = 0; k < ws.length; k++) {
    const t = ctx.toks[pos + k];
    if (t === undefined || t.kind === 'QUOTE' || t.norm !== ws[k]) return -1;
  }
  return pos + ws.length;
}

/** The LONGEST of several literal phrases that matches at `pos`: its end, or -1 ("a card each turn" beats "a card", whatever the order of the list). */
export function anyPhraseAt(ctx: HoleCtx, pos: number, phrases: readonly (readonly string[])[]): number {
  let best = -1;
  for (const p of phrases) {
    const e = phraseAt(ctx, pos, p);
    if (e > best) best = e;
  }
  return best;
}

export const spanOf = (ctx: HoleCtx, a: number, b: number): string => spanText(ctx.toks, a, b);

/** A number word or digit string at `pos`: its value. "a"/"an" count as 1 only if `article` is true. */
export const NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  // std-rg: the number words past twenty that Oracle spells as one hyphenated word, "twenty-five" (Jace, Reality Sculptor); the tens, and tens-and-ones up to ninety-nine
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  ...Object.fromEntries(
    Object.entries({ twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }).flatMap(([tens, t]) =>
      Object.entries({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }).map(([ones, o]) => [`${tens}-${ones}`, t + o] as const)),
  ),
};
for (const w of Object.keys(NUMBER_WORDS)) GRAMMAR_WORDS.add(w);

export function numberAt(ctx: HoleCtx, pos: number, article = false): number | undefined {
  const t = ctx.toks[pos];
  if (t === undefined) return undefined;
  if (t.kind === 'NUM') return Number(t.norm);
  if (t.kind === 'WORD') {
    const v = NUMBER_WORDS[t.norm];
    if (v !== undefined) return v;
    if (article && (t.norm === 'a' || t.norm === 'an')) return 1;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// canonical JSON and merging
// ---------------------------------------------------------------------------

/** Key-sorted JSON text: equal values give equal strings (ambiguity detection compares these). `undefined` members are dropped. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x === undefined ? null : x)).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

const NEGATIVE_LISTS = new Set(['notTypes', 'notSubtypes', 'notSupertypes', 'notColors']);

/**
 * Conjunction of two filter fragments, or null when they contradict (e.g. two different controllers). Lists of exclusions add up; two positive
 * lists or scalars must be equal; two `not` clauses combine into `not: {anyOf: [..]}` (neither); two `anyOf` clauses cannot be merged and conflict.
 */
export function mergeFilter(a: ObjectFilter, b: ObjectFilter): ObjectFilter | null {
  const out: Record<string, unknown> = { ...a };
  for (const [k, vb] of Object.entries(b)) {
    if (vb === undefined) continue;
    const va = out[k];
    if (va === undefined) { out[k] = vb; continue; }
    if (canonicalJson(va) === canonicalJson(vb)) continue;
    if (NEGATIVE_LISTS.has(k) && Array.isArray(va) && Array.isArray(vb)) { out[k] = [...new Set([...(va as string[]), ...(vb as string[])])]; continue; }
    if (k === 'not') { out[k] = { anyOf: [va, vb] }; continue; }
    return null;
  }
  // edhn115 (CR 122.2, 406.3; The Animus): a card in a graveyard, a hand or a library has no counters, so "target creature card from a graveyard with a memory counter on it" is never a description of
  // such a card (a card in exile or a permanent can have them): the counter is the one the instruction puts on the card it moves, which another reading ("exile {o:Obj} with a <kind> counter on it") says
  if (out['counters'] !== undefined && offBattlefieldZoneOnly(out['zone'])) return null;
  return out as ObjectFilter;
}
const offBattlefieldZoneOnly = (z: unknown): boolean => {
  const zs = Array.isArray(z) ? z : [z];
  return zs.length > 0 && zs.every((x) => x === 'graveyard' || x === 'hand' || x === 'library');
};

/**
 * Player predicate for filter fields from a player reference. The model has plain words for the common cases (design 3.3), and a set must have ONE JSON
 * form: `you`, `an opponent` and `each opponent` / `your opponents` are 'you' and 'opponent'; `each player` is 'any'. Every other reference stays a reference.
 */
export function predOf(p: PlayerRef | PlayerPred): PlayerPred {
  if (typeof p === 'string') return p;
  if (p.ref === 'you') return 'you';
  if (p.ref === 'anOpponent') return 'opponent';
  if (p.ref === 'each' && p.who === 'opponent') return 'opponent';
  if (p.ref === 'each' && p.who === 'player') return 'any';
  return p;
}

// ---------------------------------------------------------------------------
// markers
// ---------------------------------------------------------------------------

export interface TargetPhrase {
  kind: 'object' | 'player' | 'objectOrPlayer' | 'anyTarget' | 'spell' | 'ability' | 'stackObject';
  filter?: ObjectFilter;
  players?: { who: PlayerPred; dealtDamage?: true; dealtCombatDamageBySource?: true; activePlayer?: true; lostLife?: true };
  min: number | Quantity;
  max: number | 'any' | Quantity;
  /** The words of the phrase ("target creature you don't control"). */
  text: string;
  /** "another target ..." / "up to one other target ...": distinct from the other targets of the ability (design 6.5 pass 2). */
  another?: boolean;
  /** FAST3 T14: "... target cards from a single graveyard": the targets have one owner (`TargetSpec.sameOwner`, CR 115.1). */
  sameOwner?: boolean;
  /** FAST5 T42: "... target creature cards with different names": no two targets share a name (`TargetSpec.differentNames`, CR 201.2, 115.1). */
  differentNames?: boolean;
  /** edh-top-3: "... target creature cards that each have a different mana value X or less": no two targets share a mana value (`TargetSpec.differentManaValues`, CR 202.3, 115.1). */
  differentManaValues?: boolean;
  /** FAST5 T66: "... up to two target creatures with total mana value 6 or less": a limit on a statistic summed over the chosen targets (`TargetSpec.groupLimit`, CR 115.1, 601.2c). */
  groupLimit?: { stat: 'power' | 'toughness' | 'manaValue'; cmp: NumberCmp };
  /** edh-zones-26 (CR 115.1, 601.2c, 108.3): "target artifact card in that player's graveyard" after the target of the same sentence: the card's owner is the controller of that EARLIER target (`TargetSpec.filter.owner`, lower/targets.ts#specOf). */
  ownerOfEarlierController?: boolean;
  /** edh-c-85 (CR 115.1, 601.2c, 109.4; Mutiny): "another target creature that player controls" right after "target creature an opponent controls": the new target is controlled by the controller of the EARLIER target (`TargetSpec.filter.controller`, lower/targets.ts#specOf; it names that target as the targets are chosen, rules/targets.ts#announcedPlayers). */
  controllerOfEarlierController?: boolean;
  /** FAST5 T66: "for each opponent, ... up to one target nonland permanent that player controls": one target at most for each opponent (`TargetSpec.perOpponent`, CR 115.1, 601.2c). */
  perOpponent?: boolean;
  /** edh-d-96: "for each opponent who has N or more poison counters as you cast this spell": only those opponents get a target (`TargetSpec.perOpponentPoison`, CR 601.2c). */
  perOpponentPoison?: number;
  /** r5-fxb: "for each player, ... up to one target creature that player controls" (`TargetSpec.perPlayer`, CR 115.1, 601.2c). */
  perPlayer?: boolean;
  /** edh-next-127: "for each graveyard with an instant or sorcery card in it, exile target ... from that graveyard" (`TargetSpec.eachWithOne`, CR 115.1, 601.2c). */
  eachWithOne?: true;
  /** FAST5 T66: "two target nonland permanents that share a card type": the targets have a card type in common (`TargetSpec.sharedCardType`, CR 205.2a, 115.1). */
  sharedCardType?: boolean;
  /** edh-next-54: "that share a permanent type" (`TargetSpec.sharedPermanentType`, with `sharedCardType`, CR 110.4, 205.2a). */
  sharedPermanentType?: true;
  /** CLOUD std-ecl: "two target creature cards that share a creature type": the targets have a creature type in common (`TargetSpec.sharedCreatureType`, CR 205.3m, 115.1). */
  sharedCreatureType?: boolean;
  /** CLOUD std-tmt: "two target creatures controlled by different players": no two targets share a controller (`TargetSpec.differentControllers`, CR 115.1). */
  differentControllers?: boolean;
  /** std-rx30: "two target creatures controlled by the same opponent": every target has one controller (`TargetSpec.sameController`, CR 115.1, 110.2). */
  sameController?: boolean;
  /** edh-next-126: "any number of target creatures with equal toughness": every target has the same toughness (`TargetSpec.equalToughness`, CR 115.1, 208.1). */
  equalToughness?: true;
  /** std-cardcopy-7: "up to one target nonland card of each card type from your graveyard" (`TargetSpec.perCardType`, CR 115.1, 205.2a). */
  perCardType?: boolean;
  /** p2-damage-2: "target creature an opponent controls chosen at random": the game picks the targets at random among the legal ones (`TargetSpec.random`, CR 601.2c, 603.3d). */
  random?: boolean;
  /** edh-c-103 (CR 601.2c, 601.7; The Abyss): "destroy target creature that player controls of their choice": that player, not the controller, chooses the target (`TargetSpec.chooser`). */
  chooser?: PlayerRef;
  /** edh-d-87 (CR 601.7a; Bladegriff Prototype): who chooses when the `chooser` has left the game (`TargetSpec.chooserElse`). */
  chooserElse?: 'anOpponent';
  /** edh-next-146 (CR 601.7a; Arena): "target creature of an opponent's choice they control": the chooser picks among the objects they control (`TargetSpec.chooserControls`). */
  chooserControls?: true;
  /**
   * T20 (FAST4) INTERFACE CHANGE (additive): a target a keyword action implies without the word "target" in the sentence ("support 2", CR 701.41a):
   * the words that stand for it in the sentence, where the targets pass (parser/lower/targets.ts) places the spec instead of at `text`.
   */
  locate?: string;
}

export interface AnaphorInfo {
  sort: 'object' | 'player' | 'set' | 'number' | 'any';
  /** Head noun for "that creature", "those cards" ("creature", "card", ...), when stated. */
  head?: string;
  /**
   * FAST4 T19 ADDITION (optional): the second head of "that creature or planeswalker" (CR 115.1, 608.2c): the antecedent must be callable by `head` AND by
   * `orHead` (lower/anaphora.ts#compatible).
   */
  orHead?: string;
  /** Participle for "the exiled card" ("exiled"). */
  participle?: string;
  number: 'singular' | 'plural';
  text: string;
  /**
   * FAST5X E17 ADDITION (optional): the antecedent is never the ability's own source (lower/anaphora.ts#compatible). "If you controlled it" asks about an
   * object an earlier step of the ability acted on (CR 608.2h), never the source, whose controller the ability's "you" is.
   */
  notSelf?: boolean;
  /**
   * edh-zones-12 ADDITION (optional): the pronoun of "if it's a land card" names a card (CR 108.2b: a token is no card), so a mention that is a token created by the ability is no
   * candidate ("{T}: Put a card exiled with ~ into its owner's graveyard. If it's a land card, create a Treasure token. If it's a nonland card, ...", Currency Converter);
   * lower/anaphora.ts#compatible.
   */
  cardNoun?: boolean;
  /**
   * FAST5X E25 ADDITION (optional): the ability's own source is a candidate only when no other mention is ("Counter target spell. Its controller manifests
   * dread."): "its controller" never names the controller of the source, which the source's own text calls "you" (CR 109.5, 608.2c; lower/anaphora.ts#resolveAnaphor).
   * A demotion, never an exclusion: a reference whose only candidate is the source still resolves to it.
   */
  selfLast?: boolean;
  /**
   * edh-c-19 ADDITION (optional): the pronoun of "~ deals damage equal to its power" names the source that deals the damage (the sentence's subject) when several objects fit ("Whenever a
   * creature with flying attacks you, ~ deals damage equal to its power to that creature", Palazzo Archers; CR 120.3, 608.2c). A choice among several candidates only: a reference with one
   * candidate keeps it (lower/anaphora.ts#resolveAnaphor).
   */
  selfFirst?: boolean;
  /**
   * FAST5 T70 ADDITION (optional): the card or cards an earlier instruction of the ability exiled from the top of a library, for the play permission that
   * follows ("You may play those cards this turn"). The unique-candidate rule never resolves it (lower/anaphora.ts#compatible); the impulse idiom binds it to the
   * instruction that exiled them or the sentence stays manual (CR 611.2c, 400.7: a permission names those objects, in that zone, and no other).
   */
  impulse?: boolean;
  /**
   * std-rx10 ADDITION (optional): "the creature you control" / "you don't control" / "an opponent controls" after a sentence that only announced targets: the
   * antecedent is a target whose description says the same of its controller (Mention.controls; lower/anaphora.ts#compatible; CR 115.1, 608.2c).
   */
  controls?: 'you' | 'notYou' | 'opponent';
  /**
   * edh-zones-9 ADDITION (optional): "both cards" (CR 608.2c; Sword of Hearth and Home): the two single cards two earlier instructions of the ability produced (an exiled
   * target and a card found), as one group. Resolves only when exactly two single-card mentions fit (lower/anaphora.ts#resolveAnaphor, bindKey `both`); else the sentence
   * stays manual.
   */
  both?: true;
  /**
   * edh-c-106 ADDITION (optional): "the other creature" of a trigger on a two-party event (Venomous Fangs, Venom; CR 608.2c): the event's `object` role (the creature dealt damage, the
   * creature blocked or blocking), never the subject or a mention of an earlier step (lower/anaphora.ts#compatible).
   */
  otherParty?: true;
}

export const targetRef = (t: TargetPhrase): Json => ({ ref: 'target', id: '', $target: t as unknown as Json });
export const anaphorObj = (a: AnaphorInfo): Json => ({ ref: 'bound', name: '', $anaphor: a as unknown as Json });
export const anaphorQty = (a: AnaphorInfo): Json => ({ q: 'eventAmount', $anaphor: a as unknown as Json });
export const linkedObj = (): Json => ({ ref: 'linked', link: '$link' });
/** edh-players-8 (CR 607.2d; Skrelv): the quality "that color" of "hexproof from that color" until lower/links.ts names the earlier choice it means (else the sentence is manual). */
export const THAT_COLOR_QUALITY = '$thatColor';

export interface Marker { kind: 'target' | 'anaphor' | 'step' | 'link'; path: string; value: unknown }

/** Every marker inside a value, in document order (arrays and objects are walked depth first; `path` is a JSON-pointer-like string). */
export function findMarkers(value: unknown, path = ''): Marker[] {
  const out: Marker[] = [];
  const walk = (v: unknown, p: string): void => {
    if (v === null || typeof v !== 'object') { if (v === '$link') out.push({ kind: 'link', path: p, value: v }); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${p}/${i}`)); return; }
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      if (k === '$target') { out.push({ kind: 'target', path: p, value: o[k] }); walk((o[k] as TargetPhrase).filter, `${p}/$target/filter`); continue; }
      if (k === '$anaphor') { out.push({ kind: 'anaphor', path: p, value: o[k] }); continue; }
      if (k === '$step') { out.push({ kind: 'step', path: p, value: o[k] }); continue; }
      walk(o[k], `${p}/${k}`);
    }
  };
  walk(value, path);
  return out;
}

// ---------------------------------------------------------------------------
// Cmp ("N or less", "greater than N", "equal to X")
// ---------------------------------------------------------------------------

const OR_LESS = [P('or less'), P('or fewer')];
const OR_MORE = [P('or greater'), P('or more')];
const CMP_LEAD: [string[], Cmp][] = [[P('less than or equal to'), '<='], [P('greater than or equal to'), '>='], [P('equal to or less than'), '<='] /* edh-next-55 */, [P('equal to or greater than'), '>='] /* edh-next-55 */, [P('less than'), '<'], [P('fewer than'), '<'], [P('greater than'), '>'], [P('more than'), '>'], [P('equal to'), '=='],
  [P('at least'), '>='], [P('at most'), '<='], [P('exactly'), '==']];

/** "3", "3 or less", "3 or more", "less than X", "greater than 2", "equal to the number of ..." as a NumberCmp. A bare quantity means `==`. */
/** p2-attack-block-1: the controller phrases that may follow a count (`cmpAt`). */
const CONTROL_AFTER = [P('you control'), P('your opponents control'), P('an opponent controls'), P('target player controls'), P('that player controls')];

export function cmpAt(ctx: HoleCtx, pos: number): { end: number; cmp: NumberCmp; weak?: number }[] {
  const out: { end: number; cmp: NumberCmp; weak?: number }[] = [];
  // FAST5 T42: the weakness of the quantity's own parse is the comparison's (a reading of its noun phrase that is less likely, parser/holes/filter.ts)
  const mk = (op: Cmp, value: Quantity, end: number, weak: number | undefined): void => { out.push({ end, cmp: { op, value }, ...(weak ? { weak } : {}) }); };
  // p2-attack-block-1 (CR 400.1, 108.2): a count of cards with no zone stated ("the number of cards", the zone left to the words after it) is no value to
  // compare with: the comparison would drop the flag that makes such a count manual (lower/normalize.ts), and "the number of cards in your hand" is read whole
  // ... and a count of objects that leaves out who controls them right before "you control" ("creatures with power less than the number of Islands you control")
  // is the less likely reading (weak, design 6.3 rule 2): the controller belongs to the counted objects, not to the outer noun after its "with" phrase
  const qtys = (p: number): Alt[] => ctx.call('Qty', p).filter((q) => !(q.flags ?? []).includes('zone-unstated')).map((q) => (cutController(q) ? { ...q, weak: (q.weak ?? 0) + 1 } : q));
  const cutController = (q: Alt): boolean => {
    const v = q.value as Quantity;
    if (typeof v !== 'object' || v === null || v.q !== 'count' || !('filter' in v.of) || (v.of.filter as ObjectFilter).controller !== undefined) return false;
    return anyPhraseAt(ctx, q.end, CONTROL_AFTER) >= 0;
  };
  for (const [ws, op] of CMP_LEAD) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) for (const q of qtys(e)) mk(op, q.value as Quantity, q.end, q.weak);
  }
  for (const q of qtys(pos)) {
    const v = q.value as Quantity;
    const lo = anyPhraseAt(ctx, q.end, OR_LESS);
    if (lo >= 0) mk('<=', v, lo, q.weak);
    const hi = anyPhraseAt(ctx, q.end, OR_MORE);
    if (hi >= 0) mk('>=', v, hi, q.weak);
    mk('==', v, q.end, q.weak);
  }
  return out;
}

export const dedupe = (alts: Alt[]): Alt[] => {
  const seen = new Map<string, Alt>();
  for (const a of alts) {
    const k = `${a.end}|${canonicalJson(a.value)}`;
    const prev = seen.get(k);
    if (prev === undefined || (a.weak ?? 0) < (prev.weak ?? 0)) seen.set(k, a);
  }
  return [...seen.values()];
};

export const withFlags = (a: Alt, ...flags: string[]): Alt => (flags.length === 0 ? a : { ...a, flags: [...(a.flags ?? []), ...flags] });

/** Longest-first matches of a multi-word vocabulary map at `pos` (all lengths that exist; word tokens only). */
export function multiAt<T>(ctx: HoleCtx, pos: number, map: ReadonlyMap<string, T>): { end: number; entry: T }[] {
  const out: { end: number; entry: T }[] = [];
  let key = '';
  for (let k = 0; k < ctx.vocab.maxWords; k++) {
    const t = ctx.toks[pos + k];
    if (t === undefined || t.kind !== 'WORD') break;
    key = k === 0 ? t.norm : `${key} ${t.norm}`;
    const hit = map.get(key);
    if (hit !== undefined) out.push({ end: pos + k + 1, entry: hit });
  }
  return out;
}
