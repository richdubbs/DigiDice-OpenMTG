/**
 * Commander EDHREC ranks 26,501-27,000, round edh-c-94 (third pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 608.2c, 115.1, 120.3       "Tap X target creatures. ~ deals 2 damage to each of those creatures with flying."
 *   CR 602.5b, 303.4              "Activate only during your upkeep and only if ~ isn't enchanted."
 *   CR 502.3, 611.2a              "Creatures don't untap during target player's next untap step." (Blinding Beam, ruling 2013-06-07)
 *   CR 508.1, 603.4, 701.21a      "At the beginning of the end step of enchanted creature's controller, destroy that creature if it didn't attack this turn." and "... that player sacrifices that creature."
 *   CR 509.1c, 611.3a             "As long as there are seven or more cards in your graveyard, all creatures able to block ~ do so."
 *   CR 601.2h, 614.12, 106.1      "If at least three mana of the same color was spent to cast ~, ~ enters with a +1/+1 counter on it." (adamant)
 *   CR 613.4b, 602.5b             "{2}{R}: ~ has base power 8 until end of turn. Activate only if creatures you control have total power 8 or greater."
 *   CR 603.2c, 120.2, 500.1       "Whenever a source you control deals noncombat damage to one or more of your opponents during your turn, ..."
 *   CR 613.4c                     "Citizens you control get an additional +1/+1 and gain vigilance until end of turn."
 *   CR 406.1, 119.3               "Target opponent exiles two cards from their hand and loses 2 life."
 *   CR 509.1a, 604.2, 107.3       "~ can block an additional creature each combat for each Equipment attached to ~."
 *   CR 506.5, 508.1c, 122.1       "~ can't attack alone unless ~ has a +1/+1 counter on ~."
 *   CR 604.1, 611.3a, 613.4c      "Enchanted creature gets +3/+0 as long as it's attacking. Otherwise, it gets -2/-1."
 *   CR 118.12a, 119.4, 701.19c    "Destroy target creature unless its controller pays life equal to its toughness. A creature destroyed this way can't be regenerated."
 */
import { describe, expect, it } from 'vitest';
import { getChars } from '../../../src/index';
import type { GameState, ObjectId } from '../../../src/index';
import { hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, card, cast, drive, find, full, legal, lifeOf, obj, resolveAll, scenario } from '../r4-cost/support';
import { applyAction } from '../../../src/index';
import { declareAttackers, passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';

const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const onBf = (s: GameState, defId: string, p?: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));

describe('CR 608.2c, 115.1, 120.3: "Tap X target creatures. ~ deals 2 damage to each of those creatures with flying."', () => {
  const BLAST = card('Test Cold Gust', 'Sorcery', 'Tap X target creatures. Test Cold Gust deals 2 damage to each of those creatures with flying.', '{X}{G}');
  const BIRD = card('Test Gust Bird', 'Creature — Bird', 'Flying', '{0}', ['2', '5']);
  const BEAR = card('Test Gust Bear', 'Creature — Bear', '', '{0}', ['2', '5']);
  const OTHERBIRD = card('Test Other Bird', 'Creature — Bird', 'Flying', '{0}', ['2', '5']);
  const board = (): GameState => scenario(['Forest'], { defs: [BLAST, BIRD, BEAR, OTHERBIRD], p1: { hand: ['Test Cold Gust'], battlefield: ['Forest', 'Forest', 'Forest'] }, p2: { battlefield: ['Test Gust Bird', 'Test Gust Bear', 'Test Other Bird'] } });
  const run = (s0: GameState, names: string[]): GameState => {
    const ids = names.map((n) => find(s0, n, 'battlefield', 'p2'));
    return resolveAll(cast(s0, 'Test Cold Gust', { targets: [ids.map(obj)], x: [ids.length] }));
  };
  it('is full', () => expect(full(BLAST)).toBe(true));
  it('taps both targets and deals 2 damage only to the one with flying', () => {
    const s = run(board(), ['Test Gust Bird', 'Test Gust Bear']);
    const bird = onBf(s, 'Test Gust Bird')[0]!;
    const bear = onBf(s, 'Test Gust Bear')[0]!;
    expect(s.objects[bird]!.tapped).toBe(true);
    expect(s.objects[bear]!.tapped).toBe(true);
    expect(s.objects[bird]!.damage).toBe(2);
    expect(s.objects[bear]!.damage).toBe(0);
  });
  it('negative: a flying creature that was not targeted takes no damage and stays untapped', () => {
    const s = run(board(), ['Test Gust Bird', 'Test Gust Bear']);
    const other = onBf(s, 'Test Other Bird')[0]!;
    expect(s.objects[other]!.damage).toBe(0);
    expect(s.objects[other]!.tapped).toBe(false);
  });
  it('negative: with no creature that has flying among the targets nothing is damaged', () => {
    const s = run(board(), ['Test Gust Bear']);
    expect(s.zones.battlefield.every((id) => s.objects[id]!.damage === 0)).toBe(true);
    expect(s.objects[onBf(s, 'Test Gust Bear')[0]!]!.tapped).toBe(true);
  });
  it('flying is checked as the spell resolves, and an already tapped target with flying is still hit (ruling 2007-09-16)', () => {
    const s0 = board();
    s0.objects[find(s0, 'Test Gust Bird', 'battlefield', 'p2')]!.tapped = true;
    const s = run(s0, ['Test Gust Bird']);
    expect(s.objects[onBf(s, 'Test Gust Bird')[0]!]!.damage).toBe(2);
  });
});

