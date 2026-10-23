/**
 * FAST5 PROMO1: promotion of experimental parser templates (design 6.9: "experimental until it has 20 reviewed matches or three independently verified golden
 * cards"). Every index card a promoted template matches was read against its Oracle text next to its compiled and rendered abilities; the golden cards are
 * test/m5/golden/cards/fast5-promo1-review.json (enforced by test/m5/golden/golden.test.ts). This file pins the statuses and the evidence, and plays the risky
 * shapes through applyAction with cards compiled by the game's default compiler (the wordings of the reviewed cards, under test names).
 *
 *   CR 701.23a, 701.24a, 110.5b  "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle" (se.library.one)
 *   CR 305.4, 110.2              "You may put a land card from your hand onto the battlefield" is not a land play (ch.put.fromHand)
 *   CR 118.9, 601.2b             "If you control a Swamp, you may pay 4 life rather than pay this spell's mana cost" (cm.alternative.if)
 *   CR 603.10a, 400.7, 110.2     "When enchanted creature dies, return it to the battlefield tapped under its owner's control" (eff.return.bf.owner.tapped)
 *   CR 701.28a, 603.2            "When this creature transforms into <back face>, ..." triggers when it transforms (trg.m6.self.transformsInto)
 *   CR 205.1b, 613.1d            "becomes a 4/5 green Treefolk creature ... It's still a land": the land keeps its land type and mana ability
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { TEMPLATE_SET } from '../../../src/parser/template-set';
import { answer, find, findAll, life, scenario } from '../../m3/scenario';
import { activate, cast, drive, resolveTop, target } from '../../m5/cr-examples/helpers';
import { castMethodsOffered, castWith } from '../../m6/costs/support';
import promo1Review from '../../m5/golden/cards/fast5-promo1-review.json';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string], colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const options = (s: GameState): ObjectId[] => (s.pending as unknown as { options: ObjectId[] }).options;

/** The templates FAST5 PROMO1 promoted, each with at least three hand-verified golden cards. */
const PROMOTED = [
  'se.library.one', 'se.library.reveal', 'ch.put.fromHand', 'eff.discard.hand', 'eff.piles.handgrave', 'eff.cont.becomes.color.subtype',
  'rid.mana.instantsorcery', 'eff.return.bf.owner.tapped', 'eff.return.bf.attacking', 'eff.prevent.next.player', 'eff.t6.return.choose.yourHand',
  'eff.t6.discardHand.drawThatMany', 'eff.t10.search.may.bf.tapped', 'eff.t10.search.may.reveal.hand', 'eff.t10.search.reveal.top',
  'eff.t10.search.may.reveal.top', 'eff.t10.search.subPermanent.mv.bf', 'eff.t10.put.fromHand.tapped', 'eff.t10.look.top.putBack.anyOrder',
  'eff.t10.player.exilesFromHand', 'cm.alternative.if', 'cm.alternative.mana', 'cm.alternative.mana.and', 'trg.m6.self.transformsInto', 'eff.m6.manifest.top',
];

/**
 * Reviewed and left experimental: fewer than three index cards would be fully understood with them, so design 6.9's three golden cards cannot exist yet
 * (or, for fl.forEach.opponent and the cards held below, the matches were not all played). One line each.
 */
