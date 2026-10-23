/**
 * Pass 1, self and scope (design 6.5): the front end already replaced the object's own names by "~" (CR 201.5) and gave each quoted ability a scope of its
 * own (CR 201.5a: inside quotes "this creature" is the object that has the quoted ability). What is left here is to SEED the discourse model with the
 * event roles of the trigger (design 3.5, 6.4): "that creature", "that player", "it", "that much" may refer to what the event exposes. Owner: WP17.
 *
 * A role is a candidate only if EVERY pattern of the trigger exposes it (a trigger with several `on` patterns is a disjunction, CR 603.2), read from the
 * model's own role table (model/lint-roles.ts), so the parser and the lint never disagree.
 */
import type { EventPattern, EventRole, ObjectFilter, ZoneName } from '../../types/ability';
import { EVENT_ROLES, implicitRole, opponentTargets, patternsHaveAmount, selfCombatOnly, silentRole, SUBJECTLESS_VERBS, TARGETING_CONTROLLER } from '../../model/lint-roles';
import type { Draft, Mention } from './types';
import { cloneDraft, isRec } from './util';

const CARD_TYPES = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery'];
const PERMANENT_TYPES = ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker'];

/**
 * Head nouns an object described by `filter` can be called by. A filter without card types can be anything (`*`); "card" only outside the battlefield and
 * the stack (CR 109.2: on the battlefield it is a permanent), "spell" on the stack.
 */
export function headsOfFilter(filter: ObjectFilter | undefined, where: 'battlefield' | 'stack' | 'other' | 'unknown' = 'unknown'): string[] {
  const heads = new Set<string>();
  const types = (filter?.types ?? filter?.allTypes ?? []).map((t) => t.toLowerCase());
  // r4-repl (CR 301.5c, 205.3g, 702.151b): "target Equipment attached to that creature" is an artifact that is not a creature (an Equipment that is a creature
  // can't be attached to one; a reconfigured one stops being a creature), so no "that creature" names it
  if (types.length === 0 && filter?.attachedToObject !== undefined && (filter.subtypes ?? []).length > 0 && filter.subtypes!.every((s) => s === 'Equipment')) types.push('artifact');
  if (types.length === 0) heads.add('*');
  for (const t of types) heads.add(t);
  for (const s of filter?.subtypes ?? []) heads.add(s.toLowerCase());
  if (where === 'battlefield' || where === 'unknown') { if (types.length === 0 || types.some((t) => PERMANENT_TYPES.includes(t))) heads.add('permanent'); }
  if (where === 'other' || where === 'unknown') heads.add('card');
  if (where === 'stack') heads.add('spell');
  if (filter?.token === true) heads.add('token');
  heads.add('source');
  return [...heads];
}

/** Where a filter looks (its zone, battlefield by default). */
export function whereOf(filter: ObjectFilter | undefined): 'battlefield' | 'stack' | 'other' | 'unknown' {
  const z = filter?.zone;
  if (z === undefined || z === 'battlefield') return 'battlefield';
  if (z === 'stack') return 'stack';
  if (z === 'any' || Array.isArray(z)) return 'unknown';
  return 'other';
}

const zoneWhere = (z: ZoneName | ZoneName[] | undefined): 'battlefield' | 'stack' | 'other' | 'unknown' =>
  z === undefined || Array.isArray(z) ? 'unknown' : z === 'battlefield' ? 'battlefield' : z === 'stack' ? 'stack' : 'other';

/** FAST3 T14: the subtype heads of the other combatant's description ("a Wall": wall), none for the object itself or no description. */
const named = (x: ObjectFilter | undefined): string[] => (x === undefined || x.self === true ? [] : (x.subtypes ?? []).map((t) => t.toLowerCase()));

