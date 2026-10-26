/**
 * Quantities as phrases (WP2): "3", "X", "the number of creatures you control", "its power", "your devotion to green", "twice its power".
 * `qty` prints the value as it follows "equal to"; a plain number prints as digits (callers that count things use number words themselves).
 */
import type { ObjectFilter, Quantity, ObjRef, PlayerRef } from '../types/ability';
import { K, type QtyOpts } from './kernel';
import { isPlayerRef } from './refs';
import { costCountParts, movedCountParts, movedCountPhrase, movedGroupNp } from './moved';
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
  counterKinds: 'different kinds of counters', // r4-static (CR 122.1): "three or more different kinds of counters among creatures you control"
  planeswalkerTypes: 'planeswalker types', // r5-fxb (CR 205.3j)
  powers: 'powers', // CLOUD std-misc (CR 208.1): "the number of different powers among ..." (the "different" is said by the count's own wording)
};
/** FAST5 T58: the singular of a `distinct` quantity for "for each color among ..." (countParts); a kind not listed has no "for each" wording. */
const DISTINCT_SINGULAR: Record<string, string> = { colors: 'color', cardTypes: 'card type', creatureTypes: 'creature type', manaValues: 'different mana value' }; // r4-fxz: Lunar Insight's "for each different mana value among ..."

const PLAYER_ZONE: Record<string, string> = { hand: 'hand', graveyard: 'graveyard', library: 'library', exile: 'exile' };

export const isNumber = (q: Quantity): q is number => typeof q === 'number';

/** FAST5 T53 (CR 402.1): "more cards in hand than you": the players whose zone compares with yours. Only a bigger or smaller hand, graveyard or library than yours. */
export function sizeVsWords(s: { zone: string; op: string; than: { ref: string } }): string {
  if (s.than.ref !== 'you' || (s.op !== '>' && s.op !== '<')) throw new NoRenderer('a zone size compared with a player other than you, or by other than more / fewer');
  const zone = s.zone === 'hand' ? 'in hand' : s.zone === 'graveyard' ? 'in graveyard' : 'in library';
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
    throw new NoRenderer('excess damage dealt to a set of permanents');
  }
  return K.obj(to, st, 'object').text;
}

