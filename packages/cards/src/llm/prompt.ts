/**
 * The prompt of the LLM compile step (design 11.2). Two messages: a long, stable, cacheable SYSTEM prompt (rules, the generated JSON schema, a glossary,
 * five canonical examples) and a per-card USER message (normalized lines with indices, what the parser already understood, which lines are needed and
 * the parser's diagnostics, the nearest verified examples). Pure, apart from `loadSchemaText` (reads the checked-in schema file).
 *
 * No `text`, `span`, `label` or `TargetSpec.text` fields are requested: the model gives `src` line indices and the loader hydrates display text from the
 * player's local Oracle text (design 11.2, 11.4), so card text never enters the cache.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LAYERS, OP_HANDLERS, keywordRegistry, stripAbility, type AbilityDef, type OracleCard } from '@openmtg/engine';
import { repoRoot } from '../paths';
import type { FaceView } from './face-lines';
import { EVENT_ROLES } from './event-roles';
import type { CardWork } from './work';

/** Bump when the prompt changes: cache entries are keyed by it (design 11.8). 2: parser "stuck at" diagnostics and the event-role glossary. */
export const PROMPT_VERSION = 2;

/** One worked example: the normalized lines of a face and the stored JSON of its abilities. */
export interface PromptExample {
  typeLine: string;
  lines: string[];
  abilities: unknown[];
}

/** The checked-in JSON schema of the ability model (design 11.3 gate 2: generated from types/ability.ts). */
export function loadSchemaText(file = path.join(repoRoot(), 'packages', 'engine', 'src', 'model', 'schema.generated.json')): string {
  return JSON.stringify(JSON.parse(readFileSync(file, 'utf8')));
}

/** Stored form for a prompt: no display text, no provenance. */
export function promptAbility(def: AbilityDef): unknown {
  const s = stripAbility(def) as Record<string, unknown>;
  delete s['prov'];
  return s;
}

function glossary(): string {
  const ops = Object.keys(OP_HANDLERS).sort().join(', ');
  const kws = keywordRegistry
    .names()
    .map((n) => {
      const k = keywordRegistry.get(n);
      return k && k.params.length > 0 ? `${n}(${k.params.map((p) => `${p.name}:${p.type}${p.optional ? '?' : ''}`).join(', ')})` : n;
    })
    .join(', ');
  const roles = Object.entries(EVENT_ROLES).map(([ev, rs]) => `${ev}: ${rs.length > 0 ? rs.join(', ') : '(none)'}`).join('; ');
  return [
    `Ops (EffectStep.op): ${ops}`,
    `Event roles (EventPattern.ev -> the {"ref":"event","role":...} a trigger's effect may read, CR 603): ${roles}`,
    `Keywords (KeywordAbilityDef.keyword, with parameters): ${kws}`,
    `Layers (ContinuousMod.layer, CR 613): ${LAYERS.join(', ')}`,
  ].join('\n');
}

function exampleText(e: PromptExample): string {
  return [`Type line: ${e.typeLine}`, ...e.lines.map((l, i) => `[${i}] ${JSON.stringify(l)}`), `JSON: ${JSON.stringify({ abilities: e.abilities })}`].join('\n');
}

/** The SYSTEM message: identical for every card of a run (prompt caching). */
export function systemPrompt(schemaText: string, canonical: readonly PromptExample[]): string {
  return `You convert Magic: The Gathering Oracle rules text into the OpenMTG ability model (JSON). Prompt version ${PROMPT_VERSION}.
Output ONLY a JSON object that validates against the schema. Never write card text.
Rules:
 1. Use only the ops, events, statics and refs in the schema. If a sentence needs something the schema cannot say, emit a manual ability for its line
    ({"kind":"manual","shape":"spell|activated|triggered|static|unknown","reason":"...","src":[line]}) or a manual step ({"op":"manual","reason":"..."}). Never approximate.
 2. Represent every word of rules meaning in the sentence (unless, instead, up to, another, each, can't, until, twice, half, ...). If you cannot represent one, emit manual.
 3. Name anaphora explicitly with "as" and {"ref":"bound","name":...}; use "event" roles inside triggers. Ambiguous pronoun: manual.
 4. One TargetSpec per word "target"; ids t0, t1, ... in reading order across the whole ability (modes included).
 5. Every acting player is explicit ("who", "payer", "source", "controller" of a battlefield move).
 6. Every ability has "src": the indices of the face's lines it comes from (one ability per line, or one keyword line as several keyword abilities).
    Steps may carry "sentence": the index of their sentence within the ability's lines. Do NOT write "text", "span", "label" or "prov" fields:
    display text is restored from the player's own card data.
 7. "~" in the lines is the card's own name ({"ref":"self"}).
 8. Answer only the needed lines. Never redo a line the parser already understood.
<SCHEMA>
${schemaText}
</SCHEMA>
<GLOSSARY>
${glossary()}
</GLOSSARY>
<EXAMPLES>
${canonical.map(exampleText).join('\n\n')}
</EXAMPLES>`;
}

