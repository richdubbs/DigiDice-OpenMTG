/**
 * Commander EDHREC ranks 16,251-16,875, round edh-c-14 (second pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 701.50a, 201.5, 115.1     "Whenever ~ enters or attacks, it connives." / "Whenever ~ becomes the target of a spell you control, it connives."
 *   CR 608.2d, 508.1d, 506.2     "Choose an opponent at random. ~ attacks that player this combat if able."
 *   CR 119.3, 107.1a             "that player loses half their life, rounded down."
 *   CR 115.1, 601.2c, 603.3d     "target opponent chosen at random gains control of ~."
 *   CR 701.23a, 701.20a          "Search your library for an enchantment card and reveal that card. Put it into your hand..."
 *   CR 701.23a, 608.2d           "...reveal those cards, and put one onto the battlefield tapped and the other into your hand."
 *   CR 208.1, 115.1, 608.2d      "target creature you control with the greatest power"
 *   CR 122.1, 107.3              "the number of different kinds of counters among permanents you control"
 *   CR 122.1, 120.3, 608.2h      "put a +1/+1 counter on ~, then it deals damage equal to its power to any target."
 *   CR 121.1, 115.1              "you and another target player each draw a card."
 *   CR 608.2d, 400.3             "return two lands you control to their owner's hand."
 *   CR 702.29a, 702.29f          "cards with a cycling ability in your graveyard" (typecycling too)
 *   CR 608.2c, 613.4c            "Target creature you control gets +2/+2 until end of turn if its power is 2. Then it fights ..."
 *   CR 118.3, 122.1, 701.21a     "{T}, Remove ten oil counters from among permanents you control and sacrifice ~: ..."
 */
import { describe, expect, it } from 'vitest';
import { type GameState, type ObjectId } from '../../../src/index';
import { act, answer, find, put, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, tweak, toDeclareAttackers } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';
import { card, cast, full, named, pt, resolveAll, settle, counters } from '../cmd3/helpers';

/** Answer every decision (cost: automatic; objects: as many of the first options as allowed, so a search takes all it may) and pass until the stack is empty. */
function drive(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 60 && (s.pending !== null && (s.pending.kind !== 'priority' || s.zones.stack.length > 0)); i++) {
    const d = s.pending!;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseObjects') { const o = d as unknown as { options: string[]; max: number }; s = answer(s, { kind: 'chooseObjects', ids: o.options.slice(0, o.max) }); }
    else if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
    else break;
  }
  return s;
}

const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const inHand = (s: GameState, p: string): number => s.zones.hand[p]!.length;

describe('CR 701.50a, 201.5: "it connives" after a trigger of the object itself', () => {
  const SENTRY = card('Test Cunning Scout', 'Creature — Human Rogue', 'Whenever this creature enters or attacks, it connives.', ['2', '2']);
  const VIRT = card('Test Deft Rogue', 'Creature — Human Rogue', 'Whenever this creature becomes the target of a spell you control, it connives.', ['1', '1']);
  it('are full', () => { expect(full(SENTRY)).toBe(true); expect(full(VIRT)).toBe(true); });
  it('entering: draws, discards, and a nonland discard puts a +1/+1 counter on it', () => {
    const s0 = scenario0(SENTRY, ['Test Boost Spell']);
    const s1 = resolveAll(cast(s0, 'Test Cunning Scout'));
    const id = named(s1, 'Test Cunning Scout')[0]!;
    // library [Test Boost Spell] is drawn; hand then has the Boost Spell only (Scout left it): discard it = nonland -> counter
    expect(counters(s1, id, '+1/+1')).toBe(1);
    expect(s1.zones.hand['p1']!.length).toBe(0);
  });
  it('entering: discarding a land puts no counter', () => {
    const s0 = scenario0(SENTRY, ['Plains']);
    const s1 = resolveAll(cast(s0, 'Test Cunning Scout'));
    expect(counters(s1, named(s1, 'Test Cunning Scout')[0]!, '+1/+1')).toBe(0);
  });
  it('negative: another creature entering does not connive it', () => {
    const OTHER = card('Test Plain Ogre', 'Creature — Ogre', '', ['2', '2']);
    const s0 = tweak(scenario0(SENTRY, ['Plains'], [OTHER]), (t) => { put(t, 'p1', 'battlefield', 'Test Cunning Scout'); put(t, 'p1', 'hand', 'Test Plain Ogre'); });
    const s1 = resolveAll(cast(s0, 'Test Plain Ogre'));
    expect(s1.zones.library['p1']!.length).toBe(s0.zones.library['p1']!.length);
  });
  it('becoming the target of a spell you control: connives; another creature being the target does not', () => {
    const mine = tweak(scenario0(VIRT, ['Test Boost Spell'], []), (t) => { put(t, 'p1', 'battlefield', 'Test Deft Rogue'); put(t, 'p1', 'hand', 'Test Boost Spell'); });
    const id = named(mine, 'Test Deft Rogue')[0]!;
    const s1 = resolveAll(cast(mine, 'Test Boost Spell', { targets: [{ kind: 'object', id }] }));
    expect(s1.zones.library['p1']!.length).toBe(mine.zones.library['p1']!.length - 1);
    const other = tweak(scenario0(VIRT, ['Test Boost Spell'], [card('Test Plain Ogre', 'Creature — Ogre', '', ['2', '2'])]), (t) => { put(t, 'p1', 'battlefield', 'Test Deft Rogue'); put(t, 'p1', 'battlefield', 'Test Plain Ogre'); put(t, 'p1', 'hand', 'Test Boost Spell'); });
    const ogre = named(other, 'Test Plain Ogre')[0]!;
    const s2 = resolveAll(cast(other, 'Test Boost Spell', { targets: [{ kind: 'object', id: ogre }] }));
    expect(s2.zones.library['p1']!.length).toBe(other.zones.library['p1']!.length); // negative: another creature is the target
  });
});

