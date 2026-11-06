/**
 * Commander lane edh-replace, round edh-replace-4: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each test is named after the rule it checks and has its negative case. CR cites are from the Comprehensive Rules of 2026-09-25 (fetched) where
 * the record says so, else unverified.
 *
 *   CR 120.4a, 120.10, 608.2c, 614.15  "Target creature you control deals damage equal to its power to target creature you don't control. If the creature you control has
 *                                      trample, excess damage is dealt to that creature's controller instead."  (Ram Through, ruling 2020-04-17)
 *   CR 608.2c, 614.15, 700.4          "Return target permanent card with mana value 3 or less from your graveyard to your hand. If you're the monarch, return that permanent card to
 *                                      the battlefield instead."  ("that permanent card" is the target; Court of Ardenvale)
 *   CR 114.2, 114.4, 102.3            "Each opponent gets an emblem with ..." (every opponent of a four-player game, each its own emblem; Chandra, Awakened Inferno)
 *   CR 201.2, 603.4                   "you control eight or more artifacts with the same name as one another" (Mechanized Production; a copy of a card has its name)
 *   CR 119.7, 120.3, 608.2c           "If a player is dealt damage this way, they can't gain life for the rest of the game." (Screaming Nemesis)
 *   CR 614.15, 608.2c, 701.8a         "Destroy target creature if it has mana value 2 or less. Destroy that creature if it has mana value 4 or less instead if C." (Fatal Push)
 *   CR 614.1a, 120.3, 105.2           "If a red or artifact source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 1 instead."
 *   CR 615.1, 615.6, 114.4            "If a source would deal damage to you or a planeswalker you control, prevent all but 1 of that damage." (an emblem; Ajani Steadfast)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, legal, life, pass, scenario } from '../../m3/scenario';
import { lifeOf, mpScenario, passUntil } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; colors?: string[]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
type Target = { kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId };
const obj = (id: ObjectId): Target => ({ kind: 'object', id });

/** Answer the decisions that come up until priority (payments automatic; targets in order; object choices from `objects` in order, else the first allowed). */
function drive(s0: GameState, targets: Target[][] = [], objects: ObjectId[][] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: objects.shift() ?? p.options.slice(0, Math.max(1, p.min)) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, targets: Target[][] = [], objects: ObjectId[][] = []): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), targets, objects);
  return s;
}
/** p1 casts the named card from hand (free) with the targets given, and the stack resolves. */
function cast(s0: GameState, name: string, targets: Target[]): GameState {
  const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  return resolveAll(drive(s1, targets.map((t) => [t])));
}
const marked = (s: GameState, id: ObjectId): number => s.objects[id]!.damage;
const alive = (s: GameState, id: ObjectId): boolean => s.zones.battlefield.includes(id);

