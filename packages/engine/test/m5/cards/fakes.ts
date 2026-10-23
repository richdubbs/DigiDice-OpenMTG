/**
 * Fakes of the WP13 neighbors that are still WP0 stubs (design 15.1.3, 15.1.7): the proposal pipeline and performers (WP11, `effects/propose.ts`) and the manual
 * step support (WP10, `effects/manual.ts`). Each test file installs them with
 *
 *   vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fakes')).proposeModule() }));
 *   vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fakes')).manualModule() }));
 *
 * (partial mocks since the W2 merge: only the entry points are replaced; the real tables, funnels and spine helpers stay)
 *
 * The fake performer calls the milestone 3/4 primitives exactly as design 8.5 says the real one will (`drawCard`, `moveObject`). `replacements` lets a test play
 * the part of a replacement or "can't" effect (CR 614.1, 614.17) without WP11 or WP16. Because the fake performer itself hands `cause` to `moveObject`, the
 * suite would stay green if the real one dropped it: ./pipeline.test.ts does not mock `propose` and turns on by itself when WP11 merges (plus todos for WP10).
 */
import type { Game } from '../../../src/core/game';
import { drawCard, moveObject } from '../../../src/core/zones';
import type { ExecCtx, Proposed, StepResult } from '../../../src/effects/api';
import type { ZoneKind } from '../../../src/types/state';

export interface FakeReplacement {
  /** Return `null` to stop the event (a "can't" effect or an "instead" that does something else), a modified event, or `undefined` to leave it alone. */
  apply: (g: Game, e: Proposed) => Proposed | null | undefined;
}

/** The replacement effects the fake pipeline applies, in order. Tests push and clear it. */
export const replacements: FakeReplacement[] = [];

/** Every event that reached the fake performer, for assertions ("each card was proposed on its own"). */
export const performed: Proposed[] = [];

export function fakePerform(g: Game, e: Proposed): void {
  performed.push(e);
  switch (e.ev) {
    case 'draw':
      drawCard(g, e.player);
      return;
    case 'zoneChange':
      moveObject(g, e.object.id, e.to as ZoneKind, { ...(e.destination.cause !== undefined ? { cause: e.destination.cause } : {}), ...(e.destination.position !== undefined ? { position: e.destination.position } : {}) }); // WP14's real move proposes the library position (CR 401.3)
      return;
    default:
      throw new Error(`the fake performer of the WP13 tests does not perform ${e.ev}`);
  }
}

export function fakePropose(g: Game, e: Proposed): boolean {
  let cur: Proposed | null = e;
  for (const r of replacements) {
    if (!cur) break;
    const next = r.apply(g, cur);
    if (next !== undefined) cur = next;
  }
  if (!cur) return false;
  fakePerform(g, cur);
  return true;
}

export const proposeModule = () => ({ propose: fakePropose });

/** What WP10's `askManual` does (design 8.9): a `manualResolve` decision for the controller; the answer's operations are applied by the real spine. */
export function fakeAskManual(cx: ExecCtx, text: string, reason: string): StepResult {
  cx.g.choose({ kind: 'manualResolve', player: cx.controller, prompt: text, sourceName: cx.stack?.sourceName ?? 'effect', text, reason, rules: ['CR 608.2'] });
  return { performed: false, count: 0 };
}

export const manualModule = () => ({ askManual: fakeAskManual });
