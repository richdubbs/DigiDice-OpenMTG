/**
 * Cloud C7 (CR 608.2c, 608.2h): what an earlier instruction actually moved, said by its participle: "for each creature destroyed this way", "the number of cards
 * exiled this way", "if a creature card was exiled this way", "if you put an artifact onto the battlefield this way" (parser/holes/moved-words.ts, moved.ts).
 *
 * The step renderers record the kind of each named instruction that reports what it moved (`RefInfo.moved` under `r:<name>`, as the discard and the group exile
 * record `thisWay` for "the number of cards discarded this way"); `{q:'resultCount', which}` and `{cond:'did', which}` read it here. A step whose kind was not
 * recorded has no wording (NoRenderer), so the gate refuses the reading rather than printing another verb.
 */
import type { Condition, ObjectFilter, ObjRef, Quantity } from '../types/ability';
import { K } from './kernel';
import type { MovedKind, RefInfo, RenderState } from './state';
import { alt, NoRenderer, numWord, pluralize } from './text';

/** The info a step renderer records for a named instruction of that kind (`r:<name>`): its nouns, and the words a "that many" count may use. */
export function movedInfo(kind: MovedKind, nouns: string[]): RefInfo {
  return { nouns, plural: true, thisWay: `${PLAIN_WORDS[kind]} this way`, moved: kind };
}

/** One plain wording of each kind (the participle "<words> this way"). */
const PLAIN_WORDS: Record<MovedKind, string> = {
  destroyed: 'destroyed', exiled: 'exiled', discarded: 'discarded', sacrificed: 'sacrificed', graveyard: 'put into a graveyard', battlefield: 'put onto the battlefield', hand: 'returned to their owners\' hands',
  milled: 'milled', top: 'put on top of a library', // r5-fxz: never printed so (wordsOf: "you put on top of your library")
};

/**
 * A zone where a card of each kind is a card (afterwards, or before it moved: a discarded card in the hand, a card put onto the battlefield from wherever it was),
 * so that a description of a card is printed "card", never "nontoken permanent" (CR 109.2); the zone words are not printed.
 */
const CARD_ZONE: Record<MovedKind, 'graveyard' | 'exile' | 'hand' | 'library'> = { destroyed: 'graveyard', exiled: 'exile', discarded: 'hand', sacrificed: 'graveyard', graveyard: 'graveyard', battlefield: 'hand', hand: 'hand', top: 'library', milled: 'graveyard' };

/**
 * The words "<participle> this way" of a kind and the description they leave to the noun phrase: "your graveyard" and "your hand" say the owner (the parser adds
 * `owner: 'you'` for them, CR 400.3), so the description loses it. Oracle prints "exiled" and "put into exile", "put into a graveyard" and "put into graveyards".
 */
/** `their` (edh-c-100, Coerced Confession): the instruction acted on ONE other player (a target), whose graveyard "their" names (CR 701.17a); a group of players has no such word. */
function wordsOf(kind: MovedKind, which: ObjectFilter, their = false): { words: string; rest: ObjectFilter; owned?: true } {
  const { owner, ...rest } = which;
  if (owner === 'you' && kind === 'graveyard') return { words: 'put into your graveyard this way', rest, owned: true };
  if (owner === 'you' && kind === 'hand') return { words: alt('returned to your hand this way', 'put into your hand this way', 'you put into your hand this way'), rest, owned: true }; // edh-d-35 (family put-into-hand-this-way)
  // r5-fxz (CR 701.25a, 701.22a): the cards a surveil or a scry of yours left on top of your library
  if (owner === 'you' && kind === 'top') return { words: 'you put on top of your library', rest, owned: true };
  if (kind === 'top') throw new NoRenderer('the cards another player put on top of their library');
  if (owner !== undefined) throw new NoRenderer('a description of moved objects with an owner');
  const words: Record<MovedKind, string> = {
    destroyed: 'destroyed this way', exiled: alt('exiled this way', 'put into exile this way'), discarded: 'discarded this way', sacrificed: 'sacrificed this way',
    graveyard: alt('put into a graveyard this way', 'put into graveyards this way', ...(their ? ['put into their graveyard this way'] : [])), battlefield: 'put onto the battlefield this way',
    hand: alt("returned to their owners' hands this way", "returned to its owner's hand this way"), top: 'you put on top of your library', milled: 'milled this way',
  };
  return { words: words[kind], rest };
}

