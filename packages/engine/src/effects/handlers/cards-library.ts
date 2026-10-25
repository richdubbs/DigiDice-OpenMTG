/**
 * scry, surveil, search, shuffle (CR 701.22-701.25); p2-player-rules-2: clash (CR 701.30). Owner: WP13.
 *
 * Hidden information: the cards a player looks at (scry, surveil) or searches through are shown to that player only (`core/zones.ts#showCards`, CR 701.20e,
 * 701.23a); found cards are revealed to everybody only when the effect says so (CR 701.23e). Players who decide together decide in APNAP order and the cards
 * then move at the same time (CR 701.22c, 701.23i). Reordering a library is `core/zones.ts#reorderLibrary` (not a zone change); the keyword action itself is
 * recorded by the performer `effects/perform.ts#performAction` (design 8.6 stage 4).
 */
import type { Game } from '../../core/game';
import { renewedHandle, reorderLibrary, showCards } from '../../core/zones';
import type { EffectStep, ObjectFilter } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { LastKnown, ObjHandle, ZoneKind } from '../../types/state';
import { HIDDEN_ZONES } from '../../types/state';
import { cantDo } from '../../rules/cant';
import { charsOfObject } from '../../rules/characteristics';
import { matchesFilter } from '../../rules/filter';
import type { ExecCtx, StepResult } from '../api';
import { evalCount } from '../eval';
import { performAction, performShuffle } from '../perform';
import { proposeResult } from '../propose';
import { performBringIntoGame } from '../perform-direct';
import { outsideMatches } from './outside';
import { filterCtxOf, readInfo, resolvePlayers } from '../refs';
import { runSteps } from '../run';
import { allPlayers, bindObjects, cardCount, cardsWord, logAction, moveAsAction, namesOf, NOTHING, playerName, playersOf, result } from './cards-util';

type Step<K extends EffectStep['op']> = Extract<EffectStep, { op: K }>;

const library = (g: Game, p: PlayerId): ObjectId[] => g.s.zones.library[p] ?? [];

/** Ask `p` to put these cards in order, first = the one that ends up on top (CR 401.4). No question for fewer than two cards. */
function orderOnTop(g: Game, p: PlayerId, ids: ObjectId[], rule: string): ObjectId[] {
  if (ids.length < 2) return ids;
  const ans = g.choose({
    kind: 'order', player: p, prompt: 'Put these cards on top of your library in any order (the first one ends up on top).',
    items: ids.map((id) => ({ id, label: g.nameOf(id) })), rules: [rule, 'CR 401.4'],
  });
  return ans.ids;
}

/** CR 701.22a: look at the top N cards, put any number on the bottom in any order and the rest on top in any order. Scry 0 is no scry (701.22b). */
export function scryHandler(cx: ExecCtx, st: Step<'scry'>): StepResult {
  const n = cardCount(cx, st.count);
  if (n === undefined || n === 0) return NOTHING;
  const g = cx.g;
  // p2-replace-events-3 (CR 701.22a, 614.1a): each player's scry is proposed first, so "If you would scry a number of cards, draw that many cards instead" replaces
  // it (effects/proposal-kinds/scry.ts); replaced, that player does not scry (the replacement's instructions did instead)
  const plans = playersOf(cx, st.who).filter((p) => proposeResult(g, { ev: 'scry', player: p, count: n }) !== null).map((p) => {
    const looked = library(g, p).slice(0, n);
    showCards(g, looked, [p]); // CR 701.20e: only the scrying player looks
    if (looked.length === 0) return { p, looked, top: [], bottom: [] };
    const bottom = g.choose({
      kind: 'chooseObjects', player: p, options: looked, min: 0, max: looked.length, ordered: true,
      prompt: `Scry ${n}: choose the cards to put on the bottom of your library, in order (the first one ends up highest).`, rules: ['CR 701.22a'],
    }).ids;
    const top = orderOnTop(g, p, looked.filter((id) => !bottom.includes(id)), 'CR 701.22a');
    return { p, looked, top, bottom };
  });
  let count = 0;
  const kept: LastKnown[] = []; // r5-fxz: the cards left on top, as they were there (StepResult.kept)
  for (const { p, looked, top, bottom } of plans) {
    const named = { top: namesOf(g, top), bottom: namesOf(g, bottom) }; // before the reorder: a reordered card becomes a new object (CR 701.20d)
    for (const id of top) { const i = readInfo(cx, { id, zone: 'library' }); if (i) kept.push(i); }
    reorderLibrary(g, p, top, bottom); // CR 701.22c: the cards move after every player has decided
    count += looked.length;
    performAction(g, { verb: 'scry', actor: p }); // CR 701.22d: "whenever you scry" triggers after the whole process
    logAction(cx, `${playerName(g, p)} scries ${n}, putting ${cardsWord(top.length)} on top and ${cardsWord(bottom.length)} on the bottom.`, ['CR 701.22a'], {
      players: [p], text: `${playerName(g, p)} scries ${n}: on top ${named.top || 'nothing'}; on the bottom ${named.bottom || 'nothing'}.`,
    });
  }
  // CR 701.22d, 603.12: the player scried even if no card could be looked at (T3 review: a reflexive "when you do" reads this, as triggers read the event)
  return { performed: plans.length > 0, count, kept };
}

