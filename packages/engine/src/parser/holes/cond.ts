/**
 * Hole grammar `Cond` (Condition), design 6.3. Owner: WP6.
 *
 * Existence ("you control a creature", "you control no Islands", "you control two or more creatures", "there are seven or more cards in your graveyard"),
 * comparisons ("you have 5 or less life", "your life total is 10 or more", "you have no cards in hand"), the turn ("it's your turn"), cast history of the
 * object ("~ was kicked"), results of earlier steps ("you do", "you don't": a `$step` marker), properties of an object ("it's a creature card", "~ is tapped",
 * "that creature has flying"), history of the turn ("you gained life this turn", "a creature died this turn") and designations ("you're the monarch"),
 * the werewolves' "no spells were cast last turn" and "a player cast two or more spells last turn" (M6-4, scope `lastTurn`),
 * (CR 603.4 intervening "if" clauses, CR 608.2d "if you do" after CR 118.12), chained by "and" / "or" (never mixed: a mixed chain has no parse). A bare number is never read as "at least": "you control three creatures" does not parse.
 */
import type { Condition, EventPattern, NumberCmp, ObjRef, ObjectFilter, PlayerPred, Quantity } from '../../types/ability';
import type { Color } from '../../types/mana';
import type { Alt, HoleCtx, HoleFn, Json } from './core';
import { NUMBER_WORDS, P, anaphorObj, anyPhraseAt, cmpAt, dedupe, mergeFilter, phraseAt } from './core';
import { featureAt, isAttachHost, npAlts, REVEALED_THIS_WAY, yourCommanderAt } from './filter';
import { excessCondAt } from './excess';
import { voteCondAt } from './vote';
import { p2iv3CondAt } from './p2iv3';
import { isRoomsOnly } from '../../model/room-filter';
import { movedCondAt } from './moved';
import { MOVED_MARK } from './moved-words';
import { costCondAt } from './cost-conds';
import { kickedWithCost } from './p2cs1';
import { p2iv1CondAt } from './p2iv1';
import { p2iv2CondAt } from './p2iv2';
import { p2cst1CondAt } from './p2cst1';
import { allExiledShareCond } from './trek9'; // trek-9

const W_YOU_CONTROL = P('you control');
const W_YOU_DONT_CONTROL = [P("you don't control"), P('you do not control')];
const W_AN_OPPONENT_CONTROLS = P('an opponent controls');
// cloud std-dsk (CR 506.2, 603.4): "if defending player controls no Glimmer creatures" (an attack trigger's intervening if: the player the attacking source attacks)
const W_DEFENDING_CONTROLS = [P('defending player controls'), P('the defending player controls')];
const W_MORE = P('more'); // FAST5 T62
const W_THAN_YOU = P('than you');
// FAST4 T27: "there's" is one word token (the gate reads it as "there is", render/equivalence.ts)
const W_THERE_ARE = [P('there are'), P('there is'), P("there's")];
const W_CARD_TYPES_AMONG = P('card types among'); // FAST5X E13
const W_COLORS_AMONG = P('colors among'); // FAST5X E12
const W_NAMES_AMONG_UNLOCKED_DOORS = P('different names among unlocked doors of'); // cloud std-dsk
const W_UNLOCKED_DOORS_AMONG = P('unlocked doors among'); // r4-static
const W_COUNTER_KINDS_AMONG = P('different kinds of counters among'); // r4-static
const W_COUNTERS_AMONG = P('counters among'); // std-rg
const W_YOU_HAVE = P('you have');
const W_LIFE = P('life');
const W_EXACTLY = P('exactly'); // p2-modal-1
const W_LIFE_MORE_THAN_STARTING = P('life more than your starting life total'); // FAST5 T60
const W_MOST_LIFE_OR_TIED = P('the most life or are tied for most life'); // std-lci
const W_CARDS_IN_HAND = [P('cards in hand'), P('cards in your hand'), P('card in hand'), P('card in your hand')];
const W_NO = P('no');
const W_OR_MORE = [P('or more'), P('or greater')];
const W_A_PRIME_NUMBER_OF = P('a prime number of'); // std-rx1
const W_WITH_DIFFERENT_NAMES = P('with different names'); // CLOUD std-fdn
const W_DIFFERENTLY_NAMED_COND = P('differently named'); // trek-5
const W_AT_LEAST = P('at least');
const W_ITS_YOUR_TURN = [P("it's your turn"), P('it is your turn')];
const W_ITS_NOT_YOUR_TURN = [P("it's not your turn"), P('it is not your turn')];
const W_ITS_THEIR_TURN = [P("it's their turn"), P('it is their turn')]; // CLOUD std-dft
const W_ITS_NOT_THEIR_TURN = [P("it's not their turn"), P('it is not their turn')]; // CLOUD std-dft
const W_ITS_YOUR_MAIN = [P("it's your main phase"), P('it is your main phase')];
const W_ITS_NOT_YOUR_MAIN = [P("it isn't your main phase"), P("it's not your main phase"), P('it is not your main phase')];
const MAIN_PHASES = ['main1', 'main2'] as const;
// r4-fxb (CR 506.1): "it's your combat phase": your turn, any of the five steps of a combat phase (render/cond.ts#isYourCombatPhase)
const W_ITS_YOUR_COMBAT = [P("it's your combat phase"), P('it is your combat phase')];
const COMBAT_STEPS = ['beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat'] as const;
const W_FIRST_END_STEP = [P("it's the first end step of the turn"), P('it is the first end step of the turn')];
const W_WAS_KICKED = P('was kicked');
const W_WAS_CAST = P('was cast'); // cloud std-spm
const W_CAST_ELSEWHERE = P('was cast from anywhere other than your hand'); // r4-fxz
const W_TWICE = P('twice');
const W_ESCAPED = P('escaped');
const W_WASNT_KICKED = [P("wasn't kicked"), P('was not kicked')];
// FAST5X E1: bargain (CR 702.166b: the spell "has been bargained") and gift (CR 702.174k: "that spell's gift was promised")
const W_WAS_BARGAINED = P('was bargained');
// cloud r3-mech (CR 702.143a, 607.2i): "~ was foretold": the spell was cast from exile for its foretell cost (the cast method `foretell`, actions/cast-opt/foretell.ts)
const W_WAS_FORETOLD = P('was foretold');
const W_ADDITIONAL_COST_PAID = P("'s additional cost was paid");
const W_ADDITIONAL_COST_NOT_PAID = [P("'s additional cost wasn't paid"), P("'s additional cost was not paid")];
/** FAST5X E9: the cast record's name of an optional additional cost printed without a keyword ("As an additional cost to cast this spell, you may ..."). */
const UNNAMED_ADDITIONAL = 'additional';
const W_WASNT_BARGAINED = [P("wasn't bargained"), P('was not bargained')];
const W_GIFT_PROMISED = [P('the gift was promised')];
const W_GIFT_NOT_PROMISED = [P("the gift wasn't promised"), P('the gift was not promised')];
// FAST5X E12 (CR 701.59c, 607.2i): "evidence was collected": the optional additional cost "collect evidence N" of this object's spell was paid
const W_EVIDENCE_COLLECTED = [P('evidence was collected')];
// "the player" is Oracle's second mention of a player named just before ("that player may pay {2}. If the player doesn't, ...", CR 118.12; WP23)
// std-rq (CR 608.2d, 101.4): after "any opponent may ...", "if a player does" / "if no one does" (whether one of them did; render/cond.ts prints these only there)
const W_DID = [P('you do'), P('they do'), P('that player does'), P('the player does'), P('a player does')];
const W_DIDNT = [P("you don't"), P("they don't"), P("that player doesn't"), P('you do not'), P("the player doesn't"), P('no one does')];
// std-rj (CR 608.2c, 601.2; Solstice Revelations): "If you don't cast that card this way, put it into your hand.": the cast right before it (or the `if` that wraps it)
const W_DIDNT_CAST_THIS_WAY = [P("you don't cast that card this way"), P("you didn't cast that card this way"), P('you do not cast that card this way'), P('you did not cast that card this way')];
const W_CANT = [P("you can't"), P('you cannot')]; // STD-OTJ (CR 608.2d)
// std-tdm (CR 608.2c, 121.1, 614.11): "If you don't draw a card this way, ...": the draw right before it (lower/conditions.ts#drawThisWay)
const W_LIBRARY_NO_CARDS = P('your library has no cards in it'); // std-tdm
const W_DIDNT_DRAW = [P("you don't draw a card this way"), P("you didn't draw a card this way"), P('you do not draw a card this way'), P('you did not draw a card this way')];
// std-rx3 (CR 608.2c, 121.1): "If you draw one or more cards this way, ...": the draw right before it drew a card (lower/conditions.ts#drewThisWay)
const W_ONE_OR_MORE = P('one or more'); // std-rx32
const W_BECOME_ATTACHED_THIS_WAY = P('become attached to that creature this way'); // std-rx32
const W_DREW_ANY = [P('you draw one or more cards this way'), P('you drew one or more cards this way')];
const W_MONARCH = [P("you're the monarch"), P('you are the monarch')];
const W_OPPONENT_MONARCH = [P('an opponent is the monarch')]; // M12-3
// MX4 (CR 726.1, 309.7): "you have the initiative", "you've completed a dungeon", "you haven't completed Tomb of Annihilation"
const W_INITIATIVE = [P('you have the initiative')];
/**
 * FAST5X E17 (CR 608.2, 400.7): "this is the second time this ability has resolved this turn" (the resolving ability's own count, this resolution included,
 * rules/resolutions.ts), and "it's the second time": a later sentence of the same ability naming that count again ("... if this is the first time this
 * ability has resolved this turn. If it's the second time, draw a card."). Only "this turn" (not "this game"), only ordinals up to the fifth.
 */
const W_RESOLVED_NTH: [string[], number][] = [
  [P('this is the first time this ability has resolved this turn'), 1],
  [P('this is the second time this ability has resolved this turn'), 2],
  [P('this is the third time this ability has resolved this turn'), 3],
  [P('this is the fourth time this ability has resolved this turn'), 4],
  [P('this is the fifth time this ability has resolved this turn'), 5],
];
const W_RESOLVED_AGAIN: [string[], number][] = [
  [P("it's the second time"), 2], [P('it is the second time'), 2],
  [P("it's the third time"), 3], [P('it is the third time'), 3],
  [P("it's the fourth time"), 4], [P('it is the fourth time'), 4],
  [P("it's the fifth time"), 5], [P('it is the fifth time'), 5],
];
const W_RESOLVED_FIRST_OR_SECOND = P('this is the first or second time this ability has resolved this turn');
const resolvedTimes = (op: NumberCmp['op'], n: number): Condition => ({ cond: 'compare', left: { q: 'resolvedThisTurn' }, op, right: n });
/** The dungeon cards (CR 309; core/dungeons.json), by name, for "you've completed <dungeon>". */
const DUNGEON_NAMES = ['Dungeon of the Mad Mage', 'Lost Mine of Phandelver', 'Tomb of Annihilation', 'Undercity'];
const W_COMPLETED = [P("you've completed")];
const W_NOT_COMPLETED = [P("you haven't completed")];
const W_A_DUNGEON = P('a dungeon');
const W_DUNGEON_NAMES = DUNGEON_NAMES.map((n) => ({ name: n, words: P(n) }));
const W_BLESSING = P("you have the city 's blessing");
/** FAST5X E18 (Storied reminder text): "you have an enduring story", and its negation. */
const W_STORY = [P('you have an enduring story')];
const W_NO_STORY = [P("you don't have an enduring story"), P('you do not have an enduring story')];
/** FAST5X-4 (CR 702.179e): "you have max speed" (speed 4), and its negation. */
const W_MAX_SPEED = [P('you have max speed')];
const W_NOT_MAX_SPEED = [P("you don't have max speed"), P('you do not have max speed')];
const W_IS = [P('is'), P('are')];
const W_IS_ATTACHED_TO = P('is attached to');
/** std-ru: the value of `~` as the Obj hole reads it (the source itself, nothing else). */
const isSelfRef = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 1 && (v as { ref?: unknown }).ref === 'self';
const W_NO_SPELLS_LAST_TURN = P('no spells were cast last turn'); // M6-4
const W_COUNTERS_ON = P('counters on'); // M6-4
const W_A_PLAYER_CAST = P('a player cast'); // M6-4
const W_SPELLS_LAST_TURN = P('spells last turn'); // M6-4
const W_HAS = [P('has'), P('have')];
const W_WITH_DIFFERENT_POWERS = P('with different powers'); // CLOUD std-misc
// MX3 (CR 701.54a, 701.54e): "~ is your Ring-bearer"; "you chose a creature other than ~ as your Ring-bearer" (the creature chosen as the Ring tempted you, the
// event's subject: core/ring.ts emits it; none when no creature could be chosen, and then the condition is false)
const W_YOUR_RING_BEARER = P('your ring-bearer');
const W_CHOSE_OTHER_BEARER = P('you chose a creature other than ~ as your ring-bearer');

const W_IN_COMMAND_OR_BATTLEFIELD = P('is in the command zone or on the battlefield'); // M11-4
/** M11-4 (CR 113.6b): "~ is in the command zone or on the battlefield" (eminence). The same value parser/lower/ability.ts#EMINENCE_ZONES looks for. */
export const EMINENCE_COND: Condition = { cond: 'exists', of: { ref: 'each', filter: { self: true, zone: ['command', 'battlefield'] } } };

const exists = (filter: ObjectFilter, atLeast?: Quantity): Condition => ({ cond: 'exists', of: { ref: 'each', filter }, ...(atLeast !== undefined ? { atLeast } : {}) });
const notExists = (filter: ObjectFilter): Condition => ({ cond: 'not', of: exists(filter) });
const compare = (left: Quantity, op: NumberCmp['op'], right: Quantity): Condition => ({ cond: 'compare', left, op, right });

/**
 * CLOUD std-dft (CR 122.1, 107.1): "it has an even / odd number of counters on it": the number of counters of every kind on the object, compared by its parity
 * (zero is even). Stated with the quantities the engine already evaluates: n - 2 * floor(n / 2) is 0 for an even n and 1 for an odd one (effects/eval.ts).
 */
export function counterParity(object: unknown, odd: boolean): Condition {
  const n: Quantity = { q: 'counters', on: object as never, kind: 'any' };
  return compare({ q: 'math', op: '-', args: [n, { q: 'math', op: '*', args: [2, { q: 'math', op: 'floorDiv', args: [n, 2] }] }] }, '==', odd ? 1 : 0);
}
const W_EVEN_COUNTERS_ON_IT = P('an even number of counters on it');
const W_ODD_COUNTERS_ON_IT = P('an odd number of counters on it');

function withController(f: ObjectFilter, pred: PlayerPred): ObjectFilter | null {
  return mergeFilter(f, { controller: pred });
}

const W_COMMANDER_THATS = P("commander that's");
/** CMD2: "commander that's a creature", "commander that's a creature or planeswalker" (card types, CR 205.2a), from `pos` (after "a"). */
function commanderThatsTypes(ctx: HoleCtx, pos: number): { end: number; types: string[] }[] {
  const e = phraseAt(ctx, pos, W_COMMANDER_THATS);
  if (e < 0 || (ctx.toks[e]?.norm !== 'a' && ctx.toks[e]?.norm !== 'an')) return [];
  const type = (p: number): string | undefined => { const ty = ctx.toks[p]?.kind === 'WORD' ? ctx.vocab.types.get(ctx.toks[p]!.norm) : undefined; return ty !== undefined && !ty.plural ? ty.name : undefined; };
  const first = type(e + 1);
  if (first === undefined) return [];
  const out = [{ end: e + 2, types: [first] }];
  const second = ctx.toks[e + 2]?.norm === 'or' ? type(e + 3) : undefined;
  if (second !== undefined && second !== first) out.push({ end: e + 4, types: [first, second] });
  return out;
}

const W_A_PLAYER_CONTROLS_NO = P('a player controls no'); // std-rx31
const W_YOUR_OPPONENTS_CONTROL_NO = P('your opponents control no'); // opp-port-1
const W_NO_OPPONENT_CONTROLS = P('no opponent controls'); // opp-port-1

