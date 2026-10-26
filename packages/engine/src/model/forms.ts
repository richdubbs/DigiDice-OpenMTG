/**
 * Value forms and model fields the engine build may not honor yet (WP0 review). Owner: WP1 (the walker `capabilitiesOf` calls these helpers); WP0 wrote
 * the names, the detection and the classification so that no work package has to invent them.
 *
 * Why this file exists. A capability is normally one name per discriminator (`filter:power`, `cost:discard`, `target:object`). That is too coarse: a
 * field can be supported in one VALUE FORM and not in another (`power: {op:'<=', value: 3}` yes, `value: {q:'count', ...}` no), and some optional fields of the
 * model are not read by the engine at all (`TargetSpec.distinctFrom`, `divide`, `groupLimit`, `ActivatedAbilityDef.onlyIf`, ...). Without a name for those, the
 * walker would call a card that uses them supported, the degrade pass would keep it automated, and the engine would silently do the wrong thing (design D2,
 * 5.2: a field the build cannot evaluate must be a MISSING capability).
 *
 * The names below are emitted by `capabilitiesOf` (WP1) whenever the form is used, and are in `ENGINE_CAPABILITIES` only when the owning package adds the
 * name to its table (`SUPPORTED_FILTER_FIELDS`, `COST_FORMS`, `FEATURES` of rules/targets.ts and actions/announce.ts). The engine ALSO fails closed at run time
 * for each of them (a filter never matches, a cost is a manual part and is denied, a target spec makes the spell or ability not offered), so a definition that
 * reaches the engine without the degrade pass is never played wrongly; the tests pin both halves.
 *
 * Adding a field to `TargetSpec`, `ModeSpec` or `ActivatedAbilityDef` without classifying it in `FIELD_COVERAGE` is a compile error.
 */
import type { ActivatedAbilityDef, Condition, CostDef, Count, CostPart, EffectProgram, EventPattern, ModeSpec, NumberCmp, ObjectFilter, PlayerPred, PlayerRef, Quantity, TargetSpec, ZoneName } from '../types/ability';

/** Optional keys of `T`. */
type OptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T];

/** `read`: the engine reads the field in every form. A capability name: the engine does NOT honor the field and the name must be absent from `ENGINE_CAPABILITIES`. */
export type FieldCoverage = 'read' | `${'feature' | 'filter' | 'cost'}:${string}`;

/**
 * Every optional field of the three records the announcement code (casting, activating, targeting) reads, classified. `read` fields may still have gated
 * value forms (see the helpers below); a capability name means the whole field is ignored by this build, whatever its value.
 */
export const FIELD_COVERAGE: {
  TargetSpec: Record<OptionalKeys<TargetSpec>, FieldCoverage>;
  ModeSpec: Record<OptionalKeys<ModeSpec>, FieldCoverage>;
  ActivatedAbilityDef: Record<OptionalKeys<Omit<ActivatedAbilityDef, 'text' | 'label' | 'src' | 'prov'>>, FieldCoverage>;
} = {
  TargetSpec: {
    filter: 'read', players: 'read', // players.who as a PlayerRef is gated by feature:target.playerRef
    // WP7: read by actions/announce-targets.ts and rules/targets.ts; each is still a named feature (feature:target.*) in FEATURES of actions/announce.ts.
    distinctFrom: 'read', divide: 'read', groupLimit: 'read', onlyIf: 'read', chooser: 'read', sameOwner: 'read', differentNames: 'read', // FAST3 T14, FAST5 T42
    perOpponent: 'read', sharedCardType: 'read', // FAST5 T66
    perPlayer: 'read', // r5-fxb: rules/targets.ts#perOpponentHolds (CR 115.1, 601.2c)
    random: 'read', // p2-damage-2: actions/announce-targets.ts#randomTargets (CR 601.2c, 603.3d)
    sharedCreatureType: 'read', // CLOUD std-ecl: rules/targets.ts#sharedCreatureTypeHolds (CR 205.3m, 115.1)
    differentControllers: 'read', // CLOUD std-tmt
    sameController: 'read', // std-rx30: rules/targets.ts#sameControllerHolds (CR 115.1, 601.2c)
    perCardType: 'read', // std-cardcopy-7: rules/targets.ts#perCardTypeHolds (CR 115.1, 601.2c, 205.2a)
    link: 'read', // LNK1: effects/run.ts#rememberTargets remembers the legal targets on the source as the ability resolves (CR 607.1)
  },
  // WP7: actions/announce.ts#chooseModes (feature:modes.chooser / feature:modes.override); std-blb (CR 700.2i): pawprints (feature:modes.pawprints)
  ModeSpec: { allowRepeat: 'read', chooser: 'read', override: 'read', pawprints: 'read', unchosen: 'read' /* r3-choose: chooseModes (feature:modes.unchosen) */, random: 'read' /* p2-modal-2: chooseModes (feature:modes.random) */ },
  ActivatedAbilityDef: {
    isMana: 'read', isLoyalty: 'read', sorcerySpeed: 'read', zone: 'read',
    limit: 'read', // limit.per 'game' / 'combat' are gated by feature:limit.game / feature:limit.combat (WP7 honors 'game' only)
    onlyIf: 'read', // WP7: actions/activate.ts (feature:activate.onlyIf)
    // FAST1 T4: the wrapper keyword's name (CR 702.177a); it means nothing beyond the fields above, which carry its restrictions (capability keyword:<name>)
    keyword: 'read',
    // T35: power-up (CR 702.193a), read by actions/activate.ts#abilityCost
    reducedByManaCost: 'read',
    anyPlayer: 'read', // MX5: actions/activate.ts (feature:activate.anyPlayer; its .tap / .mana / .self forms are not read)
    costChange: 'read', // T38: actions/activate.ts#costChangeOf (feature:activate.costChange; none for a mana or loyalty ability)
    costChangeIf: 'read', // r4-cost: actions/activate.ts#costChangeOf (feature:activate.costChange.if)
    xMin: 'read', // std-rx12: actions/activate.ts (feature:activate.xMin)
    uncopiable: 'read', // std-copy-1: effects/handlers/tokens-copy.ts#copySpells (feature:activate.uncopiable)
    tapForMana: 'read', // std-rx27: actions/activate.ts, rules/payment-options.ts (feature:activate.tapForMana; with colored mana in the cost .unsupported)
  },
};

