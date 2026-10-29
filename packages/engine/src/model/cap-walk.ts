/**
 * The capability walker (design 5.2): which capabilities an ability needs, and where. Owner: WP1. Pure; imports only the model.
 *
 * It lives apart from model/capabilities.ts (which BUILDS the engine's set from the other layers' tables) so that the parser, the degrade pass and the
 * classifier can use it without importing the engine. Names are the discriminator values of the JSON (`op:damage`, `cond:happened`, `layer:7c`, ...), the
 * value-form and unread-field names of model/forms.ts (`filter:keyword.list`, `cost:discard.hand`, `feature:target.distinct`, ...), and the `feature:` /
 * `decision:` constants below. Manual nodes (`op:manual`, `cond:ask`, `q:ask`, a manual cost part, a ManualAbilityDef) need nothing: they are what
 * a missing capability turns into.
 *
 * Value forms the design splits between M5 and M6 get a name of their own, in the same way (the engine has them only when its owner registers the name):
 *   body:enters.copy|faceDown|transformed|under|attachTo   (with layer:1a for a copy, CR 707.9, and layer:1b for face down, CR 708.2)
 *   body:modify.amount|count|destination|to, body:modify.destination.faceDown|transformed|attacking|attachedTo|order|owner|random, body:prevent.then
 *   feature:shield.<b> for a shield (made by a resolved effect) whose body is neither `prevent` nor `regeneration`
 *   op:changeFace.faceDown|faceUp|convert|flip|manifest   (plain `transform` is op:changeFace)       op:copy.except       op:designate.day|night|initiative
 *   op:rollDie.multiTable   (a results table for several dice or several players)
 *   op:move.until|until.other|stack (and layer:1b for face down)   op:exchange.control|hands|powerToughness   op:regenerate.duration
 *   op:cast.costChange   op:counter.to.battlefield|stack   op:copy.permanentSpell   op:changeFace.delayedSelf   (WP14: the forms its handlers resolve by hand)
 *   feature:token.<name>   (WP14: a predefined token, CR 111.10, needs what its own abilities need)
 *   feature:control.layered   (W3b audit: a layer-2 control change, CR 613.1b; see the Modification case)
 *   restrict:<mode> and feature:restrict.max|other|when   (a hook declares which modes and extra fields it enforces)
 *   feature:permit.<action>.<field>   (likewise for the optional fields of a permission)
 *   rfilter:<field>, rq:<kind>, rq:cost.<kind>, rcond:<kind>   (a node inside a rule effect: what the statics evaluate there, see ruleEffectOf)
 *   counter:<kind>   (WP21 review: a counter kind with rules of its own beyond the engine core, put on something; see counterForms)
 *   sfilter:<field>, sq:<kind>, sref:<ref>, scond:<kind>   (a static ability's condition or continuous effect: what statics/match.ts evaluates, see staticallyEvaluated)
 * The structural kinds have no table of their own, so they are `feature:` constants: `feature:chapter` (with `ev:counters`, the event it expands to),
 * `feature:class.level`, `feature:leveler.bracket`, and `feature:mana.restriction` for a restricted addMana. Registered by the package that implements
 * them (triggers/normalize.ts, statics/layers.ts, and the owner of the addMana handler); until then abilities that use them degrade to manual.
 */
import { isPlayerOnlyRefKind, type ActivatedAbilityDef, type Condition, type CostPart, type ModeSpec, diesCause, isLifeGainCause, type EventPattern, type ObjectFilter, type TargetSpec } from '../types/ability';
import { activatedForms, announceCondForms, costPartForms, filterForms, modeSpecForms, targetSpecForms } from './forms';
import { ABILITY_DEFS, ancestors, isNestedAbility, walkAbility, type WalkNode } from './walk';

/** FAST5X E10: the keyword actions that are only ever costs (paid by rules/cost.ts, which has no `action:` macro for them). */
export const COST_ONLY_ACTIONS: ReadonlySet<string> = new Set(['waterbend']);

type Rec = Record<string, unknown>;
/**
 * The keywords whose cost may be "equal to its mana cost" (`KeywordAbilityDef.costIsManaCost`): flashback (FAST5 T56, actions/cast-options.ts), mayhem (cloud r3-mech) and, r5-cost,
 * harmonize and embalm (keywords/expand.ts substitutes the object's mana cost, CR 702.180a, 702.128a). Any other keyword with it still misses its cost.
 */
const COST_IS_MANA_COST: ReadonlySet<string> = new Set(['flashback', 'mayhem', 'harmonize', 'embalm', 'beam me up' /* trek-7 */]);

const rec = (x: unknown): Rec => (typeof x === 'object' && x !== null ? (x as Rec) : {});

/**
 * MX5: an `effect` step lasting through the next untap step (`dur:throughNextUntap`, core/durations.ts#expireAfterUntapStep) is enforced for the plain
 * untap restriction only ("doesn't untap during ... next untap step", CR 502.3). Without a player the effect ends per object, so its subject must name
 * objects (fixed as it begins), never a live group (CR 611.2c would keep it open to new objects, whose untap steps the per-object records can't follow).
 * Anything else gets `feature:throughNextUntap.other`, which nothing registers (fail closed).
 */
function throughNextUntapForms(step: Rec): string[] {
  const effects = Array.isArray(step['effects']) ? (step['effects'] as unknown[]).map(rec) : [];
  const plain = effects.length > 0 && effects.every((e) => e['s'] === 'restrict' && e['mode'] === 'cant' && e['action'] === 'untapDuringUntapStep'
    && e['other'] === undefined && e['max'] === undefined && e['when'] === undefined);
  const perObject = rec(step['duration'])['whose'] === undefined;
  const live = effects.some((e) => ['each', 'union'].includes(String(rec(e['subject'])['ref'])));
  return plain && !(perObject && live) ? [] : ['feature:throughNextUntap.other'];
}

/**
 * FAST5X E29: an `effect` step whose effects are all play or cast permissions for named objects (`of` is `{is}` alone, statics/play-permits.ts): the only
 * place a "for as long as it remains exiled" duration (`remainsExiled`) is read (core/durations.ts#namedStillExiled, CR 611.2b, 400.7).
 */
/** std-control-1: an `effect` step whose effects are all "can't" restrictions (rule effects read through statics/rule-sources.ts#durationActive). */
function restrictionsOnly(step: Rec): boolean {
  return step['op'] === 'effect' && Array.isArray(step['effects']) && step['effects'].length > 0 && (step['effects'] as unknown[]).map(rec).every((e) => e['s'] === 'restrict' && e['mode'] === 'cant');
}

function objectPermitsOnly(step: Rec): boolean {
  if (step['op'] !== 'effect' || !Array.isArray(step['effects']) || step['effects'].length === 0) return false;
  return (step['effects'] as unknown[]).map(rec).every((e) => e['s'] === 'permit' && (e['action'] === 'play' || e['action'] === 'cast')
    && Object.keys(rec(e['of'])).length === 1 && rec(e['of'])['is'] !== undefined);
}

/**
 * WP16 INTERFACE CHANGE (review fix). The rule effects (restrictions, permissions, rule modifications, cost modifiers) are evaluated by the statics after all
 * layers (CR 613.10-613.11), not by rules/filter.ts or effects/eval.ts, so a filter field, quantity or condition inside one needs the statics' capability as
 * well as the general one: `rfilter:<field>`, `rq:<kind>` (`rq:cost.<kind>` for a cost modifier's amount, which actions/cast.ts evaluates with the history
 * too) and `rcond:<kind>`. statics/hooks.ts registers what it evaluates; anything else keeps the card manual instead of silently never applying.
 */
const RULE_EFFECT_DEFS: ReadonlySet<string> = new Set(['RestrictionDef', 'PermissionDef', 'RuleModDef', 'CostModDef']);

/** The rule effect a node belongs to (stopping at a nested ability), and whether it is a cost modifier's amount (under `change`, not inside a filter). */
function ruleEffectOf(n: WalkNode): { costAmount: boolean } | null {
  let inFilter = false;
  for (let child = n, a = n.parent; a !== null; child = a, a = a.parent) {
    // T38: the cost change of an activated ability is read like a cost modifier's amount (statics/costmods.ts#costQuantity)
    if (a.def === 'ActivatedAbilityDef' && child.slot === 'costChange') return { costAmount: !inFilter };
    if (a.def === 'KeywordAbilityDef' && child.slot === 'costChange') return { costAmount: !inFilter }; // r4-cost: the keyword's activated ability's cost change
    if (ABILITY_DEFS.has(a.def)) return null;
    if (RULE_EFFECT_DEFS.has(a.def)) return { costAmount: a.def === 'CostModDef' && child.slot === 'change' && !inFilter };
    if (a.def === 'ObjectFilter') inFilter = true;
  }
  return null;
}

/** r4-cost: a node of the cost change of an activated ability (its own, or a keyword's) or of a modifier of activated abilities' costs. */
function abilityCost(n: WalkNode): boolean {
  for (let child = n, a = n.parent; a !== null; child = a, a = a.parent) {
    if ((a.def === 'ActivatedAbilityDef' || a.def === 'KeywordAbilityDef') && child.slot === 'costChange') return true;
    if (a.def === 'CostModDef') return a.value['applies'] !== undefined && rec(a.value['applies'])['abilities'] !== undefined;
    if (ABILITY_DEFS.has(a.def)) return false;
  }
  return false;
}

/**
 * Whether the native mana-ability path can run this effect exactly (rules/mana-text.ts#manaUnitsOf): no targets or modes, at least one step, and every step a
 * plain `addMana` with `units` (no guard, no `as`). WP20 INTERFACE CHANGE (see the ActivatedAbilityDef case).
 *
 * FAST2 T7 INTERFACE CHANGE: or an `addMana` whose mana is decided as it resolves (`dynamic` of kind anyColor, anyOneColor, chosen, ofType: "one mana of
 * the chosen color", "{G} for each creature you control", "three mana of any one color"). Since WP31 rules/mana.ts#activateManaAbility runs such an effect
 * at once through the interpreter's addMana handler (effects/mana-ability.ts, CR 605.3b; test/m5/cards/wp31-spine.test.ts taps Paradise Plume through
 * `applyAction`), so it adds exactly what it says. `sameAsSpent` stays out (it reads the costs paid for a stack object; the handler asks by hand), and so
 * does every other instruction beside `addMana` (a pain land's damage, CR 605.3b: still `feature:mana.steps`).
 */
const RESOLVED_DYNAMIC: ReadonlySet<string> = new Set([
  'anyColor', 'anyOneColor', 'chosen', 'ofType',
  'eachColorAmong', 'colorsOf', // FAST5 T48
  'commanderIdentity', // M11-0: gated by feature:mana.commanderIdentity
  'couldProduce', // p2-mana-1: CR 106.7, gated by feature:mana.couldProduce
  'devotionColor', // p2-mana-2: CR 700.5, gated by feature:mana.devotionColor
]);

/** A dynamic production that reads nothing of its source: any color or any one color, a fixed number of times ("three mana of any one color"). */
const SOURCE_FREE_DYNAMIC: ReadonlySet<string> = new Set(['anyColor', 'anyOneColor']);

function nativeManaEffect(effect: unknown, dynamic: 'all' | 'sourceFree' = 'sourceFree'): boolean {
  const e = rec(effect);
  const steps = e['steps'];
  if (!Array.isArray(steps) || steps.length === 0 || e['modes'] !== undefined || (Array.isArray(e['targets']) && e['targets'].length > 0)) return false;
  const plain = (s: unknown): boolean => {
    const st = rec(s);
    const d = rec(st['dynamic']);
    const kind = String(d['kind']);
    const dynamicRuns = dynamic === 'all' ? RESOLVED_DYNAMIC.has(kind) : SOURCE_FREE_DYNAMIC.has(kind) && typeof d['count'] === 'number';
    const produces = (Array.isArray(st['units']) && st['dynamic'] === undefined) || (st['units'] === undefined && st['dynamic'] !== undefined && dynamicRuns);
    // r3-cost: an addMana named only for the reflexive trigger that waits for it ("Add {R}. When you do, ...", below)
    const named = st['as'] === undefined || steps.some((x) => rec(x)['op'] === 'reflexive' && rec(rec(x)['when'])['did'] === st['as']);
    return st['op'] === 'addMana' && produces && st['guard'] === undefined && named;
  };
  // std-lci (CR 605.3b, 122.1; mirrors parser/lower/ability.ts#onlyAddMana): a counter put on or removed from the object itself, and a choice between plain
  // productions by a condition ("add {G}{G} instead"), run at once through the resolver (rules/mana.ts#activateManaAbility: such an effect has no plain units)
  const selfCounters = (s: unknown): boolean => {
    const st = rec(s);
    const on = rec(st['op'] === 'removeCounters' ? st['from'] : st['on']);
    return (st['op'] === 'removeCounters' || st['op'] === 'putCounters') && on['ref'] === 'self' && st['guard'] === undefined && st['as'] === undefined;
  };
  const branch = (s: unknown): boolean => {
    const st = rec(s);
    if (st['op'] !== 'if' || st['guard'] !== undefined) return false;
    const lists = [st['then'], ...(st['else'] !== undefined ? [st['else']] : [])];
    return lists.every((l) => Array.isArray(l) && l.length > 0 && l.every((x) => plain(x))); // pc-keywords-mana-2: and a resolved dynamic production ("add two mana of any one color instead"), run by the resolver as a lone dynamic addMana is
  };
  // r3-cost (CR 603.12, mirrors parser/lower/ability.ts#reflexiveAfterMana): "Add {R}. When you do, ~ deals 1 damage to each opponent": a reflexive trigger with no
  // targets that waits for an addMana step of the effect (the resolver runs it, rules/mana.ts#activateManaAbility; the trigger uses the stack)
  const reflexive = (s: unknown): boolean => {
    const st = rec(s);
    const when = rec(st['when']);
    return st['op'] === 'reflexive' && st['guard'] === undefined && when['if'] === undefined && Array.isArray(st['targets']) && st['targets'].length === 0
      && steps.some((x) => rec(x)['op'] === 'addMana' && rec(x)['as'] === when['did']);
  };
  // CMD5 (CR 605.3b, 120.3; mirrors parser/lower/ability.ts#selfDamageToYou): the source's fixed damage to its controller ("This land deals 1 damage to you."),
  // with the source still on the battlefield (after "Sacrifice ~" as a cost, `sourceFree`, it keeps feature:mana.steps)
  const pain = (s: unknown): boolean => {
    const st = rec(s);
    const to = rec(st['to']);
    return dynamic === 'all' && st['op'] === 'damage' && rec(st['source'])['ref'] === 'self' && to['ref'] === 'you' && Object.keys(to).length === 1
      && typeof st['amount'] === 'number' && st['guard'] === undefined && st['as'] === undefined;
  };
  // std-ry7 (CR 605.1a, 605.3b; mirrors parser/lower/ability.ts#drawYou, #selfNoUntapNext, #delayedDrawYou): a fixed draw by its controller ("Draw a card.", also
  // after "Sacrifice ~": it reads nothing of the source), a delayed one ("Draw a card at the beginning of the next turn's upkeep."), and the source staying tapped
  // through its controller's next untap step ("This land doesn't untap during your next untap step.", with the source still on the battlefield)
  const draw = (s: unknown): boolean => {
    const st = rec(s);
    const who = rec(st['who']);
    return st['op'] === 'draw' && who['ref'] === 'you' && Object.keys(who).length === 1 && typeof st['count'] === 'number' && st['guard'] === undefined && st['as'] === undefined;
  };
  const delayedDraw = (s: unknown): boolean => {
    const st = rec(s);
    const doList = st['do'];
    return st['op'] === 'delay' && st['guard'] === undefined && st['as'] === undefined && (!Array.isArray(st['targets']) || st['targets'].length === 0)
      && st['duration'] === undefined && rec(st['when'])['at'] === 'step' && Array.isArray(doList) && doList.length > 0 && doList.every(draw);
  };
  const noUntapNext = (s: unknown): boolean => {
    const st = rec(s);
    const d = rec(st['duration']);
    const effects = Array.isArray(st['effects']) ? st['effects'] : [];
    const r = rec(effects[0]);
    const subject = rec(r['subject']);
    return dynamic === 'all' && st['op'] === 'effect' && st['guard'] === undefined && st['as'] === undefined && d['d'] === 'throughNextUntap' && d['whose'] === 'you'
      && effects.length === 1 && r['s'] === 'restrict' && subject['ref'] === 'self' && Object.keys(subject).length === 1 && r['mode'] === 'cant'
      && r['action'] === 'untapDuringUntapStep' && r['other'] === undefined;
  };
  // std-rx22 (CR 605.3b, 119.3; mirrors parser/lower/ability.ts#gainLifeYou): a fixed amount of life its controller gains ("You gain 1 life."); it reads nothing of
  // the source, so also after "Sacrifice ~" as a cost
  const life = (s: unknown): boolean => {
    const st = rec(s);
    const who = rec(st['who']);
    return st['op'] === 'gainLife' && who['ref'] === 'you' && Object.keys(who).length === 1 && typeof st['amount'] === 'number' && st['guard'] === undefined && st['as'] === undefined;
  };
  // std-mana-12 (CR 605.3b, 106.1; mirrors parser/lower/ability.ts#selfManaColor): the source becomes the color of the mana an addMana step of the effect recorded
  // (`link`), until end of turn ("This creature becomes that color until end of turn."), with the source still on the battlefield
  const manaColor = (s: unknown): boolean => {
    const st = rec(s);
    const effects = Array.isArray(st['effects']) ? st['effects'] : [];
    const e = rec(effects[0]);
    const mods = Array.isArray(e['mods']) ? e['mods'] : [];
    const colors = rec(rec(mods[0])['colors']);
    return dynamic === 'all' && st['op'] === 'effect' && st['guard'] === undefined && st['as'] === undefined && rec(st['duration'])['d'] === 'endOfTurn' && effects.length === 1
      && e['s'] === 'continuous' && rec(e['affects'])['ref'] === 'self' && Object.keys(rec(e['affects'])).length === 1 && mods.length === 1 && rec(mods[0])['layer'] === 5
      && typeof colors['chosen'] === 'string' && Object.keys(colors).length === 1 && steps.some((x) => rec(x)['op'] === 'addMana' && rec(x)['link'] === colors['chosen']);
  };
  return steps.some((s) => plain(s) || branch(s)) && steps.every((s) => plain(s) || selfCounters(s) || pain(s) || life(s) || draw(s) || delayedDraw(s) || noUntapNext(s) || branch(s) || reflexive(s) || manaColor(s));
}

/**
 * WP20 INTERFACE CHANGE (review): what the native mana-ability path (rules/mana.ts: manaAbilityDenial, activateManaAbility; rules/timing.ts skips mana
 * abilities) cannot run as written, mirroring manaAbilityDenial so a classified `full` mana ability is one that path runs exactly:
 *  - `feature:mana.steps`: an effect that is not plain `addMana` units (CR 605.3b; see nativeManaEffect);
 *  - `feature:mana.activation`: an activation restriction the native path can't check: the controller's attestation (`onlyIf` with an `ask`: nobody is asked
 *    while mana abilities are activated for a payment), or a zone other than the battlefield (CR 113.6: manaAbilityDenial refuses any other zone). FAST5X E5:
 *    "Activate only if [readable condition]", "only once each turn", "only once" and "only as a sorcery" are checked (CR 605.1a, 602.5b, 602.5d); the
 *    condition's announcement forms and a per-combat limit are walked by activatedForms like any ability's;
 *  - `feature:mana.cost`: a cost manaAbilityDenial refuses (rules/mana.ts#manaCostShape `unsupported`: a loyalty cost, an {X}, a cost part the build can't
 *    pay, CR 605.3a, 118.3), so the ability would be classified automated yet never be activatable. FAST5X E5: a mana cost and the other cost parts are paid
 *    (filter abilities, "Pay 1 life", "Tap an untapped creature you control", ...); each part keeps its own `cost:<kind>` capability.
 * No table advertises them: such an ability degrades to a manual mana ability (offered by hand) until the native path, or interpreter resolution of mana
 * abilities, handles the form (owner to be named at the W3 planning; the natural owners are WP7 for rules/mana.ts and WP13 for addMana).
 */
