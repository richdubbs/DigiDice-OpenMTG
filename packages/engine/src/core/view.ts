/**
 * Hidden information (CR 400.2): a per-player view of the game. Hands and libraries are
 * hidden zones; face-down permanents are hidden from opponents (CR 708). A view never
 * contains the RNG state, the suspended base state, or definitions of unseen cards.
 */
import { clone } from '../util/clone';
import type { EventContext, GameObject, GameState, HistoryEntry, LastKnown, LogEntry } from '../types/state';
import type { Decision } from '../types/decisions';
import type { ObjectId, PlayerId } from '../types/ids';
import { FACE_DOWN_DEF_IDS } from '../types/card';
import { nextUint32, seedRng } from '../rng';
import { VIEW_PARTS } from './registries';
import { faceDownVisibleTo, topCardRevealed, topCardVisibleTo } from '../statics/play-permits';
import { controllerOfPlayer, playersControlledBy } from './player-control';

export const HIDDEN_DEF = '__hidden__';

/**
 * RPL-0 (replays design 5.5): the version of the `GameView` shape. A replay's recording stores views, so a client reads one only if it understands its
 * view schema (an older one through an adapter). Bump it whenever `GameView` changes in a way an older client would misread (a field renamed, removed or
 * given another meaning); a new optional field that older clients may ignore needs no bump.
 */
export const ENGINE_VIEW_SCHEMA = 1;

export interface GameView extends Omit<GameState, 'rng' | 'suspended' | 'seed'> {
  /** The player this view is for; null = spectator (sees only public information). */
  viewer: PlayerId | null;
  /** True if the game is in the middle of an action waiting for a decision. */
  midAction: boolean;
  /** RPL-0 (additive): present only in the open view of a replay (`openView`: every card shown, `viewer` null); `viewFor` never sets it. */
  open?: true;
}

export function canSee(state: GameState, o: GameObject, viewer: PlayerId | null): boolean {
  if (canSeeAs(state, o, viewer)) return true;
  // std-control-3 (CR 723.4): the player who controls another player sees what that player can see
  return state.playerControl !== undefined && viewer !== null && playersControlledBy(state, viewer).some((p) => canSeeAs(state, o, p));
}

function canSeeAs(state: GameState, o: GameObject, viewer: PlayerId | null): boolean {
  if (o.revealedTo && viewer && o.revealedTo.includes(viewer)) return true;
  switch (o.zone) {
    case 'library':
      // FAST5X E14 (CR 401.5): "You may look at the top card of your library any time": that card, for that player only (statics/play-permits.ts)
      // p2-dig-1 (CR 401.2, 401.5): "Play with the top card of your library revealed": that card, for every player (topCardRevealed)
      if (o.kind === 'card' && topCardRevealed(state, o.id, o.owner)) return true;
      return viewer !== null && viewer === o.owner && o.kind === 'card' && topCardVisibleTo(state, o.id, o.owner, viewer);
    case 'hand':
      return viewer === o.owner;
    default:
      // FAST5X E25 (CR 406.3): a card exiled face down can't be examined by any player, except the players who may keep looking at it (`revealedTo`, above: the
      // ones who saw it as it was exiled face down, effects/handlers/zones-move.ts, or an instruction lets look at it, core/zones.ts#showCards)
      if (o.faceDown && o.zone === 'exile') return false;
      // Face-down objects: only their controller may look at them (CR 708.5), and a player an effect lets look at it (FAST5X E25, CR 609.4: "you may look at
      // face-down creatures your opponents control any time", statics/play-permits.ts#faceDownVisibleTo)
      if (o.faceDown) return (viewer !== null && (viewer === o.controller || faceDownVisibleTo(state, o.id, viewer))) || revealedFaceDown(state, o);
      return true;
  }
}

/**
 * M6-3, CR 708.9: face-down permanents and spells are revealed when their owner leaves the game and at the end of the game (every one of them). A card exiled
 * face down is not a face-down permanent or spell: it stays hidden.
 */
function revealedFaceDown(state: GameState, o: GameObject): boolean {
  if (o.zone !== 'battlefield' && o.zone !== 'stack') return false;
  return (state.result ?? null) !== null || state.players.some((p) => p.id === o.owner && p.hasLost === true);
}

/** The players who may see `o` where it is now (CR 400.2): the `privateText` audience of a log line that names a card in a hidden zone. */
export function seersOf(state: GameState, o: GameObject): PlayerId[] {
  return state.players.filter((p) => canSee(state, o, p.id)).map((p) => p.id);
}

