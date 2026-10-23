/**
 * H1 review: what the first H1 cut still gave away, or broke, with the fresh library ids (CR 400.2, 401.4, 701.24). Each case runs the real handlers and the
 * real proposal pipeline (no mocks).
 *  - Cards put into a library in an order nobody else may learn (at random, CR 702.85a, 701.57a; arranged by their owner, CR 401.4) are not linked to their
 *    places by last known information, events, the log or the order ids were made in.
 *  - A scry looks the same to the other players whether the order was kept or changed (CR 701.22a, 701.20d).
 *  - Code that still holds a library card's id when a shuffle renews it follows the card: a manual "shuffle, then put the found card on top" (CR 701.24b), a mill
 *    or a surveil interrupted by a "shuffle it into its owner's library instead" replacement (CR 614.1a, 701.17a, 701.25a).
 *  - A shuffle adds nothing to the state (no last known information per card).
 *  - A card exiled face down that goes to a hand or a library is not named by its last known information (CR 406.3, 708.9).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, viewFor, HIDDEN_DEF, type CardDef, type EffectStep, type GameEvent, type GameState, type ObjectId } from '../../src/index';
import { Game } from '../../src/core/game';
import { shuffleLibrary } from '../../src/core/zones';
import { seedRng } from '../../src/rng';
import { clone } from '../../src/util/clone';
import { scenario } from '../m5/helpers';
import { startedGame } from '../helpers';
import { act, answer, find } from '../m3/scenario';
import { lib, names, onStack, prog, runOn, sorcery, yard } from '../m5/cards/harness';
import { permanent, staticAbility } from '../m5/propose/support';

const SPELL = 'H1 Review Spell';
const you = { ref: 'you' } as const;
const fixed = (ids: readonly ObjectId[], zone: 'graveyard' | 'battlefield' | 'library' | 'exile') => ({ ref: 'fixed' as const, objects: ids.map((id) => ({ id, zone })) });
const shown = (s: GameState, p: string, id: ObjectId): boolean => viewFor(s, p).objects[id]!.defId !== HIDDEN_DEF;

/** "If ~ would be put into a graveyard from anywhere, shuffle it into its owner's library instead" (the self replacement of destination.test.ts). */
const COLOSSUS: CardDef = permanent('Test Colossus', 'Artifact Creature — Golem', [
  staticAbility('If ~ would be put into a graveyard from anywhere, shuffle it into its owner\'s library instead.', [
    { s: 'replace', replaces: { ev: 'zoneChange', subject: { self: true }, to: 'graveyard' }, body: { b: 'modify', destination: { zone: 'library', position: 'random' } } },
  ], { zone: ['battlefield', 'hand', 'library', 'stack', 'exile', 'graveyard'] }),
], { pt: ['11', '11'] });

/** What a player is shown of a run: the view, and the zone changes in the order they happened (ids and zones, not names). */
function seenBy(out: { s: GameState; events: GameEvent[] }, viewer: string): string {
  const moves = out.events.flatMap((e) => (e.type === 'zoneChanged' ? [`${e.oldId}:${e.from}>${e.to}`] : []));
  return JSON.stringify({ view: viewFor(out.s, viewer), moves });
}

/** No last known information in the viewer's view links an old id to a card it can't see, or to an id that no longer exists. */
function expectNoHiddenLinks(s: GameState, viewer: string): void {
  const v = viewFor(s, viewer);
  for (const l of Object.values(v.lki)) {
    if (l.newId === undefined) continue;
    const now = v.objects[l.newId];
    if (now) expect(now.defId).not.toBe(HIDDEN_DEF);
    else expect(v.lki[l.newId]).toBeDefined();
  }
}

