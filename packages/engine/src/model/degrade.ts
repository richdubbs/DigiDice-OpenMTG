/**
 * The degrade pass: the only place an understood node becomes manual because of the engine's capability set (design 10.2). Owner: WP1.
 * Contract: model/api.ts#DegradeAbility.
 *
 * `missingCapabilities(def, caps)` names what this engine build lacks; each missing capability is attributed to the SMALLEST enclosing unit:
 *
 *   a step (its op, a quantity, condition, filter field, reference, duration or destination)  -> {op:'manual'}      (then taint, model/taint.ts)
 *   a cost part                                                                               -> {kind:'manual'} cost part
 *   a target spec, a mode count, a trigger event, an intervening if, a static effect or
 *   condition, an activation restriction, a keyword, a chapter or a class level              -> the whole ability becomes a ManualAbilityDef
 *                                                                                                 (the understood cost, and for an activated or
 *                                                                                                 triggered ability the understood effect, are kept)
 *
 * Pure and idempotent: the pass is repeated until the result has no missing capability (a manual ability that keeps an unavailable cost part or
 * reminder is degraded once more; a final check falls back to a plain manual ability), so degrading it again changes nothing. A pack or cache entry made by a newer build therefore plays more manually on an older one, and fully on the
 * day the engine gains the capability (design 10.2).
 */
import type { AbilityDef } from '../types/ability';
import type { DegradeAbility, DegradeResult, FaceLines } from './api';
import { capabilityUses } from './cap-walk';
import { getAt, isInside, setAt } from './pointer';
import { modifierWord, poisonedSteps } from './taint';
import { textsOf, type AbilityTexts } from './texts';
import { ABILITY_DEFS, ancestors, walkAbility, walkValue, type WalkNode } from './walk';

type Rec = Record<string, unknown>;
const rec = (x: unknown): Rec => (typeof x === 'object' && x !== null ? (x as Rec) : {});
const arr = (x: unknown): Rec[] => (Array.isArray(x) ? (x as Rec[]) : []);

/** Why a node is manual: a capability the engine lacks, or taint from another manual node (model/taint.ts, model/lint-card.ts consumers). */
export interface Culprit {
  path: string;
  cap?: string;
  taint?: string;
}

type Unit =
  | { kind: 'step'; path: string }
  | { kind: 'costPart'; path: string }
  | { kind: 'ability'; path: string; dropEffect: boolean };

interface UnitInfo {
  unit: Unit;
  caps: Set<string>;
  taints: Set<string>;
}

const COST_OWNERS_NOT_CLAUSES: ReadonlySet<string> = new Set(['AdditionalCostDef', 'AlternativeCostDef', 'CostModDef']);

/** A cost part of an additional cost, an alternative cost, a cost modifier or a keyword is part of that static effect: it is not its own unit. */
function costPartIsUnit(cp: WalkNode): boolean {
  for (const a of ancestors(cp)) {
    if (COST_OWNERS_NOT_CLAUSES.has(a.def) || a.def === 'KeywordAbilityDef') return false;
    if (a.def === 'EffectStep' || ABILITY_DEFS.has(a.def)) return true;
  }
  return true;
}

/** A mana ability does not use the stack (CR 605.3b): half of it cannot be a manual step, so it degrades as a whole (the controller runs it by hand). */
function inManaAbility(n: WalkNode): boolean {
  for (let a: WalkNode | null = n; a !== null; a = a.parent) {
    if (ABILITY_DEFS.has(a.def)) return a.def === 'ActivatedAbilityDef' && a.value['isMana'] === true;
  }
  return false;
}

/** The smallest enclosing unit of a node (design 10.2). */
function unitFor(n: WalkNode): Unit {
  let dropEffect = false;
  let child = n;
  for (let cur: WalkNode | null = n; cur !== null; child = cur, cur = cur.parent) {
    switch (cur.def) {
      case 'EffectStep':
        // the bodies of a replacement belong to the static effect that holds it
        if (cur.parent?.def !== 'ReplacementBody' && !inManaAbility(cur)) return { kind: 'step', path: cur.path };
        if (inManaAbility(cur)) dropEffect = true;
        break;
      case 'CostPart':
        if (costPartIsUnit(cur) && !inManaAbility(cur)) return { kind: 'costPart', path: cur.path };
        break;
      case 'TargetSpec':
        // announced with the ability (CR 601.2c): no step can hold it. A reflexive trigger's targets sit in a step and are caught above.
        if (cur.parent?.def === 'EffectProgram') dropEffect = true;
        break;
      case 'ModeSpec':
        dropEffect = true; // the number of modes is chosen before anything else (CR 601.2b)
        break;
      default:
    }
    if (ABILITY_DEFS.has(cur.def)) return { kind: 'ability', path: cur.path, dropEffect: dropEffect || child.slot === 'effect' };
  }
  return { kind: 'ability', path: '', dropEffect };
}

