/**
 * reveal, look, piles (CR 701.20, 608.2d). Owner: WP13. Revealing shows cards to every player (CR 701.20a), looking shows them to the named player only
 * (CR 701.20e); neither moves anything (701.20b) nor goes through `propose` (there is no event to replace). Visibility is the zone primitive
 * `core/zones.ts#showCards`; the reveal itself is recorded by the performer `effects/perform.ts#performAction` (design 8.6 stage 4).
 */
import type { Game } from '../../core/game';
import { showCards } from '../../core/zones';
import type { EffectStep } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import { HIDDEN_ZONES, type ObjHandle } from '../../types/state';
import type { ExecCtx, StepResult } from '../api';
import { performAction } from '../perform';
import { currentObjs, filterCtxOf, resolveObjs } from '../refs';
import { matchesFilter } from '../../rules/filter';
import { evalQty } from '../eval';
import { allPlayers, bindObjects, cardsWord, logAction, namesOf, NOTHING, playerName, playersOf } from './cards-util';

type Step<K extends EffectStep['op']> = Extract<EffectStep, { op: K }>;

/** Does every one of these players see every one of these objects now? (Objects in public zones are seen by all, CR 400.2.) */
function seenByAll(g: Game, ids: readonly ObjectId[], players: readonly PlayerId[]): boolean {
  return ids.every((id) => {
    const o = g.s.objects[id];
    if (!o || !HIDDEN_ZONES.includes(o.zone)) return true;
    return players.every((p) => (o.zone === 'hand' && o.owner === p) || (o.revealedTo ?? []).includes(p));
  });
}

/**
 * Who reveals each card: its owner when the owner is one of the revealers ("each player reveals the top card of their library"), else the only revealer, else
 * the controller of the effect.
 */
function byRevealer(g: Game, ids: readonly ObjectId[], revealers: readonly PlayerId[], controller: PlayerId): Map<PlayerId, ObjectId[]> {
  const out = new Map<PlayerId, ObjectId[]>();
  for (const id of ids) {
    const owner = g.s.objects[id]?.owner;
    const actor = owner !== undefined && revealers.includes(owner) ? owner : revealers.length === 1 ? revealers[0]! : controller;
    out.set(actor, [...(out.get(actor) ?? []), id]);
  }
  return out;
}

/**
 * CR 701.20a-b: show the cards to all players (or, "reveal ... to [player]", to that player only, like looking, CR 701.20e); they stay where they are. Each
 * card's reveal is recorded for the player who reveals it. With "to", the log names the cards to exactly the players who now see them (the revealer only when
 * they see the card anyway, as a card of their own hand), so the view and the log never disagree (CR 400.2).
 */
export function revealHandler(cx: ExecCtx, st: Step<'reveal'>): StepResult {
  const g = cx.g;
  const handles = currentObjs(cx, resolveObjs(cx, st.what));
  const ids = handles.map((h) => h.id);
  const toAll = st.to === undefined || st.to === 'all';
  const to = toAll ? allPlayers(g) : playersOf(cx, st.to as Exclude<typeof st.to, 'all' | undefined>);
  showCards(g, ids, to);
  const toNames = to.map((p) => playerName(g, p)).join(' and ');
  for (const [actor, cards] of byRevealer(g, ids, playersOf(cx, st.who), cx.controller)) {
    for (const id of cards) performAction(g, { verb: 'reveal', actor, objectId: id });
    const shown = `${playerName(g, actor)} reveals ${namesOf(g, cards)}`;
    if (toAll) logAction(cx, `${shown}.`, ['CR 701.20a']);
    else {
      const knowing = seenByAll(g, cards, [actor]) && !to.includes(actor) ? [...to, actor] : to;
      logAction(cx, `${playerName(g, actor)} reveals ${cardsWord(cards.length)} to ${toNames}.`, ['CR 701.20a'], { players: knowing, text: `${shown} to ${toNames}.` });
    }
  }
  bindObjects(cx, st.as, handles);
  return { performed: ids.length > 0, count: ids.length };
}

/** CR 701.20e: like revealing, but only the named player sees the cards. */
export function lookHandler(cx: ExecCtx, st: Step<'look'>): StepResult {
  const g = cx.g;
  const handles = currentObjs(cx, resolveObjs(cx, st.at));
  const ids = handles.map((h) => h.id);
  const lookers = playersOf(cx, st.who);
  showCards(g, ids, lookers);
  if (ids.length > 0) {
    for (const p of lookers) {
      logAction(cx, `${playerName(g, p)} looks at ${cardsWord(ids.length)}.`, ['CR 701.20e'], { players: [p], text: `${playerName(g, p)} looks at ${namesOf(g, ids)}.` });
    }
  }
  bindObjects(cx, st.as, handles);
  return { performed: ids.length > 0 && lookers.length > 0, count: ids.length };
}

