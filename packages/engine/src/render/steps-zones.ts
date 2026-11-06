/**
 * Moving and changing objects (WP2): move, destroy, sacrifice, sacrificeChoice, counter, createToken, copy, tap, untap, attach, changeFace, phaseOut,
 * regenerate, removeFromCombat, exchange, cast (CR 701.3-701.8, 701.12, 701.19, 701.21, 701.26, 707.10, 111, 400).
 */
import { namedTokenOf } from '../model/named-tokens';
import type { Destination, ObjectFilter, ObjRef, PlayerRef, Quantity, TokenDef } from '../types/ability';
import { acting, plain, type Clause } from './clause';
import { K } from './kernel';
import { AMBIGUOUS, anaphor, exiledNotCast, identityOf, isPlayerRef, specPhrase, restOfExiled, restOfGroup, roleInfo, withSubjects } from './refs';
import { zoneSetPhrase } from './steps-cards';
import { bind, bindCant, byPlayer, countStatedByIf, countedNp, destPhrase, exileCounters, halfOfControlled, halfThatManyCounters, infoOfRef, isComputed, markX, modal, saidX, timesWords, type StepOf } from './steps-util';
import { keywordWords } from './kw';
import { quotedAbility, quotedListItem } from './quote';
/** edh-next-140: the quoted ability of an object entering as an Aura is read with the types it will have ("Enchanted Forest has ...", render/refs.ts#attachedOptions). */
const AS_AURA_TYPES = { types: ['Enchantment'], subtypes: ['Aura'] } as unknown as TokenDef;
import { cloneState, objKey, playerKey, PUT_INTO_GRAVEYARD_THIS_WAY, withVariants, type RenderState } from './state';
import { formatManaCost } from '../types/mana';
import { countParts } from './qty';
import { alt, article, COLOR_WORD, firstAlt, joinList, NoRenderer, numWord, pluralize, withArticle } from './text';
import { copyExceptText, spellCopyExceptText } from './copy-except';
import { movedInfo } from './moved';
import { abilityList } from './mods';
import { countersIfSentence } from './edhpm10';
import { graveyardOfWord } from './edhn71'; // edh-next-71

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
    if (info !== undefined && !info.player) st.info.set(`b:${s.what.name}`, { ...info, returned: true }); // edh-mana-keywords-10
  }
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
  // edh-perms-18 (CR 608.2c, 608.2h; Astarion's Thirst): the one target an exile moved is also "the creature exiled this way" afterwards (the parser's participle anaphor, parser/holes/object.ts)
  if (s.what.ref === 'target' && s.to.zone === 'exile' && s.guard === undefined) {
    const key = `t:${s.what.id}`;
    const held = st.info.get(key) ?? infoOfRef(s.what, st);
    if (!held.plural && held.player !== true) st.info.set(key, { ...held, alts: [...(held.alts ?? []), ...held.nouns.map((n) => `the ${n} exiled this way`), ...(held.nouns.includes('card') ? ['the exiled card'] : []) /* edh-c-27 (CR 607.1; Morbid Bloom): and "the exiled card's toughness" */] });
  }
  // edh-c-76 (CR 608.2c, 400.7; Morgue Burst): and the one target a move put into its owner's hand or onto the battlefield is "the card returned this way" (the parser's participle anaphor)
  if (s.what.ref === 'target' && (s.to.zone === 'hand' || s.to.zone === 'battlefield') && s.guard === undefined) {
    const key = `t:${s.what.id}`;
    const held = st.info.get(key) ?? infoOfRef(s.what, st);
    if (!held.plural && held.player !== true) st.info.set(key, { ...held, alts: [...(held.alts ?? []), ...[...new Set(['card', ...held.nouns])].map((n) => `the ${n} returned this way`)] });
  }
  if (s.as === undefined) return;
  // FAST4 T31 (CR 400.7, 406.3): the top cards of a library moved to a public zone are cards there ("Exile the top card of your library. You may play that card
  // this turn"); they have no key of their own (`objKey`), so the binding says what they are
  if (s.what.ref === 'topCards') {
    // r5-cost (CR 608.2c): the top card of EACH player's library is several cards ("... from among those cards", Etali, Primal Storm)
    const plural = s.what.count !== 1 || s.what.player.ref === 'each' || (s.what.player.ref === 'event' && s.what.player.role === 'recipient' && st.triggerWholeBatch === true /* edh-top-6: each opponent the damage of a whole batch was dealt to */);
    // std-rt (CR 608.2c, 400.7; as r4-moved's alt in bindMove): the one card the move exiled is also "the exiled card" ("Exile the top card of that player's library.
    // ... you may play the exiled card this turn", Reno and Rude; the parser's participle anaphor, parser/holes/object.ts). The plural, "the exiled cards", is std-rx29's
    // (Kylox, Visionary Inventor: "... from among the exiled cards") and std-rj's (CR 406.1, 608.2c; Doom Reigns Supreme: "You may cast up to two spells from among the exiled cards")
    const exiled = s.to.zone === 'exile' ? { alts: [plural ? 'the exiled cards' : 'the exiled card'] } : {};
    if (s.to.zone === 'exile' || s.to.zone === 'graveyard') bind(st, s.as, { nouns: ['card'], plural, zone: s.to.zone, ...exiled });
    // edhn78 (CR 110.1, 400.7j; Shallow Grave): "the top creature card of your graveyard" put onto the battlefield is that creature (a permanent) afterwards
    else if (s.to.zone === 'battlefield' && !plural && s.what.matching?.types !== undefined) bind(st, s.as, { nouns: [...s.what.matching.types.map((t) => t.toLowerCase()), 'card', 'permanent'], plural, zone: s.to.zone });
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
  // edh-c-64 (CR 110.1, 400.7j; Okiba Salvage): a card of a permanent type the move put onto the battlefield is a permanent there, also "that permanent" afterwards
  const nouns = s.to.zone === 'battlefield'
    ? (s.as !== undefined && !before.player && before.nouns.some((n) => PERMANENT_NOUNS.has(n)) && !before.nouns.includes('permanent') ? [...before.nouns, 'permanent'] : before.nouns)
    : [...new Set(['card', ...before.nouns])];
  // r3-choose (CR 201.5, 400.7): the object itself, moved, is still called by its name or "this creature" ("Exile Zuko, then return him to the battlefield ...":
  // a character's pronoun is "~" too, parser/front/selfref.ts), as well as "it"
  const self = s.what.ref === 'self' ? { alts: ['~'] } : {};
  // r4-moved (CR 608.2c, 400.7): what one move exiled is also "the exiled card(s)" ("Exile X target artifacts and/or creatures. Return the exiled cards to the battlefield
  // ...", "You may exile a nonland card from among them. ... You may cast the exiled card without paying its mana cost": the parser's participle anaphor)
  // std-typechange-2 (CR 400.7, 406.1): and the object itself exiled face up ("If you can't, exile it, then you may cast the exiled card without paying its mana cost",
  // Etrata, Deadly Fugitive's granted ability; the parser's participle anaphor names the moved ~, lower/anaphora.ts#compatible)
  const exiled = s.to.zone === 'exile' && (s.what.ref === 'target' || s.what.ref === 'bound' || (s.what.ref === 'self' && s.to.faceDown !== true)) ? { alts: before.plural ? ['the exiled cards'] : s.what.ref === 'target' ? ['the exiled card', 'that card' /* edhn78 (Astral Slide): the parser's rule, lower/anaphora.ts */] : ['the exiled card'] } : {};
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
  // edhd36 (CR 701.26a, 109.4, 608.2c; Power Sink, template eff.edhd36.player.tapAll.theyControl): "If that player doesn't, they tap all lands with mana abilities they control": the tap of every
  // permanent of a description that a player an earlier part named controls, said with that player as the subject (family tap-all-they-control); said on a copy of the state, so that
  // the mention of the player is the one the other reading makes
  let byThem: Clause | null = null;
  if (verb === 'tap' && s.what.ref === 'each' && s.as === undefined && Object.keys(s).every((k) => k === 'op' || k === 'what')) {
    const f = s.what.filter;
    if (typeof f.controller === 'object' && f.controller !== null && 'ref' in f.controller && f.anyOf?.length === 1 && Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).length === 2) {
      const c = cloneState(st);
      byThem = byPlayer(f.controller, c, 'tap', () => `all ${K.np(f.anyOf![0]!, c, { det: 'none', plural: true })} they control`);
    }
  }
  // edh-c-15 (CR 608.2c, 120.3; family dealt-this-way-tap-it, as r5-moved's destroy): "If a colorless creature is dealt damage this way, tap it": after a damage step's
  // "dealt damage this way" the target it named again is also "it"
  const obj = K.obj(s.what, st, 'object').text;
  const afterDamage = verb === 'tap' && s.what.ref === 'target' && [...st.info.entries()].some(([k, v]) => k.startsWith('b:') && v.thisWay === 'dealt damage this way');
  let text = forEachOpponent(s.what, `${verb} ${afterDamage ? alt(obj, 'it') : obj}`, st);
  if (s.as !== undefined && s.what.ref === 'each') bind(st, s.as, infoOfRef(s.what, st));
  // edh-next-94 (CR 701.26a, 608.2c; Angel's Trumpet): what a named tap step tapped, counted by a later "the number of creatures tapped this way" (resultCount, render/qty.ts#countParts)
  if (verb === 'tap' && s.as !== undefined && s.what.ref === 'each') st.info.set(`r:${s.as}`, { nouns: K.nounsOf(s.what.filter), plural: true, thisWay: 'tapped this way' });
  // edh-zones-1 (family and-you-plain-clause): an untap is also "and you untap ..." after another player's clause (Clause.andYou)
  if (byThem !== null) return { ...byThem, imp: alt(text, byThem.imp), sub: alt(text, byThem.sub) };
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
  // edh-zones-5 (CR 400.7, 608.2c; Tergrid, God of Fright; parser/holes/edhz5.ts): "put that card from a graveyard onto the battlefield": the same card of an earlier mention in any
  // graveyard (`isCard` marks it; it names no owner)
  if (keys === 'is,isCard,zone' && f['zone'] === 'graveyard' && f['isCard'] === true && (what.filter.is?.ref === 'bound' || what.filter.is?.ref === 'event')) {
    const info = what.filter.is.ref === 'bound' ? st.info.get(`b:${what.filter.is.name}`) : undefined;
    if (info !== undefined && (info.plural || info.player === true)) return null;
    return `${K.obj(what.filter.is, st, 'object').text} from a graveyard`;
  }
  if (!theirs && (keys !== 'is,owner,zone' || f['zone'] !== 'graveyard' || f['owner'] !== 'you')) return null;
  const is = what.filter.is;
  // std-rD (CR 608.2c, 400.7): "Whenever you discard a card, exile that card from your graveyard": the ONE card of the triggering event, found where the event put
  // it (template eff.stdrd.exile.fromYourGraveyard); a card the event put elsewhere (madness, CR 702.35a) or that left the graveyard is not moved
  let info;
  if (is?.ref === 'bound') info = st.info.get(`b:${is.name}`);
  else if (is?.ref === 'event') {
    const r = roleInfo(is.role, st);
    // edh-next-31 (CR 400.7e, 404.1, 608.2c; Skyfisher Spider): "When ~ dies, ... exile this card from your graveyard": the event's subject is the source itself, found in its owner's graveyard
    if (r.isSelf && !theirs && is.role === 'subject') return `${K.obj(is, st, 'object').text} from your graveyard`;
    info = r.isSelf ? undefined : r.info; // std-rD
  }
  // edh-next-33 (CR 400.7, 113.6m; Kozilek's Return): "you may exile ~ from your graveyard": this card itself, if it is in your graveyard (template eff.stdrd.exile.fromYourGraveyard)
  else if (is?.ref === 'self' && !theirs && st.selfZone === 'graveyard') return `${K.obj(is, st, 'object').text} from your graveyard`;
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
  // edh-d-73 (CR 701.17a, 608.2c; family all-each-milled-this-way; The Cyber-Controller): Oracle also says "all creature cards milled this way"
  const kind = { ...what.filter.anyOf[0]!, zone: 'graveyard' as const };
  return alt(`${K.np(kind, st, { det: 'each', noZone: true })} milled this way`, `${K.np(kind, cloneState(st), { det: 'all', plural: true, noZone: true })} milled this way`);
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
 * edh-next-143 (CR 401.4, 400.3, 608.2c; Lonis, Cryptozoologist): `move` of the rest of the top cards another player revealed of their own library (`{each: {is: <revealed>,
 * not: {is: <chosen>}, zone: 'library'}}`, refs.ts#restOfGroup) to the bottom of their owner's library in a random order: "That player puts the rest on the bottom of their library
 * in a random order" (the cards are that player's, so the move needs no owner). Null for any other move, and for a reveal of yours.
 */
function revealedTopRestOfOther(s: StepOf<'move'>, st: RenderState): PlayerRef | null {
  if (s.what.ref !== 'each') return null;
  const rest = restOfGroup(s.what.filter);
  if (rest === null) return null;
  const d = s.to;
  if (d.zone !== 'library' || d.position !== 'bottom' || d.order !== 'random' || d.owner !== undefined || Object.keys(d).length !== 3 || s.until !== undefined || s.as !== undefined || s.guard !== undefined) return null;
  const by = st.info.get(`b:${rest.group}`)?.revealedTopBy;
  return by === undefined || by.ref === 'you' ? null : by;
}

/**
 * edh-top-7 (CR 401.4, 406.1, 400.3; Jodah, the Unifier): the same move when YOU exiled the cards ("exile cards from the top of your library until you exile ..."): they were your
 * library's cards, so Oracle says "Put the rest on the bottom of your library in a random order" (an alt of the plain move: the model has no owner on it).
 */
function exiledRestOfYou(s: StepOf<'move'>, st: RenderState): boolean {
  if (s.what.ref !== 'each' || !restOfExiled(s.what.filter)) return false;
  const d = s.to;
  if (d.zone !== 'library' || d.position !== 'bottom' || d.order !== 'random' || d.owner !== undefined || Object.keys(d).length !== 3 || s.until !== undefined || s.as !== undefined || s.guard !== undefined) return false;
  const group = (s.what.filter.is as { ref?: string; name?: string } | undefined)?.name;
  const info = group === undefined ? undefined : st.info.get(`b:${group}`);
  return info?.exiledBy?.ref === 'you';
}

/**
 * edh-zones-15 (CR 401.4, 406.1, 400.3, 601.2a; Chaos Wand, Gríma, Saruman's Footman): `move` of the cards another player's `exileUntil` exiled that are still in exile
 * (`{each: {is: <exiled>, zone: 'exile'}}`, refs.ts#exiledNotCast) to the bottom of their owner's library in a random order. Said "Put the exiled cards that weren't cast this
 * way on the bottom of that library in a random order" (the controller puts them) or "That player puts ... on the bottom of their library ..." (the player who exiled them);
 * the same move either way. Another player's exile only (your own has no wording here).
 */
function exiledNotCastMove(s: StepOf<'move'>, st: RenderState): PlayerRef | null {
  if (s.what.ref !== 'each' || !exiledNotCast(s.what.filter, st)) return null;
  const d = s.to;
  if (d.zone !== 'library' || d.position !== 'bottom' || d.order !== 'random' || d.owner !== undefined || Object.keys(d).length !== 3 || s.until !== undefined || s.as !== undefined || s.guard !== undefined) return null;
  const group = (s.what.filter.is as { name?: string } | undefined)?.name;
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

/**
 * edh-players-13 (CR 608.2c, 608.2d, 400.7, 110.2a; template eff.edhp13.eachPlayer.returnAll.graveyard.bf, Patriarch's Bidding): the cards of a description whose type was chosen
 * by every player before, in every graveyard (`{ref:'each', filter:{anyOf:[<f>], chosen, zone:'graveyard', isCard:true}}`), onto the battlefield under their owners' control:
 * "each player returns all <cards of a type chosen this way> from their graveyard to the battlefield". Null for any other move.
 */
function chosenTypeReturn(s: StepOf<'move'>, st: RenderState): string | null {
  const d = s.to;
  if (s.what.ref !== 'each' || d.zone !== 'battlefield' || d.controller !== 'owner' || Object.keys(d).length !== 2 || s.as !== undefined || s.until !== undefined) return null;
  const f = s.what.filter as Record<string, unknown>;
  const keys = Object.keys(f).filter((k) => f[k] !== undefined).sort().join(',');
  const chosen = s.what.filter.chosen;
  if (keys !== 'anyOf,chosen,isCard,zone' || f['zone'] !== 'graveyard' || f['isCard'] !== true || s.what.filter.anyOf?.length !== 1 || chosen === undefined || st.groupChoices?.has(chosen.link) !== true) return null;
  const np = K.np({ ...s.what.filter.anyOf[0]!, chosen, zone: 'graveyard' }, st, { det: 'all', plural: true, noZone: true });
  return `each player returns ${np} from their graveyard to the battlefield`;
}

/**
 * edh-c-55 (CR 400.3, 110.2a, 608.2c; template eff.edhv55.eachPlayer.returnAll.graveyard.bf, Roar of Reclamation): the cards of a description in every graveyard
 * (`{ref:'each', filter:{anyOf:[<f>], zone:'graveyard', isCard:true}}`), onto the battlefield under their owners' control, said by each player: "each player returns all <cards> from
 * their graveyard to the battlefield" (the group wording of "Return all <cards> from all graveyards to the battlefield under their owners' control" stays the first reading). Null otherwise.
 */
function plainEachReturn(s: StepOf<'move'>, st: RenderState): string | null {
  const d = s.to;
  if (s.what.ref !== 'each' || d.zone !== 'battlefield' || d.controller !== 'owner' || Object.keys(d).length !== 2 || s.as !== undefined || s.until !== undefined) return null;
  const f = s.what.filter as Record<string, unknown>;
  const keys = Object.keys(f).filter((k) => f[k] !== undefined).sort().join(',');
  if (keys !== 'anyOf,isCard,zone' || f['zone'] !== 'graveyard' || f['isCard'] !== true || s.what.filter.anyOf?.length !== 1) return null;
  const np = K.np({ ...s.what.filter.anyOf[0]!, zone: 'graveyard' }, st, { det: 'all', plural: true, noZone: true });
  // edhd19 (family all-each, Magister of Worth): "each player returns each creature card from their graveyard to the battlefield" says the same as "... all creature cards ..."
  // (the engine runs the same move; a different count wording in the group would not pass the gate: the filter has no count)
  const each = K.np({ ...s.what.filter.anyOf[0]!, zone: 'graveyard' }, st, { det: 'each', noZone: true });
  return alt(`each player returns ${np} from their graveyard to the battlefield`, `each player returns ${each} from their graveyard to the battlefield`);
}

/**
 * edh-c-112 (CR 201.2, 400.3, 110.2a, 608.2c; template eff.edhv112.eachPlayer.returnsAll.sameName.graveyard.bf, Bloodbond March): the cards in every graveyard that share a name with an object
 * (`{ref:'each', filter:{zone:'graveyard', isCard:true, sharesWith:{with, quality:'name'}}}`), onto the battlefield under their owners' control: "each player returns all cards with the
 * same name as <that object> from their graveyard to the battlefield". Null for any other move.
 */
function sameNameReturn(s: StepOf<'move'>, st: RenderState): string | null {
  const d = s.to;
  if (s.what.ref !== 'each' || d.zone !== 'battlefield' || d.controller !== 'owner' || Object.keys(d).length !== 2 || s.as !== undefined || s.until !== undefined) return null;
  const f = s.what.filter as Record<string, unknown>;
  const keys = Object.keys(f).filter((k) => f[k] !== undefined).sort().join(',');
  const sw = s.what.filter.sharesWith;
  if (keys !== 'isCard,sharesWith,zone' || f['zone'] !== 'graveyard' || f['isCard'] !== true || sw === undefined || sw.quality !== 'name' || sw.other !== undefined || Object.keys(sw).length !== 2) return null;
  return `each player returns all cards with the same name as ${K.obj(sw.with, st, 'object').text} from their graveyard to the battlefield`;
}

/**
 * edh-b-4 (CR 400.3, 110.2a, 608.2c; template eff.edhb4.eachPlayer.returnsAll.twoColors.bf, Balthor the Defiled): the creature cards of one color and the creature cards of another in
 * every graveyard (`{ref:'each', filter:{anyOf:[{colors:[A], types:[Creature]}, {colors:[B], types:[Creature]}], zone:'graveyard', isCard:true}}`), onto the battlefield under their
 * owners' control: "each player returns all <A> and all <B> creature cards from their graveyard to the battlefield". Null for any other move.
 */
function twoColorsReturn(s: StepOf<'move'>): string | null {
  const d = s.to;
  if (s.what.ref !== 'each' || d.zone !== 'battlefield' || d.controller !== 'owner' || Object.keys(d).length !== 2 || s.as !== undefined || s.until !== undefined) return null;
  const f = s.what.filter as Record<string, unknown>;
  const keys = Object.keys(f).filter((k) => f[k] !== undefined).sort().join(',');
  const any = s.what.filter.anyOf;
  if (keys !== 'anyOf,isCard,zone' || f['zone'] !== 'graveyard' || f['isCard'] !== true || any === undefined || any.length !== 2) return null;
  const words = any.map((a) => (Object.keys(a).sort().join(',') === 'colors,types' && a.colors!.length === 1 && a.types!.length === 1 && a.types![0] === 'Creature' ? COLOR_WORD[a.colors![0]!] : undefined));
  if (words[0] === undefined || words[1] === undefined || words[0] === words[1]) return null;
  return `each player returns all ${words[0]} and all ${words[1]} creature cards from their graveyard to the battlefield`;
}

/**
 * edh-c-29 (CR 400.3, 608.2c; template eff.edhv29.eachPlayer.returnAll.graveyard.hand, Empty the Catacombs): the cards of a description in every graveyard
 * (`{ref:'each', filter:{anyOf:[<f>], zone:'graveyard', isCard:true}}`), into their owners' hands: "each player returns all <cards> from their graveyard to their hand".
 * Null for any other move.
 */
function eachPlayerReturnToHand(s: StepOf<'move'>, st: RenderState): string | null {
  const d = s.to;
  if (s.what.ref !== 'each' || d.zone !== 'hand' || Object.keys(d).length !== 1 || s.as !== undefined || s.until !== undefined) return null;
  const f = s.what.filter as Record<string, unknown>;
  const keys = Object.keys(f).filter((k) => f[k] !== undefined).sort().join(',');
  if (keys !== 'anyOf,isCard,zone' || f['zone'] !== 'graveyard' || f['isCard'] !== true || s.what.filter.anyOf?.length !== 1) return null;
  const np = K.np({ ...s.what.filter.anyOf[0]!, zone: 'graveyard' }, st, { det: 'all', plural: true, noZone: true });
  return `each player returns ${np} from their graveyard to their hand`;
}

function movedThing(what: ObjRef, st: RenderState): string {
  const fromGraveyard = boundFromYourGraveyard(what, st);
  if (fromGraveyard !== null) return fromGraveyard;
  const milled = eachMilledThisWay(what, st);
  if (milled !== null) return milled;
  if (what.ref === 'each') {
    const f = what.filter;
    // edh-c-103 (CR 404.1, 406.1; Ultimate Nullification): "exile all creatures and graveyards": one group of a description and every card of every graveyard (template eff.edhv103.exile.allAndGraveyards)
    if (Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join(',') === 'anyOf,zone' && JSON.stringify(f.zone) === '["battlefield","graveyard"]' && f.anyOf?.length === 2
      && JSON.stringify(f.anyOf[1]) === '{"zone":"graveyard"}' && f.anyOf[0]!.zone === undefined) {
      return `${K.np(f.anyOf[0]!, st, { det: 'all', plural: true })} and graveyards`;
    }
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
  command: alt('put', 'return'), // edh-misc-2 (CR 408.1, 903.9): "Return it to the command zone at the beginning of the next end step"
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
  // edhd36 (CR 701.6a, 614.15; Hinder, Desertion): "put that card on your choice of the top or bottom of its owner's library", "put that card onto the battlefield under your control": the
  // card the spell became is named "that card" (one reading, no alternative: the model says it the way Oracle does)
  else then = `${MOVE_VERB[d.zone]} ${d.endChosenBy !== undefined || (s.toIf !== undefined && d.zone === 'battlefield') ? 'that card' : obj} ${d.endChosenBy !== undefined ? (JSON.stringify(d) === JSON.stringify({ zone: 'library', endChosenBy: { ref: 'you' } }) ? "on your choice of the top or bottom of its owner's library" : (() => { throw new NoRenderer("a countered spell put where you choose the end of its owner's library, other than the plain form (CR 401.4)"); })()) : destPhrase(d, st, info.plural)} instead of into ${instead} graveyard`;
  return `if ${subj} is countered this way, ${then}`;
}

/** "return" for a card coming back from a graveyard or from exile, "put" for one that comes from a hand or a library; both read the same to the model. */
function moveVerb(what: ObjRef, zone: Destination['zone'], st: RenderState): string {
  const f = what.ref === 'each' ? what.filter : what.ref === 'target' ? st.specs.get(what.id)?.filter : undefined;
  const bound = what.ref === 'bound' ? st.info.get(`b:${what.name}`)?.zone : undefined;
  const zs = bound !== undefined ? [bound] : what.ref === 'topCards' && what.zone === 'graveyard' ? ['graveyard'] /* edhn78 */ : f?.zone === undefined ? [] : [f.zone].flat();
  // a card that comes out of a library or a hand is "put" into a hand (or onto the battlefield); one that comes back from the battlefield, a graveyard or exile is "returned"
  if (zone === 'hand') return zs.length > 0 && zs.every((z) => z === 'library' || z === 'hand') ? alt('put', 'return') : MOVE_VERB.hand!;
  if (zone !== 'battlefield') return MOVE_VERB[zone]!;
  // edh-d-61 (CR 700.4, 603.7c; Golden Guardian): the object a delayed trigger's own "dies" event names comes back from the graveyard
  const fromDeath = what.ref === 'event' && (st.trigger ?? []).length > 0 && st.trigger!.every((ev) => ev.ev === 'zoneChange' && ev.from === 'battlefield' && ev.to === 'graveyard');
  const back = what.ref === 'linked' || fromDeath || zs.some((z) => z === 'graveyard' || z === 'exile');
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
  // edh-c-2 (family token-colors-after-noun, CR 105.1, 111.4; Godsire): a token of two to four colors is also "an 8/8 Beast creature token that's red, green, and white"
  // (a token with no name and no abilities of its own: an alternative group can not hold another one)
  if (t.colors !== undefined && t.colors.length >= 2 && t.colors.length < 5 && !kwOnly && tail === '' && named === '') {
    const coreNoColor = [pre, ...legendary, pt, ...supers.filter((x) => x !== 'legendary'), ...subs, ...types].filter((x) => x !== '').join(' ');
    sentence = alt(sentence, `${plural ? countWord : article(coreNoColor)} ${coreNoColor} ${noun}${named}${tail} that ${plural ? 'are' : "'s"} ${colors}`.replace(/\s+/g, ' ').replace(" 's", "'s").trim());
  }
  // T55 (CR 111.4, 205.4a): a single named token is also said with its name first, "create Mowu, a legendary 3/3 green Dog creature token" (Oracle's wording
  // for most named tokens that have a name of their own); the name is a characteristic of the token, never a self reference of the card (CR 201.2)
  if (!plural && named !== '' && pre === '' && typeof count === 'number' && count === 1) {
    const first = `${t.name}, ${lead} ${core} ${noun}${tail}`.replace(/\s+/g, ' ').trim();
    // edh-next-125 (family token-all-colors, CR 105.2, 111.4; Mechtitan Core): and a named token of all five colors with its name first, "create Mechtitan, a legendary 10/10 Construct
    // artifact creature token with flying, vigilance, trample, lifelink, and haste that's all colors"
    if ((['W', 'U', 'B', 'R', 'G'] as const).every((c) => t.colors?.includes(c)) && t.colors!.length === 5) {
      const coreNoColor = [...legendary, pt, ...supers.filter((x) => x !== 'legendary'), ...subs, ...types].filter((x) => x !== '').join(' ');
      return alt(sentence, first, `${t.name}, ${article(coreNoColor)} ${coreNoColor} ${noun}${tail} that's all colors`.replace(/\s+/g, ' ').trim());
    }
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
  // edh-d-42 (Nahiri, the Lithomancer; the American style of quote.ts#quotedListItem): `with indestructible, "Equipped creature gets +5/+5 and has double strike," and equip {0}` -
  // the comma of the list already sits inside the closing quote of the item before the last, so "and" follows it with no comma of its own
  if (bits.length >= 3 && items[last - 1]!.quoted && bits[last - 1]!.endsWith(',"')) return ` with ${bits.slice(0, -1).join(', ')} and ${bits[last]!}`;
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
  const top = computed ? alt(flat, `exiles the top X cards of their library${down}, where X is ${K.qty(n, cloneState(st))}`) : flat;
  // edh-d-87 (CR 401.1, 608.2c; The Omenkeel): also "that player exiles that many cards from the top of their library" (the amount of the triggering event or an earlier
  // step's result) and "exiles two cards from the top of their library": the same top cards (family player-exiles-from-top)
  const many = typeof n === 'object' && (n.q === 'eventAmount' || (n.q === 'resultCount' && st.info.has(`r:${n.step}`)));
  const from = many ? `exiles that many cards from the top of their library${down}` : typeof n === 'number' && n > 1 ? `exiles ${numWord(n)} cards from the top of their library${down}` : undefined;
  const pred = from === undefined ? top : alt(top, from);
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
  // edh-zones-22 (Sorin, Lord of Innistrad): ... and the cards it put into graveyards are also "each card put into a graveyard this way" (`thisWay`, read by render/np.ts for a description of the group)
  bind(st, s.as, { nouns: [...new Set(['card', ...before.nouns])], plural: before.plural, zone: 'graveyard', sameAs: identityOf(st, key), thisWay: PUT_INTO_GRAVEYARD_THIS_WAY });
}

/**
 * edh-cast-15 (CR 707.10, 608.2c; Tempt with Mayhem, template eff.edhc15.copy.oncePlus.eachOpponentWhoCopied): the copy count "once plus an additional time for each opponent who
 * copied the spell this way": 1 plus the number of players who did what the optional instruction of each opponent before it offered.
 */
function oncePlusEachOpponent(count: Quantity | number | undefined): boolean {
  return typeof count === 'object' && count !== null && count.q === 'math' && count.op === '+' && count.args.length === 2 && count.args[0] === 1
    && typeof count.args[1] === 'object' && count.args[1].q === 'resultCount' && count.args[1].which === undefined && count.args[1].maxPerOwner === undefined;
}

/**
 * FAST5 T45 (CR 707.10c): the words after a spell copy that lets its controller choose new targets: "copy that spell. You may choose new targets for the copy." and
 * "copy that spell and you may choose new targets for the copy" (family joiner); '' when the copy has no new targets. Standard round 3, r3-trig: shared with
 * render/steps.ts#clause, which says a guard before these words ("copy it if you gained life this turn. You may choose new targets for the copy.").
 */
export function copyNewTargets(s: StepOf<'copy'>, st?: RenderState): string {
  // edh-next-113 (CR 707.10c; Display of Power): the copies of a group of target spells ("any number of target instant and/or sorcery spells"): one copy for each, "the copies"
  const spec = st !== undefined && s.what.ref === 'target' ? st.specs.get(s.what.id) : undefined;
  const many = spec !== undefined && (spec.max === 'any' || (typeof spec.max === 'number' && spec.max > 1));
  // edh-cast-15 (CR 707.10c; Tempt with Mayhem, family copies-you-control-new-targets): the copies you control are the ones this player makes, not the opponents' ("You may choose new targets for the copies you control.")
  const copies = (s.count === undefined || s.count === 1) && !many ? alt('the copy', 'that copy', 'each copy') : alt('the copies', 'those copies', 'each copy', ...(oncePlusEachOpponent(s.count) ? ['the copies you control'] : []));
  // FAST5 T45: "copy that spell. You may choose new targets for the copy." and "copy that spell and you may choose new targets for the copy" (family joiner)
  // r3-copy (CR 707.10c, 608.2c; family copy-if-you-do-new-targets): "you may copy it. If you do, you may choose new targets for the copy." (Spider-Verse)
  if (!(s.newTargets === true || s.newTargets === 'may')) return '';
  // p2-copy-spell-1 (CR 707.10c, 115.7; family copy-and-may-choose-new-target): the player who copies the spell chooses its new targets, said with the copy: "that
  // player may copy this spell and may choose a new target for that copy" (Chain of Smog), "you may copy this spell and may choose a new target for the copy"
  // (Sevinne's Reclamation); "a new target" is said of one copy only. A copy another player makes is never "you may choose" (that player chooses, CR 707.10c)
  const one = (s.count === undefined || s.count === 1) && !many;
  // p2-copy-spell-3: or the copier named again in a sentence of its own, "That player may choose new targets for the copy." (Meletis Charlatan)
  // edh-cast-15 (Tempt with Mayhem, family copies-you-control-new-targets): each opponent "may copy that spell and may choose new targets for the copy they control"
  const andMay = alt(` and may choose new targets for ${copies}`, ...(one ? [` and may choose a new target for ${copies}`] : []), ...(s.who.ref !== 'you' ? [`. that player may choose new targets for ${copies}`] : []), ...(s.who.ref === 'iterating' && one ? [' and may choose new targets for the copy they control'] : []), ...(s.who.ref === 'each' && one ? ['. each of those players may choose new targets for their copy'] : [])); // edh-d-64 (Hive Mind)
  if (s.who.ref !== 'you') return andMay;
  // edh-cast-7 (CR 707.10c; family joiner): or with a comma, "if you win the flip, copy that spell, and you may choose new targets for the copy" (Krark, the Thumbless)
  // edh-next-50 (CR 707.10c, 115.7; Ancestral Communion, family copy-and-may-choose-new-target): "You may choose a new target for the copy." of one copy
  return alt(`. you may choose new targets for ${copies}`, ...(one ? [`. you may choose a new target for ${copies}`] : []), ` and you may choose new targets for ${copies}`, `, and you may choose new targets for ${copies}`, `. if you do, you may choose new targets for ${copies}`, andMay);
}

/**
 * std-copy-1 (CR 707.10, 611.2a, 400.7a): the abilities a spell copy gains, as the sentence after the copy says them: "the copy gains haste and "At the beginning of the
 * end step, sacrifice this token."" or "if the copy is a permanent spell, it gains haste" (types/ability.ts, `copy.gains`). One copy only.
 */
function copyGains(s: StepOf<'copy'>, st: RenderState): string {
  if (s.gains === undefined) return '';
  if (!(s.count === undefined || s.count === 1) || s.result !== 'spell') throw new NoRenderer('abilities gained by several copies, or by a token copy');
  const list = abilityList(s.gains.add, cloneState(st), 'token');
  // edh-cast-10 (CR 707.10, 608.2c; family copy-gains-if-its-permanent, Nalfeshnee): "If it's a permanent spell, the copy gains ..." (the spell the copy was made of)
  return s.gains.ifPermanent === true ? alt(`. if the copy is a permanent spell, it gains ${list}`, `. if it's a permanent spell, the copy gains ${list}`) : `. the copy gains ${list}`;
}

/** r3-fx (CR 201.5, 400.7): what an earlier instruction of the ability did to the object itself moved it, and the binding names that card ("Exile ~, then return ~ ..."). */
const movedItself = (what: ObjRef, st: RenderState): boolean => what.ref === 'bound' && identityOf(st, `b:${what.name}`) === 'self';

/** edh-next-125: set while the plain wording of a move of the cost's exiled cards is said (the alternative below asks for it once). */
let costExiledInner = false;
export const CLAUSES_ZONES = {
  move: (s: StepOf<'move'>, st: RenderState): Clause => {
    if (s.as !== undefined) st.mentioned.add(`movedAs:${s.as}`); // edh-d-98: the name a move binds (render/qty.ts, steps-util.ts: "that much" of what it moved)
    // FAST5X E13: `remember` is written by the craft keyword's expansion only (CR 702.167c); a parsed sentence never carries it, so it is refused, never dropped
    if (s.remember !== undefined) throw new NoRenderer('a move whose permanents remember other objects (craft, CR 702.167c)');
    // edh-zones-21 (CR 401.4, 400.3; template eff.edhz21.forEach.ownerTopOrBottom, Aetherspouts): every object of a group goes to the top or the bottom of its owner's library,
    // each owner choosing for their own; only that exact move
    if (s.to.ownerChoosesEnd === true) {
      // edh-cast-15 (CR 401.4, 608.2c; Subtlety, template eff.edhc15.owner.putsIt.topOrBottom): one object, the target a sentence before names, "Its owner puts it on their choice of the top or bottom of their library."
      if (s.what.ref === 'target') {
        if (s.until !== undefined || s.as !== undefined || s.link !== undefined || s.guard !== undefined || JSON.stringify(s.to) !== JSON.stringify({ zone: 'library', ownerChoosesEnd: true })) {
          throw new NoRenderer('a move of a target where its owner chooses the end of their library, other than the plain one (CR 401.4)');
        }
        return plain('its owner puts it on their choice of the top or bottom of their library', { standalone: true });
      }
      if (s.what.ref !== 'each' || s.until !== undefined || s.as !== undefined || s.link !== undefined || s.guard !== undefined || JSON.stringify(s.to) !== JSON.stringify({ zone: 'library', ownerChoosesEnd: true })) {
        throw new NoRenderer('a move where each owner chooses the end of their library, other than a group put on its owners\' choice of top or bottom (CR 401.4)');
      }
      const group = K.np(s.what.filter, st, { det: 'none', forEach: true });
      return plain(`for each ${group}, its owner puts it on their choice of the top or bottom of their library`, { standalone: true, leadThen: true });
    }
    // edh-perms-10 (CR 614.1c, 608.2c; parser riders rid.edhpm10.*): the move said without the counters, then the sentence that gives them to the cards that match
    if (s.to.countersIf !== undefined) {
      const { countersIf, ...to } = s.to;
      const c = CLAUSES_ZONES.move({ ...s, to }, st);
      const side = countersIfSentence(countersIf, infoOfRef(s.what, st).plural, { say: (c) => K.cond(c, st), creature: infoOfRef(s.what, st).nouns.includes('creature'), np: (f) => K.np(f, st, { det: 'a' }), qty: (q) => K.qty(q as Parameters<typeof K.qty>[0], st) }); // edh-c-6: the condition of a `when` entry
      return { ...c, imp: `${c.imp}. ${side}`, sub: `${c.sub}. ${side}`, standalone: true };
    }
    // edh-next-125 (family cost-exiled-except-self; CR 607.2a, 400.7, 110.2; Mechtitan Core): the other cards the ability's own cost exiled (its cost exiled ~ too) put back onto the
    // battlefield tapped under their owners' control: "return all cards exiled with ~ except ~ to the battlefield tapped under their owners' control"
    if (!costExiledInner && s.what.ref === 'costExiled' && s.what.self !== true && JSON.stringify(s.to) === JSON.stringify({ zone: 'battlefield', controller: 'owner', tapped: true })
      && s.until === undefined && s.as === undefined && s.link === undefined && s.guard === undefined && s.remember === undefined) {
      const fork = cloneState(st);
      let said: Clause;
      costExiledInner = true;
      try { said = CLAUSES_ZONES.move(s, fork); } finally { costExiledInner = false; }
      const words = "return all cards exiled with ~ except ~ to the battlefield tapped under their owners' control";
      return { ...said, imp: alt(said.imp, words), sub: alt(said.sub, words) };
    }
    // edh-next-125 (CR 614.1c, 613.4b, 608.2c; Dance of the Manse): the move said without what the permanents enter as, then the sentence that says it, "If X is 6 or more, those permanents are
    // 4/4 creatures in addition to their other types." Only that form: several objects, the creature type alone added, a numeric size, a condition
    if (s.to.becomes !== undefined) {
      const { becomes, ...to } = s.to;
      const keys = Object.keys(becomes).sort().join();
      if (s.to.zone !== 'battlefield' || keys !== 'power,toughness,types,when' || JSON.stringify(becomes.types) !== '["Creature"]' || typeof becomes.power !== 'number' || typeof becomes.toughness !== 'number'
        || !(s.what.ref === 'each' || (s.what.ref === 'target' && st.specs.get(s.what.id)?.max !== 1))) {
        throw new NoRenderer('what moved permanents enter as, other than "if <condition>, those permanents are N/N creatures in addition to their other types"');
      }
      const c = CLAUSES_ZONES.move({ ...s, to }, st);
      const side = `if ${K.cond(becomes.when!, st)}, those permanents are ${becomes.power}/${becomes.toughness} creatures in addition to their other types`;
      return { ...c, imp: `${c.imp}. ${side}`, sub: `${c.sub}. ${side}`, standalone: true };
    }
    // edh-next-140 (CR 303.4f, 614.1c, 613.1d; Harold and Bob, First Numens): the move said without what it enters as, then the sentence that says it: "It's an Aura enchantment with enchant
    // Forest you control and "Enchanted Forest has '...'" ~ loses all other abilities." Only that form: one object, one quoted ability, the other abilities lost
    if (s.to.asAura !== undefined) {
      const { asAura, ...to } = s.to;
      if (s.to.zone !== 'battlefield' || asAura.losesOthers !== true || asAura.abilities.length !== 1 || (s.what.ref !== 'self' && s.what.ref !== 'event' && s.what.ref !== 'bound')) {
        throw new NoRenderer('what a moved permanent enters as, other than "it\'s an Aura enchantment with enchant ... and "..." ~ loses all other abilities"');
      }
      const c = CLAUSES_ZONES.move({ ...s, to }, st);
      const side = `it's an aura enchantment with enchant ${K.np(asAura.enchant, st, { det: 'none' })} and ${quotedAbility(asAura.abilities[0]!, st, 'aura', AS_AURA_TYPES)} ~ loses all other abilities`;
      st.mentioned.add('self');
      return { ...c, imp: `${c.imp}. ${side}`, sub: `${c.sub}. ${side}`, standalone: true };
    }
    // edh-perms-21 (CR 303.4f, 303.4g; parser rider rid.edhpm21.onlyFilter.canBeEnchantedThisWay; Retether): the move said without the restriction, then the sentence that names what the Auras can enchant
    if (s.to.enchantOnly !== undefined) {
      const { enchantOnly, ...to } = s.to;
      if (s.to.zone !== 'battlefield') throw new NoRenderer('a restriction on what the moved Auras enchant for a move that is not onto the battlefield');
      const fresh = cloneState(st); // edh-d-24: the target said for the first time, as the move will say it
      const c = CLAUSES_ZONES.move({ ...s, to }, st);
      const side = `only ${K.np(enchantOnly, st, { det: 'none', plural: true, noZone: true })} can be enchanted this way`;
      // edh-d-24 (CR 303.4f, 303.4g; Nomad Mythmaker): "Put target Aura card from a graveyard onto the battlefield under your control attached to a creature you control."
      if (JSON.stringify(enchantOnly) === '{"types":["Creature"],"controller":"you"}') {
        const said = `put ${K.obj(s.what, fresh, 'object').text} onto the battlefield under your control attached to ${K.np(enchantOnly, st, { det: 'a' })}`;
        return { ...c, imp: alt(`${c.imp}. ${side}`, said), sub: alt(`${c.sub}. ${side}`, said), standalone: true };
      }
      return { ...c, imp: `${c.imp}. ${side}`, sub: `${c.sub}. ${side}`, standalone: true };
    }
    // r5-moved (CR 701.25a, 608.2c, 400.7; template eff.r5moved.surveil.putThisWay.hand): "If you put a land card into your graveyard this way, put that card into your hand"
    const surveilled = surveilledToHand(s, st);
    if (surveilled !== null) return plain(surveilled, { standalone: true });
    // trek-7 (CR 401.4, 406.1, 400.3; The Borg Queen): "They put the rest on the bottom in a random order." after another player's "exiles cards from the top of their library
    // until they exile ...": the cards that exile left in exile (the group `exiled` less the card it stopped at) go to the bottom of THEIR owner's library, the player who
    // exiled them being the one who puts them; no "of their library" in Oracle's words. Another player's only (yours is the plain move below)
    // edh-zones-15 (template eff.edhz15.exiledNotCast.thatLibraryBottomRandom and ...player.putsExiledNotCast.theirLibrary): see exiledNotCastMove
    const notCastBy = exiledNotCastMove(s, st);
    if (notCastBy !== null) {
      const what = alt("the exiled cards that weren't cast this way", 'the exiled cards' /* edh-zones-26 (Tibalt's Trickery) */);
      const byThem = byPlayer(notCastBy, st, 'put', `${what} on the bottom of their library in a random order`, { standalone: true, leadThen: true });
      const bare = `put ${what} on the bottom of that library in a random order`;
      return { ...byThem, imp: alt(byThem.imp, bare), sub: alt(byThem.sub, bare) };
    }
    // edh-next-143 (Lonis, Cryptozoologist): the rest of the top cards another player revealed: "That player puts the rest on the bottom of their library in a random order."
    const revealedRestBy = revealedTopRestOfOther(s, st);
    if (revealedRestBy !== null) return byPlayer(revealedRestBy, st, 'put', 'the rest on the bottom of their library in a random order', { standalone: true, leadThen: true });
    const restOfOthers = exiledRestOfOtherPlayer(s, st);
    if (restOfOthers !== null) {
      // trek-21 (Lieutenant Nyota Uhura): the rest of the top cards that player exiled: "Then that player puts the rest on the bottom of their library in a random order."
      const fromTop = s.what.ref === 'each' && (s.what.filter.is as { name?: string } | undefined)?.name !== undefined && st.info.get(`b:${(s.what.filter.is as { name: string }).name}`)?.exiledTop === true;
      return byPlayer(restOfOthers, st, 'put', fromTop ? 'the rest on the bottom of their library in a random order' : 'the rest on the bottom in a random order', fromTop ? { standalone: true, leadThen: true } : { standalone: true });
    }
    // r5-moved (CR 608.2c, 400.7, 110.2a; template eff.r5moved.eachPlayer.returnsAll.notPutThere): "each player returns all creature cards from their graveyard that weren't put
    // there this way to the battlefield" (Bringer of the Last Gift)
    const notPut = notPutThereReturn(s, st);
    if (notPut !== null) return plain(notPut, { standalone: true, leadThen: true });
    const twoColors = twoColorsReturn(s); // edh-b-4 (Balthor the Defiled)
    if (twoColors !== null) return plain(twoColors, { standalone: true, leadThen: true });
    const handReturn = eachPlayerReturnToHand(s, st); // edh-c-29 (Empty the Catacombs)
    if (handReturn !== null) return plain(handReturn, { standalone: true, leadThen: true });
    const chosenReturn = chosenTypeReturn(s, st); // edh-players-13 (Patriarch's Bidding)
    if (chosenReturn !== null) return plain(chosenReturn, { standalone: true, leadThen: true });
    const sameName = sameNameReturn(s, st); // edh-c-112 (Bloodbond March)
    if (sameName !== null) return plain(sameName, { standalone: true, leadThen: true });
    const top = topCardsExiledBy(s, cloneState(st)); // read before the library's owner is mentioned by the other reading
    const before = cloneState(st); // FAST5 T42: the state before the object is named, for a reading that names it differently
    // r3-fx (family self-by-name-after-move): the object itself after a move of the same ability is also named again, "Exile ~, then return ~ to the battlefield
    // transformed under ~'s owner's control" (a character card's "return her"): the card the move put into exile, CR 400.7
    const named = movedThing(s.what, st);
    const d0 = s.to;
    const thing = movedItself(s.what, st) || (s.what.ref === 'self' && d0.zone === 'hand') ? alt(named, '~') : named; // edh-c-110 (Bob, Reluctant HYDRA Agent): "return him to his owner's hand" is "return ~ to ~'s owner's hand" (family self-by-name)
    // FAST1 T4 (CR 113.6m, 404.1): in an ability that functions only in its owner's graveyard, the object itself is a card in that graveyard
    // r4-fxz (CR 113.6m): ... and in one that functions only in its owner's hand, a card in that hand ("Put ~ from your hand onto the battlefield")
    // edh-zones-3 (family that-card-from-your-graveyard): the target card of an earlier sentence, a card of your graveyard, is also said with its zone again: "Return that card from your
    // graveyard to the battlefield instead if ..." (Stitch Together)
    const againSpec = s.what.ref === 'target' ? st.specs.get(s.what.id) : undefined;
    const again = againSpec?.kind === 'object' && againSpec.filter?.zone === 'graveyard' && againSpec.filter.owner === 'you' && s.to.zone === 'battlefield' ? alt(thing, `${thing} from your graveyard`) : thing;
    // edh-c-108 (CR 303.4, 400.7; Genju of the Cedars; family aura-returns-from-graveyard): the Aura whose enchanted permanent was put into a graveyard is itself in its owner's graveyard by the time
    // its trigger resolves, so Oracle says where it returns from: "you may return ~ from your graveyard to your hand"
    const auraDied = s.what.ref === 'self' && st.selfZone === undefined && s.to.zone === 'hand' && (st.trigger ?? []).some((e) => e.ev === 'zoneChange' && e.subject.attachedToSource === true && e.from === 'battlefield' && e.to === 'graveyard');
    const what = s.what.ref === 'self' && st.selfZone !== undefined && s.to.zone !== st.selfZone ? alt(thing, `${thing} from your ${st.selfZone}`) : auraDied ? alt(thing, `${thing} from your graveyard`) : again;
    const plural = infoOfRef(s.what, st).plural;
    const d = s.to;
    const verb = moveVerb(s.what, d.zone, st);
    let text: string;
    if (d.zone === 'exile') {
      // std-rx27: "with a stash counter on it": a group narrowed to what a reference names ("it from their graveyard") is as many as that reference
      const is = s.what.ref === 'each' ? s.what.filter.is : undefined;
      text = `exile ${what}${d.faceDown ? ' face down' : ''}${exileCounters(d, is !== undefined ? infoOfRef(is, st).plural : plural)}`;
      // edh-next-136 (CR 608.2c, 122.1; family rest-other-counter-on-it; Karn, Scion of Urza): the one card of a group a choice did not pick, "the other", exiled with counters "on it"
      if (s.what.ref === 'each' && restOfGroup(s.what.filter) !== null && (d.counters ?? []).length > 0 && d.faceDown !== true) text = alt(text, `exile the other${exileCounters(d, false)}`);
    }
    else if (d.endChosenBy !== undefined) {
      // edh-c-107 (CR 401.4, 400.3; Not Forgotten, template eff.edhv107.put.yourChoiceTopOrBottom): you choose the end of its owner's library; only that exact move of a target or a group
      if (s.until !== undefined || s.as !== undefined || s.link !== undefined || s.guard !== undefined || JSON.stringify(d) !== JSON.stringify({ zone: 'library', endChosenBy: { ref: 'you' } })) {
        throw new NoRenderer("a move where you choose the end of its owner's library, other than the plain one (CR 401.4)");
      }
      text = `${verb} ${what} on your choice of the top or bottom of ${plural ? "their owners' libraries" : "its owner's library"}`;
    }
    else text = `${verb} ${what} ${destPhrase(d, st, plural, false, firstAlt(verb) === 'return', isItself(s.what, st))}`;
    // edh-d-95 (CR 122.6, 614.1c, 400.7; family each-card-counter-on-it; Shilgengar, Sire of Famine): a group returned to the battlefield with counters is also said one card at a time, "Return each
    // creature card from your graveyard to the battlefield with a finality counter on it": every card of the group enters with the counters
    if (s.what.ref === 'each' && plural && d.zone === 'battlefield' && (d.counters ?? []).length > 0 && d.countersIf === undefined && s.until === undefined && firstAlt(verb) === 'return') {
      const v = cloneState(st);
      text = alt(text, `${verb} ${K.np(s.what.filter, v, { det: 'each' })} ${destPhrase(d, v, false, false, true, false)}`);
    }
    // edh-c-90 (CR 701.13a, 406.2; family you-exile-explicit; Diminishing Returns): the actor said once the sentence before names other players' actions, "You exile the top ten cards of your library."
    if (d.zone === 'exile' && !d.faceDown && (st.actor === undefined || st.actor === null) && s.until === undefined && d.owner === undefined) text = alt(text, `you ${text}`);
    if (auraDied && Object.keys(d).length === 1 && s.until === undefined) text = alt(text, `${verb} ${thing} from your graveyard to your hand`); // edh-c-108 (Genju of the Cedars)
    // edh-mana-keywords-10 (CR 400.7, 406.1; family exile-again-after-return; Lae'zel's Acrobatics): what the ability put onto the battlefield and exiles again is "exile them again"
    if (d.zone === 'exile' && !d.faceDown && s.until === undefined && s.what.ref === 'bound' && st.info.get(`b:${s.what.name}`)?.returned === true) text = alt(text, `${text} again`);
    // edh-perms-10 (CR 400.7, 110.2; family each-of-them): several objects an earlier instruction chose, returned to the battlefield, are "each of them ... under its owner's control"
    if (plural && s.what.ref !== 'each' && firstAlt(what) === 'them' && d.zone === 'battlefield' && d.controller === 'owner' && !d.tapped && !d.attacking && !d.faceDown && !d.transformed
      && d.attachedTo === undefined && d.attachedToPlayer === undefined && (d.counters ?? []).length === 0 && s.until === undefined) text = alt(text, "return each of them to the battlefield under its owner's control");
    // edh-next-68 (CR 110.2, 400.3; family return-tapped-first; Gerrard's Hourglass Pendant): "Return to the battlefield tapped all artifact, creature, enchantment, and land cards in your graveyard that ...": the destination before a group
    if (firstAlt(verb) === 'return' && d.zone === 'battlefield' && d.tapped === true && s.what.ref === 'each' && Object.keys(d).filter((k) => (d as unknown as Record<string, unknown>)[k] !== undefined).sort().join() === 'controller,tapped,zone' && s.until === undefined && firstAlt(what).startsWith('all ')) {
      text = alt(text, `return to the battlefield tapped ${what}`);
    }
    // edh-misc-2 (CR 113.6, 903.6; family self-from-command-zone): in an ability that functions only in the command zone the object itself is a card there: "Put ~ onto the battlefield from the command zone"
    if (s.what.ref === 'self' && st.selfZone === 'command' && d.zone !== 'command') text = alt(text, `${text} from the command zone`);
    if (exiledRestOfYou(s, st)) text = alt(text, 'put the rest on the bottom of your library in a random order'); // edh-top-7
    // edh-c-3 (CR 400.3, 404.1; family opponent-graveyard-their-hand; Pulsemage Advocate): cards of an opponent's graveyard go to their owner's hand, said "to their hand"
    if (d.zone === 'hand' && Object.keys(d).length === 1 && s.until === undefined && againSpec?.kind === 'object' && againSpec.filter?.zone === 'graveyard' && againSpec.filter.owner === 'opponent') {
      text = alt(text, `${verb} ${what} to their hand`);
    }
    // edh-c-33 (CR 400.3; family opponent-graveyard-their-library; Landscaper Colos): a card of an opponent's graveyard goes to the bottom of its owner's library, which is that opponent's: "on the bottom of their library"
    if (d.zone === 'library' && d.position === 'bottom' && Object.keys(d).length === 2 && s.until === undefined && againSpec?.kind === 'object' && againSpec.filter?.zone === 'graveyard' && againSpec.filter.owner === 'opponent') {
      text = alt(text, `${verb} ${what} on the bottom of their library`);
    }
    // edh-c-39 (CR 400.3, 401.3, 404.1; family put-their-graveyard; Eye Spy): a card seen in a player's library goes to its owner's graveyard, said "into their graveyard"
    if (d.zone === 'graveyard' && Object.keys(d).length === 1 && s.what.ref === 'bound' && st.info.has(`b:${s.what.name}`) && !plural && s.until === undefined && firstAlt(verb) === 'put') text = alt(text, `${verb} ${what} into their graveyard`);
    // edh-c-39 (CR 401.2, 401.4, 400.3; family bottom-of-that-players-library; Coral Fighters): a card seen in a player's library put on the bottom of it is "put it on the bottom of its owner's library"
    // and "put that card on the bottom of that player's library" (the player whose library it was looked at)
    if (d.zone === 'library' && d.position === 'bottom' && d.owner !== undefined && Object.keys(d).length === 3 && s.what.ref === 'bound' && st.info.has(`b:${s.what.name}`) && !plural && s.until === undefined && firstAlt(verb) === 'put') text = alt(text, `${verb} that card on the bottom of that player's library`);
    // std-rx30 (CR 400.3, 401.3): an object's owner who moves it says "their library" ("Its owner may put it on top of their library", Clash of Elements): a card
    // goes to its owner's library, and the owner is the one acting
    const moved = objKey(s.what);
    if (d.zone === 'library' && d.owner === undefined && !plural && moved !== null && st.actor === `own:${moved}`) {
      text = alt(text, `${verb} ${what} ${destPhrase({ ...d, owner: { ref: 'ownerOf', object: s.what } }, st, plural, false, firstAlt(verb) === 'return')}`.replace(/(on top of|on the bottom of|into) [^ ]+ owner's library/, '$1 their library'));
    }
    // edh-c-83 (CR 400.3, 404.1, 110.2a; family self-from-own-graveyard-your; Loathsome Troll): an ability that functions only in your graveyard moves a card that is yours: it goes to "your hand"
    // / "your library" (its owner's) and returns "to the battlefield" under your control, as the owner's control is the default of a return
    if (s.what.ref === 'self' && st.selfZone === 'graveyard' && s.until === undefined) {
      const mine = text.replace(/\bits owner's (hand|library)\b/g, 'your $1');
      if (mine !== text) text = alt(text, mine);
      else if (d.zone === 'battlefield' && JSON.stringify(d.controller) === '{"ref":"you"}' && Object.keys(d).every((k) => k === 'zone' || k === 'controller' || k === 'tapped')) {
        text = alt(text, `return ${what} to the battlefield${d.tapped === true ? ' tapped' : ''}`);
      }
    }
    // std-rx31 (CR 400.7, 122.6; family return-under-your-control; owner decision on Meathook Massacre II): "return that card under your control with a finality counter
    // on it" names no zone; it is read as a return to the battlefield under your control (the only zone a card has a controller in, CR 110.2a) with that counter
    // (the parser's eff.stdrx31.return.underYourControl.withCounter). Only one counter of one kind, nothing else about how it enters
    const one = d.counters?.length === 1 ? d.counters[0]! : undefined;
    if (d.zone === 'battlefield' && JSON.stringify(d.controller) === JSON.stringify({ ref: 'you' }) && one !== undefined && one.count === 1 && typeof one.kind === 'string'
      && Object.keys(d).length === 3 && s.what.ref !== 'self') {
      text = alt(text, `return ${what} under your control with ${withArticle(`${one.kind} counter`)} on it`);
    }
    const eachReturn = plainEachReturn(s, st); // edh-c-55 (Roar of Reclamation)
    if (eachReturn !== null) text = alt(text, eachReturn);
    // r5-moved (template eff.r5moved.exile.allTheCardsFromHand; CR 406.1, 402.1): "exile all the cards from your hand" is "exile all cards from your hand" (Hex Magic)
    if (d.zone === 'exile' && d.faceDown !== true && s.what.ref === 'each' && JSON.stringify(s.what.filter) === JSON.stringify({ zone: 'hand', owner: 'you', isCard: true })) text = alt(text, 'exile all the cards from your hand', 'exile your hand'); // edh-d-97 (family exile-your-hand; template eff.edhd97.exile.hand.you): or "exile your hand" (Herigast)
    // edhd19 (CR 607.2a, 400.3, 401.4; Trial of a Time Lord, family linked-bottom-owner): the cards a linked exile instruction exiled go to the bottom of their owners' libraries, said as
    // the owners' act, "the owner of each card exiled with ~ puts that card on the bottom of their library"
    if (s.what.ref === 'linked' && s.what.link === 'exiled' && d.zone === 'library' && d.position === 'bottom' && Object.keys(d).length === 2 && s.until === undefined && s.as === undefined) {
      text = alt(text, 'the owner of each card exiled with ~ puts that card on the bottom of their library');
    }
    // FAST5 T59 (CR 607.2a, 400.3): the cards a linked exile instruction exiled go to their owners' hands, "put each card exiled with it into its owner's hand"
    if (s.what.ref === 'linked' && s.what.link === 'exiled' && d.zone === 'hand' && d.owner === undefined && s.until === undefined) {
      text = alt(text, "put each card exiled with it into its owner's hand", "put each card exiled with ~ into its owner's hand");
      // r5-moved (CR 607.2a, 400.3): the same cards named as the plural participle of the linked instruction, "return the exiled cards to their owners' hands"
      // (template eff.r5moved.linked.return.hands; the singular "return the exiled card to its owner's hand" is fl.linked.returnHand's reading of the same move);
      // std-r9b: and as "put all cards exiled with ~ into their owners' hands" (template eff.stdr9b.linked.putAll.hands)
      // edh-zones-9: and "return all cards exiled with ~ to their owner's hand" (template eff.edhz9.linked.returnAll.hand; family linked-return-all-owner-hand)
      text = alt(text, "return the exiled cards to their owners' hands", "put all cards exiled with ~ into their owners' hands", "return all cards exiled with ~ to their owner's hand",
        // edh-c-102 (CR 607.2a, 400.3; family linked-put-all-owner-hand): "put all cards exiled with ~ into their owner's hand" (Kyren Archive) and "each player returns to their hand all cards they own exiled with ~" (Parallax Nexus)
        "put all cards exiled with ~ into their owner's hand", "each player returns to their hand all cards they own exiled with ~", "each player returns to their hand all cards they own exiled with it");
    }
    // p2-refs-1 (CR 607.2a, 110.2; family linked-exiled-battlefield-plural): the cards a linked exile instruction exiled, returned to the battlefield under their owners'
    // control, are also the plural participle of the linked ability, "return the exiled cards to the battlefield [tapped] under their owner's / owners' control"
    if (s.what.ref === 'linked' && s.what.link === 'exiled' && d.zone === 'battlefield' && d.controller === 'owner' && s.until === undefined
      && Object.keys(d).every((k) => k === 'zone' || k === 'controller' || (k === 'tapped' && d.tapped === true))) {
      const tapped = d.tapped === true ? ' tapped' : '';
      // edh-c-13 (Safe Haven): and "return each card exiled with ~ to the battlefield under its owner's control", "return all cards exiled with ~ to the battlefield under their owners' control"
      text = alt(text, `return the exiled cards to the battlefield${tapped} under their owners' control`, `return the exiled cards to the battlefield${tapped} under their owner's control`,
        ...(tapped === '' ? ["return each card exiled with ~ to the battlefield under its owner's control", "return all cards exiled with ~ to the battlefield under their owners' control",
          "return all cards exiled with it to the battlefield under their owners' control", "return each card exiled with it to the battlefield under its owner's control"] : []));
    }
    // edh-c-109 (CR 607.2a, 110.2; family linked-each-battlefield; Cold Storage, Helvault): the cards of ALL the abilities of the object that exiled, read as a group still in exile
    // ({ref:'each', filter:{is:linked exiled, zone:'exile'}}, readable with several exiling abilities), returned to the battlefield under your / their owners' control
    if (s.what.ref === 'each' && (s.what.filter as { is?: { ref?: string; link?: string } }).is?.ref === 'linked' && d.zone === 'battlefield' && s.until === undefined
      && Object.keys(d).length === 2 && (d.controller === 'owner' || JSON.stringify(d.controller) === JSON.stringify({ ref: 'you' }))) {
      const m = /^all (.*?)cards exiled with (.+)$/.exec(firstAlt(what));
      if (m !== null) {
        const sing = `${m[1]}card`;
        const under = d.controller === 'owner' ? ["their owners' control", "its owner's control"] : ['your control'];
        const alts = ['~', 'it'].flatMap((o) => under.flatMap((u) => [`return each ${sing} exiled with ${o} to the battlefield under ${u}`, `return all ${m[1]}cards exiled with ${o} to the battlefield under ${u}`]));
        // edh-d-11 (Trove Warden): "put each permanent card exiled with it onto the battlefield under the control of that card's owner" (the cards of the object's linked exile, each to its owner)
        if (d.controller === 'owner') for (const o of ['~', 'it']) alts.push(`put each ${sing} exiled with ${o} onto the battlefield under the control of that card's owner`);
        text = alt(text, ...alts);
      }
    }
    // trek-22 (CR 607.2a, 108.3, 110.2; family linked-return-each-creature-you-own; S.S. Botany Bay): the creature cards of the object's linked exile that you own, returned to the battlefield (under your control: you own them)
    if (s.what.ref === 'each' && JSON.stringify(s.what.filter) === '{"is":{"ref":"linked","link":"exiled"},"zone":"exile","isCard":true,"owner":"you","types":["Creature"]}' && d.zone === 'battlefield' && s.until === undefined
      && Object.keys(d).length === 2 && JSON.stringify(d.controller) === JSON.stringify({ ref: 'you' })) {
      text = alt(text, ...['~', 'it'].map((o) => `return each creature card you own exiled with ${o} to the battlefield`));
    }
    // r4-moved (CR 607.2a, 400.3): ... and into their owners' graveyards, "Put each card exiled with this artifact into its owner's graveyard" (zz-cloud/r4-moved.json)
    if (s.what.ref === 'linked' && s.what.link === 'exiled' && d.zone === 'graveyard' && d.owner === undefined && s.until === undefined) {
      // edh-zones-14 (CR 607.2a, 400.3; the Object hole reading of "them" after an intervening "if" on the linked exile, Valakut Exploration): and the cards an intervening "if" counted, "put them into their owner's graveyard"
      text = alt(text, "put each card exiled with it into its owner's graveyard", "put each card exiled with ~ into its owner's graveyard", "put them into their owner's graveyard",
        // edh-c-102 (CR 607.2a, 400.3; family linked-return-exiled-graveyard): "return the exiled cards to their owner's graveyard" (Gravegouger)
        "return the exiled cards to their owner's graveyard", "return the exiled card to its owner's graveyard");
    }
    // edh-next-62 (CR 607.2a, 400.3; Gustha's Scepter, Duplicity): the cards of ALL the abilities of the object that exiled, read as a group still in exile (`{is: linked exiled, zone: 'exile'}`),
    // put into their owners' graveyards: "put all cards exiled with ~ into their owner's graveyard"
    if (s.what.ref === 'each' && JSON.stringify(s.what.filter) === '{"is":{"ref":"linked","link":"exiled"},"zone":"exile"}' && d.zone === 'graveyard' && Object.keys(d).length === 1 && s.until === undefined) {
      text = alt(text, ...['~', 'it'].map((o) => `put all cards exiled with ${o} into their owner's graveyard`));
    }
    // edh-top-8 (CR 400.3, 400.7; template eff.edht8.return.group.toOwnersGraveyards; Mnemonic Betrayal): a group an earlier instruction named, put into their owners' graveyards, is also
    // "return them to their owners' graveyards"
    if (s.what.ref === 'bound' && d.zone === 'graveyard' && d.owner === undefined && s.until === undefined && Object.keys(d).length === 1 && st.info.get(`b:${s.what.name}`)?.plural === true) {
      text = alt(text, `return ${what} to their owners' graveyards`);
    }
    // FAST5 T42 (CR 400.7, 110.2): Oracle also says "return to the battlefield target nonland permanent card in your graveyard ..." (Squirming Emergence): the
    // destination first, for a plain return of something else onto the battlefield under your control
    // p2-graveyard-1 (CR 400.7, 110.2, 400.3): and a group ("Return to the battlefield all permanent cards in your graveyard that were put there from the battlefield this
    // turn", Faith's Reward), and to your hand a target or group of cards you own ("Return to your hand all creature cards in your graveyard that ...", No Rest for
    // the Wicked): a card goes to its owner's hand, so "your hand" only for cards of yours (family return-to-zone-first)
    const leadPlain = !d.tapped && !d.attacking && !d.faceDown && !d.transformed && d.attachedTo === undefined && d.attachedToPlayer === undefined && (d.counters ?? []).length === 0 && s.until === undefined;
    const ownedByYou = s.what.ref === 'each' ? s.what.filter.owner === 'you' : s.what.ref === 'target' && st.specs.get(s.what.id)?.filter?.owner === 'you';
    const lead = d.zone === 'battlefield' && (s.what.ref === 'target' || (s.what.ref === 'each' && leadPlain)) && !d.tapped && !d.attacking && !d.faceDown && !d.transformed && d.attachedTo === undefined && d.attachedToPlayer === undefined && (d.counters ?? []).length === 0 && d.controller !== 'owner' ? 'the battlefield'
      : d.zone === 'hand' && d.owner === undefined && leadPlain && ownedByYou ? 'your hand' : undefined;
    if (lead !== undefined) {
      text = alt(text, `return to ${lead} ${what}`);
    }
    // edh-top-3 (CR 400.7, 110.2, 115.1; family return-zone-lead; Agadeem's Awakening): a plural target of your graveyard whose targets have different mana values is also said
    // with the zone and the destination first, "Return from your graveyard to the battlefield any number of target creature cards that each have a different mana value
    // X or less" (the zone is not part of the target's words)
    if (s.what.ref === 'target' && d.zone === 'battlefield' && leadPlain && JSON.stringify(d.controller) === JSON.stringify({ ref: 'you' }) && Object.keys(d).length === 2 && firstAlt(verb) === 'return') {
      const sp = st.specs.get(s.what.id);
      if (sp?.kind === 'object' && sp.differentManaValues === true && sp.filter?.zone === 'graveyard' && sp.filter.owner === 'you') {
        text = alt(text, `return from your graveyard to the battlefield ${specPhrase(sp, cloneState(before), { noZone: true })}`);
      }
    }
    // edh-misc-3 (CR 400.3, 110.2; family return-from-battlefield-to-your-hand; Sanctum of Eternity): a permanent you own, returned to its owner's hand, is also "return target
    // commander you own from the battlefield to your hand": the zone said, the hand being yours because the permanent is
    if (s.what.ref === 'target' && d.zone === 'hand' && d.owner === undefined && leadPlain && st.specs.get(s.what.id)?.filter?.owner === 'you' && (st.specs.get(s.what.id)?.filter?.zone ?? 'battlefield') === 'battlefield' && firstAlt(verb) === 'return') {
      text = alt(text, `${verb} ${what} from the battlefield to your hand`);
    }
    // edh-misc-3 (CR 608.2b, 205.3m; family move-all-except-for-tail): the exception of a group is also said after the destination, "Return all creatures to their owners' hands
    // except for Krakens, Leviathans, Octopuses, and Serpents." (Whelming Wave, Slinn Voda); a group of one kind of object only (the exception is a described set, not a reference)
    if (s.what.ref === 'each' && s.what.filter.not !== undefined && s.until === undefined && d.zone !== 'exile' && s.what.filter.not.is === undefined && (!('anyOf' in s.what.filter.not) || s.what.filter.not.anyOf!.every((x) => Object.keys(x).length === 1 && (x.types?.length === 1 || (x.subtypes?.length ?? 0) >= 1)))) { // edh-next-86 (Cyclone Summoner): a list of subtypes and a land type
      const { not, ...rest } = s.what.filter;
      const copy = cloneState(before);
      text = alt(text, `${verb} ${movedThing({ ref: 'each', filter: rest }, copy)} ${destPhrase(d, copy, plural, false, firstAlt(verb) === 'return')} except for ${K.np(not, copy, { det: 'none', plural: true, noZone: true })}`);
    }
    // edh-next-6 (CR 400.3, 608.2c; family return-group-destination-first; Engulf the Shore): a group returned to its owners' hands is also said destination first,
    // "Return to their owners' hands all creatures with toughness less than or equal to the number of Islands you control."
    // (combined copy, batch 5: the owners' hands only; "your hand" first is p2-graveyard-1's reading, for cards you own: "Return to your hand all creature cards
    // in an opponent's graveyard" stays manual, the cards go to their owner's hand)
    if (s.what.ref === 'each' && d.zone === 'hand' && d.owner === undefined && s.until === undefined && firstAlt(verb) === 'return') {
      text = alt(text, `${verb} to ${plural ? alt("their owners' hands", "their owner's hand", "its owner's hand") : "its owner's hand"} ${what}`); // edh-c-10: "return to its owner's hand each creature that player controls with ..." (Noetic Scales)
    }
    // r5-fxz (CR 110.2a): a group put onto the battlefield under your control is also said destination first, "Put onto the battlefield under your control all
    // creature cards in your opponents' graveyards that were put there from the battlefield this turn." (Supper for Spiders)
    if (d.zone === 'battlefield' && s.what.ref === 'each' && typeof d.controller === 'object' && d.controller.ref === 'you' && !d.tapped && !d.attacking && !d.faceDown && !d.transformed
      && d.attachedTo === undefined && d.attachedToPlayer === undefined && (d.counters ?? []).length === 0 && s.until === undefined) {
      text = alt(text, `put onto the battlefield under your control ${what}`);
    }
    // edh-d-73 (CR 708.3, 110.2a; family return-facedown-tapped-control-first; Missy): one object returned to the battlefield face down and tapped is also said with its control first,
    // "return it to the battlefield under your control face down and tapped" (the model says "put it onto the battlefield tapped face down under your control")
    if (d.zone === 'battlefield' && d.faceDown === true && d.tapped === true && !plural && !d.attacking && !d.transformed && d.attachedTo === undefined && d.attachedToPlayer === undefined && (d.counters ?? []).length === 0
      && s.until === undefined && JSON.stringify(d.controller) === JSON.stringify({ ref: 'you' }) && d.faceDownAs === undefined && firstAlt(verb) !== 'exile') {
      text = alt(text, `return ${what} to the battlefield under your control face down and tapped`);
    }
    // CLOUD std-tmt (CR 508.4, 608.2c; family enters-attacking-rider): an object put onto the battlefield tapped and attacking a named player is also said in a
    // sentence of its own after the move, "Put ... onto the battlefield under your control. It enters tapped and attacking that player." (parser rider
    // rid.stdtmt.enters.tapped.attacking.player)
    if (d.zone === 'battlefield' && d.tapped === true && typeof d.attacking === 'object' && 'defender' in d.attacking && !d.faceDown && !d.transformed && d.attachedTo === undefined && d.attachedToPlayer === undefined && (d.counters ?? []).length === 0) {
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
    // edh-c-23 (CR 401.4, 400.3; Misinformation, eff.edhv23.put.lib.top.anyorder.theirLibrary): cards targeted in the graveyard of one opponent go to that opponent's library, "on top of their library"
    // (the library of the one player whose graveyard they are in) as well as "on top of their owners' libraries"
    if (s.what.ref === 'target' && d.zone === 'library' && d.position === 'top' && d.owner === undefined && spec?.filter?.owner === 'opponent' && spec.filter.zone === 'graveyard' && d.order === 'chosen') {
      text = alt(text, `${verb} ${what} on top of their library in any order`);
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
      // edh-next-79 (CR 400.7, 608.2c, Legion's Initiative: "... those creatures gain haste"): a group of permanents exiled together is also named by what they were, "those creatures"
      const was = s.what.ref === 'each' ? infoOfRef(s.what, st).nouns.filter((n) => n !== 'card' && n !== 'permanent') : [];
      // trek-21 (CR 406.1, 401.4; Lieutenant Nyota Uhura): the cards a TARGET player exiled from the top of their library were exiled by that player (as an exile-until's are, exiledRestOfOtherPlayer): "Then that player puts the rest on the bottom of their library"
      const exiler = s.what.ref === 'topCards' && s.what.player.ref === 'target' ? { exiledBy: s.what.player, exiledTop: true as const } : {};
      st.info.set(`b:${s.as}`, { ...(prev ?? { nouns: ['card', ...was], plural: true }), thisWay: 'exiled this way', ...exiler });
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
    // edh-zones-14 (family and-you-plain-clause; Witch of the Moors): a return to your hand is also "and you return ..." after another player's clause (Clause.andYou)
    if (top === null) return plain(text, { ...(s.what.ref === 'each' && restOfGroup(s.what.filter) !== null ? { leadThen: true } : {}), ...(d.zone === 'hand' && firstAlt(verb) === 'return' ? { andYou: text } : {}) });
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
    if (s.as !== undefined) st.info.set(`r:${s.as}`, { nouns: destroyedNouns(s.what, st), plural: true, ...(s.boundTo === 'graveyard' ? { thisWay: 'put into a graveyard this way', moved: 'graveyard' as const } : { thisWay: 'destroyed this way', moved: 'destroyed' as const }), ...(s.what.ref === 'target' ? { diesRef: s.what } : {}) }); // Cloud C7; edh-mana-keywords-7: boundTo, what went to a graveyard (CR 614.6); edh-perms-5: diesRef: `moved` (render/moved.ts)
    putIntoGraveyardThisWay(s, st); // Cloud std-eoe: "a creature card put into a graveyard this way" (render/np.ts)
    destroyedOne(s, st);
    if (dealt !== null && s.regeneration === undefined) return plain(alt(`destroy ${what}`, `if ${dealt} is dealt damage this way, destroy it`), { standalone: true });
    // edh-c-65 (CR 701.8a, 109.2; Mageta the Lion; template eff.edhv65.destroy.all.exceptSelf): "destroy all creatures except for ~" is every object of the description but the one
    // with the ability, which "all other creatures" also says
    const exceptSelf = s.what.ref === 'each' && 'filter' in s.what && JSON.stringify(s.what.filter.not) === '{"self":true}'
      ? ((): string => {
        const base = permanentRef({ ref: 'each', filter: { ...s.what.filter, not: undefined } } as ObjRef, cloneState(st));
        return alt(`destroy ${what}`, `destroy ${base} except for ~`, `destroy ${base} except ~`);
      })() : null;
    if (exceptSelf !== null) return plain(s.regeneration === 'cant' ? `${exceptSelf}. ${noRegeneration(s, st)}` : exceptSelf, { standalone: true });
    if (s.regeneration !== 'cant') return plain(forEachOpponent(s.what, `destroy ${what}`, st));
    // edh-c-99 (CR 701.8a, 701.19c, 608.2c; family destroy-and-no-regen, Knight of the Mists): the sentence of the regeneration is also joined with "and": "destroy target Knight and it can't be regenerated"
    return plain(s.regeneration === 'cant' ? alt(`destroy ${what}. ${noRegeneration(s, st)}`, `destroy ${what} and ${anaphor(infoOfRef(s.what, st), 'subject').text} can't be regenerated`) : `destroy ${what}. ${noRegeneration(s, st)}`, { standalone: true });
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
    // edh-d-28 (CR 608.2d, 701.21a; Tyrant of Discord): "target opponent chooses a permanent they control at random and sacrifices it": one permanent of any description, picked by
    // the game, of a single player other than you (the verbs are said in the third person singular)
    if (s.mode === 'random') {
      if (s.who.ref === 'you' || s.count !== 1 || Object.keys(s.filter).length !== 0 || s.cantAs !== undefined || s.chooser !== undefined || s.keepTypes !== undefined || s.keepFilter !== undefined || s.exploit !== undefined
        || K.player(s.who, cloneState(st), 'subject').person !== 'sg') throw new NoRenderer('a sacrifice at random other than one permanent of a single player other than you');
      if (s.as !== undefined) st.info.set(`r:${s.as}`, { ...movedInfo('sacrificed', ['permanent']), sacrificedBy: JSON.stringify(s.who) });
      return byPlayer(s.who, st, 'choose', 'a permanent they control at random and sacrifices it');
    }
    // edh-next-147 (CR 700.8, 701.21a; Stick Together): "each player chooses a party from among creatures they control, then sacrifices the rest"
    if (s.mode === 'keepParty') {
      const who = s.who;
      if (who.ref !== 'each' || (who.who !== 'player' && who.who !== 'opponent') || JSON.stringify(s.filter) !== '{"types":["Creature"]}' || s.keepTypes !== undefined || s.keepFilter !== undefined
        || s.chooser !== undefined || s.cantAs !== undefined || s.exploit !== undefined) throw new NoRenderer('a party kept other than by each player or each opponent among the creatures they control');
      return acting(playerKey(who) ?? 'x', 'choose a party from among creatures you control and sacrifice the rest', `each ${who.who} chooses a party from among creatures they control, then sacrifices the rest`);
    }
    // FAST5 T66 (CR 110.4, 701.21a): "each opponent chooses a permanent they control of each permanent type and sacrifices the rest": one permanent of each type kept, among
    // every permanent the players control (no description of the permanents)
    if (s.mode === 'keepEachType') {
      // pc-players-1 (CR 110.4, 205.2a, 701.21a): the four types of Cataclysmic Gearhulk and Tragic Arrogance (artifact, creature, enchantment, planeswalker), nonland permanents sacrificed
      const FOUR = ['Artifact', 'Creature', 'Enchantment', 'Planeswalker'];
      const nonland = JSON.stringify(s.filter) === JSON.stringify({ notTypes: ['Land'] });
      const four = JSON.stringify(s.keepTypes) === JSON.stringify(FOUR) && s.count === 1 && nonland;
      if (four && s.who.ref === 'each' && (s.who.who === 'player' || s.who.who === 'opponent' /* edh-d-61 (Ajani, Nacatl Avenger) */) && s.chooser === undefined && s.keepFilter === undefined) {
        return acting(playerKey(s.who) ?? 'x', 'choose an artifact, a creature, an enchantment, and a planeswalker from among the nonland permanents you control and sacrifice the rest',
          `each ${s.who.who} chooses an artifact, a creature, an enchantment, and a planeswalker from among the nonland permanents they control, then sacrifices the rest`);
      }
      if (four && s.who.ref === 'each' && s.who.who === 'player' && s.chooser?.ref === 'you' && s.keepFilter !== undefined && JSON.stringify(s.keepFilter) === '{}') {
        return plain(`for each player, you choose from among the permanents that player controls an artifact, a creature, an enchantment, and a planeswalker. ${alt('then ', '')}each player sacrifices all other nonland permanents they control`, { standalone: true });
      }
      // edh-next-145 (CR 608.2d, 614.15; Mythos of Snapdax): the same sacrifice with you choosing the kept permanents among each player's nonland permanents is said only as the
      // "instead" of the plain one ("If C, you choose the permanents for each player instead.", render/self-replacement.ts), the wording that names the earlier sentence's permanents
      if (four && s.who.ref === 'each' && s.who.who === 'player' && s.chooser?.ref === 'you' && Object.keys(s.chooser).length === 1 && s.keepFilter === undefined) {
        return plain('you choose the permanents for each player');
      }
      // edh-next-116 (CR 110.4, 205.2a, 701.21a; Cataclysm): the permanents of every kind (lands too) are chosen among, a land kept as the fourth type; the rest are sacrificed
      if (JSON.stringify(s.keepTypes) === JSON.stringify(['Artifact', 'Creature', 'Enchantment', 'Land']) && s.count === 1 && Object.keys(s.filter).length === 0 && s.who.ref === 'each' && s.who.who === 'player' && s.chooser === undefined && s.keepFilter === undefined) {
        return acting(playerKey(s.who) ?? 'x', 'choose an artifact, a creature, an enchantment, and a land from among the permanents you control and sacrifice the rest',
          'each player chooses from among the permanents they control an artifact, a creature, an enchantment, and a land, then sacrifices the rest');
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
      // edh-next-108 (CR 701.21a, 608.2c; Invoke Despair): the sacrificing player is the actor of a later "If they do" / "If they can't" (render/cond.ts `did`)
      bind(st, s.as, { nouns: [...new Set([...K.nounsOf({ ...s.filter, controller: undefined }), 'card'])], plural: !one, zone: 'graveyard', ...(one && s.mode === undefined ? { actor: playerKey(s.who) } : {}) });
    }
    // std-rx4 (CR 701.21a, 608.2h): what YOUR sacrifice of one permanent sacrificed is "the sacrificed <noun>" (its last known information; parser/lower/mentions.ts gives a
    // participle-only mention, so no other wording names it): "If you do, draw X cards, ..., where X is the sacrificed creature's power"
    if (s.as !== undefined && s.who.ref === 'you' && s.count === 1 && (s.mode === undefined || s.mode === 'choose')) {
      // edh-zones-22: one of a group an earlier part named is called by the noun of that group ("the sacrificed creature" after "sacrifice one of them")
      const group = s.filter.is;
      const nouns = group === undefined ? K.nounsOf({ ...s.filter, controller: undefined }) : (group.ref === 'event' ? roleInfo(group.role, st).info : infoOfRef(group, st)).nouns.filter((n) => n !== 'card');
      bind(st, s.as, { nouns: [...new Set([...nouns, 'card'])], plural: false, zone: 'graveyard', alts: nouns.map((n) => `the sacrificed ${n}`) });
    }
    // edh-next-127 (CR 701.21a, 608.2c, 400.7; Danse Macabre): what each player's sacrifice of one permanent put into graveyards is "<cards> put into a graveyard this way" (parser/lower/mentions.ts#sacrificedByEachOf), as a destroy's group is
    if (s.as !== undefined && s.who.ref === 'each' && s.who.who === 'player' && s.count === 1 && (s.mode === undefined || s.mode === 'choose') && s.chooser === undefined) st.info.set(`b:${s.as}`, { nouns: ['card'], plural: true, thisWay: PUT_INTO_GRAVEYARD_THIS_WAY });
    if (s.as !== undefined) st.info.set(`r:${s.as}`, { ...movedInfo('sacrificed', K.nounsOf(s.filter)), sacrificedBy: JSON.stringify(s.who) }); // Cloud C7: "if a Goblin is sacrificed this way"; audit-fix-1: who
    // edh-c-103 (CR 701.21a, 608.2c; Woebringer Demon): the sacrifice of one player who is not you, named for "If the player can't, sacrifice ~." later: that player is its actor
    // edh-next-108 (Gisa's Favorite Shovel): the same for the defending player's sacrifice, "If they do, you create a Walker token."
    if (s.as !== undefined && (s.who.ref === 'event' || s.who.ref === 'defending') && s.mode === undefined && s.count === 1 && st.info.get(`b:${s.as}`) === undefined) bind(st, s.as, { nouns: [], plural: false, actor: playerKey(s.who) });
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
      // edh-next-108 (CR 701.21a, 107.1a; Legate Lanius): "each opponent sacrifices a tenth of the creatures they control of their choice, rounded up" (the same count with 10 for 2)
      const tenth = s.mode === undefined && s.who.ref !== 'you' && s.who.ref !== 'each' ? halfOfControlled(s.count, s.filter, s.who, 10)
        : s.mode === undefined && s.who.ref === 'each' ? halfOfControlled(s.count, s.filter, { ref: 'iterating' }, 10) : null;
      if (tenth !== null) return `a tenth of the ${K.np(f, st, { det: 'none', plural: true, noController: true })} they control of their choice, rounded ${tenth}`;
      // edh-next-44 (CR 701.21a, 107.1a; Rakdos the Defiler; family half-of-controlled): your own sacrifice of half the permanents of a description you control, "sacrifice half the non-Demon permanents you control, rounded up"
      const halfYours = s.mode === undefined && s.who.ref === 'you' && s.cantAs === undefined && s.filter.controller === 'you' ? halfOfControlled(s.count, s.filter, s.filter.controller as never) : null;
      if (halfYours !== null) return `half the ${K.np(s.filter, st, { det: 'none', plural: true })}, rounded ${halfYours}`;
      // Standard round 4, r4-refs (CR 701.21a, 109.2): "target player sacrifices a creature of their choice other than enchanted creature": the one object left
      // out is said after "of their choice"
      const notOne = f.not;
      if (s.who.ref !== 'you' && notOne !== undefined && notOne.is !== undefined && Object.keys(notOne).length === 1) {
        return `${countedNp({ ...f, not: undefined }, s.count, st)} of their choice other than ${K.obj(notOne.is, st, 'object').text}`;
      }
      // edh-players-9 (CR 701.21a, 510.2; Witch-king of Angmar): "sacrifices a creature of their choice that dealt combat damage to you this turn": the choice is said before the
      // relative clause that says what may be chosen (only another player's sacrifice, only in this order)
      if (s.who.ref !== 'you' && f.dealtDamageToYouThisTurn !== undefined) {
        const base = countedNp({ ...f, dealtDamageToYouThisTurn: undefined }, s.count, st);
        return `${base} of their choice that dealt ${f.dealtDamageToYouThisTurn === 'combat' ? 'combat ' : ''}damage to you this turn`;
      }
      // edh-d-12 (CR 701.21a, 509.1g; Labyrinth Raptor): "defending player sacrifices a creature of their choice that's blocking it": the choice is said before the relative clause that says
      // what may be chosen (only another player's sacrifice, one creature, in this order)
      if (s.who.ref !== 'you' && f.blockingObject !== undefined && s.mode === undefined) {
        return `${countedNp({ ...f, blockingObject: undefined }, s.count, st)} of their choice that is blocking ${K.obj(f.blockingObject, st, 'object').text}`;
      }
      // edh-next-72 (CR 701.21a, 205.2a, 608.2c; Martyr's Bond, template eff.edhn72.eachOpponent.sacrifices.permanent.sharesCardType): "each opponent sacrifices a permanent of their choice that
      // shares a card type with it": the choice is said before the relative clause that says what may be chosen (only each opponent's sacrifice of one permanent, in this order)
      if (s.who.ref === 'each' && s.who.who === 'opponent' && s.count === 1 && s.mode === undefined && Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).join() === 'sharesWith'
        && f.sharesWith?.quality === 'cardType' && f.sharesWith.other === undefined && Object.keys(f.sharesWith).length === 2) {
        return `a permanent of their choice that shares a card type with ${K.obj(f.sharesWith.with, st, 'object').text}`;
      }
      // edh-zones-22 (CR 701.21a, 608.2c; Descendants' Fury): your sacrifice of one of a group an earlier part of the ability named, "you may sacrifice one of them" (template eff.edhz22.sacrifice.oneOfThem)
      const members = f.is !== undefined && Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).length === 1 && s.who.ref === 'you' && s.count === 1;
      if (members) return `one of ${K.obj(f.is!, st, 'object').text}`;
      // edh-c-5 (CR 701.21a, 107.3; Thoughts of Ruin): "each player sacrifices a land of their choice for each card in your hand": one permanent for each object a description names
      if (typeof s.count === 'object' && s.count.q === 'count' && s.count.of.ref === 'each' && 'filter' in s.count.of && s.who.ref !== 'you' && s.mode === undefined) {
        const each = K.np(s.count.of.filter, st, { det: 'none' });
        return `${countedNp(f, 1, st)} of their choice for each ${each.replace(/^(an?|the) /, '')}`;
      }
      // edh-d-9 (CR 701.21a, 701.9a, 608.2c; Malfegor): "each opponent sacrifices a creature of their choice for each card discarded this way": as many permanents as the discard of the same ability moved cards
      if (typeof s.count === 'object' && s.count.q === 'resultCount' && s.count.which?.isCard === true && s.who.ref !== 'you' && s.mode === undefined && st.info.get(`r:${s.count.step}`)?.thisWay === 'discarded this way') {
        return alt(countedNp(f, s.count, st), `${countedNp(f, 1, st)} of their choice for each card discarded this way`);
      }
      // edh-b-12 (CR 701.21a, 122.1; Smokestack): "that player sacrifices a permanent of their choice for each soot counter on ~": one permanent for each counter of a kind on the source
      if (typeof s.count === 'object' && s.count.q === 'counters' && s.count.kind !== undefined && JSON.stringify(s.count.on) === '{"ref":"self"}' && s.who.ref !== 'you' && s.mode === undefined) {
        return `${countedNp(f, 1, st)} of their choice for each ${s.count.kind} counter on ${K.obj({ ref: 'self' }, st, 'object').text}`;
      }
      // edhd19 (CR 701.21a, 701.38a, 608.2h; Capital Punishment): "each opponent sacrifices a creature of their choice for each death vote": one permanent for each vote the word got
      if (typeof s.count === 'object' && s.count.q === 'votes' && s.who.ref !== 'you' && s.mode === undefined) return `${countedNp(f, 1, st)} of their choice for each ${s.count.choice} vote`;
      // edh-c-45 (CR 701.21a, 119.3; family sacrifice-for-each-life-lost; Lich's Tomb): "sacrifice a permanent for each 1 life you lost" is the sacrifice of as many permanents as the life you lost (the event
      // of a trigger on your life loss, and nothing else)
      const lostLife = (st.trigger ?? []).length === 1 && st.trigger![0]!.ev === 'life' && st.trigger![0]!.change === 'loss' && st.trigger![0]!.player === 'you';
      if (lostLife && s.who.ref === 'you' && s.mode === undefined && typeof s.count === 'object' && s.count.q === 'eventAmount') {
        return alt(countedNp(f, s.count, st), `${countedNp(f, 1, st)} for each 1 life you lost`);
      }
      const np = countedNp(f, s.count, st);
      // edh-c-106 (CR 701.21a, 608.2d; Demonic Hordes): the choice is an opponent's: "sacrifice a land of an opponent's choice" (your own sacrifice, no mode)
      if (s.chooser !== undefined) {
        if (s.chooser.ref !== 'anOpponent' || s.who.ref !== 'you' || s.mode !== undefined) throw new NoRenderer('a sacrifice chosen by someone else than an opponent of the controller');
        return `${np} of an opponent's choice`;
      }
      // edh-next-7 (CR 701.21a, 208.1, 608.2d; family sacrifice-greatest-power-they-control; Szat's Will): "sacrifices a creature they control with the greatest power" says the same as
      // "... with the greatest power among creatures they control": the power at least that of every creature the sacrificing player controls
      const greatest = s.who.ref !== 'you' && s.count === 1 && Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).join() === 'types,power' && JSON.stringify(f.types) === '["Creature"]'
        && JSON.stringify(f.power) === JSON.stringify({ op: '>=', value: { q: 'stat', stat: 'power', agg: 'max', of: { ref: 'each', filter: { types: ['Creature'], controller: { ref: 'iterating' } } } } });
      if (greatest) return alt(np, `${np} of their choice`, 'a creature they control with the greatest power');
      // edh-d-99 (CR 701.21a, 202.3, 608.2d; family sacrifice-greatest-mv-creature-or-planeswalker; Riveteers Charm): "target opponent sacrifices a creature or planeswalker they control with the greatest
      // mana value among creatures and planeswalkers they control": one of that player's creatures and planeswalkers whose mana value is at least that of each of them (only this one shape)
      const pwGroup = { types: ['Creature', 'Planeswalker'], controller: s.who };
      const greatestMv = s.who.ref === 'target' && s.count === 1 && s.mode === undefined && Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).join() === 'types,manaValue'
        && JSON.stringify(f.types) === JSON.stringify(pwGroup.types) && JSON.stringify(s.filter.controller) === JSON.stringify(s.who)
        && JSON.stringify(f.manaValue) === JSON.stringify({ op: '>=', value: { q: 'stat', stat: 'manaValue', of: { ref: 'each', filter: pwGroup }, agg: 'max' } });
      if (greatestMv) return alt(np, 'a creature or planeswalker they control with the greatest mana value among creatures and planeswalkers they control');
      // FAST1 T6 (CR 701.21a): the sacrificing player chooses; current Oracle wording says so for another player ("sacrifices a creature of their choice")
      // edh-c-53 (CR 701.21a, 702.9a; Clip Wings): "sacrifices a creature of their choice with flying": the choice is said before the keyword the creature must have (family sacrifice-choice)
      const withKeyword = s.who.ref !== 'you' && typeof f.keyword === 'string' ? [`${countedNp({ ...f, keyword: undefined }, s.count, st)} of their choice with ${f.keyword.toLowerCase()}`] : [];
      return s.who.ref !== 'you' ? alt(np, `${np} of their choice`, ...withKeyword) : np;
    });
    bindCant(st, s.cantAs, s.who); // C6: "each opponent who can't"
    // edh-d-20 (CR 701.21a, 109.4, 608.2e; Tide of War, eff.edhd20.sacrificed.eachFilter.byItsController): every player sacrifices all permanents of a description they control, said the other way:
    // "Each blocking creature is sacrificed by its controller" (family sacrificed-by-its-controller)
    if (s.mode === 'all' && s.who.ref === 'each' && s.who.who === 'player' && s.cantAs === undefined && typeof s.filter.controller === 'object' && s.filter.controller.ref === 'iterating' && s.count === 1) {
      const theirs = `each ${K.np({ ...s.filter, controller: undefined }, cloneState(st), { det: 'none' })} is sacrificed by its controller`;
      return acting(c.actor ?? 'x', alt(c.imp, theirs), alt(c.sub, theirs), { standalone: true });
    }
    // edh-next-72 (CR 701.21a, 205.2a, 608.2c; Fatal Grudge, template eff.edhn72.eachOpponent.chooses.sharesCardType.andSacrificesIt): each opponent's sacrifice of one permanent that shares a
    // card type with an object is also "Each opponent chooses a permanent they control that shares a card type with X and sacrifices it" (family choose-and-sacrifice-it)
    const sw = s.filter.sharesWith;
    if (s.who.ref === 'each' && s.who.who === 'opponent' && s.count === 1 && s.mode === undefined && s.cantAs === undefined && sw?.quality === 'cardType' && sw.other === undefined && Object.keys(sw).length === 2
      && Object.keys(s.filter).filter((k) => (s.filter as Record<string, unknown>)[k] !== undefined).join() === 'sharesWith') {
      const chooses = `each opponent chooses a permanent they control that shares a card type with ${K.obj(sw.with, cloneState(st), 'object').text} and sacrifices it`;
      return acting(c.actor ?? 'x', c.imp, alt(c.sub, chooses), { standalone: true });
    }
    return c;
  },

  counter: (s: StepOf<'counter'>, st: RenderState): Clause => {
    const what = K.obj(s.what, st, 'object').text;
    // r4-moved (CR 701.6a, 608.2c): what the step countered, spells and abilities, for "for each spell and ability countered this way" (render/qty.ts, resultCount)
    // std-rx30 (CR 400.7, 701.6a): after "if a permanent spell is countered this way, exile it instead ...", the card it became is "that card" (Thranduil's Decree)
    if (s.as !== undefined && s.toIf !== undefined) bind(st, s.as, { nouns: ['card'], plural: false });
    else if (s.as !== undefined && s.to !== undefined && s.to.zone === 'exile' && s.sourceEffect === undefined) { bind(st, s.as, { nouns: ['card'], plural: false }); st.info.set(`r:${s.as}`, { nouns: ['spell and ability'], plural: true, thisWay: 'countered this way' }); } // edh-d-43 (CR 701.6a, 400.7; Kheru Spellsnatcher): after an exile-instead of the countered spell, the card it became is "that card"
    else if (s.as !== undefined) st.info.set(`r:${s.as}`, { nouns: ['spell and ability'], plural: true, thisWay: 'countered this way' });
    // std-rx30 (CR 113.7, 611.2a; Tishana's Tidebinder): "If an ability of an artifact, creature, or planeswalker is countered this way, that permanent loses all
    // abilities for as long as this creature remains on the battlefield."
    const fx = s.sourceEffect;
    if (fx !== undefined && !s.to && fx.mods.length === 1 && JSON.stringify(fx.mods[0]) === JSON.stringify({ layer: 6, removeAll: true })) {
      const of = K.np({ ...fx.filter, isCard: undefined }, st, { det: 'a' });
      return plain(`counter ${what}. if an ability of ${of} is countered this way, that permanent loses all abilities ${K.dur(fx.duration, st)}`, { standalone: true });
    }
    if (fx !== undefined) throw new NoRenderer('an effect on the source of a countered ability other than "loses all abilities"');
    // edh-d-43 (CR 701.6a, 113.7a, 701.8a, 602.5; Green Slime, Trickbind): what happens to the permanent that is the source of the countered ability
    const then = s.sourceThen;
    if (then !== undefined) {
      if (s.to || fx !== undefined || Object.keys(then.filter).length !== 0) throw new NoRenderer('an effect on the source of a countered ability beside another one, or for a described source');
      return plain(`counter ${what}. if a permanent's ability is countered this way, ${then.do === 'destroy' ? 'destroy that permanent' : "activated abilities of that permanent can't be activated this turn"}`, { standalone: true });
    }
    if (!s.to) return plain(`counter ${what}`);
    return plain(`counter ${what}. ${counterTail(s, st)}`, { standalone: true });
  },

  createToken: (s: StepOf<'createToken'>, st: RenderState): Clause => {
    const c = byPlayer(s.who, st, 'create', () => {
      const n = s.count;
      // what is said after the token words: "tapped and attacking", "attached to it", "with a +1/+1 counter on it"
      // `tappedSaid`: "tapped" was already said before the token words ("create a tapped Treasure token")
      const tail = (plural: boolean, tappedSaid = false, stx: typeof st = st): string => {
        let text = '';
        const that = plural ? ' that are' : " that's";
        // cmd1 (CR 508.4): "tapped and attacking that opponent": the player the tokens attack (a planeswalker of theirs has no wording here)
        // edh-players-3 (CR 508.4, 702.116a; Adeline): "tapped and attacking that player or a planeswalker they control", the player named once, then "they" for that player
        const whom = typeof s.attacking === 'object' ? ` ${K.player(s.attacking.defender, st, 'object').text}${s.attacking.orPlaneswalkers === true ? ' or a planeswalker they control' : ''}` : '';
        if (s.tapped && s.attacking) text += alt(`${that} tapped and attacking${whom}`, ` tapped and attacking${whom}`);
        else if (s.tapped && !tappedSaid) text += alt(`${that} tapped`, ' tapped');
        else if (s.attacking) text += alt(`${that} attacking${whom}`, ` attacking${whom}`);
        // edh-combat-4 (CR 506.3e; Brimaz): "that's blocking that creature": the attacker the tokens block (never with tapped or attacking, which has no wording)
        if (s.blocking !== undefined) {
          if (s.tapped || s.attacking) throw new NoRenderer('tokens that are blocking and also tapped or attacking');
          text += `${that} blocking ${K.obj(s.blocking, st, 'object').text}`;
        }
        if (s.attachTo) text += ` attached to ${K.obj(s.attachTo, stx, 'object').text}`;
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
        // edh-perms-5 (CR 111.4, 107.3; Urabrask's Forge): "an X/1 red Phyrexian Horror creature token ... where X is the number of oil counters on this artifact": only ONE of
        // power and toughness computed, the other a plain number, one token (the same X wording; the "base power and toughness each equal to" alternative below needs both)
        const oneSide = tp !== undefined && tt !== undefined && isComputed(tp) !== isComputed(tt);
        // edh-c-102 (CR 111.4, 208.3, 608.2h; Ritual of the Returned; family token-power-toughness-sentence): two different computed numbers, one token for you: "Create a black Zombie creature token. Its power is equal to
        // that card's power and its toughness is equal to that card's toughness." (the token words, then a sentence that sets power and toughness)
        if (tp !== undefined && tt !== undefined && isComputed(tp) && isComputed(tt) && JSON.stringify(tp) !== JSON.stringify(tt) && n === 1 && !s.tapped && !s.attacking && s.blocking === undefined && !s.attachTo
          && (s.counters?.length ?? 0) === 0 && (s.token.abilities?.length ?? 0) === 0 && (s.token.keywords?.length ?? 0) === 0 && s.who.ref === 'you') {
          const { power: _p2, toughness: _t2, ...bare } = s.token;
          const before = cloneState(st);
          return `${tokenText(bare, 1, false, before)}. its power is equal to ${K.qty(tp, before)} and its toughness is equal to ${K.qty(tt, before)}`;
        }
        if (tp === undefined || tt === undefined || (!oneSide && JSON.stringify(tp) !== JSON.stringify(tt)) || typeof n !== 'number' || (n !== 1 && oneSide)) throw new NoRenderer('a token with a computed power and toughness other than one X/X token');
        const x = { ...s.token, power: isComputed(tp) ? { q: 'X' as const } : tp, toughness: isComputed(tt) ? { q: 'X' as const } : tt };
        // r5-fxb (family token-base-pt-equal, CR 111.4, 608.2h): also "a green Fungus Dinosaur creature token with base power and toughness each equal to ..." (no
        // other words after the token)
        const { power: _p, toughness: _t, ...noPt } = s.token;
        const before = cloneState(st);
        const many = n !== 1; // edh-b-7 (CR 111.2, 107.3; Assemble the Entmoot): "create three tapped X/X green Treefolk creature tokens, where X is ...": a fixed number of tokens, all of the one computed size
        // edh-next-109 (CR 107.3, 608.2h; Tivash, Gloom Summoner): a number a sentence before already said as "X" (steps-flow.ts#payLifeWhereXThen) has no "where X is" clause again
        const xq = isComputed(tp) ? tp : tt;
        const whereX = `${tokenText(x, n, many, st)}${tail(many)}${saidX(xq, st) ? '' : `, where X is ${K.qty(xq, st)}`}`;
        if (oneSide) return whereX;
        // edh-combat-4 (CR 508.4, 111.1; Ghalta and Mavren; family token-tapped-attacking-front): "Create a tapped and attacking X/X green Dinosaur creature token with trample,
        // where X is ..." says the two flags before the token words (one token, no counters or attachment, attacking whoever its controller chooses)
        if (n === 1 && s.tapped === true && s.attacking === true && s.blocking === undefined && !s.attachTo && (s.counters?.length ?? 0) === 0) {
          return alt(whereX, `${tokenText(x, 1, false, st, 'tapped and attacking')}, where X is ${K.qty(tp, st)}`);
        }
        // edh-b-7 (family token-tapped-front): "tapped" before the token words, "Create three tapped X/X green Treefolk creature tokens, where X is ..."
        if (s.tapped === true && !s.attacking && s.blocking === undefined && !s.attachTo && (s.counters?.length ?? 0) === 0 && (s.token.abilities?.length ?? 0) === 0 && (s.token.keywords?.length ?? 0) === 0) {
          return alt(whereX, `${tokenText(x, n, many, st, 'tapped')}, where X is ${K.qty(tp, st)}`);
        }
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
          // edh-b-9 (CR 111.4, 608.2c; Ribtruss Roaster; family token-rider): ... and the same with "a number of ... tokens equal to ..." (1 new alt site)
          options.push(`${tokenText({ ...tk, abilities: undefined }, 'a number of', true, st)}${tail(true)} equal to ${v}. ${alt('they have', 'the tokens have')} ${quoted}`);
        }
        if (per) options.unshift(`${tokenText(s.token, 1, false, st)}${tail(false)} for each ${per.singular}`);
        // edh-zones-24 (CR 111.4, 608.2c; Glimpse the Impossible): "Create a 0/1 Eldrazi Spawn creature token for each card put into your graveyard this way. Those tokens have "..."": the next sentence gives the tokens their abilities
        if (per && tk.abilities && tk.abilities.length > 0 && !tk.predefined && namedTokenOf(tk) === undefined) {
          options.push(`${tokenText({ ...tk, abilities: undefined }, 1, false, st)}${tail(false)} for each ${per.singular}. ${alt('they have', 'the tokens have', 'those tokens have')} ${tk.abilities.map((a) => quotedAbility(a, st, 'token')).join(' and ')}`);
        }
        // edh-d-4 (CR 107.3, 111.2; Eiganjo Uprising): "creates X minus one 2/2 ... tokens": X of the spell with a number added or taken away is said in place of the count (the only wording of it; no "where X is X minus 1")
        if (typeof n === 'object' && n.q === 'math' && (n.op === '-' || n.op === '+') && n.args.length === 2 && n.args.every((a) => typeof a === 'number' || (typeof a === 'object' && a.q === 'X'))) {
          options.push(`${tokenText(s.token, v, true, st)}${tail(true)}`);
        }
        // CLOUD std-misc (CR 107.1a, 111.2; The Goose Mother): "create half X Food tokens, rounded up": half the number, the rounding said after the token words
        if (typeof n === 'object' && n.q === 'math' && (n.op === 'ceilDiv' || n.op === 'floorDiv') && n.args.length === 2 && n.args[1] === 2) {
          options.push(`${tokenText(s.token, `half ${K.qty(n.args[0] as Quantity, st)}`, true, st)}${tail(true)}, rounded ${n.op === 'ceilDiv' ? 'up' : 'down'}`);
        }
        // edh-perms-2 (CR 111.2, 107.1; Pest Infestation): "create twice X 1/1 ... Pest creature tokens": twice a number (parser/holes/qty.ts "twice Q")
        if (typeof n === 'object' && n.q === 'math' && n.op === '*' && n.args.length === 2 && n.args[0] === 2 && typeof n.args[1] === 'object') {
          options.push(`${tokenText(s.token, `twice ${K.qty(n.args[1], st)}`, true, st)}${tail(true)}`);
        }
        // FAST3 T17 (CR 603.2, 608.2h): the amount of the triggering event ("whenever ~ deals combat damage to a player, create that many 1/1 green Insect
        // creature tokens"; design 3.5 `eventAmount`), or the number of things an earlier step of this ability named ("that many", resultCount) — as for
        // draws (render/steps-cards.ts, FAST1 T6 / FAST2 T8)
        // (Standard round 5, r5-trig: also the mana symbols a cast trigger names, "that many" there, render/qty.ts; CR 107.4)
        if (typeof n === 'object' && (n.q === 'eventAmount' || n.q === 'preventedAmount' /* edh-next-60 (CR 615.5): "prevent that damage and create that many tokens" */ || n.q === 'excessDamage' /* edh-perms-9 (CR 120.10): "create that many tapped Treasure tokens" */ || (n.q === 'resultCount' && st.info.has(`r:${n.step}`)) || (n.q === 'manaSymbols' && v === 'that many') || countStatedByIf(n, st) /* edh-next-138 (Desert Warfare): the count an intervening "if" states */)) options.push(`${tokenText(s.token, 'that many', true, st)}${tail(true)}`);
        // edh-next-89 (CR 111.4, 608.2c, 603.2; Rapacious One): "create that many 0/1 colorless Eldrazi Spawn creature tokens. They have "Sacrifice this creature: Add {C}."": the next sentence gives the tokens their abilities, as for a computed number above
        if (typeof n === 'object' && (n.q === 'eventAmount' || (n.q === 'resultCount' && st.info.has(`r:${n.step}`))) && tk.abilities && tk.abilities.length > 0 && !tk.predefined && namedTokenOf(tk) === undefined) {
          options.push(`${tokenText({ ...tk, abilities: undefined }, 'that many', true, st)}${tail(true)}. they have ${tk.abilities.map((a) => quotedAbility(a, st, 'token')).join(' and ')}`);
        }
        // FAST4 T26 (CR 111.1, 110.5b): "tapped" before the token words with a computed number too ("create that many tapped Treasure tokens", "create a
        // number of tapped Treasure tokens equal to its power"), as FAST1 T6 reads it for a fixed number below
        if (s.tapped && !s.attacking) {
          options.push(`${tokenText(s.token, 'a number of', true, st, 'tapped')}${tail(true, true)} equal to ${v}`);
          // FAST5 T67 (CR 111.1, 110.5b): "create a tapped 2/2 colorless Robot artifact creature token for each multicolored permanent you control"
          if (per) options.push(`${tokenText(s.token, 1, false, st, 'tapped')}${tail(false, true)} for each ${per.singular}`);
          // r4-fxb (family tapped-tokens-where-x): "create X tapped Treasure tokens, where X is the number of artifacts your opponents control" (Smaug, Wicked Worm)
          options.push(`${tokenText(s.token, 'X', true, st, 'tapped')}${tail(true, true)}, where X is ${v}`);
          if (typeof n === 'object' && (n.q === 'eventAmount' || n.q === 'preventedAmount' || n.q === 'excessDamage' || (n.q === 'resultCount' && st.info.has(`r:${n.step}`)))) options.push(`${tokenText(s.token, 'that many', true, st, 'tapped')}${tail(true, true)}`);
        }
        return alt(...options);
      }
      const plural = !(typeof n === 'number' && n === 1);
      const count: number | string = typeof n === 'number' ? n : K.qty(n, st);
      const pristine = s.attachTo ? cloneState(st) : st; // edh-next-64: the target "attached to" names is said "target ..." in each alternative, never "that ..." after another one
      const after = `${tokenText(s.token, count, plural, st)}${tail(plural)}`;
      // FAST2 T7 (CR 111.4, 608.2c): "Create a 0/1 Eldrazi Spawn creature token. It has "Sacrifice this creature: Add {C}."" says the same as "... token with
      // "Sacrifice this creature: Add {C}."": the next sentence gives the tokens their abilities (parser rider rid.t7.token.itHas / theyHave)
      const t = s.token;
      const told = t.abilities && t.abilities.length > 0 && !t.predefined && namedTokenOf(t) === undefined
        ? [`${tokenText({ ...t, abilities: undefined }, count, plural, st)}${tail(plural, false, s.attachTo ? cloneState(pristine) : st)}. ${plural ? alt('they have', 'the tokens have' /* r3-static */, 'those tokens have' /* edh-zones-24 */) : alt('it has', 'that token has', 'the token has' /* edh-next-64 */)} ${t.abilities.map((a) => quotedAbility(a, st, 'token')).join(' and ')}`]
        : [];
      // r5-mech (CR 111.4, 608.2c): the rider may also give plain keywords before the quoted ability, "... named Reliquary Dragon that's all colors. It has flying,
      // lifelink, and "When this token enters, ...""
      if (told.length > 0 && ((t.keywords ?? []).length > 0 || t.abilities!.some((a) => a.kind === 'keyword'))) {
        told.push(`${tokenText({ ...t, abilities: undefined, keywords: undefined }, count, plural, st)}${tail(plural, false, s.attachTo ? cloneState(pristine) : st)}. ${plural ? alt('they have', 'the tokens have', 'those tokens have') : alt('it has', 'that token has', 'the token has' /* edh-next-64 */)} ${tokenAbilityWords(t, st).replace(/^ with /, '')}`);
      }
      // FAST1 T6 (CR 111.1, 110.5b): "create a tapped Treasure token" says the same as "create a Treasure token that's tapped"
      if (s.tapped && !s.attacking) return alt(after, `${tokenText(s.token, count, plural, st, 'tapped')}${tail(plural, true)}`, ...told);
      // edh-combat-4 (CR 508.4, 110.5b, 111.1; family token-tapped-front-attacking-whom): "creates a tapped 2/1 ... Inkling creature token with flying that's attacking that
      // opponent": tapped before the token words, the player attacked after them (no counters or attachment)
      if (s.tapped === true && typeof s.attacking === 'object' && s.attacking.orPlaneswalkers !== true && s.blocking === undefined && !s.attachTo && (s.counters?.length ?? 0) === 0 && told.length === 0) {
        return alt(after, `${tokenText(s.token, count, plural, st, 'tapped')}${plural ? ' that are' : " that's"} attacking ${K.player(s.attacking.defender, st, 'object').text}`);
      }
      // edh-next-110 (CR 111.4, 508.4, 508.4a, 110.5b; parser/templates/zz-cloud/edh-next-110.json, rid.edhn110.namedToken.ragavan.entersTappedAttacking; Kari Zev, Skyship Raider): one named token that
      // enters tapped and attacking, said in a sentence of its own after the creation: "create Ragavan, a legendary 2/1 red Monkey creature token. Ragavan enters tapped and attacking."
      if (s.tapped === true && s.attacking === true && s.blocking === undefined && !s.attachTo && (s.counters?.length ?? 0) === 0 && typeof n === 'number' && n === 1 && s.token.name !== undefined && told.length === 0) {
        return alt(after, `${tokenText(s.token, 1, false, st)}. ${s.token.name} enters tapped and attacking`, tokenText(s.token, count, plural, st, 'tapped and attacking')); // (the trek-18 wording below stays offered)
      }
      // trek-18 (CR 508.4, 111.1; family token-tapped-attacking-front-plain; U.S.S. Stargazer, Here and There): "create a tapped and attacking 4/3 ... token with flying": the two
      // flags before the token words, attacking whoever the controller chooses (no counters, attachment or named player)
      // edh-c-16 (Pugnacious Pugilist, Maestros Diabolist): the token may have a quoted ability ("create a tapped and attacking 1/1 red Devil creature token with "When this token dies, ..."")
      if (s.tapped === true && s.attacking === true && s.blocking === undefined && !s.attachTo && (s.counters?.length ?? 0) === 0) {
        return alt(after, `${tokenText(s.token, count, plural, st, 'tapped and attacking')}`, ...told);
      }
      // edh-d-94 (CR 111.1, 122.6, 614.1c; Printlifter Ooze; family token-enters-with-counters-sentence): one token that enters with as many counters as the objects of a description, said in a
      // sentence of its own after the creation, "the number of other ..." (other than the token, counted before it exists: parser/templates/zz-cloud/edh-d-94.json)
      const c0 = s.counters?.[0];
      const counted = c0 !== undefined && typeof c0.count === 'object' && c0.count.q === 'count' && c0.count.of.ref === 'each' && 'filter' in c0.count.of ? c0.count.of.filter : undefined;
      if (counted !== undefined && s.counters!.length === 1 && typeof n === 'number' && n === 1 && !s.tapped && !s.attacking && s.blocking === undefined && !s.attachTo && told.length === 0 && counted.other === undefined) {
        return alt(after, `${tokenText(s.token, 1, false, st)}. the token enters with x ${c0!.kind} counters on it, where x is the number of other ${K.np(counted, st, { det: 'none', plural: true })}`);
      }
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
    // trek-15 (CR 508.4, 111.1; Rite of Ascension, Worf, Still Not Merry): "for each opponent you attacked this turn, create a tapped and attacking 2/1 ... token with haste": the tokens of a
    // counted number, tapped and attacking whoever the controller chooses, said with the count in front
    const attackingCounted = s.attacking === true && s.tapped === true && (typeof s.count === 'object') && (s.count.q === 'count' || (s.count.q === 'opponentsAttacked' && s.count.scope === 'turn'));
    const attackingOk = s.blocking === undefined && (!s.attacking || (flipsWon && s.attacking === true && s.tapped === true) || attackingCounted);
    if (s.who.ref === 'you' && typeof n === 'object' && (n.q === 'count' || (n.q === 'resultCount' && n.which !== undefined) || (n.q === 'resultCount' && n.which === undefined && st.info.get(`r:${n.step}`)?.thisWay === 'tapped this way' /* edh-d-14 (Devout Invocation): "for each creature tapped this way" */) || flipsWon || n.q === 'spellsCastThisTurn' /* edh-cast-9: "for each spell you've cast this turn, create ..." (Murmuration) */ || n.q === 'diceResults' /* edh-top-16 (CR 706.2; Clown Car): "For each odd result, create ..." */ || (n.q === 'opponentsAttacked' && n.scope === 'turn') /* trek-15 */ || (n.q === 'spellManaSpent' && n.from !== undefined) /* edh-d-42: "for each mana from a Desert spent to cast this spell, create a tapped Treasure token" (Cataclysmic Prospecting) */ || (n.q === 'countPlayers' && n.lifeVs !== undefined && n.of.ref === 'each' && n.of.who === 'opponent' && n.lifeVs.than.ref === 'you' && (n.lifeVs.op === '>' || n.lifeVs.op === '<')) /* edh-d-42: "for each opponent who has less life than you, create ..." (Great Unclean One) */) && attackingOk && !s.attachTo && !(s.counters && s.counters.length > 0)
      && !isComputed(s.token.power ?? 0) && !isComputed(s.token.toughness ?? 0)) {
      const per = countParts(n, st) ?? (n.q === 'opponentsAttacked' ? { singular: 'opponent you attacked this turn' } : null); // trek-15 (family for-each-opponent-you-attacked)
      const tok = s.attacking ? `${tokenText(s.token, 1, false, st)} that's tapped and attacking` : s.tapped ? tokenText(s.token, 1, false, st, 'tapped') : tokenText(s.token, 1, false, st);
      // trek-15 (family token-tapped-attacking-front-counted): and the two flags before the token words of a counted number
      const tokFront = attackingCounted ? [tokenText(s.token, 1, false, st, 'tapped and attacking')] : [];
      if (per) c.imp = alt(c.imp, ...[tok, ...tokFront].map((x) => `for each ${per.singular}, ${alt('create', 'you create')} ${x}`));
    }
    // edh-d-52 (CR 111.1, 608.2c, 608.2h, 700.4; Mogg Infestation; family for-each-died-player-creates): "For each creature that died this way, that player creates two 1/1 red Goblin creature
    // tokens." is the one creation of twice the number of creatures that died (a count of the earlier destroy, times the tokens for each); plain tokens only, the player said after the lead
    if (s.who.ref !== 'you' && typeof n === 'object' && n.q === 'math' && n.op === '*' && n.args.length === 2 && typeof n.args[0] === 'number' && n.args[0] > 0 && typeof n.args[1] === 'object' && n.args[1].q === 'resultCount' && n.args[1].to !== undefined
      && !s.tapped && !s.attacking && s.blocking === undefined && !s.attachTo && (s.counters?.length ?? 0) === 0) {
      const per = countParts(n.args[1], st);
      if (per) {
        const fork = cloneState(st);
        const said = byPlayer(s.who, fork, 'create', () => tokenText(s.token, n.args[0] as number, n.args[0] !== 1, fork));
        c.sub = alt(c.sub, `for each ${per.singular}, ${said.sub}`);
        c.standalone = true;
      }
    }
    // r4-fxz (CR 111.1, 608.2c): a creature token is also "that creature" in a later sentence ("Create a 1/1 ... creature token with prowess. If ..., put a +1/+1
    // counter on that creature."), as its card types name it
    const typed = (s.token.types ?? []).map((x) => x.toLowerCase()).filter((x) => x === 'creature' || x === 'artifact');
    bind(st, s.as, { nouns: ['token', ...typed], plural: !(typeof s.count === 'number' && s.count === 1) || s.who.ref === 'each' /* edhn95: every player of a group makes one, the tokens are several (CR 111.1) */ });
    return c;
  },

  // r4-fxb (CR 115.7): "change the target of target spell or ability with a single target"
  changeTarget: (s: StepOf<'changeTarget'>, st: RenderState): Clause => {
    // edh-cast-1 (CR 115.7a-b; Spellskite, Hydroelectric Specimen): "change a target of target spell or ability to ~", "change the target of target ... spell with a single target to ~"
    // edh-c-59 (CR 115.7b, 603.2; Captured by the Consulate): "change the target to enchanted creature if able" (the one target of the spell that caused the trigger)
    if (s.to !== undefined && s.to.ref !== 'self' && s.what.ref === 'event' && s.what.role === 'spell') { // to ~ keeps edh-cast-1's wording
      return byPlayer(s.who, st, 'change', () => `the target to ${K.obj(s.to!, st, 'object').text} if able`);
    }
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
    // edh-cast-15 (CR 707.10, 113.7a; Ulalek, capability op:copy.exceptThis): "copy all other activated and triggered abilities you control": the group of your activated and triggered
    // abilities on the stack, but for the ability being resolved; any other group with the flag has no wording
    const abilityGroup = JSON.stringify({ anyOf: [{ stackKind: 'activatedAbility' }, { stackKind: 'triggeredAbility' }], controller: 'you', zone: 'stack' });
    if (s.exceptThis === true) {
      if (s.result !== 'spell' || s.what.ref !== 'each' || JSON.stringify(s.what.filter) !== abilityGroup || s.count !== undefined || s.who.ref !== 'you') throw new NoRenderer('"all other" of a group other than your activated and triggered abilities on the stack');
      what = 'all other activated and triggered abilities you control';
    } else {
      try {
        what = K.obj(s.what, st, 'object').text;
      } finally {
        if (key !== null && held !== undefined) st.info.set(key, held);
      }
    }
    const general = (mods: StepOf<'copy'>['except'] & object): string => K.staticEffect({ s: 'continuous', affects: { ref: 'subject' }, mods }, st);
    // M6-2: a token copy's exceptions in the copy wording (render/copy-except.ts, CR 707.9b); a spell copy's as before
    const manyTokens = s.result === 'token' && !(s.count === undefined || s.count === 1);
    // CLOUD std-misc (CR 707.9b, 707.10): a spell copy's exceptions said of "the copy" ("except the copy isn't legendary"), else as before
    const spellExc = s.result === 'spell' && s.except && s.except.length > 0 && (s.count === undefined || s.count === 1) ? spellCopyExceptText(s.except) : null;
    // edh-perms-5 (CR 707.9b, 107.1a; Saw in Half): the tokens' base power and toughness each half a number, the rounding said once after (parser/holes/p2copyperm1.ts)
    const halfPt = s.result === 'token' && manyTokens && s.except?.length === 1 ? halfPtExceptText(s.except[0]!, st) : null;
    // edh-perms-21 (family copy-except-comma; Faerie Artisans): one token copy's "except" follows the object with or without a comma ("a copy of that creature except it's an artifact ...")
    const tokenExc = s.result === 'token' && !manyTokens && s.except && s.except.length > 0 ? copyExceptText(s.except, general, undefined, undefined, false, false, false, (a) => quotedAbility(a, st, 'creature')) : null;
    // edh-next-114 (CR 707.9e, 122.6; Littjara Mirrorlake): "create a token that's a copy of target creature you control, except it enters with an additional +1/+1 counter on it" (one token, one counter kind, nothing else changed)
    const counterExc = s.counters !== undefined ? (() => {
      // edh-next-133 (CR 707.2, 122.6, 107.1a; Ochre Jelly; rider rid.edhn133.token.entersWith.halfThatMany): "The token enters with half that many +1/+1 counters on it, rounded down.": the
      // token copy enters with half the counters of that kind the copied object had (its last known information, CR 608.2h), a sentence of its own after the copy
      const half = halfThatManyCounters(s);
      if (half !== null) return `. the token enters with half that many ${half} counters on it, rounded down`;
      if (s.result !== 'token' || manyTokens || (s.except !== undefined && s.except.length > 0) || s.tapped === true || s.attacking !== undefined || s.counters!.length !== 1 || typeof s.counters![0]!.count !== 'number') throw new NoRenderer('a token copy that enters with counters, other than one kind on one untapped token with no other exception');
      const k = s.counters![0]!;
      return `, except it enters with ${k.count === 1 ? 'an' : numWord(k.count as number)} additional ${k.kind} counter${k.count === 1 ? '' : 's'} on it`;
    })() : null;
    const exc0 = counterExc !== null ? counterExc : halfPt !== null ? `, except ${halfPt}` : tokenExc !== null ? alt(`, except ${tokenExc}`, ` except ${tokenExc}`) : s.except && s.except.length > 0 ? `, except ${s.result === 'token' ? copyExceptText(s.except, general, undefined, undefined, manyTokens, false, false, (a) => quotedAbility(a, st, 'creature')) : spellExc ?? general(s.except)}` : '';
    // edh-next-136 (CR 707.9b, 306.5b; Jace, Mirror Mage): "except it's not legendary and its starting loyalty is 1": the starting loyalty said last, of one token copy
    if (s.startingLoyalty !== undefined && (s.result !== 'token' || typeof s.startingLoyalty !== 'number' || (s.count ?? 1) !== 1 || counterExc !== null || halfPt !== null)) throw new NoRenderer('a starting loyalty of a copy other than one token copy with plain exceptions');
    const exc = s.startingLoyalty === undefined ? exc0 : tokenExc !== null ? `, except ${tokenExc} and its starting loyalty is ${s.startingLoyalty}` : exc0 === '' ? `, except its starting loyalty is ${s.startingLoyalty}` : `${exc0} and its starting loyalty is ${s.startingLoyalty}`;
    if (s.result === 'spell' && s.retargetAll === true) {
      // edh-next-74 (CR 707.10c, 115.1; Radiate, Radiant Performer; templates eff.edhn74.copy.forEachOther.permanentOrPlayer and rid.edhn74.eachCopyTargetsDifferent.permanentsAndPlayers): "Copy that spell for each
      // other permanent or player the spell could target. Each copy targets a different one of those permanents and players." (a spell or ability: "the spell or ability could target")
      if (s.retargetEach !== undefined || s.different !== true || s.count !== undefined || s.except !== undefined || s.gains !== undefined || s.as !== undefined || s.newTargets !== undefined || s.who.ref !== 'you') throw new NoRenderer('a copy per permanent or player other than "copy that spell for each other permanent or player the spell could target. Each copy targets a different one of those permanents and players"');
      const noun = s.what.ref === 'target' && st.specs.get(s.what.id)?.kind === 'stackObject' && st.specs.get(s.what.id)?.filter?.stackKind === undefined ? 'spell or ability' : 'spell';
      bind(st, s.as, { nouns: ['copy', 'spell'], plural: true });
      return { ...byPlayer(s.who, st, 'copy', () => `${what} for each other permanent or player the ${noun} could target. each copy targets a different one of those permanents and players`), standalone: true };
    }
    if (s.result === 'spell' && s.retargetEach !== undefined) {
      // edh-cast-14 (CR 707.10c, 115.1; Zada, Hedron Grinder, the parser's templates eff.edhc14.copy.forEach.couldTarget and rid.edhc14.eachCopyTargetsDifferent): "Copy that spell for each
      // other creature you control that the spell could target. Each copy targets a different one of those creatures."
      const each = s.retargetEach;
      if (s.different !== true || each.ref !== 'each' || s.count !== undefined || s.except !== undefined || s.gains !== undefined || s.as !== undefined || s.newTargets !== undefined) throw new NoRenderer('a copy per object other than "copy that spell for each <objects> that the spell could target. Each copy targets a different one of those <objects>"');
      const { other: _other, controller: _controller, ...bare } = each.filter;
      const heads = K.np(bare, st, { det: 'none', plural: true });
      // edh-next-57 (Precursor Golem, Mirrorwing Dragon): "that player copies that spell for each other Golem that spell could target", said by the player who cast the spell (`who`), "that spell" as well as "the spell"
      const said = `${what} for each ${K.np(each.filter, st, { det: 'none', plural: false })} ${alt('that the spell could target', 'that spell could target')}. each copy targets a different one of those ${heads}`;
      bind(st, s.as, { nouns: ['copy', 'spell'], plural: true });
      return { ...byPlayer(s.who, st, 'copy', () => said), standalone: true };
    }
    if (s.result === 'spell') {
      // a spell is not tapped or attacking (CR 707.10): a flag of a token copy beside a spell copy would be dropped
      if (s.tapped === true || s.attacking !== undefined && s.attacking !== false || s.noManaCost === true) throw new NoRenderer('tapped, attacking or no mana cost on a spell copy');
      // CR 707.10: who copies it, how many copies, and what the copies are not
      // FAST5 T45: "copy it for each other instant and sorcery spell you've cast before it this turn" (render/qty.ts#countParts)
      // CMD2 (CR 903.8): "copy it for each time you've cast your commander from the command zone this game" (the storm cycle)
      const per = typeof s.count === 'object' && (s.count.q === 'happenedCount' || s.count.q === 'commanderCasts' || (s.count.q === 'distinct' && s.count.what === 'counterKinds')) ? countParts(s.count, st) : null;
      // trek-14 (CR 107.3, 707.10c; Infinite Diversity): "Copy that card X times, where X is the number of creature types among non-Borg creatures you control": a computed number of copies
      // edh-cast-15 (CR 707.10, 608.2c; Tempt with Mayhem): "You copy that spell once plus an additional time for each opponent who copied the spell this way"
      const oncePlus = oncePlusEachOpponent(s.count);
      const computed = per === null && !oncePlus && typeof s.count === 'object' && isComputed(s.count) && s.count.q !== 'eventAmount' && s.count.q !== 'count' && s.count.q !== 'countPlayers';
      const times = per !== null ? ` for each ${per.singular}` : oncePlus ? ' once plus an additional time for each opponent who copied the spell this way' : computed ? ' X times' : s.count === 1 ? alt('', ' an additional time') /* edh-next-65 (CR 707.10; Howl of the Horde): an explicit single copy beside the copy another ability makes */ : timesWords(s.count);
      const where = computed ? `, where X is ${K.qty(s.count as Quantity, cloneState(st))}` : '';
      if (computed) markX(s.count as Quantity, st);
      // edhd60 (CR 707.10c, 115.1; Frontline Heroism, template rid.edhd60.copyTargets.object): "Copy that spell. The copy targets that token."
      if (s.targetsObject !== undefined && (s.newTargets !== undefined || s.gains !== undefined || s.count !== undefined || s.except !== undefined)) throw new NoRenderer('a copy that targets an object, beside other copy words');
      const tgtText = s.targetsObject !== undefined ? K.obj(s.targetsObject, st, 'object').text : '';
      const nt = (s.targetsObject !== undefined ? `. the copy targets ${tgtText === 'it' ? 'that token' : tgtText}` : '') + copyNewTargets(s, st) + copyGains(s, st);
      // edh-c-55 (CR 707.10; Bill Potts): the stack object of a trigger on casting a spell or activating an ability is "that spell or ability"
      const evTrigger = st.trigger ?? [];
      const spellOrAbility = s.what.ref === 'event' && s.what.role === 'spell' && evTrigger.some((e) => e.ev === 'cast') && evTrigger.some((e) => e.ev === 'activate');
      const c0 = byPlayer(s.who, st, 'copy', () => `${spellOrAbility ? alt(what, 'that spell or ability') : what}${times}${exc}${where}`);
      // p2-copy-spell-3 (CR 707.10, 707.10c; family controller-of-target-copies-it): the controller of the one target spell copies that spell, said with the target
      // inside the subject: "The controller of target instant or sorcery spell copies it." (Meletis Charlatan); one copy of the target itself, no exception
      const ofTarget = s.what.ref === 'target' && JSON.stringify(s.who) === JSON.stringify({ ref: 'controllerOf', object: s.what }) && times === '' && exc === '';
      const c = ofTarget ? { ...c0, sub: alt(c0.sub, `the controller of ${what} copies it`) } : c0;
      // CR 707.10: the copy is a new object a later sentence can name ("that copy"; WP23 review)
      bind(st, s.as, { nouns: ['copy', 'spell'], plural: !(s.count === undefined || s.count === 1) });
      return nt === '' ? c : { ...c, imp: c.imp + nt, sub: c.sub + nt, standalone: true, ...(s.targetsObject !== undefined ? { commaThen: true } : {}) /* edhd60: "..., then copy that spell. The copy targets that token." */ };
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
    // edh-perms-17 (CR 508.4, 110.5b, 707.9b; parser rider rid.edhpm17.copy.token.entersTappedAttacking.player; Echoing Assault): the one token copy, its exceptions, then its status in a
    // sentence of its own: "Create a token that's a copy of that creature, except it's 1/1. The token enters tapped and attacking that player."
    if (s.noManaCost !== true && typeof s.attacking === 'object' && s.tapped === true && s.attacking.orPlaneswalkers !== true && (s.count ?? 1) === 1 && exc !== '') {
      const whom = K.player(s.attacking.defender, st, 'object').text;
      // edh-next-130 (CR 508.4, 707.9b; family copy-self-tapped-attacking-whom; Shredder, Shadow Master): the status said right after the object, the exceptions after it: "create a token that's a copy of ~
      // tapped and attacking that player, except it isn't legendary" (the card itself also "~")
      const self = s.what.ref === 'self' && Object.keys(s.what).length === 1 ? alt(what, '~') : what;
      // the opponent of the loop is also "that player" there, the attacked player of the trigger beside it (Oracle's words; the parser's template reads them so)
      const d = s.attacking.defender;
      const eachThem = d.ref === 'bound' && st.info.get(`b:${d.name}`)?.iterates === 'opponent' ? alt(whom, 'that player') : whom;
      const c = byPlayer(s.who, st, 'create', () => alt(`a token that's a copy of ${what}${exc}. the token enters tapped and attacking ${whom}`, `a token that's a copy of ${self} tapped and attacking ${eachThem}${exc}`));
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
        // edh-perms-10 (CR 508.4, 110.5b; parser rider rid.edhpm10.copy.token.entersTappedAttacking; Thousand-Faced Shadow): one token, and the status in a sentence of its own
        return alt(`${body}${tap}${exc}`, `${front}${exc}`, ...(typeof n === 'number' && n === 1 ? [`a token that's a copy of ${what}${exc}. the token enters tapped and attacking`] : []),
          // edh-perms-13 (CR 508.4, 110.5b; template eff.edhpm13.copy.token.andTappedAttacking; Flamerush Rider): one token, the status said after the object: "... and that's tapped and attacking"
          ...(typeof n === 'number' && n === 1 && exc === '' ? [`a token that's a copy of ${what} and that's tapped and attacking`] : []),
          // edh-d-75 (CR 111.2, 107.3, 508.4, 608.2h; template eff.edhd75.copyTokens.tappedAttacking.whereX; Nacatl War-Pride; family token-copies-where-x): a computed number of tapped and attacking token copies,
          // "create X tokens that are copies of it and that are tapped and attacking, where X is the number of creatures defending player controls"
          ...(typeof n === 'object' && isComputed(n) && n.q !== 'X' && n.q !== 'eventAmount' && exc === '' ? [`x tokens that are copies of ${what} and that are tapped and attacking, where x is ${K.qty(n, st)}`] : []));
      }
      // edh-top-7 (CR 111.2, 107.3, 608.2h; Rionya, Fire Dancer): "Create X tokens that are copies of another target creature you control, where X is one plus the number of instant and sorcery
      // spells you've cast this turn": a computed number of copies is also said with X and its "where X is" clause, or "a number of tokens ... equal to" (as the tokens of createToken)
      if (typeof n === 'object' && isComputed(n) && n.q !== 'X' && n.q !== 'eventAmount' && !s.tapped && !s.attacking && exc === '') {
        const v = K.qty(n, st);
        return alt(body, `x tokens that are copies of ${what}, where x is ${v}`, `a number of tokens that are copies of ${what} equal to ${v}`);
      }
      return `${body}${tap}${exc}`;
    });
    // edh-next-114 (CR 705.2, 608.2c; Mirror March, template eff.edhn114.forEach.qty.copyToken): "For each flip you won, create a token that's a copy of that creature": one token copy for each flip an earlier flip won
    if (typeof n === 'object' && n.q === 'resultCount' && n.which === undefined && ['you win', 'you won'].includes(st.info.get(`r:${n.step}`)?.thisWay ?? '') && !s.tapped && !s.attacking && exc === '') {
      c.imp = alt(c.imp, `for each flip you ${st.info.get(`r:${n.step}`)?.thisWay === 'you won' ? 'won' : 'win'}, create a token that's a copy of ${what}`);
    }
    // CR 707.2, 111.1: the token copy is a new object a later sentence can name ("that token"; WP23 review)
    bind(st, s.as, { nouns: ['token'], plural: !(typeof n === 'number' && n === 1) || s.who.ref === 'each' /* edhn95: a copy for each player of a group */ });
    return c;
  },

  tap: (s: StepOf<'tap'>, st: RenderState): Clause => tapClause('tap', s, st),
  untap: (s: StepOf<'untap'>, st: RenderState): Clause => tapClause('untap', s, st),

  attach: (s: StepOf<'attach'>, st: RenderState): Clause => {
    // edh-c-40 (CR 701.3d, 301.5; Disarm): "unattach all Equipment from target creature": the permanents of a description attached to an object, unattached; the object is named
    // after "from" (rendered first, so a target is named once, not "it")
    if (s.to === null && s.what.ref === 'each' && s.what.filter.attachedToObject !== undefined) {
      const { attachedToObject, ...rest0 } = s.what.filter;
      const rest = rest0.anyOf?.length === 1 && Object.keys(rest0).length === 1 ? rest0.anyOf[0]! : rest0;
      const noun = K.np(rest, st, { det: 'none', plural: true });
      return plain(`unattach all ${noun} from ${K.obj(attachedToObject, st, 'object').text}`);
    }
    // T55 (CR 301.5c, 303.4d): ... and what it is attached to is no antecedent of the pronoun that names what is attached ("Attach it to ~" after a token was created)
    const toPlayer = s.to !== null && (s.to.ref === 'randomOpponent' || s.to.ref === 'anOpponent'); // edh-d-29: ... or one of your opponents (Lynde) // edh-top-14 (Maddening Hex): the random opponent is a player
    const toKey0 = s.to === null || toPlayer ? null : objKey(s.to as ObjRef);
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
    const toKey = toPlayer ? null : objKey(s.to as ObjRef);
    if (key !== null && toKey !== null && identityOf(st, key) === identityOf(st, toKey)) throw new NoRenderer('attach an object to itself (CR 301.5c, 303.4d)');
    const saved = st.notAntecedent;
    if (key !== null) st.notAntecedent = identityOf(st, key);
    try {
      // std-rx32 (CR 701.3a, 603.12): what a later "when one or more Equipment become attached to that creature this way" names (parser/lower/conditions.ts#attachedThisWay)
      const spec = s.what.ref === 'target' ? st.specs.get(s.what.id) : undefined;
      const subs = spec?.filter?.subtypes;
      if (s.as !== undefined && subs?.length === 1 && subs[0] === 'Equipment') bind(st, s.as, { nouns: ['equipment'], plural: true, attachedThisWay: { noun: 'equipment', to: s.to as ObjRef } });
      const dest = toPlayer ? (s.to!.ref === 'anOpponent' ? 'one of your opponents' : K.player(s.to as never, st, 'object').text) : K.obj(s.to as never, st, 'object').text; // edh-d-29: Lynde
      // edh-c-27 (CR 701.3a; family all-on-the-battlefield; Vulshok Battlemaster; edh-b-9's template eff.edhb9.attach.all reads the filter): every object of a kind with no controller or zone is "all Equipment on the battlefield" as well
      if (s.what.ref === 'each' && 'filter' in s.what && s.what.filter.controller === undefined && (s.what.filter.zone === undefined || s.what.filter.zone === 'battlefield') && s.what.filter.owner === undefined && !toPlayer) return plain(alt(`attach ${what} to ${dest}`, `attach ${what} on the battlefield to ${dest}`));
      return plain(`attach ${what} to ${dest}`);
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
  // edh-d-39 (CR 702.26b; the parser's rule, parser/lower/anaphora.ts PERMANENT_ACTIONS): only a permanent phases out, so a spell or ability on the stack is no antecedent of its pronoun
  phaseOut: (s: StepOf<'phaseOut'>, st: RenderState): Clause => {
    const saved = st.permanentOnly;
    st.permanentOnly = true;
    try {
      return phaseOutClause(s, st);
    } finally {
      st.permanentOnly = saved;
    }
  },


  // edhn102 (CR 702.26b-c; The Pandorica): "that permanent phases in", Oracle's one wording (the permanent as the subject, never an imperative)
  phaseIn: (s: StepOf<'phaseIn'>, st: RenderState): Clause => {
    const saved = st.permanentOnly;
    st.permanentOnly = true;
    try {
      return plain(withSubjects(s.what, st, (subject, plural) => `${subject} ${plural ? 'phase' : 'phases'} in`));
    } finally {
      st.permanentOnly = saved;
    }
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

  // edh-top-2 (CR 702.95a): soulbond's "pair this creature with another unpaired creature you control" (the keyword prints as itself; this is the step's own wording)
  pair: (s: StepOf<'pair'>, st: RenderState): Clause => plain(`pair ${K.obj(s.what, st, 'object').text} with ${K.obj(s.with, st, 'object').text}`),

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
    if (s.what === 'lifeToughness' || s.what === 'lifePower' /* edh-next-89 (CR 701.12a; Evra, Halcyon Witness) */) {
      if (!isPlayerRef(s.a as never, st) || isPlayerRef(s.b as never, st)) throw new NoRenderer('a life total exchanged with a toughness that is not one player and one permanent');
      return plain(`exchange ${K.player(s.a as PlayerRef, st, 'possessive').text} life total with ${K.obj(s.b as ObjRef, st, 'possessive').text} ${s.what === 'lifePower' ? 'power' : 'toughness'}`);
    }
    // edh-b-12 (CR 701.12a; Mordenkainen): "exchange your hand and library": one player, in the imperative
    if (s.what === 'handLibrary') {
      if (!isPlayerRef(s.a as never, st) || s.a.ref !== 'you' || JSON.stringify(s.a) !== JSON.stringify(s.b)) throw new NoRenderer('an exchange of hand and library other than the controller\'s own');
      return plain('exchange your hand and library');
    }
    // edh-c-113 (CR 701.12a; Harness Infinity): "exchange your hand and graveyard", the same shape
    if (s.what === 'handGraveyard') {
      if (!isPlayerRef(s.a as never, st) || s.a.ref !== 'you' || JSON.stringify(s.a) !== JSON.stringify(s.b)) throw new NoRenderer('an exchange of hand and graveyard other than the controller\'s own');
      return plain('exchange your hand and graveyard');
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
      // edh-c-13 (CR 701.12a; Serene Master): "exchange its power and the power of target creature it's blocking until end of combat", the power of the source itself and of another creature
      case 'power': {
        if (JSON.stringify(s.a) !== JSON.stringify({ ref: 'self' }) || s.duration === undefined) throw new NoRenderer('an exchange of powers other than of the object itself, with a duration');
        // "its" is the object itself only in an ability that triggers on the object's own block or attack (review: "another creature you control blocks ... its power" is the blocker, not ~)
        const own = (st.trigger ?? []).length > 0 && (st.trigger ?? []).every((e) => (e.ev === 'blocks' && e.blocker?.self === true) || (e.ev === 'attacks' && e.attacker?.self === true));
        if (!own) throw new NoRenderer('"its power" in an ability that does not trigger on the object itself blocking or attacking');
        return plain(`exchange ${K.obj(s.a as ObjRef, st, 'possessive').text} power and the power of ${b} ${K.dur(s.duration, st)}`);
      }
      // edh-zones-26: said only after the two targets were announced together (render/program.ts#chosenSacrificeReturn)
      case 'sacrificeReturn': return plain(`that player simultaneously sacrifices ${a} and returns ${b} to the battlefield`); // the plain form; Oracle's "the artifact" / "the artifact card" is the program-level reading
    }
  },

  cast: (s: StepOf<'cast'>, st: RenderState): Clause => {
    // edh-next-50 (CR 601.2, 113.6m; Sproutback Trudge): "you may cast ~ from your graveyard", only that exact shape
    if (s.from !== undefined && !((s.what.ref === 'self' || s.what.ref === 'event') /* edh-next-68: "Whenever you discard a nonland card, you may cast it from your graveyard" (Oskar) */ && s.who.ref === 'you' && s.optional === true && s.free === undefined && s.copyIn === undefined && s.select === undefined && s.play === undefined && s.costChange === undefined && s.transformed === undefined && s.anyManaType === undefined && s.graveyardInstead === undefined && s.maxManaValue === undefined && s.exactManaValue === undefined && s.count === undefined)) throw new NoRenderer('a cast from a zone other than "you may cast ~ from your graveyard" or "... it from your graveyard"');
    // r4-copy (CR 707.12, 608.2g): "Exile target card from your graveyard. Copy it. You may cast the copy [without paying its mana cost]." (Kaervek, the Punisher;
    // Shiko, Paragon of the Way: "Copy it, then you may cast the copy ..."): the copy of the card, created in its zone and cast while the effect resolves
    // edh-next-130 (CR 707.12, 601.2, 608.2c; Spelltwine): the copies are cast as the effect resolves if they can be ("Copy those cards. Cast the copies if able without paying their mana costs."):
    // a group of cards, or one card ("Copy that card. Cast the copy if able without paying its mana cost."), each copy cast for free, nothing else said
    if (s.copyIn !== undefined && s.optional !== true && s.free === true && s.who.ref === 'you' && s.costChange === undefined && s.play === undefined && s.anyManaType === undefined && s.transformed === undefined
      && s.select === undefined && s.count === undefined && s.from === undefined && s.maxManaValue === undefined && s.exactManaValue === undefined && s.graveyardInstead === undefined && s.dropUncast === undefined) {
      const what = K.obj(s.what, st, 'object');
      const c = byPlayer(s.who, st, 'copy', () => what.text);
      const tail = what.plural ? '. cast the copies if able without paying their mana costs' : '. cast the copy if able without paying its mana cost';
      return { ...c, imp: c.imp + tail, sub: c.sub + tail };
    }
    // edh-next-132 (CR 707.12, 601.2f; God-Eternal Kefnet): the copy of the card the trigger's event revealed, created in the hand, cast with a reduction of its own: "copy that card and you
    // may cast the copy. That copy costs {2} less to cast."
    if (s.copyIn === 'hand' && s.optional === true && s.who.ref === 'you' && s.costChange?.kind === 'reduce' && s.costChange.mana !== undefined && Object.keys(s.costChange).length === 2 && s.free !== true
      && s.play === undefined && s.anyManaType === undefined && s.transformed === undefined && s.select === undefined && s.count === undefined && s.what.ref === 'event') {
      const what = K.obj(s.what, st, 'object');
      if (what.plural) throw new NoRenderer('a reduced copy of several cards');
      // (the revealed card is "that card" as well as the pronoun: the one card of the event; family revealed-card-that-card)
      const said = `copy ${alt(what.text, 'that card')} and you may cast the copy. that copy costs ${formatManaCost(s.costChange.mana)} less to cast`;
      return plain(said);
    }
    if (s.copyIn !== undefined && s.optional === true && s.who.ref === 'you' && (s.costChange === undefined || payingInstead(s.costChange) !== null) && s.play === undefined && s.anyManaType === undefined && s.transformed === undefined) {
      const what = K.obj(s.what, st, 'object');
      // edh-next-131 (CR 707.12, 601.2b, 118.9; Blue Mage's Cane): the copy of one card cast for a fixed mana cost instead of its own, "You may cast the copy by paying {3} rather than paying its mana cost."
      const paying = s.costChange === undefined ? null : payingInstead(s.costChange);
      if (paying !== null) {
        if (what.plural || s.free === true || s.select !== undefined || s.count !== undefined || s.what.ref !== 'bound') throw new NoRenderer('a copy cast for another mana cost other than of one card');
        const one = byPlayer(s.who, st, 'copy', () => what.text);
        const said = `. you may cast the copy by paying ${paying} rather than paying its mana cost`;
        return { ...one, imp: one.imp + said, sub: one.sub + said };
      }
      // edh-next-131 (CR 707.12, 601.2b, 118.9; Blue Mage's Cane): the copy of one card cast for a fixed mana cost instead of its own, "You may cast the copy by paying {3} rather than paying its mana cost."
      // std-cardcopy-7 (CR 608.2d, 202.3): one choice of the copies to cast, "You may cast up to three of the copies without paying their mana costs." (Baron Helmut
      // Zemo), "You may cast any number of spells with total mana value 6 or less from among the copies without paying their mana costs." (Uldaros Theorix)
      // edh-next-133 (CR 707.12, 608.2d, 608.2g; Panoptic Mirror): one of the cards it exiled (any number may be): "You may copy a card exiled with ~. If you do, you may cast the copy without paying its mana cost."
      if (s.what.ref === 'linked' && s.what.link === 'exiled' && s.free === true && s.optional === true && s.select !== undefined && s.select.max === 1 && s.select.totalManaValue === undefined && s.guard === undefined && s.as === undefined && s.who.ref === 'you') {
        const said = `you may copy a card exiled with ~. if you do, you may cast the copy${s.free === true ? ' without paying its mana cost' : ''}`;
        return { ...byPlayer(s.who, st, 'copy', () => what.text), imp: said, sub: said };
      }
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
      // edh-zones-12 (CR 707.12, 608.2g, 118.9; Arcane Bombardment): the copies of a group of cards may be cast without paying, each its own choice: "You may cast any number of the copies without paying their mana costs."
      const free = s.free === true ? ' without paying its mana cost' : '';
      // trek-14 (CR 107.3, 707.10c, 707.12; Infinite Diversity): several copies of one card, "Copy that card X times, where X is ... You may cast the copies without paying their mana costs."
      if (s.count !== undefined) {
        const many = typeof s.count === 'object' && isComputed(s.count);
        // edh-cast-14 (CR 707.10c, 707.12; Mnemonic Deluge): a fixed number of copies, "Copy that card three times. You may cast the copies without paying their mana costs."
        const fixed = typeof s.count === 'number' && Number.isInteger(s.count) && s.count >= 2;
        if (what.plural || s.free !== true || s.select !== undefined || s.as !== undefined || s.guard !== undefined || !(many || fixed)) throw new NoRenderer('several copies other than a computed or fixed number of copies of one card, each cast or not without paying');
        const counted = fixed
          ? byPlayer(s.who, st, 'copy', () => `${what.text}${timesWords(s.count)}`)
          : byPlayer(s.who, st, 'copy', () => `${what.text} X times, where X is ${K.qty(s.count as Quantity, cloneState(st))}`);
        if (!fixed) markX(s.count as Quantity, st);
        const tail = '. you may cast the copies without paying their mana costs';
        return { ...counted, imp: counted.imp + tail, sub: counted.sub + tail };
      }
      const c = byPlayer(s.who, st, 'copy', () => what.text);
      // edh-cast-1 (CR 707.12, 608.2g, 607.2a; Isochron Scepter): the copy of the card the object's linked ability exiled is optional and so is its cast: "You may copy the
      // exiled card. If you do, you may cast the copy without paying its mana cost."
      if (s.what.ref === 'linked' && s.what.link === 'exiled' && !what.plural && s.free === true && s.select === undefined && s.guard === undefined && s.as === undefined) {
        const said = `you may copy ${what.text}. if you do, you may cast the copy${free}`;
        return { ...c, imp: said, sub: said };
      }
      const tail = what.plural ? `. you may cast any number of the copies${s.free === true ? ' without paying their mana costs' : ''}` : alt(`. you may cast the copy${free}`, `, then you may cast the copy${free}`, `, and you may cast the copy${free}` /* edh-zones-12: "For each card exiled this way, copy it, and you may cast the copy ..." (Mizzix's Mastery) */);
      // trek-12 (CR 707.12; family create-a-copy-of-self): the copy of the card the ability is on, in exile, is "Create a copy of ~" as well as "Copy ~" (Q, Stacking the Deck)
      if (s.what.ref === 'self' && !what.plural && s.free !== true) {
        const made = byPlayer(s.who, st, 'create', () => `a copy of ${what.text}`);
        return { ...c, imp: alt(c.imp, made.imp) + tail, sub: alt(c.sub, made.sub) + tail };
      }
      return { ...c, imp: c.imp + tail, sub: c.sub + tail };
    }
    // edh-cast-14 (CR 608.2d, 608.2g, 305.9; Jin-Gitaxias // The Great Synthesis, the parser's template eff.edhc14.cast.anyNumber.free.fromYourHand): one choice, among the nonland cards
    // in your hand that can be cast now, of any number of spells cast without paying their mana costs
    const handFilter = s.what.ref === 'each' ? s.what.filter : undefined;
    if (s.select !== undefined && s.select.max === undefined && s.select.totalManaValue === undefined && handFilter !== undefined && handFilter.zone === 'hand' && handFilter.owner === 'you'
      && handFilter.notTypes?.length === 1 && handFilter.notTypes[0] === 'Land' && Object.keys(handFilter).filter((k) => (handFilter as Record<string, unknown>)[k] !== undefined).length === 3
      && s.free === true && s.optional === true && s.who.ref === 'you' && s.maxManaValue === undefined && s.exactManaValue === undefined && s.copyIn === undefined && s.play === undefined && s.anyManaType === undefined
      && s.costChange === undefined && s.transformed === undefined && s.graveyardInstead === undefined && s.as === undefined && s.guard === undefined) {
      const text = 'you may cast any number of spells from your hand without paying their mana costs';
      return acting('you', text, text, { closesScope: true });
    }
    // edh-next-80 (CR 608.2d, 608.2g, 601.2, 118.9, 404.1; Chandra Ablaze, template eff.edhn80.cast.anyNumber.free.fromYourGraveyard): one choice of any number of the cards of one description in
    // your graveyard that can be cast now, cast without paying their mana costs: "Cast any number of red instant and/or sorcery cards from your graveyard without paying their mana costs."
    if (s.select !== undefined && s.select.max === undefined && s.select.totalManaValue === undefined && s.what.ref === 'each' && s.what.filter.zone === 'graveyard' && s.what.filter.owner === 'you'
      && s.what.filter.isCard === true && s.what.filter.anyOf?.length === 1 && Object.keys(s.what.filter).filter((k) => (s.what.ref === 'each' ? (s.what.filter as Record<string, unknown>)[k] !== undefined : false)).length === 4
      && s.free === true && s.optional === undefined && s.who.ref === 'you' && s.maxManaValue === undefined && s.exactManaValue === undefined && s.copyIn === undefined && s.play === undefined && s.anyManaType === undefined
      && s.costChange === undefined && s.transformed === undefined && s.graveyardInstead === undefined && s.as === undefined && s.guard === undefined && s.from === undefined) {
      const text = `cast any number of ${K.np({ ...s.what.filter.anyOf[0]!, zone: 'graveyard', owner: 'you', isCard: true }, st, { det: 'none', plural: true })} without paying their mana costs`;
      return acting('you', text, text, { closesScope: true });
    }
    // trek-7 (CR 608.2d, 601.2, 202.3; Captain Benjamin Sisko, template eff.trek7.cast.anyNumber.free.mvLte.fromAmong): one choice, among the cards of an exiled group that can be
    // cast now (each as a face or half of at most that mana value), of any number of spells cast without paying their mana costs: "You may cast any number of spells with
    // mana value less than or equal to N from among those cards without paying their mana costs." Only the nonland cards of one bound group in exile, and nothing else
    // edh-cast-15 (CR 601.2, 608.2d, 118.9, 202.3, 614.1a; Invoke Calamity, template eff.edhc15.cast.upTo.instantSorcery.totalMV.graveyardOrHand.free): one choice of up to N instant and/or sorcery
    // cards of your graveyard and/or hand, with a total mana value, cast without paying their mana costs, and the exile-instead of the spells cast this way said right after (the rider's `graveyardInstead`)
    if (s.select?.max !== undefined && s.select.totalManaValue !== undefined) {
      const f = s.what.ref === 'each' ? s.what.filter : undefined;
      const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
      const gi = s.graveyardInstead;
      if (f === undefined || !sameJson(f, { types: ['Instant', 'Sorcery'], zone: ['graveyard', 'hand'], owner: 'you', isCard: true }) || s.free !== true || s.who.ref !== 'you' || s.optional !== undefined || s.copyIn !== undefined
        || s.play !== undefined || s.anyManaType !== undefined || s.costChange !== undefined || s.transformed !== undefined || s.maxManaValue !== undefined || s.exactManaValue !== undefined || s.as !== undefined || s.guard !== undefined
        || (gi !== undefined && !sameJson(gi, { to: { zone: 'exile' }, yours: true }))) {
        throw new NoRenderer('a choice of cards to cast with a total mana value other than up to N instant and/or sorcery cards of your graveyard and/or hand, cast free');
      }
      const text = `you may cast up to ${K.qty(s.select.max, st)} instant and/or sorcery spells with total mana value ${K.qty(s.select.totalManaValue, st)} or less from your graveyard and/or hand without paying their mana costs${gi !== undefined ? '. if those spells would be put into your graveyard, exile them instead' : ''}`;
      return acting('you', text, text, { closesScope: true, standalone: true });
    }
    // edh-top-8 (CR 608.2g, 305.1, 601.2, 118.9; template eff.edht8.play.landsSpells.group.free; Gix, Yawgmoth Praetor): during the resolution, each card of one named group in exile may be played (a land) or cast (a spell)
    // without paying its mana cost: "You may play lands and cast spells from among cards exiled this way without paying their mana costs." Only that group and nothing else
    if (s.play === true && s.free === true && s.optional === true && s.who.ref === 'you' && s.what.ref === 'each' && s.select === undefined) {
      const f = s.what.filter;
      const groupOnly = f.is !== undefined && f.zone === 'exile' && Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).length === 2;
      if (!groupOnly || s.copyIn !== undefined || s.anyManaType !== undefined || s.costChange !== undefined || s.transformed !== undefined || s.graveyardInstead !== undefined || s.as !== undefined || s.guard !== undefined
        || s.maxManaValue !== undefined || s.exactManaValue !== undefined || s.count !== undefined) {
        throw new NoRenderer('a play of the cards of a group other than the plain optional free play of the cards of a group in exile');
      }
      const them = K.obj(f.is as ObjRef, st, 'object');
      if (!them.plural || them.text === AMBIGUOUS) throw new NoRenderer('the group of cards to play is not one named plural reference');
      const among = f.is!.ref === 'bound' && st.info.get(`b:${f.is!.name}`)?.thisWay === 'exiled this way' ? alt(them.text, 'cards exiled this way') : them.text; // (r5-moved: what a move exiled is also "cards exiled this way")
      const text = `you may play lands and cast spells from among ${among} without paying their mana costs`;
      return acting('you', text, text, { closesScope: true });
    }
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
      if (s.from === 'graveyard') t += ' from your graveyard'; // edh-next-50
      if (s.copyIn !== undefined) t = `a copy of ${t}`; // FAST5X E26 (CR 707.12): paradigm's copy, created in exile and cast
      if (s.free) t += ' without paying its mana cost';
      // r5-cost (CR 118.9, 601.2b): "cast that card by discarding a card rather than paying its mana cost" (an alternative cost of the one cast, kind `set`)
      if (discardInstead(s.costChange)) t += ' by discarding a card rather than paying its mana cost';
      // edh-next-49 (CR 118.9, 202.3; Bismuth Mindrender, Anrakyr the Traveller): "cast that card by paying life equal to the spell's mana value rather than paying its mana cost"
      if (lifeInstead(s.costChange)) t += ` by paying life equal to ${alt('its', "that spell's", "the spell's")} mana value rather than paying its mana cost`;
      // edh-d-100 (CR 118.9, 202.3, 107.14; Amped Raptor): "cast that card by paying an amount of {E} equal to its mana value rather than paying its mana cost"
      if (s.costChange !== undefined && JSON.stringify(s.costChange) === '{"kind":"set","energy":"manaValue"}') t += ' by paying an amount of {E} equal to its mana value rather than paying its mana cost';
      if (s.anyManaType === true) t += `, and mana of any type can be spent to cast ${alt('that spell', 'it')}`; // FAST5X E29: CR 609.4b
      // edh-cast-9 (CR 118.9, 202.3, 601.2; Solstice Revelations, the parser's template eff.stdrj.cast.free.ifSpellMvLess): "if the spell's mana value is less than N" is the cap N - 1 on the
      // spell the cast makes (the face cast, as for cascade), not a check of the card before it is cast
      const lessThan = lessThanCap(s.maxManaValue);
      // edh-cast-9 (CR 118.9, 202.3, 601.2; Powerbalance, the parser's template eff.edhc9.cast.free.sameManaValue): "if the two spells have the same mana value": the resulting spell
      // has exactly the mana value of the spell that caused the trigger
      if (s.exactManaValue !== undefined) {
        if (!isEventSpellManaValue(s.exactManaValue) || s.maxManaValue !== undefined) throw new NoRenderer('an exact mana value other than the triggering spell\'s');
        t += ' if the two spells have the same mana value';
      }
      else if (lessThan !== null) t += ` if the spell's mana value is less than ${K.qty(lessThan, st)}`;
      // std-rq (CR 601.2, 202.3; family cast-max-mana-value): "if that spell's mana value is 8 or less", "if the resulting spell's mana value is 8 or less"
      else if (typeof s.maxManaValue === 'number') t += ` if ${alt("that spell's", "the resulting spell's")} mana value is ${s.maxManaValue} or less`;
      // std-rx31 (CR 601.2, 202.3, 608.2h; family cast-max-mana-value): a cap read as the step runs, "if the spell's mana value is less than or equal to the amount of
      // life you gained this turn" (the parser's template eff.stdrx31.cast.free.maxManaValue.qty)
      // trek-5 (family cast-free-mv-at-most): ... and "equal to or less than" says it too (the parser's eff.trek5.cast.free.ifSpellMvAtMost; Commander Spock)
      // edh-cast-8 (CR 118.9, 202.3, 601.2; Rashmi, Eternities Crafter): "if it's a spell with lesser mana value": the resulting spell's mana value is less than the mana value of the
      // spell that caused the trigger (the cap is that value minus 1; the parser's template eff.edhc8.cast.free.lesserMv)
      else if (isLesserThanEventSpell(s.maxManaValue)) t += " if it's a spell with lesser mana value";
      else if (s.maxManaValue !== undefined) {
        const cap = K.qty(s.maxManaValue, st);
        t += ` if ${alt(...["that spell's", "the resulting spell's", "the spell's"].flatMap((who) => [`${who} mana value is less than or equal to ${cap}`, `${who} mana value is equal to or less than ${cap}`]))}`;
      }
      // edh-d-1 (CR 608.2g, 601.2, 118.9; Omen Machine, Wild Evocation, template eff.edhd1.player.cast.free.ifAble): another player's cast that is not optional is
      // "casts it without paying its mana cost" and "... if able" (a spell that cannot be cast now is not cast, the same instruction)
      if (!s.optional && s.free === true && s.who.ref !== 'you' && s.maxManaValue === undefined && s.exactManaValue === undefined && s.copyIn === undefined && s.costChange === undefined) t += alt('', ' if able');
      return t;
    };
    // std-rj (CR 608.2c, 601.2): "If you don't cast that card this way" says that the cast of one card (render/cond.ts#did)
    if (s.as !== undefined && s.who.ref === 'you' && s.what.ref === 'bound' && s.free === true) st.info.set(`r:${s.as}`, { nouns: ['card'], plural: false, thisWay: 'cast this way' });
    const verb = s.play === true ? 'play' : 'cast'; // FAST5X E26 (CR 305.9, 702.75a): "you may play the exiled card"
    // std-rx31 (CR 608.2c; family otherwise-after-cast): an optional cast that names its result: "Otherwise, Y" after it is "If you don't, Y" (render/steps-flow.ts)
    // (inside the branch of an `if`, "Otherwise" would be the other branch: only the words "if it wasn't cast this way" name the cast there); std-rj's record above is kept
    if (s.optional === true && s.as !== undefined && s.who.ref === 'you') st.info.set(`r:${s.as}`, { ...(st.info.get(`r:${s.as}`) ?? { nouns: ['card'], plural: false }), castOption: st.stepIf === undefined ? true : 'inIf', ...(s.what.ref === 'target' ? { castTarget: true as const } : {}) });
    const c0 = s.optional ? modal(s.who, st, `may ${verb} ${rest()}`) : byPlayer(s.who, st, verb, rest);
    // edh-d-6 (CR 607.2a, 108.3, 601.2, 118.9; Spell Queller; family exiled-card-owner-casts): "the exiled card's owner may cast that card without paying its mana cost" (the card a linked ability exiled, cast by its owner)
    if (s.optional === true && s.free === true && s.who.ref === 'ownerOf' && JSON.stringify(s.who.object) === '{"ref":"linked","link":"exiled"}' && JSON.stringify(s.what) === '{"ref":"linked","link":"exiled"}'
      && s.play === undefined && s.copyIn === undefined && s.costChange === undefined && s.anyManaType === undefined && s.transformed === undefined && s.graveyardInstead === undefined
      && s.select === undefined && s.maxManaValue === undefined && s.exactManaValue === undefined && s.as === undefined && s.guard === undefined && s.count === undefined) {
      const said = alt(c0.imp, "the exiled card's owner may cast that card without paying its mana cost");
      return { ...c0, imp: said, sub: said };
    }
    const gi = s.graveyardInstead;
    const castF = s.what.ref === 'target' ? st.specs.get(s.what.id)?.filter : undefined; // edh-d-96: the card cast is a target card in your graveyard
    const giText = gi === undefined ? '' : graveyardInsteadText(gi, castF?.zone === 'graveyard' && castF.owner === 'you');
    const c = gi === undefined ? c0 : { ...c0, imp: c0.imp + giText, sub: c0.sub + giText, standalone: true };
    if (!s.costChange || discardInstead(s.costChange) || lifeInstead(s.costChange) || JSON.stringify(s.costChange) === '{"kind":"set","energy":"manaValue"}' /* edh-d-100 */) return c;
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
  // edh-top-8 (CR 115.7, 608.2c; Clause.joined; Invert Polarity): after a plain instruction on the same spell, "..., gain control of that spell and you may choose new targets for it" joins them
  chooseNewTargets: (s: StepOf<'chooseNewTargets'>, st: RenderState): Clause => {
    // edh-next-134 (CR 115.7d, 701.12a; family spells-controller-new-targets; Sudden Substitution): the controller of the one spell the step names, after an exchange of control of that
    // spell: "Then the spell's controller may choose new targets for it" (who controls it is read as the step runs), as well as the plain wording below
    if (s.who.ref === 'controllerOf' && JSON.stringify(s.who.object) === JSON.stringify(s.what) && s.what.ref === 'target' && st.specs.get(s.what.id)?.kind === 'spell') {
      const plainForm = `${K.player(s.who, cloneState(st), 'subject').text} may choose new targets for ${K.obj(s.what, cloneState(st), 'object').text}`;
      K.obj(s.what, st, 'object');
      return plain(alt(plainForm, "then the spell's controller may choose new targets for it", "the spell's controller may choose new targets for it"), { standalone: true });
    }
    if (s.random !== undefined || s.notYours !== undefined) throw new NoRenderer('new targets chosen at random, said only by its fold (render/fold-edhn129.ts)'); // edh-next-129
    const what = K.obj(s.what, st, 'object').text;
    return { ...modal(s.who, st, `may choose new targets for ${what}`, { standalone: true }), ...(s.who.ref === 'you' ? { joined: `you may choose new targets for ${what}` } : {}) };
  },
};

/**
 * r4-repl (CR 614.1a): the sentence of a cast's `graveyardInstead`, ". if that spell would be put into your graveyard, exile it instead" / "... put it on the bottom
 * of its owner's library instead"; std-rw7 (CR 614.1a, 205.2a): with `types`, ". if an instant or sorcery spell cast this way would be put into your graveyard, ...".
 */
export function graveyardInsteadText(gi: NonNullable<StepOf<'cast'>['graveyardInstead']>, fromYourGraveyard = false): string {
  const to = gi.to.zone === 'exile' && Object.keys(gi.to).length === 1 ? 'exile it' : gi.to.zone === 'library' && gi.to.position === 'bottom' && Object.keys(gi.to).length === 2 ? "put it on the bottom of its owner's library" : null;
  if (to === null) throw new NoRenderer('a spell cast this way sent elsewhere than exile or the bottom of its library instead of a graveyard');
  if (gi.types !== undefined && (gi.types.length < 2 || gi.yours !== true)) throw new NoRenderer('a spell of one card type, or of several sent from a graveyard that is not yours');
  // edh-d-96 (CR 614.1a, 400.7; Gale, Waterdeep Prodigy; family cast-this-way-spell): a cast of a card from your graveyard also says where it was cast from, "a spell cast from your graveyard this way"
  const spell = gi.types === undefined ? alt('that spell', 'a spell cast this way', ...(fromYourGraveyard && gi.yours === true ? ['a spell cast from your graveyard this way'] : [])) /* edh-top-6: family cast-this-way-spell */ : `${withArticle(joinList(gi.types.map((t) => t.toLowerCase()), 'or'))} spell cast this way`;
  return `. if ${spell} would be put into ${graveyardOfWord(gi.yours === true)} graveyard, ${to} instead`; // edh-next-71: "their graveyard"
}

/** edh-next-131: an alternative cost of a cast during a resolution that is a mana cost alone ("by paying {3} rather than paying its mana cost"): its symbols, or null. */
function payingInstead(ch: StepOf<'cast'>['costChange']): string | null {
  if (ch === undefined || ch.kind !== 'set' || ch.mana !== undefined || ch.generic !== undefined || ch.cost === undefined || ch.name !== 'alternative' || ch.life !== undefined) return null;
  const c = ch.cost;
  if (Object.keys(c).some((k) => k !== 'mana') || c.mana === undefined || c.mana.length === 0) return null;
  return formatManaCost(c.mana);
}

/** edh-next-49: an alternative cost of a cast during a resolution that is life equal to the spell's mana value, nothing else. */
function lifeInstead(ch: StepOf<'cast'>['costChange']): boolean {
  return ch !== undefined && JSON.stringify(ch) === '{"kind":"set","life":"manaValue"}';
}

/** r5-cost: an alternative cost of a cast during a resolution that is discarding one card, nothing else ("by discarding a card rather than paying its mana cost"). */
function discardInstead(ch: StepOf<'cast'>['costChange']): boolean {
  if (ch === undefined || ch.kind !== 'set' || ch.mana !== undefined || ch.generic !== undefined || ch.cost === undefined) return false;
  const c = ch.cost;
  const p = c.other?.[0];
  return c.mana === undefined && c.tap !== true && c.other?.length === 1 && p !== undefined && p.kind === 'discard' && p.count === 1 && p.filter === undefined && Object.keys(c).every((k) => k === 'other');
}

/** edh-d-39 (CR 702.26b-c, 610.3): the clause of a phase-out (steps-zones `phaseOut`, which makes a spell or ability on the stack no antecedent of its pronoun). */
function phaseOutClause(s: StepOf<'phaseOut'>, st: RenderState): Clause {
  // edh-d-39 (CR 702.26b, 608.2c; Out of Time): what the step phased out, counted by a later "for each creature that phased out this way" (resultCount, render/qty.ts#countParts):
  // the one card type it phases out (a described set, a target, or the set an earlier step bound), then "permanent" (parser/lower/quantities.ts#phasedNounFits)
  if (s.as !== undefined) {
    const bound = s.what.ref === 'bound' ? st.info.get(`b:${s.what.name}`)?.nouns : undefined;
    const nouns = bound !== undefined && bound[0] !== undefined && bound[0] !== 'permanent' && bound[0] !== 'object' && bound.length <= 2 ? [bound[0], 'permanent'] : destroyedNouns(s.what, st);
    st.info.set(`r:${s.as}`, { nouns, plural: true, thisWay: 'that phased out this way' });
  }
  // edh-perms-22 (CR 610.3, 702.26b-c): "<objects> phase(s) out until ~ leaves the battlefield. Tap that creature as it phases in this way." (the duration follows the verb)
  if (s.until !== undefined) {
    // (the subject first: the duration names "~", which would make a pronoun for the object ambiguous)
    const phrase = withSubjects(s.what, st, (subject, plural) => `${subject} ${plural ? 'phase' : 'phases'} out ${K.dur(s.until!, st)}`);
    if (s.tapped !== true) return plain(phrase);
    const again = K.obj(s.what, st, 'object').text;
    return { ...plain(`${phrase}. tap ${again} as it phases in this way`), standalone: true };
  }
  const [imperative, subject] = withVariants(st, [
    (v) => { v.permanentOnly = true; return `phase out ${K.obj(s.what, v, 'object').text}`; },
    // std-rm (CR 702.26b): a described set as the subject has several wordings ("all creatures you control phase out", "each creature target player controls
    // phases out"), the verb agreeing with each (refs.ts#withSubjects)
    (v) => { v.permanentOnly = true; return withSubjects(s.what, v, (subject, plural) => `${subject} ${plural ? 'phase' : 'phases'} out`); },
  ]);
  return plain(alt(imperative!, subject!));
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
  // edh-c-62 (CR 701.19c, 701.19a, 608.2c; family destroyed-this-way-no-regen-the-noun): one object that can be a creature (only creatures regenerate) is also named "the creature"
  // ("Destroy that creature. The creature can't be regenerated.")
  const head = !info.plural && info.player !== true && (info.nouns.includes('creature') || (info.nouns.length === 1 && info.nouns[0] === 'permanent')) ? [`the creature can't be regenerated`] : [];
  return alt(`${pron} can't be regenerated`, `${named} can't be regenerated`, ...head);
}

function destroyedNouns(what: ObjRef, st: RenderState): string[] {
  const f = what.ref === 'each' && 'filter' in what ? what.filter : what.ref === 'target' ? st.specs.get(what.id)?.filter : undefined;
  const types = f !== undefined && f.anyOf === undefined ? f.types ?? [] : [];
  return types.length === 1 ? [types[0]!.toLowerCase(), 'permanent'] : ['permanent'];
}

/**
 * edh-perms-5 (CR 707.9b, 107.1a, 613.4b): "their power is half that creature's power and their toughness is half that creature's toughness. Round up each time." for a
 * copy exception of one base power and toughness (layer 7b) whose two numbers are each half of a quantity with the same rounding. Null for any other exception.
 */
function halfPtExceptText(x: NonNullable<StepOf<'copy'>['except']>[number], st: RenderState): string | null {
  if (!('layer' in x) || x.layer !== '7b' || x.power === undefined || x.toughness === undefined) return null;
  const half = (q: Quantity): { op: 'ceilDiv' | 'floorDiv'; of: Quantity } | null =>
    typeof q === 'object' && q.q === 'math' && (q.op === 'ceilDiv' || q.op === 'floorDiv') && q.args.length === 2 && q.args[1] === 2 && typeof q.args[0] === 'object' ? { op: q.op, of: q.args[0] } : null;
  const p = half(x.power);
  const t = half(x.toughness);
  if (p === null || t === null || p.op !== t.op) return null;
  return `their power is half ${K.qty(p.of, st)} and their toughness is half ${K.qty(t.of, st)}. round ${p.op === 'ceilDiv' ? 'up' : 'down'} each time`;
}

/** edh-cast-8: the cap `{q:'math', op:'-', args:[{q:'stat', stat:'manaValue', of: the triggering cast event's spell}, 1]}` of "a spell with lesser mana value". */
function isLesserThanEventSpell(q: unknown): boolean {
  if (typeof q !== 'object' || q === null) return false;
  const m = q as { q?: string; op?: string; args?: unknown[] };
  if (m.q !== 'math' || m.op !== '-' || m.args?.length !== 2 || m.args[1] !== 1) return false;
  const a = m.args[0] as { q?: string; stat?: string; of?: { ref?: string; role?: string } };
  return a.q === 'stat' && a.stat === 'manaValue' && a.of?.ref === 'event' && a.of.role === 'spell';
}

/** edh-cast-9: the cap `{q:'math', op:'-', args:[N, 1]}` of "if the spell's mana value is less than N" (CR 202.3): N, else null. */
function lessThanCap(q: unknown): Quantity | null {
  if (typeof q !== 'object' || q === null) return null;
  const m = q as { q?: string; op?: string; args?: Quantity[] };
  if (m.q !== 'math' || m.op !== '-' || m.args?.length !== 2 || m.args[1] !== 1) return null;
  const a = m.args[0]!;
  // the cap of a lesser mana value than the spell that caused the trigger is a different wording
  return typeof a === 'object' && a.q === 'stat' && a.stat === 'manaValue' && a.of !== undefined && typeof a.of === 'object' && 'ref' in a.of && a.of.ref === 'event' ? null : a;
}

/** edh-cast-9: the mana value of the spell that caused the trigger, `{q:'stat', stat:'manaValue', of: {ref:'event', role:'spell'}}`. */
function isEventSpellManaValue(q: unknown): boolean {
  if (typeof q !== 'object' || q === null) return false;
  const a = q as { q?: string; stat?: string; of?: { ref?: string; role?: string } };
  return a.q === 'stat' && a.stat === 'manaValue' && a.of?.ref === 'event' && a.of.role === 'spell';
}