/** "you control ...", "an opponent controls ...", "you don't control ...". */
function control(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  // std-rx31 (CR 102.1, 603.4, 608.2h): "if a player controls no creatures" (Sothera, the Supervoid): at least one player, each judged alone, controls none of them
  // (`countPlayers.controlsIs` of std-rx12 with "none"); the description says nothing of a controller (the player counted supplies it)
  const pn = phraseAt(ctx, pos, W_A_PLAYER_CONTROLS_NO);
  if (pn >= 0) {
    for (const n of npAlts(ctx, pn)) {
      if (n.number !== 'plural' || n.filter.controller !== undefined) continue;
      const count = { q: 'countPlayers', of: { ref: 'each', who: 'player' }, controlsIs: { filter: n.filter, op: '==', n: 0 } };
      out.push({ end: n.end, value: { cond: 'compare', left: count, op: '>=', right: 1 } as unknown as Condition, ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
    }
  }
  // opp-port-1 (OPP2's follow-up of 2026-10-17; CR 102.3, 603.4): "your opponents control no creatures" (Erebos's Titan, Kezzerdrix) and "no opponent controls a
  // creature" (Vexing Beetle, Kavu Runner): no opponent controls one of them, a negated existence over every opponent's permanents ("an opponent controls no
  // creatures" is one opponent who controls none, below)
  const yn = phraseAt(ctx, pos, W_YOUR_OPPONENTS_CONTROL_NO);
  if (yn >= 0) {
    for (const n of npAlts(ctx, yn)) {
      const f = n.number === 'plural' ? withController(n.filter, 'opponent') : null;
      if (f) out.push({ end: n.end, value: notExists(f), ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
    }
  }
  const na = phraseAt(ctx, pos, W_NO_OPPONENT_CONTROLS);
  if (na >= 0 && (ctx.toks[na]?.norm === 'a' || ctx.toks[na]?.norm === 'an')) {
    for (const n of npAlts(ctx, na + 1)) {
      const f = n.number === 'singular' ? withController(n.filter, 'opponent') : null;
      if (f) out.push({ end: n.end, value: notExists(f), ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
    }
  }
  const subj: { end: number; pred: PlayerPred; neg: boolean }[] = [];
  const a = phraseAt(ctx, pos, W_YOU_CONTROL); if (a >= 0) subj.push({ end: a, pred: 'you', neg: false });
  for (const w of W_YOU_DONT_CONTROL) { const e = phraseAt(ctx, pos, w); if (e >= 0) subj.push({ end: e, pred: 'you', neg: true }); }
  const o = phraseAt(ctx, pos, W_AN_OPPONENT_CONTROLS); if (o >= 0) subj.push({ end: o, pred: 'opponent', neg: false });
  // cloud std-dsk (CR 506.2, 603.4): "defending player controls no Glimmer creatures" only: the positive forms ("unless defending player controls an Island") are read by
  // the templates of rst.t16.cantattack.unless.defending.controls and their family in their own JSON, so a second reading here would be ambiguous (guard G5)
  for (const w of W_DEFENDING_CONTROLS) {
    const e = phraseAt(ctx, pos, w);
    const no = e >= 0 ? phraseAt(ctx, e, W_NO) : -1;
    if (no >= 0) for (const n of npAlts(ctx, no)) { const f = withController(n.filter, { ref: 'defending' }); if (f) out.push({ end: n.end, value: notExists(f), ...(n.flags.length > 0 ? { flags: n.flags } : {}) }); }
  }
  for (const s of subj) {
    const t = ctx.toks[s.end]?.norm;
    const push = (end: number, c: Condition, flags?: string[]): void => { out.push({ end, value: s.neg ? { cond: 'not', of: c } : c, ...(flags && flags.length > 0 ? { flags } : {}) }); };
    if (t === 'a' || t === 'an') for (const n of npAlts(ctx, s.end + 1)) { const f = n.number === 'singular' ? withController(n.filter, s.pred) : null; if (f) push(n.end, exists(f), n.flags); }
    // FAST5 T62 (CR 303.4b): "you control an enchanted creature": a creature an Aura is attached to (the bare "enchanted creature" is the object the source Aura is attached to)
    if ((t === 'a' || t === 'an') && ctx.toks[s.end + 1]?.norm === 'enchanted') {
      for (const n of npAlts(ctx, s.end + 2)) {
        const f = n.number === 'singular' ? mergeFilter(n.filter, { enchanted: true }) : null;
        const g = f && withController(f, s.pred);
        if (g) push(n.end, exists(g), n.flags);
      }
    }
    if (t === 'another') for (const n of npAlts(ctx, s.end + 1)) { const f = n.number === 'singular' ? withController(n.filter, s.pred) : null; const g = f && mergeFilter(f, { other: true }); if (g) push(n.end, exists(g), n.flags); }
    // M11-4 (CR 903.3d, 903.3e; 702.124e): "you control your commander" (Lieutenant): a commander you own that is a permanent you control
    for (const n of yourCommanderAt(ctx, s.end)) { const f = n.number === 'singular' ? withController(n.filter, s.pred) : null; if (f) push(n.end, exists(f)); }
    // CMD2 (CR 903.3d): "you control a commander that's a creature or planeswalker": a commander permanent you control that has one of those card types
    if (t === 'a') for (const c of commanderThatsTypes(ctx, s.end + 1)) push(c.end, exists({ commander: true, types: c.types, controller: s.pred }));
    const no = phraseAt(ctx, s.end, W_NO);
    if (no >= 0) {
      for (const n of npAlts(ctx, no)) {
        const f = withController(n.filter, s.pred);
        if (!f) continue;
        // opp-port-1 (OPP2 of 2026-10-17; CR 102.3, 806): "an opponent controls no creatures" is one opponent who controls none (`countPlayers.controlsIs`
        // of std-rx12 with "none", as std-rx31's "a player controls no creatures"); that no opponent controls one is "your opponents control no creatures".
        // The two agree in a two-player game only.
        if (s.pred === 'opponent') {
          if (n.filter.controller === undefined) push(n.end, compare({ q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, controlsIs: { filter: n.filter, op: '==', n: 0 } }, '>=', 1), n.flags);
          continue;
        }
        push(n.end, s.neg ? exists(f) : notExists(f), n.flags);
      }
    }
    // FAST5 T62 (CR 603.4, 109.5): "an opponent controls more lands than you": the permanents an opponent controls outnumber yours (the same description counted for each;
    // std-sos review: `countPlayers.controlsVs`, per opponent)
    const more = !s.neg && s.pred === 'opponent' ? phraseAt(ctx, s.end, W_MORE) : -1;
    if (more >= 0) {
      for (const n of npAlts(ctx, more)) {
        if (n.number !== 'plural') continue;
        const than = phraseAt(ctx, n.end, W_THAN_YOU);
        if (than < 0) continue;
        const theirs = withController(n.filter, 'opponent');
        const mine = withController(n.filter, 'you');
        // std-sos review (CR 102.2, 102.3): each opponent is judged alone (at least one opponent controls more than you), never all opponents' permanents together
        if (theirs && mine && n.filter.controller === undefined) {
          push(than, compare({ q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, controlsVs: { filter: n.filter, op: '>', than: { ref: 'you' } } }, '>=', 1), n.flags);
        }
      }
    }
    // "N or more <plural>", "at least N <plural>"
    for (const c of cmpAt(ctx, s.end)) {
      if (c.cmp.op === '==') continue;
      for (const n of npAlts(ctx, c.end)) {
        if (n.number !== 'plural') continue;
        const f = withController(n.filter, s.pred);
        if (!f) continue;
        // opp-port-1 (OPP1 of 2026-10-17; CR 102.3, 806): "an opponent controls two or more creatures" is one opponent who controls that many
        // (`countPlayers.controlsIs`); the permanents of several opponents added up are "your opponents control ...". One or more is the same either way: an existence.
        if (s.pred === 'opponent' && !(c.cmp.op === '>=' && c.cmp.value === 1)) {
          if (typeof c.cmp.value === 'number' && n.filter.controller === undefined) {
            push(n.end, compare({ q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, controlsIs: { filter: n.filter, op: c.cmp.op, n: c.cmp.value } }, '>=', 1), n.flags);
          }
          continue;
        }
        if (c.cmp.op === '>=') push(n.end, exists(f, c.cmp.value), n.flags);
        else if (c.cmp.op === '>') push(n.end, exists(f, { q: 'math', op: '+', args: [c.cmp.value, 1] }), n.flags);
        else push(n.end, compare({ q: 'count', of: { ref: 'each', filter: f } }, c.cmp.op, c.cmp.value), n.flags);
        // CLOUD std-fdn (CR 201.2, 603.4): "you control ten or more Gates with different names" (Maze's End): the number of different names among them
        const dn = c.cmp.op === '>=' ? phraseAt(ctx, n.end, W_WITH_DIFFERENT_NAMES) : -1;
        if (dn >= 0) push(dn, compare({ q: 'distinct', what: 'names', among: { ref: 'each', filter: f } }, '>=', c.cmp.value), n.flags);
        // CLOUD std-misc (coven, CR 207.2c, 208.1): "you control three or more creatures with different powers": that many different powers among them
        const dp = c.cmp.op === '>=' ? phraseAt(ctx, n.end, W_WITH_DIFFERENT_POWERS) : -1;
        if (dp >= 0) push(dp, compare({ q: 'distinct', what: 'powers', among: { ref: 'each', filter: f } }, '>=', c.cmp.value), n.flags);
      }
      // trek-5 (CR 201.2, 603.4; Qty "the number of differently named lands you control", parser/holes/qty.ts): "you control five or more differently named lands" is the
      // number of different names among the lands you control, at least five. Of you only: an opponent's count is one per opponent (CR 102.3)
      const dnm = s.pred === 'you' ? phraseAt(ctx, c.end, W_DIFFERENTLY_NAMED_COND) : -1;
      if (dnm >= 0) {
        for (const n of npAlts(ctx, dnm)) {
          if (n.number !== 'plural') continue;
          const f = withController(n.filter, s.pred);
          if (f) push(n.end, compare({ q: 'distinct', what: 'names', among: { ref: 'each', filter: f } }, c.cmp.op, c.cmp.value), n.flags);
        }
      }
    }
    // std-rx1 (CR 107.1, 603.4): "you control a prime number of lands" (Zimone, All-Questioning): the number of them is prime. Of "you" only, never negated: an
    // opponent's count is one per opponent (CR 102.3), which this does not read
    const prime = s.pred === 'you' && !s.neg ? phraseAt(ctx, s.end, W_A_PRIME_NUMBER_OF) : -1;
    if (prime >= 0) {
      for (const n of npAlts(ctx, prime)) {
        const f = n.number === 'plural' ? withController(n.filter, s.pred) : null;
        if (f) push(n.end, { cond: 'prime', of: { q: 'count', of: { ref: 'each', filter: f } } }, n.flags);
      }
    }
  }
  return out;
}

/**
 * r4-repl (CR 608.2c, 404.1): "there is an instant card and a sorcery card in your graveyard" (Flow State): a card of each description in that zone, the zone
 * said once after the second card (the first card has no zone of its own, the second has one and an owner at most). Two `exists`, both read where the second one
 * reads; a card that is both is never one card of each (no card is an instant and a sorcery, CR 300.1), so the two cards are two cards.
 */
function twoCardsInOneZone(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const a of npAlts(ctx, pos)) {
    if (a.number !== 'singular' || a.filter.zone !== undefined || a.filter.owner !== undefined || a.filter.controller !== undefined || ctx.toks[a.end]?.norm !== 'and') continue;
    const art = ctx.toks[a.end + 1]?.norm;
    if (art !== 'a' && art !== 'an') continue;
    for (const b of npAlts(ctx, a.end + 2)) {
      if (b.number !== 'singular' || b.filter.zone === undefined || b.filter.zone === 'battlefield' || b.filter.controller !== undefined) continue;
      const where: ObjectFilter = { zone: b.filter.zone, ...(b.filter.owner !== undefined ? { owner: b.filter.owner } : {}) };
      const flags = [...a.flags.filter((f) => f !== 'zone-unstated'), ...b.flags];
      out.push({ end: b.end, value: { cond: 'all', of: [exists({ ...a.filter, ...where }), exists(b.filter)] }, ...(flags.length > 0 ? { flags } : {}) });
    }
  }
  return out;
}

/** "there are seven or more cards in your graveyard", "there are no creatures on the battlefield". */
function thereAre(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const lead of W_THERE_ARE) {
    const e = phraseAt(ctx, pos, lead);
    if (e < 0) continue;
    const no = phraseAt(ctx, e, W_NO);
    if (no >= 0) for (const n of npAlts(ctx, no)) out.push({ end: n.end, value: notExists(n.filter), ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
    // p2-counters-state-1 (CR 122.1): "there are no depletion counters on ~" (the depletion lands, Serrated Arrows): not one counter of that kind on the object
    // itself; one named kind only (any kind, "no counters on ~", is not read here)
    if (no >= 0) for (const k of ctx.call('CounterKind', no)) {
      const on = phraseAt(ctx, k.end, W_COUNTERS_ON);
      if (on >= 0 && ctx.toks[on]?.kind === 'SELF') out.push({ end: on + 1, value: compare({ q: 'counters', on: { ref: 'self' }, kind: k.value as string }, '==', 0), ...(k.weak ? { weak: k.weak } : {}) });
    }
    const t = ctx.toks[e]?.norm;
    if (t === 'a' || t === 'an') for (const n of npAlts(ctx, e + 1)) if (n.number === 'singular') out.push({ end: n.end, value: exists(n.filter), ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
    if (t === 'a' || t === 'an') out.push(...twoCardsInOneZone(ctx, e + 1));
    for (const c of cmpAt(ctx, e)) {
      // FAST5X E12 (CR 105.1): "there are five colors among permanents you control" (a Case's "To solve", CR 719.3a): five colors is all of them, so
      // exactly five is five or more; "there are N or more colors among ..." likewise. Any other exact number of colors is not read.
      const col = phraseAt(ctx, c.end, W_COLORS_AMONG);
      if (col >= 0 && (c.cmp.op === '>=' || (c.cmp.op === '==' && c.cmp.value === 5))) {
        for (const f of ctx.call('Filter', col)) out.push({ end: f.end, value: compare({ q: 'distinct', what: 'colors', among: { ref: 'each', filter: f.value as ObjectFilter } }, '>=', c.cmp.value) });
      }
      if (c.cmp.op === '==') continue;
      // M6-4 (the Kamigawa flip cards): "there are two or more ki counters on ~" is the number of counters of that kind on the object itself
      if (c.cmp.op === '>=') for (const k of ctx.call('CounterKind', c.end)) {
        const on = phraseAt(ctx, k.end, W_COUNTERS_ON);
        if (on >= 0 && ctx.toks[on]?.kind === 'SELF') out.push({ end: on + 1, value: compare({ q: 'counters', on: { ref: 'self' }, kind: k.value as string }, '>=', c.cmp.value) });
      }
      // std-rg (CR 122.1, 602.5b): "there are twenty-five or more loyalty counters among Jaces you control" (Jace, Reality Sculptor): the counters of one kind on all the
      // objects described, added up (statics/match.ts, actions/announce-cond.ts); only a plural description
      if (c.cmp.op === '>=') for (const k of ctx.call('CounterKind', c.end)) {
        const am = phraseAt(ctx, k.end, W_COUNTERS_AMONG);
        if (am >= 0) for (const n of npAlts(ctx, am)) {
          if (n.number !== 'plural') continue;
          out.push({ end: n.end, value: compare({ q: 'counters', on: { ref: 'each', filter: n.filter }, kind: k.value as string }, '>=', c.cmp.value), ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
        }
      }
      // FAST5X E13 (delirium, CR 205.2a): "there are four or more card types among cards in your graveyard" (the static form is the T5 template's; this is the
      // same condition anywhere a condition goes, e.g. "Activate only if ...", CR 602.5b)
      // cloud std-dsk (CR 709.5, 709.5c, 201.2): "there are eight or more different names among unlocked doors of Rooms you control": a Room permanent has the names
      // of its unlocked halves only (rules/base-parts/room.ts#roomChars), so the names among the unlocked doors are the names of the Rooms (`distinct` names reads
      // every name of each object); only a description of Rooms and who controls them (a door is a half of a Room, CR 709.5j)
      const dn = c.cmp.op === '>=' ? phraseAt(ctx, c.end, W_NAMES_AMONG_UNLOCKED_DOORS) : -1;
      if (dn >= 0) {
        for (const n of npAlts(ctx, dn)) {
          if (n.number !== 'plural' || !isRoomsOnly(n.filter)) continue;
          out.push({ end: n.end, value: compare({ q: 'distinct', what: 'names', among: { ref: 'each', filter: n.filter } }, '>=', c.cmp.value), ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
        }
      }
      // r4-static (CR 709.5c, 709.5j): "there are two or more unlocked doors among Rooms you control" (Rampaging Soulrager): the unlocked halves of those Room
      // permanents, summed (std-dsk's quantity); only a description of Rooms
      const ud = c.cmp.op === '>=' ? phraseAt(ctx, c.end, W_UNLOCKED_DOORS_AMONG) : -1;
      if (ud >= 0) {
        for (const n of npAlts(ctx, ud)) {
          if (n.number !== 'plural' || !isRoomsOnly(n.filter)) continue;
          out.push({ end: n.end, value: compare({ q: 'unlockedDoors', among: { ref: 'each', filter: n.filter } }, '>=', c.cmp.value), ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
        }
      }
      // r4-static (CR 122.1): "there are three or more different kinds of counters among creatures you control" (Hundred-Battle Veteran): the kinds of counter on
      // any of those objects, each kind once
      const ck = c.cmp.op === '>=' ? phraseAt(ctx, c.end, W_COUNTER_KINDS_AMONG) : -1;
      if (ck >= 0) {
        for (const n of npAlts(ctx, ck)) {
          if (n.number !== 'plural') continue;
          out.push({ end: n.end, value: compare({ q: 'distinct', what: 'counterKinds', among: { ref: 'each', filter: n.filter } }, '>=', c.cmp.value), ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
        }
      }
      const among = c.cmp.op === '>=' ? phraseAt(ctx, c.end, W_CARD_TYPES_AMONG) : -1;
      if (among >= 0) {
        for (const n of npAlts(ctx, among)) {
          if (n.number !== 'plural') continue;
          out.push({ end: n.end, value: compare({ q: 'distinct', what: 'cardTypes', among: { ref: 'each', filter: n.filter } }, '>=', c.cmp.value), ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
        }
      }
      for (const n of npAlts(ctx, c.end)) {
        if (n.number !== 'plural') continue;
        if (c.cmp.op === '>=') out.push({ end: n.end, value: exists(n.filter, c.cmp.value), ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
        else if (c.cmp.op === '>') out.push({ end: n.end, value: exists(n.filter, { q: 'math', op: '+', args: [c.cmp.value, 1] }) });
        else out.push({ end: n.end, value: compare({ q: 'count', of: { ref: 'each', filter: n.filter } }, c.cmp.op, c.cmp.value) });
      }
    }
  }
  return out;
}

/**
 * r5-fxb (CR 103.4, 119.1, 107.1): "your life total is less than or equal to half your starting life total" (Cecil, Dark Knight; Myrkul, Lord of Bones): a life total
 * is a whole number, so it is at most half the starting life total exactly when it is at most that half rounded down (no rounding is stated, and none is needed).
 */
const W_LIFE_AT_MOST_HALF_STARTING = P('your life total is less than or equal to half your starting life total');
function lifeAtMostHalfStarting(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_LIFE_AT_MOST_HALF_STARTING);
  return e < 0 ? [] : [{ end: e, value: compare({ q: 'life', of: { ref: 'you' } }, '<=', { q: 'math', op: 'floorDiv', args: [{ q: 'startingLife' }, 2] }) }];
}

/**
 * std-rh (CR 103.4, 119.1, 107.1): "your life total is at least 10 greater than your starting life total" (Elenda, Saint of Dusk): the same comparison as the
 * T60 reading of "you have at least 10 life more than your starting life total" (a life total is a whole number: at least N above the starting life total).
 */
const W_YOUR_LIFE_TOTAL_IS = P('your life total is');
const W_GREATER_THAN_STARTING = [P('greater than your starting life total'), P('more than your starting life total')];
function lifeAtLeastNAboveStarting(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const e = phraseAt(ctx, pos, W_YOUR_LIFE_TOTAL_IS);
  if (e < 0) return out;
  for (const c of cmpAt(ctx, e)) {
    if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number' || c.cmp.value < 1) continue;
    for (const w of W_GREATER_THAN_STARTING) {
      const m = phraseAt(ctx, c.end, w);
      if (m >= 0) out.push({ end: m, value: compare({ q: 'life', of: { ref: 'you' } }, '>=', { q: 'math', op: '+', args: [{ q: 'startingLife' }, c.cmp.value] }) });
    }
  }
  return out;
}

/** "you have 5 or less life", "you have no cards in hand", "you have seven or more cards in hand". */
function youHave(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const e = phraseAt(ctx, pos, W_YOU_HAVE);
  if (e < 0) return out;
  const life: Quantity = { q: 'life', of: { ref: 'you' } };
  const hand: Quantity = { q: 'zoneSize', zone: 'hand', of: { ref: 'you' } };
  for (const c of cmpAt(ctx, e)) {
    const l = phraseAt(ctx, c.end, W_LIFE);
    if (l >= 0 && c.cmp.op !== '==') out.push({ end: l, value: compare(life, c.cmp.op, c.cmp.value) });
    // p2-modal-1 (CR 119.1; unverified cite): "you have exactly 13 life" (Disciple of Perdition): a life total equal to a number, only with "exactly" (a bare "you have 13 life" stays unread)
    if (l >= 0 && c.cmp.op === '==' && phraseAt(ctx, e, W_EXACTLY) >= 0) out.push({ end: l, value: compare(life, '==', c.cmp.value) });
    for (const w of W_CARDS_IN_HAND) { const h = phraseAt(ctx, c.end, w); if (h >= 0 && c.cmp.op !== '==') out.push({ end: h, value: compare(hand, c.cmp.op, c.cmp.value) }); }
  }
  // FAST5 T60 (CR 103.4): "you have at least 7 life more than your starting life total": at least N above the starting life total
  for (const c of cmpAt(ctx, e)) {
    const m = phraseAt(ctx, c.end, W_LIFE_MORE_THAN_STARTING);
    if (m >= 0 && c.cmp.op === '>=' && typeof c.cmp.value === 'number') out.push({ end: m, value: compare(life, '>=', { q: 'math', op: '+', args: [{ q: 'startingLife' }, c.cmp.value] }) });
  }
  const no = phraseAt(ctx, e, W_NO);
  if (no >= 0) for (const w of W_CARDS_IN_HAND) { const h = phraseAt(ctx, no, w); if (h >= 0) out.push({ end: h, value: compare(hand, '==', 0) }); }
  // std-lci (CR 119.1, 102.1): "you have the most life or are tied for most life": no opponent has more life than you
  const ml = phraseAt(ctx, e, W_MOST_LIFE_OR_TIED);
  if (ml >= 0) out.push({ end: ml, value: compare({ q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, lifeVs: { op: '>', than: { ref: 'you' } } }, '==', 0) });
  const bl = phraseAt(ctx, pos, W_BLESSING);
  if (bl >= 0) out.push({ end: bl, value: { cond: 'designation', who: { ref: 'you' }, what: 'citysBlessing' } });
  return out;
}

function misc(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const add = (words: readonly (readonly string[])[], v: Condition): void => { for (const w of words) { const e = phraseAt(ctx, pos, w); if (e >= 0) out.push({ end: e, value: v }); } };
  add(W_ITS_YOUR_TURN, { cond: 'turnOf', whose: 'you' });
  add(W_ITS_NOT_YOUR_TURN, { cond: 'not', of: { cond: 'turnOf', whose: 'you' } });
  add([P("it's an opponent 's turn")], { cond: 'turnOf', whose: 'opponent' });
  // CLOUD std-dft (CR 500.1, 603.4): "if it's not their turn": the turn of the player an earlier phrase named ("Whenever a player casts a spell, if it's not
  // their turn, ..." reads the caster); "their" is the player anaphor the anaphora pass resolves (lower/anaphora.ts), never the controller of the ability
  const their = anaphorObj({ sort: 'player', number: 'plural', text: 'their' }) as never;
  add(W_ITS_THEIR_TURN, { cond: 'turnOf', whose: their });
  add(W_ITS_NOT_THEIR_TURN, { cond: 'not', of: { cond: 'turnOf', whose: their } });
  // FAST5X E9 (CR 505.1): "it's your main phase" is either main phase of your turn; "then if it isn't your main phase, blight 2"
  add(W_ITS_YOUR_MAIN, { cond: 'turnOf', whose: 'you', step: [...MAIN_PHASES] });
  // Standard round 4, r4-trig (CR 500.8, 505.1a): "if it's the first combat phase of the turn" (Genji Glove): the combat in progress is the turn's first
  add([P("it's the first combat phase of the turn"), P('it is the first combat phase of the turn')], { cond: 'firstCombat' });
  add(W_ITS_NOT_YOUR_MAIN, { cond: 'not', of: { cond: 'turnOf', whose: 'you', step: [...MAIN_PHASES] } });
  add(W_ITS_YOUR_COMBAT, { cond: 'turnOf', whose: 'you', step: [...COMBAT_STEPS] }); // r4-fxb (CR 506.1)
  // r4-fxb (CR 500.9, 513.1): "it's the first end step of the turn": exactly one end step has begun this turn (the current one; an added end step is the second)
  add(W_FIRST_END_STEP, { cond: 'happened', event: { ev: 'step', step: 'end' }, scope: 'turn', times: { op: '==', value: 1 } });
  add(W_MONARCH, { cond: 'designation', who: { ref: 'you' }, what: 'monarch' });
  // M12-3 (CR 724.1; Queen Marchesa): "an opponent is the monarch": one of the opponents still in the game is (effects/eval.ts#designation: any of `who`)
  add(W_OPPONENT_MONARCH, { cond: 'designation', who: { ref: 'each', who: 'opponent' }, what: 'monarch' });
  add(W_MAX_SPEED, { cond: 'designation', who: { ref: 'you' }, what: 'maxSpeed' }); // FAST5X-4, CR 702.179e
  add(W_NOT_MAX_SPEED, { cond: 'not', of: { cond: 'designation', who: { ref: 'you' }, what: 'maxSpeed' } });
  add(W_STORY, { cond: 'designation', who: { ref: 'you' }, what: 'enduringStory' }); // FAST5X E18 (Storied reminder text)
  add(W_NO_STORY, { cond: 'not', of: { cond: 'designation', who: { ref: 'you' }, what: 'enduringStory' } });
  add(W_INITIATIVE, { cond: 'designation', who: { ref: 'you' }, what: 'initiative' }); // MX4, CR 726.1
  for (const [w, n] of [...W_RESOLVED_NTH, ...W_RESOLVED_AGAIN]) add([w], resolvedTimes('==', n)); // FAST5X E17 (CR 608.2)
  add([W_RESOLVED_FIRST_OR_SECOND], resolvedTimes('<=', 2));
  // MX4, CR 309.7: a dungeon completed this game, any one or the named one
  for (const [lead, neg] of [...W_COMPLETED.map((w) => [w, false] as const), ...W_NOT_COMPLETED.map((w) => [w, true] as const)]) {
    const e = phraseAt(ctx, pos, lead);
    if (e < 0) continue;
    const wrap = (c: Condition): Condition => (neg ? { cond: 'not', of: c } : c);
    const a = phraseAt(ctx, e, W_A_DUNGEON);
    if (a >= 0) out.push({ end: a, value: wrap({ cond: 'completedDungeon', who: { ref: 'you' } }) });
    for (const d of W_DUNGEON_NAMES) { const n = phraseAt(ctx, e, d.words); if (n >= 0) out.push({ end: n, value: wrap({ cond: 'completedDungeon', who: { ref: 'you' }, name: d.name }) }); }
  }
  add([W_CHOSE_OTHER_BEARER], { cond: 'matches', object: { ref: 'event', role: 'subject' }, filter: { other: true } });
  for (const [ws, not] of [[W_DID, false], [W_DIDNT, true]] as const) {
    for (const w of ws) { const e = phraseAt(ctx, pos, w); if (e >= 0) out.push({ end: e, value: { cond: 'did', step: '', $step: 'previous', ...(not ? { not: true } : {}) } }); }
  }
  // STD-OTJ (CR 608.2d): "if you can't" after a move that is not optional: the move put nothing anywhere (lower/conditions.ts#resolveDid insists on a move right before it)
  for (const w of W_CANT) { const e = phraseAt(ctx, pos, w); if (e >= 0) out.push({ end: e, value: { cond: 'did', step: '', $step: 'previous', not: true, $cant: true } as unknown as Condition }); }
  for (const w of W_DIDNT_DRAW) { const e = phraseAt(ctx, pos, w); if (e >= 0) out.push({ end: e, value: { cond: 'did', step: '', $step: 'drawThisWay', not: true } as unknown as Condition }); }
  for (const w of W_DIDNT_CAST_THIS_WAY) { const e = phraseAt(ctx, pos, w); if (e >= 0) out.push({ end: e, value: { cond: 'did', step: '', $step: 'previous', not: true, $cast: true } as unknown as Condition }); } // std-rj
  // std-rx32 (CR 701.3a-b, 603.12): "When one or more Equipment become attached to that creature this way, ...": the attach right before it attached at least one
  // object (lower/conditions.ts#attachedThisWay; already attached objects don't become attached, CR 701.3b)
  const oom = phraseAt(ctx, pos, W_ONE_OR_MORE);
  if (oom >= 0) for (const n of npAlts(ctx, oom)) {
    if (n.number !== 'plural' && JSON.stringify(n.filter.subtypes) !== '["Equipment"]') continue;
    const e = phraseAt(ctx, n.end, W_BECOME_ATTACHED_THIS_WAY);
    if (e >= 0 && n.flags.length === 0) out.push({ end: e, value: { cond: 'did', step: '', $step: 'attachedThisWay', $which: n.filter } as unknown as Condition });
  }
  for (const w of W_DREW_ANY) { const e = phraseAt(ctx, pos, w); if (e >= 0) out.push({ end: e, value: { cond: 'did', step: '', $step: 'drewThisWay' } as unknown as Condition }); } // std-rx3
  // std-tdm (CR 401.1, 404.1 style zone counts): "your library has no cards in it" is "there are no cards in your library" (the same condition, one reading each)
  const lib = phraseAt(ctx, pos, W_LIBRARY_NO_CARDS);
  if (lib >= 0) out.push({ end: lib, value: { cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { zone: 'library', owner: 'you', isCard: true } } } } });
  out.push(...destroyedThisWay(ctx, pos)); // FAST5X E17
  out.push(...countersPutThisWay(ctx, pos)); // trek-6
  out.push(...putIntoHandThisWay(ctx, pos)); // FAST5 T75
  out.push(...milledThisWayCond(ctx, pos)); // std-tla
  out.push(...revealedThisWayCond(ctx, pos)); // p2-dig-2
  out.push(...allExiledShareCond(ctx, pos)); // trek-9
  out.push(...returnedThisWay(ctx, pos)); // STD-OTJ
  out.push(...searchedThisWay(ctx, pos)); // r4-moved
  out.push(...returnedToYourHandThisWay(ctx, pos)); // r4-moved
  // Cloud C7 (CR 608.2c, 608.2h): "a creature card was exiled this way", "you exiled a land card this way", "you put an artifact onto the battlefield this way"; one reader
  // for these words in the merge of wave 2: it took over std-fin's exiledThisWay ("a <card> was exiled this way", the same condition) and std-lci's youExiledThisWay
  // ("you exiled a <card> this way", the same meaning as a `did` on the exile; with C7's rule that YOU performed the move, lower/conditions.ts#performedByYou)
  out.push(...movedCondAt(ctx, pos));
  // FAST5X E17 (CR 601.2i): "you controlled a Mount as you cast ~": decided when the spell became cast (actions/cast-checks.ts)
  const ycc = phraseAt(ctx, pos, W_YOU_CONTROLLED_NP);
  const yccArt = ycc >= 0 ? ctx.toks[ycc]?.norm : undefined;
  if (yccArt === 'a' || yccArt === 'an') for (const n of npAlts(ctx, ycc + 1)) {
    if (n.number !== 'singular' || n.flags.length > 0 || n.filter.controller !== undefined) continue;
    const as = phraseAt(ctx, n.end, W_AS_YOU_CAST);
    const f = mergeFilter(n.filter, { controller: 'you' });
    if (as >= 0 && f && ctx.toks[as]?.kind === 'SELF') out.push({ end: as + 1, value: { cond: 'asCast', held: { cond: 'exists', of: { ref: 'each', filter: f } } } });
  }
  // std-rn (CR 601.2i, 505.1; addendum): "you cast ~ during your main phase": whether it was a main phase of your turn when the spell became cast, decided then
  // and kept on the spell like the other "as you cast" conditions (actions/cast-checks.ts); a copy that was not cast has no record (false)
  const ycm = phraseAt(ctx, pos, W_YOU_CAST);
  if (ycm >= 0 && ctx.toks[ycm]?.kind === 'SELF') {
    const dm = phraseAt(ctx, ycm + 1, W_DURING_YOUR_MAIN);
    if (dm >= 0) out.push({ end: dm, value: { cond: 'asCast', held: { cond: 'turnOf', whose: 'you', step: [...MAIN_PHASES] } } });
  }
  // FAST5X E1 (CR 702.174k, 702.174b, 607.2i-j): "the gift was promised": the gift cost of this object's spell was paid (the cast record's `gift` cost)
  add(W_GIFT_PROMISED, { cond: 'wasCast', kicked: 'gift' });
  add(W_GIFT_NOT_PROMISED, { cond: 'not', of: { cond: 'wasCast', kicked: 'gift' } });
  // FAST5X E12 (CR 701.59c, 607.2i): the linked "as an additional cost to cast this spell, you may collect evidence N" (its cost is named `collectEvidence`,
  // templates zz-fast5x/e12.json) was paid for this object's spell
  add(W_EVIDENCE_COLLECTED, { cond: 'wasCast', kicked: 'collectEvidence' });
  // cast history of this object (CR 607.2i-j: kicker and other cast-time facts)
  if (ctx.toks[pos]?.kind === 'SELF') {
    // FAST5X E1 (CR 702.166b): "~ was bargained" / "this spell was bargained"
    const bg = phraseAt(ctx, pos + 1, W_WAS_BARGAINED);
    if (bg >= 0) out.push({ end: bg, value: { cond: 'wasCast', kicked: 'bargain' } });
    const ft = phraseAt(ctx, pos + 1, W_WAS_FORETOLD); // cloud r3-mech (CR 702.143a): "~ was foretold"
    if (ft >= 0) out.push({ end: ft, value: { cond: 'wasCast', via: 'foretell' } });
    // FAST5X E9 (CR 118.8, 601.2b, 607.2i): "~'s additional cost was paid": the spell's optional additional cost without a keyword name was paid (the cast
    // record names it `additional`, actions/cast-costs.ts#announceOptionalCosts)
    const ac = phraseAt(ctx, pos + 1, W_ADDITIONAL_COST_PAID);
    if (ac >= 0) out.push({ end: ac, value: { cond: 'wasCast', kicked: UNNAMED_ADDITIONAL } });
    for (const w of W_ADDITIONAL_COST_NOT_PAID) { const e = phraseAt(ctx, pos + 1, w); if (e >= 0) out.push({ end: e, value: { cond: 'not', of: { cond: 'wasCast', kicked: UNNAMED_ADDITIONAL } } }); }
    for (const w of W_WASNT_BARGAINED) { const e = phraseAt(ctx, pos + 1, w); if (e >= 0) out.push({ end: e, value: { cond: 'not', of: { cond: 'wasCast', kicked: 'bargain' } } }); }
    const k = phraseAt(ctx, pos + 1, W_WAS_KICKED);
    if (k >= 0) out.push({ end: k, value: { cond: 'wasCast', kicked: true } });
    // p2-counters-state-1 (CR 702.33f): "~ was kicked with its {1}{R} kicker": that one kicker cost was paid (parser/holes/p2cs1.ts, a marker the face resolves)
    const kw = k >= 0 ? kickedWithCost(ctx, k) : null;
    if (kw !== null) out.push({ end: kw.end, value: { cond: 'wasCast', kicked: kw.mark } });
    // M6-5 (CR 702.33d): "~ was kicked twice" (two kicker costs or multikicker): the kicks counted by `kickCount`
    if (k >= 0 && phraseAt(ctx, k, W_TWICE) >= 0) out.push({ end: k + 1, value: { cond: 'compare', left: { q: 'kickCount' }, op: '>=', right: 2 } });
    for (const w of W_WASNT_KICKED) { const e = phraseAt(ctx, pos + 1, w); if (e >= 0) out.push({ end: e, value: { cond: 'not', of: { cond: 'wasCast', kicked: true } } }); }
    // M6-5 (CR 702.138b): "~ escaped": it was cast from a graveyard with its escape ability (the cast record's alternative cost)
    const esc = phraseAt(ctx, pos + 1, W_ESCAPED);
    if (esc >= 0) out.push({ end: esc, value: { cond: 'wasCast', via: 'escape' } });
    const wc = phraseAt(ctx, pos + 1, P('was cast from'));
    if (wc >= 0) for (const z of ctx.call('Zone', wc)) out.push({ end: z.end, value: { cond: 'wasCast', from: (z.value as { zone: never }).zone } });
    // r4-fxz (CR 601.2a, 707.10): "~ was cast from anywhere other than your hand": cast from one of the zones a card is cast from but the hand (FAST5 T70's
    // condition, render/cond.ts#castElsewherePhrase); a spell that was not cast (a copy) was cast from none of them. Weak, so T70's own sentence template keeps
    // its sentence (the same JSON) and this reading only fills the sentences no template names
    const elsewhere = phraseAt(ctx, pos + 1, W_CAST_ELSEWHERE);
    if (elsewhere >= 0) out.push({ end: elsewhere, weak: 1, value: { cond: 'any', of: ['graveyard', 'exile', 'library', 'command'].map((from) => ({ cond: 'wasCast', from })) } as unknown as Condition });
    // r4-repl (CR 601.2a, 614.15, 707.10): "~ wasn't cast from your hand": the negation of the cast record's zone; a copy, or a spell cast from another zone,
    // was not (the renderer already says it, render/cond.ts#wasCast)
    for (const w of W_WASNT) {
      const e = phraseAt(ctx, pos + 1, w);
      const f = e >= 0 ? phraseAt(ctx, e, P('cast from')) : -1;
      if (f >= 0) for (const z of ctx.call('Zone', f)) out.push({ end: z.end, value: { cond: 'not', of: { cond: 'wasCast', from: (z.value as { zone: never }).zone } } });
    }
    // cloud std-spm (CR 601.2i, 603.4, 400.7d): "~ was cast" (Anti-Venom's "When Anti-Venom enters, if he was cast, ..."): the object itself is a spell that was
    // cast, or the permanent such a spell became (the cast record of `wasCast`); a permanent put onto the battlefield, or a copy (CR 707.10), was not
    const wcs = phraseAt(ctx, pos + 1, W_WAS_CAST);
    if (wcs >= 0) out.push({ end: wcs, value: { cond: 'wasCast' } });
    // M11-4 (eminence; CR 113.6b, 603.4, 400.7): "~ is in the command zone or on the battlefield": the source object itself is still in one of those zones (a
    // new object after any zone change, so a commander cast from the command zone in response is not). parser/lower/ability.ts gives the ability those zones.
    const cz = phraseAt(ctx, pos + 1, W_IN_COMMAND_OR_BATTLEFIELD);
    if (cz >= 0) out.push({ end: cz, value: JSON.parse(JSON.stringify(EMINENCE_COND)) as Condition });
  }
  // M6-5a: "it was kicked" (CR 702.33d), the intervening "if" of "When ~ enters, if it was kicked, ..." (CR 603.4). `wasCast` reads the cast history of the
  // ability's own object only, so the pronoun must name that object: `$self` holds the anaphor, and parser/lower/ability.ts#resolveCondAnaphors keeps the
  // reading only when it resolves to `{ref:'self'}` (the object's own enters trigger, CR 603.6a). Anywhere else the marker is left over and the sentence stays
  // manual (parser/lower/util.ts#leftoverMarker).
  if (ctx.toks[pos]?.norm === 'it') {
    const it = anaphorObj({ sort: 'object', number: 'singular', text: 'it' });
    const k = phraseAt(ctx, pos + 1, W_WAS_KICKED);
    if (k >= 0) out.push({ end: k, value: { cond: 'wasCast', kicked: true, $self: it } });
    // p2-counters-state-1 (CR 702.33f): "it was kicked with its {G} kicker" (the battlemages' intervening "if"), with the same `$self` rule
    const kw = k >= 0 ? kickedWithCost(ctx, k) : null;
    if (kw !== null) out.push({ end: kw.end, value: { cond: 'wasCast', kicked: kw.mark, $self: it } });
    // M6-5 (CR 702.33d): "it was kicked twice" (Archangel of Wrath), with the same `$self` rule as "it was kicked"
    if (k >= 0 && phraseAt(ctx, k, W_TWICE) >= 0) out.push({ end: k + 1, value: { cond: 'compare', left: { q: 'kickCount' }, op: '>=', right: 2, $self: it } });
    // M6-5 (CR 702.138b): "it escaped" ("sacrifice it unless it escaped"), with the same `$self` rule
    const esc = phraseAt(ctx, pos + 1, W_ESCAPED);
    if (esc >= 0) out.push({ end: esc, value: { cond: 'wasCast', via: 'escape', $self: it } });
    for (const w of W_WASNT_KICKED) { const e = phraseAt(ctx, pos + 1, w); if (e >= 0) out.push({ end: e, value: { cond: 'not', of: { cond: 'wasCast', kicked: true, $self: it } } }); }
    // FAST5X E1 (CR 702.166b): "it was bargained", with the same `$self` rule as "it was kicked" ("if it's bargained" of a cost reduction: cm.fast5x.self.less.bargained)
    const bg = phraseAt(ctx, pos + 1, W_WAS_BARGAINED);
    if (bg >= 0) out.push({ end: bg, value: { cond: 'wasCast', kicked: 'bargain', $self: it } });
    // cloud std-spm (CR 601.2i, 603.4): "it was cast" ("When this creature enters, if it was cast, ..."), with the same `$self` rule as "it was kicked"
    const wcs = phraseAt(ctx, pos + 1, W_WAS_CAST);
    if (wcs >= 0) out.push({ end: wcs, value: { cond: 'wasCast', $self: it } });
    // Standard round 4, r4-trig (CR 601.2a, 603.4, 400.7d; Rocket-Powered Goblin Glider): "it was cast from your graveyard", the zone of the cast record ("~ was cast
    // from", above), with the same `$self` rule as "it was kicked"
    const wcf = phraseAt(ctx, pos + 1, P('was cast from'));
    if (wcf >= 0) {
      for (const z of ctx.call('Zone', wcf)) {
        const zv = z.value as { zone: never; owner?: unknown };
        if (zv.owner !== undefined && zv.owner !== 'you') continue;
        out.push({ end: z.end, value: { cond: 'wasCast', from: zv.zone, ...(zv.owner === 'you' && zv.zone !== 'hand' ? { fromOwner: 'you' } : {}), $self: it } });
      }
    }
  }
  // FAST4 T27 (CR 601.2a, 603.4): "you cast it", the intervening "if" of "When ~ enters, if you cast it, ...": the object was cast, by the controller of the
  // ability (`by`). The pronoun must name the object itself (`$self`, as "it was kicked" above): anywhere else the reading stays manual
  const yci = phraseAt(ctx, pos, P('you cast it'));
  if (yci >= 0) out.push({ end: yci, value: { cond: 'wasCast', by: 'you', $self: anaphorObj({ sort: 'object', number: 'singular', text: 'it' }) } });
  // Standard round P (CR 601.2a, 603.4, 608.3; Dread Cacodemon): "you cast it from your hand", the intervening "if" of "When this creature enters, if you cast
  // it from your hand, ...": the cast record's zone, as "it was cast from your hand" above (the permanent's controller is the player who cast the spell, CR
  // 608.3, and a spell is cast from its caster's own hand, CR 601.2a), with the same `$self` rule as "it was kicked"
  if (yci >= 0 && phraseAt(ctx, pos, P('you cast it from')) >= 0) {
    for (const z of ctx.call('Zone', yci + 1)) {
      const zv = z.value as { zone: never; owner?: unknown };
      if (zv.owner !== 'you') continue;
      // (weak, design 6.3 rule 2: FAST3 T15's "~ enters with ... counter[s] on it if you cast it from your hand" keeps its sentence, the Myojin)
      out.push({ end: z.end, weak: 1, value: { cond: 'wasCast', from: zv.zone, ...(zv.zone !== 'hand' ? { fromOwner: 'you' } : {}), $self: anaphorObj({ sort: 'object', number: 'singular', text: 'it' }) } });
    }
  }
  // FAST5 T64 (CR 601.2a, 603.4): "you cast ~" (the object named by its name: "When Ran and Shaw enter, if you cast them", the plural pronoun read as "~" by
  // parser/front/selfref.ts#pluralPronounRefs): the same cast record, the object itself and no pronoun to resolve
  const ycs = phraseAt(ctx, pos, P('you cast ~'));
  if (ycs >= 0) out.push({ end: ycs, value: { cond: 'wasCast', by: 'you' } });
  const yc = phraseAt(ctx, pos, P('you cast ~ from'));
  if (yc >= 0) for (const z of ctx.call('Zone', yc)) out.push({ end: z.end, value: { cond: 'wasCast', from: (z.value as { zone: never }).zone } });
  // p2-c-cast-zone-1 (CR 113.6m, 603.4, 400.7): "~ is in your graveyard", the intervening "if" of a trigger that functions in the graveyard ("At the beginning of your
  // upkeep, if ~ is in your graveyard, ...", Genesis): the object itself is a card in its owner's graveyard; a card that left the graveyard is a new object, so the
  // condition fails as the ability resolves. Your graveyard only (a card is in its owner's graveyard, CR 400.3)
  if (ctx.toks[pos]?.kind === 'SELF') {
    const isIn = phraseAt(ctx, pos + 1, P('is in'));
    if (isIn >= 0) {
      for (const z of ctx.call('Zone', isIn)) {
        const zv = z.value as { zone: string; owner?: unknown };
        if (zv.zone === 'graveyard' && zv.owner === 'you') out.push({ end: z.end, weak: 1, value: { cond: 'matches', object: { ref: 'self' }, filter: { zone: 'graveyard', owner: 'you' } } });
      }
    }
    // trek-12 (CR 113.6, 602.5b, 400.7; Q, Stacking the Deck): "~ is exiled", the restriction "Activate only ... if ~ is exiled" of an ability a card in exile has: the
    // object itself is in exile (a card that left exile is a new object, CR 400.7). The activation zone follows from it (parser/lower/activation.ts#activationZone)
    const isExiled = phraseAt(ctx, pos + 1, P('is exiled'));
    if (isExiled >= 0) out.push({ end: isExiled, value: { cond: 'matches', object: { ref: 'self' }, filter: { zone: 'exile' } } });
  }
  out.push(...altCostPaid(ctx, pos));
  // FAST5X E11 (CR 701.4b): "a Dragon was beheld": something with that quality was beheld to pay this spell's cost (`CostsPaid.beheld`)
  const art = ctx.toks[pos]?.norm;
  if (art === 'a' || art === 'an') {
    for (const n of npAlts(ctx, pos + 1)) {
      if (n.number !== 'singular') continue;
      const e = phraseAt(ctx, n.end, W_WAS_BEHELD);
      if (e < 0) continue;
      const q: ObjectFilter = { ...n.filter };
      delete q.isCard;
      delete q.zone;
      if (Object.keys(q).length === 0 || !Object.keys(q).every((k) => k === 'types' || k === 'subtypes' || k === 'supertypes')) continue;
      const flags = n.flags.filter((f) => f !== 'zone-unstated');
      out.push({ end: e, value: { cond: 'beheld', quality: q }, ...(flags.length > 0 ? { flags } : {}) });
    }
  }
  return out;
}

const W_WAS_BEHELD = P('was beheld');

/** FAST5X E7: the alternative-cost keywords whose cast record a condition names: "~'s sneak cost was paid" (CR 702.190b), "cast using web-slinging" (CR 702.188a). */
// r4-repl (CR 702.187a, 118.9): also "~'s mayhem cost was paid" (mayhem is the alternative cost named `mayhem`, keywords/data/mayhem.json; cite unverified)
// std-ry7 (CR 702.137b, 118.9): and "~'s spectacle cost was paid" / "its spectacle cost was paid" (spectacle is the alternative cost named `spectacle`,
// keywords/data/spectacle.json; cite unverified); std-ry8 (CR 702.117a-b): the same for surge (keywords/data/surge.json)
const W_COST_PAID: readonly { words: string[]; via: string }[] = [
  { words: P("'s sneak cost was paid"), via: 'sneak' }, { words: P("'s mayhem cost was paid"), via: 'mayhem' }, { words: P("'s spectacle cost was paid"), via: 'spectacle' },
  { words: P("'s surge cost was paid"), via: 'surge' },
];
const W_POSS_COST_PAID: readonly { words: string[]; via: string }[] = [{ words: P('sneak cost was paid'), via: 'sneak' }, { words: P('spectacle cost was paid'), via: 'spectacle' }, { words: P('surge cost was paid'), via: 'surge' }];
const W_CAST_USING: readonly { words: string[]; via: string }[] = [
  { words: P('was cast using web-slinging'), via: 'web-slinging' }, { words: P('were cast using web-slinging'), via: 'web-slinging' },
  { words: P('was cast using sneak'), via: 'sneak' },
];
/** FAST5X E11: the optional additional-cost keywords whose cast record "cast using <keyword>" names (CR 702.194b teamwork). */
const W_CAST_USING_ADDITIONAL: readonly { words: string[]; name: string }[] = [{ words: P('was cast using teamwork'), name: 'teamwork' }];
/** The pronouns Oracle uses for the object itself (a character card is "he", "she" or "they"): read only when they name the object (`$self`). */
const SELF_POSSESSIVES = new Set(['its', 'his', 'her', 'their']);
const SELF_SUBJECTS = new Set(['it', 'he', 'she', 'they']);

/**
 * FAST5X E7 (CR 702.190b, 702.188a, 607.2i-j, 400.7d): "~'s sneak cost was paid" / "his sneak cost was paid" and "~ was cast using web-slinging" / "they were
 * cast using web-slinging": the spell, or the spell the permanent was, was cast for that keyword's alternative cost (`wasCast.via`, the cast record's
 * alternative cost; a copy of the spell keeps it, CR 707.10). A pronoun must name the object itself (`$self`, as "it was kicked"): anywhere else it stays manual.
 */
function altCostPaid(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const t = ctx.toks[pos];
  if (t === undefined) return out;
  const self = anaphorObj({ sort: 'object', number: 'singular', text: 'it' });
  if (t.kind === 'SELF') {
    for (const w of W_COST_PAID) { const e = phraseAt(ctx, pos + 1, w.words); if (e >= 0) out.push({ end: e, value: { cond: 'wasCast', via: w.via } }); }
    // r4-repl (CR 702.190b, 400.7, 608.2c): "~'s sneak cost was paid this turn" (Karai, Future of the Foot): the permanent was cast for its sneak cost and the spell
    // resolved this turn, which is the permanent having entered this turn (sneak casts it in the declare blockers step, and a spell resolves in the turn it is cast;
    // after any other zone change it is a new object with no cast record, CR 400.7)
    for (const w of W_COST_PAID) {
      const e = w.via === 'sneak' ? phraseAt(ctx, pos + 1, w.words) : -1;
      const t = e >= 0 ? phraseAt(ctx, e, P('this turn')) : -1;
      if (t >= 0) out.push({ end: t, value: { cond: 'all', of: [{ cond: 'wasCast', via: w.via }, selfEnteredThisTurn()] } });
    }
    for (const w of W_CAST_USING) { const e = phraseAt(ctx, pos + 1, w.words); if (e >= 0 && w.words[0] === 'was') out.push({ end: e, value: { cond: 'wasCast', via: w.via } }); }
    // FAST5X E11 (CR 702.194b): "~ was cast using teamwork": the caster declared the intention to pay its teamwork cost (an optional additional cost named
    // "teamwork", keywords/data/teamwork.json; the cast record's `additional`)
    for (const w of W_CAST_USING_ADDITIONAL) { const e = phraseAt(ctx, pos + 1, w.words); if (e >= 0) out.push({ end: e, value: { cond: 'wasCast', kicked: w.name } }); }
  }
  if (SELF_POSSESSIVES.has(t.norm)) {
    for (const w of W_POSS_COST_PAID) { const e = phraseAt(ctx, pos + 1, w.words); if (e >= 0) out.push({ end: e, value: { cond: 'wasCast', via: w.via, $self: self } }); }
  }
  if (SELF_SUBJECTS.has(t.norm)) {
    for (const w of W_CAST_USING) {
      if ((w.words[0] === 'were') !== (t.norm === 'they')) continue; // "they were", "it / he / she was"
      const e = phraseAt(ctx, pos + 1, w.words);
      if (e >= 0) out.push({ end: e, value: { cond: 'wasCast', via: w.via, $self: self } });
    }
  }
  return out;
}

/** "it's a creature card", "~ is tapped", "that creature isn't a Zombie", "enchanted creature has flying". */
function matches(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const predicate = (p: number, object: unknown, neg: boolean): void => {
    const wrap = (end: number, filter: ObjectFilter, flags?: string[]): void => {
      const c: Condition = { cond: 'matches', object: object as never, filter };
      out.push({ end, value: neg ? { cond: 'not', of: c } : c, ...(flags && flags.length > 0 ? { flags } : {}) });
    };
    const t = ctx.toks[p]?.norm;
    // FAST4 T34 (CR 608.2h): "if it's a land card": the object is known (a step just acted on it), so a card noun needs no zone (the filter is tested
    // against that object, never searched for: rules/filter.ts reads an absent zone as any zone); the flag `zone-unstated` would make it manual
    if (t === 'a' || t === 'an') for (const n of npAlts(ctx, p + 1)) if (n.number === 'singular') wrap(n.end, n.filter, n.flags.filter((f) => f !== 'zone-unstated'));
    // CLOUD std-msh (CR 109.2): "if that creature is another Hero": of that description and not this object (`other: true`, read against the ability's
    // source, rules/filter.ts); only a positive, singular description (a negated "isn't another Hero" says nothing a player reads the same way)
    if (t === 'another' && !neg) {
      for (const n of npAlts(ctx, p + 1)) {
        if (n.number !== 'singular' || n.filter.other !== undefined) continue;
        const g = mergeFilter(n.filter, { other: true });
        if (g) wrap(n.end, g, n.flags.filter((f) => f !== 'zone-unstated'));
      }
    }
    for (const n of npAlts(ctx, p, { bare: true })) if (n.head === 'mods') wrap(n.end, n.filter);
    // std-typechange-1 (CR 708.2, 708.3; render/cond.ts says it so): "as long as enchanted creature is face down", "if it's face up": the object's face-down
    // status now, a positive predicate only ("isn't face down" is "is face up" and is read so)
    if (!neg) {
      const fd = phraseAt(ctx, p, W_FACE_DOWN);
      if (fd >= 0) wrap(fd, { faceDown: true });
      const fu = phraseAt(ctx, p, W_FACE_UP);
      if (fu >= 0) wrap(fu, { faceDown: false });
    }
    const rb = phraseAt(ctx, p, W_YOUR_RING_BEARER);
    if (rb >= 0) wrap(rb, { ringBearer: 'you' });
    // p2-attack-block-1 (CR 506.5): "as long as it's attacking alone", "as long as enchanted creature is attacking alone": it is an attacking creature and no other
    // creature is attacking (the `attackingAlone` filter of CLOUD std-msh); a positive predicate only
    if (!neg) {
      const aa = phraseAt(ctx, p, W_ATTACKING_ALONE);
      if (aa >= 0) wrap(aa, { attackingAlone: true });
    }
  };
  const itsEnd = phraseAt(ctx, pos, P("it's"));
  if (itsEnd >= 0) {
    const it = anaphorObj({ sort: 'object', number: 'singular', text: 'it' });
    predicate(itsEnd, it, false);
    const nt = phraseAt(ctx, itsEnd, P('not'));
    if (nt >= 0) predicate(nt, it, true);
  }
  // CLOUD std-misc (CR 608.2h, 603.4, 208.1; Massacre Girl, Known Killer): "if its toughness was less than 1": a statistic of the object a step or the trigger's event
  // is about, as it last existed (the `stat` quantity reads last known information), compared with a number: the comparison FAST4 T26 builds for "if its mana value
  // was 3 or less" (zz-fast4/t26.json), so both readings of such a sentence are one
  const itsStat = phraseAt(ctx, pos, W_ITS);
  if (itsStat >= 0) {
    for (const [ws, stat] of ITS_STATS) {
      const e = phraseAt(ctx, itsStat, ws);
      const was = e >= 0 ? phraseAt(ctx, e, W_WAS) : -1;
      if (was >= 0) for (const c of cmpAt(ctx, was)) out.push({ end: c.end, value: compare({ q: 'stat', stat, of: anaphorObj({ sort: 'object', number: 'singular', text: 'it' }) as never }, c.cmp.op, c.cmp.value) });
    }
  }
  // FAST5X E17 (CR 608.2h, 113.7a): "you controlled it", "you controlled that creature": only a reference back to an object the ability already named (an
  // anaphor); its controller is read from its last known information once it left the battlefield (effects/eval.ts#matches, effects/refs.ts#readInfo)
  const yc = phraseAt(ctx, pos, W_YOU_CONTROLLED);
  if (yc >= 0) for (const o of ctx.call('Obj', yc)) {
    const v = o.value as { $anaphor?: unknown } | null;
    if (v === null || typeof v !== 'object' || v.$anaphor === null || typeof v.$anaphor !== 'object') continue;
    const object = { ...v, $anaphor: { ...(v.$anaphor as object), notSelf: true } }; // never the source itself (lower/anaphora.ts#compatible)
    out.push({ end: o.end, value: { cond: 'matches', object: object as never, filter: { controller: 'you' } } });
  }
  // CLOUD std-msh (CR 301.5): "if he's equipped", "if it's equipped": an Equipment is attached to it, FAST4 T29's reading of "as long as ~ is equipped"
  const equipped = (end: number, object: unknown): void => {
    if (ctx.toks[end]?.norm === 'equipped' && isAttachHost(object)) out.push({ end: end + 1, value: exists({ subtypes: ['Equipment'], attachedToObject: object }) });
  };
  if (itsEnd >= 0) equipped(itsEnd, anaphorObj({ sort: 'object', number: 'singular', text: 'it' }));
  for (const o of ctx.call('Obj', pos)) {
    for (const is of W_IS) {
      const e = phraseAt(ctx, o.end, is);
      if (e >= 0) { predicate(e, o.value, false); const nt = phraseAt(ctx, e, P('not')); if (nt >= 0) predicate(nt, o.value, true); }
      if (e >= 0 && is === W_IS[0]) equipped(e, o.value);
      // std-costs-2 (CR 607.2d, 205.3m): "the revealed card is the chosen type" (Celestial Reunion): it has the type the linked choice chose (the `chosen` field with the
      // link placeholder, as "a creature card of the chosen type" has it; lower/links.ts resolves it against the producer)
      const ct = e >= 0 && is === W_IS[0] ? phraseAt(ctx, e, W_THE_CHOSEN_TYPE) : -1;
      if (ct >= 0) out.push({ end: ct, value: { cond: 'matches', object: o.value as never, filter: { chosen: { link: '$link', quality: '$chosenType' } } as never } });
    }
    // std-ru (CR 301.5, 303.4): "as long as ~ is attached to a creature": the object the source (an Equipment, an Aura, a Fortification) is attached to exists and
    // is such a permanent (`attachedTo` names nothing while the source is attached to nothing: the condition is false). Only for the source itself (~)
    if (isSelfRef(o.value)) {
      const at = phraseAt(ctx, o.end, W_IS_ATTACHED_TO);
      const art = at >= 0 ? ctx.toks[at]?.norm : undefined;
      if (art === 'a' || art === 'an') {
        for (const n of npAlts(ctx, at + 1)) {
          if (n.number !== 'singular' || n.filter.zone !== undefined || n.filter.isCard !== undefined || n.flags.length > 0) continue;
          out.push({ end: n.end, value: { cond: 'matches', object: { ref: 'attachedTo' }, filter: n.filter }, ...(n.weak ? { weak: n.weak } : {}) });
        }
      }
    }
    for (const w of ["isn't", "aren't"]) if (ctx.toks[o.end]?.norm === w) predicate(o.end + 1, o.value, true);
    pastTense(ctx, o.end, o.value, out);
    castForAltCost(ctx, o.end, o.value, out);
    for (const has of W_HAS) {
      const e = phraseAt(ctx, o.end, has);
      if (e >= 0) for (const f of featureAt(ctx, e, false)) out.push({ end: f.end, value: { cond: 'matches', object: o.value as never, filter: f.frag } });
      // std-combat-2 (CR 702.2-702.21, 122.1b): "that creature has haste and ~ doesn't": the first object has the keyword and the second does not (the second
      // clause's "have <keyword>" left unsaid). One keyword only, the second object a different single object
      if (e >= 0) for (const f of featureAt(ctx, e, false)) {
        if (typeof f.frag.keyword !== 'string' || Object.keys(f.frag).length !== 1) continue;
        const and = phraseAt(ctx, f.end, P('and'));
        if (and >= 0) for (const o2 of ctx.call('Obj', and)) {
          if (JSON.stringify(o2.value) === JSON.stringify(o.value)) continue;
          const neg = anyPhraseAt(ctx, o2.end, [P("doesn't"), P('does not')]);
          if (neg >= 0 && ctx.toks[neg]?.norm !== 'have') out.push({ end: neg, value: { cond: 'all', of: [{ cond: 'matches', object: o.value as never, filter: f.frag }, { cond: 'not', of: { cond: 'matches', object: o2.value as never, filter: f.frag } }] } });
        }
      }
      // CLOUD std-dft (CR 122.1): "it has an even / odd number of counters on it" (counterParity)
      if (e >= 0) for (const [w, odd] of [[W_EVEN_COUNTERS_ON_IT, false], [W_ODD_COUNTERS_ON_IT, true]] as const) {
        const p = phraseAt(ctx, e, w);
        if (p >= 0) out.push({ end: p, value: counterParity(o.value, odd) });
      }
    }
    for (const w of ["doesn't have", 'does not have']) {
      const e = phraseAt(ctx, o.end, P(w));
      if (e >= 0) for (const f of featureAt(ctx, e, false)) out.push({ end: f.end, value: { cond: 'not', of: { cond: 'matches', object: o.value as never, filter: f.frag } } });
    }
  }
  return out;
}

const W_THE_CHOSEN_TYPE = P('the chosen type'); // std-costs-2
const W_DONE_ALL = [P("you've done all"), P('you have done all')]; // std-mana-12
const W_WAS = P('was');
const W_DESTROYED_THIS_WAY = P('was destroyed this way');
const W_AS_YOU_CAST = P('as you cast');
const W_YOU_CONTROLLED_NP = P('you controlled');
const W_YOU_CAST = P('you cast'); // std-rn
const W_DURING_YOUR_MAIN = P('during your main phase'); // std-rn

/**
 * FAST5X E17 (CR 608.2c, 608.2h): "a creature you controlled was destroyed this way", "a permanent you controlled or a token was destroyed this way": the
 * destroy step right before it (lower/conditions.ts resolves the `$step` marker and insists on a destroy) actually destroyed such an object, read as it last
 * existed on the battlefield (`did` with `which`). Each noun phrase is singular after "a" / "an"; "you controlled" after one of them is its controller.
 */
function destroyedThisWay(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const nps = (p: number): { end: number; filter: ObjectFilter }[] => {
    const t = ctx.toks[p]?.norm;
    if (t !== 'a' && t !== 'an') return [];
    const res: { end: number; filter: ObjectFilter }[] = [];
    for (const n of npAlts(ctx, p + 1)) {
      if (n.number !== 'singular' || n.flags.some((f) => f !== 'zone-unstated') || n.filter.controller !== undefined) continue;
      res.push({ end: n.end, filter: n.filter });
      const yc = phraseAt(ctx, n.end, W_YOU_CONTROLLED_NP);
      const f = yc >= 0 ? mergeFilter(n.filter, { controller: 'you' }) : null;
      if (f) res.push({ end: yc, filter: f });
    }
    return res;
  };
  const emit = (end: number, which: ObjectFilter): void => {
    const e = phraseAt(ctx, end, W_DESTROYED_THIS_WAY);
    if (e >= 0) out.push({ end: e, value: { cond: 'did', step: '', $step: 'previous', which } as unknown as Condition });
  };
  for (const a of nps(pos)) {
    emit(a.end, a.filter);
    const or = phraseAt(ctx, a.end, P('or'));
    if (or >= 0) for (const b of nps(or)) emit(b.end, { anyOf: [a.filter, b.filter] });
  }
  return out;
}

const W_YOU_PUT = P('you put');
// Cloud std-eoe; r4-moved: the present tense too, "If you don't put a card into your hand this way, create a Food token." (Courier of Comestibles; CR 608.2c)
const W_YOU_DIDNT_PUT = [P("you didn't put"), P('you did not put'), P("you don't put"), P('you do not put')];
const W_INTO_YOUR_HAND_THIS_WAY = P('into your hand this way');

/**
 * FAST5 T75 (CR 608.2c, 608.2h, 400.7): "you put a Town card into your hand this way": the move to the hand right before it (lower/conditions.ts resolves the
 * `$step` marker and insists on a move to the hand) actually put such a card in your hand, read as the card was before it moved (`did` with `which` and `to`).
 * One card after "a" / "an", described as a card, whose controller is not said (a card in a hand or graveyard has none, CR 109.4).
 */
function putIntoHandThisWay(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  // Cloud std-eoe (CR 608.2c): "you didn't put a card into your hand this way" is the negation: the move put no such card into your hand (`did` with `not`)
  for (const [lead, not] of [[W_YOU_PUT, false], ...W_YOU_DIDNT_PUT.map((w) => [w, true] as const)] as const) {
    const e = phraseAt(ctx, pos, lead);
    const art = e >= 0 ? ctx.toks[e]?.norm : undefined;
    if (art !== 'a' && art !== 'an') continue;
    for (const n of npAlts(ctx, e + 1)) {
      if (n.number !== 'singular' || n.head !== 'card' || n.flags.some((f) => f !== 'zone-unstated') || n.filter.controller !== undefined || n.filter.owner !== undefined || n.filter.zone !== undefined) continue;
      const x = phraseAt(ctx, n.end, W_INTO_YOUR_HAND_THIS_WAY);
      if (x >= 0) out.push({ end: x, value: { cond: 'did', step: '', $step: 'previous', which: n.filter, to: 'hand', ...(not ? { not: true } : {}) } as unknown as Condition });
    }
  }
  // r5-moved (CR 608.2c): "If you put no cards into your hand this way" (Nashi, Searcher in the Dark) is "If you don't put a card into your hand this way": the move right before
  // put no card into your hand
  const none = phraseAt(ctx, pos, W_YOU_PUT_NO_CARDS_INTO_YOUR_HAND_THIS_WAY);
  if (none >= 0) out.push({ end: none, value: { cond: 'did', step: '', $step: 'previous', which: {}, to: 'hand', not: true } as unknown as Condition });
  return out;
}
const W_YOU_PUT_NO_CARDS_INTO_YOUR_HAND_THIS_WAY = P('you put no cards into your hand this way'); // r5-moved

const W_RETURNED = P('returned');
const W_TO_YOUR_HAND_THIS_WAY = P('to your hand this way');

/**
 * r4-moved (CR 608.2c, 608.2h): "If you control a Squirrel or returned a Squirrel card to your hand this way, create a Food token." (Cache Grab): the second part of
 * an "or" whose subject "you" the first part said: "returned a <card> to your hand this way" is FAST5 T75's "you put a <card> into your hand this way" (the same
 * value). Only right after "or" in a condition that begins "if you" / "when you" (the words before it in the sentence), so the elided subject is you.
 */
function returnedToYourHandThisWay(ctx: HoleCtx, pos: number): Alt[] {
  if (ctx.toks[pos - 1]?.norm !== 'or') return [];
  let k = pos - 2;
  while (k >= 0 && ctx.toks[k]?.norm !== 'if' && ctx.toks[k]?.kind !== 'PUNCT') k--;
  if (k < 0 || ctx.toks[k]?.norm !== 'if' || ctx.toks[k + 1]?.norm !== 'you') return [];
  const e = phraseAt(ctx, pos, W_RETURNED);
  const art = e >= 0 ? ctx.toks[e]?.norm : undefined;
  if (art !== 'a' && art !== 'an') return [];
  const out: Alt[] = [];
  for (const n of npAlts(ctx, e + 1)) {
    if (n.number !== 'singular' || n.head !== 'card' || n.flags.some((f) => f !== 'zone-unstated') || n.filter.controller !== undefined || n.filter.owner !== undefined || n.filter.zone !== undefined) continue;
    const x = phraseAt(ctx, n.end, W_TO_YOUR_HAND_THIS_WAY);
    if (x >= 0) out.push({ end: x, value: { cond: 'did', step: '', $step: 'previous', which: n.filter, to: 'hand' } as unknown as Condition });
  }
  return out;
}

const W_YOU_SEARCH_THIS_WAY = P('you search your library this way');

/**
 * r4-moved (CR 701.23a, 608.2c): "If you search your library this way, put ~ on the bottom of its owner's library, then shuffle." (Unlucky Cabbage Merchant): whether
 * you took the option right before it whose first instruction is a search of your library (or did that search): `did` with the marker `$searched`, which
 * lower/conditions.ts#resolveDid checks and drops; anything else before it is unresolved (manual).
 */
function searchedThisWay(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_YOU_SEARCH_THIS_WAY);
  if (e < 0) return [];
  // "If you search your library this way, shuffle." is Cloud std-dft's one reading (eff.stddft.shuffle.ifSearchedLibrary: the shuffle of a search of two zones,
  // `ifSearched`), never this one
  if (ctx.toks[e]?.norm === ',' && ctx.toks[e + 1]?.norm === 'shuffle' && (ctx.toks[e + 2] === undefined || ctx.toks[e + 2]?.norm === '.')) return [];
  return [{ end: e, value: { cond: 'did', step: '', $step: 'previous', $searched: true } as unknown as Condition }];
}

const W_RETURNED_THIS_WAY = P('was returned this way');

/**
 * STD-OTJ (CR 608.2c, 608.2h, 400.7): "a permanent was returned this way", "a creature was returned this way": the move to the hand right before it (the same
 * lowering as FAST5 T75's "you put a Town card into your hand this way": lower/conditions.ts resolves the `$step` marker and insists on a move to the hand) put at
 * least one such permanent in its owner's hand, read as it was on the battlefield before it moved (`did` with `which` of zone battlefield and `to`). One
 * permanent after "a" / "an", described by a type, no controller (a bounce says whose in its own sentence).
 */
function returnedThisWay(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const art = ctx.toks[pos]?.norm;
  // r4-moved (CR 109.2, 608.2h): "If another Desert was returned this way, surveil 1." (Arid Archway): one other than the object with the ability, as it last existed
  // (`other`; lower/anaphora.ts#movedOtherIsSelf: the described objects are never other than themselves, so "another" is other than ~)
  const another = art === 'another';
  if (art !== 'a' && art !== 'an' && !another) return out;
  for (const n of npAlts(ctx, pos + 1)) {
    if (n.number !== 'singular' || n.flags.some((f) => f !== 'zone-unstated') || n.filter.controller !== undefined || n.filter.owner !== undefined || n.filter.zone !== undefined || n.filter.isCard !== undefined) continue;
    if (another && n.filter.other !== undefined) continue;
    const x = phraseAt(ctx, n.end, W_RETURNED_THIS_WAY);
    if (x >= 0) out.push({ end: x, value: { cond: 'did', step: '', $step: 'previous', which: { ...n.filter, ...(another ? { other: true } : {}), zone: 'battlefield' }, to: 'hand' } as unknown as Condition });
  }
  return out;
}

const W_MILLED_WAY_VERB = [P('is milled this way'), P('was milled this way')];
const W_MILLED_WAY_VERB_PLURAL = [P('are milled this way'), P('were milled this way')]; // std-cardcopy-1
const W_THAT_SHARE: readonly [string[], 'cardType' | 'color'][] = [[P('that share a card type'), 'cardType'], [P('that share a color'), 'color']]; // std-cardcopy-1
const W_AT_LEAST_ONE = P('at least one');

const W_THIS_WAY_PUT = P('this way');

/**
 * trek-6 (CR 122.1, 122.6, 608.2c; Guinan, Ancient Advisor): "If you put two or more +1/+1 counters on creatures this way, draw a card.": the counters the putCounters
 * instruction right before it actually put (`{q:'countersPut', $step}`, resolved by parser/lower/conditions.ts#resolveCountersPut as "the counters removed this way" is),
 * at least that many (of the kind when one is named). The plural noun phrase after "counters on" is the objects they went on, said again: it names no controller, owner
 * or zone of its own and is not kept (the renderer says it from what the instruction put them on, render/cond.ts#compareIdiom, so a different noun is refused by the
 * render gate). A count is a number of one or more.
 */
function countersPutThisWay(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const you = phraseAt(ctx, pos, W_YOU_PUT);
  if (you < 0) return out;
  for (const q of ctx.call('Qty', you)) {
    if (typeof q.value !== 'number' || q.value < 1) continue;
    const om = phraseAt(ctx, q.end, P('or more'));
    if (om < 0) continue;
    const kinds: { end: number; kind?: unknown }[] = [];
    const bare = phraseAt(ctx, om, W_COUNTERS_ON);
    if (bare >= 0) kinds.push({ end: bare });
    for (const k of ctx.call('CounterKind', om)) {
      const e = phraseAt(ctx, k.end, W_COUNTERS_ON);
      if (e >= 0) kinds.push({ end: e, kind: k.value });
    }
    for (const kd of kinds) {
      for (const n of npAlts(ctx, kd.end)) {
        const f = n.filter as Record<string, unknown>;
        if (n.number !== 'plural' || n.flags.some((x) => x !== 'zone-unstated') || f['controller'] !== undefined || f['owner'] !== undefined || f['zone'] !== undefined || f[MOVED_MARK] !== undefined) continue;
        const e = phraseAt(ctx, n.end, W_THIS_WAY_PUT);
        if (e < 0) continue;
        out.push({ end: e, value: { cond: 'compare', left: { q: 'countersPut', step: '', $step: 'previous', ...(kd.kind !== undefined ? { kind: kd.kind } : {}) }, op: '>=', right: q.value } as unknown as Condition });
      }
    }
  }
  return out;
}

/**
 * std-tla (CR 701.17a, 608.2c, 608.2h): "a Lesson card is milled this way", "a land card was milled this way", "at least one Zombie card is milled this way": among the
 * cards a mill step of an earlier sentence of the ability put into a graveyard there is one of that description (`exists` over the group, read where the cards are: the
 * `milled` anaphor with `zone: 'any'`, as the templates of the `Milled` hole read it). One description of a card after "a" / "an" / "at least one", with no controller,
 * owner or zone. Only after a mill (the discourse model says an earlier sentence milled).
 */
function milledThisWayCond(ctx: HoleCtx, pos: number): Alt[] {
  if (ctx.discourse?.milled !== true) return [];
  const out: Alt[] = [];
  // std-cardcopy-1 (CR 205.2a, 105.2, 608.2c): "two cards that share a card type were milled this way" (The Tale of Tamiyo), "two nonland cards that share a color
  // were milled this way" (Sphinx's Tutelage): two of the cards milled (of that description) have a card type or a color in common (`share` over the same group)
  if (ctx.toks[pos]?.norm === 'two') for (const n of npAlts(ctx, pos + 1)) {
    if (n.number !== 'plural' || n.head !== 'card' || n.flags.some((f) => f !== 'zone-unstated')) continue;
    if (n.filter.controller !== undefined || n.filter.owner !== undefined || n.filter.zone !== undefined || n.filter.is !== undefined) continue;
    for (const [ws, what] of W_THAT_SHARE) {
      const sh = phraseAt(ctx, n.end, ws);
      if (sh < 0) continue;
      for (const w of W_MILLED_WAY_VERB_PLURAL) {
        const e = phraseAt(ctx, sh, w);
        if (e < 0) continue;
        const group = anaphorObj({ sort: 'set', number: 'plural', head: 'card', participle: 'milled', text: 'milled this way' });
        out.push({ end: e, value: { cond: 'share', what, of: { ref: 'each', filter: { ...n.filter, is: group, zone: 'any' } }, count: 2 } as unknown as Condition });
      }
    }
  }
  const atLeast = phraseAt(ctx, pos, W_AT_LEAST_ONE);
  const art = ctx.toks[pos]?.norm;
  const start = atLeast >= 0 ? atLeast : art === 'a' || art === 'an' ? pos + 1 : -1;
  if (start < 0) return out;
  for (const n of npAlts(ctx, start)) {
    if (n.number !== 'singular' || n.head !== 'card' || n.flags.some((f) => f !== 'zone-unstated')) continue;
    if (n.filter.controller !== undefined || n.filter.owner !== undefined || n.filter.zone !== undefined || n.filter.is !== undefined) continue;
    for (const w of W_MILLED_WAY_VERB) {
      const e = phraseAt(ctx, n.end, w);
      if (e < 0) continue;
      const group = anaphorObj({ sort: 'set', number: 'plural', head: 'card', participle: 'milled', text: 'milled this way' });
      out.push({ end: e, value: { cond: 'exists', of: { ref: 'each', filter: { ...n.filter, is: group, zone: 'any' } } } as unknown as Condition });
    }
  }
  return out;
}

const W_REVEALED_WAY_VERB = [P('is revealed this way'), P('was revealed this way')]; // p2-dig-2

/**
 * p2-dig-2 (CR 701.20a, 608.2c): "If a creature card is revealed this way, draw a card." (Elven Farsight), "If a land card is revealed this way, put it onto the
 * battlefield tapped." (Galadriel of Lothlórien): among the cards a reveal step of an earlier sentence of the ability revealed (the std-ro participle "revealed this
 * way", resolved by the anaphora pass to the ONE card that reveal revealed, or the sentence is manual) is of that description: the same `matches` as "if it's a creature
 * card" (render/cond.ts says both). One description of a card after "a" / "an", with no controller, owner or zone. A reveal that did not happen (an option not taken)
 * revealed nothing, so the condition is false.
 */
function revealedThisWayCond(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const art = ctx.toks[pos]?.norm;
  if (art !== 'a' && art !== 'an') return out;
  for (const n of npAlts(ctx, pos + 1)) {
    if (n.number !== 'singular' || n.head !== 'card' || n.flags.some((f) => f !== 'zone-unstated')) continue;
    if (n.filter.controller !== undefined || n.filter.owner !== undefined || n.filter.zone !== undefined || n.filter.is !== undefined) continue;
    for (const w of W_REVEALED_WAY_VERB) {
      const e = phraseAt(ctx, n.end, w);
      if (e < 0) continue;
      // the one card a reveal of the top card revealed (lower/mentions.ts: a singular mention with the participle); several revealed cards are not read here (fail closed)
      const card = anaphorObj({ sort: 'object', number: 'singular', head: 'card', participle: REVEALED_THIS_WAY, text: REVEALED_THIS_WAY });
      out.push({ end: e, value: { cond: 'matches', object: card, filter: n.filter } as unknown as Condition });
    }
  }
  return out;
}

/** FAST5X E17 (CR 608.2h): "if you controlled it" / "if you controlled that permanent": an object an earlier step acted on, as it last existed. */
const W_YOU_CONTROLLED = P('you controlled');
const W_WASNT = [P("wasn't"), P('was not')];
const W_WERE = P('were'); // std-rx31
const W_HAD = P('had');
const W_ITS = P('its'); // CLOUD std-misc
const ITS_STATS: [string[], 'power' | 'toughness' | 'manaValue'][] = [[P('power'), 'power'], [P('toughness'), 'toughness'], [P('mana value'), 'manaValue']];
const W_COUNTERS_ON_IT = P('counters on it'); // FAST5X E21
const W_WAS_DEALT_DAMAGE = P('was dealt damage this turn');
const W_WASNT_DEALT_DAMAGE = [P("wasn't dealt damage this turn"), P('was not dealt damage this turn')]; // r3-fx
const W_CAST_FOR_ALT_COST: readonly { words: string[]; via: string }[] = [{ words: P('was cast for its warp cost'), via: 'warp' }]; // std-rx14

/**
 * std-rx14 (CR 702.185a, 118.9, 608.2h, 400.7d; Full Bore): "if that creature was cast for its warp cost": the cast record of an object the ability already
 * named (the target of the sentence before, an anaphor) shows that alternative cost (`wasCast.via` with `object`, effects/eval.ts#castRecordOf: what the permanent
 * keeps of the spell it was; one that was put onto the battlefield, or that changed zones since, has no cast record, so the answer is no). Only a back-reference
 * other than the object itself: the object's own cast history is the plain `wasCast` above.
 */
function castForAltCost(ctx: HoleCtx, pos: number, object: unknown, out: Alt[]): void {
  const v = object as { $anaphor?: unknown } | null;
  if (v === null || typeof v !== 'object' || v.$anaphor === null || typeof v.$anaphor !== 'object') return;
  const obj = { ...v, $anaphor: { ...(v.$anaphor as object), notSelf: true } };
  for (const w of W_CAST_FOR_ALT_COST) {
    const e = phraseAt(ctx, pos, w.words);
    if (e >= 0) out.push({ end: e, value: { cond: 'wasCast', via: w.via, object: obj as never } });
  }
}

/**
 * FAST4 T34 (CR 608.2h, 400.7): a condition on what a step of the same resolution just acted on, in the past tense: "if it was a permanent card", "if that
 * permanent was a legendary enchantment", "if it was tapped", "if it had mana value 3 or less", "if it was dealt damage this turn". The object is read where
 * it is now, or as it last existed if it moved (`cond:'matches'` reads last known information, effects/eval.ts), which is what the past tense asks for.
 * "if it wasn't attacking": a permanent that left the battlefield was removed from combat (CR 506.4), and its last known information keeps whether it was
 * attacking or blocking as it left (types/state.ts#LastKnown.combat, rules/filter.ts). A card noun needs no zone here: the object is known, never searched for.
 */
function pastTense(ctx: HoleCtx, pos: number, object: unknown, out: Alt[]): void {
  const push = (end: number, filter: ObjectFilter, neg: boolean, flags: readonly string[] = []): void => {
    const c: Condition = { cond: 'matches', object: object as never, filter };
    const fl = flags.filter((f) => f !== 'zone-unstated');
    out.push({ end, value: neg ? { cond: 'not', of: c } : c, ...(fl.length > 0 ? { flags: fl } : {}) });
  };
  const nps = (p: number, neg: boolean): void => {
    const t = ctx.toks[p]?.norm;
    if (t === 'a' || t === 'an') for (const n of npAlts(ctx, p + 1)) if (n.number === 'singular') push(n.end, n.filter, neg, n.flags);
    // bare statuses: "tapped", "untapped", "attacking", "blocking"
    for (const n of npAlts(ctx, p, { bare: true })) {
      const keys = Object.keys(n.filter);
      if (n.head === 'mods' && keys.length === 1 && (n.filter.tapped !== undefined || n.filter.attacking === true || n.filter.blocking === true || n.filter.suspected === true)) push(n.end, n.filter, neg, n.flags);
      // CLOUD C8 (CR 205.4a, 105.2, 608.2h): a bare supertype or color, "if the sacrificed creature was legendary", "if it was red": its characteristics as it last existed
      else if (n.head === 'mods' && keys.length === 1 && n.flags.length === 0 && (n.filter.supertypes?.length === 1 || n.filter.colors?.length === 1 || n.filter.multicolored === true)) push(n.end, n.filter, neg, n.flags);
    }
  };
  const was = phraseAt(ctx, pos, W_WAS);
  if (was >= 0) nps(was, false);
  // std-rx31 (CR 201.5; family plural-name-verb): a permanent with a plural name takes a plural verb, "if ~ were a creature" (Tom, Bert, and William)
  const were = typeof object === 'object' && object !== null && (object as { ref?: unknown }).ref === 'self' ? phraseAt(ctx, pos, W_WERE) : -1;
  if (were >= 0) nps(were, false);
  for (const w of W_WASNT) { const e = phraseAt(ctx, pos, w); if (e >= 0) nps(e, true); }
  const had = phraseAt(ctx, pos, W_HAD);
  if (had >= 0) for (const f of featureAt(ctx, had, false)) if (f.frag.manaValue !== undefined || f.frag.power !== undefined || f.frag.toughness !== undefined) push(f.end, f.frag, false);
  // FAST5X E21 (CR 122.1, 608.2h, 603.10a): "if it had counters on it", "if it had no counters on it", "if it had a -1/-1 counter on it", "if it had one or
  // more counters on it": the counters on the object as it last existed (a creature that died is read as it was on the battlefield)
  if (had >= 0) {
    for (const f of featureAt(ctx, had, false)) if (f.frag.counters !== undefined && Object.keys(f.frag).length === 1) push(f.end, f.frag, false);
    const bare = phraseAt(ctx, had, W_COUNTERS_ON_IT);
    if (bare >= 0) push(bare, { counters: { kind: 'any' } }, false);
  }
  const dd = phraseAt(ctx, pos, W_WAS_DEALT_DAMAGE);
  if (dd >= 0) push(dd, { dealtDamageThisTurn: true }, false);
  // Standard round 3, r3-fx (CR 120.1, 608.2h): "if that creature wasn't dealt damage this turn": the same history read as it last existed (a destroyed creature's
  // damage this turn is its own), negated in the filter, as render/cond.ts says it
  for (const w of W_WASNT_DEALT_DAMAGE) { const e = phraseAt(ctx, pos, w); if (e >= 0) push(e, { dealtDamageThisTurn: false }, false); }
}

/** Quantity comparisons: "your life total is 5 or less", "the number of cards in your hand is 3 or greater". */
function compareForm(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const q of ctx.call('Qty', pos)) {
    if (typeof q.value === 'number' || (q.value as { q?: string }).q === 'X') continue;
    for (const is of W_IS) {
      const e = phraseAt(ctx, q.end, is);
      if (e < 0) continue;
      for (const c of cmpAt(ctx, e)) out.push({ end: c.end, value: compare(q.value as Quantity, c.cmp.op, c.cmp.value) });
    }
    // STD-FRA (CR 608.2h, 202.3): "if that permanent's mana value was 3 or less": the same comparison in the past tense, a property of an object that may have left
    // read from last known information (render/cond.ts, equivalence family stat-was); only "N or less" / "N or greater" of a statistic
    const was = phraseAt(ctx, q.end, W_WAS);
    if (was >= 0 && typeof q.value === 'object' && (q.value as { q?: string }).q === 'stat') {
      for (const c of cmpAt(ctx, was)) if (c.cmp.op === '<=' || c.cmp.op === '>=') out.push({ end: c.end, value: compare(q.value as Quantity, c.cmp.op, c.cmp.value) });
    }
  }
  return out;
}

const W_THIS_TURN = P('this turn');
const W_ATTACKED_THIS_TURN = P('attacked this turn'); // r5-fxb
const W_AND_WORD = P('and'); // FAST5 T62
const W_OPP_NONCOMBAT_DAMAGE = P('an opponent was dealt noncombat damage this turn');
const W_OPP_NONCOMBAT_DAMAGE_LAST = P('an opponent was dealt noncombat damage last turn'); // Standard round I
const W_SCRIED_OR_SURVEILLED = [P("you've scried or surveilled this turn"), P('you scried or surveilled this turn')];
// FAST5X E20 (CR 700.13): "you've committed a crime this turn"
const W_COMMITTED_CRIME = [P("you've committed a crime this turn"), P('you committed a crime this turn')];
// FAST5X E25 (CR 708.8)
const W_TURNED_FACE_UP = [P('you turned a permanent face up this turn'), P("you've turned a permanent face up this turn")];

/** The turn's history: "you gained life this turn", "you've cast two or more spells this turn", "a creature died this turn", "you attacked this turn". */
function history(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const hap = (end: number, event: unknown, extra?: Record<string, unknown>): void => {
    out.push({ end, value: { cond: 'happened', event: event as never, scope: 'turn', ...extra } });
  };
  for (const lead of [P('you gained life this turn'), P("you've gained life this turn")]) {
    const e = phraseAt(ctx, pos, lead);
    if (e >= 0) hap(e, { ev: 'life', change: 'gain', player: 'you' });
  }
  for (const lead of [P('you lost life this turn'), P("you've lost life this turn")]) {
    const e = phraseAt(ctx, pos, lead);
    if (e >= 0) hap(e, { ev: 'life', change: 'loss', player: 'you' });
  }
  // std-rm (CR 111.1, 603.4): "you created a token this turn" (Bennie Bracks, Zoologist): a token was created under your control this turn (the history's
  // createToken entries, one per token, rules/history.ts)
  for (const lead of [P('you created a token this turn'), P("you've created a token this turn")]) {
    const e = phraseAt(ctx, pos, lead);
    if (e >= 0) hap(e, { ev: 'createToken', player: 'you' });
  }
  // Standard round 3, r3-trig (CR 606.3, 603.4): "you've activated a loyalty ability this turn" (Kiora of Salt and Sand): an activation of a loyalty ability by you
  // this turn (the history records the kind, triggers/history.ts)
  for (const lead of [P("you've activated a loyalty ability this turn"), P('you activated a loyalty ability this turn')]) {
    const e = phraseAt(ctx, pos, lead);
    if (e >= 0) hap(e, { ev: 'activate', player: 'you', ability: 'loyalty' });
  }
  for (const lead of [P('you attacked this turn'), P("you've attacked this turn")]) {
    const e = phraseAt(ctx, pos, lead);
    if (e >= 0) hap(e, { ev: 'attacks', attacker: { controller: 'you' } });
  }
  // CLOUD std-ecl (CR 508.1, 603.4, 611.3a): "you attacked with three or more Merfolk this turn", "you attacked with two or more creatures this turn": at least N
  // different creatures you control of the description were declared as attackers this turn (rules/history.ts counts each attacker once)
  for (const lead of [P('you attacked with'), P("you've attacked with")]) {
    const e = phraseAt(ctx, pos, lead);
    if (e < 0) continue;
    for (const c of cmpAt(ctx, e)) {
      if (c.cmp.op !== '>=') continue;
      for (const n of npAlts(ctx, c.end)) {
        if (n.number !== 'plural' || n.filter.controller !== undefined || n.filter.zone !== undefined) continue;
        const th = phraseAt(ctx, n.end, W_THIS_TURN);
        if (th >= 0) hap(th, { ev: 'attacks', attacker: { ...n.filter, controller: 'you' } }, { times: c.cmp });
      }
    }
    // Standard round 4, r4-trig (CR 508.1, 603.4; Avengers Assemble!): "you attacked with a Hero this turn": a creature you controlled of that description was declared
    // as an attacker this turn (one, the history entry of each attacker)
    const t = ctx.toks[e]?.norm;
    if (t === 'a' || t === 'an') for (const n of npAlts(ctx, e + 1)) {
      if (n.number !== 'singular' || n.filter.controller !== undefined || n.filter.zone !== undefined) continue;
      const th = phraseAt(ctx, n.end, W_THIS_TURN);
      if (th >= 0) hap(th, { ev: 'attacks', attacker: { ...n.filter, controller: 'you' } });
    }
  }
  // Standard round 4, r4-trig (CR 508.1, 603.4; Fearless Swashbuckler): "a Pirate and a Vehicle attacked this combat": two different creatures attacked in this
  // combat, one of each description (one may be both: at least one of each and at least two of either, the history counting each attacker once, rules/history.ts)
  const ta = ctx.toks[pos]?.norm;
  if (ta === 'a' || ta === 'an') for (const n of npAlts(ctx, pos + 1)) {
    if (n.number !== 'singular' || n.filter.controller !== undefined || n.filter.zone !== undefined) continue;
    const and = phraseAt(ctx, n.end, W_AND_WORD);
    const tb = and >= 0 ? ctx.toks[and]?.norm : undefined;
    if (tb !== 'a' && tb !== 'an') continue;
    for (const m of npAlts(ctx, and + 1)) {
      if (m.number !== 'singular' || m.filter.controller !== undefined || m.filter.zone !== undefined) continue;
      const th = phraseAt(ctx, m.end, P('attacked this combat'));
      if (th < 0) continue;
      const atk = (f: ObjectFilter, times?: number): Condition => ({ cond: 'happened', event: { ev: 'attacks', attacker: f }, scope: 'combat', ...(times !== undefined ? { times: { op: '>=', value: times } } : {}) });
      out.push({ end: th, value: { cond: 'all', of: [atk(n.filter), atk(m.filter), atk({ anyOf: [n.filter, m.filter] }, 2)] } });
    }
  }
  // Standard round 4, r4-trig (CR 508.1, 603.4): "~ attacked this combat" (Tolsimir, Midnight's Light): the object itself was declared as an attacker in this combat
  if (ctx.toks[pos]?.kind === 'SELF') {
    const sa = phraseAt(ctx, pos + 1, P('attacked this combat'));
    if (sa >= 0) out.push({ end: sa, value: { cond: 'happened', event: { ev: 'attacks', attacker: { self: true } }, scope: 'combat' } });
  }
  // r5-fxb (CR 508.1, 719.3a): "three or more creatures attacked this turn" (Case of the Gateway Express): at least N different creatures of the description were
  // declared as attackers this turn, whoever controlled them (rules/history.ts counts each attacker once)
  for (const c of cmpAt(ctx, pos)) {
    if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number') continue;
    for (const n of npAlts(ctx, c.end)) {
      if (n.number !== 'plural' || n.filter.controller !== undefined || n.filter.zone !== undefined || !(n.filter.types ?? []).includes('Creature')) continue;
      const th = phraseAt(ctx, n.end, W_ATTACKED_THIS_TURN);
      if (th >= 0) hap(th, { ev: 'attacks', attacker: n.filter }, { times: c.cmp });
    }
  }
  // "you've cast a spell this turn", "you cast two or more spells this turn"
  for (const lead of [P("you've cast"), P('you cast')]) {
    const e = phraseAt(ctx, pos, lead);
    if (e < 0) continue;
    const t = ctx.toks[e]?.norm;
    if (t === 'a' || t === 'an') for (const n of npAlts(ctx, e + 1)) {
      if (n.number !== 'singular' || n.head !== 'spell') continue;
      const th = phraseAt(ctx, n.end, W_THIS_TURN);
      if (th >= 0) hap(th, castEvent(n.filter), { times: { op: '>=', value: 1 } });
    }
    // r4-static (CR 601.2i, 109.2): "you've cast another instant or sorcery spell this turn" (Burrog Barrage): a spell of that kind other than this object (the
    // history entry's subject is compared with the source, rules/history.ts)
    // (a bare "another spell" is FAST4 T32's cost reduction, eff.t32's own reading; only a spell of a kind here)
    if (t === 'another') for (const n of npAlts(ctx, e + 1)) {
      if (n.number !== 'singular' || n.head !== 'spell' || Object.keys(stripStack(n.filter)).length === 0) continue;
      const th = phraseAt(ctx, n.end, W_THIS_TURN);
      const other = mergeFilter(n.filter, { other: true });
      if (th >= 0 && other !== null) hap(th, castEvent(other), { times: { op: '>=', value: 1 } });
    }
    for (const c of cmpAt(ctx, e)) {
      if (c.cmp.op === '==') continue;
      for (const n of npAlts(ctx, c.end)) {
        if (n.number !== 'plural' || n.head !== 'spell') continue;
        const th = phraseAt(ctx, n.end, W_THIS_TURN);
        if (th >= 0) hap(th, castEvent(n.filter), { times: c.cmp });
      }
    }
  }
  // CLOUD std-msh (CR 122.6, 122.6a, 611.3a): "you've put one or more +1/+1 counters on ~ this turn" (Beast, Erudite Aerialist): counters of that kind that you
  // put on this object this turn (the player who put them, FAST5X E21's `by`, recorded in the history entry)
  for (const lead of [P("you've put one or more"), P('you put one or more')]) {
    const e = phraseAt(ctx, pos, lead);
    if (e < 0) continue;
    for (const k of ctx.call('CounterKind', e)) {
      const c = phraseAt(ctx, k.end, P('counters on ~'));
      const th = c >= 0 ? phraseAt(ctx, c, W_THIS_TURN) : -1;
      if (th >= 0) hap(th, { ev: 'counters', change: 'put', kind: k.value, on: { self: true }, by: 'you' });
    }
  }
  // CLOUD std-msh (CR 601.2i, 611.3a): "an opponent has cast a spell this turn" (Captain Mar-Vell): a spell an opponent of the controller cast this turn
  for (const lead of [P('an opponent has cast'), P('an opponent cast')]) {
    const e = phraseAt(ctx, pos, lead);
    const t = e >= 0 ? ctx.toks[e]?.norm : undefined;
    if (t !== 'a' && t !== 'an') continue;
    for (const n of npAlts(ctx, e + 1)) {
      if (n.number !== 'singular' || n.head !== 'spell') continue;
      const th = phraseAt(ctx, n.end, W_THIS_TURN);
      if (th >= 0) hap(th, { ...(castEvent(n.filter) as object), player: 'opponent' }, { times: { op: '>=', value: 1 } });
    }
  }
  // std-sos (CR 122.6, 122.6a, 603.4): "you put a counter on this creature this turn" (Fractal Tender): the counters event of the Event hole, as a history of the turn
  for (const ev of ctx.call('Event', pos)) {
    const evs = ev.value as EventPattern[];
    const only = evs.length === 1 ? evs[0]! : undefined;
    if (only === undefined || only.ev !== 'counters' || only.by !== 'you' || only.atLeast !== undefined || ev.flags?.includes('batch') === true) continue;
    const th = phraseAt(ctx, ev.end, W_THIS_TURN);
    if (th >= 0) hap(th, only);
  }
  // FAST5 T62 (CR 601.2i, 603.4): "you've cast both a creature spell and a noncreature spell this turn": both histories hold (two spells, each of its own kind)
  for (const lead of [P("you've cast both"), P('you cast both')]) {
    const e = phraseAt(ctx, pos, lead);
    const t1 = e >= 0 ? ctx.toks[e]?.norm : undefined;
    if (t1 !== 'a' && t1 !== 'an') continue;
    for (const n of npAlts(ctx, e + 1)) {
      if (n.number !== 'singular' || n.head !== 'spell') continue;
      const and = phraseAt(ctx, n.end, W_AND_WORD);
      const t2 = and >= 0 ? ctx.toks[and]?.norm : undefined;
      if (t2 !== 'a' && t2 !== 'an') continue;
      for (const m of npAlts(ctx, and + 1)) {
        if (m.number !== 'singular' || m.head !== 'spell') continue;
        const th = phraseAt(ctx, m.end, W_THIS_TURN);
        if (th < 0) continue;
        const one = (f: ObjectFilter): Condition => ({ cond: 'happened', event: castEvent(f) as never, scope: 'turn', times: { op: '>=', value: 1 } });
        out.push({ end: th, value: { cond: 'all', of: [one(n.filter), one(m.filter)] } });
      }
    }
  }
  // M6-4 (m6 design 3.6, CR 603.4): the Innistrad werewolves. "no spells were cast last turn" (no player cast a spell during the previous turn) and "a player
  // cast two or more spells last turn" (the per-player maximum: two players casting one spell each is not two, rules/history.ts#maxHistoryPerPlayer)
  const none = phraseAt(ctx, pos, W_NO_SPELLS_LAST_TURN);
  if (none >= 0) out.push({ end: none, value: { cond: 'not', of: { cond: 'happened', event: { ev: 'cast' }, scope: 'lastTurn' } } });
  // Standard round 5, r5-trig (CR 120.1, 510.2; Sidequest: Play Blitzball): "a player was dealt 6 or more combat damage this turn": the damage one player was dealt this
  // turn, added up (`happenedCount` per player with `sum`); "combat damage" or any damage
  const dealt = phraseAt(ctx, pos, P('a player was dealt'));
  if (dealt >= 0) for (const c of cmpAt(ctx, dealt)) {
    if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number') continue;
    for (const [w, combat] of [[P('combat damage this turn'), true], [P('damage this turn'), undefined]] as const) {
      const e = phraseAt(ctx, c.end, w);
      if (e >= 0) out.push({ end: e, value: compare({ q: 'happenedCount', event: { ev: 'damage', recipient: { player: 'any' }, ...(combat ? { combat } : {}) }, scope: 'turn', per: 'player', sum: 'amount' }, '>=', c.cmp.value) });
    }
  }
  // p2-exile-play-1 (CR 120.1, 702.75a; Spinerock Knoll): "an opponent was dealt 7 or more damage this turn": the damage one opponent was dealt this turn, added up
  // (`happenedCount` per player with `sum`, only damage to an opponent counted), as r5-trig's "a player was dealt"
  const oppDealt = phraseAt(ctx, pos, P('an opponent was dealt'));
  if (oppDealt >= 0) for (const c of cmpAt(ctx, oppDealt)) {
    if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number') continue;
    for (const [w, combat] of [[P('combat damage this turn'), true], [P('damage this turn'), undefined]] as const) {
      const e = phraseAt(ctx, c.end, w);
      if (e >= 0) out.push({ end: e, value: compare({ q: 'happenedCount', event: { ev: 'damage', recipient: { player: 'opponent' }, ...(combat ? { combat } : {}) }, scope: 'turn', per: 'player', sum: 'amount' }, '>=', c.cmp.value) });
    }
  }
  const aPlayer = phraseAt(ctx, pos, W_A_PLAYER_CAST);
  if (aPlayer >= 0) for (const c of cmpAt(ctx, aPlayer)) {
    const w = phraseAt(ctx, c.end, W_SPELLS_LAST_TURN);
    if (w >= 0 && c.cmp.op === '>=') out.push({ end: w, value: compare({ q: 'happenedCount', event: { ev: 'cast' }, scope: 'lastTurn', per: 'player' }, '>=', c.cmp.value) });
  }
  // FAST5X E9 (CR 120.1, 506.4-style history, 611.3a): "an opponent was dealt noncombat damage this turn" (damage that isn't combat damage, CR 120.1a, 510.2)
  const nd = phraseAt(ctx, pos, W_OPP_NONCOMBAT_DAMAGE);
  if (nd >= 0) hap(nd, { ev: 'damage', combat: false, recipient: { player: 'opponent' } });
  // Standard round I (CR 120.1a, 603.4; M6-4's scope `lastTurn`: the previous turn's entries): "an opponent was dealt noncombat damage last turn" (Command the Stage)
  const ndLast = phraseAt(ctx, pos, W_OPP_NONCOMBAT_DAMAGE_LAST);
  if (ndLast >= 0) out.push({ end: ndLast, value: { cond: 'happened', event: { ev: 'damage', combat: false, recipient: { player: 'opponent' } }, scope: 'lastTurn' } });
  // std-mana-12 (CR 603.2, 608.2c): "if you've done all four this turn": you performed each of the N actions the ability's own trigger names this turn ("Whenever you
  // waterbend, earthbend, firebend, or airbend, ... Then if you've done all four this turn, ...", Avatar Aang). The marker names N; lower/conditions.ts#resolveDoneAll
  // replaces it by the actions of the trigger, or leaves it (manual) when the trigger is not N actions of yours
  for (const w of W_DONE_ALL) {
    const at = phraseAt(ctx, pos, w);
    const n = at >= 0 ? NUMBER_WORDS[ctx.toks[at]?.norm ?? ''] : undefined;
    const e = n !== undefined && n >= 2 ? phraseAt(ctx, at + 1, P('this turn')) : -1;
    if (e >= 0) out.push({ end: e, value: { cond: 'all', of: [], $doneAll: n } as unknown as Condition });
  }
  // FAST5X E9 (CR 701.22d, 701.25d): "you've scried or surveilled this turn": you performed either keyword action this turn (scry 0 and surveil 0 are none)
  for (const w of W_SCRIED_OR_SURVEILLED) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: { cond: 'any', of: (['scry', 'surveil'] as const).map((verb) => ({ cond: 'happened', event: { ev: 'action', verb, actor: 'you' }, scope: 'turn' })) } as Condition });
  }
  // FAST5X E25 (CR 708.8, 603.4): "you turned a permanent face up this turn": a permanent was turned face up by you (the special action, or an effect you
  // controlled; the event's player, effects/proposal-kinds/turn-face-up.ts)
  for (const w of W_TURNED_FACE_UP) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) hap(e, { ev: 'becomes', what: 'turnedFaceUp', object: {} }, { by: 'you' });
  }
  // FAST5X E20 (CR 700.13, 603.4, 611.3a): "you've committed a crime this turn": you cast a spell, activated an ability or put a triggered ability on the stack
  // that targeted an opponent, something they control or a card in their graveyard this turn (rules/crime.ts reports it, the turn's history records it)
  for (const w of W_COMMITTED_CRIME) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) hap(e, { ev: 'action', verb: 'commitCrime', actor: 'you' });
  }
  // FAST5X E9 (CR 400.7, 603.6a): "~ entered this turn" / "~ entered the battlefield this turn" is read once, by enteredSelf below (the same `happened`
  // zoneChange of `self`); a second reading here would make the sentence ambiguous
  // "a creature died this turn"
  if (ctx.toks[pos]?.norm === 'a' || ctx.toks[pos]?.norm === 'an') for (const n of npAlts(ctx, pos + 1)) {
    if (n.number !== 'singular') continue;
    const e = phraseAt(ctx, n.end, P('died this turn'));
    if (e >= 0) hap(e, { ev: 'zoneChange', subject: n.filter, from: 'battlefield', to: 'graveyard' });
  }
  // "you've drawn two or more cards this turn"
  for (const lead of [P("you've drawn"), P('you drew')]) {
    const e = phraseAt(ctx, pos, lead);
    if (e < 0) continue;
    for (const c of cmpAt(ctx, e)) {
      const w = phraseAt(ctx, c.end, P('cards this turn'));
      const w1 = phraseAt(ctx, c.end, P('card this turn'));
      const end = w >= 0 ? w : w1;
      if (end >= 0 && c.cmp.op !== '==') out.push({ end, value: compare({ q: 'cardsDrawnThisTurn' }, c.cmp.op, c.cmp.value) });
    }
  }
  // FAST4 T26: "you've gained 3 or more life this turn" / "you gained 4 or more life this turn" (CR 119.3: the life its controller gained this turn)
  for (const lead of [P("you've gained"), P('you gained')]) {
    const e = phraseAt(ctx, pos, lead);
    if (e < 0) continue;
    for (const c of cmpAt(ctx, e)) {
      const end = phraseAt(ctx, c.end, P('life this turn'));
      if (end >= 0 && c.cmp.op === '>=') out.push({ end, value: compare({ q: 'lifeGainedThisTurn' }, c.cmp.op, c.cmp.value) });
    }
  }
  return out;
}

function castEvent(f: ObjectFilter): unknown {
  const spell = stripStack(f);
  return { ev: 'cast', player: 'you', ...(Object.keys(spell).length > 0 ? { spell } : {}) };
}

function stripStack(f: ObjectFilter): ObjectFilter {
  const g: ObjectFilter = { ...f };
  delete g.stackKind;
  if (g.zone === 'stack') delete g.zone;
  return g;
}

const W_YOU_BOTH_OWN_AND_CONTROL = P('you both own and control'); // MX2

/**
 * MX2 (CR 603.4, 712.4, 108.3, 108.4): "you both own and control ~ and a creature named Bruna, the Fading Light" (the meld cards): this object is yours in both
 * senses, and so is at least one permanent of that description. The object itself is `matches` (it must still be the same object, CR 400.7), the other one
 * `exists`; render/cond.ts says the pair back as written.
 */
function ownAndControl(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const e = phraseAt(ctx, pos, W_YOU_BOTH_OWN_AND_CONTROL);
  if (e < 0 || ctx.toks[e]?.kind !== 'SELF') return out;
  const and = phraseAt(ctx, e + 1, AND);
  const t = and >= 0 ? ctx.toks[and]?.norm : undefined;
  if (t !== 'a' && t !== 'an') return out;
  for (const n of npAlts(ctx, and + 1)) {
    if (n.number !== 'singular' || n.filter.owner !== undefined || n.filter.controller !== undefined) continue;
    const f = mergeFilter(n.filter, { owner: 'you', controller: 'you' });
    if (!f) continue;
    const both: Condition = { cond: 'all', of: [{ cond: 'matches', object: { ref: 'self' }, filter: { owner: 'you', controller: 'you' } }, exists(f)] };
    out.push({ end: n.end, value: both, ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
  }
  return out;
}

/** FAST4 T23: the zone changes of the turn's history ("died", "entered the battlefield", "left the battlefield"), as `zoneChange` patterns (CR 700.4, 603.6a, 603.6c). */
const ZONE_VERBS: [readonly string[], { from?: 'battlefield'; to?: 'battlefield' | 'graveyard' | 'hand'; ownerYou?: true }][] = [
  [P('died'), { from: 'battlefield', to: 'graveyard' }],
  [P('entered the battlefield'), { to: 'battlefield' }],
  [P('left the battlefield'), { from: 'battlefield' }],
  // trek-5 (CR 603.4, 400.3): "a permanent was returned to your hand from the battlefield this turn": it went to a hand that is yours, and a card goes to its owner's hand
  [P('was returned to your hand from the battlefield'), { from: 'battlefield', to: 'hand', ownerYou: true }],
];
const W_UNDER_YOUR_CONTROL = P('under your control');
const W_OR_ANOTHER = P('or another'); // std-lci
const W_UNDER_OPPONENT_CONTROL = P("under an opponent 's control"); // FAST5 T53 (CR 603.10a)
const W_FACE_DOWN = P('face down'); // FAST5X E25
const W_ATTACKING_ALONE = P('attacking alone'); // p2-attack-block-1 (CR 506.5)
const W_FACE_UP = P('face up'); // std-typechange-1
const W_ENTER_UNDER_YOUR_CONTROL_THIS_TURN = P('enter the battlefield under your control this turn'); // p2-damage-3

/**
 * FAST4 T23 (CR 603.4, 603.10a): history conditions about objects that changed zones this turn. "a creature died under your control this turn" (the
 * creature's controller as it last existed on the battlefield), "three or more creatures died this turn", "two or more nonland permanents entered the
 * battlefield under your control this turn", "a permanent left the battlefield under your control this turn". "a <x> died this turn" without a controller is
 * read by `history` above. The counted form is `happened` with `times` (each object that moved is one event, rules/history.ts).
 */
function zoneHistory(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const subjects: { end: number; filter: ObjectFilter; times?: NumberCmp; flags: string[] }[] = [];
  const t = ctx.toks[pos]?.norm;
  // "a Bird, Frog, Otter, or Rat" (several subtypes after one article) has no reading in the renderer's noun phrase: not read here
  if (t === 'a' || t === 'an') for (const n of npAlts(ctx, pos + 1)) if (n.number === 'singular') subjects.push({ end: n.end, filter: n.filter, flags: n.flags });
  // p2-damage-3 (CR 603.4, 207.2c): Landfall's "you had a land enter the battlefield under your control this turn" (Searing Blaze, Groundswell): a land entered under
  // your control this turn, the same history as "a land entered the battlefield under your control this turn"
  if (t === 'you' && ctx.toks[pos + 1]?.norm === 'had' && ['a', 'an'].includes(ctx.toks[pos + 2]?.norm ?? '')) {
    for (const n of npAlts(ctx, pos + 3)) {
      if (n.number !== 'singular' || n.filter.controller !== undefined || n.filter.zone !== undefined || n.filter.isCard !== undefined || n.filter.stackKind !== undefined) continue;
      const e = phraseAt(ctx, n.end, W_ENTER_UNDER_YOUR_CONTROL_THIS_TURN);
      if (e >= 0) out.push({ end: e, value: { cond: 'happened', event: { ev: 'zoneChange', subject: { ...n.filter, controller: 'you' }, to: 'battlefield' }, scope: 'turn' }, ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
    }
  }
  // FAST4 T27 (CR 603.4): "another creature entered the battlefield under your control this turn": an object other than the ability's source (the history's
  // `other`, rules/history.ts#factsMatchFilter: the entry's object is not the source)
  if (t === 'another') for (const n of npAlts(ctx, pos + 1)) if (n.number === 'singular' && (n.filter.subtypes?.length ?? 0) <= 1 && n.filter.other === undefined) subjects.push({ end: n.end, filter: { ...n.filter, other: true }, flags: n.flags });
  // std-lci (CR 603.4): "this artifact or another artifact entered the battlefield under your control this turn": the object itself or another object of the
  // kind, which is any object of the kind when the object is one (as "~ or another creature" in a trigger event, parser/holes/event.ts); the renderer says
  // "~ or another <kind>" only for an object of that kind (RenderContext.selfTypes), so the gate keeps any other reading manual
  if (ctx.toks[pos]?.kind === 'SELF') {
    const oa = phraseAt(ctx, pos + 1, W_OR_ANOTHER);
    if (oa >= 0) for (const n of npAlts(ctx, oa)) if (n.number === 'singular' && (n.filter.subtypes?.length ?? 0) <= 1 && n.filter.other === undefined) subjects.push({ end: n.end, filter: n.filter, flags: n.flags });
  }
  for (const c of cmpAt(ctx, pos)) {
    if (c.cmp.op !== '>=') continue;
    for (const n of npAlts(ctx, c.end)) if (n.number === 'plural') subjects.push({ end: n.end, filter: n.filter, times: c.cmp, flags: n.flags });
  }
  for (const s of subjects) {
    // only objects that can be permanents: a card or a spell never "died" or "entered the battlefield" (the head words "card" and "spell" are not read)
    if (s.filter.isCard !== undefined || s.filter.stackKind !== undefined || s.filter.zone !== undefined || s.filter.controller !== undefined) continue;
    for (const [ws, { ownerYou, ...zones }] of ZONE_VERBS) {
      const v0 = phraseAt(ctx, s.end, ws);
      if (v0 < 0) continue;
      if (ownerYou === true && s.filter.owner !== undefined) continue; // trek-5: the hand says whose
      // FAST5X E25 (CR 708.3, 603.4): "a permanent entered the battlefield face down under your control this turn" (put onto the battlefield face down)
      const fd = zones.to === 'battlefield' && zones.from === undefined ? phraseAt(ctx, v0, W_FACE_DOWN) : -1;
      for (const [v, faceDown] of fd >= 0 ? [[fd, true] as const] : [[v0, false] as const]) for (const under of [false, true, 'opponent'] as const) {
        if (ownerYou === true && under !== false) continue; // trek-5: "returned to your hand" has no "under your control"
        const u = under === 'opponent' ? phraseAt(ctx, v, W_UNDER_OPPONENT_CONTROL) : under ? phraseAt(ctx, v, W_UNDER_YOUR_CONTROL) : v;
        if (u < 0) continue;
        // "a creature died this turn" (no controller, no count) is `history`'s reading; one reading only
        if (!under && s.times === undefined && zones.to === 'graveyard') continue;
        const th = phraseAt(ctx, u, W_THIS_TURN);
        if (th < 0) continue;
        const subject: ObjectFilter = { ...s.filter, ...(under === 'opponent' ? { controller: 'opponent' as const } : under ? { controller: 'you' as const } : {}), ...(faceDown ? { faceDown: true } : {}), ...(ownerYou === true ? { owner: 'you' as const } : {}) };
        const event = { ev: 'zoneChange', subject, ...zones };
        out.push({ end: th, value: { cond: 'happened', event, scope: 'turn', ...(s.times !== undefined ? { times: s.times } : {}) }, ...(s.flags.length > 0 ? { flags: s.flags } : {}) });
      }
    }
  }
  return out;
}

const W_HAVENT_CAST_FROM_HAND = [P("you haven't cast a spell from your hand this turn"), P('you have not cast a spell from your hand this turn')];
const W_OPPONENT_LOST_LIFE = P('an opponent lost life this turn');
const W_YOU_DISCARDED_THIS_TURN = [P("you've discarded a card this turn"), P('you have discarded a card this turn'), P('you discarded a card this turn')]; // std-ry5
const W_FULL_PARTY = P('you have a full party');
const W_DIDNT_ENTER = [P("didn't enter the battlefield this turn"), P('did not enter the battlefield this turn')];
const W_STILL_ON_TOP_OF_YOUR_LIBRARY = [P('is still on top of your library')]; // trek-5 (CR 401.5, 400.7)
const W_HAVE_TOTAL_POWER = [P('have total power'), P('has total power')];

/**
 * FAST4 T23 (CR 603.4): more intervening "if" clauses.
 *  - "you haven't cast a spell from your hand this turn": no `cast` by you from your hand this turn (CR 601.2a; a copy is not cast, CR 707.10).
 *  - "an opponent lost life this turn": a `life` loss by an opponent this turn (CR 119.3).
 *  - "<object> didn't enter the battlefield this turn": the object itself (CR 400.7) has no entry onto the battlefield this turn (`enteredThisTurn: false`).
 *  - "<anaphoric player> has N or fewer cards in hand" ("that player", the player of the trigger event, CR 603.4 with 603.2): the size of that player's hand.
 *  - "creatures you control have total power 8 or greater": the sum of their powers (CR 208.1; negative values count, CR 107.1b).
 */
function t23Misc(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const w of W_HAVENT_CAST_FROM_HAND) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: { cond: 'not', of: { cond: 'happened', event: { ev: 'cast', player: 'you', from: 'hand' }, scope: 'turn' } } });
  }
  const ol = phraseAt(ctx, pos, W_OPPONENT_LOST_LIFE);
  if (ol >= 0) out.push({ end: ol, value: { cond: 'happened', event: { ev: 'life', change: 'loss', player: 'opponent' }, scope: 'turn' } });
  // std-ry5 (CR 701.9a, 602.5b, 603.4): "you've discarded a card this turn", "you discarded a card this turn": a discard by you this turn (the count FAST5 T61 reads, parser/holes/qty.ts#DISCARDED_THIS_TURN)
  for (const w of W_YOU_DISCARDED_THIS_TURN) {
    const dc = phraseAt(ctx, pos, w);
    if (dc >= 0) out.push({ end: dc, value: { cond: 'happened', event: { ev: 'action', verb: 'discard', actor: 'you' }, scope: 'turn' } });
  }
  // Standard round P (CR 700.8; The Destined White Mage): "you have a full party": your party has four creatures (a Cleric, a Rogue, a Warrior and a Wizard), the
  // most it can have, so the party size of FAST5 T38 (statics/party.ts) is 4
  const fp = phraseAt(ctx, pos, W_FULL_PARTY);
  if (fp >= 0) out.push({ end: fp, value: { cond: 'compare', left: { q: 'partySize', of: { ref: 'you' } }, op: '>=', right: 4 } });
  for (const o of ctx.call('Obj', pos)) {
    for (const w of W_DIDNT_ENTER) { const e = phraseAt(ctx, o.end, w); if (e >= 0) out.push({ end: e, value: { cond: 'matches', object: o.value as never, filter: { enteredThisTurn: false } }, ...(o.flags ? { flags: o.flags } : {}) }); }
    // trek-5 (CR 401.5, 400.7, 608.2c; Commander Spock): "If that card is still on top of your library, draw a card.": a card an earlier instruction named (an anaphor: "that card",
    // "it") that is in a library and is one of the top 1 cards of your library now. A card that moved is a new object (CR 400.7), so it is no longer that card
    if ('$anaphor' in (o.value as object)) {
      for (const w of W_STILL_ON_TOP_OF_YOUR_LIBRARY) {
        const e = phraseAt(ctx, o.end, w);
        if (e >= 0) out.push({ end: e, value: { cond: 'matches', object: o.value as never, filter: { zone: 'library', is: { ref: 'topCards', player: { ref: 'you' }, count: 1 } } }, ...(o.flags ? { flags: o.flags } : {}) });
      }
    }
    // std-rx10 (CR 400.7, 608.2c): "If the creature you control entered this turn, put a +1/+1 counter on it." (Malamet Battle Glyph): that object (never ~ itself, read
    // once by enteredSelf below) entered the battlefield this turn, as the permanent it is now
    if ((o.value as { ref?: unknown }).ref !== 'self') {
      for (const w of W_ENTERED_THIS_TURN) { const e = phraseAt(ctx, o.end, w); if (e >= 0) out.push({ end: e, value: { cond: 'matches', object: o.value as never, filter: { enteredThisTurn: true } }, ...(o.flags ? { flags: o.flags } : {}) }); }
    }
  }
  for (const p of ctx.call('Player', pos)) {
    const v = p.value as Record<string, unknown>;
    // p2-attack-block-2 (CR 506.2, 402.1, 404.1): and "defending player has seven or more cards in their graveyard" (Vantress Gargoyle), the size of the defending
    // player's hand or graveyard (the player of an attack restriction's own question, statics/hooks.ts)
    const defending = v['ref'] === 'defending';
    if (!('$anaphor' in v) && !defending) continue;
    const has = phraseAt(ctx, p.end, P('has'));
    if (has < 0) continue;
    const hand: Quantity = { q: 'zoneSize', zone: 'hand', of: v as never };
    for (const c of cmpAt(ctx, has)) {
      if (c.cmp.op === '==') continue;
      for (const w of W_CARDS_IN_HAND) { const h = phraseAt(ctx, c.end, w); if (h >= 0) out.push({ end: h, value: compare(hand, c.cmp.op, c.cmp.value) }); }
      const g = defending ? phraseAt(ctx, c.end, W_CARDS_IN_THEIR_GRAVEYARD) : -1;
      if (g >= 0) out.push({ end: g, value: compare({ q: 'zoneSize', zone: 'graveyard', of: v as never }, c.cmp.op, c.cmp.value) });
    }
  }
  for (const n of npAlts(ctx, pos)) {
    if (n.number !== 'plural' || n.filter.zone !== undefined || n.filter.isCard !== undefined || n.filter.stackKind !== undefined) continue;
    // Standard round 4, r4-trig (CR 208.1; Betor, Kin to All): ... and "have total toughness 10 or greater", the sum of their toughnesses (render/cond.ts has its wording, FAST4 T32)
    for (const [w, stat] of [...W_HAVE_TOTAL_POWER.map((x) => [x, 'power'] as const), [P('have total toughness'), 'toughness'] as const, [P('has total toughness'), 'toughness'] as const]) {
      const e = phraseAt(ctx, n.end, w);
      if (e < 0) continue;
      for (const c of cmpAt(ctx, e)) {
        if (c.cmp.op !== '>=') continue;
        // (the toughness reading is weak: FAST4 T32's cost template reads the same words in "~ costs {2} less to cast if ...", its one reading there, guard G5)
        out.push({ end: c.end, value: compare({ q: 'stat', stat, of: { ref: 'each', filter: n.filter }, sum: true }, '>=', c.cmp.value), ...(n.flags.length > 0 ? { flags: n.flags } : {}), ...(stat === 'toughness' ? { weak: 1 } : {}) });
      }
    }
  }
  return out;
}

const W_ENTERED_THIS_TURN = [P('entered this turn'), P('entered the battlefield this turn')];

/**
 * FAST5X E5 (CR 602.5b, 603.4) and E9 (CR 400.7, 611.3a): "this land entered this turn", "~ entered the battlefield this turn": the object itself (CR 400.7)
 * entered the battlefield this turn, as the turn's history (`happened` zoneChange of `self` to the battlefield, rules/history.ts). The one reading of the
 * sentence: statics read it (statics/match.ts, "as long as this Aura entered this turn") and the announcement reads this exact pattern (actions/announce-cond.ts,
 * the Gathering Place family's "Activate only if this land entered this turn or if you control a basic land", checked when the mana ability is activated).
 * FAST5 batch 2 merge: E5 read it as `matches self enteredThisTurn` and E9 as `happened`; two readings made the sentence ambiguous, so both use this one.
 */
const selfEnteredThisTurn = (): Condition => ({ cond: 'happened', event: { ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }, scope: 'turn' });
function enteredSelf(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const o of ctx.call('Obj', pos)) {
    if ((o.value as { ref?: unknown }).ref !== 'self') continue;
    for (const w of W_ENTERED_THIS_TURN) { const e = phraseAt(ctx, o.end, w); if (e >= 0) out.push({ end: e, value: selfEnteredThisTurn(), ...(o.flags ? { flags: o.flags } : {}) }); }
  }
  return out;
}

/**
 * FAST4 T23: the flag of the conditions above (zoneHistory, t23Misc). As an activation restriction ("Activate only if ...", CR 602.5b) such a condition is
 * read when the ability is activated, which the announcement code cannot do for a history or a total power (actions/announce-cond.ts): there it stays the
 * controller's attestation, as before these readings (parser/lower/activation.ts#condOf; never a manual ability where the restriction was attested).
 */
export const COND_NOT_AT_ANNOUNCEMENT = 'cond-not-at-announcement';
const unannounced = (alts: Alt[]): Alt[] => alts.map((a) => ({ ...a, flags: [...(a.flags ?? []), COND_NOT_AT_ANNOUNCEMENT] }));

const W_CARDS_ARE_IN_YOUR_GRAVEYARD = P('cards are in your graveyard');
const W_OPPONENT_MORE_CARDS_IN_HAND = P('an opponent has more cards in hand than you');
const W_OPPONENT_MORE_LIFE = P('an opponent has more life than you');

const W_SOURCES_YOU_CONTROLLED_DEALT = P('sources you controlled dealt damage this turn');
const W_SOURCES_YOU_CONTROLLED_DEALT_N = P('sources you controlled dealt'); // std-rB
const W_NONCOMBAT_DAMAGE_THIS_TURN = P('noncombat damage this turn');
const W_COMBAT_DAMAGE_THIS_TURN = P('combat damage this turn');
const W_DAMAGE_THIS_TURN = P('damage this turn');

/**
 * Cloud r3-mech (CR 120.1, 400.7, 719.3a): "three or more sources you controlled dealt damage this turn" (Case of the Burning Masks' "To solve"): the number of
 * different sources of this turn's damage that "you" controlled as they dealt it (`happenedDistinct` with `what: 'sources'`, rules/history.ts#distinctSources).
 * Only "N or more" with a number.
 */
function sourcesDealtDamage(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const c of cmpAt(ctx, pos)) {
    if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number') continue;
    const e = phraseAt(ctx, c.end, W_SOURCES_YOU_CONTROLLED_DEALT);
    if (e >= 0) out.push({ end: e, value: compare({ q: 'happenedDistinct', event: { ev: 'damage', source: { controller: 'you' } }, scope: 'turn', what: 'sources' } as Quantity, '>=', c.cmp.value) });
  }
  // std-rB (CR 120.1, 120.3, 400.7; Ojer Axonil's Temple of Power): "[red] sources you controlled dealt 4 or more [noncombat | combat] damage this turn": this turn's
  // damage from sources of that color that "you" controlled as they dealt it, to anything, added up (`happenedCount` with `sum` and no `per`). Only "N or more"
  // with a number
  const starts: { end: number; source: ObjectFilter }[] = [{ end: pos, source: { controller: 'you' } }];
  for (const c of ctx.call('Color', pos)) starts.push({ end: c.end, source: { colors: [c.value as Color], controller: 'you' } });
  for (const st of starts) {
    const d = phraseAt(ctx, st.end, W_SOURCES_YOU_CONTROLLED_DEALT_N);
    if (d < 0) continue;
    for (const c of cmpAt(ctx, d)) {
      if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number') continue;
      for (const [w, combat] of [[W_NONCOMBAT_DAMAGE_THIS_TURN, false], [W_COMBAT_DAMAGE_THIS_TURN, true], [W_DAMAGE_THIS_TURN, undefined]] as const) {
        const e = phraseAt(ctx, c.end, w);
        if (e >= 0) out.push({ end: e, value: compare({ q: 'happenedCount', event: { ev: 'damage', source: st.source, ...(combat !== undefined ? { combat } : {}) }, scope: 'turn', sum: 'amount' }, '>=', c.cmp.value) });
      }
    }
  }
  return out;
}

/** FAST5 T53 (CR 404.1): "eight or more cards are in your graveyard" (the number of cards in your graveyard; "there are N or more cards in your graveyard" is `thereAre`). */
function graveyardSize(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const c of cmpAt(ctx, pos)) {
    if (c.cmp.op !== '>=') continue;
    const e = phraseAt(ctx, c.end, W_CARDS_ARE_IN_YOUR_GRAVEYARD);
    if (e >= 0) out.push({ end: e, value: compare({ q: 'zoneSize', zone: 'graveyard', of: { ref: 'you' } }, '>=', c.cmp.value) });
  }
  return out;
}

/**
 * FAST5 T53 (CR 402.1, 102.3): "an opponent has more cards in hand than you": at least one opponent has a bigger hand than you (`countPlayers.sizeVs`), however many
 * opponents there are. A hand changes during a turn, so it is checked when the trigger is checked and as it resolves, not as an ability is announced.
 */
function opponentHandSize(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_OPPONENT_MORE_CARDS_IN_HAND);
  if (e < 0) return [];
  return [{ end: e, value: compare({ q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, sizeVs: { zone: 'hand', op: '>', than: { ref: 'you' } } }, '>=', 1) }];
}

/**
 * Standard round 6 (CR 119.1, 102.3): "an opponent has more life than you" (Beza, the Bounding Spring): at least one opponent's life total is greater than yours
 * (`countPlayers.lifeVs`, as "no opponent has more life than you" with a count of 1 or more). Life changes during a turn, so it is checked as the ability resolves.
 */
function opponentMoreLife(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_OPPONENT_MORE_LIFE);
  if (e < 0) return [];
  return [{ end: e, value: compare({ q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, lifeVs: { op: '>', than: { ref: 'you' } } }, '>=', 1) }];
}

const W_SPELL_WARPED = P('a spell was warped this turn');

/**
 * FAST5X E2 (CR 702.185c): "a spell was warped this turn": a spell was cast for its warp cost this turn, by any player (a copy is not cast, CR 707.10). With
 * "a nonland permanent left the battlefield this turn" (`zoneHistory`) and the "or" chain below it is the condition of the void ability word (CR 207.2c).
 */
function warped(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_SPELL_WARPED);
  return e >= 0 ? [{ end: e, value: { cond: 'happened', event: { ev: 'cast', via: 'warp' }, scope: 'turn' } }] : [];
}

const W_MOST_COMMON = P('is the most common color among all permanents or is tied for most common');
const ALL_COLORS: readonly Color[] = ['W', 'U', 'B', 'R', 'G'];

/**
 * FAST5 T37 (CR 105.1, 202.2): "white is the most common color among all permanents or is tied for most common" (the Djinns of Arabian Nights, Heroic
 * Defiance's relatives): no other color is shared by MORE permanents than white is. Each permanent counts once for each of its colors (a multicolored one for
 * every color, a colorless one for none), so it is `all` of the comparisons "the permanents of this color are at least as many as the permanents of that
 * color" over the other four colors, which the statics evaluate as they stand (render/cond.ts#mostCommonColorPhrase writes it back).
 */
export function mostCommonColor(color: Color): Condition {
  const count = (c: Color): Quantity => ({ q: 'count', of: { ref: 'each', filter: { colors: [c] } } });
  return { cond: 'all', of: ALL_COLORS.filter((c) => c !== color).map((c) => compare(count(color), '>=', count(c))) };
}

const W_GREATEST_POWER_OR_TIED = P('you control the creature with the greatest power or tied for the greatest power');
const YOUR_CREATURES: ObjRef = { ref: 'each', filter: { types: ['Creature'], controller: 'you' } };

/**
 * Cloud std-fin (CR 208.1, 608.2h): "you control the creature with the greatest power or tied for the greatest power" (Summon: Fenrir, the Triumphs): you control a
 * creature, and the greatest power among the creatures you control is at least the greatest power among all creatures. Read when the condition is checked.
 */
export const GREATEST_POWER_OR_TIED: Condition = {
  cond: 'all',
  of: [
    { cond: 'exists', of: YOUR_CREATURES },
    { cond: 'compare', left: { q: 'stat', stat: 'power', of: YOUR_CREATURES, agg: 'max' }, op: '>=', right: { q: 'stat', stat: 'power', of: { ref: 'each', filter: { types: ['Creature'] } }, agg: 'max' } },
  ],
};

function greatestPowerOrTied(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_GREATEST_POWER_OR_TIED);
  return e >= 0 ? [{ end: e, value: GREATEST_POWER_OR_TIED }] : [];
}

/** "white is the most common color among all permanents or is tied for most common". */
function mostCommon(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const c of ctx.call('Color', pos)) {
    const e = phraseAt(ctx, c.end, W_MOST_COMMON);
    if (e >= 0) out.push({ end: e, value: mostCommonColor(c.value as Color) });
  }
  return out;
}

