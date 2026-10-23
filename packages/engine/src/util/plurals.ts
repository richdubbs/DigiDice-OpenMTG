/**
 * The printed plural forms of a subtype (moved here from rules/quality.ts by M6-8, unchanged, so statics/text-change.ts can rewrite "protection from Goblins"
 * with the same test rules/quality.ts#hasQuality uses: statics may import util, not rules). Pure data and string functions.
 */

/**
 * Plurals no suffix rule makes (CR 205.3m spells them out only in the singular): "protection from Oxen" is from Ox (WP21 review). A test checks this table
 * against every plural of the generated lexicon (parser/lexicon.generated.json, which the engine may not import).
 */
const IRREGULAR_PLURALS: Readonly<Record<string, string>> = {
  ox: 'oxen', mouse: 'mice', fungus: 'fungi', child: 'children', pegasus: 'pegasi', cyclops: 'cyclopes', homunculus: 'homunculi', cyberman: 'cybermen',
};

/** Printed plural forms a subtype can have ("Elf" -> "elves", "Wizard" -> "wizards", "Elk" -> "elk", "Ox" -> "oxen"). */
export function pluralForms(subtype: string): string[] {
  const s = subtype.toLowerCase();
  const out = [s, `${s}s`, `${s}es`];
  if (s.endsWith('y')) out.push(`${s.slice(0, -1)}ies`);
  if (s.endsWith('f')) out.push(`${s.slice(0, -1)}ves`);
  if (s.endsWith('fe')) out.push(`${s.slice(0, -2)}ves`);
  if (Object.hasOwn(IRREGULAR_PLURALS, s)) out.push(IRREGULAR_PLURALS[s]!); // subtype names are data: not an inherited member
  return out;
}
