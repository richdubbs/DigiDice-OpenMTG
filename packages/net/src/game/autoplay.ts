/**
 * A very simple automatic player that works from what a player sees (a view and its legal actions), for the CLI's `--auto` mode and the
 * network tests: plays a land, casts a creature, attacks with everything, never blocks, keeps every hand, and answers any other decision with
 * its first legal choice. It is not an AI (milestone 10); it only makes two processes finish a game on their own.
 */
import { decidingPlayer, obeyRequirements, type Action, type Decision, type DecisionAnswer, type GameView, type PlayerId } from '@openmtg/engine';
import type { ViewMessage } from '../protocol/messages';

export type LegalList = ViewMessage['legal'];

function isCreatureCard(view: GameView, objectId: string | undefined): boolean {
  const o = objectId ? view.objects[objectId] : undefined;
  const def = o ? view.defs[o.defId] : undefined;
  return def?.faces[0]?.types.includes('Creature') ?? false;
}

/** The answer to a non-priority decision. */
export function autoAnswer(d: Decision, me: PlayerId): DecisionAnswer | 'cancel' | null {
  switch (d.kind) {
    case 'playFirst': return { kind: 'playFirst', player: d.options.includes(me) ? me : d.options[0]! };
    case 'mulligan': return { kind: 'mulligan', keep: true };
    case 'chooseObjects': return { kind: 'chooseObjects', ids: d.options.slice(0, d.min) };
    case 'yesNo': return { kind: 'yesNo', yes: false };
    case 'chooseOption': {
      const usable = d.options.filter((o) => !o.disabled).map((o) => o.id);
      return { kind: 'chooseOption', ids: d.allowRepeat ? Array.from({ length: d.min }, () => usable[0]!) : usable.slice(0, d.min) };
    }
    case 'chooseNumber': return { kind: 'chooseNumber', n: d.min };
    case 'chooseColor': return { kind: 'chooseColor', color: d.options[0]! };
    case 'order': return { kind: 'order', ids: d.items.map((i) => i.id) };
    case 'chooseTargets': {
      const all = [...d.players.filter((p) => p !== me).map((id) => ({ kind: 'player' as const, id })), ...d.objects.map((id) => ({ kind: 'object' as const, id }))];
      return { kind: 'chooseTargets', targets: all.slice(0, d.min) };
    }
    case 'payCost': return d.autoPayable ? { kind: 'payCost', auto: true } : d.cancellable ? 'cancel' : null;
    case 'declareAttackers': return { kind: 'declareAttackers', attacks: d.candidates.map((c) => ({ attacker: c.id, defender: c.defenders[0]! })) };
    case 'declareBlockers': return { kind: 'declareBlockers', blocks: obeyRequirements(d, []) }; // engine R1: blocks only what CR 509.1c requires
    case 'assignDamage': {
      // CR 510.1c-d: lethal damage to each recipient in turn, the rest to the last one.
      let left = d.amount;
      const amounts = d.recipients.map((r) => {
        const n = Math.min(left, r.lethal);
        left -= n;
        return { id: r.id, amount: n };
      });
      if (left > 0 && amounts.length) amounts[amounts.length - 1]!.amount += left;
      return { kind: 'assignDamage', amounts };
    }
    case 'manualResolve': return { kind: 'manualResolve', ops: [] };
    case 'chooseDivision': {
      const amounts = d.targets.map(() => 1);
      if (amounts.length) amounts[0]! += d.total - amounts.length;
      return { kind: 'chooseDivision', amounts };
    }
    case 'chooseReplacement': return { kind: 'chooseReplacement', id: d.options[0]!.id };
    case 'chooseName': return d.options?.[0] ? { kind: 'chooseName', name: d.options[0] } : null;
    case 'commanderZone': return { kind: 'commanderZone', command: true }; // M11-0: CR 903.9a-b
    default: return null;
  }
}

/** The next action for `me`, or null when it is not `me`'s turn to act (or the bot does not know what to do). */
export function autoAction(view: GameView, legal: LegalList, me: PlayerId): Action | null {
  const d = view.pending;
  if (!d || decidingPlayer(d) !== me || view.result) return null;
  const actor = d.player; // std-control-3 (CR 723.5): the player `me` acts for (`me` itself, or a player `me` controls)
  if (d.kind === 'priority') {
    const land = legal.find((l) => l.kind === 'playLand');
    if (land) return land.action;
    const creature = legal.find((l) => l.kind === 'cast' && isCreatureCard(view, l.object));
    if (creature) return creature.action;
    return { type: 'pass', player: actor };
  }
  const a = autoAnswer(d, actor);
  if (a === null) return null;
  if (a === 'cancel') return { type: 'cancel', player: actor };
  return { type: 'answer', player: actor, decisionId: d.id, answer: a };
}
