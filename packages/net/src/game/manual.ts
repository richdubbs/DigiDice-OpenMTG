/**
 * Manual resolution online. A card the engine does not understand is resolved by hand: its controller answers a `manualResolve` decision with
 * ManualOps, which the engine applies to any object or player (they adjust the game by hand). Offline both players sit at the same table; online the
 * guest could use them to move the host's hidden cards into public zones (CR 400.2) or set the host's life. So the host never applies a guest's
 * manual operations on its own authority: they are shown to the host player as a proposal (in words, as the host may know the game, so a rejected
 * proposal tells the host nothing about the guest's hidden cards) and applied only once the host accepts them.
 *
 * M12-5a (m12 design 6): in a 3-4 player game **every other player still in the game** must approve, the host's own proposals too
 * (`ManualVotes`). Each player is shown the proposal described as they may know the game (`describeProposal`: their own CR 400.2 view of it; the raw
 * operations never reach another screen). It is applied when all have accepted, rejected when one rejects, withdrawn when its player acts otherwise; a
 * voter whose link is down holds it until they return or forfeit, and a voter who leaves the game no longer counts. A two-player game: the host answers
 * the guest's (milestone 9), and the guest answers the host's (the host's own no longer apply at once).
 */
import { canSee, unaliasAction, type Action, type GameState, type ManualOp, type PlayerId } from '@openmtg/engine';
import { cleanText } from '../protocol/text';

/** Manual adjustments waiting for an answer (milestone 9: the guest's, for the host; M12-5a: any player's, for every other player). */
export interface ManualProposal {
  id: number;
  /** Who proposes them. */
  player: PlayerId;
  /** The card being resolved by hand, and its text. */
  sourceName: string;
  text: string;
  /**
   * The operations as the guest sent them: ids of the guest's view (the host's hand cards under the guest's m4 aliases, the guest's own cards under
   * their real ids). Show `lines` to the host player; never forward `ops` to the host's screen (real ids of the guest's hidden cards, m4).
   */
  ops: ManualOp[];
  /** The operations in words, as the host player sees the game. */
  lines: string[];
  /**
   * M12-5a: the players whose answer is still awaited (every proposal of a 3-4 player game: the host's own in a two-player game, the
   * guest). Absent for a guest's proposal in a two-player game, which the host answers (milestone 9).
   */
  waiting?: PlayerId[];
}

/** M12-5a: manual ops of `proposer` (from their own view) in words as `viewer` may know the game (CR 400.2): `unaliasOps`, then `describeOps`. */
export function describeProposal(state: GameState, proposer: PlayerId, ops: ManualOp[], viewer: PlayerId): string[] {
  return describeOps(state, unaliasOps(state, proposer, ops), viewer);
}

/** What a vote did (ManualVotes.vote). */
export type VoteResult = 'pending' | 'accepted' | 'rejected' | 'notVoter' | 'answered';

/**
 * M12-5a: the answers to one proposal. Every voter (each other player still in the game when it was made) must accept; one rejection
 * rejects it; a voter who leaves the game (CR 104.5, 800.4a) no longer counts (`drop`), so the others' acceptance can then complete it.
 */
export class ManualVotes {
  private readonly waitingFor: PlayerId[];
  private rejectedBy: PlayerId | null = null;

  constructor(readonly id: number, readonly player: PlayerId, voters: readonly PlayerId[]) {
    this.waitingFor = voters.filter((p) => p !== player);
  }

  /** The voters whose answer is still awaited, in the order they were given. */
  get waiting(): PlayerId[] {
    return [...this.waitingFor];
  }

  get done(): 'accepted' | 'rejected' | null {
    if (this.rejectedBy !== null) return 'rejected';
    return this.waitingFor.length === 0 ? 'accepted' : null;
  }

  vote(voter: PlayerId, accept: boolean): VoteResult {
    if (this.done) return 'answered';
    const i = this.waitingFor.indexOf(voter);
    if (i < 0) return voter === this.player ? 'notVoter' : 'answered';
    if (!accept) {
      this.rejectedBy = voter;
      return 'rejected';
    }
    this.waitingFor.splice(i, 1);
    return this.waitingFor.length === 0 ? 'accepted' : 'pending';
  }

  /** A voter left the game: their answer is no longer needed. Returns what the proposal is now. */
  drop(voter: PlayerId): 'pending' | 'accepted' | 'rejected' {
    const i = this.waitingFor.indexOf(voter);
    if (i >= 0) this.waitingFor.splice(i, 1);
    return this.done ?? 'pending';
  }
}

