/**
 * Cleave (CR 702.148a; edh-next-100, Wash Away, Dig Up, Alchemist's Retrieval, Winged Portent, Fierce Retribution, Path of Peril): "You may cast this spell for its cleave
 * cost. If you do, remove the words in square brackets." The card prints ONE text with bracketed words; the spell is read twice:
 *   - as it is cast for its mana cost: the text with the brackets taken away and their words kept ("Destroy target attacking creature."),
 *   - as it is cast for its cleave cost: the text without the bracketed words ("Destroy target creature.").
 * Both texts are parsed by the ordinary chart (with the cleave keyword line in both). The spell ability of the first keeps its effect and gains the second's as `cleave`
 * (types/ability.ts#SpellAbilityDef.cleave), its `text` the printed words with the brackets; anything that doesn't line up (a line one of the readings leaves manual, a
 * different number or kind of abilities) leaves the card as the plain parse of the printed text (manual for the bracketed lines): fail closed. Pure.
 */
import type { AbilityDef, SpellAbilityDef } from '../types/ability';
import type { OracleCard } from '../types/card';
import type { FaceParse, ParseResult } from './types';

const CLEAVE_LINE = /^cleave \{/im;

/** The two readings of a single-faced card with a cleave line and bracketed words, or null. */
export function cleaveCards(card: OracleCard): { n: OracleCard; c: OracleCard } | null {
  if (card === null || typeof card !== 'object' || typeof card.oracle_text !== 'string') return null;
  if (card.layout !== undefined && card.layout !== 'normal') return null;
  const text = card.oracle_text;
  if (!CLEAVE_LINE.test(text) || !/\[[^\]\n]+\]/.test(text)) return null;
  const n = text.replace(/\[([^\]\n]*)\]/g, '$1');
  const c = text.replace(/ ?\[[^\]\n]*\]/g, '').replace(/ {2,}/g, ' ');
  return { n: { ...card, oracle_text: n }, c: { ...card, oracle_text: c } };
}

const noManual = (x: unknown): boolean => {
  const s = JSON.stringify(x);
  return !s.includes('"op":"manual"') && !s.includes('"kind":"manual"') && !s.includes('"cond":"ask"') && !s.includes('"q":"ask"');
};

/** The printed lines of the card (reminder text taken out), the ones with brackets keep them. */
const printedLines = (card: OracleCard): string[] => (card.oracle_text ?? '').split('\n').map((l) => l.replace(/\s*\([^)]*\)\s*$/, '').trim());

/**
 * Merge: `plain` is the parse of the printed text (brackets in it), `n` and `c` the parses of the two readings. Returns the face parse of the card with the cleaved spell
 * abilities, or `plain` when they don't line up.
 */
export function mergeCleave(card: OracleCard, plain: ParseResult, n: ParseResult, c: ParseResult): ParseResult {
  const pf = plain.faces[0];
  const nf: FaceParse | undefined = n.faces[0];
  const cf: FaceParse | undefined = c.faces[0];
  if (plain.faces.length !== 1 || nf === undefined || cf === undefined || pf === undefined) return plain;
  if (nf.abilities.length !== cf.abilities.length) return plain;
  const lines = printedLines(card);
  const merged: AbilityDef[] = [];
  let changed = 0;
  for (let k = 0; k < nf.abilities.length; k++) {
    const a = nf.abilities[k]!;
    const b = cf.abilities[k]!;
    if (a.kind !== 'spell' || b.kind !== 'spell' || JSON.stringify(a.src) !== JSON.stringify(b.src)) {
      // a line without brackets is the same in both readings: it must also be the plain parse's (not manual in one of them)
      if (JSON.stringify(a) !== JSON.stringify(b)) return plain; // two spell abilities of different lines, or any difference outside a spell ability: fail closed
      merged.push(a);
      continue;
    }
    if (!noManual(a) || !noManual(b)) return plain;
    const src = a.src ?? [];
    const own = src.map((i) => lines[i]).filter((l): l is string => l !== undefined);
    if (own.length !== src.length || !own.some((l) => l.includes('['))) { merged.push(a); continue; }
    // the printed words must be the first reading's words with the brackets put back (nothing else differs)
    if (own.map((l) => l.replace(/\[([^\]]*)\]/g, '$1')).join('\n') !== a.text) return plain;
    const out: SpellAbilityDef = { ...(a as SpellAbilityDef), text: own.join('\n'), cleave: (b as SpellAbilityDef).effect };
    merged.push(out);
    changed++;
  }
  if (changed === 0) return plain;
  // the ledger of the first reading is over the text without brackets: map its ranges onto the printed text (the brackets join the entry next to them), so the entries tile the printed
  // text as the plain parse's do
  const printed = card.oracle_text ?? '';
  const at: number[] = [];
  for (let i = 0; i < printed.length; i++) if (printed[i] !== '[' && printed[i] !== ']') at.push(i);
  const ledger = nf.ledger.map((e) => {
    if (at.length === 0 || e.range[1] <= e.range[0]) return e;
    let s = at[Math.min(e.range[0], at.length - 1)]!;
    let t = (at[Math.min(e.range[1] - 1, at.length - 1)] ?? s) + 1;
    while (s > 0 && printed[s - 1] === '[') s--;
    while (t < printed.length && printed[t] === ']') t++;
    return { ...e, range: [s, t] as [number, number] };
  });
  const face: FaceParse = { ...nf, abilities: merged, ledger };
  return { ...n, faces: [face] };
}
