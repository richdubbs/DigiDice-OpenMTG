/**
 * Card-name normalization for lookups. Two levels, because Scryfall ignores punctuation when it
 * matches names (docs/research/scryfall-api.md section 5) but two real cards differ only by a comma
 * ("Glimpse the Unthinkable" and "Glimpse, the Unthinkable"):
 *
 *  - normalizeName (strict): case-insensitive, whitespace collapsed, diacritics folded, typographic
 *    quotes and dashes unified, U+A789 (the colon look-alike in "Ratonhnhaké꞉ton") folded to ":",
 *    and " // " spacing canonical. Exact names always resolve through this level first.
 *  - looseName: strict plus apostrophes and commas dropped and hyphens treated as spaces
 *    ("Smugglers Copter" == "Smuggler's Copter", "Urzas Tower" == "Urza's Tower"). Used as the fallback
 *    for the local index and as the key for caches and for matching Scryfall's answers.
 */
export function normalizeName(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ß/g, 'ss')
    .replace(/\ua789/g, ':')
    .replace(/[\u2018\u2019\u02bc`\u00b4]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ ?\/\/ ?/g, ' // ');
}

/** Punctuation-insensitive key: strict form without apostrophes and commas, hyphens as spaces. */
export function looseName(input: string): string {
  return normalizeName(input).replace(/[',]/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

function slashVariants(key: string): string[] {
  const out = [key];
  if (key.includes('/') && !key.includes('//')) out.push(key.replace(/\s*\/\s*/g, ' // '));
  return out;
}

/** Strict keys to try for a typed name: "Fire/Ice" and "Fire / Ice" also mean "Fire // Ice". */
export function nameKeyVariants(input: string): string[] {
  return slashVariants(normalizeName(input));
}

/** Loose keys to try for a typed name (same slash variants). */
export function looseKeyVariants(input: string): string[] {
  return slashVariants(looseName(input));
}

/**
 * The one key a name is stored under in caches: the loose form of the last slash variant, so that
 * "Foo/Bar", "Foo / Bar" and "Foo // Bar" (and "Smugglers Copter" / "Smuggler's Copter") share an entry.
 */
export function canonicalKey(input: string): string {
  const variants = looseKeyVariants(input);
  return variants[variants.length - 1]!;
}

/** The name to send to Scryfall for a typed name (single slashes become " // "). */
export function requestName(input: string): string {
  const clean = input.replace(/\s+/g, ' ').trim();
  return clean.includes('/') && !clean.includes('//') ? clean.replace(/\s*\/\s*/g, ' // ') : clean;
}