/** The one field of `ModeSpec.options[]` that is optional: an additional cost of the mode (CR 700.2h). */
export const MODE_OPTION_COST = 'feature:modes.cost';

const isFixedCount = (c: Count): boolean => typeof c === 'number' || c === 'any';
const isAnnouncedX = (c: Count): boolean => typeof c === 'object' && c.q === 'X';

/** Value forms of one `ObjectFilter` (top level only; the walker visits `anyOf` / `not` as nested filters). */
export function filterForms(f: ObjectFilter): string[] {
  const out: string[] = [];
  if (typeof f.controller === 'object') out.push('filter:controller.ref');
  if (typeof f.owner === 'object') out.push('filter:owner.ref');
  if (Array.isArray(f.keyword)) out.push('filter:keyword.list');
  if (Array.isArray(f.notKeyword)) out.push('filter:notKeyword.list');
  if (typeof f.attacking === 'object') out.push('filter:attacking.defender');
  if (typeof f.attacking === 'object' && f.attacking.orPlaneswalker === true) out.push('filter:attacking.orPlaneswalker'); // std-combat-1
  const cmps: (NumberCmp | undefined)[] = [f.power, f.toughness, f.manaValue];
  if (cmps.some((c) => c !== undefined && typeof c.value !== 'number')) out.push('filter:cmp.quantity');
  return out;
}

/** Value forms of one cost part. */
export function costPartForms(p: CostPart): string[] {
  const out: string[] = [];
  const count: Count | undefined = 'count' in p ? p.count : 'amount' in p && p.kind === 'payLife' ? p.amount : undefined;
  if (count === 'any') out.push('cost:count.any');
  else if (count !== undefined && !isFixedCount(count) && !isAnnouncedX(count)) out.push('cost:count.quantity');
  switch (p.kind) {
    case 'discard':
      if (p.self) out.push('cost:discard.self');
      if (p.hand) out.push('cost:discard.hand');
      break;
    case 'removeCounters':
      if (p.filter) out.push('cost:removeCounters.filter');
      if (p.counter === 'any') out.push('cost:removeCounters.any'); // CLOUD std-ecl: counters of any kinds, the payer's choice (CR 122.1, 118.3)
      if (p.among === true) out.push('cost:removeCounters.among'); // r3-cost: "from among <permanents>", in all (CR 118.3)
      if (p.all === true) out.push('cost:removeCounters.all'); // p2-counters-move-2: "Remove all <kind> counters from ~", X fixed to those counters (CR 118.3, 107.3a)
      break;
    case 'tapUntapped':
      if (p.other) out.push('cost:tapUntapped.other');
      break;
    case 'sacrifice':
      if (p.distinctNames === true) out.push('cost:sacrifice.distinctNames'); // r3-cost: "with different names" (CR 118.3, 201.2)
      if (p.atLeast !== undefined) out.push('cost:sacrifice.atLeast'); // std-mana-1: "one or more" (CR 601.2b)
      break;
    case 'action':
      out.push(`cost:action.${p.action}`); // WP7: each keyword action used as a cost is its own capability (rules/cost.ts#COST_ACTIONS)
      break;
    case 'exileFrom':
      // FAST5X E13 (the same test as rules/cost.ts#exileZonePayable): the battlefield for "Exile ~" and "Exile a <permanent> you control" (CR 118.3, 602.2),
      // craft's materials from the battlefield and/or your graveyard (CR 702.167a-b), and their "N or more" count (CR 601.2b)
      if (p.orGraveyard) out.push(p.zone === 'battlefield' && p.self !== true ? 'cost:exileFrom.orGraveyard' : 'cost:exileFrom.zone');
      else if (p.zone === 'battlefield' && (p.self === true || p.filter?.controller === 'you')) out.push('cost:exileFrom.battlefield');
      else if (p.zone === 'stack' && p.self === true) out.push('cost:exileFrom.stack'); // r5-mech: the resolving spell exiles itself (CR 608.2m, 608.2n)
      else if (p.zone !== 'graveyard' && p.zone !== 'hand') out.push('cost:exileFrom.zone');
      if (p.atLeast !== undefined) out.push('cost:exileFrom.atLeast');
      if (p.totalManaValue !== undefined) out.push('cost:exileFrom.totalManaValue'); // std-costs-1: an exact total mana value (CR 118.3, 107.3a)
      if (p.symbolTotal !== undefined) out.push('cost:exileFrom.symbolTotal'); // std-cardcopy-7 (CR 118.3, 107.4)
      break;
    case 'returnToHand':
      if (p.beamUp === true) out.push('cost:returnToHand.beamUp'); // trek-1: a beam me up cost, which a "can't be beamed up" permanent can't pay (rules/cant.ts)
      break;
    case 'putIntoLibrary': // trek-9 (CR 118.3, 401.4): the source itself from your graveyard is paid, nothing else (rules/cost.ts#toPlanPart)
      if (p.zone !== 'graveyard') out.push('cost:putIntoLibrary.zone');
      break;
    default:
  }
  return out;
}

