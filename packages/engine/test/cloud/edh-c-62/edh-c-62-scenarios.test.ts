/**
 * Commander EDHREC ranks 25,001-25,500, round edh-c-62 (second pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 701.19c, 701.8a            "Destroy that creature. The creature can't be regenerated."
 *   CR 702.33c-d, 121.1           "Counter target spell unless its controller pays {2}. Draw a card for each time ~ was kicked."
 *   CR 105.1, 202.2, 608.2c       "{T}: Destroy target creature if it shares a color with the most common color among all permanents or a color tied for most common."
 *   CR 601.2i, 202.3, 608.2h      "Whenever you cast a spell with mana value equal to the number of doom counters on ~, ~ deals that much damage to any target. Then put a doom counter on ~."
 *   CR 701.20a, 122.1, 121.1      "When ~ enters, each player reveals the top card of their library. For each nonland card revealed this way, put a +1/+1 counter on ~. Then each player draws a card."
 *   CR 604.1, 613.1d, 613.4b      "During turns other than yours, ~ is a 2/3 Gargoyle artifact creature with flying."
 *   CR 611.2c, 613.1b, 110.2      "When ~ enters, target opponent gains control of all other permanents you control."
 *   CR 603.7, 117.3, 608.2d       "Whenever a player casts a spell, they may pay {1}. If the player does, they draw a card at the beginning of the next end step."
 *   CR 603.4, 601.2i              "At the beginning of each opponent's end step, if that player didn't cast a creature spell this turn, create a 2/2 green Lizard creature token."
 *   CR 508.1c, 611.2a             "Discard another card named ~: Target player can't cast spells this turn, and creatures that player controls can't attack this turn."
 */
import { describe, expect, it } from 'vitest';
import { getChars } from '../../../src/index';
import type { GameState, ObjectId } from '../../../src/index';
import { act, advanceTo, answer, card, cast, drive, find, full, legal, lifeOf, named, obj, resolveAll, scenario } from '../r4-cost/support';
import { pass } from '../../m3/scenario';

const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const names = (s: GameState, zone: 'battlefield' | 'graveyard', p: 'p1' | 'p2'): string[] =>
  zone === 'battlefield' ? s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => s.objects[id]!.defId) : s.zones.graveyard[p]!.map((id) => s.objects[id]!.defId);

describe('CR 701.19c, 701.8a: "Destroy target creature. The creature can\'t be regenerated."', () => {
  const KILL = card('Test Hard Kill', 'Sorcery', 'Destroy target creature. The creature can\'t be regenerated.', '{0}', undefined, ['B']);
  const SOFT = card('Test Soft Kill', 'Sorcery', 'Destroy target creature.', '{0}', undefined, ['B']);
  const BEAR = card('Test Regen Bear', 'Creature — Bear', '{0}: Regenerate Test Regen Bear.', '{0}', ['2', '2'], ['G']);
  /** p1 casts the spell at the Bear; p2 responds by regenerating it (a shield), then the spell resolves. */
  const run = (spell: string): GameState => {
    let s = scenario([], { defs: [KILL, SOFT, BEAR], p1: { hand: [spell] }, p2: { battlefield: ['Test Regen Bear'] } });
    const bear = find(s, 'Test Regen Bear', 'battlefield', 'p2');
    s = cast(s, spell, { targets: [[obj(bear)]] });
    s = pass(s);
    s = drive(act(s, { type: 'activate', player: 'p2', source: bear, ability: 'p:0:0' }));
    return resolveAll(s);
  };
  it('is full', () => expect(full(KILL)).toBe(true));
  it('the Bear has a regeneration shield but is destroyed anyway and goes to the graveyard', () => {
    const s = run('Test Hard Kill');
    expect(names(s, 'battlefield', 'p2')).not.toContain('Test Regen Bear');
    expect(names(s, 'graveyard', 'p2')).toContain('Test Regen Bear');
  });
  it('negative: a destroy without the rider is regenerated (the Bear stays, tapped)', () => {
    const s = run('Test Soft Kill');
    expect(names(s, 'battlefield', 'p2')).toContain('Test Regen Bear');
    expect(s.objects[named(s, 'Test Regen Bear')[0]!]!.tapped).toBe(true);
  });
});

