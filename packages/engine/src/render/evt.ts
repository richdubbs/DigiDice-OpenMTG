/**
 * Event patterns as clauses (WP2): "~ enters", "a creature you control dies", "an opponent casts a spell", "equipped creature deals combat damage to a
 * player", "the beginning of your upkeep". One printer serves triggers (present), replacement effects ("would") and history conditions (past).
 * No leading "when"/"whenever"/"if": the frame adds it.
 */
import { WITHOUT_DYING, type EventPattern, type ObjectFilter, type PlayerPred, type PlayerRef, type ZoneName } from '../types/ability';
import { attachedToWithStat } from './fold-stdcombat1';
import { K, type EventOpts } from './kernel';
import { cloneState, type RenderState } from './state';
import { possessiveStep, turnOf } from './turn';
import { alt, conj, joinList, NoRenderer, ordinal, withArticle, type Person } from './text';

type Tense = 'present' | 'past' | 'would';

/** A printed event: the subject (may be empty when the whole clause is in the predicate) and the rest. */
interface Parts {
  subject: string;
  predicate: string;
  /** The subject is the object with the ability: later mentions are "it". */
  plural: boolean;
}

const ZONE_NAME: Record<string, string> = { graveyard: 'graveyard', hand: 'hand', library: 'library', exile: 'exile', battlefield: 'battlefield', stack: 'stack', command: 'command zone' };

const onlyKeys = (f: ObjectFilter, ...keys: string[]): boolean => Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).every((k) => keys.includes(k));
const isSelfOnly = (f: ObjectFilter): boolean => f.self === true && onlyKeys(f, 'self');

const BASIC_LAND_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
/** std-rk (CR 505.1a, 603.2): the plural names of the steps "at the beginning of each of your ..." is said of (parser/holes/event.ts#EACH_OF_YOUR_STEPS). */
const EACH_OF_YOUR_STEPS: Partial<Record<string, string>> = { upkeep: 'upkeeps', draw: 'draw steps', main1: 'precombat main phases', main2: 'postcombat main phases', end: 'end steps' };

/** FAST1 T4, CR 106.12: a filter that names lands only (the same test as parser/holes/event.ts#landTappedForMana). */
function landSource(f: ObjectFilter): boolean {
  if (f.anyOf !== undefined || f.not !== undefined || f.self === true) return false;
  const types = f.types ?? [];
  if (types.length === 1 && types[0] === 'Land') return true;
  if (types.length === 0 && (f.allTypes ?? []).includes('Land')) return true;
  return types.length === 0 && f.allTypes === undefined && (f.subtypes?.length ?? 0) > 0 && f.subtypes!.every((t) => BASIC_LAND_TYPES.includes(t));
}

/** r3-fx: the bare present verbs of an object's own events and their plural forms (a plural name, CR 201.5). */
const PLURAL_OF_BARE: Readonly<Record<string, string>> = { attacks: 'attack', blocks: 'block', enters: 'enter', dies: 'die' };

/** Verb forms by tense: [singular, plural/base, past]. */
function verb(forms: [string, string, string], tense: Tense, plural: boolean): string {
  if (tense === 'past') return forms[2];
  if (tense === 'would') return `would ${forms[1]}`;
  return plural ? forms[1] : forms[0];
}

/** The passive "is/are/was/were/would be" + participle. */
function passive(participle: string, tense: Tense, plural: boolean): string {
  if (tense === 'past') return `${plural ? 'were' : 'was'} ${participle}`;
  if (tense === 'would') return `would be ${participle}`;
  return `${plural ? 'are' : 'is'} ${participle}`;
}

function personVerb(base: string, past: string, tense: Tense, person: Person): string {
  if (tense === 'past') return past;
  if (tense === 'would') return `would ${base}`;
  // std-rl (CR 700.13): a verb of several words is conjugated on its first word: "an opponent commits a crime", "an opponent gives a gift"
  const sp = base.indexOf(' ');
  return sp < 0 ? conj(base, person) : `${conj(base.slice(0, sp), person)}${base.slice(sp)}`;
}

/** The subject of an event: "~", "a creature you control", "another creature", "one or more creatures". */
function subjectOf(f: ObjectFilter, st: RenderState, o: EventOpts, zoneless = false, head?: string): { text: string; plural: boolean } {
  const filter: ObjectFilter = zoneless ? { ...f, zone: 'any' } : f;
  if (isSelfOnly(f)) {
    // the object with the ability is named in the event itself, always as "~": whatever follows may call it "it"
    st.mentioned.add('self');
    st.mentioned.add('e:subject');
    if (!st.info.has('self')) st.info.set('self', { nouns: ['permanent'], plural: false });
    return { text: '~', plural: false };
  }
  st.mentioned.add('e:subject');
  if (o.batch) return { text: K.np(filter, st, { count: 'one or more', plural: true, det: 'none', head }), plural: true };
  return { text: selfOrAnother(f, filter, st, K.np(filter, st, { det: 'a', head })), plural: false };
}

/**
 * "~ or another creature": the model says "a creature", which includes the object with the ability when it is one. FAST1 T4: also a subtype ("~ or another Ally
 * you control"): the object with the ability has a word of every named group (a card type of `types`, a subtype of `subtypes`), so the filter includes it (CR 603.2,
 * 603.6a, 205.3). CLOUD std-misc: also the object of an action ("whenever you sacrifice ~ or another artifact", CR 701.21a).
 */
function selfOrAnother(f: ObjectFilter, filter: ObjectFilter, st: RenderState, base: string): string {
  const selfTypes = st.ctx.selfTypes?.map((t) => t.toLowerCase());
  const types = f.types?.map((t) => t.toLowerCase());
  const subtypes = f.subtypes?.map((t) => t.toLowerCase());
  // std-rx25 (CR 205.1, 109.2): and every type of an "all of" list ("~ or another artifact creature dies", Dross Scorpion, an artifact creature itself)
  const allTypes = f.allTypes?.map((t) => t.toLowerCase());
  const named = (types?.length ?? 0) + (subtypes?.length ?? 0) + (allTypes?.length ?? 0) > 0;
  const selfIn = (ws: string[] | undefined): boolean => ws === undefined || ws.length === 0 || ws.some((t) => selfTypes!.includes(t));
  const selfAll = allTypes === undefined || allTypes.every((t) => selfTypes!.includes(t));
  if (selfTypes && named && selfIn(types) && selfIn(subtypes) && selfAll && onlyKeys(f, 'types', 'subtypes', 'allTypes', 'controller') && !f.other && (f.controller === undefined || f.controller === 'you' || f.controller === 'any')) {
    const another = K.np({ ...filter, other: true }, st, { det: 'a' });
    return alt(base, `~ or ${another}`);
  }
  return base;
}

function playerSubject(p: PlayerPred | PlayerRef | undefined, st: RenderState): { text: string; person: Person; plural: boolean } {
  if (p === undefined) return { text: 'a player', person: 'sg', plural: false };
  const ph = K.player(p, st, 'subject');
  return { text: ph.text, person: ph.person, plural: ph.plural };
}

function zoneNoun(z: ZoneName | ZoneName[] | undefined, owner: PlayerPred | undefined): string {
  const zones = z === undefined ? [] : [z].flat();
  const poss = owner === 'you' ? 'your' : owner === 'opponent' ? "an opponent's" : 'a';
  return joinList(zones.map((x) => (x === 'battlefield' ? 'the battlefield' : x === 'exile' ? 'exile' : `${poss} ${ZONE_NAME[x]}`)), 'or');
}