/**
 * Where a condition is read while announcing (CR 601.2b-c, 602.5b), which decides what it can know: `spec` = a TargetSpec's `onlyIf` (the cast choices and X are
 * known); `mode` = a ModeSpec's `override.when` (modes are chosen BEFORE X is announced, so X is not known yet); `activate` = an ability's `onlyIf` (nothing is
 * announced yet, but the controller can attest an `ask`, CR 602.5b).
 */
export type AnnounceWhere = 'spec' | 'mode' | 'activate'
  /**
   * p2-cost-statics-1 (CR 118.9, 601.2b): `altCost` = an alternative cost's `when` ("If an opponent cast a blue spell this turn, you may pay {R} rather than pay this
   * spell's mana cost"): read as the spell is proposed, before modes and X (as `mode`), and it reads this turn's history as an activation restriction does (the
   * history of every event of the turn is written before a player receives priority, CR 117.3, so it is complete whenever a spell can be cast).
   */
  | 'altCost';

/**
 * The capabilities (WP7 review 2, design 5.2) a player reference needs while announcing, one per kind of reference (and per kind of object it is taken from):
 * `feature:announce.cref.<ref>` inside a condition or quantity, `feature:announce.sref.<ref>` for the player of a TargetSpec or the chooser of a spec or of modes.
 * The announcement code lists the ones it can read in `FEATURES` (actions/announce.ts); everything else stays a missing capability, so a card that needs it is
 * manual (the degrade pass) when the interpreter (WP4) learns to resolve the same reference at resolution time.
 */
export function playerRefForms(ref: PlayerRef, ctx: 'cond' | 'spec'): string[] {
  const base = `feature:announce.${ctx === 'cond' ? 'cref' : 'sref'}.${ref.ref}`;
  return ref.ref === 'controllerOf' || ref.ref === 'ownerOf' ? [`${base}.${ref.object.ref}`] : [base];
}

const predForms = (p: PlayerPred): string[] => (typeof p === 'string' ? [] : playerRefForms(p, 'cond'));

function quantityAnnounceForms(q: Quantity, where: AnnounceWhere): string[] {
  if (typeof q === 'number') return [];
  switch (q.q) {
    case 'X': return [where === 'spec' ? 'feature:announce.qty.X' : 'feature:announce.qty.X.early']; // before X is announced there is no X to read
    case 'count': return ['feature:announce.qty.count', `feature:announce.count.${q.of.ref}`];
    case 'life': case 'zoneSize': return [`feature:announce.qty.${q.q}`, ...playerRefForms(q.of, 'cond')];
    case 'math': return ['feature:announce.qty.math', ...q.args.flatMap((a) => quantityAnnounceForms(a, where))];
    case 'counters': return ['feature:announce.qty.counters', `feature:announce.counters.${q.on.ref}`]; // "three or more brick counters on ~" (CR 602.5b, 122.1)
    // std-ry5 (formidable, CR 208.1, 602.5b): "Activate only if creatures you control have total power 8 or greater": the powers (or toughnesses) of the visible
    // objects a filter selects, added up as they are now
    case 'stat':
      if (q.sum === true && q.agg === undefined && q.station === undefined && q.of.ref === 'each' && (q.stat === 'power' || q.stat === 'toughness')) return ['feature:announce.qty.stat.sum.each'];
      return [`feature:announce.qty.stat.${q.of.ref}`]; // r4-fxb: the source's own statistic only (actions/announce-cond.ts#announceQty)
    // std-rB (CR 602.5b, 120.1): "Activate only if red sources you controlled dealt 4 or more noncombat damage this turn": the damage of this turn's history added
    // up, in an activation restriction only (the one position that reads the history, as `turnHistoryAtAnnouncement`), with no reference in the pattern and only
    // the source filter fields the history facts answer
    case 'happenedCount':
      if (isOpponentSpellsPerPlayer(q)) return ['feature:announce.qty.happenedCount.opponentSpellsPerPlayer']; // p2-cost-statics-1 (CR 601.2i)
      return where === 'activate' && isTurnDamageTotal(q) ? ['feature:announce.qty.happenedCount.damageTotal', ...historySourceFieldForms(q.event)] : ['feature:announce.qty.happenedCount'];
    // merge line D (std-sos's controlsVs, CR 102.2, 102.3, 602.5b): "an opponent controls more lands than you", each opponent counted alone on the visible board
    case 'countPlayers':
      // std-rx24 (CR 122.1f, 602.5b): "an opponent has three or more poison counters", each player's poison counters against a fixed number (announce-cond.ts)
      if (q.poisonIs !== undefined) {
        return q.controlsVs === undefined && q.sizeVs === undefined && q.sizeIs === undefined && q.lifeVs === undefined && q.lifeIs === undefined && q.lostLifeThisTurn === undefined && q.lostLifeIs === undefined && q.controlsIs === undefined && q.didNot === undefined && q.of.ref === 'each'
          ? ['feature:announce.qty.countPlayers.poisonIs'] : ['feature:announce.qty.countPlayers'];
      }
      // opp-port-1 (OPP1 of 2026-10-17; CR 102.3, 602.5b): "an opponent controls four or more lands", each player's own permanents against a fixed number (announce-cond.ts)
      if (q.controlsIs !== undefined) {
        return q.controlsVs === undefined && q.sizeVs === undefined && q.sizeIs === undefined && q.lifeVs === undefined && q.lifeIs === undefined && q.poisonIs === undefined && q.lostLifeThisTurn === undefined && q.lostLifeIs === undefined && q.didNot === undefined && q.speedVs === undefined && q.of.ref === 'each'
          ? ['feature:announce.qty.countPlayers.controlsIs'] : ['feature:announce.qty.countPlayers'];
      }
      return q.controlsVs !== undefined && q.sizeVs === undefined && q.sizeIs === undefined && q.lifeVs === undefined && q.lifeIs === undefined && q.lostLifeThisTurn === undefined && q.lostLifeIs === undefined && q.controlsIs === undefined && q.of.ref === 'each'
        ? ['feature:announce.qty.countPlayers.controlsVs', ...playerRefForms(q.controlsVs.than, 'cond')]
        // r4-cost (CR 402.1, 602.5b): "a player has one or fewer cards in hand", each player's zone size against a fixed number (wave 7 merge: and no r4-static
        // `lifeIs`, which announce-cond.ts#announceQty's sizeIs branch does not read)
        : q.sizeIs !== undefined && q.sizeVs === undefined && q.controlsVs === undefined && q.lifeVs === undefined && q.lifeIs === undefined && q.lostLifeThisTurn === undefined && q.lostLifeIs === undefined && q.controlsIs === undefined && q.of.ref === 'each'
          ? ['feature:announce.qty.countPlayers.sizeIs'] : ['feature:announce.qty.countPlayers'];
    // FAST5X E13 (delirium, CR 205.2a): card types among `each` are read at announcement (actions/announce-cond.ts); FAST5X E12: "activate only if there are
    // five colors among permanents you control" (CR 105.1, 602.5b), the colors among `each`; anything else names its own form
    case 'distinct':
      if (q.what === 'cardTypes' && q.among.ref === 'each') return ['feature:announce.qty.distinct'];
      if (q.what === 'colors') return [`feature:announce.qty.distinct.${q.what}`, `feature:announce.count.${q.among.ref}`];
      return [`feature:announce.qty.distinct.${q.what}.${q.among.ref}`];
    default: return [`feature:announce.qty.${q.q}`];
  }
}

