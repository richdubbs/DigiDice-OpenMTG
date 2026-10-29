/**
 * Event pattern forms the engine build may not honor (WP8 review). Owner: WP8. The counterpart of `model/forms.ts` for `EventPattern`s.
 *
 * Why this file exists. `ev:<ev>` says "the matcher knows this discriminator". It is too coarse: some event kinds cannot occur in this build because no engine
 * code emits the `GameEvent` they are derived from (at W1 `dieRolled`, `becameTarget`, `spellCopied`, `countered`, ... had no emitter; WP13-WP15 and WP32 added them), and
 * some pattern fields can never match (`beginTurn.extra`, a `NumberCmp` whose value is a quantity, `becomes.by` for anything but `targeted`). Without a name for
 * them the walker would call a card that depends on them supported, the degrade pass would keep it automated, and its trigger would silently never fire.
 *
 * So: `ev:<ev>` is a capability only for kinds the engine can emit (`match.ts#NOT_EMITTED`), and `eventPatternForms(p)` lists the finer names a pattern needs:
 *  - `feature:ev.action.<verb>`   (the verb is emitted: see `SUPPORTED`),
 *  - `feature:ev.becomes.<what>`  (the change is emitted),
 *  - `feature:ev.cast.orCopy`, `feature:ev.beginTurn.extra`, `feature:ev.becomes.by`, `feature:ev.cmp.quantity` (fields no matcher evaluates),
 * and `delayedWhenForms(w)` the same for `DelayedWhen` (`feature:delayed.step.notNext`). The names in `SUPPORTED` are in `FEATURES` (match.ts), so they are in
 * `ENGINE_CAPABILITIES`; every other name is missing and the degrade pass makes the unit manual. The matchers ALSO fail closed at run time for each of them (a
 * pattern that asks never matches), so a definition that reaches the engine without the degrade pass is never played wrongly; the tests pin both halves.
 *
 * To add support: the package that adds the emitter adds its name to `SUPPORTED` (and removes the kind from `NOT_EMITTED` for a whole kind). The walker of
 * `model/capabilities.ts` (WP1) must call `eventPatternForms` for every `EventPattern` it visits (in a trigger's `on`, a `delay` step's `when`, a `triggerMod`'s
 * `cause`, a `happened` condition, ...) the way it calls `targetSpecForms` of model/forms.ts.
 */
import type { AbilityDef, DelayedWhen, EventPattern, NumberCmp } from '../types/ability';
import { DFC_FORMS } from './forms-dfc';
import { FACE_FORMS } from './forms-face';
import { LEVELS_FORMS } from './forms-levels';
import { MERGE_FORMS } from './forms-merge';
import { SADDLE_FORMS } from './forms-saddle';
import { PLOT_FORMS } from './forms-plot';
import { ROOM_FORMS } from './forms-rooms';
import { historyPatternForms } from '../rules/history';

/**
 * M6-0 (m6 design 2.6): the event forms of one milestone 6 package, in its own file (triggers/forms-face.ts M6-3, forms-dfc.ts M6-4, forms-levels.ts M6-6,
 * forms-merge.ts M6-9). `SUPPORTED`: the finer names it honors (WITHOUT the `feature:` prefix, as below); `EMITS`: the milestone 6 event kinds whose `GameEvent`s
 * it emits (match.ts#NOT_EMITTED is the M6 kinds no part lists). All empty in M6-0.
 */
export interface EventFormsPart { SUPPORTED: readonly string[]; EMITS: readonly EventPattern['ev'][] }
export const EVENT_FORMS_PARTS: readonly EventFormsPart[] = [FACE_FORMS, DFC_FORMS, LEVELS_FORMS, MERGE_FORMS, SADDLE_FORMS, PLOT_FORMS, ROOM_FORMS]; // SADDLE_FORMS: FAST5X E3; PLOT_FORMS: FAST5X E6; ROOM_FORMS: FAST5X E8