/**
 * A log line about a card that names it only to the players who could see it (CR 400.2, 701.23e): `named` when every player saw the card (it was in or went to
 * a public zone, or it was revealed), otherwise `anonymous` publicly with `named` as private text for `seers`.
 */
export function cardLine(state: GameState, seers: Iterable<PlayerId>, named: string, anonymous: string): { text: string; privateText?: { players: PlayerId[]; text: string } } {
  const who = new Set(seers);
  if (state.players.every((p) => who.has(p.id))) return { text: named };
  const players = state.players.map((p) => p.id).filter((p) => who.has(p));
  return players.length > 0 ? { text: anonymous, privateText: { players, text: named } } : { text: anonymous };
}

/**
 * An object the viewer cannot see (H1, CR 400.2). Nothing on it may tell it apart from another card the viewer cannot see, or link it to a card the
 * viewer saw before:
 *  - in a hidden zone (a library, another player's hand) it is a blank card: its id, kind, owner, controller and zone only. `cardId` names the physical
 *    card and stays the same across zone changes; the timestamp and creation turn tell when the object was made (the order cards were drawn in, which card
 *    was put into the library later); the face and who it was revealed to are not public either. The id says no more than what everybody saw happen
 *    (a card put on top of a library from a graveyard is known to be the top card): a shuffle, a reorder and an arrangement nobody else may learn
 *    (CR 401.4, "in a random order") give library cards new ids (`core/zones.ts`), every other move makes a new object (CR 400.7), and no last known
 *    information shown to a player links an old id to an object that player can't see (`shownLki`; the events: core/view-events.ts).
 *  - face down in a public zone (CR 708.2, 708.6) it keeps what everybody sees of the face-down object (tapped, counters on the battlefield, damage,
 *    attachments, and when it entered and came under its controller's control, which summoning sickness reads, CR 302.6), and loses `cardId`, its face
 *    and what it remembers (`chosen`, CR 607 links, cast history, stack details).
 */
function hiddenObject(o: GameObject): GameObject {
  if (o.zone === 'library' || o.zone === 'hand') {
    return {
      id: o.id, kind: o.kind, defId: HIDDEN_DEF, owner: o.owner, controller: o.controller, zone: o.zone, timestamp: 0, tapped: false, flipped: false,
      faceDown: false, phasedOut: false, face: 0, controlledSinceTurn: 0, counters: {}, damage: 0, deathtouchDamaged: false,
    };
  }
  // CR 607 link store and cast history say what the object remembers (a chosen card name...): hidden like `chosen`. `commanderMoved` (CR 903.9a, 704.6d)
  // would mark a card exiled face down as a commander (CR 406.3a, 400.2): hidden too.
  const {
    cardId: _card, stack: _stack, chosen: _chosen, links: _links, cast: _cast, faceDownInfo: _info, faceUpX: _x, components: _components, commanderMoved: _cm,
    hiddenCommanderDamage: _hcd, // M11-1 review finding 2: a face-down commander's combat damage (CR 400.2, 708.2)
    ...seen
  } = clone(o);
  if (o.zone === 'battlefield' || o.zone === 'stack') {
    // M6-3 (m6 design D7, E7, 3.4): a face-down permanent or spell is shown as the public pseudo-definition of its profile, so getChars works on the view
    // (a 2/2, a 3/3 under an anthem, ward {2} for disguise and cloak). What put it face down is public (CR 708.6) except that a megamorph is announced as a
    // morph (CR 702.37b-c); a spell keeps its targets, its controller and where it was cast from, and its alternative cost is the public method.
    const profile = o.faceDownInfo?.profile ?? 'plain';
    return {
      ...seen, defId: FACE_DOWN_DEF_IDS[profile], face: 0, flipped: false, counters: o.zone === 'battlefield' ? { ...o.counters } : {},
      ...(o.faceDownInfo ? { faceDownInfo: { by: publicMethod(o.faceDownInfo.by), profile } } : {}),
      ...(o.stack ? { stack: publicStack(o.stack) } : {}),
      ...(o.components ? { components: o.components.map((c) => (c.faceDown ? { kind: c.kind, defId: FACE_DOWN_DEF_IDS.plain, owner: c.owner, faceDown: true } : { ...c })) } : {}),
    };
  }
  return { ...seen, defId: HIDDEN_DEF, face: 0, flipped: false, counters: {} }; // CR 406.3a: a card exiled face down shows nothing
}