/**
 * FAST5 T69: the capabilities a calculated NUMBER OF TARGETS needs (actions/announce-targets.ts#withFixedCounts reads it from the visible board with
 * actions/announce-cond.ts#announceQty): the colors or card types among a group of objects, a count of a group, and sums and products of those. Any other
 * quantity (a count of the source itself, a life total, a stat, a variable) is still `feature:count.quantity`, which no build honors.
 */
export function countQuantityForms(q: Quantity): string[] {
  if (typeof q === 'number') return [];
  switch (q.q) {
    case 'distinct': return (q.what === 'colors' || q.what === 'cardTypes') && q.among.ref === 'each' ? quantityAnnounceForms(q, 'spec') : ['feature:count.quantity'];
    case 'count': return q.of.ref === 'each' ? quantityAnnounceForms(q, 'spec') : ['feature:count.quantity'];
    // p2-counters-state-3 (CR 601.2c, 122.1): the counters on the source itself or on a group, as they are when the targets are announced ("destroy up to X target
    // lands, where X is the number of verse counters on ~": read before a sacrifice cost is paid, CR 601.2h), actions/announce-cond.ts#announceQty
    case 'counters': return q.on.ref === 'self' || q.on.ref === 'each' ? quantityAnnounceForms(q, 'spec') : ['feature:count.quantity'];
    case 'math': return q.op === '+' || q.op === '*' || q.op === '-' ? ['feature:announce.qty.math', ...q.args.flatMap(countQuantityForms)] : ['feature:count.quantity'];
    case 'kickCount': return q.name === undefined ? ['feature:announce.qty.kickCount'] : ['feature:count.quantity']; // pc-zones-3 (CR 702.33d)
    case 'eventAmount': return ['feature:announce.qty.eventAmount']; // r3-choose (CR 603.3d): "up to that many target creatures" in a triggered ability
    case 'modesChosen': return ['feature:announce.qty.modesChosen']; // Standard round 3, r3-trig (CR 700.2, 603.3c): "choose up to X, where X is the number of times you chose a mode for that spell"
    default: return ['feature:count.quantity'];
  }
}

/**
 * Every node of a condition read at announcement, as a capability name `feature:announce.cond.<kind>` (plus the quantity, object and player forms inside it). One
 * walker serves the capability walker (WP1, through `targetSpecForms`, `modeSpecForms`, `activatedForms`) and the run-time gate of the announcement code, so the
 * two cannot disagree about what is readable.
 */