/** CR 701.25a: look at the top N cards, put any number into the graveyard and the rest on top in any order. Surveil 0 is no surveil (701.25c). */
export function surveilHandler(cx: ExecCtx, st: Step<'surveil'>): StepResult {
  const n = cardCount(cx, st.count);
  if (n === undefined || n === 0) return NOTHING;
  const g = cx.g;
  const plans = playersOf(cx, st.who).map((p) => {
    const looked = library(g, p).slice(0, n);
    showCards(g, looked, [p]);
    if (looked.length === 0) return { p, looked, top: [], toGraveyard: [] };
    const toGraveyard = g.choose({
      kind: 'chooseObjects', player: p, options: looked, min: 0, max: looked.length,
      prompt: `Surveil ${n}: choose the cards to put into your graveyard.`, rules: ['CR 701.25a'],
    }).ids;
    const top = orderOnTop(g, p, looked.filter((id) => !toGraveyard.includes(id)), 'CR 701.25a');
    return { p, looked, top, toGraveyard };
  });
  const binned: ObjHandle[] = [];
  const kept: LastKnown[] = []; // r5-fxz (CR 701.25a): the cards left on top, as they were there (StepResult.kept)
  for (const plan of plans) {
    for (const id of plan.top) { const i = readInfo(cx, { id, zone: 'library' }); if (i) kept.push(i); }
    const moved = plan.toGraveyard.flatMap((id) => moveAsAction(cx, { id, zone: 'library' }, 'graveyard', 'surveil') ?? []);
    const onTop = namesOf(g, plan.top);
    reorderLibrary(g, plan.p, plan.top, []);
    binned.push(...moved);
    performAction(g, { verb: 'surveil', actor: plan.p }); // CR 701.25d
    logAction(cx, `${playerName(g, plan.p)} surveils ${n}${moved.length > 0 ? `, putting ${namesOf(g, moved.map((h) => h.id))} into their graveyard` : ''}.`, ['CR 701.25a'], {
      players: [plan.p], text: `${playerName(g, plan.p)} surveils ${n}: into the graveyard ${namesOf(g, moved.map((h) => h.id)) || 'nothing'}; on top ${onTop || 'nothing'}.`,
    });
  }
  bindObjects(cx, st.as, binned);
  // CR 701.25d, 603.12: the player surveiled even if no card could be looked at (T3 review: Dream Eater's "When you do" with an empty library)
  return { performed: plans.length > 0, count: binned.length, kept };
}

/**
 * p2-player-rules-2, CR 701.30: clash. `who` and the one player of `with` (an opponent chosen by `who`, or the defending player) each reveal the top card of
 * their library (CR 701.30a-b); `who` wins when they revealed a card with a greater mana value than every other card revealed (CR 701.30c; a player with an
 * empty library reveals nothing, so can't win, and their missing card is no card to beat). Then each clashing player, in APNAP order, chooses whether to put
 * their card on the bottom of their library (CR 701.30a-b); the cards move after both chose. The branch of the result runs last (`onWin`, else `onLose`).
 */