function zoneChange(ev: Extract<EventPattern, { ev: 'zoneChange' }>, st: RenderState, tense: Tense, o: EventOpts): Parts {
  const f = ev.subject;
  const from = ev.from === undefined ? undefined : [ev.from].flat();
  const to = ev.to === undefined ? undefined : [ev.to].flat();
  const toBf = to?.length === 1 && to[0] === 'battlefield';
  const fromBf = from?.length === 1 && from[0] === 'battlefield';
  // A subject that is not on the battlefield before or after is "a card" (or "a card or token"): its zones are said by the predicate, and the owner of a
  // card put into a graveyard is named by that zone ("an opponent's graveyard"), so the subject is printed without either.
  const zoneless = !fromBf && !toBf;
  // Standard round 3, r3-trig (CR 702.167a): "when ~ is exiled from the battlefield while you're activating a craft ability": the object itself, exiled as craft's material
  if (ev.cause === 'craft') {
    if (f.self !== true || !onlyKeys(f, 'self') || !fromBf || to?.length !== 1 || to[0] !== 'exile' || tense !== 'present' || o.batch === true) throw new NoRenderer('a craft exile other than of the object itself');
    return { subject: K.obj({ ref: 'self' }, st, 'subject').text, predicate: "is exiled from the battlefield while you're activating a craft ability", plural: false };
  }
  // FAST5 T50 (CR 603.10a, 700.4): "when it dies under your control this turn": the object a reference names, judged by who controlled it as it died (last known
  // information). `np.ts` words a bare reference without its other fields, so this one pair is worded here and every other combination is refused.
  if (f.is !== undefined && f.controller !== undefined) {
    if (f.controller !== 'you' || !onlyKeys(f, 'is', 'controller') || !fromBf || to?.length !== 1 || to[0] !== 'graveyard') throw new NoRenderer('a referenced object with a controller outside "dies under your control"');
    const who = subjectOf({ is: f.is }, st, o, false);
    return { subject: who.text, predicate: `${verb(['dies', 'die', 'died'], tense, who.plural)} under your control`, plural: who.plural };
  }
  // CMD2 (CR 903.9, 408.1): "your commander is put into the command zone from anywhere" (parser/holes/event.ts): a commander you own, the command zone of no one
  if (to?.length === 1 && to[0] === 'command' && from === undefined && f.commander === true && f.owner === 'you' && onlyKeys(f, 'commander', 'owner')) {
    const yc = subjectOf(f, st, o, false);
    return { subject: yc.text, predicate: `${passive('put into the command zone', tense, yc.plural)} from anywhere`, plural: yc.plural };
  }
  // std-rx19 (CR 603.6a, 110.5b; Gingerbread Cabin): "when ~ enters untapped": the object itself put onto the battlefield untapped (parser/holes/event.ts)
  if (toBf && from === undefined && f.self === true && f.tapped === false && onlyKeys(f, 'self', 'tapped')) {
    const me = subjectOf({ self: true }, st, o, false);
    return { subject: me.text, predicate: `${verb(['enters', 'enter', 'entered'], tense, me.plural)} untapped`, plural: me.plural };
  }
  // Precon round O, std-ro (CR 700.4, 404.1): a card goes to its owner's graveyard, so "~ is put into your graveyard from the battlefield" is ~ dying while you own it
  // (the object itself and its owner, the one pair `np.ts` does not word; any other owned subject: std-rp's put-into-your-graveyard below)
  const ownerGraveyard = fromBf && to?.length === 1 && to[0] === 'graveyard' && (f.owner === 'you' || f.owner === 'opponent');
  if (ownerGraveyard && f.self === true && onlyKeys(f, 'self', 'owner')) {
    const me = subjectOf({ self: true }, st, o, false);
    return { subject: me.text, predicate: `${passive(f.owner === 'you' ? 'put into your graveyard' : "put into an opponent's graveyard", tense, me.plural)} from the battlefield`, plural: me.plural };
  }
  const noTypes = !f.types && !f.subtypes && !f.allTypes && f.token === undefined && !f.stackKind;
  const owner = f.owner;
  const ownerInZone = zoneless && owner !== undefined && owner !== 'any' && !isSelfOnly(f);
  const printed: ObjectFilter = ownerInZone ? { ...f, owner: undefined } : f;
  const head = zoneless && noTypes && f.isCard !== false ? (f.isCard === true ? 'card' : 'card or token') : undefined;
  // r5-repl (CR 108.4, 108.4a): "If a card you didn't control would be put into an opponent's graveyard from anywhere": a card that may come from a zone where
  // it has no controller is said with the past tense (who controlled it, if anyone did); the filter is `not: {controller: 'you'}`
  const didnt = zoneless && tense === 'would' && f.not !== undefined && onlyKeys(f.not, 'controller') && f.not.controller === 'you';
  const sub0 = subjectOf(didnt ? { ...printed, not: undefined } : printed, st, o, zoneless, head);
  const sub = didnt ? { ...sub0, text: `${sub0.text} you didn't control` } : sub0;
  const subject = sub.text;
  if (toBf) {
    const fromPart = from && !fromBf ? ` from ${zoneNoun(ev.from, f.owner)}` : '';
    // FAST5 T64 (CR 201.5): a plural name takes a plural verb, "When Ran and Shaw enter" (parser/front/selfref.ts#pluralPronounRefs), the object itself either way
    const entered = tense === 'present' && subject === '~' && !sub.plural && (st.trigger ?? []).length <= 1 ? alt('enters', 'enter') : verb(['enters', 'enter', 'entered'], tense, sub.plural);
    return { subject, predicate: `${entered}${fromPart}`, plural: sub.plural };
  }
  if (fromBf && to?.length === 1 && to[0] === 'graveyard') {
    const own = st.ctx.selfTypes?.map((t) => t.toLowerCase());
    const attachedOnly = f.attachedToSource === true && !f.types?.length;
    // Standard round 4, r4-trig (CR 700.4; Tarrian's Soulcleaver): a subject of several card types, one of them Creature ("another artifact or creature"), is also
    // "is put into a graveyard from the battlefield", as any noncreature subject is (family dies-mixed-types: a reading of the group below, no new alt site)
    const mixed = (f.types ?? []).includes('Creature') && (f.types ?? []).some((t) => t !== 'Creature');
    const creature = !mixed && ((f.types ?? []).includes('Creature') || (isSelfOnly(f) && own?.includes('creature') === true) || (attachedOnly && own?.includes('equipment') === true));
    const unknownSelf = (isSelfOnly(f) && !own) || (attachedOnly && !own?.includes('equipment'));
    // std-rx31 (CR 201.5; family plural-name-verb, as "enter" above): "When Tom, Bert, and William die", the object itself either way
    const dies = tense === 'present' && subject === '~' && !sub.plural && (st.trigger ?? []).length <= 1 ? alt('dies', 'die') : verb(['dies', 'die', 'died'], tense, sub.plural);
    const put = `${passive('put into a graveyard', tense, sub.plural)} from the battlefield`;
    const put2 = `${passive('put into your graveyard', tense, sub.plural)} from the battlefield`;
    // Standard round P (CR 400.3, 700.4; Prowess of the Fair, Colfenor's Urn): an object you own put into a graveyard from the battlefield goes to its owner's
    // graveyard, yours, so Oracle names the owner by the zone, "whenever another nontoken Elf is put into your graveyard from the battlefield": the subject
    // without its owner; the words with the owner in the subject stay readings ("whenever another creature you own dies", Athreos), so the two are whole clauses
    // (a subject that also names a controller keeps the generic words)
    // p2-replace-events-2 (CR 614.1a, 113.6; family self-would-be-put-into-graveyard): the object itself in a replacement ("If this permanent would be put into a
    // graveyard, you may put it on top of its owner's library instead.", Pulmonic Sliver) leaves "from the battlefield" unsaid: its ability works only there
    const selfWould = isSelfOnly(f) && tense === 'would' ? [passive('put into a graveyard', tense, sub.plural)] : [];
    const generic0 = creature ? dies : unknownSelf ? alt(dies, put) : alt(put, put2, dies);
    const generic = selfWould.length > 0 ? alt(generic0, ...selfWould) : generic0;
    if (owner === 'you' && !isSelfOnly(f) && f.controller === undefined && !didnt) {
      const bare = subjectOf({ ...f, owner: undefined }, st, o, zoneless, head);
      if (bare.plural === sub.plural) {
        return { subject: '', predicate: alt(`${bare.text} ${passive('put into your graveyard', tense, bare.plural)} from the battlefield`, `${subject} ${generic}`), plural: sub.plural };
      }
    }
    // FAST1 T4: "dies" is "is put into a graveyard from the battlefield" for any object (CR 700.4): Oracle says it of creature types too ("another Zombie you control dies")
    return { subject, predicate: generic, plural: sub.plural };
  }
  // Cloud std-eoe (CR 700.4; parser/holes/event.ts): "dies or is put into exile", put into a graveyard or into exile from the battlefield (a creature, or the
  // object itself when it is a creature: "dies" says it of a creature, as above)
  if (fromBf && to?.length === 2 && to.includes('graveyard') && to.includes('exile')) {
    const own = st.ctx.selfTypes?.map((t) => t.toLowerCase());
    // p2-graveyard-1 (CR 700.4): "dies" is "is put into a graveyard from the battlefield" for any permanent, as FAST1 T4 says it above, so Oracle says it of a
    // noncreature too ("When enchanted permanent dies or is put into exile", Kaya's Ghostform); the object itself of unknown types stays refused
    const unknownSelf = isSelfOnly(f) && !own;
    if (unknownSelf) throw new NoRenderer('"dies or is put into exile" of the object itself, whose types are unknown');
    return { subject, predicate: `${verb(['dies', 'die', 'died'], tense, sub.plural)} or ${passive('put into exile', tense, sub.plural)}`, plural: sub.plural };
  }
  if (fromBf && to?.length === 1 && to[0] === 'exile') {
    return { subject, predicate: alt(`${passive('put into exile', tense, sub.plural)} from the battlefield`, passive('exiled', tense, sub.plural)), plural: sub.plural };
  }
  if (fromBf && to?.length === 1 && to[0] === 'hand') {
    return { subject, predicate: alt(`${passive('returned to its owner\'s hand', tense, sub.plural)}`, `${passive('put into a hand', tense, sub.plural)} from the battlefield`), plural: sub.plural };
  }
  // FAST4 T23 (parser/holes/event.ts): "one or more creature cards leave your graveyard" (the owner is said by the zone, CR 400.3)
  if (from?.length === 1 && from[0] === 'graveyard' && (to === undefined || to.length === 0) && ownerInZone) {
    // a card of a type is "a creature card" (the head word the zoneless subject would otherwise drop)
    const cards = f.isCard === true && head === undefined ? subjectOf(printed, st, o, zoneless, 'card') : sub;
    return { subject: cards.text, predicate: `${verb(['leaves', 'leave', 'left'], tense, cards.plural)} ${zoneNoun('graveyard', owner)}`, plural: cards.plural };
  }
  if (fromBf && (to === undefined || to.length === 0)) {
    // std-rx30 (CR 201.5; family plural-name-verb): a plural name takes a plural verb here too, "until Cloak and Dagger leave the battlefield"
    const left = tense === 'present' && subject === '~' && !sub.plural && (st.trigger ?? []).length <= 1 ? alt('leaves', 'leave') : verb(['leaves', 'leave', 'left'], tense, sub.plural);
    return { subject, predicate: `${left} the battlefield`, plural: sub.plural };
  }
  // FAST5 T65 (CR 700.4): left the battlefield for any zone but a graveyard (parser/holes/event.ts#WITHOUT_DYING)
  if (fromBf && to && to.length === WITHOUT_DYING.length && WITHOUT_DYING.every((z) => to.includes(z))) {
    return { subject, predicate: `${verb(['leaves', 'leave', 'left'], tense, sub.plural)} the battlefield without dying`, plural: sub.plural };
  }
  if (to && to.length > 0) {
    const dest = to.length === 1 && to[0] === 'exile' ? 'exile' : zoneNoun(ev.to, owner);
    // CLOUD std-dft (CR 603.2c, 406.1): a batch of cards from graveyards and from the battlefield, "one or more cards are put into exile from graveyards and/or the battlefield"
    const both = o.batch === true && owner === undefined && from?.length === 2 && from.includes('graveyard') && from.includes('battlefield');
    const fromPart = both ? ' from graveyards and/or the battlefield' : from ? ` from ${from.length === 1 && from[0] === 'battlefield' ? 'the battlefield' : zoneNoun(ev.from, from.length === 1 && from[0] === 'library' ? owner : undefined)}` : ' from anywhere'; // FAST5 T66: "from your library" names its owner
    // FAST5X E21: a card of a type is "a creature card", "one or more permanent cards" (the head word the zoneless subject would otherwise drop), as above
    const cards = zoneless && f.isCard === true && head === undefined ? subjectOf(printed, st, o, zoneless, 'card') : null;
    if (cards !== null && cards.plural === sub.plural) return { subject: cards.text, predicate: `${passive(`put into ${dest}`, tense, sub.plural)}${fromPart}`, plural: sub.plural };
    return { subject, predicate: `${passive(`put into ${dest}`, tense, sub.plural)}${fromPart}`, plural: sub.plural };
  }
  return { subject, predicate: `${verb(['changes zones', 'change zones', 'changed zones'], tense, sub.plural)}`, plural: sub.plural };
}

/** The events that have a "one or more" wording (CR 603.2c). Any other event with `batch` is refused: the flag would be lost. */
const BATCHABLE = new Set(['zoneChange', 'attacks', 'blocks', 'becomesBlocked', 'damage', 'becomes', 'counters', 'action', 'createToken', 'dieRoll']);

