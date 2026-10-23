/**
 * WP19 review fixes. Each block is named after the rule it pins. Card wordings are synthetic (invented names and numbers, design 6.10); the real cards the
 * review listed are pinned by name on the local index in wp19-corpus.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, EventPattern, GameEvent, ManualAbilityDef, ObjectId, SemEvent, TriggeredAbilityDef } from '../../../src/index';
import { matchEvent } from '../../../src/triggers/match';
import { moveObject } from '../../../src/core/zones';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { batchesOf, find, gameOf, scenario } from '../triggers/helpers';
import { vanilla } from '../triggers/cards';
import { card, face, options, WP19_TEMPLATES } from './support';

const opts = options();
const abilitiesOf = (typeLine: string, text: string): AbilityDef[] => face(card('Review Wisp', typeLine, text), opts).abilities;
const only = (typeLine: string, text: string): AbilityDef => {
  const a = abilitiesOf(typeLine, text);
  expect(a).toHaveLength(1);
  return a[0]!;
};
const steps = (a: AbilityDef): { op: string }[] => ((a as { effect?: { steps: { op: string }[] } }).effect?.steps ?? []);
const ids = new Set(WP19_TEMPLATES.map((t) => t.id));

describe('CR 118.12, 608.2c, design 6.7 T1: "If you do" after a sentence that is not understood poisons only itself', () => {
  it('a spell keeps its automated damage step; the optional sentence and its "if you do" are manual steps in place (no T2 contagion)', () => {
    const a = only('Instant', '~ deals 4 damage to any target. You may discard a card. If you do, draw a card.');
    expect(a.kind).toBe('spell');
    expect(steps(a).map((s) => s.op)).toEqual(['damage', 'manual', 'manual']);
  });

  it('a triggered ability keeps its automated trigger (it fires on its own) when "if you do" follows a sentence that is not understood', () => {
    const a = only('Creature — Devil', 'When ~ enters, you may pay {2}. If you do, target creature gets +2/+0 until end of turn.');
    expect(a.kind).toBe('triggered');
    expect((a as TriggeredAbilityDef).trigger.on).toEqual([{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }]);
    expect(steps(a).every((s) => s.op === 'manual')).toBe(true);
  });

  it('a loyalty ability (CR 606) stays a loyalty ability', () => {
    const a = only('Legendary Planeswalker — Test', '−1: You may sacrifice an artifact. If you do, destroy target artifact or creature.');
    expect(a.kind).toBe('activated');
    expect((a as { isLoyalty?: boolean }).isLoyalty).toBe(true);
  });
});

describe('design 6.6, 6.8 G6/G10: a reading the renderer cannot print back never takes away what was automated without it', () => {
  it('CR 606, 611.2a: "+1: Until your next turn, up to one target creature gets -2/-0." stays a loyalty ability with a manual effect', () => {
    const a = only('Legendary Planeswalker — Test', '+1: Until your next turn, up to one target creature gets -2/-0.');
    expect(a.kind).toBe('activated');
    expect((a as { isLoyalty?: boolean }).isLoyalty).toBe(true);
    expect(steps(a).every((s) => s.op === 'manual')).toBe(true);
  });

  it('CR 602.1, 611.2a, 113.6: a lead-in duration over a quoted grant is printed back (FAST5 T41: the period inside the closing quote ends the sentence), so the activated ability is automated whole', () => {
    // before FAST5 T41 the renderer closed this sentence with a second period after the quote, the gate refused it and the activated ability kept a manual effect
    const a = only('Artifact', '{2}{R}: Until end of turn, creatures you control gain "{T}: This creature deals 1 damage to any target."');
    expect(a.kind).toBe('activated');
    expect((a as { cost?: { mana?: unknown } }).cost?.mana).toBeDefined();
    expect(steps(a).map((s) => s.op)).toEqual(['effect']);
  });

  it('CR 714.2: a chapter whose effect the gate refuses is still a chapter ability', () => {
    const c = card('Review Saga', 'Enchantment — Saga', '(As this Saga enters and after your draw step, add a lore counter.)\nI — Draw a card.\nII — If you have one or fewer cards in hand, draw three cards. Otherwise, scry 2, then draw a card.\nIII — Draw a card.');
    const f = face(c, opts);
    const two = f.abilities.find((x) => x.kind === 'chapter' && (x as { chapters: number[] }).chapters.includes(2));
    expect(two, JSON.stringify(f.abilities.map((x) => [x.kind, (x as ManualAbilityDef).reason]))).toBeDefined();
  });

  it('CR 603.1: a trigger clause the gate refuses leaves the manual triggered ability that keeps its understood effect ("Trigger now", design 6.6)', () => {
    // a trigger clause the gate refuses: "another nontoken creature is put into an opponent's graveyard from the battlefield" (std-rp: "another creature is put
    // into your graveyard from the battlefield", the example before, prints: an object you own goes to your graveyard, CR 400.3; cmd4: "an opponent cycles a card", the example
    // before, now prints: a cycled card is a card in a hand, CR 702.29a; cloud std-lci: "an opponent discards a land card", the one before that, prints: the
    // discarded card is a card in a hand, CR 701.9a; FAST5X E17: "At the beginning of your second main phase" prints: the second main phase is the main phase
    // numbered 2 in its turn, CR 505.1b; FAST1 T4's "deals combat damage to a player or planeswalker" prints too)
    const a = only('Creature — Frog', "Whenever another nontoken creature is put into an opponent's graveyard from the battlefield, draw a card.");
    expect(a.kind).toBe('manual');
    expect((a as ManualAbilityDef).shape).toBe('triggered');
    expect((a as ManualAbilityDef).effect?.steps).toEqual([{ op: 'draw', who: { ref: 'you' }, count: 1 }]);
  });

  it('CR 605.3b: a mana ability is never given the "effect as one manual step" fallback (it cannot ask); the gate still refuses it whole', () => {
    // a mana ability with a lead-in "if" the renderer prints differently ("the number of cards from your hand is 2 or less"): refused, it stays a manual ability
    // that keeps `mana` (cloud std-lci: "{T}: If you have one or fewer cards in hand, add {G}.", the example before, prints and is a conditional mana ability the
    // mana path runs, CR 605.3b; r3-fx: "... in your hand" prints as well now, family hand-size-your-hand, so this example says "there are")
    const a = only('Artifact', '{T}: If there are two or fewer cards in your hand, add {G}.');
    expect(a.kind).toBe('manual');
    expect((a as ManualAbilityDef).mana).toBe(true);
  });

  it('dur.lead.pump is withdrawn (no corpus use passes the gate)', () => {
    expect(ids.has('dur.lead.pump')).toBe(false);
  });
});

describe('CR 701.43a, design 6.9 G9: cost.exert (stable since the W3b template review) is recorded in templatesUsed', () => {
  it('"Exert ~" in a cost is recorded in templatesUsed and no longer experimental', () => {
    const f = face(card('Review Totem', 'Artifact Creature — Golem', '{T}, Exert ~: Draw a card.'), opts);
    expect(f.templatesUsed).toContain('cost.exert');
    expect(f.experimental).not.toContain('cost.exert');
  });
});

describe('design 6.9 step 1: templates come from the unmatched queue', () => {
  it('trg.selfOrAnother.attacks (no Oracle line reads "~ or another ... attacks") is withdrawn', () => {
    expect(ids.has('trg.selfOrAnother.attacks')).toBe(false);
  });
});

describe('CR 113.6k, 113.6m: a trigger that cannot fire from the battlefield is never an automated battlefield trigger', () => {
  const manualIn = (text: string, zone: string): void => {
    const a = only('Creature — Spirit', text);
    expect(a.kind, text).toBe('manual');
    expect((a as ManualAbilityDef).shape).toBe('triggered');
    expect((a as ManualAbilityDef).zone, text).toEqual([zone]);
  };
  it('CR 113.6k: "When ~ is put into a graveyard from anywhere" is a manual trigger that functions in the graveyard; its effect is kept', () => {
    manualIn('When ~ is put into a graveyard from anywhere, each player draws a card.', 'graveyard');
    const a = only('Creature — Spirit', 'When ~ is put into a graveyard from anywhere, each player draws a card.') as ManualAbilityDef;
    expect(a.effect?.steps).toEqual([{ op: 'draw', who: { ref: 'each', who: 'player' }, count: 1 }]);
  });
  it('CR 113.6k: "When ~ is exiled" is a manual trigger that functions in exile', () => {
    manualIn('When ~ is exiled, draw a card.', 'exile');
  });
  it('CR 113.6m: an effect that returns ~ from your graveyard makes the ability function only in the graveyard (Landfall-style trigger)', () => {
    manualIn('Whenever a land you control enters, you may return ~ from your graveyard to the battlefield.', 'graveyard');
  });
  it('CR 113.6m: an upkeep trigger that returns ~ from your graveyard to your hand', () => {
    manualIn('At the beginning of your upkeep, you may return ~ from your graveyard to your hand.', 'graveyard');
  });
  it('CR 113.6m: an instant whose trigger returns it from the graveyard', () => {
    const f = face(card('Review Fire', 'Instant', '~ deals 2 damage to any target.\nWhenever an opponent gains life, you may pay {R}. If you do, return ~ from your graveyard to your hand.'), opts);
    const t = f.abilities[1]!;
    expect(t.kind).toBe('manual');
    expect((t as ManualAbilityDef).zone).toEqual(['graveyard']);
  });
  it('CR 702.29c: "When you cycle ~" triggers from the zone the card winds up in (the graveyard)', () => {
    manualIn('When you cycle ~, return it to your hand.', 'graveyard'); // names the card itself: still manual (FAST5 T37 automates the ones that do not)
    manualIn('When you cycle ~, if you control a creature, draw a card.', 'graveyard'); // an intervening "if": still manual
  });
  it('FAST5 T37, CR 702.29d: "When you cycle ~, draw a card" is an automated trigger that functions in the graveyard', () => {
    const a = only('Creature — Spirit', 'When you cycle ~, draw a card.');
    expect(a.kind).toBe('triggered');
    expect((a as { zone?: string[] }).zone).toEqual(['graveyard']);
  });
  it('CR 113.6m: "This ability also triggers if ~ is in your graveyard" functions on the battlefield and in the graveyard', () => {
    const a = only('Creature — Spirit', 'Whenever another creature dies, put a +1/+1 counter on ~. This ability also triggers if ~ is in your graveyard.') as ManualAbilityDef;
    expect(a.kind).toBe('manual');
    expect(a.zone).toEqual(['battlefield', 'graveyard']);
  });
  it('CR 113.6m exceptions: an Aura returning itself when the enchanted creature leaves, and an earlier part of the effect that exiles ~, keep the battlefield', () => {
    const aura = face(card('Review Plague', 'Enchantment — Aura', 'Enchant creature\nWhen enchanted creature dies, return ~ from its owner\'s graveyard to the battlefield.'), opts).abilities[1]!;
    expect(aura.kind).toBe('triggered');
    const back = only('Creature — Spirit', 'When ~ dies, exile it. At the beginning of the next end step, return ~ from exile to the battlefield.');
    expect(back.kind).toBe('triggered');
  });
  it('CR 113.6: words inside a granted (quoted) ability are about the object that gets it, not about this one', () => {
    const a = only('Creature — Spirit', 'When ~ enters, target creature you control gains "When this creature dies, return ~ from your graveyard to your hand." until end of turn.');
    expect(a.kind).toBe('triggered');
  });
  it('controls: dies and enters triggers (they can fire from the battlefield; CR 603.6a, 603.10a) stay automated, also with "return it" (CR 113.6m exception)', () => {
    expect(only('Creature — Spirit', 'When ~ dies, draw a card.').kind).toBe('triggered');
    expect(only('Creature — Spirit', 'When ~ enters, draw a card.').kind).toBe('triggered');
    const back = only('Creature — Spirit', 'When ~ dies, return it to its owner\'s hand.');
    expect(back.kind).toBe('triggered');
    expect((back as TriggeredAbilityDef).zone).toBeUndefined();
  });
});

describe('CR 506.3, 508.1b: a creature attacking a planeswalker or battle is not attacking its controller', () => {
  const s0 = scenario(['Plains'], { defs: [vanilla(), vanilla('Test Other', ['3', '3'])], p1: { battlefield: ['Test Vanilla'] }, p2: { battlefield: ['Test Other', 'Plains'] } });
  const mine = find(s0, 'Test Vanilla', 'battlefield');
  const theirPermanent = find(s0, 'Plains', 'battlefield', 'p2');
  const run = (p: EventPattern, defender: string, controller = 'p1'): boolean => {
    const g = gameOf(s0);
    const e: GameEvent = { type: 'attackersDeclared', attackers: [{ attacker: mine, defender: defender as ObjectId }] };
    g.emit(e);
    const sems: SemEvent[] = batchesOf(g).flat();
    return sems.some((x) => matchEvent(p, x, { g, source: mine, controller, lookBack: false }));
  };
  it('"attacks a player" / "attacks an opponent" do not match an attack on a permanent; they match an attack on the player', () => {
    expect(run({ ev: 'attacks', attacker: { self: true }, defender: 'any' }, theirPermanent)).toBe(false);
    expect(run({ ev: 'attacks', attacker: { self: true }, defender: 'opponent' }, theirPermanent)).toBe(false);
    expect(run({ ev: 'attacks', attacker: { self: true }, defender: 'any' }, 'p2')).toBe(true);
    expect(run({ ev: 'attacks', attacker: { self: true }, defender: 'opponent' }, 'p2')).toBe(true);
  });
  it('"attacks you" does not match an attack on a permanent you control', () => {
    expect(run({ ev: 'attacks', attacker: { types: ['Creature'] }, defender: 'you' }, theirPermanent, 'p2')).toBe(false);
    expect(run({ ev: 'attacks', attacker: { types: ['Creature'] }, defender: 'you' }, 'p2', 'p2')).toBe(true);
  });
});

describe('CR 109.2: a type or "permanent" without "card" or "spell" is a permanent on the battlefield', () => {
  it('trg.you.activate.of is withdrawn: "Whenever you activate an ability of a creature that isn\'t a mana ability" is not an automated trigger', () => {
    expect(ids.has('trg.you.activate.of')).toBe(false);
    const a = only('Artifact Creature — Construct', 'Whenever you activate an ability of an artifact or creature that isn\'t a mana ability, ~ gets +1/+1 until end of turn.');
    expect(a.kind).toBe('manual');
  });
  it('"Whenever a permanent deals damage to you" is not an automated trigger (its source filter would also match a spell)', () => {
    const a = only('Enchantment', 'Whenever a permanent deals damage to you, draw a card.');
    expect(a.kind).toBe('manual');
  });
});

/**
 * ACCEPTED APPROXIMATION (WP19 review, finding on trg.selfOrAnother.*): "~ or another X" is built as ONE pattern on X, as the design's Blood Artist JSON
 * (13.3) is, because the renderer prints only that form. The exact reading is [{self}, {X, other}] (CR 700.4: "~" is the object whatever its types). The
 * merged pattern includes ~ only while ~ is an X at the event, so it can MISS a trigger (a ~ that is not an X when it dies, e.g. under a type-changing
 * effect); it never adds one. To lift: have the renderer print [{self},{...X, other}] as "~ or another X" and build that form (WP2 + design 13.3).
 */
