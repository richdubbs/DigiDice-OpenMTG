/**
 * Rooms: permanents with a shared type line, their doors and the unlocked designations (CR 709.5, 116.2m). Owner: FAST5X E8. The only code that writes
 * `GameObject.unlocked`.
 *
 *   CR 709.5, 709.5a  the characteristics of a Room permanent: rules/base-parts/room.ts (a locked half has no name, mana cost or rules text there)
 *   CR 709.5c         "left half unlocked" / "right half unlocked": `GameObject.unlocked` (indices of the unlocked halves, 0 = left); a door is a half (CR 709.5j)
 *   CR 709.5d         a Room enters with the designation of the half that was cast as a spell (the move part below); otherwise with neither
 *   CR 709.5e, 116.2m the unlock cost, a special action: pay the mana cost of a locked half, any time its controller has priority and the stack is empty during
 *                     a main phase of their turn (`ROOM_SPECIAL_HANDLERS`; the payment is installed by effects/handlers/rooms.ts, see `installUnlock`)
 *   CR 709.5f, 709.5g "unlock" / "lock" half of a permanent (`unlockDoor`, `lockDoor`)
 *   CR 709.5h, 709.5i every unlock emits `doorUnlocked` (normalized to `becomes` 'unlocked', and 'fullyUnlocked' when it now has both designations, triggers/
 *                     normalize.ts), entering unlocked included
 *
 * This module is reached from core/registries.ts (which core/zones.ts imports), so it may import neither the cost payer nor the proposal pipeline (both import
 * core/zones.ts: an import cycle): the payment is installed from effects/handlers/rooms.ts when that module loads.
 */
import type { CostDef } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import { formatManaCost } from '../types/mana';
import type { GameObject, GameState } from '../types/state';
import { charsOfObject } from '../rules/characteristics';
import { sorceryTiming } from '../rules/timing';
import { hasSharedTypeLine, unlockedHalves } from '../rules/base-parts/room';
import { IllegalAction, type Game } from './game';
import type { MovePart, SpecialActionHandler } from './registries';

export { hasSharedTypeLine, unlockedHalves };

/** CR 709.5j: "left" / "right" door of a Room with two halves. */
export const doorName = (face: number): string => (face === 0 ? 'left' : face === 1 ? 'right' : `half ${face + 1}`);

/** Is `o` a Room permanent (a permanent with a shared type line, CR 709.5) on the battlefield, face up? */
export function isRoomPermanent(s: GameState, o: GameObject | undefined): o is GameObject {
  if (!o || o.zone !== 'battlefield' || o.faceDown || o.kind === 'ability') return false;
  const def = s.defs[o.defId];
  return def !== undefined && hasSharedTypeLine(def);
}

/** The locked halves of a Room permanent (CR 709.5c), ascending; [] for anything else. */
export function lockedHalves(s: GameState, o: GameObject | undefined): number[] {
  if (!isRoomPermanent(s, o)) return [];
  const def = s.defs[o.defId]!;
  const open = unlockedHalves(def, o);
  return def.faces.map((_, i) => i).filter((i) => !open.includes(i));
}

/** The printed name of half `face` of `o` (its definition: a locked half has no name on the battlefield, CR 709.5, but the player can read the card). */
const halfName = (s: GameState, o: GameObject, face: number): string => s.defs[o.defId]?.faces[face]?.name ?? doorName(face);

/**
 * CR 709.5c-f, 709.5h-i: give `o` the unlocked designation of half `face` (`player` is who unlocks it). False when nothing changed (not a Room permanent, or that
 * half is unlocked already). Emits `doorUnlocked` (with `full` when it now has both designations and did not before, CR 709.5i).
 */
export function unlockDoor(g: Game, id: ObjectId, face: number, player: PlayerId, rules: string[] = ['CR 709.5f'], quiet = false): boolean {
  const o = g.s.objects[id];
  if (!isRoomPermanent(g.s, o) || !lockedHalves(g.s, o).includes(face)) return false;
  const def = g.s.defs[o.defId]!;
  const before = unlockedHalves(def, o);
  o.unlocked = [...before, face].sort((a, b) => a - b);
  const full = o.unlocked.length === def.faces.length && before.length < def.faces.length;
  g.emit({ type: 'doorUnlocked', objectId: id, face, player, full });
  if (!quiet) g.log(`${g.player(player).name} unlocks ${halfName(g.s, o, face)}${full ? `: ${g.nameOf(id)} is fully unlocked` : ''}.`, { rules: [...rules, ...(full ? ['CR 709.5i'] : [])], level: 'action' });
  return true;
}

/** CR 709.5g: half `face` of `o` loses its unlocked designation. False when nothing changed. */
export function lockDoor(g: Game, id: ObjectId, face: number, player: PlayerId, rules: string[] = ['CR 709.5g']): boolean {
  const o = g.s.objects[id];
  if (!isRoomPermanent(g.s, o)) return false;
  const def = g.s.defs[o.defId]!;
  const before = unlockedHalves(def, o);
  if (!before.includes(face)) return false;
  const after = before.filter((i) => i !== face);
  if (after.length > 0) o.unlocked = after;
  else delete o.unlocked;
  g.emit({ type: 'doorUnlocked', objectId: id, face, player, full: false, lock: true });
  g.log(`${g.player(player).name} locks ${halfName(g.s, o, face)}.`, { rules, level: 'action' });
  return true;
}