/** The finer names this build honors (each WITHOUT the `feature:` prefix): the verbs and changes whose `GameEvent`s the engine emits (`normalize.ts`). */
export const SUPPORTED: readonly string[] = [
  // M6-0: the names the milestone 6 packages' parts honor (none in M6-0)
  ...EVENT_FORMS_PARTS.flatMap((p) => p.SUPPORTED),
  // CR 701.17, 701.9, 701.8, 701.13 (zone changes with a cause), CR 305.1 (landPlayed), CR 701.20 (shuffled)
  'ev.action.sacrifice', 'ev.action.discard', 'ev.action.destroy', 'ev.action.exile', 'ev.action.playLand', 'ev.action.shuffle',
  // CR 701.26: tapped / untapped
  'ev.becomes.tapped', 'ev.becomes.untapped',
  // WP14 (effects/handlers/zones*.ts, tokens*.ts and their primitives emit `countered`, `abilityCountered`, `attached`, `transformed`, `spellCopied`; an Aura
  // spell resolving emits `attached` in core/resolve.ts): CR 701.6 countering, 701.3a attaching, 701.27 transforming, 707.10 copies of spells ("cast or copy").
  // NOT `ev.becomes.unattached`: CR 701.3d counts an attachment leaving the battlefield, its host leaving its zone and the 704.5m-n state-based actions as
  // "becoming unattached", and none of those paths (core/zones.ts, core/sba-objects.ts) emits it yet; only the attach op and re-attaching do.
  'ev.action.counter', 'ev.becomes.attached', 'ev.becomes.transformed', 'ev.cast.orCopy',
  // WP32: CR 115.1, 603.3d. "Becomes the target of a spell or ability" is emitted for every way a spell or ability gets targets: a spell cast (actions/cast.ts,
  // also cast while an effect resolves), an activated ability (actions/activate.ts), a triggered ability put on the stack (triggers/stack.ts, also reflexive,
  // delayed and "Trigger now" ones), and a copy with its targets (rules/stack-objects.ts). Its `by` is judged on that spell or ability (match.ts). Makes ward work.
  'ev.becomes.targeted',
  // FAST5X E1 (CR 702.174c): "whenever you give a gift": the giveGift action (effects/handlers/gift.ts) emits it after the gift of a spell or a gift trigger
  'ev.action.giveGift',
  // std-rx17: CR 702.110b, "whenever <creature> exploits a creature": the sacrifice of an exploit ability (effects/handlers/zones-remove.ts) emits `exploit`
  'ev.action.exploit',
  // MX4: CR 309.7, "whenever you complete a dungeon" (core/dungeons.ts emits the action `completeDungeon` as the dungeon leaves the game)
  'ev.action.completeDungeon',
  // MX3: CR 701.54d, core/ring.ts emits `actionPerformed` with verb ringTempts each time the Ring tempts a player (with the chosen Ring-bearer, if any)
  'ev.action.ringTempts',
  // FAST5X E12: CR 701.59a, "whenever you collect evidence": paying it as a cost (rules/pay-parts.ts) and the action (effects/handlers/evidence.ts) emit it
  'ev.action.collectEvidence',
  // FAST5X E28: CR 701.61a, "whenever you forage": paying it as a cost (rules/pay-parts.ts) and the action (effects/handlers/forage.ts) emit it
  'ev.action.forage',
  // std-rx26: CR 701.57a, "whenever you discover": the discover action (effects/handlers/actions-native.ts) emits it once it is done, with N as the amount
  'ev.action.discover',
  // FAST5 T37: monstrosity (CR 701.37a, effects/handlers/actions-native-counters.ts) emits `actionPerformed` 'monstrosity', which normalize.ts reads as "becomes monstrous"
  'ev.becomes.monstrous',
  // std-ry8: CR 702.112a-b, renown (effects/handlers/actions-native-counters.ts) emits `actionPerformed` 'renown', which normalize.ts reads as "becomes renowned"
  'ev.becomes.renowned',
  // FAST5 T37: cycling (CR 702.29a, 702.29d): activating a cycling or typecycling ability emits `actionPerformed` 'cycle' for the discarded card (actions/activate.ts)
  'ev.action.cycle',
  // FAST5X E9: CR 701.22d, 701.25d, "whenever you scry / surveil" and "you've scried or surveilled this turn": effects/handlers/cards-library.ts emits the action
  // once per player after the whole process (scry 0 and surveil 0 are none, CR 701.22b, 701.25c), the only places a player scries or surveils
  'ev.action.scry', 'ev.action.surveil',
  // FAST5X E10: CR 701.67c, rules/pay.ts#payPlan emits `actionPerformed` 'waterbend' once per waterbend cost paid (however it was paid); CR 701.65b, the airbend
  // action (effects/handlers/airbend.ts) emits 'airbend' once when it exiles one or more objects
  'ev.action.waterbend', 'ev.action.airbend',
  // std-mana-12 (CR 701.66, 702.189): the earthbend macro and the firebending trigger end with op reportAction, which emits 'earthbend' / 'firebend'
  'ev.action.earthbend', 'ev.action.firebend',
  // FAST5X E17: CR 505.1b, "your second main phase": core/turn.ts#beginStep numbers the main phases of the turn, the step matchers read the number
  'ev.step.nth',
  // FAST5X E20 (rules/crime.ts): CR 700.13, a crime is reported as a spell is cast, an ability activated or a triggered ability put on the stack with a target
  // that makes it one (actions/cast.ts, actions/activate.ts, triggers/stack.ts; never a copy); CR 700.14, every payment of mana to cast a spell reports the
  // totals before and after (actions/cast.ts); CR 701.26a, the tap op (the controller of the spell or ability) and a non-mana tap cost (the payer) report who
  // tapped the permanent; CR 702.177a, 606.3, the kind of ability activated (actions/activate.ts)
  'ev.action.commitCrime', 'ev.action.expend', 'ev.action.tap', 'ev.activate.ability',
  // M12-3: "attacks you or a planeswalker you control" (CR 506.3, 508.1b): match.ts and rules/history.ts read the planeswalker's controller (triggers/history.ts
  // records the defending player of a planeswalker attack, CR 508.5)
  'ev.attacks.orPlaneswalker',
  'ev.cause.craft', // Standard round 3, r3-trig (CR 702.167a): rules/pay-parts.ts exiles craft's materials with the cause 'craft', match.ts compares it
  'ev.cast.modal', // Standard round 3, r3-trig (CR 700.2): normalize.ts says whether modes were chosen for the spell as it was cast, match.ts reads it
  'ev.cast.notOwnedByCaster', // std-exile-play-1-1 (CR 108.3, 601.2a): match.ts compares the spell's owner with the caster
  'ev.attacks.power', // Standard round 3, r3-trig (CR 508.1): the total power of a declaration's attackers (normalize.ts carries it, match.ts reads it)
  // M12-3: CR 701.15a, the goad action (effects/handlers/goad.ts) emits `actionPerformed` 'goad' for each creature it goads
  'ev.action.goad',
  // std-ry8: CR 701.43a, "whenever you exert a creature": the exert cost (rules/pay-parts.ts#exertPermanent), the exert action (effects/handlers/exert.ts) and the exert
  // "as it attacks" (core/attack-options.ts) all emit `actionPerformed` 'exert' with the exerted permanent
  'ev.action.exert',
  // cloud std-spm: CR 305.1, a land play reports the zone the land was played from (actions/land.ts, `landPlayed.from`)
  'ev.action.playLand.from',
  'ev.action.playLand.notFrom', // Standard round 4, r4-trig (CR 305.1): "from anywhere other than your hand", the same `landPlayed.from`
  'ev.becomes.targeted.player', // Standard round 4, r4-trig (CR 115.1): the `becameTarget` event of a player target names that player (normalize.ts), match.ts reads it
  'ev.action.search', 'ev.action.search.ownLibrary', // Standard round 4, r4-trig (CR 701.23a): every search emits `actionPerformed` 'search' with the zone searched and its owner (effects/handlers/cards-library.ts)
  // std-lci: CR 701.44a-b, explore (effects/handlers/explore.ts) emits `actionPerformed` 'explore' after each complete explore, with the exploring permanent and
  // whether the revealed card was a land card or a nonland card ("whenever a creature you control explores a land card")
  'ev.action.explore', 'ev.action.explore.revealed',
  // p2-player-rules-3 (CR 701.30c): "whenever you clash" / "whenever you clash and win", emitted as a clash ends (effects/handlers/cards-library.ts#clashHandler)
  'ev.action.clash', 'ev.action.clash.won',
  // std-lci (CR 106.3): "whenever you cast a permanent spell using mana produced by ~": actions/cast.ts names the sources of the mana spent (triggers/match.ts)
  'ev.cast.manaFromSelf',
  // M12F: CR 701.38a, "whenever players finish voting": the vote action (effects/handlers/actions-native.ts) emits `votesFinished` once per vote with the
  // ballots, and a vote resolved by hand (effects/manual.ts#askManual) emits it without them
  'ev.action.votesFinished',
  // p2-counters-move-1: CR 701.34a, "whenever you proliferate": each proliferate (effects/handlers/actions-native-counters.ts#proliferateOnce) emits `actionPerformed`
  // 'proliferate' with the proliferating player once it is done, also when nothing was chosen
  'ev.action.proliferate',
  // trek-2 (CR 700.2, 601.2b, 602.2b, 603.3c; "face a dilemma" is a new term, its rule number unverified): actions/announce.ts#chooseModes emits `actionPerformed`
  // 'faceDilemma' for the player who chooses one or more modes of a spell being cast, an ability being activated or a triggered ability being put on the stack
  'ev.action.faceDilemma',
  // p2-trigger-events-1: CR 701.17a, a card moved from a library to a graveyard with the cause 'mill' (the mill op and the mill cost) is the owner's action `mill`
  // (normalize.ts#CAUSE_VERBS), one for each card milled
  'ev.action.mill',
  'ev.draw.exceptFirstInDrawStep', // edh-players-1 (CR 504.1): normalize.ts marks the first card drawn in the draw step, match.ts reads it
];

