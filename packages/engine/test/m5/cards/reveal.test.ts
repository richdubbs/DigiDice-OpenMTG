/**
 * WP13: reveal, look, piles (CR 701.20, 608.2d). Revealing shows cards to every player, looking to one player (hidden information, CR 400.2).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { viewFor, HIDDEN_DEF, type GameState, type ObjectId } from '../../../src/index';
import { scenario } from '../helpers';
import { performed, replacements } from './fakes';
import { hand, lib, names, onStack, prog, runOn, sorcery } from './harness';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fakes')).proposeModule() }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fakes')).manualModule() }));

afterEach(() => {
  replacements.length = 0;
  performed.length = 0;
});

const SPELL = 'Test Reveal Spell';
const s0 = scenario(['Island', 'Forest', 'Mountain', 'Grizzly Bears', 'Lightning Bolt'], {
  p1: { library: ['Island', 'Forest', 'Mountain'], hand: ['Lightning Bolt'] }, p2: { hand: ['Grizzly Bears'] }, defs: [sorcery(SPELL, prog([]))],
});
const you = { ref: 'you' } as const;
const top3 = { ref: 'topCards', player: you, count: 3 } as const;
const visibleTo = (s: GameState, p: string, id: ObjectId): boolean => viewFor(s, p).objects[id]!.defId !== HIDDEN_DEF;

describe('reveal (CR 701.20)', () => {
  it('CR 701.20a-b: revealed cards are shown to every player and stay where they are; the public log names them', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'reveal', who: you, what: top3, as: 'cards' }]));
    const cards = lib(s, 'p1').slice(0, 3);
    expect(lib(out.s, 'p1').slice(0, 3)).toEqual(cards); // 701.20b: nothing moved
    expect(cards.every((c) => visibleTo(out.s, 'p2', c))).toBe(true);
    expect(visibleTo(out.s, 'p2', lib(s, 'p1')[3]!)).toBe(false);
    expect(out.s.log.some((l) => l.text === 'Alice reveals Island, Forest, Mountain.' && !l.privateText)).toBe(true);
    expect(out.cx!.bindings.get('cards')!.objects).toEqual(cards.map((c) => ({ id: c, zone: 'library' })));
    expect(out.events.filter((e) => e.type === 'actionPerformed' && e.verb === 'reveal')).toHaveLength(3);
  });

  it('CR 701.20a: "target player reveals their hand"', () => {
    const { s, id } = onStack(s0, { name: SPELL, targets: [[{ kind: 'player', id: 'p2' }]] });
    const out = runOn(s, id, prog([{ op: 'reveal', who: { ref: 'target', id: 't0' }, what: { ref: 'each', filter: { zone: 'hand', owner: { ref: 'target', id: 't0' } } } }], [{ id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' }]));
    expect(visibleTo(out.s, 'p1', hand(s, 'p2')[0]!)).toBe(true);
    expect(out.s.log.some((l) => l.text === 'Bob reveals Grizzly Bears.')).toBe(true);
  });

  it('CR 701.20a, 701.20e: "reveal ... to [player]": only that player is shown the card; the log names it to them only', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'reveal', who: you, what: { ref: 'topCards', player: you, count: 1 }, to: { ref: 'anOpponent' } }]));
    const card = lib(s, 'p1')[0]!;
    expect(visibleTo(out.s, 'p2', card)).toBe(true);
    expect(visibleTo(out.s, 'p1', card)).toBe(false);
    const line = out.s.log.find((l) => l.rules?.includes('CR 701.20a'))!;
    expect(line.text).toBe('Alice reveals a card to Bob.');
    expect(line.privateText!.text).toBe('Alice reveals Island to Bob.');
  });

  it('CR 400.2, 701.20a: the revealer\'s view and the log agree: a library card shown to an opponent is named to the revealer only if the revealer sees it', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const fromLibrary = runOn(s, id, prog([{ op: 'reveal', who: you, what: { ref: 'topCards', player: you, count: 1 }, to: { ref: 'anOpponent' } }]));
    const card = lib(s, 'p1')[0]!;
    const line = fromLibrary.s.log.find((l) => l.rules?.includes('CR 701.20a'))!;
    expect(line.privateText!.players.includes('p1')).toBe(visibleTo(fromLibrary.s, 'p1', card));
    expect(line.privateText!.players).toEqual(['p2']);
    // a card from the revealer's own hand: the revealer always sees it (CR 402.3), so their log names it too
    const fromHand = runOn(s, id, prog([{ op: 'reveal', who: you, what: { ref: 'each', filter: { zone: 'hand', owner: 'you' } }, to: { ref: 'anOpponent' } }]));
    const bolt = hand(s, 'p1')[0]!;
    const handLine = fromHand.s.log.find((l) => l.rules?.includes('CR 701.20a'))!;
    expect(visibleTo(fromHand.s, 'p1', bolt)).toBe(true);
    expect([...handLine.privateText!.players].sort()).toEqual(['p1', 'p2']);
  });

  it('CR 701.20a: when each player reveals their own top card, each reveal event and log line names the player who revealed that card', () => {
    const both = scenario(['Island', 'Swamp'], { p1: { library: ['Island'] }, p2: { library: ['Swamp'] }, defs: [sorcery(SPELL, prog([]))] });
    const { s, id } = onStack(both, { name: SPELL });
    const each = { ref: 'each', who: 'player' } as const;
    const out = runOn(s, id, prog([{ op: 'reveal', who: each, what: { ref: 'topCards', player: each, count: 1 } }]));
    const reveals = out.events.filter((e) => e.type === 'actionPerformed' && e.verb === 'reveal');
    expect(reveals.map((e) => (e.type === 'actionPerformed' ? [e.actor, out.s.objects[e.objectId!]!.owner] : []))).toEqual([['p1', 'p1'], ['p2', 'p2']]);
    const lines = out.s.log.filter((l) => l.rules?.includes('CR 701.20a')).map((l) => l.text);
    expect(lines).toEqual(['Alice reveals Island.', 'Bob reveals Swamp.']);
  });

  it('CR 701.20d: a card revealed in a library stops being visible once that library is shuffled', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'reveal', who: you, what: top3 }, { op: 'shuffle', who: you }]));
    expect(lib(out.s, 'p1').some((c) => visibleTo(out.s, 'p2', c))).toBe(false);
  });
});

describe('look (CR 701.20e)', () => {
  it('CR 701.20e: looking shows the cards to the named player only; the public log gives only the number', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'look', who: you, at: { ref: 'topCards', player: you, count: 2 }, as: 'seen' }]));
    const [a, b, c] = lib(s, 'p1');
    expect([a, b].map((x) => visibleTo(out.s, 'p1', x!))).toEqual([true, true]);
    expect(visibleTo(out.s, 'p1', c!)).toBe(false);
    expect(visibleTo(out.s, 'p2', a!)).toBe(false);
    const line = out.s.log.find((l) => l.rules?.includes('CR 701.20e'))!;
    expect(line.text).toBe('Alice looks at 2 cards.');
    expect(line.privateText).toEqual({ players: ['p1'], text: 'Alice looks at Island, Forest.' });
    expect(out.results.get('seen')).toEqual({ performed: true, count: 2 });
  });

  it('CR 701.20e, 402.3: looking at an opponent\'s hand shows it to the looker; the owner always saw it', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, prog([{ op: 'look', who: you, at: { ref: 'each', filter: { zone: 'hand', owner: 'opponent' } } }]));
    const bears = hand(s, 'p2')[0]!;
    expect(visibleTo(out.s, 'p1', bears)).toBe(true);
    expect(out.s.objects[bears]!.revealedTo).toEqual(['p1']);
  });
});

describe('piles (CR 608.2d)', () => {
  const piles = prog([
    { op: 'reveal', who: you, what: top3, as: 'cards' },
    { op: 'piles', cards: { ref: 'bound', name: 'cards' }, separator: { ref: 'anOpponent' }, chooser: you, chosen: 'keep', other: 'rest' },
  ]);

  it('CR 608.2d: the separator divides the cards first, then the chooser picks a pile; both piles are bound', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const [island, forest, mountain] = lib(s, 'p1');
    const first = runOn(s, id, piles);
    expect(first.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2', min: 0, max: 3 });
    const second = runOn(s, id, piles, [{ kind: 'chooseObjects', ids: [mountain!] }]);
    expect(second.pending).toMatchObject({ kind: 'chooseOption', player: 'p1', options: [{ id: 'pile1', label: 'Pile 1: Mountain' }, { id: 'pile2', label: 'Pile 2: Island, Forest' }] });
    const out = runOn(s, id, piles, [{ kind: 'chooseObjects', ids: [mountain!] }, { kind: 'chooseOption', ids: ['pile2'] }]);
    expect(out.cx!.bindings.get('keep')!.objects.map((h) => h.id)).toEqual([island, forest]);
    expect(out.cx!.bindings.get('rest')!.objects.map((h) => h.id)).toEqual([mountain]);
    expect(out.s.log.some((l) => l.text === 'Bob separates 3 cards into two piles (Pile 1: Mountain; Pile 2: Island, Forest) and Alice chooses pile 2.')).toBe(true);
  });

  it('CR 608.2d: a pile may be empty', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const out = runOn(s, id, piles, [{ kind: 'chooseObjects', ids: [] }, { kind: 'chooseOption', ids: ['pile1'] }]);
    expect(out.cx!.bindings.get('keep')!.objects).toEqual([]);
    expect(out.cx!.bindings.get('rest')!.objects).toHaveLength(3);
  });

  it('CR 609.3: with no cards there is nothing to separate, and both names are bound to nothing', () => {
    const empty = scenario([], { defs: [sorcery(SPELL, prog([]))] });
    empty.zones.library.p1 = [];
    const { s, id } = onStack(empty, { name: SPELL });
    const out = runOn(s, id, piles);
    expect(out.pending).toBeNull();
    expect(out.cx!.bindings.get('keep')!.objects).toEqual([]);
    expect(out.cx!.bindings.get('rest')!.objects).toEqual([]);
  });

  it('CR 701.20e, 608.2d: cards nobody else saw are shown to the separator and the chooser, and the log names them to those two only', () => {
    const { s, id } = onStack(s0, { name: SPELL });
    const hidden = prog([{ op: 'piles', cards: top3, separator: { ref: 'anOpponent' }, chooser: you, chosen: 'keep', other: 'rest' }]);
    const first = runOn(s, id, hidden);
    expect(visibleTo(first.s, 'p2', lib(s, 'p1')[0]!)).toBe(true);
    const out = runOn(s, id, hidden, [{ kind: 'chooseObjects', ids: [] }, { kind: 'chooseOption', ids: ['pile2'] }]);
    const line = out.s.log.find((l) => l.rules?.includes('CR 608.2d'))!;
    expect(line.text).toBe('Bob separates 3 cards into piles of 0 and 3; Alice chooses pile 2.');
    expect(line.privateText!.players).toEqual(['p2', 'p1']);
    expect(names(out.s, out.cx!.bindings.get('keep')!.objects.map((h) => h.id))).toEqual(['Island', 'Forest', 'Mountain']);
  });
});
