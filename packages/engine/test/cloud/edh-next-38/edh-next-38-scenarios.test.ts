/**
 * Commander EDHREC ranks 8,751-10,000, round edh-next-38 (second pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. The Comprehensive
 * Rules cites were checked against the text of 2026-09-25 where the round's record says so; others are listed there as unverified.
 *
 *   CR 701.22a, 603.2c, 608.2h   "Whenever you scry, ~ gets +1/+1 until end of turn for each card looked at while scrying this way." (Celeborn the Wise)
 *   CR 601.2f, 107.3, 608.2h     "The next instant or sorcery spell you cast this turn costs {X} less to cast, where X is ..." (Kaza, Roil Chaser; Elminster)
 *   CR 122.1, 608.2c             "Then if that creature's power is greater than ~'s power, put another +1/+1 counter on ~." (Yorvo, Lord of Garenbrig)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/index';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const idOn = (s: GameState, name: string): ObjectId => s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === name)!;

function drive(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [] }); // scry: nothing to the bottom
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((i) => i.id) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)));
  return s;
}
const cast = (s: GameState, name: string): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') })));
const tappedLands = (s: GameState, p: PlayerId): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]!.name === 'Plains' && s.objects[id]!.tapped).length;
const library = (n: number): string[] => Array(n).fill('Island') as string[];
/** The scenario helper tops every library up with twenty Plains: cut p1's to exactly `n` cards (a short library, CR 701.22a: a scry looks at as many as there are). */
const shortLibrary = (s: GameState, n: number): GameState => { s.zones.library.p1 = s.zones.library.p1!.slice(0, n); return s; };

describe('CR 701.22a, 603.2c: "Whenever you scry, ~ gets +1/+1 until end of turn for each card looked at while scrying this way."', () => {
  const ELF = card('Test Seer', 'Creature — Elf', 'Whenever you scry, ~ gets +1/+1 until end of turn for each card looked at while scrying this way.', { pt: ['1', '1'] });
  const SCRY3 = card('Test Peek', 'Sorcery', 'Scry 3.');
  const defs = [ELF, SCRY3];
  const power = (libSize: number): number => {
    const s0 = shortLibrary(scenario(['Plains', 'Island'], { defs, p1: { battlefield: ['Test Seer'], hand: ['Test Peek'], library: library(libSize) }, p2: { library: library(3) } }), libSize);
    const s = cast(s0, 'Test Peek');
    return Number(getChars(s, idOn(s, 'Test Seer')).power);
  };
  it('is understood', () => { expect(noManual(ELF)).toBe(true); });
  it('scry 3 with five cards in the library looks at three cards: +3/+3', () => { expect(power(5)).toBe(4); });
  it('scry 3 with only two cards in the library looks at two cards: +2/+2, not three (negative)', () => { expect(power(2)).toBe(3); });
  it("an opponent's scry does not trigger it (negative)", () => {
    const THEIRS = card('Test Their Peek', 'Sorcery', 'Each opponent scries 3.');
    const s0 = scenario(['Plains', 'Island'], { defs: [ELF, THEIRS], p1: { battlefield: ['Test Seer'], hand: ['Test Their Peek'], library: library(5) }, p2: { library: library(5) } });
    const s = cast(s0, 'Test Their Peek');
    expect(Number(getChars(s, idOn(s, 'Test Seer')).power)).toBe(1);
  });
});

