/**
 * The `instead` and `skip` replacement bodies (CR 614.6, 614.10; m6 design 3.1, 3.2). Owner: M6-1 (new file of W1).
 *
 *   instead  "If [event] would happen, [do this] instead" (CR 614.1a, 614.6): the original event never happens; the `do` steps run in an interpreter context
 *            whose source is the replacement's source (or its last known information, CR 113.7a), whose controller ("you", CR 109.5) is the effect's
 *            controller, and whose `event` roles are the proposed event's (subject, source, recipient, player), with `{q:'eventAmount'}` the event's amount
 *            (CR 614.11a-b). The events those steps propose start from this proposal's set of used effects (CR 614.5, m6 design 3.1.5: effects/propose.ts
 *            applies the body inside the chain).
 *   insteadThen  merge wave 8 (audit D4): "instead A, then [the replaced event]" (CR 614.1a, 614.6): A, then the same event, unchanged (CR 614.5).
 *   skip     "Skip [step/phase/turn/that draw]" (CR 614.10): the proposal returns null and the turn structure goes on with what follows (core/turn-skip.ts);
 *            "the next" waits for the first occurrence that is not skipped (CR 614.10a) because each occurrence is proposed.
 */
import type { Game } from '../core/game';
import type { ReplacementBody } from '../types/ability';
import type { EventContext, GameObject } from '../types/state';
import type { ExecCtx, Proposed } from './api';
import { makeCtx } from './ctx';
import { runNested, semOfNested } from './nested';
import { evalCond } from './eval';
import type { BodyKinds } from './registries';
import type { Candidate } from './replacements';

/** "That much" of the event being replaced (CR 614.11a): damage, life, counters, tokens; one card for a draw. */
export function eventAmount(e: Proposed): number | undefined {
  switch (e.ev) {
    case 'damage': case 'life': case 'payLife': return e.amount; // std-library-4: the life paid
    case 'counters': case 'createToken': case 'mill': case 'drawMany': case 'scry': return e.count; // r4-repl: drawMany; p2-replace-events-3: scry
    case 'connive': return e.n;
    case 'draw': return 1;
    default: return undefined;
  }
}

/** The interpreter context the steps of a replacement run in (m6 design 3.2): the effect's source and controller, the replaced event's roles and amount. */
export function replacementCtx(g: Game, e: Proposed, c: Candidate): ExecCtx {
  const src: GameObject | undefined = g.s.objects[c.source.id] ?? g.s.lki[c.source.id]?.object;
  // a shield whose source is unknown (no object, no last known information) still has a controller: its steps read no "this object"
  const stand = src ?? ({ id: c.source.id, zone: c.source.zone, controller: c.controller, owner: c.controller, timestamp: 0 } as unknown as GameObject);
  const cx = makeCtx(g, stand, { targets: [], steps: [] });
  cx.source = { id: c.source.id, zone: c.source.zone };
  cx.controller = c.controller;
  const sem = semOfNested(g, e);
  const amount = eventAmount(e);
  const event: EventContext = { ev: sem.ev, roles: sem.roles, before: {}, ...(amount !== undefined ? { amount } : {}), ...(e.ev === 'createToken' ? { token: e.token } : {}) };
  cx.event = event;
  return cx;
}

const describeEvent = (g: Game, e: Proposed): string => {
  switch (e.ev) {
    case 'draw': return `${g.player(e.player).name} would draw a card`;
    case 'damage': return 'damage would be dealt';
    case 'life': return `${g.player(e.player).name} would ${e.change === 'gain' ? 'gain' : 'lose'} life`;
    case 'zoneChange': return `${g.nameOf(e.object.id)} would be put into ${e.to === 'exile' ? 'exile' : `a ${e.to}`}`;
    case 'destroy': return `${g.nameOf(e.object.id)} would be destroyed`;
    case 'createToken': return 'tokens would be created';
    case 'counters': return 'counters would be put or removed';
    case 'connive': return `${g.nameOf(e.object.id)} would connive`;
    case 'mill': return `${g.player(e.player).name} would mill ${e.count} card${e.count === 1 ? '' : 's'}`;
    case 'drawMany': return `${g.player(e.player).name} would draw ${e.count} card${e.count === 1 ? '' : 's'}`; // r4-repl
    case 'explore': return `${g.nameOf(e.object.id)} would explore`; // r4-repl
    case 'proliferate': return `${g.player(e.player).name} would proliferate`; // p2-replace-events-2
    case 'scry': return `${g.player(e.player).name} would scry ${e.count}`; // p2-replace-events-3
    case 'payLife': return `${g.player(e.player).name} would pay ${e.amount} life`; // std-library-4
    default: return 'it would happen';
  }
};