function eventParts(ev: EventPattern, st: RenderState, tense: Tense, o: EventOpts, ownFrom?: string): Parts {
  if (o.batch === true && !BATCHABLE.has(ev.ev)) throw new NoRenderer(`"one or more" for the event ${ev.ev}`);
  // CLOUD std-misc (CR 603.2c): the players counted together exist only for a player action of any player, in the present tense (Standard merge wave 3: and for
  // "one or more of your opponents are attacked", checked in the attacks case below)
  // Standard round 5, r5-trig (CR 603.2c, 122.6): also "you put one or more counters on one or more <objects>" (counters by you, rendered below)
  const counterWhole = ev.ev === 'counters' && ev.by === 'you' && tense === 'present';
  // std-rr (CR 603.2c): and "one or more [of your] opponents are dealt [combat] damage" (rendered in the damage case below)
  const opponentsDealt = ev.ev === 'damage' && ev.source === undefined && ev.amount === undefined && ev.excess !== true && ev.recipient?.player === 'opponent' && ev.recipient.object === undefined;
  if (o.wholeBatch === true && (o.batch !== true || (ev.ev !== 'action' && ev.ev !== 'attacks' && !counterWhole && !opponentsDealt) || (ev.ev === 'action' && (ev.actor ?? 'any') !== 'any') || tense !== 'present')) throw new NoRenderer('"one or more players" for another event');
  switch (ev.ev) {
    case 'zoneChange': {
      // std-control-1 (CR 601.2a, 406.1; parser/holes/event.ts): "~ is cast from exile": the card itself moving from exile to the stack, which only casting does
      const self = JSON.stringify(ev.subject) === '{"self":true}' || JSON.stringify(ev.subject) === '{"is":{"ref":"costExiled","self":true}}';
      if (self && ev.from === 'exile' && ev.to === 'stack' && Object.keys(ev).length === 4 && o.batch !== true) {
        return { subject: K.obj({ ref: 'self' }, st, 'subject').text, predicate: passive('cast from exile', tense, false), plural: false };
      }
      return zoneChange(ev, st, tense, o);
    }
    case 'cast': {
      // Standard round P (CR 400.3, 601.2a; Thalia's Geistcaller): "whenever you cast a spell from your graveyard": a spell you own cast from a graveyard, which is its
      // owner's graveyard (parser/holes/event.ts reads "from your graveyard" / "from your library" as the spell's owner): the owner is said by the zone
      const ownZone = ev.player === 'you' && ev.spell?.owner === 'you' && (ev.from === 'graveyard' || ev.from === 'library');
      if (ownZone && ownFrom === undefined) return eventParts({ ...ev, spell: { ...ev.spell!, owner: undefined } }, st, tense, o, ` from your ${ZONE_NAME[ev.from as 'graveyard' | 'library']}`);
      const p = playerSubject(ev.player ?? 'any', st);
      st.mentioned.add('e:player');
      st.mentioned.add('e:spell');
      // CMDF (CR 903.3d, 903.3e): "you cast your commander": the caster's own commander spell (equivalence your-commander: "a commander spell you own")
      const yourCommander = ev.spell !== undefined && ev.player === 'you' && ev.spell.commander === true && ev.spell.owner === 'you' && Object.keys(ev.spell).length === 2;
      // FAST5 T45 (CR 601.2a): "a spell from anywhere other than your hand" (parser/holes/event.ts): a spell filter whose only negation is `castFrom` hand
      // std-rm (CR 601.2a): also another player's "from anywhere other than their hand" (a player named by a word, never an anaphor)
      const notHand = ev.spell?.not !== undefined && Object.keys(ev.spell.not).length === 1 && ev.spell.not.castFrom === 'hand' && typeof ev.player === 'string';
      // CMD2 (CR 113.6k, 601.2i): "when you cast ~" (this spell; parser/lower/cast-self.ts#castSelfAutomated): the spell itself, no other filter field
      const selfSpell = ev.spell !== undefined && ev.spell.self === true && Object.values(ev.spell).filter((v) => v !== undefined).length === 1;
      const spell0 = selfSpell ? K.obj({ ref: 'self' }, st, 'object').text : yourCommander ? alt('your commander', K.np({ ...ev.spell!, stackKind: 'spell' }, st, { det: 'a' })) : ev.spell ? K.np({ ...ev.spell, ...(notHand ? { not: undefined } : {}), stackKind: ev.spell.stackKind ?? 'spell' }, st, { det: 'a' }) : 'a spell';
      // std-tdm (CR 601.2i, 603.2; family cast-spell-or-spell): a spell of either of two descriptions and nothing else is also two noun phrases, "a noncreature spell
      // or a Dragon spell" (trigger trg.stdtdm.cast.spellOrSpell); the one noun phrase stays a reading
      const either = !yourCommander && !selfSpell && ev.spell !== undefined && Object.keys(ev.spell).every((k) => k === 'anyOf' || (k === 'stackKind' && ev.spell!.stackKind === 'spell')) && ev.spell.anyOf?.length === 2
        ? ev.spell.anyOf.map((x) => K.np({ ...x, stackKind: 'spell' }, st, { det: 'a' })).join(' or ') : null;
      const spell = either === null ? spell0 : alt(spell0, either);
      // cloud std-spm (CR 406.1): exile is no one's zone: "cast a spell from exile" (std-lci made the same change, Quintorius Kand)
      const from = ownFrom !== undefined ? ownFrom : notHand ? ` from anywhere other than ${ev.player === 'you' ? 'your' : 'their'} hand` : ev.from ? ` from ${ev.from === 'hand' ? 'your hand' : ev.from === 'exile' ? 'exile' : `a ${ZONE_NAME[ev.from]}`}` : '';
      const text = ev.orCopy ? (tense === 'past' ? 'cast or copied' : tense === 'would' ? 'would cast or copy' : p.person === 'sg' ? 'casts or copies' : 'cast or copy') : personVerb('cast', 'cast', tense, p.person);
      // Standard round 5, r5-trig: "from anywhere other than your hand" and "other than your first spell that turn" have their wordings where the whole sentence is known
      // (render/cond.ts, render/abil.ts#notFirstSpell); never dropped here
      if (ev.notFrom !== undefined || ev.nthMin !== undefined) throw new NoRenderer('a cast pattern with notFrom or nthMin outside its wording');
      // std-exile-play-1-1 (CR 108.3): "whenever a player casts a spell they don't own": only a spell with no other description
      if (ev.notOwnedByCaster === true) {
        if (ev.orCopy || ev.from || ev.via !== undefined || ev.nth !== undefined || ev.manaFromSelf !== undefined || ev.modal !== undefined || ev.spell !== undefined || tense !== 'present') throw new NoRenderer('a spell its caster does not own with another condition');
        return { subject: p.text, predicate: `${text} a spell ${p.person === 'you' ? "you don't" : "they don't"} own`, plural: false };
      }
      // Standard round 3, r3-trig (CR 700.2): "whenever you cast a modal spell": only a spell with no other description
      if (ev.modal === true) {
        if (ev.orCopy || ev.from || ev.via !== undefined || ev.nth !== undefined || ev.manaFromSelf !== undefined || ev.spell !== undefined || tense !== 'present') throw new NoRenderer('a modal spell with another condition');
        return { subject: p.text, predicate: `${text} a modal spell`, plural: false };
      }
      if (ev.nth !== undefined && ev.nthMatching === true) {
        // FAST5X E18 (CR 601.2i): "an opponent casts their first noncreature spell each turn": the spell's words without the article
        if (ev.orCopy || ev.from || ev.via !== undefined || tense !== 'present' || ev.spell === undefined) throw new NoRenderer('the Nth spell of a kind with another condition');
        const kind = K.np({ ...ev.spell, stackKind: ev.spell.stackKind ?? 'spell' }, st, { det: 'none' });
        return { subject: p.text, predicate: `${text} ${p.person === 'you' ? 'your' : 'their'} ${ordinal(ev.nth)} ${kind} each turn`, plural: false };
      }
      if (ev.nth !== undefined) {
        // FAST1 T4 (CR 601.2i): "you cast your second spell each turn", "an opponent casts their second spell each turn", like `draw.nth`
        if (ev.orCopy || ev.from || ev.via !== undefined || tense !== 'present' || (ev.spell && Object.values(ev.spell).some((v) => v !== undefined))) throw new NoRenderer('the Nth spell with another condition');
        return { subject: p.text, predicate: `${text} ${p.person === 'you' ? 'your' : 'their'} ${ordinal(ev.nth)} spell each turn`, plural: false };
      }
      // FAST5X E2 (CR 118.9, 702.185c): "casts a spell for its warp cost"
      const via = ev.via !== undefined ? ` for its ${ev.via} cost` : '';
      // std-lci (CR 106.3): "a permanent spell using mana produced by ~"
      const using = ev.manaFromSelf === true ? ` using mana produced by ${K.obj({ ref: 'self' }, st, 'object').text}` : '';
      return { subject: p.text, predicate: `${text} ${spell}${from}${via}${using}`, plural: false };
    }
    case 'activate': {
      const p = playerSubject(ev.player ?? 'any', st);
      st.mentioned.add('e:player');
      const src = ev.source ? K.np(ev.source, st, { det: 'a' }) : '';
      const of = src ? ` of ${src}` : '';
      const mana = ev.manaAbility === false ? " that isn't a mana ability" : ev.manaAbility === true ? " that's a mana ability" : '';
      // FAST5X E20: "activate an exhaust ability" (CR 702.177a), "activate a loyalty ability" (CR 606.3)
      // r5-mech (CR 702.177a, 605.1a): "an exhaust ability that isn't a mana ability" (Pit Automaton) is the one other condition said
      const notMana = ev.ability === 'exhaust' && ev.manaAbility === false && ev.source === undefined;
      if (ev.ability !== undefined && !notMana && (ev.manaAbility !== undefined || ev.source !== undefined)) throw new NoRenderer('an exhaust or loyalty ability with another condition');
      // std-rx28 (CR 602.2, 115.9b): "an ability that targets a creature or player" (the ability itself described, parser/holes/event.ts)
      if (ev.activated !== undefined && (ev.ability !== undefined || ev.manaAbility !== undefined || ev.source !== undefined)) throw new NoRenderer('a described activated ability with another condition');
      const kind = ev.activated !== undefined ? K.np({ ...ev.activated, stackKind: 'ability' }, st, { det: 'a' }) : ev.ability === 'exhaust' ? 'an exhaust ability' : ev.ability === 'loyalty' ? 'a loyalty ability' : 'an ability';
      const plain = `${personVerb('activate', 'activated', tense, p.person)} ${kind}${of}${mana}`;
      // std-mana-1 (CR 106.12): a mana ability with {T} in its cost (`tapped`, parser/holes/event.ts): "you tap an artifact token for mana" says that and nothing else
      // std-mana-1 (CR 106.12): "you tap a land for {C}" (`produced`, a land's mana ability: every one has {T})
      if (ev.produced !== undefined) {
        if (ev.manaAbility !== true || !ev.source || ev.tapped !== undefined || ev.ability !== undefined || ev.activated !== undefined || tense !== 'present' || !landSource(ev.source)) throw new NoRenderer('a tap for a type of mana with another condition');
        return { subject: p.text, predicate: `${personVerb('tap', 'tapped', tense, p.person)} ${src} for {${ev.produced}}`, plural: false };
      }
      if (ev.tapped === true) {
        if (ev.manaAbility !== true || !ev.source || ev.ability !== undefined || ev.activated !== undefined || tense !== 'present') throw new NoRenderer('a tapped-for-mana activation with another condition');
        return { subject: p.text, predicate: `${personVerb('tap', 'tapped', tense, p.person)} ${src} for mana`, plural: false };
      }
      // FAST1 T4, CR 106.12: a land is "tapped for mana" when a mana ability of it is activated (every one has {T} in its cost; parser/holes/event.ts reads
      // the words for lands only, so only a land source is printed this way)
      if (ev.manaAbility === true && ev.source && tense === 'present' && landSource(ev.source)) {
        const forms = [`${p.text} ${plain}`, `${p.text} ${personVerb('tap', 'tapped', tense, p.person)} ${src} for mana`];
        if (ev.player === undefined) forms.push(`${src} ${passive('tapped', tense, false)} for mana`);
        return { subject: '', predicate: alt(...forms), plural: false };
      }
      return { subject: p.text, predicate: plain, plural: false };
    }
    case 'attacks': {
      // FAST5X E3 (CR 702.171b, 508.1): "~ attacks while saddled": the source attacks with the saddled designation (the attacker filter is read as it attacks)
      if (ev.attacker && ev.attacker.self === true && ev.attacker.saddled === true && onlyKeys(ev.attacker, 'self', 'saddled') && !ev.count && !o.batch) {
        const plain = eventParts({ ...ev, attacker: { self: true } }, st, tense, o);
        return { ...plain, predicate: `${plain.predicate} while saddled` };
      }
      const subj = ev.attacker ? subjectOf(ev.attacker, st, o) : o.batch ? { text: 'one or more creatures', plural: true } : { text: 'a creature', plural: false };
      st.mentioned.add('e:attacker');
      const def = ev.defender;
      // M12-3 (CR 506.3, 508.1b): "attacks you or a planeswalker you control"
      if (ev.orPlaneswalker === true && (def !== 'you' || ev.count !== undefined || o.batch === true)) throw new NoRenderer('orPlaneswalker other than "you or a planeswalker you control" of one attacker');
      const orPw = ev.orPlaneswalker === true ? ' or a planeswalker you control' : '';
      // r5-refs (CR 508.1b; family attacks-one-of-your-opponents): Oracle also calls the opponent attacked "one of your opponents"
      const defender = def === undefined ? '' : def === 'planeswalker' ? ' a planeswalker' : def === 'battle' ? ' a battle' : def === 'opponent' && !orPw ? alt(' an opponent', ' one of your opponents')
        : ` ${K.player(def, st, 'object').text}${orPw}`;
      // CLOUD std-tmt (CR 506.2, 603.2c; family opponents-are-attacked): "one or more of your opponents are attacked", one occurrence for the declaration
      // (TriggerDef.wholeBatch); "one or more creatures attack an opponent" is one for each opponent attacked (std-tla), so the two are no longer one reading
      if (o.wholeBatch === true) {
        if (!(o.batch && tense === 'present' && def === 'opponent' && ev.orPlaneswalker !== true && !ev.count && ev.alone === undefined && ev.attacker !== undefined && onlyKeys(ev.attacker, 'types') && ev.attacker.types?.length === 1 && ev.attacker.types[0] === 'Creature')) {
          throw new NoRenderer('the players of an attack counted together other than "one or more of your opponents are attacked"');
        }
        return { subject: '', predicate: 'one or more of your opponents are attacked', plural: true };
      }
      // Standard round 3, r3-trig (CR 508.1): "you attack with creatures with total power 12 or greater" (parser/holes/event.ts#youAttack): only that form
      if (ev.power !== undefined) {
        const bare = ev.attacker !== undefined && ev.attacker.controller === 'you' && onlyKeys(ev.attacker, 'controller');
        const one = ev.count !== undefined && ev.count.op === '>=' && ev.count.value === 1;
        if (!bare || !one || ev.power.op !== '>=' || typeof ev.power.value !== 'number' || defender !== '' || ev.alone !== undefined || tense !== 'present' || o.batch !== true) {
          throw new NoRenderer('a total power of attackers other than "you attack with creatures with total power N or greater"');
        }
        const n = K.qty(ev.power.value, st);
        return { subject: '', predicate: alt(`you attack with creatures with total power ${n} or greater`, `you attack with creatures with total power ${n} or more`), plural: true };
      }
      if (ev.count) {
        const kind = ev.attacker ? K.np(ev.attacker, st, { det: 'none', plural: true }) : 'creatures';
        const n = K.qty(ev.count.value, st);
        const cw = ev.count.op === '>=' ? `${n} or more` : ev.count.op === '==' ? n : `${n}`;
        const a = ev.attacker;
        // FAST1 T4, CR 508.3a: "~ and at least two other creatures attack" (battalion, an ability word, CR 207.2c): ~ is one of N or more attackers declared together
        if (a && isSelfOnly(a) && ev.count.op === '>=' && typeof ev.count.value === 'number' && ev.count.value >= 2 && tense === 'present' && !defender) {
          const others = ev.count.value - 1;
          return { subject: '', predicate: `~ and at least ${K.qty(others, st)} other ${others === 1 ? 'creature' : 'creatures'} attack`, plural: true };
        }
        const plain = { subject: `${cw} ${kind}`, predicate: `${verb(['attacks', 'attack', 'attacked'], tense, true)}${defender}`, plural: true };
        // FAST1 T4, CR 508.3c-d: "whenever you attack" (one or more creatures you control are declared as attackers) and "whenever you attack with N or more
        // creatures": the attackers of a declaration are all the active player's (CR 508.1a), so the count is of the creatures that player attacks with
        // std-tla (CR 508.1b): ... and "whenever you attack a player [with one or more ...]", the creatures attacking a player (parser/holes/event.ts#youAttack)
        const toPlayer = def !== undefined && def !== 'planeswalker' && def !== 'battle' && ev.orPlaneswalker !== true && typeof ev.count.value === 'number' && ev.count.value === 1;
        if (a && a.controller === 'you' && tense === 'present' && (!defender || toPlayer) && ev.count.op === '>=') {
          const rest: ObjectFilter = { ...a, controller: undefined };
          const bare = Object.values(rest).every((v) => v === undefined);
          const one = typeof ev.count.value === 'number' && ev.count.value === 1;
          const forms = [`${cw} ${kind} attack${defender}`];
          if (bare && one) forms.push(`you attack${defender}`);
          // CMD2 (CR 508.1, 903.3d-e): "whenever you attack with your commander" (parser/holes/event.ts#youAttack): a commander you own among your attackers
          const yourCommander = rest.commander === true && rest.owner === 'you' && Object.entries(rest).every(([k, v]) => v === undefined || k === 'commander' || k === 'owner');
          if (yourCommander && one && !defender) forms.push('you attack with your commander');
          if (!bare || !one) forms.push(`you attack${defender} with ${cw} ${bare ? 'creatures' : K.np(rest, st, { det: 'none', plural: true })}`);
          return { subject: '', predicate: alt(...forms), plural: true };
        }
        // std-mkm (CR 508.1a, 603.2c): "whenever a player attacks with three or more creatures", "whenever an opponent attacks with ..." (the active player's
        // declaration; parser/holes/event.ts#playerAttacksWith)
        if (a && (a.controller === undefined || a.controller === 'opponent') && tense === 'present' && !defender && ev.count.op === '>=') {
          const rest: ObjectFilter = { ...a, controller: undefined };
          if (Object.values(rest).some((v) => v !== undefined)) {
            const who = a.controller === 'opponent' ? 'an opponent' : 'a player';
            // std-combat-1 (CR 508.1a, 603.2c; family attacks-with-creatures): one or more creatures of a declaration, "whenever an opponent attacks with creatures"
            const bare = ev.count.value === 1 && Object.keys(rest).every((k) => (rest as Record<string, unknown>)[k] === undefined || k === 'types') && JSON.stringify(rest.types) === '["Creature"]';
            return { subject: '', predicate: alt(`${cw} ${kind} attack`, `${who} attacks with ${cw} ${K.np(rest, st, { det: 'none', plural: true })}`, ...(bare ? [`${who} attacks with creatures`] : [])), plural: true };
          }
        }
        return plain;
      }
      const alone = ev.alone ? ' alone' : '';
      // std-tla (CR 201.5; family plural-name-attacks): a plural name takes a plural verb here too, "Whenever Aang and La attack" (the object itself either way, as "enter")
      const attacks = tense === 'present' && subj.text === '~' && !subj.plural && (st.trigger ?? []).length <= 1 ? alt('attacks', 'attack') : verb(['attacks', 'attack', 'attacked'], tense, subj.plural);
      // Standard round 4, r4-trig (CR 506.5): "attacks a player alone": the defender before "alone" (parser/holes/event.ts)
      return { subject: subj.text, predicate: alone !== '' && defender !== '' ? `${attacks}${defender}${alone}` : `${attacks}${alone}${defender}`, plural: subj.plural };
    }
    case 'blocks': {
      const subj = ev.blocker ? subjectOf(ev.blocker, st, o) : o.batch ? { text: 'one or more creatures', plural: true } : { text: 'a creature', plural: false };
      st.mentioned.add('e:blocker');
      const blocked = ev.attacker ? ` ${K.np(ev.attacker, st, { det: 'a' })}` : '';
      return { subject: subj.text, predicate: `${verb(['blocks', 'block', 'blocked'], tense, subj.plural)}${blocked}`, plural: subj.plural };
    }
    // std-rx35 (CR 509.1h): "Whenever ~ attacks and isn't blocked" (present tense only: the trigger's own words)
    case 'attacksUnblocked': {
      if (tense !== 'present' || o.batch) throw new NoRenderer('"attacks and isn\'t blocked" in another tense or as a batch');
      const subj = ev.attacker ? subjectOf(ev.attacker, st, o) : { text: 'a creature', plural: false };
      if (subj.plural) throw new NoRenderer('"attack and aren\'t blocked" of several creatures');
      return { subject: subj.text, predicate: "attacks and isn't blocked", plural: false };
    }
    case 'becomesBlocked': {
      const subj = ev.attacker ? subjectOf(ev.attacker, st, o) : o.batch ? { text: 'one or more creatures', plural: true } : { text: 'a creature', plural: false };
      const by = ev.by ? ` by ${K.np(ev.by, st, { det: 'a' })}` : '';
      const be = tense === 'past' ? 'became' : tense === 'would' ? 'would become' : subj.plural ? 'become' : 'becomes';
      return { subject: subj.text, predicate: `${be} blocked${by}`, plural: subj.plural };
    }
    case 'damage': {
      // FAST4 T27 (CR 120.2a-b): `combat: false` is noncombat damage ("whenever an opponent is dealt noncombat damage")
      // FAST5X E16 (CR 120.10): "is dealt excess [noncombat] damage" (a recipient worded alone; any other form has no wording)
      const combat = `${ev.excess === true ? 'excess ' : ''}${ev.combat === true ? 'combat ' : ev.combat === false ? 'noncombat ' : ''}`;
      if (ev.excess === true && (ev.source !== undefined || ev.amount !== undefined || ev.recipient?.object === undefined || ev.recipient.player !== undefined)) throw new NoRenderer('excess damage with a source, an amount or a player');
      const amount = ev.amount ? `${ev.amount.op === '>=' ? `${K.qty(ev.amount.value, st)} or more` : K.qty(ev.amount.value, st)} ` : '';
      const r = ev.recipient;
      // M12-3: an opponent dealt damage is also "one of your opponents" (Edric, Spymaster of Trest)
      const playerText = (p: PlayerPred): string => (p === 'opponent' ? alt(K.player(p, st, 'object').text, 'one of your opponents') : K.player(p, st, 'object').text);
      const rtext = r ? (r.object !== undefined && r.player !== undefined ? '' : r.object !== undefined ? K.np(r.object, st, { det: 'a' }) : r.player !== undefined ? playerText(r.player) : '') : '';
      if (!ev.source && r && rtext !== '') {
        if (o.batch) {
          // FAST5 T62 (CR 603.2c): "one or more opponents are dealt noncombat damage" (parser/holes/event.ts#opponentsDealtNoncombat)
          // std-rr (CR 603.2c; Fblthp, Impossibly Lost): the whole batch, one trigger however many opponents are dealt damage (parser/holes/event.ts#opponentsDealtDamage):
          // "one or more opponents" or "one or more of your opponents" (family opponents-are-dealt-damage)
          if (o.wholeBatch === true) {
            if (r.object !== undefined || r.player !== 'opponent' || ev.amount !== undefined || ev.excess === true) throw new NoRenderer('the players dealt damage counted together other than "one or more opponents"');
            return { subject: alt('one or more opponents', 'one or more of your opponents'), predicate: passive(`dealt ${combat}damage`, tense, true), plural: true };
          }
          if (r.object === undefined && r.player === 'opponent' && ev.combat === false && ev.excess !== true) return { subject: 'one or more opponents', predicate: passive(`dealt ${combat}damage`, tense, true), plural: true };
          if (r.object === undefined) throw new NoRenderer('"one or more" players dealt damage');
          return { subject: K.np(r.object, st, { det: 'none', plural: true, count: 'one or more' }), predicate: passive(`dealt ${combat}damage`, tense, true), plural: true };
        }
        // cloud std-spm (CR 614.1a, 615.1): a replacement of the damage one recipient would be dealt is also worded "damage would be dealt to ~" (Anti-Venom)
        // p2-replace-damage-1 (CR 120.1, 609.7, 615.7): and by any source, "If a source would deal damage to equipped creature, prevent 2 of that damage." (family
        // a-source-would-deal: every damage has a source, so "a source" with no description is any of them)
        if (tense === 'would') return { subject: '', predicate: alt(`${rtext} ${passive(`dealt ${amount}${combat}damage`, tense, false)}`, `${amount}${combat}damage would be dealt to ${rtext}`, `a source would deal ${amount}${combat}damage to ${rtext}`), plural: false };
        // Standard round 4, r4-trig (CR 120.2): "you're dealt combat damage" ("you" takes "are", parser/holes/event.ts)
        return { subject: rtext, predicate: `${passive(`dealt ${amount}${combat}damage`, tense, rtext === 'you')}`, plural: false }; // std-mkm: "is dealt 3 or more damage" (CR 120.2)
      }
      // p2-replace-damage-2 (CR 120.3, 614.1a): a replacement of the damage of every source may also say "any source" (Equal Treatment; family any-source)
      const subj0 = ev.source ? subjectOf(ev.source, st, o) : { text: tense === 'would' ? alt('a source', 'any source') : 'a source', plural: false };
      // M6-10 (CR 120.3, 609.7): a source of damage named by its color alone is "a red source" ("If a red source would deal damage to a player", Tok-Tok)
      // FAST5 T40 (CR 120.3, 609.7): also by who controls it alone ("a source you control", Rollercrusher Ride), or by that and a chosen quality
      const keys = ev.source !== undefined ? Object.keys(ev.source).filter((k) => (ev.source as Record<string, unknown>)[k] !== undefined) : [];
      // std-blb (CR 105.2, 120.3): or by its color and who controls it ("a red source you control", Torbran)
      const colorOnly = ev.source !== undefined && !o.batch
        && ((keys.length === 1 && (ev.source.colors?.length ?? 0) > 0) || (keys.includes('controller') && keys.every((k) => k === 'controller' || k === 'chosen'))
          || (keys.length === 2 && keys.includes('controller') && keys.includes('colors') && (ev.source.colors?.length ?? 0) > 0));
      // p2-replace-damage-2 (CR 120.3, 609.7): any description of the source, said with "source" as its noun ("another red source you control", "an instant or
      // sorcery source you control"; family described-source): the objects of that description, wherever they are, as the parser's Filter head "source" reads it
      const described = !colorOnly && ev.source !== undefined && !o.batch && tense === 'would' && isDescribedSource(ev.source);
      const subj = colorOnly || described ? { text: alt(subj0.text, K.np(ev.source!, st, { det: 'a', head: 'source' })), plural: false } : subj0;
      st.mentioned.add('e:source');
      // FAST1 T4: a named source dealing damage to a recipient with both parts deals it to either of them (triggers/match.ts, CR 120.1): "to a player or planeswalker"
      // FAST5 T69 (CR 120.1, 614.1a): a replacement of damage "that would be dealt to that player or a permanent that player controls" names both parts, the object with its article
      // std-blb (CR 120.1, 614.1a): and a named source's damage that would be dealt "to an opponent or a permanent an opponent controls" (Torbran, Artist's Talent;
      // CLOUD std-msh and CLOUD std-dft made the same change: Hawkeye, Young Avenger; Far Fortune, End Boss)
      const both = tense === 'present' && ev.source && r && r.object !== undefined && r.player !== undefined ? `${K.player(r.player, st, 'object').text} or ${K.np(r.object, st, { det: 'none' })}`
        : tense === 'would' && r && r.object !== undefined && r.player !== undefined ? `${K.player(r.player, st, 'object').text} or ${K.np(r.object, st, { det: 'a' })}` : '';
      const to = both || rtext;
      // M6-10 (CR 120.1, 614.1a): damage that would be dealt to anything is damage "to a permanent or player" (Furnace of Rath)
      let toText = to ? ` to ${to}` : tense === 'would' && !r ? alt('', ' to a permanent or player') : '';
      // std-rx28 (CR 115.9b, 120.1; parser/holes/event.ts): "a spell that targets only a single creature deals damage to that creature": the one object the source
      // targets, of the description its "targets only" names
      if (ev.toSourceTarget === true) {
        const only = ev.source?.targetsOnly as { ref?: string; filter?: ObjectFilter } | undefined;
        if (o.batch || tense !== 'present' || only?.ref !== 'each' || r?.object === undefined || r.player !== undefined || JSON.stringify(only.filter) !== JSON.stringify(r.object)) throw new NoRenderer('damage to the target of its source other than "that creature"');
        toText = ` to that ${K.nounsOf(r.object)[0] ?? 'creature'}`;
      }
      // CLOUD std-tmt (CR 201.5; family plural-name-deals-damage): a plural name takes a plural verb here too, "Whenever Dark Leo & Shredder deal combat damage
      // to a player" (the object itself either way, as "enter"); only damage to a player alone (the wording sanctioned cards print; G10 kept the unsanctioned
      // "deal combat damage to a player or battle" of The Belligerent and Useless Island as it was)
      const toPlayerOnly = r !== undefined && r.player !== undefined && r.object === undefined;
      const deals = tense === 'present' && subj.text === '~' && !subj.plural && toPlayerOnly && (st.trigger ?? []).length <= 1 ? alt('deals', 'deal') : verb(['deals', 'deal', 'dealt'], tense, subj.plural);
      // std-rx11 (CR 603.2c; family each-with-singular): "one or more creatures you control each with power greater than its base power deals combat damage to a
      // player" (Kutzil, Malamet Exemplar): the feature said of each creature in the singular, and the verb agreeing with "each"; the same batch and filter
      if (o.batch && tense === 'present' && subj.plural && ev.source !== undefined && !isSelfOnly(ev.source)) {
        let each: string | null = null;
        try {
          each = K.np(ev.source, cloneState(st), { count: 'one or more', plural: true, det: 'none', eachWithSingular: true });
        } catch (e) {
          if (!(e instanceof NoRenderer)) throw e;
        }
        if (each !== null) return { subject: '', predicate: alt(`${subj.text} ${deals} ${amount}${combat}damage${toText}`, `${each} deals ${amount}${combat}damage${toText}`), plural: true };
      }
      // std-rx28 (CR 120.1, 208.1): "... to a creature equal to that creature's toughness" (parser/holes/event.ts#sourceDamage): one creature recipient named alone
      if (ev.amountIsToughness === true) {
        if (o.batch || ev.amount !== undefined || r?.object === undefined || r.player !== undefined || tense !== 'present') throw new NoRenderer('an amount equal to the toughness other than of one creature dealt damage');
        return { subject: subj.text, predicate: `${deals} ${combat}damage${toText} equal to that creature's toughness`, plural: subj.plural };
      }
      return { subject: subj.text, predicate: `${deals} ${amount}${combat}damage${toText}`, plural: subj.plural };
    }
    case 'step': {
      const phrase = possessiveStep(ev.step, ev.whose, st, false, ev.nth); // FAST5X E17: "your second main phase" (CR 505.1b)
      if (ev.step === 'endCombat') {
        // Standard round 5, r5-trig (CR 511.1): "at end of combat on your turn"; another player's end of combat has no wording here (it was printed as any player's)
        const on = ev.whose === undefined || ev.whose === 'any' ? '' : ev.whose === 'you' ? ' on your turn' : null;
        if (on === null) throw new NoRenderer('end of combat of another player\'s turn');
        return { subject: '', predicate: `${alt('end of combat', 'the end of combat')}${on}`, plural: false };
      }
      // std-rk (CR 505.1a, 603.2; family each-of-your-steps): "at the beginning of each of your postcombat main phases" is every such step of your turns
      const plural = (ev.whose === 'you' || (typeof ev.whose === 'object' && ev.whose.ref === 'you')) && ev.nth === undefined ? EACH_OF_YOUR_STEPS[ev.step] : undefined;
      return { subject: '', predicate: plural !== undefined ? alt(`the beginning of ${phrase}`, `the beginning of each of your ${plural}`) : `the beginning of ${phrase}`, plural: false };
    }
    case 'life': {
      const p = playerSubject(ev.player ?? 'any', st);
      st.mentioned.add('e:player');
      const base = ev.change === 'gain' ? 'gain' : 'lose';
      const amount = ev.amount ? `${ev.amount.op === '>=' ? `${K.qty(ev.amount.value, st)} or more` : K.qty(ev.amount.value, st)} ` : '';
      return { subject: p.text, predicate: `${personVerb(base, ev.change === 'gain' ? 'gained' : 'lost', tense, p.person)} ${amount}life`, plural: false };
    }
    case 'draw': {
      const p = playerSubject(ev.player ?? 'any', st);
      st.mentioned.add('e:player');
      const verbText = personVerb('draw', 'drew', tense, p.person);
      if (ev.nth !== undefined) return { subject: p.text, predicate: `${verbText} ${p.person === 'you' ? 'your' : 'their'} ${ordinal(ev.nth)} card each turn`, plural: false };
      // r5-repl (CR 504.1): "if you would draw a card except the first one you draw in each of your draw steps"
      if (ev.exceptFirstInDrawStep === true) {
        // "If an opponent would draw a card except the first one they draw in each of their draw steps" (Notion Thief)
        if (p.person !== 'you' && ev.player !== 'opponent') throw new NoRenderer("another player's draw except the first in their draw step");
        const own = p.person === 'you' ? 'you draw in each of your' : 'they draw in each of their';
        return { subject: p.text, predicate: `${verbText} a card except the first one ${own} draw steps`, plural: false };
      }
      return { subject: p.text, predicate: `${verbText} a card`, plural: false };
    }
    case 'becomes': {
      // `by` is worded only where the event has a cause in its words: "becomes the target of", "becomes attached to"
      // Standard round 5, r5-trig (CR 502.3): "you untap one or more permanents during your untap step"
      if (ev.untapStep === true) {
        if (ev.what !== 'untapped' || !o.batch || tense !== 'present' || ev.by !== undefined || JSON.stringify(ev.object) !== '{"controller":"you"}') throw new NoRenderer('an untap-step untap in another form');
        st.mentioned.add('e:player');
        return { subject: 'you', predicate: 'untap one or more permanents during your untap step', plural: false };
      }
      // Standard round 5, r5-trig (CR 702.122b, 702.171c): "~ crews a Vehicle", "~ saddles a Mount": the creature tapped for the cost is the subject of the sentence
      if ((ev.what === 'crewCostPaid' || ev.what === 'saddleCostPaid') && ev.by !== undefined && tense === 'present' && !o.batch) {
        const crew = ev.what === 'crewCostPaid';
        const what = ev.object.subtypes?.length === 1 && ev.object.subtypes[0] === (crew ? 'Vehicle' : 'Mount') && Object.keys(ev.object).length === 1;
        if (!what) throw new NoRenderer(`becomes ${ev.what} of another permanent`);
        const by = subjectOf(ev.by, st, o);
        return { subject: by.text, predicate: crew ? 'crews a vehicle' : 'saddles a mount', plural: false };
      }
      // std-rq (CR 702.194a): "~ becomes tapped to pay a teamwork cost": the creature tapped for the cost of a spell is the subject of the sentence
      if (ev.what === 'teamworkCostPaid' && ev.by !== undefined && tense === 'present' && !o.batch) {
        if (Object.keys(ev.object).length !== 0) throw new NoRenderer('becomes teamworkCostPaid of a described spell');
        const by = subjectOf(ev.by, st, o);
        return { subject: by.text, predicate: 'becomes tapped to pay a teamwork cost', plural: false };
      }
      if (ev.by !== undefined && ev.what !== 'targeted' && ev.what !== 'attached') throw new NoRenderer(`becomes ${ev.what} by something`);
      // FAST5X E8 (CR 709.5h-i): "you unlock this door" (the half the ability is on; the parser reads "this door" as the object itself) and "you fully unlock a Room"
      if (ev.what === 'unlocked' || ev.what === 'fullyUnlocked') {
        if (o.batch || ev.level !== undefined) throw new NoRenderer(`becomes ${ev.what} with more`);
        const unlock = tense === 'past' ? 'unlocked' : tense === 'would' ? 'would unlock' : 'unlock';
        if (ev.what === 'unlocked') {
          if (ev.door !== 'this' || !isSelfOnly(ev.object)) throw new NoRenderer('unlocking a door that is not "this door"');
          return { subject: 'you', predicate: `${unlock} ~`, plural: false };
        }
        if (ev.door !== undefined) throw new NoRenderer('fully unlocking a door');
        return { subject: 'you', predicate: `${tense === 'would' ? 'would fully unlock' : `fully ${unlock}`} ${K.np(ev.object, st, { det: 'a' })}`, plural: false };
      }
      if (ev.door !== undefined) throw new NoRenderer(`becomes ${ev.what} with a door`);
      // cloud std-dsk (CR 702.37e, 708.2): "whenever you turn a permanent face up": the player who turned it face up (triggers/match.ts)
      if (ev.player !== undefined) {
        if (ev.what !== 'turnedFaceUp' || ev.player !== 'you' || o.batch || ev.by !== undefined || ev.level !== undefined) throw new NoRenderer('a "becomes" by a player other than "you turn ... face up"');
        const turn = tense === 'past' ? 'turned' : tense === 'would' ? 'would turn' : 'turn';
        return { subject: 'you', predicate: `${turn} ${K.np(ev.object, st, { det: 'a' })} face up`, plural: false };
      }
      const subj = subjectOf(ev.object, st, o);
      const pl = subj.plural;
      const becomes = tense === 'past' ? 'became' : tense === 'would' ? 'would become' : pl ? 'become' : 'becomes';
      switch (ev.what) {
        case 'tapped': return { subject: subj.text, predicate: `${becomes} tapped`, plural: pl };
        case 'untapped': return { subject: subj.text, predicate: `${becomes} untapped`, plural: pl };
        case 'targeted': {
          // FAST1 T4: a source filter that says only who controls it is any spell or ability on the stack ("a spell or ability an opponent controls", CR 115.1)
          const anyStack = ev.by !== undefined && Object.entries(ev.by).every(([k, v]) => v === undefined || k === 'controller');
          const by = ev.by ? K.np(ev.by, st, { det: 'a', ...(anyStack ? { head: 'spell or ability' } : {}) }) : 'a spell or ability';
          return { subject: subj.text, predicate: `${becomes} the target of ${by}`, plural: pl };
        }
        case 'attached': return { subject: subj.text, predicate: `${becomes} attached to ${ev.by ? attachedToWithStat(ev, st) ?? K.np(ev.by, st, { det: 'a' }) : 'a permanent'}`, plural: pl }; // std-combat-1: attachedToWithStat
        case 'unattached': return { subject: subj.text, predicate: `${becomes} unattached`, plural: pl };
        case 'transformed': {
          // M6-4 (family transforms-into-self): a trigger of the permanent itself sees it after the transform, with the face it transformed into up, the only face
          // the ability is on, so "~ transforms" there is "~ transforms into ~" (CR 701.27e, 603.2)
          const into = isSelfOnly(ev.object) && tense === 'present' ? [`transforms into ${subj.text}`] : [];
          return { subject: subj.text, predicate: alt(verb(['transforms', 'transform', 'transformed'], tense, pl), passive('transformed', tense, pl), ...into), plural: pl };
        }
        case 'turnedFaceUp': return { subject: subj.text, predicate: passive('turned face up', tense, pl), plural: pl };
        case 'monstrous': return { subject: subj.text, predicate: `${becomes} monstrous`, plural: pl };
        case 'renowned': return { subject: subj.text, predicate: `${becomes} renowned`, plural: pl };
        case 'saddled': return { subject: subj.text, predicate: alt(`${becomes} saddled`, passive('saddled', tense, pl)), plural: pl };
        case 'crewed': return { subject: subj.text, predicate: alt(`${becomes} crewed`, passive('crewed', tense, pl)), plural: pl };
        // M6-0 (m6 design 2.1): CR 708.2b, 701.28, 710, 702.140d, 701.42, 719.3b, 722.3a, 716.2a
        case 'turnedFaceDown': return { subject: subj.text, predicate: passive('turned face down', tense, pl), plural: pl };
        case 'converted': return { subject: subj.text, predicate: verb(['converts', 'convert', 'converted'], tense, pl), plural: pl };
        case 'flipped': return { subject: subj.text, predicate: verb(['flips', 'flip', 'flipped'], tense, pl), plural: pl };
        case 'mutated': return { subject: subj.text, predicate: verb(['mutates', 'mutate', 'mutated'], tense, pl), plural: pl };
        case 'melded': return { subject: subj.text, predicate: passive('melded', tense, pl), plural: pl };
        case 'solved': {
          // Standard round 4, r4-trig (CR 719.3b-c; Case File Auditor): "you solve a Case": a Case you control becomes solved (its controller solves it; parser/holes/event.ts)
          const o = ev.object;
          if (tense === 'present' && o.controller === 'you' && o.subtypes?.length === 1 && o.subtypes[0] === 'Case' && Object.keys(o).every((k) => k === 'controller' || k === 'subtypes')) return { subject: 'you', predicate: 'solve a Case', plural: false };
          return { subject: subj.text, predicate: `${becomes} solved`, plural: pl };
        }
        case 'prepared': return { subject: subj.text, predicate: `${becomes} prepared`, plural: pl };
        case 'plotted': return { subject: subj.text, predicate: `${becomes} plotted`, plural: pl }; // FAST5X E6: CR 702.170a
        case 'classLevel': {
          if (ev.level === undefined) throw new NoRenderer('becomes classLevel without a level');
          return { subject: subj.text, predicate: `${becomes} level ${ev.level}`, plural: pl };
        }
      }
      break;
    }
    case 'phase': {
      // M6-0, CR 614.10: a phase about to begin (a replacement pattern: "skip your next combat phase")
      const name = { beginning: 'beginning phase', precombatMain: 'precombat main phase', combat: 'combat phase', postcombatMain: 'postcombat main phase', ending: 'ending phase' }[ev.phase];
      const whose = ev.whose === undefined || ev.whose === 'any' ? 'a' : ev.whose === 'you' ? 'your' : ev.whose === 'opponent' ? "an opponent's" : `${K.player(ev.whose, st, 'possessive').text}`;
      return { subject: '', predicate: `${whose} ${name}`, plural: false };
    }
    case 'dayNight': {
      // M6-0, CR 731.1a: day becomes night / night becomes day
      const predicate = ev.to === 'night' ? 'day becomes night' : ev.to === 'day' ? 'night becomes day' : 'day becomes night or night becomes day';
      return { subject: '', predicate, plural: false };
    }
    case 'counters': {
      // FAST5X E21 (CR 122.1, 603.2): "the fourth plan counter is put on ~" is the event that makes the number of counters of the kind reach N (triggers/match.ts)
      if (tense === 'present' && !o.batch && ev.change === 'put' && ev.kind !== undefined && typeof ev.atLeast === 'number' && ev.atLeast >= 2 && ev.atLeast <= 12 && !('player' in ev.on)) { // std-control-3: to the twelfth, as the event hole reads
        return { subject: `the ${ordinal(ev.atLeast)} ${ev.kind} counter`, predicate: `is put on ${K.np(ev.on as ObjectFilter, st, { det: 'a' })}`, plural: false };
      }
      // FAST5X E21 (CR 122.6): "you put one or more +1/+1 counters on a creature you control", "you put a counter on a creature you control"
      if (ev.by !== undefined) {
        // r4-repl (CR 614.1a, 122.6): the replacement's event, "if you would put one or more counters on a permanent you control" (Doc Samson, Prairie Dog)
        if (ev.by === 'you' && tense === 'would' && ev.change === 'put' && ev.atLeast === undefined && ev.byEffect === undefined && !('player' in ev.on)) {
          st.mentioned.add('e:player');
          return { subject: 'you', predicate: `would put one or more ${ev.kind ? `${ev.kind} ` : ''}counters on ${K.np(ev.on as ObjectFilter, st, { det: 'a' })}`, plural: false };
        }
        if (ev.by !== 'you' || (tense !== 'present' && tense !== 'past') || ev.change !== 'put' || ev.atLeast !== undefined || ev.byEffect !== undefined || 'player' in ev.on) throw new NoRenderer('counters put by a player other than "you" or in another form');
        st.mentioned.add('e:player');
        const k = ev.kind ? `${ev.kind} counter` : 'counter';
        const on = o.wholeBatch === true ? `one or more ${K.np(ev.on as ObjectFilter, st, { det: 'none', plural: true })}` : K.np(ev.on as ObjectFilter, st, { det: 'a' }); // r5-trig: the whole batch
        return { subject: 'you', predicate: `put ${o.batch ? `one or more ${k}s` : withArticle(k)} on ${on}`, plural: false };
      }
      const many = ev.atLeast !== undefined && !(typeof ev.atLeast === 'number' && ev.atLeast === 1) ? `${K.qty(ev.atLeast, st)} or more` : undefined;
      const kind = ev.kind ? `${ev.kind} counter` : 'counter';
      if (o.batch && many) throw new NoRenderer('"one or more" counters with a minimum');
      const noun = o.batch ? `one or more ${kind}s` : many ? `${many} ${kind}s` : withArticle(kind);
      const pl = many !== undefined || o.batch === true;
      const put = ev.change === 'put' ? 'put' : 'removed';
      const target = 'player' in ev.on ? K.player((ev.on as { player: PlayerPred }).player, st, 'object').text : K.np(ev.on as ObjectFilter, st, { det: 'a' });
      const prep = ev.change === 'put' ? 'on' : 'from';
      if (tense === 'would') {
        // M6-1 (CR 614.16): "if an EFFECT would put counters" is `byEffect`; without it the counters are put by anything ("if one or more +1/+1 counters
        // would be put on a creature you control"), and only that reading is written
        if (ev.byEffect === true) return { subject: 'an effect', predicate: `would ${ev.change === 'put' ? 'put' : 'remove'} ${many ?? 'one or more'} ${ev.kind ? `${ev.kind} ` : ''}counters ${prep} ${target}`, plural: false };
        return { subject: `${many ?? 'one or more'} ${ev.kind ? `${ev.kind} ` : ''}counters`, predicate: `would be ${put} ${prep} ${target}`, plural: true };
      }
      return { subject: noun, predicate: `${passive(put, tense, pl)} ${prep} ${target}`, plural: pl };
    }
    case 'action': return actionParts(ev, st, tense, o);
    case 'createToken': {
      const p = playerSubject(ev.player ?? 'any', st);
      st.mentioned.add('e:player');
      if (tense === 'would') {
        const control = ev.player === 'you' ? 'your' : ev.player === 'opponent' ? "an opponent's" : undefined;
        // M6-1 (CR 614.16): "if an EFFECT would create" is `byEffect`; without it: "if one or more tokens would be created under your control"
        if (ev.byEffect === true) return { subject: 'an effect', predicate: `would create one or more tokens${control ? ` under ${control} control` : ''}`, plural: false };
        // Cloud r3-repl (CR 111.1): a token filter is said before the noun, "if one or more creature tokens would be created under your control" (Ojer Taq)
        const many = ev.token ? K.np({ ...ev.token, token: true }, st, { det: 'none', plural: true, count: 'one or more' }) : 'one or more tokens';
        return { subject: many, predicate: `would be created${control ? ` under ${control} control` : ''}`, plural: true };
      }
      const tok = o.batch
        ? (ev.token ? K.np({ ...ev.token, token: true }, st, { det: 'none', plural: true, count: 'one or more' }) : 'one or more tokens')
        : (ev.token ? K.np({ ...ev.token, token: true }, st, { det: 'a' }) : 'a token');
      return { subject: p.text, predicate: `${personVerb('create', 'created', tense, p.person)} ${tok}`, plural: false };
    }
    case 'dieRoll': {
      const p = playerSubject(ev.player ?? 'any', st);
      st.mentioned.add('e:player');
      // p2-c-dieroll-1 (CR 706.1, 603.2c): "whenever you roll one or more dice": the rolls of one batch, no result read
      if (o.batch === true) {
        if (ev.result !== undefined) throw new NoRenderer('"one or more dice" with a result');
        return { subject: p.text, predicate: `${personVerb('roll', 'rolled', tense, p.person)} one or more dice`, plural: false };
      }
      const res = ev.result ? ` and the result is ${ev.result.op === '>=' ? `${K.qty(ev.result.value, st)} or more` : ev.result.op === '<=' ? `${K.qty(ev.result.value, st)} or less` : K.qty(ev.result.value, st)}` : '';
      return { subject: p.text, predicate: `${personVerb('roll', 'rolled', tense, p.person)} a die${res}`, plural: false };
    }
    // cloud r3-mech (CR 705.2): "whenever you win a coin flip", "whenever a player loses a coin flip"
    case 'coinFlip': {
      if (ev.won === undefined) throw new NoRenderer('a coin flip trigger that is neither won nor lost');
      const p = playerSubject(ev.player ?? 'any', st);
      st.mentioned.add('e:player');
      return { subject: p.text, predicate: `${ev.won ? personVerb('win', 'won', tense, p.person) : personVerb('lose', 'lost', tense, p.person)} a coin flip`, plural: false };
    }
    // std-copy-6 (CR 603.2, 508.1m): "a creature you control attacking causes a triggered ability of that creature to trigger": only that cause, in the present tense
    case 'abilityTriggered': {
      if (ev.causedBy !== 'attacking' || ev.of === undefined || tense !== 'present' || o.batch === true) throw new NoRenderer('a triggered ability triggering with no cause, another cause, or not in the present tense');
      st.mentioned.add('e:subject');
      return { subject: `${K.np(ev.of, st, { det: 'a' })} attacking`, predicate: 'causes a triggered ability of that creature to trigger', plural: false };
    }
    // Standard round 3, r3-trig (CR 108.4, 613.1b): "whenever an opponent gains control of a permanent from you": only a named new controller and "from you"
    case 'controlChange': {
      // std-rx32 (CR 108.4, 603.7): "When you lose control of that Equipment this turn" (Stolen Uniform): from you, whoever gains it; one object named (`is`)
      if (ev.to === undefined && ev.from === 'you' && tense === 'present' && ev.object !== undefined && Object.keys(ev.object).length === 1 && ev.object.is !== undefined) {
        return { subject: 'you', predicate: `lose control of ${K.obj(ev.object.is, st, 'object').text}`, plural: false };
      }
      if (ev.to === undefined || ev.from !== 'you' || tense !== 'present') throw new NoRenderer('a change of control without a new controller, not from you, or not in the present tense');
      const p = playerSubject(ev.to, st);
      st.mentioned.add('e:player');
      const what = ev.object !== undefined ? K.np(ev.object, st, { det: 'a' }) : 'a permanent';
      return { subject: p.text, predicate: `${personVerb('gain', 'gained', tense, p.person)} control of ${what} from you`, plural: false };
    }
    // M12-3 (CR 603.9): "whenever a player loses the game", "whenever an opponent loses the game"
    case 'loseGame': {
      const p = playerSubject(ev.player ?? 'any', st);
      st.mentioned.add('e:player');
      return { subject: p.text, predicate: `${personVerb('lose', 'lost', tense, p.person)} the game`, plural: false };
    }
    case 'state': return { subject: '', predicate: K.cond(ev.cond, st), plural: false };
    case 'beginTurn': {
      const t = turnOf(ev.whose ?? 'any', st);
      return { subject: '', predicate: ev.extra ? `an extra turn begins` : `${t} begins`.replace(/^your turn begins$/, 'your turn begins'), plural: false };
    }
    case 'resolves': {
      const subj = subjectOf(isSelfOnly(ev.what) ? ev.what : { ...ev.what, stackKind: ev.what.stackKind ?? 'spell' }, st, o);
      return { subject: subj.text, predicate: verb(['resolves', 'resolve', 'resolved'], tense, subj.plural), plural: subj.plural };
    }
    default: throw new NoRenderer(`event ${(ev as { ev: string }).ev}`);
  }
  throw new NoRenderer(`event ${(ev as { ev: string }).ev}`);
}

