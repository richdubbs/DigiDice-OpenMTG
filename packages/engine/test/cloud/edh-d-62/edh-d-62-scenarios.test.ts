/**
 * Commander coordinator D, round edh-d-62 (lane commander, third pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Alice (p1) is the active player of turn 1, Bob (p2) the opponent. Each test is named after the rule it checks, with its negative case. CR cites from the
 * Comprehensive Rules of 2026-09-25 (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt), checked where the round's record says so.
 *
 *   CR 111.4, 202.3, 702.10      "Create a Gingerbrute token." (Ginger, Queen of Sweets): a {1} 1/1 Food Golem artifact creature with haste, an evasion ability and a sacrifice-for-life ability
 *   CR 508.1d, 611.2a, 500.1     "During target player's next turn, each creature that player controls attacks if able." (Rowan Kenrith)
 *   CR 611.2a, 613.1f, 613.4b    "Until your next turn, up to two target creatures each have base power and toughness 0/3 and lose all abilities." (Will Kenrith)
 *   CR 601.2f, 118.7, 611.2a     "Until your next turn, instant, sorcery, and planeswalker spells that player casts cost {2} less to cast." (Will Kenrith)
 *   CR 608.2d, 122.1, 105.2      "For each of them, put a number of +1/+1 counters on it equal to the number of colors it is." (Jared Carthalion)
 *   CR 105.2, 608.2c             "If that card was all colors, ..." (Jared Carthalion)
 *   CR 701.17a, 118.12, 119.4    "For each opponent, you mill a card, then return that card ... unless that player pays 3 life." (Sivriss, Nightmare Speaker)
 *   CR 608.2d, 110.2, 108.3      "Target opponent puts a creature card of their choice from their graveyard onto the battlefield under your control." (Visions of Dread)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { answer, pass, put } from '../../m3/scenario';
import { act, card, cast, drive, find, full, legal, resolveAll, scenario } from '../r5-cost/support';

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const bf = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => nameOf(s, id)).sort();
const zoneNames = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: 'p1' | 'p2'): string[] => s.zones[zone][p]!.map((id) => nameOf(s, id));
const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const ptOf = (s: GameState, id: ObjectId): [number, number] => { const c = getChars(s, id)!; return [Number(c.power), Number(c.toughness)]; };
const treasures = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && getChars(s, id)!.subtypes.includes('Treasure'));
const tokensOf = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && nameOf(s, id) === name);
const activate = (s: GameState, name: string, script = {}): GameState => {
  const a = legal(s, 'p1', 'activate').filter((x) => x.object === find(s, name, 'battlefield', 'p1') && x.isMana !== true);
  expect(a.length, name).toBeGreaterThan(0);
  return drive(act(s, a[0]!.action), script);
};
/** Pass priority (and decline attackers/blockers) until `turn` reaches its declare-attackers decision, which is returned unanswered. */
function toDeclare(s0: GameState, turn: number): GameState {
  let s = s0;
  for (let g = 0; g < 600 && !(s.turn.number === turn && s.pending?.kind === 'declareAttackers'); g++) {
    if (s.result) throw new Error('game over');
    const d = s.pending;
    if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d !== null && d.kind !== 'priority') s = drive(s);
    else s = pass(s);
  }
  if (s.turn.number !== turn) throw new Error(`no declare attackers decision in turn ${turn}`);
  return s;
}
/** Pass (declining attacks and blocks, answering other decisions by default) until `turn` is in `step` with a player holding priority. */
function toStep(s0: GameState, turn: number, step: GameState['turn']['step']): GameState {
  let s = s0;
  for (let g = 0; g < 600 && !(s.turn.number === turn && s.turn.step === step && s.pending?.kind === 'priority'); g++) {
    const d = s.pending;
    if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d !== null && d.kind !== 'priority') s = drive(s);
    else s = pass(s);
  }
  return s;
}
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);