export function clashHandler(cx: ExecCtx, step: Step<'clash'>): StepResult {
  const g = cx.g;
  const me = resolvePlayers(cx, step.who)[0];
  const them = resolvePlayers(cx, step.with).filter((p) => p !== me && !g.player(p).hasLost);
  if (me === undefined || g.player(me).hasLost || them.length !== 1) return NOTHING; // CR 701.30b: exactly one opponent to clash with; none: no clash (CR 608.2b)
  const clashers = g.apnap().filter((p) => p === me || p === them[0]);
  const top = new Map<PlayerId, string | undefined>(clashers.map((p) => [p, g.s.zones.library[p]?.[0]]));
  const mv = (p: PlayerId): number | undefined => { const id = top.get(p); return id === undefined ? undefined : charsOfObject(g.s, g.s.objects[id]!).manaValue; };
  const revealed = clashers.flatMap((p) => { const id = top.get(p); return id === undefined ? [] : [id]; });
  showCards(g, revealed, g.s.players.map((p) => p.id));
  const mine = mv(me);
  const won = mine !== undefined && clashers.every((p) => p === me || (mv(p) ?? -Infinity) < mine);
  g.log(`${g.player(me).name} clashes with ${g.player(them[0]!).name}: ${clashers.map((p) => `${g.player(p).name} reveals ${top.get(p) === undefined ? 'nothing' : `${g.nameOf(top.get(p)!)} (mana value ${mv(p)})`}`).join(', ')}. ${g.player(me).name} ${won ? 'wins' : "doesn't win"} the clash.`, { rules: ['CR 701.30'], level: 'action' });
  // p2-player-rules-3 (CR 701.30c): each clashing player's own result, read before a card moves (a card put on the bottom is a new object, CR 701.20d)
  const results = new Map<PlayerId, boolean>(clashers.map((p) => { const v = mv(p); return [p, v !== undefined && clashers.every((q) => q === p || (mv(q) ?? -Infinity) < v)]; }));
  const bottom: PlayerId[] = [];
  for (const p of clashers) {
    const id = top.get(p);
    if (id === undefined) continue;
    const yes = g.choose({ kind: 'yesNo', player: p, prompt: `Clash: put ${g.nameOf(id)} on the bottom of your library?`, yesLabel: 'Bottom', noLabel: 'Keep on top', rules: ['CR 701.30a'] }).yes;
    if (yes) bottom.push(p);
  }
  for (const p of bottom) {
    reorderLibrary(g, p, [], [top.get(p)!]);
    g.log(`${g.player(p).name} puts the revealed card on the bottom of their library.`, { rules: ['CR 701.30a'], level: 'info' });
  }
  // p2-player-rules-3 (CR 701.30b-c): both players clashed; each one's clash ends here with its own result ("whenever you clash and win", "This ability triggers
  // after the clash ends"): a player won with a card of greater mana value than every other card revealed
  for (const p of clashers) performAction(g, { verb: 'clash', actor: p, won: results.get(p) === true });
  const branch = won ? step.onWin : step.onLose;
  if (branch && branch.length > 0) runSteps(cx, branch);
  return { performed: true, count: won ? 1 : 0 };
}

/** The ids of a zone of one player (the shared zones list everything there that player owns). */
function zoneIds(g: Game, zone: ZoneKind, owner: PlayerId): ObjectId[] {
  const z = g.s.zones;
  if (zone === 'library' || zone === 'hand' || zone === 'graveyard') return z[zone][owner] ?? [];
  return z[zone].filter((id) => g.s.objects[id]?.owner === owner);
}

/** "for a card with a stated quality" (CR 701.23b) vs "for a card" (701.23d): any field other than where to look is a quality. */
const hasStatedQuality = (f: ObjectFilter): boolean => Object.entries(f).some(([k, v]) => v !== undefined && k !== 'zone' && k !== 'owner');

