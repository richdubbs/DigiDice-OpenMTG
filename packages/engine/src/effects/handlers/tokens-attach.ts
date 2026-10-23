/**
 * What a token enters attached to (CR 111.10j-r Roles, 303.4f-i, 301.5e). Added by WP14 for `createToken` (`attachTo`) and `copy` (a token copy of an Aura).
 *
 * The token doesn't exist yet, so its legality is asked about a TRANSIENT object: the token as it would be on the battlefield under its controller, in a scratch
 * copy of the state that also holds its definition (nothing is written to the game). The same checks as for a card then apply: the enchant restriction (CR
 * 303.4a), protection and "can't be enchanted / equipped" through the hookpoints (CR 702.16c-d), the Equipment rules (CR 301.5c). An Aura token with nothing
 * legal to enchant isn't created (CR 303.4g, 303.4i); an Equipment token is created unattached (CR 301.5e); any other token ignores "attached to" (CR 303.4h).
 */
import type { CardDef } from '../../types/card';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { GameObject, GameState, ObjHandle } from '../../types/state';
import { auraCanEnchantObject, enchantRestriction, isAura, isEquipment, isFortification } from '../../rules/attachment';
import { charsOfObject, faceChars } from '../../rules/characteristics';
import { gameOf, hookpoints } from '../../rules/hookpoints';
import type { ExecCtx } from '../api';

/** The id the transient token has in the scratch state (never an id of the game: object ids are `o<n>`). */
const ENTERING = 'token:entering';

/** A scratch state holding the token as it would enter under `controller` (CR 303.4f: "you" of the enchant filter is that player). Read-only use. */
function withEnteringToken(s: GameState, def: CardDef, controller: PlayerId): { scratch: GameState; token: GameObject } {
  const token: GameObject = {
    id: ENTERING, kind: 'token', defId: def.id, owner: controller, controller, zone: 'battlefield', timestamp: s.counters.timestamp, tapped: false, flipped: false,
    faceDown: false, phasedOut: false, face: 0, controlledSinceTurn: s.turn.number, counters: {}, damage: 0, deathtouchDamaged: false,
  };
  return { scratch: { ...s, defs: { ...s.defs, [def.id]: def }, objects: { ...s.objects, [ENTERING]: token } }, token };
}

/** A permanent an attachment may be attached to now: on the battlefield and phased in (CR 702.26b). */
const present = (t: GameObject | undefined): t is GameObject => t !== undefined && t.zone === 'battlefield' && !t.phasedOut;

/**
 * Where a token defined by `def` enters attached, under `controller`:
 *  - `given` a handle: "attached to that creature" (Roles); `given` null: the effect named an object that is gone (undefined, CR 303.4i);
 *  - `given` undefined: the effect names nothing (a token copy of an Aura), so for an Aura the controller chooses a legal object as it enters (CR 303.4f).
 * Returns the object, `null` for "enters unattached", `'none'` for "isn't created" (an Aura with nothing legal, CR 303.4g/i), or `'manual'` when the engine
 * can't tell what the Aura may enchant (its enchant ability is manual text, or it enchants a player).
 */
export function tokenAttachment(cx: ExecCtx, def: CardDef, controller: PlayerId, given: ObjHandle | null | undefined): ObjectId | null | 'none' | 'manual' {
  const c = faceChars(def, 0);
  const s = cx.g.s;
  if (isAura(c)) {
    const kw = enchantRestriction(c);
    if (!kw || kw.player !== undefined) return 'manual';
    const { scratch, token } = withEnteringToken(s, def, controller);
    const tc = charsOfObject(scratch, token);
    const legal = (t: GameObject | undefined): boolean => present(t) && auraCanEnchantObject(scratch, token, tc, kw, scratch.objects[t.id]!);
    if (given === null) return 'none';
    if (given !== undefined) return legal(s.objects[given.id]) ? given.id : 'none';
    const options = s.zones.battlefield.filter((id) => legal(s.objects[id]));
    if (options.length === 0) return 'none';
    const ans = cx.g.choose({
      kind: 'chooseObjects', player: controller, prompt: `Choose what the ${def.name} token enchants as it enters the battlefield.`, options, min: 1, max: 1, rules: ['CR 303.4f'],
    });
    return ans.ids[0] ?? 'none';
  }
  if (!given) return null; // CR 301.5e, 303.4h: unattached
  const host = s.objects[given.id];
  const equipment = isEquipment(c);
  if (!present(host) || (!equipment && !isFortification(c)) || c.types.includes('Creature')) return null; // CR 303.4h, 301.5c
  const { scratch } = withEnteringToken(s, def, controller);
  if (!charsOfObject(s, host).types.includes(equipment ? 'Creature' : 'Land')) return null; // CR 301.5e: it can't legally equip (fortify) that
  return hookpoints.canAttach(gameOf(scratch), ENTERING, host.id) === null ? host.id : null; // CR 702.16d: protection
}
