/**
 * The activation side of an activated ability (design 6.3 EBNF `Activated ::= CostList ":" Instructions [ActivationLimit]`, design 6.6). Owner: WP17.
 *
 *  - The cost (CR 602.1a, 118): the whole list through the Cost hole, otherwise part by part (comma separated, CR 602.2b). A part that does not parse is
 *    the manual cost part `{kind:'manual', text}` (the controller confirms the payment; declining cancels the activation, CR 733.1) and the parts that do
 *    parse are kept: the engine still makes players pay them.
 *  - Restrictions: every trailing "Activate ..." sentence (CR 602.5b-d). "as a sorcery" is `sorcerySpeed`, "N times each turn" is `limit`, "during your
 *    turn" and "if [Cond]" are `onlyIf`; anything else is `onlyIf: {cond:'ask', text}` (the controller attests it when activating). Such a sentence is
 *    never an effect sentence: the restriction must hold BEFORE the cost is paid, not be read at resolution.
 *  - The zone (W3b, CR 113.6j, 113.6m): where the cost or the effect needs ~ when that is not the battlefield ("Discard ~", "Exile ~ from your graveyard",
 *    "Return ~ from your graveyard"): `activationZone`.
 * The driver (lower/ability.ts) passes its ledger and its text through `DriverIO`.
 */
import type { ActivatedAbilityDef, Condition, CostDef, ObjectFilter, ZoneName } from '../../types/ability';
import type { Step } from '../../types/state';
import { announceCondForms, selfCostZones } from '../../model/forms';
import { canonicalJson, runHole } from '../holes';
import { COND_NOT_AT_ANNOUNCEMENT } from '../holes/cond';
import type { Tok } from '../holes/tok';
import type { Range } from './types';
import type { UnitEnv } from './units';
import { parseWhole } from './units';
import { selfZoneMention } from './trigger-zone';
import { leftoverMarker } from './util';

/** What the driver lends: the display text of some tokens, and a ledger claim. */
export interface DriverIO {
  text: (tokens: readonly Tok[]) => string;
  claim: (range: Range, status: 'consumed' | 'manual', by?: string, reason?: string) => void;
}

const span = (t: readonly Tok[]): Range => (t.length === 0 ? [0, 0] : [t[0]!.start, t[t.length - 1]!.end]);

export type Restrictions = Pick<ActivatedAbilityDef, 'sorcerySpeed' | 'limit' | 'onlyIf' | 'anyPlayer' | 'xMin' | 'tapForMana' | 'uncopiable'>;

export const TIMES: Readonly<Record<string, number>> = { once: 1, twice: 2, 'three times': 3, 'four times': 4 };

/** CMD4 (CR 602.5b, 508.1): "Activate only during your turn, before attackers are declared" (render/abil.ts#onlyIfWords says it back). */
export const BEFORE_ATTACKERS: Condition = {
  cond: 'all',
  of: [
    { cond: 'turnOf', whose: 'you', step: ['upkeep', 'draw', 'main1', 'beginCombat'] },
    { cond: 'not', of: { cond: 'happened', event: { ev: 'step', step: 'declareAttackers', whose: 'you' }, scope: 'turn' } },
  ],
};

/** FAST1 T4: "Activate only during your <step>" (CR 602.5b): that step of the controller's own turn. */
const DURING_YOUR_STEP: Readonly<Record<string, Step>> = { 'during your upkeep': 'upkeep', 'during your draw step': 'draw', 'during your end step': 'end' };

/**
 * std-rn (CR 602.5b, 506.1, 503.1): "Activate only during the <step of combat>", "during any upkeep step", "during an opponent's turn" and "during an opponent's
 * upkeep": that step of any player's turn (the combat steps and upkeeps of every turn), or a turn (an upkeep) of one of the controller's opponents.
 */
const DURING_ANY: Readonly<Record<string, Condition>> = {
  'during the declare attackers step': { cond: 'turnOf', whose: 'any', step: 'declareAttackers' },
  // p2-combat-flow-2 (CR 509.1, 506.1): the combat phase from the declare blockers step on (Trap Runner), or up to it
  'during combat after blockers are declared': { cond: 'turnOf', whose: 'any', step: ['declareBlockers', 'combatDamage', 'endCombat'] },
  'during combat before blockers are declared': { cond: 'turnOf', whose: 'any', step: ['beginCombat', 'declareAttackers'] },
  'during the declare blockers step': { cond: 'turnOf', whose: 'any', step: 'declareBlockers' },
  'during the combat damage step': { cond: 'turnOf', whose: 'any', step: 'combatDamage' },
  'during the end of combat step': { cond: 'turnOf', whose: 'any', step: 'endCombat' },
  'during any upkeep step': { cond: 'turnOf', whose: 'any', step: 'upkeep' },
  "during an opponent 's turn": { cond: 'turnOf', whose: 'opponent' },
  "during an opponent 's upkeep": { cond: 'turnOf', whose: 'opponent', step: 'upkeep' },
};

