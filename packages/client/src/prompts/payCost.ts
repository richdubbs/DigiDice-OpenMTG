/** Manual mana payment (CR 601.2g-h): building the `payCost` answer from the sources the player clicked and the Phyrexian symbols paid with life. */
import type { DecisionAnswer, ManaType, PayCostDecision } from '@openmtg/engine';

export interface PickedSource {
  objectId: string;
  abilityKey: string;
  /** The color for a source that can make several (CR 106.1, "one mana of any color"); unset for a source that makes one fixed kind. */
  color?: ManaType;
}

/** The symbols of a cost text, one per symbol ("{2}{B/P}" -> ["{2}", "{B/P}"]); the engine's `lifeForPhyrexian` indices point into this list. */
export function costSymbols(costText: string): string[] {
  return costText.match(/\{[^}]+\}/g) ?? [];
}

/** Indices of the Phyrexian symbols (CR 107.4f: "{B/P}", "{W/U/P}"), which may be paid with 2 life each. */
export function phyrexianIndices(costText: string): number[] {
  return costSymbols(costText).flatMap((s, i) => (/\/P\}$/.test(s) ? [i] : []));
}

export const sourceKey = (s: { objectId: string; abilityKey: string }) => `${s.objectId}|${s.abilityKey}`;

/**
 * Click a mana ability: add it, or take it back. A source that can make several colors starts with the first of them the cost still needs (`needed`, from
 * `neededColors`), else its first color.
 */
export function togglePicked(picked: readonly PickedSource[], src: PayCostDecision['manaSources'][number], needed: readonly ManaType[] = []): PickedSource[] {
  const key = sourceKey(src);
  if (picked.some((p) => sourceKey(p) === key)) return picked.filter((p) => sourceKey(p) !== key);
  // One mana ability per permanent at a time: a land with two abilities ("Add {R} or {G}") picks the clicked one instead of both.
  const rest = picked.filter((p) => p.objectId !== src.objectId);
  const color = needed.find((c) => src.produces.includes(c)) ?? src.produces[0]!;
  return [...rest, { objectId: src.objectId, abilityKey: src.abilityKey, ...(src.produces.length > 1 ? { color } : {}) }];
}

const MANA_LETTERS: readonly ManaType[] = ['W', 'U', 'B', 'R', 'G', 'C'];

/**
 * The colors that could still pay a colored symbol of the cost (CR 601.2h), in cost order, after the mana already chosen (`provided`, each with the color it
 * makes) and the mana in the pool. A hybrid symbol accepts either color (CR 107.4e), a Phyrexian one its color (CR 107.4f); generic and X need no color.
 */
export function neededColors(costText: string, provided: readonly { color?: ManaType }[], pool: readonly { type: ManaType }[]): ManaType[] {
  const open = costSymbols(costText)
    .map((s) => MANA_LETTERS.filter((c) => s.slice(1, -1).split('/').includes(c)))
    .filter((cs) => cs.length > 0);
  for (const c of [...pool.map((u) => u.type), ...provided.flatMap((p) => (p.color ? [p.color] : []))]) {
    const i = open.findIndex((cs) => cs.includes(c));
    if (i >= 0) open.splice(i, 1);
  }
  return [...new Set(open.flat())];
}

export function manualAnswer(picked: readonly PickedSource[], life: readonly number[]): DecisionAnswer {
  return {
    kind: 'payCost',
    auto: false,
    activations: picked.map((p) => ({ objectId: p.objectId, abilityKey: p.abilityKey, ...(p.color ? { color: p.color } : {}) })),
    ...(life.length ? { lifeForPhyrexian: [...life].sort((a, b) => a - b) } : {}),
  };
}
