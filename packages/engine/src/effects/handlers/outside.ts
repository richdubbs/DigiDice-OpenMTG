/**
 * Cloud r3-mech: a card a player owns from outside the game put into their hand (CR 400.11b), the "wish" effects: "You may reveal a creature card you own from
 * outside the game and put it into your hand." (`reveal`) and "you may put a card you own from outside the game into your hand." Op: fromOutside.
 *
 * The cards a player owns outside the game are their sideboard (CR 400.11a, 100.4): `GameState.outside`, given by the game config (`PlayerConfig.sideboard`), as
 * learn reads them (effects/handlers/learn.ts). Outside the game a card has its front face's characteristics (CR 712.8a), so `filter` is matched against those:
 * card types (`types`: any of them, `allTypes`, `notTypes`, `anyOf` of such filters), colors and name, the fields OUTSIDE_FILTER_FIELDS lists (model/cap-walk.ts refuses any other).
 * The player chooses one matching card, or none when the instruction is optional (the `may` around it says so: here "none" is only offered with nothing to
 * pick); a revealed card is shown to every player (CR 701.20a), an unrevealed one only to its owner (CR 400.2).
 */
import type { Game } from '../../core/game';
import { showCards } from '../../core/zones';
import { faceChars } from '../../rules/characteristics';
import type { EffectStep, ObjectFilter } from '../../types/ability';
import type { DefId, PlayerId } from '../../types/ids';
import type { OpHandlers, StepHandler } from '../api';
import { performAction } from '../perform';
import { performBringIntoGame } from '../perform-direct';
import { bindAs, did, firstPlayer, NOTHING } from './zones-util';

type Step = Extract<EffectStep, { op: 'fromOutside' }>;

/** The ObjectFilter fields a card outside the game is matched on (anything else: model/cap-walk.ts makes the step an unregistered form). */
export const OUTSIDE_FILTER_FIELDS: readonly string[] = ['types', 'allTypes', 'notTypes', 'anyOf', 'colors', 'name'];

/** Does the front face of this card definition match `f` (CR 712.8a)? Only OUTSIDE_FILTER_FIELDS; another field matches nothing (fail closed). */
export function outsideMatches(g: Game, defId: DefId, f: ObjectFilter | undefined): boolean {
  const def = g.s.defs[defId];
  if (def === undefined || def.isToken) return false;
  if (f === undefined) return true;
  const c = faceChars(def, 0);
  const rec = f as unknown as Record<string, unknown>;
  if (Object.keys(rec).some((k) => rec[k] !== undefined && !OUTSIDE_FILTER_FIELDS.includes(k))) return false;
  const types: readonly string[] = c.types;
  if (f.types && !f.types.some((t) => types.includes(t))) return false; // any of them ("a creature or land card")
  if (f.allTypes && !f.allTypes.every((t) => types.includes(t))) return false;
  if (f.notTypes && f.notTypes.some((t) => types.includes(t))) return false;
  if (f.colors && !f.colors.some((x) => c.colors.includes(x))) return false;
  if (f.name !== undefined && c.name !== f.name && def.name !== f.name) return false;
  if (f.anyOf && !f.anyOf.some((x) => outsideMatches(g, defId, x))) return false;
  return true;
}

/** The different cards `player` owns outside the game that match `filter`, in the order they were listed. */
function candidates(g: Game, player: PlayerId, filter: ObjectFilter | undefined): DefId[] {
  return [...new Set((g.s.outside?.[player] ?? []).filter((d) => outsideMatches(g, d, filter)))];
}

/** The value forms of the fromOutside op this module runs (model/cap-walk.ts emits them; model/capabilities.ts registers them). */
export const OP_FORMS: readonly string[] = ['op:fromOutside.chosenAmong'];

/**
 * std-rx30 (CR 400.11b, 201.2, 701.20a, 608.2d): "You may reveal exactly two cards you own with different names from outside the game. An opponent chooses one of them.
 * You put that card into your hand." The revealing player picks exactly `exactly` cards of different names (nothing when they own fewer such cards: "exactly" can't be
 * done in part), every player sees them, the chooser picks one, and that one is put into the revealing player's hand; the others stay outside the game.
 */
