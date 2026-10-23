/**
 * WP19 (design 15.2): the 18 event shapes of the model (design 3.5, types/ability.ts#EventPattern), the 20 most frequent cost parts of the corpus
 * (corpus analysis 7.4), the lead-in condition and durations, and keyword lines with dash forms and labels, each through parseCard with the bootstrap and
 * WP19 templates: the exact JSON, full automation and the render gate. Wordings are synthetic (design 6.10).
 *
 * Shapes the templates cannot state stay manual (never a guess): a trigger the model has no wording for (CR 603.2 "beginning of a turn", "a spell
 * resolves") is a manual triggered ability that keeps its understood effect (design 6.6).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, CostDef, EventPattern, TriggerDef } from '../../../src/types/ability';
import { automated, card, face, options } from './support';

const opts = options();
const DRAW = [{ op: 'draw', who: { ref: 'you' }, count: 1 }];

function parse(typeLine: string, text: string): { defs: AbilityDef[]; gate: boolean } {
  const f = face(card('Example Wisp', typeLine, text), opts);
  return { defs: f.abilities, gate: f.gate.every((g) => g.ok) };
}

const zc = (subject: object, from?: string, to?: string): EventPattern => ({ ev: 'zoneChange', subject, ...(from ? { from } : {}), ...(to ? { to } : {}) }) as EventPattern;

/** [rule, trigger clause, expected TriggerDef]: one row per event shape (and the frequent variants of the top 60 clauses, corpus analysis 6.1). */
const SHAPES: [string, string, TriggerDef][] = [
  ['CR 603.6a zoneChange (enters)', 'When ~ enters', { on: [zc({ self: true }, undefined, 'battlefield')] }],
  ['CR 603.6c, 700.4 zoneChange (dies)', 'Whenever another creature you control dies', { on: [zc({ types: ['Creature'], controller: 'you', other: true }, 'battlefield', 'graveyard')] }],
  ['CR 603.6c zoneChange (leaves)', 'When ~ leaves the battlefield', { on: [zc({ self: true }, 'battlefield')] }],
  ['CR 603.6c, 603.10a zoneChange (~ or another creature)', 'Whenever ~ or another creature dies', { on: [zc({ types: ['Creature'] }, 'battlefield', 'graveyard')] }],
  ['CR 601.2i cast', 'Whenever you cast an instant spell', { on: [{ ev: 'cast', player: 'you', spell: { types: ['Instant'] } }] }],
  ['CR 601.2i cast (opponent)', 'Whenever an opponent casts a spell', { on: [{ ev: 'cast', player: 'opponent' }] }],
  ['CR 602.2 activate', "Whenever you activate an ability that isn't a mana ability", { on: [{ ev: 'activate', player: 'you', manaAbility: false }] }],
  ['CR 508.1 attacks', 'Whenever ~ attacks', { on: [{ ev: 'attacks', attacker: { self: true } }] }],
  ['CR 508.1 attacks alone', 'Whenever a creature you control attacks alone', { on: [{ ev: 'attacks', attacker: { types: ['Creature'], controller: 'you' }, alone: true }] }],
  ['CR 508.1 attacks a planeswalker', 'Whenever ~ attacks a planeswalker', { on: [{ ev: 'attacks', attacker: { self: true }, defender: 'planeswalker' }] }],
  ['CR 509.1 blocks', 'Whenever ~ blocks', { on: [{ ev: 'blocks', blocker: { self: true } }] }],
  ['CR 509.1h becomesBlocked', 'Whenever ~ becomes blocked by a creature', { on: [{ ev: 'becomesBlocked', attacker: { self: true }, by: { types: ['Creature'] } }] }],
  ['CR 120.2, 510.2 damage (combat, to a player)', 'Whenever ~ deals combat damage to a player', { on: [{ ev: 'damage', source: { self: true }, recipient: { player: 'any' }, combat: true }] }],
  ['CR 120.2 damage (dealt to ~)', 'Whenever ~ is dealt damage', { on: [{ ev: 'damage', recipient: { object: { self: true } } }] }],
  ['CR 603.2c damage (one or more)', 'Whenever one or more creatures you control deal combat damage to a player', { on: [{ ev: 'damage', source: { types: ['Creature'], controller: 'you' }, recipient: { player: 'any' }, combat: true }], batch: true }],
  ['CR 503.1, 603.2b step (upkeep)', 'At the beginning of your upkeep', { on: [{ ev: 'step', step: 'upkeep', whose: 'you' }] }],
  ['CR 513.1 step (each end step)', 'At the beginning of each end step', { on: [{ ev: 'step', step: 'end' }] }],
  ['CR 507.1 step (combat on your turn)', 'At the beginning of combat on your turn', { on: [{ ev: 'step', step: 'beginCombat', whose: 'you' }] }],
  ['CR 119.3 life (gain)', 'Whenever you gain life', { on: [{ ev: 'life', change: 'gain', player: 'you' }] }],
  ['CR 119.3 life (loss)', 'Whenever you lose life', { on: [{ ev: 'life', change: 'loss', player: 'you' }] }],
  ['CR 121.2 draw', 'Whenever an opponent draws a card', { on: [{ ev: 'draw', player: 'opponent' }] }],
  ['CR 121.2 draw (the Nth card)', 'Whenever you draw your second card each turn', { on: [{ ev: 'draw', player: 'you', nth: 2 }] }],
  ['CR 701.26a becomes (tapped)', 'Whenever a creature you control becomes tapped', { on: [{ ev: 'becomes', what: 'tapped', object: { types: ['Creature'], controller: 'you' } }] }],
  ['CR 122.1 counters', 'Whenever a +1/+1 counter is put on ~', { on: [{ ev: 'counters', change: 'put', kind: '+1/+1', on: { self: true } }] }],
  ['CR 701.21a action (sacrifice)', 'Whenever you sacrifice another permanent', { on: [{ ev: 'action', verb: 'sacrifice', actor: 'you', object: { other: true } }] }],
  ['CR 701.9a action (discard)', 'Whenever you discard a card', { on: [{ ev: 'action', verb: 'discard', actor: 'you' }] }],
  ['CR 701.22a action (scry)', 'Whenever you scry', { on: [{ ev: 'action', verb: 'scry', actor: 'you' }] }],
  ['CR 111.1 createToken', 'Whenever you create a token', { on: [{ ev: 'createToken', player: 'you', token: { token: true } }] }],
  ['CR 706.2 dieRoll', 'Whenever you roll a die', { on: [{ ev: 'dieRoll', player: 'you' }] }],
  ['CR 603.8 state', 'When you control no creatures', { on: [{ ev: 'state', cond: { cond: 'not', of: { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } } } } }] }],
];

