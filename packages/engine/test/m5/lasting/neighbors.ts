/**
 * The neighbors WP15 develops against (design 15.1 rule 7), faked for its tests. Each is the smallest thing that does what the design says the real one does;
 * the real ones replace them at the W2 merge (the integration test of the merge runs the same cards through `applyAction` with WP10, WP11 and WP14 real).
 *
 *  - WP10 `effects/run.ts#runSteps`: guards, the handler of `OP_HANDLERS` (or of `FAKE_HANDLERS` below for the ops of other families), results under `as`;
 *  - WP10 `core/resolve.ts#resolveTopOfStack` for instants, sorceries and abilities: ONE context and target check (CR 608.2b), the steps, then the object leaves the
 *    stack (CR 608.2n); permanent spells keep milestone 4's resolution;
 *  - WP10 `effects/manual.ts#askManual`: recorded in `neighbors.manual`, nothing else;
 *  - WP11 `effects/propose.ts#propose`: recorded in `neighbors.proposals`; a zone change is performed with `moveObject`;
 *  - the handlers of other families the section 13 cards need, reduced to what those cards do: `may`, `pay` (the payment itself is not modeled: the player answers
 *    yes or no), `chooseObjects` (WP10), `move` with `link`, `sacrifice`, `counter` (WP14), `draw` (WP13).
 * The test files install them with `vi.mock(<module>, async (orig) => (await import('./neighbors')).<module>Mock(await orig()))`.
 */
import type { Game } from '../../../src/core/game';
import { drawCards, moveObject } from '../../../src/core/zones';
import type { ExecCtx, Proposed, StepHandler, StepResult } from '../../../src/effects/api';
import { makeCtx, recheckAll } from '../../../src/effects/ctx';
import { evalCond, evalCount } from '../../../src/effects/eval';
import { isCurrent, rebase, resolveObjs, resolvePlayers } from '../../../src/effects/refs';
import { abilityDefOnStack } from '../../../src/rules/abilities';
import { charsOfObject } from '../../../src/rules/characteristics';
import type { AbilityDef, Duration, EffectProgram, EffectStep } from '../../../src/types/ability';
import type { ObjHandle } from '../../../src/types/state';

export const neighbors = {
  proposals: [] as Proposed[],
  /** The manual prompts, with the lifetime of the reminder chip when one was asked for. */
  manual: [] as { text: string; reason: string; until?: Duration }[],
  /** Every list of steps `runSteps` was handed, in order. */
  ran: [] as EffectStep[][],
  /** The real `OP_HANDLERS`, handed over by the test file (importing it here would make the mocks of the modules it imports wait for themselves). */
  handlers: {} as Record<string, unknown>,
  reset(): void {
    this.proposals = [];
    this.manual = [];
    this.ran = [];
  },
};

const NOTHING: StepResult = { performed: false, count: 0 };

// ---- WP11: propose ----------------------------------------------------------------------------------------------------------------------------------------

/** The real `propose` (WP11), handed over by `proposeMock`: events other than zone changes go through it since the W2 merge (WP13's draw, WP14's tokens). */
let realPropose: ((g: Game, e: Proposed) => boolean) | null = null;

export function fakePropose(g: Game, e: Proposed): boolean {
  neighbors.proposals.push(structuredClone(e));
  if (e.ev === 'zoneChange') {
    if (g.s.objects[e.object.id]?.zone !== e.object.zone) return false;
    moveObject(g, e.object.id, e.to, { cause: 'test', ...(e.destination.controller ? { controller: e.destination.controller } : {}) });
    return true;
  }
  if (realPropose) return realPropose(g, e);
  throw new Error(`the WP15 tests do not perform ${e.ev}`);
}

// ---- WP10: askManual, runSteps, the spine ------------------------------------------------------------------------------------------------------------------

export function fakeAskManual(_cx: ExecCtx, text: string, reason: string, until?: Duration): StepResult {
  neighbors.manual.push({ text, reason, ...(until !== undefined ? { until: structuredClone(until) } : {}) });
  return NOTHING;
}

