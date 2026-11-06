/**
 * Round edh-next-127 (must-finish round "dice, coins and random"): the behaviour it added, played through the engine with synthetic cards (invented names, the printed
 * wordings of the real cards), compiled by the game's default compiler, in four-player games. Random results come from the state's seeded generator: each test reads
 * the result from the game and checks what the rules do with THAT result, over many seeds, so every branch (and the negative cases) is played.
 *
 *   CR 603.2c, 508.1b, 608.2c, 121.1,     Zurzoth, Chaos Rider: "Whenever one or more Devils you control attack one or more players, you and those players each draw a card, then
 *   701.9a-b, 101.4                       discard a card at random." (ONE trigger for the whole declaration; "those players" = every player attacked)
 *   CR 901.3, 901.9d, 706.7               Fractured Powerstone: "{T}: Roll the planar die. Activate only as a sorcery." (ruling 2012-06-01: no effect outside Planechase; no die is
 *                                         rolled, so "whenever you roll one or more dice" does not trigger)
 *   CR 614.1a, 608.2n, 607.2a, 603.4,     River Song's Diary: "Whenever a player casts an instant or sorcery spell from their hand, exile it instead of putting it into a graveyard as it
 *   608.2d, 608.2g, 118.9                 resolves. / At the beginning of your upkeep, if there are four or more cards exiled with ~, choose one of them at random. You may cast it without paying
 *                                         its mana cost." (ruling 2023-10-13: the spell is cast as the ability resolves)
 *   CR 702.119a-c, 601.2b, 601.2h, 406.1,  Crabomination: "Emerge from artifact {5}{B}{B}" / "When this creature enters, target opponent exiles the top card of their library, a card at random
 *   404.1, 402.1, 608.2g, 118.9, 305.9     from their graveyard, and a card at random from their hand. You may cast a spell from among cards exiled this way without paying its mana cost."
 *                                         (rulings 2024-06-07: only an artifact may be sacrificed; lands exiled this way stay in exile; cast during the resolution)
 *   CR 706.1, 706.6, 706.3a, 509.1c,       Berserker's Frenzy: "Cast this spell only before combat or during combat before blockers are declared. / Roll two d20 and ignore the lower roll. /
 *   509.1, 723.1, 611.2a                  1-14 | Choose any number of creatures. They block this turn if able. / 15-20 | You choose which creatures block this turn and how those creatures
 *                                         block." (rulings 2021-07-23: the ignored roll never happens; blocks you choose for others must still be legal)
 *   CR 701.21a, 706.2, 706.3a, 608.2h,     Danse Macabre: "Each player sacrifices a nontoken creature of their choice. Roll a d20 and add the toughness of the creature you sacrificed this way.
 *   400.7, 110.2                          1-14 | Return a creature card put into a graveyard this way to the battlefield under your control. 15+ | Return up to two creature cards put into
 *                                         graveyards this way ..." (rulings 2021-07-23: only YOUR creature's toughness is added; none if you sacrificed none)
 *   CR 706.2, 706.3a, 608.2d, 120.3        Thunderwave: "Roll a d20. 1-9 | ~ deals 3 damage to each creature. 10-19 | You may choose a creature. ~ deals 3 damage to each creature not chosen
 *                                         this way. 20 | ~ deals 6 damage to each creature your opponents control."
 *   CR 603.7a, 603.7c, 601.2i, 609.4b,     The Ruinous Powers: "At the beginning of your upkeep, choose an opponent at random. Exile the top card of that player's library. Until end of turn, you
 *   611.2a, 202.3                         may play that card and you may spend mana as though it were mana of any color to cast it. When you cast a spell this way, its owner loses life equal
 *                                         to its mana value." (rulings 2022-10-07: normal timing; the mana value as the spell is on the stack)
 *   CR 702.54b, 120.3, 118.12, 701.21a,    Indoraptor, the Perfect Hybrid: "Bloodthirst X" (X = the total damage dealt to your opponents this turn) / "Whenever ~ is dealt damage, choose an
 *   608.2h                                opponent at random. ~ deals damage equal to its power to that player unless they sacrifice a nontoken creature of their choice." (rulings 2023-11-10)
 */
import { describe, expect, it } from 'vitest';
import type { DecisionAnswer, GameState, ObjectId, PlayerId } from '../../../src/index';
import { activatedAbilities } from '../../../src/rules/abilities';
import { playPermitted } from '../../../src/statics/play-permits';
import { act as mact, answer as manswer, find as mfind, lifeOf, mpScenario, pass as mpass, passUntil } from '../../m12/rules/helpers';
import { card, full } from '../cmd3/helpers';
import { toDeclareAttackers } from '../../m4/helpers';

const SEEDS = Array.from({ length: 12 }, (_, i) => `edhn127-${i}`);
const bf = (s: GameState, defId: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));

