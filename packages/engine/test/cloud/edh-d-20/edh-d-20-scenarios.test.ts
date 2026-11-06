/**
 * Commander coordinator D, round edh-d-20 (lane random: coin flips and "at random"): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler, in 4-player games. A flip has two outcomes, so each test plays the same spell with several seeds and checks that every outcome is the one the
 * rule gives and that both outcomes happen. CR cites are from the Comprehensive Rules of 2026-09-25.
 *
 *   CR 705.2, 608.2c           "Create a Treasure token. Then flip a coin. If you lose the flip, ~ deals 2 damage to you." (Goblin Kaboomist: the flip follows its own "Then")
 *   CR 705.2, 608.2c           "Flip a coin. If you win the flip, ... Otherwise, ..." (Plasma Caster)
 *   CR 705.1, 705.2, 608.2f    "For each tapped creature, flip a coin. If you win the flip, ..." (Fighting Chance)
 *   CR 705.1, 705.2, 608.2f    "Flip a coin for each opponent you have. For each flip you win, ... For each flip you lose, ~ deals 3 damage to that player." (Mutalith Vortex Beast)
 *   CR 705.1, 705.2, 701.8a    "Flip a coin for each creature that isn't a Demon. Destroy each creature whose coin comes up tails." (Rakdos, the Showstopper)
 *   CR 705.2, 608.2c           "Whenever a player casts a spell, that player flips a coin. If they lose the flip, counter that spell." (Planar Chaos)
 *   CR 701.21a, 109.4          "Each tapped creature is sacrificed by its controller." (Tide of War)
 *   CR 608.2d, 102.1           "Choose a player at random. ..." (Wildfire Devils)
 *   CR 608.2d, 406.1, 404.1    "Exile a card from your graveyard at random." (Advanced Reconstruction)
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId, PlayerId } from '../../../src/index';
import { act as mact, answer as manswer, find as mfind, mpScenario, pass as mpass } from '../../m12/rules/helpers';
import { card, full } from '../cmd3/helpers';

const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const zoneNames = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: PlayerId): string[] => (s.zones[zone][p] ?? []).map((id) => s.objects[id]!.defId);
const bf = (s: GameState, defId: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));
const exileNames = (s: GameState): string[] => s.zones.exile.map((id) => s.objects[id]!.defId);
const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];

/** Who was asked for each decision of the resolution, in order. */
interface Run { s: GameState; asked: { kind: string; player: PlayerId }[] }
/** Casts `name` for `player` and answers whatever is asked (first option, no, no targets) until the stack is empty. */
function play(s0: GameState, name: string, player: PlayerId = 'p1', yes = false): Run {
  let s = mact(s0, { type: 'cast', player, card: mfind(s0, name, 'hand', player) });
  const asked: Run['asked'] = [];
  for (let i = 0; i < 200; i++) {
    const p = s.pending;
    if (p === null || p === undefined) break;
    const d = p as unknown as { player: PlayerId; options?: { id: string }[] | ObjectId[]; min?: number };
    asked.push({ kind: p.kind, player: d.player });
    if (p.kind === 'payCost') s = manswer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = manswer(s, { kind: 'chooseTargets', targets: [] });
    else if (p.kind === 'yesNo') s = manswer(s, { kind: 'yesNo', yes });
    else if (p.kind === 'chooseObjects') s = manswer(s, { kind: 'chooseObjects', ids: (d.options as ObjectId[]).slice(0, d.min ?? 0) });
    else if (p.kind === 'chooseOption') s = manswer(s, { kind: 'chooseOption', ids: [(d.options as { id: string }[])[0]!.id] });
    else if (p.kind === 'order') s = manswer(s, { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = mpass(s); }
    else throw new Error(`unexpected ${p.kind}`);
  }
  return { s, asked };
}
const seeds = <T>(f: (seed: string) => T): T[] => SEEDS.map(f);

describe('"Create a Treasure token. Then flip a coin. If you lose the flip, ~ deals 2 damage to you." (CR 705.2, 608.2c; Goblin Kaboomist)', () => {
  const SPELL = card('Test Then Flip', 'Sorcery', 'Create a Treasure token. Then flip a coin. If you lose the flip, ~ deals 2 damage to you.');
  it('is automated', () => expect(full(SPELL)).toBe(true));
  it('the token is always made; the damage happens exactly when the flip is lost (both outcomes happen over the seeds)', () => {
    const lives = seeds((seed) => {
      const { s } = play(mpScenario({ seed, defs: [SPELL], zones: { p1: { hand: ['Test Then Flip'] } } }), 'Test Then Flip');
      expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(1);
      return lifeOf(s, 'p1');
    });
    expect(new Set(lives)).toEqual(new Set([20, 18]));
  });
  it('negative: a flip you win does nothing, and the flip is called by you (one decision of yours)', () => {
    const { asked } = play(mpScenario({ seed: 'a', defs: [SPELL], zones: { p1: { hand: ['Test Then Flip'] } } }), 'Test Then Flip');
    expect(asked.filter((a) => a.kind === 'chooseOption').map((a) => a.player)).toEqual(['p1']);
  });
});

describe('"Flip a coin. If you win the flip, you gain 2 life. Otherwise, you lose 2 life." (CR 705.2, 608.2c; Plasma Caster)', () => {
  const SPELL = card('Test Otherwise Flip', 'Sorcery', 'Flip a coin. If you win the flip, you gain 2 life. Otherwise, you lose 2 life.');
  it('is automated', () => expect(full(SPELL)).toBe(true));
  it('a won flip gains 2 and a lost flip loses 2: never both, never neither', () => {
    const lives = seeds((seed) => lifeOf(play(mpScenario({ seed, defs: [SPELL], zones: { p1: { hand: ['Test Otherwise Flip'] } } }), 'Test Otherwise Flip').s, 'p1'));
    expect(new Set(lives)).toEqual(new Set([22, 18]));
  });
});

describe('"For each tapped creature, flip a coin. If you win the flip, you gain 1 life. If you lose the flip, you lose 1 life." (CR 705.1, 705.2, 608.2f; Fighting Chance)', () => {
  const SPELL = card('Test Each Flip', 'Sorcery', 'For each tapped creature, flip a coin. If you win the flip, you gain 1 life. If you lose the flip, you lose 1 life.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const start = (seed: string, tapped: number): GameState => mpScenario({ seed, defs: [SPELL, BEAR], zones: { p1: { hand: ['Test Each Flip'], battlefield: Array.from({ length: 5 }, (_v, i) => ({ name: 'Test Bear', tapped: i < tapped })) as never } } });
  it('is automated', () => expect(full(SPELL)).toBe(true));
  it('one flip for each tapped creature: the life total moves by one per flip, so its parity is the number of flips (and both signs happen)', () => {
    const nets = seeds((seed) => lifeOf(play(start(seed, 3), 'Test Each Flip').s, 'p1') - 20);
    for (const n of nets) expect([-3, -1, 1, 3]).toContain(n);
    expect(new Set(nets).size).toBeGreaterThan(1);
  });
  it('negative: with no tapped creature nothing is flipped and nothing happens', () => {
    const { s, asked } = play(start('a', 0), 'Test Each Flip');
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(asked.filter((a) => a.kind === 'chooseOption')).toEqual([]);
  });
});

describe('"Flip a coin for each opponent you have. For each flip you win, draw a card. For each flip you lose, ~ deals 3 damage to that player." (CR 705.1, 705.2, 608.2f; Mutalith Vortex Beast)', () => {
  const SPELL = card('Test Vortex Flips', 'Sorcery', 'Flip a coin for each opponent you have. For each flip you win, draw a card. For each flip you lose, ~ deals 3 damage to that player.');
  it('is automated', () => expect(full(SPELL)).toBe(true));
  it('each of the three opponents is flipped for once: a won flip draws a card, a lost one hits that opponent for 3 (the cards drawn plus the opponents hit are three)', () => {
    const seen = new Set<number>();
    for (const seed of SEEDS) {
      const s0 = mpScenario({ seed, defs: [SPELL], zones: { p1: { hand: ['Test Vortex Flips'] } } });
      const before = (s0.zones.hand['p1'] ?? []).length - 1;
      const { s, asked } = play(s0, 'Test Vortex Flips');
      const drawn = (s.zones.hand['p1'] ?? []).length - before;
      const hit = (['p2', 'p3', 'p4'] as PlayerId[]).filter((p) => lifeOf(s, p) === 17);
      expect((['p2', 'p3', 'p4'] as PlayerId[]).filter((p) => lifeOf(s, p) !== 17 && lifeOf(s, p) !== 20)).toEqual([]);
      expect(drawn + hit.length).toBe(3);
      expect(lifeOf(s, 'p1')).toBe(20);
      expect(asked.filter((a) => a.kind === 'chooseOption').map((a) => a.player)).toEqual(['p1', 'p1', 'p1']);
      seen.add(drawn);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('"Flip a coin for each creature that isn\'t a Demon. Destroy each creature whose coin comes up tails." (CR 705.1, 705.2, 701.8a; Rakdos, the Showstopper)', () => {
  const SPELL = card('Test Tails Doom', 'Sorcery', 'Flip a coin for each creature that isn\'t a Demon. Destroy each creature whose coin comes up tails.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const IMP = card('Test Demon', 'Creature — Demon', '', ['2', '2']);
  it('is automated', () => expect(full(SPELL)).toBe(true));
  it('a Demon is never flipped for or destroyed; the others (of any player) are destroyed exactly when their flip is lost, and both outcomes happen', () => {
    const survivors: number[] = [];
    for (const seed of SEEDS) {
      const s0 = mpScenario({ seed, defs: [SPELL, BEAR, IMP], zones: { p1: { hand: ['Test Tails Doom'], battlefield: ['Test Demon', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] } } });
      const { s, asked } = play(s0, 'Test Tails Doom');
      expect(bf(s, 'Test Demon').length).toBe(1);
      const alive = bf(s, 'Test Bear').length;
      expect(alive + (zoneNames(s, 'graveyard', 'p1').filter((n) => n === 'Test Bear').length + zoneNames(s, 'graveyard', 'p2').filter((n) => n === 'Test Bear').length)).toBe(4);
      // the coins are not called (nobody wins or loses them, CR 705.2): no decision, and exactly the creatures whose coin landed tails are gone
      expect(asked.filter((a) => a.kind === 'chooseOption')).toEqual([]);
      const tails = s.log.filter((l) => /flips a coin: tails/.test(l.text)).length;
      expect(4 - alive).toBe(tails);
      expect(s.log.filter((l) => /flips a coin/.test(l.text)).length).toBe(4);
      survivors.push(alive);
    }
    expect(new Set(survivors).size).toBeGreaterThan(1);
  });
});

describe('"... Destroy each creature whose coin comes up tails." destroys them all at the same time (CR 701.8a, 603.10a, 608.2c; Rakdos ruling 2019-01-25)', () => {
  const SPELL = card('Test Tails Doom', 'Sorcery', 'Flip a coin for each creature that isn\'t a Demon. Destroy each creature whose coin comes up tails.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const WITNESS = card('Test Witness', 'Creature — Spirit', 'Whenever another creature dies, you gain 1 life.', ['1', '1']);
  it('a creature that dies with the others sees every one of them die (the life gained is the number of OTHER creatures that died, whichever way the witness itself went)', () => {
    const witnessDied = new Set<boolean>();
    for (const seed of SEEDS.concat(['m', 'n', 'o', 'p', 'q', 'r', 's', 't'])) {
      const s0 = mpScenario({ seed, defs: [SPELL, BEAR, WITNESS], zones: { p1: { hand: ['Test Tails Doom'], battlefield: ['Test Witness', 'Test Bear', 'Test Bear', 'Test Bear'] } } });
      const { s } = play(s0, 'Test Tails Doom');
      const bearsDied = 3 - bf(s, 'Test Bear').length;
      witnessDied.add(bf(s, 'Test Witness').length === 0);
      expect(lifeOf(s, 'p1') - 20).toBe(bearsDied);
    }
    expect(witnessDied).toEqual(new Set([true, false]));
  });
});

describe('"... Destroy each creature whose coin comes up tails." is not a win or a loss for anyone (CR 705.2; Rakdos)', () => {
  const SPELL = card('Test Tails Doom', 'Sorcery', 'Flip a coin for each creature that isn\'t a Demon. Destroy each creature whose coin comes up tails.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const LUCKY = card('Test Lucky', 'Enchantment', 'Whenever you win a coin flip, you gain 1 life.');
  it('"whenever you win / lose a coin flip" never triggers for these coins', () => {
    for (const seed of SEEDS) {
      const s0 = mpScenario({ seed, defs: [SPELL, BEAR, LUCKY], zones: { p1: { hand: ['Test Tails Doom'], battlefield: ['Test Lucky', 'Test Bear', 'Test Bear', 'Test Bear'] } } });
      expect(lifeOf(play(s0, 'Test Tails Doom').s, 'p1')).toBe(20);
    }
  });
  it('control: a called flip of the same player does trigger them', () => {
    const CALLED = card('Test Called Flip', 'Sorcery', 'Flip a coin. If you win the flip, you gain 1 life.');
    const lives = SEEDS.map((seed) => lifeOf(play(mpScenario({ seed, defs: [CALLED, LUCKY], zones: { p1: { hand: ['Test Called Flip'], battlefield: ['Test Lucky'] } } }), 'Test Called Flip').s, 'p1'));
    expect(new Set(lives)).toEqual(new Set([20, 22]));
  });
});

describe('"Whenever a player casts a spell, that player flips a coin. If they lose the flip, counter that spell." (CR 705.2, 608.2c; Planar Chaos)', () => {
  const CHAOS = card('Test Chaos Rule', 'Enchantment', 'Whenever a player casts a spell, that player flips a coin. If they lose the flip, counter that spell.');
  const GAIN = card('Test Gain Spell', 'Sorcery', 'You gain 3 life.');
  it('is automated', () => expect(full(CHAOS)).toBe(true));
  it('the caster (not the controller of the enchantment) calls the flip, and the spell is countered exactly when they lose it', () => {
    const outcomes = new Set<string>();
    for (const seed of SEEDS) {
      let s = mpScenario({ seed, defs: [CHAOS, GAIN], zones: { p1: { battlefield: ['Test Chaos Rule'], hand: ['Test Gain Spell'] } } });
      const r = play(s, 'Test Gain Spell');
      s = r.s;
      const flips = r.asked.filter((a) => a.kind === 'chooseOption');
      expect(flips.map((a) => a.player)).toEqual(['p1']); // the caster here is the controller; see the next test for another caster
      outcomes.add(lifeOf(s, 'p1') === 23 ? 'resolved' : 'countered');
      expect([20, 23]).toContain(lifeOf(s, 'p1'));
      expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Gain Spell');
    }
    expect(outcomes).toEqual(new Set(['resolved', 'countered']));
  });
  it('another player casting a spell is the one asked to call, and a countered spell does nothing', () => {
    const FLASH = card('Test Flash Gain', 'Instant', 'You gain 3 life.');
    const results = new Set<string>();
    for (const seed of SEEDS) {
      const s0 = mpScenario({ seed, defs: [CHAOS, FLASH], zones: { p1: { battlefield: ['Test Chaos Rule'] }, p2: { hand: ['Test Flash Gain'] } } });
      // p2 casts at instant speed on p1's turn
      let s = s0;
      s = mact(s, { type: 'pass', player: 'p1' });
      const r = (() => {
        const asked: Run['asked'] = [];
        let st = s;
        if (st.pending?.kind === 'priority' && (st.pending as { player: PlayerId }).player === 'p2') st = mact(st, { type: 'cast', player: 'p2', card: mfind(st, 'Test Flash Gain', 'hand', 'p2') });
        for (let i = 0; i < 100 && st.pending; i++) {
          const p = st.pending as unknown as { kind: string; player: PlayerId; options?: { id: string }[] };
          asked.push({ kind: p.kind, player: p.player });
          if (p.kind === 'payCost') st = manswer(st, { kind: 'payCost', auto: true });
          else if (p.kind === 'chooseOption') st = manswer(st, { kind: 'chooseOption', ids: [p.options![0]!.id] });
          else if (p.kind === 'priority') { if (st.zones.stack.length === 0) break; st = mpass(st); } else break;
        }
        return { st, asked };
      })();
      expect(r.asked.filter((a) => a.kind === 'chooseOption').map((a) => a.player)).toEqual(['p2']);
      results.add(lifeOf(r.st, 'p2') === 23 ? 'resolved' : 'countered');
    }
    expect(results).toEqual(new Set(['resolved', 'countered']));
  });
});

describe('"Each tapped creature is sacrificed by its controller." (CR 701.21a, 109.4; Tide of War)', () => {
  const SPELL = card('Test Tide', 'Sorcery', 'Each tapped creature is sacrificed by its controller.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  it('is automated', () => expect(full(SPELL)).toBe(true));
  it('every tapped creature of every player is sacrificed by its own controller; untapped ones stay', () => {
    const s0 = mpScenario({ defs: [SPELL, BEAR], zones: { p1: { hand: ['Test Tide'], battlefield: [{ name: 'Test Bear', tapped: true }, 'Test Bear'] as never }, p2: { battlefield: [{ name: 'Test Bear', tapped: true }, { name: 'Test Bear', tapped: true }, 'Test Bear'] as never } } });
    const { s } = play(s0, 'Test Tide');
    expect(bf(s, 'Test Bear', 'p1').length).toBe(1);
    expect(bf(s, 'Test Bear', 'p2').length).toBe(1);
    expect(zoneNames(s, 'graveyard', 'p1').filter((n) => n === 'Test Bear').length).toBe(1);
    expect(zoneNames(s, 'graveyard', 'p2').filter((n) => n === 'Test Bear').length).toBe(2); // they went to their owners' graveyards
  });
});

describe('"Choose a player at random. ~ deals 3 damage to that player." (CR 608.2d, 102.1; Wildfire Devils)', () => {
  const SPELL = card('Test Random Bolt', 'Sorcery', 'Choose a player at random. ~ deals 3 damage to that player.');
  it('is automated', () => expect(full(SPELL)).toBe(true));
  it('exactly one player is hit, nobody is asked to choose, and over the seeds more than one player (you included) is picked', () => {
    const hit = new Set<PlayerId>();
    for (const seed of SEEDS.concat(['m', 'n', 'o', 'p', 'q', 'r'])) {
      const { s, asked } = play(mpScenario({ seed, defs: [SPELL], zones: { p1: { hand: ['Test Random Bolt'] } } }), 'Test Random Bolt');
      const down = (['p1', 'p2', 'p3', 'p4'] as PlayerId[]).filter((p) => lifeOf(s, p) === 17);
      expect(down.length).toBe(1);
      expect((['p1', 'p2', 'p3', 'p4'] as PlayerId[]).filter((p) => lifeOf(s, p) !== 17 && lifeOf(s, p) !== 20)).toEqual([]);
      expect(asked.filter((a) => a.kind === 'chooseOption')).toEqual([]);
      hit.add(down[0]!);
    }
    expect(hit.size).toBeGreaterThan(1);
  });
});

describe('"Exile a card from your graveyard at random." (CR 608.2d, 406.1, 404.1; Advanced Reconstruction)', () => {
  const ONE = card('Test One Random', 'Sorcery', 'Exile a card from your graveyard at random. You may play the exiled card this turn.');
  const A = card('Test Card A', 'Sorcery', ''); const B = card('Test Card B', 'Sorcery', ''); const C = card('Test Card C', 'Sorcery', '');
  const defs = [ONE, A, B, C];
  const start = (seed: string): GameState => mpScenario({ seed, defs, zones: { p1: { hand: ['Test One Random'], graveyard: ['Test Card A', 'Test Card B', 'Test Card C'] }, p2: { graveyard: ['Test Card A'] } } });
  it('is automated', () => expect(full(ONE)).toBe(true));
  it('one card of MY graveyard is exiled at random, chosen by nobody (different cards for different seeds); the other graveyard is untouched', () => {
    const picks = new Set<string>();
    for (const seed of SEEDS) {
      const { s, asked } = play(start(seed), 'Test One Random');
      expect(exileNames(s).length).toBe(1);
      expect(zoneNames(s, 'graveyard', 'p1').filter((n) => n.startsWith('Test Card')).length).toBe(2);
      expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Card A']);
      expect(asked.filter((a) => a.kind === 'chooseObjects')).toEqual([]);
      picks.add(exileNames(s)[0]!);
    }
    expect(picks.size).toBeGreaterThan(1);
  });
  it('negative: with an empty graveyard nothing is exiled', () => {
    const { s } = play(mpScenario({ defs, zones: { p1: { hand: ['Test One Random'] } } }), 'Test One Random');
    expect(exileNames(s)).toEqual([]);
  });
});
