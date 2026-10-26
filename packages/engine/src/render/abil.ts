/**
 * Abilities (WP2): the grammatical frame of each ability kind around its parts: "[cost]: [effect]. Activate only ...", "When [event], [effect].",
 * "[effect of a static ability]", "I, II -- [effect]". The result is marked text with its sentence periods, ready for the gate or for display.
 */
import type { AbilityDef, ActivatedAbilityDef, Condition, ContinuousEffectDef, EventPattern, KeywordAbilityDef, ObjRef, StaticAbilityDef, StaticEffect, TriggeredAbilityDef } from '../types/ability';
import { endSentence } from './clause';
import { K } from './kernel';
import { keywordLine, keywordLineOf } from './kw';
import { abilityList } from './mods';
import { isEminence, withLookBackCounters, withoutPastTense } from './cond';
import { markTriggerRoles } from './refs';
import { cloneState, collectSpecs, withVariants, type RenderState } from './state';
import { costAmount, countWhereX, firstSpellStatic } from './stat';
import { possessiveStep, turnOf } from './turn';
import { alt, joinList, NoRenderer, numWord, roman } from './text';

/** Deepest nesting of abilities inside abilities (granted abilities, token abilities, emblems): each level can multiply the text. */
const MAX_ABILITY_DEPTH = 6;

const COMBAT_STEPS = ['beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat'];

/**
 * CMD4 (CR 602.5b, 508.1): "during your turn, before attackers are declared" (parser/lower/activation.ts#BEFORE_ATTACKERS): your turn up to the beginning of combat
 * step, and your declare attackers step not begun this turn.
 */
function beforeAttackers(c: Condition): boolean {
  if (c.cond !== 'all' || c.of.length !== 2) return false;
  const [t, n] = c.of;
  const steps = t?.cond === 'turnOf' && t.whose === 'you' && Array.isArray(t.step) ? t.step : null;
  if (steps === null || steps.join() !== 'upkeep,draw,main1,beginCombat' || n?.cond !== 'not') return false;
  const h = n.of;
  return h.cond === 'happened' && h.scope === 'turn' && h.times === undefined && h.by === undefined && h.event.ev === 'step' && h.event.step === 'declareAttackers'
    && h.event.whose === 'you' && Object.keys(h.event).length === 3;
}

/** "if it's your turn" or, as Oracle usually says it for a restriction, "during your turn" / "during your upkeep" / "during combat" (CR 602.5d). */
/** p2-combat-flow-2: the parts of the combat phase an activation restriction names by the declaration of blockers (parser/lower/activation.ts#DURING_ANY). */
const COMBAT_PARTS: Readonly<Record<string, string>> = { 'declareBlockers,combatDamage,endCombat': 'after blockers are declared', 'beginCombat,declareAttackers': 'before blockers are declared' };

function onlyIfWords(c: Condition, st: RenderState): string {
  if (beforeAttackers(c)) return alt(`if ${K.cond(c, st)}`, 'during your turn, before attackers are declared');
  const text = `if ${K.cond(c, st)}`;
  // FAST5X E5 (CR 602.5b): either of two conditions is also said with "if" before each, "if ~ entered this turn or if you control a basic land" (family or-if)
  if (c.cond === 'any' && c.of.length === 2 && c.of.every((x) => x.cond !== 'all' && x.cond !== 'any')) return alt(text, `if ${K.cond(c.of[0]!, st)} or if ${K.cond(c.of[1]!, st)}`);
  if (c.cond !== 'turnOf') return text;
  if (c.step === undefined) return alt(text, `during ${turnOf(c.whose, st)}`);
  const steps = [c.step].flat();
  if (steps.length === COMBAT_STEPS.length && COMBAT_STEPS.every((s) => steps.includes(s as never))) {
    return c.whose === 'any' ? alt(text, 'during combat') : c.whose === 'you' ? alt(text, 'during combat on your turn') : text;
  }
  // std-rn (family activation-any-step, CR 602.5b, 503.1, 511.1): Oracle names the end of combat step and the upkeep of every turn with "step" ("Activate only
  // during the end of combat step", "during any upkeep step")
  const any = c.whose === 'any' && steps.length === 1 ? ({ endCombat: 'the end of combat step', upkeep: 'any upkeep step' } as Record<string, string>)[steps[0]!] : undefined;
  const during = `during ${joinList(steps.map((s) => possessiveStep(s, c.whose, st)), 'or')}`;
  // p2-combat-flow-2 (CR 602.5b, 509.1): the steps of combat from the declare blockers step on, or up to it, are "during combat after / before blockers are declared"
  // (Trap Runner; readings added to this group, no new alt site)
  const part = c.whose === 'any' ? COMBAT_PARTS[steps.join(',')] : undefined;
  return any === undefined ? alt(text, during, ...(part !== undefined ? [`during combat ${part}`] : [])) : alt(text, during, `during ${any}`);
}

/**
 * MX5 (CR 602.2, 602.5b, 602.5d): "Any player may activate this ability." and its one restriction after "but only", said for the activating player ("as a
 * sorcery", "during their turn", "during their upkeep", "during their draw step"); any other restriction has no wording here (refused, never dropped).
 */
function anyPlayerWords(def: ActivatedAbilityDef): string {
  const c = def.onlyIf;
  const step = c?.cond === 'turnOf' && c.whose === 'you' && !Array.isArray(c.step) ? c.step : null;
  const extra = def.limit !== undefined || def.isLoyalty === true || (def.sorcerySpeed === true && c !== undefined);
  if (extra || (c !== undefined && (c.cond !== 'turnOf' || c.whose !== 'you' || Array.isArray(c.step)))) throw new NoRenderer('a restriction of an ability any player may activate');
  const only = def.sorcerySpeed === true ? 'as a sorcery'
    : c === undefined ? null
      : step === undefined ? 'during their turn' : step === 'upkeep' ? 'during their upkeep' : step === 'draw' ? 'during their draw step' : null;
  if (c !== undefined && only === null) throw new NoRenderer(`the step ${String(step)} of an ability any player may activate`);
  return only === null ? 'any player may activate this ability.' : `any player may activate this ability but only ${only}.`;
}

function activated(def: ActivatedAbilityDef, st: RenderState): string {
  // std-rx5 (CR 107.1c, 602.2b): "Remove any number of +1/+1 counters from ~: Create that many ...": the X of such a cost is "that many" in the effect
  const anyNumber = (def.cost.other ?? []).some((p) => p.kind === 'removeCounters' && p.anyNumber === true);
  if (anyNumber) st.anyNumberX = true;
  // p2-mana-1 (CR 107.1c, 602.2b): its X counted as "for each <kind> counter removed this way" (render/qty.ts#countParts)
  const xParts = (def.cost.other ?? []).filter((p) => p.kind === 'removeCounters' && p.self === true && typeof p.count === 'object' && (p.count as { q?: string }).q === 'X');
  const xKind = xParts.length === 1 && xParts[0]!.kind === 'removeCounters' ? xParts[0]!.counter : undefined;
  if (xKind !== undefined) st.costCountersX = xKind;
  const allKind = xParts.length === 1 && xParts[0]!.kind === 'removeCounters' && xParts[0]!.all === true ? xParts[0]!.counter : undefined; // p2-counters-move-2
  if (allKind !== undefined) st.costAllCountersX = allKind;
  const cost = K.cost(def.cost, st);
  // FAST1 T4 (CR 113.6m): an ability that functions only in the graveyard moves "~ from your graveyard" (render/steps-zones.ts#move)
  const saved = st.selfZone;
  if (def.zone?.length === 1 && def.zone[0] === 'graveyard') st.selfZone = 'graveyard';
  if (def.zone?.length === 1 && def.zone[0] === 'hand') st.selfZone = 'hand'; // r4-fxz (CR 113.6m): "~ from your hand"
  const effect = K.program(def.effect, st);
  if (saved === undefined) delete st.selfZone; else st.selfZone = saved;
  if (anyNumber) delete st.anyNumberX;
  if (xKind !== undefined) delete st.costCountersX;
  if (allKind !== undefined) delete st.costAllCountersX;
  const text = `${cost}: ${endSentence(effect)}`;
  // FAST1 T4 (CR 702.177a): "Exhaust -- [Cost]: [Effect]": the keyword is the ability's restrictions (types/ability.ts#ActivatedAbilityDef.keyword), so they are
  // not printed again; cloud std-dsk (CR 602.5b): a restriction of the ability's own beside them ("... Activate only as a sorcery.") is printed after the effect
  if (def.keyword !== undefined) {
    const own = withoutKeywordRestrictions(def);
    return own === null ? `${def.keyword} -- ${text}` : `${def.keyword} -- ${withRestrictions(own, text, st)}`;
  }
  if (def.anyPlayer === true) {
    if (def.xMin !== undefined) throw new NoRenderer('"X can\'t be 0." of an ability any player may activate');
    if (def.uncopiable !== undefined) throw new NoRenderer('"This ability can\'t be copied." of an ability any player may activate'); // std-copy-1
    return `${text} ${anyPlayerWords(def)}`;
  }
  return withRestrictions(def, text, st);
}