describe('CR 120.4a, 120.10, 614.15: "Target creature you control deals damage equal to its power to target creature you don\'t control. If the creature you control has trample, excess damage is dealt to that creature\'s controller instead."', () => {
  const RAM = card('Test Charging Strike', 'Instant', "Target creature you control deals damage equal to its power to target creature you don't control. If the creature you control has trample, excess damage is dealt to that creature's controller instead.");
  const TRAMPLER = card('Test Stampeder', 'Creature — Rhino', 'Trample', { pt: ['5', '5'] });
  const BRUTE = card('Test Plain Brute', 'Creature — Ogre', '', { pt: ['5', '5'] });
  const POISONER = card('Test Deadly Stampeder', 'Creature — Snake', 'Trample\nDeathtouch', { pt: ['5', '5'] });
  const BEAR = card('Test Small Bear', 'Creature — Bear', '', { pt: ['2', '3'] });
  const WARDED = card('Test Red Guard', 'Creature — Knight', 'Protection from creatures', { pt: ['2', '3'] });
  const defs = [RAM, TRAMPLER, BRUTE, POISONER, BEAR, WARDED];
  const play = (mine: string, theirs: string, prep: (s: GameState, theirId: ObjectId) => void = () => undefined): { s: GameState; theirId: ObjectId; mineId: ObjectId } => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Charging Strike'], battlefield: [mine] }, p2: { battlefield: [theirs] } });
    const mineId = find(s0, mine, 'battlefield', 'p1');
    const theirId = find(s0, theirs, 'battlefield', 'p2');
    prep(s0, theirId);
    return { s: cast(s0, 'Test Charging Strike', [obj(mineId), obj(theirId)]), theirId, mineId };
  };
  it('is automated', () => expect(full(RAM)).toBe(true));
  it('with trample the creature is dealt lethal damage (toughness 3) and the other 2 are dealt to its controller', () => {
    const r = play('Test Stampeder', 'Test Small Bear');
    expect(alive(r.s, r.theirId)).toBe(false);
    expect(life(r.s, 'p2')).toBe(20 - 2);
    expect(life(r.s, 'p1')).toBe(20);
  });
  it('negative: without trample all of the damage is dealt to the creature and its controller loses nothing', () => {
    const r = play('Test Plain Brute', 'Test Small Bear');
    expect(alive(r.s, r.theirId)).toBe(false);
    expect(life(r.s, 'p2')).toBe(20);
  });
  it('negative: damage that is not above lethal has no excess (power 5 against toughness 5)', () => {
    const r = play('Test Stampeder', 'Test Plain Brute');
    expect(life(r.s, 'p2')).toBe(20);
    expect(alive(r.s, r.theirId)).toBe(false);
  });
  it('damage already marked on the creature counts: with 2 marked on a toughness-3 creature only 1 is lethal, so 4 is excess (Scryfall ruling 2020-04-17)', () => {
    const r = play('Test Stampeder', 'Test Small Bear', (s, id) => { s.objects[id]!.damage = 2; });
    expect(life(r.s, 'p2')).toBe(20 - 4);
  });
  it('a deathtouch source needs 1 damage to be lethal, so the other 4 are excess (CR 702.2c)', () => {
    const r = play('Test Deadly Stampeder', 'Test Small Bear');
    expect(life(r.s, 'p2')).toBe(20 - 4);
    expect(alive(r.s, r.theirId)).toBe(false);
  });
  it('lethal and excess are read before prevention: a creature protected from the source takes none, and its controller is still dealt the excess (ruling 2020-04-17)', () => {
    const r = play('Test Stampeder', 'Test Red Guard');
    expect(alive(r.s, r.theirId)).toBe(true);
    expect(marked(r.s, r.theirId)).toBe(0);
    expect(life(r.s, 'p2')).toBe(20 - 2);
  });
  it('if the creature you control is gone when the spell resolves it deals no damage at all (ruling 2020-04-17, CR 608.2b)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Charging Strike'], battlefield: ['Test Stampeder', 'Test Stampeder'] }, p2: { battlefield: ['Test Small Bear'] } });
    const [a] = [find(s0, 'Test Stampeder', 'battlefield', 'p1')];
    const theirId = find(s0, 'Test Small Bear', 'battlefield', 'p2');
    const s1 = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Charging Strike', 'hand', 'p1') }), [[obj(a)], [obj(theirId)]]);
    delete s1.objects[a]; // the creature left the game before the spell resolved
    s1.zones.battlefield = s1.zones.battlefield.filter((x) => x !== a);
    const s2 = resolveAll(s1);
    expect(marked(s2, theirId)).toBe(0);
    expect(life(s2, 'p2')).toBe(20);
  });
});