/** The words of a history scope (M6-0: `lastTurn`, "last turn"). */
export const scopeWords = (scope: Extract<Quantity, { q: 'happenedCount' }>['scope']): string =>
  scope === 'turn' ? 'this turn' : scope === 'combat' ? 'this combat' : scope === 'lastTurn' ? 'last turn' : 'this game';

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
  if (ev.ev === 'zoneChange' && ev.from === 'battlefield' && ev.to === 'graveyard') {
    const isCreature = (ev.subject.types ?? []).length === 1 && ev.subject.types![0] === 'Creature';
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
    return { plural: `${K.np(f, st, { det: 'none', plural: true })} that entered the battlefield under your control ${scope}`, singular: `${K.np(f, st, { det: 'none', forEach: true })} that entered the battlefield under your control ${scope}` };
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
      return { plural: "spells you've cast this turn from anywhere other than your hand", singular: "spell you've cast this turn from anywhere other than your hand" };
    }
    const by = q.by ?? ev.player;
    const p = by === 'you' || by === undefined || by === 'any' ? null : K.player(by, st, 'subject');
    const who = by === 'you' ? "you've" : p === null ? '' : theyHave(p);
    const kind = ev.spell ? K.np({ ...ev.spell, stackKind: 'spell' }, st, { det: 'none', plural: true }) : 'spells';
    const kind1 = ev.spell ? K.np({ ...ev.spell, stackKind: 'spell' }, st, { det: 'none', ...(before ? { forEach: true } : {}) }) : 'spell';
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
  // FAST5 T61 (CR 701.9a, 608.2h): "draw a card for each card you've discarded this turn": the cards you discarded (the action event of a discard names the
  // owner as the actor, rules/history.ts); only your own, only any card
  if (ev.ev === 'action' && ev.verb === 'discard' && ev.actor === 'you' && ev.object === undefined && q.by === undefined) {
    return { plural: `cards you've discarded ${scope}`, singular: `card you've discarded ${scope}` };
  }
  // std-r7 (CR 701.21a, 608.2h; parser/holes/qty.ts#historyCounts): "permanents you've sacrificed this turn", "Foods you've sacrificed this turn": your sacrifices
  // of the turn, one per permanent; only your own, nothing else about the event
  if (ev.ev === 'action' && ev.verb === 'sacrifice' && ev.actor === 'you' && Object.keys(ev).every((k) => k === 'ev' || k === 'verb' || k === 'actor' || k === 'object') && q.by === undefined && !before) {
    const what = ev.object === undefined ? { plural: 'permanents', singular: 'permanent' } : { plural: K.np(ev.object, st, { det: 'none', plural: true }), singular: K.np(ev.object, st, { det: 'none', forEach: true }) };
    return { plural: `${what.plural} you've sacrificed ${scope}`, singular: `${what.singular} you've sacrificed ${scope}` };
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

/** The pieces of a quantity that counts things: used for "the number of X" and for "for each Y". Null when the quantity is not a count of things. */
/** r4-refs: `max(spellsCastThisTurn - 1, 0)`, the spells you've cast this turn other than the first. */
function afterFirstSpell(q: Quantity): boolean {
  return JSON.stringify(q) === JSON.stringify({ q: 'math', op: 'max', args: [{ q: 'math', op: '-', args: [{ q: 'spellsCastThisTurn' }, 1] }, 0] });
}

export function countParts(q: Quantity, st: RenderState): { plural: string; singular: string } | null {
  if (typeof q === 'number') return null;
  switch (q.q) {
    // std-costs-1 (CR 601.2b, 601.2f): the permanents announced for the spell's optional "sacrifice any number of" cost (parser/templates/zz-cloud/std-costs-1.json)
    case 'costCount': return { plural: 'permanents sacrificed this way', singular: 'permanent sacrificed this way' };
    // std-rq (CR 603.2c, 608.2c): in an ability that triggers on a discard of one or more cards and nothing else, the amount of the triggering event is the cards
    // discarded, "for each card discarded this way" (parser/lower/quantities.ts reads the words so only there)
    case 'eventAmount': {
      const on = st.trigger ?? [];
      const ev = on[0];
      if (on.length !== 1 || ev?.ev !== 'action' || ev.verb !== 'discard' || Object.keys(ev).some((k) => k !== 'ev' && k !== 'verb' && k !== 'actor')) return null;
      return { plural: 'cards discarded this way', singular: 'card discarded this way' };
    }
    case 'count': {
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
      return everywhere ? { plural: alt(plural, `${plural} on the battlefield`), singular: alt(singular, `${singular} on the battlefield`) } : { plural, singular };
    }
    // FAST3 T12: "for each charge counter on ~" (CR 122.1): the counters of one kind on one object
    // std-rm (CR 121.1, 601.2i): "for each card you've drawn this turn", "for each spell you've cast this turn"
    case 'cardsDrawnThisTurn': return { plural: "cards you've drawn this turn", singular: "card you've drawn this turn" };
    case 'spellsCastThisTurn': return { plural: "spells you've cast this turn", singular: "spell you've cast this turn" };
    case 'counters': {
      // std-rm (CR 122.1): "for each experience counter you have", "for each poison counter they have": the counters of one kind a player has
      if (isPlayerRef(q.on, st)) {
        if (q.kind === 'any') return null;
        // pc-tokens-1 (CR 122.1f, 102.3; Phyrexian Swarmlord): "for each poison counter your opponents have": the counters of every opponent together (effects/eval.ts sums over the players)
        if (isYourOpponents(q.on)) return { plural: `${q.kind} counters your opponents have`, singular: `${q.kind} counter your opponents have` };
        const p = K.player(q.on as PlayerRef, st, 'subject');
        const has = p.person === 'sg' ? 'has' : 'have';
        return { plural: `${q.kind} counters ${p.text} ${has}`, singular: `${q.kind} counter ${p.text} ${has}` };
      }
      const on = K.obj(q.on as ObjRef, st, 'object').text;
      // std-rq (CR 122.1): every counter of every kind on one object, "for each counter on it"
      if (q.kind === 'any') return { plural: `counters on ${on}`, singular: `counter on ${on}` };
      return { plural: `${q.kind} counters on ${on}`, singular: `${q.kind} counter on ${on}` };
    }
    // FAST3 T12: domain, "basic land types among lands you control" (CR 305.6)
    case 'math': {
      // r4-refs (CR 601.2i, 608.2h): "for each spell you've cast this turn other than the first": the spells cast this turn less one, never below zero
      if (afterFirstSpell(q)) return { plural: "spells you've cast this turn other than the first", singular: "spell you've cast this turn other than the first" };
      const d = domainOf(q);
      if (d === null) return null;
      const among = K.np(d, st, { det: 'none', plural: true });
      return { plural: `basic land types among ${among}`, singular: `basic land type among ${among}` };
    }
    // QTY1 (CR 105.1, 105.2): "for each color among other artifacts you control", "for each card type among cards in your graveyard": the readings of a
    // `distinct` quantity, tried in turn (T65, T68, T58 were three clauses of this switch, so only the first ever ran); the first with words is the one
    case 'distinct': return distinctColorParts(q, st) ?? distinctColorAmongParts(q, st) ?? distinctKindParts(q, st);
    case 'countPlayers': {
      const of = q.of;
      if (q.controlsIs !== undefined && (q.sizeIs !== undefined || q.lifeIs !== undefined || q.lostLifeIs !== undefined || of.ref !== 'each')) throw new NoRenderer('a count of players who control a number of permanents, narrowed otherwise too');
      if (q.lifeIs !== undefined) throw new NoRenderer('a count of players by their life total (r4-static: rendered as a condition only)');
      if (q.poisonIs !== undefined) throw new NoRenderer('a count of players by their poison counters (std-rx24: rendered as a condition only)');
      if (q.lostLifeIs !== undefined) throw new NoRenderer('a count of players by the life they lost this turn (Standard round P: rendered as a condition only)');
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
          return { plural: `${pluralize(of.who)} who have ${w}`, singular: `${of.who} who has ${w}` };
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
          const { filter, op, than } = q.controlsVs;
          if (of.who !== 'opponent' || than.ref !== 'you' || (op !== '>' && op !== '<') || q.sizeVs !== undefined || q.lostLifeThisTurn === true || filter.controller !== undefined) {
            throw new NoRenderer('a count of players who control more permanents than another player (std-sos review: rendered as a condition only)');
          }
          const w = `${op === '>' ? 'more' : 'fewer'} ${K.np(filter, st, { det: 'none', plural: true })} than you`;
          return { plural: `opponents who control ${w}`, singular: `opponent who controls ${w}` };
        }
        if (q.sizeVs !== undefined) {
          if (q.lostLifeThisTurn === true) throw new NoRenderer('a count of players with a bigger zone who also lost life this turn');
          const w = sizeVsWords(q.sizeVs); // FAST5 T53 (CR 402.1)
          return { plural: `${pluralize(word)} who have ${w}`, singular: `${word} who has ${w}` };
        }
        // std-mkm (CR 119.3, 120.3a): "for each opponent who lost life this turn"
        if (q.lostLifeThisTurn === true) return { plural: `${pluralize(word)} who lost life this turn`, singular: `${word} who lost life this turn` };
        // std-rx20 (CR 102.3, family opponent-you-have): "for each opponent you have" counts the same players as "for each opponent" (Big Apple, 3 a.m.)
        return { plural: pluralize(word), singular: of.who === 'opponent' ? alt(word, 'opponent you have') : word };
      }
      if (q.sizeVs !== undefined || q.controlsVs !== undefined || q.controlsIs !== undefined || q.lostLifeThisTurn === true) throw new NoRenderer('a count of players with a bigger zone (or more permanents) than another player or who lost life this turn, of a group other than each player');
      return { plural: 'players', singular: 'player' };
    }
    case 'happenedCount': return damageTotalTo(q) !== null ? null : happened(q, st); // std-rx29: an amount of damage is no count of things
    // CLOUD std-tmt (CR 205.2a): "for each card type among spells you've cast this turn" (a cast count's words, after "card types among")
    case 'happenedDistinct': {
      const h = happened({ q: 'happenedCount', event: q.event, scope: q.scope, ...(q.by !== undefined ? { by: q.by } : {}) }, st);
      if (q.event.ev !== 'cast' || q.what !== 'cardTypes') throw new NoRenderer('different card types among events other than casts'); // cloud r3-mech: 'sources' has only its idiom (render/cond.ts)
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
    // trek-6 (CR 122.6, 608.2c): "the number of +1/+1 counters put this way"
    case 'countersPut': {
      const k = q.kind === undefined ? '' : `${q.kind} `;
      return { plural: `${k}counters put this way`, singular: `${k}counter put this way` };
    }
    // FAST5 T37 (CR 601.2h; converge): "for each color of mana spent to cast it" (a permanent that enters with counters for it)
    case 'colorsSpent': return { plural: 'colors of mana spent to cast it', singular: 'color of mana spent to cast it' };
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
      if (q.of !== undefined) return null; // CMD2: another player's casts are worded by the step that reads them (render/steps-cards.ts#draw)
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

/** std-rx29: the object of "the amount of damage dealt to <it> this turn" (`happenedCount` summing this turn's damage to one object, nothing else), or null. */
function damageTotalTo(q: Extract<Quantity, { q: 'happenedCount' }>): ObjRef | null {
  const ev = q.event;
  if (q.sum !== 'amount' || q.scope !== 'turn' || q.per !== undefined || q.by !== undefined || q.beforeEvent !== undefined || ev.ev !== 'damage') return null;
  if (Object.keys(ev).some((k) => k !== 'ev' && k !== 'recipient') || ev.recipient?.player !== undefined) return null;
  const o = ev.recipient?.object;
  return o !== undefined && Object.keys(o).length === 1 && o.is !== undefined ? o.is : null;
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

function statPhrase(q: Extract<Quantity, { q: 'stat' }>, st: RenderState): string {
  const word = STAT_WORD[q.stat]!;
  // FAST5X E15 (CR 208.1, 202.3): "the greatest power among creatures you control", "the least mana value among ..."; Oracle names the set without a quantifier
  if (q.agg !== undefined) {
    // Cloud r3-moved (CR 608.2c, 608.2h): "the greatest mana value among cards discarded this way" (the cards one earlier discard bound)
    const moved = q.sum ? null : movedGroupNp(q.of, st);
    if (moved !== null) return q.agg === 'max' ? `the greatest ${word} among ${moved}` : `the least ${word} among ${moved}`;
    // only a set the parser reads (a filter over the game); anything else has no wording yet and stays manual (G6)
    if (q.sum || !(q.of.ref === 'each' && 'filter' in q.of)) throw new NoRenderer(`the ${q.agg} ${word} of ${JSON.stringify(q.of)}`);
    // CMD2 (CR 903.3d): "the greatest mana value of a commander you own on the battlefield or in the command zone" (parser/holes/commander-qty.ts): Oracle's
    // one wording of exactly this set (the commanders a player owns in those two zones)
    if (q.agg === 'max' && q.stat === 'manaValue' && isCommandersOwnedOnBattlefieldOrCommand(q.of.filter)) return 'the greatest mana value of a commander you own on the battlefield or in the command zone';
    const set = K.np(q.of.filter, st, { det: 'none', plural: true });
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
  if (q.sum || q.of.ref === 'each' || q.of.ref === 'union') {
    // std-rx29 (parser/holes/qty.ts; Kylox, Visionary Inventor): a group named before is also "their total power" (the possessive, on a copy of the state)
    const theirs = q.sum && (q.of.ref === 'bound' || q.of.ref === 'event') ? K.obj(q.of, cloneState(st), 'possessive') : null;
    const total0 = `the total ${word} of ${K.obj(q.of, st, 'object').text}`;
    const total = theirs !== null && theirs.plural ? alt(total0, `${theirs.text} total ${word}`) : total0;
    // FAST4 T21: "the total power of creatures you control" (no quantifier) is how Oracle names the set here, as for `distinct` below (CR 208.1)
    return q.of.ref === 'each' && 'filter' in q.of ? alt(total, `the total ${word} of ${K.np(q.of.filter, st, { det: 'none', plural: true })}`) : total;
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
  return alt(own, after, ...dies);
}

/** std-rx7: is `q` the counters of the kind a one-pattern trigger's moved object is described with ("with one or more counters on it dies")? */
export function countersNamedByTrigger(q: Extract<Quantity, { q: 'counters' }>, st: RenderState): boolean {
  const trig = st.trigger ?? [];
  const p = trig.length === 1 && trig[0]!.ev === 'zoneChange' && trig[0]!.from === 'battlefield' ? trig[0]! : undefined;
  const named = p?.ev === 'zoneChange' ? p.subject?.counters : undefined;
  const on = q.on as { ref?: string; role?: string };
  return named !== undefined && named.kind === q.kind && (named.cmp === undefined || (named.cmp.op === '>=' && named.cmp.value === 1)) && on.ref === 'event' && on.role === 'subject';
}

/** pc-tokens-1: the players of "your opponents" (every opponent of the controller, CR 102.3). */
const isYourOpponents = (on: ObjRef | PlayerRef): boolean => on.ref === 'each' && 'who' in on && on.who === 'opponent';

function onPhrase(on: ObjRef | PlayerRef, st: RenderState, kind: string): string {
  const counters = kind === 'any' ? 'counters' : `${kind} counters`;
  if (isPlayerRef(on, st)) {
    if (isYourOpponents(on)) return `the number of ${counters} your opponents have`; // pc-tokens-1
    const p = K.player(on as PlayerRef, st, 'subject');
    return `the number of ${counters} ${p.text} ${p.person === 'sg' ? 'has' : 'have'}`;
  }
  // r4-fxb (family counters-on-group): the counters on a described group, "on lands you control" (no quantifier) as well as "on all lands you control"
  if (on.ref === 'each' && 'filter' in on) { const grp = alt(K.obj(on as ObjRef, st, 'object').text, K.np(on.filter, st, { det: 'none', plural: true })); return alt(`the number of ${counters} on ${grp}`, `the number of ${counters} among ${grp}`); } // pc-counters-3: Maester Seymour's "among"
  return `the number of ${counters} on ${K.obj(on as ObjRef, st, 'object').text}`;
}

/** The words of a `distinct` quantity: what is counted ("card types") and among what ("cards in your graveyard"). */
export function distinctParts(q: Extract<Quantity, { q: 'distinct' }>, st: RenderState): { among: string; w: string } {
  const a = q.among;
  const moved = movedGroupNp(a, st); // Cloud r3-moved: "card types among cards discarded this way"
  if (moved !== null) return { among: moved, w: DISTINCT_WORD[q.what] ?? q.what };
  // r4-moved (CR 607.2a; FAST5 T60's words for a count, render/cond.ts): the cards the linked ability of this object exiled are "cards exiled with ~"
  if (a.ref === 'linked' && a.link === 'exiled') return { among: `cards exiled with ${K.obj({ ref: 'self' }, st, 'object').text}`, w: DISTINCT_WORD[q.what] ?? q.what };
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
    case 'X': return st.anyNumberX === true ? alt('that many', 'that much') : st.costAllCountersX !== undefined ? `the number of ${st.costAllCountersX} counters removed this way` : 'X';
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
        const among = q.of.ref === 'each' && 'who' in q.of && q.of.who === 'player' ? 'all players' : q.of.ref === 'each' && 'who' in q.of && q.of.who === 'opponent' ? 'your opponents' : null;
        if (among === null) throw new NoRenderer('a highest or lowest life total among players other than all players or your opponents');
        return `the ${q.agg === 'max' ? alt('highest', 'greatest') : 'lowest'} life total among ${among}`;
      }
      return `${K.player(q.of, st, 'possessive').text} life total`;
    }
    case 'zoneSize': {
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
    case 'counters': return countersNamedByTrigger(q, st) ? 'that many' : onPhrase(q.on, st, q.kind);
    case 'partySize': return `the number of creatures in ${K.player(q.of, st, 'possessive').text} party`; // T38: CR 700.8
    // r5-cost (CR 205.3m): "the greatest number of creatures you control that have a creature type in common"
    case 'mostSharingCreatureType': {
      if (q.among.ref !== 'each' || !('filter' in q.among)) throw new NoRenderer('the most objects sharing a creature type of something other than a described set');
      return `the greatest number of ${K.np(q.among.filter, st, { det: 'none', plural: true })} that have a creature type in common`;
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
      return alt(`the number of ${w} among ${among}`, `the number of different ${w} among ${among}`);
    }
    case 'happenedCount': {
      // std-rx29 (CR 120.3, 603.10a; parser/holes/qty.ts): "the amount of damage dealt to it this turn", the damage one object was dealt this turn added up
      const to = damageTotalTo(q);
      if (to !== null) return `the amount of damage dealt to ${K.obj(to, st, 'object').text} this turn`;
      // FAST5X E22 (parser/lower/quantities.ts#sacrificedCount): "that much" after the condition "you sacrificed one or more permanents this turn" is its count
      const ev = q.event;
      if (ev.ev === 'action' && ev.verb === 'sacrifice' && ev.actor === 'you' && Object.keys(ev).length === 3 && q.scope === 'turn' && q.by === undefined && q.per === undefined
        // (std-ra, CR 107.3, 608.2h: not a condition that compares this very count, "If X is three or more" after "where X is the number of permanents you've sacrificed
        // this turn", whose X is the count said in full; render/fold.ts#whereXThenIfX)
        && [...st.conds].some((c) => c.includes(JSON.stringify(ev)) && !c.includes('"q":"happenedCount"'))) return 'that much';
      return `the number of ${happened(q, st).plural}`;
    }
    // Standard round 5, r5-trig (CR 107.4, 202.1): the mana symbols of a color in the mana cost of the spell a cast trigger names by them ("a noncreature spell with one or
    // more blue mana symbols in its mana cost, create that many"): "that many" there; elsewhere the count said in full
    case 'manaSymbols': {
      const trig = st.trigger ?? [];
      const named = trig.length === 1 && trig[0]!.ev === 'cast' && trig[0]!.spell?.manaSymbols?.color === q.color && q.of.ref === 'event' && q.of.role === 'spell';
      return named ? 'that many' : `the number of ${COLOR_WORD[q.color]} mana symbols in the mana cost of ${K.obj(q.of, st, 'object').text}`;
    }
    // CLOUD std-tmt (CR 205.2a): "the number of card types among spells you've cast this turn"
    case 'happenedDistinct': return `the number of ${countParts(q, st)!.plural}`;
    // r3-cost (CR 603.2, 120.3; family damage-dealt-amount): the amount of a damage trigger's event is also "the amount of damage dealt" (Kotis, the Fangkeeper)
    // r5-fxb (family that-amount-of-damage): before "damage", also "that amount of" ("~ deals that amount of damage to target creature that player controls")
    case 'eventAmount': return alt('that much', 'that many', 'the amount', ...((st.trigger ?? []).length === 1 && st.trigger![0]!.ev === 'damage' ? ['the amount of damage dealt', 'that amount of'] : []));
    case 'resultCount': {
      if (q.which !== undefined) return movedCountPhrase(q, st); // Cloud C7: "the number of cards exiled this way" (CR 608.2c, 608.2h)
      const base = `the number of ${K.obj({ ref: 'bound', name: q.step }, st, 'object').text}`;
      // FAST4 T26: "the number of cards discarded this way" (CR 608.2c): what the step did, said by its participle (render/steps-cards.ts#discard)
      const r = st.info.get(`r:${q.step}`);
      return r?.thisWay !== undefined && r.nouns[0] !== undefined ? alt(base, `the number of ${pluralize(r.nouns[0])} ${r.thisWay}`) : base;
    }
    case 'targetCount':
      st.used.add(q.id);
      return 'the number of targets';
    case 'spellTargetCount': return alt('the number of targets', 'the number of targets it has');
    case 'spellTargetTotal': return 'the total mana value of the permanents ~ targets'; // std-costs-1 (CR 601.2c, 601.2f, 202.3)
    case 'costCount': return 'the number of permanents sacrificed this way'; // std-costs-1 (CR 601.2b)
    // p2-c-dieroll-2 (family die-result-that-much): "that much" / "that many" after the roll (parser/lower/quantities.ts offers the one roll's result)
    case 'dieResult': return alt('the result', 'that result', 'the number rolled', 'that much', 'that many');
    case 'chosenNumber': return 'the chosen number'; // CLOUD std-misc (CR 608.2d, 607.2d)
    case 'speed': return 'your speed';
    // FAST5X E19 (CR 106.4): "the amount of unspent mana you have"
    case 'unspentMana': return `the amount of unspent ${q.type === undefined ? '' : `${q.type === 'C' ? 'colorless' : COLOR_WORD[q.type]} `}mana you have`;
    case 'spellManaSpent': // FAST5X E9 (CR 601.2h, 702.191a); E19: `of`, the spell named (that spell, it, ~)
      if (q.from !== undefined) return `the amount of mana from ${K.np(q.from, st, { det: 'a' })} spent to cast ${q.of === undefined ? 'that spell' : spentObjectText(q.of, st)}`;
      return q.of === undefined ? 'the amount of mana spent to cast that spell' : `the amount of mana spent to cast ${spentObjectText(q.of, st)}`;
    case 'resolvedThisTurn': return 'the number of times this ability has resolved this turn'; // FAST5X E17 (CR 608.2)
    case 'age': return alt("its age", 'the number of age counters on it');
    case 'level': return alt('its level', 'the number of level counters on it');
    case 'turnNumber': return 'the turn number';
    case 'startingLife': return 'your starting life total'; // FAST5 T60, CR 103.4
    case 'cardsDrawnThisTurn': return "the number of cards you've drawn this turn";
    case 'spellsCastThisTurn': return "the number of spells you've cast this turn";
    // FAST4 T26: "the amount of life you gained this turn" is the same amount (CR 119.3; the controller's life gained this turn)
    case 'lifeGainedThisTurn': return alt("the amount of life you've gained this turn", 'the amount of life you gained this turn');
    case 'descendedThisTurn': return 'the number of times you descended this turn'; // FAST5X E22 (CR 700.11)
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
      return p.they === true ? alt(`the life ${p.text} lost this turn`, 'the life they lost this turn') : `the life ${p.text} lost this turn`;
    }
    // FAST4 T34 (CR 601.2h; converge): "the number of colors of mana spent to cast ~"
    case 'colorsSpent': return alt(`the number of colors of mana spent to cast ${K.obj({ ref: 'self' }, st, 'object').text}`, 'the number of colors of mana spent to cast this spell');
    // FAST5 T42 (CR 601.2h): "the amount of mana spent to cast ~"
    // FAST5 T64: the permanent that entered as a copy is named again as "~" ("... mana value less than or equal to the amount of mana spent to cast ~", Mockingbird)
    // FAST5 T51 (CR 601.2h): "the number of colors of mana spent to cast that spell" (the spell of a cast trigger)
    case 'spellColorsSpent': return `the number of colors of mana spent to cast ${alt('that spell', 'it')}`; // r4-repl: "... to cast it" (family spell-colors-it)
    case 'modesChosen': return 'the number of times you chose a mode for that spell'; // Standard round 3, r3-trig (CR 700.2, 601.2b): the spell of the cast trigger
    case 'manaSpent': return alt(`the amount of mana spent to cast ${K.obj({ ref: 'self' }, st, 'object').text}`, 'the amount of mana spent to cast ~', 'the amount of mana spent to cast this spell', 'the amount of mana spent to cast it');
    case 'math': {
      // FAST5 T62 (CR 603.4): "draw cards equal to the difference": the number the ability's intervening "if" compares your cards in hand with, minus that count
      if (isDifference(q, st)) return 'the difference';
      const between = differenceBetweenOf(q);
      if (between !== null) return differenceBetweenPhrase(between[0], between[1], st);
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
    case 'damageDealt': return 'the damage dealt this way'; // std-rx20 (CR 120.3, 608.2c)
    case 'countersRemoved': return `the number of ${countParts(q, st)!.plural}`; // std-rx14 (CR 122.1, 608.2c)
    case 'countersPut': return `the number of ${countParts(q, st)!.plural}`; // trek-6 (CR 122.6, 608.2c)
    case 'lifeLost': {
      if (q.who === undefined) return 'the life lost this way'; // M12-3 (CR 119.3, 608.2c)
      // cloud std-spm: the life one player lost this way; "that much" / "that many" after the condition that named it ("If you lost life this way, ...")
      return alt(`the life ${K.player(q.who, st, 'subject').text} lost this way`, 'that much', 'that many');
    }
    case 'votes': return `the number of ${q.choice} votes`; // M12-3 (CR 701.38a-b)
    case 'opponentsAttacked':
      // trek-7 (CR 506.3, 508.1): the whole turn's count, "the number of opponents you attacked this turn" (Worf, Defiant Commander)
      if (q.scope === 'turn') return alt('the number of opponents you attacked this turn', "the number of opponents you've attacked this turn", 'the number of opponents you have attacked this turn');
      return 'the number of opponents you attacked with a creature this combat'; // M12-3 (CR 702.121a, melee)
    case 'faceUpX': return 'X'; // CR 702.37f: the X of the cost paid to turn it face up
    // M11-0 (m11 design 4.5), CR 903.8: the casts of the controller's commander(s) from the command zone
    // CMDF: "a commander" (Jirina Kudro, Font of Magic) counts the same casts (equivalence a-commander-casts)
    case 'commanderCasts':
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