export function announceCondForms(c: Condition, where: AnnounceWhere): string[] {
  const out = [`feature:announce.cond.${c.cond}`];
  switch (c.cond) {
    case 'all': case 'any': return [...out, ...c.of.flatMap((x) => announceCondForms(x, where))];
    case 'not': return [...out, ...announceCondForms(c.of, where)];
    case 'compare': return [...out, ...quantityAnnounceForms(c.left, where), ...quantityAnnounceForms(c.right, where)];
    case 'exists': return [...out, `feature:announce.exists.${c.of.ref}`, ...(c.atLeast === undefined ? [] : quantityAnnounceForms(c.atLeast, where))];
    case 'matches': return [...out, `feature:announce.matches.${c.object.ref}`];
    case 'classLevel': return [...out, `feature:announce.classLevel.${c.object.ref}`]; // M6-6 INTERFACE CHANGE (CR 716.2a: "activate only if this Class is level N-1")
    case 'turnOf': return [...out, ...predForms(c.whose)];
    // FAST4 T27: `by` ("if you cast it") is read from the permanent's cast record, which no announcement has: unregistered, fail closed
    case 'wasCast': return [...out, ...(c.xAtLeast !== undefined && where !== 'spec' ? ['feature:announce.cond.wasCast.xAtLeast.early'] : []), ...(c.by !== undefined ? ['feature:announce.cond.wasCast.by'] : []), ...(c.spent !== undefined ? ['feature:announce.cond.wasCast.spent'] : []), ...(c.object !== undefined ? ['feature:announce.cond.wasCast.object'] : []), ...(c.kept === true ? ['feature:announce.cond.wasCast.kept'] : [])];
    // Only the controller attests, and only an activation restriction can ask (CR 602.5b): anywhere else nobody can answer.
    case 'ask': return where === 'activate' && (c.who === undefined || c.who.ref === 'you') ? out : ['feature:announce.cond.ask.unattested'];
    // FAST5 batch 2 merge (E5 + E9): only "this object entered the battlefield this turn" is read from the history at announcement (CR 400.7, 602.5b)
    // std-blb (CR 602.5b): and, in an activation restriction only, any event of this turn's history whose pattern names no object or player by reference ("Activate
    // only if an opponent lost life this turn"): the history is written before a player receives priority (triggers/stack.ts#collectPendingTriggers), so it is
    // current when one activates. Elsewhere (a target's or a mode's condition, an alternative cost's "if") it stays unread, but for combat damage dealt to a player
    // this turn (CMD2, freerunning's "if you dealt combat damage to a player this turn with an Assassin or commander", CR 702.173a: combat damage is never dealt
    // while a spell or ability resolves, CR 510.2, so the history is current in every position), with only the source filter fields the history facts answer
    // (historyFilterFieldForms). CLOUD std-ecl's "you attacked with N or more <creatures> this turn" (isAttackedWithThisTurn) is read in every
    // position, under its own capability
    case 'happened': return isSelfEnteredThisTurn(c) ? ['feature:announce.happened.selfEntered'] : isAttackedWithThisTurn(c) ? ['feature:announce.happened.attackedWith']
      // p2-modal-2 (CR 601.2b, 603.3c): a mode count's override is read as the modes are chosen, on the history of the turn so far, brought up to date first
      // (actions/announce.ts#chooseModes, triggers/stack.ts#syncHistory); damage stays unread there (the pins of cmd2: dealt while a spell resolves, before the
      // history is written), as before
      : (where === 'activate' || where === 'altCost' || (where === 'mode' && c.event.ev !== 'damage')) && turnHistoryAtAnnouncement(c) ? ['feature:announce.happened.turn'] // p2-cost-statics-1: also an alternative cost's `when`
      : isTurnPlayerCombatDamage(c) && turnHistoryAtAnnouncement(c) ? ['feature:announce.happened.turn', ...historyFilterFieldForms(c)]
      : isTurnPlayerLifeLoss(c) ? ['feature:announce.happened.turn'] : out;
    default: return out;
  }
}

/**
 * CLOUD std-ecl: "you attacked with two or more creatures this turn" (parser/holes/cond.ts#history): at least N different creatures the announcing player
 * controlled, of a description, were declared as attackers this turn (CR 508.1, 602.5b; rules/history.ts#countHistory counts each attacker once). The history
 * of the attacks is written when the triggers of the declaration are collected, before any player gets priority (CR 508.8, 117.3). Pure.
 */
export function isAttackedWithThisTurn(c: Condition): boolean {
  if (c.cond !== 'happened' || c.scope !== 'turn' || c.by !== undefined || c.times === undefined || c.times.op !== '>=' || typeof c.times.value !== 'number') return false;
  const e = c.event as unknown as Record<string, unknown>;
  const attacker = e['attacker'] as Record<string, unknown> | undefined;
  return e['ev'] === 'attacks' && Object.keys(e).length === 2 && attacker !== undefined && attacker['controller'] === 'you';
}

/**
 * "~ entered this turn" / "this land entered the battlefield this turn" (parser/holes/cond.ts#enteredSelf): the source itself (CR 400.7: a new object since it
 * last changed zones) entered the battlefield this turn, with nothing else asked of the event. Pure.
 */
export function isSelfEnteredThisTurn(c: Condition): boolean {
  if (c.cond !== 'happened' || c.scope !== 'turn' || c.times !== undefined || c.by !== undefined) return false;
  const e = c.event as unknown as Record<string, unknown>;
  const subject = e['subject'] as Record<string, unknown> | undefined;
  return e['ev'] === 'zoneChange' && e['to'] === 'battlefield' && Object.keys(e).length === 3 && subject !== undefined && Object.keys(subject).length === 1 && subject['self'] === true;
}

/**
 * std-blb (CR 602.5b): a `happened` condition of this turn's history that an activation restriction reads (actions/announce-cond.ts, `AnnounceEnv.history`): the
 * count of matching events of the turn, at least one or at least a fixed number, done by anyone or by "you" / an opponent; the pattern names no object or player
 * by reference (no `ref` anywhere in it), so its facts are matched without an effect's bindings. Pure.
 */