/** The description as a noun phrase: a card description is printed in the zone of the kind without the zone words ("creature card", not "permanent"). */
function movedNp(f: ObjectFilter, kind: MovedKind, st: RenderState, o: { det: 'a' | 'none'; plural?: boolean; forEach?: boolean }): string {
  if (f.controller !== undefined || f.zone !== undefined) throw new NoRenderer('a description of moved objects with a controller or a zone');
  const zone = f.isCard === true ? CARD_ZONE[kind] : undefined;
  return K.np(zone !== undefined ? { ...f, zone } : f, st, { ...o, ...(zone !== undefined ? { noZone: true } : {}) });
}

/** edh-perms-20: the cards a mill trigger matched as a plural noun phrase without zone words ("nonland cards"). */
export function milledCardsNp(f: ObjectFilter, st: RenderState): string {
  return movedNp(f, 'milled', st, { det: 'none', plural: true });
}

/** The kind of the instruction named `step`, as its renderer recorded it. */
function kindOf(step: string, st: RenderState): MovedKind {
  const kind = st.info.get(`r:${step}`)?.moved;
  if (kind === undefined) throw new NoRenderer(`what "${step}" moved, with no wording for that instruction`);
  return kind;
}

/** "for each creature destroyed this way" (singular) and "creatures destroyed this way" (plural, "the number of ..."): render/qty.ts#countParts. */
export function movedCountParts(q: Extract<Quantity, { q: 'resultCount' }>, st: RenderState): { plural: string; singular: string } {
  const kind = kindOf(q.step, st);
  const { words, rest: withController } = wordsOf(kind, q.which!, st.info.get(`r:${q.step}`)?.onePlayer === true);
  // pc-tokens-1 (CR 608.2c, 608.2h, 400.7; Ceaseless Conflict): "for each nontoken creature you controlled that was destroyed this way": the controller as the object
  // last existed is said by a relative clause (parser/holes/moved-words.ts#RELATIVE_FRONTS); only "you", which the passive words alone cannot say
  if (withController.controller === 'you') {
    const { controller: _controller, ...rest } = withController;
    return {
      plural: `${movedNp(rest, kind, st, { det: 'none', plural: true })} you controlled that were ${words}`,
      singular: `${movedNp(rest, kind, st, { det: 'none', forEach: true })} you controlled that was ${words}`,
    };
  }
  // edh-players-16 (CR 608.2c, 608.2h, 400.7; Deadly Tempest): "the number of creatures they controlled that were destroyed this way": the player the group iterates
  const ctl = withController.controller;
  if (typeof ctl === 'object' && ctl.ref === 'iterating') {
    const { controller: _controller, ...rest } = withController;
    return {
      plural: `${movedNp(rest, kind, st, { det: 'none', plural: true })} they controlled that were ${words}`,
      singular: `${movedNp(rest, kind, st, { det: 'none', forEach: true })} they controlled that was ${words}`,
    };
  }
  const rest = withController;
  return { plural: `${movedNp(rest, kind, st, { det: 'none', plural: true })} ${words}`, singular: `${movedNp(rest, kind, st, { det: 'none', forEach: true })} ${words}` };
}

/** "the number of creatures destroyed this way": render/qty.ts#qty. */
export function movedCountPhrase(q: Extract<Quantity, { q: 'resultCount' }>, st: RenderState): string {
  return `the number of ${movedCountParts(q, st).plural}`;
}

/**
 * std-library-3 (CR 608.2c, 608.2h): "you exiled four or more cards this way" (Portent of Calamity; parser/holes/moved.ts): a count of what the instruction named `step`
 * moved, at least N, said with you as the subject; only an exile, a sacrifice or a discard (the instructions a player performs), and only cards. Null otherwise.
 */
export function movedAtLeastPhrase(q: Extract<Quantity, { q: 'resultCount' }>, n: number, st: RenderState): string | null {
  const kind = st.info.get(`r:${q.step}`)?.moved;
  // edh-perms-22 (CR 608.2c, 608.2h, 400.7; Flood of Tears): "if you return four or more nontoken permanents you control this way": permanents of yours (as they last existed) a move to the hand moved
  if (kind === 'hand') {
    const { controller, ...rest } = q.which ?? {};
    if (controller !== 'you' || rest.owner !== undefined || rest.anyOf !== undefined || rest.zone !== undefined) return null;
    return `you return ${numWord(n)} or more ${movedNp(rest, kind, st, { det: 'none', plural: true })} you control this way`;
  }
  if (kind !== 'exiled' && kind !== 'sacrificed' && kind !== 'discarded') return null;
  const which = q.which ?? {};
  if (which.isCard !== true || which.owner !== undefined || which.controller !== undefined || which.anyOf !== undefined) return null;
  return `you ${kind} ${numWord(n)} or more ${movedNp(which, kind, st, { det: 'none', plural: true })} this way`;
}

