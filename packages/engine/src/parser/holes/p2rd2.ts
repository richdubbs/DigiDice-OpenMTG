/**
 * p2-replace-damage-2 ADDITION: the holes of damage-increase replacements (CR 614.1a, 120.3), "If <a source> would deal damage to <a recipient>, it deals <more>
 * instead.", read by the templates of parser/templates/zz-cloud/p2-replace-damage-2.json. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *  - `DamageWould`: "<Filter> would deal [combat | noncombat] damage [to <recipient>]", value the replaced `damage` event pattern (source, recipient, combat). The
 *    recipient is one of the forms Oracle prints for these replacements: "a permanent or player" (anything: no recipient), "an opponent or a permanent an opponent
 *    controls", "an opponent", "a player", "you", "a <Filter>" (a permanent). Each reading is weak (design 6.3 rule 2): a template that spells its sentence out keeps it.
 *    "would deal N or more damage" adds the amount the replaced damage must have; "any source" is every source.
 *  - `DamageMore`: "double that damage" / "twice that much damage" (x2), "triple that damage" / "three times that much damage" (x3), "that much damage plus <Qty>",
 *    "<N> damage" (the amount set to N),
 *    with Oracle's optional repeat of the recipient, "to that permanent or player", "to that player", "to that creature", "to that permanent", "to you"; value the amount change
 *    and that repeat (`to`), which the template does not store: the renderer says it back from the recipient (render/stat.ts), so a repeat that does not fit the
 *    recipient fails the gate (fail closed).
 */
import type { AmountChange, ObjectFilter, PlayerPred } from '../../types/ability';
import type { Alt, HoleFn } from './core';
import { P, phraseAt } from './core';

const W_WOULD_DEAL = P('would deal');
const W_DAMAGE = P('damage');
const W_TO = P('to');
const COMBAT: [string[], boolean | undefined][] = [[P('combat damage'), true], [P('noncombat damage'), false], [W_DAMAGE, undefined]];
const RECIPIENTS: [string[], { object?: ObjectFilter; player?: PlayerPred } | undefined][] = [
  [P('a permanent or player'), undefined],
  [P('an opponent or a permanent an opponent controls'), { player: 'opponent', object: { controller: 'opponent' } }],
  [P('an opponent'), { player: 'opponent' }],
  [P('a player'), { player: 'any' }],
  [P('you'), { player: 'you' }],
];

const W_ANY_SOURCE = P('any source');
const W_OR_MORE = P('or more');

export const damageWould: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  const subjects: { end: number; value: ObjectFilter; weak?: number }[] = ctx.call('Filter', pos).map((s) => ({ end: s.end, value: s.value as ObjectFilter, ...(s.weak ? { weak: s.weak } : {}) }));
  const any = phraseAt(ctx, pos, W_ANY_SOURCE); // "If any source would deal 1 or more damage ..." (Equal Treatment): every source
  if (any >= 0) subjects.push({ end: any, value: {} });
  for (const s of subjects) {
    const w0 = phraseAt(ctx, s.end, W_WOULD_DEAL);
    if (w0 < 0) continue;
    const source = s.value;
    // "would deal 4 or more damage" (Divine Presence; CR 120.3): the replaced damage only when its amount is at least that number
    const amounts: { end: number; amount?: { op: '>='; value: number } }[] = [{ end: w0 }];
    for (const q of ctx.call('Qty', w0)) {
      const m = typeof q.value === 'number' ? phraseAt(ctx, q.end, W_OR_MORE) : -1;
      if (m >= 0) amounts.push({ end: m, amount: { op: '>=', value: q.value as number } });
    }
    for (const am of amounts) for (const [ws, combat] of COMBAT) {
      const d = phraseAt(ctx, am.end, ws);
      if (d < 0) continue;
      // "a source" alone is any source: the event names none (render/evt.ts says it "a source would deal damage to ...")
      const base = { ev: 'damage', ...(Object.keys(source).length > 0 ? { source } : {}), ...(combat !== undefined ? { combat } : {}), ...(am.amount ? { amount: am.amount } : {}) };
      const to = phraseAt(ctx, d, W_TO);
      if (to < 0) continue; // Oracle always names the recipient of these replacements ("to a permanent or player" for anything)
      for (const [rs, recipient] of RECIPIENTS) {
        const e = phraseAt(ctx, to, rs);
        if (e >= 0) out.push({ end: e, value: { ...base, ...(recipient !== undefined ? { recipient } : {}) } as never, weak: 1 + (s.weak ?? 0) });
      }
      const art = ctx.toks[to]?.norm;
      if (art === 'a' || art === 'an') {
        for (const r of ctx.call('Filter', to)) {
          const f = r.value as ObjectFilter;
          if (f.zone !== undefined || f.isCard === true || f.stackKind !== undefined) continue; // a permanent only
          out.push({ end: r.end, value: { ...base, recipient: { object: f } } as never, weak: 1 + (s.weak ?? 0) + (r.weak ?? 0) });
        }
      }
    }
  }
  return out;
};

const MORE: [string[], AmountChange][] = [
  [P('double that damage'), { mul: 2 }], [P('twice that much damage'), { mul: 2 }], [P('triple that damage'), { mul: 3 }], [P('three times that much damage'), { mul: 3 }],
];
const W_THAT_MUCH_PLUS = P('that much damage plus');
const REPEATS: [string[], string][] = [[P('to that permanent or player'), 'permanentOrPlayer'], [P('to that player'), 'player'], [P('to that creature'), 'creature'], [P('to that permanent'), 'permanent'], [P('to you'), 'you']];
const W_DAMAGE_WORD = P('damage');

export const damageMore: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  const withRepeat = (end: number, change: AmountChange): void => {
    out.push({ end, value: { change } as never });
    for (const [ws, to] of REPEATS) {
      const e = phraseAt(ctx, end, ws);
      if (e >= 0) out.push({ end: e, value: { change, to } as never });
    }
  };
  for (const [ws, change] of MORE) {
    const e = phraseAt(ctx, pos, ws);
    if (e >= 0) withRepeat(e, change);
  }
  const plus = phraseAt(ctx, pos, W_THAT_MUCH_PLUS);
  if (plus >= 0) for (const q of ctx.call('Qty', plus)) if (typeof q.value === 'number') withRepeat(q.end, { add: q.value });
  // "that source deals 3 damage to that permanent or player instead" (Divine Presence; CR 614.1a): the amount set to a number
  for (const q of ctx.call('Qty', pos)) {
    const d = typeof q.value === 'number' ? phraseAt(ctx, q.end, W_DAMAGE_WORD) : -1;
    if (d >= 0) withRepeat(d, { set: q.value as number });
  }
  return out;
};
