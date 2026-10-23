/**
 * What a change looks like on the table (ui/arena): turns one batch of engine events into an animation plan. Pure, so the choreography is tested without a
 * browser. The animator plays part A on the board as it was (casts that came and went, resolutions with their spell effects, combat swings, life changes),
 * then the board shows the new view, then part B (cards leaving: destroyed, exiled, returned; cards arriving: cast, played, drawn, created; the turn banner).
 *
 * Every id here comes from events already redacted for the viewer (connection/redactEvents.ts) and from the viewer's own views, so a plan never knows more
 * than the screen may show (CR 400.2).
 */
import type { GameEvent, GameObject, GameView, ObjectId, PlayerId, ZoneKind } from '@openmtg/engine';
import { charsOf, isHidden } from '../model';

/** The look of a spell effect, from the source's name and colours: MTG-style magic, never the UI's grid look. */
export type SpellStyle = 'fire' | 'lightning' | 'arcane' | 'shadow' | 'nature' | 'radiant' | 'force';

export interface Hit {
  source: ObjectId;
  /** An object or a player. */
  target: string;
  amount: number;
}

export interface LifeChange {
  player: PlayerId;
  delta: number;
  /** Explained by a damage event of the same step (the hit animates it already). */
  byDamage: boolean;
}

export interface CounterChange {
  target: string;
  counter: string;
  delta: number;
}

export type StepA =
  /** A spell cast and finished inside this change: shown flying from where it was cast to the stack. */
  | { kind: 'cast'; stackId: ObjectId; origin: ObjectId | null; controller: PlayerId; style: SpellStyle }
  /** An activated or triggered ability put on the stack: its source flares; `transient` when it also left the stack inside this change. */
  | { kind: 'ability'; stackId: ObjectId; source: ObjectId | null; triggered: boolean; transient: boolean; style: SpellStyle }
  /** A spell or ability resolving (CR 608): it flares, then its effects come out of it (or out of its source permanent). */
  | { kind: 'resolve'; stackId: ObjectId; spell: boolean; source: ObjectId | null; style: SpellStyle; hits: Hit[]; life: LifeChange[]; counters: CounterChange[]; targets: string[] }
  /** Combat damage (CR 510): attackers and blockers rise and swing at what they hit, all at once. */
  | { kind: 'combat'; hits: Hit[]; life: LifeChange[] }
  /** Noncombat damage outside a resolution (a static or replacement effect): a bolt from the source. */
  | { kind: 'damage'; hits: Hit[]; style: SpellStyle; life: LifeChange[] }
  | { kind: 'life'; life: LifeChange[] }
  | { kind: 'countered'; stackId: ObjectId }
  | { kind: 'counters'; counters: CounterChange[] };

export type MoveKind = 'die' | 'sacrifice' | 'exile' | 'bounce' | 'toLibrary' | 'toGraveyard' | 'toBattlefield' | 'toStack' | 'toHand' | 'other';

export interface Move {
  oldId: ObjectId;
  newId: ObjectId | null;
  from: ZoneKind | null;
  to: ZoneKind;
  owner: PlayerId;
  controller: PlayerId;
  kind: MoveKind;
  /** A token: it ceases to exist outside the battlefield (CR 111.7, 704.5d), so it vanishes instead of travelling. */
  token: boolean;
  /** Countered or otherwise already animated in part A. */
  shownInA: boolean;
}

export interface PlanB {
  moves: Move[];
  tokens: ObjectId[];
  /** The turn that began during this change (the newest), for the banner. */
  turn: { number: number; player: PlayerId } | null;
  attackers: ObjectId[];
  blocks: { blocker: ObjectId; attacker: ObjectId }[];
  gameOver: { winner: PlayerId | null } | null;
  lost: PlayerId[];
  /**
   * M12-4a (m12 design 5.1, D8-D9): players who left a multiplayer game that goes on (CR 104.5, 800.4a), with the objects they owned that left the game with
   * them (`removed`: gone from the view, so they fade where they were) and their face-down cards revealed to everyone (CR 708.9: turned over first). The
   * objects they controlled but did not own are ordinary exile moves (`zoneChanged`, cause 'leftGame').
   */
  left: { player: PlayerId; removed: ObjectId[]; revealed: { id: ObjectId; name: string }[] }[];
}

export interface Plan {
  a: StepA[];
  b: PlanB;
}

/** The object as the view knows it now or last knew it (CR 608.2h). */
function knownObject(view: GameView, id: ObjectId | undefined): GameObject | undefined {
  if (!id) return undefined;
  return view.objects[id] ?? view.lki[id]?.object;
}

