/**
 * std-ry8: the options a player takes as their creatures attack (CR 508.1, part of the declaration of attackers: no stack, no priority). Owner: std-ry8.
 *
 *   - "You may exert ~ as it attacks." (CR 701.43a; rule modification `mayExertAsAttacks`, statics/hooks.ts#attackOptions): the active player chooses, once for all
 *     their attackers with such an ability, which of them to exert. An exerted creature won't untap during its controller's next untap step (the same effect the
 *     exert cost makes, rules/pay-parts.ts#exertPermanent). A creature is exerted once however many such abilities it has; each of them then sees it exerted
 *     (std-ry8 default, cite unverified).
 *   - Enlist (CR 702.154a; rule modification `enlist`): as the creature attacks, its controller may tap up to one untapped creature they control that they didn't
 *     choose to attack with and that either has haste or has been under their control continuously since this turn began (it isn't summoning sick,
 *     rules/timing.ts#isSummoningSick). Each instance of enlist works separately (CR 702.154c, unverified); a creature tapped for one can't be tapped for another.
 *
 * What happens after an option was taken ("When you do, ...", the rule's `then`, CR 603.12) runs right away in a context whose source and controller are the
 * attacking creature's, with the exerted or the enlisted creature bound as `then.as`: a `reflexive` step there puts its triggered ability on the stack the next
 * time a player would receive priority (with the attack triggers, CR 603.3), its targets chosen then (CR 603.3d).
 */
import type { ObjectId, PlayerId } from '../types/ids';
import { charsOfObject } from '../rules/characteristics';
import { exertPermanent } from '../rules/pay-parts';
import { isSummoningSick } from '../rules/timing';
import { attackOptions } from '../statics/hooks';
import type { RuleSource } from '../statics/rule-sources';
import { makeCtx } from '../effects/ctx';
import { runNested } from '../effects/nested';
import type { Game } from './game';

/** Run what a rule's `then` says happens after its option was taken, with `bound` bound as `then.as` (CR 603.12). */
function runThen(g: Game, src: RuleSource, attacker: ObjectId, bound: ObjectId): void {
  if (src.effect.s !== 'rule' || src.effect.then === undefined) return;
  const then = src.effect.then;
  const o = g.s.objects[attacker];
  const b = g.s.objects[bound];
  if (!o || !b) return;
  const cx = makeCtx(g, o, { targets: [], steps: [] });
  cx.controller = src.controller;
  cx.bindings.set(then.as, { objects: [{ id: b.id, zone: b.zone }], players: [], snapshots: {} });
  cx.results.set(then.as, { performed: true, count: 1 });
  runNested(cx, then.do);
}

/** CR 508.1, 701.43a, 702.154a: the exert and enlist options of the declared attackers of `ap`, taken in that order. */
export function takeAttackOptions(g: Game, ap: PlayerId, attackers: readonly ObjectId[]): void {
  const options = attackers.map((id) => ({ id, opts: attackOptions(g.s, id) })).filter((x) => x.opts.length > 0);
  if (options.length === 0) return;
  // CR 701.43a: "You may exert ~ as it attacks"
  const exertable = options.filter((x) => x.opts.some((o) => o.effect.s === 'rule' && o.effect.rule === 'mayExertAsAttacks'));
  if (exertable.length > 0) {
    const chosen = g.choose({
      kind: 'chooseObjects', player: ap, prompt: "Choose any attacking creatures to exert as they attack (an exerted creature won't untap during your next untap step).",
      options: exertable.map((x) => x.id), min: 0, max: exertable.length, rules: ['CR 701.43a', 'CR 508.1'],
    }).ids;
    for (const x of exertable) {
      if (!chosen.includes(x.id) || !exertPermanent(g, ap, x.id, 'as it attacks')) continue;
      for (const o of x.opts) if (o.effect.s === 'rule' && o.effect.rule === 'mayExertAsAttacks') runThen(g, o, x.id, x.id);
    }
  }
  // CR 702.154a: enlist, one instance at a time
  for (const x of options) {
    for (const o of x.opts) {
      if (o.effect.s !== 'rule' || o.effect.rule !== 'enlist') continue;
      const me = g.s.objects[x.id];
      if (!me || me.zone !== 'battlefield') continue;
      const eligible = (g.s.zones.battlefield ?? []).filter((id) => {
        const c = g.s.objects[id];
        if (!c || c.controller !== ap || c.tapped || c.phasedOut || attackers.includes(id)) return false;
        const chars = charsOfObject(g.s, c);
        return chars.types.includes('Creature') && !isSummoningSick(g.s, c, chars);
      });
      if (eligible.length === 0) continue;
      const pick = g.choose({
        kind: 'chooseObjects', player: ap, prompt: `Enlist for ${g.nameOf(x.id)}: you may tap a nonattacking creature you control without summoning sickness (it adds its power to ${g.nameOf(x.id)}'s until end of turn).`,
        options: eligible, min: 0, max: 1, rules: ['CR 702.154a'],
      }).ids;
      const id = pick[0];
      if (id === undefined) continue;
      const c = g.obj(id);
      c.tapped = true;
      g.emit({ type: 'tapped', objectId: id });
      g.emit({ type: 'actionPerformed', verb: 'enlist', actor: ap, objectId: x.id });
      g.log(`${g.player(ap).name} enlists ${g.nameOf(id)} for ${g.nameOf(x.id)}.`, { rules: ['CR 702.154a'], level: 'action' });
      runThen(g, o, x.id, id);
    }
  }
}
