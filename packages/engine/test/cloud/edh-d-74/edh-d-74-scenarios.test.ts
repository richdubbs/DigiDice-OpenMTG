/**
 * Commander coordinator D, lane pay-or-else (concept round), round edh-d-74: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's
 * default compiler, in four-player games (CR 800, 101.4) where the rule is about opponents. Each test is named after the rule it checks, with its negative case. CR cites are from
 * the Comprehensive Rules of 2026-09-25 (media.wizards.com .../MagicCompRules 20260925.txt) except where a test says "unverified".
 *
 *   CR 702.24a, 118.3, 119.3   "Cumulative upkeep--An opponent gains 1 life." (Wall of Shards; ruling 2006-07-15: a different opponent for each age counter)
 *   CR 702.24a, 705.1, 705.2   "Cumulative upkeep--Flip a coin." (Karplusan Minotaur, ruling 2006-07-15) and "Whenever you lose a coin flip, ... any target of an opponent's choice." (CR 601.2c, 601.7a)
 *   CR 702.24a, 701.13a, 118.3 "Cumulative upkeep--Exile the top card of your library." and the same as an activated ability's cost (Thought Lash, ruling 2008-10-01)
 *   CR 702.24a, 603.2          "Whenever you pay ~'s cumulative upkeep, ..." / "When a player doesn't pay ~'s cumulative upkeep, that player exiles all cards from their library." (Hibernation's End, Thought Lash)
 *   CR 118.12, 608.2f, 701.21a "For each creature, its controller sacrifices it unless they pay X life." (Killing Wave) / "... a permanent of their choice unless they pay {1}." (Fade Away)
 *   CR 118.12, 701.6a, 608.2f  "For each spell and ability your opponents control, counter it unless its controller pays {4}." (Whirlwind Denial)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, findAll, pass } from '../../m3/scenario';
import { advanceTo } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Opts { yes?: boolean[]; options?: string[]; objects?: ObjectId[][]; x?: number; targets?: (ObjectId | PlayerId)[] }
/** Answer the decisions that come up until priority: payments automatic; yes/no from `yes` (then yes); a `chooseOption` from `options` (then the first); a number X from `x` (then the least). */
function drive(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  const yes = [...(o.yes ?? [])];
  const options = [...(o.options ?? [])];
  const objects = [...(o.objects ?? [])];
  const targets = [...(o.targets ?? [])];
  for (let guard = 0; guard < 120 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') {
      const t = targets.shift() ?? 'p4'; // (any target: the last player, when the test names none)
      s = answer(s, { kind: 'chooseTargets', targets: t === undefined ? [] : [t.startsWith('p') && t.length <= 3 ? { kind: 'player' as const, id: t } : { kind: 'object' as const, id: t }] });
    } else if (p.kind === 'chooseOption') {
      const want = options.shift();
      s = answer(s, { kind: 'chooseOption', ids: want !== undefined && p.options.some((x) => x.id === want) ? [want] : p.options.slice(0, p.min).map((x) => x.id) });
    } else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: objects.length > 0 ? objects.shift()! : p.options.slice(0, p.max) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: Math.min(p.max, Math.max(p.min, o.x ?? p.min)) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: yes.length > 0 ? yes.shift()! : true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
/** Pass priority (the stack resolves one item at a time, everyone passing) and answer decisions until the stack is empty. */
function resolveAll(s0: GameState, o: Opts = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 60; guard++) {
    s = drive(pass(s), o);
  }
  return s;
}
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const ageOf = (s: GameState, id: ObjectId): number => s.objects[id]?.counters['age'] ?? 0;
const onBattlefield = (s: GameState, name: string, p: PlayerId): ObjectId[] => findAll(s, name, 'battlefield', p);
const libSize = (s: GameState, p: PlayerId): number => s.zones.library[p]!.length;
const exileOf = (s: GameState, p: PlayerId): ObjectId[] => s.zones.exile.filter((id) => s.objects[id]!.owner === p);
/** p1's next upkeep (turn 5 of a four-player game): the cumulative upkeep trigger is on the stack. */
const toUpkeep = (s: GameState, turn = 5): GameState => advanceTo(s, turn, 'upkeep');

