/**
 * References as phrases (WP2): "target creature", "it", "that creature", "its controller", "that player", "the top card of target player's library".
 * The first mention of a target prints its whole spec; later mentions are anaphors. An anaphor is a group of alternatives (render/text.ts): the Oracle
 * text may use the pronoun or the noun, the model says the same thing (design 6.8: "listed anaphora variants at positions the renderer marks anaphoric").
 */
import type { Count, EventPattern, EventRole, ObjectFilter, ObjRef, PlayerPred, PlayerRef, Quantity, TargetSpec } from '../types/ability';
import { isSuspendedCard } from './suspended';
import { isPlayerOnlyRef, TARGETED_PLAYER_LINK } from '../types/ability';
import { EVENT_ROLES, implicitRole, mixedCombatRole, opponentTargets, silentRole, TARGETING_CONTROLLER } from '../model/lint-roles';
import { K, type NpOpts } from './kernel';
import { objKey, personOf, playerKey, type Form, type Phrase, type RefInfo, type RenderState } from './state';
import { alt, displayFirst, joinList, NoRenderer, numWord, pluralize, withArticle } from './text';

const POSSESSIVE = (text: string): string => (/s$/.test(text) && !/'s$/.test(text) ? `${text}'` : `${text}'s`);

/**
 * Whether a thing described by `nouns` can be called `n` ("that creature"). A description that says its types ("creature", "permanent") answers for itself;
 * only a bare "permanent", "card" or "object" (nothing is known about its types) can still be anything.
 */
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
      const r = roleLookup(key.slice(2) as EventRole, st);
      if (r === null || r.isYou) continue;
      if (r.isSelf) push({ id: 'self', nouns: selfNouns(st), plural: false, player: false });
      else {
        // FAST2 T8: `subject` of a damage event is its `source` (roleIn): an unnamed source is implicit under either name ("whenever a creature you control is dealt damage, ... it")
        const role = key.slice(2) as EventRole;
        const implicit = implicitRole(st.trigger ?? [], role) || (role === 'subject' && implicitRole(st.trigger ?? [], 'source'));
        push({ id: r.id, nouns: r.info.nouns, plural: r.info.plural, player: r.info.player === true, ...(implicit ? { implicit: true } : {}) });
      }
    } else {
      const info = st.info.get(key);
      // Cloud std-fin: the name an option or a payment binds records whether the player did it ("if you do", `actor`), it names no object (the parser makes no mention of it)
      if (info && info.actor !== undefined && info.nouns.length === 0 && info.player !== true) continue;
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
  const others = antecedents(st).filter((a) => a.id !== mine && a.id !== st.notAntecedent && !onStackOnly(a) && !noPower(a) && !creatureOnly(a) && !mayBePlayer(a) && a.player === (info.player === true) && a.plural === info.plural);
  // FAST2 T10 (the parser's rule, parser/lower/anaphora.ts#compatible, Mention.selfObject): while a trigger's events leave the object where it is, "that
  // creature" never names the object itself (Oracle calls it "~" or "it", CR 201.5)
  // FAST4 T29: ... nor while every zone change of the trigger is another object's ("Whenever another creature you control enters, ~ gets +X/+0 until end of
  // turn, where X is that creature's power": `other`, CR 109.4, so the object itself has not moved)
  // FAST4 T28: ... and while the object that moved can never be the object itself ("whenever another creature you control dies", "whenever a creature an
  // opponent controls dies": CR 109.2 "another", and the controller of the ability controls the object itself)
  const otherMoved = (ev: EventPattern): boolean => ev.ev === 'zoneChange' && (ev.subject.other === true || ev.subject.controller === 'opponent');
  // MX5: ... nor in the object's own "enters" trigger: it has not moved since it entered (CR 603.6a; the parser's rule, parser/lower/scope.ts#eventMentions)
  const selfEntered = (ev: EventPattern): boolean => ev.ev === 'zoneChange' && ev.subject.self === true && ev.to === 'battlefield';
  const selfStays = (st.trigger ?? []).length > 0 && st.trigger!.every((ev) => ev.ev !== 'zoneChange' || otherMoved(ev) || selfEntered(ev));
  // FAST5 T58 (the parser's rule, parser/lower/anaphora.ts#resolveAnaphor): in the object's own "enters" trigger, once the ability has targeted an object of
  // the same sort and number, a bare pronoun is never the object itself (Oracle then calls it "~" or "this creature", CR 201.5, 115.1)
  // std-rx17 (CR 702.110b; the parser's rule, parser/lower/scope.ts#eventMentions): ... and in its own "When ~ exploits a creature", which follows its enters trigger
  const selfExploits = (ev: EventPattern): boolean => ev.ev === 'action' && ev.verb === 'exploit' && ev.object?.self === true;
  const ownEnters = (st.trigger ?? []).length > 0 && st.trigger!.every((ev) => selfEntered(ev) || selfExploits(ev));
  // std-rx11: ... and inside a delayed trigger that ability creates, for the target itself (RenderState.inOwnEnters)
  const targeted = (ownEnters && (mine.startsWith('t:') || others.some((a) => a.id.startsWith('t:') && a.implicit !== true))) || (st.inOwnEnters === true && mine.startsWith('t:'));
  // FAST5 T76 (the parser's rule, parser/lower/anaphora.ts#focusOf): the object the instruction right before created or put counters on is "it", whatever else was named
  const focused = info.player !== true && st.focus !== undefined && identityOf(st, st.focus) === mine
    && antecedents(st).every((a) => a.id === mine || a.id === st.notAntecedent || st.focusSeen === undefined || st.focusSeen.has(a.id));
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
  return { pronoun: chosen || focused || ownSubject || theyFocus || others.every((a) => a.implicit === true || (targeted && a.id === 'self')), noun: (n) => chosen || (focused && n === 'card') || n === iterates || saidToken(n) || !others.some((a) => canBeCalled(a.nouns, n) && !((selfStays || namedSelfStays) && a.id === 'self') && !(a.implicit === true && IMPLICIT_SILENT_NOUNS.has(n))) };
}

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
    if (form === 'possessive') return { text: pick(['their'], () => ["those players'"]), plural: true, person: 'pl' };
    return { text: pick(form === 'object' ? ['them'] : ['they'], () => ['those players']), plural: true, person: 'pl' };
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
      return role === 'spell' || role === 'subject' || role === 'object' ? obj(ev.spell !== undefined && selfOnly(ev.spell) ? ev.spell : { ...(ev.spell ?? {}), stackKind: 'spell' }, 'spell') : null;
    case 'activate':
      if (role === 'player') return ply(ev.player, 'player');
      // std-rx28 (CR 602.2): the ability itself, when the clause describes it ("you activate an ability that targets ...": "copy that ability")
      if (role === 'spell' && ev.activated !== undefined) return obj({ ...ev.activated, stackKind: 'ability' }, 'spell');
      return role === 'source' || role === 'subject' || role === 'spell' ? obj(ev.source, 'source') : null;
    case 'attacks':
      if (role === 'attacker' || role === 'subject') return obj(ev.attacker, 'attacker');
      // std-combat-1 (CR 508.1, 508.5; the parser's rule, parser/lower/scope.ts#eventMentions): "Whenever an opponent attacks with creatures, ... that opponent": the
      // clause names the attacking player and not whom the creatures attack, so the player is that opponent and the defender no antecedent
      if (ev.defender === undefined && ev.attacker?.controller === 'opponent' && ev.attacker.self === undefined && (role === 'player' || role === 'defender')) return role === 'player' ? ply('opponent', 'player') : null;
      if (role === 'defender' || role === 'player') return typeof ev.defender === 'string' || ev.defender === undefined ? ply(ev.defender as PlayerPred | undefined, 'defender') : null;
      return null;
    case 'blocks':
      if (role === 'blocker' || role === 'subject') return obj(ev.blocker, 'blocker');
      return role === 'attacker' || role === 'object' ? obj(ev.attacker, 'attacker') : null;
    case 'attacksUnblocked': // std-rx35 (CR 509.1h)
      return role === 'attacker' || role === 'subject' ? obj(ev.attacker, 'attacker') : null;
    case 'becomesBlocked':
      if (role === 'attacker' || role === 'subject') return obj(ev.attacker, 'attacker');
      return role === 'blocker' || role === 'object' ? obj(ev.by, 'blocker') : null;
    case 'damage':
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
    case 'createToken':
      if (role === 'player') return ply(ev.player, 'player');
      return ev.ev === 'createToken' && (role === 'newObject' || role === 'subject') ? obj(ev.token, 'new') : null;
    // Standard round 3, r3-trig (CR 108.4): the permanent whose control changed, and the player who gained control of it
    case 'controlChange':
      if (role === 'subject' || role === 'object') return obj(ev.object, 'subject');
      return role === 'player' ? ply(ev.to, 'player') : null;
    case 'becomes':
      if (role === 'object' && ev.what === 'attached' && ev.by !== undefined) return obj(ev.by, 'by'); // std-rx31: the permanent it became attached to
      if (role === 'subject' || role === 'object') return obj(ev.object, 'subject');
      if (role === 'player') return ply(ev.object.controller, 'controller');
      return role === 'source' || role === 'spell' ? obj(ev.by, 'by') : null;
    case 'counters':
      if (role === 'subject' || role === 'object') return 'player' in ev.on ? null : obj(ev.on as ObjectFilter, 'subject');
      return role === 'player' && 'player' in ev.on ? ply((ev.on as { player: PlayerPred }).player, 'player') : null;
    case 'action':
      if (role === 'player') return ply(ev.actor, 'actor');
      // std-rf (CR 701.9a): the object of a discard that names no description is a card (a card in the graveyard once it is discarded): "that card"
      return role === 'subject' || role === 'object' ? obj(ev.object ?? (ev.verb === 'discard' ? { zone: 'graveyard', isCard: true } : undefined), 'object') : null;
    case 'resolves':
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
      const named = r.slot === 'step.turn' && typeof r.player === 'object' && r.player !== null && r.player.ref === 'controllerOf' ? playerKey(r.player) : null;
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
    // Standard round 5, r5-trig (CR 702.122b, 702.171c; Canyon Vaulter): the permanent of "~ saddles a Mount or crews a Vehicle" is either one: "that Mount or Vehicle"
    const trig = st.trigger ?? [];
    if (r.slot === 'becomes.subject' && trig.length === 2 && trig.some((x) => x.ev === 'becomes' && x.what === 'saddleCostPaid') && trig.some((x) => x.ev === 'becomes' && x.what === 'crewCostPaid')) nouns = ['mount or vehicle'];
    // std-rx28 (CR 602.2): the activated ability a clause describes ("you activate an ability that targets a creature or player") is "that ability"
    // (and its source is the permanent or card, never "that ability": parser/lower/scope.ts#roleObject, the same rule)
    if (r.slot === 'activate.spell') nouns = ['ability'];
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
    // std-ry6 (CR 115.1, 701.6a; Glyph Keeper): Oracle names what targeted the object "that spell or ability" with no `by` too ("counter that spell or ability"),
    // as FAST3 T14's `by` form; the parser's mention has both heads (parser/holes/object.ts, W_SPELL_OR_ABILITY)
    // p2-graveyard-1 (CR 400.7, 700.4): ... and so is one a zone change put into either of several such zones ("When enchanted permanent dies or is put into exile,
    // return that card to the battlefield", Kaya's Ghostform): a card there, in no one zone the text names
    const toAnyOf = ev.ev === 'zoneChange' && r.slot === 'zoneChange.subject' && Array.isArray(ev.to) && ev.to.length > 0 && ev.to.every((z) => z !== 'battlefield' && z !== 'stack');
    const info: RefInfo = to !== undefined ? { nouns: [...new Set([...nouns, 'card'])], plural, zone: to }
      : toAnyOf ? { nouns: [...new Set([...nouns, 'card'])], plural }
      : targeting || targetingBy ? { nouns: ['spell or ability', 'spell', 'ability'], plural } : { nouns, plural };
    // FAST4 T33: the blocker of a block trigger is also "the blocking creature" (CR 509.1; the parser's participle anaphor names only that role)
    if (r.slot.endsWith('.blocker') && !self && !plural && to === undefined) info.alts = [...(info.alts ?? []), 'the blocking creature'];
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