const HELD: Readonly<Record<string, string>> = {
  'eff.shuffle.player': '2 cards made full (Soldier of Fortune, Boggart Forager): correct, but under three golden cards',
  'eff.cont.becomes.subtype': '2 cards made full (Hostile Desert, Skarrg Guildmage): correct, under three golden cards',
  'eff.damage.foreach': '1 card made full (Lotleth Giant)',
  'eff.damage.evenly.down': '2 cards made full (Fireball, Dwarven Catapult)',
  'rid.mana.artifact': '2 cards made full (Castle Doom, La Forge)',
  'rid.mana.chosentype': '2 index matches (Unclaimed Territory, Pillar of Origins)',
  'eff.put.bf.owner': '2 cards made full (Kenrith, Bilbo)',
  'eff.put.lib.bottom.anyorder': '1 card made full (Bow of Nylea)',
  // sta.pump.cantbeblocked: held here by PROMO1 (2 cards then); Standard round 4 r4-fxb made it stable with three golden cards (Aether Tunnel, Tricks of the
  // Trade, Cryptic Coat: test/m5/golden/cards/cloud-r4-fxb-review.json)
  // sta.cantblock.noactivate: held here by PROMO1 (2 index matches (Demotion, Gelid Shackles)); p2-promote-2 made it stable on the card(s) that print it (6.9 narrow wording)
  // kw.typecycling.wizard: held here by PROMO1 (2 index matches (Step Through, Vedalken Aethermage)); p2-promote-2 made it stable on the card(s) that print it (6.9 narrow wording)
  // rst.each.blockonly: held here by PROMO1 (2 index matches (Chaosphere, Dense Canopy)); p2-promote-2 made it stable on the card(s) that print it (6.9 narrow wording)
  // cm.m6.additional.choice.manaFirst: held here by PROMO1; r4-fxb made it stable, both cards of the index that print it golden (Deadly Precision,
  // Annihilating Glare: test/m5/golden/cards/cloud-r4-fxb-review.json)
  // rep.m6.enters.counters.kicked: held here by PROMO1 (1 index match (Vodalian Mindsinger)); p2-promote-2 made it stable on the card(s) that print it (6.9 narrow wording)
  // eff.m6.gainlife.kicked: held here by PROMO1 (2 index matches, 1 made full (Lightkeeper of Emeria)); p2-promote-2 made it stable on the card(s) that print it (6.9 narrow wording)
  // eff.m6.sacrifice.unless: held here by PROMO1 (3 index matches then); Cloud std-eoe made it stable with three golden cards (cloud-std-eoe-review.json)
  // eff.m6.turnFaceDown: held here by PROMO1 (2 cards then); std-rx33 made it stable with three golden cards (Obscuring Aether, Wall of Deceit, Skittish Valesk:
  // test/m5/golden/cards/cloud-std-rx33-review.json)
  // trg.m6.yourCreature.mutates: held here by PROMO1 (1 index match (Essence Symbiote)); p2-promote-2 made it stable on the card(s) that print it (6.9 narrow wording)
  'eff.t8.gainlife.foreach3': '1 card made full (Filigree Angel)',
  'eff.t8.gainlife.foreach4': '1 index match (Shamanic Revelation)',
  'fl.forEach.opponent': '28 index matches, 1 made full; the per-opponent target forms ("up to one target ... that player controls") not played',
  // eff.mana.additional.two.player: held here by PROMO1 (2 cards made full; the trigger reads "tapped for mana" as any mana ability of the land, FAST1 T4's
  // reading of every "land tapped for mana", parser/holes/event.ts#landTappedForMana); p2-promote-1 made it stable on its two cards, Market Festival and
  // Dawn's Reflection (6.9 narrow wording; fast1-t4-review.json, test/cloud/p2-promote-1)
  // static.m6.turnedFaceUp.counters, eff.t6.shuffle.graveyardInto.you, dl.yourNextEnd.lead (Glorious End now played) and dl.nextEnd.lead: held here by PROMO1;
  // Standard round 3 r3-fx made them stable (dl.nextEnd.lead after closing its engine gap: a delayed ability checks the objects it fixed once, as it starts to
  // resolve, so "sacrifice it. If you do, you gain life equal to its toughness" reads the sacrificed creature as it last existed, effects/refs.ts#fixedObjs,
  // CR 603.7c, 608.2h; and a target the delayed sentence announces makes it manual, since the delayed ability chooses it when it triggers, CR 603.3d,
  // parser/lower/targets.ts#targetsInStepDelayLead): test/m5/golden/cards/cloud-r3-fx-review.json, test/cloud/r3-fx/r3-fx-scenarios.test.ts
  // eff.m6.turnFaceUp: held here by PROMO1 (11 matches); CLOUD std-mkm made it stable with three golden cards (Ixidor, Break Open, Expose the Culprit:
  // test/m5/golden/cards/cloud-std-mkm-review.json, test/cloud/std-mkm/std-mkm-templates.test.ts)
  // eff.look.top: held here by PROMO1 (187 matches, none made full by it); FAST5 T43 made it stable, its dig sentences (zz-fast5/t43.json) make those cards full
};

describe('design 6.9: the FAST5 PROMO1 statuses and their evidence', () => {
  it('every promoted template is stable and has at least three golden cards citing it, each pinned full', () => {
    const golden = promo1Review as { card: string; expect?: string; verified: string }[];
    for (const id of PROMOTED) {
      expect(TEMPLATE_SET.find((t) => t.id === id)?.status, id).toBe('stable');
      const cards = golden.filter((g) => g.verified.includes(`(${id})`) || g.verified.includes(`(${id};`) || g.verified.includes(`; ${id})`));
      expect(cards.length, `${id}: ${cards.map((c) => c.card).join(', ')}`).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) {
      expect(g.expect, g.card).toBe('full');
      expect(g.verified, g.card).toMatch(/CR \d{3}/);
    }
  });
  it('the reviewed templates that stay experimental, each with its reason', () => {
    for (const id of Object.keys(HELD)) expect(TEMPLATE_SET.find((t) => t.id === id)?.status, id).toBe('experimental');
  });
});