// ---- Gingerbrute -------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 111.4, 202.3: "Create a Gingerbrute token." (Ginger, Queen of Sweets)', () => {
  const MAKER = card('Test Baker', 'Creature — Human', 'When this creature enters, create a Gingerbrute token.', '{0}', ['1', '1']);
  const run = () => cast(scenario([], { defs: [MAKER], p1: { hand: ['Test Baker'], battlefield: ['Plains', 'Plains'] } }), 'Test Baker');
  it('is fully automated', () => expect(full(MAKER)).toBe(true));
  it('makes one {1} 1/1 colorless Food Golem artifact creature named Gingerbrute with haste', () => {
    const s = resolveAll(run());
    const [t] = tokensOf(s, 'Gingerbrute');
    expect(tokensOf(s, 'Gingerbrute')).toHaveLength(1);
    expect(ptOf(s, t!)).toEqual([1, 1]);
    const c = getChars(s, t!)!;
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Food', 'Golem']));
    expect(c.colors).toEqual([]);
    expect(c.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword))).toContain('haste');
  });
  it('its abilities: {1}: can\'t be blocked except by creatures with haste (an effect until end of turn), and {2}, {T}, sacrifice it: you gain 3 life', () => {
    const s0 = resolveAll(run());
    const t = tokensOf(s0, 'Gingerbrute')[0]!;
    const a = legal(s0, 'p1', 'activate').filter((x) => x.object === t && x.isMana !== true);
    expect(a).toHaveLength(2);
    const before = life(s0, 'p1');
    // the life ability has a sacrifice cost: it is the one after which the token is gone
    const results = a.map((x) => resolveAll(drive(act(s0, x.action))));
    const gone = results.filter((r) => tokensOf(r, 'Gingerbrute').length === 0);
    expect(gone).toHaveLength(1);
    expect(life(gone[0]!, 'p1')).toBe(before + 3);
    const kept = results.find((r) => tokensOf(r, 'Gingerbrute').length === 1)!;
    expect(life(kept, 'p1')).toBe(before);
  });
  it('negative: two tokens are made by the plural wording only, which is not read', () => {
    expect(full(card('Test Baker Two', 'Creature — Human', 'When this creature enters, create two Gingerbrute tokens.', '{0}', ['1', '1']))).toBe(false);
  });
});

// ---- Rowan Kenrith -----------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 508.1d, 611.2a, 500.1: "During target player\'s next turn, each creature that player controls attacks if able." (Rowan Kenrith)', () => {
  const RING = card('Test Taunt Ring', 'Artifact', '{0}: During target player\'s next turn, each creature that player controls attacks if able.', '{0}');
  const defs = [RING, BEAR];
  const start = () => scenario([], { defs, p1: { battlefield: ['Test Taunt Ring', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
  it('is fully automated', () => expect(full(RING)).toBe(true));
  it('this turn nothing is required of the target player\'s creatures; during that player\'s next turn their creature must attack, and an empty declaration is refused', () => {
    let s = activate(start(), 'Test Taunt Ring', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = resolveAll(s);
    s = toDeclare(s, 2);
    const p = s.pending as unknown as { player: string; candidates: { id: string; mustAttack?: boolean }[] };
    expect(p.player).toBe('p2');
    expect(p.candidates.find((c) => c.id === find(s, 'Test Bear', 'battlefield', 'p2'))?.mustAttack).toBe(true);
    const r = (() => { try { answer(s, { kind: 'declareAttackers', attacks: [] }); return null; } catch (e) { return String(e); } })();
    expect(r, 'declaring no attackers must be refused').not.toBeNull();
  });
  it('negative: the requirement lasts that one turn: p2\'s next turn after it is free', () => {
    let s = activate(start(), 'Test Taunt Ring', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = resolveAll(s);
    s = toDeclare(s, 2);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Bear', 'battlefield', 'p2'), defender: 'p1' }] });
    s = toDeclare(s, 4);
    const p = s.pending as unknown as { candidates: { id: string; mustAttack?: boolean }[] };
    expect(p.candidates.find((c) => c.id === find(s, 'Test Bear', 'battlefield', 'p2'))?.mustAttack).not.toBe(true);
  });
  it('negative: the activator\'s own creature is not required to attack in its own turn', () => {
    const s0 = activate(start(), 'Test Taunt Ring', { targets: [[{ kind: 'player', id: 'p2' }]] });
    const s = toDeclare(resolveAll(s0), 1);
    const p = s.pending as unknown as { player: string; candidates: { id: string; mustAttack?: boolean }[] };
    expect(p.player).toBe('p1');
    expect(p.candidates.some((c) => c.mustAttack === true)).toBe(false);
  });
});

// ---- Will Kenrith -------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 611.2a, 613.1f, 613.4b: "Until your next turn, up to two target creatures each have base power and toughness 0/3 and lose all abilities." (Will Kenrith)', () => {
  const RING = card('Test Dull Ring', 'Artifact', '{0}: Until your next turn, up to two target creatures each have base power and toughness 0/3 and lose all abilities.', '{0}');
  const FLYER = card('Test Flyer', 'Creature — Bird', 'Flying', '{0}', ['3', '3']);
  const defs = [RING, BEAR, FLYER];
  const start = () => scenario([], { defs, p1: { battlefield: ['Test Dull Ring'] }, p2: { battlefield: ['Test Bear', 'Test Flyer'] } });
  const kw = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword));
  it('is fully automated', () => expect(full(RING)).toBe(true));
  it('two targets become 0/3 and lose flying until the activator\'s next turn begins; then they are as printed again', () => {
    const s0 = start();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const flyer = find(s0, 'Test Flyer', 'battlefield', 'p2');
    let s = resolveAll(activate(s0, 'Test Dull Ring', { targets: [[{ kind: 'object', id: bear }, { kind: 'object', id: flyer }]] }));
    expect(ptOf(s, bear)).toEqual([0, 3]);
    expect(ptOf(s, flyer)).toEqual([0, 3]);
    expect(kw(s, flyer)).not.toContain('flying');
    s = toStep(s, 2, 'main1'); // p2's turn: still in force ("until your next turn")
    expect(ptOf(s, flyer)).toEqual([0, 3]);
    s = toStep(s, 3, 'main1');
    expect(ptOf(s, bear)).toEqual([2, 2]);
    expect(ptOf(s, flyer)).toEqual([3, 3]);
    expect(kw(s, flyer)).toContain('flying');
  });
  it('negative: a creature that was not chosen is untouched, and one target is allowed ("up to two")', () => {
    const s0 = start();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const flyer = find(s0, 'Test Flyer', 'battlefield', 'p2');
    const s = resolveAll(activate(s0, 'Test Dull Ring', { targets: [[{ kind: 'object', id: bear }]] }));
    expect(ptOf(s, bear)).toEqual([0, 3]);
    expect(ptOf(s, flyer)).toEqual([3, 3]);
    expect(kw(s, flyer)).toContain('flying');
  });
});

