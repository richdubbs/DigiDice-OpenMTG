/**
 * Commander coordinator D, round edh-d-36 (lane counter-modes): the round's readings played through the engine with synthetic cards (invented names, design 6.10). Alice (p1) is the
 * active player of turn 1, Bob (p2) holds the counterspells. Each test is named after the rule it checks, with its negative case. CR cites from the Comprehensive Rules of 2026-09-25
 * (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt), checked where the round's record says so.
 *
 *   CR 701.6a, 614.15, 401.4      "If that spell is countered this way, put that card on your choice of the top or bottom of its owner's library instead of into that player's graveyard." (Hinder)
 *   CR 701.6a, 614.15, 110.2      "If an artifact or creature spell is countered this way, put that card onto the battlefield under your control instead of into its owner's graveyard." (Desertion)
 *   CR 701.6a, 202.3, 608.2h      "Counter target spell. You may cast a spell with mana value less than or equal to that spell's mana value from your graveyard / hand without paying its mana cost." (Counterpoint, Reinterpret)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { put } from '../../m3/scenario';
import { act, card, cast, drive, find, full, legal, passBoth, resolveAll, scenario } from '../r5-cost/support';

const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => nameOf(s, id));
const zoneNames = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: 'p1' | 'p2'): string[] => names(s, s.zones[zone][p]!);
const bf = (s: GameState, p: 'p1' | 'p2'): string[] => names(s, s.zones.battlefield.filter((id) => s.objects[id]!.controller === p)).sort();
/** Replace a player's whole library (the scenario's filler Plains included) with the named cards, top first. */
function setLibrary(s: GameState, p: 'p1' | 'p2', libNames: string[]): void {
  for (const id of s.zones.library[p]!) delete s.objects[id];
  s.zones.library[p] = [];
  for (const n of libNames) put(s, p, 'library', n);
}
/** p1 casts `name` (with targets); p1 passes priority; p2 answers by casting `counterName` at that spell; p2's counterspell resolves with the script. */
function counterIt(s0: GameState, name: string, counterName: string, script = {}, counterCast: Record<string, unknown> = {}): GameState {
  let s = cast(s0, name);
  const spell = s.zones.stack[0]!;
  s = act(s, { type: 'pass', player: 'p1' });
  expect(s.pending?.player).toBe('p2');
  s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, counterName, 'hand', 'p2') }), { targets: [[{ kind: 'object', id: spell }]], ...counterCast });
  return resolveAll(s, script);
}

const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const RELIC = card('Test Relic', 'Artifact', '', '{0}');
const BOLT = card('Test Spark', 'Instant', 'You gain 1 life.', '{0}');
const FILLER = card('Test Filler', 'Sorcery', '', '{0}');
const HINDER = card('Test Hindrance', 'Instant', 'Counter target spell. If that spell is countered this way, put that card on your choice of the top or bottom of its owner\'s library instead of into that player\'s graveyard.', '{0}');
const DESERT = card('Test Defection', 'Instant', 'Counter target spell. If an artifact or creature spell is countered this way, put that card onto the battlefield under your control instead of into its owner\'s graveyard.', '{0}');
const UNCOUNTERABLE = card('Test Steadfast Bear', 'Creature — Bear', 'This spell can\'t be countered.', '{0}', ['2', '2']);

describe('the synthetic cards are automated', () => {
  it('play fully', () => { for (const d of [HINDER, DESERT]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true); });
});