/** The object a role names in one pattern: its filter and where it is when the effect reads it. */
function roleObject(p: EventPattern, role: EventRole, selfHeads: string[]): { heads: string[]; verbs?: string[] } | null {
  const f = (x: unknown): ObjectFilter | undefined => (isRec(x) ? (x as ObjectFilter) : undefined);
  const self = (x: ObjectFilter | undefined): string[] | null => (x?.self === true ? [...selfHeads, 'permanent', 'card', 'source'] : null);
  switch (role) {
    case 'subject': {
      if (p.ev === 'zoneChange') {
        const where = zoneWhere(p.to);
        const verbs = p.to === 'exile' ? ['exiled'] : p.to === 'graveyard' ? ['died', 'milled', 'discarded'] : undefined;
        const heads = self(p.subject) ?? headsOfFilter(p.subject, where);
        // CR 603.6: after the move the object is a card in its new zone (or a permanent): both nouns name it
        if (where !== 'battlefield' && !heads.includes('card')) heads.push('card');
        return { heads, ...(verbs ? { verbs } : {}) };
      }
      if (p.ev === 'becomes') return { heads: self(p.object) ?? headsOfFilter(p.object, 'battlefield') };
      if (p.ev === 'counters') return isRec(p.on) && !('player' in p.on) ? { heads: self(p.on as ObjectFilter) ?? headsOfFilter(p.on as ObjectFilter, 'battlefield') } : null;
      // std-rf (CR 701.9a, 400.7): the object of "you discard a card" (a trigger that names no description) is a card, in the graveyard once it is discarded: "that card",
      // never "that permanent" or "that creature"
      if (p.ev === 'action' && p.verb === 'discard' && p.object === undefined) return { heads: ['card', 'source'] };
      if (p.ev === 'action') return { heads: self(p.object) ?? headsOfFilter(p.object) };
      if (p.ev === 'resolves') return { heads: [...headsOfFilter(p.what, 'stack'), 'spell'] };
      // std-rx16 (CR 508.1, 509.1): the creature that attacks, blocks or becomes blocked, under one name in a disjunction of combat events ("Whenever a
      // creature you control attacks or blocks, it gets ..."; model/lint-roles.ts#silentRole keeps it out of every other trigger)
      if (p.ev === 'attacks' || p.ev === 'blocks' || p.ev === 'becomesBlocked') {
        const own = staticRoleFilter(p, 'subject');
        return { heads: [...new Set(['creature', 'permanent', 'source', ...(self(own) ?? named(own))])] };
      }
      return null;
    }
    // std-copy-6 (CR 603.2, 113.1): the triggered ability of an `abilityTriggered` event is "that ability" only (no spell, no other object is it)
    case 'spell': return { heads: p.ev === 'cast' ? [...headsOfFilter(p.spell, 'stack'), 'spell'] : p.ev === 'abilityTriggered' ? ['ability'] : ['spell', 'ability', '*'] };
    // std-rx28 (CR 602.2): the source of an activation whose ability the clause describes ("you activate an ability that targets ...") is the permanent or card, never
    // "that ability" (the `spell` role is)
    case 'source': return { heads: p.ev === 'damage' ? self(f(p.source)) ?? headsOfFilter(p.source) : p.ev === 'activate' && p.activated !== undefined ? ['source', 'permanent', 'card'] : ['source', '*'] };
    case 'object': return { heads: p.ev === 'damage' ? headsOfFilter(f(p.recipient?.object), 'battlefield') : p.ev === 'becomes' && p.what === 'attached' && p.by !== undefined ? headsOfFilter(p.by, 'battlefield') // std-rx31
      : p.ev === 'becomes' ? self(p.object) ?? headsOfFilter(p.object, 'battlefield') : ['*'] };
    // FAST3 T14: a combatant the clause describes is also called by the words of its description ("becomes blocked by a Wall, destroy that Wall")
    // Standard round 4, r4-trig (CR 508.1; Tolsimir, Midnight's Light): an attacker the attack trigger describes is also called by the words of its description ("whenever a
    // Wolf you control attacks, ... that Wolf")
    case 'attacker': return { heads: [...new Set(['creature', 'permanent', 'source', ...(p.ev === 'attacks' || p.ev === 'attacksUnblocked' ? (self(f(p.attacker)) ?? named(f(p.attacker))) : []), ...named(p.ev === 'blocks' ? f(p.attacker) : undefined)])] };
    // FAST4 T33: the blocker is "the blocking creature" (CR 509.1), the one role a participle anaphor with 'blocking' names (lower/anaphora.ts#compatible)
    case 'blocker': return { heads: [...new Set(['creature', 'permanent', 'source', ...(p.ev === 'blocks' ? (self(f(p.blocker)) ?? []) : []), ...named(p.ev === 'becomesBlocked' ? f(p.by) : undefined)])], verbs: ['blocking'] };
    case 'newObject': return { heads: ['token', 'permanent', '*'] };
    default: return null;
  }
}

