/**
 * Deck submission (docs/design/online.md, "Game setup online"): a player sends Oracle names only; the host resolves them with its own card data
 * (the cards package, local index only: a guest's decklist never makes the host contact anyone), validates the deck for the host's format and
 * compiles the definitions that go into the game state.
 *
 * Format validation is milestone 7's `validateDeck` (cards package, docs/design/decks-and-formats.md): `formatValidator` adapts its report to the
 * host's error and warning lists (internal, not exported from the package). Pass `validate` to GameHost to use another validator.
 */
import { performance } from 'node:perf_hooks';
import type { AbilityCompiler, CardDef, CommanderVariant, OracleCard } from '@openmtg/engine';
import { compileCardsSafe, findFormat, FORMATS, parseDecklist, validateDeck, type FormatId, type FormatProblem, type ResolvedName } from '@openmtg/cards';
import type { DeckEntry, DeckSubmission } from '../protocol/messages';

/** What the host needs from its card data (CardDatabase satisfies it). */
export interface CardSource {
  resolveNames(names: string[]): Promise<{ resolved: ResolvedName[] }>;
  suggest?(name: string, limit?: number): string[];
}

export interface ResolvedDeck {
  main: { card: OracleCard; count: number }[];
  sideboard: { card: OracleCard; count: number }[];
  /** M11-3: the commander section (CR 903.3), absent or empty for a deck without one. */
  commander?: { card: OracleCard; count: number }[];
  /** CMP1: the companion section (CR 702.139a), absent or empty for a deck without one. */
  companion?: { card: OracleCard; count: number }[];
}

export interface DeckProblems {
  errors: string[];
  warnings: string[];
  /**
   * M11-3: in a format with a command zone, the commander cards the validator read (Oracle names): the commander section, or the sideboard of an
   * MTGO export (milestone 7's `commander-from-sideboard`, CR 903.3). Absent: the commander section as submitted.
   */
  commanders?: string[];
  /**
   * CMP1 INTERFACE CHANGE (additive): the companion the validator read (Oracle name, CR 702.139a): the companion section, or the one card of an MTGO-style
   * sideboard whose condition the deck fulfills (milestone 7's `companion-from-sideboard`). Absent: the companion section as submitted.
   */
  companion?: string;
}

export type DeckValidator = (deck: ResolvedDeck, format: string) => DeckProblems;

/**
 * A deck ready for GameConfig: def ids (Oracle names), one per card, and the compiled definitions. `commanders` (M11-3): the commander def ids for
 * `PlayerConfig.commanders` (CR 903.3, 702.124), empty outside a format with a command zone; `main` is then the rest of the deck (CR 903.6).
 */
export interface PreparedDeck {
  main: string[];
  sideboard: string[];
  commanders: string[];
  /**
   * CMP1 INTERFACE CHANGE (additive, optional): the revealed companion's def id for `PlayerConfig.companion` (CR 702.139a), its condition checked by the
   * validator (CR 702.139a-b). `sideboard` is then without that one copy (constructed lists name it in the sideboard too). Absent: no companion.
   */
  companion?: string;
  defs: CardDef[];
  warnings: string[];
}

export type PrepareResult = { ok: true; deck: PreparedDeck } | { ok: false; errors: string[]; warnings: string[] };

export const CASUAL = 'casual';
/** Every deck, casual included (an OpenMTG limit: the host builds the game from it). */
export const MAX_MAIN_CARDS = 250;
export const MAX_SIDEBOARD_CARDS = 15;

const line = (p: FormatProblem): string => `${p.message} (${p.rule})`;

/**
 * M11-3 (m11 design 6): the Commander variant of the engine (`commanderOptions`, CR 903) a format is played with, or null for a format without a command
 * zone (an unknown name too). The four commander formats of milestone 7 (`FormatDef.commander`) map one to one onto the engine's variants.
 */
const VARIANT_OF: Partial<Record<FormatId, CommanderVariant>> = { commander: 'commander', duel: 'duel', brawl: 'brawl', standardbrawl: 'standardbrawl' };
export function commanderVariantOf(format: string): CommanderVariant | null {
  const f = findFormat(format);
  if (!f?.commander) return null;
  const v = VARIANT_OF[f.id];
  // A commander format the engine has no variant for would be played without its rules: refused loudly, never silently (a programming error).
  if (!v) throw new Error(`Format "${f.name}" has commanders but no Commander variant in the engine.`);
  return v;
}

/**
 * The host's format check: milestone 7's `validateDeck` for the format the host chose (any name `findFormat` accepts: an id, a display name or an alias).
 * Its errors refuse the deck; its warnings (what it could not check: a card without legality data...) and notes go back to the player. An unknown format
 * name is refused, never half-checked. A format with a command zone (Commander, Duel Commander, Brawl, Standard Brawl: M11-3) checks the commander section
 * too (CR 903.3-903.5, 903.12) and reports the commanders it read. Every deck, casual included, needs at least one card (the size limits above are
 * `prepareDeck`'s, for any validator).
 */