/** A Cond the hole grammar reads in exactly one way with no marker left, or null. */
function condOf(tokens: readonly Tok[], ue: UnitEnv): Condition | null {
  const whole = runHole('Cond', tokens, 0, ue.env).filter((a) => a.end === tokens.length);
  const vals = new Map(whole.map((a) => [canonicalJson(a.value), a.value]));
  if (vals.size !== 1) return null;
  const v = itIsSelf(JSON.parse(JSON.stringify([...vals.values()][0])));
  if (leftoverMarker(v) !== null) return null;
  // FAST4 T23: a condition the announcement code cannot read stays the controller's attestation (parser/holes/cond.ts#COND_NOT_AT_ANNOUNCEMENT, CR 602.5b);
  // std-blb: one it can read is the restriction ("Activate only if an opponent lost life this turn": every announcement form of it is a capability of the
  // running engine, model/forms.ts#turnHistoryAtAnnouncement, actions/announce-cond.ts)
  if (whole.some((a) => a.flags?.includes(COND_NOT_AT_ANNOUNCEMENT)) && !announceCondForms(v as Condition, 'activate').every((f) => ue.opts.capabilities.has(f))) return null;
  return v as Condition;
}

/**
 * std-lci (CR 602.5b, 201.5): in "Activate only if it has no time counters on it" (Temple of Cyclical Time) "it" is the object whose ability this is: the
 * restriction names nothing else, and it is read as the ability is announced. Only the object pronoun "it" (a marker of the Cond hole) is rewritten.
 */
function itIsSelf(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(itIsSelf);
  if (v === null || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  const a = o['$anaphor'] as { sort?: string; number?: string; text?: string } | undefined;
  if (a !== undefined && a.sort === 'object' && a.number === 'singular' && a.text === 'it' && o['ref'] === 'bound') return { ref: 'self' };
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, itIsSelf(x)]));
}

/**
 * FAST5X E5 (CR 602.5b): "Activate only if <A> or if <B>" (the Gathering Place family: "if this land entered this turn or if you control a basic land"): the
 * ability may be activated when either condition holds, `{cond:'any', of:[A, B]}`. Each side must be a whole condition with one reading (`condOf`); the split
 * is at the first "or if" that gives two such sides. Null otherwise.
 */
function eitherIf(tokens: readonly Tok[], ue: UnitEnv): Condition | null {
  for (let i = 1; i + 2 < tokens.length; i++) {
    if (tokens[i]!.norm !== 'or' || tokens[i + 1]!.norm !== 'if') continue;
    const a = condOf(tokens.slice(0, i), ue);
    const b = a === null ? null : condOf(tokens.slice(i + 2), ue);
    if (a !== null && b !== null) return { cond: 'any', of: [a, b] };
  }
  return null;
}

/** The filter of an existence condition "<player> control(s) a <description>" (no count), or null. */
function existsFilter(c: Condition | null): ObjectFilter | null {
  if (c === null || c.cond !== 'exists' || c.atLeast !== undefined || c.of.ref !== 'each') return null;
  return c.of.filter;
}

/**
 * FAST5X E5 (CR 602.5b): "Activate only if you control a Plains or a Swamp" (the Verges): one permanent of either description, each with its own article. Read
 * here, for an activation restriction only, as two existence conditions with the same subject ("you control a Plains", "you control a Swamp") merged into
 * one: two single subtypes are one list of subtypes (`subtypes: [Plains, Swamp]`, as the "enters tapped unless you control a Desert or a Cave" template
 * builds it), other descriptions are the filter's `anyOf` (render/cond.ts family either-exists). Not in the Cond hole, where the templates that already read
 * "a <x> or a <y>" (rep.enters.tappedunless.either, sta.t29.aslong.control.either.grant) would get a second reading. Null when it is not that shape.
 */