const W_MANA_WAS_SPENT_TO_CAST = P('mana was spent to cast');
const W_UNSPENT_MANA = P('unspent mana');

/** FAST5X E19 (CR 106.4): "you have six or more unspent mana": the mana in the controller's mana pool (`unspentMana`). */
function unspentMana(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const h = phraseAt(ctx, pos, W_YOU_HAVE);
  if (h < 0) return out;
  for (const c of cmpAt(ctx, h)) {
    if (c.cmp.op !== '>=') continue;
    const e = phraseAt(ctx, c.end, W_UNSPENT_MANA);
    if (e >= 0) out.push({ end: e, value: compare({ q: 'unspentMana' }, '>=', c.cmp.value) });
  }
  return out;
}

/**
 * FAST5X E19 (CR 601.2h; opus, CR 207.2c): "five or more mana was spent to cast that spell", "at least four mana was spent to cast it": the amount of mana
 * spent to cast a spell (`spellManaSpent`, its `of` the spell named: the anaphor resolves to the triggering cast event's spell, or `~` itself), compared with
 * a number. Only "N or more" / "at least N": a bare number is never "at least" (this hole's rule), and "no mana" is another condition (not read here).
 */
function manaSpent(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const c of cmpAt(ctx, pos)) {
    if (c.cmp.op !== '>=') continue;
    const e = phraseAt(ctx, c.end, W_MANA_WAS_SPENT_TO_CAST);
    if (e < 0) continue;
    for (const o of spentObjects(ctx, e)) out.push({ end: o.end, value: compare({ q: 'spellManaSpent', of: o.value }, '>=', c.cmp.value), ...(o.flags ? { flags: o.flags } : {}) });
  }
  out.push(...adamant(ctx, pos), ...t51ManaSpent(ctx, pos));
  return out;
}

