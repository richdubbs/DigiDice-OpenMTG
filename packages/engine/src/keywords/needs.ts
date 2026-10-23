/**
 * What a keyword's data needs from the engine: the capability names (design 5.2) of everything its `expand` template and its `modifies` record use.
 * Pure; reads the JSON only. Owner: WP3.
 *
 * Why this exists. `keyword:<name>` is advertised for a keyword whose data is complete, but an expansion is only as good as the ops, events, conditions,
 * quantities and cost parts it is written with. A keyword that expands into `{op:'pay'}` while the engine has no `op:pay` must not read as supported: the card
 * would be classified `full` and the trigger would never fire. `keywordCapabilities` (capabilities.ts) therefore advertises an expansion keyword only when
 * every name returned here is in the engine's capability set.
 *
 * This is a deliberately small, data-only walker over the keyword JSON. WP1's `capabilitiesOf` is the general walker over typed abilities; when it exists it
 * can replace this function (`capabilitiesOf` of each expanded ability), and the tests of this file stay valid as the specification of the names.
 * The discriminators read:
 *   {op} in a step list -> op:<op> (an `action` step -> action:<name>, its macro is a capability of its own)   {ev} ev:   {cond} cond:   {q} q:   {ref} ref:
 *   {s} static:   {b} body:   {d} dur:   {layer} layer:   cost part {kind} in a cost's `other` -> cost:<kind> (+ its value forms)   target spec {kind} -> target:<kind>
 *   fields of an ObjectFilter -> filter:<field> (+ its value forms)   activated/mode value forms -> feature:...
 *   zoneChange {cause} -> feature:replace.cause in a replacement's `replaces` (effects/replacements.ts#matchProposed compares it), feature:ev.cause anywhere
 *   else (the trigger matcher does not compare it: unregistered, fail closed). M6-5a, m6 design D12 (was one name, feature:event.cause).
 */
import type { ActivatedAbilityDef, CostPart, EffectStep, ModeSpec, ObjectFilter, TargetSpec } from '../types/ability';
import { capabilitiesOfDef } from '../model/cap-walk';
import { activatedForms, costPartForms, filterForms, modeSpecForms, targetSpecForms } from '../model/forms';
import { eventPatternNames, replaceOnName } from '../model/cap-walk';
import type { ActionMacro, KeywordDefData } from './types';

/** Keys whose array values are lists of effect steps. */
const STEP_LISTS = new Set(['steps', 'then', 'else', 'do']);
/** Keys whose object value is an ObjectFilter (or a ref, which has a discriminator and is skipped). */
const FILTER_KEYS = new Set(['filter', 'subject', 'spell', 'spells', 'object', 'attacker', 'blocker', 'source', 'by']);

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isDiscriminated = (o: Record<string, unknown>): boolean => 'ref' in o || 'q' in o || 'cond' in o || 'ev' in o;

function addFilter(f: Record<string, unknown>, out: Set<string>): void {
  for (const field of Object.keys(f)) {
    const v = f[field];
    if (field === 'anyOf' && Array.isArray(v)) {
      for (const g of v) if (isObj(g)) addFilter(g, out);
    } else if (field === 'not' && isObj(v)) {
      addFilter(v, out);
    } else {
      out.add(`filter:${field}`);
    }
  }
  for (const form of filterForms(f as ObjectFilter)) out.add(form);
}