function eitherControl(tokens: readonly Tok[], ue: UnitEnv): Condition | null {
  const art = tokens.findIndex((t) => t.norm === 'a' || t.norm === 'an');
  if (art < 1) return null;
  for (let i = art + 2; i + 2 < tokens.length; i++) {
    if (tokens[i]!.norm !== 'or' || (tokens[i + 1]!.norm !== 'a' && tokens[i + 1]!.norm !== 'an')) continue;
    const f = existsFilter(condOf(tokens.slice(0, i), ue));
    const g = existsFilter(condOf([...tokens.slice(0, art), ...tokens.slice(i + 1)], ue));
    if (f === null || g === null || f.controller === undefined || canonicalJson(f.controller) !== canonicalJson(g.controller)) continue;
    const { controller, ...a } = f;
    const { controller: _same, ...b } = g;
    const plain = (x: ObjectFilter): boolean => x.owner === undefined && x.zone === undefined && x.anyOf === undefined && x.isCard === undefined && x.stackKind === undefined;
    if (!plain(a) || !plain(b)) continue;
    const oneSubtype = (x: ObjectFilter): boolean => Object.keys(x).length === 1 && x.subtypes?.length === 1;
    const filter: ObjectFilter = oneSubtype(a) && oneSubtype(b) ? { subtypes: [a.subtypes![0]!, b.subtypes![0]!], controller } : { controller, anyOf: [a, b] };
    return { cond: 'exists', of: { ref: 'each', filter } };
  }
  return null;
}

/**
 * One "Activate only ..." / "Activate this ability only ..." / "Activate no more than ..." sentence (EBNF ActivationLimit, design 6.3; CR 602.5b-d), or null
 * when the piece is not one. Each "and only" clause is a restriction: "as a sorcery", "N times each turn", "during your turn", "if [Cond]"; any other
 * clause (or a condition the hole grammar cannot state) is `onlyIf: {cond:'ask'}`, attested by the controller when activating (design 6.6).
 */