interface Script {
  targets?: ObjectId[];
  /** The player targets, in order (a player-targeting ability). */
  players?: PlayerId[];
  /** Whole target choices (several objects at once), in order, used before `targets`. */
  targetSets?: ObjectId[][];
  yes?: (prompt: string, who: PlayerId) => boolean;
  objects?: (options: ObjectId[], prompt: string, state: GameState, who: PlayerId, max: number) => ObjectId[];
  option?: (options: { id: string; label: string }[], prompt: string) => string;
  until?: (state: GameState) => boolean;
  asked?: string[];
}
/** Answers whatever is asked, from the script, and passes priority until the stack is empty (or `until` holds). */
function run(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  const targets = [...(sc.targets ?? [])];
  const players = [...(sc.players ?? [])];
  const sets = [...(sc.targetSets ?? [])];
  for (let i = 0; i < 400; i++) {
    const p = s.pending;
    if (p === null || p === undefined || s.result) break;
    let a: DecisionAnswer | undefined;
    const d = p as unknown as { min?: number; max?: number; prompt: string; player: PlayerId };
    if (p.kind === 'chooseTargets') {
      const t = p as unknown as { objects?: ObjectId[]; min?: number };
      a = { kind: 'chooseTargets', targets: sets.length > 0 ? sets.shift()!.map((id) => ({ kind: 'object' as const, id })) : players.length > 0 ? [{ kind: 'player', id: players.shift()! }] : targets.length > 0 ? [{ kind: 'object', id: targets.shift()! }] : (t.objects ?? []).slice(0, t.min ?? 0).map((id) => ({ kind: 'object' as const, id })) } as DecisionAnswer;
    } else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') { sc.asked?.push(d.prompt); a = { kind: 'yesNo', yes: sc.yes ? sc.yes(d.prompt, d.player) : true }; }
    else if (p.kind === 'chooseObjects') {
      const o = (p as unknown as { options: ObjectId[] }).options;
      a = { kind: 'chooseObjects', ids: sc.objects !== undefined ? sc.objects(o, d.prompt, s, d.player, d.max ?? o.length) : o.slice(0, d.min ?? 0) };
    } else if (p.kind === 'chooseOption') {
      const o = (p as unknown as { options: { id: string; label: string }[] }).options;
      a = { kind: 'chooseOption', ids: [sc.option ? sc.option(o, d.prompt) : o[0]!.id] };
    } else if (p.kind === 'chooseNumber') a = { kind: 'chooseNumber', n: d.min ?? 0 } as DecisionAnswer;
    else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) };
    else if (p.kind === 'declareBlockers') a = { kind: 'declareBlockers', blocks: [] };
    else if (p.kind === 'priority') { if (s.zones.stack.length === 0 && (sc.until === undefined || sc.until(s))) break; s = mpass(s); continue; }
    else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
    s = manswer(s, a);
  }
  return s;
}
/** Declares the attacks (attacker -> player) and answers until the declare attackers step is over. */
const attackAll = (s: GameState, attacks: [ObjectId, PlayerId][]): GameState =>
  run(manswer(toDeclareAttackers(s), { kind: 'declareAttackers', attacks: attacks.map(([attacker, defender]) => ({ attacker, defender })) }), { until: (x) => x.turn.step !== 'declareAttackers' });
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const yard = (s: GameState, p: PlayerId): number => s.zones.graveyard[p]!.length;
const library = (s: GameState, p: PlayerId): number => s.zones.library[p]!.length;

describe('CR 603.2c, 508.1b, 608.2c: Zurzoth, Chaos Rider ("Whenever one or more Devils you control attack one or more players, you and those players each draw a card, then discard a card at random.")', () => {
  const RIDER = card('Test Chaos Rider', 'Legendary Creature — Devil', 'Whenever an opponent draws their first card each turn, if it\'s not their turn, you create a 1/1 red Devil creature token with "When this token dies, it deals 1 damage to any target."\nWhenever one or more Devils you control attack one or more players, you and those players each draw a card, then discard a card at random.', ['2', '1'], '{2}{R}');
  const IMP = card('Test Imp Devil', 'Creature — Devil', '', ['1', '1']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [RIDER, IMP, BEAR];
  const start = (seed: string): GameState => mpScenario({
    defs, seed,
    zones: {
      p1: { battlefield: ['Test Chaos Rider', 'Test Imp Devil', 'Test Plain Bear'], hand: ['Plains', 'Plains'] },
      p2: { hand: ['Plains', 'Plains'] }, p3: { hand: ['Plains', 'Plains'] }, p4: { hand: ['Plains', 'Plains'] },
    },
  });

  it('compiles full: one whole-batch attack trigger whose "those players" is the defender role of the batch', () => {
    expect(full(RIDER)).toBe(true);
    const ab = RIDER.faces[0]!.abilities[1] as unknown as { trigger: { batch?: boolean; wholeBatch?: boolean; on: { ev: string; defender?: string }[] }; effect: { steps: { op: string; who: unknown; mode?: string }[] } };
    expect(ab.trigger.batch).toBe(true);
    expect(ab.trigger.wholeBatch).toBe(true);
    expect(ab.trigger.on).toEqual([{ ev: 'attacks', attacker: { subtypes: ['Devil'], controller: 'you' }, defender: 'any' }]);
    expect(ab.effect.steps.map((x) => [x.op, x.mode ?? null, x.who])).toEqual([
      ['draw', null, { ref: 'you' }], ['draw', null, { ref: 'event', role: 'defender' }],
      ['discard', 'random', { ref: 'you' }], ['discard', 'random', { ref: 'event', role: 'defender' }],
    ]);
  });

  it('two Devils attacking two different players trigger it ONCE: you and both attacked players each draw one and discard one at random; the player not attacked does nothing', () => {
    for (const seed of SEEDS) {
      const s0 = start(seed);
      const rider = bf(s0, 'Test Chaos Rider')[0]!;
      const imp = bf(s0, 'Test Imp Devil')[0]!;
      const before = Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map((p) => [p, { h: hand(s0, p), y: yard(s0, p), l: library(s0, p) }]));
      const s = attackAll(s0, [[rider, 'p2'], [imp, 'p3']]);
      for (const p of ['p1', 'p2', 'p3']) {
        expect(library(s, p), `${seed} ${p}: drew one card`).toBe(before[p]!.l - 1);
        expect(hand(s, p), `${seed} ${p}: drew one, discarded one`).toBe(before[p]!.h);
        expect(yard(s, p), `${seed} ${p}: one card discarded`).toBe(before[p]!.y + 1);
      }
      expect([library(s, 'p4'), hand(s, 'p4'), yard(s, 'p4')], `${seed}: p4 was not attacked`).toEqual([before['p4']!.l, before['p4']!.h, before['p4']!.y]);
    }
  });

  it('two Devils attacking the SAME player trigger it once (one draw and one discard each, not two)', () => {
    const s0 = start('edhn127-same');
    const s = attackAll(s0, [[bf(s0, 'Test Chaos Rider')[0]!, 'p2'], [bf(s0, 'Test Imp Devil')[0]!, 'p2']]);
    for (const p of ['p1', 'p2']) expect(yard(s, p), p).toBe(1);
    for (const p of ['p3', 'p4']) expect(yard(s, p), p).toBe(0);
  });

  it('negative: a creature that is not a Devil attacking alone does not trigger it', () => {
    const s0 = start('edhn127-bear');
    const s = attackAll(s0, [[bf(s0, 'Test Plain Bear')[0]!, 'p2']]);
    for (const p of ['p1', 'p2', 'p3', 'p4']) expect([hand(s, p), yard(s, p)], p).toEqual([hand(s0, p), 0]);
  });
});

