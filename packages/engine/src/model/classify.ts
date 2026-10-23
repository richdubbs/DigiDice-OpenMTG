/**
 * Automation classification: the level of every ability and card, manual spans, caps (design 10.3-10.4). Owner: WP1.
 * Contract: model/api.ts#ClassifyCard, #ClassifyAbility, #ManualNodes.
 *
 * Nothing is asserted by hand: the level is computed from the abilities and the engine's capability set. An ability that uses a capability the engine
 * lacks is degraded first (model/degrade.ts, idempotent: the compile pipeline has already done it, so the spans refer to the stored abilities), and the
 * level is then a function of what is left manual (the abilities of a face are degraded together, so the link taint of CR 607.1 is applied):
 *
 *   ability: manual if it is a ManualAbilityDef; full if no node is manual; manual if it has no automated effect content; partial otherwise.
 *            "Automated effect content" is a step, a static effect or a trigger event that is not manual (costs and targets alone do not count: Mindslaver).
 *   card:    full if there are no abilities or every one is full; manual if none is automated at all; partial otherwise; then the caps of design 10.4.
 *
 * Monotone: adding a capability or a template can only move a card up.
 *
 * Unreviewed LLM data is read from the abilities too (`prov.by === 'llm'` without `reviewed`, nested abilities included), not only from the `source` the
 * caller states: a classification is computed, never asserted (design 1.1.17).
 */
import type { AbilityDef } from '../types/ability';
import type { AbilityAutomation, AutomationLevel, CardAutomation, ManualSpan } from '../types/automation';
import type { ClassifyAbility, ClassifyCard, FaceLines, ManualNodes } from './api';
import { degradeAbility } from './degrade';
import { degradeAbilities } from './degrade-card';
import { nestedLists } from './taint';
import { ABILITY_DEFS, walkAbility } from './walk';

type Rec = Record<string, unknown>;
const arr = (x: unknown): Rec[] => (Array.isArray(x) ? (x as Rec[]) : []);
const rec = (x: unknown): Rec => (typeof x === 'object' && x !== null ? (x as Rec) : {});
const EMPTY_LINES: FaceLines = { lines: [], sentences: [] };

const SHAPE_IMPACT: Readonly<Record<string, ManualSpan['impact']>> = {
  spell: 'ability', activated: 'ability', triggered: 'trigger', static: 'static', unknown: 'ability',
};

/** The manual nodes of an ability in document order: a manual ability, step, condition, quantity or cost part (design 10.1). */
export const manualNodes: ManualNodes = (def) => {
  const spans: ManualSpan[] = [];
  walkAbility(def, (n) => {
    const v = n.value;
    const text = typeof v['text'] === 'string' ? v['text'] : '';
    if (n.def === 'ManualAbilityDef') {
      spans.push({ path: n.path, text, reason: String(v['reason']), impact: v['mana'] === true ? 'mana' : (SHAPE_IMPACT[String(v['shape'])] ?? 'ability') });
      return false;
    }
    if (n.def === 'EffectStep' && v['op'] === 'manual') {
      spans.push({ path: n.path, text, reason: typeof v['reason'] === 'string' ? v['reason'] : 'manual', impact: 'step' });
      return false;
    }
    if (n.def === 'Condition' && v['cond'] === 'ask') {
      let top = n;
      while (top.parent !== null && top.parent.def === 'Condition') top = top.parent;
      const restriction = top.parent?.def === 'ActivatedAbilityDef' && top.slot === 'onlyIf';
      spans.push({ path: n.path, text, reason: 'manual condition', impact: restriction ? 'restriction' : 'condition' });
    } else if (n.def === 'Quantity' && v['q'] === 'ask') spans.push({ path: n.path, text, reason: 'manual quantity', impact: 'quantity' });
    else if (n.def === 'CostPart' && v['kind'] === 'manual') spans.push({ path: n.path, text, reason: 'manual cost', impact: 'cost' });
    return undefined;
  });
  return spans;
};

/** A manual node found in a keyword's expansion data. */
export interface KeywordManual { text: string; reason: string }