function restrictionOf(p: Tok[], io: DriverIO, ue: UnitEnv): { fields: Restrictions; asked: boolean } | null {
  const w = p.map((t) => t.norm);
  const any = anyPlayerOf(w);
  if (any !== undefined) return any === null ? null : { fields: any, asked: false };
  // std-rx12 (CR 107.3a, 602.2b): "X can't be 0." after the effect of an ability with X in its cost: the least X that may be announced (ActivatedAbilityDef.xMin)
  if (w.join(' ') === "x can't be 0 ." || w.join(' ') === "x can't be 0") return { fields: { xMin: 1 }, asked: false };
  // std-copy-1 (CR 707.10, 101.2): "This ability can't be copied." (ActivatedAbilityDef.uncopiable), alone or joined with "and X can't be 0" (Gogo, Master of Mimicry)
  const ownWords = w[w.length - 1] === '.' ? w.slice(0, -1).join(' ') : w.join(' ');
  if (ownWords === "this ability can't be copied") return { fields: { uncopiable: true }, asked: false };
  if (ownWords === "this ability can't be copied and x can't be 0") return { fields: { uncopiable: true, xMin: 1 }, asked: false };
  const tapFor = tapForManaOf(p, ue);
  if (tapFor !== null) return { fields: { tapForMana: tapFor }, asked: false };
  if (w[0] !== 'activate') return null;
  // any other "Activate ..." sentence ("Activate no more times each turn than ...") is a restriction too, attested as a whole
  const lead = w[1] === 'only' ? 2 : w[1] === 'this' && w[2] === 'ability' && w[3] === 'only' ? 4 : w[1] === 'no' && w[2] === 'more' && w[3] === 'than' ? 4 : 0;
  const end = p[p.length - 1]?.kind === 'PUNCT' && p[p.length - 1]!.norm === '.' ? p.length - 1 : p.length;
  const clauses: Tok[][] = [];
  let cur: Tok[] = [];
  for (let i = lead; i < end; i++) {
    if (p[i]!.norm === 'and' && p[i + 1]?.norm === 'only') { clauses.push(cur); cur = []; i++; continue; }
    cur.push(p[i]!);
  }
  clauses.push(cur);
  const fields: Restrictions = {};
  const conds: Condition[] = [];
  const asks: string[] = [];
  if (lead === 0) return { fields: { onlyIf: { cond: 'ask', text: io.text(p.slice(0, end)) } }, asked: true };
  for (const c of clauses) {
    const t = c.map((x) => x.norm).join(' ');
    const times = /^(once|twice|three times|four times) each (turn|combat)$/.exec(t);
    if (t === 'as a sorcery' && fields.sorcerySpeed === undefined) fields.sorcerySpeed = true; // CR 602.5d
    else if (times && fields.limit === undefined) fields.limit = { per: times[2] as 'turn' | 'combat', max: TIMES[times[1]!]! }; // CR 602.5b
    else if (t === 'during your turn') conds.push({ cond: 'turnOf', whose: 'you' });
    // CMD4 (CR 602.5b, 508.1, 506.1): "during your turn, before attackers are declared": your turn, up to the beginning of combat step, and not after your
    // declare attackers step began (an additional combat phase's beginning of combat comes after it)
    else if (t === 'during your turn , before attackers are declared') conds.push(BEFORE_ATTACKERS);
    // FAST1 T4, CR 602.5b: "Activate only once." is once for this object (rules/timing.ts counts it on the object; a new object has its use back, CR 400.7)
    else if (t === 'once' && fields.limit === undefined) fields.limit = { per: 'game', max: 1 };
    // FAST1 T4, CR 602.5b: "during your upkeep" (draw step, end step); "during combat" is the combat phase of any turn (CR 506.1)
    else if (DURING_YOUR_STEP[t] !== undefined) conds.push({ cond: 'turnOf', whose: 'you', step: DURING_YOUR_STEP[t]! });
    else if (t === 'during combat') conds.push({ cond: 'turnOf', whose: 'any', step: ['beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat'] });
    else if (DURING_ANY[t] !== undefined) conds.push(JSON.parse(JSON.stringify(DURING_ANY[t])) as Condition);
    else {
      const cond = c[0]?.norm === 'if' ? condOf(c.slice(1), ue) ?? eitherIf(c.slice(1), ue) ?? eitherControl(c.slice(1), ue) : null;
      if (cond !== null) conds.push(cond);
      else asks.push(io.text(c[0]?.norm === 'if' ? c.slice(1) : c));
    }
  }
  if (asks.length > 0) fields.onlyIf = { cond: 'ask', text: conds.length === 0 && asks.length === 1 ? asks[0]! : io.text(p.slice(lead, end)) };
  // std-tdm (CR 602.5b): "Activate only during your turn and only if a card left your graveyard this turn": every restriction must be met, so two conditions the
  // grammar reads are both required (render/abil.ts says them as two restrictions again)
  else if (conds.length > 1) fields.onlyIf = { cond: 'all', of: conds };
  else if (conds.length === 1) fields.onlyIf = conds[0]!;
  return { fields, asked: fields.onlyIf?.cond === 'ask' };
}

/**
 * std-rx27 (CR 601.2f-h, 602.2b): "For each mana in this ability's activation cost, you may tap an untapped creature you control rather than pay that mana."
 * (ActivatedAbilityDef.tapForMana): the Filter hole reads the permanents (one reading, no marker, and a controller), or null when the piece is not that sentence.
 */
function tapForManaOf(p: readonly Tok[], ue: UnitEnv): ObjectFilter | null {
  const lead = "for each mana in this ability 's activation cost , you may tap an untapped".split(' ');
  const tail = ['rather', 'than', 'pay', 'that', 'mana'];
  const end = p[p.length - 1]?.norm === '.' ? p.length - 1 : p.length;
  if (end <= lead.length + tail.length || !lead.every((x, i) => p[i]?.norm === x) || !tail.every((x, i) => p[end - tail.length + i]?.norm === x)) return null;
  const mid = p.slice(lead.length, end - tail.length);
  const vals = new Map(runHole('Filter', mid, 0, ue.env).filter((a) => a.end === mid.length).map((a) => [canonicalJson(a.value), a.value as ObjectFilter]));
  if (vals.size !== 1) return null;
  const f = [...vals.values()][0]!;
  return leftoverMarker(f) === null && f.controller !== undefined ? JSON.parse(JSON.stringify(f)) as ObjectFilter : null;
}

/** MX5: the restriction words after "Any player may activate this ability but only" (CR 602.5b, 602.5d): the activating player is "their" (CR 602.2a). */
const ANY_PLAYER_ONLY: Readonly<Record<string, Restrictions>> = {
  'as a sorcery': { sorcerySpeed: true },
  'during their turn': { onlyIf: { cond: 'turnOf', whose: 'you' } },
  'during their upkeep': { onlyIf: { cond: 'turnOf', whose: 'you', step: 'upkeep' } },
  'during their draw step': { onlyIf: { cond: 'turnOf', whose: 'you', step: 'draw' } },
};

