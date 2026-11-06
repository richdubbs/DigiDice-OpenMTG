/**
 * Commander EDHREC ranks 27,501-28,000, round edh-c-39 (first pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 613.4d, 611.2a            "Whenever ~ attacks, switch its power and toughness until end of turn."
 *   CR 615.5, 615.7, 122.1       "Prevent the next 3 damage that would be dealt to target creature this turn. For each 1 damage prevented this way, put a +1/+1 counter on that creature."
 *   CR 107.3, 119.1              "You gain X plus 3 life."
 *   CR 613.4c, 509.1c, 506.5     "Enchanted creature gets +4/+1 and blocks each combat if able." / "... gets +3/+2 and can't attack alone."
 *   CR 702.26b, 509.3a           "Whenever ~ blocks or becomes blocked by a creature, ~ and that creature phase out."
 *   CR 202.3, 604.1              "As long as there are five or more mana values among cards in your graveyard, ~ gets +2/+2."
 *   CR 122.1, 604.1              "As long as a creature has a -1/-1 counter on it, ~ has vigilance and deathtouch."
 *   CR 401.2, 400.3, 404.1       "Look at the top card of target player's library. You may put that card into their graveyard."
 *   CR 401.2, 401.4              "Look at the top card of defending player's library. You may put that card on the bottom of that player's library."
 *   CR 401.2, 701.24a            "Look at the top five cards of target player's library. You may then have that player shuffle that library."
 */
import { describe, expect, it } from 'vitest';
import { type GameState, type ObjectId } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, answer, find, put, scenario } from '../../m3/scenario';
import { declareAttackers, runCombat, toDeclareAttackers, tweak } from '../../m4/helpers';
import { card, cast, full, named, pt, resolveAll, settle } from '../cmd3/helpers';

const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const idOf = (s: GameState, name: string, player = 'p1'): ObjectId => find(s, name, 'battlefield', player);
const FOREST = card('Test Forest', 'Basic Land — Forest', '({T}: Add {G}.)');
const ZAP = card('Test Zap Two', 'Instant', '~ deals 2 damage to target creature.');

describe('CR 613.4d: "Whenever ~ attacks, switch its power and toughness until end of turn."', () => {
  const BOAR = card('Test Flip Boar', 'Creature — Boar', 'Whenever this creature attacks, switch its power and toughness until end of turn.', ['2', '5']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '5']);
  it('is full', () => expect(full(BOAR)).toBe(true));
  it('attacking: 2/5 becomes 5/2; the other attacker is unchanged', () => {
    const s0 = scenario([], { defs: [BOAR, BEAR], p1: { battlefield: ['Test Flip Boar', 'Test Plain Bear'] } });
    const boar = idOf(s0, 'Test Flip Boar');
    const bear = idOf(s0, 'Test Plain Bear');
    expect(pt(s0, boar)).toBe('2/5');
    const s1 = resolveAll(declareAttackers(toDeclareAttackers(s0), [[boar], [bear]]));
    expect(pt(s1, boar)).toBe('5/2');
    expect(pt(s1, bear)).toBe('2/5'); // negative: only the attacker with the trigger
  });
});

