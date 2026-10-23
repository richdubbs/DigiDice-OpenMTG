/**
 * Helpers shared by the card, library and mana handlers (WP13, design 8.6). Every handler follows the five stages of 8.6: evaluate quantities, resolve references,
 * decide (`g.choose`, never in the middle of a change), act only through `propose` (or a primitive for an action nothing can replace), record the result.
 */
import type { Game } from '../../core/game';
import { renewedHandle } from '../../core/zones';
import type { Name, PlayerRef, Quantity } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { LastKnown, ObjHandle, ZoneKind } from '../../types/state';
import type { ExecCtx, StepResult } from '../api';
import { evalQty } from '../eval';
import { propose } from '../propose';
import { isCurrent, readInfo, rebase, resolvePlayers } from '../refs';

export const NOTHING: StepResult = { performed: false, count: 0 };

export const result = (count: number): StepResult => ({ performed: count > 0, count });

/**
 * A quantity used as a number of cards: `undefined` when it "fails to determine" (an illegal target, an empty binding: the step does nothing, CR 608.2b), else
 * a whole number that is never negative (CR 107.1b: a calculated number of things below 0 is 0).
 */
/**
 * std-rx30 (CR 608.2e, 101.4, 107.1a): an amount that reads "their" for a step of a group of players (`who` is `{ref:'each'}`): "Each player loses half their life,
 * then discards half the cards in their hand" (Pox Plague) is read for each player in turn, `{ref:'iterating'}` being that player while it is read (as
 * effects/handlers/zones-remove.ts#asChooser reads the count of a sacrifice). Whether a step's amount is such an amount, and the read itself.
 */
export function readsEachPlayer(who: { ref: string }, q: unknown): boolean {
  return who.ref === 'each' && JSON.stringify(q ?? null).includes('"ref":"iterating"');
}
export function readFor<T>(cx: ExecCtx, p: PlayerId, read: () => T): T {
  const before = cx.iterating;
  cx.iterating = p;
  try {
    return read();
  } finally {
    if (before === undefined) delete cx.iterating;
    else cx.iterating = before;
  }
}

export function cardCount(cx: ExecCtx, q: Quantity): number | undefined {
  const n = evalQty(cx, q);
  return n === undefined ? undefined : Math.max(0, Math.floor(n));
}

/**
 * The players a reference stands for, each once, in APNAP order when several (CR 101.4, 608.2e, 121.2c: "two target players each draw" draws for the active
 * player first, whatever order the targets were announced in); illegal target players are left out (CR 608.2b).
 */
export function playersOf(cx: ExecCtx, ref: PlayerRef): PlayerId[] {
  const order = cx.g.apnap();
  const rank = (p: PlayerId): number => {
    const i = order.indexOf(p);
    return i < 0 ? order.length : i;
  };
  return [...new Set(resolvePlayers(cx, ref))].sort((a, b) => rank(a) - rank(b));
}

/** Every player still in the game (for "reveal": show to all players, CR 701.20a). Players who left the game see nothing (CR 800.4a). */
export const allPlayers = (g: Game): PlayerId[] => g.s.players.filter((p) => !p.hasLost).map((p) => p.id);

/** What an object is like now (the snapshot a binding keeps for last known information, design 3.1 rule 3). */
function snapshot(cx: ExecCtx, h: ObjHandle): LastKnown | undefined {
  const info = readInfo(cx, h);
  return info ? { ...info, object: structuredClone(info.object) } : undefined;
}

/** Bind `name` to these objects (and players) for the later steps of the resolution ("them", "those cards", "the chosen pile", design 3.1). */
export function bindObjects(cx: ExecCtx, name: Name | undefined, objects: readonly ObjHandle[], players: readonly PlayerId[] = []): void {
  if (name === undefined) return;
  const snapshots: Record<ObjectId, LastKnown> = {};
  for (const h of objects) {
    const snap = snapshot(cx, h);
    if (snap) snapshots[h.id] = snap;
  }
  cx.bindings.set(name, { objects: [...objects], players: [...players], snapshots });
}

/** The object `oldId` became after a zone change (CR 400.7), or null if it ceased to exist or did not move. */
export function becameHandle(g: Game, oldId: ObjectId): ObjHandle | null {
  const next = g.s.lki[oldId]?.newId;
  const o = next ? g.s.objects[next] : undefined;
  return o ? { id: o.id, zone: o.zone } : null;
}

/**
 * Move one object as a keyword action (discard, mill, surveil) through the proposal pipeline (CR 614.1: a replacement effect may change where it goes or stop
 * it). Acting on a handle whose object has left the expected zone does nothing (design 3.1 rule 1). Returns the object it became, or null. Bindings that held
 * the object follow it into a public zone (CR 400.7j, `rebase`). H1: a library card that a shuffle renewed during this run (a replacement of an earlier move of
 * the same action shuffled that library, CR 614.1a) is still the card to act on (`renewedHandle`): it did not leave the library.
 */
export function moveAsAction(cx: ExecCtx, held: ObjHandle, to: ZoneKind, cause: string, causedBy?: PlayerId): ObjHandle | null {
  const h = renewedHandle(cx.g, held);
  if (!isCurrent(cx, h)) return null;
  const ok = propose(cx.g, { ev: 'zoneChange', object: h, from: h.zone, to, destination: { cause, ...(causedBy !== undefined ? { causedBy } : {}) } }); // the action it is: WP11's DestinationFacts.cause (W2 merge)
  if (!ok) return null;
  const now = becameHandle(cx.g, h.id);
  if (now || !cx.g.s.objects[h.id]) rebase(cx, h.id, now);
  return now;
}

/** Display names of objects, for log lines. */
export const namesOf = (g: Game, ids: readonly ObjectId[]): string => ids.map((id) => g.nameOf(id)).join(', ');

/** "a card" / "3 cards". */
export const cardsWord = (n: number): string => (n === 1 ? 'a card' : `${n} cards`);

export const playerName = (g: Game, p: PlayerId): string => g.player(p).name;

/** Log an action of an effect (level `action`). `secret` replaces the text for the listed players (hidden information, CR 400.2). */
export function logAction(cx: ExecCtx, text: string, rules: string[], secret?: { players: PlayerId[]; text: string }): void {
  cx.g.log(text, { rules, level: 'action', ...(secret && secret.players.length > 0 ? { privateText: secret } : {}) });
}

/** The players other than `p` who are still in the game. */
export const othersThan = (g: Game, p: PlayerId): PlayerId[] => g.s.players.filter((x) => x.id !== p && !x.hasLost).map((x) => x.id);
