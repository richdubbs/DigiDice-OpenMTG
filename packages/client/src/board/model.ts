/**
 * The board's read model: everything the game board shows, derived from a `GameView` (docs/design/m8-client.md "Data flow": the UI renders only views from
 * `viewFor`, never a raw state). Pure functions, no engine calls except the read-only characteristics helpers (`getChars`, `isSummoningSick`) asked through
 * the view. A hidden object (`defId === HIDDEN_DEF`, CR 400.2) is never asked anything: its card back is all the board knows about it.
 */
import {
  HIDDEN_DEF, STEP_ORDER, getChars, isByHandKind, isSummoningSick,
  type CardDef, type Chars, type GameObject, type GameState, type GameView, type LegalAction, type ObjectId, type PlayerId, type PlayerState, type Step,
} from '@openmtg/engine';
import { faceDownName, isFaceDownObject } from '../cards/objectStatus';

/** The view as the read-only engine helpers expect a state: the parts a view leaves out are never read by them. Cached per view (the engine caches per state object). */
const AS_STATE = new WeakMap<GameView, GameState>();
export function stateOfView(view: GameView): GameState {
  let s = AS_STATE.get(view);
  if (!s) {
    const { viewer: _viewer, midAction: _midAction, ...rest } = view;
    s = { ...rest, seed: '', rng: [0, 0, 0, 0], suspended: null };
    AS_STATE.set(view, s);
  }
  return s;
}

export function isHidden(o: GameObject): boolean {
  return o.defId === HIDDEN_DEF;
}

/** The characteristics of a visible object after the layers (CR 613); null for a hidden object or when the engine can't compute them from the view. */
export function charsOf(view: GameView, o: GameObject): Chars | null {
  if (isHidden(o) || !view.defs[o.defId]) return null;
  try {
    return getChars(stateOfView(view), o.id);
  } catch {
    return null;
  }
}

export function defOf(view: GameView, o: GameObject): CardDef | null {
  return isHidden(o) ? null : (view.defs[o.defId] ?? null);
}

/**
 * A token whose definition is a card's (a token copy of a permanent or a card, CR 111.10, 707.2): its picture is that card's own, so the board marks it as a
 * token. A token made from a token definition ("Token Creature — Soldier") is not one: its picture already says token.
 */
export function isTokenCopy(o: GameObject, def: CardDef | null): boolean {
  if (o.kind !== 'token' || !def) return false;
  return def.layout !== 'token' && !def.faces.some((f) => /\bToken\b/.test(f.typeLine));
}

/**
 * A face-down object whose card the viewer may look at (their own face-down permanent or face-down exiled card, CR 708.5, 406.3): drawn as a card back on the
 * board, the real card only in the zoom. Face-down status means nothing in a hand or library (CR 708.2a).
 */
export function isKnownFaceDown(o: GameObject): boolean {
  return !isHidden(o) && o.faceDown === true && o.zone !== 'hand' && o.zone !== 'library';
}

/**
 * The face of a visible object that is up, mirroring the engine's `faceIndexOf` (rules/base-chars.ts): on the stack the cast face, on the battlefield the
 * flipped half of a flip card (CR 710.2) or the face up of a double-faced card (CR 711, 712), the front face everywhere else.
 */
export function shownFace(def: CardDef, o: GameObject): number {
  const last = Math.max(0, def.faces.length - 1);
  switch (o.zone) {
    case 'stack':
      return Math.min(o.stack?.face ?? o.face, last);
    case 'battlefield':
      if (def.layout === 'flip') return o.flipped && last >= 1 ? 1 : 0;
      return Math.min(o.face, last);
    default:
      return 0;
  }
}

/** "1 card", "3 cards". */
export function cardCount(n: number): string {
  return `${n} card${n === 1 ? '' : 's'}`;
}

export function playerName(view: GameView, id: PlayerId): string {
  return view.players.find((p) => p.id === id)?.name ?? id;
}

/** A display name for an object: its name after the layers, the source of an ability, or "Hidden card". */
export function objectName(view: GameView, id: ObjectId): string {
  const o = view.objects[id];
  if (!o) {
    const l = view.lki[id];
    return l ? (l.chars?.name || view.defs[l.object.defId]?.name || 'a card') : 'a card';
  }
  if (isHidden(o)) return o.faceDown ? 'Face-down permanent' : 'Hidden card';
  if (o.kind === 'ability') return `Ability of ${o.stack?.sourceName || view.defs[o.defId]?.name || 'a permanent'}`;
  const def = view.defs[o.defId];
  const chars = charsOf(view, o);
  if (isKnownFaceDown(o)) {
    // CR 708.2a: a face-down permanent is a nameless 2/2 unless effects change it; its controller may look at it (CR 708.5), so the real name follows.
    // M6-11: another player's face-down permanent or spell has the engine's pseudo-definition (no real name in the view): it is named by what is public,
    // how it came to be face down (CR 708.6), never by its card.
    const creature = chars !== null && chars.types.includes('Creature') && chars.power !== undefined && chars.toughness !== undefined;
    if (isFaceDownObject(o)) return faceDownName(view, o, creature ? chars : null);
    const real = def?.name ?? 'a card';
    return creature ? `Face-down ${chars.power}/${chars.toughness} creature (${real})` : `Face-down card (${real})`;
  }
  // `||`, not `??`: a name after the layers can be '' (CR 708.2a), which is no label.
  return chars?.name || (def ? def.faces[shownFace(def, o)]?.name : undefined) || def?.name || 'a card';
}

