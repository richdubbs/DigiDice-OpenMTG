/**
 * p2-counters-state-1 (lane p2-counters-state): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in
 * the cloud checkout).
 *
 *   CR 701.13a, 122.1, 608.2m     "Exile ~ with two time counters on it.": the resolving spell is a card in exile with the counters, not in the graveyard
 *   CR 613.4c, 122.1              "~ gets +1/+1 for each gloom counter on it.": the counters of that kind on the object itself, counted continuously
 *   CR 702.33b, 702.33f, 614.1c   "If ~ was kicked with its {G} kicker, it enters with ...": only that kicker cost counts, the other one does not
 *   CR 603.4, 122.1               "if ~ has fewer than two +1/+1 counters on it": checked as the ability triggers and resolves
 *   CR 122.1                      "If there are no gloom counters on ~, sacrifice it.": none of that kind left
 */
import { describe, expect, it } from 'vitest';
import { getChars, ptNumbers, type CardDef, type GameState, type ObjectId } from '../../../src/index';
import { act } from '../../m5/helpers';
import { castWith, drive, find, no, resolveAll, scenario, synthetic, yes } from '../../m6/costs/support';

const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const lands = (name: string, n: number): string[] => Array(n).fill(name) as string[];
const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]!.counters?.[kind] ?? 0;
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const names = (s: GameState, ids: readonly ObjectId[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name);
const pt = (s: GameState, id: ObjectId): [number | null, number | null] => { const n = ptNumbers(getChars(s, id)); return [n.power, n.toughness]; };

const ECHO = synthetic('Test Echoing Draught', 'Sorcery', '{1}{G}', 'You gain 2 life. Exile ~ with two time counters on it.\nSuspend 2—{G}');
const PLAIN = synthetic('Test Plain Draught', 'Sorcery', '{1}{G}', 'You gain 2 life.');
const GLOOM = synthetic('Test Gloom Golem', 'Artifact Creature — Golem', '{3}', '~ enters with two gloom counters on it.\n~ gets +1/+1 for each gloom counter on it.', { power: '1', toughness: '1' });
const VOLVER = synthetic('Test Twinkick Beast', 'Creature — Beast', '{2}{G}', 'Kicker {1}{R} and/or {G}\nIf ~ was kicked with its {1}{R} kicker, it enters with two +1/+1 counters on it and with first strike.\nIf ~ was kicked with its {G} kicker, it enters with a +1/+1 counter on it and with trample.', { power: '2', toughness: '2' });
const KIN = synthetic('Test Ember Kin', 'Creature — Elemental', '{1}{R}', 'Whenever you cast a red spell, if ~ has fewer than two +1/+1 counters on it, put a +1/+1 counter on ~.', { power: '1', toughness: '1' });
const BOLT = synthetic('Test Red Spark', 'Instant', '{R}', 'You gain 1 life.', { colors: ['R'] });
const HOURGLASS = synthetic('Test Gloom Hourglass', 'Artifact', '{1}', '~ enters with a gloom counter on it.\n{T}: You gain 1 life. If there are no gloom counters on ~, sacrifice it.');
const DEFS = [ECHO, PLAIN, GLOOM, VOLVER, KIN, BOLT, HOURGLASS];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 701.13a, 122.1, 608.2m: "Exile ~ with two time counters on it."', () => {
  const board = (): GameState => scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Echoing Draught', 'Test Plain Draught'], battlefield: lands('Forest', 4) } });
  it('CR 608.2m: the spell gains its life, then it is a card in exile with two time counters (suspended: it has suspend), not in the graveyard', () => {
    const s0 = board();
    const s = resolveAll(castWith(s0, 'Test Echoing Draught'));
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1') + 2);
    expect(names(s, s.zones.graveyard.p1!)).not.toContain('Test Echoing Draught');
    const id = s.zones.exile.find((x) => s.defs[s.objects[x]!.defId]!.name === 'Test Echoing Draught');
    expect(id).toBeDefined();
    expect(counters(s, id!, 'time')).toBe(2);
  });
  it('CR 608.2n: a spell without the sentence goes to its owner\'s graveyard as it resolves', () => {
    const s = resolveAll(castWith(board(), 'Test Plain Draught'));
    expect(names(s, s.zones.graveyard.p1!)).toContain('Test Plain Draught');
  });
});