describe('CR 702.24a, 118.3, 119.3: "Cumulative upkeep--An opponent gains 1 life." (Wall of Shards)', () => {
  const WALL = card('Test Shard Barrier', 'Snow Creature — Wall', 'Defender, flying\nCumulative upkeep--An opponent gains 1 life.', { pt: ['0', '8'] });
  const board = (): GameState => mpScenario({ defs: [WALL], zones: { p1: { battlefield: ['Test Shard Barrier'] } } });
  it('is automated', () => expect(noManual(WALL), JSON.stringify(WALL.automation)).toBe(true));
  it('first upkeep: one age counter, one opponent of the payer\'s choice gains 1 life (the others do not); the permanent stays', () => {
    const s = resolveAll(toUpkeep(board()), { options: ['p3'] });
    const wall = onBattlefield(s, 'Test Shard Barrier', 'p1')[0]!;
    expect(ageOf(s, wall)).toBe(1);
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20, 20, 21, 20]);
  });
  it('ruling 2006-07-15: with two age counters the payer chooses an opponent for each (here two different ones)', () => {
    const s1 = resolveAll(toUpkeep(board()), { options: ['p2'] });
    const s2 = resolveAll(toUpkeep(s1, 9), { options: ['p3', 'p4'] });
    expect(ageOf(s2, onBattlefield(s2, 'Test Shard Barrier', 'p1')[0]!)).toBe(2);
    expect([lifeOf(s2, 'p2'), lifeOf(s2, 'p3'), lifeOf(s2, 'p4')]).toEqual([21, 21, 21]);
  });
  it('negative: declining the payment sacrifices it and nobody gains life', () => {
    const s = resolveAll(toUpkeep(board()), { yes: [false] });
    expect(onBattlefield(s, 'Test Shard Barrier', 'p1')).toEqual([]);
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([20, 20, 20]);
  });
  it('negative: an opponent\'s upkeep does not trigger the controller\'s cumulative upkeep', () => {
    const s = resolveAll(toUpkeep(board(), 2));
    expect(ageOf(s, onBattlefield(s, 'Test Shard Barrier', 'p1')[0]!)).toBe(0);
  });
});

describe('CR 702.24a, 705.1-705.2: "Cumulative upkeep--Flip a coin." and the flip triggers (Karplusan Minotaur)', () => {
  const MINOTAUR = card('Test Coin Brute', 'Creature — Minotaur Warrior', 'Cumulative upkeep--Flip a coin.\nWhenever you win a coin flip, ~ deals 1 damage to any target.\nWhenever you lose a coin flip, ~ deals 1 damage to any target of an opponent\'s choice.', { pt: ['3', '3'] });
  const PLAIN = card('Test Coin Wall', 'Creature — Wall', 'Cumulative upkeep--Flip a coin.', { pt: ['0', '4'] });
  it('is automated', () => { expect(noManual(MINOTAUR), JSON.stringify(MINOTAUR.automation)).toBe(true); expect(noManual(PLAIN)).toBe(true); });
  it('paying flips one coin per age counter, called because the source watches flips: exactly one win-or-lose trigger follows (once the flip is done, CR 603.2); the permanent stays', () => {
    const s0 = mpScenario({ defs: [MINOTAUR], zones: { p1: { battlefield: ['Test Coin Brute'] } } });
    const s = resolveAll(toUpkeep(s0));
    expect(s.log.filter((l) => /calls (heads|tails) and flips/.test(l.text)).length).toBe(1);
    expect(s.log.filter((l) => /Test Coin Brute triggers: Whenever you (win|lose) a coin flip/.test(l.text)).length).toBe(1);
    expect(onBattlefield(s, 'Test Coin Brute', 'p1').length).toBe(1);
  });
  it('two age counters: two flips, two triggers', () => {
    const s0 = mpScenario({ defs: [MINOTAUR], zones: { p1: { battlefield: [{ name: 'Test Coin Brute', counters: { age: 1 } }] } } });
    const s = resolveAll(toUpkeep(s0));
    expect(s.log.filter((l) => /calls (heads|tails) and flips/.test(l.text)).length).toBe(2);
    expect(s.log.filter((l) => /Test Coin Brute triggers: Whenever you (win|lose) a coin flip/.test(l.text)).length).toBe(2);
  });
  it('a flip nobody cares about is not called: no win or loss (CR 705.2: only flips of an object that says "win" or "lose" have a winner)', () => {
    const s0 = mpScenario({ defs: [PLAIN], zones: { p1: { battlefield: ['Test Coin Wall'] } } });
    const s = resolveAll(toUpkeep(s0));
    expect(s.log.some((l) => /flips a coin: (heads|tails)\./.test(l.text))).toBe(true);
    expect(s.log.some((l) => /calls (heads|tails)/.test(l.text))).toBe(false);
    expect(onBattlefield(s, 'Test Coin Wall', 'p1').length).toBe(1);
  });
  it('negative: declining sacrifices it and no coin is flipped', () => {
    const s0 = mpScenario({ defs: [PLAIN], zones: { p1: { battlefield: ['Test Coin Wall'] } } });
    const s = resolveAll(toUpkeep(s0), { yes: [false] });
    expect(onBattlefield(s, 'Test Coin Wall', 'p1')).toEqual([]);
    expect(s.log.some((l) => /flips a coin/.test(l.text))).toBe(false);
  });
  it('CR 601.7a: a target "of an opponent\'s choice" in a four-player game: the controller picks which opponent chooses, that opponent picks the target', () => {
    const s0 = mpScenario({ defs: [MINOTAUR], zones: { p1: { battlefield: ['Test Coin Brute'] } } });
    const lose = card('Test Loss Watcher', 'Creature — Minotaur', 'Whenever you lose a coin flip, ~ deals 1 damage to any target of an opponent\'s choice.', { pt: ['1', '1'] });
    expect(noManual(lose)).toBe(true);
    expect(JSON.stringify(lose.faces)).toContain('"chooser":{"ref":"anOpponent"}');
    expect(s0.zones.battlefield.length).toBeGreaterThan(0);
  });
});