const LIGHTNING = /lightning|bolt|shock|electr|storm|thunder|spark|zap|arc\b/i;
const FIRE = /fire|flame|burn|blaze|inferno|pyro|ember|scorch|magma|lava|incinerat|immolat|heat|char\b/i;

/** The spell look of a source: lightning or fire by name, else by colour (red fire, blue arcane, black shadow, green nature, white radiant). */
export function spellStyle(views: readonly GameView[], id: ObjectId | undefined): SpellStyle {
  for (const view of views) {
    const o = knownObject(view, id);
    if (!o || isHidden(o)) continue;
    const def = view.defs[o.defId];
    const name = `${def?.name ?? ''} ${o.stack?.sourceName ?? ''}`;
    if (LIGHTNING.test(name)) return 'lightning';
    if (FIRE.test(name)) return 'fire';
    const colors = (view.objects[o.id] ? charsOf(view, o)?.colors : view.lki[o.id]?.chars?.colors) ?? def?.faces[0]?.colors ?? [];
    if (colors.includes('U') && colors.includes('R')) return 'lightning';
    switch (colors[0]) {
      case 'R':
        return 'fire';
      case 'U':
        return 'arcane';
      case 'B':
        return 'shadow';
      case 'G':
        return 'nature';
      case 'W':
        return 'radiant';
      default:
        return 'force';
    }
  }
  return 'force';
}

type ZoneChanged = Extract<GameEvent, { type: 'zoneChanged' }>;

/** Events that end a stretch of effects: what follows them is not part of the resolution before them. */
const BOUNDARIES: ReadonlySet<GameEvent['type']> = new Set<GameEvent['type']>(['resolved', 'spellCast', 'abilityActivated', 'abilityTriggered', 'countered', 'abilityCountered', 'turnBegan', 'stepBegan', 'attackersDeclared', 'blockersDeclared']);

export function classifyMove(e: ZoneChanged, from: GameView): Move {
  const token = knownObject(from, e.oldId)?.kind === 'token';
  let kind: MoveKind = 'other';
  if (e.to === 'exile') kind = 'exile';
  else if (e.from === 'battlefield' && e.to === 'graveyard') kind = e.cause === 'sacrifice' ? 'sacrifice' : 'die';
  else if (e.from === 'battlefield' && e.to === 'hand') kind = 'bounce';
  else if (e.to === 'library') kind = 'toLibrary';
  else if (e.to === 'graveyard') kind = 'toGraveyard';
  else if (e.to === 'battlefield') kind = 'toBattlefield';
  else if (e.to === 'stack') kind = 'toStack';
  else if (e.to === 'hand') kind = 'toHand';
  return { oldId: e.oldId, newId: e.newId, from: e.from, to: e.to, owner: e.owner, controller: e.controller, kind, token, shownInA: false };
}

/**
 * NETFIX2 (CR 400.2): another player's hand card that the viewer can't see is named by no id in the events (packages/net redact.ts: a `drew` event's
 * `objectId` and the `oldId` of a move out of that hand are ''), and a local game's events name it by an id the view does not show (the view shows such
 * cards under aliases, m4). Either way the board has no card to fly, so each such draw is given one of the card backs that are new in that hand in the view
 * after the change, and each such move out of the hand one of the card backs that are gone from it in the view before: the back flies from the library to
 * the hand, or from the hand to the stack, the battlefield or a pile, as before. Which back it is says nothing (a hand's hidden cards are in alias order).
 */
function placeUnseen(events: readonly GameEvent[], from: GameView, to: GameView): readonly GameEvent[] {
  const viewer = to.viewer;
  /** The card backs of `owner`'s hand in `view` that `other` does not have. */
  const backs = (view: GameView, other: GameView, owner: PlayerId): ObjectId[] =>
    (view.zones.hand[owner] ?? []).filter((id) => view.objects[id] !== undefined && isHidden(view.objects[id]!) && other.objects[id] === undefined);
  const arriving = new Map<PlayerId, ObjectId[]>();
  const leaving = new Map<PlayerId, ObjectId[]>();
  const take = (pools: Map<PlayerId, ObjectId[]>, view: GameView, other: GameView, owner: PlayerId): ObjectId | undefined => {
    if (!pools.has(owner)) pools.set(owner, backs(view, other, owner));
    return pools.get(owner)!.pop();
  };
  let changed = false;
  const out = events.map((e): GameEvent => {
    if (e.type === 'drew' && !e.commandZone && e.player !== viewer && to.objects[e.objectId] === undefined) {
      const id = take(arriving, to, from, e.player);
      if (id !== undefined) {
        changed = true;
        return { ...e, objectId: id };
      }
    }
    if (e.type === 'zoneChanged' && e.from === 'hand' && e.owner !== viewer && from.objects[e.oldId] === undefined) {
      const id = take(leaving, from, to, e.owner);
      if (id !== undefined) {
        changed = true;
        return { ...e, oldId: id };
      }
    }
    return e;
  });
  return changed ? out : events;
}