function revealChosenAmong(cx: Parameters<StepHandler<Step>>[0], st: Step, player: PlayerId): ReturnType<StepHandler<Step>> {
  const g = cx.g;
  const name = g.player(player).name;
  const n = st.exactly!;
  const options = candidates(g, player, st.filter);
  const names = new Set(options.map((d) => g.s.defs[d]!.name));
  if (names.size < n) {
    g.log(`${name} can't reveal ${n} cards with different names from outside the game.`, { rules: ['CR 400.11b', 'CR 201.2'], level: 'info' });
    return NOTHING;
  }
  let picked: DefId[] = [];
  for (let guard = 0; guard < 8; guard++) {
    const ans = g.choose({
      kind: 'chooseOption', player, min: n, max: n, rules: ['CR 400.11b', 'CR 201.2'],
      prompt: `Choose exactly ${n} cards you own with different names from outside the game to reveal.`,
      options: options.map((d) => ({ id: `card:${d}`, label: g.s.defs[d]!.name })),
    });
    picked = [...new Set(ans.ids.filter((x) => x.startsWith('card:')).map((x) => x.slice('card:'.length)).filter((d) => options.includes(d)))];
    if (picked.length === n && new Set(picked.map((d) => g.s.defs[d]!.name)).size === n) break;
    picked = [];
  }
  if (picked.length !== n) return NOTHING;
  g.log(`${name} reveals ${picked.map((d) => g.s.defs[d]!.name).join(', ')} from outside the game.`, { rules: ['CR 400.11b', 'CR 701.20a'], level: 'action' });
  const chooser = st.chooser !== undefined ? firstPlayer(cx, st.chooser) ?? player : player;
  const pick = g.choose({
    kind: 'chooseOption', player: chooser, min: 1, max: 1, rules: ['CR 608.2d'],
    prompt: `Choose one of the cards ${name} revealed; ${name} puts it into their hand.`,
    options: picked.map((d) => ({ id: `card:${d}`, label: g.s.defs[d]!.name })),
  }).ids[0];
  const chosen = pick !== undefined && pick.startsWith('card:') && picked.includes(pick.slice('card:'.length)) ? pick.slice('card:'.length) : picked[0]!;
  const id = performBringIntoGame(g, player, chosen);
  if (id === null) return NOTHING;
  showCards(g, [id], g.s.players.map((p) => p.id));
  performAction(g, { verb: 'reveal', actor: player, objectId: id });
  g.log(`${g.player(chooser).name} chooses ${g.nameOf(id)}; ${name} puts it into their hand.`, { rules: ['CR 400.11b', 'CR 608.2d'], level: 'action' });
  bindAs(cx, st.as, [{ id, zone: 'hand' }]);
  return did(1);
}

/** CR 400.11b: put a card the player owns from outside the game into their hand (revealed when the instruction says so). */
const fromOutside: StepHandler<Step> = (cx, st) => {
  const g = cx.g;
  bindAs(cx, st.as, []);
  const player = firstPlayer(cx, st.who);
  if (player === undefined) return NOTHING;
  if (st.exactly !== undefined && st.reveal) return revealChosenAmong(cx, st, player); // std-rx30
  const name = g.player(player).name;
  const options = candidates(g, player, st.filter);
  if (options.length === 0) {
    g.log(`${name} has no such card outside the game.`, { rules: ['CR 400.11b'], level: 'info' });
    return NOTHING;
  }
  const ans = g.choose({
    kind: 'chooseOption', player, min: 1, max: 1, rules: ['CR 400.11b'],
    prompt: st.reveal ? 'Choose a card you own from outside the game to reveal and put into your hand.' : 'Choose a card you own from outside the game to put into your hand.',
    options: options.map((d) => ({ id: `card:${d}`, label: g.s.defs[d]!.name })),
  });
  const defId = (ans.ids[0] ?? '').startsWith('card:') ? ans.ids[0]!.slice('card:'.length) : null;
  if (defId === null || !options.includes(defId)) return NOTHING;
  const id = performBringIntoGame(g, player, defId);
  if (id === null) return NOTHING;
  if (st.reveal) {
    showCards(g, [id], g.s.players.map((p) => p.id)); // CR 701.20a: every player sees the revealed card
    performAction(g, { verb: 'reveal', actor: player, objectId: id });
    g.log(`${name} reveals ${g.nameOf(id)} from outside the game and puts it into their hand.`, { rules: ['CR 400.11b', 'CR 701.20a'], level: 'action' });
  } else {
    g.log(`${name} puts a card from outside the game into their hand.`, { rules: ['CR 400.11b'], level: 'action', privateText: { players: [player], text: `${name} puts ${g.nameOf(id)} from outside the game into their hand.` } });
  }
  return did(1);
};

export const OUTSIDE_HANDLERS: OpHandlers = { fromOutside };
