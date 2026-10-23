/**
 * draw, discard, mill (CR 121, 701.9, 701.17). Owner: WP13. Each card goes through `propose` on its own (CR 121.2: cards are drawn one at a time; a discard and
 * a mill are zone changes a replacement effect may change, CR 614.1).
 */
import type { EffectStep, Quantity } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { LastKnown, ObjHandle } from '../../types/state';
import { cantDo } from '../../rules/cant';
import { findObjects } from '../../rules/filter';
import { randomIndex } from '../../rules/random';
import { showCards } from '../../core/zones';
import { cardLine, seersOf } from '../../core/view';
import type { ExecCtx, StepResult } from '../api';
import { propose, proposeResult } from '../propose';
import { filterCtxOf } from '../refs';
import { bindObjects, cardCount, cardsWord, logAction, moveAsAction, namesOf, NOTHING, playerName, playersOf, readFor, readsEachPlayer, result } from './cards-util';

type Step<K extends EffectStep['op']> = Extract<EffectStep, { op: K }>;

/** CR 121.1-121.2: each player draws that many cards, one at a time, in APNAP order. A draw a replacement effect replaced is not a draw (CR 614.11). */
export function drawHandler(cx: ExecCtx, st: Step<'draw'>): StepResult {
  // p2-zone-moves-1 (CR 121.2, 608.2e): "Each player discards their hand, then draws that many cards": a count that reads the drawing player (`{ref:'iterating'}`) is
  // read for each player of the group, as the discard handler reads its own (op:draw.perPlayerCount)
  const perPlayer = readsEachPlayer(st.who, st.count);
  const n = perPlayer ? 0 : cardCount(cx, st.count);
  if (n === undefined) return NOTHING;
  const g = cx.g;
  const all: ObjHandle[] = [];
  for (const p of playersOf(cx, st.who)) {
    const drawn: ObjectId[] = [];
    const n = perPlayer ? readFor(cx, p, () => cardCount(cx, st.count)) ?? 0 : cardCount(cx, st.count) ?? 0;
    // Cloud r4-repl (CR 121.2, 614.1a): the draw of n cards is proposed as one event first, so "you draw that many cards plus one instead" changes its number
    // (effects/proposal-kinds/draw-many.ts); a draw replaced or reduced to nothing draws no card. Each card is then drawn (and proposed) on its own, as before
    const final = n > 0 ? proposeResult(g, { ev: 'drawMany', player: p, count: n })?.event : undefined;
    const k = final?.ev === 'drawMany' ? final.count : 0;
    for (let i = 0; i < k; i++) {
      const mark = g.events.length;
      if (!propose(g, { ev: 'draw', player: p })) continue;
      for (const e of g.events.slice(mark)) if (e.type === 'drew' && e.player === p) drawn.push(e.objectId);
    }
    if (drawn.length === 0) continue;
    all.push(...drawn.map((id): ObjHandle => ({ id, zone: g.s.objects[id]?.zone ?? 'hand' }))); // CMDF: a drawn commander may be in the command zone (CR 903.9b)
    logAction(cx, `${playerName(g, p)} draws ${cardsWord(drawn.length)}.`, ['CR 121.1', 'CR 121.2'], { players: [p], text: `${playerName(g, p)} draws ${namesOf(g, drawn)}.` });
  }
  bindObjects(cx, st.as, all);
  return result(all.length);
}

/** The player who picks the cards for "discards a card of your choice" (CR 701.9b): the controller, or, when the controller discards, an opponent. */
function discardChooser(cx: ExecCtx, discarder: PlayerId): PlayerId {
  if (discarder !== cx.controller) return cx.controller;
  const opponents = cx.g.opponents(discarder).map((p) => p.id);
  if (opponents.length <= 1) return opponents[0] ?? discarder;
  const ans = cx.g.choose({
    kind: 'chooseOption', player: cx.controller, prompt: 'Choose the opponent who chooses the discarded cards.', min: 1, max: 1,
    options: opponents.map((id) => ({ id, label: playerName(cx.g, id) })), rules: ['CR 701.9b'],
  });
  return ans.ids[0] ?? opponents[0]!;
}

/** Pick `k` of `ids` at random with the game's random number generator (design 8.8 rule 2). */
function pickRandom(cx: ExecCtx, ids: readonly ObjectId[], k: number): ObjectId[] {
  const pool = [...ids];
  const out: ObjectId[] = [];
  while (out.length < k && pool.length > 0) out.push(pool.splice(randomIndex(cx.g, pool.length), 1)[0]!);
  return out;
}

