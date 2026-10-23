/**
 * FAST5 PROMO2: the evidence of the design 6.9 review of the experimental templates of parser/templates/zz-fast3 and zz-fast4 (2026-10-14).
 *
 * For each template, every card of the whole local index (34,473 cards) that used it was read against its Oracle text next to its compiled JSON and its
 * rendered text (the exact render gate, G6), and the readings no earlier scenario played were played (promo2-scenarios.test.ts; the T13-T34 scenario
 * files play the rest). `matches` is the number of index cards that used the template before the promotion, `full` the number the promotion makes full
 * (with every PROMO2 promotion applied), `golden` the verified golden cards (test/m5/golden/cards/fast5-promo2-review.json): the three most played of
 * the cards made full, or all of them when fewer, plus a partial card where the template's only matches stay partial for another reason.
 * DEVIATION recorded: design 6.9 asks for 20 reviewed matches or three golden cards; a template with fewer than three index matches is
 * promoted with every match reviewed and every card it makes full a golden card (as WP23 did for se.player.may.bf and eff.exchange.control).
 */
export const PROMO2_PROMOTED: Readonly<Record<string, { matches: number; full: number; golden: readonly string[] }>> = {
  "eff.t13.pump.or.2": { matches: 2, full: 2, golden: ["Multiform Wonder","Shaper Parasite"] },
  "eff.t14.exile.opponentsGraveyards": { matches: 3, full: 1, golden: ["Kaya's Guile"] },
  "eff.t14.player.exilesNFromHand": { matches: 4, full: 3, golden: ["Perfect Intimidation","Aim for the Head","Vessel of Malignity"] },
  "eff.t15.player.cant.gainlife.dur": { matches: 2, full: 0, golden: ["Atarka's Command"] },
  "eff.t16.each.cantblock.self": { matches: 1, full: 1, golden: ["Sabertooth Alley Cat"] },
  "eff.t17.search.anyNumber.bf": { matches: 7, full: 1, golden: ["Sarkhan Unbroken"] },
  "eff.t17.search.anyNumber.reveal.top.anyOrder": { matches: 2, full: 2, golden: ["Goblin Recruiter","Dwarven Recruiter"] },
  "eff.t17.token.choice3": { matches: 2, full: 1, golden: ["The Third Doctor"] },
  "eff.t18.lead.pumpForEach.grant": { matches: 3, full: 3, golden: ["Get a Leg Up","King Harald's Revenge","Chorus of Might"] },
  "eff.t18.removeFromCombat": { matches: 10, full: 4, golden: ["Reconnaissance","Labyrinth of Skophos","Hollowhenge Spirit"] },
  "eff.t20.discover.whereX": { matches: 5, full: 2, golden: ["Hurl into History","Monstrous Vortex"] },
  "eff.t30.bounce.another": { matches: 12, full: 11, golden: ["Ambrosia Whiteheart","Mistbreath Elder","Temur Sabertooth"] },
  "eff.t30.bounce.playerChooses": { matches: 4, full: 3, golden: ["Mana Breach","Blizzard Specter","Sunken Hope"] },
  "eff.t30.damage.andItself": { matches: 3, full: 3, golden: ["Psionic Sliver","Reckless Embermage","Psionic Entity"] },
  "eff.t30.damage.twoTargets": { matches: 8, full: 7, golden: ["Boulder Dash","Shower of Sparks","Explosive Welcome"] },
  "eff.t30.damage.whereX": { matches: 49, full: 32, golden: ["Road Rage","Explosive Prodigy","Calamitous Cave-In"] },
  "eff.t30.draw.forEachCounterOn": { matches: 17, full: 10, golden: ["Marketback Walker","Insight Engine","The Magic Mirror"] },
  "eff.t30.draw.forEachDiedThisTurn.then": { matches: 1, full: 1, golden: ["Deadly Embrace"] },
  "eff.t30.exile.playerChooses": { matches: 3, full: 2, golden: ["Early Winter","Debt to the Kami"] },
  "eff.t30.gainLife.forEachOther1": { matches: 2, full: 1, golden: ["Speakeasy Server"] },
  "eff.t30.gainLife.forEachOther2": { matches: 1, full: 1, golden: ["Goldnight Redeemer"] },
  "eff.t30.loseLife.halfRoundedUp": { matches: 13, full: 3, golden: ["Quietus Spike","Havoc Festival","Radioactive Man"] },
  "eff.t30.loseLife.whereX": { matches: 12, full: 6, golden: ["Midnight Snack","Commissar Severina Raine","Defiling Daemogoth"] },
  "eff.t30.may.haveDiscard": { matches: 6, full: 5, golden: ["Hollowsage","Ebon Dragon","Slavering Nulls"] },
  "eff.t30.may.haveMill": { matches: 3, full: 3, golden: ["Jace's Erasure","Iceberg Cancrix","Extractor Demon"] },
  "eff.t30.may.millEqualTo": { matches: 1, full: 1, golden: ["Lasyd Prowler"] },
  "eff.t30.mill.equalTo": { matches: 8, full: 5, golden: ["Space-Time Anomaly","Veteran Ice Climber","Altar of Dementia"] },
  "eff.t30.mill.halfLibraryRoundedUp": { matches: 3, full: 2, golden: ["Terisian Mindbreaker","Fleet Swallower"] },
  "eff.t30.mill.thenPutFromAmongThem": { matches: 1, full: 1, golden: ["Thranduil, Sindarin Liege // Silvan Rally"] },
  "eff.t30.mill.whereX": { matches: 12, full: 10, golden: ["Master Pakku","Phenax, God of Deception","Dreamborn Muse"] },
  "eff.t30.return.bf.additionalCounters": { matches: 6, full: 4, golden: ["Rakdos Joins Up","Evil Reawakened","Generous Revival"] },
  "eff.t30.search.may.reveal.hand.manaValueAtLeast": { matches: 2, full: 2, golden: ["Fierce Empath","Treasure Mage"] },
  "eff.t31.counters.removeUpTo.any": { matches: 5, full: 3, golden: ["Mabel, Bitter Recluse","Glissa Sunslayer","Render Inert"] },
  "eff.t31.flicker.may.owner": { matches: 2, full: 1, golden: ["Gossip's Talent"] },
  "eff.t31.flicker.may.you": { matches: 2, full: 2, golden: ["Conjurer's Closet","Restoration Angel"] },
  "eff.t31.flicker.owner": { matches: 6, full: 3, golden: ["Displacer Kitten","Felidar Guardian","Wispweaver Angel"] },
  "eff.t31.permit.play.thisTurn": { matches: 59, full: 16, golden: ["Count on Luck","Araña, Heart of the Spider","Ark of Hunger"] },
  "eff.t31.permit.play.whileControlled": { matches: 3, full: 1, golden: ["Lightning, Security Sergeant"] },
  "eff.t31.return.selfAndTarget.gy.bf.tapped": { matches: 1, full: 1, golden: ["Sandman, Shifting Scoundrel"] },
  "eff.t31.search.ifCond.reveal.hand": { matches: 8, full: 4, golden: ["Formidable Speaker","Pia, Aether Ascetic","Subway Train"] },
  "eff.t31.search.may.mvAtMost.reveal.hand": { matches: 3, full: 2, golden: ["Spellseeker","Trinket Mage"] },
  "eff.t31.search.may.mvEquals.reveal.hand": { matches: 4, full: 4, golden: ["Micromancer","Tribute Mage","Trophy Mage"] },
  "eff.t31.search.may.upTo.threeKinds.mvAtMost.reveal.hand": { matches: 1, full: 1, golden: ["Brightglass Gearhulk"] },
  "eff.t31.search.nonlegendary.graveyard": { matches: 1, full: 1, golden: ["Unmarked Grave"] },
  "eff.t31.search.orCardWithKeyword.reveal.hand": { matches: 2, full: 2, golden: ["Mystical Teachings","Waterlogged Teachings // Inundated Archive"] },
  "eff.t31.search.orMvAtMost.reveal.hand": { matches: 1, full: 0, golden: ["Starfield Shepherd"] },
  "eff.t31.search.powerAtMost.reveal.hand": { matches: 1, full: 1, golden: ["Imperial Recruiter"] },
  "eff.t31.search.reveal.shuffle.theCardOnTop": { matches: 1, full: 1, golden: ["Worldly Tutor"] },
  "rst.t16.cantbetargeted.black": { matches: 1, full: 1, golden: ["Mercenary Informer"] },
  "rst.t16.cantbetargeted.red": { matches: 1, full: 1, golden: ["Suq'Ata Firewalker"] },
  "rst.t16.cantbetargeted.white": { matches: 2, full: 1, golden: ["Rebel Informer"] },
  "rst.t16.each.cantattackblock": { matches: 4, full: 3, golden: ["Gwafa Hazid, Profiteer","Doomed Artisan","Light of Day"] },
  "rst.t16.two.groups.cantblock": { matches: 1, full: 1, golden: ["Magistrate's Veto"] },
  "sta.t24.aslong.basept": { matches: 2, full: 2, golden: ["Doc Ock, Sinister Scientist","Awakened Awareness"] },
  "sta.t24.aslong.counter.attack.nodefender": { matches: 1, full: 1, golden: ["Demon Wall"] },
  "sta.t24.basetoughness": { matches: 1, full: 1, golden: ["Maha, Its Feathers Night"] },
  "sta.t24.lords.pumpgrant.gainedlife": { matches: 1, full: 1, golden: ["Thornfist Striker"] },
  "sta.t24.spells.cast.cascade": { matches: 1, full: 1, golden: ["The First Sliver"] },
  "sta.t24.spells.cast.each.conspire": { matches: 2, full: 2, golden: ["Raiding Schemes","Wort, the Raidmother"] },
  "sta.t24.spells.cast.storm": { matches: 1, full: 1, golden: ["Prismari, the Inspiration"] },
  "sta.t24.yourturn.basept": { matches: 1, full: 1, golden: ["Snowmelt Stag"] },
  "trg.t27.attacksOrBlocks.while": { matches: 1, full: 1, golden: ["Burning Sun Cavalry"] },
  "trg.t27.cast.noncreatureOrSubtype": { matches: 2, full: 1, golden: ["Firespitter Whelp"] },
  "trg.t27.life.gain.firstYourTurns": { matches: 1, full: 1, golden: ["Cat Collector"] },
  "trg.t27.life.gainOrLose.yourTurn": { matches: 2, full: 2, golden: ["Moonstone Harbinger","Wax-Wane Witness"] },
  "trg.t27.player.discard.batch": { matches: 1, full: 1, golden: ["Tinybones, Pocket Nuisance"] },
  "trg.t27.youAttack.while": { matches: 3, full: 3, golden: ["The Chief Warg","Tactical Officer","La'An Noonien-Singh, Security"] },
  // cloud std-blb (2026-10-16, after the parser change its PROMO2 held reason asked for: parser/lower/conditions.ts#foldDidInIf, "If you do" after "Then if C, X."
  // reads X inside the branch; parser/lower/quantities.ts, "the difference" of the branch's own condition): on fast5/main fa0aa5e7 the 50 index cards that used it
  // all keep it and 36 of them become full, checked by the exact render gate (G6) and the coverage diff (G10: 0 down); six more cards read a sentence with it
  // (five Ordeals, full before with the same JSON, and the card the held reason names). Golden, read by hand: the two backlog cards of the slice and Hour of
  // Promise (outside Standard: the slice opens no held-out card, design 6.12)
  "eff.t34.thenIf": { matches: 50, full: 36, golden: ["Coiling Rebirth","Psychic Whorl","Hour of Promise"] },
};

