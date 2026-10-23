/**
 * PUSH1 T2: the shapes of the backlog played through `applyAction` on the game path (synthetic cards compiled by the default compiler, design 6.10; real
 * fixture cards for the opponents' spells and creatures). Prevention shields of the next N damage (CR 615.7), one combat damage step as one event for a
 * damage trigger that names one side of it (CR 510.2, 603.2c), "that much" (design 3.5), "it" after an activation cost that names ~ (CR 113.7a, 602.2b),
 * and the pump of a blocking creature (CR 509.1, 611.2c).
 */
import { describe, expect, it } from 'vitest';
import { charsOfObject, compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { activate, cast, resolveTop, target } from '../../m5/cr-examples/helpers';
import { answer, creature, declareAttackers, find, lifeOf, logHas, pass, passUntil, runCombat, scenario, toDeclareAttackers } from '../../m4/helpers';
import { parsed } from './support';

function spell(name: string, cost: string, text: string, type = 'Instant'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: ['W'] } as OracleCard);
}

const WARD = spell('Mending Ward', '{W}', 'Prevent the next 2 damage that would be dealt to any target this turn.');
const XWARD = spell('Measured Ward', '{X}{W}', 'Prevent the next X damage that would be dealt to any target this turn.');
const BEARWARD = spell('Bear Ward', '{W}', 'Prevent the next 2 damage that would be dealt to target creature this turn.');

/** p1 (active) holds Lightning Bolts and Mountains; p2 holds the ward and Plains; Grizzly Bears on p2's side. */
function board(ward: CardDef): GameState {
  return scenario(['Lightning Bolt', 'Grizzly Bears', 'Mountain', 'Plains'], {
    p1: { hand: ['Lightning Bolt', 'Lightning Bolt'], battlefield: ['Mountain', 'Mountain'] },
    p2: { hand: [ward.name], battlefield: ['Grizzly Bears', 'Plains', 'Plains', 'Plains'] },
    defs: [ward],
  });
}

