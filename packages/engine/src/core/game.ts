/**
 * The mutable context used while processing one action.
 *
 * Engine code is ordinary imperative code that mutates `g.s` (a private clone of the
 * input state). When it needs a player's decision it calls `g.choose(...)`:
 *  - if the answer was already supplied (re-execution), it is validated and returned;
 *  - otherwise a NeedDecision is thrown, the run stops, and applyAction returns a state
 *    whose `pending` is that decision and whose `suspended` remembers how to resume.
 * Because the engine is deterministic (seeded RNG inside the state), re-running the same
 * action from the same base state with the same answers reproduces exactly the same game.
 */
import type { GameState, LogEntry, GameObject, LastKnown, PlayerState } from '../types/state';
import type { CardDef } from '../types/card';
import { deepFreeze } from '../util/clone';
import type { Decision, DecisionAnswer, AnswerFor } from '../types/decisions';
import type { GameEvent } from '../types/events';
import type { ObjectId, PlayerId } from '../types/ids';
import { EngineBug, IllegalAction, IllegalAnswer, NeedDecision } from './errors';
import { validateAnswer } from './validate';
import { withDecider } from './player-control';

// The error / control-flow types moved to core/errors.ts (to break an import cycle); re-exported here for existing imports.
export { NeedDecision, IllegalAction, IllegalAnswer, EngineBug };

/**
 * M6-0 (m6 design 2.4), M6-1 (E2, D3): the replacement effects already applied to an event and to the events that replace it (CR 614.5), per BRANCH.
 * Declared here (effects/api.ts re-exports it) so this module does not import the interpreter's types: types/ reach core/game.ts, and the ability schema
 * generator (scripts/gen-ability-schema.ts) type-checks everything types/ability.ts reaches.
 */
export interface ReplacementChain {
  readonly used: ReadonlySet<string>;
  readonly parent: ReplacementChain | null;
  /**
   * w8-followups (CR 614.5, 616.1, 616.1e): answers already given to optional replacement effects ("you may instead ...") for the event these steps belong to, by
   * candidate id. effects/bodies/m5.ts#thenAfterCreate sets it for the tokens a "those tokens plus a Food token" effect adds: an optional effect applied to the event
   * after that one applies to the added tokens too, with the answer its controller gave once (effects/propose.ts#runPipeline does not ask again).
   */
  readonly decided?: ReadonlyMap<string, boolean>;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A decision without its id (the engine assigns ids). */
export type DecisionInput = DistributiveOmit<Decision, 'id'>;

export class Game {
  readonly events: GameEvent[] = [];
  private cursor = 0;
  /**
   * M6-0 (m6 design 2.4): the replacement chain of the proposal being worked out (CR 614.5, per branch; effects/api.ts#ReplacementChain). Transient like
   * `events`, rebuilt deterministically on re-execution, never in the state. Nothing sets it before M6-1.
   */
  chain: ReplacementChain | null = null;
  /**
   * FAST5X E28 review (CR 603.10a, 608.2h): the characteristics of the objects that leave their zones in ONE event (a "destroy all", the permanents of one
   * state-based action check, a sacrifice of several at once), taken just before the first of them moves; `moveObject` writes them as each one's last known
   * information instead of what is left once the others are gone (a granter of persist that left first). Set by core/zones.ts#leavingTogether. Transient like
   * `chain`, never in the state.
   */
  leaving: Map<ObjectId, LastKnown['chars']> | null = null;
  /**
   * Cloud C3 (batch 3), CR 603.10a: with `leaving`, the players who goad each of those objects through a static ability just before the first of them moves
   * (`LastKnown.goadedBy`): the Aura or the goading creature may leave in the same event. Set by core/zones.ts#leavingTogether only when the game has a static
   * goad (statics/rule-sources.ts#staticGoadPresent). Transient, never in the state.
   */
  leavingGoaded: Map<ObjectId, readonly PlayerId[]> | null = null;
  /** r5-fxb (CR 603.10a): what was attached to each object of a simultaneous leave (`LastKnown.attached`), before any of them moved. Transient, never in the state. */
  leavingAttached: Map<ObjectId, { equipped: boolean; modified: boolean; ids?: ObjectId[] }> | null = null;
  /** std-combat-3 (CR 603.10a): the battlefield just before the first object of a simultaneous leave moved (`LastKnown.board`). Transient, never in the state. */
  leavingBoard: ObjectId[] | null = null;
  /** Listeners invoked synchronously for every emitted event (trigger detection hooks in here). */
  private readonly listeners: ((g: Game, e: GameEvent) => void)[] = [];

  /** True once `s.defs` is this run's own copy (see addDef). */
  private defsOwned = false;