const isQuantityCmp = (c: NumberCmp | undefined): boolean => c !== undefined && typeof c.value !== 'number';

/** The finer capability names (`feature:...`) one event pattern needs, beyond `ev:<ev>`. Pure. */
export function eventPatternForms(p: EventPattern): string[] {
  const out: string[] = [];
  switch (p.ev) {
    case 'action':
      out.push(`feature:ev.action.${p.verb}`);
      // std-lci (CR 701.44a): only an explore says what it revealed; on any other verb the field is never registered (fail closed)
      if (p.revealed !== undefined) out.push(p.verb === 'explore' ? 'feature:ev.action.explore.revealed' : 'feature:ev.action.revealed.other');
      if (p.won !== undefined) out.push(p.verb === 'clash' && p.won === true ? 'feature:ev.action.clash.won' : 'feature:ev.action.won.other'); // p2-player-rules-3 (CR 701.30c)
      // FAST5X E20 (never registered: the matcher fails closed for them): "expend" without its N or an N on another verb (CR 700.14), and a `tap` action of
      // anything but an opponent's permanent (a mana ability's {T} cost and convoke do not report who tapped: rules/crime.ts)
      if ((p.verb === 'expend') !== (p.n !== undefined)) out.push('feature:ev.action.n.other');
      if (p.verb === 'tap' && p.object?.controller !== 'opponent') out.push('feature:ev.action.tap.notOpponent');
      if (p.from !== undefined) out.push(p.verb === 'playLand' ? 'feature:ev.action.playLand.from' : 'feature:ev.action.from.other'); // cloud std-spm (CR 305.1)
      if (p.notFrom !== undefined) out.push(p.verb === 'playLand' ? 'feature:ev.action.playLand.notFrom' : 'feature:ev.action.from.other'); // Standard round 4, r4-trig (CR 305.1)
      if (p.searched !== undefined) out.push(p.verb === 'search' ? 'feature:ev.action.search.ownLibrary' : 'feature:ev.action.from.other'); // Standard round 4, r4-trig (CR 701.23a)
      break;
    case 'becomes':
      out.push(`feature:ev.becomes.${p.what}`);
      // (r5-trig: the creature that crews or saddles is the `by` of 'crewCostPaid' / 'saddleCostPaid', which the matcher reads, CR 702.122b, 702.171c)
      // std-rx31: "becomes attached to a creature" (the permanent it became attached to, the event's `object`, triggers/match.ts)
      if (p.by !== undefined && p.what !== 'targeted' && p.what !== 'crewCostPaid' && p.what !== 'saddleCostPaid' && p.what !== 'teamworkCostPaid' && p.what !== 'attached') out.push('feature:ev.becomes.by');
      if (p.untapStep === true) out.push(p.what === 'untapped' ? 'feature:ev.becomes.untapStep' : 'feature:ev.becomes.untapStep.other'); // r5-trig (CR 502.3); the second never registered
      if ((p.what === 'crewCostPaid' || p.what === 'saddleCostPaid' || p.what === 'teamworkCostPaid') && p.by === undefined) out.push('feature:ev.becomes.by.missing'); // never registered // only "becomes the target of ... by" has a source to filter
      // cloud std-dsk: "whenever you turn a permanent face up" (who turned it, CR 702.37e); never registered for another change (the matcher fails closed)
      if (p.player !== undefined) out.push(p.what === 'turnedFaceUp' ? 'feature:ev.becomes.turnedFaceUp.player' : p.what === 'targeted' ? 'feature:ev.becomes.targeted.player' /* r4-trig, CR 115.1 */ : 'feature:ev.becomes.player.other');
      break;
    case 'cast':
      if (p.orCopy) out.push('feature:ev.cast.orCopy');
      if (p.via !== undefined) out.push('feature:ev.cast.via'); // FAST5X E2 (CR 702.185c)
      if (p.notFrom !== undefined) out.push('feature:ev.cast.notFrom'); // Standard round 5, r5-trig (CR 601.2a)
      if (p.nthMin !== undefined) out.push('feature:ev.cast.nthMin'); // Standard round 5, r5-trig (CR 601.2i)
      if (p.manaFromSelf === true) out.push('feature:ev.cast.manaFromSelf'); // std-lci (CR 106.3)
      if (p.modal === true) out.push('feature:ev.cast.modal'); // Standard round 3, r3-trig (CR 700.2)
      if (p.notOwnedByCaster === true) out.push('feature:ev.cast.notOwnedByCaster'); // std-exile-play-1-1 (CR 108.3)
      // FAST5X E18 (CR 601.2i): counted from the history, so the spell filter must be one the history facts answer (rules/history.ts#historyPatternForms)
      if (p.nthMatching === true) out.push('feature:ev.cast.nthMatching', ...historyPatternForms({ ev: 'cast', ...(p.spell ? { spell: p.spell } : {}) }));
      break;
    case 'beginTurn': if (p.extra !== undefined) out.push('feature:ev.beginTurn.extra'); break;
    case 'step': if (p.nth !== undefined) out.push('feature:ev.step.nth'); break; // FAST5X E17 (CR 505.1b)
    case 'activate':
      if (p.ability !== undefined) out.push('feature:ev.activate.ability'); // FAST5X E20
      if (p.activated !== undefined) out.push('feature:ev.activate.activated'); // std-rx28 (CR 602.2, 115.9b)
      if (p.tapped === true || p.produced !== undefined) out.push('feature:trigger.tappedForMana'); // std-mana-1 (CR 106.12): rules/mana.ts marks the activation's {T}
      break;
    case 'attacks':
      if (isQuantityCmp(p.count)) out.push('feature:ev.cmp.quantity');
      if (p.orPlaneswalker !== undefined) out.push('feature:ev.attacks.orPlaneswalker'); // M12-3 (CR 506.3, 508.1b)
      if (p.power !== undefined) out.push(isQuantityCmp(p.power) ? 'feature:ev.cmp.quantity' : 'feature:ev.attacks.power'); // Standard round 3, r3-trig (CR 508.1)
      break;
    case 'damage':
      if (isQuantityCmp(p.amount)) out.push('feature:ev.cmp.quantity');
      if (p.excess !== undefined) out.push('feature:ev.damage.excess'); // FAST5X E16 (CR 120.10)
      if (p.amountIsToughness !== undefined) out.push('feature:ev.damage.amountIsToughness'); // std-rx28 (CR 120.1, 208.1)
      if (p.toSourceTarget !== undefined) out.push('feature:ev.damage.toSourceTarget'); // std-rx28 (CR 115.9b)
      break;
    case 'life': if (isQuantityCmp(p.amount)) out.push('feature:ev.cmp.quantity'); break;
    case 'dieRoll': if (isQuantityCmp(p.result)) out.push('feature:ev.cmp.quantity'); break;
    case 'counters':
      if (p.atLeast !== undefined && typeof p.atLeast !== 'number') out.push('feature:ev.cmp.quantity');
      if (p.by !== undefined) out.push('feature:ev.counters.by'); // FAST5X E21 (CR 122.6): "whenever you put ... counters on ..."
      break;
    default: break;
  }
  return out;
}

