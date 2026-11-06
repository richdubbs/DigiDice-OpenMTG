/**
 * Commander EDHREC ranks 19,501-20,000 (later pass), round edh-c-89: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 502.3, 604.1, 602.1, 605.1a   "Each land with an activated ability that isn't a mana ability doesn't untap during its controller's untap step." (the filter `abilityNotMana` in a static ability)
 *   CR 602.2, 602.5b, 400.7          "If this ability has been activated four or more times this turn, sacrifice ~ at the beginning of the next end step." (`activatedThisTurn`)
 *   CR 118.12a, 701.6a, 404.1        "Counter target spell unless its controller exiles all cards from their graveyard."
 *   CR 608.2, 113.7a, 107.3          "... gets +X/+0, where X is the number of times this ability has resolved this turn." (the quantity of FAST5X E17 read in a "where X" clause)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, legal, pass, scenario } from '../../m3/scenario';
import { card, full, named, resolveAll, settle, type Picks } from '../cmd3/helpers';

void compileCard; void ({} as OracleCard);
const clone = (s: GameState): GameState => structuredClone(s);
const target = (id: ObjectId): TargetChoice[] => [{ kind: 'object', id }];
const tapped = (s: GameState, id: ObjectId): boolean => s.objects[id]!.tapped;
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const inYard = (s: GameState, defId: string, player: string): boolean => (s.zones.graveyard[player] ?? []).some((id) => s.objects[id]!.defId === defId);
function until(s0: GameState, done: (s: GameState) => boolean, what: string, max = 300): GameState {
  let s = s0;
  for (let i = 0; i < max; i++) {
    if (done(s)) return s;
    if (s.result) throw new Error(`the game ended while waiting for ${what}`);
    if (s.pending?.kind === 'priority') s = pass(s);
    else if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else s = settle(s);
  }
  throw new Error(`never reached ${what}`);
}
const activate = (s: GameState, id: ObjectId, p: Picks = {}): GameState => settle(act(s, legal(s, 'p1', 'activate').find((a) => a.object === id && !a.isMana)!.action), p);

describe('CR 502.3, 602.1, 605.1a: "Each land with an activated ability that isn\'t a mana ability doesn\'t untap during its controller\'s untap step."', () => {
  const WEB = card('Test Tangle Snare', 'Artifact', "Each land with an activated ability that isn't a mana ability doesn't untap during its controller's untap step.");
  const FOUNT = card('Test Fount Land', 'Land', '{T}: Add {G}.\n{2}, {T}: You gain 1 life.');
  const SPRING = card('Test Spring Land', 'Land', '{T}: Add {U}.');
  const BARREN = card('Test Barren Land', 'Land', '');
  const DEFS = [WEB, FOUNT, SPRING, BARREN];
  const board = (): GameState => scenario(['Mountain'], {
    defs: DEFS,
    p1: { battlefield: ['Test Tangle Snare', { name: 'Test Fount Land', tapped: true }, { name: 'Test Spring Land', tapped: true }, { name: 'Test Barren Land', tapped: true }, { name: 'Mountain', tapped: true }] },
    p2: { battlefield: [{ name: 'Test Fount Land', tapped: true }, { name: 'Test Spring Land', tapped: true }] },
  });
  it('is full', () => { for (const d of DEFS) expect(full(d), d.name).toBe(true); });
  it('a land with a non-mana activated ability stays tapped through its controller\'s untap step; lands with only mana abilities (or none) untap', () => {
    const s0 = board();
    const s = until(s0, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'turn 3');
    expect(tapped(s, find(s, 'Test Fount Land', 'battlefield', 'p1'))).toBe(true);
    expect(tapped(s, find(s, 'Test Spring Land', 'battlefield', 'p1'))).toBe(false);
    expect(tapped(s, find(s, 'Test Barren Land', 'battlefield', 'p1'))).toBe(false);
    expect(tapped(s, find(s, 'Mountain', 'battlefield', 'p1'))).toBe(false); // a basic land type's {T}: Add is a mana ability (CR 305.6, 605.1a)
  });
  it('"each" land: an opponent\'s such land does not untap in their untap step either; their mana-only land does', () => {
    const s = until(board(), (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'turn 2');
    expect(tapped(s, find(s, 'Test Fount Land', 'battlefield', 'p2'))).toBe(true);
    expect(tapped(s, find(s, 'Test Spring Land', 'battlefield', 'p2'))).toBe(false);
  });
  it('negative: without the artifact the same land untaps', () => {
    const s0 = scenario(['Mountain'], { defs: DEFS, p1: { battlefield: [{ name: 'Test Fount Land', tapped: true }] } });
    const s = until(s0, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'turn 3');
    expect(tapped(s, find(s, 'Test Fount Land', 'battlefield', 'p1'))).toBe(false);
  });
});

describe('CR 602.5b, 602.2, 603.7: "If this ability has been activated four or more times this turn, sacrifice ~ at the beginning of the next end step."', () => {
  const WHELP = card('Test Ember Drake', 'Creature — Dragon', '{0}: ~ gets +1/+0 until end of turn. If this ability has been activated four or more times this turn, sacrifice ~ at the beginning of the next end step.'.replace('~', 'This creature').replace('~', 'this creature'), ['2', '2']);
  it('is full', () => expect(full(WHELP)).toBe(true));
  it('three activations: nothing happens beyond +3/+0; the creature survives the end step', () => {
    let s = scenario([], { defs: [WHELP], p1: { battlefield: ['Test Ember Drake'] } });
    const id = find(s, 'Test Ember Drake', 'battlefield');
    for (let i = 0; i < 3; i++) s = resolveAll(activate(s, id));
    expect(pt(s, id)).toBe('5/2');
    s = until(s, (x) => x.turn.number === 2, 'turn 2');
    expect(named(s, 'Test Ember Drake')).toHaveLength(1);
  });
  it('the fourth activation (and not before) sacrifices it at the beginning of the next end step', () => {
    let s = scenario([], { defs: [WHELP], p1: { battlefield: ['Test Ember Drake'] } });
    const id = find(s, 'Test Ember Drake', 'battlefield');
    for (let i = 0; i < 4; i++) s = resolveAll(activate(s, id));
    expect(pt(s, id)).toBe('6/2');
    expect(named(s, 'Test Ember Drake')).toHaveLength(1); // not sacrificed yet
    s = until(s, (x) => x.turn.step === 'end', 'the end step');
    s = resolveAll(s);
    expect(named(s, 'Test Ember Drake')).toHaveLength(0);
    expect(inYard(s, 'Test Ember Drake', 'p1')).toBe(true);
  });
  it('a countered activation still counts (it was activated, CR 602.2, 602.5b): three resolved plus one that never resolves is four', () => {
    let s = scenario([], { defs: [WHELP], p1: { battlefield: ['Test Ember Drake'] } });
    const id = find(s, 'Test Ember Drake', 'battlefield');
    for (let i = 0; i < 3; i++) s = resolveAll(activate(s, id));
    s = activate(s, id); // the fourth stays on the stack; the fifth resolves first
    s = resolveAll(activate(s, id));
    expect(pt(s, id)).toBe('7/2');
    s = until(s, (x) => x.turn.step === 'end', 'the end step');
    expect(named(resolveAll(s), 'Test Ember Drake')).toHaveLength(0);
  });
  it('negative: another copy of the creature has its own count (a new object, an ability of another source, CR 113.7a)', () => {
    let s = scenario([], { defs: [WHELP], p1: { battlefield: ['Test Ember Drake', 'Test Ember Drake'] } });
    const [a, b] = named(s, 'Test Ember Drake') as [ObjectId, ObjectId];
    for (let i = 0; i < 2; i++) s = resolveAll(activate(s, a));
    for (let i = 0; i < 2; i++) s = resolveAll(activate(s, b));
    s = until(s, (x) => x.turn.number === 2, 'turn 2');
    expect(named(s, 'Test Ember Drake')).toHaveLength(2);
  });
  it('negative: the count starts again every turn', () => {
    let s = scenario([], { defs: [WHELP], p1: { battlefield: ['Test Ember Drake'] } });
    const id = find(s, 'Test Ember Drake', 'battlefield');
    for (let i = 0; i < 3; i++) s = resolveAll(activate(s, id));
    s = until(s, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'turn 3');
    s = clone(s);
    for (let i = 0; i < 3; i++) s = resolveAll(activate(s, id));
    s = until(s, (x) => x.turn.number === 4, 'turn 4');
    expect(named(s, 'Test Ember Drake')).toHaveLength(1);
  });
  });

describe('CR 118.12a, 701.6a, 404.1: "Counter target spell unless its controller exiles all cards from their graveyard."', () => {
  const GRIP = card('Test Amnesia Grip', 'Instant', 'Counter target spell unless its controller exiles all cards from their graveyard. Draw a card.');
  const GAIN = card('Test Small Gain', 'Instant', 'You gain 3 life.');
  const setup = (): GameState => scenario(['Plains'], {
    defs: [GRIP, GAIN],
    p1: { hand: ['Test Small Gain'], graveyard: ['Plains', 'Plains'] },
    p2: { hand: ['Test Amnesia Grip'] },
  } as never);
  /** p1 casts the gain spell, p2 answers with the Grip targeting it; p1 then decides about the graveyard. */
  const play = (yes: boolean): GameState => {
    let s = act(setup(), { type: 'cast', player: 'p1', card: find(setup(), 'Test Small Gain', 'hand', 'p1') });
    s = settle(s);
    s = pass(s);
    const spell = s.zones.stack[s.zones.stack.length - 1]!;
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Amnesia Grip', 'hand', 'p2') }), { targets: [{ kind: 'object', id: spell }] });
    return resolveAll(s, { yes });
  };
  it('is full', () => expect(full(GRIP)).toBe(true));
  it('the controller exiles all cards from their graveyard: the spell is not countered (and the Grip still draws)', () => {
    const s = play(true);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(23);
    expect(s.zones.graveyard['p1']!.length).toBe(1); // only the resolved spell itself went to the graveyard afterwards
    expect(s.zones.exile.length).toBeGreaterThanOrEqual(2);
  });
  it('CR 608.2d, 404.1 (Scryfall ruling 2004-10-04): an empty graveyard can still be exiled, so the spell is not countered', () => {
    const empty = scenario(['Plains'], { defs: [GRIP, GAIN], p1: { hand: ['Test Small Gain'] }, p2: { hand: ['Test Amnesia Grip'] } } as never);
    let s = settle(act(empty, { type: 'cast', player: 'p1', card: find(empty, 'Test Small Gain', 'hand', 'p1') }));
    s = pass(s);
    const spell = s.zones.stack[s.zones.stack.length - 1]!;
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Amnesia Grip', 'hand', 'p2') }), { targets: [{ kind: 'object', id: spell }] }), { yes: true });
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(23);
  });
  it('negative: the controller declines: the spell is countered, their graveyard stays', () => {
    const s = play(false);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(20);
    expect(s.zones.graveyard['p1']!.length).toBe(3);
    expect(s.zones.exile.length).toBe(0);
  });
});