  /**
   * H1: library cards that became new objects during this run (old id -> new id): a shuffle or a reorder renews every card it touches so that no player
   * can follow one by its id (core/zones.ts#renewLibraryCard, CR 400.2, 401.2). Kept out of the state on purpose: nothing a player is sent may link the two
   * ids, and the state does not grow with every shuffle. Engine code of this run that still holds an old id follows it with `renewedId`; a decision re-runs
   * the action from its base state, which rebuilds the map (the decision model). Not followed from one action to the next.
   */
  readonly renewed = new Map<ObjectId, ObjectId>();

  /**
   * @param answeredBy M12-2 (multiplayer only, `Suspension.answeredBy`): who gave each answer; a replayed answer must answer a decision of that player.
   */
  constructor(public s: GameState, private readonly answers: readonly DecisionAnswer[] = [], private readonly answeredBy?: readonly PlayerId[]) {}

  /** How many of the supplied answers have been used so far (M12-2: the point a concession during the start of the game is applied at, core/start.ts). */
  get answersUsed(): number {
    return this.cursor;
  }

  /**
   * Add a card definition (a token's, CR 111.4) to the game. `state.defs` is shared between a state and the states derived
   * from it (util/clone.ts#cloneState), so it is copy-on-write: the map is shallow-copied the first time a run adds to it,
   * and a CardDef is frozen and never mutated in place. An existing definition with that id is kept.
   */
  addDef(def: CardDef): void {
    if (this.s.defs[def.id]) return;
    if (!this.defsOwned) {
      this.s.defs = { ...this.s.defs };
      this.defsOwned = true;
    }
    this.s.defs[def.id] = deepFreeze(def);
  }

  /**
   * M12-2 (m12 design 4.5): the controller of the spell or ability whose effect is being carried out right now (set by effects/run.ts while a stack object
   * resolves), so that a decision asked during the resolution knows who asks it (`DecisionBase.asker`, CR 800.4f-h). Transient like `events`; null outside
   * a resolution. Read only in a multiplayer game.
   */
  effectController: PlayerId | null = null;

  /** Ask a player to decide something. See the file comment for the re-execution model. */
  choose<D extends DecisionInput>(input: D): AnswerFor<D['kind']> {
    let ask: DecisionInput = input;
    if (this.s.options.multiplayer !== undefined) {
      // M12-2 (m12 design 4.5): a decision asked while a spell or ability resolves names who asks it; only in a multiplayer game (D16: a two-player
      // decision never carries the field)
      if (ask.asker === undefined && this.effectController !== null) {
        ask = { ...ask, asker: { kind: ask.player === this.effectController ? 'choice' : 'opponentChoice', controller: this.effectController } } as DecisionInput;
      }
      // CR 800.4f-h: the player asked has left the game
      if (!this.s.result && this.s.players.find((p) => p.id === ask.player)?.hasLost === true) {
        const redirected = this.redirectFromLeaver(ask);
        if ('answer' in redirected) return redirected.answer as AnswerFor<D['kind']>;
        ask = redirected.decision;
      }
    }
    const id = `d${this.s.counters.decision++}`;
    const decision = withDecider(this.s, { ...ask, id } as Decision); // std-control-3 (CR 723.5): a controlled player's decision names who answers it
    if (this.cursor < this.answers.length) {
      const by = this.answeredBy?.[this.cursor];
      const answer = this.answers[this.cursor++]!;
      // M12-2 (m12 design D11): an answer given by one player never answers another player's decision (a re-run after a concession asks in another order)
      if (by !== undefined && by !== decision.player) {
        throw new IllegalAnswer(`That answer was ${this.player(by).name}'s, but this decision is ${this.player(decision.player).name}'s.`);
      }
      if (answer.kind !== decision.kind) {
        throw new IllegalAnswer(`Expected an answer of kind "${decision.kind}" but got "${answer.kind}".`);
      }
      // Earlier answers were validated when given; validating again is cheap and catches engine nondeterminism.
      validateAnswer(this.s, decision, answer);
      return answer as AnswerFor<D['kind']>;
    }
    throw new NeedDecision(decision);
  }

