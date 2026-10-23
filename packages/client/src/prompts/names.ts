/**
 * Display names for the objects and players a decision mentions, read only from a `GameView` (never a raw state: a hidden card stays hidden, CR 400.2).
 */
import { HIDDEN_DEF, type GameObject, type GameView, type ManaType, type ObjectId, type PlayerId } from '@openmtg/engine';
import { faceDownName, isFaceDownObject } from '../cards/objectStatus';

export function playerName(view: GameView, id: PlayerId): string {
  return view.players.find((p) => p.id === id)?.name ?? id;
}

export function isPlayer(view: GameView, id: string): boolean {
  return view.players.some((p) => p.id === id);
}

function objectOf(view: GameView, id: ObjectId): GameObject | undefined {
  return view.objects[id] ?? view.lki[id]?.object;
}

/** Split cards (aftermath cards are split cards too, CR 702.127a): outside the stack their characteristics are both halves combined, name included (CR 709.4). */
const SPLIT_LAYOUTS = ['split', 'aftermath'];

/**
 * The name a viewer may see: the current face's name ("Fire // Ice" for a split card outside the stack, the cast half on the stack, CR 709.3-4), "Hidden
 * card" for a card in a hidden zone, the source's name for an ability on the stack.
 */
export function objectName(view: GameView, id: ObjectId): string {
  const o = objectOf(view, id);
  if (!o) return id;
  if (o.defId === HIDDEN_DEF) return o.faceDown ? 'Face-down permanent' : 'Hidden card';
  const def = view.defs[o.defId];
  const whole = def !== undefined && SPLIT_LAYOUTS.includes(def.layout) && o.zone !== 'stack';
  const base = def ? (whole ? def.name : (def.faces[o.face]?.name ?? def.name)) : o.defId;
  if (o.kind === 'ability') return `Ability of ${o.stack?.sourceName ?? base}`;
  // M6-11 (CR 708.2a, 708.5-708.6): a face-down permanent or spell, named by how it came to be face down, and by its card only for a viewer who may look at it
  // (another player's has the engine's pseudo-definition, which has no name).
  if (isFaceDownObject(o)) return faceDownName(view, o);
  if (o.faceDown) return `Face-down ${base}`;
  return base;
}

/** A player id or an object id, named. */
export function entityName(view: GameView, id: string): string {
  return isPlayer(view, id) ? playerName(view, id) : objectName(view, id);
}

const ZONE_WORDS: Record<string, string> = {
  hand: 'in hand', library: 'in library', graveyard: 'in graveyard', exile: 'in exile', stack: 'on the stack', command: 'in the command zone',
};

/** "Grizzly Bears (Bob's, tapped)": the name plus where it is and whose it is, when that is not obvious. */
export function objectLabel(view: GameView, id: ObjectId): string {
  const o = objectOf(view, id);
  if (!o) return id;
  const bits: string[] = [];
  if (o.controller !== view.viewer) bits.push(`${playerName(view, o.controller)}'s`);
  if (o.zone !== 'battlefield') bits.push(ZONE_WORDS[o.zone] ?? o.zone);
  else if (o.tapped) bits.push('tapped');
  const name = objectName(view, id);
  return bits.length ? `${name} (${bits.join(', ')})` : name;
}

/** Number the labels that occur more than once, in list order ("Forest #1", "Forest #2"); unique labels stay as they are. */
export function numberDuplicates(labels: readonly string[]): string[] {
  const total = new Map<string, number>();
  for (const l of labels) total.set(l, (total.get(l) ?? 0) + 1);
  const seen = new Map<string, number>();
  return labels.map((l) => {
    if ((total.get(l) ?? 0) < 2) return l;
    const n = (seen.get(l) ?? 0) + 1;
    seen.set(l, n);
    return `${l} #${n}`;
  });
}

/** Labels for a list of ids, numbered when two would read the same ("Forest #1", "Forest #2"). */
export function distinctLabels(view: GameView, ids: readonly string[]): Record<string, string> {
  const labels = numberDuplicates(ids.map((id) => (isPlayer(view, id) ? playerName(view, id) : objectLabel(view, id))));
  return Object.fromEntries(ids.map((id, i) => [id, labels[i]!]));
}

/**
 * Engine labels write a card's reference to itself as "~" (the Oracle "this card", CR 201.5): show the source's name instead. Until the engine fills the
 * name into its labels, the client does it where the source is known.
 */
export function withSelfName(text: string, sourceName: string | undefined): string {
  return sourceName ? text.replace(/~/g, sourceName) : text;
}

export const MANA_NAMES: Record<ManaType, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' };