type AnyHandler = (cx: ExecCtx, st: EffectStep) => StepResult;

export function fakeRunSteps(cx: ExecCtx, steps: EffectStep[]): StepResult {
  neighbors.ran.push(steps);
  let performed = false;
  let count = 0;
  for (const st of steps) {
    if (st.guard && !evalCond(cx, st.guard)) {
      if (st.as) {
        cx.results.set(st.as, NOTHING);
        if (!cx.bindings.has(st.as)) cx.bindings.set(st.as, { objects: [], players: [], snapshots: {} });
      }
      continue;
    }
    // The fakes first: these tests pin WP15's handlers against the reduced neighbors (W2 merge: the real ones of the same ops now exist; integration.test.ts runs them).
    const h = ((FAKE_HANDLERS as Record<string, AnyHandler | undefined>)[st.op] ?? (neighbors.handlers as Record<string, AnyHandler | undefined>)[st.op]);
    const res = h ? h(cx, st) : fakeAskManual(cx, st.span ?? st.op, `no handler for ${st.op} in the WP15 tests`);
    if (st.as) cx.results.set(st.as, res);
    if (res.performed) performed = true;
    count += res.count;
  }
  return { performed, count };
}

/** The effect program of the object on top of the stack, if it is an instant, a sorcery or an ability with one. */
function programOf(g: Game, id: string): { program: EffectProgram; def: AbilityDef } | undefined {
  const o = g.obj(id);
  const def = o.kind === 'ability' ? abilityDefOnStack(g.s, o) : charsOfObject(g.s, o).abilities.map((a) => a.def).find((a) => a.kind === 'spell');
  if (!def || !('effect' in def) || !def.effect) return undefined;
  const p = def.effect;
  if (!p.modes) return { program: p, def };
  const chosen = (o.stack?.modes ?? []).map((m) => p.modes!.options[m]!.program);
  return { program: { targets: [...chosen.flatMap((c) => c.targets), ...p.targets], steps: [...chosen.flatMap((c) => c.steps), ...p.steps] }, def };
}

/** WP10 stand-in for core/resolve.ts#resolveTopOfStack (instants, sorceries, abilities); `actual` resolves everything else. */
export function fakeResolveTop(actual: (g: Game) => void) {
  return (g: Game): void => {
    const id = g.s.zones.stack[g.s.zones.stack.length - 1]!;
    const o = g.obj(id);
    const found = programOf(g, id);
    if (!found || (o.kind !== 'ability' && !['Instant', 'Sorcery'].some((t) => charsOfObject(g.s, o).types.includes(t as never)))) {
      actual(g);
      return;
    }
    const cx = makeCtx(g, o, found.program);
    const { legal, total } = recheckAll(cx);
    if (!(total > 0 && legal === 0)) fakeRunSteps(cx, found.program.steps);
    if (g.s.objects[id]?.zone === 'stack') moveObject(g, id, 'graveyard', { cause: 'resolve' }); // CR 608.2n (an ability ceases to exist)
  };
}

// ---- the other families, reduced to what the section 13 cards need -----------------------------------------------------------------------------------------

const bindObjects = (cx: ExecCtx, name: string | undefined, objects: ObjHandle[]): void => {
  if (name) cx.bindings.set(name, { objects, players: [], snapshots: {} });
};

const moveAll = (cx: ExecCtx, hs: ObjHandle[], to: 'graveyard' | 'exile' | 'battlefield' | 'hand', controller?: (h: ObjHandle) => string): ObjHandle[] => {
  const out: ObjHandle[] = [];
  for (const h of hs) {
    if (!isCurrent(cx, h)) continue;
    const ok = fakePropose(cx.g, { ev: 'zoneChange', object: h, from: h.zone, to, destination: controller ? { controller: controller(h) } : {} });
    const newId = ok ? cx.g.s.lki[h.id]?.newId : undefined;
    const nh = newId ? { id: newId, zone: to } : null;
    rebase(cx, h.id, nh);
    if (nh) out.push(nh);
  }
  return out;
};