export const formatValidator: DeckValidator = (deck, format) => {
  const f = findFormat(format);
  if (!f) return { errors: [`Unknown format "${format}". Known formats: ${FORMATS.map((x) => x.id).join(', ')}.`], warnings: [] };
  const errors: string[] = [];
  if (deck.main.reduce((n, e) => n + e.count, 0) === 0) errors.push('The deck is empty.');
  const report = validateDeck({ main: deck.main, sideboard: deck.sideboard, commander: deck.commander ?? [], companion: deck.companion ?? [] }, f);
  errors.push(...report.problems.filter((p) => p.severity === 'error').map(line));
  return {
    errors,
    warnings: report.problems.filter((p) => p.severity !== 'error').map(line),
    ...(f.commander ? { commanders: report.commanders } : {}),
    ...(report.companion !== undefined ? { companion: report.companion } : {}),
  };
};

/**
 * M11-3: the commander cards of a validated deck and the sideboard left once they are taken out of it (an MTGO export lists them there; the validator read
 * them, `DeckProblems.commanders`). Never a guess: a name the validator reports that is in neither section is an error.
 */
function takeCommanders(deck: ResolvedDeck, names: readonly string[]): { commander: ResolvedDeck['main']; sideboard: ResolvedDeck['main'] } | { error: string } {
  const fromSection = deck.commander ?? [];
  const sideboard = deck.sideboard.map((e) => ({ ...e }));
  const commander: ResolvedDeck['main'] = [];
  for (const name of names) {
    const c = fromSection.find((e) => e.card.name === name);
    if (c) {
      commander.push({ card: c.card, count: 1 });
      continue;
    }
    const s = sideboard.find((e) => e.card.name === name && e.count > 0);
    if (!s) return { error: `The commander ${name} is neither in the commander section nor in the sideboard.` };
    s.count--;
    commander.push({ card: s.card, count: 1 });
  }
  return { commander, sideboard: sideboard.filter((e) => e.count > 0) };
}

/**
 * Fuzzy suggestions for unknown names are slow (a scan of every card name: about 60 ms for a 20-character name), and a guest's decklist reaches the
 * host before the game starts. A hello with 265 unknown names blocked the host's event loop for about 15 s (audit 2026-10-12, m7). So the host
 * lists at most `listed` unknown names, suggests for at most `suggested` of them, only for names up to `nameLength` characters, and stops suggesting
 * once `budgetMs` of suggestion time is spent. Hellos are also rate-limited (limits.ts, `joins`).
 */
export const SUGGEST = { listed: 10, suggested: 3, nameLength: 60, budgetMs: 200 } as const;

/** The bounded suggestion function of one deck check (SUGGEST). `clock` in milliseconds (default performance.now; tests pass a fake one). */
export function suggester(cards: CardSource, clock: () => number = () => performance.now()): (name: string) => string[] {
  let calls = 0;
  let spent = 0;
  return (name) => {
    if (!cards.suggest || calls >= SUGGEST.suggested || spent >= SUGGEST.budgetMs || name.length > SUGGEST.nameLength) return [];
    calls++;
    const start = clock();
    try {
      return cards.suggest(name, 3);
    } finally {
      spent += clock() - start;
    }
  };
}

function merge(entries: DeckEntry[], byName: Map<string, OracleCard>): { card: OracleCard; count: number }[] {
  const out = new Map<string, { card: OracleCard; count: number }>();
  for (const e of entries) {
    const card = byName.get(e.name);
    if (!card) continue;
    const m = out.get(card.name);
    if (m) m.count += e.count;
    else out.set(card.name, { card, count: e.count });
  }
  return [...out.values()];
}