const ACTION_VERB: Record<string, [string, string, string]> = {
  sacrifice: ['sacrifice', 'sacrificed', 'sacrifice'],
  discard: ['discard', 'discarded', 'discard'],
  cycle: ['cycle', 'cycled', 'cycle'],
  scry: ['scry', 'scried', 'scry'],
  surveil: ['surveil', 'surveilled', 'surveil'],
  search: ['search', 'searched', 'search'],
  shuffle: ['shuffle', 'shuffled', 'shuffle'],
  mill: ['mill', 'milled', 'mill'],
  create: ['create', 'created', 'create'],
  playLand: ['play', 'played', 'play'],
  reveal: ['reveal', 'revealed', 'reveal'],
  giveGift: ['give a gift', 'gave a gift', 'give a gift'], // FAST5X E1: "whenever you give a gift" (CR 702.174c)
  completeDungeon: ['complete', 'completed', 'complete'], // MX4, CR 309.7: "whenever you complete a dungeon"
  collectEvidence: ['collect evidence', 'collected evidence', 'collect evidence'], // FAST5X E12, CR 701.59a: "whenever you collect evidence"
  forage: ['forage', 'foraged', 'forage'], // FAST5X E28, CR 701.61a: "whenever you forage"
  commitCrime: ['commit a crime', 'committed a crime', 'commit a crime'], // FAST5X E20, CR 700.13: "whenever you commit a crime"
  exert: ['exert', 'exerted', 'exert'], // std-ry8, CR 701.43a: "whenever you exert a creature" (the player who exerts is the subject)
  faceDilemma: ['face a dilemma', 'faced a dilemma', 'face a dilemma'], // trek-2 (CR 700.2): "whenever you face a dilemma"
};