/** CR 702.37b-c: a megamorph cost is a morph cost, and casting announces only a morph ability (the difference is revealed with the card). */
const publicMethod = <T extends string>(by: T): T => (by === 'megamorph' ? 'morph' : by) as T;

/** What other players see of a face-down spell on the stack (m6 design 3.4): its targets, where it was cast from, the public method of its alternative cost. */
function publicStack(st: NonNullable<GameObject['stack']>): NonNullable<GameObject['stack']> {
  return {
    kind: st.kind, face: 0, targets: st.targets.map((t) => t.map((x) => ({ ...x }))),
    costsPaid: st.costsPaid.alternative !== undefined ? { alternative: publicMethod(st.costsPaid.alternative) } : {},
    ...(st.castFrom !== undefined ? { castFrom: st.castFrom } : {}),
  };
}

/**
 * What other players see of a decision: who has to decide, not what it is about (a prompt such as "Choose a value for X for
 * Fireball" would name a card the player may still take back, CR 733.1).
 */
function redactDecision(d: Decision | null, viewer: PlayerId | null): Decision | null {
  if (!d || d.player === viewer || (d.decidedBy !== undefined && d.decidedBy === viewer)) return d; // std-control-3: the controller answers it (CR 723.5)
  return { kind: 'priority', id: d.id, player: d.player, prompt: d.kind === 'priority' ? 'Waiting for the other player: priority' : 'Waiting for the other player to decide.' } as Decision;
}

/**
 * Last known information is public unless the object left a hidden zone: a card that left a library is hidden from everybody, one that left a hand is visible
 * to its owner (CR 400.2). The same rule decides `lki`, the look-back snapshots of event contexts and the subjects of history entries (and, in
 * core/view-events.ts, the events). A face-down object (CR 406.3, 708.2) is seen only by its controller and the players it was revealed to, unless it is
 * revealed as it moves: from the battlefield to any zone, or from the stack to any zone but the battlefield (CR 708.9).
 */
export function lkiVisible(state: GameState, l: LastKnown, viewer: PlayerId | null): boolean {
  if (lkiVisibleAs(state, l, viewer)) return true;
  return state.playerControl !== undefined && viewer !== null && playersControlledBy(state, viewer).some((p) => lkiVisibleAs(state, l, p)); // std-control-3 (CR 723.4)
}

function lkiVisibleAs(state: GameState, l: LastKnown, viewer: PlayerId | null): boolean {
  if (l.leftZone === 'library' || l.leftZone === 'hand') return l.leftZone === 'hand' && viewer !== null && viewer === l.object.owner;
  if (!l.object.faceDown || l.leftZone === 'battlefield') return true;
  // FAST5X E25 (CR 406.3): a card that was exiled face down is seen only by the players who could look at it there
  if (viewer !== null && ((viewer === l.object.controller && l.leftZone !== 'exile') || l.object.revealedTo?.includes(viewer))) return true;
  if (l.leftZone !== 'stack') return false;
  const next = l.newId === undefined ? undefined : state.objects[l.newId]?.zone ?? state.lki[l.newId]?.leftZone;
  return next !== undefined && next !== 'battlefield';
}

/**
 * Last known information as the viewer is shown it (H1, CR 400.2, 401.4): `newId` names the object the card became only when the viewer can see that object
 * (or its own last known information). A card put into a library from a public zone at a place nobody else may learn, or renewed there since, is not linked
 * to its place in the library.
 */
function shownLki(state: GameState, l: LastKnown, viewer: PlayerId | null): LastKnown {
  if (l.newId === undefined) return l;
  const now = state.objects[l.newId];
  const next = state.lki[l.newId];
  if (now ? canSee(state, now, viewer) : next !== undefined && lkiVisible(state, next, viewer)) return l;
  const { newId: _newId, ...rest } = l;
  return rest;
}

/** An event context without the snapshots of objects the viewer may not see (`roles` hold only ids and zones: no identity). */
function redactEvent(state: GameState, ctx: EventContext, viewer: PlayerId | null): EventContext {
  const before: EventContext['before'] = {};
  for (const [id, l] of Object.entries(ctx.before)) if (lkiVisible(state, l, viewer)) before[id] = shownLki(state, l, viewer);
  return { ...ctx, before };
}