/**
 * CR 709.5d: a Room spell that resolves enters with the unlocked designation of the half that was CAST (a copy of a spell is not cast, CR 707.10; copying a
 * Room spell is refused by statics/copy.ts). Set as it enters, before its enters event, so its own abilities see it (CR 709.5h: the door's "When you unlock
 * this door" triggers on entering unlocked).
 */
export const ROOM_MOVE_PARTS: readonly MovePart[] = [
  {
    afterLeave: (g, old, newId, opts) => {
      const now = newId ? g.s.objects[newId] : undefined;
      if (!now || now.zone !== 'battlefield' || old.zone !== 'stack' || opts.faceDown || now.faceDown) return;
      const info = old.stack;
      if (!info || info.kind !== 'spell' || info.isCopy === true || info.fused === true) return;
      const def = g.s.defs[now.defId];
      if (!def || !hasSharedTypeLine(def)) return;
      const face = Math.min(info.face ?? old.face, def.faces.length - 1);
      now.unlocked = [face];
      g.emit({ type: 'doorUnlocked', objectId: now.id, face, player: info.caster ?? old.controller, full: def.faces.length === 1 });
    },
  },
];

// ---- the unlock special action (CR 709.5e, 116.2m) -----------------------------------------------------------------------------------------------------

/** What performs the payment (installed by effects/handlers/rooms.ts, see the file comment). */
export interface UnlockImpl {
  /** Could `player` pay this cost now (CR 601.2h, 118.3)? */
  payable(s: GameState, player: PlayerId, id: ObjectId, cost: CostDef): boolean;
  /** Pay the cost (cancellable decisions, CR 733.1). */
  pay(g: Game, player: PlayerId, id: ObjectId, cost: CostDef, what: string): void;
  /** std-rh (CR 118.7, 709.5e): the mana cost of unlocking after the cost modifiers of static abilities ("Unlock costs you pay cost {1} less"); null when it can't be worked out. */
  modified?(s: GameState, player: PlayerId, mana: Exclude<CostDef['mana'], undefined>): Exclude<CostDef['mana'], undefined> | null;
}
let impl: UnlockImpl | null = null;
export function installUnlock(f: UnlockImpl | null): void {
  impl = f;
}

interface Listed { object: ObjectId; door: number; label: string; cost: CostDef }

/** CR 709.5e, 116.2m: the unlock costs `player` may pay now: each locked half (with a mana cost) of each Room they control, at sorcery timing. */
function listed(g: Game, player: PlayerId): Listed[] {
  if (!impl) return []; // fail closed: nothing to pay with
  const s = g.s;
  if (sorceryTiming(s, player, 'unlock a door', 'CR 709.5e') !== null) return [];
  const out: Listed[] = [];
  for (const id of s.zones.battlefield) {
    const o = s.objects[id];
    if (!isRoomPermanent(s, o) || o.phasedOut || charsOfObject(s, o).controller !== player) continue;
    const def = s.defs[o.defId]!;
    for (const face of lockedHalves(s, o)) {
      const mana = def.faces[face]!.manaCost;
      if (mana === null) continue; // no mana cost: nothing to pay (CR 118.6)
      const modified = impl.modified ? impl.modified(s, player, mana) : mana;
      if (modified === null) continue; // an amount nobody can work out: not offered (never a guessed cost)
      const cost: CostDef = { mana: modified };
      if (!impl.payable(s, player, id, cost)) continue;
      out.push({ object: id, door: face, label: `Unlock ${def.faces[face]!.name} (${formatManaCost(modified)})`, cost });
    }
  }
  return out;
}

export const ROOM_SPECIAL_HANDLERS: readonly SpecialActionHandler[] = [
  {
    kind: 'unlock',
    list: (g, player) => listed(g, player),
    perform: (g, action) => {
      const options = action.object === undefined ? [] : listed(g, action.player).filter((x) => x.object === action.object);
      const pick = action.door !== undefined ? options.filter((x) => x.door === action.door) : options;
      if (pick.length === 0) throw new IllegalAction('You can\'t unlock that door now.', ['CR 116.2m', 'CR 709.5e', 'CR 117.1a']);
      if (action.door === undefined && pick.length > 1) throw new IllegalAction('Say which door to unlock (door).', ['CR 709.5e']);
      const p = pick[0]!;
      const name = g.s.defs[g.obj(p.object).defId]!.faces[p.door]!.name;
      impl!.pay(g, action.player, p.object, p.cost, `unlocking ${name}`);
      unlockDoor(g, p.object, p.door, action.player, ['CR 116.2m', 'CR 709.5e']);
    },
  },
];
