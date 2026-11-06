/**
 * Quantities as phrases (WP2): "3", "X", "the number of creatures you control", "its power", "your devotion to green", "twice its power".
 * `qty` prints the value as it follows "equal to"; a plain number prints as digits (callers that count things use number words themselves).
 */
import type { ObjectFilter, Quantity, ObjRef, PlayerRef } from '../types/ability';
import { K, type QtyOpts } from './kernel';
import { isPlayerRef } from './refs';
import { areCreatureTypes } from './np';
import { isTurnEnergySpent } from '../model/forms';
import { costCountParts, movedCountParts, movedCountPhrase, milledCardsNp, movedGroupNp } from './moved';
import { MILLED_KEY, absorb, cloneState, type RenderState } from './state';
import { alt, COLOR_WORD, joinList, numWord, NoRenderer, pluralize } from './text';

/** M6-12: "times its <name> cost was paid" (squad CR 702.157a, replicate CR 702.56a); a second instance's name ("squad:2") has no wording of its own. */
function namedCostParts(name: string): { plural: string; singular: string } {
  if (!/^[a-z ]+$/.test(name)) throw new NoRenderer(`the payments of the additional cost "${name}"`);
  return { plural: `times its ${name} cost was paid`, singular: `time its ${name} cost was paid` };
}

const STAT_WORD: Record<string, string> = { power: 'power', toughness: 'toughness', manaValue: 'mana value', loyalty: 'loyalty', defense: 'defense' };

const DISTINCT_WORD: Record<string, string> = {
  colors: 'colors',
  cardTypes: 'card types',
  permanentTypes: 'permanent types', // r4-cost (CR 110.4)
  creatureTypes: 'creature types',
  names: 'names',
  landTypes: 'basic land types',
  manaValues: 'mana values',
  manaCosts: 'mana costs', // edh-c-47 (CR 202.1)
  counterKinds: 'different kinds of counters', // r4-static (CR 122.1): "three or more different kinds of counters among creatures you control"
  planeswalkerTypes: 'planeswalker types', // r5-fxb (CR 205.3j)
  powers: 'powers', // CLOUD std-misc (CR 208.1): "the number of different powers among ..." (the "different" is said by the count's own wording)
};
/** FAST5 T58: the singular of a `distinct` quantity for "for each color among ..." (countParts); a kind not listed has no "for each" wording. */
const DISTINCT_SINGULAR: Record<string, string> = { colors: 'color', cardTypes: 'card type', creatureTypes: 'creature type', manaValues: 'different mana value', manaCosts: 'different mana cost' /* edh-c-47 (CR 202.1) */, powers: 'different power' /* edh-next-13 (CR 208.1) */, counterKinds: 'kind of counter' /* edh-next-50 (CR 122.1, 707.10; Storm of Forms): "copy it for each kind of counter among permanents you control" */ }; // r4-fxz: Lunar Insight's "for each different mana value among ..."

const PLAYER_ZONE: Record<string, string> = { hand: 'hand', graveyard: 'graveyard', library: 'library', exile: 'exile' };

export const isNumber = (q: Quantity): q is number => typeof q === 'number';

/** FAST5 T53 (CR 402.1): "more cards in hand than you": the players whose zone compares with yours. Only a bigger or smaller hand, graveyard or library than yours. */
export function sizeVsWords(s: { zone: string; op: string; than: { ref: string }; by?: number }): string {
  const zone = s.zone === 'hand' ? 'in hand' : s.zone === 'graveyard' ? 'in graveyard' : 'in library';
  // edh-d-26 (CR 402.1, 102.3; Teachings of the Archaics): "at least four more cards in hand than you"
  if (s.by !== undefined) {
    if (s.than.ref !== 'you' || s.op !== '>=' || s.by < 2) throw new NoRenderer('a zone size margin other than at least N more than you');
    return `at least ${numWord(s.by)} more cards ${zone} than you`;
  }
  if (s.than.ref !== 'you' || (s.op !== '>' && s.op !== '<')) throw new NoRenderer('a zone size compared with a player other than you, or by other than more / fewer');
  return `${s.op === '>' ? 'more' : 'fewer'} cards ${zone} than you`;
}

/**
 * FAST5X E16 (CR 120.4a, 120.10): the permanent excess damage was dealt to "this way": a reference ("that creature"), or the fighting creature an opponent
 * controls (`{ref:'each'}` of exactly that filter: "the creature an opponent controls", "the creature the opponent controls").
 */
export function excessRecipient(to: ObjRef, st: RenderState): string {
  if (to.ref === 'each') {
    const f = to.filter;
    if (Object.keys(f).length === 2 && f.controller === 'opponent' && f.types?.length === 1 && f.types[0] === 'Creature') return alt('the creature an opponent controls', 'the creature the opponent controls');
    // edh-c-78 (CR 120.10; Vikya, Scorching Stalwart): "excess damage was dealt to a creature this way": the creatures alone (the wording is "a creature")
    if (Object.keys(f).length === 1 && f.types?.length === 1 && f.types[0] === 'Creature') return 'a creature';
    throw new NoRenderer('excess damage dealt to a set of permanents');
  }
  return K.obj(to, st, 'object').text;
}

/** The words of a history scope (M6-0: `lastTurn`, "last turn"). */
export const scopeWords = (scope: Extract<Quantity, { q: 'happenedCount' }>['scope']): string =>
  scope === 'turn' ? 'this turn' : scope === 'combat' ? 'this combat' : scope === 'lastTurn' ? 'last turn' : scope === 'sinceYourLastTurn' ? 'since your last turn' : 'this game';

/**
 * edh-players-9 (rules/history.ts#happenedPlayersOf): the players of a `happenedPlayers` count with their history of this turn, as the pattern reads from each player's
 * side (parser/holes/edhp9.ts is the reading). Only the opponents or every player, this turn, and the three patterns the reading makes; anything else has no words.
 */
function happenedPlayersParts(q: Extract<Quantity, { q: 'happenedPlayers' }>): { plural: string; singular: string } {
  if (q.of.ref !== 'each' || (q.of.who !== 'opponent' && q.of.who !== 'player') || q.scope !== 'turn') throw new NoRenderer('a count of players by their history other than each opponent / each player, this turn');
  const who = q.of.who;
  const keys = (o: object): string => Object.keys(o).sort().join(',');
  const ev = q.event;
  const times = q.times;
  if ((q.countLeft === true) !== (ev.ev === 'damage')) throw new NoRenderer('a count of players that leaves out (or keeps) the players who left, other than the combat damage reading');
  const orMore = times !== undefined && times.op === '>=' && times.n >= 2 ? `${numWord(times.n)} or more` : null;
  const make = (rest: string, verb: 'who' | 'that' = 'who'): { plural: string; singular: string } => ({ plural: `${pluralize(who)} ${verb} ${rest}`, singular: `${who} ${verb} ${rest}` });
  if (ev.ev === 'draw' && ev.player === 'you' && keys(ev) === 'ev,player' && orMore !== null) return make(`drew ${orMore} cards this turn`);
  if (ev.ev === 'zoneChange' && ev.to === 'battlefield' && keys(ev) === 'ev,subject,to' && keys(ev.subject) === 'controller,types' && ev.subject.controller === 'you' && ev.subject.types?.length === 1 && (ev.subject.types[0] === 'Land' || ev.subject.types[0] === 'Creature') && orMore !== null) {
    return make(`had ${orMore} ${ev.subject.types[0] === 'Land' ? 'lands' : 'creatures'} enter the battlefield under their control this turn`); // edh-c-86: creatures too
  }
  // edh-next-58 (CR 400.3, 404.1; parser/holes/edhn58.ts; Ravenous Trap): "an opponent had three or more cards put into their graveyard from anywhere this turn"
  if (ev.ev === 'zoneChange' && ev.to === 'graveyard' && ev.from === undefined && keys(ev) === 'ev,subject,to' && keys(ev.subject) === 'isCard,owner' && ev.subject.owner === 'you' && ev.subject.isCard === true && orMore !== null) {
    return make(`had ${orMore} cards put into their graveyard from anywhere this turn`);
  }
  if (ev.ev === 'damage' && ev.combat === true && keys(ev) === 'combat,ev,recipient' && keys(ev.recipient!) === 'player' && ev.recipient!.player === 'you' && times === undefined) {
    return { plural: alt(`${pluralize(who)} that were dealt combat damage this turn`, `${pluralize(who)} who were dealt combat damage this turn`), singular: `${who} who was dealt combat damage this turn` };
  }
  if (ev.ev === 'damage' && keys(ev) === 'ev,recipient' && keys(ev.recipient!) === 'player' && ev.recipient!.player === 'you' && times === undefined) {
    return { plural: alt(`${pluralize(who)} that were dealt damage this turn`, `${pluralize(who)} who were dealt damage this turn`), singular: `${who} who was dealt damage this turn` };
  }
  // edh-d-70 (CR 701.9a; Azula, parser/holes/edhd70.ts): "for each player who discarded a card this turn"
  if (ev.ev === 'action' && ev.verb === 'discard' && ev.actor === 'you' && keys(ev) === 'actor,ev,verb' && times === undefined) return make('discarded a card this turn');
  throw new NoRenderer('a count of players by a history event other than drawing cards, lands entering or combat damage');
}