// ---- Spell Contortion -------------------------------------------------------------------------------------------------------------------------------------
describe('CR 702.33c-d, 121.1: "Counter target spell unless its controller pays {2}. Draw a card for each time ~ was kicked."', () => {
  const PAIR = card('Test Warp Pair', 'Instant', 'Multikicker {1}{U}\nCounter target spell unless its controller pays {2}. Draw a card for each time Test Warp Pair was kicked.', '{U}', undefined, ['U']);
  const GAIN = card('Test Gain Spell', 'Sorcery', 'You gain 5 life.');
  /** p1 casts a Gain Spell, then (holding priority) the Pair at it, kicked `kicks` times with exactly enough Islands, so the {2} cannot be paid. */
  const run = (kicks: number): GameState => {
    const s0 = scenario(['Island'], { defs: [PAIR, GAIN], p1: { hand: ['Test Gain Spell', 'Test Warp Pair'], battlefield: Array(1 + 2 * kicks).fill('Island') as string[] } });
    const withSpell = cast(s0, 'Test Gain Spell');
    const spell = withSpell.zones.stack[0]!;
    let s = act(withSpell, { type: 'cast', player: 'p1', card: find(withSpell, 'Test Warp Pair', 'hand', 'p1') });
    if (s.pending?.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: kicks });
    for (let g = 0; g < 6 && s.pending && s.pending.kind !== 'priority'; g++) {
      const d = s.pending;
      if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [obj(spell)] });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    return resolveAll(s);
  };
  it('is full', () => expect(full(PAIR)).toBe(true));
  it('kicked twice: the spell is countered (no life gained) and two cards are drawn', () => {
    const s = run(2);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(s.zones.hand['p1']).toHaveLength(2);
  });
  it('negative: not kicked draws no card (the spell is still countered); kicked once draws one', () => {
    const s0 = run(0);
    expect(lifeOf(s0, 'p1')).toBe(20);
    expect(s0.zones.hand['p1']).toHaveLength(0);
    expect(run(1).zones.hand['p1']).toHaveLength(1);
  });
});

