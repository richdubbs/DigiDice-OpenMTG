/**
 * Schema validation of ability JSON plus the entry points that add the semantic lint and the card-wide checks (design 2.3, 10.1, 11.3). Owner: WP1.
 * Contract: model/api.ts#ValidateAbility, #ValidateCardAbilities.
 *
 * The schema half is a small validator over the generated JSON Schema (model/schema.generated.json) with no dependency: unions are resolved by their
 * discriminator (model/schema.ts), so the message for a wrong op is "unknown op "frobnicate"" at the step's path, not "does not match any of 57
 * alternatives". A value is reported at the deepest path that is wrong.
 */
import type { Issue, ValidateAbility, ValidateCardAbilities } from './api';
import { lintAbility } from './lint';
import { lintCard } from './lint-card';
import { defNode, describe, isRecord, knownTags, pick, ROOT_DEFINITION, unionOf, type Schema } from './schema';
import { seg } from './walk';

/** Fields that are display data (design 2.1.8): optional in the stored form of packs and caches (model/strip.ts). */
export const DISPLAY_KEYS: ReadonlySet<string> = new Set(['text', 'span', 'label']);

export interface SchemaOptions {
  /** The stored form: display fields may be absent. */
  stored?: boolean;
  /** Pointer prefix for the reported paths. */
  basePath?: string;
}

const short = (v: unknown): string => {
  const s = JSON.stringify(v);
  return s === undefined ? 'undefined' : s.length > 60 ? `${s.slice(0, 57)}...` : s;
};

function distance(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

function suggestion(tag: unknown, known: unknown[]): string {
  if (typeof tag !== 'string') return '';
  const best = known.filter((k): k is string => typeof k === 'string').map((k) => [k, distance(tag, k)] as const).sort((a, b) => a[1] - b[1])[0];
  return best !== undefined && best[1] <= 2 ? `; did you mean "${best[0]}"?` : '';
}

function check(value: unknown, schema: Schema, path: string, out: Issue[], opts: SchemaOptions): void {
  if (value === undefined) return;
  const u = unionOf(schema);
  const p = pick(u, value);
  if (!p.ok) {
    if (p.reason === 'missing-tag') out.push({ path, code: 'schema', severity: 'error', message: `missing "${p.tagKey}" (expected ${describe(u)})` });
    else if (p.reason === 'unknown-tag') {
      out.push({ path, code: 'schema', severity: 'error', message: `unknown ${p.tagKey} ${short(p.tag)}${suggestion(p.tag, knownTags(u))}` });
    } else out.push({ path, code: 'schema', severity: 'error', message: `expected ${describe(u)}, got ${short(value)}` });
    return;
  }
  const s = p.leaf.schema;
  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems) out.push({ path, code: 'schema', severity: 'error', message: `needs at least ${s.minItems} items` });
    if (s.maxItems !== undefined && value.length > s.maxItems) out.push({ path, code: 'schema', severity: 'error', message: `allows at most ${s.maxItems} items` });
    for (let i = 0; i < value.length; i++) {
      if (value[i] === undefined) out.push({ path: `${path}/${i}`, code: 'schema', severity: 'error', message: 'an array element is missing (JSON has no holes)' });
      else if (s.items !== undefined) check(value[i], s.items, `${path}/${i}`, out, opts);
    }
    return;
  }
  if (!isRecord(value)) return;
  const props = s.properties ?? {};
  for (const r of s.required ?? []) {
    if (value[r] === undefined && !(opts.stored && DISPLAY_KEYS.has(r))) {
      out.push({ path: `${path}/${seg(r)}`, code: 'schema', severity: 'error', message: `missing required property "${r}"` });
    }
  }
  for (const key of Object.keys(value)) {
    const v = value[key];
    if (v === undefined) continue;
    const ps = props[key];
    if (ps === undefined) {
      if (s.additionalProperties === false) out.push({ path: `${path}/${seg(key)}`, code: 'schema', severity: 'error', message: `unexpected property "${key}"` });
      continue;
    }
    if (ps.not !== undefined) {
      out.push({ path: `${path}/${seg(key)}`, code: 'schema', severity: 'error', message: `property "${key}" is not allowed here` });
      continue;
    }
    check(v, ps, `${path}/${seg(key)}`, out, opts);
  }
}

/** Issues of `value` against the model type named `defName` (default AbilityDef). Pure; no lint. */
export function schemaIssues(value: unknown, defName: string = ROOT_DEFINITION, opts: SchemaOptions = {}): Issue[] {
  const out: Issue[] = [];
  check(value, defNode(defName), opts.basePath ?? '', out, opts);
  return out;
}

/** Schema + lint for one ability. Pure. A schema error stops the lint: the lint assumes a well-formed tree. */
export const validateAbility: ValidateAbility = (def, ctx) => {
  const schema = schemaIssues(def);
  if (schema.length > 0) return schema;
  return lintAbility(def, ctx);
};

/** Validate the stored form of an ability (no display text, design 12.3): the schema with display fields optional, then the lint. */
export function validateStoredAbility(stored: unknown, ctx?: Parameters<ValidateAbility>[1]): Issue[] {
  const schema = schemaIssues(stored, ROOT_DEFINITION, { stored: true });
  if (schema.length > 0) return schema;
  return lintAbility(stored as Parameters<ValidateAbility>[0], ctx);
}

/** Card-wide checks: link producers and consumers across abilities, duplicate keywords, face structure (model/lint-card.ts). */
export const validateCardAbilities: ValidateCardAbilities = (faces) => lintCard(faces);