const pt = (c: { power?: string; toughness?: string; loyalty?: string; defense?: string }): string =>
  [c.power !== undefined ? `P/T ${c.power}/${c.toughness ?? '?'}` : '', c.loyalty !== undefined ? `loyalty ${c.loyalty}` : '', c.defense !== undefined ? `defense ${c.defense}` : ''].filter((s) => s !== '').join(', ');

function printedFace(card: OracleCard, i: number): { power?: string; toughness?: string; loyalty?: string; defense?: string } {
  const f = card.card_faces?.[i];
  return f ?? (i === 0 ? card : {});
}

/** The USER message for one card (design 11.2). */
export function userPrompt(work: CardWork, views: readonly FaceView[], nearest: readonly PromptExample[]): string {
  const card = work.card;
  const out: string[] = [`Card: ${card.oracle_id}   Layout: ${card.layout}   Faces: ${views.length}`];
  views.forEach((v, i) => {
    const extra = pt(printedFace(card, i));
    out.push('', `Face ${i}: type line ${JSON.stringify(v.typeLine)}${extra ? `; ${extra}` : ''}`);
    v.lines.forEach((l, li) => {
      if (l === '') return;
      const s = v.sentences[li] ?? [];
      out.push(`  [${li}] ${JSON.stringify(l)}${s.length > 1 ? `   sentences: ${s.map((x, k) => `(${k}) ${JSON.stringify(x)}`).join(' ')}` : ''}`);
    });
    const fw = work.faces.find((f) => f.face === i);
    const needed = new Set(fw?.units.flatMap((u) => u.src) ?? []);
    const accepted = (work.def.faces[i]?.abilities ?? []).filter((a) => !(a.src ?? []).some((l) => needed.has(l)) && a.kind !== 'manual');
    if (accepted.length > 0) out.push(`  Already understood by the parser (do not redo): ${JSON.stringify(accepted.map(promptAbility))}`);
    if (fw) {
      out.push(`  Needed: lines ${JSON.stringify(fw.units.map((u) => u.src))}`);
      for (const u of fw.units) {
        const d = u.diagnostics && u.diagnostics.length > 0 ? u.diagnostics : u.reasons;
        out.push(`  Parser diagnostics for ${JSON.stringify(u.src)}: ${d.join(' | ') || 'not understood'}`);
      }
    } else out.push('  Needed: nothing (return an empty abilities list for this face)');
  });
  if (nearest.length > 0) out.push('', 'Verified examples of similar text:', ...nearest.map(exampleText));
  out.push('', `Return: { "faces": [ ${views.map(() => '{ "abilities": [ ... ] }').join(', ')} ], "notes": "..." }  (one entry per face, abilities only for the needed lines)`);
  return out.join('\n');
}

/** The repair message (design 11.3 gate 5: up to two repair attempts with the failing diagnostic). */
export function repairPrompt(gate: string, message: string): string {
  return `Your JSON was rejected by the ${gate} check: ${message}\nFix it and return the whole corrected JSON object only. If the sentence cannot be represented exactly, emit a manual ability for its line.`;
}

const wordSet = (lines: readonly string[]): Set<string> => new Set(lines.join(' ').toLowerCase().split(/[^a-z0-9~+/-]+/).filter((w) => w !== ''));

/** The `n` examples whose text is nearest (word-set Jaccard similarity) to the needed lines; ties by pool order. */
export function nearestExamples(lines: readonly string[], pool: readonly PromptExample[], n = 8): PromptExample[] {
  const mine = wordSet(lines);
  const scored = pool.map((e, i) => {
    const theirs = wordSet(e.lines);
    let inter = 0;
    for (const w of mine) if (theirs.has(w)) inter++;
    const union = mine.size + theirs.size - inter;
    return { e, i, s: union === 0 ? 0 : inter / union };
  });
  return scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, n).map((x) => x.e);
}
