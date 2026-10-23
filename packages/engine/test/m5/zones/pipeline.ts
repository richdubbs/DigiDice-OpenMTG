/**
 * The neighbors WP14 develops against (design 15.1 rule 7), faked for the tests: the proposal pipeline of WP11 (`effects/propose.ts#propose`, whose performers
 * call milestone 3/4's primitives exactly as design 8.5 lists: `moveObject`, `createToken`, `destroy`, the life and counter helpers) and the manual-step prompt of
 * WP10 (`effects/manual.ts#askManual`). Test files install them with
 *   vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).proposeModule }));
 *   vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./pipeline')).manualModule }));
 * (the real module's other exports are kept, so the mocks still load once WP10 and WP11 add exports of their own; checked on a trial merge of both).
 * Every proposal is recorded; `veto` stands in for a replacement or prevention effect that stops an event (CR 614.6), so a handler's result can be checked when
 * the pipeline says no; `redirect` for one that changes where a zone change goes (CR 614.1a: Leyline of the Void).
 */
import type { Game } from '../../../src/core/game';
import { createToken, drawCard, moveObject, type MoveOptions } from '../../../src/core/zones';
import type { ExecCtx, Proposed, StepResult } from '../../../src/effects/api';
import { addCounters } from '../../../src/rules/counters';
import { dealDamage } from '../../../src/rules/damage';
import { destroy } from '../../../src/rules/destroy';
import { gainLife, loseLife } from '../../../src/rules/life';
import type { ObjectId } from '../../../src/types/ids';
import type { DestinationFacts } from '../../../src/effects/api';
import type { ZoneKind } from '../../../src/types/state';

export const pipeline = {
  proposals: [] as Proposed[],
  manual: [] as { text: string; reason: string }[],
  veto: null as ((e: Proposed) => boolean) | null,
  redirect: null as ((e: Extract<Proposed, { ev: 'zoneChange' }>) => ZoneKind | null) | null,
  reset(): void {
    this.proposals = [];
    this.manual = [];
    this.veto = null;
    this.redirect = null;
  },
};

const isLive = (g: Game, id: ObjectId, zone: string): boolean => g.s.objects[id]?.zone === zone;

/** What WP11's `applyEnterFacts` does for a permanent that has just entered (counters as it enters, CR 122.6; attached, CR 303.4f). */
function enterFacts(g: Game, id: ObjectId, d: DestinationFacts): void {
  for (const c of d.counters ?? []) if (c.count > 0) addCounters(g, id, c.kind, c.count);
  if (d.attachTo !== undefined) {
    g.obj(id).attachedTo = d.attachTo;
    g.emit({ type: 'attached', objectId: id, to: d.attachTo });
  }
}

/** What WP11's performers do with an event that survived the pipeline (design 8.5 table). */
function perform(g: Game, e: Proposed): void {
  switch (e.ev) {
    case 'zoneChange': {
      if (!isLive(g, e.object.id, e.object.zone)) return;
      const d = e.destination;
      const opts: MoveOptions = {
        ...(d.position !== undefined ? { position: d.position } : {}), ...(d.cause !== undefined ? { cause: d.cause } : {}),
        ...(d.controller !== undefined ? { controller: d.controller } : {}), ...(d.tapped ? { tapped: true } : {}), ...(d.face !== undefined ? { face: d.face } : {}),
      };
      const newId = moveObject(g, e.object.id, e.to, opts);
      if (newId && e.to === 'battlefield') enterFacts(g, newId, d);
      return;
    }
    case 'createToken': {
      const def = g.s.defs[e.token];
      if (!def) throw new Error(`no token definition ${e.token}`);
      for (let i = 0; i < e.count; i++) {
        const id = createToken(g, def, e.player, e.enter?.tapped ? { tapped: true } : {});
        if (!id) continue; // WP11: the creation went through the real entry funnel and did not happen
        g.emit({ type: 'tokenCreated', player: e.player, objectId: id });
        if (e.enter) enterFacts(g, id, e.enter);
      }
      return;
    }
    case 'draw': // WP13's real draw handler proposes it since the W2 merge
      drawCard(g, e.player);
      return;
    case 'destroy':
      if (isLive(g, e.object.id, e.object.zone)) destroy(g, e.object.id, { cantRegenerate: !e.canRegenerate });
      return;
    case 'life':
      if (e.change === 'gain') gainLife(g, e.player, e.amount, 'effect');
      else loseLife(g, e.player, e.amount, 'effect');
      return;
    case 'counters':
      if (typeof e.on !== 'string') addCounters(g, e.on.id, e.kind, e.change === 'put' ? e.count : -e.count);
      return;
    case 'damage':
      dealDamage(g, e.source.id, typeof e.to === 'string' ? e.to : e.to.id, e.amount, { combat: e.combat });
      return;
    default:
      throw new Error(`the WP14 tests do not perform ${e.ev}`);
  }
}

export function fakePropose(g: Game, e: Proposed): boolean {
  pipeline.proposals.push(structuredClone(e));
  if (pipeline.veto?.(e)) return false;
  if (e.ev === 'zoneChange' && pipeline.redirect) {
    const to = pipeline.redirect(e);
    if (to) {
      perform(g, { ...e, to });
      return true;
    }
  }
  perform(g, e);
  return true;
}

export function fakeAskManual(_cx: ExecCtx, text: string, reason: string): StepResult {
  pipeline.manual.push({ text, reason });
  return { performed: false, count: 0 };
}

export const proposeModule = { propose: fakePropose, REPLACEMENT_BODIES: {}, FEATURES: [] };
export const manualModule = { askManual: fakeAskManual, FEATURES: [] };