export function planBatch(batch: readonly GameEvent[], from: GameView, to: GameView): Plan {
  const events = placeUnseen(batch, from, to);
  const a: StepA[] = [];
  const b: PlanB = { moves: [], tokens: [], turn: null, attackers: [], blocks: [], gameOver: null, lost: [], left: [] };
  const views = [from, to];
  const onStackAfter = new Set(to.zones.stack);
  const onStackBefore = new Set(from.zones.stack);
  type Group = Extract<StepA, { kind: 'resolve' | 'combat' | 'damage' }>;
  let group: Group | null = null;
  let lifeOnly: Extract<StepA, { kind: 'life' }> | null = null;
  let counters: Extract<StepA, { kind: 'counters' }> | null = null;
  const close = () => {
    group = null;
    lifeOnly = null;
    counters = null;
  };
  const countered = new Set<ObjectId>();
  // Damage to a player reports the life it costs before the damage itself (CR 120.3a: the engine's dealDamage loses the life, then reports the damage):
  // pair each such loss with the damage just after it, so the hit alone shows it (a life-loss effect too would show the same blow twice).
  const lossByDamage = new Set<number>();
  const pairedDamage = new Set<number>();
  events.forEach((e, i) => {
    if (e.type !== 'lifeChanged' || e.delta >= 0) return;
    for (let j = i + 1; j < Math.min(events.length, i + 8); j++) {
      const x = events[j]!;
      if (x.type === 'lifeChanged' && x.player === e.player) return;
      if (x.type === 'damageDealt' && !pairedDamage.has(j) && x.target === e.player && x.amount === -e.delta) {
        pairedDamage.add(j);
        lossByDamage.add(i);
        return;
      }
    }
  });
  // The engine reports a resolution's effects first and its `resolved` event last (CR 608.2c, then 608.2n): every event after the previous boundary and up to
  // a `resolved` belongs to that resolution, so its step opens at the first of them and the damage, life and counters inside it come out of the spell.
  const resolving: (ObjectId | null)[] = new Array<ObjectId | null>(events.length).fill(null);
  let closing: ObjectId | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'resolved') closing = e.objectId;
    else if (BOUNDARIES.has(e.type) || (e.type === 'damageDealt' && e.combat)) closing = null;
    resolving[i] = closing;
  }
  /** Life lost to damage, reported before the damage (paired above): it joins the step of the hit that caused it. */
  const pendingLoss: LifeChange[] = [];
  const isResolving = (id: ObjectId): boolean => {
    const g = group as Group | null;
    return g?.kind === 'resolve' && g.stackId === id;
  };
  const openResolve = (id: ObjectId): Extract<StepA, { kind: 'resolve' }> => {
    close();
    const o = knownObject(from, id) ?? knownObject(to, id);
    const spell = o?.kind !== 'ability';
    const source = spell ? null : (o?.stack?.sourceId ?? null);
    const step: Extract<StepA, { kind: 'resolve' }> = {
      kind: 'resolve',
      stackId: id,
      spell,
      source,
      style: spellStyle(views, spell ? id : (source ?? id)),
      hits: [],
      life: [],
      counters: [],
      // What it targets (CR 115.1, 608.2b), as the viewer saw it on the stack: its effect visibly reaches them even when it deals no damage.
      targets: [...new Set((o?.stack?.targets ?? []).flat().map((t) => t.id))],
    };
    a.push(step);
    group = step;
    return step;
  };

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const within = resolving[i] ?? null;
    if (within !== null && e.type !== 'resolved' && !isResolving(within)) openResolve(within);
    switch (e.type) {
      case 'zoneChanged':
        b.moves.push(classifyMove(e, from));
        break;
      case 'spellCast': {
        close();
        // On the stack after this change: it arrives there in part B. Gone again already: show it flying there now, before it resolves.
        if (!onStackAfter.has(e.objectId) && !onStackBefore.has(e.objectId)) {
          const cast = events.find((x): x is ZoneChanged => x.type === 'zoneChanged' && x.newId === e.objectId && x.to === 'stack');
          a.push({ kind: 'cast', stackId: e.objectId, origin: cast?.oldId ?? null, controller: e.player, style: spellStyle(views, e.objectId) });
        }
        break;
      }
      case 'abilityActivated':
      case 'abilityTriggered': {
        close();
        a.push({
          kind: 'ability',
          stackId: e.objectId,
          source: e.sourceId ?? null,
          triggered: e.type === 'abilityTriggered',
          transient: !onStackAfter.has(e.objectId) && !onStackBefore.has(e.objectId),
          style: spellStyle(views, e.sourceId ?? e.objectId),
        });
        break;
      }
      case 'resolved':
        // Its step opened at its first effect; one with no effects opens here. It stays open: an effect reported after it still belongs to it.
        if (!isResolving(e.objectId)) openResolve(e.objectId);
        break;
      case 'countered':
      case 'abilityCountered':
        close();
        countered.add(e.objectId);
        a.push({ kind: 'countered', stackId: e.objectId });
        break;
      case 'damageDealt': {
        const hit: Hit = { source: e.source, target: e.target, amount: e.amount };
        if (e.amount <= 0) break;
        const paired = pairedDamage.has(i) ? pendingLoss.findIndex((l) => l.player === e.target && -l.delta === e.amount) : -1;
        const loss = paired >= 0 ? pendingLoss.splice(paired, 1)[0]! : null;
        if (e.combat) {
          if (group?.kind !== 'combat') {
            close();
            group = { kind: 'combat', hits: [], life: [] };
            a.push(group);
          }
          group.hits.push(hit);
          if (loss) group.life.push(loss);
        } else if ((group as Group | null)?.kind === 'resolve') {
          // The step is opened by openResolve, out of this loop's sight.
          (group as unknown as Extract<StepA, { kind: 'resolve' }>).hits.push(hit);
          if (loss) (group as unknown as Extract<StepA, { kind: 'resolve' }>).life.push(loss);
        } else {
          if (group?.kind !== 'damage') {
            close();
            group = { kind: 'damage', hits: [], style: spellStyle(views, e.source), life: [] };
            a.push(group);
          }
          group.hits.push(hit);
          if (loss) group.life.push(loss);
        }
        break;
      }
      case 'lifeChanged': {
        const g = group as Group | null;
        // Paired with the damage that comes right after it, it never makes a step of its own: the hit shows it (and it joins the hit's step below).
        if (lossByDamage.has(i)) {
          pendingLoss.push({ player: e.player, delta: e.delta, byDamage: true });
          break;
        }
        const byDamage = g !== null && g.hits.some((h) => h.target === e.player);
        const change: LifeChange = { player: e.player, delta: e.delta, byDamage };
        if (g) g.life.push(change);
        else {
          if (!lifeOnly) {
            lifeOnly = { kind: 'life', life: [] };
            a.push(lifeOnly);
          }
          lifeOnly.life.push(change);
        }
        break;
      }
      case 'countersChanged': {
        const change: CounterChange = { target: e.target, counter: e.counter, delta: e.delta };
        const g = group as Group | null;
        if (g?.kind === 'resolve') g.counters.push(change);
        else {
          if (!counters) {
            counters = { kind: 'counters', counters: [] };
            a.push(counters);
          }
          counters.counters.push(change);
        }
        break;
      }
      case 'drew':
        // CMDF: a commander drawn and put into the command zone instead (CR 903.9b) already moved with its own zoneChanged event
        if (e.commandZone) break;
        // A draw moves the top card silently (no zoneChanged event, CR 121.1): it arrives in the hand from the library.
        b.moves.push({ oldId: '', newId: e.objectId, from: 'library', to: 'hand', owner: e.player, controller: e.player, kind: 'toHand', token: false, shownInA: false });
        break;
      case 'tokenCreated':
        b.tokens.push(e.objectId);
        break;
      case 'turnBegan':
        close();
        b.turn = { number: e.turn, player: e.activePlayer };
        break;
      case 'stepBegan':
        close();
        break;
      case 'attackersDeclared':
        close();
        b.attackers.push(...e.attackers.map((x) => x.attacker));
        break;
      case 'blockersDeclared':
        close();
        b.blocks.push(...e.blocks);
        break;
      case 'playerLost':
        b.lost.push(e.player);
        break;
      case 'gameOver':
        b.gameOver = { winner: e.winner };
        break;
      case 'playerLeft':
        b.left.push({ player: e.player, removed: [...e.removed], revealed: e.revealed.map((r) => ({ ...r })) });
        break;
      default:
        break;
    }
  }
  for (const m of b.moves) if (countered.has(m.oldId)) m.shownInA = true;
  return { a, b };
}

/** Total damage of hits landing together, for the screen shake. */
export function totalDamage(hits: readonly Hit[]): number {
  return hits.reduce((n, h) => n + h.amount, 0);
}

/** True when the plan has anything to show (a change with only priority passes animates nothing). */
export function planIsEmpty(p: Plan): boolean {
  const b = p.b;
  return (
    p.a.length === 0 && b.moves.length === 0 && b.tokens.length === 0 && b.turn === null && b.attackers.length === 0 && b.blocks.length === 0 && b.gameOver === null &&
    b.lost.length === 0 && b.left.length === 0
  );
}
