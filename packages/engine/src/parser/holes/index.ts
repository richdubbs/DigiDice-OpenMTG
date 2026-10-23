/**
 * The typed hole grammars (Filter, Obj, Objs, Player, Recipient, Qty, Count, Cost, Cond, Dur, Event, TokenDesc, Abilities, Keyword, Zone, Color,
 * CounterKind, ManaCost, PT, Name, ChoiceKind, Lib) as memoized recursive-descent functions that return ALL parses (design 6.3). Owner: WP6.
 *
 * `Effects` is not a code grammar: the chart parser derives it from the effect templates. `Text` is deliberately absent (free text would defeat guard G2).
 *
 * Known gaps (each fails closed: the unit is manual, never a wrong parse):
 *   - Event: "attacks you or a planeswalker you control" (the model's `defender` names one player or kind); "each of your main phases".
 *   - Qty: "each opponent's life total"; "the greatest <stat> among" a set that is not a filter ("among cards discarded this way").
 *   - Cost: "exile a <card> from a graveyard" (any graveyard; the part has no owner field, only "your graveyard" parses).
 *   - Objs / Player: "each of" without a quantifier ("each of target creature"); "each of" before the mixed forms ("target creature or player").
 *   - TokenDesc: predefined tokens come from the lexicon only (CR 111.10), so none parse while parser/lexicon.generated.json is empty.
 *   - Templates: an expansion that is only `{e:Effects}` (for example `[you may] {e:Effects}` with the optional part left out) is a template error
 *     (a unit cycle); write the wrapper with a literal word, or the optional part as a template of its own.
 *   - The tokenizer of WP5 is bridged by `adaptTokens` (tok.ts); the integration test with `tokenize` runs once WP5 is merged.
 */
import type { HoleType, Lexicon, ParseOptions } from '../types';
import type { Alt, Discourse, HoleCtx, HoleFn, SubParser } from './core';
import { fixGrammarWords } from './core';
import { GRAMMAR_WORD_LIST } from './grammar-words';
import { cond } from './cond';
import { cost, discardDesc } from './cost';
import { dur } from './dur';
import { castSpell, event } from './event';
import { chosenOf, filter } from './filter';
import { abilities, basePT, cardTypes, choiceKind, color, counterKind, keyword, manaCost, coloredManaCost, manaSym, manaUnits, name, pt, subtypes, typeChoices } from './misc';
import { anyTarget, chosenCard, countersOf, group, handCard, impulse, found, impulses, itIs, milled, obj, objs, oppTarget, otherTargets, playerTarget, pair, recipient, rest, seen, targetPhrases, them, they, typedThose } from './object';
import { player, whoCant } from './player';
import { milledThisWay } from './object'; // std-tla
import { revealedThisWay } from './object'; // std-ro
import { count, qty } from './qty';
import { namedToken, tokenDesc } from './token';
import type { Tok } from './tok';
import { vocabOf } from './vocab';
import { lib, zone } from './zone';
import { voteWords } from './vote';
import { manaSpend, spellsCastHole } from './spend';
import { listedCounterKind, notSameNameCard } from './stddsk';
import { kickedWith } from './p2cs1';
import { siegeWord } from './r3mech';
import { pluralSubtype } from './r4mech';
import { controlledMoved, notMoved, surveilledCard } from './moved'; // r4-moved, r5-moved
import { cardsDesc, searchDesc } from './r4dig';
import { keptOnTop } from './r5fxz';
import { cardDesc } from './sxp23'; // std-exile-play-2-3
import { chosenType, creatureTypeChoices } from './stdcombat5';
import { copyExcept, copyExceptToken, copyExceptTokens } from './p2copyperm1';
import { replStatic } from './p2re1';
import { damageMore, damageWould } from './p2rd2'; // p2-replace-damage-2

export const OWNER = 'WP6' as const;

// the words of the grammars are a constant from here on (guard G2: diagnostics must not depend on what ran before)
fixGrammarWords(GRAMMAR_WORD_LIST);