/** Name of a player or an object. */
export function targetName(view: GameView, id: string): string {
  return view.players.some((p) => p.id === id) ? playerName(view, id) : objectName(view, id);
}

/**
 * Which player sits at the bottom: the viewer; for a spectator view (hot-seat hand-off, CR 400.2) `stay` when given (the player who sat there a moment ago,
 * so the table does not turn around while the last move plays out), else the active player. The others sit at the top in turn order starting after the
 * bottom player.
 */
export function seating(view: GameView, stay?: PlayerId | null): { bottom: PlayerState; top: PlayerState[] } {
  const id = view.viewer ?? (stay && view.players.some((p) => p.id === stay) ? stay : view.turn.activePlayer);
  const i = Math.max(0, view.players.findIndex((p) => p.id === id));
  const order = [...view.players.slice(i), ...view.players.slice(0, i)];
  return { bottom: order[0]!, top: order.slice(1) };
}

// ---- permanents ------------------------------------------------------------------------------------------------------------------

export interface CombatRole {
  /** Attacking (CR 508.1): what it attacks (a player or a planeswalker or battle), null once that left combat (CR 506.4c). */
  attacking?: { defender: string | null; blocked: boolean };
  /** Blocking (CR 509.1): the attackers it blocks. */
  blocking?: ObjectId[];
}

export function combatRole(view: GameView, id: ObjectId): CombatRole {
  const c = view.combat;
  if (!c) return {};
  const role: CombatRole = {};
  const a = c.attackers.find((x) => x.id === id);
  if (a) role.attacking = { defender: a.defender, blocked: a.blocked };
  const b = c.blockers.find((x) => x.id === id);
  if (b) role.blocking = [...b.blocking];
  return role;
}

export interface PermanentInfo {
  id: ObjectId;
  obj: GameObject;
  hidden: boolean;
  name: string;
  chars: Chars | null;
  isLand: boolean;
  isCreature: boolean;
  /** CR 302.6: a creature that came under its controller's control since their most recent turn began (and has no haste). */
  summoningSick: boolean;
  combat: CombatRole;
  /** Auras, Equipment and Fortifications attached to it (CR 301.5, 303.4). */
  attachments: ObjectId[];
}

export function permanentInfo(view: GameView, o: GameObject): PermanentInfo {
  const chars = charsOf(view, o);
  let sick = false;
  if (chars) {
    try {
      sick = isSummoningSick(stateOfView(view), o, chars);
    } catch {
      sick = false;
    }
  }
  return {
    id: o.id,
    obj: o,
    hidden: isHidden(o),
    name: objectName(view, o.id),
    chars,
    isLand: chars?.types.includes('Land') ?? false,
    isCreature: chars?.types.includes('Creature') ?? false,
    summoningSick: sick,
    combat: combatRole(view, o.id),
    attachments: view.zones.battlefield.filter((id) => view.objects[id]?.attachedTo === o.id),
  };
}

/**
 * A player's permanents split into the battlefield's groups: the main line holds only creatures (a land creature too, and a
 * permanent whose characteristics are unknown), the lands sit at the left of the row behind it, and every other permanent (artifacts, enchantments,
 * planeswalkers, battles) at the right of that row. Attachments are listed under their host instead of on their own, so an Aura or Equipment on a creature
 * stays with it on the main line.
 */
export function battlefieldRows(view: GameView, player: PlayerId): { creatures: PermanentInfo[]; lands: PermanentInfo[]; others: PermanentInfo[] } {
  const creatures: PermanentInfo[] = [];
  const lands: PermanentInfo[] = [];
  const others: PermanentInfo[] = [];
  for (const id of view.zones.battlefield) {
    const o = view.objects[id];
    if (!o || o.controller !== player) continue;
    // Attached to a permanent that is on the battlefield: shown with its host (an Aura on another player's creature stays with that creature).
    if (o.attachedTo && view.objects[o.attachedTo]?.zone === 'battlefield') continue;
    const info = permanentInfo(view, o);
    (info.isCreature || !info.chars ? creatures : info.isLand ? lands : others).push(info);
  }
  return { creatures, lands, others };
}

// ---- the stack -------------------------------------------------------------------------------------------------------------------

export interface StackItem {
  id: ObjectId;
  kind: 'spell' | 'activated' | 'triggered';
  name: string;
  /** The ability's text ("~" replaced by its source's name), or the spell's rules text. */
  text: string;
  controller: PlayerId;
  /** Chosen targets in announcement order (CR 601.2c): object or player ids. */
  targets: string[];
  x?: number;
  isCopy: boolean;
}