describe('CR 601.2f, 107.3, 608.2h: "the next instant or sorcery spell you cast this turn costs {X} less to cast, where X is the number of cards looked at while scrying this way."', () => {
  const MAGE = card('Test Loremaster', 'Creature — Human Wizard', 'Whenever you scry, the next instant or sorcery spell you cast this turn costs {X} less to cast, where X is the number of cards looked at while scrying this way.', { pt: ['1', '1'] });
  const SCRY2 = card('Test Glance', 'Sorcery', 'Scry 2.');
  const BOLT = card('Test Spark', 'Instant', 'You gain 1 life.', { cost: '{3}' });
  const BOLT2 = card('Test Spark Twin', 'Instant', 'You gain 1 life.', { cost: '{3}' });
  const defs = [MAGE, SCRY2, BOLT, BOLT2];
  const run = (libSize: number, next: string): GameState => {
    const s0 = shortLibrary(scenario(['Plains', 'Island'], { defs, p1: { battlefield: ['Test Loremaster', 'Plains', 'Plains', 'Plains', 'Plains'], hand: ['Test Glance', next], library: library(libSize) }, p2: { library: library(3) } }), libSize);
    return cast(cast(s0, 'Test Glance'), next);
  };
  it('is understood', () => { expect(noManual(MAGE)).toBe(true); });
  it('scry 2 with a full library: the next instant costs {3} - 2 = {1}: one land is tapped', () => { expect(tappedLands(run(5, 'Test Spark'), 'p1')).toBe(1); });
  it('scry 2 with one card in the library: X = 1, the instant costs {2} (negative: not 2)', () => { expect(tappedLands(run(1, 'Test Spark'), 'p1')).toBe(2); });
  it('only the NEXT spell is cheaper: a second instant costs its full {3}', () => {
    const s0 = scenario(['Plains', 'Island'], { defs, p1: { battlefield: ['Test Loremaster', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'], hand: ['Test Glance', 'Test Spark', 'Test Spark Twin'], library: library(5) }, p2: { library: library(3) } });
    const s1 = cast(cast(s0, 'Test Glance'), 'Test Spark');
    expect(tappedLands(s1, 'p1')).toBe(1);
    expect(tappedLands(cast(s1, 'Test Spark Twin'), 'p1')).toBe(4);
  });
  it('a creature spell is not an instant or sorcery: no reduction (negative)', () => {
    const CREATURE = card('Test Cub', 'Creature — Bear', '', { pt: ['1', '1'], cost: '{3}' });
    const s0 = scenario(['Plains', 'Island'], { defs: [...defs, CREATURE], p1: { battlefield: ['Test Loremaster', 'Plains', 'Plains', 'Plains', 'Plains'], hand: ['Test Glance', 'Test Cub'], library: library(5) }, p2: { library: library(3) } });
    expect(tappedLands(cast(cast(s0, 'Test Glance'), 'Test Cub'), 'p1')).toBe(3);
  });
});

describe('CR 601.2f, 107.3, 608.2h: "{T}: The next instant or sorcery spell you cast this turn costs {X} less to cast, where X is the number of Wizards you control as this ability resolves."', () => {
  const KAZA = card('Test Chaser', 'Creature — Human Wizard', '{T}: The next instant or sorcery spell you cast this turn costs {X} less to cast, where X is the number of Wizards you control as this ability resolves.', { pt: ['1', '1'] });
  const WIZ = card('Test Apprentice', 'Creature — Human Wizard', '', { pt: ['1', '1'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const SPARK = card('Test Zap', 'Instant', 'You gain 1 life.', { cost: '{3}' });
  const defs = [KAZA, WIZ, BEAR, SPARK];
  const tapped = (others: string[]): number => {
    const s0 = scenario(['Plains', 'Island'], { defs, p1: { battlefield: ['Test Chaser', ...others, 'Plains', 'Plains', 'Plains', 'Plains'], hand: ['Test Zap'], library: library(3) }, p2: { library: library(3) } });
    const s1 = resolveAll(drive(act(s0, { type: 'activate', player: 'p1', source: idOn(s0, 'Test Chaser'), ability: 'p:0:0' } as never)));
    return tappedLands(cast(s1, 'Test Zap'), 'p1');
  };
  it('is understood', () => { expect(noManual(KAZA)).toBe(true); });
  it('two Wizards (the Chaser itself and an Apprentice): X = 2, the {3} instant costs {1}', () => { expect(tapped(['Test Apprentice'])).toBe(1); });
  it('a Bear is no Wizard: with the Chaser alone X = 1 and the instant costs {2} (negative)', () => { expect(tapped(['Test Bear'])).toBe(2); });
});

describe('CR 122.1, 608.2c: "Then if that creature\'s power is greater than ~\'s power, put another +1/+1 counter on ~."', () => {
  const YORVO = card('Test Lord', 'Creature — Giant', 'Whenever another green creature you control enters, put a +1/+1 counter on ~. Then if that creature\'s power is greater than ~\'s power, put another +1/+1 counter on ~.', { pt: ['2', '2'] });
  const BIG = card('Test Brute', 'Creature — Beast', '', { pt: ['5', '5'], colors: ['G'] });
  const SMALL = card('Test Sprout', 'Creature — Plant', '', { pt: ['1', '1'], colors: ['G'] });
  const RED = card('Test Imp', 'Creature — Imp', '', { pt: ['6', '6'], colors: ['R'] });
  const FLASH = (n: string): CardDef => card(`Test Call ${n}`, 'Instant', `Return ${n} from your graveyard to the battlefield.`);
  const defs = [YORVO, BIG, SMALL, RED];
  const counters = (enter: string): number => {
    const s0 = scenario(['Plains', 'Island'], { defs, p1: { battlefield: ['Test Lord'], hand: [enter] }, p2: {} });
    const s = cast(s0, enter);
    return s.objects[idOn(s, 'Test Lord')]!.counters?.['+1/+1'] ?? 0;
  };
  void FLASH;
  it('is understood', () => { expect(noManual(YORVO)).toBe(true); });
  it('a 5/5 green creature enters: one counter (3/3), 5 > 3, so another one (4/4): two counters', () => { expect(counters('Test Brute')).toBe(2); });
  it('a 1/1 green creature enters: one counter, 1 is not greater than 3: only one (negative)', () => { expect(counters('Test Sprout')).toBe(1); });
  it('a red creature enters: no counter at all (negative)', () => { expect(counters('Test Imp')).toBe(0); });
});

describe('CR 701.22a, 603.3d, 115.1: "Whenever you scry, put a +1/+1 counter on each of up to X target creatures, where X is the number of cards looked at while scrying this way." (Elrond, Master of Healing; Elvish Mariner)', () => {
  const HEALER = card('Test Healer', 'Creature — Elf', 'Whenever you scry, put a +1/+1 counter on each of up to X target creatures, where X is the number of cards looked at while scrying this way.', { pt: ['1', '1'] });
  const SCRY2 = card('Test Glimpse', 'Sorcery', 'Scry 2.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [HEALER, SCRY2, BEAR];
  /** Cast the scry, answer every prompt (the trigger's targets: the first `pick` of Healer and Bear), pass priority until the stack is empty. */
  const run = (libSize: number, pick: number): GameState => {
    const s0 = shortLibrary(scenario(['Plains', 'Island'], { defs, p1: { battlefield: ['Test Healer', 'Test Bear'], hand: ['Test Glimpse'], library: library(libSize) }, p2: {} }), libSize);
    const targets = [{ kind: 'object' as const, id: idOn(s0, 'Test Healer') }, { kind: 'object' as const, id: idOn(s0, 'Test Bear') }].slice(0, pick);
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Glimpse', 'hand', 'p1') });
    for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      const p = s.pending;
      if (p && p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: s.zones.stack.length > 0 ? targets : [] });
      else if (p && p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [] });
      else if (p && p.kind === 'order') s = answer(s, { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((i) => i.id) });
      else if (p && p.kind !== 'priority') throw new Error(`unexpected decision ${p.kind}`);
      else s = pass(pass(s));
    }
    return s;
  };
  const counters = (s: GameState, name: string): number => s.objects[idOn(s, name)]!.counters?.['+1/+1'] ?? 0;
  it('is understood', () => { expect(noManual(HEALER)).toBe(true); });
  it('scry 2 with a full library: up to two targets, both creatures get a counter', () => {
    const s = run(5, 2);
    expect(counters(s, 'Test Healer')).toBe(1);
    expect(counters(s, 'Test Bear')).toBe(1);
  });
  it('scry 2 with one card in the library: X = 1, so one target is chosen and gets the counter; two targets are refused (negative)', () => {
    const s = run(1, 1);
    expect(counters(s, 'Test Healer') + counters(s, 'Test Bear')).toBe(1);
    expect(() => run(1, 2)).toThrow();
  });
});

describe("CR 601.2f, 107.3, 608.2h: \"{T}: The next instant or sorcery spell you cast this turn costs {X} less to cast, where X is this creature's power as this ability resolves.\" (Maelstrom Muse's amount)", () => {
  const MUSE = card('Test Muse', 'Creature — Bird', "{T}: The next instant or sorcery spell you cast this turn costs {X} less to cast, where X is this creature's power as this ability resolves.", { pt: ['3', '3'] });
  const SPARK = card('Test Flare', 'Instant', 'You gain 1 life.', { cost: '{4}' });
  it('is understood', () => { expect(noManual(MUSE)).toBe(true); });
  it('X is the power as the ability resolves: a 3-power creature makes the {4} instant cost {1}', () => {
    const s0 = scenario(['Plains', 'Island'], { defs: [MUSE, SPARK], p1: { battlefield: ['Test Muse', 'Plains', 'Plains', 'Plains', 'Plains'], hand: ['Test Flare'], library: library(3) }, p2: { library: library(3) } });
    const s1 = resolveAll(drive(act(s0, { type: 'activate', player: 'p1', source: idOn(s0, 'Test Muse'), ability: 'p:0:0' } as never)));
    expect(tappedLands(cast(s1, 'Test Flare'), 'p1')).toBe(1);
  });
});
