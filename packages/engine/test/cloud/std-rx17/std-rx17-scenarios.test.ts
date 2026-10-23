/**
 * std-rx17 (wave 2, Commander precon lane rx17): the round's keyword data and engine changes played through the engine with synthetic cards compiled by the
 * game's default compiler (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 702.109a          dash: cast for its dash cost, the permanent has haste and returns to its owner's hand at the beginning of the next end step
 *   CR 702.58a           graft N: enters with N +1/+1 counters; whenever another creature enters, you may move one onto it (only while one is left)
 *   CR 122.1a            any +X/+Y counter ("+1/+0", "-0/-1", "+2/+2") changes power and toughness
 *   CR 702.110a-b        exploit, "when ~ exploits a creature", "whenever a creature you control exploits a nontoken creature"
 *   CR 122.1i, 728.1     rad counters: at the beginning of the precombat main phase, mill that many; each nonland card milled costs 1 life and a rad counter
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState, ObjectId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, life, scenario } from '../../m3/scenario';
import { card, counters, full, pt, resolveAll, settle } from '../cmd3/helpers';

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const RAIDER = card('Test Dash Raider', 'Creature — Goblin', 'Dash {1} (You may cast this spell for its dash cost. If you do, it gains haste, and it\'s returned from the battlefield to its owner\'s hand at the beginning of the next end step.)', ['2', '1'], '{3}');
const GRAFTER = card('Test Grafter', 'Creature — Frog', 'Graft 2 (This creature enters with two +1/+1 counters on it. Whenever another creature enters, you may move a +1/+1 counter from this creature onto it.)', ['0', '0']);
const WALL = card('Test Root Wall', 'Creature — Plant Wall', 'Defender\nPut a -0/-1 counter on this creature: Add {G}. Activate only once each turn.', ['0', '5']);
const SHAMBLER = card('Test Exploit Shambler', 'Creature — Zombie', 'Exploit (When this creature enters, you may sacrifice a creature.)\nWhen this creature exploits a creature, draw two cards.', ['2', '2']);
const COLONEL = card('Test Exploit Colonel', 'Legendary Creature — Human', 'Whenever a creature you control exploits a nontoken creature, you gain 3 life.', ['1', '1']);
const BLAST = card('Test Rad Blast', 'Sorcery', 'Each player gets three rad counters.');
const SPELL = card('Test Rad Spell', 'Sorcery', 'You gain 1 life.');
const DEFS: CardDef[] = [BEAR, RAIDER, GRAFTER, WALL, SHAMBLER, COLONEL, BLAST, SPELL];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const plains = (n: number): string[] => Array(n).fill('Plains') as string[];

describe('CR 702.109a: dash', () => {
  const dash = (s: GameState): GameState => {
    let t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Dash Raider', 'hand', 'p1'), method: 'dash' });
    t = settle(t);
    return resolveAll(t);
  };
  it('CR 702.109a: cast for its dash cost it has haste, and at the beginning of the next end step it returns to its owner\'s hand', () => {
    let s = scenario(['Plains'], { p1: { battlefield: plains(1), hand: ['Test Dash Raider'] }, defs: DEFS });
    s = dash(s);
    const raider = find(s, 'Test Dash Raider', 'battlefield', 'p1');
    expect(hasKeyword(getChars(s, raider)!, 'haste')).toBe(true);
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(findAll(s, 'Test Dash Raider', 'battlefield')).toHaveLength(0);
    expect(findAll(s, 'Test Dash Raider', 'hand', 'p1')).toHaveLength(1);
  });
  it('CR 702.109a: cast for its mana cost it has no haste and stays on the battlefield', () => {
    let s = scenario(['Plains'], { p1: { battlefield: plains(3), hand: ['Test Dash Raider'] }, defs: DEFS });
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Dash Raider', 'hand', 'p1') })));
    const raider = find(s, 'Test Dash Raider', 'battlefield', 'p1');
    expect(hasKeyword(getChars(s, raider)!, 'haste')).toBe(false);
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(findAll(s, 'Test Dash Raider', 'battlefield')).toHaveLength(1);
  });
});

describe('CR 702.58a: graft', () => {
  it('CR 702.58a: it enters with N +1/+1 counters; another creature entering may take one', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Grafter', 'Test Bear'] }, defs: DEFS });
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Grafter', 'hand', 'p1') })));
    const grafter = find(s, 'Test Grafter', 'battlefield', 'p1');
    expect(counters(s, grafter, '+1/+1')).toBe(2);
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bear', 'hand', 'p1') })), { yes: true });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(counters(s, grafter, '+1/+1')).toBe(1);
    expect(pt(s, bear)).toBe('3/3');
  });
  it('CR 702.58a, 603.4: with no +1/+1 counter left on it, the move does not trigger', () => {
    let s = scenario(['Plains'], { p1: { battlefield: [{ name: 'Test Grafter', counters: {} }], hand: ['Test Bear'] }, defs: DEFS });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bear', 'hand', 'p1') }));
    s = resolveAll(s, { yes: true });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(pt(s, bear)).toBe('2/2');
    expect(s.zones.stack).toHaveLength(0);
  });
  it('CR 702.58a: the move is optional ("you may"): declining keeps the counter', () => {
    let s = scenario(['Plains'], { p1: { battlefield: [{ name: 'Test Grafter', counters: { '+1/+1': 2 } }], hand: ['Test Bear'] }, defs: DEFS });
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bear', 'hand', 'p1') })), { yes: false });
    expect(counters(s, find(s, 'Test Grafter', 'battlefield', 'p1'), '+1/+1')).toBe(2);
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe('2/2');
  });
});

describe('CR 122.1a: every +X/+Y counter changes power and toughness', () => {
  it('CR 122.1a: a -0/-1 counter (put as a cost) gives -0/-1; two give -0/-2', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Root Wall'] }, defs: DEFS });
    const wall = find(s, 'Test Root Wall', 'battlefield', 'p1');
    expect(pt(s, wall)).toBe('0/5');
    s = settle(act(s, { type: 'activate', player: 'p1', source: wall, ability: 'p:0:1' }));
    expect(pt(s, wall)).toBe('0/4');
    s.objects[wall]!.counters['-0/-1'] = 2;
    expect(pt(s, wall)).toBe('0/3');
  });
  it('CR 122.1a, 704.5q: +1/+0 and +2/+2 counters add up with +1/+1 counters; only +1/+1 and -1/-1 annihilate', () => {
    const s = scenario(['Plains'], { p1: { battlefield: [{ name: 'Test Bear', counters: { '+1/+0': 2, '+2/+2': 1, '+1/+1': 1, '-0/-1': 1 } }] }, defs: DEFS });
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe('7/4'); // 2/2 +2/+0 +2/+2 +1/+1 -0/-1
  });
});

describe('CR 702.110a-b: exploit', () => {
  /** Cast the Shambler from p1's hand and play everything out; the exploit ability sacrifices the Bear, the Shambler itself, or nothing. */
  const enterShambler = (s0: GameState, sacrifice: 'bear' | 'self' | 'none'): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Exploit Shambler', 'hand', 'p1') });
    for (let i = 0; i < 40 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) {
      const d = s.pending!;
      if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: sacrifice !== 'none' });
      else if (d.kind === 'chooseObjects') {
        const opts = (d as { options: ObjectId[] }).options;
        const want = sacrifice === 'none' ? [] : [opts.find((id) => s.objects[id]!.defId === (sacrifice === 'self' ? 'Test Exploit Shambler' : 'Test Bear'))!];
        s = answer(s, { kind: 'chooseObjects', ids: want });
      } else s = settle(s);
    }
    return s;
  };
  const hand = (s: GameState): number => s.zones.hand['p1']!.length;

  it('CR 702.110b: sacrificing a creature as the exploit ability resolves triggers "when ~ exploits a creature"', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Test Bear'], hand: ['Test Exploit Shambler'] }, defs: DEFS });
    const h0 = hand(s0) - 1;
    const s = enterShambler(s0, 'bear');
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1')).toHaveLength(1);
    expect(hand(s)).toBe(h0 + 2);
  });
  it('CR 702.110b, 603.10a: a creature that exploits itself still triggers its own "when ~ exploits"', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Exploit Shambler'] }, defs: DEFS });
    const h0 = hand(s0) - 1;
    const s = enterShambler(s0, 'self');
    expect(findAll(s, 'Test Exploit Shambler', 'graveyard', 'p1')).toHaveLength(1);
    expect(hand(s)).toBe(h0 + 2);
  });
  it('CR 702.110a: sacrificing nothing exploits nothing', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Test Bear'], hand: ['Test Exploit Shambler'] }, defs: DEFS });
    const h0 = hand(s0) - 1;
    const s = enterShambler(s0, 'none');
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(1);
    expect(hand(s)).toBe(h0);
  });
  it('CR 702.110b: "whenever a creature you control exploits a nontoken creature" sees the exploiting creature and the creature it sacrificed', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Test Bear', 'Test Exploit Colonel'], hand: ['Test Exploit Shambler'] }, defs: DEFS });
    const s = enterShambler(s0, 'bear');
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 3);
  });
  it('CR 702.110b: a plain sacrifice that is not an exploit ability\'s is not an exploit', () => {
    const SAC = card('Test Sac Outlet', 'Creature — Human', 'Sacrifice another creature: You gain 1 life.', ['1', '1']);
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Bear', 'Test Exploit Colonel', 'Test Sac Outlet'] }, defs: [...DEFS, SAC] });
    const l0 = life(s, 'p1');
    s = settle(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Sac Outlet', 'battlefield', 'p1'), ability: 'p:0:0' }), { objects: [find(s, 'Test Bear', 'battlefield', 'p1')] });
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(l0 + 1);
  });
});

