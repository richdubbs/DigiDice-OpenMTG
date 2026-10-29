/**
 * Moving and changing objects (WP2): move, destroy, sacrifice, sacrificeChoice, counter, createToken, copy, tap, untap, attach, changeFace, phaseOut,
 * regenerate, removeFromCombat, exchange, cast (CR 701.3-701.8, 701.12, 701.19, 701.21, 701.26, 707.10, 111, 400).
 */
import { namedTokenOf } from '../model/named-tokens';
import type { Destination, ObjectFilter, ObjRef, PlayerRef, Quantity, TokenDef } from '../types/ability';
import { acting, plain, type Clause } from './clause';
import { K } from './kernel';
import { AMBIGUOUS, anaphor, identityOf, isPlayerRef, restOfExiled, restOfGroup, roleInfo, withSubjects } from './refs';
import { zoneSetPhrase } from './steps-cards';
import { bind, bindCant, byPlayer, countedNp, destPhrase, exileCounters, halfOfControlled, infoOfRef, isComputed, modal, timesWords, type StepOf } from './steps-util';
import { keywordWords } from './kw';
import { quotedAbility, quotedListItem } from './quote';
import { cloneState, objKey, playerKey, PUT_INTO_GRAVEYARD_THIS_WAY, withVariants, type RenderState } from './state';
import { formatManaCost } from '../types/mana';
import { countParts } from './qty';
import { alt, article, COLOR_WORD, firstAlt, joinList, NoRenderer, numWord, pluralize, withArticle } from './text';
import { copyExceptText, spellCopyExceptText } from './copy-except';
import { movedInfo } from './moved';
import { abilityList } from './mods';

const PLURAL_ZONE: Record<string, string> = { graveyard: 'graveyards', hand: 'hands', library: 'libraries' };

/**
 * FAST5 T67 (CR 122.1, 107.3): "a token for each counter on ~": every counter on one object, of any kind (render/qty.ts#countParts names one kind only, and
 * a player's counters of any kind include poison, CR 122.1f; so this reading is the token count's alone).
 */
function countersOnObject(q: unknown, st: RenderState): { plural: string; singular: string } | null {
  if (typeof q !== 'object' || q === null) return null;
  const c = q as { q?: string; kind?: string; on?: unknown };
  if (c.q !== 'counters' || c.kind !== 'any' || isPlayerRef(c.on as ObjRef | PlayerRef, st)) return null;
  const on = K.obj(c.on as ObjRef, st, 'object').text;
  return { plural: `counters on ${on}`, singular: `counter on ${on}` };
}

/** FAST2 T10: what "destroy" or "sacrifice" acts on, a permanent (CR 701.8a, 701.21a): a spell or ability is no antecedent of its pronoun (refs.ts#candidateCheck). */
function permanentRef(what: ObjRef, st: RenderState, sacrifice = false): string {
  const saved = st.permanentOnly;
  const savedSac = st.sacrificeOnly;
  st.permanentOnly = true;
  if (sacrifice) st.sacrificeOnly = true; // std-rw9 (CR 701.21a): nor, for "sacrifice", a target that may be a player
  try {
    return K.obj(what, st, 'object').text;
  } finally {
    st.permanentOnly = saved;
    if (savedSac === undefined) delete st.sacrificeOnly;
    else st.sacrificeOnly = savedSac;
  }
}

/**
 * FAST2 T10: the name a move gives what it moved (`as`: "exile target creature. Return that card ...", parser/lower/anaphora.ts#bindMoved). It is the same
 * thing in a new zone (CR 400.7): one antecedent with what was moved (`sameAs`), called a card outside the battlefield, and coming back from where it went
 * (the verb of moving it again reads "return", render/steps-zones.ts#moveVerb). Only a move of one identified thing (a target, ~, a binding, an event
 * object); a moved group keeps no name here.
 */
/**
 * r3-refs (CR 701.21a, 205.3m, 608.2c, 101.4): "each player sacrifices all other creatures they control that don't share a creature type with the chosen creature they
 * control" after "For each player, you choose a creature that player controls." (Winnowing): each player keeps the creature chosen for them and every creature of theirs that
 * shares a creature type with it. Only exactly that filter: one card type, the sacrificing player's own permanents, and the per-player choice (`chosen this way`) left out.
 */
function keepsChosenKin(s: StepOf<'sacrificeChoice'>, st: RenderState): string | null {
  const f = s.filter;
  const iterating = { ref: 'iterating' };
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join();
  if (keys !== 'controller,not,types' || JSON.stringify(f.controller) !== JSON.stringify(iterating) || f.types?.length !== 1 || s.who.ref !== 'each') return null;
  const alts = f.not?.anyOf;
  if (alts === undefined || alts.length !== 2 || Object.keys(f.not!).length !== 1) return null;
  const chosen = alts[0]!.is;
  if (chosen?.ref !== 'bound' || Object.keys(alts[0]!).length !== 1 || st.info.get(`b:${chosen.name}`)?.thisWay !== 'chosen this way') return null;
  const sw = alts[1]!.sharesWith;
  const kin = { ref: 'each', filter: { is: chosen, controller: iterating } };
  if (sw === undefined || Object.keys(alts[1]!).length !== 1 || sw.quality !== 'creatureType' || JSON.stringify(sw.with) !== JSON.stringify(kin)) return null;
  const noun = f.types[0]!.toLowerCase();
  return `all other ${pluralize(noun)} they control that don't share a creature type with the chosen ${noun} they control`;
}

/** r3-refs: the card types of permanents (CR 110.4), as nouns. */
const PERMANENT_NOUNS: ReadonlySet<string> = new Set(['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker']);

function bindMoved(s: StepOf<'move'>, st: RenderState): void {
  // r3-refs (CR 110.1, 400.7j): a bound card put onto the battlefield is a permanent there, also "that permanent" ("You may put an artifact or creature card from
  // your hand onto the battlefield. That permanent gains haste"; parser/lower/mentions.ts gives the same noun); its other nouns stay
  if (s.what.ref === 'bound' && s.to.zone === 'battlefield') {
    const info = st.info.get(`b:${s.what.name}`);
    if (info !== undefined && !info.player && info.nouns.some((n) => PERMANENT_NOUNS.has(n)) && !info.nouns.includes('permanent')) st.info.set(`b:${s.what.name}`, { ...info, nouns: [...info.nouns, 'permanent'] });
  }
  // std-rx31 (CR 608.2c, 400.7; family exiled-card-participle): a bound card exiled by a move that gives it no new name is still that binding, and is also "the exiled
  // card" from then on ("Search your library for a card, exile it face down, then shuffle. ... you may cast the exiled card ...", Beseech the Mirror); one card only
  if (s.as === undefined && s.what.ref === 'bound' && s.to.zone === 'exile') {
    const info = st.info.get(`b:${s.what.name}`);
    if (info !== undefined && !info.plural && info.player !== true && info.nouns.includes('card') && !(info.alts ?? []).includes('the exiled card')) {
      st.info.set(`b:${s.what.name}`, { ...info, alts: [...(info.alts ?? []), 'the exiled card'] });
    }
  }
  if (s.as === undefined) return;
  // FAST4 T31 (CR 400.7, 406.3): the top cards of a library moved to a public zone are cards there ("Exile the top card of your library. You may play that card
  // this turn"); they have no key of their own (`objKey`), so the binding says what they are
  if (s.what.ref === 'topCards') {
    // r5-cost (CR 608.2c): the top card of EACH player's library is several cards ("... from among those cards", Etali, Primal Storm)
    const plural = s.what.count !== 1 || s.what.player.ref === 'each';
    // std-rt (CR 608.2c, 400.7; as r4-moved's alt in bindMove): the one card the move exiled is also "the exiled card" ("Exile the top card of that player's library.
    // ... you may play the exiled card this turn", Reno and Rude; the parser's participle anaphor, parser/holes/object.ts). The plural, "the exiled cards", is std-rx29's
    // (Kylox, Visionary Inventor: "... from among the exiled cards") and std-rj's (CR 406.1, 608.2c; Doom Reigns Supreme: "You may cast up to two spells from among the exiled cards")
    const exiled = s.to.zone === 'exile' ? { alts: [plural ? 'the exiled cards' : 'the exiled card'] } : {};
    if (s.to.zone === 'exile' || s.to.zone === 'graveyard') bind(st, s.as, { nouns: ['card'], plural, zone: s.to.zone, ...exiled });
    return;
  }
  // FAST5 T77 (CR 608.2c, 400.7): the objects of several targets moved together are a group afterwards, "They are 5/5 Elemental creatures ..." (parser/lower/mentions.ts#groupOf)
  if (s.what.ref === 'union' && s.to.zone === 'battlefield' && s.what.of.length >= 2 && s.what.of.every((r) => r.ref === 'target')) {
    bind(st, s.as, { nouns: [...new Set(s.what.of.flatMap((r) => infoOfRef(r, st).nouns))], plural: true, zone: s.to.zone });
    return;
  }
  // CLOUD std-tmt (CR 406.1, 400.7): ... and into exile, where they are cards ("Exile up to one target artifact you control and up to one target creature you control. Then
  // return them ...", parser/lower/mentions.ts#groupOf)
  if (s.what.ref === 'union' && s.to.zone === 'exile' && s.what.of.length >= 2 && s.what.of.every((r) => r.ref === 'target')) {
    bind(st, s.as, { nouns: [...new Set(['card', ...s.what.of.flatMap((r) => infoOfRef(r, st).nouns)])], plural: true, zone: s.to.zone });
    return;
  }
  // r3-fx (CR 608.2c, 400.7): what a move of a group put onto the battlefield is that group afterwards, "Return all Mount and Vehicle cards from your graveyard
  // to the battlefield. Sacrifice them at the beginning of the next end step." (the parser names the move only when a later sentence refers to it); permanents now
  if (s.what.ref === 'each' && s.to.zone === 'battlefield') {
    const nouns = infoOfRef(s.what, st).nouns.filter((n) => n !== 'card');
    bind(st, s.as, { nouns: nouns.length > 0 ? nouns : ['permanent'], plural: true, zone: s.to.zone });
    return;
  }
  const key = objKey(s.what);
  if (key === null || key === 'subject') return;
  // FAST5 T77 (CR 400.7): the object a trigger's event names ("Whenever a Villain you control dies, return it to the battlefield. That creature is a Hero ...") is called what the
  // event called it, not just a permanent, when the clause has not named it yet
  const before = s.what.ref === 'event' && !st.info.has(key) ? roleInfo(s.what.role, st).info : infoOfRef(s.what, st);
  const nouns = s.to.zone === 'battlefield' ? before.nouns : [...new Set(['card', ...before.nouns])];
  // r3-choose (CR 201.5, 400.7): the object itself, moved, is still called by its name or "this creature" ("Exile Zuko, then return him to the battlefield ...":
  // a character's pronoun is "~" too, parser/front/selfref.ts), as well as "it"
  const self = s.what.ref === 'self' ? { alts: ['~'] } : {};
  // r4-moved (CR 608.2c, 400.7): what one move exiled is also "the exiled card(s)" ("Exile X target artifacts and/or creatures. Return the exiled cards to the battlefield
  // ...", "You may exile a nonland card from among them. ... You may cast the exiled card without paying its mana cost": the parser's participle anaphor)
  // std-typechange-2 (CR 400.7, 406.1): and the object itself exiled face up ("If you can't, exile it, then you may cast the exiled card without paying its mana cost",
  // Etrata, Deadly Fugitive's granted ability; the parser's participle anaphor names the moved ~, lower/anaphora.ts#compatible)
  const exiled = s.to.zone === 'exile' && (s.what.ref === 'target' || s.what.ref === 'bound' || (s.what.ref === 'self' && s.to.faceDown !== true)) ? { alts: [before.plural ? 'the exiled cards' : 'the exiled card'] } : {};
  bind(st, s.as, { nouns, plural: before.plural, zone: s.to.zone, sameAs: identityOf(st, key), ...self, ...exiled });
}

/**
 * MX5: "Tap all creatures target player controls. Those creatures don't untap ...": a tap or untap of a group names what it acted on (`as`), so the next
 * sentence's "those creatures" reads as the group (plural, its nouns), not as one object. Only a group (`each`); one identified thing keeps its own key.
 */
/**
 * STD-FRA (CR 115.1, 601.2c; as FAST5 T66's move): the sentence of a target for each opponent starts "for each opponent,". r5-fxb: said by render/steps.ts#clause
 * for every op (and "for each player,"), only where the step names the target first ("Untap those creatures." after it is no per-player instruction).
 */
const forEachOpponent = (_what: ObjRef, text: string, _st: RenderState): string => text;

function tapClause(verb: 'tap' | 'untap', s: StepOf<'tap'> | StepOf<'untap'>, st: RenderState): Clause {
  const text = forEachOpponent(s.what, `${verb} ${K.obj(s.what, st, 'object').text}`, st);
  if (s.as !== undefined && s.what.ref === 'each') bind(st, s.as, infoOfRef(s.what, st));
  // edh-zones-1 (family and-you-plain-clause): an untap is also "and you untap ..." after another player's clause (Clause.andYou)
  return plain(text, verb === 'untap' ? { andYou: text } : {});
}

/** What a move acts on. A whole zone of everyone ("all graveyards") has its own idiom. */
/**
 * r4-moved (CR 608.2c, 400.7, 701.9a): "put it from your graveyard onto the battlefield tapped": the ONE card an earlier instruction of this ability bound, only while it is
 * still in your graveyard (`{ref:'each', filter:{is:<binding>, zone:'graveyard', owner:'you'}}`, parser template eff.moved.put.fromGraveyard.battlefieldTapped): the
 * binding as it is named again ("it", the focus of render/steps-util.ts#movedCondFocus), then the zone. Null for any other reference.
 */