// ---- Tsabo's Assassin -------------------------------------------------------------------------------------------------------------------------------------
describe('CR 105.1, 202.2, 608.2c: "{T}: Destroy target creature if it shares a color with the most common color among all permanents or a color tied for most common. A creature destroyed this way can\'t be regenerated."', () => {
  const HUNTER = card('Test Dusk Hunter', 'Creature — Zombie Assassin', '{T}: Destroy target creature if it shares a color with the most common color among all permanents or a color tied for most common. A creature destroyed this way can\'t be regenerated.', '{0}', ['2', '2'], ['B']);
  const mk = (n: string, c: string[]) => card(n, 'Creature — Bear', '', '{0}', ['2', '2'], c);
  const GREEN1 = mk('Test Green One', ['G']);
  const GREEN2 = mk('Test Green Two', ['G']);
  const RED1 = mk('Test Red One', ['R']);
  const GOLEM = card('Test Grey Golem', 'Artifact Creature — Golem', '', '{0}', ['2', '2']);
  const GW = mk('Test Green White', ['G', 'W']);
  const defs = [HUNTER, GREEN1, GREEN2, RED1, GOLEM, GW];
  const strike = (mine: string[], theirs: string[], target: string): GameState => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Dusk Hunter', ...mine] }, p2: { battlefield: theirs } });
    const t = find(s0, target, 'battlefield', theirs.includes(target) ? 'p2' : 'p1');
    return resolveAll(drive(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Dusk Hunter', 'battlefield', 'p1'), ability: 'p:0:0' }), { targets: [[obj(t)]] }));
  };
  it('is full', () => expect(full(HUNTER)).toBe(true));
  it('green is the most common color (two green permanents): a green creature is destroyed', () => {
    const s = strike([], ['Test Green One', 'Test Green Two', 'Test Red One'], 'Test Green One');
    expect(names(s, 'graveyard', 'p2')).toContain('Test Green One');
  });
  it('negative: a red creature, when green is more common, is not destroyed', () => {
    const s = strike([], ['Test Green One', 'Test Green Two', 'Test Red One'], 'Test Red One');
    expect(names(s, 'battlefield', 'p2')).toContain('Test Red One');
  });
  it('a color tied for most common counts (green, red and black each once: the red creature is destroyed)', () => {
    const s = strike([], ['Test Green One', 'Test Red One'], 'Test Red One');
    expect(names(s, 'graveyard', 'p2')).toContain('Test Red One');
  });
  it('negative: a colorless creature shares no color, and the Hunter is destroyed by itself only when it is the target of a common color', () => {
    const s = strike([], ['Test Green One', 'Test Green Two', 'Test Grey Golem'], 'Test Grey Golem');
    expect(names(s, 'battlefield', 'p2')).toContain('Test Grey Golem');
  });
  it('a multicolored creature shares a color if any of its colors is the most common (green-white with two green permanents)', () => {
    const s = strike([], ['Test Green One', 'Test Green Two', 'Test Green White'], 'Test Green White');
    expect(names(s, 'graveyard', 'p2')).toContain('Test Green White');
  });
});

// ---- Imminent Doom ----------------------------------------------------------------------------------------------------------------------------------------
describe('CR 601.2i, 202.3, 608.2h: "Whenever you cast a spell with mana value equal to the number of doom counters on ~, ~ deals that much damage to any target. Then put a doom counter on ~."', () => {
  const DOOM = card('Test Doom Clock', 'Enchantment', 'Test Doom Clock enters with a doom counter on it.\nWhenever you cast a spell with mana value equal to the number of doom counters on Test Doom Clock, Test Doom Clock deals that much damage to any target. Then put a doom counter on Test Doom Clock.', '{0}', undefined, ['R']);
  const ONE = card('Test One Spell', 'Sorcery', 'You gain 1 life.', '{1}');
  const TWO = card('Test Two Spell', 'Sorcery', 'You gain 1 life.', '{2}');
  const QUICK = card('Test One Instant', 'Instant', 'You gain 1 life.', '{1}');
  const board = (): GameState => {
    const s0 = scenario([], { defs: [DOOM, ONE, TWO, QUICK], p1: { hand: ['Test Doom Clock', 'Test One Spell', 'Test One Spell', 'Test Two Spell', 'Test One Instant', 'Test One Instant'], battlefield: Array(6).fill('Plains') as string[] } });
    return resolveAll(cast(s0, 'Test Doom Clock'));
  };
  const counters = (s: GameState): number => s.objects[named(s, 'Test Doom Clock')[0]!]!.counters['doom'] ?? 0;
  const P2 = { kind: 'player', id: 'p2' } as const;
  it('is full', () => expect(full(DOOM)).toBe(true));
  it('enters with one doom counter; a spell of mana value 1 deals 1 damage to the chosen target and adds a counter', () => {
    const s0 = board();
    expect(counters(s0)).toBe(1);
    const s = resolveAll(cast(s0, 'Test One Spell', { targets: [[P2]] }));
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(counters(s)).toBe(2);
  });
  it('then a spell of mana value 2 deals 2 damage', () => {
    const s0 = board();
    const s1 = resolveAll(cast(s0, 'Test One Spell', { targets: [[P2]] }));
    const s = resolveAll(cast(s1, 'Test Two Spell', { targets: [[P2]] }));
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(counters(s)).toBe(3);
  });
  it('negative: a spell whose mana value is not the number of counters (a 2 with one counter) does nothing', () => {
    const s = resolveAll(cast(board(), 'Test Two Spell', { targets: [[P2]] }));
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(counters(s)).toBe(1);
  });
  it('ruling 2017-07-14: two mana value 1 spells cast with one counter on it each trigger and each deals 1 damage ("that much" is the spell\'s mana value, not the counters now); it ends with three counters', () => {
    const s0 = board();
    const s1 = cast(s0, 'Test One Instant', { targets: [[P2]] });
    const s2 = cast(s1, 'Test One Instant', { targets: [[P2]] });
    expect(s2.zones.stack.length).toBe(4);
    const s = resolveAll(s2);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(counters(s)).toBe(3);
  });
});

// ---- Selvala's Enforcer -----------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.20a, 122.1, 121.1: "When ~ enters, each player reveals the top card of their library. For each nonland card revealed this way, put a +1/+1 counter on ~. Then each player draws a card."', () => {
  const ELF = card('Test Parley Elf', 'Creature — Elf Warrior', 'When Test Parley Elf enters, each player reveals the top card of their library. For each nonland card revealed this way, put a +1/+1 counter on Test Parley Elf. Then each player draws a card.', '{0}', ['3', '3'], ['G']);
  const SPELL = card('Test Plain Spell', 'Sorcery', 'You gain 1 life.', '{1}');
  const run = (mine: string, theirs: string): GameState => resolveAll(cast(scenario([], { defs: [ELF, SPELL], p1: { hand: ['Test Parley Elf'], library: [mine] }, p2: { library: [theirs] } }), 'Test Parley Elf'));
  const elf = (s: GameState): ObjectId => named(s, 'Test Parley Elf')[0]!;
  it('is full', () => expect(full(ELF)).toBe(true));
  it('one nonland card and one land revealed: one counter; each player draws the revealed card', () => {
    const s = run('Test Plain Spell', 'Plains');
    expect(pt(s, elf(s))).toBe('4/4');
    expect(names(s, 'battlefield', 'p1')).toContain('Test Parley Elf');
    expect(s.zones.hand['p1']!.map((id) => s.objects[id]!.defId)).toEqual(['Test Plain Spell']);
    expect(s.zones.hand['p2']!.map((id) => s.objects[id]!.defId)).toEqual(['Plains']);
  });
  it('two nonland cards: two counters', () => {
    const s = run('Test Plain Spell', 'Test Plain Spell');
    expect(pt(s, elf(s))).toBe('5/5');
  });
  it('negative: two lands put no counter, and the player still draws', () => {
    const s = run('Plains', 'Plains');
    expect(pt(s, elf(s))).toBe('3/3');
    expect(s.zones.hand['p1']).toHaveLength(1);
    expect(s.zones.hand['p2']).toHaveLength(1);
  });
});

