/**
 * CMP1: companion deck conditions (CR 702.139a-b). "Before the game begins, you may reveal one card you own from outside the game with a companion ability
 * whose condition is fulfilled by your starting deck." Each printed companion's condition is DATA here (`COMPANION_RULES`: the card's Oracle name, the exact
 * Oracle wording of its condition, and a check from a small closed vocabulary), read by one evaluator (`checkCompanion`). A card whose Oracle wording is not
 * the one recorded (Oracle text changed, or a companion this table does not know: Treizeci, Lutri, Pauper Otter) gets no verdict: the validator says the
 * condition is not checked, never that it is met.
 *
 * The starting deck (CR 702.139b) is the deck after the sideboard is set aside; in a Commander game, before the commander is set aside: the main deck plus
 * the commander(s). A card in the deck has the characteristics it has outside the game: a double-faced card its front face's (CR 712.8a), an adventurer
 * card its normal characteristics (CR 715.4), a split card both halves combined (CR 709.4, 709.4b-c; Jegantha sees each half's symbols, CR 709.4b's
 * example). Changeling (CR 702.73a) and "is every creature type" are characteristic-defining abilities that work outside the game (CR 604.3).
 */
import type { OracleCard } from '@openmtg/engine';
import { frontFace, frontLines, isCreatureOutsideBattlefield } from './card-rules';
import type { DeckEntry } from './types';

/** The closed vocabulary of companion conditions (one per printed condition shape). */
export type CompanionCheck =
  /** Every card's mana value has this parity (Gyruda: even; Obosh: odd "and land cards", `landsExempt`). A land's mana value is 0 (CR 202.3a), which is even. */
  | { kind: 'manaValueParity'; parity: 'even' | 'odd'; landsExempt: boolean }
  /** Every card has mana value `min` or greater, land cards exempt (Keruga). */
  | { kind: 'minManaValue'; min: number; landsExempt: boolean }
  /** Every permanent card (CR 110.4) has mana value `max` or less (Lurrus). */
  | { kind: 'permanentMaxManaValue'; max: number }
  /** No card has more than one of the same mana symbol in its mana cost (Jegantha; CR 709.4b: a split card's halves' symbols count separately). */
  | { kind: 'noRepeatedManaSymbol' }
  /** Each creature card has one of these creature types (Kaheera). */
  | { kind: 'creatureTypes'; types: readonly string[] }
  /** Each nonland card has a different name (Lutri, the Spellchaser). */
  | { kind: 'singletonNonland' }
  /** Every nonland card shares a card type (Umori). */
  | { kind: 'sharedCardType' }
  /** The starting deck has at least `extra` cards more than the minimum deck size (Yorion). */
  | { kind: 'extraCards'; extra: number }
  /** Each permanent card has an activated ability (Zirda). */
  | { kind: 'permanentsActivated' };

export interface CompanionRule {
  /** Oracle name of the companion card. */
  name: string;
  /** Its condition exactly as Oracle prints it after "Companion — " (without the reminder text): checked against the card before the rule is used. */
  condition: string;
  check: CompanionCheck;
}

/** The ten companions of Ikoria (2020), the printed companion conditions this build checks. */
export const COMPANION_RULES: readonly CompanionRule[] = [
  { name: 'Gyruda, Doom of Depths', condition: 'Your starting deck contains only cards with even mana values.', check: { kind: 'manaValueParity', parity: 'even', landsExempt: false } },
  { name: 'Jegantha, the Wellspring', condition: 'No card in your starting deck has more than one of the same mana symbol in its mana cost.', check: { kind: 'noRepeatedManaSymbol' } },
  {
    name: 'Kaheera, the Orphanguard',
    condition: 'Each creature card in your starting deck is a Cat, Elemental, Nightmare, Dinosaur, or Beast card.',
    check: { kind: 'creatureTypes', types: ['Cat', 'Elemental', 'Nightmare', 'Dinosaur', 'Beast'] },
  },
  { name: 'Keruga, the Macrosage', condition: 'Your starting deck contains only cards with mana value 3 or greater and land cards.', check: { kind: 'minManaValue', min: 3, landsExempt: true } },
  { name: 'Lurrus of the Dream-Den', condition: 'Each permanent card in your starting deck has mana value 2 or less.', check: { kind: 'permanentMaxManaValue', max: 2 } },
  { name: 'Lutri, the Spellchaser', condition: 'Each nonland card in your starting deck has a different name.', check: { kind: 'singletonNonland' } },
  { name: 'Obosh, the Preypiercer', condition: 'Your starting deck contains only cards with odd mana values and land cards.', check: { kind: 'manaValueParity', parity: 'odd', landsExempt: true } },
  { name: 'Umori, the Collector', condition: 'Each nonland card in your starting deck shares a card type.', check: { kind: 'sharedCardType' } },
  { name: 'Yorion, Sky Nomad', condition: 'Your starting deck contains at least twenty cards more than the minimum deck size.', check: { kind: 'extraCards', extra: 20 } },
  { name: 'Zirda, the Dawnwaker', condition: 'Each permanent card in your starting deck has an activated ability.', check: { kind: 'permanentsActivated' } },
];