export function turnHistoryAtAnnouncement(c: Condition): boolean {
  if (c.cond !== 'happened' || c.scope !== 'turn' || (c.by !== undefined && typeof c.by !== 'string')) return false;
  if (c.times !== undefined && typeof c.times.value !== 'number') return false;
  let ref = false;
  const walk = (v: unknown): void => {
    if (ref || typeof v !== 'object' || v === null) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if ('ref' in v) { ref = true; return; }
    Object.values(v).forEach(walk);
  };
  walk(c.event);
  return !ref;
}

/**
 * CMD2 (CR 702.173a, 510.2): "if you dealt combat damage to a player this turn with an Assassin or commander" (freerunning's condition): combat damage to a player
 * this turn, with no count of times and no other recipient, whose player predicates are plain ones ("you", "an opponent", any player). Read by the one reader of
 * this turn's history (turnHistoryAtAnnouncement, actions/announce-cond.ts) in every position: combat damage is recorded before any player gets priority again
 * (CR 510.3) and is never dealt while a spell or ability resolves. Pure.
 */
export function isTurnPlayerCombatDamage(c: Condition): boolean {
  if (c.cond !== 'happened' || c.scope !== 'turn' || c.times !== undefined || c.by !== undefined || c.event.ev !== 'damage') return false;
  const e = c.event;
  if (e.combat !== true || e.amount !== undefined || e.excess !== undefined || e.recipient === undefined || e.recipient.object !== undefined) return false;
  const plain = (p: PlayerPred | undefined): boolean => p === undefined || p === 'you' || p === 'opponent' || p === 'any';
  return plain(e.recipient.player) && plain(e.source?.controller) && plain(e.source?.owner);
}
/**
 * std-ry7 (CR 702.137a, 119.3, 120.3a): "if an opponent lost life this turn" (spectacle's condition; parser/holes/cond.ts#t23Misc): a life loss this turn by a player
 * a plain predicate names ("you", "an opponent", any player), damage included, with no amount and no count of times. Read in every position (an alternative cost's
 * "if" too) from the players' `turnStats.lifeLost` (actions/announce-cond.ts), which rules/life.ts#changeLife keeps current at once, unlike the history. Pure.
 */
export function isTurnPlayerLifeLoss(c: Condition): boolean {
  if (c.cond !== 'happened' || c.scope !== 'turn' || c.times !== undefined || c.by !== undefined || c.event.ev !== 'life') return false;
  const e = c.event;
  return e.change === 'loss' && e.amount === undefined && (e.player === 'you' || e.player === 'opponent' || e.player === 'any');
}
/** CMD2: the source filter fields of an `isTurnPlayerCombatDamage` condition, as announcement forms: only those the history facts answer are readable (rules/history.ts). */
function historyFilterFieldForms(c: Condition): string[] {
  return c.cond === 'happened' ? historySourceFieldForms(c.event) : [];
}
/** CMD2, std-rB: the source filter fields of a damage pattern, as announcement forms (`feature:announce.history.<field>`). */
function historySourceFieldForms(e: EventPattern): string[] {
  if (e.ev !== 'damage') return [];
  const fields = (f: ObjectFilter | undefined): string[] => Object.entries(f ?? {}).flatMap(([k, v]) => (v === undefined ? [] : k === 'anyOf' ? (v as ObjectFilter[]).flatMap(fields) : k === 'not' ? fields(v as ObjectFilter) : [k]));
  return [...new Set(fields(e.source))].map((k) => `feature:announce.history.${k}`);
}

/**
 * std-rB (CR 120.1, 602.5b): a `happenedCount` an activation restriction reads (actions/announce-cond.ts#announceQty): this turn's damage added up (`sum` without
 * `per`), by anyone, from sources that a filter with no reference describes, to any recipient (no `recipient`, `amount` or `excess` asked). Pure.
 */
export function isTurnDamageTotal(q: Quantity): boolean {
  if (typeof q !== 'object' || q.q !== 'happenedCount' || q.sum !== 'amount' || q.per !== undefined || q.by !== undefined || q.beforeEvent !== undefined || q.scope !== 'turn') return false;
  const e = q.event;
  if (e.ev !== 'damage' || e.recipient !== undefined || e.amount !== undefined || e.excess !== undefined) return false;
  return !JSON.stringify(e.source ?? {}).includes('"ref"');
}

/**
 * p2-cost-statics-1 (CR 601.2i, 118.9; Mindbreak Trap): "an opponent cast three or more spells this turn": the most spells one opponent of the controller cast this
 * turn (`happenedCount` of casts per player, by an opponent), nothing else about the spells. Read as a spell is announced from the players' `turnStats.spellsCast`,
 * which actions/cast.ts counts as each spell becomes cast (actions/announce-cond.ts#announceQty). Pure.
 */
export function isOpponentSpellsPerPlayer(q: Quantity): boolean {
  return typeof q === 'object' && q.q === 'happenedCount' && q.per === 'player' && q.by === 'opponent' && q.scope === 'turn' && q.sum === undefined && q.beforeEvent === undefined
    && Object.keys(q.event).length === 1 && q.event.ev === 'cast';
}

/** Whether an effect program (or one of its modes) has a target of its own. */
const hasTargets = (p: EffectProgram): boolean => p.targets.length > 0 || (p.modes?.options.some((o) => hasTargets(o.program)) ?? false);