// ---- Warden of the Wall -----------------------------------------------------------------------------------------------------------------------------------
describe('CR 604.1, 613.1d, 613.1f, 613.4b: "During turns other than yours, ~ is a 2/3 Gargoyle artifact creature with flying."', () => {
  const WALL = card('Test Wall Gargoyle', 'Artifact', 'Test Wall Gargoyle enters tapped.\n{T}: Add {C}.\nDuring turns other than yours, Test Wall Gargoyle is a 2/3 Gargoyle artifact creature with flying.', '{3}');
  const board = (): GameState => scenario([], { defs: [WALL], p1: { battlefield: ['Test Wall Gargoyle'] } });
  it('is full', () => expect(full(WALL)).toBe(true));
  it('on its controller\'s own turn it is only an artifact (no power, no flying)', () => {
    const s = board();
    const c = getChars(s, named(s, 'Test Wall Gargoyle')[0]!)!;
    expect(c.types).toEqual(['Artifact']);
    expect(c.subtypes).not.toContain('Gargoyle');
    expect(c.keywords?.some((k) => k.keyword === 'flying') ?? false).toBe(false);
  });
  it('during the opponent\'s turn it is a 2/3 Gargoyle artifact creature with flying', () => {
    const s = advanceTo(board(), 2, 'main1');
    const c = getChars(s, named(s, 'Test Wall Gargoyle')[0]!)!;
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    expect(c.subtypes).toContain('Gargoyle');
    expect(`${c.power}/${c.toughness}`).toBe('2/3');
    expect(JSON.stringify(c)).toContain('flying');
  });
  it('negative: back on its controller\'s next turn it is an artifact again', () => {
    const s = advanceTo(board(), 3, 'main1');
    expect(getChars(s, named(s, 'Test Wall Gargoyle')[0]!)!.types).toEqual(['Artifact']);
  });
});