type H<K extends EffectStep['op']> = StepHandler<Extract<EffectStep, { op: K }>>;

export const FAKE_HANDLERS: { [K in EffectStep['op']]?: H<K> } = {
  may: (cx, st) => {
    const p = resolvePlayers(cx, st.who)[0]!;
    const yes = cx.g.choose({ kind: 'yesNo', player: p, prompt: st.span ?? 'May?', rules: ['CR 608.2d'] }).yes;
    if (yes) fakeRunSteps(cx, st.do);
    else if (st.otherwise) fakeRunSteps(cx, st.otherwise);
    return { performed: yes, count: yes ? 1 : 0 };
  },
  pay: (cx, st) => {
    const p = resolvePlayers(cx, st.who)[0]!;
    const yes = cx.g.choose({ kind: 'yesNo', player: p, prompt: 'Pay?', rules: ['CR 118.12'] }).yes;
    fakeRunSteps(cx, (yes ? st.then : st.else) ?? []);
    return { performed: yes, count: yes ? 1 : 0 };
  },
  chooseObjects: (cx, st) => {
    const options = resolveObjs(cx, st.from).filter((h) => isCurrent(cx, h));
    const min = Math.min(evalCount(st.min, { cx }), options.length);
    const max = Math.min(evalCount(st.max, { cx }), options.length);
    const p = resolvePlayers(cx, st.who)[0]!;
    const ids = options.length === 0 ? [] : cx.g.choose({ kind: 'chooseObjects', player: p, prompt: 'Choose.', options: options.map((h) => h.id), min, max, rules: ['CR 608.2d'] }).ids;
    bindObjects(cx, st.as, options.filter((h) => ids.includes(h.id)));
    return { performed: ids.length > 0, count: ids.length };
  },
  move: (cx, st) => {
    const to = st.to.zone as 'graveyard' | 'exile' | 'battlefield' | 'hand';
    const owner = (h: ObjHandle): string => cx.g.s.objects[h.id]!.owner;
    const ctl = st.to.zone === 'battlefield' ? (h: ObjHandle) => (st.to.controller === 'owner' ? owner(h) : resolvePlayers(cx, st.to.controller as never)[0]!) : undefined;
    const moved = moveAll(cx, resolveObjs(cx, st.what), to, ctl);
    if (st.link) {
      const src = cx.g.s.objects[cx.source.id];
      if (src) src.links = { ...(src.links ?? {}), [st.link]: { objects: moved } }; // CR 607.2a: on THIS object instance
    }
    if (st.as) bindObjects(cx, st.as, moved);
    return { performed: moved.length > 0, count: moved.length };
  },
  sacrifice: (cx, st) => {
    const moved = moveAll(cx, resolveObjs(cx, st.what).filter((h) => h.zone === 'battlefield'), 'graveyard');
    return { performed: moved.length > 0, count: moved.length };
  },
  counter: (cx, st) => {
    const moved = moveAll(cx, resolveObjs(cx, st.what).filter((h) => h.zone === 'stack'), 'graveyard');
    return { performed: moved.length > 0, count: moved.length };
  },
  draw: (cx, st) => {
    const n = evalCount(st.count, { cx });
    for (const p of resolvePlayers(cx, st.who)) drawCards(cx.g, p, n);
    return { performed: n > 0, count: n };
  },
};

// ---- vi.mock factories ------------------------------------------------------------------------------------------------------------------------------------

export const proposeMock = (orig: Record<string, unknown>): Record<string, unknown> => {
  realPropose = orig['propose'] as (g: Game, e: Proposed) => boolean;
  return { ...orig, propose: fakePropose };
};
export const manualMock = (orig: Record<string, unknown>): Record<string, unknown> => ({ ...orig, askManual: fakeAskManual });
export const runMock = (orig: Record<string, unknown>): Record<string, unknown> => ({ ...orig, runSteps: fakeRunSteps });
export const resolveMock = (orig: Record<string, unknown>): Record<string, unknown> => ({ ...orig, resolveTopOfStack: fakeResolveTop(orig['resolveTopOfStack'] as (g: Game) => void) });