const PLAYER_ROLES: ReadonlySet<EventRole> = new Set(['player', 'recipient', 'defender']);

/** The filter of an object role in an event that does not move it (combat, damage, "becomes"); undefined for any other event or role. */
function staticRoleFilter(p: EventPattern, role: EventRole): ObjectFilter | undefined {
  const f = (x: unknown): ObjectFilter | undefined => (isRec(x) ? (x as ObjectFilter) : undefined);
  switch (p.ev) {
    case 'attacks': return role === 'attacker' || role === 'subject' ? f(p.attacker) : undefined;
    case 'attacksUnblocked': return role === 'attacker' || role === 'subject' ? f(p.attacker) : undefined; // std-rx35
    case 'blocks': return role === 'blocker' || role === 'subject' ? f(p.blocker) : role === 'attacker' || role === 'object' ? f(p.attacker) : undefined;
    case 'becomesBlocked': return role === 'attacker' || role === 'subject' ? f(p.attacker) : role === 'blocker' || role === 'object' ? f(p.by) : undefined;
    case 'damage': return role === 'source' || role === 'subject' ? f(p.source) : role === 'object' ? f(p.recipient?.object) : undefined;
    case 'becomes': return p.what === 'attached' && p.by !== undefined && role === 'object' ? f(p.by) : role === 'subject' || role === 'object' ? f(p.object) : undefined; // std-rx31: what it became attached to
    // std-rx17 (CR 702.110b): the exploiting creature stays on the battlefield
    case 'action': return p.verb === 'exploit' && role === 'subject' ? f(p.object) : undefined;
    default: return undefined;
  }
}

/**
 * FAST2 T10: the filter is exactly "the object itself" (`{self:true}` and nothing else). FAST5X E3: a status the object has as the event happens ("~ attacks
 * while saddled", CR 702.171b) still names the object itself.
 */
const onlySelf = (x: ObjectFilter | undefined): boolean => x !== undefined && x.self === true
  && Object.keys(x).filter((k) => (x as Record<string, unknown>)[k] !== undefined && !(k === 'saddled' && x.saddled === true)).length === 1;

/** "When ~ enters": a zone change of the object itself onto the battlefield. */
const selfEnters = (p: EventPattern): boolean => p.ev === 'zoneChange' && isRec(p.subject) && (p.subject as ObjectFilter).self === true && p.to === 'battlefield';
/** std-rx17 (CR 702.110b): "When ~ exploits a creature": the object's own exploit, which its enters trigger made (it has not moved since it entered). */
const selfExploits = (p: EventPattern): boolean => p.ev === 'action' && p.verb === 'exploit' && p.object?.self === true;

/** FAST5X E20: the object's own enters and a player's action that no object takes part in ("When ~ enters and whenever you expend 4"). */
const entersAndPlayerAction = (on: readonly EventPattern[]): boolean =>
  on.length === 2 && selfEnters(on[0]!) && onlySelf(on[0]!.ev === 'zoneChange' ? on[0]!.subject : undefined) && on[1]!.ev === 'action' && on[1]!.object === undefined && SUBJECTLESS_VERBS.has(on[1]!.verb);

/** FAST3 T18: an event of the object itself: it enters (CR 603.6a), or it is the attacker, blocker, damage source or changed object (it does not move). */
const ownEvent = (p: EventPattern): boolean => selfEnters(p) || onlySelf(staticRoleFilter(p, 'subject'));

/** FAST5 T37: the only event pattern is "you cast a spell that targets ~" (the spell filter's `targets` is the object itself). */
function castTargetsSelf(on: readonly EventPattern[]): boolean {
  if (on.length !== 1 || on[0]!.ev !== 'cast') return false;
  const t = (on[0]!.spell as { targets?: unknown } | undefined)?.targets;
  return isRec(t) && (t as Record<string, unknown>)['ref'] === 'self';
}