describe('CR 901.3, 706.7: Fractured Powerstone ("{T}: Roll the planar die. Activate only as a sorcery.")', () => {
  const STONE = card('Test Cracked Stone', 'Artifact', '{T}: Add {C}.\n{T}: Roll the planar die. Activate only as a sorcery.', undefined, '{2}');
  const WATCHER = card('Test Dice Watcher', 'Enchantment', 'Whenever you roll one or more dice, draw a card.');
  const defs = [STONE, WATCHER];

  it('compiles full: the second ability is the planar-die action', () => {
    expect(full(STONE)).toBe(true);
    expect(full(WATCHER), 'the die-roll trigger itself is automated, so its silence below is meaningful').toBe(true);
    const ab = STONE.faces[0]!.abilities[1] as unknown as { effect: { steps: { op: string; action?: string }[] } };
    expect(ab.effect.steps).toEqual([{ op: 'action', action: 'rollPlanarDie', who: { ref: 'you' } }]);
  });

  it('activated in a main phase: it taps, resolves and does nothing (no planar die outside Planechase); no dice roll, so the die-roll trigger does not trigger', () => {
    const s0 = mpScenario({ defs, seed: 'edhn127-stone', zones: { p1: { battlefield: ['Test Cracked Stone', 'Test Dice Watcher'] } } });
    const stone = bf(s0, 'Test Cracked Stone')[0]!;
    const ab = activatedAbilities(s0, s0.objects[stone]!).find((a) => !/Add/.test(JSON.stringify(a)))!;
    const handBefore = hand(s0, 'p1');
    const s = run(mact(s0, { type: 'activate', player: 'p1', source: stone, ability: ab.key } as never));
    expect(s.objects[stone]!.tapped).toBe(true);
    expect(s.zones.stack).toEqual([]);
    expect(hand(s, 'p1'), 'no die rolled: the watcher does not draw').toBe(handBefore);
    expect(s.log.some((l) => /rolls a d/.test(l.text))).toBe(false);
  });
});

describe('CR 614.1a, 607.2a, 603.4, 608.2g: River Song\'s Diary', () => {
  const DIARY = card('Test Chronicle Book', 'Artifact — Book', 'Whenever a player casts an instant or sorcery spell from their hand, exile it instead of putting it into a graveyard as it resolves.\nAt the beginning of your upkeep, if there are four or more cards exiled with this artifact, choose one of them at random. You may cast it without paying its mana cost.', undefined, '{3}');
  const GAINS = [1, 2, 3, 4].map((n) => card(`Test Mend ${n}`, n % 2 === 0 ? 'Instant' : 'Sorcery', `You gain ${n} life.`));
  const ZAP = card('Test Zap', 'Instant', 'You gain 10 life.');
  const defs = [DIARY, ...GAINS, ZAP];
  const resolveStack = (s0: GameState): GameState => { let s = s0; for (let g = 0; g < 40 && s.zones.stack.length > 0; g++) s = mpass(s); return s; };
  const castFromHand = (s: GameState, who: PlayerId, name: string): GameState => resolveStack(run(mact(s, { type: 'cast', player: who, card: mfind(s, name, 'hand', who) }), { until: () => true }));
  const exiledWithDiary = (s: GameState): ObjectId[] => {
    const diary = bf(s, 'Test Chronicle Book')[0]!;
    const v = (s.objects[diary]!.links ?? {})['exiled'];
    return (v?.objects ?? []).map((h) => h.id).filter((id) => s.zones.exile.includes(id));
  };

  it('compiles full; the replacement records what it exiles under the face\'s link "exiled" (CR 607.2a)', () => {
    expect(full(DIARY)).toBe(true);
    expect(JSON.stringify(DIARY.faces[0]!.abilities[0])).toContain('"link":"exiled"');
    for (const g of GAINS) expect(full(g)).toBe(true);
  });

  it('a spell cast from hand by any player (you or an opponent) is exiled as it resolves (it still resolves), linked to the Diary; a card put into exile otherwise is not', () => {
    let s = mpScenario({ defs, seed: 'edhn127-diary', zones: { p1: { battlefield: ['Test Chronicle Book'], hand: ['Test Mend 1'] }, p2: { hand: ['Test Mend 2'] } } });
    const life1 = lifeOf(s, 'p1');
    s = castFromHand(s, 'p1', 'Test Mend 1');
    expect(lifeOf(s, 'p1')).toBe(life1 + 1);
    expect(s.zones.graveyard['p1']!.length, 'not in the graveyard').toBe(0);
    expect(exiledWithDiary(s).length).toBe(1);
    // the opponent casts an instant in p1's turn (p1 passes priority to them)
    s = mpass(s);
    expect(s.pending?.player).toBe('p2');
    const life2 = lifeOf(s, 'p2');
    s = castFromHand(s, 'p2', 'Test Mend 2');
    expect(lifeOf(s, 'p2')).toBe(life2 + 2);
    expect(s.zones.graveyard['p2']!.length).toBe(0);
    expect(exiledWithDiary(s).length, 'the opponent\'s spell is exiled with it too').toBe(2);
  });

  const toNextUpkeepResolved = (s0: GameState, yes: boolean, asked?: string[]): GameState => {
    let s = passUntil(s0, (x) => x.turn.activePlayer === 'p2', 'the next turn');
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'upkeep' && x.pending?.kind === 'priority', 'p1\'s next upkeep');
    return run(s, { yes: () => yes, until: (x) => x.turn.step !== 'upkeep', ...(asked !== undefined ? { asked } : {}) });
  };
  const withExiled = (seed: string, n: number): GameState => {
    let s = mpScenario({ defs, seed, zones: { p1: { battlefield: ['Test Chronicle Book'], hand: GAINS.slice(0, n).map((g) => g.name) } } });
    for (const g of GAINS.slice(0, n)) s = castFromHand(s, 'p1', g.name);
    expect(exiledWithDiary(s).length).toBe(n);
    return s;
  };

  it('four or more cards exiled with it: at your upkeep one of them, chosen at random, may be cast free; it then goes to the graveyard (cast from exile, not from hand)', () => {
    const seen = new Set<number>();
    for (const seed of SEEDS) {
      const s0 = withExiled(seed, 4);
      const before = lifeOf(s0, 'p1');
      const s = toNextUpkeepResolved(s0, true);
      const gained = lifeOf(s, 'p1') - before;
      expect([1, 2, 3, 4], seed).toContain(gained);
      seen.add(gained);
      expect(exiledWithDiary(s).length, seed).toBe(3);
      expect(s.zones.graveyard['p1']!.map((id) => s.defs[s.objects[id]!.defId]!.name), seed).toEqual([`Test Mend ${gained}`]);
    }
    expect(seen.size, 'the choice is random: more than one card came up over the seeds').toBeGreaterThan(1);
  });

  it('declining the cast leaves the chosen card in exile', () => {
    const s0 = withExiled('edhn127-decline', 4);
    const before = lifeOf(s0, 'p1');
    const s = toNextUpkeepResolved(s0, false);
    expect(lifeOf(s, 'p1')).toBe(before);
    expect(exiledWithDiary(s).length).toBe(4);
  });

  it('negative (CR 603.4): with only three cards exiled with it, nothing is chosen or cast', () => {
    const s0 = withExiled('edhn127-three', 3);
    const before = lifeOf(s0, 'p1');
    const asked: string[] = [];
    const s = toNextUpkeepResolved(s0, true, asked);
    expect(lifeOf(s, 'p1')).toBe(before);
    expect(exiledWithDiary(s).length).toBe(3);
    expect(asked, 'no "cast it?" question').toEqual([]);
  });
});