describe('WP19 trigger templates: the event shapes of design 3.5 (CR 603.2)', () => {
  for (const [rule, clause, want] of SHAPES) {
    it(`${rule}: "${clause}, draw a card."`, () => {
      const r = parse('Creature — Spirit', `${clause}, draw a card.`);
      expect(r.defs).toHaveLength(1);
      const a = r.defs[0]!;
      expect(a.kind, JSON.stringify(a)).toBe('triggered');
      expect((a as { trigger: TriggerDef }).trigger).toEqual(want);
      expect((a as { effect: { steps: unknown[] } }).effect.steps).toEqual(DRAW);
      expect(automated(r.defs) && r.gate).toBe(true);
    });
  }

  it('the table covers 16 of the 18 EventPattern kinds; the other two (beginTurn, resolves) have no printed trigger wording the templates state', () => {
    const kinds = new Set(SHAPES.flatMap(([, , t]) => t.on.map((p) => p.ev)));
    expect([...kinds].sort()).toEqual(['action', 'activate', 'attacks', 'becomes', 'becomesBlocked', 'blocks', 'cast', 'counters', 'createToken', 'damage', 'dieRoll', 'draw', 'life', 'state', 'step', 'zoneChange']);
  });

  it('CR 603.1, design 6.6: a trigger no template states is a manual triggered ability that keeps its understood effect (never a guess)', () => {
    // FAST1 T4: "your second spell each turn" is read now (cast.nth, CR 601.2i); "your first spell during each opponent's turn" is not
    // M12-3: "Whenever a creature attacks you or a planeswalker you control" is read now (`orPlaneswalker`, CR 506.3, 508.1b)
    // std-rx35: "Whenever ~ attacks and isn't blocked" is read now (event attacksUnblocked, CR 509.1h); "... this combat" is not
    for (const clause of ['At the beginning of your turn', "Whenever ~ attacks and isn't blocked this combat", "Whenever you cast your first spell during each opponent's turn"]) {
      const r = parse('Creature — Spirit', `${clause}, draw a card.`);
      expect(r.defs[0]!.kind, clause).toBe('manual');
      expect((r.defs[0] as { shape?: string }).shape, clause).toBe('triggered');
      expect((r.defs[0] as { effect?: { steps: unknown[] } }).effect?.steps, clause).toEqual(DRAW);
    }
  });

  it('CR 603.4: an intervening "if" after a WP19 trigger clause is kept as interveningIf, never folded into the effect', () => {
    const r = parse('Creature — Spirit', 'At the beginning of your upkeep, if you control an Elf, draw a card.');
    expect(r.defs[0]).toMatchObject({ kind: 'triggered', trigger: { on: [{ ev: 'step', step: 'upkeep', whose: 'you' }] }, interveningIf: { cond: 'exists' }, effect: { steps: DRAW } });
    expect(r.gate).toBe(true);
  });

  it('CR 207.2c: an ability word before a trigger is a label (no rules meaning); the trigger is parsed as without it', () => {
    const r = parse('Creature — Spirit', 'Landfall — Whenever a land you control enters, draw a card.');
    expect(r.defs[0]).toMatchObject({ kind: 'triggered', label: 'Landfall', trigger: { on: [zc({ types: ['Land'], controller: 'you' }, undefined, 'battlefield')] } });
    expect(automated(r.defs) && r.gate).toBe(true);
  });
});