/** Actions where the thing that does it is the subject ("a creature you control explores"). */
const SUBJECT_ACTIONS = new Set(['explore', 'connive', 'adapt', 'monstrosity', 'goad', 'detain', 'exert', 'suspect', 'bolster', 'support', 'fabricate', 'amass', 'transform', 'regenerate']);

function actionParts(ev: Extract<EventPattern, { ev: 'action' }>, st: RenderState, tense: Tense, o: EventOpts): Parts {
  const verbWord = ev.verb;
  if (verbWord === 'ringTempts') return ringTemptsParts(ev, tense, o);
  if (verbWord === 'votesFinished') return votesFinishedParts(ev, tense, o);
  if (ev.n !== undefined || verbWord === 'expend') return expendParts(ev, st, tense, o);
  if (verbWord === 'tap' && ev.actor !== undefined) return tapActionParts(ev, st, tense, o);
  if (verbWord === 'exploit') return exploitParts(ev, st, tense, o);
  if (verbWord === 'clash') return clashParts(ev, st, tense, o); // p2-player-rules-3 (CR 701.30)
  if (ev.exploited !== undefined) throw new NoRenderer(`an exploited creature on the action ${verbWord}`);
  const camel = verbWord.replace(/([A-Z])/g, ' $1').toLowerCase();
  if (SUBJECT_ACTIONS.has(verbWord) && ev.object && !(verbWord === 'exert' && ev.actor !== undefined)) { // std-ry8: a player exerts (CR 701.43a)
    const s = subjectOf(ev.object, st, o);
    const base = camel;
    // std-lci (CR 701.44a): "explores a land card" / "explores a nonland card", the card the explore revealed; only an explore says it
    if (ev.revealed !== undefined && verbWord !== 'explore') throw new NoRenderer(`a revealed card on the action ${verbWord}`);
    const kind = ev.revealed === undefined ? '' : ` ${ev.revealed === 'land' ? 'a land card' : 'a nonland card'}`;
    return { subject: s.text, predicate: `${tense === 'past' ? `${base}d` : tense === 'would' ? `would ${base}` : s.plural ? base : `${base}s`.replace(/ys$/, 'ies')}${kind}`, plural: s.plural };
  }
  if (ev.revealed !== undefined) throw new NoRenderer('a revealed card on an action that is not an explore');
  const passiveVerbs: Record<string, string> = { exile: 'exiled', destroy: 'destroyed', counter: 'countered', regenerate: 'regenerated', tap: 'tapped', untap: 'untapped', attach: 'attached', transform: 'transformed' };
  if (passiveVerbs[verbWord] !== undefined && ev.object) {
    const s = subjectOf(ev.object, st, o);
    return { subject: s.text, predicate: passive(passiveVerbs[verbWord]!, tense, s.plural), plural: s.plural };
  }
  const p = playerSubject(ev.actor ?? 'any', st);
  st.mentioned.add('e:player');
  // Cloud r3-repl (CR 701.17a, 614.1a): a replaced mill is "if an opponent would mill one or more cards" (the mill proposal, effects/proposal-kinds/mill.ts)
  if (verbWord === 'mill' && tense === 'would' && ev.object === undefined) return { subject: p.text, predicate: 'would mill one or more cards', plural: false };
  // p2-replace-events-3 (CR 701.22a, 614.1a): a replaced scry is "if you would scry a number of cards" (the scry proposal, effects/proposal-kinds/scry.ts)
  if (verbWord === 'scry' && tense === 'would' && ev.object === undefined) return { subject: p.text, predicate: 'would scry a number of cards', plural: false };
  const forms = ACTION_VERB[verbWord];
  const base = forms ? forms[0] : camel;
  const past = forms ? forms[1] : `${camel}ed`;
  // cloud std-spm (CR 305.1): "you play a land" (the land played is the event's subject), "you play a land from exile" (`from`, the zone it was played from)
  // (another zone is "a graveyard", as for a cast's zone: the pattern has no owner)
  // Standard round 4, r4-trig (CR 305.1): "you play a land from anywhere other than your hand" (`notFrom`)
  const landFrom = verbWord === 'playLand' && ev.notFrom === 'hand' && ev.from === undefined ? ' from anywhere other than your hand'
    : verbWord === 'playLand' && ev.from !== undefined ? ` from ${ev.from === 'exile' ? 'exile' : ev.from === 'hand' ? 'your hand' : `a ${ZONE_NAME[ev.from]}`}` : '';
  if (verbWord !== 'playLand' && ev.notFrom !== undefined) throw new NoRenderer(`the zone of the action ${verbWord}`);
  if (verbWord !== 'playLand' && ev.from !== undefined) throw new NoRenderer(`the zone of the action ${verbWord}`);
  // std-lci (CR 701.9a): what a player discards is a card in their hand ("whenever an opponent discards a land card"), never a permanent; CMD4 (CR 702.29a): so is
  // what a player cycles ("whenever you cycle a creature card"); ~ itself keeps its own name
  const what = (verbWord === 'discard' || verbWord === 'cycle') && ev.object !== undefined && ev.object.zone === undefined && ev.object.self === undefined
    ? { ...ev.object, zone: 'hand' as const } : ev.object;
  const noZone = what !== ev.object ? { noZone: true } : {};
  // CLOUD std-misc: "whenever you sacrifice ~ or another artifact" (the sacrificed object of a sacrifice by the controller, CR 701.21a)
  const one = (f: ObjectFilter): string => (verbWord === 'sacrifice' && ev.actor === 'you' ? selfOrAnother(f, f, st, K.np(f, st, { det: 'a' })) : K.np(f, st, { det: 'a', ...noZone }));
  const object = what
    ? ` ${o.batch ? K.np(what, st, { det: 'none', plural: true, count: 'one or more', ...noZone }) : one(what)}${landFrom}`
    : verbWord === 'cycle' || verbWord === 'discard' ? (o.batch ? ' one or more cards' : ' a card') : verbWord === 'completeDungeon' ? ' a dungeon'
      : verbWord === 'playLand' && !o.batch ? ` a land${landFrom}`
        // Standard round 4, r4-trig (CR 701.23a): "an opponent searches their library", "you search your library" (`searched`)
        : verbWord === 'search' && ev.searched === 'ownLibrary' && !o.batch ? (ev.actor === 'you' ? ' your library' : ' their library') : '';
  if (verbWord !== 'search' && ev.searched !== undefined) throw new NoRenderer(`the zone searched by the action ${verbWord}`);
  if (o.batch && object === '') throw new NoRenderer(`"one or more" for the action ${verbWord} without an object`);
  // CLOUD std-misc (CR 603.2c): "one or more players discard one or more cards" (TriggerDef.wholeBatch), only discard
  if (o.wholeBatch === true) {
    if (verbWord !== 'discard' || ev.object !== undefined) throw new NoRenderer('"one or more players" for an action other than discarding cards');
    return { subject: 'one or more players', predicate: `${base}${object}`, plural: true };
  }
  // FAST1 T4, CR 702.29a: cycling a card discards it (the cost "Discard this card"), so "cycle or discard a card" is one discard: it triggers once
  if (verbWord === 'discard' && tense === 'present' && !o.batch) {
    const discards = personVerb(base, past, tense, p.person);
    return { subject: p.text, predicate: alt(`${discards}${object}`, `${personVerb('cycle', 'cycled', tense, p.person)} or ${discards}${object}`), plural: false };
  }
  return { subject: p.text, predicate: `${personVerb(base, past, tense, p.person)}${object}`, plural: false };
}