/** Does a JSON tree contain a step with this `op`? (The effect of an ability is data: steps nest in `if`, `may`, `forEach`, modes, ...) */
function hasOp(node: unknown, op: string): boolean {
  if (Array.isArray(node)) return node.some((x) => hasOp(x, op));
  if (node === null || typeof node !== 'object') return false;
  const o = node as Record<string, unknown>;
  return o['op'] === op || Object.values(o).some((x) => hasOp(x, op));
}

/**
 * CR 605.1b, 605.4a: a triggered ability with no target that triggers from the activation of a mana ability (605.1a) and could add mana when it resolves is itself
 * a mana ability: it never uses the stack and resolves at once. (Mana Flare, Wild Growth, Utopia Sprawl.) Its trigger here is an `activate` pattern with
 * `manaAbility: true` (the engine's `manaAdded` with `viaActivation`, normalize.ts); "could add mana" is an `addMana` step anywhere in the effect.
 */
export function isTriggeredManaAbility(def: AbilityDef): boolean {
  if (def.kind !== 'triggered') return false;
  const { targets, modes } = def.effect;
  if (targets.length > 0 || modes !== undefined) return false;
  return def.trigger.on.some(isManaActivationPattern) && hasOp(def.effect.steps, 'addMana');
}

/** CR 605.1b: "whenever [a player] taps [a permanent] for mana" / "activates a mana ability": the trigger event of a triggered mana ability. */
export function isManaActivationPattern(p: EventPattern): boolean {
  return p.ev === 'activate' && p.manaAbility === true;
}

