/**
 * Prepared permanents and the exile copy of their prepare spell (CR 722.2-722.3; m6 design E19, 3.7). Owner: M6-6.
 *
 *  - A permanent "has a prepare spell" when its copiable values come from a preparation definition (CR 722.2a-b: the inset frame is part of the copiable values,
 *    so a token copy or a Clone of a preparation card has it too; a face-down permanent does not, CR 708.2): `prepareSpellOf`, read through the copy layer
 *    (statics/copy.ts#copiableValuesOf).
 *  - It can gain the `prepared` designation only then, and not while it has it (CR 722.3a): "~ becomes prepared" (effects/handlers/levels.ts) and "~ enters
 *    prepared" (effects/enters-parts/prepared.ts, applied by effects/perform-events.ts as it enters). "Unprepared" removes it (CR 722.3b).
 *  - As it gains the designation, or phases in with it, its controller creates a copy of it in exile with ONLY the prepare spell's characteristics, every other
 *    exception to the copying process ignored (CR 722.3c: a green 1/1 Frog token copy of Encouraging Aviator still makes a blue instant named Jump). The copy is a
 *    copy of a card (`kind: 'spellCopy'`, never a card), linked both ways (`preparedCopy` / `preparedFor`). It stays in exile while the permanent is on the
 *    battlefield (not phased out) and prepared: an exception to SBA 704.5e (core/sba-objects.ts#keptPreparedCopy); otherwise it ceases to exist. Its controller may
 *    cast it with normal timing (actions/cast-opt/prepare.ts); the permanent loses "prepared" as the copy becomes cast (CR 601.2i).
 *  - A card has only its normal characteristics in every zone (CR 722.4): the prepare face is never cast from the card (actions/cast.ts#castableFaces).
 */
import type { CardDef, FaceDef } from '../types/card';
import type { ObjectId } from '../types/ids';
import type { GameObject, GameState } from '../types/state';
import { controllerOf } from '../rules/characteristics';
import { copiableValuesOf } from '../statics/copy';
import type { Game } from './game';
import { freshObject } from './zones';

/** CR 722.2a-b: the prepare spell of this object (the second face of the preparation definition its copiable values come from), or undefined. */
export function prepareSpellOf(s: GameState, o: GameObject): { def: CardDef; face: FaceDef } | undefined {
  if (o.faceDown) return undefined; // CR 708.2: a face-down permanent's copiable values are the face-down profile
  const cv = copiableValuesOf(s, o.id);
  const def = s.defs[cv.defId];
  const face = def?.layout === 'prepare' ? def.faces[1] : undefined;
  return def && face ? { def, face } : undefined;
}

/** CR 722.2a, 722.3a: does this permanent have a prepare spell? */
export const hasPrepareSpell = (s: GameState, o: GameObject): boolean => prepareSpellOf(s, o) !== undefined;

/**
 * The definition of the exile copy: only the prepare spell's characteristics, which become its normal characteristics (CR 722.3c). One per source definition.
 * Its id prefix `prepare:` is what rules/filter.ts#isPrepareSpell reads ("a prepared spell", CR 722.3d).
 */
function copyDef(g: Game, source: CardDef, face: FaceDef): CardDef {
  const def: CardDef = { id: `prepare:${source.id}`, name: face.name, layout: 'normal', faces: [face], isToken: false, automation: source.automation };
  g.addDef(def);
  return g.s.defs[def.id]!;
}

/** CR 722.3c: the controller of the prepared permanent `o` creates the copy of its prepare spell in exile, linked to `o`. */
function createPreparedCopy(g: Game, o: GameObject): ObjectId | null {
  const spell = prepareSpellOf(g.s, o);
  if (!spell) return null;
  const controller = controllerOf(g.s, o);
  const def = copyDef(g, spell.def, spell.face);
  const copy = freshObject(g, { kind: 'spellCopy', defId: def.id, owner: controller, controller }, 'exile');
  copy.preparedFor = o.id;
  g.s.objects[copy.id] = copy;
  g.s.zones.exile.push(copy.id);
  o.preparedCopy = copy.id;
  g.log(`${g.player(controller).name} creates a copy of ${def.name} in exile: ${g.nameOf(o.id)} is prepared, and its controller may cast that copy.`, { rules: ['CR 722.3c'], level: 'action' });
  return copy.id;
}

/** CR 722.3a, 722.3c: the permanent becomes prepared (if it can: a prepare spell, and not prepared already); false when nothing happened. */
export function becomePrepared(g: Game, id: ObjectId): boolean {
  const o = g.s.objects[id];
  if (!o || o.zone !== 'battlefield' || o.prepared === true || !hasPrepareSpell(g.s, o)) return false;
  o.prepared = true;
  g.emit({ type: 'objectDesignation', objectId: id, what: 'prepared' });
  g.log(`${g.nameOf(id)} becomes prepared.`, { rules: ['CR 722.3a'], level: 'action' });
  if (!o.phasedOut) createPreparedCopy(g, o);
  return true;
}

/** CR 722.3b: the permanent becomes unprepared; its copy in exile is no longer kept (it ceases to exist by SBA 704.5e). False when it was not prepared. */
export function becomeUnprepared(g: Game, id: ObjectId, rules: string[] = ['CR 722.3b']): boolean {
  const o = g.s.objects[id];
  if (!o || o.prepared !== true) return false;
  delete o.prepared;
  g.emit({ type: 'objectDesignation', objectId: id, what: 'unprepared' });
  g.log(`${g.nameOf(id)} becomes unprepared.`, { rules, level: 'action' });
  return true;
}

/**
 * CR 722.3c, 704.5e: is this copy of a card the exile copy of a prepare spell whose permanent is on the battlefield (not phased out, CR 702.26b) and prepared?
 * Then it stays in exile; any other copy of a card outside the stack ceases to exist.
 */
export function keptPreparedCopy(s: GameState, o: GameObject): boolean {
  if (o.kind !== 'spellCopy' || o.zone !== 'exile' || o.preparedFor === undefined) return false;
  const p = s.objects[o.preparedFor];
  return p !== undefined && p.zone === 'battlefield' && !p.phasedOut && p.prepared === true && p.preparedCopy === o.id;
}

/**
 * CR 722.3c "or phases in prepared": a prepared permanent whose copy ceased while it was phased out (core/sba-objects.ts clears the link then) gets a new one.
 * Called by the state-based action check, before anything else can be done (no player has priority between phasing in and that check, CR 502.1, 117.5).
 */
export function preparedCopiesToMake(g: Game): boolean {
  let any = false;
  for (const id of g.s.zones.battlefield) {
    const o = g.s.objects[id];
    if (!o || o.prepared !== true || o.phasedOut || o.preparedCopy !== undefined) continue;
    if (createPreparedCopy(g, o) !== null) any = true;
  }
  return any;
}
