/**
 * "~" after the trigger's own event moved the source (design 3.1, CR 400.7). Owner: WP17 (WP21 review, INTERFACE CHANGE: a new module of the anaphora pass).
 *
 * `{ref:'self'}` is the object the ability came from as it was (effects/refs.ts: the source, read through last known information). When the event that
 * triggered the ability moved that object to another zone, it is a new object there (CR 400.7) and a step that ACTS on "~" ("return ~ to its owner's
 * hand") must act on the new object:
 *  - the source's own zone change ("When ~ dies", "When ~ is put into a graveyard from the battlefield", "When ~ leaves the battlefield"): the ability
 *    finds the new object in the zone it moved to (CR 400.7e), which is the event's subject: the reference becomes `{ref:'event', role:'subject'}`;
 *  - an Aura whose host left the battlefield ("When enchanted creature dies"): the Aura is put into the graveyard by a state-based action (CR 704.5m) and
 *    the ability can find it there (CR 400.7f). No event role names it; r5-fxz: the reference becomes `{ref:'self', moved:true}` (effects/refs.ts finds the
 *    card while it is in that graveyard) when every event of the trigger is the host leaving the battlefield, one at a time; otherwise manual;
 *  - a trigger with several events of which only some move the source, a batch, or a step inside a delayed or reflexive trigger (which has an event of its
 *    own): manual.
 * Property reads ("~'s power", the source of damage) keep `self` and read last known information (CR 608.2h).
 */
import type { EventPattern, ObjectFilter } from '../../types/ability';
import { actedOn } from './mentions';
import type { Draft, Rec } from './types';
import { isRec, sequences, setManual } from './util';

const STEP_LISTS: readonly string[] = ['then', 'else', 'do', 'otherwise', 'onWin', 'onLose'];

const subjectOf = (p: EventPattern): ObjectFilter | null => (p.ev === 'zoneChange' && isRec(p.subject) ? (p.subject as ObjectFilter) : null);
/** A zone change out of where the object was (not onto the battlefield: "When ~ enters" keeps the object it names, CR 603.6a). */
const leaves = (p: EventPattern): boolean => p.ev === 'zoneChange' && p.to !== 'battlefield' && (p.to !== undefined || p.from !== undefined);

/** What becomes of `{ref:'self'}` in the effect: kept, the event's subject, or not nameable (manual). */
export function sourceAfterEvent(d: Draft): 'same' | 'event' | 'aura' | 'lost' {
  const on = d.trigger?.on ?? [];
  const own = on.filter((p) => leaves(p) && subjectOf(p)?.self === true).length;
  if (own > 0) return own === on.length && d.trigger?.batch !== true ? 'event' : 'lost';
  if (d.selfHeads.includes('aura') && on.some((p) => leaves(p) && subjectOf(p)?.attachedToSource === true)) {
    const hostLeaves = (p: EventPattern): boolean => p.ev === 'zoneChange' && leaves(p) && subjectOf(p)?.attachedToSource === true && [p.from ?? []].flat().includes('battlefield');
    return on.every(hostLeaves) && d.trigger?.batch !== true ? 'aura' : 'lost';
  }
  return 'same';
}

function setAt(step: Rec, path: string, value: unknown): void {
  const parts = path.split('/').filter((x) => x !== '');
  let at: unknown = step;
  for (const p of parts.slice(0, -1)) at = Array.isArray(at) ? at[Number(p)] : isRec(at) ? at[p] : undefined;
  const last = parts[parts.length - 1]!;
  if (Array.isArray(at)) at[Number(last)] = value;
  else if (isRec(at)) at[last] = value;
}

/** Rewrite (or refuse) the steps that act on `{ref:'self'}` after the trigger moved the source. Edits the (already cloned) draft in place. */
export function rebaseMovedSelf(d: Draft): void {
  const fate = sourceAfterEvent(d);
  if (fate === 'same') return;
  for (const u of sequences(d).flat()) {
    if (u.manual) continue;
    let lost = false;
    const walk = (list: unknown, inner: boolean): void => {
      if (!Array.isArray(list)) return;
      for (const s of list) {
        if (!isRec(s)) continue;
        for (const [path, v] of actedOn(s)) {
          if (!isRec(v) || v['ref'] !== 'self') continue;
          if (fate === 'event' && !inner) setAt(s, path, { ref: 'event', role: 'subject' });
          else if (fate === 'aura' && !inner) setAt(s, path, { ref: 'self', moved: true });
          else lost = true;
        }
        const own = s['op'] === 'delay' || s['op'] === 'reflexive'; // a delayed or reflexive trigger has an event of its own (CR 603.7, 603.12)
        for (const k of STEP_LISTS) walk(s[k], inner || own);
      }
    };
    walk(u.steps, false);
    if (lost) {
      setManual(u, {
        code: 'unbound-reference',
        reason: '"~" acts on the source after the event moved it: the ability can find the new object (CR 400.7e-f), but no event role names it here',
        unresolved: true,
      });
    }
  }
}
