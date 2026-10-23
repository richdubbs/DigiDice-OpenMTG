/**
 * M6-6 (m6 design 3.7): what the layout structures of Sagas, Classes, leveler cards and Cases stand for, as ordinary abilities. Owner: M6-6. Pure functions of
 * immutable data (statics may import only types, keywords, statics and rules/base-chars: test/m5/skeleton/import-rules.test.ts).
 *
 *  - Sagas (CR 714.3a-b, 702.155b): the intrinsic abilities "This Saga enters with a lore counter on it" (a Saga without read ahead) and "As this Saga enters,
 *    choose a number between one and this Saga's final chapter number" plus "This Saga enters with the chosen number of lore counters on it" (a Saga with read
 *    ahead). They are rule-generated abilities (`r:saga`, `r:readAhead`; statics/abilities.ts#ruleAbilitiesFor), so the entering pipeline reads them from the
 *    permanent as it would exist on the battlefield (CR 614.12: a copy of a Saga is one, a face-down one is not), "loses all abilities" removes them, and their
 *    lore counters are put by a replacement effect (cause 'replacement': Doubling Season doubles them, CR 614.16). The chapter abilities themselves are
 *    triggered abilities (triggers/collect.ts, CR 714.2b-c); the precombat main lore counter is core/lore.ts (CR 714.3c), the sacrifice core/sba-objects.ts
 *    (CR 714.4, 704.5s).
 *  - Class levels (CR 716.2a): "[Cost]: Level N -- [Abilities]" is "[Cost]: This Class's level becomes N. Activate only if this Class is level N-1 and only as
 *    a sorcery" and "As long as this Class is level N or greater, it has [abilities]". The level is a designation (`GameObject.classLevel`, absent = 1,
 *    CR 716.2b, 716.2d), never level counters (CR 716.4), and not copiable (CR 716.2b: a copy of a level 3 Class is level 1). Level 1, which has no class
 *    level bar, is treated normally (CR 716.3): its abilities are had unconditionally.
 *  - Leveler brackets (CR 711.2a-b): "{LEVEL N1-N2} [Abilities] [P/T]" is "As long as this creature has at least N1 level counters on it, but no more than N2
 *    level counters on it, it has base power and toughness [P/T] and has [abilities]" (N3+: no upper bound). Below N1 the printed P/T applies (CR 711.5); in
 *    every other zone too, because the static ability functions on the battlefield only (CR 711.6).
 *  - Cases (CR 719.3a-c): "To solve -- [Condition]" is "At the beginning of your end step, if [condition] and this Case is not solved, this Case becomes
 *    solved"; "Solved -- [Ability]" functions only while the Case has the solved designation (`GameObject.solved`, not copiable, CR 719.3b).
 *
 * The "has [abilities]" parts are static abilities with a condition whose continuous effect gives the object those abilities in layer 6 (and, for a bracket,
 * its base power and toughness in layer 7b, CR 613.4b), so the layer system orders them with every other effect (CR 613.6-613.8) and "loses all abilities"
 * removes them with the static ability itself. The generated abilities are keyed `x:<face>:<index>:<n>` (and `x:<face>:<index>:solve`): statics/abilities.ts.
 */
import type { AbilityDef, ActivatedAbilityDef, CaseDef, ClassLevelDef, Condition, LevelBracketDef, Modification, StaticAbilityDef, TriggeredAbilityDef } from '../types/ability';
import type { Chars } from '../rules/characteristics';
import type { CharAbility } from './api';

/**
 * Capability names (`feature:<name>`, model/capabilities.ts) of the layout structures this module and its call-sites implement: Saga chapters (CR 714, with the
 * intrinsic lore-counter replacement, the precombat main lore counter and SBA 704.5s), Class levels (CR 716), leveler brackets (CR 711), Cases (CR 719) and
 * preparation cards (CR 722: core/prepare.ts; m6 design 7 lists the name, which a card's layout reaches through cards/layout-support/layouts.ts).
 */
export const LEVELS_FEATURES: readonly string[] = ['chapter', 'class.level', 'leveler.bracket', 'case', 'prepare'];

const SELF = { ref: 'self' } as const;

// ---- Sagas (CR 714) ----------------------------------------------------------------------------------------------------------------------------------

/** The link a read-ahead Saga's chosen number is stored under (CR 702.155b, 607.2d); never a card's own link id (those contain no '.'). */
export const READ_AHEAD_LINK = 'rule.readAhead';