describe('CR 702.119b, 406.1, 608.2g: Crabomination ("Emerge from artifact {5}{B}{B}"; the three exiles and the free cast)', () => {
  const CRAB = card('Test Crab Fiend', 'Creature — Crab Demon', 'Emerge from artifact {5}{B}{B} (You may cast this spell by sacrificing an artifact and paying the emerge cost reduced by that artifact\'s mana value.)\nWhen this creature enters, target opponent exiles the top card of their library, a card at random from their graveyard, and a card at random from their hand. You may cast a spell from among cards exiled this way without paying its mana cost.', ['5', '5'], '{6}{B}{B}');
  const RELIC = card('Test Big Relic', 'Artifact', '', undefined, '{5}');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2'], '{5}');
  const GAINS = [3, 5, 7].map((n) => card(`Test Gain ${n}`, 'Instant', `You gain ${n} life.`, undefined, '{1}{W}'));
  const defs = [CRAB, RELIC, BEAR, ...GAINS];
  const start = (seed: string): GameState => mpScenario({
    defs, seed, cards: ['Swamp'],
    zones: {
      p1: { battlefield: ['Test Big Relic', 'Test Plain Bear', 'Swamp', 'Swamp'], hand: ['Test Crab Fiend'] },
      p2: { graveyard: ['Test Gain 3', 'Plains'], hand: ['Test Gain 5', 'Test Gain 7'] },
    },
  });
  const zoneNames = (s: GameState, z: 'exile', p: PlayerId): string[] => s.zones[z].filter((id) => s.objects[id]!.owner === p).map((id) => s.defs[s.objects[id]!.defId]!.name);

  it('compiles full', () => {
    expect(full(CRAB)).toBe(true);
    const kw = CRAB.faces[0]!.abilities[0] as unknown as { keyword: string; quality?: string };
    expect([kw.keyword, kw.quality]).toEqual(['emerge', 'type:Artifact']);
  });

  it('emerge from artifact: only the artifact may be sacrificed (not the creature), and its mana value 5 reduces {5}{B}{B} to {B}{B}', () => {
    let s = start('edhn127-crab-cast');
    s = mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Crab Fiend', 'hand', 'p1'), method: 'emerge' } as never);
    expect(s.pending?.kind).toBe('chooseObjects');
    const opts = (s.pending as unknown as { options: ObjectId[] }).options;
    expect(opts).toEqual(bf(s, 'Test Big Relic'));
    s = manswer(s, { kind: 'chooseObjects', ids: opts });
    for (let g = 0; g < 10 && s.pending && s.pending.kind !== 'priority'; g++) {
      if (s.pending.kind === 'payCost') s = manswer(s, { kind: 'payCost', auto: true });
      else break;
    }
    expect(s.zones.stack.length, 'cast with two Swamps').toBe(1);
    expect(bf(s, 'Test Big Relic')).toEqual([]);
    expect(bf(s, 'Test Plain Bear').length).toBe(1);
  });

  it('the enters trigger: the opponent loses the top card of their library, one random graveyard card and one random hand card to exile; you may cast one nonland card of them free; a land stays', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      let s = start(seed);
      s = mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Crab Fiend', 'hand', 'p1'), method: 'emerge' } as never);
      const lib0 = library(s, 'p2');
      const before = lifeOf(s, 'p1');
      let offered: string[] = [];
      s = run(s, {
        players: ['p2'],
        objects: (options, prompt, st, who) => {
          if (/sacrifice/i.test(prompt)) return options.slice(0, 1);
          offered = options.map((id) => st.defs[st.objects[id]!.defId]!.name);
          expect(who).toBe('p1');
          return options.slice(0, 1);
        },
      });
      expect(bf(s, 'Test Crab Fiend').length, seed).toBe(1);
      expect(library(s, 'p2'), `${seed}: the top card of the library`).toBe(lib0 - 1);
      // one card of the graveyard went to exile; the spell cast this way is the opponent's card, so it goes to THEIR graveyard as it resolves (CR 608.2n, 400.3)
      expect(s.zones.graveyard['p2']!.length, `${seed}: one card left the graveyard, the cast spell came back to it`).toBe(2);
      expect(hand(s, 'p2'), `${seed}: one card of the hand`).toBe(1);
      const ex = zoneNames(s, 'exile', 'p2');
      // three cards exiled, one of which was cast (back in the graveyard) when a spell was among them; the hand card is always a spell here
      const gained = lifeOf(s, 'p1') - before;
      expect([3, 5, 7], seed).toContain(gained);
      expect(offered.length, `${seed}: the nonland cards exiled this way are offered`).toBeGreaterThanOrEqual(1);
      expect(offered.every((n) => !/Plains/.test(n)), `${seed}: a land is never offered`).toBe(true);
      expect(ex.length, seed).toBe(2);
      seen.add(ex.slice().sort().join());
    }
    expect(seen.size, 'random cards: different results over the seeds').toBeGreaterThan(1);
  });
});

