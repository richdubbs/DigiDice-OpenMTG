/**
 * The worked examples of the design (docs/design/m5-ability-model.md section 13: 53 cards as JSON) loaded as data. They are the first entries of the
 * golden corpus and the acceptance cards of WP1: every one must validate, round trip through strip / hydrate and canonicalize, and classify as the
 * design says. The JSON is read from the design document itself so there is no second copy to drift.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AbilityDef } from '../../../src/types/ability';

export interface Example {
  name: string;
  /** The classification the design states ("Classification: **full**"), when it states one. */
  classification: string | undefined;
  faces: { abilities: AbilityDef[] }[];
}

const DOC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../docs/design/m5-ability-model.md');

export function loadExamples(): Example[] {
  const text = readFileSync(DOC, 'utf8');
  const start = text.indexOf('## 13. Worked examples');
  const end = text.indexOf('## 14. Milestone 6 hooks');
  if (start < 0 || end < 0) throw new Error('design document sections 13/14 not found');
  const section = text.slice(start, end);
  const out: Example[] = [];
  const parts = section.split(/^#### /m).slice(1);
  for (const part of parts) {
    const name = part.split('\n', 1)[0]!.trim();
    const block = /```json\n([\s\S]*?)\n```/.exec(part);
    if (!block) continue;
    const json = JSON.parse(block[1]!) as { abilities?: AbilityDef[]; faces?: { abilities: AbilityDef[] }[] };
    const classification = /Classification: \*\*(\w+)\*\*/.exec(part)?.[1];
    out.push({ name, classification, faces: json.faces ?? [{ abilities: json.abilities ?? [] }] });
  }
  return out;
}

export const EXAMPLES: Example[] = loadExamples();