function nativeManaGaps(v: Rec): string[] {
  const out: string[] = [];
  const zone = v['zone'];
  const offField = Array.isArray(zone) && !(zone.length === 1 && zone[0] === 'battlefield');
  const attested = v['onlyIf'] !== undefined && JSON.stringify(v['onlyIf']).includes('"cond":"ask"'); // FAST5X E5
  // edh-mana-keywords-1 (CR 113.6, 605.1a): a mana ability that works in the hand only ("Exile this card from your hand: Add {G}.") is run by rules/mana.ts#manaAbilityDenial
  const handOnly = Array.isArray(zone) && zone.length === 1 && zone[0] === 'hand';
  if (attested || (offField && !handOnly)) out.push('feature:mana.activation');
  if (handOnly) out.push('feature:mana.activation.hand');
  const cost = rec(v['cost']);
  const mana = Array.isArray(cost['mana']) ? cost['mana'] : [];
  const other = Array.isArray(cost['other']) ? cost['other'] : [];
  // FAST5X E5: mirrors rules/mana.ts#manaCostShape `unsupported`
  const unpayable = (cost['mana'] !== undefined && !Array.isArray(cost['mana'])) || mana.some((sym) => rec(sym)['kind'] === 'variable') || other.some((p) => rec(p)['kind'] === 'manual');
  // ... and, for a cost beyond {T}, {Q} and "Sacrifice ~", an X in it or an effect that reads what it paid (rules/mana.ts#COST_READS: no stack object keeps it)
  const simple = mana.length === 0 && other.every((p) => rec(p)['kind'] === 'sacrifice' && rec(p)['self'] === true);
  const costReads = /"q":"X"|"ref":"costSacrificed"|"ref":"costTapped"|"ref":"costBeheld"|"ref":"costChosenObject"|"ref":"costRevealed"|"ref":"costReturned"|"ref":"costDiscarded"|"ref":"costExiled"|"q":"colorsSpent"/; // CLOUD C8: discarded, exiled
  // p2-mana-1 (rules/mana.ts#counterXPart): an X that is only the number of <kind> counters ONE part removes from ~ (no {X}, no loyalty) is announced as it is activated
  const xParts = other.filter((p) => JSON.stringify(p).includes('"q":"X"'));
  const xp = rec(xParts[0]);
  const counterX = xParts.length === 1 && xp['kind'] === 'removeCounters' && xp['self'] === true && xp['counter'] !== 'any' && xp['among'] === undefined && xp['filter'] === undefined
    && rec(xp['count'])['q'] === 'X' && cost['loyaltyX'] === undefined;
  const strip = (x: unknown): string => (counterX ? JSON.stringify(x ?? null).replaceAll('"q":"X"', '') : JSON.stringify(x ?? null));
  const readsCost = !simple && (costReads.test(strip(other)) || costReads.test(strip(v['effect'])));
  if (unpayable || readsCost || cost['loyalty'] !== undefined) out.push('feature:mana.cost');
  // FAST2 T7: a production decided as it resolves may read the source then (its chosen color, its power); after "Sacrifice ~" as a cost the source is
  // gone before the resolver runs (rules/mana.ts#activateManaAbility), so only a production that reads nothing of it runs then ("{T}, Sacrifice ~: Add
  // three mana of any one color"); the others keep feature:mana.steps (never a guess from a moved object)
  // FAST5X E13: "Exile ~" (CR 118.3, 602.2) and "Return ~ to its owner's hand" move the source away before the resolver runs, as "Sacrifice ~" does
  const sacrificesSelf = other.some((p) => ['sacrifice', 'exileFrom', 'returnToHand', 'putIntoLibrary' /* trek-9 */].includes(String(rec(p)['kind'])) && rec(p)['self'] === true);
  if (!nativeManaEffect(v['effect'], sacrificesSelf ? 'sourceFree' : 'all')) out.unshift('feature:mana.steps');
  return out;
}

/**
 * WP21 review, INTERFACE CHANGE (WP1 file). Counter names are an open class (design 6.11), but some kinds carry rules of their own (CR 122.1): a +X/+Y
 * counter changes power and toughness (122.1a), a shield counter replaces destruction and prevents damage (122.1c), a stun counter replaces untapping
 * (122.1d), a finality counter replaces going to the graveyard (122.1h), rad counters trigger (122.1i, 728), a hone counter on an Equipment pumps the
 * equipped creature (std-ra, statics/hone.ts). Putting such a counter on something needs
 * that rule, or the counter sits there doing nothing: `counter:<kind>`, registered (model/capabilities.ts) by the package that implements the rule.
 * The engine core applies the others for every op that puts counters, so they need no name: +1/+1 and -1/-1 and the keyword counters of CR 122.1b
 * (statics/live.ts#counterMods), loyalty, defense and poison (state-based actions, CR 704.5c, 704.5i, 704.5v), and every kind with no rules meaning
 * (charge, time, lore, oil, ...: only abilities that read them care, and those are walked on their own). Removing a counter needs none of its rules.
 */
const RULED_COUNTERS: ReadonlySet<string> = new Set(['shield', 'stun', 'finality', 'rad', 'hone']); // std-ra: hone (CR 122.1, statics/hone.ts)
const PT_COUNTER = /^[+-][0-9x]+\/[+-][0-9x]+$/;
export function counterForms(kind: unknown): string[] {
  if (typeof kind !== 'string') return [];
  const k = kind.trim().toLowerCase();
  if (k === '+1/+1' || k === '-1/-1') return [];
  if (/^[+-]\d+\/[+-]\d+$/.test(k)) return []; // std-rx17: every +X/+Y counter with fixed numbers is applied by the core (statics/live.ts#counterMods, CR 122.1a)
  return RULED_COUNTERS.has(k) || PT_COUNTER.test(k) ? [`counter:${k}`] : [];
}

/**
 * WP22 INTERFACE CHANGE (review fix, design 5.2, 15.1.5). A static ability's `condition` (CR 611.3a, read by statics/live.ts, statics/layers.ts and
 * statics/rule-sources.ts) and the nodes of its continuous effects (CR 613.1, read by the layer system) are evaluated by statics/match.ts, which knows no
 * history, events or variables. So such a node needs the statics' name as well as the general one: `scond:<cond>`, `sq:<q>`, `sref:<ref>` (object
 * references; players are read by playersOf) and `sfilter:<field>`, which model/capabilities.ts builds from statics/match.ts. Not inside an ability
 * granted by the static (it is an ability of its own) nor inside a resolved `effect` step (its set and numbers are fixed at resolution, CR 611.2c, WP15).
 * The condition of a static whose effects are all of other kinds (a replacement, CR 614; a trigger modifier) is read by the general evaluators.
 */
const STATICS_CONDITION_KINDS: ReadonlySet<string> = new Set(['continuous', 'restrict', 'permit', 'rule', 'costMod']);

function staticallyEvaluated(n: WalkNode): boolean {
  let inContinuous = false;
  for (let child = n, a = n.parent; a !== null; child = a, a = a.parent) {
    if (a.def === 'StaticAbilityDef') {
      if (child.slot === 'condition') {
        const effects = a.value['effects'];
        return Array.isArray(effects) && effects.some((e) => STATICS_CONDITION_KINDS.has(String(rec(e)['s'])));
      }
      return inContinuous;
    }
    if (ABILITY_DEFS.has(a.def) || a.def === 'EffectStep') return false;
    if (a.def === 'ContinuousEffectDef') inContinuous = true;
  }
  return false;
}

/**
 * M6-5a (m6 design 3.8, INTERFACE CHANGE of this WP1 file). The cast path reads additional and alternative costs (CR 118.8-118.9, 601.2b) ONLY from the printed
 * abilities of the card being cast (actions/cast-options.ts#castOptionsOf over `faceChars`). So `static:additionalCost` / `static:alternativeCost` vouch for a
 * printed static ability only: the same effect stored by a resolving spell (an `effect` step: nothing reads such a record) needs `feature:castCost.lasting`, and
 * one granted to another object (a layer 6 `add`, an ability of a token, any nested ability) or a granted keyword whose expansion is such a cost (kicker,
 * buyback, evoke, ...) needs `feature:castCost.granted`. Neither is registered, so those abilities stay manual instead of offering a cost the cast path never
 * reads. An alternative cost's `when` ("If an opponent controls a Swamp, you may ...") is read at announcement before X exists (actions/cast.ts#castCheck
 * through announceCond, CR 601.2b): it needs the announcement forms of model/forms.ts#announceCondForms, as a mode's `override.when` does.
 */
const CAST_STATICS: ReadonlySet<string> = new Set(['additionalCost', 'alternativeCost', 'castWith' /* FAST5X E2 */]);

/** The keywords whose expansion is a cast cost (installed by model/capabilities.ts from the keyword library, which this walker can't import, design 5.4). */
let castCostKeywords: ReadonlySet<string> = new Set();
export function installCastCostKeywords(names: Iterable<string>): void {
  castCostKeywords = new Set(names);
}

/**
 * M6-12: the parameters each keyword's expansion needs (keywords/data: `params` not marked optional), installed by model/capabilities.ts (design 5.4). An
 * instance without one ("gains embalm until end of turn. The embalm cost is equal to its mana cost.": the cost is the next sentence) can't be expanded, so
 * it needs `feature:keyword.missing.<param>`, never registered: the ability stays manual instead of failing as the object's characteristics are computed.
 */
let keywordParams: ReadonlyMap<string, readonly string[]> = new Map();
export function installKeywordParams(params: ReadonlyMap<string, readonly string[]>): void {
  keywordParams = params;
}

/**
 * MX2 (CR 607.2d, 702.16a): a keyword quality read from a linked choice ("protection from the chosen color", quality `chosen:color`) runs only where the engine
 * reads it: granted by a layer-6 modification (statics/mods.ts reads the link store of the effect's source; a resolved effect stores the color,
 * effects/handlers/lasting-fix.ts#fixChosen), and only for the link `color`: `feature:quality.chosen` (statics/mods.ts#CHOSEN_QUALITY_FEATURES). Printed on
 * the object, inside a token or a quoted ability, or another link: names that are never registered (fail closed).
 */
function chosenQualityForm(n: WalkNode, quality: string): string {
  if (quality !== 'chosen:color') return `feature:quality.chosen.${quality.slice('chosen:'.length)}`;
  for (const a of ancestors(n)) {
    if (a.def === 'Modification') return 'feature:quality.chosen';
    if (a.def === 'TokenDef' || isNestedAbility(a)) return 'feature:quality.chosen.nested';
  }
  return 'feature:quality.chosen.printed';
}

/** Where a node sits when it is not part of a printed ability: inside a resolved `effect` step, or inside a grant (a layer 6 effect, a token, a nested ability). */
function notPrinted(n: WalkNode): 'lasting' | 'granted' | null {
  for (const a of ancestors(n)) {
    if (a.def === 'EffectStep' && a.value['op'] === 'effect') return 'lasting';
    if (a.def === 'Modification' || a.def === 'TokenDef' || isNestedAbility(a)) return 'granted';
  }
  return null;
}

function castStaticForms(n: WalkNode): string[] {
  const v = n.value;
  const out: string[] = [];
  const where = notPrinted(n);
  if (where !== null) out.push(`feature:castCost.${where}`);
  const when = v['when'];
  if (v['s'] === 'alternativeCost' && typeof when === 'object' && when !== null) out.push(...announceCondForms(when as Condition, 'altCost')); // p2-cost-statics-1: the turn's history too (actions/cast.ts)
  return out;
}

/** The optional fields of a PermissionDef: each wired permission declares the ones it honors (`feature:permit.<action>.<field>`). */
const PERMIT_FIELDS = ['of', 'from', 'asThough', 'count', 'costChange', 'grants', 'laterTurn', 'oncePerTurn', 'anyManaType', 'anyManaColor', 'while', 'addCost', 'entersWith', 'graveyardInstead', 'asAdventure', 'exileOnLeave', 'single', 'entersWithIf', 'entersSubtypes', 'ownOnly', 'landsEnterTapped', 'attacker', 'alsoOutside'] as const; // FAST5X E2: laterTurn (CR 702.185a); E14: oncePerTurn; E29: anyManaType (CR 609.4b), while; C10: addCost, entersWith; r5-repl: graveyardInstead (CR 614.1a); r5-dig: asAdventure (CR 715.3)

/** std-rx3: `{kind:'set', cost:{}}` and nothing else, "without paying its mana cost" (statics/play-permits.ts#isFreeCost, which the walker cannot import, design 5.4). */
/**
 * std-exile-play-2-3: `{kind:'set', cost:{other:[{kind:'action', action:'waterbend', arg}]}}` and nothing else, `arg` a whole number or the mana value of the very
 * objects the permission names (`{q:'stat', stat:'manaValue', of: <its is>}`, fixed to a number as the effect begins; statics/play-permits.ts#isWaterbendCost).
 */
function isWaterbendCostJson(c: unknown, is: unknown): boolean {
  const r = rec(c);
  const cost = rec(r['cost']);
  const other = cost['other'];
  if (Object.keys(r).length !== 2 || r['kind'] !== 'set' || Object.keys(cost).length !== 1 || !Array.isArray(other) || other.length !== 1) return false;
  const p = rec(other[0]);
  if (Object.keys(p).length !== 3 || p['kind'] !== 'action' || p['action'] !== 'waterbend') return false;
  const arg = p['arg'];
  if (typeof arg === 'number') return Number.isInteger(arg) && arg >= 0;
  const q = rec(arg);
  return Object.keys(q).length === 3 && q['q'] === 'stat' && q['stat'] === 'manaValue' && JSON.stringify(q['of']) === JSON.stringify(is);
}

function isFreeCostJson(c: unknown): boolean {
  const r = rec(c);
  const cost = rec(r['cost']);
  return r['kind'] === 'set' && r['cost'] !== undefined && Object.keys(r).every((k) => r[k] === undefined || k === 'kind' || k === 'cost') && Object.keys(cost).every((k) => cost[k] === undefined);
}

/**
 * std-rx27: a static linked cast permission with riders (statics/play-permits.ts#isLinkedRiderPermit, which the walker cannot import, design 5.4): `action`
 * 'cast', `who` you, `of` the linked cards (`is` `{ref:'linked', link}`, no `zone`) with any qualities, and only the riders `anyManaType`, `oncePerTurn`,
 * `entersWith` and a free `costChange`, at least one rider or quality (the bare form is r5-refs' `permit:cast.linked`). Its feature names, or null.
 */
function linkedRiderFeatures(v: Rec): string[] | null {
  if (v['action'] !== 'cast' || JSON.stringify(v['who']) !== '{"ref":"you"}') return null;
  const of = rec(v['of']);
  const is = rec(of['is']);
  if (is['ref'] !== 'linked' || typeof is['link'] !== 'string' || Object.keys(is).length !== 2 || of['zone'] !== undefined || of['putThereFrom'] !== undefined) return null;
  if (of['putThereThisTurn'] !== undefined && of['putThereThisTurn'] !== true) return null;
  if (!Object.keys(v).every((k) => ['s', 'who', 'action', 'of', 'anyManaType', 'oncePerTurn', 'entersWith', 'costChange', 'addCost'].includes(k))) return null;
  if (v['costChange'] !== undefined && !isFreeCostJson(v['costChange'])) return null;
  if (v['addCost'] !== undefined && (v['costChange'] !== undefined || typeof v['addCost'] !== 'object' || v['addCost'] === null)) return null; // std-exile-play-2-1 (statics/play-permits.ts#isLinkedRiderPermit)
  if ((v['anyManaType'] !== undefined && v['anyManaType'] !== true) || (v['oncePerTurn'] !== undefined && v['oncePerTurn'] !== true)) return null;
  const out: string[] = [];
  if (Object.keys(of).some((k) => k !== 'is' && k !== 'putThereThisTurn')) out.push('feature:permit.cast.linked.of');
  if (of['putThereThisTurn'] !== undefined) out.push('feature:permit.cast.linked.thisTurn');
  if (v['anyManaType'] !== undefined) out.push('feature:permit.cast.linked.anyManaType');
  if (v['oncePerTurn'] !== undefined) out.push('feature:permit.cast.linked.oncePerTurn');
  if (v['entersWith'] !== undefined) out.push('feature:permit.cast.linked.entersWith');
  if (v['costChange'] !== undefined) out.push('feature:permit.cast.linked.free');
  if (v['addCost'] !== undefined) out.push('feature:permit.cast.linked.addCost'); // std-exile-play-2-1 (CR 601.2f, 118.8)
  return out.length === 0 ? null : out;
}

/** std-exile-play-1-3: `{kind:'increase', mana}` with generic mana only, each a positive amount (statics/play-permits.ts#isIncreaseCost, which the walker cannot import, design 5.4). */
function isIncreaseCostJson(c: unknown): boolean {
  const r = rec(c);
  const m = r['mana'];
  return r['kind'] === 'increase' && Array.isArray(m) && m.length > 0 && Object.keys(r).every((k) => r[k] === undefined || k === 'kind' || k === 'mana')
    && m.every((x) => rec(x)['kind'] === 'generic' && typeof rec(x)['amount'] === 'number' && (rec(x)['amount'] as number) > 0);
}

/** FAST5 T56: `{kind:'increase', mana:[{kind:'generic', amount:n}]}` with n a positive integer and nothing else (statics/hooks.ts#genericIncrease, which the walker cannot import, design 5.4). */
function isGenericIncreaseJson(c: unknown): boolean {
  const r = rec(c);
  const m = r['mana'];
  if (Object.keys(r).length !== 2 || r['kind'] !== 'increase' || !Array.isArray(m) || m.length !== 1) return false;
  const s = rec(m[0]);
  return s['kind'] === 'generic' && Number.isInteger(s['amount']) && (s['amount'] as number) > 0;
}

/**
 * GY1: `{s:'permit', who:{ref:'you'}, action:'play', of:{types:['Land']}, from:'graveyard'}` and no other field (statics/play-permits.ts#isGraveyardLandPermit,
 * which the walker cannot import, design 5.4).
 */
function isGraveyardLandPermitJson(v: Rec): boolean {
  const keys = Object.keys(v).filter((k) => v[k] !== undefined);
  if (keys.length !== 5 || !['s', 'who', 'action', 'of', 'from'].every((k) => keys.includes(k))) return false;
  if (v['s'] !== 'permit' || v['action'] !== 'play' || v['from'] !== 'graveyard') return false;
  const who = rec(v['who']);
  const of = rec(v['of']);
  const ofKeys = Object.keys(of).filter((k) => of[k] !== undefined);
  const types = of['types'];
  const subtypes = of['subtypes'];
  // std-rl (CR 205.3i): also lands of one land type, "Forests" (a basic land type) or "Desert lands" (statics/play-permits.ts#isGraveyardLandFilter)
  const typesOk = types === undefined || (Array.isArray(types) && types.length === 1 && types[0] === 'Land');
  const subOk = subtypes === undefined ? types !== undefined
    : Array.isArray(subtypes) && subtypes.length === 1 && typeof subtypes[0] === 'string' && (types !== undefined || ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].includes(subtypes[0]));
  return Object.keys(who).filter((k) => who[k] !== undefined).length === 1 && who['ref'] === 'you'
    && ofKeys.length > 0 && ofKeys.every((k) => k === 'types' || k === 'subtypes') && typesOk && subOk;
}

/**
 * trek-11: statics/play-permits.ts#isPermanentPlayPermit, spelled here because the walker imports no statics (design 5.4): "Once during each of your turns, you may play a
 * permanent card you own from outside the game or from your graveyard" (CR 400.11, 305.1, 601.3): `{s:'permit', who:{ref:'you'}, action:'play', of:{types: the six
 * permanent card types}, from:'graveyard', alsoOutside:true, oncePerTurn:true}` and no other field.
 */
function isPermanentPlayPermitJson(v: Rec): boolean {
  if (v['s'] !== 'permit' || v['action'] !== 'play' || v['from'] !== 'graveyard' || v['alsoOutside'] !== true || v['oncePerTurn'] !== true) return false;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined);
  if (keys.length !== 7 || !['s', 'who', 'action', 'of', 'from', 'alsoOutside', 'oncePerTurn'].every((k) => keys.includes(k))) return false;
  const who = rec(v['who']);
  if (Object.keys(who).filter((k) => who[k] !== undefined).length !== 1 || who['ref'] !== 'you') return false;
  const of = rec(v['of']);
  if (Object.keys(of).filter((k) => of[k] !== undefined).length !== 1) return false;
  const types = of['types'];
  return Array.isArray(types) && types.length === 6 && ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'].every((t) => types.includes(t));
}

/**
 * C10: a graveyard permission statics/play-permits.ts#isGraveyardPermit honors (the walker cannot import it, design 5.4): `who` exactly `{ref:'you'}`,
 * `from` the graveyard; `cast` with any `of` and optionally `addCost`, `entersWith` (counters with a fixed number) and `oncePerTurn`; `play` with no `of`
 * ("cards") or exactly GY1's land form, and nothing else.
 */
