/**
 * WP32: the native keyword actions (design 7.5; effects/handlers/actions-native.ts) through `applyAction`, the trigger collector, the interpreter's `action`
 * op, the proposal pipeline and the resolution caster: cascade (CR 702.85a), discover (CR 701.57a), vote (CR 701.38a); and the forms that stay manual.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, CardDef, DecisionAnswer, EffectStep, GameState } from '../../../src/index';
import { withExamples } from '../zones/support';
import { resolutionCaster } from '../../../src/effects/cast-hook';
import { Game } from '../../../src/core/game';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { capabilitiesOf } from '../../../src/model/capabilities';
import { classifyCard } from '../../../src/model/classify';
import { drive } from '../announce/support';
import { act, answer, find, keyword, passBoth, scenario, synth } from '../helpers';

const you = { ref: 'you' } as const;
const gain1: EffectStep = { op: 'gainLife', who: you, amount: 1 };
const spell = (text: string, steps: EffectStep[]): AbilityDef => ({ kind: 'spell', text, effect: { targets: [], steps } });

/** {2}{G}{G} sorcery with cascade: mana value 4. */
const cascader = synth({ name: 'Test Cascader', cost: '{2}{G}{G}', type: 'Sorcery', abilities: [keyword('cascade'), spell('You gain 1 life.', [gain1])] });
/** {3}{G}{G} sorcery with cascade: mana value 5. */
const bigCascader = synth({ name: 'Test Big Cascader', cost: '{3}{G}{G}', type: 'Sorcery', abilities: [keyword('cascade'), spell('You gain 1 life.', [gain1])] });
/** {X}{G} sorcery with cascade: mana value 1 + X on the stack (CR 202.3e). */
const xCascader = synth({ name: 'Test X Cascader', cost: '{X}{G}', type: 'Sorcery', abilities: [keyword('cascade'), spell('You gain X life.', [gain1])] });
const discoverer = synth({ name: 'Test Discoverer', cost: '{1}{G}', type: 'Sorcery', abilities: [spell('Discover 3.', [{ op: 'action', action: 'discover', who: you, n: 3 }])] });
/** Discover 3, then a step that reads the discovered card (CR 701.57c). */
const finder = synth({
  name: 'Test Finder', cost: '{1}{G}', type: 'Sorcery',
  abilities: [spell('Discover 3. Exile the discovered card.', [
    { op: 'action', action: 'discover', who: you, n: 3, as: 'found' },
    { op: 'move', what: { ref: 'bound', name: 'found' }, to: { zone: 'exile' } },
  ])],
});
const judgment = synth({
  name: 'Test Judgment', cost: '{1}{W}{W}', type: 'Sorcery',
  abilities: [spell('Starting with you, each player votes for a nonland permanent you don\'t control. Exile each permanent with the most votes or tied for most votes.', [
    { op: 'action', action: 'vote', who: you, subject: { ref: 'each', filter: { not: { types: ['Land'] }, controller: 'opponent' } }, as: 'voted' },
    { op: 'move', what: { ref: 'bound', name: 'voted' }, to: { zone: 'exile' } },
  ])],
});
const wordVote = synth({
  name: 'Test Word Vote', cost: '{2}', type: 'Sorcery',
  abilities: [spell('Starting with you, each player votes for carnage or homage.', [{ op: 'action', action: 'vote', who: you, arg: 'carnage|homage' }])],
});
const manual = (name: string, text: string): CardDef => synth({ name, cost: '{2}', type: 'Enchantment', abilities: [{ kind: 'manual', text, reason: 'not parsed', shape: 'static' }] });
const broker = manual('Test Broker', 'While voting, you get an additional vote.');
const explorer = manual('Test Explorer', 'Whenever you discover, you gain 1 life.');
const averna = manual('Test Averna', 'As you cascade, you may put a land card from among the exiled cards onto the battlefield tapped under your control.');
/** Illusion of Choice style: a one-shot instant whose vote-changing sentence is resolved by hand and leaves nothing in play. */
const illusion = synth({
  name: 'Test Illusion', cost: '{U}', type: 'Instant',
  abilities: [spell('You choose how each player votes this turn. You gain 1 life.', [{ op: 'manual', text: 'You choose how each player votes this turn.', reason: 'not parsed' }, gain1])],
});

