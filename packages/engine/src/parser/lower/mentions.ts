/**
 * The discourse model of design 6.4: what a pronoun may refer to at a given point of an ability. Owner: WP17.
 *
 * Mentions, in text order: the trigger's event roles (pass 1), the targets (CR 115.1, in word order), and what earlier steps produced or acted on as a set
 * ("all creatures", "the top three cards", the created tokens, the searched card, the chosen objects). A step that acts on an object that is already a
 * mention (a target, a bound name) does not add one; it adds what happened to it ("exiled", "sacrificed") and, after a move out of the battlefield, the noun
 * "card" (CR 400.7: the moved object is a card in its new zone; the model re-bases the reference for public zones, design 3.1).
 */
import type { ObjectFilter, TargetSpec } from '../../types/ability';
import { shieldShape } from '../taint';
import { controlledGroup, damagedGroup, drawnPerObject, grantedGroup, lockedGroup, looksAtOneCard, namesOnePlayer } from '../../model/focus';
import { DEALT_DAMAGE_THIS_WAY, EXILED_THIS_WAY, FOUGHT_THIS_WAY, PUT_INTO_GRAVEYARD_THIS_WAY, REVEALED_THIS_WAY } from '../holes/filter';
import { headsOfFilter, OPAQUE, whereOf } from './scope';
import type { Draft, Mention, Rec, Unit } from './types';
import { clone, isRec, visit } from './util';

/** A mention made by a step, with where that step is (so the anaphora pass can name it with `as`). */
export interface StepMention extends Mention {
  origin: 'step';
  unitRef: Unit;
  path: string;
  /**
   * std-rx32 (CR 608.2f, 608.2c): the path of the `forEach` whose body made this mention's objects, one per iteration ("For each creature card exiled this way,
   * create a token that's a copy of it. At the beginning of your next end step, sacrifice those tokens."): the plural mention of all of them, which the loop
   * gathers under the step's name (`forEach.gather`, written by lower/anaphora.ts#bind).
   */
  gathered?: string;
}

/** Ops whose result can be counted by "that many" (`{q:'resultCount'}`, design 6.5 pass 5). */
export const COUNTED_OPS: ReadonlySet<string> = new Set(['draw', 'discard', 'mill', 'destroy', 'sacrifice', 'sacrificeChoice', 'move', 'createToken', 'counter', 'putCounters', 'removeCounters', 'search', 'chooseObjects',
  'flipCoin', 'phaseOut']); // edh-d-39: the permanents a phase-out phased out (CR 702.26b)
// (std-rx30: 'flipCoin') // std-rx30: the coins a flip of several coins came up heads (CR 705.1)

const VERB_OF_OP: Readonly<Record<string, string>> = {
  destroy: 'destroyed', sacrifice: 'sacrificed', reveal: 'revealed', discard: 'discarded', counter: 'countered', createToken: 'created', mill: 'milled', chooseObjects: 'chosen',
};

export function targetMention(t: TargetSpec, unit: number): Mention {
  // STD-FRA (CR 115.1, 601.2c): one target for each opponent is a set of as many targets as there are opponents: "those creatures" names it, and a singular pronoun may too (`alsoSingular`)
  const plural = !(t.max === 1) || t.perOpponent === true || t.perPlayer === true || t.perCardType === true; // r5-fxb: one for each player too; std-cardcopy-7: one of each card type
  const number = plural ? 'plural' : 'singular';
  if (t.kind === 'player') return { sort: 'player', number, heads: t.players?.who === 'opponent' ? ['player', 'opponent'] : ['player'], ref: { ref: 'target', id: t.id }, origin: 'target', unit, ...(t.max !== 1 && !(t.perOpponent === true || t.perPlayer === true) ? { eachOne: true } : {}) };
  if (t.kind === 'anyTarget' || t.kind === 'objectOrPlayer') {
    const heads = t.kind === 'anyTarget' ? ['creature', 'planeswalker', 'battle', 'permanent', 'player', 'opponent'] : [...headsOfFilter(t.filter, 'battlefield'), 'player', 'opponent'];
    return { sort: 'any', number, heads, ref: { ref: 'target', id: t.id }, origin: 'target', unit };
  }
  const where = t.kind === 'spell' || t.kind === 'ability' || t.kind === 'stackObject' ? 'stack' : whereOf(t.filter);
  const heads = headsOfFilter(t.filter, where);
  if (t.kind === 'spell') heads.push('spell');
  if (t.kind === 'ability' || t.kind === 'stackObject') heads.push('ability');
  // r3-copy (CR 110.1, 110.4b): a target permanent of no stated card type ("up to one other target permanent you control") is on the battlefield, never "that spell"
  const notSpell = t.kind === 'object' && where === 'battlefield' && heads.includes('*');
  const controls = controlsOf(t.filter);
  return { sort: 'object', number, heads, ref: { ref: 'target', id: t.id }, origin: 'target', unit, ...(t.perOpponent === true || t.perPlayer === true || t.perCardType === true ? { alsoSingular: true } : {}), ...(notSpell ? { notHeads: ['spell'] } : {}), ...(controls ? { controls } : {}), ...(where === 'battlefield' ? { onBattlefield: true } : {}) };
}

/**
 * std-rx10 (CR 115.1, 608.2c): the group of the single object targets a "choose" sentence announced as "target A and target B" (template
 * eff.stdrx10.choose.twoTargets: a union of two or more target phrases, each of one object): a plural mention whose reference is that union, callable by the heads
 * every one of them has, with the participle "chosen". Null for anything else (one phrase, a phrase of several targets, a player).
 */
function announcedGroup(u: Unit, d: Draft): Mention | null {
  const step = u.steps[0];
  const what = isRec(step) ? step['what'] : undefined;
  if (!isRec(what) || what['ref'] !== 'union' || !Array.isArray(what['of']) || what['of'].length < 2) return null;
  const members: Mention[] = [];
  let allUpToOne = false;
  for (const r of what['of']) {
    const spec = isRec(r) && r['ref'] === 'target' ? d.targets.find((t) => t.id === r['id']) : undefined;
    // edh-mana-keywords-9 (CR 115.1, 115.4, 601.2c, 702.33c; Comet Storm): "Choose any target, then choose another target for each time this spell was kicked.": any targets (an
    // object or a player), the second as many as the spell was kicked (`{q:'kickCount'}`), one group of targets
    const kicked = spec !== undefined && spec.kind === 'anyTarget' && isRec(spec.min) && isRec(spec.max) && spec.min['q'] === 'kickCount' && spec.max['q'] === 'kickCount';
    const one = spec !== undefined && (spec.kind === 'object' || spec.kind === 'anyTarget') && spec.min === 1 && spec.max === 1;
    // edh-next-124 (CR 115.1, 601.2c, 608.2b; Teferi, Who Slows the Sunset): "Choose up to one target artifact, up to one target creature, and up to one target land. Untap the chosen
    // permanents you control.": objects announced "up to one" each are a group too (the targets chosen, none for one not chosen), only when every member is "up to one" (below)
    const upToOne = spec !== undefined && spec.kind === 'object' && spec.min === 0 && spec.max === 1;
    if (spec === undefined || !(one || kicked || upToOne) || spec.perOpponent === true || spec.perPlayer === true) return null;
    if (upToOne !== (members.length === 0 ? upToOne : allUpToOne)) return null;
    allUpToOne = upToOne;
    members.push(targetMention(spec, u.index));
  }
  const heads = members.slice(1).reduce((acc, m) => acc.filter((h) => m.heads.includes(h)), members[0]!.heads);
  if (heads.length === 0) return null;
  if (members.some((m) => m.sort === 'any')) {
    if (!members.every((m) => m.sort === 'any')) return null; // objects and any targets are not mixed
    return { sort: 'any', number: 'plural', heads, ref: { ref: 'union', of: members.map((m) => m.ref) }, origin: 'target', unit: u.index, verbs: ['chosen'] };
  }
  return { sort: 'object', number: 'plural', heads, ref: { ref: 'union', of: members.map((m) => m.ref) }, origin: 'target', unit: u.index, verbs: ['chosen'] };
}

/**
 * std-costs-2 (CR 601.2b, 601.2c): a "choose" sentence of its own (`announced`) followed by a rider that announces other targets instead when a condition decided at
 * announcement holds (`{"@replace": true, op: "if", then: [<chooseTargets node>], else: ["@previous"]}`, lower/choose.ts#insteadChoose): exactly one of the two sets
 * is chosen, so they are one plural group with the participle "chosen", callable by the heads both have. Null for anything else.
 */
function insteadChosenGroup(prev: Unit, u: Unit, d: Draft): Mention | null {
  const first = prev.steps.length === 1 && isRec(prev.steps[0]) && prev.steps[0]['lower'] === 'chooseTargets' ? prev.steps[0] : undefined;
  const patch = u.rider?.patch;
  const then = isRec(patch) && patch['@replace'] === true && patch['op'] === 'if' && Array.isArray(patch['else']) && patch['else'].length === 1 && patch['else'][0] === '@previous' ? patch['then'] : undefined;
  const second = Array.isArray(then) && then.length === 1 && isRec(then[0]) && then[0]['lower'] === 'chooseTargets' ? then[0] : undefined;
  if (first === undefined || second === undefined) return null;
  const refOf = (n: Rec): Rec | null => (isRec(n['what']) && n['what']['ref'] === 'target' && typeof n['what']['id'] === 'string' ? n['what'] : null);
  const a = refOf(first);
  const b = refOf(second);
  const specs = [a, b].map((r) => (r === null ? undefined : d.targets.find((t) => t.id === r['id'])));
  if (specs.some((t) => t === undefined || t.kind !== 'object')) return null;
  const members = specs.map((t) => targetMention(t!, u.index));
  const heads = members[0]!.heads.filter((h) => members[1]!.heads.includes(h));
  if (heads.length === 0) return null;
  // std-costs-6 (CR 601.2c, 702.194b): two single targets ("Choose target creature card .... If this spell was cast using teamwork, instead choose target creature
  // card ...."): one object is chosen either way, "the chosen card"
  const one = specs.every((t) => t!.min === 1 && t!.max === 1);
  return { sort: 'object', number: one ? 'singular' : 'plural', heads, ref: { ref: 'union', of: members.map((m) => m.ref) }, origin: 'target', unit: u.index, verbs: ['chosen'] };
}

/** std-rx10: what a target's description says of its controller (Mention.controls), or undefined. */
function controlsOf(f: ObjectFilter | undefined): Mention['controls'] {
  if (f === undefined) return undefined;
  if (f.controller === 'you') return 'you';
  if (f.controller === 'opponent') return 'opponent';
  const not = f.not as Record<string, unknown> | undefined;
  if (f.controller === undefined && isRec(not) && Object.keys(not).length === 1 && not['controller'] === 'you') return 'notYou';
  return undefined;
}

/** r3-refs: the card types of permanents (CR 110.4), as head nouns. */
const PERMANENT_HEADS: ReadonlySet<string> = new Set(['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker']);

/**
 * edh-c-98 (CR 608.2c, 205.2; Killer Instinct): the card types an enclosing `if` of the step at `path` says the object `what` has ("If it's a creature card, put it onto the
 * battlefield."): the heads (lower case) of a `matches` condition on that very object, whose filter is only card types. Empty for any other guard.
 */
function typeGuardOf(steps: readonly Rec[], path: string, what: Rec): string[] {
  const out: string[] = [];
  let cur: unknown = steps;
  for (const k of path.split('/').slice(1)) {
    cur = isRec(cur) ? cur[k] : Array.isArray(cur) ? cur[Number(k)] : undefined;
    if (!isRec(cur) || cur['op'] !== 'if' || cur['else'] !== undefined) continue;
    const c = cur['cond'];
    if (!isRec(c) || c['cond'] !== 'matches' || !isRec(c['object']) || !sameRef(what, c['object']) || !isRec(c['filter'])) continue;
    const f = c['filter'];
    if (!Array.isArray(f['types']) || Object.keys(f).some((x) => x !== 'types' && x !== 'isCard')) continue;
    for (const t of f['types']) if (typeof t === 'string' && PERMANENT_HEADS.has(t.toLowerCase())) out.push(t.toLowerCase());
  }
  return out;
}

/** The verb and the new nouns a step gives the object it acts on. */
function effectOn(step: Rec): { verb?: string; heads: string[] } {
  const op = step['op'] as string;
  if (op === 'move') {
    const to = isRec(step['to']) ? (step['to']['zone'] as string | undefined) : undefined;
    const verb = to === 'exile' ? 'exiled' : to === 'hand' ? 'returned' : to === 'battlefield' ? 'returned' : to === 'graveyard' ? 'milled' : undefined;
    return { ...(verb ? { verb } : {}), heads: to !== undefined && to !== 'battlefield' ? ['card'] : [] };
  }
  const verb = VERB_OF_OP[op];
  return { ...(verb ? { verb } : {}), heads: op === 'destroy' || op === 'sacrifice' ? ['card'] : [] };
}

// edh-c-96 (CR 603.2, 608.2c; Furnace Scamp): two roles of one event are two things (the damage event's source creature and the player it damaged), so `role` counts too
const sameRef = (a: Rec, b: unknown): boolean => isRec(b) && a['ref'] === b['ref'] && (a['id'] === undefined || a['id'] === b['id']) && (a['name'] === undefined || a['name'] === b['name']) && (a['role'] === undefined || b['role'] === undefined || a['role'] === b['role']);

/** Object fields of a step that name what it acts on ("tap enchanted creature", "put a counter on ~", "attach ~ to ..."). */
// FAST5 T39: `attachTo` (createToken, CR 303.4f): "Return target creature card ... to the battlefield. Create a Young Hero Role token attached to it" names the returned creature
export const ACTED_ON = ['what', 'on', 'from', 'to', 'a', 'b', 'attachTo'] as const;

/**
 * What a step acts on, as [path relative to the step, value]: the fields of ACTED_ON, and the object the effects of an `effect` step apply to (the
 * `affects` of a continuous effect, "it gets +2/+2"; the `subject` of a restriction, "it can't block"). Those change the object too (design 3.1 rule 1,
 * CR 611.2c), so after a move they must follow it as "return it" does (CR 400.7). WP21 review: `effects[*].affects` used to keep the stale target handle.
 */
export function actedOn(step: Rec): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const k of ACTED_ON) if (step[k] !== undefined) out.push([`/${k}`, step[k]]);
  // edh-d-59 (CR 400.7, 608.2c; Call of the Death-Dweller): "Return up to two target creature cards ... to the battlefield. Put a deathtouch counter on either of them.": the group the
  // controller then chooses one of is the permanents the earlier step made of the targets, not the cards that were targeted (a new object in a new zone)
  if (step['op'] === 'chooseObjects' && isRec(step['from']) && isRec(step['from']['filter']) && step['from']['filter']['is'] !== undefined) out.push(['/from/filter/is', step['from']['filter']['is']]);
  // FAST5 T41: a token created attached to "it" ("return it to the battlefield, then create a Role token attached to it") is attached to the new object the earlier step made of it (CR 400.7, 303.7)
  if (step['op'] === 'createToken' && step['attachTo'] !== undefined) out.push(['/attachTo', step['attachTo']]);
  // FAST5X E12 (CR 701.60a, 400.7j): "suspect it" acts on the permanent ("Return target creature card ... to the battlefield. Suspect it." suspects the
  // permanent it became). Only suspect: the subject of the other keyword actions keeps its reading until each is reviewed (G10).
  if (step['op'] === 'action' && step['action'] === 'suspect' && step['subject'] !== undefined) out.push(['/subject', step['subject']]);
  // std-lci (CR 701.44a, 400.7): "Return target creature card from your graveyard to the battlefield. That creature explores" explores with the permanent it
  // became (the counter goes on it); reviewed for explore alone, the other keyword actions keep the reading above
  // edh-c-14 (CR 701.50a, 400.7): the same for "it connives" (the permanent does it, never a spell on the stack that targeted it: Illuminator Virtuoso)
  if (step['op'] === 'action' && (step['action'] === 'explore' || step['action'] === 'connive') && step['subject'] !== undefined) out.push(['/subject', step['subject']]);
  // edh-c-7 (CR 400.7, 611.2a, 611.2b): "For as long as that creature has a mannequin counter on it, it has ..." after "Return target creature card from your graveyard to the
  // battlefield ...": the object whose state the duration judges is the permanent the earlier step made, as the object the effect applies to is
  const dur = step['duration'];
  if (step['op'] === 'effect' && isRec(dur) && dur['d'] === 'whileObject' && dur['object'] !== undefined) out.push(['/duration/object', dur['object']]);
  const effects = step['effects'];
  if (step['op'] === 'effect' && Array.isArray(effects)) {
    effects.forEach((e, i) => {
      if (!isRec(e)) return;
      if (e['s'] === 'continuous' && e['affects'] !== undefined) out.push([`/effects/${i}/affects`, e['affects']]);
      if (e['s'] === 'restrict' && e['subject'] !== undefined) out.push([`/effects/${i}/subject`, e['subject']]);
    });
  }
  return out;
}

/** Ops that move the object they act on to another zone (CR 400.7: it becomes a new object). */
const MOVING_OPS: ReadonlySet<string> = new Set(['move', 'destroy', 'sacrifice', 'counter']);
/** Zones whose objects are public (CR 400.2): a binding moved there follows the card (CR 400.7j). */
const PUBLIC_ZONES: ReadonlySet<string> = new Set(['battlefield', 'graveyard', 'exile', 'stack', 'command']);

const NAMED_REFS: ReadonlySet<unknown> = new Set(['self', 'attachedTo']);
const STEP_LISTS: readonly string[] = ['then', 'else', 'do', 'otherwise', 'onWin', 'onLose'];
/** A nested ability (granted, a token's): its "~" and its host are its own. */
const isAbility = (v: Rec): boolean => typeof v['kind'] === 'string' && typeof v['text'] === 'string' && v['id'] === undefined; // a TargetSpec has an id
function pushNamed(out: Rec[], v: unknown): void {
  if (isRec(v) && NAMED_REFS.has(v['ref']) && !out.some((x) => x['ref'] === v['ref'])) out.push({ ref: v['ref'] });
}

/** edh-d-96: a condition counts the cards exiled with the object (`{q:'count', of:{ref:'linked', link:'exiled'}}`, `ever` or not). */
function linkedCountIn(c: unknown): boolean {
  const walk = (v: unknown): boolean => Array.isArray(v) ? v.some(walk) : isRec(v) ? ((v['q'] === 'count' && isRec(v['of']) && v['of']['ref'] === 'linked' && v['of']['link'] === 'exiled') || Object.values(v).some(walk)) : false;
  return walk(c);
}

/** p2-refs-2: the `{ref:'self'}` records namedIn made for a `wasCast` condition alone (namedMention marks them Mention.condSelf). */
const CAST_SELF = new WeakSet<Rec>();