function isGraveyardPermitJson(v: Rec): boolean {
  if (v['s'] !== 'permit' || v['from'] !== 'graveyard' || (v['action'] !== 'cast' && v['action'] !== 'play')) return false;
  if (v['alsoOutside'] !== undefined) return isPermanentPlayPermitJson(v); // trek-11: the field is honored on that one form only
  // std-rx27 (CR 305.2, 601.3): "During each of your turns, you may play a land ... from your graveyard": a land permission once each turn (statics/play-permits.ts)
  const allowed = ['s', 'who', 'action', 'from', 'of', ...(v['action'] === 'cast' ? ['addCost', 'entersWith', 'oncePerTurn', 'exileOnLeave' /* std-rx24 */, 'single', 'entersSubtypes' /* std-freecast-2 */, 'graveyardInstead' /* p2-graveyard-2 */] : v['of'] !== undefined ? ['oncePerTurn'] : [])];
  if (Object.keys(v).some((k) => v[k] !== undefined && !allowed.includes(k))) return false;
  const who = rec(v['who']);
  if (Object.keys(who).filter((k) => who[k] !== undefined).length !== 1 || who['ref'] !== 'you') return false;
  if (v['action'] === 'play' && v['of'] !== undefined && !isGraveyardLandPermitJson({ ...v, oncePerTurn: undefined })) return false;
  if (rec(v['of'])['is'] !== undefined) return false; // a permission for named objects is FAST4 T31's form
  const counters = v['entersWith'];
  if (counters !== undefined && !(Array.isArray(counters) && counters.length > 0 && counters.every((c) => typeof rec(c)['kind'] === 'string' && typeof rec(c)['count'] === 'number' && (rec(c)['count'] as number) > 0))) return false;
  // std-freecast-2: the subtypes ride with the counters only; one spell (`single`) never with a once-each-turn limit
  const sub = v['entersSubtypes'];
  if (sub !== undefined && !(counters !== undefined && Array.isArray(sub) && sub.length > 0 && sub.every((x) => typeof x === 'string' && x.length > 0))) return false;
  if (v['single'] !== undefined && (v['single'] !== true || v['oncePerTurn'] !== undefined)) return false;
  // p2-graveyard-2 (CR 614.1a): "If a spell cast this way would be put into your graveyard, exile it instead": into exile, nothing else (as the engine reads it)
  if (v['graveyardInstead'] !== undefined && JSON.stringify(rec(v['graveyardInstead'])['to']) !== '{"zone":"exile"}') return false;
  return v['oncePerTurn'] === undefined || v['oncePerTurn'] === true;
}

/**
 * Standard round 10: a `nextSpell` filter of the fields effects/handlers/next-spell.ts#NEXT_SPELL_FILTER_FIELDS reads (what the spell is; the zone only the stack,
 * the stack kind only a spell), the same check as its `nextSpellFilterOk`, spelled here because the walker imports no handler (design 5.4).
 */
/**
 * std-rx26: the keyword a `nextSpell` rider `keyword` may give (affinity with its filter, convoke, improvise: the keywords the cast reads from the spell as it is
 * cast), the same check as effects/handlers/next-spell.ts#nextSpellKeywordOk, spelled here because the walker imports no handler (design 5.4).
 */
function nextSpellKeywordOk(k: unknown): boolean {
  if (k === null || typeof k !== 'object' || Array.isArray(k)) return false;
  const r = rec(k);
  if (r['kind'] !== 'keyword' || ![ 'affinity', 'convoke', 'improvise', 'cascade', 'storm'].includes(String(r['keyword']))) return false;
  return Object.keys(r).every((x) => ['kind', 'keyword', 'text', 'filter'].includes(x)) && (r['keyword'] === 'affinity') === (r['filter'] !== undefined);
}

function nextSpellFilterOk(f: unknown): boolean {
  if (f === undefined) return true;
  if (f === null || typeof f !== 'object' || Array.isArray(f)) return false;
  const r = rec(f);
  const fields = ['types', 'allTypes', 'notTypes', 'subtypes', 'supertypes', 'colors', 'notColors', 'colorless', 'multicolored', 'anyOf', 'zone', 'stackKind'];
  return Object.keys(r).every((k) => r[k] === undefined || (fields.includes(k) && (k !== 'zone' || r[k] === 'stack') && (k !== 'stackKind' || r[k] === 'spell')
    && (k !== 'anyOf' || (Array.isArray(r[k]) && (r[k] as unknown[]).every(nextSpellFilterOk)))));
}

/** Cloud r3-mech: a `fromOutside` filter of the fields effects/handlers/outside.ts#OUTSIDE_FILTER_FIELDS reads (types, allTypes, notTypes, anyOf of those, colors, name). */
function outsideFilterOk(f: unknown): boolean {
  if (f === undefined) return true;
  const r = rec(f);
  return Object.keys(r).every((k) => r[k] === undefined || ['types', 'allTypes', 'notTypes', 'colors', 'name'].includes(k) || (k === 'anyOf' && Array.isArray(r[k]) && (r[k] as unknown[]).every(outsideFilterOk)));
}

/**
 * r3-cost: the JSON form of statics/play-permits.ts#isAltCostPermit (an alternative cost a static ability gives other spells, CR 118.9): `cast` for `{ref:'you'}`,
 * `costChange` `{kind:'set', cost[, name]}`, optionally `of` (not named objects) and `oncePerTurn`, nothing else.
 */
function isAltCostPermitJson(v: Rec): boolean {
  if (v['s'] !== 'permit' || v['action'] !== 'cast' || v['costChange'] === undefined) return false;
  if (Object.keys(v).some((k) => v[k] !== undefined && !['s', 'who', 'action', 'of', 'costChange', 'oncePerTurn', 'firstSpellThisTurn'].includes(k))) return false;
  if (v['firstSpellThisTurn'] !== undefined && (v['firstSpellThisTurn'] !== true || v['of'] !== undefined)) return false; // std-freecast-1: of all spells only
  const who = rec(v['who']);
  // std-freecast-1: or the active player ("each player ... during each of their turns") with `firstSpellThisTurn` only
  if (Object.keys(who).filter((k) => who[k] !== undefined).length !== 1 || !(who['ref'] === 'you' || (who['ref'] === 'active' && v['firstSpellThisTurn'] === true))) return false;
  const cc = rec(v['costChange']);
  if (cc['kind'] !== 'set' || cc['cost'] === undefined || Object.keys(cc).some((k) => cc[k] !== undefined && !['kind', 'cost', 'name'].includes(k))) return false;
  if (rec(v['of'])['is'] !== undefined) return false;
  return v['oncePerTurn'] === undefined || v['oncePerTurn'] === true;
}

/** std-freecast-5: statics/play-permits.ts#isTopPlotPermit, spelled here because the walker imports no statics (design 5.4). */
function isTopPlotPermitJson(v: Rec): boolean {
  if (v['s'] !== 'permit' || v['action'] !== 'plot' || v['fromTop'] !== true) return false;
  if (Object.keys(v).some((k) => v[k] !== undefined && !['s', 'who', 'action', 'fromTop', 'of', 'plotCost'].includes(k))) return false;
  const who = rec(v['who']);
  if (Object.keys(who).filter((k) => who[k] !== undefined).length !== 1 || who['ref'] !== 'you') return false;
  if (v['plotCost'] !== undefined && v['plotCost'] !== 'manaCost') return false;
  return (v['of'] === undefined) !== (v['plotCost'] === undefined);
}

export interface CapUse {
  cap: string;
  /** JSON pointer of the node that needs it. */
  path: string;
}

const HISTORY_FILTERS: ReadonlySet<string> = new Set(['enteredThisTurn', 'dealtDamageThisTurn', 'attackedThisTurn', 'blockedThisTurn', 'dealtDamageBySourceThisTurn', 'controllerDealtCombatDamageBySourceThisTurn',
  'dealtDamageAsSourceThisTurn' /* std-mkm */, 'putThereThisTurn' /* r3-choose */, 'crewedBySourceThisTurn' /* r5-trig */, 'enteredFrom' /* r5-trig */, 'putThereFrom' /* r5-fxz */, 'countersPutThisTurn' /* std-rx12 */]);

const present = (v: Rec, ...keys: string[]): string[] => keys.filter((k) => v[k] !== undefined && v[k] !== false);

/**
 * Merge wave 8 (audit D2, CR 603.12, 608.2h): the number of targets of a reflexive trigger that is what a step of the resolution creating it did ("you may discard
 * any number of cards. When you do, up to that many target creatures ...": `{q:'resultCount'}` of the discard) is a fixed number once the trigger exists:
 * effects/handlers/lasting-fix.ts#prepareDeferred evaluates it as effects/handlers/lasting.ts#reflexive creates the trigger, so its targets are announced with a
 * number. The spec as the announcement reads it: such a count as a number (any other count is unchanged).
 */
function reflexiveBakedCounts(n: WalkNode): TargetSpec {
  const spec = n.value as unknown as TargetSpec;
  const step = n.parent?.def === 'EffectStep' ? n.parent.value : undefined;
  if (step?.['op'] !== 'reflexive' || n.slot !== 'targets') return spec;
  const inner = JSON.stringify(step['do'] ?? null);
  const baked = (c: unknown): boolean => rec(c)['q'] === 'resultCount' && typeof rec(c)['step'] === 'string' && !inner.includes(`"as":${JSON.stringify(rec(c)['step'])}`);
  return { ...spec, ...(baked(spec.min) ? { min: 0 } : {}), ...(baked(spec.max) ? { max: 1 } : {}) };
}

/**
 * std-combat-2 (CR 603.12, 700.2, 608.2h): the same for the number of modes of a reflexive trigger ("you may pay {1} up to three times. When you do, choose up to that
 * many --": `{q:'resultCount'}` of the payment): effects/handlers/lasting.ts#reflexive fixes it as it creates the trigger, before the modes are chosen (CR 603.3c).
 */
function reflexiveBakedModes(n: WalkNode): ModeSpec {
  const spec = n.value as unknown as ModeSpec;
  const step = n.parent?.def === 'EffectStep' ? n.parent.value : undefined;
  if (step?.['op'] !== 'reflexive' || n.slot !== 'modes') return spec;
  const inner = JSON.stringify(step['do'] ?? null);
  const baked = (c: unknown): boolean => rec(c)['q'] === 'resultCount' && typeof rec(c)['step'] === 'string' && !inner.includes(`"as":${JSON.stringify(rec(c)['step'])}`);
  return { ...spec, ...(baked(spec.min) ? { min: 0 } : {}), ...(baked(spec.max) ? { max: spec.options.length } : {}) };
}

/** Value forms of a replacement body that the M5 build does not run (design 8.5, 14). */
function bodyForms(v: Rec): string[] {
  const out: string[] = [];
  if (v['b'] === 'enters') {
    if (Array.isArray(v['choose']) && v['choose'].some((c) => rec(c)['cardKind'] !== undefined)) out.push('feature:choose.cardKind'); // std-rx28 (CR 201.3)
    for (const k of present(v, 'copy', 'faceDown', 'transformed', 'under', 'attachTo', 'prepared' /* M6-0: CR 722.3a */, 'choice' /* FAST5X E28: CR 702.136a */, 'countersIf' /* CMD3: CR 702.44a */, 'untapped' /* r5-fxb: CR 614.1d */, 'lookAtHand' /* std-rx6: CR 614.12a, 402.3 */, 'devour' /* std-rx15: CR 702.82a */, 'exileCards' /* std-cardcopy-3: CR 614.12a, 607.2a */, 'subtypes' /* std-freecast-2: CR 614.1c, written by rules only (unregistered) */, 'dayIfNeither' /* p2-misc-1: CR 731.1 */, 'attacking' /* trek-8: CR 508.4 */)) out.push(`body:enters.${k}`);
    if (v['copy'] !== undefined) out.push('layer:1a'); // CR 614.12, 707.9, 616.1c
    if (rec(v['copy'])['then'] !== undefined) out.push('body:enters.copy.then'); // r4-copy: "When you do, exile that card." (CR 603.12)
    if (rec(v['copy'])['copiedCounters'] !== undefined) out.push('body:enters.copy.copiedCounters'); // trek-4: "If you do, it enters with additional counters ... the copied permanent has" (CR 614.1c)
    if (rec(v['copy'])['duration'] !== undefined) out.push('body:enters.copy.duration'); // pc-tokens-2: "become a copy ... until end of turn" (CR 611.2)
    if (v['faceDown'] === true) out.push('layer:1b'); // CR 708.2
  } else if (v['b'] === 'modify') {
    for (const k of present(v, 'amount', 'count', 'destination', 'to', 'then', 'link')) out.push(`body:modify.${k}`); // M6-12: then (CR 702.35a); std-ru: link (CR 607.2a)
    // WP11 INTERFACE CHANGE (review): the fields of a new destination (CR 614.1a) are value forms of their own, so a build that applies only some of them
    // ("shuffle it into its owner's library", CR 701.24c; "exile it face down", CR 406.3) never classifies the others as automated.
    const d = rec(v['destination']);
    for (const k of present(d, 'faceDown', 'transformed', 'attacking', 'attachedTo', 'order', 'owner')) out.push(`body:modify.destination.${k}`);
    if (d['position'] === 'random') out.push('body:modify.destination.random');
    if (d['faceDown'] === true && d['zone'] === 'battlefield') out.push('layer:1b'); // CR 708.2a: a face-down permanent's characteristics
  } else if (v['b'] === 'prevent') {
    // WP11 INTERFACE CHANGE (review): a prevention effect's additional steps (CR 615.5, "draws cards equal to the damage prevented this way").
    if (Array.isArray(v['then']) && v['then'].length > 0) out.push('body:prevent.then');
    if (typeof v['as'] === 'string') out.push('body:prevent.as'); // std-library-2: the prevention named for a reflexive step in `then` (CR 603.12)
  } else if (v['b'] === 'insteadThen') {
    if (v['if'] !== undefined || v['otherwise'] !== undefined) out.push('body:insteadThen.if'); // p2-replace-events-1: the event goes on only if, else elsewhere (CR 614.1a)
  } else if (v['b'] === 'redirect') {
    if (v['amount'] !== undefined) out.push('body:redirect.amount'); // M6-0: "the next N damage ... is dealt to X instead" (CR 614.9 with a budget; M6-1)
  } else if (v['b'] === 'during') {
    if (createsPTSetting(v['do'])) out.push('feature:copy.asEntersPT'); // M6-0, CR 707.2, 613.2a: "as ~ is turned face up, it becomes a N/N" (M6-2)
  }
  return out;
}

// ---- M6-0: the names of section 7 of docs/design/m6-replacement-copy-faces.md ----------------------------------------------------------------------

/**
 * M6-0 (m6 design D2, 2.1): the capability of a replacement pattern's event kind, `feature:replace.on.<ev>[.<verb>]`: a replacement effect applies only to the
 * events the proposal pipeline proposes and translates (effects/registries.ts#PROPOSAL_KINDS; effects/replacements.ts#REPLACE_ON_CAPABILITIES registers the
 * translated ones). `action` patterns name their verb; "is turned face up" and "transforms" are the `turnFaceUp` and `transform` proposals (M6-3, M6-4); a
 * turn beginning is the `turn` proposal (M6-1).
 */
export function replaceOnName(p: Rec): string {
  const ev = String(p['ev']);
  if (ev === 'action') return `feature:replace.on.action.${String(p['verb'])}`;
  if (ev === 'becomes') {
    const what = String(p['what']);
    return what === 'turnedFaceUp' ? 'feature:replace.on.turnFaceUp' : what === 'transformed' ? 'feature:replace.on.transform' : `feature:replace.on.becomes.${what}`;
  }
  if (ev === 'beginTurn') return 'feature:replace.on.turn';
  return `feature:replace.on.${ev}`;
}

/** Does this JSON (steps) create a continuous effect that sets power and toughness (layer 7b, CR 613.4b)? (`feature:copy.asEntersPT`, m6 design 3.3.) */
function createsPTSetting(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(createsPTSetting);
  if (node === null || typeof node !== 'object') return false;
  const o = node as Rec;
  if (o['layer'] === '7b' && (o['power'] !== undefined || o['toughness'] !== undefined)) return true;
  return Object.values(o).some(createsPTSetting);
}

/** Does this condition read a choice made by a linked ability ("the chosen ...", CR 607.2d)? */
function readsChoice(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(readsChoice);
  if (node === null || typeof node !== 'object') return false;
  const o = node as Rec;
  return o['cond'] === 'chosen' || Object.values(o).some(readsChoice);
}

/**
 * M6-0 (m6 design 3.3): `feature:copy.asEntersPT` for a static ability whose P/T-setting modification is conditioned on a choice made as the object entered
 * (Primal Clay's other representation): its result is part of the object's copiable values (CR 707.2, 613.2a), which only M6-2's 1a records give a copy.
 */
function staticAsEntersPT(v: Rec): boolean {
  const effects = Array.isArray(v['effects']) ? v['effects'] : [];
  return readsChoice(v['condition']) && effects.some((e) => rec(e)['s'] === 'continuous' && createsPTSetting(rec(e)['mods']));
}

/** Player references that always stand for exactly one player. */
const SINGLE_PLAYER_REFS: ReadonlySet<string> = new Set(['you', 'active', 'controllerOf', 'ownerOf']);

/** Value forms of a step that the M5 build does not run (design 14: face-down, convert, flip, copy exceptions, day and night). */

/** CLOUD std-misc: an exception the copy of a spell can have (effects/handlers/token-defs.ts#exceptedSpellDef): types added or removed, colors set, a fixed P/T. */
function spellCopyException(m: unknown): boolean {
  const r = rec(m);
  const typeChange = (x: unknown): boolean => x === undefined || Object.entries(rec(x)).every(([k, val]) => val === undefined || ((k === 'add' || k === 'remove') && Array.isArray(val)));
  if (r['layer'] === 4) return r['named'] === undefined && typeChange(r['supertypes']) && typeChange(r['types']) && typeChange(r['subtypes']);
  if (r['layer'] === 5) { const c = rec(r['colors']); return Array.isArray(c['set']) && Object.keys(c).every((k) => k === 'set'); }
  if (r['layer'] === '7b') return typeof r['power'] === 'number' && typeof r['toughness'] === 'number';
  return false;
}