describe('"put that card on your choice of the top or bottom of its owner\'s library instead of into that player\'s graveyard" (CR 701.6a, 614.15, 401.4; Hinder)', () => {
  const defs = [BEAR, BOLT, FILLER, HINDER, UNCOUNTERABLE];
  const start = () => { const s = scenario([], { defs, p1: { hand: ['Test Spark'] }, p2: { hand: ['Test Hindrance'] } }); setLibrary(s, 'p1', ['Test Filler', 'Test Filler']); return s; };
  it('the countering player chooses the bottom: the countered spell is on the bottom of its owner\'s library, not in the graveyard', () => {
    const s = counterIt(start(), 'Test Spark', 'Test Hindrance', { options: [['bottom']] });
    expect(zoneNames(s, 'library', 'p1')).toEqual(['Test Filler', 'Test Filler', 'Test Spark']);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual([]);
    expect(s.players.find((x) => x.id === 'p1')!.life).toBe(20); // never resolved
  });
  it('and the top: it is the next card its owner draws', () => {
    const s = counterIt(start(), 'Test Spark', 'Test Hindrance', { options: [['top']] });
    expect(zoneNames(s, 'library', 'p1')).toEqual(['Test Spark', 'Test Filler', 'Test Filler']);
  });
  it('the negative case: a spell that can\'t be countered stays on the stack and resolves, and goes nowhere near the library', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Steadfast Bear'] }, p2: { hand: ['Test Hindrance'] } });
    setLibrary(s, 'p1', ['Test Filler']);
    s = counterIt(s, 'Test Steadfast Bear', 'Test Hindrance');
    expect(bf(s, 'p1')).toEqual(['Test Steadfast Bear']);
    expect(zoneNames(s, 'library', 'p1')).toEqual(['Test Filler']);
  });
});

describe('"If an artifact or creature spell is countered this way, put that card onto the battlefield under your control instead of into its owner\'s graveyard" (CR 701.6a, 614.15, 110.2; Desertion)', () => {
  const defs = [BEAR, RELIC, BOLT, DESERT, UNCOUNTERABLE];
  it('a countered creature spell enters the battlefield under the countering player\'s control', () => {
    const s = counterIt(scenario([], { defs, p1: { hand: ['Test Bear'] }, p2: { hand: ['Test Defection'] } }), 'Test Bear', 'Test Defection');
    expect(bf(s, 'p2')).toEqual(['Test Bear']);
    expect(bf(s, 'p1')).toEqual([]);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual([]);
  });
  it('and an artifact spell', () => {
    const s = counterIt(scenario([], { defs, p1: { hand: ['Test Relic'] }, p2: { hand: ['Test Defection'] } }), 'Test Relic', 'Test Defection');
    expect(bf(s, 'p2')).toEqual(['Test Relic']);
  });
  it('the negative case: an instant spell is countered the usual way (its owner\'s graveyard)', () => {
    const s = counterIt(scenario([], { defs, p1: { hand: ['Test Spark'] }, p2: { hand: ['Test Defection'] } }), 'Test Spark', 'Test Defection');
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Spark']);
    expect(bf(s, 'p2')).toEqual([]);
  });
  it('the negative case: a spell that can\'t be countered is not taken', () => {
    const s = counterIt(scenario([], { defs, p1: { hand: ['Test Steadfast Bear'] }, p2: { hand: ['Test Defection'] } }), 'Test Steadfast Bear', 'Test Defection');
    expect(bf(s, 'p1')).toEqual(['Test Steadfast Bear']);
    expect(bf(s, 'p2')).toEqual([]);
  });
});