describe('H1 review: a library order nobody may learn stays hidden (CR 400.2, 401.4)', () => {
  const s0 = scenario(['Grizzly Bears', 'Hill Giant', 'Llanowar Elves', 'Plains'], {
    p1: { graveyard: ['Grizzly Bears', 'Hill Giant', 'Llanowar Elves'], library: ['Plains', 'Plains', 'Plains', 'Plains'] },
    defs: [sorcery(SPELL, prog([]))],
  });

  it('CR 702.85a, 401.4: public cards put on the bottom in a random order: the other player sees the same view, events and log whatever the order', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const program = prog([{ op: 'move', what: fixed(yard(s, 'p1'), 'graveyard'), to: { zone: 'library', position: 'bottom', order: 'random' } } as EffectStep]);
    const a = runOn(s, id, program);
    const bottom = (st: GameState) => names(st, lib(st, 'p1').slice(-3));
    // A second random generator state that puts the cards in another order (the premise: the order differs).
    let b = a;
    for (let i = 0; i < 20 && JSON.stringify(bottom(b.s)) === JSON.stringify(bottom(a.s)); i++) {
      const other = clone(s);
      other.rng = seedRng(`h1-review-${i}`);
      b = runOn(other, id, program);
    }
    expect(bottom(a.s).sort()).toEqual(['Grizzly Bears', 'Hill Giant', 'Llanowar Elves']);
    expect(bottom(b.s)).not.toEqual(bottom(a.s));
    for (const viewer of ['p2', null] as const) expect(seenBy(b, viewer as string)).toBe(seenBy(a, viewer as string));
    expectNoHiddenLinks(a.s, 'p2');
    expectNoHiddenLinks(a.s, 'p1'); // the owner does not see its own library either
  });

  it('CR 401.4: the owner arranges two of its permanents put on top of its library; the other player can\'t tell the arrangement', () => {
    const s1 = scenario(['Forest', 'Island', 'Plains'], { p2: { battlefield: ['Forest', 'Island'], library: ['Plains', 'Plains'] }, defs: [sorcery(SPELL, prog([]))] });
    const { s, id } = onStack(s1, { name: SPELL });
    const forest = find(s, 'Forest', 'battlefield');
    const island = find(s, 'Island', 'battlefield');
    const program = prog([{ op: 'move', what: fixed([forest, island], 'battlefield'), to: { zone: 'library', position: 'top' } } as EffectStep]);
    expect(runOn(s, id, program).pending).toMatchObject({ kind: 'order', player: 'p2' });
    const a = runOn(s, id, program, [{ kind: 'order', ids: [forest, island] }]);
    const b = runOn(s, id, program, [{ kind: 'order', ids: [island, forest] }]);
    expect(names(a.s, lib(a.s, 'p2').slice(0, 2))).toEqual(['Forest', 'Island']);
    expect(names(b.s, lib(b.s, 'p2').slice(0, 2))).toEqual(['Island', 'Forest']);
    expect(seenBy(b, 'p1')).toBe(seenBy(a, 'p1'));
    expectNoHiddenLinks(a.s, 'p1');
  });
});

describe('H1 review: a scry looks the same to the other players whether the order was kept or changed (CR 701.22a, 701.20d)', () => {
  it('CR 701.22a, 701.20d: a card revealed to the opponent and scried back on top: the opponent can\'t tell kept from swapped; the scrying player sees both', () => {
    const s1 = scenario(['Grizzly Bears', 'Island', 'Plains'], { p1: { library: ['Grizzly Bears', 'Island', 'Plains', 'Plains'] }, defs: [sorcery(SPELL, prog([]))] });
    const { s, id } = onStack(s1, { name: SPELL });
    const [bears, island] = lib(s, 'p1');
    s.objects[bears!]!.revealedTo = ['p1', 'p2']; // CR 701.20a: revealed earlier, still in the library
    const program = prog([{ op: 'scry', who: you, count: 2 }]);
    const kept = runOn(s, id, program, [{ kind: 'chooseObjects', ids: [] }, { kind: 'order', ids: [bears!, island!] }]);
    const swapped = runOn(s, id, program, [{ kind: 'chooseObjects', ids: [] }, { kind: 'order', ids: [island!, bears!] }]);
    expect(names(kept.s, lib(kept.s, 'p1').slice(0, 2))).toEqual(['Grizzly Bears', 'Island']);
    expect(names(swapped.s, lib(swapped.s, 'p1').slice(0, 2))).toEqual(['Island', 'Grizzly Bears']);
    expect(seenBy(swapped, 'p2')).toBe(seenBy(kept, 'p2'));
    for (const out of [kept, swapped]) for (const c of lib(out.s, 'p1').slice(0, 2)) expect(shown(out.s, 'p1', c)).toBe(true);
  });
});

/** Lightning Bolt resolved by hand (a manualResolve decision); p1's library holds Hill Giant on top of 20 Plains. */
function resolvingByHand(): GameState {
  let s = scenario(['Lightning Bolt', 'Hill Giant', 'Mountain', 'Plains'], {
    p1: { hand: ['Lightning Bolt'], library: ['Hill Giant', 'Mountain', ...Array<string>(20).fill('Plains')], battlefield: ['Mountain'] },
    manual: ['Lightning Bolt'],
  });
  s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Lightning Bolt', 'hand') });
  s = answer(s, { kind: 'payCost', auto: true });
  s = act(s, { type: 'pass', player: 'p1' });
  s = act(s, { type: 'pass', player: 'p2' });
  expect(s.pending).toMatchObject({ kind: 'manualResolve' });
  return s;
}