function boundFromYourGraveyard(what: ObjRef, st: RenderState): string | null {
  if (what.ref !== 'each') return null;
  const f = what.filter as Record<string, unknown>;
  const keys = Object.keys(f).filter((k) => f[k] !== undefined).sort().join(',');
  // std-rx27 (CR 404.1, 400.7): "Whenever an opponent discards a card, exile it from their graveyard": the card of the event in its owner's graveyard, with no
  // owner (the player of the event, "their"; template eff.rx27.exile.fromTheirGraveyard.withCounter), only for a card the event names
  const theirs = keys === 'is,zone' && f['zone'] === 'graveyard' && what.filter.is?.ref === 'event';
  if (!theirs && (keys !== 'is,owner,zone' || f['zone'] !== 'graveyard' || f['owner'] !== 'you')) return null;
  const is = what.filter.is;
  // std-rD (CR 608.2c, 400.7): "Whenever you discard a card, exile that card from your graveyard": the ONE card of the triggering event, found where the event put
  // it (template eff.stdrd.exile.fromYourGraveyard); a card the event put elsewhere (madness, CR 702.35a) or that left the graveyard is not moved
  let info;
  if (is?.ref === 'bound') info = st.info.get(`b:${is.name}`);
  else if (is?.ref === 'event') { const r = roleInfo(is.role, st); info = r.isSelf ? undefined : r.info; } // std-rD
  else return null;
  if (info === undefined || info.plural || info.player === true) return null;
  return `${K.obj(is, st, 'object').text} from ${theirs ? 'their' : 'your'} graveyard`;
}

/**
 * r5-moved (CR 701.17a, 701.17c, 608.2c): "each <cards> milled this way": the cards of a description among those a mill step of this ability put into a graveyard, found in
 * the public zone they moved to (`{ref:'each', filter:{anyOf:[<f>], is:<the mill's binding>, zone:'any'}}`, template eff.r5moved.put.eachMilled.battlefield). Only when the
 * binding is a mill rendered on its own (render/steps-cards.ts names it "milled this way"); null for any other reference.
 */
function eachMilledThisWay(what: ObjRef, st: RenderState): string | null {
  if (what.ref !== 'each') return null;
  const f = what.filter as Record<string, unknown>;
  const keys = Object.keys(f).filter((k) => f[k] !== undefined).sort().join(',');
  if (keys !== 'anyOf,is,zone' || f['zone'] !== 'any' || what.filter.is?.ref !== 'bound' || what.filter.anyOf?.length !== 1) return null;
  if (st.info.get(`r:${what.filter.is.name}`)?.thisWay !== 'milled this way') return null;
  return `${K.np({ ...what.filter.anyOf[0]!, zone: 'graveyard' }, st, { det: 'each', noZone: true })} milled this way`;
}

/**
 * r5-moved (CR 608.2c, 120.3): "a Dragon" in "If a Dragon is dealt damage this way, ...": a reference to the objects of ONE description among what a damage step of this ability
 * dealt damage to (`{ref:'each', filter:{anyOf:[<f>], is:<the damage step's binding>}}`, render/steps-life.ts marks the binding). Null for anything else.
 */
export function dealtThisWayOne(what: ObjRef | PlayerRef, st: RenderState): string | null {
  if (what.ref !== 'each' || !('filter' in what)) return null;
  const f = what.filter as Record<string, unknown>;
  const keys = Object.keys(f).filter((k) => f[k] !== undefined).sort().join(',');
  if (keys !== 'anyOf,is' || what.filter.is?.ref !== 'bound' || what.filter.anyOf?.length !== 1) return null;
  if (st.info.get(`b:${what.filter.is.name}`)?.thisWay !== 'dealt damage this way') return null;
  return K.np(what.filter.anyOf[0]!, st, { det: 'a' });
}

/**
 * trek-7: `move` of the rest of the cards another player's `exileUntil` exiled (`{each: {is: <exiled>, not: {is: <the card it stopped at>}, zone: 'exile'}}`) to the bottom of
 * their owners' library in a random order, said by the player who exiled them ("they put the rest on the bottom in a random order"): that player. Null for any other move.
 */
function exiledRestOfOtherPlayer(s: StepOf<'move'>, st: RenderState): PlayerRef | null {
  if (s.what.ref !== 'each' || !restOfExiled(s.what.filter)) return null;
  const d = s.to;
  if (d.zone !== 'library' || d.position !== 'bottom' || d.order !== 'random' || d.owner !== undefined || Object.keys(d).length !== 3 || s.until !== undefined || s.as !== undefined || s.guard !== undefined) return null;
  const group = (s.what.filter.is as { ref?: string; name?: string } | undefined)?.name;
  const info = group === undefined ? undefined : st.info.get(`b:${group}`);
  if (info?.exiledBy === undefined || info.exiledBy.ref === 'you') return null;
  return info.exiledBy;
}

/**
 * r5-moved (CR 701.25a, 608.2c, 400.7): the move of the card a surveil 1 of yours put into your graveyard, of a description, to your hand (`{ref:'each', filter:{anyOf:[<f>],
 * is:<the surveil's binding>, zone:'graveyard', owner:'you'}}` to the hand; render/steps-cards.ts#surveil marks the binding): "if you put a <card> into your graveyard this way,
 * put that card into your hand". Null for any other move.
 */
function surveilledToHand(s: StepOf<'move'>, st: RenderState): string | null {
  if (s.what.ref !== 'each' || s.to.zone !== 'hand' || Object.keys(s.to).length !== 1 || s.as !== undefined || s.until !== undefined) return null;
  const f = s.what.filter as Record<string, unknown>;
  const keys = Object.keys(f).filter((k) => f[k] !== undefined).sort().join(',');
  if (keys !== 'anyOf,is,owner,zone' || f['zone'] !== 'graveyard' || f['owner'] !== 'you' || s.what.filter.is?.ref !== 'bound' || s.what.filter.anyOf?.length !== 1) return null;
  if (st.info.get(`r:${s.what.filter.is.name}`)?.thisWay !== 'surveilled') return null;
  return `if you put ${K.np({ ...s.what.filter.anyOf[0]!, zone: 'graveyard' }, st, { det: 'a', noZone: true })} into your graveyard this way, put that card into your hand`;
}

/**
 * r5-moved (CR 608.2c, 400.7, 110.2a): the cards of a description in every graveyard but those the sacrifice of a group by each player right before put there
 * (`{ref:'each', filter:{anyOf:[<f>], zone:'graveyard', isCard:true, not:{is:<the sacrifice's binding>}}}`), onto the battlefield under their owners' control: "each player
 * returns all <cards> from their graveyard that weren't put there this way to the battlefield". Null for any other move.
 */
function notPutThereReturn(s: StepOf<'move'>, st: RenderState): string | null {
  const d = s.to;
  if (s.what.ref !== 'each' || d.zone !== 'battlefield' || d.controller !== 'owner' || Object.keys(d).length !== 2 || s.as !== undefined || s.until !== undefined) return null;
  const f = s.what.filter as Record<string, unknown>;
  const keys = Object.keys(f).filter((k) => f[k] !== undefined).sort().join(',');
  const not = s.what.filter.not as ObjectFilter | undefined;
  if (keys !== 'anyOf,isCard,not,zone' || f['zone'] !== 'graveyard' || f['isCard'] !== true || s.what.filter.anyOf?.length !== 1 || not === undefined || Object.keys(not).length !== 1 || not.is?.ref !== 'bound') return null;
  if (st.info.get(`r:${not.is.name}`)?.moved !== 'sacrificed') return null;
  const np = K.np({ ...s.what.filter.anyOf[0]!, zone: 'graveyard' }, st, { det: 'all', plural: true, noZone: true });
  return `each player returns ${np} from their graveyard that weren't put there this way to the battlefield`;
}

function movedThing(what: ObjRef, st: RenderState): string {
  const fromGraveyard = boundFromYourGraveyard(what, st);
  if (fromGraveyard !== null) return fromGraveyard;
  const milled = eachMilledThisWay(what, st);
  if (milled !== null) return milled;
  if (what.ref === 'each') {
    const f = what.filter;
    if (restOfGroup(f) !== null) return K.obj(what, st, 'object').text; // FAST5 T43: "the rest" (of a group looked at) is not a zone's contents
    const z = zoneSetPhrase(f, cloneState(st)); // on a copy: naming the owner here must not count as the first mention
    const text = K.obj(what, st, 'object').text;
    if (z && (f.owner === undefined || f.owner === 'any') && typeof f.zone === 'string') return alt(`all ${PLURAL_ZONE[f.zone] ?? `${f.zone}s`}`, text);
    // FAST3 T14: the cards in the graveyards of every opponent are "all opponents' graveyards" (CR 404.1: each player has a graveyard; "opponent" in a filter
    // is any opponent, CR 102.2)
    if (z && f.owner === 'opponent' && typeof f.zone === 'string') return alt(text, z, `all opponents' ${PLURAL_ZONE[f.zone] ?? `${f.zone}s`}`);
    if (z) return alt(text, z);
    return text;
  }
  return K.obj(what, st, 'object').text;
}

export const MOVE_VERB: Record<string, string> = {
  battlefield: alt('put', 'return'),
  hand: alt('return', 'put'),
  graveyard: 'put',
  library: alt('put', 'return'),
  exile: 'exile',
  stack: 'put',
  command: 'put',
};

/**
 * "If that spell is countered this way, exile it instead of putting it into its owner's graveyard" (CR 701.6a, 608.2c, 614.15): where a countered spell goes when
 * it is not the graveyard. FAST5 T56: also the sentence after `Counter target spell unless its controller pays {3}.` (steps-flow.ts, the "unless" form).
 */
export function counterTail(s: StepOf<'counter'>, st: RenderState): string {
  const d = s.to!;
  const info = infoOfRef(s.what, st);
  // std-rx30 (CR 701.6a, 614.15): "if a permanent spell is countered this way" names the kind of spell `to` is for
  const subj = s.toIf !== undefined ? K.np({ ...s.toIf, isCard: undefined }, st, { det: 'a' }) : anaphor(info, 'subject').text;
  const obj = anaphor(info, 'object').text;
  const instead = alt("that player's", "its owner's", "their owner's");
  let then: string;
  if (d.zone === 'exile') then = `exile ${obj} instead of putting ${obj} into ${alt("its owner's", "that player's")} graveyard`;
  else then = `${MOVE_VERB[d.zone]} ${obj} ${destPhrase(d, st, info.plural)} instead of into ${instead} graveyard`;
  return `if ${subj} is countered this way, ${then}`;
}

/** "return" for a card coming back from a graveyard or from exile, "put" for one that comes from a hand or a library; both read the same to the model. */
function moveVerb(what: ObjRef, zone: Destination['zone'], st: RenderState): string {
  const f = what.ref === 'each' ? what.filter : what.ref === 'target' ? st.specs.get(what.id)?.filter : undefined;
  const bound = what.ref === 'bound' ? st.info.get(`b:${what.name}`)?.zone : undefined;
  const zs = bound !== undefined ? [bound] : f?.zone === undefined ? [] : [f.zone].flat();
  // a card that comes out of a library or a hand is "put" into a hand (or onto the battlefield); one that comes back from the battlefield, a graveyard or exile is "returned"
  if (zone === 'hand') return zs.length > 0 && zs.every((z) => z === 'library' || z === 'hand') ? alt('put', 'return') : MOVE_VERB.hand!;
  if (zone !== 'battlefield') return MOVE_VERB[zone]!;
  const back = what.ref === 'linked' || zs.some((z) => z === 'graveyard' || z === 'exile');
  return back ? alt('return', 'put') : alt('put', 'return');
}