export const HOLES: Readonly<Partial<Record<HoleType, HoleFn>>> = {
  Filter: filter, Obj: obj, Objs: objs, Player: player, Recipient: recipient, Qty: qty, Count: count, Cost: cost, Cond: cond, Dur: dur, Event: event,
  TokenDesc: tokenDesc, Abilities: abilities, Keyword: keyword, Zone: zone, Color: color, CounterKind: counterKind, ManaCost: manaCost, PT: pt, Name: name,
  ChoiceKind: choiceKind, Lib: lib, BasePT: basePT, Subtypes: subtypes, AnyTarget: anyTarget, ManaUnits: manaUnits, ManaSym: manaSym,
  Group: group, // FAST3 T18
  CardTypes: cardTypes, // FAST5 T60
  Pair: pair, // MX2
  OppTarget: oppTarget, // FAST5 T66
  PlayerTarget: playerTarget, // r5-fxb
  OtherTargets: otherTargets, // FAST4 T34
  Targets: targetPhrases, // FAST5 T42
  HandCard: handCard, ChosenCard: chosenCard, // FAST5 T46
  Rest: rest, // FAST5 T43
  Seen: seen, // FAST5 T43
  MilledThisWay: milledThisWay, // std-tla
  RevealedThisWay: revealedThisWay, // std-ro
  CastSpell: castSpell, // FAST5 T45
  ItIs: itIs, // FAST5 T47
  They: they, // FAST5 T49
  Them: them, // FAST5 T76
  TypedThose: typedThose, // r3-dig
  CountersOf: countersOf, // FAST5X E21
  ManaSpend: manaSpend, SpellsCast: spellsCastHole, // FAST5X E23 (CR 106.6)
  VoteWords: voteWords, // M12-3 (CR 701.38b)
  NamedToken: namedToken, // T55
  DiscardDesc: discardDesc, // FAST5 T56
  Impulse: impulse, Impulses: impulses, // FAST5 T70
  Milled: milled, Found: found, // FAST5 T75
  Chosen: chosenOf, // CLOUD C5
  ListedCounterKind: listedCounterKind, NotSameNameCard: notSameNameCard, // cloud std-dsk
  WhoCant: whoCant, // C6
  SiegeWord: siegeWord, // cloud r3-mech
  PluralSubtype: pluralSubtype, // cloud r4-mech
  NotMoved: notMoved, // r4-moved
  CardsDesc: cardsDesc, SearchDesc: searchDesc, // cloud r4-dig
  SurveilledCard: surveilledCard, ControlledMoved: controlledMoved, // r5-moved
  KeptOnTop: keptOnTop, // r5-fxz
  TypeChoices: typeChoices, // std-rD
  CardDesc: cardDesc, // std-exile-play-2-3
  ColoredManaCost: coloredManaCost, // std-mana-12
  CreatureTypeChoices: creatureTypeChoices, ChosenType: chosenType, // std-combat-5
  CopyExcept: copyExcept, CopyExceptToken: copyExceptToken, CopyExceptTokens: copyExceptTokens, // p2-copy-perm-1
  KickedWith: kickedWith, // p2-counters-state-1
  ReplStatic: replStatic, // p2-replace-events-1
  DamageWould: damageWould, DamageMore: damageMore, // p2-replace-damage-2
};

/** Hole types the chart parser itself implements (derived from templates, not code). */
export const CHART_HOLES: readonly HoleType[] = ['Effects'];

export interface HoleEnv {
  lexicon: Lexicon;
  keywords: ParseOptions['keywords'];
  cardNames?: ReadonlySet<string>;
  subParser?: SubParser;
  /** FAST5 T75: what the earlier sentences of the ability made (holes/core.ts#Discourse). */
  discourse?: Discourse;
}

/** A parsing context over one unit's tokens: memoizes every hole and internal grammar function by position. */
export function makeHoleCtx(toks: readonly Tok[], env: HoleEnv): HoleCtx {
  const memo = new Map<string, unknown>();
  const IN_PROGRESS = Symbol('in-progress');
  const ctx: HoleCtx = {
    toks,
    vocab: vocabOf(env.lexicon, env.keywords),
    lexicon: env.lexicon,
    keywords: env.keywords,
    ...(env.cardNames ? { cardNames: env.cardNames } : {}),
    ...(env.subParser ? { subParser: env.subParser } : {}),
    ...(env.discourse ? { discourse: env.discourse } : {}),
    call(type: HoleType, pos: number): Alt[] {
      const fn = HOLES[type];
      if (fn === undefined || pos < 0 || pos > toks.length) return [];
      const key = `H:${type}@${pos}`;
      const hit = memo.get(key);
      if (hit === IN_PROGRESS) return [];
      if (hit !== undefined) return hit as Alt[];
      memo.set(key, IN_PROGRESS);
      const res = fn(ctx, pos);
      memo.set(key, res);
      return res;
    },
    memo<T>(name: string, pos: number, compute: () => T): T {
      const key = `M:${name}@${pos}`;
      const hit = memo.get(key);
      if (hit === IN_PROGRESS) return [] as unknown as T;
      if (hit !== undefined) return hit as T;
      memo.set(key, IN_PROGRESS);
      const res = compute();
      memo.set(key, res);
      return res;
    },
  };
  return ctx;
}

/** All parses of one hole type starting at `pos` (a convenience for tests and tools). */
export function runHole(type: HoleType, toks: readonly Tok[], pos: number, env: HoleEnv): Alt[] {
  return makeHoleCtx(toks, env).call(type, pos);
}

export type { Alt, Discourse, HoleCtx, HoleFn, SubParser, Tok };
export { findMarkers, canonicalJson, isGrammarWord } from './core';
export type { AnaphorInfo, Json, Marker, TargetPhrase } from './core';
export { adaptTokens, lex, spanText } from './tok';
export type { RawTok, TokKind } from './tok';