/** Fields and value forms of one `TargetSpec` the build may not honor (the kind itself is `target:<kind>`). */
export function targetSpecForms(spec: TargetSpec): string[] {
  const out: string[] = [];
  if (spec.distinctFrom !== undefined) out.push('feature:target.distinct');
  if (spec.divide !== undefined) out.push('feature:target.divide');
  if (spec.groupLimit !== undefined) out.push('feature:target.groupLimit');
  if (spec.sameOwner !== undefined) out.push('feature:target.sameOwner'); // FAST3 T14
  if (spec.differentNames !== undefined) out.push('feature:target.differentNames'); // FAST5 T42
  if (spec.perOpponent !== undefined) out.push('feature:target.perOpponent'); // FAST5 T66
  if (spec.perPlayer !== undefined) out.push('feature:target.perPlayer'); // r5-fxb
  if (spec.sharedCardType !== undefined) out.push('feature:target.sharedCardType'); // FAST5 T66
  if (spec.sharedCreatureType !== undefined) out.push('feature:target.sharedCreatureType'); // CLOUD std-ecl
  if (spec.differentControllers !== undefined) out.push('feature:target.differentControllers'); // CLOUD std-tmt
  if (spec.sameController !== undefined) out.push('feature:target.sameController'); // std-rx30
  if (spec.perCardType !== undefined) out.push('feature:target.perCardType'); // std-cardcopy-7
  if (spec.onlyIf !== undefined) out.push('feature:target.onlyIf');
  if (spec.chooser !== undefined) out.push('feature:target.chooser');
  if (spec.random === true) out.push('feature:target.random'); // p2-damage-2 (CR 601.2c, 603.3d)
  if (spec.players && typeof spec.players.who === 'object') out.push('feature:target.playerRef', ...playerRefForms(spec.players.who, 'spec'));
  if (spec.chooser !== undefined) out.push(...playerRefForms(spec.chooser, 'spec'));
  if (spec.onlyIf !== undefined) out.push(...announceCondForms(spec.onlyIf, 'spec'));
  // The limit of a group is read with the announced X (CR 115.1): any other quantity waits for WP4's evaluators like a count does.
  const quantities: Quantity[] = spec.groupLimit ? [spec.groupLimit.cmp.value] : [];
  for (const c of quantities) if (!isFixedCount(c) && !isAnnouncedX(c)) out.push('feature:count.quantity');
  // std-tdm (CR 601.2d, 603.3d, 107.3): the amount to divide is announced with the targets, so a calculated one ("X damage divided as you choose among any number of
  // target creatures ..., where X is the number of lands you control") is read then, as T69's number of targets is (actions/announce-targets.ts#withFixedCounts)
  if (spec.divide !== undefined && typeof spec.divide.total === 'object' && !isAnnouncedX(spec.divide.total)) out.push(...countQuantityForms(spec.divide.total));
  // FAST5 T69 (CR 601.2c, 107.3c): the number of targets may be a calculated quantity ("up to X target creatures ... where X is the number of colors among permanents
  // you control"), read when the targets are announced (actions/announce-targets.ts#withFixedCounts): it needs the announcement reader of that quantity
  for (const c of [spec.min, spec.max]) if (typeof c === 'object' && !isAnnouncedX(c)) out.push(...countQuantityForms(c));
  return [...new Set(out)];
}

/** Fields and value forms of one `ModeSpec` the build may not honor. */
export function modeSpecForms(m: ModeSpec): string[] {
  const out: string[] = [];
  if (m.chooser !== undefined) out.push('feature:modes.chooser');
  if (m.override !== undefined) out.push('feature:modes.override');
  if (m.options.some((o) => o.cost !== undefined)) out.push(MODE_OPTION_COST);
  // std-blb (CR 700.2i): a budget of pawprints, and the pawprints of each mode (none without the budget)
  if (m.pawprints !== undefined || m.options.some((o) => o.pawprints !== undefined)) out.push('feature:modes.pawprints');
  if (m.unchosen !== undefined) out.push('feature:modes.unchosen'); // r3-choose (CR 700.2): "choose one that hasn't been chosen [this turn]"
  if (m.random === true || m.override?.chosen === true) out.push('feature:modes.random'); // p2-modal-2 (CR 700.2): "choose one at random", "you choose one instead"
  if (m.chooser !== undefined) out.push(...playerRefForms(m.chooser, 'spec'));
  if (m.override !== undefined) out.push(...announceCondForms(m.override.when, 'mode'));
  // CR 700.2d: a mode chosen twice is that many instances of its targets, but target ids are unique across an ability and the stack stores one list per id (design 3.6).
  if (m.allowRepeat && m.options.some((o) => hasTargets(o.program))) out.push('feature:modes.repeatTargets');
  // The number of modes is chosen before X is announced (CR 601.2b), so an X-valued count has nothing to read: only fixed counts are honored.
  // r3-choose (CR 700.2, 603.3c): ... and the calculated numbers a calculated number of targets may be (read on the board as the modes are chosen,
  // actions/announce.ts#modeLimits); X and anything else is still `feature:count.quantity`
  // r5-cost (CR 107.3m, 603.3c): X as the count of a triggered ability's modes ("When ~ enters, choose up to X --") is the X its source was cast with, read as the
  // modes are chosen (actions/announce.ts#modeLimits); a spell's or an activated ability's X is announced after its modes (CR 601.2b), so there it reads nothing
  for (const c of [m.min, m.max, ...(m.override ? [m.override.min, m.override.max] : [])]) if (!isFixedCount(c)) out.push(...(typeof c === 'object' && c.q !== 'X' ? countQuantityForms(c) : typeof c === 'object' && c.q === 'X' ? ['feature:modes.triggerX'] : ['feature:count.quantity']));
  return [...new Set(out)];
}