const SHAPES: Readonly<Record<string, 'spell' | 'activated' | 'triggered' | 'static' | 'unknown'>> = {
  spell: 'spell', activated: 'activated', triggered: 'triggered', chapter: 'triggered', static: 'static', keyword: 'static', classLevel: 'static', levelBracket: 'static',
};

const reasonOf = (info: { caps: Set<string>; taints: Set<string> }): string =>
  [...(info.caps.size > 0 ? [`needs-engine: ${[...info.caps].sort().join(', ')}`] : []), ...[...info.taints].sort()].join('; ');

/** Does an effect read the event of its trigger (`{ref:'event'}`, `{q:'eventAmount'}`)? A nested ability has its own event and is not looked into. */
function readsEvent(effect: unknown): boolean {
  let found = false;
  walkValue(effect, 'EffectProgram', (n) => {
    if (n.parent !== null && ABILITY_DEFS.has(n.def)) return false;
    if (((n.def === 'ObjRef' || n.def === 'PlayerRef') && n.value['ref'] === 'event') || (n.def === 'Quantity' && n.value['q'] === 'eventAmount')) found = true;
    return undefined;
  });
  return found;
}

/**
 * The ManualAbilityDef that replaces an ability (keeping what was understood, design 10.2). Kept: the cost, the effect (unless it cannot be announced, or,
 * for a trigger, reads the event the manual "Trigger now" does not have, CR 603.7c), and the restrictions of the original: sorcery speed, the limit and the
 * zone (CR 602.5d, 602.5b, 603.2h, 113.6) and, as an attested `ask`, the activation condition (CR 602.5b). A dropped intervening "if" (CR 603.4) is named.
 */
function manualAbility(orig: Rec, info: UnitInfo, dropEffect: boolean, fallbackText: string): Rec {
  const reason = reasonOf(info);
  if (orig['kind'] === 'manual') {
    const m: Rec = { ...orig, reason: typeof orig['reason'] === 'string' && orig['reason'].includes(reason) ? orig['reason'] : [orig['reason'], reason].filter(Boolean).join('; ') };
    if (dropEffect) delete m['effect'];
    if (info.caps.has('feature:manual.reminder')) delete m['reminder'];
    return m;
  }
  const kind = String(orig['kind']);
  const text = typeof orig['text'] === 'string' && orig['text'] !== '' ? orig['text'] : fallbackText;
  const out: Rec = { kind: 'manual', text };
  for (const k of ['label', 'src', 'prov']) if (orig[k] !== undefined) out[k] = orig[k];
  out['shape'] = SHAPES[kind] ?? 'unknown';
  const triggered = kind === 'triggered' || kind === 'chapter';
  let keepEffect = (kind === 'activated' || triggered) && !dropEffect;
  const notes: string[] = [];
  if (keepEffect && triggered && readsEvent(orig['effect'])) {
    keepEffect = false; // a manual trigger has no event to read (CR 603.7c): the controller resolves the whole text
    notes.push('dropped: the effect reads the trigger event');
  }
  if (kind === 'activated') {
    out['cost'] = orig['cost'];
    if (orig['isMana'] === true) out['mana'] = true;
    if (orig['sorcerySpeed'] === true) out['sorcerySpeed'] = true;
    if (orig['onlyIf'] !== undefined) out['onlyIf'] = rec(orig['onlyIf'])['cond'] === 'ask' ? orig['onlyIf'] : { cond: 'ask', text };
  }
  if ((kind === 'activated' || kind === 'triggered') && orig['limit'] !== undefined) out['limit'] = orig['limit'];
  if ((kind === 'activated' || kind === 'triggered') && Array.isArray(orig['zone'])) out['zone'] = orig['zone'];
  if (kind === 'triggered' && orig['interveningIf'] !== undefined) notes.push('dropped: intervening if (CR 603.4)');
  if (keepEffect) out['effect'] = orig['effect'];
  out['reason'] = [reason, ...notes].filter(Boolean).join('; ');
  return out;
}