const ROLES: EventRole[] = ['subject', 'object', 'source', 'player', 'recipient', 'spell', 'attacker', 'blocker', 'defender', 'newObject'];

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
  for (const role of ROLES) if (roleLookup(role, st) !== null && everyExposes(role) && !silentRole(trig, role)) st.mentioned.add(`e:${role}`);
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
  if (!items.some((x) => x.stackKind === 'spell') || !items.some((x) => x.stackKind !== 'spell')) return null;
  return items;
}

export function specPhrase(spec: TargetSpec, st: RenderState, extra: NpOpts = {}): string {
  st.used.add(spec.id);
  // design 3.6: a field of a target spec that the text cannot show would be announced to the player without being in the card's words
  if (spec.chooser !== undefined) throw new NoRenderer(`target ${spec.id} is chosen by another player`);
  if (spec.players !== undefined && spec.kind !== 'player' && spec.kind !== 'objectOrPlayer') throw new NoRenderer(`target ${spec.id}: players on a ${spec.kind} target`);
  // FAST4 T34 (CR 115.4): "any target that isn't a Dragon" is the one filter an `anyTarget` spec may have (parser/holes/object.ts#mixedTargets)
  const notOne = notOneSubtype(spec);
  const notThis = otherThanThis(spec); // CLOUD std-msh: "any other target" (other than this object, CR 109.2)
  if (spec.filter !== undefined && Object.values(spec.filter).some((v) => v !== undefined) && (spec.kind === 'player' || (spec.kind === 'anyTarget' && notOne === null && !notThis))) throw new NoRenderer(`target ${spec.id}: a filter on a ${spec.kind} target`);
  if (spec.groupLimit !== undefined && (spec.kind === 'player' || spec.kind === 'anyTarget' || (spec.kind === 'stackObject' && !spec.filter?.stackKind))) throw new NoRenderer(`target ${spec.id}: a total limit on a ${spec.kind} target`);
  const f: ObjectFilter = spec.filter ?? {};
  const { count, plural } = targetCount(spec, st);
  const other: { other?: true } = (spec.distinctFrom?.length ?? 0) > 0 ? { other: true } : {};
  const tail = spec.groupLimit ? ` with ${totalLimitWords(spec.groupLimit, st)}` : '';
  // FAST3 T14: "from a single graveyard" (TargetSpec.sameOwner) is a restriction only an object target's zone words can say
  if (spec.sameOwner === true && spec.kind !== 'object') throw new NoRenderer(`target ${spec.id}: one owner for a ${spec.kind} target`);
  if (spec.differentNames === true && (spec.kind !== 'object' || !plural)) throw new NoRenderer(`target ${spec.id}: different names for a ${spec.kind} target or a single target`);
  // CLOUD std-ecl (CR 205.3m): "two target creature cards that share a creature type" is said by the noun phrase (render/np.ts), in front of or behind the zone
  if (spec.sharedCreatureType === true && (spec.kind !== 'object' || !plural || count === undefined)) throw new NoRenderer(`target ${spec.id}: a shared creature type for a ${spec.kind} target or a single target`);
  const opts = {
    det: 'target' as const, plural, count, ...(spec.sameOwner === true ? { singleZone: true } : {}), ...(spec.differentNames === true ? { differentNames: true } : {}),
    ...(spec.sharedCreatureType === true ? { shareCreatureType: true } : {}), ...extra,
  };
  switch (spec.kind) {
    case 'anyTarget': {
      // CR 115.3: "another target" differs from "any target" (the same object may not be chosen twice)
      const another = other.other === true;
      // FAST4 T30 (family any-other-target): Oracle also prints "any other target" for the second of two "any target" recipients
      if (notOne !== null) {
        if (count !== undefined || another) throw new NoRenderer(`target ${spec.id}: several or other targets that aren't a ${notOne}`);
        return `any target that isn't ${withArticle(notOne)}`;
      }
      // CLOUD std-msh (CR 115.4, 109.2): "he deals damage equal to ... to any other target": no earlier target, so "other" is other than this object
      if (notThis) {
        if (another) throw new NoRenderer(`target ${spec.id}: other than this object and other than earlier targets`);
        return count === undefined ? alt('any other target', 'another target') : `${count} other ${plural ? 'targets' : 'target'}`;
      }
      if (count === undefined) return another ? alt('another target', 'any other target') : 'any target';
      return `${count}${another ? ' other' : ''} ${plural ? 'targets' : 'target'}`;
    }
    case 'player': {
      const who = spec.players?.who ?? 'any';
      const noun = who === 'opponent' ? 'opponent' : 'player';
      const word = plural ? pluralize(noun) : noun;
      const another = other.other === true;
      if (count === undefined) return `${another ? 'another ' : ''}target ${word}`;
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
        if (count !== undefined || plural || tail || other.other === true) throw new NoRenderer(`target ${spec.id}: a count, limit or "other" on a list of spells and abilities`);
        return `target ${joinList(items.map((x) => (x.stackKind === 'spell' ? K.np({ ...x, zone: 'stack' }, st, { det: 'none' }) : STACK_ITEM_HEAD[x.stackKind!]!)), 'or')}`;
      }
      // r4-fxb (CR 115.9a): "target spell or ability with a single target" (Bolt Bend, Redirect Lightning): the number of targets it has, said after the noun
      const single = f.targetCount !== undefined && f.targetCount.op === '==' && f.targetCount.value === 1 ? ' with a single target' : '';
      return other.other === true ? `${count ? `${count} other` : 'another'} target spell or ability${single}` : `${count ? `${count} ` : ''}target spell or ability${single}`;
    }
    case 'objectOrPlayer': {
      const who = spec.players?.who ?? 'any';
      if (who !== 'any' && who !== 'opponent') throw new NoRenderer(`target ${spec.id}: ${JSON.stringify(who)} players`);
      const noun = who === 'opponent' ? 'opponent' : 'player';
      const objects = K.np({ ...f, ...other }, st, opts);
      const bare = K.np({ ...f, ...other }, st, { det: 'none', plural });
      const lead = `${count ? `${count} ` : ''}target`;
      return alt(`${objects} or ${plural ? pluralize(noun) : noun}${tail}`, `${lead} ${plural ? pluralize(noun) : noun} or ${bare}${tail}`);
    }
    case 'object':
    default:
      // M6-8: "target spell or permanent" (CR 115.1, 612.1): an object on the stack (not an ability) or a permanent, nothing else said about it
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
        if (f.controller !== undefined || spec.groupLimit !== undefined || spec.sharedCardType === true || spec.sharedCreatureType === true) throw new NoRenderer(`target ${spec.id}: one target for each player with a named controller`);
        return `${K.np({ ...f, ...other }, st, opts)} that player controls`;
      }
      if (spec.perOpponent === true) {
        // FAST5 T66 (CR 115.1, 601.2c): "for each opponent, exile up to one target nonland permanent that player controls": the controller is the opponent the target is for (the
        // sentence says "for each opponent," in front, render/steps-zones.ts#move); one target at most
        if (spec.filter?.controller !== 'opponent' || spec.groupLimit !== undefined || spec.sharedCardType === true || spec.sharedCreatureType === true) throw new NoRenderer(`target ${spec.id}: one target for each opponent other than a permanent an opponent controls`);
        return `${K.np({ ...f, ...other, controller: undefined }, st, { ...opts, noController: true })} ${alt('that player', 'that opponent')} controls`; // r5-cost: "that opponent" names the same opponent
      }
      // std-cardcopy-7 (CR 115.1, 205.2a): "up to one target nonland card of each card type from your graveyard": the words before the zone, one target of a card in your graveyard
      if (spec.perCardType === true) {
        if (f.zone !== 'graveyard' || f.owner !== 'you' || plural || spec.groupLimit !== undefined || spec.sharedCardType === true || spec.sharedCreatureType === true || spec.differentControllers === true || spec.sameController === true) throw new NoRenderer(`target ${spec.id}: one of each card type other than one card from your graveyard`);
        return `${K.np({ ...f, ...other, zone: 'graveyard' }, st, { ...opts, noZone: true })} of each card type from your graveyard`;
      }
      // CLOUD std-ecl: a spec that shares both a card type and a creature type has no wording
      if (spec.sharedCardType === true && spec.sharedCreatureType === true) throw new NoRenderer(`target ${spec.id}: a shared card type and a shared creature type`);
      const shared0 = spec.sharedCardType === true ? ' that share a card type' : ''; // FAST5 T66 (CR 205.2a): the set chosen has a card type in common
      if (shared0 !== '' && (!plural || count === undefined)) throw new NoRenderer(`target ${spec.id}: a shared card type for a single target`);
      // CLOUD std-tmt (CR 115.1, 110.2): "two target creatures controlled by different players": no two targets of the set have one controller (no wording with a
      // shared card or creature type, or with a named controller)
      if (spec.differentControllers === true && (!plural || spec.sharedCardType === true || spec.sharedCreatureType === true || f.controller !== undefined)) throw new NoRenderer(`target ${spec.id}: different controllers for a single target or a named controller`);
      // std-rx30 (CR 115.1, 110.2): "two target creatures controlled by the same opponent": every target of the set has one controller, an opponent (the filter's
      // controller is said by those words, never as "an opponent controls")
      if (spec.sameController === true && (!plural || spec.differentControllers === true || spec.sharedCardType === true || spec.sharedCreatureType === true || f.controller !== 'opponent')) throw new NoRenderer(`target ${spec.id}: the same controller for a single target or another controller`);
      if (spec.sameController === true) return againPhrase(`${K.np({ ...f, ...other, controller: undefined }, st, { ...opts, noController: true })}${shared0} controlled by the same opponent`, spec, true, st);
      // p2-damage-2 (CR 601.2c, 603.3d): "target creature an opponent controls chosen at random": one target of a plain phrase, picked by the game
      if (spec.random === true && (plural || count !== undefined || shared0 !== '' || spec.differentControllers === true || spec.groupLimit !== undefined || spec.chooser !== undefined)) throw new NoRenderer(`target ${spec.id}: chosen at random with more than one target or another rule of the set`);
      const shared = `${shared0}${spec.differentControllers === true ? ' controlled by different players' : ''}${spec.random === true ? ' chosen at random' : ''}`;
      // FAST5 T66: the limit is a "with" feature of the noun phrase, so it may stand in front of the zone ("target creature cards with total mana value 3 or less from your graveyard")
      return againPhrase(`${K.np({ ...f, ...other }, st, spec.groupLimit ? { ...opts, total: totalLimitWords(spec.groupLimit, st) } : opts)}${shared}`, spec, count !== undefined || plural || other.other === true, st);
  }
}