/**
 * std-rx25 (CR 601.2h, 106.1; adamant): "at least three black mana was spent to cast ~" as a condition of its own ("If at least three black mana was spent to
 * cast this spell, create a Food token."): at least that many mana of that color paid for the object itself (`wasCast.spent`, the condition T37's
 * rep.t37.enters.counter.adamant states and T51's "{B}{B}{B} was spent to cast it" reads). Only "at least N" / "N or more" with a literal number; `$self` is
 * resolved as T51's (parser/lower/ability.ts: `~` drops it).
 */
function adamant(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const c of cmpAt(ctx, pos)) {
    const n = c.cmp.value as unknown;
    if (c.cmp.op !== '>=' || typeof n !== 'number' || !Number.isInteger(n) || n < 1) continue;
    for (const col of ctx.call('Color', c.end)) {
      const e = phraseAt(ctx, col.end, W_MANA_WAS_SPENT_TO_CAST);
      if (e < 0) continue;
      for (const o of spentObjects(ctx, e)) out.push({ end: o.end, value: { cond: 'wasCast', spent: { color: col.value as Color, atLeast: n }, $self: o.value } as never, ...(o.flags ? { flags: o.flags } : {}) });
    }
  }
  return out;
}

const W_AMOUNT_SPENT_TO_CAST = P('the amount of mana spent to cast');
const W_NOT_CAST_OR_FREE = [P("it wasn't cast or no mana was spent to cast it"), P('it was not cast or no mana was spent to cast it')];
const W_WAS_SPENT_TO_CAST_IT = P('was spent to cast it');
const SPENT_SYMBOLS: Readonly<Record<string, Color>> = { '{w}': 'W', '{u}': 'U', '{b}': 'B', '{r}': 'R', '{g}': 'G' };