function stepForms(v: Rec): string[] {
  switch (v['op']) {
    case 'repeat': return v['again'] === true ? ['op:repeat.again'] : []; // std-cardcopy-1 (CR 608.2c): "repeat this process" with no count
    case 'changeTarget': return v['to'] !== undefined ? ['op:changeTarget.to'] : []; // edh-cast-1 (CR 115.7): "change a target of target spell or ability to ~"
    // p2-coinflip-1 (CR 705.1-705.2): "flip a coin until you lose a flip"; p2-coinflip-3 (CR 705.2): flips called for "for each flip you win"
    case 'flipCoin': return [...(v['untilLose'] === true ? ['op:flipCoin.untilLose'] : []), ...(v['called'] === true ? ['op:flipCoin.called'] : [])];
    case 'changeFace':
      return [...(v['to'] !== 'transform' ? [`op:changeFace.${String(v['to'])}`] : []), ...(v['manifest'] === true ? ['op:changeFace.manifest'] : [])];
    case 'copy':
      // M6-2 INTERFACE CHANGE: the exceptions of a token copy (CR 707.9b) run (`op:copy.except`, effects/handlers/tokens-copy.ts#OP_FORMS); those of a spell copy
      // ("except that the copy is red", Fork) do not, so that form has a name of its own, never registered (fail closed)
      // M6-12: "except it has no mana cost" (`noManaCost`, CR 707.9b) is an exception like the others
      // std-copy-1 (CR 611.2a, 400.7a): abilities a spell copy gains (`op:copy.gains`); a token copy's is a form of its own, never registered (fail closed)
      if (typeof v['gains'] === 'object' && v['gains'] !== null) return [v['result'] === 'spell' && (!Array.isArray(v['except']) || v['except'].length === 0) && v['noManaCost'] !== true ? 'op:copy.gains' : 'op:copy.gains.other'];
      if ((!Array.isArray(v['except']) || v['except'].length === 0) && v['noManaCost'] !== true) return [];
      // CLOUD std-misc: a spell copy's exceptions of types, colors and a fixed P/T run (`op:copy.spellExcept`, effects/handlers/token-defs.ts#exceptedSpellDef); any
      // other exception, or no mana cost, keeps a name of its own, never registered (fail closed)
      if (v['result'] === 'spell') return [v['noManaCost'] !== true && (v['except'] as unknown[]).every(spellCopyException) ? 'op:copy.spellExcept' : 'op:copy.spellExcept.other'];
      return ['op:copy.except'];
    case 'designateObject':
      // M6-6 INTERFACE CHANGE: each designation is registered with the mechanism that reads it (effects/handlers/levels.ts#OP_FORMS)
      return [`op:designateObject.${String(v['designation'])}`];
    case 'designate':
      // day and night (daybound/nightbound, CR 702.145) and the initiative (venture into Undercity, CR 726.2) need more than the designation (WP15)
      // FAST5X-4: "your speed increases by N" (CR 702.179c) is a form of its own, registered by model/capabilities.ts with the speed mechanism
      // CMD3: the city's blessing (ascend on an instant or sorcery, CR 702.131a), core/citys-blessing.ts#CITYS_BLESSING_OP_FORMS
      // std-control-1: a speed reduction with its floor (CR 702.179) is a form of its own, registered with the same mechanism
      if (v['decrease'] !== undefined || v['floor'] !== undefined) return v['what'] === 'speed' && v['decrease'] === true && typeof v['floor'] === 'number' ? ['op:designate.speed.reduce'] : ['op:designate.speed.malformed'];
      return v['what'] === 'day' || v['what'] === 'night' || v['what'] === 'initiative' || v['what'] === 'speed' || v['what'] === 'citysBlessing' ? [`op:designate.${String(v['what'])}`] : [];
    // FAST5X E16 INTERFACE CHANGE: a reflexive trigger that waits for a result of the step (`when.if`, CR 603.12; effects/handlers/lasting.ts#reflexive)
    case 'reflexive': return rec(v['when'])['if'] !== undefined ? ['op:reflexive.if'] : [];
    case 'rollDie': {
      // WP15 INTERFACE CHANGE (review): a results table (CR 706.3a) is run for ONE die rolled by ONE player; for several dice or several players the
      // handler resolves it by hand, so that shape has a value form of its own, never registered.
      const table = Array.isArray(v['table']) && v['table'].length > 0;
      const oneDie = v['count'] === undefined || v['count'] === 1;
      const onePlayer = SINGLE_PLAYER_REFS.has(String(rec(v['who'])['ref']));
      return table && (!oneDie || !onePlayer) ? ['op:rollDie.multiTable'] : [];
    }
    // WP14 INTERFACE CHANGE: the forms of the zone and token ops that the M5 handlers resolve by hand (effects/handlers/zones*.ts, tokens*.ts), so a card that
    // needs one is not classified automated: a move "until" an event (CR 610.3, the delayed return), onto the stack, or face down (CR 708); exchanges other
    // than life totals (CR 701.12); a regeneration shield lasting beyond the turn; a cast with a changed cost.
    case 'move': {
      const to = rec(v['to']);
      return [
        // FAST4 MX1 INTERFACE CHANGE: `op:move.until` is "exile ... until ~ leaves the battlefield" only (CR 610.3; effects/handlers/zones-move.ts#OP_FORMS
        // runs it); any other `until` is `op:move.until.other`, never registered (the handler resolves it by hand)
        ...(v['until'] !== undefined ? [moveUntilForm(v['until'], v['to'])] : []),
        ...(v['remember'] !== undefined ? ['op:move.remember'] : []), // FAST5X E13 (craft, CR 702.167c)
        ...(to['zone'] === 'stack' ? ['op:move.stack'] : []),
        ...(to['faceDown'] === true ? ['layer:1b'] : []),
        ...(typeof to['attacking'] === 'object' && to['attacking'] !== null && 'asReturned' in to['attacking'] ? ['op:move.attackingAsReturned'] : []), // std-typechange-1 (CR 702.49c)
        ...(to['statusIf'] !== undefined ? ['op:move.statusIf'] : []), // std-typechange-2 (CR 608.2c, 508.4)
        ...(to['arrangedBy'] !== undefined ? ['op:move.arrangedBy'] : []), // p2-dig-1 (CR 401.4)
      ];
    }
    case 'exchange':
      return v['what'] !== 'life' ? [`op:exchange.${String(v['what'])}`] : [];
    // CLOUD std-tmt INTERFACE CHANGE (additive): a continuous effect that names the objects it affects (effects/handlers/lasting.ts#EFFECT_OP_FORMS)
    case 'effect':
      return v['as'] !== undefined ? ['op:effect.as'] : [];
    // FAST5 T42 INTERFACE CHANGE (additive): "... cards with different names" (effects/handlers/cards-library.ts#OP_FORMS)
    // std-rx31 INTERFACE CHANGE (additive): a total of mana values as the stop (effects/handlers/actions-native.ts#EXILE_UNTIL_OP_FORMS)
    case 'exileUntil':
      return v['total'] !== undefined ? ['op:exileUntil.total'] : [];
    case 'search':
      return [...(v['differentNames'] === true ? ['op:search.differentNames'] : []), ...(v['shareLandType'] === true ? ['op:search.shareLandType'] : []), // pc-zones-2
        ...(v['alsoZones'] !== undefined ? ['op:search.alsoZones'] : []), // CLOUD std-dft: several zones (CR 701.23a)
        ...(v['allZones'] === true ? ['op:search.allZones'] : []), // r4-refs: every zone listed (CR 701.23a)
        // CLOUD C9 INTERFACE CHANGE (additive): "for a basic land card and a Shrine card" (effects/handlers/cards-library.ts#OP_FORMS)
        ...(v['and'] !== undefined ? ['op:search.and'] : []), ...(v['alsoOutside'] === true ? ['op:search.alsoOutside'] : [])]; // std-rx30: and/or outside the game
    // CLOUD std-dft INTERFACE CHANGE (additive): "If you search your library this way, shuffle" (effects/handlers/cards-library.ts#OP_FORMS)
    case 'fight':
      return v['pairs'] === true ? ['op:fight.pairs'] : []; // p2-damage-2: each of one group fights a different one of another (effects/handlers/lifedamage.ts#OP_FORMS)
    case 'shuffle':
      return v['ifSearched'] === true ? ['op:shuffle.ifSearched'] : [];
    // FAST5 T66 INTERFACE CHANGE (additive): a total over the objects chosen together (effects/handlers/choose.ts#OP_FORMS)
    case 'chooseObjects':
      return [...(v['groupLimit'] !== undefined ? ['op:chooseObjects.groupLimit'] : []), ...(v['perPlayer'] !== undefined ? ['op:chooseObjects.perPlayer'] : []), // C6: perPlayer
        ...(v['perPlayer'] !== undefined && rec(v['who'])['ref'] === 'iterating' ? ['op:chooseObjects.perPlayer.ownChoice'] : []), // r5-refs: each player chooses their own
        ...(v['startingWith'] !== undefined ? ['op:chooseObjects.startingWith'] : []), // std-rx30: each player of a group in turn (CR 101.4)
        ...(v['eachCardType'] === true ? ['op:chooseObjects.eachCardType'] : []), // std-library-3: one of each card type (CR 205.2a)
        ...(v['distinct'] !== undefined ? ['op:chooseObjects.distinct'] : []), // std-library-1: no two chosen with one value of a statistic (CR 208.1)
        // audit-fix-1: "a source of your choice" (CR 609.7a); only of an `each` reference chosen by one chooser (effects/handlers/choose.ts#abilitiesForSources)
        ...(v['damageSource'] === true ? [rec(v['from'])['ref'] === 'each' && v['perPlayer'] === undefined && v['startingWith'] === undefined ? 'op:chooseObjects.damageSource' : 'op:chooseObjects.damageSource.other'] : []),
        ...(v['link'] !== undefined ? ['op:chooseObjects.link'] : [])]; // std-control-1: the chosen object remembered for a linked ability (CR 607.2d)
    // FAST5 T66 INTERFACE CHANGE (additive): "chooses a permanent of each permanent type and sacrifices the rest" (effects/handlers/zones-remove.ts#OP_FORMS)
    // C6 INTERFACE CHANGE (additive): the players who can't (CR 101.3), and the choosing player of a group read in the filter as `{ref:'iterating'}` (CR 608.2e;
    // effects/handlers/zones-remove.ts#asChooser): an engine without it reads nobody there
    case 'sacrificeChoice':
      return [
        ...(v['mode'] === 'keepEachType' ? ['op:sacrificeChoice.keepEachType'] : []),
        ...(v['keepTypes'] !== undefined ? ['op:sacrificeChoice.keepTypes'] : []), // pc-players-1: the types a permanent is kept for
        ...(v['keepFilter'] !== undefined ? ['op:sacrificeChoice.keepFilter'] : []), // pc-players-1: the pool the kept ones are chosen among
        ...(v['chooser'] !== undefined ? ['op:sacrificeChoice.chooser'] : []), // pc-players-1: who chooses for each player
        ...(v['cantAs'] !== undefined ? ['op:sacrificeChoice.cantAs'] : []),
        ...(v['exploit'] === true ? ['op:sacrificeChoice.exploit'] : []), // std-rx17: CR 702.110b
        ...((rec(v['who'])['ref'] === 'each' || rec(v['who'])['ref'] === 'eachWho') && JSON.stringify(v['filter'] ?? null).includes('"ref":"iterating"') ? ['op:sacrificeChoice.groupChooser'] : []),
        ...((rec(v['who'])['ref'] === 'each' || rec(v['who'])['ref'] === 'eachWho') && v['mode'] !== 'all' && JSON.stringify(v['count'] ?? null).includes('"ref":"iterating"') ? ['op:sacrificeChoice.perPlayerCount'] : []), // r5-refs
      ];
    // p2-zone-moves-1 (CR 121.2, 608.2e): "each player discards their hand, then draws that many cards": the count read for each drawing player
    case 'draw':
      return [...(rec(v['who'])['ref'] === 'each' && JSON.stringify(v['count'] ?? null).includes('"ref":"iterating"') ? ['op:draw.perPlayerCount'] : []),
        ...(v['upTo'] === true ? ['op:draw.upTo'] : [])]; // edh-players-1 (CR 121.1, 608.2d)
    case 'discard':
      return [...(v['cantAs'] !== undefined ? ['op:discard.cantAs'] : []), // C6 (CR 101.3)
        ...(rec(v['who'])['ref'] === 'each' && JSON.stringify(v['count'] ?? null).includes('"ref":"iterating"') ? ['op:discard.perPlayerCount'] : [])]; // std-rx30 (CR 608.2e)
    // std-rx30 INTERFACE CHANGE (additive): an amount read for each player of the group (effects/handlers/lifedamage.ts#OP_FORMS)
    case 'gainLife':
    case 'loseLife':
      return rec(v['who'])['ref'] === 'each' && JSON.stringify(v['amount'] ?? null).includes('"ref":"iterating"') ? [`op:${String(v['op'])}.perPlayerAmount`] : [];
    // std-rx24 INTERFACE CHANGE (additive): an exile cost part with a `link` (champion, CR 607.2k, 702.72a): the source remembers the exiled card
    // (effects/handlers/pay.ts#OP_FORMS); an engine without it would never return the card
    case 'pay':
      return [...(JSON.stringify(v['cost'] ?? null).includes('"link":') ? ['op:pay.costLink'] : []), ...(v['upTo'] !== undefined ? ['op:pay.upTo'] : [])]; // std-combat-2: upTo
    // FAST5 MX6 INTERFACE CHANGE (additive): mana that lasts until end of combat (firebending, CR 702.189a; effects/handlers/cards-mana.ts#OP_FORMS)
    case 'addMana':
      // CMD3: "Add {W} or one mana of the chosen color" (effects/handlers/cards-mana.ts#OP_FORMS)
      // std-copy-3 (CR 106.6, 603.2): "When that mana is spent to cast ..." (rules/mana.ts, actions/cast.ts#manaSpentTriggers): fixed mana with no restriction only
      return [...(v['keep'] !== undefined ? [`op:addMana.keep${String(v['keep'])[0]!.toUpperCase()}${String(v['keep']).slice(1)}`] : []), ...(rec(v['dynamic'])['or'] !== undefined ? ['op:addMana.chosenOr'] : []), ...(rec(v['dynamic'])['oneType'] === true ? ['op:addMana.couldProduce.oneType'] : []), // edh-mana-keywords-1
        ...(v['whenSpent'] !== undefined ? [(v['units'] !== undefined || (v['dynamic'] as { kind?: string } | undefined)?.kind === 'commanderIdentity') && v['restriction'] === undefined ? 'feature:mana.whenSpent' : 'feature:mana.whenSpent.other'] : [])];
    // FAST4 T31 INTERFACE CHANGE (additive): "remove up to N counters" (effects/handlers/counters.ts#OP_FORMS)
    case 'removeCounters':
      return v['upTo'] === true ? ['op:removeCounters.upTo'] : [];
    // std-rx26 INTERFACE CHANGE (additive): counters divided among objects chosen as the step resolves (effects/handlers/counters.ts#OP_FORMS)
    case 'putCounters':
      // std-mana-2: "put up to N counters on <one object>" (a target, a bound or event object, or ~; never a group: one number is chosen)
      return v['distribute'] === true ? ['op:putCounters.distribute'] : v['upTo'] === true ? [rec(v['on'])['ref'] === 'each' ? 'op:putCounters.upTo.group' : 'op:putCounters.upTo'] : [];
    // FAST5X E21 INTERFACE CHANGE (additive): "put its counters on <object>", every kind (CR 122.5, 122.8; effects/handlers/counters.ts#OP_FORMS)
    case 'moveCounters':
      // p2-counters-move-1: "move a counter / N counters" with no kind named, and "move any number of counters" (effects/handlers/counters.ts#movePlan)
      return [...(v['kind'] === 'any' ? [v['count'] === 'all' ? 'op:moveCounters.every' : 'op:moveCounters.anyKind'] : []), ...(v['upTo'] === true ? ['op:moveCounters.upTo'] : []),
        ...(v['distribute'] === true ? ['op:moveCounters.distribute'] : [])]; // p2-counters-move-4: onto a group, divided (effects/handlers/counters.ts#moveDistributed)
    case 'regenerate':
      return v['duration'] !== undefined && rec(v['duration'])['d'] !== 'endOfTurn' ? ['op:regenerate.duration'] : [];
    case 'cast': {
      // M6-12: the handler carries out one changed cost, an alternative cost paid instead of the mana cost (`set` with a `cost`: madness, CR 702.35a-b,
      // 118.9); a reduction, an increase or a set mana amount are forms of their own, never registered (resolved by hand)
      const ch = v['costChange'];
      // FAST5X E26: "create a copy of it in exile. You may cast the copy" (CR 707.12, 702.192a); "you may play the exiled card" (a land is played, CR 305.9, 702.75a)
      const copy = [...(v['copyIn'] !== undefined ? ['op:cast.copy'] : []), ...(v['play'] === true ? ['op:cast.play'] : [])];
      const any = [...(v['anyManaType'] === true ? ['op:cast.anyManaType'] : []), ...(v['graveyardInstead'] !== undefined ? ['op:cast.graveyardInstead'] : []), // FAST5X E29: CR 609.4b; r4-repl (effects/handlers/tokens-cast.ts)
        ...(v['maxManaValue'] !== undefined ? ['op:cast.maxManaValue'] : []), // std-rq (CR 601.2, 202.3)
        ...(v['select'] !== undefined ? ['op:cast.select'] : [])]; // std-cardcopy-7 (CR 608.2d)
      if (ch === undefined) return [...copy, ...any];
      const c = rec(ch);
      return [...copy, ...any, ...(c['kind'] === 'set' && c['cost'] !== undefined && c['mana'] === undefined && c['generic'] === undefined ? ['op:cast.costChange'] : [`op:cast.costChange.${String(c['kind'])}`])];
    }
    // WP14 review: a countered spell put onto the battlefield or the stack (Desertion) is resolved by hand (CR 701.6a).
    case 'counter': {
      const zone = rec(v['to'])['zone'];
      // std-rx30 (CR 701.6a, 614.15): a destination for some countered spells only ("if a permanent spell is countered this way")
      return [...(zone === 'battlefield' || zone === 'stack' ? [`op:counter.to.${zone}`] : []), ...(v['toIf'] !== undefined ? ['op:counter.toIf'] : []), ...(v['sourceEffect'] !== undefined ? ['op:counter.sourceEffect'] : [])];
    }
    // WP32 INTERFACE CHANGE: the forms of the native keyword actions (effects/handlers/actions-native.ts) that are resolved by hand, never registered: a vote
    // for words or players (no `subject` standing for objects: the model has no node to read the result, CR 701.38b), discover without its N (CR 701.57a).
    case 'action': {
      if (v['action'] === 'vote') {
        // M12-3 (CR 701.38b): a vote for words (`choices`) or for players (a player-only subject) is run (`feature:vote.words`, `feature:vote.players`); a
        // vote that says neither what nor whom is resolved by hand (`action:vote.words`, never registered)
        if (v['choices'] !== undefined) return v['subject'] === undefined ? ['feature:vote.words'] : ['action:vote.words'];
        const subject = v['subject'] === undefined ? undefined : String(rec(v['subject'])['ref']);
        if (subject === undefined) return ['action:vote.words'];
        const playersOnly = isPlayerOnlyRefKind(subject) /* M12-1: the one table of player-only references (types/ability.ts) */ || (subject === 'each' && rec(v['subject'])['who'] !== undefined);
        return playersOnly ? ['feature:vote.players'] : [];
      }
      if (v['choices'] !== undefined) return ['action:choices.notVote']; // M12-3: only a vote has choices (never registered)
      if (v['action'] === 'discover' && v['n'] === undefined) return ['action:discover.noN'];
      // FAST5X E25: "manifest dread X times" (CR 701.62a; effects/handlers/face-ops.ts#manifestDread)
      // FAST5X E25: "each player manifests dread" (several players at once, CR 101.4) is resolved by hand (effects/handlers/face-ops.ts): never registered
      if (v['action'] === 'manifestDread' && rec(v['who'])['ref'] === 'each' && rec(v['who'])['who'] === 'player') return ['feature:action.manifestDread.eachPlayer'];
      if (v['action'] === 'manifestDread' && v['n'] !== undefined) return ['feature:action.manifestDread.n'];
      // FAST5X E25: "shuffle that pile, then cloak them" (CR 701.58e; any other `arg` of manifest or cloak is resolved by hand)
      if ((v['action'] === 'cloak' || v['action'] === 'manifest') && v['arg'] !== undefined) return [`feature:action.${String(v['action'])}.${String(v['arg'])}`];
      return [];
    }
    default:
      return [];
  }
}

/**
 * WP14 review: the capability a predefined token stands for (CR 111.10). The engine has it when every ability of that token is automated (model/capabilities.ts
 * builds it from effects/predefined-tokens.json, the way a keyword is advertised only when its expansion runs), so "create a Food token" is not classified
 * automated while the Food's own ability is not. The name is lower case with hyphens: `feature:token.young-hero-role`.
 */
export const predefinedTokenCapability = (name: string): string => `feature:token.${name.trim().toLowerCase().replace(/\s+/g, '-')}`;

const PERMANENT_TYPES: ReadonlySet<string> = new Set(['Artifact', 'Creature', 'Enchantment', 'Land', 'Planeswalker', 'Battle']);

/** Could a spell matching this target filter be a permanent spell? (A filter with no type says nothing, so it could.) */
function admitsPermanentSpell(f: Rec): boolean {
  const kind = f['stackKind'];
  if (kind === 'activatedAbility' || kind === 'triggeredAbility' || kind === 'ability') return false;
  if (Array.isArray(f['anyOf'])) return f['anyOf'].some((x) => admitsPermanentSpell(rec(x)));
  if (Array.isArray(f['types'])) return f['types'].some((t) => PERMANENT_TYPES.has(String(t)));
  if (Array.isArray(f['allTypes']) && f['allTypes'].some((t) => t === 'Instant' || t === 'Sorcery')) return false;
  return true;
}

/** The TargetSpec with this id anywhere in the ability that encloses `n` (its own targets or a mode's). */
function targetSpecOf(n: WalkNode, id: string): Rec | null {
  let top: WalkNode = n;
  for (const a of ancestors(n)) {
    top = a;
    if (ABILITY_DEFS.has(a.def)) break;
  }
  let found: Rec | null = null;
  const search = (x: unknown): void => {
    if (found || x === null || typeof x !== 'object') return;
    if (Array.isArray(x)) return x.forEach(search);
    const r = x as Rec;
    if (Array.isArray(r['targets'])) for (const t of r['targets']) if (rec(t)['id'] === id && typeof rec(t)['kind'] === 'string') found = rec(t);
    for (const k of Object.keys(r)) search(r[k]);
  };
  search(top.value);
  return found;
}

/**
 * WP14 review: step forms that depend on where the step is.
 *  - `op:copy.permanentSpell`: a copy of a spell that can be a permanent spell (CR 707.10f: it becomes a token as it resolves, which the M5 build doesn't do, so
 *    the handler resolves it by hand). Decided from the target filter of "copy target ... spell"; a copy of another reference (a storm copy of the spell itself,
 *    a copy of the triggering spell) is decided at run time only. T3 (push wave): "copy that spell" of a cast trigger is decided from the trigger's spell
 *    filters too (Jin-Gitaxias, Progress Tyrant copies artifact spells: never full while the handler resolves that copy by hand).
 *  - `op:changeFace.delayedSelf`: a delayed triggered ability that transforms the permanent it belongs to (CR 701.27f: "if it hasn't transformed since the
 *    delayed triggered ability was created"; the record keeps no creation time yet, so the handler resolves it by hand when the timestamps don't settle it).
 */
