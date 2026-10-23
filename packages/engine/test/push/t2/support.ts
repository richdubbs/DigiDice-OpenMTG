/**
 * Helpers for the PUSH1 T2 tests: the templates of parser/templates/zz-push/t2.json, parsed on the game path (every committed template, the default
 * compiler's set), and synthetic cards (design 6.10: invented names and wordings).
 */
import type { AbilityDef } from '../../../src/types/ability';
import type { OracleCard } from '../../../src/types/card';
import type { FaceParse, Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import t2 from '../../../src/parser/templates/zz-push/t2.json';

export const T2_TEMPLATES: readonly Template[] = Object.freeze(t2 as Template[]);

const OPTS = defaultParseOptions();

/** A synthetic card for a sentence: an artifact creature for an activated ability, a creature for a trigger, an instant otherwise. */
export function sentenceCard(text: string, typeLine?: string): OracleCard {
  const type = typeLine ?? (/^(when|whenever|at)\b/i.test(text) ? 'Creature — Spirit' : /^[^"]*:/.test(text) ? 'Artifact Creature — Golem' : 'Instant');
  const creature = type.includes('Creature');
  return { name: 'Example Wisp', layout: 'normal', type_line: type, oracle_text: text, mana_cost: '{2}', ...(creature ? { power: '2', toughness: '2' } : {}) } as OracleCard;
}

/** The first face of the game-path parse of a sentence. */
export function parsed(text: string, typeLine?: string): FaceParse {
  return parseCard(sentenceCard(text, typeLine), OPTS).faces[0]!;
}

/** Every ability is automated: no manual ability, no manual step anywhere. */
export const automated = (defs: readonly AbilityDef[]): boolean => defs.length > 0 && defs.every((a) => a.kind !== 'manual') && !JSON.stringify(defs).includes('"op":"manual"');

/** A fully automated parse: automated abilities and every render gate passed. */
export const fullyAutomated = (f: FaceParse): boolean => automated(f.abilities) && f.gate.every((g) => g.ok);

type Rec = Record<string, unknown>;

/** Canonical comparison key of a parse, without the display text. */
export function jsonKey(defs: readonly AbilityDef[]): string {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v === null || typeof v !== 'object') return v;
    const out: Rec = {};
    for (const k of Object.keys(v as Rec).sort()) if (k !== 'src' && k !== 'prov' && k !== 'text') out[k] = strip((v as Rec)[k]);
    return out;
  };
  return JSON.stringify(defs.map(strip));
}