type ManualAnswer = Extract<Action, { type: 'answer' }> & { answer: { kind: 'manualResolve'; ops: ManualOp[] } };

/** A manualResolve answer that changes the game (anything but notes) needs the other player's consent online. */
export function needsConsent(action: Action): action is ManualAnswer {
  if (action.type !== 'answer' || action.answer.kind !== 'manualResolve') return false;
  const ops = (action.answer as { ops?: unknown }).ops;
  return Array.isArray(ops) && ops.some((op) => (op as { op?: unknown } | null)?.op !== 'note');
}

/**
 * Names of players and objects as `viewer` may know them (CR 400.2): a card `viewer` cannot see is "a hidden card" with its zone. The ids are the real
 * ids of the state (the ops are unaliased first, `describeOps`), so the description is read from the full state with `canSee`, not from `viewer`'s view:
 * the view shows another player's hidden hand cards under aliases (m4), and a real id would read as "an object that is gone" there (FXH review 1).
 */
function describer(state: GameState, viewer: PlayerId) {
  const player = (id: string) => state.players.find((p) => p.id === id)?.name ?? id;
  const object = (id: string) => {
    const o = state.objects[id];
    if (!o) return player(id) !== id ? player(id) : `an object that is gone (${id})`;
    const name = canSee(state, o, viewer) ? state.defs[o.defId]?.name : undefined;
    const zone = o.zone === 'library' ? `${player(o.owner)}'s library, ${(state.zones.library[o.owner] ?? []).indexOf(id) + 1} from the top` : o.zone === 'hand' ? `${player(o.owner)}'s hand` : o.zone;
    return name ? `${name} (${zone})` : `a hidden card (${zone})`;
  };
  return { player, object };
}

/**
 * Manual ops as chosen by `player` from its own view, with the m4 hand aliases of that view replaced by the real ids (the engine's `unaliasAction`, the
 * same translation `applyAction` makes). A guest names the host's hand cards by alias; describing them unaliased is what lets the host read them.
 */
export function unaliasOps(state: GameState, player: PlayerId, ops: ManualOp[]): ManualOp[] {
  return unaliasAction(state, { type: 'answer', player, ops }).ops;
}

/** The operations in words, as `viewer` may know the game (CR 400.2). `ops` name real ids: unalias a player's ops first (`unaliasOps`). */
export function describeOps(state: GameState, ops: readonly ManualOp[], viewer: PlayerId): string[] {
  const { player, object } = describer(state, viewer);
  const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));
  return ops.map((op) => {
    switch (op.op) {
      case 'move': return `Move ${object(op.object)} to ${op.to}${op.attachTo ? ` attached to ${object(op.attachTo)}` : ''}.`;
      case 'life': return `${player(op.player)}'s life ${signed(op.delta)}.`;
      case 'counters': return `${signed(op.delta)} ${op.counter} counter(s) on ${object(op.object)}.`;
      case 'tap': return `${op.tapped ? 'Tap' : 'Untap'} ${object(op.object)}.`;
      case 'draw': return `${player(op.player)} draws ${op.count}.`;
      case 'shuffle': return `${player(op.player)} shuffles their library.`;
      case 'control': return `${player(op.player)} gains control of ${object(op.object)}.`;
      case 'damage': return `${op.amount} damage to ${object(op.target)}.`;
      case 'attach': return op.to === null ? `Unattach ${object(op.object)}.` : `Attach ${object(op.object)} to ${object(op.to)}.`;
      case 'mana': return `${player(op.player)} adds ${op.types.join('') || 'no mana'}${op.snow ? ' (snow)' : ''}.`;
      case 'token': return `${player(op.player)} creates a ${op.name} token (${op.typeLine}${op.power !== undefined ? `, ${op.power}/${op.toughness ?? '?'}` : ''}).`;
      case 'discard': return `Discard ${object(op.object)}.`;
      case 'tokenCopy':
        return `${player(op.player)} creates a token copy of ${object(op.object)}${op.haste ? ' with haste' : ''}${op.atNextEndStep ? `; ${op.atNextEndStep === 'sacrifice' ? 'sacrifice' : 'exile'} it at the beginning of the next end step` : ''}.`;
      case 'note': return `Note: ${op.text}`;
      default: return `Unknown operation ${JSON.stringify(op)}.`;
    }
  }).map(cleanText); // names and notes typed by the guest
}