describe('CR 615.7: "Prevent the next N damage that would be dealt to any target this turn" on the game path', () => {
  it('the compiled card announces one target and creates a shield; the reviewed template is stable, so the card is full (design 6.9)', () => {
    const steps = (WARD.faces[0]!.abilities[0] as { effect: { targets: unknown[]; steps: unknown[] } }).effect;
    expect(steps.targets).toEqual([{ id: 't0', kind: 'anyTarget', min: 1, max: 1, text: 'any target' }]);
    expect(WARD.automation.level).toBe('full');
    expect(WARD.automation.unsupported).toEqual([]);
  });
  it('"the next N damage ... to you" (eff.prevent.next.player): promoted by FAST5 PROMO1 with three golden cards (design 6.9), so the card is full', () => {
    const own = spell('Self Ward', '{W}', 'Prevent the next 8 damage that would be dealt to you this turn.');
    expect(own.automation.level).toBe('full');
    expect(own.automation.unsupported).toEqual([]);
  });
  it('design 6.9, CR 113.1c: an experimental template inside a quoted (granted) ability caps the card at partial too, and is recorded as used', () => {
    // eff.t8.gainlife.foreach3 (template-set version 3) is still experimental (one index card)
    const text = 'Enchant land\nEnchanted land has "{T}: You gain 3 life for each creature you control."';
    const aura = spell('Warded Ground', '{W}', text, 'Enchantment — Aura');
    expect(aura.automation.level).toBe('partial');
    const face = parsed(text, 'Enchantment — Aura');
    expect(face.templatesUsed).toContain('eff.t8.gainlife.foreach3');
    expect(face.experimental).toContain('eff.t8.gainlife.foreach3');
    const stable = 'Enchant land\nEnchanted land has "{T}: Prevent the next 1 damage that would be dealt to you this turn."';
    expect(spell('Warded Field', '{W}', stable, 'Enchantment — Aura').automation.level).toBe('full');
  });
  it('guard G10: an experimental template of template-set version 1 inside quotes is recorded as used but keeps main\'s level (until it is reviewed)', () => {
    const text = 'Enchant creature\nEnchanted creature has "Whenever this creature deals combat damage to a player, you may draw a card."';
    const face = parsed(text, 'Enchantment — Aura');
    expect(face.templatesUsed).toContain('ch.may');
    expect(face.experimental).not.toContain('ch.may');
  });

  it('CR 615.7, 115.4: on a player, the shield prevents 2 of a Lightning Bolt\'s 3 damage, then it is used up', () => {
    let s = board(WARD);
    s = pass(cast(s, 'Lightning Bolt', [target('p2')]));
    s = resolveTop(cast(s, 'Mending Ward', [target('p2')], 'p2'));
    s = resolveTop(s);
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(logHas(s, /prevented/, 'CR 615.7')).toBe(true);
    s = resolveTop(cast(s, 'Lightning Bolt', [target('p2')]));
    expect(lifeOf(s, 'p2')).toBe(16);
  });

  it('CR 615.7, 115.4: on a creature, the same card\'s shield keeps Grizzly Bears alive through a Bolt (1 damage marked)', () => {
    let s = board(WARD);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = pass(cast(s, 'Lightning Bolt', [target(bears)]));
    s = resolveTop(cast(s, 'Mending Ward', [target(bears)], 'p2'));
    s = resolveTop(s);
    expect(s.objects[bears]?.damage).toBe(1);
    expect(lifeOf(s, 'p2')).toBe(20); // a shield on the creature does not protect its controller
  });

  it('CR 615.7: a shield on one player prevents nothing dealt to another player', () => {
    let s = board(WARD);
    s = pass(cast(s, 'Lightning Bolt', [target('p2')]));
    s = resolveTop(cast(s, 'Mending Ward', [target('p1')], 'p2'));
    s = resolveTop(s);
    expect(lifeOf(s, 'p2')).toBe(17);
  });

  it('CR 107.3, 611.2c: "the next X damage" is fixed as the spell resolves (X = 2 prevents 2 of 3)', () => {
    let s = board(XWARD);
    s = pass(cast(s, 'Lightning Bolt', [target('p2')]));
    s = resolveTop(cast(s, 'Measured Ward', [{ kind: 'chooseNumber', n: 2 }, target('p2')], 'p2'));
    s = resolveTop(s);
    expect(lifeOf(s, 'p2')).toBe(19);
  });

  it('CR 615.7: "to target creature" can target only a creature, and protects it', () => {
    let s = board(BEARWARD);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = pass(cast(s, 'Lightning Bolt', [target(bears)]));
    s = resolveTop(cast(s, 'Bear Ward', [target(bears)], 'p2'));
    s = resolveTop(s);
    expect(s.objects[bears]?.damage).toBe(1);
  });
});

