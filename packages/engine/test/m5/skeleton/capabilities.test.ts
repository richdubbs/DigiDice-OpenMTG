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
        'sacrificeChoice', 'tap', 'untap', 'phaseIn' /* edhn102 */], // zones, tokens, copies, casting
      WP15: ['action', 'createEmblem', 'delay', 'designate', 'effect', 'endTurn', 'extraPhase', 'extraTurn', 'flipCoin', 'loseGame', 'reflexive', 'rollDie', 'winGame'], // lasting and game
      CLOUD_R4_FXB: ['changeTarget', 'extraStep'], // r4-fxb: change the target of a spell with a single target (CR 115.7a), additional steps (CR 500.9; effects/handlers/r4-fxb.ts)
      CLOUD_STD_EOE: ['exileUntil'], // Cloud std-eoe: "exile cards from the top of your library until you exile a nonland card" (effects/handlers/actions-native.ts#exileUntilStep, CR 406.1)
      R3_DIG: ['revealUntil'], // r3-dig: "reveal cards from the top of your library until you reveal a land card" (effects/handlers/cards-reveal.ts#revealUntilHandler, CR 701.20a)
      CLOUD_R3_MECH: ['fromOutside'], // cloud r3-mech: a card you own from outside the game into your hand (effects/handlers/outside.ts, CR 400.11b)
      E3XP: ['chooseNewTargets'], // E3XP: "you may choose new targets for that spell" (effects/handlers/new-targets.ts, CR 115.7d)
      STD_R10: ['nextSpell'], // Standard round 10: "the next spell you cast this turn can't be countered" (effects/handlers/next-spell.ts, CR 601.2i, 611.2)
      EDHC84: ['balance'], // edh-c-84: Magus of the Balance, Restore Balance (effects/handlers/edh-c-84.ts, CR 608.2e)
      STD_MANA12: ['reportAction'], // std-mana-12: earthbend and firebending report their action for "whenever you earthbend/firebend" (effects/handlers/report-action.ts, CR 701.66a, 702.189)
      P2_PLAYER_RULES_2: ['clash'], // p2-player-rules-2: clash with an opponent, "if you win" / "otherwise" (effects/handlers/cards-library.ts#clashHandler, CR 701.30)
      STD_CONTROL3: ['controlPlayer'], // std-control-3: "you control target opponent during their next turn / combat phase" (effects/handlers/game.ts, core/player-control.ts, CR 723.1)
      P2_COMBAT_FLOW_2: ['becomeBlocked'], // p2-combat-flow-2: "target unblocked attacking creature becomes blocked" (effects/handlers/become-blocked.ts, CR 509.1h)
      TREK_8: ['removeDamage'], // trek-8: "all damage already dealt to it is healed" (effects/handlers/remove-damage.ts, CR 120.6)
      TREK_18: ['endCombatPhase', 'reselectAttack'], // trek-18: "end the combat phase" (CR 724.2), "reselect which player or permanent that creature is attacking" (CR 508.7; effects/handlers/trek-18.ts)
      EDH_TOP_2: ['pair'], // edh-top-2: soulbond's "you may pair this creature with another unpaired creature you control" (effects/handlers/pair.ts, CR 702.95)
      EDH_COMBAT_7: ['controlBlocks'], // edh-combat-7: "you choose which creatures block this combat and how those creatures block" (effects/handlers/edh-combat-7.ts, CR 509.1, 723.1)
      EDH_C_85: ['emptyManaPool'], // edh-c-85: "that player loses all unspent mana" (effects/handlers/cards-mana.ts#emptyManaPoolHandler, CR 106.4, 500.5)
      EDH_N131: ['discardOrSacrifice'], // edh-next-131: "you and defending player each discard a card or sacrifice a permanent" (effects/handlers/edh-next-131.ts, CR 101.4, 608.2d)
      EDH_D_89: ['controlAttacks'], // edh-d-89: "you choose which creatures attack this turn" (effects/handlers/edh-d-89.ts, core/combat.ts#declareAttackers, CR 508.1a-b, 723.1)
      EDH_NEXT_135: ['guess', 'auction'], // edh-next-135: "An opponent guesses whether the top card of your library is the chosen kind" (effects/handlers/cards-reveal.ts#guessHandler, CR 608.2d, 701.20a)
      EDH_NEXT_137: ['restartGame'], // edh-next-137: restarting the game (effects/handlers/game.ts, core/restart.ts, CR 727)
      EDH_NEXT_147: ['putSticker'], // edh-next-147: "put a name sticker on it" (effects/handlers/edh-next-147.ts, CR 123.3, 123.6)
    };
    const ops = Object.values(MERGED_OPS).flat();
    // M6-2 (m6 design 7): the value forms of the copy op its handler runs (effects/handlers/tokens-copy.ts#OP_FORMS); M6-3: the changeFace forms (effects/handlers/face-ops.ts);
    // M6-4: convert, flip and the delayed self transform (effects/handlers/dfc-ops.ts), day and night (core/day-night.ts#OP_FORMS);
    // M6-6: the designateObject op (effects/handlers/levels.ts) with the designations it sets (OP_FORMS)
    const forms = ['op:copy.except', 'op:copy.permanentSpell', 'op:copy.spellExcept' /* CLOUD std-misc: a spell copy's types, colors and fixed P/T (CR 707.9b; token-defs.ts#exceptedSpellDef) */, 'op:changeFace.faceDown', 'op:changeFace.faceUp', 'op:changeFace.manifest', 'op:changeFace.convert', 'op:changeFace.flip',
      'op:changeFace.delayedSelf', 'op:designate.day', 'op:designate.initiative' /* MX4 */, 'op:designate.night', 'op:designate.speed' /* FAST5X-4 */, 'op:designateObject',
      'op:designateObject.classLevel', 'op:designateObject.solved', 'op:designateObject.prepared', 'op:designateObject.unprepared',
      'op:cast.costChange' /* M6-12: madness (effects/handlers/tokens-cast.ts#OP_FORMS) */,
      'op:cast.lifeManaValue' /* edh-next-49: cast for life equal to its mana value (effects/handlers/tokens-cast.ts#OP_FORMS) */,
      'op:cast.copy' /* FAST5X E26: paradigm, a copy of the card created in exile and cast (CR 707.12) */, 'op:cast.play' /* FAST5X E26: hideaway, a land played (CR 305.9) */,
      'op:cast.anyManaType' /* FAST5X E29: CR 609.4b (effects/handlers/tokens-cast.ts#OP_FORMS) */,
      'op:move.remember' /* FAST5X E13: craft's 'exiled cards used to craft it' (CR 702.167c) */,
      'op:move.attackingAsReturned' /* std-typechange-1: ninjutsu attacks what the returned creature attacked (CR 702.49c) */,
      'op:move.countersIf.when' /* edh-c-6: a condition on a counters-if entry (CR 614.1c, 608.2c) */,
      'op:move.countersIf' /* edh-perms-10: "If that card has mana value 3 or less, it enters with three additional +1/+1 counters on it" (CR 614.1c) */,
      'op:move.statusIf' /* std-typechange-2: "If that card is an enchantment card, it enters tapped and attacking" (CR 608.2c, 508.4) */,
      'op:move.arrangedBy' /* p2-dig-1: the player who arranges cards put back "in any order" (CR 401.4) */,
      'op:move.until' /* FAST4 MX1: "exile ... until ~ leaves the battlefield", CR 610.3 (effects/handlers/zones-move.ts#OP_FORMS) */,
      'op:exchange.control' /* MX2: exchange of control through layer 2 (core/control.ts#OP_FORMS) */,
      'op:removeCounters.upTo' /* FAST4 T31: "remove up to N counters" (effects/handlers/counters.ts#OP_FORMS) */,
      'op:removeCounters.kindOfChoice' /* edh-perms-24: CR 122.1, 608.2d, "remove that counter" (effects/handlers/counters.ts#OP_FORMS) */,
      'op:putCounters.distribute' /* std-rx26: counters divided among objects chosen on resolution (effects/handlers/counters.ts#OP_FORMS) */,
      'op:putCounters.upTo' /* std-mana-2: "put up to N counters on <one object>", how many chosen on resolution (effects/handlers/counters.ts#OP_FORMS, CR 608.2d) */,
      'op:search.differentNames' /* FAST5 T42: "... cards with different names" (effects/handlers/cards-library.ts#OP_FORMS) */,
      'op:search.alsoZones', 'op:shuffle.ifSearched' /* CLOUD std-dft: "search your library and/or graveyard", "if you search your library this way, shuffle", CR 701.23a, 701.24a (effects/handlers/cards-library.ts#OP_FORMS) */,
      'op:search.and' /* CLOUD C9: "for a basic land card and a Shrine card", one card of each description (effects/handlers/cards-library.ts#OP_FORMS) */,
      'op:search.allZones' /* r4-refs: "search target opponent's graveyard, hand, and library", every zone listed, CR 701.23a (effects/handlers/cards-library.ts#OP_FORMS) */,
      'op:moveCounters.every' /* FAST5X E21: "put its counters on ...", every kind, CR 122.5, 122.8 (effects/handlers/counters.ts#OP_FORMS) */,
      'op:designateObject.saddled' /* FAST5X E3: the saddled designation, CR 702.171b (effects/handlers/levels.ts#OP_FORMS) */,
      'op:designateObject.suspected', 'op:designateObject.unsuspected' /* FAST5X E12: the suspected designation, CR 701.60a */,
      'op:designateObject.foretold', // edh-next-109 (CR 702.143d)
      'op:designateObject.foretold.less', // edh-d-86 (CR 702.143d; Ethereal Valkyrie): "Its foretell cost is its mana cost reduced by {2}"
      'op:designateObject.warped', // std-costs-2: the card warp's delayed triggered ability exiled is warped (CR 702.185a)
      'op:designateObject.harnessed' /* cloud r3-mech: "Harness ~", CR 701.64 (effects/handlers/levels.ts#OP_FORMS) */,
      'op:addMana.keepEndOfCombat' /* FAST5 MX6: firebending's mana lasts until end of combat, CR 702.189a (effects/handlers/cards-mana.ts#OP_FORMS) */,
      'op:designateObject.unlockDoor', 'op:designateObject.lockOrUnlockDoor' /* FAST5X E8: unlock / lock or unlock a door of a Room, CR 709.5f-g (effects/handlers/rooms.ts) */,
      'op:reflexive.if' /* FAST5X E16: a reflexive trigger that waits for a result of the step, CR 603.12, 120.10 (model/capabilities.ts) */,
      'op:chooseObjects.groupLimit' /* FAST5 T66: "up to two creature cards with total mana value 4 or less" (effects/handlers/choose.ts#OP_FORMS) */,
      'op:sacrificeChoice.keepEachType' /* FAST5 T66: "chooses a permanent of each permanent type and sacrifices the rest" (effects/handlers/zones-remove.ts#OP_FORMS) */,
      'op:sacrificeChoice.keepTypes', 'op:sacrificeChoice.keepFilter', 'op:sacrificeChoice.chooser' /* pc-players-1: Cataclysmic Gearhulk, Tragic Arrogance (effects/handlers/zones-remove.ts#OP_FORMS) */,
      'op:addMana.keepEndOfTurn' /* CLOUD std-mkm: "Until end of turn, you don't lose this mana as steps and phases end", CR 500.5, 106.4 (effects/handlers/cards-mana.ts#OP_FORMS) */,
      'op:pay.costLink' /* std-rx24: an exile cost's link, champion (CR 607.2k; effects/handlers/pay.ts#OP_FORMS) */, 'op:sacrificeChoice.exploit' /* std-rx17: an exploit ability's sacrifice (CR 702.110b; zones-remove.ts#OP_FORMS) */, 'op:sacrificeChoice.random' /* edh-d-28: CR 608.2d, 701.21a (zones-remove.ts#OP_FORMS) */, 'op:sacrificeChoice.cantAs', 'op:discard.cantAs' /* C6: "each opponent who can't", the players who can't (CR 101.3; zones-remove.ts, cards-draw.ts#OP_FORMS) */,
      'op:sacrificeChoice.groupChooser' /* C6: the choosing player of a group read as iterating in the filter (CR 608.2e; zones-remove.ts#asChooser) */,
      'op:chooseObjects.startingWith', 'op:counter.toIf', 'op:counter.sourceEffect', 'op:counter.sourceThen' /* edh-d-43 */, 'op:discard.perPlayerCount', 'op:fromOutside.chosenAmong', 'op:gainLife.perPlayerAmount', 'op:gainLife.also' /* edh-players-17: "you and that player each gain N life" (CR 119.3; lifedamage.ts#OP_FORMS) */,
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
      'op:copy.exceptThis' /* edh-cast-15: "copy all other activated and triggered abilities you control", CR 113.7a */,
      'op:copy.gains' /* std-copy-1: "The copy gains haste and ...", riders on a spell copy, CR 707.10 */,
      'op:chooseObjects.distinct' /* std-library-1: "with different powers", no two chosen with one value of a statistic, CR 208.1, 608.2d (effects/handlers/choose.ts#OP_FORMS) */,
      'op:chooseObjects.damageSource' /* audit-fix-1: "a source of your choice", an ability on the stack offered and bound as its source, CR 609.7a (effects/handlers/choose.ts#OP_FORMS) */,
      'op:chooseObjects.cardTypesAtLeast' /* edh-d-85: "with four or more card types among them", the chosen set's card types, CR 205.2a, 608.2d (effects/handlers/choose.ts#OP_FORMS) */,
      'op:exchange.lifePower' /* edh-next-89: a life total exchanged with a creature's power, CR 701.12a, 613.4b */,
      'op:exchange.lifeToughness' /* p2-pt-1: a life total exchanged with a creature's toughness, CR 701.12a, 613.4b (effects/handlers/zones-status.ts) */,
      'op:flipCoin.untilLose' /* p2-coinflip-1: "flip a coin until you lose a flip", CR 705.1-705.2 (effects/handlers/game.ts#OP_FORMS) */,
      'op:draw.perPlayerCount' /* p2-zone-moves-1: "each player discards their hand, then draws that many cards", each player's own count, CR 121.2, 608.2e (cards-draw.ts#OP_FORMS) */,
      'op:moveCounters.anyKind', 'op:moveCounters.upTo' /* p2-counters-move-1: "move a counter from ...", "move any number of counters from ...", CR 122.5, 608.2d (effects/handlers/counters.ts#movePlan) */,
      'op:moveCounters.distribute' /* p2-counters-move-4: "move any number of +1/+1 counters from ~ onto other creatures", divided, CR 122.5, 608.2d (effects/handlers/counters.ts#moveDistributed) */,
      'op:moveCounters.among', 'op:moveCounters.eachNewKind', 'op:moveCounters.atLeastOne', 'op:moveCounters.fromGroup', 'op:addMana.playerOfChoice' /* edh-misc-6: counters from among a group, a counter of each new kind, at least one counter; "a player of your choice adds {C}" (counters.ts, cards-mana.ts) */,
      'op:fight.pairs' /* p2-damage-2: "each of those tokens fights a different one of those creatures", CR 701.14a, 608.2d (effects/handlers/lifedamage.ts#OP_FORMS) */,
      'op:search.shareLandType' /* pc-zones-2: "basic land cards that share a land type", CR 205.3i (effects/handlers/cards-library.ts#OP_FORMS) */,
      'op:removeCounters.among', 'op:putCounters.ofEvent', 'op:putCounters.copyFrom' /* edhn63: counters removed from among a group; the same number and kind as the event; the same number of each kind of ~ (counters.ts) */,
      'op:flipCoin.called' /* p2-coinflip-3: "flip three coins. For each flip you win, ...", each flip called, CR 705.2 (effects/handlers/game.ts#OP_FORMS) */,
      'op:flipCoin.onTails' /* edh-d-20: an uncalled flip with a tails branch, CR 705.1-705.2 (effects/handlers/game.ts#OP_FORMS) */,
      'op:addMana.couldProduce.oneType' /* edh-mana-keywords-1: "add three mana of that type instead", one type for every unit, CR 106.1, 106.7 (effects/handlers/cards-mana.ts#OP_FORMS) */,
      'op:draw.upTo' /* edh-players-1: "its controller may draw up to two cards", the drawing player chooses how many, CR 121.1, 608.2d (cards-draw.ts#OP_FORMS) */,
      'op:draw.revealDrawn' /* edh-next-136: "draw a card and reveal it", CR 121.1, 701.20a (cards-draw.ts#OP_FORMS) */,
      'op:changeTarget.to' /* edh-cast-1: "change a target of target spell or ability to ~", CR 115.7 (effects/handlers/change-target.ts#OP_FORMS) */,
      'op:damage.dividedBySourceController' /* edh-next-139: "divided as its controller chooses" on resolution, CR 608.2d (effects/handlers/lifedamage.ts#OP_FORMS) */,
      'op:pay.byPlayerLink' /* edh-next-139: what each player paid, kept for the resolution, CR 608.2d (effects/handlers/pay.ts#OP_FORMS) */,
      'op:damage.excessToController' /* edh-replace-4: "excess damage is dealt to that creature's controller instead", CR 120.10 (effects/handlers/lifedamage.ts#OP_FORMS) */,
      'op:pay.anyAmount' /* edh-replace-5: "you may pay any amount of {R}", the payer chooses how many times, CR 118.12, 608.2d (effects/handlers/pay.ts#OP_FORMS) */,
      'op:pay.xMax' /* edh-players-6: "you may pay {X}, where X is less than or equal to the amount of life you gained", CR 107.3, 118.12 (effects/handlers/pay.ts#OP_FORMS) */,
      'op:repeat.optional' /* edh-zones-5: "you may repeat this process any number of times", asked before each further run, CR 608.2c, 608.2d (effects/handlers/control.ts#OP_FORMS) */,
      'op:attach.hostAs' /* edh-top-15: "unattach an Equipment from a creature you control. If you do, tap that creature", CR 701.3d, 608.2c (effects/handlers/zones-status.ts#ATTACH_OP_FORMS) */,
      'op:attach.asCreature' /* edh-mana-keywords-12: "Equip planeswalker" attaches as though the host were a creature, CR 701.3a (effects/handlers/zones-status.ts#ATTACH_OP_FORMS) */,
      'op:chooseValue.manaTypeSpent' /* edh-mana-keywords-12: "Note the type of mana spent to pay this activation cost", CR 106.1, 607.2d (effects/handlers/choose.ts#OP_FORMS) */,
      'op:chooseValue.counterKind' /* edh-perms-15: "choose a counter on target permanent or player", CR 122.1, 608.2d */, 'op:putCounters.kindOfChoice' /* edh-perms-15 */, 'op:putCounters.by' /* edh-players-19: the player who puts the counters, CR 122.6 */, 'op:putCounters.evolve' /* edh-c-48: the evolve keyword's counter (CR 702.100a) */,
      'op:chooseValue.excludeBound' /* edh-next-110: "Choose a second player" offers none of the players chosen before, CR 608.2d */, 'op:chooseValue.controlsMore' /* edh-d-46: "choose an opponent who controls more lands than you", CR 109.4, 608.2d */, 'op:chooseValue.mostLife' /* edh-players-8: "choose a player with the most life or tied for most life", CR 119.1, 608.2d (effects/handlers/choose.ts#OP_FORMS) */,
      'op:look.rebind', // edh-next-126: a look that names an earlier look's group again, CR 608.2c (Lim-Dûl's Vault)
      'op:search.differentPowers', // edh-next-135: "up to four creature cards with different powers", CR 701.23a, 208.1 (Threats Undetected)
      'op:chooseObjects.unchosen',
      'op:chooseValue.secret.player', // edh-next-135: "secretly choose an opponent", CR 608.2d (Stalking Leonin) // edh-next-135: "each opponent chooses a creature card ... that hasn't been chosen", CR 608.2d (Rejoin the Fight)
      'op:reveal.anyNumber', // edh-next-135: a reveal of any number is done with none too, CR 603.12 (Invasion of Tarkir)
      'op:chooseValue.lifeTotal', // edh-next-144: "note your life total", the life total kept under the source's link, CR 119.1, 607.2d (Sigarda's Splendor; effects/handlers/choose.ts#OP_FORMS)
      'op:cast.copy.hand', 'op:cast.costChange.reduce.copy', // edh-next-132: "copy that card and you may cast the copy. That copy costs {2} less to cast." (God-Eternal Kefnet), CR 707.12, 601.2f (effects/handlers/tokens-cast.ts#OP_FORMS)
      'op:forEach.inDirection', // edhd63: "starting with you and proceeding in the chosen direction" (effects/handlers/control.ts#inDirectionItems, CR 101.4)
      'op:repeat.until' /* edh-zones-10: "Repeat this process until you put a card into your hand or ...", the process done again while the condition is false, CR 608.2c (effects/handlers/control.ts#OP_FORMS) */,
      'op:search.groupLimit' /* edh-zones-10: "any number of creature cards with total mana value 6 or less", CR 202.3 (effects/handlers/cards-library.ts#OP_FORMS) */,
      'op:cast.exactManaValue' /* edh-cast-9: only a resulting spell of exactly that mana value, CR 601.2, 202.3 (effects/handlers/tokens-cast.ts#OP_FORMS) */,
      'op:cast.dropUncast' /* trek-21: a chosen card that cannot be cast leaves its binding, CR 601.2, 608.2g (effects/handlers/tokens-cast.ts#OP_FORMS) */,
      'op:damage.perPlayerAmount' /* edh-players-12: damage to each player of a group, the amount read for each (effects/handlers/lifedamage.ts#OP_FORMS) */,
      'op:rollDie.countQty', 'op:rollDie.modifier', 'op:rollDie.chooseOne', 'op:rollDie.afterRoll' /* edh-mana-keywords-10: a counted number of dice, a modifier, "choose one result", instructions between the roll and its table, CR 706.1-706.3 (effects/handlers/game.ts#OP_FORMS) */,
      'op:move.ownerChoosesEnd' /* edh-zones-21: "its owner puts it on their choice of the top or bottom of their library" for a group, each owner choosing for their own cards and arranging them, CR 401.4, 400.3 (effects/handlers/zones-move.ts#OP_FORMS) */,
      'op:counter.toCounters', // edh-mana-keywords-11: a countered spell exiled with counters (CR 701.6a, 122.1; zones-remove.ts#OP_FORMS)
      'op:move.attackingOrPlaneswalkers' /* edh-zones-22: "tapped and attacking that player or a planeswalker they control" for a card put onto the battlefield, CR 508.4 (effects/handlers/zones-move.ts#OP_FORMS) */,
      'op:cast.from', // edh-next-50: "you may cast ~ from your graveyard" (a card no longer there is not cast)
      'op:cast.copyCount', // trek-14: several copies of the card created in exile and cast (CR 707.12; effects/handlers/tokens-cast.ts#OP_FORMS)
      'op:pay.everyPlayer', // edh-c-57: any player may pay, every player offered in turn (CR 101.4, 118.12; effects/handlers/pay.ts#OP_FORMS)
      'op:pay.eachStartingWith', // edh-top-6: join forces, each player in turn pays any amount (CR 101.4, 118.12; effects/handlers/pay.ts#OP_FORMS)
      'op:copy.targetsObject' /* edhd60: CR 707.10c, effects/handlers/tokens-copy.ts */, 'op:copy.counters' /* edh-next-114: CR 707.9e, effects/handlers/tokens-copy.ts */,
      'op:copy.retargetAll' /* edh-next-74: CR 707.10c, effects/handlers/tokens-copy.ts */, 'op:doubleX' /* edh-next-74: CR 107.3, effects/handlers/edh-next-74.ts */,
      'op:copy.retargetEach' /* edh-cast-14: one copy of a spell for each object a group names, each targeting only that object, CR 707.10c (effects/handlers/tokens-copy.ts#OP_FORMS) */,
      'op:phaseOut.until' /* edh-perms-22: "phases out until ~ leaves the battlefield", CR 702.26b, 610.3 (effects/handlers/zones-status.ts#OP_FORMS) */,
      'op:copy.link' /* edh-perms-21: tokens created with ~ (effects/handlers/tokens-copy.ts) */,
      'op:copy.embalmed' /* edh-next-122: the embalmed tokens, CR 702.128b (effects/handlers/tokens-copy.ts) */,
      'op:copy.attachTo' /* edh-next-131: a token copy enters attached to an object, CR 303.4f, 301.5c (effects/handlers/tokens-copy.ts) */,
      'op:copy.lastOnBattlefield', 'op:copy.linkCopied' /* edh-next-130: a token copy of an object as it last existed on the battlefield, and the token's own link to the card it copies, CR 603.10a, 607.2a (effects/handlers/tokens-copy.ts) */,
      'op:move.endChosenBy' /* edh-c-107: "your choice of the top or bottom of its owner's library", CR 401.4 */,
      'op:move.enchantOnly' /* edh-perms-21: "Only creatures can be enchanted this way" (CR 303.4f) */,
      'op:move.attachedToPlayer' /* edh-d-29: an Aura that enchants a player enters attached to the named player (CR 303.4f) */,
      'op:move.faceUpOrDown' /* edh-next-80: the mover chooses face up or face down for each object put onto the battlefield (CR 708.3) */,
      'op:move.becomes' /* edh-next-125: the objects put onto the battlefield enter as creatures of a size ("those permanents are 4/4 creatures"), CR 614.1c, 613.4b */,
      'op:exchange.sacrificeReturn', // edh-zones-26: Goblin Welder's simultaneous sacrifice and return (CR 701.21a, 400.7; effects/handlers/zones-status.ts#SACRIFICE_RETURN_OP_FORMS)
      'op:exchange.power', // edh-c-13: Serene Master's exchange of two creatures' powers (CR 701.12a, 613.4b; effects/handlers/zones-status.ts#POWER_OP_FORMS)
      'op:exchange.handGraveyard', // edh-c-113: Harness Infinity's exchange of hand and graveyard (CR 701.12a; effects/handlers/zones-status.ts#HAND_LIBRARY_OP_FORMS)
      'op:exchange.handLibrary', // edh-b-12: Mordenkainen's exchange of hand and library (CR 701.12a, 401.1; effects/handlers/zones-status.ts#HAND_LIBRARY_OP_FORMS)
      'op:chooseValue.random.opponent', // edh-c-14: "Choose an opponent at random" (CR 608.2d; effects/handlers/choose.ts#OP_FORMS)
      'op:chooseValue.random.player', // edh-d-20: "Choose a player at random" (CR 608.2d)
      'op:chooseValue.random', // edh-zones-26: "Choose 1, 2, or 3 at random" (CR 608.2d; effects/handlers/choose.ts#OP_FORMS)
      'op:rollDie.highest', // edh-top-16: the opponents with the highest roll (CR 706.2; effects/handlers/game.ts#OP_FORMS)
      'op:rollDie.keepHighest', // edh-d-49: "roll a d20 for each player being attacked and ignore all but the highest roll" (CR 706.2, 706.6; effects/handlers/game.ts#OP_FORMS)
      'op:search.publicRequired' /* edh-c-32: "all cards with the same name", the matching cards of a public zone are all found, CR 701.23b (effects/handlers/cards-library.ts#OP_FORMS) */,
      'op:fight.toughness' /* edh-c-111: "each of those creatures deals damage equal to its toughness to the other" (not a fight), CR 120.2b, 608.2b (effects/handlers/lifedamage.ts#OP_FORMS) */,
      'op:controlPlayer.thenExtraTurn' /* edh-next-119: "After that turn, that player takes an extra turn." (effects/handlers/game.ts#OP_FORMS, CR 723.1, 500.7) */,
      'op:extraTurn.skipUntap' /* edh-next-46: "Skip the untap step of that turn" (effects/handlers/game.ts#OP_FORMS, CR 502.1, 614.10) */,
      'op:pay.cumulativeUpkeep', // edh-d-74: a cumulative upkeep's pay step is seen as paid or not paid (CR 702.24a)
      'op:pay.reduceBy', // edh-d-45: "This cost is reduced by {2} for each basic land type among lands you control" (Draco; effects/handlers/pay.ts#OP_FORMS)
      'op:chooseValue.forEachPlayer', // edh-next-143: "For each player, choose friend or foe." (effects/handlers/choose.ts#chooseForEachPlayer, CR 608.2d)
      'op:chooseValue.secretReveal', // edh-next-120: "..., then the choices are revealed": secret choices revealed at once (effects/handlers/choose.ts#OP_FORMS, CR 608.2d)
      'op:rollDie.again', // edh-next-121: "You may roll again." as a table row's last instruction (CR 706.3a; effects/handlers/game.ts#OP_FORMS)
      'op:tap.attacking' /* edh-next-134: "tap it, and it's attacking that player", CR 508.4 (effects/handlers/zones-status.ts#OP_FORMS) */,
      'op:chooseObjects.eachColorPair', // edh-next-142: "for each color pair, choose a card that's exactly those colors" (effects/handlers/choose.ts#OP_FORMS, CR 105.5, 608.2d)
      'op:damage.orPlaneswalker', 'op:chooseValue.counterKindNotOn', 'op:chooseValue.random.counterKind', 'op:flipCoin.times', // edh-next-128: "that player or a planeswalker that player controls", a counter kind the source has none of (at random), "flip that many coins" (effects/handlers/lifedamage.ts, choose.ts, game.ts#OP_FORMS)
      'op:tap.changedOnly', // edh-d-94: "creatures tapped this way" are only those the step tapped (CR 701.26a, 608.2c; effects/handlers/zones-status.ts#TAP_OP_FORMS)
      'op:chooseNewTargets.random', // edh-next-129: "reselect the targets at random", never you or yours (CR 115.7; effects/handlers/new-targets.ts#OP_FORMS)
      'op:flipCoin.mayStop', // edh-next-129: "flip a coin until you lose a flip or choose to stop flipping" (CR 705.2; effects/handlers/game.ts#OP_FORMS)
      'op:flipCoin.stakes', // edh-next-129: the winner of each flip decides whether to flip again, life stakes doubled (CR 705.2, 119.3; effects/handlers/game.ts#OP_FORMS)
      'op:chooseValue.notAttackedLastCombat', // edh-next-129: a random opponent this creature didn't attack during your last combat (CR 506.1, 608.2d; effects/handlers/choose.ts#OP_FORMS)
      'op:chooseValue.random.option', // edh-next-129: "choose flying or indestructible at random" (CR 608.2d; effects/handlers/choose.ts#OP_FORMS)
      'op:copy.startingLoyalty', // edh-next-137: "The copy ... has starting loyalty X" (CR 707.9b, 306.5b; effects/handlers/tokens-copy.ts#OP_FORMS)
      'op:chooseValue.colors', // edh-next-140: "the color or colors of your choice", one or more colors at once (effects/handlers/choose.ts#OP_FORMS, CR 105.1, 608.2d)
      'op:move.asAura', // edh-next-140: "return it to the battlefield. It's an Aura enchantment with enchant ..." (effects/handlers/zones-move.ts#OP_FORMS, CR 303.4f, 614.1c)
      'op:sacrificeChoice.keepParty', // edh-next-147: "chooses a party ... then sacrifices the rest" (CR 700.8; effects/handlers/zones-remove.ts#OP_FORMS)
      'op:exileUntil.count', // edh-d-102: "exile cards ... until you exile X permanent cards" (CR 406.1, 107.3; effects/handlers/actions-native.ts)
      'op:chooseValue.counterKind.among', 'op:putCounters.ifNone', // edh-d-89: a counter on any one of a group; "if it doesn't have a counter of that kind on it" (CR 122.1, 608.2c-d)
      'op:sacrifice.byControllers', // edh-d-88: "Those players sacrifice those permanents", each by its controller (CR 701.21a, 608.2e; effects/handlers/zones-remove.ts#OP_FORMS)
      'op:reselectAttack.playersOnly', // edh-d-88: "reselect which player ~ is attacking" (CR 508.7c; effects/handlers/trek-18.ts#OP_FORMS)
      'op:cast.energyManaValue', // edh-d-100: "by paying an amount of {E} equal to its mana value rather than paying its mana cost" (CR 118.9; effects/handlers/tokens-cast.ts#OP_FORMS)
      'op:changeFace.faceUp.exile' /* edh-d-101 (CR 406.3): face-down cards in exile turned face up (effects/handlers/change-face.ts, model/capabilities.ts) */,
    ];
    expect((byPrefix.get('op') ?? []).sort(), 'op').toEqual([...ops.map((op) => `op:${op}`), ...forms].sort());
    for (const op of ops) expect(Object.hasOwn(OP_HANDLERS, op) && Object.hasOwn(RENDERERS, op), op).toBe(true); // design 5.2: a handler AND a renderer
    expect((byPrefix.get('dur') ?? []).sort(), 'dur').toEqual(['duringNextCombat' /* edh-d-88: statics/rule-sources.ts#duringNextCombatNow, core/steps.ts#endCombatPhase */, 'duringNextTurn' /* std-control-1: "during that turn" of the next turn, CR 611.2a */, 'endOfCombat', 'endOfNextTurn' /* FAST5X E29 */, 'endOfTurn', 'permanent', 'remainsExiled' /* FAST5X E29 */, 'throughNextUntap' /* MX5: core/durations.ts#expireAfterUntapStep */, 'until', 'untilExiledWith' /* r5-dig: core/durations.ts#endDurations */, 'untilNextStep', 'untilNextTurn', 'whileObject' /* std-rx32: statics/while-object.ts */, 'whileSource'].map((d) => `dur:${d}`)); // not asLongAs (WP15 review: not judged live)
    // WP8 (triggers/) registers the event matchers the engine can emit (`dieRoll` since WP15's rollDie emits `dieRolled`); its features are checked below.
    expect((byPrefix.get('ev') ?? []).sort(), 'ev').toEqual(
      // M6-4: `dayNight` (core/designations.ts emits it; triggers/forms-dfc.ts#EMITS)
      ['abilityTriggered' /* std-copy-6: "whenever ... causes a triggered ability of that creature to trigger", CR 603.2 */, 'action', 'activate', 'attacks', 'attacksUnblocked' /* std-rx35 (CR 509.1h) */, 'beginTurn', 'becomes', 'becomesBlocked', 'blocks', 'cast', 'coinFlip' /* cloud r3-mech (CR 705.2) */, 'counters', 'createToken', 'damage', 'damagePrevented' /* edh-replace-3: CR 615.13 */, 'dayNight', 'dieRoll', 'draw', 'life', 'loseGame' /* M12-3 */, 'monarch' /* edh-players-18: CR 725.3 */, 'controlChange' /* r3-trig */, 'resolves', 'reveal' /* edh-next-144 (CR 701.20a, 607.2) */, 'state', 'step', 'zoneChange'].map((e) => `ev:${e}`).sort(),
    );
  });

  it('the only features are the announcement ones of WP7 (actions/announce.ts#FEATURES), the event forms, batches, limits and history of WP8, the dependency one of WP9 and the restriction forms of WP16', () => {
    // `feature:token.<name>` (WP14 review) is built from the predefined tokens whose abilities run; tokens/review.test.ts recomputes it, so it isn't pinned here.
    expect((byPrefix.get('feature') ?? []).filter((c) => !c.startsWith('feature:token.')).sort()).toEqual([
      'feature:announce.qty.stat.costUnattached' /* edh-next-141 */, 'feature:layer6.addActivatedOf.spendColorAsAny' /* edh-next-141 */, 'feature:triggerMod.damage.recipient', // edh-d-45: a permanent being dealt damage causes the trigger (Wayta; triggers/collect.ts#TRIGGER_MOD_CAPABILITIES)
      'feature:activate.onlyIf', 'feature:activate.opponentsOnly' /* edh-c-103 */, 'feature:limit.game', 'feature:modes.chooser', 'feature:modes.cost', 'feature:modes.escalate' /* edh-mana-keywords-2 */, 'feature:modes.override',
      'feature:target.chooser', 'feature:target.distinct', 'feature:target.divide', 'feature:target.groupLimit', 'feature:target.onlyIf', 'feature:target.playerRef', 'feature:target.sameOwner', 'feature:target.differentNames', // FAST5 T42
      'feature:target.perOpponent', 'feature:target.perOpponent.poison' /* edh-d-96 */, 'feature:target.sharedCardType', // FAST5 T66
      'feature:target.differentControllers', // CLOUD std-tmt: "controlled by different players" (CR 115.1)
      // The conditions, quantities and player references the announcement can really read (WP7 review 2): everything else stays a missing capability.
      'feature:announce.cond.all', 'feature:announce.cond.controlledSinceTurnStart' /* edh-c-110 */, 'feature:announce.cond.any', 'feature:announce.cond.ask', 'feature:announce.cond.compare', 'feature:announce.cond.exists',
      'feature:announce.cond.matches', 'feature:announce.cond.not', 'feature:announce.cond.turnOf', 'feature:announce.cond.wasCast',
      'feature:announce.count.each', 'feature:announce.counters.each', 'feature:announce.counters.self', 'feature:announce.exists.each', 'feature:announce.matches.self',
      'feature:announce.qty.X', 'feature:announce.qty.count', 'feature:announce.qty.counters', 'feature:announce.qty.startingLife' /* FAST5 T60 */, 'feature:announce.qty.distinct' /* FAST5X E13 */, 'feature:announce.qty.life', 'feature:announce.qty.math', 'feature:announce.qty.zoneSize',
      'feature:announce.qty.distinct.colors', // FAST5X E12: "activate only if there are five colors among permanents you control" (CR 105.1, 602.5b)
      'feature:announce.qty.descendedThisTurn', // FAST5X E22: "if you descended this turn, you may choose both instead" (CR 700.11, 700.2)
      'feature:announce.qty.opponentsAttacked', // trek-15: "up to X target creatures, where X is the number of opponents you attacked this turn" (CR 506.3, 508.1, 603.3d; rules/history.ts#opponentsAttackedCount)
      'feature:announce.qty.opponentsAttacked.combat', // edh-next-51: "activate only if you're attacking two or more opponents" (CR 506.3, 508.1, 602.5b; Nemesis Phoenix)
      'feature:announce.qty.countPlayers.controlsVs', // merge line D (std-sos's controlsVs): "activate only if an opponent controls more lands than you" (CR 102.3, 602.5b)
      'feature:announce.qty.countPlayers.controlsIs', // opp-port-1: "activate only if an opponent controls four or more lands", one opponent's own (CR 102.3, 602.5b)
      'feature:announce.cref.active', 'feature:announce.cref.anOpponent', 'feature:announce.cref.controllerOf.self', 'feature:announce.cref.ownerOf.self', 'feature:announce.cref.you',
      'feature:announce.sref.active', 'feature:announce.sref.anOpponent', 'feature:announce.sref.controllerOf.self', 'feature:announce.sref.controllerOf.target',
      'feature:announce.sref.ownerOf.self', 'feature:announce.sref.ownerOf.target', 'feature:announce.sref.target', 'feature:announce.sref.you',
      'feature:announce.cref.seat', 'feature:announce.sref.seat', // M12-2 (m12 design D6): "the player to your left / right" (CR 101.4)
      // WP8: the finer event forms whose events it emits (triggers/forms.ts) and the features of batches, limits and history
      'feature:ev.action.destroy', 'feature:ev.action.discard', 'feature:ev.action.exile', 'feature:ev.action.playLand', 'feature:ev.action.sacrifice', 'feature:ev.action.shuffle',
      'feature:ev.becomes.tapped', 'feature:ev.becomes.untapped', 'feature:history', 'feature:history.sinceYourLastTurn' /* edh-next-135 */, 'feature:trigger.batch', 'feature:trigger.limit',
      // FAST4 T27: a condition of the trigger event, "for the first time each turn" (triggers/collect.ts) and "if you cast it" (the cast record's caster)
      'feature:trigger.while', 'feature:trigger.first', 'feature:wasCast.by',
      'feature:ev.counters.by', 'feature:trigger.limit.action', // FAST5X E21: "whenever you put ... counters" (CR 122.6), "Do this only once each turn" (CR 603.2h)
      'feature:ev.counters.byController' /* edhn63: "an opponent puts one or more counters on a creature they control" (triggers/match.ts) */,
      // WP11: the replacement effects of an object's own abilities about itself (not those of other objects: milestone 6)
      'feature:replace.self',
      // M6-5a (push K1, m6 design D12): a replacement pattern's move cause (buyback's "as it resolves", CR 608.2n, 702.27a)
      'feature:replace.cause',
      // M6-5 (m6 design 3.8): the choice between grouped additional costs (CR 601.2b; actions/cast-kinds.ts#CAST_COST_FEATURES)
      'feature:additionalCost.choiceGroup', 'feature:castCost.granted', // M6-12: granted cast costs (actions/cast.ts#withGrantedCosts)
      'feature:triggerMod.enters', // M6-12: "that ability triggers an additional time" for a permanent entering (triggers/collect.ts#TRIGGER_MOD_CAPABILITIES)
      'feature:triggerMod.attacks', // std-rx2: a creature attacking causes the trigger (CR 508.1m, 603.2d; triggers/collect.ts#TRIGGER_MOD_CAPABILITIES)
      'feature:triggerMod.dies', // std-typechange-2: a creature dying causes the trigger, judged looking back (CR 603.10a, 603.2d; types/ability.ts#diesCause)
      'feature:triggerMod.enterLeave', // edh-misc-5: a permanent entering or leaving the battlefield causes the trigger, leaving judged looking back (CR 603.2d, 603.10a; types/ability.ts#isEnterLeaveCause)
      'feature:triggerMod.any', // FAST5 T40: a triggerMod with no cause, whatever event triggers the ability (triggers/collect.ts#TRIGGER_MOD_CAPABILITIES)
      'feature:triggerMod.turnedFaceUp', // edh-next-141: a face-down permanent turned face up causes the trigger (CR 603.2d, 702.37e; types/ability.ts#isTurnedFaceUpCause)
      'feature:costMod.unlock', // std-rh: "Unlock costs you pay cost {1} less" (core/rooms.ts#listed via statics/costmods.ts#unlockManaCost, CR 116.2m, 709.5e, 118.7)
      'feature:rulemod.rollOption.oncePerTurn', // edh-d-49: "Do this only once each turn" / "Once each turn" of the after-roll options (statics/hooks.ts, effects/roll-options.ts, CR 706.2)
      'feature:activate.xIs', // edh-next-132: "X is the mana value of that card" of an activation cost (Prototype Portal), CR 107.3c, 607.2a (actions/activate.ts#definedX)
      'feature:ev.action.discard.by', // edh-next-132: "when a spell or ability an opponent controls causes you to discard ~" (Orvar, the All-Form), CR 701.9a (triggers/match.ts)
      'feature:rulemod.revealFirstDraw.optional', // edh-next-132: "You may reveal the first card you draw each turn as you draw it" (God-Eternal Kefnet), CR 701.20a (triggers/reveal-draw.ts)
      'feature:rulemod.maxHandSize.delta', // std-ry3: "your maximum hand size is increased|reduced by N" (statics/hooks.ts#maxHandSize, CR 402.2)
      'feature:costMod.abilities.keyword', // FAST5 T60: "Exhaust abilities of other permanents you control cost {2} less to activate" (actions/activate.ts#costChangeOf, CR 601.2f, 602.2b)
      'feature:pregame.beginOnBattlefield', // FAST4 MX1: "you may begin the game with it on the battlefield" (CR 103.6a, core/pregame.ts#PREGAME_FEATURES)
      'feature:pregame.reveal.delayed', // edh-d-32: "you may reveal this card from your opening hand. If you do, at the beginning of ... " (CR 103.6b, core/pregame.ts#PREGAME_FEATURES)
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
      'feature:keyword.suspend.x', // edhn81: Suspend X, X chosen as the action is taken (CR 702.62a, 107.3a)
      'feature:keyword.foretell.costIsManaCostLess', // edh-d-73: a granted foretell whose cost is the mana cost reduced by generic mana (Dream Devourer, CR 702.143a)
      'feature:keyword.costIsManaValue', // edh-next-59: encore {X}, where X is its mana value (CR 702.141a, keywords/expand.ts)
      'feature:alternativeCost.discardedThisTurn', 'feature:alternativeCost.tapReduces', 'feature:alternativeCost.exileOnLeave', 'feature:alternativeCost.graveyardInstead' /* edh-next-68 */,
      // M6-0 (m6 design D2): the replacement pattern kinds the proposal pipeline translates (effects/registries.ts#PROPOSAL_KINDS)
      'feature:replace.on.action.destroy', 'feature:replace.on.counters', 'feature:replace.on.createToken', 'feature:replace.on.damage', 'feature:replace.on.draw',
      'feature:replace.on.life', 'feature:replace.on.step', 'feature:replace.on.zoneChange',
      // M6-1 (m6 design 3.1, 3.2, 7): other objects' replacement effects, "if an effect would" (CR 614.16), shields of every body, phases and turns (CR 614.10)
      'feature:replace.foreign', 'feature:replace.byEffect', 'feature:replace.byOpponent', 'feature:replace.on.phase', 'feature:replace.on.loseGame' /* edh-replace-7 */, 'feature:replace.on.turn',
      'feature:shield.enters', 'feature:shield.instead', 'feature:shield.modify', 'feature:shield.redirect', 'feature:shield.skip', 'feature:shield.batch' /* edh-next-122: CR 614.1c, 616.1 */,
      // WP14: the events its handlers emit (countered, attached, transformed, copies of spells; "unattached" waits for the zone-change and SBA paths, CR 701.3d)
      'feature:ev.action.counter', 'feature:ev.becomes.attached', 'feature:ev.becomes.transformed', 'feature:ev.becomes.unattached' /* edh-perms-10, CR 701.3d */, 'feature:ev.cast.nthAnyCaster' /* edh-next-91 */, 'feature:ev.cast.nthMatching' /* FAST5X E18 */, 'feature:ev.cast.orCopy', 'feature:ev.cast.copyOnly' /* edh-b-13, CR 707.10 */, 'feature:ev.damage.excess' /* FAST5X E16, CR 120.10 */,
      // std-rx28: damage equal to the recipient's toughness, damage to the source's own target, a described activated ability (CR 120.1, 115.9b, 602.2); land and
      // nonland card-name choices (CR 201.3); increases of other objects' activation costs, mana abilities paid by hand (CR 601.2f, 605.1a)
      'feature:ev.damage.amountIsToughness', 'feature:ev.damage.toSourceTarget', 'feature:ev.life.fromDamage' /* edh-players-3: CR 120.3a */, 'feature:ev.activate.activated', 'feature:choose.cardKind', 'feature:costMod.abilities.increase',
      // WP32: becomes the target (triggered abilities too), triggered mana abilities without the stack, the native keyword actions
      'feature:ev.becomes.targeted', 'feature:trigger.mana', 'feature:action.native.cascade', 'feature:action.native.discover', 'feature:action.native.vote',
      // PUSH1 T1: the native keyword actions about counters (effects/handlers/actions-native-counters.ts)
      'feature:action.native.proliferate', 'feature:action.native.bolster', 'feature:action.native.timeTravel' /* edh-next-3 */, 'feature:announce.qty.happenedCount.opponentDrawsPerPlayer' /* edh-next-3 */,
      // M6-3 (m6 design 3.4, 7): face-down permanents: turned face up / down (triggers/forms-face.ts), turning face up as a replacement pattern, and the native
      // keyword actions manifest, cloak and manifest dread (effects/handlers/face-ops.ts)
      'feature:ev.becomes.turnedFaceUp', 'feature:ev.becomes.turnedFaceDown', 'feature:replace.on.turnFaceUp',
      'feature:action.native.manifest', 'feature:action.native.cloak', 'feature:action.native.manifestDread',
      // FAST5X E25: "manifest dread X times" (CR 701.62a), "shuffle that pile, then cloak them" (CR 701.58e), "whenever you manifest dread" (CR 701.62b)
      'feature:action.manifestDread.n', 'feature:action.cloak.shuffle', 'feature:ev.action.manifestDread',
      'feature:action.manifest.shuffle', 'feature:ev.becomes.phasedIn', 'feature:ev.becomes.phasedOut', // edh-d-39
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
      'feature:action.native.venture', 'feature:ev.action.completeDungeon', 'feature:announce.cond.completedDungeon', 'feature:announce.cond.designation' /* edh-mana-keywords-6 */,
      // FAST5 batch 2 merge (E5 + E9): "activate only if this land entered this turn" read from the history at announcement (actions/announce-cond.ts)
      'feature:announce.happened.selfEntered',
      'feature:ev.action.payLife', // edh-next-109 (CR 119.4): "whenever you pay life"
      // CMD2: freerunning's "you dealt combat damage to a player this turn with an Assassin or commander" read from the turn's history at announcement (CR 702.173a;
      // by std-blb's feature:announce.happened.turn since the wave-4 merge): the source filter fields the history facts answer
      ...['anyOf', 'not', 'controller', 'owner', 'types', 'subtypes', 'supertypes', 'colors', 'name', 'token', 'isCard', 'commander'].map((k) => `feature:announce.history.${k}`),
      'feature:action.native.learn', // FAST5 MX7: learn (CR 701.48a, effects/handlers/learn.ts)
      // FAST5X E1: gift (CR 702.174c): the giveGift action (effects/handlers/gift.ts) and "whenever you give a gift"
      'feature:action.native.giveGift', 'feature:ev.action.giveGift', 'feature:ev.action.exploit' /* std-rx17: CR 702.110b */,
      // MX3: the Ring tempts you (effects/handlers/ring.ts, core/ring.ts) and the trigger event it emits (triggers/forms.ts)
      'feature:action.native.ringTempts', 'feature:ev.action.ringTempts',
      // FAST5X E9: "whenever you scry / surveil", "you've scried or surveilled this turn" (effects/handlers/cards-library.ts emits them; triggers/forms.ts)
      'feature:ev.action.scry', 'feature:ev.action.surveil', 'feature:ev.action.scryBottom' /* edh-d-96 */,
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
      'feature:action.native.planeswalk', 'feature:action.native.chaosEnsues', 'feature:vote.secret', // edhd19 (CR 701.31a, 311.7, 701.38a)
      'feature:vote.notSelf', 'feature:vote.upTo', // edhd27 (CR 701.38a-b)
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
      'feature:restrict.max.cast.countFrom', // edh-next-145: "You can cast only one more spell this turn" (CR 601.2i, 611.2c; statics/hooks.ts verdict)
      'feature:restrict.max.beBlocked', // MX5: "can't be blocked by more than one creature" (CR 509.1b, statics/hooks.ts#blockSetValid)
      'feature:restrict.min.beBlocked', // FAST5 T57: "can't be blocked except by three or more creatures" (CR 509.1b, statics/hooks.ts#blockSetValid)
      'feature:require.min.beBlocked', // edh-d-38 (CR 509.1c; Gorm the Great): "must be blocked by two or more creatures if able"
      'feature:activate.anyPlayer', // MX5: "Any player may activate this ability" (CR 602.2, actions/activate.ts)
      'feature:activate.xMin', // std-rx12: "X can't be 0." (CR 107.3a, 602.2b; actions/activate.ts)
      'feature:activate.tapForMana', // std-rx27: tap creatures rather than pay an activation's generic mana (CR 601.2h, 602.2b; actions/activate.ts)
      'feature:activate.loyaltyX', // std-r9: "−X" (CR 606.4, 107.3a; actions/activate.ts, rules/cost.ts#planFromCostDef)
      'feature:restrict.otherPlayer.attackPlayer', // FAST4 T33: "can't attack you" (CR 508.1b-c, statics/hooks.ts#canAttack)
      'feature:restrict.exceptMana.payLife', // edh-d-3 (CR 605.1a, 118.3; Karn's Sylex)
      'feature:restrict.exceptMana.activate', // FAST4 T33: "can't be activated unless they're mana abilities" (CR 605.1a, statics/hooks.ts#canActivate)
      'feature:restrict.alone.attack', 'feature:restrict.alone.block', // FAST5 T37: "can't attack or block alone" (CR 506.5, core/combat.ts via statics/hooks.ts#cantActAlone)
      ...['attack', 'block', 'beBlocked', 'beBlockedBy', 'beTargeted', 'cast', 'castFromZone', 'activate', 'playLand', 'beAttached', 'beEnchanted', 'beEquipped',
        'dealDamage', 'receiveDamage', 'sacrifice', 'discard', 'beCountered', 'preventCombatDamage' /* Cloud r5-repl */, 'search' /* edh-zones-14 */, 'preventDamage' /* edh-cast-12: Banefire, the damage's source */].map((a) => `feature:restrict.other.${a}`),
      // M6-7 (m6 design 3.9): the combat requirements that name the other creature (statics/hooks.ts, statics/requirements.ts)
      'feature:require.other.attack', 'feature:require.other.block', 'feature:require.other.beBlocked',
      'feature:require.player.attack', // M6-12: "attacks that opponent this turn if able" (encore, CR 702.141a)
      'feature:require.atLeastOne.attack', // edh-d-75 (CR 508.1d; Seeker of Slaanesh, Trove of Temptation): "each opponent must attack with at least one creature each combat if able" (rules/requirements.ts)
      'feature:require.exactly.beBlocked', // edh-d-75 (CR 509.1c; Nacatl War-Pride): "must be blocked by exactly one creature if able" (rules/requirements.ts)
      // WP16 review fix: the optional fields each wired permission honors (statics/hooks.ts PERMIT_FIELDS)
      'feature:permit.haveFlash.of', 'feature:permit.haveFlash.asThough', 'feature:permit.haveFlash.costChange' /* FAST5 T56: "as though it had flash if you pay {2} more" */, 'feature:permit.haveFlash.addCost' /* std-rx10: "as though it had flash if you behold a Dragon as an additional cost" */, 'feature:permit.haveFlash.ifTargets' /* edht4: "as though it had flash if it targets a commander" */, 'feature:permit.attackAsThoughNoDefender.of', 'feature:permit.attackAsThoughNoDefender.asThough', 'feature:permit.activate.of', 'feature:permit.activate.asThough' /* r4-fxz: CR 302.6 */,
      'feature:permit.blockAsThough.of', 'feature:permit.blockAsThough.asThough', 'feature:permit.playLand.count',
      'feature:permit.blockAsThough.attacker', // p2-attack-block-1: "creatures with islandwalk can be blocked as though they didn't have islandwalk" (CR 609.4, 702.14c)
      'feature:permit.assignAsUnblocked.of', // edh-combat-3: "for each non-Human creature you control, you may have that creature assign its combat damage as though it weren't blocked", "enchanted creature's controller may have it assign ..." (CR 510.1b-c, statics/hooks.ts#mayAssignAsUnblocked)
      'feature:permit.assignAsUnblocked.mandatory', // edh-d-25 (Outmaneuver, Predatory Focus)
      'feature:permit.attackAsThoughHaste.of', // edh-b-14: "All creatures can attack your opponents and planeswalkers your opponents control as though those creatures had haste" (CR 302.6, 508.1a, 609.4)
      'feature:permit.attackAsThoughHaste.opponentsOnly', // edh-b-14
      'feature:permit.cast.laterTurn', 'feature:permit.play.laterTurn', // FAST5X E2: warp's "after the current turn has ended" (CR 702.185a, statics/play-permits.ts)
      'feature:permit.cast.linked.anyManaType', // std-rs (CR 607.2a, 609.4b): "you may cast the exiled card, and mana of any type can be spent to cast that spell" (statics/play-permits.ts)
      // std-rx27 (CR 607.2a, 601.3e, 118.9, 614.1c, 702.8a, 305.2): the riders of static linked cast permissions, a one-card permission, a top-card "enters with",
      // a graveyard land permission once each turn (statics/play-permits.ts); the first equip each turn and collect evidence linked (statics/costmods.ts, rules/pay-parts.ts)
      'feature:permit.cast.linked.of', 'feature:permit.cast.linked.oncePerTurn', 'feature:permit.cast.linked.entersWith', 'feature:permit.cast.linked.free', 'feature:permit.cast.linked.thisTurn', 'feature:permit.cast.linked.activePlayer', 'feature:permit.cast.linked.notOwn',
      'feature:permit.haveFlash.linked', 'feature:permit.haveFlash.offTimingSacrifice' /* edh-perms-4 (CR 601.3b, 603.7) */, 'feature:permit.play.single', 'feature:permit.cast.single', 'feature:permit.play.uses', 'feature:permit.cast.uses' /* edh-d-96 */, 'feature:permit.cast.top.entersWith', 'feature:permit.play.zone.oncePerTurn',
      'feature:costMod.abilities.firstEachTurn', 'feature:cost.collectEvidence.link',
      // std-rx27 batch 2: the any-type rider of a static exile permission by description (statics/play-permits.ts#isExileFilterPermit)
      'feature:permit.play.exile.anyManaType', 'feature:permit.cast.exile.anyManaType',
      'feature:permit.cast.oncePerTurn', // FAST5X E14: "Once each turn, you may cast ... from the top of your library" (CR 601.3, statics/play-permits.ts)
      'feature:permit.play.zone.outside', // trek-11: "Once during each of your turns, you may play a permanent card you own from outside the game or from your graveyard" (CR 400.11, 305.1, 601.3, statics/play-permits.ts)
      'feature:permit.play.zone.entersAbilities', // edh-zones-22: "If you do, it gains ..." of a once-each-turn play from the graveyard, CR 305.1, 601.3, 614.1c (statics/play-permits.ts#isCappedPermanentPlayPermit)
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
      'feature:costMod.spellTargets.self', 'feature:costMod.times', 'feature:spellTargetCount.filter', 'feature:spellTargetCount.filter.targets' /* edh-cast-15: the counted spell or ability's own targets, statics/costmods.ts#filteredTargetCount */, 'feature:spellTargetCount.filter.dealtDamageThisTurn' /* edh-d-10: Bitter Downfall */,
      // FAST5X E19: the spell whose mana spent is read, and mana from a source of one subtype (CR 601.2h, 106.3; effects/eval.ts#QTY_FEATURES)
      'feature:spellManaSpent.of.event', 'feature:spellManaSpent.of.self', 'feature:spellManaSpent.from.subtype', 'feature:spellManaSpent.from.type' /* edh-cast-8 */,
      'feature:q.countPlayers.sizeVs' /* FAST5 T53: "an opponent has more cards in hand than you", CR 402.1, 102.3 (effects/eval.ts#QTY_FEATURES) */,
      'feature:q.countPlayers.controlsIs' /* std-rx12: "the number of opponents who control an artifact", CR 102.3, 108.4 (effects/eval.ts#QTY_FEATURES) */,
      'feature:q.countPlayers.poisonIs', 'feature:announce.qty.countPlayers.poisonIs' /* std-rx24: "an opponent has three or more poison counters", CR 122.1f (effects/eval.ts#QTY_FEATURES, actions/announce-cond.ts) */,
      'feature:permit.cast.exileOnLeave' /* std-rx24: jump-start, CR 702.133a (statics/play-permits.ts) */,
      'feature:q.countPlayers.controlsVs' /* std-sos review: "an opponent controls more lands than you", each opponent alone, CR 102.2, 102.3 (effects/eval.ts#QTY_FEATURES) */,
      // FAST5 T50: a delayed trigger's "one or more" / "whenever you attack" batch (triggers/delayed.ts, CR 603.2c)
      'feature:delay.batch',
      'feature:delay.batch.whole', // edh-players-13
      'feature:permit.cast.top.gainsThisTurn', // edh-cast-12: "If you cast a creature spell this way, it gains haste until end of turn" on a top-card cast permission (CR 611.2c, statics/play-permits.ts)
      'feature:mod.protectionFromColorsOf', // edh-players-15: effects/handlers/lasting.ts#expandVariants (CR 702.16a, 105.1)
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
      'feature:target.equalToughness', // edh-next-126: "any number of target creatures with equal toughness" (rules/targets.ts#equalToughnessHolds, CR 208.1, 115.1)
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
      'feature:q.countPlayers.lifeIs.halfStarting' /* edh-next-83: "less than half their starting life total" (Anya), CR 119.1, 103.4 (effects/eval.ts#QTY_FEATURES) */,
      'feature:q.countPlayers.lostLifeIs' /* std-rp: "if an opponent lost 3 or more life this turn", CR 119.3 (effects/eval.ts#QTY_FEATURES) */,
      // Cloud C7: "for each creature destroyed this way", what a step reports it moved (effects/eval.ts#QTY_FEATURES, CR 608.2c, 608.2h)
      'feature:resultCount.which',
      // C10: a graveyard permission's additional cost and "enters with" rider (CR 601.2f, 614.1c; statics/play-permits.ts#isGraveyardPermit)
      'feature:permit.cast.addCost', 'feature:permit.cast.addGeneric' /* edh-next-50 */, 'feature:permit.cast.entersWith',
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
      'feature:replace.life.loss.fromDamage', 'feature:replace.createToken.token', 'feature:replace.life.byController' /* edh-d-54 */, 'feature:replace.life.toAtMost' /* edh-d-86 (Enduring Angel) */,
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
      'feature:modes.mayChoose', // edh-players-19: "you may choose two", none or exactly that many modes (actions/announce.ts#chooseModes, CR 700.2, 603.3c)
      // r3-choose: the triggering event's amount read at announcement, "up to that many target creatures" (actions/announce-cond.ts#announceQty, CR 603.3d)
      'feature:announce.qty.eventAmount', 'feature:announce.qty.kickCount' /* pc-zones-3 */,
      // Standard round 3, r3-trig: the modes chosen for the spell of a cast trigger read at announcement (CR 700.2, 603.3c), a modal spell cast (CR 700.2) and the
      // total power of a declaration's attackers (CR 508.1) as event forms (triggers/forms.ts)
      'feature:announce.qty.modesChosen', 'feature:ev.cast.modal', 'feature:ev.attacks.power', 'feature:ev.cause.craft' /* exiled as craft's material, CR 702.167a */,
      // r3-cost: "This effect can't reduce the mana in that cost to less than one mana" (statics/costmods.ts#modifyMana, CR 601.2f, 118.7)
      'feature:costMod.floor.one',
      'feature:costMod.floorTotal', // edh-next-12
      'feature:costMod.plot', // std-rx26: the plot action's cost (core/special/plot.ts#plotCostAfterMods)
      'feature:ev.action.discover', // std-rx26: "whenever you discover" (effects/handlers/actions-native.ts emits it)
      // r3-cost: "X can't be greater than ..." on an additional cost (actions/cast.ts#xCap, CR 107.3, 601.2b) and "Add {A} or {B} for each ..." (rules/mana.ts, CR 106.1)
      'feature:additionalCost.xMax', 'feature:additionalCost.xMin' /* edh-perms-24 */, 'feature:mana.anyColor.distinct', 'feature:mana.anyColor.from',
      'feature:additionalCost.chooseType', // std-costs-2: a creature type chosen as an additional cost is announced (actions/cast-costs.ts, CR 601.2b, 607.2d)
      'feature:q.commanderCasts.self', // edh-mana-keywords-2: the casts of this commander card (effects/eval.ts#QTY_FEATURES; Opal Palace, CR 903.8)
      'feature:q.commanderCasts.of', // CMD2: another player's commander casts (effects/eval.ts#QTY_FEATURES; Commander's Insight, CR 903.8)
      'feature:createToken.attackingWhom', // cmd1: tokens created attacking a named player (effects/handlers/tokens-create.ts, CR 508.4)
      'feature:createToken.exceptReplaced', // pc-tokens-2: a step of a token-creation replacement that skips the very token being replaced (effects/handlers/tokens-create.ts, CR 614.5)
      'feature:createToken.manaCost', // edh-next-64: a token given a mana cost (TokenDef.manaCost, CR 111.3; the Tarmogoyf token)
      'feature:createToken.blocking', 'feature:createToken.perPlayerCount', // edh-combat-4: tokens put onto the battlefield blocking an attacker (effects/handlers/tokens-create.ts, CR 506.3e)
      'feature:wasCast.fromOwner', // Standard round 4, r4-trig: "if it was cast from your graveyard" (effects/eval.ts#wasCast, CR 400.3, 601.2a)
      // Standard round 4, r4-trig: a land played from anywhere other than the hand (CR 305.1) and a player who becomes the target (CR 115.1) as event forms (triggers/forms.ts)
      'feature:ev.action.playLand.notFrom', 'feature:ev.becomes.targeted.player',
      'feature:ev.action.search', 'feature:ev.action.search.ownLibrary', // Standard round 4, r4-trig: a search of a library and whose it was (CR 701.23a)
      'feature:spellManaSpent.of.target', // r4-fxb: the mana spent on the target spell, "if that spell's mana value ..." (effects/eval.ts#QTY_FEATURES, CR 601.2h)
      'feature:spellManaSpent.of.subject', // edh-perms-14: the mana spent on the permanent a replacement applies to (CR 400.7d, 601.2h)
      'feature:announce.qty.stat.self', // r4-fxb: the source's own power or mana value read at announcement (actions/announce-cond.ts, CR 208.1, 202.3)
      'feature:announce.qty.stat.event', // edh-next-9 (CR 603.10a): the power or toughness of the subject of the triggering event, as it last existed (actions/announce-cond.ts)
      'feature:announce.qty.stat.max.each', // edh-next-9 (CR 601.2d, 208.1): the greatest power among creatures you control, as the amount divided is announced
      'feature:announce.qty.stat.sum.each', // std-ry5 (formidable): the powers of a group added up at announcement (actions/announce-cond.ts, CR 602.5b, 208.1)
      // r4-cost: "This ability costs {1} less to activate during your turn" (actions/activate.ts#costChangeOf, CR 601.2f, 602.2b)
      'feature:activate.costChange.if',
      // r4-cost: "activate only if a player has one or fewer cards in hand" and "... four or more permanent types among cards in your graveyard" (actions/announce-cond.ts, CR 602.5b)
      'feature:announce.qty.countPlayers.sizeIs', 'feature:announce.qty.countPlayers.sizeVs', 'feature:announce.qty.distinct.permanentTypes.each', 'feature:q.distinct.permanentTypes',
      // r4-cost: an activated ability's targets in its cost (statics/costmods.ts#targetValue, CR 601.2c, 601.2f) and a keyword's cost change (keywords/expand.ts, CR 702.6a)
      'feature:cost.abilityTargets', 'feature:keyword.costChange',
      'feature:q.countPlayers.didNot', // r5-fxz: the players who didn't discard such a card in an earlier step (effects/eval.ts#QTY_FEATURES, CR 701.9a, 608.2c)
      // r5-cost: a triggered ability's "choose up to X --", X the X its source was cast with (actions/announce.ts#modeLimits, CR 107.3m, 603.3c)
      'feature:modes.triggerX',
      // r5-cost: "cost an additional 3 life to cast" (actions/cast.ts#modifiedPlan, CR 601.2f, 119.4)
      'feature:costMod.life',
      'feature:q.distinct.manaCosts', // edh-c-47: "for each different mana cost among nonland cards in your graveyard" (effects/eval.ts#QTY_FEATURES, statics/match.ts)
      'feature:q.distinct.planeswalkerTypes', // r5-fxb: "the number of planeswalker types among planeswalkers you control" (effects/eval.ts#QTY_FEATURES, CR 205.3j)
      'feature:target.sameController', // std-rx30: "controlled by the same opponent" (actions/announce.ts#FEATURES, CR 115.1)
      'feature:target.differentManaValues', // edh-top-3: "that each have a different mana value" (actions/announce.ts#FEATURES, CR 202.3, 115.1)
      'feature:target.perCardType', // std-cardcopy-7: "of each card type" (actions/announce.ts#FEATURES, CR 115.1, 205.2a)
      'feature:target.perPlayer', // r5-fxb: "for each player, ... up to one target creature that player controls" (actions/announce.ts#FEATURES, CR 601.2c)
      'feature:target.random', // p2-damage-2: "target creature an opponent controls chosen at random" (actions/announce.ts#FEATURES, CR 601.2c, 603.3d)
      'feature:ev.attacks.withOther', // edh-combat-5 (CR 508.1): "you attack with ~ and another legendary creature" (triggers/match.ts)
      'feature:keyword.likeAmong', // edh-combat-5: hexproof variants shared (effects/handlers/lasting.ts#expandVariants, CR 702.11d)
      'feature:delayed.event.or', // edh-next-74: "when you next cast an instant spell, cast a sorcery spell, or activate a loyalty ability this turn" (triggers/delayed.ts, CR 603.7)
      'feature:delayed.step.addedPhase', // edh-combat-5: "at the beginning of that combat" (triggers/delayed.ts#fires, CR 500.8)
      'feature:delayed.step.anyMain', // r5-fxb: "at the beginning of your next main phase" (triggers/delayed.ts#fires, CR 505.1)
      'feature:lookback.attachments', // r5-fxb: "whenever a modified creature you control leaves the battlefield" (LastKnown.attached, CR 603.10a, 700.9)
      // r5-dig: a face-down and a face-up pile (effects/handlers/cards-reveal.ts#faceDownPiles, CR 700.3) and "cast it ... as an Adventure" (statics/play-permits.ts, CR 715.3)
      'feature:faceDown.set' /* edh-mana-keywords-12: a face-down permanent with set characteristics, CR 708.2a */, 'feature:piles.faceDown', 'feature:permit.cast.asAdventure',
      // std-ru: "If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost" on a linked permission (statics/play-permits.ts, CR 118.9)
      'feature:permit.play.linked.lifeCost', 'feature:permit.cast.linked.lifeCost',
      // edh-next-62: "you may spend mana as though it were mana of any color to cast those spells" on a linked play permission (Rogue Class; statics/play-permits.ts#isLinkedPermit, CR 609.4b, 107.4c)
      'feature:permit.play.linked.anyManaColor', 'feature:permit.cast.linked.anyManaColor',
      // std-rx3: "you may cast those cards without paying their mana costs" on a permission for named objects (statics/play-permits.ts#isFreeCost, CR 118.9, 601.2b)
      'feature:permit.cast.free', 'feature:permit.play.free',
      // std-mana-1: riders on mana spent on a spell (core/mana-riders.ts, CR 106.6) and "tap <a permanent> for mana" read with the activation's {T} (rules/mana.ts, CR 106.12)
      'feature:mana.spentRider', 'feature:mana.spentRider.entersWith', 'feature:trigger.tappedForMana', 'feature:ev.abilityTriggered.entering', 'feature:trigger.activateLifePaid', 'feature:trigger.activateXInCost', 'feature:trigger.activateManaSpent' /* edh-d-50 */,
      'feature:mana.devotionColor', // p2-mana-2: "choose a color. add an amount of mana of that color equal to your devotion to that color" (effects/handlers/cards-mana.ts, CR 700.5)
      // std-exile-play-2-1: the life cost on a resolved permission for named objects (statics/play-permits.ts#namedLifeCost, CR 118.9); an additional cost on a
      // static linked cast permission (isLinkedRiderPermit, CR 601.2f, 118.8)
      'feature:permit.play.named.lifeCost', 'feature:permit.cast.named.lifeCost', 'feature:permit.cast.linked.addCost',
      'feature:mana.couldProduce', // p2-mana-1: "one mana of any color that a land an opponent controls could produce" (effects/handlers/cards-mana.ts, CR 106.7)
      // std-freecast-1: "The first spell each player casts during each of their turns may be cast without paying its mana cost" (statics/play-permits.ts#grantedAlternatives, CR 118.9, 601.2b)
      'feature:permit.cast.alternative.firstSpell',
      'feature:permit.cast.alternative.flash', // edh-d-44: "If you cast a spell this way, you may cast it as though it had flash" on a granted alternative cost
      'feature:permit.cast.alternative.lasting', // edh-next-97: "Until end of turn, you may cast spells from your hand without paying their mana costs" (a lasting alternative cost; statics/play-permits.ts#grantedAlternatives)
      'feature:permit.cast.top.flash', // edh-d-44: the same rider on a top-card cast permission
      'feature:permit.cast.top.addCost', // edh-d-44: "... by sacrificing a nonland permanent in addition to paying their other costs" on a top-card cast permission
      'feature:permit.haveFlash.ifXAtMost', // edh-d-44: "as though it had flash if X is 3 or less"
      'feature:permit.haveFlash.firstOfKind', // edh-d-44: "the first creature spell you cast each turn as though it had flash"
      'feature:permit.cast.alternative.life',
      // std-freecast-2: "you may cast a creature spell from your graveyard this turn. If you do, it enters with ... and is a Vampire in addition to its other types" (statics/play-permits.ts#gyHits, CR 601.3, 205.1b)
      'feature:permit.cast.zone.single', 'feature:permit.cast.entersSubtypes', 'feature:permit.cast.zone.putThere', 'feature:permit.play.zone.putThere' /* edh-d-86 (Kagha) */, 'feature:permit.zone.anyGraveyard.fromLibrary' /* edh-d-91 (Coram), carried by edh-d-86's merge */, 'feature:permit.cast.entersTapped' /* edh-next-68 */,
      // std-exile-play-2-3: "by waterbending {X} rather than paying its mana cost" on a cast permission for named objects (statics/play-permits.ts#isWaterbendCost)
      'feature:permit.cast.named.waterbend',
      'feature:additionalCost.copyForEach', // edh-cast-15: the spell is copied once for each object an optional cost took (actions/cast.ts#copyForEachTriggers, CR 603.12, 707.10)
      'feature:additionalCost.announceCount', // std-costs-1: the number announced with an optional cost (actions/cast-costs.ts, CR 601.2b)
      'feature:layer6.addActivatedOf.limit',
      'feature:layer6.removeAll.exceptMana', // edh-d-46: "lose all abilities except mana abilities", CR 613.1f, 605.1a // std-craft-2: "You may activate each of those abilities only once each turn" (statics/mods.ts#limitedEachTurn, CR 602.5b)
      'feature:layer6.removeEnchant', // edh-perms-4: "it loses \"enchant creature card in a graveyard\"" (statics/layers.ts#FEATURES, statics/mods.ts#layer6, CR 702.5a, 613.1f)
      'feature:layer6.addChosen', // edhd63: "have each of the chosen abilities" (statics/mods.ts#layer6, CR 702.1, 607.2d)
      'feature:layer6.protectionFromOwnColors', // edh-c-59: "each creature has protection from each of its colors" (statics/mods.ts#layer6, CR 702.16a)
      'feature:layer6.addActivatedOf.triggered', // std-cardcopy-9: "has all activated and triggered abilities of" (statics/layers.ts#FEATURES, CR 613.1f)
      // std-exile-play-1-1: the life cost on a top-card permission (CR 118.9) and "a spell they don't own" (CR 108.3, triggers/forms.ts)
      'feature:permit.play.top.lifeCost', 'feature:permit.cast.top.lifeCost', 'feature:ev.cast.notOwnedByCaster',
      // std-copy-1: "This ability can't be copied." (effects/handlers/tokens-copy.ts#copySpells, CR 707.10)
      'feature:activate.spendOnlyChosen',
      'feature:activate.uncopiable',
      // std-control-1: speed compared with each other player's (CR 702.179) and "power-up abilities can't be activated" (CR 602.5)
      'feature:q.countPlayers.speedVs', 'feature:restrict.abilityKeyword.activate',
      // std-mana-12: "whenever you earthbend" and "whenever you firebend" (triggers/forms.ts; the reportAction step, CR 701.66a, 702.189)
      'feature:ev.action.earthbend', 'feature:ev.action.firebend', 'feature:ev.action.investigate' /* edh-next-113 */,
      // std-exile-play-2-4: a resolved permission for the objects an `each` filter picks, locked as the effect begins (effects/handlers/lasting.ts)
      'feature:permit.play.lockedSet', 'feature:permit.cast.lockedSet',
      'feature:resultCount.maxPerOwner', // p2-zone-moves-1: "the greatest number of cards a player discarded this way" (effects/eval.ts)
      // p2-player-rules-1: "can't draw more than one card each turn" (CR 121.1) and "can't cast more than one noncreature spell each turn" (CR 601.2i, statics/hooks.ts#castCountOfKind)
      'feature:restrict.max.draw',
      'feature:restrict.max.cast.other',
      'feature:target.player.otherThan', // edh-cast-15: "choose another target player" in a trigger about a cast (rules/targets.ts, effects/ctx.ts)
      'feature:mana.whenSpent.abilities', // edh-cast-15: "When you spend this mana to cast a spell or activate an ability" (actions/activate.ts, actions/cast.ts#manaSpentTriggers)
      'feature:mana.whenSpent', // std-copy-3: "When that mana is spent to cast ..." (rules/mana.ts, actions/cast.ts#manaSpentTriggers, CR 106.6, 603.2)
      'feature:trigger.producedChosen', // edh-mana-keywords-5: "Whenever a land's ability causes you to add one or more mana of the chosen color" (triggers/match.ts#producedChosen, CR 106.4, 607.2d)
      ...['types', 'notTypes', 'allTypes', 'subtypes', 'notSubtypes', 'allSubtypes', 'supertypes', 'notSupertypes', 'colors', 'notColors', 'colorless', 'multicolored', 'monocolored', 'stackKind', 'zone'].map((k) => `feature:restrict.max.cast.other.${k}`),
      // std-exile-play-1-3: "players may play cards they exiled this way", "Each spell cast this way costs {1} more to cast", "Each land played this way enters tapped" on a permission for named objects (statics/play-permits.ts, CR 400.3, 601.2f, 614.1c)
      'feature:permit.play.ownOnly', 'feature:permit.cast.ownOnly', 'feature:permit.play.increase', 'feature:permit.cast.increase', 'feature:permit.play.landsEnterTapped',
      // audit-fix-1: only the bound objects that matched `which` as they were moved ("another" after each player's sacrifice; effects/refs.ts, CR 608.2h)
      'feature:ref.bound.which',
      // edh-zones-14: "Spells and abilities your opponents control can't cause their controller to search their library" (statics/hooks.ts#verdict, CR 701.23a)
      'feature:restrict.causedByOwn.search',
      // edh-next-69: "Spells and abilities your opponents control can't cause you to sacrifice permanents" (statics/hooks.ts#verdict, effects/handlers/zones-remove.ts, CR 701.21a)
      'feature:restrict.causedByOpponents.sacrifice',
      'feature:restrict.causedByOpponents.discard', // edh-next-136 (Tamiyo, Collector of Tales; CR 701.9a, 109.5)
      // edh-next-122: "Triggered abilities you control can't cause you to sacrifice or exile creature tokens you control" (statics/hooks.ts#verdict, effects/run.ts, CR 701.21a, 603.1)
      'feature:restrict.causedByOwnTriggered.sacrifice', 'feature:restrict.causedByOwnTriggered.beExiled',
      // p2-replace-events-2: the proliferate proposal kind (effects/proposal-kinds/proliferate.ts, CR 701.34a, 614.1a)
      'feature:replace.on.action.proliferate',
      // p2-replace-events-3: "would begin an extra turn" in a replacement pattern (effects/propose.ts#FEATURES, triggers/match.ts#beginTurn, CR 500.7, 614.10)
      'feature:replace.beginTurn.extra',
      // p2-replace-events-3: the scry proposal kind (effects/proposal-kinds/scry.ts, CR 701.22a, 614.1a)
      'feature:replace.on.action.scry',
      // edh-zones-14: the search proposal kind (effects/proposal-kinds/search.ts, CR 701.23a, 614.1a)
      'feature:replace.on.action.search',
      // p2-misc-1: "Creatures dying don't cause abilities to trigger", judged looking back (CR 603.10a, 603.2; triggers/collect.ts#suppressed)
      'feature:triggerMod.suppress.dies',
      // p2-group-actions-1: "the highest / lowest life total among all players" (effects/eval.ts, statics/match.ts; CR 119.1)
      'feature:q.life.agg',
      'feature:q.life.atTurnStart', // edh-next-19
      'feature:q.stat.by', // edh-players-21
      'feature:announce.matches.attachedTo', // p2-cost-parts-1: "activate only if enchanted creature is untapped" (CR 303.4, 602.5b)
      // p2-graveyard-2: "players can't cast spells from graveyards or libraries" (CR 601.3, statics/hooks.ts#canCast tells the zone)
      'feature:restrict.fromZones.castFromZone',
      'feature:restrict.counter.haveCountersPut', // edh-b-2: "can't have +1/+1 counters put on them" (CR 122.6, statics/hooks.ts#verdict)
      'feature:restrict.forCosts.payLife', // edh-next-18: "can't pay life ... to cast spells or activate abilities" (CR 118.3, 119.4, statics/hooks.ts#verdict)
      'feature:restrict.forCosts.sacrifice',
      'feature:restrict.unlessAllBlock.beBlocked', // edh-next-18: "can't be blocked unless all creatures defending player controls block it" (CR 509.1b, statics/hooks.ts#allBlockVerdict)
      'feature:restrict.exceptLoyalty.activate', // edh-b-12: "... that aren't mana abilities or loyalty abilities" (CR 606.1, statics/hooks.ts#verdict)
      // p2-graveyard-2: "If a spell cast this way would be put into your graveyard, exile it instead" on a graveyard permission (actions/cast.ts, CR 614.1a)
      'feature:permit.cast.zone.graveyardInstead',
      // p2-cost-statics-2: "spells your opponents cast that target a creature you control", a filter of the spell's targets in a cost modifier (statics/costmods.ts, CR 115.9b, 601.2f)
      'feature:costMod.spellTargets.each',
      'feature:costMod.spellTargets.orYou', // edh-next-58: "spells your opponents cast that target you or a permanent you control" (statics/costmods.ts#appliesToSpell)
      'feature:ev.action.proliferate', // p2-counters-move-1: "whenever you proliferate" (CR 701.34a; effects/handlers/actions-native-counters.ts#proliferateOnce emits it)
      // p2-cost-statics-1: "if an opponent cast three or more spells this turn" read at announcement from each opponent's turnStats (actions/announce-cond.ts, CR 601.2i, 118.9)
      'feature:announce.qty.happenedCount.opponentSpellsPerPlayer',
      'feature:modes.random', // p2-modal-2: "choose one at random --" and "you choose one instead" (actions/announce.ts#chooseModes, CR 700.2)
      // p2-player-rules-3: "whenever you clash" / "whenever you clash and win" (CR 701.30b-c; effects/handlers/cards-library.ts#clashHandler emits the action)
      'feature:ev.action.clash', 'feature:ev.action.clash.won',
      'feature:ev.action.faceDilemma', // trek-2: "whenever you face a dilemma", one or more modes chosen (actions/announce.ts#chooseModes emits it; CR 700.2)
      'feature:triggerMod.cast', // edh-cast-2: "if you casting or copying a spell causes a triggered ability ... to trigger" (triggers/collect.ts, CR 603.2d)
      'feature:triggerMod.damage', // edh-replace-6: "if a creature you control dealing combat damage to a player causes a triggered ability ... to trigger" (triggers/collect.ts, CR 603.2d)
      'feature:triggerMod.draw', // edh-d-93: "if a player drawing a card causes a triggered ability ... to trigger" (triggers/collect.ts#TRIGGER_MOD_CAPABILITIES, CR 603.2d)
      'feature:triggerMod.lifeGain', // trek-2: "if you gaining life causes a triggered ability ... to trigger" (triggers/collect.ts#TRIGGER_MOD_CAPABILITIES, CR 603.2d)
      'feature:each.otherPlayer.castPlayer', // edh-mana-keywords-7: "each other player" of a trigger on a spell being cast is the players other than the caster (effects/refs.ts, CR 603.2, 601.2i)
      'feature:mana.restriction.notGeneric', // edh-mana-keywords-7: "This mana can't be spent to pay generic mana costs." (rules/solver.ts, CR 106.6, 107.4b)
      'feature:q.commanderCasts.spell', // edh-mana-keywords-7: the commander casts of the spell the mana was spent on (effects/eval.ts, CR 903.8)
      'feature:q.commanderCasts.costSpell', // edh-next-75: the casts of the commander whose cost a cost modifier changes (statics/costmods.ts#costQuantity, CR 903.8)
      'feature:announce.exists.attachedTo', // edh-mana-keywords-7: "activate only if this permanent is attached to a creature" (actions/announce-cond.ts, reconfigure, CR 702.151a, 602.5b)
      'feature:announce.qty.mostSharingName', // edh-mana-keywords-7: "activate only if you control three or more lands with the same name" (actions/announce-cond.ts, CR 201.2, 602.5b)
      'feature:announce.qty.distinct.names.each', // trek-5: "activate only if you control seven or more differently named lands" (actions/announce-cond.ts, CR 201.2, 602.5b)
      'feature:permit.play.anyManaColor', 'feature:permit.cast.anyManaColor', // pc-exile-play-1: "you may spend mana as though it were mana of any color to cast that spell" on a permission for named objects (CR 609.4b, 107.4c; statics/play-permits.ts#anyManaColorPermit)
      // pc-statics-1: the condition of a keyword's cost change, "Equip {2}. This ability costs {2} less to activate if you have one or fewer cards in hand." (keywords/expand.ts, CR 601.2f)
      'feature:keyword.costChange.if',
      // p2-trigger-events-1: "whenever a player mills a nonland card" (CR 701.17a; triggers/normalize.ts reports a milled card as its owner's action `mill`)
      'feature:ev.action.mill',
      // edh-mana-keywords-1: "Exile this card from your hand: Add {G}." (rules/mana.ts#manaAbilityDenial, CR 113.6, 605.1a)
      'feature:mana.activation.hand',
      // edh-players-1: "whenever an opponent draws a card except the first one they draw in each of their draw steps" (CR 504.1; triggers/normalize.ts marks the first draw of the step, match.ts reads it)
      'feature:ev.draw.exceptFirstInDrawStep', 'feature:ev.action.draw.atLeast' /* edh-players-18: CR 121.2 */,
      // edh-combat-1: "~ can't attack a player it has already attacked this turn" (CR 508.1b-c; statics/hooks.ts#verdict), "attacks, if you're the defending player" (CR 508.5; triggers/match.ts),
      // "If ~ hasn't been exerted this turn, you may exert it as it attacks" (CR 701.43a; core/attack-options.ts)
      'feature:restrict.alreadyAttacked.attackPlayer',
      'feature:ev.attacks.defending',
      'feature:rule.attackOption.unlessExertedThisTurn',
      // edh-players-2: "Permanents entering don't cause abilities of permanents your opponents control to trigger" (triggers/collect.ts#suppressed, the `scoped` list; CR 603.2, 603.6a)
      'feature:triggerMod.suppress.enters.scoped',
      // edh-perms-2 (Commander's Plate): a granted keyword's quality read from the granting effect's controller's commander color identity (statics/mods.ts#outsideIdentity)
      'feature:quality.identity',
      // edh-mana-keywords-4 (Hall of the Bandit Lord): "If that mana is spent on a creature spell, it gains haste.", a gained keyword with no duration (core/mana-riders.ts, CR 611.2a)
      'feature:mana.spentRider.permanent',
      // edh-top-10 (Jade Orb of Dragonkind): "it enters with an additional +1/+1 counter on it and gains hexproof until your next turn" (core/mana-riders.ts, CR 611.2a)
      'feature:mana.spentRider.untilNextTurn',
      // edh-cast-4: "This effect reduces only the amount of colored mana you pay" (statics/costmods.ts#modifyMana, CR 601.2f, 118.7)
      'feature:costMod.coloredOnly',
      // edh-players-5: "Players gain hexproof" (CR 702.11c; statics/hooks.ts#verdict)
      'feature:restrict.relativeToSubject.beTargeted',
      'feature:restrict.relativeToSubject.cast',
      'feature:restrict.relativeToSubject.whenCast', // edh-next-12
      'feature:restrict.relativeToSubject.whenActivate', // edh-d-15 (City of Solitude)
      // edh-replace-5 (Izzet Generatorium): "activate only if you've paid or lost four or more {E} this turn", the turn's energy counters removed from you added up (actions/announce-cond.ts, model/forms.ts#isTurnEnergySpent, CR 107.14, 602.5b)
      'feature:announce.qty.happenedCount.energySpent',
      // edh-zones-11 (Vivien, Champion of the Wilds): "you may cast it if it's a creature spell" on a cast permission for named objects (statics/play-permits.ts#namedObjects, namedPermitTypesAllow; CR 601.3, 205.2)
      'feature:permit.cast.onlyTypes',
      'feature:spell.cleave', // edh-next-100 (Wash Away, Dig Up): SpellAbilityDef.cleave, CR 702.148a
      'feature:emblem.activated', // edh-next-100 (Ob Nixilis of the Black Oath): core/legal.ts lists the activated abilities of the player's emblems, CR 114.4
      'feature:permit.cast.onlyColors', // edh-next-100 (Chandra, Dressed to Kill): statics/play-permits.ts, CR 601.3, 105.2
      'feature:permit.cast.exceptTypes', // edh-d-56 (Narset, Enlightened Master): "noncreature spells from among those cards" (statics/play-permits.ts#namedObjects, namedPermitTypesAllow; CR 601.3, 305.1)
      // edh-zones-21: "lands enter under an opponent's control without being played" (CR 305.1, 603.6a; triggers/match.ts compares the cause of the zone change with a land play's)
      'feature:ev.cause.unplayed',
      // edh-zones-19 (Dissipation Field): "Whenever a permanent deals damage to you", the source was a permanent (triggers/match.ts, CR 109.2)
      'feature:ev.damage.sourcePermanent',
      'feature:ev.damage.toOtherThanSourceController', // edhd63: Bitter Feud (triggers/match.ts, effects/replacements.ts; CR 120.1, 109.4)
      'feature:target.player.dealtCombatDamageBySource', // edh-cast-13: "target player who was dealt combat damage by ~ this turn" (actions/announce.ts#FEATURES, rules/targets.ts, CR 115.1, 510.2)
      'feature:mana.restriction.costHasX', // edh-mana-keywords-11: "Spend this mana only on costs that contain {X}." (rules/sources.ts#spendAllows, CR 106.6, 107.3)
      'feature:target.player.dealtDamage', // edh-next-86: "any target that was dealt damage this turn" (actions/announce.ts#FEATURES, rules/targets.ts, CR 115.4, 120.1)
      'feature:target.player.lostLife', // edh-c-34: "target player who lost life this turn" (actions/announce.ts#FEATURES, rules/targets.ts, effects/ctx.ts, CR 115.1, 119.3)
      'feature:target.player.activePlayer', // trek-16: "target opponent whose turn it is" (actions/announce.ts#FEATURES, rules/targets.ts, effects/ctx.ts, CR 115.1, 500.1)
      'feature:ev.attacks.otherThanAttacker', // edh-players-20: "an opponent attacks another one of your opponents" (triggers/match.ts, CR 506.2, 508.1b)
      'feature:ev.becomes.into', // edh-next-76: "whenever a permanent you control transforms into a Phyrexian"
      'feature:ev.becomes.notAsAttacker', // edh-players-20: "becomes tapped, if it isn't being declared as an attacker" (triggers/normalize.ts, match.ts, CR 508.1f)
      'feature:ev.life.totalAmount', // edh-players-20: "one or more opponents each lose exactly 1 life" (triggers/occurrences.ts#byPlayerTotal, CR 119.3, 603.2c)
      'feature:target.divide.upTo', // edh-perms-22: "distribute up to that many +1/+1 counters among any number of target creatures" (actions/announce-targets.ts#announceDivision, core/validate.ts, CR 601.2d)
      'feature:announce.qty.lifeGainedThisTurn', // edh-perms-22: the life the announcing player gained this turn, read as the targets are announced (actions/announce-cond.ts, CR 119.3, 603.3d)
      'feature:announce.qty.timesMutated', // edh-next-140: "up to X target creatures, where X is the number of times this creature has mutated" (actions/announce-cond.ts, CR 702.140d, 601.2c)
      'feature:resultCount.attempted', // edh-perms-22: "if you return four or more nontoken permanents you control this way" counts a commander put into the command zone instead (effects/eval.ts, CR 903.9b, 608.2c)
      'feature:keyword.exceptAttached', // edh-perms-21: protection that doesn't remove the Aura granting it / Auras (rules/protection.ts, CR 702.16c)
      'feature:keyword.exceptAttached.kinds', // edh-d-24: "This effect doesn't remove Auras (and Equipment you control that are already attached to it)" (keywords/hooks/protection.ts, CR 702.16c-d)
      'feature:restrict.onlyNearest.attack', // edhd63: "may attack only the nearest opponent in the chosen direction" (statics/hooks.ts#verdict)
      'feature:ref.seat.chosen', // edhd63: "the next player in the chosen direction" (effects/refs.ts, statics/match.ts; CR 101.4, 607.2d)
      'feature:ref.linked.ever' /* edh-d-96 */, 'feature:ref.linked.except', // edh-perms-21: "all other tokens created with ~" (effects/refs.ts#resolveObjs, a resolved effect only)
      'feature:permit.cast.zone.anyGraveyard', // edh-zones-27: a resolved effect's "you may cast ... from any graveyard" (statics/play-permits.ts#graveyardCandidates, graveyardPermitUses; CR 601.3, 400.3)
      'feature:ev.action.fight', // edh-combat-6: "whenever one or more creatures you control fight" (effects/handlers/lifedamage.ts#fightBetween, CR 701.14a)
      'feature:ev.action.payCumulativeUpkeep', 'feature:ev.action.failCumulativeUpkeep', // edh-d-74: "whenever you pay ~'s cumulative upkeep" (effects/handlers/pay.ts, CR 702.24a)
      'feature:ev.action.evolve', // edh-c-48: "whenever ~ evolves" (effects/handlers/counters.ts, CR 702.100a)
      'feature:ev.becomesBlocked.byAtLeast', // edh-c-48: "becomes blocked by two or more creatures" (triggers/normalize.ts, CR 509.3e)
      'feature:mana.restriction.foretell', // edh-c-48: mana for the foretell special action (rules/sources.ts, CR 116.2h, 702.143a)
      'feature:permit.attackAsThoughNoDefender.attackedYouLastTurn', // edh-combat-6: "can attack players who attacked you during their last turn as though it didn't have defender" (statics/hooks.ts#permits, CR 609.4)
      'feature:restrict.onlyAlone.attack', // edh-combat-6: "~ can only attack alone" (statics/hooks.ts#onlyAttacksAlone, core/combat.ts, CR 506.5, 508.1c)
      'feature:restrict.perPlayer.block', // edh-combat-6: "Each opponent can't block with more than one creature this combat" (statics/hooks.ts#declarationLimits, CR 509.1b)
      'feature:trigger.resolvesIfIllegal', // edh-top-9: "This ability still resolves if its target becomes illegal" (effects/run.ts, CR 608.2b)
      'feature:ev.action.destroy.by', // edh-players-22: "a spell or ability an opponent controls destroys ..." (triggers/normalize.ts `destroyedBy`, match.ts, CR 701.8a, 109.5)
      'feature:ev.action.enlist', // edh-c-49: "whenever ~ enlists a creature" (core/attack-options.ts, CR 702.154a)
      'feature:rulemod.targetableThroughHexproof.players', // edh-players-22: a player's hexproof waived by "as though they didn't have hexproof" (statics/hooks.ts#hexproofIgnored, CR 702.11c, 609.4)
      'feature:rulemod.targetableThroughHexproof.player', // edh-players-22: only the spells and abilities of that player (statics/hooks.ts#hexproofIgnored)
      'feature:announce.history.sharesWith', // edh-players-22: prowl's "a creature with a creature type of this spell" (actions/announce-cond.ts, rules/history.ts, CR 702.76a)
      'feature:resultCount.to', // edh-c-61: "the number of creatures that died this way" counts the destroyed creatures that went to the graveyard (effects/eval.ts, CR 701.8a, 700.4, Hellfire ruling 2009-10-01)
      'feature:ev.attacks.allAttack', // edh-c-83 (CR 508.1, 603.2c): "all non-Wall creatures you control attack" (triggers/match.ts)
      'feature:announce.qty.happenedPlayers.opponents', // edh-c-30: "an opponent had two or more lands enter the battlefield under their control this turn" (model/forms.ts#isOpponentsHappenedPlayers, actions/announce-cond.ts, CR 102.3, 118.9)
      'feature:announce.qty.devotion', // edh-next-42 (CR 700.5): Mogis's Marauder's "up to X target creatures, where X is your devotion to black"
      'feature:ev.action.connive', // edh-next-33 (CR 701.50a): the connive macro ends with op reportAction 'connive' for the creature
      'feature:ev.action.foretell', // edh-d-73 (CR 702.143a): the foretell special action emits `actionPerformed` 'foretell' (Dream Devourer)
      'feature:announce.qty.countPlayers.bare', // edh-next-39 (CR 102.3, 601.2c; Rot Hulk): "up to X target ..., where X is the number of opponents you have", read as the targets are announced
      'feature:ev.becomes.crewed', // edh-next-39 (CR 702.122e): the crew keyword reports the crew action as the crew ability resolves (keywords/data/crew.json)
      'feature:resultCount.lost', // edh-next-128: "for each flip you lose", the flips a called flip of several coins lost (effects/eval.ts, CR 705.2)
      'feature:target.sharedPermanentType', // edh-next-54: "two target permanents that share a permanent type" (rules/targets.ts#sharedCardTypeHolds, CR 110.4, 205.2a)
      'feature:mana.restriction.viaAlt', // edh-d-22 (CR 118.9, 702.146a): "Spend this mana only to pay a disturb cost" (rules/sources.ts#spendAllows)
      'feature:mana.anyOneColor.otherGroup', // edh-d-22 (CR 106.1b): "two mana of any one color and two mana of any other color" (effects/handlers/cards-mana.ts)
      'feature:permit.cast.alternative.manaValue', 'feature:ev.activate.targetsYourCreature', // edh-next-67 (Kentaro; Professor Hojo)
      'feature:activate.spendOnlyX', 'feature:spell.spendOnlyX', // edh-next-85 (CR 107.3a, 106.6): "Spend only black mana on X." (actions/activate.ts#abilityPlan, actions/cast.ts#base; Crypt Rats, Consume Spirit)
      'feature:permit.play.freeSubtypes', 'feature:permit.cast.freeSubtypes', 'feature:permit.play.increaseIfOpponent', 'feature:permit.cast.increaseIfOpponent', // edh-d-58 (CR 118.9, 601.2f): Nahiri's free Equipment, Soul Partition's opponent-only increase (statics/play-permits.ts)
      'feature:mana.activation.graveyard', // edhd65-mana-ability-graveyard (CR 113.6m, 605.1a): "{1}, Exile this card from your graveyard: Add one mana of any color." (rules/mana.ts#manaAbilityDenial)
      'feature:costMod.abilities.manaLife', // edh-next-106 (CR 601.2f, 605.1a, 119.4): "Mana abilities of this land cost an additional 1 life to activate"
      'feature:layer6.addActivatedOf.loyalty', // edh-next-124 (CR 606.1, 613.1f): "has all loyalty abilities of ..." (statics/mods.ts#activatedOf)
      'feature:rulemod.untapDuringOtherUntapSteps.opponents', // edh-next-124 (CR 502.3): "during each opponent's untap step" (statics/hooks.ts#untapsDuringOthersUntapStep)
      'feature:costMod.abilities.firstOfType', // edh-next-124 (CR 602.2, 601.2f): "the first activated ability of an artifact you activate each turn" (rules/typed-activations.ts)
      'feature:costMod.abilities.loyalty', // edh-next-142 (CR 606.4, 601.2f): "loyalty abilities you activate cost an additional [+1]" (actions/activate.ts#costChangeOf)
      'feature:modes.countIsX', // edh-next-139: "Choose X." (actions/announce.ts#FEATURES, CR 601.2b, 601.4)
      'feature:q.chosenNumber.of', // edh-next-139: the number one player paid (effects/eval.ts#QTY_FEATURES, CR 608.2d)
      'feature:spellManaSpent.activation', // edh-next-139: mana spent to activate this ability (effects/eval.ts#QTY_FEATURES, CR 602.2b)
      'feature:q.chosenNumber.extreme', // edh-next-120: "the highest number" chosen by several players (effects/eval.ts#QTY_FEATURES, CR 608.2d)
      'feature:target.chooser.eventSubjectController', // edh-next-134: "its controller chooses target ..." in a trigger (actions/announce-targets.ts#chooserOf, CR 603.3d)
      'feature:each.otherPlayer.than', // edh-next-134: "its owner draws ... and each other player loses ..." (effects/refs.ts, CR 102.1, 608.2c)
      'feature:static.asCast', // edh-next-133 (CR 611.3d, 400.7b): "... spells you cast gain evoke {4} as you cast them" (actions/cast-kinds.ts, core/turn-effects.ts#lockAsCastGrants)
      'feature:copy.thisAbility.reflexive', // edh-next-133 (CR 707.9a, 603.12): "this ability" in a reflexive trigger (effects/handlers/lasting.ts#bakeThisAbility)
      'feature:action.native.rollPlanarDie', // edh-next-127 (CR 901.3, 706.7): no planar die outside Planechase (effects/handlers/planechase.ts)
      'feature:permit.play.onCast', 'feature:permit.cast.onCast', // edh-next-127 (CR 603.7a): "When you cast a spell this way, ..." (statics/play-permits.ts#onCastPermits)
      'feature:target.eachWithOne', // edh-next-127 (CR 115.1, 601.2c): one target in each graveyard that has one (rules/targets.ts#targetRange)
      'feature:spell.xMin', // edh-d-98 (CR 107.3, 601.2b; Mind Grind): "X can't be 0." of a spell (actions/cast.ts)
      'feature:replace.draw.firstEachTurn', // edh-d-98 (CR 121.2, 614.1a; Scion of Halaster): "the first time you would draw a card each turn" (effects/replacements.ts#matchProposed)
      'feature:permit.cast.linked.lasting', // edh-d-99 (CR 607.2a, 611.2a): a resolved cast permission for the cards exiled with ~, locked as it begins (King Narfi's Betrayal; effects/handlers/lasting.ts)
      'feature:piles.given', // edh-next-135: two given piles, one turned face up (effects/handlers/cards-reveal.ts#givenPiles, CR 700.3, 406.3)
      'feature:announce.cond.firstSpellCast', // edh-next-143 (CR 601.2b, 118.9): an alternative cost's "if this spell is the first spell you've cast this game" (actions/announce-cond.ts)
      'feature:permit.cast.top.ofLibrary', 'feature:permit.play.top.ofLibrary', 'feature:permit.lookAt.ofLibrary', // edh-next-143 (CR 401.5, 601.3): another player's top card (statics/play-permits.ts)
      'feature:restrict.ignoreFor', // edh-next-143 (CR 116.2d): "Any player may pay {2} for that player to ignore this effect until end of turn" (core/special/ignore-effect.ts)
      'feature:static.effectWhen', // edh-next-147: a continuous effect's own condition (statics/live.ts, CR 611.3a)
      'feature:keyword.miracle.costIsManaCostLess', // edh-d-102: a granted miracle whose cost is the mana cost reduced by generic mana (CR 702.94a; triggers/miracle.ts)
      'feature:layer6.keywordsOf', // edh-d-102: the listed keywords of other objects (CR 613.1f; statics/mods.ts#keywordsOf)
      'feature:permit.play.linked.ownOnly', // edh-d-102: each player's permission for the linked cards they exiled, judged by owner (CR 607.2a, 121.1; statics/play-permits.ts)
      'feature:permit.cast.colorlessAnyColor', // edh-d-97: "you may spend colorless mana as though it were mana of any color to cast that spell" (statics/play-permits.ts, CR 609.4b)
      'feature:action.native.meldPair.attacking', // edh-d-89: meldPair's attacking partner and the result entering tapped and attacking (CR 508.4; effects/handlers/meld-pair.ts)
      'feature:activate.attackedPlayerOnly', // edh-d-88 (CR 602.2; Capricopian): only the player the source attacks activates it (actions/activate.ts)
      'feature:ref.controlsAny.atLeast', // edh-d-88 (CR 109.4; Owlbear Cub): "a player who controls eight or more lands" (effects/refs.ts, triggers/filters.ts)
      'feature:require.allIfAny.attack', // edh-d-88 (CR 508.1d; War's Toll): "if a creature an opponent controls attacks, all creatures that opponent controls attack if able" (rules/requirements.ts)
      'feature:choose.chooser', // edh-d-72 (CR 614.12a, 608.2d): "As ~ enters, an opponent chooses a creature type." (effects/bodies/m5.ts; Callous Oppressor)
      'feature:costMod.abilities.targets.self', // edh-next-107 (CR 601.2c, 602.2b): "activated abilities of Equipment you control that target ~ cost {1} less" (actions/activate.ts#costChangeOf; Bladegraft Aspirant)
      'feature:announce.sref.event.chooser', 'feature:target.chooserElse', // edh-d-87 (CR 601.7a, 603.3d; Bladegriff Prototype): actions/announce-targets.ts#chooserOf
      'feature:permit.play.onlyTypes.land', // edh-d-87 (CR 305.1, 601.3; The Omenkeel): "you may play lands from among those cards" (statics/play-permits.ts#namedObjects)
      'feature:permit.cast.spellKeyword', // edh-d-91 (CR 601.2f, 702.41a): Chiss-Goria's affinity for the spell cast with a permission, Coram's static permit from any graveyard (statics/play-permits.ts)
      'feature:keyword.ward.costX', // edh-next-146: "~ has ward {X}, where X is ..." (keywords/expand.ts, CR 702.21b)
      'feature:ref.grantCaster', // edh-next-146: "the player who cast ¤" in a spell's granted ability (effects/handlers/lasting.ts#fixGrantCaster, CR 611.2c)
      'feature:target.chooserControls', // edh-next-146: "target creature of an opponent's choice they control" (actions/announce-targets.ts, CR 601.7a)
      'feature:layer4.namedChosen', // edh-next-146: "its name is the last chosen name" (statics/mods.ts#layer4, CR 612.8)
      'feature:permit.play.linked.activePlayer', 'feature:permit.play.linked.oncePerTurn', 'feature:permit.play.linked.onUse', 'feature:permit.cast.linked.onUse', // edh-d-100 (Share the Spoils; statics/play-permits.ts#isLinkedRiderPermit)
      'feature:permit.play.linked.notOwn', 'feature:permit.play.linked.anyManaType', // edh-d-100: the same play form's other riders
      'feature:permit.play.reduce', 'feature:permit.cast.reduce', // edh-d-100 (Urianger Augurelt; statics/play-permits.ts#namedPermitReduce)
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
      'cost:action', 'cost:addMana' /* edh-mana-keywords-12, CR 702.24a */, 'cost:behold' /* FAST5X E11, CR 701.4a */, 'cost:chooseObject' /* std-costs-2, CR 601.2b */, 'cost:discard', 'cost:draw' /* edh-c-48, CR 702.24a */, 'cost:exileFrom', 'cost:exileTop' /* edh-d-74, CR 701.13a */, 'cost:flipCoin' /* edh-d-74, CR 705.1 */, 'cost:getCounters' /* FAST5X E27, CR 122.1f */, 'cost:manual', 'cost:mill', 'cost:moveCards' /* edh-d-54, CR 118.3 */, 'cost:oneOf' /* FAST5X E27, CR 601.2b */, 'cost:opponentGainsLife' /* edh-cast-14, CR 118.1 */, 'cost:payEnergy', 'cost:payLife', 'cost:putCounters', 'cost:putIntoLibrary' /* trek-9, CR 118.3, 401.4 */, 'cost:removeCounters', 'cost:returnToHand', 'cost:reveal', 'cost:revealChosen' /* std-combat-5, CR 608.2d */, 'cost:rollDie' /* edh-d-49, CR 706.2, 118.3 */,
      'cost:sacrifice', 'cost:tapPower', 'cost:tapUntapped',
      'cost:unattach' /* edh-top-15, CR 701.3d, 118.3 */,
      'cost:untapTapped' /* p2-cost-parts-1, CR 701.26b */,
    ]);
    expect(byPrefix.get('target')!.sort()).toEqual(['target:ability', 'target:anyTarget', 'target:object', 'target:objectOrPlayer', 'target:player', 'target:spell', 'target:stackObject']);
    expect(ENGINE_CAPABILITIES.has('filter:power')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('filter:sharesWith')).toBe(true); // evaluated by WP4 with a FilterEnv; advertised since every call site passes one (WP30, rules/filter-env.ts)
    expect(ENGINE_CAPABILITIES.has('filter:dealtDamageThisTurn')).toBe(true); // the history fields come with the package that writes the history (WP8: feature:history)
    expect(byPrefix.get('decision')).toHaveLength(20); // M11-0: commanderZone (CR 903.9); shortcuts: shortcut (CR 727)
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