/**
 * The restrictions each implemented wrapper keyword of an activated ability gives (keywords/data/<name>.json `modifies` of kind `activated`, the restrictions
 * parser/parse.ts#registryKeywords hands the parser as `wraps`). The renderer may not import the keyword layer (design 5.4, test/m5/skeleton/import-rules.test.ts),
 * so the table is written here, as GRANT_CONDITIONS below is for the granting keywords; cloud std-dsk's test checks it against the keyword data.
 */
export const WRAPPER_RESTRICTIONS: Readonly<Record<string, { limit?: unknown; sorcerySpeed?: boolean; onlyIf?: unknown }>> = {
  exhaust: { limit: { per: 'game', max: 1 } }, // CR 702.177a: activate only once
  'power-up': { limit: { per: 'game', max: 1 } }, // CR 702.193: activate only once (its cost reduction is not a restriction)
  // cloud r3-mech (CR 702.142a): "Activate only if this creature attacked this turn and only once each turn."
  boast: { limit: { per: 'turn', max: 1 }, onlyIf: { cond: 'happened', event: { ev: 'attacks', attacker: { self: true } }, scope: 'turn' } },
};

/**
 * cloud std-dsk (CR 702.177a, 602.5b): the ability without the restrictions its wrapper keyword gives (WRAPPER_RESTRICTIONS: exhaust's "once"), or null when
 * nothing of its own is left (the parser adds only restrictions the keyword does not give, parser/lower/ability.ts).
 */
function withoutKeywordRestrictions(def: ActivatedAbilityDef): ActivatedAbilityDef | null {
  const m = WRAPPER_RESTRICTIONS[def.keyword!.toLowerCase()];
  if (m === undefined) throw new NoRenderer(`the restrictions of the keyword ${def.keyword}`);
  const out: ActivatedAbilityDef = { ...def };
  if (m.limit !== undefined && JSON.stringify(def.limit) === JSON.stringify(m.limit)) delete out.limit;
  if (m.sorcerySpeed === true && def.sorcerySpeed === true) delete out.sorcerySpeed;
  if (m.onlyIf !== undefined && JSON.stringify(def.onlyIf) === JSON.stringify(m.onlyIf)) delete out.onlyIf;
  return out.limit === undefined && out.sorcerySpeed !== true && out.onlyIf === undefined && out.costChange === undefined && out.xMin === undefined && out.uncopiable === undefined ? null : out;
}

/** The activation restrictions and the ability's own cost change after "[Cost]: [Effect]" (CR 602.5b, 601.2f). */
function withRestrictions(def: ActivatedAbilityDef, text0: string, st: RenderState): string {
  // std-rx12 (CR 107.3a, 602.2b): "X can't be 0." right after the effect, before the activation restrictions (Oracle's order)
  if (def.xMin !== undefined && def.xMin !== 1) throw new NoRenderer('a least X other than 1');
  // std-copy-1 (CR 707.10): "This ability can't be copied." in the same place, one sentence with "X can't be 0" when both are said (Gogo, Master of Mimicry)
  const uncopiable = def.uncopiable === true;
  const text1 = def.xMin === 1 ? (uncopiable ? `${text0} This ability can't be copied and X can't be 0.` : `${text0} X can't be 0.`) : uncopiable ? `${text0} This ability can't be copied.` : text0;
  // std-rx27 (CR 601.2h, 602.2b): "For each mana in this ability's activation cost, you may tap an untapped creature you control rather than pay that mana."
  const text = def.tapForMana === undefined ? text1
    : `${text1} For each mana in this ability's activation cost, you may tap ${K.np({ ...def.tapForMana, tapped: false }, st, { det: 'a' })} rather than pay that mana.`;
  // T38 (CR 601.2f, 118.7): "This ability costs {1} less to activate for each Equipment you control." comes before the activation restrictions (Oracle's order), or after
  const only: string[] = [];
  if (def.sorcerySpeed === true && def.isLoyalty !== true) only.push('as a sorcery');
  if (def.limit) {
    const { per, max } = def.limit;
    const times = max === 1 ? 'once' : max === 2 ? 'twice' : `${numWord(max)} times`;
    only.push(per === 'turn' ? `${times} each turn` : per === 'combat' ? `${times} each combat` : times);
  }
  const fixed = only.length;
  if (def.onlyIf) only.push(onlyIfWords(def.onlyIf, st));
  const tailOf = (restrictions: string[]): string => {
    let out = '';
    // FAST1 T4, CR 602.5b: a limit of more than one activation alone is also worded "Activate no more than twice each turn."
    const limitOnly = restrictions.length === 1 && def.limit !== undefined && def.limit.max > 1 && def.limit.per !== 'game';
    if (limitOnly) out += ` ${alt(`activate only ${restrictions[0]}.`, `activate no more than ${restrictions[0]}.`)}`;
    else if (restrictions.length === 2) {
      // FAST5 T45 (CR 602.5): every restriction must be met, so Oracle's order of two is free: "Activate only during your turn and only once each turn."
      // FAST5X E13 (family activation-limits, CR 602.5d): this covers a condition first too: "Activate only if there are four or more card types among cards in
      // your graveyard and only as a sorcery."
      const [a, b] = restrictions as [string, string];
      const joined = `activate only ${a} and only ${b}.`;
      const apart = `activate only ${a}. activate only ${b}.`;
      const reversed = [`activate only ${b} and only ${a}.`, `activate only ${b}. activate only ${a}.`];
      out += ` ${alt(...(a === 'as a sorcery' ? [joined, apart] : [apart, joined]), ...reversed)}`;
    }
    else for (const o of restrictions) out += ` activate only ${o}.`;
    return out;
  };
  let tail = tailOf(only);
  // std-tdm (CR 602.5b; family activation-condition-pair): two conditions that must both hold are also two restrictions, "Activate only during your turn and only
  // if a card left your graveyard this turn" (the parser builds one `all` of the two, parser/lower/activation.ts); the reading of the one condition stays
  const c = def.onlyIf;
  if (c?.cond === 'all' && c.of.length === 2 && fixed === 0) {
    const [apart] = withVariants(st, [(v) => tailOf(c.of.map((x) => onlyIfWords(x, v)))]);
    tail = alt(tail, apart!);
  }
  if (def.costChange === undefined) return text + tail;
  if (def.costChange.kind === 'set') throw new NoRenderer('an ability whose cost is set outright');
  const { amount, per } = costAmount(def.costChange, st);
  // r4-cost (CR 601.2f, 500.1): "This ability costs {1} less to activate during your turn" (`costChangeIf`); any other condition has no wording here
  const when = def.costChangeIf === undefined ? '' : JSON.stringify(def.costChangeIf) === JSON.stringify({ cond: 'turnOf', whose: 'you' }) ? ' during your turn' : null;
  if (when === null) throw new NoRenderer('an ability cost change under a condition other than "during your turn"');
  const word = def.costChange.kind === 'increase' ? 'more' : 'less';
  // std-rc (CR 602.2b, 601.2f, 107.3; family ability-cost-where-x): a reduction of one per counted object is also "This ability costs {X} less to activate, where X
  // is the number of ...", as a spell's own (family cost-where-x)
  const whereX = countWhereX(def.costChange, st);
  const counted = `this ability costs ${amount} ${word} to activate${per}${when}.`;
  const change = whereX === null ? counted : alt(counted, `this ability costs {X} ${word} to activate, where X is ${whereX}${when}.`);
  return tail === '' ? `${text} ${change}` : `${text} ${alt(`${change}${tail}`, `${tail.trim()} ${change}`)}`;
}