/**
 * FAST5 T51 (CR 601.2h): the rest of the mana-spent conditions, on top of E19's "N or more mana was spent to cast it":
 *  - "the amount of mana spent to cast it was less than its mana value" (Tokka & Rahzar): the spell of a cast trigger (`spellManaSpent`, `of` the pronoun or
 *    "that spell", resolved as E19's), compared with a quantity;
 *  - "it wasn't cast or no mana was spent to cast it" (Freestrider Commando): no mana spent on the object itself (`manaSpent` of T42 is 0 for an object that was
 *    not cast, CR 601.2h), `$self` as "it was kicked": only the object's own pronoun stays;
 *  - "{R}{R} was spent to cast it" (the evoke Incarnations): at least that many mana of that color paid for the object itself (`wasCast.spent`, T37's adamant).
 */
function t51ManaSpent(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const amount = phraseAt(ctx, pos, W_AMOUNT_SPENT_TO_CAST);
  if (amount >= 0) {
    for (const o of spentObjects(ctx, amount)) {
      const was = phraseAt(ctx, o.end, W_WAS);
      if (was < 0) continue;
      for (const [ws, op] of [[P('less than'), '<'], [P('greater than'), '>'], [P('more than'), '>']] as const) {
        const e = phraseAt(ctx, was, ws);
        if (e >= 0) for (const q of ctx.call('Qty', e)) out.push({ end: q.end, value: compare({ q: 'spellManaSpent', of: o.value }, op, q.value as Quantity), ...(o.flags ? { flags: o.flags } : {}) });
      }
    }
  }
  const it = (): Json => anaphorObj({ sort: 'object', number: 'singular', text: 'it' });
  for (const w of W_NOT_CAST_OR_FREE) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: { ...compare({ q: 'manaSpent' }, '==', 0), $self: it() } });
  }
  const first = ctx.toks[pos];
  const color = first !== undefined && first.kind === 'MANA' ? SPENT_SYMBOLS[first.norm] : undefined;
  if (color !== undefined) {
    let end = pos;
    while (ctx.toks[end] !== undefined && ctx.toks[end]!.norm === first!.norm) end++;
    const e = phraseAt(ctx, end, W_WAS_SPENT_TO_CAST_IT);
    if (e >= 0) out.push({ end: e, value: { cond: 'wasCast', spent: { color, atLeast: end - pos }, $self: it() } });
    // std-rx34 (CR 601.2h, 106.1): "If {G} was spent to cast this spell" (the Shadowmoor and Eventide hybrid spells, Vigor Mortis): the same condition on the
    // spell itself (`wasCast` reads the source's own cast, so no `$self` marker is left for a target's condition to resolve)
    const cast = phraseAt(ctx, end, W_WAS_SPENT_TO_CAST);
    if (cast >= 0) for (const o of spentObjects(ctx, cast)) if ((o.value as { ref?: string }).ref === 'self') out.push({ end: o.end, value: { cond: 'wasCast', spent: { color, atLeast: end - pos } } });
  }
  return out;
}