/** Everything `degradeWith` needs to know about the text of the ability being rewritten. */
interface TextCtx {
  texts: AbilityTexts | null;
  abilityText: string;
}

function stepText(step: Rec, tc: TextCtx): string {
  if (typeof step['sentence'] === 'number' && tc.texts?.sentences[step['sentence']] !== undefined) return tc.texts.sentences[step['sentence']]!;
  if (typeof step['span'] === 'string' && step['span'] !== '') return step['span'];
  return tc.abilityText;
}

/** An `effect` step whose effects are all shields: a resolved one-shot replacement or prevention (CR 615.7, 614.8). */
function isShieldStep(step: Rec): boolean {
  const effects = arr(step['effects']);
  return step['op'] === 'effect' && effects.length > 0 && effects.every((e) => e['s'] === 'replace' && e['shield'] !== undefined);
}

function manualStep(step: Rec, reason: string, tc: TextCtx, textOverride?: string): Rec {
  const own = step['op'] === 'manual' && typeof step['text'] === 'string' && step['text'] !== '' ? step['text'] : undefined; // keep the words of a step that was already manual
  const prior = step['op'] === 'manual' && typeof step['reason'] === 'string' ? step['reason'] : undefined;
  const out: Rec = { op: 'manual', text: textOverride ?? own ?? stepText(step, tc), reason: prior === undefined || prior.includes(reason) ? (prior ?? reason) : `${prior}; ${reason}` };
  if (step['op'] !== 'forEach' && typeof step['as'] === 'string') out['as'] = step['as'];
  if (typeof step['sentence'] === 'number') out['sentence'] = step['sentence'];
  // design 6.7 E1: the chip of a manual shield lasts as long as the shield would have (the duration moves into `reminder`)
  if (isShieldStep(step) && step['duration'] !== undefined) out['reminder'] = step['duration'];
  return out;
}

/** The sibling steps (same list) that come from the same sentence as the step at `path` (design 6.6: the sentence is the unit of manual text). */
function sentenceSiblings(root: unknown, path: string): string[] {
  const cut = path.lastIndexOf('/');
  const index = Number(path.slice(cut + 1));
  const step = getAt(root, path);
  const list = getAt(root, path.slice(0, cut));
  if (!Number.isInteger(index) || !Array.isArray(list) || typeof rec(step)['sentence'] !== 'number') return [];
  return list.flatMap((s, i) => (i !== index && rec(s)['sentence'] === rec(step)['sentence'] ? [`${path.slice(0, cut)}/${i}`] : []));
}

