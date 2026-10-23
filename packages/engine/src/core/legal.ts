/**
 * Legal priority actions (CR 117.1): what a player who holds priority may do right now.
 *
 * Used by the UI (buttons), by bots and by Arena-style auto-pass (`hasPriorityActions`, which ignores
 * passing and mana abilities). The list is conservative: an action is listed only if the action
 * handler accepts it as a starting point (timing, zone, targets exist, the cost can be paid at X = 0).
 * Later decisions (modes, targets, payment) are answered through the decision model.
 */
import type { Action } from '../types/actions';
import type { ObjectId, PlayerId } from '../types/ids';
import type { GameState } from '../types/state';
import { activationDenial, manualManaDenial } from '../actions/activate';
import { castCheck, castMethods } from '../actions/cast';
import { landCheck } from '../actions/land';
import { activatedAbilities, activatesFrom, enumerateAbilities } from '../rules/abilities';
import { charsOfObject, faceChars, readingStable } from '../rules/characteristics';
import { assumingManaPayable, costText, planFromCostDef } from '../rules/cost';
import type { CostDef } from '../types/ability';
import { extraManaModes } from '../rules/sources';
import { HIDDEN_ZONES } from '../types/state';
import { byHandAbilities, byHandUser, type ByHandKind } from '../rules/by-hand';
import { Game } from './game';
import { SPECIAL_ACTION_HANDLERS } from './registries';
import { permittedObjects } from '../statics/play-permits';
import { isCommander, isCommanderGame } from '../statics/commander';
import { decidingPlayer } from './player-control';


const BY_HAND_KINDS: readonly ByHandKind[] = ['manualTrigger', 'manualStatic'];

/** MRE: the by-hand tools (manual triggered and static abilities), which never count as something to do for auto-pass. */
export const isByHandKind = (kind: LegalAction['kind']): boolean => kind === 'manualTrigger' || kind === 'manualStatic';

export interface LegalAction {
  /** The action to pass to applyAction. */
  action: Action;
  /**
   * `special` (M6-0, m6 design 2.3, D8): a special action (CR 116.2), listed through core/registries.ts#SPECIAL_ACTION_HANDLERS.
   * MRE (C6 gap 7): `manualTrigger` / `manualStatic` are the by-hand tools for manual triggered and static abilities (core/by-hand.ts). Always available while
   * such a permanent is around, so, like mana abilities, they never count as "something to do" for auto-pass (`hasPriorityActions`), and bots skip them.
   */
  kind: 'pass' | 'playLand' | 'cast' | 'activate' | 'special' | 'manualTrigger' | 'manualStatic';
  label: string;
  /** True for mana abilities: they never count as "something to do" for auto-pass (CR 605.3a, Arena-style). */
  isMana: boolean;
  /** The card or permanent the action is about. */
  object?: ObjectId;
}

/**
 * The cast actions that use an alternative cost (CR 118.9: flashback, evoke, escape, ...): one per method of the face that `castCheck` accepts. The method is the
 * name of the card's `alternativeCost` effect (actions/cast-options.ts).
 */
function methodActions(s: GameState, player: PlayerId, id: ObjectId, face: number, where = ''): LegalAction[] {
  const out: LegalAction[] = [];
  for (const method of castMethods(s, id, face, player)) {
    const r = castCheck(s, player, id, face, method);
    if ('info' in r) {
      out.push({
        action: { type: 'cast', player, card: id, ...(face > 0 ? { face } : {}), method }, kind: 'cast',
        label: method === 'flashback' ? `Cast ${r.info.chars.name} with flashback`
          // C10 (CR 601.3): one of several graveyard permissions, named by its source
          : r.info.gyPermit !== undefined ? `Cast ${r.info.chars.name} from your graveyard (${r.info.gyPermit.source})`
          // r3-cost (CR 118.9): an alternative cost another object's static ability gives the spell, named by its source
          : r.info.grantedAlt !== undefined ? `Cast ${r.info.chars.name}${where} (${r.info.grantedAlt.source}: ${costWords(r.info.grantedAlt.cost)})`
          : `Cast ${r.info.chars.name || 'face down'} (${method.replace(/:\d+$/, '')})${where}`, // FAST5X E2: `warp:2` is warp from the graveyard
        isMana: false, object: id, // AF2: a face-down spell has no name (CR 708.2a)
      });
    }
  }
  return out;
}

/** r3-cost: the words of an alternative cost in a label: "without paying its mana cost" for none, else the cost ("{W}{U}{B}{R}{G}"). */
const costWords = (c: CostDef): string => (Object.keys(c).length === 0 ? 'without paying its mana cost' : costText(planFromCostDef(c, 0)));

