/**
 * edh-next-131: `discardOrSacrifice` (CR 101.4, 608.2d, 701.9a, 701.21a; Eumidian Wastewaker, rulings 2025-07-25): "you and defending player each discard a card or sacrifice a permanent.".
 *
 * Each player of `players`, in the order given (the controller first, then the defending player: CR 101.4's APNAP order for this pair), chooses one of the two instructions and does it. A
 * player who can't discard a card (an empty hand) must sacrifice, and one who controls no permanent of `filter` they can sacrifice must discard (ruling 2025-07-25: "If one of those players
 * can't discard a card ..., that player must sacrifice a permanent"); a player who can do neither does nothing. The discard and the sacrifice are the ordinary `discard` and
 * `sacrificeChoice` instructions for that one player (their replacement effects and triggers apply). `as` names every card a discard or a sacrifice of this step put into a graveyard
 * ("You draw a card for each land card put into a graveyard this way.": a token sacrificed is no card there, CR 111.7).
 */
import type { EffectStep } from '../../types/ability';
import type { ObjHandle } from '../../types/state';
import { costUseDenial } from '../../rules/cant';
import { controllerOf } from '../../rules/characteristics';
import { findObjects } from '../../rules/filter';
import type { StepHandler } from '../api';
import { runNested } from '../nested';
import { filterCtxOf, resolvePlayers } from '../refs';
import { bindAs, did, NOTHING } from './zones-util';

type Step = Extract<EffectStep, { op: 'discardOrSacrifice' }>;

const discardOrSacrifice: StepHandler<Step> = (cx, st) => {
  const g = cx.g;
  const gathered: ObjHandle[] = [];
  let done = 0;
  const seen = new Set<string>();
  st.players.forEach((ref, k) => {
    for (const p of resolvePlayers(cx, ref)) {
      if (seen.has(p) || g.player(p).hasLost) continue; // a player named twice acts once; one who left the game is no player of it (CR 800.4a)
      seen.add(p);
      const canDiscard = (g.s.zones.hand[p] ?? []).length > 0;
      const canSacrifice = findObjects(g.s, { ...st.filter, zone: 'battlefield' }, filterCtxOf(cx)).some((o) => controllerOf(g.s, o) === p && !o.phasedOut && costUseDenial(g.s, p, o.id, 'sacrifice', undefined, false, cx.source.id) === null);
      if (!canDiscard && !canSacrifice) continue;
      const pick = canDiscard && canSacrifice
        ? g.choose({
          kind: 'chooseOption', player: p, prompt: 'Discard a card or sacrifice a permanent?', min: 1, max: 1, rules: ['CR 608.2d', 'CR 101.4'],
          options: [{ id: 'discard', label: 'Discard a card' }, { id: 'sacrifice', label: 'Sacrifice a permanent' }],
        }).ids[0]
        : canDiscard ? 'discard' : 'sacrifice';
      const name = `${st.as ?? 'discardOrSacrifice'}#${k}:${p}`;
      const who = { ref: 'fixed' as const, players: [p] };
      runNested(cx, [pick === 'discard'
        ? { op: 'discard', who, count: 1, as: name }
        : { op: 'sacrificeChoice', who, filter: st.filter, count: 1, as: name }]);
      const b = cx.bindings.get(name);
      cx.bindings.delete(name);
      if (b === undefined) continue;
      done += b.objects.length;
      for (const h of b.objects) if (h.zone === 'graveyard' && g.s.objects[h.id]?.zone === 'graveyard') gathered.push({ id: h.id, zone: 'graveyard' });
    }
  });
  bindAs(cx, st.as, gathered);
  return done === 0 ? NOTHING : did(done);
};

export const EDH_N131_HANDLERS = { discardOrSacrifice };