describe('CR 122.1i, 728.1: rad counters', () => {
  /** p1 has `n` rad counters and the library holds the given cards on top. */
  const radGame = (n: number, top: string[]): GameState => {
    const s = scenario(['Plains'], { p1: { library: top }, defs: DEFS });
    // the top of a library is the start of its list: put the named cards there, under one Plains for the draw of turn 3
    const lib = s.zones.library['p1']!;
    const named = lib.filter((id) => s.objects[id]!.defId !== 'Plains');
    const rest = lib.filter((id) => !named.includes(id));
    s.zones.library['p1'] = [rest[0]!, ...named, ...rest.slice(1)];
    s.players.find((p) => p.id === 'p1')!.counters['rad'] = n;
    return s;
  };
  const toNextMain = (s: GameState): GameState => resolveAll(advanceTo(s, 3, 'main1'));
  it('CR 728.1: at the beginning of the precombat main phase, mill that many; each nonland card milled costs 1 life and one rad counter', () => {
    let s = radGame(3, ['Test Rad Spell', 'Test Bear']);
    const l0 = life(s, 'p1');
    s = toNextMain(s);
    const p1 = s.players.find((p) => p.id === 'p1')!;
    expect(findAll(s, 'Test Rad Spell', 'graveyard', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1')).toHaveLength(1);
    expect(s.zones.graveyard['p1']!).toHaveLength(3); // the two nonland cards and a Plains
    expect(life(s, 'p1')).toBe(l0 - 2);
    expect(p1.counters['rad'] ?? 0).toBe(1);
  });
  it('CR 728.1: a player with no rad counters mills nothing; the other player\'s main phase does not mill for them', () => {
    let s = radGame(0, ['Test Rad Spell']);
    s.players.find((p) => p.id === 'p2')!.counters['rad'] = 2;
    const lib = s.zones.library['p1']!.length;
    s = toNextMain(s);
    expect(s.zones.library['p1']!.length).toBe(lib - 1); // only the draw of turn 3
    expect(findAll(s, 'Test Rad Spell', 'graveyard', 'p1')).toHaveLength(0);
  });
  it('CR 122.1i: a card that gives each player rad counters is automated and gives them', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Rad Blast'] }, defs: DEFS });
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rad Blast', 'hand', 'p1') })));
    expect(s.players.map((p) => p.counters['rad'] ?? 0)).toEqual([3, 3]);
  });
});