/**
 * A history entry about a card the viewer can't see keeps what is public (the turn, the kind of event, the actor) and loses its subject and its facts, which
 * are "characteristics good enough to re-run an ObjectFilter" (a name, a zone...): that would be the card's identity (CR 400.2). A subject that is neither an
 * object nor last known information is a library card a shuffle or a reorder renewed (H1: nothing records the old id): hidden.
 *
 * NETFIX2 (CR 400.2, audit m4): the facts name objects too, as they were at the event (`id`, and `source.id`, `attacker.id`, `by.id` for the other object
 * of an event: rules/history.ts `objectFacts`). A card discarded from another player's hand is public in the graveyard, but the `id` fact of its discard is
 * its id in the hand, which the view hides (an id tells when the card was drawn): every id fact that names an object the view does not show by that id
 * (`idShown`) is blanked (''), and the entry keeps its visible subject and its other facts. The rules read the history of the game state, never a view's.
 */
function redactHistory(state: GameState, entry: HistoryEntry, viewer: PlayerId | null): HistoryEntry {
  if (entry.subject !== undefined) {
    const o = state.objects[entry.subject];
    const l = state.lki[entry.subject];
    const visible = o ? canSee(state, o, viewer) : l ? lkiVisible(state, l, viewer) : false;
    if (!visible) {
      const { subject: _subject, ...rest } = entry;
      return { ...rest, facts: {} };
    }
  }
  let facts: HistoryEntry['facts'] | null = null;
  for (const [k, v] of Object.entries(entry.facts)) {
    if ((k === 'id' || k.endsWith('.id')) && typeof v === 'string' && v !== '' && !idShown(state, v, viewer)) (facts ??= { ...entry.facts })[k] = '';
  }
  return facts ? { ...entry, facts } : entry;
}

/**
 * NETFIX2: does the viewer's view show an object by this id? An object in a public zone (face down too: it is there under its id, CR 708.2), a card in a
 * hidden zone the viewer can see (its own hand, a card revealed to it), or last known information the viewer may see (`lkiVisible`). Not another player's
 * hidden hand card (shown under an alias, m4), a library card, or an id that is neither an object nor last known information (a library card renewed, H1).
 */
function idShown(state: GameState, id: string, viewer: PlayerId | null): boolean {
  const o = Object.hasOwn(state.objects, id) ? state.objects[id] : undefined;
  if (o) return (o.zone !== 'hand' && o.zone !== 'library') || canSee(state, o, viewer);
  const l = Object.hasOwn(state.lki, id) ? state.lki[id] : undefined;
  return l !== undefined && lkiVisible(state, l, viewer);
}

function redactLog(entry: LogEntry, viewer: PlayerId | null): LogEntry {
  if (entry.privateText && viewer && entry.privateText.players.includes(viewer)) {
    const { privateText, ...rest } = entry;
    return { ...rest, text: privateText.text };
  }
  const { privateText: _p, ...rest } = entry;
  return rest;
}

/**
 * m4 (audit 2026-10-12; CR 400.2): the cards of another player's hand that the viewer can't see are shown under aliases, in an order that says nothing.
 * Object ids are handed out one after another, so a hand card's own id would tell when it was drawn, and the hand's order the order the cards came in;
 * a player may not learn that about cards they can't see. The alias of each such card is a hash of the game's secret seed, the viewer, the hand's owner
 * and the set of hidden cards in that hand, so the aliases are stable while that set stays the same and all change whenever a card enters or leaves the
 * set (nobody can follow one card across a draw). The hidden cards come after the cards the viewer can see, sorted by alias.
 *
 * A player may still name such a card: resolving an effect by hand ("discard a card at random", a manual `move` op) names cards of another player's
 * hand. `applyAction` translates the aliases of the acting player's view back (`unaliasAction`), so an action chosen from a view works as if it named the
 * real ids. Both directions are a pure function of the state, so a replayed action log gives the same game.
 */
const ALIAS = /^h[0-9a-z]{7}x*$/;