/**
 * FAST4 T27 (types/ability.ts#TriggerDef `while`, `first`; CR 603.1, 603.2): the words after the trigger event: "during an opponent's turn" (a turn alone),
 * "while you control a creature with power 4 or greater" (any other condition), "for the first time each turn", and "for the first time during each of your
 * turns" (the first time with the condition "it's your turn").
 */
function eventCondition(t: TriggeredAbilityDef['trigger'], st: RenderState): string {
  const w = t.while;
  // Standard round 5, r5-trig (CR 505.1; Canyon Vaulter): "during your main phase", either main phase of your turn (the condition FAST5X E9 reads "it's your main phase")
  const mainPhase = (c: Condition): boolean => c.cond === 'turnOf' && c.whose === 'you' && Array.isArray(c.step) && c.step.length === 2 && c.step.includes('main1') && c.step.includes('main2');
  const during = (c: Condition): string => (mainPhase(c) ? ' during your main phase' : c.cond === 'turnOf' && c.step === undefined ? ` during ${turnOf(c.whose, st)}` : ` while ${K.cond(c, st)}`);
  if (t.first === 'turn') {
    if (w?.cond === 'turnOf' && w.step === undefined && w.whose === 'you') return ' for the first time during each of your turns';
    return ` for the first time each turn${w !== undefined ? during(w) : ''}`;
  }
  return w !== undefined ? during(w) : '';
}

/**
 * std-lci (CR 508.1b, 119.1; parser/templates/zz-cloud/std-lci.json trg.stdlci.attacks.mostLife; dethrone's trigger, CR 702.105a): "Whenever ~ attacks the player with the
 * most life or tied for most life": an attack on a player, while no player has more life than the attacked player (the event's defender). The attack without its
 * defender, or null for any other trigger.
 */
function attacksMostLife(t: TriggeredAbilityDef['trigger']): EventPattern | null {
  const [a] = t.on;
  if (t.on.length !== 1 || a?.ev !== 'attacks' || a.defender !== 'any' || a.orPlaneswalker !== undefined || t.batch === true || t.first !== undefined) return null;
  const w = t.while;
  const want = { cond: 'compare', left: { q: 'countPlayers', of: { ref: 'each', who: 'player' }, lifeVs: { op: '>', than: { ref: 'event', role: 'defender' } } }, op: '==', right: 0 };
  if (w === undefined || JSON.stringify(canonicalOrder(w)) !== JSON.stringify(canonicalOrder(want))) return null;
  const { defender: _d, ...rest } = a;
  return rest;
}

/** Standard round 5, r5-trig (CR 601.2i): a lone "you cast a spell" whose spell is not your first this turn (`nthMin` 2): the event without it, or null. */
function notFirstSpell(t: TriggeredAbilityDef['trigger']): EventPattern | null {
  const [a] = t.on;
  if (t.on.length !== 1 || a?.ev !== 'cast' || a.nthMin !== 2 || a.player !== 'you' || t.batch === true || t.first !== undefined) return null;
  const { nthMin: _n, ...rest } = a;
  return rest;
}

/**
 * std-rx19 (CR 601.2i, 500.1; Alela, Cunning Conqueror): "you cast your first spell during each opponent's turn": a lone cast of your first spell this turn
 * (`nth` 1) while it's an opponent's turn. Oracle names the turn after the spell, without "each turn" (family first-spell-each-opponents-turn).
 */
function firstSpellOpponentsTurn(t: TriggeredAbilityDef['trigger']): boolean {
  const [a] = t.on;
  const w = t.while;
  return t.on.length === 1 && a?.ev === 'cast' && a.player === 'you' && a.nth === 1 && Object.keys(a).length === 3 && t.batch !== true && t.first === undefined
    && w?.cond === 'turnOf' && w.whose === 'opponent' && w.step === undefined && Object.keys(w).length === 2;
}

/** Key order does not matter in a comparison of plain data. */
function canonicalOrder(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalOrder);
  if (v === null || typeof v !== 'object') return v;
  return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, canonicalOrder((v as Record<string, unknown>)[k])]));
}

/** M11-4 (eminence, CR 113.6b): an ability's zones are exactly the battlefield and the command zone. */
const isEminenceZones = (zone: readonly string[] | undefined): boolean => zone !== undefined && [...zone].sort().join(',') === 'battlefield,command';

/**
 * FAST5X E3 (CR 603.2, 603.6a, 508.1): "When ~ enters and whenever it attacks [while saddled]" is Oracle's wording of the two events "~ enters or attacks":
 * the object's own enters (nothing else said of it) and its own attack.
 */
function entersAndAttacks(t: TriggeredAbilityDef['trigger']): boolean {
  const [a, b] = t.on;
  if (t.on.length !== 2 || a?.ev !== 'zoneChange' || b?.ev !== 'attacks' || t.batch === true || t.first !== undefined || t.while !== undefined) return false;
  return selfEnters(a) && keys(b).every((k) => k === 'ev' || k === 'attacker') && b.attacker?.self === true;
}

const keys = (x: object): string[] => Object.keys(x).filter((k) => (x as Record<string, unknown>)[k] !== undefined);
/** The object's own enters, nothing else said of it. */
const selfEnters = (a: EventPattern): boolean =>
  a.ev === 'zoneChange' && keys(a).every((k) => k === 'ev' || k === 'subject' || k === 'to') && a.to === 'battlefield' && keys(a.subject).length === 1 && a.subject.self === true;

/** FAST5X E20 (CR 603.2, 603.6a, 700.14): "When ~ enters and whenever you expend 4" is Oracle's wording of the two events "~ enters or you expend 4". */
function entersAndExpend(t: TriggeredAbilityDef['trigger']): boolean {
  const [a, b] = t.on;
  return t.on.length === 2 && a !== undefined && selfEnters(a) && b?.ev === 'action' && b.verb === 'expend' && t.batch !== true && t.first === undefined && t.while === undefined;
}

/**
 * CLOUD std-ecl (CR 603.2, 603.6a; family enters-and-whenever-any): "When ~ enters and whenever you cast a spell with mana value 4 or greater" is Oracle's wording of
 * the two events "~ enters or you cast ...": the object's own enters and an event that is never that one (an event of another kind, or a zone change that puts
 * nothing onto the battlefield), so the ability triggers once for each either way.
 */
function entersAndWheneverOther(t: TriggeredAbilityDef['trigger']): boolean {
  const [a, b] = t.on;
  if (t.on.length !== 2 || a === undefined || b === undefined || !selfEnters(a) || t.batch === true || t.first !== undefined || t.while !== undefined) return false;
  return b.ev !== 'zoneChange' || ![b.to ?? []].flat().includes('battlefield');
}

/**
 * FAST5X E8 (CR 603.2, 709.5i): "Whenever <event> and whenever you fully unlock a Room" (eerie) is Oracle's wording of the two events "<event> or you fully
 * unlock a Room": either one triggers the ability.
 */
function andWheneverFullyUnlock(t: TriggeredAbilityDef['trigger']): boolean {
  const [a, b] = t.on;
  return t.on.length === 2 && a !== undefined && a.ev !== 'becomes' && b?.ev === 'becomes' && b.what === 'fullyUnlocked' && t.batch !== true && t.first === undefined && t.while === undefined;
}

/**
 * FAST5 T62 (CR 603.2, 603.6a, 701.21a): "When ~ enters and when you sacrifice it" is Oracle's wording of the two events "~ enters or you sacrifice ~": the object's
 * own enters and its own sacrifice by its controller (nothing else said of either).
 */
function entersAndSacrificed(t: TriggeredAbilityDef['trigger']): boolean {
  const [a, b] = t.on;
  if (t.on.length !== 2 || a?.ev !== 'zoneChange' || b?.ev !== 'action' || t.batch === true || t.first !== undefined || t.while !== undefined) return false;
  const keys = (x: object): string[] => Object.keys(x).filter((k) => (x as Record<string, unknown>)[k] !== undefined);
  return keys(a).every((k) => k === 'ev' || k === 'subject' || k === 'to') && a.to === 'battlefield' && keys(a.subject).length === 1 && a.subject.self === true
    && b.verb === 'sacrifice' && b.actor === 'you' && keys(b).length === 4 && b.object?.self === true && keys(b.object).length === 1;
}