describe('CR 602.5b, 303.4: "{U}{U}: Return target Aura card from your graveyard to the battlefield attached to ~. Activate only during your upkeep and only if ~ isn\'t enchanted."', () => {
  const SAGE = card('Test Aura Sage', 'Legendary Creature — Human Wizard', 'Flying\n{U}{U}: Return target Aura card from your graveyard to the battlefield attached to Test Aura Sage. Activate only during your upkeep and only if Test Aura Sage isn\'t enchanted.', '{0}', ['2', '2']);
  const BOND = card('Test Aura Bond', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.', '{0}');
  const board = (): GameState => scenario(['Island'], { defs: [SAGE, BOND], p1: { battlefield: ['Test Aura Sage', 'Island', 'Island', 'Island', 'Island'], graveyard: ['Test Aura Bond'] } });
  const activations = (s: GameState): number => legal(s, 'p1', 'activate').filter((a) => a.object === find(s, 'Test Aura Sage', 'battlefield', 'p1') && a.isMana !== true).length;
  it('is full', () => expect(full(SAGE)).toBe(true));
  it('can be activated in its controller\'s upkeep while not enchanted, and returns the Aura attached to it', () => {
    let s = advanceTo(board(), 3, 'upkeep');
    expect(activations(s)).toBeGreaterThan(0);
    const a = legal(s, 'p1', 'activate').find((x) => x.object === find(s, 'Test Aura Sage', 'battlefield', 'p1') && x.isMana !== true)!;
    s = resolveAll(drive(act(s, a.action), { targets: [[obj(find(s, 'Test Aura Bond', 'graveyard', 'p1'))]] }));
    const sage = onBf(s, 'Test Aura Sage')[0]!;
    expect(s.objects[onBf(s, 'Test Aura Bond')[0]!]!.attachedTo).toBe(sage);
    expect(pt(s, sage)).toBe('3/3');
  });
  it('negative: not in the main phase', () => {
    expect(activations(board())).toBe(0);
  });
  it('negative: not while an Aura is attached to it (checked when activating)', () => {
    const s0 = board();
    const bond = find(s0, 'Test Aura Bond', 'graveyard', 'p1');
    s0.zones.graveyard['p1'] = s0.zones.graveyard['p1']!.filter((id) => id !== bond);
    s0.objects[bond]!.zone = 'battlefield';
    s0.objects[bond]!.attachedTo = find(s0, 'Test Aura Sage', 'battlefield', 'p1');
    s0.zones.battlefield.push(bond);
    const s = advanceTo(s0, 3, 'upkeep');
    expect(activations(s)).toBe(0);
  });
  it('negative: not in an opponent\'s upkeep', () => {
    const s = advanceTo(board(), 2, 'upkeep');
    expect(activations(s)).toBe(0);
  });
});

describe('CR 502.3, 611.2a: "Creatures don\'t untap during target player\'s next untap step." (the lock is that player\'s untap step only; ruling 2013-06-07)', () => {
  const BEAM = card('Test Dim Beam', 'Instant', 'Choose one --\n• Tap two target creatures.\n• Creatures don\'t untap during target player\'s next untap step.', '{0}');
  const MUSE = card('Test Dawn Muse', 'Creature — Elf', 'Untap each creature you control during each other player\'s untap step.', '{0}', ['1', '1']);
  const BEAR = card('Test Beam Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const LATE = card('Test Late Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const board = (): GameState => scenario([], { defs: [BEAM, MUSE, BEAR, LATE], p1: { hand: ['Test Dim Beam'], battlefield: [{ name: 'Test Beam Bear', tapped: true }] }, p2: { battlefield: [{ name: 'Test Beam Bear', tapped: true }, { name: 'Test Dawn Muse', tapped: true }] } });
  /** cast the second mode at the given player (p1 itself in these scenarios, so the lock is p1's next untap step) */
  const lockOn = (s0: GameState, target: 'p1' | 'p2'): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Dim Beam', 'hand', 'p1') });
    const p = s.pending;
    if (p?.kind !== 'chooseOption') throw new Error(`expected a mode choice, got ${p?.kind}`);
    const second = p.options.find((o) => /untap/i.test(o.label))!;
    s = answer(s, { kind: 'chooseOption', ids: [second.id] });
    return resolveAll(drive(s, { targets: [[{ kind: 'player', id: target }]] }));
  };
  const tapped = (s: GameState, defId: string, p: string): boolean => s.objects[onBf(s, defId, p)[0]!]!.tapped;
  it('is full', () => expect(full(BEAM)).toBe(true));
  it('the lock holds in the target player\'s next untap step: their Bear stays tapped through turn 3, and untaps in turn 5', () => {
    let s = lockOn(board(), 'p1');
    s = advanceTo(s, 3, 'upkeep');
    expect(tapped(s, 'Test Beam Bear', 'p1')).toBe(true);
    s = advanceTo(s, 5, 'upkeep');
    expect(tapped(s, 'Test Beam Bear', 'p1')).toBe(false);
  });
  it('negative: the other player\'s untap step in between is not locked (their Bear untaps in turn 2)', () => {
    let s = lockOn(board(), 'p1');
    s = advanceTo(s, 2, 'upkeep');
    expect(tapped(s, 'Test Beam Bear', 'p2')).toBe(false);
  });
  it('the lock covers every creature in that untap step, also the ones an opponent untaps with an "each other player\'s untap step" effect (ruling 2013-06-07)', () => {
    let s = advanceTo(lockOn(board(), 'p1'), 2, 'main1');
    for (const id of [...onBf(s, 'Test Dawn Muse', 'p2'), ...onBf(s, 'Test Beam Bear', 'p2')]) s.objects[id]!.tapped = true; // tapped again in their own turn
    s = advanceTo(s, 3, 'upkeep');
    expect(tapped(s, 'Test Dawn Muse', 'p2')).toBe(true);
    expect(tapped(s, 'Test Beam Bear', 'p2')).toBe(true);
    s = advanceTo(s, 4, 'main1');
    for (const id of [...onBf(s, 'Test Dawn Muse', 'p2'), ...onBf(s, 'Test Beam Bear', 'p2')]) s.objects[id]!.tapped = true;
    s = advanceTo(s, 5, 'upkeep');
    expect(tapped(s, 'Test Dawn Muse', 'p2')).toBe(false); // the lock is over: their effect untaps them in p1's untap step again
    expect(tapped(s, 'Test Beam Bear', 'p2')).toBe(false);
  });
  it('a creature that entered after the spell resolved is locked too', () => {
    const s0 = lockOn(board(), 'p1');
    const late = structuredClone(s0);
    const id = `o${late.counters.object++}`;
    late.objects[id] = { ...late.objects[find(s0, 'Test Beam Bear', 'battlefield', 'p1')]!, id, defId: 'Test Late Bear', cardId: `c${late.counters.card++}`, tapped: true };
    late.zones.battlefield.push(id);
    const s = advanceTo(late, 3, 'upkeep');
    expect(s.objects[id]!.tapped).toBe(true);
    expect(advanceTo(s, 5, 'upkeep').objects[id]!.tapped).toBe(false);
  });
  it('aimed at the opponent: p2\'s creatures stay tapped in turn 2 and p1\'s untap in turn 3', () => {
    let s = lockOn(board(), 'p2');
    s = advanceTo(s, 2, 'upkeep');
    expect(tapped(s, 'Test Beam Bear', 'p2')).toBe(true);
    s = advanceTo(s, 3, 'upkeep');
    expect(tapped(s, 'Test Beam Bear', 'p1')).toBe(false);
  });
});

describe('CR 508.1, 603.4, 701.21a: "At the beginning of the end step of enchanted creature\'s controller, destroy that creature if it didn\'t attack this turn." / "..., that player sacrifices that creature."', () => {
  const BRAND = card('Test Fury Brand', 'Enchantment — Aura', 'Enchant non-Wall creature\nEnchanted creature has first strike and trample.\nAt the beginning of the end step of enchanted creature\'s controller, destroy that creature if it didn\'t attack this turn.', '{0}');
  const DEATH = card('Test Slow Rot', 'Enchantment — Aura', 'Enchant creature\nAt the beginning of the end step of enchanted creature\'s controller, that player sacrifices that creature.', '{0}');
  const BEAR = card('Test Brand Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const board = (aura: string, host: 'p1' | 'p2'): { s: GameState; bear: ObjectId } => {
    const s0 = scenario([], { defs: [BRAND, DEATH, BEAR], p1: { hand: [aura], battlefield: host === 'p1' ? ['Test Brand Bear', 'Test Brand Bear'] : [] }, p2: { battlefield: host === 'p2' ? ['Test Brand Bear'] : [] } });
    const bear = onBf(s0, 'Test Brand Bear', host)[0]!;
    return { s: resolveAll(cast(s0, aura, { targets: [[obj(bear)]] })), bear };
  };
  it('both are full', () => { expect(full(BRAND)).toBe(true); expect(full(DEATH)).toBe(true); });
  it('Aggression-like: a creature that did not attack is destroyed at the end step of its controller (an opponent\'s creature, at their turn\'s end)', () => {
    const { s: s0, bear } = board('Test Fury Brand', 'p2');
    let s = advanceTo(s0, 2, 'main2');
    expect(s.zones.battlefield).toContain(bear);
    s = resolveAll(advanceTo(s, 2, 'end'));
    expect(s.zones.battlefield).not.toContain(bear);
    expect(s.zones.graveyard['p2']!.map((id) => s.objects[id]!.defId)).toContain('Test Brand Bear');
  });
  it('negative: not at the end step of the Aura\'s controller (turn 1 end step with the bear on the other side)', () => {
    const { s: s0, bear } = board('Test Fury Brand', 'p2');
    const s = resolveAll(advanceTo(s0, 1, 'end'));
    expect(s.zones.battlefield).toContain(bear);
  });
  it('negative: a creature that attacked this turn is not destroyed, the one that stayed home is (two bears of the Aura\'s own controller, one enchanted: the attacked one)', () => {
    const s0 = (() => {
      const base = scenario([], { defs: [BRAND, DEATH, BEAR], p1: { hand: ['Test Fury Brand'], battlefield: ['Test Brand Bear', 'Test Brand Bear'] }, p2: {} });
      return base;
    })();
    const [a, b] = onBf(s0, 'Test Brand Bear', 'p1') as [ObjectId, ObjectId];
    let s = resolveAll(cast(s0, 'Test Fury Brand', { targets: [[obj(a)]] }));
    s = resolveAll(passUntil(declareAttackers(toDeclareAttackers(s), [[a]]), (x) => x.turn.step === 'end' && x.pending?.kind === 'priority', 'end'));
    expect(s.zones.battlefield).toContain(a);
    expect(s.zones.battlefield).toContain(b);
    // the same Aura on the bear that did not attack
    let t = resolveAll(cast(s0, 'Test Fury Brand', { targets: [[obj(b)]] }));
    t = resolveAll(passUntil(declareAttackers(toDeclareAttackers(t), [[a]]), (x) => x.turn.step === 'end' && x.pending?.kind === 'priority', 'end'));
    expect(t.zones.battlefield).not.toContain(b);
    expect(t.zones.battlefield).toContain(a);
  });
  it('Lingering Death-like: the enchanted creature\'s controller sacrifices it at their end step', () => {
    const { s: s0, bear } = board('Test Slow Rot', 'p2');
    const s = resolveAll(advanceTo(s0, 2, 'end'));
    expect(s.zones.battlefield).not.toContain(bear);
    expect(s.zones.graveyard['p2']!.map((id) => s.objects[id]!.defId)).toContain('Test Brand Bear');
  });
  it('negative: it is not sacrificed at the end step of the Aura\'s controller, nor are the controller\'s other creatures sacrificed', () => {
    const { s: s0, bear } = board('Test Slow Rot', 'p2');
    const s = resolveAll(advanceTo(s0, 1, 'end'));
    expect(s.zones.battlefield).toContain(bear);
  });
});

describe('CR 603.2, 113.7a, 608.2h: the end-step trigger of an Aura still destroys / sacrifices the creature its source was enchanting when the Aura has left the battlefield before the trigger resolves', () => {
  const BRAND = card('Test Fury Brand', 'Enchantment — Aura', 'Enchant non-Wall creature\nAt the beginning of the end step of enchanted creature\'s controller, destroy that creature if it didn\'t attack this turn.', '{0}');
  const DEATH = card('Test Slow Rot', 'Enchantment — Aura', 'Enchant creature\nAt the beginning of the end step of enchanted creature\'s controller, that player sacrifices that creature.', '{0}');
  const BEAR = card('Test Brand Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const SMASH = card('Test Disenchant', 'Instant', 'Destroy target enchantment.', '{0}');
  for (const aura of ['Test Fury Brand', 'Test Slow Rot']) {
    it(`${aura}: the Aura is destroyed in response, the creature still goes`, () => {
      const s0 = scenario([], { defs: [BRAND, DEATH, BEAR, SMASH], p1: { hand: [aura] }, p2: { battlefield: ['Test Brand Bear'], hand: ['Test Disenchant'] } });
      const bear = onBf(s0, 'Test Brand Bear', 'p2')[0]!;
      let s = resolveAll(cast(s0, aura, { targets: [[obj(bear)]] }));
      s = advanceTo(s, 2, 'end');
      expect(s.zones.stack.length).toBe(1);
      s = resolveAll(cast(s, 'Test Disenchant', { targets: [[obj(onBf(s, aura)[0]!)]] }, 'p2'));
      expect(onBf(s, aura)).toEqual([]);
      expect(s.zones.battlefield).not.toContain(bear);
    });
  }
});

describe('CR 509.1c, 611.3a: "As long as there are seven or more cards in your graveyard, all creatures able to block ~ do so."', () => {
  const LURE = card('Test Lure Basilisk', 'Creature — Basilisk', 'As long as there are seven or more cards in your graveyard, all creatures able to block Test Lure Basilisk do so.', '{0}', ['3', '3']);
  const OGRE = card('Test Wall Ogre', 'Creature — Ogre', '', '{0}', ['2', '2']);
  const FILLER = card('Test Filler Spell', 'Sorcery', 'You gain 1 life.');
  const reply = (s: GameState, a: Parameters<typeof answer>[1]) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: a });
  const toBlocks = (n: number): { s: GameState; id: ObjectId } => {
    const s0 = scenario([], { defs: [LURE, OGRE, FILLER], p1: { battlefield: ['Test Lure Basilisk'], graveyard: Array<string>(n).fill('Test Filler Spell') }, p2: { battlefield: ['Test Wall Ogre', 'Test Wall Ogre'] } });
    const id = find(s0, 'Test Lure Basilisk', 'battlefield', 'p1');
    return { s: passUntil(declareAttackers(toDeclareAttackers(s0), [[id]]), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers'), id };
  };
  it('is full', () => expect(full(LURE)).toBe(true));
  it('with seven cards in the graveyard no blockers declared is refused, both ogres blocking is accepted', () => {
    const { s, id } = toBlocks(7);
    expect(s.pending?.kind).toBe('declareBlockers');
    expect(applyAction(s, reply(s, { kind: 'declareBlockers', blocks: [] })).error).toBeDefined();
    const [a, b] = onBf(s, 'Test Wall Ogre', 'p2');
    expect(applyAction(s, reply(s, { kind: 'declareBlockers', blocks: [a!, b!].map((blocker) => ({ blocker, attacker: id })) })).error).toBeUndefined();
  });
  it('negative: with six cards nobody has to block', () => {
    const { s } = toBlocks(6);
    expect(s.pending?.kind).toBe('declareBlockers');
    expect(applyAction(s, reply(s, { kind: 'declareBlockers', blocks: [] })).error).toBeUndefined();
  });
});

describe('CR 601.2h, 614.12, 106.1: "If at least three mana of the same color was spent to cast ~, ~ enters with a +1/+1 counter on it." (adamant of any one color)', () => {
  const WALKER = card('Test Prism Walker', 'Artifact Creature — Golem', 'Adamant -- If at least three mana of the same color was spent to cast this spell, this creature enters with a +1/+1 counter on it.', '{3}', ['3', '3']);
  const run = (lands: string[]): GameState => resolveAll(cast(scenario(['Plains', 'Island', 'Swamp', 'Mountain'], { defs: [WALKER], p1: { hand: ['Test Prism Walker'], battlefield: lands } }), 'Test Prism Walker'));
  const counters = (s: GameState): number => s.objects[onBf(s, 'Test Prism Walker')[0]!]!.counters['+1/+1'] ?? 0;
  it('is full', () => expect(full(WALKER)).toBe(true));
  it('three white mana: it enters with the counter (4/4)', () => {
    const s = run(['Plains', 'Plains', 'Plains']);
    expect(counters(s)).toBe(1);
    expect(pt(s, onBf(s, 'Test Prism Walker')[0]!)).toBe('4/4');
  });
  it('three red mana, too (any one color)', () => {
    expect(counters(run(['Mountain', 'Mountain', 'Mountain']))).toBe(1);
  });
  it('negative: three mana of three colors', () => {
    expect(counters(run(['Plains', 'Island', 'Swamp']))).toBe(0);
  });
  it('negative: two mana of one color and one of another', () => {
    expect(counters(run(['Plains', 'Plains', 'Island']))).toBe(0);
  });
});

describe('CR 613.4b, 602.5b, 208.1: "{2}{R}: ~ has base power 8 until end of turn. Activate only if creatures you control have total power 8 or greater."', () => {
  const BRUTE = card('Test Crag Brute', 'Creature — Elemental', '{2}{R}: Test Crag Brute has base power 8 until end of turn. Activate only if creatures you control have total power 8 or greater.', '{0}', ['3', '3']);
  const FATTY = card('Test Big Friend', 'Creature — Giant', '', '{0}', ['5', '5']);
  const SMALL = card('Test Small Friend', 'Creature — Giant', '', '{0}', ['2', '2']);
  const board = (friend: string): GameState => scenario(['Mountain'], { defs: [BRUTE, FATTY, SMALL], p1: { battlefield: ['Test Crag Brute', friend, 'Mountain', 'Mountain', 'Mountain'] } });
  const activate = (s: GameState): GameState | null => {
    const a = legal(s, 'p1', 'activate').find((x) => x.object === find(s, 'Test Crag Brute', 'battlefield', 'p1') && x.isMana !== true);
    return a === undefined ? null : resolveAll(drive(act(s, a.action)));
  };
  it('is full', () => expect(full(BRUTE)).toBe(true));
  it('with total power 8 (3 + 5) it can be activated: base power 8, toughness unchanged, until end of turn', () => {
    const s = activate(board('Test Big Friend'))!;
    expect(pt(s, onBf(s, 'Test Crag Brute')[0]!)).toBe('8/3');
  });
  it('base power only: a +1/+1 counter on it still counts on top of the 8', () => {
    const s0 = board('Test Big Friend');
    s0.objects[find(s0, 'Test Crag Brute', 'battlefield', 'p1')]!.counters['+1/+1'] = 1;
    const s = activate(s0)!;
    expect(pt(s, onBf(s, 'Test Crag Brute')[0]!)).toBe('9/4');
  });
  it('negative: with total power 5 (3 + 2) it cannot be activated', () => {
    expect(activate(board('Test Small Friend'))).toBeNull();
  });
  it('negative: an opponent\'s creatures do not count towards the total', () => {
    const s0 = scenario(['Mountain'], { defs: [BRUTE, FATTY], p1: { battlefield: ['Test Crag Brute', 'Mountain', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Test Big Friend'] } });
    expect(activate(s0)).toBeNull();
  });
});

describe('CR 603.2c, 120.2, 500.1: "Whenever a source you control deals noncombat damage to one or more of your opponents during your turn, you create a 1/1 red Elemental creature token. This ability triggers only once each turn."', () => {
  const MANCER = card('Test Spark Warlock', 'Creature — Elemental Warlock', 'Whenever a source you control deals noncombat damage to one or more of your opponents during your turn, you create a 1/1 red Elemental creature token. This ability triggers only once each turn.', '{0}', ['1', '1']);
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 2 damage to target opponent.');
  const ZAPBEAR = card('Test Zap Bear', 'Instant', 'Test Zap Bear deals 2 damage to target creature.');
  const BEAR = card('Test Spark Bear', 'Creature — Bear', '', '{0}', ['4', '4']);
  const board = (): GameState => scenario([], { defs: [MANCER, ZAP, ZAPBEAR, BEAR], p1: { battlefield: ['Test Spark Warlock'], hand: ['Test Zap', 'Test Zap', 'Test Zap Bear'] }, p2: { battlefield: ['Test Spark Bear'] } });
  const elementals = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length;
  const zap = (s: GameState): GameState => resolveAll(cast(s, 'Test Zap', { targets: [[{ kind: 'player', id: 'p2' }]] }));
  it('is full', () => expect(full(MANCER)).toBe(true));
  it('2 damage to an opponent in your turn makes one token', () => {
    const s = zap(board());
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(elementals(s)).toBe(1);
  });
  it('a second source the same turn makes no second token (once each turn)', () => {
    const s = zap(zap(board()));
    expect(lifeOf(s, 'p2')).toBe(16);
    expect(elementals(s)).toBe(1);
  });
  it('negative: damage to a creature is no damage to an opponent', () => {
    const s0 = board();
    const s = resolveAll(cast(s0, 'Test Zap Bear', { targets: [[obj(find(s0, 'Test Spark Bear', 'battlefield', 'p2'))]] }));
    expect(elementals(s)).toBe(0);
  });
  it('negative: not in an opponent\'s turn', () => {
    let s = advanceTo(board(), 2, 'upkeep');
    s = pass2(s);
    s = zap(s);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(elementals(s)).toBe(0);
  });
  /** the active player (p2) passes priority: the player with the Zap gets it */
  function pass2(s: GameState): GameState {
    return s.pending?.player === 'p1' ? s : act(s, { type: 'pass', player: s.pending!.player });
  }
});

describe('CR 613.4c, 611.2a: "Creatures you control get +2/+2 until end of turn. Citizens you control get an additional +1/+1 and gain vigilance until end of turn."', () => {
  const RALLY = card('Test Rally Cry', 'Sorcery', 'Creatures you control get +2/+2 until end of turn. Citizens you control get an additional +1/+1 and gain vigilance until end of turn.', '{0}');
  const CITIZEN = card('Test Citizen', 'Creature — Human Citizen', '', '{0}', ['2', '2']);
  const BEAR = card('Test Rally Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const board = (): GameState => resolveAll(cast(scenario([], { defs: [RALLY, CITIZEN, BEAR], p1: { hand: ['Test Rally Cry'], battlefield: ['Test Citizen', 'Test Rally Bear'] }, p2: { battlefield: ['Test Citizen'] } }), 'Test Rally Cry'));
  it('is full', () => expect(full(RALLY)).toBe(true));
  it('your Citizen gets +3/+3 in all (2 and 1) and vigilance, your Bear +2/+2', () => {
    const s = board();
    const c = onBf(s, 'Test Citizen', 'p1')[0]!;
    expect(pt(s, c)).toBe('5/5');
    expect(hasKeyword(getChars(s, c)!, 'vigilance')).toBe(true);
    const b = onBf(s, 'Test Rally Bear', 'p1')[0]!;
    expect(pt(s, b)).toBe('4/4');
    expect(hasKeyword(getChars(s, b)!, 'vigilance')).toBe(false);
  });
  it('negative: an opponent\'s Citizen is untouched', () => {
    const s = board();
    const c = onBf(s, 'Test Citizen', 'p2')[0]!;
    expect(pt(s, c)).toBe('2/2');
    expect(hasKeyword(getChars(s, c)!, 'vigilance')).toBe(false);
  });
});

describe('CR 406.1, 119.3, 608.2d: "Target opponent exiles two cards from their hand and loses 2 life." (ruling 2016-01-22)', () => {
  const WHISPER = card('Test Void Whisper', 'Sorcery', 'Devoid\nTarget opponent exiles two cards from their hand and loses 2 life.', '{0}');
  const FILLER = card('Test Hand Filler', 'Sorcery', 'You gain 1 life.');
  const run = (n: number): GameState => resolveAll(cast(scenario([], { defs: [WHISPER, FILLER], p1: { hand: ['Test Void Whisper'] }, p2: { hand: Array<string>(n).fill('Test Hand Filler') } }), 'Test Void Whisper', { targets: [[{ kind: 'player', id: 'p2' }]] }));
  it('is full', () => expect(full(WHISPER)).toBe(true));
  it('three cards in hand: two are exiled (their choice) and they lose 2 life', () => {
    const s = run(3);
    expect(s.zones.exile).toHaveLength(2);
    expect(s.zones.hand['p2']).toHaveLength(1);
    expect(lifeOf(s, 'p2')).toBe(18);
  });
  it('one card in hand: that card is exiled and they still lose 2 life', () => {
    const s = run(1);
    expect(s.zones.exile).toHaveLength(1);
    expect(lifeOf(s, 'p2')).toBe(18);
  });
  it('negative: no cards in hand, nothing is exiled and they still lose 2 life; the caster loses nothing and exiles nothing', () => {
    const s = run(0);
    expect(s.zones.exile).toHaveLength(0);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

describe('CR 509.1a, 509.1b, 604.2: "~ can block an additional creature each combat for each Equipment attached to ~."', () => {
  const LEGION = card('Test Kit Legion', 'Creature — Cat Soldier', 'This creature can block an additional creature each combat for each Equipment attached to this creature.', '{0}', ['3', '3']);
  const SWORD = card('Test Kit Sword', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {1}', '{0}');
  const BEAR = card('Test Kit Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const reply = (s: GameState, a: Parameters<typeof answer>[1]) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: a });
  const toBlocks = (equipment: number): { s: GameState; attackers: ObjectId[]; legion: ObjectId } => {
    const s0 = scenario([], { defs: [LEGION, SWORD, BEAR], p1: { battlefield: ['Test Kit Bear', 'Test Kit Bear', 'Test Kit Bear'] }, p2: { battlefield: ['Test Kit Legion', ...Array<string>(equipment).fill('Test Kit Sword')] } });
    const legion = find(s0, 'Test Kit Legion', 'battlefield', 'p2');
    const s1 = tweak(s0, (t) => { for (const id of onBf(t, 'Test Kit Sword', 'p2')) t.objects[id]!.attachedTo = legion; });
    const attackers = onBf(s1, 'Test Kit Bear', 'p1');
    return { s: passUntil(declareAttackers(toDeclareAttackers(s1), attackers.map((a) => [a] as [ObjectId])), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers'), attackers, legion };
  };
  const blocks = (s: GameState, legion: ObjectId, attackers: ObjectId[]) => applyAction(s, reply(s, { kind: 'declareBlockers', blocks: attackers.map((attacker) => ({ blocker: legion, attacker })) })).error;
  it('is full', () => expect(full(LEGION)).toBe(true));
  it('with no Equipment it blocks one creature, not two', () => {
    const { s, attackers, legion } = toBlocks(0);
    expect(s.pending?.kind).toBe('declareBlockers');
    expect(blocks(s, legion, attackers.slice(0, 1))).toBeUndefined();
    expect(blocks(s, legion, attackers.slice(0, 2))).toBeDefined();
  });
  it('with one Equipment attached it blocks two creatures, not three', () => {
    const { s, attackers, legion } = toBlocks(1);
    expect(blocks(s, legion, attackers.slice(0, 2))).toBeUndefined();
    expect(blocks(s, legion, attackers)).toBeDefined();
  });
  it('with two Equipment attached it blocks all three attackers', () => {
    const { s, attackers, legion } = toBlocks(2);
    expect(blocks(s, legion, attackers)).toBeUndefined();
  });
  it('negative: Equipment an opponent controls but that is not attached to it does not count', () => {
    const s0 = scenario([], { defs: [LEGION, SWORD, BEAR], p1: { battlefield: ['Test Kit Bear', 'Test Kit Bear', 'Test Kit Sword'] }, p2: { battlefield: ['Test Kit Legion'] } });
    const attackers = onBf(s0, 'Test Kit Bear', 'p1');
    const s = passUntil(declareAttackers(toDeclareAttackers(s0), attackers.map((a) => [a] as [ObjectId])), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers');
    expect(blocks(s, onBf(s, 'Test Kit Legion', 'p2')[0]!, attackers)).toBeDefined();
  });
});

describe('CR 506.5, 508.1c, 122.1: "~ can\'t attack alone unless ~ has a +1/+1 counter on ~."', () => {
  const PIP = card('Test Pip Rebel', 'Legendary Creature — Human Rebel', 'Test Pip Rebel can\'t attack alone unless he has a +1/+1 counter on him.', '{0}', ['2', '2']);
  const BEAR = card('Test Pip Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const board = (counter: boolean): GameState => scenario([], { defs: [PIP, BEAR], p1: { battlefield: [counter ? { name: 'Test Pip Rebel', counters: { '+1/+1': 1 } } : 'Test Pip Rebel', 'Test Pip Bear'] } });
  const attack = (s0: GameState, who: string[]) => {
    const s = toDeclareAttackers(s0);
    const ids = who.map((n) => onBf(s, n, 'p1')[0]!);
    return applyAction(s, { type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: ids.map((attacker) => ({ attacker, defender: 'p2' })) } }).error;
  };
  it('is full', () => expect(full(PIP)).toBe(true));
  it('without a +1/+1 counter it cannot attack alone, but can with another creature', () => {
    expect(attack(board(false), ['Test Pip Rebel'])).toBeDefined();
    expect(attack(board(false), ['Test Pip Rebel', 'Test Pip Bear'])).toBeUndefined();
  });
  it('with a +1/+1 counter it attacks alone', () => {
    expect(attack(board(true), ['Test Pip Rebel'])).toBeUndefined();
  });
  it('negative: another creature attacking alone is unaffected', () => {
    expect(attack(board(false), ['Test Pip Bear'])).toBeUndefined();
  });
});

describe('CR 604.1, 611.3a, 613.4c: "Enchanted creature gets +3/+0 as long as it\'s attacking. Otherwise, it gets -2/-1."', () => {
  const RAGE = card('Test Fierce Mantle', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +3/+0 as long as it\'s attacking. Otherwise, it gets -2/-1.', '{0}');
  const BEAR = card('Test Mantle Bear', 'Creature — Bear', '', '{0}', ['3', '3']);
  const board = (): { s: GameState; bear: ObjectId } => {
    const s0 = scenario([], { defs: [RAGE, BEAR], p1: { hand: ['Test Fierce Mantle'], battlefield: ['Test Mantle Bear', 'Test Mantle Bear'] } });
    const [bear] = onBf(s0, 'Test Mantle Bear', 'p1') as [ObjectId, ObjectId];
    return { s: resolveAll(cast(s0, 'Test Fierce Mantle', { targets: [[obj(bear)]] })), bear };
  };
  it('is full', () => expect(full(RAGE)).toBe(true));
  it('not attacking: 1/2', () => {
    const { s, bear } = board();
    expect(pt(s, bear)).toBe('1/2');
  });
  it('attacking: 6/3, and 1/2 again once it is no longer attacking (end of combat)', () => {
    const { s: s0, bear } = board();
    let s = passUntil(declareAttackers(toDeclareAttackers(s0), [[bear]]), (x) => x.turn.step === 'declareAttackers' || x.turn.step === 'declareBlockers' || x.pending?.kind === 'declareBlockers', 'attacking');
    expect(pt(s, bear)).toBe('6/3');
    s = passUntil(s, (x) => x.turn.step === 'main2', 'main2');
    expect(pt(s, bear)).toBe('1/2');
  });
  it('negative: the other creature (not enchanted) is unaffected whether or not it attacks', () => {
    const { s, bear } = board();
    const other = onBf(s, 'Test Mantle Bear', 'p1').find((id) => id !== bear)!;
    expect(pt(s, other)).toBe('3/3');
  });
});

describe('CR 118.12a, 119.4, 701.19c: "Destroy target creature unless its controller pays life equal to its toughness. A creature destroyed this way can\'t be regenerated."', () => {
  const VORTEX = card('Test Vortex Spell', 'Instant', 'Destroy target creature unless its controller pays life equal to its toughness. A creature destroyed this way can\'t be regenerated.', '{0}');
  const OGRE = card('Test Vortex Ogre', 'Creature — Ogre', '{G}: Regenerate Test Vortex Ogre.', '{0}', ['3', '4']);
  const run = (pay: boolean, life?: number): GameState => {
    const s0 = scenario([], { defs: [VORTEX, OGRE], p1: { hand: ['Test Vortex Spell'] }, p2: { battlefield: ['Test Vortex Ogre'] } });
    if (life !== undefined) s0.players.find((p) => p.id === 'p2')!.life = life;
    return resolveAll(cast(s0, 'Test Vortex Spell', { targets: [[obj(find(s0, 'Test Vortex Ogre', 'battlefield', 'p2'))]] }), { yes: [pay] });
  };
  it('is full', () => expect(full(VORTEX)).toBe(true));
  it('the controller pays 4 life (the Ogre\'s toughness): it survives and they have lost 4', () => {
    const s = run(true);
    expect(onBf(s, 'Test Vortex Ogre')).toHaveLength(1);
    expect(lifeOf(s, 'p2')).toBe(16);
  });
  it('negative: they decline: it is destroyed, their life is untouched', () => {
    const s = run(false);
    expect(onBf(s, 'Test Vortex Ogre')).toHaveLength(0);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('negative: with 3 life they cannot pay 4 (CR 119.4), so it is destroyed whatever they answer, and their life is untouched', () => {
    const s = run(true, 3);
    expect(onBf(s, 'Test Vortex Ogre')).toHaveLength(0);
    expect(lifeOf(s, 'p2')).toBe(3);
  });
  it('the destroy cannot be regenerated: the regeneration restriction is on the destroy step', () => {
    expect(JSON.stringify(VORTEX.faces)).toContain('"regeneration":"cant"');
  });
});