/** The real id -> alias of every hidden card of another player's hand in `state` as `viewer` sees it, per hand owner (hand order kept). */
function handAliases(state: GameState, seed: string, viewer: PlayerId | null): Map<PlayerId, Map<ObjectId, ObjectId>> {
  const out = new Map<PlayerId, Map<ObjectId, ObjectId>>();
  for (const [owner, ids] of Object.entries(state.zones.hand)) {
    if (owner === viewer) continue;
    const hidden = ids.filter((id) => state.objects[id] && !canSee(state, state.objects[id]!, viewer));
    if (hidden.length === 0) continue;
    const key = `${seed}|hand|${viewer ?? ''}|${owner}|${[...hidden].sort().join(',')}`;
    const used = new Set<string>();
    const map = new Map<ObjectId, ObjectId>();
    for (const id of hidden) {
      let alias = `h${nextUint32(seedRng(`${key}|${id}`)).toString(36).padStart(7, '0')}`;
      while (used.has(alias) || state.objects[alias]) alias = `${alias}x`;
      used.add(alias);
      map.set(id, alias);
    }
    out.set(owner, map);
  }
  return out;
}

/** Every string in `x` (deeply) that `map` names, replaced; the rest is the same value (a copy only where something changed). */
function swapIds<T>(x: T, map: ReadonlyMap<string, string>): T {
  if (typeof x === 'string') return (map.get(x) ?? x) as T;
  if (Array.isArray(x)) {
    const out = x.map((v) => swapIds(v, map));
    return (out.some((v, i) => v !== x[i]) ? out : x) as T;
  }
  if (x && typeof x === 'object') {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) {
      const w = swapIds(v, map);
      if (w !== v) changed = true;
      out[k] = w;
    }
    return (changed ? out : x) as T;
  }
  return x;
}

function hasAlias(x: unknown, state: GameState): boolean {
  if (typeof x === 'string') return ALIAS.test(x) && !state.objects[x];
  if (Array.isArray(x)) return x.some((v) => hasAlias(v, state));
  if (x && typeof x === 'object') return Object.values(x).some((v) => hasAlias(v, state));
  return false;
}

/** The state `viewer` is shown: while another player is in the middle of a cancellable action, the state it started from (CR 733.1). */
function shownState(full: GameState, viewer: PlayerId | null): GameState {
  const hiding = full.suspended !== null && full.pending !== null && full.pending.cancellable === true && viewer !== full.pending.player && viewer !== full.pending.decidedBy; // std-control-3: nor from its controller (CR 723.5)
  return hiding ? { ...full.suspended!.base, pending: full.pending, suspended: full.suspended } : full;
}

/**
 * m4: `action` with the hand aliases of its player's view of `state` replaced by the real ids (see `handAliases`). An action that names no alias is
 * returned as it is.
 */
export function unaliasAction<A extends object>(state: GameState, action: A): A {
  if (!('player' in action) || !hasAlias(action, state)) return action;
  // std-control-3 (CR 723.5): an action for a controlled player was chosen from the view of the player who controls them
  const viewer = controllerOfPlayer(state, (action as { player: PlayerId }).player);
  const back = new Map<string, string>();
  for (const m of handAliases(shownState(state, viewer), state.seed, viewer).values()) for (const [id, alias] of m) back.set(alias, id);
  return back.size === 0 ? action : swapIds(action, back);
}

/**
 * std-combat-5 (CR 608.2d): a secret choice ("secretly choose Human, Merfolk, or Goblin") is known only to the players who made it until it is revealed: every other
 * viewer's copy of the object keeps the link (a choice was made) without its value (`LinkValue.secret`, effects/handlers/choose.ts; revealed by rules/pay-parts.ts).
 * `o` is the viewer's own copy, changed in place.
 */
function hideSecretLinks(o: GameObject, viewer: PlayerId | null): GameObject {
  for (const [k, v] of Object.entries(o.links ?? {})) {
    if (v.secret === undefined || (viewer !== null && v.secret.includes(viewer))) continue;
    const { values: _values, ...rest } = v;
    o.links![k] = rest;
  }
  return o;
}

/**
 * RPL-0 (replays design 6): the open view of a replay, with nothing hidden. Every hand and every library in order (CR 401.2), face-down permanents and
 * spells with their cards (CR 708), cards exiled face down (CR 406.3a), every log line with its private text, last known information and history in
 * full, every decision as its player sees it, another player's action in progress as it stands, and every player's sideboard. It is the state without
 * what no view carries (the RNG, the seed, the suspended base state), with `viewer` null and `open` set. A replay shows it only where its reveal
 * policy allows (design 6, D4: a game against the computer, or every person agreed); it is a separate function, so `viewFor` is the same as before.
 */