/** The texts and reasons of the manual nodes in a keyword's expansion data (an `op: manual` step, a manual ability or cost part, an asked condition/quantity). */
export function expansionManuals(x: unknown, out: KeywordManual[] = []): KeywordManual[] {
  if (Array.isArray(x)) {
    for (const y of x) expansionManuals(y, out);
    return out;
  }
  if (typeof x !== 'object' || x === null) return out;
  const v = x as Rec;
  if (v['op'] === 'manual' || v['kind'] === 'manual' || v['cond'] === 'ask' || v['q'] === 'ask') {
    out.push({ text: typeof v['text'] === 'string' ? v['text'] : '', reason: typeof v['reason'] === 'string' ? v['reason'] : 'manual' });
    return out;
  }
  for (const y of Object.values(v)) expansionManuals(y, out);
  return out;
}

/**
 * The manual nodes of each implemented keyword's expansion, by canonical keyword name. Design 5.4: model/ may not import the keyword library, so the
 * capability builder (model/capabilities.ts, the one model module that reads it) installs the table when it loads, the same way it installs the walker's
 * event forms; every caller that classifies against `ENGINE_CAPABILITIES` has loaded it. Frozen copies; installing again replaces the table.
 */
let KEYWORD_MANUALS: ReadonlyMap<string, readonly KeywordManual[]> = new Map();
export function installKeywordManuals(table: Iterable<readonly [string, readonly KeywordManual[]]>): void {
  KEYWORD_MANUALS = new Map([...table].map(([k, v]) => [k, Object.freeze(v.map((m) => Object.freeze({ ...m })))] as const));
}

/**
 * Manual spans contributed by the expansions of the keyword abilities in `def` (M5Z review; design 10.3: a `full` card has no manual node). An implemented
 * keyword expands at run time into the abilities of its data file; a manual node there (ninjutsu's defender step, CR 702.49c) raises a manual prompt in
 * play, so the keyword ability is not full. The span's path is the keyword node's (the manual node itself is in the keyword data, not in the ability JSON),
 * which is why `manualNodes` (JSON pointers into the ability) leaves these out.
 */
function keywordExpansionSpans(def: AbilityDef): ManualSpan[] {
  if (KEYWORD_MANUALS.size === 0) return [];
  const spans: ManualSpan[] = [];
  walkAbility(def, (n) => {
    if (n.def !== 'KeywordAbilityDef') return undefined;
    const name = String(n.value['keyword'] ?? '').trim().toLowerCase();
    for (const m of KEYWORD_MANUALS.get(name) ?? []) spans.push({ path: n.path, text: m.text, reason: `keyword ${name}: ${m.reason}`, impact: 'step' });
    return false;
  });
  return spans;
}

/** Every manual span of an ability: its own manual nodes and those of its keywords' expansions. */
const allManual = (def: AbilityDef): ManualSpan[] => [...manualNodes(def), ...keywordExpansionSpans(def)];

const WRAPPERS: ReadonlySet<unknown> = new Set(['if', 'may', 'forEach', 'repeat', 'delay', 'reflexive']);

/** Is there a step that is neither manual nor a wrapper around manual steps only? */
function stepsHaveAutomation(list: Rec[], path: string): boolean {
  return list.some((s, i) => {
    const op = s['op'];
    if (op === 'manual' || op === 'let') return false;
    if (WRAPPERS.has(op)) return nestedLists(s, `${path}/${i}`).some((l) => stepsHaveAutomation(l.list, l.path));
    return true;
  });
}

function programHasAutomation(prog: Rec | undefined): boolean {
  if (prog === undefined) return false;
  const options = arr(rec(prog['modes'])['options']);
  return options.some((o) => programHasAutomation(rec(o['program']))) || stepsHaveAutomation(arr(prog['steps']), '');
}

function hasAutomation(def: Rec): boolean {
  switch (def['kind']) {
    case 'manual': return false;
    case 'spell': case 'activated': case 'chapter': return programHasAutomation(rec(def['effect']));
    case 'triggered': return def['trigger'] !== undefined; // the trigger event is automated content even if every step is manual
    case 'static': return arr(def['effects']).length > 0;
    case 'keyword': return true;
    case 'classLevel': case 'levelBracket': return arr(def['abilities']).some((a) => abilityLevel(a) !== 'manual');
    case 'case': return true; // M6-6 (CR 719.3a): the "To solve" condition and the solved designation are automated even when the solved ability is manual
    default: return false;
  }
}