describe('H1 review: an id held across a shuffle follows the card (CR 701.24b, 614.1a)', () => {
  it('CR 701.24b: by hand, "shuffle, then put the found card on top" in one answer: the card named before the shuffle goes on top', () => {
    const s = resolvingByHand();
    const giant = find(s, 'Hill Giant', 'library', 'p1');
    const r = applyAction(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'manualResolve', ops: [{ op: 'shuffle', player: 'p1' }, { op: 'move', object: giant, to: 'libraryTop' }] } });
    expect(r.error).toBeUndefined();
    expect(names(r.state, lib(r.state, 'p1').slice(0, 1))).toEqual(['Hill Giant']);
    expect(lib(r.state, 'p1')).toHaveLength(lib(s, 'p1').length);
  });

  const s2 = scenario(['Grizzly Bears', 'Island', 'Plains'], {
    p1: { library: ['Test Colossus', 'Grizzly Bears', 'Island', ...Array<string>(10).fill('Plains')] }, defs: [COLOSSUS, sorcery(SPELL, prog([]))],
  });
  const inLibrary = (s: GameState) => names(s, lib(s, 'p1')).filter((n) => n === 'Test Colossus');

  it('CR 701.17a, 614.1a: mill 3 with a "shuffle it into its owner\'s library instead" card on top: the other two cards are milled', () => {
    const { s, id } = onStack(s2, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'mill', who: you, count: 3 }]));
    expect(names(out.s, yard(out.s, 'p1')).sort()).toEqual(['Grizzly Bears', 'Island']);
    expect(inLibrary(out.s)).toEqual(['Test Colossus']);
  });

  it('CR 701.25a, 614.1a: surveil 3, all three into the graveyard, with that card on top: the other two go to the graveyard', () => {
    const { s, id } = onStack(s2, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'surveil', who: you, count: 3 }]), [{ kind: 'chooseObjects', ids: lib(s, 'p1').slice(0, 3) }]);
    expect(out.pending).toBeNull();
    expect(names(out.s, yard(out.s, 'p1')).sort()).toEqual(['Grizzly Bears', 'Island']);
    expect(inLibrary(out.s)).toEqual(['Test Colossus']);
  });

  it('CR 400.7, 614.1a: one move of three library cards to the graveyard, that card first: the other two are moved', () => {
    const { s, id } = onStack(s2, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'move', what: fixed(lib(s, 'p1').slice(0, 3), 'library'), to: { zone: 'graveyard' } } as EffectStep]));
    expect(names(out.s, yard(out.s, 'p1')).sort()).toEqual(['Grizzly Bears', 'Island']);
    expect(inLibrary(out.s)).toEqual(['Test Colossus']);
  });
});

describe('H1 review: a shuffle adds nothing to the state (CR 701.24a)', () => {
  it('CR 701.24a: twenty shuffles write no last known information', () => {
    const s = clone(startedGame());
    const before = Object.keys(s.lki).length;
    const g = new Game(s);
    for (let i = 0; i < 20; i++) shuffleLibrary(g, 'p1');
    expect(Object.keys(g.s.lki).length).toBe(before);
  });
});

describe('H1 review: a face-down card\'s last known information (CR 406.3, 708.9)', () => {
  const s3 = scenario(['Hill Giant', 'Grizzly Bears'], { p1: { exile: ['Hill Giant'], battlefield: ['Grizzly Bears'] }, defs: [sorcery(SPELL, prog([]))] });

  it('CR 406.3, 708.9: a card exiled face down that is put into its owner\'s hand is not named to the other player', () => {
    const { s, id } = onStack(s3, { name: SPELL });
    const giant = find(s, 'Hill Giant', 'exile');
    s.objects[giant]!.faceDown = true;
    expect(shown(s, 'p2', giant)).toBe(false);
    const out = runOn(s, id, prog([{ op: 'move', what: fixed([giant], 'exile'), to: { zone: 'hand' } } as EffectStep]));
    expect(names(out.s, out.s.zones.hand.p1!)).toEqual(['Hill Giant']);
    const v = viewFor(out.s, 'p2');
    expect(v.lki[giant]).toBeUndefined();
    expect(v.defs['Hill Giant']).toBeUndefined();
    // FAST5X E25 (CR 406.3): a card exiled face down can't be examined by any player unless an instruction allows it (nothing let p1 look at this one)
    expect(viewFor(out.s, 'p1').lki[giant]).toBeUndefined();
  });

  it('CR 708.9: a face-down permanent that leaves the battlefield is revealed: its last known information is public', () => {
    const { s, id } = onStack(s3, { name: SPELL });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s.objects[bears]!.faceDown = true;
    const out = runOn(s, id, prog([{ op: 'move', what: fixed([bears], 'battlefield'), to: { zone: 'hand' } } as EffectStep]));
    expect(viewFor(out.s, 'p2').lki[bears]?.object.defId).toBe('Grizzly Bears');
  });
});