/** CR 714.2d: the greatest chapter number among the chapter abilities in `abilities`, or 0 when there is none. */
export function finalChapter(abilities: readonly Pick<CharAbility, 'def'>[]): number {
  let n = 0;
  for (const a of abilities) if (a.def.kind === 'chapter') for (const c of a.def.chapters) if (c > n) n = c;
  return n;
}

/** Does it have read ahead (CR 702.155a; several instances are redundant, CR 702.155c)? */
export const hasReadAhead = (abilities: readonly Pick<CharAbility, 'def'>[]): boolean => abilities.some((a) => a.def.kind === 'keyword' && a.def.keyword === 'read ahead');

/** CR 714.3a: "This Saga enters with a lore counter on it." (one frozen definition for every Saga) */
const SAGA_ENTERS: StaticAbilityDef = deepFreeze({
  kind: 'static',
  text: 'This Saga enters with a lore counter on it.',
  effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, body: { b: 'enters', counters: [{ kind: 'lore', count: 1 }] } }],
});

/** CR 714.3b, 702.155b: the read-ahead pair, per final chapter number (the choice and the counters it decides are one `enters` replacement, CR 614.12a). */
const READ_AHEAD = new Map<number, StaticAbilityDef>();
function readAheadAbility(final: number): StaticAbilityDef {
  let a = READ_AHEAD.get(final);
  if (!a) {
    a = deepFreeze<StaticAbilityDef>({
      kind: 'static',
      text: `As this Saga enters, choose a number between one and ${final}. This Saga enters with the chosen number of lore counters on it.`,
      effects: [{
        s: 'replace',
        replaces: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' },
        body: {
          b: 'enters',
          choose: [{ what: 'number', link: READ_AHEAD_LINK, options: Array.from({ length: final }, (_, i) => String(i + 1)) }],
          counters: [{ kind: 'lore', count: { q: 'var', name: READ_AHEAD_LINK } }], // the chosen number (effects/bodies/m5.ts binds it, CR 614.12a)
        },
      }],
    });
    READ_AHEAD.set(final, a);
  }
  return a;
}

/**
 * The intrinsic abilities of a Saga (CR 714.3a-b), keyed `r:saga` and `r:readAhead`: none for an object that isn't a Saga, nor the ones it already has. A Saga
 * with read ahead and no chapter ability has no number to choose (CR 714.2d: its final chapter number is 0), so it gets neither.
 */
export function sagaRuleAbilities(c: Pick<Chars, 'subtypes' | 'face' | 'abilities'>): CharAbility[] {
  if (!c.subtypes.includes('Saga')) return [];
  if (!hasReadAhead(c.abilities)) return c.abilities.some((a) => a.key === 'r:saga') ? [] : [{ key: 'r:saga', origin: 'rule', face: c.face, index: -1, def: SAGA_ENTERS }];
  const final = finalChapter(c.abilities);
  if (final < 1 || c.abilities.some((a) => a.key === 'r:readAhead')) return [];
  return [{ key: 'r:readAhead', origin: 'rule', face: c.face, index: -1, def: readAheadAbility(final) }];
}

// ---- Classes, leveler brackets and Cases -----------------------------------------------------------------------------------------------------------------

/** One ability a layout structure stands for: its key suffix (`x:<face>:<index>:<suffix>`) and its definition. */
export interface LayoutPart {
  suffix: string;
  def: AbilityDef;
}

const EXPANSIONS = new WeakMap<AbilityDef, readonly LayoutPart[]>();

/** Is this one of the structures `layoutExpansion` expands (CR 711, 716, 719)? */
export const isLayoutStructure = (def: AbilityDef): def is ClassLevelDef | LevelBracketDef | CaseDef =>
  def.kind === 'classLevel' || def.kind === 'levelBracket' || def.kind === 'case';

/**
 * The abilities a Class level, a leveler bracket or a Case stands for (see the module comment), in a fixed order. Memoized per definition (a pure function of
 * immutable data; a frozen definition gets frozen parts). Empty for every other ability.
 */
export function layoutExpansion(def: AbilityDef): readonly LayoutPart[] {
  if (!isLayoutStructure(def)) return [];
  let out = EXPANSIONS.get(def);
  if (!out) {
    out = def.kind === 'classLevel' ? classLevelParts(def) : def.kind === 'levelBracket' ? bracketParts(def) : caseParts(def);
    if (Object.isFrozen(def)) out = deepFreeze(out);
    EXPANSIONS.set(def, out);
  }
  return out;
}