/**
 * The fewest cards the searcher must find. Agrees with the renderer (render/steps-cards.ts), which prints an absent `min` as "a card" for max 1 and as
 * "up to N" / "up to X" / "any number of" otherwise (test/m5/cards/render-agreement.test.ts pins both together):
 *   - a hidden zone searched for a stated quality: 0, whatever `min` says (CR 701.23b is a rule, not wording; Splinter, Extirpate);
 *   - else an explicit `min` ("two cards" is min 2, max 2: must find two, CR 701.23d);
 *   - else max 1 ("a card"; "a creature card" in a public zone): 1 (CR 701.23d);
 *   - else 0 ("up to two cards", "up to X cards", "any number of cards").
 */
function fewest(cx: ExecCtx, st: Step<'search'>, hidden: boolean): number {
  if (hidden && hasStatedQuality(st.filter)) return 0;
  if (st.min !== undefined) return evalCount(st.min, { cx });
  return st.max === 1 ? 1 : 0;
}

/** The value forms of the search op this module runs (model/cap-walk.ts emits them; model/capabilities.ts registers them). */
export const OP_FORMS: readonly string[] = ['op:search.differentNames',
  // CLOUD std-dft (CR 701.23a, 701.24a): "search your library and/or graveyard", "If you search your library this way, shuffle"
  'op:search.alsoZones', 'op:shuffle.ifSearched',
  'op:search.and', // CLOUD C9: 'op:search.and'
  'op:search.allZones', // r4-refs (CR 701.23a): "search target opponent's graveyard, hand, and library", every zone listed
  'op:search.alsoOutside']; // std-rx30 (CR 400.11b): "search your library and/or outside the game"

/**
 * FAST5 T42 (CR 201.2, 701.23d; Reach the Horizon): "up to two basic land cards and/or Town cards with different names". The searcher takes the cards one at a time,
 * each of a name no card taken has (objects share a name when they have a name in common): after a card is taken the cards that share a name with it are no longer
 * offered. At least `min` cards are taken while any can be (the rest are optional), at most `max`.
 */
function pickDifferentNames(cx: ExecCtx, p: PlayerId, owner: PlayerId, zone: string, candidates: ObjectId[], min: number, max: number): ObjectId[] {
  const g = cx.g;
  const namesOfCard = (id: ObjectId): string[] => charsOfObject(g.s, g.s.objects[id]!).names;
  const picked: ObjectId[] = [];
  let pool = candidates;
  while (picked.length < max && pool.length > 0) {
    const need = picked.length < min ? 1 : 0;
    const one = g.choose({
      kind: 'chooseObjects', player: p, options: pool, min: need, max: 1,
      prompt: `Search ${owner === p ? 'your' : `${playerName(g, owner)}'s`} ${zone} for a card with a name different from the others (${picked.length + 1} of up to ${max}).`, rules: ['CR 701.23a', 'CR 701.23d', 'CR 201.2'],
    }).ids;
    if (one.length === 0) break;
    picked.push(one[0]!);
    const taken = namesOfCard(one[0]!);
    pool = pool.filter((id) => id !== one[0] && !namesOfCard(id).some((n) => taken.includes(n)));
  }
  return picked;
}

/**
 * CLOUD C9 (CR 701.23a-b, 701.23d): "search your library for a basic land card and a Shrine card": one card of each description, the descriptions in order, a card
 * found for one not offered again for the next. A description with a stated quality in a hidden zone may be not found (CR 701.23b); "a card" must be found if
 * there is one (CR 701.23d).
 */
