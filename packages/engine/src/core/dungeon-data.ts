/**
 * The dungeon cards' data (core/dungeons.json, CR 309) and the read-only questions about dungeons in a state: which dungeon an object is, the one a player
 * has in the command zone, the venture marker, the dungeons a player completed (CR 309.7). Owner: MX4. No imports of game code, so the condition evaluators
 * (effects/eval.ts, triggers/cond.ts, statics/match.ts) can read it without an import cycle; the actions are core/dungeons.ts.
 */
import type { AbilityDef } from '../types/ability';
import type { AutomationLevel } from '../types/automation';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameObject, GameState } from '../types/state';
import DATA from './dungeons.json';

export interface DungeonRoom { name: string; text: string; next: number[]; level: AutomationLevel; ability: AbilityDef }
export interface Dungeon { name: string; subtypes: string[]; note?: string; rooms: DungeonRoom[] }

/** The dungeon cards (CR 309), in name order. */
export const DUNGEONS: readonly Dungeon[] = (DATA as unknown as { dungeons: Dungeon[] }).dungeons;

/** CR 701.49d: the quality of "venture into Undercity". The dungeon with that subtype can be entered only this way (its own text). */
export const UNDERCITY = 'Undercity';

/** The definition id of a dungeon card: `dungeon:<name>` (core/dungeons.ts#dungeonDef). */
export const DEF_PREFIX = 'dungeon:';

export function dungeonByName(name: string): Dungeon | undefined {
  return DUNGEONS.find((d) => d.name === name);
}

/** The dungeon an object is (by its definition), or undefined. */
export function dungeonOfObject(o: GameObject | undefined): Dungeon | undefined {
  if (!o || !o.defId.startsWith(DEF_PREFIX)) return undefined;
  return dungeonByName(o.defId.slice(DEF_PREFIX.length));
}

/** CR 309.3: the one dungeon card the player owns in the command zone, if any. */
export function dungeonInCommand(s: GameState, player: PlayerId): GameObject | undefined {
  for (const id of s.zones.command) {
    const o = s.objects[id];
    if (o && o.owner === player && dungeonOfObject(o)) return o;
  }
  return undefined;
}

/** CR 309.7: the dungeons the player has completed this game (names, one per completion). */
export function completedDungeons(s: GameState, player: PlayerId): readonly string[] {
  return s.designations.completedDungeons?.[player] ?? [];
}

/** The `completedDungeon` condition for one player: any dungeon, or the named one (CR 309.7). */
export function hasCompleted(s: GameState, player: PlayerId, name?: string): boolean {
  const done = completedDungeons(s, player);
  return name === undefined ? done.length > 0 : done.includes(name);
}

/** For views and the client: the room the player's venture marker is on, if they have a dungeon. */
export function ventureMarker(s: GameState, player: PlayerId): { dungeon: string; room: string; objectId: ObjectId } | undefined {
  const o = dungeonInCommand(s, player);
  const d = dungeonOfObject(o);
  if (!o || !d) return undefined;
  return { dungeon: d.name, room: d.rooms[o.ventureRoom ?? 0]?.name ?? '', objectId: o.id };
}