/** std-rx28: the description of the objects one cast pattern's spell targets ("a spell that targets one or more creatures"), a plain filter on permanents; else null. */
function castTargetsGroup(on: readonly EventPattern[]): ObjectFilter | null {
  if (on.length !== 1 || on[0]!.ev !== 'cast') return null;
  const t = on[0]!.spell?.targets as { ref?: string; filter?: ObjectFilter } | undefined;
  if (t?.ref !== 'each' || t.filter === undefined || t.filter.zone !== undefined || t.filter.self !== undefined || t.filter.targetedBy !== undefined) return null;
  return t.filter;
}

/** The mentions a trigger's events give the effect (design 6.4: "event roles of the trigger"). */
export function eventMentions(on: readonly EventPattern[], batch: boolean, selfHeads: string[], whole = false): Mention[] {
  if (on.length === 0) return [];
  const out: Mention[] = [];
  const roles = EVENT_ROLES[on[0]!.ev] ?? [];
  // T3 (push wave): "attacker" and "blocker" name the trigger's own creature in one combat event and the OTHER creature in another ("Whenever ~ attacks or
  // blocks": in the blocks event the attacker is the creature it blocks, CR 509.1). Such a role is a candidate only when it names the same side in every pattern.
  const combatMixed = on.some((p) => p.ev === 'blocks') && on.some((p) => p.ev === 'attacks' || p.ev === 'becomesBlocked');
  const sideOf = (p: EventPattern, role: EventRole): boolean => COMBAT_SUBJECT[p.ev] === role;
  // Standard round 5, r5-trig (CR 603.2c): "one or more counters are put on a creature you control" is one occurrence for EACH creature that gets counters
  // (triggers/occurrences.ts#batchOccurrences; the event hole reads only a singular object there), so its subject is that one creature: "that creature"
  // (not with TriggerDef.wholeBatch: "on one or more other Heroes you control" is one occurrence for all of them)
  // (not for ~ itself, "one or more counters are put on ~": the object is named by its name there, as before, never "that creature")
  const perObject = batch && !whole && on.every((p) => p.ev === 'counters' && !('player' in p.on) && (p.on as ObjectFilter).self !== true);
  for (const role of roles) {
    if (!on.every((p) => (EVENT_ROLES[p.ev] ?? []).includes(role))) continue;
    // FAST3 T14: the other combatant (`object` of "blocks" / "becomes blocked") is the attacker or blocker role of a lone pattern, never a second candidate
    // beside it; it is named only for the disjunction below
    if (role === 'object' && on.every((p) => p.ev === 'blocks' || p.ev === 'becomesBlocked')) continue;
    if (silentRole(on, role)) continue; // PUSH1 T2: a role the event never fills, or one the clause does not name (model/lint-roles.ts)
    // FAST5X E20: "When ~ enters and whenever you expend 4": the expend event has no subject, so the entering object is no role of every pattern
    if (role === 'subject' && entersAndPlayerAction(on)) continue;
    if (combatMixed && (role === 'attacker' || role === 'blocker') && !on.every((p) => sideOf(p, role) === sideOf(on[0]!, role))) continue;
    if (PLAYER_ROLES.has(role)) {
      // LNK1 (CR 603.3a): the player of a zone change of the ability's own object ("When ~ enters", "When ~ leaves the battlefield") controls the ability:
      // Oracle calls that player "you", never "that player" (render/refs.ts#roleLookup renders it "you" since FAST4 T34), so it is no antecedent
      if (role === 'player' && on.every((p) => p.ev === 'zoneChange' && onlySelf(p.subject))) continue;
      // FAST5X E19 (CR 109.5): the caster of "Whenever you cast ..." is "you" (the ability's controller), never "that player": "target player mills three cards.
      // If five or more mana was spent to cast that spell, that player mills ten cards instead" names the target (opus)
      if (role === 'player' && on.every((p) => p.ev === 'cast' && p.player === 'you')) continue;
      // CLOUD std-misc (CR 506.2, 508.1, 603.3a): the attacking player of "Whenever ~ attacks" controls ~ and so the ability: "you", never "they" or "that player"
      // ("Whenever ~ attacks, it deals damage to defending player equal to the number of artifacts they control": they is the defending player).
      // cmd1 (CR 508.1, 109.5): so is the attacking player of a creature you control attacking (a Background's granted "Whenever this creature attacks a
      // player"): "that player" of "Whenever ~ attacks a player, ... that player" is the defending player (the `defender` role) only
      if (role === 'player' && on.every((p) => p.ev === 'attacks' && p.attacker !== undefined && (onlySelf(p.attacker) || p.attacker.controller === 'you'))) continue;
      // std-combat-1 (CR 508.1, 508.5, 608.2c; Tomik, Wielder of Law): "Whenever an opponent attacks with creatures, ... that opponent loses 3 life": the clause names the
      // attacking player (the opponent whose creatures attack) and not whom they attack, so the defending player is no antecedent of "that opponent" / "they"
      if (role === 'defender' && on.every((p) => p.ev === 'attacks' && p.defender === undefined && p.attacker?.controller === 'opponent' && p.attacker.self === undefined)) continue;
      // a damaged "recipient" may be a player or an object; the role reads as a player reference only when the pattern says it is a player
      if (role === 'recipient' && !on.every((p) => p.ev === 'damage' && p.recipient?.player !== undefined && p.recipient.object === undefined)) continue;
      out.push({ sort: 'player', number: 'singular', heads: ['player', 'opponent'], ref: { ref: 'event', role }, origin: 'event', unit: -1 });
      continue;
    }
    const objs = on.map((p) => roleObject(p, role, selfHeads));
    if (objs.some((o) => o === null)) continue;
    const heads = [...new Set(objs.flatMap((o) => o!.heads))];
    const verbs = [...new Set(objs.flatMap((o) => o!.verbs ?? []))];
    // the object's own "enters" trigger: the entering object IS the object (it has not changed zones since, CR 603.6a), written {ref:'self'} (design 13.3)
    const ref = role === 'subject' && !batch && on.every(selfEnters) ? { ref: 'self' } : { ref: 'event', role };
    // FAST2 T10: the object itself in an event that leaves it where it is (Mention.selfObject: never "that creature")
    const selfObject = !batch && on.every((p) => onlySelf(staticRoleFilter(p, role)));
    // MX5: the object of its own "enters" trigger, which has not moved since it entered (CR 603.6a): Oracle names it "~", "this creature" or "it", so a
    // demonstrative ("that creature") means it only when nothing else can be meant ("When ~ enters, tap target creature an opponent controls. That creature
    // doesn't untap ...": the target, CR 201.5; Mention.selfEntered)
    // std-rx17 (CR 702.110b, 201.5): so is the object of its own "When ~ exploits a creature" (Oracle names it "~" or "this creature" there, "it" is the target:
    // Diver Skaab)
    const selfEntered = ref.ref === 'self' || (role === 'subject' && !batch && on.every(selfExploits));
    // FAST2 T10: what targeted the object ("becomes the target of a spell or ability") is a spell or an ability on the stack (Mention.stackObject)
    // FAST4 T27: ... also "a spell or ability you control" (`by` names only its controller: still the targeting spell or ability, CR 115.1)
    const byController = (f: ObjectFilter): boolean => Object.keys(f).length === 1 && f.controller !== undefined;
    // FAST5 T37: ... and the spell cast in "Whenever you cast a spell that targets ~" (heroic): the creature is what "put a +1/+1 counter on it" means
    const stackObject = (role === 'source' || role === 'spell') && (on.every((p) => p.ev === 'becomes' && p.what === 'targeted' && (p.by === undefined || p.by.stackKind !== undefined || byController(p.by))) || (role === 'spell' && castTargetsSelf(on)));
    // Standard round 4, r4-refs (CR 305.1, 601.2): a spell that was cast is never "that land" (a land is played, never cast), whatever its description leaves open
    const neverLand = role === 'spell' && on.every((p) => p.ev === 'cast');
    // std-rx15 (CR 111.1, 608.2c): an object its pattern describes as "nontoken" is never "that token" ("Whenever a nontoken Equipment you control enters, create a
    // token that's a copy of it ... Sacrifice that token ...": the copy), whatever its wildcard head says
    const neverToken = on.every((p) => (p.ev === 'zoneChange' && role === 'subject' && isRec(p.subject) ? (p.subject as ObjectFilter) : staticRoleFilter(p, role))?.token === false);
    const notHeads = [...(neverLand ? ['land'] : []), ...(neverToken ? ['token'] : [])];
    out.push({
      sort: 'object', number: batch && !(perObject && role === 'subject') ? 'plural' : 'singular', heads, ref, origin: 'event', unit: -1, ...(verbs.length > 0 ? { verbs } : {}), ...(implicitRole(on, role) ? { implicit: true } : {}),
      ...(selfObject ? { selfObject: true } : {}), ...(stackObject ? { stackObject: true } : {}), ...(selfEntered ? { selfEntered: true } : {}), ...(notHeads.length > 0 ? { notHeads } : {}),
    });
  }
  // FAST5 T37 (heroic, an ability word; CR 115.1): "Whenever you cast a spell that targets ~" names the object itself too (it has not moved, CR 201.5)
  if (castTargetsSelf(on) && !batch) out.push({ sort: 'object', number: 'singular', heads: [...new Set([...selfHeads, 'permanent', 'card', 'source'])], ref: { ref: 'self' }, origin: 'event', unit: -1, selfObject: true });
  // std-rx28 (CR 115.9b, 608.2c; Storm, Windrider): "Whenever you cast a spell that targets one or more creatures, those creatures ...": the objects of that description
  // the cast spell targets, a group (`targetedBy` the event's spell); only the plural (one spell may target several creatures)
  const group = castTargetsGroup(on);
  if (group !== null && !batch) out.push({ sort: 'object', number: 'plural', heads: headsOfFilter(group, 'battlefield'), ref: { ref: 'each', filter: { ...group, targetedBy: { ref: 'event', role: 'spell' } } }, origin: 'event', unit: -1 });
  // PUSH1 T2: "Whenever ~ blocks or becomes blocked": the object itself, not a combatant role (model/lint-roles.ts#selfCombatOnly)
  if (selfCombatOnly(on) && !batch) out.push({ sort: 'object', number: 'singular', heads: [...new Set([...selfHeads, 'permanent', 'card', 'source'])], ref: { ref: 'self' }, origin: 'event', unit: -1 });
  // T3 ... and when the trigger's own creature is the object itself in every pattern ("Whenever ~ attacks or blocks, it ..."), "it" is the object (CR 201.5).
  // (PUSH1 integration: the bare "blocks or becomes blocked" of T2's selfCombatOnly is handled above, so this branch only adds what T2 does not.)
  else if (combatMixed && !batch && on.every((p) => { const k = COMBAT_SUBJECT[p.ev]; return k !== undefined && isRec(p[k as keyof EventPattern]) && (p[k as keyof EventPattern] as ObjectFilter).self === true; })) {
    out.push({ sort: 'object', number: 'singular', heads: [...selfHeads, 'creature', 'permanent', 'source'], ref: { ref: 'self' }, origin: 'event', unit: -1 });
    // the OTHER creature of "blocks or becomes blocked" (the attacker it blocks, the creature blocking it) has no role name common to the patterns: it is an
    // opaque mention, so "that creature" / "it" there has two candidates and stays manual instead of binding to the object itself (design 6.4)
    // FAST3 T14: ... unless every pattern names that other creature ("blocks or becomes blocked by a non-Wall creature, destroy that creature"): then it is the
    // `object` role of each pattern (the attacker it blocks, the creature blocking it; triggers/normalize.ts, CR 509.1), one mention with the heads its
    // descriptions allow; "it" is still ambiguous with the object itself, "that creature" is not (Mention.selfObject)
    if (on.every((p) => p.ev === 'blocks' || p.ev === 'becomesBlocked')) {
      const others = on.map((p) => (p.ev === 'blocks' ? p.attacker : p.ev === 'becomesBlocked' ? p.by : undefined));
      if (others.every((f) => f !== undefined && f.self !== true)) {
        const heads = [...new Set(['creature', 'permanent', ...others.flatMap((f) => headsOfFilter(f, 'battlefield'))])];
        out.push({ sort: 'object', number: 'singular', heads, ref: { ref: 'event', role: 'object' }, origin: 'event', unit: -1 });
        // the object itself is "it", never "that creature" while it has not moved (FAST2 T10, Mention.selfObject; CR 201.5)
        const me = out.findIndex((m) => m.origin === 'event' && isRec(m.ref) && (m.ref as Record<string, unknown>)['ref'] === 'self');
        if (me >= 0) out[me] = { ...out[me]!, selfObject: true };
      } else out.push(OPAQUE(-1));
    }
  }
  // FAST3 T18: "Whenever ~ enters or attacks, it deals 4 damage to any target": every pattern of the disjunction is an event of the object itself (it enters,
  // CR 603.6a; it attacks, blocks, deals damage or becomes tapped without moving), so the object is what "it" means, whichever pattern triggered (CR 201.5).
  // No role name is common to such patterns, so nothing above names it.
  // (only when no object role is common to the patterns: such a role names the object already, and a second mention would make "it" ambiguous)
  if (!batch && on.length > 1 && on.every(ownEvent) && !out.some((m) => m.sort === 'object' || m.sort === 'any')) {
    // (Mention.selfObject: "that card" / "that creature" never names it, CR 201.5; it has not moved since it entered. Mention.fallback: as the object an
    // activation cost names, PUSH1 T2, it is a candidate only where nothing else is, in the first instruction: "tap target permanent. It doesn't untap ..."
    // keeps its one antecedent, the target, and a sentence that is not understood is not made contagious by it)
    out.push({ sort: 'object', number: 'singular', heads: [...new Set([...selfHeads, 'permanent', 'card', 'source'])], ref: { ref: 'self' }, origin: 'event', unit: -1, selfObject: true, fallback: true });
  }
  // FAST5X E21 (CR 603.8): a state trigger about the object itself ("When there are four or more page counters on ~, exile it"): the object is "it" (CR 201.5)
  if (on.length === 1 && on[0]!.ev === 'state' && JSON.stringify(on[0]!.cond).includes('{"ref":"self"}')) {
    out.push({ sort: 'object', number: 'singular', heads: [...new Set([...selfHeads, 'permanent', 'card', 'source'])], ref: { ref: 'self' }, origin: 'event', unit: -1, selfObject: true });
  }
  // FAST5X E20 (CR 603.6a, 700.14): "When ~ enters and whenever you expend 4, put a stash counter on it": the object itself is "it" whichever event triggered
  // (it entered and has not moved since; the other event is a player's, with no object of its own)
  if (!batch && entersAndPlayerAction(on)) out.push({ sort: 'object', number: 'singular', heads: [...new Set([...selfHeads, 'permanent', 'card', 'source'])], ref: { ref: 'self' }, origin: 'event', unit: -1, selfObject: true });
  // std-lci, and Cloud std-woe the same (CR 603.2, 608.2c, 608.2h): "whenever a creature you control with one or more counters on it dies, draw that many cards" (Shadow Urchin): the trigger's own words name
  // the counters, a number the event does not carry (its amount is how many objects moved), so it offers no amount and "that many" stays unresolved
  const countersNamed = on.some((p) => p.ev === 'zoneChange' && p.subject?.counters !== undefined);
  // std-rx7 (CR 603.10a, 608.2h, 122.1): with ONE such pattern, that number IS what "that many" names ("Whenever a creature you control with one or more counters on
  // it dies, exile that many cards ...", Shadow Urchin): the counters of that kind on the object that moved, as it last existed on the battlefield (a leaves-
  // the-battlefield trigger looks back in time; effects/eval.ts#counters reads the moved object's last known information)
  const named = on.length === 1 && !batch && on[0]!.ev === 'zoneChange' ? on[0]!.subject?.counters : undefined;
  if (named !== undefined && on[0]!.ev === 'zoneChange' && on[0]!.from === 'battlefield' && (named.cmp === undefined || (named.cmp.op === '>=' && named.cmp.value === 1))) {
    out.push({ sort: 'number', number: 'singular', heads: [], ref: { q: 'counters', on: { ref: 'event', role: 'subject' }, kind: named.kind }, origin: 'event', unit: -1 });
  }
  // Standard round 5, r5-trig (CR 107.4, 202.1; Namor the Sub-Mariner): "Whenever you cast a noncreature spell with one or more blue mana symbols in its mana cost,
  // create that many ...": the trigger's own words name a number, the blue mana symbols in that spell's mana cost
  const symbols = on.length === 1 && on[0]!.ev === 'cast' && !batch ? on[0]!.spell?.manaSymbols : undefined;
  if (symbols !== undefined) out.push({ sort: 'number', number: 'singular', heads: [], ref: { q: 'manaSymbols', of: { ref: 'event', role: 'spell' }, color: symbols.color }, origin: 'event', unit: -1 });
  // Merge wave 8 (audit D2, CR 603.2c, 608.2c): "When ~ enters" / "When ~ dies": the object itself moving is ONE event about one object, whose amount is always 1;
  // no "that many" names it, so it is no candidate beside the numbers the effect produces ("you may discard any number of cards. When you do, up to that many
  // target creatures ...", Miasma Demon: the cards discarded)
  const selfMoves = !batch && on.every((p) => p.ev === 'zoneChange' && p.subject?.self === true);
  if (patternsHaveAmount(on, batch) && !countersNamed && !selfMoves) out.push({ sort: 'number', number: 'singular', heads: [], ref: { q: 'eventAmount' }, origin: 'event', unit: -1 });
  // FAST1 T4 (design 6.4): "the upkeep of enchanted creature's controller" names the enchanted creature too ("put a -1/-1 counter on that creature"); any
  // head noun may name it (`*`), as lower/mentions.ts#namedMention does for a step that names it
  if (on.every(hostStep)) out.push({ sort: 'object', number: 'singular', heads: ['*'], ref: { ref: 'attachedTo' }, origin: 'event', unit: -1 });
  // std-rx19 (CR 115.1, 109.5): "Whenever a Dragon you control becomes the target of a spell or ability an opponent controls, ~ deals 3 damage to that player":
  // the player the clause names is the opponent who controls the targeting spell or ability (the event's own `player` is silent there, model/lint-roles.ts#silentRole)
  if (on.every(opponentTargets)) out.push({ sort: 'player', number: 'singular', heads: ['player', 'opponent'], ref: TARGETING_CONTROLLER, origin: 'event', unit: -1 });
  return out;
}

