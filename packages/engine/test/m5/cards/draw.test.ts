/**
 * WP13: draw, discard, mill (CR 121, 701.9, 701.17). The neighbors that are still stubs (WP10 spine, WP11 pipeline) are faked: ./fakes.ts, ./harness.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { viewFor, HIDDEN_DEF, type DecisionAnswer, type GameState } from '../../../src/index';
import { scenario } from '../helpers';
import { performed, replacements } from './fakes';
import { hand, lib, names, onStack, prog, runAll, runOn, sorcery, yard } from './harness';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fakes')).proposeModule() }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fakes')).manualModule() }));

afterEach(() => {
  replacements.length = 0;
  performed.length = 0;
});

const SPELL = 'Test Card Spell';
const spell = sorcery(SPELL, prog([]));
const board = (opts: Parameters<typeof scenario>[1] = {}): GameState => scenario(['Island', 'Forest', 'Mountain', 'Swamp', 'Grizzly Bears', 'Lightning Bolt', 'Llanowar Elves'], { ...opts, defs: [spell, ...(opts.defs ?? [])] });
const you = { ref: 'you' } as const;
const opponentTarget = [{ id: 't0', kind: 'player' as const, min: 1, max: 1, text: 'target player' }];

describe('draw (CR 121)', () => {
  const s0 = board({ p1: { library: ['Island', 'Forest', 'Mountain'] } });

  it('CR 121.1: "draw a card" puts the top card of the library into the hand', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'draw', who: you, count: 1 }]));
    expect(out.pending).toBeNull();
    expect(names(out.s, hand(out.s, 'p1'))).toEqual(['Island']);
    expect(names(out.s, lib(out.s, 'p1')).slice(0, 2)).toEqual(['Forest', 'Mountain']);
    expect(out.results.get('#0')).toEqual({ performed: true, count: 1 });
  });

  it('CR 121.2: "draw two cards" is two draws, each proposed on its own (a replacement can apply to each, CR 614.11)', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'draw', who: you, count: 2 }]));
    expect(performed.filter((e) => e.ev === 'draw')).toHaveLength(2);
    expect(out.events.filter((e) => e.type === 'drew').map((e) => (e.type === 'drew' ? e.player : ''))).toEqual(['p1', 'p1']);
    expect(names(out.s, hand(out.s, 'p1'))).toEqual(['Island', 'Forest']);
  });

  it('CR 121.1, 701.20: the log names the cards only to the player who drew them; the opponent\'s view hides them', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'draw', who: you, count: 2 }]));
    const line = out.s.log.find((l) => l.rules?.includes('CR 121.2'))!;
    expect(line.text).toBe('Alice draws 2 cards.');
    expect(line.privateText).toEqual({ players: ['p1'], text: 'Alice draws Island, Forest.' });
    const theirs = viewFor(out.s, 'p2'); // m4 (audit 2026-10-12): another player's hand under the view's aliases
    expect(theirs.zones.hand['p1']!.every((id) => theirs.objects[id]!.defId === HIDDEN_DEF)).toBe(true);
    expect(viewFor(out.s, 'p1').objects[hand(out.s, 'p1')[0]!]!.defId).toBe('Island');
  });

  it('CR 608.2e, 101.4: "each player draws a card" draws for every player in APNAP order', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'draw', who: { ref: 'each', who: 'player' }, count: 1 }]));
    expect(out.events.filter((e) => e.type === 'drew').map((e) => (e.type === 'drew' ? e.player : ''))).toEqual(['p1', 'p2']);
    expect(out.results.get('#0')!.count).toBe(2);
  });

  it('CR 121.2c, 101.4: "two target players each draw a card" (Huddle Up): the active player draws first, whatever order the targets were announced in', () => {
    const both = board({ p1: { library: ['Island'] }, p2: { library: ['Forest'] } });
    const { s, id } = onStack(both, { name: SPELL, targets: [[{ kind: 'player', id: 'p2' }, { kind: 'player', id: 'p1' }]] });
    const twoPlayers = [{ id: 't0', kind: 'player' as const, min: 2, max: 2, text: 'two target players' }];
    const out = runOn(s, id, prog([{ op: 'draw', who: { ref: 'target', id: 't0' }, count: 1 }], twoPlayers));
    expect(out.events.filter((e) => e.type === 'drew').map((e) => (e.type === 'drew' ? e.player : ''))).toEqual(['p1', 'p2']);
  });

  it('CR 121.4, 704.5b: drawing from an empty library draws nothing and is remembered for the state-based action', () => {
    const empty = board();
    empty.zones.library.p1 = [];
    const { s, id } = onStack(empty, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'draw', who: you, count: 1 }]));
    expect(out.results.get('#0')).toEqual({ performed: false, count: 0 });
    expect(out.s.players[0]!.drewFromEmptyLibrary).toBe(true);
  });

  it('CR 614.11, 614.17: a draw that a replacement or "can\'t" effect stops is not a draw (nothing counted, nothing bound)', () => {
    replacements.push({ apply: (_g, e) => (e.ev === 'draw' ? null : undefined) });
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'draw', who: you, count: 2, as: 'drawn' }]));
    expect(out.results.get('drawn')).toEqual({ performed: false, count: 0 });
    expect(hand(out.s, 'p1')).toEqual([]);
    expect(out.cx!.bindings.get('drawn')!.objects).toEqual([]);
  });

  it('CR 608.2b: a target player who is no longer a legal target draws nothing; CR 107.3: X is the announced value', () => {
    const lost = board({ p2: { library: ['Island', 'Forest'] } });
    lost.players[1]!.hasLost = true;
    const a = onStack(lost, { name: SPELL, targets: [[{ kind: 'player', id: 'p2' }]] });
    expect(runOn(a.s, a.id, prog([{ op: 'draw', who: { ref: 'target', id: 't0' }, count: 1 }], opponentTarget)).results.get('#0')!.count).toBe(0);
    const b = onStack(s0, { name: SPELL, x: 3 });
    expect(hand(runOn(b.s, b.id, prog([{ op: 'draw', who: you, count: { q: 'X' } }])).s, 'p1')).toHaveLength(3);
  });

  it('CR 107.1b: a negative or undetermined amount draws nothing', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'draw', who: you, count: { q: 'math', op: '-', args: [1, 3] } }]));
    expect(out.results.get('#0')!.count).toBe(0);
  });
});

describe('discard (CR 701.9)', () => {
  const s0 = board({ p1: { hand: ['Lightning Bolt', 'Grizzly Bears', 'Forest'] }, p2: { hand: ['Island', 'Llanowar Elves'] } });
  const byName = (s: GameState, name: string, p = 'p1'): string => hand(s, p).find((id) => s.objects[id]!.defId === name)!;

  it('CR 701.9b: the discarding player chooses; the card goes from the hand to its owner\'s graveyard (701.9a) as a discard', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const program = prog([{ op: 'discard', who: you, count: 1, as: 'gone' }]);
    const first = runOn(s, id, program);
    expect(first.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 1, max: 1, rules: ['CR 701.9b'] });
    expect(first.pending!.kind === 'chooseObjects' && first.pending.options).toHaveLength(3);
    const out = runOn(s, id, program, [{ kind: 'chooseObjects', ids: [byName(s, 'Grizzly Bears')] }]);
    expect(names(out.s, yard(out.s, 'p1'))).toEqual(['Grizzly Bears']);
    expect(names(out.s, hand(out.s, 'p1')).sort()).toEqual(['Forest', 'Lightning Bolt']);
    expect(out.events.find((e) => e.type === 'zoneChanged')).toMatchObject({ from: 'hand', to: 'graveyard', cause: 'discard' });
    expect(out.cx!.bindings.get('gone')!.objects).toEqual([{ id: yard(out.s, 'p1')[0], zone: 'graveyard' }]);
    // Cloud C7 (CR 608.2c, 608.2h): a named discard also reports the cards it discarded, as each was in the hand ("for each creature card discarded this way")
    expect(out.results.get('gone')).toMatchObject({ performed: true, count: 1 });
    expect(out.results.get('gone')!.before?.map((b) => b.object.id)).toEqual([byName(s, 'Grizzly Bears')]);
  });

  it('CR 701.9b, 609.3: "discards their hand" discards every card without a choice; a count larger than the hand discards it all', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    expect(yard(runOn(s, id, prog([{ op: 'discard', who: you, count: 'hand' }])).s, 'p1')).toHaveLength(3);
    const out = runOn(s, id, prog([{ op: 'discard', who: you, count: 5 }]));
    expect(out.pending).toBeNull();
    expect(yard(out.s, 'p1')).toHaveLength(3);
  });

  it('CR 701.9b: a filter limits what can be discarded ("discard a creature card"): only those are offered', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'discard', who: you, count: 1, filter: { types: ['Creature'] } }]));
    expect(out.pending).toBeNull(); // the only creature card is discarded without a question
    expect(names(out.s, yard(out.s, 'p1'))).toEqual(['Grizzly Bears']);
  });

  it('CR 701.9b, 8.8 rule 2: "at random" uses the game\'s random number generator: no decision, same result on every re-execution', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const program = prog([{ op: 'discard', who: you, count: 1, mode: 'random' }]);
    const a = runOn(s, id, program);
    const b = runOn(s, id, program);
    expect(a.pending).toBeNull();
    expect(names(a.s, yard(a.s, 'p1'))).toEqual(names(b.s, yard(b.s, 'p1')));
    expect(a.s.rng).not.toEqual(s.rng);
  });

  it('CR 701.9b: "a card of your choice": the controller chooses from the opponent\'s hand, which is shown to them only', () => {
    const { s, id } = onStack(s0, { name: SPELL, targets: [[{ kind: 'player', id: 'p2' }]] });
    const program = prog([{ op: 'discard', who: { ref: 'target', id: 't0' }, count: 1, mode: 'opponentChooses' }], opponentTarget);
    const first = runOn(s, id, program);
    expect(first.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1' });
    expect(viewFor(first.s, 'p1').objects[byName(s, 'Llanowar Elves', 'p2')]!.defId).toBe('Llanowar Elves');
    const out = runOn(s, id, program, [{ kind: 'chooseObjects', ids: [byName(s, 'Llanowar Elves', 'p2')] }]);
    expect(names(out.s, yard(out.s, 'p2'))).toEqual(['Llanowar Elves']);
  });

  it('CR 608.2e: "each player discards a card": every player chooses (APNAP) before any card moves', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const program = prog([{ op: 'discard', who: { ref: 'each', who: 'player' }, count: 1 }]);
    const second = runOn(s, id, program, [{ kind: 'chooseObjects', ids: [byName(s, 'Forest')] }]);
    expect(second.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2' });
    expect(yard(second.s, 'p1')).toEqual([]); // nothing was discarded yet
    const out = runOn(s, id, program, [{ kind: 'chooseObjects', ids: [byName(s, 'Forest')] }, { kind: 'chooseObjects', ids: [byName(s, 'Island', 'p2')] }]);
    expect(names(out.s, yard(out.s, 'p1'))).toEqual(['Forest']);
    expect(names(out.s, yard(out.s, 'p2'))).toEqual(['Island']);
  });

  it('CR 614.1, 400.7j: a discard a replacement sends to exile is still bound ("the discarded card") in the zone it went to', () => {
    replacements.push({ apply: (_g, e) => (e.ev === 'zoneChange' && e.destination.cause === 'discard' ? { ...e, to: 'exile' } : undefined) });
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'discard', who: you, count: 1, filter: { types: ['Instant'] }, as: 'gone' }]));
    expect(out.cx!.bindings.get('gone')!.objects[0]!.zone).toBe('exile');
  });
});

describe('mill (CR 701.17)', () => {
  const s0 = board({ p1: { library: ['Island', 'Forest', 'Mountain'] }, p2: { library: ['Swamp'] } });

  it('CR 701.17a, 701.17c: the top N cards go to the graveyard (in order) and can be found there', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'mill', who: you, count: 2, as: 'milled' }]));
    expect(names(out.s, yard(out.s, 'p1'))).toEqual(['Island', 'Forest']);
    expect(out.cx!.bindings.get('milled')!.objects.map((h) => h.zone)).toEqual(['graveyard', 'graveyard']);
    expect(out.events.filter((e) => e.type === 'zoneChanged').every((e) => e.type === 'zoneChanged' && e.cause === 'mill')).toBe(true);
    expect(out.s.log.some((l) => l.text === 'Alice mills Island, Forest.' && l.rules?.includes('CR 701.17a'))).toBe(true);
  });

  it('CR 701.17b: a player mills as many as possible', () => {
    const short = board({ p1: { library: ['Island'] } });
    short.zones.library.p1 = short.zones.library.p1!.slice(0, 1);
    const { s, id } = onStack(short, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'mill', who: you, count: 5 }]));
    expect(out.results.get('#0')).toEqual({ performed: true, count: 1 });
    expect(lib(out.s, 'p1')).toEqual([]);
  });

  it('CR 101.4, 701.17a: each player mills (APNAP); the count is the total', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runAll(s, id, prog([{ op: 'mill', who: { ref: 'each', who: 'player' }, count: 1 }]), (): DecisionAnswer => { throw new Error('no decision expected'); });
    expect(names(out.s, yard(out.s, 'p1'))).toEqual(['Island']);
    expect(names(out.s, yard(out.s, 'p2'))).toEqual(['Swamp']);
    expect(out.results.get('#0')!.count).toBe(2);
  });
});