/**
 * FAST5 T62 (CR 603.2, 701.40a): "Whenever <event> and whenever <objects> is turned face up" is Oracle's wording of the events "<event> or <objects> is turned face
 * up": either one triggers the ability. The split is the first of the trailing `turnedFaceUp` events (null when there is none, or nothing before it).
 */
function andWheneverFaceUp(t: TriggeredAbilityDef['trigger']): number | null {
  if (t.batch === true || t.first !== undefined || t.while !== undefined) return null;
  let k = t.on.length;
  while (k > 0 && t.on[k - 1]!.ev === 'becomes' && (t.on[k - 1] as { what: string }).what === 'turnedFaceUp') k--;
  return k >= 1 && k < t.on.length ? k : null;
}

/**
 * FAST5X E25 (CR 603.2): "Whenever a face-down permanent you control enters and whenever ~ or another permanent you control is turned face up" is Oracle's
 * wording of the events "<A> or <B>" when A is of one kind and every B of another (two events of different kinds are never one event, so the ability triggers
 * once either way): the first event, then the others written together.
 */
function andWheneverOtherKind(t: TriggeredAbilityDef['trigger']): boolean {
  const [a, ...rest] = t.on;
  if (a === undefined || rest.length === 0 || t.batch === true || t.first !== undefined || t.while !== undefined) return false;
  return a.ev !== 'step' && rest.every((b) => b.ev === rest[0]!.ev && b.ev !== a.ev && b.ev !== 'step');
}

/**
 * Cloud std-fin (CR 603.2, 603.2c): "Whenever ~ or another Dwarf you control enters and whenever an Equipment you control enters" is Oracle's wording of the events
 * "~ or another Dwarf you control enters, or an Equipment you control enters": either one triggers the ability, and one event that matches several of them triggers
 * it once (CR 603.2c), as one `on` list does. Only events of objects entering the battlefield; every split point of the list (the gate keeps the one Oracle says).
 */
function andWheneverEntersSplits(t: TriggeredAbilityDef['trigger']): number[] {
  if (t.on.length < 2 || t.batch === true || t.first !== undefined || t.while !== undefined) return [];
  if (!t.on.every((e) => e.ev === 'zoneChange' && e.to === 'battlefield' && e.from === undefined)) return [];
  return Array.from({ length: t.on.length - 1 }, (_, i) => i + 1);
}

/**
 * std-rf (CR 603.2, 503.1; family event-and-at-step): "Whenever ~ transforms into ~ and at the beginning of your first main phase" is Oracle's wording of the two events
 * "~ transforms into ~ or your first main phase begins": an event that is not a step and a step (two events of different kinds are never one event, so the ability
 * triggers once either way), the step said with "at" as family enters-and-at-step says it for the object's own enters.
 */
function eventAndAtStep(t: TriggeredAbilityDef['trigger']): boolean {
  const [a, b] = t.on;
  return t.on.length === 2 && a !== undefined && b !== undefined && a.ev === 'becomes' && a.what === 'transformed' && b.ev === 'step' && t.batch !== true && t.first === undefined && t.while === undefined;
}

/**
 * std-ry4 (CR 603.2, 503.1; family at-step-and-whenever): "At the beginning of your upkeep and whenever you cast a blue spell" (the Shrines) is Oracle's wording of the
 * two events "your upkeep begins or you cast a blue spell": either one triggers the ability; a step is said with "at", the other event with "whenever". Exactly one
 * step first and one event of another kind.
 */
function atStepAndWhenever(t: TriggeredAbilityDef['trigger']): boolean {
  return t.on.length === 2 && t.on[0]!.ev === 'step' && t.on[1]!.ev !== 'step' && t.batch !== true && t.first === undefined && t.while === undefined;
}

function triggered(def: TriggeredAbilityDef, st: RenderState): string {
  // M11-4 (CR 113.6b): a triggered ability says where it functions only by its intervening "if ~ is in the command zone or on the battlefield"
  // (parser/lower/ability.ts); any other zone list with the command zone has no words
  if (def.zone?.includes('command')) {
    const iff = def.interveningIf;
    if (!isEminenceZones(def.zone) || iff?.cond !== 'exists' || iff.of.ref !== 'each' || !isEminence(iff.of.filter)) throw new NoRenderer('a triggered ability that functions in the command zone without saying so');
  }
  st.trigger = def.trigger.on;
  // FAST3 T18: the objects of a batch trigger are a group ("whenever you attack with one or more creatures, those creatures ..."), as the parser reads them
  if (def.trigger.batch === true) st.triggerBatch = true;
  if (def.trigger.wholeBatch === true) st.triggerWholeBatch = true; // r5-trig
  const stepOnly = def.trigger.on.every((e) => e.ev === 'step');
  const mostLife = attacksMostLife(def.trigger);
  // Standard round 5, r5-trig (CR 601.2i; Geralf, the Fleshwright): "Whenever you cast a spell [during your turn] other than your first spell that turn": the words of the
  // spell's number come after the event's condition
  const notFirst = notFirstSpell(def.trigger);
  const events = mostLife !== null ? `${K.events([mostLife], st, 'present')} the player with the most life or tied for most life`
    : notFirst !== null ? `${K.events([notFirst], st, 'present')}${eventCondition(def.trigger, st)} other than your first spell that turn`
    : firstSpellOpponentsTurn(def.trigger) ? `${K.events(def.trigger.on, st, 'present').replace(/ each turn$/, '')} during each opponent's turn`
    : K.events(def.trigger.on, st, 'present', { batch: def.trigger.batch === true, ...(def.trigger.wholeBatch === true ? { wholeBatch: true } : {}) }) + eventCondition(def.trigger, st);
  markTriggerRoles(st);
  // "When" for the object's own enters/dies/leaves, "Whenever" for everything that can happen more than once
  const own = def.trigger.on.length === 1 && def.trigger.on[0]!.ev === 'zoneChange' && (def.trigger.on[0] as { subject: { self?: boolean } }).subject.self === true;
  const lead0 = stepOnly ? `at ${events}` : own ? `${alt('when', 'whenever')} ${events}` : `${alt('whenever', 'when')} ${events}`;
  const lead = atStepAndWhenever(def.trigger) ? alt(lead0, `at ${K.events([def.trigger.on[0]!], st, 'present')} and whenever ${K.events([def.trigger.on[1]!], st, 'present')}`)
    : entersAndAttacks(def.trigger) ? alt(lead0, `when ~ enters and whenever it ${K.events([def.trigger.on[1]!], st, 'present').replace(/^~ /, '')}`)
    : andWheneverFullyUnlock(def.trigger) ? alt(lead0, `whenever ${K.events([def.trigger.on[0]!], st, 'present')} and whenever ${K.events([def.trigger.on[1]!], st, 'present')}`)
    : entersAndExpend(def.trigger) ? alt(lead0, `when ~ enters and whenever ${K.events([def.trigger.on[1]!], st, 'present')}`)
      : entersAndSacrificed(def.trigger) ? alt(lead0, 'when ~ enters and when you sacrifice it')
        : andWheneverFaceUp(def.trigger) !== null ? leadFaceUp(def.trigger, lead0, st)
          // FAST5X E25 (merged beside FAST5 T62's face-up reading): "whenever A and whenever B" for events of two different kinds; CLOUD std-ecl: "when ~ enters and
          // whenever B" for the object's own enters and any event that is never that one (after the other families, which keep their own readings)
          : andWheneverOtherKind(def.trigger) || entersAndWheneverOther(def.trigger) ? alt(lead0,
            ...(andWheneverOtherKind(def.trigger) ? [`whenever ${K.events([def.trigger.on[0]!], st, 'present')} and whenever ${K.events(def.trigger.on.slice(1), st, 'present')}`] : []),
            // Standard round 4, r4-trig (CR 603.2, 503.1; Gathering Stone): a step is "when ~ enters and at the beginning of your upkeep"
            ...(entersAndWheneverOther(def.trigger) ? [`when ~ enters and ${def.trigger.on[1]!.ev === 'step' ? 'at' : 'whenever'} ${K.events([def.trigger.on[1]!], st, 'present')}`] : []))
            // Cloud std-fin: "whenever A and whenever B" for entering objects (Giott, King of the Dwarves); never the case above (every event enters the battlefield)
            : andWheneverEntersSplits(def.trigger).length > 0 ? alt(lead0, ...andWheneverEntersSplits(def.trigger).map((k) => `whenever ${K.events(def.trigger.on.slice(0, k), st, 'present')} and whenever ${K.events(def.trigger.on.slice(k), st, 'present')}`))
            // std-rf (CR 603.2, 503.1; family event-and-at-step): "Whenever ~ transforms into ~ and at the beginning of your first main phase"
            : eventAndAtStep(def.trigger) ? alt(lead0, `whenever ${K.events([def.trigger.on[0]!], st, 'present')} and at ${K.events([def.trigger.on[1]!], st, 'present')}`, `when ${K.events([def.trigger.on[0]!], st, 'present')} and at ${K.events([def.trigger.on[1]!], st, 'present')}`) : lead0;
  // FAST4 T34: no past tense there (render/cond.ts), unless every event is a leave-the-battlefield event (FAST5 T47): the trigger looks back in time (CR 603.10a), so
  // the condition reads the object as it last existed, and "if it was a creature" (Enduring Courage) says what the model checks. FAST5X E21: the counters of the
  // object a leaves-the-battlefield trigger looks back at (CR 603.10a) read "had" either way
  const looksBack = def.trigger.on.every((e) => e.ev === 'zoneChange' && [e.from].flat().includes('battlefield') && ![e.to].flat().every((z) => z === 'battlefield'));
  const lookBack = def.trigger.on.length > 0 && def.trigger.on.every((e) => e.ev === 'zoneChange' && [e.from ?? []].flat().includes('battlefield'));
  const ifCond = (): string => (lookBack ? withLookBackCounters(() => K.cond(def.interveningIf!, st)) : K.cond(def.interveningIf!, st));
  const iff = def.interveningIf ? `, if ${looksBack ? ifCond() : withoutPastTense(ifCond)}` : '';
  // a condition of the effect itself (an `if` step, a guard) is not an intervening if (CR 603.4): it reads "..., draw a card if you control a Forest"
  st.afterTrigger = def.interveningIf === undefined;
  if (def.interveningIf !== undefined) st.interveningIf = def.interveningIf; // FAST5 T62: "the difference" (render/qty.ts)
  // std-sos (CR 113.6m, 404.1; family self-from-graveyard) and Cloud std-woe (the same change): a triggered ability that functions only in its owner's graveyard moves
  // "~ from your graveyard" too, as an activated one does (activated() above)
  const savedZone = st.selfZone;
  if (def.zone?.length === 1 && def.zone[0] === 'graveyard') st.selfZone = 'graveyard';
  const effect = K.program(def.effect, st);
  if (savedZone === undefined) delete st.selfZone; else st.selfZone = savedZone;
  delete st.interveningIf;
  st.afterTrigger = false;
  let text = endSentence(`${lead}${iff}, ${effect}`);
  if (def.limit) {
    const { per, max } = def.limit;
    const times = max === 1 ? 'once' : max === 2 ? 'twice' : `${numWord(max)} times`;
    // FAST5X E21 (CR 603.2h): a limit on taking the optional action is only "do this only once each turn"
    if (def.limit.action === true) {
      if (per !== 'turn' || max !== 1) throw new NoRenderer('a limited action other than once each turn');
      return `${text} do this only once each turn.`;
    }
    text += per === 'turn' ? ` ${alt(`do this only ${times} each turn.`, `this ability triggers only ${times} each turn.`)}` : ` ${alt(`do this only ${times}.`, `this ability triggers only ${times}.`)}`;
  }
  return text;
}

