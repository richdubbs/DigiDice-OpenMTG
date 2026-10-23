/**
 * Standard round 4, slice r4-static (static and continuous effects), played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings are invented, design 6.10). The granting object of a granted ability has its own file (r4-static-grantor.test.ts).
 *
 *   CR 119.1, 604.1, 611.3a    "~ has haste as long as an opponent has 10 or less life": the count of opponents with that life total (countPlayers lifeIs)
 *   CR 122.1                   "as long as ~ has three or more counters on it": counters of every kind together; "three or more different kinds of counters among ..."
 *   CR 205.3m, 613.1d          "Equipped creature gets +1/+1 and is all creature types"
 *   CR 509.1b                  "<group> get +1/+1 and can't be blocked by creatures with defender"
 *   CR 509.1c, 611.2c          "Each creature you control gets +3/+3 until end of turn and must be blocked this turn if able"
 *   CR 508.1b, 102.3           "Each creature that's attacking one of your opponents has trample": attacking a player who is an opponent
 *   CR 613.4c                  "~ gets +2/+0 for every three cards in your graveyard": the count divided by three, rounded down
 *   CR 700.4, 603.10a          "Draw a card for each creature that died under your control this turn"
 *   CR 601.2i, 109.2           "if you've cast another instant or sorcery spell this turn": a spell other than this one
 *   CR 305.2, 611.3a           "As long as you control a Forest, you may play an additional land on each of your turns"
 *   CR 113.6, 613.1f, 702.185  "Artifact cards and red creature cards in your hand have warp {1}": two kinds of card in the hand get an alternative cost
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, life, pass, put, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.autoRatio === 1 && (d.automation.faces ?? []).every((f) => f.abilities.every((a) => a.level === 'full')) && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;
const has = (s: GameState, id: ObjectId, kw: string): boolean => chars(s, id).keywords.some((k) => k.keyword === kw);
const setLife = (s: GameState, p: string, n: number): void => { s.players.find((x) => x.id === p)!.life = n; };

function until(s0: GameState, kind: string): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind !== kind; guard++) {
    if (guard > 40) throw new Error(`no ${kind}`);
    s = pass(s);
  }
  return s;
}
function settle(s0: GameState, targets: { kind: 'player' | 'object'; id: string }[] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 20 && s.pending && s.pending.kind !== 'priority'; guard++) {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}
function resolve(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; guard < 20 && s.zones.stack.length > 0; guard++) s = pass(pass(s));
  return s;
}

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);

describe('CR 119.1, 611.3a: "~ has haste as long as an opponent has 10 or less life."', () => {
  const GHOUL = card('Test Ghoul', 'Creature — Zombie', '~ has haste as long as an opponent has 10 or less life.', ['2', '1']);
  it('is automated', () => expect(full(GHOUL)).toBe(true));
  it('has haste only while an opponent is at 10 or less; your own life total does not count', () => {
    const s = scenario([], { p1: { battlefield: ['Test Ghoul'] }, defs: [GHOUL] });
    const g = find(s, 'Test Ghoul', 'battlefield', 'p1');
    expect(has(s, g, 'haste')).toBe(false);
    setLife(s, 'p1', 5);
    expect(has(s, g, 'haste')).toBe(false);
    setLife(s, 'p2', 10);
    expect(has(s, g, 'haste')).toBe(true);
    setLife(s, 'p2', 11);
    expect(has(s, g, 'haste')).toBe(false);
  });
});

describe('CR 122.1: counters of any kind together, and different kinds of counters', () => {
  const WARDEN = card('Test Warden', 'Creature — Soldier', 'As long as ~ has three or more counters on it, it has flying and vigilance.', ['1', '1']);
  const VET = card('Test Veteran', 'Creature — Warrior', 'As long as there are three or more different kinds of counters among creatures you control, ~ gets +2/+4.', ['2', '2']);
  it('are automated', () => { expect(full(WARDEN)).toBe(true); expect(full(VET)).toBe(true); });
  it('"three or more counters": a +1/+1 counter and two charge counters are three', () => {
    const s = scenario([], { p1: { battlefield: [{ name: 'Test Warden', counters: { '+1/+1': 1, charge: 1 } }] }, defs: [WARDEN] });
    const w = find(s, 'Test Warden', 'battlefield', 'p1');
    expect(has(s, w, 'flying')).toBe(false);
    s.objects[w]!.counters['charge'] = 2;
    expect(has(s, w, 'flying') && has(s, w, 'vigilance')).toBe(true);
  });
  it('"three or more different kinds of counters among creatures you control": kinds, not counters; an opponent\'s creature does not count', () => {
    const s = scenario([], { p1: { battlefield: ['Test Veteran', { name: 'Test Bear', counters: { '+1/+1': 3, shield: 1 } }] }, p2: { battlefield: [{ name: 'Test Bear', counters: { stun: 1 } }] }, defs: [VET, BEAR] });
    const v = find(s, 'Test Veteran', 'battlefield', 'p1');
    expect(chars(s, v).power).toBe('2');
    s.objects[v]!.counters['oil'] = 1;
    expect(chars(s, v).power).toBe('4');
    expect(chars(s, v).toughness).toBe('6');
  });
});

describe('CR 205.3m, 613.1d: "Equipped creature gets +1/+1 and is all creature types."', () => {
  const DAGGER = card('Test Dagger', 'Artifact — Equipment', 'Equipped creature gets +1/+1 and is all creature types.\nEquip {2}');
  const LORD = card('Test Elf Lord', 'Creature — Elf', 'Other Elves you control get +1/+1.', ['1', '1']);
  it('is automated', () => expect(full(DAGGER)).toBe(true));
  it('the equipped Bear is an Elf (another Elf lord pumps it) and gets +1/+1', () => {
    const s = scenario([], { p1: { battlefield: ['Test Bear', 'Test Dagger', 'Test Elf Lord'] }, defs: [DAGGER, BEAR, LORD] });
    const b = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(chars(s, b).power).toBe('2');
    s.objects[find(s, 'Test Dagger', 'battlefield', 'p1')]!.attachedTo = b;
    expect(chars(s, b).subtypes).toContain('Elf');
    expect(chars(s, b).power).toBe('4');
  });
});

describe('CR 509.1b: "Spiders you control get +1/+1 and can\'t be blocked by creatures with defender."', () => {
  const CRAWL = card('Test Crawl', 'Enchantment', "Bears you control get +1/+1 and can't be blocked by creatures with defender.");
  const WALL = card('Test Wall', 'Creature — Wall', 'Defender', ['0', '4']);
  it('is automated', () => expect(full(CRAWL)).toBe(true));
  it('the Bear gets +1/+1; a Wall can\'t block it, a creature without defender can', () => {
    let s = scenario([], { p1: { battlefield: ['Test Crawl', 'Test Bear'] }, p2: { battlefield: ['Test Wall', { name: 'Test Bear' }] }, defs: [CRAWL, BEAR, WALL] });
    const b = find(s, 'Test Bear', 'battlefield', 'p1');
    s.objects[b]!.controlledSinceTurn = -1;
    expect(chars(s, b).power).toBe('3');
    s = until(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: b, defender: 'p2' }] });
    s = until(s, 'declareBlockers');
    const wall = find(s, 'Test Wall', 'battlefield', 'p2');
    const bad = applyAction(s, { type: 'answer', player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: wall, attacker: b }] } as never });
    expect(bad.error).toBeDefined();
    const foe = find(s, 'Test Bear', 'battlefield', 'p2');
    const ok = applyAction(s, { type: 'answer', player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: foe, attacker: b }] } as never });
    expect(ok.error).toBeUndefined();
  });
});

describe('CR 509.1c, 611.2c: "Each creature you control gets +3/+3 until end of turn and must be blocked this turn if able."', () => {
  const CALL = card('Test Call', 'Sorcery', 'Each creature you control gets +3/+3 until end of turn and must be blocked this turn if able.');
  it('is automated', () => expect(full(CALL)).toBe(true));
  it('the creatures you control as it resolves get +3/+3; one that enters later does not (CR 611.2c)', () => {
    let s = scenario([], { p1: { hand: ['Test Call'], battlefield: ['Test Bear'] }, defs: [CALL, BEAR] });
    s = resolve(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Call', 'hand', 'p1') })));
    const b = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(chars(s, b).power).toBe('5');
    const late = put(s, 'p1', 'battlefield', 'Test Bear');
    expect(chars(s, late).power).toBe('2');
  });
});

describe('CR 508.1b, 102.3: "Each creature that\'s attacking one of your opponents has trample."', () => {
  const OVI = card('Test Artisan', 'Creature — Artificer', "Each creature that's attacking one of your opponents has trample.", ['1', '1']);
  it('is automated', () => expect(full(OVI)).toBe(true));
  it('an attacking Bear has trample while it attacks the opponent; not before', () => {
    let s = scenario([], { p1: { battlefield: ['Test Artisan', 'Test Bear'] }, defs: [OVI, BEAR] });
    const b = find(s, 'Test Bear', 'battlefield', 'p1');
    s.objects[b]!.controlledSinceTurn = -1;
    expect(has(s, b, 'trample')).toBe(false);
    s = until(s, 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: b, defender: 'p2' }] });
    expect(has(s, b, 'trample')).toBe(true);
    expect(has(s, find(s, 'Test Artisan', 'battlefield', 'p1'), 'trample')).toBe(false);
  });
});

describe('CR 613.4c: "~ gets +2/+0 for every three cards in your graveyard."', () => {
  const MANIP = card('Test Manipulator', 'Creature — Warlock', '~ gets +2/+0 for every three cards in your graveyard.', ['1', '1']);
  it('is automated', () => expect(full(MANIP)).toBe(true));
  it('two cards: +0; three: +2; seven: +4', () => {
    const s = scenario([], { p1: { battlefield: ['Test Manipulator'] }, defs: [MANIP] });
    const m = find(s, 'Test Manipulator', 'battlefield', 'p1');
    for (const [n, p] of [[2, '1'], [3, '3'], [7, '5']] as const) {
      while (s.zones.graveyard.p1!.length < n) put(s, 'p1', 'graveyard', 'Plains');
      expect(chars(s, m).power, `${n} cards`).toBe(p);
      expect(chars(s, m).toughness).toBe('1');
    }
  });
});

describe('CR 700.4, 603.10a: "Draw a card for each creature that died under your control this turn."', () => {
  const LOSS = card('Test Mourning', 'Sorcery', 'Draw a card for each creature that died under your control this turn.');
  const BOLT = card('Test Bolt', 'Instant', '~ deals 3 damage to target creature.');
  it('is automated', () => expect(full(LOSS)).toBe(true));
  it('counts your creature that died, not the opponent\'s', () => {
    let s = scenario([], { p1: { hand: ['Test Bolt', 'Test Bolt', 'Test Mourning'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs: [LOSS, BEAR, BOLT] });
    for (const owner of ['p1', 'p2'] as const) {
      const target = find(s, 'Test Bear', 'battlefield', owner);
      s = resolve(settle(act(s, { type: 'cast', player: 'p1', card: findAll(s, 'Test Bolt', 'hand', 'p1')[0]! }), [{ kind: 'object', id: target }]));
    }
    const before = s.zones.hand.p1!.length;
    s = resolve(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mourning', 'hand', 'p1') })));
    expect(s.zones.hand.p1!.length - (before - 1)).toBe(1);
  });
});

describe('CR 601.2i, 109.2: "... if you\'ve cast another instant or sorcery spell this turn."', () => {
  const CHARGE = card('Test Charge', 'Instant', "Target creature you control gets +2/+0 until end of turn if you've cast another instant or sorcery spell this turn.");
  const CANTRIP = card('Test Cantrip', 'Sorcery', 'Draw a card.');
  it('is automated', () => expect(full(CHARGE)).toBe(true));
  it('alone it does nothing (this spell is not "another"); after another sorcery it gives +2/+0', () => {
    for (const first of [false, true]) {
      let s = scenario([], { p1: { hand: ['Test Charge', 'Test Cantrip'], battlefield: ['Test Bear'] }, defs: [CHARGE, CANTRIP, BEAR] });
      if (first) s = resolve(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Cantrip', 'hand', 'p1') })));
      const b = find(s, 'Test Bear', 'battlefield', 'p1');
      s = resolve(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Charge', 'hand', 'p1') }), [{ kind: 'object', id: b }]));
      expect(chars(s, b).power, `after another spell: ${first}`).toBe(first ? '4' : '2');
    }
  });
});

describe('CR 305.2, 611.3a: "As long as you control a Forest, you may play an additional land on each of your turns."', () => {
  const COMPANY = card('Test Company', 'Creature — Elf', 'As long as you control a Forest, you may play an additional land on each of your turns.', ['1', '1']);
  const FOREST = card('Test Forest', 'Basic Land — Forest', '');
  it('is automated', () => expect(full(COMPANY)).toBe(true));
  it('with a Forest, two lands this turn; without one, the second land is refused', () => {
    for (const forest of [true, false]) {
      let s = scenario([], { p1: { hand: ['Plains', 'Plains'], battlefield: ['Test Company', ...(forest ? ['Test Forest'] : [])] }, defs: [COMPANY, FOREST] });
      s = act(s, { type: 'playLand', player: 'p1', card: s.zones.hand.p1![0]! });
      const r = applyAction(s, { type: 'playLand', player: 'p1', card: s.zones.hand.p1![0]! });
      expect(r.error === undefined, `forest: ${forest}`).toBe(forest);
    }
  });
});

describe('CR 113.6, 613.1f, 702.185: "Artifact cards and red creature cards in your hand have warp {1}."', () => {
  const TANK = card('Test Pilot', 'Creature — Pilot', 'Artifact cards and red creature cards in your hand have warp {1}.', ['2', '2']);
  const RED = compileCard({ name: 'Test Red Ox', layout: 'normal', mana_cost: '{5}{R}', type_line: 'Creature — Ox', oracle_text: '', colors: ['R'], power: '5', toughness: '5' } as OracleCard);
  const GREEN = compileCard({ name: 'Test Green Ox', layout: 'normal', mana_cost: '{5}{G}', type_line: 'Creature — Ox', oracle_text: '', colors: ['G'], power: '5', toughness: '5' } as OracleCard);
  it('is automated', () => expect(full(TANK)).toBe(true));
  it('the red creature card in hand gets warp; the green one does not; on the battlefield nothing has it', () => {
    const s = scenario([], { p1: { hand: ['Test Red Ox', 'Test Green Ox'], battlefield: ['Test Pilot', 'Test Bear', 'Plains'] }, defs: [TANK, RED, GREEN, BEAR] });
    expect(has(s, find(s, 'Test Red Ox', 'hand', 'p1'), 'warp')).toBe(true);
    expect(has(s, find(s, 'Test Green Ox', 'hand', 'p1'), 'warp')).toBe(false);
    expect(has(s, find(s, 'Test Bear', 'battlefield', 'p1'), 'warp')).toBe(false);
    const casts = legal(s, 'p1').filter((a) => (a.action as { card?: string }).card === find(s, 'Test Red Ox', 'hand', 'p1'));
    expect(JSON.stringify(casts)).toContain('warp');
  });
});

describe('CR 709.5c, 709.5j: "~ gets +3/+0 as long as there are two or more unlocked doors among Rooms you control."', () => {
  const room = (l: string, r: string): CardDef => compileCard({
    name: `${l} // ${r}`, layout: 'split', type_line: 'Enchantment — Room // Enchantment — Room', mana_cost: '{0} // {0}', colors: [],
    card_faces: [{ name: l, type_line: 'Enchantment — Room', mana_cost: '{0}', oracle_text: '' }, { name: r, type_line: 'Enchantment — Room', mana_cost: '{0}', oracle_text: '' }],
  } as unknown as OracleCard);
  const HALL = room('Test Hall', 'Test Stair');
  const RAGER = card('Test Rager', 'Creature — Spirit', '~ gets +3/+0 as long as there are two or more unlocked doors among Rooms you control.', ['2', '2']);
  it('is automated', () => expect(full(RAGER)).toBe(true));
  it('one unlocked door: 2 power; both doors of the Room: 5 (the static ability reads them, statics/match.ts)', () => {
    const s = scenario([], { p1: { battlefield: ['Test Rager', HALL.name] }, defs: [RAGER, HALL] });
    const r = find(s, 'Test Rager', 'battlefield', 'p1');
    const h = find(s, HALL.name, 'battlefield', 'p1');
    s.objects[h]!.unlocked = [0];
    expect(chars(s, r).power).toBe('2');
    s.objects[h]!.unlocked = [0, 1];
    expect(chars(s, r).power).toBe('5');
  });
});

describe('CR 611.2a, 613.1f, 613.4c: "<creature> gets -2/-0 and loses flying until your next turn."', () => {
  const FALL = card('Test Fall', 'Instant', 'Target creature gets -2/-0 and loses flying until your next turn.');
  const BIRD = card('Test Bird', 'Creature — Bird', 'Flying', ['3', '3']);
  it('is automated', () => expect(full(FALL)).toBe(true));
  it('the Bird gets -2/-0 and has no flying', () => {
    let s = scenario([], { p1: { hand: ['Test Fall'] }, p2: { battlefield: ['Test Bird'] }, defs: [FALL, BIRD] });
    const b = find(s, 'Test Bird', 'battlefield', 'p2');
    s = resolve(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Fall', 'hand', 'p1') }), [{ kind: 'object', id: b }]));
    expect(chars(s, b).power).toBe('1');
    expect(has(s, b, 'flying')).toBe(false);
  });
});

describe('CR 107.3, 613.4c: "~ gets -X/-X, where X is your life total."', () => {
  const RIDE = card('Test Ride', 'Creature — Horror', '~ gets -X/-X, where X is your life total.', ['30', '30']);
  it('is automated', () => expect(full(RIDE)).toBe(true));
  it('follows its controller\'s life total', () => {
    const s = scenario([], { p1: { battlefield: ['Test Ride'] }, defs: [RIDE] });
    const r = find(s, 'Test Ride', 'battlefield', 'p1');
    expect(chars(s, r).power).toBe('10');
    setLife(s, 'p1', 25);
    expect(chars(s, r).toughness).toBe('5');
  });
});

describe('CR 608.2b, 611.2c: "~ deals 1 damage to target creature. It can\'t block this turn."', () => {
  const DUEL = card('Test Duel', 'Sorcery', '~ deals 1 damage to target creature. It can\'t block this turn.');
  it('is automated, and "it" is the target creature (a sorcery is never a permanent, CR 110.4)', () => {
    expect(full(DUEL)).toBe(true);
    expect(JSON.stringify(DUEL.faces)).toContain('"subject":{"ref":"target","id":"t0"}');
  });
});

describe('CR 120.3, 608.2c: "~ gets +1/+1 until end of turn and deals 1 damage to each opponent."', () => {
  const BULL = card('Test Bull', 'Creature — Minotaur', '{1}: ~ gets +1/+1 until end of turn and deals 1 damage to each opponent.', ['2', '2']);
  it('is automated; the opponent loses 1 life and the Bull is 3/3', () => {
    expect(full(BULL)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Bull', 'Plains'] }, defs: [BULL] });
    const b = find(s, 'Test Bull', 'battlefield', 'p1');
    s = resolve(settle(act(s, { type: 'activate', player: 'p1', source: b, ability: 'p:0:0' })));
    expect(life(s, 'p2')).toBe(19);
    expect(chars(s, b).power).toBe('3');
  });
});

describe('CR 701.14a, 608.2d: "When ~ enters, you may have it fight target creature you don\'t control."', () => {
  const INDRIK = card('Test Indrik', 'Creature — Beast', "When ~ enters, you may have it fight target creature you don't control.", ['4', '4']);
  it('is automated, an optional fight', () => {
    expect(full(INDRIK)).toBe(true);
    expect(JSON.stringify(INDRIK.faces)).toContain('"op":"may"');
    expect(JSON.stringify(INDRIK.faces)).toContain('"op":"fight"');
  });
});

describe('CR 205.1b, 611.2a, 613.1f: "Return target creature card ... It\'s a Skeleton in addition to its other types and has no abilities."', () => {
  const RAISE = card('Test Raise', 'Sorcery', "Return target creature card from your graveyard to the battlefield. It's a Skeleton in addition to its other types and has no abilities.");
  const FLIER = card('Test Flier', 'Creature — Bird', 'Flying', ['2', '2']);
  it('is automated', () => expect(full(RAISE)).toBe(true));
  it('the returned Bird is a Bird Skeleton without flying, for good (no duration)', () => {
    let s = scenario([], { p1: { hand: ['Test Raise'], graveyard: ['Test Flier'] }, defs: [RAISE, FLIER] });
    const g = find(s, 'Test Flier', 'graveyard', 'p1');
    s = resolve(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Raise', 'hand', 'p1') }), [{ kind: 'object', id: g }]));
    const b = find(s, 'Test Flier', 'battlefield', 'p1');
    expect(chars(s, b).subtypes).toEqual(expect.arrayContaining(['Bird', 'Skeleton']));
    expect(has(s, b, 'flying')).toBe(false);
  });
});

describe('CR 611.3a, 613.4b: "As long as there are no cards in your library, ~ has base power and toughness 10/10 and has flying and vigilance."', () => {
  const RIDDLE = card('Test Riddle', 'Creature — Elemental', 'As long as there are no cards in your library, ~ has base power and toughness 10/10 and has flying and vigilance.', ['1', '1']);
  it('is automated; 10/10 with flying only with an empty library', () => {
    expect(full(RIDDLE)).toBe(true);
    const s = scenario([], { p1: { battlefield: ['Test Riddle'] }, defs: [RIDDLE] });
    const r = find(s, 'Test Riddle', 'battlefield', 'p1');
    expect(chars(s, r).power).toBe('1');
    for (const id of s.zones.library.p1!) delete s.objects[id];
    s.zones.library.p1 = [];
    expect(chars(s, r).power).toBe('10');
    expect(has(s, r, 'flying') && has(s, r, 'vigilance')).toBe(true);
  });
});

describe('CR 502.3: "Untap all creatures you control during each other player\'s untap step."', () => {
  const MUSE = card('Test Muse', 'Creature — Spirit', "Untap all creatures you control during each other player's untap step.", ['2', '4']);
  it('is automated', () => expect(full(MUSE)).toBe(true));
  it('in the opponent\'s untap step its controller\'s tapped creatures untap, its tapped land does not', () => {
    let s = scenario([], { p1: { battlefield: ['Test Muse', { name: 'Test Bear', tapped: true }, { name: 'Plains', tapped: true }] }, defs: [MUSE, BEAR] });
    s = advanceTo(s, s.turn.number + 1, 'upkeep');
    expect(s.turn.activePlayer).toBe('p2');
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p1')]!.tapped).toBe(false);
    expect(s.objects[find(s, 'Plains', 'battlefield', 'p1')]!.tapped).toBe(true);
  });
});

describe('CR 608.2h, 613.4b: "... you may have ~\'s base power become equal to that creature\'s power until end of turn."', () => {
  const YEARLING = card('Test Yearling', 'Creature — Dinosaur', "Whenever another Dinosaur you control enters, you may have ~'s base power become equal to that creature's power until end of turn.", ['1', '1']);
  const REX = card('Test Rex', 'Creature — Dinosaur', '', ['6', '6']);
  it('is automated', () => expect(full(YEARLING)).toBe(true));
  it('saying yes makes its base power 6 (toughness unchanged), fixed as the effect begins', () => {
    let s = scenario([], { p1: { hand: ['Test Rex'], battlefield: ['Test Yearling', 'Plains'] }, defs: [YEARLING, REX] });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rex', 'hand', 'p1') }));
    for (let guard = 0; guard < 20 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      if (s.pending?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true } as never);
      else if (s.pending?.kind === 'priority') s = pass(pass(s));
      else break;
    }
    const y = find(s, 'Test Yearling', 'battlefield', 'p1');
    expect(chars(s, y).power).toBe('6');
    expect(chars(s, y).toughness).toBe('1');
    s.objects[find(s, 'Test Rex', 'battlefield', 'p1')]!.counters['+1/+1'] = 2;
    expect(chars(s, y).power).toBe('6');
  });
});

describe('CR 205.3m, 613.4c: "Each non-Human creature you control gets +1/+1 for each of its creature types, to a maximum of 10."', () => {
  const KEEPER = card('Test Keeper', 'Creature — Human Druid', 'Each non-Human creature you control gets +1/+1 for each of its creature types, to a maximum of 10.', ['1', '1']);
  const BEASTS = card('Test Elk Bear', 'Creature — Elk Bear', '', ['1', '1']);
  const SHIFTER = card('Test Shifter', 'Creature — Shapeshifter', 'Changeling', ['1', '1']);
  it('is automated', () => expect(full(KEEPER)).toBe(true));
  it('an Elk Bear gets +2/+2; a changeling is a Human too (every creature type, CR 702.73a) and the Human keeper: nothing', () => {
    const s = scenario([], { p1: { battlefield: ['Test Keeper', 'Test Elk Bear', 'Test Shifter'] }, defs: [KEEPER, BEASTS, SHIFTER] });
    expect(chars(s, find(s, 'Test Elk Bear', 'battlefield', 'p1')).power).toBe('3');
    expect(chars(s, find(s, 'Test Shifter', 'battlefield', 'p1')).power).toBe('1');
    expect(chars(s, find(s, 'Test Keeper', 'battlefield', 'p1')).power).toBe('1');
  });
  it('the maximum: a changeling counts every creature type, capped at 3 here', () => {
    const CAP = card('Test Cap Keeper', 'Creature — Druid', 'Each other creature you control gets +1/+1 for each of its creature types, to a maximum of 3.', ['1', '1']);
    const s = scenario([], { p1: { battlefield: ['Test Cap Keeper', 'Test Elk Bear', 'Test Shifter'] }, defs: [CAP, BEASTS, SHIFTER] });
    expect(chars(s, find(s, 'Test Shifter', 'battlefield', 'p1')).power).toBe('4');
    expect(chars(s, find(s, 'Test Elk Bear', 'battlefield', 'p1')).power).toBe('3');
  });
});