/**
 * W3b, INTERFACE CHANGE (WP1 file): the zones the cost of an activated ability needs the ability's OWN source in, sorted, without duplicates; empty when the
 * cost does not involve its source. {T} and {Q} turn a permanent (CR 107.5, 107.6), a loyalty cost changes a permanent's counters (CR 606.4), "Sacrifice ~"
 * (CR 701.21a), "Return ~ to its owner's hand" and "Put a counter on ~" act on a permanent: battlefield. "Discard ~" (CR 701.9a) and "Reveal ~ from your
 * hand": hand. "Exile ~ from your <zone>": that zone. "Remove a counter from ~" names no zone (the counters must be there). rules/cost-pick.ts#partCandidates
 * looks for the source in exactly these zones.
 */
export function selfCostZones(cost: CostDef | undefined): ZoneName[] {
  if (cost === undefined || cost === null || typeof cost !== 'object') return [];
  const out = new Set<ZoneName>();
  if (cost.tap === true || cost.untap === true || cost.loyalty !== undefined) out.add('battlefield');
  for (const p of Array.isArray(cost.other) ? cost.other : []) {
    if (!('self' in p) || p.self !== true) continue;
    switch (p.kind) {
      case 'sacrifice': case 'returnToHand': case 'putCounters': out.add('battlefield'); break;
      case 'discard': out.add('hand'); break;
      case 'reveal': case 'exileFrom': case 'putIntoLibrary': out.add(p.zone); break;
      default:
    }
  }
  return [...out].sort();
}

/**
 * Fields and value forms of one activated ability the build may not honor.
 * W3b: `feature:activate.selfCostZone` (never advertised) when the cost needs the source in a zone the ability does not function in, or in two zones at once
 * ("{T}, Discard ~"): such an ability can never be activated as written (CR 113.6j, 113.6m), so it must not count as automated (design D2).
 */
export function activatedForms(def: ActivatedAbilityDef): string[] {
  const out: string[] = [];
  if (def.onlyIf !== undefined) out.push('feature:activate.onlyIf', ...announceCondForms(def.onlyIf, 'activate'));
  if (def.limit?.per === 'game') out.push('feature:limit.game');
  if (def.costChange !== undefined) out.push(def.isMana === true || def.isLoyalty === true ? 'feature:activate.costChange.unsupported' : 'feature:activate.costChange'); // T38: not for a mana or loyalty ability, which never reach the cost step
  if (def.costChangeIf !== undefined) out.push(def.costChange === undefined ? 'feature:activate.costChange.if.alone' : 'feature:activate.costChange.if'); // r4-cost (CR 601.2f)
  if (def.limit?.per === 'combat') out.push('feature:limit.combat');
  if (def.uncopiable === true) out.push('feature:activate.uncopiable'); // std-copy-1 (CR 707.10)
  if (def.xMin !== undefined) out.push(def.isMana === true || def.isLoyalty === true || def.anyPlayer === true ? 'feature:activate.xMin.unsupported' : 'feature:activate.xMin'); // std-rx12 (CR 107.3a): not on the mana or loyalty paths
  if (def.cost?.loyaltyX === true) out.push(def.cost.loyalty === undefined && def.isLoyalty === true ? 'feature:activate.loyaltyX' : 'feature:activate.loyaltyX.unsupported'); // std-r9 (CR 606.4)
  // MX5 (CR 602.2): any player may activate it; with {T}/{Q} in the cost (another player's permanent tapped by the activating player) or as a mana ability
  // (rules/mana.ts activates its controller's only), a form nothing registers
  // ... and a cost part that uses the object itself ("Sacrifice this artifact": only its controller can sacrifice it, CR 701.21a), the same
  if (def.anyPlayer === true) {
    const selfPart = (def.cost?.other ?? []).some((x) => 'self' in x && x.self === true);
    out.push(def.cost?.tap || def.cost?.untap ? 'feature:activate.anyPlayer.tap' : def.isMana ? 'feature:activate.anyPlayer.mana' : selfPart ? 'feature:activate.anyPlayer.self' : 'feature:activate.anyPlayer');
  }
  // std-rx27 (CR 601.2h, 602.2b): tap permanents rather than pay the generic mana of the activation cost; colored mana in the cost (each permanent could pay one
  // mana of any type, a payment rules/payment-options.ts does not make) and a mana or loyalty ability (no cost step there) are forms nothing registers
  if (def.tapForMana !== undefined) {
    const colored = (def.cost?.mana ?? []).some((m) => m.kind !== 'generic');
    out.push(def.isMana === true || def.isLoyalty === true || colored ? 'feature:activate.tapForMana.unsupported' : 'feature:activate.tapForMana');
  }
  const need = selfCostZones(def.cost);
  if (need.length > 1 || (need.length === 1 && !(def.zone ?? ['battlefield']).includes(need[0]!))) out.push('feature:activate.selfCostZone');
  return [...new Set(out)];
}

/** The target kinds (`target:<kind>`) and the forms of every spec of an effect program, including the programs of its modes (the walker uses the helpers node by node). */
export function programForms(program: EffectProgram): string[] {
  const out = program.targets.flatMap((s) => [`target:${s.kind}`, ...targetSpecForms(s)]);
  if (program.modes) {
    out.push(...modeSpecForms(program.modes));
    for (const o of program.modes.options) out.push(...programForms(o.program));
  }
  return [...new Set(out)];
}