/** FAST5 T62: `lead0` with the reading "whenever <events> and whenever <objects> is turned face up" beside it, when the trigger has that shape. */
function leadFaceUp(t: TriggeredAbilityDef['trigger'], lead0: string, st: RenderState): string {
  const k = andWheneverFaceUp(t);
  if (k === null) return lead0;
  return alt(lead0, `whenever ${K.events(t.on.slice(0, k), st, 'present')} and whenever ${K.events(t.on.slice(k), st, 'present')}`);
}

/** A replacement of "enters with counters" followed by a grant of keywords on the same object is one printed sentence (Kavu Titan). */
function entersWithFold(effects: StaticEffect[], st: RenderState): string | null {
  if (effects.length !== 2) return null;
  const [a, b] = effects;
  if (a?.s !== 'replace' || a.body.b !== 'enters' || b?.s !== 'continuous') return null;
  const body = a.body;
  const ev = a.replaces;
  if (ev.ev !== 'zoneChange' || ev.subject.self !== true || ev.from !== undefined || [ev.to].flat().join() !== 'battlefield' || !body.counters || body.counters.length === 0) return null;
  const cont = b as ContinuousEffectDef;
  if (cont.affects.ref !== 'self' || cont.mods.length !== 1) return null;
  const m = cont.mods[0]!;
  if (m.layer !== 6 || !m.add || m.add.length === 0 || m.removeAll || m.remove || m.cantHave) return null;
  const counters = joinList(body.counters.map((c) => `${typeof c.count === 'number' ? (c.count === 1 ? 'a' : numWord(c.count)) : K.qty(c.count, st)} ${c.kind} counter${c.count === 1 ? '' : 's'}`));
  // p2-counters-state-1 (CR 613.1f): an ability other than a keyword is granted in quotes, 'it enters with two +1/+1 counters on it and with "Pay 3 life: Regenerate
  // this creature."' (Degavolver), as the other grants of a list say it (render/mods.ts#abilityList)
  const kws = m.add.some((x) => x.kind !== 'keyword') ? abilityList(m.add, st, 'creature') : joinList(m.add.map((x) => keywordLine(x as never, st).toLowerCase()));
  return `${alt('it', '~')} enters with ${counters} on it and with ${kws}`;
}

/** M6-5: the condition "~ escaped" alone (CR 702.138b), the one an "escapes with" ability has (CR 702.138c). */
const isEscaped = (c: Condition): boolean =>
  c.cond === 'wasCast' && c.via === 'escape' && c.kicked === undefined && c.from === undefined && c.xAtLeast === undefined && c.spent === undefined;

/**
 * FAST3 T11: "The second spell you cast each turn costs {1} less to cast" is a cost change of every spell you cast while you have cast exactly one spell
 * this turn: the cost is determined before the spell becomes cast (CR 601.2f, 601.2i), so the spell being cast is not counted yet and is the second one
 * exactly when the count is one. Only that condition, one change of a fixed generic amount, of every spell (no filter), cast by you.
 */
function secondSpellCost(def: StaticAbilityDef): string | null {
  const c = def.condition;
  if (c?.cond !== 'compare' || c.op !== '==' || c.right !== 1 || typeof c.left !== 'object' || c.left.q !== 'spellsCastThisTurn') return null;
  if (def.effects.length !== 1) return null;
  const e = def.effects[0]!;
  if (e.s !== 'costMod' || e.applies.self !== undefined || e.applies.abilities !== undefined || e.applies.caster !== 'you') return null;
  if (e.applies.spells === undefined || Object.values(e.applies.spells).some((v) => v !== undefined)) return null;
  const { kind, generic, mana } = e.change;
  if ((kind !== 'reduce' && kind !== 'increase') || typeof generic !== 'number' || generic <= 0 || (mana !== undefined && mana.length > 0)) return null;
  return `the second spell you cast each turn costs {${generic}} ${kind === 'reduce' ? 'less' : 'more'} to cast`;
}

/**
 * T35 (CR 721.2): the station symbol row of a Station card, `8+ | flying, lifelink`. Only the shape parser/lower/ability.ts#stationAbilities builds has these words:
 * the condition "this permanent has N or more charge counters", on itself, and one continuous effect on itself that adds the keywords (CR 721.2a) and, for the
 * row with the power and toughness box, makes it a creature with base power and toughness (CR 721.2b; the box itself is not part of the Oracle text).
 * T54: the abilities added are keywords, activated, triggered and static abilities (the lines under the symbol are abilities of the striation too).
 */