function pickOneOfEach(cx: ExecCtx, p: PlayerId, owner: PlayerId, zone: ZoneKind, ids: readonly ObjectId[], filters: readonly ObjectFilter[], hidden: boolean): ObjectId[] {
  const g = cx.g;
  const ctx = filterCtxOf(cx);
  const picked: ObjectId[] = [];
  filters.forEach((f, k) => {
    const candidates = ids.filter((id) => !picked.includes(id) && matchesFilter(g.s, g.s.objects[id]!, { ...f, zone }, ctx));
    if (candidates.length === 0) return;
    const need = hidden && hasStatedQuality(f) ? 0 : 1;
    const one = g.choose({
      kind: 'chooseObjects', player: p, options: candidates, min: need, max: 1,
      prompt: `Search ${owner === p ? 'your' : `${playerName(g, owner)}'s`} ${zone}: card ${k + 1} of ${filters.length} (one of each description).`, rules: ['CR 701.23a', 'CR 701.23b', 'CR 701.23d'],
    }).ids;
    if (one.length > 0) picked.push(one[0]!);
  });
  return picked;
}

/**
 * CR 701.23: search a zone for cards matching the description. The searcher looks at every card of the zone (701.23a), shown to them only. The fewest cards
 * to find is `fewest` above. The found cards are bound for the next steps ("put it into your hand") and revealed only when the effect says so (701.23e). One
 * search event per zone actually searched, naming its owner and zone; an owner that is an illegal target means no zone is searched (CR 608.2b).
 */
export function searchHandler(cx: ExecCtx, st: Step<'search'>): StepResult {
  if (st.alsoOutside === true) return searchWithOutside(cx, st); // std-rx30
  if (st.alsoZones !== undefined && st.alsoZones.length > 0) return searchZones(cx, st);
  const g = cx.g;
  const found: ObjHandle[] = [];
  const hidden = HIDDEN_ZONES.includes(st.zone); // CR 400.2: a hand is a hidden zone, also when its owner searches it
  const searched: { owner: PlayerId; zone: ZoneKind }[] = []; // r5-moved: every zone this step searched (CR 701.23a), as searchZones reports it
  for (const p of playersOf(cx, st.who)) {
    const cant = st.zone === 'library' ? cantDo(g.s, 'search', p) : null; // WP31: "can't search libraries" (CR 701.23, 101.2): no search; a "then shuffle" step still shuffles
    if (cant) {
      g.log(`${playerName(g, p)} can't search libraries. ${cant.message}`, { rules: ['CR 701.23a', 'CR 101.2'], level: 'info' });
      continue;
    }
    const owners = st.owner ? playersOf(cx, st.owner) : [p];
    for (const owner of owners) {
      const ids = zoneIds(g, st.zone, owner);
      if (hidden) showCards(g, ids, [p]); // CR 701.23a
      const ctx = filterCtxOf(cx);
      const candidates = ids.filter((id) => matchesFilter(g.s, g.s.objects[id]!, { ...st.filter, zone: st.zone }, ctx));
      const max = Math.min(evalCount(st.max, { cx }), candidates.length);
      const min = Math.min(fewest(cx, st, hidden), max);
      const picked = st.and !== undefined ? pickOneOfEach(cx, p, owner, st.zone, ids, [st.filter, ...st.and], hidden) // CLOUD C9
        : max === 0 ? [] : st.differentNames === true ? pickDifferentNames(cx, p, owner, st.zone, candidates, min, max) : min === candidates.length ? candidates : g.choose({
        kind: 'chooseObjects', player: p, options: candidates, min, max,
        prompt: `Search ${owner === p ? 'your' : `${playerName(g, owner)}'s`} ${st.zone} (${min === max ? max : `${min} to ${max}`}).`, rules: ['CR 701.23a', 'CR 701.23b', 'CR 701.23d'],
      }).ids;
      found.push(...picked.map((id): ObjHandle => ({ id, zone: st.zone })));
      if (st.reveal === true) showCards(g, picked, allPlayers(g)); // CR 701.20a
      performAction(g, { verb: 'search', actor: p, owner, zone: st.zone }); // CR 701.23a: this zone was searched
      searched.push({ owner, zone: st.zone });
      const where = `${owner === p ? 'their' : `${playerName(g, owner)}'s`} ${st.zone}`;
      const what = picked.length === 0 ? 'nothing' : st.reveal === true || !hidden ? namesOf(g, picked) : cardsWord(picked.length);
      logAction(cx, `${playerName(g, p)} searches ${where} and finds ${what}${st.reveal === true && picked.length > 0 ? ', revealing it' : ''}.`, ['CR 701.23a', ...(st.reveal ? ['CR 701.20a'] : ['CR 701.23e'])], {
        players: [p], text: `${playerName(g, p)} searches ${where} and finds ${namesOf(g, picked) || 'nothing'}.`,
      });
    }
  }
  bindObjects(cx, st.as, found);
  // r5-moved (CR 701.23a, 701.23b, 603.12): the search was performed when a zone was searched, even if nothing was found (a hidden zone searched for a stated quality
  // may yield nothing): "When you search your library this way, ..." (Prishe's Wanderings) and "If you search your library this way, ..." read this; `count` stays what
  // was found. A player who can't search libraries (CR 101.2) searched nothing. Merge wave 8: the audit's D2 rule (a search is carried out when a zone is searched,
  // even if nothing is found: "If you search your library this way" after "you may search", control.ts#mayHandler) is this same rule; one is kept
  return { performed: searched.length > 0, count: found.length, searched };
}