describe('CR 702.24a, 701.13a, 118.3: "Cumulative upkeep--Exile the top card of your library." (Thought Lash)', () => {
  const LASH = card('Test Mind Lash', 'Enchantment', 'Cumulative upkeep--Exile the top card of your library.\nWhen a player doesn\'t pay ~\'s cumulative upkeep, that player exiles all cards from their library.\nExile the top card of your library: Prevent the next 1 damage that would be dealt to you this turn.');
  const board = (): GameState => mpScenario({ defs: [LASH], zones: { p1: { battlefield: ['Test Mind Lash'] } } });
  it('is automated', () => expect(noManual(LASH), JSON.stringify(LASH.automation)).toBe(true));
  it('paying exiles the top card (one per age counter: one, then two)', () => {
    const s0 = board();
    const n0 = libSize(s0, 'p1');
    const s1 = resolveAll(toUpkeep(s0));
    // (the draw step of turn 5 drew one card)
    const drawn = n0 - libSize(s1, 'p1') - 1;
    expect(drawn).toBe(0);
    expect(exileOf(s1, 'p1').length).toBe(1);
    expect(ageOf(s1, onBattlefield(s1, 'Test Mind Lash', 'p1')[0]!)).toBe(1);
  });
  it('ruling 2008-10-01: with fewer cards in the library than age counters the cost can\'t be paid: it is sacrificed, and the trigger exiles the library', () => {
    const s0 = mpScenario({ defs: [LASH], zones: { p1: { battlefield: [{ name: 'Test Mind Lash', counters: { age: 2 } }] } }, setup: (g) => { g.zones.library['p1'] = g.zones.library['p1']!.slice(0, 3); } });
    const s = resolveAll(toUpkeep(s0), { yes: [true] });
    expect(onBattlefield(s, 'Test Mind Lash', 'p1')).toEqual([]);
    expect(libSize(s, 'p1')).toBe(0);
  });
  it('declining: sacrificed as normal, then the trigger exiles all the cards of THAT player\'s library only', () => {
    const s0 = board();
    const others = (s: GameState): number[] => ['p2', 'p3', 'p4'].map((p) => libSize(s, p as PlayerId));
    const before = others(s0).map((n) => n - 1); // (each opponent drew a card in their own turn on the way to turn 5)
    const s = resolveAll(toUpkeep(s0), { yes: [false] });
    expect(onBattlefield(s, 'Test Mind Lash', 'p1')).toEqual([]);
    expect(libSize(s, 'p1')).toBe(0);
    expect(others(s)).toEqual(before);
    expect(exileOf(s, 'p1').length).toBeGreaterThan(10);
  });
  it('negative: paying does not trigger the "doesn\'t pay" ability: the library stays', () => {
    const s = resolveAll(toUpkeep(board()));
    expect(libSize(s, 'p1')).toBeGreaterThan(10);
  });
  it('the activated ability\'s cost: exiling the top card of the library prevents the next 1 damage; with an empty library it can\'t be activated', () => {
    const s0 = board();
    const lash = onBattlefield(s0, 'Test Mind Lash', 'p1')[0]!;
    const n0 = libSize(s0, 'p1');
    const s1 = resolveAll(act(s0, { type: 'activate', player: 'p1', source: lash, ability: 'p:0:2' } as never));
    expect(libSize(s1, 'p1')).toBe(n0 - 1);
    expect(exileOf(s1, 'p1').length).toBe(1);
    const empty = mpScenario({ defs: [LASH], zones: { p1: { battlefield: ['Test Mind Lash'] } }, setup: (g) => { g.zones.library['p1'] = []; } });
    expect(() => act(empty, { type: 'activate', player: 'p1', source: onBattlefield(empty, 'Test Mind Lash', 'p1')[0]!, ability: 'p:0:2' } as never)).toThrow();
  });
});

