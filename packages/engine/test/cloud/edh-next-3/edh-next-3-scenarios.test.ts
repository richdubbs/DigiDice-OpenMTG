/**
 * Commander lane edh-next, round edh-next-3: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default
 * compiler, in 4-player games. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 701.56a, 702.62b, 122.6   "Time travel." (choose among your permanents and suspended cards with a time counter; add or remove one for each; the Scryfall ruling of 2023-10-13)
 *   CR 119.3, 107.1a, 107.1b     "you lose half your life, rounded up" (a negative life total halves to 0)
 *   CR 107.1a, 608.2e, 101.4     "Each player loses half their life, then discards half the cards in their hand, then sacrifices half the creatures they control of their choice. Round up each time."
 *                                and its thirds form with a sacrifice of lands
 *   CR 601.2f, 118.7, 121.1      "This spell costs {U} less to cast if an opponent cast two or more spells this turn."; "... {U}{U}{U} less ... if an opponent has drawn four or more cards this turn."
 *   CR 601.2i, 603.2             "Whenever you cast a spell other than your first spell each turn, ..."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, type GameState, type ObjectId } from '../../../src/index';
import { act, answer, find, mpScenario, pass as mpass } from '../../m12/rules/helpers';
import { card, full, counters } from '../cmd3/helpers';

type Pending = NonNullable<GameState['pending']>;
interface Driver { option?: (p: Pending & { kind: 'chooseOption' }) => string[]; objects?: (p: Pending & { kind: 'chooseObjects' }) => ObjectId[]; yes?: boolean }
/** Answer every decision but priority (defaults: the first option, the minimum of objects, no, auto payment). */
function drive(s0: GameState, d: Driver = {}, seen: string[] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseOption') { seen.push(p.prompt); s = answer(s, { kind: 'chooseOption', ids: d.option ? d.option(p) : [p.options[0]!.id] }); }
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.objects ? d.objects(p) : p.options.slice(0, p.min) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: d.yes ?? false });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [] });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: p.min });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const resolveAll = (s0: GameState, d: Driver = {}, seen: string[] = []): GameState => {
  let s = drive(s0, d, seen);
  for (let i = 0; i < 20 && s.zones.stack.length > 0; i++) s = drive(mpass(s), d, seen);
  return s;
};
const castNamed = (s: GameState, name: string, player = 'p1'): GameState => act(s, { type: 'cast', player, card: find(s, name, 'hand', player) });
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const onBf = (s: GameState, p: string, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && s.objects[id]!.controller === p);
const castable = (s: GameState, name: string, player = 'p1'): boolean => applyAction(s, { type: 'cast', player, card: find(s, name, 'hand', player) }).error === undefined;
/** Pass priority until `who` holds it. */
const passTo = (s0: GameState, who: string): GameState => { let s = s0; for (let i = 0; i < 6 && s.pending?.player !== who; i++) s = mpass(s); return s; };