/** CR 614.6: the original event never happens; the steps happen instead. */
export function applyInstead(g: Game, e: Proposed, b: Extract<ReplacementBody, { b: 'instead' }>, c: Candidate): Proposed | null {
  g.log(`${c.sourceName}: ${describeEvent(g, e)}; something else happens instead.`, { rules: ['CR 614.1a', 'CR 614.6'], level: 'action' });
  runNested(replacementCtx(g, e, c), b.do);
  return null;
}

/**
 * Merge wave 8 (audit D4; CR 614.1a, 614.5, 614.6): "instead A, then [the replaced event]": A happens first, then the replaced event itself, unchanged (its object,
 * amount and cause): the event returned is the modified event, which this effect has already applied to (effects/propose.ts keeps it in the used set).
 */
export function applyInsteadThen(g: Game, e: Proposed, b: Extract<ReplacementBody, { b: 'insteadThen' }>, c: Candidate): Proposed | null {
  g.log(`${c.sourceName}: ${describeEvent(g, e)}; something else happens first, then it does.`, { rules: ['CR 614.1a', 'CR 614.6'], level: 'action' });
  const cx = replacementCtx(g, e, c);
  runNested(cx, b.do);
  // p2-replace-events-1 (CR 614.1a, 614.6): "If you do, put this land onto the battlefield. If you don't, put it into its owner's graveyard." the same event goes on
  // only if the condition holds after the steps; otherwise the same zone change goes elsewhere (its cause kept: the land played is still played, CR 305.1)
  if (b.if !== undefined && !evalCond(cx, b.if)) {
    if (b.otherwise === undefined || e.ev !== 'zoneChange') return null;
    // the same zone change, to a zone that is not the battlefield or a library (no entering facts, no position: effects/bodies/m5.ts#applyDestination for those)
    const to = b.otherwise.zone;
    if (to === 'battlefield' || to === 'library') return null;
    g.log(`${g.nameOf(e.object.id)} is put into ${to === 'exile' ? 'exile' : `its owner's ${to}`} instead (${c.sourceName}).`, { rules: ['CR 614.1a', 'CR 614.6'], level: 'action' });
    return { ...e, to, destination: e.destination.cause !== undefined ? { cause: e.destination.cause } : {} };
  }
  return e;
}

/** The events a `skip` replaces (CR 614.10): a step, a phase, a turn, a draw ("skips that draw"). */
const SKIPPABLE: ReadonlySet<Proposed['ev']> = new Set<Proposed['ev']>(['step', 'phase', 'turn', 'draw']);

export const INSTEAD_BODY_KINDS: Pick<BodyKinds, 'instead' | 'insteadThen' | 'skip'> = {
  instead: {
    capabilities: ['instead'],
    fits: (_g, _e, b) => Array.isArray(b.do),
    apply: (g, e, b, c) => applyInstead(g, e, b, c),
  },
  insteadThen: {
    capabilities: ['insteadThen', 'insteadThen.if' /* p2-replace-events-1: CR 614.1a, 614.6 */], // merge wave 8 (audit D4)
    fits: (_g, e, b) => Array.isArray(b.do) && (b.otherwise === undefined || (b.if !== undefined && e.ev === 'zoneChange' && b.otherwise.zone !== 'battlefield' && b.otherwise.zone !== 'library')),
    apply: (g, e, b, c) => applyInsteadThen(g, e, b, c),
  },
  skip: {
    capabilities: ['skip'],
    fits: (_g, e) => SKIPPABLE.has(e.ev),
    apply: (g, e, _b, c) => {
      const what = e.ev === 'step' ? `the ${e.step} step` : e.ev === 'phase' ? `the ${e.phase} phase` : e.ev === 'turn' ? 'that turn' : 'that draw';
      const whose = e.ev === 'draw' ? e.player : e.ev === 'step' || e.ev === 'phase' || e.ev === 'turn' ? e.whose : null;
      g.log(`${whose ? g.player(whose).name : 'A player'} skips ${what} (${c.sourceName}).`, { rules: ['CR 614.10'], level: 'action' });
      return null;
    },
  },
};