describe('CR 613.4c, 122.1: "~ gets +1/+1 for each gloom counter on it."', () => {
  it('CR 613.4c: two gloom counters make the 1/1 a 3/3; another kind of counter does not count, and a removed gloom counter is counted at once', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Gloom Golem'], battlefield: lands('Forest', 3) } });
    s = resolveAll(castWith(s, 'Test Gloom Golem'));
    const id = find(s, 'Test Gloom Golem', 'battlefield');
    expect(counters(s, id, 'gloom')).toBe(2);
    expect(pt(s, id)).toEqual([3, 3]);
    s.objects[id]!.counters['charge'] = 4;
    expect(pt(s, id)).toEqual([3, 3]);
    s.objects[id]!.counters['gloom'] = 1;
    expect(pt(s, id)).toEqual([2, 2]);
  });
});

describe('CR 702.33b, 702.33f, 614.1c: "If ~ was kicked with its {G} kicker, it enters with ..."', () => {
  const board = (): GameState => scenario(['Forest', 'Mountain'], { defs: DEFS, p1: { hand: ['Test Twinkick Beast'], battlefield: [...lands('Forest', 4), ...lands('Mountain', 2)] } });
  const kw = (s: GameState, id: ObjectId): string[] => getChars(s, id).keywords.map((k) => k.keyword);
  it('CR 702.33f: kicked with its second ({G}) kicker only: a +1/+1 counter and trample, not the {1}{R} kicker\'s two counters and first strike', () => {
    const s = resolveAll(castWith(board(), 'Test Twinkick Beast', [no, yes]));
    const id = find(s, 'Test Twinkick Beast', 'battlefield');
    expect(counters(s, id, '+1/+1')).toBe(1);
    expect(kw(s, id)).toContain('trample');
    expect(kw(s, id)).not.toContain('first strike');
  });
  it('CR 702.33f: kicked with its first ({1}{R}) kicker only: two +1/+1 counters and first strike, no trample', () => {
    const s = resolveAll(castWith(board(), 'Test Twinkick Beast', [yes, no]));
    const id = find(s, 'Test Twinkick Beast', 'battlefield');
    expect(counters(s, id, '+1/+1')).toBe(2);
    expect(kw(s, id)).toContain('first strike');
    expect(kw(s, id)).not.toContain('trample');
  });
  it('CR 702.33d: both kickers: three counters, first strike and trample; neither: nothing', () => {
    let s = resolveAll(castWith(board(), 'Test Twinkick Beast', [yes, yes]));
    let id = find(s, 'Test Twinkick Beast', 'battlefield');
    expect(counters(s, id, '+1/+1')).toBe(3);
    expect(kw(s, id)).toEqual(expect.arrayContaining(['first strike', 'trample']));
    s = resolveAll(castWith(board(), 'Test Twinkick Beast', [no, no]));
    id = find(s, 'Test Twinkick Beast', 'battlefield');
    expect(counters(s, id, '+1/+1')).toBe(0);
    expect(kw(s, id)).not.toContain('first strike');
    expect(kw(s, id)).not.toContain('trample');
  });
});

describe('CR 603.4, 122.1: "if ~ has fewer than two +1/+1 counters on it, put a +1/+1 counter on ~"', () => {
  it('CR 603.4: the first two red spells each add a counter; with two counters on it the third does not trigger', () => {
    let s = scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Red Spark', 'Test Red Spark', 'Test Red Spark'], battlefield: ['Test Ember Kin', ...lands('Mountain', 3)] } });
    const id = find(s, 'Test Ember Kin', 'battlefield');
    s = resolveAll(castWith(s, 'Test Red Spark'));
    expect(counters(s, id, '+1/+1')).toBe(1);
    s = resolveAll(castWith(s, 'Test Red Spark'));
    expect(counters(s, id, '+1/+1')).toBe(2);
    s = castWith(s, 'Test Red Spark');
    expect(s.zones.stack.length).toBe(1);
    s = resolveAll(s);
    expect(counters(s, id, '+1/+1')).toBe(2);
  });
});

describe('CR 122.1: "If there are no gloom counters on ~, sacrifice it."', () => {
  it('CR 122.1: with a gloom counter on it, it stays; with none of that kind (another kind does not count), it is sacrificed', () => {
    let s = scenario(['Forest'], { defs: DEFS, p1: { battlefield: ['Test Gloom Hourglass'] } });
    const id = find(s, 'Test Gloom Hourglass', 'battlefield');
    s.objects[id]!.counters['gloom'] = 1;
    const activate = (t: GameState): GameState => resolveAll(drive(act(t, { type: 'activate', player: 'p1', source: id, ability: 'p:0:1' })));
    s = activate(s);
    expect(s.zones.battlefield).toContain(id);
    s.objects[id]!.tapped = false;
    s.objects[id]!.counters = { charge: 3 };
    s = activate(s);
    expect(s.zones.battlefield).not.toContain(id);
    expect(names(s, s.zones.graveyard.p1!)).toContain('Test Gloom Hourglass');
  });
});