/** Every priority action `player` could take if they had priority in `s`. Pass is always first. */
export function listLegalActions(s: GameState, player: PlayerId): LegalAction[] {
  return readingStable(s, () => [...listIn(s, player)]); // pure: every check reads `s` and none changes it, so the characteristics cache is checked once (WP30)
}

/**
 * The priority actions in the order they are listed, produced one at a time (WP32: `hasPriorityActions` stops at the first one that counts, so a player who
 * can do something is not checked for everything else; the soak test's auto-pass asks this before every priority, and checking a cast is the costly part).
 */
function* listIn(s: GameState, player: PlayerId, publicOnly = false): Generator<LegalAction> {
  yield { action: { type: 'pass', player }, kind: 'pass', label: 'Pass priority', isMana: false };
  const z = s.zones;

  for (const id of publicOnly ? [] : z.hand[player] ?? []) {
    const o = s.objects[id];
    const def = o && s.defs[o.defId];
    if (!o || !def) continue;
    // Lands (a modal double-faced card may offer each land face).
    const faces = def.layout === 'modal_dfc' ? def.faces.map((_, i) => i) : [0];
    for (const face of faces) {
      const r = landCheck(s, player, id, face);
      if ('face' in r) {
        const name = faceChars(def, face).name;
        yield { action: { type: 'playLand', player, card: id, ...(face > 0 ? { face } : {}) }, kind: 'playLand', label: `Play ${name}`, isMana: false, object: id };
      }
    }
    for (let face = 0; face < def.faces.length; face++) {
      const r = castCheck(s, player, id, face);
      if ('info' in r) {
        yield { action: { type: 'cast', player, card: id, ...(face > 0 ? { face } : {}) }, kind: 'cast', label: `Cast ${r.info.chars.name}`, isMana: false, object: id };
      }
      yield* methodActions(s, player, id, face);
    }
    // Both halves of a split card with fuse (CR 702.102a).
    if (def.layout === 'split') {
      const r = castCheck(s, player, id, undefined, 'fuse');
      if ('info' in r) {
        yield { action: { type: 'cast', player, card: id, method: 'fuse' }, kind: 'cast', label: `Cast ${r.info.chars.name} (fused)`, isMana: false, object: id };
      }
    }
  }

  // Flashback (CR 702.34a) and aftermath halves (CR 702.127a) from the graveyard.
  for (const id of z.graveyard[player] ?? []) {
    const o = s.objects[id];
    const def = o && s.defs[o.defId];
    if (!o || !def) continue;
    for (let face = 0; face < def.faces.length; face++) {
      const after = castCheck(s, player, id, face);
      if ('info' in after) {
        yield { action: { type: 'cast', player, card: id, ...(face > 0 ? { face } : {}) }, kind: 'cast', label: `Cast ${after.info.chars.name}`, isMana: false, object: id };
      }
      yield* methodActions(s, player, id, face);
    }
  }

  // A card on an adventure may be cast from exile (CR 715.3d).
  for (const id of z.exile) {
    const o = s.objects[id];
    if (!o || o.owner !== player || (publicOnly && o.faceDown)) continue;
    if (o.chosen?.onAdventure === true) {
      const r = castCheck(s, player, id, 0);
      if ('info' in r) yield { action: { type: 'cast', player, card: id }, kind: 'cast', label: `Cast ${r.info.chars.name} from exile`, isMana: false, object: id };
    }
    yield* methodActions(s, player, id, 0); // an alternative cost that casts from exile
  }

  // M11-1, CR 903.8: a commander the player owns may be cast from the command zone (a public zone, CR 903.6), with its tax in the cost (actions/cast.ts)
  if (isCommanderGame(s)) {
    for (const id of z.command) {
      const o = s.objects[id];
      const def = o && s.defs[o.defId];
      if (!o || !def || o.owner !== player || !isCommander(s, o)) continue;
      for (let face = 0; face < def.faces.length; face++) {
        const r = castCheck(s, player, id, face);
        if ('info' in r) yield { action: { type: 'cast', player, card: id, ...(face > 0 ? { face } : {}) }, kind: 'cast', label: `Cast ${r.info.chars.name} from the command zone`, isMana: false, object: id };
        yield* methodActions(s, player, id, face, ' from the command zone'); // CMDF: face down, mutate, prototype, converted (actions/cast-opt/zones.ts)
      }
    }
  }

  // FAST4 T31 (CR 601.2a, 305.1, 611.2): cards an effect lets this player play from where they are ("you may play that card this turn",
  // statics/play-permits.ts). A card in the player's own graveyard is cast through the graveyard listing above; a card on an adventure through the exile one.
  // They are public information unless face down (CR 400.2, 406.3).
  for (const id of permittedObjects(s, player, true)) {
    const o = s.objects[id];
    const def = o && s.defs[o.defId];
    if (!o || !def || (publicOnly && o.faceDown)) continue;
    const faces = def.layout === 'modal_dfc' ? def.faces.map((_, i) => i) : [0];
    for (const face of faces) {
      const r = landCheck(s, player, id, face);
      if ('face' in r) yield { action: { type: 'playLand', player, card: id, ...(face > 0 ? { face } : {}) }, kind: 'playLand', label: `Play ${faceChars(def, face).name} from ${o.zone}`, isMana: false, object: id };
    }
  }
  for (const id of permittedObjects(s, player, false)) {
    const o = s.objects[id];
    const def = o && s.defs[o.defId];
    if (!o || !def || (publicOnly && o.faceDown) || (o.zone === 'graveyard' && o.owner === player) || o.chosen?.onAdventure === true) continue;
    for (let face = 0; face < def.faces.length; face++) {
      const r = castCheck(s, player, id, face);
      if ('info' in r) yield { action: { type: 'cast', player, card: id, ...(face > 0 ? { face } : {}) }, kind: 'cast', label: `Cast ${r.info.chars.name} from ${o.zone}`, isMana: false, object: id };
      // r3-cost (CR 118.9): and with an alternative cost another object gives it (a card the player owns in exile is listed by the exile loop above)
      if (!(o.zone === 'exile' && o.owner === player && face === 0)) yield* methodActions(s, player, id, face, ` from ${o.zone}`);
    }
  }

  // Activated abilities: of permanents the player controls, and of cards in other zones that function there. M11-1 (`feature:zone.command`, CR 113.6,
  // 702.49d): the player's cards in the command zone (commander ninjutsu); emblems are not cards and keep their abilities out of this list.
  const commandCards = z.command.filter((id) => s.objects[id]?.kind === 'card' && s.objects[id]?.owner === player);
  const holders: ObjectId[] = [...z.battlefield, ...(publicOnly ? [] : z.hand[player] ?? []), ...(z.graveyard[player] ?? []), ...commandCards];
  for (const id of holders) {
    const o = s.objects[id];
    if (!o) continue;
    for (const info of activatedAbilities(s, o)) {
      if (!activatesFrom(info.def, o.zone)) continue;
      if (activationDenial(s, player, o, info)) continue;
      yield { action: { type: 'activate', player, source: id, ability: info.key }, kind: 'activate', label: `${charsOfObject(s, o).name}: ${info.def.text}`, isMana: info.def.isMana === true, object: id };
    }
  }
  // MRE (C6 gap 7): manual triggered abilities the player says triggered (CR 603.2, 603.3) and manual static abilities applied by hand (CR 604.1), of their
  // permanents and of their cards in other public zones where the ability functions (rules/by-hand.ts). Listed only when such an ability exists.
  for (const id of [...z.battlefield, ...(z.graveyard[player] ?? []), ...z.exile, ...z.command]) {
    const o = s.objects[id];
    if (!o || byHandUser(o) !== player) continue;
    for (const kind of BY_HAND_KINDS) {
      for (const info of byHandAbilities(s, o, kind)) {
        const what = kind === 'manualTrigger' ? 'it triggered: put it on the stack by hand' : 'apply it by hand';
        yield { action: { type: kind, player, source: id, ability: info.key }, kind, label: `${charsOfObject(s, o).name}: ${info.def.text} (${what})`, isMana: false, object: id };
      }
    }
  }
  // Mana abilities the recognizer rejected (painlands, Ancient Tomb, ...): activated by hand (CR 605.3b).
  for (const id of z.battlefield) {
    const o = s.objects[id];
    if (!o || o.controller !== player) continue;
    for (const info of enumerateAbilities(s, o)) {
      if (info.def.kind !== 'manual' || !info.def.mana || manualManaDenial(s, player, o, info.def, info.key)) continue;
      yield { action: { type: 'activate', player, source: id, ability: info.key }, kind: 'activate', label: `${charsOfObject(s, o).name}: ${info.def.text} (by hand)`, isMana: true, object: id };
    }
  }
  // M6-0 (m6 design D8, 2.6): special actions (CR 116.2), any time the player has priority. Each handler lists what it allows (none in M6-0: the keyword
  // stubs list nothing; turning face up arrives with M6-3). A special action on an object in a hidden zone is not public information (CR 400.2).
  if (SPECIAL_ACTION_HANDLERS.length > 0) {
    const g = new Game(s); // a reading view: listing changes nothing
    for (const h of SPECIAL_ACTION_HANDLERS) {
      for (const x of h.list(g, player)) {
        const o = x.object !== undefined ? s.objects[x.object] : undefined;
        if (publicOnly && o !== undefined && HIDDEN_ZONES.includes(o.zone)) continue;
        const via = x.via as Extract<Action, { type: 'special' }>['via'] | undefined;
        // CMP1: an action about no object (the companion, CR 116.2g) is listed without one
        const at = x.object !== undefined ? { object: x.object } : {};
        yield { action: { type: 'special', player, kind: h.kind, ...at, ...(via !== undefined ? { via } : {}), ...(x.door !== undefined ? { door: x.door } : {}), ...(x.option !== undefined ? { option: x.option } : {}) }, kind: 'special', label: x.label, isMana: false, ...at };
      }
    }
  }
}