const DEFS = [cascader, bigCascader, xCascader, discoverer, finder, judgment, wordVote, broker, explorer, averna, illusion];
const CARDS = ['Forest', 'Plains', 'Island', 'Hill Giant', 'Grizzly Bears', 'Fire // Ice', 'Counterspell'];

const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name);
const library = (s: GameState, p: 'p1' | 'p2' = 'p1'): string[] => names(s, s.zones.library[p]!);
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;

function board(opts: { hand: string[]; library: string[]; battlefield?: string[]; p2?: string[] }): GameState {
  return scenario(CARDS, { defs: DEFS, p1: { hand: opts.hand, library: opts.library, battlefield: opts.battlefield ?? ['Forest', 'Forest', 'Forest', 'Forest', 'Forest'] }, p2: { battlefield: opts.p2 ?? [] } });
}

/** Cast the card and let its cascade trigger (on the stack above it, CR 702.85a "when you cast") resolve; stops at the "cast it?" question. */
const castAndCascade = (s: GameState, name: string): GameState => passBoth(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand') }), []));

describe('CR 702.85a: cascade', () => {
  it('the cascade trigger goes on the stack above the spell (CR 603.3), from the stack zone where cascade functions', () => {
    const s0 = board({ hand: ['Test Cascader'], library: ['Forest', 'Hill Giant', 'Grizzly Bears'] });
    const s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Cascader', 'hand') }), []);
    expect(s.zones.stack).toHaveLength(2);
    expect(s.objects[s.zones.stack[1]!]!.kind).toBe('ability');
  });

  it('exiles until a nonland card with lesser mana value (Hill Giant, 4, is not less than 4), casts it free, and puts the rest on the bottom', () => {
    const s0 = board({ hand: ['Test Cascader'], library: ['Forest', 'Hill Giant', 'Grizzly Bears'] });
    const asked = castAndCascade(s0, 'Test Cascader');
    expect(asked.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    const s = drive(answer(asked, { kind: 'yesNo', yes: true }), []);
    expect(names(s, s.zones.stack)).toEqual(['Test Cascader', 'Grizzly Bears']); // CR 608.2g: the free spell is above the cascading spell
    expect(s.zones.exile).toEqual([]);
    const lib = library(s);
    expect(lib.slice(-2).sort()).toEqual(['Forest', 'Hill Giant']); // CR 702.85a: the bottom, in a random order
    expect(lib).toHaveLength(22); // the 20 Plains of the scenario stayed on top of them
    expect(s.players[0]!.manaPool).toEqual([]);
    const done = passBoth(passBoth(s));
    expect(names(done, done.zones.battlefield).filter((n) => n === 'Grizzly Bears')).toHaveLength(1);
    expect(lifeOf(done, 'p1')).toBe(21);
  });

  it('declining to cast puts the hit on the bottom with the others', () => {
    const s0 = board({ hand: ['Test Cascader'], library: ['Forest', 'Hill Giant', 'Grizzly Bears'] });
    const s = answer(castAndCascade(s0, 'Test Cascader'), { kind: 'yesNo', yes: false });
    expect(names(s, s.zones.stack)).toEqual(['Test Cascader']);
    expect(library(s).slice(-3).sort()).toEqual(['Forest', 'Grizzly Bears', 'Hill Giant']);
    expect(library(s).slice(0, 20).every((n) => n === 'Plains')).toBe(true);
  });

  it('no card qualifies: every card is exiled and put back on the bottom (CR 702.85a), and no one is asked', () => {
    const s0 = scenario(CARDS, { defs: DEFS, p1: { hand: ['Test Cascader'], library: ['Hill Giant'], battlefield: ['Forest', 'Forest', 'Forest', 'Forest'] } });
    const s = castAndCascade(s0, 'Test Cascader');
    expect(s.pending?.kind).toBe('priority');
    expect(library(s).sort()).toEqual([...Array(20).fill('Plains'), 'Hill Giant'].sort());
    expect(s.zones.exile).toEqual([]);
  });

  it('a split card: the card in exile has the combined mana value (Fire // Ice, 4 < 5) and a half is cast (CR 709.3, 709.4)', () => {
    const s0 = board({ hand: ['Test Big Cascader'], library: ['Fire // Ice'] });
    const asked = castAndCascade(s0, 'Test Big Cascader');
    expect(asked.pending).toMatchObject({ kind: 'yesNo' });
    const half = answer(asked, { kind: 'yesNo', yes: true });
    expect(half.pending).toMatchObject({ kind: 'chooseOption' }); // which half
    const options = (half.pending as { options: { id: string; label: string; disabled?: string }[] }).options;
    const ice = options.find((o) => /Ice/.test(o.label) && !/Fire/.test(o.label))!;
    expect(ice.disabled).toBeUndefined();
    // W3b: Ice ("Tap target permanent. Draw a card.") is understood now, so casting it announces its target (CR 601.2c)
    const s = drive(answer(half, { kind: 'chooseOption', ids: [ice.id] }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: half.zones.battlefield[0]! }] }]);
    const top = s.objects[s.zones.stack.at(-1)!]!;
    expect(names(s, s.zones.stack)).toEqual(['Test Big Cascader', 'Fire // Ice']);
    expect(top.stack?.face).toBe(1); // CR 709.3: only the Ice half is cast, free (CR 608.2g)
    expect(s.players[0]!.manaPool).toEqual([]);
  });

  it('CR 702.85a, 709.3: the limit is checked on the half being cast, not on the combined card: each half of Fire // Ice is 2 (allowed under 3), never 4', () => {
    const s1 = scenario(CARDS, { defs: DEFS, p1: { exile: ['Fire // Ice'], battlefield: ['Forest'] } });
    const g1 = new Game(s1, []);
    const card = find(s1, 'Fire // Ice', 'exile');
    expect(resolutionCaster()!.check(g1, 'p1', card, { free: true, maxManaValue: 2 })).toBeNull();
    expect(resolutionCaster()!.check(g1, 'p1', card, { free: true, maxManaValue: 1 })?.rules).toContain('CR 702.85a'); // a half over the limit is refused
  });

  /** p1 casts `name` (answers for its announcement), p2 counters it with Counterspell in response to the cascade trigger; returns the state where the trigger resolves. */
  const counteredThenCascade = (s0: GameState, name: string, answers: DecisionAnswer[] = []): GameState => {
    const s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand') }), answers);
    expect(s.zones.stack).toHaveLength(2);
    const p2 = act(s, { type: 'pass', player: 'p1' });
    const spellId = s.zones.stack[0]!;
    const cs = drive(act(p2, { type: 'cast', player: 'p2', card: find(p2, 'Counterspell', 'hand', 'p2') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: spellId }] }]);
    const countered = passBoth(cs);
    expect(names(countered, countered.zones.graveyard['p1']!)).toContain(name); // CR 701.6a
    return passBoth(countered);
  };
  const counterBoard = (hand: string, lib: string[]): GameState => withExamples(scenario(CARDS, {
    defs: DEFS, p1: { hand: [hand], library: lib, battlefield: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest'] }, p2: { hand: ['Counterspell'], battlefield: ['Island', 'Island'] },
  }), 'Counterspell');

  it('CR 113.7a, 702.85a: the spell is countered in response; the cascade trigger still resolves, with the last known mana value (CR 608.2h)', () => {
    const asked = counteredThenCascade(counterBoard('Test Cascader', ['Hill Giant', 'Grizzly Bears']), 'Test Cascader');
    expect(asked.pending).toMatchObject({ kind: 'yesNo', player: 'p1' }); // Grizzly Bears (2 < 4); never "the engine cannot find its definition"
    const s = drive(answer(asked, { kind: 'yesNo', yes: true }), []);
    expect(names(s, s.zones.stack)).toEqual(['Grizzly Bears']);
    expect(s.log.some((l) => l.level === 'manual')).toBe(false);
  });

  it('CR 113.7a, 202.3e, 608.2h: a countered X spell cascades with the mana value it last had on the stack, X included (X=4: Hill Giant, 4 < 5)', () => {
    const asked = counteredThenCascade(counterBoard('Test X Cascader', ['Hill Giant']), 'Test X Cascader', [{ kind: 'chooseNumber', n: 4 }]);
    expect(asked.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    const s = drive(answer(asked, { kind: 'yesNo', yes: true }), []);
    expect(names(s, s.zones.stack)).toEqual(['Hill Giant']);
  });

  it('"as you cascade" (CR 702.85b) on a manual ability in play: the whole cascade is resolved by hand, never approximated', () => {
    const s0 = board({ hand: ['Test Cascader'], library: ['Forest', 'Grizzly Bears'], battlefield: ['Forest', 'Forest', 'Forest', 'Forest', 'Test Averna'] });
    const s = castAndCascade(s0, 'Test Cascader');
    expect(s.pending).toMatchObject({ kind: 'manualResolve', player: 'p1' });
    expect(library(s).slice(0, 2)).toEqual(['Forest', 'Grizzly Bears']); // nothing was exiled
  });

  it('CR 702.85a "resulting spell\'s mana value": the resolution caster refuses a face over the limit (cast-hook maxManaValue)', () => {
    const s1 = scenario(CARDS, { defs: DEFS, p1: { exile: ['Grizzly Bears'] } });
    const g1 = new Game(s1, []);
    const card = find(s1, 'Grizzly Bears', 'exile');
    expect(resolutionCaster()!.check(g1, 'p1', card, { free: true, maxManaValue: 1 })?.rules).toContain('CR 702.85a');
    expect(resolutionCaster()!.check(g1, 'p1', card, { free: true, maxManaValue: 2 })).toBeNull();
  });

  it('keyword:cascade and action:cascade are capabilities; a cascade card with an automated spell classifies full', () => {
    expect(ENGINE_CAPABILITIES.has('keyword:cascade')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('action:cascade')).toBe(true);
    expect(classifyCard({ faces: cascader.faces.map((f) => ({ abilities: f.abilities })) } as never, ENGINE_CAPABILITIES).level).toBe('full');
  });
});

