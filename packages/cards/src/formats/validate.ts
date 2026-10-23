/**
 * validateDeck: a resolved decklist against one format's construction rules and Scryfall legality data (docs/design/decks-and-formats.md, milestone 7).
 * Pure: no I/O. Anything it cannot check (a card without legality data, an unknown name, a companion's condition) is a warning, never a silent pass.
 */
import { legalityIn } from '../legalities';
import { checkColorIdentity, checkCommanders, commanderCards, commanderIdentity } from './commander';
import { deckLimitText, hasCompanion, isBasicLand } from './card-rules';
import { checkCompanion, companionRuleOf, type StartingDeck } from './companion';
import { findFormat } from './formats';
import type { DeckEntry, DeckPart, DeckToValidate, FormatDef, FormatProblem, FormatReport } from './types';

export class UnknownFormatError extends Error {
  constructor(readonly format: string) {
    super(`Unknown format "${format}"`);
    this.name = 'UnknownFormatError';
  }
}

interface Placed {
  entry: DeckEntry;
  section: DeckPart;
}

const sum = (entries: readonly { count: number }[]) => entries.reduce((n, e) => n + e.count, 0);
const SEVERITY_ORDER = { error: 0, warning: 1, note: 2 } as const;

/**
 * Arena exports list the companion both under Companion and in the sideboard. In a commander format (no sideboard, CR 903.5e) the sideboard copies of
 * a Companion-section card are that companion, not a sideboard (CR 702.139a); copies beyond the companion's count stay in the sideboard.
 */
function withoutCompanionCopies(sideboard: readonly DeckEntry[], companion: readonly DeckEntry[]): DeckEntry[] {
  const left = new Map<string, number>();
  for (const c of companion) left.set(c.card.name, (left.get(c.card.name) ?? 0) + c.count);
  const out: DeckEntry[] = [];
  for (const entry of sideboard) {
    const take = Math.min(entry.count, left.get(entry.card.name) ?? 0);
    if (take) left.set(entry.card.name, (left.get(entry.card.name) ?? 0) - take);
    if (entry.count > take) out.push(take ? { ...entry, count: entry.count - take } : entry);
  }
  return out;
}

const isCommanderSet = (entries: readonly DeckEntry[], format: FormatDef) => checkCommanders(commanderCards(entries), format.commander!).length === 0;

/**
 * MTGO exports list a commander deck's commander(s) as the sideboard, and its companion there too. When a commander format's decklist has no Commander
 * section and its sideboard is one or two cards that can be commanders together, they are read as the commander(s). Without a Companion section, a
 * two- or three-card sideboard whose one companion card (CR 702.139a) leaves a legal commander set is read as commander(s) + companion; when more than
 * one card could be the companion, nothing is guessed. Each reading gets a note.
 */
function commanderFromSideboard(sb: readonly DeckEntry[], deck: DeckToValidate, format: FormatDef): { commander: readonly DeckEntry[]; companion: readonly DeckEntry[] } | undefined {
  if (!format.commander || (deck.commander?.length ?? 0) > 0 || sb.length === 0 || sum(sb) > 3) return undefined;
  if (deck.unresolved?.some((u) => u.section === 'sideboard' || u.section === 'commander')) return undefined;
  if (sum(sb) <= 2 && isCommanderSet(sb, format)) return { commander: sb, companion: [] };
  if ((deck.companion?.length ?? 0) > 0 || deck.unresolved?.some((u) => u.section === 'companion')) return undefined;
  const rest = (c: DeckEntry) => sb.filter((x) => x !== c);
  const options = sb.filter((c) => c.count === 1 && hasCompanion(c.card) && isCommanderSet(rest(c), format));
  return options.length === 1 ? { commander: rest(options[0]!), companion: [options[0]!] } : undefined;
}