describe('CR 706.6, 509.1c, 509.1, 723.1: Berserker\'s Frenzy (two d20, the lower ignored; "they block this turn if able" or "you choose which creatures block this turn")', () => {
  const FRENZY = card('Test Battle Frenzy', 'Instant', 'Cast this spell only before combat or during combat before blockers are declared.\nRoll two d20 and ignore the lower roll.\n1-14 | Choose any number of creatures. They block this turn if able.\n15-20 | You choose which creatures block this turn and how those creatures block.');
  const BRUTE = card('Test Brute', 'Creature — Ogre', '', ['3', '3']);
  const GUARD = card('Test Guard', 'Creature — Human Soldier', '', ['2', '2']);
  const defs = [FRENZY, BRUTE, GUARD];
  const start = (seed: string): GameState => mpScenario({ defs, seed, zones: { p1: { battlefield: ['Test Brute'], hand: ['Test Battle Frenzy'] }, p2: { battlefield: ['Test Guard', 'Test Guard'] } } });
  /** Cast the Frenzy in the first main phase (choosing every creature p2 controls on 1-14), then attack p2 with the Brute; stops at the declaration of blockers. */
  const play = (seed: string): { s: GameState; rolls: number[] } => {
    let s = start(seed);
    s = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Battle Frenzy', 'hand', 'p1') }), { objects: (options, _p, st) => options.filter((id) => st.objects[id]!.controller === 'p2') });
    // "Alice rolls 2 d20 (11, 3) and ignores the lowest roll: 11." (the kept result last; the ignored die is never a roll of its own, CR 706.6)
    const rolls = s.log.flatMap((l) => { const m = /rolls 2 d20 \((\d+), (\d+)\) and ignores the lowest roll: (\d+)\./.exec(l.text); return m ? [Number(m[3])] : []; });
    const both = s.log.flatMap((l) => { const m = /rolls 2 d20 \((\d+), (\d+)\)/.exec(l.text); return m ? [Number(m[1]), Number(m[2])] : []; });
    if (both.length === 2) expect(rolls[0]).toBe(Math.max(both[0]!, both[1]!));
    s = manswer(toDeclareAttackers(s), { kind: 'declareAttackers', attacks: [{ attacker: bf(s, 'Test Brute')[0]!, defender: 'p2' }] });
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'the declaration of blockers');
    return { s, rolls };
  };

  it('compiles full: one roll of two d20 keeping the higher, a table of two rows', () => {
    expect(full(FRENZY)).toBe(true);
    const roll = (FRENZY.faces[0]!.abilities[1] as unknown as { effect: { steps: { op: string; count?: number; keepHighest?: boolean; table: { min: number; max: number; do: { op: string; turn?: boolean }[] }[] }[] } }).effect.steps[0]!;
    expect([roll.op, roll.count, roll.keepHighest]).toEqual(['rollDie', 2, true]);
    expect(roll.table.map((r) => [r.min, r.max, r.do.map((x) => x.op)])).toEqual([[1, 14, ['chooseObjects', 'effect']], [15, 20, ['controlBlocks']]]);
    expect(roll.table[1]!.do[0]!.turn, 'edh-d-89\'s turn-long controlBlocks (reused)').toBe(true);
  });

  it('only the higher die counts (one result is used); 1-14: the chosen creatures must block (a declaration without them is refused); 15-20: the caster declares the defender\'s blocks', () => {
    const rows = new Set<string>();
    for (const seed of SEEDS) {
      const { s, rolls } = play(seed);
      expect(rolls.length, `${seed}: one result, the higher of the two dice (CR 706.6)`).toBe(1);
      const r = rolls[0]!;
      const d = s.pending as unknown as { player: PlayerId; decidedBy?: PlayerId; mustObey?: number; requirements?: unknown[] };
      expect(d.player).toBe('p2');
      if (r <= 14) {
        rows.add('low');
        expect(d.decidedBy, seed).toBeUndefined();
        expect(d.mustObey ?? 0, `${seed}: the Guards must block if able`).toBeGreaterThan(0);
        expect(() => manswer(s, { kind: 'declareBlockers', blocks: [] }), seed).toThrow();
      } else {
        rows.add('high');
        expect(d.decidedBy, `${seed}: the caster chooses the blocks`).toBe('p1');
        expect(d.mustObey ?? 0, seed).toBe(0);
      }
    }
    expect(rows.size, 'both rows came up over the seeds').toBe(2);
  });

  it('"this turn": the caster\'s choice of blocks ends with the turn (the next turn\'s combats are the defenders\' own)', () => {
    for (const seed of SEEDS) {
      const { s } = play(seed);
      if (s.turn.blocksBy === undefined) continue;
      expect(s.turn.blocksBy).toBe('p1');
      const t = passUntil(manswer(s, { kind: 'declareBlockers', blocks: [] }), (x) => x.turn.activePlayer === 'p2', 'the next turn');
      expect(t.turn.blocksBy).toBeUndefined();
      return;
    }
    throw new Error('no seed rolled 15-20');
  });
});

describe('CR 701.21a, 706.2, 608.2h: Danse Macabre (each player sacrifices; the roll adds the toughness of YOUR creature; one or up to two cards come back under your control)', () => {
  const DANSE = card('Test Grave Dance', 'Sorcery', 'Each player sacrifices a nontoken creature of their choice. Roll a d20 and add the toughness of the creature you sacrificed this way.\n1-14 | Return a creature card put into a graveyard this way to the battlefield under your control.\n15+ | Return up to two creature cards put into graveyards this way to the battlefield under your control.', undefined, '{0}');
  const WALL = card('Test Mid Wall', 'Creature — Wall', '', ['0', '5']);
  const GIANT = card('Test Tall Giant', 'Creature — Giant', '', ['1', '20']);
  const defs = [DANSE, WALL, GIANT];
  const natural = (s: GameState): number[] => s.log.flatMap((l) => { const m = /rolls a d20: (\d+)\./.exec(l.text); return m ? [Number(m[1])] : []; });
  const mine = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => s.defs[s.objects[id]!.defId]!.name).sort();

  it('compiles full: the roll adds the toughness of what the each-player sacrifice took that YOU controlled (`by: you`, a total: none is 0)', () => {
    expect(full(DANSE)).toBe(true);
    const steps = (DANSE.faces[0]!.abilities[0] as unknown as { effect: { steps: Record<string, unknown>[] } }).effect.steps;
    expect(steps[0]!['op']).toBe('sacrificeChoice');
    expect(steps[1]!['modifier']).toEqual({ q: 'stat', stat: 'toughness', of: { ref: 'bound', name: steps[0]!['as'] }, by: { ref: 'you' }, sum: true });
  });

  it('only your creature\'s toughness (5) is added, never the opponent\'s 20: 1-9 brings one card back, 10-20 up to two; the cards come from every graveyard, under your control', () => {
    const rows = new Set<string>();
    for (const seed of SEEDS) {
      let s = mpScenario({ defs, seed, zones: { p1: { hand: ['Test Grave Dance'], battlefield: ['Test Mid Wall'] }, p2: { battlefield: ['Test Tall Giant'] } } });
      s = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Grave Dance', 'hand', 'p1') }), { objects: (options, _p, _st, _who, max) => options.slice(0, max) });
      const [n] = natural(s);
      expect(n, seed).toBeDefined();
      if (n! + 5 <= 14) {
        rows.add('one');
        expect(mine(s, 'p1').length, `${seed}: ${n} + 5 = ${n! + 5}: one card`).toBe(1);
      } else {
        rows.add('two');
        expect(mine(s, 'p1'), `${seed}: ${n} + 5 = ${n! + 5}: both cards, the opponent's too, under your control`).toEqual(['Test Mid Wall', 'Test Tall Giant']);
      }
      expect(mine(s, 'p2'), seed).toEqual([]);
    }
    expect(rows.size, 'both rows came up').toBe(2);
  });

  it('negative (ruling 2021-07-23): you sacrificed nothing, so nothing is added; tokens are not sacrificed', () => {
    for (const seed of SEEDS) {
      let s = mpScenario({ defs, seed, zones: { p1: { hand: ['Test Grave Dance'] }, p2: { battlefield: ['Test Tall Giant'] } } });
      s = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Grave Dance', 'hand', 'p1') }), { objects: (options, _p, _st, _who, max) => options.slice(0, max) });
      const [n] = natural(s);
      // 15+ only on a natural 15-20: then the one card (the Giant) comes back; on 1-14 it comes back too (one card)
      expect(mine(s, 'p1'), `${seed}: ${n}`).toEqual(['Test Tall Giant']);
      expect(n! <= 20).toBe(true);
    }
  });
});

