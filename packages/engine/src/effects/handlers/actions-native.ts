/**
 * Native keyword actions (design 7.5, `ActionMacro.native`): the CR 701 actions that no fixed list of primitive steps can express. Owner: WP32 (the file the
 * keyword library names for them; design 15.2 gave it no owner, STATUS W1 gap 2). The `action` op (game.ts) runs these for a macro with `native` set.
 *
 *  - cascade (CR 702.85a): exile cards from the top of your library until you exile a nonland card whose mana value is less than this spell's; you may cast it
 *    without paying its mana cost if the resulting spell's mana value is less than this spell's; the cards exiled this way that weren't cast go to the bottom
 *    of your library in a random order. Step: `{op:'action', action:'cascade', who, subject?}` (`subject`: the spell with cascade, `self` when absent).
 *  - discover N (CR 701.57a): the same loop with "mana value N or less"; you may cast it free if the resulting spell's mana value is N or less, otherwise it goes
 *    into your hand; the rest to the bottom in a random order. Step: `{op:'action', action:'discover', who, n}`; `as` binds the discovered card (CR 701.57c).
 *  - vote (CR 701.38a-d): starting with `who` and proceeding in turn order, each player votes for one of the objects `subject` stands for ("each player votes
 *    for a nonland permanent you don't control"); `as` binds each object with the most votes or tied for most votes (the wording of every such card). M12-3:
 *    also for words (`choices`, "carnage or homage", CR 701.38b) and players (a player-only `subject`); the tally is the step's `votes` (`{q:'votes'}`), and
 *    additional votes (CR 701.38d, statics/hooks.ts#extraVotes) are cast with the player's own. A vote with neither `subject` nor `choices` says nothing to vote
 *    for: it is resolved by hand, and the capability walker names that form (`action:vote.words`, never registered). M12F: every vote ends with the
 *    `votesFinished` event (the ballots; none for a vote resolved by hand), the trigger event of "whenever players finish voting" (CR 701.38a).
 *
 * Fail closed, never approximately (design 10): a card that modifies these actions has text the engine does not model ("as you cascade" CR 702.85b, "you
 * choose how each player votes"; M12-3: "you get an additional vote", CR 701.38d, is modeled once it is automated); while any object in play has a MANUAL ability that mentions the action, a reminder chip
 * does, or a spell or ability that resolved this turn had manual text that does (`modifiedByManualText`), the whole action is resolved by hand. Every
 * native action binds its `as` name first (design 3.1 rule 6), so a later step that reads it does nothing after a manual exit (CR 609.3) instead of failing.
 * Moves go through the proposal pipeline (`proposeMove`), casting through the resolution caster (effects/cast-hook.ts), randomness through the state's RNG
 * (design 8.8 rule 2), and every iteration of a loop is charged to the step budget (design 8.8 rule 6).
 */
