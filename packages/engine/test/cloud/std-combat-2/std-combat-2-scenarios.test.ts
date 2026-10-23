/**
 * std-combat-2 (lane std-combat): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings invented,
 * design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 109.2, 608.2c        "if you control another Lizard" on a Lizard: a Lizard other than the source (lower/anaphora.ts#withoutKindredOther)
 *   CR 608.2c, 122.1b       "If that creature has X and ~ doesn't, put an X counter on ~. Do the same for Y and Z." (lower/same-for.ts)
 *   CR 702.183a, 613.4b     tiered modes that are each a base power and toughness for "the chosen base power and toughness" (lower/ability.ts#chosenBasePtModes)
 *   CR 118.12, 603.12, 700.2 "you may pay {1} up to N times. When you do, choose up to that many --" (pay.upTo; the reflexive count fixed as it triggers)
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, DecisionAnswer, GameState, ObjectId } from '../../../src/index';
import { act, answer, find, life, pass, scenario, zoneNames } from '../../m3/scenario';
import { card, counters, full, pt } from '../cmd3/helpers';
import { attackWith } from '../cmd3/helpers';

const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '3']);
const CUB = card('Test Cub', 'Creature — Bear', '', ['2', '2']);
const LIZARD = card('Test Lizard', 'Creature — Lizard', '', ['1', '1']);
const SKIRMISHER = card('Test Sky Skirmisher', 'Creature — Bird', 'Flying, trample', ['2', '2']);
const RECRUITER = card('Test Scale Recruiter', 'Creature — Lizard Warrior', 'When this creature enters, choose target creature. If that creature\'s power is 2 or less or if you control another Lizard, gain control of that creature until end of turn.', ['2', '2']);
const MIMIC = card('Test Mimic Engine', 'Artifact Creature — Robot', 'Trample\nWhen this creature enters, choose another target creature. If that creature has flying and this creature doesn\'t, put a flying counter on this creature. Do the same for trample and lifelink.', ['2', '2']);
const SURGE = card('Test Shape Surge', 'Instant', 'Tiered (Choose one additional cost.)\nUntil end of turn, target creature you control gains flying and has the chosen base power and toughness.\n• Small — {0} — 1/1.\n• Big — {2} — 6/6.', undefined, '{0}');
const ARCHER = card('Test Trick Archer', 'Creature — Human Archer', 'Whenever this creature becomes tapped, you may pay {1} up to two times. When you do, choose up to that many —\n• Gain — You gain 3 life.\n• Draw — Draw a card.', ['1', '1']);
const DEFS: CardDef[] = [BEAR, CUB, LIZARD, SKIRMISHER, RECRUITER, MIMIC, SURGE, ARCHER];

type Answerer = (s: GameState) => DecisionAnswer | undefined;
/** Answer every decision with `pick` (the payments automatically), passing priority, until the stack is empty and a player has priority. */
function drive(s0: GameState, pick: Answerer = () => undefined): GameState {
  let s = s0;
  for (let guard = 0; guard < 60; guard++) {
    const d = s.pending;
    if (d === undefined || d === null) return s;
    if (d.kind === 'priority') {
      if (s.zones.stack.length === 0) return s;
      s = pass(s);
      continue;
    }
    const a = pick(s) ?? (d.kind === 'payCost' ? { kind: 'payCost', auto: true } : d.kind === 'yesNo' ? { kind: 'yesNo', yes: true } : undefined);
    if (a === undefined) throw new Error(`no answer for ${d.kind}: ${JSON.stringify(d).slice(0, 400)}`);
    s = answer(s, a as DecisionAnswer);
  }
  return s;
}
const target = (id: ObjectId): Answerer => (s) => (s.pending?.kind === 'chooseTargets' ? { kind: 'chooseTargets', targets: [{ kind: 'object', id }] } as DecisionAnswer : undefined);
const castCard = (s: GameState, name: string, pick?: Answerer): GameState => drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), pick);

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 109.2, 608.2c: "if you control another Lizard" on a Lizard is a Lizard other than the source', () => {
  it('CR 109.2: with no other Lizard, an opponent\'s 3/3 stays with its controller', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Scale Recruiter'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = castCard(s, 'Test Scale Recruiter', target(bear));
    expect(s.objects[bear]!.controller).toBe('p2');
  });
  it('CR 109.2, 611.2a: with another Lizard you control, you gain control of the 3/3 until end of turn', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Scale Recruiter'], battlefield: ['Test Lizard'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = castCard(s, 'Test Scale Recruiter', target(bear));
    expect(s.objects[bear]!.controller).toBe('p1');
  });
  it('CR 608.2c: power 2 or less is enough on its own', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Scale Recruiter'] }, p2: { battlefield: ['Test Cub'] }, defs: DEFS });
    const cub = find(s, 'Test Cub', 'battlefield', 'p2');
    s = castCard(s, 'Test Scale Recruiter', target(cub));
    expect(s.objects[cub]!.controller).toBe('p1');
  });
});