function placedForms(n: WalkNode): string[] {
  const v = n.value;
  const what = rec(v['what']);
  if (v['op'] === 'copy' && v['result'] === 'spell' && what['ref'] === 'target') {
    const spec = targetSpecOf(n, String(what['id']));
    if (spec && spec['kind'] !== 'ability' && admitsPermanentSpell(rec(spec['filter']))) return ['op:copy.permanentSpell'];
  }
  if (v['op'] === 'copy' && v['result'] === 'spell' && what['ref'] === 'event' && what['role'] === 'spell') {
    const ability = [...ancestors(n)].find((a) => ABILITY_DEFS.has(a.def));
    const on = ability ? rec(ability.value['trigger'])['on'] : undefined;
    // CR 707.10f: the triggering spell can be a permanent spell when a cast pattern admits one (or the trigger is not a cast pattern the walker can read)
    if (!Array.isArray(on) || on.some((p) => rec(p)['ev'] !== 'cast' || admitsPermanentSpell(rec(rec(p)['spell'])))) return ['op:copy.permanentSpell'];
  }
  if (v['op'] === 'changeFace' && v['to'] === 'transform') {
    let inDelay = false;
    let ability: WalkNode | null = null;
    for (const a of ancestors(n)) {
      if (ABILITY_DEFS.has(a.def)) { ability = a; break; }
      if (a.def === 'EffectStep' && a.value['op'] === 'delay') inDelay = true;
    }
    const ofPermanent = ability === null || ability.def === 'ActivatedAbilityDef' || ability.def === 'TriggeredAbilityDef';
    if (inDelay && (what['ref'] === 'self' || (what['ref'] === 'bound' && ofPermanent))) return ['op:changeFace.delayedSelf'];
  }
  // AF1: "you may discard your hand" with an empty hand is no longer held back (T3 review's op:discard.mayHand): the official ruling on Narset, Jeskai
  // Waymaster (WotC, 2025-04-04) settles it, "You may choose to discard your hand even if your hand contains zero cards.", and
  // effects/handlers/control.ts#cannotStart plays it so ("if you do" is then true; CR 701.9a, 608.2c, 608.2d).
  return [];
}

/** Does the pattern concern the object the ability is on? (design 8.5: `feature:replace.self` vs `feature:replace.foreign`) */
function aboutSelf(p: Rec): boolean {
  switch (p['ev']) {
    case 'zoneChange': return rec(p['subject'])['self'] === true;
    case 'damage': return rec(rec(p['recipient'])['object'])['self'] === true || rec(p['source'])['self'] === true;
    case 'counters': return rec(p['on'])['self'] === true;
    case 'becomes': return rec(p['object'])['self'] === true;
    default: return false;
  }
}

/**
 * The finer names an event pattern, a triggered ability and a delayed trigger's `when` need beyond `ev:<ev>` (triggers/forms.ts, owner WP8: `feature:ev.becomes.
 * targeted`, `feature:ev.action.scry`, `feature:trigger.mana`, ...). The walker may not import the engine (design 5.4), so model/capabilities.ts (the one model
 * module that imports other layers) installs them. INTERFACE CHANGE at the W2 merge: the walker never asked for them, so a pattern no engine event can match
 * ("becomes the target of", ward's trigger) classified as supported once the ops of its effect existed.
 */
export interface EventForms {
  pattern: (p: Rec) => string[];
  trigger: (def: Rec) => string[];
  delayed: (w: Rec) => string[];
}
let eventForms: EventForms | null = null;
export function installEventForms(f: EventForms): void {
  eventForms = f;
}
/** The finer names one event pattern needs (none before model/capabilities.ts installs them). */
export const eventPatternNames = (p: unknown): string[] => eventForms?.pattern(rec(p)) ?? [];

/**
 * M11-0 (m11 design 4.5): does this ability function in the command zone in a way the milestone 5 engine never offered? An activated or triggered ability whose
 * zones include 'command', or a static one that lists 'command' but not the hand or the library (those function everywhere: CR 604.3, evoke).
 */
function functionsFromCommandZone(def: string, zone: unknown): boolean {
  if (!Array.isArray(zone) || !zone.includes('command')) return false;
  if (def === 'ActivatedAbilityDef' || def === 'TriggeredAbilityDef') return true;
  return def === 'StaticAbilityDef' && !zone.includes('hand') && !zone.includes('library');
}
/** FAST5X E18 review fix: a trigger event of the ability names a player who may be someone other than the ability's controller ("a player", "an opponent"). */
function triggerOnOthers(v: Rec): boolean {
  const on = rec(v['trigger'])['on'];
  return Array.isArray(on) && on.some((e) => rec(e)['player'] !== undefined && rec(e)['player'] !== 'you');
}
/** FAST5X E18 review fix: the node uses "each other player" ({ref:'each', who:'otherPlayer'}) anywhere inside it. */
function mentionsEachOtherPlayer(x: unknown): boolean {
  if (Array.isArray(x)) return x.some(mentionsEachOtherPlayer);
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Rec;
  return (r['ref'] === 'each' && r['who'] === 'otherPlayer') || Object.values(r).some(mentionsEachOtherPlayer);
}