/** Validate a deck for a format (a FormatDef, or a name findFormat accepts). Throws UnknownFormatError for an unknown format name. */
export function validateDeck(deck: DeckToValidate, formatOrName: FormatDef | string): FormatReport {
  const format = typeof formatOrName === 'string' ? findFormat(formatOrName) : formatOrName;
  if (!format) throw new UnknownFormatError(String(formatOrName));
  const problems: FormatProblem[] = [];
  const add = (p: FormatProblem) => problems.push(p);

  let commander = deck.commander ?? [];
  let companion = deck.companion ?? [];
  let sideboard = format.commander ? withoutCompanionCopies(deck.sideboard ?? [], companion) : (deck.sideboard ?? []);
  const fromSb = commanderFromSideboard(sideboard, deck, format);
  if (fromSb) {
    commander = fromSb.commander;
    sideboard = [];
    add({ severity: 'note', code: 'commander-from-sideboard', rule: 'CR 903.3', message: `Read the sideboard as the commander (MTGO export): ${commander.map((e) => e.card.name).join(' + ')}.`, section: 'commander' });
    if (fromSb.companion.length) {
      companion = fromSb.companion;
      const name = companion[0]!.card.name;
      add({ severity: 'note', code: 'companion-from-sideboard', rule: 'CR 702.139a', message: `Read ${name} in the sideboard as the companion (MTGO export).`, card: name, section: 'companion' });
    }
  }
  const main = deck.main;
  const unresolved = deck.unresolved ?? [];
  const unknownIn = (s: DeckPart) => sum(unresolved.filter((u) => u.section === s && !(fromSb && s === 'sideboard')));
  // CR 702.139b: the starting deck the companion condition reads (the main deck; in a Commander format with the commander(s), before they are set aside).
  const starting: StartingDeck = {
    entries: format.commander ? [...main, ...commander] : main,
    unknown: unknownIn('main') + (format.commander ? unknownIn('commander') : 0),
    minDeckSize: format.deckSize?.min, // CR 100.2a, 903.5a; casual has none (Yorion is then a warning below 80 cards, companion.ts)
  };
  // CMP1, CR 702.139a: an MTGO list (no Companion section) has its companion in the sideboard, where it is in constructed play (CR 100.4). The one sideboard
  // card with a companion ability whose condition the starting deck fulfills is read as the companion; with several, none is chosen for the player.
  if (!format.commander && companion.length === 0 && !unresolved.some((u) => u.section === 'companion')) {
    const options = sideboard.filter((e) => hasCompanion(e.card) && checkCompanion(e.card, starting)?.status === 'met');
    const names = [...new Set(options.map((e) => e.card.name))];
    if (names.length === 1) {
      companion = [{ card: options[0]!.card, count: 1 }];
      add({ severity: 'note', code: 'companion-from-sideboard', rule: 'CR 702.139a', message: `Read ${names[0]} in the sideboard as the companion (MTGO export).`, card: names[0], section: 'companion' });
    } else if (names.length > 1) {
      add({ severity: 'note', code: 'companion-ambiguous', rule: 'CR 702.139a', message: `${names.join(', ')} could each be the companion: choose one in the Companion section.`, section: 'companion' });
    } else {
      // CMP1 review: a sideboard card with a companion ability the deck can't reveal: say why (the player may have expected a companion)
      for (const name of new Set(sideboard.filter((e) => hasCompanion(e.card)).map((e) => e.card.name))) {
        const card = sideboard.find((e) => e.card.name === name)!.card;
        const v = checkCompanion(card, starting);
        const condition = companionRuleOf(card)?.condition;
        const why = v?.status === 'unmet' ? `its companion condition is not met ("${condition}"): ${v.detail}` : v?.status === 'unknown' ? `its companion condition could not be checked: ${v.detail}` : 'its companion condition is not checked';
        add({ severity: 'note', code: 'companion-condition', rule: 'CR 702.139a', message: `${name} in the sideboard is not read as the companion: ${why}.`, card: name, section: 'sideboard' });
      }
    }
  }

  // Arena exports list the companion both under Companion and in the sideboard; a companion missing from the sideboard still comes from it in
  // constructed play (CR 702.139a: "from outside the game", which in a tournament is the sideboard, CR 100.4).
  const sbNames = new Set(sideboard.map((e) => e.card.name));
  const extraCompanion = format.commander ? [] : companion.filter((e) => !sbNames.has(e.card.name));

  const counts = {
    main: sum(main) + unknownIn('main'),
    sideboard: sum(sideboard) + unknownIn('sideboard') + sum(extraCompanion),
    commander: sum(commander) + unknownIn('commander'),
    companion: sum(companion) + unknownIn('companion'),
    deck: 0,
  };
  counts.deck = counts.main + (format.commander ? counts.commander : 0);

  for (const u of unresolved) {
    add({ severity: 'warning', code: 'unresolved-card', rule: 'card index', message: `"${u.name}" is not a known card: counted, but not checked.`, card: u.name, section: u.section });
  }

  // Deck size (CR 100.2a; 903.5a, 903.12d).
  if (format.deckSize) {
    const { min, max, rule } = format.deckSize;
    const what = format.commander ? `including the commander${counts.commander > 1 ? 's' : ''}` : 'in the main deck';
    if (counts.deck < min) {
      add({ severity: 'error', code: 'deck-too-small', rule, message: `${counts.deck} cards ${what}; ${format.name} needs ${max === min ? 'exactly' : 'at least'} ${min}.`, count: counts.deck, limit: min });
    } else if (max !== undefined && counts.deck > max) {
      add({ severity: 'error', code: 'deck-too-large', rule, message: `${counts.deck} cards ${what}; ${format.name} needs ${max === min ? 'exactly' : 'at most'} ${max}.`, count: counts.deck, limit: max });
    }
  }

  // Sideboard (CR 100.4a; 903.5e).
  if (format.sideboard && counts.sideboard > format.sideboard.count) {
    const { count, rule } = format.sideboard;
    if (count === 0) add({ severity: 'error', code: 'sideboard-not-allowed', rule, message: `${format.name} decks have no sideboard (${counts.sideboard} cards found).`, section: 'sideboard', count: counts.sideboard, limit: 0 });
    else add({ severity: 'error', code: 'sideboard-too-large', rule, message: `Sideboard has ${counts.sideboard} cards; at most ${count}.`, section: 'sideboard', count: counts.sideboard, limit: count });
  }

  if (!format.commander && commander.length > 0) {
    if (format.legalityKey) add({ severity: 'error', code: 'commander-not-allowed', rule: 'CR 903.3', message: `${format.name} has no commander; move the Commander section into the deck.`, section: 'commander' });
  }

  // Every card in play for this deck, where it is.
  const placed: Placed[] = [
    ...main.map((entry) => ({ entry, section: 'main' as const })),
    ...sideboard.map((entry) => ({ entry, section: 'sideboard' as const })),
    ...commander.map((entry) => ({ entry, section: 'commander' as const })),
    ...companion.map((entry) => ({ entry, section: 'companion' as const })),
  ];

  // Copy limits (CR 100.2a with 100.4a: deck and sideboard together; 903.5b: singleton including the commander). A Commander-format companion is
  // outside the deck and is checked by CR 903.11a below instead.
  if (format.maxCopies) {
    const tally = new Map<string, { card: DeckEntry['card']; n: number; section: DeckPart }>();
    const counted = placed.filter((p) => p.section !== 'companion' || extraCompanion.includes(p.entry));
    for (const { entry, section } of counted) {
      const t = tally.get(entry.card.name);
      if (t) t.n += entry.count;
      else tally.set(entry.card.name, { card: entry.card, n: entry.count, section });
    }
    for (const { card, n, section } of tally.values()) {
      if (isBasicLand(card)) continue;
      const own = deckLimitText(card);
      if (own === 'any') continue;
      if (own === 'unknown') {
        add({ severity: 'warning', code: 'copy-limit-unknown', rule: format.maxCopies.rule, message: `${card.name} has a deck-limit sentence the validator cannot read; its count (${n}) is not checked.`, card: card.name, section });
        continue;
      }
      // Only a Vintage-style restricted list limits copies; Duel Commander's `restricted` is its banned-as-commander list (checked below).
      const restricted = format.restricted === 'one-copy' && format.legalityKey !== undefined && legalityIn(card, format.legalityKey) === 'restricted';
      const limit = typeof own === 'number' ? own : restricted ? 1 : format.maxCopies.count;
      if (n <= limit) continue;
      if (restricted && typeof own !== 'number') {
        add({ severity: 'error', code: 'restricted', rule: `${format.name} restricted list (Scryfall legalities: ${format.legalityKey} restricted)`, message: `${card.name} is restricted in ${format.name}: at most 1 copy (${n} found).`, card: card.name, section, count: n, limit });
      } else {
        const rule = typeof own === 'number' ? `${card.name}'s Oracle text` : format.maxCopies.rule;
        add({ severity: 'error', code: 'too-many-copies', rule, message: `${n} copies of ${card.name}; at most ${limit}${typeof own === 'number' ? ' (its own deck limit)' : ''}.`, card: card.name, section, count: n, limit });
      }
    }
  }

  // Card pool, banned list (CR 100.6; Scryfall legalities). One problem per card name.
  if (format.legalityKey) {
    const seen = new Set<string>();
    for (const { entry, section } of placed) {
      const name = entry.card.name;
      if (seen.has(name)) continue;
      seen.add(name);
      const legality = legalityIn(entry.card, format.legalityKey);
      const rule = `Scryfall legalities (${format.legalityKey}: ${legality ?? 'no data'})`;
      if (legality === undefined) add({ severity: 'warning', code: 'no-legality-data', rule, message: `${name}: no ${format.name} legality data in the card index (refresh it); not checked.`, card: name, section });
      else if (legality === 'banned') add({ severity: 'error', code: 'banned', rule, message: `${name} is banned in ${format.name}.`, card: name, section });
      else if (legality === 'not_legal') add({ severity: 'error', code: 'not-legal', rule, message: `${name} is not legal in ${format.name}.`, card: name, section });
      else if (legality === 'restricted' && !format.restricted) {
        add({ severity: 'warning', code: 'restricted-unknown', rule, message: `${name} is "restricted" in ${format.name}'s legality data, which the validator does not understand for this format; not checked.`, card: name, section });
      }
    }
  }

  // Commander (CR 903.3-903.5, 702.124).
  const commanders = commanderCards(commander);
  if (format.commander) {
    if (unknownIn('commander') === 0) problems.push(...checkCommanders(commanders, format.commander));
    if (format.restricted === 'banned-as-commander' && format.legalityKey) {
      for (const card of new Set(commanders)) {
        if (legalityIn(card, format.legalityKey) !== 'restricted') continue;
        const rule = `${format.name} banned-as-commander list (Scryfall legalities: ${format.legalityKey} restricted)`;
        add({ severity: 'error', code: 'banned-as-commander', rule, message: `${card.name} is banned as a commander in ${format.name} (it may be in the deck, not be the commander).`, card: card.name, section: 'commander' });
      }
    }
    const identity = commanders.length && unknownIn('commander') === 0 ? commanderIdentity(commanders) : undefined;
    if (identity) {
      const checked = placed.filter((p) => p.section === 'main' || p.section === 'companion');
      problems.push(...checkColorIdentity(identity, checked, format.commander));
    } else if (commanders.length || unknownIn('commander') > 0) {
      add({ severity: 'warning', code: 'no-color-identity', rule: 'CR 903.4', message: "The commander's color identity is unknown; color identity not checked.", section: 'commander' });
    }
  }

  // Companion (CR 702.139a; in Commander, 903.11a). A game rule, not a format rule: checked in every format, casual included. CMP1: the condition is checked
  // against the starting deck (CR 702.139b) for the companions in COMPANION_RULES; an unmet condition is an error (the card can't be revealed as the
  // companion), a condition the validator can't decide is a warning.
  if (companion.length) {
    if (sum(companion) > 1) add({ severity: 'error', code: 'too-many-companions', rule: 'CR 702.139a', message: `${sum(companion)} companions; a player reveals at most one.`, section: 'companion', count: sum(companion), limit: 1 });
    const deckNames = new Set(placed.filter((p) => p.section === 'main' || p.section === 'commander').map((p) => p.entry.card.name));
    for (const { card } of companion) {
      if (!hasCompanion(card)) {
        add({ severity: 'error', code: 'not-a-companion', rule: 'CR 702.139a', message: `${card.name} has no companion ability.`, card: card.name, section: 'companion' });
        continue;
      }
      if (format.commander && deckNames.has(card.name) && !isBasicLand(card)) {
        add({ severity: 'error', code: 'companion-in-deck', rule: 'CR 903.11a', message: `${card.name} is both the companion and in the deck.`, card: card.name, section: 'companion' });
      }
      const verdict = checkCompanion(card, starting);
      const condition = companionRuleOf(card)?.condition;
      if (verdict?.status === 'unmet') {
        add({ severity: 'error', code: 'companion-condition', rule: 'CR 702.139a', message: `${card.name}'s companion condition is not met ("${condition}"): ${verdict.detail}.`, card: card.name, section: 'companion' });
      } else if (verdict?.status === 'unknown') {
        add({ severity: 'warning', code: 'companion-unchecked', rule: 'CR 702.139a', message: `${card.name}'s companion condition is not fully checked: ${verdict.detail}.`, card: card.name, section: 'companion' });
      } else if (!verdict) {
        add({ severity: 'warning', code: 'companion-unchecked', rule: 'CR 702.139a', message: `${card.name}'s companion condition is not checked; make sure the starting deck fulfills it.`, card: card.name, section: 'companion' });
      }
    }
  }

  problems.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return {
    format,
    valid: !problems.some((p) => p.severity === 'error'),
    problems,
    counts,
    commanders: [...commanders.map((c) => c.name), ...unresolved.filter((u) => u.section === 'commander').map((u) => u.name)],
    ...(companion.length === 1 && companion[0]!.count === 1 ? { companion: companion[0]!.card.name } : {}),
  };
}