describe('CR 608.2c, 122.1b: "If that creature has X and ~ doesn\'t, put an X counter on ~. Do the same for Y and Z."', () => {
  it('CR 122.1b: a flying, trampling target gives a flying counter only (the source already has trample; the target has no lifelink)', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Mimic Engine'] }, p2: { battlefield: ['Test Sky Skirmisher'] }, defs: DEFS });
    s = castCard(s, 'Test Mimic Engine', target(find(s, 'Test Sky Skirmisher', 'battlefield', 'p2')));
    const mimic = find(s, 'Test Mimic Engine', 'battlefield', 'p1');
    expect(counters(s, mimic, 'flying')).toBe(1);
    expect(counters(s, mimic, 'trample')).toBe(0);
    expect(counters(s, mimic, 'lifelink')).toBe(0);
  });
  it('CR 608.2c: a target with none of the keywords gives no counter', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Mimic Engine'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    s = castCard(s, 'Test Mimic Engine', target(find(s, 'Test Bear', 'battlefield', 'p2')));
    expect(Object.values(s.objects[find(s, 'Test Mimic Engine', 'battlefield', 'p1')]!.counters).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('CR 702.183a, 613.4b: tiered modes that are each "the chosen base power and toughness"', () => {
  const chooseMode = (label: string): Answerer => (s) => {
    const d = s.pending as { kind: string; options?: { id: string; label: string }[] } | undefined;
    if (d?.kind === 'chooseOption' && d.options?.some((o) => o.label.includes('base power and toughness'))) return { kind: 'chooseOption', ids: [d.options.find((o) => o.label.includes(label))!.id] } as DecisionAnswer;
    return undefined;
  };
  const both = (a: Answerer, b: Answerer): Answerer => (s) => a(s) ?? b(s);
  it('CR 702.183a, 700.2h: the {2} mode makes the target a 6/6 with flying until end of turn', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Shape Surge'], battlefield: ['Test Cub', 'Plains', 'Plains'] }, defs: DEFS });
    const cub = find(s, 'Test Cub', 'battlefield', 'p1');
    s = castCard(s, 'Test Shape Surge', both(chooseMode('6/6'), target(cub)));
    expect(pt(s, cub)).toBe('6/6');
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Shape Surge');
  });
  it('CR 613.4b: the {0} mode makes it a 1/1', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Shape Surge'], battlefield: ['Test Cub'] }, defs: DEFS });
    const cub = find(s, 'Test Cub', 'battlefield', 'p1');
    s = castCard(s, 'Test Shape Surge', both(chooseMode('1/1'), target(cub)));
    expect(pt(s, cub)).toBe('1/1');
  });
});

describe('CR 118.12, 603.12, 700.2: "you may pay {1} up to two times. When you do, choose up to that many --"', () => {
  const tapArcher = (lands: number, n: number, modes: string[]): GameState => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Trick Archer', ...Array<string>(lands).fill('Plains')] }, defs: DEFS });
    s = attackWith(s, [find(s, 'Test Trick Archer', 'battlefield', 'p1')]);
    return drive(s, (x) => {
      const d = x.pending as { kind: string; max?: number; options?: { id: string; label: string }[] } | undefined;
      if (d?.kind === 'chooseNumber') { expect(d.max).toBe(Math.min(2, lands)); return { kind: 'chooseNumber', n } as DecisionAnswer; }
      if (d?.kind === 'chooseOption') return { kind: 'chooseOption', ids: d.options!.filter((o) => modes.some((m) => o.label.includes(m))).map((o) => o.id) } as DecisionAnswer;
      return undefined;
    });
  };
  it('CR 118.12, 700.2: paid twice, both modes may be chosen', () => {
    const before = scenario(['Plains'], { p1: { battlefield: ['Test Trick Archer'] }, defs: DEFS });
    const s = tapArcher(2, 2, ['You gain 3 life', 'Draw a card']);
    expect(life(s, 'p1')).toBe(life(before, 'p1') + 3);
    expect(s.zones.hand['p1']!.length).toBe(1);
  });
  it('CR 700.2: paid once, the trigger refuses two modes and takes one', () => {
    expect(() => tapArcher(2, 1, ['You gain 3 life', 'Draw a card'])).toThrow(/between 0 and 1/);
    const s = tapArcher(2, 1, ['Draw a card']);
    expect(s.zones.hand['p1']!.length).toBe(1);
    expect(life(s, 'p1')).toBe(20);
  });
  it('CR 118.3: with one land, at most one payment is offered', () => {
    const s = tapArcher(1, 1, ['You gain 3 life']);
    expect(life(s, 'p1')).toBe(23);
  });
  it('CR 603.12: paid zero times, there is no reflexive trigger', () => {
    const s = tapArcher(2, 0, []);
    expect(life(s, 'p1')).toBe(20);
    expect(s.zones.hand['p1']!.length).toBe(0);
  });
});
