/**
 * Loader for the generated card fixture (cards.json): Oracle rules fields only, for the cards
 * named in test-cards.txt. Regenerate with `npm run cards -- fixtures`.
 * Uses a static JSON import, so no file-system access is needed (engine src stays I/O free).
 */
import { compileCard, compileCardDetailed, defaultCompileSources, type AbilityCompiler, type AbilityDef, type CardDef, type OracleCard } from '../../src/index';
import { nativeLine } from '../../src/cards/native';
import data from './cards.json';

interface FixtureFile {
  cards: OracleCard[];
  tokens: OracleCard[];
}
const fixture = data as unknown as FixtureFile;

let byName: Record<string, OracleCard> | undefined;
let tokensByName: Record<string, OracleCard[]> | undefined;

/** All fixture cards keyed by exact Oracle name (e.g. "Fire // Ice"). */
export function loadFixtureCards(): Record<string, OracleCard> {
  byName ??= Object.fromEntries(fixture.cards.map((c) => [c.name, c]));
  return byName;
}

/** One fixture card by exact Oracle name. Throws with the list of near names if missing. */
export function getCard(name: string): OracleCard {
  const card = loadFixtureCards()[name];
  if (!card) {
    const near = Object.keys(loadFixtureCards()).filter((n) => n.toLowerCase().includes(name.toLowerCase().slice(0, 4)));
    throw new Error(`Fixture has no card "${name}"${near.length ? `; similar: ${near.slice(0, 5).join(', ')}` : ''}. Add it to test-cards.txt and run: npm run cards -- fixtures`);
  }
  return card;
}

/** Token variants with this name (names are not unique: several Spirit tokens exist). */
export function getTokens(name: string): OracleCard[] {
  tokensByName ??= {};
  if (!tokensByName[name]) tokensByName[name] = fixture.tokens.filter((t) => t.name === name);
  return tokensByName[name]!;
}

/**
 * The token variants a fixture card creates: tokens named in its all_parts whose own all_parts list the
 * card (or one of its faces) as a creator. Falls back to every variant of that name when the data records
 * no creator link. Example: Doomed Traveler makes the 1/1 white flying Spirit, not the red-white 2/2.
 */
export function getTokensFor(cardName: string): OracleCard[] {
  const card = getCard(cardName);
  const creators = new Set([card.name, ...(card.card_faces ?? []).map((f) => f.name)]);
  const names = [...new Set((card.all_parts ?? []).filter((p) => p.component === 'token' && p.name !== card.name).map((p) => p.name))];
  return names.flatMap((name) => {
    const variants = getTokens(name);
    const made = variants.filter((t) => (t.all_parts ?? []).some((p) => creators.has(p.name)));
    return made.length ? made : variants;
  });
}

export function fixtureCardNames(): string[] {
  return fixture.cards.map((c) => c.name);
}

/** Compile one fixture card with the engine's compileCard (the default compiler is the milestone 5 compile pipeline, WP18). */
export function compiledDef(name: string, compiler?: AbilityCompiler): CardDef {
  return compileCard(getCard(name), compiler);
}

/** Compile the named fixture cards (distinct, in order), ready for GameConfig.defs. */
export function compiledDefs(names: string[], compiler?: AbilityCompiler): CardDef[] {
  return [...new Set(names)].map((n) => compiledDef(n, compiler));
}

/**
 * A card compiled by the default compiler, with the lines the milestone 3/4 native recognizers (src/cards/native.ts) read but the exact render gate
 * cannot confirm yet (CompileReport.faces[].nativeUngated: "protection from X and from Y", nonbasic/snow/legendary landwalk, timing restrictions,
 * three-color mana) taken from the recognizers, as milestone 4 compiled them. ONLY for tests whose subject is the engine rule those abilities drive
 * (CR 702.14, 702.16g, 601.3, 605), not the compiler: the default compiler leaves such a line as the parser read it (design 10.3, decision D14) until
 * the template packages add the renderer forms. The definition's `automation` is the default compiler's.
 */
export function withNativeLines(card: OracleCard): CardDef {
  const { def, report } = compileCardDetailed(card, defaultCompileSources());
  const faces = def.faces.map((face, i) => {
    const ungated = new Set(report.faces[i]?.nativeUngated ?? []);
    if (ungated.size === 0) return face;
    const raw = face.oracleText.split(/\r\n|\r|\n/);
    const done = new Set<number>();
    const abilities = face.abilities.flatMap((a): AbilityDef[] => {
      const line = a.src?.length === 1 ? a.src[0]! : -1;
      if (!ungated.has(line)) return [a];
      if (done.has(line)) return [];
      done.add(line);
      return nativeLine(raw[line] ?? '', face.name, line) ?? [a];
    });
    return { ...face, abilities };
  });
  return { ...def, faces };
}

/** `withNativeLines` of a fixture card. */
export function nativeDef(name: string): CardDef {
  return withNativeLines(getCard(name));
}