describe('CR 706.3a, 608.2d: Thunderwave (three rows; "you may choose a creature ... each creature not chosen this way")', () => {
  const WAVE = card('Test Thunder Pulse', 'Sorcery', 'Roll a d20.\n1-9 | Test Thunder Pulse deals 3 damage to each creature.\n10-19 | You may choose a creature. Test Thunder Pulse deals 3 damage to each creature not chosen this way.\n20 | Test Thunder Pulse deals 6 damage to each creature your opponents control.', undefined, '{0}');
  const RAT = card('Test Small Rat', 'Creature — Rat', '', ['1', '1']);
  const HULK = card('Test Big Hulk', 'Creature — Giant', '', ['7', '7']);
  const defs = [WAVE, RAT, HULK];
  const natural = (s: GameState): number => Number(/rolls a d20: (\d+)\./.exec(s.log.map((l) => l.text).join('\n'))![1]);
  const play = (seed: string, choose: boolean): GameState => {
    const s = mpScenario({ defs, seed: `${seed}-wave`, zones: { p1: { hand: ['Test Thunder Pulse'], battlefield: ['Test Small Rat'] }, p2: { battlefield: ['Test Small Rat', 'Test Big Hulk'] } } });
    return run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Thunder Pulse', 'hand', 'p1') }), { objects: (options, _p, st) => (choose ? options.filter((id) => st.objects[id]!.controller === 'p1' && st.defs[st.objects[id]!.defId]!.name === 'Test Small Rat') : []) });
  };
  const SEEDS40 = Array.from({ length: 40 }, (_, i) => `edhn127w-${i}`);

  it('compiles full: a table of three rows covering 1-20', () => {
    expect(full(WAVE)).toBe(true);
    const roll = (WAVE.faces[0]!.abilities[0] as unknown as { effect: { steps: { op: string; table: { min: number; max: number }[] }[] } }).effect.steps[0]!;
    expect(roll.table.map((r) => [r.min, r.max])).toEqual([[1, 9], [10, 19], [20, 20]]);
  });

  it('each row does what it says: 1-9 every creature is dealt 3; 10-19 every creature but the one you chose; 20 the opponents\' creatures are dealt 6, yours none', () => {
    const rows = new Set<string>();
    for (const seed of SEEDS40) {
      const s = play(seed, true);
      const r = natural(s);
      const p1Rat = bf(s, 'Test Small Rat', 'p1').length;
      const p2Rat = bf(s, 'Test Small Rat', 'p2').length;
      const hulk = bf(s, 'Test Big Hulk')[0]!;
      if (r <= 9) { rows.add('1-9'); expect([p1Rat, p2Rat, s.objects[hulk]!.damage], `${seed}: ${r}`).toEqual([0, 0, 3]); }
      else if (r <= 19) { rows.add('10-19'); expect([p1Rat, p2Rat, s.objects[hulk]!.damage], `${seed}: ${r}: the chosen rat is spared`).toEqual([1, 0, 3]); }
      else { rows.add('20'); expect([p1Rat, p2Rat, s.objects[hulk]!.damage], `${seed}: ${r}: only the opponents' creatures, 6 each`).toEqual([1, 0, 6]); }
    }
    expect(rows.has('1-9') && rows.has('10-19'), [...rows].join()).toBe(true);
  });

  it('20 (searched for among seeds): only the opponents\' creatures are dealt 6 damage', () => {
    for (let k = 0; k < 400; k++) {
      const s = play(`edhn127w20-${k}`, true);
      if (natural(s) !== 20) continue;
      expect([bf(s, 'Test Small Rat', 'p1').length, bf(s, 'Test Small Rat', 'p2').length, s.objects[bf(s, 'Test Big Hulk')[0]!]!.damage]).toEqual([1, 0, 6]);
      return;
    }
    throw new Error('no seed rolled a 20');
  });

  it('negative (10-19): choosing nothing spares nothing', () => {
    let tested = 0;
    for (const seed of SEEDS40) {
      const s = play(seed, false);
      const r = natural(s);
      if (r < 10 || r > 19) continue;
      tested++;
      expect([bf(s, 'Test Small Rat', 'p1').length, bf(s, 'Test Small Rat', 'p2').length], seed).toEqual([0, 0]);
    }
    expect(tested).toBeGreaterThan(0);
  });
});