describe('CR 701.23a, 701.24a, 110.5b: "{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle."', () => {
  const WILDS = card('Test Wilds', 'Land', '{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.');
  it('is full; only basic lands are offered (never the Bears), the land enters tapped, the library is shuffled (new ids) and the source is in the graveyard', () => {
    expect(WILDS.automation.level).toBe('full');
    const s0 = scenario(['Forest', 'Grizzly Bears'], { p1: { battlefield: ['Test Wilds'], library: ['Grizzly Bears', 'Forest', 'Grizzly Bears'] }, defs: [WILDS] });
    const before = [...s0.zones.library.p1!];
    let s = activate(s0, find(s0, 'Test Wilds', 'battlefield'));
    expect(findAll(s, 'Test Wilds', 'graveyard')).toHaveLength(1);
    s = resolveTop(s);
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1' });
    const offered = options(s).map((id) => nameOf(s, id));
    expect(offered).toContain('Forest');
    expect(offered.every((n) => ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].includes(n))).toBe(true);
    s = answer(s, { kind: 'chooseObjects', ids: [options(s)[offered.indexOf('Forest')]!] });
    const forest = find(s, 'Forest', 'battlefield', 'p1');
    expect(s.objects[forest]!.tapped).toBe(true);
    expect(s.zones.library.p1!.some((id) => before.includes(id))).toBe(false);
    expect(s.zones.library.p1).toHaveLength(before.length - 1);
  });
});

describe('CR 305.4, 110.2: "Draw a card. You may put a land card from your hand onto the battlefield."', () => {
  const SPIRAL = card('Test Spiral', 'Instant', 'Draw a card. You may put a land card from your hand onto the battlefield.', '{0}', undefined, ['G']);
  it('is full; the land enters untapped under its owner\'s control and is not the turn\'s land play', () => {
    expect(SPIRAL.automation.level).toBe('full');
    const s0 = scenario(['Forest', 'Island', 'Grizzly Bears'], { p1: { hand: ['Test Spiral', 'Grizzly Bears'], library: ['Island', 'Forest'] }, defs: [SPIRAL] });
    let s = resolveTop(cast(s0, 'Test Spiral'));
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1' });
    expect(options(s).map((id) => nameOf(s, id))).toEqual([nameOf(s0, s0.zones.library.p1![0]!)]);
    s = answer(s, { kind: 'chooseObjects', ids: options(s) });
    const land = s.zones.battlefield.find((id) => s.objects[id]!.controller === 'p1')!;
    expect(s.objects[land]!.tapped).toBe(false);
    expect(s.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn).toBe(0); // CR 305.4: not a land play
  });
  it('CR 608.2d: choosing nothing leaves the hand as it is', () => {
    const s0 = scenario(['Forest', 'Island'], { p1: { hand: ['Test Spiral', 'Forest'], library: ['Island'] }, defs: [SPIRAL] });
    let s = resolveTop(cast(s0, 'Test Spiral'));
    s = answer(s, { kind: 'chooseObjects', ids: [] });
    expect(s.zones.hand.p1!.map((id) => nameOf(s, id)).sort()).toEqual(['Forest', 'Island']);
  });
});