/**
 * std-rx30 (CR 400.11b, 701.23a-b, 201.2, 712.8a): "Search your library and/or outside the game for exactly four legendary creature cards you own with different names, then
 * reveal those cards." (Turtles Forever). The searcher looks at their library (shown to them only) and the cards they own outside the game (their sideboard, matched by
 * front face, effects/handlers/outside.ts#outsideMatches) and takes up to `max` of them together, no two with the same name. A search of the library for a stated quality
 * may find fewer (CR 701.23b), so "exactly" is the most they take. Each card taken from outside the game is brought into the game on top of its owner's library; the
 * cards taken are bound by `as` where they are (the library). Only the searcher's own library and cards (`owner` absent).
 */
function searchWithOutside(cx: ExecCtx, st: Step<'search'>): StepResult {
  const g = cx.g;
  const found: ObjHandle[] = [];
  const searched: { owner: PlayerId; zone: ZoneKind }[] = [];
  if (st.zone !== 'library' || st.owner !== undefined || (st.alsoZones?.length ?? 0) > 0) { bindObjects(cx, st.as, []); return NOTHING; }
  for (const p of playersOf(cx, st.who)) {
    const cant = cantDo(g.s, 'search', p); // WP31 (CR 101.2): "can't search libraries" leaves the cards outside the game
    const ids = cant ? [] : zoneIds(g, 'library', p);
    if (!cant) showCards(g, ids, [p]); // CR 701.23a
    const ctx = filterCtxOf(cx);
    const inLibrary = ids.filter((id) => matchesFilter(g.s, g.s.objects[id]!, { ...st.filter, zone: 'library' }, ctx));
    const outside = [...new Set((g.s.outside?.[p] ?? []).filter((d) => outsideMatches(g, d, st.filter)))];
    const nameOf = (opt: string): string => (opt.startsWith('obj:') ? g.nameOf(opt.slice(4)) : g.s.defs[opt.slice(5)]!.name);
    const options = [...inLibrary.map((id) => `obj:${id}`), ...outside.map((d) => `card:${d}`)];
    const max = Math.min(evalCount(st.max, { cx }), new Set(options.map(nameOf)).size);
    let picked: string[] = [];
    for (let guard = 0; guard < 8 && max > 0; guard++) {
      const ans = g.choose({
        kind: 'chooseOption', player: p, min: 0, max, rules: ['CR 701.23a', 'CR 701.23b', 'CR 400.11b', 'CR 201.2'],
        prompt: `Search your library and/or outside the game for up to ${max} cards with different names.`,
        options: options.map((o) => ({ id: o, label: `${nameOf(o)}${o.startsWith('card:') ? ' (outside the game)' : ''}` })),
      }).ids.filter((o) => options.includes(o));
      const uniq = [...new Set(ans)];
      if (uniq.length <= max && new Set(uniq.map(nameOf)).size === uniq.length) { picked = uniq; break; }
    }
    for (const o of picked) {
      if (o.startsWith('obj:')) { found.push({ id: o.slice(4), zone: 'library' }); continue; }
      const id = performBringIntoGame(g, p, o.slice(5), 'library');
      if (id !== null) found.push({ id, zone: 'library' });
    }
    if (st.reveal === true) showCards(g, found.map((h) => h.id), allPlayers(g)); // CR 701.20a
    if (!cant) {
      performAction(g, { verb: 'search', actor: p, owner: p, zone: 'library' }); // CR 701.23a
      searched.push({ owner: p, zone: 'library' });
    }
    logAction(cx, `${playerName(g, p)} searches their library and outside the game and finds ${found.length === 0 ? 'nothing' : namesOf(g, found.map((h) => h.id))}${st.reveal === true && found.length > 0 ? ', revealing them' : ''}.`, ['CR 701.23a', 'CR 400.11b', 'CR 701.20a']);
  }
  bindObjects(cx, st.as, found);
  return { performed: searched.length > 0 || found.length > 0, count: found.length, searched };
}