describe('CR 603.7a, 609.4b: The Ruinous Powers ("When you cast a spell this way, its owner loses life equal to its mana value")', () => {
  const POWERS = card('Test Dark Powers', 'Enchantment', "At the beginning of your upkeep, choose an opponent at random. Exile the top card of that player's library. Until end of turn, you may play that card and you may spend mana as though it were mana of any color to cast it. When you cast a spell this way, its owner loses life equal to its mana value.", undefined, '{3}');
  const BOLT = card('Test Red Spark', 'Sorcery', 'You gain 1 life.', undefined, '{1}{R}');
  const OWN = card('Test Own Spark', 'Sorcery', 'You gain 1 life.', undefined, '{1}');
  const defs = [POWERS, BOLT, OWN];
  /** p1's next upkeep trigger resolved (the top card of the random opponent's library exiled); every opponent's library has two Sparks on top (one is drawn in their turn). */
  const toMain = (seed: string): GameState => {
    let s = mpScenario({
      defs, seed, zones: { p1: { battlefield: ['Test Dark Powers', 'Plains', 'Plains'], hand: ['Test Own Spark'] } },
      setup: (x) => { for (const p of ['p2', 'p3', 'p4']) { for (let k = 0; k < 2; k++) { const id = `${p}-spark-${k}`; x.objects[id] = { ...JSON.parse(JSON.stringify(x.objects[x.zones.library[p]![0]!])), id, defId: BOLT.id, owner: p, controller: p }; x.zones.library[p]!.unshift(id); } } },
    });
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2', 'the next turn');
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'upkeep' && x.zones.stack.length > 0, 'p1\'s upkeep trigger');
    return run(s, { until: (x) => x.turn.step === 'main1' });
  };
  const exiledSpark = (s: GameState): ObjectId | undefined => s.zones.exile.find((id) => s.objects[id]!.defId === BOLT.id);

  it('compiles full: the permission carries the delayed trigger (onCast)', () => {
    expect(full(POWERS)).toBe(true);
    expect(JSON.stringify(POWERS.faces[0]!.abilities[0])).toContain('"onCast":[{"op":"loseLife","who":{"ref":"ownerOf","object":{"ref":"event","role":"spell"}},"amount":{"q":"stat","stat":"manaValue","of":{"ref":"event","role":"spell"}}}]');
  });

  it('casting the exiled card (red, paid with Plains: any color) makes its owner lose life equal to its mana value (2); nobody else loses life', () => {
    const owners = new Set<string>();
    for (const seed of SEEDS.slice(0, 6)) {
      let s = toMain(seed);
      const spark = exiledSpark(s);
      expect(spark, seed).toBeDefined();
      const owner = s.objects[spark!]!.owner;
      owners.add(owner);
      const life = Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map((p) => [p, lifeOf(s, p)]));
      s = run(mact(s, { type: 'cast', player: 'p1', card: spark! }), {});
      for (const p of ['p1', 'p2', 'p3', 'p4']) expect(lifeOf(s, p), `${seed} ${p}`).toBe(life[p]! - (p === owner ? 2 : 0) + (p === 'p1' ? 1 : 0));
    }
    expect(owners.size, 'the opponent is chosen at random').toBeGreaterThan(1);
  });

  it('negative: a spell cast from your hand (not this way) makes nobody lose life; once the turn ends the exiled card can no longer be cast', () => {
    let s = toMain('edhn127-powers-neg');
    const life = Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map((p) => [p, lifeOf(s, p)]));
    s = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Own Spark', 'hand', 'p1') }), {});
    for (const p of ['p2', 'p3', 'p4']) expect(lifeOf(s, p), p).toBe(life[p]);
    const spark = exiledSpark(s)!;
    expect(playPermitted(s, 'p1', spark, false), 'this turn: permitted').toBe(true);
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2', 'the next turn');
    expect(playPermitted(s, 'p1', spark, false), 'after the turn: no longer (CR 611.2a)').toBe(false);
  });
});

describe('CR 702.54b, 118.12: Indoraptor, the Perfect Hybrid (Bloodthirst X; the random opponent sacrifices or is dealt damage)', () => {
  const RAPTOR = card('Test Hybrid Raptor', 'Legendary Creature — Dinosaur Mutant', 'Bloodthirst X (This creature enters with X +1/+1 counters on it, where X is the damage dealt to your opponents this turn.)\nMenace\nEnrage — Whenever Test Hybrid Raptor is dealt damage, choose an opponent at random. Test Hybrid Raptor deals damage equal to its power to that player unless they sacrifice a nontoken creature of their choice.', ['3', '1'], '{0}');
  const PING = card('Test Ping Player', 'Instant', 'Test Ping Player deals 2 damage to target player.', undefined, '{0}');
  const NICK = card('Test Nick Creature', 'Instant', 'Test Nick Creature deals 1 damage to target creature.', undefined, '{0}');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [RAPTOR, PING, NICK, BEAR];
  const plusOne = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['+1/+1'] ?? 0;
  const castAt = (s: GameState, name: string, sc: Script = {}): GameState => run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, name, 'hand', 'p1') }), sc);

  it('compiles full', () => expect(full(RAPTOR)).toBe(true));

  it('Bloodthirst X: the damage dealt to ALL your opponents this turn (2 + 2) is the number of counters; damage to you does not count', () => {
    let s = mpScenario({ defs, seed: 'edhn127-raptor-bt', zones: { p1: { hand: ['Test Ping Player', 'Test Ping Player', 'Test Ping Player', 'Test Hybrid Raptor'] } } });
    s = castAt(s, 'Test Ping Player', { players: ['p2'] });
    s = castAt(s, 'Test Ping Player', { players: ['p3'] });
    s = castAt(s, 'Test Ping Player', { players: ['p1'] });
    s = castAt(s, 'Test Hybrid Raptor');
    expect(plusOne(s, bf(s, 'Test Hybrid Raptor')[0]!)).toBe(4);
  });

  it('negative: with no damage dealt to an opponent this turn it enters with no counters', () => {
    let s = mpScenario({ defs, seed: 'edhn127-raptor-bt0', zones: { p1: { hand: ['Test Ping Player', 'Test Hybrid Raptor'] } } });
    s = castAt(s, 'Test Ping Player', { players: ['p1'] });
    s = castAt(s, 'Test Hybrid Raptor');
    expect(plusOne(s, bf(s, 'Test Hybrid Raptor')[0]!)).toBe(0);
  });

  it('enrage: dealt damage, a random opponent either sacrifices a nontoken creature (their choice) or is dealt damage equal to its power (3)', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      for (const pay of [true, false]) {
        let s = mpScenario({ defs, seed, zones: { p1: { battlefield: ['Test Hybrid Raptor'], hand: ['Test Nick Creature'] }, p2: { battlefield: ['Test Plain Bear'] }, p3: { battlefield: ['Test Plain Bear'] }, p4: { battlefield: ['Test Plain Bear'] } } });
        const raptor = bf(s, 'Test Hybrid Raptor')[0]!;
        const life = Object.fromEntries(['p2', 'p3', 'p4'].map((p) => [p, lifeOf(s, p)]));
        s = castAt(s, 'Test Nick Creature', { targets: [raptor], yes: (_pr, who) => (who === 'p1' ? true : pay), objects: (options, _p, _st, _who, max) => options.slice(0, max) });
        const hit = ['p2', 'p3', 'p4'].filter((p) => lifeOf(s, p) !== life[p]);
        const sacrificed = ['p2', 'p3', 'p4'].filter((p) => bf(s, 'Test Plain Bear', p).length === 0);
        expect(hit.length + sacrificed.length, `${seed} ${pay}: exactly one opponent is affected`).toBe(1);
        if (pay) { expect(sacrificed.length, seed).toBe(1); seen.add(sacrificed[0]!); }
        else { expect(hit.length, seed).toBe(1); expect(lifeOf(s, hit[0]!)).toBe(life[hit[0]!]! - 3); seen.add(hit[0]!); }
      }
    }
    expect(seen.size, 'the opponent is chosen at random').toBeGreaterThan(1);
  });

  it('an opponent with no nontoken creature cannot sacrifice and is dealt the damage; Indoraptor dying from the damage still uses its last known power (ruling 2023-11-10)', () => {
    let s = mpScenario({ defs, seed: 'edhn127-raptor-lki', zones: { p1: { battlefield: ['Test Hybrid Raptor'], hand: ['Test Nick Creature'] } } });
    const raptor = bf(s, 'Test Hybrid Raptor')[0]!;
    const total = (x: GameState): number => ['p2', 'p3', 'p4'].reduce((n, p) => n + lifeOf(x, p), 0);
    const before = total(s);
    s = castAt(s, 'Test Nick Creature', { targets: [raptor], yes: () => true });
    expect(bf(s, 'Test Hybrid Raptor'), 'the 3/1 died of the 1 damage').toEqual([]);
    expect(total(s), 'one opponent was dealt 3').toBe(before - 3);
  });
});