describe('CR 608.2c, 614.15: "Return target permanent card ... from your graveyard to your hand. If you\'re the monarch, return that permanent card to the battlefield instead."', () => {
  const COURT = card('Test Throne Hall', 'Instant', "Return target permanent card with mana value 3 or less from your graveyard to your hand. If you're the monarch, return that permanent card to the battlefield instead.");
  const SMALL = card('Test Small Relic', 'Artifact', '', { cost: '{2}' });
  const BIG = card('Test Big Relic', 'Artifact', '', { cost: '{5}' });
  const OTHER = card('Test Other Land', 'Land', '');
  const defs = [COURT, SMALL, BIG, OTHER];
  const play = (monarch: boolean, target: string): GameState => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Throne Hall'], graveyard: ['Test Small Relic', 'Test Big Relic', 'Test Other Land'] } });
    if (monarch) s0.designations = { ...(s0.designations ?? {}), monarch: 'p1' };
    return cast(s0, 'Test Throne Hall', [obj(find(s0, target, 'graveyard', 'p1'))]);
  };
  it('is automated', () => expect(full(COURT)).toBe(true));
  it('not the monarch: the card goes to your hand', () => {
    const s = play(false, 'Test Small Relic');
    expect(s.zones.hand['p1']!.some((id) => s.objects[id]!.defId === 'Test Small Relic')).toBe(true);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Small Relic')).toBe(false);
  });
  it('the monarch: the same card is put onto the battlefield instead, and not into the hand', () => {
    const s = play(true, 'Test Small Relic');
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Small Relic')).toBe(true);
    expect(s.zones.hand['p1']!.some((id) => s.objects[id]!.defId === 'Test Small Relic')).toBe(false);
  });
  it('negative: a card with mana value above 3 is not a legal target', () => {
    expect(() => play(true, 'Test Big Relic')).toThrow(/target/i);
  });
});

describe('CR 114.2, 114.4, 102.3: "Each opponent gets an emblem with ..." in a four-player game', () => {
  const WARDEN = compileCard({ name: 'Test Flame Warden', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Testwalker', colors: [], loyalty: '4',
    oracle_text: '+2: Each opponent gets an emblem with "At the beginning of your upkeep, this emblem deals 1 damage to you."' } as OracleCard);
  const emblemsOf = (s: GameState, p: PlayerId): number => Object.values(s.objects).filter((o) => o.zone === 'command' && o.owner === p).length;
  const start = (): GameState => mpScenario({ defs: [WARDEN], zones: { p1: { battlefield: [{ name: 'Test Flame Warden', counters: { loyalty: 4 } }] } } });
  const plus2 = (s: GameState): GameState => {
    const a = legal(s, 'p1', 'activate').find((x) => x.label.includes('emblem'));
    if (a === undefined) throw new Error('no activation');
    let t = act(s, a.action);
    for (let i = 0; i < 10 && t.zones.stack.length > 0; i++) t = pass(pass(t));
    return t;
  };
  it('is automated', () => expect(full(WARDEN)).toBe(true));
  it('every opponent gets one emblem and you get none', () => {
    const s = plus2(start());
    expect([emblemsOf(s, 'p1'), emblemsOf(s, 'p2'), emblemsOf(s, 'p3'), emblemsOf(s, 'p4')]).toEqual([0, 1, 1, 1]);
  });
  it('the emblem triggers at the beginning of ITS owner\'s upkeep (not yours): p2 loses 1 in turn 2, p3 loses 1 in turn 3, you never', () => {
    let s = plus2(start());
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'turn 2');
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20, 19, 20, 20]);
    s = passUntil(s, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'turn 3');
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20, 19, 19, 20]);
  });
  it('a player who gets two emblems takes the damage twice (each emblem triggers separately; the ruling of 2019-07-12)', () => {
    let s = plus2(start());
    s = passUntil(s, (x) => x.turn.number === 5 && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'turn 5'); // p1 again (turn 5): second activation
    s = plus2(s);
    s = passUntil(s, (x) => x.turn.number === 6 && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'turn 6');
    expect(lifeOf(s, 'p2')).toBe(20 - 1 /* turn 2 */ - 2 /* turn 6, two emblems */);
  });
});