/** FAST1 T4: a step of the turn of the controller of the object the source is attached to (`whose: {ref:'controllerOf', object:{ref:'attachedTo'}}`). */
function hostStep(p: EventPattern): boolean {
  if (p.ev !== 'step' || !isRec(p.whose)) return false;
  const w = p.whose as Record<string, unknown>;
  return w['ref'] === 'controllerOf' && isRec(w['object']) && (w['object'] as Record<string, unknown>)['ref'] === 'attachedTo';
}

/** The role of a combat event that names the trigger's own creature (CR 508.1, 509.1): the attacker of "attacks" / "becomes blocked", the blocker of "blocks". */
const COMBAT_SUBJECT: Readonly<Partial<Record<EventPattern['ev'], EventRole>>> = { attacks: 'attacker', blocks: 'blocker', becomesBlocked: 'attacker', attacksUnblocked: 'attacker' /* std-rx35 */ };

/** Pass 1: seed the discourse model with the trigger's event roles. */
export function lowerScope(d: Draft): Draft {
  const out = cloneDraft(d);
  // PUSH1 T2: mentions the ability driver seeded (the objects an activation cost names, lower/ability.ts#costMentions) come first
  out.mentions = [...d.mentions, ...(d.trigger ? eventMentions(d.trigger.on, d.trigger.batch === true, d.selfHeads, d.trigger.wholeBatch === true) : [])];
  // a trigger clause that was not understood: what its event exposes is unknown, so no pronoun of the effect can be resolved (design 6.4, 6.6)
  if (d.unknownTrigger === true) out.mentions.push(OPAQUE(-1));
  return out;
}

/** The opaque mention (lower/types.ts#Mention): it stands for whatever a part that is not understood mentions. */
export const OPAQUE = (unit: number): Mention => ({ sort: 'any', number: 'plural', heads: ['*'], ref: {}, origin: 'opaque', unit });

export { CARD_TYPES };