describe('CR 601.2f, 118.7, 611.2a: "Target player draws two cards. Until your next turn, instant, sorcery, and planeswalker spells that player casts cost {2} less to cast." (Will Kenrith)', () => {
  const RING = card('Test Boon Ring', 'Artifact', '{0}: Target player draws two cards. Until your next turn, instant, sorcery, and planeswalker spells that player casts cost {2} less to cast.', '{0}');
  const CHARM = card('Test Charm', 'Instant', 'You gain 1 life.', '{2}');
  const BEAR2 = card('Test Costly Bear', 'Creature — Bear', '', '{2}', ['2', '2']);
  const defs = [RING, CHARM, BEAR2];
  const castable = (s: GameState, p: 'p1' | 'p2', name: string): boolean => legal(s, p, 'cast').some((x) => x.object === find(s, name, 'hand', p));
  const start = () => scenario([], { defs, p1: { hand: ['Test Charm'], battlefield: ['Test Boon Ring'] }, p2: { hand: ['Test Charm', 'Test Costly Bear'] } });
  it('is fully automated', () => expect(full(RING)).toBe(true));
  it('the target player draws two and can cast an instant for {0} (a {2} instant) until the activator\'s next turn; their creature spell is not cheaper; the activator\'s own instant is not cheaper', () => {
    const s0 = toStep(start(), 2, 'main1');
    expect(castable(s0, 'p2', 'Test Charm')).toBe(false); // no mana, no reduction yet
    const t1 = start();
    let s = toStep(resolveAll(activate(t1, 'Test Boon Ring', { targets: [[{ kind: 'player', id: 'p2' }]] })), 2, 'main1');
    expect(zoneNames(s, 'hand', 'p2').filter((n) => n === 'Test Charm' || n === 'Test Costly Bear')).toHaveLength(2);
    expect(castable(s, 'p2', 'Test Charm')).toBe(true);
    expect(castable(s, 'p2', 'Test Costly Bear')).toBe(false); // a creature spell: not in the list
    s = cast(s, 'Test Charm', {}, 'p2');
    expect(s.zones.stack.length + life(s, 'p2')).toBeGreaterThan(20); // cast for {0} and resolved or waiting
    expect(castable(toStep(resolveAll(activate(start(), 'Test Boon Ring', { targets: [[{ kind: 'player', id: 'p2' }]] })), 1, 'main1'), 'p1', 'Test Charm')).toBe(false); // "that player", not the activator
  });
  it('negative: once the activator\'s next turn begins, the reduction is gone', () => {
    let s = resolveAll(activate(start(), 'Test Boon Ring', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    s = toStep(s, 4, 'main1');
    expect(castable(s, 'p2', 'Test Charm')).toBe(false);
  });
});

// ---- Jared Carthalion ----------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 608.2d, 122.1, 105.2: "Choose up to two target creatures. For each of them, put a number of +1/+1 counters on it equal to the number of colors it is." (Jared Carthalion)', () => {
  const RING = card('Test Hue Ring', 'Artifact', '{0}: Choose up to two target creatures. For each of them, put a number of +1/+1 counters on it equal to the number of colors it is.', '{0}');
  const TWO = card('Test Two Hue', 'Creature — Bear', '', '{0}', ['1', '1'], ['W', 'U']);
  const NONE = card('Test No Hue', 'Creature — Golem', '', '{0}', ['1', '1']);
  const THREE = card('Test Three Hue', 'Creature — Bear', '', '{0}', ['1', '1'], ['W', 'U', 'B']);
  const defs = [RING, TWO, NONE, THREE];
  const start = () => scenario([], { defs, p1: { battlefield: ['Test Hue Ring', 'Test Two Hue', 'Test No Hue', 'Test Three Hue'] } });
  const counters = (s: GameState, name: string): number => s.objects[find(s, name, 'battlefield', 'p1')]!.counters?.['+1/+1'] ?? 0;
  it('is fully automated', () => expect(full(RING)).toBe(true));
  it('each chosen creature gets one counter per color it is; a colorless one gets none; a creature that was not chosen gets none', () => {
    const s0 = start();
    const two = find(s0, 'Test Two Hue', 'battlefield', 'p1');
    const none = find(s0, 'Test No Hue', 'battlefield', 'p1');
    const s = resolveAll(activate(s0, 'Test Hue Ring', { targets: [[{ kind: 'object', id: two }, { kind: 'object', id: none }]] }));
    expect(counters(s, 'Test Two Hue')).toBe(2);
    expect(counters(s, 'Test No Hue')).toBe(0);
    expect(counters(s, 'Test Three Hue')).toBe(0);
    expect(ptOf(s, two)).toEqual([3, 3]);
  });
  it('negative: choosing no creature ("up to two") does nothing, and one creature is enough', () => {
    const s0 = start();
    const three = find(s0, 'Test Three Hue', 'battlefield', 'p1');
    const s = resolveAll(activate(s0, 'Test Hue Ring', { targets: [[{ kind: 'object', id: three }]] }));
    expect(counters(s, 'Test Three Hue')).toBe(3);
    expect(counters(s, 'Test Two Hue')).toBe(0);
  });
});