describe('CR 201.2, 603.4: "you control eight or more artifacts with the same name as one another"', () => {
  const ENGINE = card('Test Replica Engine', 'Instant', "Create a token that's a copy of target artifact you control. Then if you control eight or more artifacts with the same name as one another, you win the game.");
  const GEAR = card('Test Plain Gear', 'Artifact', '', { cost: '{1}' });
  const COG = card('Test Odd Cog', 'Artifact', '', { cost: '{1}' });
  const defs = [ENGINE, GEAR, COG];
  const play = (same: number, others: number, opp = 0): GameState => {
    const mine = [...Array(same).fill('Test Plain Gear'), ...Array(others).fill('Test Odd Cog')] as string[];
    const s0 = scenario([], { defs, p1: { hand: ['Test Replica Engine'], battlefield: mine }, p2: { battlefield: Array(opp).fill('Test Plain Gear') as string[] } });
    return cast(s0, 'Test Replica Engine', [obj(find(s0, 'Test Plain Gear', 'battlefield', 'p1'))]);
  };
  it('is automated', () => expect(full(ENGINE)).toBe(true));
  it('7 gears plus the token copy are 8 artifacts with one name: you win', () => {
    expect(play(7, 0).result?.winner).toBe('p1');
  });
  it('negative: 6 gears plus the token are only 7 with one name, however many differently named artifacts you have', () => {
    expect(play(6, 5).result).toBeNull();
  });
  it('negative: artifacts an opponent controls do not count', () => {
    expect(play(6, 0, 5).result).toBeNull();
  });
});

describe('CR 119.7, 120.3, 608.2c: "If a player is dealt damage this way, they can\'t gain life for the rest of the game."', () => {
  const NEMESIS = card('Test Screaming Shade', 'Creature — Specter', "Whenever this creature is dealt damage, it deals that much damage to any other target. If a player is dealt damage this way, they can't gain life for the rest of the game.", { pt: ['4', '8'] });
  const BOLT = card('Test Little Bolt', 'Instant', 'Test Little Bolt deals 3 damage to target creature.');
  const GAIN = card('Test Small Gain', 'Instant', 'You gain 4 life.');
  const BEAR = card('Test Small Bear', 'Creature — Bear', '', { pt: ['2', '5'] });
  const defs = [NEMESIS, BOLT, GAIN, BEAR];
  const run = (target: (s: GameState) => Target): GameState => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Little Bolt'], battlefield: ['Test Screaming Shade'] }, p2: { hand: ['Test Small Gain'], battlefield: ['Test Small Bear'] } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Little Bolt', 'hand', 'p1') });
    s = drive(s, [[obj(find(s0, 'Test Screaming Shade', 'battlefield', 'p1'))]]);
    for (let i = 0; i < 20 && s.zones.stack.length > 0; i++) {
      const d = s.pending;
      s = d?.kind === 'chooseTargets' ? answer(s, { kind: 'chooseTargets', targets: [target(s)] }) : drive(pass(pass(s)), [[target(s)]]);
    }
    return s;
  };
  const gainAsP2 = (s: GameState): GameState => {
    let t = s.pending?.player === 'p2' ? s : pass(s);
    t = act(t, { type: 'cast', player: 'p2', card: find(t, 'Test Small Gain', 'hand', 'p2') });
    return resolveAll(drive(t));
  };
  it('is automated', () => expect(full(NEMESIS)).toBe(true));
  it('a player dealt damage this way (3 damage to the opponent) can no longer gain life; others still can', () => {
    const s = run(() => ({ kind: 'player', id: 'p2' }));
    expect(life(s, 'p2')).toBe(20 - 3);
    const after = gainAsP2(s);
    expect(life(after, 'p2')).toBe(20 - 3); // the lock holds
  });
  it('dealt damage by two blockers at once, it triggers ONCE for the total (ruling 2024-09-20): the opponent is dealt 2 + 3 = 5 by one ability', () => {
    const SHADE = card('Test Scream Shade', 'Creature — Specter', "Whenever this creature is dealt damage, it deals that much damage to any other target. If a player is dealt damage this way, they can't gain life for the rest of the game.", { pt: ['1', '8'] });
    const WA = card('Test Wall A', 'Creature — Wall', '', { pt: ['2', '2'] });
    const WB = card('Test Wall B', 'Creature — Wall', '', { pt: ['3', '3'] });
    let s: GameState = scenario([], { defs: [SHADE, WA, WB], p1: { battlefield: ['Test Scream Shade'] }, p2: { battlefield: ['Test Wall A', 'Test Wall B'] } });
    const n = find(s, 'Test Scream Shade', 'battlefield', 'p1');
    let asked = 0;
    for (let i = 0; i < 80 && s.turn.step !== 'main2' && s.turn.step !== 'endCombat'; i++) {
      const d = s.pending!;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: n, defender: 'p2' }] });
      else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: find(s, 'Test Wall A', 'battlefield', 'p2'), attacker: n }, { blocker: find(s, 'Test Wall B', 'battlefield', 'p2'), attacker: n }] });
      else if (d.kind === 'assignDamage') { const a = d as never as { recipients: { id: string }[]; amount: number }; s = answer(s, { kind: 'assignDamage', amounts: a.recipients.map((r, i) => ({ id: r.id, amount: i === 0 ? a.amount : 0 })) } as never); }
      else if (d.kind === 'chooseTargets') { asked++; s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }); }
      else if (d.kind === 'priority') s = pass(s);
      else throw new Error(d.kind);
    }
    expect(asked).toBe(1);
    expect(life(s, 'p2')).toBe(20 - 5);
  });
  it('negative: damage dealt to a creature this way locks no one\'s life gain', () => {
    const s = run((x) => obj(find(x, 'Test Small Bear', 'battlefield', 'p2')));
    expect(life(s, 'p2')).toBe(20);
    expect(life(gainAsP2(s), 'p2')).toBe(24);
  });
});

