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
import { exiledTop } from './object'; // edh-players-11
import { itsPoss } from './object'; // edh-c-39
import { loyaltySym } from './edhn142'; // edh-next-142
import { thatCreature, thatToken } from './object'; // edh-top-1; edh-mana-keywords-10
import { anyOppTarget, poisonOppTarget, anyTarget, chosenCard, countersOf, handCardBare, handCardPlural, group, handCard, impulse, found, impulses, itIs, theyAre, milled, obj, objs, oppTarget, otherTargets, playerTarget, pair, recipient, rest, seen, seenInHand, targetPhrases, them, they, typedThose } from './object';
import { objPlayer, player, whoCant } from './player';
import { milledThisWay } from './object'; // std-tla
import { revealedThisWay } from './object'; // std-ro
import { count, qty } from './qty';
import { namedToken, tokenDesc } from './token';
import type { Tok } from './tok';
import { vocabOf } from './vocab';
import { lib, zone } from './zone';
import { noVotesReceived, thatManyVotes, voteCount, voteOpp, voteThey, voteWords, voteYou, votedCreature } from './vote';
import { choiceWord, choiceWords, chosenAll } from './choicewords'; // edh-players-13
import { manaSpend, spellsCastHole } from './spend';
import { cardsOfTemplateZone, listedCounterKind, notSameNameCard } from './stddsk';
import { kickedWith } from './p2cs1';
import { hexFromColors } from './edhp2'; // edh-players-2
import { protFrom } from './edhd5'; // edh-d-5
import { hexFromTypes } from './edhv45'; // edh-c-45
import { siegeWord } from './r3mech';
import { pluralSubtype } from './r4mech';
import { controlledMoved, notMoved, surveilledCard } from './moved'; // r4-moved, r5-moved
import { fewerDiscarded, itNotSource } from './edhv73'; // edh-c-73
import { countersMoved, fewerPut } from './edhd93'; // edh-d-93
import { cardsDesc, searchDesc } from './r4dig';
import { keptOnTop } from './r5fxz';
import { cardDesc } from './sxp23'; // std-exile-play-2-3
import { chosenType, creatureTypeChoices } from './stdcombat5';
import { copyExcept, copyExceptEach, copyExceptToken, copyExceptTokenSet, copyExceptTokens } from './p2copyperm1';
import { replStatic } from './p2re1';
import { damageMore, damageWould } from './p2rd2'; // p2-replace-damage-2
import { enchantedCard, enchantGraveyardQuote, enchantLinkedQuote } from './edhpm4'; // edh-perms-4
import { batExiledReturnQuote } from './edhd91'; // edh-d-91
import { adjCard } from './edhz12'; // edh-zones-12
import { listedCard, subtypeList } from './edhb1'; // edh-b-1
import { charStat } from './edhpm8'; // edh-perms-8

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
  AnyOppTarget: anyOppTarget, // edh-players-10
  PoisonOppTarget: poisonOppTarget, // edh-d-96
  OtherTargets: otherTargets, // FAST4 T34
  Targets: targetPhrases, // FAST5 T42
  HandCard: handCard, HandCardBare: handCardBare, HandCardPlural: handCardPlural, ChosenCard: chosenCard, // FAST5 T46
  Rest: rest, // FAST5 T43
  Seen: seen, // FAST5 T43
  SeenInHand: seenInHand, // edh-cast-10
  MilledThisWay: milledThisWay, // std-tla
  RevealedThisWay: revealedThisWay, // std-ro
  CastSpell: castSpell, // FAST5 T45
  ItIs: itIs, // FAST5 T47
  TheyAre: theyAre, // edh-top-6
  They: they, // FAST5 T49
  Them: them, // FAST5 T76
  TypedThose: typedThose, // r3-dig
  CountersOf: countersOf, // FAST5X E21
  ManaSpend: manaSpend, SpellsCast: spellsCastHole, // FAST5X E23 (CR 106.6)
  VoteWords: voteWords, // M12-3 (CR 701.38b)
  VoteCount: voteCount, // edh-players-13
  VoteYou: voteYou, VoteThey: voteThey, VoteOpp: voteOpp, VotedCreature: votedCreature, ThatManyVotes: thatManyVotes, NoVotesReceived: noVotesReceived, // edhd27 (CR 701.38a-b)
  ChoiceWords: choiceWords, ChoiceWord: choiceWord, ChosenAll: chosenAll, // edh-players-13 (CR 608.2d)
  NamedToken: namedToken, // T55
  DiscardDesc: discardDesc, // FAST5 T56
  AdjCard: adjCard, // edh-zones-12
  ListedCard: listedCard, SubtypeList: subtypeList, // edh-b-1
  Impulse: impulse, Impulses: impulses, // FAST5 T70
  ExiledTop: exiledTop, // edh-players-11
  Milled: milled, Found: found, // FAST5 T75
  Chosen: chosenOf, // CLOUD C5
  ListedCounterKind: listedCounterKind, NotSameNameCard: notSameNameCard, CardsOfTemplateZone: cardsOfTemplateZone, // cloud std-dsk; edh-c-51
  WhoCant: whoCant, // C6
  ThatToken: thatToken, // edh-top-1
  ThatCreature: thatCreature, // edh-mana-keywords-10
  SiegeWord: siegeWord, // cloud r3-mech
  PluralSubtype: pluralSubtype, // cloud r4-mech
  NotMoved: notMoved, // r4-moved
  FewerDiscarded: fewerDiscarded, // edh-c-73
  ItNotSource: itNotSource, // edh-c-73
  FewerPut: fewerPut, CountersMoved: countersMoved, // edh-d-93
  CardsDesc: cardsDesc, SearchDesc: searchDesc, // cloud r4-dig
  SurveilledCard: surveilledCard, ControlledMoved: controlledMoved, // r5-moved
  KeptOnTop: keptOnTop, // r5-fxz
  TypeChoices: typeChoices, // std-rD
  CardDesc: cardDesc, // std-exile-play-2-3
  ColoredManaCost: coloredManaCost, // std-mana-12
  CreatureTypeChoices: creatureTypeChoices, ChosenType: chosenType, // std-combat-5
  CopyExcept: copyExcept, CopyExceptToken: copyExceptToken, CopyExceptTokens: copyExceptTokens, CopyExceptEach: copyExceptEach, CopyExceptTokenSet: copyExceptTokenSet, // p2-copy-perm-1; edh-next-130
  KickedWith: kickedWith, // p2-counters-state-1
  ReplStatic: replStatic, // p2-replace-events-1
  DamageWould: damageWould, DamageMore: damageMore, // p2-replace-damage-2
  HexFromColors: hexFromColors, // edh-players-2
  ProtFrom: protFrom, // edh-d-5
  HexFromTypes: hexFromTypes, // edh-c-45
  EnchantGraveyardQuote: enchantGraveyardQuote, EnchantLinkedQuote: enchantLinkedQuote, EnchantedCard: enchantedCard, // edh-perms-4
  BatExiledReturnQuote: batExiledReturnQuote, // edh-d-91
  CharStat: charStat, // edh-perms-8
  ObjPlayer: objPlayer, // edh-zones-16
  Its: itsPoss, // edh-c-39
  LoyaltySym: loyaltySym, // edh-next-142
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
