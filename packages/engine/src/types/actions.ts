/**
 * Actions: the only inputs to the engine. A game is fully determined by its initial
 * configuration (including the seed) and its action log.
 */
import type { DefId, ObjectId, PlayerId } from './ids';
import type { DecisionAnswer } from './decisions';
import type { StopSettings } from './state';

export type Action =
  /** Pass priority (CR 117.3d). */
  /** RES-ALL: `resolveAll` also passes for this player until the stack is empty (`priority.resolveAll`; the client's Resolve all button). */
  | { type: 'pass'; player: PlayerId; resolveAll?: true }
  /** Play a land: a special action (CR 116.2a, 305.1). `face` for modal double-faced lands (CR 712). */
  | { type: 'playLand'; player: PlayerId; card: ObjectId; face?: number }
  /**
   * Cast a spell (CR 601). `face` selects a split half / adventure / MDFC back face;
   * `method` selects an alternative way to cast (e.g. "flashback"). All further choices
   * (modes, X, targets, costs) are asked as decisions.
   */
  | { type: 'cast'; player: PlayerId; card: ObjectId; face?: number; method?: string }
  /** Activate an activated ability (CR 602). `ability` is the key from legalActions(). */
  | { type: 'activate'; player: PlayerId; source: ObjectId; ability: string }
  /**
   * MRE (C6 gap 7): the controller says a manual (unparsed) triggered ability of their permanent has triggered and puts it on the stack (CR 603.2, 603.3).
   * It resolves like any ability; with no understood effect, through the manualResolve decision (in steps). `ability` is the key from legalActions().
   */
  | { type: 'manualTrigger'; player: PlayerId; source: ObjectId; ability: string }
  /**
   * MRE (C6 gap 7): the controller applies what a manual static ability of their permanent does (CR 604.1), by hand and without the stack: a manualResolve
   * decision (in steps, cancellable until the first step is applied). `ability` is the key from legalActions().
   */
  | { type: 'manualStatic'; player: PlayerId; source: ObjectId; ability: string }
  /**
   * Other special actions (CR 116): turn a face-down creature face up, etc. Listed by legalActions() and performed through
   * core/registries.ts#SPECIAL_ACTION_HANDLERS (M6-0). `via` (M6-0, m6 design 2.3): the procedure, CR 701.40c-d (a manifested card with morph or disguise may
   * be turned up either way); `x`: the X of that cost (CR 702.37f, 702.168e).
   */
  | { type: 'special'; player: PlayerId; kind: string; object?: ObjectId; via?: 'morph' | 'megamorph' | 'disguise' | 'manifest' | 'cloak'; x?: number; door?: number; option?: number; outside?: DefId } // `outside`: trek-11 INTERFACE CHANGE (additive), the card the action plays from outside the game, by definition id (CR 400.11b; `playOutside`, core/special/play-outside.ts); `door`: FAST5X E8 INTERFACE CHANGE (additive), the half of a Room to unlock (CR 709.5e, 116.2m); `option`: std-freecast-5 INTERFACE CHANGE (additive), which of a card's plot costs is paid (CR 702.170a, 702.170f: its own or its mana cost; core/special/plot.ts)
  /** Answer the pending decision. */
  | { type: 'answer'; player: PlayerId; decisionId: string; answer: DecisionAnswer }
  /** Cancel a cancellable in-progress action (CR 733.1: the whole action is reversed). */
  | { type: 'cancel'; player: PlayerId }
  /** Concede (CR 104.3a): allowed at any time. */
  | { type: 'concede'; player: PlayerId }
  /** Change this player's auto-pass stops. */
  | { type: 'setStops'; player: PlayerId; stops: StopSettings }
  /**
   * Internal: the start-of-game procedure (CR 103). Issued by createGame only. M12-2 INTERFACE CHANGE (additive, internal): `concessions`, the players
   * who conceded while the procedure waited for a decision (CR 104.3a, m12 design D11), each with the number of answers given before they conceded:
   * written by core/apply.ts into the suspended action only, never by a client.
   */
  | { type: 'startGame'; concessions?: { player: PlayerId; at: number }[] };

export type ActionType = Action['type'];