/**
 * CLOUD std-dft (CR 701.23a, 701.23b, 701.23d, 101.2): "search your library and/or graveyard for a card", "search your graveyard, hand, and/or library": the searcher
 * chooses which of the listed zones of the player to search (one or more; a library they can't search is not offered), looks at the cards of every zone chosen
 * (the hidden ones shown to them only) and finds the cards among all of them. A hidden zone searched for a stated quality lets them find none (CR 701.23b);
 * otherwise `fewest` applies. One search event per zone searched; the result lists the zones (`searched`, read by "If you search your library this way, shuffle").
 * r4-refs: with `allZones` ("search target opponent's graveyard, hand, and library") every listed zone is searched, no choice.
 */
function searchZones(cx: ExecCtx, st: Step<'search'>): StepResult {
  const g = cx.g;
  const found: ObjHandle[] = [];
  const searched: { owner: PlayerId; zone: ZoneKind }[] = [];
  const listed = [st.zone, ...(st.alsoZones ?? [])] as ZoneKind[];
  for (const p of playersOf(cx, st.who)) {
    const owners = st.owner ? playersOf(cx, st.owner) : [p];
    for (const owner of owners) {
      const cant = cantDo(g.s, 'search', p); // WP31 (CR 101.2): "can't search libraries" removes the library only
      if (cant && listed.includes('library')) g.log(`${playerName(g, p)} can't search libraries. ${cant.message}`, { rules: ['CR 701.23a', 'CR 101.2'], level: 'info' });
      const offered = listed.filter((z) => z !== 'library' || !cant);
      if (offered.length === 0) continue;
      const whose = owner === p ? 'your' : `${playerName(g, owner)}'s`;
      // r4-refs (CR 701.23a): "graveyard, hand, and library" (`allZones`) searches every zone listed; "and/or" lets the searcher choose
      const zones = offered.length === 1 || st.allZones === true ? offered : (g.choose({
        kind: 'chooseOption', player: p, min: 1, max: offered.length, rules: ['CR 701.23a'],
        prompt: `Search which of ${whose} ${offered.join(', ')}? (one or more)`,
        options: offered.map((z) => ({ id: z, label: `${whose} ${z}` })),
      }).ids as ZoneKind[]).filter((z) => offered.includes(z));
      if (zones.length === 0) continue;
      const hidden = zones.some((z) => HIDDEN_ZONES.includes(z));
      const ctx = filterCtxOf(cx);
      const candidates: ObjHandle[] = [];
      for (const zone of zones) {
        const ids = zoneIds(g, zone, owner);
        if (HIDDEN_ZONES.includes(zone)) showCards(g, ids, [p]); // CR 701.23a
        for (const id of ids) if (matchesFilter(g.s, g.s.objects[id]!, { ...st.filter, zone }, ctx)) candidates.push({ id, zone });
      }
      const max = Math.min(evalCount(st.max, { cx }), candidates.length);
      const min = Math.min(fewest(cx, st, hidden), max);
      // r3-refs (CR 201.2, 701.23a): "a card named A and/or a card named B" in several zones: the cards taken have different names, as in one zone (pickDifferentNames)
      const pickedIds = max === 0 ? [] : st.differentNames === true ? pickDifferentNames(cx, p, owner, zones.join(' and '), candidates.map((h) => h.id), min, max)
        : min === candidates.length ? candidates.map((h) => h.id) : g.choose({
        kind: 'chooseObjects', player: p, options: candidates.map((h) => h.id), min, max,
        prompt: `Search ${whose} ${zones.join(' and ')} (${min === max ? max : `${min} to ${max}`}).`, rules: ['CR 701.23a', 'CR 701.23b', 'CR 701.23d'],
      }).ids;
      const picked = candidates.filter((h) => pickedIds.includes(h.id));
      found.push(...picked);
      if (st.reveal === true) showCards(g, picked.map((h) => h.id), allPlayers(g)); // CR 701.20a
      for (const zone of zones) {
        performAction(g, { verb: 'search', actor: p, owner, zone }); // CR 701.23a: this zone was searched
        searched.push({ owner, zone });
      }
      const where = `${owner === p ? 'their' : `${playerName(g, owner)}'s`} ${zones.join(' and ')}`;
      const visible = st.reveal === true || picked.every((h) => !HIDDEN_ZONES.includes(h.zone));
      const what = picked.length === 0 ? 'nothing' : visible ? namesOf(g, picked.map((h) => h.id)) : cardsWord(picked.length);
      logAction(cx, `${playerName(g, p)} searches ${where} and finds ${what}${st.reveal === true && picked.length > 0 ? ', revealing it' : ''}.`, ['CR 701.23a', ...(st.reveal ? ['CR 701.20a'] : ['CR 701.23e'])], {
        players: [p], text: `${playerName(g, p)} searches ${where} and finds ${namesOf(g, picked.map((h) => h.id)) || 'nothing'}.`,
      });
    }
  }
  bindObjects(cx, st.as, found);
  return { performed: searched.length > 0, count: found.length, searched }; // r5-moved (CR 701.23a): performed when a zone was searched, as searchHandler
}