import type { Game } from '../../core/game';
import { charsOfObject, type Chars } from '../../rules/characteristics';
import { randomOrder } from '../../rules/random';
import { isPlayerOnlyRefKind, type EffectStep, type ObjRef, type PlayerRef } from '../../types/ability';
import type { ObjectId, PlayerId } from '../../types/ids';
import type { GameObject, ObjHandle } from '../../types/state';
import type { ExecCtx, StepHandler } from '../api';
import { resolutionCaster } from '../cast-hook';
import { extraVotes } from '../../statics/hooks';
import { evalQty } from '../eval';
import { filterCtxOf, resolvePlayers } from '../refs';
import { matchesFilter } from '../../rules/filter';
import { askManual } from '../manual';
import { performAction, performArrangeLibrary } from '../perform';
import { spend } from '../run';
import { COUNTER_FEATURES, COUNTER_NATIVES } from './actions-native-counters';
import { FACE_NATIVE_FEATURES, FACE_NATIVES } from './face-ops';
import { DFC_NATIVE_FEATURES, DFC_NATIVES } from './dfc-ops';
import { ATTRACTION_FEATURES, ATTRACTION_NATIVES } from './attraction';
import { MELD_PAIR_FEATURES, MELD_PAIR_NATIVES } from './meld-pair';
import { GIFT_NATIVE_FEATURES, GIFT_NATIVES } from './gift';
import { LEARN_FEATURES, LEARN_NATIVES } from './learn';
import { VENTURE_FEATURES, VENTURE_NATIVES } from './venture';
import { RING_FEATURES, RING_NATIVES } from './ring';
import { AIRBEND_FEATURES, AIRBEND_NATIVES } from './airbend';
import { BEHOLD_FEATURES, BEHOLD_NATIVES } from './behold';
import { EVIDENCE_FEATURES, EVIDENCE_NATIVES } from './evidence';
import { FORAGE_FEATURES, FORAGE_NATIVES } from './forage';
import { GOAD_FEATURES, GOAD_NATIVES } from './goad';
import { EXERT_FEATURES, EXERT_NATIVES } from './exert';
import { EXPLORE_FEATURES, EXPLORE_NATIVES } from './explore';
import { modifiedByManualText } from './manual-text';
import { actOn, addToLink, bindAs, did, firstPlayer, NOTHING, proposeMove } from './zones-util';
import { playersOf } from './cards-util';

type ActionStep = Extract<EffectStep, { op: 'action' }>;

/**
 * Capability names (`feature:action.native.<name>`, keywords/needs.ts#actionNeeds): the native actions this module implements, and those of
 * actions-native-counters.ts (PUSH1 T1: proliferate, bolster).
 */
export const FEATURES: readonly string[] = ['action.native.cascade', 'action.native.discover', 'action.native.vote', 'vote.words', 'vote.players' /* M12-3 (CR 701.38b) */, ...EXPLORE_FEATURES /* std-lci: explore.ts */, ...COUNTER_FEATURES, ...FACE_NATIVE_FEATURES, ...DFC_NATIVE_FEATURES, ...MELD_PAIR_FEATURES, ...GIFT_NATIVE_FEATURES, ...VENTURE_FEATURES, ...LEARN_FEATURES, ...RING_FEATURES, ...ATTRACTION_FEATURES, ...AIRBEND_FEATURES, ...BEHOLD_FEATURES, ...EVIDENCE_FEATURES, ...GOAD_FEATURES, ...FORAGE_FEATURES, ...EXERT_FEATURES]; // M12-3: goad (goad.ts); FAST5X E28: forage (forage.ts); M6-3: manifest, cloak, manifest dread (face-ops.ts); M6-4: meld (dfc-ops.ts); MX2: meldPair (meld-pair.ts); FAST5 MX7: learn (learn.ts); MX3: ringTempts (ring.ts); T38: openAttraction (attraction.ts); FAST5X E10: airbend (airbend.ts); FAST5X E11: behold (behold.ts); FAST5X E12: collectEvidence (evidence.ts)

const textOf = (st: ActionStep, fallback: string): string => st.span ?? fallback;

