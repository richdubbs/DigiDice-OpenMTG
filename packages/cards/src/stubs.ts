/**
 * The decklist stub hook (design 12.1 contract C4). `resolveDecklist` still reports names the index does not know; the client asks
 * the player, and the names the player confirms become stub cards (the engine's `stubCardDef`: no cost, no types, no text, played by hand) instead of
 * being dropped. The Update button later replaces a stub by the real card when the index learns the name. Pure: no I/O.
 */
import { stubCardDef, type AbilityCompiler, type CardDef } from '@openmtg/engine';
import { compileResolvedDeck, type CompiledDeck } from './compile';
import type { ResolvedDecklist, UnknownName } from './database';
import { normalizeName } from './normalize';

/** Which unknown names the player confirmed: a predicate, or a set of the names as written in the decklist. */
export type StubConfirmation = ((unknown: UnknownName) => boolean) | ReadonlySet<string>;

export interface StubbedDeck extends CompiledDeck {
  /** The stub definitions made (also in `defs`), one per confirmed name. */
  stubs: CardDef[];
  /**
   * Unknown names left out of the deck: not confirmed, or a face name several cards share (`ambiguous`: the player picks the full name, a stub would hide
   * a card the index does know).
   */
  skipped: UnknownName[];
}

/**
 * Compile a resolved decklist, turning the confirmed unknown names into stub cards (origin 'decklist'). Stubs keep their counts and sections; names that
 * differ only in case, accents or spacing share one stub. Commander and companion stubs are in `defs` only, like their real cards. The compiler defaults to
 * the engine's compile pipeline (WP18), as in compileResolvedDeck.
 */
export function compileDeckWithStubs(deck: ResolvedDecklist, confirmed: StubConfirmation, compiler?: AbilityCompiler): StubbedDeck {
  const base = compileResolvedDeck(deck, compiler);
  const ok = typeof confirmed === 'function' ? confirmed : (u: UnknownName) => confirmed.has(u.name);
  const stubByKey = new Map<string, CardDef>();
  const stubOfName = new Map<string, CardDef>();
  const skipped: UnknownName[] = [];
  for (const u of deck.unknown) {
    if (u.ambiguous || !ok(u)) {
      skipped.push(u);
      continue;
    }
    const key = normalizeName(u.name);
    let stub = stubByKey.get(key);
    if (!stub) {
      stub = stubCardDef(u.name, 'decklist');
      stubByKey.set(key, stub);
    }
    stubOfName.set(u.name, stub);
  }
  const main = [...base.main];
  const sideboard = [...base.sideboard];
  for (const e of deck.unresolved) {
    const stub = stubOfName.get(e.name);
    if (!stub) continue;
    const copies = Array<string>(e.count).fill(stub.id);
    if (e.section === 'main') main.push(...copies);
    else if (e.section === 'sideboard') sideboard.push(...copies);
  }
  const stubs = [...stubByKey.values()];
  return { defs: [...base.defs, ...stubs], main, sideboard, stubs, skipped };
}