/** Which cards of `p`'s hand they discard (CR 701.9b): all of them, a random set, or a choice by the discarder or by another player. */
function discardPlan(cx: ExecCtx, st: Step<'discard'>, p: PlayerId, n: number | 'hand'): ObjectId[] {
  const g = cx.g;
  const inHand = discardable(cx, p, findObjects(g.s, { ...(st.filter ?? {}), zone: 'hand' }, filterCtxOf(cx)).filter((o) => o.owner === p).map((o) => o.id));
  if (n === 'hand') return inHand;
  const k = Math.min(n, inHand.length);
  if (k === 0) return [];
  if (k === inHand.length) return inHand; // nothing to choose (CR 609.3: do as much as possible)
  if (st.mode === 'random') return pickRandom(cx, inHand, k);
  const chooser = st.mode === 'opponentChooses' ? discardChooser(cx, p) : p;
  if (chooser !== p) showCards(g, inHand, [chooser]); // the chooser looks at the hand to choose (CR 701.20e)
  const ans = g.choose({
    kind: 'chooseObjects', player: chooser, options: inHand, min: k, max: k,
    prompt: chooser === p ? `Choose ${cardsWord(k)} to discard.` : `Choose ${cardsWord(k)} for ${playerName(g, p)} to discard.`, rules: ['CR 701.9b'],
  });
  return ans.ids;
}

/**
 * WP31 review: the cards of `ids` the player may discard (CR 701.9, 101.2): a "can't" effect is asked for each card, the card being its `other` ("you can't
 * discard cards", "you can't discard creature cards"). The cards kept are logged once.
 */
function discardable(cx: ExecCtx, p: PlayerId, ids: ObjectId[]): ObjectId[] {
  const ok: ObjectId[] = [];
  const kept: ObjectId[] = [];
  let why = '';
  for (const id of ids) {
    const d = cantDo(cx.g.s, 'discard', p, id);
    if (d) {
      kept.push(id);
      why ||= d.message;
    } else ok.push(id);
  }
  if (kept.length > 0) {
    // C3 (audit 2026-10-12, CR 400.2): the cards kept are named only to the players who can see them (a hand is hidden from the other players).
    const all = kept.length === ids.length;
    const line = cardLine(cx.g.s, kept.map((id) => seersOf(cx.g.s, cx.g.s.objects[id]!)).reduce((a, b) => a.filter((x) => b.includes(x))),
      `${playerName(cx.g, p)} can't discard ${all ? 'cards' : namesOf(cx.g, kept)}. ${why}`, `${playerName(cx.g, p)} can't discard ${all ? 'cards' : cardsWord(kept.length)}. ${why}`);
    cx.g.log(line.text, { rules: ['CR 701.9a', 'CR 101.2'], level: 'info', ...(line.privateText ? { privateText: line.privateText } : {}) });
  }
  return ok;
}

/** C6: the value forms of the discard op this module runs (model/cap-walk.ts emits them; model/capabilities.ts registers them): the players who can't (CR 101.3). */
export const OP_FORMS: readonly string[] = ['op:discard.cantAs', 'op:discard.perPlayerCount', // std-rx30: perPlayerCount
  'op:draw.perPlayerCount']; // p2-zone-moves-1