describe('CR 701.56a, 702.62b, 122.6: "Time travel." (the player chooses, for each permanent they control and suspended card they own with a time counter, to add one, remove one or do neither)', () => {
  const RITE = card('Test Chrono Rite', 'Sorcery', 'Time travel. Draw a card.');
  const DIAL = card('Test Dial', 'Artifact', '{T}: You gain 1 life.');
  const SHADE = card('Test Lagging Shade', 'Creature — Shade', 'Suspend 2—{0}', ['2', '2']);
  const PLAIN = card('Test Plain Relic', 'Artifact', '');
  const defs = [RITE, DIAL, SHADE, PLAIN];
  const start = (extra: Partial<Parameters<typeof mpScenario>[0]> = {}): GameState => mpScenario({
    defs,
    zones: {
      p1: { hand: ['Test Chrono Rite'], battlefield: [{ name: 'Test Dial', counters: { time: 2 } } as never, { name: 'Test Plain Relic', counters: { time: 1 } } as never], exile: [{ name: 'Test Lagging Shade', counters: { time: 3 } } as never] },
      p2: { battlefield: [{ name: 'Test Dial', counters: { time: 2 } } as never] },
    },
    ...extra,
  });
  const pickBy = (picks: Record<string, string>) => (p: { prompt: string; options: { id: string }[] }): string[] => {
    for (const [name, pick] of Object.entries(picks)) if (p.prompt.includes(name)) return pick === 'none' ? [] : [pick];
    return [];
  };
  it('is automated', () => expect(full(RITE)).toBe(true));
  it('CR 701.56a: adds a time counter to one permanent, removes one from another and from the suspended card', () => {
    const s0 = start();
    const dial = onBf(s0, 'p1', 'Test Dial')[0]!;
    const relic = onBf(s0, 'p1', 'Test Plain Relic')[0]!;
    const shade = s0.zones.exile.find((id) => s0.objects[id]!.defId === 'Test Lagging Shade')!;
    const handBefore = s0.zones.hand['p1']!.length;
    const s = resolveAll(castNamed(s0, 'Test Chrono Rite'), { option: pickBy({ 'Test Dial': 'add', 'Test Plain Relic': 'remove', 'Test Lagging Shade': 'remove' }) });
    expect(counters(s, dial, 'time')).toBe(3);
    expect(counters(s, relic, 'time')).toBe(0);
    expect(counters(s, shade, 'time')).toBe(2);
    expect(s.zones.hand['p1']!.length).toBe(handBefore); // "Draw a card." still happens: the Rite left the hand, one card came in
  });
  it('CR 701.56a ("choose any number"): choosing nothing for every object changes nothing', () => {
    const s0 = start();
    const dial = onBf(s0, 'p1', 'Test Dial')[0]!;
    const s = resolveAll(castNamed(s0, 'Test Chrono Rite'), { option: () => [] });
    expect(counters(s, dial, 'time')).toBe(2);
  });
  it('negative: only your own permanents and the suspended cards you own are offered (an opponent\'s permanent and a card in exile without suspend are not)', () => {
    const s0 = start({ zones: {
      p1: { hand: ['Test Chrono Rite'], exile: [{ name: 'Test Plain Relic', counters: { time: 1 } } as never] },
      p2: { battlefield: [{ name: 'Test Dial', counters: { time: 2 } } as never] },
    } });
    const seen: string[] = [];
    const s = resolveAll(castNamed(s0, 'Test Chrono Rite'), { option: () => ['add'] }, seen);
    expect(seen).toEqual([]);
    expect(counters(s, s.zones.battlefield.find((id) => s.objects[id]!.controller === 'p2')!, 'time')).toBe(2);
  });
  it('negative: a permanent with no time counter is not offered, even with another kind of counter', () => {
    const s0 = start({ zones: { p1: { hand: ['Test Chrono Rite'], battlefield: [{ name: 'Test Dial', counters: { charge: 2 } } as never] } } });
    const seen: string[] = [];
    resolveAll(castNamed(s0, 'Test Chrono Rite'), { option: () => ['add'] }, seen);
    expect(seen).toEqual([]);
  });
  it('CR 702.62a: removing the last time counter of a suspended card lets its owner play it', () => {
    const s0 = start({ zones: { p1: { hand: ['Test Chrono Rite'], exile: [{ name: 'Test Lagging Shade', counters: { time: 1 } } as never] } } });
    const s = resolveAll(castNamed(s0, 'Test Chrono Rite'), { option: pickBy({ 'Test Lagging Shade': 'remove' }), yes: true });
    expect(onBf(s, 'p1', 'Test Lagging Shade').length).toBe(1);
  });
});

describe('CR 119.3, 107.1a, 107.1b: "you lose half your life, rounded up"', () => {
  const REAPER = card('Test Halver', 'Creature — Human', 'Whenever this creature attacks, you lose half your life, rounded up.', ['2', '2']);
  const SPELL = card('Test Halving Rite', 'Sorcery', 'You lose half your life, rounded up.');
  const run = (lifeTotal: number): GameState => {
    const s0 = mpScenario({ defs: [SPELL], zones: { p1: { hand: ['Test Halving Rite'] } }, life: lifeTotal });
    return resolveAll(castNamed(s0, 'Test Halving Rite'));
  };
  it('is automated', () => expect(full(REAPER)).toBe(true));
  it('CR 107.1a: 20 life loses 10; 7 life loses 4 (rounded up) and keeps 3', () => {
    expect(life(run(20), 'p1')).toBe(10);
    expect(life(run(7), 'p1')).toBe(3);
  });
  it('negative: the other players lose nothing', () => {
    const s = run(20);
    expect(life(s, 'p2')).toBe(20);
  });
  it('CR 107.1b (Scryfall ruling 2007-02-01): a negative life total halves to 0 and stays', () => {
    const s0 = mpScenario({ defs: [SPELL], zones: { p1: { hand: ['Test Halving Rite'] } } });
    s0.players.find((p) => p.id === 'p1')!.life = -10;
    const s = resolveAll(castNamed(s0, 'Test Halving Rite'));
    expect(life(s, 'p1')).toBe(-10);
  });
});