describe('CR 105.2, 608.2c: "Return target multicolored card from your graveyard to your hand. If that card was all colors, draw a card and create two Treasure tokens." (Jared Carthalion)', () => {
  const RING = card('Test Rainbow Ring', 'Artifact', '{0}: Return target multicolored card from your graveyard to your hand. If that card was all colors, draw a card and create two Treasure tokens.', '{0}');
  const ALL = card('Test All Hue', 'Creature — Bear', '', '{0}', ['1', '1'], ['W', 'U', 'B', 'R', 'G']);
  const FOUR = card('Test Four Hue', 'Creature — Bear', '', '{0}', ['1', '1'], ['W', 'U', 'B', 'R']);
  const defs = [RING, ALL, FOUR];
  const run = (name: string): GameState => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Rainbow Ring'], graveyard: [name] } });
    return resolveAll(activate(s0, 'Test Rainbow Ring', { targets: [[{ kind: 'object', id: find(s0, name, 'graveyard', 'p1') }]] }));
  };
  it('is fully automated', () => expect(full(RING)).toBe(true));
  it('a five-color card returns, you draw a card and get two Treasures', () => {
    const s = run('Test All Hue');
    expect(zoneNames(s, 'hand', 'p1')).toContain('Test All Hue');
    expect(zoneNames(s, 'hand', 'p1')).toHaveLength(2); // the card and the drawn Plains
    expect(treasures(s)).toHaveLength(2);
  });
  it('negative: a four-color card returns and nothing more happens (CR 105.2: "all colors" is five)', () => {
    const s = run('Test Four Hue');
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Four Hue']);
    expect(treasures(s)).toHaveLength(0);
  });
});

