/**
 * The whole-index snapshot of guard G10 (design 6.8, 15.4, D27): per card (keyed by `oracle_id`) the templates the parser used and, per ability (a
 * "unit"), its automation level and a hash of its canonical JSON. Every change to templates, parser or capabilities is diffed against a baseline
 * snapshot, and **adding a template may change only formerly-manual units**:
 *
 *   - a formerly `full` unit must keep exactly its hash;
 *   - a formerly `partial` unit may change only where it was manual. Its record keeps the MASKED structure: the behavior JSON with every manual node
 *     (design 10.1) replaced by a marker. The new unit must match it: a marker matches any subtree, and inside an array any run of one or more elements
 *     (one manual sentence may become several steps); every other node must be equal; target specs may be added (a formerly manual sentence announces
 *     its target once it is understood) but not changed or removed;
 *   - a formerly manual unit that still has AUTOMATED parts (design 10.2: a ManualAbilityDef keeps the understood cost, which the engine charges, and a
 *     triggered one its understood effect, which "Trigger now" runs; activation restrictions keep it from being offered at instant speed, without its
 *     limit or from the wrong zone; an activated ability whose every step is manual still has its cost charged) keeps those parts: its record holds the
 *     masked PROJECTION {shape, cost, effect, sorcerySpeed, limit, zone, onlyIf, mana}, and whatever the unit becomes (still manual, or understood) must
 *     keep it, a field that was absent counting as manual;
 *   - a formerly automated unit must not disappear or lose automation (`demoted`);
 *   - formerly manual units without automated parts may change freely (that is what new templates are for).
 *
 * The masks are placed on the CANONICAL form (the manual-node pointers are computed on it): canonicalize sorts the operands of `all`/`any` and of
 * commutative `math`, so a pointer taken from the as-built ability could mask an automated node and leave the manual one exposed.
 *
 * Behavior only: the ability canonicalized (model/canonical), display fields stripped (model/strip: no Oracle text in the file, so a snapshot is
 * publishable, updates.md), provenance removed. The header identifies what produced the snapshot: the pipeline, the compiler version, content hashes of
 * the template set and of the engine's capability set, and the git revision when known. No clock: two runs over the same inputs write byte-identical
 * files.
 */
import { createHash } from 'node:crypto';
import { canonicalize, classifyAbility, manualNodes, stripAbility, type AbilityDef, type AutomationLevel, type CapabilitySet, type CardDef, type Template } from '@openmtg/engine';
import type { CardRun } from './engine';

export const SNAPSHOT_FORMAT = 'openmtg-coverage-snapshot';
export const SNAPSHOT_VERSION = 4;

/** f = full, p = partial, m = manual (design 10.3, per ability). */
export type UnitStatus = 'f' | 'p' | 'm';

/**
 * [status, hash] for full units and manual units without automated parts; [status, hash, masked structure] for partial units; [status, hash, masked
 * projection] for manual units with automated parts.
 */
export type UnitRecord = [UnitStatus, string] | [UnitStatus, string, unknown];

export interface SnapshotCard {
  name: string;
  level: AutomationLevel;
  /** Template ids the parser used on the card (all faces), sorted. */
  templates: string[];
  /** Unit key `<face>:<src lines>:<ordinal>` -> record. */
  units: Record<string, UnitRecord>;
}

export interface Snapshot {
  format: typeof SNAPSHOT_FORMAT;
  version: number;
  pipeline: string;
  compilerVersion: string;
  /** Number of templates. */
  templates: number;
  /** Content hash of the template set (stable JSON of every template, in load order); '' when the producer did not give the set. */
  templatesHash: string;
  capabilities: number;
  /** Content hash of the engine's capability set (sorted). */
  capabilitiesHash: string;
  /** The git revision of the checkout that wrote the snapshot ('' when unknown), and whether its working tree had changes. */
  revision: string;
  cards: Record<string, SnapshotCard>;
}

const STATUS: Record<AutomationLevel, UnitStatus> = { full: 'f', partial: 'p', manual: 'm' };
export const MANUAL_MARK = '<manual>';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** JSON with object keys sorted at every level (stable whatever the insertion order). */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Rec;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