function stationRow(def: StaticAbilityDef, st: RenderState): string {
  const c = def.condition;
  const f = c?.cond === 'matches' ? (c.filter as { counters?: { kind?: string; cmp?: { op?: string; value?: unknown } } } & Record<string, unknown>) : undefined;
  const n = f?.counters?.cmp?.value;
  if (c?.cond !== 'matches' || JSON.stringify(c.object) !== '{"ref":"self"}' || f === undefined || Object.keys(f).join() !== 'counters' || f.counters?.kind !== 'charge'
    || f.counters.cmp?.op !== '>=' || typeof n !== 'number' || !Number.isInteger(n) || n < 1) throw new NoRenderer('a station row whose condition is not "N or more charge counters"');
  if (def.effects.length !== 1) throw new NoRenderer('a station row with more than one effect');
  const e = def.effects[0]!;
  if (e.s !== 'continuous' || JSON.stringify(e.affects) !== '{"ref":"self"}' || e.cda === true) throw new NoRenderer('a station row whose effect is not on the permanent itself');
  const mods = e.mods;
  const add = mods[mods.length - 1];
  if (add === undefined || add.layer !== 6 || add.add === undefined || add.add.length === 0 || add.removeAll || add.remove || add.cantHave || add.add.some((x) => x.kind !== 'keyword' && x.kind !== 'activated' && x.kind !== 'triggered' && x.kind !== 'static')) throw new NoRenderer('a station row that does not add abilities');
  if (mods.length === 3) {
    const [t, pt] = mods;
    if (t!.layer !== 4 || JSON.stringify(t) !== '{"layer":4,"types":{"add":["Creature"]}}' || pt!.layer !== '7b' || typeof pt!.power !== 'number' || typeof pt!.toughness !== 'number') throw new NoRenderer('a station row whose creature changes are not a creature with base power and toughness');
  } else if (mods.length !== 1) throw new NoRenderer('a station row with another set of changes');
  // T54 (CR 721.2): the abilities of the striation, in order: the keywords before the first other ability are the symbol's own line ("8+ | Flying, lifelink"),
  // any other ability, and a keyword after one, a line of its own
  const lead = add.add.findIndex((x) => x.kind !== 'keyword');
  const keywords = lead < 0 ? add.add.length : lead;
  const parts: string[] = [];
  if (keywords > 0) parts.push(keywordLineOf(add.add.slice(0, keywords) as KeywordAbilityDef[], st));
  for (const a of add.add.slice(keywords)) parts.push(K.ability(a, { ...st, mentioned: new Set(), info: new Map(), specs: new Map(), vars: new Map(), actor: null, trigger: null }));
  return `${n}+ | ${parts.join(' ')}`;
}

/**
 * FAST5X-4 (CR 702.178a): the condition each granting keyword means (keywords/data: `modifies` of kind `grant`): "Max speed -- [Ability]" is "As long as your
 * speed is 4, this object has [Ability]". A static ability with `keyword` is written "[keyword] -- [Ability]" only when it is exactly that.
 */
const GRANT_CONDITIONS: Readonly<Record<string, (c: Condition) => boolean>> = {
  'max speed': (c) => c.cond === 'designation' && c.what === 'maxSpeed' && c.who.ref === 'you',
};

/**
 * Cloud r3-mech (CR 614.12a, 607.2d): a Siege's bulleted ability, "[Word] -- [Ability]" (the bullet is structure): exactly the static ability
 * parser/lower/ability.ts#grantLine builds for it, `condition` `{cond:'chosen', link:'siege', equals: <the word>}` and one continuous effect on itself that adds
 * the one ability in layer 6, functioning in the zones of the ability it grants. Anything else has no wording.
 */
function chosenModeLine(def: StaticAbilityDef, st: RenderState): string {
  const word = def.chosenMode!;
  const e = def.effects.length === 1 ? def.effects[0] : undefined;
  const m = e?.s === 'continuous' && e.mods.length === 1 ? e.mods[0] : undefined;
  const c = def.condition as { cond?: string; link?: string; equals?: string } | undefined;
  // cloud r3-mech (CR 701.64): "∞ -- [Ability]", granted while the permanent itself is harnessed
  const harnessedCond = JSON.stringify(def.condition) === JSON.stringify({ cond: 'matches', object: { ref: 'self' }, filter: { harnessed: true } });
  const condOk = word === '∞' ? harnessedCond : c !== undefined && c.cond === 'chosen' && c.link === 'siege' && c.equals === word && Object.keys(c).length === 3;
  const ok = condOk && e?.s === 'continuous'
    && (e.affects as { ref?: string }).ref === 'self' && Object.keys(e).length === 3 && m !== undefined && m.layer === 6 && m.add?.length === 1 && Object.keys(m).length === 2;
  if (!ok) throw new NoRenderer(`a static ability of a Siege's choice ${word} that is not "${word} -- [ability]"`);
  const granted = m!.add![0]!;
  const zones = (a: AbilityDef): string => JSON.stringify((a as { zone?: string[] }).zone ?? ['battlefield']);
  if (granted.kind !== 'keyword' && zones(granted) !== zones(def)) throw new NoRenderer(`${word}: the ability functions in other zones than the ability it grants`);
  const fresh = { ...st, mentioned: new Set<string>(), info: new Map(), specs: new Map(), vars: new Map(), actor: null, trigger: null };
  return `${word.toLowerCase()} -- ${K.ability(granted, fresh)}`;
}

function grantingKeyword(def: StaticAbilityDef, st: RenderState): string {
  const kw = def.keyword!;
  const e = def.effects.length === 1 ? def.effects[0] : undefined;
  const m = e?.s === 'continuous' && e.mods.length === 1 ? e.mods[0] : undefined;
  const ok = def.condition !== undefined && GRANT_CONDITIONS[kw]?.(def.condition) === true && e?.s === 'continuous' && (e.affects as { ref?: string }).ref === 'self'
    && Object.keys(e).length === 3 && m !== undefined && m.layer === 6 && m.add?.length === 1 && Object.keys(m).length === 2;
  if (!ok) throw new NoRenderer(`a static ability of the keyword ${kw} that is not "${kw} -- [ability]"`);
  const granted = m!.add![0]!;
  // CR 702.178b: the max speed ability functions in the zones the granted ability states, and nowhere else
  const zones = (a: AbilityDef): string => JSON.stringify((a as { zone?: string[] }).zone ?? ['battlefield']);
  if (granted.kind !== 'keyword' && zones(granted) !== zones(def)) throw new NoRenderer(`${kw}: the ability functions in other zones than the ability it grants`);
  const fresh = { ...st, mentioned: new Set<string>(), info: new Map(), specs: new Map(), vars: new Map(), actor: null, trigger: null };
  return `${kw} -- ${K.ability(granted, fresh)}`;
}

/** The one object every effect of these is about (`affects` of a continuous effect, `subject` of a restriction), as JSON; null when they differ or have none. */
function soleSubject(effects: readonly StaticEffect[]): string | null {
  const keys = new Set(effects.map((e) => (e.s === 'continuous' ? JSON.stringify(e.affects) : e.s === 'restrict' ? JSON.stringify(e.subject) : '')));
  const [k] = [...keys];
  return keys.size === 1 && k !== '' && k !== undefined ? k : null;
}

/**
 * r5-static (CR 611.3a): "Equipped creature has deathtouch during your turn. Otherwise, it has reach.": the ability under its condition, then what it has
 * while the condition is false, about the same one object, which the second sentence calls "it" (as Oracle prints it) or names again.
 */
function otherwiseStatic(def: StaticAbilityDef, st: RenderState): string {
  const otherwise = def.otherwise!;
  const subject = soleSubject([...def.effects, ...otherwise]);
  if (def.condition === undefined || otherwise.length === 0 || subject === null) throw new NoRenderer('an "otherwise" static ability whose effects are not all about one object');
  const first = staticAbility({ ...def, otherwise: undefined }, st);
  const named = K.obj(JSON.parse(subject) as ObjRef, cloneState(st), 'subject').text;
  // one predicate per effect, the subject said once: "it has base power and toughness 1/1 and can't block Detectives"
  const parts = otherwise.map((e) => K.staticEffects([e], st));
  const preds = parts.map((p) => (p.startsWith(`${named} `) ? p.slice(named.length + 1) : p.startsWith('it ') ? p.slice(3) : null));
  if (preds.some((p) => p === null)) throw new NoRenderer('an "otherwise" effect that does not start with its object');
  const body = preds.length <= 2 ? (preds as string[]).join(' and ') : `${(preds as string[]).slice(0, -1).join(', ')}, and ${preds[preds.length - 1]}`;
  return `${first} ${endSentence(`otherwise, ${alt(`it ${body}`, `${named} ${body}`)}`)}`;
}

