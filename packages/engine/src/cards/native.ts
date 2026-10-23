/**
 * The native recognizers of milestones 3 and 4, kept as the LAST source of the compile pipeline (below the template parser, above manual). Owner: WP18.
 *
 * Milestone 4's default compiler (cards/basic-compiler.ts, removed by WP18) automated four kinds of line with hand-verified recognizers:
 *   - simple mana abilities                        rules/mana-text.ts#parseManaAbilityLine        (CR 605)
 *   - casting restrictions that are pure timing    rules/cast-restriction.ts#parseCastRestriction  (CR 601.3)
 *   - "enters with N counters" in the simple form   cards/enters-with.ts#parseEntersWithCounters     (CR 614.1c)
 *   - lines that consist only of keywords          cards/keywords.ts#parseKeywordLine             (CR 702)
 * The bootstrap templates of WP17 do not read all of these yet (landwalk, "protection from X and from Y", "Add {W}", most mana lines: the template
 * packages WP19-WP23 add them). So a line whose parser abilities are not all fully automated (manual, or PARTLY automated) is offered to these
 * recognizers; their result replaces the parser's abilities of that line only when it is COMPLETE for the line, passes the same lint, exact render gate
 * (design 6.8 G6, decision D14: the gate is never loosened for a source) and capability degrade as every other source, and is fully automated after
 * them. It never replaces a line the parser fully understood with STABLE templates (W3b: a line read with an experimental template, which caps the card
 * at partial, design 6.9, is offered too, so a unit milestone 4 automated keeps its full result, guard G10). It is data like any other source, with its own provenance `{by:'native', id:<recognizer>}`
 * (`keyword:<name>` for a keyword item), never a function per card. A wording the renderer cannot print yet ("protection from X and from Y", "Add {R},
 * {G}, or {W}") is therefore not taken: those cards stay partial until the template packages add the forms (CompileReport.faces[].nativeUngated lists them).
 *
 * Imports: rules/cast-restriction and rules/mana-text (pure text readers) are a documented temporary exception to design 5.4's cards rule
 * (test/m5/skeleton/import-rules.test.ts, NATIVE_RULES_EXCEPTIONS); they go with this file.
 *
 * Retirement: when the template packages cover these lines, `nativeStats` of the whole-index sweep (cards/pipeline.ts) reaches zero hits; then this file
 * and cards/keywords.ts go. Until then removing them would regress real cards.
 */
import type { AbilityDef } from '../types/ability';
import { parseCastRestriction } from '../rules/cast-restriction';
import { parseManaAbilityLine } from '../rules/mana-text';
import { MENTIONS_ENTERS_WITH_COUNTERS, parseEntersWithCounters } from './enters-with';
import { parseKeywordLine } from './keywords';

/** Reminder text (CR 207.2a) removed, as milestone 4 did. */
const stripReminder = (line: string): string => line.replace(/\s*\([^)]*\)/g, '').trim();

/**
 * The abilities the native recognizers make of ONE Oracle line (original text, the face's own name in it), or null when no recognizer understands the
 * whole line. `line` is the line index stored in `src`.
 */
export function nativeLine(text: string, faceName: string, line: number): AbilityDef[] | null {
  const clean = stripReminder(text);
  if (clean === '') return null;
  const src = [line];
  const mana = parseManaAbilityLine(clean, faceName);
  if (mana) return [{ ...mana, src, prov: { by: 'native', id: 'mana-text' } }];
  const restriction = parseCastRestriction(clean);
  if (restriction) return [{ ...restriction, src, prov: { by: 'native', id: 'cast-restriction' } }];
  const entersWith = parseEntersWithCounters(clean, faceName);
  if (entersWith) return [{ ...entersWith, src, prov: { by: 'native', id: 'enters-with' } }];
  const keywords = parseKeywordLine(clean);
  if (keywords && keywords.leftover.length === 0 && keywords.abilities.length > 0) {
    return keywords.abilities.map((k) => ({ ...k, src, prov: { by: 'native', id: `keyword:${k.keyword}` } }));
  }
  return null;
}

/** Milestone 4's flag (core/zones.ts reads it): a manual ability whose text says the permanent enters with counters asks its controller for them. */
export function flagEntersWithCounters(def: AbilityDef): AbilityDef {
  if (def.kind !== 'manual' || def.entersWithCounters === true) return def;
  return MENTIONS_ENTERS_WITH_COUNTERS.test(def.text) ? { ...def, entersWithCounters: true } : def;
}