const hash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** Content hashes of a template set and of a capability set (the snapshot header; `coverage --diff` compares them). */
export const templatesHash = (templates: readonly Template[]): string => hash(stableJson(templates));
export const capabilitiesHash = (caps: CapabilitySet): string => hash([...caps].sort().join('\n'));

function withoutProv(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutProv);
  if (v === null || typeof v !== 'object') return v;
  const out: Rec = {};
  for (const [k, x] of Object.entries(v as Rec)) if (k !== 'prov') out[k] = withoutProv(x);
  return out;
}

function canonicalOf(def: AbilityDef): AbilityDef {
  try {
    return canonicalize(def);
  } catch {
    return def; // a malformed ability is hashed as it is
  }
}

/**
 * Target ids renamed by position (W3b, snapshot version 4): in each program with targets, its specs become `$t<depth>.<k>` in order and every string equal
 * to one of their ids below it is renamed alike. Target ids are names only (CR 601.2c: what is announced, not what it is called): when a formerly manual
 * sentence or mode announces its target, the later ids shift (t0 -> t1) and a split card's halves are renumbered apart (CR 702.102d), without any change
 * of behavior. The structure is unchanged, so canonical pointers still resolve.
 */
export function renumberTargets(v: unknown): unknown {
  const walk = (x: unknown, map: ReadonlyMap<string, string>, depth: number): unknown => {
    if (typeof x === 'string') return map.get(x) ?? x;
    if (Array.isArray(x)) return x.map((e) => walk(e, map, depth));
    if (!isRec(x)) return x;
    let m = map;
    let d = depth;
    const targets = x['targets'];
    if (Array.isArray(targets) && targets.some((t) => isRec(t) && typeof t['id'] === 'string')) {
      const next = new Map(map);
      let k = 0;
      for (const t of targets) if (isRec(t) && typeof t['id'] === 'string' && !next.has(t['id'])) next.set(t['id'], `$t${depth}.${k++}`);
      m = next;
      d = depth + 1;
    }
    const out: Rec = {};
    for (const [key, val] of Object.entries(x)) out[key] = walk(val, m, d);
    return out;
  };
  return walk(v, new Map(), 0);
}

/** The behavior of an already canonical ability: no display text, no provenance, target ids by position (the structure is kept, so canonical pointers resolve in it). */
function behaviorOfCanonical(c: AbilityDef): unknown {
  let stripped: unknown;
  try {
    stripped = stripAbility(c);
  } catch {
    stripped = c;
  }
  return renumberTargets(withoutProv(stripped));
}

/** The behavior of an ability as data: canonical, no display text, no provenance. */
export const behaviorOf = (def: AbilityDef): unknown => behaviorOfCanonical(canonicalOf(def));

/** Replace the node at each JSON pointer by the marker (pointers that do not resolve are ignored). Mutates and returns `root`. */
export function maskAt(root: unknown, pointers: readonly string[]): unknown {
  for (const p of pointers) {
    if (p === '' || p === '/') return MANUAL_MARK;
    const parts = p.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
    let node: unknown = root;
    for (let i = 0; i < parts.length - 1 && node !== null && typeof node === 'object'; i++) node = (node as Rec)[parts[i]!];
    const last = parts[parts.length - 1]!;
    if (node !== null && typeof node === 'object' && last in (node as Rec)) (node as Rec)[last] = MANUAL_MARK;
  }
  return root;
}

export const unitHash = (def: AbilityDef): string => hash(stableJson(behaviorOf(def)));

/**
 * The behavior JSON with every manual node masked. The pointers are computed on the canonical form, the same form that is masked (canonicalize
 * reorders `all`/`any` operands and commutative `math` arguments, so pointers of the as-built ability could miss).
 */
export function maskedBehavior(def: AbilityDef): unknown {
  const c = canonicalOf(def);
  let pointers: string[] = [];
  try {
    pointers = [...new Set(manualPointers(c))].sort();
  } catch {
    pointers = [];
  }
  return maskAt(structuredClone(behaviorOfCanonical(c)), pointers);
}