/** Degrade `def` for the given culprits. Returns the rewritten ability (a new object when anything changed). */
export function degradeWith(def: AbilityDef, culprits: Culprit[], lines: FaceLines): AbilityDef {
  if (culprits.length === 0) return def;
  const nodes = new Map<string, WalkNode>();
  walkAbility(def, (n) => {
    nodes.set(n.path, n);
    return undefined;
  });

  // 1. attribute every culprit to its unit
  const units = new Map<string, UnitInfo>();
  for (const c of culprits) {
    const node = nodes.get(c.path);
    if (node === undefined) continue;
    const unit = unitFor(node);
    const key = `${unit.kind}:${unit.path}`;
    const info = units.get(key) ?? { unit, caps: new Set<string>(), taints: new Set<string>() };
    if (c.cap !== undefined) info.caps.add(c.cap);
    if (c.taint !== undefined) info.taints.add(c.taint);
    if (unit.kind === 'ability' && info.unit.kind === 'ability') info.unit.dropEffect ||= unit.dropEffect;
    units.set(key, info);
  }

  const root = structuredClone(def) as unknown as Rec;
  const rootTexts = textsOf(root, lines);
  const tc: TextCtx = { texts: rootTexts, abilityText: typeof root['text'] === 'string' && root['text'] !== '' ? root['text'] : (rootTexts?.text ?? '') };
  let result: unknown = root;

  // 2. steps: merge units nested in another step unit; T2 contagion; T1 poisoning
  const stepUnits = [...units.values()].filter((u) => u.unit.kind === 'step');
  const outerSteps = stepUnits.filter((u) => !stepUnits.some((o) => o !== u && isInside(u.unit.path, o.unit.path)));
  for (const u of stepUnits) {
    if (outerSteps.includes(u)) continue;
    const outer = outerSteps.find((o) => isInside(u.unit.path, o.unit.path))!;
    u.caps.forEach((c) => outer.caps.add(c));
    u.taints.forEach((t) => outer.taints.add(t));
  }
  const culpritSteps = new Set(outerSteps.map((u) => u.unit.path));
  const contagious = new Map<string, { word: string; info: UnitInfo }>(); // program path -> why
  for (const u of outerSteps) {
    if (u.caps.size === 0) continue; // only an unavailable sentence is contagious, a poisoned one was understood (design 6.7)
    const step = getAt(root, u.unit.path) as Rec;
    // E1 (design 6.7): a manual shield works by its chip (`reminder`), so the sentence "would ... instead" does not spread to the rest of the program
    if (isShieldStep(step) || (step['op'] === 'manual' && step['reminder'] !== undefined && [...u.caps].every((c) => c === 'feature:manual.reminder'))) continue;
    const word = modifierWord(stepText(step, tc));
    if (word === null) continue;
    for (let a = nodes.get(u.unit.path)?.parent ?? null; a !== null; a = a.parent) {
      if (a.def === 'EffectProgram') {
        if (!contagious.has(a.path)) contagious.set(a.path, { word, info: u });
        break;
      }
      if (ABILITY_DEFS.has(a.def)) break;
    }
  }
  const insideContagion = (p: string): boolean => [...contagious.keys()].some((c) => isInside(p, `${c}/steps`));
  // T1 poisoning, and the sentence rule: steps that share a `sentence` with a manual one become part of the same manual step. Both can add to the other.
  const poisoned = new Map<string, string>();
  for (;;) {
    poisoned.clear();
    for (const [path, n] of nodes) {
      if (n.def !== 'EffectProgram' || contagious.has(path)) continue;
      const steps = getAt(root, `${path}/steps`);
      if (Array.isArray(steps)) poisonedSteps(steps as Rec[], `${path}/steps`, culpritSteps, poisoned);
    }
    const before = culpritSteps.size;
    for (const p of [...culpritSteps, ...poisoned.keys()]) for (const sib of sentenceSiblings(root, p)) culpritSteps.add(sib);
    if (culpritSteps.size === before) break;
  }
  const manualPaths = [...new Set([...culpritSteps, ...poisoned.keys()])].filter((p) => !insideContagion(p));
  const groups = new Map<string, string[]>(); // "<list>#<sentence>" -> member paths, first = the one that stays
  for (const p of manualPaths) {
    const sentence = rec(getAt(root, p))['sentence'];
    if (typeof sentence !== 'number') continue;
    const key = `${p.slice(0, p.lastIndexOf('/'))}#${sentence}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const removals: string[] = []; // members of a group other than its first: merged into it
  const firstOfGroup = new Map<string, string[]>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    members.sort((x, y) => Number(x.slice(x.lastIndexOf('/') + 1)) - Number(y.slice(y.lastIndexOf('/') + 1)));
    firstOfGroup.set(members[0]!, members);
    removals.push(...members.slice(1));
  }
  const reasonFor = (p: string): string => {
    const members = firstOfGroup.get(p) ?? [p];
    for (const m of members) {
      const u = outerSteps.find((o) => o.unit.path === m);
      if (u !== undefined) return reasonOf(u);
      const t = poisoned.get(m);
      if (t !== undefined) return t;
    }
    return 'merged: another step of the same sentence is manual';
  };
  const textFor = (p: string): string => stepText(getAt(root, p) as Rec, tc);

  const replacements: { path: string; value: Rec }[] = [];
  for (const [path, { word, info }] of contagious) {
    const prog = getAt(root, path) as Rec;
    const texts = [...new Set((prog['steps'] as Rec[]).map((s) => stepText(s, tc)))].join(' ');
    const reason = `${reasonOf(info)}; contagion: the sentence says "${word}"`;
    replacements.push({ path: `${path}/steps`, value: [{ op: 'manual', text: texts, reason }] as unknown as Rec });
  }
  for (const p of manualPaths) {
    if (removals.includes(p)) continue;
    if (!culpritSteps.has(p) && !poisoned.has(p)) continue;
    const step = getAt(root, p) as Rec;
    const value = manualStep(step, reasonFor(p), tc, firstOfGroup.has(p) ? textFor(p) : undefined);
    if (firstOfGroup.has(p) && typeof value['as'] !== 'string') {
      const named = firstOfGroup.get(p)!.map((m) => rec(getAt(root, m))).find((s) => s['op'] !== 'forEach' && typeof s['as'] === 'string');
      if (named !== undefined) value['as'] = named['as'];
    }
    replacements.push({ path: p, value });
  }
  // 3. cost parts
  for (const u of units.values()) {
    if (u.unit.kind !== 'costPart' || insideContagion(u.unit.path)) continue;
    replacements.push({ path: u.unit.path, value: { kind: 'manual', text: rootTexts?.costText ?? tc.abilityText } });
  }
  // deepest first, so that an inner replacement is not lost under an outer one
  replacements.sort((a, b) => b.path.length - a.path.length);
  for (const r of replacements) result = setAt(result, r.path, r.value);

  // 4. abilities (nested ones first, the root last)
  const abilityUnits = [...units.values()].filter((u): u is UnitInfo & { unit: { kind: 'ability'; path: string; dropEffect: boolean } } => u.unit.kind === 'ability');
  abilityUnits.sort((a, b) => b.unit.path.length - a.unit.path.length);
  for (const u of abilityUnits) {
    const orig = getAt(result, u.unit.path) as Rec | undefined;
    if (typeof orig !== 'object' || orig === null) continue; // inside a step that became manual as a whole
    result = setAt(result, u.unit.path, manualAbility(orig, u, u.unit.dropEffect, tc.abilityText));
  }
  // 5. merged steps leave their list (last, so that no path above is shifted; the deepest lists first, the highest index first)
  removals.sort((x, y) => y.length - x.length || Number(y.slice(y.lastIndexOf('/') + 1)) - Number(x.slice(x.lastIndexOf('/') + 1)));
  for (const p of removals) {
    const list = getAt(result, p.slice(0, p.lastIndexOf('/')));
    if (Array.isArray(list)) list.splice(Number(p.slice(p.lastIndexOf('/') + 1)), 1);
  }
  return result as AbilityDef;
}

const SETTLE_ROUNDS = 4;

/** Safety net: an ability that still needs something the engine lacks (the unit analysis missed a node) becomes a manual ability, and failing that a plain one. */
function settle(degraded: AbilityDef, original: AbilityDef, missing: string[], caps: ReadonlySet<string>, lines: FaceLines): AbilityDef {
  const leftOf = (d: AbilityDef): Culprit[] => capabilityUses(d).filter((u) => !caps.has(u.cap)).map((u) => ({ path: u.path, cap: u.cap }));
  if (leftOf(degraded).length === 0) return degraded;
  const info: UnitInfo = { unit: { kind: 'ability', path: '', dropEffect: true }, caps: new Set(missing), taints: new Set() };
  const orig = structuredClone(original) as unknown as Rec;
  const texts = textsOf(orig, lines);
  const text = typeof orig['text'] === 'string' && orig['text'] !== '' ? orig['text'] : (texts?.text ?? '');
  let current = manualAbility(orig, info, true, text) as unknown as AbilityDef;
  for (let round = 0; round < SETTLE_ROUNDS && leftOf(current).length > 0; round++) current = degradeWith(current, leftOf(current), lines);
  if (leftOf(current).length === 0) return current;
  return { kind: 'manual', text, reason: `needs-engine: ${missing.join(', ')}`, shape: SHAPES[String(orig['kind'])] ?? 'unknown' } as AbilityDef;
}

export const degradeAbility: DegradeAbility = (def, caps, lines): DegradeResult => {
  const missing = capabilityUses(def).filter((u) => !caps.has(u.cap));
  if (missing.length === 0) return { def, requires: [] };
  const requires = [...new Set(missing.map((u) => u.cap))].sort();
  let current = degradeWith(def, missing.map((u) => ({ path: u.path, cap: u.cap })), lines);
  // a manual ability can keep a part that needs something missing too (a mana cost part, a reminder): degrade again until nothing is left
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    const left = capabilityUses(current).filter((u) => !caps.has(u.cap));
    if (left.length === 0) return { def: current, requires };
    current = degradeWith(current, left.map((u) => ({ path: u.path, cap: u.cap })), lines);
  }
  return { def: settle(current, def, requires, caps, lines), requires };
};