/** "creatures that died this turn" / "creature that died this turn", for "the number of ..." and "for each ...". */
function happened(q: Extract<Quantity, { q: 'happenedCount' }>, st: RenderState): { plural: string; singular: string } {
  const ev = q.event;
  // FAST5 T45 (CR 702.40a): "other instant and sorcery spells you've cast before it this turn": what was cast before the triggering spell, a cast event only
  const before = q.beforeEvent === true;
  if (before && (ev.ev !== 'cast' || q.scope !== 'turn')) throw new NoRenderer('beforeEvent outside a count of the spells cast this turn');
  const scope = before ? 'before it this turn' : scopeWords(q.scope);
  // M6-0: the per-player maximum has a wording only in a comparison ("if a player cast two or more spells last turn", render/cond.ts#compareIdiom)
  if (q.per === 'player') throw new NoRenderer('happenedCount.per outside a comparison');
  if (ev.ev !== 'cast' && q.by !== undefined && q.by !== 'any') throw new NoRenderer('happenedCount.by on an event that is not a cast');
  // edh-next-68 (CR 400.7, 404.1; Welcome the Dead): the cards put into your graveyard from your hand or library this turn
  if (ev.ev === 'zoneChange' && JSON.stringify(ev.from) === '["hand","library"]' && ev.to === 'graveyard' && JSON.stringify(ev.subject) === '{"isCard":true,"owner":"you"}' && q.scope === 'turn' && !before && q.by === undefined && Object.keys(ev).sort().join() === 'ev,from,subject,to') {
    return { plural: 'cards that were put into your graveyard from your hand or library this turn', singular: 'card that was put into your graveyard from your hand or library this turn' };
  }
  if (ev.ev === 'zoneChange' && ev.from === 'battlefield' && ev.to === 'graveyard') {
    // edh-c-12 (CR 205.3m, 700.4; Floating-Dream Zubera): also creatures described by creature types alone, "Zubera that died this turn"
    const isCreature = ((ev.subject.types ?? []).length === 1 && ev.subject.types![0] === 'Creature')
      || (ev.subject.types === undefined && ev.subject.subtypes !== undefined && areCreatureTypes(ev.subject.subtypes) && Object.keys(ev.subject).filter((k) => (ev.subject as Record<string, unknown>)[k] !== undefined).join() === 'subtypes');
    // pc-tokens-3 (CR 700.4, 400.3; family put-into-your-graveyard-from-battlefield): the permanents you own that went from the battlefield to a graveyard this turn are
    // also said "creature put into your graveyard from the battlefield this turn" (a card goes to its owner's graveyard; parser/holes/qty.ts)
    if (ev.subject.owner === 'you' && ev.subject.controller === undefined && ev.subject.isCard === undefined && ev.subject.zone === undefined && ev.subject.stackKind === undefined && q.scope === 'turn' && !before && q.by === undefined) {
      const f: ObjectFilter = { ...ev.subject, owner: undefined };
      const own = { plural: `${K.np(ev.subject, st, { det: 'none', plural: true })} that ${isCreature ? 'died' : 'were put into graveyards from the battlefield'} ${scope}`, singular: `${K.np(ev.subject, st, { det: 'none' })} that ${isCreature ? 'died' : 'was put into a graveyard from the battlefield'} ${scope}` };
      return {
        plural: alt(own.plural, `${K.np(f, st, { det: 'none', plural: true })} put into your graveyard from the battlefield ${scope}`),
        singular: alt(own.singular, `${K.np(f, st, { det: 'none', forEach: true })} put into your graveyard from the battlefield ${scope}`),
      };
    }
    if (isCreature) {
      const f = { ...ev.subject, types: ev.subject.types };
      const died = { plural: `${K.np(f, st, { det: 'none', plural: true })} that died ${scope}`, singular: `${K.np(f, st, { det: 'none' })} that died ${scope}` };
      // r4-static (CR 700.4, 603.10a): "creature that died under your control this turn": the controller as it last existed on the battlefield (wave 7 merge:
      // r4-repl wrote the same two readings here, for Callous Sell-Sword's and Torgal's counts; one kept)
      if (ev.subject.controller !== 'you' && ev.subject.controller !== 'opponent') return died;
      const g: ObjectFilter = { ...f, controller: undefined };
      // std-rc (CR 700.4, 603.10a; parser/holes/qty.ts#historyCounts): an opponent's too, "creatures that died under your opponents' control this turn"
      const under = ev.subject.controller === 'you' ? ['your control'] : ["your opponents' control", "an opponent's control"];
      return {
        plural: alt(died.plural, ...under.map((u) => `${K.np(g, st, { det: 'none', plural: true })} that died under ${u} ${scope}`)),
        singular: alt(died.singular, ...under.map((u) => `${K.np(g, st, { det: 'none' })} that died under ${u} ${scope}`)),
      };
    }
    // r5-moved (CR 700.4; parser/holes/qty.ts#historyCounts): any other permanent kind "that were put into graveyards from the battlefield this turn" (Anzrag's Rampage)
    const s = ev.subject;
    if (q.scope === 'turn' && !before && q.by === undefined && s.isCard === undefined && s.stackKind === undefined && s.zone === undefined && s.controller === undefined && s.owner === undefined && Object.values(s).some((v) => v !== undefined)) {
      return { plural: `${K.np(s, st, { det: 'none', plural: true })} that were put into graveyards from the battlefield this turn`, singular: `${K.np(s, st, { det: 'none' })} that was put into a graveyard from the battlefield this turn` };
    }
  }
  // std-rc (CR 406.1, 603.10a; parser/holes/qty.ts#historyCounts): "creatures that were exiled under your opponents' control this turn" (Vren, the Relentless):
  // permanents put into exile from the battlefield, the controller as they last existed there; nothing else about the event or the objects
  if (ev.ev === 'zoneChange' && ev.from === 'battlefield' && ev.to === 'exile' && ev.cause === undefined && ev.byOpponent === undefined && q.scope === 'turn' && !before && q.by === undefined
    && (ev.subject.controller === 'you' || ev.subject.controller === 'opponent') && ev.subject.isCard === undefined && ev.subject.zone === undefined && ev.subject.owner === undefined && ev.subject.stackKind === undefined) {
    const f: ObjectFilter = { ...ev.subject, controller: undefined };
    const under = ev.subject.controller === 'you' ? ['your control'] : ["your opponents' control", "an opponent's control"];
    return {
      plural: alt(...under.map((u) => `${K.np(f, st, { det: 'none', plural: true })} that were exiled under ${u} ${scope}`)),
      singular: alt(...under.map((u) => `${K.np(f, st, { det: 'none' })} that was exiled under ${u} ${scope}`)),
    };
  }
  // FAST5 T65 (CR 603.6a): "land that entered the battlefield under your control this turn" (parser/holes/qty.ts#enteredCounts): the objects you controlled
  // as they entered, counted from the turn's history; nothing else about the event (no zone it came from, no cause)
  if (ev.ev === 'zoneChange' && ev.to === 'battlefield' && ev.from === undefined && ev.cause === undefined && ev.byOpponent === undefined && ev.subject.controller === 'you' && q.by === undefined && q.per === undefined) {
    const f: ObjectFilter = { ...ev.subject, controller: undefined };
    // edh-perms-11 (Gyome, Master Chef): Oracle also says "nontoken creatures you had enter the battlefield under your control this turn" (the same history)
    const entered = (np: string): string => alt(`${np} that entered the battlefield under your control ${scope}`, `${np} you had enter the battlefield under your control ${scope}`);
    return { plural: entered(K.np(f, st, { det: 'none', plural: true })), singular: entered(K.np(f, st, { det: 'none', forEach: true })) };
  }
  // std-lci (CR 603.10a, 700.4; parser/holes/qty.ts#enteredCounts): "creature that left the battlefield under your control this turn", or anyone's: the objects
  // that left the battlefield for any zone, counted from the turn's history (the controller as it last existed there); nothing else about the event
  if (ev.ev === 'zoneChange' && ev.from === 'battlefield' && ev.to === undefined && ev.cause === undefined && ev.byOpponent === undefined && (ev.subject.controller === 'you' || ev.subject.controller === undefined) && q.by === undefined && q.per === undefined) {
    const under = ev.subject.controller === 'you' ? ' under your control' : '';
    const f: ObjectFilter = { ...ev.subject, controller: undefined };
    return { plural: `${K.np(f, st, { det: 'none', plural: true })} that left the battlefield${under} ${scope}`, singular: `${K.np(f, st, { det: 'none', forEach: true })} that left the battlefield${under} ${scope}` };
  }
  // r4-refs (CR 400.7, 404.1, 401.1): "cards that were put into target player's graveyard from their library this turn": the cards of one player's library that
  // went to that player's graveyard (a milled or otherwise put card); only the owner said, nothing else about the cards or the cause
  if (ev.ev === 'zoneChange' && ev.from === 'library' && ev.to === 'graveyard' && ev.cause === undefined && ev.byOpponent === undefined && q.by === undefined
    && Object.keys(ev.subject).length === 1 && ev.subject.owner !== undefined && typeof ev.subject.owner === 'object') {
    const owner = K.player(ev.subject.owner, st, 'possessive').text;
    return { plural: `cards that were put into ${owner} graveyard from their library ${scope}`, singular: `card that was put into ${owner} graveyard from their library ${scope}` };
  }
  // edh-zones-20 (CR 400.3, 404.1; parser/holes/edhz20.ts, template eff.edhz20.mill.*.putIntoTheirGraveyard): "cards put into their graveyard from anywhere this turn" (Fraying
  // Sanity): every card that went to that player's graveyard from any zone; only the owner said (a token is not a card), nothing else about the cards or the cause
  if (ev.ev === 'zoneChange' && ev.from === undefined && ev.to === 'graveyard' && ev.cause === undefined && ev.byOpponent === undefined && q.by === undefined && !before
    && Object.keys(ev.subject).length === 2 && ev.subject.isCard === true && ev.subject.owner !== undefined && typeof ev.subject.owner === 'object') {
    // the enchanted player is named by the sentence's subject, so the possessive is also "their" (the template has the same player mill and own the graveyard)
    const named = K.player(ev.subject.owner, st, 'possessive').text;
    const owner = ev.subject.owner.ref === 'enchantedPlayer' ? alt(named, 'their') : named;
    return { plural: `cards put into ${owner} graveyard from anywhere ${scope}`, singular: `card put into ${owner} graveyard from anywhere ${scope}` };
  }
  // edh-perms-8 (CR 111.1; parser/holes/edhpm8.ts): "tokens you created this turn": every token the controller created, nothing else about the event or the tokens
  if (ev.ev === 'createToken' && ev.player === 'you' && Object.keys(ev).every((k) => k === 'ev' || k === 'player') && q.by === undefined && q.per === undefined && !before && q.scope === 'turn') {
    return { plural: 'tokens you created this turn', singular: 'token you created this turn' };
  }
  // edh-next-110 (CR 122.6, 122.6a; parser/holes/edhn110.ts; Iridescent Hornbeetle): "+1/+1 counters you've put on creatures under your control this turn": the amounts of this turn's `counters`
  // entries (put by you, on a creature you controlled), added up; nothing else about the event
  if (ev.ev === 'counters' && ev.change === 'put' && ev.kind !== undefined && ev.by === 'you' && q.sum === 'amount' && q.scope === 'turn' && !before && q.by === undefined && q.per === undefined
    && Object.keys(ev).sort().join() === 'by,change,ev,kind,on' && JSON.stringify(ev.on) === '{"types":["Creature"],"controller":"you"}') {
    return { plural: `${ev.kind} counters you've put on creatures under your control this turn`, singular: `${ev.kind} counter you've put on creatures under your control this turn` };
  }
  // p2-cost-statics-1 (CR 601.2i; parser/holes/p2cst1.ts): "spells your opponents have cast this turn": every cast of the turn by an opponent of the controller,
  // nothing else about the spells
  if (ev.ev === 'cast' && ev.player === 'opponent' && Object.keys(ev).every((k) => k === 'ev' || k === 'player') && q.by === undefined && !before && q.scope === 'turn') {
    return { plural: 'spells your opponents have cast this turn', singular: 'spell your opponents have cast this turn' };
  }
  // p2-cost-statics-1 (CR 508.1, 506.4; parser/holes/p2cst1.ts): "creatures you attacked with this turn": each creature you controlled that was declared as an
  // attacker this turn, once however many combats it attacked in (rules/history.ts#countHistory); nothing else about the attack
  if (ev.ev === 'attacks' && ev.attacker?.controller === 'you' && Object.keys(ev).every((k) => k === 'ev' || k === 'attacker') && q.by === undefined && !before && q.scope === 'turn') {
    const { controller: _c, ...f } = ev.attacker;
    return { plural: `${K.np(f, st, { det: 'none', plural: true })} you attacked with ${scope}`, singular: `${K.np(f, st, { det: 'none', forEach: true })} you attacked with ${scope}` };
  }
  if (ev.ev === 'cast') {
    if (ev.via !== undefined) throw new NoRenderer('a count of spells cast for an alternative cost'); // FAST5X E2: no wording (fail closed)
    // std-rm (CR 601.2a; parser/holes/qty.ts): "spells you've cast this turn from anywhere other than your hand" (Surge of Brilliance): your casts of the turn whose
    // zone was not your hand, nothing else about them
    if (ev.notFrom !== undefined) {
      if (ev.notFrom !== 'hand' || ev.player !== 'you' || ev.spell !== undefined || ev.from !== undefined || ev.orCopy === true || ev.nth !== undefined || ev.nthMin !== undefined
        || before || (q.by !== undefined && q.by !== 'you') || q.scope !== 'turn') throw new NoRenderer('a count of casts not from a hand, with something more');
      // edh-next-88 (CR 601.2a; Impending Flux; family cast-from-elsewhere-turn-order): the turn may come last, "spells you've cast from anywhere other than your hand this turn"
      return { plural: alt("spells you've cast this turn from anywhere other than your hand", "spells you've cast from anywhere other than your hand this turn"), singular: alt("spell you've cast this turn from anywhere other than your hand", "spell you've cast from anywhere other than your hand this turn") };
    }
    const by = q.by ?? ev.player;
    const p = by === 'you' || by === undefined || by === 'any' ? null : K.player(by, st, 'subject');
    const who = by === 'you' ? "you've" : p === null ? '' : theyHave(p);
    const kind = ev.spell ? K.np({ ...ev.spell, stackKind: 'spell' }, st, { det: 'none', plural: true }) : 'spells';
    const kind1 = ev.spell ? K.np({ ...ev.spell, stackKind: 'spell' }, st, { det: 'none', forEach: true }) : 'spell'; // edh-top-7: after "for each" always ("for each instant and sorcery spell you've cast this turn", Ral, Monsoon Mage)
    // edh-next-147 (CR 601.2i, 603.4; Sentinel Tower): by any player, before the triggering spell, this turn: "instant and sorcery spells cast before that spell this turn"
    if (before && who === '' && (by === 'any' || by === undefined) && q.scope === 'turn' && ev.spell !== undefined && q.per === undefined && q.sum === undefined && ev.from === undefined && ev.orCopy !== true && ev.nth === undefined) {
      return { plural: `${kind} cast before that spell this turn`, singular: `${kind1} cast before that spell this turn` };
    }
    if (before && who === '') throw new NoRenderer('spells cast before the triggering one by any player');
    return who === ''
      ? { plural: `${kind} cast ${scope}`, singular: `${kind1} cast ${scope}` }
      : { plural: `${before ? 'other ' : ''}${kind} ${who} cast ${scope}`, singular: `${before ? 'other ' : ''}${kind1} ${who} cast ${scope}` };
  }
  // p2-damage-2 (CR 121.1, 608.2h; parser/holes/qty.ts#historyCounts): "cards they've drawn this turn": the draws of one player named before, nothing else about them
  if (ev.ev === 'draw' && ev.player !== undefined && typeof ev.player === 'object' && ev.nth === undefined && ev.exceptFirstInDrawStep === undefined && q.by === undefined && q.per === undefined && !before) {
    const who = theyHave(K.player(ev.player, st, 'subject'));
    return { plural: `cards ${who} drawn ${scope}`, singular: `card ${who} drawn ${scope}` };
  }
  // edh-cast-8 (CR 121.1, 608.2h; parser/holes/qty.ts#historyCounts): "cards your opponents have drawn this turn" (Heliod, the Radiant Dawn): every draw of the turn by an opponent
  if (ev.ev === 'draw' && ev.player === 'opponent' && ev.nth === undefined && ev.exceptFirstInDrawStep === undefined && q.by === undefined && q.per === undefined && !before && q.scope === 'turn') {
    return { plural: 'cards your opponents have drawn this turn', singular: 'card your opponents have drawn this turn' };
  }
  // FAST5 T61 (CR 701.9a, 608.2h): "draw a card for each card you've discarded this turn": the cards you discarded (the action event of a discard names the
  // owner as the actor, rules/history.ts); only your own, only any card
  if (ev.ev === 'action' && ev.verb === 'discard' && ev.actor === 'you' && ev.object === undefined && q.by === undefined) {
    // edh-c-1 (family cycled-or-discarded-count; Hollow One): cycling a card discards it (CR 702.29a), so the count is also said "cycled or discarded"
    return { plural: alt(`cards you've discarded ${scope}`, `cards you've cycled or discarded ${scope}`), singular: alt(`card you've discarded ${scope}`, `card you've cycled or discarded ${scope}`) };
  }
  // edh-c-23 (CR 701.9a, 608.2h; Dream Salvage): "the number of cards target opponent discarded this turn": the cards one player (a reference, not you) discarded, any card
  if (ev.ev === 'action' && ev.verb === 'discard' && typeof ev.actor === 'object' && ev.object === undefined && q.by === undefined && !before) {
    const who = K.player(ev.actor, st, 'subject');
    if (who.person === 'sg') return { plural: `cards ${who.text} discarded ${scope}`, singular: `card ${who.text} discarded ${scope}` };
  }
  // std-r7 (CR 701.21a, 608.2h; parser/holes/qty.ts#historyCounts): "permanents you've sacrificed this turn", "Foods you've sacrificed this turn": your sacrifices
  // of the turn, one per permanent; only your own, nothing else about the event
  if (ev.ev === 'action' && ev.verb === 'sacrifice' && ev.actor === 'you' && Object.keys(ev).every((k) => k === 'ev' || k === 'verb' || k === 'actor' || k === 'object') && q.by === undefined && !before) {
    const what = ev.object === undefined ? { plural: 'permanents', singular: 'permanent' } : { plural: K.np(ev.object, st, { det: 'none', plural: true }), singular: K.np(ev.object, st, { det: 'none', forEach: true }) };
    return { plural: `${what.plural} you've sacrificed ${scope}`, singular: `${what.singular} you've sacrificed ${scope}` };
  }
  // edh-b-7 (CR 701.21a, 608.2h; The Balrog, Durin's Bane): "for each permanent sacrificed this turn": the sacrifices of the turn by any player, one per permanent (no actor)
  if (ev.ev === 'action' && ev.verb === 'sacrifice' && (ev.actor === undefined || ev.actor === 'any') && Object.keys(ev).every((k) => k === 'ev' || k === 'verb' || k === 'object' || k === 'actor') && (q.by === undefined || q.by === 'any') && !before) {
    const what = ev.object === undefined ? { plural: 'permanents', singular: 'permanent' } : { plural: K.np(ev.object, st, { det: 'none', plural: true }), singular: K.np(ev.object, st, { det: 'none', forEach: true }) };
    return { plural: `${what.plural} sacrificed ${scope}`, singular: `${what.singular} sacrificed ${scope}` };
  }
  // trek-7 (CR 700.2; parser/holes/qty.ts#historyCounts): "the number of dilemmas you've faced this turn", "for each dilemma you've faced this turn" (Captain Benjamin Sisko):
  // the player's modes chosen for a spell or ability this turn, one history entry each (rules/crime.ts#emitDilemma); only your own
  if (ev.ev === 'action' && ev.verb === 'faceDilemma' && ev.actor === 'you' && Object.keys(ev).every((k) => k === 'ev' || k === 'verb' || k === 'actor') && q.by === undefined && !before) {
    return { plural: `dilemmas you've faced ${scope}`, singular: `dilemma you've faced ${scope}` };
  }
  const text = K.event(ev, st, 'past');
  return { plural: `times ${text} ${scope}`, singular: `time ${text} ${scope}` };
}

/** FAST4 T34: a player named before may be "they" ("the number of noncreature spells they've cast this turn"; p2-damage-2: "cards they've drawn this turn"). */
const theyHave = (p: { text: string; they?: boolean }): string => (p.they === true ? alt(`${p.text} has`, "they've") : `${p.text} has`);

const BASIC_LAND_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
const sortedKey = (f: ObjectFilter): string => JSON.stringify(Object.entries(f).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)));

/**
 * FAST3 T12: domain (CR 305.6, 205.3i), "the number of basic land types among lands you control". The model has no quantity for it (`distinct` `landTypes`
 * counts every land type, Gates and Deserts too), so it is written with the quantities the layer system evaluates: one `min(1, count of <filter> with that
 * basic land type)` for each of the five basic land types, summed (in any order: the sum is commutative, model/canonical.ts sorts it). Returns the shared
 * filter (without the subtype), or null when the calculation is not exactly that.
 */
export function domainOf(q: Quantity): ObjectFilter | null {
  if (typeof q !== 'object' || q.q !== 'math' || q.op !== '+' || q.args.length !== BASIC_LAND_TYPES.length) return null;
  let base: ObjectFilter | null = null;
  const seen = new Set<string>();
  for (const a of q.args) {
    if (typeof a !== 'object' || a.q !== 'math' || a.op !== 'min' || a.args.length !== 2) return null;
    const one = a.args.findIndex((x) => x === 1); // min is commutative too
    const c = a.args[1 - one];
    if (one < 0 || typeof c !== 'object' || c.q !== 'count' || c.of.ref !== 'each') return null;
    const { subtypes, ...rest } = c.of.filter;
    if (subtypes === undefined || subtypes.length !== 1 || !BASIC_LAND_TYPES.includes(subtypes[0]!) || seen.has(subtypes[0]!)) return null;
    seen.add(subtypes[0]!);
    if (rest.anyOf !== undefined || rest.notSubtypes !== undefined) return null;
    if (base === null) base = rest;
    else if (sortedKey(base) !== sortedKey(rest)) return null;
  }
  return seen.size === BASIC_LAND_TYPES.length ? base : null;
}

type CountParts = { plural: string; singular: string };

/** FAST5 T65 (CR 105.1): "draw a card for each color among other artifacts you control": one for each color the set has (the `distinct` quantity of colors) */
function distinctColorParts(q: Extract<Quantity, { q: 'distinct' }>, st: RenderState): CountParts | null {
  if (q.what !== 'colors') return null;
  const { among } = distinctParts(q, st);
  // CLOUD std-misc (CR 105.2; Ancient Cornucopia): the colors of ONE object, "for each of that spell's colors"
  if (q.among.ref !== 'each' && q.among.ref !== 'union') {
    const own = `of ${K.obj(q.among, st, 'possessive').text} colors`;
    const [plural, singular] = [`colors among ${among}`, `color among ${among}`].map((w) => alt(w, own));
    return { plural: plural!, singular: singular! };
  }
  return { plural: `colors among ${among}`, singular: `color among ${among}` };
}

/** FAST5 T68 (CR 105.1): "for each color among Allies you control" (the different colors of a set of objects) */
function distinctColorAmongParts(q: Extract<Quantity, { q: 'distinct' }>, st: RenderState): CountParts | null {
  if (q.what !== 'colors' || q.among.ref !== 'each' || !('filter' in q.among)) return null;
  const among = K.np(q.among.filter, st, { det: 'none', plural: true });
  return { plural: `colors among ${among}`, singular: `color among ${among}` };
}

/** FAST5 T58 (CR 105.1, 105.2): "for each color among other artifacts you control" (Karn, Gilded Guardian): the colors any of them has, each once; also "card type",
 * "creature type" (DISTINCT_SINGULAR) */
function distinctKindParts(q: Extract<Quantity, { q: 'distinct' }>, st: RenderState): CountParts | null {
  const one = DISTINCT_SINGULAR[q.what];
  if (one === undefined) return null;
  const { among, w } = distinctParts(q, st);
  return { plural: `${w} among ${among}`, singular: `${one} among ${among}` };
}

/** edh-d-85 (CR 122.1; Blitzball Stadium): "for each kind of counter on it": the kinds of counter on one object (not a group: that is "among"). */
function kindsOfCountersOnParts(q: Extract<Quantity, { q: 'distinct' }>, st: RenderState): CountParts | null {
  if (q.what !== 'counterKinds' || q.among.ref === 'each') return null;
  const on = K.obj(q.among, st, 'object').text;
  return { plural: `kinds of counters on ${on}`, singular: `kind of counter on ${on}` };
}

/** The pieces of a quantity that counts things: used for "the number of X" and for "for each Y". Null when the quantity is not a count of things. */
/** r4-refs: `max(spellsCastThisTurn - 1, 0)`, the spells you've cast this turn other than the first. */
function afterFirstSpell(q: Quantity): boolean {
  return JSON.stringify(q) === JSON.stringify({ q: 'math', op: 'max', args: [{ q: 'math', op: '-', args: [{ q: 'spellsCastThisTurn' }, 1] }, 0] });
}