function usesOfNode(n: WalkNode, out: CapUse[]): void {
  const v = n.value;
  const add = (cap: string): void => {
    out.push({ cap, path: n.path });
  };
  const addAll = (caps: string[]): void => caps.forEach(add);
  if (typeof v['s'] === 'string' && n.def.endsWith('Def')) add(`static:${v['s']}`);
  if (typeof v['s'] === 'string' && n.def.endsWith('Def') && CAST_STATICS.has(v['s'])) addAll(castStaticForms(n)); // M6-5a
  // FAST4 MX1 INTERFACE CHANGE: an opening-hand action (CR 103.6) names its action; core/pregame.ts runs only "you may begin the game with it on the battlefield"
  // (core/pregame.ts reads the printed abilities of the cards in the opening hands: one stored by a resolving spell or granted is `feature:pregame.lasting|granted`)
  if (v['s'] === 'pregame' && n.def.endsWith('Def')) {
    const where = notPrinted(n);
    addAll([`feature:pregame.${String(v['action'])}`, ...(v['optional'] !== true ? ['feature:pregame.mandatory'] : []), ...(where !== null ? [`feature:pregame.${where}`] : [])]);
  }
  // M11-0 (m11 design 4.5): an ability of a card that functions in the command zone (eminence, CR 113.6; commander ninjutsu, CR 702.49d). Emblems get their
  // zone from core/emblems.ts, never from card data. A static ability that functions in every zone a card can be cast or played from as well (a
  // characteristic-defining ability, CR 604.3: changeling, devoid; evoke's alternative cost) is read there already and needs nothing new.
  if (functionsFromCommandZone(n.def, v['zone'])) add('feature:zone.command');
  switch (n.def) {
    case 'ChapterAbilityDef':
      addAll(['ev:counters', 'feature:chapter']); // CR 714.2: a triggered ability on lore counters
      break;
    case 'ClassLevelDef':
      add('feature:class.level');
      break;
    case 'LevelBracketDef':
      add('feature:leveler.bracket');
      break;
    case 'CaseDef':
      add('feature:case'); // M6-0 (m6 design 2.1, 7): a Case (CR 719.3), expanded by M6-6
      break;
    case 'StaticAbilityDef':
      if (staticAsEntersPT(v)) add('feature:copy.asEntersPT'); // M6-0 (m6 design 3.3)
      if (typeof v['keyword'] === 'string') add(`keyword:${v['keyword']}`); // FAST5X-4 (CR 702.178a): "Max speed -- [Ability]" is the keyword's meaning
      // r5-static (CR 611.3a): the effects while the condition is false are read for continuous effects and restrictions only (statics/live.ts,
      // statics/rule-sources.ts); any other kind, a characteristic-defining one, or one without a condition is a form nothing registers
      if (Array.isArray(v['otherwise'])) {
        add('feature:static.otherwise');
        if (v['condition'] === undefined) add('feature:static.otherwise.unconditional');
        for (const e of v['otherwise'] as unknown[]) {
          const k = rec(e)['s'];
          if (k !== 'continuous' && k !== 'restrict') add(`feature:static.otherwise.${String(k)}`);
          else if (rec(e)['cda'] === true) add('feature:static.otherwise.cda');
        }
      }
      break;
    case 'AdditionalCostDef':
      if (v['choiceGroup'] !== undefined) add('feature:additionalCost.choiceGroup'); // M6-0: CR 601.2b, a choice between grouped costs (M6-5)
      if (v['xMax'] !== undefined) add('feature:additionalCost.xMax'); // r3-cost: the largest X of a mandatory additional cost (CR 107.3, actions/cast.ts#xCap)
      if (v['chooseType'] !== undefined) add('feature:additionalCost.chooseType'); // std-costs-2: a creature type chosen as the cost is announced (CR 601.2b, 607.2d)
      if (v['announceCount'] !== undefined) add('feature:additionalCost.announceCount'); // std-costs-1: the number announced with the optional cost (CR 601.2b)
      break;
    case 'AlternativeCostDef':
      if (v['delay'] !== undefined) add('feature:alternativeCost.delay'); // FAST5X E2: warp's delayed exile (CR 702.185a), actions/cast-kinds.ts
      if (v['instantSpeed'] !== undefined) add('feature:alternativeCost.instantSpeed'); // FAST5X E7: sneak's timing (CR 702.190a)
      if (v['entersAttacking'] !== undefined) add('feature:alternativeCost.entersAttacking'); // FAST5X E7: sneak's tapped and attacking (CR 702.190b)
      // FAST5X E6: mayhem (CR 702.187b), harmonize (CR 702.180a-b), actions/cast-kinds.ts
      for (const f of ['discardedThisTurn', 'tapReduces', 'exileOnLeave']) if (v[f] !== undefined) add(`feature:alternativeCost.${f}`);
      break;
    case 'KeywordAbilityDef':
      add(`keyword:${String(v['keyword'])}`);
      if (v['costChangeIf'] !== undefined) add('feature:keyword.costChange.if'); // pc-statics-1 (CR 601.2f): the condition of the keyword's cost change
      if (v['costChange'] !== undefined) add('feature:keyword.costChange'); // r4-cost (CR 601.2f, 702.6a): keywords/expand.ts gives it to the activated ability
      if (typeof v['quality'] === 'string' && v['quality'].startsWith('chosen:')) add(chosenQualityForm(n, v['quality'])); // MX2
      if (castCostKeywords.has(String(v['keyword'])) && notPrinted(n) !== null) add('feature:castCost.granted'); // M6-5a; M6-12 registers it (actions/cast.ts#withGrantedCosts)
      // FAST5 T56: flashback whose cost is the card's mana cost ("The flashback cost is equal to its mana cost") has its cost parameter
      // cloud r3-mech: mayhem too (CR 702.187b); r5-cost: harmonize and embalm (CR 702.180a, 702.128a, keywords/expand.ts) under `keyword.costIsManaCost`;
      // on any other keyword `costIsManaCost` is a form nothing registers
      const costIsManaCost = v['costIsManaCost'] === true && v['cost'] === undefined && COST_IS_MANA_COST.has(String(v['keyword']));
      if (costIsManaCost) add(v['keyword'] === 'flashback' || v['keyword'] === 'mayhem' ? `feature:keyword.${String(v['keyword'])}.costIsManaCost` : 'feature:keyword.costIsManaCost');
      else if (v['costIsManaCost'] !== undefined) add(`feature:keyword.${String(v['keyword'])}.costIsManaCost`);
      for (const p of keywordParams.get(String(v['keyword'])) ?? []) if (v[p] === undefined && !(p === 'cost' && costIsManaCost)) add(`feature:keyword.missing.${p}`); // M6-12 (see installKeywordParams)
      break;
    case 'ActivatedAbilityDef':
      addAll(activatedForms(v as unknown as ActivatedAbilityDef));
      // FAST5 T67 (CR 114.4, 602.2): an emblem's activated ability would function in the command zone, but core/legal.ts lists the activated abilities of
      // cards there only (emblems are not cards): `feature:emblem.activated` is not registered, so such an emblem ability degrades to manual (never one a
      // player could not activate)
      if (n.parent?.def === 'EffectStep' && n.parent.value['op'] === 'createEmblem') add('feature:emblem.activated');
      // FAST1 T4 (CR 702.177a): a wrapper keyword (`keyword`, "Exhaust -- ...") is the keyword's support (not an announcement form: activatedForms is read there too)
      if (typeof v['keyword'] === 'string') add(`keyword:${v['keyword']}`);
      // WP20 INTERFACE CHANGE: an activated mana ability does not use the stack (CR 605.3b); rules/mana.ts#activateManaAbility resolves it natively and reads
      // only `addMana` steps with `units` (rules/mana-text.ts#manaUnitsOf). Any other step (a pain land's "This land deals 1 damage to you."), a guard or a
      // `dynamic` production would be skipped there: the source would be tapped for nothing. Such a mana ability needs `feature:mana.steps`, which no table
      // advertises, so it degrades to a manual mana ability until mana abilities resolve through the interpreter (the W2 todo of test/m5/cards/pipeline.test.ts).
      // Review fix: the activation restrictions and the cost are checked the same way (nativeManaGaps: feature:mana.activation, feature:mana.cost).
      // FAST2 T7: since WP31 a `dynamic` addMana alone is resolved through the interpreter's handler (see nativeManaEffect), so only the other steps remain.
      if (v['isMana'] === true) addAll(nativeManaGaps(v));
      // FAST5X E27 review (CR 114.4, 113.6): an emblem's activated ability functions in the command zone, but core/legal.ts lists the activations of cards
      // there only (never of an emblem), so it could never be activated. It needs `feature:emblem.activated`, which no table advertises (manual).
      if ([...ancestors(n)].some((a) => a.def === 'EffectStep' && a.value['op'] === 'createEmblem')) add('feature:emblem.activated');
      break;
    case 'TriggeredAbilityDef':
      if (v['limit'] !== undefined) add('feature:trigger.limit');
      if (v['limit'] !== undefined && rec(v['limit'])['action'] === true) add('feature:trigger.limit.action'); // FAST5X E21 (CR 603.2h)
      if (eventForms) addAll(eventForms.trigger(v));
      // FAST5X E18 review fix (CR 603.2, 608.2): in "whenever a player casts ..., each other player draws a card" the others are the players other than the
      // event's player, but effects/refs.ts resolves {ref:'each', who:'otherPlayer'} as the players other than the ability's controller. The two agree only
      // when the event's player is "you"; any other player there is `feature:each.otherPlayer.eventPlayer` (unregistered: fail closed).
      if (triggerOnOthers(v) && mentionsEachOtherPlayer(v['effect'])) add('feature:each.otherPlayer.eventPlayer');
      // p2-c-dieroll-1 (CR 706.2, 603.2c, unverified): "whenever you roll one or more dice, ... equal to the result": the occurrence may be several dice, and which
      // result (one die's or their total) is not modeled: `feature:dieResult.batch` is not registered (fail closed)
      if (rec(v['trigger'])['batch'] === true && JSON.stringify(rec(v['trigger'])['on'] ?? []).includes('"ev":"dieRoll"') && JSON.stringify(v['effect'] ?? {}).includes('"q":"dieResult"')) add('feature:dieResult.batch');
      break;
    case 'DelayedWhen':
      if (eventForms) addAll(eventForms.delayed(v));
      break;
    case 'ManualAbilityDef':
      if (v['reminder'] !== undefined) add('feature:manual.reminder');
      break;
    case 'TriggerDef':
      if (v['batch'] === true) add('feature:trigger.batch');
      if (v['wholeBatch'] === true) add('feature:trigger.batch.whole'); // CLOUD std-misc (CR 603.2c): triggers/collect.ts
      // FAST4 T27 INTERFACE CHANGE: a condition of the trigger event and "for the first time each turn" (triggers/collect.ts; `first` reads the history)
      if (v['while'] !== undefined) add('feature:trigger.while');
      if (v['first'] !== undefined) { add('feature:trigger.first'); add('feature:history'); }
      break;
    case 'EffectStep':
      if (v['op'] === 'manual') {
        if (v['reminder'] !== undefined) add('feature:manual.reminder');
      } else {
        add(`op:${String(v['op'])}`);
        // M11-0 (m11 design 4.5): CR 903.4, 903.4f: the payment solver and the addMana handler must know the identity (M11-1)
        if (v['op'] === 'addMana' && rec(v['dynamic'])['kind'] === 'commanderIdentity') add('feature:mana.commanderIdentity');
        addAll(stepForms(v));
        addAll(placedForms(n));
        if (v['op'] === 'effect' && rec(v['duration'])['d'] === 'throughNextUntap') addAll(throughNextUntapForms(v));
        if (v['op'] === 'action') add(`action:${String(v['action'])}`);
        // cloud r3-mech (CR 400.11b, 712.8a): a card from outside the game is matched on its front face by the fields effects/handlers/outside.ts reads only
        // (OUTSIDE_FILTER_FIELDS, which the walker cannot import, design 5.4); another field is a form nothing registers
        if (v['op'] === 'fromOutside' && !outsideFilterOk(v['filter'])) add('feature:fromOutside.filter');
        if (v['op'] === 'fromOutside' && (v['exactly'] !== undefined || v['differentNames'] !== undefined || v['chooser'] !== undefined)) add('op:fromOutside.chosenAmong'); // std-rx30
        if (v['op'] === 'nextSpell' && !nextSpellFilterOk(v['filter'])) add('feature:nextSpell.filter'); // Standard round 10: only what the spell is (effects/handlers/next-spell.ts)
        if (v['op'] === 'nextSpell' && v['rider'] === 'keyword' && !nextSpellKeywordOk(v['keyword'])) add('feature:nextSpell.keyword'); // std-rx26: only a cost keyword, or cascade / storm (pc-exile-play-3)
        if (v['op'] === 'piles' && v['faceDown'] !== undefined) add('feature:piles.faceDown'); // r5-dig (CR 700.3): a face-down and a face-up pile (cards-reveal.ts#faceDownPiles)
        if (v['op'] === 'delay' && v['batch'] === true) add('feature:delay.batch'); // FAST5 T50: "one or more" / "whenever you attack" in a delayed trigger (triggers/delayed.ts)
        if (v['op'] === 'delay' && Array.isArray(v['targets']) && v['targets'].length > 0) add('feature:delay.targets'); // std-tdm: a delayed trigger's own targets (CR 603.7, 603.3d)
        if (v['op'] === 'chooseValue' && v['what'] === 'cardName') add('decision:chooseName');
        if (v['op'] === 'chooseValue' && v['cardKind'] !== undefined) add('feature:choose.cardKind'); // std-rx28 (CR 201.3)
        if (v['op'] === 'putCounters' || v['op'] === 'moveCounters') addAll(counterForms(v['kind'])); // CR 122.1 (WP21 review)
        if (v['op'] === 'createToken' && v['exceptReplaced'] === true) add('feature:createToken.exceptReplaced'); // pc-tokens-2 (CR 614.5)
        if (v['op'] === 'createToken' && typeof v['attacking'] === 'object' && v['attacking'] !== null) add('feature:createToken.attackingWhom'); // cmd1 (CR 508.4)
      }
      break;
    case 'CounterSpec':
      addAll(counterForms(v['kind'])); // CR 122.6: a token, a destination or an `enters` replacement with counters (WP21 review)
      break;
    case 'Condition':
      if (v['cond'] !== 'ask') add(`cond:${String(v['cond'])}`);
      if (v['cond'] === 'happened') add('feature:history');
      if (v['cond'] === 'wasCast' && v['spent'] !== undefined) add('feature:wasCast.spent'); // FAST5 T37 INTERFACE CHANGE: adamant, "if at least three white mana was spent to cast ~" (CR 601.2h)
      if (v['cond'] === 'did' && v['which'] !== undefined) add('feature:did.which'); // FAST5X E17: "if a creature you controlled was destroyed this way" (CR 608.2h)
      if (v['cond'] === 'did' && v['to'] !== undefined) add('feature:did.which.move'); // FAST5 T75: "if you put a Town card into your hand this way" (CR 608.2c, 608.2h)
      if (v['cond'] === 'wasCast' && v['fromOwner'] !== undefined) add('feature:wasCast.fromOwner'); // Standard round 4, r4-trig INTERFACE CHANGE: "cast from your graveyard" (CR 400.3)
      if (v['cond'] === 'wasCast' && v['by'] !== undefined) add('feature:wasCast.by'); // FAST4 T27 INTERFACE CHANGE: "if you cast it" (the cast record's caster)
      if (v['cond'] === 'wasCast' && v['object'] !== undefined) add('feature:wasCast.object'); // std-tdm INTERFACE CHANGE: "if you cast it" of the object that entered
      // FAST5 T36: the one history reading a restriction's `when` has (statics/hooks.ts#isAttackedHistory): "a creature attacked a player this combat / turn"
      const ev = v['event'] as Record<string, unknown> | undefined;
      const attackedHistory = v['cond'] === 'happened' && ev?.['ev'] === 'attacks' && v['times'] === undefined && v['by'] === undefined && (v['scope'] === 'combat' || v['scope'] === 'turn')
        && Object.keys(ev).every((k) => k === 'ev' || k === 'defender') && (ev['defender'] === 'you' || ev['defender'] === 'opponent' || ev['defender'] === 'any');
      if (v['cond'] !== 'ask' && ruleEffectOf(n)) add(attackedHistory ? 'rcond:happened.attacked' : `rcond:${String(v['cond'])}`);
      if (v['cond'] !== 'ask' && staticallyEvaluated(n)) add(`scond:${String(v['cond'])}`); // WP22 review fix
      break;
    case 'Quantity': {
      if (v['q'] !== 'ask') add(`q:${String(v['q'])}`);
      if (v['q'] === 'happenedCount') add('feature:history');
      if (v['q'] === 'resultCount' && v['which'] !== undefined) add('feature:resultCount.which'); // Cloud C7: "for each creature destroyed this way" (CR 608.2c, 608.2h)
      if (v['q'] === 'resultCount' && v['maxPerOwner'] === true) add('feature:resultCount.maxPerOwner'); // p2-zone-moves-1: "the greatest number of cards a player discarded this way"
      if (v['q'] === 'happenedDistinct') add('feature:history'); // CLOUD std-tmt
      if (v['q'] === 'countPlayers' && v['sizeVs'] !== undefined) add('feature:q.countPlayers.sizeVs'); // FAST5 T53: effects/eval.ts, statics/match.ts
      if (v['q'] === 'countPlayers' && v['lifeVs'] !== undefined) add('feature:q.countPlayers.lifeVs'); // std-lci: effects/eval.ts, statics/match.ts
      if (v['q'] === 'countPlayers' && v['sizeIs'] !== undefined) add('feature:q.countPlayers.sizeIs'); // std-hob: effects/eval.ts, statics/match.ts
      if (v['q'] === 'countPlayers' && v['lifeIs'] !== undefined) add('feature:q.countPlayers.lifeIs'); // r4-static: effects/eval.ts, statics/match.ts
      if (v['q'] === 'life' && v['agg'] !== undefined) add('feature:q.life.agg'); // p2-group-actions-1: effects/eval.ts, statics/match.ts
      if (v['q'] === 'countPlayers' && v['poisonIs'] !== undefined) add('feature:q.countPlayers.poisonIs'); // std-rx24: effects/eval.ts, statics/match.ts
      if (v['q'] === 'lifeLost' && v['who'] !== undefined) add('feature:lifeLost.who'); // cloud std-spm: the life one player lost this way (effects/eval.ts)
      if (v['q'] === 'countPlayers' && v['controlsVs'] !== undefined) add('feature:q.countPlayers.controlsVs'); // std-sos review: effects/eval.ts, statics/match.ts
      if (v['q'] === 'countPlayers' && v['controlsIs'] !== undefined) add('feature:q.countPlayers.controlsIs'); // std-rx12: effects/eval.ts, statics/match.ts
      if (v['q'] === 'countPlayers' && v['didNot'] !== undefined) add('feature:q.countPlayers.didNot'); // r5-fxz: effects/eval.ts
      if (v['q'] === 'countPlayers' && v['lostLifeThisTurn'] !== undefined) add('feature:q.countPlayers.lostLife'); // std-mkm: effects/eval.ts, statics/match.ts
      if (v['q'] === 'countPlayers' && v['lostLifeIs'] !== undefined) add('feature:q.countPlayers.lostLifeIs'); // Standard round P: effects/eval.ts, statics/match.ts
      if (v['q'] === 'countPlayers' && v['speedVs'] !== undefined) add('feature:q.countPlayers.speedVs'); // std-control-1: effects/eval.ts, statics/match.ts
      if (v['q'] === 'distinct' && v['what'] === 'powers') add('feature:q.distinct.powers'); // CLOUD std-misc: effects/eval.ts, statics/match.ts
      if (v['q'] === 'distinct' && v['what'] === 'colorPairs') add('feature:q.distinct.colorPairs'); // r4-mech: effects/eval.ts, statics/match.ts
      if (v['q'] === 'distinct' && v['what'] === 'permanentTypes') add('feature:q.distinct.permanentTypes'); // r4-cost: effects/eval.ts, statics/match.ts
      if (v['q'] === 'distinct' && v['what'] === 'counterKinds') add('feature:q.distinct.counterKinds'); // r4-static: effects/eval.ts, statics/match.ts
      if (v['q'] === 'distinct' && v['what'] === 'planeswalkerTypes') add('feature:q.distinct.planeswalkerTypes'); // r5-fxb: effects/eval.ts, statics/match.ts
      // CMD2 INTERFACE CHANGE: another player's commander casts (effects/eval.ts); statics/match.ts does not read `of` (fail closed there)
      // (one player only: the step reads the count once, so "each player draws ... for each time they've cast" would need it per player: `.each`, never registered)
      if (v['q'] === 'commanderCasts' && v['of'] !== undefined) add(staticallyEvaluated(n) || ruleEffectOf(n) ? 'feature:q.commanderCasts.of.static' : rec(v['of'])['ref'] === 'each' ? 'feature:q.commanderCasts.of.each' : 'feature:q.commanderCasts.of');
      // FAST4 T21 INTERFACE CHANGE: only the spell's targets that match a filter (statics/costmods.ts#filteredTargetCount); an engine without it counts them all
      if (v['q'] === 'spellTargetCount' && v['filter'] !== undefined) add('feature:spellTargetCount.filter');
      // FAST5X E19 INTERFACE CHANGE: the spell "N mana was spent to cast" names (effects/eval.ts#spellManaSpent): the triggering cast event's spell or ~ itself
      if (v['q'] === 'spellManaSpent' && v['of'] !== undefined) {
        const of = rec(v['of']);
        add(`feature:spellManaSpent.of.${of['ref'] === 'event' && of['role'] === 'spell' ? 'event' : of['ref'] === 'self' ? 'self' : of['ref'] === 'target' ? 'target' : 'other'}`); // r4-fxb: a target spell
      }
      // FAST5X E19: "mana from a Treasure" (CR 106.3): a filter of one subtype is read (effects/eval.ts#manaFromSubtype), any other is not
      if (v['q'] === 'spellManaSpent' && v['from'] !== undefined) {
        const f = rec(v['from']);
        const subs = f['subtypes'];
        add(`feature:spellManaSpent.from.${Object.keys(f).length === 1 && Array.isArray(subs) && subs.length === 1 ? 'subtype' : 'other'}`);
      }
      const r = v['q'] !== 'ask' ? ruleEffectOf(n) : null;
      if (r) add(`rq:${r.costAmount ? 'cost.' : ''}${String(v['q'])}`);
      // r4-cost (CR 601.2c, 601.2f): the targets of an ACTIVATED ability in its cost change (or in a modifier of other abilities' costs) are read by
      // statics/costmods.ts with the targets actions/activate.ts announced (`CostModHit.targets`), a capability of its own
      if (r?.costAmount === true && v['q'] === 'spellTargetCount' && abilityCost(n)) add('feature:cost.abilityTargets');
      if (v['q'] !== 'ask' && staticallyEvaluated(n)) add(`sq:${String(v['q'])}`); // WP22 review fix
      break;
    }
    case 'ObjRef':
    case 'PlayerRef':
      add(`ref:${String(v['ref'])}`);
      // r4-cost (CR 601.2c, 601.2f): "the creature it targets" in an activated ability's cost change: its announced target (statics/costmods.ts#targetObjects)
      if (n.def === 'ObjRef' && v['ref'] === 'target' && ruleEffectOf(n)?.costAmount === true) add(abilityCost(n) ? 'feature:cost.abilityTargets' : 'feature:cost.targetRef');
      // C6: "each player who controls the most ..." is resolved by the effect resolver only (effects/refs.ts); a static or a rule effect reads it as nobody
      if (v['ref'] === 'controlsMost' && (staticallyEvaluated(n) || ruleEffectOf(n))) add('feature:player.controlsMost.static');
      if (n.def === 'ObjRef' && staticallyEvaluated(n)) add(`sref:${String(v['ref'])}`); // WP22 review fix
      // audit-fix-1 (CR 608.2h, 400.7): only the bound objects that matched `which` as they were moved (effects/refs.ts#resolveObjs)
      if (n.def === 'ObjRef' && v['ref'] === 'bound' && v['which'] !== undefined) add('feature:ref.bound.which');
      break;
    case 'Duration':
      // the lifetime of a manual shield's chip belongs to feature:manual.reminder, not to the duration evaluators
      if (n.slot !== 'reminder') add(`dur:${String(v['d'])}`);
      // FAST5X E29 (CR 611.2b, 400.7): "for as long as it remains exiled" is read off the objects the effect's permissions name (core/durations.ts)
      if (v['d'] === 'remainsExiled' && !(n.slot === 'duration' && n.parent !== null && objectPermitsOnly(n.parent.value))) add('feature:remainsExiled.other');
      // std-control-1 (CR 500.7, 611.2a): "during that turn" keeps a resolved restriction dormant until the next turn (statics/rule-sources.ts#durationActive)
      if (v['d'] === 'duringNextTurn' && !(n.slot === 'duration' && n.parent !== null && restrictionsOnly(n.parent.value))) add('feature:duringNextTurn.other');
      break;
    case 'EventPattern': {
      // M6-0 (m6 design D2): a replacement's `replaces` pattern is matched against the proposal pipeline's events, not the engine's emitted ones: it needs
      // `feature:replace.on.<ev>[.<verb>]` (the kinds the pipeline proposes and translates), not `ev:<ev>` (the kinds the engine emits; `phase` never is).
      const replaces = n.slot === 'replaces' && n.parent?.def === 'ReplacementDef';
      add(replaces ? replaceOnName(v) : `ev:${String(v['ev'])}`);
      // Cloud r3-repl: a replaced mill or connive is its proposal (feature:replace.on.action.mill / .connive), not the trigger event form `feature:ev.action.<verb>`
      if (eventForms && !(replaces && v['ev'] === 'action' && (v['verb'] === 'mill' || v['verb'] === 'connive' || v['verb'] === 'draw' || v['verb'] === 'explore' || v['verb'] === 'payLife' /* std-library-4 */ || v['verb'] === 'proliferate' /* p2-replace-events-2 */ || v['verb'] === 'scry' /* p2-replace-events-3 */))) addAll(eventForms.pattern(v).filter((f) => !(replaces && f === 'feature:ev.beginTurn.extra')));
      // p2-replace-events-3 (CR 500.7, 614.10): "if a player would begin an extra turn" is compared by the replacement matcher (the turn proposal knows it, triggers/match.ts#beginTurn); a trigger's event never does
      if (replaces && v['ev'] === 'beginTurn' && v['extra'] !== undefined) add('feature:replace.beginTurn.extra');
      // M6-5a (m6 design D12): a move's cause is compared by the replacement matcher (effects/replacements.ts#matchProposed: buyback's "as it resolves",
      // CR 608.2n, 702.27a), never by the trigger matcher, so anywhere but a replacement's `replaces` it is `feature:ev.cause` (unregistered, fail closed).
      // Standard round 3, r3-trig: the one cause the trigger matcher compares, craft's materials (CR 702.167a; triggers/match.ts)
      if (v['ev'] === 'zoneChange' && v['cause'] !== undefined) add(replaces ? 'feature:replace.cause' : v['cause'] === 'craft' ? 'feature:ev.cause.craft' : 'feature:ev.cause');
      // M6-0 (CR 614.16): "if an EFFECT would put counters / create tokens" compares the proposal's cause (M6-1); the trigger matcher never does (fail closed)
      if (v['byEffect'] === true) add(replaces ? 'feature:replace.byEffect' : 'feature:ev.byEffect');
      if (v['byOpponent'] === true) add(replaces ? 'feature:replace.byOpponent' : 'feature:ev.byOpponent'); // FAST5 T36 (CR 701.9a)
      // Cloud r3-repl (CR 111.1): "if one or more creature tokens would be created" reads the token's definition (effects/replacements.ts#tokenDefMatches)
      if (replaces && v['ev'] === 'createToken' && v['token'] !== undefined) add('feature:replace.createToken.token');
      // Cloud r5-repl (CR 504.1): "except the first one you draw in each of your draw steps" is compared by the replacement matcher only (fail closed elsewhere)
      if (v['ev'] === 'draw' && v['exceptFirstInDrawStep'] !== undefined) add(replaces ? 'feature:replace.draw.exceptFirstInDrawStep' : 'feature:ev.draw.exceptFirstInDrawStep');
      // FAST4 T33 (CR 603.10a, 700.9, 301.5): an object leaving the battlefield is judged as it last existed, but last known information does not record what was
      // attached to it, so "a modified / equipped creature dies" would read the attachments left after the event (an Aura destroyed with it would be missed):
      // `feature:lookback.attachments`, never registered (fail closed). r5-fxb: registered (triggers/match.ts#FEATURES): the last known information records it
      // (LastKnown.attached, core/zones.ts#moveObject; rules/filter.ts reads it)
      if (v['ev'] === 'zoneChange' && (v['from'] === undefined || ([] as unknown[]).concat(v['from']).includes('battlefield'))
        && /"(modified|equipped)":/.test(JSON.stringify(v['subject'] ?? {}))) add('feature:lookback.attachments');
      break;
    }
    case 'ObjectFilter':
      for (const k of Object.keys(v)) if (v[k] !== undefined) add(`filter:${k}`);
      for (const k of Object.keys(v)) if (v[k] !== undefined && HISTORY_FILTERS.has(k)) add('feature:history');
      if (ruleEffectOf(n)) {
        // std-rx27 (CR 400.7): "exiled with ~ this turn" in a linked cast permission is judged on the card where it is (statics/play-permits.ts#linkedOf), not by
        // the rule hooks' filter evaluator: its capability is `feature:permit.cast.linked.thisTurn` (linkedRiderFeatures)
        const linkedThisTurn = n.slot === 'of' && n.parent?.def === 'PermissionDef' && linkedRiderFeatures(n.parent.value) !== null;
        for (const k of Object.keys(v)) {
          if (v[k] === undefined || (linkedThisTurn && k === 'putThereThisTurn')) continue;
          // FAST4 T21 INTERFACE CHANGE: "spells ... that target ~" in a cost modifier's spell filter is read by statics/costmods.ts#spellTargetsSource (the
          // spell's chosen targets, CR 601.2c, 601.2f), not by the rule hooks' filter evaluator, so it is a capability of its own (only `{ref:'self'}` is wired)
          const costModTargets = k === 'targets' && n.slot === 'spells' && n.parent?.def === 'CostModDef.applies';
          add(costModTargets ? `feature:costMod.spellTargets.${String(rec(v[k])['ref'])}` : `rfilter:${k}`);
        }
      }
      if (staticallyEvaluated(n)) for (const k of Object.keys(v)) if (v[k] !== undefined) add(`sfilter:${k}`); // WP22 review fix
      // Cloud C3 (batch 3): the layer system (and a static ability's own condition) evaluates its filters before any rule effect exists, so a "goaded" there
      // would miss a static goad ("enchanted creature is goaded", CR 701.15a-c, 613.10-613.11): `feature:sfilter.goaded`, never registered (fail closed; no card has one)
      if (staticallyEvaluated(n) && v['goaded'] !== undefined) add('feature:sfilter.goaded');
      addAll(filterForms(v as ObjectFilter));
      // T3 review INTERFACE CHANGE (CR 702.35a, Anje Falkenrath): a filter that reads a keyword ("if it has madness") is right only when the engine puts that
      // keyword on objects (rules/characteristics.ts#hasKeyword compares registry names); a keyword it does not run is a manual ability, never in the
      // characteristics, so the filter needs that keyword's capability too.
      for (const k of ['keyword', 'notKeyword']) for (const kw of ([] as unknown[]).concat(v[k] ?? [])) add(`keyword:${String(kw).toLowerCase()}`);
      break;
    case 'TargetSpec':
      add(`target:${String(v['kind'])}`);
      addAll(targetSpecForms(reflexiveBakedCounts(n)));
      if (v['divide'] !== undefined) add('decision:chooseDivision');
      break;
    case 'ModeSpec':
      addAll(modeSpecForms(reflexiveBakedModes(n)));
      break;
    case 'CostPart':
      if (v['kind'] !== 'manual') {
        add(`cost:${String(v['kind'])}`);
        // FAST5X E27 (CR 608.2h, 702.21a): a cost paid as an effect resolves (a `pay` step, or ward's cost, which its trigger pays) has its computed amounts
        // read then (effects/handlers/pay.ts#fixedCost), so "pay life equal to ~'s power" is no unread computed count there
        const forms = costPartForms(v as unknown as CostPart);
        // pc-statics-2 (CR 118.3, 602.2b, 903.4): an activated ability's life payment of "the number of colors in your commanders' color identity" is worked out when
        // the cost is determined (actions/activate.ts#abilityPlan); on a mana ability or a spell's cost it stays unread
        const identityLife = v['kind'] === 'payLife' && rec(v['amount'])['q'] === 'commanderIdentitySize' && n.parent?.def === 'CostDef' && n.parent.parent?.def === 'ActivatedAbilityDef' && n.parent.parent.value['isMana'] !== true;
        addAll(paidOnResolution(n) || identityLife ? forms.filter((f) => f !== 'cost:count.quantity') : forms);
        if (v['kind'] === 'putCounters') addAll(counterForms(v['counter'])); // CR 122.1 (WP21 review)
        // FAST5X E10: a keyword action that exists only as a cost (waterbend, CR 701.67a: "pay [cost]") is paid by rules/cost.ts and has no macro
        if (v['kind'] === 'action' && !COST_ONLY_ACTIONS.has(String(v['action']))) add(`action:${String(v['action'])}`);
        // std-rx27 (CR 607.2a): a collect evidence cost whose exiled cards an activated ability's source remembers (rules/pay-parts.ts, actions/activate.ts); any other
        // linked action is a form nothing registers
        if (v['kind'] === 'action' && v['link'] !== undefined) add(v['action'] === 'collectEvidence' && n.parent?.parent?.value['kind'] === 'activated' ? 'feature:cost.collectEvidence.link' : `feature:cost.${String(v['action'])}.link`);
      }
      break;
    case 'Modification':
      add(`layer:${String(v['layer'])}`);
      // W3b audit (Mind Harness, Act of Treason): a control-changing effect (layer 2, CR 613.1b) needs the call-sites (attackers and blockers, activations, the
      // untap step, the legend rule) to see the new controller (CR 108.4, 508.1a, 602.2, 502.3). MX2 registers it: the stored controller IS the controller
      // after layer 2 (core/control.ts).
      if (String(v['layer']) === '2') add('feature:control.layered');
      if (String(v['layer']) === '6' && v['addActivatedOf'] !== undefined) add('feature:layer6.addActivatedOf'); // r5-static: statics/mods.ts#activatedOf (CR 613.1f)
      if (String(v['layer']) === '6' && v['activatedOfLimit'] !== undefined) add('feature:layer6.addActivatedOf.limit'); // std-craft-2: statics/mods.ts#limitedEachTurn (CR 602.5b)
      if (String(v['layer']) === '6' && v['alsoTriggered'] !== undefined) add('feature:layer6.addActivatedOf.triggered'); // std-cardcopy-9: statics/mods.ts#activatedOf (CR 613.1f)
      // MX2 (CR 707.9a): "except it has this ability" runs in a resolved copy effect only (effects/handlers/lasting.ts); elsewhere a name never registered
      if (String(v['layer']) === '1a' && v['choose'] !== undefined) add('feature:copy.choose'); // FAST5 T64: effects/copy.ts picks one object of the set
      if (String(v['layer']) === '1a' && Array.isArray(v['except']) && (v['except'] as unknown[]).some((x) => typeof x === 'object' && x !== null && 'thisAbility' in x)) {
        // p2-copy-perm-1 (CR 707.9a, 603.12): inside a reflexive trigger ("When you do, ~ becomes a copy of ..., except it has this ability") "this ability" is the
        // printed ability, while the ability resolving is the reflexive one (effects/handlers/lasting.ts stores that one): not automated
        const inReflexive = [...ancestors(n)].some((a) => a.def === 'EffectStep' && a.value['op'] === 'reflexive');
        add(notPrinted(n) === 'lasting' && !inReflexive ? 'feature:copy.thisAbility' : 'feature:copy.thisAbility.other');
      }
      break;
    case 'ContinuousEffectDef': {
      // dependency (CR 613.8a) applies within every layer and sublayer, 7a to 7d included (design 9.3)
      add('feature:dependency');
      // std-ry5 (CR 613.1f, 113.6): an effect that removes the abilities of cards outside the battlefield ("Cards in graveyards lose all abilities"): the layer
      // system computes it, but the actions read some of those abilities from the card's definition (actions/cast-options.ts: flashback and the other
      // alternative costs), so a card in a graveyard would keep them. Not registered (fail closed).
      const aff = rec(v['affects']);
      const zone = aff['ref'] === 'each' ? rec(aff['filter'])['zone'] : undefined;
      const offBattlefield = zone !== undefined && [zone].flat().some((z) => z !== 'battlefield');
      const mods = Array.isArray(v['mods']) ? (v['mods'] as unknown[]).map(rec) : [];
      if (offBattlefield && mods.some((m) => m['removeAll'] !== undefined || m['remove'] !== undefined)) add('feature:layer6.loseAbilities.offBattlefield');
      break;
    }
    case 'RestrictionDef':
      add(`rule:${String(v['action'])}`);
      add(`restrict:${String(v['mode'])}`);
      // FAST4 T24 INTERFACE CHANGE (additive): a limit on casting spells with no `other` ("each player can't cast more than one spell each turn") is
      // `feature:restrict.max.cast`, which statics/hooks.ts registers (the count is the player's spells cast this turn, CR 601.2i); every other limit (another
      // action, or "more than one noncreature spell", whose count the engine does not keep) stays `feature:restrict.max`, never registered.
      // MX5 (additive): "~ can't be blocked by more than one creature" is `feature:restrict.max.beBlocked` (statics/hooks.ts#blockSetValid, CR 509.1b)
      if (v['max'] !== undefined) {
        const plainLimit = v['mode'] === 'cant' && v['other'] === undefined && typeof v['max'] === 'number';
        // r5-static: "No more than one creature can attack (you / this planeswalker) / block each combat" (statics/hooks.ts#declarationLimits, CR 508.1c, 509.1b)
        const declLimit = v['mode'] === 'cant' && typeof v['max'] === 'number' && (v['action'] === 'attack' || v['action'] === 'attackPlayer' || v['action'] === 'block')
          && ['alone', 'min', 'goad', 'exceptMana'].every((k) => v[k] === undefined) && (v['action'] !== 'block' || v['other'] === undefined);
        // p2-player-rules-1 (CR 601.2i): a cast limit of a kind of spell ("more than one noncreature spell") names each field of its `other`, which
        // statics/hooks.ts registers for the fields the turn's cast history can answer (CAST_KIND_LIMIT_FIELDS)
        const kindLimit = v['mode'] === 'cant' && v['action'] === 'cast' && typeof v['max'] === 'number' && v['other'] !== undefined && typeof v['other'] === 'object'
          && ['alone', 'min', 'goad', 'exceptMana', 'otherPlayer', 'abilityKeyword'].every((k) => v[k] === undefined);
        if (kindLimit) {
          add('feature:restrict.max.cast.other');
          for (const k of Object.keys(rec(v['other']))) add(`feature:restrict.max.cast.other.${k}`);
        } else add(declLimit ? `feature:restrict.max.${String(v['action'])}` : plainLimit && (v['action'] === 'cast' || v['action'] === 'beBlocked' || v['action'] === 'draw' /* p2-player-rules-1 (CR 121.1) */) ? `feature:restrict.max.${String(v['action'])}` : 'feature:restrict.max');
      }
      // FAST5 T57 INTERFACE CHANGE (additive): "~ can't be blocked except by three or more creatures" (CR 509.1b) is `feature:restrict.min.beBlocked`
      // (statics/hooks.ts#blockSetValid): a `cant` beBlocked restriction with a numeric `min` and no `other`; every other `min` is `feature:restrict.min`, never registered
      if (v['min'] !== undefined) {
        const plainMin = v['mode'] === 'cant' && v['other'] === undefined && v['action'] === 'beBlocked' && typeof v['min'] === 'number';
        add(plainMin ? 'feature:restrict.min.beBlocked' : 'feature:restrict.min');
      }
      if (v['when'] !== undefined) add('feature:restrict.when');
      // WP31 INTERFACE CHANGE (review): `other` is honored only where the call-site of the action names the other object (statics/hooks.ts#OTHER_ACTIONS).
      // R1 INTERFACE CHANGE (M6-7a): a requirement (`mustIfAble`) is enforced by the declare steps (rules/requirements.ts) for the combat actions only, and
      // without `other` (the other-creature forms are M6-7): those forms have names of their own, so `feature:restrict.other.*` of the "can't" effects
      // does not make them automated.
      if (v['mode'] === 'mustIfAble') {
        if (!['attack', 'block', 'beBlocked'].includes(String(v['action']))) add(`feature:require.${String(v['action'])}`);
        if (v['other'] !== undefined) add(`feature:require.other.${String(v['action'])}`);
        if (v['otherPlayer'] !== undefined) add(`feature:require.player.${String(v['action'])}`); // M6-12: "attacks that opponent" (CR 702.141a)
      } else if (v['other'] !== undefined) add(`feature:restrict.other.${String(v['action'])}`);
      // std-rx21 (CR 608.2h, 611.2c, 400.7): a resolved restriction whose `other` compares with an object of the resolution ("can't cast spells with the same name
      // as that creature", after the creature left the battlefield): effects/handlers/lasting-fix.ts fixes the reference to the objects still where they were,
      // so a moved object names nothing and the restriction would never apply. Never registered (fail closed) until the name is read from last known information.
      if (v['other'] !== undefined && notPrinted(n) === 'lasting' && JSON.stringify((v['other'] as Record<string, unknown>)['sharesWith'] ?? null).includes('"ref":')) {
        add('feature:restrict.other.lastingSharesWith');
      }
      if (v['mode'] !== 'mustIfAble' && v['otherPlayer'] !== undefined) add(`feature:restrict.otherPlayer.${String(v['action'])}`); // M6-12; FAST4 T33: attackPlayer
      if (v['alone'] !== undefined) add(`feature:restrict.alone.${String(v['action'])}`); // FAST5 T37 INTERFACE CHANGE: "can't attack alone" (statics/hooks.ts#cantActAlone)
      if (v['exceptMana'] !== undefined) add(`feature:restrict.exceptMana.${String(v['action'])}`); // FAST4 T33: registered for activate only (statics/hooks.ts)
      if (v['abilityKeyword'] !== undefined) add(`feature:restrict.abilityKeyword.${String(v['action'])}`); // std-control-1: registered for activate only (statics/hooks.ts)
      if (v['fromZones'] !== undefined) add(`feature:restrict.fromZones.${String(v['action'])}`); // p2-graveyard-2: registered for castFromZone only (statics/hooks.ts)
      // Cloud C3 (batch 3) INTERFACE CHANGE (additive): a static goad ("enchanted creature is goaded", CR 701.15a-c) is `feature:require.goad` in its one form (an
      // attack requirement with nothing else: statics/requirements.ts#goadHits, statics/rule-sources.ts#staticGoaders); any other is `feature:require.goad.form`, never registered
      if (v['goad'] !== undefined) {
        const plainGoad = v['goad'] === true && v['mode'] === 'mustIfAble' && v['action'] === 'attack'
          && ['other', 'otherPlayer', 'max', 'min', 'alone', 'exceptMana'].every((k) => v[k] === undefined);
        add(plainGoad ? 'feature:require.goad' : 'feature:require.goad.form');
      }
      break;
    case 'TriggerModDef': {
      // M6-12 (CR 603.2d): the collector (triggers/collect.ts#timesTriggered) counts the extra triggers of the abilities of permanents on the battlefield for a
      // cause matched without looking back. Reviewed and registered: a permanent ENTERING (`feature:triggerMod.enters`, Panharmonicon) with a fixed number.
      // Every other cause (dying, which looks back at abilities of permanents that left with the creature, CR 603.10a; attacking, damage, life, casting
      // and the rest) and a computed number (skipped by the collector) are forms of their own, never registered (fail closed)
      // FAST5 T40: no cause at all is "whatever event triggers it" (`feature:triggerMod.any`, triggers/collect.ts)
      const cause = rec(v['cause']);
      const enters = cause['ev'] === 'zoneChange' && cause['to'] === 'battlefield' && cause['from'] === undefined;
      // std-rx2 (CR 508.1m, 603.2d): a creature ATTACKING (`feature:triggerMod.attacks`, Isshin, Two Heavens as One): an `attacks` event with only an attacker filter,
      // matched without looking back like entering (the attacker is on the battlefield as attackers are declared); any other attack cause (a defender, alone, a count)
      // keeps `feature:triggerMod.cause.attacks`, never registered
      const attacks = cause['ev'] === 'attacks' && Object.keys(cause).length === 2 && cause['attacker'] !== undefined;
      // std-typechange-2 (CR 603.10a, 603.2d): a creature DYING (`feature:triggerMod.dies`, The Masamune, Teysa Karlov): a zone change from the battlefield to a graveyard
      // with only a subject filter, judged looking back (types/ability.ts#diesCause, triggers/collect.ts#timesTriggered); a suppression of it is still unread
      const dies = v['suppress'] !== true && diesCause(v['cause'] as EventPattern | undefined);
      // p2-misc-1 (CR 603.10a, 603.2): "Creatures dying don't cause abilities to trigger" (Hushbringer), every ability, judged looking back (triggers/collect.ts#suppressed)
      const diesSuppress = v['suppress'] === true && diesCause(v['cause'] as EventPattern | undefined) && Object.keys(rec(v['abilitiesOf'])).length === 0 && v['keyword'] === undefined;
      // trek-2 (CR 603.2d, 119.9): YOU GAINING LIFE (`feature:triggerMod.lifeGain`, Dr. Beverly Crusher): a `life` gain event of the mod's controller and nothing else,
      // matched without looking back (no object leaves with it); a gain of another player, a loss or an amount keeps `feature:triggerMod.cause.life`, never registered
      const lifeGain = v['suppress'] !== true && isLifeGainCause(v['cause'] as EventPattern | undefined);
      add(v['cause'] === undefined ? 'feature:triggerMod.any' : enters ? 'feature:triggerMod.enters' : attacks ? 'feature:triggerMod.attacks' : dies ? 'feature:triggerMod.dies' : diesSuppress ? 'feature:triggerMod.suppress.dies' : lifeGain ? 'feature:triggerMod.lifeGain' : `feature:triggerMod.cause.${String(cause['ev'])}`);
      if (typeof v['additional'] !== 'number') add('feature:triggerMod.computed');
      // CLOUD std-misc: "<permanents> entering don't cause abilities to trigger" (triggers/collect.ts#suppressed): a permanent entering, every ability; any other form is unread
      // std-rx32: a keyword's abilities silenced with no cause ("Ward abilities of those creatures don't trigger", triggers/collect.ts#silencedKeywords)
      const silencesKeyword = typeof v['keyword'] === 'string' && v['cause'] === undefined && v['additional'] === 0;
      if (v['keyword'] !== undefined && v['suppress'] !== true) add('feature:triggerMod.keyword.other'); // a keyword's abilities triggering an additional time: unread
      if (v['suppress'] === true) add(silencesKeyword ? 'feature:triggerMod.suppress.keyword' : enters && Object.keys(rec(v['abilitiesOf'])).length === 0 && v['keyword'] === undefined ? 'feature:triggerMod.suppress.enters' : diesSuppress ? 'feature:triggerMod.suppress.dies' : 'feature:triggerMod.suppress.other');
      // the collector reads the static abilities of permanents (triggers/collect.ts#triggerMods), never a record stored by a resolving spell
      if (notPrinted(n) === 'lasting') add('feature:triggerMod.lasting');
      break;
    }
    case 'PermissionDef': {
      // std-freecast-5 INTERFACE CHANGE (additive): a static top-card plot permission statics/play-permits.ts#isTopPlotPermit honors is `permit:plot.top` (CR 702.170f);
      // any other plot permission (a resolved one included) is `permit:plot`, which nothing registers
      if (v['action'] === 'plot') {
        add(isTopPlotPermitJson(v) && notPrinted(n) !== 'lasting' ? 'permit:plot.top' : 'permit:plot');
        break;
      }
      // FAST4 T31 INTERFACE CHANGE (additive): a play or cast permission made by a resolving effect for exactly the objects it names ("you may play that card
      // this turn": `of` is `{is}` alone, statics/play-permits.ts) is `permit:<action>.object`; any other play or cast permission keeps `permit:<action>` and
      // `feature:permit.<action>.of`, which nothing registers
      const playCast = v['action'] === 'play' || v['action'] === 'cast';
      const ofObject = playCast && notPrinted(n) === 'lasting' && v['fromTop'] === undefined && Object.keys(rec(v['of'])).length === 1 && rec(v['of'])['is'] !== undefined;
      // FAST5X E14 INTERFACE CHANGE (additive): a play or cast permission for the top card of a library is `permit:<action>.top` (its `of` is the qualities of
      // the card, statics/play-permits.ts#topPermitFor, CR 601.3e); `fromTop` on any other action is a form nothing registers
      const top = playCast && v['fromTop'] === true;
      // FAST5X E25 (CR 708.5, 609.4): "you may look at face-down creatures ... any time": `lookAt` with an `of` that says `faceDown: true` (statics/play-permits.ts#isFaceDownLook)
      const faceDownLook = v['action'] === 'lookAt' && rec(v['of'])['faceDown'] === true;
      // GY1 INTERFACE CHANGE (additive): exactly "You may play lands from your graveyard" as a static ability (statics/play-permits.ts#isGraveyardLandPermit,
      // CR 305.1, 116.2a, 404.1) is `permit:play.zone`, and its `of` and `from` are part of that form; any other `from` keeps `feature:permit.<action>.from`
      // CLOUD std-fdn (CR 609.4b): "You can spend mana of any type to cast creature spells" as a static ability: `spendMana` with `asThough` 'any type' and an
      // `of` and nothing else (statics/play-permits.ts#isSpendAnyTypePermit) is `permit:spendMana.anyTypeFor`; its `of` and `asThough` are part of that form
      // r3-cost INTERFACE CHANGE (additive): an alternative cost a STATIC ability gives other spells ("You may pay {W}{U}{B}{R}{G} rather than pay the mana cost
      // for spells you cast", "You may cast spells from your hand without paying their mana costs", CR 118.9, 601.2b; statics/play-permits.ts#isAltCostPermit)
      // is `permit:cast.alternative`, its `of`, `costChange` and `oncePerTurn` part of that form; a resolved effect with it is a form nothing registers
      if (isAltCostPermitJson(v)) {
        add(notPrinted(n) === 'lasting' ? 'feature:permit.cast.alternative.lasting' : 'permit:cast.alternative');
        if (v['firstSpellThisTurn'] === true) add('feature:permit.cast.alternative.firstSpell'); // std-freecast-1 (statics/play-permits.ts#grantedAlternatives)
        break;
      }
      const anyTypeFor = notPrinted(n) !== 'lasting' && v['action'] === 'spendMana' && (v['asThough'] === 'any type' || v['asThough'] === 'any color') && v['of'] !== undefined
        && Object.keys(v).every((k) => ['s', 'who', 'action', 'asThough', 'of'].includes(k));
      if (anyTypeFor) { add('permit:spendMana.anyTypeFor'); break; }
      // std-rx32 (CR 609.4b): "You may spend mana as though it were mana of any color to activate abilities of creatures you control" as a static ability
      // (statics/play-permits.ts#isSpendAnyColorAbilitiesPermit) is `permit:spendMana.anyColorAbilities`
      const anyColorAbilities = notPrinted(n) !== 'lasting' && v['action'] === 'spendMana' && v['asThough'] === 'any color' && v['abilities'] === true && v['of'] !== undefined
        && Object.keys(v).every((k) => ['s', 'who', 'action', 'asThough', 'of', 'abilities'].includes(k));
      if (anyColorAbilities) { add('permit:spendMana.anyColorAbilities'); break; }
      // Cloud r3-mech INTERFACE CHANGE (additive): mayhem with no cost (a land, CR 702.187a-b): exactly `{s:'permit', who:{ref:'you'}, action:'play', of:{self:true},
      // from:'graveyard', discardedThisTurn:true}` in a printed static ability (statics/play-permits.ts#isDiscardedSelfPlayPermit) is `permit:play.discardedSelf`;
      // the field on any other permission is a form nothing registers
      if (v['discardedThisTurn'] !== undefined) {
        const who = rec(v['who']);
        const of = rec(v['of']);
        const exact = notPrinted(n) === null && v['discardedThisTurn'] === true && v['action'] === 'play' && v['from'] === 'graveyard'
          && Object.keys(v).every((k) => ['s', 'who', 'action', 'of', 'from', 'discardedThisTurn'].includes(k))
          && Object.keys(who).length === 1 && who['ref'] === 'you' && Object.keys(of).length === 1 && of['self'] === true;
        add(exact ? 'permit:play.discardedSelf' : `feature:permit.${String(v['action'])}.discardedThisTurn`);
        break;
      }
      // std-rx27 INTERFACE CHANGE (additive): "you may play cards you don't own with stash counters on them from exile" as a static ability
      // (statics/play-permits.ts#isExileFilterPermit, which the walker cannot import, design 5.4; CR 601.3, 305.1): `who` you, `from` exile, an `of` with no `is`,
      // `zone` or `self`, and only `anyManaType` besides is `permit:<action>.exile` (and `feature:permit.<action>.exile.anyManaType`); a resolved effect with it is
      // a form nothing registers
      const exOf = rec(v['of']);
      // trek-7: ... `self` alone is the card itself ("You may cast this card from exile", Khan, Vengeful Heart)
      const exSelf = exOf['self'] === undefined || (exOf['self'] === true && Object.keys(exOf).filter((k) => exOf[k] !== undefined).length === 1);
      if (playCast && v['from'] === 'exile' && v['of'] !== undefined && exOf['is'] === undefined && exOf['zone'] === undefined && exSelf
        && Object.keys(v).every((k) => ['s', 'who', 'action', 'from', 'of', 'anyManaType'].includes(k)) && JSON.stringify(v['who']) === '{"ref":"you"}'
        && (v['anyManaType'] === undefined || v['anyManaType'] === true)) {
        if (notPrinted(n) === 'lasting') add(`feature:permit.${String(v['action'])}.exile.lasting`);
        else {
          add(`permit:${String(v['action'])}.exile`);
          if (v['anyManaType'] === true) add(`feature:permit.${String(v['action'])}.exile.anyManaType`);
        }
        break;
      }
      // r5-refs INTERFACE CHANGE (additive): "You may play cards exiled with ~" as a static ability (statics/play-permits.ts#isLinkedPermit, CR 607.2a, 601.3): `who`
      // you, `of` the linked objects alone and nothing else is `permit:<action>.linked`; a resolved effect with it is a form nothing registers
      const linkedOf = rec(rec(v['of'])['is']);
      // std-ru INTERFACE CHANGE (additive): ... and "If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost" on it, `costChange`
      // exactly `{kind:'set', life:'manaValue'}` (statics/play-permits.ts#linkedPermitLifeCost, CR 118.9): `feature:permit.<action>.linked.lifeCost` besides
      const lifeCost = JSON.stringify(v['costChange']) === '{"kind":"set","life":"manaValue"}';
      if (playCast && linkedOf['ref'] === 'linked' && Object.keys(rec(v['of'])).length === 1 && Object.keys(v).every((k) => ['s', 'who', 'action', 'of'].includes(k) || (k === 'costChange' && lifeCost))
        && JSON.stringify(v['who']) === '{"ref":"you"}') {
        add(notPrinted(n) === 'lasting' ? `feature:permit.${String(v['action'])}.linked.lasting` : `permit:${String(v['action'])}.linked`);
        if (lifeCost) add(`feature:permit.${String(v['action'])}.linked.lifeCost`);
        break;
      }
      // std-rx27 INTERFACE CHANGE (additive): the rider form ("You may cast Dinosaur creature spells from among cards you own exiled with ~. If you cast a spell
      // this way, that creature enters with a finality counter on it.", CR 607.2a, 601.3e, 609.4b, 118.9, 614.1c) as a static ability: `permit:cast.linked` and one
      // feature per rider (linkedRiderFeatures); a resolved effect with it is a form nothing registers
      const riders = linkedRiderFeatures(v);
      if (riders !== null) {
        if (notPrinted(n) === 'lasting') add('feature:permit.cast.linked.lasting');
        else { add('permit:cast.linked'); riders.forEach(add); }
        break;
      }
      // std-rx27 (CR 702.8a, 607.2a): "you may cast them as though they had flash" of the cards a linked ability exiled (statics/hooks.ts#castsAsInstant)
      if (v['action'] === 'haveFlash' && linkedOf['ref'] === 'linked') add(notPrinted(n) === 'lasting' ? 'feature:permit.haveFlash.linked.lasting' : 'feature:permit.haveFlash.linked');
      // C10 INTERFACE CHANGE (additive): every graveyard permission statics/play-permits.ts#isGraveyardPermit honors is `permit:<action>.zone` (CR 601.3,
      // 305.1, 404.1), its `of` and `from` part of that form; one a resolving effect made is honored too (CR 611.2a), except a once-each-turn limit and the card
      // itself (`of: {self: true}`), which are a static ability's only: those stay unregistered forms
      const lastingGy = notPrinted(n) === 'lasting';
      const zone = !ofObject && isGraveyardPermitJson(v) && !(lastingGy && (v['oncePerTurn'] !== undefined || rec(v['of'])['self'] !== undefined));
      if (lastingGy && !zone && isGraveyardPermitJson(v)) add(`feature:permit.${String(v['action'])}.zone.lasting`);
      // std-exile-play-2-4 (CR 611.2c-like): `of.is` an `each` filter on a resolved permission is the set the filter picks as the effect begins
      // (effects/handlers/lasting.ts locks it): `feature:permit.<action>.lockedSet`; on a static ability it would stay live, which nothing reads (fail closed)
      if (ofObject && rec(rec(v['of'])['is'])['ref'] === 'each') add(`feature:permit.${String(v['action'])}.lockedSet`);
      add(ofObject ? `permit:${String(v['action'])}.object` : top ? `permit:${String(v['action'])}.top` : faceDownLook ? 'permit:lookAt.faceDown' : zone ? `permit:${String(v['action'])}.zone` : `permit:${String(v['action'])}`);
      if (v['fromTop'] !== undefined && !top) add(`feature:permit.${String(v['action'])}.fromTop`);
      for (const k of PERMIT_FIELDS) {
        if (v[k] === undefined || (k === 'of' && (ofObject || top || faceDownLook)) || (zone && (k === 'of' || k === 'from'))) continue;
        // C10: the additional cost and the "enters with" rider are read on graveyard permissions only; on any other they are a `.other` form nothing registers
        // std-rx10 (CR 601.3b, 118.8): ... and on a flash permission, "as though it had flash if you behold a Dragon as an additional cost" (statics/hooks.ts#castFlashAddCosts)
        // std-rx27 (CR 614.1c, 601.3e): a top-card cast permission's "If you cast a creature spell this way, that creature enters with ..." (`entersWith` with
        // `entersWithIf`, statics/play-permits.ts#topPermitFor)
        const topEnters = top && v['action'] === 'cast' && v['entersWith'] !== undefined && v['entersWithIf'] !== undefined;
        if ((k === 'entersWith' || k === 'entersWithIf') && topEnters) { if (k === 'entersWith') add('feature:permit.cast.top.entersWith'); continue; }
        if (k === 'entersWithIf') { add(`feature:permit.${String(v['action'])}.entersWithIf.other`); continue; }
        if ((k === 'addCost' || k === 'entersWith' || k === 'exileOnLeave' /* std-rx24 */) && !zone && !(k === 'addCost' && v['action'] === 'haveFlash')) { add(`feature:permit.${String(v['action'])}.${k}.other`); continue; }
        // FAST5X E29: the any-type rider (CR 609.4b) and the condition are read on the permissions for named objects only (statics/play-permits.ts); on any
        // other permission they are a `.other` form nothing registers
        // r5-repl: likewise "If that spell would be put into a graveyard, exile it instead" (CR 614.1a, `graveyardInstead`; `play` is a form nothing registers); r5-dig: "as an Adventure" (CR 715.3) likewise
        // std-rx3 (CR 118.9, 601.2b): "without paying its mana cost" on a permission for named objects is `free` (statics/play-permits.ts#isFreeCost); any other cost
        // change keeps `costChange`, which nothing registers
        if (k === 'costChange' && ofObject && isFreeCostJson(v['costChange'])) { add(`feature:permit.${String(v['action'])}.free`); continue; }
        // std-exile-play-2-1 (CR 118.9, 202.3): "If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost" on a permission for
        // named objects, exactly `{kind:'set', life:'manaValue'}` (statics/play-permits.ts#linkedPermitLifeCost)
        if (k === 'costChange' && ofObject && lifeCost) { add(`feature:permit.${String(v['action'])}.named.lifeCost`); continue; }
        // std-exile-play-2-3 (CR 118.9, 701.67a): "by waterbending {X} rather than paying its mana cost, where X is its mana value" on a cast permission for named
        // objects (statics/play-permits.ts#isWaterbendCost; the number is fixed as the effect begins, effects/handlers/lasting-fix.ts)
        if (k === 'costChange' && ofObject && v['action'] === 'cast' && isWaterbendCostJson(v['costChange'], rec(v['of'])['is'])) { add('feature:permit.cast.named.waterbend'); continue; }
        // std-exile-play-1-1 (CR 118.9, 202.3): "If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost" on a top-card permission,
        // exactly `{kind:'set', life:'manaValue'}` (statics/play-permits.ts#topPermitFor, actions/cast.ts)
        if (k === 'costChange' && top && lifeCost) { add(`feature:permit.${String(v['action'])}.top.lifeCost`); continue; }
        // std-exile-play-1-3 (CR 601.2f, 614.1c, 400.3): "Each spell cast this way costs {1} more to cast" (a generic increase), "Each land played this way enters
        // tapped" and "players may play cards they exiled this way" (`ownOnly`) on a permission for named objects (statics/play-permits.ts#namedPermitIncrease,
        // namedPermitLandTapped, namedObjects); on any other permission they are a `.other` form nothing registers
        if (k === 'costChange' && ofObject && isIncreaseCostJson(v['costChange'])) { add(`feature:permit.${String(v['action'])}.increase`); continue; }
        if (k === 'ownOnly' || k === 'landsEnterTapped') { add(ofObject ? `feature:permit.${String(v['action'])}.${k}` : `feature:permit.${String(v['action'])}.${k}.other`); continue; }
        // std-rx27 (CR 601.3, 611.2a): "until end of turn, you may play a card exiled with ~": one card, counted for the turn (statics/play-permits.ts#namedSingleKey),
        // so only on a permission for named objects that lasts until end of turn; any other is a form nothing registers
        // std-rx27 (CR 305.2): a graveyard land permission once each turn has its own name (a top-card play permission once each turn stays unregistered)
        if (k === 'oncePerTurn' && zone && v['action'] === 'play') { add('feature:permit.play.zone.oncePerTurn'); continue; }
        // trek-11 (CR 400.11, 305.1, 601.3): "... a permanent card you own from outside the game or from your graveyard" on its one form (statics/play-permits.ts#isPermanentPlayPermit),
        // a static ability's only (`zone` is false for a resolved effect with a limit); on any other permission a form nothing registers
        if (k === 'alsoOutside') { add(zone && v['action'] === 'play' && isPermanentPlayPermitJson(v) ? 'feature:permit.play.zone.outside' : `feature:permit.${String(v['action'])}.alsoOutside`); continue; }
        // std-freecast-2 (CR 601.3): a graveyard permission of a resolved effect "this turn" for one spell (statics/play-permits.ts#gyHits counts it for the turn)
        if (k === 'single' && zone) { add(lastingGy && rec(rec(n.parent?.value)['duration'])['d'] === 'endOfTurn' ? 'feature:permit.cast.zone.single' : 'feature:permit.cast.zone.single.other'); continue; }
        if (k === 'entersSubtypes') { add(zone ? 'feature:permit.cast.entersSubtypes' : `feature:permit.${String(v['action'])}.entersSubtypes.other`); continue; }
        // p2-graveyard-2 (CR 614.1a, 400.7): a graveyard permission's "If a spell cast this way would be put into your graveyard, exile it instead" (actions/cast.ts records it)
        if (k === 'graveyardInstead' && zone) { add('feature:permit.cast.zone.graveyardInstead'); continue; }
        if (k === 'single') { add(ofObject && rec(rec(n.parent?.value)['duration'])['d'] === 'endOfTurn' ? `feature:permit.${String(v['action'])}.single` : `feature:permit.${String(v['action'])}.single.other`); continue; }
        const own = (k === 'anyManaType' || k === 'anyManaColor' || k === 'while' || k === 'graveyardInstead' || k === 'asAdventure') && !ofObject ? `${k}.other` : k;
        add(`feature:permit.${String(v['action'])}.${own}`); // WP16 INTERFACE CHANGE (review fix)
      }
      // FAST5 T56: a flash permission with a price runs only as a fixed generic increase (statics/hooks.ts#genericIncrease, actions/cast.ts); any other price has no form
      if (v['action'] === 'haveFlash' && v['costChange'] !== undefined && !isGenericIncreaseJson(v['costChange'])) add('feature:permit.haveFlash.costChange.form');
      break;
    }
    case 'RuleModDef':
      add(`rulemod:${String(v['rule'])}`);
      // std-mana-1 (CR 106.12, 614.1a): "it produces three times as much of that mana instead" is run for lands only (rules/mana.ts#addMana multiplies the mana of
      // a permanent still on the battlefield; a nonland permanent may be sacrificed for its mana, a Treasure, which needs its last known information): any other
      // `of` needs a form nothing registers
      if (v['rule'] === 'tapManaMultiplier') {
        const of = v['of'] as { types?: unknown } | undefined;
        if (!Array.isArray(of?.types) || of.types.length !== 1 || of.types[0] !== 'Land') add('feature:rulemod.tapManaMultiplier.nonland');
      }
      // std-ry3 (CR 402.2): a hand size changed by a number, not set to it, is read by statics/hooks.ts#maxHandSize only for `maxHandSize`
      if (v['delta'] !== undefined) add(`feature:rulemod.${String(v['rule'])}.delta`);
      // T20 (FAST4) INTERFACE CHANGE: "untap ~ during each other player's untap step" is run for the source itself only (statics/hooks.ts); another set of
      // permanents ("untap all creatures you control ...", Seedborn Muse) or a player needs a form nothing registers
      // r4-static: `of` is run too (statics/hooks.ts#untapsDuringOthersUntapStep); a player or a value is not
      if (v['rule'] === 'untapDuringOtherUntapSteps' && (v['player'] !== undefined || v['value'] !== undefined)) add('feature:rulemod.untapDuringOtherUntapSteps.of');
      // FAST5X E3: the crew and saddle value modifications are run for the source itself only (statics/hooks.ts#crewSaddleValue)
      if ((v['rule'] === 'crewSaddlePowerBonus' || v['rule'] === 'crewSaddleUsesToughness') && (v['of'] !== undefined || v['player'] !== undefined)) add(`feature:rulemod.${String(v['rule'])}.of`);
      // r5-static: a cost to attack or block with {X} in it (War Cadence's "pays {X} for each blocking creature", the X of the ability that made it) is not fixed
      // when the effect begins, so it has no form the engine runs (statics/combat-tax.ts would read X as 0)
      if ((v['rule'] === 'attackTax' || v['rule'] === 'blockTax') && JSON.stringify(rec(v['cost'])['mana'] ?? []).includes('"variable"')) add('feature:rulemod.combatTax.variableMana');
      // std-ry8 (CR 701.43a, 702.154a, 603.12): the attack options are run for the source itself only (statics/hooks.ts#attackOptions); what happens after the option
      // was taken (`then`) is run by core/combat.ts for these two rules only
      if ((v['rule'] === 'mayExertAsAttacks' || v['rule'] === 'enlist') && (v['of'] !== undefined || v['player'] !== undefined)) add(`feature:rulemod.${String(v['rule'])}.of`);
      if (v['then'] !== undefined) add(v['rule'] === 'mayExertAsAttacks' || v['rule'] === 'enlist' ? 'feature:rule.attackOption.then' : 'feature:rulemod.then.other');
      break;
    case 'CostModDef':
      // WP16 INTERFACE CHANGE: a modifier of activation costs needs its own call-site (actions/activate.ts has none yet), so it is a separate capability.
      // FAST5 T60 INTERFACE CHANGE: the activated abilities with a wrapper keyword ("Exhaust abilities of other permanents you control cost {2} less to activate",
      // actions/activate.ts#costChangeOf) have a capability of their own; every other modifier of activation costs still needs `feature:costMod.abilities`
      if (rec(v['applies'])['abilities'] !== undefined) {
        const ab = rec(rec(v['applies'])['abilities']);
        // Cloud std-woe: a REDUCTION of the activation costs of another object's abilities, of any kind ("Activated abilities of lands you control cost {1} less to
        // activate", CR 601.2f, 602.2b, 605.1a: mana abilities too), applied by actions/activate.ts#costChangeOf and, for a mana ability with a mana cost, by
        // rules/pay.ts and rules/sources.ts (statics/costmods.ts#abilityManaCost); an increase or a set cost still needs `feature:costMod.abilities` (the {T}-only
        // mana abilities are activated without a payment step, rules/mana.ts)
        const reduceOnly = ab['keyword'] === undefined && rec(v['applies'])['self'] !== true && rec(v['change'])['kind'] === 'reduce';
        // std-rx28 (CR 601.2f, 602.2b, 605.1a): an INCREASE of another object's activation costs ("Activated abilities of sources with the chosen name cost {2} more to
        // activate", Skyseer's Chariot): actions/activate.ts#costChangeOf adds it, and a mana ability it applies to is paid by hand (rules/mana.ts#manaCostShapeNow)
        const increaseOnly = ab['keyword'] === undefined && ab['kind'] === undefined && rec(v['applies'])['self'] !== true && rec(v['change'])['kind'] === 'increase' && rec(v['change'])['life'] === undefined;
        add(ab['keyword'] !== undefined && ab['kind'] === 'activated' && rec(v['applies'])['self'] !== true ? 'feature:costMod.abilities.keyword' : reduceOnly ? 'feature:costMod.abilities.reduce' : increaseOnly ? 'feature:costMod.abilities.increase' : 'feature:costMod.abilities');
      }
      // std-rh: the unlock cost of a door of a Room (core/rooms.ts#listed); nothing else reads a modifier of it
      if (rec(v['applies'])['unlock'] === true) add('feature:costMod.unlock');
      // std-rx27 (CR 602.2b, 118.9): "the first equip ability you activate each turn" (statics/costmods.ts#abilityCostModsFor), for keyword abilities only
      if (rec(v['applies'])['firstEachTurn'] !== undefined) add(rec(rec(v['applies'])['abilities'])['keyword'] !== undefined ? 'feature:costMod.abilities.firstEachTurn' : 'feature:costMod.firstEachTurn.other');
      // std-rx26 INTERFACE CHANGE: the plot special action's cost ("Plotting cards from your hand costs {2} less", core/special/plot.ts#plotCostAfterMods)
      if (rec(v['applies'])['plot'] !== undefined) add('feature:costMod.plot');
      // FAST4 T21 INTERFACE CHANGE: `mana` applied `times` times (statics/costmods.ts#modifyMana); an engine without it would apply the mana once
      if (rec(v['change'])['times'] !== undefined) add('feature:costMod.times');
      // r3-cost INTERFACE CHANGE: "This effect can't reduce the mana in that cost to less than one mana" (statics/costmods.ts#modifyMana, CR 601.2f, 118.7)
      if (rec(v['change'])['floor'] === 'one') add('feature:costMod.floor.one');
      // r5-cost INTERFACE CHANGE: "cost an additional 3 life to cast" (actions/cast.ts#modifiedPlan, CR 601.2f, 119.4): spells only; nothing adds it to an activation
      if (rec(v['change'])['life'] !== undefined) add(rec(v['applies'])['abilities'] !== undefined || rec(v['change'])['kind'] !== 'increase' ? 'feature:costMod.abilities.life' : 'feature:costMod.life');
      break;
    case 'ReplacementDef':
      // Only a shield made by a resolved `effect` step (CR 615.7, 614.8) is run by the M5 build; a static prevention or regeneration is a replacement of
      // another object like any other (design 8.5, 14).
      if (v['shield'] === undefined) add(v['selfReplacement'] === true || aboutSelf(rec(v['replaces'])) ? 'feature:replace.self' : 'feature:replace.foreign');
      else {
        // WP11 INTERFACE CHANGE (review, design 8.5, 14): milestone 5's shields are prevention (CR 615.7-615.8) and regeneration (CR 614.8) shields; a shielded
        // `enters`, `modify` or `instead` (Gather Specimens, Magma Spray) is milestone 6 and needs a feature of its own (`feature:shield.<b>`).
        const b = rec(v['body'])['b'];
        if (b !== 'prevent' && b !== 'regeneration') add(`feature:shield.${String(b)}`);
        // std-rx24 (CR 614.10a, 614.5): a one-use skip shield of a GROUP of players ("each opponent skips their next untap step") would be used up by the first
        // player's step, while each player skips one: a form nothing registers (fail closed) until the shield counts its uses per player
        const whose = rec(rec(v['replaces'])['whose']);
        if (b === 'skip' && v['shield'] !== undefined && (whose['ref'] === 'each' || whose['ref'] === 'otherOpponents')) add('feature:shield.skip.group');
      }
      break;
    case 'ReplacementBody':
      add(`body:${String(v['b'])}`);
      addAll(bodyForms(v));
      break;
    case 'TokenDef':
      if (Array.isArray(v['keywords'])) for (const k of v['keywords'] as string[]) add(`keyword:${String(k)}`);
      if (Array.isArray(v['keywords']) && (v['keywords'] as unknown[]).some((k) => castCostKeywords.has(String(k)))) add('feature:castCost.granted'); // M6-5a
      if (typeof v['predefined'] === 'string') add(predefinedTokenCapability(v['predefined'])); // WP14 review: what the predefined token's abilities need
      break;
    case 'ManaProduction':
      if (v['kind'] === 'couldProduce') add('feature:mana.couldProduce'); // p2-mana-1: CR 106.7 (effects/handlers/cards-mana.ts)
      if (v['kind'] === 'devotionColor') add('feature:mana.devotionColor'); // p2-mana-2: CR 700.5 (effects/handlers/cards-mana.ts)
      if (v['kind'] === 'eventProduced') add('feature:mana.eventProduced'); // T38: read from the triggering mana ability's activation (effects/handlers/cards.ts#FEATURES)
      if (v['kind'] === 'anyColor' && v['from'] !== undefined) add('feature:mana.anyColor.from'); // r3-cost: each unit among some types (effects/handlers/cards-mana.ts)
      break;
    case 'ManaSpentRider':
      add('feature:mana.spentRider'); // std-mana-1: applied as the spell's costs are paid (core/mana-riders.ts, effects/handlers/cards.ts#FEATURES)
      if (v['entersWith'] !== undefined) add('feature:mana.spentRider.entersWith'); // pc-keywords-mana-2 (CR 614.1c): recorded on the spell as it is cast
      break;
    case 'ManaRestriction':
      add('feature:mana.restriction');
      // WP13 INTERFACE CHANGE: the rider (Cavern of Souls: "that spell can't be countered") is a form of its own, registered by the package that enforces it
      if (v['spellRider'] !== undefined) add(`feature:mana.rider.${String(v['spellRider'])}`);
      if (v['unlock'] !== undefined) add('feature:mana.restriction.unlock'); // FAST5X E8 (CR 709.5e): mana for unlock costs (rules/sources.ts#spendAllows)
      // FAST5X E23 (CR 106.6): an equip ability (CR 702.6a), turning a permanent face up (CR 116.2b), and "can't be spent to cast" (rules/sources.ts#spendAllows)
      for (const k of ['abilityKeyword', 'turnFaceUp', 'notSpells']) if (v[k] !== undefined) add(`feature:mana.restriction.${k}`);
      break;
    default:
  }
}

