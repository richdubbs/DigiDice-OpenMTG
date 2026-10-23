/**
 * FAST5X E26: casting keywords on the game path with real fixture cards.
 *  - impending (CR 702.176a): "Impending N--[cost]" is an alternative cost (CR 118.9, 601.2b, 601.2f-h); a permanent whose impending cost was paid enters with
 *    N time counters (CR 122.1, 614.1c), isn't a creature while it has a time counter (layer 4, CR 613.1d, 205.1b) and loses one at the beginning of its
 *    controller's end step. A copy of it was not cast for its impending cost (CR 707.2), so none of it applies to the copy.
 *  - improvise (CR 702.126a-c): each untapped artifact you control tapped while the spell is cast pays for {1} of its total cost (generic mana only).
 *  - paradigm (CR 702.192a, 707.12, 603.7): the spell exiles itself; the first time a spell you control with its name resolves, a delayed triggered ability
 *    triggers at the beginning of each of your precombat main phases for the rest of the game: create a copy of the card in exile and you may cast it without
 *    paying its mana cost; a copy not cast ceases to exist (CR 707.10a, 704.5e).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ENGINE_CAPABILITIES, getChars, legalActions, type GameState } from '../../../src/index';
import { getCard } from '../../fixtures';
import { act, answer, drive, find, lands, next, onField, resolveTop, scenario } from '../../m6/dfc/support';

const FLOODPITS = 'Overlord of the Floodpits'; // {3}{U}{U} 5/3 flying, Impending 4--{1}{U}{U}
const PRACTICUM = 'Germination Practicum'; // {3}{G}{G} sorcery: two +1/+1 counters on each creature you control; paradigm
const REACTOR = 'Arc Reactor'; // {5} artifact, improvise
const IRONHEART = 'Ironheart, Clever Champion'; // {4}{U}, improvise; "Noncreature spells you cast have improvise."

const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name);
const tappedCount = (s: GameState, name: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.tapped && s.defs[s.objects[id]!.defId]!.name === name).length;
const castLabels = (s: GameState, name: string): string[] =>
  legalActions(s, 'p1').filter((a) => a.kind === 'cast' && s.objects[a.object!] && s.defs[s.objects[a.object!]!.defId]!.name === name).map((a) => a.label);

/** One step forward through the generic prompts (no decision of these tests is made here). */
const step = (s: GameState): GameState => {
  if (s.pending?.kind === 'order') return answer(s, { kind: 'order', ids: s.pending.items.map((x) => x.id) });
  if (s.pending?.kind === 'manualResolve') return answer(s, { kind: 'manualResolve', ops: [] });
  if (s.pending?.kind === 'chooseObjects') return answer(s, { kind: 'chooseObjects', ids: s.pending.options.slice(0, s.pending.min) }); // a discard (not under test)
  return next(s);
};
function until(s: GameState, done: (t: GameState) => boolean, max = 400): GameState {
  let t = s;
  for (let i = 0; i < max && !done(t); i++) t = step(t);
  if (!done(t)) throw new Error('until: not reached');
  return t;
}
const atEndStep = (s: GameState, who: 'p1' | 'p2' = 'p1'): GameState => until(s, (t) => t.turn.activePlayer === who && t.turn.step === 'end' && t.pending?.kind === 'priority');