describe('CR 510.2, 603.2c: the combat damage of a step is one event for a damage trigger that names one side of it', () => {
  const brute = creature('Ledger Brute', ['4', '4'], 'Whenever this creature deals combat damage, you gain that much life.');
  const counted = creature('Tallied Brute', ['4', '5'], 'Whenever this creature deals combat damage, put a +1/+1 counter on it.');
  const sponge = creature('Bruised Sponge', ['1', '6'], 'Whenever this creature is dealt damage, put a +1/+1 counter on it.');
  const blocked = (attacker: CardDef): GameState => scenario(['Grizzly Bears'], { p1: { battlefield: [attacker.name] }, p2: { battlefield: ['Grizzly Bears', 'Grizzly Bears'] }, defs: [attacker] });

  it('"Whenever ~ deals combat damage, you gain that much life": blocked by two creatures, it triggers ONCE and you gain the total (4)', () => {
    const s0 = blocked(brute);
    const me = find(s0, 'Ledger Brute', 'battlefield');
    const [b1, b2] = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Grizzly Bears');
    const s = runCombat(s0, { attack: [[me]], block: [[b1!, me], [b2!, me]], assign: { [me]: [{ id: b1!, amount: 2 }, { id: b2!, amount: 2 }] } });
    expect(lifeOf(s, 'p1')).toBe(24);
    expect(s.log.filter((l) => /Ledger Brute triggers/.test(l.text))).toHaveLength(1);
  });

  it('"Whenever ~ deals combat damage, put a +1/+1 counter on it": one counter for the damage to two blockers', () => {
    const s0 = blocked(counted);
    const me = find(s0, 'Tallied Brute', 'battlefield');
    const [b1, b2] = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Grizzly Bears');
    const s = runCombat(s0, { attack: [[me]], block: [[b1!, me], [b2!, me]], assign: { [me]: [{ id: b1!, amount: 2 }, { id: b2!, amount: 2 }] } });
    expect(s.objects[me]!.counters['+1/+1']).toBe(1);
  });

  it('"Whenever ~ is dealt damage, put a +1/+1 counter on it": dealt damage by two blockers at once, one counter', () => {
    const s0 = blocked(sponge);
    const me = find(s0, 'Bruised Sponge', 'battlefield');
    const [b1, b2] = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Grizzly Bears');
    const s = runCombat(s0, { attack: [[me]], block: [[b1!, me], [b2!, me]], assign: { [me]: [{ id: b1!, amount: 1 }] } });
    expect(s.objects[me]!.counters['+1/+1']).toBe(1);
    expect(s.objects[me]!.damage).toBe(4);
  });

  it('CR 120.2b, 603.2c: noncombat damage one instruction deals to several creatures is one event too ("deals 1 damage to each creature ...": one counter)', () => {
    const singer = creature('Pulse Singer', ['1', '4'], ['Whenever this creature deals damage, put a +1/+1 counter on it.', '{T}: This creature deals 1 damage to each other creature.'].join('\n'));
    expect(singer.automation.level).toBe('full');
    let s = scenario(['Grizzly Bears'], { p1: { battlefield: [singer.name] }, p2: { battlefield: ['Grizzly Bears', 'Grizzly Bears'] }, defs: [singer] });
    const me = find(s, 'Pulse Singer', 'battlefield');
    s = activate(s, me);
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = s.pending?.kind === 'order' ? answer(s, { kind: 'order', ids: s.pending.items.map((x) => x.id) }) : resolveTop(s);
    expect(s.zones.stack).toEqual([]);
    expect(s.log.filter((l) => /Pulse Singer triggers/.test(l.text))).toHaveLength(1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Grizzly Bears').every((id) => s.objects[id]!.damage === 1)).toBe(true);
    expect(s.objects[me]!.counters['+1/+1']).toBe(1);
  });

  it('CR 608.2c, 120.2b: two instructions are two events: "deals 1 damage to target creature. ~ deals 1 damage to target player." triggers twice', () => {
    const twice = creature('Twin Singer', ['1', '4'], ['Whenever this creature deals damage, put a +1/+1 counter on it.', '{T}: This creature deals 1 damage to target creature. This creature deals 1 damage to target player.'].join('\n'));
    let s = scenario(['Grizzly Bears'], { p1: { battlefield: [twice.name] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [twice] });
    const me = find(s, 'Twin Singer', 'battlefield');
    s = activate(s, me, [target(find(s, 'Grizzly Bears', 'battlefield')), target('p2')]);
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = s.pending?.kind === 'order' ? answer(s, { kind: 'order', ids: s.pending.items.map((x) => x.id) }) : resolveTop(s);
    expect(s.zones.stack).toEqual([]);
    expect(s.objects[me]!.counters['+1/+1']).toBe(2);
  });

  it('a trigger that names both sides still triggers once per pair (CR 603.2c): two creatures dealing combat damage to a player are two occurrences', () => {
    const banner = creature('Tally Banner', ['0', '3'], 'Whenever a creature you control deals combat damage to a player, you gain 1 life.');
    let s = scenario(['Grizzly Bears'], { p1: { battlefield: [banner.name, 'Grizzly Bears', 'Grizzly Bears'] }, defs: [banner] });
    const bears = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Grizzly Bears' && s.objects[id]!.controller === 'p1');
    s = declareAttackers(toDeclareAttackers(s), bears.map((b) => [b] as [string]));
    for (let i = 0; i < 40 && s.turn.step !== 'endCombat'; i++) {
      const d = s.pending!;
      if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((x) => x.id) }); // CR 603.3b: two triggers of one controller at once
      else s = pass(s);
    }
    expect(lifeOf(s, 'p2')).toBe(16);
    expect(lifeOf(s, 'p1')).toBe(22);
    expect(s.log.filter((l) => /Tally Banner triggers/.test(l.text))).toHaveLength(2);
  });
});

