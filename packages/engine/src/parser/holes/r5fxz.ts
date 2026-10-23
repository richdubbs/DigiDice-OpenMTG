/**
 * Standard round 5, r5-fxz: small hole grammars of its templates (parser/templates/zz-cloud/r5-fxz.json).
 *
 * `KeptOnTop`: after "for each", the cards an earlier surveil or scry of yours left on top of your library, "card you put on top of your library" (CR 701.25a,
 * 701.22a), and nothing else: the `Filter` readings with the "you put on top of your library" post-modifier (parser/holes/moved-words.ts, kind `top`). Value: the
 * count of them, `{q:'count', of:{ref:'each', filter}}`, which the quantities pass binds to that ONE earlier instruction (lower/quantities.ts#movedCounts); with
 * none, or two, the sentence is manual.
 */
import type { HoleFn } from './core';
import { MOVED_MARK } from './moved-words';

export const keptOnTop: HoleFn = (ctx, pos) =>
  ctx.call('Filter', pos)
    .filter((a) => {
      const f = a.value as Record<string, unknown> | null;
      return f !== null && f[MOVED_MARK] === 'top' && f['isCard'] === true && Object.keys(f).every((k) => k === MOVED_MARK || k === 'isCard' || k === 'owner');
    })
    .map((a) => ({ ...a, value: { q: 'count', of: { ref: 'each', filter: a.value } } }));
