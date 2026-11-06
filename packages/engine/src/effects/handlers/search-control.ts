/**
 * edh-next-119 (CR 723.2, 723.5, 701.23a, 614.1a, 616.1, 609.4b; Opposition Agent and its rulings of 2020-11-10): another player's control of a search, and the cards found exiled.
 *
 *  - "You control your opponents while they're searching their libraries." (`controlSearching`): while a covered player searches their OWN library (also when the same search searches
 *    other zones with it: "you decide what cards they find in all zones"), every decision of that search (which cards they find, the order of a pick, a replacement choice) is made by
 *    the rule's controller. It is a record of core/player-control.ts with `during: 'search'`, created active when the search of that player begins and removed when it ends; the newest
 *    record works (CR 723.1a), so it wins over a turn of control another effect gives. The controller sees what the searching player sees (CR 723.4, core/view.ts). A search the player
 *    can't do (CR 101.2) is no search. The choice to search ("you may search") and the choice of zones are made before the search begins: the player makes them.
 *  - "While an opponent is searching their library, they exile each card they find. You may play those cards for as long as they remain exiled, and you may spend mana as though it were mana
 *    of any color to cast them." (`searchFoundExiled`): the cards found in that search are exiled by the searching player as they are found, instead of being put where the effect says
 *    (the rest of the effect still happens and can't see them in exile, ruling 2020-11-10); the rule's controller may play them for as long as they remain exiled (a land only with a land
 *    play available, the normal timing permissions: the permission of statics/play-permits.ts), with mana as though of any color for a spell. Two such rules apply to the same search: the
 *    searching player (or whoever controls them now) chooses which one gives the permission (CR 616.1).
 *
 * Callers: effects/handlers/cards-library.ts (`search` op, its three forms). Rule lookups: statics/hooks.ts#searchControllerOf, #searchExilersOf.
 */
import type { Game } from '../../core/game';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { ContinuousEffectRec, ObjHandle } from '../../types/state';
import { beginSearchControlRecord, endSearchControl } from '../../core/player-control';
import type { ExecCtx } from '../api';
import { performEffectRecord } from '../perform-direct';
import { propose } from '../propose';
import { searchControllerOf, searchExilersOf, type SearchRuleSource } from '../../statics/hooks';
import { newObjectOf } from './zones-util';

const RULES_CONTROL = ['CR 723.2', 'CR 723.5', 'CR 701.23a'];
const RULES_EXILE = ['CR 701.23a', 'CR 614.1a', 'CR 609.4b'];

/** The search of `searcher`'s own library begins: a covering `controlSearching` rule makes its controller decide for them. Returns the end of the control (call it when the search ends). */
export function beginSearchControl(g: Game, searcher: PlayerId): () => void {
  const by = searchControllerOf(g.s, searcher);
  if (by === null || by.controller === searcher || g.player(by.controller).hasLost === true) return () => {};
  const id = beginSearchControlRecord(g, by.controller, searcher, by.name);
  g.log(`${g.player(by.controller).name} controls ${g.player(searcher).name} while they search their library (${by.name}).`, { rules: RULES_CONTROL, level: 'info' });
  // NOT in a `finally`: a decision asked during the search leaves the record in the suspended state, so the controller answers it and sees the cards (CR 723.4); a re-run starts from the base
  return () => endSearchControl(g, id);
}

/**
 * The cards `searcher` found in a search of their own library (`found`, in the zones searched) are exiled by them when a `searchFoundExiled` rule covers them, and the rule's controller gets the
 * permission to play them. Returns the found cards that are still where they were found (all of them when no rule applies; none when they were exiled: the effect can't see them in exile).
 */
export function exileFoundCards(cx: ExecCtx, searcher: PlayerId, found: readonly ObjHandle[]): ObjHandle[] {
  const g = cx.g;
  if (found.length === 0) return [...found];
  const rules = searchExilersOf(g.s, searcher).filter((r) => g.player(r.controller).hasLost !== true);
  if (rules.length === 0) return [...found];
  const rule = rules.length === 1 ? rules[0]! : pickRule(g, searcher, rules);
  const exiled: ObjHandle[] = [];
  for (const h of found) {
    if (g.s.objects[h.id]?.zone !== h.zone) continue;
    propose(g, { ev: 'zoneChange', object: h, from: h.zone, to: 'exile', destination: {} });
    const now = newObjectOf(g, h.id);
    if (now !== null && now.zone === 'exile') exiled.push(now);
  }
  const names = exiled.map((h) => g.nameOf(h.id)).join(', ');
  g.log(`${g.player(searcher).name} exiles ${exiled.length === 0 ? 'nothing' : names} found in the search (${rule.name}).`, { rules: RULES_EXILE, level: 'action' });
  if (exiled.length > 0) grantPlay(g, rule, exiled);
  return found.filter((h) => g.s.objects[h.id]?.zone === h.zone);
}

/** CR 616.1: two rules would exile the found cards; the searching player (whoever makes their decisions now, CR 723.5) chooses which one applies. */
function pickRule(g: Game, searcher: PlayerId, rules: readonly SearchRuleSource[]): SearchRuleSource {
  const ans = g.choose({
    kind: 'chooseOption', player: searcher, min: 1, max: 1, rules: ['CR 616.1', 'CR 614.1a'],
    prompt: 'The cards found are exiled: choose whose effect applies (that player may play them).',
    options: rules.map((r, i) => ({ id: String(i), label: `${r.name} (${g.player(r.controller).name})` })),
  });
  return rules[Number(ans.ids[0] ?? 0)] ?? rules[0]!;
}

/** "You may play those cards for as long as they remain exiled, and you may spend mana as though it were mana of any color to cast them." (CR 609.4b, 611.2b, 400.7) */
function grantPlay(g: Game, rule: SearchRuleSource, exiled: readonly ObjHandle[]): void {
  const objects: ObjHandle[] = exiled.map((h) => ({ id: h.id as ObjectId, zone: 'exile' }));
  const rec: ContinuousEffectRec = {
    id: g.newEffectId(),
    source: rule.source === null ? null : { id: rule.source, zone: g.s.objects[rule.source]?.zone ?? 'battlefield' },
    sourceName: rule.name,
    controller: rule.controller,
    timestamp: g.newTimestamp(),
    startedTurn: g.s.turn.number,
    duration: { d: 'remainsExiled' },
    effect: { s: 'permit', who: { ref: 'fixed', players: [rule.controller] }, action: 'play', of: { is: { ref: 'fixed', objects } }, anyManaColor: true },
  };
  performEffectRecord(g, rec);
}
