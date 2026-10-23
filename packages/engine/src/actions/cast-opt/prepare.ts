/**
 * Casting the exile copy of a prepared permanent's prepare spell (CR 722.3c; m6 design E19, 3.7). Owner: M6-6.
 *
 * The copy (core/prepare.ts) is a copy of a card in exile, not a card; its controller is the player who controls the prepared permanent, and that player may cast
 * it with normal timing for as long as it stays in exile (method `prepare`; `castable` lists it, so actions/cast.ts#castCheck lets a copy that is not a card be
 * cast this way). Its cost is its own mana cost (no alternative cost). The prepared permanent loses the designation as the spell becomes cast (CR 601.2i,
 * 722.3c): `onStack`, which the cast reverses with everything else if it is cancelled (CR 733.1). A copy of a prepare spell is a prepare spell (CR 722.3d).
 */
import type { ObjectId } from '../../types/ids';
import { becomeUnprepared, keptPreparedCopy } from '../../core/prepare';
import { controllerOf } from '../../rules/characteristics';
import type { CastOptionProvider } from '../cast-options';
import type { Game } from '../../core/game';
import type { GameObject } from '../../types/state';

/** The player who may cast this kept exile copy: the prepared permanent's controller (CR 722.3c), or null when it is not one. */
function caster(g: Game, o: GameObject): string | null {
  if (!keptPreparedCopy(g.s, o)) return null;
  const p = g.s.objects[o.preparedFor!]!;
  return controllerOf(g.s, p);
}

export const PREPARE_CAST_OPTIONS: readonly CastOptionProvider[] = [
  {
    name: 'prepare',
    castable: (g, player) => g.s.zones.exile.filter((id): id is ObjectId => { const o = g.s.objects[id]; return o !== undefined && caster(g, o) === player; }),
    offers: (g, o, player) => caster(g, o) === player,
    cost: () => null,
    onStack: (g, spell) => {
      // the exile copy is a new object on the stack (CR 400.7): its link is on the object it was (last known information)
      const was = Object.values(g.s.lki).find((l) => l.newId === spell.id)?.object;
      if (was?.preparedFor !== undefined) becomeUnprepared(g, was.preparedFor, ['CR 722.3c', 'CR 601.2i']);
    },
  },
];