function abilityText(view: GameView, o: GameObject): string {
  const st = o.stack;
  if (!st) return '';
  const source = st.sourceName ?? view.defs[o.defId]?.name ?? '';
  let text = st.inline?.text;
  if (text === undefined && st.abilityRef && (st.abilityRef.source === 'printed' || st.abilityRef.source === 'keyword')) {
    text = view.defs[o.defId]?.faces[st.abilityRef.face]?.abilities[st.abilityRef.index]?.text;
  }
  return (text ?? '').replace(/[~¤]/g, source); // r4-static: "¤", the card's own name inside a quoted ability it grants
}

/** The stack, top first (CR 405.2: the last object put on it is on top). */
export function stackItems(view: GameView): StackItem[] {
  const out: StackItem[] = [];
  for (const id of [...view.zones.stack].reverse()) {
    const o = view.objects[id];
    if (!o) continue;
    const st = o.stack;
    const kind = st?.kind ?? (o.kind === 'ability' ? 'activated' : 'spell');
    const def = defOf(view, o);
    const face = st?.face ?? o.face;
    // M6-11, CR 708.2a, 708.4: a face-down spell is a nameless 2/2 creature spell with no text (another player's has only the pseudo-definition).
    const faceDown = kind === 'spell' && isFaceDownObject(o);
    const item: StackItem = {
      id,
      kind,
      name: faceDown ? objectName(view, id) : kind === 'spell' ? (def?.faces[face]?.name || objectName(view, id)) : (st?.sourceName ?? def?.name ?? 'an ability'),
      text: faceDown ? '' : kind === 'spell' ? (def?.faces[face]?.oracleText ?? '') : abilityText(view, o),
      controller: o.controller,
      targets: (st?.targets ?? []).flat().map((t) => t.id),
      isCopy: st?.isCopy === true || o.kind === 'spellCopy',
    };
    if (st?.x !== undefined) item.x = st.x;
    out.push(item);
  }
  return out;
}

/** Every object or player some spell or ability on the stack targets, with the stack objects targeting it. */
export function targetedBy(view: GameView): Map<string, ObjectId[]> {
  const m = new Map<string, ObjectId[]>();
  for (const item of stackItems(view)) for (const t of item.targets) m.set(t, [...(m.get(t) ?? []), item.id]);
  return m;
}

// ---- turn structure ----------------------------------------------------------------------------------------------------------------

export const STEP_LABELS: Record<Step, string> = {
  untap: 'Untap', upkeep: 'Upkeep', draw: 'Draw', main1: 'Main 1', beginCombat: 'Combat', declareAttackers: 'Attackers',
  declareBlockers: 'Blockers', combatDamage: 'Damage', endCombat: 'End combat', main2: 'Main 2', end: 'End', cleanup: 'Cleanup',
};

/** Short step labels for narrow windows (below 1200px); the full label stays for screen readers and in the tooltip. */
export const STEP_SHORT: Record<Step, string> = {
  untap: 'Unt', upkeep: 'Upk', draw: 'Drw', main1: 'M1', beginCombat: 'Cmb', declareAttackers: 'Atk',
  declareBlockers: 'Blk', combatDamage: 'Dmg', endCombat: 'EoC', main2: 'M2', end: 'End', cleanup: 'Cln',
};

/** Steps in which no player normally receives priority, so a stop there means nothing: untap (CR 502.4) and cleanup (CR 514.3). */
export const NO_PRIORITY_STEPS: readonly Step[] = ['untap', 'cleanup'];

export const STEPS: readonly Step[] = STEP_ORDER;

// ---- legal actions -----------------------------------------------------------------------------------------------------------------

/**
 * The objects the shown player can do something with right now (CR 117.1): cards to play or cast and permanents with abilities. Mana abilities alone
 * (CR 605.3a) put an object in `manaOnly`: they are highlighted more quietly, like Arena. The by-hand tools for manual text (`manualTrigger`,
 * `manualStatic`, engine `isByHandKind`; FAST3 CL1) never make an object playable: a source with nothing else to do is in `byHand`, marked as having a
 * by-hand tool (docs/design/m8-client.md "the by-hand tools") rather than as playable.
 */
export function playableObjects(actions: readonly LegalAction[]): { playable: Set<ObjectId>; manaOnly: Set<ObjectId>; byHand: Set<ObjectId> } {
  const playable = new Set<ObjectId>();
  const mana = new Set<ObjectId>();
  const byHand = new Set<ObjectId>();
  for (const a of actions) {
    if (a.kind === 'pass' || a.object === undefined) continue;
    (isByHandKind(a.kind) ? byHand : a.isMana ? mana : playable).add(a.object);
  }
  for (const id of playable) {
    mana.delete(id);
    byHand.delete(id);
  }
  for (const id of mana) byHand.delete(id);
  return { playable, manaOnly: mana, byHand };
}

// ---- log ----------------------------------------------------------------------------------------------------------------------------

/** The turns that have log entries, in order (for the log's turn filter). */
export function logTurns(view: GameView): number[] {
  return [...new Set(view.log.map((e) => e.turn))].sort((a, b) => a - b);
}
