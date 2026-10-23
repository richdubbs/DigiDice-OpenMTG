/** Helpers that hand resolved cards to the engine's compiler (pure; no I/O). The default is the engine's compile pipeline (milestone 5, WP18). */
import { compileCard, markUnsanctioned, type AbilityCompiler, type CardDef, type OracleCard } from '@openmtg/engine';
import type { ResolvedDecklist, ResolvedEntry } from './database';
import { isUnsanctioned } from './legalities';

export interface CompileFailure {
  /** Oracle name of the card the engine could not compile. */
  name: string;
  message: string;
}

/** Thrown when one or more cards cannot be compiled; names every card instead of aborting on the first bare engine error. */
export class CardCompileError extends Error {
  constructor(readonly failures: CompileFailure[]) {
    super(`Cannot compile ${failures.length} card(s): ${failures.map((f) => `${f.name} (${f.message})`).join('; ')}`);
    this.name = 'CardCompileError';
  }
}

/** Compile each distinct card once, collecting the cards the engine rejects instead of throwing. */
export function compileCardsSafe(cards: Iterable<OracleCard>, compiler?: AbilityCompiler): { defs: CardDef[]; failures: CompileFailure[] } {
  const defs = new Map<string, CardDef>();
  const failed = new Map<string, CompileFailure>();
  for (const card of cards) {
    if (defs.has(card.name) || failed.has(card.name)) continue;
    try {
      const def = compileCard(card, compiler);
      // Design 12.3 (WP24): a silver-border or acorn card is manual-only, whatever the compiler understood.
      defs.set(card.name, isUnsanctioned(card) ? markUnsanctioned(def) : def);
    } catch (e) {
      failed.set(card.name, { name: card.name, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { defs: [...defs.values()], failures: [...failed.values()] };
}

/** Compile each distinct card once (keyed by Oracle name, which is also the CardDef id). Throws CardCompileError naming every card that fails. */
export function compileCards(cards: Iterable<OracleCard>, compiler?: AbilityCompiler): CardDef[] {
  const { defs, failures } = compileCardsSafe(cards, compiler);
  if (failures.length) throw new CardCompileError(failures);
  return defs;
}

export interface CompiledDeck {
  /** One definition per distinct card, for GameConfig.defs. */
  defs: CardDef[];
  /** Deck as a flat list of def ids (card names), one per copy, for PlayerConfig.deck. */
  main: string[];
  sideboard: string[];
}

function expand(entries: ResolvedEntry[]): string[] {
  return entries.flatMap((e) => Array<string>(e.count).fill(e.card.name));
}

/**
 * M6-4 (m6 design E18, CR 712.4, 712.8g): the meld results the deck's meld cards can become, by name (a meld card names its result: `CardDef.meld.result`). The
 * engine has no card database at run time, so the melded permanent's definition must come with the deck's; `lookup` reads the same card index the deck was
 * resolved from. A result it can't find is left out (the meld action then asks the players to meld by hand).
 */
export function meldResultCards(defs: readonly CardDef[], lookup: (name: string) => OracleCard | undefined): OracleCard[] {
  const out = new Map<string, OracleCard>();
  for (const d of defs) {
    const name = d.meld?.result;
    if (d.layout !== 'meld' || d.meld?.isResult || name === undefined || out.has(name) || defs.some((x) => x.name === name)) continue;
    const card = lookup(name);
    if (card) out.set(name, card);
  }
  return [...out.values()];
}

/**
 * Compile a resolved decklist (unknown cards are skipped; check `deck.unknown` first).
 * Throws CardCompileError naming every card the engine cannot compile.
 * M6-4 INTERFACE CHANGE (additive, m6 design E18): with `lookup` (the card index by name), the meld result of every meld card in the deck is compiled too, so a
 * melded permanent has its definition in the game.
 */
export function compileResolvedDeck(deck: ResolvedDecklist, compiler?: AbilityCompiler, lookup?: (name: string) => OracleCard | undefined): CompiledDeck {
  const all = [...deck.main, ...deck.sideboard, ...deck.commander, ...deck.companion].map((e) => e.card);
  const defs = compileCards(all, compiler);
  const results = lookup ? meldResultCards(defs, lookup) : [];
  return { defs: results.length > 0 ? [...defs, ...compileCards(results, compiler)] : defs, main: expand(deck.main), sideboard: expand(deck.sideboard) };
}