/**
 * r3-dig (CR 701.20a-b, 401.1, 608.2c): "reveal cards from the top of your library until you reveal a land card" (`count` such cards: "until you reveal two land
 * cards"). The cards are revealed from the top one at a time, read in the library, until `count` of them match `filter` or the library has no more; nothing moves
 * (CR 701.20b). `as` names the matching cards (none when the library ran out first: "that card" then names nothing, CR 608.2b), `revealed` every card revealed, so
 * "the rest" is `revealed` less `as` (parser/lower/mentions.ts#revealedRestOf). The cards are revealed to every player and stay revealed while the effect
 * resolves (CR 701.20a), the reveal recorded once per card as `revealHandler` does. The count is the number of cards revealed.
 */
export function revealUntilHandler(cx: ExecCtx, st: Step<'revealUntil'>): StepResult {
  const g = cx.g;
  bindObjects(cx, st.as, []); // bound before any early exit (design 3.1 rule 6, CR 609.3)
  bindObjects(cx, st.revealed, []);
  const [player] = playersOf(cx, st.who);
  if (player === undefined) return NOTHING; // fails to determine (CR 608.2b)
  // Cloud r4-dig (CR 107.3, 608.2h): a computed count is read once, as the reveal begins ("X permanent cards, where X is the number of colors among permanents you
  // control"); a count that fails to determine, or none, reveals nothing (CR 608.2b)
  const want = st.count === undefined ? 1 : evalQty(cx, st.count);
  if (want === undefined || want <= 0) return NOTHING;
  const ctx = filterCtxOf(cx);
  const library = [...(g.s.zones.library[player] ?? [])];
  const revealed: ObjectId[] = [];
  const hits: ObjectId[] = [];
  for (const id of library) {
    if (hits.length >= want) break;
    revealed.push(id);
    const o = g.s.objects[id];
    if (o && matchesFilter(g.s, o, st.filter, ctx)) hits.push(id);
  }
  if (revealed.length === 0) return NOTHING;
  showCards(g, revealed, allPlayers(g));
  for (const id of revealed) performAction(g, { verb: 'reveal', actor: player, objectId: id });
  const stop = hits.length >= want ? `, stopping at ${namesOf(g, hits.slice(-1))}` : hits.length === 0 ? ', no card found' : `, ${hits.length} of ${want} found`;
  logAction(cx, `${playerName(g, player)} reveals ${namesOf(g, revealed)} from the top of their library${stop}.`, ['CR 701.20a', 'CR 608.2c']);
  const handle = (id: ObjectId) => ({ id, zone: 'library' as const });
  bindObjects(cx, st.as, hits.map(handle));
  bindObjects(cx, st.revealed, revealed.map(handle));
  return { performed: true, count: revealed.length };
}

/**
 * "[separator] separates those cards into two piles; [chooser] chooses one" (Fact or Fiction). No rule of its own: the choices are made while the spell resolves
 * (CR 608.2d), the separator first. A pile may be empty. The chosen pile is bound as `chosen`, the other as `other`, for the steps that move them.
 */
export function pilesHandler(cx: ExecCtx, st: Step<'piles'>): StepResult {
  const g = cx.g;
  const handles = currentObjs(cx, resolveObjs(cx, st.cards));
  const ids = handles.map((h) => h.id);
  const [separator] = playersOf(cx, st.separator);
  const [chooser] = playersOf(cx, st.chooser);
  if (ids.length === 0 || separator === undefined || chooser === undefined) {
    bindObjects(cx, st.chosen, []);
    bindObjects(cx, st.other, []);
    return NOTHING;
  }
  const openly = seenByAll(g, ids, allPlayers(g)); // decided before showing them to the two players: what was hidden stays out of the public log
  if (st.faceDown === true) return faceDownPiles(cx, st, handles, separator, chooser, openly);
  showCards(g, ids, [separator, chooser]); // both must see the cards to separate and to choose (CR 701.20e)
  const first = g.choose({
    kind: 'chooseObjects', player: separator, options: ids, min: 0, max: ids.length,
    prompt: 'Separate these cards into two piles: choose the cards of the first pile (the others form the second pile; a pile may be empty).', rules: ['CR 608.2d'],
  }).ids;
  const piles = [handles.filter((h) => first.includes(h.id)), handles.filter((h) => !first.includes(h.id))];
  const label = (i: number): string => `Pile ${i + 1}: ${piles[i]!.length === 0 ? 'no cards' : namesOf(g, piles[i]!.map((h) => h.id))}`;
  const pick = g.choose({
    kind: 'chooseOption', player: chooser, prompt: 'Choose a pile.', min: 1, max: 1,
    options: [{ id: 'pile1', label: label(0) }, { id: 'pile2', label: label(1) }], rules: ['CR 608.2d'],
  }).ids[0] === 'pile2' ? 1 : 0;
  bindObjects(cx, st.chosen, piles[pick]!);
  bindObjects(cx, st.other, piles[1 - pick]!);
  const text = `${playerName(g, separator)} separates ${cardsWord(ids.length)} into two piles (${label(0)}; ${label(1)}) and ${playerName(g, chooser)} chooses pile ${pick + 1}.`;
  if (openly) logAction(cx, text, ['CR 608.2d']);
  else logAction(cx, `${playerName(g, separator)} separates ${cardsWord(ids.length)} into piles of ${piles[0]!.length} and ${piles[1]!.length}; ${playerName(g, chooser)} chooses pile ${pick + 1}.`, ['CR 608.2d'], { players: [separator, chooser], text });
  return { performed: true, count: ids.length };
}