export function countParts(q: Quantity, st: RenderState): { plural: string; singular: string } | null {
  if (typeof q === 'number') return null;
  switch (q.q) {
    // edh-c-100 (CR 202.1, 107.4, 604.1; Light from Within): inside a continuous effect, "for each white mana symbol in its mana cost" (the modified object, `{ref:'subject'}`)
    case 'symbolsAmong': return q.of.ref === 'subject' && Object.keys(q.of).length === 1 ? { plural: `${COLOR_WORD[q.color]} mana symbols in its mana cost`, singular: `${COLOR_WORD[q.color]} mana symbol in its mana cost` } : null;
    // edh-combat-5 (CR 508.1): inside a continuous effect, "for each time it has attacked this turn" (the modified creature, `{ref:'subject'}`)
    case 'attacksThisTurn': return q.of.ref === 'subject' ? { plural: 'times it has attacked this turn', singular: 'time it has attacked this turn' } : null;
    // std-costs-1 (CR 601.2b, 601.2f): the permanents announced for the spell's optional "sacrifice any number of" cost (parser/templates/zz-cloud/std-costs-1.json)
    // edh-players-13 (CR 701.38a-b; Tivit, Seller of Secrets): "For each evidence vote, investigate." (parser/holes/vote.ts#voteCount)
    case 'votes': return { plural: `${q.choice} votes`, singular: `${q.choice} vote` };
    // edh-d-72 (CR 105.1, 607.2d; Tablet of the Guilds): "you gain 1 life for each of the chosen colors it is" (the colors the source's "choose two colors" kept, that the object is)
    case 'chosenColorsOf': return q.of === undefined || q.link !== 'color' ? null : { plural: `of the chosen colors ${K.obj(q.of, st, 'subject').text} is`, singular: `of the chosen colors ${K.obj(q.of, st, 'subject').text} is` };
    // edhn95 (CR 104.3; Rampant Frogantua): "for each player who has lost the game"
    case 'playersLost': return { plural: 'players who have lost the game', singular: 'player who has lost the game' };
    // edhd27 (CR 701.38a-b; parser/holes/vote.ts#voteYou): "for each vote you received" / "for each vote they received" (the player a group instruction is at)
    case 'votesFor': return q.of.ref === 'you' ? { plural: 'votes you received', singular: 'vote you received' } : q.of.ref === 'iterating' ? { plural: 'votes they received', singular: 'vote they received' } : null;
    // edh-mana-keywords-10 (CR 706.2, 608.2h; Luck Bobblehead): "Create a tapped Treasure token for each even result"
    case 'diceResults': return typeof q.match === 'number' ? st.diceRolled === undefined ? null : { plural: `results of ${q.match}`, singular: `result of ${q.match}` } /* edh-next-128 (Celebr-8000): "for each result of 1" */ : q.match === 'distinct' ? { plural: 'different results', singular: 'different result' } /* edh-next-55 (Circuits Act) */ : { plural: `${q.match} results`, singular: `${q.match} result` };
    case 'costCount': return st.costCountNouns?.[q.name] ?? { plural: 'permanents sacrificed this way', singular: 'permanent sacrificed this way' };
    // edh-next-147 (CR 123.6e; _____ Goblin): "Add {R} for each unique vowel on that sticker" (the name sticker this resolution put)
    case 'stickerVowels': return { plural: 'unique vowels on that sticker', singular: 'unique vowel on that sticker' };
    // std-rq (CR 603.2c, 608.2c): in an ability that triggers on a discard of one or more cards and nothing else, the amount of the triggering event is the cards
    // discarded, "for each card discarded this way" (parser/lower/quantities.ts reads the words so only there)
    case 'eventAmount': {
      const on = st.trigger ?? [];
      const ev = on[0];
      if (on.length !== 1 || ev?.ev !== 'action' || (ev.verb !== 'discard' && ev.verb !== 'scry') || Object.keys(ev).some((k) => k !== 'ev' && k !== 'verb' && k !== 'actor')) return null;
      if (ev.verb === 'scry') return { plural: 'cards looked at while scrying this way', singular: 'card looked at while scrying this way' }; // edh-next-38 (CR 701.22a): the scry's amount, parser/holes/edhn38.ts
      return { plural: 'cards discarded this way', singular: 'card discarded this way' };
    }
    case 'count': {
      // edh-next-56 (CR 607.2a; The Kenriths' Royal Funeral): the cards the object's linked ability exiled, "for each card exiled with ~"
      if (q.of.ref === 'linked' && q.of.link === 'exiled') { const me = K.obj({ ref: 'self' }, st, 'object').text; return { plural: `cards exiled with ${me}`, singular: `card exiled with ${me}` }; }
      // edh-d-48 (CR 702.51a, 400.7d; Ancient Imperiosaur): the creatures tapped to convoke the spell this permanent was, "for each creature that convoked it"
      if (q.of.ref === 'convokers') return { plural: 'creatures that convoked it', singular: 'creature that convoked it' };
      // edh-next-104 (CR 601.2b, 608.2h; Burn at the Stake): the creatures a spell's additional tap cost tapped, "the number of creatures tapped this way"
      if (q.of.ref === 'costTapped') return { plural: 'creatures tapped this way', singular: 'creature tapped this way' };
      // edh-d-75 (CR 701.15a, 608.2c; Kaima, the Fractured Calm): the creatures one goad instruction goaded, "for each creature goaded this way"
      if (q.of.ref === 'bound' && st.info.get(`b:${q.of.name}`)?.thisWay === 'goaded this way') return { plural: 'creatures goaded this way', singular: 'creature goaded this way' };
      if (q.of.ref !== 'each') return costCountParts(q.of, st); // Cloud r3-moved: "the number of cards exiled this way" of a cost
      // std-rq (CR 406.1, 400.7): the cards an earlier instruction named that are in exile still, "for each of those cards that are still exiled"
      const f0 = 'filter' in q.of ? q.of.filter : undefined;
      if (f0 !== undefined && f0.zone === 'exile' && f0.is !== undefined && Object.keys(f0).length === 2 && (f0.is as { ref?: string }).ref === 'bound') {
        const those = K.obj(f0.is as ObjRef, st, 'object');
        if (!those.plural) return null;
        return { plural: `${those.text} that are still exiled`, singular: `of ${those.text} that are still exiled` };
      }
      // std-rx35 (CR 701.17a, 608.2c; parser/holes/qty.ts#milledThisWayCount): the cards of a description among those a mill step put into a graveyard (named
      // "milled this way" by render/fold.ts), "for each creature card milled this way"
      if (f0 !== undefined && f0.zone === 'any' && f0.anyOf === undefined && f0.is !== undefined && (f0.is as { ref?: string }).ref === 'bound' && st.info.has(`${MILLED_KEY}${(f0.is as { name: string }).name}`)) {
        const { is: _is, zone: _zone, ...rest } = f0;
        if (!Object.values(rest).some((v) => v !== undefined)) return null;
        const bare = K.np({ ...rest, zone: 'graveyard' }, st, { det: 'none', noZone: true });
        const many = K.np({ ...rest, zone: 'graveyard' }, st, { det: 'none', plural: true, noZone: true });
        return { plural: `${many} milled this way`, singular: `${bare} milled this way` };
      }
      // edh-d-77 (CR 607.2a, 607.2q; Murktide Regent): the cards of a description among those the object's linked ability (or its delve payment) exiled, "for each instant and sorcery card exiled with it"
      if (f0 !== undefined && f0.zone === 'any' && f0.isCard === true && f0.anyOf?.length === 1 && (f0.is as { ref?: string; link?: string } | undefined)?.ref === 'linked' && (f0.is as { link?: string }).link === 'exiled'
        && Object.keys(f0).filter((k) => (f0 as Record<string, unknown>)[k] !== undefined).length === 4) {
        const cards = { ...f0.anyOf[0]!, zone: 'exile' as const };
        return { plural: `${K.np(cards, cloneState(st), { det: 'none', plural: true, noZone: true })} exiled with it`, singular: `${K.np(cards, cloneState(st), { det: 'none', forEach: true, noZone: true })} exiled with it` };
      }
      // std-r10 (CR 115.1): both nouns are said from the same point, so a target the description names is said in full in each ("the number of creatures target
      // player controls", "for each creature target player controls"), never "that player" in the singular because the plural named it first
      const fresh = cloneState(st);
      const plural = K.np(q.of.filter, st, { det: 'none', plural: true });
      const singular = K.np(q.of.filter, fresh, { det: 'none', forEach: true });
      absorb(st, fresh);
      // CMD4 (CR 400.1, 109.4; family on-the-battlefield): permanents of no particular controller are every such permanent on the battlefield: "the number of Elves"
      // and "the number of Elves on the battlefield", "for each Elf" and "for each Elf on the battlefield" are one count (ObjectFilter.zone: the battlefield when none is said)
      const f = q.of.filter;
      const everywhere = (f.zone === undefined || f.zone === 'battlefield') && f.controller === undefined && f.owner === undefined;
      // edh-next-8 (CR 201.2, 400.1; Relentless Rats): the place comes before the name, "for each other creature on the battlefield named Relentless Rats" (family on-the-battlefield-before-name)
      if (everywhere && typeof f.name === 'string' && f.notName === undefined) {
        const unnamed = { ...f, name: undefined };
        const pluralBefore = K.np(unnamed, cloneState(st), { det: 'none', plural: true });
        const singularBefore = K.np(unnamed, cloneState(st), { det: 'none', forEach: true });
        return { plural: alt(plural, `${plural} on the battlefield`, `${pluralBefore} on the battlefield named ${f.name}`), singular: alt(singular, `${singular} on the battlefield`, `${singularBefore} on the battlefield named ${f.name}`) };
      }
      // edh-c-2 (family on-the-battlefield; Dauthi Warlord): a lone keyword is said after "on the battlefield" too, "the number of creatures on the battlefield with shadow"
      const kwAfter = (p: boolean): string[] => {
        const { keyword, zone: _zone, ...rest } = f;
        const plain = Object.keys(rest).length === 1 && Array.isArray(rest.types) && typeof keyword === 'string';
        return plain ? [`${K.np(rest, cloneState(st), p ? { det: 'none', plural: true } : { det: 'none', forEach: true })} on the battlefield with ${keyword}`] : [];
      };
      return everywhere ? { plural: alt(plural, `${plural} on the battlefield`, ...kwAfter(true)), singular: alt(singular, `${singular} on the battlefield`, ...kwAfter(false)) } : { plural, singular };
    }
    // FAST3 T12: "for each charge counter on ~" (CR 122.1): the counters of one kind on one object
    // std-rm (CR 121.1, 601.2i): "for each card you've drawn this turn", "for each spell you've cast this turn"
    // edh-c-35 (CR 702.82c; Tar Fiend, Marrow Chomper): the permanents the object devoured as it entered
    case 'chosenNumber': return q.link === 'devoured' ? { plural: 'creatures it devoured', singular: 'creature it devoured' } : null;
    case 'cardsDrawnThisTurn': return { plural: "cards you've drawn this turn", singular: "card you've drawn this turn" };
    case 'spellsCastThisTurn': return { plural: "spells you've cast this turn", singular: "spell you've cast this turn" };
    // edh-c-9 (CR 700.5; Springjack Shepherd): your devotion to one color is also "for each white mana symbol in the mana costs of permanents you control"
    case 'devotion': {
      if (q.of.ref !== 'you' || q.to.length !== 1) return null;
      const w = COLOR_WORD[q.to[0]!] ?? q.to[0]!;
      return { plural: `${w} mana symbols in the mana costs of permanents you control`, singular: `${w} mana symbol in the mana costs of permanents you control` };
    }
    case 'counters': {
      // std-rm (CR 122.1): "for each experience counter you have", "for each poison counter they have": the counters of one kind a player has
      if (isPlayerRef(q.on, st)) {
        if (q.kind === 'any') return null;
        // pc-tokens-1 (CR 122.1f, 102.3; Phyrexian Swarmlord): "for each poison counter your opponents have": the counters of every opponent together (effects/eval.ts sums over the players)
        if (isYourOpponents(q.on)) return { plural: `${q.kind} counters your opponents have`, singular: `${q.kind} counter your opponents have` };
        if (q.on.ref === 'each' && (q.on as { who?: string }).who === 'player') return null; // edh-next-26: the sum over every player is said "the total number of ... among players" (onPhrase), never "for each"
        const p = K.player(q.on as PlayerRef, st, 'subject');
        const has = p.person === 'sg' ? 'has' : 'have';
        return { plural: `${q.kind} counters ${p.text} ${has}`, singular: `${q.kind} counter ${p.text} ${has}` };
      }
      // edh-c-112 (CR 122.1, 303.4; Gleam of Authority): "for each +1/+1 counter on other creatures you control" (the group without "all", as Oracle says it when "other" excludes the enchanted creature)
      const grp = q.on as ObjRef;
      const on = grp.ref === 'each' && 'filter' in grp && grp.filter.other === true && grp.filter.types?.join() === 'Creature' && grp.filter.controller === 'you' ? K.np(grp.filter, st, { det: 'none', plural: true }) : K.obj(q.on as ObjRef, st, 'object').text;
      // std-rq (CR 122.1): every counter of every kind on one object, "for each counter on it"
      // edh-c-101 (CR 122.1; Chong and Lily, Nomads): a described group also reads "for each lore counter among Sagas you control" (family counters-on-group)
      if (q.on.ref === 'each' && 'filter' in q.on) {
        const grp = K.np(q.on.filter, st, { det: 'none', plural: true });
        const k = q.kind === 'any' ? '' : `${q.kind} `;
        // edh-d-6 (family counters-on-group; Deepwood Denizen): also "for each +1/+1 counter on creatures you control" (the group without "all", as the "the number of" form says it)
        return { plural: alt(`${k}counters on ${on}`, `${k}counters on ${grp}`, `${k}counters among ${grp}`), singular: alt(`${k}counter on ${on}`, `${k}counter on ${grp}`, `${k}counter among ${grp}`) };
      }
      if (q.kind === 'any') return { plural: `counters on ${on}`, singular: `counter on ${on}` };
      return { plural: `${q.kind} counters on ${on}`, singular: `${q.kind} counter on ${on}` };
    }
    // FAST3 T12: domain, "basic land types among lands you control" (CR 305.6)
    case 'math': {
      // r4-refs (CR 601.2i, 608.2h): "for each spell you've cast this turn other than the first": the spells cast this turn less one, never below zero
      if (afterFirstSpell(q)) return { plural: "spells you've cast this turn other than the first", singular: "spell you've cast this turn other than the first" };
      // edhd68 (CR 608.2h, 702.62b; Rose Tyler): "for each suspended card you own and each other permanent you control with a time counter on it": the sum of two counts
      // of things, each said with its own "each"; only a sum of exactly two counts of "each" sets (`for each A and each B`), the plural reads "A and B"
      if (q.op === '+' && q.args.length === 2) {
        const [a, b] = q.args.map((x) => (typeof x === 'object' && x.q === 'count' && x.of.ref === 'each' ? countParts(x, st) : null));
        if (a && b) return { plural: `${a.plural} and ${b.plural}`, singular: `${a.singular} and each ${b.singular}` };
      }
      const d = domainOf(q);
      if (d === null) return null;
      const among = K.np(d, st, { det: 'none', plural: true });
      return { plural: `basic land types among ${among}`, singular: `basic land type among ${among}` };
    }
    // QTY1 (CR 105.1, 105.2): "for each color among other artifacts you control", "for each card type among cards in your graveyard": the readings of a
    // `distinct` quantity, tried in turn (T65, T68, T58 were three clauses of this switch, so only the first ever ran); the first with words is the one
    case 'distinct': return kindsOfCountersOnParts(q, st) ?? distinctColorParts(q, st) ?? distinctColorAmongParts(q, st) ?? distinctKindParts(q, st);
    case 'countPlayers': {
      const of = q.of;
      if (q.controlsIs !== undefined && (q.sizeIs !== undefined || q.lifeIs !== undefined || q.lostLifeIs !== undefined || of.ref !== 'each')) throw new NoRenderer('a count of players who control a number of permanents, narrowed otherwise too');
      // edh-next-83 (CR 119.1, 103.4; parser/holes/qty.ts; Anya): "for each opponent whose life total is less than half their starting life total", only this
      const halfStart = q.lifeIs?.halfStarting === true && q.lifeIs.op === '<' && of.ref === 'each' && of.who === 'opponent' && Object.keys(q).sort().join() === 'lifeIs,of,q';
      if (halfStart) return { plural: 'opponents whose life total is less than half their starting life total', singular: 'opponent whose life total is less than half their starting life total' };
      if (q.lifeIs !== undefined) throw new NoRenderer('a count of players by their life total (r4-static: rendered as a condition only)');
      // edh-d-70 (CR 122.1f, 102.3; Glissa's Retriever, Wurmquake; parser/holes/edhd70.ts): "the number of opponents who have three or more poison counters", "for each opponent with three or more
      // poison counters" (corrupted): the opponents each judged alone, only "N or more" and no other narrowing of the players
      if (q.poisonIs !== undefined && q.poisonIs.op === '>=' && q.poisonIs.n >= 1 && of.ref === 'each' && of.who === 'opponent' && Object.keys(q).sort().join() === 'of,poisonIs,q') {
        const w = `${numWord(q.poisonIs.n)} or more poison counters`;
        return { plural: `opponents who have ${w}`, singular: `opponent with ${w}` };
      }
      if (q.poisonIs !== undefined) throw new NoRenderer('a count of players by their poison counters (std-rx24: rendered as a condition only)');
      if (q.lostLifeIs !== undefined) throw new NoRenderer('a count of players by the life they lost this turn (Standard round P: rendered as a condition only)');
      // edh-c-6 (CR 506.2, 506.3; parser/holes/qty.ts; Pack Attack): "the number of players being attacked", no narrowing of the players
      if (of.ref === 'attacked' && Object.keys(q).length === 2) return { plural: 'players being attacked', singular: 'player being attacked' };
      if (of.ref === 'voters') { // M12F (CR 701.38a): only after "whenever players finish voting" (render/refs.ts says the same)
        if (st.trigger === null || st.trigger.length !== 1 || st.trigger[0]!.ev !== 'action' || st.trigger[0]!.verb !== 'votesFinished') throw new NoRenderer('ref:voters outside a "whenever players finish voting" trigger');
        if (of.andYou === true) throw new NoRenderer('countPlayers of ref:voters andYou'); // M12 gaps: no card counts "you and each opponent who ..."
        const who = `who voted for a choice you ${of.agree ? 'voted for' : "didn't vote for"}`;
        return { plural: `opponents ${who}`, singular: `opponent ${who}` };
      }
      // std-hob (CR 404.1, 402.1): "graveyard with seven or more cards in it": each player has one graveyard, so the players whose graveyard holds that many cards
      if (q.sizeIs !== undefined) {
        const { zone, op, n } = q.sizeIs;
        // r3-refs (CR 402.1): "for each opponent who has one or fewer cards in hand": the players whose hand holds at most / at least a fixed number of cards
        if (zone === 'hand' && of.ref === 'each' && (of.who === 'opponent' || of.who === 'player') && (op === '>=' || op === '<=')) {
          const w = `${numWord(n)} or ${op === '>=' ? 'more' : 'fewer'} cards in hand`;
          // edh-b-6 (CR 402.1, 102.3, 608.2h; Wolfcaller's Howl): "the number of your opponents with four or more cards in hand" counts the same opponents
          return { plural: of.who === 'opponent' ? alt(`${pluralize(of.who)} who have ${w}`, `your opponents with ${w}`) : `${pluralize(of.who)} who have ${w}`, singular: `${of.who} who has ${w}` };
        }
        if (zone !== 'graveyard' || of.ref !== 'each' || of.who !== 'player' || (op !== '>=' && op !== '<=')) throw new NoRenderer('a count of players by the size of a zone other than "graveyards with N or more / fewer cards in them"');
        const w = op === '>=' ? 'or more' : 'or fewer';
        return { plural: `graveyards with ${n} ${w} cards in them`, singular: `graveyard with ${n} ${w} cards in it` };
      }
      if (of.ref === 'each') {
        const word = of.who === 'opponent' ? 'opponent' : of.who === 'otherPlayer' ? 'other player' : 'player';
        if (q.controlsIs !== undefined) {
          // std-rx12 (CR 102.3, 108.4): "the number of opponents who control an artifact", "for each opponent who controls a creature": the players who control one or
          // more permanents of the description (parser/holes/qty.ts#opponentCounts); only "one or more", said with one article, and no other narrowing of the players
          const { filter, op, n } = q.controlsIs;
          if (op !== '>=' || n !== 1 || q.sizeVs !== undefined || q.controlsVs !== undefined || q.lostLifeThisTurn === true || filter.controller !== undefined) {
            throw new NoRenderer('a count of players who control a number of permanents other than one or more');
          }
          const what = K.np(filter, st, { det: 'a', noController: true });
          return { plural: `${pluralize(word)} who control ${what}`, singular: `${word} who controls ${what}` };
        }
        if (q.controlsVs !== undefined) {
          // std-rk (CR 102.3, 608.2h): "for each opponent who controls fewer creatures than you", "the number of opponents who control more lands than you": each
          // opponent judged alone (parser/holes/qty.ts#opponentCounts); only opponents, compared with you, by more or fewer. Elsewhere still a condition only (std-sos review)
          const { filter, op, than, by } = q.controlsVs;
          // edh-d-37 (CR 102.3, 608.2h; Surveyor's Scope): "the number of players who control at least two more lands than you" (`controlsVs.by`, as edh-c-58's condition)
          const atLeast = op === '>=' && by !== undefined && by >= 2;
          if (of.who !== 'opponent' || than.ref !== 'you' || (!atLeast && ((op !== '>' && op !== '<') || by !== undefined)) || q.sizeVs !== undefined || q.lostLifeThisTurn === true || filter.controller !== undefined) {
            throw new NoRenderer('a count of players who control more permanents than another player (std-sos review: rendered as a condition only)');
          }
          const w = atLeast ? `at least ${numWord(by)} more ${K.np(filter, st, { det: 'none', plural: true })} than you` : `${op === '>' ? 'more' : 'fewer'} ${K.np(filter, st, { det: 'none', plural: true })} than you`;
          // edh-next-22 (family players-who-control-more; Oreskos Explorer): "the number of players who control more lands than you" counts the opponents who do (a player never controls more than themselves)
          return { plural: alt(`opponents who control ${w}`, `players who control ${w}`), singular: alt(`opponent who controls ${w}`, `player who controls ${w}`) };
        }
        // edh-d-42 (CR 119.1, 102.3; Great Unclean One): "for each opponent who has less life than you", "the number of opponents who have more life than you": each opponent judged alone
        // (parser/holes/qty.ts#opponentCounts); only opponents, compared with you, by more or less life, and no other narrowing of the players
        // (any other count by life compared with a player keeps the reading it had: the words of the condition that holds it, std-lci)
        if (q.lifeVs !== undefined && of.who === 'opponent' && q.lifeVs.than.ref === 'you' && (q.lifeVs.op === '>' || q.lifeVs.op === '<') && q.sizeVs === undefined && q.lostLifeThisTurn !== true && q.controlsVs === undefined) {
          const w = `${q.lifeVs.op === '>' ? 'more' : 'less'} life than you`;
          return { plural: `opponents who have ${w}`, singular: `opponent who has ${w}` };
        }
        if (q.sizeVs !== undefined) {
          if (q.lostLifeThisTurn === true) throw new NoRenderer('a count of players with a bigger zone who also lost life this turn');
          const w = sizeVsWords(q.sizeVs); // FAST5 T53 (CR 402.1)
          // edh-players-21 (Consuming Tide): the singular may say "in their hand"
          const theirHand = q.sizeVs.zone === 'hand' ? w.replace('in hand', 'in their hand') : w;
          return { plural: `${pluralize(word)} who have ${w}`, singular: alt(`${word} who has ${w}`, `${word} who has ${theirHand}`) };
        }
        // std-mkm (CR 119.3, 120.3a): "for each opponent who lost life this turn"
        // edh-b-12 (family for-each-of-your-opponents-who-lost-life; Belbe, Corrupted Observer): "for each of your opponents who lost life this turn" counts the same opponents
        if (q.lostLifeThisTurn === true) return { plural: `${pluralize(word)} who lost life this turn`, singular: of.who === 'opponent' ? alt(`${word} who lost life this turn`, 'of your opponents who lost life this turn') : `${word} who lost life this turn` };
        // std-rx20 (CR 102.3, family opponent-you-have): "for each opponent you have" counts the same players as "for each opponent" (Big Apple, 3 a.m.)
        // edh-zones-16 (CR 102.1; Open the Way): "the number of players in the game" counts the same players as "the number of players" (family players-in-the-game)
        return { plural: of.who === 'player' ? alt(pluralize(word), 'players in the game') : pluralize(word), singular: of.who === 'opponent' ? alt(word, 'opponent you have') : word };
      }
      // edh-replace-5 (CR 603.2c, 102.3; Malcolm, Keen-Eyed Navigator): "for each opponent dealt damage": the opponents who are the recipients of a damage trigger's batch
      // (parser/holes/qty.ts#opponentCounts); only the one damage event whose recipient is an opponent, and no other narrowing of the players
      if (of.ref === 'event' && of.role === 'recipient' && q.sizeVs === undefined && q.controlsVs === undefined && q.controlsIs === undefined && q.lostLifeThisTurn !== true && q.sizeIs === undefined) {
        const ev = (st.trigger ?? []).length === 1 ? st.trigger![0]! : undefined;
        if (ev?.ev !== 'damage' || ev.recipient?.player !== 'opponent' || ev.recipient.object !== undefined) throw new NoRenderer('a count of the recipients of an event other than damage dealt to opponents');
        // edh-players-18 (Hordewing Skaab): "the number of opponents dealt damage this way" is the plural form, counted after the damage that triggered the ability
        return { plural: 'opponents dealt damage this way', singular: 'opponent dealt damage' };
      }
      if (q.sizeVs !== undefined || q.controlsVs !== undefined || q.controlsIs !== undefined || q.lostLifeThisTurn === true) throw new NoRenderer('a count of players with a bigger zone (or more permanents) than another player or who lost life this turn, of a group other than each player');
      return { plural: 'players', singular: 'player' };
    }
    // edh-players-14 (CR 506.3, 508.1; Rose, Cutthroat Raider): "for each opponent you attacked [this turn]": the whole turn's count of the different opponents attacked (family for-each-opponent-you-attacked)
    case 'opponentsAttacked': if (q.scope === 'turn') return { plural: 'opponents you attacked this turn', singular: alt('opponent you attacked this turn', "opponent you've attacked this turn", 'opponent you attacked') }; throw new NoRenderer('the opponents attacked in this combat said "for each"');
    case 'happenedCount': return q.sum === 'manaValue' || q.sum === 'power' /* edh-d-92 */ || (q.per === 'player' && q.by === 'opponent' && q.event.ev === 'draw') /* edh-c-46: a greatest number, no count of things */ || damageTotalTo(q) !== null || damageTotalToOpponents(q) !== null ? null : happened(q, st); // edh-cast-12: a total of mana values is no count of things // std-rx29: an amount of damage is no count of things
    // edh-players-9 (CR 102.3, 121.1, 120.2a): "for each opponent who drew two or more cards this turn", "the number of opponents that were dealt combat damage this turn"
    case 'happenedPlayers': return happenedPlayersParts(q);
    // CLOUD std-tmt (CR 205.2a): "for each card type among spells you've cast this turn" (a cast count's words, after "card types among")
    case 'happenedDistinct': {
      const h = happened({ q: 'happenedCount', event: q.event, scope: q.scope, ...(q.by !== undefined ? { by: q.by } : {}) }, st);
      if ((q.event.ev !== 'cast' && !(q.event.ev === 'action' && q.event.verb === 'sacrifice' /* edh-next-58 (CR 701.21a) */)) || q.what !== 'cardTypes') throw new NoRenderer('different card types among events other than casts'); // cloud r3-mech: 'sources' has only its idiom (render/cond.ts)
      return { plural: `card types among ${h.plural}`, singular: `card type among ${h.plural}` };
    }
    // M6-5 (CR 702.33d-e): "for each time it was kicked" / "the number of times ~ was kicked"
    case 'kickCount': {
      const self = K.obj({ ref: 'self' }, st, 'subject').text;
      if (q.name !== undefined) return namedCostParts(q.name); // M6-12: "for each time its squad cost was paid" (CR 702.157a)
      return { plural: `times ${self} was kicked`, singular: `time ${self} was kicked` };
    }
    // p2-mana-1 (CR 107.1c, 602.2b, 608.2c): the ability's X, when it is the number of <kind> counters its cost removed from ~ (render/abil.ts#activated)
    case 'X': {
      const k = st.costCountersX;
      if (k === undefined) return null;
      const kind = k === 'any' ? '' : `${k} `;
      return { plural: `${kind}counters removed this way`, singular: `${kind}counter removed this way` };
    }
    // std-rx14 (CR 122.1, 608.2c): "for each lore counter removed this way", "the number of counters removed this way"
    case 'countersRemoved': {
      const k = q.kind === undefined ? '' : `${q.kind} `;
      return { plural: `${k}counters removed this way`, singular: `${k}counter removed this way` };
    }
    // edh-c-1 (CR 119.3, 608.2c; Blood Tyrant): "for each 1 life lost this way" (the life of the loseLife instruction right before, every point counted once)
    case 'lifeLost': return q.who === undefined ? { plural: '1 life lost this way', singular: '1 life lost this way' } : null;
    // trek-6 (CR 122.6, 608.2c): "the number of +1/+1 counters put this way"
    case 'countersPut': {
      const k = q.kind === undefined ? '' : `${q.kind} `;
      return { plural: `${k}counters put this way`, singular: `${k}counter put this way` };
    }
    // FAST5 T37 (CR 601.2h; converge): "for each color of mana spent to cast it" (a permanent that enters with counters for it)
    case 'colorsSpent': { const m = alt('mana spent to cast it', 'mana spent to cast this spell', `mana spent to cast ${K.obj({ ref: 'self' }, st, 'object').text}`); return { plural: `colors of ${m}`, singular: `color of ${m}` }; } // edh-c-27 (family spent-to-cast-this-spell; Sweep the Skies)
    // edh-c-58 (CR 601.2h, 107.4; Verazol): "for each mana spent to cast it" (a permanent that enters with counters for it)
    case 'manaSpent': return { plural: 'mana spent to cast it', singular: 'mana spent to cast it' };
    // edh-zones-26 (CR 107.4h, 601.2h; Search for Glory): "for each {S} spent to cast this spell"
    case 'activationManaFrom': { const m = `mana from ${pluralize(q.subtype)} spent to activate this ability`; return { plural: m, singular: m }; } // edh-next-129 (CR 602.2b; Mr. House)
    case 'snowSpent': { const m = alt('{s} spent to cast this spell', `{s} spent to cast ${K.obj({ ref: 'self' }, st, 'object').text}`, '{s} spent to cast ~', '{s} spent to cast it'); return { plural: m, singular: m }; }
    // FAST5 T51 (CR 601.2h): "for each color of mana spent to cast that spell" (the spell of a cast trigger)
    case 'spellColorsSpent': return { plural: 'colors of mana spent to cast that spell', singular: 'color of mana spent to cast that spell' };
    // FAST5X E19 (CR 106.3): "for each mana from a Cave spent to cast it"
    case 'spellManaSpent': {
      if (q.from === undefined || q.of === undefined) return null;
      const m = `mana from ${K.np(q.from, st, { det: 'a' })} spent to cast ${spentObjectText(q.of, st)}`;
      return { plural: m, singular: m };
    }
    // FAST5X E19 (CR 106.4): "for each unspent mana you have", "... unspent green mana you have"
    case 'unspentMana': {
      const m = q.type === undefined ? 'unspent mana' : `unspent ${q.type === 'C' ? 'colorless' : COLOR_WORD[q.type]} mana`;
      return { plural: `${m} you have`, singular: `${m} you have` };
    }
    case 'live': return countParts(q.value, st);
    // std-ry10 (CR 700.8): "for each creature in your party" (the count "the number of creatures in your party" is said below, FAST5 T38)
    case 'partySize': return q.of.ref === 'you' ? { plural: 'creatures in your party', singular: 'creature in your party' } : null;
    // FAST5 T78 (CR 608.2c): "for each creature tapped this way": what an earlier named step did (render/fold.ts#chooseThenTapAny)
    case 'resultCount': {
      if (q.to !== undefined) { diedCountPhrase(q, st); return { plural: 'creatures that died this way', singular: 'creature that died this way' }; } // edh-c-61
      // edh-next-128 (CR 705.2, 608.2c; Yusri, Fortune's Flame): the flips a called flip of several coins lost, "for each flip you lose"
      if (q.lost === true) return st.info.get(`r:${q.step}`)?.thisWay === 'you win' && Object.keys(q).length === 3 ? { plural: 'flips you lose', singular: 'flip you lose' } : null;
      if (q.which !== undefined) return movedCountParts(q, st); // Cloud C7: "for each creature destroyed this way" (CR 608.2c, 608.2h)
      const r = st.info.get(`r:${q.step}`);
      const noun = r?.nouns[0];
      // std-tdm (CR 701.8a; family destroyed-this-way-noun): what a destroy step destroyed is said with each of its nouns, "for each permanent destroyed this way"
      // or "for each creature destroyed this way" (render/steps-zones.ts#destroy names only the nouns that cover everything it destroys)
      if (r?.thisWay === 'destroyed this way' && r.nouns.length > 1) {
        return { plural: alt(...r.nouns.map((n) => `${pluralize(n)} ${r.thisWay}`)), singular: alt(...r.nouns.map((n) => `${n} ${r.thisWay}`)) };
      }
      return r?.thisWay !== undefined && noun !== undefined ? { plural: `${pluralize(noun)} ${r.thisWay}`, singular: `${noun} ${r.thisWay}` } : null;
    }
    // M11-4 (CR 903.8): "for each time you've cast your commander from the command zone this game" (Commander's Insignia)
    // CMDF: "a commander" counts the same casts (equivalence a-commander-casts: Jirina Kudro, Captain Vargus Wrath, Font of Magic)
    case 'commanderCasts': {
      if (q.of !== undefined || q.self === true || q.spell === true) return null; // CMD2; edh-mana-keywords-2: `self` is worded by the mana rider (render/steps-cards.ts#riderText): another player's casts are worded by the step that reads them (render/steps-cards.ts#draw)
      const who = alt('your commander', 'a commander');
      return { plural: `times you've cast ${who} from the command zone this game`, singular: `time you've cast ${who} from the command zone this game` };
    }
    default: return null;
  }
}