/**
 * std-rx17 (CR 702.110b): "~ exploits a creature", "a creature you control exploits a nontoken creature": the exploiting creature is the subject, the creature it
 * sacrificed the object (always a creature). Only in the present tense, one at a time, with no actor.
 */
function exploitParts(ev: Extract<EventPattern, { ev: 'action' }>, st: RenderState, tense: Tense, o: EventOpts): Parts {
  if (ev.object === undefined || ev.actor !== undefined || tense !== 'present' || o.batch) throw new NoRenderer('an exploit without its creature, with an actor, or not in the present tense');
  const s = subjectOf(ev.object, st, o);
  const what = ev.exploited === undefined ? 'a creature' : K.np(ev.exploited, st, { det: 'a' });
  return { subject: s.text, predicate: `${s.plural ? 'exploit' : 'exploits'} ${what}`, plural: s.plural };
}

/**
 * p2-player-rules-3 (CR 701.30b-c): "whenever you clash", "whenever you clash and win" (also printed "whenever you win a clash", family clash-and-win). No object,
 * one player at a time, present tense only.
 */
function clashParts(ev: Extract<EventPattern, { ev: 'action' }>, st: RenderState, tense: Tense, o: EventOpts): Parts {
  if (ev.object !== undefined || o.batch || tense !== 'present' || ev.won === false) throw new NoRenderer('a clash with an object, "one or more", another tense or a lost clash');
  const p = playerSubject(ev.actor ?? 'any', st);
  if (p.person !== 'you') throw new NoRenderer('a clash by another player than you');
  st.mentioned.add('e:player');
  const clash = personVerb('clash', 'clashed', tense, p.person);
  if (ev.won !== true) return { subject: p.text, predicate: clash, plural: false };
  return { subject: p.text, predicate: alt(`${clash} and ${personVerb('win', 'won', tense, p.person)}`, `${personVerb('win', 'won', tense, p.person)} a clash`), plural: false };
}