/**
 * MX5, CR 602.2: "Any player may activate this ability." (`anyPlayer`: the player who activates it controls it, CR 602.2a, and pays its costs), alone or with
 * "but only <restriction>" (ANY_PLAYER_ONLY). Undefined when the sentence is not one; null when it is one with a restriction this code does not read (the
 * sentence then stays an instruction no template reads: manual, never activated with the restriction dropped).
 */
function anyPlayerOf(w: readonly string[]): Restrictions | null | undefined {
  const lead = ['any', 'player', 'may', 'activate', 'this', 'ability'];
  if (!lead.every((x, i) => w[i] === x)) return undefined;
  const end = w[w.length - 1] === '.' ? w.length - 1 : w.length;
  if (end === lead.length) return { anyPlayer: true };
  if (w[lead.length] !== 'but' || w[lead.length + 1] !== 'only') return null;
  const only = ANY_PLAYER_ONLY[w.slice(lead.length + 2, end).join(' ')];
  return only === undefined ? null : { anyPlayer: true, ...JSON.parse(JSON.stringify(only)) as Restrictions };
}


/** What `activationLimits` found beyond the restrictions: the ability's own cost change and the templates that read it (T38). */
export interface ActivationExtras { costChange?: NonNullable<ActivatedAbilityDef['costChange']>; costChangeIf?: Condition; templates: string[]; experimental: string[] }

/**
 * T38 (CR 601.2f, 602.2b, 118.7): "This ability costs {1} less to activate for each Equipment you control." (`ActivatedAbilityDef.costChange`). The sentence is read
 * by a `static` template whose build is a `costMod` that applies to the ability itself (`applies.self` with `applies.abilities`); the lowering lifts its
 * `change` into the ability, exactly one such change per ability. null for any other piece, or a template result of another shape.
 */
function costChangeOf(p: Tok[], ue: UnitEnv): { change: NonNullable<ActivatedAbilityDef['costChange']>; when?: Condition; d: { templatesUsed: string[]; experimental: string[] } } | null {
  if (p.map((t) => t.norm).slice(0, 3).join(' ') !== 'this ability costs') return null;
  const r = parseWhole(p, 'static', ue);
  if (!r.ok || leftoverMarker(r.value) !== null) return null;
  const v = r.value as { effects?: unknown[]; condition?: Condition };
  if (!Array.isArray(v.effects) || v.effects.length !== 1) return null;
  const e = v.effects[0] as { s?: string; applies?: { self?: boolean; abilities?: unknown }; change?: ActivatedAbilityDef['costChange'] };
  if (e.s !== 'costMod' || e.applies?.self !== true || e.applies.abilities === undefined || e.change === undefined) return null;
  // r4-cost (CR 601.2f): "This ability costs {1} less to activate during your turn": the static's condition is the cost change's (`costChangeIf`)
  return { change: e.change, ...(v.condition !== undefined ? { when: v.condition } : {}), d: r.d };
}

/**
 * "Activate only ..." sentences (CR 602.5b-d), removed from the effect and returned as fields; never passed to the effect program. With `opts.costChange`
 * (an ordinary activated ability, not a loyalty ability) also "This ability costs {1} less to activate ..." (T38), returned in `extras`.
 */
export function activationLimits(pieces: Tok[][], io: DriverIO, ue: UnitEnv, opts: { costChange?: boolean } = {}): { pieces: Tok[][]; fields: Restrictions; text: string; extras: ActivationExtras } {
  const fields: Restrictions = {};
  const extras: ActivationExtras = { templates: [], experimental: [] };
  const rest: Tok[][] = [];
  const texts: string[] = [];
  for (const p of pieces) {
    const cc = opts.costChange === true && rest.length > 0 && extras.costChange === undefined ? costChangeOf(p, ue) : null;
    if (cc !== null) {
      extras.costChange = cc.change;
      if (cc.when !== undefined) extras.costChangeIf = cc.when;
      extras.templates.push(...cc.d.templatesUsed);
      extras.experimental.push(...cc.d.experimental);
      io.claim(span(p), 'consumed', cc.d.templatesUsed.join(','));
      continue;
    }
    const r = rest.length > 0 ? restrictionOf(p, io, ue) : null;
    if (r !== null) texts.push(io.text(p));
    const clash = r !== null && Object.keys(r.fields).some((k) => (fields as Record<string, unknown>)[k] !== undefined);
    if (r === null) { rest.push(p); continue; }
    if (clash) {
      // two restrictions of one kind: the controller attests the whole text
      fields.onlyIf = { cond: 'ask', text: io.text(p) };
      io.claim(span(p), 'manual', undefined, 'an activation restriction attested by the controller (onlyIf ask, CR 602.5b)');
      continue;
    }
    Object.assign(fields, r.fields);
    if (r.asked) io.claim(span(p), 'manual', undefined, 'an activation restriction attested by the controller (onlyIf ask, CR 602.5b)');
    else io.claim(span(p), 'consumed', 'activation-limit');
  }
  return { pieces: rest, fields, text: texts.join(' '), extras };
}