/** CMD2: the filter of parser/holes/commander-qty.ts, exactly: commanders you own on the battlefield or in the command zone. */
const isCommandersOwnedOnBattlefieldOrCommand = (f: ObjectFilter): boolean => {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  const z = f.zone;
  return keys.length === 3 && f.commander === true && f.owner === 'you' && Array.isArray(z) && z.length === 2 && z.includes('battlefield') && z.includes('command');
};

/** edh-next-75 (CR 903.3d; Imposing Grandeur): the same set for the player an instruction iterates over, "a commander they own on the battlefield or in the command zone" (`owner: {ref:'iterating'}`). */
const isCommandersTheyOwnOnBattlefieldOrCommand = (f: ObjectFilter): boolean => {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  const z = f.zone;
  const o = f.owner;
  return keys.length === 3 && f.commander === true && typeof o === 'object' && o.ref === 'iterating' && Array.isArray(z) && z.length === 2 && z.includes('battlefield') && z.includes('command');
};

/** std-rx29: the object of "the amount of damage dealt to <it> this turn" (`happenedCount` summing this turn's damage to one object, nothing else), or null. */
function damageTotalTo(q: Extract<Quantity, { q: 'happenedCount' }>): ObjRef | null {
  const ev = q.event;
  if (q.sum !== 'amount' || q.scope !== 'turn' || q.per !== undefined || q.by !== undefined || q.beforeEvent !== undefined || ev.ev !== 'damage') return null;
  if (Object.keys(ev).some((k) => k !== 'ev' && k !== 'recipient') || ev.recipient?.player !== undefined) return null;
  const o = ev.recipient?.object;
  return o !== undefined && Object.keys(o).length === 1 && o.is !== undefined ? o.is : null;
}

