/**
 * The neighbors WP12 develops against (design 15.1 rule 7), faked for the tests: the proposal pipeline of WP11 (`effects/propose.ts#propose` and
 * `#forbidden`, whose performers call milestone 4's primitives exactly as design 8.5 lists and emit the engine events) and the manual-step prompt of WP10
 * (`effects/manual.ts#askManual`).
 * The test files install them over the real modules with `vi.mock(..., async (importOriginal) => ({ ...(await importOriginal()), ...proposeModule }))`. Every proposal is recorded (without its
 * lifelink ledger, a live object shared by the damage proposals of one step). Three knobs stand in for the effects WP11 applies:
 *  - `forbid`: a "can't" effect (CR 614.17, 101.2): `forbidden` says so and `propose` refuses the event before any replacement;
 *  - `veto`: a replacement or prevention effect that stops an event (CR 614.6, 615): `propose` returns false;
 *  - `modify`: a replacement or prevention effect that changes the event and lets it happen (a prevention shield lowering the damage, CR 615.7).
 */
import type { Game } from '../../../src/core/game';
import type { ExecCtx, Proposed, StepResult } from '../../../src/effects/api';
import { addCounters } from '../../../src/rules/counters';
import { dealDamage } from '../../../src/rules/damage';
import { gainLife, givePoison, loseLife } from '../../../src/rules/life';

export const pipeline = {
  proposals: [] as Proposed[],
  manual: [] as { text: string; reason: string }[],
  forbid: null as ((e: Proposed) => boolean) | null,
  veto: null as ((e: Proposed) => boolean) | null,
  modify: null as ((e: Proposed) => Proposed) | null,
  reset(): void {
    this.proposals = [];
    this.manual = [];
    this.forbid = null;
    this.veto = null;
    this.modify = null;
  },
};

/** What WP11's performers do with an event that survived the pipeline (design 8.5 table). Every performer emits the engine event of what happened. */
function perform(g: Game, e: Proposed): void {
  switch (e.ev) {
    case 'damage':
      dealDamage(g, e.source.id, typeof e.to === 'string' ? e.to : e.to.id, e.amount, { combat: e.combat, ...(e.lifelink ? { lifelink: e.lifelink } : {}) });
      return;
    case 'life':
      if (e.change === 'gain') gainLife(g, e.player, e.amount, 'effect');
      else loseLife(g, e.player, e.amount, 'effect');
      return;
    case 'counters': {
      const delta = e.change === 'put' ? e.count : -e.count;
      if (typeof e.on !== 'string') {
        addCounters(g, e.on.id, e.kind, delta);
        return;
      }
      const p = g.player(e.on);
      if (e.kind === 'poison' && delta > 0) {
        givePoison(g, e.on, delta, 'effect');
        return;
      }
      const before = e.kind === 'poison' ? p.poison : (p.counters[e.kind] ?? 0);
      const after = Math.max(0, before + delta);
      if (e.kind === 'poison') p.poison = after;
      else if (after === 0) delete p.counters[e.kind];
      else p.counters[e.kind] = after;
      if (after !== before) g.emit({ type: 'countersChanged', target: e.on, counter: e.kind, delta: after - before });
      return;
    }
    default:
      throw new Error(`the WP12 tests do not perform ${e.ev}`);
  }
}

const recorded = (e: Proposed): Proposed => {
  if (e.ev !== 'damage' || !e.lifelink) return structuredClone(e);
  const { lifelink: _ledger, ...rest } = e;
  return structuredClone(rest);
};

export function fakeForbidden(_g: Game, e: Proposed): boolean {
  return pipeline.forbid?.(e) === true;
}

export function fakePropose(g: Game, e: Proposed): boolean {
  pipeline.proposals.push(recorded(e));
  if (fakeForbidden(g, e)) return false; // CR 614.17: dropped before any replacement
  if (pipeline.veto?.(e)) return false;
  perform(g, pipeline.modify ? pipeline.modify(e) : e);
  return true;
}

export function fakeAskManual(_cx: ExecCtx, text: string, reason: string): StepResult {
  pipeline.manual.push({ text, reason });
  return { performed: false, count: 0 };
}

// Only the entry points are replaced: the real tables, funnels and spine helpers stay (W2 merge: WP10 and WP11 are real).
export const proposeModule = { propose: fakePropose, forbidden: fakeForbidden };
export const manualModule = { askManual: fakeAskManual };