/** The card's companion condition as Oracle prints it ("Companion — [Condition]", CR 702.139a), without reminder text; undefined without one. */
export function companionCondition(card: OracleCard): string | undefined {
  for (const l of frontLines(card)) {
    const m = /^Companion\s*[—-]\s*(.+)$/.exec(l);
    if (m) return m[1]!.trim();
  }
  return undefined;
}

/** The rule of a companion card: its name is in the table AND its Oracle condition is the recorded one (anything else is not checked). */
export function companionRuleOf(card: OracleCard): CompanionRule | undefined {
  const rule = COMPANION_RULES.find((r) => r.name === card.name);
  return rule && companionCondition(card) === rule.condition ? rule : undefined;
}

/** The starting deck as the condition reads it (CR 702.139b). */
export interface StartingDeck {
  /** The known cards of the starting deck: the main deck, plus the commander(s) in a Commander format. */
  entries: readonly DeckEntry[];
  /** Cards of the starting deck the card index does not know (counted, never checked). */
  unknown: number;
  /**
   * The format's minimum deck size (CR 100.2a: 60 in constructed; 903.5a: 100 in Commander, the commander included). Undefined for a format without one
   * (casual): Yorion's "more than the minimum deck size" can't be decided there below 80 cards (the constructed minimum plus twenty), a warning, never an error.
   */
  minDeckSize: number | undefined;
}

export type CompanionVerdict =
  | { status: 'met' }
  /** The known cards break the condition: `offenders` names them (at most a few, then "and N more"). */
  | { status: 'unmet'; detail: string; offenders: string[] }
  /** The condition can't be decided (cards the index does not know). */
  | { status: 'unknown'; detail: string };

// ---- a card in the deck, as the condition sees it (characteristics outside the game)

const CARD_TYPE_WORDS = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Instant', 'Kindred', 'Land', 'Planeswalker', 'Sorcery'] as const;
/** CR 110.4: the permanent card types. */
const PERMANENT_TYPES = new Set(['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker']);

interface DeckCard {
  name: string;
  manaValue: number;
  types: string[];
  subtypes: string[];
  symbols: string[];
  creature: boolean;
  everyCreatureType: boolean;
  activated: boolean;
}

const splitTypeLine = (line: string): { types: string[]; subtypes: string[] } => {
  const [left = '', right = ''] = line.split(/\s+[—-]\s+/, 2);
  const words = left.split(/\s+/).filter(Boolean);
  // "Tribal" is the older name of the Kindred card type (CR 205.2a).
  return { types: words.map((w) => (w === 'Tribal' ? 'Kindred' : w)).filter((w) => (CARD_TYPE_WORDS as readonly string[]).includes(w)), subtypes: right.split(/\s+/).filter(Boolean) };
};

const symbolsOf = (cost: string | undefined): string[] => (cost ?? '').match(/\{[^}]+\}/g) ?? [];

/**
 * Activated keyword abilities (CR 702: "[keyword] [cost]" means "[cost]: [effect]"), by Scryfall's keyword names. Typecycling (Forestcycling, Wizardcycling,
 * Landcycling, Basic landcycling) is cycling (CR 702.29e): matched by its ending. Special actions (morph, disguise, foretell, plot, suspend) are not activated
 * abilities (CR 116.2) and are not listed.
 */