/** Resolve, validate and compile a submitted deck. Never throws for bad input: problems come back as messages for the player. */
export async function prepareDeck(
  sub: DeckSubmission,
  o: { cards: CardSource; format: string; validate?: DeckValidator; compiler?: AbilityCompiler; clock?: () => number },
): Promise<PrepareResult> {
  const commanderSection = sub.commander ?? [];
  const companionSection = sub.companion ?? [];
  const names = [...new Set([...sub.main, ...sub.sideboard, ...commanderSection, ...companionSection].map((e) => e.name))];
  const { resolved } = await o.cards.resolveNames(names);
  const errors: string[] = [];
  const byName = new Map<string, OracleCard>();
  const suggest = suggester(o.cards, o.clock);
  let unknown = 0;
  for (const r of resolved) {
    if (r.card) byName.set(r.name, r.card);
    else if (++unknown > SUGGEST.listed) continue;
    else if (r.ambiguous?.length) errors.push(`"${r.name}" could mean several cards: ${r.ambiguous.slice(0, 5).join(', ')}.`);
    else {
      const s = suggest(r.name);
      errors.push(`Unknown card "${r.name}"${s.length ? ` (did you mean ${s.join(', ')}?)` : ''}.`);
    }
  }
  if (unknown > SUGGEST.listed) errors.push(`${unknown - SUGGEST.listed} more card names are unknown or ambiguous.`);
  const deck: ResolvedDeck = {
    main: merge(sub.main, byName),
    sideboard: merge(sub.sideboard, byName),
    commander: merge(commanderSection, byName),
    companion: merge(companionSection, byName),
  };
  // The size limits hold whatever validator is used: the host builds the game from the deck.
  const size = (es: ResolvedDeck['main']) => es.reduce((n, e) => n + e.count, 0);
  if (size(deck.main) > MAX_MAIN_CARDS) errors.push(`The main deck has ${size(deck.main)} cards; OpenMTG allows at most ${MAX_MAIN_CARDS}.`);
  if (size(deck.sideboard) > MAX_SIDEBOARD_CARDS) errors.push(`The sideboard has ${size(deck.sideboard)} cards; at most ${MAX_SIDEBOARD_CARDS} are allowed.`);
  if (size(deck.companion!) > 1) errors.push(`The companion section has ${size(deck.companion!)} cards; a player reveals at most one companion (CR 702.139a).`);
  // M11-3 (CR 903.3): only a format with a command zone has commanders. Never silently play a commander as an ordinary card of another format.
  let variant: CommanderVariant | null;
  try {
    variant = commanderVariantOf(o.format);
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)], warnings: [] };
  }
  if (!variant && size(deck.commander!) > 0) {
    errors.push(`${findFormat(o.format)?.name ?? o.format} has no commander (CR 903.3): move the commander into the deck, or play a Commander format.`);
  }
  if (errors.length) return { ok: false, errors, warnings: [] };
  const problems = (o.validate ?? formatValidator)(deck, o.format);
  errors.push(...problems.errors);
  if (errors.length) return { ok: false, errors, warnings: problems.warnings };
  let sideboard = deck.sideboard;
  let commander: ResolvedDeck['main'] = [];
  if (variant) {
    const taken = takeCommanders(deck, problems.commanders ?? deck.commander!.flatMap((e) => Array<string>(e.count).fill(e.card.name)));
    if ('error' in taken) return { ok: false, errors: [taken.error], warnings: problems.warnings };
    ({ commander, sideboard } = taken);
    // CR 903.3, 702.124a: one commander, or two partners (also checked by validateDeck; this holds for any validator, and the engine refuses the rest).
    if (commander.length < 1 || commander.length > 2) {
      return { ok: false, errors: [`A ${findFormat(o.format)!.name} deck needs one commander, or two partners (CR 903.3, 702.124a); this one has ${commander.length}.`], warnings: problems.warnings };
    }
  }
  // CMP1 (CR 702.139a): the companion the validator read, else the companion section's one card. One copy of it leaves the sideboard (it is outside the
  // game either way: PlayerConfig.companion joins GameState.outside), so the engine never holds it twice.
  const section = deck.companion ?? [];
  const companionName = problems.companion ?? (section.length === 1 && section[0]!.count === 1 ? section[0]!.card.name : undefined);
  let companion: OracleCard | undefined;
  if (companionName !== undefined) {
    companion = section.find((e) => e.card.name === companionName)?.card ?? sideboard.find((e) => e.card.name === companionName)?.card;
    if (!companion) return { ok: false, errors: [`The companion ${companionName} is neither in the companion section nor in the sideboard.`], warnings: problems.warnings };
    const i = sideboard.findIndex((e) => e.card.name === companionName);
    if (i >= 0) sideboard = sideboard.map((e, j) => (j === i ? { ...e, count: e.count - 1 } : e)).filter((e) => e.count > 0);
  }
  const all = [...deck.main, ...sideboard, ...commander].map((e) => e.card);
  const { defs, failures } = compileCardsSafe(companion ? [...all, companion] : all, o.compiler);
  if (failures.length) return { ok: false, errors: failures.map((f) => `${f.name} cannot be compiled: ${f.message}`), warnings: problems.warnings };
  const expand = (es: ResolvedDeck['main']) => es.flatMap((e) => Array<string>(e.count).fill(e.card.name));
  return {
    ok: true,
    deck: { main: expand(deck.main), sideboard: expand(sideboard), commanders: expand(commander), ...(companion ? { companion: companion.name } : {}), defs, warnings: problems.warnings },
  };
}

/**
 * A decklist text (any format parseDecklist reads) as a submission. The Commander section is the deck's commander (M11-3, CR 903.3); CMP1: the Companion
 * section is the deck's companion (CR 702.139a; the host checks its condition). An MTGO list keeps its companion in the sideboard, where the host's
 * validator reads it (`companion-from-sideboard`).
 */
export function deckFromText(text: string): { deck: DeckSubmission; errors: string[] } {
  const p = parseDecklist(text);
  const errors = p.errors.map((e) => `line ${e.line}: ${e.message}`);
  const entries = (lines: { name: string; count: number }[]) => lines.map((l) => ({ name: l.name, count: l.count }));
  return {
    deck: {
      main: entries(p.main),
      sideboard: entries(p.sideboard),
      ...(p.commander.length ? { commander: entries(p.commander) } : {}),
      ...(p.companion.length ? { companion: entries(p.companion) } : {}),
    },
    errors,
  };
}