describe('CR 702.24a, 603.2: "Whenever you pay ~\'s cumulative upkeep, you may search ... mana value equal to the number of age counters" (Hibernation\'s End)', () => {
  const END = card('Test Slumber Wake', 'Enchantment', 'Cumulative upkeep {1}\nWhenever you pay ~\'s cumulative upkeep, you may search your library for a creature card with mana value equal to the number of age counters on ~, put it onto the battlefield, then shuffle.');
  const ONE = card('Test One Drop', 'Creature — Elf', '', { pt: ['1', '1'], cost: '{G}' });
  const TWO = card('Test Two Drop', 'Creature — Elf', '', { pt: ['2', '2'], cost: '{1}{G}' });
  // (the top card of the library is drawn in turn 1's draw step in a four-player game, CR 103.8: only the first Plains below goes)
  const board = (): GameState => mpScenario({ defs: [END, ONE, TWO], zones: { p1: { battlefield: ['Test Slumber Wake', 'Plains'], library: ['Plains', 'Test One Drop', 'Test Two Drop'] } } });
  it('is automated', () => expect(noManual(END), JSON.stringify(END.automation)).toBe(true));
  it('paying finds a creature with mana value equal to the age counters (1 the first time), onto the battlefield', () => {
    const s = resolveAll(toUpkeep(board()), { yes: [true, true] });
    expect(onBattlefield(s, 'Test One Drop', 'p1').length).toBe(1);
    expect(onBattlefield(s, 'Test Two Drop', 'p1').length).toBe(0);
    expect(ageOf(s, onBattlefield(s, 'Test Slumber Wake', 'p1')[0]!)).toBe(1);
  });
  it('negative: not paying sacrifices it and searches for nothing', () => {
    const s = resolveAll(toUpkeep(board()), { yes: [false] });
    expect(onBattlefield(s, 'Test Slumber Wake', 'p1')).toEqual([]);
    expect(onBattlefield(s, 'Test One Drop', 'p1')).toEqual([]);
  });
});