describe('"Counter target spell. You may cast a spell with mana value less than or equal to that spell\'s mana value from your graveyard / hand without paying its mana cost." (CR 701.6a, 202.3, 608.2h, 601.2; Counterpoint, Reinterpret)', () => {
  const THREE = card('Test Triple', 'Sorcery', 'You gain 3 life.', '{3}');
  const TWO = card('Test Double', 'Sorcery', 'You gain 2 life.', '{2}');
  const FOUR = card('Test Quad', 'Sorcery', 'You gain 4 life.', '{4}');
  const COUNTERPOINT = card('Test Countermelody', 'Instant', 'Counter target spell. You may cast a creature, instant, sorcery, or planeswalker spell from your graveyard with mana value less than or equal to that spell\'s mana value without paying its mana cost.', '{0}');
  const REINTERPRET = card('Test Reframe', 'Instant', 'Counter target spell. You may cast a spell with equal or lesser mana value from your hand without paying its mana cost.', '{0}');
  const defs = [THREE, TWO, FOUR, COUNTERPOINT, REINTERPRET, BEAR];
  const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
  it('has no manual part', () => { for (const d of [COUNTERPOINT, REINTERPRET]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true); });
  it('Counterpoint offers only cards of the graveyard with mana value 3 or less (the countered spell\'s), and the chosen one is cast for free', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Triple'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: { hand: ['Test Countermelody'], graveyard: ['Test Double', 'Test Quad', 'Test Triple'] } });
    s = cast(s, 'Test Triple');
    const spell = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Countermelody', 'hand', 'p2') }), { targets: [[{ kind: 'object', id: spell }]] });
    s = passBoth(s); // the counterspell resolves: the spell is countered, then p2 chooses a card of their graveyard
    const p = s.pending as unknown as { kind: string; options: string[] };
    expect(p.kind).toBe('chooseObjects');
    expect(names(s, p.options).sort()).toEqual(['Test Double', 'Test Triple']); // not the mana value 4 card; the countered Triple is in its OWNER's (p1) graveyard
    const pick = p.options.find((id) => nameOf(s, id) === 'Test Double')!;
    s = resolveAll(drive(s, { objects: [[pick]] }));
    expect(life(s, 'p2')).toBe(22); // the free Double resolved
    expect(life(s, 'p1')).toBe(20); // the countered Triple never did
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Triple']);
  });
  it('Reinterpret offers only cards of the hand with mana value at most the countered spell\'s', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Double'], battlefield: ['Plains', 'Plains'] }, p2: { hand: ['Test Reframe', 'Test Triple', 'Test Double'] } });
    s = cast(s, 'Test Double');
    const spell = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Reframe', 'hand', 'p2') }), { targets: [[{ kind: 'object', id: spell }]] });
    s = passBoth(s);
    const p = s.pending as unknown as { kind: string; options: string[] };
    expect(p.kind).toBe('chooseObjects');
    expect(names(s, p.options)).toEqual(['Test Double']); // the Triple (3) is more than the countered spell's 2
    s = resolveAll(drive(s, { objects: [[p.options[0]!]] }));
    expect(life(s, 'p2')).toBe(22);
  });
  it('a spell with {X} in its mana cost counts with the X it was cast for (ruling 2021-04-16, 2024-02-02): countered with X = 3 it lets the Triple (3) be cast, not the Quad (4)', () => {
    const XSPELL = card('Test Variable', 'Sorcery', 'You gain 1 life.', '{X}');
    let s = scenario([], { defs: [...defs, XSPELL], p1: { hand: ['Test Variable'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: { hand: ['Test Reframe', 'Test Triple', 'Test Quad'] } });
    s = cast(s, 'Test Variable', { x: [3] });
    const spell = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Reframe', 'hand', 'p2') }), { targets: [[{ kind: 'object', id: spell }]] });
    s = passBoth(s);
    const p = s.pending as unknown as { kind: string; options: string[] };
    expect(names(s, p.options)).toEqual(['Test Triple']);
  });
  it('a spell that can\'t be countered is not countered, but the card is still cast (ruling 2021-04-16, 2024-02-02)', () => {
    const NOCOUNTER = card('Test Firm Spell', 'Sorcery', 'This spell can\'t be countered.\nYou gain 3 life.', '{2}');
    let s = scenario([], { defs: [...defs, NOCOUNTER], p1: { hand: ['Test Firm Spell'], battlefield: ['Plains', 'Plains'] }, p2: { hand: ['Test Countermelody'], graveyard: ['Test Double'] } });
    s = cast(s, 'Test Firm Spell');
    const spell = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Countermelody', 'hand', 'p2') }), { targets: [[{ kind: 'object', id: spell }]] });
    s = passBoth(s);
    const p = s.pending as unknown as { kind: string; options: string[] };
    expect(p.kind).toBe('chooseObjects');
    s = resolveAll(drive(s, { objects: [[p.options[0]!]] }));
    expect(life(s, 'p2')).toBe(22); // the Double was cast
    expect(life(s, 'p1')).toBe(23); // and the uncounterable spell resolved
  });
  it('the negative case: nothing is cast when the player chooses none', () => {
    const NOCOUNTER = card('Test Firm Spell', 'Sorcery', 'This spell can\'t be countered.\nYou gain 3 life.', '{0}');
    let s = scenario([], { defs: [...defs, NOCOUNTER], p1: { hand: ['Test Firm Spell'] }, p2: { hand: ['Test Countermelody'], graveyard: ['Test Double'] } });
    s = cast(s, 'Test Firm Spell');
    const spell = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Countermelody', 'hand', 'p2') }), { targets: [[{ kind: 'object', id: spell }]] });
    s = resolveAll(s, { objects: [[]] });
    expect(life(s, 'p1')).toBe(23);
  });
});