describe('CR 615.5, 615.7, 122.1: "Prevent the next 3 damage that would be dealt to target creature this turn. For each 1 damage prevented this way, put a +1/+1 counter on that creature."', () => {
  const FAITH = card('Test Faith Ward', 'Instant', 'Prevent the next 3 damage that would be dealt to target creature this turn. For each 1 damage prevented this way, put a +1/+1 counter on that creature.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '4']);
  const game = (): GameState => scenario([], { defs: [FAITH, ZAP, BEAR], p1: { hand: ['Test Faith Ward', 'Test Zap Two', 'Test Zap Two', 'Test Zap Two'], battlefield: ['Test Plain Bear'] }, p2: { battlefield: ['Test Plain Bear'] } });
  const zap = (s: GameState, id: ObjectId): GameState => resolveAll(cast(s, 'Test Zap Two', { targets: [{ kind: 'object', id }] }));
  it('is full', () => expect(full(FAITH)).toBe(true));
  it('prevents 2 of 3, counters 2; the second Zap is prevented once (1 left) and deals 1', () => {
    const s0 = game();
    const bear = idOf(s0, 'Test Plain Bear', 'p1');
    const s1 = resolveAll(cast(s0, 'Test Faith Ward', { targets: [{ kind: 'object', id: bear }] }));
    const s2 = zap(s1, bear);
    expect(s2.objects[bear]!.damage).toBe(0);
    expect(s2.objects[bear]!.counters['+1/+1']).toBe(2);
    const s3 = zap(s2, bear);
    expect(s3.objects[bear]!.damage).toBe(1); // 1 prevented (shield used up), 1 dealt
    expect(s3.objects[bear]!.counters['+1/+1']).toBe(3);
    const s4 = zap(s3, bear);
    expect(s4.objects[bear]!.damage).toBe(3); // negative: the shield is gone
    expect(s4.objects[bear]!.counters['+1/+1']).toBe(3);
  });
  it('negative: damage to another creature is not prevented and gives no counters', () => {
    const s0 = game();
    const bear = idOf(s0, 'Test Plain Bear', 'p1');
    const foe = idOf(s0, 'Test Plain Bear', 'p2');
    const s1 = resolveAll(cast(s0, 'Test Faith Ward', { targets: [{ kind: 'object', id: bear }] }));
    const s2 = zap(s1, foe);
    expect(s2.objects[foe]!.damage).toBe(2);
    expect(s2.objects[bear]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 107.3, 119.1: "You gain X plus 3 life."', () => {
  const CASCADE = card('Test Rising Spring', 'Instant', 'You gain X plus 3 life.', undefined, '{X}');
  it('is full', () => expect(full(CASCADE)).toBe(true));
  it('X = 2 gains 5; X = 0 gains 3', () => {
    for (const [x, gain] of [[2, 5], [0, 3]] as const) {
      const s0 = scenario([], { defs: [CASCADE, FOREST], p1: { hand: ['Test Rising Spring'], battlefield: ['Test Forest', 'Test Forest'] } });
      let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rising Spring', 'hand', 'p1') });
      for (let i = 0; i < 10 && t.pending?.kind !== 'priority'; i++) t = t.pending?.kind === 'chooseNumber' ? answer(t, { kind: 'chooseNumber', n: x }) : settle(t);
      expect(lifeOf(resolveAll(t), 'p1')).toBe(20 + gain);
    }
  });
});

describe('CR 613.4c, 509.1c, 506.5: Auras that pump and add a combat requirement', () => {
  const BLOCKER = card('Test Spire Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +4/+1 and blocks each combat if able.');
  const ALONE = card('Test Lone Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +3/+2 and can\'t attack alone.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  it('are full', () => { expect(full(BLOCKER)).toBe(true); expect(full(ALONE)).toBe(true); });
  it('pump the enchanted creature only (2/2 -> 6/3 and 5/4); the other creature is unchanged', () => {
    for (const [aura, want] of [['Test Spire Aura', '6/3'], ['Test Lone Aura', '5/4']] as const) {
      const s0 = scenario([], { defs: [BLOCKER, ALONE, BEAR], p1: { hand: [aura], battlefield: ['Test Plain Bear', 'Test Plain Bear'] } });
      const [a, b] = named(s0, 'Test Plain Bear');
      const s1 = resolveAll(cast(s0, aura, { targets: [{ kind: 'object', id: a! }] }));
      expect(pt(s1, a!)).toBe(want);
      expect(pt(s1, b!)).toBe('2/2');
    }
  });
  it("can't attack alone: the enchanted creature alone may not attack; with another attacker it may", () => {
    const s0 = scenario([], { defs: [ALONE, BEAR], p1: { hand: ['Test Lone Aura'], battlefield: ['Test Plain Bear', 'Test Plain Bear'] } });
    const [a, b] = named(s0, 'Test Plain Bear');
    const s1 = resolveAll(cast(s0, 'Test Lone Aura', { targets: [{ kind: 'object', id: a! }] }));
    expect(() => declareAttackers(toDeclareAttackers(s1), [[a!]])).toThrow();
    const s2 = declareAttackers(toDeclareAttackers(s1), [[a!], [b!]]);
    expect(s2.combat?.attackers.length).toBe(2);
  });
  it('blocks each combat if able: the enchanted creature must block when it can (the other creature need not)', () => {
    const s0 = scenario([], { defs: [BLOCKER, BEAR], p1: { hand: ['Test Spire Aura'], battlefield: ['Test Plain Bear'] }, p2: { battlefield: ['Test Plain Bear', 'Test Plain Bear'] } });
    const foes = named(s0, 'Test Plain Bear').filter((id) => s0.objects[id]!.controller === 'p2');
    const mine = idOf(s0, 'Test Plain Bear', 'p1');
    const s1 = resolveAll(cast(s0, 'Test Spire Aura', { targets: [{ kind: 'object', id: foes[0]! }] }));
    // the opponent's enchanted bear must block the attacker; blocking nothing is illegal, the other bear need not block
    const t = tweak(s1, (x) => { x.turn.activePlayer = 'p1'; });
    const a = declareAttackers(toDeclareAttackers(t), [[mine]]);
    let s = a;
    for (let i = 0; i < 20 && s.pending?.kind !== 'declareBlockers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    expect(() => answer(s, { kind: 'declareBlockers', blocks: [] })).toThrow();
    expect(() => answer(s, { kind: 'declareBlockers', blocks: [{ blocker: foes[0]!, attacker: mine }] })).not.toThrow();
  });
});

describe('CR 702.26b, 509.3a: "Whenever ~ blocks or becomes blocked by a creature, ~ and that creature phase out."', () => {
  const DREAM = card('Test Dream Duelist', 'Creature — Wizard', 'Whenever this creature blocks or becomes blocked by a creature, this creature and that creature phase out.', ['3', '3']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  it('is full', () => expect(full(DREAM)).toBe(true));
  it('attacking and blocked: both phase out and no combat damage is dealt; a bystander stays', () => {
    const s0 = scenario([], { defs: [DREAM, BEAR], p1: { battlefield: ['Test Dream Duelist'] }, p2: { battlefield: ['Test Plain Bear', 'Test Plain Bear'] } });
    const duel = idOf(s0, 'Test Dream Duelist');
    const [blk, other] = named(s0, 'Test Plain Bear');
    const s1 = resolveAll(runCombat(s0, { attack: [[duel]], block: [[blk!, duel]], until: 'declareBlockers' }));
    expect(s1.objects[duel]!.phasedOut).toBe(true);
    expect(s1.objects[blk!]!.phasedOut).toBe(true);
    expect(s1.objects[other!]!.phasedOut).toBe(false);
    expect(s1.objects[duel]!.damage).toBe(0);
  });
  it('negative: unblocked, nothing phases out', () => {
    const s0 = scenario([], { defs: [DREAM, BEAR], p1: { battlefield: ['Test Dream Duelist'] }, p2: { battlefield: ['Test Plain Bear'] } });
    const duel = idOf(s0, 'Test Dream Duelist');
    const s1 = runCombat(s0, { attack: [[duel]] });
    expect(s1.objects[duel]!.phasedOut).toBe(false);
    expect(lifeOf(s1, 'p2')).toBe(17);
  });
});

describe('CR 202.3, 604.1: "As long as there are five or more mana values among cards in your graveyard, ~ gets +2/+2."', () => {
  const SPY = card('Test Ledger Spy', 'Creature — Rogue', 'As long as there are five or more mana values among cards in your graveyard, this creature gets +2/+2.', ['1', '1']);
  const costs = ['{0}', '{1}', '{2}', '{3}', '{4}', '{2}'];
  const defs = [...costs.map((c, i) => card(`Test Tome ${i}`, 'Artifact', '', undefined, c)), card('Test Tome X', 'Artifact', '', undefined, '{X}{X}'), card('Test Tome Land', 'Land', '')];
  const game = (n: number): GameState => tweak(scenario([], { defs: [SPY, ...defs], p1: { battlefield: ['Test Ledger Spy'] } }), (t) => { for (let i = 0; i < n; i++) put(t, 'p1', 'graveyard', `Test Tome ${i}`); });
  it('is full', () => expect(full(SPY)).toBe(true));
  it('five different mana values (0, 1, 2, 3, 4): 3/3; four different values: 1/1; repeated values count once (six cards, five values)', () => {
    expect(pt(game(5), idOf(game(5), 'Test Ledger Spy'))).toBe('3/3');
    expect(pt(game(4), idOf(game(4), 'Test Ledger Spy'))).toBe('1/1'); // negative: only four values
    expect(pt(game(6), idOf(game(6), 'Test Ledger Spy'))).toBe('3/3'); // the sixth card repeats mana value 2
    // ruling 2022-04-29: X is 0 for a card in a graveyard and a land is 0, so they repeat the mana value 0
    const withX = tweak(game(4), (t) => { put(t, 'p1', 'graveyard', 'Test Tome X'); put(t, 'p1', 'graveyard', 'Test Tome Land'); });
    expect(pt(withX, idOf(withX, 'Test Ledger Spy'))).toBe('1/1');
  });
});

describe('CR 122.1, 604.1: "As long as a creature has a -1/-1 counter on it, ~ has vigilance and deathtouch."', () => {
  const HUNTER = card('Test Scar Hunter', 'Creature — Hunter', 'As long as a creature has a -1/-1 counter on it, this creature has vigilance and deathtouch.', ['2', '2']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['3', '3']);
  it('is full', () => expect(full(HUNTER)).toBe(true));
  it('any creature with a -1/-1 counter (an opponent\'s too) gives it both keywords; with none it has neither; a +1/+1 counter does not count', () => {
    const base = scenario([], { defs: [HUNTER, BEAR], p1: { battlefield: ['Test Scar Hunter'] }, p2: { battlefield: ['Test Plain Bear'] } });
    const hunter = idOf(base, 'Test Scar Hunter');
    const bear = idOf(base, 'Test Plain Bear', 'p2');
    const has = (s: GameState): boolean => hasKeyword(getChars(s, hunter)!, 'vigilance') && hasKeyword(getChars(s, hunter)!, 'deathtouch');
    expect(has(base)).toBe(false);
    expect(has(tweak(base, (t) => { t.objects[bear]!.counters['+1/+1'] = 1; }))).toBe(false);
    expect(has(tweak(base, (t) => { t.objects[bear]!.counters['-1/-1'] = 1; }))).toBe(true);
    expect(has(tweak(base, (t) => { t.objects[hunter]!.counters['-1/-1'] = 1; }))).toBe(true);
  });
});

describe('CR 401.2, 400.3, 404.1: "Look at the top card of target player\'s library. You may put that card into their graveyard."', () => {
  const SPY = card('Test Peek Spy', 'Instant', 'Look at the top card of target player\'s library. You may put that card into their graveyard.');
  const TOP = card('Test Top Relic', 'Artifact', '');
  const NEXT = card('Test Next Relic', 'Artifact', '');
  const game = (): GameState => scenario([], { defs: [SPY, TOP, NEXT], p1: { hand: ['Test Peek Spy'] }, p2: { library: ['Test Top Relic', 'Test Next Relic'] } });
  it('is full', () => expect(full(SPY)).toBe(true));
  const defsOf = (s: GameState, ids: ObjectId[]): string[] => ids.map((id) => s.objects[id]!.defId);
  it('yes: the top card of that player\'s library goes into that player\'s graveyard; no: it stays (a card changes object when it changes zone, CR 400.7)', () => {
    for (const yes of [true, false]) {
      const s0 = game();
      expect(defsOf(s0, s0.zones.library['p2']!).slice(0, 2)).toEqual(['Test Top Relic', 'Test Next Relic']);
      const s1 = resolveAll(cast(s0, 'Test Peek Spy', { targets: [{ kind: 'player', id: 'p2' }] }), { yes });
      expect(defsOf(s1, s1.zones.graveyard['p2']!)).toEqual(yes ? ['Test Top Relic'] : []);
      expect(defsOf(s1, s1.zones.library['p2']!)[0]).toBe(yes ? 'Test Next Relic' : 'Test Top Relic');
      expect(s1.zones.graveyard['p1']!.length).toBe(1); // only the spell itself
    }
  });
});

describe('CR 401.2, 401.4: "Look at the top card of defending player\'s library. You may put that card on the bottom of that player\'s library."', () => {
  const CORAL = card('Test Reef Lurker', 'Creature — Fish', 'Whenever this creature attacks and isn\'t blocked, look at the top card of defending player\'s library. You may put that card on the bottom of that player\'s library.', ['2', '2']);
  const TOP = card('Test Top Relic', 'Artifact', '');
  const NEXT = card('Test Next Relic', 'Artifact', '');
  const game = (): GameState => scenario([], { defs: [CORAL, TOP, NEXT], p1: { battlefield: ['Test Reef Lurker'] }, p2: { library: ['Test Top Relic', 'Test Next Relic'] } });
  it('is full', () => expect(full(CORAL)).toBe(true));
  it('yes: the top card goes to the bottom of the defending player\'s library; no: it stays on top', () => {
    for (const yes of [true, false]) {
      const s0 = game();
      const n = s0.zones.library['p2']!.length;
      const s1 = resolveAll(runCombat(s0, { attack: [[idOf(s0, 'Test Reef Lurker')]], until: 'declareBlockers' }), { yes });
      const defs = s1.zones.library['p2']!.map((id) => s1.objects[id]!.defId);
      expect(defs.length).toBe(n);
      expect(defs[0]).toBe(yes ? 'Test Next Relic' : 'Test Top Relic');
      expect(defs[n - 1] === 'Test Top Relic').toBe(yes);
    }
  });
});

describe('CR 401.2, 701.24a: "Look at the top five cards of target player\'s library. You may then have that player shuffle that library."', () => {
  const VIS = card('Test Far Sight', 'Sorcery', 'Look at the top five cards of target player\'s library. You may then have that player shuffle that library.');
  it('is full', () => expect(full(VIS)).toBe(true));
  it('yes: the target\'s library is shuffled (its order changes), yours is not; no: nothing is shuffled', () => {
    const names = Array.from({ length: 8 }, (_, i) => `Test Relic ${i}`);
    const defs = names.map((n) => card(n, 'Artifact', ''));
    for (const yes of [true, false]) {
      const s0 = scenario([], { defs: [VIS, ...defs], p1: { hand: ['Test Far Sight'], library: names }, p2: { library: names } });
      const order = (g: GameState, p: string): string => g.zones.library[p]!.map((id) => g.objects[id]!.defId).join();
      const before = [order(s0, 'p1'), order(s0, 'p2')];
      const s1 = resolveAll(cast(s0, 'Test Far Sight', { targets: [{ kind: 'player', id: 'p2' }] }), { yes });
      expect(order(s1, 'p1')).toBe(before[0]);
      expect(order(s1, 'p2') !== before[1]).toBe(yes);
      expect(s1.zones.library['p2']!.length).toBe(s0.zones.library['p2']!.length);
    }
  });
});

describe('CR 608.2c, 120.3, 603.4: "~ deals 5 damage to each creature without flying if there are seven or more cards in your graveyard."', () => {
  const STORM = card('Test Dust Squall', 'Sorcery', '~ deals 5 damage to each creature without flying if there are seven or more cards in your graveyard.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const BIRD = card('Test Sky Bird', 'Creature — Bird', 'Flying', ['2', '2']);
  const junk = Array.from({ length: 7 }, (_, i) => card(`Test Junk ${i}`, 'Artifact', ''));
  const game = (n: number): GameState => tweak(
    scenario([], { defs: [STORM, BEAR, BIRD, ...junk], p1: { hand: ['Test Dust Squall'], battlefield: ['Test Plain Bear', 'Test Sky Bird'] }, p2: { battlefield: ['Test Plain Bear'] } }),
    (t) => { for (let i = 0; i < n; i++) put(t, 'p1', 'graveyard', `Test Junk ${i}`); });
  it('is full', () => expect(full(STORM)).toBe(true));
  it('seven cards: every creature without flying dies (an opponent\'s too), the flyer lives; six cards: nothing happens', () => {
    const s7 = resolveAll(cast(game(7), 'Test Dust Squall'));
    expect(named(s7, 'Test Plain Bear').length).toBe(0);
    expect(named(s7, 'Test Sky Bird').length).toBe(1);
    const s6 = resolveAll(cast(game(6), 'Test Dust Squall'));
    expect(named(s6, 'Test Plain Bear').length).toBe(2);
    expect(s6.objects[named(s6, 'Test Sky Bird')[0]!]!.damage).toBe(0);
  });
});

describe('CR 115.1, 303.4: "~ can\'t be the target of Aura spells."', () => {
  const WARD = card('Test Aura Proof', 'Creature — Wizard', 'This creature can\'t be the target of Aura spells.', ['2', '2']);
  const AURA = card('Test Plain Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');
  const BOOST = card('Test Boost Spell', 'Instant', 'Target creature gets +1/+1 until end of turn.');
  const game = (): GameState => scenario([], { defs: [WARD, AURA, BOOST], p1: { hand: ['Test Plain Aura', 'Test Boost Spell'], battlefield: ['Test Aura Proof'] } });
  it('is full', () => expect(full(WARD)).toBe(true));
  it('an Aura spell may not target it; a non-Aura spell may', () => {
    const s0 = game();
    const id = idOf(s0, 'Test Aura Proof');
    expect(() => cast(s0, 'Test Plain Aura', { targets: [{ kind: 'object', id }] })).toThrow();
    const s1 = resolveAll(cast(s0, 'Test Boost Spell', { targets: [{ kind: 'object', id }] }));
    expect(pt(s1, id)).toBe('3/3');
  });
});

describe('CR 115.4, 601.2c, 603.3d: "{T}: ~ deals 2 damage to any target chosen at random."', () => {
  const PILOT = card('Test Wild Pilot', 'Creature — Goblin', '{T}: This creature deals 2 damage to any target chosen at random.', ['1', '5']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '5']);
  it('is full', () => expect(full(PILOT)).toBe(true));
  it('nobody is asked for the target; exactly one legal target (a player or a creature) takes exactly 2 damage; over many games each kind is picked', () => {
    const hit = { p1: 0, p2: 0, pilot: 0, bear: 0 };
    for (let seed = 0; seed < 40; seed++) {
      const s0 = scenario([], { seed: `pilot-${seed}`, defs: [PILOT, BEAR], p1: { battlefield: ['Test Wild Pilot'] }, p2: { battlefield: ['Test Plain Bear'] } });
      const pilot = idOf(s0, 'Test Wild Pilot');
      const t = act(s0, { type: 'activate', player: 'p1', source: pilot, ability: 'p:0:0' } as never);
      expect(t.pending?.kind).not.toBe('chooseTargets');
      const s1 = resolveAll(t);
      const bear = idOf(s1, 'Test Plain Bear', 'p2');
      const dmg = [20 - lifeOf(s1, 'p1'), 20 - lifeOf(s1, 'p2'), s1.objects[pilot]!.damage, s1.objects[bear]!.damage];
      expect(dmg.reduce((a, b) => a + b, 0)).toBe(2); // one target, 2 damage
      hit.p1 += dmg[0]! > 0 ? 1 : 0; hit.p2 += dmg[1]! > 0 ? 1 : 0; hit.pilot += dmg[2]! > 0 ? 1 : 0; hit.bear += dmg[3]! > 0 ? 1 : 0;
    }
    expect(hit.p1 + hit.p2 + hit.pilot + hit.bear).toBe(40);
    expect(Object.values(hit).filter((n) => n > 0).length).toBeGreaterThanOrEqual(3); // players and creatures (the source itself too) are all candidates
  });
});