describe('CR 115.1, 601.2c, 707.12: Mysterious Stranger (one target in each graveyard that has one; a random copy cast free)', () => {
  const STRANGER = card('Test Odd Stranger', 'Creature — Human Rogue', 'Flash\nWhen this creature enters, for each graveyard with an instant or sorcery card in it, exile target instant or sorcery card from that graveyard. If two or more cards are exiled this way, choose one of them at random and copy it. You may cast the copy without paying its mana cost.', ['2', '2'], '{0}');
  const GAINS = [1, 2, 3].map((n) => card(`Test Lore ${n}`, n === 2 ? 'Sorcery' : 'Instant', `You gain ${n} life.`, undefined, '{2}{U}'));
  const defs = [STRANGER, ...GAINS];
  const start = (seed: string, three = true): GameState => mpScenario({
    defs, seed,
    zones: { p1: { hand: ['Test Odd Stranger'], graveyard: ['Test Lore 1'] }, p2: { graveyard: three ? ['Test Lore 2', 'Plains'] : ['Plains'] }, p3: { graveyard: three ? ['Test Lore 3'] : [] } },
  });
  const inYard = (s: GameState, p: PlayerId, name: string): ObjectId => s.zones.graveyard[p]!.find((id) => s.defs[s.objects[id]!.defId]!.name === name)!;
  const exiledOf = (s: GameState): string[] => s.zones.exile.map((id) => s.defs[s.objects[id]!.defId]!.name).sort();

  it('compiles full: the target is one per graveyard that has one (eachWithOne)', () => {
    expect(full(STRANGER)).toBe(true);
    const spec = (STRANGER.faces[0]!.abilities[1] as unknown as { effect: { targets: Record<string, unknown>[] } }).effect.targets[0]!;
    expect([spec['perPlayer'], spec['eachWithOne'], spec['min'], spec['max']]).toEqual([true, true, 1, 1]);
  });

  it('three graveyards hold an instant or sorcery: all three are targeted and exiled; one of them, at random, is copied and the copy cast free (you gain its amount)', () => {
    const gained = new Set<number>();
    for (const seed of SEEDS) {
      let s = start(seed);
      const picks = [inYard(s, 'p1', 'Test Lore 1'), inYard(s, 'p2', 'Test Lore 2'), inYard(s, 'p3', 'Test Lore 3')];
      const before = lifeOf(s, 'p1');
      s = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Odd Stranger', 'hand', 'p1') }), { targetSets: [picks], yes: () => true });
      expect(exiledOf(s), seed).toEqual(['Test Lore 1', 'Test Lore 2', 'Test Lore 3']);
      const g = lifeOf(s, 'p1') - before;
      expect([1, 2, 3], seed).toContain(g);
      gained.add(g);
    }
    expect(gained.size, 'the copied card is chosen at random').toBeGreaterThan(1);
  });

  it('every graveyard that has one must be targeted (two of the three is refused); a copy not cast does nothing', () => {
    let s = start('edhn127-stranger-two');
    const picks = [inYard(s, 'p1', 'Test Lore 1'), inYard(s, 'p2', 'Test Lore 2')];
    expect(() => run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Odd Stranger', 'hand', 'p1') }), { targetSets: [picks] })).toThrow();
    s = start('edhn127-stranger-decline');
    const before = lifeOf(s, 'p1');
    const all = [inYard(s, 'p1', 'Test Lore 1'), inYard(s, 'p2', 'Test Lore 2'), inYard(s, 'p3', 'Test Lore 3')];
    s = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Odd Stranger', 'hand', 'p1') }), { targetSets: [all], yes: () => false });
    expect(lifeOf(s, 'p1')).toBe(before);
    expect(exiledOf(s).length).toBe(3);
  });

  it('negative: only one graveyard holds one (one card exiled): nothing is copied', () => {
    let s = start('edhn127-stranger-one', false);
    const before = lifeOf(s, 'p1');
    s = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Odd Stranger', 'hand', 'p1') }), { targetSets: [[inYard(s, 'p1', 'Test Lore 1')]], yes: () => true });
    expect(exiledOf(s)).toEqual(['Test Lore 1']);
    expect(lifeOf(s, 'p1')).toBe(before);
  });
});