/** [corpus rank (analysis 7.4), cost text, expected CostDef]. The Cost hole of WP6 reads them; WP19 pins them end to end (activated ability, gate). */
const COSTS: [string, string, CostDef][] = [
  ['1 mana', '{3}{G}', { mana: [{ kind: 'generic', amount: 3 }, { kind: 'colored', color: 'G' }] }],
  ['2 {T}', '{T}', { tap: true }],
  ['3 sacrifice ~', 'Sacrifice ~', { other: [{ kind: 'sacrifice', filter: { self: true }, count: 1, self: true }] }],
  ['4 sacrifice a TYPE', 'Sacrifice an artifact', { other: [{ kind: 'sacrifice', filter: { types: ['Artifact'] }, count: 1 }] }],
  ['5 discard a card', 'Discard a card', { other: [{ kind: 'discard', count: 1 }] }],
  ['6 pay N life', 'Pay 3 life', { other: [{ kind: 'payLife', amount: 3 }] }],
  ['7 sacrifice another TYPE', 'Sacrifice another creature', { other: [{ kind: 'sacrifice', filter: { types: ['Creature'], other: true }, count: 1 }] }],
  ['8 exile ~ from your graveyard', 'Exile ~ from your graveyard', { other: [{ kind: 'exileFrom', zone: 'graveyard', count: 1, self: true }] }],
  ['9 discard ~', 'Discard ~', { other: [{ kind: 'discard', count: 1, self: true }] }],
  ['10 tap N untapped TYPE you control', 'Tap two untapped Elves you control', { other: [{ kind: 'tapUntapped', filter: { subtypes: ['Elf'], controller: 'you' }, count: 2 }] }],
  ['11 tap an untapped TYPE you control', 'Tap an untapped Elf you control', { other: [{ kind: 'tapUntapped', filter: { subtypes: ['Elf'], controller: 'you' }, count: 1 }] }],
  ['13 remove a +N/+N counter from ~', 'Remove a +1/+1 counter from ~', { other: [{ kind: 'removeCounters', counter: '+1/+1', count: 1, self: true }] }],
  ['14 sacrifice N TYPE', 'Sacrifice two lands', { other: [{ kind: 'sacrifice', filter: { types: ['Land'] }, count: 2 }] }],
  ['15 exile a TYPE card from your graveyard', 'Exile a creature card from your graveyard', { other: [{ kind: 'exileFrom', zone: 'graveyard', count: 1, filter: { types: ['Creature'] } }] }],
  ['16 discard a TYPE card', 'Discard a creature card', { other: [{ kind: 'discard', count: 1, filter: { types: ['Creature'] } }] }],
  ['17 remove a charge counter from ~', 'Remove a charge counter from ~', { other: [{ kind: 'removeCounters', counter: 'charge', count: 1, self: true }] }],
  ['18 discard N cards', 'Discard two cards', { other: [{ kind: 'discard', count: 2 }] }],
  ['19 return a TYPE you control to its owner\'s hand', "Return a land you control to its owner's hand", { other: [{ kind: 'returnToHand', filter: { types: ['Land'], controller: 'you' }, count: 1 }] }],
  ['20 remove N spore counters from ~', 'Remove three spore counters from ~', { other: [{ kind: 'removeCounters', counter: 'spore', count: 3, self: true }] }],
  ['21 {Q}', '{Q}', { untap: true }],
  ['22 discard a card at random', 'Discard a card at random', { other: [{ kind: 'discard', count: 1, random: true }] }],
  ['26 pay {E}', 'Pay {E}{E}', { other: [{ kind: 'payEnergy', amount: 2 }] }],
  ['28 return ~ to its owner\'s hand', "Return ~ to its owner's hand", { other: [{ kind: 'returnToHand', filter: { self: true }, count: 1, self: true }] }],
  ['30 reveal ~ from your hand', 'Reveal ~ from your hand', { other: [{ kind: 'reveal', zone: 'hand', count: 1, self: true }] }],
  ['32 discard your hand', 'Discard your hand', { other: [{ kind: 'discard', count: 'any', hand: true }] }],
  ['35 tap another untapped TYPE you control', 'Tap another untapped creature you control', { other: [{ kind: 'tapUntapped', filter: { types: ['Creature'], controller: 'you' }, count: 1, other: true }] }],
  ['mill', 'Mill two cards', { other: [{ kind: 'mill', count: 2 }] }],
  ['exert (cost.exert)', 'Exert ~', { other: [{ kind: 'action', action: 'exert' }] }],
  ['a list', '{1}, {T}, Sacrifice ~', { mana: [{ kind: 'generic', amount: 1 }], tap: true, other: [{ kind: 'sacrifice', filter: { self: true }, count: 1, self: true }] }],
];