/**
 * The legal priority actions of `player` in `state`. Empty unless the game is waiting for this player at priority.
 * Every action returned is accepted by applyAction (the engine's soak test checks this).
 * std-control-3 (CR 723.5): while `player` controls the player with priority, these are that player's actions (they name that player); the controlled player
 * themselves has none.
 */
export function legalActions(state: GameState, player: PlayerId): LegalAction[] {
  const d = state.pending;
  if (!d || d.kind !== 'priority' || decidingPlayer(d) !== player || state.suspended || state.result) return [];
  return listLegalActions(state, d.player);
}

/** Does this action count as "something to do" for auto-pass? Not passing, mana abilities (CR 605.3a) or the by-hand tools (MRE, always available). */
const counts = (a: LegalAction): boolean => a.kind !== 'pass' && !a.isMana && !isByHandKind(a.kind);

/**
 * Whether a player has any priority action besides passing, mana abilities and the by-hand tools (drives Arena-style auto-pass).
 *
 * AP1 review: the payment check
 * counts only the mana abilities the engine runs (rules/sources.ts), so mana from an ability the player activates by hand (CR 605.3b: a painland's colored
 * ability, City of Brass, Ancient Tomb, Mana Confluence) is invisible to it. While the player can activate such an ability, an action that would be legal if its
 * mana could be paid counts too (`assumingManaPayable`): the engine can't tell whether that mana is enough, so it stops for the player instead of passing for
 * them silently. Timing, targets and the other cost parts are still checked (a creature card without flash does not stop them in response, CR 307.1).
 */