/**
 * r5-dig (CR 700.3, 700.3c-d, 701.20a): "separate them into a face-down pile and a face-up pile. An opponent chooses one of the piles." (Riddles in the Dark, Curator
 * of Destinies). The separator sees every card and puts each into exactly one pile (CR 700.3a); a pile may be empty (CR 700.3d) and the cards stay in their zone
 * (CR 700.3c). The face-up pile is shown to every player; the face-down pile's cards are seen only by the separator (and by a player who saw them already), so the
 * chooser picks knowing the face-up cards and how many cards are face down. The chosen pile is bound as `chosen`, the other as `other`.
 */
function faceDownPiles(cx: ExecCtx, st: Step<'piles'>, handles: readonly ObjHandle[], separator: PlayerId, chooser: PlayerId, openly: boolean): StepResult {
  const g = cx.g;
  const ids = handles.map((h) => h.id);
  showCards(g, ids, [separator]); // the separator divides the cards, so they see them all (CR 701.20e)
  const down = g.choose({
    kind: 'chooseObjects', player: separator, options: ids, min: 0, max: ids.length,
    prompt: 'Separate these cards into a face-down pile and a face-up pile: choose the cards of the face-down pile (the others form the face-up pile; a pile may be empty).', rules: ['CR 700.3a', 'CR 700.3d'],
  }).ids;
  const downPile = handles.filter((h) => down.includes(h.id));
  const upPile = handles.filter((h) => !down.includes(h.id));
  const upIds = upPile.map((h) => h.id);
  showCards(g, upIds, allPlayers(g)); // the face-up pile is seen by every player
  const count = (n: number): string => (n === 1 ? '1 card' : `${n} cards`);
  const downLabel = `Face-down pile: ${count(downPile.length)}`;
  const upLabel = `Face-up pile: ${upIds.length === 0 ? 'no cards' : namesOf(g, upIds)}`;
  const pick = g.choose({
    kind: 'chooseOption', player: chooser, prompt: 'Choose a pile.', min: 1, max: 1,
    options: [{ id: 'down', label: downLabel }, { id: 'up', label: upLabel }], rules: ['CR 608.2d'],
  }).ids[0] === 'up' ? 1 : 0;
  bindObjects(cx, st.chosen, pick === 0 ? downPile : upPile);
  bindObjects(cx, st.other, pick === 0 ? upPile : downPile);
  const which = pick === 0 ? 'the face-down pile' : 'the face-up pile';
  const pub = `${playerName(g, separator)} separates ${cardsWord(ids.length)} into a face-down pile of ${count(downPile.length)} and a face-up pile (${upIds.length === 0 ? 'no cards' : namesOf(g, upIds)}); ${playerName(g, chooser)} chooses ${which}.`;
  const downIds = downPile.map((h) => h.id);
  const full = `${playerName(g, separator)} separates ${cardsWord(ids.length)} into a face-down pile (${downIds.length === 0 ? 'no cards' : namesOf(g, downIds)}) and a face-up pile (${upIds.length === 0 ? 'no cards' : namesOf(g, upIds)}); ${playerName(g, chooser)} chooses ${which}.`;
  if (openly) logAction(cx, full, ['CR 700.3', 'CR 608.2d']);
  else logAction(cx, pub, ['CR 700.3', 'CR 608.2d'], { players: [separator], text: full });
  return { performed: true, count: ids.length };
}