describe('WP19 costs: the most frequent cost parts of the corpus (analysis 7.4; CR 118, 602.1a), end to end', () => {
  for (const [rank, text, want] of COSTS) {
    it(`CR 118.3, 602.2 cost part ${rank}: "${text}: Draw a card."`, () => {
      const r = parse('Artifact Creature — Golem', `${text}: Draw a card.`);
      expect(r.defs[0]).toMatchObject({ kind: 'activated', cost: want, effect: { steps: DRAW } });
      expect((r.defs[0] as { cost: CostDef }).cost).toEqual(want);
      expect(automated(r.defs) && r.gate).toBe(true);
    });
  }

  it('CR 602.2b, design 6.6: a cost part no template or hole states is a manual cost part; the parts understood are kept', () => {
    // cloud std-spm / CLOUD std-ecl: "Remove a counter from ~" is a cost of any kind of counter now (cost:removeCounters.any, rules/pay-parts.ts, CR 118.3), so another unstated part stands here
    const r = parse('Artifact Creature — Golem', '{2}, Put a card from your hand on top of your library: Draw a card.');
    const a = r.defs[0] as { kind: string; cost?: CostDef };
    expect(a.kind).toBe('activated');
    expect(automated(r.defs)).toBe(false);
    expect(a.cost?.mana).toEqual([{ kind: 'generic', amount: 2 }]);
    expect(a.cost?.other).toEqual([{ kind: 'manual', text: 'Put a card from your hand on top of your library' }]);
  });
});