describe('CR 701.57a: discover N', () => {
  it('stops at a nonland card with mana value N or less; if it is not cast it goes into the hand; the rest to the bottom', () => {
    const s0 = board({ hand: ['Test Discoverer'], library: ['Hill Giant', 'Grizzly Bears'] });
    const asked = passBoth(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Discoverer', 'hand') }), []));
    expect(asked.pending).toMatchObject({ kind: 'yesNo', player: 'p1' });
    const s = answer(asked, { kind: 'yesNo', yes: false });
    expect(names(s, s.zones.hand['p1']!)).toEqual(['Grizzly Bears']);
    expect(library(s).at(-1)).toBe('Hill Giant');
    expect(s.zones.exile).toEqual([]);
  });

  it('cast it without paying its mana cost (mana value 2 <= 3)', () => {
    const s0 = board({ hand: ['Test Discoverer'], library: ['Hill Giant', 'Grizzly Bears'] });
    const asked = passBoth(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Discoverer', 'hand') }), []));
    const s = drive(answer(asked, { kind: 'yesNo', yes: true }), []);
    expect(names(s, s.zones.stack)).toEqual(['Grizzly Bears']);
    expect(s.zones.hand['p1']).toEqual([]);
  });

  it('CR 701.57c, design 3.1 rule 6: a discover resolved by hand still binds the discovered card (to nothing), so the next step does nothing (CR 609.3)', () => {
    const s0 = board({ hand: ['Test Finder'], library: ['Hill Giant', 'Grizzly Bears'], battlefield: ['Forest', 'Forest', 'Test Explorer'] });
    const asked = passBoth(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Finder', 'hand') }), []));
    expect(asked.pending).toMatchObject({ kind: 'manualResolve', player: 'p1' });
    const s = answer(asked, { kind: 'manualResolve', ops: [] });
    expect(s.pending).toMatchObject({ kind: 'priority' });
    expect(names(s, s.zones.graveyard['p1']!)).toContain('Test Finder');
    expect(s.zones.exile).toEqual([]);
  });

  it('discover without its N is a form the walker names (never registered), so such a card is not classified automated', () => {
    const caps = capabilitiesOf(spell('Discover.', [{ op: 'action', action: 'discover', who: you }]));
    expect(caps).toContain('action:discover.noN');
    expect(ENGINE_CAPABILITIES.has('action:discover.noN')).toBe(false);
    expect(ENGINE_CAPABILITIES.has('action:discover')).toBe(true);
  });
});

describe('CR 701.38a: vote', () => {
  const board2 = (extra: string[] = []) => scenario(CARDS, {
    defs: DEFS, p1: { hand: ['Test Judgment'], battlefield: ['Plains', 'Plains', 'Plains', ...extra] }, p2: { battlefield: ['Grizzly Bears', 'Hill Giant', 'Forest'] },
  });
  const castJudgment = (s: GameState) => passBoth(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Judgment', 'hand') }), []));

  it('starting with you, each player votes in turn order; each object with the most votes or tied for most is bound and exiled', () => {
    const s0 = board2();
    const first = castJudgment(s0);
    expect(first.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1' });
    const opts = (first.pending as { options: string[] }).options;
    expect(names(first, opts).sort()).toEqual(['Grizzly Bears', 'Hill Giant']); // nonland permanents you don't control
    const second = answer(first, { kind: 'chooseObjects', ids: [find(first, 'Grizzly Bears', 'battlefield')] });
    expect(second.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2' });
    const tied = answer(second, { kind: 'chooseObjects', ids: [find(first, 'Hill Giant', 'battlefield')] });
    expect(names(tied, tied.zones.exile).sort()).toEqual(['Grizzly Bears', 'Hill Giant']); // tied for most: both
  });

  it('a clear winner: only it is exiled', () => {
    const s0 = board2();
    const first = castJudgment(s0);
    const bears = find(first, 'Grizzly Bears', 'battlefield');
    const s = answer(answer(first, { kind: 'chooseObjects', ids: [bears] }), { kind: 'chooseObjects', ids: [bears] });
    expect(names(s, s.zones.exile)).toEqual(['Grizzly Bears']);
    expect(names(s, s.zones.battlefield)).toContain('Hill Giant');
  });

  it('CR 701.38d: an extra vote from a manual ability in play makes the whole vote manual; the binding exists, so the exile step does nothing (design 3.1 rule 6, CR 609.3)', () => {
    const s = castJudgment(board2(['Test Broker']));
    expect(s.pending).toMatchObject({ kind: 'manualResolve' });
    const done = answer(s, { kind: 'manualResolve', ops: [] });
    expect(done.pending).toMatchObject({ kind: 'priority' });
    expect(names(done, done.zones.battlefield)).toEqual(expect.arrayContaining(['Grizzly Bears', 'Hill Giant']));
    expect(done.zones.exile).toEqual([]);
  });

  it('CR 701.38a, 611.2a: a one-shot spell resolved by hand earlier this turn changed how players vote ("you choose how each player votes this turn"): the vote is manual', () => {
    const s0 = scenario(CARDS, {
      defs: DEFS, p1: { hand: ['Test Judgment', 'Test Illusion'], battlefield: ['Plains', 'Plains', 'Plains', 'Island'] }, p2: { battlefield: ['Grizzly Bears', 'Hill Giant', 'Forest'] },
    });
    const byHand = passBoth(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Illusion', 'hand') }), []));
    expect(byHand.pending).toMatchObject({ kind: 'manualResolve' });
    const resolved = answer(byHand, { kind: 'manualResolve', ops: [] });
    expect(names(resolved, resolved.zones.graveyard['p1']!)).toContain('Test Illusion'); // nothing of it is left in play
    const s = castJudgment(resolved);
    expect(s.pending).toMatchObject({ kind: 'manualResolve' }); // never each player voting freely
    expect((s.pending as { reason?: string }).reason).toMatch(/Test Illusion/);
  });

  it('a vote for words is resolved by hand, and the walker names that form so the card is not classified automated', () => {
    const caps = capabilitiesOf(wordVote.faces[0]!.abilities[0]!);
    expect(caps).toContain('action:vote.words');
    expect(ENGINE_CAPABILITIES.has('action:vote.words')).toBe(false);
    expect(classifyCard({ faces: wordVote.faces.map((f) => ({ abilities: f.abilities })) } as never, ENGINE_CAPABILITIES).level).not.toBe('full');
    expect(classifyCard({ faces: judgment.faces.map((f) => ({ abilities: f.abilities })) } as never, ENGINE_CAPABILITIES).level).toBe('full');
    const s0 = scenario(CARDS, { defs: DEFS, p1: { hand: ['Test Word Vote'], battlefield: ['Plains', 'Plains'] } });
    const s = passBoth(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Word Vote', 'hand') }), []));
    expect(s.pending).toMatchObject({ kind: 'manualResolve' });
  });
});
