/**
 * std-copy-4 (lane std-copy): the round's engine readings played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 603.4, 601.2i, 603.2   "Whenever you cast a spell, if it's the first instant spell, the first sorcery spell, or the first Otter spell other than ~ you've
 *                             cast this turn, ...": one cast pattern per kind (`nth` 1, `nthMatching`); a spell of two kinds triggers it once; the second of a kind
 *                             does not; the object itself, cast before, is not counted among the Otter spells (CR 201.5)
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, GameState } from '../../../src/index';
import { scenario } from '../../m3/scenario';
import { cast, resolveAll, resolveTop, target } from '../../m5/cr-examples/helpers';
import { card, full } from '../cmd3/helpers';

const STORM = card('Test Storm Otter', 'Legendary Creature — Otter Wizard', "Whenever you cast a spell, if it's the first instant spell, the first sorcery spell, or the first Otter spell other than Test Storm Otter you've cast this turn, you may have target opponent draw a card. If you do, copy that spell. You may choose new targets for the copy.", ['3', '4'], '{1}');
const GAIN = card('Test Gain', 'Instant', 'You gain 2 life.', undefined, '{0}');
const GAIN2 = card('Test Gain Again', 'Instant', 'You gain 3 life.', undefined, '{0}');
const STUDY = card('Test Study', 'Sorcery', 'You gain 1 life.', undefined, '{0}');
const PUP = card('Test Otter Pup', 'Creature — Otter', '', ['1', '1'], '{0}');
const PUP2 = card('Test Otter Kit', 'Creature — Otter', '', ['1', '1'], '{0}');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{0}');
const TRICK = card('Test Otter Trick', 'Kindred Instant — Otter', 'You gain 4 life.', undefined, '{0}');
const DEFS: CardDef[] = [STORM, GAIN, GAIN2, STUDY, PUP, PUP2, BEAR, TRICK];

const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const hand = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const start = (inHand: string[], battlefield = ['Test Storm Otter']): GameState => scenario(['Mountain'], { p1: { hand: inHand, battlefield }, defs: DEFS });
/** Cast `name`; when the trigger is there, say yes, target p2, and let everything resolve. */
const castYes = (s: GameState, name: string): GameState => resolveAll(cast(s, name), [target('p2'), { kind: 'yesNo', yes: true }]);

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 603.4, 601.2i: "if it\'s the first instant spell, the first sorcery spell, or the first Otter spell other than ~ you\'ve cast this turn"', () => {
  it('CR 601.2i: the first instant spell triggers it: the opponent draws, the spell is copied (2 + 2 life)', () => {
    let s = start(['Test Gain']);
    const [l0, h0] = [life(s, 'p1'), hand(s, 'p2')];
    s = cast(s, 'Test Gain', [target('p2')]);
    expect(s.zones.stack.length).toBe(2);
    s = resolveAll(s, [{ kind: 'yesNo', yes: true }]);
    expect(life(s, 'p1')).toBe(l0 + 4);
    expect(hand(s, 'p2')).toBe(h0 + 1);
  });
  it('CR 608.2d: declined, the opponent draws nothing and there is no copy', () => {
    let s = start(['Test Gain']);
    const [l0, h0] = [life(s, 'p1'), hand(s, 'p2')];
    s = resolveAll(cast(s, 'Test Gain', [target('p2')]), [{ kind: 'yesNo', yes: false }]);
    expect(life(s, 'p1')).toBe(l0 + 2);
    expect(hand(s, 'p2')).toBe(h0);
  });
  it('CR 603.4: the second instant spell of the turn does not trigger it', () => {
    let s = start(['Test Gain', 'Test Gain Again']);
    s = resolveAll(cast(s, 'Test Gain', [target('p2')]), [{ kind: 'yesNo', yes: false }]);
    s = cast(s, 'Test Gain Again');
    expect(s.zones.stack.length).toBe(1);
  });
  it('CR 601.2i: the first sorcery after an instant still triggers it (each kind counts on its own)', () => {
    let s = start(['Test Gain', 'Test Study']);
    s = resolveAll(cast(s, 'Test Gain', [target('p2')]), [{ kind: 'yesNo', yes: false }]);
    s = cast(s, 'Test Study', [target('p2')]);
    expect(s.zones.stack.length).toBe(2);
  });
  it('CR 603.2: a spell that is the first of two kinds (an Otter instant) triggers it once', () => {
    let s = start(['Test Otter Trick']);
    s = cast(s, 'Test Otter Trick', [target('p2')]);
    expect(s.zones.stack.length).toBe(2);
  });
  it('CR 603.4: a spell of none of the kinds (a Bear creature spell) does not trigger it', () => {
    let s = start(['Test Bear']);
    s = cast(s, 'Test Bear');
    expect(s.zones.stack.length).toBe(1);
  });
  it('CR 601.2i: the first Otter spell triggers it, the second does not', () => {
    let s = start(['Test Otter Pup', 'Test Otter Kit']);
    s = cast(s, 'Test Otter Pup', [target('p2')]);
    expect(s.zones.stack.length).toBe(2);
    s = resolveAll(s, [{ kind: 'yesNo', yes: false }]);
    s = cast(s, 'Test Otter Kit');
    expect(s.zones.stack.length).toBe(1);
  });
  it('CR 201.5: the object itself, cast earlier this turn, is not counted: the next Otter spell is the first one other than it', () => {
    let s = start(['Test Storm Otter', 'Test Otter Pup'], ['Mountain']);
    s = resolveTop(cast(s, 'Test Storm Otter'));
    s = cast(s, 'Test Otter Pup', [target('p2')]);
    expect(s.zones.stack.length).toBe(2);
  });
});