/** The active words of "you <verb> <np> this way" of a kind, or null when Oracle has none. */
const ACTIVE: Partial<Record<MovedKind, [string, string]>> = { exiled: ['exiled', 'this way'], battlefield: ['put', 'onto the battlefield this way'] }; // a discard and a sacrifice: movedCondPhrase

/**
 * "a creature card was exiled this way", "at least one creature card is exiled this way", "you exiled a land card this way", "you put an artifact onto the
 * battlefield this way", "you don't put a card onto the battlefield this way": render/cond.ts#did. The kind is the move's destination (`to`) or what the step
 * renderer recorded (a destroy, a sacrifice, a discard). Null for a reading another renderer owns (a move to the hand: FAST5 T75, STD-OTJ; a destroy whose
 * description says "you controlled" or "or": FAST5X E17).
 */
export function movedCondPhrase(c: Extract<Condition, { cond: 'did' }>, st: RenderState): string | null {
  const which = c.which!;
  if (c.to === 'hand') return null;
  const kind: MovedKind = c.to === 'exile' ? 'exiled' : c.to === 'graveyard' ? 'graveyard' : c.to === 'battlefield' ? 'battlefield' : kindOf(c.step, st);
  if (kind === 'destroyed' && (which.controller !== undefined || which.anyOf !== undefined)) return null;
  if (which.anyOf !== undefined) throw new NoRenderer('an "or" in a description of moved objects');
  // Cloud C7 review (CR 701.9a, 701.21a, 608.2h): what YOU discarded is a card you owned, what you sacrificed a permanent you controlled as it last existed: "if
  // you discarded a card this way", "if you sacrificed a creature this way" (parser/holes/moved.ts); the passive words count every player's, so they have no
  // active alternative
  const yours = (kind === 'discarded' && which.owner === 'you' && which.controller === undefined) || (kind === 'sacrificed' && which.controller === 'you' && which.owner === undefined);
  if (yours && c.not !== true) {
    const plain: ObjectFilter = { ...which };
    delete plain.owner;
    delete plain.controller;
    // Cloud r3-moved (CR 603.12): a reflexive trigger says it in the present tense, "When you discard a nonland card this way, ..." (parser/holes/moved.ts)
    // std-ra (CR 603.12, 608.2c): ... and "When you discard one or more nonland cards this way, ...", the same `did` (one or more such objects; parser/holes/moved.ts)
    const np = alt(movedNp(plain, kind, st, { det: 'a' }), `one or more ${movedNp(plain, kind, st, { det: 'none', plural: true })}`);
    return `you ${alt(kind, kind === 'discarded' ? 'discard' : 'sacrifice')} ${np} this way`;
  }
  const { words, rest, owned } = wordsOf(kind, which);
  const one = movedNp(rest, kind, st, { det: 'a' });
  const active = ACTIVE[kind];
  if (c.not === true) {
    if (kind !== 'battlefield' || active === undefined) throw new NoRenderer('a negated condition on what an instruction moved');
    return `you ${alt("don't", "didn't", 'do not', 'did not')} put ${one} onto the battlefield this way`;
  }
  const bare = movedNp(rest, kind, st, { det: 'none' });
  const passive = `${alt(one, `at least one ${bare}`)} ${alt('was', 'is')} ${words}`;
  // std-combat-1 (CR 603.12, 608.2c; family moved-this-way-condition): the reflexive trigger's "When you put one or more Equipment onto the battlefield this way",
  // the same `did` as "you put an Equipment ..." (one or more such objects; parser/holes/moved.ts reads "one or more" and a plural description the same way)
  const some = alt(one, `one or more ${movedNp(rest, kind, st, { det: 'none', plural: true })}`);
  // edh-next-56 (CR 603.12; Hidetsugu, Devouring Chaos): ... and in the present tense of an exile, "When you exile a nonland card this way, ..." (family moved-this-way-present-exile)
  return active === undefined || owned === true ? passive : alt(passive, `you ${active[0]} ${some} ${active[1]}`, ...(kind === 'exiled' ? [`you exile ${some} ${active[1]}`] : []));
}

/** Cloud r3-moved: the kind of what each cost reference names (parser/lower/conditions.ts#costMovedCond); a cost that exiled ~ itself is not "exiled this way". */
const COST_KIND: Readonly<Record<string, MovedKind>> = { costSacrificed: 'sacrificed', costDiscarded: 'discarded', costExiled: 'exiled' };

/**
 * Cloud r3-moved (CR 602.2b, 601.2h, 608.2c, 608.2h): "{1}{B}, Sacrifice another creature: ... If an outlaw was sacrificed this way, ...": whether the ONE object the
 * ability's cost moved matches is also said by the participle of the cost, as for an instruction (movedCondPhrase): "a <np> was sacrificed this way", "if a land card
 * was discarded this way", "if a creature card was exiled this way"; "you sacrificed a <np> this way" when the description says you controlled it (you paid the cost).
 * `plain` is the wording render/cond.ts has for it ("if the sacrificed creature was an outlaw"); it is kept as the other alternative.
 */