/** Every capability use of an ability (and of the abilities nested in it), in document order, with the pointer of the node that needs it. */
export function capabilityUses(def: unknown, path = ''): CapUse[] {
  const out: CapUse[] = [];
  walkAbility(def, (n) => {
    try {
      usesOfNode(n, out);
    } catch {
      // malformed JSON (a field of the wrong type): the validator reports it; the walker must not throw
    }
    return undefined;
  }, { path });
  return out;
}

/** The distinct capabilities an ability needs, sorted (so the result does not depend on the order of the keys of the input). */
export function capabilitiesOfDef(def: unknown): string[] {
  return [...new Set(capabilityUses(def).map((u) => u.cap))].sort();
}

/**
 * FAST4 MX1: the capability of a move's `until` (CR 610.3). The one form the handler runs is exiled until the source leaves the battlefield, with nothing
 * else in the pattern or the destination; the handler's own test (effects/handlers/zones-move.ts#untilSourceLeaves) is the same, pinned by
 * test/fast4/mx1/move-until.test.ts (the walker can't import the engine, design 5.4).
 */
export function moveUntilForm(until: unknown, to: unknown): string {
  const u = rec(until);
  const e = rec(u['event']);
  const subj = rec(e['subject']);
  const dest = rec(to);
  const ok = u['d'] === 'until' && Object.keys(u).length === 2 && e['ev'] === 'zoneChange' && e['from'] === 'battlefield' && Object.keys(e).sort().join() === 'ev,from,subject'
    && subj['self'] === true && Object.keys(subj).length === 1 && dest['zone'] === 'exile' && Object.keys(dest).length === 1;
  return ok ? 'op:move.until' : 'op:move.until.other';
}

/**
 * FAST5X E27: is this cost part paid while an effect resolves? In a `pay` step's cost (CR 118.12), or in the cost of a keyword whose expansion pays it in a `pay`
 * step: ward (CR 702.21a: "counter it unless that player pays [cost]"). Nested choices (`oneOf`) count as their parent. Never for an activation or casting cost.
 */
const RESOLUTION_COST_KEYWORDS: ReadonlySet<string> = new Set(['ward']);
function paidOnResolution(n: WalkNode): boolean {
  for (let p = n.parent; p !== null; p = p.parent) {
    if (p.value['op'] === 'pay') return true;
    if (p.value['kind'] === 'keyword') return RESOLUTION_COST_KEYWORDS.has(String(p.value['keyword']));
    if (p.value['kind'] === 'activated' || p.value['kind'] === 'spell' || p.value['kind'] === 'triggered' || p.value['kind'] === 'static') return false;
  }
  return false;
}