/** CR 701.9a: move cards from a player's hand to that player's graveyard. Every player chooses first, in APNAP order, then the cards are discarded together (CR 608.2e). */
export function discardHandler(cx: ExecCtx, st: Step<'discard'>): StepResult {
  // std-rx30 (CR 608.2e, 101.4): a count that reads each player of the group ("each player discards half the cards in their hand") is read for each of them
  const perPlayer = st.count !== 'hand' && readsEachPlayer(st.who, st.count);
  const n: number | 'hand' | undefined = st.count === 'hand' ? 'hand' : perPlayer ? 0 : cardCount(cx, st.count);
  if (n === undefined) { bindObjects(cx, st.cantAs, []); return NOTHING; } // C6 review (CR 101.3): no count, nobody "can't" (bound on every path, design 3.1 rule 6)
  // WP31: "can't discard" (CR 701.9, 101.2) is asked per card (`discardable`): a player who can't discard any card discards nothing and chooses nothing.
  const counts = playersOf(cx, st.who).map((p): { p: PlayerId; k: number | 'hand' | undefined } => ({ p, k: perPlayer ? readFor(cx, p, () => cardCount(cx, st.count as Quantity)) : n }));
  const plans = counts.flatMap(({ p, k }) => (k === undefined ? [] : [{ p, k, ids: discardPlan(cx, st, p, k) }]));
  // C6 (CR 101.3, 608.2c): the players who can't discard as many cards as asked, for "Each opponent who can't ..." (decided before anything moves, CR 608.2e)
  const cant = plans.filter((x) => x.k !== 'hand' && x.ids.length < x.k).map((x) => x.p);
  const discarded: ObjHandle[] = [];
  const before: LastKnown[] = []; // Cloud C7
  for (const { p, ids } of plans) {
    const names = namesOf(cx.g, ids);
    const moved = ids.flatMap((id) => {
      const to = moveAsAction(cx, { id, zone: 'hand' }, 'graveyard', 'discard', cx.controller);
      const lki = to !== null ? cx.g.s.lki[id] : undefined;
      if (lki !== undefined) before.push(lki);
      return to ?? [];
    });
    if (moved.length === 0) continue;
    discarded.push(...moved);
    logAction(cx, `${playerName(cx.g, p)} discards ${names}.`, ['CR 701.9a', 'CR 701.9b']);
  }
  bindObjects(cx, st.as, discarded);
  bindObjects(cx, st.cantAs, [], cant);
  // Cloud C7 (CR 608.2c, 608.2h, 701.9a): a named discard reports the cards it discarded as each was in the hand ("for each creature card discarded this way",
  // "if a land card is discarded this way"); a card a replacement effect discarded somewhere else (madness: into exile, CR 702.35a) was discarded all the same
  // Merge wave 8 (audit D2, CR 701.9a, 608.2c): "discard your hand" is carried out even when the hand is empty (the official ruling on Narset, Jeskai Waymaster,
  // WotC 2025-04-04: "You may choose to discard your hand even if your hand contains zero cards."), so "if you do" after it holds (control.ts#mayHandler)
  const done = n === 'hand' && st.filter === undefined ? { performed: true, count: discarded.length } : result(discarded.length);
  return st.as === undefined ? done : { ...done, before };
}

/** CR 701.17a-c: put the top N cards of the library into the graveyard, as many as there are (701.17b). The milled cards can be found in a public zone (701.17c). */
export function millHandler(cx: ExecCtx, st: Step<'mill'>): StepResult {
  const n = cardCount(cx, st.count);
  if (n === undefined) return NOTHING;
  const g = cx.g;
  // Cloud r3-repl (CR 701.17a, 614.1a): each player's mill is proposed as one event first, so "they mill that many cards plus four instead" changes its number
  // (effects/proposal-kinds/mill.ts); a mill replaced or reduced to nothing moves no card
  const plans = playersOf(cx, st.who).map((p) => {
    const final = n > 0 ? proposeResult(g, { ev: 'mill', player: p, count: n })?.event : undefined;
    const k = final?.ev === 'mill' ? final.count : 0;
    return { p, ids: (g.s.zones.library[p] ?? []).slice(0, k) };
  });
  const milled: ObjHandle[] = [];
  const before: LastKnown[] = []; // Cloud C7
  for (const { p, ids } of plans) {
    const moved = ids.flatMap((id) => {
      const to = moveAsAction(cx, { id, zone: 'library' }, 'graveyard', 'mill');
      const lki = to?.zone === 'graveyard' ? g.s.lki[id] : undefined;
      if (lki !== undefined) before.push(lki);
      return to ?? [];
    });
    if (moved.length === 0) continue;
    milled.push(...moved);
    logAction(cx, `${playerName(g, p)} mills ${namesOf(g, moved.map((h) => h.id))}.`, ['CR 701.17a', 'CR 701.17b']);
  }
  bindObjects(cx, st.as, milled);
  // Cloud C7 (CR 608.2c, 608.2h, 701.17a): a named mill reports the cards it put into a graveyard, as each was in the library ("for each creature card put into your
  // graveyard this way"); a card a replacement effect put elsewhere (exiled instead) was not put into a graveyard
  return st.as === undefined ? result(milled.length) : { ...result(milled.length), before };
}