export function costMovedOr(c: Extract<Condition, { cond: 'matches' }>, plain: string, st: RenderState): string {
  let moved: string | null;
  try {
    moved = costMovedCondPhrase(c, st);
  } catch (e) {
    if (!(e instanceof NoRenderer)) throw e;
    moved = null; // a description the participle words cannot print: the plain wording alone
  }
  return moved === null ? plain : alt(plain, moved);
}

function costMovedCondPhrase(c: Extract<Condition, { cond: 'matches' }>, st: RenderState): string | null {
  const kind = COST_KIND[c.object.ref];
  if (kind === undefined || (c.object.ref === 'costExiled' && (c.object as { self?: true }).self === true)) return null;
  const { controller, owner, ...rest } = c.filter;
  if (rest.anyOf !== undefined || owner !== undefined || (controller !== undefined && (controller !== 'you' || kind !== 'sacrificed'))) return null;
  if (controller === 'you') return `you sacrificed ${movedNp(rest, kind, st, { det: 'a' })} this way`;
  const { words } = wordsOf(kind, rest);
  // edh-d-53 (CR 602.2b, 608.2h; Lethal Throwdown): and, of what a cost sacrificed, "the modified creature was sacrificed" (no "this way")
  const theCost = kind === 'sacrificed' ? [`the ${movedNp(rest, kind, st, { det: 'none' })} was sacrificed`] : [];
  return alt(`${alt(movedNp(rest, kind, st, { det: 'a' }), `at least one ${movedNp(rest, kind, st, { det: 'none' })}`)} ${alt('was', 'is')} ${words}`, ...theCost);
}

/**
 * Cloud r3-moved (CR 608.2c, 608.2h): the cards ONE earlier discard bound, named by its participle as the set of a statistic: "the greatest mana value among cards
 * discarded this way", "for each card type among cards discarded this way" (parser/lower/quantities.ts#movedGroups). Null for any other set.
 */
export function movedGroupNp(ref: ObjRef, st: RenderState): string | null {
  if (ref.ref !== 'bound') return null;
  const r = st.info.get(`r:${ref.name}`);
  if (r?.moved === 'sacrificed' && r.thisWay !== undefined) { // edh-perms-20: the one specific noun ("creature", beside the generic "permanent")
    const specific = r.nouns.filter((n) => n !== 'permanent' && n !== 'card');
    if (specific.length === 1) return `${pluralize(specific[0]!)} ${r.thisWay}`;
  }
  return r?.moved === 'discarded' && r.thisWay !== undefined ? `cards ${r.thisWay}` : null;
}

/** Cloud r3-moved: the info key the cost renderer records for each cost reference (render/costs.ts), and the participle of its kind. */
const COST_PARTS: Readonly<Record<string, readonly [string, string]>> = { costSacrificed: ['cost:sacrificed', 'sacrificed'], costDiscarded: ['cost:discarded', 'discarded'], costExiled: ['cost:exiled', 'exiled'] };

/**
 * Cloud r3-moved (CR 602.2b, 601.2h, 608.2c): a count of every object ONE part of the ability's cost moved is "the number of cards exiled this way", "for each creature
 * sacrificed this way" (parser/lower/quantities.ts#costCount): the noun of the cost part (render/costs.ts records it when this ability states that cost; a spell's
 * additional cost is a static ability of its own, so "card" or a permanent noun then). Null for any other count.
 */
export function costCountParts(of: ObjRef, st: RenderState): { plural: string; singular: string } | null {
  const part = COST_PARTS[of.ref];
  if (part === undefined || (of.ref === 'costExiled' && (of as { self?: true }).self === true)) return null;
  const [key, verb] = part;
  const own = st.info.get(key)?.nouns ?? [];
  // edh-next-35: the plural noun of the face's own additional cost ("any number of Spirits") is the first choice for a spell (RenderContext.costSacrificeNouns)
  const faceNouns = of.ref === 'costSacrificed' ? (st.ctx.costSacrificeNouns ?? []).map((n) => (n.endsWith('s') ? n.slice(0, -1) : n)) : [];
  const nouns = own.length > 0 ? own : faceNouns.length > 0 ? faceNouns : of.ref === 'costSacrificed' ? ['creature', 'artifact', 'permanent'] : ['card'];
  return { plural: alt(...nouns.map((n) => `${pluralize(n)} ${verb} this way`)), singular: alt(...nouns.map((n) => `${n} ${verb} this way`)) };
}
