/**
 * Event patterns as clauses (WP2): "~ enters", "a creature you control dies", "an opponent casts a spell", "equipped creature deals combat damage to a
 * player", "the beginning of your upkeep". One printer serves triggers (present), replacement effects ("would") and history conditions (past).
 * No leading "when"/"whenever"/"if": the frame adds it.
 */
import { WITHOUT_DYING, type EventPattern, type ObjectFilter, type PlayerPred, type PlayerRef, type ZoneName } from '../types/ability';
import { attachedToWithStat } from './fold-stdcombat1';
import { K, type EventOpts } from './kernel';
import { cloneState, playerKey, type RenderState } from './state';
import { possessiveStep, turnOf } from './turn';
import { alt, ALT_OPEN, ALT_SEP, COLOR_WORD, conj, joinList, NoRenderer, numWord, ordinal, withArticle, type Person } from './text';

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
  // edh-players-19 (CR 603.7c, 608.2c; Tamiyo, Field Researcher): "whenever either of those creatures deals combat damage": any one of several announced targets (the filter is only
  // `is` over a target group); the verb stays singular
  if (!o.batch && onlyKeys(f, 'is') && f.is?.ref === 'target' && st.info.get(`t:${f.is.id}`)?.plural === true) return { text: `either of ${K.obj(f.is, st, 'object').text}`, plural: false };
  if (o.batch) return { text: K.np(filter, st, { count: 'one or more', plural: true, det: 'none', head }), plural: true };
  // edh-c-2 (CR 109.2; Captain Marvel, Shooting Star): "another creature" is also "a creature other than ~" (family event-creature-other-than-self)
  const another = K.np(filter, st, { det: 'a', head });
  const otherThan = f.other === true ? [`${K.np({ ...filter, other: undefined }, cloneState(st), { det: 'a', head })} other than ~`] : [];
  return { text: selfOrAnother(f, filter, st, otherThan.length > 0 ? alt(another, ...otherThan) : another), plural: false };
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
  // edh-next-34 (CR 303.4, 400.3; Wheel of Sun and Moon): the graveyard of the player an Aura enchants is "enchanted player's graveyard"
  const poss = owner === 'you' ? 'your' : owner === 'opponent' ? "an opponent's" : typeof owner === 'object' && owner.ref === 'enchantedPlayer' ? "enchanted player's" : 'a';
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
  // edh-next-90 (CR 603.10a, 120.3, 608.2c; Reckless Blaze): "whenever a creature you control dealt damage this way dies this turn": the creatures the damage step right before dealt damage to
  // (render/steps-life.ts marks the binding "dealt damage this way"), of a description, dying; the controller is judged as it died (last known information)
  if (f.is !== undefined && f.is.ref === 'bound' && st.info.get(`b:${f.is.name}`)?.thisWay === 'dealt damage this way' && Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).every((k) => ['is', 'types', 'controller'].includes(k))
    && f.types !== undefined && fromBf && to?.length === 1 && to[0] === 'graveyard' && o.batch !== true) {
    const { is: _is, ...rest } = f;
    const s = subjectOf(rest, st, o, false);
    return { subject: `${s.text} dealt damage this way`, predicate: verb(['dies', 'die', 'died'], tense, s.plural), plural: s.plural };
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
  // edh-zones-21 (CR 305.1, 603.6a; parser/holes/event.ts; Deep Gnome Terramancer): "lands enter under an opponent's control without being played": the controller is said after the verb
  if (ev.cause === 'unplayed') {
    if (!toBf || from !== undefined || (f.controller !== 'you' && f.controller !== 'opponent') || f.self === true) throw new NoRenderer('an unplayed entry other than of objects under one player\'s control');
    const { controller: who, ...rest } = f;
    const s = subjectOf(rest, st, o, false);
    return { subject: s.text, predicate: `${verb(['enters', 'enter', 'entered'], tense, s.plural)} under ${who === 'you' ? 'your' : "an opponent's"} control without being played`, plural: s.plural };
  }
  // std-rx19 (CR 603.6a, 110.5b; Gingerbread Cabin): "when ~ enters untapped": the object itself put onto the battlefield untapped (parser/holes/event.ts)
  if (toBf && from === undefined && f.self === true && f.tapped === false && onlyKeys(f, 'self', 'tapped')) {
    const me = subjectOf({ self: true }, st, o, false);
    return { subject: me.text, predicate: `${verb(['enters', 'enter', 'entered'], tense, me.plural)} untapped`, plural: me.plural };
  }
  // p2-trigger-events-1 (CR 603.6a, 110.5b; parser/holes/event.ts): "a permanent you control enters tapped": the status it entered with, said after the verb,
  // of any subject but the object itself
  // (std-rx19 pins another object's "enters untapped" as manual: only "tapped" is said here)
  // edh-perms-6 (CR 603.6a, 110.5b; Charismatic Conqueror): and "enters untapped" of another object, the same words (parser/holes/event.ts reads both)
  if (toBf && from === undefined && f.tapped !== undefined && f.self === undefined) {
    const { tapped: status, ...rest } = f;
    const s = subjectOf(rest, st, o, false);
    return { subject: s.text, predicate: `${verb(['enters', 'enter', 'entered'], tense, s.plural)} ${status ? 'tapped' : 'untapped'}`, plural: s.plural };
  }
  // edh-next-111 (CR 508.4, 603.6a; parser/holes/event.ts; Arni Metalbrow): "a creature you control enters attacking": put onto the battlefield attacking, said after the verb (never "an attacking creature enters")
  if (toBf && from === undefined && f.attacking === true && f.self === undefined && f.tapped === undefined) {
    const { attacking: _a, ...rest } = f;
    const s = subjectOf(rest, st, o, false);
    return { subject: s.text, predicate: `${verb(['enters', 'enter', 'entered'], tense, s.plural)} attacking`, plural: s.plural };
  }
  // edh-d-55 (CR 712.14a, 603.6a; parser/holes/event.ts; Corruption of Towashi): "a permanent you control enters transformed": it entered with its back face up, said after the verb
  if (toBf && from === undefined && f.transformed === true && f.self === undefined) {
    const { transformed: _t, ...rest } = f;
    const s = subjectOf(rest, st, o, false);
    return { subject: s.text, predicate: `${verb(['enters', 'enter', 'entered'], tense, s.plural)} transformed`, plural: s.plural };
  }
  // p2-trigger-events-1 (CR 400.3, 603.6a; parser/holes/event.ts): "a creature enters from your graveyard": the graveyard is its owner's, so the subject is said
  // without its owner ("you own")
  // edh-perms-10 (CR 400.3, 603.6a; parser/holes/event.ts; Thousand-Faced Shadow): and "enters from your hand", a hand being its owner's, said the same way
  if (toBf && from?.length === 1 && (from[0] === 'graveyard' || from[0] === 'hand') && f.owner === 'you') {
    const { owner: _o, ...rest } = f;
    const s = isSelfOnly(rest) ? subjectOf({ self: true }, st, o, false) : subjectOf(rest, st, o, false);
    return { subject: s.text, predicate: `${verb(['enters', 'enter', 'entered'], tense, s.plural)} from your ${from[0]}`, plural: s.plural };
  }
  // edh-next-47 (CR 400.3, 603.6a; parser/holes/event.ts; The Lost and the Damned): "a land you control enters from anywhere other than your hand": a land put onto the battlefield
  // from a library, a graveyard, exile or the command zone
  if (toBf && Array.isArray(from) && [...from].sort().join() === 'command,exile,graveyard,library' && f.types?.length === 1 && f.types[0] === 'Land') {
    const s = subjectOf(f, st, o, false);
    return { subject: s.text, predicate: `${verb(['enters', 'enter', 'entered'], tense, s.plural)} from anywhere other than your hand`, plural: s.plural };
  }
  // edh-zones-11 (CR 400.3, 603.6a; parser/holes/event.ts; River Kelpie): "a permanent enters from a graveyard": put onto the battlefield from any player's graveyard
  if (toBf && from?.length === 1 && from[0] === 'graveyard' && f.owner === undefined) {
    const s = isSelfOnly(f) ? subjectOf({ self: true }, st, o, false) : subjectOf(f, st, o, false);
    return { subject: s.text, predicate: `${verb(['enters', 'enter', 'entered'], tense, s.plural)} from a graveyard`, plural: s.plural };
  }
  // Precon round O, std-ro (CR 700.4, 404.1): a card goes to its owner's graveyard, so "~ is put into your graveyard from the battlefield" is ~ dying while you own it
  // (the object itself and its owner, the one pair `np.ts` does not word; any other owned subject: std-rp's put-into-your-graveyard below)
  const ownerGraveyard = fromBf && to?.length === 1 && to[0] === 'graveyard' && (f.owner === 'you' || f.owner === 'opponent');
  if (ownerGraveyard && f.self === true && onlyKeys(f, 'self', 'owner')) {
    const me = subjectOf({ self: true }, st, o, false);
    return { subject: me.text, predicate: `${passive(f.owner === 'you' ? 'put into your graveyard' : "put into an opponent's graveyard", tense, me.plural)} from the battlefield`, plural: me.plural };
  }
  // edh-d-97 (CR 400.7, 404.1, 603.7c; Saffi Eriksdotter, template eff.edhd97.whenIt.putIntoYourGraveyard.thisTurn): a target permanent (its spec names no zone: it is on the battlefield) put into your
  // graveyard, "When target creature is put into your graveyard this turn": it can only get there from the battlefield (a target that left it is a new object), so the zone it leaves is unsaid
  const tgt = f.is?.ref === 'target' ? st.specs.get(f.is.id) : undefined;
  if (ownerGraveyard && f.owner === 'you' && tgt !== undefined && tgt.kind === 'object' && tgt.filter?.zone === undefined && onlyKeys(f, 'is', 'owner') && o.batch !== true) {
    const s = subjectOf({ is: f.is }, st, o, false);
    return { subject: s.text, predicate: alt(passive('put into your graveyard', tense, s.plural), `${passive('put into your graveyard', tense, s.plural)} from the battlefield`), plural: s.plural };
  }
  // edh-c-76 (CR 400.3, 603.10a; parser/holes/event.ts; Stormfront Riders): a permanent you own put into its owner's hand from the battlefield is "returned to your hand from the battlefield",
  // the hand being its owner's (the subject is said without its owner)
  // (a trigger only: the condition "a permanent you own was returned to its owner's hand this turn" keeps its own wording, p2iv3)
  // (coordinator A, 2026-10-31: only for the object itself or "another" one, as Stormfront Riders prints it; any other permanent you own keeps edh-c-63's readings below,
  // "a permanent is returned to your hand" / "a permanent you own is returned to its owner's hand", which this branch returned before)
  const { owner: _owner76, ...rest76 } = f;
  if (fromBf && to?.length === 1 && to[0] === 'hand' && f.owner === 'you' && tense === 'present' && (isSelfOnly(rest76) || rest76.other === true)) {
    const { owner: _o, ...rest } = f;
    const s = subjectOf(isSelfOnly(rest) ? { self: true } : rest, st, o, false);
    return { subject: s.text, predicate: `${passive('returned to your hand', tense, s.plural)} from the battlefield`, plural: s.plural };
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
  // edh-d-61 (CR 700.4, 603.7c, 201.5; Golden Guardian, family delayed-event-self-name): "When ~ dies this turn": the object itself named by a reference in a delayed trigger's event is also said "~"
  const subject = fromBf && to?.length === 1 && to[0] === 'graveyard' && f.is?.ref === 'self' && onlyKeys(f, 'is') && !o.batch ? alt('~', sub.text) : sub.text;
  // edh-players-15 (CR 108.3, 110.2, 603.6a; Brainstealer Dragon): "a nonland permanent an opponent owns enters under your control": the owner named in the subject, the controller after the verb
  if (toBf && from === undefined && f.owner === 'opponent' && f.controller === 'you' && f.self === undefined && !isSelfOnly(f)) {
    const { controller: _c, ...rest } = f;
    const oc = subjectOf(rest, st, o, false);
    const ownerKey = playerKey({ ref: 'ownerOf', object: { ref: 'event', role: 'subject' } }); // the opponent the subject names is "they" / "that player" later
    if (ownerKey !== null) { st.mentioned.add(ownerKey); st.info.set(ownerKey, { nouns: ['player', 'opponent'], plural: false, player: true }); }
    return { subject: oc.text, predicate: `${verb(['enters', 'enter', 'entered'], tense, oc.plural)} under your control`, plural: oc.plural };
  }
  // edh-d-37 (CR 603.6a, 110.2; Tunnel Ignus): "a land an opponent controls enters" is also "a land enters under an opponent's control" (family enters-under-opponent)
  if (toBf && from === undefined && f.controller === 'opponent' && f.self === undefined && !isSelfOnly(f) && sub.plural === false && (st.trigger ?? []).length === 1) {
    const { controller: _c, ...rest } = f;
    const bare = subjectOf(rest, st, o, false);
    const enters = verb(['enters', 'enter', 'entered'], tense, sub.plural);
    return { subject: '', predicate: alt(`${subject} ${enters}`, `${bare.text} ${enters} under an opponent's control`), plural: sub.plural };
  }
  // edh-d-37 (CR 603.6a, 608.3a; Overburden): "a nontoken creature enters" is also "a player puts a nontoken creature onto the battlefield" (family trigger-player-puts-onto-battlefield): of a
  // permanent no player's control restricts, whoever puts it there (a spell's controller puts it there as it resolves)
  if (toBf && from === undefined && f.controller === undefined && f.self === undefined && f.owner === undefined && !isSelfOnly(f) && sub.plural === false && tense === 'present' && sub.text !== '~' && (st.trigger ?? []).length === 1) {
    const enters = verb(['enters', 'enter', 'entered'], tense, sub.plural);
    return { subject: '', predicate: alt(`${subject} ${enters}`, `a player puts ${subject} onto the battlefield`), plural: sub.plural };
  }
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
    // edh-d-61 (CR 700.4, 603.7c; Golden Guardian): "When ~ dies this turn": the object a delayed trigger's event names by a reference to the ability's own object, a creature as the object itself is
    const selfRef = f.is !== undefined && f.is.ref === 'self' && onlyKeys(f, 'is');
    const creature = !mixed && ((f.types ?? []).includes('Creature') || ((isSelfOnly(f) || selfRef) && own?.includes('creature') === true) || (attachedOnly && own?.includes('equipment') === true));
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
    // pc-counters-1 (CR 700.4; parser/holes/event.ts#plainPermanents): "whenever a permanent you control is put into a graveyard" leaves "from the battlefield" unsaid:
    // a permanent is on the battlefield (a description of permanents that says no more than who controls or owns them)
    // p2-trigger-events-1 (CR 110.1, 603.6c; Aetherworks Marvel): a permanent's description ("a permanent you control", "enchanted artifact") put into a graveyard can
    // only come from the battlefield, so Oracle may leave "from the battlefield" unsaid (family permanent-put-into-graveyard)
    const bareAlt = !creature && !unknownSelf && Object.entries(f).every(([k, v]) => v === undefined || k === 'controller' || k === 'owner' || k === 'other') && sub.text.includes('permanent') ? [passive('put into a graveyard', tense, sub.plural)] : [];
    const bareOk = !isSelfOnly(f) && f.isCard === undefined && f.zone === undefined && f.owner === undefined && o.batch !== true;
    // edh-zones-22 (CR 700.4, 113.6; Serra Paragon): inside the quotes of a granted ability the object that has it is not the card that grants it, so its types are unknown: "When this permanent
    // is put into a graveyard from the battlefield" is also "dies" for the object itself, whatever the host is (family dies-wording, no new meaning)
    const generic0 = creature ? (bareOk ? alt(dies, passive('put into a graveyard', tense, sub.plural)) : st.depth > 0 && isSelfOnly(f) ? alt(dies, put) : dies) : unknownSelf ? alt(dies, put, ...(attachedOnly && (f.subtypes ?? []).length > 0 ? [passive('put into a graveyard', tense, sub.plural)] : [])) /* edh-c-108 (CR 303.4, 700.4; Genju of the Cedars): "enchanted Forest is put into a graveyard" leaves "from the battlefield" unsaid: an enchanted permanent is on the battlefield */ : bareAlt.length > 0 ? alt(put, put2, dies, ...bareAlt) : bareOk ? alt(put, put2, dies, passive('put into a graveyard', tense, sub.plural)) : alt(put, put2, dies);
    // edh-c-63 (CR 404.1, 700.4; Liability; family put-into-players-graveyard): a permanent no owner is named for, put into "a player's graveyard" (its owner's) from the battlefield
    const ofPlayer = bareOk ? [`${passive("put into a player's graveyard", tense, sub.plural)} from the battlefield`] : [];
    const generic = selfWould.length > 0 || ofPlayer.length > 0 ? alt(generic0, ...selfWould, ...ofPlayer) : generic0;
    // edh-players-12 (CR 404.1, 700.4; Viridian Revel): and one an opponent owns, "whenever an artifact is put into an opponent's graveyard from the battlefield" (family put-into-opponents-graveyard)
    // edh-c-15 (CR 400.3, 404.1; Mazzy, Truesword Paladin): a permanent you own AND control goes to your graveyard too, "an Aura you control is put into your graveyard from the battlefield"
    if ((owner === 'you' || owner === 'opponent') && !isSelfOnly(f) && (f.controller === undefined || (owner === 'you' && f.controller === 'you')) && !didnt) {
      const bare = subjectOf({ ...f, owner: undefined }, st, o, zoneless, head);
      if (bare.plural === sub.plural) {
        return { subject: '', predicate: alt(`${bare.text} ${passive(owner === 'you' ? 'put into your graveyard' : "put into an opponent's graveyard", tense, bare.plural)} from the battlefield`, `${subject} ${generic}`), plural: sub.plural };
      }
    }
    // FAST1 T4: "dies" is "is put into a graveyard from the battlefield" for any object (CR 700.4): Oracle says it of creature types too ("another Zombie you control dies")
    return { subject, predicate: generic, plural: sub.plural };
  }
  // edh-c-20 (CR 400.3, 404.1; Golgari Brownscale): a card you own put into your hand from your graveyard; the owner is said by the zones
  if (from?.length === 1 && from[0] === 'graveyard' && to?.length === 1 && to[0] === 'hand' && owner === 'you') {
    const bare = subjectOf({ ...f, owner: undefined }, st, o, zoneless, head);
    return { subject: bare.text, predicate: `${passive('put into your hand', tense, bare.plural)} from your graveyard`, plural: bare.plural };
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
  // edhn63 (CR 700.4, 903.9; Reyhan, Last of the Abzan): "dies or is put into the command zone": a commander put into the command zone instead of dying is not a death
  if (fromBf && to?.length === 2 && to.includes('graveyard') && to.includes('command')) {
    if (isSelfOnly(f) && !st.ctx.selfTypes) throw new NoRenderer('"dies or is put into the command zone" of the object itself, whose types are unknown');
    return { subject, predicate: `${verb(['dies', 'die', 'died'], tense, sub.plural)} or ${passive('put into the command zone', tense, sub.plural)}`, plural: sub.plural };
  }
  if (fromBf && to?.length === 1 && to[0] === 'exile') {
    // p2-trigger-events-1 (CR 406.3; Soulherder): also "is exiled from the battlefield" (family exiled-from-the-battlefield)
    return { subject, predicate: alt(`${passive('put into exile', tense, sub.plural)} from the battlefield`, passive('exiled', tense, sub.plural), `${passive('exiled', tense, sub.plural)} from the battlefield`), plural: sub.plural };
  }
  if (fromBf && to?.length === 1 && to[0] === 'hand') {
    // edh-c-63 (CR 400.3, 603.6c; Azorius Aethermage, Warped Devotion; family returned-to-players-hand): the hand is the owner's, so "a permanent is returned to a player's hand" is the
    // permanent of no stated owner, and "a permanent is returned to your hand" the one you own (the owner said by the zone, as for a graveyard above)
    const handWords = [`${passive('returned to its owner\'s hand', tense, sub.plural)}`, `${passive('returned to hand', tense, sub.plural)}`, `${passive('put into a hand', tense, sub.plural)} from the battlefield`, ...(f.owner === undefined && !isSelfOnly(f) ? [passive("returned to a player's hand", tense, sub.plural)] : [])];
    const mine = f.owner === 'you' && !isSelfOnly(f) && f.controller === undefined ? subjectOf({ ...f, owner: undefined }, st, o, zoneless, head) : null;
    if (mine !== null && mine.plural === sub.plural) return { subject: '', predicate: alt(`${mine.text} ${passive('returned to your hand', tense, sub.plural)}`, ...handWords.map((w) => `${subject} ${w}`)), plural: sub.plural };
    return { subject, predicate: alt(...handWords), plural: sub.plural };
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
    // edh-c-15 (CR 603.2c, 404.1; family batch-into-graveyards; Dennick, Pious Apprentice): one or more cards put into the graveyards of no one player in particular are put into "a graveyard" or "graveyards"
    const dest = to.length === 1 && to[0] === 'exile' ? 'exile' : o.batch === true && owner === undefined && to.length === 1 && to[0] === 'graveyard' && from === undefined ? alt(zoneNoun(ev.to, owner), 'graveyards') : zoneNoun(ev.to, owner);
    // CLOUD std-dft (CR 603.2c, 406.1): a batch of cards from graveyards and from the battlefield, "one or more cards are put into exile from graveyards and/or the battlefield"
    const both = o.batch === true && owner === undefined && from?.length === 2 && from.includes('graveyard') && from.includes('battlefield');
    // edh-zones-3 (parser/holes/event.ts; Syr Konrad, the Grim): every zone a card is put into a graveyard from but the battlefield is "anywhere other than the battlefield"
    // edh-zones-4 (CR 400.3, 406.3; Laelia, the Blade Reforged; family exile-from-own-zones): a card put into exile from its owner's library and/or graveyard, "from your library
    // and/or your graveyard" (or "or", with the second "your" optional): the owner is said by the zones
    const notBf = from?.length === 5 && ['hand', 'library', 'stack', 'exile', 'command'].every((z) => from.includes(z as never));
    const ownZones = owner === 'you' && to.length === 1 && to[0] === 'exile' && from !== undefined && from.length > 0 && from.every((z) => z === 'library' || z === 'graveyard');
    const ownPart = ownZones ? ` from ${from!.length === 2 ? alt('your library and/or your graveyard', 'your library or your graveyard', 'your library or graveyard') : zoneNoun(ev.from, owner)}` : null;
    // edh-c-20 (CR 400.3; Wan Shi Tong ruling 2025-10-02): into a library "from anywhere" is from every zone but a library (a reorder of the library is no move)
    const notLib = to.length === 1 && to[0] === 'library' && from?.length === 6 && ['hand', 'battlefield', 'graveyard', 'stack', 'exile', 'command'].every((z) => from.includes(z as never));
    // edh-next-138 (CR 400.3; Desert Warfare): a card of yours put into your graveyard from your hand or your library, "from your hand or library"
    const handLib = owner === 'you' && to.length === 1 && to[0] === 'graveyard' && from?.length === 2 && from[0] === 'hand' && from[1] === 'library';
    const fromPart = notLib ? ' from anywhere' : notBf ? ' from anywhere other than the battlefield' : handLib ? ' from your hand or library' : ownPart !== null ? ownPart : both ? ' from graveyards and/or the battlefield' : from ? ` from ${from.length === 1 && from[0] === 'battlefield' ? 'the battlefield' : (from.length === 1 && from[0] === 'library' && owner === 'opponent' && to.length === 1 && to[0] === 'graveyard' ? alt(zoneNoun(ev.from, owner), 'their library') /* edh-d-57 (CR 400.3; Undead Alchemist): the opponent whose graveyard it is */ : zoneNoun(ev.from, from.length === 1 && from[0] === 'library' ? owner : undefined))}` : (o.batch === true && to.length === 1 && to[0] === 'exile' && f.isCard === true ? alt(' from anywhere', '') : ' from anywhere'); // FAST5 T66: "from your library" names its owner; edh-c-64 (Stonebinder's Familiar): a batch of cards put into exile need not say where from
    // FAST5X E21: a card of a type is "a creature card", "one or more permanent cards" (the head word the zoneless subject would otherwise drop), as above
    // edh-c-45 (CR 614.1a, 400.3, 111.7; Sanctifier en-Vec; family colored-anything-to-graveyard): an object of some colors put into a graveyard from anywhere (no card or token qualifier) is said
    // "a black or red permanent, spell, or card not on the battlefield": a permanent from the battlefield, a spell from the stack, a card from anywhere else
    const setKeys = Object.entries(f).filter(([, v]) => v !== undefined).map(([k]) => k).join();
    if (tense === 'would' && !from && to.length === 1 && to[0] === 'graveyard' && setKeys === 'colors' && f.colors!.length > 0 && o.batch !== true && !sub.plural) {
      const words = f.colors!.map((c) => COLOR_WORD[c] ?? c);
      return { subject: '', predicate: alt(`${subject} ${passive('put into a graveyard', tense, false)}${fromPart}`, `a ${joinList(words, 'or')} permanent, spell, or card not on the battlefield ${passive('put into a graveyard', tense, false)}`), plural: false };
    }
    const cards = zoneless && f.isCard === true && head === undefined ? subjectOf(printed, st, o, zoneless, 'card') : null;
    if (cards !== null && cards.plural === sub.plural) return { subject: cards.text, predicate: `${passive(`put into ${dest}`, tense, sub.plural)}${fromPart}`, plural: sub.plural };
    return { subject, predicate: `${passive(`put into ${dest}`, tense, sub.plural)}${fromPart}`, plural: sub.plural };
  }
  return { subject, predicate: `${verb(['changes zones', 'change zones', 'changed zones'], tense, sub.plural)}`, plural: sub.plural };
}

/** The events that have a "one or more" wording (CR 603.2c). Any other event with `batch` is refused: the flag would be lost. */
/**
 * edh-next-70 (CR 603.2, 110.5; family self-pair-become; Tui and La, Moon and Ocean): a card named as a pair ("Tui and La") takes the plural verb of the name, "Whenever Tui and La become tapped";
 * the object itself, in the present, is also said "~ becomes tapped" (the same event).
 */
function selfPairVerb(said: string, object: ObjectFilter, tense: string, plural: boolean, what: string): string {
  return isSelfOnly(object) && tense === 'present' && !plural ? alt(said, `become ${what}`) : said;
}

const BATCHABLE = new Set(['zoneChange', 'attacks', 'blocks', 'becomesBlocked', 'damage', 'becomes', 'counters', 'action', 'createToken', 'dieRoll', 'attacksUnblocked', 'life']);

function eventParts(ev: EventPattern, st: RenderState, tense: Tense, o: EventOpts, ownFrom?: string): Parts {
  if (o.batch === true && !BATCHABLE.has(ev.ev)) throw new NoRenderer(`"one or more" for the event ${ev.ev}`);
  // CLOUD std-misc (CR 603.2c): the players counted together exist only for a player action of any player, in the present tense (Standard merge wave 3: and for
  // "one or more of your opponents are attacked", checked in the attacks case below)
  // Standard round 5, r5-trig (CR 603.2c, 122.6): also "you put one or more counters on one or more <objects>" (counters by you, rendered below)
  const counterWhole = ev.ev === 'counters' && (ev.by === 'you' || (ev.by === undefined && ev.change === 'put' && ev.atLeast === undefined && !('player' in ev.on))) && tense === 'present'; // edh-c-13: and counters put on one or more objects by anyone (Cloaked Cadet)
  // std-rr (CR 603.2c): and "one or more [of your] opponents are dealt [combat] damage" (rendered in the damage case below)
  const opponentsDealt = ev.ev === 'damage' && ev.source === undefined && ev.amount === undefined && ev.excess !== true && ev.recipient?.player === 'opponent' && ev.recipient.object === undefined;
  // edh-replace-3 (CR 603.2c; Contaminant Grafter): and "one or more creatures you control deal combat damage to one or more players" (parser/holes/event.ts, `whole`)
  const playersDealt = ev.ev === 'damage' && ev.source !== undefined && ev.amount === undefined && ev.excess !== true && (ev.recipient?.player === 'any' || ev.recipient?.player === 'opponent') && ev.recipient.object === undefined; // edh-replace-5: or "to your opponents" (Malcolm)
  // edh-next-51 (CR 603.2c; Briarbridge Patrol, parser/holes/event.ts): and one source's damage "to one or more creatures": the creatures dealt damage together, one occurrence
  const creaturesDealt = ev.ev === 'damage' && ev.source !== undefined && ev.amount === undefined && ev.excess !== true && ev.recipient?.player === undefined && JSON.stringify(ev.recipient?.object) === '{"types":["Creature"]}';
  if (o.wholeBatch === true && (o.batch !== true || (ev.ev !== 'action' && ev.ev !== 'attacks' && ev.ev !== 'life' && !counterWhole && !opponentsDealt && !playersDealt && !creaturesDealt) || (ev.ev === 'action' && (ev.actor ?? 'any') !== 'any') || tense !== 'present')) throw new NoRenderer('"one or more players" for another event');
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
      // edh-c-64 (Rose Noble): the second noun phrase may leave out its article, "a Doctor spell or creature spell with doctor's companion" (trigger trg.edhv64.cast.spellOrSpellBare)
      const eitherBare = either === null ? null : ev.spell!.anyOf!.map((x, i) => (i === 0 ? K.np({ ...x, stackKind: 'spell' }, st, { det: 'a' }) : K.np({ ...x, stackKind: 'spell' }, st, { det: 'a' }).replace(/^an? /, ''))).join(' or ');
      const spell = either === null ? spell0 : alt(spell0, either, eitherBare!);
      // cloud std-spm (CR 406.1): exile is no one's zone: "cast a spell from exile" (std-lci made the same change, Quintorius Kand)
      const from = ownFrom !== undefined ? ownFrom : notHand ? ` from anywhere other than ${ev.player === 'you' ? 'your' : 'their'} hand` : ev.from ? ` from ${ev.from === 'hand' ? (typeof ev.player === 'string' && ev.player !== 'you' ? 'their hand' : 'your hand') : ev.from === 'exile' ? 'exile' : `a ${ZONE_NAME[ev.from]}`}` : '';
      // edh-b-13 (CR 707.10; Kalamax): "you copy an instant spell", present tense and a spell description only
      if (ev.copyOnly === true && (tense !== 'present' || ev.from !== undefined || ev.via !== undefined || ev.nth !== undefined || ev.manaFromSelf !== undefined || ev.modal !== undefined || selfSpell || yourCommander)) throw new NoRenderer('a copy event with another condition'); // edh-next-114 (CR 707.10; The Twelfth Doctor): also "whenever you copy a spell" with no description // edh-next-107: and "copies a spell" with no description
      const text = ev.copyOnly === true ? (p.person === 'sg' ? 'copies' : 'copy') : ev.orCopy ? (tense === 'past' ? 'cast or copied' : tense === 'would' ? 'would cast or copy' : p.person === 'sg' ? 'casts or copies' : 'cast or copy') : personVerb('cast', 'cast', tense, p.person);
      // Standard round 5, r5-trig: "from anywhere other than your hand" and "other than your first spell that turn" have their wordings where the whole sentence is known
      // (render/cond.ts, render/abil.ts#notFirstSpell); never dropped here
      // edh-next-107 (CR 601.2i, 500.1; parser/holes/event.ts, Curse of Shaken Faith; family cast-not-first-they): a spell of another player (their, not "you") that is not their first of the turn
      if (ev.nthMin === 2 && p.person !== 'you' && tense === 'present' && Object.keys(ev).every((x) => x === 'ev' || x === 'player' || x === 'nthMin')) return { subject: p.text, predicate: `${text} a spell other than the first spell they cast each turn`, plural: false };
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
      // edh-next-91 (CR 601.2i, 603.2; Nullstone Gargoyle): the Nth spell of a kind cast in a turn by any player: "the first noncreature spell of a turn is cast"
      if (ev.anyCaster === true) {
        if (ev.nth === undefined || ev.nthMatching !== true || ev.player !== undefined || ev.orCopy || ev.from || ev.via !== undefined || tense !== 'present' || ev.spell === undefined) throw new NoRenderer('the Nth spell of a turn by any player with another condition');
        return { subject: '', predicate: `the ${ordinal(ev.nth)} ${K.np({ ...ev.spell, stackKind: ev.spell.stackKind ?? 'spell' }, st, { det: 'none' })} of a turn is cast`, plural: false };
      }
      if (ev.nth !== undefined && ev.nthMatching === true) {
        // FAST5X E18 (CR 601.2i): "an opponent casts their first noncreature spell each turn": the spell's words without the article
        if (ev.orCopy || ev.from || ev.via !== undefined || tense !== 'present' || ev.spell === undefined) throw new NoRenderer('the Nth spell of a kind with another condition');
        const kind = K.np({ ...ev.spell, stackKind: ev.spell.stackKind ?? 'spell' }, st, { det: 'none' });
        // edh-next-44 (CR 603.4, 601.2i; Vengevine; family cast-nth-of-kind-if): your Nth spell of a kind after the first is also "you cast a spell, if it's the second creature spell you cast this turn"
        const each = `${text} your ${ordinal(ev.nth)} ${kind} each turn`;
        if (p.person === 'you' && ev.nth >= 2 && Object.keys(ev).every((k) => ['ev', 'player', 'spell', 'nth', 'nthMatching'].includes(k))) return { subject: p.text, predicate: alt(each, `${text} a spell, if it's the ${ordinal(ev.nth)} ${kind} you cast this turn`), plural: false };
        return { subject: p.text, predicate: `${text} ${p.person === 'you' ? 'your' : 'their'} ${ordinal(ev.nth)} ${kind} each turn`, plural: false };
      }
      if (ev.nth !== undefined) {
        // FAST1 T4 (CR 601.2i): "you cast your second spell each turn", "an opponent casts their second spell each turn", like `draw.nth`
        if (ev.orCopy || ev.from || ev.via !== undefined || tense !== 'present' || (ev.spell && Object.values(ev.spell).some((v) => v !== undefined))) throw new NoRenderer('the Nth spell with another condition');
        // edh-c-1 (family cast-nth-in-a-turn; Vance's Blasting Cannons): "your third spell in a turn" is also "your third spell each turn"
        return { subject: p.text, predicate: `${text} ${p.person === 'you' ? 'your' : 'their'} ${ordinal(ev.nth)} spell ${alt('each turn', 'in a turn')}`, plural: false };
      }
      // FAST5X E2 (CR 118.9, 702.185c): "casts a spell for its warp cost"
      const via = ev.via !== undefined ? ` for its ${ev.via} cost` : '';
      // std-lci (CR 106.3): "a permanent spell using mana produced by ~"
      const using = ev.manaFromSelf === true ? ` using mana produced by ${K.obj({ ref: 'self' }, st, 'object').text}` : '';
      // edh-c-91 (CR 702.33d, 601.2; family kicks-a-spell; Saproling Infestation): a cast of a kicked spell and nothing else is also "kicks a spell"
      const kicks = ev.spell !== undefined && ev.spell.kicked === true && Object.keys(ev.spell).every((k) => k === 'kicked' || (k === 'stackKind' && ev.spell!.stackKind === 'spell')) && ev.from === undefined && ev.via === undefined && ev.orCopy !== true && ev.copyOnly !== true && using === '' && ev.nth === undefined;
      const kicking = kicks ? ` ${personVerb('kick', 'kicked', tense, p.person)} a spell` : '';
      return { subject: p.text, predicate: kicks ? alt(`${text} ${spell}${from}${via}${using}`, kicking.trim()) : `${text} ${spell}${from}${via}${using}`, plural: false };
    }
    case 'activate': {
      const p = playerSubject(ev.player ?? 'any', st);
      st.mentioned.add('e:player');
      // edh-next-74 (CR 602.2b, 107.3a, 118.3; Magus Lucea Kane, Unbound Flourishing, Verrak, Warped Sengir): an activation whose cost had {X} ("activate an ability with {X} in its activation cost") or paid life
      // ("whenever you activate an ability that isn't a mana ability, if life was paid to activate it"): of any ability of any source, nothing else on the event
      // edh-d-50 (CR 602.2b, 106.3; Dynaheir, Invoker Adept): "activate an ability that isn't a mana ability by spending four or more mana to activate it": of any non-mana ability, nothing else on the event
      if (ev.manaSpentAtLeast !== undefined) {
        if (ev.manaAbility !== false || ev.source !== undefined || ev.ability !== undefined || ev.activated !== undefined || ev.produced !== undefined || ev.tapped !== undefined || ev.xInCost !== undefined || ev.lifePaid !== undefined || tense !== 'present'
          || !Number.isInteger(ev.manaSpentAtLeast) || ev.manaSpentAtLeast < 2 || ev.manaSpentAtLeast > 10) throw new NoRenderer('an activation by spending mana and another condition');
        return { subject: p.text, predicate: `${personVerb('activate', 'activated', tense, p.person)} an ability that isn't a mana ability by spending ${numWord(ev.manaSpentAtLeast)} or more mana to activate it`, plural: false };
      }
      if (ev.xInCost === true || ev.lifePaid === true) {
        if (ev.source !== undefined || ev.ability !== undefined || ev.activated !== undefined || ev.produced !== undefined || ev.tapped !== undefined || (ev.xInCost === true && (ev.lifePaid === true || ev.manaAbility !== undefined))
          || (ev.lifePaid === true && ev.manaAbility !== false) || tense !== 'present') throw new NoRenderer('an activation with {X} or life paid in its cost and another condition');
        if (ev.xInCost === true) return { subject: p.text, predicate: `${personVerb('activate', 'activated', tense, p.person)} an ability with {X} in its activation cost`, plural: false };
        return { subject: p.text, predicate: `${personVerb('activate', 'activated', tense, p.person)} an ability that isn't a mana ability, if life was paid to activate it`, plural: false };
      }
      let src = ev.source ? K.np(ev.source, st, { det: 'a' }) : '';
      // edh-d-1 (CR 602.2, 603.2; Avalanche of Sector 7, template trg.edhd1.opponent.activate.abilityOf.theyControl): an opponent's activation of an ability of a permanent that opponent controls:
      // "an artifact they control" (the source filter's controller `opponent`) is also "an artifact an opponent controls"
      if (ev.source !== undefined && ev.player === 'opponent' && ev.source.controller === 'opponent' && ev.ability === undefined && ev.manaAbility === undefined && ev.activated === undefined && ev.produced === undefined && ev.tapped === undefined) {
        src = alt(src, `${K.np({ ...ev.source, controller: undefined }, st, { det: 'a' })} they control`);
      }
      // trek-19 (CR 607.2d, 201.2; family source-with-the-chosen-name; Kai Winn): the sources of any zone with the name a card chose are "a source with the chosen name"
      const namedSource = ev.source !== undefined && JSON.stringify(ev.source) === '{"zone":"any","chosen":{"link":"cardName","quality":"cardName"}}';
      // edh-next-11 (CR 606.3, 303.4; Rowan's Talent): "activate a loyalty ability of enchanted planeswalker" (the permanent the Aura is attached to, no article)
      const attachedSource = ev.ability === 'loyalty' && ev.source?.attachedToSource === true && ev.manaAbility === undefined;
      const of = attachedSource ? ` of ${K.np(ev.source!, st, { det: 'none' })}` : src ? ` of ${namedSource ? alt(src, 'a source with the chosen name') : src}` : '';
      const mana = ev.manaAbility === false ? " that isn't a mana ability" : ev.manaAbility === true ? " that's a mana ability" : '';
      // FAST5X E20: "activate an exhaust ability" (CR 702.177a), "activate a loyalty ability" (CR 606.3)
      // r5-mech (CR 702.177a, 605.1a): "an exhaust ability that isn't a mana ability" (Pit Automaton) is the one other condition said
      const notMana = ev.ability === 'exhaust' && ev.manaAbility === false && ev.source === undefined;
      // edh-c-23 (CR 606.3; Keral Keep Disciples): "a loyalty ability of a Chandra planeswalker" (the source a planeswalker, the loyalty ability its own)
      const loyaltyOf = ev.ability === 'loyalty' && ev.manaAbility === undefined && ev.source?.types?.join() === 'Planeswalker' && ev.source.attachedToSource === undefined && ev.activated === undefined;
      if (ev.ability !== undefined && !notMana && !attachedSource && !loyaltyOf && (ev.manaAbility !== undefined || ev.source !== undefined)) throw new NoRenderer('an exhaust or loyalty ability with another condition');
      // std-rx28 (CR 602.2, 115.9b): "an ability that targets a creature or player" (the ability itself described, parser/holes/event.ts)
      if (ev.activated !== undefined && (ev.ability !== undefined || ev.manaAbility !== undefined || ev.source !== undefined)) throw new NoRenderer('a described activated ability with another condition');
      const kind = ev.activated !== undefined ? K.np({ ...ev.activated, stackKind: 'ability' }, st, { det: 'a' }) : ev.ability === 'exhaust' ? 'an exhaust ability' : ev.ability === 'loyalty' ? 'a loyalty ability' : ev.ability === 'ninjutsu' ? 'a ninjutsu ability' : ev.ability === 'boast' ? 'a boast ability' : 'an ability';
      const plain = `${personVerb('activate', 'activated', tense, p.person)} ${kind}${of}${mana}`;
      // std-mana-1 (CR 106.12): a mana ability with {T} in its cost (`tapped`, parser/holes/event.ts): "you tap an artifact token for mana" says that and nothing else
      // std-mana-1 (CR 106.12): "you tap a land for {C}" (`produced`, a land's mana ability: every one has {T})
      // edh-mana-keywords-5 (CR 106.4, 605.1b, 607.2d; family chosen-color-mana-trigger): the mana the activation produced is of the color the trigger's object chose: "Whenever a land's
      // ability causes you to add one or more mana of the chosen color" (a land's mana ability, yours) and "Whenever a basic land is tapped for mana of the chosen color"
      if (ev.produced === 'chosen') {
        if (ev.manaAbility !== true || !ev.source || ev.ability !== undefined || ev.activated !== undefined || tense !== 'present') throw new NoRenderer('mana of the chosen color with another condition');
        if (ev.player === 'you' && ev.tapped === undefined && JSON.stringify(ev.source) === JSON.stringify({ types: ['Land'] })) {
          return { subject: '', predicate: "a land's ability causes you to add one or more mana of the chosen color", plural: false };
        }
        if ((ev.player ?? 'any') === 'any' && ev.tapped === true) return { subject: src, predicate: 'is tapped for mana of the chosen color', plural: false };
        throw new NoRenderer('mana of the chosen color other than those two wordings');
      }
      if (ev.produced !== undefined) {
        // edh-perms-1 (CR 106.12, 605.1b; Forsaken Monument): "you tap a permanent for {C}": a source that is not (only) a land says the {T} the activation had (`tapped`)
        if (ev.manaAbility !== true || !ev.source || ev.ability !== undefined || ev.activated !== undefined || tense !== 'present' || (landSource(ev.source) ? ev.tapped !== undefined : ev.tapped !== true)) throw new NoRenderer('a tap for a type of mana with another condition');
        return { subject: p.text, predicate: `${personVerb('tap', 'tapped', tense, p.person)} ${src} for {${ev.produced}}`, plural: false };
      }
      if (ev.tapped === true) {
        if (ev.manaAbility !== true || !ev.source || ev.ability !== undefined || ev.activated !== undefined || tense !== 'present') throw new NoRenderer('a tapped-for-mana activation with another condition');
        // edh-mana-keywords-9 (CR 106.12; Extraplanar Lens): of any player's land, also "<land> is tapped for mana" (a land that shares a name with the exiled card)
        if (ev.player === undefined && landSource(ev.source) && ev.source.sharesWith !== undefined) return { subject: '', predicate: alt(`${p.text} ${personVerb('tap', 'tapped', tense, p.person)} ${src} for mana`, `${src} ${passive('tapped', tense, false)} for mana`), plural: false };
        return { subject: p.text, predicate: `${personVerb('tap', 'tapped', tense, p.person)} ${src} for mana`, plural: false };
      }
      // FAST1 T4, CR 106.12: a land is "tapped for mana" when a mana ability of it is activated (every one has {T} in its cost; parser/holes/event.ts reads
      // the words for lands only, so only a land source is printed this way)
      if (ev.manaAbility === true && ev.source && tense === 'present' && landSource(ev.source)) {
        const forms = [`${p.text} ${plain}`, `${p.text} ${personVerb('tap', 'tapped', tense, p.person)} ${src} for mana`];
        if (ev.player === undefined) forms.push(`${src} ${passive('tapped', tense, false)} for mana`);
        return { subject: '', predicate: alt(...forms), plural: false };
      }
      // edh-players-5 (CR 602.2, 605.1a, 603.4; Harsh Mentor): "an ability of an artifact, creature, or land on the battlefield, if it isn't a mana ability" is "an ability of a permanent
      // that isn't a mana ability": a permanent's ability is one of an object on the battlefield, so the zone words and the "if" say what the pattern already says (a source with no zone)
      // edh-mana-keywords-5 (CR 603.4, 605.1a; family activate-if-not-mana): "Whenever you activate an ability, if it isn't a mana ability" and, of any player's activation of a
      // described source, "Whenever an ability of equipped creature is activated, if it isn't a mana ability": the same event said with the condition after the comma
      // (combined copy: one branch for both rounds' wordings; edh-players-5's branch, first and separate, shadowed the Bracers' "is activated" form)
      if (ev.manaAbility === false && ev.ability === undefined && ev.activated === undefined && ev.produced === undefined && ev.tapped === undefined && tense === 'present') {
        const forms = [plain, `${personVerb('activate', 'activated', tense, p.person)} ${kind}${of}, if it isn't a mana ability`];
        if (src && ev.source!.zone === undefined) forms.push(`${personVerb('activate', 'activated', tense, p.person)} ${kind}${of} on the battlefield, if it isn't a mana ability`);
        if (ev.source !== undefined && (ev.player ?? 'any') === 'any') {
          return { subject: '', predicate: alt(...forms.map((f) => `${p.text} ${f}`), `an ability of ${alt(src, src.replace(/^an? /, ''))} is activated, if it isn't a mana ability`), plural: false };
        }
        return { subject: p.text, predicate: alt(...forms), plural: false };
      }
      // edh-d-90 (CR 605.1a, 605.3a, 605.3b; Tyvar the Bellicose, family mana-ability-of-resolves): any player's activation of a mana ability of the object itself is "a mana ability of ~
      // resolves" (an activated mana ability resolves as it is activated, CR 605.3a)
      if (ev.manaAbility === true && ev.player === undefined && ev.ability === undefined && ev.activated === undefined && ev.produced === undefined && ev.tapped === undefined && tense === 'present'
        && JSON.stringify(ev.source) === '{"self":true}' && Object.keys(ev).every((k) => k === 'ev' || k === 'source' || k === 'manaAbility')) {
        return { subject: '', predicate: alt(`${p.text} ${plain}`, `a mana ability of ${src} resolves`), plural: false };
      }
      return { subject: p.text, predicate: plain, plural: false };
    }
    case 'attacks': {
      // edh-combat-1 (CR 508.5, 603.4; Kazuul): "Whenever a creature an opponent controls attacks, if you're the defending player": one attacker, nothing else on the event
      // edh-combat-5 (CR 508.1, 603.2c; Merry, Esquire of Rohan): "whenever you attack with ~ and another legendary creature": the source's own attack, with another declared attacker
      // edh-c-83 (CR 508.1, 603.2c; Mob Mentality): "Whenever all non-Wall creatures you control attack": one batch of your attackers in which every creature of the description attacks
      if (ev.allAttack !== undefined) {
        if (JSON.stringify(ev.attacker) !== '{"controller":"you"}' || ev.count?.op !== '>=' || ev.count.value !== 1 || Object.keys(ev).some((k) => k !== 'ev' && k !== 'attacker' && k !== 'count' && k !== 'allAttack')
          || tense !== 'present' || o.batch !== true || o.wholeBatch === true) throw new NoRenderer('an all-attack event other than "all <creatures> you control attack"');
        return { subject: '', predicate: `all ${K.np(ev.allAttack, st, { det: 'none', plural: true })} attack`, plural: true };
      }
      if (ev.withOther !== undefined) {
        if (ev.attacker === undefined || !isSelfOnly(ev.attacker) || Object.keys(ev).some((k) => k !== 'ev' && k !== 'attacker' && k !== 'withOther') || tense !== 'present' || o.batch === true || o.wholeBatch === true) {
          throw new NoRenderer('another declared attacker other than "you attack with ~ and another <creature>"');
        }
        // edh-c-71 (CR 508.1, 603.2c; Paired Tactician, family attack-with-source-and-another): the same event said "~ and at least one other Warrior attack"
        const other = K.np(ev.withOther, st, { det: 'none' });
        // edh-next-76 (Goldbug, Humanity's Ally): and "~ and at least one Human attack" when Oracle leaves out "other" (the source is not of that description)
        return { subject: '', predicate: alt(`you attack with ~ and another ${other}`, `~ and at least one other ${other} attack`, `~ and at least one ${other} attack`), plural: true };
      }
      // edh-players-20 (CR 506.2, 508.1b, 603.2c; Karazikar, the Eye Tyrant): "an opponent attacks another one of your opponents" (parser/holes/event.ts#opponentsAttacked)
      if (ev.otherThanAttacker !== undefined) {
        if (JSON.stringify(ev.attacker) !== '{"types":["Creature"],"controller":"opponent"}' || ev.defender !== 'opponent' || ev.count?.op !== '>=' || ev.count.value !== 1 || ev.orPlaneswalker !== undefined
          || ev.alone !== undefined || ev.power !== undefined || ev.defending !== undefined || ev.withOther !== undefined || tense !== 'present' || o.batch !== true || o.wholeBatch === true) {
          throw new NoRenderer('an attack on another player other than "an opponent attacks another one of your opponents"');
        }
        st.mentioned.add('e:attacker');
        return { subject: '', predicate: 'an opponent attacks another one of your opponents', plural: true };
      }
      // edh-d-4 (CR 506.3, 508.1b, 603.2c; Oath of Kaya, parser/holes/event.ts#attackPlayerOrWalker): "an opponent attacks a planeswalker you control [with one or more creatures]", one occurrence for each planeswalker
      if (ev.defending === 'you' && ev.defender === 'planeswalker') {
        if (JSON.stringify(ev.attacker) !== '{"types":["Creature"],"controller":"opponent"}' || ev.count?.op !== '>=' || ev.count.value !== 1 || ev.orPlaneswalker !== undefined || ev.alone !== undefined || ev.power !== undefined
          || ev.withOther !== undefined || tense !== 'present' || o.batch !== true) throw new NoRenderer('an attack on a planeswalker you control other than "an opponent attacks a planeswalker you control"');
        st.mentioned.add('e:attacker');
        // edhn115 (Mila, Crafty Companion; family opponent-attacks-walkers-once): the declaration as ONE occurrence (wholeBatch) is "attacks one or more planeswalkers you control"
        if (o.wholeBatch === true) return { subject: '', predicate: 'an opponent attacks one or more planeswalkers you control', plural: true };
        return { subject: '', predicate: 'an opponent attacks a planeswalker you control with 1 or more creatures', plural: true };
      }
      if (ev.defending !== undefined) {
        const { defending, ...rest } = ev;
        if (defending !== 'you' || rest.defender !== undefined || rest.orPlaneswalker !== undefined || rest.count !== undefined || rest.alone !== undefined || rest.power !== undefined
          || o.batch === true || o.wholeBatch === true) throw new NoRenderer('a defending-player attack condition other than "attacks, if you\'re the defending player" of one attacker');
        const plain = eventParts(rest, st, tense, o);
        return { ...plain, predicate: `${plain.predicate}, if you're the defending player` };
      }
      // FAST5X E3 (CR 702.171b, 508.1): "~ attacks while saddled": the source attacks with the saddled designation (the attacker filter is read as it attacks)
      if (ev.attacker && ev.attacker.self === true && ev.attacker.saddled === true && onlyKeys(ev.attacker, 'self', 'saddled') && !ev.count && !o.batch) {
        const plain = eventParts({ ...ev, attacker: { self: true } }, st, tense, o);
        return { ...plain, predicate: `${plain.predicate} while saddled` };
      }
      // edh-players-11 (CR 508.1, 903.3d-e, 603.2c; parser/holes/event.ts#youAttack, Ainok Strike Leader): the source or a commander you own among your attackers, once for the declaration
      if (ev.count?.op === '>=' && ev.count.value === 1 && ev.attacker?.controller === 'you' && Object.keys(ev.attacker).length === 2 && JSON.stringify(ev.attacker.anyOf) === '[{"self":true},{"commander":true,"owner":"you"}]'
        && ev.defender === undefined && ev.orPlaneswalker === undefined && o.wholeBatch !== true && tense === 'present' && o.batch === true) {
        return { subject: '', predicate: 'you attack with ~ and/or your commander', plural: true };
      }
      const subj = ev.attacker ? subjectOf(ev.attacker, st, o) : o.batch ? { text: 'one or more creatures', plural: true } : { text: 'a creature', plural: false };
      st.mentioned.add('e:attacker');
      const def = ev.defender;
      // M12-3 (CR 506.3, 508.1b): "attacks you or a planeswalker you control"
      // pc-combat-1 (CR 506.3, 508.1b; Gahiji, Honored One and Frontier Warmonger): "attacks one of your opponents or a planeswalker an opponent controls" (also "they control"), of one
      // attacker or the batch of "one or more creatures attack ..."
      const oppOrWalker = ev.orPlaneswalker === true && def === 'opponent' && ev.count === undefined && ev.alone === undefined;
      // edh-zones-14 (CR 508.1b, 506.3, 603.2c; Cunning Rhetoric): the declaration of an opponent that attacks you and/or planeswalkers you control, once (parser/holes/event.ts#opponentAttacksYou)
      if (ev.orPlaneswalker === true && def === 'you' && ev.attacker?.controller === 'opponent' && JSON.stringify(ev.attacker.types) === '["Creature"]' && Object.keys(ev.attacker).length === 2
        && ev.count?.op === '>=' && ev.count.value === 1 && o.batch === true && tense === 'present' && ev.alone === undefined) {
        // edh-next-53 (Ever-Watching Threshold; family opponent-attacks-you-intervening-if): or the declaration said first, with the attack on you the intervening "if" (CR 603.4)
        return { subject: '', predicate: alt('an opponent attacks you and/or one or more planeswalkers you control', 'an opponent attacks, if they attacked you and/or a planeswalker you control'), plural: true };
      }
      // edh-d-4 (CR 506.3, 508.1b; Rigo, Streetwise Mentor): "you attack a player or planeswalker [with one or more creatures ...]", the attackers of the declaration at each player or planeswalker attacked
      const anyOrWalker = ev.orPlaneswalker === true && def === 'any' && ev.attacker?.controller === 'you' && ev.count?.op === '>=' && ev.count.value === 1 && ev.alone === undefined && ev.power === undefined && ev.defending === undefined
        && ev.withOther === undefined && o.batch === true && o.wholeBatch !== true && tense === 'present';
      if (ev.orPlaneswalker === true && !oppOrWalker && !anyOrWalker && (def !== 'you' || ev.count !== undefined || o.batch === true)) throw new NoRenderer('orPlaneswalker other than "you or a planeswalker you control" of one attacker');
      const orPw = ev.orPlaneswalker === true && !oppOrWalker && !anyOrWalker ? ' or a planeswalker you control' : '';
      // r5-refs (CR 508.1b; family attacks-one-of-your-opponents): Oracle also calls the opponent attacked "one of your opponents"
      const defender = def === undefined ? '' : def === 'planeswalker' ? ' a planeswalker' : def === 'battle' ? ' a battle' : anyOrWalker ? ' a player or planeswalker' : oppOrWalker ? alt(' one of your opponents or a planeswalker an opponent controls', ' one of your opponents or a planeswalker they control') : def === 'opponent' && !orPw ? alt(' an opponent', ' one of your opponents')
        : ` ${K.player(def, st, 'object').text}${orPw}`;
      // CLOUD std-tmt (CR 506.2, 603.2c; family opponents-are-attacked): "one or more of your opponents are attacked", one occurrence for the declaration
      // (TriggerDef.wholeBatch); "one or more creatures attack an opponent" is one for each opponent attacked (std-tla), so the two are no longer one reading
      if (o.wholeBatch === true) {
        // edh-next-127 (CR 603.2c, 508.1b; Zurzoth, Chaos Rider): "one or more Devils you control attack one or more players", once for the whole declaration (parser/holes/event.ts)
        if (o.batch === true && tense === 'present' && def === 'any' && ev.orPlaneswalker !== true && !ev.count && ev.alone === undefined && ev.power === undefined && ev.defending === undefined
          && ev.withOther === undefined && ev.allAttack === undefined && ev.otherThanAttacker === undefined && ev.attacker !== undefined && ev.attacker.self !== true) {
          return { subject: K.np(ev.attacker, st, { det: 'none', plural: true, count: 'one or more' }), predicate: 'attack one or more players', plural: true };
        }
        if (!(o.batch && tense === 'present' && def === 'opponent' && ev.orPlaneswalker !== true && !ev.count && ev.alone === undefined && ev.attacker !== undefined && onlyKeys(ev.attacker, 'types') && ev.attacker.types?.length === 1 && ev.attacker.types[0] === 'Creature')) {
          throw new NoRenderer('the players of an attack counted together other than "one or more of your opponents are attacked"');
        }
        // edh-combat-2 (family opponents-are-attacked): and from the attacker's side, "a player attacks one or more of your opponents" (Jolene, the Plunder Queen)
        return { subject: '', predicate: alt('one or more of your opponents are attacked', 'a player attacks one or more of your opponents'), plural: true };
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
        // edh-d-24 (CR 508.1, 508.3a, 303.4, 301.5; Glimmer Lens): the enchanted or equipped creature is one of two or more attackers declared together
        if (a && Object.keys(a).join() === 'attachedToSource' && a.attachedToSource === true && ev.count.op === '>=' && typeof ev.count.value === 'number' && ev.count.value >= 2 && tense === 'present' && !defender) {
          const others = ev.count.value - 1;
          return { subject: '', predicate: `${K.obj({ ref: 'attachedTo' }, st, 'subject').text} and at least ${K.qty(others, st)} other ${others === 1 ? 'creature' : 'creatures'} attack`, plural: true };
        }
        const plain = { subject: `${cw} ${kind}`, predicate: `${verb(['attacks', 'attack', 'attacked'], tense, true)}${defender}`, plural: true };
        // FAST1 T4, CR 508.3c-d: "whenever you attack" (one or more creatures you control are declared as attackers) and "whenever you attack with N or more
        // creatures": the attackers of a declaration are all the active player's (CR 508.1a), so the count is of the creatures that player attacks with
        // std-tla (CR 508.1b): ... and "whenever you attack a player [with one or more ...]", the creatures attacking a player (parser/holes/event.ts#youAttack)
        const toPlayer = def !== undefined && def !== 'planeswalker' && def !== 'battle' && (ev.orPlaneswalker !== true || anyOrWalker) && typeof ev.count.value === 'number' && ev.count.value === 1;
        // edh-c-101 (CR 508.1, 603.2c; Alluring Suitor): "when you attack with exactly two creatures" (parser/holes/event.ts#youAttack): the declaration's attackers number exactly N
        const exactly = ev.count.op === '==' && !defender && typeof ev.count.value === 'number' && ev.count.value >= 2;
        if (a && a.controller === 'you' && tense === 'present' && (!defender || toPlayer) && (ev.count.op === '>=' || exactly)) {
          const rest: ObjectFilter = { ...a, controller: undefined };
          const bare = Object.values(rest).every((v) => v === undefined);
          const one = typeof ev.count.value === 'number' && ev.count.value === 1;
          if (exactly) return { subject: '', predicate: `you attack with exactly ${cw} ${bare ? 'creatures' : K.np(rest, st, { det: 'none', plural: true })}`, plural: true };
          const forms = [`${cw} ${kind} attack${defender}`];
          if (bare && one) forms.push(`you attack${defender}`);
          // CMD2 (CR 508.1, 903.3d-e): "whenever you attack with your commander" (parser/holes/event.ts#youAttack): a commander you own among your attackers
          const yourCommander = rest.commander === true && rest.owner === 'you' && Object.entries(rest).every(([k, v]) => v === undefined || k === 'commander' || k === 'owner');
          if (yourCommander && one && !defender) forms.push('you attack with your commander');
          if (!bare || !one) forms.push(`you attack${defender} with ${cw} ${bare ? 'creatures' : K.np(rest, st, { det: 'none', plural: true })}`);
          // edh-next-92 (family attack-with-at-least-n; Path of Mettle): "at least two" is "two or more"
          if ((!bare || !one) && ev.count.op === '>=' && typeof ev.count.value === 'number' && ev.count.value >= 2) forms.push(`you attack${defender} with at least ${n} ${bare ? 'creatures' : K.np(rest, st, { det: 'none', plural: true })}`);
          return { subject: '', predicate: alt(...forms), plural: true };
        }
        // std-mkm (CR 508.1a, 603.2c): "whenever a player attacks with three or more creatures", "whenever an opponent attacks with ..." (the active player's
        // declaration; parser/holes/event.ts#playerAttacksWith)
        // pc-combat-1 (CR 508.1b, 303.4; the Curses): ... and the attackers' player attacking enchanted player, "whenever a player attacks enchanted player with one or more creatures"
        const enchantedDef = typeof def === 'object' && (def as { ref?: string }).ref === 'enchantedPlayer' && a?.controller === undefined;
        // pc-combat-3 (CR 508.1a-b, 603.2c; Lulu, Stern Guardian, Everett K. Ross): "whenever an opponent attacks you [with two or more creatures]" (parser/holes/event.ts#opponentAttacksYou)
        const oppAttacksYou = def === 'you' && ev.orPlaneswalker !== true && a?.controller === 'opponent' && o.batch === true;
        if (a && (a.controller === undefined || a.controller === 'opponent') && tense === 'present' && ((!defender || enchantedDef) || oppAttacksYou) && ev.count.op === '>=') {
          const rest: ObjectFilter = { ...a, controller: undefined };
          if (Object.values(rest).some((v) => v !== undefined)) {
            const who = a.controller === 'opponent' ? 'an opponent' : 'a player';
            // std-combat-1 (CR 508.1a, 603.2c; family attacks-with-creatures): one or more creatures of a declaration, "whenever an opponent attacks with creatures"
            const bare = ev.count.value === 1 && Object.keys(rest).every((k) => (rest as Record<string, unknown>)[k] === undefined || k === 'types') && JSON.stringify(rest.types) === '["Creature"]';
            if (enchantedDef) return { subject: '', predicate: alt(`${cw} ${kind} attack${defender}`, `a player attacks${defender} with ${cw} ${K.np(rest, st, { det: 'none', plural: true })}`, ...(bare ? ['enchanted player is attacked'] : [])), plural: true };
            if (oppAttacksYou) {
              const bareOne = ev.count.value === 1 && JSON.stringify(rest.types) === '["Creature"]' && Object.keys(rest).every((k) => (rest as Record<string, unknown>)[k] === undefined || k === 'types');
              return { subject: '', predicate: alt(`${cw} ${kind} attack you`, `an opponent attacks you with ${cw} ${K.np(rest, st, { det: 'none', plural: true })}`, `a player attacks you with ${cw} ${K.np(rest, st, { det: 'none', plural: true })}` /* edh-d-70 (Struggle for Project Purity) */, ...(bareOne ? ['an opponent attacks you', 'a player attacks you'] : [])), plural: true };
            }
            return { subject: '', predicate: alt(`${cw} ${kind} attack`, `${who} attacks with ${cw} ${K.np(rest, st, { det: 'none', plural: true })}`, ...(a.controller === 'opponent' ? [`another player attacks with ${cw} ${K.np(rest, st, { det: 'none', plural: true })}`] /* edh-combat-6 (Firemane Commando) */ : []), ...(bare ? [`${who} attacks with creatures`, `${who} attacks`] : [])), plural: true }; // edh-combat-4 (CR 508.1a): a player attacks when they declare attackers (Avatar Roku)
          }
        }
        // edh-combat-4 (CR 508.3e, 603.2c; family player-attacks-one-of-your-opponents): one occurrence for each opponent attacked, said from the attacker's side
        if (a && a.controller === undefined && onlyKeys(a, 'types') && a.types?.length === 1 && a.types[0] === 'Creature' && def === 'opponent' && ev.orPlaneswalker !== true && ev.alone === undefined
          && tense === 'present' && o.batch === true && ev.count.op === '>=' && ev.count.value === 1) {
          return { subject: '', predicate: alt('1 or more creatures attack an opponent', '1 or more creatures attack one of your opponents', 'a player attacks one of your opponents'), plural: true };
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
      // pc-combat-4 (CR 509.1h, 508.1b; Coveted Jewel): "one or more creatures an opponent controls attack you and aren't blocked", the unblocked attackers of a player
      // edh-combat-6 (CR 509.1h, 508.1b; Master of Cruelties): "~ attacks a player and isn't blocked": a player is attacked, never a planeswalker or battle
      if (ev.defender === 'any') {
        if (tense !== 'present' || o.batch || ev.attacker === undefined || ev.attacker.self !== true) throw new NoRenderer('"attacks a player and isn\'t blocked" other than of the source itself, in the present tense');
        const sb = subjectOf(ev.attacker, st, o);
        return { subject: sb.text, predicate: "attacks a player and isn't blocked", plural: false };
      }
      if (ev.defender !== undefined) {
        if (tense !== 'present' || typeof ev.defender !== 'string') throw new NoRenderer('"attack <player> and aren\'t blocked" other than present tense and a named player');
        const who = K.player(ev.defender, st, 'object').text;
        const sb = ev.attacker ? subjectOf(ev.attacker, st, o) : o.batch ? { text: 'one or more creatures', plural: true } : { text: 'a creature', plural: false };
        // "creatures an opponent controls" is also said "creatures your opponents control" (family attacks-one-of-your-opponents' sibling: the same set)
        const subjText = ev.attacker?.controller === 'opponent' && sb.plural ? alt(sb.text, sb.text.replace('your opponents control', 'an opponent controls')) : sb.text;
        return sb.plural ? { subject: subjText, predicate: `attack ${who} and aren't blocked`, plural: true } : { subject: sb.text, predicate: `attacks ${who} and isn't blocked`, plural: false };
      }
      if (tense !== 'present' || o.batch) throw new NoRenderer('"attacks and isn\'t blocked" in another tense or as a batch');
      const subj = ev.attacker ? subjectOf(ev.attacker, st, o) : { text: 'a creature', plural: false };
      if (subj.plural) throw new NoRenderer('"attack and aren\'t blocked" of several creatures');
      return { subject: subj.text, predicate: "attacks and isn't blocked", plural: false };
    }
    case 'becomesBlocked': {
      const subj = ev.attacker ? subjectOf(ev.attacker, st, o) : o.batch ? { text: 'one or more creatures', plural: true } : { text: 'a creature', plural: false };
      const by = ev.by ? ` by ${ev.byAtLeast !== undefined ? K.np(ev.by, st, { det: 'none', plural: true, count: `${K.qty(ev.byAtLeast, st)} or more` }) /* edh-c-48 (CR 509.3e) */ : K.np(ev.by, st, { det: 'a' })}` : '';
      const be = tense === 'past' ? 'became' : tense === 'would' ? 'would become' : subj.plural ? 'become' : 'becomes';
      return { subject: subj.text, predicate: `${be} blocked${by}`, plural: subj.plural };
    }
    case 'damage': {
      // FAST4 T27 (CR 120.2a-b): `combat: false` is noncombat damage ("whenever an opponent is dealt noncombat damage")
      // FAST5X E16 (CR 120.10): "is dealt excess [noncombat] damage" (a recipient worded alone; any other form has no wording)
      const combat = `${ev.excess === true ? 'excess ' : ''}${ev.combat === true ? 'combat ' : ev.combat === false ? 'noncombat ' : ''}`;
      if (ev.excess === true && (ev.source !== undefined || ev.amount !== undefined || ev.recipient?.object === undefined || ev.recipient.player !== undefined)) throw new NoRenderer('excess damage with a source, an amount or a player');
      const amount = ev.amount ? `${ev.amount.op === '>=' ? `${K.qty(ev.amount.value, st)} or more` : ev.amount.op === '==' && ev.source !== undefined && ev.recipient !== undefined /* edh-replace-7: "deals exactly 1 damage to ..." */ ? `exactly ${K.qty(ev.amount.value, st)}` : K.qty(ev.amount.value, st)} ` : '';
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
        // edhd63 (CR 603.2, 120.2, 607.2d; Sower of Discord): damage dealt to either of the two players "choose two players" chose
        if (tense === 'present' && r.object === undefined && typeof r.player === 'object' && r.player.ref === 'linked' && r.player.link === 'chosenPlayers' && ev.combat === undefined && ev.amount === undefined && ev.excess !== true) return { subject: '', predicate: 'damage is dealt to one of the chosen players', plural: false };
        // Standard round 4, r4-trig (CR 120.2): "you're dealt combat damage" ("you" takes "are", parser/holes/event.ts)
        // edh-next-91 (CR 120.2, 603.2; Risona, Asari Commander): the damage dealt to the controller is also said of the damage: "Whenever combat damage is dealt to you" (family damage-dealt-to-you)
        if (tense === 'present' && rtext === 'you' && amount === '' && ev.excess !== true && ev.combat !== false) return { subject: '', predicate: alt(`you are dealt ${combat}damage`, `${combat}damage is dealt to you`), plural: false };
        return { subject: rtext, predicate: `${passive(`dealt ${amount}${combat}damage`, tense, rtext === 'you')}`, plural: false }; // std-mkm: "is dealt 3 or more damage" (CR 120.2)
      }
      // p2-replace-damage-2 (CR 120.3, 614.1a): a replacement of the damage of every source may also say "any source" (Equal Treatment; family any-source)
      const subj1 = ev.source ? subjectOf(ev.source, st, o) : { text: tense === 'would' ? alt('a source', 'any source') : 'a source', plural: false };
      // edh-mana-keywords-4 (CR 120.3, 603.2; Phyrexian Obliterator): a damage trigger with no description of the source ("Whenever a source deals damage to ~") matches the damage of
      // every source (a permanent, a spell, ...: roleMatches ignores the zone), which Oracle names "a source" (family any-source-deals)
      const noDescription = ev.source !== undefined && !o.batch && tense !== 'would' && ev.sourcePermanent !== true && Object.values(ev.source).every((v) => v === undefined);
      const subj0 = noDescription ? { text: alt(subj1.text, 'a source'), plural: subj1.plural } : subj1;
      // M6-10 (CR 120.3, 609.7): a source of damage named by its color alone is "a red source" ("If a red source would deal damage to a player", Tok-Tok)
      // FAST5 T40 (CR 120.3, 609.7): also by who controls it alone ("a source you control", Rollercrusher Ride), or by that and a chosen quality
      const keys = ev.source !== undefined ? Object.keys(ev.source).filter((k) => (ev.source as Record<string, unknown>)[k] !== undefined) : [];
      // std-blb (CR 105.2, 120.3): or by its color and who controls it ("a red source you control", Torbran)
      const colorOnly = ev.source !== undefined && !o.batch
        && ((keys.length === 1 && (ev.source.colors?.length ?? 0) > 0)
          // edh-c-67 (CR 105.2, 120.3, 607.2d; Circle of Affliction): "a source of the chosen color" (the color a linked choice made)
          || (keys.length === 1 && keys[0] === 'chosen' && ev.source.chosen?.quality === 'color') || (keys.includes('controller') && keys.every((k) => k === 'controller' || k === 'chosen'))
          || (keys.length === 2 && keys.includes('controller') && keys.includes('colors') && (ev.source.colors?.length ?? 0) > 0));
      // p2-replace-damage-2 (CR 120.3, 609.7): any description of the source, said with "source" as its noun ("another red source you control", "an instant or
      // sorcery source you control"; family described-source): the objects of that description, wherever they are, as the parser's Filter head "source" reads it
      // edh-replace-7 (CR 120.3, 609.7; Ghyrson Starn, Kelermorph): in a trigger too, "another source you control" (a source other than the ability's own, whose controller is named)
      const anotherSourceYouControl = !colorOnly && ev.source !== undefined && !o.batch && tense === 'present' && keys.length === 2 && keys.includes('controller') && keys.includes('other') && ev.source.other === true && ev.source.controller === 'you';
      // edh-c-68 (CR 120.1, 120.3, 205.4; Tamanoa; family noncreature-source-deals): in a trigger too a source that is not of a card type, "a noncreature source you control deals damage"
      // (any object, permanent or spell, that is not a creature)
      const notTypeSource = ev.source !== undefined && !o.batch && tense === 'present' && keys.includes('controller') && keys.every((k) => k === 'controller' || k === 'notTypes') && (ev.source.notTypes?.length ?? 0) === 1;
      const described = !colorOnly && ev.source !== undefined && !o.batch && (tense === 'would' || anotherSourceYouControl || notTypeSource) && isDescribedSource(ev.source);
      // edh-replace-1 (CR 614.1a, 120.3; Inquisitor's Flail): a creature other than the creature the Equipment is attached to is "another creature" in a replacement of the damage it would deal
      const anotherThanAttached = tense === 'would' && ev.source !== undefined && JSON.stringify(ev.source) === '{"types":["Creature"],"not":{"attachedToSource":true}}';
      const subj = anotherThanAttached ? { text: alt(subj0.text, 'another creature'), plural: false } : colorOnly || described ? { text: alt(subj0.text, K.np(ev.source!, st, { det: 'a', head: 'source' })), plural: false } : subj0;
      st.mentioned.add('e:source');
      // FAST1 T4: a named source dealing damage to a recipient with both parts deals it to either of them (triggers/match.ts, CR 120.1): "to a player or planeswalker"
      // FAST5 T69 (CR 120.1, 614.1a): a replacement of damage "that would be dealt to that player or a permanent that player controls" names both parts, the object with its article
      // std-blb (CR 120.1, 614.1a): and a named source's damage that would be dealt "to an opponent or a permanent an opponent controls" (Torbran, Artist's Talent;
      // CLOUD std-msh and CLOUD std-dft made the same change: Hawkeye, Young Avenger; Far Fortune, End Boss)
      const both = tense === 'present' && ev.source && r && r.object !== undefined && r.player !== undefined ? alt(`${K.player(r.player, st, 'object').text} or ${K.np(r.object, st, { det: 'none' })}`, `${K.player(r.player, st, 'object').text} or ${K.np(r.object, st, { det: 'a' })}` /* edh-players-23 (CR 120.1; Elesh Norn): "to you or a permanent you control" */)
        : tense === 'would' && r && r.object !== undefined && r.player !== undefined ? ((): string => {
          const pl = K.player(r.player, st, 'object').text;
          const base = `${pl} or ${K.np(r.object, st, { det: 'a' })}`;
          // edh-c-1 (CR 120.1, 614.1a; family damage-recipient-list; Invasion of Regatha): two permanent types and an opponent, "to a creature, battle, or opponent"
          if (r.player === 'opponent' && Object.keys(r.object).length === 1 && r.object.types?.length === 2) {
            const [t1, t2] = r.object.types.map((t) => t.toLowerCase());
            return alt(base, `${withArticle(t1!)}, ${t2}, or opponent`, `${withArticle(t2!)}, ${t1}, or opponent`); // (the order of the types is the model's canonical one, Oracle's is not)
          }
          // edh-b-10 (CR 120.1, 310.1; Rankle and Torbran): "to a player or battle"
          if (r.player === 'any' && Object.keys(r.object).length === 1 && r.object.types?.length === 1 && r.object.types[0] === 'Battle') return alt(base, 'a player or battle');
          // edh-next-2 (CR 120.1, 614.1a; Sawhorn Nemesis): of a chosen player Oracle says "to the chosen player or a permanent they control"
          return typeof r.player === 'object' && Object.keys(r.object).length === 1 && JSON.stringify(r.object.controller) === JSON.stringify(r.player) ? alt(base, `${pl} or a permanent they control`) : base;
        })() : '';
      // edh-replace-7 (CR 120.1; Ghyrson Starn, Kelermorph): "a permanent or player": the object first with its article, then any player (family permanent-or-player)
      const permanentOrPlayer = tense === 'present' && ev.source && r && r.object !== undefined && (r.player === 'any' || r.player === 'opponent') ? `${K.np(r.object, st, { det: 'a' })} or ${r.player === 'any' ? 'player' : 'opponent'}` : ''; // edh-next-15: and "a creature or opponent" (Flesh Reaver)
      // edh-c-25 (CR 102.3, 120.1; family another-player-is-opponent; Night Dealings): in a game without teams a player other than you is an opponent, "deals damage to another player"
      const anotherPlayer = tense === 'present' && ev.source !== undefined && r !== undefined && r.player === 'opponent' && r.object === undefined && !both && !permanentOrPlayer ? alt(rtext, 'another player') : rtext;
      const to = permanentOrPlayer ? alt(both, permanentOrPlayer) : both || anotherPlayer;
      // M6-10 (CR 120.1, 614.1a): damage that would be dealt to anything is damage "to a permanent or player" (Furnace of Rath)
      let toText = to ? ` to ${to}` : tense === 'would' && !r ? alt('', ' to a permanent or player') : '';
      // edh-d-93 (CR 120.1, 603.2c; The Red Terror; family deals-damage-to-permanents-and-or-players): a source's damage with no recipient named is damage to whatever it was dealt to, and one
      // occurrence for each source of one instruction's (or combat's) damage (triggers/occurrences.ts#occurrences): "deals damage to one or more permanents and/or players" says the same
      if (tense === 'present' && !r && ev.source !== undefined && !o.batch && o.wholeBatch !== true && !subj.plural && combat === '' && amount === '' && ev.excess !== true && ev.toSourceTarget !== true) toText = alt('', ' to one or more permanents and/or players');
      if (o.wholeBatch === true && ev.source !== undefined && creaturesDealt) {
        if (!o.batch || tense !== 'present') throw new NoRenderer('"one or more creatures" dealt damage other than by a batch');
        toText = ' to one or more creatures';
      } else if (o.wholeBatch === true && ev.source !== undefined) {
        if (!o.batch || tense !== 'present' || (r?.player !== 'any' && r?.player !== 'opponent') || r.object !== undefined) throw new NoRenderer('"one or more players" dealt damage other than by the creatures of a batch');
        toText = r.player === 'any' ? ' to one or more players' : alt(' to your opponents', ' to one or more of your opponents'); // edh-players-18: family to-one-or-more-of-your-opponents
      }
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
      // edh-d-87 (CR 603.2c, 603.4, 120.2; Mindblade Render; family your-opponents-dealt-damage-by): the combat damage a batch of sources of a description deals to opponents, one trigger
      // for the batch, is also said from the opponents' side with the source as a condition: "your opponents are dealt combat damage, if any of that damage was dealt by a Warrior"
      // (parser/holes/event.ts#opponentsDealtDamage: the same pattern and batch)
      const byAny = o.batch && o.wholeBatch === true && tense === 'present' && subj.plural && ev.source !== undefined && !isSelfOnly(ev.source) && ev.combat === true && ev.amount === undefined
        && ev.excess !== true && ev.sourcePermanent !== true && r?.player === 'opponent' && r.object === undefined
        ? `your opponents are dealt combat damage, if any of that damage was dealt by ${K.np(ev.source, cloneState(st), { det: 'a' })}` : undefined;
      if (o.batch && tense === 'present' && subj.plural && ev.source !== undefined && !isSelfOnly(ev.source)) {
        let each: string | null = null;
        try {
          each = K.np(ev.source, cloneState(st), { count: 'one or more', plural: true, det: 'none', eachWithSingular: true });
        } catch (e) {
          if (!(e instanceof NoRenderer)) throw e;
        }
        if (each !== null) return { subject: '', predicate: alt(`${subj.text} ${deals} ${amount}${combat}damage${toText}`, `${each} deals ${amount}${combat}damage${toText}`, ...(byAny !== undefined ? [byAny] : [])), plural: true };
      }
      // std-rx28 (CR 120.1, 208.1): "... to a creature equal to that creature's toughness" (parser/holes/event.ts#sourceDamage): one creature recipient named alone
      if (ev.amountIsToughness === true) {
        if (o.batch || ev.amount !== undefined || r?.object === undefined || r.player !== undefined || tense !== 'present') throw new NoRenderer('an amount equal to the toughness other than of one creature dealt damage');
        return { subject: subj.text, predicate: `${deals} ${combat}damage${toText} equal to that creature's toughness`, plural: subj.plural };
      }
      // edh-players-19 (CR 120.2, 603.2c; Lolth, Spider Queen's emblem): the combat damage of a batch of creatures to one player is also said from the player's side, "an opponent is dealt
      // combat damage by one or more creatures you control" (parser/holes/event.ts#playerPredicates; the same pattern and batch)
      if (o.batch && o.wholeBatch !== true && tense === 'present' && subj.plural && ev.source !== undefined && !isSelfOnly(ev.source) && ev.combat === true && ev.amount === undefined && r?.object === undefined && (r?.player === 'opponent' || r?.player === 'any') && !both) {
        return { subject: '', predicate: alt(`${subj.text} ${deals} ${amount}${combat}damage${toText}`, `${r.player === 'opponent' ? 'an opponent' : 'a player'} is dealt combat damage by ${subj.text}`), plural: false };
      }
      // edh-c-94 (CR 603.2c, 120.1, 120.2; family source-you-control-deals-to-opponents; Molten Lavamancer): the noncombat damage of the sources you control to one or more of your
      // opponents, one batch, is also worded from one source: "a source you control deals noncombat damage to one or more of your opponents"
      if (o.wholeBatch === true && o.batch === true && tense === 'present' && ev.source !== undefined && ev.combat === false && ev.amount === undefined && r?.player === 'opponent' && r.object === undefined
        && keys.length === 1 && keys[0] === 'controller' && ev.source.controller === 'you') {
        return { subject: '', predicate: alt(`${subj.text} ${deals} ${amount}${combat}damage${toText}`, `a source you control deals ${amount}${combat}damage to one or more of your opponents`), plural: false };
      }
      // edh-c-48 (CR 120.2, 603.2; Chandra's Phoenix): the damage a source deals to one player is also said from the player's side, "an opponent is dealt damage by a red instant or sorcery
      // spell you control or by a red planeswalker you control" (parser/holes/event.ts#playerPredicates; a source of either of two descriptions says "or by" before the second)
      if (!o.batch && tense === 'present' && ev.source !== undefined && ev.amount === undefined && ev.amountIsToughness !== true && ev.toSourceTarget !== true && ev.excess !== true && ev.sourcePermanent !== true
        && r?.player !== undefined && r.object === undefined && r.player !== 'you' && !isSelfOnly(ev.source) && (st.trigger ?? []).length <= 1) {
        const any = ev.source.anyOf;
        const by = any !== undefined && any.length === 2 && Object.keys(ev.source).filter((k) => (ev.source as Record<string, unknown>)[k] !== undefined).length === 1
          ? `${K.np(any[0]!, st, { det: 'a' })} or by ${K.np(any[1]!, st, { det: 'a' })}` : K.np(ev.source, st, { det: 'a' });
        return { subject: '', predicate: alt(`${subj.text} ${deals} ${amount}${combat}damage${toText}`, `${rtext} ${passive(`dealt ${amount}${combat}damage`, tense, false)} by ${by}`), plural: false };
      }
      // edh-d-12 (CR 120.2, 510.2, 603.2c; Pain Magnification; family dealt-n-by-a-single-source): the damage of one source (any, no description) to one player, with an amount, is also said from the
      // player's side, "an opponent is dealt 3 or more damage by a single source" (parser/holes/event.ts#playerPredicates; the pattern names both sides: one occurrence for each source)
      if (!o.batch && tense === 'present' && ev.source !== undefined && keys.length === 0 && ev.amount?.op === '>=' && ev.combat === undefined && ev.excess !== true && ev.sourcePermanent !== true && ev.toSourceTarget !== true
        && r?.player !== undefined && r.object === undefined && r.player !== 'you' && (st.trigger ?? []).length <= 1) {
        return { subject: '', predicate: alt(`${subj.text} ${deals} ${amount}${combat}damage${toText}`, `${rtext} ${passive(`dealt ${amount}${combat}damage`, tense, false)} by a single source`), plural: false };
      }
      if (byAny !== undefined) return { subject: '', predicate: alt(`${subj.text} ${deals} ${amount}${combat}damage${toText}`, byAny), plural: subj.plural };
      return { subject: subj.text, predicate: `${deals} ${amount}${combat}damage${toText}`, plural: subj.plural };
    }
    case 'step': {
      if (ev.step === 'endCombat') {
        // Standard round 5, r5-trig (CR 511.1): "at end of combat on your turn"; another player's end of combat has no wording here (it was printed as any player's)
        const on = ev.whose === undefined || ev.whose === 'any' ? '' : ev.whose === 'you' ? ' on your turn' : null;
        if (on === null) throw new NoRenderer('end of combat of another player\'s turn');
        // edh-d-34 (CR 500.8, 511.1; Zariel's emblem): `nth` 1 of your turn's end of combat is "the end of the first combat phase on your turn"
        if (ev.nth !== undefined) {
          if (ev.nth !== 1 || ev.whose !== 'you') throw new NoRenderer('an end of combat other than that of the first combat phase of your turn');
          return { subject: '', predicate: 'the end of the first combat phase on your turn', plural: false };
        }
        return { subject: '', predicate: `${alt('end of combat', 'the end of combat')}${on}`, plural: false };
      }
      const phrase = possessiveStep(ev.step, ev.whose, st, false, ev.nth); // FAST5X E17: "your second main phase" (CR 505.1b)
      // std-rk (CR 505.1a, 603.2; family each-of-your-steps): "at the beginning of each of your postcombat main phases" is every such step of your turns
      // edh-combat-7 (Shadow of the Second Sun): the same plural of an Aura's host player, "each of enchanted player's postcombat main phases" (same family, same alt site)
      const hostPlayer = typeof ev.whose === 'object' && ev.whose.ref === 'enchantedPlayer';
      const plural = (ev.whose === 'you' || (typeof ev.whose === 'object' && ev.whose.ref === 'you') || hostPlayer) && ev.nth === undefined ? EACH_OF_YOUR_STEPS[ev.step] : undefined;
      return { subject: '', predicate: plural !== undefined ? alt(`the beginning of ${phrase}`, `the beginning of each of ${hostPlayer ? "enchanted player's" : 'your'} ${plural}`) : `the beginning of ${phrase}`, plural: false };
    }
    case 'damagePrevented': {
      // edh-replace-3 (CR 615.13; Selfless Squire): "Whenever damage that would be dealt to you is prevented": the recipient only (no source), in the present tense
      if (ev.source !== undefined || ev.recipient === undefined || (ev.recipient.object !== undefined) === (ev.recipient.player !== undefined) || tense !== 'present' || o.batch === true) throw new NoRenderer('prevented damage in another form');
      const rtext = ev.recipient.player !== undefined ? K.player(ev.recipient.player, st, 'object').text : K.np(ev.recipient.object!, st, { det: 'a' });
      return { subject: '', predicate: `damage that would be dealt to ${rtext} is prevented`, plural: false };
    }
    case 'life': {
      // edh-zones-19 (CR 603.2c; parser/holes/event.ts#opponentsLoseLife): "one or more opponents lose life", the whole batch of the opponents' life lost or gained at once
      const opponentsGroup = alt('one or more opponents', 'one or more of your opponents');
      if (o.batch === true) {
        // edh-players-20 (CR 119.3, 603.2c; Ob Nixilis, Captive Kingpin): "one or more opponents each lose exactly 1 life", the total each opponent lost in the batch
        if (ev.totalAmount === true) {
          if (o.wholeBatch !== true || ev.player !== 'opponent' || ev.change !== 'loss' || ev.fromDamage !== undefined || tense !== 'present' || ev.amount?.op !== '==' || typeof ev.amount.value !== 'number') {
            throw new NoRenderer('a total of life changed other than "one or more opponents each lose exactly N life"');
          }
          st.mentioned.add('e:player');
          return { subject: opponentsGroup, predicate: `each lose exactly ${K.qty(ev.amount.value, st)} life`, plural: true };
        }
        if (o.wholeBatch !== true || ev.player !== 'opponent' || ev.amount !== undefined || ev.fromDamage !== undefined || tense !== 'present') throw new NoRenderer('"one or more" life changes other than of opponents, counted together');
        st.mentioned.add('e:player');
        return { subject: opponentsGroup, predicate: `${ev.change === 'gain' ? 'gain' : 'lose'} life`, plural: true };
      }
      if (ev.totalAmount === true) throw new NoRenderer('a total of life changed in a batch said of one event'); // edh-players-20
      if (ev.byController === true) {
        // edh-d-54 (CR 614.1a, 119.3; Rain of Gore): "If a spell or ability would cause its controller to gain life"
        if (ev.change !== 'gain' || ev.player !== undefined || ev.amount !== undefined || ev.fromDamage !== undefined || tense !== 'would') throw new NoRenderer('a controller\'s life gain in another form');
        st.mentioned.add('e:player');
        return { subject: 'a spell or ability', predicate: 'would cause its controller to gain life', plural: false };
      }
      // edh-d-86 (CR 614.1a, 119.3, 119.4; Enduring Angel): "If your life total would be reduced to 0 or less" (a loss or payment of life that would leave the life total at or below N)
      if (ev.toAtMost !== undefined) {
        if (ev.change !== 'loss' || ev.player !== 'you' || ev.amount !== undefined || ev.fromDamage !== undefined || ev.byController !== undefined || tense !== 'would' || !Number.isInteger(ev.toAtMost)) throw new NoRenderer('a life total reduced to N or less other than yours, said of what would happen');
        st.mentioned.add('e:player');
        return { subject: 'your life total', predicate: `would be reduced to ${ev.toAtMost} or less`, plural: false };
      }
      const p = playerSubject(ev.player ?? 'any', st);
      st.mentioned.add('e:player');
      const base = ev.change === 'gain' ? 'gain' : 'lose';
      const amount = ev.amount ? `${ev.amount.op === '>=' ? `${K.qty(ev.amount.value, st)} or more` : K.qty(ev.amount.value, st)} ` : '';
      return { subject: p.text, predicate: `${personVerb(base, ev.change === 'gain' ? 'gained' : 'lost', tense, p.person)} ${amount}life`, plural: false };
    }
    // edh-next-144 (CR 701.20a, 607.2; Keranos, God of Storms): "Whenever you reveal a land card this way" (the linked rule of the same object revealed it)
    case 'reveal': {
      if (ev.thisWay !== true || ev.card === undefined) throw new NoRenderer('a reveal event other than one of a described card this way');
      const p = playerSubject(ev.player ?? 'any', st);
      st.mentioned.add('e:player');
      return { subject: p.text, predicate: `${personVerb('reveal', 'revealed', tense, p.person)} ${K.np({ ...ev.card, zone: 'hand' }, st, { det: 'a', noZone: true })} this way`, plural: false };
    }
    case 'draw': {
      const p = playerSubject(ev.player ?? 'any', st);
      st.mentioned.add('e:player');
      const verbText = personVerb('draw', 'drew', tense, p.person);
      if (ev.nth !== undefined) return { subject: p.text, predicate: `${verbText} ${p.person === 'you' ? 'your' : 'their'} ${ordinal(ev.nth)} card ${p.person === 'you' ? alt('each turn', 'in a turn') /* edh-d-14 (family draw-nth-in-a-turn; Sneaky Snacker) */ : 'each turn'}`, plural: false };
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
      if (ev.untapStep === true && !o.batch && ev.what === 'untapped' && tense === 'present' && ev.by === undefined && isSelfOnly(ev.object)) {
        // edh-d-71 (CR 502.3, 603.2; The Ninth Doctor): "whenever ~ becomes untapped during your untap step": the object itself, untapped by the untap step's turn-based action (triggers/match.ts)
        const self = subjectOf(ev.object, st, o);
        return { subject: self.text, predicate: `${self.plural ? 'become' : 'becomes'} untapped during your untap step`, plural: self.plural };
      }
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
      if (ev.by !== undefined && ev.what !== 'targeted' && ev.what !== 'attached' && ev.what !== 'unattached' /* edh-perms-10 */) throw new NoRenderer(`becomes ${ev.what} by something`);
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
        // edh-c-69 (CR 115.1, 603.2; Dormant Gomazoa): "you become the target of a spell": the player target alone (parser/holes/event.ts)
        if (ev.what === 'targeted' && ev.player === 'you' && !o.batch && Object.keys(ev.object).length === 0 && ev.level === undefined) {
          const anyStack = ev.by !== undefined && Object.entries(ev.by).every(([k, v]) => v === undefined || k === 'controller');
          const by = ev.by ? K.np(ev.by, st, { det: 'a', ...(anyStack ? { head: 'spell or ability' } : {}) }) : 'a spell or ability';
          st.mentioned.add('e:subject');
          return { subject: 'you', predicate: `${tense === 'past' ? 'became' : tense === 'would' ? 'would become' : 'become'} the target of ${by}`, plural: false };
        }
        if (ev.what !== 'turnedFaceUp' || ev.player !== 'you' || o.batch || ev.by !== undefined || ev.level !== undefined) throw new NoRenderer('a "becomes" by a player other than "you turn ... face up"');
        const turn = tense === 'past' ? 'turned' : tense === 'would' ? 'would turn' : 'turn';
        return { subject: 'you', predicate: `${turn} ${K.np(ev.object, st, { det: 'a' })} face up`, plural: false };
      }
      const subj = subjectOf(ev.object, st, o);
      const pl = subj.plural;
      const becomes = tense === 'past' ? 'became' : tense === 'would' ? 'would become' : pl ? 'become' : 'becomes';
      switch (ev.what) {
        case 'tapped':
          // edh-players-20 (CR 508.1f, 603.4; Verity Circle): "becomes tapped, if it isn't being declared as an attacker" (parser/holes/event.ts)
          if (ev.notAsAttacker === true) {
            if (pl || tense !== 'present' || o.batch === true) throw new NoRenderer('a tap that is not the attack declaration\'s other than of one object, in the present');
            return { subject: subj.text, predicate: "becomes tapped, if it isn't being declared as an attacker", plural: false };
          }
          return { subject: subj.text, predicate: selfPairVerb(`${becomes} tapped`, ev.object, tense, pl, 'tapped'), plural: pl };
        case 'untapped': return { subject: subj.text, predicate: selfPairVerb(`${becomes} untapped`, ev.object, tense, pl, 'untapped'), plural: pl };
        case 'targeted': {
          // FAST1 T4: a source filter that says only who controls it is any spell or ability on the stack ("a spell or ability an opponent controls", CR 115.1)
          const anyStack = ev.by !== undefined && Object.entries(ev.by).every(([k, v]) => v === undefined || k === 'controller');
          const by = ev.by ? K.np(ev.by, st, { det: 'a', ...(anyStack ? { head: 'spell or ability' } : {}) }) : 'a spell or ability';
          return { subject: subj.text, predicate: `${becomes} the target of ${by}`, plural: pl };
        }
        case 'attached': return { subject: subj.text, predicate: `${becomes} attached to ${ev.by ? attachedToWithStat(ev, st) ?? K.np(ev.by, st, { det: 'a' }) : 'a permanent'}`, plural: pl }; // std-combat-1: attachedToWithStat
        case 'unattached': return { subject: subj.text, predicate: `${becomes} unattached${ev.by ? ` from ${K.np(ev.by, st, { det: 'a' })}` : ''}`, plural: pl }; // edh-perms-10: from what it left
        case 'transformed': {
          // M6-4 (family transforms-into-self): a trigger of the permanent itself sees it after the transform, with the face it transformed into up, the only face
          // the ability is on, so "~ transforms" there is "~ transforms into ~" (CR 701.27e, 603.2)
          // edh-next-76 (CR 701.27e): `into`, the description of what it transformed into ("transforms into a Phyrexian")
          if (ev.into !== undefined) {
            if (pl || tense !== 'present' || o.batch === true) throw new NoRenderer('a transform into a description other than of one object, in the present');
            return { subject: subj.text, predicate: `transforms into ${K.np(ev.into, st, { det: 'a' })}`, plural: false };
          }
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
        case 'phasedOut': return { subject: subj.text, predicate: verb(['phases out', 'phase out', 'phased out'], tense, pl), plural: pl }; // edh-d-39: CR 702.26b
        case 'phasedIn': return { subject: subj.text, predicate: verb(['phases in', 'phase in', 'phased in'], tense, pl), plural: pl }; // edh-d-39: CR 702.26c
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
      // edh-replace-5 (CR 107.14, 614.1a; Izzet Generatorium): "if you would get one or more {E}": the energy counters put on you (the counters of a player are "gotten")
      if (tense === 'would' && ev.change === 'put' && ev.kind === 'energy' && 'player' in ev.on && ev.on.player === 'you' && ev.atLeast === undefined && ev.by === undefined && ev.byEffect === undefined && o.batch !== true) {
        st.mentioned.add('e:player');
        return { subject: 'you', predicate: 'would get one or more {e}', plural: false };
      }
      // edh-c-63 (CR 107.14, 122.1, 603.2c; Territorial Gorger; parser/holes/event.ts#energyGotEvents): "whenever you get one or more {E}": the energy counters put on you, said as a player's
      // own gain (the counters of a player are "gotten", as in the would-form above)
      if (tense === 'present' && o.batch === true && ev.change === 'put' && ev.kind === 'energy' && 'player' in ev.on && ev.on.player === 'you' && ev.atLeast === undefined && ev.by === undefined && ev.byEffect === undefined) {
        st.mentioned.add('e:player');
        return { subject: 'you', predicate: 'get one or more {e}', plural: false };
      }
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
        // edhn63 (CR 122.6, 603.2c; Bold Plagiarist): "an opponent puts one or more counters on a creature they control" (triggers/match.ts byController)
        if (ev.by === 'opponent' && ev.byController === true && tense === 'present' && o.batch === true && o.wholeBatch !== true && ev.change === 'put' && ev.atLeast === undefined && ev.byEffect === undefined && !('player' in ev.on)) {
          st.mentioned.add('e:player');
          return { subject: 'an opponent', predicate: `puts one or more ${ev.kind ? `${ev.kind} ` : ''}counters on ${K.np(ev.on as ObjectFilter, st, { det: 'a' })} they control`, plural: false };
        }
        // edhd68 (CR 122.1, 702.62a, 603.2; Watcher of Hours; parser/holes/event.ts#youRemoveTimeCounter): "you remove a time counter from ~ while it's exiled"
        if (ev.by === 'you' && tense === 'present' && ev.change === 'removed' && !o.batch && ev.kind === 'time' && ev.atLeast === undefined && ev.byEffect === undefined && !('player' in ev.on) && ev.on.self === true && ev.on.zone === 'exile' && Object.keys(ev.on).length === 2) {
          st.mentioned.add('e:player');
          return { subject: 'you', predicate: `remove a time counter from ${K.obj({ ref: 'self' }, st, 'object').text} while it's exiled`, plural: false };
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
      // edhn81 (CR 113.6k, 702.62a; Aeon Chronicler): the card itself, in exile: "a time counter is removed from ~ while it's exiled" (parser/holes/event.ts#counterEvents)
      if (tense === 'present' && ev.change === 'removed' && !o.batch && !('player' in ev.on) && ev.on.self === true && ev.on.zone === 'exile' && Object.keys(ev.on).length === 2 && many === undefined) {
        return { subject: noun, predicate: `${passive(put, tense, pl)} from ${K.obj({ ref: 'self' }, st, 'object').text} while it's exiled`, plural: pl };
      }
      const target = 'player' in ev.on ? K.player((ev.on as { player: PlayerPred }).player, st, 'object').text : o.wholeBatch === true ? alt(`one or more ${K.np(ev.on as ObjectFilter, st, { det: 'none', plural: true })}`, K.np(ev.on as ObjectFilter, st, { det: 'none', plural: true })) /* edh-c-13: the whole batch; edhn63: also the bare plural */ : K.np(ev.on as ObjectFilter, st, { det: 'a' });
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
      // edh-next-55 (CR 706.2, 603.2c; Netherese Puzzle-Ward): "whenever you roll a die's highest natural result"
      if (ev.highest === true) {
        if (ev.result !== undefined) throw new NoRenderer("a die's highest natural result with a result also stated");
        return { subject: p.text, predicate: `${personVerb('roll', 'rolled', tense, p.person)} a die's highest natural result`, plural: false };
      }
      // edh-c-24 (CR 706.2, 603.2c): "whenever you roll a 2": the die's result named in place of "a die"
      // edhn115 (CR 706.2; Critical Hit): "whenever you roll a natural 20": the natural result named, never together with another reading of the result
      if (ev.natural !== undefined) {
        if (ev.result !== undefined || ev.highest !== undefined) throw new NoRenderer('a natural result with a result or the highest result also stated');
        return { subject: p.text, predicate: `${personVerb('roll', 'rolled', tense, p.person)} a natural ${ev.natural}`, plural: false };
      }
      if (ev.result?.op === '==' && typeof ev.result.value === 'number') return { subject: p.text, predicate: `${personVerb('roll', 'rolled', tense, p.person)} a ${ev.result.value}`, plural: false };
      const res = ev.result ? ` and the result is ${ev.result.op === '>=' ? `${K.qty(ev.result.value, st)} or more` : ev.result.op === '<=' ? `${K.qty(ev.result.value, st)} or less` : K.qty(ev.result.value, st)}` : '';
      // edh-next-55 (CR 706.2, 603.2c; Monoxa, Midway Manager): "whenever you roll a 3 or higher" is a roll of one die whose result is at least that number
      const verbRoll = personVerb('roll', 'rolled', tense, p.person);
      if (ev.result !== undefined && typeof ev.result.value === 'number' && (ev.result.op === '>=' || ev.result.op === '<=')) {
        return { subject: p.text, predicate: alt(`${verbRoll} a die${res}`, `${verbRoll} a ${ev.result.value} or ${ev.result.op === '>=' ? 'higher' : 'lower'}`), plural: false };
      }
      return { subject: p.text, predicate: `${verbRoll} a die${res}`, plural: false };
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
      // edhn78 (CR 714.2d; Historian's Boon): "Whenever the final chapter ability of a Saga you control triggers"
      if (ev.finalChapter === true) {
        if (ev.causedBy !== undefined || tense !== 'present' || o.batch === true || JSON.stringify(ev.of) !== JSON.stringify({ subtypes: ['Saga'], controller: 'you' })) throw new NoRenderer('a final chapter trigger other than the plain one of your Sagas');
        st.mentioned.add('e:subject');
        return { subject: 'the final chapter ability of a Saga you control', predicate: 'triggers', plural: false };
      }
      if ((ev.causedBy !== 'attacking' && ev.causedBy !== 'entering') || ev.of === undefined || tense !== 'present' || o.batch === true) throw new NoRenderer('a triggered ability triggering with no cause, another cause, or not in the present tense');
      st.mentioned.add('e:subject');
      // edh-next-74 (CR 603.6a; Aboleth Spawn): "a creature entering under an opponent's control causes ...": the object entering the battlefield under that player's control
      if (ev.causedBy === 'entering') {
        if (ev.of.controller !== 'opponent' || JSON.stringify(Object.keys(ev.of).sort()) !== '["controller","types"]' || JSON.stringify(ev.of.types) !== '["Creature"]') throw new NoRenderer('a triggered ability caused by entering of an object other than a creature under an opponent\'s control');
        return { subject: "a creature entering under an opponent's control", predicate: 'causes a triggered ability of that creature to trigger', plural: false };
      }
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
      // edh-next-19 (CR 102.2, 603.2; Sengir, the Dark Baron): an opponent is also "another player" (family another-player-loses-the-game)
      return { subject: ev.player === 'opponent' ? alt(p.text, 'another player') : p.text, predicate: `${personVerb('lose', 'lost', tense, p.person)} the game`, plural: false };
    }
    // edh-players-18 (CR 725.3; Palace Jailer): "until an opponent becomes the monarch", "whenever you become the monarch"
    case 'monarch': {
      const p = playerSubject(ev.player ?? 'any', st);
      st.mentioned.add('e:player');
      return { subject: p.text, predicate: `${personVerb('become', 'became', tense, p.person)} the monarch`, plural: false };
    }
    case 'state': {
      const said = K.cond(ev.cond, st);
      // edh-d-4 (CR 603.8; Last Laugh; family no-x-are-on-the-battlefield): "there are no creatures on the battlefield" is also "no creatures are on the battlefield"
      const none = /^there are no (.+) on the battlefield$/.exec(said);
      return { subject: '', predicate: none ? alt(said, `no ${none[1]} are on the battlefield`) : said, plural: false };
    }
    case 'beginTurn': {
      const t = turnOf(ev.whose ?? 'any', st);
      return { subject: '', predicate: ev.extra ? `an extra turn begins` : `${t} begins`.replace(/^your turn begins$/, 'your turn begins'), plural: false };
    }
    case 'resolves': {
      // edhn78 (CR 714.2d; Tom Bombadil): "Whenever the final chapter ability of a Saga you control resolves"
      if (ev.what.stackKind === 'finalChapterAbility') {
        if (JSON.stringify(ev.what) !== JSON.stringify({ stackKind: 'finalChapterAbility', controller: 'you' }) || tense !== 'present') throw new NoRenderer('a final chapter resolution other than the plain one of your Sagas');
        return { subject: 'the final chapter ability of a Saga you control', predicate: 'resolves', plural: false };
      }
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
  foretell: ['foretell', 'foretold', 'foretell'], // edh-d-73
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
  payLife: ['pay life', 'paid life', 'pay life'], // edh-next-109, CR 119.4: "whenever you pay life" (Font of Agonies)
  exert: ['exert', 'exerted', 'exert'], // std-ry8, CR 701.43a: "whenever you exert a creature" (the player who exerts is the subject)
  faceDilemma: ['face a dilemma', 'faced a dilemma', 'face a dilemma'], // trek-2 (CR 700.2): "whenever you face a dilemma"
};

/** Actions where the thing that does it is the subject ("a creature you control explores"). */
const SUBJECT_ACTIONS = new Set(['fight' /* edh-combat-6 */, 'evolve' /* edh-c-48 */, 'explore', 'connive', 'adapt', 'monstrosity', 'goad', 'detain', 'exert', 'suspect', 'bolster', 'support', 'fabricate', 'amass', 'transform', 'regenerate']);

function actionParts(ev: Extract<EventPattern, { ev: 'action' }>, st: RenderState, tense: Tense, o: EventOpts): Parts {
  const verbWord = ev.verb;
  if (verbWord === 'ringTempts') return ringTemptsParts(ev, tense, o);
  if (verbWord === 'votesFinished') return votesFinishedParts(ev, tense, o);
  if (ev.n !== undefined || verbWord === 'expend') return expendParts(ev, st, tense, o);
  if (verbWord === 'tap' && ev.actor !== undefined) return tapActionParts(ev, st, tense, o);
  if (verbWord === 'exploit') return exploitParts(ev, st, tense, o);
  if (verbWord === 'payCumulativeUpkeep' || verbWord === 'failCumulativeUpkeep') return cumulativeUpkeepParts(ev, st, tense, o); // edh-d-74 (CR 702.24a)
  if (verbWord === 'enlist') { // edh-c-49 (CR 702.154a): "~ enlists a creature"
    if (ev.object === undefined || ev.actor !== undefined || tense !== 'present' || o.batch) throw new NoRenderer('an enlist without its creature, with an actor, or not in the present tense');
    const s = subjectOf(ev.object, st, o);
    return { subject: s.text, predicate: `${s.plural ? 'enlist' : 'enlists'} a creature`, plural: s.plural };
  }
  if (verbWord === 'clash') return clashParts(ev, st, tense, o); // p2-player-rules-3 (CR 701.30)
  if (ev.exploited !== undefined) throw new NoRenderer(`an exploited creature on the action ${verbWord}`);
  const camel = verbWord.replace(/([A-Z])/g, ' $1').toLowerCase();
  if (SUBJECT_ACTIONS.has(verbWord) && ev.object && !(verbWord === 'exert' && ev.actor !== undefined)) { // std-ry8: a player exerts (CR 701.43a)
    const s = subjectOf(ev.object, st, o);
    const base = camel;
    if (verbWord === 'fight' && (tense !== 'present' || ev.actor !== undefined)) throw new NoRenderer('a fight in another tense or with an actor'); // edh-combat-6
    // std-lci (CR 701.44a): "explores a land card" / "explores a nonland card", the card the explore revealed; only an explore says it
    if (ev.revealed !== undefined && verbWord !== 'explore') throw new NoRenderer(`a revealed card on the action ${verbWord}`);
    const kind = ev.revealed === undefined ? '' : ` ${ev.revealed === 'land' ? 'a land card' : 'a nonland card'}`;
    return { subject: s.text, predicate: `${tense === 'past' ? `${base}d` : tense === 'would' ? `would ${base}` : s.plural ? base : `${base}s`.replace(/ys$/, 'ies')}${kind}`, plural: s.plural };
  }
  if (ev.revealed !== undefined) throw new NoRenderer('a revealed card on an action that is not an explore');
  // edh-cast-6 (CR 701.6a, 603.2; Baral, Chief of Compliance): "a spell or ability you control counters a spell" is the controller's counter of a spell
  if (verbWord === 'counter' && ev.actor === 'you' && ev.object !== undefined) {
    if (tense !== 'present' || o.batch || JSON.stringify(ev.object) !== JSON.stringify({ stackKind: 'spell' })) throw new NoRenderer('a counter action by you other than the present "counters a spell"');
    return { subject: 'a spell or ability you control', predicate: 'counters a spell', plural: false };
  }
  // edh-players-22 (CR 701.8a, 109.5; Karmic Justice): "a spell or ability an opponent controls destroys a noncreature permanent you control"
  // edh-next-132 (CR 701.9a, 109.5; Orvar, the All-Form, Guerrilla Tactics): "a spell or ability an opponent controls causes you to discard ~": the discard of the card itself by an opponent's effect
  if (ev.by !== undefined && verbWord === 'discard') {
    if (ev.by !== 'opponent' || ev.actor !== 'you' || JSON.stringify(ev.object) !== JSON.stringify({ self: true }) || tense !== 'present' || o.batch) throw new NoRenderer('a discard by an effect other than "a spell or ability an opponent controls causes you to discard ~"');
    return { subject: 'a spell or ability an opponent controls', predicate: `causes you to discard ${subjectOf(ev.object!, st, o).text}`, plural: false };
  }
  if (ev.by !== undefined) {
    if (verbWord !== 'destroy' || ev.by !== 'opponent' || ev.object === undefined || ev.actor !== undefined || tense !== 'present' || o.batch) throw new NoRenderer(`the controller of the spell or ability of the action ${verbWord}`);
    const s = subjectOf(ev.object, st, o);
    return { subject: 'a spell or ability an opponent controls', predicate: `destroys ${s.text}`, plural: false };
  }
  const passiveVerbs: Record<string, string> = { exile: 'exiled', destroy: 'destroyed', counter: 'countered', regenerate: 'regenerated', tap: 'tapped', untap: 'untapped', attach: 'attached', transform: 'transformed' };
  if (passiveVerbs[verbWord] !== undefined && ev.object) {
    const s = subjectOf(ev.object, st, o);
    return { subject: s.text, predicate: passive(passiveVerbs[verbWord]!, tense, s.plural), plural: s.plural };
  }
  // p2-trigger-events-1 (CR 701.17a; parser/holes/event.ts): "one or more nonland cards are milled" (no player named: any player's mill), the cards in the
  // graveyard they went to
  if (verbWord === 'mill' && ev.actor === undefined && ev.object !== undefined && tense === 'present') {
    const s = subjectOf({ ...ev.object, zone: 'graveyard' }, st, o, true, 'card');
    return { subject: s.text, predicate: passive('milled', tense, s.plural), plural: s.plural };
  }
  const p = playerSubject(ev.actor ?? 'any', st);
  st.mentioned.add('e:player');
  // Cloud r3-repl (CR 701.17a, 614.1a): a replaced mill is "if an opponent would mill one or more cards" (the mill proposal, effects/proposal-kinds/mill.ts)
  if (verbWord === 'mill' && tense === 'would' && ev.object === undefined) return { subject: p.text, predicate: 'would mill one or more cards', plural: false };
  // edh-players-18 (CR 121.2, 614.1a; Alms Collector): a replaced draw of at least N cards at once is "if an opponent would draw two or more cards" (the drawMany proposal, effects/proposal-kinds/draw-many.ts)
  if (verbWord === 'draw' && tense === 'would' && ev.object === undefined && ev.atLeast !== undefined) return { subject: p.text, predicate: `would draw ${ev.atLeast} or more cards`, plural: false };
  if (ev.atLeast !== undefined) throw new NoRenderer(`a count of cards of the action ${verbWord} other than a replaced draw`);
  // edh-zones-14 (CR 701.23a, 614.1a): a replaced search of a library is "if an opponent would search a library" (the search proposal, effects/proposal-kinds/search.ts)
  if (verbWord === 'search' && tense === 'would' && ev.object === undefined && ev.searched === undefined) return { subject: p.text, predicate: 'would search a library', plural: false };
  // p2-replace-events-3 (CR 701.22a, 614.1a): a replaced scry is "if you would scry a number of cards" (the scry proposal, effects/proposal-kinds/scry.ts)
  if (verbWord === 'scry' && tense === 'would' && ev.object === undefined) return { subject: p.text, predicate: 'would scry a number of cards', plural: false };
  // edh-d-96 (CR 701.22a; The Temporal Anchor): a scry that put one or more cards on the bottom (the `scryBottom` action, effects/handlers/cards-library.ts): "you choose to put one or more cards on the
  // bottom of your library while scrying" (only "you", in the present)
  if (verbWord === 'scryBottom') {
    if (tense !== 'present' || ev.object !== undefined || ev.actor !== 'you') throw new NoRenderer('a scry to the bottom other than "whenever you choose to put one or more cards on the bottom of your library while scrying"');
    return { subject: p.text, predicate: 'choose to put one or more cards on the bottom of your library while scrying', plural: false };
  }
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
  // p2-trigger-events-1 (CR 701.17a): what a player mills is a card ("whenever a player mills a nonland card"), judged in the graveyard it went to
  const what = (verbWord === 'discard' || verbWord === 'cycle') && ev.object !== undefined && ev.object.zone === undefined && ev.object.self === undefined
    ? { ...ev.object, zone: 'hand' as const }
    : verbWord === 'mill' && ev.object !== undefined && ev.object.zone === undefined && ev.object.self === undefined ? { ...ev.object, zone: 'graveyard' as const } : ev.object;
  const noZone = what !== ev.object ? { noZone: true } : {};
  // CLOUD std-misc: "whenever you sacrifice ~ or another artifact" (the sacrificed object of a sacrifice by the controller, CR 701.21a)
  const one = (f: ObjectFilter): string => (verbWord === 'sacrifice' && ev.actor === 'you' ? selfOrAnother(f, f, st, K.np(f, st, { det: 'a' })) : K.np(f, st, { det: 'a', ...noZone }));
  const object = what
    ? ` ${o.batch ? K.np(what, st, { det: 'none', plural: true, count: 'one or more', ...noZone }) : one(what)}${landFrom}`
    : verbWord === 'foretell' ? (o.batch ? '' : ' a card') // edh-d-73 (CR 702.143a): "whenever you foretell a card"
    : verbWord === 'cycle' || verbWord === 'discard' ? (o.batch ? ' one or more cards' : ' a card') : verbWord === 'completeDungeon' ? ' a dungeon'
      : verbWord === 'playLand' && !o.batch ? ` a land${landFrom}`
        // Standard round 4, r4-trig (CR 701.23a): "an opponent searches their library", "you search your library" (`searched`)
        : verbWord === 'search' && ev.searched === 'ownLibrary' && !o.batch ? (ev.actor === 'you' ? ' your library' : ' their library')
          // edh-c-1 (CR 701.24a; Cosi's Trickster): "whenever an opponent shuffles their library" (a shuffle is of the actor's own library, so the object is always said)
          : verbWord === 'shuffle' && ev.object === undefined && ev.actor !== undefined && !o.batch ? (ev.actor === 'you' ? ' your library' : ' their library') : '';
  if (verbWord !== 'search' && ev.searched !== undefined) throw new NoRenderer(`the zone searched by the action ${verbWord}`);
  if (o.batch && object === '') throw new NoRenderer(`"one or more" for the action ${verbWord} without an object`);
  // CLOUD std-misc (CR 603.2c): "one or more players discard one or more cards" (TriggerDef.wholeBatch), only discard
  if (o.wholeBatch === true) {
    // edh-d-11 (CR 603.2c, 701.21a; Evin, Waterdeep Opportunist): also "one or more players sacrifice one or more creatures" (the object described, the batch of any player's sacrifices)
    if (verbWord === 'sacrifice' && ev.object !== undefined && ev.actor === 'any') return { subject: 'one or more players', predicate: `${base}${object}`, plural: true };
    if (verbWord !== 'discard' || ev.object !== undefined) throw new NoRenderer('"one or more players" for an action other than discarding cards');
    return { subject: 'one or more players', predicate: `${base}${object}`, plural: true };
  }
  // FAST1 T4, CR 702.29a: cycling a card discards it (the cost "Discard this card"), so "cycle or discard a card" is one discard: it triggers once
  if (verbWord === 'discard' && tense === 'present' && !o.batch) {
    const discards = personVerb(base, past, tense, p.person);
    return { subject: p.text, predicate: alt(`${discards}${object}`, `${personVerb('cycle', 'cycled', tense, p.person)} or ${discards}${object}`), plural: false };
  }
  // edh-c-25 (CR 701.24a, 603.2; family spell-or-ability-causes-shuffle; Psychogenic Probe): every shuffle of a library is made by a spell or ability (or a rule outside the game), so
  // "a player shuffles their library" is also said "a spell or ability causes a player to shuffle their library"
  if (verbWord === 'shuffle' && ev.actor === 'any' && ev.object === undefined && tense === 'present' && !o.batch) {
    return { subject: '', predicate: alt(`${p.text} ${personVerb(base, past, tense, p.person)}${object}`, `a spell or ability causes ${p.text} to shuffle their library`), plural: false };
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

/** edh-d-74 (CR 702.24a; Hibernation's End, Thought Lash): "you pay ~'s cumulative upkeep", "a player doesn't pay ~'s cumulative upkeep". Only the permanent itself, in the present tense. */
function cumulativeUpkeepParts(ev: Extract<EventPattern, { ev: 'action' }>, st: RenderState, tense: Tense, o: EventOpts): Parts {
  if (ev.object === undefined || JSON.stringify(ev.object) !== '{"self":true}' || tense !== 'present' || o.batch || ev.n !== undefined) throw new NoRenderer('a cumulative upkeep payment other than the permanent\'s own, in the present tense');
  const p = playerSubject(ev.actor ?? 'any', st);
  st.mentioned.add('e:player');
  const pay = ev.verb === 'payCumulativeUpkeep' ? 'pay' : p.person === 'you' ? "don't pay" : "doesn't pay";
  return { subject: p.text, predicate: ev.verb === 'payCumulativeUpkeep' ? `${personVerb('pay', 'paid', tense, p.person)} ~'s cumulative upkeep` : `${pay} ~'s cumulative upkeep`, plural: false };
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
/** edh-players-17: the two attack declarations of "you attack enchanted opponent or a planeswalker they control or when they attack you or a planeswalker you control". */
const ENCHANTED_OPPONENT_ATTACKS = [
  { ev: 'attacks', attacker: { types: ['Creature'], controller: 'you' }, count: { op: '>=', value: 1 }, defender: { ref: 'enchantedPlayer' }, orPlaneswalker: true },
  { ev: 'attacks', attacker: { types: ['Creature'], controller: { ref: 'enchantedPlayer' } }, count: { op: '>=', value: 1 }, defender: 'you', orPlaneswalker: true },
];

const EXILED_FROM_TWO_ORIGINS: EventPattern[] = [
  { ev: 'zoneChange', subject: { types: ['Creature'], controller: 'you' }, from: 'battlefield', to: 'exile' },
  { ev: 'zoneChange', subject: { types: ['Creature'], isCard: true, owner: 'you' }, from: 'graveyard', to: 'exile' },
];

const join = (p: Parts): string => (p.subject === '' ? p.predicate : `${p.subject} ${p.predicate}`);

export function event(ev: EventPattern, st: RenderState, tense: Tense, o: EventOpts = {}): string {
  const text = join(eventParts(ev, st, tense, o));
  // edh-next-147 (CR 601.2i, 603.2; family spell-is-cast; Sentinel Tower): a cast by any player of a spell of a description and nothing else is also "<a spell> is cast"
  if (ev.ev === 'cast' && ev.player === 'any' && tense === 'present' && o.batch !== true && text.startsWith('a player casts ') && Object.keys(ev).every((k) => k === 'ev' || k === 'player' || k === 'spell')
    && ev.spell?.self === undefined && ev.spell?.anyOf === undefined) return alt(text, `${text.slice('a player casts '.length)} is cast`);
  // edh-top-7 (CR 102.2; parser/holes/event.ts, "another player" is read as an opponent of the controller; family another-player-opponent): a cast or a draw of an opponent is also said "another player ..."
  return (ev.ev === 'cast' || ev.ev === 'draw') && ev.player === 'opponent' && o.batch !== true && text.startsWith('an opponent ') ? alt(text, `another player ${text.slice('an opponent '.length)}`) : text;
}

/** Several events of one trigger ("whenever ~ enters or attacks"): a shared subject is written once. */
/** edh-next-74: the two damage patterns of "~ or another creature with the same name deals combat damage to a player" (Pirated Copy). */
const SELF_OR_SAME_NAME_DAMAGE: EventPattern[] = [
  { ev: 'damage', source: { self: true }, combat: true, recipient: { player: 'any' } },
  { ev: 'damage', source: { types: ['Creature'], other: true, sharesWith: { with: { ref: 'self' }, quality: 'name' } }, combat: true, recipient: { player: 'any' } },
];

export function events(list: EventPattern[], st: RenderState, tense: Tense, o: EventOpts = {}): string {
  if (list.length === 1) return event(list[0]!, st, tense, o);
  // trek-19 (CR 602.2, 605.3b; Kai Winn, Faithless Leader): the pair of one activation (non-mana abilities and mana abilities, std-hob) beside another event of the list is said as the one activation
  if (list.length > 2) {
    const at = list.findIndex((a, k) => k < list.length - 1 && a.ev === 'activate' && list[k + 1]!.ev === 'activate' && a.ability === undefined && a.manaAbility === false
      && (list[k + 1] as { manaAbility?: boolean }).manaAbility === true && JSON.stringify({ ...a, manaAbility: true }) === JSON.stringify(list[k + 1]));
    if (at >= 0) {
      const { manaAbility: _m, ...any } = list[at] as Extract<EventPattern, { ev: 'activate' }>;
      return events([...list.slice(0, at), any, ...list.slice(at + 2)], st, tense, o);
    }
  }
  // edh-next-74 (CR 510.2, 603.2, 201.2; trigger trg.edhn74.selfOrSameName.combatDamage.player, Pirated Copy): "~ or another creature with the same name deals combat damage to a player"
  if (list.length === 2 && tense === 'present' && o.batch !== true && JSON.stringify(list) === JSON.stringify(SELF_OR_SAME_NAME_DAMAGE)) {
    st.mentioned.add('e:source');
    return '~ or another creature with the same name deals combat damage to a player';
  }
  // edh-next-74 (CR 107.3, 602.2, 603.4; trigger trg.edhn74.you.castOrActivate.ifXInCost, Unbound Flourishing): "you cast an instant or sorcery spell or activate an ability, if that spell's mana cost or that ability's activation cost
  // contains {X}": the casting of an instant or sorcery spell with {X} in its mana cost and the activation of an ability with {X} in its activation cost, nothing else on either
  if (list.length === 2 && tense === 'present' && o.batch !== true && JSON.stringify(list) === JSON.stringify([{ ev: 'cast', player: 'you', spell: { types: ['Instant', 'Sorcery'], manaCostHasX: true } }, { ev: 'activate', player: 'you', xInCost: true }])) {
    st.mentioned.add('e:player');
    return "you cast an instant or sorcery spell or activate an ability, if that spell's mana cost or that ability's activation cost contains {X}";
  }
  // edh-mana-keywords-7 (CR 505.1a, 603.2; parser/holes/event.ts#EACH_OF_YOUR_STEPS, Frontier Siege): both main phases of your turns, said in the plural
  if (list.length === 2 && tense === 'present' && JSON.stringify(list) === JSON.stringify([{ ev: 'step', step: 'main1', whose: 'you' }, { ev: 'step', step: 'main2', whose: 'you' }])) return 'the beginning of each of your main phases';
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
        : a!.player === 'you' && JSON.stringify(b!.object) === '{"controller":"you","zone":"battlefield"}' ? 'you or a permanent you control'
        : a!.player === 'you' && JSON.stringify(b!.object) === '{"controller":"you","zone":"battlefield","other":true}' ? 'you or another permanent you control' /* edh-next-141 (CR 115.1; Valkmira) */ : null;
      if (both !== null) {
        st.mentioned.add('e:subject');
        const pred = eventParts(b!, st, tense, o).predicate.replace(/^becomes /, '');
        return `${both} becomes ${pred}`;
      }
    }
  }
  // edh-next-99 (CR 115.1, 603.2c; parser/holes/event.ts, Leyline of Combustion): the same two events as a batch (one trigger for a spell or ability that targets you and/or permanents you control)
  if (list.length === 2 && tense === 'present' && o.batch === true && o.wholeBatch !== true) {
    const [a, b] = list;
    if (a!.ev === 'becomes' && b!.ev === 'becomes' && a!.what === 'targeted' && b!.what === 'targeted' && a!.player === 'you' && JSON.stringify(a!.object) === '{}' && JSON.stringify(b!.object) === '{"controller":"you","zone":"battlefield"}' && JSON.stringify(a!.by) === JSON.stringify(b!.by)) {
      st.mentioned.add('e:subject');
      const pred = eventParts(b!, st, tense, { ...o, batch: false }).predicate.replace(/^becomes /, '');
      return `you and/or at least one permanent you control becomes ${pred}`;
    }
  }
  // edh-d-90 (CR 509.3a-d, 603.2c; parser/holes/event.ts, Godsend): "<one creature> blocks or becomes blocked by one or more creatures": the attackers it blocks, or the creatures blocking it, one
  // occurrence for the declaration (nothing else on either pattern)
  if (list.length === 2 && tense === 'present' && o.batch === true && o.wholeBatch !== true) {
    const [a, b] = list;
    if (a!.ev === 'blocks' && b!.ev === 'becomesBlocked' && Object.keys(a!).sort().join() === 'attacker,blocker,ev' && Object.keys(b!).sort().join() === 'attacker,by,ev'
      && JSON.stringify(a!.attacker) === '{"types":["Creature"]}' && JSON.stringify(b!.by) === '{"types":["Creature"]}' && JSON.stringify(a!.blocker) === JSON.stringify(b!.attacker)
      && (a!.blocker!.self === true || a!.blocker!.attachedToSource === true)) {
      const subj = subjectOf(a!.blocker!, st, { ...o, batch: false });
      st.mentioned.add('e:subject');
      return `${subj.text} blocks or becomes blocked by one or more creatures`;
    }
  }
  // edh-players-11 (CR 122.1, 122.6, 603.2c; parser/holes/event.ts#youPutCounters; All Will Be One): "you put one or more counters on a permanent or player": the counters you put on a
  // permanent, or on a player, one pattern each
  if (list.length === 2 && tense === 'present' && o.batch === true && o.wholeBatch !== true) {
    const [a, b] = list;
    if (a!.ev === 'counters' && b!.ev === 'counters' && a!.by === 'you' && b!.by === 'you' && a!.change === 'put' && b!.change === 'put' && a!.atLeast === undefined && b!.atLeast === undefined
      && a!.byEffect === undefined && b!.byEffect === undefined && a!.kind === b!.kind && !('player' in a!.on) && Object.keys(a!.on).length === 0 && 'player' in b!.on && b!.on.player === 'any') {
      st.mentioned.add('e:player');
      return `you put one or more ${a!.kind ? `${a!.kind} ` : ''}counters on a permanent or player`;
    }
  }
  // edh-players-17 (CR 508.1, 506.3, 508.5, 603.2c, 303.4; trigger trg.edhp17.when.attackEnchantedOpponentOrTheyAttackYou, Tenuous Truce): the declaration of your attackers at the enchanted opponent (or a
  // planeswalker they control) and, in their turn, the declaration of theirs at you (or a planeswalker you control): said as two "when" clauses joined by "or"
  if (list.length === 2 && tense === 'present' && o.batch === true && JSON.stringify(list) === JSON.stringify(ENCHANTED_OPPONENT_ATTACKS)) {
    st.mentioned.add('e:attacker');
    return alt('you attack enchanted opponent or a planeswalker they control or when they attack you or a planeswalker you control', 'you attack enchanted player or a planeswalker they control or when they attack you or a planeswalker you control');
  }
  // edh-next-5 (CR 702.29a, 601.2i; trigger trg.edhn5.you.castOrCycle.self; Drownyard Lurker): "you cast or cycle ~", the cast of this spell and the cycling of this card, nothing else in either
  if (list.length === 2 && tense === 'present' && o.batch !== true && JSON.stringify(list) === JSON.stringify([{ ev: 'cast', player: 'you', spell: { self: true } }, { ev: 'action', verb: 'cycle', actor: 'you', object: { self: true } }])) {
    st.mentioned.add('e:player');
    return `you cast or cycle ${K.obj({ ref: 'self' }, st, 'object').text}`;
  }
  // Standard round 4, r4-trig (CR 305.1, 601.2a; parser/holes/event.ts): "you play a land or cast a spell from anywhere other than your hand", the zone said once for both
  if (list.length === 2 && tense === 'present' && o.batch !== true && JSON.stringify(list) === JSON.stringify([{ ev: 'action', verb: 'playLand', actor: 'you', notFrom: 'hand' }, { ev: 'cast', player: 'you', spell: { not: { castFrom: 'hand' } } }])) {
    st.mentioned.add('e:player');
    return 'you play a land or cast a spell from anywhere other than your hand';
  }
  // edh-cast-10 (CR 305.1, 601.2a; parser/holes/event.ts; Prosper, Tome-Bound): "you play a card from exile", a land played or a spell cast from exile
  if (list.length === 2 && tense === 'present' && o.batch !== true && JSON.stringify(list) === JSON.stringify([{ ev: 'action', verb: 'playLand', actor: 'you', from: 'exile' }, { ev: 'cast', player: 'you', from: 'exile' }])) {
    st.mentioned.add('e:player');
    return alt('you play a card from exile', 'you play a land from exile or cast a spell from exile'); // (the same pair of events, std-spm's wording: Gwen Stacy)
  }
  // edh-c-13 (CR 305.1, 601.2a; parser/holes/event.ts; Null Profusion): "you play a card", a land played or a spell cast
  if (list.length === 2 && tense === 'present' && o.batch !== true && JSON.stringify(list) === JSON.stringify([{ ev: 'action', verb: 'playLand', actor: 'you' }, { ev: 'cast', player: 'you', spell: { isCard: true } }])) {
    st.mentioned.add('e:player');
    return alt('you play a card', 'you play a land or cast a spell');
  }
  // edh-d-86 (CR 305.1, 601.2a, 205.2a; parser/holes/event.ts; Rendmaw, Creaking Nest): "you play a card with two or more card types", the pair with the card's description on both
  if (list.length === 2 && tense === 'present' && o.batch !== true) {
    const [a, b] = list;
    const f = a?.ev === 'action' && a.verb === 'playLand' && a.object !== undefined ? a.object : undefined;
    if (f !== undefined && Object.keys(f).join() === 'minCardTypes' && JSON.stringify(a) === JSON.stringify({ ev: 'action', verb: 'playLand', actor: 'you', object: f })
      && JSON.stringify(b) === JSON.stringify({ ev: 'cast', player: 'you', spell: { isCard: true, ...f } })) {
      st.mentioned.add('e:player');
      return `you play ${K.np(f, st, { det: 'a', head: 'card' })}`;
    }
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
  // edh-d-87 (CR 701.17a, 701.8a, 603.10a; parser/holes/edhd87.ts#sacrificedOrDestroyed; Jaws, Relentless Predator): "a noncreature artifact is sacrificed or destroyed": the two actions of anyone on
  // one described object, said with one subject and both participles
  if (list.length === 2 && tense === 'present' && o.batch !== true && list.every((x) => x.ev === 'action' && x.actor === undefined && x.object !== undefined && Object.keys(x).length === 3)
    && (list[0] as { verb?: string }).verb === 'sacrifice' && (list[1] as { verb?: string }).verb === 'destroy' && JSON.stringify((list[0] as { object?: unknown }).object) === JSON.stringify((list[1] as { object?: unknown }).object)) {
    const s = subjectOf((list[0] as { object: ObjectFilter }).object, st, o);
    if (s.plural) throw new NoRenderer('several objects sacrificed or destroyed');
    return `${s.text} is sacrificed or destroyed`;
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
  // edh-players-8 (CR 603.2c; parser/holes/event.ts#opponentAttacksYouList): "an opponent attacks you with two or more creatures, draws their second card each turn, or ...":
  // only the attack declaration is a "batch" event, the other events of the list are single ones
  const mixedBatch = o.batch === true && list.length > 1 && list[0]!.ev === 'attacks' && list[0]!.count !== undefined && list.slice(1).every((e) => e.ev !== 'attacks');
  const parts = list.map((e, k) => eventParts(e, st, tense, mixedBatch && k > 0 ? { ...o, batch: false } : o));
  // ... said from the opponent's side with the one subject: "an opponent attacks you with two or more creatures, draws their second card each turn, or casts ..." (family
  // opponent-attacks-you-or-events); the attack is the opponent's declaration at you, nothing more, and the other events are that opponent's too
  const a0 = list[0]!;
  if (mixedBatch && tense === 'present' && a0.ev === 'attacks' && a0.defender === 'you' && a0.orPlaneswalker !== true && a0.alone === undefined && a0.power === undefined && a0.count!.op === '>='
    && a0.attacker?.controller === 'opponent' && onlyKeys(a0.attacker, 'types', 'controller') && JSON.stringify(a0.attacker.types) === '["Creature"]' && parts.slice(1).every((p) => p.subject === 'an opponent' && !p.plural)) {
    const attack = `attacks you with ${K.qty(a0.count!.value, st)} or more creatures`;
    const preds = [attack, ...parts.slice(1).map((p) => p.predicate)];
    return `an opponent ${preds.length >= 3 ? alt(preds.join(' or '), joinList(preds, 'or')) : preds.join(' or ')}`;
  }
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
      if (m && list[i + k]?.ev === 'blocks' && list[i + k + 1]?.ev === 'becomesBlocked' && (preds[k + 1] === `becomes blocked by ${m[1]}` || (m[1] === '~' && preds[k + 1] === `becomes blocked by ${alt('it', '~')}` /* edh-d-25 (Mirror Shield): the object itself, said "~" once and "it" after */))) {
        preds.splice(k, 2, alt(`${preds[k]} or ${preds[k + 1]}`, `blocks or becomes blocked by ${m[1]}`));
      }
    }
    // FAST4 T27 (CR 119.9, 119.10): "you gain life or lose life" is also printed "you gain or lose life" (one subject, "life" the object of both verbs)
    for (let k = 0; k + 1 < preds.length; k++) {
      const g = /^(gains?) life$/.exec(preds[k]!);
      const l = /^(loses?) life$/.exec(preds[k + 1]!);
      if (g && l && list[i + k]?.ev === 'life' && list[i + k + 1]?.ev === 'life') preds.splice(k, 2, alt(`${preds[k]} or ${preds[k + 1]}`, `${g[1]} or ${l[1]} life`));
    }
    // edh-players-1 (CR 603.2, 111.1, 701.21a; parser/holes/event.ts; family create-or-sacrifice): "you create a token or sacrifice a token" is also printed "you create or
    // sacrifice a token" (the noun phrase is the object of both verbs)
    for (let k = 0; k + 1 < preds.length; k++) {
      const c = /^(creates?) (.+)$/.exec(preds[k]!);
      const x = /^(sacrifices?) (.+)$/.exec(preds[k + 1]!);
      if (c && x && c[2] === x[2] && list[i + k]?.ev === 'createToken' && list[i + k + 1]?.ev === 'action') preds.splice(k, 2, alt(`${preds[k]} or ${preds[k + 1]}`, `${c[1]} or ${x[1]} ${c[2]}`));
    }
    // edh-next-43 (CR 706.2, 603.2c; parser/holes/event.ts; family roll-a-or-number): "you roll a 1 or roll a 2" is also printed "you roll a 1 or 2" (the verb said once)
    for (let k = 0; k + 1 < preds.length; k++) {
      const r = /^(rolls?) a (\d+)$/.exec(preds[k]!);
      const x = /^(rolls?) a (\d+)$/.exec(preds[k + 1]!);
      if (r && x && r[1] === x[1] && list[i + k]?.ev === 'dieRoll' && list[i + k + 1]?.ev === 'dieRoll') preds.splice(k, 2, alt(`${preds[k]} or ${preds[k + 1]}`, `${preds[k]} or ${x[2]}`));
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
    // edh-players-8 (family events-serial-list): any three or more predicates of one subject are also a list with the serial comma, "an opponent attacks you with two or more creatures,
    // draws their second card each turn, or casts their second spell each turn"
    const said = preds.length >= 3 && preds.every((x) => /^[a-z]+$/.test(x)) ? alt(preds.join(' or '), joinList(preds, 'or'))
      : preds.length >= 3 ? alt(preds.join(' or '), joinList(preds, 'or')) : preds.join(' or ');
    // edh-d-55 (CR 603.2, 712.14a; family events-comma-or; Corruption of Towashi): "a permanent you control transforms or a permanent you control enters transformed": the subject said again
    // for the entering event (Oracle prints both subjects)
    if (parts[i]!.subject !== '' && preds.length === 2 && list[i]?.ev === 'becomes' && list[i + 1]?.ev === 'zoneChange' && /^enters? transformed$/.test(preds[1]!)) {
      out.push(alt(`${parts[i]!.subject} ${said}`, `${parts[i]!.subject} ${preds[0]} or ${parts[i]!.subject} ${preds[1]}`));
      i = j;
      continue;
    }
    out.push(parts[i]!.subject === '' ? said : `${parts[i]!.subject} ${said}`);
    i = j;
  }
  // edh-zones-3 (family events-comma-or): complete events of different subjects are also joined with a comma before each "or" ("Whenever another creature dies, or a creature card
  // is put into a graveyard from anywhere other than the battlefield, or a creature card leaves your graveyard", Syr Konrad, the Grim)
  // (and a subject of two events in a row is said again: "a creature card is put into a graveyard from X, or a creature card leaves your graveyard")
  const eachSaid = parts.map((p) => (p.subject === '' ? p.predicate : `${p.subject} ${p.predicate}`));
  const joined = out.length >= 2 ? alt(out.join(' or '), out.join(', or '), eachSaid.join(', or '), eachSaid.join(' or ')) : out.join(' or ');
  // FAST4 T23: events of several singular subjects with one predicate also read "~ or another nontoken Cat you control enters" (CR 603.2: either event
  // triggers the ability; parser/holes/event.ts reads the subjects so)
  const pred = parts[0]!.predicate;
  if (parts.every((p) => p.subject !== '' && !p.plural && p.predicate === pred) && new Set(parts.map((p) => p.subject)).size === parts.length) {
    // edh-c-68 (CR 603.2; family subject-list-one-article; Royal Decree): three or more descriptions say the article once, "a Swamp, Mountain, black permanent, or red permanent becomes tapped"
    const oneArticle = parts.length >= 3 && parts.every((p) => new RegExp(`^${ALT_OPEN}?an? `).test(p.subject)) ? [`${joinList([parts[0]!.subject, ...parts.slice(1).map((p) => p.subject.replace(new RegExp(`(^|${ALT_OPEN}|${ALT_SEP})an? `, 'g'), '$1'))], 'or')} ${pred}`] : [];
    return alt(joined, `${joinList(parts.map((p) => p.subject), 'or')} ${pred}`, ...oneArticle);
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
  // edh-d-6 (CR 603.2, 700.4, 510.2; trigger "~ or another nontoken Spirit you control dies or deals combat damage to a player", Millicent, Restless Revenant; family self-or-another-dies-or-damages):
  // the object itself and another object each dying and dealing combat damage to the same recipient: four patterns, said with the subjects together before the two verbs
  if (list.length === 4 && tense === 'present' && o.batch !== true && list[0]!.ev === 'zoneChange' && list[1]!.ev === 'damage' && list[2]!.ev === 'zoneChange' && list[3]!.ev === 'damage') {
    const [d0, g0, d1, g1] = list as [Extract<EventPattern, { ev: 'zoneChange' }>, Extract<EventPattern, { ev: 'damage' }>, Extract<EventPattern, { ev: 'zoneChange' }>, Extract<EventPattern, { ev: 'damage' }>];
    const own = st.ctx.selfTypes?.map((t) => t.toLowerCase());
    const kindOfOwn = (f: ObjectFilter): boolean => !isSelfOnly(f) && f.allTypes === undefined && (f.types ?? []).every((t) => t === 'Creature') && (f.subtypes ?? []).every((t) => own?.includes(t.toLowerCase()) === true);
    const deathsOf = (d: typeof d0): boolean => d.from === 'battlefield' && d.to === 'graveyard' && d.subject !== undefined;
    if (deathsOf(d0) && deathsOf(d1) && isSelfOnly(d0.subject) && !isSelfOnly(d1.subject) && kindOfOwn(d1.subject) && own?.includes('creature') === true
      && g0.combat === true && g1.combat === true && JSON.stringify(g0.source) === JSON.stringify(d0.subject) && JSON.stringify(g1.source) === JSON.stringify(d1.subject)
      && JSON.stringify(g0.recipient) === JSON.stringify(g1.recipient) && parts[0]!.subject === '~' && parts[0]!.subject === parts[1]!.subject && parts[2]!.subject === parts[3]!.subject
      && parts[2]!.subject !== '' && !parts[2]!.plural && parts[1]!.predicate === parts[3]!.predicate) {
      return alt(joined, `${parts[0]!.subject} or ${parts[2]!.subject} dies or ${parts[1]!.predicate}`);
    }
  }
  // edh-next-87 (CR 603.2, 700.4; trigger "~ or another nontoken artifact you control is put into a graveyard from the battlefield or is put into exile from the battlefield", Slagstone Refinery; family
  // subjects-together-two-moves): the object itself and another object each put into one of two zones: four patterns, said with the two subjects together before the two predicates
  if (list.length === 4 && tense === 'present' && o.batch !== true && list.every((e) => e.ev === 'zoneChange' && e.from === 'battlefield') && parts.every((p) => p.subject !== '' && !p.plural)
    && parts[0]!.subject === parts[1]!.subject && parts[2]!.subject === parts[3]!.subject && parts[0]!.subject !== parts[2]!.subject
    && (list[0] as { to?: unknown }).to === (list[2] as { to?: unknown }).to && (list[1] as { to?: unknown }).to === (list[3] as { to?: unknown }).to && (list[0] as { to?: unknown }).to !== (list[1] as { to?: unknown }).to) {
    return alt(joined, `${parts[0]!.subject} or ${parts[2]!.subject} ${parts[2]!.predicate} or ${parts[3]!.predicate}`);
  }
  const diesAll = list.every((e) => e.ev === 'zoneChange' && e.from === 'battlefield' && e.to === 'graveyard');
  if (diesAll && parts.every((p) => p.subject !== '' && !p.plural) && new Set(parts.map((p) => p.subject)).size === parts.length) {
    // p2-trigger-events-1 (CR 700.4; Headless Rider): and "dies" when the first subject is the object itself and it is a creature ("~ or another nontoken Zombie you
    // control dies": the others are described by a creature type, as FAST1 T4's "another Zombie you control dies"; family dies-wording)
    const own = st.ctx.selfTypes?.map((t) => t.toLowerCase());
    // ("another" says the object itself is of the others' kind: their creature types are its own, as render/evt.ts#selfOrAnother requires; anything else fails closed)
    const kindOfSelf = (f: ObjectFilter): boolean => !isSelfOnly(f) && f.allTypes === undefined && (f.types ?? []).every((t) => t === 'Creature') && (f.subtypes ?? []).every((t) => own?.includes(t.toLowerCase()) === true);
    const selfDies = tense === 'present' && parts[0]!.subject === '~' && own?.includes('creature') === true && list.slice(1).every((e) => e.ev === 'zoneChange' && kindOfSelf(e.subject));
    const both = `${joinList(parts.map((p) => p.subject), 'or')} ${passive('put into a graveyard', tense, false)} from the battlefield`;
    return selfDies ? alt(joined, both, `${joinList(parts.map((p) => p.subject), 'or')} dies`) : alt(joined, both);
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