const ACTIVATED_KEYWORDS = new Set([
  'equip', 'fortify', 'reconfigure', 'cycling', 'level up', 'ninjutsu', 'commander ninjutsu', 'unearth', 'transmute', 'transfigure', 'outlast', 'scavenge',
  'embalm', 'eternalize', 'encore', 'crew', 'saddle', 'station', 'craft', 'bloodrush', 'auraswap', 'reinforce', 'forecast',
]);

/** Text outside quotation marks: an ability in quotes is granted to something else ("Creatures you control have '{T}: Add {G}.'"). */
const unquoted = (line: string): string => line.replace(/["“][^"”]*["”]/g, '');

function hasActivatedAbility(card: OracleCard, subtypes: readonly string[], types: readonly string[]): boolean {
  // CR 305.6: a land with a basic land type has the intrinsic "{T}: Add [mana symbol]."
  if (types.includes('Land') && subtypes.some((t) => ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].includes(t))) return true;
  if ((card.keywords ?? []).some((k) => ACTIVATED_KEYWORDS.has(k.toLowerCase()) || /cycling$/i.test(k))) return true;
  // CR 602.1: "[Cost]: [Effect.]" (a loyalty ability, CR 606.3, too); the cost is before the first colon outside quotes.
  return frontLines(card).some((l) => /^[^:]{1,120}:\s/.test(unquoted(l)));
}

/** The card as it is in the starting deck (characteristics outside the game). */
function deckCard(card: OracleCard): DeckCard {
  const split = card.layout === 'split' && (card.card_faces?.length ?? 0) > 1;
  const faces = split ? card.card_faces! : [frontFace(card)];
  const types = new Set<string>();
  const subtypes = new Set<string>();
  for (const f of faces) {
    const t = splitTypeLine(f.type_line ?? '');
    t.types.forEach((x) => types.add(x));
    t.subtypes.forEach((x) => subtypes.add(x));
  }
  // Grist, the Hunger Tide: a creature card outside the battlefield by its own ability (CR 113.6c), with the creature type it names.
  if (isCreatureOutsideBattlefield(card)) {
    types.add('Creature');
    const m = /it['’]s an? (?:\d+\/\d+ )?([A-Z][\w'-]*(?: [A-Z][\w'-]*)*) creature/.exec(frontLines(card).join('\n'));
    m?.[1]!.split(' ').forEach((x) => subtypes.add(x));
  }
  // "<this card> is every creature type" (Mistform Ultimus), a characteristic-defining ability (CR 604.3)
  const self = new Set([frontFace(card).name, card.name, 'This creature', 'This card', 'This object']);
  const everyCreatureType =
    (card.keywords ?? []).includes('Changeling') || frontLines(card).some((l) => {
      const m = /^(.+?) is every creature type\b/.exec(l);
      return m !== null && self.has(m[1]!);
    });
  const typeList = [...types];
  const subtypeList = [...subtypes];
  return {
    name: card.name,
    // Scryfall's mana value is the card's outside the stack: the front face's (CR 712.8a), the normal characteristics' (CR 715.4), both halves' (CR 709.4b).
    manaValue: card.cmc ?? 0,
    types: typeList,
    subtypes: subtypeList,
    symbols: faces.flatMap((f) => symbolsOf(f.mana_cost)),
    creature: types.has('Creature'),
    everyCreatureType,
    activated: hasActivatedAbility(card, subtypeList, typeList),
  };
}

const MAX_LISTED = 5;
const listed = (names: readonly string[]): string => {
  const unique = [...new Set(names)];
  const shown = unique.slice(0, MAX_LISTED).join(', ');
  return unique.length > MAX_LISTED ? `${shown} and ${unique.length - MAX_LISTED} more` : shown;
};

/** Evaluate a companion's condition against a starting deck (CR 702.139a-b). Undefined when the card has no checkable rule (`companionRuleOf`). */
export function checkCompanion(card: OracleCard, deck: StartingDeck): CompanionVerdict | undefined {
  const rule = companionRuleOf(card);
  if (!rule) return undefined;
  const cards = deck.entries.map((e) => ({ entry: e, c: deckCard(e.card) }));
  const isLand = (c: DeckCard) => c.types.includes('Land');
  const unmet = (offenders: string[], detail: string): CompanionVerdict => ({ status: 'unmet', offenders: [...new Set(offenders)], detail: `${detail}: ${listed(offenders)}` });
  const unknownCards = deck.unknown > 0 ? `${deck.unknown} card${deck.unknown === 1 ? '' : 's'} of the deck ${deck.unknown === 1 ? 'is' : 'are'} not known, so the condition is not fully checked` : '';
  const verdict = (offenders: string[], detail: string): CompanionVerdict =>
    offenders.length ? unmet(offenders, detail) : deck.unknown > 0 ? { status: 'unknown', detail: unknownCards } : { status: 'met' };
  const check = rule.check;
  switch (check.kind) {
    case 'manaValueParity': {
      const want = check.parity === 'even' ? 0 : 1;
      const bad = cards.filter(({ c }) => !(check.landsExempt && isLand(c)) && c.manaValue % 2 !== want).map(({ c }) => c.name);
      return verdict(bad, `cards with ${check.parity === 'even' ? 'an odd' : 'an even'} mana value${check.landsExempt ? ' (not lands)' : ''}`);
    }
    case 'minManaValue': {
      const bad = cards.filter(({ c }) => !(check.landsExempt && isLand(c)) && c.manaValue < check.min).map(({ c }) => c.name);
      return verdict(bad, `nonland cards with mana value less than ${check.min}`);
    }
    case 'permanentMaxManaValue': {
      const bad = cards.filter(({ c }) => c.types.some((t) => PERMANENT_TYPES.has(t)) && c.manaValue > check.max).map(({ c }) => c.name);
      return verdict(bad, `permanent cards with mana value greater than ${check.max}`);
    }
    case 'noRepeatedManaSymbol': {
      const bad = cards.filter(({ c }) => new Set(c.symbols).size !== c.symbols.length).map(({ c }) => c.name);
      return verdict(bad, 'cards with the same mana symbol more than once in their mana cost');
    }
    case 'creatureTypes': {
      const bad = cards.filter(({ c }) => c.creature && !c.everyCreatureType && !c.subtypes.some((t) => check.types.includes(t))).map(({ c }) => c.name);
      return verdict(bad, `creature cards that are not a ${check.types.join(', ')}`);
    }
    case 'singletonNonland': {
      const counts = new Map<string, number>();
      for (const { entry, c } of cards) if (!isLand(c)) counts.set(c.name, (counts.get(c.name) ?? 0) + entry.count);
      const bad = [...counts].filter(([, n]) => n > 1).map(([name]) => name);
      return verdict(bad, 'nonland cards with more than one copy');
    }
    case 'sharedCardType': {
      const nonland = cards.filter(({ c }) => !isLand(c)).map(({ c }) => c);
      if (nonland.length === 0) return verdict([], '');
      const shared = CARD_TYPE_WORDS.filter((t) => nonland.every((c) => c.types.includes(t)));
      if (shared.length > 0) return verdict([], '');
      // Name the cards that lack the most common type, the smallest change that would meet the condition.
      const best = [...CARD_TYPE_WORDS].sort((a, b) => nonland.filter((c) => c.types.includes(b)).length - nonland.filter((c) => c.types.includes(a)).length)[0]!;
      return unmet(nonland.filter((c) => !c.types.includes(best)).map((c) => c.name), `no card type is shared by every nonland card (the most common is ${best}; without it)`);
    }
    case 'extraCards': {
      const size = deck.entries.reduce((n, e) => n + e.count, 0) + deck.unknown;
      if (deck.minDeckSize === undefined) {
        // CMP1 review: no minimum deck size in this format; at least the constructed minimum (CR 100.2a: 60) plus the extra is enough in any reading
        const need = 60 + check.extra;
        return size >= need ? { status: 'met' } : { status: 'unknown', detail: `this format has no minimum deck size, and the companion needs ${check.extra} cards more than the format's minimum; the starting deck has ${size} (${need} meets it in any reading, with the constructed minimum of 60)` };
      }
      const need = deck.minDeckSize + check.extra;
      return size >= need ? { status: 'met' } : { status: 'unmet', offenders: [], detail: `the starting deck has ${size} cards; it needs at least ${need} (the minimum deck size ${deck.minDeckSize} plus ${check.extra})` };
    }
    case 'permanentsActivated': {
      const bad = cards.filter(({ c }) => c.types.some((t) => PERMANENT_TYPES.has(t)) && !c.activated).map(({ c }) => c.name);
      return verdict(bad, 'permanent cards without an activated ability');
    }
  }
}