describe('"Counter target spell unless its controller pays twice {X}." (CR 118.12a, 107.3; Thassa\'s Intervention) and "... pays {X}. If that player doesn\'t, they tap all lands with mana abilities they control and lose all unspent mana." (CR 701.26a, 106.4; Power Sink)', () => {
  const TWICE = card('Test Twice Tax', 'Instant', 'Counter target spell unless its controller pays twice {X}.', '{X}');
  const SINK = card('Test Drain Tax', 'Instant', 'Counter target spell unless its controller pays {X}. If that player doesn\'t, they tap all lands with mana abilities they control and lose all unspent mana.', '{X}');
  const defs = [TWICE, SINK, BOLT, RELIC];
  const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
  const setup = (counter: string, lands: number) => scenario([], { defs, p1: { hand: ['Test Spark'], battlefield: Array(lands).fill('Plains') as string[] }, p2: { hand: [counter], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] } });
  it('has no manual part', () => { for (const d of [TWICE, SINK]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true); });
  it('twice X: with X = 2 the spell\'s controller must pay 4; paying it keeps the spell, and their lands are used', () => {
    const s = counterIt(setup('Test Twice Tax', 4), 'Test Spark', 'Test Twice Tax', { yes: [true] }, { x: [2] });
    expect(life(s, 'p1')).toBe(21); // the spell resolved
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.tapped)).toHaveLength(4);
  });
  it('twice X: a controller who can pay only X (not 2X) cannot pay, so the spell is countered', () => {
    const s = counterIt(setup('Test Twice Tax', 3), 'Test Spark', 'Test Twice Tax', { yes: [true] }, { x: [2] });
    expect(life(s, 'p1')).toBe(20);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Spark']);
  });
  it('twice X: declining to pay counters the spell', () => {
    const s = counterIt(setup('Test Twice Tax', 4), 'Test Spark', 'Test Twice Tax', { yes: [false] }, { x: [1] });
    expect(life(s, 'p1')).toBe(20);
  });
  it('Power Sink: a controller who does not pay has the spell countered, every land they control with a mana ability tapped, and the unspent mana lost', () => {
    let s = setup('Test Drain Tax', 3);
    s = cast(s, 'Test Spark');
    const spell = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Drain Tax', 'hand', 'p2') }), { targets: [[{ kind: 'object', id: spell }]], x: [3] });
    s = resolveAll(s, { yes: [false] });
    expect(life(s, 'p1')).toBe(20);
    const p1Lands = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1');
    expect(p1Lands.every((id) => s.objects[id]!.tapped)).toBe(true);
    const p2Lands = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2');
    expect(p2Lands.filter((id) => !s.objects[id]!.tapped)).toHaveLength(1); // 3 tapped to pay X = 3; the fourth is the countering player's, untouched: the tap-all is for the payer only
  });
  it('Power Sink taps only lands that have a mana ability (ruling 2010-03-01): a land with no mana ability stays untapped', () => {
    const DEAD = card('Test Dead Land', 'Land', '', '{0}');
    let s = scenario([], { defs: [...defs, DEAD], p1: { hand: ['Test Spark'], battlefield: ['Plains', 'Test Dead Land'] }, p2: { hand: ['Test Drain Tax'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] } });
    s = cast(s, 'Test Spark');
    const spell = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Drain Tax', 'hand', 'p2') }), { targets: [[{ kind: 'object', id: spell }]], x: [3] });
    s = resolveAll(s, { yes: [false] });
    const tapped = (n: string): boolean[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && nameOf(s, id) === n).map((id) => s.objects[id]!.tapped);
    expect(tapped('Plains')).toEqual([true]);
    expect(tapped('Test Dead Land')).toEqual([false]);
  });
  it('Power Sink, the negative case: a controller who pays X keeps the spell, their lands are untouched except those used to pay', () => {
    let s = setup('Test Drain Tax', 3);
    s = cast(s, 'Test Spark');
    const spell = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Drain Tax', 'hand', 'p2') }), { targets: [[{ kind: 'object', id: spell }]], x: [2] });
    s = resolveAll(s, { yes: [true] });
    expect(life(s, 'p1')).toBe(21);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.tapped)).toHaveLength(2); // only the two that paid
  });
});