function walk(node: unknown, key: string | undefined, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      if (isObj(item) && key !== undefined) visitListItem(item, key, out);
      walk(item, key, out);
    }
    return;
  }
  if (!isObj(node)) return;

  // The placeholder constructs of keywords/expand.ts: both branches of $ifParam are walked, the cost parts of $costAdd are cost parts.
  if ('$ifParam' in node) {
    walk(node['then'], key, out);
    walk(node['else'], key, out);
    return;
  }
  if ('$costAdd' in node) {
    const spec = node['$costAdd'];
    if (isObj(spec)) walk(spec['other'], 'other', out);
    return;
  }
  // FAST5X E1: every branch of $byQuality and of $ifTypes
  if ('$byQuality' in node) {
    const table = node['$byQuality'];
    if (isObj(table)) for (const v of Object.values(table)) walk(v, key, out);
    return;
  }
  if ('$ifTypes' in node) {
    walk(node['then'], key, out);
    walk(node['else'], key, out);
    return;
  }

  if (typeof node['ev'] === 'string') {
    // M6-0 (m6 design D2): a replacement's `replaces` needs `feature:replace.on.<ev>[.<verb>]` (the proposal kinds), every other pattern `ev:<ev>`
    out.add(key === 'replaces' ? replaceOnName(node) : `ev:${node['ev']}`);
    // the finer event forms (triggers/forms.ts through model/cap-walk.ts; W2 merge: ward's "becomes the target"); Cloud r3-repl: not for a replaced mill or connive (their proposals)
    if (!(key === 'replaces' && node['ev'] === 'action' && (node['verb'] === 'mill' || node['verb'] === 'connive'))) for (const f of eventPatternNames(node)) out.add(f);
    if (node['ev'] === 'zoneChange' && node['cause'] !== undefined) out.add(key === 'replaces' ? 'feature:replace.cause' : 'feature:ev.cause');
    if (node['byEffect'] === true) out.add(key === 'replaces' ? 'feature:replace.byEffect' : 'feature:ev.byEffect'); // M6-0, CR 614.16
    if (node['byOpponent'] === true) out.add(key === 'replaces' ? 'feature:replace.byOpponent' : 'feature:ev.byOpponent'); // FAST5 T36, CR 701.9a
    if (key === 'replaces' && node['ev'] === 'createToken' && node['token'] !== undefined) out.add('feature:replace.createToken.token'); // Cloud r3-repl, CR 111.1
    if (node['ev'] === 'draw' && node['exceptFirstInDrawStep'] !== undefined) out.add(key === 'replaces' ? 'feature:replace.draw.exceptFirstInDrawStep' : 'feature:ev.draw.exceptFirstInDrawStep'); // Cloud r5-repl, CR 504.1
  }
  if (typeof node['cond'] === 'string') out.add(`cond:${node['cond']}`);
  if (typeof node['q'] === 'string') out.add(`q:${node['q']}`);
  if (typeof node['ref'] === 'string') out.add(`ref:${node['ref']}`);
  if (typeof node['s'] === 'string') out.add(`static:${node['s']}`);
  if (typeof node['b'] === 'string') out.add(`body:${node['b']}`);
  if (typeof node['d'] === 'string') out.add(`dur:${node['d']}`);
  if (node['layer'] !== undefined && key === 'mods') out.add(`layer:${String(node['layer'])}`);
  if (node['kind'] === 'activated' && 'effect' in node) for (const f of activatedForms(node as unknown as ActivatedAbilityDef)) out.add(f);
  if (key === 'modes') for (const f of modeSpecForms(node as unknown as ModeSpec)) out.add(f);
  if (key !== undefined && FILTER_KEYS.has(key) && !isDiscriminated(node) && !('op' in node) && !('s' in node)) addFilter(node, out);

  for (const [k, v] of Object.entries(node)) walk(v, k, out);
}

/** An element of an array found under `key`: a step, a cost part or a target spec. */
function visitListItem(item: Record<string, unknown>, key: string, out: Set<string>): void {
  if (STEP_LISTS.has(key) && typeof item['op'] === 'string') {
    if (item['op'] === 'action') out.add(`action:${String(item['action'])}`);
    else out.add(`op:${item['op']}`);
  } else if (key === 'other' && typeof item['kind'] === 'string') {
    out.add(`cost:${item['kind']}`);
    for (const f of costPartForms(item as unknown as CostPart)) out.add(f);
  } else if (key === 'targets' && typeof item['kind'] === 'string') {
    out.add(`target:${item['kind']}`);
    for (const f of targetSpecForms(item as unknown as TargetSpec)) out.add(f);
  }
}

/**
 * M6-12: the expansion templates with the placeholder constructs of keywords/expand.ts made plain, so the general walker can read them: an `$ifParam` becomes
 * its `then` branch (`withThen`) or its `else` branch, a `$costAdd` its added cost parts, an `$ordinal` its base name. Whole-string placeholders ("$cost")
 * stay strings (the walker reads no capability from a string).
 */
function plain(node: unknown, withThen: boolean, quality?: string): unknown {
  if (Array.isArray(node)) return node.map((x) => plain(x, withThen, quality)).filter((x) => x !== undefined);
  if (!isObj(node)) return node;
  if ('$ifParam' in node) return plain(withThen ? node['then'] : node['else'], withThen, quality);
  // FAST5X E1: $ifTypes reads withThen too; $byQuality is the branch of `quality` (expansionNeeds tries every branch)
  if ('$ifTypes' in node) return plain(withThen ? node['then'] : node['else'], withThen, quality);
  if ('$byQuality' in node) {
    const table = isObj(node['$byQuality']) ? node['$byQuality'] : {};
    return plain(quality !== undefined ? table[quality] : Object.values(table)[0], withThen, quality);
  }
  if ('$costAdd' in node) {
    const spec = node['$costAdd'];
    return { other: isObj(spec) ? plain(spec['other'] ?? [], withThen) : [] };
  }
  if ('$ordinal' in node) return node['$ordinal'];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    const r = plain(v, withThen, quality);
    if (r !== undefined) out[k] = r;
  }
  return out;
}