/** Every `{ref:'self'}` / `{ref:'attachedTo'}` inside a value (a condition, a quantity), nested abilities and step lists left out. */
export function namedIn(value: unknown, out: Rec[] = []): Rec[] {
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!isRec(v) || isAbility(v)) return;
    pushNamed(out, v);
    // edh-c-33 (CR 508.1, 509.1, 603.4; Air Nomad Student): "if this creature didn't attack this turn, put a +1/+1 counter on it" / "if ~ attacked or blocked this turn, its owner shuffles it ...": the
    // history of the object itself (an attacker or blocker `{self:true}`) names ~, so "it" after it may be ~ (only adds a candidate, as the wasCast reading below)
    if (v['cond'] === 'happened' && isRec(v['event']) && (v['event']['ev'] === 'attacks' || v['event']['ev'] === 'blocks')) {
      const who = v['event']['ev'] === 'attacks' ? v['event']['attacker'] : v['event']['blocker'];
      if (isRec(who) && who['self'] === true && Object.keys(who).length === 1) pushNamed(out, { ref: 'self' });
    }
    // p2-refs-2 (CR 702.33d, 601.2, 603.4; Aggressive Sabotage, Skizzik): "if this spell was kicked" / "if this creature wasn't kicked" names ~ (a `wasCast` with no
    // `object` is about the object itself), so "it deals 3 damage" / "sacrifice it" after it may be ~
    if (v['cond'] === 'wasCast' && v['object'] === undefined && !out.some((x) => x['ref'] === 'self')) {
      const me = { ref: 'self' };
      CAST_SELF.add(me);
      out.push(me);
    }
    // edh-c-67 (CR 603.4, 120.1; Dunerider Outlaw): "if ~ dealt damage to an opponent this turn, put a +1/+1 counter on it": a `happened` condition whose event is the object's own
    // damage names ~ (the event's source is the object itself), so "it" after it may be ~. Only the damage the object itself dealt, as `wasCast` above
    const evSrc = v['cond'] === 'happened' && isRec(v['event']) && v['event']['ev'] === 'damage' && isRec(v['event']['source']) ? v['event']['source'] : undefined;
    if (evSrc !== undefined && evSrc['self'] === true && Object.keys(evSrc).length === 1 && !out.some((x) => x['ref'] === 'self')) {
      const me = { ref: 'self' };
      CAST_SELF.add(me);
      out.push(me);
    }
    // edh-d-96 (CR 607.2a, 603.4; Colfenor's Urn): "if three or more cards have been exiled with ~, sacrifice it": a count of the cards exiled with the object names ~ (the object the link is
    // on), so "it" after it may be ~ (only a candidate when nothing else is, as the wasCast reading above)
    if (v['q'] === 'count' && isRec(v['of']) && v['of']['ref'] === 'linked' && v['of']['link'] === 'exiled' && !out.some((x) => x['ref'] === 'self')) {
      const me = { ref: 'self' };
      CAST_SELF.add(me);
      out.push(me);
    }
    for (const [k, x] of Object.entries(v)) if (!STEP_LISTS.includes(k)) walk(x);
  };
  walk(value);
  return out;
}

/** The objects named inside the conditions and quantities a step itself holds (not those of the steps nested in it): "if enchanted creature is red". */
function conditionObjects(step: Rec): Rec[] {
  const out: Rec[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!isRec(v) || isAbility(v)) return;
    if (typeof v['cond'] === 'string' || typeof v['q'] === 'string') { namedIn(v, out); return; }
    for (const [k, x] of Object.entries(v)) if (!STEP_LISTS.includes(k)) walk(x);
  };
  walk(step);
  return out;
}

/**
 * "~" and "enchanted/equipped creature" named by a step are mentions too (design 6.4): in "When this Aura enters, tap enchanted creature and remove all
 * counters from it" both the Aura (the trigger's subject) and the enchanted creature are candidates for "it", so the sentence is manual instead of
 * binding the Aura. Any head noun may name them (`*`): the reference does not say what it is, so this only ever adds candidates. (WP21 interface change.)
 * WP21 review: so are the objects a condition or a quantity of the step names (design 6.4 lists conditions, quantities and cost objects as mentions).
 */
function namedObjects(step: Rec): Rec[] {
  const out: Rec[] = [];
  for (const [, v] of actedOn(step)) pushNamed(out, v);
  // edh-d-94 (CR 400.7j, 608.2c; Jhoira of the Ghitu): the one card a cost exiled, once an earlier instruction acted on it by its participle ("Put four time counters on the exiled card."),
  // is "it" of a later sentence ("If it doesn't have suspend, it gains suspend."): the card in exile the instruction found (lower/anaphora.ts#actsOnCostExiled)
  for (const [, v] of actedOn(step)) if (isRec(v) && v['ref'] === 'costExiled' && v['self'] === undefined && Object.keys(v).length === 1 && !out.some((x) => x['ref'] === 'costExiled')) out.push({ ref: 'costExiled' });
  for (const r of conditionObjects(step)) pushNamed(out, r);
  for (const r of possessorObjects(step)) pushNamed(out, r);
  // p2-refs-2 (CR 702.3b, 609.4; Dark Maze): "~ can attack this turn as though it didn't have defender" names ~ (the permission is the object's own, so the step
  // holds no reference to it): "Exile it at the beginning of the next end step." after it is ~. Like the rest, this only adds a candidate
  const effects = step['effects'];
  if (step['op'] === 'effect' && Array.isArray(effects) && effects.some((e) => isRec(e) && e['s'] === 'permit' && e['action'] === 'attackAsThoughNoDefender' && e['of'] === undefined)) pushNamed(out, { ref: 'self' });
  return out;
}

/**
 * Standard round 6 (CR 608.2c, design 6.4): "~" and "enchanted/equipped creature" named through a player of the step ("enchanted creature's owner shuffles it
 * into their library", Watery Grasp): the owner or controller of a named object, as the step's actor or the owner of the zone it moves to. Like the rest of
 * `namedObjects`, this only adds candidates.
 */
function possessorObjects(step: Rec): Rec[] {
  const out: Rec[] = [];
  const to = step['to'];
  for (const p of [step['who'], isRec(to) ? to['owner'] : undefined]) {
    if (isRec(p) && (p['ref'] === 'ownerOf' || p['ref'] === 'controllerOf')) out.push(p['object'] as Rec);
  }
  return out;
}

const COST_PARTICIPLE_REFS: ReadonlySet<string> = new Set(['costSacrificed', 'costExiled', 'costDiscarded']); // edh-d-53
const namedMention = (ref: Rec, unit: number, d?: Draft): Mention => ({ sort: 'object', number: 'singular', heads: ['*'], ref: CAST_SELF.has(ref) ? { ref: 'self' } : ref, origin: 'event', unit, ...(CAST_SELF.has(ref) ? { condSelf: true } : {}), ...(d !== undefined && selfNeverSpell(ref, d) ? { notHeads: ['spell', 'card'] } : {}), ...(ref['ref'] === 'self' ? { namedSelf: true } : {}) });

/**
 * p2-refs-2 (CR 608.2c, 614.15; Canopy Surge): the objects the condition of a rider's patch names ("If this spell was kicked, it deals 4 damage ... instead": ~), as
 * mentions of the unit, for the pronouns of the patch; only those `mentions` does not already hold. Like namedObjects, this only adds candidates.
 */
export function riderCondMentions(patch: Rec, unit: number, d: Draft, mentions: readonly Mention[]): Mention[] {
  return namedIn(patch['cond']).filter((ref) => !mentions.some((m) => m.sort !== 'number' && isRec(m.ref) && sameRef(m.ref as Rec, ref))).map((ref) => namedMention(ref, unit, d));
}

/**
 * FAST5X E19 (CR 112.1, 601.2): "~" named by a step of a triggered ability of a permanent card is never "that spell": the ability's source is not on the
 * stack as a spell (its trigger is not the cast of the card itself, and the card is no instant or sorcery). So in "Whenever you cast an instant or sorcery
 * spell, put a +1/+1 counter on ~. If five or more mana was spent to cast that spell, ..." the spell is the triggering one (opus), as Oracle means.
 * Nor is it "that card" until a step moved it (CR 201.5: an object names itself "~", "this creature" or "it"; lower/anaphora.ts#compatible).
 */
function selfNeverSpell(ref: Rec, d: Draft): boolean {
  if (ref['ref'] !== 'self' || d.trigger === undefined || d.selfHeads.includes('instant') || d.selfHeads.includes('sorcery')) return false;
  return !d.trigger.on.some((p) => p.ev === 'cast' && isRec(p.spell) && (p.spell as Rec)['self'] === true);
}

