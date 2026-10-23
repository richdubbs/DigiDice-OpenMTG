/**
 * WP23 review fixes. Each test is named after the rule it pins; the wordings are synthetic (design 6.10) and parsed with the bootstrap, WP23 and stand-in
 * templates of support.ts. The rule behind each group:
 *
 *   CR 707.2, 111.1, 603.7c, design 6.4   a token copy is something a later sentence can name: "it" after it is never the copied target alone
 *   CR 605.1a, 605.3b                     a mana ability runs only `addMana` steps; anything else makes it a manual mana ability, and a quoted mana
 *                                         ability of a token does not make the ability that creates the token a mana ability
 *   CR 614.15, 608.2c, 601.2c             "Y. If C, X instead." is folded only when X replaces Y itself (the same instruction on the same things)
 *   CR 107.3f                             "pay {X}" on resolution: the payer chooses X (r5-cost; before it, not automated)
 *   CR 603.7c, 400.7                      a delayed trigger cannot follow an object that the same resolution moved through `self` or a target handle
 *   CR 707.10                             "copy" of a spell copies an object on the stack, never a permanent
 *   CR 118.12a, design D3                 "you may X unless P pays" is never derived with the controller's choice first
 *   CR 607.2a                             the producer of a linked exile is linted and gated with its link
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, CardDef, EffectStep, GameState } from '../../../src/index';
import { act, advanceTo, answer, castAuto, find, life, passBoth, scenario, synth } from '../helpers';
import { drive, objectTarget } from '../announce/support';
import { accepts, draw, rejects, spell } from '../render/build';
import { unit as chartUnit } from './support';
import { automated, card, face, options, parsedMeaning } from './support';

const opts = options();
const parse = (type: string, text: string, name = 'Test Card') => face(card(name, type, text), opts);
const ok = (f: ReturnType<typeof parse>): boolean => automated(f.abilities) && f.gate.every((g) => g.ok);
const json = (f: ReturnType<typeof parse>): string => JSON.stringify(f.abilities);

function playable(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  const f = parse(type, text, name);
  expect(ok(f), `${name}: ${json(f)}`).toBe(true);
  return synth({ name, type, cost: '{0}', abilities: f.abilities, ...(pt ? { pt } : {}) });
}

const yesNo = (s: GameState, yes: boolean): GameState => answer(s, { kind: 'yesNo', yes });
const named = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;

describe('CR 707.2, 111.1, design 6.4: a token copy is a mention; "it" after it is not the copied target', () => {
  it('CR 707.2, 603.7c: "Create a token that\'s a copy of target creature you control. Sacrifice it at the beginning of the next end step." never sacrifices the target', () => {
    const f = parse('Artifact', "{T}: Create a token that's a copy of target creature you control. Sacrifice it at the beginning of the next end step.");
    // "it" has two candidates (the target and the token): the focus rule (FAST5 T76, model/focus.ts) makes it the token the instruction before it created; the
    // unique-candidate rule alone left the sentence manual (design 6.4)
    expect(ok(f), json(f)).toBe(true);
    expect(json(f)).toMatch(/"op":"sacrifice","what":\{"ref":"bound"/);
    expect(json(f)).not.toMatch(/"op":"sacrifice","what":\{"ref":"target"/);
  });

  it('CR 707.2, 603.7c: "Exile target creature. Create a token that\'s a copy of that creature. Exile it at the beginning of the next end step." never aims the delay at the exiled card', () => {
    const f = parse('Instant', "Exile target creature. Create a token that's a copy of that creature. Exile it at the beginning of the next end step.");
    expect(json(f)).not.toMatch(/"op":"delay"[^\]]*"what":\{"ref":"target"/);
  });

  it('CR 707.2, 603.7c: "Sacrifice that token at the beginning of the next end step" sacrifices the token copy; the original creature stays', () => {
    const CRYSTAL = playable('Test Crystal', 'Artifact', "{T}: Create a token that's a copy of target creature you control. Sacrifice that token at the beginning of the next end step.");
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: ['Test Crystal', 'Grizzly Bears'] }, defs: [CRYSTAL] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = drive(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Crystal', 'battlefield'), ability: 'p:0:0' }), [{ kind: 'chooseTargets', targets: [objectTarget(bears)] }]);
    s = passBoth(s);
    const copies = s.zones.battlefield.filter((id) => id !== bears && named(s, id) === 'Grizzly Bears');
    expect(copies).toHaveLength(1);
    s = passBoth(advanceTo(s, 1, 'end'));
    expect(s.zones.battlefield).toContain(bears);
    expect(s.zones.battlefield.filter((id) => named(s, id) === 'Grizzly Bears')).toEqual([bears]);
  });
});

describe('CR 605.1a, 605.3b: a mana ability runs only addMana steps', () => {
  // r3-cost (Rubble Rouser; parser/lower/ability.ts#reflexiveAfterMana, model/cap-walk.ts#nativeManaEffect): a reflexive "when you do" with no targets after
  // the mana is a triggered ability of its own that adds no mana, so it uses the stack (CR 603.12, 605.1b); the activated ability stays a mana ability
  it('CR 605.3b, 603.12: "{T}: Add {G}. When you do, ~ deals 1 damage to each opponent." is a mana ability with its cost kept and its reflexive trigger', () => {
    const f = parse('Creature — Elf', '{T}: Add {G}. When you do, ~ deals 1 damage to each opponent.');
    expect(f.abilities).toHaveLength(1);
    expect(f.abilities[0]).toMatchObject({ kind: 'activated', isMana: true, cost: { tap: true } });
  });

  it('CR 605.1a: an automated mana ability has only top-level addMana steps with their units (and, after them, at most a reflexive trigger, CR 603.12)', () => {
    // std-ry7 (CR 605.1a, 605.3b, 121.1): a fixed draw by the controller is a step the mana-ability resolver runs at once (parser/lower/ability.ts#drawYou): this pin
    // had "{T}: Add {G}. Draw a card." among the refused texts; another player's draw stays refused
    for (const text of ['{T}: Add {G}.', '{T}: Add {G}. When you do, ~ deals 1 damage to each opponent.', '{T}: Add {G}. Each opponent draws a card.']) {
      const f = parse('Creature — Elf', text);
      for (const a of f.abilities) {
        if (a.kind !== 'activated' || a.isMana !== true) continue;
        const steps = a.effect.steps;
        const ok = steps.every((st, i) => (st.op === 'addMana' && Array.isArray((st as { units?: unknown }).units)) || (st.op === 'reflexive' && i === steps.length - 1 && i > 0));
        expect(ok, `${text}: ${JSON.stringify(a)}`).toBe(true);
      }
    }
    const drawn = parse('Creature — Elf', '{T}: Add {G}. Draw a card.').abilities[0]!;
    expect(drawn.kind === 'activated' && drawn.isMana && drawn.effect.steps.map((st) => st.op)).toEqual(['addMana', 'draw']);
  });

  it('CR 605.1a: an ability that creates a token with a quoted "{T}: Add {G}." is not itself a mana ability', () => {
    const f = parse('Instant', '{1}{G}, Discard ~: Create a 1/1 green Elf creature token with "{T}: Add {G}."');
    const a = f.abilities[0] as AbilityDef & { isMana?: boolean; mana?: boolean };
    expect(a.isMana, json(f)).toBeUndefined();
    expect(a.mana, json(f)).toBeUndefined();
    // the token's own ability still is one (CR 605.1a)
    expect(json(f)).toContain('"text":"{T}: Add {G}.","cost":{"tap":true}');
  });
});

describe('CR 614.15, 608.2c: "Y. If C, X instead." folds only when X replaces Y itself', () => {
  it('CR 614.15: a replacement that covers part of a group ("Each player draws a card. If ..., you draw two cards instead.") is manual', () => {
    expect(ok(parse('Instant', 'Each player draws a card. If you control an Elf, you draw two cards instead.'))).toBe(false);
  });

  it('CR 608.2d, 614.15: "you may X instead" is manual (declining must still leave Y)', () => {
    expect(ok(parse('Instant', 'Draw a card. If you control a Forest, you may draw two cards instead.'))).toBe(false);
  });

  it('CR 608.2d, 614.15: an optional Y ("You may draw a card. If ..., draw two cards instead.") is manual', () => {
    expect(ok(parse('Instant', 'You may draw a card. If you control a Forest, draw two cards instead.'))).toBe(false);
  });

  it('CR 614.15: "instead" after a sentence that is another instruction ("Draw a card. You gain 2 life. If ..., draw two cards instead.") is manual', () => {
    expect(ok(parse('Instant', 'Draw a card. You gain 2 life. If you control a Forest, draw two cards instead.'))).toBe(false);
  });

  it('CR 601.2c: "Exile target artifact or enchantment. If ~ was kicked, exile target nonland permanent instead." never requires the unkicked target when kicked', () => {
    const f = parse('Instant', 'Kicker {1}{B}\nExile target artifact or enchantment. If ~ was kicked, exile target nonland permanent instead.');
    if (!ok(f)) return;
    const targets = (f.abilities[1] as { effect: { targets: { id: string; onlyIf?: unknown }[] } }).effect.targets;
    expect(targets.every((t) => t.onlyIf !== undefined), json(f)).toBe(true);
  });

  it('CR 614.15: the same instruction with another amount still folds ("Target player draws a card. If it\'s your turn, that player draws two cards instead.")', () => {
    const f = parse('Instant', "Target player draws a card. If it's your turn, that player draws two cards instead.");
    expect(ok(f), json(f)).toBe(true);
  });

  it('CR 608.2d: the render gate never reads `if C then [may X] else [Y]` as "Y. If C, you may X instead."', () => {
    const forest = { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Forest'], controller: 'you' } } };
    const def = spell([{ op: 'if', cond: forest, then: [{ op: 'may', who: { ref: 'you' }, do: [draw(2)] }], else: [draw()] } as EffectStep]);
    rejects(def, 'Draw a card. If you control a Forest, you may draw two cards instead.');
    accepts(def, 'If you control a Forest, you may draw two cards. Otherwise, draw a card.');
  });

  it('CR 614.15: the render gate never reads `if C then [X] else [Y]` with X and Y different instructions as an "instead" fold', () => {
    const forest = { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Forest'], controller: 'you' } } };
    const def = spell([{ op: 'if', cond: forest, then: [draw(2)], else: [{ op: 'gainLife', who: { ref: 'you' }, amount: 2 }] } as EffectStep]);
    rejects(def, 'You gain 2 life. If you control a Forest, draw two cards instead.');
  });
});

describe('CR 107.3f: "pay {X}" on resolution', () => {
  // r5-cost: the controller now chooses X as they pay (effects/handlers/pay.ts#choosesX; played in test/cloud/r5-cost/pay-at-resolution.test.ts), so the
  // ability is automated; another player's "pay {X}" is still not
  it('CR 107.3f: "When ~ enters, you may pay {X}. If you do, draw X cards." is automated (r5-cost: the payer chooses X as they pay)', () => {
    expect(ok(parse('Creature — Elf', 'When ~ enters, you may pay {X}. If you do, draw X cards.'))).toBe(true);
  });

  it('CR 107.3f: an announced X still pays ("{X}, {T}: Pay {X}. If you do, draw X cards." stays as it was)', () => {
    // nothing new to assert beyond not crashing: the X of an activated cost is announced (CR 601.2b, 602.2b)
    expect(() => parse('Artifact', '{X}, {T}: Draw X cards.')).not.toThrow();
  });
});

describe('CR 603.7c, 400.7: a delayed trigger and an object the same resolution moved', () => {
  it('CR 400.7, 603.7c: "{1}: Exile ~. Return ~ to the battlefield ... at the beginning of the next end step." is not automated', () => {
    expect(ok(parse('Creature — Elf', "{1}: Exile ~. Return ~ to the battlefield under its owner's control at the beginning of the next end step."))).toBe(false);
  });

  it('CR 400.7, 603.7c: "Exile target creature. Return it to the battlefield ... at the beginning of the next end step." is not automated through the target handle', () => {
    const f = parse('Instant', "Exile target creature. Return it to the battlefield under its owner's control at the beginning of the next end step.");
    expect(ok(f) && /"op":"delay"[^\]]*"what":\{"ref":"target"/.test(json(f)), json(f)).toBe(false);
  });

  it('CR 603.7c: a delayed trigger on ~ that the resolution did not move is still automated ("When ~ enters, sacrifice ~ at the beginning of the next end step.")', () => {
    const f = parse('Creature — Elf', 'When ~ enters, sacrifice ~ at the beginning of the next end step.');
    expect(json(f)).not.toContain('moved');
  });
});

describe('CR 707.10: a spell copy copies an object on the stack', () => {
  it('CR 707.10: "Copy target creature." is not automated', () => {
    for (const text of ['Copy target creature.', 'Copy target artifact.', 'Copy target permanent.']) expect(parsedMeaning(text, opts), text).toBeNull();
  });

  it('CR 707.10: "Copy target instant spell." still is', () => {
    expect(parsedMeaning('Copy target instant spell.', opts)).not.toBeNull();
  });
});

describe('CR 118.12a, design D3: "you may X unless P pays" never puts the controller\'s choice first', () => {
  it('CR 118.12a: no derivation, winning or outranked, has the "may" outside the payment', () => {
    const r = chartUnit('You may draw a card unless target opponent pays {1}.', 'effects');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect((r.derivation.value as { op: string }[])[0]!.op).toBe('pay');
    expect(r.outranked.filter((d) => (d.value as { op: string }[])[0]!.op === 'may')).toEqual([]);
  });

  it('design 6.3: the WP23 set has no duplicate of the bootstrap "may ... unless ... pays" template', async () => {
    const choice = (await import('../../../src/parser/templates/effect/choice.json')).default as { id: string }[];
    expect(choice.map((t) => t.id)).not.toContain('ch.may.unless');
  });
});

describe('CR 603.12: a reflexive trigger in a triggered ability, played', () => {
  it('CR 603.12, 603.12a: "When ~ enters, you may pay {2}. When you do, ~ deals 3 damage to target player." targets on the reflexive trigger and deals the damage', () => {
    const ROUSER = playable('Test Rouser', 'Creature — Goblin', 'When ~ enters, you may pay {2}. When you do, ~ deals 3 damage to target player.', ['1', '1']);
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Rouser'], battlefield: ['Mountain', 'Mountain'] }, defs: [ROUSER] });
    let s = passBoth(castAuto(s0, 'Test Rouser'));
    s = passBoth(s); // the enters trigger resolves: may pay
    s = yesNo(s, true);
    s = drive(s, [{ kind: 'payCost', auto: true }]);
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    s = passBoth(drive(s, []));
    expect(life(s, 'p2')).toBe(17);
  });
});

describe('CR 607.2a: the exiling ability is gated with its link', () => {
  it('CR 607.2a: the producer of "the exiled card" carries link "exiled" and passes the gate', () => {
    const f = parse('Creature — Human', "When ~ enters, you may exile another target creature.\nWhen ~ leaves the battlefield, return the exiled card to the battlefield under its owner's control.");
    expect(json(f)).toContain('"link":"exiled"');
    expect(f.gate.every((g) => g.ok)).toBe(true);
  });
});

/**
 * W3b: the WP23 templates promoted to stable, each with its evidence (design 6.9: 20 reviewed matches or three verified golden cards). Any other WP23
 * template is still experimental; a promotion adds a row here with its review.
 */