const W_DESCENDED = P('you descended this turn');
const W_GAINED_OR_LOST = [P('you gained or lost life this turn'), P("you've gained or lost life this turn")];
const W_GAINED_AND_LOST = [P('you gained and lost life this turn'), P("you've gained and lost life this turn")];
const W_DIDNT_CAST_SPELL = [P("you didn't cast a spell this turn"), P('you did not cast a spell this turn'), P("you haven't cast a spell this turn")];
const W_SACRIFICED = [P('you sacrificed'), P("you've sacrificed")];
const W_LEFT_YOUR_GRAVEYARD = [P('left your graveyard this turn')];
const W_PUT_INTO_EXILE = [P('were put into exile this turn')];
const W_WAS_PUT_INTO_EXILE = P('was put into exile this turn'); // std-library-4
const W_PUT_INTO_GRAVEYARDS = P('were put into graveyards from anywhere this turn'); // std-mkm

/** FAST5X E22: the life history of "you" this turn, one event of each kind (CR 119.3, 119.9, 119.10: gaining or losing 0 life is no event). */
const lifeHappened = (change: 'gain' | 'loss'): Condition => ({ cond: 'happened', event: { ev: 'life', change, player: 'you' }, scope: 'turn' });
/** FAST5X E22 (CR 700.11): "you descended this turn": one or more permanent cards were put into your graveyard from anywhere this turn. */
export const descendedThisTurn = (): Condition => compare({ q: 'descendedThisTurn' }, '>=', 1);