describe('"you may counter target spell unless its controller pays {1}" (CR 118.12a, 701.6a, 608.2d; Complicate): the payer decides first', () => {
  const FLASHER = card('Test Quick Warden', 'Creature — Wizard', 'Flash\nWhen this creature enters, you may counter target spell unless its controller pays {1}.', '{0}', ['1', '1']);
  const defs = [FLASHER, BOLT];
  const setup = (lands: number) => scenario([], { defs, p1: { hand: ['Test Spark'], battlefield: Array(lands).fill('Plains') as string[] }, p2: { hand: ['Test Quick Warden'] } });
  const run = (s0: GameState, script: Record<string, unknown>): GameState => {
    let s = cast(s0, 'Test Spark');
    const spell = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Quick Warden', 'hand', 'p2') }));
    return resolveAll(s, { targets: [[{ kind: 'object', id: spell }]], ...script });
  };
  const life = (s: GameState): number => s.players.find((x) => x.id === 'p1')!.life;
  it('has no manual part', () => expect(full(FLASHER)).toBe(true));
  it('the payer decides first (CR 118.12a): if they do not pay {1}, you are asked and may counter; the spell is countered', () => {
    const s = run(setup(1), { yes: [false, true] });
    expect(life(s)).toBe(20);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Spark']);
  });
  it('its controller pays {1}: you are never asked and the spell resolves', () => {
    const s = run(setup(1), { yes: [true] });
    expect(life(s)).toBe(21);
  });
  it('the negative case: if they do not pay and you choose not to counter, the spell resolves', () => {
    const s = run(setup(1), { yes: [false, false] });
    expect(life(s)).toBe(21);
  });
});

describe('"Counter target loyalty ability of a planeswalker" (CR 606.2, 701.6a, 115.1; Verdant Command) and "Counter target activated or triggered ability from a noncreature source" (CR 113.7a; Dissonant Wave)', () => {
  const WALKER = compileCard({ name: 'Test Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Testy', oracle_text: '+1: You gain 3 life.', colors: [], keywords: [], loyalty: '3' } as OracleCard) as CardDef;
  const VERDANT = card('Test Walker Check', 'Instant', 'Counter target loyalty ability of a planeswalker.', '{0}');
  const WAVE = card('Test Noncreature Check', 'Instant', 'Counter target activated or triggered ability from a noncreature source.', '{0}');
  const MAKER = card('Test Maker', 'Creature — Wizard', '{0}: You gain 2 life.', '{0}', ['1', '1']);
  const RING = card('Test Ring', 'Artifact', '{0}: You gain 2 life.', '{0}');
  const defs = [WALKER, VERDANT, WAVE, MAKER, RING];
  const life = (s: GameState): number => s.players.find((x) => x.id === 'p1')!.life;
  const setup = (counter: string) => scenario([], { defs, p1: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 3 } }, 'Test Maker', 'Test Ring'] }, p2: { hand: [counter] } });
  const activate = (s: GameState, name: string, isLoyalty: boolean): GameState => {
    const a = legal(s, 'p1', 'activate').filter((x) => x.object === find(s, name, 'battlefield', 'p1') && (x.isMana !== true));
    expect(a.length, name).toBeGreaterThan(0);
    return act(s, a[0]!.action);
  };
  it('has no manual part', () => { for (const d of [VERDANT, WAVE]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true); });
  it('Verdant Command counters a loyalty ability of a planeswalker: its effect never happens (the loyalty cost was paid)', () => {
    let s = activate(setup('Test Walker Check'), 'Test Walker', true);
    const ability = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Walker Check', 'hand', 'p2') }), { targets: [[{ kind: 'object', id: ability }]] });
    s = resolveAll(s);
    expect(life(s)).toBe(20);
    expect(s.objects[find(s, 'Test Walker', 'battlefield', 'p1')]!.counters?.loyalty).toBe(4);
  });
  it('the negative case: an ability that is not a loyalty ability is no legal target of it', () => {
    let s = activate(setup('Test Walker Check'), 'Test Maker', false);
    s = act(s, { type: 'pass', player: 'p1' });
    expect(legal(s, 'p2', 'cast').filter((x) => x.object === find(s, 'Test Walker Check', 'hand', 'p2'))).toHaveLength(0); // no legal target: a creature's ability is no loyalty ability
    expect(life(resolveAll(s))).toBe(22);
  });
  it('Dissonant Wave counters an ability of an artifact (a noncreature source)', () => {
    let s = activate(setup('Test Noncreature Check'), 'Test Ring', false);
    const ability = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Noncreature Check', 'hand', 'p2') }), { targets: [[{ kind: 'object', id: ability }]] });
    s = resolveAll(s);
    expect(life(s)).toBe(20);
  });
  it('the negative case: an ability of a creature can\'t be the target (the spell has no legal target, so it can\'t be cast at it)', () => {
    let s = activate(setup('Test Noncreature Check'), 'Test Maker', false);
    s = act(s, { type: 'pass', player: 'p1' });
    const castable = legal(s, 'p2', 'cast').filter((x) => x.object === find(s, 'Test Noncreature Check', 'hand', 'p2'));
    expect(castable).toHaveLength(0);
  });
});

