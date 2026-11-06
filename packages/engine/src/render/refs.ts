/**
 * References as phrases (WP2): "target creature", "it", "that creature", "its controller", "that player", "the top card of target player's library".
 * The first mention of a target prints its whole spec; later mentions are anaphors. An anaphor is a group of alternatives (render/text.ts): the Oracle
 * text may use the pronoun or the noun, the model says the same thing (design 6.8: "listed anaphora variants at positions the renderer marks anaphoric").
 */
import type { Count, EventPattern, EventRole, ObjectFilter, ObjRef, PlayerPred, PlayerRef, Quantity, TargetSpec } from '../types/ability';
import { isSuspendedCard } from './suspended';
import { isPlayerOnlyRef, TARGETED_PLAYER_LINK } from '../types/ability';
import { entersOrAttacks, EVENT_ROLES, implicitRole, mixedCombatRole, opponentTargets, silentRole, TARGETING_CONTROLLER } from '../model/lint-roles';
import { K, type NpOpts } from './kernel';
import { cloneState, objKey, personOf, playerKey, type Form, type Phrase, type RefInfo, type RenderState } from './state';
import { alt, article, COLOR_WORD, displayFirst, firstAlt, joinList, NoRenderer, numWord, pluralize, withArticle } from './text';

const POSSESSIVE = (text: string): string => (/s$/.test(text) && !/'s$/.test(text) ? `${text}'` : `${text}'s`);

/**
 * Whether a thing described by `nouns` can be called `n` ("that creature"). A description that says its types ("creature", "permanent") answers for itself;
 * only a bare "permanent", "card" or "object" (nothing is known about its types) can still be anything.
 */
/** edh-players-11 (CR 608.2c): how Oracle says a player of a group `may` DID it: "who drew a card this way" after a single draw, "who does" / "who did" after any option. */
const didWords = (draws: boolean, hand = false, one = false): string => alt(...(draws ? ['drew a card this way'] : []), ...(hand ? ['discarded their hand this way'] : []), ...(one ? ['discarded a card this way'] : []) /* edh-next-43 */, 'does', 'did'); // edh-players-14: and, after an option that began with discarding the hand, "who discarded their hand this way" (CR 701.9a)
const canBeCalled = (nouns: string[], n: string): boolean => nouns.includes(n) || (nouns.length === 1 && (nouns[0] === 'permanent' || nouns[0] === 'card' || nouns[0] === 'object') && n !== 'player');

/** What a reference that cannot be written uniquely prints (design D12: zero or several compatible antecedents make the sentence manual). */
export const AMBIGUOUS = '[ambiguous reference]';

/** Something the text has named, for the unique-candidate rule. */
interface Antecedent {
  id: string;
  nouns: string[];
  plural: boolean;
  player: boolean;
  /** PUSH1 T2: an event role the clause does not name (model/lint-roles.ts#implicitRole): never what a bare pronoun means. */
  implicit?: boolean;
  /** edh-top-6 (the parser's rule, parser/lower/scope.ts, Mention.enteredObject): the object of an "enters" trigger: "that creature" names a target of the ability before it (candidateCheck). */
  entered?: boolean;
}

const PERMANENT_TYPES: ReadonlySet<string> = new Set(['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker']);

/**
 * The nouns the object with the ability is called by: its own types when the context says them. FAST5X E16: an instant or sorcery is never a permanent
 * (CR 110.1, 304.1, 307.1), so "that permanent" after "~ deals 6 damage to target creature or planeswalker" names the target alone (Violent Echoes).
 */
function selfNouns(st: RenderState): string[] {
  const t = st.ctx.selfTypes?.map((x) => x.toLowerCase()).filter((x) => x !== '');
  // FAST5 T40 (CR 110.4, 301-306, 307-308): an instant or a sorcery is never a permanent, so "that permanent" cannot mean it (Essence Burn: "~ deals 5 damage to target ...
  // creature or planeswalker. If that permanent would die this turn, exile it instead")
  if (t && t.length > 0 && t.every((x) => x === 'instant' || x === 'sorcery' || x === 'kindred' || x === 'tribal')) return [...t];
  if (t && t.some((x) => x === 'instant' || x === 'sorcery') && !t.some((x) => PERMANENT_TYPES.has(x))) return t;
  return t && t.length > 0 ? [...t, 'permanent'] : ['permanent'];
}

/** Every thing named so far that a later pronoun or "that <noun>" could mean (the controller, "you", is never one). */
/** trek-15: the trigger is one zone change of a described object that names no controller or owner ("Whenever a creature dies"). */
function eventNamesNoPlayer(st: RenderState): boolean {
  const on = st.trigger ?? [];
  const ev = on.length === 1 ? on[0]! : undefined;
  return ev !== undefined && ev.ev === 'zoneChange' && ev.subject.controller === undefined && ev.subject.owner === undefined && ev.subject.self !== true;
}

function antecedents(st: RenderState): Antecedent[] {
  const out: Antecedent[] = [];
  const seen = new Set<string>();
  const push = (a: Antecedent): void => {
    if (!seen.has(a.id)) {
      seen.add(a.id);
      out.push(a);
    }
  };
  for (const key of st.mentioned) {
    if (key === 'you') continue;
    if (key === 'self') push({ id: 'self', nouns: selfNouns(st), plural: false, player: false });
    else if (key === 'attached') push({ id: 'attached', nouns: ATTACH_NOUNS, plural: false, player: false });
    else if (key.startsWith('e:')) {
      // std-rx16 (the parser's rule, parser/lower/scope.ts#eventMentions): the attacker or blocker of "attacks or blocks" is a different creature per event
      if (mixedCombatRole(st.trigger ?? [], key.slice(2) as EventRole)) continue;
      // trek-22 (the parser's rule, model/lint-roles.ts#entersOrAttacks): in "enters or attacks" the attacker is the very creature the `subject` role names, one antecedent
      if (key === 'e:attacker' && entersOrAttacks(st.trigger ?? [])) continue;
      // trek-15 (the parser's rule, parser/lower/anaphora.ts; CR 608.2c; Vengeance Mission): the player of "Whenever a creature dies" is named by no phrase of the trigger (the creature has
      // no controller or owner in the text), so once an earlier instruction named a player, "that player" is that one
      if (key === 'e:player' && eventNamesNoPlayer(st) && [...st.mentioned].some((k) => !k.startsWith('e:') && st.info.get(k)?.player === true)) continue;
      const r = roleLookup(key.slice(2) as EventRole, st);
      if (r === null || r.isYou) continue;
      if (r.isSelf) push({ id: 'self', nouns: selfNouns(st), plural: false, player: false });
      else {
        // FAST2 T8: `subject` of a damage event is its `source` (roleIn): an unnamed source is implicit under either name ("whenever a creature you control is dealt damage, ... it")
        const role = key.slice(2) as EventRole;
        const implicit = implicitRole(st.trigger ?? [], role) || (role === 'subject' && implicitRole(st.trigger ?? [], 'source'));
        const entered = (role === 'subject' && (st.trigger ?? []).length > 0 && st.trigger!.every((ev) => ev.ev === 'zoneChange' && ev.to === 'battlefield'))
          // edh-d-86 (the parser's rule, parser/lower/scope.ts#eventMentions, attackingObject; Ojutai, Soul of Winter): and the attacking creature of an attack trigger of another object
          || ((role === 'attacker' || role === 'subject') && (st.trigger ?? []).length > 0 && st.trigger!.every((ev) => ev.ev === 'attacks' && ev.attacker !== undefined && ev.attacker.self !== true) && st.triggerBatch !== true);
        push({ id: r.id, nouns: r.info.nouns, plural: r.info.plural, player: r.info.player === true, ...(implicit ? { implicit: true } : {}), ...(entered ? { entered: true } : {}) });
      }
    } else {
      const info = st.info.get(key);
      // Cloud std-fin: the name an option or a payment binds records whether the player did it ("if you do", `actor`), it names no object (the parser makes no mention of it)
      if (info && info.actor !== undefined && info.nouns.length === 0 && info.player !== true) continue;
      // edh-d-53 (the parser's rule, lower/ability.ts#exiledMentions: participleOnly; CR 608.2h, Soul Exchange): what a cost exiled is named by "the exiled <noun>" only, never by
      // the "that creature" of another instruction
      if (key === 'costExiled') continue;
      if (info) push({ id: info.sameAs ?? key, nouns: info.nouns, plural: info.plural, player: info.player === true });
    }
  }
  return out;
}

/**
 * CLOUD std-msh (the parser's rule: the `Seen` hole of FAST5 T75, parser/holes/core.ts#Discourse): after a look at, or a reveal of, the top cards of a library,
 * "from among them" names the cards the ability saw, never another group ("Whenever you attack, look at the top six cards of your library. You may cast a spell
 * from among them ...": not the attackers). The pronoun names the group uniquely when no other plural group of library cards has been named.
 */
export function onlySeenGroup(st: RenderState, ref: ObjRef): boolean {
  if (ref.ref !== 'bound') return false;
  const key = `b:${ref.name}`;
  const info = st.info.get(key);
  if (info === undefined || !info.plural || info.player === true || info.zone !== 'library' || !info.nouns.includes('card')) return false;
  const mine = identityOf(st, key);
  return antecedents(st).every((a) => a.id === mine || !a.plural || a.player || st.info.get(a.id)?.zone !== 'library');
}

/** FAST5 T76: the identities of everything named so far (the focus is honored only while no other antecedent has been named since an instruction began, steps.ts#clausesOf). */
export function antecedentIds(st: RenderState): Set<string> {
  return new Set(antecedents(st).map((a) => a.id));
}

/** The identity of the thing a key stands for (two event roles of one trigger can be the same object). */
export function identityOf(st: RenderState, key: string): string {
  if (!key.startsWith('e:')) return st.info.get(key)?.sameAs ?? key;
  const r = roleLookup(key.slice(2) as EventRole, st);
  return r === null ? key : r.isSelf ? 'self' : r.id;
}

/**
 * Design D12 / 6.4, the unique-candidate rule, read backwards: a pronoun is a valid way to write a reference only when no other thing of the same sort and
 * number has been named, and "that <noun>" only when no other thing that can be called <noun> has. There is no "most recent" tie-break.
 */
function candidateCheck(st: RenderState, key: string, info: RefInfo): { pronoun: boolean; noun: (n: string) => boolean } {
  const mine = identityOf(st, key);
  // FAST2 T10: in "sacrifice it" / "destroy it" (CR 701.8a, 701.21a) a spell or ability on the stack is no antecedent (the parser's rule, Mention.stackObject)
  // r4-static (CR 110.4, 304.4, 307.4): an instant or sorcery spell (selfNouns) is never a permanent either
  const onStackOnly = (a: Antecedent): boolean => st.permanentOnly === true && a.nouns.length > 0 && a.nouns.every((n) => n === 'spell' || n === 'ability' || n === 'spell or ability' /* std-ry6 */ || n === 'instant' || n === 'sorcery');
  // std-exile-play-1-2 (CR 208.1, 208.3): an instant or sorcery has no power or toughness, so it is never the object of "its power" (RenderState.powerOf)
  const noPower = (a: Antecedent): boolean => st.powerOf === true && a.nouns.length > 0 && a.nouns.every((n) => n === 'instant' || n === 'sorcery');
  // Cloud std-fin (the parser's rule, parser/lower/anaphora.ts#unattachWhat): a creature is never what "unattach it" moves (CR 701.3d, 301.5c)
  const creatureOnly = (a: Antecedent): boolean => st.attachmentOnly === true && a.nouns.includes('creature');
  // std-rw9 (the parser's rule, parser/lower/anaphora.ts; CR 701.21a, 115.4): a target that may be a player is never what "sacrifice it" sacrifices
  const mayBePlayer = (a: Antecedent): boolean => st.sacrificeOnly === true && !a.player && a.nouns.includes('player');
  // edh-d-78 (the parser's rule, parser/lower/anaphora.ts, Mention verbs "sacrificed"; CR 701.21a, 400.7; Transmute Artifact): Oracle calls the permanent a step sacrificed "the sacrificed artifact" (RefInfo.alts), never "it",
  // beside another object of the ability that is not a card of a graveyard (the card a search found): "Sacrifice an artifact. If you do, search ... put it onto the battlefield."
  // edh-next-107 (the parser's rule, parser/lower/anaphora.ts#resolveIn, CR 509.1h; Simian Sling): the trigger "Whenever ~ or equipped creature becomes blocked" never names the blocking creature
  // (no `by` in any event), so it is no rival of the creature that became blocked, "it"
  const sacrificedNamed = (a: Antecedent): boolean => a.id !== mine && (st.info.get(a.id)?.alts ?? []).length > 0 && (st.info.get(a.id)?.alts ?? []).every((x) => x.startsWith('the sacrificed ')) && st.info.get(mine)?.zone !== 'graveyard' && st.info.get(mine) !== undefined;
  const silentBlocker = key === 'e:attacker' && info.player !== true && (st.trigger ?? []).length > 0 && st.trigger!.every((ev) => ev.ev === 'becomesBlocked' && ev.by === undefined) ? identityOf(st, 'e:blocker') : null;
  const others = antecedents(st).filter((a) => a.id !== mine && a.id !== st.notAntecedent && a.id !== silentBlocker && !onStackOnly(a) && !sacrificedNamed(a) && !noPower(a) && !creatureOnly(a) && !mayBePlayer(a) && a.player === (info.player === true) && a.plural === info.plural
    && !(st.info.get(a.id)?.hand === true && info.hand !== true) /* edh-c-104 (the parser's rule, parser/lower/mentions.ts, participleOnly: the whole hand a step looked at is named only by its own participle, never by "them" or "it"): not a rival of the cards chosen out of it */);
  // FAST2 T10 (the parser's rule, parser/lower/anaphora.ts#compatible, Mention.selfObject): while a trigger's events leave the object where it is, "that
  // creature" never names the object itself (Oracle calls it "~" or "it", CR 201.5)
  // FAST4 T29: ... nor while every zone change of the trigger is another object's ("Whenever another creature you control enters, ~ gets +X/+0 until end of
  // turn, where X is that creature's power": `other`, CR 109.4, so the object itself has not moved)
  // FAST4 T28: ... and while the object that moved can never be the object itself ("whenever another creature you control dies", "whenever a creature an
  // opponent controls dies": CR 109.2 "another", and the controller of the ability controls the object itself)
  const otherMoved = (ev: EventPattern): boolean => ev.ev === 'zoneChange' && (ev.subject.other === true || ev.subject.controller === 'opponent');
  // MX5: ... nor in the object's own "enters" trigger: it has not moved since it entered (CR 603.6a; the parser's rule, parser/lower/scope.ts#eventMentions)
  const selfEntered = (ev: EventPattern): boolean => ev.ev === 'zoneChange' && ev.subject.self === true && ev.to === 'battlefield';
  // edh-c-34 (the parser's rule, parser/lower/scope.ts#selfLeaves; CR 201.5): ... and in the object's own "dies" / "leaves the battlefield" trigger (Elder Cathar: "If that creature is a Human" is the target)
  const selfLeaves = (ev: EventPattern): boolean => ev.ev === 'zoneChange' && ev.subject.self === true && ev.from === 'battlefield';
  const damagedCreature = (st.trigger ?? []).length > 0 && st.trigger!.every((ev) => ev.ev === 'damage' && ev.recipient?.object !== undefined && ev.recipient.player === undefined && JSON.stringify(ev.recipient.object.types ?? []) === '["Creature"]' && ev.source?.self !== true); // edh-next-44
  // edh-d-25 (the parser's rule, parser/lower/scope.ts, attachedCombatSubject; Barrow-Blade): the other party of "Whenever equipped creature blocks or becomes blocked by a creature" is "that creature"
  const attachedCombat = key === 'e:object' && (st.trigger ?? []).length > 0 && st.trigger!.every((ev) => (ev.ev === 'blocks' ? ev.blocker?.attachedToSource === true : ev.ev === 'becomesBlocked' ? ev.attacker?.attachedToSource === true : false));
  const selfStays = (st.trigger ?? []).length > 0 && st.trigger!.every((ev) => ev.ev !== 'zoneChange' || otherMoved(ev) || selfEntered(ev) || selfLeaves(ev));
  // FAST5 T58 (the parser's rule, parser/lower/anaphora.ts#resolveAnaphor): in the object's own "enters" trigger, once the ability has targeted an object of
  // the same sort and number, a bare pronoun is never the object itself (Oracle then calls it "~" or "this creature", CR 201.5, 115.1)
  // std-rx17 (CR 702.110b; the parser's rule, parser/lower/scope.ts#eventMentions): ... and in its own "When ~ exploits a creature", which follows its enters trigger
  const selfExploits = (ev: EventPattern): boolean => ev.ev === 'action' && ev.verb === 'exploit' && ev.object?.self === true;
  const ownEnters = (st.trigger ?? []).length > 0 && st.trigger!.every((ev) => selfEntered(ev) || selfExploits(ev) || selfLeaves(ev)); // edh-c-34: ... and in its own "dies" trigger
  // std-rx11: ... and inside a delayed trigger that ability creates, for the target itself (RenderState.inOwnEnters)
  const targeted = (ownEnters && (mine.startsWith('t:') || others.some((a) => a.id.startsWith('t:') && a.implicit !== true))) || (st.inOwnEnters === true && mine.startsWith('t:'));
  // FAST5 T76 (the parser's rule, parser/lower/anaphora.ts#focusOf): the object the instruction right before created or put counters on is "it", whatever else was named
  const focused = info.player !== true && st.focus !== undefined && identityOf(st, st.focus) === mine
    // trek-7: a player named since the instruction began ("its owner", the owner of the very object in focus) is no candidate of an object's pronoun
    && antecedents(st).every((a) => a.id === mine || a.id === st.notAntecedent || st.focusSeen === undefined || st.focusSeen.has(a.id) || a.player);
  // Cloud std-eoe (the parser's rule, parser/lower/anaphora.ts#chosenFocus): the target "Choose up to one target creature." announced is what the first instruction
  // after it names, by a pronoun or by a noun
  const chosen = st.chosen !== undefined && st.chosen.key === key && info.player !== true;
  // cmd1 (the parser's rule, parser/lower/anaphora.ts#compatible, Mention.namedSelf, FAST5 T76; CR 201.5): the object a step of this ability names "~" is never
  // "that creature" while it has not moved (no binding is the moved object itself): "~ deals 1 damage to target creature. Goad that creature."
  const namedSelfStays = st.mentioned.has('self') && ![...st.info.values()].some((i) => i.sameAs === 'self');
  // cmd1 (CR 608.2f): inside "for each opponent, ..." the iterated player is "that opponent" (RefInfo.iterates)
  const iterates = st.info.get(key)?.iterates;
  // r5-fxb (parser/lower/anaphora.ts#damageAmountSource): "its" in the amount of damage a target deals is that target
  const ownSubject = st.ownSubject !== undefined && st.ownSubject === key && info.player !== true;
  // std-rx29 (the parser's rule, parser/lower/anaphora.ts#resolveAnaphor, std-rx12; CR 111.1, 608.2c): "that token" names the one object whose own words called it a
  // token ("create a 1/1 white Ally creature token ... on that token"), whatever permanent of a description that never says token was named besides it (Iroh, Tea Master)
  const saidToken = (n: string): boolean => n === 'token' && info.nouns.includes('token') && !others.some((a) => a.nouns.includes('token'));
  // std-exile-play-1-1: the player who looked at a card and exiled it face down is "they" in the permission to play it (RenderState.theyFocus)
  const theyFocus = info.player === true && !info.plural && st.theyFocus !== undefined && st.theyFocus === key;
  // edh-c-66 (the parser's rule, parser/lower/anaphora.ts#interveningAttached; CR 603.4, 608.2c; Volition Reins): in a trigger whose intervening "if" is about the enchanted or equipped
  // object alone ("When ~ enters, if enchanted permanent is tapped, untap it."), that object is "it", the Aura or Equipment itself being "~"
  const ic = st.interveningIf;
  const attachedTested = key === 'attached' && info.player !== true && ic !== undefined && ic.cond === 'matches' && ic.object.ref === 'attachedTo' && Object.keys(ic.object).length === 1;
  // edh-c-77 (the parser's rule, lower/anaphora.ts#resolveAnaphor, Mention.delayOwn): in the body of a delayed trigger, "its controller" is the object of the trigger's own event, whatever target the sentence that created it named
  const delayOwn = st.inDelayEvent === true && st.controllerOfPronoun === true && key.startsWith('e:') && !mine.startsWith('t:');
  // edh-d-61 (the parser's rule, parser/lower/anaphora.ts#resolveEventDelay with Mention.delayOwnSelf; CR 603.7c, 201.5; Golden Guardian): in the body of a delayed trigger whose event names the ability's own object
  // ("When ~ dies this turn, return it ..."), the event's object is "it", beside a target of the sentence that created the trigger
  const delayOwnSelf = st.inDelayEvent === true && key === 'e:subject' && info.player !== true && (st.trigger ?? []).length === 1 && st.trigger!.every((ev) => ev.ev === 'zoneChange' && ev.subject.is?.ref === 'self');
  // edh-next-87 (the parser's rule, parser/lower/anaphora.ts#resolveAnaphor, CR 608.2c, 115.1; Deathbringer Liege): a target of the ability is "it" beside the object of the trigger's own
  // event (the spell cast, the creature that died), which Oracle calls "that spell" / "that creature"
  const targetBesideEvent = info.player !== true && mine.startsWith('t:') && (st.trigger ?? []).length > 0 && others.length > 0 && others.every((a) => a.id.startsWith('e:') || a.id.startsWith('cast.') || a.id.startsWith('zoneChange.'));
  // edh-next-132 (the parser's rule for "for each <desc>, ... a copy of it"; CR 608.2c; Altaïr Ibn-La'Ahad): inside the loop over a group of objects, the object the loop is at is "it", beside the
  // ability's own permanent (the attacker of an attack trigger) and the objects other sentences named (only an object loop, `iterates` a list of nouns; a player loop keeps its words)
  const loopObject = Array.isArray(iterates) && info.player !== true && !info.plural;
  return { pronoun: chosen || focused || ownSubject || theyFocus || attachedTested || delayOwn || delayOwnSelf || targetBesideEvent || loopObject || others.every((a) => a.implicit === true || (targeted && a.id === 'self')), noun: (n) => chosen || (focused && n === 'card') || (typeof iterates === 'string' ? n === iterates || (iterates === 'opponent' && n === 'player' /* edh-players-3: unless another player was named ("Whenever a player casts a spell, for each opponent, ... that player"); "whenever you attack" names no defender */ && others.every((a) => a.implicit === true || !a.player || a.id === 'attacks.defender:null')) : iterates?.includes(n) === true) || saidToken(n) || !others.some((a) => canBeCalled(a.nouns, n) && !(a.nouns.length === 1 && a.nouns[0] === 'card' && IMPLICIT_SILENT_NOUNS.has(n) && OFF_FIELD_ZONES.has(st.info.get(a.id)?.zone ?? '') /* edh-d-90 (CR 109.2; Curse of Hospitality): a card in exile, a library, a hand or a graveyard is never "that creature" (a permanent word names an object on the battlefield) */) && !(n === 'spell' /* edh-cast-9 (CR 601.2a, 400.1): a card in a library is no spell (Counterbalance: "counter that spell if it has the same mana value as the revealed card") */ && st.info.get(a.id)?.zone === 'library') && !(n === 'ability' && a.id.startsWith('activate.source') /* edh-mana-keywords-5 (the parser's rule, parser/lower/scope.ts#eventMentions): the source of an activation is never "that ability" */) && !((selfStays || namedSelfStays) && a.id === 'self') && !(a.id.startsWith('becomes.subject:') && (n === 'spell' || n === 'ability' || n === 'spell or ability') /* edh-cast-8 (the parser's rule, parser/lower/anaphora.ts#compatible): what a spell or ability targets is not that spell or ability */) && !(damagedCreature && n === 'creature' && a.id.startsWith('damage.source') /* edh-next-44 (the parser's rule, parser/lower/scope.ts, neverSourceCreature): the creature dealt damage is "that creature", never the source */) && !(n === 'source' && a.id.startsWith('damage.object:') /* edh-players-23 (the parser's rule, parser/lower/scope.ts, neverSource): the permanent dealt damage is not "that source" */) && !(a.implicit === true && (IMPLICIT_SILENT_NOUNS.has(n) || (n === 'player' && mine.startsWith('ctrl:t:') /* edh-players-23 (the parser reads the literal words of eff.edhp23.itsController.maySacrificeIt.elseDamage): the controller of a target named by "its controller" is that player; an attack trigger that names no defender names no player */))) && !(a.entered === true && mine.startsWith('t:') /* edh-top-6: Mention.enteredObject */) && !(n === 'creature' && !mine.startsWith('t:') && a.id.startsWith('t:') && st.specs.get(a.id.slice(2))?.kind === 'anyTarget' /* edh-next-124 (the parser's rule, parser/lower/anaphora.ts#withoutAnyTargetAsCreature; Minsc & Boo): "any target" is never "that creature" */) && !(attachedCombat && n === 'creature' && (a.id === 'attached' || a.id === identityOf(st, 'e:subject')) /* edh-d-25 (the parser's rule, parser/lower/scope.ts, attachedCombatSubject): the equipped creature of a combat event is "equipped creature", never "that creature" */)) };
}

/** edh-d-90 (CR 109.2, 400.1): the zones whose objects are cards, never permanents. */
const OFF_FIELD_ZONES: ReadonlySet<string> = new Set(['exile', 'library', 'hand', 'graveyard']);

/** p2-damage-1 (the parser's rule, parser/lower/anaphora.ts#compatible): "that creature" never names an event role the clause leaves unnamed (Repercussion's damage source). */
const IMPLICIT_SILENT_NOUNS: ReadonlySet<string> = new Set(['creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'battle', 'permanent']);

/**
 * What an anaphor can say for something already named. With the state and the key of the reference, only the readings that name it uniquely are offered;
 * when there are none the position prints `AMBIGUOUS`, which no Oracle text matches (the ability cannot be written and stays manual).
 */
export function anaphor(info: RefInfo, form: Form, st?: RenderState, key?: string | null): Phrase {
  const nouns = info.nouns.length > 0 ? info.nouns : ['object'];
  const check = st !== undefined && key !== undefined && key !== null ? candidateCheck(st, key, info) : null;
  const nounOk = (n: string): boolean => (check ? check.noun(n) : true);
  const pronounOk = check ? check.pronoun : true;
  const pick = (pronouns: string[], phrases: (n: string) => string[], extra: string[] = []): string => {
    const options = [...(pronounOk ? pronouns : []), ...nouns.filter(nounOk).flatMap(phrases), ...extra];
    // no reading names it uniquely: the position gets text that no Oracle sentence has, so the paths of the gate that run through it fail (a position
    // that is itself optional, such as "under its controller's control", leaves the other readings alive)
    return alt(...(options.length === 0 ? [AMBIGUOUS] : options));
  };
  if (info.player && info.plural) {
    // STD-OTJ (CR 115.1): several player targets named before are "they" / "those players" (person 'pl': "they lose 1 life"); in a conjunction of verbs the subject is not repeated
    // edh-players-10: a group of opponents named by its kind is "those opponents" (the parser's holes/player.ts#W_THOSE_OPPONENTS)
    const those = (n: string): string => (n === 'opponent' ? 'those opponents' : 'those players');
    if (form === 'possessive') return { text: pick(['their'], (n) => [`${those(n)}'`]), plural: true, person: 'pl' };
    return { text: pick(form === 'object' ? ['them'] : ['they'], (n) => [those(n)]), plural: true, person: 'pl' };
  }
  if (info.player) {
    // std-control-1 and std-exile-play-1-1 (CR 102.3): a player the text calls an opponent is "that opponent's" too in the possessive ("that opponent's library",
    // the opponent an event named), as "that opponent" below
    if (form === 'possessive') return { text: pick(['their'], (n) => (n === 'opponent' ? ["that opponent's"] : ["that player's", "the player's"])), plural: false, person: 'sg' };
    // FAST3 T18: Oracle's singular "them" for one player ("~ deals 1 damage to them"), only when no group of objects named before could be "them" too
    const them = form === 'object' && st !== undefined && !antecedents(st).some((a) => !a.player && a.plural && a.implicit !== true) ? ['them'] : [];
    // r3-choose: ... and the readings the player's own mention adds ("the chosen player" after "Choose target opponent.", render/program.ts#chosenFirst)
    // cmd1 (CR 102.3): a player the text calls an opponent ("for each opponent, ...", an event of an opponent) is also "that opponent", as the parser reads it (Mention.heads)
    return { text: pick(them, (n) => (n === 'opponent' ? ['that opponent'] : ['that player', 'the player']), info.alts ?? []), plural: false, person: 'sg', ...(form === 'subject' && pronounOk ? { they: true } : {}) };
  }
  const extra = [...(info.alts ?? [])];
  // FAST4 T19: "that creature or planeswalker" (parser/holes/object.ts): only when each of the two nouns alone names it uniquely
  if (info.orNouns !== undefined && !info.plural && form !== 'possessive' && info.orNouns.every(nounOk)) extra.push(`that ${info.orNouns[0]} or ${info.orNouns[1]}`);
  // edh-c-106 (the parser's rule, parser/holes/object.ts, AnaphorInfo.otherParty; CR 608.2c): "the other creature" is the `object` role of the trigger's event (the creature dealt
  // damage, the creature blocked or blocking) whatever else the clause named, as the subject "enchanted creature" does not make it ambiguous
  if (!info.plural && !info.player && key === 'e:object' && form !== 'possessive' && st !== undefined && (st.trigger ?? []).length > 0) for (const n of nouns) if (IMPLICIT_SILENT_NOUNS.has(n)) extra.push(`the other ${n}`);
  if (!info.plural) {
    // Cloud r3-moved and r4-mech (one reading, built by both): a listed reading of one object is its possessive too ("the discarded card's mana value",
    // render/steps-cards.ts#discard; "the discovered card's mana value")
    if (form === 'possessive') return { text: pick(['its'], (n) => [`that ${n}'s`, `the ${n}'s`], (info.alts ?? []).map((x) => `${x}'s`)), plural: false, person: 'sg' };
    return { text: pick(['it'], (n) => [`that ${n}`, `the ${n}`], extra), plural: false, person: 'sg' };
  }
  const pron = form === 'possessive' ? 'their' : form === 'object' ? 'them' : 'they';
  // std-rx29: ... and the listed readings of the group in the possessive ("the chosen creatures' powers", render/steps-flow.ts#chooseObjects)
  if (form === 'possessive') return { text: pick([pron], (n) => [`those ${pluralize(n)}'`, `the ${pluralize(n)}'`], (info.alts ?? []).map((x) => `${x}'`)), plural: true, person: 'pl' };
  // FAST4 T30: the listed readings of the reference too (the plural search idiom of fold.ts#searchThenMove: "them")
  return { text: pick([pron], (n) => [`those ${pluralize(n)}`, `the ${pluralize(n)}`], extra), plural: true, person: 'pl' };
}

// ---------------------------------------------------------------------------
// Events: what a trigger exposes
// ---------------------------------------------------------------------------

export interface RoleInfo {
  /** Identity of what the role stands for: two roles of one trigger that are the same object share it. */
  id: string;
  info: RefInfo;
  /** The role is the object with the ability ("when ~ enters, ... it"). */
  isSelf: boolean;
  /** The role is the controller of the ability ("whenever you cast a spell, ... you"). */
  isYou: boolean;
}

const GENERIC_OBJECT: RefInfo = { nouns: ['permanent', 'creature', 'card'], plural: false };

function roleIn(ev: EventPattern, role: EventRole): { filter?: ObjectFilter; player?: PlayerPred; kind: 'object' | 'player'; slot: string } | null {
  // `slot` names the place of the event the role stands for: two roles of one event that are the same place ("subject" and "blocker") share it
  const obj = (filter: ObjectFilter | undefined, slot: string) => ({ kind: 'object' as const, filter, slot: `${ev.ev}.${slot}` });
  const ply = (player: PlayerPred | undefined, slot: string) => ({ kind: 'player' as const, player, slot: `${ev.ev}.${slot}` });
  switch (ev.ev) {
    case 'zoneChange':
      if (role === 'player') return ply(ev.subject.controller, 'controller');
      return role === 'subject' || role === 'newObject' ? obj(ev.subject, 'subject') : null;
    case 'cast':
      if (role === 'player') return ply(ev.player, 'player');
      // CMD2 (CR 113.6k): "when you cast ~": the spell of the event is the object itself ("copy it", "copy ~"), so its filter stays the bare `self`
      // edh-perms-21 (CR 115.9c): the one object a spell that "targets only a single X you control" targets, said by the description of X
      if (role === 'spellTarget') {
        const only = ev.spell?.targetsOnly as { ref?: string; filter?: ObjectFilter } | undefined;
        return only?.ref === 'each' && only.filter !== undefined ? obj(only.filter, 'spellTarget') : null;
      }
      return role === 'spell' || role === 'subject' || role === 'object' ? obj(ev.spell !== undefined && selfOnly(ev.spell) ? ev.spell : { ...(ev.spell ?? {}), stackKind: 'spell' }, 'spell') : null;
    case 'activate':
      if (role === 'player') return ply(ev.player, 'player');
      // edh-next-74 (CR 602.2, 107.3a; Magus Lucea Kane): the ability a clause names by the {X} in its activation cost is the ability itself
      if (role === 'spell' && ev.xInCost === true) return obj({ stackKind: 'ability' }, 'spell');
      // std-rx28 (CR 602.2): the ability itself, when the clause describes it ("you activate an ability that targets ...": "copy that ability")
      if (role === 'spell' && ev.activated !== undefined) return obj({ ...ev.activated, stackKind: 'ability' }, 'spell');
      // edh-mana-keywords-5 (CR 602.2; family activate-if-not-mana): the ability a plain activation trigger names ("Whenever you activate an ability, ... copy that ability") is the ability itself
      if (role === 'spell' && ev.ability === undefined && ev.manaAbility === false) return obj({ stackKind: 'ability' }, 'spell');
      // edh-next-11 (CR 606.3, 602.2; Rowan's Talent): the loyalty ability activated of enchanted planeswalker is "that ability" (copy that ability)
      // edh-next-65 (Chandra's Regulator): and the loyalty ability of any planeswalker a trigger names, "Whenever you activate a loyalty ability of a Chandra planeswalker, ... copy that ability"
      if (role === 'spell' && ev.ability === 'loyalty' && ev.manaAbility === undefined) return obj({ stackKind: 'ability' }, 'spell');
      return role === 'source' || role === 'subject' || role === 'spell' ? obj(ev.source, 'source') : null;
    case 'attacks':
      if (role === 'attacker' || role === 'subject') return obj(ev.attacker, 'attacker');
      // std-combat-1 (CR 508.1, 508.5; the parser's rule, parser/lower/scope.ts#eventMentions): "Whenever an opponent attacks with creatures, ... that opponent": the
      // clause names the attacking player and not whom the creatures attack, so the player is that opponent and the defender no antecedent
      if (ev.defender === undefined && ev.attacker?.controller === 'opponent' && ev.attacker.self === undefined && (role === 'player' || role === 'defender')) return role === 'player' ? ply('opponent', 'player') : null;
      // edh-zones-14 (CR 508.1, 506.3; the parser's rule, parser/lower/scope.ts#eventMentions): "Whenever an opponent attacks you [and/or one or more planeswalkers you control], ... that player":
      // the player attacked is "you", so the player is the opponent whose creatures attack and the defender no antecedent
      if (ev.defender === 'you' && ev.attacker?.controller === 'opponent' && ev.attacker.self === undefined && (role === 'player' || role === 'defender')) return role === 'player' ? ply('opponent', 'player') : null;
      // pc-combat-1 (CR 508.1, 303.4; the Curses, parser/lower/scope.ts#eventMentions): "Whenever a player attacks enchanted player with one or more creatures, ... they": the attacking player
      if (typeof ev.defender === 'object' && (ev.defender as { ref?: string }).ref === 'enchantedPlayer' && ev.attacker?.controller === undefined && ev.attacker?.self === undefined && (role === 'player' || role === 'defender')) return role === 'player' ? ply('any', 'player') : null;
      // edh-next-75 (CR 508.1, 725.1; the parser's rule, parser/lower/scope.ts#eventMentions; The Spear of Bashenga): "Whenever equipped creature attacks the monarch, ... that player": the monarch attacked, the attacker's controller no antecedent
      if (typeof ev.defender === 'object' && (ev.defender as { ref?: string }).ref === 'monarch' && ev.attacker !== undefined && (ev.attacker.self === true || ev.attacker.attachedToSource === true || ev.attacker.controller === 'you') && (role === 'player' || role === 'defender')) return role === 'player' ? null : ply('any', 'defender');
      // edh-d-88 (CR 508.1b; Owlbear Cub): "attacks a player who controls eight or more lands": "that player" is the player attacked
      if (typeof ev.defender === 'object' && (ev.defender as { ref?: string }).ref === 'controlsAny' && (ev.defender as { atLeast?: number }).atLeast !== undefined && ev.attacker?.self === true && (role === 'player' || role === 'defender')) return role === 'player' ? null : ply('any', 'defender');
      if (role === 'defender' || role === 'player') return typeof ev.defender === 'string' || ev.defender === undefined ? ply(ev.defender as PlayerPred | undefined, 'defender') : null;
      return null;
    case 'blocks':
      if (role === 'blocker' || role === 'subject') return obj(ev.blocker, 'blocker');
      return role === 'attacker' || role === 'object' ? obj(ev.attacker, 'attacker') : null;
    case 'attacksUnblocked': // std-rx35 (CR 509.1h)
      if (role === 'defender' && ev.defender === 'any') return ply('any', 'defender'); // edh-combat-6: "that player" after "attacks a player and isn't blocked"
      if (role === 'player' && ev.defender !== undefined && ev.attacker?.controller !== undefined && ev.attacker.self === undefined) return ply(ev.attacker.controller, 'player'); // pc-combat-4: "that player" is the opponent whose creatures attack
      return role === 'attacker' || role === 'subject' ? obj(ev.attacker, 'attacker') : null;
    case 'becomesBlocked':
      if (role === 'attacker' || role === 'subject') return obj(ev.attacker, 'attacker');
      if (role === 'defender') return ply(undefined, 'defender'); // edh-c-68 (CR 508.1b; Rakdos Roustabout): the player or planeswalker the blocked creature attacks
      return (role === 'blocker' || role === 'object') && ev.byAtLeast === undefined /* edh-c-48 (CR 509.3e): a group of blockers is no one creature */ ? obj(ev.by, 'blocker') : null;
    case 'damage':
    case 'damagePrevented': // edh-replace-3 (CR 615.13): the same roles as the damage that was prevented
      if (role === 'source' || role === 'subject') return obj(ev.source, 'source');
      if (role === 'recipient' || role === 'player') return ev.recipient?.player !== undefined ? ply(ev.recipient.player, 'recipient') : null;
      return role === 'object' ? obj(ev.recipient?.object, 'object') : null;
    case 'beginTurn':
      return role === 'player' ? ply(ev.whose, 'turn') : null;
    case 'step':
      return role === 'player' ? ply(ev.whose, 'turn') : null;
    case 'life':
    case 'draw':
    case 'dieRoll':
    case 'coinFlip': // cloud r3-mech
    case 'loseGame': // M12-3 (CR 603.9): the player who lost the game
    case 'monarch': // edh-players-18 (CR 725.3): the player who became the monarch
    case 'createToken':
      if (role === 'player') return ply(ev.player, 'player');
      return ev.ev === 'createToken' && (role === 'newObject' || role === 'subject') ? obj(ev.token, 'new') : null;
    // edh-next-132 (CR 701.20a, 607.2; God-Eternal Kefnet): edh-next-144's reveal this way: the player who revealed, and the revealed card (in the hand it was revealed in)
    case 'reveal':
      if (role === 'player') return ply(ev.player, 'player');
      return role === 'subject' ? obj({ ...(ev.card ?? {}), zone: 'hand' }, 'subject') : null;
    // Standard round 3, r3-trig (CR 108.4): the permanent whose control changed, and the player who gained control of it
    case 'controlChange':
      if (role === 'subject' || role === 'object') return obj(ev.object, 'subject');
      return role === 'player' ? ply(ev.to, 'player') : null;
    case 'becomes':
      if (role === 'object' && (ev.what === 'attached' || ev.what === 'unattached' /* edh-perms-10: what it left */) && ev.by !== undefined) return obj(ev.by, 'by'); // std-rx31: the permanent it became attached to
      if (role === 'subject' || role === 'object') return obj(ev.object, 'subject');
      if (role === 'player') return selfOnly(ev.object) ? null : ply(ev.object.controller, 'controller'); // edh-d-61 (the parser's rule, parser/lower/scope.ts, edh-d-26): the player of a "becomes" of the ability's own object is its controller, "you", never "that player" (Huntmaster of the Fells)
      return role === 'source' || role === 'spell' ? obj(ev.by, 'by') : null;
    case 'counters':
      if (role === 'subject' || role === 'object') return 'player' in ev.on ? null : obj(ev.on as ObjectFilter, 'subject');
      return role === 'player' && 'player' in ev.on ? ply((ev.on as { player: PlayerPred }).player, 'player') : null;
    case 'action':
      // edh-players-22 (CR 109.5; Karmic Justice, parser/lower/scope.ts + model/lint-roles.ts): "that opponent" is the controller of the spell or ability that destroys it
      if (role === 'by') return ev.verb === 'destroy' && ev.by !== undefined ? ply(ev.by, 'by') : null;
      if (role === 'player' && ev.verb === 'destroy' && ev.by !== undefined) return null;
      if (role === 'player') return ply(ev.actor, 'actor');
      // std-rf (CR 701.9a): the object of a discard that names no description is a card (a card in the graveyard once it is discarded): "that card"
      return role === 'subject' || role === 'object' ? obj(ev.object ?? (ev.verb === 'discard' ? { zone: 'graveyard', isCard: true } : undefined), 'object') : null;
    case 'resolves':
      // edhn102 (CR 714.2e; Narci, Fable Singer): the Saga a final chapter ability came from, said by its type
      if (role === 'abilitySource') return ev.what.stackKind === 'finalChapterAbility' ? obj({ subtypes: ['Saga'] }, 'abilitySource') : null;
      return role === 'subject' || role === 'spell' ? obj(ev.what, 'what') : null;
    // std-copy-6 (CR 603.2): the object whose triggered ability triggered, and that triggered ability ("copy that ability")
    case 'abilityTriggered':
      if (role === 'subject') return obj(ev.of, 'of');
      return role === 'spell' ? obj({ stackKind: 'ability', zone: 'stack' }, 'ability') : null;
    default:
      return null;
  }
}

/** The filter is exactly "the object itself". */
// FAST5X E3: a status the object has as the event happens ("~ attacks while saddled", CR 702.171b) still names the object itself (parser/lower/scope.ts#onlySelf)
// std-ro (CR 404.1): so does its owner ("When ~ is put into your graveyard from the battlefield": render/evt.ts#zoneChange), which describes the event, not another object
const selfOnly = (g: ObjectFilter): boolean => g.self === true
  && Object.keys(g).filter((k) => (g as Record<string, unknown>)[k] !== undefined && !(k === 'saddled' && g.saddled === true) && k !== 'owner').length === 1;

/**
 * FAST4 T30: the first event of the trigger that exposes `role` in the same place (`slot`, the same kind of event) with an object other than ~ alone: the
 * subjects of one predicate ("~ or another creature you control is turned face up"). Undefined when there is none (the combatant roles of "blocks or
 * becomes blocked by a creature" are other places).
 */
function otherRoleObject(role: EventRole, slot: string, st: RenderState): { filter?: ObjectFilter } | undefined {
  return (st.trigger ?? []).map((e) => roleIn(e, role)).find((o) => o !== null && o.kind !== 'player' && o.slot === slot && !selfOnly(o.filter ?? {})) ?? undefined;
}

/** trek-7: the slots of a combat event that name a creature in combat (roleIn). */
const COMBAT_SLOT = /^(attacks|attacksUnblocked|blocks|becomesBlocked)\.(attacker|blocker)$/;

/** The role as the trigger exposes it, or null when no event of the trigger has that role. */
function roleLookup(role: EventRole, st: RenderState): RoleInfo | null {
  for (const ev of st.trigger ?? []) {
    const r = roleIn(ev, role);
    if (!r) continue;
    if (r.kind === 'player') {
      // FAST4 T34 (CR 603.3a): the player of a zone change of the ability's own object ("When ~ enters") is the controller of that object, who controls the
      // ability: you, never another antecedent of "that player" ("When ~ enters, target opponent loses 3 life unless they discard a card")
      const ownMove = ev.ev === 'zoneChange' && r.slot === 'zoneChange.controller' && selfOnly(ev.subject);
      const you = ownMove || r.player === 'you' || (typeof r.player === 'object' && r.player !== null && r.player.ref === 'you');
      // FAST1 T4: whose step it is, when the event names that player by a reference ("enchanted creature's controller"), is that very player: one antecedent
      const named = r.slot === 'step.turn' && typeof r.player === 'object' && r.player !== null && (r.player.ref === 'controllerOf' || r.player.ref === 'target' /* edh-c-60: "That player skips their next untap step" after a target player */) ? playerKey(r.player) : null;
      // std-combat-1 and std-exile-play-1-1 (CR 102.3; the parser's rule, Mention.heads): a player the event calls an opponent ("deals combat damage to one of
      // your opponents") is also "that opponent"
      const nouns = r.player === 'opponent' ? ['player', 'opponent'] : ['player'];
      return { id: named ?? `${r.slot}:${JSON.stringify(r.player ?? null)}`, info: { nouns, plural: false, player: true }, isSelf: false, isYou: you };
    }
    const f = r.filter ?? {};
    // FAST4 T30 (CR 603.2): when another event of the same trigger exposes the role with an object other than ~ ("Whenever ~ or another creature you control
    // is turned face up, that creature deals damage ..."), the role is either object, never ~ alone: it reads as that other object ("that creature", "it")
    const otherObject = selfOnly(f) ? otherRoleObject(role, r.slot, st) : undefined;
    const self = selfOnly(f) && otherObject === undefined;
    // FAST5 T50 (CR 603.7c): the object a delayed trigger's event names by a reference alone ("When that creature dies this turn, ... its controller"; the pattern is
    // `{is: R}`, with at most a controller test) is that object: the role has the identity and the nouns of R, so the text calls it what it called R
    const refKey = !self && f.is !== undefined && Object.keys(f).every((k) => k === 'is' || k === 'controller' || (f as Record<string, unknown>)[k] === undefined) ? objKey(f.is as ObjRef) : null;
    const refInfo = refKey === null ? undefined : st.info.get(refKey);
    let nouns = self ? ['permanent'] : refInfo !== undefined && refInfo.nouns.length > 0 ? [...refInfo.nouns] : K.nounsOf(otherObject?.filter ?? f);
    // trek-7 (CR 508.1, 509.1; the parser's rule, parser/lower/scope.ts#roleObject): the attacker or blocker of a combat event is a creature on the battlefield, never a
    // card, whatever its description leaves open ("Whenever you attack, exile the top two cards of your library. ... you may play those cards": "those cards" are the
    // exiled ones, not the attackers)
    if (!self && refInfo === undefined && COMBAT_SLOT.test(r.slot) && !nouns.includes('creature')) nouns = [...new Set(['creature', ...nouns.filter((n) => n !== 'card'), 'permanent'])];
    // Standard round 5, r5-trig (CR 702.122b, 702.171c; Canyon Vaulter): the permanent of "~ saddles a Mount or crews a Vehicle" is either one: "that Mount or Vehicle"
    const trig = st.trigger ?? [];
    if (r.slot === 'becomes.subject' && trig.length === 2 && trig.some((x) => x.ev === 'becomes' && x.what === 'saddleCostPaid') && trig.some((x) => x.ev === 'becomes' && x.what === 'crewCostPaid')) nouns = ['mount or vehicle'];
    // std-rx28 (CR 602.2): the activated ability a clause describes ("you activate an ability that targets a creature or player") is "that ability"
    // (and its source is the permanent or card, never "that ability": parser/lower/scope.ts#roleObject, the same rule)
    if (r.slot === 'activate.spell') nouns = ['ability'];
    // edh-mana-keywords-4 (CR 120.3; Phyrexian Obliterator): the source of damage a clause leaves undescribed ("Whenever a source deals damage to ~") is also "that source" (family any-source-deals)
    if (r.slot === 'damage.source' && ev.ev === 'damage' && ev.source !== undefined && Object.values(ev.source).every((v) => v === undefined)) nouns = [...new Set([...nouns, 'source'])];
    // edh-players-23 (CR 120.3, 609.7; Elesh Norn): ... and the source a clause describes by who controls it alone ("Whenever a source an opponent controls deals damage to you or a permanent you control, that source's controller ...")
    if (r.slot === 'damage.source' && ev.ev === 'damage' && ev.source !== undefined && ev.source.controller !== undefined && Object.entries(ev.source).every(([k, v]) => k === 'controller' || v === undefined)) nouns = [...new Set([...nouns, 'source'])];
    if (r.slot === 'activate.source' && ev.ev === 'activate' && ev.activated !== undefined && ev.source === undefined) nouns = ['permanent', 'source'];
    // FAST2 T10: the object a zone change put into a graveyard, exile, a hand or a library is a card there (CR 400.7): "When enchanted creature dies, return
    // that card to the battlefield"; it comes back from that zone (the verb of moving it reads "return")
    const to = ev.ev === 'zoneChange' && r.slot === 'zoneChange.subject' && typeof ev.to === 'string' && ev.to !== 'battlefield' && ev.to !== 'stack' ? ev.to : undefined;
    // FAST2 T10: what targeted the object ("becomes the target of a spell or ability") is a spell or ability on the stack, never a permanent
    const targeting = ev.ev === 'becomes' && ev.what === 'targeted' && ev.by === undefined && r.slot === 'becomes.by';
    // FAST3 T14: the same for "a spell or ability an opponent controls" (a `by` with a controller but no kind of stack object): "that spell or ability"
    const targetingBy = ev.ev === 'becomes' && ev.what === 'targeted' && ev.by !== undefined && ev.by.stackKind === undefined && r.slot === 'becomes.by'
      && Object.keys(ev.by).every((k) => k === 'controller' || (ev.by as Record<string, unknown>)[k] === undefined);
    // FAST3 T18: the object roles of a batch trigger are a group (CR 603.2c; parser/lower/scope.ts#eventMentions): "those creatures", "them"
    // Standard round 5, r5-trig (CR 603.2c): ... but the creature of "one or more counters are put on a creature" is one creature (one occurrence each, the scope rule)
    const plural = st.triggerBatch === true && !(ev.ev === 'counters' && r.slot === 'counters.subject' && st.triggerWholeBatch !== true && f.self !== true);
    // std-rD (CR 701.9a, 400.7): the object of a discard is a card ("Whenever you discard a card, exile that card from your graveyard"), wherever the discard put it
    // (a graveyard, or exile with madness, CR 702.35a): it is "that card", and no zone is implied
    if (ev.ev === 'action' && ev.verb === 'discard' && r.slot === 'action.object' && !self && !nouns.includes('card')) nouns = [...nouns, 'card'];
    // edh-misc-2 (CR 111.7, 400.7, 701.21a): ... and so is a nontoken permanent that was sacrificed ("Whenever an opponent sacrifices a nontoken permanent, put that
    // card onto the battlefield under your control"): a card in its owner's graveyard; a token is not a card and ceases to exist there, so a sacrifice without
    // "nontoken" keeps the permanent's own nouns
    // edh-next-138 (CR 111.7, 400.7, 701.21a; Desert Warfare): ... and a sacrificed permanent of no "nontoken" too ("Whenever you sacrifice a Desert and whenever a Desert card is put into your
    // graveyard from your hand or library, put that card onto the battlefield ..."): "that card" names the card the sacrifice put into a graveyard, which a token never is (it ceases to exist
    // there, CR 111.7, so the instruction finds nothing to move; effects/handlers/zones.ts)
    if (ev.ev === 'action' && ev.verb === 'sacrifice' && r.slot === 'action.object' && !self && !nouns.includes('card')) nouns = [...nouns, 'card'];
    // std-ry6 (CR 115.1, 701.6a; Glyph Keeper): Oracle names what targeted the object "that spell or ability" with no `by` too ("counter that spell or ability"),
    // as FAST3 T14's `by` form; the parser's mention has both heads (parser/holes/object.ts, W_SPELL_OR_ABILITY)
    // p2-graveyard-1 (CR 400.7, 700.4): ... and so is one a zone change put into either of several such zones ("When enchanted permanent dies or is put into exile,
    // return that card to the battlefield", Kaya's Ghostform): a card there, in no one zone the text names
    const toAnyOf = ev.ev === 'zoneChange' && r.slot === 'zoneChange.subject' && Array.isArray(ev.to) && ev.to.length > 0 && ev.to.every((z) => z !== 'battlefield' && z !== 'stack');
    const info: RefInfo = to !== undefined ? { nouns: [...new Set([...nouns, 'card'])], plural, zone: to }
      : toAnyOf ? { nouns: [...new Set([...nouns, 'card'])], plural }
      : targeting || targetingBy ? { nouns: ['spell or ability', 'spell', 'ability'], plural }
      // edh-next-74 (CR 601.2i, 602.2, 707.10; Magus Lucea Kane, Repeated Reverberation, Unbound Flourishing): the spell cast or the ability activated of one clause is "that spell or ability"
      : r.slot === 'cast.spell' && !plural && (st.trigger ?? []).some((x) => x.ev === 'activate' && (x.xInCost === true || x.ability === 'loyalty') && x.activated === undefined) ? { nouns: ['spell or ability', 'spell', 'ability'], plural }
      : { nouns, plural };
    // edh-perms-21 (CR 115.9c; Vesuvan Duplimancy): the one object a spell that "targets only a single artifact or creature you control" targets is also "that artifact or creature"
    if (r.slot === 'cast.spellTarget' && !plural) {
      const or = orNounsOf({ types: f.types });
      if (or !== undefined) info.orNouns = or;
    }
    // FAST4 T33: the blocker of a block trigger is also "the blocking creature" (CR 509.1; the parser's participle anaphor names only that role)
    if (r.slot.endsWith('.blocker') && !self && !plural && to === undefined) info.alts = [...(info.alts ?? []), 'the blocking creature'];
    // edh-c-48 (CR 508.1, 603.2; Seifer, Balamb Rival): the attacker of a combat trigger that says "attacking" ("a creature attacking one of your opponents") is also "that attacking creature"
    if (r.slot.endsWith('.attacker') && !self && !plural && to === undefined && f.attacking !== undefined && f.attacking !== false) info.alts = [...(info.alts ?? []), 'that attacking creature'];
    // FAST5 T40: a role that is exactly one target ("If that permanent would die this turn": the replaced event's subject is `{is: target t0}`) is that target, not a
    // second thing named: "that permanent" names it uniquely (Essence Burn)
    const rf = r.filter as { is?: { ref?: string; id?: string } } | undefined;
    const sole = rf !== undefined && Object.keys(rf).length === 1 && rf.is?.ref === 'target' && typeof rf.is.id === 'string' ? `t:${rf.is.id}` : undefined;
    // FAST5 T50: an object a step named earlier (`is` that object) is that object
    return { id: refInfo !== undefined && refKey !== null ? (refInfo.sameAs ?? refKey) : (sole ?? `${r.slot}:${JSON.stringify(r.filter ?? null)}`), info, isSelf: self, isYou: false };
  }
  return null;
}

/**
 * What an event role stands for. A trigger (or a replaced event) that does not expose the role is an error of the JSON: the renderer refuses it instead of
 * printing some object (design 3.5: the valid roles per event). Without any event (a spell ability) the role is a generic object.
 */
export function roleInfo(role: EventRole, st: RenderState): RoleInfo {
  const found = roleLookup(role, st);
  if (found) return found;
  if (st.trigger !== null && st.trigger.length > 0) throw new NoRenderer(`event role ${role} (the event does not expose it)`);
  return { id: `role:${role}`, info: GENERIC_OBJECT, isSelf: false, isYou: false };
}

const ROLES: EventRole[] = ['subject', 'object', 'source', 'player', 'recipient', 'spell', 'attacker', 'blocker', 'defender', 'newObject', 'spellTarget', 'abilitySource'];

/** The roles that events expose, with what each is (for tests that need a valid `{ref:'event'}`). */
export function eventRoles(events: EventPattern[]): { role: EventRole; kind: 'object' | 'player' }[] {
  const out: { role: EventRole; kind: 'object' | 'player' }[] = [];
  for (const role of ROLES) {
    for (const ev of events) {
      const r = roleIn(ev, role);
      if (r) {
        out.push({ role, kind: r.kind });
        break;
      }
    }
  }
  return out;
}

/** The event text names every role of its events ("a creature you control blocks a creature" names the blocker and the attacker): they are antecedents from now on. */
export function markTriggerRoles(st: RenderState): void {
  // PUSH1 T2: a role the event never fills, or one the clause does not name, is no antecedent (model/lint-roles.ts#silentRole, the parser's rule)
  // FAST5 T59: a role of a disjunction is an antecedent only when every event exposes it (parser/lower/scope.ts#eventMentions reads the same rule): "becomes tapped or is
  // dealt damage" has the damaged creature as `object` in both events, and the damage's source is no antecedent of the creature that became tapped
  const trig = st.trigger ?? [];
  const everyExposes = (role: EventRole): boolean => trig.length < 2 || trig.every((e) => (EVENT_ROLES[e.ev] ?? []).includes(role));
  // edh-c-72 (CR 509.1; Gift of the Woods): the other combatant (`object`) of a disjunction of "blocks" and "becomes blocked" is no antecedent beside the creature itself, as the parser reads it
  // (parser/lower/scope.ts#eventMentions): "Whenever enchanted creature blocks or becomes blocked, it gets +0/+3 until end of turn"
  const combatOnly = trig.length > 1 && trig.every((e) => (e.ev === 'blocks' && e.attacker === undefined && e.blocker?.attachedToSource === true) || (e.ev === 'becomesBlocked' && e.by === undefined && e.attacker?.attachedToSource === true)); // only for the creature an Aura or Equipment is attached to, while the clause names no other combatant ("blocked by a creature, that creature ..." keeps it as an antecedent; std-rx16's "a creature you control blocks or becomes blocked, it" stays manual)
  for (const role of ROLES) if (roleLookup(role, st) !== null && everyExposes(role) && !silentRole(trig, role) && !(combatOnly && role === 'object')) st.mentioned.add(`e:${role}`);
  // FAST4 T30: "Whenever ~ or another creature you control is turned face up, that creature ...": the "~" of the trigger is one of the objects of a role that is
  // either object (roleLookup), no antecedent of its own, as the parser reads it (parser/lower/scope.ts#eventMentions names only the roles)
  const mixed = ROLES.some((role) => {
    const first = (st.trigger ?? []).map((e) => roleIn(e, role)).find((o) => o !== null);
    return first !== undefined && first !== null && first.kind === 'object' && selfOnly(first.filter ?? {}) && otherRoleObject(role, first.slot, st) !== undefined;
  });
  if (mixed) st.mentioned.delete('self');
  // std-rx19 (CR 115.1, 109.5): the opponent who controls the spell or ability that targeted is "that player" (parser/lower/scope.ts#eventMentions, the same rule)
  if (trig.length > 0 && trig.every(opponentTargets)) mention(st, playerKey(TARGETING_CONTROLLER), { nouns: ['player'], plural: false, player: true });
}

// ---------------------------------------------------------------------------
// Counts and target specs
// ---------------------------------------------------------------------------

function countWord(c: number | 'any' | Quantity, st: RenderState): string {
  // FAST5 T69 (CR 107.3c): the count of targets that the sentence defines with "where X is ..." is said "x" (RenderState.xCount)
  if (typeof c === 'object' && st.xCount !== undefined && st.xCount === JSON.stringify(c)) return 'x';
  // r4-fxz (CR 608.2c, 608.2h): the number of things an earlier instruction of the ability did is also "that many" ("Sacrifice any number of artifacts, ... Return
  // that many creature cards from your graveyard to the battlefield"), as a draw says it (render/steps-cards.ts)
  if (typeof c === 'object' && c.q === 'resultCount' && c.which === undefined && st.info.has(`r:${c.step}`)) return alt(K.qty(c, st), 'that many');
  // std-ra (CR 603.12, 608.2c): in a reflexive trigger that waits for what an instruction moved, the count of those objects is
  // "that many" ("When you discard one or more nonland cards this way, tap up to that many target creatures"), the only number that sentence names
  if (typeof c === 'object' && c.q === 'resultCount' && c.which !== undefined && st.movedThatMany === JSON.stringify({ step: c.step, which: c.which })) return 'that many';
  return typeof c === 'number' ? numWord(c) : c === 'any' ? 'any number' : K.qty(c, st);
}

function targetCount(spec: TargetSpec, st: RenderState): { count?: string; plural: boolean } {
  return rangeWords(spec.min, spec.max, st);
}

/** The words for a range of things chosen or targeted: none for exactly one, "up to one", "up to two", "one or two", "any number of", "X". */
export function rangeWords(min: Count, max: Count, st: RenderState): { count?: string; plural: boolean } {
  if (min === 1 && max === 1) return { plural: false };
  if (min === 0 && max === 1) return { count: 'up to one', plural: false };
  if (typeof min === 'number' && typeof max === 'number') {
    if (min === max) return { count: numWord(min), plural: true };
    if (min === 0) return { count: `up to ${numWord(max)}`, plural: true };
    if (max === min + 1) return { count: `${numWord(min)} or ${numWord(max)}`, plural: true };
    // FAST4 T34 (CR 601.2c): Oracle lists the three counts, "one, two, or three target attacking or blocking creatures"
    if (min === 1 && max === 3) return { count: alt('one to three', 'one, two, or three'), plural: true };
    return { count: `${numWord(min)} to ${numWord(max)}`, plural: true };
  }
  if (max === 'any') {
    if (min === 0) return { count: 'any number of', plural: true };
    if (min === 1) return { count: 'one or more', plural: true };
    if (typeof min === 'number') return { count: `${numWord(min)} or more`, plural: true };
  }
  if (typeof min !== 'number' || typeof max !== 'number') {
    const lo = typeof min === 'number' ? numWord(min) : countWord(min, st);
    const hi = typeof max === 'number' ? numWord(max) : countWord(max, st);
    if (lo === hi) return { count: lo, plural: true };
    if (min === 0) return { count: `up to ${hi}`, plural: true };
    return { count: `${lo} to ${hi}`, plural: true };
  }
  return { plural: true };
}

/** FAST4 T34: the one subtype of an `anyTarget` spec whose filter is exactly "not of that subtype", or null. */
function notOneSubtype(spec: TargetSpec): string | null {
  const f = spec.filter;
  if (spec.kind !== 'anyTarget' || f === undefined) return null;
  const keys = Object.entries(f).filter(([, v]) => v !== undefined).map(([k]) => k);
  if (keys.length === 1 && keys[0] === 'commander' && f.commander === false) return 'commander'; // CMD2 (CR 903.3): "any target that isn't a commander"
  return keys.length === 1 && keys[0] === 'notSubtypes' && f.notSubtypes!.length === 1 ? f.notSubtypes![0]! : null;
}

/**
 * CLOUD std-msh (CR 115.4, 109.2): an `anyTarget` spec whose filter is exactly `other: true`, "any other target" with no earlier target in its sequence: other than
 * this object (parser/lower/targets.ts#specOf). A player is never this object, so only the permanents are narrowed (rules/targets.ts#targetOptions).
 */
function otherThanThis(spec: TargetSpec): boolean {
  const f = spec.filter;
  if (spec.kind !== 'anyTarget' || f === undefined) return false;
  const keys = Object.entries(f).filter(([, v]) => v !== undefined).map(([k]) => k);
  return keys.length === 1 && keys[0] === 'other' && f.other === true;
}

/**
 * edh-top-15 (CR 115.4, 608.2b; Toralf, God of Fury): an `anyTarget` spec whose filter is exactly `{not: {is: <reference>}}`, "any target other than that permanent": the object the
 * reference names is no legal target, a player always is (rules/targets.ts#targetOptions narrows the objects only). The reference, or null.
 */
function otherThanRef(spec: TargetSpec): ObjRef | null {
  const f = spec.filter;
  if (spec.kind !== 'anyTarget' || f === undefined) return null;
  const keys = Object.entries(f).filter(([, v]) => v !== undefined).map(([k]) => k);
  const not = f.not;
  if (keys.length !== 1 || keys[0] !== 'not' || not === undefined || Object.entries(not).filter(([, v]) => v !== undefined).length !== 1 || not.is === undefined) return null;
  return not.is;
}

/** FAST5 T66: "total mana value 6 or less", the limit of a group chosen together (CR 115.1; `TargetSpec.groupLimit`, `chooseObjects.groupLimit`). */
export function totalLimitWords(g: { stat: string; cmp: { op: string; value: Quantity } }, st: RenderState): string {
  return `total ${g.stat === 'manaValue' ? 'mana value' : g.stat} ${limitPhrase(g.cmp, st)}`;
}

/** cloud std-spm: the kinds of ability an item of a list of things on the stack names (parser/holes/object.ts#stackItemLists). */
const STACK_ITEM_HEAD: Readonly<Record<string, string>> = { activatedAbility: 'activated ability', triggeredAbility: 'triggered ability' };

/**
 * cloud std-spm (CR 115.1, 113.3b-c): the filter of "target instant spell, sorcery spell, or triggered ability" exactly: `{anyOf: [items]}` and nothing else, each
 * item a spell description (`stackKind: 'spell'` and words of its own, no zone, no nested list) or one kind of ability alone, at least one of each. Null otherwise.
 */
function stackItemsOf(f: ObjectFilter): ObjectFilter[] | null {
  const items = f.anyOf;
  if (items === undefined || items.length < 2 || Object.entries(f).some(([k, v]) => v !== undefined && k !== 'anyOf')) return null;
  for (const x of items) {
    const keys = Object.keys(x).filter((k) => (x as Record<string, unknown>)[k] !== undefined);
    if (x.stackKind === 'spell') {
      if (x.zone !== undefined || x.anyOf !== undefined || x.not !== undefined) return null;
    } else if (x.stackKind === undefined || STACK_ITEM_HEAD[x.stackKind] === undefined || keys.length !== 1) return null;
  }
  // edh-cast-15 (CR 115.1; Subtlety): or two or more spell descriptions alone, "target creature spell or planeswalker spell" (parser/holes/object.ts#stackItemLists)
  if (!items.some((x) => x.stackKind === 'spell')) return null;
  return items;
}

/** edh-next-134: the one target spec "target permanent another player controls that shares a card type with it" chosen by the controller of the event's object ("its controller chooses ..."). */
export function isEventSubjectChooserSpec(spec: TargetSpec): boolean {
  const subject = '{"ref":"event","role":"subject"}';
  return spec.kind === 'object' && spec.min === 1 && spec.max === 1 && JSON.stringify(spec.chooser) === `{"ref":"controllerOf","object":${subject}}`
    && JSON.stringify(spec.filter) === `{"not":{"controller":{"ref":"controllerOf","object":${subject}}},"sharesWith":{"with":${subject},"quality":"cardType"}}`
    && Object.keys(spec).every((k) => ['id', 'kind', 'min', 'max', 'text', 'chooser', 'filter'].includes(k));
}

export function specPhrase(spec: TargetSpec, st: RenderState, extra: NpOpts = {}): string {
  // design 3.6: a field of a target spec that the text cannot show would be announced to the player without being in the card's words
  if (spec.chooser === undefined) return specPhraseBase(spec, st, extra);
  // edh-d-87 (CR 601.2c, 601.7a; Bladegriff Prototype): "target nonland permanent of that player's choice that one of your opponents controls": one target of the permanents any opponent
  // controls, chosen by the player of the event (another opponent when that player has left, `chooserElse`)
  if (spec.chooserElse === 'anOpponent') {
    const c = spec.chooser as { ref?: string; role?: string };
    if (spec.kind !== 'object' || spec.min !== 1 || spec.max !== 1 || spec.filter?.controller !== 'opponent' || c.ref !== 'event' || (c.role !== 'recipient' && c.role !== 'player')) throw new NoRenderer(`target ${spec.id} is chosen by another player`);
    return `${specPhraseBase({ ...spec, filter: { ...spec.filter, controller: undefined } }, st, extra)} of that player's choice that one of your opponents controls`;
  }
  // edh-next-146 (CR 601.7, 601.7a; Arena): "target creature of an opponent's choice they control": an opponent chooses the one target among the permanents they control
  if (spec.chooserControls === true) {
    const f = spec.filter;
    if (spec.kind !== 'object' || spec.min !== 1 || spec.max !== 1 || (spec.chooser as { ref?: string }).ref !== 'anOpponent' || f === undefined || f.controller !== 'opponent') throw new NoRenderer(`target ${spec.id} is chosen by another player`);
    const { controller: _c, ...rest } = f;
    return `${specPhraseBase({ ...spec, filter: rest }, st, extra)} of an opponent's choice they control`;
  }
  // edh-c-103 (CR 601.2c, 601.7; The Abyss): "target nonartifact creature that player controls of their choice": one target of the permanents the event's player controls, chosen by
  // that same player; nothing else a chooser can say is worded
  // edh-next-134 (CR 603.3d, 601.2c, 205.2a; Confusion in the Ranks): the controller of the triggering event's object chooses one target permanent of another player that shares a card
  // type with that object: its one wording (render/fold-edhn134.ts#chooseThenExchange says the sentence)
  if (isEventSubjectChooserSpec(spec)) {
    st.used.add(spec.id);
    return 'target permanent another player controls that shares a card type with it';
  }
  // edh-d-74 (CR 601.2c, 601.7a; Karplusan Minotaur): "any target of an opponent's choice": one any-target chosen by an opponent (the controller picks which one in a multiplayer game)
  if (spec.kind === 'anyTarget' && spec.min === 1 && spec.max === 1 && JSON.stringify(spec.chooser) === '{"ref":"anOpponent"}' && spec.random !== true) return `${specPhraseBase(spec, st, extra)} of an opponent's choice`;
  const ctl = spec.filter?.controller as { ref?: string; role?: string } | undefined;
  const ch = spec.chooser as { ref?: string; role?: string };
  if (spec.kind !== 'object' || spec.min !== 1 || spec.max !== 1 || ctl === undefined || typeof ctl !== 'object' || ctl.ref !== 'event' || ctl.role !== 'player' || (ch.ref !== 'active' && !(ch.ref === 'event' && ch.role === 'player'))) {
    throw new NoRenderer(`target ${spec.id} is chosen by another player`);
  }
  return `${specPhraseBase(spec, st, extra)} of their choice`;
}

function specPhraseBase(spec: TargetSpec, st: RenderState, extra: NpOpts = {}): string {
  st.used.add(spec.id);
  const dealtAny = spec.kind === 'anyTarget' && JSON.stringify(spec.players) === '{"who":"any","dealtDamage":true}' && JSON.stringify(spec.filter) === '{"dealtDamageThisTurn":true}'; // edh-next-86 (Needle Drop)
  if (spec.players !== undefined && spec.kind !== 'player' && spec.kind !== 'objectOrPlayer' && !dealtAny) throw new NoRenderer(`target ${spec.id}: players on a ${spec.kind} target`);
  // FAST4 T34 (CR 115.4): "any target that isn't a Dragon" is the one filter an `anyTarget` spec may have (parser/holes/object.ts#mixedTargets)
  const notOne = notOneSubtype(spec);
  const notThis = otherThanThis(spec); // CLOUD std-msh: "any other target" (other than this object, CR 109.2)
  const notRef = otherThanRef(spec); // edh-top-15: "any target other than that permanent"
  if (!dealtAny && spec.filter !== undefined && Object.values(spec.filter).some((v) => v !== undefined) && (spec.kind === 'player' || (spec.kind === 'anyTarget' && notOne === null && !notThis && notRef === null))) throw new NoRenderer(`target ${spec.id}: a filter on a ${spec.kind} target`);
  if (spec.groupLimit !== undefined && (spec.kind === 'player' || spec.kind === 'anyTarget' || (spec.kind === 'stackObject' && !spec.filter?.stackKind))) throw new NoRenderer(`target ${spec.id}: a total limit on a ${spec.kind} target`);
  const f: ObjectFilter = spec.filter ?? {};
  const { count, plural } = targetCount(spec, st);
  const other: { other?: true } = (spec.distinctFrom?.length ?? 0) > 0 ? { other: true } : {};
  const tail = spec.groupLimit ? ` with ${totalLimitWords(spec.groupLimit, st)}` : '';
  // FAST3 T14: "from a single graveyard" (TargetSpec.sameOwner) is a restriction only an object target's zone words can say
  if (spec.sameOwner === true && spec.kind !== 'object') throw new NoRenderer(`target ${spec.id}: one owner for a ${spec.kind} target`);
  if (spec.differentNames === true && (spec.kind !== 'object' || !plural)) throw new NoRenderer(`target ${spec.id}: different names for a ${spec.kind} target or a single target`);
  if (spec.differentManaValues === true && (spec.kind !== 'object' || !plural || spec.filter?.manaValue === undefined)) throw new NoRenderer(`target ${spec.id}: different mana values for a ${spec.kind} target, a single target or a filter with no mana value`); // edh-top-3
  // CLOUD std-ecl (CR 205.3m): "two target creature cards that share a creature type" is said by the noun phrase (render/np.ts), in front of or behind the zone
  if (spec.sharedCreatureType === true && (spec.kind !== 'object' || !plural || count === undefined)) throw new NoRenderer(`target ${spec.id}: a shared creature type for a ${spec.kind} target or a single target`);
  const opts = {
    det: 'target' as const, plural, count, ...(spec.sameOwner === true ? { singleZone: true } : {}), ...(spec.differentNames === true ? { differentNames: true } : {}), ...(spec.differentManaValues === true ? { differentManaValues: true } : {}),
    ...(spec.sharedCreatureType === true ? { shareCreatureType: true } : {}), ...(spec.distinctFrom?.length === 2 ? { third: true } : {}), ...extra,
  };
  switch (spec.kind) {
    case 'anyTarget': {
      // CR 115.3: "another target" differs from "any target" (the same object may not be chosen twice)
      const another = other.other === true;
      if (dealtAny) {
        if (count !== undefined || another) throw new NoRenderer(`target ${spec.id}: several or other targets that were dealt damage`);
        return 'any target that was dealt damage this turn';
      }
      // FAST4 T30 (family any-other-target): Oracle also prints "any other target" for the second of two "any target" recipients
      if (notOne !== null) {
        if (count !== undefined || another) throw new NoRenderer(`target ${spec.id}: several or other targets that aren't a ${notOne}`);
        return `any target that isn't ${withArticle(notOne)}`;
      }
      // edh-top-15 (CR 115.4, 608.2b): "any target other than that permanent"
      if (notRef !== null) {
        if (count !== undefined || another) throw new NoRenderer(`target ${spec.id}: several or other targets other than a named object`);
        return `any target other than ${obj(notRef, st, 'object').text}`;
      }
      // CLOUD std-msh (CR 115.4, 109.2): "he deals damage equal to ... to any other target": no earlier target, so "other" is other than this object
      if (notThis) {
        if (another) throw new NoRenderer(`target ${spec.id}: other than this object and other than earlier targets`);
        return count === undefined ? alt('any other target', 'another target') : `${count} other ${plural ? 'targets' : 'target'}`;
      }
      // edh-c-39 (CR 115.4, 601.2c, 603.3d; Goblin Test Pilot): "any target chosen at random": one target the game picks among the legal ones (the parser reads only one such target)
      if (spec.random === true) {
        if (count !== undefined || another || plural) throw new NoRenderer(`target ${spec.id}: chosen at random other than one any target`);
        return 'any target chosen at random';
      }
      if (count === undefined) return another ? alt('another target', 'any other target', ...(spec.distinctFrom?.length === 2 ? ['a third target'] : [])) : 'any target'; // edh-c-53: the third of three (Cone of Flame; family third-target)
      return `${count}${another ? ' other' : ''} ${plural ? 'targets' : 'target'}`;
    }
    case 'player': {
      const who = spec.players?.who ?? 'any';
      const noun = who === 'opponent' ? 'opponent' : 'player';
      const word = plural ? pluralize(noun) : noun;
      // edh-cast-15 (CR 115.1; The Lord of Pain): "another target player" beside the player of the trigger's event (the player who cast the spell), no other reference
      // edh-c-14 (CR 115.1, 608.2b; Splinter, Aging Champion): also "you and another target player" (not you)
      const otherThan = spec.players?.otherThan;
      if (otherThan !== undefined && JSON.stringify(otherThan) !== '{"ref":"ownerOf","object":{"ref":"self"}}' && (!(JSON.stringify(otherThan) === JSON.stringify({ ref: 'event', role: 'player' }) || JSON.stringify(otherThan) === '{"ref":"you"}') || who !== 'any' || count !== undefined || plural)) throw new NoRenderer(`target ${spec.id}: a player other than a reference other than the event's player, or with a count`);
      // edh-d-47 (CR 115.1, 108.3, 608.2b; Crown of Doom): "target player other than ~'s owner": one target player who is not the owner of this object
      if (otherThan !== undefined && JSON.stringify(otherThan) === '{"ref":"ownerOf","object":{"ref":"self"}}') {
        if (who !== 'any' || count !== undefined || plural || other.other === true) throw new NoRenderer(`target ${spec.id}: a player other than this object's owner with a count, "other" or an opponent`);
        return `target player other than ${K.player(otherThan, st, 'object').text}`;
      }
      const another = other.other === true || otherThan !== undefined;
      // edh-cast-13 (CR 510.2; Hope of Ghirapur): the player this object dealt combat damage to this turn
      const dealt = spec.players?.dealtCombatDamageBySource === true ? ' who was dealt combat damage by ~ this turn' : '';
      if (dealt !== '' && (who !== 'any' || count !== undefined || plural || another)) throw new NoRenderer(`target ${spec.id}: a player dealt combat damage by this object with a count, "other" or an opponent`);
      // edh-c-34 (CR 119.3; Rix Maadi Guildmage): the player who has lost life this turn, one target
      const lostLife = spec.players?.lostLife === true ? ' who lost life this turn' : '';
      if (lostLife !== '' && (count !== undefined || plural || another || dealt !== '')) throw new NoRenderer(`target ${spec.id}: a player who lost life this turn with a count, "other" or a player dealt combat damage`);
      // trek-16 (CR 500.1; Cmdr. Troi): the opponent whose turn it is, one target
      const turnOf = spec.players?.activePlayer === true ? ' whose turn it is' : '';
      if (turnOf !== '' && (who !== 'opponent' || count !== undefined || plural || another || dealt !== '')) throw new NoRenderer(`target ${spec.id}: the player whose turn it is with a count, "other" or a player who is not an opponent`);
      // edh-c-14 (CR 601.2c, 603.3d; Witch Hunt): "target opponent chosen at random": one target player the game picks (the parser reads only one target of an opponent)
      const atRandom = spec.random === true ? ' chosen at random' : '';
      if (atRandom !== '' && (who !== 'opponent' || count !== undefined || plural || another || dealt !== '' || turnOf !== '')) throw new NoRenderer(`target ${spec.id}: chosen at random other than one target opponent`);
      if (lostLife !== '' && (turnOf !== '' || atRandom !== '')) throw new NoRenderer(`target ${spec.id}: a player who lost life this turn whose turn it is or chosen at random`);
      if (count === undefined) return `${another ? 'another ' : ''}target ${word}${dealt}${lostLife}${turnOf}${atRandom}`;
      return `${count}${another ? ' other' : ''} target ${word}`;
    }
    case 'spell':
      return `${K.np({ ...f, ...other, stackKind: f.stackKind ?? 'spell' }, st, opts)}${tail}`;
    case 'ability':
      return `${K.np({ ...f, ...other, stackKind: f.stackKind ?? 'ability' }, st, opts)}${tail}`;
    case 'stackObject': {
      if (f.stackKind) return `${K.np({ ...f, ...other }, st, opts)}${tail}`;
      // cloud std-spm (CR 115.1, 113.3b-c): "target instant spell, sorcery spell, or triggered ability", one object on the stack of the listed kinds, in the listed order
      const items = stackItemsOf(f);
      if (items !== null) {
        // edh-cast-15 (Subtlety): "up to one target creature spell or planeswalker spell": a list of spells alone may be one with a count of "up to one"
        const spellsOnly = items.every((x) => x.stackKind === 'spell');
        if ((count !== undefined && !(spellsOnly && !plural && /^up to (one|1)$/.test(count))) || plural || tail || other.other === true) throw new NoRenderer(`target ${spec.id}: a count, limit or "other" on a list of spells and abilities`);
        return `${count !== undefined ? `${count} ` : ''}target ${joinList(items.map((x) => (x.stackKind === 'spell' ? K.np({ ...x, zone: 'stack' }, st, { det: 'none' }) : STACK_ITEM_HEAD[x.stackKind!]!)), 'or')}`;
      }
      // r4-fxb (CR 115.9a): "target spell or ability with a single target" (Bolt Bend, Redirect Lightning): the number of targets it has, said after the noun
      // edh-next-121 (CR 115.9a; Wyll's Reversal): "target spell or ability with one or more targets"; any other number of targets is not said (fail closed)
      if (f.targetCount !== undefined && !(f.targetCount.value === 1 && (f.targetCount.op === '==' || f.targetCount.op === '>='))) throw new NoRenderer(`target ${spec.id}: a spell or ability with a number of targets other than one or one or more`);
      const single = f.targetCount !== undefined && f.targetCount.op === '==' && f.targetCount.value === 1 ? ' with a single target' : f.targetCount !== undefined ? ' with one or more targets' : '';
      // edh-cast-1 (CR 115.9b; Siren Stormtamer, Not of This World; family spell-or-ability-that-targets): "target spell or ability that targets a creature you control": one of its
      // targets is such an object, or a player ("that targets you")
      const tf = f.targets as { ref?: string; filter?: ObjectFilter } | undefined;
      const options = f.anyOf?.length === 2 && f.anyOf.every((x) => Object.keys(x).length === 1 && x.targets !== undefined) ? f.anyOf : null;
      if (options !== null && tf === undefined) {
        if (single !== '' || count !== undefined || other.other === true) throw new NoRenderer(`target ${spec.id}: a count, limit or "other" on a spell or ability by what it targets`);
        const said = options.map((x) => {
          const t = x.targets as { ref?: string; who?: string; filter?: ObjectFilter };
          if (t.ref === 'each' && (t.who === 'opponent' || t.who === 'player')) return t.who === 'opponent' ? 'an opponent' : 'a player';
          if (t.ref === 'each' && t.filter !== undefined) return K.np(t.filter, st, { det: 'a' });
          if (isPlayerOnlyRef(t as PlayerRef)) return K.player(t as PlayerRef, st, 'object').text;
          throw new NoRenderer(`target ${spec.id}: a spell or ability by what it targets other than an object description or a player`);
        });
        return `target spell or ability that targets ${said.join(' or ')}`;
      }
      if (tf !== undefined) {
        if (single !== '' || count !== undefined || other.other === true) throw new NoRenderer(`target ${spec.id}: a count, limit or "other" on a spell or ability by what it targets`);
        if (tf.ref === 'each' && tf.filter !== undefined) return `target spell or ability that targets ${K.np(tf.filter, st, { det: 'a' })}`;
        if (isPlayerOnlyRef(tf as PlayerRef)) return `target spell or ability that targets ${K.player(tf as PlayerRef, st, 'object').text}`;
        throw new NoRenderer(`target ${spec.id}: a spell or ability by what it targets other than an object description or a player`);
      }
      // edh-next-74 (CR 115.9c; Radiant Performer): "target spell or ability that targets only a single permanent or player"
      const only = f.targetsOnly as { ref?: string; filter?: ObjectFilter } | undefined;
      if (only !== undefined) {
        if (single !== '' || count !== undefined || other.other === true || plural || only.ref !== 'each' || only.filter === undefined || (f.targetsOnlyPlayer === true && JSON.stringify(only.filter) !== '{"zone":"battlefield"}')) throw new NoRenderer(`target ${spec.id}: a spell or ability that targets only a described object other than "a single permanent or player"`);
        return `target spell or ability that targets only a single ${f.targetsOnlyPlayer === true ? 'permanent or player' : K.np(only.filter, st, { det: 'none' })}`;
      }
      // edh-d-51 (CR 115.1, 601.2c; Katara's Reversal; family spells-and-or-abilities): several spells or abilities, "up to four target spells and/or abilities" (the same targets as "spells or abilities")
      if (plural) {
        if (single !== '' || other.other === true || count === undefined) throw new NoRenderer(`target ${spec.id}: several spells or abilities with a single target, "other" or no count`);
        return alt(`${count} target spells or abilities`, `${count} target spells and/or abilities`);
      }
      return other.other === true ? `${count ? `${count} other` : 'another'} target spell or ability${single}` : `${count ? `${count} ` : ''}target spell or ability${single}`;
    }
    case 'objectOrPlayer': {
      const who = spec.players?.who ?? 'any';
      if (who !== 'any' && who !== 'opponent') throw new NoRenderer(`target ${spec.id}: ${JSON.stringify(who)} players`);
      const noun = who === 'opponent' ? 'opponent' : 'player';
      const lead = `${count ? `${count} ` : ''}target`;
      // edh-players-11 (CR 115.1; parser/holes/object.ts, All Will Be One): a player or an object of either of two descriptions, said as a list of three, "target opponent, creature an
      // opponent controls, or planeswalker an opponent controls"; only two plain descriptions (the union of kinds stays a reading)
      if (f.anyOf?.length === 2 && Object.keys(f).every((k) => k === 'anyOf') && !plural && count === undefined && other.other !== true && tail === '') {
        const [x, y] = f.anyOf.map((h) => K.np(h, st, { det: 'none' }));
        return `${lead} ${noun}, ${x}, or ${y}`;
      }
      const objects = K.np({ ...f, ...other }, st, opts);
      const bare = K.np({ ...f, ...other }, st, { det: 'none', plural });
      // edh-c-109 (CR 115.1; Price of Betrayal; family object-list-or-player): a list of kinds of permanent and a player is one list: "target artifact, creature, planeswalker, or opponent"
      const listed = !plural && tail === '' && other.other !== true && (f.types?.length ?? 0) > 1 && Object.keys(f).every((k) => k === 'types') ? /^(.*?)(?:,)? or ([^,]+)$/.exec(firstAlt(objects)) : null;
      return alt(`${objects} or ${plural ? pluralize(noun) : noun}${tail}`, `${lead} ${plural ? pluralize(noun) : noun} or ${bare}${tail}`,
        ...(listed !== null ? [`${listed[1]}, ${listed[2]}, or ${noun}`] : []));
    }
    case 'object':
    default:
      // M6-8: "target spell or permanent" (CR 115.1, 612.1): an object on the stack (not an ability) or a permanent, nothing else said about it
      const controlled = spellOrNonlandControlled(f);
      if (controlled !== null) {
        if (count !== undefined || plural || tail) throw new NoRenderer(`target ${spec.id}: a count or limit on "spell or nonland permanent ${controlled}"`);
        return `${other.other === true ? 'another ' : ''}target spell or nonland permanent ${controlled}`;
      }
      // edh-c-46 (CR 115.1, 202.3; Divide by Zero): "target spell or permanent with mana value 1 or greater" (parser/holes/object.ts): the one comparison holds for both halves
      if (f.manaValue !== undefined && isSpellOrPermanent({ ...f, manaValue: undefined })) {
        if (count !== undefined || plural || tail || other.other === true) throw new NoRenderer(`target ${spec.id}: a count, limit or "other" on "spell or permanent with mana value"`);
        const mv = K.np({ manaValue: f.manaValue }, st, { det: 'none', head: 'permanent' });
        if (!mv.startsWith('permanent with mana value ')) throw new NoRenderer(`target ${spec.id}: the mana value of a spell or permanent`);
        return `target spell or ${mv}`;
      }
      // edh-c-88 (CR 115.1, 105.2, 608.2b; Aether Gust): "target spell or permanent that's red or green": one target, a spell or a permanent that is any of those colors
      const sopColors = spellOrPermanentColors(f);
      if (sopColors !== null) {
        if (count !== undefined || plural || tail) throw new NoRenderer(`target ${spec.id}: a count or limit on "spell or permanent that's <colors>"`);
        return `${other.other === true ? 'another ' : ''}target spell or permanent that's ${sopColors}`;
      }
      // edh-d-96 (CR 115.1, 400.1; Endless Detour): "target spell, nonland permanent, or card in a graveyard" (parser/holes/object.ts builds the filter exactly)
      if (isSpellNonlandPermanentOrGraveyardCard(f)) {
        if (count !== undefined || plural || tail || other.other === true) throw new NoRenderer(`target ${spec.id}: a count, limit or "other" on "spell, nonland permanent, or card in a graveyard"`);
        return 'target spell, nonland permanent, or card in a graveyard';
      }
      if (isSpellOrPermanent(f) || isSpellOrNonlandPermanent(f)) {
        if (count !== undefined || plural || tail) throw new NoRenderer(`target ${spec.id}: a count or limit on "spell or permanent"`);
        return `${other.other === true ? 'another' : ''}${other.other === true ? ' ' : ''}target spell or ${isSpellOrPermanent(f) ? '' : 'nonland '}permanent`;
      }
      // std-rx30 (CR 115.1, 400.1): "target instant or sorcery card from your graveyard or exiled card with flashback you own" (Sorceress's Schemes): one card of either
      // description, each in its own zone (parser/holes/object.ts builds the filter); a card of yours in exile is also "exiled card ... you own"
      {
        const halves = cardsOfTwoZones(f);
        if (halves !== null) {
          if (count !== undefined || plural || tail || other.other === true) throw new NoRenderer(`target ${spec.id}: a count, limit or "other" on a card of two zones`);
          const say = (h: ObjectFilter): string => {
            const plain = K.np(h, st, { det: 'none' });
            if (h.zone !== 'exile' || h.owner !== 'you' || h.controller !== undefined) return plain;
            const { owner: _o, zone: _z, isCard: _c, ...rest } = h; // (a card in exile is a card: no "nontoken")
            return alt(plain, `exiled ${K.np(rest, st, { det: 'none', head: 'card' })} you own`);
          };
          return `target ${say(halves[0])} or ${say(halves[1])}`;
        }
      }
      // p2-modal-1 (CR 702.62b, 115.1): "target permanent or suspended card", "target permanent with a time counter on it or suspended card": a permanent of the
      // description, or a card in exile with suspend and a time counter on it (parser/holes/object.ts#SUSPENDED_CARD)
      {
        const perm = permanentOrSuspended(f);
        if (perm !== null) {
          if (count !== undefined || plural || tail || other.other === true) throw new NoRenderer(`target ${spec.id}: a count, limit or "other" on "permanent or suspended card"`);
          return `target ${K.np(perm, st, { det: 'none' })} or suspended card`;
        }
      }
      // std-rx30 (CR 115.1, 400.1): "up to X other target creatures from the battlefield and/or creature cards from graveyards" (Aurelia's Vindicator): several targets,
      // each a permanent of the first description or a card of the second (parser/holes/object.ts builds the filter)
      {
        const halves = permanentsOrCards(f);
        if (halves !== null) {
          if (!plural || tail || count === undefined) throw new NoRenderer(`target ${spec.id}: one target, or a limit, of permanents and/or cards`);
          const { zone: _z, ...perm } = halves[0];
          const oth = other.other === true || f.other === true ? ' other' : '';
          return `${count}${oth} target ${K.np(perm, st, { det: 'none', plural: true })} from the battlefield and/or ${K.np(halves[1], st, { det: 'none', plural: true })}`;
        }
      }
      // FAST5 T59: "target spell or creature": any spell, or a permanent of the description (parser/holes/object.ts builds the filter)
      // std-rw6 (CR 115.1, 109.2): also in the other order, "target creature or spell" (family spell-or-permanent-order), and "up to one other target creature or
      // spell" (a count, and "other": not this object)
      {
        const half = spellOrPermanentOf(f);
        if (half !== null) {
          if (plural || tail || (count !== undefined && other.other === true) || (count === undefined && f.other === true)) throw new NoRenderer(`target ${spec.id}: a count or limit on "spell or <permanent>"`);
          const lead = `${count !== undefined ? `${count} ` : other.other === true ? 'another ' : ''}${f.other === true ? 'other ' : ''}target`;
          const noun = K.np(half, st, { det: 'none' });
          return alt(`${lead} spell or ${noun}`, `${lead} ${noun} or spell`);
        }
      }
      // r5-fxb (CR 115.1, 601.2c): "for each player, destroy up to one target creature that player controls": any player's, one for each
      if (spec.random === true && (spec.perPlayer === true || spec.perOpponent === true)) throw new NoRenderer(`target ${spec.id}: chosen at random for each player`); // p2-damage-2
      if (spec.perPlayer === true) {
        // edh-top-6 (CR 115.1, 601.2c, 404.1; Afterlife from the Loam): "for each player, choose up to one target creature card in that player's graveyard": a card in a graveyard is its owner's
        // (the parser's perPlayerTarget); the filter names no owner of its own
        if (f.zone === 'graveyard' && f.isCard === true && f.controller === undefined && f.owner === undefined && spec.groupLimit === undefined && spec.sharedCardType !== true && spec.sharedCreatureType !== true) {
          // edh-next-127 (CR 115.1, 404.1; Mysterious Stranger): one target in each graveyard that has one (`eachWithOne`), "... from that graveyard" (the lead, render/steps.ts#perPlayerLead, names the graveyard)
          if (spec.eachWithOne === true) return `${K.np({ ...f, ...other }, st, { ...opts, noZone: true })} from that graveyard`;
          return `${K.np({ ...f, ...other }, st, { ...opts, noZone: true })} in that player's graveyard`;
        }
        if (f.controller !== undefined || spec.groupLimit !== undefined || spec.sharedCardType === true || spec.sharedCreatureType === true) throw new NoRenderer(`target ${spec.id}: one target for each player with a named controller`);
        return `${K.np({ ...f, ...other }, st, opts)} that player controls`;
      }
      // trek-13 (CR 115.1, 601.2c, 404.1; Assimilate the Wounded): "for each opponent, assimilate up to one target creature card from that player's graveyard that was put there from the
      // battlefield this turn": one card at most in each opponent's graveyard (the owner is the opponent the target is for; the lead is said by render/steps.ts#perPlayerLead)
      if (spec.perOpponent === true && f.zone === 'graveyard' && f.owner === 'opponent' && f.isCard === true && f.controller === undefined && spec.groupLimit === undefined && spec.sharedCardType !== true && spec.sharedCreatureType !== true) {
        const { putThereThisTurn, putThereFrom, ...rest } = f;
        const noun = K.np({ ...rest, ...other, owner: undefined }, st, { ...opts, noZone: true });
        const where = putThereThisTurn === true ? ` that was put there ${putThereFrom === 'battlefield' ? 'from the battlefield ' : ''}this turn` : '';
        return `${noun} from ${alt('that player\'s', 'that opponent\'s')} graveyard${where}`;
      }
      if (spec.perOpponent === true) {
        // FAST5 T66 (CR 115.1, 601.2c): "for each opponent, exile up to one target nonland permanent that player controls": the controller is the opponent the target is for (the
        // sentence says "for each opponent," in front, render/steps-zones.ts#move); one target at most
        if (spec.filter?.controller !== 'opponent' || spec.groupLimit !== undefined || spec.sharedCardType === true || spec.sharedCreatureType === true) throw new NoRenderer(`target ${spec.id}: one target for each opponent other than a permanent an opponent controls`);
        const base = `${K.np({ ...f, ...other, controller: undefined }, st, { ...opts, noController: true })} ${alt('that player controls', 'that opponent controls', 'they control')}`; // r5-cost: "that opponent" names the same opponent; edh-next-138 (Welcome to . . .): and "they" (family per-opponent-they-control)
        // trek-8 (CR 115.1, 202.3): the mana value limit also after the controller, "up to one target creature that player controls with mana value 3 or less"
        if (f.manaValue !== undefined && f.manaValue.op === '<=' && Object.keys(f).filter((k) => k !== 'manaValue' && k !== 'controller' && k !== 'types' && k !== 'subtypes' && (f as Record<string, unknown>)[k] !== undefined).length === 0) {
          const bare = `${K.np({ ...f, ...other, controller: undefined, manaValue: undefined }, cloneState(st), { ...opts, noController: true })} ${alt('that player controls', 'that opponent controls', 'they control')}`;
          return alt(base, `${bare} with mana value ${limitPhrase(f.manaValue, st)}`);
        }
        // edh-players-10 (CR 202.3; Desecrate Reality): the parity of the mana value is said after the controller too, "up to one target permanent that player controls with an even mana value"
        if (f.manaValueParity !== undefined && f.manaValue === undefined && Object.keys(f).filter((k) => k !== 'manaValueParity' && k !== 'controller' && k !== 'types' && k !== 'subtypes' && (f as Record<string, unknown>)[k] !== undefined).length === 0) {
          const bare = `${K.np({ ...f, ...other, controller: undefined, manaValueParity: undefined }, cloneState(st), { ...opts, noController: true })} ${alt('that player controls', 'that opponent controls', 'they control')}`;
          return alt(base, `${bare} with ${alt(`${f.manaValueParity} mana value`, `an ${f.manaValueParity} mana value`)}`);
        }
        // edh-players-10 (CR 115.1, 601.2c; Windgrace's Judgment): "for any number of opponents, destroy target nonland permanent that player controls": one target for each opponent chosen,
        // at most one per opponent, so the same spec as "up to one target" (the lead is said by render/steps.ts#perPlayerLead)
        if (spec.min === 0 && spec.max === 1) {
          const bareTarget = `${K.np({ ...f, ...other, controller: undefined }, cloneState(st), { ...opts, count: undefined, noController: true })} ${alt('that player controls', 'that opponent controls', 'they control')}`;
          return alt(base, bareTarget);
        }
        return base;
      }
      // std-cardcopy-7 (CR 115.1, 205.2a): "up to one target nonland card of each card type from your graveyard": the words before the zone, one target of a card in your graveyard
      if (spec.perCardType === true) {
        if (f.zone !== 'graveyard' || f.owner !== 'you' || plural || spec.groupLimit !== undefined || spec.sharedCardType === true || spec.sharedCreatureType === true || spec.differentControllers === true || spec.sameController === true) throw new NoRenderer(`target ${spec.id}: one of each card type other than one card from your graveyard`);
        return `${K.np({ ...f, ...other, zone: 'graveyard' }, st, { ...opts, noZone: true })} of each card type from your graveyard`;
      }
      // CLOUD std-ecl: a spec that shares both a card type and a creature type has no wording
      if (spec.sharedCardType === true && spec.sharedCreatureType === true) throw new NoRenderer(`target ${spec.id}: a shared card type and a shared creature type`);
      const shared0 = spec.sharedCardType === true ? (spec.sharedPermanentType === true ? ' that share a permanent type' /* edh-next-54 (CR 110.4) */ : ' that share a card type') : ''; // FAST5 T66 (CR 205.2a): the set chosen has a card type in common
      if (spec.sharedPermanentType === true && spec.sharedCardType !== true) throw new NoRenderer(`target ${spec.id}: a shared permanent type without a shared card type`);
      if (shared0 !== '' && (!plural || count === undefined)) throw new NoRenderer(`target ${spec.id}: a shared card type for a single target`);
      // CLOUD std-tmt (CR 115.1, 110.2): "two target creatures controlled by different players": no two targets of the set have one controller (no wording with a
      // shared card or creature type, or with a named controller)
      if (spec.differentControllers === true && (!plural || spec.sharedCardType === true || spec.sharedCreatureType === true || f.controller !== undefined)) throw new NoRenderer(`target ${spec.id}: different controllers for a single target or a named controller`);
      // std-rx30 (CR 115.1, 110.2): "two target creatures controlled by the same opponent": every target of the set has one controller, an opponent (the filter's
      // controller is said by those words, never as "an opponent controls")
      if (spec.sameController === true && (!plural || spec.differentControllers === true || spec.sharedCardType === true || spec.sharedCreatureType === true || (f.controller !== 'opponent' && f.controller !== undefined))) throw new NoRenderer(`target ${spec.id}: the same controller for a single target or another controller`);
      // edh-c-74 (Incriminate): no controller named in the filter is "controlled by the same player"
      if (spec.sameController === true) return againPhrase(`${K.np({ ...f, ...other, controller: undefined }, st, { ...opts, noController: true })}${shared0} controlled by the same ${f.controller === undefined ? 'player' : 'opponent'}`, spec, true, st);
      // p2-damage-2 (CR 601.2c, 603.3d): "target creature an opponent controls chosen at random": one target of a plain phrase, picked by the game
      if (spec.random === true && (plural || count !== undefined || shared0 !== '' || spec.differentControllers === true || spec.groupLimit !== undefined || spec.chooser !== undefined)) throw new NoRenderer(`target ${spec.id}: chosen at random with more than one target or another rule of the set`);
      // edh-next-126 (CR 115.1, 208.1; V.A.T.S.): "any number of target creatures with equal toughness": every target of the set has the same toughness (several targets only)
      if (spec.equalToughness === true && (!plural || spec.random === true)) throw new NoRenderer(`target ${spec.id}: equal toughness for a single target`);
      const shared = `${shared0}${spec.differentControllers === true ? alt(' controlled by different players', ' with different controllers' /* edh-next-84 (Cloud\'s Limit Break) */) : ''}${spec.equalToughness === true ? ' with equal toughness' : ''}${spec.random === true ? ' chosen at random' : ''}`;
      // FAST5 T66: the limit is a "with" feature of the noun phrase, so it may stand in front of the zone ("target creature cards with total mana value 3 or less from your graveyard")
      // edh-c-95 (CR 115.3; Daghatar the Adamant): a target that differs from ONE earlier target of the same description is also said "a second target ..." (family second-target)
      const secondOf = spec.distinctFrom?.length === 1 && count === undefined && !plural && other.other === true ? st.specs.get(spec.distinctFrom[0]!) : undefined;
      const second = secondOf !== undefined && secondOf.kind === 'object' && secondOf.min === 1 && secondOf.max === 1 && JSON.stringify(secondOf.filter ?? {}) === JSON.stringify(spec.filter ?? {}) && shared === ''
        ? `${K.np({ ...f }, cloneState(st), opts)}` : undefined;
      return againPhrase(`${K.np({ ...f, ...other }, st, spec.groupLimit ? { ...opts, specTarget: true, total: totalLimitWords(spec.groupLimit, st) } : { ...opts, specTarget: true })}${shared}`, spec, count !== undefined || plural || other.other === true, st, second);
  }
}

/**
 * FAST5 T64 (CR 115.1): "becomes a copy of a second target artifact you control" (Shuri): a single target with the same description as one already named in the
 * text is also said "a second target ..." (the same object may be chosen for both, each "target" is its own choice).
 */
function againPhrase(base: string, spec: TargetSpec, notSingle: boolean, st: RenderState, secondBase?: string): string {
  if (secondBase === undefined && (notSingle || spec.kind !== 'object' || spec.min !== 1 || spec.max !== 1)) return base;
  const same = secondBase !== undefined || [...st.specs.values()].some((o) => o.id !== spec.id && st.mentioned.has(`t:${o.id}`) && o.kind === 'object' && o.min === 1 && o.max === 1
    && JSON.stringify(o.filter ?? {}) === JSON.stringify(spec.filter ?? {}));
  return same ? alt(base, `a second ${secondBase ?? base}`) : base; // edh-c-95: and the target that differs from the one before it (secondBase, CR 115.3)
}

function limitPhrase(c: { op: string; value: Quantity }, st: RenderState): string {
  const v = K.qty(c.value, st);
  switch (c.op) {
    case '>=': return `${v} or greater`;
    case '<=': return `${v} or less`;
    case '==': return v;
    case '<': return `less than ${v}`;
    case '>': return `greater than ${v}`;
    default: return `other than ${v}`;
  }
}

/**
 * FAST5 T59: the filter of "target spell or creature" exactly: `{zone: [stack, battlefield], anyOf: [{stackKind: 'spell', zone: 'stack'}, {<description>, zone:
 * 'battlefield'}]}`. Returns the description of the permanent half (without its zone), or null for any other filter.
 */
export function spellOrPermanentOf(f: ObjectFilter): ObjectFilter | null {
  // std-rw6 (CR 109.2): "other" (not this object) is said before "target" and is kept by the caller (specPhrase)
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined && !(k === 'other' && f.other === true)).sort();
  if (keys.join() !== 'anyOf,zone' || JSON.stringify(f.zone) !== '["stack","battlefield"]' || f.anyOf?.length !== 2) return null;
  const [a, b] = f.anyOf;
  const ak = Object.keys(a!).filter((k) => (a as Record<string, unknown>)[k] !== undefined).sort().join();
  if (ak !== 'stackKind,zone' || a!.stackKind !== 'spell' || a!.zone !== 'stack' || b!.zone !== 'battlefield') return null;
  const { zone: _zone, ...rest } = b!;
  return Object.keys(rest).length === 0 ? null : rest;
}

/** std-rx30: the filter of "target <card> from <zone> or <card> <zone>" exactly, `{zone: [z1, z2], anyOf: [<card in z1>, <card in z2>]}`: the two halves, or null. */
export function cardsOfTwoZones(f: ObjectFilter): [ObjectFilter, ObjectFilter] | null {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort();
  if (keys.join() !== 'anyOf,zone' || !Array.isArray(f.zone) || f.zone.length !== 2 || f.anyOf?.length !== 2) return null;
  const [a, b] = f.anyOf as [ObjectFilter, ObjectFilter];
  const cardZone = (z: unknown): boolean => z === 'graveyard' || z === 'exile' || z === 'hand' || z === 'library';
  if (a.zone !== f.zone[0] || b.zone !== f.zone[1] || !cardZone(a.zone) || !cardZone(b.zone) || a.anyOf !== undefined || b.anyOf !== undefined) return null;
  return [a, b];
}

/** std-rx30: the filter of "<permanents> from the battlefield and/or <cards> from <zone>" exactly, `{zone: ['battlefield', z], anyOf: [<permanents>, <cards in z>]}`, or null. */
export function permanentsOrCards(f: ObjectFilter): [ObjectFilter, ObjectFilter] | null {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined && !(k === 'other' && f.other === true)).sort();
  if (keys.join() !== 'anyOf,zone' || !Array.isArray(f.zone) || f.zone.length !== 2 || f.zone[0] !== 'battlefield' || f.anyOf?.length !== 2) return null;
  const [a, b] = f.anyOf as [ObjectFilter, ObjectFilter];
  if (a.zone !== 'battlefield' || b.zone !== f.zone[1] || a.anyOf !== undefined || b.anyOf !== undefined) return null;
  return [a, b];
}

/** M6-8: the filter of "target spell or permanent" exactly (parser/holes/object.ts builds it). */
/** FAST5 T66: the filter of "target spell or nonland permanent" exactly (parser/holes/object.ts builds it). */
export const isSpellOrNonlandPermanent = (f: ObjectFilter): boolean => {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  return keys.length === 2 && JSON.stringify(f.zone) === '["stack","battlefield"]' && JSON.stringify(f.notTypes) === '["Land"]';
};

/** edh-d-96: the filter of "target spell, nonland permanent, or card in a graveyard" exactly (parser/holes/object.ts builds it). */
export const isSpellNonlandPermanentOrGraveyardCard = (f: ObjectFilter): boolean => {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join();
  return keys === 'anyOf,zone' && JSON.stringify(f.zone) === '["stack","battlefield","graveyard"]' && f.anyOf?.length === 2 && isSpellOrNonlandPermanent(f.anyOf[0]!) && JSON.stringify(f.anyOf[1]) === '{"zone":"graveyard","isCard":true}';
};

/** edh-cast-2: "target spell or nonland permanent an opponent controls" / "you don't control" exactly (parser/holes/object.ts): the words after the noun phrase, or null. */
export const spellOrNonlandControlled = (f: ObjectFilter): string | null => {
  const { controller, not, ...rest } = f;
  if (!isSpellOrNonlandPermanent(rest as ObjectFilter)) return null;
  if (controller === 'opponent' && not === undefined) return 'an opponent controls';
  if (controller === undefined && JSON.stringify(not) === '{"controller":"you"}') return "you don't control";
  return null;
};

/** edh-c-88: the filter of "target spell or permanent that's red or green" exactly (parser/holes/object.ts builds it): the color words, or null. */
export const spellOrPermanentColors = (f: ObjectFilter): string | null => {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  if (keys.length !== 2 || JSON.stringify(f.zone) !== '["stack","battlefield"]' || f.colors === undefined || f.colors.length === 0) return null;
  const names = f.colors.map((c) => COLOR_WORD[c]);
  return names.every((n) => n !== undefined) ? joinList(names as string[], 'or') : null;
};

export const isSpellOrPermanent = (f: ObjectFilter): boolean => {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  return keys.length === 1 && JSON.stringify(f.zone) === '["stack","battlefield"]';
};


function specInfo(spec: TargetSpec): RefInfo {
  // STD-FRA (CR 115.1, 601.2c): one target for each opponent is a set (as many targets as there are opponents), "those creatures"
  const plural = spec.perOpponent === true || spec.perPlayer === true || spec.perCardType === true || (!(spec.min === 1 && spec.max === 1) && !(spec.min === 0 && spec.max === 1)); // std-cardcopy-7: one of each card type is a set too
  switch (spec.kind) {
    case 'player': return { nouns: ['player'], plural, player: true };
    case 'anyTarget': return { nouns: ['creature', 'permanent', 'player', 'planeswalker'], plural, ...(plural ? {} : { orNouns: ['permanent', 'player'] as [string, string] }) }; // edhv31 (CR 115.4, 608.2c; Arrow Storm): "any target" is "that permanent or player" later
    case 'spell': return { nouns: ['spell'], plural };
    case 'ability': return { nouns: ['ability'], plural };
    case 'stackObject': return { nouns: ['spell', 'ability'], plural };
    default: {
      const half = spec.filter ? spellOrPermanentOf(spec.filter) : null; // FAST5 T59
      const nouns = spec.filter && isSpellNonlandPermanentOrGraveyardCard(spec.filter) ? ['spell', 'permanent', 'card'] /* edh-d-96 */ : spec.filter && (isSpellOrPermanent(spec.filter) || isSpellOrNonlandPermanent(spec.filter) || spellOrNonlandControlled(spec.filter) !== null || spellOrPermanentColors(spec.filter) !== null) ? ['spell', 'permanent'] : half !== null ? ['spell', ...K.nounsOf(half)] : K.nounsOf(spec.filter ?? {});
      // edh-perms-15 (CR 115.1; Animation Module): a target "permanent or player" is "that permanent or player" later
      const or = spec.kind === 'objectOrPlayer' ? (!plural && nouns.length === 1 ? ([nouns[0]!, 'player'] as [string, string]) : undefined) : spec.filter ? orNounsOf(spec.filter) : undefined;
      // edh-replace-4 (parser/holes/object.ts, Court of Ardenvale, Emeria Shepherd): a target "permanent card" (all six permanent types) is also "that permanent card" later, a
      // "nonland permanent card" is "that nonland permanent card"; the same object as "that card"
      const permCard = spec.filter?.types?.length === 6 && ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'].every((t) => spec.filter!.types!.includes(t))
        ? (spec.filter.notTypes === undefined ? ['that permanent card'] : spec.filter.notTypes.length === 1 && spec.filter.notTypes[0] === 'Land' ? ['that nonland permanent card'] : []) : [];
      // edh-perms-24 (CR 608.2c; Clockspinning): a target "permanent or suspended card" is "that permanent or card" again
      const permOrSuspended = JSON.stringify(spec.filter) === JSON.stringify({ zone: ['battlefield', 'exile'], anyOf: [{ zone: 'battlefield' }, { zone: 'exile', isCard: true, keyword: 'suspend', counters: { kind: 'time' } }] }) ? ['that permanent or card'] : [];
      // edh-c-9 (CR 115.1, 608.2c; Lithomantic Barrage, family that-target): the one object an earlier sentence targeted is also "that target" ("... instead if that target is white and/or blue")
      const thatTarget = !plural && spec.kind === 'object' ? ['that target'] : [];
      // edh-c-86 (CR 115.1, 608.2c; Outmuscle, family target-by-controller): a single target announced as "target <noun> <controller words>" is also "the <noun> <controller words>" later (the parser's anaphor `controls`, holes/object.ts#W_CONTROLS)
      const byController = !plural && spec.kind === 'object' ? (() => { const m = /^target (\w+) (you control|you don't control|an opponent controls)$/.exec((spec.text ?? '').toLowerCase()); return m === null ? [] : [`the ${m[1]} ${m[2]}`]; })() : [];
      const alts = plural ? [] : [...permCard, ...permOrSuspended, ...thatTarget, ...byController];
      return { nouns, plural, ...(or ? { orNouns: or } : {}), ...(alts.length > 0 ? { alts } : {}) };
    }
  }
}

/** FAST4 T19: the two nouns of a filter that is exactly two card types ("creature or planeswalker", CR 115.1), in the order the filter lists them. */
function orNounsOf(f: ObjectFilter): [string, string] | undefined {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  if (keys.length !== 1 || keys[0] !== 'types' || f.types!.length !== 2) return undefined;
  const [a, b] = f.types!.map((t) => t.toLowerCase());
  return a !== undefined && b !== undefined && a !== b ? [a, b] : undefined;
}

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

export const ATTACH_NOUNS = ['creature', 'permanent', 'land', 'artifact', 'enchantment', 'planeswalker'];

function mention(st: RenderState, key: string | null, info?: RefInfo): void {
  if (key === null) return;
  st.mentioned.add(key);
  if (info) st.info.set(key, info);
}

/**
 * FAST5 T41: the object itself, named before, as the subject of a sentence: "it" or "~", and, for a legendary creature (a character), "he" or "she" (Oracle
 * calls a named character so; the model keeps no gender, so both are offered; family character-pronoun).
 */
function selfAgain(st: RenderState, form: Form): Phrase {
  if (form === 'possessive') return { text: alt('its', "~'s"), plural: false, person: 'sg' };
  const own = (st.ctx.selfTypes ?? []).map((t) => t.toLowerCase());
  const legend = own.includes('legendary') && own.includes('creature');
  // FAST5 T61: ... and, as the object of an instruction, "him" or "her" ("put a +1/+1 counter on her")
  const characterWords = legend && form === 'subject' ? ['he', 'she'] : legend && form === 'object' ? ['him', 'her'] : [];
  return { text: alt('it', '~', ...characterWords), plural: false, person: 'sg' };
}

export function obj(ref: ObjRef, st: RenderState, form: Form, o: { prefer?: 'all' | 'each' } = {}): Phrase {
  const poss = (text: string): string => (form === 'possessive' ? POSSESSIVE(text) : text);
  switch (ref.ref) {
    case 'self': {
      // PUSH1 T2: the object its activation cost named is "it" too when nothing else has been named (a fallback antecedent, parser/lower/ability.ts#costMentions)
      if (!st.mentioned.has('self') && st.mentioned.has('cost:self') && antecedents(st).length === 0) mention(st, 'self', { nouns: ['permanent'], plural: false });
      if (st.mentioned.has('self')) return selfAgain(st, form);
      mention(st, 'self', { nouns: ['permanent'], plural: false });
      return { text: poss('~'), plural: false, person: 'sg' };
    }
    case 'target': {
      const spec = st.specs.get(ref.id);
      if (!spec) throw new NoRenderer(`target ${ref.id} (no such target spec)`);
      const key = `t:${ref.id}`;
      const info = st.info.get(key) ?? specInfo(spec);
      if (st.mentioned.has(key)) return anaphor(info, form, st, key);
      mention(st, key, info);
      // LNK1 (the parser's rule, parser/lower/mentions.ts#namedPlayerOf): "target creature an opponent controls" names that opponent, "that player" later
      const by = (spec.kind === 'object' || spec.kind === 'spell' /* trek-21: Brazen Bluff */) && spec.max === 1 ? (spec.filter?.controller === 'opponent' ? 'ctrl' : spec.filter?.owner === 'opponent' ? 'own' : null) : null;
      // (known only, with no antecedent info: as before, it is no competitor of another player's pronoun)
      if (by !== null && !(spec.filter?.controller === 'opponent' && spec.filter?.owner === 'opponent')) mention(st, `${by}:${key}`);
      // FAST5 T59: the words of a target phrase that name another object ("other than that creature") never mean the target itself
      const savedNot = st.notAntecedent;
      st.notAntecedent = identityOf(st, key);
      let phrase: string;
      try {
        phrase = specPhrase(spec, st);
      } finally {
        if (savedNot === undefined) delete st.notAntecedent;
        else st.notAntecedent = savedNot;
      }
      return { text: poss(phrase), plural: info.plural, person: personOf(info.plural) };
    }
    case 'bound': {
      if (ref.which !== undefined) throw new NoRenderer('some of the objects a name binds (`which`): only "another" after a sacrifice says it (render/fold-stdlibrary2.ts)'); // audit-fix-1
      const info = st.info.get(`b:${ref.name}`) ?? { nouns: ['object'], plural: false };
      st.mentioned.add(`b:${ref.name}`);
      return anaphor(info, form, st, `b:${ref.name}`);
    }
    case 'event': {
      const r = roleInfo(ref.role, st);
      st.mentioned.add(`e:${ref.role}`);
      if (r.isSelf) return selfAgain(st, form);
      return anaphor(r.info, form, st, `e:${ref.role}`);
    }
    case 'attachedTo':
      return attached(st, form);
    case 'pair': // edh-top-2 (CR 702.95b): soulbond's "each of those creatures" / "both creatures"
      return ref.both === true ? { text: poss('both creatures'), plural: true, person: 'pl' } : { text: poss('each of those creatures'), plural: false, person: 'sg' };
    case 'linked': {
      // edh-perms-21 (Faerie Artisans, ruling 2016-11-08; template eff.edhpm21.exile.otherTokensCreatedWithSelf): the tokens the source's own ability created, "all other tokens created with ~"
      // (every one but the token just created, bound by name); the plain form has no wording yet
      if (ref.link === 'created') {
        // edh-d-95 (CR 607.2a, 111.1; Tombstone Stairwell; template eff.edhd95.destroy.tokensCreatedWithSelf): every token the source's other ability created, "all tokens created with ~"
        if ((!('except' in ref) || ref.except === undefined) && form !== 'possessive') {
          mention(st, 'l:created', { nouns: ['token', 'permanent'], plural: true });
          return { text: 'all tokens created with ~', plural: true, person: 'pl' };
        }
        if (!('except' in ref) || ref.except === undefined || ref.except.ref !== 'bound' || form === 'possessive') throw new NoRenderer('the tokens created with this object, other than "all other tokens created with ~" after the token just created');
        return { text: 'all other tokens created with ~', plural: true, person: 'pl' };
      }
      const key = `l:${ref.link}`;
      const mentioned = st.mentioned.has(key);
      // edh-d-96 (CR 607.2a; Colfenor's Urn): the cards a condition counted ("if three or more cards have been exiled with ~", render/cond.ts) stay plural: "return those cards"
      const counted = mentioned && st.info.get(key)?.plural === true ? st.info.get(key)! : null;
      mention(st, key, counted ?? { nouns: ['card', 'permanent', 'creature'], plural: false });
      if (mentioned) return anaphor(st.info.get(key)!, form, st, key);
      // std-rh (CR 702.167c): what the craft cost exiled, said by Oracle "the exiled card used to craft it"
      // std-craft-1 (CR 702.167c): and, when the cost exiled several, "the exiled cards used to craft it" (Mastercraft Raptor) or "... to craft this creature" (Sunbird Effigy)
      const crafted = ref.link === 'craft' ? (form === 'possessive' ? ["the exiled card used to craft it's"] : ['the exiled card used to craft it', 'the exiled cards used to craft it', 'the exiled cards used to craft ~']) : [];
      // trek-13 (CR 607.2a; The Best of Both Worlds): the creature another ability assimilated, "the Borg assimilated with ~"
      const assimilated = ref.link === 'assimilated' ? (form === 'possessive' ? ["the borg assimilated with ~'s"] : ['the borg assimilated with ~', 'the creature assimilated with ~']) : [];
      return { text: poss(alt(`the ${ref.link} card`, `the ${ref.link} permanent`, `the ${ref.link} creature`, `the ${ref.link} cards`, ...crafted, ...assimilated)), plural: false, person: 'sg' };
    }
    case 'each': {
      // edh-c-94 (CR 608.2c, 115.1; Winter Blast): the targets of an earlier instruction that a description fits, "each of those creatures with flying"
      // (parser/holes/object.ts#pluralPronouns; the filter is `is` the group of targets and the description)
      if (ref.filter.is?.ref === 'target' && st.info.get(`t:${ref.filter.is.id}`)?.plural === true && form !== 'possessive') {
        const { is: _isGroup, ...desc } = ref.filter;
        // (a controller or owner is the part of the group a player controls, groupPart below: not this wording)
        const keys = Object.keys(desc).filter((k) => (desc as Record<string, unknown>)[k] !== undefined);
        if (keys.length > 0 && keys.every((k) => ['types', 'subtypes', 'keyword', 'notKeyword', 'colors', 'notColors', 'power', 'toughness', 'manaValue', 'tapped', 'attacking', 'blocking', 'supertypes', 'token'].includes(k))) return { text: `each of those ${K.np(desc, st, { det: 'none', plural: true })}`, plural: false, person: 'sg' };
      }
      // FAST5 T76 (CR 608.2c; the parser's mention, parser/lower/mentions.ts#producedBy via model/focus.ts#grantedGroup): the group a pump or grant just named is
      // "them" / "those creatures" the next time it is named, besides its description
      if (st.group !== undefined && 'filter' in ref && JSON.stringify(ref.filter) === st.group) {
        const saved = st.group;
        delete st.group;
        try {
          const base = obj(ref, st, form, o);
          const those = form === 'possessive' ? [] : K.nounsOf(ref.filter).map((n) => 'those ' + pluralize(n));
          // r4-fxb (family group-each-of): as an object the group is also "each of them" ("Put an indestructible counter on each of them", CR 608.2c)
          const eachOf = form === 'object' ? ['each of them', ...those.map((x) => `each of ${x}`)] : [];
          return { ...base, text: alt(base.text, form === 'possessive' ? 'their' : form === 'object' ? 'them' : 'they', ...those, ...eachOf) };
        } finally {
          st.group = saved;
        }
      }
      // FAST5 T43 (CR 608.2c): the cards of a group a choice among it did not pick are "the rest" ("the other" when one is left)
      // p2-zone-moves-2 (family rest-all-other-revealed): also "all other cards revealed this way" (Hermit Druid)
      if (restOfGroup(ref.filter) !== null) return { text: poss(alt('the rest', 'the other', "all cards revealed this way that weren't put onto the battlefield", 'all other cards revealed this way', 'the rest of the cards', 'the rest of those cards', 'the rest of the cards revealed this way' /* edh-c-65 */)), plural: true, person: 'pl' };
      // std-library-3 (CR 608.2c, 406.1): what a choice among a group of exiled cards left in exile is "the rest of the exiled cards" (parser/lower/mentions.ts#restOf)
      // edh-d-96 (CR 406.1, 601.2a; Epic Experiment; family rest-of-exiled-the-rest): after a free cast of the chosen cards, also "all cards exiled this way that weren't cast"
      if (restOfExiled(ref.filter)) return { text: poss(alt('the rest of the exiled cards', 'the rest', ...(st.info.get(`r:${(ref.filter.not!.is as { name: string }).name}`)?.castChosen === true ? ["all cards exiled this way that weren't cast"] : []))), plural: true, person: 'pl' }; // edh-next-99 (family rest-of-exiled-the-rest)
      // edh-zones-15 (CR 406.1, 601.2a; parser/lower/mentions.ts#exiledNotCastOf, Chaos Wand): the cards an exile-until exiled that are still in exile
      // edh-zones-26 (Tibalt's Trickery): and "the exiled cards" (the card it stopped at, when cast, left exile for the stack)
      if (exiledNotCast(ref.filter, st)) return { text: poss(alt("the exiled cards that weren't cast this way", 'the exiled cards')), plural: true, person: 'pl' };
      // FAST5 T59 (CR 608.2c): "those creatures you don't control": the part of a group a player controls or owns (parser/holes/object.ts#group)
      const part = groupPart(ref.filter);
      if (part !== null) return { text: poss(`${obj(part.group, st, 'object').text} ${part.who}`), plural: true, person: 'pl' };
      // std-rx28 (CR 115.9b, 608.2c; parser/lower/scope.ts#eventMentions): "those creatures" of "Whenever you cast a spell that targets one or more creatures": the
      // objects of that description the cast trigger's spell targets, said only as the group the trigger named
      if (ref.filter.targetedBy !== undefined) {
        const { targetedBy, ...desc } = ref.filter;
        const tb = targetedBy as { ref?: string; role?: string };
        const named = (st.trigger ?? []).some((p) => p.ev === 'cast' && p.spell?.targets !== undefined); // the trigger said "a spell that targets ..."
        // edh-next-132 (CR 603.4, 115.9b; Orvar, the All-Form; parser/lower/mentions.ts#interveningTargets): or the intervening "if" said "if it targets one or more <desc>", the same description
        const iv = st.interveningIf as { cond?: string; object?: unknown; filter?: { targets?: { ref?: string; filter?: unknown } } } | undefined;
        const namedIf = (st.trigger ?? []).some((p) => p.ev === 'cast') && iv?.cond === 'matches' && JSON.stringify(iv.object) === JSON.stringify({ ref: 'event', role: 'spell' }) && iv.filter?.targets?.ref === 'each'
          && JSON.stringify(iv.filter.targets.filter) === JSON.stringify(desc) && tb.ref === 'event' && tb.role === 'spell' && form !== 'possessive';
        if (namedIf) { st.mentioned.add('e:spell'); return { text: alt(...K.nounsOf(desc).map((n) => 'those ' + pluralize(n))), plural: true, person: 'pl' }; }
        if (!named || tb.ref !== 'event' || tb.role !== 'spell' || Object.keys(desc).some((k) => k !== 'types' && k !== 'subtypes') || form === 'possessive') throw new NoRenderer('the objects a spell targets other than the cast trigger\'s group');
        st.mentioned.add('e:spell');
        return { text: alt(...K.nounsOf(desc).map((n) => 'those ' + pluralize(n))), plural: true, person: 'pl' };
      }
      // MX3 (CR 701.54e): "your Ring-bearer" is one permanent or none, said without a determiner
      if (ref.filter.ringBearer === 'you' && Object.entries(ref.filter).every(([k, v]) => v === undefined || k === 'ringBearer')) return { text: poss('your Ring-bearer'), plural: false, person: 'sg' };
      // CLOUD std-ecl: every wording is written from the same point, so a target the description names is said in full in each ("each creature target player (CLOUD std-fra made the same change for
      // "each creature target player controls", Twisted Fates; one implementation kept in the merge of lines C and D)
      // controls" as well as "all creatures target player controls"), never "that player" in the later ones; what any wording mentions is mentioned after
      const start = new Set(st.mentioned);
      const seen = new Set(start);
      const fresh = (f: ObjectFilter, det: 'all' | 'each'): string => {
        st.mentioned = new Set(start);
        const t = K.np(f, st, det === 'all' ? { det: 'all', plural: true } : { det: 'each' });
        for (const k of st.mentioned) seen.add(k);
        return t;
      };
      const all = fresh(ref.filter, 'all');
      const each = fresh(ref.filter, 'each');
      // FAST4 T28 (CR 109.2): "other" (than the object itself) is also said after the description, "each creature you control other than ~"
      const { other, ...rest } = ref.filter;
      const otherThan = other === true && form !== 'possessive' ? [`${fresh(rest, 'each')} other than ~`, `${fresh(rest, 'all')} other than ~`] : [];
      st.mentioned = seen;
      const text = o.prefer === 'each' ? alt(each, all, ...otherThan) : alt(all, each, ...otherThan);
      return { text: poss(text), plural: true, person: 'pl' };
    }
    case 'subject':
      return form === 'possessive' ? { text: 'its', plural: false, person: 'sg' } : { text: 'it', plural: false, person: 'sg' };
    case 'topCards': {
      // std-rg (CR 401.2): "all but the bottom card of each opponent's library"
      if (ref.allButBottom !== undefined) {
        if (ref.allButBottom !== 1) throw new NoRenderer('a library but for more than the bottom card');
        return { text: poss(`all but the bottom card of ${K.player(ref.player, st, 'possessive').text} library`), plural: true, person: personOf(true) };
      }
      const n = ref.count;
      const single = typeof n === 'number' && n === 1;
      // edh-top-6 (CR 401.2, 603.2c; Breeches, Brazen Plunderer): the top card of the library of each opponent the trigger's damage was dealt to (the parser's holes/object.ts#topCards, the
      // plural mention of lower/scope.ts): one card from each, said with the group
      if (ref.player.ref === 'event' && ref.player.role === 'recipient' && single && st.triggerWholeBatch === true && (st.trigger ?? []).length > 0 && st.trigger!.every((ev) => ev.ev === 'damage' && ev.recipient?.player === 'opponent')) {
        return { text: poss("the top card of each of those opponents' libraries"), plural: true, person: personOf(true) };
      }
      // edh-c-73 (CR 404.1; Soldevi Digger): the top card of a graveyard
      if (ref.zone === 'graveyard') {
        if (!single) throw new NoRenderer('several cards of the top of a graveyard');
        // edhn78 (CR 404.1; Shallow Grave): "the top creature card of your graveyard"
        if (ref.matching !== undefined) {
          const f = ref.matching;
          if (Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).join() !== 'types' || f.types!.length !== 1) throw new NoRenderer('a filtered top card of a graveyard but for one card type');
          return { text: poss(`the top ${f.types![0]!.toLowerCase()} card of ${K.player(ref.player, st, 'possessive').text} graveyard`), plural: false, person: personOf(false) };
        }
        if (ref.fromBottom === true) return { text: poss(`the bottom card of ${K.player(ref.player, st, 'possessive').text} graveyard`), plural: false, person: personOf(false) }; // edh-next-43 (CR 404.1; Phyrexian Furnace)
        return { text: poss(`the top card of ${K.player(ref.player, st, 'possessive').text} graveyard`), plural: false, person: personOf(false) };
      }
      // edh-next-123 (CR 401.1; Arvinox, the Mind Flail): the bottom card of a library
      if (ref.fromBottom === true) {
        // edh-d-96 (CR 401.1, 608.2c; The Temporal Anchor): "that many cards from the bottom of your library", as many as the triggering event's number
        if (!single && typeof n === 'object' && n.q === 'eventAmount' && ref.allButBottom === undefined && ref.matching === undefined && form !== 'possessive') {
          return { text: `that many cards from the bottom of ${K.player(ref.player, st, 'possessive').text} library`, plural: true, person: personOf(true) };
        }
        if (!single || ref.allButBottom !== undefined || ref.matching !== undefined) throw new NoRenderer('several bottom cards of a library');
        return { text: poss(`the bottom card of ${K.player(ref.player, st, 'possessive').text} library`), plural: false, person: personOf(false) };
      }
      const countText = single ? 'card' : `${typeof n === 'number' ? numWord(n) : K.qty(n, st)} cards`;
      const owner = K.player(ref.player, st, 'possessive').text;
      // cloud std-spm (CR 401.1): several cards are also "that many cards from the top of your library" (Symbiote Spider-Man, Doomskar Warrior)
      const fromTop = !single && form !== 'possessive' ? [`${countText} from the top of ${owner} library`] : [];
      // FAST5 T43 (CR 107.3, 608.2h): a computed number of cards is also "the top X cards of your library, where X is the number of lands you control"
      // Cloud std-woe (CR 401.1, 608.2h; family top-cards-where-x): and "that many cards from the top of your library" (Virtue of Courage)
      if (typeof n === 'object' && (n.q !== 'X' || st.costAllCountersX !== undefined /* edh-next-45 (CR 107.3, 122.1): "look at the top X cards, where X is the number of eyeball counters removed this way" */) && n.q !== 'var' && form !== 'possessive') {
        // std-lci (CR 608.2c, 603.2): the number of the triggering event or of an earlier step's result is also "that many cards from the top of your library"
        const thatMany = n.q === 'eventAmount' || (n.q === 'resultCount' && st.info.has(`r:${n.step}`)) ? [`that many cards from the top of ${owner} library`] : [];
        // std-rq (CR 401.1, 608.2h; family top-cards-equal-to): and "cards from the top of your library equal to the excess damage dealt to that creature this way"
        // std-exile-play-1-2 (family top-cards-equal-to): and "a number of cards from the top of your library equal to its power" (End-Blaze Epiphany)
        const equalTo = [`cards from the top of ${owner} library equal to ${K.qty(n, st)}`, `a number of cards from the top of ${owner} library equal to ${K.qty(n, st)}`];
        // std-rx8 (CR 401.1, 608.2h; family cards-equal-to-from-top): and "cards equal to its mana value from the top of target player's library"
        const equalToFromTop = [`cards equal to ${K.qty(n, st)} from the top of ${owner} library`];
         // edh-d-88 (CR 107.3, 608.2h; Commander Liara Portyr, family top-cards-where-x): an amount an earlier sentence already said as X ("..., where X is the number of players being
         // attacked. Exile the top X cards of your library.") is X here (render/steps-util.ts#markX)
         const saidBefore = st.mentioned.has(`x=${JSON.stringify(n)}`) ? [`the top X cards of ${owner} library`] : [];
         // edh-zones-2 (CR 107.3, 608.2h; Thassa's Oracle): the X said here is X for the rest of the ability (a later "if X is ...", render/cond.ts)
         st.mentioned.add(`x=${JSON.stringify(n)}`);
         return { text: alt(`the top ${countText} of ${owner} library`, `the top X cards of ${owner} library, where X is ${K.qty(n, st)}`, ...thatMany, ...fromTop, ...equalTo, ...equalToFromTop, ...saidBefore), plural: true, person: personOf(true) };
      }
      return { text: fromTop.length > 0 ? alt(`the top ${countText} of ${owner} library`, ...fromTop) : poss(`the top ${countText} of ${owner} library`), plural: !single, person: personOf(!single) };
    }
    case 'union': {
      // edh-next-146 (family fight-each-other-group): two targets named together as one group ("Tap target creature you control and target creature ..."): a later fight of the one with the
      // other may name them again as that group (render/steps-life.ts#fight reads this mark)
      if (ref.of.length === 2 && ref.of.every((r) => r.ref === 'target')) st.info.set(`u:${(ref.of[0] as { id: string }).id}|${(ref.of[1] as { id: string }).id}`, { nouns: [], plural: true });
      // edh-replace-7 (CR 120.1, 608.2c; Ghyrson Starn, Kelermorph; the parser's rule, parser/lower/scope.ts#eventMentions): the damaged object or player of a damage trigger that names both, "that
      // permanent or player" (the `object` role when an object was dealt the damage, the `recipient` role when a player was); the same candidate rules as "that permanent"
      if (ref.of.length === 2 && ref.of[0]!.ref === 'event' && ref.of[0]!.role === 'object' && ref.of[1]!.ref === 'event' && (ref.of[1] as { role?: string }).role === 'recipient'
        && form === 'object' && (st.trigger ?? []).length === 1 && st.trigger![0]!.ev === 'damage' && st.trigger![0]!.recipient?.object !== undefined && st.trigger![0]!.recipient.player !== undefined) {
        const r = roleInfo('object', st);
        const noun = r.info.nouns[0] ?? 'permanent';
        st.mentioned.add('e:object');
        st.mentioned.add('e:recipient');
        // (the parser's rule: only a mention that can be a permanent AND a player competes; the source or the other objects of the clause do not, Mention.orPlayerOnly)
        const rivals = antecedents(st).filter((a) => a.id !== 'e:object' && a.id !== 'e:recipient' && !a.player && !a.plural && a.nouns.includes('player'));
        return { text: rivals.length === 0 ? `that ${noun} or player` : AMBIGUOUS, plural: false, person: 'sg' };
      }
      const same = sameNameCards(ref, st) ?? sharedZoneCards(ref, st);
      if (same !== null) return { text: poss(same), plural: true, person: 'pl' };
      // edh-c-109 (CR 608.2c, 115.1; family those-creatures-all-targets; Arm the Cathars): all the objects of three or two single target phrases of one noun, said "those creatures"
      const targetSpecs = ref.of.every((r) => r.ref === 'target') ? (ref.of as { id: string }[]).map((r) => st.specs.get(r.id)) : [];
      // (only filters that name no other object: rendering one, "target land that creature's controller controls", would mention the creature and change how the step says it, E3XP Raze)
      if (targetSpecs.length >= 2 && targetSpecs.every((x) => x?.kind === 'object' && x.filter !== undefined && x.max === 1 && !JSON.stringify(x.filter).includes('"ref"'))) {
        const nouns = new Set(targetSpecs.map((x) => K.np({ ...x!.filter!, other: undefined } as ObjectFilter, st, { det: 'none', plural: true })));
        if (nouns.size === 1) {
          const parts0 = ref.of.map((r) => obj(r, st, form === 'possessive' ? 'object' : form).text);
          return { text: poss(alt(joinList(parts0), `those ${[...nouns][0]!}`)), plural: true, person: 'pl' };
        }
      }
      // FAST5 T68 (family subject-quantifier): as a subject, a part that is a described set is also said bare, "~ and other Knights you control have flying"
      const parts = ref.of.map((r) => {
        const t0 = obj(r, st, form === 'possessive' ? 'object' : form).text;
        // edh-c-104 (CR 400.1, 404.1; Soulquake): the battlefield part of a set that also names cards in graveyards may say its zone, "all creatures on the battlefield and all creature cards
        // in graveyards" (a union of an `each` on the battlefield and an `each` in graveyards; the zone word only beside such a graveyard part, so no other union gains a wording)
        const bfWord = r.ref === 'each' && 'filter' in r && r.filter.zone === 'battlefield' && ref.of.some((o) => o !== r && o.ref === 'each' && 'filter' in o && o.filter.zone === 'graveyard');
        const t = bfWord ? alt(t0, `${t0} on the battlefield`) : t0;
        return form === 'subject' && r.ref === 'each' && 'filter' in r ? alt(t, K.np(r.filter, st, { det: 'none', plural: true })) : t;
      });
      // edh-c-51 (CR 509.1h, 608.2c; family both-creatures-block; Alaborn Zealot): the blocker and the attacker a block trigger exposes are "both creatures"
      const blockPair = ref.of.length === 2 && ref.of[0]!.ref === 'event' && (ref.of[0] as { role?: string }).role === 'blocker' && ref.of[1]!.ref === 'event' && (ref.of[1] as { role?: string }).role === 'attacker'
        && form === 'object' && (((st.trigger ?? []).length === 1 && st.trigger![0]!.ev === 'blocks')
          // edh-next-37 (CR 509.1h, 603.2; Dead-Iron Sledge): "whenever equipped creature blocks or becomes blocked by a creature, destroy both creatures": the same two creatures from either event
          || ((st.trigger ?? []).length === 2 && st.trigger!.every((x) => x.ev === 'blocks' || x.ev === 'becomesBlocked') && st.trigger![0]!.ev !== st.trigger![1]!.ev));
      if (blockPair) return { text: poss(alt('both creatures', joinList(parts))), plural: true, person: 'pl' };
      // edh-zones-9 (CR 608.2c; family both-cards; Sword of Hearth and Home): two single cards two earlier instructions produced, said "both cards" (the parser's `both` anaphor)
      const both = ref.of.length === 2 && ref.of.every((r) => r.ref === 'bound' && st.info.get(`b:${r.name}`)?.plural === false && st.info.get(`b:${r.name}`)?.nouns.includes('card') === true);
      // edh-c-60 (CR 105.1, 608.2c; Bathe in Light, family target-and-each-other-sharing-color): a target and every other object that shares a color with it, "target creature and each
      // other creature that shares a color with it", is also the generic "target creature and all other creatures that share a color with that creature"
      const second = ref.of[1];
      const sharing = ref.of.length === 2 && ref.of[0]?.ref === 'target' && second?.ref === 'each' && 'filter' in second && second.filter.sharesWith?.quality === 'color'
        && second.filter.sharesWith.with.ref === 'target' && second.filter.sharesWith.with.id === (ref.of[0] as { id: string }).id && second.filter.other === true && (form === 'subject' || form === 'object');
      if (sharing) {
        const { sharesWith: _sw, other: _o, ...rest } = (second as { filter: ObjectFilter }).filter;
        return { text: poss(alt(joinList(parts), `${parts[0]!} and each other ${K.np(rest, st, { det: 'none', plural: false })} that shares a color with it`)), plural: true, person: 'pl' };
      }
      // edh-c-58 (CR 109.1, 608.2c; family shared-control-pair; Rise of the Hobgoblins): two groups you control, the control phrase said once after the second, "red creatures and white creatures you control"
      const pairF = ref.of.length === 2 && ref.of.every((r) => r.ref === 'each' && 'filter' in r && r.filter.controller === 'you') ? (ref.of as { filter: ObjectFilter }[]).map((r) => r.filter) : null;
      const shared = pairF === null ? [] : [`${K.np(withoutController(pairF[0]!), st, { det: 'none', plural: true })} and ${K.np(pairF[1]!, st, { det: 'none', plural: true })}`];
      return { text: poss(both ? alt('both cards', joinList(parts)) : shared.length > 0 ? alt(joinList(parts), ...shared) : joinList(parts)), plural: true, person: 'pl' };
    }
    case 'grantor': {
      // r4-static (CR 201.5a): inside an ability another object's static ability grants, the outer card's name: the granting object (the parse
      // text holds the mark "¤" there, front/selfref.ts; render.ts#display writes the name)
      // edh-top-15 (CR 701.3d; Toralf's Hammer): "Unattach ¤: It deals 3 damage to any target": the object the cost named is "it" when nothing else was (the parser's fallback candidate, lower/ability.ts#costMentionsOf)
      const viaCost = !st.mentioned.has('grantor') && st.mentioned.has('cost:self') && antecedents(st).length === 0;
      mention(st, 'grantor', { nouns: ['permanent', 'artifact', 'equipment', 'enchantment', 'aura'], plural: false });
      return viaCost ? { text: poss(form === 'possessive' ? alt('its', '¤') : alt('it', '¤')), plural: false, person: 'sg' } : { text: poss('¤'), plural: false, person: 'sg' };
    }
    case 'fixed':
      throw new NoRenderer('ref:fixed (written only by the engine, never part of card data)');
    case 'costBeheld': // std-rx28 (CR 701.4a): what a behold cost of the spell revealed or chose (Monstrous Emergence); only in a spell, model/lint-card.ts
      if (form === 'possessive') throw new NoRenderer('the possessive of what a behold cost revealed or chose');
      mention(st, 'costBeheld', { nouns: ['creature', 'card'], plural: false });
      return { text: 'the creature you chose or the card you revealed', plural: false, person: 'sg' };
    case 'costChosenObject': // std-costs-2 (CR 601.2b): what a chooseObject cost of the spell chose (Close Encounter); only in a spell, model/lint-nodes.ts
      if (form === 'possessive') throw new NoRenderer('the possessive of what a cost chose');
      mention(st, 'costChosenObject', { nouns: ['creature', 'card'], plural: false });
      return { text: 'the chosen creature or card', plural: false, person: 'sg' };
    case 'costRevealed': // p2-refs-1 (CR 701.20a, 608.2h): the card a reveal cost of the spell revealed (Disaster Radius); only in a spell, model/lint-nodes.ts
      mention(st, 'costRevealed', { nouns: ['card'], plural: false });
      return { text: poss('the revealed card'), plural: false, person: 'sg' };
    case 'costReturned': // std-rx28 (CR 702.188a): the creature web-slinging or sneak returned (Scarlet Spider, Ben Reilly); model/lint-card.ts keeps it to such a face
      if (form === 'possessive') throw new NoRenderer('the possessive of the returned creature');
      mention(st, 'costReturned', { nouns: ['creature'], plural: false });
      return { text: 'the returned creature', plural: false, person: 'sg' };
    case 'costTapped': // T35 (station, CR 702.184a): the creature the cost tapped; another noun in Oracle text fails the gate, which is a rejection, never a wrong card
      return { text: poss('the tapped creature'), plural: false, person: 'sg' };
    case 'costUnattached': { // edh-next-141 (CR 701.3d; Captain America, First Avenger): "that Equipment", the permanent this ability's own cost unattached (render/costs.ts)
      const cost = st.info.get('cost:unattached');
      if (cost === undefined || cost.plural || cost.nouns.length === 0) throw new NoRenderer('what an unattach cost unattached, outside an ability with that cost');
      mention(st, 'costUnattached', { nouns: cost.nouns, plural: false });
      return { text: poss(`that ${cost.nouns[0]!}`), plural: false, person: 'sg' };
    }
    case 'costExiled': // FAST5X E13 (craft, CR 702.167a): written by the craft keyword's expansion only ("Return this card ..."), never by a parsed sentence
      if (ref.self) return { text: poss('this card'), plural: false, person: 'sg' };
      {
        // CLOUD C8 (CR 400.7j, 601.2b): "the exiled card" of one card a cost exiled, called by the nouns of the cost part (render/costs.ts#COST_EXILED) when this ability
        // states that cost, "card" otherwise (a spell's additional cost is a static ability of its own); several (craft's materials, CR 702.167c) have no wording
        const cost = st.info.get('cost:exiled');
        // std-cardcopy-7 (CR 400.7j, 608.2c): several cards an "any number of" part exiled, "Copy those exiled cards." (Baron Helmut Zemo); never without the cost on the ability
        if (cost?.plural === true) {
          mention(st, 'costExiled', { nouns: ['card'], plural: true });
          return { text: poss(alt('those exiled cards', 'the exiled cards')), plural: true, person: 'pl' };
        }
        // edh-d-53 (CR 400.7j; Soul Exchange): a spell's additional cost is a static ability of its own, so no nouns are recorded: Oracle then calls it by the permanent it exiled,
        // "if the exiled creature was a Thrull"
        const nouns = cost !== undefined && cost.nouns.length > 0 ? [...new Set([...cost.nouns, 'card'])] : ['card', 'creature', 'artifact', 'enchantment', 'land', 'permanent'];
        // edh-d-94 (the parser's rule, parser/lower/mentions.ts#namedObjects; CR 400.7j, 608.2c; Jhoira of the Ghitu): once named, the one card a cost exiled is "it" ("its") too, when no
        // other single object named before could be (antecedents never list it: edh-d-53's rule for "that creature")
        const again = st.mentioned.has('costExiled') && cost !== undefined && !antecedents(st).some((a) => !a.player && !a.plural && a.implicit !== true);
        mention(st, 'costExiled', { nouns, plural: false });
        // edh-next-131 (CR 400.7j, 608.2c; family exiled-card-that-card; God-Pharaoh's Gift): the one card a payment of the effect exiled from a graveyard is also "that card" ("you may exile a creature card
        // from your graveyard. If you do, create a token that's a copy of that card", parser/lower/mentions.ts#paidExiled)
        const that = cost !== undefined && cost.nouns.length === 1 && cost.nouns[0] === 'card' ? ['that card'] : [];
        // edh-d-101 (CR 400.7, 608.2c; Primordial Mist; family cost-exiled-that-card): the one permanent the cost exiled from the battlefield is the card in exile, "that card"
        const thatCard = st.mentioned.has('cost:exiled:battlefield') ? [poss('that card')] : [];
        const named = alt(poss(alt(...nouns.map((n) => `the exiled ${n}`), ...that)), ...thatCard);
        return { text: again ? alt(named, form === 'possessive' ? 'its' : 'it') : named, plural: false, person: 'sg' };
      }
    case 'convokers': // edh-mana-keywords-8 (CR 702.51a): the creatures that convoked this spell (Lethal Scheme, Everything Comes to Dust); only a spell has them, model/lint-nodes.ts
      // edh-d-9 (CR 702.51a; Venerated Loxodon): and "each creature that convoked it" (an action on every one of them, the same creatures)
      return { text: poss(alt('the creatures that convoked this spell', 'each creature that convoked this spell', 'each creature that convoked it')), plural: true, person: 'pl' };
    case 'costSacrificed': {
      if (ref.card === true) { // trek-21 (CR 400.7j; The Guardian of Forever): "that card", the card the sacrifice made
        mention(st, 'costSacrificed', { nouns: ['card'], plural: false });
        return { text: poss('that card'), plural: false, person: 'sg' };
      }
      // FAST3 T18: "the sacrificed creature" (CR 608.2h): called by the nouns of the cost part that sacrificed it (render/costs.ts#COST_SACRIFICED) when this
      // ability states that cost, by any permanent noun otherwise (a spell's additional cost is a static ability of its own)
      const cost = st.info.get('cost:sacrificed');
      // edh-next-144 (CR 608.2h; Baba Lysaga, Night Witch): the objects a cost of any number sacrificed, "the sacrificed permanents" (as they last existed), as a group
      if (cost?.plural === true && cost.nouns.length === 1 && cost.nouns[0] === 'permanent') {
        mention(st, 'costSacrificed', { nouns: ['permanent'], plural: true });
        return { text: poss('the sacrificed permanents'), plural: true, person: 'pl' };
      }
      if (cost?.plural === true) throw new NoRenderer('the sacrificed objects of a cost that sacrifices more than one');
      const nouns = cost !== undefined && cost.nouns.length > 0 ? cost.nouns : ['creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'permanent'];
      mention(st, 'costSacrificed', { nouns, plural: false });
      // std-rw8 (CR 608.2h; family sacrificed-that-noun): Oracle also calls it "that creature" ("You may sacrifice another creature. When you do, ~ deals damage equal
      // to that creature's power ...", parser/lower/mentions.ts#paidSacrificed)
      // edh-d-95 (the parser's rule, parser/lower/anaphora.ts#sacrificedCondMention; CR 608.2c; Shilgengar, Sire of Famine): inside the branch of "If you sacrificed an Angel this way, ...", the
      // creature the condition names is "it" (RenderState.focus 'costSacrificed', set by render/steps-flow.ts for that condition only)
      const it = st.focus === 'costSacrificed' ? [form === 'possessive' ? 'its' : 'it'] : [];
      const named = poss(alt(...nouns.map((n) => `the sacrificed ${n}`), ...nouns.map((n) => `that ${n}`)));
      return { text: it.length > 0 ? alt(named, ...it) : named, plural: false, person: 'sg' };
    }
    case 'costDiscarded': {
      // CLOUD C8 (CR 400.7j, 608.2h): "the discarded card", or "the discarded cards" for a cost of this ability that discards more than one (render/costs.ts#COST_DISCARDED);
      // a spell's additional cost is a static ability of its own, so its effect alone says one card (the total of several is render/qty.ts#statPhrase's)
      const plural = st.info.get('cost:discarded')?.plural === true;
      mention(st, 'costDiscarded', { nouns: ['card'], plural });
      return { text: poss(plural ? 'the discarded cards' : 'the discarded card'), plural, person: plural ? 'pl' : 'sg' };
    }
  }
}

/**
 * FAST5 T42 (CR 201.2; parser/holes/object.ts#sameNameCards): a target card and every card of that graveyard with the same name, "target creature card and all other
 * cards with the same name as that card from your graveyard". The zone is said once, at the end. Null for any other union.
 */
const withoutController = (f: ObjectFilter): ObjectFilter => { const { controller: _c, ...rest } = f; return rest; };

function sameNameCards(ref: Extract<ObjRef, { ref: 'union' }>, st: RenderState): string | null {
  const [a, b] = ref.of;
  if (ref.of.length !== 2 || a?.ref !== 'target' || b?.ref !== 'each') return null;
  const spec = st.specs.get(a.id);
  const f = spec?.filter;
  const g = b.filter;
  const w = g.sharesWith;
  if (spec === undefined || f === undefined || spec.kind !== 'object' || spec.min !== 1 || spec.max !== 1 || spec.distinctFrom !== undefined || f.zone !== 'graveyard') return null;
  if (g.zone !== f.zone || JSON.stringify(g.owner) !== JSON.stringify(f.owner) || g.isCard !== true || w === undefined || w.quality !== 'name' || w.with.ref !== 'target' || w.with.id !== a.id) return null;
  if (Object.keys(g).filter((k) => (g as Record<string, unknown>)[k] !== undefined).sort().join() !== ['isCard', 'sharesWith', 'zone', ...(g.owner !== undefined ? ['owner'] : [])].sort().join()) return null;
  const key = `t:${a.id}`;
  if (st.mentioned.has(key)) return null;
  st.used.add(spec.id);
  const head = K.np(f, st, { det: 'target', noZone: true });
  mention(st, key, specInfo(spec));
  return `${head} and all other cards with the same name as that card ${K.zoneTail(f, st)}`;
}

/**
 * FAST5 T42 (CR 115.1; parser/holes/object.ts#sharedZone): several target card phrases of one zone, "up to one target creature card, up to one target Mount card, and
 * up to one target Vehicle card from your graveyard": the zone is said once, after the last. Null for any other union (the parts then say their own zones).
 */
function sharedZoneCards(ref: Extract<ObjRef, { ref: 'union' }>, st: RenderState): string | null {
  const specs: TargetSpec[] = [];
  for (const part of ref.of) {
    const spec = part.ref === 'target' ? st.specs.get(part.id) : undefined;
    if (spec === undefined || spec.kind !== 'object' || spec.filter?.isCard !== true || st.mentioned.has(`t:${spec.id}`)) return null;
    specs.push(spec);
  }
  const first = specs[0]?.filter;
  if (specs.length < 2 || first === undefined || (first.zone !== 'graveyard' && first.zone !== 'exile')) return null;
  if (specs.some((s) => s.filter!.zone !== first.zone || JSON.stringify(s.filter!.owner) !== JSON.stringify(first.owner))) return null;
  const parts = specs.map((spec) => {
    const text = specPhrase(spec, st, { noZone: true });
    mention(st, `t:${spec.id}`, specInfo(spec));
    return text;
  });
  return `${joinList(parts)} ${K.zoneTail(first, st)}`;
}

/** The group of cards a step looks among, `{is: <bound group>, zone: 'library'}` beside a description of the cards (any fields; the noun phrase refuses what it cannot say): the group's name and the description. */
export function groupPool(from: ObjRef): { group: ObjRef; desc: ObjectFilter | null } | null {
  if (from.ref !== 'each') return null;
  const f = from.filter;
  if (f.is?.ref !== 'bound' || f.zone !== 'library') return null;
  const { is: _is, zone: _zone, ...described } = f;
  return { group: f.is, desc: Object.values(described).some((v) => v !== undefined) ? described : null };
}

/**
 * FAST5 T43 (CR 608.2c, 701.20e): "the rest" of a group after a choice among it, written by lower/mentions.ts#restOf as the set `{is: <the group>, not: {is: <the
 * chosen cards>}, zone: 'any'}`: the group's name and the chosen cards' name, or null for any other filter (nothing else is said "the rest").
 */
/** std-library-3: `{is: <group>, not: {is: <choice>}, zone: 'exile'}`, what a choice among a group of exiled cards left in exile. */
/** edh-zones-15: `{is: <the cards an exile-until exiled>, zone: 'exile'}`, the cards of it that were not cast (they left exile when cast, CR 601.2a). */
export function exiledNotCast(f: ObjectFilter, st: RenderState): boolean {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort();
  return keys.join(',') === 'is,zone' && f.zone === 'exile' && f.is?.ref === 'bound' && st.info.get(`b:${f.is.name}`)?.exiledBy !== undefined;
}

export function restOfExiled(f: ObjectFilter): boolean {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort();
  return keys.join(',') === 'is,not,zone' && f.zone === 'exile' && f.is?.ref === 'bound' && f.not !== undefined && Object.keys(f.not).join(',') === 'is' && f.not.is?.ref === 'bound';
}

export function restOfGroup(f: ObjectFilter): { group: string; chosen: string } | null {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort();
  if (keys.join(',') !== 'is,not,zone' || f.zone !== 'library' || f.is?.ref !== 'bound' || f.not === undefined) return null;
  const not = f.not;
  if (Object.keys(not).filter((k) => (not as Record<string, unknown>)[k] !== undefined).join(',') !== 'is') return null;
  // std-rx30 (parser/lower/mentions.ts#restOf): what several choices in turn among the group left, the last of them named last (Memories Returning)
  if (not.is?.ref === 'union' && not.is.of.length > 0 && not.is.of.every((x) => x.ref === 'bound')) return { group: f.is.name, chosen: (not.is.of[not.is.of.length - 1] as { name: string }).name };
  if (not.is?.ref !== 'bound') return null;
  return { group: f.is.name, chosen: not.is.name };
}

/**
 * FAST5 T59 (CR 608.2c, 109.4): a group an earlier phrase named, narrowed to what one player controls or owns: `{is: <group>, controller: 'you'}`, `{is, not: {controller:
 * 'you'}}`, `owner` the same. The group and the words that follow it ("you control", "you don't control", "an opponent controls", "you own", ...), or null for any other filter.
 */
export function groupPart(f: ObjectFilter): { group: ObjRef; who: string } | null {
  if (f.is === undefined) return null;
  const fields = (g: ObjectFilter): string[] => Object.keys(g).filter((k) => (g as Record<string, unknown>)[k] !== undefined).sort();
  const words = (g: ObjectFilter, negated: boolean): string | null => {
    const [k] = fields(g);
    if (fields(g).length !== 1) return null;
    const v = (g as Record<string, unknown>)[k!];
    if (k === 'controller' && v === 'you') return negated ? "you don't control" : 'you control';
    if (k === 'controller' && v === 'opponent' && !negated) return 'an opponent controls';
    if (k === 'owner' && v === 'you') return negated ? "you don't own" : 'you own';
    if (k === 'owner' && v === 'opponent' && !negated) return 'an opponent owns';
    return null;
  };
  const key = fields(f).join();
  const who = key === 'controller,is' ? words({ controller: f.controller }, false) : key === 'is,owner' ? words({ owner: f.owner }, false) : key === 'is,not' && f.not !== undefined ? words(f.not, true) : null;
  return who === null ? null : { group: f.is, who };
}

/** What the object an Aura, Equipment or Fortification is attached to is called: "enchanted creature", "equipped creature", "fortified land". */
export function attachedOptions(st: RenderState): string[] {
  const types = st.ctx.selfTypes?.map((x) => x.toLowerCase());
  if (types?.includes('equipment')) return ['equipped creature'];
  if (types?.includes('fortification')) return ['fortified land'];
  // edh-c-65 (CR 303.4, 205.3i; Awaken the Ancient "Enchanted Mountain is a 7/7 red Giant creature"): an Aura that enchants a basic land type calls it by that type
  // edh-c-70: "Enchant artifact creature" (Domineer) is one more thing an Aura calls its object
  if (types?.includes('aura')) return [...ATTACH_NOUNS, 'plains', 'island', 'swamp', 'mountain', 'forest', 'artifact creature'].map((n) => `enchanted ${n}`);
  return [...ATTACH_NOUNS.map((n) => `enchanted ${n}`), 'equipped creature', 'fortified land'];
}

function attached(st: RenderState, form: Form): Phrase {
  const options = attachedOptions(st);
  const unknown = options.length > 1 && options.includes('equipped creature');
  const shownOptions = form === 'possessive' ? options.map(POSSESSIVE) : options;
  // the card's types are unknown: the display is neutral ("attached creature"), the gate takes any of the real words
  const named = (): string => (unknown ? displayFirst(form === 'possessive' ? POSSESSIVE('attached creature') : 'attached creature', ...shownOptions) : alt(...shownOptions));
  if (st.mentioned.has('attached')) {
    const a = anaphor({ nouns: ATTACH_NOUNS, plural: false }, form, st, 'attached');
    return { ...a, text: alt(a.text, ...(form === 'possessive' ? options.map(POSSESSIVE) : options)) };
  }
  st.mentioned.add('attached');
  st.info.set('attached', { nouns: ATTACH_NOUNS, plural: false });
  return { text: named(), plural: false, person: 'sg' };
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

const YOU = (form: Form): Phrase => ({ text: form === 'possessive' ? 'your' : 'you', plural: false, person: 'you' });

export function player(ref: PlayerRef | PlayerPred, st: RenderState, form: Form): Phrase {
  const r = playerInner(ref, st, form);
  if (form !== 'possessive' || typeof ref === 'string') return r;
  // the player who is the subject of the clause owns "their" library, hand ... : the pronoun is one more way to say it
  const key = playerKey(ref);
  return key !== null && key !== 'you' && key === st.actor ? { ...r, text: alt('their', r.text) } : r;
}

function playerInner(ref: PlayerRef | PlayerPred, st: RenderState, form: Form): Phrase {
  const poss = (text: string): string => (form === 'possessive' ? POSSESSIVE(text) : text);
  const sg = (text: string): Phrase => ({ text, plural: false, person: 'sg' });
  if (ref === 'you') return YOU(form);
  if (ref === 'opponent') return sg(poss('an opponent'));
  if (ref === 'any') return sg(poss('a player'));
  const key = playerKey(ref);
  // the player who is the subject of the clause is "their" in possessive position ("search their library")
  const sameActor = form === 'possessive' && key !== null && key === st.actor && key !== 'you';
  const known = key !== null && st.mentioned.has(key);
  const later = (opponent = false): Phrase => {
    // r3-choose: with the readings the player's mention was given ("the chosen player", render/program.ts#chosenFirst); cmd1: a bound player of "for each opponent"
    // is also "that opponent" (RefInfo.iterates); std-combat-1 and std-exile-play-1-1: so is an event's player the event calls an opponent (`opponent`, roleLookup)
    const bound = key !== null ? st.info.get(key) : undefined;
    const alts = bound?.alts;
    // std-control-1 (CR 102.3, 608.2c): the controller of "target creature an opponent controls" is an opponent, "that opponent" later too (parser/holes/player.ts)
    const opponentTarget = typeof ref !== 'string' && ref.ref === 'controllerOf' && ref.object.ref === 'target' && st.specs.get(ref.object.id)?.filter?.controller === 'opponent';
    const a = anaphor({ nouns: opponent || (bound?.player === true && bound.iterates === 'opponent') || opponentTarget ? ['player', 'opponent'] : ['player'], plural: false, player: true, ...(alts !== undefined ? { alts } : {}) }, form, st, key);
    return sameActor ? { ...a, text: alt('their', a.text) } : a;
  };
  switch (ref.ref) {
    case 'you': return YOU(form);
    case 'target': {
      const spec = st.specs.get(ref.id);
      if (!spec) throw new NoRenderer(`target ${ref.id} (no such target spec)`);
      // std-hob (CR 115.1, 608.2e): "two target players" is plural, so "two target players each draw a card" (byPlayer prints the "each": render/steps-util.ts#byPlayer)
      const many = targetCount(spec, st).plural;
      // STD-OTJ (CR 115.1): several player targets named before are "they" / "those players" (plural) the next time
      // edh-players-10: a group of target opponents is also "those opponents" (render's anaphor above)
      const kinds = many && spec.kind === 'player' && spec.players?.who === 'opponent' ? ['player', 'opponent'] : ['player'];
      if (known) return many ? anaphor({ nouns: kinds, plural: true, player: true }, form, st, key) : later();
      mention(st, key, { nouns: kinds, plural: many, player: true });
      const text = poss(specPhrase(spec, st));
      return many ? { text, plural: true, person: 'pl' } : sg(text);
    }
    case 'controllerOf': case 'ownerOf': {
      // LNK1: a controller or owner the text named already ("target creature an opponent controls", "to its owner's hand") is "that player" too
      const again = known ? later() : null;
      // FAST5X E25 (CR 109.5): in "its controller" the source is no other antecedent while something else could be "it" (the parser's AnaphorInfo.selfLast)
      const saved = st.notAntecedent;
      if (ref.ref === 'controllerOf' && saved === undefined) st.notAntecedent = 'self';
      const savedCtl = st.controllerOfPronoun;
      if (ref.ref === 'controllerOf') st.controllerOfPronoun = true;
      let whose: string;
      try {
        whose = obj(ref.object, st, 'possessive').text;
      } finally {
        if (saved === undefined) delete st.notAntecedent;
        else st.notAntecedent = saved;
        if (savedCtl === undefined) delete st.controllerOfPronoun;
        else st.controllerOfPronoun = savedCtl;
      }
      const text = `${whose} ${ref.ref === 'controllerOf' ? 'controller' : 'owner'}`;
      mention(st, key, { nouns: ['player'], plural: false, player: true });
      // edh-players-20 (CR 109.4, 603.2c; Nelly Borca; family controller-of-those): the controller of a plural group the event named, "the controller of those creatures" (its "their controller" stays a form)
      const group = ref.ref === 'controllerOf' && typeof ref.object === 'object' && (ref.object as { ref?: string }).ref === 'event' && form !== 'possessive' ? obj(ref.object, st, 'object') : null;
      const groupText = group !== null && group.plural === true ? `the controller of ${group.text}` : null;
      // edh-combat-6 (CR 109.4, 603.2c, 510.2; Norn's Decree; family controller-of-damaging-creatures): the controller of the creatures an opponent controls that dealt combat damage to a player, "that opponent"
      const damagingOpponent = ref.ref === 'controllerOf' && typeof ref.object === 'object' && (ref.object as { ref?: string; role?: string }).ref === 'event' && (ref.object as { role?: string }).role === 'source' && form !== 'possessive'
        && (st.trigger ?? []).length > 0 && st.trigger!.every((ev) => ev.ev === 'damage' && ev.source?.controller === 'opponent' && ev.recipient?.player === 'you' && ev.recipient.object === undefined
          && (st.triggerBatch === true ? ev.combat === true : true /* edh-next-85 (Michiko Konda, Truth Seeker): one occurrence for each source, damage of any kind (parser/lower/scope.ts#eventMentions) */));
      // edh-c-63 (CR 400.3, 603.6c; Warped Devotion, Liability; family owner-of-zone-change-player): the owner of a permanent put into "a player's" hand or graveyard is "that player" (parser/lower/scope.ts)
      const zoneOwner = ref.ref === 'ownerOf' && typeof ref.object === 'object' && (ref.object as { ref?: string; role?: string }).ref === 'event' && (ref.object as { role?: string }).role === 'subject' && form !== 'possessive'
        && (st.trigger ?? []).length > 0 && st.trigger!.every((ev) => ev.ev === 'zoneChange' && ev.from === 'battlefield' && (ev.to === 'hand' || ev.to === 'graveyard') && ev.subject.owner === undefined && ev.subject.controller === undefined && ev.subject.self === undefined)
          // edh-next-113 (Duskmantle Guildmage): and a card put into an opponent's graveyard from anywhere, "that player" is the opponent whose graveyard it is (parser/lower/scope.ts)
          || (st.trigger ?? []).length > 0 && st.trigger!.every((ev) => ev.ev === 'zoneChange' && ev.to === 'graveyard' && ev.subject.owner === 'opponent' && ev.subject.controller === undefined && ev.subject.self === undefined);
      // edh-d-5 (CR 109.4, 115.1; Acorn Catapult): the controller of the permanent chosen, or the player chosen
      if (ref.ref === 'controllerOf' && ref.orPlayer === true && ref.object.ref === 'target' && form !== 'possessive') return again !== null ? again /* edh-next-132: named again, "the player" / "they" */ : { ...sg(''), text: alt(`${text} or that player`, `that player or ${text}`) }; // edh-next-132: family or-player-either-order (Chain Lightning)
      const forms = [...(again === null ? [] : [again.text]), poss(text), ...(groupText === null ? [] : [groupText]), ...(damagingOpponent ? ['that opponent', 'that player'] : zoneOwner ? ['that player'] : [])];
      return { ...(again ?? sg('')), text: forms.length === 1 ? forms[0]! : alt(...forms) };
    }
    case 'randomOpponent': { // trek-17 (Alexander, Ship's Fool): "a random opponent", then "that player" / "that opponent"
      if (ref.than !== undefined && ref.than.ref !== 'enchantedPlayer') throw new NoRenderer('ref:randomOpponent.than other than the enchanted player'); // edh-top-14
      if (known) return form === 'possessive' ? { text: alt("that player's", "that opponent's", 'their'), plural: false, person: 'sg' } : sg(alt('that player', 'that opponent'));
      mention(st, key, { nouns: ['player', 'opponent'], plural: false, player: true });
      return sg(poss(ref.than !== undefined ? 'another one of your opponents chosen at random' : alt('a random opponent', 'an opponent chosen at random'))); // edh-d-8: family random-opponent-chosen-at-random (Zaffai, Thunder Conductor)
    }
    case 'anOpponent': {
      if (known) return form === 'possessive' ? { text: alt("that player's", "that opponent's", 'their', "the opponent's"), plural: false, person: 'sg' } : sg(alt('that player', 'that opponent', 'the opponent'));
      mention(st, key, { nouns: ['player'], plural: false, player: true });
      return sg(poss(form === 'possessive' ? 'an opponent' : alt('an opponent', 'an opponent of your choice'))); // edh-replace-7 (family opponent-of-your-choice)
    }
    case 'each': {
      // edh-next-134 (CR 102.1, 608.2c; Oft-Nabbed Goat): the players other than a player named before ("its owner draws that many cards and each other player loses that much life")
      if (ref.who === 'otherPlayer' && ref.than !== undefined) {
        const than = K.player(ref.than, cloneState(st), 'object').text;
        return sg(poss(alt('each other player', `each player other than ${than}`)));
      }
      const text = ref.who === 'player' ? 'each player' : ref.who === 'opponent' ? 'each opponent' : 'each other player';
      // std-mkm (CR 102.3): "each of your opponents" is each opponent of the controller, as subject and object ("deals 3 damage to each of your opponents")
      if (ref.who === 'opponent' && form !== 'possessive') return sg(alt(text, 'each of your opponents', 'each other player')); // edh-next-51 (family each-other-player-opponent, CR 102.3): with no teams every other player is an opponent
      return sg(poss(text));
    }
    case 'event': {
      const r = roleInfo(ref.role, st);
      st.mentioned.add(`e:${ref.role}`);
      if (r.isYou) return YOU(form);
      // edh-next-127 (CR 603.2c, 508.1b, 608.2c; Zurzoth, Chaos Rider): the players a whole declaration attacked ("attack one or more players", the parser's scope.ts plural mention) are "those players"
      if (ref.role === 'defender' && st.triggerWholeBatch === true && (st.trigger ?? []).length > 0 && st.trigger!.every((ev) => ev.ev === 'attacks' && ev.defender === 'any' && ev.orPlaneswalker !== true)) {
        return { text: poss('those players'), plural: true, person: 'pl' };
      }
      // std-combat-1 (CR 102.3): a player the event describes as an opponent is also "that opponent" (roleLookup's nouns), as the parser reads it (Mention.heads)
      return later(r.info.nouns.includes('opponent'));
    }
    case 'bound': {
      // C6 (CR 101.3): the players of a group who can't do what a step told them, "each opponent who can't" each time (render/steps-util.ts#bindCant)
      const cant = st.info.get(`b:${ref.name}`)?.cant;
      if (cant !== undefined) return sg(poss(`each ${cant} who can't`));
      // edh-players-11 (CR 608.2c, 608.2d): the players of a group `may` who did it ("each player who drew a card this way", "each opponent who does")
      const did = st.info.get(`b:${ref.name}`);
      if (did?.eachMay !== undefined) return sg(poss(`each ${did.eachMay} who ${didWords(did.eachMayDraws === true, did.eachMayDiscardsHand === true, did.eachMayDiscardsOne === true)}`));
      // edh-next-147 (CR 120.3, 608.2c; Aurelia's Fury): the players the damage step dealt damage to (render/steps-life.ts marks the binding "dealt damage this way"),
      // "players dealt damage this way" (parser/holes/player.ts); a plural subject, so "Players dealt damage this way can't cast ..."
      if (did?.thisWay === 'dealt damage this way') {
        st.mentioned.add(`b:${ref.name}`);
        return { text: poss('players dealt damage this way'), plural: true, person: 'pl' };
      }
      // edh-d-97 (CR 608.2c, 608.2d; Sin Prodder): the one player of "any opponent may ..." who did it, "that player" (parser/lower/mentions.ts#anyOneDidOf)
      if (did?.anyOne === true) return sg(poss('that player'));
      st.mentioned.add(`b:${ref.name}`);
      return later();
    }
    case 'linked':
      // LNK1 (CR 607.1): the player another ability of the object targeted is "that player" (parser/parse.ts#linkTargetedPlayer), named as an anaphor
      if (ref.link === TARGETED_PLAYER_LINK) {
        const info: RefInfo = { nouns: ['player'], plural: false, player: true };
        mention(st, key, info);
        return anaphor(info, form, st, key);
      }
      // edhd63 (CR 607.2d, 614.12a; Sower of Discord, Bitter Feud): the two players "choose two players" chose; one of them is said by the pattern around it ("one of the chosen players")
      if (ref.link === 'chosenPlayers') return { text: poss('the chosen players'), plural: true, person: 'pl' };
      return sg(poss(alt('the chosen player', 'the player you chose', ...(ref.link === 'opponent' ? ['that player'] : []) /* edh-c-75: Canker Abomination, "for each creature that player controls" after "choose an opponent" */)));
    case 'active': return sg(poss(alt('the active player', 'that player', 'the attacking player', 'that attacking player', 'attacking player', 'the player whose turn it is' /* edh-d-99 (CR 102.1; family player-whose-turn-it-is; Obeka) */))); // Standard round 4, r4-trig: "the attacking player" (CR 506.2)
    case 'grantCaster': return sg(poss('the player who cast ¤')); // edh-next-146 (CR 601.2a; Hellish Rebuke): the outer spell's name inside the quote it grants
    case 'defending': return sg(poss(alt('the defending player', 'defending player')));
    case 'iterating': {
      if (known) return later();
      // edh-players-12 (family group-player-pronoun; parser/lower/anaphora.ts#groupChooser): each player of a group read for in turn is also "them" / "their" in the amount of
      // the step ("each opponent loses life equal to the number of creatures attacking them", "... cards in their hand"); the subject form stays "that player" (verb agreement)
      const pron = form === 'possessive' ? 'their' : form === 'object' ? 'them' : null;
      return sg(alt(poss('that player'), poss('the player'), ...(pron === null ? [] : [pron])));
    }
    case 'otherOpponents': {
      // FAST4 T25: "each other opponent": other than the player the trigger's event named (the recipient); the bare form stays keyword data (myriad)
      if (ref.than !== undefined && ref.than.ref === 'event' && ref.than.role === 'recipient' && roleInfo('recipient', st).info.player === true) return sg(poss('each other opponent'));
      // edh-next-130 (CR 506.2, 508.1; Shredder, Shadow Master): after "whenever ~ attacks a player", other than the attacked player (the event's defender)
      if (ref.than !== undefined && ref.than.ref === 'event' && ref.than.role === 'defender' && Object.keys(ref.than).length === 2) return sg(poss('each other opponent'));
      throw new NoRenderer('ref:otherOpponents (keyword data only: myriad, CR 702.116a)'); // M6-12
    }
    case 'fixed':
      throw new NoRenderer('ref:fixed (written only by the engine, never part of card data)');
    // std-rr (CR 303.4, 702.5a): the player the source Aura is attached to, a fixed name as "the defending player" is (no mention: the trigger event that names it
    // is what a later "they" / "that player" refers to, render/evt.ts)
    case 'initiative': return sg(poss('the player who has the initiative')); // edh-next-82 (CR 726.1)
    case 'monarch': return sg(poss('the monarch')); // edh-d-10 (CR 725.1): "the monarch's end step", "creatures the monarch controls"
    case 'enchantedPlayer': return sg(poss(alt('enchanted player', 'enchanted opponent'))); // edh-players-17 (family enchanted-opponent): an Aura that enchants an opponent says so
    case 'otherOf': { // std-rx30: otherwise only in the fold of render/fold.ts#eachRevealsOtherLoses
      // edh-players-11 (CR 102.3, 608.2c): the players of an "each player may ..." who did it other than you, "each opponent who does" (parser/lower/mentions.ts#didOf)
      const group = ref.of.ref === 'bound' && ref.than.ref === 'you' ? st.info.get(`b:${ref.of.name}`) : undefined;
      // edh-next-114 (CR 101.3, 102.3; Liliana, Waker of the Dead): the opponents among the players of an "each player" instruction who couldn't do it, "each opponent who can't" (parser/lower/mentions.ts, bindKey cantOpp)
      if (group?.cant === 'player') return sg(poss("each opponent who can't"));
      if (group?.eachMay === 'player') return sg(poss(`each opponent who ${didWords(group.eachMayDraws === true, group.eachMayDiscardsHand === true, group.eachMayDiscardsOne === true)}`));
      // every player but the one `than` names: edh-perms-13 (CR 608.2c; Fractured Identity) "each player other than its controller", edh-players-12 (CR 102.3;
      // Heartwood Storyteller) "each of that player's opponents" (combined copy: one case, family other-players-opponents)
      if (ref.of.ref === 'each' && ref.of.who === 'player') {
        // edh-c-65 (Death by Dragons): the group measured against a target player, "each player other than target player" (the target is named once, here)
        if (ref.than.ref === 'target' && form !== 'possessive') return sg(`each player other than ${player(ref.than, st, 'object').text}`);
        const theirOpponents = `each of ${player(ref.than, st, 'possessive').text} opponents`;
        if (form === 'possessive') return sg(poss(theirOpponents));
        return sg(alt(`each player other than ${player(ref.than, st, 'object').text}`, theirOpponents));
      }
      // edhd63 (CR 608.2c, 607.2d; Sower of Discord): "the other chosen player", of the two chosen players the one a damaged recipient is not
      if (ref.of.ref === 'linked' && ref.of.link === 'chosenPlayers' && ref.than.ref === 'event' && ref.than.role === 'recipient') return sg(poss('the other chosen player'));
      throw new NoRenderer('ref:otherOf (only in the fold of render/fold.ts#eachRevealsOtherLoses, "each opponent who does" and every player but one)');
    }
    case 'costChosen': // FAST5X E1: gift's chosen opponent (CR 702.174d-i: "the chosen player"); keyword data only
      return sg(poss('the chosen player'));
    case 'seat': { // M12-1 (m12 design D6): "the player to your left", "the player to the right of target opponent" (CR 101.4, 103.1)
      // edhd63 (CR 101.4, 607.2d; Aminatou, the Fateshifter): the player next to the one `of` names, on the side a "choose left or right" chose
      if (ref.chosen !== undefined) {
        if (ref.chosen !== 'direction' || ref.inverse === true) throw new NoRenderer('a chosen direction of a link other than direction');
        return sg(poss(ref.of === undefined || ref.of.ref === 'you' ? 'the next player in the chosen direction' : `the next player in the chosen direction from ${player(ref.of, st, 'object').text}`));
      }
      if (ref.of === undefined || ref.of.ref === 'you') return sg(poss(`the player to your ${ref.side}`));
      return sg(poss(`the player to the ${ref.side} of ${player(ref.of, st, 'object').text}`));
    }
    case 'controlsMost': { // C6: "each player who controls the most creatures" (every player tied for it; CR 109.4, 101.4)
      if (form === 'possessive') throw new NoRenderer('the possessive of "each player who controls the most ..."');
      if (ref.below === true) { // edh-d-46 (Scholarship Sponsor): "each player who controls fewer lands than the player who controls the most lands"
        const np = K.np(ref.filter, cloneState(st), { det: 'none', plural: true });
        return sg(`each player who controls fewer ${np} than the player who controls the most ${np}`);
      }
      return sg(`each player who controls the ${ref.fewest === true ? 'fewest' : 'most'} ${K.np(ref.filter, st, { det: 'none', plural: true })}`);
    }
    // edh-players-13 (CR 608.2d): said only by the loop "For each player who chose fame, ..." (render/steps-flow.ts#forEach), never as the player of another instruction
    // edh-next-143 (CR 608.2d; Pir's Whim, Khorvath's Fury): the players an earlier "For each player, choose friend or foe." chose the word for, "each friend" / "each foe"
    case 'chose':
      if (ref.link === FRIEND_OR_FOE && (ref.value === 'friend' || ref.value === 'foe')) return sg(poss(`each ${ref.value}`));
      throw new NoRenderer('ref:chose outside "For each player who chose ..."');
    case 'choseNumber': throw new NoRenderer('ref:choseNumber outside its own sentences (render/fold-edhn120.ts)'); // edh-next-120
    case 'controlsAny': { // edh-perms-13: "each player who controls an artifact or enchantment" (CR 109.4, 101.4)
      if (form === 'possessive') throw new NoRenderer('the possessive of "each player who controls a ..."');
      // edh-d-88 (CR 109.4, 508.1b; Owlbear Cub): "a player who controls eight or more lands", the player an attack trigger's attacker attacks (said in the object form only, never with `none` or `opponents`)
      if (ref.atLeast !== undefined) {
        if (form !== 'object' || ref.none === true || ref.opponents === true) throw new NoRenderer('"a player who controls N or more ..." other than as the player attacked');
        return sg(`a player who controls ${ref.atLeast} or more ${K.np(ref.filter, st, { det: 'none', plural: true })}`);
      }
      // edh-d-4 (CR 109.4, 102.2; Thornbow Archer): "each opponent who doesn't control an Elf": the players (opponents) who control no such permanent
      if (ref.none === true) return sg(`each ${ref.opponents === true ? 'opponent' : 'player'} who doesn't control ${K.np(ref.filter, st, { det: 'a' })}`);
      // edh-players-15 (CR 102.2; Wedding Ring): "an opponent who controls an artifact named X", the actor of a trigger's event (said in the subject form only)
      if (ref.opponents === true) {
        if (form !== 'subject') throw new NoRenderer('"an opponent who controls ..." other than as the subject of an event');
        return sg(`an opponent who controls ${K.np(ref.filter, st, { det: 'a' })}`);
      }
      return sg(`each player who controls ${K.np(ref.filter, st, { det: 'a' })}`);
    }
    case 'withLife': { // edh-next-72 (CR 119.1, 104.3b; Triskaidekaphobia): "each player with exactly 13 life" (only "exactly", the players of a life total as the instruction is performed)
      if (form === 'possessive') throw new NoRenderer('the possessive of "each player with exactly N life"');
      if (ref.op !== '==') throw new NoRenderer('ref:withLife other than "exactly"');
      return sg(`each ${ref.who === 'opponent' ? 'opponent' : 'player'} with exactly ${ref.n} life`);
    }
    case 'mostLife': // edh-d-85 (CR 119.1; Galactus, Devourer of Worlds): one of the opponents tied for the most life
      if (form === 'possessive') throw new NoRenderer('the possessive of "an opponent with the most life among your opponents"');
      return sg('an opponent with the most life among your opponents');
    case 'votedFor': throw new NoRenderer('ref:votedFor outside "For each <word> vote, choose a permanent owned by the voter and gain control of it" (render/fold-edhp17.ts)'); // edh-players-17
    case 'attacked': throw new NoRenderer('ref:attacked outside "one or more players being attacked are poisoned" (render/cond.ts)'); // edh-combat-6
    case 'attackedBySource': { // edh-players-17 (CR 506.3, 508.1): "each player this creature attacked this turn" (the Oracle's "this creature" is the source, said ~ here)
      if (form === 'possessive') throw new NoRenderer('the possessive of "each player this creature attacked this turn"');
      return sg('each player ~ attacked this turn');
    }
    case 'eachWho': { // std-combat-1 (CR 608.2c, 508.1b): "each opponent who attacked you or a planeswalker you control this turn" (parser/holes/player.ts), that form only
      const d = ref.did;
      // pc-players-3 (CR 119.3): "each opponent / player who lost life this turn"
      if (form !== 'possessive' && ref.scope === 'turn' && JSON.stringify(d) === '{"ev":"life","change":"loss"}') return sg(`each ${ref.who === 'opponent' ? 'opponent' : 'player'} who lost life this turn`);
      // edh-next-66 (CR 601.2, 508.1; Angelic Arbiter): "each opponent who cast a spell this turn", "each opponent who attacked with a creature this turn"
      if (form !== 'possessive' && ref.who === 'opponent' && ref.scope === 'turn' && JSON.stringify(d) === '{"ev":"cast"}') return sg('each opponent who cast a spell this turn');
      if (form !== 'possessive' && ref.who === 'opponent' && ref.scope === 'turn' && JSON.stringify(d) === '{"ev":"attacks"}') return sg('each opponent who attacked with a creature this turn');
      // edh-d-86 (CR 120.1, 510.2; Gollum, Obsessed Stalker): "each opponent dealt combat damage this game by a creature named X" (parser/holes/player.ts#dealtDamageBy)
      if (form !== 'possessive' && d.ev === 'damage' && (ref.scope === 'game' || ref.scope === 'turn') && d.source !== undefined && Object.keys(d).every((k) => k === 'ev' || k === 'source' || (k === 'combat' && d.combat === true))) {
        return sg(`each ${ref.who === 'opponent' ? 'opponent' : 'player'} dealt ${d.combat === true ? 'combat ' : ''}damage this ${ref.scope} by ${K.np(d.source, st, { det: 'a' })}`);
      }
      if (form === 'possessive' || ref.who !== 'opponent' || ref.scope !== 'turn' || d.ev !== 'attacks' || JSON.stringify(d) !== '{"ev":"attacks","defender":"you","orPlaneswalker":true}') {
        throw new NoRenderer('ref:eachWho other than "each opponent who attacked you or a planeswalker you control this turn"');
      }
      return sg('each opponent who attacked you or a planeswalker you control this turn');
    }
    case 'voters': { // M12F (CR 701.38a): only after "whenever players finish voting", whose event has the ballots
      if (st.trigger === null || st.trigger.length !== 1 || st.trigger[0]!.ev !== 'action' || st.trigger[0]!.verb !== 'votesFinished') throw new NoRenderer('ref:voters outside a "whenever players finish voting" trigger');
      const each = `each opponent who voted for a choice you ${ref.agree ? 'voted for' : "didn't vote for"}`;
      if (ref.andYou !== true) return sg(poss(each));
      // M12 gaps: "you and each opponent who voted for ..." is a plural subject ("you and each opponent ... may scry 2"); never a possessive
      if (form === 'possessive') throw new NoRenderer('ref:voters andYou as a possessive');
      return { text: `you and ${each}`, plural: true, person: 'pl' };
    }
  }
}

/**
 * FAST4 T24: the spells "you cast" (CR 601.2a: the player who casts a spell puts it on the stack and controls it; a copy is never cast, CR 707.10): the set
 * `{anyOf: [<spells>], controller: 'you', not: {stackKind: 'copy', zone: 'stack'}, zone: 'stack'}` that parser/templates/zz-fast4/t24.json writes for "artifact spells you
 * cast" and "each noncreature spell you cast". Returns the inner spell filter, or null for any other set.
 */
export function spellsYouCast(f: ObjectFilter, fromHand = false): ObjectFilter | null {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort();
  // std-rf (CR 601.2a): "Instant and sorcery spells you cast from your hand have cascade": the same set with `castFrom: 'hand'` (parser/templates/zz-cloud/std-rf.json)
  if (keys.join(',') !== (fromHand ? 'anyOf,castFrom,controller,not,zone' : 'anyOf,controller,not,zone') || f.controller !== 'you' || f.zone !== 'stack' || f.anyOf!.length !== 1) return null;
  if (fromHand && f.castFrom !== 'hand') return null;
  const not = f.not!;
  if (Object.keys(not).length !== 2 || not.stackKind !== 'copy' || not.zone !== 'stack') return null;
  const inner = f.anyOf![0]!;
  // edh-next-117 (CR 700.6; Peri Brown): "historic spells you cast": the three options of the word `historic` (an artifact, a legendary object, a Saga) are the spell's own `anyOf`
  if (inner.stackKind !== 'spell' || inner.zone !== 'stack' || inner.controller !== undefined || (inner.anyOf !== undefined && !isHistoricOptions(inner.anyOf)) || inner.not !== undefined) return null;
  return inner;
}

/** edh-next-117 (CR 700.6): the options of the word "historic" exactly (parser/holes/filter.ts HISTORIC; render/np.ts#isHistoric says the same). */
function isHistoricOptions(options: readonly ObjectFilter[]): boolean {
  const key = (o: ObjectFilter): string => JSON.stringify(Object.entries(o).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)));
  const want = [{ types: ['Artifact'] }, { supertypes: ['Legendary'] }, { subtypes: ['Saga'] }].map(key).sort();
  return options.length === 3 && JSON.stringify(options.map(key).sort()) === JSON.stringify(want);
}

/** The ways a set of objects can be the subject of a clause: "All creatures", "Creatures you control", "Each creature" (the verb agrees with each). */
export function eachSubjects(filter: ObjectFilter, st: RenderState): { text: string; plural: boolean }[] {
  // CLOUD std-ecl: every wording of the subject is written from the same point, so a target the subject names is said in full in each ("each creature target
  // opponent controls" as well as "creatures target opponent controls"), never "that player" in the later wordings; what any wording mentions is mentioned after
  const start = new Set(st.mentioned);
  const seen = new Set(start);
  const np = (f: ObjectFilter, o: Parameters<typeof K.np>[2]): string => {
    st.mentioned = new Set(start);
    const t = K.np(f, st, o);
    for (const k of st.mentioned) seen.add(k);
    return t;
  };
  const out = eachSubjectWordings(filter, st, np);
  st.mentioned = seen;
  return out;
}

function eachSubjectWordings(filter: ObjectFilter, st: RenderState, np: (f: ObjectFilter, o: Parameters<typeof K.np>[2]) => string): { text: string; plural: boolean }[] {
  // pc-exile-play-2 (CR 601.2i, 707.10; Maelstrom Nexus, Wild-Magic Sorcerer): "The first spell you cast each turn has cascade", "The first spell you cast from exile each turn ..."
  if (filter.firstCast !== undefined && filter.controller === 'you' && filter.zone === 'stack' && filter.not === undefined) {
    const keys = Object.keys(filter).filter((k) => (filter as Record<string, unknown>)[k] !== undefined).sort().join();
    const turn = alt('each turn', 'in each turn'); // (family first-cast-each-turn)
    if (filter.firstCast === 'turn' && keys === 'controller,firstCast,zone') return [{ text: `the first spell you cast ${turn}`, plural: false }];
    // edh-next-114 (CR 601.2i; The Twelfth Doctor): "The first spell you cast from anywhere other than your hand each turn has demonstrate."
    if (filter.firstCast === 'turnNotHand' && keys === 'controller,firstCast,zone') return [{ text: `the first spell you cast from anywhere other than your hand ${turn}`, plural: false }];
    if (filter.firstCast === 'turnFromZone' && keys === 'castFrom,controller,firstCast,zone' && filter.castFrom === 'exile') {
      return [{ text: `the first spell you cast from exile ${turn}`, plural: false }];
    }
  }
  // edh-mana-keywords-12 (CR 601.2i, 106.3; Rain of Riches): "The first spell you cast each turn that mana from a Treasure was spent to cast has cascade."
  if (filter.firstCastManaFrom !== undefined && filter.controller === 'you' && filter.zone === 'stack' && filter.not === undefined && Object.keys(filter).filter((k) => (filter as Record<string, unknown>)[k] !== undefined).sort().join() === 'controller,firstCastManaFrom,zone') {
    const sub = filter.firstCastManaFrom;
    return [{ text: `the first spell you cast ${alt('each turn', 'in each turn')} that mana from ${article(sub)} ${sub} was spent to cast`, plural: false }];
  }
  // edh-next-97 (CR 601.2i, 707.10; Anhelo, the Painter): "The first instant or sorcery spell you cast each turn has casualty 2": the spells you cast of a description, only the first of the turn
  if (filter.firstCastOf !== undefined) {
    const { firstCastOf, ...rest } = filter;
    const base = spellsYouCast(rest);
    if (base !== null && JSON.stringify(base) === JSON.stringify(firstCastOf)) return [{ text: `the first ${np(base, { det: 'none', forEach: true })} you cast each turn`, plural: false }];
    throw new NoRenderer('a first spell of a description other than the spells described');
  }
  // FAST4 T24: "Artifact spells you cast have convoke", "Each noncreature spell you cast has conspire" (CR 601.2a, 707.10)
  const cast = spellsYouCast(filter);
  // edh-cast-1 (CR 202.3, 601.2a; Imoti, Celebrant of Bounty; family spells-you-cast-with-mana-value): "Spells you cast with mana value 6 or greater have cascade": the same set
  // with a mana value comparison on its spells, said after "you cast"
  const castMv = filter.anyOf?.length === 1 && filter.anyOf[0]!.manaValue?.op === '>=' ? spellsYouCast({ ...filter, anyOf: [(({ manaValue: _mv, ...rest }) => rest)(filter.anyOf[0]!)] }) : null;
  // edht4 (CR 202.3, 601.2a; Zhulodok, Void Gorger): "Colorless spells you cast from your hand with mana value 7 or greater have ...": the same set with `castFrom: 'hand'`
  const castMvHand = filter.castFrom === 'hand' && filter.anyOf?.length === 1 && filter.anyOf[0]!.manaValue?.op === '>=' ? spellsYouCast({ ...filter, anyOf: [(({ manaValue: _mv, ...rest }) => rest)(filter.anyOf[0]!)] }, true) : null;
  if (castMvHand !== null) return [{ text: `${np(castMvHand, { det: 'none', plural: true })} you cast from your hand with mana value ${K.qty(filter.anyOf![0]!.manaValue!.value, st)} or greater`, plural: true }];
  // edh-next-144 (CR 202.3, 601.2a; Henzie "Toolbox" Torre): and the singular after "each", "Each creature spell you cast with mana value 4 or greater has blitz" (as std-rx7's for the set without it)
  if (castMv !== null) return [{ text: `${np(castMv, { det: 'none', plural: true })} you cast with mana value ${K.qty(filter.anyOf![0]!.manaValue!.value, st)} or greater`, plural: true }, { text: `each ${np(castMv, { det: 'none', forEach: true })} you cast with mana value ${K.qty(filter.anyOf![0]!.manaValue!.value, st)} or greater`, plural: false }];
  // std-rx7 (family type-list): the singular after "each" also lists the types with "and", "Each instant and sorcery spell you cast has casualty 1" (Silverquill)
  if (cast !== null) return [{ text: `${np(cast, { det: 'none', plural: true })} you cast`, plural: true }, { text: `each ${np(cast, { det: 'none', forEach: true })} you cast`, plural: false }];
  // std-freecast-3 (CR 105.2): "Each legendary spell you cast that's one or more colors has web-slinging {G}{W}{U}": not colorless, said after "you cast"
  const { colorless, ...uncolored } = filter;
  const colored = colorless === false ? spellsYouCast(uncolored) : null;
  if (colored !== null) return [{ text: `${np(colored, { det: 'none', plural: true })} you cast that are one or more colors`, plural: true }, { text: `each ${np(colored, { det: 'none', forEach: true })} you cast that's one or more colors`, plural: false }];
  const castHand = spellsYouCast(filter, true); // std-rf (CR 601.2a)
  if (castHand !== null) return [{ text: `${np(castHand, { det: 'none', plural: true })} you cast from your hand`, plural: true }, { text: `each ${np(castHand, { det: 'none', forEach: true })} you cast from your hand`, plural: false }];
  // p2-exile-play-1 (CR 601.2a, 406.1; Party Thrasher): "Noncreature spells you cast from exile have convoke": the same set with `castFrom: 'exile'`
  const castExile = filter.castFrom === 'exile' ? spellsYouCast({ ...filter, castFrom: 'hand' }, true) : null;
  if (castExile !== null) return [{ text: `${np(castExile, { det: 'none', plural: true })} you cast from exile`, plural: true }, { text: `each ${np(castExile, { det: 'none', forEach: true })} you cast from exile`, plural: false }];
  // r3-static (CR 613.1f, 109.2): "Noble creatures you control and Lesson spells you control have lifelink" (Lo and Li): two groups, each with its own controller,
  // said one after the other with "and" (the objects of either group)
  // (the set's own zone is "any": statics/match.ts#eachMatching looks in every zone, and each branch keeps its own, a permanent's battlefield or a spell's stack;
  // a branch with no zone would otherwise take the set's, statics/match.ts#match)
  const pair = filter.anyOf !== undefined && filter.anyOf.length === 2 && Object.keys(filter).length === 2 && filter.zone === 'any' ? filter.anyOf : null;
  if (pair !== null && pair.every((f) => f.controller === 'you' && f.anyOf === undefined)) {
    return [{ text: `${np(pair[0]!, { det: 'none', plural: true })} and ${np(pair[1]!, { det: 'none', plural: true })}`, plural: true }];
  }
  // r4-static (CR 113.6, 613.1f): "Artifact cards and red creature cards in your hand have warp {2}{R}": two kinds of card in your hand, the zone said once
  const inHand = filter.anyOf !== undefined && filter.anyOf.length === 2 && filter.zone === 'hand' && filter.owner === 'you' && Object.keys(filter).length === 3 ? filter.anyOf : null;
  if (inHand !== null && inHand.every((f) => f.zone === undefined && f.owner === undefined && f.controller === undefined && f.anyOf === undefined)) {
    const card = (f: ObjectFilter, last: boolean): string => np({ ...f, zone: 'hand', owner: 'you' }, { det: 'none', plural: true, ...(last ? {} : { noZone: true }) });
    return [{ text: `${card(inHand[0]!, false)} and ${card(inHand[1]!, true)}`, plural: true }];
  }
  const hasController = filter.controller !== undefined && filter.controller !== 'any';
  const out: { text: string; plural: boolean }[] = [];
  if (hasController) {
    out.push({ text: np(filter, { det: 'none', plural: true }), plural: true });
    out.push({ text: np(filter, { det: 'all', plural: true }), plural: true });
  } else {
    out.push({ text: np(filter, { det: 'all', plural: true }), plural: true });
    // FAST2 T9: "Other Zombie creatures get +1/+1" (a lord, CR 109.2: every creature but this one) reads without a determiner too
    out.push({ text: np(filter, { det: 'none', plural: true }), plural: true });
  }
  // r4-static (CR 109.2; family other-than-self): "other" said after the description, "Dinosaurs you control other than ~ get +1/+1 and gain flying until end of turn"
  if (filter.other === true && hasController) {
    const { other: _other, ...rest } = filter;
    out.push({ text: `${np(rest, { det: 'none', plural: true })} other than ~`, plural: true }, { text: `${np(rest, { det: 'each' })} other than ~`, plural: false });
  }
  const each = { text: np(filter, { det: 'each' }), plural: false };
  if (filter.other && !hasController) out.unshift(each); // "Each other creature gets ...": the singular reads first
  else out.push(each);
  // p2-damage-1 (CR 608.2c, 120.3): the objects an earlier step of the ability dealt damage to ("this way"), one of them as a whole: "A creature dealt damage this way
  // can't be regenerated this turn." (Incinerate); only for that set, whose participle says which objects it is
  if (filter.is?.ref === 'bound' && st.info.get(`b:${filter.is.name}`)?.thisWay !== undefined) out.push({ text: np(filter, { det: 'a' }), plural: false });
  // FAST4 T29: two groups of one controller, "Skeletons you control and other Zombies you control get +1/+1" (the objects in either group, each once; CR
  // 611.3a, 109.4): the controller beside `anyOf` holds for both (design 3.3), and each group carries its own "other"
  const both = filter.anyOf;
  const fields = Object.entries(filter).filter(([k, v]) => v !== undefined && k !== 'anyOf' && k !== 'controller');
  if (hasController && both !== undefined && both.length === 2 && fields.length === 0 && both.every((g) => g.controller === undefined && g.anyOf === undefined)) {
    out.push({ text: both.map((g) => np({ ...g, controller: filter.controller }, { det: 'none', plural: true })).join(' and '), plural: true });
    // FAST5 T48: "Each land and Ally you control has ..." (CR 613.1f): the two groups under one "each", the controller said once (a controller of "you" only)
    if (filter.controller === 'you') out.push({ text: `each ${both.map((g) => np(g, { det: 'none' })).join(' and ')} you control`, plural: false });
  }
  // Cloud std-eoe (CR 608.2c; FAST5 T76's group, case 'each' of `obj` above): the group a pump, grant or control change just named is also the subject "they" /
  // "those creatures" ("Gain control of all creatures until end of turn. Untap them. They gain haste until end of turn.")
  if (st.group !== undefined && JSON.stringify(filter) === st.group) {
    out.push({ text: 'they', plural: true }, ...K.nounsOf(filter).map((n) => ({ text: `those ${pluralize(n)}`, plural: true })));
  }
  return out;
}

/** edh-next-143: the link of "For each player, choose friend or foe." (parser/holes/player.ts#FRIEND_OR_FOE_LINK; render may not import the parser). */
export const FRIEND_OR_FOE = 'friendOrFoe';

/** True when a reference stands for a player (the same tag names an object elsewhere: 'target', 'bound', 'event', 'linked', 'each'). */
export function isPlayerRef(ref: ObjRef | PlayerRef, st: RenderState): boolean {
  if (isPlayerOnlyRef(ref)) return true; // M12-1: the one table of player-only references (types/ability.ts, m12 design 4.3)
  switch (ref.ref) {
    case 'each': return 'who' in ref;
    case 'target': return st.specs.get(ref.id)?.kind === 'player';
    case 'bound': return st.info.get(`b:${ref.name}`)?.player === true;
    case 'event': return roleInfo(ref.role, st).info.player === true;
    case 'linked': return ref.link === 'opponent'; // edh-replace-3 (CR 607.2d): "the chosen player", the player the face's "As ~ enters, choose a player / an opponent" chose (parser/parse.ts#CHOSEN_OPPONENT_LINK)
    default: return false;
  }
}

/**
 * A clause whose subject is a reference: for a set of objects ("each") the subject has several wordings ("All creatures", "Creatures you control", "Each
 * creature") that also change the verb, so the whole clause is written once per wording.
 */
export function withSubjects(ref: ObjRef | PlayerRef, st: RenderState, build: (subject: string, plural: boolean) => string): string {
  if (ref.ref === 'each' && 'filter' in ref) return alt(...eachSubjects(ref.filter, st).map((s) => build(s.text, s.plural)));
  const p = isPlayerRef(ref, st) ? player(ref as PlayerRef, st, 'subject') : obj(ref as ObjRef, st, 'subject');
  return build(p.text, p.plural);
}

/** p2-modal-1: the permanent half (without its zone) of "a permanent of a description, or a suspended card", or null for any other filter. */
function permanentOrSuspended(f: ObjectFilter): ObjectFilter | null {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join();
  if (keys !== 'anyOf,zone' || JSON.stringify(f.zone) !== '["battlefield","exile"]' || f.anyOf?.length !== 2) return null;
  const [p, c] = f.anyOf;
  if (p === undefined || c === undefined || p.zone !== 'battlefield' || !isSuspendedCard(c)) return null;
  const { zone: _z, ...perm } = p;
  return perm;
}