// ---- Sky Swallower ----------------------------------------------------------------------------------------------------------------------------------------
describe('CR 611.2c, 613.1b, 110.2: "When ~ enters, target opponent gains control of all other permanents you control."', () => {
  const TITAN = card('Test Sky Titan', 'Creature — Leviathan', 'Flying\nWhen Test Sky Titan enters, target opponent gains control of all other permanents you control.', '{0}', ['6', '5'], ['U']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', '{0}', ['2', '2'], ['G']);
  const RING = card('Test Plain Ring', 'Artifact', '', '{0}');
  const FOE = card('Test Foe Bear', 'Creature — Bear', '', '{0}', ['2', '2'], ['G']);
  const LATE = card('Test Late Bear', 'Creature — Bear', '', '{0}', ['2', '2'], ['G']);
  const run = (): GameState => resolveAll(cast(scenario([], { defs: [TITAN, BEAR, RING, FOE, LATE], p1: { hand: ['Test Sky Titan', 'Test Late Bear'], battlefield: ['Test Plain Bear', 'Test Plain Ring', 'Plains'] }, p2: { battlefield: ['Test Foe Bear'] } }), 'Test Sky Titan'), { targets: [[{ kind: 'player', id: 'p2' }]] });
  it('is full', () => expect(full(TITAN)).toBe(true));
  it('every other permanent you control (creature, artifact and land) goes to the opponent; the Titan stays', () => {
    const s = run();
    expect(names(s, 'battlefield', 'p1')).toEqual(['Test Sky Titan']);
    expect(names(s, 'battlefield', 'p2').sort()).toEqual(['Plains', 'Test Foe Bear', 'Test Plain Bear', 'Test Plain Ring']);
  });
  it('negative: the opponent\'s own permanents are untouched, and a permanent that enters later (CR 611.2c, the set is fixed) stays with you', () => {
    const s0 = run();
    const s = resolveAll(cast(s0, 'Test Late Bear'));
    expect(names(s, 'battlefield', 'p1').sort()).toEqual(['Test Late Bear', 'Test Sky Titan']);
    expect(names(s, 'battlefield', 'p2')).toContain('Test Foe Bear');
  });
});

// ---- Horn of Plenty ---------------------------------------------------------------------------------------------------------------------------------------
describe('CR 603.7, 117.3, 608.2d: "Whenever a player casts a spell, they may pay {1}. If the player does, they draw a card at the beginning of the next end step."', () => {
  const HORN = card('Test Horn Cup', 'Artifact', 'Whenever a player casts a spell, they may pay {1}. If the player does, they draw a card at the beginning of the next end step.', '{6}');
  const GAIN = card('Test Quick Gain', 'Instant', 'You gain 1 life.');
  const SORC = card('Test Slow Gain', 'Sorcery', 'You gain 1 life.');
  const board = (): GameState => scenario([], { defs: [HORN, GAIN, SORC], p1: { hand: ['Test Slow Gain'], battlefield: ['Test Horn Cup', 'Plains', 'Plains'] }, p2: { hand: ['Test Quick Gain'], battlefield: ['Plains', 'Plains'] } });
  const handSize = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;
  /** the opponent casts an instant on p1's turn and answers "pay {1}?" with `pay`; then play to the end step and let the delayed trigger resolve */
  const oppCasts = (pay: boolean): GameState => {
    let s = pass(board());
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Quick Gain', 'hand', 'p2') }), { yes: [pay] });
    s = resolveAll(s, { yes: [pay] });
    s = advanceTo(s, 1, 'end');
    return resolveAll(s);
  };
  it('is full', () => expect(full(HORN)).toBe(true));
  it('the opponent who cast the spell and paid {1} draws the card at the next end step (not the controller of the Horn)', () => {
    const s = oppCasts(true);
    expect(handSize(s, 'p2')).toBe(1);
    expect(handSize(s, 'p1')).toBe(1);
  });
  it('negative: declining to pay draws nothing', () => {
    const s = oppCasts(false);
    expect(handSize(s, 'p2')).toBe(0);
    expect(handSize(s, 'p1')).toBe(1);
  });
  it('the controller\'s own spell also triggers it: paying {1} draws at the next end step', () => {
    let s = cast(board(), 'Test Slow Gain', { yes: [true] });
    s = resolveAll(s, { yes: [true] });
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(handSize(s, 'p1')).toBe(1);
    expect(handSize(s, 'p2')).toBe(1);
  });
});

// ---- Predatory Advantage ----------------------------------------------------------------------------------------------------------------------------------
describe('CR 603.4, 601.2i: "At the beginning of each opponent\'s end step, if that player didn\'t cast a creature spell this turn, create a 2/2 green Lizard creature token."', () => {
  const NEST = card('Test Lizard Nest', 'Enchantment', 'At the beginning of each opponent\'s end step, if that player didn\'t cast a creature spell this turn, create a 2/2 green Lizard creature token.', '{3}', undefined, ['R', 'G']);
  const BEAR = card('Test Nest Bear', 'Creature — Bear', '', '{0}', ['2', '2'], ['G']);
  const SORC = card('Test Nest Sorcery', 'Sorcery', 'You gain 1 life.');
  const lizards = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1').length;
  const board = (): GameState => scenario([], { defs: [NEST, BEAR, SORC], p1: { battlefield: ['Test Lizard Nest'] }, p2: { hand: ['Test Nest Bear', 'Test Nest Sorcery'] } });
  /** play p2's turn 2 to its end step: p2 casts `spell` first (or nothing) */
  const turn2 = (spell?: string): GameState => {
    let s = advanceTo(board(), 2, 'main1');
    if (spell !== undefined) s = resolveAll(cast(s, spell, undefined, 'p2'));
    return resolveAll(advanceTo(s, 2, 'end'));
  };
  it('is full', () => expect(full(NEST)).toBe(true));
  it('the opponent cast no creature spell this turn: you create a Lizard at their end step', () => {
    const s = turn2();
    expect(lizards(s)).toBe(1);
    const t = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(pt(s, t)).toBe('2/2');
    expect(getChars(s, t)!.subtypes).toContain('Lizard');
  });
  it('negative: the opponent cast a creature spell this turn: no Lizard', () => {
    expect(lizards(turn2('Test Nest Bear'))).toBe(0);
  });
  it('a noncreature spell does not stop it', () => {
    expect(lizards(turn2('Test Nest Sorcery'))).toBe(1);
  });
  it('negative: it does not trigger at your own end step', () => {
    const s = resolveAll(advanceTo(board(), 1, 'end'));
    expect(lizards(s)).toBe(0);
  });
});

// ---- Oriss, Samite Guardian -------------------------------------------------------------------------------------------------------------------------------
describe('CR 508.1c, 611.2a, 602.2, 118.3: "Discard another card named ~: Target player can\'t cast spells this turn, and creatures that player controls can\'t attack this turn."', () => {
  const ORISS = card('Test Samite Guard', 'Legendary Creature — Human Cleric', '{T}: Prevent all damage that would be dealt to target creature this turn.\nGrandeur — Discard another card named Test Samite Guard: Target player can\'t cast spells this turn, and creatures that player controls can\'t attack this turn.', '{0}', ['2', '2'], ['W']);
  const BEAR = card('Test Grand Bear', 'Creature — Bear', '', '{0}', ['2', '2'], ['G']);
  const SORC = card('Test Grand Sorcery', 'Sorcery', 'You gain 1 life.');
  const board = (): GameState => scenario([], { defs: [ORISS, BEAR, SORC], p1: { hand: ['Test Samite Guard', 'Test Grand Sorcery'], battlefield: ['Test Samite Guard', 'Test Grand Bear'] } });
  /** the Guard on the battlefield activates its grandeur ability (the second one), discarding the other Guard card in hand; `who` is the target */
  const grand = (who: 'p1' | 'p2'): GameState => {
    const s0 = board();
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Samite Guard', 'battlefield', 'p1') && JSON.stringify(x.action).includes('p:0:1'));
    expect(a, 'the grandeur ability can be activated').toBeDefined();
    return resolveAll(drive(act(s0, a!.action), { targets: [[{ kind: 'player', id: who }]] }));
  };
  /** the creatures offered as attackers when p1 reaches the declaration (none when the engine skips it) */
  const attackers = (s0: GameState): ObjectId[] => {
    let t = s0;
    for (let i = 0; i < 40 && t.pending?.kind !== 'declareAttackers' && t.turn.step !== 'end'; i++) t = pass(t);
    return t.pending?.kind === 'declareAttackers' ? (t.pending as unknown as { candidates: { id: ObjectId }[] }).candidates.map((c) => c.id) : [];
  };
  it('is full', () => expect(full(ORISS)).toBe(true));
  it('the targeted player can\'t cast spells this turn (the Sorcery is no longer castable) and their creatures can\'t attack', () => {
    const s = grand('p1');
    expect(legal(s, 'p1', 'cast').filter((a) => a.object === find(s, 'Test Grand Sorcery', 'hand', 'p1'))).toEqual([]);
    // your own creatures (the Guard and the Bear, both able to attack) are not offered as attackers
    expect(attackers(s)).toEqual([]);
  });
  it('negative: aimed at the opponent, your own spells and attackers are not affected', () => {
    const s = grand('p2');
    expect(legal(s, 'p1', 'cast').filter((a) => a.object === find(s, 'Test Grand Sorcery', 'hand', 'p1')).length).toBeGreaterThan(0);
    expect(attackers(s).length).toBeGreaterThan(0);
  });
  it('the discard is a cost: the other Guard card leaves the hand for the graveyard', () => {
    const s = grand('p1');
    expect(s.zones.hand['p1']!.map((id) => s.objects[id]!.defId)).toEqual(['Test Grand Sorcery']);
    expect(names(s, 'graveyard', 'p1')).toEqual(['Test Samite Guard']);
  });
  it('negative: with no other Guard card in hand the grandeur ability cannot be activated', () => {
    const s0 = scenario([], { defs: [ORISS, SORC], p1: { hand: ['Test Grand Sorcery'], battlefield: ['Test Samite Guard'] } });
    expect(legal(s0, 'p1', 'activate').filter((x) => JSON.stringify(x.action).includes('p:0:1'))).toEqual([]);
  });
});