function staticAbility(def: StaticAbilityDef, st: RenderState): string {
  if (def.otherwise !== undefined) return otherwiseStatic(def, st); // r5-static (CR 611.3a)
  if (def.keyword !== undefined) return grantingKeyword(def, st); // FAST5X-4 (CR 702.178a)
  if (def.chosenMode !== undefined) return chosenModeLine(def, st); // cloud r3-mech: a Siege's "• [Word] -- [Ability]" (CR 614.12a, 607.2d)
  const hasReplace = def.effects.some((e) => e.s === 'replace' || e.s === 'pregame');
  // M11-4 (eminence, CR 113.6b): a static ability that functions on the battlefield and in the command zone says so ("As long as The Ur-Dragon is in the
  // command zone or on the battlefield, ..."); any other zone list with the command zone has no words here
  if (def.zone?.includes('command')) {
    if (!isEminenceZones(def.zone) || def.condition !== undefined || hasReplace || def.effects.length === 0) throw new NoRenderer('a static ability that functions in the command zone without saying so');
    return endSentence(`as long as ~ is in the command zone or on the battlefield, ${K.staticEffects(def.effects, st)}`);
  }
  // FAST4 T33: continuous effects of a static ability that functions only in its owner's graveyard (CR 113.6, 604.1: Brawn, Wonder) say so: "As long as ~
  // is in your graveyard and you control a Forest, X" (a card in a graveyard is in its owner's graveyard, CR 404.1)
  if (def.zone?.length === 1 && def.zone[0] === 'graveyard' && def.effects.length > 0 && def.effects.every((e) => e.s === 'continuous' || (e.s === 'replace' && e.body.b === 'enters'))) { // pc-counters-1: Dearly Departed's replacement, "as long as ~ is in your graveyard, each Human creature you control enters with an additional +1/+1 counter on it" (CR 113.6, 614.12)
    const where = '~ is in your graveyard';
    const cond = def.condition ? `${where} and ${K.cond(def.condition, st)}` : where;
    return endSentence(`as long as ${cond}, ${K.staticEffects(def.effects, st)}`);
  }
  // FAST2 T7: the state before anything is written, for the reading where the effect comes first ("~ has first strike as long as it's attacking")
  const before = def.condition && !hasReplace ? cloneState(st) : null;
  // M6-5 (CR 702.138c): "~ escapes with [counters] on it" is "if ~ escaped, it enters with [counters] on it": written from the state before the condition
  const escapes = def.condition !== undefined && hasReplace && isEscaped(def.condition) ? cloneState(st) : null;
  // the condition comes first in the text, so it is written first (it may name the object that the effects then call "it")
  // FAST5 T63 (family first-spell): "The first creature spell you cast each turn costs {2} less to cast and can be cast as though it had flash"
  const firstSpell = def.condition !== undefined && !hasReplace ? firstSpellStatic(def, cloneState(st)) : null;
  if (firstSpell !== null) return endSentence(firstSpell);
  const cond = def.condition ? K.cond(def.condition, st) : null;
  let body = entersWithFold(def.effects, st);
  if (body === null) {
    body = K.staticEffects(def.effects, st);
  }
  if (cond === null) return endSentence(body);
  if (hasReplace) {
    // FAST2 T8: "~ enters with a +1/+1 counter on it if you attacked this turn" (raid): the condition of the object's own entering replacement may follow it (CR 614.12)
    const ownEntry = def.effects.every((e) => e.s === 'replace' && e.body.b === 'enters' && e.replaces.ev === 'zoneChange' && e.replaces.subject?.self === true);
    const escaped = ownEntry && escapes !== null ? [K.staticEffects(def.effects, escapes).replace(/^(~|it) enters with /, '~ escapes with ')].filter((t) => t.startsWith('~ escapes with ')) : [];
    return endSentence(ownEntry ? alt(`if ${cond}, ${body}`, `${body} if ${cond}`, ...escaped) : `if ${cond}, ${body}`);
  }
  // FAST1 T5: "During your turn, X" is Oracle's wording of "as long as it's your turn, X" (CR 611.3a, 500.1; render/equivalence.ts family during-turn)
  const c = def.condition!;
  // FAST4 T29: ... and after the effect, "~ has first strike during your turn" (the same condition, CR 611.3a, 500.1; family during-turn)
  const during = c.cond === 'turnOf' && c.whose === 'you' && c.step === undefined ? [`during your turn, ${body}`, `${body} during your turn`] : [];
  // C10 (CR 611.3a, 500.1, 601.3; family during-turn): "Once during each of your turns, you may cast a creature spell from your graveyard" is the once-each-turn
  // permission as long as it's your turn
  if (during.length > 0 && body.startsWith('once each turn, ')) during.push(`once during each of your turns, ${body.slice('once each turn, '.length)}`);
  // std-rx27 (CR 500.1, 611.3a; family during-turn): "During each of your turns, you may play a land and cast ... from your graveyard" (Muldrotha): each of your
  // turns is your turn
  if (during.length > 0) during.push(`during each of your turns, ${body}`);
  // p2-misc-1 (CR 602.5b, 702.142a; family boast-twice): "Creatures you control can boast twice during each of your turns rather than once" (Birgi, God of
  // Storytelling): one more activation of each boast ability (once each turn, CR 702.142a) as long as it's your turn
  const e1 = def.effects[0];
  if (during.length > 0 && before !== null && def.effects.length === 1 && e1?.s === 'rule' && e1.rule === 'additionalActivation' && e1.keyword === 'boast' && e1.value === undefined && e1.of !== undefined) {
    during.push(`${K.np(e1.of, cloneState(before), { det: 'none', plural: true })} can boast twice during each of your turns rather than once`);
  }
  // C10 (CR 601.3, 611.3a; family cost-condition): the card's own graveyard permission under a condition is "You may cast ~ from your graveyard if a non-Zombie
  // creature died this turn", before its rider ("If you do, ~ enters with ...")
  const e0 = def.effects[0];
  if (def.effects.length === 1 && e0?.s === 'permit' && e0.action === 'cast' && e0.from === 'graveyard' && e0.of?.self === true && Object.keys(e0.of).length === 1) {
    const at = body.indexOf('. if you do, ');
    during.push(at < 0 ? `${body} if ${cond}` : `${body.slice(0, at)} if ${cond}${body.slice(at)}`);
  }
  // r4-repl (family during-turn, CR 611.3a, 500.1): "During your turn, as long as ~ is equipped, it has double strike and indestructible." (Cloud, Planet's
  // Champion): your turn and another condition, said as two leads
  if (c.cond === 'all' && c.of.length === 2 && c.of[0]!.cond === 'turnOf' && c.of[0]!.whose === 'you' && c.of[0]!.step === undefined && before !== null) {
    during.push(`during your turn, as long as ${K.cond(c.of[1]!, cloneState(before))}, ${body}`);
    during.push(`during each of your turns, as long as ${K.cond(c.of[1]!, cloneState(before))}, ${body}`); // std-rx27: each of your turns is your turn (CR 500.1)
    // p2-exile-play-1 (family during-turn-if, CR 611.3a, 500.1; Theater of Horrors): "During your turn, if an opponent lost life this turn, you may play ...": the
    // second condition said with "if", the same continuous condition
    during.push(`during your turn, if ${K.cond(c.of[1]!, cloneState(before))}, ${body}`);
  }
  // FAST5 T68 (family during-turn, CR 611.3a, 500.1, 513.1): "During your end step, X" is "as long as it's your end step, X" (one step of your turn)
  if (c.cond === 'turnOf' && c.whose === 'you' && (c.step === 'upkeep' || c.step === 'draw' || c.step === 'end')) during.push(`during ${possessiveStep(c.step, 'you', st)}, ${body}`);
  // trek-7 (family during-turn, CR 505.1, 611.3a; Scotty, Miracle Worker): "During your main phase, X" is "as long as it's your main phase, X" (either main phase of your turn)
  if (c.cond === 'turnOf' && c.whose === 'you' && Array.isArray(c.step) && c.step.length === 2 && c.step[0] === 'main1' && c.step[1] === 'main2') during.push(`during your main phase, ${body}`);
  // FAST3 T11: "During turns other than yours, X" is Oracle's wording of "as long as it's not your turn, X" (CR 611.3a, 500.1; family other-turns)
  if (c.cond === 'not' && c.of.cond === 'turnOf' && c.of.whose === 'you' && c.of.step === undefined) during.push(`during turns other than yours, ${body}`);
  // FAST5X E22 (family additional-pump-static): "As long as there are eight or more permanent cards in your graveyard, ~ gets an additional +2/+2" (descend 8 after
  // descend 4): "an additional" says only that this change adds to the one another ability of the object gives; a change of power and toughness always adds
  // (CR 613.4c), so it is the same continuous effect
  // p2-pt-3 (same family): a group too, "White creatures get an additional +1/+1 as long as there are seven or more cards in your graveyard" (Divine Sacrament)
  if (def.effects.some((e) => e.s === 'continuous' && e.mods.some((m) => m.layer === '7c')) && / gets? [+-]/.test(body)) {
    during.push(`as long as ${cond}, ${body.replace(/ (gets?) ([+-])/g, ' $1 an additional $2')}`);
    // std-rh (same family, additional-pump-static; Elenda, Saint of Dusk): the condition may follow, "~ gets an additional +5/+5 as long as C"
    during.push(`${body.replace(/ (gets?) ([+-])/g, ' $1 an additional $2')} as long as ${cond}`);
  }
  // FAST3 T11: "The second spell you cast each turn costs {1} less to cast" (family second-spell)
  const second = secondSpellCost(def);
  if (second !== null) during.push(second);
  // FAST1 T5: a spell's own cost change under a condition reads "~ costs {1} less to cast if C" (CR 601.2f, 604.5; family cost-condition)
  const ownCost = def.effects.every((e) => e.s === 'costMod' && e.applies.self === true) ? [`${body} if ${cond}`] : [];
  // FAST4 T32: "~ costs {2} less to cast if you've cast another spell this turn": its own cost is determined before it becomes cast (CR 601.2f, 601.2i), so the
  // spells its controller cast this turn are the OTHER spells; one or more of them is this condition (family cost-condition)
  if (ownCost.length > 0 && c.cond === 'compare' && c.op === '>=' && c.right === 1 && typeof c.left === 'object' && c.left.q === 'spellsCastThisTurn') {
    ownCost.push(`${body} if you've cast another spell this turn`);
  }
  // CLOUD std-ecl (family flash-condition, CR 601.3b, 604.1, 611.3a): "You may cast ~ as though it had flash if you control a Faerie": the permission of the
  // card itself in its owner's hand, under a condition checked as the spell would be cast, is written with "if" after it as well as "as long as" before it
  if (def.effects.length > 0 && def.effects.every((e) => e.s === 'permit' && e.action === 'haveFlash' && e.costChange === undefined && e.of !== undefined
    && Object.keys(e.of).length === 1 && e.of.self === true)) ownCost.push(`${body} if ${cond}`);
  // FAST2 T7: written effect first, the condition may call that object "it" (CR 611.3a; the same meaning in either order)
  const effectFirst: string[] = [];
  if (before !== null) {
    try {
      const body2 = entersWithFold(def.effects, before) ?? K.staticEffects(def.effects, before);
      effectFirst.push(`${body2} as long as ${K.cond(c, before)}`);
      // FAST5X E18: a restriction under a negated condition is also written "~ doesn't untap during your untap step unless you have an enduring story" (CR 611.3a)
      if (c.cond === 'not' && def.effects.every((e) => e.s === 'restrict')) effectFirst.push(`${body2} unless ${K.cond(c.of, cloneState(before))}`);
    } catch (e) {
      if (!(e instanceof NoRenderer)) throw e; // a reading with no words in this order is simply not offered
    }
  }
  // std-tla (family flash-condition-first): the spell's own flash permission under a condition reads "If C, you may cast ~ as though it had flash" (CR 601.3b, 611.3a)
  const ownFlash = def.effects.length > 0 && def.effects.every((e) => e.s === 'permit' && e.action === 'haveFlash' && e.of !== undefined && Object.keys(e.of).length === 1 && e.of.self === true)
    ? [`if ${cond}, ${body}`] : [];
  return endSentence(alt(`as long as ${cond}, ${body}`, `${body} as long as ${cond}`, ...effectFirst, ...during, ...ownCost, ...ownFlash));
}