function abilityLevel(def: Rec): AutomationLevel {
  if (def['kind'] === 'manual') return 'manual';
  if (allManual(def as unknown as AbilityDef).length === 0) return 'full';
  return hasAutomation(def) ? 'partial' : 'manual';
}

/** Level and spans of one ability, as stored (already degraded). */
function automationOf(def: AbilityDef): AbilityAutomation {
  const manual = allManual(def);
  const level = abilityLevel(def as unknown as Rec);
  return { level, manual };
}

export const classifyAbility: ClassifyAbility = (def, caps) => automationOf(degradeAbility(def, caps, EMPTY_LINES).def);

const cardLevel = (levels: AutomationLevel[]): AutomationLevel => {
  if (levels.length === 0 || levels.every((l) => l === 'full')) return 'full';
  if (levels.every((l) => l === 'manual')) return 'manual';
  return 'partial';
};

/** Capabilities named by "needs-engine: a, b" reasons. */
function requiredBy(reason: string): string[] {
  const m = /needs-engine: ([^;]+)/.exec(reason);
  return m ? m[1]!.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/** Does any ability (or any ability nested in one) come from an LLM and lack review (design 10.4, AbilityBase.prov)? */
function hasUnreviewedLlm(abilities: readonly AbilityDef[]): boolean {
  let found = false;
  for (const a of abilities) {
    walkAbility(a, (n) => {
      if (found) return false;
      const prov = rec(n.value['prov']);
      if (ABILITY_DEFS.has(n.def) && prov['by'] === 'llm' && prov['reviewed'] !== true) found = true;
      return undefined;
    });
  }
  return found;
}

const textLength = (def: AbilityDef): number => (typeof (def as { text?: unknown }).text === 'string' ? (def as { text: string }).text.length : 0);

export const classifyCard: ClassifyCard = (input, caps) => {
  const requires = new Set<string>();
  const faces: { abilities: AbilityAutomation[] }[] = [];
  let total = 0;
  let manualChars = 0;
  const unsupported = new Set<string>();

  for (const face of input.faces) {
    const abilities: AbilityAutomation[] = [];
    const degraded = degradeAbilities(face.abilities, caps, face.lines);
    degraded.requires.forEach((c) => requires.add(c));
    for (const def of degraded.abilities) {
      const size = textLength(def);
      total += size;
      if (input.forceManual) {
        abilities.push({ level: 'manual', manual: [{ path: '', text: (def as { text?: string }).text ?? '', reason: 'forceManual', impact: 'ability' }] });
        manualChars += size;
        continue;
      }
      const a = automationOf(def);
      abilities.push(a);
      for (const s of a.manual) {
        requiredBy(s.reason).forEach((c) => requires.add(c));
        if (s.text !== '') unsupported.add(s.text);
      }
      if (a.level === 'manual') manualChars += size;
      else manualChars += Math.min(size, [...new Set(a.manual.map((s) => s.text))].reduce((n, t) => n + t.length, 0));
    }
    faces.push({ abilities });
  }

  let level: AutomationLevel = input.forceManual ? 'manual' : cardLevel(faces.flatMap((f) => f.abilities.map((a) => a.level)));
  // caps (design 10.4): experimental templates and unreviewed LLM data never make a card more than partial
  if (level === 'full' && (input.experimentalTemplates?.length ?? 0) > 0) level = 'partial';
  const llm = input.source === 'llm-cache' || input.review !== undefined;
  if (level === 'full' && llm && input.review !== 'reviewed') level = 'partial';
  if (level === 'full' && input.review !== 'reviewed' && input.faces.some((f) => hasUnreviewedLlm(f.abilities))) level = 'partial';

  const result: CardAutomation = {
    level,
    faces,
    unsupported: [...unsupported],
    source: input.source,
    autoRatio: total === 0 ? 1 : Math.round(Math.max(0, Math.min(1, (total - manualChars) / total)) * 10000) / 10000,
  };
  if (requires.size > 0) result.requiresEngine = [...requires].sort();
  if (input.review !== undefined) result.review = input.review;
  if (input.textHash !== undefined) result.textHash = input.textHash;
  return result;
};
