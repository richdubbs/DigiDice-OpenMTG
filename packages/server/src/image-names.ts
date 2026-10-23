/**
 * Image file name -> card-name candidates (images.ts). Pure. Players name image files in many ways: "Lightning Bolt.jpg", "lightning_bolt.png",
 * "03 - Lightning Bolt (M10) 146.jpg", "Lightning Bolt [M10].jpg", "m10-146-lightning-bolt.jpg", "Lightning Bolt (1).jpg", "Delver of Secrets - back.png",
 * "Fire__Ice.jpg" (a file name cannot hold "//"), "Lightning Bolt1.full.jpg" (Forge-style packs), "Sol Ring.png.png", "Delver of Secrets (back) (1).jpg".
 * The first candidate is the name with only the folder, the extensions and a ".full" suffix removed; later ones strip more (set codes, collector
 * numbers, numbering, copy markers, variant digits), read a separator as " // ", and last read a front/back marker. A bracketed side word ("(back)",
 * "[front]") is never taken for a set code. Face names written without "//" ("Fire Ice", "Fire-Ice") are matched by images.ts, which knows the cards.
 */

export type Side = 'front' | 'back';

/** One reading of a file name: a card name, and the printed side when the file name marked one. */
export interface NameCandidate {
  name: string;
  side?: Side;
}

const EXTENSION = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif|tiff?|jfif)$/i;
const SIDE = /[\s._-]*[([]?\s*(front|back|face\s*[12]|side\s*[ab12])\s*[)\]]?$/i;

function sideOf(marker: string): Side {
  const m = marker.toLowerCase().replace(/\s+/g, '');
  return m === 'front' || m === 'face1' || m === 'sidea' || m === 'side1' ? 'front' : 'back';
}

const tidy = (s: string): string => s.replace(/\s+/g, ' ').replace(/^[\s._-]+|[\s._-]+$/g, '').trim();

function decode(s: string): string {
  try {
    return /%[0-9a-f]{2}/i.test(s) ? decodeURIComponent(s) : s;
  } catch {
    return s;
  }
}

/** Copy markers: "Name (1)", "Name - Copy", "Name copy 2". */
const uncopy = (s: string): string => s.replace(/\s*\(\d{1,3}\)$/, '').replace(/[\s_-]+copy(\s*\(?\d{1,3}\)?)?$/i, '');

/** A set code or collector number in brackets, never a side word ("(back)", "[Front]", "(face2)") that SIDE reads. */
const SET_CODE = /\s*[([{]\s*(?!(?:front|back|face\s*[12]|side\s*[ab12])\s*[)\]}])[A-Za-z0-9]{2,6}\s*[)\]}](\s+[A-Za-z0-9★-]{1,8})?(\s*\*[A-Za-z]+\*)?$/i;

function stripSetCodes(s: string): string {
  let out = s;
  // "Name [M10] {146}": up to three bracketed groups, innermost last
  for (let i = 0; i < 3; i++) {
    const next = out.replace(SET_CODE, '').replace(/\s*#\s*\d{1,4}[a-z]?$/i, '');
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Stripping steps, applied cumulatively; each result that changed the name is a further candidate. */
const STEPS: readonly ((s: string) => string)[] = [
  uncopy,
  // set code and collector number: "Name (M10) 146", "Name [M10]", "Name {M10}", "Name [M10] {146}", "Name #146"
  stripSetCodes,
  // leading numbering: "03 - Name", "1. Name", "001_Name"
  (s) => s.replace(/^\d{1,4}\s*[-.)]\s*/, '').replace(/^\d{1,4}\s+(?=\D)/, ''),
  // leading "set-number-" of downloaded files: "m10-146-lightning-bolt", "m10 146 lightning bolt"
  (s) => s.replace(/^[a-z0-9]{2,6}[\s-]+\d{1,4}[a-z]?[\s-]+(?=\D)/i, ''),
  // trailing collector number: "Name 146"
  (s) => s.replace(/\s+\d{1,4}[a-z]?$/i, ''),
  // variant digits glued to the name: "Mountain1", "Lightning Bolt2"
  (s) => s.replace(/(?<=\p{L})\d{1,2}$/u, ''),
];

/** The file's base name: folder, every image extension ("Sol Ring.png.png") and a Forge-style ".full" suffix with its variant digits removed. */
function baseName(fileName: string): string {
  let base = decode(fileName.replace(/^.*[\\/]/, ''));
  while (EXTENSION.test(base)) base = base.replace(EXTENSION, '');
  return base.replace(/\d{0,2}\.full$/i, '');
}

/** The readings of one base name (no folder, no extension), most literal first. */
function readings(base: string): string[] {
  const names: string[] = [];
  const push = (s: string): void => {
    const t = tidy(s);
    if (t && !names.includes(t)) names.push(t);
  };
  push(base);
  // Underscores as spaces; a double underscore as the "//" a file name cannot hold.
  let current = base.replace(/__+/g, ' // ').replace(/_/g, ' ');
  push(current);
  for (const step of STEPS) {
    current = tidy(step(current));
    push(current);
  }
  for (const n of [...names]) if (/\s-\s/.test(n) && !n.includes('//')) push(n.replace(/\s-\s/, ' // '));
  return names;
}

/**
 * Card-name readings of a file name, most literal first. A front/back marker ("- back", "(front)", "face 2") is read only after the name with the marker
 * kept, so a card whose name ends in such a word still matches itself.
 */
export function nameCandidates(fileName: string): NameCandidate[] {
  const base = baseName(fileName);
  const out: NameCandidate[] = readings(base).map((name) => ({ name }));
  // The marker may sit before a copy marker: "Delver of Secrets (back) (1)", "Name [back] - Copy".
  const marked = [base, tidy(uncopy(base))].map((b) => ({ b, m: SIDE.exec(b) })).find((x) => x.m && x.m.index > 0);
  if (marked) {
    const side = sideOf(marked.m![1]!);
    for (const name of readings(marked.b.slice(0, marked.m!.index))) out.push({ name, side });
  }
  return out;
}

/** 1 - Levenshtein distance / longer length (1 = same text). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur.push(Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = cur;
  }
  return 1 - prev[b.length]! / Math.max(a.length, b.length);
}