/** "As long as [condition], it has [abilities]" (and base P/T): a static ability whose continuous effect is on the object itself. */
function hasWhile(text: string, condition: Condition | undefined, mods: Modification[]): StaticAbilityDef {
  return { kind: 'static', text, ...(condition ? { condition } : {}), effects: [{ s: 'continuous', affects: SELF, mods }] };
}

const textOf = (abilities: readonly AbilityDef[]): string => abilities.map((a) => a.text).join('\n');

/** CR 716.2a: the level designation of this Class is N or greater (absent = 1, CR 716.2d). */
const levelAtLeast = (n: number): Condition => ({ cond: 'classLevel', object: SELF, atLeast: n });

function classLevelParts(def: ClassLevelDef): LayoutPart[] {
  const out: LayoutPart[] = [];
  const n = def.level;
  if (n >= 2 && def.cost) {
    // CR 716.2a: "[Cost]: This Class's level becomes N. Activate only if this Class is level N-1 and only as a sorcery."
    const levelUp: ActivatedAbilityDef = {
      kind: 'activated',
      text: def.text.split('\n')[0]!,
      cost: def.cost,
      sorcerySpeed: true,
      onlyIf: { cond: 'all', of: [levelAtLeast(n - 1), { cond: 'not', of: levelAtLeast(n) }] },
      effect: { targets: [], steps: [{ op: 'designateObject', what: SELF, designation: 'classLevel', level: n }] },
    };
    out.push({ suffix: '0', def: levelUp });
  }
  // CR 716.2a: "As long as this Class is level N or greater, it has [abilities]"; level 1 has no class level bar and is treated normally (CR 716.3)
  if (def.abilities.length > 0) out.push({ suffix: String(out.length), def: hasWhile(textOf(def.abilities), n >= 2 ? levelAtLeast(n) : undefined, [{ layer: 6, add: [...def.abilities] }]) });
  return out;
}

/** A printed P/T box value as a number ("3"), or null when it is not a plain number. */
const ptValue = (v: string | undefined): number | null => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);

function bracketParts(def: LevelBracketDef): LayoutPart[] {
  const levels = { q: 'counters', on: SELF, kind: 'level' } as const;
  const range: Condition[] = [{ cond: 'compare', left: levels, op: '>=', right: def.min }];
  if (def.max !== null) range.push({ cond: 'compare', left: levels, op: '<=', right: def.max });
  const mods: Modification[] = [];
  if (def.abilities.length > 0) mods.push({ layer: 6, add: [...def.abilities] });
  const power = ptValue(def.power);
  const toughness = ptValue(def.toughness);
  if (power !== null && toughness !== null) mods.push({ layer: '7b', power, toughness }); // CR 711.2a-b, 613.4b: base power and toughness
  else if (def.power !== undefined || def.toughness !== undefined) return []; // a P/T box that is not a number: nothing is had rather than half (never wrong)
  if (mods.length === 0) return [];
  return [{ suffix: '0', def: hasWhile(def.text, range.length === 1 ? range[0] : { cond: 'all', of: range }, mods) }];
}

/** CR 719.3b-c: this Case has the solved designation. */
const SOLVED: Condition = { cond: 'matches', object: SELF, filter: { solved: true } };

function caseParts(def: CaseDef): LayoutPart[] {
  const toSolve: TriggeredAbilityDef = {
    kind: 'triggered',
    text: def.text.split('\n').find((l) => /^to solve\b/i.test(l)) ?? def.text,
    trigger: { on: [{ ev: 'step', step: 'end', whose: 'you' }] },
    interveningIf: { cond: 'all', of: [def.solve, { cond: 'not', of: SOLVED }] }, // CR 719.3a, 603.4
    effect: { targets: [], steps: [{ op: 'designateObject', what: SELF, designation: 'solved' }] },
  };
  const out: LayoutPart[] = [{ suffix: 'solve', def: toSolve }];
  if (def.solved.length > 0) out.push({ suffix: '0', def: hasWhile(textOf(def.solved), SOLVED, [{ layer: 6, add: [...def.solved] }]) });
  return out;
}

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    for (const x of Object.values(v as object)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}