describe('design 6.4: the pronouns of the backlog shapes, played', () => {
  it('CR 113.7a, 602.2b: "Sacrifice ~: It deals 2 damage to any target": the sacrificed object deals the damage', () => {
    const seal = spell('Ember Seal', '{R}', 'Sacrifice this enchantment: It deals 2 damage to any target.', 'Enchantment');
    expect(seal.automation.level).toBe('full');
    let s = scenario(['Grizzly Bears'], { p1: { battlefield: [seal.name] }, defs: [seal] });
    s = activate(s, find(s, 'Ember Seal', 'battlefield'), [target('p2')]);
    s = resolveTop(s);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(logHas(s, /Ember Seal deals 2 damage/)).toBe(true);
  });

  it('CR 509.1, 611.2c: "Whenever ~ blocks, it gets +0/+3 until end of turn": the blocker survives a 4-power attacker, and the pump ends with the turn', () => {
    const wall = creature('Bracing Sentry', ['1', '2'], 'Whenever this creature blocks, it gets +0/+3 until end of turn.');
    expect(wall.automation.level).toBe('full');
    const ogre = creature('Test Ogre', ['4', '4'], '');
    let s = scenario(['Grizzly Bears'], { p1: { battlefield: [ogre.name] }, p2: { battlefield: [wall.name] }, defs: [wall, ogre] });
    const me = find(s, 'Test Ogre', 'battlefield');
    const sentry = find(s, 'Bracing Sentry', 'battlefield');
    s = runCombat(s, { attack: [[me]], block: [[sentry, me]] });
    expect(s.zones.battlefield).toContain(sentry);
    expect(s.objects[sentry]!.damage).toBe(4);
    expect(charsOfObject(s, s.objects[sentry]!).toughness).toBe('5');
    // CR 514.2: in the cleanup step the damage is removed and "until end of turn" effects end at the same time
    const turn = s.turn.number;
    s = passUntil(s, (x) => x.turn.number > turn && x.pending?.kind === 'priority', 'the next turn');
    expect(s.objects[sentry]!.damage).toBe(0);
    expect(charsOfObject(s, s.objects[sentry]!).toughness).toBe('2');
  });

  it('CR 509.1: "Whenever ~ blocks or becomes blocked, it gets +2/+2": as an attacker blocked by Grizzly Bears it is the one pumped, and survives', () => {
    const gorilla = creature('Bracing Ape', ['2', '2'], 'Whenever this creature blocks or becomes blocked, it gets +2/+2 until end of turn.');
    expect(gorilla.automation.level).toBe('full');
    let s = scenario(['Grizzly Bears'], { p1: { battlefield: [gorilla.name] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [gorilla] });
    const me = find(s, 'Bracing Ape', 'battlefield');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = runCombat(s, { attack: [[me]], block: [[bears, me]] });
    expect(s.zones.battlefield).toContain(me);
    expect(s.zones.battlefield).not.toContain(bears);
  });

  it('CR 120.3: "Whenever ~ deals combat damage to a player, put a +1/+1 counter on it": the counter goes on ~', () => {
    const rogue = creature('Pocket Rogue', ['2', '1'], 'Whenever this creature deals combat damage to a player, put a +1/+1 counter on it.');
    expect(rogue.automation.level).toBe('full');
    let s = scenario(['Grizzly Bears'], { p1: { battlefield: [rogue.name] }, defs: [rogue] });
    const me = find(s, 'Pocket Rogue', 'battlefield');
    s = runCombat(s, { attack: [[me]] });
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(s.objects[me]!.counters['+1/+1']).toBe(1);
  });
});

describe('CR 603.2c, 603.10a, design 3.5: "that much" of a batch trigger and the occurrences of "one or more" counters', () => {
  const artillery = creature('Brass Mortar', ['1', '3'], 'Whenever one or more artifacts you control enter, this creature deals that much damage to each opponent.');
  const trinket = spell('Brass Trinket', '{0}', '', 'Artifact');
  const oneTreasure = spell('Lone Treasure', '{0}', 'Create a Treasure token.', 'Sorcery');
  const twoTreasures = spell('Twin Treasures', '{0}', 'Create two Treasure tokens.', 'Sorcery');
  const board = (): GameState => scenario(['Grizzly Bears'], {
    p1: { hand: [trinket.name, oneTreasure.name, twoTreasures.name], battlefield: [artillery.name] }, defs: [artillery, trinket, oneTreasure, twoTreasures],
  });
  const settle = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = s.pending?.kind === 'order' ? answer(s, { kind: 'order', ids: s.pending.items.map((x) => x.id) }) : resolveTop(s);
    return s;
  };
  it('design 3.5: "that much" of "one or more artifacts enter" is the number that entered: ONE artifact spell resolving deals 1 (a group of one has an amount too)', () => {
    expect(artillery.automation.level).toBe('full');
    const s = settle(cast(board(), 'Brass Trinket'));
    expect(lifeOf(s, 'p2')).toBe(19);
  });
  it('design 3.5: one Treasure token created alone deals 1, two created at once deal 2 (one trigger, CR 603.2c)', () => {
    expect(lifeOf(settle(cast(board(), 'Lone Treasure')), 'p2')).toBe(19);
    const s = settle(cast(board(), 'Twin Treasures'));
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(s.log.filter((l) => /Brass Mortar triggers/.test(l.text))).toHaveLength(1);
  });

  it('CR 603.2c: "one or more +1/+1 counters are put on a creature you control" triggers once PER CREATURE that got counters, each with its own amount', () => {
    const angel = creature('Counting Angel', ['3', '4'], 'Whenever one or more +1/+1 counters are put on a creature you control, this creature deals that much damage to target opponent.');
    const growth = spell('Shared Growth', '{0}', 'Put a +1/+1 counter on each creature you control.', 'Instant');
    expect(angel.automation.level).toBe('full');
    let s = scenario(['Grizzly Bears'], { p1: { hand: [growth.name], battlefield: [angel.name, 'Grizzly Bears'] }, defs: [angel, growth] });
    s = resolveTop(cast(s, 'Shared Growth'));
    for (let i = 0; i < 10 && (s.zones.stack.length > 0 || (s.pending != null && s.pending.kind !== 'priority')); i++) {
      const d = s.pending;
      if (d?.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((x) => x.id) });
      else if (d?.kind === 'chooseTargets') s = answer(s, target('p2'));
      else s = resolveTop(s);
    }
    expect(s.log.filter((l) => /Counting Angel triggers/.test(l.text))).toHaveLength(2);
    expect(s.log.filter((l) => /Counting Angel deals 1 damage/.test(l.text))).toHaveLength(2);
    expect(lifeOf(s, 'p2')).toBe(18);
  });
  it('CR 603.2c: two counters on ONE creature at once are one occurrence ("that much" is 2)', () => {
    const angel = creature('Counting Angel', ['3', '4'], 'Whenever one or more +1/+1 counters are put on a creature you control, this creature deals that much damage to target opponent.');
    const growth = spell('Double Growth', '{0}', 'Put two +1/+1 counters on target creature.', 'Instant');
    let s = scenario(['Grizzly Bears'], { p1: { hand: [growth.name], battlefield: [angel.name, 'Grizzly Bears'] }, defs: [angel, growth] });
    s = resolveTop(cast(s, 'Double Growth', [target(find(s, 'Grizzly Bears', 'battlefield'))]));
    for (let i = 0; i < 10 && (s.zones.stack.length > 0 || (s.pending != null && s.pending.kind !== 'priority')); i++) {
      const d = s.pending;
      if (d?.kind === 'chooseTargets') s = answer(s, target('p2'));
      else s = resolveTop(s);
    }
    expect(s.log.filter((l) => /Counting Angel triggers/.test(l.text))).toHaveLength(1);
    expect(lifeOf(s, 'p2')).toBe(18);
  });
});
