/**
 * WP13: scry, surveil, search, shuffle (CR 701.22-701.25) and the hidden information they involve (CR 400.2, 701.20e, 701.23a).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { viewFor, HIDDEN_DEF, IllegalAction, type GameState, type ObjectId } from '../../../src/index';
import { scenario } from '../helpers';
import { performed, replacements } from './fakes';
import { hand, lib, names, onStack, prog, runOn, sorcery, yard } from './harness';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fakes')).proposeModule() }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fakes')).manualModule() }));

afterEach(() => {
  replacements.length = 0;
  performed.length = 0;
});

const SPELL = 'Test Library Spell';
const board = (opts: Parameters<typeof scenario>[1] = {}): GameState =>
  scenario(['Island', 'Forest', 'Mountain', 'Swamp', 'Grizzly Bears', 'Lightning Bolt', 'Llanowar Elves'], { ...opts, defs: [sorcery(SPELL, prog([])), ...(opts.defs ?? [])] });
const you = { ref: 'you' } as const;
const s0 = board({ p1: { library: ['Island', 'Forest', 'Mountain', 'Grizzly Bears'], graveyard: ['Llanowar Elves'] }, p2: { library: ['Swamp', 'Lightning Bolt'] } });
const visibleTo = (s: GameState, p: string, id: ObjectId): boolean => viewFor(s, p).objects[id]!.defId !== HIDDEN_DEF;

describe('scry (CR 701.22)', () => {
  it('CR 701.22a: look at the top N, put any number on the bottom in the chosen order and the rest on top in the chosen order', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const [island, forest, mountain] = lib(s, 'p1');
    const program = prog([{ op: 'scry', who: you, count: 3 }]);
    const first = runOn(s, id, program);
    expect(first.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 0, max: 3, ordered: true, options: [island, forest, mountain] });
    const second = runOn(s, id, program, [{ kind: 'chooseObjects', ids: [island!] }]);
    expect(second.pending).toMatchObject({ kind: 'order', player: 'p1' });
    const out = runOn(s, id, program, [{ kind: 'chooseObjects', ids: [island!] }, { kind: 'order', ids: [mountain!, forest!] }]);
    const after = names(out.s, lib(out.s, 'p1'));
    expect(after.slice(0, 3)).toEqual(['Mountain', 'Forest', 'Grizzly Bears']);
    expect(after[after.length - 1]).toBe('Island');
    expect(out.results.get('#0')).toMatchObject({ performed: true, count: 3 });
    expect(out.results.get('#0')!.kept!.map((k) => k.object.defId)).toEqual(['Mountain', 'Forest']); // r5-fxz: the cards left on top (StepResult.kept)
  });

  it('CR 701.22a: two cards for the bottom go there in the order chosen (the first one highest); one card left on top needs no order', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const [island, forest] = lib(s, 'p1');
    const out = runOn(s, id, prog([{ op: 'scry', who: you, count: 2 }]), [{ kind: 'chooseObjects', ids: [forest!, island!] }]);
    expect(out.pending).toBeNull();
    expect(names(out.s, lib(out.s, 'p1')).slice(-2)).toEqual(['Forest', 'Island']);
  });

  it('CR 701.20e, 400.2: while scrying, only the scrying player sees the cards', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const [island] = lib(s, 'p1');
    const first = runOn(s, id, prog([{ op: 'scry', who: you, count: 2 }]));
    expect(visibleTo(first.s, 'p1', island!)).toBe(true);
    expect(visibleTo(first.s, 'p2', island!)).toBe(false);
    expect(visibleTo(first.s, 'p1', lib(s, 'p1')[2]!)).toBe(false); // the third card was not looked at
  });

  it('CR 701.20d: a reordered card becomes a new object; a card left where it was stays seen (H1: under a new id, CR 400.2)', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const [island, forest] = lib(s, 'p1');
    const kept = runOn(s, id, prog([{ op: 'scry', who: you, count: 2 }]), [{ kind: 'chooseObjects', ids: [] }, { kind: 'order', ids: [island!, forest!] }]);
    // H1: the ids change whether or not the order did, so the other players can't tell which (CR 400.2, 401.2); the scrying player still sees both.
    const top = lib(kept.s, 'p1').slice(0, 2);
    expect(top).not.toContain(island);
    expect(top).not.toContain(forest);
    expect(names(kept.s, top)).toEqual(['Island', 'Forest']);
    expect(top.every((c) => visibleTo(kept.s, 'p1', c) && !visibleTo(kept.s, 'p2', c))).toBe(true);
    const swapped = runOn(s, id, prog([{ op: 'scry', who: you, count: 2 }]), [{ kind: 'chooseObjects', ids: [] }, { kind: 'order', ids: [forest!, island!] }]);
    expect(lib(swapped.s, 'p1').slice(0, 2)).not.toContain(island);
    expect(names(swapped.s, lib(swapped.s, 'p1').slice(0, 2))).toEqual(['Forest', 'Island']);
  });

  it('CR 701.22b: scry 0 is no scry (no decision, no event); CR 701.22d: a scry event follows the whole process', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const none = runOn(s, id, prog([{ op: 'scry', who: you, count: 0 }]));
    expect(none.events).toEqual([]);
    const one = runOn(s, id, prog([{ op: 'scry', who: you, count: 1 }]), [{ kind: 'chooseObjects', ids: [] }]);
    expect(one.events.filter((e) => e.type === 'actionPerformed')).toEqual([{ type: 'actionPerformed', verb: 'scry', actor: 'p1' }]);
  });

  it('CR 701.22c: when several players scry, each decides in APNAP order and the cards move afterwards', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const program = prog([{ op: 'scry', who: { ref: 'each', who: 'player' }, count: 1 }]);
    const second = runOn(s, id, program, [{ kind: 'chooseObjects', ids: [lib(s, 'p1')[0]!] }]);
    expect(second.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2' });
    expect(lib(second.s, 'p1')[0]).toBe(lib(s, 'p1')[0]); // p1's card has not moved yet
  });

  it('design 4.3.3, CR 701.22a: reordering a library is not a zone change: no last known information is written and no zone event is emitted (H1: the cards get new ids)', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const [island, forest, mountain] = lib(s, 'p1');
    const out = runOn(s, id, prog([{ op: 'scry', who: you, count: 3 }]), [{ kind: 'chooseObjects', ids: [island!] }, { kind: 'order', ids: [mountain!, forest!] }]);
    for (const k of [island!, forest!, mountain!]) {
      expect(out.s.lki[k]).toBeUndefined();
      expect(out.s.objects[k]).toBeUndefined();
    }
    expect(out.events.filter((e) => e.type === 'zoneChanged')).toEqual([]);
    const after = names(out.s, lib(out.s, 'p1'));
    expect([...after.slice(0, 3), after[after.length - 1]]).toEqual(['Mountain', 'Forest', 'Grizzly Bears', 'Island']);
  });

  it('CR 701.22a, 400.2: the log tells everyone how many cards went where and names them to the scrying player only', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'scry', who: you, count: 1 }]), [{ kind: 'chooseObjects', ids: [lib(s, 'p1')[0]!] }]);
    const line = out.s.log.find((l) => l.rules?.includes('CR 701.22a'))!;
    expect(line.text).toBe('Alice scries 1, putting 0 cards on top and a card on the bottom.');
    expect(line.privateText).toEqual({ players: ['p1'], text: 'Alice scries 1: on top nothing; on the bottom Island.' });
  });
});

describe('surveil (CR 701.25)', () => {
  it('CR 701.25a: any number of the top N go to the graveyard, the rest back on top in the chosen order', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const [island, forest, mountain] = lib(s, 'p1');
    const out = runOn(s, id, prog([{ op: 'surveil', who: you, count: 3, as: 'binned' }]), [{ kind: 'chooseObjects', ids: [forest!] }, { kind: 'order', ids: [mountain!, island!] }]);
    expect(names(out.s, yard(out.s, 'p1'))).toEqual(['Llanowar Elves', 'Forest']);
    expect(names(out.s, lib(out.s, 'p1')).slice(0, 3)).toEqual(['Mountain', 'Island', 'Grizzly Bears']);
    expect(out.results.get('binned')).toMatchObject({ performed: true, count: 1 });
    expect(out.results.get('binned')!.kept!.map((k) => k.object.defId)).toEqual(['Mountain', 'Island']); // r5-fxz: the cards left on top (StepResult.kept)
    expect(out.cx!.bindings.get('binned')!.objects[0]!.zone).toBe('graveyard');
    expect(performed.map((e) => e.ev === 'zoneChange' && e.destination.cause)).toEqual(['surveil']); // the move to the graveyard is proposed (CR 614.1)
    expect(out.events.some((e) => e.type === 'actionPerformed' && e.verb === 'surveil')).toBe(true); // CR 701.25d
  });

  it('CR 701.25c: surveil 0 is no surveil', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    expect(runOn(s, id, prog([{ op: 'surveil', who: you, count: 0 }])).events).toEqual([]);
  });
});

describe('search (CR 701.23)', () => {
  const basicLand = { types: ['Land'], supertypes: ['Basic'] };

  it('CR 701.23a, 400.2: the searcher looks at every card of their library (shown to them only) and finds a card with the stated quality', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const program = prog([{ op: 'search', who: you, zone: 'library', filter: basicLand, max: 1, as: 'found' }]);
    const first = runOn(s, id, program);
    expect(first.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 0, max: 1 });
    const options = first.pending!.kind === 'chooseObjects' ? first.pending.options : [];
    expect(names(s, options).slice(0, 3)).toEqual(['Island', 'Forest', 'Mountain']); // Grizzly Bears is not a basic land
    expect(options).not.toContain(lib(s, 'p1')[3]);
    expect(lib(s, 'p1').every((c) => visibleTo(first.s, 'p1', c))).toBe(true);
    expect(lib(s, 'p1').some((c) => visibleTo(first.s, 'p2', c))).toBe(false);
    const forest = lib(s, 'p1')[1]!;
    const out = runOn(s, id, program, [{ kind: 'chooseObjects', ids: [forest] }]);
    expect(out.cx!.bindings.get('found')!.objects).toEqual([{ id: forest, zone: 'library' }]);
    expect(out.results.get('found')).toEqual({ performed: true, count: 1, searched: [{ owner: 'p1', zone: 'library' }] }); // r5-moved: the zones searched (CR 701.23a)
    const line = out.s.log.find((l) => l.rules?.includes('CR 701.23a'))!;
    expect(line.text).toBe('Alice searches their library and finds a card.'); // CR 701.23e: not revealed
    expect(line.privateText!.text).toBe('Alice searches their library and finds Forest.');
    expect(out.events.some((e) => e.type === 'actionPerformed' && e.verb === 'search')).toBe(true);
  });

  it('CR 701.23b: a search of a hidden zone for a stated quality may find nothing', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'search', who: you, zone: 'library', filter: basicLand, max: 1, as: 'found' }]), [{ kind: 'chooseObjects', ids: [] }]);
    // r5-moved (CR 701.23a, 603.12): the search was performed although it found nothing ("When you search your library this way, ..." triggers); `count` is what
    // it found (merge wave 8: the audit's D2 rule, "a search is carried out when a zone is searched", is the same rule)
    expect(out.results.get('found')).toEqual({ performed: true, count: 0, searched: [{ owner: 'p1', zone: 'library' }] });
    expect(out.cx!.bindings.get('found')!.objects).toEqual([]);
  });

  it('CR 701.23d: a search for "a card" must find one', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const program = prog([{ op: 'search', who: you, zone: 'library', filter: {}, max: 1, as: 'found' }]);
    expect(runOn(s, id, program).pending).toMatchObject({ min: 1, max: 1 });
    expect(() => runOn(s, id, program, [{ kind: 'chooseObjects', ids: [] }])).toThrow(IllegalAction);
  });

  it('CR 701.20a, 701.23e: "reveal it" shows the found card to everybody and names it in the public log', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const bears = lib(s, 'p1')[3]!;
    const out = runOn(s, id, prog([{ op: 'search', who: you, zone: 'library', filter: { types: ['Creature'] }, max: 1, reveal: true, as: 'found' }]), [{ kind: 'chooseObjects', ids: [bears] }]);
    expect(visibleTo(out.s, 'p2', bears)).toBe(true);
    expect(out.s.log.some((l) => l.text === 'Alice searches their library and finds Grizzly Bears, revealing it.')).toBe(true);
  });

  it('CR 701.23b (public zone): a search of a graveyard must find what matches; with exactly that many there is nothing to choose', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'search', who: you, zone: 'graveyard', filter: { types: ['Creature'] }, max: 1, as: 'found' }]));
    expect(out.pending).toBeNull();
    expect(names(out.s, out.cx!.bindings.get('found')!.objects.map((h) => h.id))).toEqual(['Llanowar Elves']);
  });

  describe('the handler reads an absent `min` as the renderer prints it (render/steps-cards.ts, CR 701.23b, 701.23d)', () => {
    const decision = (step: Record<string, unknown>, opts: { x?: number } = {}) => {
      const { s, id } = onStack(s0, { name: SPELL, ...opts });
      return runOn(s, id, prog([{ op: 'search', who: you, zone: 'library', filter: {}, as: 'found', ...step } as never])).pending;
    };

    it('CR 701.23d: max 1 ("a card") must find one', () => {
      expect(decision({ max: 1 })).toMatchObject({ kind: 'chooseObjects', min: 1, max: 1 });
    });

    it('CR 701.23d: max 3 with no min is "up to three cards": the player may find fewer', () => {
      expect(decision({ max: 3 })).toMatchObject({ kind: 'chooseObjects', min: 0, max: 3 });
    });

    it('CR 107.3, 701.23d: max X with no min is "up to X cards"', () => {
      expect(decision({ max: { q: 'X' } }, { x: 2 })).toMatchObject({ kind: 'chooseObjects', min: 0, max: 2 });
    });

    it('CR 701.23d: max "any" with no min is "any number of cards": the player chooses, nothing is found automatically', () => {
      expect(decision({ max: 'any' })).toMatchObject({ kind: 'chooseObjects', min: 0, max: lib(s0, 'p1').length });
    });

    it('CR 701.23d: an explicit min equal to max ("two cards") must find that many', () => {
      expect(decision({ min: 2, max: 2 })).toMatchObject({ kind: 'chooseObjects', min: 2, max: 2 });
    });

    it('CR 701.23b: a hidden zone searched for a stated quality never forces a find, even with an explicit min', () => {
      expect(decision({ filter: basicLand, min: 1, max: 1 })).toMatchObject({ kind: 'chooseObjects', min: 0, max: 1 });
    });

    it('CR 701.23b (public zone): "up to two creature cards" in a graveyard lets the player find fewer', () => {
      const { s, id } = onStack(s0, { name: SPELL });
      const out = runOn(s, id, prog([{ op: 'search', who: you, zone: 'graveyard', filter: { types: ['Creature'] }, max: 2, as: 'found' }]));
      expect(out.pending).toMatchObject({ kind: 'chooseObjects', min: 0, max: 1 });
    });
  });

  it('CR 400.2, 701.23b: your own hand is a hidden zone: a search of it for a stated quality may find nothing, and the public log does not name the card', () => {
    const withHand = board({ p1: { hand: ['Grizzly Bears'], library: ['Island'] } });
    const { s, id } = onStack(withHand, { name: SPELL });
    const program = prog([{ op: 'search', who: you, zone: 'hand', filter: { types: ['Creature'] }, max: 1, as: 'found' }]);
    expect(runOn(s, id, program).pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 0, max: 1 });
    const out = runOn(s, id, program, [{ kind: 'chooseObjects', ids: [hand(s, 'p1')[0]!] }]);
    expect(out.s.log.find((l) => l.rules?.includes('CR 701.23a'))!.text).toBe('Alice searches their hand and finds a card.');
  });

  it('CR 701.23a: the search event says whose zone was searched (an opponent\'s library), once per zone searched', () => {
    const { s, id } = onStack(s0, { name: SPELL, targets: [[{ kind: 'player', id: 'p2' }]] });
    const program = prog([{ op: 'search', who: you, owner: { ref: 'target', id: 't0' }, zone: 'library', filter: { types: ['Instant'] }, max: 1, as: 'found' }], [{ id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' }]);
    const out = runOn(s, id, program, [{ kind: 'chooseObjects', ids: [] }]);
    expect(out.events.filter((e) => e.type === 'actionPerformed')).toEqual([{ type: 'actionPerformed', verb: 'search', actor: 'p1', owner: 'p2', zone: 'library' }]);
  });

  it('CR 608.2b: when the owner is an illegal target no zone is searched, so there is no search event', () => {
    const gone = structuredClone(s0);
    gone.players[1]!.hasLost = true;
    const { s, id } = onStack(gone, { name: SPELL, targets: [[{ kind: 'player', id: 'p2' }]] });
    const program = prog([{ op: 'search', who: you, owner: { ref: 'target', id: 't0' }, zone: 'library', filter: { types: ['Instant'] }, max: 1, as: 'found' }], [{ id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' }]);
    const out = runOn(s, id, program);
    expect(out.pending).toBeNull();
    expect(out.events.filter((e) => e.type === 'actionPerformed')).toEqual([]);
  });

  it('CR 701.23a, 400.2: searching an opponent\'s library: their cards are shown to the searcher, not to the owner', () => {
    const { s, id } = onStack(s0, { name: SPELL, targets: [[{ kind: 'player', id: 'p2' }]] });
    const program = prog([{ op: 'search', who: you, owner: { ref: 'target', id: 't0' }, zone: 'library', filter: { types: ['Instant'] }, max: 1, as: 'found' }], [{ id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' }]);
    const first = runOn(s, id, program);
    const bolt = lib(s, 'p2')[1]!;
    expect(first.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', options: [bolt] });
    expect(visibleTo(first.s, 'p1', bolt)).toBe(true);
    expect(visibleTo(first.s, 'p2', bolt)).toBe(false);
  });
});

describe('shuffle (CR 701.24)', () => {
  it('CR 701.24a: the library is randomized by the game\'s generator (same seed, same order) and its cards stop being visible (CR 701.20d)', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const program = prog([{ op: 'search', who: you, zone: 'library', filter: { types: ['Creature'] }, max: 1, as: 'found' }, { op: 'shuffle', who: you }]);
    const a = runOn(s, id, program, [{ kind: 'chooseObjects', ids: [] }]);
    const b = runOn(s, id, program, [{ kind: 'chooseObjects', ids: [] }]);
    expect(lib(a.s, 'p1')).toEqual(lib(b.s, 'p1'));
    // The order of the cards changed (H1: compared by card, since every id is new).
    const order = (st: GameState) => lib(st, 'p1').map((c) => st.objects[c]!.cardId);
    expect(order(a.s)).not.toEqual(order(s));
    // The same cards (H1: under new object ids, so no card can be followed through the shuffle, CR 400.2).
    const cards = (st: GameState) => lib(st, 'p1').map((c) => `${st.objects[c]!.defId}:${st.objects[c]!.cardId}`).sort();
    expect(cards(a.s)).toEqual(cards(s));
    expect(lib(a.s, 'p1').filter((c) => lib(s, 'p1').includes(c))).toEqual([]);
    expect(lib(a.s, 'p1').some((c) => visibleTo(a.s, 'p1', c))).toBe(false);
    expect(a.events.filter((e) => e.type === 'shuffled')).toEqual([{ type: 'shuffled', player: 'p1' }]);
  });

  it('CR 701.24b: "search, shuffle, then put it on top": the found card ends up on top', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const bears = lib(s, 'p1')[3]!;
    const out = runOn(s, id, prog([
      { op: 'search', who: you, zone: 'library', filter: { types: ['Creature'] }, max: 1, as: 'found' },
      { op: 'shuffle', who: you },
      { op: 'move', what: { ref: 'bound', name: 'found' }, to: { zone: 'library', position: 'top' } },
    ]), [{ kind: 'chooseObjects', ids: [bears] }]);
    expect(names(out.s, lib(out.s, 'p1').slice(0, 1))).toEqual(['Grizzly Bears']);
    expect(hand(out.s, 'p1')).toEqual([]);
  });

  it('CR 701.24e: a library of zero cards is still shuffled', () => {
    const empty = board();
    empty.zones.library.p1 = [];
    const { s, id } = onStack(empty, { name: SPELL });
    expect(runOn(s, id, prog([{ op: 'shuffle', who: you }])).events).toEqual([{ type: 'shuffled', player: 'p1' }]);
  });
});