describe('CR 614.15, 608.2c, 701.8a: "Destroy target creature if it has mana value 2 or less. Destroy that creature if it has mana value 4 or less instead if a permanent left the battlefield under your control this turn."', () => {
  const PUSH = card('Test Sudden Cut', 'Instant', 'Destroy target creature if it has mana value 2 or less.\nDestroy that creature if it has mana value 4 or less instead if a permanent left the battlefield under your control this turn.');
  const SAC = card('Test Quick Sacrifice', 'Instant', 'Sacrifice a creature.');
  const mv = (n: number): CardDef => card(`Test Body ${n}`, 'Creature — Golem', '', { pt: ['2', '2'], cost: `{${n}}` });
  const defs = [PUSH, SAC, mv(2), mv(3), mv(5), card('Test Fodder', 'Creature — Goblin', '', { pt: ['1', '1'] })];
  const play = (n: number, revolt: boolean): GameState => {
    const s0 = scenario([], { defs, p1: { hand: revolt ? ['Test Quick Sacrifice', 'Test Sudden Cut'] : ['Test Sudden Cut'], battlefield: revolt ? ['Test Fodder'] : [] }, p2: { battlefield: [`Test Body ${n}`] } });
    let s = s0;
    if (revolt) s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Quick Sacrifice', 'hand', 'p1') })));
    return cast(s, 'Test Sudden Cut', [obj(find(s, `Test Body ${n}`, 'battlefield', 'p2'))]);
  };
  const dead = (s: GameState, n: number): boolean => !s.zones.battlefield.some((id) => s.objects[id]!.defId === `Test Body ${n}`);
  it('is automated', () => expect(full(PUSH)).toBe(true));
  it('without revolt only mana value 2 or less dies', () => {
    expect(dead(play(2, false), 2)).toBe(true);
    expect(dead(play(3, false), 3)).toBe(false);
  });
  it('with revolt the larger test replaces the smaller one: mana value 3 dies, 5 does not (and 2 still dies)', () => {
    expect(dead(play(3, true), 3)).toBe(true);
    expect(dead(play(5, true), 5)).toBe(false);
    expect(dead(play(2, true), 2)).toBe(true);
  });
});

