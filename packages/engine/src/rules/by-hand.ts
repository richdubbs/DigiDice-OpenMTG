/**
 * MRE (C6 gap 7): the by-hand tools for manual triggered and static abilities. Pure: which abilities a player may trigger by hand (CR 603.2, 603.3: the
 * player says it triggered and puts it on the stack) or apply by hand (CR 604.1: a static ability's effect, without the stack), and why not.
 *
 * Only manual abilities (`ManualAbilityDef`, text the engine cannot automate) of shape `triggered` or `static` are offered, of an object that is in a public
 * zone where the ability functions (CR 113.6: the battlefield unless the ability says otherwise), face up and phased in (CR 702.26b). The tool belongs to the
 * permanent's controller, or to the card's owner outside the battlefield (CR 603.3a, 108.4). The engine never checks that the trigger event happened or what
 * the static ability means: the player attests it, and the log says so publicly with the card's name and the ability's text.
 */
import type { ManualAbilityDef } from '../types/ability';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameObject, GameState, ZoneKind } from '../types/state';
import { abilitiesFromChars, type AbilityInfo } from './abilities';
import { charsOfObject } from './characteristics';

export type ByHandKind = 'manualTrigger' | 'manualStatic';

/** The shape of manual ability each tool is for. */
export const BY_HAND_SHAPE: Readonly<Record<ByHandKind, ManualAbilityDef['shape']>> = { manualTrigger: 'triggered', manualStatic: 'static' };

/** Zones every player can see (CR 400.2): a by-hand action names its source, so a card in a hidden zone is never offered. */
const PUBLIC_ZONES: ReadonlySet<ZoneKind> = new Set<ZoneKind>(['battlefield', 'graveyard', 'exile', 'command']);

export interface ByHandInfo extends AbilityInfo {
  def: ManualAbilityDef;
}

/** Who may use the by-hand tools of `o`: its controller on the battlefield, its owner in another zone (CR 603.3a, 108.4). */
export function byHandUser(o: GameObject): PlayerId {
  return o.zone === 'battlefield' ? o.controller : o.owner;
}

/** The manual abilities of `o` that the tool `kind` is for, where `o` is now (empty when it is hidden, face down or phased out). */
export function byHandAbilities(s: GameState, o: GameObject, kind: ByHandKind): ByHandInfo[] {
  if (!PUBLIC_ZONES.has(o.zone) || o.faceDown || o.phasedOut || o.kind === 'ability') return [];
  const shape = BY_HAND_SHAPE[kind];
  return abilitiesFromChars(charsOfObject(s, o)).filter((a): a is ByHandInfo =>
    a.def.kind === 'manual' && a.def.shape === shape && a.def.mana !== true && (a.def.zone ?? ['battlefield']).includes(o.zone));
}

/** Why `player` can't use the tool `kind` on ability `key` of `sourceId` right now (one message for every reason that would reveal something), or null. */
export function byHandDenial(s: GameState, player: PlayerId, sourceId: ObjectId, key: string, kind: ByHandKind): { message: string; rules: string[] } | null {
  const o = s.objects[sourceId];
  const what = kind === 'manualTrigger' ? 'a triggered ability that can be triggered by hand' : 'a static ability that can be applied by hand';
  if (!o || !byHandAbilities(s, o, kind).some((a) => a.key === key)) return { message: `That is not ${what}.`, rules: [kind === 'manualTrigger' ? 'CR 603.2' : 'CR 604.1'] };
  if (byHandUser(o) !== player) {
    return { message: `You can only ${kind === 'manualTrigger' ? 'trigger' : 'apply'} abilities of permanents you control by hand.`, rules: ['CR 603.3a'] };
  }
  return null;
}