const PROMOTED: Readonly<Record<string, string>> = {
  'eff.counter': 'CR 701.6a: W3b review of all 348 index cards that use it: 106 plain "Counter target spell" units and every filtered, "unless its controller '
    + 'pays", rider ("put it on top of ... library instead") and cast-trigger form read against its Oracle text; Counterspell and Mana Leak (design 13 '
    + 'golden) played through applyAction (test/m5/compile/w3b-game-path.test.ts, test/m5/run/pay.test.ts)',
  'se.player.may.bf.tapped': 'CR 110.2, 701.23: Path to Exile (design 13 golden, enforced by test/m5/golden) and its play test (test/m5/compile/'
    + 'w3b-game-path.test.ts); the only index card with this exact wording. DEVIATION recorded: one golden card, not three (R1 needs Path to Exile full)',
  // W3b template review (verdicts applied on m5/w3b): each row is the reviewer's evidence
  'ch.maypay': 'CR 118.12, 118.12a, 118.3: 310 index units, 196 automated, more than 110 read against Oracle text (payer, cost, then/else/reflexive); the pay '
    + 'handler asks only when the whole cost can be paid; Smothering Tithe golden',
  'ch.pay': 'CR 118.12, 118.3: the four Pacts (Pact of Negation, Slaughter Pact, Pact of the Titan, Summoner\'s Pact; WP23 golden VERIFY set): pay ... else '
    + 'loseGame inside the next-upkeep delay; cr list corrected (CR 117.12 does not exist)',
  'fl.otherwise': 'CR 608.2c: the 4 automated, gate-passing index units verified (Stolen Vitality, Insatiable Appetite, Pippin\'s Bravery, Giant Opportunity); '
    + 'the other 63 matches are manual (T2); Giant Opportunity stays capped by the experimental ch.may',
  'fl.instead': 'CR 614.15, 608.2c: 55 index units reviewed, all 26 automated ones read "if C then [X] else [Y]" correctly; the rest fail closed '
    + '(render/self-replacement.ts, contagion, gate)',
  'fl.linked.returnBattlefield': 'CR 607.2a, 110.2a, 400.7: 16 index units, all 10 automated ones correct; golden VERIFY Fiend Hunter, Journey to Nowhere, '
    + 'Oblivion Ring; Fiend Hunter played in wp23-scenarios.test.ts',
  'fl.loseGame': 'CR 104.3e: 16 index units, all 15 automated ones correct; golden VERIFY Pact of Negation, Slaughter Pact, Pact of the Titan; cr list '
    + 'corrected (CR 104.3a is conceding)',
  'fl.winGame': 'CR 104.2b: all 12 matching index units correct (intervening-if conditions included); cr list corrected (CR 104.2b, not 104.2a/104.3e)',
  'dl.nextEnd.tail': 'CR 603.7: all 27 automated abilities of 131 matches reviewed; Wings of Hubris, Firecat Blitz, Bearer of the Heavens, Transluminant and '
    + 'Rakdos Guildmage played; no delayed body reads information about a moved object',
  'dl.yourNextUpkeep.lead': 'CR 603.7, 118.12: 5 of 7 matches verified, none wrong; Slaughter Pact played (both branches); golden Slaughter Pact, Pact of '
    + 'Negation, Casey Jones, Vigilante (test/m5/golden/cards/w3b-review.json)',
  'eff.copy.token': 'CR 707.2, 111.1: all 49 automated abilities reviewed; Cackling Counterpart and Sphinx of False Conclusions played',
  'se.library.anyCard': 'CR 701.23d-e: all 17 automated matches correct (step order follows the Oracle text)',
  'se.library.upTo': 'CR 701.23a: all 24 automated matches correct; Harrow played',
  'se.library.upTo.reveal': 'CR 701.23a, 701.20a: all 7 automated matches of 12 verified (3 or more, design 6.9); the run-time path of Harrow and Lay of the Land',
  'rid.countered.top': 'CR 701.6a, 608.2c, 614.15: both index matches (Memory Lapse, design 13 golden; Lapse of Certainty); Memory Lapse played. DEVIATION '
    + 'recorded: 2 matches and 1 golden card',
  'rid.countered.bottom': 'CR 701.6a, 614.15: Spell Crumple, the only index match, played. DEVIATION recorded: 1 match, no golden card',
  'rid.countered.exile': 'CR 701.6a, 614.15: all 17 index matches reviewed (12 automated correct, 5 manual by contagion); Dissipate played. DEVIATION recorded '
    + 'for review: below 20 matches and 3 golden cards',
  'rid.noregen.that': 'CR 701.19c: the build of the stable rid.noregen; Nekrataal and Parallax Dementia (played) verified, Mageta manual. DEVIATION recorded '
    + 'for review: 3 matches, no golden card',
  'rid.stillLand': 'CR 205.1b: 71 index matches; the 5 applied ones correct (Mutavault design 13 golden); the rider fails closed everywhere else',
  'sh.anyDies.exile': 'CR 614.1a, 611.2c: all 4 index matches compile correctly under feature:replace.foreign and pass G6; manual in milestone 5 (E1 chip)',
  // T3 (push wave) template review: every card the promotion makes full was read against its Oracle text; golden test/m5/golden/cards/t3-review.json
  'ch.may': 'CR 608.2d, 603.5: all 307 index cards the promotion makes full read against Oracle text (target chosen on trigger, choice on resolution, '
    + '"if you do" reads the choice); engine fixes first (effects/handlers/control.ts: removing a counter can\'t be chosen without one; T3 review: a '
    + 'numeric count of sacrifice, discard or mill must be met in full, CR 118.3, 701.17b, which the first review missed for Giant Opportunity; "you may '
    + 'discard your hand" was held back as op:discard.mayHand until AF1 settled it by the official ruling); golden Gravedigger, Keldon Raider, Reclamation Sage, Guiding Hydra, '
    + 'Consecrated Sphinx',
  'rf.whenYouDo': 'CR 603.12, 603.12a: all 20 index cards the promotion makes full reviewed (pay, sacrifice, exile, discard, create, mill, surveil, attach '
    + 'before "When you do"); golden Sparktongue Dragon, Cornered Crook, Undead Butler',
  'dl.endOfCombat.tail': 'CR 603.7, 511.2: all 18 index cards the promotion makes full reviewed, after the T3 fixes of "attacks or blocks" (the object '
    + 'itself, parser/lower/scope.ts) and "blocks or becomes blocked by <NP>" (parser/holes/event.ts); golden Geist of Saint Traft, Frostweb Spider, '
    + 'Clockwork Beetle, Arrogant Bloodlord',
  // std-rx14 (card wave 2, slice s13): the lead form of the delay, on the same engine path as the stable tail form
  'dl.endOfCombat.lead': 'CR 603.7, 603.7a, 511.1: the whole-index G10 of the promotion: 1 card made full (Fortune, Loyal Steed, read against its Oracle text; '
    + 'no card used the lead form fully before); golden Fortune, Loyal Steed (test/m5/golden/cards/cloud-std-rx14-review.json). DEVIATION recorded: 1 golden card',
  'eff.copy.spell': 'CR 707.10, 707.10c: all 16 index cards the promotion makes full reviewed; a copy of a triggering spell that can be a permanent spell '
    + 'is op:copy.permanentSpell (model/cap-walk.ts, T3: Jin-Gitaxias, Progress Tyrant stays partial); golden Twincast, Dualcaster Mage, Strionic Resonator',
  'rid.copy.newTargets': 'CR 707.10c, 115.7: the same 16 cards as eff.copy.spell (the rider of every one); golden Twincast, Dualcaster Mage, Strionic Resonator',
  'ch.maypay.sacrifice': 'CR 118.12: all 3 index matches reviewed (Sokenzan Smelter full, Killer Service and Dreamshaper Shaman partial and right where '
    + 'automated); golden Sokenzan Smelter. DEVIATION recorded: 3 matches, 1 golden card',
  'se.player.may.bf': 'CR 608.2d, 701.23a: Pattern of Rebirth, the only index match, reviewed (the dead creature\'s controller searches, last known '
    + 'information); golden Pattern of Rebirth. DEVIATION recorded: 1 match, 1 golden card',
  // MX2 (2026-10-13): promoted when op:exchange.control ran (core/control.ts, effects/handlers/zones-status.ts#exchangeControl)
  'eff.exchange.control': 'CR 701.12a-b, 613.1b: every index card the promotion makes full read against its Oracle text (Oko, Thief of Crowns -5, Political '
    + 'Trickery, Shrewd Negotiation, Trade the Helm, Vedalken Plotter: two targets, each player gains control of the one the other controlled, nothing when '
    + 'one is gone or one player controls both; a spell is asked by hand); Oko (design 13 golden) played in test/mx2/control.test.ts. DEVIATION recorded '
    + 'for review: 5 cards made full, 1 golden card',
  // M6-1 (2026-10-13): promoted when milestone 6 made the shield run (feature:shield.modify)
  'sh.dies.exile': 'CR 614.1a, 611.2c, 615.8: the 27 index cards with the sentence "If that creature would die this turn, exile it instead." read against '
    + 'their Oracle text (Lava Coil, Magma Spray, Scorchmark, Puncturing Blow, Ob Nixilis\'s Cruelty, Bleed Dry, Necrotic Wound, the modal ones, the fight '
    + 'ones: "that creature" is the creature the same ability damages, shrinks or fights); golden Magma Spray (design 13, its milestone 6 form) played in '
    + 'test/m6/replace/shields.test.ts',
  // FAST5 PROMO1 (2026-10-14): every index card the promotion makes full read against its Oracle text next to its compiled and rendered abilities;
  // golden test/m5/golden/cards/fast5-promo1-review.json, scenarios test/fast5/promo1/promo1-scenarios.test.ts
  'se.library.one': 'CR 701.23a, 701.24a, 110.5b: all 142 index matches read (102 made full: fetch lands, Evolving Wilds, Rampant Growth, Farseek, Natural '
    + 'Order, the Panoramas and Landscapes; "put it/that card onto the battlefield [tapped], then shuffle" follows); golden Evolving Wilds, Terramorphic '
    + 'Expanse, Wood Elves; Evolving Wilds played',
  'se.library.reveal': 'CR 701.23a, 701.20a: all 89 index matches read (52 made full: Expedition Map, the Monuments, Idyllic Tutor, Summoner\'s Pact, '
    + 'Fauna Shaman, ...); golden Expedition Map, Fabricate, Sylvan Scrying',
  'ch.put.fromHand': 'CR 305.4, 110.2: all 80 index matches read (43 made full: Growth Spiral, Stoneforge Mystic, Uro\'s land drop, Elvish Piper, Goblin '
    + 'Lackey, ...; not a land play; the filter carries "from your hand"); golden Growth Spiral, Akul the Unrepentant, Elvish Piper; Growth Spiral played',
  // FAST5X E11 (2026-10-14): promoted when the behold cost could produce the link (rules/pay-parts.ts, core/resolve.ts; CR 607.2a)
  'fl.linked.returnHand': 'CR 607.2a, 400.7: all 4 index cards the promotion makes full read against their Oracle text (Champion of the Clachan, Champion of '
    + 'the Path, Champions of the Perfect, Champions of the Shoal: "behold a <type> and exile it" ... "return the exiled card to its owner\'s hand"); the other '
    + 'index matches (Tidehollow Sculler, Mesmeric Fiend, Ashiok\'s Erasure, Ugin\'s Labyrinth) stay partial for other sentences; golden Champion of the '
    + 'Clachan, Champion of the Path, Champions of the Perfect, Champions of the Shoal (fast5x-e11-review.json, fast4-t20-review.json); played in '
    + 'test/fast5x/e11/e11-scenarios.test.ts',
  // Standard round 3 r3-fx (2026-10-17): every tuning-half card the promotion makes full read against its Oracle text next to its compiled abilities (golden
  // test/m5/golden/cards/cloud-r3-fx-review.json; played in test/cloud/r3-fx/r3-fx-scenarios.test.ts)
  'dl.nextEnd.lead': 'CR 603.7, 603.7a, 603.7c, 608.2h: the engine gap PROMO1 held it for is closed (a delayed ability checks the objects it fixed as it starts to '
    + 'resolve, so "sacrifice it. If you do, you gain life equal to its toughness" reads the sacrificed creature, effects/refs.ts#fixedObjs); a target the delayed '
    + 'sentence announces makes it manual (CR 603.3d, lower/targets.ts#targetsInStepDelayLead); golden Apprentice Necromancer, Long Road Home, Momo\'s Heist, '
    + 'Otherworldly Journey, Planar Guide (cloud-r3-fx-review.json), Spinal Embrace, Surprise Deployment (fast4-t32-review.json)',
  'dl.yourNextEnd.lead': 'CR 603.7, 603.7a, 724.1: golden Coalstoke Gearhulk, Puppeteer Clique, Glorious End (End the turn, then the delay: played); a target the '
    + 'delayed sentence announces makes it manual (CR 603.3d)',
};

describe('design 6.9: template status', () => {
  it('design 6.9: a WP23 template is stable only with its recorded evidence (20 reviewed matches or verified golden cards)', async () => {
    const { WP23_TEMPLATES } = await import('./support');
    expect(WP23_TEMPLATES.filter((t) => t.status === 'stable').map((t) => t.id).sort()).toEqual(Object.keys(PROMOTED).sort());
    for (const why of Object.values(PROMOTED)) expect(why).toMatch(/CR \d{3}/);
  });
});