describe('CR 614.1a, 120.3, 105.2: "If a red or artifact source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 1 instead."', () => {
  const WARFARE = card('Test War Factory', 'Enchantment', 'If a red or artifact source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 1 instead.');
  const ZAP = card('Test Red Zap', 'Instant', 'Test Red Zap deals 2 damage to target player.', { colors: ['R'] });
  const BLUE = card('Test Blue Zap', 'Instant', 'Test Blue Zap deals 2 damage to target player.', { colors: ['U'] });
  const defs = [WARFARE, ZAP, BLUE];
  const hit = (spell: string, mine = true): number => {
    const s0 = scenario([], { defs, p1: { hand: [spell], battlefield: mine ? ['Test War Factory'] : [] } });
    const s = cast(s0, spell, [{ kind: 'player', id: 'p2' }]);
    return 20 - life(s, 'p2');
  };
  it('is automated', () => expect(full(WARFARE)).toBe(true));
  it('a red source you control deals 1 more; a blue nonartifact source does not; without the enchantment nothing changes', () => {
    expect(hit('Test Red Zap')).toBe(3);
    expect(hit('Test Blue Zap')).toBe(2);
    expect(hit('Test Red Zap', false)).toBe(2);
  });
});

describe('CR 615.1, 615.6, 114.4: an emblem with "If a source would deal damage to you or a planeswalker you control, prevent all but 1 of that damage."', () => {
  const AJ = compileCard({ name: 'Test Shield Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Testwalker', colors: [], loyalty: '7',
    oracle_text: '-7: You get an emblem with "If a source would deal damage to you or a planeswalker you control, prevent all but 1 of that damage."' } as OracleCard);
  const OTHERWALKER = compileCard({ name: 'Test Other Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Testwalker', colors: [], loyalty: '5', oracle_text: '' } as OracleCard);
  const BOLT = card('Test Big Bolt', 'Instant', 'Test Big Bolt deals 5 damage to any target.');
  const PING = card('Test Tiny Bolt', 'Instant', 'Test Tiny Bolt deals 1 damage to any target.');
  const defs = [AJ, OTHERWALKER, BOLT, PING];
  const start = (): GameState => {
    const s0 = scenario([], { defs, p1: { battlefield: [{ name: 'Test Shield Walker', counters: { loyalty: 7 } }, { name: 'Test Other Walker', counters: { loyalty: 5 } }] }, p2: { hand: ['Test Big Bolt', 'Test Tiny Bolt'] } });
    const a = legal(s0, 'p1', 'activate').find((x) => x.label.includes('emblem'));
    let s = act(s0, a!.action);
    for (let i = 0; i < 10 && s.zones.stack.length > 0; i++) s = pass(pass(s));
    return s;
  };
  const bolt = (s0: GameState, spell: string, target: Target): GameState => {
    let s = s0.pending?.player === 'p2' ? s0 : pass(s0);
    s = act(s, { type: 'cast', player: 'p2', card: find(s, spell, 'hand', 'p2') });
    return resolveAll(drive(s, [[target]]));
  };
  it('is automated', () => expect(full(AJ)).toBe(true));
  it('5 damage to you is reduced to 1; 5 damage to a planeswalker you control is reduced to 1 loyalty', () => {
    const s = start();
    const t = bolt(s, 'Test Big Bolt', { kind: 'player', id: 'p1' });
    expect(life(t, 'p1')).toBe(19);
    const w = find(s, 'Test Other Walker', 'battlefield', 'p1');
    const u = bolt(s, 'Test Big Bolt', obj(w));
    expect(u.objects[w]!.counters['loyalty']).toBe(4);
  });
  it('damage of 1 is not reduced below itself (all but 1 of 1 is nothing prevented)', () => {
    expect(life(bolt(start(), 'Test Tiny Bolt', { kind: 'player', id: 'p1' }), 'p1')).toBe(19);
  });
  it('negative: damage to an opponent is not touched', () => {
    const s = start();
    const t = bolt(s, 'Test Big Bolt', { kind: 'player', id: 'p2' });
    expect(life(t, 'p2')).toBe(15);
  });
});