/**
 * CR 603.7, 605.1b (WP32): a delayed triggered ability ("until end of turn, whenever you tap a land for mana, add an additional {G}") is a triggered mana ability
 * by the same test: it triggers from activating a mana ability and adds mana (a delayed record has no targets). It resolves at once like the others.
 */
export function isDelayedManaAbility(rec: { when: DelayedWhen; do: readonly unknown[] }): boolean {
  return rec.when.at === 'event' && isManaActivationPattern(rec.when.event) && hasOp(rec.do, 'addMana');
}

/**
 * Does this JSON tree (a card definition, a delayed record) mention the trigger event of a triggered mana ability? The cheap test triggers/mana-now.ts runs on
 * every mana activation before it looks at any object (WP32: the M3 soak activates a mana ability about two thousand times).
 */
export function mentionsManaActivation(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(mentionsManaActivation);
  if (node === null || typeof node !== 'object') return false;
  const o = node as Record<string, unknown>;
  if (o['ev'] === 'activate' && o['manaAbility'] === true) return true;
  for (const k in o) if (mentionsManaActivation(o[k])) return true;
  return false;
}

/**
 * The finer capability names one triggered ability needs beyond its patterns'. `feature:trigger.mana` for a triggered mana ability: advertised since WP32
 * (triggers/match.ts FEATURES), which resolves it at once without the stack (CR 605.4a, triggers/mana-now.ts). `feature:trigger.mana.modal` (never registered,
 * WP32 review) for a MODAL one: it is a mana ability too (CR 605.1b) and must resolve at once, but mana-now.ts can't choose modes, and the stack collection
 * would put it on the stack: fail closed until it can.
 */