describe('WP19 conditions and durations (CR 608.2c, 611.2a)', () => {
  it('CR 608.2c: a lead-in "if" wraps the sentence in an if step; "if you do" names the step before it (CR 118.12)', () => {
    const r = parse('Instant', 'If you control an Elf, draw a card.');
    expect((r.defs[0] as { effect: { steps: unknown[] } }).effect.steps).toEqual([{ op: 'if', cond: { cond: 'exists', of: { ref: 'each', filter: { subtypes: ['Elf'], controller: 'you' } } }, then: DRAW }]);
    expect(automated(r.defs) && r.gate).toBe(true);
  });

  it('CR 611.2a, 611.2c, 514.2: "Until end of turn, ..." is the same duration as the trailing "until end of turn"', () => {
    // dur.lead.pump was withdrawn in review (no corpus use passed the gate), and no template reads a trailing grant: the lead-in grant and the trailing
    // pump (bootstrap) are compared on their duration and on the shape of the step
    const lead = parse('Instant', 'Until end of turn, target creature gains reach.');
    const trail = parse('Instant', 'Target creature gets +2/+2 until end of turn.');
    expect(automated(lead.defs) && lead.gate && automated(trail.defs) && trail.gate).toBe(true);
    const step = (d: AbilityDef): { op: string; duration: unknown; effects: { affects: unknown }[] } => (d as unknown as { effect: { steps: never[] } }).effect.steps[0]!;
    expect(step(lead.defs[0]!).duration).toEqual(step(trail.defs[0]!).duration);
    expect(step(lead.defs[0]!).op).toBe(step(trail.defs[0]!).op);
    expect(step(lead.defs[0]!).effects[0]!.affects).toEqual(step(trail.defs[0]!).effects[0]!.affects);
  });

  it('CR 611.2a: "Until your next turn, ..." is untilNextTurn of the controller', () => {
    const r = parse('Instant', 'Until your next turn, creatures you control gain vigilance.');
    expect((r.defs[0] as { effect: { steps: { duration?: unknown }[] } }).effect.steps[0]!.duration).toEqual({ d: 'untilNextTurn', whose: { ref: 'you' } });
    expect(automated(r.defs) && r.gate).toBe(true);
  });
});

/** [rule, keyword line, expected abilities without text]. */
const KEYWORDS: [string, string, object[]][] = [
  ['CR 702.6a equip', 'Equip {3}', [{ kind: 'keyword', keyword: 'equip', cost: { mana: [{ kind: 'generic', amount: 3 }] } }]],
  ['CR 702.6a equip with a dash cost', 'Equip—Pay 3 life.', [{ kind: 'keyword', keyword: 'equip', cost: { other: [{ kind: 'payLife', amount: 3 }] } }]],
  ['CR 702.14a landwalk', 'Flying, swampwalk', [{ kind: 'keyword', keyword: 'flying' }, { kind: 'keyword', keyword: 'landwalk', quality: 'swamp' }]],
  ['CR 702.21a ward with a dash cost', 'Ward—Pay 2 life.', [{ kind: 'keyword', keyword: 'ward', cost: { other: [{ kind: 'payLife', amount: 2 }] } }]],
  ['CR 702.24a cumulative upkeep with a dash cost', 'Cumulative upkeep—Pay 2 life.', [{ kind: 'keyword', keyword: 'cumulative upkeep', cost: { other: [{ kind: 'payLife', amount: 2 }] } }]],
  ['CR 702.62a suspend: an amount and a dash cost', 'Suspend 5—{2}{U}', [{ kind: 'keyword', keyword: 'suspend', amount: 5, cost: { mana: [{ kind: 'generic', amount: 2 }, { kind: 'colored', color: 'U' }] } }]],
  ['CR 702.33a kicker', 'Kicker {1}{G}', [{ kind: 'keyword', keyword: 'kicker', cost: { mana: [{ kind: 'generic', amount: 1 }, { kind: 'colored', color: 'G' }] } }]],
];

describe('WP19 keyword lines, dash forms included (CR 702)', () => {
  for (const [rule, line, want] of KEYWORDS) {
    it(`${rule}: "${line}"`, () => {
      const r = parse('Artifact — Equipment', line);
      expect(r.defs.map((d) => { const { text: _t, src: _s, prov: _p, ...rest } = d as unknown as Record<string, unknown>; return rest; })).toEqual(want);
      expect(automated(r.defs) && r.gate).toBe(true);
    });
  }

  it('CR 702.1, design 6.6: a keyword line the templates cannot state stays manual (typecycling, partner variants, "Equip [quality]")', () => {
    // "Equip [quality] {N}" (CR 702.6c, 702.6e): the equip expansion (keywords/data/equip.json, WP3) uses a filter parameter as the WHOLE target filter, so a
    // parsed quality without "creature you control" would let the Equipment attach to any player's permanent of that quality. It stays manual.
    // cmd1 (CR 702.124i): "Partner--Friends forever" is the partner keyword with its text as a label now (holes/misc.ts#partnerText), a deck-construction ability
    // with no game effect: test/cloud/cmd1
    for (const line of ['Forestcycling {2}', 'Equip legendary creature {2}', 'Equip planeswalker {1}', 'Equip Knight {1}']) {
      const r = parse('Creature — Spirit', line);
      expect(automated(r.defs) && r.gate, line).toBe(false);
    }
  });
});
