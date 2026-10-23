/**
 * Turning a face-down permanent face up, the special action (CR 116.2b, 702.37e, 702.168d, 701.40b, 701.58b; m6 design D8, E8, 3.4). Owner: M6-3.
 *
 * Listed when the player has priority (core/legal.ts) for each face-down permanent the player controls, once per procedure (`via`) that is available and
 * payable now (X = 0 for a cost with X):
 *   (a) morph, megamorph, disguise: the cost the permanent WOULD have if it were face up (`faceUpHypothetical`: without its 1b effect, with its 1a copy effects,
 *       CR 702.37e, 702.168d, 707.3): a face-down Grinning Demon that became a copy of Branchsnap Lorian turns up for {G}; one that became a copy of Wandering
 *       Ones has no morph if face up and can't be turned up this way;
 *   (b) manifest, cloak: the representing CARD is a creature card with a mana cost: that cost (CR 701.40b, 701.58b; this reads the card, not a copy). A
 *       manifested card with morph or disguise lists both (CR 701.40c-d, 701.58c-d).
 * Performing it (choose X, pay with cancellable decisions, CR 733.1; propose `turnFaceUp`) is done by effects/handlers/face-ops.ts, which installs itself here
 * when it loads: this module is reached from core/registries.ts, which core/zones.ts imports, so it may import neither the cost payer nor the proposal pipeline
 * (both import core/zones.ts: an import cycle).
 */
import type { CostDef } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import { formatManaCost } from '../../types/mana';
import type { GameState } from '../../types/state';
import { charsOfObject, faceChars, type Chars } from '../../rules/characteristics';
import { modifyMana, type CostModHit } from '../../statics/costmods';
import { charsViewOf } from '../../statics/rule-sources';
import { EngineBug, IllegalAction, type Game } from '../game';
import type { SpecialActionHandler } from '../registries';

/** How a face-down permanent may be turned face up (CR 702.37e, 702.168d, 701.40b, 701.58b). */
export type FaceUpVia = 'morph' | 'megamorph' | 'disguise' | 'manifest' | 'cloak';

export interface FaceUpProcedure {
  via: FaceUpVia;
  cost: CostDef;
}

/**
 * The characteristics the face-down permanent would have if it were face up (statics/api.ts#FaceUpHypothetical; CR 702.37e, 702.168d, 708.8): computed on a
 * copy of the state in which it is face up (its 1b effect gone, its 1a copy effects kept). Pure.
 */
export function faceUpHypothetical(s: GameState, id: ObjectId): Chars {
  const o = s.objects[id];
  if (!o) throw new EngineBug(`faceUpHypothetical: no object ${id}`);
  const { faceDownInfo: _info, ...rest } = o;
  const up = { ...rest, faceDown: false, face: 0 }; // CR 712.15a: a double-faced card turns up front face up
  return charsOfObject({ ...s, objects: { ...s.objects, [id]: up } }, up);
}

const FACE_UP_KEYWORDS: readonly FaceUpVia[] = ['morph', 'megamorph', 'disguise'];

/** The procedures that can turn this face-down permanent face up now, with their costs (see the file comment). Pure. */
export function turnFaceUpProcedures(s: GameState, id: ObjectId): FaceUpProcedure[] {
  const o = s.objects[id];
  if (!o || !o.faceDown || o.zone !== 'battlefield' || o.kind === 'ability') return [];
  const out: FaceUpProcedure[] = [];
  const seen = new Set<string>();
  const add = (p: FaceUpProcedure): void => {
    const k = `${p.via}|${JSON.stringify(p.cost)}`;
    if (!seen.has(k)) { seen.add(k); out.push(p); }
  };
  // (a) CR 702.37e, 702.168d: the morph / megamorph / disguise cost it would have if it were face up
  for (const k of faceUpHypothetical(s, id).keywords) {
    if (!(FACE_UP_KEYWORDS as readonly string[]).includes(k.keyword) || !k.cost) continue;
    // std-freecast-4 (CR 702.168a, 601.2f-like, 118.7; cites unverified): "Disguise {5}{R}. This cost is reduced by {1} for each instant and sorcery card in your
    // graveyard.": the keyword's own cost change, read now with the permanent's controller as "you"; one that can't be worked out leaves the procedure out (fail closed)
    if (k.costChange !== undefined) {
      const hit: CostModHit = {
        def: { s: 'costMod', applies: { abilities: {}, caster: 'you' }, change: k.costChange },
        source: id, controller: o.controller, name: k.keyword, text: k.keyword,
        cx: { s, all: charsViewOf(s), source: id, controller: o.controller },
      } as CostModHit;
      const r = modifyMana(k.cost.mana ?? [], [hit]);
      if ('unknown' in r) continue;
      const { mana: _mana, ...rest } = k.cost;
      add({ via: k.keyword as FaceUpVia, cost: r.mana.length > 0 ? { ...rest, mana: r.mana } : rest });
      continue;
    }
    add({ via: k.keyword as FaceUpVia, cost: k.cost });
  }
  // (b) CR 701.40b, 701.58b: a manifested or cloaked permanent represented by a creature card: that card's mana cost
  const by = o.faceDownInfo?.by;
  const def = s.defs[o.defId];
  if ((by === 'manifest' || by === 'cloak') && o.kind === 'card' && def && !def.stub) {
    const card = faceChars(def, 0);
    if (card.types.includes('Creature') && card.manaCost !== null) add({ via: by, cost: { mana: card.manaCost } });
  }
  return out;
}