export function openView(state: GameState): GameView {
  const { rng: _rng, suspended, seed: _seed, log, ...rest } = state;
  return { ...clone(rest), log: log.map(openLog), viewer: null, midAction: suspended !== null, open: true };
}

/** A log line as the open view shows it: its private text (the card named, CR 400.2) in place of the public one. */
function openLog(entry: LogEntry): LogEntry {
  if (!entry.privateText) return { ...entry };
  const { privateText, ...rest } = entry;
  return { ...rest, text: privateText.text };
}

export function viewFor(full: GameState, viewer: PlayerId | null): GameView {
  // While a player is casting a spell or activating an ability, every decision can still be cancelled and the whole action is
  // then reversed (CR 733.1). Until it is settled the other players see the state it started from: the card is not yet on the
  // stack for them, so abandoning a cast reveals nothing (CR 400.2).
  const state = shownState(full, viewer);
  const objects: GameState['objects'] = {};
  const usedDefs = new Set<string>();
  for (const [id, o] of Object.entries(state.objects)) {
    if (canSee(state, o, viewer)) {
      objects[id] = hideSecretLinks(clone(o), viewer);
      usedDefs.add(o.defId);
      // M6-9 (CR 730.2e, 708.5): a face-up merged permanent may have a face-down component: only its controller may look at it
      if (o.components?.some((c) => c.faceDown) && viewer !== o.controller) {
        objects[id]!.components = o.components.map((c) => (c.faceDown ? { kind: c.kind, defId: FACE_DOWN_DEF_IDS.plain, owner: c.owner, faceDown: true, ...(c.mergedAt !== undefined ? { mergedAt: c.mergedAt } : {}) } : { ...c }));
      }
    } else {
      objects[id] = hiddenObject(o);
      // FAST5X batch 1 integration (E25 beside M11-1): a commander exiled face down can't be examined by its owner either (CR 406.3), but being a commander is an
      // attribute of the card, not a characteristic (CR 903.3), and its owner is the one asked whether to move it to the command zone (CR 903.9a): the owner's
      // view keeps the marker, nothing else
      if (o.commanderMoved === true && viewer === o.owner) objects[id]!.commanderMoved = true;
      usedDefs.add(objects[id]!.defId); // M6-3: a face-down permanent's or spell's pseudo-definition (the hidden definition is in no game's defs)
    }
  }
  // Last known information about objects that left public zones stays visible (without a link to an object the viewer cannot see); hidden-zone LKI does not.
  const lki: GameState['lki'] = {};
  for (const [id, l] of Object.entries(state.lki)) {
    if (lkiVisible(state, l, viewer)) { const shown = shownLki(state, l, viewer); lki[id] = shown.object.links === undefined ? shown : { ...shown, object: hideSecretLinks(clone(shown.object), viewer) }; usedDefs.add(l.object.defId); }
  }
  // M6-0 (m6 design 2.6): definitions a viewer needs although no visible object has them (the definitions copy snapshots refer to, CR 707.2; M6-2)
  for (const p of VIEW_PARTS) for (const id of p.usedDefs?.(state, viewer) ?? []) usedDefs.add(id);
  // FAST5 MX7 (CR 400.11a, 701.48a): the viewer's own cards outside the game (their sideboard), which learn offers them; nobody else's (hidden)
  if (viewer !== null) for (const id of state.outside?.[viewer] ?? []) usedDefs.add(id);
  // CMP1 (CR 702.139a): every player's revealed companion is public, wherever it is (the card stays named in `PlayerState.companion`)
  for (const p of state.players) if (p.companion) usedDefs.add(p.companion.defId);
  const defs: GameState['defs'] = {};
  for (const id of usedDefs) if (state.defs[id]) defs[id] = state.defs[id]!;
  for (const [id, d] of Object.entries(state.defs)) if (d.isToken) defs[id] = d;

  // The look-back snapshots inside the event of a triggered ability on the stack (stack objects are public, what they remember of hidden cards is not).
  for (const o of Object.values(objects)) if (o.stack?.event) o.stack.event = redactEvent(state, o.stack.event, viewer);

  // The parts that are replaced below (objects, lki, defs, log, history, pendingTriggers) are left out of the deep clone of the rest.
  const { rng: _rng, suspended, seed: _seed, objects: _objects, lki: _lki, defs: _defs, log: _log, history, pendingTriggers, ...rest } = state;
  const shown = clone(rest);
  // FAST5 MX7: another player's sideboard is hidden (CR 400.11a; tournament practice keeps it private): a view holds only the viewer's own entry
  if (shown.outside) shown.outside = viewer !== null && shown.outside[viewer] ? { [viewer]: shown.outside[viewer]! } : {};
  // m4: another player's hidden hand cards under aliases, in alias order; the viewer's own decision names them by alias too.
  const aliases = handAliases(state, full.seed, viewer);
  const toAlias = new Map<string, string>();
  // The hands of the view's own deep clone (never the game state's), so the WP31 state-write lint does not apply to them.
  const viewHands = shown.zones.hand;
  for (const [owner, map] of aliases) {
    for (const [id, alias] of map) {
      toAlias.set(id, alias);
      objects[alias] = { ...objects[id]!, id: alias };
      delete objects[id];
    }
    const ids = viewHands[owner]!;
    viewHands[owner] = [...ids.filter((id) => !map.has(id)), ...[...map.values()].sort()];
  }
  const pending = redactDecision(state.pending, viewer);
  const view: GameView = {
    ...shown,
    history: clone(history.map((e) => redactHistory(state, e, viewer))),
    pendingTriggers: clone(pendingTriggers.map((t) => ({ ...t, context: redactEvent(state, t.context, viewer) }))),
    objects,
    lki: clone(lki),
    defs: clone(defs),
    log: state.log.map((e) => redactLog(e, viewer)),
    pending: toAlias.size > 0 && pending && (pending.player === viewer || pending.decidedBy === viewer) ? swapIds(pending, toAlias) : pending,
    viewer,
    midAction: suspended !== null,
  };
  return blankUnshownIds(state, view, viewer);
}