/** FAST5X E20 (CR 700.14): "you expend 4". Only with its N and no object. */
function expendParts(ev: Extract<EventPattern, { ev: 'action' }>, st: RenderState, tense: Tense, o: EventOpts): Parts {
  if (ev.verb !== 'expend' || ev.n === undefined || ev.object !== undefined || o.batch) throw new NoRenderer('expend without its N, or N on another action');
  const p = playerSubject(ev.actor ?? 'any', st);
  st.mentioned.add('e:player');
  return { subject: p.text, predicate: `${personVerb('expend', 'expended', tense, p.person)} ${ev.n}`, plural: false };
}

/**
 * FAST5X E20 (CR 701.26a): "you tap an untapped creature an opponent controls": a player's effect or cost tapped the permanent. Only an untapped permanent can
 * be tapped, so the word "untapped" is the verb's, not the filter's (the filter is judged after the event, when the permanent is tapped); "one or more" with
 * `batch` (CR 603.2c).
 */
function tapActionParts(ev: Extract<EventPattern, { ev: 'action' }>, st: RenderState, tense: Tense, o: EventOpts): Parts {
  if (ev.object === undefined || ev.object.tapped !== undefined || tense !== 'present') throw new NoRenderer('a tap action without an object, of a tapped filter, or not in the present tense');
  const p = playerSubject(ev.actor, st);
  st.mentioned.add('e:player');
  const np = o.batch ? K.np({ ...ev.object, tapped: false }, st, { det: 'none', plural: true, count: 'one or more' }) : K.np({ ...ev.object, tapped: false }, st, { det: 'a' });
  return { subject: p.text, predicate: `${personVerb('tap', 'tapped', tense, p.person)} ${np}`, plural: false };
}

/**
 * MX3 (CR 701.54a, 701.54d): "the Ring tempts you" (the player is its object); with a creature (`object`), "you choose a creature as your Ring-bearer" (the same
 * event: the creature chosen while the Ring tempts you). Only the player the ability is controlled by, in the present tense.
 */