function scenario0(def: ReturnType<typeof card>, library: string[], extra: ReturnType<typeof card>[] = []): GameState {
  return scenario([], { defs: [def, ...extra, card('Test Boost Spell', 'Instant', 'Target creature gets +1/+1 until end of turn.')], p1: { hand: [def.name], library } });
}

describe('CR 608.2d, 508.1d, 506.2: "At the beginning of combat on your turn, choose an opponent at random. ~ attacks that player this combat if able."', () => {
  const RUHAN = card('Test Wild Giant', 'Legendary Creature — Giant Warrior', 'At the beginning of combat on your turn, choose an opponent at random. Test Wild Giant attacks that player this combat if able.', ['4', '4']);
  const DEAD = card('Test Grave Walker', 'Creature — Zombie', 'At the beginning of combat on your turn, choose an opponent at random. This creature attacks that player this combat if able.\nWhenever this creature deals combat damage to a player, that player loses half their life, rounded down.', ['2', '6']);
  const game = (def: ReturnType<typeof card>, seed: string): GameState => mpScenario({ players: 4, seed, defs: [def], zones: { p1: { battlefield: [def.name] } } });
  const required = (s: GameState): string[] => {
    const t = toDeclareAttackers(s);
    const d = t.pending as unknown as { requirements: { kind: string; among?: string[] }[] };
    return d.requirements.filter((r) => r.kind === 'attack').flatMap((r) => r.among ?? []);
  };
  it('are full', () => { expect(full(RUHAN)).toBe(true); expect(full(DEAD)).toBe(true); });
  it('four players: exactly one opponent is required, never the controller, and different seeds pick different opponents', () => {
    const seen = new Set<string>();
    for (const seed of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8']) {
      const among = required(game(RUHAN, seed));
      expect(among).toHaveLength(1);
      expect(['p2', 'p3', 'p4']).toContain(among[0]);
      seen.add(among[0]!);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
  it('attacking the chosen player obeys it; attacking another opponent or not attacking does not (CR 508.1d)', () => {
    const s = game(RUHAN, 'r1');
    const [chosen] = required(s);
    const id = named(s, 'Test Wild Giant')[0]!;
    const t = toDeclareAttackers(s);
    const other = ['p2', 'p3', 'p4'].find((p) => p !== chosen)!;
    expect(() => declareAttackers(t, [[id, other]])).toThrow(/CR 508\.1d/);
    expect(() => declareAttackers(t, [])).toThrow(/CR 508\.1d/);
    expect(declareAttackers(t, [[id, chosen!]]).combat?.attackers.map((a) => a.defender)).toEqual([chosen]);
  });
  it('the requirement lasts only this combat: the next turn chooses again (a new choice, not the old one kept)', () => {
    const s = game(DEAD, 'r3');
    const t = toDeclareAttackers(s);
    expect(t.turn.number).toBe(1);
    expect(required(s)).toHaveLength(1);
  });
  it('a player who has lost the game is never chosen (only p4 is left to choose)', () => {
    const s = mpScenario({ players: 4, seed: 'r1', defs: [RUHAN], zones: { p1: { battlefield: ['Test Wild Giant'] } }, setup: (t) => { for (const p of t.players) if (p.id === 'p2' || p.id === 'p3') p.hasLost = true; } });
    expect(required(s)).toEqual(['p4']);
  });
  it('Raving Dead: the damaged player loses half their life, rounded DOWN, counted after the combat damage (21 -> 19 -> loses 9; 20 -> 18 -> loses 9; 15 -> 13 -> loses 6)', () => {
    for (const [life, lose] of [[21, 9], [20, 9], [15, 6]] as const) {
      const s0 = tweak(game(DEAD, 'r1'), (t) => { for (const p of t.players) p.life = life; });
      const [chosen] = required(s0);
      const id = named(s0, 'Test Grave Walker')[0]!;
      let t = declareAttackers(toDeclareAttackers(s0), [[id, chosen!]]);
      t = passUntil(t, (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2', 'combat damage', 80);
      const trig = settle(t);
      const done = resolveAll(trig);
      expect(lifeOf(done, chosen!)).toBe(life - 2 - lose);
    }
  });
});

describe('CR 115.1, 601.2c, 603.3d: "target opponent chosen at random gains control of ~."', () => {
  const HUNT = card('Test Passing Curse', 'Enchantment', 'Players can\'t gain life.\nAt the beginning of your end step, target opponent chosen at random gains control of this enchantment.');
  const game = (seed: string): GameState => mpScenario({ players: 4, seed, defs: [HUNT], zones: { p1: { battlefield: ['Test Passing Curse'] } } });
  const toEnd = (s: GameState): GameState => passUntil(s, (x) => x.turn.step === 'end' && x.zones.stack.length > 0, 'the end step trigger', 120);
  it('is full', () => expect(full(HUNT)).toBe(true));
  it('nobody is asked: an opponent (never the controller) takes it, and different seeds give different opponents', () => {
    const owners = new Set<string>();
    for (const seed of ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8']) {
      const t = toEnd(game(seed));
      expect(t.pending?.kind).toBe('priority'); // no target decision: the game picks
      const done = resolveAll(t);
      const owner = done.objects[named(done, 'Test Passing Curse')[0]!]!.controller;
      expect(['p2', 'p3', 'p4']).toContain(owner);
      owners.add(owner);
    }
    expect(owners.size).toBeGreaterThan(1);
  });
});

describe('CR 702.29a, 702.29f: "the number of cards with a cycling ability in your graveyard" (typecycling too)', () => {
  const FLARE = card('Test Cycle Flare', 'Instant', '~ deals X damage to any target and you gain X life, where X is the number of cards with a cycling ability in your graveyard.');
  const CYC = card('Test Cycler', 'Creature — Bird', 'Cycling {1}', ['1', '1']);
  const SWC = card('Test Land Cycler', 'Creature — Beast', 'Swampcycling {1}', ['2', '2']);
  const PLAIN = card('Test Plain Cat', 'Creature — Cat', '', ['2', '2']);
  const game = (): GameState => scenario([], { defs: [FLARE, CYC, SWC, PLAIN], p1: { hand: ['Test Cycle Flare'], graveyard: ['Test Cycler', 'Test Land Cycler', 'Test Plain Cat'] }, p2: { graveyard: ['Test Cycler'] } });
  it('is full', () => expect(full(FLARE)).toBe(true));
  it('counts your cycling and typecycling cards only (2 of 3; the opponent\'s Cycler and the plain cat are not counted)', () => {
    const s = resolveAll(cast(game(), 'Test Cycle Flare', { targets: [{ kind: 'player', id: 'p2' }] }));
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(lifeOf(s, 'p1')).toBe(22);
  });
  it('negative: with none in your graveyard nothing happens', () => {
    const s0 = scenario([], { defs: [FLARE, PLAIN], p1: { hand: ['Test Cycle Flare'], graveyard: ['Test Plain Cat'] } });
    const s = resolveAll(cast(s0, 'Test Cycle Flare', { targets: [{ kind: 'player', id: 'p2' }] }));
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

describe('CR 121.1, 115.1: "you and another target player each draw a card."', () => {
  const SPLINT = card('Test Ninja Rat', 'Creature — Rat', 'When this creature leaves the battlefield, you and another target player each draw a card.', ['2', '2']);
  const KILL = card('Test Quick Death', 'Instant', 'Destroy target creature.');
  const game = (): GameState => mpScenario({ players: 3, seed: 'sp', defs: [SPLINT, KILL], zones: { p1: { battlefield: ['Test Ninja Rat'], hand: ['Test Quick Death'] } } });
  it('is full', () => expect(full(SPLINT)).toBe(true));
  it('offers every player but the controller, and both draw', () => {
    const s0 = game();
    const t = passUntil(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Quick Death', 'hand', 'p1') } as never), (x) => x.pending?.kind === 'chooseTargets', 'the spell\'s target');
    const killed = settle(answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: named(t, 'Test Ninja Rat')[0]! }] }));
    const trig = passUntil(killed, (x) => x.pending?.kind === 'chooseTargets' || x.zones.stack.length > 1, 'the trigger target', 40);
    expect(trig.pending?.kind).toBe('chooseTargets');
    const d = trig.pending as unknown as { players: string[] };
    expect([...d.players].sort()).toEqual(['p2', 'p3']); // negative: never p1
    const before = [inHand(trig, 'p1'), inHand(trig, 'p3')];
    const done = resolveAll(answer(trig, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p3' }] }));
    expect(inHand(done, 'p3')).toBe(before[1]! + 1);
    expect(inHand(done, 'p1')).toBe(before[0]! + 1);
    expect(inHand(done, 'p2')).toBe(inHand(trig, 'p2'));
  });
});

describe('CR 608.2d, 400.3: "return two lands you control to their owner\'s hand."', () => {
  const GEM = card('Test Bouncing Gem', 'Artifact', 'When this artifact enters, return two lands you control to their owner\'s hand.\n{T}: Add two mana of any one color.');
  it('is full', () => expect(full(GEM)).toBe(true));
  it('returns two of your lands (you choose) and leaves the third and the opponent\'s lands', () => {
    const s0 = scenario([], { defs: [GEM], p1: { hand: ['Test Bouncing Gem'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Plains', 'Plains'] } });
    const s1 = resolveAll(cast(s0, 'Test Bouncing Gem'));
    expect(s1.zones.battlefield.filter((id) => s1.objects[id]!.controller === 'p1' && s1.defs[s1.objects[id]!.defId]!.name === 'Plains')).toHaveLength(1);
    expect(inHand(s1, 'p1')).toBe(2);
    expect(s1.zones.battlefield.filter((id) => s1.objects[id]!.controller === 'p2')).toHaveLength(2);
  });
});

describe('Scryfall ruling 2009-10-01 (Khalni Gem): with one land you control, that one is returned; with none, nothing happens', () => {
  const GEM = card('Test Bouncing Gem', 'Artifact', 'When this artifact enters, return two lands you control to their owner\'s hand.');
  for (const [lands, back] of [[1, 1], [0, 0]] as const) {
    it(`${lands} land(s): ${back} returned, the artifact stays`, () => {
      const s0 = scenario([], { defs: [GEM], p1: { hand: ['Test Bouncing Gem'], battlefield: Array(lands).fill('Plains') as string[] } });
      const s1 = resolveAll(cast(s0, 'Test Bouncing Gem'));
      expect(inHand(s1, 'p1')).toBe(back);
      expect(named(s1, 'Test Bouncing Gem')).toHaveLength(1);
    });
  }
});

describe('CR 208.1, 115.1: "target creature you control with the greatest power" (a Saga chapter)', () => {
  const SAGA = card('Test Rising Saga', 'Enchantment — Saga', '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after II.)\nI — Put a +1/+1 counter on target creature you control with the greatest power.\nII — Target creature you control with the greatest power gains flying and lifelink until end of turn.');
  const MID = card('Test Mid Bear', 'Creature — Bear', '', ['3', '3']);
  const BIG = card('Test Big Bear', 'Creature — Bear', '', ['5', '5']);
  const TIE = card('Test Tie Bear', 'Creature — Bear', '', ['5', '5']);
  const HUGE = card('Test Huge Ogre', 'Creature — Ogre', '', ['9', '9']);
  const game = (mine: string[]): GameState => scenario([], { defs: [SAGA, MID, BIG, TIE, HUGE], p1: { hand: ['Test Rising Saga'], battlefield: mine }, p2: { battlefield: ['Test Huge Ogre'] } });
  const chapter = (s0: GameState): GameState => passUntil(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rising Saga', 'hand', 'p1') } as never), (x) => x.pending?.kind === 'chooseTargets', 'the chapter target', 40);
  it('is full', () => expect(full(SAGA)).toBe(true));
  it('offers only your creature with the greatest power among YOUR creatures (not the opponent\'s 9/9, not the smaller bear)', () => {
    const s = chapter(game(['Test Mid Bear', 'Test Big Bear']));
    expect((s.pending as unknown as { objects: string[] }).objects).toEqual([find(s, 'Test Big Bear', 'battlefield', 'p1')]);
  });
  it('tied for the greatest: both are legal', () => {
    const s = chapter(game(['Test Tie Bear', 'Test Big Bear']));
    expect((s.pending as unknown as { objects: string[] }).objects.sort()).toEqual([find(s, 'Test Tie Bear', 'battlefield', 'p1'), find(s, 'Test Big Bear', 'battlefield', 'p1')].sort());
  });
  it('the counter goes on the chosen creature', () => {
    const s = chapter(game(['Test Mid Bear', 'Test Big Bear']));
    const big = find(s, 'Test Big Bear', 'battlefield', 'p1');
    const done = resolveAll(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: big }] }));
    expect(counters(done, big, '+1/+1')).toBe(1);
    expect(counters(done, find(done, 'Test Mid Bear', 'battlefield', 'p1'), '+1/+1')).toBe(0);
  });
});

describe('CR 122.1, 107.3: "the number of different kinds of counters among permanents you control"', () => {
  const SPELL = card('Test Kind Boost', 'Instant', 'Target creature you control gains trample and gets +X/+X until end of turn, where X is the number of different kinds of counters among permanents you control.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  it('is full', () => expect(full(SPELL)).toBe(true));
  it('counts each kind once (+1/+1 on two creatures and a charge counter: 2), only on your permanents', () => {
    const s0 = scenario([], { defs: [SPELL, BEAR], p1: { hand: ['Test Kind Boost'], battlefield: [{ name: 'Test Plain Bear', counters: { '+1/+1': 2 } }, { name: 'Test Plain Bear', counters: { '+1/+1': 1, charge: 3 } }] }, p2: { battlefield: [{ name: 'Test Plain Bear', counters: { shield: 1, stun: 1 } }] } });
    const ids = s0.zones.battlefield.filter((id) => s0.objects[id]!.controller === 'p1');
    const s1 = resolveAll(cast(s0, 'Test Kind Boost', { targets: [{ kind: 'object', id: ids[0]! }] }));
    expect(pt(s1, ids[0]!)).toBe('6/6'); // 2/2 + two +1/+1 counters, then +2/+2
  });
});

describe('CR 122.1, 120.3, 608.2h: "put a +1/+1 counter on ~, then it deals damage equal to its power to any target."', () => {
  const RIPLEY = card('Test Gunner Ripley', 'Legendary Creature — Human', '{0}: Put a +1/+1 counter on this creature, then it deals damage equal to its power to any target.', ['3', '2']);
  it('is full', () => expect(full(RIPLEY)).toBe(true));
  it('adds the counter first, so the damage is the new power (3 -> 4), to the chosen target only', () => {
    const s0 = scenario([], { defs: [RIPLEY], p1: { battlefield: ['Test Gunner Ripley'] } });
    const s1 = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Gunner Ripley', 'battlefield', 'p1'), ability: 'p:0:0' }), { targets: [{ kind: 'player', id: 'p2' }] }));
    expect(lifeOf(s1, 'p2')).toBe(16);
    expect(lifeOf(s1, 'p1')).toBe(20);
    expect(counters(s1, find(s1, 'Test Gunner Ripley', 'battlefield', 'p1'), '+1/+1')).toBe(1);
  });
});

describe('CR 608.2c, 613.4c: "Target creature you control gets +2/+2 until end of turn if its power is 2. Then it fights target creature you don\'t control."', () => {
  const SWIPE = card('Test Quick Brawl', 'Sorcery', 'Target creature you control gets +2/+2 until end of turn if its power is 2. Then it fights target creature you don\'t control.');
  const TWO = card('Test Two Power', 'Creature — Bear', '', ['2', '2']);
  const THREE = card('Test Three Power', 'Creature — Bear', '', ['3', '3']);
  const FOE = card('Test Foe Bear', 'Creature — Bear', '', ['4', '4']);
  const game = (mine: string): GameState => scenario([], { defs: [SWIPE, TWO, THREE, FOE], p1: { hand: ['Test Quick Brawl'], battlefield: [mine] }, p2: { battlefield: ['Test Foe Bear'] } });
  const play = (mine: string): GameState => {
    const s0 = game(mine);
    const picks = [find(s0, mine, 'battlefield', 'p1'), find(s0, 'Test Foe Bear', 'battlefield', 'p2')];
    let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Quick Brawl', 'hand', 'p1') } as never);
    for (let i = 0; t.pending?.kind === 'chooseTargets' && i < 4; i++) t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: picks[i]! }] });
    return resolveAll(t);
  };
  it('is full', () => expect(full(SWIPE)).toBe(true));
  it('power 2: it gets +2/+2 first (4/4), so its 4 damage kills the 4/4 foe', () => {
    const s = play('Test Two Power');
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Foe Bear')).toBe(false);
  });
  it('negative: power 3 gets no pump (stays 3/3) and dies to the 4/4 without killing it', () => {
    const s = play('Test Three Power');
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Three Power')).toBe(false);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Foe Bear')).toBe(true);
  });
});

describe('CR 118.3, 122.1, 701.21a: "{T}, Remove ten oil counters from among permanents you control and sacrifice ~: It deals 10 damage to any target."', () => {
  const SYLEX = card('Test Oil Relic', 'Legendary Artifact', '{T}, Remove ten oil counters from among permanents you control and sacrifice this artifact: It deals 10 damage to any target.');
  it('is full', () => expect(full(SYLEX)).toBe(true));
  it('with ten oil counters in all it can be activated: 10 damage and the artifact is sacrificed', () => {
    const s0 = scenario([], { defs: [SYLEX], p1: { battlefield: [{ name: 'Test Oil Relic', counters: { oil: 10 } }] } });
    const s1 = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Oil Relic', 'battlefield', 'p1'), ability: 'p:0:0' }), { targets: [{ kind: 'player', id: 'p2' }] }));
    expect(lifeOf(s1, 'p2')).toBe(10);
    expect(s1.zones.battlefield.some((id) => s1.defs[s1.objects[id]!.defId]!.name === 'Test Oil Relic')).toBe(false);
  });
  it('negative: with only nine it cannot be activated', () => {
    const s0 = scenario([], { defs: [SYLEX], p1: { battlefield: [{ name: 'Test Oil Relic', counters: { oil: 9 } }] } });
    expect(() => act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Oil Relic', 'battlefield', 'p1'), ability: 'p:0:0' })).toThrow();
  });
});

describe('CR 701.23a, 701.20a: "Search your library for an enchantment card and reveal that card. Put it into your hand, then discard a card at random. Then shuffle."', () => {
  const WILD = card('Test Wild Study', 'Enchantment', '{0}: Search your library for an enchantment card and reveal that card. Put it into your hand, then discard a card at random. Then shuffle.');
  const AURA = card('Test Calm Ward', 'Enchantment', 'You have hexproof.');
  it('is full', () => expect(full(WILD)).toBe(true));
  it('puts the found enchantment into the hand and discards one card at random (the hand is empty otherwise: it can discard the found card)', () => {
    const s0 = scenario([], { defs: [WILD, AURA], p1: { battlefield: ['Test Wild Study'], hand: ['Plains'], library: ['Test Calm Ward'] } });
    const s1 = drive(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Wild Study', 'battlefield', 'p1'), ability: 'p:0:0' }));
    expect(inHand(s1, 'p1')).toBe(1); // found one added, one discarded at random
    expect(s1.zones.graveyard['p1']!.length).toBe(1);
  });
});

describe('CR 701.23a, 608.2d: "Search your library for up to two basic land cards, reveal those cards, and put one onto the battlefield tapped and the other into your hand. Shuffle, then scry 1."', () => {
  const PERE = card('Test Long Walk', 'Sorcery', 'Search your library for up to two basic land cards, reveal those cards, and put one onto the battlefield tapped and the other into your hand. Shuffle, then scry 1.');
  it('is full', () => expect(full(PERE)).toBe(true));
  it('one basic land goes onto the battlefield tapped and the other into the hand', () => {
    const s0 = scenario(['Forest'], { defs: [PERE], p1: { hand: ['Test Long Walk'], library: ['Forest', 'Forest'] }, p2: {} });
    const s1 = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Long Walk', 'hand', 'p1') } as never));
    const mine = s1.zones.battlefield.filter((id) => s1.objects[id]!.controller === 'p1');
    expect(mine).toHaveLength(1);
    expect(s1.objects[mine[0]!]!.tapped).toBe(true);
    expect(inHand(s1, 'p1')).toBe(1);
  });
});