/** What performs the action (installed by effects/handlers/face-ops.ts, see the file comment). */
export interface TurnFaceUpImpl {
  /** Could `player` pay this cost now (at X = 0 for a cost with X; CR 601.2h, 118.3)? */
  payable(s: GameState, player: PlayerId, id: ObjectId, cost: CostDef): boolean;
  /** Choose X, pay (cancellable decisions, CR 733.1) and turn the permanent face up through the proposal pipeline. */
  perform(g: Game, player: PlayerId, id: ObjectId, p: FaceUpProcedure, x: number | undefined): void;
  /** FAST5X E25 (CR 708.7, 101.2): a "can't be turned face up" effect forbids it now (statics/hooks.ts#ruleDenial, `beTurnedFaceUp`). */
  denied?(s: GameState, id: ObjectId): boolean;
}
let impl: TurnFaceUpImpl | null = null;
export function installTurnFaceUp(f: TurnFaceUpImpl | null): void {
  impl = f;
}

/** The card's name for the player who may look at it (CR 708.5: its controller). */
function ownName(s: GameState, id: ObjectId): string {
  const o = s.objects[id]!;
  const def = s.defs[o.defId];
  return def?.faces[o.face]?.name ?? def?.name ?? 'a face-down creature';
}

const costText = (c: CostDef): string => (c.mana ? formatManaCost(c.mana) : 'its cost');

function listed(g: Game, player: PlayerId): { object: ObjectId; via: FaceUpVia; label: string; cost: CostDef }[] {
  if (!impl) return []; // fail closed: nothing to perform it with
  const s = g.s;
  const out: { object: ObjectId; via: FaceUpVia; label: string; cost: CostDef }[] = [];
  for (const id of s.zones.battlefield) {
    const o = s.objects[id];
    if (!o || !o.faceDown || o.phasedOut || charsOfObject(s, o).controller !== player) continue; // CR 702.37e: a face-down permanent you control
    if (impl.denied?.(s, id) === true) continue; // FAST5X E25: "can't be turned face up" (CR 708.7, 101.2)
    for (const p of turnFaceUpProcedures(s, id)) {
      if (!impl.payable(s, player, id, p.cost)) continue;
      out.push({ object: id, via: p.via, label: `Turn ${ownName(s, id)} face up (${p.via} ${costText(p.cost)})`, cost: p.cost });
    }
  }
  return out;
}

export const TURN_FACE_UP_HANDLERS: readonly SpecialActionHandler[] = [
  {
    kind: 'turnFaceUp',
    list: (g, player) => listed(g, player),
    perform: (g, action) => {
      const options = action.object === undefined ? [] : listed(g, action.player).filter((x) => x.object === action.object);
      const pick = action.via !== undefined ? options.filter((x) => x.via === action.via) : options;
      if (pick.length === 0) throw new IllegalAction('That permanent can\'t be turned face up that way now.', ['CR 116.1', 'CR 116.2b', 'CR 702.37e', 'CR 702.168d', 'CR 701.40b']);
      if (action.via === undefined && new Set(pick.map((x) => x.via)).size > 1) throw new IllegalAction('Say which way to turn it face up (via).', ['CR 701.40c', 'CR 701.40d']);
      impl!.perform(g, action.player, action.object!, { via: pick[0]!.via, cost: pick[0]!.cost }, action.x);
    },
  },
];