function ringTemptsParts(ev: Extract<EventPattern, { ev: 'action' }>, tense: Tense, o: EventOpts): Parts {
  if (ev.actor !== 'you' || tense !== 'present' || o.batch) throw new NoRenderer('the Ring tempts a player other than you, or not in the present tense');
  if (ev.object === undefined) return { subject: 'the Ring', predicate: 'tempts you', plural: false };
  if (JSON.stringify(ev.object) !== JSON.stringify({ types: ['Creature'] })) throw new NoRenderer('a Ring-bearer chosen other than "a creature"');
  return { subject: 'you', predicate: 'choose a creature as your Ring-bearer', plural: false };
}

/** M12F (CR 701.38a): "players finish voting" (the `votesFinished` event), with no actor and no object, in the present tense only. */
function votesFinishedParts(ev: Extract<EventPattern, { ev: 'action' }>, tense: Tense, o: EventOpts): Parts {
  if (ev.actor !== undefined || ev.object !== undefined || tense !== 'present' || o.batch) throw new NoRenderer('a finished vote with an actor or an object, or not in the present tense');
  return { subject: 'players', predicate: 'finish voting', plural: true };
}

/**
 * std-copy-4 (CR 603.4, 601.2i): two or more casts by you, each the first spell this turn of one kind (`nth` 1, `nthMatching`, a `spell` filter and nothing else),
 * said as one cast with the intervening "if" Oracle prints: "you cast a spell, if it's the first instant spell, the first sorcery spell, or the first Otter spell
 * other than ~ you've cast this turn". Null for any other list.
 */
function firstOfKinds(list: EventPattern[], st: RenderState, tense: Tense, o: EventOpts): string | null {
  if (list.length < 2 || tense !== 'present' || o.batch === true) return null;
  const kinds: string[] = [];
  for (const e of list) {
    if (e.ev !== 'cast' || e.player !== 'you' || e.nth !== 1 || e.nthMatching !== true || e.spell === undefined) return null;
    if (Object.keys(e).some((k) => !['ev', 'player', 'nth', 'nthMatching', 'spell'].includes(k))) return null;
    const { other, ...rest } = e.spell;
    if (other === false) return null;
    // a description of one kind in `anyOf` (the template writes "other" beside it) is that kind
    const kind = Object.keys(rest).length === 1 && rest.anyOf?.length === 1 ? rest.anyOf[0]! : rest;
    if (Object.keys(kind).length === 0) return null;
    kinds.push(`the first ${K.np({ ...kind, stackKind: 'spell' }, st, { det: 'none' })}${other === true ? ' other than ~' : ''}`);
  }
  st.mentioned.add('e:player');
  st.mentioned.add('e:spell');
  return `you cast a spell, if it's ${joinList(kinds, 'or')} you've cast this turn`;
}

/** std-cardcopy-5: the two patterns of "one or more creatures you control and/or creature cards in your graveyard are put into exile" (events). */
const EXILED_FROM_TWO_ORIGINS: EventPattern[] = [
  { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, from: 'battlefield', to: 'exile' },
  { ev: 'zoneChange', subject: { types: ['Creature'], isCard: true, owner: 'you' }, from: 'graveyard', to: 'exile' },
];

const join = (p: Parts): string => (p.subject === '' ? p.predicate : `${p.subject} ${p.predicate}`);

export function event(ev: EventPattern, st: RenderState, tense: Tense, o: EventOpts = {}): string {
  return join(eventParts(ev, st, tense, o));
}

/** Several events of one trigger ("whenever ~ enters or attacks"): a shared subject is written once. */
export function events(list: EventPattern[], st: RenderState, tense: Tense, o: EventOpts = {}): string {
  if (list.length === 1) return event(list[0]!, st, tense, o);
  // Standard round 4, r4-trig (CR 121.2; parser/holes/event.ts): "you draw your first or second card each turn"
  if (list.length === 2 && tense === 'present' && o.batch !== true && JSON.stringify(list) === JSON.stringify([{ ev: 'draw', player: 'you', nth: 1 }, { ev: 'draw', player: 'you', nth: 2 }])) {
    st.mentioned.add('e:player');
    return 'you draw your first or second card each turn';
  }
  // Standard round 4, r4-trig (CR 115.1; parser/holes/event.ts): "a player or permanent becomes the target of ...", "you or a permanent you control becomes the target of ..."
  if (list.length === 2 && tense === 'present' && o.batch !== true) {
    const [a, b] = list;
    if (a!.ev === 'becomes' && b!.ev === 'becomes' && a!.what === 'targeted' && b!.what === 'targeted' && a!.player !== undefined && JSON.stringify(a!.by) === JSON.stringify(b!.by)) {
      const both = a!.player === 'any' && JSON.stringify(b!.object) === '{"zone":"battlefield"}' ? 'a player or permanent'
        : a!.player === 'you' && JSON.stringify(b!.object) === '{"controller":"you","zone":"battlefield"}' ? 'you or a permanent you control' : null;
      if (both !== null) {
        st.mentioned.add('e:subject');
        const pred = eventParts(b!, st, tense, o).predicate.replace(/^becomes /, '');
        return `${both} becomes ${pred}`;
      }
    }
  }
  // Standard round 4, r4-trig (CR 305.1, 601.2a; parser/holes/event.ts): "you play a land or cast a spell from anywhere other than your hand", the zone said once for both
  if (list.length === 2 && tense === 'present' && o.batch !== true && JSON.stringify(list) === JSON.stringify([{ ev: 'action', verb: 'playLand', actor: 'you', notFrom: 'hand' }, { ev: 'cast', player: 'you', spell: { not: { castFrom: 'hand' } } }])) {
    st.mentioned.add('e:player');
    return 'you play a land or cast a spell from anywhere other than your hand';
  }
  // std-copy-4 (CR 603.4, 601.2i; trigger trg.stdcopy4.cast.ifFirstOfEach): "you cast a spell, if it's the first instant spell, the first sorcery spell, or the first
  // Otter spell other than ~ you've cast this turn": your cast that is the first of its kind this turn for any one of the kinds, one `nthMatching` pattern per kind
  // (a spell that is "other than ~" is a filter with `other`, said after the noun)
  const firsts = firstOfKinds(list, st, tense, o);
  if (firsts !== null) return firsts;
  // std-cardcopy-5 (CR 603.2c, 603.10a; trigger trg.stdcardcopy5.oneOrMore.creaturesOrGraveyardCreatureCards.exiled): one batch of exiles from two origins,
  // "one or more creatures you control and/or creature cards in your graveyard are put into exile"
  if (o.batch === true && tense === 'present' && JSON.stringify(list) === JSON.stringify(EXILED_FROM_TWO_ORIGINS)) {
    st.mentioned.add('e:subject');
    return 'one or more creatures you control and/or creature cards in your graveyard are put into exile';
  }
  // std-hob (CR 602.2, 605.3b): "whenever you activate an ability of a creature" is every activation, the mana abilities too: one pattern that sees the non-mana
  // activations (`manaAbility: false`) and one that sees the mana abilities (`true`), the same in every other field, are said as the one activation
  if (list.length === 2) {
    const [a, b] = list;
    if (a!.ev === 'activate' && b!.ev === 'activate' && a!.ability === undefined && a!.manaAbility === false && b!.manaAbility === true && JSON.stringify({ ...a, manaAbility: true }) === JSON.stringify(b)) {
      const { manaAbility: _m, ...any } = a!;
      return event(any, st, tense, o);
    }
  }
  const parts = list.map((e) => eventParts(e, st, tense, o));
  const out: string[] = [];
  let i = 0;
  while (i < parts.length) {
    let j = i + 1;
    const preds = [parts[i]!.predicate];
    while (j < parts.length && parts[j]!.subject === parts[i]!.subject && parts[i]!.subject !== '') {
      preds.push(parts[j]!.predicate);
      j++;
    }
    // T3 (push wave), CR 509.3b, 509.3d: "blocks a white creature or becomes blocked by a white creature" is also printed "blocks or becomes blocked by a white
    // creature" (the noun phrase is the object of both verbs; parser/holes/event.ts reads it so)
    for (let k = 0; k + 1 < preds.length; k++) {
      const m = /^blocks (.+)$/.exec(preds[k]!);
      if (m && list[i + k]?.ev === 'blocks' && list[i + k + 1]?.ev === 'becomesBlocked' && preds[k + 1] === `becomes blocked by ${m[1]}`) {
        preds.splice(k, 2, alt(`${preds[k]} or ${preds[k + 1]}`, `blocks or ${preds[k + 1]}`));
      }
    }
    // FAST4 T27 (CR 119.9, 119.10): "you gain life or lose life" is also printed "you gain or lose life" (one subject, "life" the object of both verbs)
    for (let k = 0; k + 1 < preds.length; k++) {
      const g = /^(gains?) life$/.exec(preds[k]!);
      const l = /^(loses?) life$/.exec(preds[k + 1]!);
      if (g && l && list[i + k]?.ev === 'life' && list[i + k + 1]?.ev === 'life') preds.splice(k, 2, alt(`${preds[k]} or ${preds[k + 1]}`, `${g[1]} or ${l[1]} life`));
    }
    // r3-fx (CR 201.5; family plural-name-events): a plural name takes plural verbs for several events of the object itself too, "Whenever Bebop & Rocksteady
    // attack or block" (as "enter" and "attack" alone, families plural-name-verb and plural-name-attacks); only bare present verbs of "~"
    const bare = preds.map((x) => PLURAL_OF_BARE[x]);
    if (tense === 'present' && parts[i]!.subject === '~' && !parts[i]!.plural && preds.length >= 2 && bare.every((x) => x !== undefined)) {
      out.push(alt(`~ ${preds.join(' or ')}`, `~ ${bare.join(' or ')}`));
      i = j;
      continue;
    }
    // std-mana-12 (CR 603.2; family verb-list-or): three or more one-word verbs of one subject are also a list, "you waterbend, earthbend, firebend, or airbend"
    const said = preds.length >= 3 && preds.every((x) => /^[a-z]+$/.test(x)) ? alt(preds.join(' or '), joinList(preds, 'or')) : preds.join(' or ');
    out.push(parts[i]!.subject === '' ? said : `${parts[i]!.subject} ${said}`);
    i = j;
  }
  const joined = out.join(' or ');
  // FAST4 T23: events of several singular subjects with one predicate also read "~ or another nontoken Cat you control enters" (CR 603.2: either event
  // triggers the ability; parser/holes/event.ts reads the subjects so)
  const pred = parts[0]!.predicate;
  if (parts.every((p) => p.subject !== '' && !p.plural && p.predicate === pred) && new Set(parts.map((p) => p.subject)).size === parts.length) {
    return alt(joined, `${joinList(parts.map((p) => p.subject), 'or')} ${pred}`);
  }
  // FAST5 T65 (CR 700.4): several singular subjects that die ("another creature you control or a land you control is put into a graveyard from the battlefield"):
  // the passive wording is the one event they share, whatever each subject's own wording ("dies" for a creature)
  // Standard round 5, r5-trig (CR 603.2c; Satoru, the Infiltrator): the object's own entering and a batch of others entering are one "one or more" trigger: "~ and/or
  // one or more other nontoken creatures you control enter" (parser/holes/event.ts reads the list so)
  const [e0, e1] = list;
  if (o.batch && tense === 'present' && list.length === 2 && e0?.ev === 'zoneChange' && e1?.ev === 'zoneChange' && e0.to === 'battlefield' && e1.to === 'battlefield'
    && e0.from === undefined && e1.from === undefined && isSelfOnly(e0.subject) && parts[0]!.subject === '~' && parts[1]!.plural) {
    return alt(joined, `~ and/or ${parts[1]!.subject} ${parts[1]!.predicate}`);
  }
  const diesAll = list.every((e) => e.ev === 'zoneChange' && e.from === 'battlefield' && e.to === 'graveyard');
  if (diesAll && parts.every((p) => p.subject !== '' && !p.plural) && new Set(parts.map((p) => p.subject)).size === parts.length) {
    return alt(joined, `${joinList(parts.map((p) => p.subject), 'or')} ${passive('put into a graveyard', tense, false)} from the battlefield`);
  }
  return joined;
}

/**
 * p2-replace-damage-2 (CR 120.3, 609.7): a damage source described by kind only (types, colors, who controls it, "another", mana value...), not one object (`is`,
 * `self`, the attached object) and not where it is (a zone, a card, a spell or a token said by its own noun): the filter the parser's Filter hole reads from
 * "<description> source" (parser/holes/filter.ts, head `source`).
 */
function isDescribedSource(f: ObjectFilter): boolean {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  return keys.length > 0 && keys.every((k) => !['is', 'self', 'attachedToSource', 'zone', 'isCard', 'stackKind', 'token', 'targetsOnly', 'targets', 'enchantedBy'].includes(k));
}