/** `pre`: a word said before the token's description, "a tapped Treasure token" (FAST1 T6; CR 111.1, 110.5b). */
export function tokenText(t: TokenDef, count: number | string, plural: boolean, st: RenderState, pre = ''): string {
  const countWord = typeof count === 'number' ? (count === 1 ? '' : numWord(count)) : count;
  // FAST5 T48 (CR 111.4): a token a card names and defines in its own reminder text (model/named-tokens.ts) is said by its name, as a predefined one is (CR 111.10)
  const ownName = namedTokenOf(t);
  if (t.predefined || ownName !== undefined) {
    const noun = `${pre === '' ? '' : `${pre} `}${t.predefined ?? ownName} token`;
    return plural ? `${countWord} ${pluralize(noun)}`.trim() : withArticle(noun);
  }
  const pt = t.power !== undefined && t.toughness !== undefined ? `${typeof t.power === 'number' ? t.power : K.qty(t.power, st)}/${typeof t.toughness === 'number' ? t.toughness : K.qty(t.toughness, st)}` : '';
  const colors = t.colors && t.colors.length > 0 ? joinList(t.colors.map((c) => COLOR_WORD[c] ?? c)) : t.types?.includes('Artifact') || t.types?.includes('Creature') ? 'colorless' : '';
  const supers = (t.supertypes ?? []).map((x) => x.toLowerCase());
  const subs = t.subtypes ?? [];
  const types = (t.types ?? []).map((x) => x.toLowerCase());
  const named = t.name !== undefined && !(subs.length > 0 && subs.join(' ') === t.name) ? ` named ${t.name}` : '';
  // cloud std-dsk (CR 111.4, 205.3i, 305.6): "a tapped colorless land token named Everywhere that is every basic land type" (parser/holes/token.ts): the five basic
  // land types follow the name; "colorless" is said as the parser read it (an explicit empty color list)
  const types1 = t.types ?? [];
  if (named !== '' && types1.length === 1 && types1[0] === 'Land' && subs.join(' ') === 'Plains Island Swamp Mountain Forest' && (t.supertypes ?? []).length === 0
    && t.power === undefined && (t.keywords ?? []).length === 0 && (t.abilities ?? []).length === 0) {
    const colorWord = t.colors === undefined ? '' : t.colors.length === 0 ? 'colorless' : joinList(t.colors.map((c) => COLOR_WORD[c] ?? c));
    const core = [pre, colorWord, 'land'].filter((x) => x !== '').join(' ');
    return `${plural ? countWord : article(core)} ${core} ${plural ? 'tokens' : 'token'}${named} that ${plural ? 'are' : 'is'} every basic land type`.replace(/\s+/g, ' ').trim();
  }
  // (r5-mech's "... named Reliquary Dragon that is all colors" is r5-fxb's family token-all-colors below since merge wave 8)
  // T55 (CR 205.4, Oracle): "legendary" comes before the power and toughness, "a legendary 3/3 green Dog creature token"; any other supertype after the
  // colors, "a colorless snow artifact token"
  const legendary = supers.filter((x) => x === 'legendary');
  const core = [pre, ...legendary, pt, colors, ...supers.filter((x) => x !== 'legendary'), ...subs, ...types].filter((x) => x !== '').join(' ');
  const noun = plural ? 'tokens' : 'token';
  const tail = tokenAbilityWords(t, st);
  const lead = plural ? countWord : article(core);
  const nameFirst = `${lead} ${core} ${noun}${named}${tail}`.replace(/\s+/g, ' ').trim();
  // std-hob (CR 111.4): a token with plain keywords only may also be named after them, "token with defender named Stone Boulder" (the parser reads that order only
  // after plain keywords, parser/holes/token.ts)
  const kwOnly = named !== '' && (t.abilities ?? []).length === 0 && (t.keywords ?? []).length > 0;
  let sentence = kwOnly ? alt(nameFirst, `${lead} ${core} ${noun}${tail}${named}`.replace(/\s+/g, ' ').trim()) : nameFirst;
  // r5-fxb (family token-all-colors, CR 105.2): a token of all five colors is also "a 2/2 Elemental creature token that's all colors" (after its name and abilities)
  if ((['W', 'U', 'B', 'R', 'G'] as const).every((c) => t.colors?.includes(c)) && t.colors!.length === 5 && !kwOnly) {
    const coreNoColor = [pre, ...legendary, pt, ...supers.filter((x) => x !== 'legendary'), ...subs, ...types].filter((x) => x !== '').join(' ');
    sentence = alt(sentence, `${plural ? countWord : article(coreNoColor)} ${coreNoColor} ${noun}${named}${tail} that ${plural ? 'are' : 'is'} all colors`.replace(/\s+/g, ' ').trim());
  }
  // T55 (CR 111.4, 205.4a): a single named token is also said with its name first, "create Mowu, a legendary 3/3 green Dog creature token" (Oracle's wording
  // for most named tokens that have a name of their own); the name is a characteristic of the token, never a self reference of the card (CR 201.2)
  if (!plural && named !== '' && pre === '' && typeof count === 'number' && count === 1) {
    const first = `${t.name}, ${lead} ${core} ${noun}${tail}`.replace(/\s+/g, ' ').trim();
    return alt(sentence, first);
  }
  return sentence;
}

/**
 * What follows "token" in a token's description: " with flying", " with flying and \"This token can block only creatures with flying.\"", " with crew 1",
 * " with \"Equipped creature gets +1/+0\" and equip {2}" (T55). The plain keywords come first, then the abilities in the order they were written; a keyword
 * ability is said as a word (the keyword with its parameters), any other ability in quotes (FXC audit m2: a token's own quoted ability calls it "this
 * token", or by its name when it has one, never by the card's name, render/quote.ts). Several quoted abilities with other items have no wording here.
 */
function tokenAbilityWords(t: TokenDef, st: RenderState): string {
  const abilities = t.abilities ?? [];
  const keywords = t.keywords ?? [];
  if (keywords.length === 0 && abilities.length === 0) return '';
  const quoted = abilities.filter((a) => a.kind !== 'keyword');
  // std-mana-1 (CR 111.4, FAST5 T41 quotedListItem): two quoted abilities, `with "A" and "B."`: the first has no full stop of its own (Oracle prints 45 such lists and
  // none with a full stop inside the first quote, Roxanne, Starfall Savant's Meteorite among them)
  if (keywords.length === 0 && quoted.length === 2) return ` with ${quotedListItem(quotedAbility(abilities[0]!, st, 'token', t), 'none')} and ${quotedAbility(abilities[1]!, st, 'token', t)}`;
  if (keywords.length === 0 && quoted.length === abilities.length) return ` with ${abilities.map((a) => quotedAbility(a, st, 'token', t)).join(' and ')}`;
  if (quoted.length > 1) throw new NoRenderer('a token with several quoted abilities beside keywords');
  const items = [
    ...keywords.map((k) => ({ text: k, quoted: false })),
    ...abilities.map((a) => (a.kind === 'keyword' ? { text: keywordWords(a as never, st), quoted: false } : { text: quotedAbility(a, st, 'token', t), quoted: true })),
  ];
  const last = items.length - 1;
  const bits = items.map((it, i) => (!it.quoted || i === last ? it.text : quotedListItem(it.text, items.length >= 3 ? 'comma' : 'none')));
  return ` with ${joinList(bits)}`;
}

/**
 * FAST3 T14: "target opponent exiles the top card of their library" exiles the top card of that player's library: who performs the move changes nothing
 * (CR 406.1, 401.2), so the instruction may name the library's owner as its subject. Only a plain move of a player's top cards to exile (face up, or std-rs:
 * face down, CR 406.3), for a player other than you; null otherwise.
 */
function topCardsExiledBy(s: StepOf<'move'>, st: RenderState): { text: string; pred: string; actor: string } | null {
  const w = s.what;
  // (r5-refs: a move that records what it exiled for a linked ability, CR 607.2a, says the same words: "that player exiles the top card of their library")
  // std-rs (CR 406.3): also face down, "target opponent exiles the top X cards of their library face down"
  if (w.ref !== 'topCards' || s.to.zone !== 'exile' || s.until !== undefined || playerKey(w.player) === 'you') return null;
  const down = s.to.faceDown === true ? ' face down' : '';
  const subj = K.player(w.player, st, 'subject');
  if (subj.person !== 'sg') return null;
  const n = w.count;
  const cards = typeof n === 'number' && n === 1 ? 'card' : `${typeof n === 'number' ? numWord(n) : K.qty(n, st)} cards`;
  // FAST4 T26: also the verb phrase and the player, so the same player's instructions before it may share the subject (render/steps.ts#joined)
  // r4-dig (CR 107.3, 608.2h): a computed number is also "target player exiles the top X cards of their library, where X is ..." (Ashiok's -7)
  const computed = typeof n === 'object' && n.q !== 'X' && n.q !== 'var' && n.q !== 'eventAmount' && n.q !== 'resultCount';
  const flat = `exiles the top ${cards} of their library${down}`;
  const pred = computed ? alt(flat, `exiles the top X cards of their library${down}, where X is ${K.qty(n, cloneState(st))}`) : flat;
  return { text: `${subj.text} ${pred}`, pred, actor: playerKey(w.player) ?? 'x' };
}

/** FAST5X E24: the moved object is the object itself: "~", or the trigger event's object when that is the source (rebased "~" after it died, CR 400.7e). */
function isItself(what: ObjRef, st: RenderState): boolean {
  return what.ref === 'self' || (what.ref === 'event' && roleInfo(what.role, st).isSelf === true) || movedItself(what, st);
}

/**
 * Cloud std-eoe (CR 608.2c, 400.7; the parser's parser/holes/filter.ts#PUT_INTO_GRAVEYARD_THIS_WAY): the cards a destroy or sacrifice of a group put into graveyards are
 * "a creature card put into a graveyard this way" (render/np.ts says the zone and its owner with the participle).
 */
function putIntoGraveyardThisWay(s: StepOf<'destroy'> | StepOf<'sacrifice'>, st: RenderState): void {
  if (s.as !== undefined && s.what.ref === 'each') st.info.set(`b:${s.as}`, { nouns: ['card'], plural: true, thisWay: PUT_INTO_GRAVEYARD_THIS_WAY });
}

/**
 * std-rw9 (CR 701.8a, 400.7, 608.2c): what a destroy of one identified object put into a graveyard is that card, named as the object was ("Destroy target creature. If a
 * creature card is put into a graveyard this way, return it to the battlefield under your control.": the parser binds "it" to the destroy's `as`), so it is still "it" and
 * comes back ("return") from the graveyard.
 */
function destroyedOne(s: StepOf<'destroy'>, st: RenderState): void {
  if (s.as === undefined || s.what.ref === 'each') return;
  const key = objKey(s.what);
  if (key === null || key === 'subject') return;
  const before = infoOfRef(s.what, st);
  bind(st, s.as, { nouns: [...new Set(['card', ...before.nouns])], plural: before.plural, zone: 'graveyard', sameAs: identityOf(st, key) });
}

/**
 * FAST5 T45 (CR 707.10c): the words after a spell copy that lets its controller choose new targets: "copy that spell. You may choose new targets for the copy." and
 * "copy that spell and you may choose new targets for the copy" (family joiner); '' when the copy has no new targets. Standard round 3, r3-trig: shared with
 * render/steps.ts#clause, which says a guard before these words ("copy it if you gained life this turn. You may choose new targets for the copy.").
 */
export function copyNewTargets(s: StepOf<'copy'>): string {
  const copies = s.count === undefined || s.count === 1 ? alt('the copy', 'that copy', 'each copy') : alt('the copies', 'those copies', 'each copy');
  // FAST5 T45: "copy that spell. You may choose new targets for the copy." and "copy that spell and you may choose new targets for the copy" (family joiner)
  // r3-copy (CR 707.10c, 608.2c; family copy-if-you-do-new-targets): "you may copy it. If you do, you may choose new targets for the copy." (Spider-Verse)
  if (!(s.newTargets === true || s.newTargets === 'may')) return '';
  // p2-copy-spell-1 (CR 707.10c, 115.7; family copy-and-may-choose-new-target): the player who copies the spell chooses its new targets, said with the copy: "that
  // player may copy this spell and may choose a new target for that copy" (Chain of Smog), "you may copy this spell and may choose a new target for the copy"
  // (Sevinne's Reclamation); "a new target" is said of one copy only. A copy another player makes is never "you may choose" (that player chooses, CR 707.10c)
  const one = s.count === undefined || s.count === 1;
  // p2-copy-spell-3: or the copier named again in a sentence of its own, "That player may choose new targets for the copy." (Meletis Charlatan)
  const andMay = alt(` and may choose new targets for ${copies}`, ...(one ? [` and may choose a new target for ${copies}`] : []), ...(s.who.ref !== 'you' ? [`. that player may choose new targets for ${copies}`] : []));
  if (s.who.ref !== 'you') return andMay;
  return alt(`. you may choose new targets for ${copies}`, ` and you may choose new targets for ${copies}`, `. if you do, you may choose new targets for ${copies}`, andMay);
}

/**
 * std-copy-1 (CR 707.10, 611.2a, 400.7a): the abilities a spell copy gains, as the sentence after the copy says them: "the copy gains haste and "At the beginning of the
 * end step, sacrifice this token."" or "if the copy is a permanent spell, it gains haste" (types/ability.ts, `copy.gains`). One copy only.
 */
function copyGains(s: StepOf<'copy'>, st: RenderState): string {
  if (s.gains === undefined) return '';
  if (!(s.count === undefined || s.count === 1) || s.result !== 'spell') throw new NoRenderer('abilities gained by several copies, or by a token copy');
  const list = abilityList(s.gains.add, cloneState(st), 'token');
  return s.gains.ifPermanent === true ? `. if the copy is a permanent spell, it gains ${list}` : `. the copy gains ${list}`;
}

/** r3-fx (CR 201.5, 400.7): what an earlier instruction of the ability did to the object itself moved it, and the binding names that card ("Exile ~, then return ~ ..."). */
const movedItself = (what: ObjRef, st: RenderState): boolean => what.ref === 'bound' && identityOf(st, `b:${what.name}`) === 'self';