/**
 * edh-cast-3 (CR 120.1, 120.3; parser/holes/qty.ts): "the total amount of noncombat damage dealt to your opponents this turn": this turn's damage to any opponent, added up
 * (`combat: false` is noncombat damage only, `true` combat damage only). The words before "damage", or null for any other shape.
 */
function damageTotalToOpponents(q: Extract<Quantity, { q: 'happenedCount' }>): string | null {
  const ev = q.event;
  if (q.sum !== 'amount' || q.scope !== 'turn' || q.per !== undefined || q.by !== undefined || q.beforeEvent !== undefined || ev.ev !== 'damage') return null;
  if (Object.keys(ev).some((k) => k !== 'ev' && k !== 'recipient' && k !== 'combat') || ev.recipient === undefined || Object.keys(ev.recipient).length !== 1 || ev.recipient.player !== 'opponent') return null;
  return ev.combat === false ? 'noncombat ' : ev.combat === true ? 'combat ' : '';
}

/** edh-players-16 (CR 120.1; parser/holes/qty.ts): the player of "the damage dealt to <player> this turn" (any damage; a reference, not the opponents as a group), or null. */
function damageTotalToPlayer(q: Extract<Quantity, { q: 'happenedCount' }>): PlayerRef | null {
  const ev = q.event;
  if (q.sum !== 'amount' || q.scope !== 'turn' || q.per !== undefined || q.by !== undefined || q.beforeEvent !== undefined || ev.ev !== 'damage') return null;
  if (Object.keys(ev).some((k) => k !== 'ev' && k !== 'recipient') || ev.recipient === undefined || Object.keys(ev.recipient).length !== 1) return null;
  const p = ev.recipient.player;
  return typeof p === 'object' ? p : null;
}

/** std-rx29: the plural word of each statistic a difference within a group names ("the chosen creatures' powers"). */
const SPREAD_WORD: Record<string, string> = { power: 'powers', toughness: 'toughnesses', manaValue: 'mana values' };

/** std-rx29: `max(stat of G) - min(stat of G)` of one group an earlier step bound (the reading of parser/holes/qty.ts), or null. */
function spreadOf(q: Extract<Quantity, { q: 'math' }>): { stat: string; of: ObjRef } | null {
  if (q.op !== '-' || q.args.length !== 2) return null;
  const [a, b] = q.args;
  if (typeof a !== 'object' || typeof b !== 'object' || a.q !== 'stat' || b.q !== 'stat' || a.agg !== 'max' || b.agg !== 'min' || a.sum || b.sum || a.stat !== b.stat) return null;
  if (SPREAD_WORD[a.stat] === undefined || a.of.ref !== 'bound' || JSON.stringify(a.of) !== JSON.stringify(b.of)) return null;
  return { stat: a.stat, of: a.of };
}

/**
 * edh-perms-20 (CR 603.2c, 701.17a; family event-amount-milled-this-way; The Wise Mothman): in an ability that triggers on one or more cards being milled, the amount of the
 * triggering batch is also "the number of nonland cards milled this way" (parser/lower/quantities.ts#milledBatchAmount reads the words only for the trigger's own description).
 */
function milledBatchPhrase(st: RenderState): string[] {
  const on = st.trigger ?? [];
  const ev = on[0];
  if (on.length !== 1 || ev?.ev !== 'action' || ev.verb !== 'mill' || ev.object === undefined) return [];
  return [`the number of ${milledCardsNp(ev.object, st)} milled this way`];
}