/**
 * FAST5X E22: the turn's history of the Lost Caverns of Ixalan and Tarkir/Bloomburrow-era intervening "if" clauses (CR 603.4):
 *  - "you descended this turn" (CR 700.11): a permanent card was put into your graveyard from anywhere this turn (`descendedThisTurn` >= 1, turnStats);
 *  - "you gained or lost life this turn" / "you gained and lost life this turn" (CR 119.3, 119.9, 119.10): either / both of a gain and a loss happened, each
 *    of any nonzero amount (not a net change);
 *  - "you didn't cast a spell this turn" (CR 601.2i: a copy is not cast, CR 707.10);
 *  - "a card left your graveyard this turn" (CR 400.3: a card in a graveyard is in its owner's; a token is no card);
 *  - "one or more cards were put into exile this turn" (any player's cards, from anywhere; a token is no card, CR 111.1);
 *  - "you sacrificed a permanent this turn", "you sacrificed one or more permanents this turn", "you sacrificed N or more permanents this turn" (CR 701.21a:
 *    the controller sacrifices; a sacrifice as a cost counts, CR 118.3).
 * The history forms are read when the trigger is checked and as it resolves; as an activation restriction they stay the controller's attestation like the other
 * history conditions (`unannounced`).
 */
function e22History(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const at = (ws: readonly (readonly string[])[], value: () => Condition): void => {
    for (const w of ws) { const e = phraseAt(ctx, pos, w); if (e >= 0) out.push({ end: e, value: value() }); }
  };
  at(W_GAINED_OR_LOST, () => ({ cond: 'any', of: [lifeHappened('gain'), lifeHappened('loss')] }));
  at(W_GAINED_AND_LOST, () => ({ cond: 'all', of: [lifeHappened('gain'), lifeHappened('loss')] }));
  at(W_DIDNT_CAST_SPELL, () => ({ cond: 'not', of: { cond: 'happened', event: { ev: 'cast', player: 'you' }, scope: 'turn' } }));
  const leftYours = { ev: 'zoneChange', subject: { isCard: true, owner: 'you' }, from: 'graveyard' } as const;
  const t = ctx.toks[pos]?.norm;
  if (t === 'a') {
    const card = phraseAt(ctx, pos + 1, P('card'));
    for (const w of card >= 0 ? W_LEFT_YOUR_GRAVEYARD : []) { const e = phraseAt(ctx, card, w); if (e >= 0) out.push({ end: e, value: { cond: 'happened', event: leftYours, scope: 'turn' } }); }
    // std-library-4 (CR 406.1, 603.4): "if a card was put into exile this turn" (Ashiok, Wicked Manipulator's Nightmare tokens): the singular of "two or more cards were put
    // into exile this turn" below, one or more cards of any owner moved to exile this turn (a token is no card, CR 108.2)
    const exiled = card >= 0 ? phraseAt(ctx, card, W_WAS_PUT_INTO_EXILE) : -1;
    if (exiled >= 0) out.push({ end: exiled, value: { cond: 'happened', event: { ev: 'zoneChange', subject: { isCard: true }, to: 'exile' }, scope: 'turn' } });
  }
  for (const c of cmpAt(ctx, pos)) {
    if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number' || c.cmp.value < 1) continue;
    const cards = phraseAt(ctx, c.end, P('cards'));
    if (cards < 0) continue;
    const times = c.cmp.value > 1 ? { times: c.cmp } : {};
    // "one or more cards left your graveyard this turn" is not read here: the cost reduction of that wording is a template of its own (zz-fast4/t32.json,
    // cm.t32.self.less.cardsLeftGraveyard), and a second reading would make it ambiguous (G5)
    for (const w of W_PUT_INTO_EXILE) { const e = phraseAt(ctx, cards, w); if (e >= 0) out.push({ end: e, value: { cond: 'happened', event: { ev: 'zoneChange', subject: { isCard: true }, to: 'exile' }, scope: 'turn', ...times } }); }
    // std-blb (CR 400.3, 603.4): "three or more cards left your graveyard this turn", the counted form of "a card left your graveyard this turn" (render/cond.ts
    // says it back), as an activation restriction or an intervening if. Not after "less to cast if" (t32's cost reduction above reads that sentence, any count)
    const costReduction = ['less', 'to', 'cast', 'if'].every((w, i) => ctx.toks[pos - 4 + i]?.norm === w);
    if (c.cmp.value > 1 && !costReduction) for (const w of W_LEFT_YOUR_GRAVEYARD) { const e = phraseAt(ctx, cards, w); if (e >= 0) out.push({ end: e, value: { cond: 'happened', event: leftYours, scope: 'turn', ...times } }); }
  }
  // std-mkm (CR 400.3, 603.4, 719.3a): "three or more creature cards were put into graveyards from anywhere this turn" (Case of the Gorgon's Kiss): cards of a
  // description (a token is no card, CR 111.1) put into any graveyard, from any zone, at least N of them; only a description of cards with no owner or zone
  for (const c of cmpAt(ctx, pos)) {
    if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number' || c.cmp.value < 2) continue;
    for (const n of npAlts(ctx, c.end)) {
      const f = n.filter;
      if (n.number !== 'plural' || n.head !== 'card' || f.zone !== undefined || f.owner !== undefined || f.controller !== undefined || Object.keys(f).every((k) => k === 'isCard')) continue;
      const e = phraseAt(ctx, n.end, W_PUT_INTO_GRAVEYARDS);
      if (e >= 0) out.push({ end: e, value: { cond: 'happened', event: { ev: 'zoneChange', subject: { ...f, isCard: true }, to: 'graveyard' }, scope: 'turn', times: c.cmp }, ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
    }
  }
  const sacrificed: Condition = { cond: 'happened', event: { ev: 'action', verb: 'sacrifice', actor: 'you' }, scope: 'turn' };
  for (const w of W_SACRIFICED) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    const a = phraseAt(ctx, e, P('a permanent this turn'));
    if (a >= 0) out.push({ end: a, value: sacrificed });
    // FAST5 T63 (CR 701.21a, 118.3): "you've sacrificed an artifact this turn": a permanent matching the description was sacrificed by you this turn (the
    // description is judged as the permanent last existed on the battlefield). "a permanent" has no description and is read above (one reading only, G5)
    const art = ctx.toks[e]?.norm;
    if (art === 'a' || art === 'an') {
      for (const n of npAlts(ctx, e + 1)) {
        const th = n.number === 'singular' && Object.keys(n.filter).length > 0 ? phraseAt(ctx, n.end, P('this turn')) : -1;
        if (th >= 0) out.push({ end: th, value: { ...sacrificed, event: { ...sacrificed.event, object: n.filter } } as Condition, ...(n.flags.length > 0 ? { flags: n.flags } : {}) });
      }
    }
    for (const c of cmpAt(ctx, e)) {
      if (c.cmp.op !== '>=' || typeof c.cmp.value !== 'number' || c.cmp.value < 1) continue;
      const p = phraseAt(ctx, c.end, P('permanents this turn'));
      if (p >= 0) out.push({ end: p, value: c.cmp.value > 1 ? { ...sacrificed, times: c.cmp } : sacrificed });
    }
  }
  return out;
}

/**
 * FAST5 T63 (CR 500.1, 603.4): "it's your first, second, or third turn of the game" (a land that enters untapped early, Starting Town): it is your turn and the
 * number of turns of yours that have begun this game, this one included, is at most that ordinal. Up to the fourth ordinal; "or" without a comma for two.
 */
const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth'] as const;
const earlyTurnWords = (n: number): string[] => {
  const w = ORDINAL_WORDS.slice(0, n);
  return n === 1 ? ['first'] : n === 2 ? ['first', 'or', 'second'] : [...w.slice(0, -1).flatMap((x) => [x, ',']), 'or', w[n - 1]!];
};
export const earlyTurnCond = (n: number): Condition => ({
  cond: 'all',
  of: [{ cond: 'turnOf', whose: 'you' }, compare({ q: 'happenedCount', event: { ev: 'beginTurn', whose: 'you' }, scope: 'game' }, '<=', n)],
});
function earlyTurn(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const lead of [P("it's your"), P('it is your')]) {
    const l = phraseAt(ctx, pos, lead);
    if (l < 0) continue;
    for (let n = 1; n <= ORDINAL_WORDS.length; n++) {
      const e = phraseAt(ctx, l, [...earlyTurnWords(n), 'turn', 'of', 'the', 'game']);
      if (e >= 0) out.push({ end: e, value: earlyTurnCond(n) });
    }
  }
  return out;
}

const W_MANA_FROM = P('mana from');
const W_WAS_SPENT_TO_CAST = P('was spent to cast');

/**
 * FAST5X E19 (CR 106.3, 601.2h): "mana from a Treasure was spent to cast it": at least one mana spent to cast the spell came from a source with that subtype
 * as it produced the mana (`spellManaSpent.from`, one subtype only: effects/eval.ts#manaFromSubtype).
 */
function manaFrom(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const m = phraseAt(ctx, pos, W_MANA_FROM);
  if (m < 0 || (ctx.toks[m]?.norm !== 'a' && ctx.toks[m]?.norm !== 'an')) return out;
  for (const n of npAlts(ctx, m + 1)) {
    if (n.number !== 'singular' || Object.keys(n.filter).length !== 1 || n.filter.subtypes?.length !== 1) continue;
    const e = phraseAt(ctx, n.end, W_WAS_SPENT_TO_CAST);
    if (e < 0) continue;
    for (const o of spentObjects(ctx, e)) out.push({ end: o.end, value: compare({ q: 'spellManaSpent', of: o.value, from: n.filter }, '>=', 1), ...(o.flags ? { flags: o.flags } : {}) });
  }
  return out;
}

/** FAST5X E19: the spell "N mana was spent to cast": `~`, "it" or "that spell" (an anaphor the unique-candidate rule resolves, lower/anaphora.ts). */
export function spentObjects(ctx: HoleCtx, pos: number): { end: number; value: never; flags?: string[] }[] {
  return ctx.call('Obj', pos).filter((o) => {
    const v = o.value as { ref?: string; $anaphor?: { head?: string; text?: string } };
    if (v.ref === 'self') return true;
    const a = v.$anaphor;
    return a !== undefined && (a.head === 'spell' || (a.head === undefined && a.text === 'it'));
  }).map((o) => ({ end: o.end, value: o.value as never, ...(o.flags ? { flags: o.flags } : {}) }));
}

/** FAST5X E22 (CR 700.11): "you descended this turn" (a turn statistic, current at any time: also readable while a spell or ability is announced). */
function descended(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_DESCENDED);
  return e >= 0 ? [{ end: e, value: descendedThisTurn() }] : [];
}

const W_LOST_LIFE_THIS_WAY = P('lost life this way');

/**
 * Cloud std-spm (CR 119.3, 608.2c): "you lost life this way" (Mister Negative: "you may exchange life totals with target opponent. If you lost life this way,
 * draw that many cards"): that player lost life in the instruction RIGHT BEFORE, the life it made them lose (`{q:'lifeLost', who}`) above 0. The `$step`
 * marker is resolved as the one of "the life lost this way" is (parser/lower/conditions.ts#resolveLifeLost).
 */
function lostLifeThisWay(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const p of ctx.call('Player', pos)) {
    const e = phraseAt(ctx, p.end, W_LOST_LIFE_THIS_WAY);
    if (e < 0) continue;
    const lost = { q: 'lifeLost', step: '', $step: 'previous', who: p.value };
    out.push({ end: e, value: { cond: 'compare', left: lost, op: '>', right: 0 } as never, ...(p.flags ? { flags: p.flags } : {}) });
  }
  return out;
}