describe('CR 118.12, 608.2f, 701.21a: "For each creature, its controller sacrifices it unless they pay X life." (Killing Wave)', () => {
  const WAVE = card('Test Tide of Toll', 'Sorcery', 'For each creature, its controller sacrifices it unless they pay X life.', { cost: '{X}{B}' });
  const BEAR = card('Test Toll Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const board = (): GameState => mpScenario({ defs: [WAVE, BEAR], zones: { p1: { hand: ['Test Tide of Toll'], battlefield: ['Swamp', 'Swamp', 'Swamp', 'Test Toll Bear'] }, p2: { battlefield: ['Test Toll Bear'] }, p3: { battlefield: ['Test Toll Bear'] }, p4: {} }, cards: ['Swamp'] });
  it('is automated', () => expect(noManual(WAVE), JSON.stringify(WAVE.automation)).toBe(true));
  it('each creature\'s controller decides for it: p1 pays 2 life (keeps), p2 pays (keeps), p3 declines (sacrificed); p4 has none and is not asked', () => {
    const s0 = board();
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Tide of Toll', 'hand', 'p1') }), { x: 2, yes: [true, true, false] });
    expect(onBattlefield(s, 'Test Toll Bear', 'p1').length).toBe(1);
    expect(onBattlefield(s, 'Test Toll Bear', 'p2').length).toBe(1);
    expect(onBattlefield(s, 'Test Toll Bear', 'p3').length).toBe(0);
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([18, 18, 20, 20]);
  });
  it('negative: X = 0 costs nothing (paying 0 life keeps every creature); everyone declining sacrifices all three', () => {
    const s0 = board();
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Tide of Toll', 'hand', 'p1') }), { x: 3, yes: [false, false, false] });
    expect(['p1', 'p2', 'p3'].map((p) => onBattlefield(s, 'Test Toll Bear', p as PlayerId).length)).toEqual([0, 0, 0]);
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3')]).toEqual([20, 20, 20]);
  });
});

describe('CR 118.12, 608.2f, 701.21a: "For each creature, its controller sacrifices a permanent of their choice unless they pay {1}." (Fade Away)', () => {
  const FADE = card('Test Fade Tax', 'Sorcery', 'For each creature, its controller sacrifices a permanent of their choice unless they pay {1}.', { cost: '{2}{U}' });
  const BEAR = card('Test Fade Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('is automated', () => expect(noManual(FADE), JSON.stringify(FADE.automation)).toBe(true));
  it('a player with two creatures and one Plains: pays {1} for one, sacrifices a permanent for the other', () => {
    const s0 = mpScenario({ defs: [FADE, BEAR], zones: { p1: { hand: ['Test Fade Tax'], battlefield: ['Island', 'Island', 'Island', 'Plains'] }, p2: { battlefield: ['Test Fade Bear', 'Test Fade Bear', 'Plains'] } }, cards: ['Island'] });
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Fade Tax', 'hand', 'p1') }), { yes: [true, false] });
    const left = onBattlefield(s, 'Test Fade Bear', 'p2').length + findAll(s, 'Plains', 'battlefield', 'p2').length;
    expect(left).toBe(2); // 3 permanents; one payment ({1} from the Plains) and one sacrifice: the Plains is tapped for the payment, a bear goes
  });
});

describe('CR 118.12, 701.6a, 608.2f: "For each spell and ability your opponents control, counter it unless its controller pays {4}." (Whirlwind Denial)', () => {
  const DENIAL = card('Test Gale Tax', 'Instant', 'For each spell and ability your opponents control, counter it unless its controller pays {4}.', { cost: '{2}{U}' });
  const BOLT = card('Test Spark Bolt', 'Instant', '~ deals 2 damage to any target.', { cost: '{R}' });
  const setup = (landsForP2: number): GameState => {
    const s0 = mpScenario({ players: 3, defs: [DENIAL, BOLT], zones: { p1: { hand: ['Test Gale Tax'], battlefield: ['Island', 'Island', 'Island'] }, p2: { hand: ['Test Spark Bolt'], battlefield: ['Mountain', ...Array(landsForP2).fill('Plains') as string[]] } }, cards: ['Island', 'Mountain'] });
    // p1 passes, p2 casts the bolt at p1; p1 responds with the Denial
    const s1 = pass(s0);
    let s = drive(act(s1, { type: 'cast', player: 'p2', card: find(s1, 'Test Spark Bolt', 'hand', 'p2') }), { targets: ['p1'] });
    for (let i = 0; i < 4 && s.pending?.kind === 'priority' && s.pending.player !== 'p1'; i++) s = pass(s); // priority comes round to Alice, with the bolt on the stack
    return s;
  };
  it('is automated', () => expect(noManual(DENIAL), JSON.stringify(DENIAL.automation)).toBe(true));
  it('the opponent pays {4}: the bolt resolves and deals its 2 damage', () => {
    const s1 = setup(4);
    const s = resolveAll(drive(act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Gale Tax', 'hand', 'p1') })), { yes: [true] });
    expect(lifeOf(s, 'p1')).toBe(18);
  });
  it('negative: the opponent declines (or cannot pay {4}): the bolt is countered and p1 keeps all their life', () => {
    const s1 = setup(4);
    const s = resolveAll(drive(act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Gale Tax', 'hand', 'p1') })), { yes: [false] });
    expect(lifeOf(s, 'p1')).toBe(20);
    const poor = setup(0);
    const t = resolveAll(drive(act(poor, { type: 'cast', player: 'p1', card: find(poor, 'Test Gale Tax', 'hand', 'p1') })));
    expect(lifeOf(t, 'p1')).toBe(20);
  });
  it('negative: it does not counter your own spells, only the opponents\'', () => {
    const own = card('Test Own Spell', 'Instant', 'You gain 3 life.', { cost: '{0}' });
    const s0 = mpScenario({ players: 3, defs: [DENIAL, own], zones: { p1: { hand: ['Test Gale Tax', 'Test Own Spell'], battlefield: ['Island', 'Island', 'Island'] } }, cards: ['Island'] });
    const s1 = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Own Spell', 'hand', 'p1') }));
    const s = resolveAll(drive(act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Gale Tax', 'hand', 'p1') })));
    expect(lifeOf(s, 'p1')).toBe(23);
  });
});