/** An object id (`o<n>`, core/game.ts): the only strings `blankUnshownIds` looks at. */
const OBJECT_ID = /^o\d+$/;
/** The parts of a view `blankUnshownIds` leaves alone: the zone lists and object keys are the view's own (aliases, blank library cards), the viewer's own decision may name the cards it shows the viewer (a search), definitions name no object. */
const UNSCANNED: ReadonlySet<string> = new Set(['objects', 'zones', 'pending', 'defs', 'viewer']);

/**
 * NETFIX2 re-review (CR 400.2, audit m4): the parts of the state a view copies keep the ids they hold, and some name a card the view shows by another id
 * or not at all: an ability activated from a hand by a cost that moves the card (cycling, CR 702.29a; landcycling) is a public stack object whose
 * `stack.sourceId` is the card's id in the hand (so is its last known information once it resolved), and a trigger's event roles may name a card discarded
 * or cycled the same way. One pass over the whole view (but its zone lists, object keys, the viewer's own decision and the definitions) blanks ('') every
 * object id that names an object the view does not show by that id (`idShown`: another player's hidden hand card, a library card, last known
 * information hidden from the viewer, an id that is neither an object nor last known information). Copy on write: nothing shared with the state changes.
 */
function blankUnshownIds(state: GameState, view: GameView, viewer: PlayerId | null): GameView {
  const memo = new Map<string, boolean>();
  const hide = (s: string): boolean => {
    if (!OBJECT_ID.test(s)) return false;
    let h = memo.get(s);
    if (h === undefined) memo.set(s, (h = !idShown(state, s, viewer)));
    return h;
  };
  const out = view as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(out)) if (!UNSCANNED.has(k)) out[k] = blankIds(v, hide);
  // The view's own object record (built by viewFor, never the game state's), so the WP31 state-write lint does not apply to it.
  const objects = view.objects;
  for (const [id, o] of Object.entries(objects)) {
    const b = blankIds(o, hide);
    if (b !== o) objects[id] = { ...b, id: o.id }; // its own id is its key: the view shows it by that id (a blank card in a library too)
  }
  return view;
}

/** `x` with every string that `hide` names replaced by '' (deeply; a copy only where something changed). */
function blankIds<T>(x: T, hide: (s: string) => boolean): T {
  if (typeof x === 'string') return (hide(x) ? '' : x) as T;
  if (Array.isArray(x)) {
    const out = x.map((v) => blankIds(v, hide));
    return (out.some((v, i) => v !== x[i]) ? out : x) as T;
  }
  if (x && typeof x === 'object') {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) {
      const w = blankIds(v, hide);
      if (w !== v) changed = true;
      out[k] = w;
    }
    return (changed ? out : x) as T;
  }
  return x;
}
