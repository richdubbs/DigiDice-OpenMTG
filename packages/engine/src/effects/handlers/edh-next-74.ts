/**
 * edh-next-74 (Commander lane copy, third round): op handlers in a table of their own (design 5.2: `op:<op>` is a capability because it has a handler here AND a renderer).
 * Ops: doubleX (CR 107.3, 601.2b; Unbound Flourishing: "double the value of X").
 */
import type { OpHandlers } from '../api';
import { resolveObjs } from '../refs';
import { did, NOTHING } from './zones-util';

export const EDH_N74_HANDLERS: OpHandlers = {
  /**
   * CR 107.3, 601.2b (Unbound Flourishing; Scryfall ruling 2019-06-14): the value of X of a spell on the stack is doubled, and no more mana is paid (the mana already spent stays what it was).
   * A spell with no announced X on the stack, or one that has left the stack, is left alone. Two such effects multiply it by four (each doubles the value the other left).
   */
  doubleX: (cx, step) => {
    let n = 0;
    for (const h of resolveObjs(cx, step.what)) {
      const o = cx.g.s.objects[h.id];
      if (!o || o.zone !== 'stack' || h.zone !== 'stack' || o.stack?.x === undefined) continue;
      o.stack.x *= 2;
      n++;
      cx.g.log(`The value of X of ${cx.g.nameOf(o.id)} is doubled to ${o.stack.x}.`, { rules: ['CR 107.3', 'CR 601.2b'], level: 'info' });
    }
    return n > 0 ? did(n) : NOTHING;
  },
};