/** Every decision of a cast made during a resolution is non-cancellable (CR 733.1; the same wrapper as tokens-cast.ts). */
function uncancellable(g: Game): Game {
  return new Proxy(g, {
    get(target, prop) {
      if (prop === 'choose') return (input: Parameters<Game['choose']>[0]) => target.choose({ ...input, cancellable: false });
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
    set: (target, prop, value) => Reflect.set(target, prop, value, target),
  });
}

/**
 * "Exile cards from the top of your library until you exile a [card that `stop` accepts]" (CR 702.85a, 701.57a). Each card is its own zone change through the
 * pipeline, so it is exiled face up and every player sees it. Returns the cards now in exile because of it, in the order exiled, and the one it stopped at.
 */
function exileUntil(cx: ExecCtx, player: PlayerId, cause: string, stop: (c: Chars, o: GameObject) => boolean): { exiled: ObjHandle[]; hit: ObjHandle | null } {
  const g = cx.g;
  const exiled: ObjHandle[] = [];
  const limit = g.s.zones.library[player]?.length ?? 0;
  for (let i = 0; i < limit; i++) {
    const top = g.s.zones.library[player]?.[0];
    if (top === undefined) break;
    spend(cx, 1);
    const m = proposeMove(cx, { id: top, zone: 'library' }, 'exile', { cause });
    if (!m.ok || !m.to) break; // a replacement kept it in the library: stop rather than loop
    if (m.to.zone !== 'exile') continue; // it went somewhere else instead (CR 614.6): it was not exiled this way
    exiled.push(m.to);
    const o = g.s.objects[m.to.id];
    if (o && stop(charsOfObject(g.s, o), o)) return { exiled, hit: m.to };
  }
  return { exiled, hit: null };
}

const isNonland = (c: Chars): boolean => !c.types.includes('Land');

/**
 * "You may cast that card without paying its mana cost if the resulting spell's mana value is [at most max]" (CR 702.85a, 701.57a, 608.2g). Returns whether it
 * was cast. The player is asked only if the card can be cast now with a face that small (CR 601.3).
 */
function mayCastFree(cx: ExecCtx, player: PlayerId, h: ObjHandle, max: number, rule: string): boolean {
  const g = cx.g;
  const caster = resolutionCaster();
  if (!caster) return false;
  const name = g.nameOf(h.id);
  const opts = { free: true, maxManaValue: max };
  const denial = caster.check(g, player, h.id, opts);
  if (denial) {
    g.log(`${g.player(player).name} can't cast ${name} now: ${denial.message}`, { rules: [rule, ...denial.rules], level: 'info' });
    return false;
  }
  const yes = g.choose({
    kind: 'yesNo', player, prompt: `Cast ${name} without paying its mana cost?`, yesLabel: 'Cast it', noLabel: "Don't cast it", rules: [rule, 'CR 608.2g'],
  }).yes;
  if (!yes) return false;
  return caster.cast(uncancellable(g), player, h.id, opts) !== null;
}

/**
 * "Put the remaining exiled cards on the bottom of your library in a random order" (CR 702.85a, 701.57a): those of them still in exile. H1 (CR 400.2): the
 * exiled cards are public but the random order is not, so they are moved in the order they were exiled (each move's event and log line is public) and then
 * put in the random order (`core/zones.ts#arrangeInLibrary`, which gives them new ids).
 */
function bottomInRandomOrder(cx: ExecCtx, cards: ObjHandle[], cause: string): number {
  const g = cx.g;
  const still = cards.filter((h) => g.s.objects[h.id]?.zone === 'exile');
  const order = randomOrder(g, still).map((h) => h.id);
  const became = new Map<ObjectId, ObjectId>();
  let n = 0;
  for (const h of still) {
    spend(cx, 1);
    const m = proposeMove(cx, h, 'library', { position: 'bottom', cause });
    if (m.ok) n++;
    if (m.to?.zone === 'library') became.set(h.id, m.to.id);
  }
  performArrangeLibrary(g, order.flatMap((id) => became.get(id) ?? []));
  return n;
}

/** The mana value of the spell with cascade, as it is on the stack (X counts, CR 202.3e) or as it last was (CR 608.2h). */
function spellManaValue(cx: ExecCtx, st: ActionStep): number | undefined {
  const of: ObjRef = st.subject !== undefined && isObjRef(st.subject) ? st.subject : { ref: 'self' };
  return evalQty(cx, { q: 'stat', stat: 'manaValue', of });
}

/**
 * References that stand only for players (PlayerRef); every other one can stand for objects (target, bound, event and linked serve both, design 2.3).
 * M12-1 (m12 design 4.3): the one table of player-only references, `PLAYER_ONLY_REFS` (its own list here lacked `costChosen`).
 */
const isObjRef = (r: NonNullable<ActionStep['subject']>): r is ObjRef => !isPlayerOnlyRefKind(r.ref) && !(r.ref === 'each' && 'who' in r);

type ExileUntilStep = Extract<EffectStep, { op: 'exileUntil' }>;

/** std-rx31: the value forms of `exileUntil` this handler runs, as model/cap-walk.ts writes them (model/capabilities.ts). */
export const EXILE_UNTIL_OP_FORMS: readonly string[] = ['op:exileUntil.total' /* "until you exile cards with total mana value N or greater", CR 202.3 */];

/**
 * Cloud std-eoe (CR 406.1, 401.1, 608.2c): the `exileUntil` op, "exile cards from the top of your library until you exile a nonland card": the loop of cascade and
 * discover with the step's filter, read on each card as it is in exile; nothing is cast or put back. `as` names the card it stopped at (none when the library ran
 * out first: "that card" then names nothing, CR 608.2b); every card it exiled stays in exile. A card that modifies the action has no wording for it (cascade's
 * "as you cascade" has no counterpart), so there is no manual exit.
 */
export const exileUntilStep: StepHandler<ExileUntilStep> = (cx, st) => {
  const g = cx.g;
  bindAs(cx, st.as, []); // bound before any early exit (design 3.1 rule 6, CR 609.3)
  bindAs(cx, st.exiled, []); // trek-7: every card it exiled (the rest, "put the rest on the bottom"), none yet
  // std-rs (CR 101.4, 608.2e): "each opponent exiles cards from the top of their library until they exile a nonland card": each player in APNAP order, each
  // from their own library (none: it fails to determine, CR 608.2b)
  const players = playersOf(cx, st.who);
  const ctx = filterCtxOf(cx);
  // std-rx31 (CR 202.3, 608.2c): "until you exile cards with total mana value 4 or greater": the matching cards' mana values add up, read as each card is in exile
  // (each player's own total, std-rs); `as` then names every card exiled this way
  const need = st.total !== undefined ? evalQty(cx, st.total.atLeast) : undefined;
  if (st.total !== undefined && need === undefined) return NOTHING; // fails to determine (CR 608.2b)
  const all: ObjHandle[] = [];
  const hits: ObjHandle[] = [];
  for (const player of players) {
    if (st.total !== undefined) {
      let sum = 0;
      const { exiled } = exileUntil(cx, player, 'exileUntil', (c, o) => {
        if (matchesFilter(g.s, o, st.filter, ctx)) sum += c.manaValue;
        return sum >= need!;
      });
      g.log(`${g.player(player).name} exiles ${exiled.length} card${exiled.length === 1 ? '' : 's'} from the top of their library (total mana value ${sum}).`, { rules: ['CR 406.1', 'CR 202.3', 'CR 608.2c'], level: 'action' });
      all.push(...exiled);
      hits.push(...exiled);
      continue;
    }
    const { exiled, hit } = exileUntil(cx, player, 'exileUntil', (_c, o) => matchesFilter(g.s, o, st.filter, ctx));
    g.log(`${g.player(player).name} exiles ${exiled.length} card${exiled.length === 1 ? '' : 's'} from the top of their library${hit ? `, stopping at ${g.nameOf(hit.id)}` : ', no card found'}.`, { rules: ['CR 406.1', 'CR 608.2c'], level: 'action' });
    all.push(...exiled);
    if (hit) hits.push(hit);
  }
  addToLink(cx, st.link, all); // std-rs (CR 607.2a): every card it exiled is "exiled with ~" (zones-util.ts)
  bindAs(cx, st.as, hits);
  bindAs(cx, st.exiled, all); // trek-7 (CR 406.1, 608.2c): every card it exiled, the card it stopped at too (CR 400.7: the objects in exile now)
  return did(all.length);
};

/** CR 702.85a: cascade. */
const cascade: StepHandler<ActionStep> = (cx, st) => {
  const g = cx.g;
  bindAs(cx, st.as, []); // bound before any manual prompt or early exit (design 3.1 rule 6); a later step reading it then does nothing (CR 609.3)
  const modified = modifiedByManualText(g, /\bcascad(e|es|ing)\b/i);
  if (modified) return askManual(cx, textOf(st, 'Cascade.'), `cascade is modified by an ability the engine does not run (CR 702.85b), ${modified}`);
  if (!resolutionCaster()) return askManual(cx, textOf(st, 'Cascade.'), 'the casting rules are not loaded in this module graph (CR 608.2g)');
  const player = firstPlayer(cx, st.who);
  const n = spellManaValue(cx, st);
  if (player === undefined || n === undefined) return NOTHING; // fails to determine (CR 608.2b)
  const { exiled, hit } = exileUntil(cx, player, 'cascade', (c) => isNonland(c) && c.manaValue < n);
  g.log(`${g.player(player).name} cascades (mana value less than ${n}): ${exiled.length} card${exiled.length === 1 ? '' : 's'} exiled${hit ? `, stopping at ${g.nameOf(hit.id)}` : ', no card found'}.`, { rules: ['CR 702.85a'], level: 'action' });
  const cast = hit !== null && mayCastFree(cx, player, hit, n - 1, 'CR 702.85a');
  bottomInRandomOrder(cx, exiled, 'cascade');
  return did(exiled.length + (cast ? 1 : 0));
};

/** CR 701.57a: discover N. */
const discover: StepHandler<ActionStep> = (cx, st) => {
  const g = cx.g;
  bindAs(cx, st.as, []); // CR 701.57c: no discovered card yet; bound before any manual prompt or early exit (design 3.1 rule 6, CR 609.3)
  const modified = modifiedByManualText(g, /\bdiscover(s|ed|ing)?\b/i);
  if (modified) return askManual(cx, textOf(st, 'Discover.'), `discover is modified by an ability the engine does not run, ${modified}`);
  if (!resolutionCaster()) return askManual(cx, textOf(st, 'Discover.'), 'the casting rules are not loaded in this module graph (CR 608.2g)');
  if (st.n === undefined) return askManual(cx, textOf(st, 'Discover.'), 'the step does not say N (CR 701.57a)');
  const player = firstPlayer(cx, st.who);
  const raw = evalQty(cx, st.n);
  if (player === undefined || raw === undefined || Number.isNaN(raw)) return NOTHING; // fails to determine (CR 608.2b)
  const n = Math.max(0, Math.floor(raw));
  const { exiled, hit } = exileUntil(cx, player, 'discover', (c) => isNonland(c) && c.manaValue <= n);
  g.log(`${g.player(player).name} discovers ${n}: ${exiled.length} card${exiled.length === 1 ? '' : 's'} exiled${hit ? `, stopping at ${g.nameOf(hit.id)}` : ', no card found'}.`, { rules: ['CR 701.57a'], level: 'action' });
  let discovered: ObjHandle | null = null;
  if (hit) {
    if (mayCastFree(cx, player, hit, n, 'CR 701.57a')) {
      const newId = g.s.lki[hit.id]?.newId;
      discovered = newId && g.s.objects[newId] ? { id: newId, zone: g.s.objects[newId]!.zone } : null;
    } else if (g.s.objects[hit.id]?.zone === 'exile') {
      const m = proposeMove(cx, hit, 'hand', { cause: 'discover' }); // CR 701.57a: "If you don't cast it, put that card into your hand."
      if (m.ok && m.to) g.log(`${g.player(player).name} puts ${g.nameOf(m.to.id)} into their hand.`, { rules: ['CR 701.57a'], level: 'action' });
      discovered = m.to ?? null;
    }
  }
  bottomInRandomOrder(cx, exiled.filter((h) => h.id !== hit?.id), 'discover');
  // std-rx26 (CR 701.57a, 603.2; cite unverified): the player has discovered N, whatever the process found ("whenever you discover", "discover again for the
  // same value": the event's amount is N, triggers/normalize.ts)
  performAction(g, { verb: 'discover', actor: player, x: n });
  bindAs(cx, st.as, discovered ? [discovered] : []); // CR 701.57c: the discovered card
  return did(exiled.length);
};

/** The players in turn order starting with `first` (CR 701.38a, 101.4: turn order is the order of `players`). */
function turnOrderFrom(g: Game, first: PlayerId): PlayerId[] {
  const ids = g.s.players.filter((p) => !p.hasLost).map((p) => p.id);
  const i = ids.indexOf(first);
  return i < 0 ? ids : [...ids.slice(i), ...ids.slice(0, i)];
}

/**
 * M12-3: manual text that changes HOW players vote (CR 701.38d: "While voting, you get an additional vote", "you may vote an additional time"; "You choose how
 * each player votes this turn"; a vote of its own: "each player votes for", "secretly votes"). Text that only reads a result ("for each evidence vote",
 * "if carnage gets more votes", "whenever players finish voting") does not change the vote, so it no longer makes it manual: before, the manual sentences of
 * the vote's own card (Tivit, Seller of Secrets: "For each evidence vote, investigate.") made every vote of the turn manual.
 */
const VOTE_MODIFIERS = /\b(while voting|additional votes?|vote an additional time|how each player votes|votes? (for|secretly)|secretly votes?|can't vote|choose how)\b/i;

/** What a vote is for (CR 701.38b): words, objects or players; undefined when the step does not say (resolved by hand). */
function voteKind(st: ActionStep): 'words' | 'objects' | 'players' | undefined {
  if (st.choices !== undefined) return st.subject === undefined && st.choices.length >= 2 && new Set(st.choices).size === st.choices.length ? 'words' : undefined;
  if (st.subject === undefined) return undefined;
  return isObjRef(st.subject) ? 'objects' : 'players';
}

/**
 * CR 701.38a-d: vote. Starting with `who` and proceeding in turn order (players who left the game are skipped, CR 800.4a), each player votes for one of the
 * choices: the words of `choices` (CR 701.38b), the objects `subject` stands for, or the players it stands for (M12-3, m12 design D7). A player with additional
 * votes (statics/hooks.ts#extraVotes: "While voting, you get an additional vote", "you may vote an additional time") casts them all at the same time they would
 * otherwise vote (CR 701.38d): words and players in one decision that takes every vote (the same choice allowed more than once), objects one decision per vote
 * in a row. The tally (every choice, 0 included) is the step's `votes` (`{q:'votes'}`: "if carnage gets more votes", "for each money vote"); `as` binds the
 * objects or players with the most votes or tied for most votes (the wording of every such card). Words bind nothing.
 */
const vote: StepHandler<ActionStep> = (cx, st) => {
  const g = cx.g;
  bindAs(cx, st.as, []); // nothing has votes yet; bound before any manual prompt or early exit (design 3.1 rule 6, CR 609.3)
  const kind = voteKind(st);
  // M12F: a vote resolved by hand is still a vote the players finish (askManual emits `votesFinished` without ballots, CR 701.38a)
  if (kind === undefined) return askManual(cx, textOf(st, 'Vote.'), 'the vote does not say what the players vote for (CR 701.38b): vote and apply the result by hand', undefined, { votes: true });
  const modified = modifiedByManualText(g, VOTE_MODIFIERS);
  if (modified) return askManual(cx, textOf(st, 'Vote.'), `voting is modified by an ability the engine does not run (CR 701.38d), ${modified}`, undefined, { votes: true });
  const first = firstPlayer(cx, st.who);
  if (first === undefined) return NOTHING;
  // the choices as keys (a word, an object id, a player id), with their names
  let objects: ObjHandle[] = [];
  let keys: string[];
  if (kind === 'words') keys = [...st.choices!];
  else if (kind === 'objects') keys = (objects = actOn(cx, st.subject as ObjRef)).map((h) => h.id);
  else keys = resolvePlayers(cx, st.subject as PlayerRef).filter((p) => !g.player(p).hasLost); // CR 800.4a: a player who left can't be voted for
  const nameOf = (k: string): string => (kind === 'words' ? k : kind === 'objects' ? g.nameOf(k) : g.player(k).name);
  if (keys.length === 0) {
    g.log('There is nothing to vote for.', { rules: ['CR 701.38a'], level: 'info' });
    return { ...NOTHING, votes: new Map() };
  }
  const tally = new Map<string, number>(keys.map((k) => [k, 0]));
  const ballots: { voter: PlayerId; votes: string[] }[] = [];
  const what = textOf(st, 'vote');
  let total = 0;
  for (const voter of turnOrderFrom(g, first)) {
    const extra = extraVotes(g.s, voter); // CR 701.38d
    const must = 1 + extra.must;
    const max = must + extra.may;
    const rules = extra.must + extra.may > 0 ? ['CR 701.38a', 'CR 701.38d'] : ['CR 701.38a'];
    const many = max > 1 ? ` You have ${must}${extra.may > 0 ? ` (up to ${max})` : ''} votes; they can be for different choices or the same one.` : '';
    let picks: string[] = [];
    if (kind === 'objects') {
      // one decision per vote (an object decision takes each object once), all of them now (CR 701.38d)
      for (let i = 0; i < max; i++) {
        const ans = g.choose({
          kind: 'chooseObjects', player: voter, prompt: `Vote for one of these (${what}).${many}${max > 1 ? ` Vote ${i + 1} of ${max}.` : ''}`, options: keys, min: i < must ? 1 : 0, max: 1, rules,
        });
        const pick = ans.ids.find((id) => tally.has(id));
        if (pick === undefined) break; // an optional additional vote not cast
        picks.push(pick);
      }
    } else {
      const ans = g.choose({
        kind: 'chooseOption', player: voter, prompt: `Vote for ${kind === 'words' ? 'one of these' : 'a player'} (${what}).${many}`, min: must, max,
        ...(max > 1 ? { allowRepeat: true } : {}), options: keys.map((k) => ({ id: k, label: nameOf(k) })), rules,
      });
      picks = ans.ids.filter((k) => tally.has(k)).slice(0, max);
    }
    for (const k of picks) tally.set(k, tally.get(k)! + 1);
    ballots.push({ voter, votes: picks });
    total += picks.length;
    if (picks.length > 0) g.log(`${g.player(voter).name} votes for ${picks.map(nameOf).join(' and ')}.`, { rules, level: 'action' });
  }
  const most = Math.max(...tally.values());
  const winners = keys.filter((k) => tally.get(k) === most);
  const counts = keys.map((k) => `${nameOf(k)} ${tally.get(k)}`).join(', ');
  g.log(`The votes: ${counts}. Most votes or tied for most (${most}): ${winners.map(nameOf).join(', ')}.`, { rules: ['CR 701.38a'], level: 'info' });
  if (kind === 'objects') bindAs(cx, st.as, objects.filter((h) => winners.includes(h.id)));
  else if (kind === 'players') bindAs(cx, st.as, [], winners);
  g.emit({ type: 'votesFinished', starter: first, ballots }); // M12F: "whenever players finish voting" (CR 701.38a), once per vote, with every ballot
  return { ...did(total), votes: tally };
};

/** The native actions by `ActionMacro.native` name (keywords/actions/native.ts). */
export const NATIVE_ACTIONS: Readonly<Record<string, StepHandler<ActionStep>>> = { cascade, discover, vote, ...EXPLORE_NATIVES /* std-lci: explore.ts */, ...COUNTER_NATIVES, ...FACE_NATIVES, ...DFC_NATIVES, ...MELD_PAIR_NATIVES, ...GIFT_NATIVES, ...VENTURE_NATIVES, ...LEARN_NATIVES, ...RING_NATIVES, ...ATTRACTION_NATIVES, ...AIRBEND_NATIVES, ...BEHOLD_NATIVES, ...EVIDENCE_NATIVES, ...GOAD_NATIVES, ...FORAGE_NATIVES, ...EXERT_NATIVES }; // M12-3: goad.ts; FAST5X E28: forage.ts; M6-3: face-ops.ts; M6-4: dfc-ops.ts; MX2: meld-pair.ts; FAST5 MX7: learn.ts; MX3: ring.ts; T38: attraction.ts; FAST5X E10: airbend.ts; FAST5X E11: behold.ts; FAST5X E12: evidence.ts