describe('CR 603.10a, 700.4, design 13.3: "~ or another X" is read as one pattern on X (accepted approximation)', () => {
  it('the merged pattern needs ~ to be an X when the event happens: a ~ that is not a creature when it dies does not trigger it (known gap)', () => {
    const a = only('Creature — Vampire', 'Whenever ~ or another creature dies, draw a card.') as TriggeredAbilityDef;
    const pattern = a.trigger.on[0]!;
    expect(a.trigger.on).toEqual([{ ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' }]);
    // the watcher is a noncreature permanent (a land standing in for a ~ whose types were changed) and it is the object that dies
    const s0 = scenario(['Plains'], { defs: [vanilla()], p1: { battlefield: ['Plains', 'Test Vanilla'] } });
    const self = find(s0, 'Plains', 'battlefield');
    const g = gameOf(s0);
    moveObject(g, self, 'graveyard');
    const sems: SemEvent[] = batchesOf(g).flat();
    expect(sems.some((e) => matchEvent(pattern, e, { g, source: self, controller: 'p1', lookBack: false }))).toBe(false);
  });
});

describe('the review fixes do not change what the bootstrap templates parse', () => {
  it('a bootstrap-only parse of a plain spell is unchanged', () => {
    const r = parseCard(card('Review Bolt', 'Instant', '~ deals 3 damage to any target.'), defaultParseOptions());
    expect(r.faces[0]!.abilities[0]!.kind).toBe('spell');
  });
});