/** Templates a cost used (WP19 review: recorded like effect templates, so an `experimental` cost template caps its card at partial, design 6.9 G9). */
interface Used { templates: string[]; experimental: string[] }

/** One cost part: the Cost hole (one reading, no marker), else a `cost` template (recorded in `used`), else null. */
function costPartOf(tokens: Tok[], ue: UnitEnv, used: Used): CostDef | null {
  const vals = new Map(runHole('Cost', tokens, 0, ue.env).filter((a) => a.end === tokens.length).map((a) => [canonicalJson(a.value), a.value]));
  if (vals.size === 1) {
    const cost = [...vals.values()][0] as CostDef;
    if (leftoverMarker(cost) === null) return JSON.parse(JSON.stringify(cost)) as CostDef;
  }
  if (vals.size > 1) return null; // ambiguous (guard G5)
  const r = parseWhole(tokens, 'cost', ue);
  if (r.ok && leftoverMarker(r.value) === null && !wideChoice(r.value)) {
    used.templates.push(...r.d.templatesUsed);
    used.experimental.push(...r.d.experimental);
    return { other: [r.value as NonNullable<CostDef['other']>[number]] };
  }
  return null;
}

/**
 * std-rw8 (CR 602.2b, 601.2b): a choice between costs of an activation cost ("Sacrifice an artifact or discard a nonland card", template cost.stdrw8.oneOf) is one
 * cost part, each option one part other than mana, {T}, {Q} or loyalty: an option that is several parts would have swallowed the comma-separated parts before
 * it ("{3}, {T}, Sacrifice an artifact or ..."), and a mana option is reduced or increased with the rest of the total cost before any choice could be made.
 */
function wideChoice(v: unknown): boolean {
  const o = v as { kind?: unknown; options?: unknown };
  if (o.kind !== 'oneOf') return false;
  return !Array.isArray(o.options) || o.options.some((c) => {
    const def = c as CostDef;
    return Object.keys(def).some((k) => k !== 'other') || def.other?.length !== 1 || def.other[0]!.kind === 'oneOf' || def.other[0]!.kind === 'manual';
  });
}

/** Merge cost parts; null when two parts both set the same single-valued field ({T} twice, two loyalty costs). */
function mergeCost(a: CostDef, b: CostDef): CostDef | null {
  if ((a.tap && b.tap) || (a.untap && b.untap) || (a.loyalty !== undefined && b.loyalty !== undefined)) return null;
  const out: CostDef = { ...a };
  if (b.mana) out.mana = [...(a.mana ?? []), ...b.mana];
  if (b.tap) out.tap = true;
  if (b.untap) out.untap = true;
  if (b.loyalty !== undefined) out.loyalty = b.loyalty;
  if (b.other) out.other = [...(a.other ?? []), ...b.other];
  return out;
}

export interface CostResult { cost: CostDef; understood: number; manual: { range: Range; reason: string }[]; templates: string[]; experimental: string[] }

/**
 * The cost of an activated ability (CR 602.1a, 118). The whole list through the Cost hole first; otherwise part by part (comma separated, CR 602.2b): a
 * part that does not parse is the manual cost part `{kind:'manual', text}` of design 6.6, and the parts understood are kept.
 */