describe('CR 118.9, 601.2b, 119.4: "If you control a Swamp, you may pay 4 life rather than pay this spell\'s mana cost."', () => {
  const SNUFF = card('Test Snuff', 'Instant', 'If you control a Swamp, you may pay 4 life rather than pay this spell\'s mana cost.\nDestroy target nonblack creature. It can\'t be regenerated.', '{3}{B}', undefined, ['B']);
  it('is full; with a Swamp and no other mana it is cast for 4 life and destroys the creature', () => {
    expect(SNUFF.automation.level).toBe('full');
    const s0 = scenario(['Swamp', 'Grizzly Bears'], { p1: { hand: ['Test Snuff'], battlefield: ['Swamp'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [SNUFF] });
    expect(castMethodsOffered(s0, find(s0, 'Test Snuff', 'hand', 'p1'))).toEqual(['alternative']);
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p2');
    let s = castWith(s0, 'Test Snuff', [target(bears)], 'alternative');
    expect(life(s, 'p1')).toBe(16);
    expect(s.objects[find(s0, 'Swamp', 'battlefield')]!.tapped).toBe(false);
    s = resolveTop(s);
    expect(findAll(s, 'Grizzly Bears', 'graveyard', 'p2')).toHaveLength(1);
  });
  it('CR 118.9: without a Swamp the alternative cost is not offered', () => {
    const s0 = scenario(['Island', 'Grizzly Bears'], { p1: { hand: ['Test Snuff'], battlefield: ['Island', 'Island', 'Island', 'Island'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [SNUFF] });
    expect(castMethodsOffered(s0, find(s0, 'Test Snuff', 'hand', 'p1'))).not.toContain('alternative');
  });
});

describe('CR 603.10a, 400.7, 110.2: "When enchanted creature dies, return it to the battlefield tapped under its owner\'s control."', () => {
  const FORTITUDE = card('Test Fortitude', 'Enchantment — Aura', 'Flash\nEnchant creature\nEnchanted creature gets +2/+0.\nWhen enchanted creature dies, return it to the battlefield tapped under its owner\'s control.', '{0}', undefined, ['G']);
  it('is full; the enchanted creature of the other player dies and returns tapped under its owner\'s control as a new object', () => {
    expect(FORTITUDE.automation.level).toBe('full');
    const s0 = scenario(['Grizzly Bears', 'Lightning Bolt', 'Mountain'], {
      p1: { hand: ['Test Fortitude', 'Lightning Bolt'], battlefield: ['Mountain'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [FORTITUDE],
    });
    const bears = find(s0, 'Grizzly Bears', 'battlefield', 'p2');
    let s = resolveTop(cast(s0, 'Test Fortitude', [target(bears)]));
    expect(s.objects[find(s, 'Test Fortitude', 'battlefield')]!.attachedTo).toBe(bears);
    s = resolveTop(cast(s, 'Lightning Bolt', [target(bears)]));
    expect(s.zones.stack).toHaveLength(1); // the dies trigger (CR 603.10a: it looks back at the aura's attachment)
    s = resolveTop(s);
    const back = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    expect(back).not.toBe(bears);
    expect(s.objects[back]!.tapped).toBe(true);
    expect(s.objects[back]!.controller).toBe('p2');
  });
});

describe('CR 701.28a, 603.2, 712.2: "When this creature transforms into <back face>, ..."', () => {
  const PARIAH = compileCard({
    name: 'Test Pariah // Test Abolisher', layout: 'transform', mana_cost: '{0}', type_line: 'Creature — Vampire // Creature — Vampire', colors: [],
    card_faces: [
      { name: 'Test Pariah', mana_cost: '{0}', type_line: 'Creature — Vampire', oracle_text: 'Sacrifice three other creatures: Transform this creature.', power: '1', toughness: '1', colors: [] },
      { name: 'Test Abolisher', mana_cost: '', type_line: 'Creature — Vampire', oracle_text: 'When this creature transforms into Test Abolisher, you gain 3 life.', power: '4', toughness: '3', colors: [] },
    ],
  } as unknown as OracleCard);
  it('is full; transforming it triggers the back face\'s ability once', () => {
    expect(PARIAH.automation.level).toBe('full');
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Test Pariah // Test Abolisher', 'Grizzly Bears', 'Grizzly Bears', 'Grizzly Bears'] }, defs: [PARIAH] });
    const pariah = find(s0, 'Test Pariah // Test Abolisher', 'battlefield');
    let s = activate(s0, pariah);
    s = drive(s, [{ kind: 'chooseObjects', ids: findAll(s, 'Grizzly Bears', 'battlefield') }]);
    expect(findAll(s, 'Grizzly Bears', 'graveyard', 'p1')).toHaveLength(3);
    s = resolveTop(s); // the transform resolves; the trigger goes on the stack
    expect(s.objects[pariah]!.face).toBe(1);
    expect(s.zones.stack).toHaveLength(1);
    s = resolveTop(s);
    expect(life(s, 'p1')).toBe(23);
    expect(s.zones.stack).toHaveLength(0);
  });
});

describe('CR 205.1b, 613.1d: "Target Forest becomes a 4/5 green Treefolk creature ... It\'s still a land."', () => {
  const DRUID = card('Test Druid', 'Creature — Human Druid', 'When this creature enters, target Forest becomes a 4/5 green Treefolk creature for as long as this creature remains on the battlefield. It\'s still a land.', '{0}', ['1', '1'], ['G']);
  it('is full; the Forest is a 4/5 Treefolk land creature that keeps its Forest subtype and mana ability, and only while the Druid stays', () => {
    expect(DRUID.automation.level).toBe('full');
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Druid'], battlefield: ['Forest'] }, defs: [DRUID] });
    const forest = find(s0, 'Forest', 'battlefield');
    let s = resolveTop(cast(s0, 'Test Druid'));
    s = resolveTop(drive(s, [target(forest)]));
    const c = getChars(s, forest)!;
    expect([String(c.power), String(c.toughness)]).toEqual(['4', '5']);
    expect(c.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Forest', 'Treefolk']));
    expect(legalActions(s, 'p1').some((a) => a.kind === 'activate' && a.isMana && a.object === forest)).toBe(true);
    // the Druid leaves: the effect ends (CR 611.2b)
    s = structuredClone(s);
    const druid = find(s, 'Test Druid', 'battlefield');
    s.zones.battlefield = s.zones.battlefield.filter((id) => id !== druid);
    s.zones.graveyard.p1!.push(druid);
    s.objects[druid]!.zone = 'graveyard';
    expect(getChars(s, forest)!.types).not.toContain('Creature');
  });
});