export function hasPriorityActions(g: Game, p: PlayerId): boolean {
  return readingStable(g.s, () => {
    for (const a of listIn(g.s, p)) if (counts(a)) return true; // the same answer as the whole list, stopping at the first (WP32)
    if (!hasManualManaAbility(g.s, p)) return false;
    return assumingManaPayable(() => {
      for (const a of listIn(g.s, p)) if (counts(a)) return true;
      return false;
    });
  });
}

/** Whether `p` can activate now a mana ability the engine leaves to the player (CR 605.3b; the "(by hand)" mana actions of `listIn`). */
function hasManualManaAbility(s: GameState, p: PlayerId): boolean {
  for (const id of s.zones.battlefield) {
    const o = s.objects[id];
    if (!o || o.controller !== p) continue;
    for (const info of enumerateAbilities(s, o)) {
      if (info.def.kind === 'manual' && info.def.mana && !manualManaDenial(s, p, o, info.def, info.key)) return true;
    }
  }
  // FAST5X E5: a mana ability the automatic payer never activates ("{T}, Pay 1 life: Add one mana of any color", "Tap an untapped creature you control: ..."):
  // the player can make that mana, which the payment check does not count either (CR 605.3a)
  return extraManaModes(s, p).byHand.length > 0;
}

/**
 * M2 (audit 2026-10-12; CR 400.2): whether a player has a priority action besides passing and mana abilities that every player can know about: the cards in
 * their hand are left out (and so is a face-down card in exile), so the answer reads only public information. Auto-pass uses it (core/turn.ts).
 */
export function hasPublicPriorityActions(g: Game, p: PlayerId): boolean {
  return readingStable(g.s, () => {
    for (const a of listIn(g.s, p, true)) if (counts(a)) return true;
    return false;
  });
}
