/**
 * Design 5.2: `ENGINE_CAPABILITIES` is BUILT from the engine's own tables, never from a second hand-kept list. WP0 delivers the builder over the (mostly
 * empty) tables of the skeleton; a work package adds a table entry and the capability appears.
 */
import { describe, expect, it } from 'vitest';
import { buildEngineCapabilities, ENGINE_CAPABILITIES } from '../../../src/index';
import { OP_HANDLERS } from '../../../src/effects/handlers';
import { RENDERERS } from '../../../src/render/step';
import { COND_EVALUATORS } from '../../../src/effects/eval';
import { RULE_HOOK_ACTIONS } from '../../../src/statics/hooks';
import { FEATURES } from '../../../src/effects/manual';
import { ACTION_MACROS } from '../../../src/keywords/actions';

const prefixes = (caps: Iterable<string>): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  for (const c of caps) {
    const p = c.split(':')[0]!;
    out.set(p, [...(out.get(p) ?? []), c]);
  }
  return out;
};

describe('ENGINE_CAPABILITIES (design 5.2) built from empty tables', () => {
  const byPrefix = prefixes(ENGINE_CAPABILITIES);

  it('the only op capabilities are those of the merged handler packages, and the durations WP15 judges: nothing is falsely automated (keyword: and action: come from WP3; cond, q, ref from WP4: test/m5/eval/capabilities.test.ts)', () => {
    // WP16 (statics/hooks.ts) registers the rule hooks whose call-sites consult it: exactly the keys of RULE_HOOK_ACTIONS (test/m5/rulehooks/capabilities.test.ts).
    for (const p of ['rule', 'permit', 'rulemod', 'restrict']) {
      expect((byPrefix.get(p) ?? []).sort(), p).toEqual(Object.keys(RULE_HOOK_ACTIONS).filter((k) => k.startsWith(`${p}:`)).sort());
    }
    // An explicit list per package, not the builder's own formula: an op that appears without its package (or one that disappears) fails here.
    const MERGED_OPS: Record<string, string[]> = {
      WP10: ['chooseObjects', 'chooseValue', 'forEach', 'if', 'let', 'manual', 'may', 'pay', 'repeat'], // the interpreter spine's control ops
      WP12: ['damage', 'fight', 'gainLife', 'loseLife', 'moveCounters', 'putCounters', 'removeCounters', 'setLife'],
      WP13: ['addMana', 'discard', 'draw', 'look', 'mill', 'piles', 'reveal', 'scry', 'search', 'shuffle', 'surveil'], // cards, library and mana
      WP14: ['attach', 'cast', 'changeFace', 'copy', 'counter', 'createToken', 'destroy', 'exchange', 'move', 'phaseOut', 'regenerate', 'removeFromCombat', 'sacrifice',
        'sacrificeChoice', 'tap', 'untap'], // zones, tokens, copies, casting
      WP15: ['action', 'createEmblem', 'delay', 'designate', 'effect', 'endTurn', 'extraPhase', 'extraTurn', 'flipCoin', 'loseGame', 'reflexive', 'rollDie', 'winGame'], // lasting and game
      CLOUD_R4_FXB: ['changeTarget', 'extraStep'], // r4-fxb: change the target of a spell with a single target (CR 115.7a), additional steps (CR 500.9; effects/handlers/r4-fxb.ts)
      CLOUD_STD_EOE: ['exileUntil'], // Cloud std-eoe: "exile cards from the top of your library until you exile a nonland card" (effects/handlers/actions-native.ts#exileUntilStep, CR 406.1)
      R3_DIG: ['revealUntil'], // r3-dig: "reveal cards from the top of your library until you reveal a land card" (effects/handlers/cards-reveal.ts#revealUntilHandler, CR 701.20a)
      CLOUD_R3_MECH: ['fromOutside'], // cloud r3-mech: a card you own from outside the game into your hand (effects/handlers/outside.ts, CR 400.11b)
      E3XP: ['chooseNewTargets'], // E3XP: "you may choose new targets for that spell" (effects/handlers/new-targets.ts, CR 115.7d)
      STD_R10: ['nextSpell'], // Standard round 10: "the next spell you cast this turn can't be countered" (effects/handlers/next-spell.ts, CR 601.2i, 611.2)
      STD_MANA12: ['reportAction'], // std-mana-12: earthbend and firebending report their action for "whenever you earthbend/firebend" (effects/handlers/report-action.ts, CR 701.66a, 702.189)
      P2_PLAYER_RULES_2: ['clash'], // p2-player-rules-2: clash with an opponent, "if you win" / "otherwise" (effects/handlers/cards-library.ts#clashHandler, CR 701.30)
      STD_CONTROL3: ['controlPlayer'], // std-control-3: "you control target opponent during their next turn / combat phase" (effects/handlers/game.ts, core/player-control.ts, CR 723.1)
      P2_COMBAT_FLOW_2: ['becomeBlocked'], // p2-combat-flow-2: "target unblocked attacking creature becomes blocked" (effects/handlers/become-blocked.ts, CR 509.1h)
      TREK_8: ['removeDamage'], // trek-8: "all damage already dealt to it is healed" (effects/handlers/remove-damage.ts, CR 120.6)
    };
    const ops = Object.values(MERGED_OPS).flat();
    // M6-2 (m6 design 7): the value forms of the copy op its handler runs (effects/handlers/tokens-copy.ts#OP_FORMS); M6-3: the changeFace forms (effects/handlers/face-ops.ts);
    // M6-4: convert, flip and the delayed self transform (effects/handlers/dfc-ops.ts), day and night (core/day-night.ts#OP_FORMS);
    // M6-6: the designateObject op (effects/handlers/levels.ts) with the designations it sets (OP_FORMS)
    const forms = ['op:copy.except', 'op:copy.permanentSpell', 'op:copy.spellExcept' /* CLOUD std-misc: a spell copy's types, colors and fixed P/T (CR 707.9b; token-defs.ts#exceptedSpellDef) */, 'op:changeFace.faceDown', 'op:changeFace.faceUp', 'op:changeFace.manifest', 'op:changeFace.convert', 'op:changeFace.flip',
      'op:changeFace.delayedSelf', 'op:designate.day', 'op:designate.initiative' /* MX4 */, 'op:designate.night', 'op:designate.speed' /* FAST5X-4 */, 'op:designateObject',
      'op:designateObject.classLevel', 'op:designateObject.solved', 'op:designateObject.prepared', 'op:designateObject.unprepared',
      'op:cast.costChange' /* M6-12: madness (effects/handlers/tokens-cast.ts#OP_FORMS) */,
      'op:cast.copy' /* FAST5X E26: paradigm, a copy of the card created in exile and cast (CR 707.12) */, 'op:cast.play' /* FAST5X E26: hideaway, a land played (CR 305.9) */,
      'op:cast.anyManaType' /* FAST5X E29: CR 609.4b (effects/handlers/tokens-cast.ts#OP_FORMS) */,
      'op:move.remember' /* FAST5X E13: craft's 'exiled cards used to craft it' (CR 702.167c) */,
      'op:move.attackingAsReturned' /* std-typechange-1: ninjutsu attacks what the returned creature attacked (CR 702.49c) */,
      'op:move.statusIf' /* std-typechange-2: "If that card is an enchantment card, it enters tapped and attacking" (CR 608.2c, 508.4) */,
      'op:move.arrangedBy' /* p2-dig-1: the player who arranges cards put back "in any order" (CR 401.4) */,
      'op:move.until' /* FAST4 MX1: "exile ... until ~ leaves the battlefield", CR 610.3 (effects/handlers/zones-move.ts#OP_FORMS) */,
      'op:exchange.control' /* MX2: exchange of control through layer 2 (core/control.ts#OP_FORMS) */,
      'op:removeCounters.upTo' /* FAST4 T31: "remove up to N counters" (effects/handlers/counters.ts#OP_FORMS) */,
      'op:putCounters.distribute' /* std-rx26: counters divided among objects chosen on resolution (effects/handlers/counters.ts#OP_FORMS) */,
      'op:putCounters.upTo' /* std-mana-2: "put up to N counters on <one object>", how many chosen on resolution (effects/handlers/counters.ts#OP_FORMS, CR 608.2d) */,
      'op:search.differentNames' /* FAST5 T42: "... cards with different names" (effects/handlers/cards-library.ts#OP_FORMS) */,
      'op:search.alsoZones', 'op:shuffle.ifSearched' /* CLOUD std-dft: "search your library and/or graveyard", "if you search your library this way, shuffle", CR 701.23a, 701.24a (effects/handlers/cards-library.ts#OP_FORMS) */,
      'op:search.and' /* CLOUD C9: "for a basic land card and a Shrine card", one card of each description (effects/handlers/cards-library.ts#OP_FORMS) */,
      'op:search.allZones' /* r4-refs: "search target opponent's graveyard, hand, and library", every zone listed, CR 701.23a (effects/handlers/cards-library.ts#OP_FORMS) */,
      'op:moveCounters.every' /* FAST5X E21: "put its counters on ...", every kind, CR 122.5, 122.8 (effects/handlers/counters.ts#OP_FORMS) */,
      'op:designateObject.saddled' /* FAST5X E3: the saddled designation, CR 702.171b (effects/handlers/levels.ts#OP_FORMS) */,
      'op:designateObject.suspected', 'op:designateObject.unsuspected' /* FAST5X E12: the suspected designation, CR 701.60a */,
      'op:designateObject.warped', // std-costs-2: the card warp's delayed triggered ability exiled is warped (CR 702.185a)
      'op:designateObject.harnessed' /* cloud r3-mech: "Harness ~", CR 701.64 (effects/handlers/levels.ts#OP_FORMS) */,
      'op:addMana.keepEndOfCombat' /* FAST5 MX6: firebending's mana lasts until end of combat, CR 702.189a (effects/handlers/cards-mana.ts#OP_FORMS) */,
      'op:designateObject.unlockDoor', 'op:designateObject.lockOrUnlockDoor' /* FAST5X E8: unlock / lock or unlock a door of a Room, CR 709.5f-g (effects/handlers/rooms.ts) */,
      'op:reflexive.if' /* FAST5X E16: a reflexive trigger that waits for a result of the step, CR 603.12, 120.10 (model/capabilities.ts) */,
      'op:chooseObjects.groupLimit' /* FAST5 T66: "up to two creature cards with total mana value 4 or less" (effects/handlers/choose.ts#OP_FORMS) */,
      'op:sacrificeChoice.keepEachType' /* FAST5 T66: "chooses a permanent of each permanent type and sacrifices the rest" (effects/handlers/zones-remove.ts#OP_FORMS) */,
      'op:sacrificeChoice.keepTypes', 'op:sacrificeChoice.keepFilter', 'op:sacrificeChoice.chooser' /* pc-players-1: Cataclysmic Gearhulk, Tragic Arrogance (effects/handlers/zones-remove.ts#OP_FORMS) */,
      'op:addMana.keepEndOfTurn' /* CLOUD std-mkm: "Until end of turn, you don't lose this mana as steps and phases end", CR 500.5, 106.4 (effects/handlers/cards-mana.ts#OP_FORMS) */,
      'op:pay.costLink' /* std-rx24: an exile cost's link, champion (CR 607.2k; effects/handlers/pay.ts#OP_FORMS) */, 'op:sacrificeChoice.exploit' /* std-rx17: an exploit ability's sacrifice (CR 702.110b; zones-remove.ts#OP_FORMS) */, 'op:sacrificeChoice.cantAs', 'op:discard.cantAs' /* C6: "each opponent who can't", the players who can't (CR 101.3; zones-remove.ts, cards-draw.ts#OP_FORMS) */,
      'op:sacrificeChoice.groupChooser' /* C6: the choosing player of a group read as iterating in the filter (CR 608.2e; zones-remove.ts#asChooser) */,
      'op:chooseObjects.startingWith', 'op:counter.toIf', 'op:counter.sourceEffect', 'op:discard.perPlayerCount', 'op:fromOutside.chosenAmong', 'op:gainLife.perPlayerAmount',
      'op:loseLife.perPlayerAmount', 'op:search.alsoOutside' /* std-rx30: "starting with you, each player chooses", counter riders, per-player amounts, cards from outside the game */,
      'op:chooseObjects.perPlayer' /* C6: "for each player, choose ... that player controls" (CR 608.2c, 101.4; choose.ts#OP_FORMS) */,
      'op:sacrificeChoice.perPlayerCount' /* r5-refs: the count of a group's sacrifice read for each choosing player (CR 608.2e, 101.4; zones-remove.ts) */,
      'op:chooseObjects.perPlayer.ownChoice' /* r5-refs: "each player chooses ... they control" (CR 101.4, 608.2d; choose.ts#choosePerPlayer) */,
      'op:effect.as' /* CLOUD std-tmt: a group's control change names the objects it locked, CR 611.2c, 608.2c (effects/handlers/lasting.ts#EFFECT_OP_FORMS) */,
      'op:addMana.chosenOr' /* CMD3: "Add {W} or one mana of the chosen color", the Thriving lands, CR 106.1b (effects/handlers/cards-mana.ts#OP_FORMS) */,
      'op:designate.citysBlessing' /* CMD3: ascend on an instant or sorcery, CR 702.131a (core/citys-blessing.ts) */,
      'op:cast.graveyardInstead' /* r4-repl: a spell cast during a resolution exiled or put on the bottom instead of a graveyard, CR 614.1a (effects/handlers/tokens-cast.ts#OP_FORMS) */,
      'op:cast.maxManaValue' /* std-rq: only a resulting spell of at most that mana value, CR 601.2, 202.3 (effects/handlers/tokens-cast.ts#OP_FORMS) */,
      'op:repeat.again' /* std-cardcopy-1: "repeat this process" with no count, CR 608.2c (effects/handlers/control.ts#OP_FORMS) */,
      'op:cast.select' /* std-cardcopy-7: one choice of the copies to cast, at most N or within a total mana value, CR 608.2d */,
      'op:exileUntil.total' /* std-rx31: "exile cards ... until you exile cards with total mana value N or greater", CR 406.1, 202.3 (effects/handlers/actions-native.ts#EXILE_UNTIL_OP_FORMS) */,
      'op:designateObject.plotted' /* r5-fxb: "It becomes plotted.", CR 702.170c-d (effects/handlers/levels.ts#OP_FORMS) */,
      'op:chooseObjects.eachCardType' /* std-library-3: "for each card type, you may exile a card of that type", CR 205.2a, 608.2d (effects/handlers/choose.ts#OP_FORMS) */,
      'op:pay.upTo' /* std-combat-2: "you may pay {1} up to three times", CR 118.12 (effects/handlers/pay.ts#OP_FORMS) */,
      'op:chooseObjects.link' /* std-control-1: the chosen object remembered for a linked ability, CR 607.2d (effects/handlers/choose.ts#OP_FORMS) */,
      'op:designate.speed.reduce' /* std-control-1: "reduce that opponent's speed by 1", with its floor, CR 702.179 */,
      'op:copy.gains' /* std-copy-1: "The copy gains haste and ...", riders on a spell copy, CR 707.10 */,
      'op:chooseObjects.distinct' /* std-library-1: "with different powers", no two chosen with one value of a statistic, CR 208.1, 608.2d (effects/handlers/choose.ts#OP_FORMS) */,
      'op:chooseObjects.damageSource' /* audit-fix-1: "a source of your choice", an ability on the stack offered and bound as its source, CR 609.7a (effects/handlers/choose.ts#OP_FORMS) */,
      'op:exchange.lifeToughness' /* p2-pt-1: a life total exchanged with a creature's toughness, CR 701.12a, 613.4b (effects/handlers/zones-status.ts) */,
      'op:flipCoin.untilLose' /* p2-coinflip-1: "flip a coin until you lose a flip", CR 705.1-705.2 (effects/handlers/game.ts#OP_FORMS) */,
      'op:draw.perPlayerCount' /* p2-zone-moves-1: "each player discards their hand, then draws that many cards", each player's own count, CR 121.2, 608.2e (cards-draw.ts#OP_FORMS) */,
      'op:moveCounters.anyKind', 'op:moveCounters.upTo' /* p2-counters-move-1: "move a counter from ...", "move any number of counters from ...", CR 122.5, 608.2d (effects/handlers/counters.ts#movePlan) */,
      'op:moveCounters.distribute' /* p2-counters-move-4: "move any number of +1/+1 counters from ~ onto other creatures", divided, CR 122.5, 608.2d (effects/handlers/counters.ts#moveDistributed) */,
      'op:fight.pairs' /* p2-damage-2: "each of those tokens fights a different one of those creatures", CR 701.14a, 608.2d (effects/handlers/lifedamage.ts#OP_FORMS) */,
      'op:search.shareLandType' /* pc-zones-2: "basic land cards that share a land type", CR 205.3i (effects/handlers/cards-library.ts#OP_FORMS) */,
      'op:flipCoin.called' /* p2-coinflip-3: "flip three coins. For each flip you win, ...", each flip called, CR 705.2 (effects/handlers/game.ts#OP_FORMS) */,
      'op:addMana.couldProduce.oneType' /* edh-mana-keywords-1: "add three mana of that type instead", one type for every unit, CR 106.1, 106.7 (effects/handlers/cards-mana.ts#OP_FORMS) */,
      'op:draw.upTo' /* edh-players-1: "its controller may draw up to two cards", the drawing player chooses how many, CR 121.1, 608.2d (cards-draw.ts#OP_FORMS) */,
      'op:changeTarget.to' /* edh-cast-1: "change a target of target spell or ability to ~", CR 115.7 (effects/handlers/change-target.ts#OP_FORMS) */];
    expect((byPrefix.get('op') ?? []).sort(), 'op').toEqual([...ops.map((op) => `op:${op}`), ...forms].sort());
    for (const op of ops) expect(Object.hasOwn(OP_HANDLERS, op) && Object.hasOwn(RENDERERS, op), op).toBe(true); // design 5.2: a handler AND a renderer
    expect((byPrefix.get('dur') ?? []).sort(), 'dur').toEqual(['duringNextTurn' /* std-control-1: "during that turn" of the next turn, CR 611.2a */, 'endOfCombat', 'endOfNextTurn' /* FAST5X E29 */, 'endOfTurn', 'permanent', 'remainsExiled' /* FAST5X E29 */, 'throughNextUntap' /* MX5: core/durations.ts#expireAfterUntapStep */, 'until', 'untilExiledWith' /* r5-dig: core/durations.ts#endDurations */, 'untilNextStep', 'untilNextTurn', 'whileObject' /* std-rx32: statics/while-object.ts */, 'whileSource'].map((d) => `dur:${d}`)); // not asLongAs (WP15 review: not judged live)
    // WP8 (triggers/) registers the event matchers the engine can emit (`dieRoll` since WP15's rollDie emits `dieRolled`); its features are checked below.
    expect((byPrefix.get('ev') ?? []).sort(), 'ev').toEqual(
      // M6-4: `dayNight` (core/designations.ts emits it; triggers/forms-dfc.ts#EMITS)
      ['abilityTriggered' /* std-copy-6: "whenever ... causes a triggered ability of that creature to trigger", CR 603.2 */, 'action', 'activate', 'attacks', 'attacksUnblocked' /* std-rx35 (CR 509.1h) */, 'beginTurn', 'becomes', 'becomesBlocked', 'blocks', 'cast', 'coinFlip' /* cloud r3-mech (CR 705.2) */, 'counters', 'createToken', 'damage', 'dayNight', 'dieRoll', 'draw', 'life', 'loseGame' /* M12-3 */, 'controlChange' /* r3-trig */, 'resolves', 'state', 'step', 'zoneChange'].map((e) => `ev:${e}`).sort(),
    );
  });

  it('the only features are the announcement ones of WP7 (actions/announce.ts#FEATURES), the event forms, batches, limits and history of WP8, the dependency one of WP9 and the restriction forms of WP16', () => {
    // `feature:token.<name>` (WP14 review) is built from the predefined tokens whose abilities run; tokens/review.test.ts recomputes it, so it isn't pinned here.
    expect((byPrefix.get('feature') ?? []).filter((c) => !c.startsWith('feature:token.')).sort()).toEqual([
      'feature:activate.onlyIf', 'feature:limit.game', 'feature:modes.chooser', 'feature:modes.cost', 'feature:modes.override',
      'feature:target.chooser', 'feature:target.distinct', 'feature:target.divide', 'feature:target.groupLimit', 'feature:target.onlyIf', 'feature:target.playerRef', 'feature:target.sameOwner', 'feature:target.differentNames', // FAST5 T42
      'feature:target.perOpponent', 'feature:target.sharedCardType', // FAST5 T66
      'feature:target.differentControllers', // CLOUD std-tmt: "controlled by different players" (CR 115.1)
      // The conditions, quantities and player references the announcement can really read (WP7 review 2): everything else stays a missing capability.
      'feature:announce.cond.all', 'feature:announce.cond.any', 'feature:announce.cond.ask', 'feature:announce.cond.compare', 'feature:announce.cond.exists',
      'feature:announce.cond.matches', 'feature:announce.cond.not', 'feature:announce.cond.turnOf', 'feature:announce.cond.wasCast',
      'feature:announce.count.each', 'feature:announce.counters.each', 'feature:announce.counters.self', 'feature:announce.exists.each', 'feature:announce.matches.self',
      'feature:announce.qty.X', 'feature:announce.qty.count', 'feature:announce.qty.counters', 'feature:announce.qty.startingLife' /* FAST5 T60 */, 'feature:announce.qty.distinct' /* FAST5X E13 */, 'feature:announce.qty.life', 'feature:announce.qty.math', 'feature:announce.qty.zoneSize',
      'feature:announce.qty.distinct.colors', // FAST5X E12: "activate only if there are five colors among permanents you control" (CR 105.1, 602.5b)
      'feature:announce.qty.descendedThisTurn', // FAST5X E22: "if you descended this turn, you may choose both instead" (CR 700.11, 700.2)
      'feature:announce.qty.countPlayers.controlsVs', // merge line D (std-sos's controlsVs): "activate only if an opponent controls more lands than you" (CR 102.3, 602.5b)
      'feature:announce.qty.countPlayers.controlsIs', // opp-port-1: "activate only if an opponent controls four or more lands", one opponent's own (CR 102.3, 602.5b)
      'feature:announce.cref.active', 'feature:announce.cref.anOpponent', 'feature:announce.cref.controllerOf.self', 'feature:announce.cref.ownerOf.self', 'feature:announce.cref.you',
      'feature:announce.sref.active', 'feature:announce.sref.anOpponent', 'feature:announce.sref.controllerOf.self', 'feature:announce.sref.controllerOf.target',
      'feature:announce.sref.ownerOf.self', 'feature:announce.sref.ownerOf.target', 'feature:announce.sref.target', 'feature:announce.sref.you',
      'feature:announce.cref.seat', 'feature:announce.sref.seat', // M12-2 (m12 design D6): "the player to your left / right" (CR 101.4)
      // WP8: the finer event forms whose events it emits (triggers/forms.ts) and the features of batches, limits and history
      'feature:ev.action.destroy', 'feature:ev.action.discard', 'feature:ev.action.exile', 'feature:ev.action.playLand', 'feature:ev.action.sacrifice', 'feature:ev.action.shuffle',
      'feature:ev.becomes.tapped', 'feature:ev.becomes.untapped', 'feature:history', 'feature:trigger.batch', 'feature:trigger.limit',
      // FAST4 T27: a condition of the trigger event, "for the first time each turn" (triggers/collect.ts) and "if you cast it" (the cast record's caster)
      'feature:trigger.while', 'feature:trigger.first', 'feature:wasCast.by',
      'feature:ev.counters.by', 'feature:trigger.limit.action', // FAST5X E21: "whenever you put ... counters" (CR 122.6), "Do this only once each turn" (CR 603.2h)
      // WP11: the replacement effects of an object's own abilities about itself (not those of other objects: milestone 6)
      'feature:replace.self',
      // M6-5a (push K1, m6 design D12): a replacement pattern's move cause (buyback's "as it resolves", CR 608.2n, 702.27a)
      'feature:replace.cause',
      // M6-5 (m6 design 3.8): the choice between grouped additional costs (CR 601.2b; actions/cast-kinds.ts#CAST_COST_FEATURES)
      'feature:additionalCost.choiceGroup', 'feature:castCost.granted', // M6-12: granted cast costs (actions/cast.ts#withGrantedCosts)
      'feature:triggerMod.enters', // M6-12: "that ability triggers an additional time" for a permanent entering (triggers/collect.ts#TRIGGER_MOD_CAPABILITIES)
      'feature:triggerMod.attacks', // std-rx2: a creature attacking causes the trigger (CR 508.1m, 603.2d; triggers/collect.ts#TRIGGER_MOD_CAPABILITIES)
      'feature:triggerMod.dies', // std-typechange-2: a creature dying causes the trigger, judged looking back (CR 603.10a, 603.2d; types/ability.ts#diesCause)
      'feature:triggerMod.any', // FAST5 T40: a triggerMod with no cause, whatever event triggers the ability (triggers/collect.ts#TRIGGER_MOD_CAPABILITIES)
      'feature:costMod.unlock', // std-rh: "Unlock costs you pay cost {1} less" (core/rooms.ts#listed via statics/costmods.ts#unlockManaCost, CR 116.2m, 709.5e, 118.7)
      'feature:rulemod.maxHandSize.delta', // std-ry3: "your maximum hand size is increased|reduced by N" (statics/hooks.ts#maxHandSize, CR 402.2)
      'feature:costMod.abilities.keyword', // FAST5 T60: "Exhaust abilities of other permanents you control cost {2} less to activate" (actions/activate.ts#costChangeOf, CR 601.2f, 602.2b)
      'feature:pregame.beginOnBattlefield', // FAST4 MX1: "you may begin the game with it on the battlefield" (CR 103.6a, core/pregame.ts#PREGAME_FEATURES)
      // M11-1: commander identity mana (CR 903.4) and abilities that function in the command zone (CR 113.6; core/commander.ts#COMMANDER_FEATURES)
      'feature:mana.commanderIdentity', 'feature:zone.command',
      // FAST5X E2: warp's delayed exile of the permanent its spell becomes (CR 702.185a, actions/cast-kinds.ts) and "a spell was warped" (CR 702.185c, triggers/match.ts)
      'feature:alternativeCost.delay', 'feature:ev.cast.via', 'feature:ev.cast.notFrom' /* Standard round 5, r5-trig (CR 601.2a) */, 'feature:ev.cast.nthMin' /* r5-trig (CR 601.2i) */,
      // FAST5X E7: sneak's instant timing in your declare blockers step and its "enters tapped and attacking" (CR 702.190a-b, actions/cast-kinds.ts)
      'feature:alternativeCost.instantSpeed', 'feature:alternativeCost.entersAttacking',
      // FAST5X E6: mayhem's "discarded this turn" (CR 702.187b) and harmonize's tapped creature and exile on leaving the stack (CR 702.180a-b), actions/cast-kinds.ts
      // FAST5 T56: flashback whose cost is the card's own mana cost ("The flashback cost is equal to its mana cost", CR 702.34a, actions/cast-options.ts)
      'feature:keyword.flashback.costIsManaCost',
      'feature:keyword.mayhem.costIsManaCost', // cloud r3-mech: "The mayhem cost is equal to its mana cost" (CR 702.187b, actions/cast-options.ts)
      // r5-cost: harmonize and embalm whose cost is the object's mana cost (CR 702.180a, 702.128a, keywords/expand.ts)
      'feature:keyword.costIsManaCost',
      'feature:alternativeCost.discardedThisTurn', 'feature:alternativeCost.tapReduces', 'feature:alternativeCost.exileOnLeave',
      // M6-0 (m6 design D2): the replacement pattern kinds the proposal pipeline translates (effects/registries.ts#PROPOSAL_KINDS)
      'feature:replace.on.action.destroy', 'feature:replace.on.counters', 'feature:replace.on.createToken', 'feature:replace.on.damage', 'feature:replace.on.draw',
      'feature:replace.on.life', 'feature:replace.on.step', 'feature:replace.on.zoneChange',
      // M6-1 (m6 design 3.1, 3.2, 7): other objects' replacement effects, "if an effect would" (CR 614.16), shields of every body, phases and turns (CR 614.10)
      'feature:replace.foreign', 'feature:replace.byEffect', 'feature:replace.byOpponent', 'feature:replace.on.phase', 'feature:replace.on.turn',
      'feature:shield.enters', 'feature:shield.instead', 'feature:shield.modify', 'feature:shield.redirect', 'feature:shield.skip',
      // WP14: the events its handlers emit (countered, attached, transformed, copies of spells; "unattached" waits for the zone-change and SBA paths, CR 701.3d)
      'feature:ev.action.counter', 'feature:ev.becomes.attached', 'feature:ev.becomes.transformed', 'feature:ev.cast.nthMatching' /* FAST5X E18 */, 'feature:ev.cast.orCopy', 'feature:ev.damage.excess' /* FAST5X E16, CR 120.10 */,
      // std-rx28: damage equal to the recipient's toughness, damage to the source's own target, a described activated ability (CR 120.1, 115.9b, 602.2); land and
      // nonland card-name choices (CR 201.3); increases of other objects' activation costs, mana abilities paid by hand (CR 601.2f, 605.1a)
      'feature:ev.damage.amountIsToughness', 'feature:ev.damage.toSourceTarget', 'feature:ev.activate.activated', 'feature:choose.cardKind', 'feature:costMod.abilities.increase',
      // WP32: becomes the target (triggered abilities too), triggered mana abilities without the stack, the native keyword actions
      'feature:ev.becomes.targeted', 'feature:trigger.mana', 'feature:action.native.cascade', 'feature:action.native.discover', 'feature:action.native.vote',
      // PUSH1 T1: the native keyword actions about counters (effects/handlers/actions-native-counters.ts)
      'feature:action.native.proliferate', 'feature:action.native.bolster',
      // M6-3 (m6 design 3.4, 7): face-down permanents: turned face up / down (triggers/forms-face.ts), turning face up as a replacement pattern, and the native
      // keyword actions manifest, cloak and manifest dread (effects/handlers/face-ops.ts)
      'feature:ev.becomes.turnedFaceUp', 'feature:ev.becomes.turnedFaceDown', 'feature:replace.on.turnFaceUp',
      'feature:action.native.manifest', 'feature:action.native.cloak', 'feature:action.native.manifestDread',
      // FAST5X E25: "manifest dread X times" (CR 701.62a), "shuffle that pile, then cloak them" (CR 701.58e), "whenever you manifest dread" (CR 701.62b)
      'feature:action.manifestDread.n', 'feature:action.cloak.shuffle', 'feature:ev.action.manifestDread',
      // M6-4 (m6 design 3.6, 7): converting and flipping (triggers/forms-dfc.ts), transforming as a replacement pattern (effects/proposal-kinds/transform.ts)
      'feature:ev.becomes.converted', 'feature:ev.becomes.flipped', 'feature:ev.becomes.melded', 'feature:replace.on.transform', 'feature:action.native.meld',
      // M6-6 (m6 design 3.7, 7): the layout structures (statics/levels.ts#LEVELS_FEATURES), a Class's level and a Case becoming solved as trigger events
      // (triggers/forms-levels.ts), and the level designation read as an activation restriction (actions/announce-cond.ts)
      'feature:chapter', 'feature:class.level', 'feature:leveler.bracket', 'feature:case', 'feature:prepare', 'feature:ev.becomes.classLevel', 'feature:ev.becomes.solved', 'feature:ev.becomes.prepared',
      'feature:announce.cond.classLevel', 'feature:announce.classLevel.self',
      // M6-9 (m6 design 3.7, 7): mutating (triggers/forms-merge.ts)
      'feature:ev.becomes.mutated',
      // FAST5X E3 (CR 702.171b): a permanent becoming saddled (triggers/forms-saddle.ts)
      'feature:ev.becomes.saddled',
      'feature:ev.becomes.crewCostPaid', 'feature:ev.becomes.saddleCostPaid', // Standard round 5, r5-trig: a creature tapped for a crew / saddle cost (CR 702.122b, 702.171c)
      'feature:ev.becomes.teamworkCostPaid', // std-rq: a creature tapped for a teamwork cost (CR 702.194a)
      'feature:ev.becomes.untapStep', // Standard round 5, r5-trig: the untap step's untaps (CR 502.3)
      // FAST5X E6 (CR 702.170a): a card becoming plotted (triggers/forms-plot.ts)
      'feature:ev.becomes.plotted',
      // FAST5X E8 (CR 709.5h-i): a door unlocked, a Room fully unlocked (triggers/forms-rooms.ts)
      'feature:ev.becomes.unlocked', 'feature:ev.becomes.fullyUnlocked',
      // MX2: layer-2 control on the stored controller (core/control.ts), a granted keyword's chosen-color quality (statics/mods.ts), a resolved copy effect
      // "except it has this ability" (effects/handlers/lasting.ts), the meld cards' "exile them, then meld them" (effects/handlers/meld-pair.ts)
      'feature:control.layered', 'feature:quality.chosen', 'feature:copy.thisAbility', 'feature:action.native.meldPair',
      // MX4: venture into the dungeon (effects/handlers/venture.ts), "whenever you complete a dungeon", "activate only if you've completed a dungeon"
      'feature:action.native.venture', 'feature:ev.action.completeDungeon', 'feature:announce.cond.completedDungeon',
      // FAST5 batch 2 merge (E5 + E9): "activate only if this land entered this turn" read from the history at announcement (actions/announce-cond.ts)
      'feature:announce.happened.selfEntered',
      // CMD2: freerunning's "you dealt combat damage to a player this turn with an Assassin or commander" read from the turn's history at announcement (CR 702.173a;
      // by std-blb's feature:announce.happened.turn since the wave-4 merge): the source filter fields the history facts answer
      ...['anyOf', 'not', 'controller', 'owner', 'types', 'subtypes', 'supertypes', 'colors', 'name', 'token', 'isCard', 'commander'].map((k) => `feature:announce.history.${k}`),
      'feature:action.native.learn', // FAST5 MX7: learn (CR 701.48a, effects/handlers/learn.ts)
      // FAST5X E1: gift (CR 702.174c): the giveGift action (effects/handlers/gift.ts) and "whenever you give a gift"
      'feature:action.native.giveGift', 'feature:ev.action.giveGift', 'feature:ev.action.exploit' /* std-rx17: CR 702.110b */,
      // MX3: the Ring tempts you (effects/handlers/ring.ts, core/ring.ts) and the trigger event it emits (triggers/forms.ts)
      'feature:action.native.ringTempts', 'feature:ev.action.ringTempts',
      // FAST5X E9: "whenever you scry / surveil", "you've scried or surveilled this turn" (effects/handlers/cards-library.ts emits them; triggers/forms.ts)
      'feature:ev.action.scry', 'feature:ev.action.surveil',
      // FAST5X E10: airbend (effects/handlers/airbend.ts, CR 701.65) and the events of airbending and of paying a waterbend cost (CR 701.65b, 701.67c; triggers/forms.ts)
      'feature:action.native.airbend', 'feature:ev.action.airbend', 'feature:ev.action.waterbend',
      'feature:action.native.behold', // FAST5X E11: behold (CR 701.4a, effects/handlers/behold.ts)
      'feature:action.native.collectEvidence', 'feature:ev.action.collectEvidence', // FAST5X E12: collect evidence (effects/handlers/evidence.ts), "whenever you collect evidence" (CR 701.59a)
      'feature:action.native.forage', 'feature:ev.action.forage', // FAST5X E28: forage (effects/handlers/forage.ts), "whenever you forage" (CR 701.61a)
      // M12-3: goad (CR 701.15a, effects/handlers/goad.ts) and its event; votes for words and players (CR 701.38b); "attacks you or a planeswalker you control"
      'feature:action.native.goad', 'feature:ev.action.goad', 'feature:vote.words', 'feature:vote.players', 'feature:ev.attacks.orPlaneswalker',
      // std-ry8: exert as an instruction is native and every exert emits its event (CR 701.43a); renown (CR 702.112a-b, "becomes renowned"); surge's "another spell this
      // turn" read at announcement (CR 702.117a); what happens after an attack option (exert, enlist) was taken (CR 603.12, core/attack-options.ts)
      'feature:action.native.exert', 'feature:ev.action.exert', 'feature:action.native.renown', 'feature:ev.becomes.renowned', 'feature:announce.qty.spellsCastThisTurn',
      'feature:rule.attackOption.then',
      'feature:ev.action.votesFinished', // M12F: "whenever players finish voting" (CR 701.38a; effects/handlers/actions-native.ts and effects/manual.ts emit it)
      // FAST5X E17: "your second main phase" (CR 505.1b, core/turn.ts numbers the main phases), "if a creature you controlled was destroyed this way" (CR 608.2h)
      'feature:ev.step.nth', 'feature:did.which', 'feature:did.which.move' /* FAST5 T75 */,
      // FAST5X E20: committing a crime (CR 700.13), expending N (CR 700.14), tapping as a player's action (CR 701.26a) and the kind of ability activated (CR 702.177a, 606.3); rules/crime.ts, triggers/forms.ts
      'feature:ev.action.commitCrime', 'feature:ev.action.expend', 'feature:ev.action.tap', 'feature:ev.activate.ability',
      // WP9: continuous effects in layers 1 to 6 may depend on one another (CR 613.8)
      'feature:dependency',
      // WP16: the restriction fields every wired rule hook honors (statics/hooks.ts); WP31 review: `other` per action, where the call-site names the other object
      'feature:restrict.when',
      'feature:restrict.max.cast', // FAST4 T24: "each player can't cast more than one spell each turn" (CR 601.2i)
      'feature:restrict.max.beBlocked', // MX5: "can't be blocked by more than one creature" (CR 509.1b, statics/hooks.ts#blockSetValid)
      'feature:restrict.min.beBlocked', // FAST5 T57: "can't be blocked except by three or more creatures" (CR 509.1b, statics/hooks.ts#blockSetValid)
      'feature:activate.anyPlayer', // MX5: "Any player may activate this ability" (CR 602.2, actions/activate.ts)
      'feature:activate.xMin', // std-rx12: "X can't be 0." (CR 107.3a, 602.2b; actions/activate.ts)
      'feature:activate.tapForMana', // std-rx27: tap creatures rather than pay an activation's generic mana (CR 601.2h, 602.2b; actions/activate.ts)
      'feature:activate.loyaltyX', // std-r9: "−X" (CR 606.4, 107.3a; actions/activate.ts, rules/cost.ts#planFromCostDef)
      'feature:restrict.otherPlayer.attackPlayer', // FAST4 T33: "can't attack you" (CR 508.1b-c, statics/hooks.ts#canAttack)
      'feature:restrict.exceptMana.activate', // FAST4 T33: "can't be activated unless they're mana abilities" (CR 605.1a, statics/hooks.ts#canActivate)
      'feature:restrict.alone.attack', 'feature:restrict.alone.block', // FAST5 T37: "can't attack or block alone" (CR 506.5, core/combat.ts via statics/hooks.ts#cantActAlone)
      ...['attack', 'block', 'beBlocked', 'beBlockedBy', 'beTargeted', 'cast', 'castFromZone', 'activate', 'playLand', 'beAttached', 'beEnchanted', 'beEquipped',
        'dealDamage', 'receiveDamage', 'sacrifice', 'discard', 'beCountered', 'preventCombatDamage' /* Cloud r5-repl */].map((a) => `feature:restrict.other.${a}`),
      // M6-7 (m6 design 3.9): the combat requirements that name the other creature (statics/hooks.ts, statics/requirements.ts)
      'feature:require.other.attack', 'feature:require.other.block', 'feature:require.other.beBlocked',
      'feature:require.player.attack', // M6-12: "attacks that opponent this turn if able" (encore, CR 702.141a)
      // WP16 review fix: the optional fields each wired permission honors (statics/hooks.ts PERMIT_FIELDS)
      'feature:permit.haveFlash.of', 'feature:permit.haveFlash.asThough', 'feature:permit.haveFlash.costChange' /* FAST5 T56: "as though it had flash if you pay {2} more" */, 'feature:permit.haveFlash.addCost' /* std-rx10: "as though it had flash if you behold a Dragon as an additional cost" */, 'feature:permit.attackAsThoughNoDefender.of', 'feature:permit.attackAsThoughNoDefender.asThough', 'feature:permit.activate.of', 'feature:permit.activate.asThough' /* r4-fxz: CR 302.6 */,
      'feature:permit.blockAsThough.of', 'feature:permit.blockAsThough.asThough', 'feature:permit.playLand.count',
      'feature:permit.blockAsThough.attacker', // p2-attack-block-1: "creatures with islandwalk can be blocked as though they didn't have islandwalk" (CR 609.4, 702.14c)
      'feature:permit.cast.laterTurn', 'feature:permit.play.laterTurn', // FAST5X E2: warp's "after the current turn has ended" (CR 702.185a, statics/play-permits.ts)
      'feature:permit.cast.linked.anyManaType', // std-rs (CR 607.2a, 609.4b): "you may cast the exiled card, and mana of any type can be spent to cast that spell" (statics/play-permits.ts)
      // std-rx27 (CR 607.2a, 601.3e, 118.9, 614.1c, 702.8a, 305.2): the riders of static linked cast permissions, a one-card permission, a top-card "enters with",
      // a graveyard land permission once each turn (statics/play-permits.ts); the first equip each turn and collect evidence linked (statics/costmods.ts, rules/pay-parts.ts)
      'feature:permit.cast.linked.of', 'feature:permit.cast.linked.oncePerTurn', 'feature:permit.cast.linked.entersWith', 'feature:permit.cast.linked.free', 'feature:permit.cast.linked.thisTurn',
      'feature:permit.haveFlash.linked', 'feature:permit.play.single', 'feature:permit.cast.single', 'feature:permit.cast.top.entersWith', 'feature:permit.play.zone.oncePerTurn',
      'feature:costMod.abilities.firstEachTurn', 'feature:cost.collectEvidence.link',
      // std-rx27 batch 2: the any-type rider of a static exile permission by description (statics/play-permits.ts#isExileFilterPermit)
      'feature:permit.play.exile.anyManaType', 'feature:permit.cast.exile.anyManaType',
      'feature:permit.cast.oncePerTurn', // FAST5X E14: "Once each turn, you may cast ... from the top of your library" (CR 601.3, statics/play-permits.ts)
      'feature:permit.play.zone.outside', // trek-11: "Once during each of your turns, you may play a permanent card you own from outside the game or from your graveyard" (CR 400.11, 305.1, 601.3, statics/play-permits.ts)
      // FAST5X E29: "and mana of any type can be spent to cast it" (CR 609.4b) and "you may play it if you control a Wizard" (statics/play-permits.ts)
      'feature:permit.play.anyManaType', 'feature:permit.cast.anyManaType', 'feature:permit.play.while', 'feature:permit.cast.while',
      // FAST5 T37: monstrosity (effects/handlers/actions-native-counters.ts) and the events it and cycling emit (triggers/forms.ts), adamant's cast-history condition (CR 601.2h)
      'feature:action.native.monstrosity', 'feature:ev.becomes.monstrous', 'feature:ev.action.cycle', 'feature:wasCast.spent',
      // WP13: structured spending restrictions on added mana (CR 106.6)
      'feature:mana.restriction',
      'feature:mana.restriction.unlock', // FAST5X E8: mana that may pay unlock costs (CR 709.5e, rules/sources.ts#spendAllows)
      'feature:mana.restriction.abilityKeyword', 'feature:mana.restriction.turnFaceUp', 'feature:mana.restriction.notSpells', // FAST5X E23: equip abilities, turning face up, "can't be spent to cast" (CR 702.6a, 116.2b, 106.6)
      // FAST5 T38: "one mana of any type that land produced" (effects/handlers/cards.ts), an ability's own cost change (actions/announce.ts) and "open an Attraction" (effects/handlers/attraction.ts)
      'feature:mana.eventProduced', 'feature:activate.costChange', 'feature:action.native.openAttraction',
      // FAST4 T21: cost modifiers read from the spell's chosen targets, and mana applied several times (statics/costmods.ts, CR 601.2c, 601.2f)
      'feature:costMod.spellTargets.self', 'feature:costMod.times', 'feature:spellTargetCount.filter',
      // FAST5X E19: the spell whose mana spent is read, and mana from a source of one subtype (CR 601.2h, 106.3; effects/eval.ts#QTY_FEATURES)
      'feature:spellManaSpent.of.event', 'feature:spellManaSpent.of.self', 'feature:spellManaSpent.from.subtype',
      'feature:q.countPlayers.sizeVs' /* FAST5 T53: "an opponent has more cards in hand than you", CR 402.1, 102.3 (effects/eval.ts#QTY_FEATURES) */,
      'feature:q.countPlayers.controlsIs' /* std-rx12: "the number of opponents who control an artifact", CR 102.3, 108.4 (effects/eval.ts#QTY_FEATURES) */,
      'feature:q.countPlayers.poisonIs', 'feature:announce.qty.countPlayers.poisonIs' /* std-rx24: "an opponent has three or more poison counters", CR 122.1f (effects/eval.ts#QTY_FEATURES, actions/announce-cond.ts) */,
      'feature:permit.cast.exileOnLeave' /* std-rx24: jump-start, CR 702.133a (statics/play-permits.ts) */,
      'feature:q.countPlayers.controlsVs' /* std-sos review: "an opponent controls more lands than you", each opponent alone, CR 102.2, 102.3 (effects/eval.ts#QTY_FEATURES) */,
      // FAST5 T50: a delayed trigger's "one or more" / "whenever you attack" batch (triggers/delayed.ts, CR 603.2c)
      'feature:delay.batch',
      // FAST5 T64: a copy effect that picks one of several objects ("a creature card exiled with it", effects/copy.ts, CR 607.2a)
      'feature:copy.choose',
      // std-hob: "for each graveyard with seven or more cards in it" (effects/eval.ts#QTY_FEATURES, CR 404.1, 402.1)
      'feature:q.countPlayers.sizeIs',
      // std-tdm: "activate only if a card left your graveyard this turn": a history condition of this turn read at announcement (actions/announce-cond.ts, CR 602.5b);
      // std-blb adds the same feature ("activate only if an opponent lost life this turn"): one implementation, model/forms.ts#turnHistoryAtAnnouncement
      'feature:announce.happened.turn',
      // std-tdm: "whenever a creature you control enters, if you cast it": the cast record of the object that entered (effects/eval.ts, CR 601.2a, 603.4)
      'feature:wasCast.object',
      // std-tdm: a delayed trigger's own targets, chosen when it is put on the stack (triggers/delayed.ts#delayedAbility, CR 603.7, 603.3d)
      'feature:delay.targets',
      // std-blb: pawprint modes (CR 700.2i) and a mode chosen more than once with targets of its own (rules/mode-instances.ts, CR 700.2d, 115.3)
      // (actions/announce.ts#FEATURES)
      'feature:modes.pawprints', 'feature:modes.repeatTargets',
      // cloud std-spm: "double the number of each kind of counter on ..." (effects/handlers/actions-native-counters.ts, CR 701.10e)
      'feature:action.native.doubleEachKind',
      'feature:action.native.anotherOfEachKind', // r5-refs: another counter of each kind (CR 122.6, 701.34a)
      'feature:lifeLost.who', // cloud std-spm: "if you lost life this way" (effects/eval.ts#QTY_FEATURES, CR 119.3)
      'feature:ev.action.playLand.from', // cloud std-spm: "whenever you play a land from exile" (triggers/forms.ts, CR 305.1)
      // CLOUD std-ecl: "activate only if you attacked with two or more creatures this turn" read from the history at announcement (actions/announce-cond.ts, CR 508.1, 602.5b)
      'feature:announce.happened.attackedWith',
      'feature:announce.qty.happenedCount.damageTotal', // std-rB: "activate only if red sources you controlled dealt 4 or more noncombat damage this turn" (CR 602.5b, 120.1)
      // CLOUD std-ecl: "two target creature cards that share a creature type" (rules/targets.ts#sharedCreatureTypeHolds, CR 205.3m, 115.1)
      'feature:target.sharedCreatureType',
      // std-lci: explore reports each explore (effects/handlers/explore.ts, CR 701.44a-b) and its revealed card (its activation restrictions over the turn's zone
      // changes are read by std-blb's feature:announce.happened.turn since the merge of lines C and D)
      'feature:action.native.explore', 'feature:ev.action.explore', 'feature:ev.action.explore.revealed',
      'feature:mana.rider.cantBeCountered', // std-lci: "and that spell can't be countered" (CR 106.6: actions/cast.ts flags the spell, the counter op honors it)
      'feature:q.countPlayers.lifeVs', // std-lci: "the player with the most life or tied for most life" (CR 119.1: the players whose life total beats a player's)
      'feature:ev.cast.manaFromSelf', // std-lci: "whenever you cast a permanent spell using mana produced by ~" (CR 106.3: actions/cast.ts names the mana's sources)
      // Cloud std-woe: "Activated abilities of lands you control cost {1} less to activate", mana abilities too (statics/costmods.ts#abilityManaCost, CR 601.2f, 605.1a)
      'feature:costMod.abilities.reduce',
      // cloud std-dsk: "whenever you turn a permanent face up", the player who turned it (triggers/forms-face.ts, triggers/forms.ts; CR 702.37e, 708.2)
      'feature:ev.becomes.turnedFaceUp.player',
      'feature:q.countPlayers.lostLife' /* CLOUD std-mkm: "for each opponent who lost life this turn", CR 119.3 (effects/eval.ts#QTY_FEATURES) */,
      'feature:q.countPlayers.lostLifeIs' /* std-rp: "if an opponent lost 3 or more life this turn", CR 119.3 (effects/eval.ts#QTY_FEATURES) */,
      // Cloud C7: "for each creature destroyed this way", what a step reports it moved (effects/eval.ts#QTY_FEATURES, CR 608.2c, 608.2h)
      'feature:resultCount.which',
      // C10: a graveyard permission's additional cost and "enters with" rider (CR 601.2f, 614.1c; statics/play-permits.ts#isGraveyardPermit)
      'feature:permit.cast.addCost', 'feature:permit.cast.entersWith',
      // Cloud C3 follow-up: a static goad, "enchanted creature is goaded" (CR 701.15a-c; statics/requirements.ts#goadHits, statics/rule-sources.ts#staticGoaders)
      'feature:require.goad',
      // CLOUD std-misc: coven's different powers (effects/eval.ts#QTY_FEATURES, CR 208.1), at announcement too (actions/announce-cond.ts, CR 602.5b), and
      // "whenever one or more players discard one or more cards" (triggers/collect.ts, CR 603.2c)
      'feature:q.distinct.powers', 'feature:q.distinct.colorPairs' /* r4-mech */, 'feature:permit.activateLoyaltyAsInstant.of' /* r4-mech */, 'feature:announce.qty.distinct.powers.each', 'feature:trigger.batch.whole',
      'feature:q.countPlayers.lifeIs', 'feature:q.distinct.counterKinds', // r4-static
      // r5-static: "has all activated abilities of ..." (statics/mods.ts, CR 613.1f); the limits on a whole declaration (statics/hooks.ts#declarationLimits, CR
      // 508.1c, 509.1b); a static ability's effects while its condition is false (statics/live.ts, statics/rule-sources.ts, CR 611.3a)
      'feature:layer6.addActivatedOf', 'feature:restrict.max.attack', 'feature:restrict.max.attackPlayer', 'feature:restrict.max.block', 'feature:static.otherwise',
      // CLOUD std-misc: "Creatures entering don't cause abilities to trigger" (triggers/collect.ts#TRIGGER_MOD_CAPABILITIES, #suppressed; CR 603.2, 603.6a)
      'feature:triggerMod.suppress.enters',
      'feature:triggerMod.suppress.keyword', // std-rx32: "Ward abilities of <objects> don't trigger" (triggers/collect.ts#silencedKeywords, CR 702.21a, 603.2)
      // Cloud r3-repl: the life loss damage causes is proposed (rules/damage.ts#installLifeLossFunnel, CR 120.3a, 614.1a) and a token replacement's token filter
      // is read from the token's definition (effects/replacements.ts#tokenDefMatches, CR 111.1)
      'feature:replace.life.loss.fromDamage', 'feature:replace.createToken.token',
      'feature:replace.on.action.mill', // Cloud r3-repl: the mill proposal kind (effects/proposal-kinds/mill.ts, CR 701.17a, 614.1a)
      'feature:replace.on.action.connive', // Cloud r3-repl: the connive proposal kind (effects/proposal-kinds/connive.ts, CR 701.50a, 614.1a)
      'feature:replace.on.action.draw', // Cloud r4-repl: the drawMany proposal kind, a draw of N cards as one event (effects/proposal-kinds/draw-many.ts, CR 121.2, 614.1a)
      'feature:replace.on.action.explore', // Cloud r4-repl: the explore proposal kind (effects/proposal-kinds/explore.ts, CR 701.44a, 614.1a)
      'feature:replace.on.action.payLife', // std-library-4: the payLife proposal kind, a payment of life (effects/proposal-kinds/pay-life.ts, CR 119.4, 614.1a)
      // Cloud r5-repl: "If that spell would be put into a graveyard, exile it instead" on a cast permission (statics/play-permits.ts, effects/rule-replacements/permit-graveyard.ts; CR 614.1a)
      'feature:permit.cast.graveyardInstead',
      // Cloud r5-repl: "except the first one you draw in each of your draw steps" (effects/replacements.ts#matchProposed, CR 504.1)
      'feature:replace.draw.exceptFirstInDrawStep',
      // r3-choose: "choose one that hasn't been chosen [this turn]" (actions/announce.ts#usedModes, CR 700.2, 603.3c)
      'feature:modes.unchosen',
      // r3-choose: the triggering event's amount read at announcement, "up to that many target creatures" (actions/announce-cond.ts#announceQty, CR 603.3d)
      'feature:announce.qty.eventAmount', 'feature:announce.qty.kickCount' /* pc-zones-3 */,
      // Standard round 3, r3-trig: the modes chosen for the spell of a cast trigger read at announcement (CR 700.2, 603.3c), a modal spell cast (CR 700.2) and the
      // total power of a declaration's attackers (CR 508.1) as event forms (triggers/forms.ts)
      'feature:announce.qty.modesChosen', 'feature:ev.cast.modal', 'feature:ev.attacks.power', 'feature:ev.cause.craft' /* exiled as craft's material, CR 702.167a */,
      // r3-cost: "This effect can't reduce the mana in that cost to less than one mana" (statics/costmods.ts#modifyMana, CR 601.2f, 118.7)
      'feature:costMod.floor.one',
      'feature:costMod.plot', // std-rx26: the plot action's cost (core/special/plot.ts#plotCostAfterMods)
      'feature:ev.action.discover', // std-rx26: "whenever you discover" (effects/handlers/actions-native.ts emits it)
      // r3-cost: "X can't be greater than ..." on an additional cost (actions/cast.ts#xCap, CR 107.3, 601.2b) and "Add {A} or {B} for each ..." (rules/mana.ts, CR 106.1)
      'feature:additionalCost.xMax', 'feature:mana.anyColor.from',
      'feature:additionalCost.chooseType', // std-costs-2: a creature type chosen as an additional cost is announced (actions/cast-costs.ts, CR 601.2b, 607.2d)
      'feature:q.commanderCasts.of', // CMD2: another player's commander casts (effects/eval.ts#QTY_FEATURES; Commander's Insight, CR 903.8)
      'feature:createToken.attackingWhom', // cmd1: tokens created attacking a named player (effects/handlers/tokens-create.ts, CR 508.4)
      'feature:createToken.exceptReplaced', // pc-tokens-2: a step of a token-creation replacement that skips the very token being replaced (effects/handlers/tokens-create.ts, CR 614.5)
      'feature:wasCast.fromOwner', // Standard round 4, r4-trig: "if it was cast from your graveyard" (effects/eval.ts#wasCast, CR 400.3, 601.2a)
      // Standard round 4, r4-trig: a land played from anywhere other than the hand (CR 305.1) and a player who becomes the target (CR 115.1) as event forms (triggers/forms.ts)
      'feature:ev.action.playLand.notFrom', 'feature:ev.becomes.targeted.player',
      'feature:ev.action.search', 'feature:ev.action.search.ownLibrary', // Standard round 4, r4-trig: a search of a library and whose it was (CR 701.23a)
      'feature:spellManaSpent.of.target', // r4-fxb: the mana spent on the target spell, "if that spell's mana value ..." (effects/eval.ts#QTY_FEATURES, CR 601.2h)
      'feature:announce.qty.stat.self', // r4-fxb: the source's own power or mana value read at announcement (actions/announce-cond.ts, CR 208.1, 202.3)
      'feature:announce.qty.stat.sum.each', // std-ry5 (formidable): the powers of a group added up at announcement (actions/announce-cond.ts, CR 602.5b, 208.1)
      // r4-cost: "This ability costs {1} less to activate during your turn" (actions/activate.ts#costChangeOf, CR 601.2f, 602.2b)
      'feature:activate.costChange.if',
      // r4-cost: "activate only if a player has one or fewer cards in hand" and "... four or more permanent types among cards in your graveyard" (actions/announce-cond.ts, CR 602.5b)
      'feature:announce.qty.countPlayers.sizeIs', 'feature:announce.qty.distinct.permanentTypes.each', 'feature:q.distinct.permanentTypes',
      // r4-cost: an activated ability's targets in its cost (statics/costmods.ts#targetValue, CR 601.2c, 601.2f) and a keyword's cost change (keywords/expand.ts, CR 702.6a)
      'feature:cost.abilityTargets', 'feature:keyword.costChange',
      'feature:q.countPlayers.didNot', // r5-fxz: the players who didn't discard such a card in an earlier step (effects/eval.ts#QTY_FEATURES, CR 701.9a, 608.2c)
      // r5-cost: a triggered ability's "choose up to X --", X the X its source was cast with (actions/announce.ts#modeLimits, CR 107.3m, 603.3c)
      'feature:modes.triggerX',
      // r5-cost: "cost an additional 3 life to cast" (actions/cast.ts#modifiedPlan, CR 601.2f, 119.4)
      'feature:costMod.life',
      'feature:q.distinct.planeswalkerTypes', // r5-fxb: "the number of planeswalker types among planeswalkers you control" (effects/eval.ts#QTY_FEATURES, CR 205.3j)
      'feature:target.sameController', // std-rx30: "controlled by the same opponent" (actions/announce.ts#FEATURES, CR 115.1)
      'feature:target.perCardType', // std-cardcopy-7: "of each card type" (actions/announce.ts#FEATURES, CR 115.1, 205.2a)
      'feature:target.perPlayer', // r5-fxb: "for each player, ... up to one target creature that player controls" (actions/announce.ts#FEATURES, CR 601.2c)
      'feature:target.random', // p2-damage-2: "target creature an opponent controls chosen at random" (actions/announce.ts#FEATURES, CR 601.2c, 603.3d)
      'feature:delayed.step.anyMain', // r5-fxb: "at the beginning of your next main phase" (triggers/delayed.ts#fires, CR 505.1)
      'feature:lookback.attachments', // r5-fxb: "whenever a modified creature you control leaves the battlefield" (LastKnown.attached, CR 603.10a, 700.9)
      // r5-dig: a face-down and a face-up pile (effects/handlers/cards-reveal.ts#faceDownPiles, CR 700.3) and "cast it ... as an Adventure" (statics/play-permits.ts, CR 715.3)
      'feature:piles.faceDown', 'feature:permit.cast.asAdventure',
      // std-ru: "If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost" on a linked permission (statics/play-permits.ts, CR 118.9)
      'feature:permit.play.linked.lifeCost', 'feature:permit.cast.linked.lifeCost',
      // std-rx3: "you may cast those cards without paying their mana costs" on a permission for named objects (statics/play-permits.ts#isFreeCost, CR 118.9, 601.2b)
      'feature:permit.cast.free', 'feature:permit.play.free',
      // std-mana-1: riders on mana spent on a spell (core/mana-riders.ts, CR 106.6) and "tap <a permanent> for mana" read with the activation's {T} (rules/mana.ts, CR 106.12)
      'feature:mana.spentRider', 'feature:mana.spentRider.entersWith', 'feature:trigger.tappedForMana',
      'feature:mana.devotionColor', // p2-mana-2: "choose a color. add an amount of mana of that color equal to your devotion to that color" (effects/handlers/cards-mana.ts, CR 700.5)
      // std-exile-play-2-1: the life cost on a resolved permission for named objects (statics/play-permits.ts#namedLifeCost, CR 118.9); an additional cost on a
      // static linked cast permission (isLinkedRiderPermit, CR 601.2f, 118.8)
      'feature:permit.play.named.lifeCost', 'feature:permit.cast.named.lifeCost', 'feature:permit.cast.linked.addCost',
      'feature:mana.couldProduce', // p2-mana-1: "one mana of any color that a land an opponent controls could produce" (effects/handlers/cards-mana.ts, CR 106.7)
      // std-freecast-1: "The first spell each player casts during each of their turns may be cast without paying its mana cost" (statics/play-permits.ts#grantedAlternatives, CR 118.9, 601.2b)
      'feature:permit.cast.alternative.firstSpell',
      // std-freecast-2: "you may cast a creature spell from your graveyard this turn. If you do, it enters with ... and is a Vampire in addition to its other types" (statics/play-permits.ts#gyHits, CR 601.3, 205.1b)
      'feature:permit.cast.zone.single', 'feature:permit.cast.entersSubtypes',
      // std-exile-play-2-3: "by waterbending {X} rather than paying its mana cost" on a cast permission for named objects (statics/play-permits.ts#isWaterbendCost)
      'feature:permit.cast.named.waterbend',
      'feature:additionalCost.announceCount', // std-costs-1: the number announced with an optional cost (actions/cast-costs.ts, CR 601.2b)
      'feature:layer6.addActivatedOf.limit', // std-craft-2: "You may activate each of those abilities only once each turn" (statics/mods.ts#limitedEachTurn, CR 602.5b)
      'feature:layer6.addActivatedOf.triggered', // std-cardcopy-9: "has all activated and triggered abilities of" (statics/layers.ts#FEATURES, CR 613.1f)
      // std-exile-play-1-1: the life cost on a top-card permission (CR 118.9) and "a spell they don't own" (CR 108.3, triggers/forms.ts)
      'feature:permit.play.top.lifeCost', 'feature:permit.cast.top.lifeCost', 'feature:ev.cast.notOwnedByCaster',
      // std-copy-1: "This ability can't be copied." (effects/handlers/tokens-copy.ts#copySpells, CR 707.10)
      'feature:activate.uncopiable',
      // std-control-1: speed compared with each other player's (CR 702.179) and "power-up abilities can't be activated" (CR 602.5)
      'feature:q.countPlayers.speedVs', 'feature:restrict.abilityKeyword.activate',
      // std-mana-12: "whenever you earthbend" and "whenever you firebend" (triggers/forms.ts; the reportAction step, CR 701.66a, 702.189)
      'feature:ev.action.earthbend', 'feature:ev.action.firebend',
      // std-exile-play-2-4: a resolved permission for the objects an `each` filter picks, locked as the effect begins (effects/handlers/lasting.ts)
      'feature:permit.play.lockedSet', 'feature:permit.cast.lockedSet',
      'feature:resultCount.maxPerOwner', // p2-zone-moves-1: "the greatest number of cards a player discarded this way" (effects/eval.ts)
      // p2-player-rules-1: "can't draw more than one card each turn" (CR 121.1) and "can't cast more than one noncreature spell each turn" (CR 601.2i, statics/hooks.ts#castCountOfKind)
      'feature:restrict.max.draw',
      'feature:restrict.max.cast.other',
      'feature:mana.whenSpent', // std-copy-3: "When that mana is spent to cast ..." (rules/mana.ts, actions/cast.ts#manaSpentTriggers, CR 106.6, 603.2)
      ...['types', 'notTypes', 'allTypes', 'subtypes', 'notSubtypes', 'allSubtypes', 'supertypes', 'notSupertypes', 'colors', 'notColors', 'colorless', 'multicolored', 'monocolored', 'stackKind', 'zone'].map((k) => `feature:restrict.max.cast.other.${k}`),
      // std-exile-play-1-3: "players may play cards they exiled this way", "Each spell cast this way costs {1} more to cast", "Each land played this way enters tapped" on a permission for named objects (statics/play-permits.ts, CR 400.3, 601.2f, 614.1c)
      'feature:permit.play.ownOnly', 'feature:permit.cast.ownOnly', 'feature:permit.play.increase', 'feature:permit.cast.increase', 'feature:permit.play.landsEnterTapped',
      // audit-fix-1: only the bound objects that matched `which` as they were moved ("another" after each player's sacrifice; effects/refs.ts, CR 608.2h)
      'feature:ref.bound.which',
      // p2-replace-events-2: the proliferate proposal kind (effects/proposal-kinds/proliferate.ts, CR 701.34a, 614.1a)
      'feature:replace.on.action.proliferate',
      // p2-replace-events-3: "would begin an extra turn" in a replacement pattern (effects/propose.ts#FEATURES, triggers/match.ts#beginTurn, CR 500.7, 614.10)
      'feature:replace.beginTurn.extra',
      // p2-replace-events-3: the scry proposal kind (effects/proposal-kinds/scry.ts, CR 701.22a, 614.1a)
      'feature:replace.on.action.scry',
      // p2-misc-1: "Creatures dying don't cause abilities to trigger", judged looking back (CR 603.10a, 603.2; triggers/collect.ts#suppressed)
      'feature:triggerMod.suppress.dies',
      // p2-group-actions-1: "the highest / lowest life total among all players" (effects/eval.ts, statics/match.ts; CR 119.1)
      'feature:q.life.agg',
      'feature:announce.matches.attachedTo', // p2-cost-parts-1: "activate only if enchanted creature is untapped" (CR 303.4, 602.5b)
      // p2-graveyard-2: "players can't cast spells from graveyards or libraries" (CR 601.3, statics/hooks.ts#canCast tells the zone)
      'feature:restrict.fromZones.castFromZone',
      // p2-graveyard-2: "If a spell cast this way would be put into your graveyard, exile it instead" on a graveyard permission (actions/cast.ts, CR 614.1a)
      'feature:permit.cast.zone.graveyardInstead',
      // p2-cost-statics-2: "spells your opponents cast that target a creature you control", a filter of the spell's targets in a cost modifier (statics/costmods.ts, CR 115.9b, 601.2f)
      'feature:costMod.spellTargets.each',
      'feature:ev.action.proliferate', // p2-counters-move-1: "whenever you proliferate" (CR 701.34a; effects/handlers/actions-native-counters.ts#proliferateOnce emits it)
      // p2-cost-statics-1: "if an opponent cast three or more spells this turn" read at announcement from each opponent's turnStats (actions/announce-cond.ts, CR 601.2i, 118.9)
      'feature:announce.qty.happenedCount.opponentSpellsPerPlayer',
      'feature:modes.random', // p2-modal-2: "choose one at random --" and "you choose one instead" (actions/announce.ts#chooseModes, CR 700.2)
      // p2-player-rules-3: "whenever you clash" / "whenever you clash and win" (CR 701.30b-c; effects/handlers/cards-library.ts#clashHandler emits the action)
      'feature:ev.action.clash', 'feature:ev.action.clash.won',
      'feature:ev.action.faceDilemma', // trek-2: "whenever you face a dilemma", one or more modes chosen (actions/announce.ts#chooseModes emits it; CR 700.2)
      'feature:triggerMod.lifeGain', // trek-2: "if you gaining life causes a triggered ability ... to trigger" (triggers/collect.ts#TRIGGER_MOD_CAPABILITIES, CR 603.2d)
      'feature:announce.qty.distinct.names.each', // trek-5: "activate only if you control seven or more differently named lands" (actions/announce-cond.ts, CR 201.2, 602.5b)
      'feature:permit.play.anyManaColor', 'feature:permit.cast.anyManaColor', // pc-exile-play-1: "you may spend mana as though it were mana of any color to cast that spell" on a permission for named objects (CR 609.4b, 107.4c; statics/play-permits.ts#anyManaColorPermit)
      // pc-statics-1: the condition of a keyword's cost change, "Equip {2}. This ability costs {2} less to activate if you have one or fewer cards in hand." (keywords/expand.ts, CR 601.2f)
      'feature:keyword.costChange.if',
      // p2-trigger-events-1: "whenever a player mills a nonland card" (CR 701.17a; triggers/normalize.ts reports a milled card as its owner's action `mill`)
      'feature:ev.action.mill',
      // edh-mana-keywords-1: "Exile this card from your hand: Add {G}." (rules/mana.ts#manaAbilityDenial, CR 113.6, 605.1a)
      'feature:mana.activation.hand',
      // edh-players-1: "whenever an opponent draws a card except the first one they draw in each of their draw steps" (CR 504.1; triggers/normalize.ts marks the first draw of the step, match.ts reads it)
      'feature:ev.draw.exceptFirstInDrawStep',
    ].sort());
  });

  it('WP9 lists the layers it implements and its static kind (M6-2: 1a; M6-3: 1b; M6-8: 3); WP16 the restriction, permission, rule and cost kinds', () => {
    expect((byPrefix.get('layer') ?? []).sort()).toEqual(['layer:1a', 'layer:1b', 'layer:2', 'layer:3', 'layer:4', 'layer:5', 'layer:6', 'layer:7a', 'layer:7b', 'layer:7c', 'layer:7d']);
    // WP9 continuous, WP16 the restriction, permission, rule and cost kinds, WP11 replace (the proposal pipeline), M6-5a the cast costs (actions/cast-kinds.ts)
    expect((byPrefix.get('static') ?? []).sort()).toEqual(['static:additionalCost', 'static:alternativeCost', 'static:continuous', 'static:costMod', 'static:permit', 'static:replace', 'static:restrict', 'static:rule', 'static:triggerMod' /* M6-12 */, 'static:pregame' /* FAST4 MX1: core/pregame.ts */, 'static:castWith' /* FAST5X E2: actions/cast-options.ts */, 'static:deckConstruction' /* CMDF: core/commander.ts, CR 113.6n */].sort());
  });

  it('what milestones 3 and 4 implement is listed: the cost parts, target kinds, filter fields and every decision kind', () => {
    // WP7: every cost part kind of the model and every target kind is payable / announceable; the value forms are listed in COST_FORMS.
    expect(byPrefix.get('cost')!.filter((c) => !c.includes('.')).sort()).toEqual([
      'cost:action', 'cost:behold' /* FAST5X E11, CR 701.4a */, 'cost:chooseObject' /* std-costs-2, CR 601.2b */, 'cost:discard', 'cost:exileFrom', 'cost:getCounters' /* FAST5X E27, CR 122.1f */, 'cost:manual', 'cost:mill', 'cost:oneOf' /* FAST5X E27, CR 601.2b */, 'cost:payEnergy', 'cost:payLife', 'cost:putCounters', 'cost:putIntoLibrary' /* trek-9, CR 118.3, 401.4 */, 'cost:removeCounters', 'cost:returnToHand', 'cost:reveal', 'cost:revealChosen' /* std-combat-5, CR 608.2d */,
      'cost:sacrifice', 'cost:tapPower', 'cost:tapUntapped',
      'cost:untapTapped' /* p2-cost-parts-1, CR 701.26b */,
    ]);
    expect(byPrefix.get('target')!.sort()).toEqual(['target:ability', 'target:anyTarget', 'target:object', 'target:objectOrPlayer', 'target:player', 'target:spell', 'target:stackObject']);
    expect(ENGINE_CAPABILITIES.has('filter:power')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('filter:sharesWith')).toBe(true); // evaluated by WP4 with a FilterEnv; advertised since every call site passes one (WP30, rules/filter-env.ts)
    expect(ENGINE_CAPABILITIES.has('filter:dealtDamageThisTurn')).toBe(true); // the history fields come with the package that writes the history (WP8: feature:history)
    expect(byPrefix.get('decision')).toHaveLength(19); // M11-0: commanderZone (CR 903.9)
    expect(ENGINE_CAPABILITIES.has('decision:chooseDivision')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('decision:chooseName')).toBe(true);
  });

  it('is a pure function of the tables: building again gives the same set', () => {
    expect([...buildEngineCapabilities()].sort()).toEqual([...ENGINE_CAPABILITIES].sort());
  });
});

