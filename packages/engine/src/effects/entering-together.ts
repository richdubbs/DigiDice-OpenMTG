/**
 * pc-counters-1 (CR 614.12, 616.1): objects put onto the battlefield together by one instruction (handlers/zones-move.ts, perform-events.ts#performCreateToken). A replacement effect of an entering
 * object's "other creatures enter with ..." applies only to objects entering after it, not to those entering at the same time, so a member of the group never
 * counts as the source of a foreign "enters" replacement for the others, whatever order they are moved in. Set only while the group is being moved.
 */
import type { GameState } from '../types/state';

export const ENTERING_TOGETHER = new WeakMap<object, Set<string>>();

/**
 * edh-next-122 (CR 614.1c, 614.5, 616.1; Mystic Reflection: "The next time one or more creatures or planeswalkers enter this turn, they enter as copies of the chosen creature"): the
 * one-use shields (`shield.batch`) that applied to an object of an entering group. Such a shield applies to every object of the group it first applied in (they enter at the same time:
 * one "next time"), and ends when the group has entered (`closeEnteringGroup`). An object entering alone uses it up at once (effects/replace-bodies.ts#applyBody).
 * Review: while a spell or ability resolves, the group is one instruction of it (`enterInstruction`, effects/run.ts#runSteps, CR 608.2c): one top-level step ("each player creates a token",
 * myriad's copies: separate events of one step), or a run of plain token creations by the same player ("create a Soldier token and a Zombie token", two steps); outside a resolution, the objects
 * one instruction moves or creates together (`ENTERING_TOGETHER`). Known limit: "create a token, then create another token" (one card in the index) lowers to the same two steps and is read as one.
 */
export const BATCH_SHIELDS = new WeakMap<object, Set<string>>();

/** edh-next-122: the group has entered: the batch shields that applied in it are used up (removed from the state). */
/** effects/perform-events.ts installs the performer that ends a used shield (setShieldLeft with 0). */
let removeShield: ((g: { s: GameState }, id: string) => void) | undefined;
export function installShieldRemover(f: (g: { s: GameState }, id: string) => void): void {
  removeShield = f;
}

export function closeEnteringGroup(g: { s: GameState }, group: object | undefined): void {
  const ids = group !== undefined ? BATCH_SHIELDS.get(group) : undefined;
  if (ids === undefined || ids.size === 0) return;
  for (const id of ids) removeShield?.(g, id); // the performer removes the record (effects/perform-events.ts#setShieldLeft): no state write here (design 8.5)
  BATCH_SHIELDS.delete(group!);
}

/** edh-next-122 (review, CR 608.2c): the instruction of the resolution in progress, as an identity (see BATCH_SHIELDS); undefined outside a resolution. */
let instruction: { key: string | undefined } | undefined;
export const currentInstruction = (): object | undefined => instruction;
/** A new instruction of a resolution begins: the batch shields of the last one are used up. */
export function enterInstruction(g: { s: GameState }, key: string | undefined): void {
  closeEnteringGroup(g, instruction);
  instruction = { key };
}
/** The resolution ended (or a nested one begins): its last instruction's batch shields are used up; returns the instruction to restore. */
export function leaveInstructions(g: { s: GameState }, restore: { key: string | undefined } | undefined = undefined): { key: string | undefined } | undefined {
  closeEnteringGroup(g, instruction);
  const prev = instruction;
  instruction = restore;
  return prev;
}
