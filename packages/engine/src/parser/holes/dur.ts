/**
 * Hole grammar `Dur` (Duration), design 6.3 and model section 3.7. Owner: WP6.
 *
 * "until end of turn" and "this turn" (CR 514.2), "until end of combat" / "this combat", "until your next turn", "until your next upkeep" (CR 500.7),
 * "for as long as ~ remains on the battlefield / you control ~ / ~ is attached to it / ~ remains tapped" (CR 611.2b), "for as long as <condition>",
 * "until ~ leaves the battlefield" (any single event pattern, CR 610.3), "for the rest of the game"; FAST5X E29: "until the end of your next turn" (CR 611.2a),
 * "for as long as it remains exiled" (CR 611.2b, 400.7). The absence of a duration is `permanent` (CR 611.2a)
 * and is the lowering pass's business, not this grammar's.
 */
import type { Duration, EventPattern, PlayerPred, PlayerRef } from '../../types/ability';
import type { Step } from '../../types/state';
import type { Alt, HoleFn } from './core';
import { P, dedupe, phraseAt, predOf } from './core';
import { possessivePlayerAt } from './player';

const STEP_WORDS: [string[], Step][] = [
  [P('upkeep'), 'upkeep'], [P('draw step'), 'draw'], [P('precombat main phase'), 'main1'], [P('first main phase'), 'main1'], [P('postcombat main phase'), 'main2'],
  [P('second main phase'), 'main2'], [P('combat'), 'beginCombat'], [P('end step'), 'end'],
];