describe('"Look at the top three cards of target player\'s library. Put one back and the rest into that player\'s graveyard." (CR 701.20a, 401.4, 404.1, 608.2c; Dimir Charm)', () => {
  const LOOKER = card('Test Peek Charm', 'Instant', 'Look at the top three cards of target player\'s library. Put one back and the rest into that player\'s graveyard.', '{0}');
  const A = card('Test Card A', 'Sorcery', '', '{0}');
  const B = card('Test Card B', 'Sorcery', '', '{0}');
  const C = card('Test Card C', 'Sorcery', '', '{0}');
  const D = card('Test Card D', 'Sorcery', '', '{0}');
  const defs = [LOOKER, A, B, C, D];
  const start = () => { const s = scenario([], { defs, p1: { hand: ['Test Peek Charm'] }, p2: {} }); setLibrary(s, 'p2', ['Test Card A', 'Test Card B', 'Test Card C', 'Test Card D']); return s; };
  it('has no manual part', () => expect(full(LOOKER)).toBe(true));
  it('you choose which of the top three stays on top of the library; the other two go to its owner\'s graveyard; the fourth card is never touched', () => {
    let s = cast(start(), 'Test Peek Charm', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = passBoth(s);
    const p = s.pending as unknown as { kind: string; options: string[] };
    expect(p.kind).toBe('chooseObjects');
    expect(names(s, p.options).sort()).toEqual(['Test Card A', 'Test Card B', 'Test Card C']);
    const keep = p.options.find((id) => nameOf(s, id) === 'Test Card B')!;
    s = resolveAll(drive(s, { objects: [[keep]] }));
    expect(zoneNames(s, 'library', 'p2')).toEqual(['Test Card B', 'Test Card D']);
    expect(zoneNames(s, 'graveyard', 'p2').sort()).toEqual(['Test Card A', 'Test Card C']);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Peek Charm']);
  });
  it('the negative case: with fewer cards than three in the library, the ones there are looked at and the rest go to the graveyard', () => {
    const s0 = start();
    setLibrary(s0, 'p2', ['Test Card A', 'Test Card B']);
    let s = cast(s0, 'Test Peek Charm', { targets: [[{ kind: 'player', id: 'p2' }]] });
    s = passBoth(s);
    const p = s.pending as unknown as { options: string[] };
    s = resolveAll(drive(s, { objects: [[p.options[0]!]] }));
    expect(zoneNames(s, 'library', 'p2')).toHaveLength(1);
    expect(zoneNames(s, 'graveyard', 'p2')).toHaveLength(1);
  });
});