  /**
   * M12-2 (m12 design 4.5, D13): a decision for a player who has left the game (CR 800.4f-h). The callers skip a leaver wherever the rules say nothing is
   * asked (their blocks, their cleanup discard, their payment of "unless" costs, effects/handlers/pay.ts); this is what is left:
   *  - `asker.kind` 'cost' (CR 800.4f): the cost is not paid: a yes / no question is answered no. Any other kind of payment decision is an engine bug.
   *  - 'opponentChoice' (CR 800.4g): the controller of the object chooses another opponent to make the choice (asked only when there are two or more, D13).
   *  - 'choice' (CR 800.4g: the object's controller left too, so no controller can choose) and no `asker` (a rule's choice, CR 800.4h): the next player in
   *    turn order makes it.
   * The redirected decision names its new player and says why in its prompt and in the log.
   */
  private redirectFromLeaver(d: DecisionInput): { answer: DecisionAnswer } | { decision: DecisionInput } {
    const left = this.player(d.player);
    const asker = d.asker;
    if (asker?.kind === 'cost') {
      if (d.kind === 'yesNo') {
        this.log(`${left.name} has left the game: the cost is not paid.`, { rules: ['CR 800.4f'], level: 'info' });
        return { answer: { kind: 'yesNo', yes: false } };
      }
      throw new EngineBug(`A ${d.kind} payment decision was asked of ${left.name}, who has left the game (CR 800.4f: the cost is not paid)`);
    }
    let to: PlayerId;
    let rule: string;
    const askerIn = asker !== undefined && !this.player(asker.controller).hasLost;
    if (asker?.kind === 'opponentChoice' && askerIn) {
      // CR 800.4g: "that player chooses another opponent if possible"
      const others = this.opponents(asker.controller).map((p) => p.id);
      rule = 'CR 800.4g';
      if (others.length === 0) to = asker.controller;
      else if (others.length === 1) to = others[0]!;
      else {
        const pick = this.choose({
          kind: 'chooseOption', player: asker.controller, min: 1, max: 1, rules: ['CR 800.4g'],
          prompt: `${left.name} has left the game: choose another opponent to make their choice (${d.prompt})`,
          options: others.map((id) => ({ id, label: this.player(id).name })),
        });
        to = others.find((p) => p === pick.ids[0]) ?? others[0]!;
      }
    } else {
      to = this.nextPlayer(d.player); // CR 800.4h: the next player in turn order (a leaver is skipped)
      rule = 'CR 800.4h';
    }
    this.log(`${left.name} has left the game: ${this.player(to).name} makes their choice instead.`, { rules: [rule], level: 'info' });
    return {
      // never cancellable by the player who makes the choice for the leaver: it would take back another player's action (CR 733.1)
      decision: { ...d, player: to, cancellable: false, prompt: `${left.name} left the game; you choose for them (${rule}). ${d.prompt}`, rules: [...(d.rules ?? []), rule] } as DecisionInput,
    };
  }

  /** True when every supplied answer has been consumed (used to detect stale answers). */
  get answersConsumed(): boolean {
    return this.cursor >= this.answers.length;
  }

  onEvent(fn: (g: Game, e: GameEvent) => void): void {
    this.listeners.push(fn);
  }

  emit(e: GameEvent): void {
    this.events.push(e);
    for (const fn of this.listeners) fn(this, e);
  }

  log(text: string, opts: Omit<LogEntry, 'seq' | 'turn' | 'text'> = {}): void {
    this.s.log.push({ seq: this.s.counters.log++, turn: this.s.turn.number, text, ...opts });
  }

  // ---- lookups -------------------------------------------------------------

  obj(id: ObjectId): GameObject {
    const o = this.s.objects[id];
    if (!o) throw new EngineBug(`No object ${id}`);
    return o;
  }

  maybeObj(id: ObjectId | undefined | null): GameObject | undefined {
    return id ? this.s.objects[id] : undefined;
  }

  /** The id a library card renewed during this run has now (through every renewal, see `renewed`); `id` itself when it still exists or was not renewed. */
  renewedId(id: ObjectId): ObjectId {
    let cur = id;
    for (let next = this.renewed.get(cur); next !== undefined && !this.s.objects[cur]; next = this.renewed.get(cur)) cur = next;
    return cur;
  }

  player(id: PlayerId): PlayerState {
    const p = this.s.players.find((x) => x.id === id);
    if (!p) throw new EngineBug(`No player ${id}`);
    return p;
  }

  opponents(id: PlayerId): PlayerState[] {
    return this.s.players.filter((p) => p.id !== id && !p.hasLost);
  }

  /** Players in turn order starting with the active player (APNAP order, CR 101.4). */
  apnap(): PlayerId[] {
    const ids = this.s.players.map((p) => p.id);
    const i = ids.indexOf(this.s.turn.activePlayer);
    return [...ids.slice(i), ...ids.slice(0, i)].filter((id) => !this.player(id).hasLost);
  }

  nextPlayer(id: PlayerId): PlayerId {
    const live = this.s.players.filter((p) => !p.hasLost || p.id === id).map((p) => p.id);
    const i = live.indexOf(id);
    return live[(i + 1) % live.length]!;
  }

  newObjectId(): ObjectId {
    return `o${this.s.counters.object++}`;
  }

  newTimestamp(): number {
    return this.s.counters.timestamp++;
  }

  newEffectId(): string {
    return `e${this.s.counters.effect++}`;
  }

  /** Display name of an object for the log (face-down objects stay anonymous to opponents). */
  nameOf(id: ObjectId): string {
    const o = this.s.objects[id] ?? this.s.lki[id]?.object ?? this.s.objects[this.renewedId(id)];
    if (!o) return id;
    if (o.faceDown) return 'a face-down card';
    const def = this.s.defs[o.defId];
    if (!def) return id;
    if (o.kind === 'ability') return o.stack?.sourceName ? `ability of ${o.stack.sourceName}` : 'an ability';
    return def.faces[o.face]?.name ?? def.name;
  }
}
