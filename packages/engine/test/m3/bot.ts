/**
 * A seeded random bot used by the soak test: it picks uniformly among the legal priority actions and
 * answers every other decision with a uniformly random legal answer. It has its own RNG (the engine's
 * RNG lives in the game state and must not be touched).
 */
import { isByHandKind, legalActions, obeyRequirements, seedRng, randomInt, type Action, type Decision, type DecisionAnswer, type GameState, type RngState } from '../../src/index';

export class Bot {
  private readonly rng: RngState;
  constructor(seed: string) {
    this.rng = seedRng(`bot:${seed}`);
  }

  int(n: number): number {
    return randomInt(this.rng, n);
  }

  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)]!;
  }

  chance(percent: number): boolean {
    return this.int(100) < percent;
  }

  /** A uniformly random subset of `xs` with a size in [min, max]. */
  subset<T>(xs: readonly T[], min: number, max: number): T[] {
    const size = min + this.int(Math.min(max, xs.length) - min + 1);
    const pool = [...xs];
    const out: T[] = [];
    for (let i = 0; i < size; i++) out.push(pool.splice(this.int(pool.length), 1)[0]!);
    return out;
  }

  /** Choose the next action for the given state (a priority action or an answer/cancel to the pending decision). */
  next(s: GameState): Action {
    const d = s.pending!;
    // MRE: never the by-hand tools (manualTrigger, manualStatic), as packages/ai/src/priority.ts: they only attest what a player saw on a card, and picked at
    // random they spend the soaks' action budgets on manual decisions instead of real plays. Pass is always listed, so the pool is never empty.
    if (d.kind === 'priority') return this.pick(legalActions(s, d.player).filter((a) => !isByHandKind(a.kind))).action;
    // Cancel sometimes when allowed (CR 733.1), always when payment is impossible.
    if (d.kind === 'payCost' && !d.autoPayable) return { type: 'cancel', player: d.player };
    if (d.cancellable && this.chance(8)) return { type: 'cancel', player: d.player };
    return { type: 'answer', player: d.player, decisionId: d.id, answer: this.answer(d) };
  }

  /** A legal division of combat damage: with trample, either lethal damage to every blocker first and the rest anywhere, or nothing to the attacked permanent. */
  divide(d: Extract<Decision, { kind: 'assignDamage' }>): { id: string; amount: number }[] {
    const amounts = new Map<string, number>(d.recipients.map((r) => [r.id, 0]));
    const blockers = d.recipients.filter((r) => !r.trampleTarget);
    const target = d.recipients.find((r) => r.trampleTarget);
    let left = d.amount;
    const give = (id: string, n: number) => { amounts.set(id, (amounts.get(id) ?? 0) + n); left -= n; };
    if (target && this.chance(70)) {
      for (const r of blockers) give(r.id, Math.min(left, r.lethal));
      if (left > 0) give(target.id, this.int(left + 1)); // some or all of the excess tramples over
    }
    while (left > 0) give(this.pick(blockers.length > 0 ? blockers : d.recipients).id, 1);
    return [...amounts].map(([id, amount]) => ({ id, amount }));
  }

  answer(d: Decision): DecisionAnswer {
    switch (d.kind) {
      case 'priority': throw new Error('priority has no answer');
      case 'playFirst': return { kind: 'playFirst', player: this.pick(d.options) };
      case 'mulligan': return { kind: 'mulligan', keep: d.handSize <= 3 || this.chance(80) };
      case 'chooseObjects': {
        const ids = this.subset(d.options, d.min, d.max);
        return { kind: 'chooseObjects', ids };
      }
      case 'yesNo': return { kind: 'yesNo', yes: this.chance(50) };
      case 'chooseOption': {
        const usable = d.options.filter((o) => !o.disabled).map((o) => o.id);
        if (d.allowRepeat) {
          const n = d.min + this.int(d.max - d.min + 1);
          return { kind: 'chooseOption', ids: Array.from({ length: n }, () => this.pick(usable)) };
        }
        return { kind: 'chooseOption', ids: this.subset(usable, d.min, d.max) };
      }
      case 'chooseNumber': return { kind: 'chooseNumber', n: d.min + this.int(d.max - d.min + 1) };
      case 'chooseColor': return { kind: 'chooseColor', color: this.pick(d.options) };
      case 'order': return { kind: 'order', ids: this.subset(d.items.map((i) => i.id), d.items.length, d.items.length) };
      case 'chooseTargets': {
        const all = [...d.objects.map((id) => ({ kind: 'object' as const, id })), ...d.players.map((id) => ({ kind: 'player' as const, id }))];
        return { kind: 'chooseTargets', targets: this.subset(all, d.min, d.max) };
      }
      case 'payCost': return { kind: 'payCost', auto: true };
      case 'declareAttackers': {
        // Each creature that may attack does so with some probability, at a random thing it may attack (milestone 4).
        const attacks = d.candidates.filter(() => this.chance(60)).map((c) => ({ attacker: c.id, defender: this.pick(c.defenders) }));
        return { kind: 'declareAttackers', attacks: obeyRequirements(d, attacks) }; // R1: CR 508.1d, the requirements the decision lists
      }
      case 'declareBlockers': {
        const blocks: { blocker: string; attacker: string }[] = [];
        for (const c of d.candidates) if (this.chance(55)) blocks.push({ blocker: c.id, attacker: this.pick(c.attackers) });
        // Menace: an attacker blocked by exactly one creature is an illegal declaration, so drop that block (CR 702.111b).
        const count = new Map<string, number>();
        for (const b of blocks) count.set(b.attacker, (count.get(b.attacker) ?? 0) + 1);
        const legal = blocks.filter((b) => !d.needsMultiple.includes(b.attacker) || (count.get(b.attacker) ?? 0) >= 2);
        return { kind: 'declareBlockers', blocks: obeyRequirements(d, legal) }; // R1: CR 509.1c
      }
      case 'assignDamage': return { kind: 'assignDamage', amounts: this.divide(d) };
      case 'manualResolve': return { kind: 'manualResolve', ops: this.chance(30) ? [{ op: 'note', text: 'bot note' }] : [] };
      // CR 601.2d: each announced target gets at least 1, the rest is spread at random (W3b: decklist cards now divide damage and counters)
      case 'chooseDivision': {
        const amounts = d.targets.map(() => 1);
        for (let left = d.total - amounts.length; left > 0; left--) amounts[this.int(amounts.length)]! += 1;
        return { kind: 'chooseDivision', amounts };
      }
      // CR 616.1: the affected player picks which replacement effect applies first
      case 'chooseReplacement': return { kind: 'chooseReplacement', id: this.pick(d.options).id };
      // M11-0: CR 903.9a-b, either choice is legal (never asked outside a Commander game, so the earlier soaks draw the same numbers)
      case 'commanderZone': return { kind: 'commanderZone', command: this.chance(70) };
      default: throw new Error(`The bot cannot answer a "${d.kind}" decision yet`);
    }
  }
}