export function costOf(tokens: Tok[], io: DriverIO, ue: UnitEnv): CostResult {
  const used: Used = { templates: [], experimental: [] };
  const whole = costPartOf(tokens, ue, used);
  if (whole !== null) { io.claim(span(tokens), 'consumed', 'cost'); return { cost: whole, understood: 1, manual: [], ...used }; }
  const parts: Tok[][] = [[]];
  for (const t of tokens) { if (t.kind === 'PUNCT' && t.norm === ',') { parts[parts.length - 1]!.push(t); parts.push([]); } else parts[parts.length - 1]!.push(t); }
  let cost: CostDef = {};
  let understood = 0;
  const manual: CostResult['manual'] = [];
  for (const withComma of parts) {
    const part = withComma[withComma.length - 1]?.norm === ',' ? withComma.slice(0, -1) : withComma;
    if (part.length === 0) continue;
    const parsed = costPartOf(part, ue, used);
    const merged = parsed !== null ? mergeCost(cost, parsed) : null;
    if (merged !== null) { cost = merged; understood++; io.claim(span(withComma), 'consumed', 'cost'); continue; }
    const text = io.text(part);
    cost = { ...cost, other: [...(cost.other ?? []), { kind: 'manual', text }] };
    const reason = 'a cost part the model cannot state: the controller confirms the payment (design 6.6, CR 602.2b)';
    manual.push({ range: span(part), reason });
    io.claim(span(withComma), 'manual', undefined, reason);
  }
  return { cost, understood, manual, ...used };
}

/** Where a cost part puts the source itself (CR 113.6m exception: "Sacrifice ~: Return ~ from your graveyard ..." functions on the battlefield). */
const COST_PUTS_SELF: Readonly<Partial<Record<string, ZoneName>>> = { sacrifice: 'graveyard', discard: 'graveyard', exileFrom: 'exile', returnToHand: 'hand' };
/** The zones core/legal.ts offers activated abilities from (CR 113.6): an ability that functions only elsewhere could never be activated there. */
const OFFERED_ZONES: ReadonlySet<ZoneName> = new Set(['battlefield', 'hand', 'graveyard']);

/**
 * W3b: the zones an activated ability functions in (CR 113.6), from its cost and its text after the colon (`rest`, normalized: `~` is the object itself;
 * effect sentences and "Activate only ..." restrictions alike).
 *  - CR 113.6j: a cost that needs the source somewhere other than the battlefield ("Discard ~", "Exile ~ from your graveyard", "Reveal ~ from your hand";
 *    model/forms.ts#selfCostZones, or the text of a manual cost part) can be paid only there, so the ability functions there;
 *  - CR 113.6m: an effect or restriction that moves ~ out of, or reads ~ in, another zone ("Return ~ from your graveyard to the battlefield", Reassembling
 *    Skeleton) functions only there, unless the cost or an earlier part of the effect puts ~ there first ("Sacrifice ~: Return ~ from your graveyard ...").
 * `{}` is the battlefield (the default, CR 113.6). `manual` when the zone cannot be stated: the cost needs ~ in two zones at once, the cost and the effect
 * name different zones, or the ability functions only in a zone the engine offers no activation from (core/legal.ts: battlefield, hand, graveyard).
 */
export function activationZone(cost: CostDef, rest: string): { zone?: ZoneName[] } | { manual: string } {
  const need = new Set(selfCostZones(cost));
  for (const p of cost.other ?? []) {
    if (p.kind !== 'manual') continue;
    const m = selfZoneMention(p.text);
    if (m !== null) need.add(m.zone);
  }
  if (need.size > 1) return { manual: `the cost needs ~ in two zones at once (${[...need].sort().join(', ')}), so it can never be paid (CR 113.6j)` };
  const fromCost = [...need][0];
  const puts = new Set((cost.other ?? []).flatMap((p) => ('self' in p && p.self === true && COST_PUTS_SELF[p.kind] !== undefined ? [COST_PUTS_SELF[p.kind]!] : [])));
  const m = selfZoneMention(rest);
  const fromEffect = m !== null && !m.putThereFirst && !puts.has(m.zone) ? m.zone : undefined;
  if (fromCost !== undefined && fromEffect !== undefined && fromCost !== fromEffect) {
    return { manual: `the cost needs ~ on the ${fromCost} but the ability moves or checks ~ in the ${fromEffect}, so it can never be activated as written (CR 113.6j, 113.6m)` };
  }
  const zone = fromEffect ?? fromCost;
  if (zone === undefined || zone === 'battlefield') return {};
  if (!OFFERED_ZONES.has(zone)) return { manual: `the ability functions only in the ${zone} (CR 113.6j, 113.6m), where this engine build offers no activation` };
  return { zone: [zone] };
}