describe('FAST5X E26: the keywords are capabilities; the cards compile full', () => {
  it('keyword:impending, keyword:improvise, keyword:paradigm and their parts are registered', () => {
    for (const c of ['keyword:impending', 'keyword:improvise', 'keyword:paradigm', 'op:cast.copy', 'cond:firstNamedResolution']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
    for (const name of [FLOODPITS, 'Overlord of the Mistmoors', 'Overlord of the Boilerbilges', PRACTICUM, 'Decorum Dissertation', 'Restoration Seminar', REACTOR, IRONHEART]) {
      expect(compileCard(getCard(name)).automation.level, name).toBe('full');
    }
  });
});

describe('CR 702.176a: impending', () => {
  const board = (): GameState => scenario([FLOODPITS, 'Island'], { p1: { hand: [FLOODPITS], battlefield: lands('Island', 5) }, p2: { battlefield: lands('Island', 2) } });

  it('cast for its impending cost: pays {1}{U}{U}, enters with four time counters, is not a creature (CR 118.9, 122.1, 613.1d)', () => {
    let s = board();
    expect(castLabels(s, FLOODPITS).length).toBeGreaterThanOrEqual(2); // normally and for its impending cost
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, FLOODPITS, 'hand'), method: 'impending' }));
    expect(tappedCount(s, 'Island')).toBe(3);
    s = resolveTop(s);
    const o = onField(s, FLOODPITS);
    expect(s.objects[o]!.counters['time']).toBe(4);
    const c = getChars(s, o);
    expect(c.types).toContain('Enchantment');
    expect(c.types).not.toContain('Creature');
    expect(c.subtypes).not.toContain('Avatar'); // CR 205.1b: a creature type does not stay on a noncreature object (CR 205.3d)
  });

  it('at the beginning of its controller\'s end step a time counter is removed; with the last one gone it is a creature again', () => {
    let s = drive(act(board(), { type: 'cast', player: 'p1', card: find(board(), FLOODPITS, 'hand'), method: 'impending' }));
    s = resolveTop(s);
    const o = onField(s, FLOODPITS);
    for (let n = 3; n >= 0; n--) {
      s = atEndStep(s, 'p1');
      s = until(s, (t) => t.zones.stack.length === 0 && t.pending?.kind === 'priority' && (t.objects[o]!.counters['time'] ?? 0) === n, 60);
      expect(s.objects[o]!.counters['time'] ?? 0).toBe(n);
      expect(getChars(s, o).types.includes('Creature')).toBe(n === 0);
      if (n > 0) s = until(s, (t) => t.turn.activePlayer === 'p2' && t.turn.step === 'end' && t.pending?.kind === 'priority');
    }
    expect(s.objects[o]!.counters['time'] ?? 0).toBe(0);
  });

  it('cast normally: no counters, a creature from the start (CR 702.176a "if you chose to pay")', () => {
    let s = drive(act(board(), { type: 'cast', player: 'p1', card: find(board(), FLOODPITS, 'hand') }));
    expect(tappedCount(s, 'Island')).toBe(5);
    s = resolveTop(s);
    const o = onField(s, FLOODPITS);
    expect(s.objects[o]!.counters['time'] ?? 0).toBe(0);
    expect(getChars(s, o).types).toContain('Creature');
  });

  it('a time counter put on it from elsewhere does not stop a normally cast one from being a creature (the impending cost was not paid)', () => {
    let s = resolveTop(drive(act(board(), { type: 'cast', player: 'p1', card: find(board(), FLOODPITS, 'hand') })));
    const o = onField(s, FLOODPITS);
    s = structuredClone(s);
    s.objects[o]!.counters['time'] = 2;
    expect(getChars(s, o).types).toContain('Creature');
  });
});

describe('CR 702.126a: improvise', () => {
  it('Arc Reactor ({5}) is cast with three artifacts tapped for {3} and two lands for the rest', () => {
    let s = scenario([REACTOR, 'Ornithopter', 'Wastes'], { p1: { hand: [REACTOR], battlefield: ['Ornithopter', 'Ornithopter', 'Ornithopter', ...lands('Wastes', 2)] } });
    expect(castLabels(s, REACTOR).length).toBeGreaterThanOrEqual(1);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, REACTOR, 'hand') });
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', min: 0, max: 3 });
    const thopters = s.zones.battlefield.filter((id) => s.objects[id]!.defId && names(s, [id])[0] === 'Ornithopter');
    s = drive(answer(s, { kind: 'chooseObjects', ids: thopters }));
    expect(tappedCount(s, 'Ornithopter')).toBe(3);
    expect(tappedCount(s, 'Wastes')).toBe(2);
    expect(names(s, s.zones.stack)).toEqual([REACTOR]);
  });

  it('not castable with four artifacts and no mana for a colored spell\'s colored part: artifacts pay generic mana only', () => {
    const s = scenario([IRONHEART, 'Ornithopter'], { p1: { hand: [IRONHEART], battlefield: ['Ornithopter', 'Ornithopter', 'Ornithopter', 'Ornithopter', 'Ornithopter'] } });
    expect(castLabels(s, IRONHEART)).toEqual([]); // {4}{U}: nothing pays {U}
  });

  it('"Noncreature spells you cast have improvise": a sorcery is cast with artifacts; a creature spell is not helped', () => {
    let s = scenario([IRONHEART, PRACTICUM, 'Ornithopter', 'Forest', 'Grizzly Bears'], { p1: { hand: [PRACTICUM, 'Grizzly Bears'], battlefield: [IRONHEART, 'Ornithopter', 'Ornithopter', 'Ornithopter', ...lands('Forest', 2)] } });
    expect(castLabels(s, 'Grizzly Bears').length).toBe(1);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, PRACTICUM, 'hand') });
    expect(s.pending).toMatchObject({ kind: 'chooseObjects' });
    const ids = (s.pending as { options: string[] }).options;
    expect(names(s, ids).sort()).toEqual([IRONHEART, 'Ornithopter', 'Ornithopter', 'Ornithopter']);
    s = drive(answer(s, { kind: 'chooseObjects', ids: ids.filter((id) => names(s, [id])[0] === 'Ornithopter') }));
    expect(names(s, s.zones.stack)).toEqual([PRACTICUM]);
    expect(tappedCount(s, 'Forest')).toBe(2);
    // a creature spell gets no improvise: with the artifacts tapped and no land, the Bears can't be cast
    expect(castLabels(s, 'Grizzly Bears')).toEqual([]);
  });
});