export const dur: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  const at = (words: readonly string[], d: Duration): void => { const e = phraseAt(ctx, pos, words); if (e >= 0) out.push({ end: e, value: d }); };
  at(P('until end of turn'), { d: 'endOfTurn' });
  at(P('until the end of the turn'), { d: 'endOfTurn' });
  at(P('this turn'), { d: 'endOfTurn' });
  at(P('until end of combat'), { d: 'endOfCombat' });
  at(P('this combat'), { d: 'endOfCombat' });
  at(P('for the rest of the game'), { d: 'permanent' });
  // r5-dig (CR 611.2a, 607.2a): "until you exile another card with ~" (the duration `untilExiledWith`, core/durations.ts)
  at(P('until you exile another card with ~'), { d: 'untilExiledWith' });

  // until your next turn / until your next upkeep
  const un = phraseAt(ctx, pos, P('until'));
  if (un >= 0) {
    for (const o of possessivePlayerAt(ctx, un)) {
      const nt = phraseAt(ctx, o.end, P('next turn'));
      if (nt >= 0) out.push({ end: nt, value: { d: 'untilNextTurn', whose: o.ref } });
      const nb = phraseAt(ctx, o.end, P('next'));
      if (nb >= 0) for (const [ws, step] of STEP_WORDS) {
        const e = phraseAt(ctx, nb, ws);
        if (e >= 0) out.push({ end: e, value: { d: 'untilNextStep', step, whose: predOf(o.ref) as PlayerPred } });
      }
    }
    // r3-copy (CR 611.2a, 513.1): "until the next end step": whoever's turn it is, the effect ends as the next such step begins (core/durations.ts)
    const tn = phraseAt(ctx, un, P('the next'));
    if (tn >= 0) for (const [ws, step] of STEP_WORDS) {
      const e = phraseAt(ctx, tn, ws);
      if (e >= 0) out.push({ end: e, value: { d: 'untilNextStep', step } });
    }
    // FAST5X E29 (CR 611.2a, 514.2): until the end of your next turn
    const et = phraseAt(ctx, un, P('the end of'));
    if (et >= 0) for (const o of possessivePlayerAt(ctx, et)) {
      const nt = phraseAt(ctx, o.end, P('next turn'));
      if (nt >= 0) out.push({ end: nt, value: { d: 'endOfNextTurn', whose: o.ref } });
    }
    // until the beginning of your next turn
    const bt = phraseAt(ctx, un, P('the beginning of'));
    if (bt >= 0) for (const o of possessivePlayerAt(ctx, bt)) {
      const nt = phraseAt(ctx, o.end, P('next turn'));
      if (nt >= 0) out.push({ end: nt, value: { d: 'untilNextTurn', whose: o.ref } });
    }
    // until <event>
    for (const e of ctx.call('Event', un)) {
      const pats = e.value as EventPattern[];
      // a step event reads as the stated step durations above ("until end of combat", "until your next upkeep"), never as an event to wait for
      if (pats.length === 1 && pats[0]!.ev !== 'step' && !(e.flags ?? []).includes('batch')) out.push({ end: e.end, value: { d: 'until', event: pats[0]! }, ...(e.flags ? { flags: e.flags } : {}) });
    }
  }

  // for as long as ...
  const fal = phraseAt(ctx, pos, P('for as long as'));
  if (fal >= 0) {
    const self = ctx.toks[fal]?.kind === 'SELF';
    if (self) {
      for (const [ws, as] of [[P('remains on the battlefield'), 'onBattlefield'], [P('is on the battlefield'), 'onBattlefield'], [P('stays on the battlefield'), 'onBattlefield'],
        [P('remains tapped'), 'tapped'], [P('is tapped'), 'tapped'], [P('is attached to it'), 'attached'], [P('remains attached to it'), 'attached']] as const) {
        const e = phraseAt(ctx, fal + 1, ws);
        if (e >= 0) out.push({ end: e, value: { d: 'whileSource', as } });
      }
    }
    // FAST5X E29 (CR 611.2b, 400.7): "for as long as it remains exiled": the objects are the ones the effect's permission names (model/cap-walk.ts)
    for (const ws of [P('it remains exiled'), P('that card remains exiled'), P('they remain exiled'), P('those cards remain exiled')]) {
      const e = phraseAt(ctx, fal, ws);
      if (e >= 0) out.push({ end: e, value: { d: 'remainsExiled' } });
    }
    // std-rx32 (CR 611.2b): "for as long as it remains tapped", "for as long as it has a flood counter on it": the object the effect is about (an anaphor,
    // never ~, which is `whileSource` above), judged from its own state (`whileObject`, statics/while-object.ts)
    const pronoun = ctx.toks[fal]?.norm === 'it' || ctx.toks[fal]?.norm === 'that';
    for (const o of pronoun ? ctx.call('Obj', fal) : []) {
      if ((o.value as { ref?: string }).ref === 'self') continue;
      const t = phraseAt(ctx, o.end, P('remains tapped'));
      if (t >= 0) out.push({ end: t, value: { d: 'whileObject', object: o.value as never, as: 'tapped' } });
      for (const art of [P('has a'), P('has an')]) {
        const h = phraseAt(ctx, o.end, art);
        if (h < 0) continue;
        for (const k of ctx.call('CounterKind', h)) {
          const e = phraseAt(ctx, k.end, P('counter on it'));
          if (e >= 0) out.push({ end: e, value: { d: 'whileObject', object: o.value as never, as: 'counter', counter: k.value as string } });
        }
      }
    }
    const yc = phraseAt(ctx, fal, P('you control'));
    if (yc >= 0 && ctx.toks[yc]?.kind === 'SELF') out.push({ end: yc + 1, value: { d: 'whileSource', as: 'controlled' } });
    // std-rx32: where the object reading above covers the words, the condition reading of the same words is not offered (the object's own state is the
    // specific reading, design 6.3 rule 2; `asLongAs` is not judged live, so it could never be automated anyway)
    const objectEnds = new Set(out.filter((a) => (a.value as Duration).d === 'whileObject').map((a) => a.end));
    for (const c of ctx.call('Cond', fal)) if (!objectEnds.has(c.end)) out.push({ end: c.end, value: { d: 'asLongAs', cond: c.value as never }, ...(c.flags ? { flags: c.flags } : {}) });
  }
  return dedupe(out);
};

export type { PlayerRef };