/**
 * CR 601.2c, 115.1: every target spec is announced, so every spec must be in the words: one that no step names would make the spell need a target the
 * text never mentions. A spec that is only required when a condition holds (`onlyIf`) must have that condition in the text.
 */
function checkTargets(text: string, st: RenderState): string {
  for (const [id, spec] of st.specs) {
    if (!st.used.has(id)) throw new NoRenderer(`target ${id} is never used`);
    if (spec.onlyIf !== undefined && !st.conds.has(JSON.stringify(spec.onlyIf))) throw new NoRenderer(`the condition of target ${id} is not in the text`);
  }
  // a `let` fixes a value that the text says where it is first used: one that nothing uses has no words
  for (const [name, v] of st.vars) if (!v.used) throw new NoRenderer(`the value ${name} is never used`);
  return text;
}

/**
 * The abilities inside a Class level or a leveler bracket, each read in a fresh scope. M6-6: keyword abilities printed on one line ("Flying, trample") are one
 * keyword line, so consecutive keywords from the same Oracle line (`src`) are joined with commas, as at the top level of a face.
 */
function innerAbilities(abilities: readonly AbilityDef[], st: RenderState): string[] {
  const out: string[] = [];
  let prevLine: string | undefined;
  for (const a of abilities) {
    const text = K.ability(a, { ...st, mentioned: new Set(), info: new Map(), specs: new Map(), vars: new Map(), actor: null, trigger: null });
    const line = a.kind === 'keyword' && a.src !== undefined ? a.src.join(',') : undefined;
    if (line !== undefined && line === prevLine && out.length > 0) out[out.length - 1] = `${out[out.length - 1]!}, ${text}`;
    else out.push(text);
    prevLine = line;
  }
  return out;
}

export function ability(def: AbilityDef, st: RenderState): string {
  if (st.depth > MAX_ABILITY_DEPTH) throw new NoRenderer('abilities nested too deeply');
  collectSpecs(def as never, st.specs);
  switch (def.kind) {
    case 'spell': return checkTargets(endSentence(K.program(def.effect, st)), st);
    case 'activated': return checkTargets(activated(def, st), st);
    case 'triggered': return checkTargets(triggered(def, st), st);
    case 'static': return def.station === true ? stationRow(def, st) : staticAbility(def, st);
    case 'keyword': return keywordLine(def, st);
    case 'chapter': return checkTargets(endSentence(`${def.chapters.map(roman).join(', ')} -- ${K.program(def.effect, st)}`), st);
    case 'classLevel': {
      const head = def.cost ? `${K.cost(def.cost, st)}: level ${def.level}` : '';
      return [head === '' ? '' : endSentence(head), ...innerAbilities(def.abilities, st)].filter((x) => x !== '').join(' ');
    }
    case 'levelBracket': {
      const range = def.max === null ? `${def.min}+` : `${def.min}-${def.max}`;
      const pt = def.power !== undefined && def.toughness !== undefined ? ` ${def.power}/${def.toughness}` : '';
      return [`level ${range}${pt}`, ...innerAbilities(def.abilities, st)].join(' ');
    }
    case 'case': {
      // M6-0 (m6 design 2.1), CR 719.3: "To solve -- [condition]. Solved -- [ability]"
      const fresh = { ...st, mentioned: new Set<string>(), info: new Map(), specs: new Map(), vars: new Map(), actor: null, trigger: null };
      const solved = def.solved.map((a) => K.ability(a, fresh));
      return [endSentence(`to solve -- ${K.cond(def.solve, st)}`), ...solved.map((x) => `solved -- ${x}`)].join(' ');
    }
    case 'manual': {
      // a manual ability prints its own text, except that a cost the parser understood (the engine makes players pay it) must be the cost in that text
      if (def.cost === undefined) return def.text;
      const colon = def.text.indexOf(':');
      if (colon < 0) throw new NoRenderer('a manual ability with a cost whose text has no cost');
      return `${K.cost(def.cost, st)}:${def.text.slice(colon + 1)}`;
    }
    default: throw new NoRenderer(`ability kind ${String((def as { kind?: unknown }).kind)}`);
  }
}