describe('CR 608.2, 113.7a, 107.3: "gets +X/+0, where X is the number of times this ability has resolved this turn"', () => {
  const GADGET = card('Test Rising Rod', 'Artifact', '{0}: Until end of turn, target creature gets +X/+0, where X is the number of times this ability has resolved this turn.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  it('is full', () => expect(full(GADGET)).toBe(true));
  it('+1/+0 the first time, +2/+0 the second (3 in all), +3/+0 the third (Scryfall ruling 2022-02-18)', () => {
    let s = scenario([], { defs: [GADGET, BEAR], p1: { battlefield: ['Test Rising Rod', 'Test Bear'] } });
    const rod = find(s, 'Test Rising Rod', 'battlefield');
    const bear = find(s, 'Test Bear', 'battlefield');
    s = resolveAll(activate(s, rod, { targets: target(bear) }));
    expect(pt(s, bear)).toBe('3/2');
    s = resolveAll(activate(s, rod, { targets: target(bear) }));
    expect(pt(s, bear)).toBe('5/2');
    s = resolveAll(activate(s, rod, { targets: target(bear) }));
    expect(pt(s, bear)).toBe('8/2');
  });
  it('negative: another object with the same ability counts apart, and a new turn starts again', () => {
    let s = scenario([], { defs: [GADGET, BEAR], p1: { battlefield: ['Test Rising Rod', 'Test Rising Rod', 'Test Bear'] } });
    const [r1, r2] = named(s, 'Test Rising Rod') as [ObjectId, ObjectId];
    const bear = find(s, 'Test Bear', 'battlefield');
    s = resolveAll(activate(s, r1, { targets: target(bear) }));
    s = resolveAll(activate(s, r2, { targets: target(bear) }));
    expect(pt(s, bear)).toBe('4/2'); // +1 and +1
    s = until(s, (x) => x.turn.number === 3 && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'turn 3');
    s = resolveAll(activate(s, r1, { targets: target(bear) }));
    expect(pt(s, bear)).toBe('3/2');
  });
});
