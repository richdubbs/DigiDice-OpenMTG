/**
 * The smoke test's decision policy: a deterministic answer to every decision kind (types/decisions.ts), always legal by construction where the decision
 * states its bounds. It is not a player: it takes the first options, says yes to "may" (so the optional branch runs), attacks with the card under test,
 * never blocks, pays automatically and cancels a payment it cannot make (CR 733.1).
 */
import { chooseObjectsLimitHolds, obeyRequirements, type Action, type Decision, type DecisionAnswer, type ObjectId } from '@openmtg/engine';

export interface AnswerContext {
  /** The permanent under test: it attacks when it can (attack triggers, combat keywords). */
  attacker?: ObjectId;
  /** A card name for "choose a card name" decisions. */
  cardName: string;
}

const take = <T>(xs: readonly T[], min: number, max: number): T[] => xs.slice(0, Math.min(xs.length, Math.max(min, Math.min(1, max))));

export function answerFor(d: Exclude<Decision, { kind: 'priority' }>, ctx: AnswerContext): DecisionAnswer {
  switch (d.kind) {
    case 'playFirst': return { kind: 'playFirst', player: d.options[0]! };
    case 'mulligan': return { kind: 'mulligan', keep: true };
    case 'chooseObjects': {
      // FAST5 T66: a decision with a total limit ("total mana value 4 or less") takes the first options that keep it
      const ids = take(d.options, d.min, d.max);
      while (ids.length > 0 && !chooseObjectsLimitHolds(d, ids)) ids.pop();
      return { kind: 'chooseObjects', ids };
    }
    case 'yesNo': return { kind: 'yesNo', yes: true };
    case 'chooseOption': {
      const usable = d.options.filter((o) => !o.disabled).map((o) => o.id);
      const want = Math.max(d.min, Math.min(1, d.max));
      if (d.allowRepeat && usable.length > 0 && usable.length < want) return { kind: 'chooseOption', ids: Array.from({ length: want }, () => usable[0]!) };
      return { kind: 'chooseOption', ids: usable.slice(0, want) };
    }
    case 'chooseNumber': return { kind: 'chooseNumber', n: Math.min(d.max, Math.max(d.min, 2)) };
    case 'chooseColor': return { kind: 'chooseColor', color: d.options[0]! };
    case 'order': return { kind: 'order', ids: d.items.map((i) => i.id) };
    case 'chooseTargets': {
      const all = [...d.objects.map((id) => ({ kind: 'object' as const, id })), ...d.players.map((id) => ({ kind: 'player' as const, id }))];
      return { kind: 'chooseTargets', targets: take(all, d.min, d.max) };
    }
    case 'payCost': return { kind: 'payCost', auto: true };
    case 'declareAttackers': {
      const attacks = d.candidates
        .filter((c) => c.mustAttack || c.id === ctx.attacker)
        .filter((c) => c.defenders.length > 0)
        .map((c) => ({ attacker: c.id, defender: c.defenders[0]! }));
      // FAST5 T37 (CR 506.5): a creature that "can't attack alone" attacks only with a companion; with none it stays home
      const lone = attacks.length === 1 && d.candidates.find((c) => c.id === attacks[0]!.attacker)?.onlyWithOthers === true;
      const mate = lone ? d.candidates.find((c) => c.id !== attacks[0]!.attacker && c.defenders.length > 0) : undefined;
      const legal = !lone ? attacks : mate ? [...attacks, { attacker: mate.id, defender: mate.defenders[0]! }] : [];
      return { kind: 'declareAttackers', attacks: obeyRequirements(d, legal) }; // engine R1: CR 508.1d requirements are enforced
    }
    case 'declareBlockers': return { kind: 'declareBlockers', blocks: obeyRequirements(d, []) }; // engine R1: blocks only what CR 509.1c requires
    case 'assignDamage': {
      let left = d.amount;
      const amounts = d.recipients.map((r) => {
        const n = r.trampleTarget ? 0 : Math.min(left, r.lethal);
        left -= n;
        return { id: r.id, amount: n };
      });
      const sink = amounts.find((a) => d.recipients.find((r) => r.id === a.id)?.trampleTarget) ?? amounts[0];
      if (sink) sink.amount += left;
      return { kind: 'assignDamage', amounts };
    }
    case 'chooseReplacement': return { kind: 'chooseReplacement', id: d.options[0]!.id };
    case 'manualResolve': return { kind: 'manualResolve', ops: [] };
    case 'chooseDivision': {
      const n = d.targets.length;
      if (n === 0) return { kind: 'chooseDivision', amounts: [] };
      const amounts: number[] = d.targets.map(() => (d.total >= n ? 1 : 0));
      amounts[0]! += d.total - amounts.reduce((a, b) => a + b, 0);
      return { kind: 'chooseDivision', amounts };
    }
    case 'chooseName': return { kind: 'chooseName', name: d.options?.[0] ?? (d.what === 'cardName' ? ctx.cardName : d.what === 'creatureType' ? 'Human' : d.what === 'landType' ? 'Forest' : 'Creature') };
    case 'commanderZone': return { kind: 'commanderZone', command: true }; // M11-0: CR 903.9a-b
  }
}

/** The action that answers (or, for a payment the auto-payer cannot make, cancels) the pending decision. */
export function respond(d: Exclude<Decision, { kind: 'priority' }>, ctx: AnswerContext): Action {
  if (d.kind === 'payCost' && !d.autoPayable && d.cancellable) return { type: 'cancel', player: d.player };
  return { type: 'answer', player: d.player, decisionId: d.id, answer: answerFor(d, ctx) };
}