/**
 * The manual nodes of an ability as JSON pointers. A ManualAbilityDef is ONE manual node for `manualNodes` (its root), but the parts it keeps (design
 * 10.2: the cost, the effect a manual trigger runs, the `ask` activation condition) can hold manual nodes of their own: those are found by walking the
 * kept parts as the activated ability they come from (same field names, so the same pointers).
 */
function manualPointers(c: AbilityDef): string[] {
  if (c.kind !== 'manual') return manualNodes(c).map((s) => s.path);
  const m = c as unknown as Rec;
  const kept = { kind: 'activated', cost: m['cost'] ?? {}, effect: m['effect'] ?? { targets: [], steps: [] }, ...(m['onlyIf'] !== undefined ? { onlyIf: m['onlyIf'] } : {}) };
  return manualNodes(kept as unknown as AbilityDef).map((s) => s.path).filter((p) => p !== '');
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// the automated parts of a manual unit (design 10.2)
// ---------------------------------------------------------------------------------------------------------------------------------------------------

const SHAPE: Readonly<Record<string, string>> = {
  spell: 'spell', activated: 'activated', triggered: 'triggered', chapter: 'triggered', static: 'static', keyword: 'static', classLevel: 'static', levelBracket: 'static',
};
/** The fields of an ability the engine acts on even when its effect is manual (design 10.2 `manualAbility`). */
const KEPT = ['cost', 'effect', 'sorcerySpeed', 'limit', 'zone', 'onlyIf'] as const;
/** The activation restrictions among the kept fields (CR 602.5: timing, limit, condition). */
const RESTRICTIONS: ReadonlySet<string> = new Set(['sorcerySpeed', 'limit', 'onlyIf']);
/** Ability kinds whose own `zone` defaults to the battlefield (CR 113.6). */
const ZONE_DEFAULT = new Set(['activated', 'triggered', 'static']);

/** An effect with no automated content (every step masked, no target announced, no modes) is all manual. */
function effectOf(effect: unknown): unknown {
  if (!isRec(effect)) return effect;
  const steps = Array.isArray(effect['steps']) ? effect['steps'] : [];
  const targets = Array.isArray(effect['targets']) ? effect['targets'] : [];
  return effect['modes'] === undefined && targets.length === 0 && steps.every((s) => s === MANUAL_MARK) ? MANUAL_MARK : effect;
}

/**
 * The projection of a masked ManualAbilityDef: what the engine still does with it. Absent fields are manual (a later template may add them), except
 * `zone`: an absent zone of an ACTIVATED manual ability is the battlefield, as for an understood one (CR 113.6, 602.1; W3b: the engine offers a manual
 * mana ability on the battlefield only), so the same ability as a ManualAbilityDef and as an activated ability project alike (a manual trigger keeps the old rule).
 */
function manualProjection(m: Rec): Rec {
  const shape = m['shape'] === 'unknown' || m['shape'] === undefined ? MANUAL_MARK : m['shape'];
  const out: Rec = { shape, mana: m['mana'] === true };
  for (const k of KEPT) {
    out[k] = m[k] === undefined
      ? (k === 'zone' && shape === 'activated' ? ['battlefield'] : MANUAL_MARK)
      : k === 'effect' ? effectOf(m[k]) : m[k];
  }
  return out;
}

/** The same projection of a masked understood ability (its absent `zone` is the battlefield, its `isMana` is the manual ability's `mana`). */
function abilityProjection(m: Rec): Rec {
  const kind = String(m['kind']);
  const out: Rec = { shape: SHAPE[kind] ?? MANUAL_MARK, mana: m['isMana'] === true };
  for (const k of KEPT) {
    const v = m[k];
    out[k] = k === 'zone' && v === undefined && ZONE_DEFAULT.has(kind) ? ['battlefield'] : k === 'effect' ? effectOf(v) : v;
  }
  return out;
}

/** The projection of any masked unit (MANUAL_MARK for a unit that is masked as a whole). */
export function projectionOf(masked: unknown): unknown {
  if (!isRec(masked)) return MANUAL_MARK;
  return masked['kind'] === 'manual' ? manualProjection(masked) : abilityProjection(masked);
}

/** Does a manual unit (its masked behavior) carry anything automated: a cost, an effect with automated content, mana, a restriction, a non-default zone? */
function carriesAutomation(masked: unknown): boolean {
  if (!isRec(masked)) return false;
  if (masked['kind'] === 'manual') return masked['mana'] === true || KEPT.some((k) => masked[k] !== undefined && (k !== 'effect' || effectOf(masked[k]) !== MANUAL_MARK));
  return masked['isMana'] === true || KEPT.some((k) => masked[k] !== undefined && (k !== 'effect' || effectOf(masked[k]) !== MANUAL_MARK));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// matching
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Does `now` keep everything `old` had automated? A marker in `old` matches any subtree; in an array it matches any run of one or more elements, and
 * a run of ADJACENT markers matches any run of one or more elements as a whole (W3b: two manual sentences may become one manual step, or one understood
 * step such as "pay ... If you do, ..."); a `targets` array of `now` may hold specs `old` did not have (the targets of formerly manual sentences);
 * everything else must be equal. `named` (Cloud std-fin): inside a step that took in the sentence after it (`grows`), a nested step may gain a name (`as`).
 */
export function keepsAutomated(old: unknown, now: unknown, key = '', unordered = false, grows = false, named = false): boolean {
  if (old === MANUAL_MARK) return true;
  // W3b: an activation restriction an understood ability did not have (absent: none) and a manual ability does not know (absent: manual) are the same
  // to the engine: neither restricts the activation it offers (CR 602.5); only a restriction that was there must stay
  if (old === undefined && now === MANUAL_MARK && RESTRICTIONS.has(key)) return true;
  if (Array.isArray(old)) {
    if (!Array.isArray(now)) return false;
    if (key === 'targets') return old.every((o) => now.some((n) => keepsAutomated(o, n)));
    if (unordered) return keepsAutomatedAsSet(old, now);
    const was: unknown[] = old;
    const runs = was.filter((x, i) => !(x === MANUAL_MARK && i > 0 && was[i - 1] === MANUAL_MARK));
    const seq = (i: number, j: number): boolean => {
      if (i === runs.length) return j === now.length;
      if (runs[i] === MANUAL_MARK) {
        // FAST5 T61: the manual run is empty when the step before it took the sentence in (it gained a `then` or an `else`)
        const took = i > 0 && j > 0 && tookIn(runs[i - 1], now[j - 1]);
        for (let k = took ? j : j + 1; k <= now.length; k++) if (seq(i + 1, k)) return true;
        return false;
      }
      // FAST5 T61: the step right before a manual run may have taken that run in: "you may pay {2}. If you do, ..." understood becomes the payment with a `then`, a
      // step that a later sentence refers to gets the name (`as`) it is referred by. What the step did on its own is unchanged (the manual run was after it).
      return j < now.length && keepsAutomated(runs[i], now[j], '', false, runs[i + 1] === MANUAL_MARK, named) && seq(i + 1, j + 1);
    };
    return seq(0, 0);
  }
  if (old !== null && typeof old === 'object') {
    if (now === null || typeof now !== 'object' || Array.isArray(now)) return false;
    const o = old as Rec;
    const n = now as Rec;
    if (grows && guardTookElse(o, n)) return true;
    const keys = new Set([...Object.keys(o), ...Object.keys(n)].filter((k) => o[k] !== undefined || n[k] !== undefined));
    for (const k of keys) {
      if (grows && o[k] === undefined && GROWN_KEYS.has(k) && typeof o['op'] === 'string') continue;
      // Cloud std-fin: ... and so may an instruction nested in it gain the name the understood sentence reads it by ("You may return target Equipment card from your
      // graveyard to the battlefield. If you do, you may attach it to ~.": the move inside the option is named, CR 400.7); a name changes nothing the instruction does
      if (named && k === 'as' && o[k] === undefined && typeof o['op'] === 'string') continue;
      // cloud std-spm (CR 603.2h): a triggered ability gains the limit "Do this only once each turn" (`limit.action`, parser/lower/ability.ts#onceAction) when that
      // sentence was the manual end of its effect: the limit is that sentence understood, and what was automated (the trigger) is unchanged
      if (k === 'limit' && o[k] === undefined && o['kind'] === 'triggered' && onceLimit(n[k]) && endsManual(o['effect'])) continue;
      // FAST5 T78: an `if` whose branch held the instruction a later "If you do, ..." sentence reads takes that sentence in at the END of the branch (parser/lower/conditions.ts#foldMayInIf)
      if (grows && (k === 'then' || k === 'else') && typeof o['op'] === 'string' && Array.isArray(o[k]) && Array.isArray(n[k]) && n[k].length > o[k].length
        && (o[k] as unknown[]).every((x, i) => keepsAutomated(x, (n[k] as unknown[])[i], '', false, true))) continue;
      if (!keepsAutomated(o[k], n[k], k, isSetValued(o, k), false, named || (grows && typeof o['op'] === 'string'))) return false;
    }
    return true;
  }
  return old === now;
}

/** FAST5 T61: did the understood step `now` take in the sentences after `old` by gaining a `then` or an `else` they are the instructions of? */
function tookIn(old: unknown, now: unknown): boolean {
  if (!isRec(old) || !isRec(now) || typeof old['op'] !== 'string') return false;
  const longer = (a: unknown, b: unknown): boolean => Array.isArray(a) && Array.isArray(b) && b.length > a.length; // FAST5 T78: appended to the branch it already had
  return (old['then'] === undefined && now['then'] !== undefined) || (old['else'] === undefined && now['else'] !== undefined) || longer(old['then'], now['then']) || longer(old['else'], now['else'])
    || (old['op'] === 'copy' && old['gains'] === undefined && now['gains'] !== undefined); // std-copy-1: a copy that took in the rider "The copy gains ..." (GROWN_KEYS)
}

/** Cloud std-spm: the limit "Do this only once each turn" of a triggered ability (`limit.action`), and an effect masked as a whole or whose last step is masked. */
const onceLimit = (limit: unknown): boolean => isRec(limit) && limit['action'] === true && limit['per'] === 'turn' && limit['max'] === 1;
const endsManual = (effect: unknown): boolean =>
  effect === MANUAL_MARK || (isRec(effect) && Array.isArray(effect['steps']) && effect['steps'].length > 0 && effect['steps'][effect['steps'].length - 1] === MANUAL_MARK);

/**
 * CLOUD std-msh (CR 608.2c): a guarded instruction ("draw a card if it was attacking", its `guard` C) right before a manual run may have taken in the
 * "Otherwise, Y." sentence of that run: it is now `if` C then [the same instruction] else [Y] (parser/lower/riders.ts). What it did on its own is unchanged:
 * C still decides it, the instruction is the same, only the branch for "not C" is new (keepsAutomated, `grows`).
 */
function guardTookElse(o: Rec, n: Rec): boolean {
  if (typeof o['op'] !== 'string' || o['op'] === 'if' || o['guard'] === undefined || n['op'] !== 'if') return false;
  if (Object.keys(n).some((k) => n[k] !== undefined && k !== 'op' && k !== 'cond' && k !== 'then' && k !== 'else')) return false;
  const then = n['then'];
  if (!Array.isArray(then) || then.length !== 1 || !Array.isArray(n['else']) || n['else'].length === 0) return false;
  const { guard, ...bare } = o;
  return keepsAutomated(guard, n['cond']) && keepsAutomated(bare, then[0]);
}

/** FAST5 T61: the keys an understood step may gain when the manual sentence after it becomes understood too (see keepsAutomated). */
// std-copy-1 (CR 608.2c, 707.10): `gains`, the rider "The copy gains haste and ..." merged into the copy right before it (parser/lower/riders.ts; types/ability.ts, copy.gains)
const GROWN_KEYS: ReadonlySet<string> = new Set(['as', 'then', 'else', 'gains']);

/**
 * Lists whose order canonicalize does not keep (model/canonical: it SORTS them): the operands of `all`/`any`, the arguments of a commutative `math`,
 * `anyOf` filters. Their elements are compared as a multiset, or a filled mask would shift the order and look like a change.
 */
function isSetValued(parent: Rec, key: string): boolean {
  if (key === 'of') return parent['cond'] === 'all' || parent['cond'] === 'any';
  if (key === 'args') return parent['q'] === 'math' && ['+', '*', 'min', 'max'].includes(String(parent['op']));
  return key === 'anyOf';
}

/** Multiset version of the array rule: each automated element of `old` matches a distinct element of `now`; each mask stands for at least one more. */
function keepsAutomatedAsSet(old: readonly unknown[], now: readonly unknown[]): boolean {
  const marks = old.filter((x) => x === MANUAL_MARK).length;
  const fixed = old.filter((x) => x !== MANUAL_MARK);
  const used = new Array<boolean>(now.length).fill(false);
  const assign = (i: number): boolean => {
    if (i === fixed.length) {
      const rest = used.filter((u) => !u).length;
      return marks === 0 ? rest === 0 : rest >= marks;
    }
    for (let j = 0; j < now.length; j++) {
      if (used[j] || !keepsAutomated(fixed[i], now[j])) continue;
      used[j] = true;
      if (assign(i + 1)) return true;
      used[j] = false;
    }
    return false;
  };
  return assign(0);
}

/** The units of a compiled card, keyed `<face>:<src lines>:<ordinal among abilities with the same src>`. */
export function unitsOf(def: CardDef, caps: CapabilitySet): Record<string, UnitRecord> {
  const out: Record<string, UnitRecord> = {};
  def.faces.forEach((face, f) => {
    const seen = new Map<string, number>();
    face.abilities.forEach((a, i) => {
      const src = Array.isArray(a.src) && a.src.length > 0 ? a.src.join(',') : 'x';
      const n = seen.get(src) ?? 0;
      seen.set(src, n + 1);
      const auto = def.automation.faces?.[f]?.abilities[i] ?? classifyAbility(a, caps);
      const status = a.kind === 'manual' ? 'm' : STATUS[auto.level];
      const h = unitHash(a);
      const key = `${f}:${src}:${n}`;
      if (status === 'p') out[key] = [status, h, maskedBehavior(a)];
      else if (status === 'm') {
        const masked = maskedBehavior(a);
        out[key] = carriesAutomation(masked) ? [status, h, projectionOf(masked)] : [status, h];
      } else out[key] = [status, h];
    });
  });
  return out;
}

/** The ability of a live compiled card at a unit key (or undefined), its masked behavior, and its projection (for formerly manual units). */
export function unitAt(def: CardDef, _caps: CapabilitySet, unit: string): { ability: AbilityDef; masked: unknown; projection: unknown } | undefined {
  const [f, src, n] = unit.split(':');
  const face = def.faces[Number(f)];
  if (!face) return undefined;
  let k = -1;
  const index = face.abilities.findIndex((a) => (Array.isArray(a.src) && a.src.length > 0 ? a.src.join(',') : 'x') === src && ++k === Number(n));
  if (index < 0) return undefined;
  const ability = face.abilities[index]!;
  const masked = maskedBehavior(ability);
  return { ability, masked: ability.kind === 'manual' ? MANUAL_MARK : masked, projection: projectionOf(masked) };
}

export const cardKey = (run: Pick<CardRun, 'card'>): string => run.card.oracle_id ?? `name:${run.card.name}`;

export function snapshotCard(run: CardRun, caps: CapabilitySet): SnapshotCard {
  const templates = [...new Set(run.parse.faces.flatMap((f) => f.templatesUsed))].sort();
  return { name: run.card.name, level: run.level, templates, units: run.def ? unitsOf(run.def, caps) : {} };
}

export interface SnapshotMeta {
  pipeline: string;
  compilerVersion: string;
  /** The number of templates, or the template set itself (then its content hash is recorded too). */
  templates: number | readonly Template[];
  caps: CapabilitySet;
  /** The git revision ('' when unknown). */
  revision?: string;
}

export function buildSnapshot(runs: readonly CardRun[], meta: SnapshotMeta): Snapshot {
  const cards: Record<string, SnapshotCard> = {};
  for (const r of [...runs].sort((a, b) => (cardKey(a) < cardKey(b) ? -1 : cardKey(a) > cardKey(b) ? 1 : 0))) cards[cardKey(r)] = snapshotCard(r, meta.caps);
  const set = typeof meta.templates === 'number' ? undefined : meta.templates;
  return {
    format: SNAPSHOT_FORMAT, version: SNAPSHOT_VERSION, pipeline: meta.pipeline, compilerVersion: meta.compilerVersion,
    templates: set ? set.length : (meta.templates as number), templatesHash: set ? templatesHash(set) : '',
    capabilities: meta.caps.size, capabilitiesHash: capabilitiesHash(meta.caps), revision: meta.revision ?? '', cards,
  };
}

export const snapshotHeader = (s: Snapshot): Omit<Snapshot, 'cards'> => ({
  format: s.format, version: s.version, pipeline: s.pipeline, compilerVersion: s.compilerVersion, templates: s.templates, templatesHash: s.templatesHash,
  capabilities: s.capabilities, capabilitiesHash: s.capabilitiesHash, revision: s.revision,
});

/** One card per line (line-oriented diffs), keys sorted. */
export function serializeSnapshot(s: Snapshot): string {
  const lines = Object.keys(s.cards).sort().map((k) => `${JSON.stringify(k)}:${stableJson(s.cards[k])}`);
  return `${stableJson(snapshotHeader(s)).slice(0, -1)},"cards":{\n${lines.join(',\n')}\n}}\n`;
}

export function parseSnapshot(text: string): Snapshot {
  const s = JSON.parse(text) as Snapshot;
  if (s.format !== SNAPSHOT_FORMAT) throw new Error(`not a coverage snapshot (format ${String(s.format)})`);
  if (s.version !== SNAPSHOT_VERSION) throw new Error(`snapshot version ${s.version} is not ${SNAPSHOT_VERSION}: write a new baseline`);
  return s;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// diff (G10)
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export type ViolationKind = 'changed' | 'removed' | 'demoted';

export interface UnitViolation {
  key: string;
  unit: string;
  name: string;
  kind: ViolationKind;
  before: UnitStatus;
  after: UnitStatus | null;
}

export interface SnapshotDiff {
  /** Level transitions "full->partial" -> count (only cards present in both). */
  moves: Record<string, number>;
  /** Cards whose level went up / down, with the transition. */
  up: { name: string; from: AutomationLevel; to: AutomationLevel }[];
  down: { name: string; from: AutomationLevel; to: AutomationLevel }[];
  /** G10 violations: formerly automated units (or automated parts of manual units) that changed, vanished or lost automation. */
  violations: UnitViolation[];
  /** Cards that were `full` and whose output changed in any way (design 6.9 step 4). */
  fullChanged: string[];
  /** Units that were manual and changed while keeping their automated parts (allowed; the progress a template brings). */
  improvedUnits: number;
  added: string[];
  removed: string[];
}

const RANK: Record<AutomationLevel, number> = { manual: 0, partial: 1, full: 2 };
const URANK: Record<UnitStatus, number> = { m: 0, p: 1, f: 2 };

/** Does the new record keep the automated parts of a manual unit's projection? null: cannot tell from the snapshot (the unit is now full: hash only). */
function keepsManualParts(old: unknown, now: UnitRecord): boolean | null {
  if (now[0] === 'f') return null;
  if (now[0] === 'm') return now.length === 3 ? keepsAutomated(old, now[2]) : keepsAutomated(old, projectionOf(MANUAL_MARK));
  return now.length === 3 ? keepsAutomated(old, projectionOf(now[2])) : false;
}

/**
 * Snapshot against snapshot. A partial unit, or a manual unit with automated parts, that became full carries only a hash on the new side, so it cannot
 * be confirmed here and is reported as "changed"; `refineWithRuns` re-checks such units against the live compiled cards (`coverage --diff` always does).
 */
export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const d: SnapshotDiff = { moves: {}, up: [], down: [], violations: [], fullChanged: [], improvedUnits: 0, added: [], removed: [] };
  for (const key of Object.keys(before.cards).sort()) {
    const b = before.cards[key]!;
    const a = after.cards[key];
    if (!a) {
      d.removed.push(b.name);
      continue;
    }
    const move = `${b.level}->${a.level}`;
    d.moves[move] = (d.moves[move] ?? 0) + 1;
    if (RANK[a.level] > RANK[b.level]) d.up.push({ name: b.name, from: b.level, to: a.level });
    if (RANK[a.level] < RANK[b.level]) d.down.push({ name: b.name, from: b.level, to: a.level });
    let changed = false;
    for (const unit of Object.keys(b.units).sort()) {
      const old = b.units[unit]!;
      const now = a.units[unit];
      if (!now || now[1] !== old[1]) changed = true;
      if (old[0] === 'm') {
        if (now && now[1] === old[1]) continue;
        if (old.length !== 3) {
          if (now) d.improvedUnits++;
          continue;
        }
        // a manual unit with automated parts (design 10.2): those parts must survive
        if (!now) {
          d.violations.push({ key, unit, name: b.name, kind: 'removed', before: 'm', after: null });
          continue;
        }
        const kept = keepsManualParts(old[2], now);
        if (kept === false) d.violations.push({ key, unit, name: b.name, kind: 'changed', before: 'm', after: now[0] });
        else if (kept === null) d.violations.push({ key, unit, name: b.name, kind: 'changed', before: 'm', after: now[0] }); // confirmed by refineWithRuns
        else d.improvedUnits++;
        continue;
      }
      if (!now) {
        d.violations.push({ key, unit, name: b.name, kind: 'removed', before: old[0], after: null });
        continue;
      }
      const nowMasked = now[0] === 'm' ? MANUAL_MARK : now[2];
      const kept = now[1] === old[1] || (old[0] === 'p' && now.length === 3 && keepsAutomated(old[2], nowMasked));
      if (!kept) d.violations.push({ key, unit, name: b.name, kind: 'changed', before: old[0], after: now[0] });
      else if (URANK[now[0]] < URANK[old[0]]) d.violations.push({ key, unit, name: b.name, kind: 'demoted', before: old[0], after: now[0] });
    }
    if (Object.keys(a.units).some((u) => !(u in b.units))) changed = true;
    if (b.level === 'full' && changed) d.fullChanged.push(b.name);
  }
  for (const key of Object.keys(after.cards).sort()) if (!(key in before.cards)) d.added.push(after.cards[key]!.name);
  return d;
}

/**
 * Re-check the "changed" units of `before` whose new form is full (hash only in the snapshot) against the live compiled cards: a formerly partial unit
 * must keep its old automated nodes (manual nodes masked), a formerly manual unit with automated parts must keep its projection.
 */
export function refineWithRuns(diff: SnapshotDiff, before: Snapshot, runs: ReadonlyMap<string, CardRun>, caps?: CapabilitySet): SnapshotDiff {
  let improved = 0;
  const violations = diff.violations.filter((v) => {
    if (v.kind !== 'changed' || (v.before !== 'p' && v.before !== 'm')) return true;
    const old = before.cards[v.key]?.units[v.unit];
    const run = runs.get(v.key);
    if (!old || old.length !== 3 || !run?.def) return true;
    const now = unitAt(run.def, caps ?? new Set(), v.unit);
    if (!now) return true;
    const ok = v.before === 'p' ? keepsAutomated(old[2], now.masked) : keepsAutomated(old[2], now.projection);
    if (ok && v.before === 'm') improved++;
    return !ok;
  });
  return { ...diff, violations, improvedUnits: diff.improvedUnits + improved };
}