describe('CR 702.192a: paradigm', () => {
  const board = (): GameState => scenario([PRACTICUM, 'Forest', 'Grizzly Bears'], { p1: { hand: [PRACTICUM, PRACTICUM], battlefield: [...lands('Forest', 10), 'Grizzly Bears'] } });
  const bears = (s: GameState): number => s.objects[onField(s, 'Grizzly Bears')]!.counters['+1/+1'] ?? 0;

  it('the spell exiles itself and creates a delayed trigger the first time; a copy is cast at the next precombat main phase, for free', () => {
    let s = board();
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, PRACTICUM, 'hand') })));
    expect(bears(s)).toBe(2);
    expect(names(s, s.zones.exile)).toEqual([PRACTICUM]); // "Exile this spell"
    expect(s.zones.graveyard['p1']!.length).toBe(0);
    expect(s.delayedTriggers).toHaveLength(1);
    // the second Practicum this game: not the first time, no second delayed trigger
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, PRACTICUM, 'hand') })));
    expect(bears(s)).toBe(4);
    expect(names(s, s.zones.exile)).toEqual([PRACTICUM, PRACTICUM]);
    expect(s.delayedTriggers).toHaveLength(1);
    // p1's next precombat main phase: the delayed trigger, then the copy
    s = until(s, (t) => t.turn.activePlayer === 'p1' && t.turn.number > 1 && t.turn.step === 'main1' && t.zones.stack.length > 0);
    s = until(s, (t) => t.pending?.kind === 'yesNo', 20);
    expect(s.zones.exile.filter((id) => s.objects[id]!.kind === 'spellCopy')).toHaveLength(1); // the copy, created in exile (CR 707.12)
    const lands0 = s.zones.battlefield.filter((id) => s.objects[id]!.tapped).length;
    s = answer(s, { kind: 'yesNo', yes: true });
    s = until(s, (t) => t.zones.stack.length === 0 && t.pending?.kind === 'priority', 40);
    expect(bears(s)).toBe(6);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped).length).toBe(lands0); // without paying its mana cost
    expect(s.zones.exile.filter((id) => s.objects[id]!.kind === 'spellCopy')).toHaveLength(0); // the resolved copy is gone (CR 707.10a)
    expect(names(s, s.zones.exile)).toEqual([PRACTICUM, PRACTICUM]);
    expect(s.delayedTriggers).toHaveLength(1); // for the rest of the game
    expect(s.history.some((e) => e.ev === 'cast' && e.facts['copy'] !== true && e.facts['name'] === PRACTICUM && e.turn > 1)).toBe(true); // the copy was cast (CR 707.12)
  });

  it('declining to cast the copy: it ceases to exist; the trigger comes back next turn', () => {
    let s = board();
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, PRACTICUM, 'hand') })));
    s = until(s, (t) => t.pending?.kind === 'yesNo');
    s = answer(s, { kind: 'yesNo', yes: false });
    s = until(s, (t) => t.zones.stack.length === 0 && t.pending?.kind === 'priority', 40);
    expect(bears(s)).toBe(2);
    expect(s.zones.exile.filter((id) => s.objects[id]!.kind === 'spellCopy')).toHaveLength(0);
    const turn = s.turn.number;
    s = until(s, (t) => t.pending?.kind === 'yesNo' && t.turn.number > turn);
    expect(s.turn.activePlayer).toBe('p1');
    expect(s.turn.step).toBe('main1');
  });
});