function statPhrase(q: Extract<Quantity, { q: 'stat' }>, st: RenderState): string {
  const word = STAT_WORD[q.stat]!;
  // edh-players-21 (CR 608.2h, 101.4; Olórin's Searing Light): "the power of the creature they exiled": the one object each player of a group chose and exiled (render/fold-edhp21.ts)
  if (q.by !== undefined) {
    // edh-next-127 (CR 701.21a, 608.2h; Danse Macabre): "the toughness of the creature you sacrificed this way": of what an each-player sacrifice of one permanent sacrificed, the one you controlled
    const sac = q.of.ref === 'bound' ? st.info.get(`r:${q.of.name}`) : undefined;
    if (q.by.ref === 'you' && q.sum === true && q.agg === undefined && q.station === undefined && sac?.moved === 'sacrificed' && sac.sacrificedBy === JSON.stringify({ ref: 'each', who: 'player' }) && sac.nouns.length > 0) {
      return `the ${word} of the ${sac.nouns.find((n) => n !== 'permanent') ?? sac.nouns[0]!} you sacrificed this way`;
    }
    const noun = q.of.ref === 'bound' ? st.info.get(`b:${q.of.name}`)?.nouns[0] : undefined;
    if (q.by.ref !== 'iterating' || q.of.ref !== 'bound' || q.agg !== undefined || q.sum || q.station || noun === undefined || st.info.get(`b:${q.of.name}`)?.ownExile !== true) throw new NoRenderer('a statistic of what a player of a group exiled other than "the <stat> of the <noun> they exiled"');
    return `the ${word} of the ${noun} they exiled`;
  }
  // FAST5X E15 (CR 208.1, 202.3): "the greatest power among creatures you control", "the least mana value among ..."; Oracle names the set without a quantifier
  if (q.agg !== undefined) {
    // Cloud r3-moved (CR 608.2c, 608.2h): "the greatest mana value among cards discarded this way" (the cards one earlier discard bound)
    const moved = q.sum ? null : movedGroupNp(q.of, st);
    if (moved !== null) return q.agg === 'max' ? `the greatest ${word} among ${moved}` : `the least ${word} among ${moved}`;
    // edh-d-46 (CR 208.1, 603.2c, 608.2h; Shriekwood Devourer): the greatest of the creatures a batch trigger saw attack, "the greatest power among those creatures" (rendered on a copy of the state: the group is named, not mentioned)
    // edh-d-95 (CR 202.3, 603.2c, 608.2h; Amzu, Swarm's Hunger): ... and the objects of a "one or more" zone-change batch, "the greatest mana value among those cards" (a plural subject only)
    const batchSubject = !q.sum && q.of.ref === 'event' && q.of.role === 'subject' ? K.obj(q.of, cloneState(st), 'object') : null;
    if ((!q.sum && q.of.ref === 'event' && q.of.role === 'attacker') || batchSubject?.plural === true) {
      const g0 = K.obj(q.of, cloneState(st), 'object').text;
      // (the batch's objects are also "those <noun>", as the trigger called them: "whenever one or more cards leave your graveyard ... among those cards")
      const evs = (st.trigger ?? []).filter((e) => e.ev === 'zoneChange');
      const subj = evs.length === 1 && evs[0]!.ev === 'zoneChange' ? evs[0]!.subject : undefined;
      // (a card of a description: "those cards", "those creature cards"; a permanent: its nouns)
      const cardNoun = subj?.isCard === true ? (subj.types === undefined ? 'card' : subj.types.length === 1 ? `${subj.types[0]!.toLowerCase()} card` : null) : undefined;
      const nouns = batchSubject?.plural !== true || subj === undefined ? [] : cardNoun !== undefined ? (cardNoun === null ? [] : [cardNoun]) : K.nounsOf(subj).filter((n) => n !== '*');
      const group = nouns.length > 0 ? alt(g0, ...nouns.map((n) => `those ${pluralize(n)}`)) : g0;
      return q.agg === 'max' ? alt(`the greatest ${word} among ${group}`, `the highest ${word} among ${group}`) : `the least ${word} among ${group}`;
    }
    // only a set the parser reads (a filter over the game); anything else has no wording yet and stays manual (G6)
    if (q.sum || !(q.of.ref === 'each' && 'filter' in q.of)) throw new NoRenderer(`the ${q.agg} ${word} of ${JSON.stringify(q.of)}`);
    // CMD2 (CR 903.3d): "the greatest mana value of a commander you own on the battlefield or in the command zone" (parser/holes/commander-qty.ts): Oracle's
    // one wording of exactly this set (the commanders a player owns in those two zones)
    if (q.agg === 'max' && q.stat === 'manaValue' && isCommandersOwnedOnBattlefieldOrCommand(q.of.filter)) return 'the greatest mana value of a commander you own on the battlefield or in the command zone';
    if (q.agg === 'max' && q.stat === 'manaValue' && isCommandersTheyOwnOnBattlefieldOrCommand(q.of.filter)) return 'the greatest mana value of a commander they own on the battlefield or in the command zone';
    const set = K.np(q.of.filter, st, { det: 'none', plural: true });
    // edh-c-100 (CR 202.3, 109.2; Dragon Man): the objects of two descriptions are also "A and B", the card zone said with "in" ("among noncreature permanents you control and
    // noncreature cards in your graveyard"): the same set, the union of the two descriptions
    const f0 = q.of.filter;
    // the outer zones name where either description looks (a description with no zone looks on the battlefield, a card of the other one in the graveyard; rules/filter.ts#findIn)
    const outerOk = Object.keys(f0).every((k) => k === 'anyOf' || (k === 'zone' && JSON.stringify(f0.zone) === JSON.stringify(['battlefield', 'graveyard'])));
    const two = f0.anyOf !== undefined && f0.anyOf.length === 2 && outerOk && f0.anyOf[0]!.zone === undefined && f0.anyOf[1]!.zone === 'graveyard' ? f0.anyOf : null; // the second description's zone lies inside the outer zones
    if (two !== null && !q.sum) {
      const [a, b] = two.map((f) => K.np(f, st, { det: 'none', plural: true })) as [string, string];
      const both = alt(`${a} and ${b}`, `${a} and ${b.replace(/ from (your|their) graveyard$/, ' in $1 graveyard')}`);
      return q.agg === 'max' ? alt(`the greatest ${word} among ${set}`, `the highest ${word} among ${set}`, `the greatest ${word} among ${both}`, `the highest ${word} among ${both}`) : alt(`the least ${word} among ${set}`, `the least ${word} among ${both}`);
    }
    // pc-players-2 (CR 208.1, 110.1): a set that is just a kind of permanent on the battlefield is also said "among creatures on the battlefield" (High Score)
    const onBf = Object.keys(q.of.filter).length === 2 && q.of.filter.zone === 'battlefield' && Array.isArray(q.of.filter.types) ? ' on the battlefield' : '';
    return q.agg === 'max'
      ? alt(`the greatest ${word} among ${set}`, `the highest ${word} among ${set}`, ...(onBf !== '' ? [`the greatest ${word} among ${set}${onBf}`, `the highest ${word} among ${set}${onBf}`] : []))
      : alt(`the least ${word} among ${set}`, ...(onBf !== '' ? [`the least ${word} among ${set}${onBf}`] : []));
  }
  // MX3 (CR 701.54e): "your Ring-bearer's power" is the power of one permanent (or none: the quantity fails to determine, CR 608.2b)
  if (!q.sum && q.of.ref === 'each' && 'filter' in q.of && q.of.filter.ringBearer === 'you' && Object.keys(q.of.filter).length === 1) return `${K.obj(q.of, st, 'possessive').text} ${word}`;
  // CLOUD C8 (CR 608.2h, 202.3): the total of the cards a cost discarded is "the total mana value of the discarded cards" (Nahiri's Wrath), however many the cost discards
  if (q.sum && q.of.ref === 'costDiscarded') return `the total ${word} of the discarded cards`;
  // edh-players-4 (CR 701.17a, 608.2c; parser/lower/mentions.ts, Mention.demonstrative): the total of the cards a named mill put into a graveyard is "the total mana value of those
  // cards" (several cards milled are no antecedent of a pronoun or another noun, only of "those cards": a name of the mill step has no binding of its own to say it with)
  if (q.sum && q.of.ref === 'bound' && st.info.has(`${MILLED_KEY}${q.of.name}`)) return `the total ${word} of those cards`;
  // edh-d-75 (CR 701.15a, 208.1, 608.2c; Havoc Eater): the total of the creatures one goad instruction goaded is "the total power of creatures goaded this way"
  if (q.sum && q.of.ref === 'bound' && st.info.get(`b:${q.of.name}`)?.thisWay === 'goaded this way') return `the total ${word} of creatures goaded this way`;
  // edh-c-8 (CR 608.2h, 208.1; Corpse Cobble): the objects a cost of any number sacrificed, "the total power of the sacrificed creatures"; named by the nouns of the cost part when the ability states it, by any permanent noun
  // otherwise (a spell's additional cost is a static ability of its own, as for the one sacrificed object in render/refs.ts#obj)
  if (q.sum && q.of.ref === 'costSacrificed') {
    const cost = st.info.get('cost:sacrificed');
    const nouns = cost !== undefined && cost.nouns.length > 0 ? cost.nouns : ['creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'permanent'];
    return alt(...nouns.map((n) => `the total ${word} of the sacrificed ${pluralize(n)}`));
  }
  // edh-d-17 (CR 208.1, 608.2c, 701.21a; Reign of the Pit): the total of the creatures one earlier sacrifice bound is "the total power of the creatures sacrificed this way"
  if (q.sum && q.agg === undefined) {
    const movedSum = movedGroupNp(q.of, cloneState(st));
    if (movedSum !== null && movedSum.endsWith(' sacrificed this way')) return `the total ${word} of the ${movedSum}`;
  }
  if (q.sum || q.of.ref === 'each' || q.of.ref === 'union') {
    // std-rx29 (parser/holes/qty.ts; Kylox, Visionary Inventor): a group named before is also "their total power" (the possessive, on a copy of the state)
    const theirs = q.sum && (q.of.ref === 'bound' || q.of.ref === 'event') ? K.obj(q.of, cloneState(st), 'possessive') : null;
    const total0 = `the total ${word} of ${K.obj(q.of, st, 'object').text}`;
    // edh-next-138 (CR 608.2h, 701.8a; Convert to Slime; family total-of-destroyed-this-way): the total of the permanents one earlier destroy bound is also "the total mana value of permanents destroyed this way"
    const destroyed = q.sum && q.of.ref === 'bound' && st.info.get(`r:${q.of.name}`)?.moved === 'destroyed' ? [`the total ${word} of permanents destroyed this way`] : [];
    const total = (theirs !== null && theirs.plural) || destroyed.length > 0 ? alt(total0, ...(theirs !== null && theirs.plural ? [`${theirs.text} total ${word}`] : []), ...destroyed) : total0;
    // FAST4 T21: "the total power of creatures you control" (no quantifier) is how Oracle names the set here, as for `distinct` below (CR 208.1)
    // edh-zones-26 (CR 202.3, 608.2c; Dance with Calamity): a group an earlier step of the ability moved is also "the cards exiled this way" (the article with the participle)
    return q.of.ref === 'each' && 'filter' in q.of ? alt(total, `the total ${word} of ${K.np(q.of.filter, st, { det: 'none', plural: true })}`, ...(q.of.filter.is !== undefined ? [`the total ${word} of the ${K.np(q.of.filter, cloneState(st), { det: 'none', plural: true })}`] : [])) : total;
  }
  // FAST5 T70 (CR 608.2h, 202.3): "one plus the mana value of the sacrificed artifact": Oracle also puts the object after the statistic ("the power of the
  // sacrificed creature"); the object a cost sacrificed is only read from its last known information
  if (q.of.ref === 'costSacrificed' || q.of.ref === 'costDiscarded' || q.of.ref === 'costRevealed' /* p2-refs-1 */ || (q.of.ref === 'costExiled' && q.of.self !== true)) { // CLOUD C8: "the mana value of the discarded card" too
    const after = `the ${word} of ${K.obj(q.of, cloneState(st), 'object').text}`;
    return alt(`${K.obj(q.of, st, 'possessive').text} ${word}`, after);
  }
  // std-rx28 (CR 701.4a, 208.1): "the power of the creature you chose or the card you revealed" (Monstrous Emergence): only the statistic first
  if (q.of.ref === 'costBeheld' || q.of.ref === 'costChosenObject' || q.of.ref === 'costReturned') return `the ${word} of ${K.obj(q.of, st, 'object').text}`; // "the mana value of the returned creature"
  // FAST5 T66 (CR 202.3, 607.2a): "the mana value of the exiled card" is also how Oracle names the stat of what a linked ability exiled
  // CLOUD std-fdn (CR 202.3, 208.1, 608.2h): Oracle also puts any one object after the statistic, "where X is the mana value of that spell" (Ovika, Enigma Goliath),
  // "the power of target creature": the same quantity (rendered on a copy of the state, so the object is named once, as T70 does for a sacrificed object)
  // (not of what a linked ability exiled: that object is named only "the exiled card", singular, as T66 reads it)
  // std-exile-play-1-2 (CR 208.1, 208.3): the object of a power or toughness is never an instant or sorcery (RenderState.powerOf)
  const pt = q.stat === 'power' || q.stat === 'toughness';
  const savedPowerOf = st.powerOf;
  if (pt) st.powerOf = true;
  let after: string | null;
  let own: string;
  try {
    after = q.of.ref === 'linked' ? null : `the ${word} of ${K.obj(q.of, cloneState(st), 'object').text}`;
    own = `${K.obj(q.of, st, 'possessive').text} ${word}`;
  } finally {
    if (savedPowerOf === undefined) delete st.powerOf;
    else st.powerOf = savedPowerOf;
  }
  // std-rh (CR 702.167c, 202.3): what the craft cost exiled is "the exiled card used to craft it" (Jadeheart Attendant): the statistic is said before it
  if (after === null) return q.of.ref === 'linked' && q.of.link === 'exiled' ? alt(own, `the ${word} of the exiled card`) : q.of.ref === 'linked' && q.of.link === 'craft' ? alt(own, `the ${word} of the exiled card used to craft it`) : own;
  // pc-counters-3 (CR 603.10a, 700.4): in a dies trigger, Oracle also names the dying creature "the creature that died": "where X is the power of the creature that died"
  const trig = st.trigger ?? [];
  const dies = q.of.ref === 'event' && q.of.role === 'subject' && trig.length === 1 && trig[0]!.ev === 'zoneChange' && trig[0]!.from === 'battlefield' && trig[0]!.to === 'graveyard'
    && (trig[0]!.subject?.types ?? []).join() === 'Creature' ? [`the ${word} of the creature that died`] : [];
  // edh-c-71 (CR 608.2c, 608.2h; Keldon Battlewagon): the creature a tap cost tapped is also "the creature tapped this way"
  const tappedWay = q.of.ref === 'costTapped' ? [`the ${word} of the creature tapped this way`] : [];
  return alt(own, after, ...dies, ...tappedWay);
}

/** std-rx7: is `q` the counters of the kind a one-pattern trigger's moved object is described with ("with one or more counters on it dies")? */
export function countersNamedByTrigger(q: Extract<Quantity, { q: 'counters' }>, st: RenderState): boolean {
  const trig = st.trigger ?? [];
  const p = trig.length === 1 && trig[0]!.ev === 'zoneChange' && trig[0]!.from === 'battlefield' ? trig[0]! : undefined;
  // edh-next-134 (CR 603.4, 603.10a, 122.1; family that-many-counters-it-had; Oft-Nabbed Goat): or the trigger's intervening "if" named them, "When ~ dies, if it had one or more
  // -1/-1 counters on it, its owner draws that many cards": the counters the object that left had on it (its last known information)
  const ic = st.interveningIf;
  const ifNamed = p !== undefined && ic?.cond === 'matches' && ic.object.ref === 'event' && (ic.object as { role?: string }).role === 'subject' ? ic.filter.counters : undefined;
  const named = p?.ev === 'zoneChange' ? p.subject?.counters ?? ifNamed : undefined;
  const on = q.on as { ref?: string; role?: string };
  return named !== undefined && named.kind === q.kind && (named.cmp === undefined || (named.cmp.op === '>=' && named.cmp.value === 1)) && on.ref === 'event' && on.role === 'subject';
}

/** pc-tokens-1: the players of "your opponents" (every opponent of the controller, CR 102.3). */
const isYourOpponents = (on: ObjRef | PlayerRef): boolean => on.ref === 'each' && 'who' in on && on.who === 'opponent';

function onPhrase(on: ObjRef | PlayerRef, st: RenderState, kind: string): string {
  const counters = kind === 'any' ? 'counters' : `${kind} counters`;
  // edh-next-26 (CR 122.1; parser/holes/qty.ts; Vault 12: The Necropolis): the counters of one kind on every player, added up
  if (on.ref === 'each' && (on as { who?: string }).who === 'player' && !('filter' in on) && kind !== 'any') return `the total number of ${counters} among players`;
  if (isPlayerRef(on, st)) {
    if (isYourOpponents(on)) return `the number of ${counters} your opponents have`; // pc-tokens-1
    const p = K.player(on as PlayerRef, st, 'subject');
    const verb = p.person === 'sg' ? 'has' : 'have';
    // edh-d-88 (CR 107.14, 122.1; Razorfield Ripper, family energy-amount-you-have): the energy counters a player has are also "the amount of {E} you have"
    if (kind === 'energy') return alt(`the number of ${counters} ${p.text} ${verb}`, `the amount of {e} ${p.text} ${verb}`);
    return `the number of ${counters} ${p.text} ${verb}`;
  }
  // r4-fxb (family counters-on-group): the counters on a described group, "on lands you control" (no quantifier) as well as "on all lands you control"
  // edh-d-93 (CR 122.1, 115.1; Ferrafor, Young Yew): both wordings are written from the same state (the first one names a target phrase, "creatures target player controls", for the first time too)
  if (on.ref === 'each' && 'filter' in on) { const grp = alt(K.obj(on as ObjRef, cloneState(st), 'object').text, K.np(on.filter, st, { det: 'none', plural: true })); return alt(`the number of ${counters} on ${grp}`, `the number of ${counters} among ${grp}`); } // pc-counters-3: Maester Seymour's "among"
  // edh-perms-11 (CR 122.1, 603.10a; Felisa, Fang of Silverquill): of an object that is gone, "the number of counters it had on it" (its last known information)
  const o = K.obj(on as ObjRef, st, 'object').text;
  return `the number of ${alt(`${counters} on ${o}`, `${counters} ${o} had on it`)}`;
}

/** The words of a `distinct` quantity: what is counted ("card types") and among what ("cards in your graveyard"). */
export function distinctParts(q: Extract<Quantity, { q: 'distinct' }>, st: RenderState): { among: string; w: string } {
  const a = q.among;
  const moved = movedGroupNp(a, st); // Cloud r3-moved: "card types among cards discarded this way"
  if (moved !== null) return { among: moved, w: DISTINCT_WORD[q.what] ?? q.what };
  // r4-moved (CR 607.2a; FAST5 T60's words for a count, render/cond.ts): the cards the linked ability of this object exiled are "cards exiled with ~"
  if (a.ref === 'linked' && a.link === 'exiled') return { among: `cards exiled with ${K.obj({ ref: 'self' }, st, 'object').text}`, w: DISTINCT_WORD[q.what] ?? q.what };
  // edh-d-78 (CR 205.2a; Happily Ever After, parser/holes/cond.ts): the objects of two descriptions together, "permanents you control and/or cards in your graveyard"
  if (a.ref === 'union' && a.of.length === 2 && a.of.every((x) => x.ref === 'each' && 'filter' in x)) {
    const [x, y] = a.of as [Extract<ObjRef, { ref: 'each' }> & { filter: ObjectFilter }, Extract<ObjRef, { ref: 'each' }> & { filter: ObjectFilter }];
    return { among: `${K.np(x.filter, st, { det: 'none', plural: true })} and/or ${K.np(y.filter, st, { det: 'none', plural: true })}`, w: DISTINCT_WORD[q.what] ?? q.what };
  }
  // "among cards in your graveyard" (no quantifier) is how Oracle names a set here; "among all cards ..." is the other reading
  const among = a.ref === 'each' && 'filter' in a ? alt(K.obj(a, st, 'object').text, K.np(a.filter, st, { det: 'none', plural: true })) : K.obj(a, st, 'object').text;
  return { among, w: DISTINCT_WORD[q.what] ?? q.what };
}

/**
 * A nested calculation prints without brackets ("twice X plus 1"), so it is only written where the English has one reading: a sum or difference inside a
 * product or quotient, or on the right of a difference, would be read the other way and is refused.
 */
function checkGrouping(q: Extract<Quantity, { q: 'math' }>): void {
  q.args.forEach((arg, i) => {
    const child = typeof arg === 'object' && arg.q === 'live' ? arg.value : arg;
    if (typeof child !== 'object' || child.q !== 'math' || domainOf(child) !== null) return; // FAST3 T12: domain prints as one noun phrase
    const additive = child.op === '+' || child.op === '-';
    if ((q.op === '*' || q.op === 'floorDiv' || q.op === 'ceilDiv') && additive) throw new NoRenderer('a sum inside a product has no unambiguous wording');
    if (q.op === '-' && i > 0 && additive) throw new NoRenderer('a sum on the right of a difference has no unambiguous wording');
  });
}

/** FAST5 T62: is `q` exactly N minus the amount the intervening "if" being rendered says is fewer than N (parser/lower/quantities.ts#differenceOf)? */
function isDifference(q: Extract<Quantity, { q: 'math' }>, st: RenderState): boolean {
  // Cloud std-fin (CR 608.2c): also the condition of the `if` step whose branch this is ("Then if you have fewer than three cards in hand, draw cards equal to the difference")
  // pc-players-2 (CR 402.1, 608.2h): "If that player has more cards in hand than you, draw cards equal to the difference": the bigger amount minus the smaller one
  if ([st.stepIf, st.interveningIf].some((c) => c?.cond === 'compare' && c.op === '>' && typeof c.left === 'object' && typeof c.right === 'object' && q.op === '-' && q.args.length === 2
    && JSON.stringify(q.args[0]) === JSON.stringify(c.left) && JSON.stringify(q.args[1]) === JSON.stringify(c.right))) return true;
  // edh-perms-22 (CR 208.1, 608.2h; parser/lower/quantities.ts#differenceOf): the power (toughness) of the object the condition tests minus the one it must exceed, after "if that creature has greater power than ~"
  if ([st.stepIf, st.interveningIf].some((c) => c?.cond === 'matches' && q.op === '-' && q.args.length === 2 && typeof q.args[0] === 'object' && typeof q.args[1] === 'object' && q.args[0].q === 'stat' && q.args[1].q === 'stat'
    && JSON.stringify(q.args[0].of) === JSON.stringify(c.object) && JSON.stringify(c.filter) === JSON.stringify({ [q.args[0].stat]: { op: '>', value: q.args[1] } }))) return true;
  // edh-cast-9 (CR 202.3, 601.2h; parser/lower/quantities.ts#differenceOf): the mana value of a spell minus the mana spent to cast it, after "if the amount of mana spent to cast it was less than its mana value"
  if ([st.stepIf, st.interveningIf].some((c) => c?.cond === 'compare' && c.op === '<' && typeof c.left === 'object' && typeof c.right === 'object' && c.left.q === 'spellManaSpent' && c.right.q === 'stat' && q.op === '-' && q.args.length === 2
    && JSON.stringify(q.args[0]) === JSON.stringify(c.right) && JSON.stringify(q.args[1]) === JSON.stringify(c.left))) return true;
  return [st.stepIf, st.interveningIf].some((c) => c?.cond === 'compare' && c.op === '<' && typeof c.right === 'number' && q.op === '-' && q.args.length === 2 && q.args[0] === c.right
    && JSON.stringify(q.args[1]) === JSON.stringify(c.left));
}

/** std-rx16: the two statistics of `max(a, b) - min(a, b)` (parser/holes/qty.ts#differenceBetweenQty), or null for any other calculation. */
function differenceBetweenOf(q: Extract<Quantity, { q: 'math' }>): [Extract<Quantity, { q: 'stat' }>, Extract<Quantity, { q: 'stat' }>] | null {
  if (q.op !== '-' || q.args.length !== 2) return null;
  const [hi, lo] = q.args;
  if (typeof hi !== 'object' || typeof lo !== 'object' || hi.q !== 'math' || lo.q !== 'math' || hi.op !== 'max' || lo.op !== 'min' || hi.args.length !== 2) return null;
  if (JSON.stringify(hi.args) !== JSON.stringify(lo.args)) return null;
  const [a, b] = hi.args;
  if (typeof a !== 'object' || typeof b !== 'object' || a.q !== 'stat' || b.q !== 'stat') return null;
  return [a, b];
}

/**
 * std-rx16 (CR 208.1, 202.3; family difference-between): "the difference between its power and toughness" (two statistics of the one object), "the difference
 * between that creature's power and its toughness", "the difference between that spell's mana value and that card's mana value".
 */
function differenceBetweenPhrase(a: Extract<Quantity, { q: 'stat' }>, b: Extract<Quantity, { q: 'stat' }>, st: RenderState): string {
  if (JSON.stringify(a.of) !== JSON.stringify(b.of) || a.stat === b.stat) return `the difference between ${qty(a, st)} and ${qty(b, st)}`;
  const full = `the difference between ${qty(a, cloneState(st))} and ${qty(b, cloneState(st))}`;
  // the one object's possessive, then both statistics ("its power and toughness")
  return alt(`the difference between ${K.obj(a.of, st, 'possessive').text} ${STAT_WORD[a.stat]!} and ${STAT_WORD[b.stat]!}`, full);
}

function mathPhrase(q: Extract<Quantity, { q: 'math' }>, st: RenderState): string {
  checkGrouping(q);
  const a = q.args.map((x) => qty(x, st));
  const lit = (i: number): number | null => (typeof q.args[i] === 'number' ? (q.args[i] as number) : null);
  switch (q.op) {
    case '+': return a.join(' plus ');
    case '-': return a.join(' minus ');
    case '*': {
      if (q.args.length === 2 && lit(0) !== null) {
        const n = lit(0)!;
        return n === 2 ? `twice ${a[1]}` : `${numWord(n)} times ${a[1]}`;
      }
      return a.join(' times ');
    }
    case 'floorDiv':
    case 'ceilDiv': {
      const dir = q.op === 'floorDiv' ? 'down' : 'up';
      if (q.args.length === 2 && lit(1) === 2) return `half ${a[0]}, rounded ${dir}`;
      return `${a[0]} divided by ${a[1]}, rounded ${dir}`;
    }
    // FAST5X E15 (CR 107.3): "2 or the greatest power among Dinosaurs you control, whichever is greater" is the greater of the two
    case 'min': return q.args.length === 2 ? alt(`the lesser of ${joinList(a)}`, `${a[0]} or ${a[1]}, whichever is less`) : `the lesser of ${joinList(a)}`;
    case 'max': return q.args.length === 2 ? alt(`the greater of ${joinList(a)}`, `${a[0]} or ${a[1]}, whichever is greater`) : `the greater of ${joinList(a)}`;
  }
}

export function qty(q: Quantity, st: RenderState, _o: QtyOpts = {}): string {
  if (typeof q === 'number') return String(q);
  switch (q.q) {
    // std-rx5 (family any-number-that-many): in an ability whose cost removes "any number of" counters, X is that number, "that many" / "that much"
    // p2-counters-move-2 (CR 107.3a, 118.3): the X of "Remove all <kind> counters from ~" is printed nowhere: "the number of <kind> counters removed this way"
    case 'X': return st.anyNumberX === true ? alt('that many', 'that much') : st.costAllCountersX !== undefined ? alt(`the number of ${st.costAllCountersX} counters removed this way`, 'the number of counters removed this way') : 'X';
    case 'var': {
      const v = st.vars.get(q.name);
      if (v && !v.used) {
        v.used = true;
        return v.phrase;
      }
      return alt('that much', 'that many');
    }
    case 'count': {
      // FAST4 T29: every card in every hand (CR 402.1), "the total number of cards in all players' hands"
      if (q.of.ref === 'each' && Object.keys(q.of.filter).length === 1 && q.of.filter.zone === 'hand') return alt("the total number of cards in all players' hands", "the number of cards in all players' hands");
      // edh-perms-11 (CR 607.2a; Unlicensed Hearse): the cards a linked ability of this object exiled, "the number of cards exiled with it" (also with the name, "with ~")
      if (q.of.ref === 'linked' && q.of.link === 'exiled') return `the number of ${alt(`cards exiled with ${K.obj({ ref: 'self' }, st, 'object').text}`, 'cards exiled with it')}`;
      const parts = countParts(q, st);
      // r3-choose (CR 115.1): the permanents several players control are also counted as "the total number of creatures those players control" (only a group of players)
      const ctl = q.of.ref === 'each' && 'filter' in q.of ? q.of.filter.controller : undefined;
      // r5-mech (CR 404.1, 406.1): the cards of several zones are also counted as "the total number of instant and sorcery cards you own in exile and in your graveyard"
      const zones = q.of.ref === 'each' && 'filter' in q.of ? q.of.filter.zone : undefined;
      const group = (typeof ctl === 'object' && ((ctl.ref === 'target' && st.specs.get(ctl.id)?.max !== 1) || ctl.ref === 'each')) || (Array.isArray(zones) && zones.length > 1);
      if (parts) return group ? alt(`the number of ${parts.plural}`, `the total number of ${parts.plural}`) : `the number of ${parts.plural}`;
      return `the number of ${K.obj(q.of, st, 'object').text}`;
    }
    case 'countPlayers': {
      const n = `the number of ${countParts(q, st)!.plural}`;
      // FAST3 T17: "the number of opponents you have" (CR 102.3: the opponents of the ability's controller)
      return q.of.ref === 'each' && q.of.who === 'opponent' && q.sizeVs === undefined && q.controlsVs === undefined && q.controlsIs === undefined && q.lostLifeThisTurn === undefined ? alt(n, 'the number of opponents you have') : n;
    }
    case 'stat': return statPhrase(q, st);
    case 'life': {
      // p2-group-actions-1 (CR 119.1): "the highest life total among all players", "the lowest life total among your opponents"
      if (q.agg !== undefined) {
        const among = q.of.ref === 'each' && 'who' in q.of && q.of.who === 'player' ? alt('all players', 'players') : q.of.ref === 'each' && 'who' in q.of && q.of.who === 'opponent' ? 'your opponents' : null;
        if (among === null) throw new NoRenderer('a highest or lowest life total among players other than all players or your opponents');
        return `the ${q.agg === 'max' ? alt('highest', 'greatest') : 'lowest'} life total among ${among}`;
      }
      return `${K.player(q.of, st, 'possessive').text} life total${q.atTurnStart === true ? ' as the turn began' : ''}`; // edh-next-19 (CR 119.1, 500.1)
    }
    case 'zoneSize': {
      // edh-c-59 (CR 402.1; Adamaro): the largest hand among the opponents
      if (q.agg === 'max') {
        if (q.zone !== 'hand' || q.of.ref !== 'each' || q.of.who !== 'opponent') throw new NoRenderer('the largest zone of players other than the opponents\' hands');
        return 'the number of cards in the hand of the opponent with the most cards in hand';
      }
      const who = K.player(q.of, st, 'possessive').text;
      if (q.zone === 'battlefield') return `the number of permanents ${K.player(q.of, st, 'subject').text} control${q.of.ref === 'you' ? '' : 's'}`;
      // FAST5 T68 (CR 406.1, 108.3): exile is one shared zone, so a player's cards there are the cards that player owns in exile ("the number of cards you own
      // in exile"; the evaluator, statics/match.ts, counts the exile zone's cards by owner)
      if (q.zone === 'exile') {
        const owns = q.of.ref === 'you' ? 'you own' : `${K.player(q.of, st, 'subject').text} owns`;
        return `the number of cards ${owns} in exile`;
      }
      return `the number of cards in ${who} ${PLAYER_ZONE[q.zone] ?? q.zone}`;
    }
    // std-rx7 (CR 603.10a, 608.2h; parser/lower/scope.ts): the counters on the object a one-pattern leaves-the-battlefield trigger names by them ("Whenever a
    // creature you control with one or more counters on it dies, exile that many cards ..."): "that many" there; elsewhere the count said in full
    case 'counters': return countersNamedByTrigger(q, st) ? alt('that many', onPhrase(q.on, st, q.kind) /* edh-d-59 (Puca's Covenant): also said in full */) : onPhrase(q.on, st, q.kind);
    case 'timesMutated': return 'the number of times ~ has mutated'; // edh-next-33 (CR 702.140d)
    case 'partySize': return `the number of creatures in ${K.player(q.of, st, 'possessive').text} party`; // T38: CR 700.8
    // r5-cost (CR 205.3m): "the greatest number of creatures you control that have a creature type in common"
    case 'mostSharingCreatureType': {
      if (q.among.ref !== 'each' || !('filter' in q.among)) throw new NoRenderer('the most objects sharing a creature type of something other than a described set');
      return `the greatest number of ${K.np(q.among.filter, st, { det: 'none', plural: true })} that have a creature type in common`;
    }
    // edh-cast-3 (CR 109.4; parser/holes/qty.ts): "the greatest number of artifacts an opponent controls" (the most one opponent controls)
    case 'mostByController': {
      if (q.of.ref !== 'each' || !('filter' in q.of) || (q.of.filter.controller !== 'opponent' && q.of.filter.controller !== undefined)) throw new NoRenderer('the most one player controls of something other than a described set of an opponent\'s permanents');
      // edh-next-21 (Investigator's Journal): a description with no controller is the permanents of every player, "a player controls"
      return `the greatest number of ${K.np({ ...q.of.filter, controller: undefined }, st, { det: 'none', plural: true })} ${q.of.filter.controller === undefined ? 'a player' : 'an opponent'} controls`;
    }
    // edh-cast-3 (CR 119.3, 120.3a; parser/holes/qty.ts): the life all the opponents lost this turn, added up
    case 'lifeLostTotal': {
      if (q.of.ref === 'each' && q.of.who === 'player') return alt('the total life lost by all players this turn', 'the total amount of life lost by all players this turn'); // edh-b-5 (Tainted Sigil)
      if (q.of.ref !== 'each' || q.of.who !== 'opponent') throw new NoRenderer('the life lost by a group of players other than the opponents');
      return alt('the amount of life your opponents have lost this turn', 'the amount of life your opponents lost this turn', 'the total amount of life your opponents lost this turn' /* edh-zones-11 (Florian) */, 'the total life lost by your opponents this turn' /* edh-c-12 (Cryptborn Horror) */, 'the total amount of life your opponents have lost this turn' /* edh-next-141 (Abaddon the Despoiler) */);
    }
    case 'devotion': return `${K.player(q.of, st, 'possessive').text} devotion to ${joinList(q.to.map((c) => COLOR_WORD[c] ?? c))}`;
    case 'distinct': {
      // r4-mech (CR 105.2a): "the number of different color pairs among permanents you control that are exactly two colors"
      if (q.what === 'colorPairs') {
        if (q.among.ref !== 'each' || !('filter' in q.among)) throw new NoRenderer('color pairs among something other than a description');
        return `the number of different color pairs among ${K.np(q.among.filter, st, { det: 'none', plural: true })} that are exactly two colors`;
      }
      const { among, w } = distinctParts(q, st);
      // FAST4 T26: "the number of differently named lands you control" (CR 201.2: objects with different names); the set as its noun phrase
      if (q.what === 'names' && q.among.ref === 'each' && 'filter' in q.among) {
        return alt(`the number of ${w} among ${among}`, `the number of different ${w} among ${among}`, `the number of differently named ${K.np(q.among.filter, st, { det: 'none', plural: true })}`);
      }
      // edh-next-24 (CR 105.1; family colors-object-is): the colors of ONE object, "the number of colors that spell is", "the number of colors it is"
      if (q.what === 'colors' && q.among.ref !== 'each' && q.among.ref !== 'union') {
        return alt(`the number of ${w} among ${among}`, `the number of different ${w} among ${among}`, `the number of colors ${K.obj(q.among, st, 'object').text} is`);
      }
      return alt(`the number of ${w} among ${among}`, `the number of different ${w} among ${among}`);
    }
    case 'happenedCount': {
      // edh-d-92 (CR 208.1, 700.4, 608.2h; Genesis of the Daleks, parser/holes/qty.ts): "the total power of Daleks that died this turn", the powers of the creatures of that description
      // that died this turn added up (a creature type alone may stand for its creatures: "Daleks" for "Dalek creatures")
      if (q.sum === 'power') {
        const e = q.event;
        if (e.ev !== 'zoneChange' || q.scope !== 'turn' || q.by !== undefined || q.per !== undefined || q.beforeEvent !== undefined || e.subject === undefined || e.from !== 'battlefield' || e.to !== 'graveyard' || Object.keys(e).length !== 4) throw new NoRenderer('a total power of a zone-change history other than the creatures that died this turn');
        const subj = e.subject as ObjectFilter;
        const plain = K.np(subj, st, { det: 'none', plural: true });
        const noun = subj.subtypes !== undefined && subj.subtypes.length > 0 && JSON.stringify(subj.types) === JSON.stringify(['Creature']) ? K.np({ ...subj, types: undefined }, st, { det: 'none', plural: true }) : plain;
        return alt(`the total power of ${plain} that died this turn`, `the total power of ${noun} that died this turn`);
      }
      // std-rx29 (CR 120.3, 603.10a; parser/holes/qty.ts): "the amount of damage dealt to it this turn", the damage one object was dealt this turn added up
      // edh-cast-12 (CR 202.3, 601.2i; Call Forth the Tempest): "the total mana value of other spells you've cast this turn" (parser/holes/qty.ts), nothing narrower
      if (q.sum === 'manaValue') {
        const e = q.event;
        // edh-next-96 (CR 202.3, 601.2i; Rootha, Mastering the Moment, parser/holes/qty.ts): "the greatest mana value among instant and sorcery spells you've cast this turn"
        if (q.per === 'source' && e.ev === 'cast' && q.scope === 'turn' && q.by === 'you' && q.beforeEvent === undefined && e.player === 'you' && e.spell !== undefined && Object.keys(e).length === 3
          && Object.keys(e.spell).every((k) => k === 'types' || k === 'notTypes')) return `the greatest mana value among ${K.np({ ...e.spell, stackKind: 'spell' }, st, { det: 'none', plural: true })} you've cast this turn`;
        if (e.ev !== 'cast' || q.scope !== 'turn' || q.by !== 'you' || q.per !== undefined || q.beforeEvent !== undefined || e.player !== 'you' || JSON.stringify(e.spell) !== JSON.stringify({ not: { self: true } }) || Object.keys(e).length !== 3) throw new NoRenderer('a total of mana values of anything but the other spells you cast this turn');
        return "the total mana value of other spells you've cast this turn";
      }
      // edh-c-46 (CR 121.1, 608.2h; Thought Sponge, parser/holes/qty.ts): the most draws any one opponent made this turn
      if (q.per === 'player' && q.by === 'opponent' && q.scope === 'turn' && q.sum === undefined && q.beforeEvent === undefined && q.event.ev === 'draw' && Object.keys(q.event).length === 1) return 'the greatest number of cards an opponent has drawn this turn';
      // edh-d-70 (CR 107.14; Blaster Hulk, parser/holes/edhd70.ts): "for each {E} you've paid or lost this turn" (the same sum as the condition of edh-replace-5)
      if (isTurnEnergySpent(q)) return "{e} you've paid or lost this turn";
      // edh-d-85 (CR 120.1, 120.3, 603.10a; Grothama, All-Devouring): "the amount of damage dealt to ~ this turn by sources they controlled": the damage one object was dealt this turn by sources
      // the player of a group (`iterating`, "each player draws ...") controlled as they dealt it (the entry's source facts)
      if (q.sum === 'amount' && q.scope === 'turn' && q.per === undefined && q.by === undefined && q.beforeEvent === undefined && q.event.ev === 'damage' && Object.keys(q.event).length === 3
        && JSON.stringify(q.event.source) === '{"controller":{"ref":"iterating"}}' && q.event.recipient?.player === undefined && q.event.recipient?.object?.is !== undefined && Object.keys(q.event.recipient.object).length === 1 && Object.keys(q.event.recipient).length === 1) {
        return `the amount of damage dealt to ${K.obj(q.event.recipient.object.is, st, 'object').text} this turn by sources they controlled`;
      }
      const to = damageTotalTo(q);
      // edh-c-87 (CR 120.3, 608.2c; family damage-already-dealt; Whipkeeper): "the damage already dealt to it this turn" is the damage dealt to the object so far this turn, the same sum
      if (to !== null) { const who = K.obj(to, st, 'object').text; return alt(`the amount of damage dealt to ${who} this turn`, `the damage already dealt to ${who} this turn`, ...(to.ref === 'target' ? ['the damage already dealt to it this turn'] : [])); }
      const opp = damageTotalToOpponents(q);
      if (opp !== null) return opp === '' ? alt('the total amount of damage dealt to your opponents this turn', 'the damage dealt to your opponents this turn') : `the total amount of ${opp}damage dealt to your opponents this turn`; // edh-players-16: the plain words
      // edh-players-16 (CR 120.1; Knollspine Dragon): "the damage dealt to target opponent this turn": the damage entries of the turn to one player (a reference), added up
      const toPlayer = damageTotalToPlayer(q);
      if (toPlayer !== null) {
        const pt = K.player(toPlayer, st, 'object').text;
        // edh-c-51 (CR 120.1; Final Punishment): "the damage already dealt to that player this turn" says the same sum as "the damage dealt to them this turn"
        return alt(`the damage dealt to ${pt} this turn`, `the damage already dealt to ${pt} this turn`);
      }
      // FAST5X E22 (parser/lower/quantities.ts#sacrificedCount): "that much" after the condition "you sacrificed one or more permanents this turn" is its count
      const ev = q.event;
      if (ev.ev === 'action' && ev.verb === 'sacrifice' && ev.actor === 'you' && Object.keys(ev).length === 3 && q.scope === 'turn' && q.by === undefined && q.per === undefined
        // (std-ra, CR 107.3, 608.2h: not a condition that compares this very count, "If X is three or more" after "where X is the number of permanents you've sacrificed
        // this turn", whose X is the count said in full; render/fold.ts#whereXThenIfX)
        && [...st.conds].some((c) => c.includes(JSON.stringify(ev)) && !c.includes('"q":"happenedCount"'))) return 'that much';
      // edh-d-93 (parser/lower/quantities.ts#sacrificedCount; Feast of the Victorious Dead): "that much" / "that many" after the condition "one or more creatures died this turn" is its count
      if (ev.ev === 'zoneChange' && ev.from === 'battlefield' && ev.to === 'graveyard' && Object.keys(ev).length === 4 && ev.subject !== undefined && Object.keys(ev.subject).length === 1 && ev.subject.types !== undefined
        && q.scope === 'turn' && q.by === undefined && q.per === undefined && q.sum === undefined && q.beforeEvent === undefined
        && [...st.conds].some((c) => c.includes(JSON.stringify(ev)) && !c.includes('"q":"happenedCount"'))) return 'that much';
      return `the number of ${happened(q, st).plural}`;
    }
    // Standard round 5, r5-trig (CR 107.4, 202.1): the mana symbols of a color in the mana cost of the spell a cast trigger names by them ("a noncreature spell with one or
    // more blue mana symbols in its mana cost, create that many"): "that many" there; elsewhere the count said in full
    // edh-next-143 (CR 115.9a; Voracious Bibliophile): the targets of the spell a cast trigger names by them ("a spell with one or more targets, draw that many cards"): "that many" there
    case 'targetsOf': {
      const trig = st.trigger ?? [];
      const named = trig.length === 1 && trig[0]!.ev === 'cast' && JSON.stringify(trig[0]!.spell?.targetCount) === '{"op":">=","value":1}' && q.of.ref === 'event' && q.of.role === 'spell';
      if (named) return 'that many';
      throw new NoRenderer('the number of targets of an object outside "a spell with one or more targets, ... that many"');
    }
    case 'manaSymbols': {
      const trig = st.trigger ?? [];
      const named = trig.length === 1 && trig[0]!.ev === 'cast' && trig[0]!.spell?.manaSymbols?.color === q.color && q.of.ref === 'event' && q.of.role === 'spell';
      return named ? 'that many' : `the number of ${COLOR_WORD[q.color]} mana symbols in the mana cost of ${K.obj(q.of, st, 'object').text}`;
    }
    // edh-c-37 (CR 107.4, 202.1; Umbra Stalker): the mana symbols of one color in the mana costs of a group
    case 'symbolsAmong': return `the number of ${COLOR_WORD[q.color]} mana symbols in the mana costs of ${K.np(q.of.ref === 'each' ? q.of.filter : {}, st, { det: 'none', plural: true })}`;
    // CLOUD std-tmt (CR 205.2a): "the number of card types among spells you've cast this turn"
    case 'happenedDistinct': return `the number of ${countParts(q, st)!.plural}`;
    case 'happenedPlayers': return `the number of ${countParts(q, st)!.plural}`; // edh-players-9
    // r3-cost (CR 603.2, 120.3; family damage-dealt-amount): the amount of a damage trigger's event is also "the amount of damage dealt" (Kotis, the Fangkeeper)
    // r5-fxb (family that-amount-of-damage): before "damage", also "that amount of" ("~ deals that amount of damage to target creature that player controls")
    // edh-replace-2 (same family): and, when the damage is dealt to a player by a group of creatures ("one or more creatures you control with trample deal combat damage to a player"),
    // "the amount of damage those creatures dealt to that player" (Quartzwood Crasher; the batch's total, triggers/context.ts)
    case 'eventAmount': return alt('that much', 'that many', 'the amount', ...((st.trigger ?? []).length === 1 && st.trigger![0]!.ev === 'life' && st.trigger![0]!.change === 'gain' && st.trigger![0]!.player === 'you' ? ['the amount of life you gained'] : []) /* edh-c-1: Hurska Sweet-Tooth */, ...milledBatchPhrase(st), ...((st.trigger ?? []).length === 1 && st.trigger![0]!.ev === 'action' && st.trigger![0]!.verb === 'scry' ? ['the number of cards looked at while scrying this way'] : []) /* edh-next-38 (CR 701.22a): family that-many-event */, ...((st.trigger ?? []).length === 1 && st.trigger![0]!.ev === 'damage' ? ['the amount of damage dealt', 'that amount of', 'that damage', 'the damage dealt' /* edh-next-55 (Sword of Hours) */, ...(st.trigger![0]!.recipient?.player !== undefined ? ['the amount of damage those creatures dealt to that player', 'the damage those creatures dealt to that player', 'the amount of damage it dealt to that player' /* edh-d-11: Mask of the Schemer */, ...(JSON.stringify(st.trigger![0]!.source) === '{"self":true}' ? ['the amount of damage ~ dealt to that player' /* edhn115: Venerable Warsinger; only the source's own damage (review) */] : [])] : [])] : []));
    case 'resultCount': {
      if (q.to !== undefined) return diedCountPhrase(q, st); // edh-c-61: "the number of creatures that died this way"
      if (q.which !== undefined) return movedCountPhrase(q, st); // Cloud C7: "the number of cards exiled this way" (CR 608.2c, 608.2h)
      if (st.info.get(`b:${q.step}`)?.paidTotalMana === true) return 'the total amount of mana paid this way'; // edh-top-6 (join forces)
      if (st.info.get(`b:${q.step}`)?.paidEnergy === true) return 'the amount of {E} paid this way'; // edh-next-32 (CR 107.14)
      if (st.info.get(`b:${q.step}`)?.paidTimes === true) return 'that many';
      if (st.info.get(`r:${q.step}`)?.xWord === true) return 'x'; // edh-d-90 (CR 107.3, 608.2h; Campsite Cuisine): the X that "you may sacrifice X Foods" defined // edhn81 (CR 118.12, 603.12; the Adversary cycle): "you may pay {M} any number of times. When you pay this cost one or more times, ... that many"
      const base = `the number of ${K.obj({ ref: 'bound', name: q.step }, st, 'object').text}`;
      // FAST4 T26: "the number of cards discarded this way" (CR 608.2c): what the step did, said by its participle (render/steps-cards.ts#discard)
      const r = st.info.get(`r:${q.step}`);
      const said = r?.thisWay !== undefined && r.nouns[0] !== undefined ? alt(base, `the number of ${pluralize(r.nouns[0])} ${r.thisWay}`) : base;
      // edh-d-98 (CR 608.2c, 608.2h, 119.3; Asmodeus the Archfiend; family result-count-that-much): "return all cards exiled with ~ to their owner's hand and you lose that much life":
      // the number of objects the instruction just named moved is "that much" in the same sentence
      return st.mentioned.has(`movedAs:${q.step}`) ? alt(said, 'that much') : said; // only the count of a move named in this text (not of counters put, Ashling the Pilgrim)
    }
    case 'targetCount':
      st.used.add(q.id);
      return 'the number of targets';
    case 'spellTargetCount': return alt('the number of targets', 'the number of targets it has');
    case 'spellTargetTotal': return 'the total mana value of the permanents ~ targets'; // std-costs-1 (CR 601.2c, 601.2f, 202.3)
    case 'costCount': return `the number of ${(st.costCountNouns?.[q.name] ?? { plural: 'permanents sacrificed this way' }).plural}`; // std-costs-1 (CR 601.2b); edhc5: or cards exiled / discarded this way
    // p2-c-dieroll-2 (family die-result-that-much): "that much" / "that many" after the roll (parser/lower/quantities.ts offers the one roll's result)
    case 'dieResult': return alt('the result', 'that result', 'the number rolled', 'that much', 'that many', 'the total of those results' /* edh-next-55 (Pair o' Dice Lost): several dice rolled by one instruction have their total as the result */);
    case 'dieResultHighest': return 'the highest result'; // edh-d-49 (CR 706.2): only said through the condition "any of those results was N or higher" (render/cond.ts)
    case 'stickerVowels': return 'the number of unique vowels on that sticker'; // edh-next-147 (CR 123.6e)
    case 'dieResultOther': return 'the other result'; // edh-mana-keywords-10 (CR 706.2): "Roll two d12 and choose one result. ... equal to the other result"
    case 'diceResults': { // edh-mana-keywords-10 (CR 706.2): the dice of the last roll with an even or odd result, or exactly that number ("for each even result")
      const per = countParts(q, st);
      if (per === null) throw new NoRenderer('a number of dice results other than even or odd ones');
      return `the number of ${per.plural}`;
    }
    // edh-next-138 (CR 614.12a, 119.4; Phyrexian Processor): the amount "As ~ enters, pay any amount of life." paid, "the life paid as ~ entered"
    // edh-next-144 (CR 119.1, 607.2d; Sigarda's Splendor): the life total "note your life total" kept under the link notedLife
    case 'chosenNumber': if (q.link === 'notedLife' && q.extreme === undefined) return 'the last noted life total for ~'; return q.link === 'lifePaid' ? 'the life paid as ~ entered' : alt('the chosen number', 'that many'); // CLOUD std-misc (CR 608.2d, 607.2d); edh-zones-26: "Choose 1, 2, or 3 at random. Its controller mills that many cards" (Tibalt's Trickery)
    case 'speed': return 'your speed';
    // FAST5X E19 (CR 106.4): "the amount of unspent mana you have"
    case 'unspentMana': return `the amount of unspent ${q.type === undefined ? '' : `${q.type === 'C' ? 'colorless' : COLOR_WORD[q.type]} `}mana you have`;
    case 'spellManaSpent': // FAST5X E9 (CR 601.2h, 702.191a); E19: `of`, the spell named (that spell, it, ~)
      if (q.from !== undefined) return `the amount of mana from ${K.np(q.from, st, { det: 'a' })} spent to cast ${q.of === undefined ? 'that spell' : spentObjectText(q.of, st)}`;
      return q.of === undefined ? 'the amount of mana spent to cast that spell' : `the amount of mana spent to cast ${spentObjectText(q.of, st)}`;
    case 'activatedThisTurn': return 'the number of times this ability has been activated this turn'; // edh-c-89 (CR 602.5b)
    case 'resolvedThisTurn': return 'the number of times this ability has resolved this turn'; // FAST5X E17 (CR 608.2)
    case 'age': return alt("its age", 'the number of age counters on it');
    case 'level': return alt('its level', 'the number of level counters on it');
    case 'turnNumber': return 'the turn number';
    case 'startingLife': return 'your starting life total'; // FAST5 T60, CR 103.4
    case 'playersLost': return 'the number of players who have lost the game'; // edhn95, CR 104.3
    case 'chosenColorsOf': if (q.of === undefined || q.link !== 'color') throw new NoRenderer('a count of the chosen colors with no object'); return `the number of the chosen colors ${K.obj(q.of, st, 'subject').text} is`; // edh-d-72 (CR 105.1, 607.2d; Tablet of the Guilds)
    case 'cardsDrawnThisTurn': return "the number of cards you've drawn this turn";
    case 'spellsCastThisTurn': return "the number of spells you've cast this turn";
    // FAST4 T26: "the amount of life you gained this turn" is the same amount (CR 119.3; the controller's life gained this turn)
    case 'eventExcess': return alt('the excess', 'the excess damage', 'that excess damage'); // edh-top-15 (CR 120.10; Toralf: "damage equal to the excess")
    case 'lifeGainedThisTurn': return alt("the amount of life you've gained this turn", 'the amount of life you gained this turn');
    case 'permanentsToGraveyardThisTurn': return 'the number of permanents put into a graveyard from the battlefield this turn'; // edh-d-3 (CR 702.69a)
    case 'descendedThisTurn': return 'the number of times you descended this turn'; // FAST5X E22 (CR 700.11)
    case 'attacksThisTurn': return `the number of times ${K.obj(q.of, st, 'subject').text} has attacked this turn`; // edh-combat-5 (CR 508.1)
    case 'extraTurnsBegun': return 'the number of extra turns you have begun this game'; // trek-18 (CR 500.7); no Oracle wording names it, only render/cond.ts says the comparison with 0
    case 'turnsBegun': return 'the number of turns you have begun this game'; // std-r9 (CR 500.7); no Oracle wording names it, only render/stat.ts#castSelfFirstTurns
    // cloud std-dsk (CR 709.5c, 709.5j): "the number of unlocked doors among Rooms you control" (parser/holes/qty.ts)
    case 'unlockedDoors': {
      if (q.among.ref !== 'each' || !('filter' in q.among)) throw new NoRenderer('unlocked doors among a set that is not a description');
      return `the number of unlocked doors among ${K.np(q.among.filter, st, { det: 'none', plural: true })}`;
    }
    // FAST4 T34 (CR 119.3): "the life that player lost this turn" (a player named before may be "they": "the life they lost this turn")
    case 'lifeLostThisTurn': {
      const p = K.player(q.of, st, 'subject');
      // Cloud std-woe: also "the amount of life you lost this turn" (as "the amount of life you gained this turn" above, family life-lost-amount)
      if (p.text === 'you') return alt("the life you've lost this turn", 'the life you lost this turn', 'the amount of life you lost this turn', "the amount of life you've lost this turn");
      // edh-players-10 (CR 119.3; Astarion, the Decadent): also "the amount of life they lost this turn" (Oracle's singular "they" for the player named before)
      const who = p.person === 'sg' || p.they === true ? [p.text, 'they'] : [p.text];
      return alt(...who.flatMap((w) => [`the life ${w} lost this turn`, `the amount of life ${w} lost this turn`]));
    }
    // FAST4 T34 (CR 601.2h; converge): "the number of colors of mana spent to cast ~"
    case 'colorsSpent': return alt(`the number of colors of mana spent to cast ${K.obj({ ref: 'self' }, st, 'object').text}`, 'the number of colors of mana spent to cast this spell');
    // FAST5 T42 (CR 601.2h): "the amount of mana spent to cast ~"
    // FAST5 T64: the permanent that entered as a copy is named again as "~" ("... mana value less than or equal to the amount of mana spent to cast ~", Mockingbird)
    // FAST5 T51 (CR 601.2h): "the number of colors of mana spent to cast that spell" (the spell of a cast trigger)
    case 'spellX': return 'X'; // edh-d-31 (CR 107.3e; Brass Infiniscope): the X of the spell a cast trigger names, said as X
    case 'spellColorsSpent': return `the number of colors of mana spent to cast ${alt('that spell', 'it')}`; // r4-repl: "... to cast it" (family spell-colors-it)
    case 'modesChosen': return 'the number of times you chose a mode for that spell'; // Standard round 3, r3-trig (CR 700.2, 601.2b): the spell of the cast trigger
    // edh-zones-26 (CR 107.4h, 601.2h): "the amount of {S} spent to cast this spell"
    case 'activationManaFrom': return `the amount of mana from ${pluralize(q.subtype)} spent to activate this ability`; // edh-next-129 (CR 602.2b; Mr. House)
    case 'manaProduced': return alt(`the amount of mana ${K.obj({ ref: 'self' }, st, 'object').text} produced`, 'the amount of mana ~ produced', 'the amount of mana it produced'); // edh-d-90 (CR 106.3, 605.3b; Tyvar the Bellicose)
    case 'snowSpent': return alt(`the amount of {s} spent to cast ${K.obj({ ref: 'self' }, st, 'object').text}`, 'the amount of {s} spent to cast ~', 'the amount of {s} spent to cast this spell', 'the amount of {s} spent to cast it');
    case 'manaSpent': return alt(`the amount of mana spent to cast ${K.obj({ ref: 'self' }, st, 'object').text}`, 'the amount of mana spent to cast ~', 'the amount of mana spent to cast this spell', 'the amount of mana spent to cast it');
    case 'math': {
      // FAST5 T62 (CR 603.4): "draw cards equal to the difference": the number the ability's intervening "if" compares your cards in hand with, minus that count
      if (isDifference(q, st)) return 'the difference';
      // edh-b-9 (CR 119.1; Profane Transfusion): the greatest life total of a group of players less its least
      if (q.op === '-' && q.args.length === 2) {
        const [hi, lo] = q.args;
        if (typeof hi === 'object' && typeof lo === 'object' && hi.q === 'life' && lo.q === 'life' && hi.agg === 'max' && lo.agg === 'min' && JSON.stringify(hi.of) === JSON.stringify(lo.of)) {
          return `the difference between ${K.player(hi.of, st, 'possessive').text} life totals`;
        }
      }
      const between = differenceBetweenOf(q);
      if (between !== null) return differenceBetweenPhrase(between[0], between[1], st);
      // edh-c-5 (CR 208.1, 107.3; parser/holes/qty.ts, Freelance Muscle): the greater of the greatest power and the greatest toughness of one set is "the greatest power and/or toughness among <set>"
      if (q.op === 'max' && q.args.length === 2) {
        const [pw, tg] = q.args;
        if (typeof pw === 'object' && typeof tg === 'object' && pw.q === 'stat' && tg.q === 'stat' && pw.stat === 'power' && tg.stat === 'toughness' && pw.agg === 'max' && tg.agg === 'max' && !pw.sum && !tg.sum
          && pw.by === undefined && tg.by === undefined && pw.station === undefined && tg.station === undefined && JSON.stringify(pw.of) === JSON.stringify(tg.of) && pw.of.ref === 'each' && 'filter' in pw.of) {
          return `the greatest power and/or toughness among ${K.np(pw.of.filter, st, { det: 'none', plural: true })}`;
        }
      }
      // std-rx29 (CR 208.1, 107.1b; parser/holes/qty.ts, Spry and Mighty): the greatest power of a group named before less its least is "the difference between the
      // chosen creatures' powers"
      const spread = spreadOf(q);
      if (spread !== null) return `the difference between ${K.obj(spread.of, st, 'possessive').text} ${SPREAD_WORD[spread.stat]}`;
      // FAST3 T12: domain (CR 305.6)
      const d = domainOf(q);
      return d !== null ? `the number of basic land types among ${K.np(d, st, { det: 'none', plural: true })}` : mathPhrase(q, st);
    }
    case 'basePower': return `${K.obj(q.of, st, 'possessive').text} base power`; // std-rx29 (CR 208.1, 613.4)
    case 'live': return qty(q.value, st);
    // edh-next-126 (CR 601.2i, 608.2h; Lifestream's Blessing): "the greatest power among creatures you controlled as you cast ~": the greatest or least statistic of the permanents of a
    // set you controlled, read when the spell became cast; only that shape (parser/holes/qty.ts)
    case 'asCast': {
      const v = q.value;
      if (typeof v !== 'object' || v.q !== 'stat' || v.agg === undefined || v.sum === true || v.station === true || v.by !== undefined || v.of.ref !== 'each' || v.of.filter.controller !== 'you') {
        throw new NoRenderer('an "as you cast" number other than "the greatest <stat> among <permanents> you controlled as you cast ~"');
      }
      const { controller: _you, ...rest } = v.of.filter;
      const word = v.stat === 'manaValue' ? 'mana value' : v.stat;
      return `the ${v.agg === 'max' ? 'greatest' : 'least'} ${word} among ${K.np(rest, st, { det: 'none', plural: true })} you controlled as you cast ${K.obj({ ref: 'self' }, st, 'object').text}`;
    }
    case 'ask': return q.text;
    // M6-0 (m6 design 2.1)
    case 'kickCount': return q.name !== undefined ? `the number of ${namedCostParts(q.name).plural}` : `the number of times ${K.obj({ ref: 'self' }, st, 'subject').text} was kicked`; // CR 702.33d
    // cloud std-spm: "that many" / "that much" in the prevention's own additional instruction ("prevent that damage and put that many +1/+1 counters on ~")
    case 'preventedAmount': return alt('the damage prevented this way', 'that much', 'that many'); // CR 615.5
    // FAST5X E16 (CR 120.4a, 608.2c): "the excess damage dealt [to that creature] this way"; "that excess damage" after a condition that named it
    case 'excessDamage': {
      const to = q.to === undefined ? '' : ` to ${excessRecipient(q.to, st)}`;
      return alt(`the excess damage dealt${to} this way`, `the amount of excess damage dealt${to} this way`, 'that excess damage', 'that much', 'that many');
    }
    case 'damageDealt': return q.stated === true ? 'that much' : 'the damage dealt this way'; // std-rx20 (CR 120.3, 608.2c); edh-next-109: the amount the damage instruction stated, "... and you gain that much life" (Kaya)
    case 'countersRemoved': return `the number of ${countParts(q, st)!.plural}`; // std-rx14 (CR 122.1, 608.2c)
    case 'countersPut': return `the number of ${countParts(q, st)!.plural}`; // trek-6 (CR 122.6, 608.2c)
    case 'lifeLost': {
      if (q.who === undefined) return 'the life lost this way'; // M12-3 (CR 119.3, 608.2c)
      // cloud std-spm: the life one player lost this way; "that much" / "that many" after the condition that named it ("If you lost life this way, ...")
      return alt(`the life ${K.player(q.who, st, 'subject').text} lost this way`, 'that much', 'that many');
    }
    case 'votes': return `the number of ${q.choice} votes`; // M12-3 (CR 701.38a-b)
    case 'votesFor': { const parts = countParts(q, st); if (parts === null) throw new NoRenderer('the votes something other than you or the player a group instruction is at received'); return `the number of ${parts.plural}`; } // edhd27 (CR 701.38a-b)
    case 'opponentsAttacked':
      // trek-7 (CR 506.3, 508.1): the whole turn's count, "the number of opponents you attacked this turn" (Worf, Defiant Commander)
      if (q.scope === 'turn') return alt('the number of opponents you attacked this turn', "the number of opponents you've attacked this turn", 'the number of opponents you have attacked this turn');
      if (q.present === true) return 'the number of opponents being attacked'; // edh-next-98 (Dimir Strandcatcher)
      return 'the number of opponents you attacked with a creature this combat'; // M12-3 (CR 702.121a, melee)
    case 'faceUpX': return 'X'; // CR 702.37f: the X of the cost paid to turn it face up
    // M11-0 (m11 design 4.5), CR 903.8: the casts of the controller's commander(s) from the command zone
    // CMDF: "a commander" (Jirina Kudro, Font of Magic) counts the same casts (equivalence a-commander-casts)
    case 'commanderCasts':
      // edh-mana-keywords-7 (CR 903.8; Study Hall): the commander the mana was spent on, "it": only after "when you spend this mana to cast your commander"
      if (q.spell === true) { if (q.of !== undefined || q.self === true) throw new NoRenderer('a commander-casts count of a spell with other fields'); return "the number of times it's been cast from the command zone this game"; }
      if (q.of !== undefined) throw new NoRenderer('another player\'s commander casts outside "draws X cards plus an additional card for each time they\'ve cast a commander"'); // CMD2
      return `the number of times you've cast ${alt('your commander', 'a commander')} from the command zone this game`;
    case 'commanderIdentitySize': return "the number of colors in your commanders' color identity"; // pc-statics-2 (CR 903.4)
    default: throw new NoRenderer(`quantity ${(q as { q: string }).q}`);
  }
}


/**
 * FAST5X E19 (CR 601.2h): the spell of "N mana was spent to cast <it>": the triggering cast event's spell is "that spell" or "it" (Oracle prints both); `~`
 * is this spell or the permanent it became.
 */
export function spentObjectText(of: ObjRef, st: RenderState): string {
  const text = K.obj(of, st, 'object').text;
  return of.ref === 'event' ? alt(text, 'it') : of.ref === 'self' ? alt(text, 'it', 'this spell') : text;
}

/**
 * edh-c-61 (CR 701.8a, 700.4, 614.6; Hellfire ruling 2009-10-01; family died-this-way): "the number of creatures that died this way" after a destroy of creatures: the destroyed
 * creatures a replacement effect did not exile instead (`resultCount.to`). Only the creatures the step destroyed (its noun is "creature") and every one of them (`which: {}`).
 */
function diedCountPhrase(q: Extract<Quantity, { q: 'resultCount' }>, st: RenderState): string {
  const r = st.info.get(`r:${q.step}`);
  if (q.to !== 'graveyard' || q.maxPerOwner === true || q.attempted === true || q.which === undefined || Object.keys(q.which).length !== 0 || r?.thisWay !== 'destroyed this way' || !r.nouns.includes('creature')) {
    throw new NoRenderer('a count of what a destroy put into a graveyard, other than "the number of creatures that died this way"');
  }
  return 'the number of creatures that died this way';
}