// ---- Sivriss, Nightmare Speaker -----------------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.17a, 118.12, 119.4: "For each opponent, you mill a card, then return that card from your graveyard to your hand unless that player pays 3 life." (Sivriss, Nightmare Speaker)', () => {
  const RING = card('Test Dredge Ring', 'Artifact', '{0}: For each opponent, you mill a card, then return that card from your graveyard to your hand unless that player pays 3 life.', '{0}');
  const TOP = card('Test Top Card', 'Sorcery', '', '{0}');
  const defs = [RING, TOP];
  const start = (p2life = 20) => { const s = scenario([], { defs, p1: { battlefield: ['Test Dredge Ring'] } }); for (const id of s.zones.library.p1!) delete s.objects[id]; s.zones.library.p1 = []; put(s, 'p1', 'library', 'Test Top Card'); put(s, 'p1', 'library', 'Test Top Card'); s.players.find((p) => p.id === 'p2')!.life = p2life; return s; };
  it('is fully automated', () => expect(full(RING)).toBe(true));
  it('the opponent declines to pay: the milled card goes to your hand', () => {
    const s = resolveAll(activate(start(), 'Test Dredge Ring'), { yes: [false] });
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Top Card']);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual([]);
    expect(life(s, 'p2')).toBe(20);
  });
  it('the opponent pays 3 life: the card stays in the graveyard', () => {
    const s = resolveAll(activate(start(), 'Test Dredge Ring'), { yes: [true] });
    expect(zoneNames(s, 'hand', 'p1')).toEqual([]);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Top Card']);
    expect(life(s, 'p2')).toBe(17);
    expect(life(s, 'p1')).toBe(20);
  });
  it('negative (CR 614.6, 701.17a): when a replacement exiles the milled card it never reaches the graveyard, so nothing is returned', () => {
    const RIP = card('Test Pit', 'Enchantment', 'If a card would be put into a graveyard from anywhere, exile it instead.', '{0}');
    const s0 = scenario([], { defs: [RING, TOP, RIP], p1: { battlefield: ['Test Dredge Ring', 'Test Pit'] } });
    for (const id of s0.zones.library.p1!) delete s0.objects[id];
    s0.zones.library.p1 = [];
    put(s0, 'p1', 'library', 'Test Top Card');
    put(s0, 'p1', 'library', 'Test Top Card');
    const s = resolveAll(activate(s0, 'Test Dredge Ring'), { yes: [false] });
    expect(zoneNames(s, 'hand', 'p1')).toEqual([]);
  });
  it('negative (CR 119.4): an opponent with 2 life cannot pay 3, so the card returns', () => {
    const s = resolveAll(activate(start(2), 'Test Dredge Ring'), { yes: [true] });
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Top Card']);
    expect(life(s, 'p2')).toBe(2);
  });
});

// ---- Visions of Dread ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 608.2d, 110.2, 108.3: "Target opponent puts a creature card of their choice from their graveyard onto the battlefield under your control." (Visions of Dread)', () => {
  const VISION = card('Test Dread Vision', 'Sorcery', 'Target opponent puts a creature card of their choice from their graveyard onto the battlefield under your control.', '{0}');
  const A = card('Test Ghoul A', 'Creature — Zombie', '', '{0}', ['1', '1']);
  const B = card('Test Ghoul B', 'Creature — Zombie', '', '{0}', ['2', '2']);
  const RELIC = card('Test Grave Relic', 'Artifact', '', '{0}');
  const defs = [VISION, A, B, RELIC];
  it('is fully automated', () => expect(full(VISION)).toBe(true));
  it('the opponent (not you) chooses among their own creature cards only, and it enters under your control', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Dread Vision'], graveyard: ['Test Ghoul A'] }, p2: { graveyard: ['Test Ghoul A', 'Test Ghoul B', 'Test Grave Relic'] } });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Dread Vision', 'hand', 'p1') }), { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = act(s, { type: 'pass', player: 'p1' });
    s = act(s, { type: 'pass', player: 'p2' });
    // the decision belongs to p2 and offers their two creature cards
    const p = s.pending as unknown as { kind: string; player: string; options: string[] };
    expect(p.kind).toBe('chooseObjects');
    expect(p.player).toBe('p2');
    expect(p.options.map((id) => nameOf(s, id)).sort()).toEqual(['Test Ghoul A', 'Test Ghoul B']);
    expect(p.options.every((id) => s.objects[id]!.owner === 'p2')).toBe(true);
    const pick = p.options.find((id) => nameOf(s, id) === 'Test Ghoul B')!;
    s = resolveAll(drive(s, { objects: [[pick]] }));
    expect(bf(s, 'p1')).toEqual(['Test Ghoul B']);
    expect(s.objects[s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Ghoul B')!]!.owner).toBe('p2');
    expect(zoneNames(s, 'graveyard', 'p2').sort()).toEqual(['Test Ghoul A', 'Test Grave Relic']);
    expect(zoneNames(s, 'graveyard', 'p1').sort()).toEqual(['Test Dread Vision', 'Test Ghoul A']);
  });
  it('negative: with no creature card in their graveyard nothing happens', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Dread Vision'] }, p2: { graveyard: ['Test Grave Relic'] } });
    const s = resolveAll(cast(s0, 'Test Dread Vision', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(bf(s, 'p1')).toEqual([]);
    expect(bf(s, 'p2')).toEqual([]);
  });
});