/** FAST5X E1: the qualities named by the $byQuality tables of an expansion (gift: "a card", "a Food", ...). */
function byQualityKeys(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) for (const x of node) byQualityKeys(x, out);
  else if (isObj(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$byQuality' && isObj(v)) for (const q of Object.keys(v)) out.add(q);
      byQualityKeys(v, out);
    }
  }
  return out;
}

/** The capability names the data of `data` (expansion and modifier) needs, sorted, without duplicates. A keyword without expansion needs nothing. */
export function expansionNeeds(data: KeywordDefData): string[] {
  const out = new Set<string>();
  if (data.expand !== undefined) walk(data.expand, undefined, out);
  // M6-12: and every name WP1's general walker gives each generated ability, which includes the value forms of steps and bodies the data-only walk above
  // does not see (`op:cast.costChange`, `op:copy.except`, `body:modify.then`): a keyword whose expansion uses a form the engine resolves by hand is not
  // advertised (design 5.2)
  const qualities = [...byQualityKeys(data.expand)];
  for (const t of data.expand ?? []) {
    for (const withThen of [true, false]) {
      for (const q of qualities.length > 0 ? qualities : [undefined]) {
        const p = plain(t, withThen, q);
        if (p !== undefined) for (const c of capabilitiesOfDef(p)) out.add(c);
      }
    }
  }
  const m = data.modifies;
  if (m !== undefined) {
    if (m.kind === 'activated') {
      for (const f of activatedForms({ ...m, kind: 'activated' } as unknown as ActivatedAbilityDef)) out.add(f);
      walk(m.onlyIf, undefined, out);
    } else if (m.kind === 'grant') {
      walk(m.while, undefined, out); // FAST5X-4 (CR 702.178a): the condition the granted ability is had under
    } else {
      out.add('feature:modes.override');
      walk(m.chooseAll.when, undefined, out);
    }
  }
  return [...out].sort();
}

type ActionStep = Extract<EffectStep, { op: 'action' }>;

/** Representative steps of an action (one with every parameter, one with none): together they reach every branch of a macro that is not a manual fallback. */
const representatives = (name: ActionStep['action']): ActionStep[] => [
  { op: 'action', action: name, who: { ref: 'you' }, subject: { ref: 'target', id: 't0' }, n: 1, arg: '+1/+1' },
  { op: 'action', action: name, who: { ref: 'you' } },
  // FAST5 MX6: an action whose `arg` is a word of its own ("empower Jace 2": a planeswalker type) is expanded with each word its macro knows too
  ...(ARG_WORDS[name] ?? []).map((arg): ActionStep => ({ op: 'action', action: name, who: { ref: 'you' }, subject: { ref: 'target', id: 't0' }, n: 1, arg })),
];

/** FAST5 MX6: the `arg` words an action macro expands into steps (any other word is a manual step): keywords/actions/bending.ts#EMPOWER. */
const ARG_WORDS: Partial<Record<ActionStep['action'], readonly string[]>> = { empower: ['Jace'] };

/**
 * The capability names a CR 701 action macro's expansion needs (WP15 INTERFACE CHANGE, from the review of `op:action`): WP1's general walker
 * (model/cap-walk.ts `capabilitiesOfDef`) over what the macro expands representative steps into. `action:<name>` is advertised only when all of them exist
 * (capabilities.ts), so a card with the action is never `full` while the steps it runs would go to a manual prompt or have no handler. A macro without `expand`
 * (a native action) needs `feature:action.native.<name>`, which nothing registers.
 */
export function actionNeeds(macro: ActionMacro): string[] {
  if (macro.expand === undefined) return [`feature:action.native.${macro.name}`];
  const out = new Set<string>();
  for (const step of representatives(macro.name)) {
    for (const c of capabilitiesOfDef({ kind: 'spell', text: '', effect: { targets: [], steps: macro.expand(step) } })) out.add(c);
  }
  return [...out].sort();
}