/** The mention a step makes, or null (it acts on something already mentioned, or produces nothing nameable). */
function producedBy(step: Rec, unit: Unit, path: string, headsOf: (ref: unknown) => string[] = () => [], wholeBatch = false): StepMention | null {
  const op = step['op'];
  const base = { origin: 'step' as const, unit: unit.index, unitRef: unit, path, ref: typeof step['as'] === 'string' ? { ref: 'bound', name: step['as'] } : { ref: 'bound', name: '' } };
  const verb = typeof op === 'string' ? VERB_OF_OP[op] : undefined;
  // Standard round 5, r5-refs (CR 608.2c, 608.2d): the one player whose option an instruction is, named through the trigger's object ("Whenever a creature is dealt
  // damage, its controller may exile that many cards from the top of their library. They may play those cards until the end of their next turn."): that player is
  // "they" / "that player" afterwards. Only the controller or owner of an event object (a target player is a mention of its own)
  // p2-copy-spell-1 (CR 608.2c, 608.2d, 118.12): or through a target object, of an option or an optional payment ("Then that permanent's controller may sacrifice a land
  // of their choice. If the player does, they may copy this spell ...", Chain of Vapor; "Then that creature's controller may pay {2}{U}. If the player does, they ...",
  // Chain Stasis): the one controller of the target whose option the instruction is (not its owner: "Its owner may put it on top of their library" has its own
  // candidates, ownerSubject / ownerNamed)
  const actor = step['who'];
  const ofTarget = isRec(actor) && actor['ref'] === 'controllerOf' && isRec(actor['object']) && actor['object']['ref'] === 'target';
  // edh-b-11 (CR 701.21a, 608.2c, 109.4; Arcum Dagsson): and the controller of a target who sacrifices it ("Target artifact creature's controller sacrifices it. That player may search ...")
  if ((op === 'may' || op === 'pay' || (op === 'sacrificeChoice' && ofTarget)) && isRec(actor) && (actor['ref'] === 'controllerOf' || actor['ref'] === 'ownerOf') && isRec(actor['object']) && (actor['object']['ref'] === 'event' || ofTarget)) {
    return { ...base, ref: actor, sort: 'player', number: 'singular', heads: ['player'], ...(actor['object'] !== undefined && isRec(actor['object']) && actor['object']['ref'] === 'event' ? { optionActor: true } : {}) };
  }
  // edh-next-34 (CR 608.2c, 109.4, 400.7; Declaration in Stone): "Exile target creature and all other creatures its controller controls with the same name as that creature. That player
  // investigates for each nontoken creature exiled this way.": the group names one player, the controller of the target (read as last known information), "that player" afterwards
  if (op === 'move' && isRec(step['what']) && step['what']['ref'] === 'union' && Array.isArray(step['what']['of'])) {
    const group = (step['what']['of'] as unknown[]).find((x) => isRec(x) && x['ref'] === 'each' && isRec(x['filter']) && isRec(x['filter']['controller']) && x['filter']['controller']['ref'] === 'controllerOf'
      && isRec(x['filter']['controller']['object']) && x['filter']['controller']['object']['ref'] === 'target') as Rec | undefined;
    if (group !== undefined) return { ...base, ref: (group['filter'] as Rec)['controller'] as Rec, sort: 'player', number: 'singular', heads: ['player'] };
  }
  // edh-next-131 (CR 601.2, 608.2c, 707.10; Finale of Promise): the spells one cast of two targets cast ("You may cast up to one target instant card and/or up to one target sorcery card ...
  // If X is 10 or more, copy each of those spells twice."): the step binds the spells it cast under its `as` (effects/handlers/tokens-cast.ts); "those spells" afterwards. Only that shape (a
  // union of targets, a named result), so no other cast gives a pronoun a new candidate
  if (op === 'cast' && typeof step['as'] === 'string' && isRec(step['what']) && step['what']['ref'] === 'union' && Array.isArray(step['what']['of']) && (step['what']['of'] as unknown[]).every((x) => isRec(x) && x['ref'] === 'target')) {
    return { ...base, sort: 'object', number: 'plural', heads: ['spell'], verbs: ['cast'] };
  }
  // std-hob (CR 701.47c, 608.2c): "the Army you amassed" is the Army chosen by an amass action ("amass Goblins 1, then attach ~ to the amassed Army"); it is named only by
  // the participle "amassed", so no pronoun gets a new candidate
  // p2-attack-block-2 (CR 701.15a, 608.2c): the group a goad of a description goaded ("Goad all creatures your opponents control. Until your next turn, those creatures
  // can't block."): the creatures the step acted on, bound under its `as` (effects/handlers/goad.ts binds every one, newly goaded or not); named by a noun or "they"
  if (op === 'action' && step['action'] === 'goad' && isRec(step['subject']) && step['subject']['ref'] === 'each' && isRec(step['subject']['filter'])) {
    const f = step['subject']['filter'] as ObjectFilter;
    return { ...base, sort: 'object', number: 'plural', heads: headsOfFilter(f, whereOf(f)) };
  }
  // edh-perms-15 (CR 701.36a, 111.1, 608.2c; Determined Iteration): the token a populate created ("Populate. The token gains haste ... Sacrifice it ..."): the step records it under its `as`
  if (op === 'action' && step['action'] === 'populate' && step['n'] === undefined) return { ...base, sort: 'object', number: 'singular', heads: ['token', 'permanent', 'creature'], verbs: ['created'] };
  // edh-c-64 (CR 701.40a, 608.2c; Wildcall): the permanent one manifest of the top card makes, "Manifest the top card of your library, then put X +1/+1 counters on it": the step records it under its `as`
  // (effects/handlers/face-ops.ts binds every card manifested); "it" names the one permanent of a single manifest
  if (op === 'action' && step['action'] === 'manifest' && step['n'] === undefined && step['arg'] === undefined && step['subject'] === undefined) return { ...base, sort: 'object', number: 'singular', heads: ['permanent', 'creature', 'card'], verbs: ['manifested'] };
  // edh-next-136 (CR 121.1, 701.20a, 608.2c; Jace, Mirror Mage): the one card "Draw a card and reveal it." drew and revealed, "that card" afterwards (effects/handlers/cards-draw.ts#drawAndReveal binds it)
  if (op === 'draw' && step['revealDrawn'] === true) return { ...base, sort: 'object', number: 'singular', heads: ['card'], verbs: ['drawn', 'revealed'] };
  // edh-d-89 (CR 701.39a, 608.2c; Optimus Prime, Autobot Leader): the creature a bolster chose ("Bolster 2. The chosen creature gains trample until end of turn."): the step records it under
  // its `as` (effects/handlers/actions-native-counters.ts#bolster binds the one creature); named by the participle "chosen" and then "that creature"
  if (op === 'action' && step['action'] === 'bolster' && step['subject'] === undefined) return { ...base, sort: 'object', number: 'singular', heads: ['creature', 'permanent'], verbs: ['chosen'] };
  // edh-next-136 (CR 121.1, 701.20a, 608.2c; Jace, Mirror Mage): the one card "Draw a card and reveal it." drew and revealed, "that card" afterwards (effects/handlers/cards-draw.ts#drawAndReveal binds it)
  if (op === 'action' && step['action'] === 'amass') {
    const sub = typeof step['arg'] === 'string' ? [step['arg'].toLowerCase()] : [];
    return { ...base, sort: 'object', number: 'singular', heads: ['army', 'creature', 'permanent', ...sub], verbs: ['amassed'], participleOnly: true };
  }
  // CLOUD std-ecl (CR 701.68c, 608.2c): "the blighted creature" is the creature you chose when you blighted ("you may blight 1. If you do, create a token that's a
  // copy of the blighted creature"); named only by the participle, and only when you blight (each of several players blighting chooses a creature of their own)
  if (op === 'action' && step['action'] === 'blight' && isRec(step['who']) && step['who']['ref'] === 'you') {
    return { ...base, sort: 'object', number: 'singular', heads: ['creature', 'permanent'], verbs: ['blighted'], participleOnly: true };
  }
  // r4-mech (CR 701.57a, 701.57c, 608.2c): "the discovered card" is the card a discover by you binds (the nonland card it stopped at, cast or put into your hand); named
  // only by the participle
  if (op === 'action' && step['action'] === 'discover' && isRec(step['who']) && step['who']['ref'] === 'you') {
    return { ...base, sort: 'object', number: 'singular', heads: ['card'], verbs: ['discovered'], participleOnly: true };
  }
  // std-rx30 (CR 400.7, 701.6a, 614.15): the card a counter step exiled in place of its owner's graveyard ("If a permanent spell is countered this way, exile it
  // instead ... You may cast that card ..."; Thranduil's Decree) is a new object, "that card"; only when the step names it (`as`) and exiles only some spells (`toIf`)
  if (op === 'counter' && step['toIf'] !== undefined && typeof step['as'] === 'string') return { ...base, sort: 'object', number: 'singular', heads: ['card'] };
  if (op === 'createToken') {
    const tok = isRec(step['token']) ? step['token'] : {};
    const heads = ['token', 'permanent', ...((tok['types'] as string[] | undefined) ?? []).map((x) => x.toLowerCase()), ...((tok['subtypes'] as string[] | undefined) ?? []).map((x) => x.toLowerCase())];
    if (tok['predefined']) heads.push(String(tok['predefined']).toLowerCase(), 'artifact');
    // edhn95 (CR 111.1, 608.2c; Life of the Party): every player of a group makes a token, so the tokens are several, whatever the count each makes (the step binds all of them, effects/handlers/tokens-create.ts)
    const group = isRec(step['who']) && step['who']['ref'] === 'each';
    return { ...base, sort: 'object', number: step['count'] === 1 && !group ? 'singular' : 'plural', heads, verbs: ['created'] };
  }
  // CR 707.2, 111.1: a token copy is a new object ("Sacrifice that token"); it has the copied object's nouns too, so a bare "it" after a copy has two
  // candidates (the copied object and the token) and the unique-candidate rule leaves it manual (design 6.4). A spell copy is a new object on the stack
  // (CR 707.10). WP23 review.
  if (op === 'copy') {
    const number = (step['count'] === undefined || step['count'] === 1) && !(isRec(step['who']) && step['who']['ref'] === 'each' /* edhn95: one copy for each player of a group */) ? 'singular' : 'plural';
    const copied = headsOf(step['what']).filter((h) => h !== 'card');
    // edh-next-130 (CR 608.2c, 707.2; Tempt with Reflections): a token copy of a TARGET is not named by the target's own nouns ("Create a token that's a copy of that creature. Each opponent may
    // create a token that's a copy of that creature.": "that creature" is the target again; Oracle names the token "the token" / "that token")
    // combined copy: never "token" (the copy IS a token): with a target token ("a copy of target token you control. That token ...") both stay candidates (edh-perms-23)
    const ofTarget = isRec(step['what']) && step['what']['ref'] === 'target';
    if (step['result'] === 'token') return { ...base, sort: 'object', number, heads: [...new Set(['token', 'permanent', 'copy', ...copied])], verbs: ['created'], ...(ofTarget && copied.filter((h) => h !== 'permanent' && h !== 'token').length > 0 ? { notHeads: copied.filter((h) => h !== 'permanent' && h !== 'token') } : {}) };
    return { ...base, sort: 'object', number, heads: [...new Set(['copy', 'spell', ...copied])] };
  }
  // FAST5 T76 (CR 608.2c, 122.1): the creatures a counters step put counters on as a group ("Put a +1/+1 counter on each creature you control. Untap those creatures."):
  // the step records the objects it acted on under its `as` (effects/handlers/counters.ts#recordActed), so a later "them" / "those creatures" is exactly those
  if (op === 'putCounters' && isRec(step['on']) && step['on']['ref'] === 'each' && isRec(step['on']['filter'])) {
    const f = step['on']['filter'] as ObjectFilter;
    return { ...base, sort: 'object', number: 'plural', heads: headsOfFilter(f, whereOf(f)) };
  }
  // FAST5 T76 (CR 608.2c, 611.2c): the group a pump or grant gave a continuous effect ("Creatures you control get +1/+1 until end of turn. Untap them."): the same
  // description read again, only when nothing the effect does can change who matches it (a static description, a power / toughness or ability layer)
  const group = grantedGroup(step);
  if (group !== null) return { ...base, sort: 'object', number: 'plural', heads: headsOfFilter(group['filter'] as ObjectFilter, whereOf(group['filter'] as ObjectFilter)), ref: group };
  // Standard round 4, r4-refs (CR 608.2c, 611.2c): the group a draw counted ("Draw a card for each creature you control with a +1/+1 counter on it. Those creatures
  // gain indestructible until end of turn."): the same description of permanents read again (drawing changes no permanent). Named by a noun only ("those
  // creatures"), so no bare pronoun gets a new candidate
  const counted = drawnPerObject(step);
  if (counted !== null) return { ...base, sort: 'object', number: 'plural', heads: headsOfFilter(counted['filter'] as ObjectFilter, whereOf(counted['filter'] as ObjectFilter)), ref: counted, headOnly: true };
  // CLOUD std-tmt (CR 611.2c, 608.2c): the group a control change took ("Gain control of all artifacts your opponents control until end of turn. Untap them."): the objects
  // the step locked, bound under its `as` (the description no longer fits them once they changed controller)
  const taken = controlledGroup(step);
  if (taken !== null) return { ...base, sort: 'object', number: 'plural', heads: headsOfFilter(taken['filter'] as ObjectFilter, whereOf(taken['filter'] as ObjectFilter)) };
  // edh-replace-6 (CR 611.2c, 608.2c; Mutational Advantage): the group a grant took whose description can change ("Permanents you control with counters on them gain hexproof
  // ... Prevent all damage that would be dealt to those permanents this turn."): the objects the step locked, bound under its `as`
  const locked = lockedGroup(step);
  if (locked !== null) return { ...base, sort: 'object', number: 'plural', heads: headsOfFilter(locked['filter'] as ObjectFilter, whereOf(locked['filter'] as ObjectFilter)) };
  // "For each opponent, that player ..." / "For each creature, ... it": the object or player of the current iteration (CR 608.2f; WP23)
  if (op === 'forEach' && typeof step['as'] === 'string' && isRec(step['over'])) {
    const over = step['over'];
    if (over['ref'] === 'each' && typeof over['who'] === 'string') {
      return { ...base, sort: 'player', number: 'singular', heads: over['who'] === 'opponent' ? ['player', 'opponent'] : ['player'], ...(over['who'] === 'opponent' || over['who'] === 'player' ? { iterates: over['who'] } : {}) };
    }
    if (over['ref'] === 'each' && isRec(over['filter'])) {
      const f = over['filter'] as ObjectFilter;
      // edh-next-131 (CR 301.5c, 303.4d, 608.2c; Arna Kennerüd, Skycaptain): a permanent attached to an object is never a creature (an Equipment or Aura that is a creature is never attached), so
      // the element of "for each nontoken permanent attached to it" is "that permanent", never "that creature"
      const attachedOnly = f.attachedToObject !== undefined && f.types === undefined && f.anyOf === undefined;
      const heads = headsOfFilter(f, whereOf(f));
      return { ...base, sort: 'object', number: 'singular', heads: attachedOnly ? heads.filter((h) => h !== '*' && h !== 'creature') : heads };
    }
    // edh-players-13 (CR 608.2f, 608.2d): "For each player who chose fame, ... that player ...": the player of the current iteration
    if (over['ref'] === 'chose') return { ...base, sort: 'player', number: 'singular', heads: ['player'], iterates: 'player' };
    return null;
  }
  // FAST4 T19: what a damage step actually dealt damage to (effects/handlers/lifedamage.ts binds exactly those, CR 120.3), named only by "a creature dealt
  // damage this way" (parser/holes/filter.ts): a participle-only mention, so no pronoun, "that creature" or "that many" changes its antecedents
  if (op === 'damage') return { ...base, sort: 'object', number: 'plural', heads: ['*'], verbs: [DEALT_DAMAGE_THIS_WAY], participleOnly: true };
  // trek-22 (CR 701.14a, 608.2c; T'Pring, Never Parted): the creatures a fight step made fight (effects/handlers/lifedamage.ts#fightBetween binds exactly those), named only by "a creature that fought this way" (parser/templates/zz-cloud/trek-22.json)
  if ((op === 'fight' && step['pairs'] !== true) || (step['lower'] === 'fightEachOther' && step['by'] !== 'toughness')) return { ...base, sort: 'object', number: 'plural', heads: ['*'], verbs: [FOUGHT_THIS_WAY], participleOnly: true };
  // FAST5 T75 (CR 701.23a, 701.17a, 608.2c): the cards a search found are "found" (the `Found` hole: "Put one of them onto the battlefield tapped"); the cards a mill put into
  // a graveyard are "milled" (the `Milled` hole: "You may put a land card from among them into your hand"), a participle-only mention so no other pronoun gets a candidate
  // CLOUD C9 (CR 701.23a): a search for a card of each of several descriptions ("a basic land card and a Shrine card", `and`) finds several cards
  if (op === 'search') {
    const more = Array.isArray(step['and']) ? (step['and'] as ObjectFilter[]) : [];
    const heads = [...headsOfFilter(step['filter'] as ObjectFilter, 'other'), ...more.flatMap((f) => headsOfFilter(f, 'other'))];
    // std-costs-2 (CR 701.23a, 701.20a, 608.2c): the ONE card a search revealed is also "the revealed card" ("Search your library for a creature card, reveal it, put it
    // into your hand, then shuffle. If ... the revealed card is the chosen type, ...", Celestial Reunion)
    const one = step['max'] === 1 && more.length === 0;
    return { ...base, sort: 'object', number: one ? 'singular' : 'plural', heads: [...new Set(heads)], verbs: ['found', ...(one && step['reveal'] === true ? ['revealed'] : [])] };
  }
  // std-ry6 (CR 701.17a, 608.2c, 608.2h): ONE player's mill of ONE card is also "the milled card" ("Mill a card, then draw cards equal to the milled card's mana
  // value"), bound by the step's `as` (effects/handlers/cards-draw.ts#millHandler): the group stays plural for "milled this way" and may also be named singular
  // (`alsoSingular`); a mill of several cards or by several players has no "the milled card"
  const millsOne = step['count'] === 1 && isRec(step['who']) && (step['who']['ref'] === 'you' || step['who']['ref'] === 'target' || (step['who']['ref'] === 'event' && step['who']['role'] === 'player' /* edh-c-48 (CR 701.17a; Infernal Genesis): the one player of the trigger's event, "that player mills a card" */));
  // (edh-players-4: "those cards" also names the cards YOU milled; several players' mills are no one group, and a later "choose ... Put those cards" is about the cards chosen)
  const youMill = isRec(step['who']) && step['who']['ref'] === 'you';
  if (op === 'mill') return { ...base, sort: 'object', number: 'plural', heads: ['card'], verbs: ['milled'], participleOnly: true, ...(youMill ? { demonstrative: true } : {}), ...(millsOne ? { alsoSingular: true } : {}) };
  // r5-moved (CR 701.25a, 608.2c, 400.7): the ONE card a surveil 1 of yours may have put into your graveyard ("Surveil 1. If you put a creature card into your graveyard this
  // way, put that card into your hand"), bound by the step's `as` (effects/handlers/cards-library.ts#surveilHandler binds what it put there): named only by the participle
  // `surveilled` (template eff.r5moved.surveil.putThisWay.hand), so no pronoun gets a new candidate. Several cards (surveil 2) are no "that card": no mention
  if (op === 'surveil' && step['count'] === 1 && isRec(step['who']) && step['who']['ref'] === 'you') return { ...base, sort: 'object', number: 'singular', heads: ['card'], verbs: ['surveilled'], participleOnly: true };
  // Cloud r3-moved (CR 701.9a, 608.2c, 608.2h, 400.7): the ONE card one player discarded ("draw a card, then discard a card. That player loses life equal to the discarded
  // card's mana value"), bound by the step's `as` where the discard put it (effects/handlers/cards-draw.ts#discardHandler): named only by the participle "the discarded
  // card", so no pronoun gets a new candidate (Cloud C8 names a cost's discard the same way; with both, the reference is not unique and stays manual)
  if (op === 'discard' && step['count'] === 1 && isRec(step['who']) && (step['who']['ref'] === 'you' || step['who']['ref'] === 'target') && step['mode'] === undefined) {
    // edh-c-32 (Hellhole Rats): "that card" names it too (`demonstrative`, as the mill's "those cards"; only a TARGET player's discard: Party Thrasher's "you may discard a card ... choose one of them. You may play that card" keeps its two candidates): "target player discards a card. ~ deals damage to that player equal to that card's mana value"
    return { ...base, sort: 'object', number: 'singular', heads: ['card'], verbs: ['discarded'], participleOnly: true, ...(step['who']['ref'] === 'target' ? { demonstrative: true } : (path.includes('/do/') ? { demonstrative: true, soleOnly: true } : {}) /* edh-next-98 (Disciple of Deceit): your own optional discard (inside a "you may") is "that card" when nothing else fits; an unconditional one keeps only "the discarded card" (Silvan Reveler's "put it" stays as it was) */) };
  }
  // edh-c-106 (CR 701.9a, 701.9b, 608.2c; Kindle the Carnage): the ONE card you discarded at random is also "that card" ("Discard a card at random. If you do, ~ deals damage equal to that
  // card's mana value to each creature"): the card the discard put in the graveyard, bound by the step's `as` (Mention.demonstrative)
  if (op === 'discard' && step['count'] === 1 && isRec(step['who']) && step['who']['ref'] === 'you' && step['mode'] === 'random') {
    return { ...base, sort: 'object', number: 'singular', heads: ['card'], verbs: ['discarded'], participleOnly: true, demonstrative: true };
  }
  // Cloud std-woe (CR 608.2c-d): the player a choice of the resolution named, "Choose another player. That player gains control of target Treasure you control."
  // (bound by the step's `as`, effects/handlers/choose.ts); a choice made by several players names no one player
  if (op === 'chooseValue' && (step['what'] === 'player' || step['what'] === 'opponent') && isRec(step['who']) && step['who']['ref'] === 'you') {
    return { ...base, sort: 'player', number: 'singular', heads: step['what'] === 'opponent' ? ['player', 'opponent'] : ['player'], rebinds: 'chosenPlayer' };
  }
  // CLOUD std-fdn (CR 701.21a, 608.2c, 400.7): what "<player> sacrifices a <filter> of their choice" sacrificed (effects/handlers/zones-remove.ts binds it with
  // `as`): "You gain life equal to that creature's toughness" (its last known information, CR 608.2h). One object only when one player sacrifices one; "each
  // opponent sacrifices a creature" sacrificed several, so a singular reference to it stays manual. Only a TARGET player's sacrifice: "you may sacrifice a Food. If
  // you do, target creature gets +5/+5 ... Otherwise, that creature ..." names the target, and a mention of the Food would make that reference ambiguous
  if (op === 'sacrificeChoice') {
    const who = isRec(step['who']) ? step['who'] : {};
    // r5-moved (CR 701.21a, 608.2c, 400.7): what "each player sacrifices all other creatures they control" put into graveyards is "put there this way" ("Then each player returns
    // all creature cards from their graveyard that weren't put there this way to the battlefield", Bringer of the Last Gift; effects/handlers/zones-remove.ts binds the new
    // objects): a participle-only mention, as a destroy or sacrifice of a group above, so no pronoun gets a new candidate
    if (who['ref'] === 'each' && step['mode'] === 'all') {
      const f = isRec(step['filter']) ? (step['filter'] as ObjectFilter) : undefined;
      return { ...base, sort: 'object', number: 'plural', heads: headsOfFilter(f, 'battlefield'), verbs: [PUT_INTO_GRAVEYARD_THIS_WAY], participleOnly: true, leftBattlefield: true };
    }
    const one = step['count'] === 1 && (step['mode'] === undefined || step['mode'] === 'choose');
    const f = isRec(step['filter']) ? (step['filter'] as ObjectFilter) : undefined;
    // std-rx4 (CR 701.21a, 608.2c, 608.2h; The Gitrog, Ravenous Ride): what YOUR sacrifice of one permanent sacrificed, "You may sacrifice a creature that saddled it
    // this turn. If you do, draw X cards, ..., where X is the sacrificed creature's power" (its last known information): a participle-only mention, as paidSacrificed
    // gives for a cost, so only "the sacrificed <noun>" names it and no pronoun gets a new candidate (the target's reference above stays unique)
    // edh-players-4 (CR 608.2c, 608.2h): "Sacrifice another creature. You gain X life and draw X cards, where X is that creature's power" (Disciple of Bolas): the
    // demonstrative with the head noun names the one permanent THIS step sacrificed (Mention.demonstrative, as paidSacrificed for an optional payment); a bare "it" still never does
    if (who['ref'] === 'you') {
      if (!one) return null;
      // (a description by card types only: "sacrifice a Food" / "sacrifice a Forest" says no noun a later "that creature" could use, so the target there stays the only "that creature")
      const parts = Array.isArray(f?.anyOf) ? (f!.anyOf as ObjectFilter[]) : f !== undefined ? [f] : [];
      const heads = parts.length > 0 ? [...new Set(parts.flatMap((x) => headsOfFilter(x, 'battlefield')))] : headsOfFilter(f, 'battlefield');
      // edh-c-48 (CR 701.21a, 400.7, 608.2c; Heart-Shaped Herb): a creature the sacrifice put into the graveyard is also "that card" (a card there), said of a card the same ability returns
      return { ...base, sort: 'object', number: 'singular', heads: heads.includes('*') ? heads : [...new Set([...heads, 'card'])], verbs: ['sacrificed'], participleOnly: true, ...(heads.includes('*') ? {} : { demonstrative: true }) };
    }
    if (who['ref'] !== 'target') return null;
    return { ...base, sort: 'object', number: one ? 'singular' : 'plural', heads: [...new Set([...headsOfFilter(f, 'battlefield'), 'card'])], verbs: ['sacrificed'] };
  }
  // Cloud std-eoe (CR 406.1, 608.2c): the one card "exile cards from the top of your library until you exile a nonland card" stopped at ("You may cast that card this
  // turn"); the other cards it exiled are no mention (no wording names them)
  // std-rx31 (CR 202.3, 608.2c): "until you exile cards with total mana value 4 or greater" names every card it exiled ("from among them")
  // std-exile-play-2-1 (CR 608.2c, 400.7): and they are the "cards exiled this way" ("Until end of turn, you may cast cards exiled this way without paying their mana
  // costs": every card it exiled, the step's binding)
  if (op === 'exileUntil' && step['total'] !== undefined) return { ...base, sort: 'object', number: 'plural', heads: ['card'], verbs: ['exiled', EXILED_THIS_WAY] };
  // edh-d-102 (CR 406.1, 608.2c; Auspicious Starrix): "until you exile X permanent cards" names the X matching cards it exiled, "those permanent cards"
  if (op === 'exileUntil' && step['count'] !== undefined) {
    const f = step['filter'] as ObjectFilter;
    return { ...base, sort: 'object', number: 'plural', heads: [...new Set(['card', ...headsOfFilter(f, 'other'), ...(f.types !== undefined && f.types.length > 0 && f.types.every((t) => ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'].includes(t)) ? ['permanent'] : [])])], verbs: ['exiled'] };
  }
  // std-rs (CR 608.2c): "target opponent exiles cards ... until they exile a nonland card" stops at one card; "each opponent exiles ..." at one card for each of
  // them, several cards (the step binds every one)
  if (op === 'exileUntil') return { ...base, sort: 'object', number: namesOnePlayer(step['who']) ? 'singular' : 'plural', heads: [...new Set(['card', ...headsOfFilter(step['filter'] as ObjectFilter, 'other')])], verbs: ['exiled'] };
  // r3-dig (CR 701.20a, 608.2c): the card(s) "reveal cards from the top of your library until you reveal a land card" stopped at, still in the library ("Put that
  // card into your hand", "Put those land cards onto the battlefield tapped"); the other revealed cards are "the rest" (revealedRestOf)
  if (op === 'revealUntil') {
    const one = step['count'] === undefined || step['count'] === 1;
    // edh-zones-22 (CR 701.20a, 608.2c; Old Stickfingers): the X cards a counted reveal until stopped at are also "<cards> revealed this way" (parser/holes/object.ts#revealedThisWay)
    return { ...base, sort: 'object', number: one ? 'singular' : 'plural', heads: [...new Set(['card', ...headsOfFilter(step['filter'] as ObjectFilter, 'other')])], verbs: one ? ['revealed'] : ['revealed', REVEALED_THIS_WAY] };
  }
  if (op === 'chooseObjects') {
    const from = isRec(step['from']) && isRec(step['from']['filter']) ? (step['from']['filter'] as ObjectFilter) : undefined;
    // C6: one object for each player is a group ("Destroy those creatures.", "except creatures chosen this way")
    // r3-choose (CR 608.2c, 400.7): a choice among a group named before, wherever its cards are now ("Exile the top two cards of your library. Choose one of them.",
    // eff.r3choose.chooseN.ofThem: `is` that group, zone 'any'), is named by the cards' noun ("You may play that card this turn")
    const amongGroup = from !== undefined && from.zone === 'any' && isRec(from.is) && from.is.ref === 'bound' && Object.keys(from).every((k) => k === 'is' || k === 'zone');
    // std-rx30 (CR 101.4): a choice of each player of a group in turn is a group ("Exile those permanents."), named by the noun of its one description
    const inTurn = step['startingWith'] !== undefined;
    const one = inTurn && from !== undefined && Array.isArray(from.anyOf) && from.anyOf.length === 1 ? from.anyOf[0] : undefined;
    const heads = amongGroup ? ['card'] : [...new Set([...headsOfFilter(from, whereOf(from)), ...(one !== undefined ? headsOfFilter(one, whereOf(from)) : [])])];
    return { ...base, sort: 'object', number: step['max'] === 1 && step['perPlayer'] === undefined && !inTurn ? 'singular' : 'plural', heads, verbs: ['chosen'] };
  }
  // FAST5 T43 (CR 701.20e, 608.2c): the cards a player looks at, several at once ("look at the top four cards of your library"), are a group the next sentence
  // names "them" or "those cards" ("you may reveal a creature card from among them"); one card is no group
  if (op === 'look' && isRec(step['at']) && step['at']['ref'] === 'topCards' && step['at']['count'] !== 1) {
    return { ...base, sort: 'object', number: 'plural', heads: ['card'], verbs: ['seen'] };
  }
  // edh-cast-10 (CR 701.20e, 402.3, 608.2c; Silent-Blade Oni): the cards of ONE player's hand a player looked at ("Look at that player's hand. You may cast a spell from among
  // those cards"): a group only the `SeenInHand` hole names (participle "seen-in-hand"), never the library groups of "seen"
  if (op === 'look' && isRec(step['at']) && step['at']['ref'] === 'each' && isRec(step['at']['filter']) && step['at']['filter']['zone'] === 'hand'
    && Object.keys(step['at']['filter']).sort().join() === 'owner,zone') {
    return { ...base, sort: 'object', number: 'plural', heads: ['card'], verbs: ['seen-in-hand'], participleOnly: true }; // (participleOnly: only the `SeenInHand` anaphor, which has a participle, can name it)
  }
  // edh-next-41 (CR 701.20a, 402.3, 608.2c; Mindclaw Shaman): the hand a player REVEALS is the same group, "Target opponent reveals their hand. You may cast an instant or sorcery spell from among those
  // cards without paying its mana cost." (the cards of that one hand; the `SeenInHand` anaphor only)
  if (op === 'reveal' && isRec(step['what']) && step['what']['ref'] === 'each' && isRec(step['what']['filter']) && step['what']['filter']['zone'] === 'hand'
    && Object.keys(step['what']['filter']).sort().join() === 'owner,zone') {
    return { ...base, sort: 'object', number: 'plural', heads: ['card'], verbs: ['seen-in-hand'], participleOnly: true };
  }
  // LOOK1 (CR 701.20e, 608.2c): ... but the one card a player looked at on top of one library is what the next sentence's "it" or "that card" names ("Look at the top card
  // of your library. If it's a land card, you may put it onto the battlefield tapped."), a candidate beside the trigger's object, as a revealed top card is (below);
  // the focus rule (model/focus.ts#looksAtOneCard) says which of them a bare "it" right after the look means (reviewed; Cloud std-fin wrote the same
  // mention as a last resort, a candidate only when no other object fits, to keep the old wrong readings of guard G10: LOOK1 is the reviewed fix it waited for)
  if (looksAtOneCard(step)) return { ...base, sort: 'object', number: 'singular', heads: ['card'], verbs: ['seen'] };
  const what = step['what'];
  // std-lci (CR 608.2c, 400.7): what a move put into exile is also "exiled this way" ("Add {R} for each card exiled this way"; parser/holes/filter.ts#EXILED_THIS_WAY)
  const exiled = op === 'move' && isRec(step['to']) && step['to']['zone'] === 'exile' ? [EXILED_THIS_WAY] : [];
  if (isRec(what) && (what['ref'] === 'each' || what['ref'] === 'topCards')) {
    const fx = effectOn(step);
    const heads = what['ref'] === 'each' ? headsOfFilter(what['filter'] as ObjectFilter, whereOf(what['filter'] as ObjectFilter)) : isRec(what['matching']) && Array.isArray(what['matching']['types']) ? ['card', ...(what['matching']['types'] as string[]).map((t) => t.toLowerCase())] /* edhn78: "the top creature card of your graveyard" is also "that creature" */ : ['card'];
    // r5-cost (CR 608.2c): the top card of EACH player's library is several cards ("those cards", "them": Etali, Primal Storm), one for each player
    const eachPlayer = what['ref'] === 'topCards' && isRec(what['player']) && (what['player']['ref'] === 'each' || (what['player']['ref'] === 'event' && what['player']['role'] === 'recipient' && wholeBatch) /* edh-top-6: each opponent the damage of a whole batch was dealt to */);
    const single = what['ref'] === 'topCards' && what['count'] === 1 && !eachPlayer;
    // FAST5 T43: the top cards of a library revealed stay in it and are "seen" as the cards looked at are (the `Seen` hole: "put one of them into your hand")
    // std-ro (CR 701.20a, 608.2c): ... and, revealed (not only looked at), they are "<cards> revealed this way" (parser/holes/object.ts#revealedThisWay)
    // edh-players-11 (CR 406.1, 608.2c, 400.7j; Tezzeret, Master of the Bridge): and the cards "Exile the top ten cards of your library" exiled are "seen" too ("Put all artifact cards from
    // among them onto the battlefield", the `ExiledTop` hole, never `Seen`: those templates read the library): only your own library, two or more cards, into exile (one card is the impulse idiom's, lower/anaphora.ts#impulseIdiom)
    // trek-21 (CR 406.1, 608.2c; Lieutenant Nyota Uhura): or the cards a TARGET player exiled from the top of their own library, a counted quantity too ("Target opponent exiles the top X cards of their library, where X is ...")
    const topExiledByTarget = op === 'move' && what['ref'] === 'topCards' && !eachPlayer && isRec(what['player']) && what['player']['ref'] === 'target' && (isRec(what['count']) || (typeof what['count'] === 'number' && what['count'] > 1)) && isRec(step['to']) && step['to']['zone'] === 'exile';
    const topExiled = topExiledByTarget || (op === 'move' && what['ref'] === 'topCards' && !single && !eachPlayer && isRec(what['player']) && what['player']['ref'] === 'you' && (typeof what['count'] === 'number' || isRec(what['count'])) /* edh-next-82 (Neriv): a counted quantity */ && isRec(step['to']) && step['to']['zone'] === 'exile');
    const seen = op === 'reveal' && what['ref'] === 'topCards' ? ['seen', REVEALED_THIS_WAY] : topExiled ? ['exiledTop'] : [];
    const verbs = [...(fx.verb ?? verb ? [fx.verb ?? verb!] : []), ...seen, ...exiled];
    // Cloud std-eoe (CR 400.7): a group a destroy or sacrifice step put into graveyards is no group of permanents afterwards (Mention.leftBattlefield)
    // ... and it is what "a creature card put into a graveyard this way" names (parser/holes/filter.ts#PUT_INTO_GRAVEYARD_THIS_WAY)
    const left = what['ref'] === 'each' && (op === 'destroy' || op === 'sacrifice');
    const verbs2 = left ? [...verbs, PUT_INTO_GRAVEYARD_THIS_WAY] : verbs;
    return { ...base, sort: 'object', number: single ? 'singular' : 'plural', heads: [...new Set([...heads, ...fx.heads])], ...(verbs2.length > 0 ? { verbs: verbs2 } : {}), ...(left ? { leftBattlefield: true } : {}) };
  }
  return null;
}

/**
 * std-lci (CR 608.2c, 400.7): the targets (or a union of them, or std-r8 a bound group) a move exiled are mentioned already as targets (and the move marks them `movedBy`); "<noun>
 * exiled this way" names what the move exiled ("Exile any number of target cards from your graveyard. Add {R} for each card exiled this way."), a
 * participle-only mention, so no pronoun, "that card" or "those cards" gets a new candidate.
 */
function exiledTargetsOf(step: Rec, unit: Unit, path: string): StepMention | null {
  const what = step['what'];
  // (std-r8, CR 608.2c, 400.7: also what an earlier instruction bound, "you may exile one or more creature cards from your graveyard" (a choice, then the move of the
  // chosen cards): "the number of cards exiled this way" counts them in exile)
  if (step['op'] !== 'move' || !isRec(step['to']) || step['to']['zone'] !== 'exile' || !isRec(what) || (what['ref'] !== 'target' && what['ref'] !== 'union' && what['ref'] !== 'bound')) return null;
  return { origin: 'step', unit: unit.index, unitRef: unit, path, ref: typeof step['as'] === 'string' ? { ref: 'bound', name: step['as'] } : { ref: 'bound', name: '' }, sort: 'object', number: 'plural', heads: ['*'], verbs: [EXILED_THIS_WAY], participleOnly: true };
}

/**
 * edh-zones-22 (CR 608.2c, 701.8a, 400.7; Sorin, Lord of Innistrad): the targets (or a union of them, or a bound group) a destroy step destroyed are "put into a graveyard this way"
 * ("Destroy up to three target creatures and/or other planeswalkers. Return each card put into a graveyard this way to the battlefield under your control."), a participle-only
 * mention as exiledTargetsOf's is (no pronoun, "that card" or "those cards" gets a new candidate). The group is what the step destroyed (`as`): a target that regenerated or was
 * indestructible is not in it; a token ceases to exist in the graveyard, so the filter of the anaphor (`isCard`, parser/holes/filter.ts) finds only cards there.
 */
function destroyedTargetsOf(step: Rec, unit: Unit, path: string): StepMention | null {
  const what = step['what'];
  if (step['op'] !== 'destroy' || !isRec(what) || (what['ref'] !== 'target' && what['ref'] !== 'union' && what['ref'] !== 'bound')) return null;
  return { origin: 'step', unit: unit.index, unitRef: unit, path, ref: typeof step['as'] === 'string' ? { ref: 'bound', name: step['as'] } : { ref: 'bound', name: '' }, sort: 'object', number: 'plural', heads: ['*'], verbs: [PUT_INTO_GRAVEYARD_THIS_WAY], participleOnly: true, viaDestroy: true };
}

/**
 * FAST5 T77 (CR 608.2c, 115.1, 400.7): the objects several targets of ONE move stand for together, "Return up to one target artifact card, up to one target land card, and up
 * to one target non-Aura enchantment card from your graveyard to the battlefield. They are 5/5 Elemental creatures in addition to their other types." The step moves a union
 * of targets (parser/holes/object.ts#unions); "they" is the group of what it moved (a plural mention, bound by the step's `as`), never one target alone. The targets keep
 * their own singular mentions ("that card" still names the one the sentence says), so a singular pronoun stays ambiguous, as it was.
 */
function groupOf(step: Rec, unit: Unit, path: string, headsOf: (ref: unknown) => string[]): StepMention | null {
  const what = step['what'];
  if (step['op'] !== 'move' || !isRec(what) || what['ref'] !== 'union' || !Array.isArray(what['of']) || what['of'].length < 2) return null;
  const to = isRec(step['to']) ? step['to'] : {};
  // r5-dig (CR 608.2c, 400.7, 401.1): or a target and the top card of a library exiled together, "Exile target nonland permanent and the top card of your library.
  // For each of those cards, ...": "those cards" is what the one move exiled (a card in exile, whatever the target was)
  const topPart = (r: Rec): boolean => r['ref'] === 'topCards' && r['count'] === 1 && to['zone'] === 'exile';
  // std-exile-play-2-4 (CR 608.2c, 406.1, 400.7): or the choices of several earlier instructions exiled together ("For each of those colors, you may exile a card of
  // that color from among the revealed cards. ... You may cast the exiled cards this turn.", Sanar): what the one move exiled, cards in exile
  // edh-next-127 (CR 608.2c, 406.1, 401.1; Crabomination): or such choices together with the top card of a library ("target opponent exiles the top card of their library, a card at random from
  // their graveyard, and a card at random from their hand. You may cast a spell from among cards exiled this way"): what the one move exiled, cards in exile
  const boundOrTop = (r: unknown): boolean => isRec(r) && ((r['ref'] === 'bound' && typeof r['name'] === 'string') || topPart(r));
  if (to['zone'] === 'exile' && (what['of'].every((r) => isRec(r) && r['ref'] === 'bound' && typeof r['name'] === 'string') || (what['of'].every(boundOrTop) && what['of'].some((r) => isRec(r) && r['ref'] === 'bound')))) {
    return { origin: 'step', unit: unit.index, unitRef: unit, path, ref: typeof step['as'] === 'string' ? { ref: 'bound', name: step['as'] } : { ref: 'bound', name: '' }, sort: 'object', number: 'plural', heads: ['card'], verbs: ['exiled'] };
  }
  if (!what['of'].every((r) => isRec(r) && (r['ref'] === 'target' || topPart(r))) || !what['of'].some((r) => isRec(r) && r['ref'] === 'target')) return null;
  // CLOUD std-tmt (CR 406.1, 400.7, 608.2c): ... or into exile, "Exile up to one target artifact you control and up to one target creature you control. Then return them
  // to the battlefield under their owners' control.": "them" is what the move exiled (the cards in exile, bound by the step's `as`), never one target alone
  if (to['zone'] !== 'battlefield' && to['zone'] !== 'exile') return null;
  const fx = effectOn(step);
  const heads = [...new Set([...what['of'].flatMap((r) => (isRec(r) && topPart(r) ? ['card'] : headsOf(r))), ...fx.heads, ...(what['of'].some((r) => isRec(r) && topPart(r)) ? ['card'] : [])])];
  return { origin: 'step', unit: unit.index, unitRef: unit, path, ref: typeof step['as'] === 'string' ? { ref: 'bound', name: step['as'] } : { ref: 'bound', name: '' }, sort: 'object', number: 'plural', heads, ...(fx.verb ? { verbs: [fx.verb] } : {}) };
}

/**
 * FAST5 T78 (CR 608.2h, 701.21a): what an optional cost of the effect sacrificed ("You may sacrifice another creature. If you do, put a number of +1/+1 counters on ~
 * equal to the sacrificed creature's power"), as a mention only "the sacrificed <noun>" can name (Mention.participleOnly: a bare "it" never means it, so no other
 * reading changes), as lower/ability.ts#sacrificedMentions does for the cost of the ability itself. Written `{ref:'costSacrificed'}`: the `pay` handler remembers what it
 * sacrificed under that reference (effects/handlers/pay.ts). Only a payment with ONE sacrifice part of one permanent other than ~ and no other way to pay (the
 * "sacrifice a creature or discard a card" payments may not have sacrificed anything).
 */
function paidSacrificed(step: Rec, unit: number): Mention | null {
  if (step['op'] !== 'pay' || step['else'] !== undefined || !isRec(step['cost']) || !Array.isArray(step['cost']['other'])) return null;
  const parts = (step['cost']['other'] as unknown[]).filter((p): p is Rec => isRec(p) && p['kind'] === 'sacrifice');
  const p = parts[0];
  if (parts.length !== 1 || p === undefined || p['self'] === true || p['count'] !== 1 || !isRec(p['filter'])) return null;
  // std-rw8 (CR 608.2h): Oracle also calls it "that creature" ("you may sacrifice another creature. When you do, ~ deals damage equal to that creature's power"; Mention.demonstrative)
  return { sort: 'object', number: 'singular', heads: headsOfFilter(p['filter'] as ObjectFilter, 'battlefield'), verbs: ['sacrificed'], ref: { ref: 'costSacrificed' }, origin: 'event', unit, participleOnly: true, demonstrative: true };
}

/**
 * CLOUD C8 (CR 118.12, 400.7j): what an optional cost of the effect discarded ("You may discard a card. If you do, ~ deals damage equal to the discarded card's mana value
 * ..."), as a mention only "the discarded card" can name (Mention.participleOnly), as `paidSacrificed` does for a sacrifice. Written `{ref:'costDiscarded'}`: the `pay`
 * handler remembers what it discarded under that reference (effects/handlers/pay.ts). Only a payment with ONE discard part of cards other than ~ and no other way to pay.
 */
function paidDiscarded(step: Rec, unit: number): Mention | null {
  if (step['op'] !== 'pay' || step['else'] !== undefined || !isRec(step['cost']) || !Array.isArray(step['cost']['other'])) return null;
  const parts = (step['cost']['other'] as unknown[]).filter((p): p is Rec => isRec(p) && p['kind'] === 'discard');
  const p = parts[0];
  if (parts.length !== 1 || p === undefined || p['self'] === true) return null;
  const number = p['hand'] !== true && p['count'] === 1 ? 'singular' : 'plural';
  return { sort: 'object', number, heads: headsOfFilter(isRec(p['filter']) ? p['filter'] as ObjectFilter : undefined, 'other'), verbs: ['discarded'], ref: { ref: 'costDiscarded' }, origin: 'event', unit, participleOnly: true };
}

/**
 * edh-next-131 (CR 118.12, 400.7j, 608.2c; God-Pharaoh's Gift): what an optional cost of the effect exiled from a graveyard ("you may exile a creature card from your graveyard. If you do, create a
 * token that's a copy of that card, ..."), as a mention only "that card" or "the exiled card" can name (Mention.participleOnly with `demonstrative`: a bare pronoun never means it, so no other
 * reading changes). Written `{ref:'costExiled'}`: the `pay` handler remembers what it exiled under that reference (effects/handlers/pay.ts). Only a payment with ONE exile part of one card from a
 * graveyard, other than ~, and no other way to pay.
 */
function paidExiled(step: Rec, unit: number): Mention | null {
  if (step['op'] !== 'pay' || step['else'] !== undefined || !isRec(step['cost']) || !Array.isArray(step['cost']['other']) || (step['cost']['other'] as unknown[]).length !== 1) return null;
  const p = (step['cost']['other'] as unknown[])[0];
  if (!isRec(p) || p['kind'] !== 'exileFrom' || p['zone'] !== 'graveyard' || p['self'] === true || p['count'] !== 1 || p['link'] !== undefined || p['orGraveyard'] !== undefined) return null;
  // (only "card": a card in exile is "that card" or "the exiled card", never "that creature", which names a permanent the text spoke of: Heated Argument's target)
  return { sort: 'object', number: 'singular', heads: ['card'], verbs: ['exiled'], ref: { ref: 'costExiled' }, origin: 'event', unit, participleOnly: true, demonstrative: true };
}

/**
 * T46 (CR 701.20a, 701.20e, 402.3): the hand a step revealed or looked at, "Target opponent reveals their hand. You choose a nonland card from it." The pronoun
 * "it" is the hand: all of its cards as one set (the step binds them with `as`, effects/handlers/cards-reveal.ts). Only the anaphor with the head `hand` names
 * it (Mention.handOnly), so no other reference gets a candidate from it.
 */
function handOf(step: Rec, unit: Unit, path: string): StepMention | null {
  const op = step['op'];
  const shown = op === 'reveal' ? step['what'] : op === 'look' ? step['at'] : undefined;
  if (!isRec(shown) || shown['ref'] !== 'each' || !isRec(shown['filter'])) return null;
  const f = shown['filter'];
  if (f['zone'] !== 'hand' || f['owner'] === undefined || Object.keys(f).length !== 2) return null;
  const ref = typeof step['as'] === 'string' ? { ref: 'bound', name: step['as'] } : { ref: 'bound', name: '' };
  return { origin: 'step', unit: unit.index, unitRef: unit, path, ref, sort: 'object', number: 'plural', heads: ['hand'], handOnly: true };
}

/**
 * C6 (CR 101.3, 608.2c, 608.2e): the players of a group who can't do what a step tells each of them, "Each opponent sacrifices a creature of their choice. Each opponent
 * who can't discards a card." / "Each opponent discards a card. For each opponent who can't, you draw a card.": a discard or a sacrifice of ONE card or permanent by
 * each opponent or each player (the engine binds the players who fall short under the step's `cantAs`, effects/handlers/cards-draw.ts, zones-remove.ts). Only the
 * participle phrase "each <opponent | player> who can't" names it (parser/holes/player.ts), with the step's own noun: "each opponent who can't" after "each player
 * discards a card" names a part of that group, which no reference stands for, so it stays manual.
 */
function cantOf(step: Rec, unit: Unit, path: string): StepMention | null {
  const op = step['op'];
  const who = step['who'];
  if (op !== 'discard' && op !== 'sacrificeChoice') return null;
  if (!isRec(who) || who['ref'] !== 'each' || (who['who'] !== 'opponent' && who['who'] !== 'player')) return null;
  if (step['count'] !== 1 || step['guard'] !== undefined) return null;
  if (op === 'discard' && step['mode'] !== undefined && step['mode'] !== 'choose') return null;
  if (op === 'sacrificeChoice' && step['mode'] !== undefined && step['mode'] !== 'choose') return null;
  const ref = typeof step['cantAs'] === 'string' ? { ref: 'bound', name: step['cantAs'] } : { ref: 'bound', name: '' };
  return { origin: 'step', unit: unit.index, unitRef: unit, path, ref, sort: 'player', number: 'plural', heads: [String(who['who'])], verbs: ['cant'], participleOnly: true, bindKey: 'cantAs' };
}

/**
 * edh-top-15 (CR 701.3d, 608.2c; Akiri): the permanent an unattach let go of ("You may unattach an Equipment from a creature you control. If you do, tap that creature"): the step
 * binds the objects the unattached ones were attached to under its `hostAs` (effects/handlers/zones-status.ts#attach); named by the noun of the host's description.
 */
function hostOf(step: Rec, unit: Unit, path: string): StepMention | null {
  if (step['op'] !== 'attach' || step['to'] !== null || typeof step['hostAs'] !== 'string' || step['guard'] !== undefined) return null;
  return { origin: 'step', unit: unit.index, unitRef: unit, path, ref: { ref: 'bound', name: step['hostAs'] }, sort: 'object', number: 'singular', heads: ['creature', 'permanent'], verbs: ['unattachedFrom'], bindKey: 'hostAs' };
}

/**
 * edh-d-97 (CR 608.2c, 608.2d, 101.4; Sin Prodder ruling 2016-04-08: "Once a player does so, Sin Prodder deals damage ... to that player immediately"): the ONE player of "any opponent may
 * ..." who did it (effects/handlers/control.ts#anyOneMay binds that player under the step's `as`): "that player" after "If a player does, ...". Only a `may` of any opponent with one
 * instruction and no `otherwise`; the mention is singular, a player, and named by "that player" (no participle).
 */
function anyOneDidOf(step: Rec, unit: Unit, path: string): StepMention | null {
  if (step['op'] !== 'may' || step['anyOne'] !== true || step['otherwise'] !== undefined || step['guard'] !== undefined || step['villainous'] !== undefined) return null;
  const who = step['who'];
  if (!isRec(who) || who['ref'] !== 'each' || who['who'] !== 'opponent' || !Array.isArray(step['do']) || step['do'].length !== 1) return null;
  const ref = typeof step['as'] === 'string' ? { ref: 'bound', name: step['as'] } : { ref: 'bound', name: '' };
  return { origin: 'step', unit: unit.index, unitRef: unit, path, ref, sort: 'player', number: 'singular', heads: ['player', 'opponent'], verbs: [], bindKey: 'didAs' };
}

/**
 * edh-players-11 (CR 608.2c, 608.2d, 101.4): the players of a group who DID an optional action, "Each player may draw a card, then each player who drew a card this way
 * gains 1 life." / "Each player may put two +1/+1 counters on a creature they control. If a player does, ..." / "Each opponent who does can't attack you ...": a `may`
 * of each opponent or each player (no `otherwise`, not "any opponent", not villainous). The engine binds the players who did it under the step's `as`
 * (effects/handlers/control.ts#bindDoers). Only the participle phrases name it (parser/holes/player.ts: `did` = "who does", "who did", "a player who does"; `drewThisWay`
 * = "who drew a card this way", only when the option is one draw): "each opponent who does" after "each player may ..." is the players who did it other than the
 * controller (`bindKey: 'didOpp'`).
 */
function didOf(step: Rec, unit: Unit, path: string): StepMention[] {
  return didOfImpl(step, unit, path);
}

/**
 * edh-next-127 (CR 701.21a, 608.2c, 608.2h, 400.7; Danse Macabre): "Each player sacrifices a nontoken creature of their choice. Roll a d20 and add the toughness of the creature you sacrificed this way.
 * ... Return a creature card put into a graveyard this way ...": what the sacrifice of one permanent by EACH player put into graveyards is "<cards> put into a graveyard this way" (the group, bound under
 * the step's `as`, a participle-only mention as the sacrifice of all of a group is), and the same group is what "the toughness of the creature you sacrificed this way" reads, only the one whose
 * controller as it last existed is you (parser/holes/qty.ts: `{q:'stat', by: you}`, the mechanism of edh-players-21). Only one permanent each, chosen by its own controller (no other chooser).
 */
function sacrificedByEachOf(step: Rec, unit: Unit, path: string): StepMention[] {
  if (step['op'] !== 'sacrificeChoice' || step['count'] !== 1 || (step['mode'] !== undefined && step['mode'] !== 'choose') || step['chooser'] !== undefined || step['guard'] !== undefined) return [];
  const who = step['who'];
  if (!isRec(who) || who['ref'] !== 'each' || who['who'] !== 'player') return [];
  const f = isRec(step['filter']) ? (step['filter'] as ObjectFilter) : undefined;
  const heads = headsOfFilter(f, 'battlefield');
  const ref = typeof step['as'] === 'string' ? { ref: 'bound', name: step['as'] } : { ref: 'bound', name: '' };
  return [
    { origin: 'step', unit: unit.index, unitRef: unit, path, ref, sort: 'object', number: 'plural', heads, verbs: [PUT_INTO_GRAVEYARD_THIS_WAY], participleOnly: true, leftBattlefield: true } as StepMention,
    { origin: 'step', unit: unit.index, unitRef: unit, path, ref, sort: 'object', number: 'plural', heads, verbs: ['sacrificedByEach'], participleOnly: true, leftBattlefield: true } as StepMention,
  ];
}

/**
 * edh-next-127 (CR 608.2d, 608.2c; Thunderwave: "You may choose a creature. Thunderwave deals 3 damage to each creature not chosen this way."): what an optional choice of at most ONE object chose is also
 * the group "<objects> chosen this way" (none or one of them), so "each creature not chosen this way" is every creature but the chosen one (every creature when none was chosen). A participle-only
 * mention (only "chosen this way" names it; the singular mention of the choice stays as it was). Only your own choice of up to one, not at random.
 */
function chosenOneAsGroupOf(step: Rec, unit: Unit, path: string): StepMention[] {
  if (step['op'] !== 'chooseObjects' || step['min'] !== 0 || step['max'] !== 1 || step['random'] !== undefined || step['guard'] !== undefined || !isRec(step['who']) || step['who']['ref'] !== 'you') return [];
  const from = isRec(step['from']) && isRec(step['from']['filter']) ? (step['from']['filter'] as ObjectFilter) : undefined;
  if (from === undefined || (step['from'] as Rec)['ref'] !== 'each' || from.zone !== undefined) return [];
  const ref = typeof step['as'] === 'string' ? { ref: 'bound', name: step['as'] } : { ref: 'bound', name: '' };
  return [{ origin: 'step', unit: unit.index, unitRef: unit, path, ref, sort: 'object', number: 'plural', heads: headsOfFilter(from, whereOf(from)), verbs: ['chosen'], participleOnly: true } as StepMention];
}

function didOfImpl(step: Rec, unit: Unit, path: string): StepMention[] {
  const one = anyOneDidOf(step, unit, path); // edh-d-97
  if (one !== null) return [one];
  if (step['op'] !== 'may' || step['otherwise'] !== undefined || step['guard'] !== undefined || step['anyOne'] !== undefined || step['villainous'] !== undefined) return [];
  const who = step['who'];
  if (!isRec(who) || who['ref'] !== 'each' || (who['who'] !== 'opponent' && who['who'] !== 'player')) return [];
  const doList = Array.isArray(step['do']) ? step['do'] as Rec[] : [];
  const draws = doList.length === 1 && doList[0]!['op'] === 'draw' && doList[0]!['guard'] === undefined && isRec(doList[0]!['who']) && doList[0]!['who']['ref'] === 'iterating';
  // edh-players-14 (CR 701.9a, 608.2c; Snort): "who discarded their hand this way" names the doers of an option that begins with discarding the whole hand
  const first = doList[0];
  const discardsHand = first !== undefined && first['op'] === 'discard' && first['count'] === 'hand' && first['filter'] === undefined && first['guard'] === undefined && isRec(first['who']) && first['who']['ref'] === 'iterating';
  // edh-next-43 (CR 701.9a, 608.2c; Borderland Explorer): "who discarded a card this way" names the doers of an option that is discarding one card
  const discardsOne = doList.length === 1 && first !== undefined && first['op'] === 'discard' && first['count'] === 1 && first['filter'] === undefined && first['mode'] === undefined && first['guard'] === undefined && isRec(first['who']) && first['who']['ref'] === 'iterating';
  const verbs = draws ? ['did', 'drewThisWay'] : discardsHand ? ['did', 'discardedHandThisWay'] : discardsOne ? ['did', 'discardedThisWay'] : ['did'];
  const ref = typeof step['as'] === 'string' ? { ref: 'bound', name: step['as'] } : { ref: 'bound', name: '' };
  const base = { origin: 'step' as const, unit: unit.index, unitRef: unit, path, ref, sort: 'player' as const, number: 'plural' as const, verbs, participleOnly: true };
  const own: StepMention = { ...base, heads: [String(who['who'])], bindKey: 'didAs' };
  // "each opponent who does" after "each player may ...": the players who did it other than you (CR 102.3)
  return who['who'] === 'player' ? [own, { ...base, heads: ['opponent'], bindKey: 'didOpp' }] : [own];
}

/**
 * FAST5 T43 (CR 608.2c, 701.20e): "the rest" (or "the other") of a group after a choice among it: the cards of the group the choice did not pick ("Look at the
 * top four cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library"). Made
 * by a `chooseObjects` whose pool is one bound group (`from.filter.is`, written once "them" is resolved) and whose own `as` names the choice; it is named by
 * the head noun "rest" only (a bare "them" or "those cards" never means it), and is not the group's cards that went elsewhere: the filter reads whatever of
 * the group is not among the chosen ones. The group's cards are read in the library (`zone: 'library'`, where they were looked at); one that left it for a public zone follows the
 * binding (CR 400.7j) and is excluded by the choice, one that went to a hand is a new object and no longer part of the group (CR 400.7).
 */
/** edh-d-96 (CR 608.2c, 406.1, 601.2a; Epic Experiment): a step of the units casts the cards this choice picked (`cast` of `{ref:'bound', name}`), so the cards of the group left in exile are those that weren't cast. */
function castsChoice(units: readonly Unit[], name: unknown): boolean {
  const own = JSON.stringify({ ref: 'bound', name });
  const seen = (v: unknown): boolean => Array.isArray(v) ? v.some(seen) : isRec(v) ? ((v['op'] === 'cast' && JSON.stringify(v['what']) === own) || Object.values(v).some(seen)) : false;
  return typeof name === 'string' && units.some((u) => seen(u.steps));
}

function restOf(step: Rec, unit: Unit, path: string, units: readonly Unit[] = [unit]): StepMention | null {
  if (step['op'] !== 'chooseObjects' || typeof step['as'] !== 'string') return null;
  const from = step['from'];
  const f = isRec(from) && from['ref'] === 'each' && isRec(from['filter']) ? from['filter'] : null;
  // std-rx30 (CR 608.2c, 115.1): or the objects of one spec of several targets on the battlefield ("Choose two target creatures controlled by the same opponent. That
  // player chooses one of those creatures. ~ deals 5 damage to that creature, and the other can't block this turn.", Trial of Agony): the targets not chosen
  // edh-d-28 (CR 608.2c, 400.7; Sinister Waltz): or targets in the graveyard (`zone: 'graveyard'` beside `is`), "Return two of them at random to the battlefield and put the other on the bottom of your library."
  const targets = f !== null && isRec(f['is']) && f['is']['ref'] === 'target' && Object.keys(f).every((k) => k === 'is' || (k === 'zone' && f['zone'] === 'graveyard')) ? f['is'] : null;
  if (targets !== null) {
    return {
      origin: 'step', unit: unit.index, unitRef: unit, path, sort: 'object', number: 'plural', heads: ['rest'], headOnly: true, verbs: ['left'],
      ref: { ref: 'each', filter: { is: clone(targets), not: { is: { ref: 'bound', name: step['as'] } }, ...(f!['zone'] === 'graveyard' ? { zone: 'graveyard' } : {}) } },
    };
  }
  const group = f !== null && isRec(f['is']) && f['is']['ref'] === 'bound' && typeof f['is']['name'] === 'string' && f['is']['name'] !== '' ? f['is'] : null;
  if (group === null) return null;
  // edh-zones-7 (CR 608.2c, 701.20e; Planar Genesis): a choice inside a branch ("If you don't, put a card from among them into your hand.") of a group an earlier choice
  // of the unit made too is no group of its own: "the rest" is what the first choice left in the library (the cards this one put into a hand are no longer in it)
  if (/\/(then|else)\//.test(path) && units.some((v) => v.index <= unit.index && v.steps.some((x) => isRec(x) && x !== step && x['op'] === 'chooseObjects' && isRec(x['from']) && isRec(x['from']['filter'])
    && isRec(x['from']['filter']['is']) && x['from']['filter']['is']['ref'] === 'bound' && x['from']['filter']['is']['name'] === group['name']))) return null;
  // std-library-3 (CR 608.2c, 406.1): a choice among a group of cards in exile ("You may cast a spell from among the exiled cards ... Then put the rest of the exiled
  // cards into your hand", Portent of Calamity): the cards of the group the choice did not pick, still in exile; only "the rest of the exiled cards" names them
  if (f!['zone'] === 'exile') {
    return {
      origin: 'step', unit: unit.index, unitRef: unit, path, sort: 'object', number: 'plural', heads: ['rest-exiled', 'exiled-other', 'rest', ...(castsChoice(units, step['as']) ? ['rest-exiled-notcast'] : [])], headOnly: true, verbs: ['left'], // edh-d-96: "all cards exiled this way that weren't cast" only after a cast of the chosen cards (castsChoice) // trek-21: and "the rest" (Lieutenant Nyota Uhura: "Then that player puts the rest on the bottom of their library") // edh-top-9: "the other cards exiled this way" (head "exiled-other") is this choice's rest only, never exiledRestOf's
      ref: { ref: 'each', filter: { is: { ref: 'bound', name: group['name'] }, not: { is: { ref: 'bound', name: step['as'] } }, zone: 'exile' } },
    };
  }
  // std-lci: a later choice among the same group that excludes this one ("a creature card and/or a land card from among them") is the one "the rest" follows
  // std-rx30: also one that excludes it among others (`not.is` a union of earlier choices, Memories Returning's alternating picks)
  const own = JSON.stringify({ ref: 'bound', name: step['as'] });
  const excludes = `"not":{"is":${own}}`;
  if (unit.steps.some((x) => isRec(x) && x !== step && x['op'] === 'chooseObjects' && (JSON.stringify(x['from']).includes(excludes) || excludedAmong(x['from'], own)))) return null;
  // std-rx30 (CR 608.2c, 701.20e): a choice among what earlier choices left, still in the library (`not.is` a union of those choices, Memories Returning's
  // alternating picks): its rest leaves out this choice too ("Then they put one on the bottom of your library. Put the other into your hand.")
  const before = isRec(f!['not']) && Object.keys(f!['not']).length === 1 && isRec(f!['not']['is']) && f!['not']['is']['ref'] === 'union' && Array.isArray(f!['not']['is']['of'])
    && f!['zone'] === 'library' && Object.keys(f!).filter((k) => k !== 'anyOf').length === 3 ? (f!['not']['is']['of'] as Rec[]) : []; // edh-b-1: a described pick (`anyOf`) among what earlier ones left
  const not = before.length === 0 ? { ref: 'bound', name: step['as'] } : { ref: 'union', of: [...before.map((x) => clone(x)), { ref: 'bound', name: step['as'] }] };
  return {
    origin: 'step', unit: unit.index, unitRef: unit, path, sort: 'object', number: 'plural', heads: before.length === 0 && chosenAllPutOntoBattlefield(step, unit) ? ['rest', 'rest-not-put'] : ['rest'], headOnly: true, verbs: ['left'],
    ref: { ref: 'each', filter: { is: { ref: 'bound', name: group['name'] }, not: { is: not }, zone: 'library' } },
  };
}

/** std-rx30: does a choice's pool leave out the choice `own` among a union of earlier choices (`from.filter.not.is.of`)? */
function excludedAmong(from: unknown, own: string): boolean {
  const not = isRec(from) && isRec(from['filter']) && isRec(from['filter']['not']) ? from['filter']['not']['is'] : undefined;
  return isRec(not) && not['ref'] === 'union' && Array.isArray(not['of']) && not['of'].some((x) => JSON.stringify(x) === own);
}

/**
 * std-rh (CR 608.2c, 701.20e; Genesis Wave): the cards a choice picked are all put onto the battlefield, by an unconditional move of exactly that choice later in the same
 * list of steps (the choice and the put inside one option), so the cards of the group the choice did not pick are also "all cards revealed this way that weren't put onto
 * the battlefield". False for anything else, an optional put of one card included (hole Rest, head "rest-not-put").
 */
function chosenAllPutOntoBattlefield(step: Rec, unit: Unit): boolean {
  const name = step['as'];
  const inList = (list: unknown): boolean => {
    if (!Array.isArray(list)) return false;
    const at = list.indexOf(step);
    if (at >= 0) {
      return list.slice(at + 1).some((x) => isRec(x) && x['op'] === 'move' && x['guard'] === undefined && isRec(x['what']) && x['what']['ref'] === 'bound' && x['what']['name'] === name
        && isRec(x['to']) && x['to']['zone'] === 'battlefield');
    }
    return list.some((x) => isRec(x) && Object.values(x).some(inList));
  };
  return inList(unit.steps);
}

/**
 * std-rw9 (CR 608.2c, 701.20e): a later choice among the same group is the one "the rest" follows, when every earlier choice's cards left the library (where "the
 * rest" are read): "Look at that many cards from the top of your library. You may put one of them into your hand. Then put any number of land cards from among them
 * onto the battlefield tapped and the rest into your graveyard." (Choco, Seeker of Paradise): the cards put into the hand are no longer in the library, so the rest of
 * the later choice is all the group left. An earlier choice whose cards may stay in the library ("put one of them on top") keeps its own "rest" (two candidates).
 */
function supersededRests(out: Mention[], later: StepMention): void {
  const group = JSON.stringify(((later.ref as Rec)['filter'] as Rec)['is']);
  for (let k = out.length - 1; k >= 0; k--) {
    const m = out[k]!;
    if (m.origin !== 'step' || !m.heads.includes('rest') || m.headOnly !== true || !isRec(m.ref) || m.ref['ref'] !== 'each') continue;
    const f = m.ref['filter'];
    if (!isRec(f) || JSON.stringify(f['is']) !== group || !isRec(f['not']) || !isRec(f['not']['is'])) continue;
    const chosen = f['not']['is']['name'];
    if (typeof chosen === 'string' && leavesLibrary((m as StepMention).unitRef, chosen)) out.splice(k, 1);
  }
}

/** A move in the unit puts the cards bound as `name` into a zone other than the library (only such a move, nothing else done to them). */
function leavesLibrary(unit: Unit | undefined, name: string): boolean {
  if (unit === undefined) return false;
  let moved = false;
  let other = false;
  visit(unit.steps, (n) => {
    const what = n['what'];
    if (!isRec(what) || what['ref'] !== 'bound' || what['name'] !== name) return;
    const to = n['to'];
    if (n['op'] === 'move' && isRec(to) && typeof to['zone'] === 'string' && to['zone'] !== 'library' && n['until'] === undefined) moved = true;
    else other = true;
  });
  return moved && !other;
}

/**
 * r3-dig (CR 608.2c, 701.20a): "the rest" after "reveal cards from the top of your library until you reveal a land card": the cards revealed (`revealed`) that are not
 * the card(s) it stopped at (`as`), still in the library ("Put that card into your hand and the rest on the bottom of your library in a random order"). Both names
 * are written by the template, so the set is the same whichever of "that card" and "the rest" is resolved first. Named by the head noun "rest" only, as restOf's.
 */
function revealedRestOf(step: Rec, unit: Unit, path: string): StepMention | null {
  if (step['op'] !== 'revealUntil' || typeof step['as'] !== 'string' || typeof step['revealed'] !== 'string') return null;
  return {
    origin: 'step', unit: unit.index, unitRef: unit, path, sort: 'object', number: 'plural', heads: ['rest'], headOnly: true, verbs: ['left'],
    ref: { ref: 'each', filter: { is: { ref: 'bound', name: step['revealed'] }, not: { is: { ref: 'bound', name: step['as'] } }, zone: 'library' } },
  };
}

/**
 * edh-next-96 (CR 701.20a, 608.2c; Mind Funeral, Trepanation Blade): "all cards revealed this way" / "the revealed cards" after "<player> reveals cards from the top of their library until
 * ...": every card the reveal revealed (`revealed`), the cards it stopped at included, still in the library. Both names are written by the template (as revealedRestOf's). Named by the
 * head "revealed-all" (hole Rest). A step that may not run (`guard`) names no group.
 */
function revealedAllOf(step: Rec, unit: Unit, path: string): StepMention | null {
  if (step['op'] !== 'revealUntil' || typeof step['as'] !== 'string' || typeof step['revealed'] !== 'string' || step['guard'] !== undefined) return null;
  return {
    origin: 'step', unit: unit.index, unitRef: unit, path, sort: 'object', number: 'plural', heads: ['revealed-all'], headOnly: true, verbs: ['left'],
    ref: { ref: 'each', filter: { is: { ref: 'bound', name: step['revealed'] }, zone: 'library' } },
  };
}

/**
 * pc-zones-1 (CR 608.2c, 701.20a; Genesis Storm): "all cards revealed this way that weren't put onto the battlefield" after "reveal cards from the top of your library until
 * you reveal a nonland permanent card. You may put that card onto the battlefield": every card the reveal revealed that is still in the library, the card it stopped at
 * included when it was not put (hole Rest, head "rest-not-put"). Only when the card it stopped at is moved onto the battlefield and nowhere else (any move of it to
 * another place makes the set ambiguous: fail closed).
 */
function revealedNotPutOf(step: Rec, unit: Unit, path: string, units: readonly Unit[]): StepMention | null {
  if (step['op'] !== 'revealUntil' || typeof step['as'] !== 'string' || typeof step['revealed'] !== 'string' || step['count'] !== undefined) return null;
  const hit = step['as'];
  const moves: Rec[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isRec(v)) {
      if (v['op'] === 'move' && isRec(v['what']) && v['what']['ref'] === 'bound' && v['what']['name'] === hit) moves.push(v);
      Object.values(v).forEach(walk);
    }
  };
  units.forEach((x) => walk(x.steps));
  if (moves.length !== 1 || moves[0]!['guard'] !== undefined || !isRec(moves[0]!['to']) || moves[0]!['to']['zone'] !== 'battlefield') return null;
  return {
    origin: 'step', unit: unit.index, unitRef: unit, path, sort: 'object', number: 'plural', heads: ['rest-not-put'], headOnly: true, verbs: ['left'],
    ref: { ref: 'each', filter: { is: { ref: 'bound', name: step['revealed'] }, zone: 'library' } },
  };
}

/**
 * edh-d-35 (CR 701.20a, 601.2a, 608.2c; Treasure Keeper, Neera, Plargg): "Put all revealed cards not cast this way on the bottom of your library in a random order" after "reveal
 * cards from the top of your library until you reveal ... You may cast that card without paying its mana cost.": every card the reveal revealed that is still in the library (the card
 * it stopped at included when it was not cast; a card that was cast left the library for the stack). Your own reveal only (hole Rest, head "rest-notcast-revealed").
 */
function revealedNotCastOf(step: Rec, unit: Unit, path: string): StepMention | null {
  if (step['op'] !== 'revealUntil' || typeof step['as'] !== 'string' || typeof step['revealed'] !== 'string' || step['count'] !== undefined || step['guard'] !== undefined) return null;
  if (!isRec(step['who']) || step['who']['ref'] !== 'you') return null;
  return {
    origin: 'step', unit: unit.index, unitRef: unit, path, sort: 'object', number: 'plural', heads: ['rest-notcast-revealed'], headOnly: true, verbs: ['left'],
    ref: { ref: 'each', filter: { is: { ref: 'bound', name: step['revealed'] }, zone: 'library' } },
  };
}

/**
 * trek-7 (CR 406.1, 608.2c; The Borg Queen): "the rest" after "target opponent exiles cards from the top of their library until they exile a creature card": the cards that
 * step exiled other than the one it stopped at, still in exile ("Assimilate that card. They put the rest on the bottom in a random order."). One player only. The step's
 * names (`as` for the card it stopped at, `exiled` for every card) are given when a reference to this mention is bound (lower/anaphora.ts#bind: the step is not named
 * unless "the rest" is read). Named by the head noun "rest" (or "the rest of the exiled cards") only, as restOf's.
 */
function exiledRestOf(step: Rec, unit: Unit, path: string): StepMention | null {
  if (step['op'] !== 'exileUntil' || step['total'] !== undefined || !namesOnePlayer(step['who']) || step['guard'] !== undefined) return null;
  return {
    origin: 'step', unit: unit.index, unitRef: unit, path, sort: 'object', number: 'plural', heads: ['rest', 'rest-exiled'], headOnly: true, verbs: ['left'], bindKey: 'exiledRest',
    ref: { ref: 'each', filter: { is: { ref: 'bound', name: '' }, not: { is: { ref: 'bound', name: '' } }, zone: 'exile' } },
  };
}

/**
 * edh-zones-15 (CR 406.1, 608.2c, 601.2a; Chaos Wand, Gríma Saruman's Footman): "the exiled cards that weren't cast this way" after "<player> exiles cards from the top of their
 * library until they exile ... You may cast that card without paying its mana cost.": every card that exile step exiled (`exiled`) that is still in exile (a card that was cast
 * left exile for the stack, CR 601.2a). Unlike "the rest" (exiledRestOf) the card it stopped at is among them when it was not cast. One player only; the step's name `exiled` is
 * given when a reference to this mention is bound (lower/anaphora.ts#bind).
 */
function exiledNotCastOf(step: Rec, unit: Unit, path: string): StepMention | null {
  if (step['op'] !== 'exileUntil' || step['total'] !== undefined || !namesOnePlayer(step['who']) || step['guard'] !== undefined) return null;
  return {
    origin: 'step', unit: unit.index, unitRef: unit, path, sort: 'object', number: 'plural', heads: ['rest-notcast'], headOnly: true, verbs: ['left'], bindKey: 'exiledNotCast',
    ref: { ref: 'each', filter: { is: { ref: 'bound', name: '' }, zone: 'exile' } },
  };
}

/**
 * edh-top-9 (CR 406.1, 608.2c; fixes edh-top-8's finding 1, Plargg and Nassari): "a nonland card exiled this way" after "<players> exile cards from the top of their library until
 * they exile ...": every card that exile step exiled (`exiled`, whatever its filter stopped at and however many players exiled), never only the cards each player stopped at (`as`).
 * Named by the head "exiled-all" (the group of the edh-top-8 template), bound by name: the `exiled` name is given when a reference to this mention is bound
 * (lower/anaphora.ts#bind). A step that may not run (`guard`) names no group.
 */
function exiledAllOf(step: Rec, unit: Unit, path: string): StepMention | null {
  if (step['op'] !== 'exileUntil' || step['guard'] !== undefined) return null;
  return {
    origin: 'step', unit: unit.index, unitRef: unit, path, sort: 'object', number: 'plural', heads: ['exiled-all'], headOnly: true, verbs: ['left'], bindKey: 'exiledAll',
    ref: { ref: 'bound', name: '' },
  };
}

/**
 * LNK1: the player a target phrase names by "an opponent" ("destroy target creature an opponent controls. That player loses 3 life."): the controller (or
 * owner) of that one target, a candidate for "that player" (CR 608.2c; Oracle's "that player" is the opponent the phrase named). Read from the target, so
 * its last known information once it has left (CR 608.2h). Null for any other target: "you control" is "you", "you don't control" names no player.
 */
export function namedPlayerOf(t: TargetSpec, unit: number): Mention | null {
  // std-rx30 (CR 115.1, 110.2): or several targets controlled by the same opponent (`sameController`), "that player" being their one controller
  if ((t.kind !== 'object' && t.kind !== 'spell') || (t.max !== 1 && t.sameController !== true) || t.filter === undefined) return null; // trek-21: or a target spell (Brazen Bluff: "target noncreature spell an opponent controls. That player may ...")
  // edh-c-74 (Incriminate): several targets controlled by the same player, whoever it is, are as well (their one controller)
  const by = t.filter.controller === 'opponent' || (t.sameController === true && t.filter.controller === undefined && t.filter.owner === undefined) ? 'controllerOf' : t.filter.owner === 'opponent' ? 'ownerOf' : null;
  if (by === null || (t.filter.controller === 'opponent' && t.filter.owner === 'opponent')) return null;
  // r4-refs (CR 608.2c): the opponent who controls the target is also "they" ("... target permanent an opponent controls. They create a Treasure token.")
  return { sort: 'player', number: 'singular', heads: ['player', 'opponent'], ref: { ref: by, object: { ref: 'target', id: t.id } }, origin: 'target', unit, headOnly: true, ...(by === 'controllerOf' ? { alsoThey: true } : {}) };
}

/**
 * std-lci (as LNK1's ownerNamed): "The owner of target artifact or creature with mana value 1 or greater shuffles it into their library. Then that player discovers X"
 * (Zoyowa's Justice): the player the sentence names as "the owner of" (or "'s owner") one target object, the subject of its steps (`who`), is a candidate for
 * "that player" (CR 108.3, 608.2c). Only one such player, of one object; `beforeStep` as for ownerNamed.
 */
function ownerSubject(d: Draft, u: Unit, beforeStep: number): Mention | null {
  const words = u.tokens.map((t) => t.norm.toLowerCase());
  const said = words.some((w, i) => (w === 'the' && words[i + 1] === 'owner' && words[i + 2] === 'of') || (w === "'s" && words[i + 1] === 'owner'));
  if (!said) return null;
  const whos = stepsInOrder(u.steps).filter(({ step, path }) => Number(path.split('/')[1]) < beforeStep && isRec(step['who']) && step['who']['ref'] === 'ownerOf');
  if (whos.length === 0 || new Set(whos.map(({ step }) => JSON.stringify(step['who']))).size !== 1) return null;
  const who = whos[0]!.step['who'] as Rec;
  const obj = who['object'];
  // edh-next-142 (CR 108.3, 608.2c; Pendant of Prosperity): or the owner of ~ itself ("This artifact's owner draws a card, then that player may put ..."): one player, whoever controls ~
  if (!isRec(obj) || (obj['ref'] !== 'self' && (obj['ref'] !== 'target' || d.targets.find((t) => t.id === obj['id'])?.max !== 1))) return null;
  // edh-zones-1 (CR 608.2c; Chaos Warp): the owner who acts is also Oracle's singular "they" ("..., then reveals the top card of their library. If it's a permanent card, they
  // put it onto the battlefield."), as the opponent who controls a target is (namedPlayerOf, r4-refs)
  return { sort: 'player', number: 'singular', heads: ['player'], ref: who, origin: 'target', unit: u.index, headOnly: true, alsoThey: true };
}

/**
 * edh-zones-26 (CR 608.2c, 608.2d; Tibalt's Trickery): "Its controller mills that many cards, then exiles cards from the top of their library until they exile a nonland card. They may
 * cast that card ...": the one player a sentence names as "its controller" (of one target) and has mill or exile cards from their library by themselves (`who` the controller of that
 * target) is Oracle's singular "they" afterwards, as the owner who acts is (ownerSubject). `beforeStep` as for ownerNamed.
 */
function controllerSubject(d: Draft, u: Unit, beforeStep: number): Mention | null {
  const words = u.tokens.map((t) => t.norm.toLowerCase());
  if (!words.some((w, i) => w === 'its' && words[i + 1] === 'controller')) return null;
  // edh-d-35 (CR 608.2c, 608.2f, 701.20a; Divergent Transformations, Chaos Mutation): and a reveal until, whose player may be the controller of the object a `forEach` of this sentence
  // goes over ("For each creature exiled this way, its controller reveals cards from the top of their library until they reveal a creature card, puts ..."): "they"/"their" are that player
  const items = new Set(stepsInOrder(u.steps).filter(({ step }) => step['op'] === 'forEach' && typeof step['as'] === 'string').map(({ step }) => step['as'] as string));
  const whos = stepsInOrder(u.steps).filter(({ step, path }) => (Number(path.split('/')[1]) < beforeStep || (path.includes('/do/') && Number(path.split('/')[1]) <= beforeStep && step['op'] === 'revealUntil')) && (step['op'] === 'exileUntil' || step['op'] === 'mill' || step['op'] === 'revealUntil') && isRec(step['who']) && step['who']['ref'] === 'controllerOf');
  if (whos.length === 0 || new Set(whos.map(({ step }) => JSON.stringify(step['who']))).size !== 1) return null;
  const who = whos[0]!.step['who'] as Rec;
  const obj = who['object'];
  const eachItem = isRec(obj) && obj['ref'] === 'bound' && typeof obj['name'] === 'string' && items.has(obj['name']);
  if (!isRec(obj) || (!eachItem && (obj['ref'] !== 'target' || d.targets.find((t) => t.id === obj['id'])?.max !== 1))) return null;
  return { sort: 'player', number: 'singular', heads: ['player'], ref: who, origin: 'target', unit: u.index, headOnly: true, alsoThey: true };
}

/**
 * edh-zones-26: the optional repeat of "As many times as you choose, you may exile the top card of your library": a repeat the player may stop at any run (`optional`, not "this process") whose body is one exile of
 * the top card of the player's library. Its runs' cards are gathered (effects/handlers/control.ts).
 */
export function isGatheringRepeat(step: Rec): boolean {
  const body = Array.isArray(step['do']) && step['do'].length === 1 ? step['do'][0] : undefined;
  return step['op'] === 'repeat' && step['optional'] === true && step['process'] !== true && step['again'] !== true && step['until'] === undefined && isRec(body) && body['op'] === 'move'
    && isRec(body['to']) && body['to']['zone'] === 'exile' && isRec(body['what']) && body['what']['ref'] === 'topCards';
}

/** Zones a move with no owner puts an object into ITS OWNER's (CR 400.3): "to its owner's hand", "into its owner's library". */
const OWNER_ZONES: ReadonlySet<string> = new Set(['hand', 'library', 'graveyard']);

/**
 * LNK1: "its owner" named by the destination of a move in this sentence ("return target permanent to its owner's hand, then that player discards a card"):
 * the owner of that one object (CR 400.3, 608.2h), a candidate for "that player". The model writes "its owner's hand" and "your hand" alike (`{zone:'hand'}`,
 * parser/templates/effect/move.json), so the sentence's own words decide: exactly one move of one object to an owner's zone, and "its owner" in the sentence.
 * `beforeStep`: only the steps before this top-level step (the pronoun looks back, design 6.4).
 */
function ownerNamed(d: Draft, u: Unit, beforeStep: number): Mention | null {
  const words = u.tokens.map((t) => t.norm.toLowerCase());
  const said = words.some((w, i) => w === 'its' && words[i + 1] === 'owner');
  if (!said) return null;
  const moves = stepsInOrder(u.steps).filter(({ step, path }) => {
    if (Number(path.split('/')[1]) >= beforeStep || step['op'] !== 'move') return false;
    const to = step['to'];
    return isRec(to) && OWNER_ZONES.has(String(to['zone'])) && to['owner'] === undefined;
  });
  if (moves.length !== 1) return null;
  const what = moves[0]!.step['what'];
  if (!isRec(what) || (what['ref'] !== 'target' && what['ref'] !== 'self' && what['ref'] !== 'bound' && what['ref'] !== 'event')) return null;
  if (what['ref'] === 'target' && d.targets.find((t) => t.id === what['id'])?.max !== 1) return null; // "its owner": one object
  const owner = { ref: 'ownerOf', object: what };
  // std-rx30 (CR 608.2c): "Its owner may put it on top of their library. If they do, ~ deals 2 damage to them.": the owner is the subject of a `may` of this sentence that
  // moves the object, so "they" and "them" name that player as well (Mention.alsoThem)
  const acts = moves[0]!.path.split('/').length === 4 && stepsInOrder(u.steps).some(({ step, path }) => Number(path.split('/')[1]) < beforeStep && step['op'] === 'may'
    && JSON.stringify(step['who']) === JSON.stringify(owner) && moves[0]!.path.startsWith(`${path}/do/`));
  return { sort: 'player', number: 'singular', heads: ['player'], ref: owner, origin: 'target', unit: u.index, headOnly: true, ...(acts ? { alsoThey: true, alsoThem: true } : {}) };
}

/**
 * std-r9b: the player whose graveyard, hand and library a search of this sentence searches, named through one object ("Exile target creature. Search its controller's
 * graveyard, hand, and library for ... Then that player shuffles."): the controller (or owner) of that one object, a candidate for "that player" (CR 608.2c, 608.2h:
 * as the object last existed once it has left). Only one such search, of one object, and "its controller" / "its owner" in the sentence; `beforeStep` as for ownerNamed.
 */
function searchedPlayer(d: Draft, u: Unit, beforeStep: number): Mention | null {
  const words = u.tokens.map((t) => t.norm.toLowerCase());
  if (!words.some((w, i) => w === 'its' && (words[i + 1] === 'controller' || words[i + 1] === 'owner'))) return null;
  const searches = stepsInOrder(u.steps).filter(({ step, path }) => Number(path.split('/')[1]) < beforeStep && step['op'] === 'search' && isRec(step['owner']));
  if (searches.length !== 1) return null;
  const owner = searches[0]!.step['owner'] as Rec;
  const obj = owner['object'];
  if ((owner['ref'] !== 'controllerOf' && owner['ref'] !== 'ownerOf') || !isRec(obj) || (obj['ref'] !== 'target' && obj['ref'] !== 'bound')) return null;
  if (obj['ref'] === 'target' && d.targets.find((t) => t.id === obj['id'])?.max !== 1) return null; // "its controller": one object
  return { sort: 'player', number: 'singular', heads: ['player'], ref: clone(owner), origin: 'target', unit: u.index, headOnly: true };
}

/** Steps of a list in document order (nested lists included), each with its path relative to the unit's step list. */
export function stepsInOrder(list: unknown, path = ''): { step: Rec; path: string }[] {
  const out: { step: Rec; path: string }[] = [];
  if (!Array.isArray(list)) return out;
  list.forEach((s, i) => {
    if (!isRec(s)) return;
    const p = `${path}/${i}`;
    out.push({ step: s, path: p });
    for (const k of ['then', 'else', 'do', 'otherwise', 'onWin', 'onLose']) if (Array.isArray(s[k])) out.push(...stepsInOrder(s[k], `${p}/${k}`));
    // FAST5 T43: the steps of a "where X is" clause (the intermediate node of lower/quantities.ts, expanded after this pass) are steps of the sentence too: "Look at
    // the top X cards of your library, where X is the number of lands you control. Put one of them into your hand" names the cards looked at
    if (s['lower'] === 'whereX' && Array.isArray(s['steps'])) out.push(...stepsInOrder(s['steps'], `${p}/steps`));
  });
  return out;
}

/**
 * Cloud std-fin (CR 608.2c): what the EARLIER instructions of a list of instructions produced, for a pronoun inside a later instruction of the same list ("If you do, create a
 * 1/1 green Elf Warrior creature token, then attach ~ to it": the branch of the "if" creates the token its next instruction attaches to). mentionsAt stops at the top-level
 * step being resolved; this walks the pronoun's path inside that step (`relPath`, as lower/util.ts#rewrite gives it) through the lists of instructions only, and returns the
 * objects the earlier instructions of each list on the way produced (producedBy: a token, a copy, a card searched for, chosen or looked at), with the paths bind() names
 * them by. Nothing an instruction AFTER the pronoun's own produces, and nothing from a list the pronoun is not in.
 */
/**
 * std-rx14 (CR 608.2c, design 6.4; Fortune, Loyal Steed): "exile it and up to one creature that saddled it this turn": the choice is made first (chooseObjects) but the
 * text names it after the object it joins (the next instruction acts on `union` [that object, the choice]); a pronoun of that instruction precedes the choice in
 * the text, so the chosen object is not its antecedent.
 */
function joinedAfter(choice: Rec, next: unknown): boolean {
  // p2-damage-3 (CR 608.2d; eff.p2damage3.damage.toRandomObject): "it deals 7 damage to a creature an opponent controls chosen at random": the random choice is named
  // by the recipient of the damage that follows it, after the damage's own source ("it"), so the chosen object is no antecedent of that source
  if (choice['op'] === 'chooseObjects' && choice['random'] === true && typeof choice['as'] === 'string' && isRec(next) && next['op'] === 'damage' && isRec(next['to'])
    && next['to']['ref'] === 'bound' && next['to']['name'] === choice['as']) return true;
  if (choice['op'] !== 'chooseObjects' || typeof choice['as'] !== 'string' || !isRec(next) || !isRec(next['what']) || next['what']['ref'] !== 'union') return false;
  const of = next['what']['of'];
  if (!Array.isArray(of) || of.length < 2) return false;
  const last = of[of.length - 1];
  return isRec(last) && last['ref'] === 'bound' && last['name'] === choice['as'];
}

export function mentionsInside(u: Unit, top: number, relPath: string, known: readonly Mention[], d?: Draft): Mention[] {
  const out: Mention[] = [];
  const segs = relPath.split('/').slice(1);
  let cur: unknown = u.steps[top];
  let path = `/${top}`;
  // std-rx29 (CR 608.2h, 107.3; Kylox, Visionary Inventor): the value of "A, then B, where X is their total power" is read as the instruction that uses X runs, after
  // the instructions before it (lower/quantities.ts#expandWhereX): what they produced is a candidate for the value's pronouns ("sacrifice any number of other
  // creatures, then exile the top X cards ...": the sacrificed creatures), as for an instruction of the list after them
  if (isRec(cur) && cur['lower'] === 'whereX' && segs[0] === 'value' && Array.isArray(cur['steps'])) {
    const steps = cur['steps'] as unknown[];
    for (let j = 0; j + 1 < steps.length; j++) {
      const st = steps[j];
      if (!isRec(st)) continue;
      const made = producedBy(st, u, `${path}/steps/${j}`, (ref) => [...known, ...out].find((m) => m.sort !== 'number' && sameRef(m.ref as Rec, ref))?.heads ?? [], d?.trigger?.wholeBatch === true);
      if (made) out.push(made);
    }
    return out;
  }
  for (let k = 0; k + 1 < segs.length && isRec(cur); k += 2) {
    const key = segs[k]!;
    const list = cur[key];
    const idx = Number(segs[k + 1]);
    if (!STEP_LISTS.includes(key) || !Array.isArray(list) || !Number.isInteger(idx) || idx < 0 || idx >= list.length) break;
    for (let j = 0; j < idx; j++) {
      const s = list[j];
      if (!isRec(s)) continue;
      if (j === idx - 1 && joinedAfter(s, list[idx])) continue; // std-rx14
      const made = producedBy(s, u, `${path}/${key}/${j}`, (ref) => [...known, ...out].find((m) => m.sort !== 'number' && sameRef(m.ref as Rec, ref))?.heads ?? [], d?.trigger?.wholeBatch === true);
      if (made) out.push(made);
      // edh-players-4 (CR 608.2c, 107.3): the instructions of a "where X is" node of the list are earlier instructions of it too ("If they don't, you mill X cards, where X is ..., and that
      // player loses life equal to the total mana value of those cards": the milled cards), as stepsInOrder reads them across sentences
      if (isRec(s) && s['lower'] === 'whereX' && Array.isArray(s['steps'])) {
        (s['steps'] as unknown[]).forEach((inner, m) => {
          const madeInner = isRec(inner) ? producedBy(inner, u, `${path}/${key}/${j}/steps/${m}`, (ref) => [...known, ...out].find((x) => x.sort !== 'number' && sameRef(x.ref as Rec, ref))?.heads ?? []) : null;
          if (madeInner) out.push(madeInner);
        });
      }
      // std-rx4 (CR 701.20a, 402.3; Thought-Stalker Warlock): the hand an earlier instruction of the same list revealed ("If they lost life this turn, they reveal
      // their hand, you choose a nonland card from it, and they discard that card."), as handOf gives it across sentences
      const hand = handOf(s, u, `${path}/${key}/${j}`);
      if (hand) out.push(hand);
      // std-rq (CR 608.2c, design 6.4): "~" and "enchanted creature" an earlier instruction of the list names are candidates too, as mentionsAt makes them across
      // sentences ("If a player does, tap ~ and put a +1/+1 counter on it"); like namedObjects, this only adds candidates
      // (not "~" where the object itself is a candidate already, as the trigger's own object: "you may untap ~ and remove it from combat" stays as it was)
      const selfKnown = [...known, ...out].some((m) => m.selfObject === true || (isRec(m.ref) && m.ref['ref'] === 'self'));
      if (d !== undefined) for (const ref of namedObjects(s)) if (!(selfKnown && ref['ref'] === 'self') && ![...known, ...out].some((m) => m.sort !== 'number' && sameRef(m.ref as Rec, ref))) out.push(namedMention(ref, u.index, d));
    }
    cur = list[idx];
    path = `${path}/${key}/${idx}`;
  }
  return out;
}

/**
 * Standard round 3, r3-fx (CR 400.7, 608.2c): the mentions an earlier instruction of the pronoun's own list of instructions MOVED, as mentionsAt marks them across
 * sentences: "you may exile it, then return it to the battlefield transformed under its owner's control": the second "it" is the exiled card, the new object the
 * move made (bindMoved names the move), not the creature that is gone. Only an object that is not re-based (a target, ~, an event's object; a binding moved to a
 * public zone is re-based, CR 400.7j). `relPath` is the pronoun's own path (not where its words were first said: a later pronoun of the same words is another
 * pronoun), `resolvedAt` gives the reference the same rewrite already gave a pronoun of an earlier instruction (paths relative to the top-level step). The
 * anaphora pass lets each moved copy replace the mention it moves (lower/anaphora.ts#resolveIn).
 */
export function movedInside(u: Unit, top: number, relPath: string, known: readonly Mention[], resolvedAt: (path: string) => Rec | undefined): Mention[] {
  const out: Mention[] = [];
  const segs = relPath.split('/').slice(1);
  let cur: unknown = u.steps[top];
  let path = '';
  for (let k = 0; k + 1 < segs.length && isRec(cur); k += 2) {
    const key = segs[k]!;
    const list = cur[key];
    const idx = Number(segs[k + 1]);
    if (!STEP_LISTS.includes(key) || !Array.isArray(list) || !Number.isInteger(idx) || idx < 0 || idx >= list.length) break;
    // the instructions of a "you may" and of an "if" branch (wave 4: "If ~ has three or more lore counters on it, exile it, then return it to the battlefield"
    // returns the exiled card; before, the return named the object that left and did nothing, CR 400.7; a deliberate G10 change, docs/coverage/wave4-fx-g10.txt)
    const ordered = (key === 'do' && cur['op'] === 'may') || ((key === 'then' || key === 'else') && cur['op'] === 'if');
    for (let j = 0; j < idx && ordered; j++) {
      const s = list[j];
      if (!isRec(s) || !MOVING_OPS.has(String(s['op']))) continue;
      const said = s['what'];
      const what = isRec(said) && isRec(said['$anaphor']) ? resolvedAt(`${path}/${key}/${j}/what`) : said;
      if (!isRec(what)) continue;
      const to = s['to'];
      const dest = isRec(to) && typeof to['zone'] === 'string' ? to['zone'] : s['op'] === 'move' ? undefined : 'graveyard';
      if (what['ref'] === 'bound' && dest !== undefined && PUBLIC_ZONES.has(dest)) continue; // re-based: the name follows the object
      const m = [...out, ...known].find((x) => x.sort !== 'number' && sameRef(x.ref as Rec, what));
      // std-typechange-2 (CR 400.7, 608.2c): the object itself moved by an earlier instruction of the list ("If you can't, exile it, then you may cast the exiled card
      // ..."): the card it became is the moved copy, no longer "the object itself" (selfObject, CR 201.5) and with the participle and nouns of the move; when ~ is no
      // mention of the pool there (named "it" through lower/anaphora.ts#ownSourceMention), that copy is made here
      if (what['ref'] === 'self') {
        const fx = effectOn(s);
        const base: Mention = m ?? { sort: 'object', number: 'singular', heads: ['*'], ref: { ref: 'self' }, origin: 'event', unit: u.index, namedSelf: true };
        const { selfObject: _gone, notHeads: _nh, ...rest } = base as Mention & { selfObject?: boolean; notHeads?: string[] };
        out.push({ ...rest, heads: [...new Set([...base.heads, ...fx.heads])], ...(fx.verb ? { verbs: [...new Set([...(base.verbs ?? []), fx.verb])] } : {}), movedBy: { unitRef: u, path: `/${top}${path}/${key}/${j}` } } as Mention);
      } else if (m) out.push({ ...m, movedBy: { unitRef: u, path: `/${top}${path}/${key}/${j}` } });
    }
    cur = list[idx];
    path = `${path}/${key}/${idx}`;
  }
  return out;
}

/**
 * Standard round 4, r4-moved (CR 608.2c, 603.12, 701.9a, 400.7): the card a "this way" condition on a discard of ONE card names, "Draw a card, then discard a card. If you
 * discard a land card this way, put it from your graveyard onto the battlefield tapped." / "When you discard a card this way, target player mills cards equal to its mana
 * value.": the noun phrase of the condition ("a land card") is the card the instruction right before discarded, where the discard put it (bound by the step's `as`,
 * effects/handlers/cards-draw.ts#discardHandler), and only inside the branch of the condition (the `then` of the "if", the `do` of the reflexive trigger) does a
 * pronoun look back to it. The mention is the discard's own (producedBy, read by its participle "the discarded card" only) with the heads of the description, so a bare
 * pronoun names it too; lower/anaphora.ts#resolveIn makes it the focus of that branch. Only a top-level instruction right before the condition (in its own sentence or
 * the last of the sentence before), a discard of exactly one card by you or a target player: anything else (an option, a discard of several cards) gives none.
 */
export function movedCondMention(u: Unit, i: number, seq: readonly Unit[], at: number, prefix: readonly Unit[]): StepMention | null {
  const s = u.steps[i];
  if (!isRec(s)) return null;
  const cond = s['op'] === 'if' ? s['cond'] : s['op'] === 'reflexive' ? s['when'] : undefined;
  if (!isRec(cond) || cond['cond'] !== 'did' || cond['$step'] !== 'previous' || cond['not'] === true || cond['$op'] !== 'discard' || !isRec(cond['which'])) return null;
  let unitRef: Unit;
  let upTo: number; // the steps of the unit before the condition (exclusive)
  if (i > 0) {
    unitRef = u;
    upTo = i;
  } else {
    const p = seq[at - 1];
    if (p === undefined || p.manual !== undefined || p.rider !== undefined || prefix.length > 0 || p.steps.length === 0) return null;
    unitRef = p;
    upTo = p.steps.length;
  }
  // edh-next-77 (CR 608.2c, 603.12, 701.9a; Summon: Kujata, Narset of the Ancient Way): the discard is the ONE discard of the steps right before the condition, whether the instruction
  // right before it ("Draw a card, then discard a card.") or an earlier one of the same sentence ("Discard a card, then draw two cards. When you discard a card this way, ..."),
  // or wrapped in "you may" ("you may discard a card. When you discard a card this way, ..."): the card is the discard's own (bound by its `as`), not the trigger's event object
  const isDiscard = (x: unknown): x is Rec => isRec(x) && x['op'] === 'discard';
  const discardOf = (x: unknown): { step: Rec; sub: string } | null => {
    if (isDiscard(x)) return { step: x, sub: '' };
    if (isRec(x) && x['op'] === 'may' && isRec(x['who']) && x['who']['ref'] === 'you' && Array.isArray(x['do']) && x['do'].length === 1 && isDiscard(x['do'][0])) return { step: x['do'][0], sub: '/do/0' };
    return null;
  };
  const found: { k: number; step: Rec; sub: string }[] = [];
  for (let k = 0; k < upTo; k++) {
    const hit = discardOf(unitRef.steps[k]);
    if (hit !== null) found.push({ k, ...hit });
    else if (JSON.stringify(unitRef.steps[k]).includes('"op":"discard"') && k >= upTo - 1) return null; // a discard nested in the last instruction: not this reading
  }
  // (review: when the instruction right before the condition is itself a discard, it is the one, as before this round)
  const lastHit = upTo >= 1 ? found.find((f) => f.k === upTo - 1) : undefined;
  if (lastHit !== undefined && found.length > 1) found.splice(0, found.length, lastHit);
  if (found.length !== 1) {
    // the plain reading as before: the instruction right before the condition is the discard
    if (!(upTo >= 1 && found.length === 0)) return null;
  }
  const hit = found.length === 1 ? found[0]! : { k: upTo - 1, step: unitRef.steps[upTo - 1] as Rec, sub: '' };
  const step = hit.step;
  const path = `/${hit.k}${hit.sub}`;
  if (!isRec(step)) return null;
  const made = producedBy(step, unitRef, path);
  if (made === null || made.number !== 'singular' || !(made.verbs ?? []).includes('discarded')) return null;
  const { participleOnly: _p, ...rest } = made;
  return { ...rest, heads: [...new Set([...headsOfFilter(cond['which'] as ObjectFilter, 'other'), 'card'])] };
}

/** edh-next-132: the description of the objects an intervening "if" says the cast event's spell targets ("if it targets one or more other permanents you control"); else null. */
function interveningTargets(d: Draft): ObjectFilter | null {
  const c = d.condition;
  if (!isRec(c) || c['cond'] !== 'matches' || d.trigger === undefined || d.trigger.on.length !== 1 || d.trigger.on[0]!.ev !== 'cast' || d.trigger.batch === true) return null;
  if (JSON.stringify(c['object']) !== JSON.stringify({ ref: 'event', role: 'spell' }) || !isRec(c['filter']) || Object.keys(c['filter']).length !== 1) return null;
  const t = c['filter']['targets'];
  if (!isRec(t) || t['ref'] !== 'each' || !isRec(t['filter']) || Object.keys(t).length !== 2) return null;
  const f = t['filter'] as ObjectFilter;
  return f.zone !== undefined || f.self !== undefined || f.targetedBy !== undefined ? null : f;
}

/**
 * The mentions available inside `units[upTo]` before its step `beforeStep` (a top-level index; Infinity = the whole unit): event roles, targets of the
 * units up to and including this one, what the earlier steps produced, and one opaque mention per earlier sentence that is not understood (it may have
 * mentioned anything; an E1 shield creates nothing a later sentence could name). A target of the unit itself carries `pos`, the token where its phrase
 * starts, so the anaphora pass can refuse a reference to a target that comes after the pronoun. Pure: reads the draft only.
 */
export function mentionsAt(d: Draft, seq: readonly Unit[], upTo: number, beforeStep = Infinity, prefix: readonly Unit[] = []): Mention[] {
  const out: Mention[] = [...d.mentions];
  // the intervening "if" of a trigger (CR 603.4) comes before every sentence of the effect: what it names is a candidate everywhere (WP21 review)
  for (const ref of namedIn(d.condition)) if (!out.some((m) => m.sort !== 'number' && sameRef(m.ref, ref))) out.push(namedMention(ref, -1, d));
  // edh-next-132 (CR 115.9b, 603.4, 608.2c; Orvar, the All-Form): "Whenever you cast a spell, if it targets one or more other permanents you control, ... one of those permanents": the
  // objects of that description the cast spell targets, a group (`targetedBy` the event's spell), as std-rx28's "a spell that targets one or more creatures, those creatures" (scope.ts)
  const tg = interveningTargets(d);
  if (tg !== null) out.push({ sort: 'object', number: 'plural', heads: headsOfFilter(tg, 'battlefield'), ref: { ref: 'each', filter: { ...tg, targetedBy: { ref: 'event', role: 'spell' } } }, origin: 'event', unit: -1 });
  // edh-d-96 (CR 607.2a, 603.4; Colfenor's Urn): "if three or more cards have been exiled with ~, ... return those cards to the battlefield": the cards a count of the intervening "if" names are "those
  // cards" (the cards exiled with ~ that are still in exile, CR 400.7: the ones that left exile can't be returned)
  if (linkedCountIn(d.condition)) out.push({ sort: 'object', number: 'plural', heads: ['card'], ref: { ref: 'linked', link: 'exiled' }, origin: 'event', unit: -1, verbs: ['exiled'] });
  const units = [...prefix, ...seq.slice(0, upTo + 1)];
  const targetIds = new Set<string>();
  for (const u of units) {
    const own = u === seq[upTo];
    if (u.manual) {
      if (!own && shieldShape(u.text) === null) out.push(OPAQUE(u.index));
      continue;
    }
    const usedIds: string[] = [];
    const scan = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(scan); return; }
      if (!isRec(v)) return;
      if (v['ref'] === 'target' && typeof v['id'] === 'string' && !usedIds.includes(v['id'])) usedIds.push(v['id']);
      Object.values(v).forEach(scan);
    };
    scan(u.steps);
    if (u.rider) scan(u.rider.patch);
    // r3-choose (CR 115.1, 608.2c): the targets a sentence of its own announced ("Choose target artifact card in your graveyard.", Cloud std-eoe's node, lower/choose.ts) are
    // "the chosen card" from then on ("If you do, return the chosen card to the battlefield"): the participle names them, and only them
    const announced = u.steps.length === 1 && isRec(u.steps[0]) && u.steps[0]['lower'] === 'chooseTargets';
    for (const id of usedIds) {
      if (targetIds.has(id)) continue;
      const spec = d.targets.find((t) => t.id === id);
      const pos = own ? u.targetPos?.[id] : undefined;
      // edh-mana-keywords-9 (Comet Storm): the targets announced for each time the spell was kicked are named only as the group they make with the first ("each of them", announcedGroup)
      if (spec && announced && isRec(spec.min) && spec.min['q'] === 'kickCount') { targetIds.add(id); continue; }
      if (spec) {
        targetIds.add(id);
        const m = targetMention(spec, u.index);
        out.push({ ...m, ...(announced ? { verbs: [...(m.verbs ?? []), 'chosen'] } : {}), ...(pos !== undefined ? { pos, ...(u.targetLen?.[id] ? { len: u.targetLen[id] } : {}) } : {}) });
        const named = namedPlayerOf(spec, u.index);
        if (named) out.push({ ...named, ...(pos !== undefined ? { pos } : {}) });
      }
    }
    // std-rx10 (CR 115.1, 608.2c): "Choose target creature you control and target creature you don't control. ... Then those creatures fight each other.": the targets a
    // sentence of its own announced together, as one group of objects ("those creatures", "the chosen creatures"), besides each of them
    if (announced && !own) {
      const group = announcedGroup(u, d);
      if (group !== null) out.push(group);
    }
    // std-costs-2 (CR 601.2b, 601.2c, 608.2c): "Choose target creature you own. If this spell was kicked, instead choose any number of target creatures you own. Return each
    // chosen creature to your hand.": the targets of the one announcement that is made, as one group ("each chosen creature", "the chosen creatures")
    const prevUnit = units[units.indexOf(u) - 1];
    if (!own && prevUnit !== undefined) {
      const group = insteadChosenGroup(prevUnit, u, d);
      if (group !== null) out.push(group);
    }
    // LNK1: "return target permanent to its owner's hand, then that player discards a card": the owner the sentence named (CR 400.3, 608.2c)
    const owner = ownerNamed(d, u, own ? beforeStep : Infinity) ?? ownerSubject(d, u, own ? beforeStep : Infinity) ?? searchedPlayer(d, u, own ? beforeStep : Infinity) ?? controllerSubject(d, u, own ? beforeStep : Infinity);
    if (owner) out.push(owner);
    // FAST5 T50 (CR 603.7): what the instructions of an event-timed delayed trigger do happens when it triggers, in a resolution of its own: no antecedent of a later sentence
    const inDelay: string[] = [];
    for (const { step, path } of stepsInOrder(u.steps)) {
      const top = Number(path.split('/')[1]);
      if (own && top > beforeStep) break;
      if (inDelay.some((p) => path.startsWith(`${p}/`))) continue;
      if (step['op'] === 'delay' && isRec(step['when']) && step['when']['at'] === 'event') inDelay.push(`${path}/do`);
      // edh-zones-26 (CR 608.2c, 406.1; Dance with Calamity): "As many times as you choose, you may exile the top card of your library.": the cards the runs exiled are ONE group, "the cards exiled this way"
      // / "those cards" (the repeat's `gather`, anaphora.ts#bind); the exile of one run is no mention of its own (a run's card is a card of the group)
      if (isGatheringRepeat(step)) {
        inDelay.push(`${path}/do`);
        out.push({ origin: 'step', unit: u.index, unitRef: u, path, sort: 'object', number: 'plural', heads: ['card'], verbs: ['exiled', EXILED_THIS_WAY], ref: { ref: 'bound', name: '' }, bindKey: 'repeatGather' } as StepMention);
        continue;
      }
      // std-copy-1 (CR 603.12, 705.2): so do those of "When you win / lose the flip, X" (a reflexive trigger of one result of the flip, parser/lower/coin-flip.ts):
      // "that spell" after "When you win the flip, copy that spell." is still the spell the ability names, never the copy of the other result
      if (step['op'] === 'reflexive' && isRec(step['when']) && step['when']['cond'] === 'flip') inDelay.push(`${path}/do`);
      if (own && top === beforeStep) {
        // the step being resolved: what its own conditions name comes before its body ("if enchanted creature is red, tap it"); WP21 review
        // edh-d-53 (CR 608.2h; Soul Exchange): what a cost moved is named by its participle only ("the exiled creature", the cost mention is participleOnly), so "if the exiled creature was a Thrull" gives "that creature" of the sentence no second candidate
        for (const ref of conditionObjects(step)) if (!COST_PARTICIPLE_REFS.has(String(ref['ref'])) && !out.some((m) => m.sort !== 'number' && m.fallback !== true && sameRef(m.ref, ref))) out.push(namedMention(ref, u.index, d)); // edh-mana-keywords-4: beside the cost's fallback ~ ("{T}, Remove a mining counter from ~: Add ... If there are no mining counters on ~, sacrifice it."): a fallback is a candidate only when nothing else is, and withoutFallback would leave "it" none
        // Standard round 6: so does the object its actor is named through ("enchanted creature's owner shuffles it into their library")
        for (const ref of possessorObjects(step)) if (isRec(ref) && NAMED_REFS.has(ref['ref']) && !out.some((m) => m.sort !== 'number' && sameRef(m.ref, ref))) out.push(namedMention({ ref: ref['ref'] }, u.index, d));
        // edh-c-12 (CR 608.2c, 109.4; Roiling Terrain): the player a damage step names through the controller of the one target ("deals damage to that land's controller equal to the number of land
        // cards in that player's graveyard") is "that player" inside the same instruction ("that land" is read as the target while the sentence is lowered: one single-object target only)
        const hit = step['op'] === 'damage' ? step['to'] : undefined;
        const hitObj = isRec(hit) && hit['ref'] === 'controllerOf' && isRec(hit['object']) ? hit['object'] : undefined;
        const only = d.targets.length === 1 && d.targets[0]!.max === 1 && d.targets[0]!.kind === 'object' ? d.targets[0]! : undefined;
        if (hitObj !== undefined && only !== undefined && (hitObj['ref'] === 'target' ? hitObj['id'] === only.id : hitObj['ref'] === 'bound' && hitObj['$anaphor'] !== undefined)
          && u.tokens.some((t, i) => t.norm.toLowerCase() === 'controller' && u.tokens[i - 1]?.norm === "'s")) {
          out.push({ sort: 'player', number: 'singular', heads: ['player'], ref: { ref: 'controllerOf', object: { ref: 'target', id: only.id } }, origin: 'target', unit: u.index, headOnly: true });
        }
        // CR 608.2f: inside a "for each" step its own iteration variable can be named ("For each opponent, that player ..."; WP23)
        if (path === `/${top}` && step['op'] === 'forEach') {
          const it = producedBy(step, u, path);
          if (it) out.push(it);
          // edh-next-132 (CR 608.2f, 608.2c; Hunted by The Family): "Choose up to four target creatures you don't control. For each of them, that creature's controller faces a villainous
          // choice -- That creature becomes ...": inside the loop over the targets one sentence announced, the target of the current iteration is "that creature" / "it" (only a loop whose
          // body is a villainous choice: an older loop over targets keeps its readings)
          const ov = step['over'];
          // (the group may still be the pronoun "them" while the body is read: then the one group of object targets the ability announced, as anaphora.ts resolves it)
          const groups = d.targets.filter((t) => t.kind === 'object' && (typeof t.max !== 'number' || t.max > 1));
          const spec = isRec(ov) && ov['ref'] === 'target' && typeof ov['id'] === 'string' ? d.targets.find((t) => t.id === ov['id'])
            : isRec(ov) && isRec(ov['$anaphor']) && ov['$anaphor']['text'] === 'them' && groups.length === 1 ? groups[0] : undefined;
          const villain = Array.isArray(step['do']) && step['do'].length === 1 && isRec(step['do'][0]) && step['do'][0]['op'] === 'may' && step['do'][0]['villainous'] === true;
          if (!it && villain && spec?.filter !== undefined && spec.kind === 'object' && typeof step['as'] === 'string') {
            out.push({ origin: 'step', unit: u.index, unitRef: u, path, ref: { ref: 'bound', name: step['as'] }, sort: 'object', number: 'singular', heads: headsOfFilter(spec.filter, 'battlefield') } as StepMention);
          }
        }
        continue;
      }
      for (const ref of namedObjects(step)) {
        // edh-d-94 (CR 400.7j, 608.2c; Jhoira of the Ghitu): the one card a cost exiled, which an earlier instruction acted on by its participle ("Put four time counters on the exiled card."),
        // is from then on "it" too ("If it doesn't have suspend, it gains suspend."): its one singular cost mention is no longer participle-only (the cost's group mention stays as it is)
        if (ref['ref'] === 'costExiled') {
          const cost = out.filter((m) => m.sort === 'object' && m.number === 'singular' && isRec(m.ref) && m.ref['ref'] === 'costExiled' && m.ref['self'] === undefined && (m.verbs ?? []).includes('exiled'));
          if (cost.length === 1) out[out.indexOf(cost[0]!)] = { ...cost[0]!, participleOnly: false };
          continue;
        }
        if (!out.some((m) => m.sort !== 'number' && sameRef(m.ref, ref))) out.push(namedMention(ref, u.index, d));
      }
      const hand = handOf(step, u, path);
      if (hand) out.push(hand);
      const host = hostOf(step, u, path); // edh-top-15
      if (host) out.push(host);
      const cant = cantOf(step, u, path); // C6
      if (cant) out.push(cant);
      // edh-next-114 (CR 101.3, 608.2c, 102.3; Liliana, Waker of the Dead): "Each player discards a card. Each opponent who can't loses 3 life.": the opponents among the players who can't (`bindKey: 'cantOpp'`)
      if (cant && isRec(step['who']) && step['who']['who'] === 'player') out.push({ ...cant, heads: ['opponent'], bindKey: 'cantOpp' });
      out.push(...didOf(step, u, path)); // edh-players-11
      out.push(...sacrificedByEachOf(step, u, path)); // edh-next-127
      out.push(...chosenOneAsGroupOf(step, u, path)); // edh-next-127
      const grp = groupOf(step, u, path, (ref) => out.find((m) => m.sort !== 'number' && sameRef(m.ref as Rec, ref))?.heads ?? []); // FAST5 T77
      if (grp) out.push(grp);
      // edh-next-137 (CR 727.4, 608.2c; Karn Liberated): "Restart the game, leaving in exile all non-Aura permanent cards exiled with ~. Then put those cards onto the battlefield ...":
      // "those cards" are the cards the restart leaves in exile (a plural card mention of the step itself; the rider rid.edhn137.restartGame.thenThoseToBattlefield is its only reader)
      if (step['op'] === 'restartGame') out.push({ origin: 'step', unit: u.index, unitRef: u, path, ref: step['keep'] as Rec, sort: 'object', number: 'plural', heads: ['card'] } as StepMention);
      // edh-next-31 (CR 608.2c; Thundermaw Hellkite): the group a damage step dealt damage to, named by a noun again ("Tap those creatures"), the same description read again
      const hurt = damagedGroup(step);
      if (hurt !== null) out.push({ origin: 'step', unit: u.index, unitRef: u, path, ref: hurt, sort: 'object', number: 'plural', heads: headsOfFilter(hurt['filter'] as ObjectFilter, whereOf(hurt['filter'] as ObjectFilter)), headOnly: true } as StepMention);
      const paidSac = paidSacrificed(step, u.index);
      if (paidSac) out.push(paidSac);
      const exiledTargets = exiledTargetsOf(step, u, path); // std-lci
      if (exiledTargets) out.push(exiledTargets);
      const destroyedTargets = destroyedTargetsOf(step, u, path); // edh-zones-22
      if (destroyedTargets) out.push(destroyedTargets);
      const paidDis = paidDiscarded(step, u.index); // CLOUD C8
      if (paidDis) out.push(paidDis);
      const paidEx = paidExiled(step, u.index); // edh-next-131
      if (paidEx) out.push(paidEx);
      // Cloud std-eoe (CR 608.2c): an instruction on the very group a pump, grant or control change named before it ("Gain control of all creatures until end of
      // turn. Untap them. They gain haste until end of turn.": "them" was written as that group) adds no second mention of the same group
      const acts = step['what'];
      if (isRec(acts) && acts['ref'] === 'each' && out.some((m) => m.origin === 'step' && JSON.stringify(m.ref) === JSON.stringify(acts))) continue;
      // p2-damage-3 (joinedAfter): a random choice the next step's recipient names is said after that step's source: no antecedent of the step being resolved
      if (own && path === `/${top}` && top === beforeStep - 1 && joinedAfter(step, u.steps[beforeStep])) continue;
      const made = producedBy(step, u, path, (ref) => out.find((m) => m.sort !== 'number' && sameRef(m.ref as Rec, ref))?.heads ?? [], d.trigger?.wholeBatch === true);
      if (made) {
        // edh-players-13 (CR 608.2f): "that player" of a later "For each player who chose money, ... that player ..." is the player of ITS iteration, never of an earlier sentence's
        // (Master of Ceremonies has three): the iteration mention of an earlier unit's loop over the players who chose a word names no one any more
        const earlierChose = !own && step['op'] === 'forEach' && isRec(step['over']) && step['over']['ref'] === 'chose';
        out.push(earlierChose ? { ...made, iterates: undefined } : made);
        // std-rx32 (CR 608.2f): the tokens a "for each" made, one per iteration, are also "those tokens" after the loop (StepMention.gathered)
        const loop = /^(.*)\/do\/\d+$/.exec(path)?.[1];
        const parent = loop === undefined ? undefined : stepsInOrder(u.steps).find((s) => s.path === loop)?.step;
        // edh-players-13 (CR 608.2f, 608.2c; Seize the Spotlight): ... and so are the creatures a "for each player who chose ..." loop CHOSE one at a time ("gain control of a creature that player
        // controls ... Untap those creatures"): the group of what the loop's choice picked, in every run
        // edh-next-134 (CR 701.38a, 608.2f; Elrond of the White Council): ... and a "for each <word> vote, the voter chooses a creature they control" loop (over the votes cast for a word)
        const loopChoice = parent?.['op'] === 'forEach' && isRec(parent['over']) && (parent['over']['ref'] === 'chose' || parent['over']['ref'] === 'votedFor') && step['op'] === 'chooseObjects' && step['max'] === 1 && made.heads.length > 0;
        if (parent?.['op'] === 'forEach' && made.sort === 'object' && made.number === 'singular' && ((made.heads.includes('token') && (step['op'] === 'copy' || step['op'] === 'createToken')) || loopChoice)) {
          // edh-next-57 (CR 608.2c; Hate Mirage, Kindred Charge): "For each of those creatures, create a token that's a copy of it. Those tokens gain haste. Exile them at the beginning of the next end step.": the tokens are
          // the most recent group, so a bare "them" names them too (`alsoThey`/`alsoThem`)
          const all: StepMention = { ...(made as StepMention), number: 'plural', gathered: loop!, ...(loopChoice ? {} : { headOnly: true, alsoThey: true, alsoThem: true }) };
          out.push(all);
        }
        // edh-d-102 (CR 608.2f, 608.2c, 406.1; Soulfire Eruption): "For each of them, exile the top card of your library, then ... You may play the exiled cards until ...": the cards a
        // "for each" loop exiled from the top of a library, one per iteration, are "the exiled cards" after the loop (the participle only, never a bare pronoun)
        if (parent?.['op'] === 'forEach' && made.sort === 'object' && made.number === 'singular' && step['op'] === 'move' && isRec(step['to']) && step['to']['zone'] === 'exile' && isRec(step['what']) && step['what']['ref'] === 'topCards' && step['what']['count'] === 1) {
          out.push({ ...(made as StepMention), number: 'plural', gathered: loop!, heads: ['card'], verbs: ['exiled', EXILED_THIS_WAY], participleOnly: true } as StepMention);
        }
        const rest = restOf(step, u, path, units);
        if (rest) {
          supersededRests(out, rest);
          out.push(rest);
        }
        const revealedRest = revealedRestOf(step, u, path); // r3-dig
        if (revealedRest) out.push(revealedRest);
        const revealedAll = revealedAllOf(step, u, path); // edh-next-96
        if (revealedAll) out.push(revealedAll);
        // edh-zones-16 (CR 608.2c, 701.20a; Wild Magic Surge): and the one player (the controller or owner of a target) a reveal until is the instruction of, "they" afterwards:
        // "Its controller reveals cards from the top of their library until they reveal a creature card. They put that card onto the battlefield ..."
        const revealer = step['op'] === 'revealUntil' && isRec(step['who']) && (step['who']['ref'] === 'controllerOf' || step['who']['ref'] === 'ownerOf') && isRec(step['who']['object']) && step['who']['object']['ref'] === 'target' ? step['who'] : null;
        if (revealer !== null) out.push({ origin: 'step', unit: u.index, unitRef: u, path, ref: revealer, sort: 'player', number: 'singular', heads: ['player'] } as StepMention);
        const exiledRest = exiledRestOf(step, u, path); // trek-7
        if (exiledRest) out.push(exiledRest);
        const exiledNotCast = exiledNotCastOf(step, u, path); // edh-zones-15
        if (exiledNotCast) out.push(exiledNotCast);
        const exiledAll = exiledAllOf(step, u, path); // edh-top-9
        if (exiledAll) out.push(exiledAll);
        const notPut = revealedNotPutOf(step, u, path, units); // pc-zones-1
        if (notPut) out.push(notPut);
        const notCastRevealed = revealedNotCastOf(step, u, path); // edh-d-35
        if (notCastRevealed) out.push(notCastRevealed);
        continue;
      }
      const what = step['what'];
      if (!isRec(what)) continue;
      const fx = effectOn(step);
      // W3 integration (WP21 rule 4 + WP23's put-from-hand): a bound name the step moves to a public zone is re-based onto the new object (CR 400.7j, design
      // 3.1 rule 4), so a later "the creature" keeps that name; only a handle that is not re-based (a target, ~) or a move to a hidden zone needs the moving step's
      const to = step['to'];
      const dest = isRec(to) && typeof to['zone'] === 'string' ? to['zone'] : step['op'] === 'move' ? undefined : 'graveyard';
      const rebased = what['ref'] === 'bound' && dest !== undefined && PUBLIC_ZONES.has(dest);
      const moves = MOVING_OPS.has(String(step['op'])) && !rebased;
      // edh-next-76 (CR 701.20a, 701.20e, 608.2c; Delver of Secrets): "look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, ...":
      // the card THIS reveal revealed (the step binds it with `as` only when the reveal happened, so a reveal not taken revealed nothing), named only by "<noun> revealed this way"
      // (participle-only: a bare "it" or "that card" keeps the card the look saw as its one candidate); only a reveal of the one card an earlier look at one top card saw
      if (step['op'] === 'reveal' && what['ref'] === 'bound' && step['to'] === undefined && isRec(step['who']) && step['who']['ref'] === 'you'
        && out.some((m) => m.origin === 'step' && m.sort === 'object' && m.number === 'singular' && (m.verbs ?? []).includes('seen') && sameRef(m.ref, what))) {
        out.push({ origin: 'step', unit: u.index, unitRef: u, path, ref: typeof step['as'] === 'string' ? { ref: 'bound', name: step['as'] } : { ref: 'bound', name: '' }, sort: 'object', number: 'singular', heads: ['card'], verbs: ['revealed', REVEALED_THIS_WAY], participleOnly: true } as StepMention);
      }
      for (let k = 0; k < out.length; k++) {
        const m = out[k]!;
        if (m.sort === 'number' || !sameRef(m.ref, what)) continue;
        // r3-refs (CR 110.1, 400.7j): a card a step put onto the battlefield is a permanent there ("You may put an artifact or creature card from your hand onto the
        // battlefield. That permanent gains haste ..."): a card of a permanent type is also named "that permanent"
        // edh-c-98 (CR 608.2c, 110.4; Killer Instinct): "If it's a creature card, put it onto the battlefield. That creature gains haste ...": the `if` that guards the move says what
        // card it is, so the permanent it becomes is also named by that card type
        const guardTypes = dest === 'battlefield' && m.sort === 'object' ? typeGuardOf(u.steps, path, what) : [];
        const perm = dest === 'battlefield' && m.sort === 'object' && [...m.heads, ...guardTypes].some((h) => h === '*' || PERMANENT_HEADS.has(h)) ? ['permanent', ...guardTypes] : [];
        // std-rx1 (CR 701.20a, 608.2c): the cards chosen from among cards in a library and revealed there ("You may reveal up to two creature and/or land cards from among
        // them") are also "<cards> revealed this way" (parser/holes/object.ts#revealedThisWay, Zimone's Experiment), as the revealed top cards of a library are
        const shown = step['op'] === 'reveal' && what['ref'] === 'bound' && m.verbs?.includes('chosen') === true ? [REVEALED_THIS_WAY] : [];
        const verbs = [...(fx.verb ? [fx.verb] : []), ...shown];
        out[k] = { ...m, heads: [...new Set([...m.heads, ...fx.heads, ...perm])], ...(verbs.length > 0 ? { verbs: [...new Set([...(m.verbs ?? []), ...verbs])] } : {}), ...(moves ? { movedBy: { unitRef: u, path } } : {}) };
      }
    }
    // CLOUD C9 (CR 608.2c, 614.15): an "instead" sentence (a `@replace` rider, folded with the sentence before it by the riders pass) finds what a later sentence
    // names in place of what the replaced instruction finds: "Search your library for a basic land card. If ~ was kicked, instead search your library for a basic
    // land card and a Shrine card. Reveal those cards, ..." Only a result of the same name as one already produced (the two branches of one fold) is read, and
    // only its number and nouns: plural when either branch finds several, as Oracle writes it. Any other result stays unnamed (a later reference is manual).
    if (!own && u.rider && u.rider.patch['@replace'] === true && Array.isArray(u.rider.patch['then'])) {
      for (const { step, path } of stepsInOrder(u.rider.patch['then'])) {
        const made = producedBy(step, u, path);
        if (!made || made.ref['name'] === '') continue;
        const k = out.findIndex((m) => m.sort === made.sort && sameRef(m.ref, made.ref));
        if (k < 0) continue;
        const m = out[k]!;
        out[k] = { ...m, number: m.number === 'plural' || made.number === 'plural' ? 'plural' : 'singular', heads: [...new Set([...m.heads, ...made.heads])] };
      }
    }
  }
  return out;
}