/**
 * Cloud std-woe (CR 506.4, 508.1k, 509.1g, 701.26a): "if a Rat is attacking", "if a creature is attacking", "if a black creature with flying is attacking": a
 * permanent of that description has that status right now, which is the existence of an attacking Rat (`exists`, as "you control a ..."; the status is one
 * of the bare statuses a noun phrase also takes in front of its noun, "an attacking Rat"). One status only, a singular noun phrase after "a", "an" or
 * "another"; no controller is implied (render/cond.ts#existsPhrase says it back, family exists-is-status).
 */
function indefiniteStatus(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const t = ctx.toks[pos]?.norm;
  if (t !== 'a' && t !== 'an' && t !== 'another') return out;
  for (const n of npAlts(ctx, pos + 1)) {
    if (n.number !== 'singular' || n.head === 'mods') continue;
    const is = phraseAt(ctx, n.end, P('is'));
    if (is < 0) continue;
    for (const m of npAlts(ctx, is, { bare: true })) {
      const keys = Object.keys(m.filter);
      if (m.head !== 'mods' || keys.length !== 1 || !(m.filter.attacking === true || m.filter.blocking === true || m.filter.tapped !== undefined)) continue;
      const f = mergeFilter(n.filter, t === 'another' ? { ...m.filter, other: true } : m.filter);
      if (f) out.push({ end: m.end, value: exists(f), ...(n.flags.length > 0 ? { flags: [...n.flags] } : {}) });
    }
  }
  return out;
}

const W_NO_OPPONENT_MORE_LIFE = P('no opponent has more life than'); // cmd1

/**
 * cmd1 (CR 119.1, 102.1, 603.4): "no opponent has more life than that player" (the attacked player of "whenever this creature attacks a player", a Background's
 * granted trigger) and "no opponent has more life than you": the number of opponents whose life total is greater than that player's is zero (std-lci's
 * `countPlayers` with `lifeVs`). The player is any player phrase; a pronoun is resolved against the trigger's event roles by the lowering.
 */
function noOpponentMoreLife(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_NO_OPPONENT_MORE_LIFE);
  if (e < 0) return [];
  return ctx.call('Player', e).map((p) => ({ end: p.end, value: compare({ q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, lifeVs: { op: '>', than: p.value as never } }, '==', 0), ...(p.flags ? { flags: p.flags } : {}) }));
}

const W_AN_OPPONENT_HAS = P('an opponent has'); // r4-static
const W_CARDS_IN_THEIR_GRAVEYARD = P('cards in their graveyard'); // std-rx21

/**
 * r4-static (CR 119.1): "an opponent has 10 or less life" (Bloodghast): at least one opponent's life total is at most (or at least) a fixed number, the count of
 * opponents with that life total (`countPlayers` with `lifeIs`) of 1 or more. Only a literal number and "or less" / "or fewer" / "or more" / "or greater".
 */
function opponentHasLife(ctx: HoleCtx, pos: number): Alt[] {
  const e = phraseAt(ctx, pos, W_AN_OPPONENT_HAS);
  if (e < 0) return [];
  const out: Alt[] = [];
  for (const c of cmpAt(ctx, e)) {
    const l = phraseAt(ctx, c.end, W_LIFE);
    if (l < 0 || typeof c.cmp.value !== 'number' || (c.cmp.op !== '<=' && c.cmp.op !== '>=')) continue;
    out.push({ end: l, value: compare({ q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, lifeIs: { op: c.cmp.op, n: c.cmp.value } }, '>=', 1) });
  }
  // std-rx21 (CR 404.1, 102.3; Into the Story, Merfolk Windrobber): "an opponent has eight or more cards in their graveyard": at least one opponent, judged alone,
  // has at least that many cards in their own graveyard (`countPlayers` with `sizeIs`). Only "or more" / "or greater", the only form printed.
  for (const c of cmpAt(ctx, e)) {
    if (typeof c.cmp.value !== 'number' || c.cmp.op !== '>=') continue;
    const g = phraseAt(ctx, c.end, W_CARDS_IN_THEIR_GRAVEYARD);
    if (g >= 0) out.push({ end: g, value: compare({ q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, sizeIs: { zone: 'graveyard', op: '>=', n: c.cmp.value } }, '>=', 1) });
  }
  return out;
}

/**
 * std-rx24 (CR 122.1f, 104.3d): poison counters of players. "an opponent has three or more poison counters" (corrupted, Apostle of Invasion): at least one opponent
 * has at least that many (`countPlayers` with `poisonIs`, as r4-static's life total); "<player> has three or more poison counters" of one player ("its controller",
 * "defending player", "target player", "you have ...") is that player's poison counters (`counters` of kind poison on the player, effects/eval.ts). A player with one or
 * more poison counters is "poisoned" (CR 122.1f, unverified from the cloud), so "defending player is poisoned" and "an opponent is poisoned" are the same counts
 * of 1 or more. Only a literal number and "or more" / "or greater"; a group of players other than "an opponent" ("each opponent", "a player") is not read.
 */
const W_POISON_COUNTERS = P('poison counters');
const W_IS_POISONED = [P('is poisoned'), P('are poisoned')];
const ONE_PLAYER_REFS = new Set(['you', 'target', 'controllerOf', 'ownerOf', 'event', 'bound', 'linked', 'active', 'defending', 'iterating']);
function poisonCounters(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const opp = (n: number): Condition => compare({ q: 'countPlayers', of: { ref: 'each', who: 'opponent' }, poisonIs: { op: '>=', n } }, '>=', 1);
  const e = phraseAt(ctx, pos, W_AN_OPPONENT_HAS);
  if (e >= 0) {
    for (const c of cmpAt(ctx, e)) {
      const w = phraseAt(ctx, c.end, W_POISON_COUNTERS);
      if (w >= 0 && c.cmp.op === '>=' && typeof c.cmp.value === 'number' && c.cmp.value >= 1) out.push({ end: w, value: opp(c.cmp.value) });
    }
  }
  for (const w of W_IS_POISONED) { const o = phraseAt(ctx, pos, [...P('an opponent'), ...w]); if (o >= 0) out.push({ end: o, value: opp(1) }); }
  for (const p of ctx.call('Player', pos)) {
    const v = p.value as Record<string, unknown>;
    if (v === null || typeof v !== 'object' || !('$anaphor' in v || ONE_PLAYER_REFS.has(String(v['ref'])))) continue;
    const of = (n: number): Alt => ({ end: 0, value: compare({ q: 'counters', on: v as never, kind: 'poison' }, '>=', n), ...(p.flags ? { flags: p.flags } : {}) });
    for (const w of W_IS_POISONED) { const i = phraseAt(ctx, p.end, w); if (i >= 0) out.push({ ...of(1), end: i }); }
    for (const h of W_HAS) {
      const has = phraseAt(ctx, p.end, h);
      if (has < 0) continue;
      for (const c of cmpAt(ctx, has)) {
        const w = phraseAt(ctx, c.end, W_POISON_COUNTERS);
        if (w >= 0 && c.cmp.op === '>=' && typeof c.cmp.value === 'number' && c.cmp.value >= 1) out.push({ ...of(c.cmp.value), end: w });
      }
    }
  }
  return out;
}

/**
 * Standard round P (CR 119.3, 120.3a; Sygg, River Cutthroat): "an opponent lost 3 or more life this turn", "a player lost 4 or more life this turn": at least one of
 * those players lost at least that much life this turn, damage included (`countPlayers` with `lostLifeIs`, the players' `turnStats.lifeLost`); and "you lost 2 or more
 * life this turn", the life you lost this turn (`lifeLostThisTurn`). Only a literal number and "or more" / "or greater".
 */
const W_LOST_LIFE_WHO: readonly [string[], 'opponent' | 'player' | 'you'][] = [[P('an opponent lost'), 'opponent'], [P('a player lost'), 'player'], [P('you lost'), 'you'], [P("you've lost"), 'you']];
const W_LIFE_THIS_TURN = P('life this turn');
function lostLifeAtLeast(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const [w, who] of W_LOST_LIFE_WHO) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    for (const c of cmpAt(ctx, e)) {
      const l = phraseAt(ctx, c.end, W_LIFE_THIS_TURN);
      if (l < 0 || typeof c.cmp.value !== 'number' || c.cmp.op !== '>=') continue;
      const value = who === 'you'
        ? compare({ q: 'lifeLostThisTurn', of: { ref: 'you' } }, '>=', c.cmp.value)
        : compare({ q: 'countPlayers', of: { ref: 'each', who }, lostLifeIs: { op: '>=', n: c.cmp.value } }, '>=', 1);
      out.push({ end: l, value });
    }
  }
  return out;
}

/**
 * std-rx4 (CR 119.3, 120.3a, 608.2c; Thought-Stalker Warlock): "they lost life this turn", "that player lost life this turn": the player an earlier instruction
 * named (an anaphor the anaphora pass resolves, lower/anaphora.ts; a chosen target opponent) lost life this turn, damage included: the life they lost this turn
 * (`lifeLostThisTurn`, the player's `turnStats.lifeLost`) is 1 or more. Only a player anaphor; "you lost life this turn" stays the history reading above.
 */
const W_LOST_LIFE_THIS_TURN = P('lost life this turn');
function anaphorLostLife(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const p of ctx.call('Player', pos)) {
    const v = p.value as Record<string, unknown>;
    if (v === null || typeof v !== 'object' || !('$anaphor' in v)) continue;
    const e = phraseAt(ctx, p.end, W_LOST_LIFE_THIS_TURN);
    if (e >= 0) out.push({ end: e, value: compare({ q: 'lifeLostThisTurn', of: v as never }, '>=', 1), ...(p.flags ? { flags: p.flags } : {}) });
  }
  return out;
}

const W_FIRST_TIME = [P("it's the first time"), P('it is the first time')]; // Standard round 5, r5-trig
const W_HAS_BECOME_TAPPED = P('has become tapped this turn');
const W_COUNTERS_PUT_ON = [P('counters have been put on'), P('one or more counters have been put on')];

/**
 * Standard round 5, r5-trig (CR 603.4, 603.2c): "it's the first time that creature has become tapped this turn" (Captain America, Living Legend) and "it's the first
 * time counters have been put on that creature this turn" (Stalwart Successor): `firstTime` over the turn's history of that object. Only a reference back to an
 * object the ability already named (an anaphor, as "you controlled that creature"), never a description; "this turn" is required for the counters form.
 */
function firstTime(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const anaphors = (at: number): Alt[] => ctx.call('Obj', at).filter((o) => {
    const v = o.value as { $anaphor?: unknown } | null;
    return v !== null && typeof v === 'object' && v.$anaphor !== null && typeof v.$anaphor === 'object';
  });
  for (const w of W_FIRST_TIME) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    for (const o of anaphors(e)) {
      const end = phraseAt(ctx, o.end, W_HAS_BECOME_TAPPED);
      if (end >= 0) out.push({ end, value: { cond: 'firstTime', object: o.value as never, event: { ev: 'becomes', what: 'tapped', object: {} } } });
    }
    for (const c of W_COUNTERS_PUT_ON) {
      const on = phraseAt(ctx, e, c);
      if (on < 0) continue;
      for (const o of anaphors(on)) {
        const end = phraseAt(ctx, o.end, W_THIS_TURN);
        if (end >= 0) out.push({ end, value: { cond: 'firstTime', object: o.value as never, event: { ev: 'counters', change: 'put', on: {} } } });
      }
    }
  }
  return out;
}

/**
 * Standard round 5, r5-trig (CR 603.4, 603.6a, 601.2h): conditions over the objects of a "one or more" trigger, named "them" (the anaphora pass resolves it to the
 * event's objects): "none of them were cast or no mana was spent to cast them" (Satoru, the Infiltrator: every one of them was not cast or was cast with no
 * mana, `castWithMana: false`), and "one or more of them entered from <zone> or was cast from <zone>" (Extraordinary Journey: `someMatch`).
 */
const W_NONE_CAST_OR_NO_MANA = P('none of them were cast or no mana was spent to cast them');
const W_SOME_ENTERED_OR_CAST_FROM: [string[], 'exile' | 'graveyard'][] = [
  [P('one or more of them entered from exile or was cast from exile'), 'exile'],
  [P('one or more of them entered from a graveyard or was cast from a graveyard'), 'graveyard'],
  [P('they entered or were cast from a graveyard'), 'graveyard'], // std-rj (Twilight Diviner): the same condition, one of the objects of the batch (an inference: no CR text decides "they" in a batch trigger)
];
function batchCast(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  const them = (): Json => anaphorObj({ sort: 'object', number: 'plural', text: 'them' });
  const n = phraseAt(ctx, pos, W_NONE_CAST_OR_NO_MANA);
  if (n >= 0) out.push({ end: n, value: { cond: 'matches', object: them(), filter: { castWithMana: false } } });
  for (const [w, zone] of W_SOME_ENTERED_OR_CAST_FROM) {
    const e = phraseAt(ctx, pos, w);
    if (e >= 0) out.push({ end: e, value: { cond: 'someMatch', object: them(), filter: { anyOf: [{ enteredFrom: zone }, { castFrom: zone }] } } });
  }
  return out;
}

/**
 * Standard round 5, r5-trig (CR 305.1, 601.2a, 603.4; Spider-Man 2099): "you've played a land or cast a spell this turn from anywhere other than your hand": either a land
 * play or a spell cast this turn by you, from a zone other than your hand (the history's `from` of each: `notFrom`, as r4-trig's event reads the same words)
 */
const W_PLAYED_OR_CAST_ELSEWHERE = [P("you've played a land or cast a spell this turn from anywhere other than your hand"), P('you have played a land or cast a spell this turn from anywhere other than your hand')];
const playedOrCastElsewhere = (): Condition => ({ cond: 'any', of: [
  { cond: 'happened', event: { ev: 'action', verb: 'playLand', actor: 'you', notFrom: 'hand' }, scope: 'turn' },
  { cond: 'happened', event: { ev: 'cast', player: 'you', notFrom: 'hand' }, scope: 'turn' },
] });

/**
 * std-combat-1 (CR 603.4, 506.3, 508.1b, 508.5; Tomik, Wielder of Law): "two or more of those creatures are attacking you and/or planeswalkers you control" in the intervening
 * "if" of a "<player> attacks with creatures" trigger: at least N of the creatures of the declaration (the event's attackers, "those creatures") are attacking you or a
 * planeswalker you control (`attacking.orPlaneswalker`); read when the ability triggers and again as it resolves (CR 603.4), so a creature removed from combat no longer
 * counts. Only "<N> or more" with a number.
 */
const W_OR_MORE_OF_THOSE_CREATURES_ATTACKING = P('or more of those creatures are attacking');
const W_YOU_AND_OR_YOUR_PLANESWALKERS = P('you and/or planeswalkers you control');
function thoseAttackingYou(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const q of ctx.call('Qty', pos)) {
    if (typeof q.value !== 'number' || q.value < 1) continue;
    const a = phraseAt(ctx, q.end, W_OR_MORE_OF_THOSE_CREATURES_ATTACKING);
    const e = a >= 0 ? phraseAt(ctx, a, W_YOU_AND_OR_YOUR_PLANESWALKERS) : -1;
    if (e < 0) continue;
    const those = anaphorObj({ sort: 'object', number: 'plural', head: 'creature', text: 'those creatures' });
    const counted = { ref: 'each', filter: { is: those, attacking: { defender: 'you', orPlaneswalker: true } } };
    out.push({ end: e, value: { cond: 'compare', left: { q: 'count', of: counted }, op: '>=', right: q.value } as unknown as Condition });
  }
  return out;
}

function atoms(ctx: HoleCtx, pos: number): Alt[] {
  return [...control(ctx, pos), ...thereAre(ctx, pos), ...youHave(ctx, pos), ...lifeAtMostHalfStarting(ctx, pos) /* r5-fxb */, ...lifeAtLeastNAboveStarting(ctx, pos) /* std-rh */, ...misc(ctx, pos), ...matches(ctx, pos), ...compareForm(ctx, pos), ...history(ctx, pos), ...ownAndControl(ctx, pos), ...mostCommon(ctx, pos), ...greatestPowerOrTied(ctx, pos), ...enteredSelf(ctx, pos), ...manaSpent(ctx, pos), ...unspentMana(ctx, pos), ...manaFrom(ctx, pos),
    ...excessCondAt(ctx, pos), // FAST5X E16 (CR 120.10, 608.2c): "excess damage was dealt [to that creature] this way"
    ...lostLifeThisWay(ctx, pos), // cloud std-spm (CR 119.3, 608.2c): "you lost life this way"
    ...voteCondAt(ctx, pos), // M12-3 (CR 701.38a-b): "carnage gets more votes [or the vote is tied]"
    ...descended(ctx, pos), // FAST5X E22 (CR 700.11)
    ...indefiniteStatus(ctx, pos), // Cloud std-woe (CR 506.4, 701.26a): "a Rat is attacking"
    ...noOpponentMoreLife(ctx, pos), // cmd1 (CR 119.1, 603.4)
    ...costCondAt(ctx, pos), // r4-cost (CR 602.5b, 601.2f): conditions of activation restrictions and cost changes (parser/holes/cost-conds.ts)
    ...opponentHasLife(ctx, pos), // r4-static (CR 119.1): "an opponent has 10 or less life"
    ...unannounced(p2iv3CondAt(ctx, pos)), // p2-intervening-3 (CR 603.4; parser/holes/p2iv3.ts)
    ...poisonCounters(ctx, pos), // std-rx24 (CR 122.1f): "an opponent has three or more poison counters", "defending player is poisoned"
    ...lostLifeAtLeast(ctx, pos), // Standard round P (CR 119.3): "an opponent lost 3 or more life this turn"
    ...unannounced(anaphorLostLife(ctx, pos)), // std-rx4 (CR 119.3): "they lost life this turn"
    ...unannounced(firstTime(ctx, pos)), // Standard round 5, r5-trig (CR 603.4, 603.2c)
    ...unannounced(batchCast(ctx, pos)), // Standard round 5, r5-trig (CR 603.4, 603.6a, 601.2h)
    ...unannounced(W_PLAYED_OR_CAST_ELSEWHERE.flatMap((w) => { const e = phraseAt(ctx, pos, w); return e >= 0 ? [{ end: e, value: playedOrCastElsewhere() }] : []; })), // r5-trig (CR 305.1, 601.2a)
    // std-lci's zone changes of the turn ("activate only if an artifact entered the battlefield under your control this turn") are flagged as every history is: an
    // activation restriction keeps one the announcement reads (lower/activation.ts#condOf; std-blb's turnHistoryAtAnnouncement, the one reader of this turn's history)
    ...unannounced([...zoneHistory(ctx, pos), ...t23Misc(ctx, pos), ...warped(ctx, pos), ...e22History(ctx, pos), ...earlyTurn(ctx, pos), ...opponentHandSize(ctx, pos), ...opponentMoreLife(ctx, pos)]),
    ...unannounced(sourcesDealtDamage(ctx, pos)), // cloud r3-mech (CR 120.1, 719.3a): "three or more sources you controlled dealt damage this turn"
    ...unannounced(p2iv2CondAt(ctx, pos)), // p2-intervening-2 (CR 603.4; parser/holes/p2iv2.ts)
    ...graveyardSize(ctx, pos), // FAST5 T53 (CR 404.1)
    ...unannounced(thoseAttackingYou(ctx, pos)), // std-combat-1 (CR 603.4, 508.5)
    ...speedGreatest(ctx, pos), // std-control-1 (CR 702.179)
    ...unannounced(p2iv1CondAt(ctx, pos, spentObjects)), // p2-intervening-1 (CR 603.4; parser/holes/p2iv1.ts)
    ...p2cst1CondAt(ctx, pos), // p2-cost-statics-1 (CR 506.4, 508.1; parser/holes/p2cst1.ts): "three or more creatures are attacking", "exactly one creature is attacking"
    ...unannounced(firstSpellCastCond(ctx, pos)), // trek-2 (CR 601.2i): "~ is the first spell you've cast this game"
  ];
}

const W_IS_FIRST_SPELL_THIS_GAME = [P("is the first spell you've cast this game"), P('is the first spell you have cast this game')];

/**
 * trek-2 (CR 601.2i, 707.10): "If this spell is the first spell you've cast this game, you gain 2 life." (First Contact): the spell itself (its "~") was cast by the
 * controller of the resolution before every other spell that player cast this game (`firstSpellCast`, effects/eval.ts). Only the spell's own name ("this spell"
 * is "~" in the parse text), and only "this game".
 */
function firstSpellCastCond(ctx: HoleCtx, pos: number): Alt[] {
  if (ctx.toks[pos]?.kind !== 'SELF') return [];
  const out: Alt[] = [];
  for (const w of W_IS_FIRST_SPELL_THIS_GAME) {
    const e = phraseAt(ctx, pos + 1, w);
    if (e >= 0) out.push({ end: e, value: { cond: 'firstSpellCast', scope: 'game' } });
  }
  return out;
}

const W_SPEED_GREATER_THAN_EACH_OTHER = P("'s speed is greater than each other player 's speed"); // std-control-1
const W_SPEED_OF: readonly [string[], 'player' | 'opponent'][] = [[P('that player'), 'player'], [P('that opponent'), 'opponent']];

/**
 * std-control-1 (CR 702.179, 702.179f, 102.3): "that opponent's speed is greater than each other player's speed": the named player is the only player whose speed is
 * at least that player's own (no speed counts as 0). Only after "that player" / "that opponent", the one player an earlier part of the ability names.
 */
function speedGreatest(ctx: HoleCtx, pos: number): Alt[] {
  const out: Alt[] = [];
  for (const [w, head] of W_SPEED_OF) {
    const e = phraseAt(ctx, pos, w);
    if (e < 0) continue;
    const m = phraseAt(ctx, e, W_SPEED_GREATER_THAN_EACH_OTHER);
    if (m < 0) continue;
    const who = anaphorObj({ sort: 'player', number: 'singular', head, text: `that ${head}` }) as never;
    out.push({ end: m, value: compare({ q: 'countPlayers', of: { ref: 'each', who: 'player' }, speedVs: { op: '>=', than: who } }, '==', 1) });
  }
  return out;
}

const AND = P('and');
const OR = P('or');
const W_OR_IF = P('or if'); // std-r7

export const cond: HoleFn = (ctx, pos) => {
  const out: Alt[] = [];
  const walk = (a: Alt, kind: 'and' | 'or' | null, parts: Condition[], depth: number): void => {
    const all = [...parts, a.value as Condition];
    // Standard round 4, r4-trig: a weak atom keeps its weakness in a compound condition (the sum, design 6.3 rule 2)
    out.push({ end: a.end, value: kind === null ? a.value : { cond: kind === 'and' ? 'all' : 'any', of: all }, ...(a.flags ? { flags: a.flags } : {}), ...(a.weak ? { weak: a.weak } : {}) });
    if (depth > 4) return;
    for (const [w, k] of [[AND, 'and'], [OR, 'or']] as const) {
      if (kind !== null && kind !== k) continue;
      const e = phraseAt(ctx, a.end, w);
      if (e < 0) continue;
      for (const b of atoms(ctx, e)) walk({ end: b.end, value: b.value, ...(b.flags ? { flags: [...(a.flags ?? []), ...b.flags] } : a.flags ? { flags: a.flags } : {}), ...((a.weak ?? 0) + (b.weak ?? 0) > 0 ? { weak: (a.weak ?? 0) + (b.weak ?? 0) } : {}) }, k, all, depth + 1);
    }
  };
  for (const a of atoms(ctx, pos)) walk(a, null, [], 0);
  // std-r7 (CR 603.4, 608.2c): "if that creature's power is 2 or less or if you control another Lizard": the second condition with its own "if", one condition
  // or the other (as "A or B"); two conditions only, nothing chained after
  for (const a of atoms(ctx, pos)) {
    const e = phraseAt(ctx, a.end, W_OR_IF);
    if (e < 0) continue;
    for (const b of atoms(ctx, e)) {
      const flags = [...(a.flags ?? []), ...(b.flags ?? [])];
      const weak = (a.weak ?? 0) + (b.weak ?? 0);
      out.push({ end: b.end, value: { cond: 'any', of: [a.value as Condition, b.value as Condition] }, ...(flags.length > 0 ? { flags } : {}), ...(weak > 0 ? { weak } : {}) });
    }
  }
  return dedupe(out);
};