export const CLAUSES_ZONES = {
  move: (s: StepOf<'move'>, st: RenderState): Clause => {
    // FAST5X E13: `remember` is written by the craft keyword's expansion only (CR 702.167c); a parsed sentence never carries it, so it is refused, never dropped
    if (s.remember !== undefined) throw new NoRenderer('a move whose permanents remember other objects (craft, CR 702.167c)');
    // r5-moved (CR 701.25a, 608.2c, 400.7; template eff.r5moved.surveil.putThisWay.hand): "If you put a land card into your graveyard this way, put that card into your hand"
    const surveilled = surveilledToHand(s, st);
    if (surveilled !== null) return plain(surveilled, { standalone: true });
    // trek-7 (CR 401.4, 406.1, 400.3; The Borg Queen): "They put the rest on the bottom in a random order." after another player's "exiles cards from the top of their library
    // until they exile ...": the cards that exile left in exile (the group `exiled` less the card it stopped at) go to the bottom of THEIR owner's library, the player who
    // exiled them being the one who puts them; no "of their library" in Oracle's words. Another player's only (yours is the plain move below)
    const restOfOthers = exiledRestOfOtherPlayer(s, st);
    if (restOfOthers !== null) return byPlayer(restOfOthers, st, 'put', 'the rest on the bottom in a random order', { standalone: true });
    // r5-moved (CR 608.2c, 400.7, 110.2a; template eff.r5moved.eachPlayer.returnsAll.notPutThere): "each player returns all creature cards from their graveyard that weren't put
    // there this way to the battlefield" (Bringer of the Last Gift)
    const notPut = notPutThereReturn(s, st);
    if (notPut !== null) return plain(notPut, { standalone: true, leadThen: true });
    const top = topCardsExiledBy(s, cloneState(st)); // read before the library's owner is mentioned by the other reading
    const before = cloneState(st); // FAST5 T42: the state before the object is named, for a reading that names it differently
    // r3-fx (family self-by-name-after-move): the object itself after a move of the same ability is also named again, "Exile ~, then return ~ to the battlefield
    // transformed under ~'s owner's control" (a character card's "return her"): the card the move put into exile, CR 400.7
    const named = movedThing(s.what, st);
    const thing = movedItself(s.what, st) ? alt(named, '~') : named;
    // FAST1 T4 (CR 113.6m, 404.1): in an ability that functions only in its owner's graveyard, the object itself is a card in that graveyard
    // r4-fxz (CR 113.6m): ... and in one that functions only in its owner's hand, a card in that hand ("Put ~ from your hand onto the battlefield")
    const what = s.what.ref === 'self' && st.selfZone !== undefined && s.to.zone !== st.selfZone ? alt(thing, `${thing} from your ${st.selfZone}`) : thing;
    const plural = infoOfRef(s.what, st).plural;
    const d = s.to;
    const verb = moveVerb(s.what, d.zone, st);
    let text: string;
    if (d.zone === 'exile') {
      // std-rx27: "with a stash counter on it": a group narrowed to what a reference names ("it from their graveyard") is as many as that reference
      const is = s.what.ref === 'each' ? s.what.filter.is : undefined;
      text = `exile ${what}${d.faceDown ? ' face down' : ''}${exileCounters(d, is !== undefined ? infoOfRef(is, st).plural : plural)}`;
    }
    else text = `${verb} ${what} ${destPhrase(d, st, plural, false, firstAlt(verb) === 'return', isItself(s.what, st))}`;
    // std-rx30 (CR 400.3, 401.3): an object's owner who moves it says "their library" ("Its owner may put it on top of their library", Clash of Elements): a card
    // goes to its owner's library, and the owner is the one acting
    const moved = objKey(s.what);
    if (d.zone === 'library' && d.owner === undefined && !plural && moved !== null && st.actor === `own:${moved}`) {
      text = alt(text, `${verb} ${what} ${destPhrase({ ...d, owner: { ref: 'ownerOf', object: s.what } }, st, plural, false, firstAlt(verb) === 'return')}`.replace(/(on top of|on the bottom of|into) [^ ]+ owner's library/, '$1 their library'));
    }
    // std-rx31 (CR 400.7, 122.6; family return-under-your-control; owner decision on Meathook Massacre II): "return that card under your control with a finality counter
    // on it" names no zone; it is read as a return to the battlefield under your control (the only zone a card has a controller in, CR 110.2a) with that counter
    // (the parser's eff.stdrx31.return.underYourControl.withCounter). Only one counter of one kind, nothing else about how it enters
    const one = d.counters?.length === 1 ? d.counters[0]! : undefined;
    if (d.zone === 'battlefield' && JSON.stringify(d.controller) === JSON.stringify({ ref: 'you' }) && one !== undefined && one.count === 1 && typeof one.kind === 'string'
      && Object.keys(d).length === 3 && s.what.ref !== 'self') {
      text = alt(text, `return ${what} under your control with ${withArticle(`${one.kind} counter`)} on it`);
    }
    // r5-moved (template eff.r5moved.exile.allTheCardsFromHand; CR 406.1, 402.1): "exile all the cards from your hand" is "exile all cards from your hand" (Hex Magic)
    if (d.zone === 'exile' && d.faceDown !== true && s.what.ref === 'each' && JSON.stringify(s.what.filter) === JSON.stringify({ zone: 'hand', owner: 'you', isCard: true })) text = alt(text, 'exile all the cards from your hand');
    // FAST5 T59 (CR 607.2a, 400.3): the cards a linked exile instruction exiled go to their owners' hands, "put each card exiled with it into its owner's hand"
    if (s.what.ref === 'linked' && s.what.link === 'exiled' && d.zone === 'hand' && d.owner === undefined && s.until === undefined) {
      text = alt(text, "put each card exiled with it into its owner's hand", "put each card exiled with ~ into its owner's hand");
      // r5-moved (CR 607.2a, 400.3): the same cards named as the plural participle of the linked instruction, "return the exiled cards to their owners' hands"
      // (template eff.r5moved.linked.return.hands; the singular "return the exiled card to its owner's hand" is fl.linked.returnHand's reading of the same move);
      // std-r9b: and as "put all cards exiled with ~ into their owners' hands" (template eff.stdr9b.linked.putAll.hands)
      text = alt(text, "return the exiled cards to their owners' hands", "put all cards exiled with ~ into their owners' hands");
    }
    // p2-refs-1 (CR 607.2a, 110.2; family linked-exiled-battlefield-plural): the cards a linked exile instruction exiled, returned to the battlefield under their owners'
    // control, are also the plural participle of the linked ability, "return the exiled cards to the battlefield [tapped] under their owner's / owners' control"
    if (s.what.ref === 'linked' && s.what.link === 'exiled' && d.zone === 'battlefield' && d.controller === 'owner' && s.until === undefined
      && Object.keys(d).every((k) => k === 'zone' || k === 'controller' || (k === 'tapped' && d.tapped === true))) {
      const tapped = d.tapped === true ? ' tapped' : '';
      text = alt(text, `return the exiled cards to the battlefield${tapped} under their owners' control`, `return the exiled cards to the battlefield${tapped} under their owner's control`);
    }
    // r4-moved (CR 607.2a, 400.3): ... and into their owners' graveyards, "Put each card exiled with this artifact into its owner's graveyard" (zz-cloud/r4-moved.json)
    if (s.what.ref === 'linked' && s.what.link === 'exiled' && d.zone === 'graveyard' && d.owner === undefined && s.until === undefined) {
      text = alt(text, "put each card exiled with it into its owner's graveyard", "put each card exiled with ~ into its owner's graveyard");
    }
    // FAST5 T42 (CR 400.7, 110.2): Oracle also says "return to the battlefield target nonland permanent card in your graveyard ..." (Squirming Emergence): the
    // destination first, for a plain return of something else onto the battlefield under your control
    // p2-graveyard-1 (CR 400.7, 110.2, 400.3): and a group ("Return to the battlefield all permanent cards in your graveyard that were put there from the battlefield this
    // turn", Faith's Reward), and to your hand a target or group of cards you own ("Return to your hand all creature cards in your graveyard that ...", No Rest for
    // the Wicked): a card goes to its owner's hand, so "your hand" only for cards of yours (family return-to-zone-first)
    const leadPlain = !d.tapped && !d.attacking && !d.faceDown && !d.transformed && d.attachedTo === undefined && (d.counters ?? []).length === 0 && s.until === undefined;
    const ownedByYou = s.what.ref === 'each' ? s.what.filter.owner === 'you' : s.what.ref === 'target' && st.specs.get(s.what.id)?.filter?.owner === 'you';
    const lead = d.zone === 'battlefield' && (s.what.ref === 'target' || (s.what.ref === 'each' && leadPlain)) && !d.tapped && !d.attacking && !d.faceDown && !d.transformed && d.attachedTo === undefined && (d.counters ?? []).length === 0 && d.controller !== 'owner' ? 'the battlefield'
      : d.zone === 'hand' && d.owner === undefined && leadPlain && ownedByYou ? 'your hand' : undefined;
    if (lead !== undefined) {
      text = alt(text, `return to ${lead} ${what}`);
    }
    // r5-fxz (CR 110.2a): a group put onto the battlefield under your control is also said destination first, "Put onto the battlefield under your control all
    // creature cards in your opponents' graveyards that were put there from the battlefield this turn." (Supper for Spiders)
    if (d.zone === 'battlefield' && s.what.ref === 'each' && typeof d.controller === 'object' && d.controller.ref === 'you' && !d.tapped && !d.attacking && !d.faceDown && !d.transformed
      && d.attachedTo === undefined && (d.counters ?? []).length === 0 && s.until === undefined) {
      text = alt(text, `put onto the battlefield under your control ${what}`);
    }
    // CLOUD std-tmt (CR 508.4, 608.2c; family enters-attacking-rider): an object put onto the battlefield tapped and attacking a named player is also said in a
    // sentence of its own after the move, "Put ... onto the battlefield under your control. It enters tapped and attacking that player." (parser rider
    // rid.stdtmt.enters.tapped.attacking.player)
    if (d.zone === 'battlefield' && d.tapped === true && typeof d.attacking === 'object' && 'defender' in d.attacking && !d.faceDown && !d.transformed && d.attachedTo === undefined && (d.counters ?? []).length === 0) {
      const plain: Destination = { ...d, tapped: undefined, attacking: undefined };
      const enters = `${plural ? 'they enter' : 'it enters'} tapped and attacking ${K.player(d.attacking.defender, st, 'object').text}`;
      text = alt(text, `${verb} ${what} ${destPhrase(plain, st, plural, false, firstAlt(verb) === 'return', isItself(s.what, st))}. ${enters}`);
    }
    // FAST5 T42 (CR 107.3, 608.2h): a mana value the target's description computes is also "mana value X or less ..., where X is the amount of mana spent to cast ~"
    // (Astelli Reclaimer): the X said in the description, its value after the sentence (as family discard-where-x)
    const spec = s.what.ref === 'target' ? st.specs.get(s.what.id) : undefined;
    const mv = spec?.filter?.manaValue;
    if (spec && mv && typeof mv.value === 'object' && mv.value.q !== 'X' && (mv.op === '<=' || mv.op === '>=') && !s.until && d.zone !== 'exile') {
      const copy = cloneState(before);
      copy.specs.set(spec.id, { ...spec, filter: { ...spec.filter, manaValue: { op: mv.op, value: { q: 'X' } } } });
      const withX = `${verb} ${movedThing(s.what, copy)} ${destPhrase(d, copy, plural, false, firstAlt(verb) === 'return')}, where X is ${K.qty(mv.value, copy)}`;
      text = alt(text, withX);
    }
    // pc-players-1 (CR 107.3, 608.2h): the same for a group (Spectral Deluge: "Return each creature your opponents control with toughness X or less to its owner's hand,
    // where X is the number of Islands you control"): a power, toughness or mana value the group's description computes, said X in the description (family move-where-x)
    if (s.what.ref === 'each' && !s.until && d.zone !== 'exile') {
      for (const key of ['manaValue', 'power', 'toughness'] as const) {
        const cmp = s.what.filter[key];
        if (cmp === undefined || typeof cmp.value !== 'object' || cmp.value.q === 'X' || (cmp.op !== '<=' && cmp.op !== '>=')) continue;
        const copy = cloneState(before);
        const withX = `${verb} ${movedThing({ ...s.what, filter: { ...s.what.filter, [key]: { op: cmp.op, value: { q: 'X' } } } }, copy)} ${destPhrase(d, copy, plural, false, firstAlt(verb) === 'return')}, where X is ${K.qty(cmp.value, copy)}`;
        text = alt(text, withX);
      }
    }
    // FAST5 T43 (CR 401.4): "Put the rest on the bottom in a random order": the cards left of a group looked at are in the library already, so Oracle may leave "of your library" out
    if (s.what.ref === 'each' && restOfGroup(s.what.filter) !== null && d.zone === 'library' && d.position === 'bottom' && d.owner === undefined) {
      text = alt(text, `${verb} ${what} on the bottom${d.order === 'random' ? ' in a random order' : d.order === 'chosen' ? ' in any order' : ''}`);
    }
    // FAST5 T52 (CR 107.3, 608.2h, 205.2a): "exile the top X cards of your library, where X is the number of card types among other nonland permanents you
    // control": a count of distinct qualities is said as X (render/steps-cards.ts#draw does the same for draw)
    if (s.what.ref === 'topCards' && typeof s.what.count === 'object' && s.what.count.q === 'distinct' && d.zone === 'exile' && d.faceDown !== true) {
      const owner = K.player(s.what.player, st, 'possessive').text;
      text = alt(text, `exile the top X cards of ${owner} library, where X is ${K.qty(s.what.count, cloneState(st))}`);
    }
    // LNK1 (the parser's rule, parser/lower/mentions.ts#ownerNamed): "to its owner's hand" names that owner, "that player" later in the ability (CR 400.3)
    const k = objKey(s.what);
    if (!plural && k !== null && (d.zone === 'hand' || d.zone === 'library' || d.zone === 'graveyard') && d.owner === undefined) {
      // (known only, with no antecedent info: as before, it is no competitor of another player's pronoun)
      st.mentioned.add(`own:${k}`);
    }
    if (s.until) text += ` ${K.dur(s.until, st)}`;
    // FAST5 T66 (CR 115.1, 601.2c): the sentence of a target for each opponent starts "for each opponent," (r5-fxb: render/steps.ts#clause says it,
    // with r5-refs's "for each other player," since merge wave 8)
    // std-rx31 (family not-put-the-card): a named move of the one card a choice revealed, "the revealed card" (render/fold-stdrx31.ts#revealOneFromGroup)
    if (s.as !== undefined && s.what.ref === 'bound' && !st.info.has(`r:${s.as}`) && (st.info.get(`b:${s.what.name}`)?.alts ?? []).includes('the revealed card')) {
      st.info.set(`r:${s.as}`, { nouns: ['card'], plural: false, revealedPut: true });
    }
    bindMoved(s, st);
    // std-lci (CR 608.2c, 400.7): what the move exiled is also "<noun> exiled this way" (render/np.ts reads RefInfo.thisWay of the binding)
    if (s.as !== undefined && d.zone === 'exile') {
      const prev = st.info.get(`b:${s.as}`);
      st.info.set(`b:${s.as}`, { ...(prev ?? { nouns: ['card'], plural: true }), thisWay: 'exiled this way' });
    }
    // FAST5 T74 (CR 608.2c, 608.2h): "Exile all attacking creatures target player controls. That player may search their library for that many basic land cards": the
    // cards a group exile exiled are counted by a later "that many" (resultCount; the handler counts the cards it exiled)
    if (s.as !== undefined && s.what.ref === 'each' && d.zone === 'exile') st.info.set(`r:${s.as}`, { nouns: infoOfRef(s.what, st).nouns, plural: true, thisWay: 'exiled this way' });
    // Cloud C7 (CR 608.2c, 608.2h): every named move reports what it put into its destination: "for each card exiled this way", "if you put an artifact onto the
    // battlefield this way" (render/moved.ts reads the kind)
    const movedKind = d.zone === 'exile' ? 'exiled' : d.zone === 'graveyard' ? 'graveyard' : d.zone === 'battlefield' ? 'battlefield' : d.zone === 'hand' ? 'hand' : undefined;
    if (s.as !== undefined && movedKind !== undefined && s.until === undefined) st.info.set(`r:${s.as}`, { ...(st.info.get(`r:${s.as}`) ?? movedInfo(movedKind, infoOfRef(s.what, st).nouns)), moved: movedKind });
    // std-rh (CR 608.2c; Genesis Wave): the sentence that puts the rest of a group looked at somewhere after "you may put ... from among them onto the battlefield" may
    // begin with "Then" ("then" only orders the instructions)
    // edh-zones-1 (CR 110.2a, 608.2c; family player-puts-onto-battlefield): what another player puts onto the battlefield is theirs to control, so "they put it onto the
    // battlefield" (Chaos Warp: "If it's a permanent card, they put it onto the battlefield") says the move whose controller is that player; the reading with the
    // control said ("put it onto the battlefield under their control") stays. Only a plain object put onto the battlefield, nothing about how it enters
    if (top === null && d.zone === 'battlefield' && typeof d.controller === 'object' && d.controller.ref !== 'you' && st.actor === null && s.until === undefined
      && s.what.ref === 'bound' && Object.keys(d).length === 2) {
      const by = byPlayer(d.controller, st, 'put', () => `${what} onto the battlefield`);
      return plain(alt(text, by.sub));
    }
    if (top === null) return plain(text, s.what.ref === 'each' && restOfGroup(s.what.filter) !== null ? { leadThen: true } : {});
    // FAST4 T26: "each opponent discards a card, loses 2 life, and exiles the top three cards of their library": the library's owner is the clause's actor
    // (both forms say the same, CR 406.1, 401.2)
    const both = alt(text, top.text);
    return { imp: both, sub: both, actor: top.actor, pred: top.pred };
  },

  destroy: (s: StepOf<'destroy'>, st: RenderState): Clause => {
    // r5-moved (CR 608.2c, 120.3; template eff.r5moved.dealtThisWay.destroyIt): "If a Dragon is dealt damage this way, destroy it": the objects of a description among
    // what the damage step right before dealt damage to (render/steps-life.ts names them "dealt damage this way"); read before the reference is mentioned
    const dealt = dealtThisWayOne(s.what, cloneState(st));
    const what = permanentRef(s.what, st);
    // std-tdm (CR 701.8a, 608.2c): what the step destroyed, counted by a later "for each permanent destroyed this way" (resultCount, render/qty.ts#countParts): said
    // "permanent", or by the one card type of a step that destroys objects of that type only (the nouns the parser accepts, parser/lower/quantities.ts#destroyedNounFits)
    if (s.as !== undefined) st.info.set(`r:${s.as}`, { nouns: destroyedNouns(s.what, st), plural: true, thisWay: 'destroyed this way', moved: 'destroyed' }); // Cloud C7: `moved` (render/moved.ts)
    putIntoGraveyardThisWay(s, st); // Cloud std-eoe: "a creature card put into a graveyard this way" (render/np.ts)
    destroyedOne(s, st);
    if (dealt !== null && s.regeneration === undefined) return plain(alt(`destroy ${what}`, `if ${dealt} is dealt damage this way, destroy it`), { standalone: true });
    if (s.regeneration !== 'cant') return plain(forEachOpponent(s.what, `destroy ${what}`, st));
    return plain(`destroy ${what}. ${noRegeneration(s, st)}`, { standalone: true });
  },

  // WP21 review (INTERFACE CHANGE of this WP2 file): the step names no player and its handler sacrifices for the controller of the ability (CR 701.21a: a
  // player sacrifices only what they control), so the clause is the controller's: inside another player's `may` it prints "you sacrifice it" and the
  // gate refuses "Its controller may sacrifice it" instead of automating a sacrifice that never happens.
  sacrifice: (s: StepOf<'sacrifice'>, st: RenderState): Clause => {
    const c = byPlayer({ ref: 'you' }, st, 'sacrifice', () => permanentRef(s.what, st, true));
    if (s.as !== undefined) st.info.set(`r:${s.as}`, movedInfo('sacrificed', infoOfRef(s.what, st).nouns)); // Cloud C7: "for each creature sacrificed this way"
    putIntoGraveyardThisWay(s, st);
    return c;
  },

  sacrificeChoice: (s: StepOf<'sacrificeChoice'>, st: RenderState): Clause => {
    // FAST5 T66 (CR 110.4, 701.21a): "each opponent chooses a permanent they control of each permanent type and sacrifices the rest": one permanent of each type kept, among
    // every permanent the players control (no description of the permanents)
    if (s.mode === 'keepEachType') {
      // pc-players-1 (CR 110.4, 205.2a, 701.21a): the four types of Cataclysmic Gearhulk and Tragic Arrogance (artifact, creature, enchantment, planeswalker), nonland permanents sacrificed
      const FOUR = ['Artifact', 'Creature', 'Enchantment', 'Planeswalker'];
      const nonland = JSON.stringify(s.filter) === JSON.stringify({ notTypes: ['Land'] });
      const four = JSON.stringify(s.keepTypes) === JSON.stringify(FOUR) && s.count === 1 && nonland;
      if (four && s.who.ref === 'each' && s.who.who === 'player' && s.chooser === undefined && s.keepFilter === undefined) {
        return acting(playerKey(s.who) ?? 'x', 'choose an artifact, a creature, an enchantment, and a planeswalker from among the nonland permanents you control and sacrifice the rest',
          'each player chooses an artifact, a creature, an enchantment, and a planeswalker from among the nonland permanents they control, then sacrifices the rest');
      }
      if (four && s.who.ref === 'each' && s.who.who === 'player' && s.chooser?.ref === 'you' && s.keepFilter !== undefined && JSON.stringify(s.keepFilter) === '{}') {
        return plain(`for each player, you choose from among the permanents that player controls an artifact, a creature, an enchantment, and a planeswalker. ${alt('then ', '')}each player sacrifices all other nonland permanents they control`, { standalone: true });
      }
      if (s.keepTypes !== undefined || s.keepFilter !== undefined || s.chooser !== undefined) throw new NoRenderer('a sacrifice that keeps permanents of some types other than the four types of Cataclysmic Gearhulk and Tragic Arrogance');
      const who = s.who;
      if (who.ref !== 'each' || (who.who !== 'opponent' && who.who !== 'player') || s.count !== 1 || Object.values(s.filter).some((v) => v !== undefined)) throw new NoRenderer('a sacrifice that keeps one permanent of each type other than for each opponent or each player');
      const subj = K.player(who, st, 'subject').text;
      return acting(playerKey(who) ?? 'x', 'choose a permanent you control of each permanent type and sacrifice the rest', `${subj} chooses a permanent they control of each permanent type and sacrifices the rest`);
    }
    // CLOUD std-fdn (CR 701.21a, 608.2c, 400.7): what was sacrificed, named by `as` ("You gain life equal to that creature's toughness"; parser/lower/mentions.ts):
    // one object only when one player sacrifices one, and a card in the graveyard now
    if (s.as !== undefined && s.mode !== 'all' && s.who.ref === 'target') {
      const one = s.count === 1;
      bind(st, s.as, { nouns: [...new Set([...K.nounsOf({ ...s.filter, controller: undefined }), 'card'])], plural: !one, zone: 'graveyard' });
    }
    // std-rx4 (CR 701.21a, 608.2h): what YOUR sacrifice of one permanent sacrificed is "the sacrificed <noun>" (its last known information; parser/lower/mentions.ts gives a
    // participle-only mention, so no other wording names it): "If you do, draw X cards, ..., where X is the sacrificed creature's power"
    if (s.as !== undefined && s.who.ref === 'you' && s.count === 1 && (s.mode === undefined || s.mode === 'choose')) {
      const nouns = K.nounsOf({ ...s.filter, controller: undefined });
      bind(st, s.as, { nouns: [...new Set([...nouns, 'card'])], plural: false, zone: 'graveyard', alts: nouns.map((n) => `the sacrificed ${n}`) });
    }
    if (s.as !== undefined) st.info.set(`r:${s.as}`, { ...movedInfo('sacrificed', K.nounsOf(s.filter)), sacrificedBy: JSON.stringify(s.who) }); // Cloud C7: "if a Goblin is sacrificed this way"; audit-fix-1: who
    if (s.cantAs !== undefined && s.mode !== undefined && s.mode !== 'choose') throw new NoRenderer("the players who can't of a sacrifice of all permanents");
    const c = byPlayer(s.who, st, 'sacrifice', () => {
      const f: ObjectFilter = { ...s.filter, controller: undefined };
      // C6 (CR 701.21a): "each player sacrifices all creatures they control [not chosen this way]": the controller is the sacrificing player, said or not
      if (s.mode === 'all') {
        const keep = keepsChosenKin(s, st);
        if (keep !== null) return keep;
        const plain = K.np(f, st, { det: 'all', plural: true, noController: true });
        const c = s.filter.controller;
        return typeof c === 'object' && (c.ref === 'iterating' || JSON.stringify(c) === JSON.stringify(s.who)) ? alt(plain, K.np(s.filter, st, { det: 'all', plural: true })) : plain;
      }
      // CLOUD std-otj (family half-of-controlled; CR 701.21a, 107.1a): "target opponent sacrifices half the creatures they control of their choice, rounded up"
      // (one player only: the count of "each opponent" would be every opponent's permanents together, not each player's own)
      // r5-refs (CR 608.2e, 101.4): ... or a group whose count reads each choosing player's own permanents ("they control" is `iterating`, read per player by the handler)
      const half = s.mode === undefined && s.who.ref !== 'you' && s.who.ref !== 'each' ? halfOfControlled(s.count, s.filter, s.who)
        : s.mode === undefined && s.who.ref === 'each' ? halfOfControlled(s.count, s.filter, { ref: 'iterating' }) : null;
      if (half !== null) return `half the ${K.np(f, st, { det: 'none', plural: true, noController: true })} they control of their choice, rounded ${half}`;
      // Standard round 4, r4-refs (CR 701.21a, 109.2): "target player sacrifices a creature of their choice other than enchanted creature": the one object left
      // out is said after "of their choice"
      const notOne = f.not;
      if (s.who.ref !== 'you' && notOne !== undefined && notOne.is !== undefined && Object.keys(notOne).length === 1) {
        return `${countedNp({ ...f, not: undefined }, s.count, st)} of their choice other than ${K.obj(notOne.is, st, 'object').text}`;
      }
      const np = countedNp(f, s.count, st);
      // FAST1 T6 (CR 701.21a): the sacrificing player chooses; current Oracle wording says so for another player ("sacrifices a creature of their choice")
      return s.who.ref !== 'you' ? alt(np, `${np} of their choice`) : np;
    });
    bindCant(st, s.cantAs, s.who); // C6: "each opponent who can't"
    return c;
  },

  counter: (s: StepOf<'counter'>, st: RenderState): Clause => {
    const what = K.obj(s.what, st, 'object').text;
    // r4-moved (CR 701.6a, 608.2c): what the step countered, spells and abilities, for "for each spell and ability countered this way" (render/qty.ts, resultCount)
    // std-rx30 (CR 400.7, 701.6a): after "if a permanent spell is countered this way, exile it instead ...", the card it became is "that card" (Thranduil's Decree)
    if (s.as !== undefined && s.toIf !== undefined) bind(st, s.as, { nouns: ['card'], plural: false });
    else if (s.as !== undefined) st.info.set(`r:${s.as}`, { nouns: ['spell and ability'], plural: true, thisWay: 'countered this way' });
    // std-rx30 (CR 113.7, 611.2a; Tishana's Tidebinder): "If an ability of an artifact, creature, or planeswalker is countered this way, that permanent loses all
    // abilities for as long as this creature remains on the battlefield."
    const fx = s.sourceEffect;
    if (fx !== undefined && !s.to && fx.mods.length === 1 && JSON.stringify(fx.mods[0]) === JSON.stringify({ layer: 6, removeAll: true })) {
      const of = K.np({ ...fx.filter, isCard: undefined }, st, { det: 'a' });
      return plain(`counter ${what}. if an ability of ${of} is countered this way, that permanent loses all abilities ${K.dur(fx.duration, st)}`, { standalone: true });
    }
    if (fx !== undefined) throw new NoRenderer('an effect on the source of a countered ability other than "loses all abilities"');
    if (!s.to) return plain(`counter ${what}`);
    return plain(`counter ${what}. ${counterTail(s, st)}`, { standalone: true });
  },

  createToken: (s: StepOf<'createToken'>, st: RenderState): Clause => {
    const c = byPlayer(s.who, st, 'create', () => {
      const n = s.count;
      // what is said after the token words: "tapped and attacking", "attached to it", "with a +1/+1 counter on it"
      // `tappedSaid`: "tapped" was already said before the token words ("create a tapped Treasure token")
      const tail = (plural: boolean, tappedSaid = false): string => {
        let text = '';
        const that = plural ? ' that are' : " that's";
        // cmd1 (CR 508.4): "tapped and attacking that opponent": the player the tokens attack (a planeswalker of theirs has no wording here)
        if (typeof s.attacking === 'object' && s.attacking.orPlaneswalkers === true) throw new NoRenderer('tokens attacking a player or a planeswalker they control');
        const whom = typeof s.attacking === 'object' ? ` ${K.player(s.attacking.defender, st, 'object').text}` : '';
        if (s.tapped && s.attacking) text += alt(`${that} tapped and attacking${whom}`, ` tapped and attacking${whom}`);
        else if (s.tapped && !tappedSaid) text += alt(`${that} tapped`, ' tapped');
        else if (s.attacking) text += alt(`${that} attacking${whom}`, ` attacking${whom}`);
        if (s.attachTo) text += ` attached to ${K.obj(s.attachTo, st, 'object').text}`;
        if (s.counters && s.counters.length > 0) text += ` with ${joinList(s.counters.map((x) => `${typeof x.count === 'number' ? (x.count === 1 ? 'a' : numWord(x.count)) : K.qty(x.count, st)} ${x.kind} counter${x.count === 1 ? '' : 's'} on ${plural ? 'each of them' : 'it'}`))}`;
        return text;
      };
      // FAST3 T17 (CR 111.2, 107.3, 608.2h): "create an X/X green Ooze creature token, where X is the number of creatures you control": one token whose
      // power and toughness are the same computed number (lowered from "where X is", parser/lower/quantities.ts#substituteX). A computed P/T beside a
      // computed count, or a computed power that differs from the toughness, has no Oracle wording here.
      const tp = s.token.power;
      const tt = s.token.toughness;
      const ptComputed = (tp !== undefined && isComputed(tp)) || (tt !== undefined && isComputed(tt));
      if (ptComputed) {
        if (tp === undefined || tt === undefined || JSON.stringify(tp) !== JSON.stringify(tt) || n !== 1) throw new NoRenderer('a token with a computed power and toughness other than one X/X token');
        const x = { ...s.token, power: { q: 'X' as const }, toughness: { q: 'X' as const } };
        // r5-fxb (family token-base-pt-equal, CR 111.4, 608.2h): also "a green Fungus Dinosaur creature token with base power and toughness each equal to ..." (no
        // other words after the token)
        const { power: _p, toughness: _t, ...noPt } = s.token;
        const before = cloneState(st);
        const whereX = `${tokenText(x, 1, false, st)}${tail(false)}, where X is ${K.qty(tp, st)}`;
        if (s.tapped || s.attacking || s.attachTo || (s.counters?.length ?? 0) > 0 || (s.token.abilities?.length ?? 0) > 0 || (s.token.keywords?.length ?? 0) > 0) return whereX;
        return alt(whereX, `${tokenText(noPt, 1, false, before)} with base power and toughness each equal to ${K.qty(tp, before)}`);
      }
      if (isComputed(n)) {
        // CR 111.2: "a token for each creature", "X tokens, where X is ...", "a number of tokens equal to ..."
        const v = K.qty(n, st);
        const per = countParts(n, st) ?? countersOnObject(n, st);
        const xTokens = `${tokenText(s.token, 'X', true, st)}${tail(true)}`;
        const options = [
          `${xTokens}, where X is ${v}`,
          `${tokenText(s.token, 'a number of', true, st)}${tail(true)} equal to ${v}`,
        ];
        // std-lci: Oracle prints the comma of ", where X is" inside the closing quote of the tokens' last quoted ability, which then ends with no period
        // ('with "This token can't block," where X is ...'; parser/tokenize.ts gives the comma back to the sentence)
        if (xTokens.endsWith('."')) options.push(`${xTokens.slice(0, -2)}," where X is ${v}`);
        // r3-static (CR 111.4, 608.2c): "Create X 1/1 Pilot creature tokens, where X is .... The tokens have "..."" (Cloudspire Coordinator): the next sentence gives
        // the tokens their abilities, as for a fixed number below (parser riders rid.t7.token.theyHave, rid.r3static.token.theTokensHave)
        const tk = s.token;
        if (tk.abilities && tk.abilities.length > 0 && !tk.predefined && namedTokenOf(tk) === undefined) {
          const quoted = tk.abilities.map((a) => quotedAbility(a, st, 'token')).join(' and ');
          options.push(`${tokenText({ ...tk, abilities: undefined }, 'X', true, st)}${tail(true)}, where X is ${v}. ${alt('they have', 'the tokens have')} ${quoted}`);
        }
        if (per) options.unshift(`${tokenText(s.token, 1, false, st)}${tail(false)} for each ${per.singular}`);
        // CLOUD std-misc (CR 107.1a, 111.2; The Goose Mother): "create half X Food tokens, rounded up": half the number, the rounding said after the token words
        if (typeof n === 'object' && n.q === 'math' && (n.op === 'ceilDiv' || n.op === 'floorDiv') && n.args.length === 2 && n.args[1] === 2) {
          options.push(`${tokenText(s.token, `half ${K.qty(n.args[0] as Quantity, st)}`, true, st)}${tail(true)}, rounded ${n.op === 'ceilDiv' ? 'up' : 'down'}`);
        }
        // FAST3 T17 (CR 603.2, 608.2h): the amount of the triggering event ("whenever ~ deals combat damage to a player, create that many 1/1 green Insect
        // creature tokens"; design 3.5 `eventAmount`), or the number of things an earlier step of this ability named ("that many", resultCount) — as for
        // draws (render/steps-cards.ts, FAST1 T6 / FAST2 T8)
        // (Standard round 5, r5-trig: also the mana symbols a cast trigger names, "that many" there, render/qty.ts; CR 107.4)
        if (typeof n === 'object' && (n.q === 'eventAmount' || (n.q === 'resultCount' && st.info.has(`r:${n.step}`)) || (n.q === 'manaSymbols' && v === 'that many'))) options.push(`${tokenText(s.token, 'that many', true, st)}${tail(true)}`);
        // FAST4 T26 (CR 111.1, 110.5b): "tapped" before the token words with a computed number too ("create that many tapped Treasure tokens", "create a
        // number of tapped Treasure tokens equal to its power"), as FAST1 T6 reads it for a fixed number below
        if (s.tapped && !s.attacking) {
          options.push(`${tokenText(s.token, 'a number of', true, st, 'tapped')}${tail(true, true)} equal to ${v}`);
          // FAST5 T67 (CR 111.1, 110.5b): "create a tapped 2/2 colorless Robot artifact creature token for each multicolored permanent you control"
          if (per) options.push(`${tokenText(s.token, 1, false, st, 'tapped')}${tail(false, true)} for each ${per.singular}`);
          // r4-fxb (family tapped-tokens-where-x): "create X tapped Treasure tokens, where X is the number of artifacts your opponents control" (Smaug, Wicked Worm)
          options.push(`${tokenText(s.token, 'X', true, st, 'tapped')}${tail(true, true)}, where X is ${v}`);
          if (typeof n === 'object' && (n.q === 'eventAmount' || (n.q === 'resultCount' && st.info.has(`r:${n.step}`)))) options.push(`${tokenText(s.token, 'that many', true, st, 'tapped')}${tail(true, true)}`);
        }
        return alt(...options);
      }
      const plural = !(typeof n === 'number' && n === 1);
      const count: number | string = typeof n === 'number' ? n : K.qty(n, st);
      const after = `${tokenText(s.token, count, plural, st)}${tail(plural)}`;
      // FAST2 T7 (CR 111.4, 608.2c): "Create a 0/1 Eldrazi Spawn creature token. It has "Sacrifice this creature: Add {C}."" says the same as "... token with
      // "Sacrifice this creature: Add {C}."": the next sentence gives the tokens their abilities (parser rider rid.t7.token.itHas / theyHave)
      const t = s.token;
      const told = t.abilities && t.abilities.length > 0 && !t.predefined && namedTokenOf(t) === undefined
        ? [`${tokenText({ ...t, abilities: undefined }, count, plural, st)}${tail(plural)}. ${plural ? alt('they have', 'the tokens have') /* r3-static */ : 'it has'} ${t.abilities.map((a) => quotedAbility(a, st, 'token')).join(' and ')}`]
        : [];
      // r5-mech (CR 111.4, 608.2c): the rider may also give plain keywords before the quoted ability, "... named Reliquary Dragon that's all colors. It has flying,
      // lifelink, and "When this token enters, ...""
      if (told.length > 0 && ((t.keywords ?? []).length > 0 || t.abilities!.some((a) => a.kind === 'keyword'))) {
        told.push(`${tokenText({ ...t, abilities: undefined, keywords: undefined }, count, plural, st)}${tail(plural)}. ${plural ? 'they have' : 'it has'} ${tokenAbilityWords(t, st).replace(/^ with /, '')}`);
      }
      // FAST1 T6 (CR 111.1, 110.5b): "create a tapped Treasure token" says the same as "create a Treasure token that's tapped"
      if (s.tapped && !s.attacking) return alt(after, `${tokenText(s.token, count, plural, st, 'tapped')}${tail(plural, true)}`, ...told);
      return told.length > 0 ? alt(after, ...told) : after;
    });
    // FAST5 T67 (CR 111.1, 107.3, 608.2h): "For each Shrine you control, create a 1/1 red Monk creature token with prowess." is the same one creation of a
    // counted number of tokens as "Create a 1/1 red Monk creature token with prowess for each Shrine you control." (the count is read once, as the step runs)
    const n = s.count;
    // (Cloud C7: also a count of what an earlier instruction moved, "For each creature card exiled this way, create a 1/1 colorless Spirit creature token")
    // (r4-moved: with the subject said, and a tapped token too, "For each creature card put into a graveyard this way, you create a tapped 2/2 black Zombie creature
    // token": parser templates eff.moved.token.forEach.lead.*)
    // (p2-coinflip-3, CR 705.2, 508.4: also the flips won of called flips, with tokens tapped and attacking: "For each flip you win, create a 1/1 red Goblin creature
    // token that's tapped and attacking." (Goblin Traprunner); the same reading, said in the same group)
    const flipsWon = typeof n === 'object' && n.q === 'resultCount' && n.which === undefined && st.info.get(`r:${n.step}`)?.thisWay === 'you win';
    const attackingOk = !s.attacking || (flipsWon && s.attacking === true && s.tapped === true);
    if (s.who.ref === 'you' && typeof n === 'object' && (n.q === 'count' || (n.q === 'resultCount' && n.which !== undefined) || flipsWon) && attackingOk && !s.attachTo && !(s.counters && s.counters.length > 0)
      && !isComputed(s.token.power ?? 0) && !isComputed(s.token.toughness ?? 0)) {
      const per = countParts(n, st);
      const tok = s.attacking ? `${tokenText(s.token, 1, false, st)} that's tapped and attacking` : s.tapped ? tokenText(s.token, 1, false, st, 'tapped') : tokenText(s.token, 1, false, st);
      if (per) c.imp = alt(c.imp, `for each ${per.singular}, ${alt('create', 'you create')} ${tok}`);
    }
    // r4-fxz (CR 111.1, 608.2c): a creature token is also "that creature" in a later sentence ("Create a 1/1 ... creature token with prowess. If ..., put a +1/+1
    // counter on that creature."), as its card types name it
    const typed = (s.token.types ?? []).map((x) => x.toLowerCase()).filter((x) => x === 'creature' || x === 'artifact');
    bind(st, s.as, { nouns: ['token', ...typed], plural: !(typeof s.count === 'number' && s.count === 1) });
    return c;
  },

  // r4-fxb (CR 115.7): "change the target of target spell or ability with a single target"
  changeTarget: (s: StepOf<'changeTarget'>, st: RenderState): Clause => {
    // edh-cast-1 (CR 115.7; Spellskite, Hydroelectric Specimen): "change a target of target spell or ability to ~", "change the target of target ... spell with a single target to ~"
    if (s.to !== undefined) {
      const single = JSON.stringify(s.what).includes('"ref":"target"') && st.specs.get((s.what as { id?: string }).id ?? '')?.filter?.targetCount !== undefined;
      return byPlayer(s.who, st, 'change', () => `${single ? 'the target' : 'a target'} of ${K.obj(s.what, st, 'object').text} to ${K.obj(s.to!, st, 'object').text}`);
    }
    return byPlayer(s.who, st, 'change', () => `the target of ${K.obj(s.what, st, 'object').text}`);
  },

  copy: (s: StepOf<'copy'>, st: RenderState): Clause => {
    // r4-moved (CR 707.12; effects/handlers/tokens-copy.ts#copySpells copies spells on the stack only): a spell copy of a CARD in exile is not given the reading "the
    // exiled card" that bindMoved added (r4-moved), so "copy the exiled card. You may cast the copy" stays manual as before; the older readings are unchanged
    const key = s.result === 'spell' && s.what.ref === 'bound' ? `b:${s.what.name}` : null;
    const held = key !== null ? st.info.get(key) : undefined;
    if (key !== null && held !== undefined && held.zone === 'exile' && (held.alts ?? []).some((x) => x.startsWith('the exiled card'))) {
      st.info.set(key, { ...held, alts: (held.alts ?? []).filter((x) => !x.startsWith('the exiled card')) });
    }
    let what: string;
    try {
      what = K.obj(s.what, st, 'object').text;
    } finally {
      if (key !== null && held !== undefined) st.info.set(key, held);
    }
    const general = (mods: StepOf<'copy'>['except'] & object): string => K.staticEffect({ s: 'continuous', affects: { ref: 'subject' }, mods }, st);
    // M6-2: a token copy's exceptions in the copy wording (render/copy-except.ts, CR 707.9b); a spell copy's as before
    const manyTokens = s.result === 'token' && !(s.count === undefined || s.count === 1);
    // CLOUD std-misc (CR 707.9b, 707.10): a spell copy's exceptions said of "the copy" ("except the copy isn't legendary"), else as before
    const spellExc = s.result === 'spell' && s.except && s.except.length > 0 && (s.count === undefined || s.count === 1) ? spellCopyExceptText(s.except) : null;
    const exc = s.except && s.except.length > 0 ? `, except ${s.result === 'token' ? copyExceptText(s.except, general, undefined, undefined, manyTokens, false, false, (a) => quotedAbility(a, st, 'creature')) : spellExc ?? general(s.except)}` : '';
    if (s.result === 'spell') {
      // a spell is not tapped or attacking (CR 707.10): a flag of a token copy beside a spell copy would be dropped
      if (s.tapped === true || s.attacking !== undefined && s.attacking !== false || s.noManaCost === true) throw new NoRenderer('tapped, attacking or no mana cost on a spell copy');
      // CR 707.10: who copies it, how many copies, and what the copies are not
      // FAST5 T45: "copy it for each other instant and sorcery spell you've cast before it this turn" (render/qty.ts#countParts)
      // CMD2 (CR 903.8): "copy it for each time you've cast your commander from the command zone this game" (the storm cycle)
      const per = typeof s.count === 'object' && (s.count.q === 'happenedCount' || s.count.q === 'commanderCasts') ? countParts(s.count, st) : null;
      const times = per !== null ? ` for each ${per.singular}` : timesWords(s.count);
      const nt = copyNewTargets(s) + copyGains(s, st);
      const c0 = byPlayer(s.who, st, 'copy', () => `${what}${times}${exc}`);
      // p2-copy-spell-3 (CR 707.10, 707.10c; family controller-of-target-copies-it): the controller of the one target spell copies that spell, said with the target
      // inside the subject: "The controller of target instant or sorcery spell copies it." (Meletis Charlatan); one copy of the target itself, no exception
      const ofTarget = s.what.ref === 'target' && JSON.stringify(s.who) === JSON.stringify({ ref: 'controllerOf', object: s.what }) && times === '' && exc === '';
      const c = ofTarget ? { ...c0, sub: alt(c0.sub, `the controller of ${what} copies it`) } : c0;
      // CR 707.10: the copy is a new object a later sentence can name ("that copy"; WP23 review)
      bind(st, s.as, { nouns: ['copy', 'spell'], plural: !(s.count === undefined || s.count === 1) });
      return nt === '' ? c : { ...c, imp: c.imp + nt, sub: c.sub + nt, standalone: true };
    }
    // M6-12: "with no mana cost" and a named defender (embalm, eternalize, myriad) are keyword data only: no wording here
    // std-cardcopy-2 (CR 508.4, 110.5b): one tapped token copy attacking a named player, "create a tapped token that's a copy of the exiled card attacking that
    // opponent" (Mardu Siegebreaker), the one wording of a named defender; any other (untapped, several, a planeswalker of theirs) has none
    if (s.noManaCost !== true && typeof s.attacking === 'object' && s.tapped === true && s.attacking.orPlaneswalkers !== true && (s.count ?? 1) === 1 && exc === '') {
      const whom = K.player(s.attacking.defender, st, 'object').text;
      const c = byPlayer(s.who, st, 'create', () => `a tapped token that's a copy of ${what} attacking ${whom}`);
      bind(st, s.as, { nouns: ['token'], plural: false });
      return c;
    }
    if (s.noManaCost === true || typeof s.attacking === 'object') throw new NoRenderer('a token copy with no mana cost or attacking a named defender');
    const n = s.count ?? 1;
    const c = byPlayer(s.who, st, 'create', () => {
      const body = typeof n === 'number' && n === 1 ? `a token that's a copy of ${what}` : `${typeof n === 'number' ? numWord(n) : K.qty(n, st)} tokens that are copies of ${what}`;
      const tap = s.tapped && s.attacking ? alt(' tapped and attacking', ", tapped and attacking") : s.tapped ? ' tapped' : s.attacking ? ' attacking' : '';
      // FAST5 T64 (CR 110.5b): "create a tapped token that's a copy of it" (Kambal): the tapped token said before the noun, as for any token
      if (s.tapped === true && !s.attacking) {
        const front = typeof n === 'number' && n === 1 ? `a tapped token that's a copy of ${what}` : `${typeof n === 'number' ? numWord(n) : K.qty(n, st)} tapped tokens that are copies of ${what}`;
        return alt(`${body}${tap}${exc}`, `${front}${exc}`);
      }
      // CLOUD std-ecl (CR 508.4, 110.5b; family copy-tapped-attacking-front): "create a tapped and attacking token that's a copy of the blighted creature": both words
      // before the noun, as Oracle prints them
      if (s.tapped === true && s.attacking === true) {
        const front = typeof n === 'number' && n === 1 ? `a tapped and attacking token that's a copy of ${what}` : `${typeof n === 'number' ? numWord(n) : K.qty(n, st)} tapped and attacking tokens that are copies of ${what}`;
        return alt(`${body}${tap}${exc}`, `${front}${exc}`);
      }
      return `${body}${tap}${exc}`;
    });
    // CR 707.2, 111.1: the token copy is a new object a later sentence can name ("that token"; WP23 review)
    bind(st, s.as, { nouns: ['token'], plural: !(typeof n === 'number' && n === 1) });
    return c;
  },

  tap: (s: StepOf<'tap'>, st: RenderState): Clause => tapClause('tap', s, st),
  untap: (s: StepOf<'untap'>, st: RenderState): Clause => tapClause('untap', s, st),

  attach: (s: StepOf<'attach'>, st: RenderState): Clause => {
    // T55 (CR 301.5c, 303.4d): ... and what it is attached to is no antecedent of the pronoun that names what is attached ("Attach it to ~" after a token was created)
    const toKey0 = s.to === null ? null : objKey(s.to);
    const savedWhat = st.notAntecedent;
    const savedOnly = st.attachmentOnly;
    if (toKey0 !== null) st.notAntecedent = identityOf(st, toKey0);
    if (s.to === null) st.attachmentOnly = true; // Cloud std-fin: "unattach it" names no creature (refs.ts#candidateCheck)
    let what: string;
    try {
      what = K.obj(s.what, st, 'object').text;
    } finally {
      st.notAntecedent = savedWhat;
      if (savedOnly === undefined) delete st.attachmentOnly;
      else st.attachmentOnly = savedOnly;
    }
    if (s.to === null) return plain(`unattach ${what}`);
    // FAST2 T10: what is attached is never what it is attached to (CR 301.5c, 303.4d): "attach ~ to it" names something else (parser/lower/anaphora.ts#attachedObject)
    const key = objKey(s.what);
    const toKey = objKey(s.to);
    if (key !== null && toKey !== null && identityOf(st, key) === identityOf(st, toKey)) throw new NoRenderer('attach an object to itself (CR 301.5c, 303.4d)');
    const saved = st.notAntecedent;
    if (key !== null) st.notAntecedent = identityOf(st, key);
    try {
      // std-rx32 (CR 701.3a, 603.12): what a later "when one or more Equipment become attached to that creature this way" names (parser/lower/conditions.ts#attachedThisWay)
      const spec = s.what.ref === 'target' ? st.specs.get(s.what.id) : undefined;
      const subs = spec?.filter?.subtypes;
      if (s.as !== undefined && subs?.length === 1 && subs[0] === 'Equipment') bind(st, s.as, { nouns: ['equipment'], plural: true, attachedThisWay: { noun: 'equipment', to: s.to } });
      return plain(`attach ${what} to ${K.obj(s.to, st, 'object').text}`);
    } finally {
      st.notAntecedent = saved;
    }
  },

  changeFace: (s: StepOf<'changeFace'>, st: RenderState): Clause => {
    const what = K.obj(s.what, st, 'object').text;
    if (s.manifest === true && s.to !== 'faceDown') throw new NoRenderer(`manifest with ${s.to}`);
    switch (s.to) {
      case 'transform': return plain(`transform ${what}`);
      case 'convert': return plain(`convert ${what}`);
      case 'faceUp': return plain(`turn ${what} face up`);
      case 'faceDown': return plain(s.manifest ? `manifest ${what}` : `turn ${what} face down`);
      case 'flip': return plain(`flip ${what}`);
    }
  },

  // T20 (FAST4): Oracle says it with the permanent as the subject ("~ phases out", "target creature phases out", CR 702.26b); the imperative stays a reading
  phaseOut: (s: StepOf<'phaseOut'>, st: RenderState): Clause => {
    const [imperative, subject] = withVariants(st, [
      (v) => `phase out ${K.obj(s.what, v, 'object').text}`,
      // std-rm (CR 702.26b): a described set as the subject has several wordings ("all creatures you control phase out", "each creature target player controls
      // phases out"), the verb agreeing with each (refs.ts#withSubjects)
      (v) => withSubjects(s.what, v, (subject, plural) => `${subject} ${plural ? 'phase' : 'phases'} out`),
    ]);
    return plain(alt(imperative!, subject!));
  },

  regenerate: (s: StepOf<'regenerate'>, st: RenderState): Clause => {
    const what = K.obj(s.what, st, 'object').text;
    const d = s.duration && s.duration.d !== 'endOfTurn' ? K.dur(s.duration, st) : '';
    return plain(`regenerate ${what}${d ? ` ${d}` : ''}`);
  },

  removeFromCombat: (s: StepOf<'removeFromCombat'>, st: RenderState): Clause => plain(`remove ${K.obj(s.what, st, 'object').text} from combat`),
  // p2-combat-flow-2 (CR 509.1h): "target unblocked attacking creature becomes blocked", "attacking creatures become blocked"
  becomeBlocked: (s: StepOf<'becomeBlocked'>, st: RenderState): Clause => {
    // a group is said with its plural noun alone ("attacking creatures become blocked", Fog Patch)
    if (s.what.ref === 'each' && 'filter' in s.what) return plain(`${K.np(s.what.filter, st, { det: 'none', plural: true })} become blocked`);
    const p = K.obj(s.what, st, 'subject');
    return plain(`${p.text} ${p.plural ? 'become' : 'becomes'} blocked`);
  },

  // trek-8 (CR 120.6, 614.1a): "remove all damage from it" and "all damage already dealt to it is healed"
  removeDamage: (s: StepOf<'removeDamage'>, st: RenderState): Clause => {
    const [removed, healed] = withVariants(st, [
      (v) => `remove all damage from ${K.obj(s.what, v, 'object').text}`,
      (v) => `all damage already dealt to ${K.obj(s.what, v, 'object').text} is healed`,
    ]);
    return plain(alt(removed!, healed!));
  },

  exchange: (s: StepOf<'exchange'>, st: RenderState): Clause => {
    // p2-pt-1 (CR 701.12a, 613.4b): "exchange your life total with ~'s toughness" (Tree of Redemption), one player and one permanent (said before the shared
    // references below name either)
    if (s.what === 'lifeToughness') {
      if (!isPlayerRef(s.a as never, st) || isPlayerRef(s.b as never, st)) throw new NoRenderer('a life total exchanged with a toughness that is not one player and one permanent');
      return plain(`exchange ${K.player(s.a as PlayerRef, st, 'possessive').text} life total with ${K.obj(s.b as ObjRef, st, 'possessive').text} toughness`);
    }
    const ref = (r: ObjRef | PlayerRef): string => (isPlayerRef(r, st) ? K.player(r as PlayerRef, st, 'subject').text : K.obj(r as ObjRef, st, 'object').text);
    const a = ref(s.a as never);
    // MX2 (additive): one reference to two objects, "exchange control of two target creatures" (CR 701.12b)
    if (s.what === 'control' && JSON.stringify(s.a) === JSON.stringify(s.b)) return plain(`exchange control of ${a}`);
    // std-rx25 (CR 701.12c): one reference to two players, "two target players exchange life totals"
    if (s.what === 'life' && JSON.stringify(s.a) === JSON.stringify(s.b)) {
      const spec = s.a.ref === 'target' ? st.specs.get(s.a.id) : undefined;
      if (spec === undefined || spec.min !== 2 || spec.max !== 2) throw new NoRenderer('one reference to players exchanging life totals that is not exactly two target players');
      return plain(`${a} exchange life totals`, { have: `${a} exchange life totals` });
    }
    // cloud std-spm: the other player as the object of "with", one player (read before the subject form below names it: a target is introduced once)
    const one = (r: PlayerRef): boolean => r.ref !== 'each' && (r.ref !== 'target' || st.specs.get(r.id)?.max === 1);
    const withB = s.what === 'life' && s.a.ref === 'you' && isPlayerRef(s.b as never, st) && one(s.b as PlayerRef) ? K.player(s.b as PlayerRef, cloneState(st), 'object').text : null;
    const b = ref(s.b as never);
    switch (s.what) {
      case 'control': return plain(`exchange control of ${a} and ${b}`);
      // cloud std-spm (CR 701.12c): your own exchange is also "exchange life totals with target opponent" (the imperative, "you" left out)
      case 'life': return plain(withB !== null ? alt(`${a} and ${b} exchange life totals`, `exchange life totals with ${withB}`) : `${a} and ${b} exchange life totals`);
      case 'hands': return plain(`${a} and ${b} exchange hands`);
      case 'powerToughness': return plain(`exchange the power and toughness of ${a} and ${b}`);
    }
  },

  cast: (s: StepOf<'cast'>, st: RenderState): Clause => {
    // r4-copy (CR 707.12, 608.2g): "Exile target card from your graveyard. Copy it. You may cast the copy [without paying its mana cost]." (Kaervek, the Punisher;
    // Shiko, Paragon of the Way: "Copy it, then you may cast the copy ..."): the copy of the card, created in its zone and cast while the effect resolves
    if (s.copyIn !== undefined && s.optional === true && s.who.ref === 'you' && s.costChange === undefined && s.play === undefined && s.anyManaType === undefined && s.transformed === undefined) {
      const what = K.obj(s.what, st, 'object');
      // std-cardcopy-7 (CR 608.2d, 202.3): one choice of the copies to cast, "You may cast up to three of the copies without paying their mana costs." (Baron Helmut
      // Zemo), "You may cast any number of spells with total mana value 6 or less from among the copies without paying their mana costs." (Uldaros Theorix)
      if (s.select !== undefined) {
        const sel = s.select;
        if (!what.plural || s.free !== true || (sel.max === undefined) === (sel.totalManaValue === undefined)) throw new NoRenderer('a choice of copies to cast other than "up to N" or a total mana value, without paying');
        const c = byPlayer(s.who, st, 'copy', () => what.text);
        const tail = sel.max !== undefined
          ? `. you may cast up to ${K.qty(sel.max, st)} of the copies without paying their mana costs`
          : `. you may cast any number of spells with total mana value ${K.qty(sel.totalManaValue!, st)} or less from among the copies without paying their mana costs`;
        return { ...c, imp: c.imp + tail, sub: c.sub + tail };
      }
      // r4-copy: several cards, each copy cast or not ("Copy them. You may cast any number of the copies.", The Tale of Tamiyo)
      if (what.plural && s.free === true) throw new NoRenderer('several copies of cards cast without paying their mana costs');
      const free = s.free === true ? ' without paying its mana cost' : '';
      const c = byPlayer(s.who, st, 'copy', () => what.text);
      // edh-cast-1 (CR 707.12, 608.2g, 607.2a; Isochron Scepter): the copy of the card the object's linked ability exiled is optional and so is its cast: "You may copy the
      // exiled card. If you do, you may cast the copy without paying its mana cost."
      if (s.what.ref === 'linked' && s.what.link === 'exiled' && !what.plural && s.free === true && s.select === undefined && s.guard === undefined && s.as === undefined) {
        const said = `you may copy ${what.text}. if you do, you may cast the copy${free}`;
        return { ...c, imp: said, sub: said };
      }
      const tail = what.plural ? '. you may cast any number of the copies' : alt(`. you may cast the copy${free}`, `, then you may cast the copy${free}`);
      // trek-12 (CR 707.12; family create-a-copy-of-self): the copy of the card the ability is on, in exile, is "Create a copy of ~" as well as "Copy ~" (Q, Stacking the Deck)
      if (s.what.ref === 'self' && !what.plural && s.free !== true) {
        const made = byPlayer(s.who, st, 'create', () => `a copy of ${what.text}`);
        return { ...c, imp: alt(c.imp, made.imp) + tail, sub: alt(c.sub, made.sub) + tail };
      }
      return { ...c, imp: c.imp + tail, sub: c.sub + tail };
    }
    // trek-7 (CR 608.2d, 601.2, 202.3; Captain Benjamin Sisko, template eff.trek7.cast.anyNumber.free.mvLte.fromAmong): one choice, among the cards of an exiled group that can be
    // cast now (each as a face or half of at most that mana value), of any number of spells cast without paying their mana costs: "You may cast any number of spells with
    // mana value less than or equal to N from among those cards without paying their mana costs." Only the nonland cards of one bound group in exile, and nothing else
    if (s.select !== undefined) {
      const f = s.what.ref === 'each' ? s.what.filter : undefined;
      const groupOnly = f !== undefined && f.is !== undefined && f.zone === 'exile' && f.notTypes?.length === 1 && f.notTypes[0] === 'Land'
        && Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).length === 3;
      if (!groupOnly || s.select.max !== undefined || s.select.totalManaValue !== undefined || s.maxManaValue === undefined || s.free !== true || s.who.ref !== 'you' || s.optional !== undefined || s.copyIn !== undefined
        || s.play !== undefined || s.anyManaType !== undefined || s.costChange !== undefined || s.transformed !== undefined || s.graveyardInstead !== undefined || s.as !== undefined || s.guard !== undefined) {
        throw new NoRenderer('a choice of cards to cast other than among copies, or other than any number of the nonland cards of an exiled group under a mana value limit'); // std-cardcopy-7
      }
      const them = K.obj(f!.is as ObjRef, st, 'object');
      if (!them.plural || them.text === AMBIGUOUS) throw new NoRenderer('the group of cards to cast from is not one named plural reference');
      const text = `you may cast any number of spells with mana value less than or equal to ${K.qty(s.maxManaValue, st)} from among ${them.text} without paying their mana costs`;
      return acting('you', text, text, { closesScope: true });
    }
    const rest = (): string => {
      let t = K.obj(s.what, st, 'object').text;
      if (s.copyIn !== undefined) t = `a copy of ${t}`; // FAST5X E26 (CR 707.12): paradigm's copy, created in exile and cast
      if (s.free) t += ' without paying its mana cost';
      // r5-cost (CR 118.9, 601.2b): "cast that card by discarding a card rather than paying its mana cost" (an alternative cost of the one cast, kind `set`)
      if (discardInstead(s.costChange)) t += ' by discarding a card rather than paying its mana cost';
      if (s.anyManaType === true) t += `, and mana of any type can be spent to cast ${alt('that spell', 'it')}`; // FAST5X E29: CR 609.4b
      // std-rq (CR 601.2, 202.3; family cast-max-mana-value): "if that spell's mana value is 8 or less", "if the resulting spell's mana value is 8 or less"
      if (typeof s.maxManaValue === 'number') t += ` if ${alt("that spell's", "the resulting spell's")} mana value is ${s.maxManaValue} or less`;
      // std-rx31 (CR 601.2, 202.3, 608.2h; family cast-max-mana-value): a cap read as the step runs, "if the spell's mana value is less than or equal to the amount of
      // life you gained this turn" (the parser's template eff.stdrx31.cast.free.maxManaValue.qty)
      // trek-5 (family cast-free-mv-at-most): ... and "equal to or less than" says it too (the parser's eff.trek5.cast.free.ifSpellMvAtMost; Commander Spock)
      else if (s.maxManaValue !== undefined) {
        const cap = K.qty(s.maxManaValue, st);
        t += ` if ${alt(...["that spell's", "the resulting spell's", "the spell's"].flatMap((who) => [`${who} mana value is less than or equal to ${cap}`, `${who} mana value is equal to or less than ${cap}`]))}`;
      }
      return t;
    };
    // std-rj (CR 608.2c, 601.2): "If you don't cast that card this way" says that the cast of one card (render/cond.ts#did)
    if (s.as !== undefined && s.who.ref === 'you' && s.what.ref === 'bound' && s.free === true) st.info.set(`r:${s.as}`, { nouns: ['card'], plural: false, thisWay: 'cast this way' });
    const verb = s.play === true ? 'play' : 'cast'; // FAST5X E26 (CR 305.9, 702.75a): "you may play the exiled card"
    // std-rx31 (CR 608.2c; family otherwise-after-cast): an optional cast that names its result: "Otherwise, Y" after it is "If you don't, Y" (render/steps-flow.ts)
    // (inside the branch of an `if`, "Otherwise" would be the other branch: only the words "if it wasn't cast this way" name the cast there); std-rj's record above is kept
    if (s.optional === true && s.as !== undefined && s.who.ref === 'you') st.info.set(`r:${s.as}`, { ...(st.info.get(`r:${s.as}`) ?? { nouns: ['card'], plural: false }), castOption: st.stepIf === undefined ? true : 'inIf' });
    const c0 = s.optional ? modal(s.who, st, `may ${verb} ${rest()}`) : byPlayer(s.who, st, verb, rest);
    const gi = s.graveyardInstead;
    const giText = gi === undefined ? '' : graveyardInsteadText(gi);
    const c = gi === undefined ? c0 : { ...c0, imp: c0.imp + giText, sub: c0.sub + giText, standalone: true };
    if (!s.costChange || discardInstead(s.costChange)) return c;
    const ch = s.costChange;
    // CR 601.2f: the amount is the generic part and the mana symbols of the change ("it costs {1}{G} less to cast this way")
    if (ch.kind === 'set') throw new NoRenderer('a cast cost change that sets the cost');
    const generic = ch.generic !== undefined ? `{${typeof ch.generic === 'number' ? ch.generic : K.qty(ch.generic, st)}}` : '';
    const amount = `${generic}${ch.mana && ch.mana.length > 0 ? formatManaCost(ch.mana) : ''}`;
    if (amount === '') throw new NoRenderer('a cast cost change without an amount');
    const extra = `. it costs ${amount} ${ch.kind === 'reduce' ? 'less' : 'more'} to cast this way`;
    return { ...c, imp: c.imp + extra, sub: c.sub + extra, standalone: true };
  },

  // E3XP (FAST5X E31, CR 115.7d): "you may choose new targets for that spell"
  chooseNewTargets: (s: StepOf<'chooseNewTargets'>, st: RenderState): Clause => modal(s.who, st, `may choose new targets for ${K.obj(s.what, st, 'object').text}`, { standalone: true }),
};

/**
 * r4-repl (CR 614.1a): the sentence of a cast's `graveyardInstead`, ". if that spell would be put into your graveyard, exile it instead" / "... put it on the bottom
 * of its owner's library instead"; std-rw7 (CR 614.1a, 205.2a): with `types`, ". if an instant or sorcery spell cast this way would be put into your graveyard, ...".
 */
export function graveyardInsteadText(gi: NonNullable<StepOf<'cast'>['graveyardInstead']>): string {
  const to = gi.to.zone === 'exile' && Object.keys(gi.to).length === 1 ? 'exile it' : gi.to.zone === 'library' && gi.to.position === 'bottom' && Object.keys(gi.to).length === 2 ? "put it on the bottom of its owner's library" : null;
  if (to === null) throw new NoRenderer('a spell cast this way sent elsewhere than exile or the bottom of its library instead of a graveyard');
  if (gi.types !== undefined && (gi.types.length < 2 || gi.yours !== true)) throw new NoRenderer('a spell of one card type, or of several sent from a graveyard that is not yours');
  const spell = gi.types === undefined ? 'that spell' : `${withArticle(joinList(gi.types.map((t) => t.toLowerCase()), 'or'))} spell cast this way`;
  return `. if ${spell} would be put into ${gi.yours === true ? 'your' : 'a'} graveyard, ${to} instead`;
}

/** r5-cost: an alternative cost of a cast during a resolution that is discarding one card, nothing else ("by discarding a card rather than paying its mana cost"). */
function discardInstead(ch: StepOf<'cast'>['costChange']): boolean {
  if (ch === undefined || ch.kind !== 'set' || ch.mana !== undefined || ch.generic !== undefined || ch.cost === undefined) return false;
  const c = ch.cost;
  const p = c.other?.[0];
  return c.mana === undefined && c.tap !== true && c.other?.length === 1 && p !== undefined && p.kind === 'discard' && p.count === 1 && p.filter === undefined && Object.keys(c).every((k) => k === 'other');
}

/** std-tdm: the nouns a "destroyed this way" count of this destroy step is said with: the one card type it destroys (no other kind of object), then "permanent". */
/**
 * The sentence after a destroy that can't be regenerated (CR 701.19c), read after the destroy named its objects: "It can't be regenerated." / "They can't be regenerated."
 * p2-refs-2 (CR 608.2c; family destroyed-this-way-no-regen): Oracle also names what was destroyed by its card type and the participle, "A creature destroyed this way
 * can't be regenerated", "Artifacts destroyed this way can't be regenerated" (the one card type the step destroys, as "for each <noun> destroyed this way"). Also said
 * after a guarded destroy's condition (render/steps.ts, "Destroy target creature if it's white. A creature destroyed this way can't be regenerated.").
 */
export function noRegeneration(s: StepOf<'destroy'>, st: RenderState): string {
  const info = infoOfRef(s.what, st);
  const pron = anaphor(info, 'subject').text;
  const nouns = destroyedNouns(s.what, cloneState(st)).filter((n) => n !== 'permanent');
  const noun = nouns.length === 1 ? nouns[0]! : 'permanent';
  const named = info.plural ? `${noun}s destroyed this way` : `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun} destroyed this way`;
  return alt(`${pron} can't be regenerated`, `${named} can't be regenerated`);
}

function destroyedNouns(what: ObjRef, st: RenderState): string[] {
  const f = what.ref === 'each' && 'filter' in what ? what.filter : what.ref === 'target' ? st.specs.get(what.id)?.filter : undefined;
  const types = f !== undefined && f.anyOf === undefined ? f.types ?? [] : [];
  return types.length === 1 ? [types[0]!.toLowerCase(), 'permanent'] : ['permanent'];
}