describe('CR 107.1a, 608.2e, 101.4: "Each player loses half their life, then discards half the cards in their hand, then sacrifices half the creatures they control of their choice. Round up each time."', () => {
  const FRAY = card('Test Fraying Rite', 'Sorcery', 'Each player loses half their life, then discards half the cards in their hand, then sacrifices half the creatures they control of their choice. Round up each time.');
  const POX = card('Test Third Rite', 'Sorcery', 'Each player loses a third of their life, then discards a third of the cards in their hand, then sacrifices a third of the creatures they control of their choice, then sacrifices a third of the lands they control of their choice. Round up each time.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const FILLER = card('Test Filler', 'Sorcery', 'You gain 1 life.');
  const cards = (n: number, name: string): string[] => Array(n).fill(name);
  const board = (p: string, n: number, m: number): Record<string, unknown> => ({ [p]: { battlefield: [...cards(n, 'Test Bear'), ...cards(m, 'Plains')], hand: cards(5, 'Test Filler') } });
  it('are automated', () => { expect(full(FRAY)).toBe(true); expect(full(POX)).toBe(true); });
  it('CR 107.1a (Scryfall ruling 2018-07-13): 5 life, 5 cards and 5 creatures lose 3, discard 3 and sacrifice 3', () => {
    const s0 = mpScenario({ defs: [FRAY, BEAR, FILLER], life: 5, zones: { p1: { hand: ['Test Fraying Rite', ...cards(5, 'Test Filler')] }, ...board('p2', 5, 0) } as never });
    const s = resolveAll(castNamed(s0, 'Test Fraying Rite'), { objects: (p) => p.options.slice(0, p.min) });
    expect(life(s, 'p2')).toBe(2);
    expect(s.zones.hand['p2']!.length).toBe(2);
    expect(onBf(s, 'p2', 'Test Bear').length).toBe(2);
    expect(life(s, 'p3')).toBe(2); // every player, the caster too
    expect(life(s, 'p1')).toBe(2);
  });
  it('CR 107.1a (Scryfall ruling 2007-09-16): thirds rounded up: 5 life loses 2, 5 cards discard 2, 5 creatures and 5 lands sacrifice 2 each', () => {
    const s0 = mpScenario({ defs: [POX, BEAR, FILLER], life: 5, zones: { p1: { hand: ['Test Third Rite'] }, ...board('p2', 5, 5) } as never });
    const s = resolveAll(castNamed(s0, 'Test Third Rite'), { objects: (p) => p.options.slice(0, p.min) });
    expect(life(s, 'p2')).toBe(3);
    expect(s.zones.hand['p2']!.length).toBe(3);
    expect(onBf(s, 'p2', 'Test Bear').length).toBe(3);
    expect(onBf(s, 'p2', 'Plains').length).toBe(3);
  });
  it('negative: the half version sacrifices no lands and the third version rounds 1 up to 1', () => {
    const s0 = mpScenario({ defs: [FRAY, BEAR, FILLER], life: 20, zones: { p1: { hand: ['Test Fraying Rite'] }, ...board('p2', 2, 4) } as never });
    const s = resolveAll(castNamed(s0, 'Test Fraying Rite'), { objects: (p) => p.options.slice(0, p.min) });
    expect(onBf(s, 'p2', 'Plains').length).toBe(4);
    expect(onBf(s, 'p2', 'Test Bear').length).toBe(1);
    expect(life(s, 'p2')).toBe(10);
  });
});

describe('CR 601.2f, 118.7, 121.1: "This spell costs {U} less to cast if an opponent cast two or more spells this turn." and "... if an opponent has drawn four or more cards this turn."', () => {
  const SCORN = card('Test Scornful Rite', 'Instant', 'This spell costs {U} less to cast if an opponent cast two or more spells this turn.\nYou gain 3 life.', undefined, '{1}{U}{U}');
  const SCORE = card('Test Even Rite', 'Instant', 'This spell costs {U}{U}{U} less to cast if an opponent has drawn four or more cards this turn.\nYou gain 3 life.', undefined, '{U}{U}{U}');
  const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.');
  const lands = (n: number): string[] => Array(n).fill('Island');
  const startScorn = (lns: number): GameState => mpScenario({ defs: [SCORN, SPARK], cards: ['Island'], zones: { p1: { hand: ['Test Scornful Rite'], battlefield: lands(lns) }, p2: { hand: ['Test Spark', 'Test Spark', 'Test Spark'] } } });
  const opponentCasts = (s0: GameState, times: number, who = 'p2'): GameState => {
    let s = s0;
    for (let i = 0; i < times; i++) s = resolveAll(drive(act(passTo(s, who), { type: 'cast', player: who, card: find(s, 'Test Spark', 'hand', who) })));
    return s;
  };
  it('are automated', () => { expect(full(SCORN)).toBe(true); expect(full(SCORE)).toBe(true); });
  it('CR 601.2f: after one opponent cast two spells, {1}{U}{U} costs {1}{U}: two Islands are enough', () => {
    expect(castable(opponentCasts(startScorn(2), 2), 'Test Scornful Rite')).toBe(true);
  });
  it('negative: after one opponent cast one spell, two Islands are not enough (the cost is still {1}{U}{U}); three are', () => {
    expect(castable(opponentCasts(startScorn(2), 1), 'Test Scornful Rite')).toBe(false);
    expect(castable(opponentCasts(startScorn(3), 1), 'Test Scornful Rite')).toBe(true);
  });
  it('negative (CR 102.3): two opponents that cast one spell each are not one opponent that cast two; one of them casting a second is', () => {
    const s0 = mpScenario({ defs: [SCORN, SPARK], cards: ['Island'], zones: { p1: { hand: ['Test Scornful Rite'], battlefield: lands(2) }, p2: { hand: ['Test Spark', 'Test Spark'] }, p3: { hand: ['Test Spark', 'Test Spark'] } } });
    const cast = (s: GameState, who: string): GameState => resolveAll(drive(act(passTo(s, who), { type: 'cast', player: who, card: find(s, 'Test Spark', 'hand', who) })));
    let s = cast(cast(s0, 'p2'), 'p3');
    expect(castable(s, 'Test Scornful Rite')).toBe(false);
    s = cast(s, 'p3');
    expect(castable(s, 'Test Scornful Rite')).toBe(true);
  });
  it('negative: spells the caster cast do not count', () => {
    const s0 = mpScenario({ defs: [SCORN, SPARK], cards: ['Island'], zones: { p1: { hand: ['Test Scornful Rite', 'Test Spark', 'Test Spark'], battlefield: lands(2) } } });
    let s = s0;
    for (let i = 0; i < 2; i++) s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spark', 'hand', 'p1') })));
    expect(castable(s, 'Test Scornful Rite')).toBe(false);
  });
  it('CR 121.1: an opponent that has drawn four cards this turn: {U}{U}{U} costs nothing; with three draws it still costs {U}{U}{U}; the caster\'s own draws do not count', () => {
    const GIFT = card('Test Gift Rite', 'Instant', 'You draw four cards.');
    const GIFT3 = card('Test Small Gift', 'Instant', 'You draw three cards.');
    const mk = (gift: string, who: string): GameState => {
      const s = mpScenario({ defs: [SCORE, GIFT, GIFT3], cards: ['Island'], zones: { p1: { hand: ['Test Even Rite', 'Test Gift Rite', 'Test Small Gift'] }, p2: { hand: ['Test Gift Rite', 'Test Small Gift'] }, p3: { hand: ['Test Gift Rite'] } } });
      return resolveAll(drive(act(passTo(s, who), { type: 'cast', player: who, card: find(s, gift, 'hand', who) })));
    };
    expect(castable(mk('Test Gift Rite', 'p2'), 'Test Even Rite')).toBe(true);
    expect(castable(mk('Test Gift Rite', 'p3'), 'Test Even Rite')).toBe(true);
    expect(castable(mk('Test Small Gift', 'p2'), 'Test Even Rite')).toBe(false);
    const own = mpScenario({ defs: [SCORE, GIFT], cards: ['Island'], zones: { p1: { hand: ['Test Even Rite', 'Test Gift Rite'] } } });
    expect(castable(resolveAll(drive(act(own, { type: 'cast', player: 'p1', card: find(own, 'Test Gift Rite', 'hand', 'p1') }))), 'Test Even Rite')).toBe(false);
  });
});

describe('CR 601.2i, 603.2: "Whenever you cast a spell other than your first spell each turn, put a +1/+1 counter on this creature."', () => {
  const TRACKER = card('Test Tracker', 'Creature — Dog', 'Whenever you cast a spell other than your first spell each turn, put a +1/+1 counter on this creature.', ['1', '1']);
  const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.');
  const start = (): GameState => mpScenario({ defs: [TRACKER, SPARK], zones: { p1: { hand: ['Test Spark', 'Test Spark', 'Test Spark'], battlefield: ['Test Tracker'] }, p2: { hand: ['Test Spark'] } } });
  const cast1 = (s: GameState, who = 'p1'): GameState => resolveAll(drive(act(s, { type: 'cast', player: who, card: find(s, 'Test Spark', 'hand', who) })));
  it('is automated', () => expect(full(TRACKER)).toBe(true));
  it('the first spell does nothing, the second and third each add a counter', () => {
    let s = start();
    const t = onBf(s, 'p1', 'Test Tracker')[0]!;
    s = cast1(s);
    expect(counters(s, t, '+1/+1')).toBe(0);
    s = cast1(s);
    expect(counters(s, t, '+1/+1')).toBe(1);
    s = cast1(s);
    expect(counters(s, t, '+1/+1')).toBe(2);
  });
  it('negative: an opponent\'s spells never trigger it', () => {
    let s = mpass(start());
    const t = onBf(s, 'p1', 'Test Tracker')[0]!;
    s = cast1(s, 'p2');
    expect(counters(s, t, '+1/+1')).toBe(0);
  });
});
