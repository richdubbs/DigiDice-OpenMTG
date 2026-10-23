/**
 * The stored form of an ability (structure without display text) and its hydration from the player's local Oracle lines (design 11.4, 12.3). Owner: WP1.
 *
 * Packs and the LLM cache ship no Oracle text (IP hygiene, updates.md): `stripAbility` removes every display field (`text`, `label`, `span`: of the
 * ability, its target specs, its mode options, its manual nodes), keeping the structure and the `src` / `sentence` indices that say which of the
 * card's lines and sentences each node came from. `hydrateAbility` puts the text back from the lines in the player's own index, and refuses when the
 * hash of that text differs from the hash the entry was made for (an erratum or a new wording must not attach old behavior to new text).
 *
 * What hydration restores: `text` of the ability (its `src` lines joined by "\n"), `span` of a step (its `sentence`), the text of a manual step or an
 * `ask` node (the sentence of the step that holds it, else the ability's text), the text of a manual cost part (the cost words before the first ":" of
 * an activated ability's line, else the whole line). `TargetSpec.text`, the text of a mode option and the text of an ability nested in a node (a granted,
 * token or emblem ability: it has no `src` of its own) are DERIVED by the renderer from the JSON, not stored: hydration leaves them "" for the caller
 * (render/) to fill. `label` (an ability word) is not recoverable and stays absent.
 */
import type { AbilityDef } from '../types/ability';
import type { FaceLines, HydrateAbility, StoredAbility, StripAbility } from './api';
import { defNode, isRecord, pick, ROOT_DEFINITION, unionOf, type Schema } from './schema';
import { schemaIssues, DISPLAY_KEYS } from './validate';
import { textsOf } from './texts';
import { ABILITY_DEFS } from './walk';

type Rec = Record<string, unknown>;

function strip(value: unknown, schema: Schema): unknown {
  const p = pick(unionOf(schema), value);
  if (!p.ok) return structuredClone(value);
  const s = p.leaf.schema;
  if (Array.isArray(value)) return value.map((v) => (s.items === undefined ? structuredClone(v) : strip(v, s.items)));
  if (!isRecord(value)) return value;
  const props = s.properties ?? {};
  const out: Rec = {};
  for (const key of Object.keys(value)) {
    const v = value[key];
    if (v === undefined) continue;
    const ps = props[key];
    if (ps !== undefined && DISPLAY_KEYS.has(key)) continue;
    out[key] = ps === undefined ? structuredClone(v) : strip(v, ps);
  }
  return out;
}

/** Same shape as the ability with every display field removed (see the file header). Pure; the input is not modified. */
export const stripAbility: StripAbility = (def) => strip(def, defNode(ROOT_DEFINITION)) as StoredAbility;

interface Ctx {
  /** The Oracle text of the ability's `src` lines. */
  abilityText: string;
  /** Sentences of those lines, in order (the indexing of StepBase.sentence). */
  sentences: string[];
  /** Sentence of the step being filled. */
  stepText: string | undefined;
  /** Cost words of an activated ability. */
  costText: string;
}

class Unhydratable extends Error {}

function ability(node: Rec, lines: FaceLines, outer: Ctx): Ctx {
  if (!Array.isArray(node['src'])) return outer;
  const t = textsOf(node, lines);
  if (t === null) throw new Unhydratable("a src index is outside the card's lines");
  return { abilityText: t.text, sentences: t.sentences, stepText: undefined, costText: t.costText };
}

function hydrate(value: unknown, schema: Schema, parent: string, slot: string, lines: FaceLines, ctx: Ctx): unknown {
  const p = pick(unionOf(schema), value);
  if (!p.ok) return value;
  const s = p.leaf.schema;
  if (Array.isArray(value)) return value.map((v) => (s.items === undefined ? v : hydrate(v, s.items, parent, slot, lines, ctx)));
  if (!isRecord(value)) return value;
  const names = p.leaf.names;
  const def = names.length > 0 ? names[names.length - 1]! : `${parent}.${slot}`;
  let here = ctx;
  if (ABILITY_DEFS.has(def)) here = ability(value, lines, ctx);
  if (def === 'EffectStep' && typeof value['sentence'] === 'number') {
    const sentence = here.sentences[value['sentence']];
    if (sentence === undefined) throw new Unhydratable(`sentence ${value['sentence']} is outside the ability's sentences`);
    here = { ...here, stepText: sentence };
  } else if (def === 'EffectStep') here = { ...here, stepText: ctx.stepText };

  const props = s.properties ?? {};
  const out: Rec = {};
  for (const key of Object.keys(value)) {
    const v = value[key];
    if (v === undefined) continue;
    const ps = props[key];
    out[key] = ps === undefined ? v : hydrate(v, ps, def, key, lines, here);
  }
  if (props['span'] !== undefined && def === 'EffectStep' && out['span'] === undefined && here.stepText !== undefined) out['span'] = here.stepText;
  if (props['text'] !== undefined && out['text'] === undefined) {
    if (ABILITY_DEFS.has(def)) out['text'] = parent === '' || Array.isArray(value['src']) ? here.abilityText : ''; // a granted or token ability has no line of its own: the renderer fills it
    else if (def === 'CostPart') out['text'] = here.costText;
    else if (def === 'TargetSpec' || def === 'ModeSpec.options') out['text'] = '';
    else out['text'] = here.stepText ?? here.abilityText; // manual step, ask condition, ask quantity
  }
  return out;
}

/**
 * Restore display text from the player's local Oracle lines. Returns null (the caller discards the entry) when the hashes differ, when the stored
 * form is not a valid ability, or when an index points outside the lines.
 */
export const hydrateAbility: HydrateAbility = (stored, lines, expectedHash, actualHash) => {
  if (expectedHash !== actualHash) return null;
  if (schemaIssues(stored, ROOT_DEFINITION, { stored: true }).length > 0) return null;
  try {
    const root: Ctx = { abilityText: '', sentences: [], stepText: undefined, costText: '' };
    return hydrate(stored, defNode(ROOT_DEFINITION), '', '', lines, root) as AbilityDef;
  } catch (e) {
    if (e instanceof Unhydratable) return null;
    throw e;
  }
};