/**
 * H1 INTERFACE CHANGE: a shuffle gives every card of the library a new object id (core/zones.ts#shuffleLibrary, so no player can follow a card through
 * it, CR 400.2). The cards this effect already holds (found by a search, looked at) stay held: "search, shuffle, then put that card on top" still finds
 * the card (CR 701.24b), through the run's record of renewed library cards (`core/zones.ts#renewedHandle`).
 */
function followShuffle(cx: ExecCtx, before: readonly ObjectId[]): void {
  const g = cx.g;
  const was = new Set(before);
  const follow = (h: ObjHandle): ObjHandle => (h.zone === 'library' && was.has(h.id) ? renewedHandle(g, h) : h);
  for (const b of cx.bindings.values()) {
    b.objects = b.objects.map((h) => {
      const now = follow(h);
      if (now !== h && b.snapshots[h.id]) b.snapshots[now.id] = b.snapshots[h.id]!;
      return now;
    });
  }
  if (cx.iterating !== undefined && typeof cx.iterating !== 'string') cx.iterating = follow(cx.iterating);
}

/** CR 701.24a: randomize the library (the state's random number generator). A library of 0 or 1 cards is still shuffled (701.24e). */
export function shuffleHandler(cx: ExecCtx, st: Step<'shuffle'>): StepResult {
  // CLOUD std-dft (CR 701.23a, 701.24a): "If you search your library this way, shuffle": only a library a search of this resolution searched
  const searchedLibrary = (p: PlayerId): boolean => [...cx.results.values()].some((r) => r.searched?.some((x) => x.zone === 'library' && x.owner === p) === true);
  const players = playersOf(cx, st.who).filter((p) => st.ifSearched !== true || searchedLibrary(p));
  for (const p of players) {
    const before = [...library(cx.g, p)];
    performShuffle(cx.g, p);
    followShuffle(cx, before);
    logAction(cx, `${playerName(cx.g, p)} shuffles their library.`, ['CR 701.24a']);
  }
  return result(players.length);
}