describe('a table entry creates the capability, and only the right entries', () => {
  const handlers = OP_HANDLERS as Record<string, unknown>;
  const renderers = RENDERERS as Record<string, unknown>;
  const stub = () => ({ performed: true, count: 1 });
  /** Put back exactly what a table held before the test (QT: the tables are shared by every test file of a worker in the default suite). */
  const restore = (table: Record<string, unknown>, key: string, had: boolean, value: unknown): void => {
    if (had) table[key] = value;
    else delete table[key];
  };

  it('an op is a capability only when it has a handler AND a renderer (design 5.2)', () => {
    const renderer = renderers['draw']; // WP2 renders every op; take this one away to see the handler alone
    const hadHandler = Object.hasOwn(handlers, 'draw'); // WP13 brought the real draw handler
    const handler = handlers['draw'];
    expect(renderer).toBeTypeOf('function');
    try {
      delete renderers['draw'];
      handlers['draw'] = stub;
      expect(buildEngineCapabilities().has('op:draw')).toBe(false);
      renderers['draw'] = renderer;
      expect(buildEngineCapabilities().has('op:draw')).toBe(true);
      delete handlers['draw'];
      expect(buildEngineCapabilities().has('op:draw')).toBe(false);
    } finally {
      restore(handlers, 'draw', hadHandler, handler);
      renderers['draw'] = renderer;
    }
  });

  it('evaluator, hook-action, feature and action tables map to their capability prefixes', () => {
    const cond = COND_EVALUATORS as Record<string, unknown>;
    const hooks = RULE_HOOK_ACTIONS as Record<string, true>;
    const macros = ACTION_MACROS as Record<string, unknown>;
    const features = FEATURES as string[];
    const saved = ([[cond, 'testOnly'], [hooks, 'rule:attack'], [macros, 'goad']] as const).map(([t, k]) => [t as Record<string, unknown>, k, Object.hasOwn(t, k), t[k]] as const);
    try {
      cond['testOnly'] = () => true;
      hooks['rule:attack'] = true;
      macros['goad'] = { name: 'goad', rule: 'CR 701.15', expand: () => [{ op: 'endTurn' }] }; // not a registered macro (WP3 left goad out on purpose); an expansion the engine can run
      features.push('manual.reminder');
      const caps = buildEngineCapabilities();
      for (const c of ['cond:testOnly', 'rule:attack', 'action:goad', 'feature:manual.reminder']) expect(caps.has(c), c).toBe(true);
    } finally {
      for (const [t, k, had, v] of saved) restore(t, k, had, v); // rule:attack is a real hook action since WP16: never deleted
      features.pop();
    }
    expect(buildEngineCapabilities().has('cond:testOnly')).toBe(false);
  });
});
