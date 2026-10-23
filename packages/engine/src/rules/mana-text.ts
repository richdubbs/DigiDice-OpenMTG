/**
 * A tiny local recognizer for the simple Oracle wording of mana abilities (CR 605), used until the
 * general template parser of milestone 5 replaces it. Recognized shapes:
 *
 *   {T}: Add {C}.                         {T}: Add {R} or {G}.
 *   {T}: Add {C}{C}.                      {T}: Add {W}, {U}, or {B}.
 *   {T}: Add one mana of any color.       {T}, Sacrifice this artifact: Add one mana of any color.
 *
 * Anything else (extra sentences such as "This land deals 1 damage to you.", spending restrictions,
 * "any one color", X, mana costs in the activation cost) is NOT recognized and stays manual text.
 */
import type { ActivatedAbilityDef, CostDef, EffectStep } from '../types/ability';
import { COLORS, type ManaType } from '../types/mana';

/** The effect step of a recognized mana ability: the controller adds one entry per unit of mana, each a list of the types it may be (CR 106.3, 605.1a). */
export interface AddManaStep {
  op: 'addMana';
  /** Required by the model (design D4, 3.2): a mana ability's controller adds the mana. */
  who: { ref: 'you' };
  units: ManaType[][];
}

const addManaStep = (units: ManaType[][]): EffectStep => ({ op: 'addMana', who: { ref: 'you' }, units }) satisfies AddManaStep;

const ANY_COLOR: ManaType[] = [...COLORS];
const TYPES = new Set<string>(['W', 'U', 'B', 'R', 'G', 'C']);

function symbol(text: string): ManaType | null {
  const m = /^\{([WUBRGC])\}$/.exec(text.trim());
  return m && TYPES.has(m[1]!) ? (m[1] as ManaType) : null;
}

/** Parse the part after "Add " and before the final period. Returns the per-unit options or null. */
function parseProduction(text: string): ManaType[][] | null {
  const t = text.trim();
  if (/^one mana of any color$/i.test(t)) return [ANY_COLOR];
  // A run of symbols: {C}{C} or {R}{G}: every unit is fixed.
  if (/^(\{[WUBRGC]\})+$/.test(t)) return (t.match(/\{[WUBRGC]\}/g) ?? []).map((x) => [symbol(x)!]);
  // One unit chosen from a list: "{R} or {G}", "{W}, {U}, or {B}", "{W}, {U}, {B}, {R}, or {G}".
  const list = t.split(/\s*,\s*or\s+|\s*,\s*|\s+or\s+/).filter(Boolean);
  if (list.length >= 2) {
    const types = list.map(symbol);
    if (types.every((x): x is ManaType => x !== null) && new Set(types).size === types.length) return [types];
  }
  return null;
}

/** Parse the activation cost of a mana ability: only {T}, {Q} and "Sacrifice this <type>" are allowed. */
function parseCost(text: string, faceName: string): CostDef | null {
  const cost: CostDef = {};
  const parts = text.split(/\s*,\s*/).filter(Boolean);
  if (parts.length === 0) return null;
  for (const part of parts) {
    if (part === '{T}') cost.tap = true;
    else if (part === '{Q}') cost.untap = true;
    else if (/^Sacrifice (this [A-Za-z' -]+|CARDNAME)$/.test(part) || part === `Sacrifice ${faceName}`) {
      cost.other = [...(cost.other ?? []), { kind: 'sacrifice', filter: {}, count: 1, self: true }];
    } else return null;
  }
  return cost;
}

/** Recognize one line of Oracle text as a simple mana ability. `faceName` is the name of the card face. */
export function parseManaAbilityLine(line: string, faceName: string): ActivatedAbilityDef | null {
  const m = /^(.+?):\s*Add\s+(.+?)\.$/.exec(line.trim());
  if (!m) return null;
  const cost = parseCost(m[1]!, faceName);
  if (!cost) return null;
  const units = parseProduction(m[2]!);
  if (!units) return null;
  return { kind: 'activated', text: line.trim(), cost, isMana: true, effect: { targets: [], steps: [addManaStep(units)] } };
}

/** The units of a mana ability's effect, or null if it is not an addMana-only ability. */
export function manaUnitsOf(def: ActivatedAbilityDef): ManaType[][] | null {
  const steps = def.effect.steps;
  if (steps.length === 0) return null;
  const units: ManaType[][] = [];
  for (const st of steps) {
    if (st.op !== 'addMana' || !Array.isArray(st.units)) return null;
    units.push(...(st.units as ManaType[][]));
  }
  return units;
}
