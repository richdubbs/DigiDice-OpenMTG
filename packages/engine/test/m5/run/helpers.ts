/**
 * Helpers for the WP10 tests (the interpreter spine: effects/run.ts, effects/manual.ts, effects/handlers/control.ts, core/resolve.ts).
 *
 * The handlers that change the game (WP12-WP15) are not merged yet, so the tests fake the few they need (design 15.1.7: "fake the neighbors"): `draw`,
 * `gainLife`, `counter` and `move` to a hand, calling milestone 3/4 primitives directly. The real handlers act through WP11's proposal pipeline. The fakes are
 * installed into the real OP_HANDLERS table only while a test body runs (`withFakes`).
 */
import type { CardDef, EffectProgram, EffectStep, GameState, ManualOp, ObjectId, PlayerId, TargetSpec, TriggeredAbilityDef } from '../../../src/index';
import { OP_HANDLERS } from '../../../src/effects/handlers';
import type { OpHandlers, StepResult } from '../../../src/effects/api';
import { evalQty } from '../../../src/effects/eval';
import { currentObjs, resolveObjs, resolvePlayers } from '../../../src/effects/refs';
import { drawCards, moveObject } from '../../../src/core/zones';
import { gainLife } from '../../../src/rules/life';
import { answer, synth } from '../helpers';

export * from '../helpers';
export { putOnStack, chosenObject, chosenPlayer } from '../eval/helpers';

const did = (n: number): StepResult => ({ performed: n > 0, count: n });

/** Stand-ins for WP12-WP14's handlers (tests only). */
export const FAKES: OpHandlers = {
  draw: (cx, st) => {
    const n = Math.max(0, evalQty(cx, st.count) ?? 0);
    let total = 0;
    for (const p of resolvePlayers(cx, st.who)) total += drawCards(cx.g, p, n).length;
    return did(total);
  },
  gainLife: (cx, st) => {
    const n = Math.max(0, evalQty(cx, st.amount) ?? 0);
    let total = 0;
    for (const p of resolvePlayers(cx, st.who)) total += gainLife(cx.g, p, n, 'test') > 0 ? 1 : 0;
    return did(total);
  },
  counter: (cx, st) => {
    const hs = currentObjs(cx, resolveObjs(cx, st.what)).filter((h) => h.zone === 'stack');
    for (const h of hs) moveObject(cx.g, h.id, 'graveyard', { cause: 'countered' });
    return did(hs.length);
  },
  move: (cx, st) => {
    const hs = currentObjs(cx, resolveObjs(cx, st.what));
    for (const h of hs) moveObject(cx.g, h.id, st.to.zone === 'hand' ? 'hand' : st.to.zone === 'graveyard' ? 'graveyard' : 'exile', { cause: 'test' });
    return did(hs.length);
  },
};

/** Run `fn` with the fake handlers of the ops that have no real one yet in OP_HANDLERS; always restored. */
export function withFakes<T>(fn: () => T): T {
  const table = OP_HANDLERS as Record<string, unknown>;
  // Only the ops whose package has not merged are faked: a real handler is never replaced, nor deleted afterwards (W2 merge: WP12 brought gainLife).
  const keys = Object.keys(FAKES).filter((k) => !Object.hasOwn(table, k));
  try {
    for (const k of keys) table[k] = (FAKES as Record<string, unknown>)[k];
    return fn();
  } finally {
    for (const k of keys) delete table[k];
  }
}

/**
 * Run `fn` with these ops' handlers taken out of OP_HANDLERS; always restored. The tests of the spine's "step without a handler" path (guard G11) used ops of
 * packages that had not merged (tap, untap, putCounters); since the W2 merge they have handlers, so the tests take them out for the time of the test.
 */
export function withoutHandlers<T>(ops: readonly string[], fn: () => T): T {
  const table = OP_HANDLERS as Record<string, unknown>;
  const saved = ops.filter((k) => Object.hasOwn(table, k)).map((k) => [k, table[k]] as const);
  try {
    for (const [k] of saved) delete table[k];
    return fn();
  } finally {
    for (const [k, h] of saved) table[k] = h;
  }
}

// ---- steps and cards ---------------------------------------------------------------------------------------------------------------------------------

export const you = { ref: 'you' } as const;
/** A manual step: its prompt is the observable marker of "this step ran now". */
export const mark = (text: string, extra: Partial<Extract<EffectStep, { op: 'manual' }>> = {}): EffectStep => ({ op: 'manual', text, reason: 'test marker', ...extra });
export const draw1 = (who: Extract<EffectStep, { op: 'draw' }>['who'] = you): EffectStep => ({ op: 'draw', who, count: 1 });

/** An instant with one spell ability. */
export const instant = (name: string, program: Partial<EffectProgram>, text = name): CardDef =>
  synth({ name, cost: '{0}', type: 'Instant', abilities: [{ kind: 'spell', text, effect: { targets: program.targets ?? [], steps: program.steps ?? [], ...(program.modes ? { modes: program.modes } : {}) } }] });

/** An enchantment with one triggered ability. */
export const watcher = (name: string, ability: Omit<TriggeredAbilityDef, 'kind'>): CardDef => synth({ name, cost: '{1}', type: 'Enchantment', abilities: [{ kind: 'triggered', ...ability }] });

export const targetSpell: TargetSpec = { id: 't0', kind: 'spell', min: 1, max: 1, text: 'target spell' };
export const targetPermanent: TargetSpec = { id: 't1', kind: 'object', filter: {}, min: 1, max: 1, text: 'target permanent' };

// ---- decisions -------------------------------------------------------------------------------------------------------------------------------------------

/** The kind, player and text of the pending decision (for asserting the order of decisions). */
export function pendingOf(s: GameState): string {
  const d = s.pending;
  if (!d) return 'none';
  if (d.kind === 'manualResolve') return `${d.player} manual: ${d.text}`;
  return `${d.player} ${d.kind}`;
}

export const yes = (s: GameState): GameState => answer(s, { kind: 'yesNo', yes: true });
export const no = (s: GameState): GameState => answer(s, { kind: 'yesNo', yes: false });
export const byHand = (s: GameState, ops: ManualOp[] = []): GameState => answer(s, { kind: 'manualResolve', ops });

/** Answer every manualResolve with no operations, recording their texts in order, until something else is pending. */
export function drainManual(s: GameState, seen: string[] = []): { s: GameState; seen: string[] } {
  while (s.pending?.kind === 'manualResolve') {
    seen.push(s.pending.text);
    s = byHand(s);
  }
  return { s, seen };
}

export const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
export const onStack = (s: GameState, id: ObjectId): boolean => s.zones.stack.includes(id);