export function triggerForms(def: AbilityDef): string[] {
  return [...triggerOwnForms(def), ...(def.kind === 'triggered' ? def.trigger.on.flatMap(eventPatternForms) : [])];
}

/** The names a triggered ability needs that are not its patterns' (model/capabilities.ts visits the patterns one by one). */
export function triggerOwnForms(def: AbilityDef): string[] {
  if (isTriggeredManaAbility(def)) return ['feature:trigger.mana'];
  return isModalTriggeredManaAbility(def) ? ['feature:trigger.mana.modal'] : [];
}

/** CR 605.1b with modes (CR 700.2): no target in the ability or in any mode, a mana-activation trigger, and an `addMana` step in the steps or in some mode. */
function isModalTriggeredManaAbility(def: AbilityDef): boolean {
  if (def.kind !== 'triggered' || def.effect.modes === undefined) return false;
  const { targets, modes } = def.effect;
  if (targets.length > 0 || modes.options.some((o) => o.program.targets.length > 0)) return false;
  return def.trigger.on.some(isManaActivationPattern) && hasOp(def.effect, 'addMana');
}

/** The finer capability names a delayed trigger's `when` needs: its event pattern's, and `feature:delayed.step.notNext` for the one reading of `next` the build does not know. */
export function delayedWhenForms(w: DelayedWhen): string[] {
  if (w.at === 'event') return eventPatternForms(w.event);
  // A step trigger fires at the first such step AFTER it was created (CR 603.7a); that is what "the next end step" means. `next: false` has no other documented meaning.
  if (w.at === 'step' && w.next === false) return ['feature:delayed.step.notNext'];
  if (w.at === 'step' && w.anyMain === true) return ['feature:delayed.step.anyMain']; // r5-fxb (triggers/delayed.ts#fires)
  return [];
}