/**
 * The experimental templates of zz-fast3 and zz-fast4 PROMO2 left experimental, each with the reason. Promoted since (each with its own evidence): eff.t34.thenIf by
 * Cloud std-fin, once parser/lower/conditions.ts resolved "If you do" after "[Then] if C, <one instruction>." (foldActionInIf: The Misty Mountains Cold is full, not
 * manual); golden cards in test/m5/golden/cards/cloud-std-fin-review.json, tests in test/cloud/std-fin/.
 */
export const PROMO2_HELD: Readonly<Record<string, string>> = {
  'rst.t16.cantbetargeted.blue': 'no card of the index uses it: nothing to review',
  'rst.t16.cantbetargeted.green': 'no card of the index uses it: nothing to review',
  'trg.t27.anotherSubtypeAndOrArtifact.enters': 'no card of the index uses it: nothing to review',
  'eff.t30.gainLife.forEachOther3': 'no card of the index uses it: nothing to review',
  'eff.t30.draw.forEachDiedThisTurn': 'no card of the index uses it: nothing to review',
  'eff.t30.draw.youAndPlayerEach': 'no card of the index uses it: nothing to review',
  'eff.t31.search.may.orFilter.reveal.hand': 'once stable it takes "an A or B card" from eff.t10.search.may.reveal.hand (zz-fast2, experimental) with another filter form (anyOf of two subtype filters for one subtypes list): 3 formerly automated units change (Deadeye Quartermaster, Shrine Steward, Caradora; G10). Promote it together with the t10 template',
  'rep.t15.enters.bf.tapped': 'its 15 index matches are all unsanctioned or digital-only cards (capped manual anyway): no gain, nothing a player plays',
};

/** The golden cards of every PROMO2 promotion (checked against fast5-promo2-review.json by promo2-evidence.test.ts). */
export const PROMO2_GOLDEN: readonly string[] = [...new Set(Object.values(PROMO2_PROMOTED).flatMap((e) => e.golden))];