/**
 * FAST5 T64 (CR 115.1): "becomes a copy of a second target artifact you control" (Shuri): a single target with the same description as one already named in the
 * text is also said "a second target ..." (the same object may be chosen for both, each "target" is its own choice).
 */
function againPhrase(base: string, spec: TargetSpec, notSingle: boolean, st: RenderState): string {
  if (notSingle || spec.kind !== 'object' || spec.min !== 1 || spec.max !== 1) return base;
  const same = [...st.specs.values()].some((o) => o.id !== spec.id && st.mentioned.has(`t:${o.id}`) && o.kind === 'object' && o.min === 1 && o.max === 1
    && JSON.stringify(o.filter ?? {}) === JSON.stringify(spec.filter ?? {}));
  return same ? alt(base, `a second ${base}`) : base;
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

export const isSpellOrPermanent = (f: ObjectFilter): boolean => {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined);
  return keys.length === 1 && JSON.stringify(f.zone) === '["stack","battlefield"]';
};


function specInfo(spec: TargetSpec): RefInfo {
  // STD-FRA (CR 115.1, 601.2c): one target for each opponent is a set (as many targets as there are opponents), "those creatures"
  const plural = spec.perOpponent === true || spec.perPlayer === true || spec.perCardType === true || (!(spec.min === 1 && spec.max === 1) && !(spec.min === 0 && spec.max === 1)); // std-cardcopy-7: one of each card type is a set too
  switch (spec.kind) {
    case 'player': return { nouns: ['player'], plural, player: true };
    case 'anyTarget': return { nouns: ['creature', 'permanent', 'player', 'planeswalker'], plural };
    case 'spell': return { nouns: ['spell'], plural };
    case 'ability': return { nouns: ['ability'], plural };
    case 'stackObject': return { nouns: ['spell', 'ability'], plural };
    default: {
      const half = spec.filter ? spellOrPermanentOf(spec.filter) : null; // FAST5 T59
      const nouns = spec.filter && (isSpellOrPermanent(spec.filter) || isSpellOrNonlandPermanent(spec.filter)) ? ['spell', 'permanent'] : half !== null ? ['spell', ...K.nounsOf(half)] : K.nounsOf(spec.filter ?? {});
      const or = spec.filter ? orNounsOf(spec.filter) : undefined;
      return { nouns, plural, ...(or ? { orNouns: or } : {}) };
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

const ATTACH_NOUNS = ['creature', 'permanent', 'land', 'artifact', 'enchantment', 'planeswalker'];

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
      const by = spec.kind === 'object' && spec.max === 1 ? (spec.filter?.controller === 'opponent' ? 'ctrl' : spec.filter?.owner === 'opponent' ? 'own' : null) : null;
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
    case 'linked': {
      const key = `l:${ref.link}`;
      const mentioned = st.mentioned.has(key);
      mention(st, key, { nouns: ['card', 'permanent', 'creature'], plural: false });
      if (mentioned) return anaphor(st.info.get(key)!, form, st, key);
      // std-rh (CR 702.167c): what the craft cost exiled, said by Oracle "the exiled card used to craft it"
      // std-craft-1 (CR 702.167c): and, when the cost exiled several, "the exiled cards used to craft it" (Mastercraft Raptor) or "... to craft this creature" (Sunbird Effigy)
      const crafted = ref.link === 'craft' ? (form === 'possessive' ? ["the exiled card used to craft it's"] : ['the exiled card used to craft it', 'the exiled cards used to craft it', 'the exiled cards used to craft ~']) : [];
      return { text: poss(alt(`the ${ref.link} card`, `the ${ref.link} permanent`, `the ${ref.link} creature`, `the ${ref.link} cards`, ...crafted)), plural: false, person: 'sg' };
    }
    case 'each': {
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
      if (restOfGroup(ref.filter) !== null) return { text: poss(alt('the rest', 'the other', "all cards revealed this way that weren't put onto the battlefield")), plural: true, person: 'pl' };
      // std-library-3 (CR 608.2c, 406.1): what a choice among a group of exiled cards left in exile is "the rest of the exiled cards" (parser/lower/mentions.ts#restOf)
      if (restOfExiled(ref.filter)) return { text: poss('the rest of the exiled cards'), plural: true, person: 'pl' };
      // FAST5 T59 (CR 608.2c): "those creatures you don't control": the part of a group a player controls or owns (parser/holes/object.ts#group)
      const part = groupPart(ref.filter);
      if (part !== null) return { text: poss(`${obj(part.group, st, 'object').text} ${part.who}`), plural: true, person: 'pl' };
      // std-rx28 (CR 115.9b, 608.2c; parser/lower/scope.ts#eventMentions): "those creatures" of "Whenever you cast a spell that targets one or more creatures": the
      // objects of that description the cast trigger's spell targets, said only as the group the trigger named
      if (ref.filter.targetedBy !== undefined) {
        const { targetedBy, ...desc } = ref.filter;
        const tb = targetedBy as { ref?: string; role?: string };
        const named = (st.trigger ?? []).some((p) => p.ev === 'cast' && p.spell?.targets !== undefined); // the trigger said "a spell that targets ..."
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
      const countText = single ? 'card' : `${typeof n === 'number' ? numWord(n) : K.qty(n, st)} cards`;
      const owner = K.player(ref.player, st, 'possessive').text;
      // cloud std-spm (CR 401.1): several cards are also "that many cards from the top of your library" (Symbiote Spider-Man, Doomskar Warrior)
      const fromTop = !single && form !== 'possessive' ? [`${countText} from the top of ${owner} library`] : [];
      // FAST5 T43 (CR 107.3, 608.2h): a computed number of cards is also "the top X cards of your library, where X is the number of lands you control"
      // Cloud std-woe (CR 401.1, 608.2h; family top-cards-where-x): and "that many cards from the top of your library" (Virtue of Courage)
      if (typeof n === 'object' && n.q !== 'X' && n.q !== 'var' && form !== 'possessive') {
        // std-lci (CR 608.2c, 603.2): the number of the triggering event or of an earlier step's result is also "that many cards from the top of your library"
        const thatMany = n.q === 'eventAmount' || (n.q === 'resultCount' && st.info.has(`r:${n.step}`)) ? [`that many cards from the top of ${owner} library`] : [];
        // std-rq (CR 401.1, 608.2h; family top-cards-equal-to): and "cards from the top of your library equal to the excess damage dealt to that creature this way"
        // std-exile-play-1-2 (family top-cards-equal-to): and "a number of cards from the top of your library equal to its power" (End-Blaze Epiphany)
        const equalTo = [`cards from the top of ${owner} library equal to ${K.qty(n, st)}`, `a number of cards from the top of ${owner} library equal to ${K.qty(n, st)}`];
        // std-rx8 (CR 401.1, 608.2h; family cards-equal-to-from-top): and "cards equal to its mana value from the top of target player's library"
        const equalToFromTop = [`cards equal to ${K.qty(n, st)} from the top of ${owner} library`];
         return { text: alt(`the top ${countText} of ${owner} library`, `the top X cards of ${owner} library, where X is ${K.qty(n, st)}`, ...thatMany, ...fromTop, ...equalTo, ...equalToFromTop), plural: true, person: personOf(true) };
      }
      return { text: fromTop.length > 0 ? alt(`the top ${countText} of ${owner} library`, ...fromTop) : poss(`the top ${countText} of ${owner} library`), plural: !single, person: personOf(!single) };
    }
    case 'union': {
      const same = sameNameCards(ref, st) ?? sharedZoneCards(ref, st);
      if (same !== null) return { text: poss(same), plural: true, person: 'pl' };
      // FAST5 T68 (family subject-quantifier): as a subject, a part that is a described set is also said bare, "~ and other Knights you control have flying"
      const parts = ref.of.map((r) => {
        const t = obj(r, st, form === 'possessive' ? 'object' : form).text;
        return form === 'subject' && r.ref === 'each' && 'filter' in r ? alt(t, K.np(r.filter, st, { det: 'none', plural: true })) : t;
      });
      return { text: poss(joinList(parts)), plural: true, person: 'pl' };
    }
    case 'grantor': {
      // r4-static (CR 201.5a): inside an ability another object's static ability grants, the outer card's name: the granting object (the parse
      // text holds the mark "¤" there, front/selfref.ts; render.ts#display writes the name)
      mention(st, 'grantor', { nouns: ['permanent', 'artifact', 'equipment', 'enchantment', 'aura'], plural: false });
      return { text: poss('¤'), plural: false, person: 'sg' };
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
        const nouns = cost !== undefined && cost.nouns.length > 0 ? [...new Set([...cost.nouns, 'card'])] : ['card'];
        mention(st, 'costExiled', { nouns, plural: false });
        return { text: poss(alt(...nouns.map((n) => `the exiled ${n}`))), plural: false, person: 'sg' };
      }
    case 'costSacrificed': {
      // FAST3 T18: "the sacrificed creature" (CR 608.2h): called by the nouns of the cost part that sacrificed it (render/costs.ts#COST_SACRIFICED) when this
      // ability states that cost, by any permanent noun otherwise (a spell's additional cost is a static ability of its own)
      const cost = st.info.get('cost:sacrificed');
      if (cost?.plural === true) throw new NoRenderer('the sacrificed objects of a cost that sacrifices more than one');
      const nouns = cost !== undefined && cost.nouns.length > 0 ? cost.nouns : ['creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'permanent'];
      mention(st, 'costSacrificed', { nouns, plural: false });
      // std-rw8 (CR 608.2h; family sacrificed-that-noun): Oracle also calls it "that creature" ("You may sacrifice another creature. When you do, ~ deals damage equal
      // to that creature's power ...", parser/lower/mentions.ts#paidSacrificed)
      return { text: poss(alt(...nouns.map((n) => `the sacrificed ${n}`), ...nouns.map((n) => `that ${n}`))), plural: false, person: 'sg' };
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
  if (types?.includes('aura')) return ATTACH_NOUNS.map((n) => `enchanted ${n}`);
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
      if (known) return many ? anaphor({ nouns: ['player'], plural: true, player: true }, form, st, key) : later();
      mention(st, key, { nouns: ['player'], plural: many, player: true });
      const text = poss(specPhrase(spec, st));
      return many ? { text, plural: true, person: 'pl' } : sg(text);
    }
    case 'controllerOf': case 'ownerOf': {
      // LNK1: a controller or owner the text named already ("target creature an opponent controls", "to its owner's hand") is "that player" too
      const again = known ? later() : null;
      // FAST5X E25 (CR 109.5): in "its controller" the source is no other antecedent while something else could be "it" (the parser's AnaphorInfo.selfLast)
      const saved = st.notAntecedent;
      if (ref.ref === 'controllerOf' && saved === undefined) st.notAntecedent = 'self';
      let whose: string;
      try {
        whose = obj(ref.object, st, 'possessive').text;
      } finally {
        if (saved === undefined) delete st.notAntecedent;
        else st.notAntecedent = saved;
      }
      const text = `${whose} ${ref.ref === 'controllerOf' ? 'controller' : 'owner'}`;
      mention(st, key, { nouns: ['player'], plural: false, player: true });
      return again === null ? sg(poss(text)) : { ...again, text: alt(again.text, poss(text)) };
    }
    case 'anOpponent': {
      if (known) return form === 'possessive' ? { text: alt("that player's", "that opponent's", 'their', "the opponent's"), plural: false, person: 'sg' } : sg(alt('that player', 'that opponent', 'the opponent'));
      mention(st, key, { nouns: ['player'], plural: false, player: true });
      return sg(poss('an opponent'));
    }
    case 'each': {
      const text = ref.who === 'player' ? 'each player' : ref.who === 'opponent' ? 'each opponent' : 'each other player';
      // std-mkm (CR 102.3): "each of your opponents" is each opponent of the controller, as subject and object ("deals 3 damage to each of your opponents")
      if (ref.who === 'opponent' && form !== 'possessive') return sg(alt(text, 'each of your opponents'));
      return sg(poss(text));
    }
    case 'event': {
      const r = roleInfo(ref.role, st);
      st.mentioned.add(`e:${ref.role}`);
      if (r.isYou) return YOU(form);
      // std-combat-1 (CR 102.3): a player the event describes as an opponent is also "that opponent" (roleLookup's nouns), as the parser reads it (Mention.heads)
      return later(r.info.nouns.includes('opponent'));
    }
    case 'bound': {
      // C6 (CR 101.3): the players of a group who can't do what a step told them, "each opponent who can't" each time (render/steps-util.ts#bindCant)
      const cant = st.info.get(`b:${ref.name}`)?.cant;
      if (cant !== undefined) return sg(poss(`each ${cant} who can't`));
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
      return sg(poss(alt('the chosen player', 'the player you chose')));
    case 'active': return sg(poss(alt('the active player', 'that player', 'the attacking player'))); // Standard round 4, r4-trig: "the attacking player" (CR 506.2)
    case 'defending': return sg(poss(alt('the defending player', 'defending player')));
    case 'iterating': return known ? later() : sg(poss(alt('that player', 'the player')));
    case 'otherOpponents': {
      // FAST4 T25: "each other opponent": other than the player the trigger's event named (the recipient); the bare form stays keyword data (myriad)
      if (ref.than !== undefined && ref.than.ref === 'event' && ref.than.role === 'recipient' && roleInfo('recipient', st).info.player === true) return sg(poss('each other opponent'));
      throw new NoRenderer('ref:otherOpponents (keyword data only: myriad, CR 702.116a)'); // M6-12
    }
    case 'fixed':
      throw new NoRenderer('ref:fixed (written only by the engine, never part of card data)');
    // std-rr (CR 303.4, 702.5a): the player the source Aura is attached to, a fixed name as "the defending player" is (no mention: the trigger event that names it
    // is what a later "they" / "that player" refers to, render/evt.ts)
    case 'enchantedPlayer': return sg(poss('enchanted player'));
    case 'otherOf': throw new NoRenderer('ref:otherOf (only in the fold of render/fold.ts#eachRevealsOtherLoses)'); // std-rx30
    case 'costChosen': // FAST5X E1: gift's chosen opponent (CR 702.174d-i: "the chosen player"); keyword data only
      return sg(poss('the chosen player'));
    case 'seat': { // M12-1 (m12 design D6): "the player to your left", "the player to the right of target opponent" (CR 101.4, 103.1)
      if (ref.of === undefined || ref.of.ref === 'you') return sg(poss(`the player to your ${ref.side}`));
      return sg(poss(`the player to the ${ref.side} of ${player(ref.of, st, 'object').text}`));
    }
    case 'controlsMost': { // C6: "each player who controls the most creatures" (every player tied for it; CR 109.4, 101.4)
      if (form === 'possessive') throw new NoRenderer('the possessive of "each player who controls the most ..."');
      return sg(`each player who controls the ${ref.fewest === true ? 'fewest' : 'most'} ${K.np(ref.filter, st, { det: 'none', plural: true })}`);
    }
    case 'eachWho': { // std-combat-1 (CR 608.2c, 508.1b): "each opponent who attacked you or a planeswalker you control this turn" (parser/holes/player.ts), that form only
      const d = ref.did;
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
  if (inner.stackKind !== 'spell' || inner.zone !== 'stack' || inner.controller !== undefined || inner.anyOf !== undefined || inner.not !== undefined) return null;
  return inner;
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
  // FAST4 T24: "Artifact spells you cast have convoke", "Each noncreature spell you cast has conspire" (CR 601.2a, 707.10)
  const cast = spellsYouCast(filter);
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

/** True when a reference stands for a player (the same tag names an object elsewhere: 'target', 'bound', 'event', 'linked', 'each'). */
export function isPlayerRef(ref: ObjRef | PlayerRef, st: RenderState): boolean {
  if (isPlayerOnlyRef(ref)) return true; // M12-1: the one table of player-only references (types/ability.ts, m12 design 4.3)
  switch (ref.ref) {
    case 'each': return 'who' in ref;
    case 'target': return st.specs.get(ref.id)?.kind === 'player';
    case 'bound': return st.info.get(`b:${ref.name}`)?.player === true;
    case 'event': return roleInfo(ref.role, st).info.player === true;
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
