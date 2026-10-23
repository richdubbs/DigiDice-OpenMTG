/**
 * WP13 against WP2 (design 15.2, "renderers' acceptance"): for every form of the family's ops whose meaning depends on optional fields, the canonical text the
 * renderer prints (what the parser gate matches against the Oracle text) and what the handler does must agree. A JSON that renders "up to two" must not make
 * the player find two.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAbility, viewFor, HIDDEN_DEF, type AbilityDef, type EffectProgram, type EffectStep, type GameState, type ObjectId, type TargetSpec } from '../../../src/index';
import { scenario } from '../helpers';
import { performed, replacements } from './fakes';
import { lib, onStack, prog, runOn, sorcery } from './harness';

vi.mock('../../../src/effects/propose', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fakes')).proposeModule() }));
vi.mock('../../../src/effects/manual', async (importOriginal) => ({ ...(await importOriginal<object>()), ...(await import('./fakes')).manualModule() }));

afterEach(() => {
  replacements.length = 0;
  performed.length = 0;
});

const SPELL = 'Test Agreement Spell';
const ctx = { selfNames: [SPELL], selfTypes: ['Sorcery'] };
const you = { ref: 'you' } as const;
const t0 = { ref: 'target', id: 't0' } as const;
const targetPlayer: TargetSpec = { id: 't0', kind: 'player', min: 1, max: 1, text: 'target player' };
const s0 = scenario(['Island', 'Forest', 'Mountain', 'Grizzly Bears', 'Lightning Bolt', 'Swamp'], {
  p1: { library: ['Island', 'Forest', 'Mountain', 'Grizzly Bears'], hand: ['Lightning Bolt', 'Swamp'] },
  p2: { library: ['Swamp', 'Lightning Bolt'], hand: ['Grizzly Bears', 'Island'] },
  defs: [sorcery(SPELL, prog([]))],
});
const visibleTo = (s: GameState, p: string, id: ObjectId): boolean => viewFor(s, p).objects[id]!.defId !== HIDDEN_DEF;
const text = (program: EffectProgram): string => renderAbility({ kind: 'spell', text: '', effect: program } as AbilityDef, ctx).join(' ');
const run = (program: EffectProgram, opts: { x?: number; targets?: boolean } = {}) => {
  const { s, id } = onStack(s0, { name: SPELL, ...(opts.x !== undefined ? { x: opts.x } : {}), ...(opts.targets ? { targets: [[{ kind: 'player', id: 'p2' }]] } : {}) });
  return { s, id, first: runOn(s, id, program) };
};

describe('search (CR 701.23): min and max', () => {
  const search = (extra: Partial<Extract<EffectStep, { op: 'search' }>>): EffectProgram =>
    prog([{ op: 'search', who: you, zone: 'library', filter: { zone: 'library' }, max: 1, as: 'found', ...extra } as EffectStep]);

  it.each([
    ['CR 701.23d: max 1, no min', {}, 'Search your library for a card.', 1, 1],
    ['CR 701.23d: max 3, no min', { max: 3 }, 'Search your library for up to three cards.', 0, 3],
    ['CR 701.23d: max any, no min', { max: 'any' as const }, 'Search your library for any number of cards.', 0, lib(s0, 'p1').length],
    ['CR 701.23d: min 2, max 2', { min: 2, max: 2 }, 'Search your library for two cards.', 2, 2],
    ['CR 701.23b: a stated quality in a hidden zone, min 1, max 1', { filter: { zone: 'library' as const, types: ['Land'], supertypes: ['Basic'] }, min: 1, max: 1 }, 'Search your library for a basic land card.', 0, 1],
  ])('%s: the text and the decision agree', (_name, extra, want, min, max) => {
    const program = search(extra);
    expect(text(program)).toBe(want);
    expect(run(program).first.pending).toMatchObject({ kind: 'chooseObjects', min, max });
  });

  it('CR 107.3, 701.23d: max X, no min: "up to X cards" and the player may find fewer than X', () => {
    const program = search({ max: { q: 'X' } });
    expect(text(program)).toContain('up to X cards');
    expect(run(program, { x: 2 }).first.pending).toMatchObject({ kind: 'chooseObjects', min: 0, max: 2 });
  });

  it('CR 701.23b: "up to two creature cards" in a graveyard (public zone) lets the player find fewer', () => {
    const program = prog([{ op: 'search', who: you, zone: 'graveyard', filter: { zone: 'graveyard', types: ['Creature'] }, max: 2, as: 'found' }]);
    expect(text(program)).toBe('Search your graveyard for up to two creature cards.');
    const withYard = scenario(['Grizzly Bears', 'Llanowar Elves'], { p1: { graveyard: ['Grizzly Bears', 'Llanowar Elves'] }, defs: [sorcery(SPELL, prog([]))] });
    const { s: st, id } = onStack(withYard, { name: SPELL });
    expect(runOn(st, id, program).pending).toMatchObject({ kind: 'chooseObjects', min: 0, max: 2 });
  });

  it('CR 701.23a: "owner": the text names whose library and the handler searches that library', () => {
    const program = prog([{ op: 'search', who: you, owner: t0, zone: 'library', filter: { zone: 'library' }, max: 1, as: 'found' }], [targetPlayer]);
    expect(text(program)).toBe("Search target player's library for a card.");
    const { s, first } = run(program, { targets: true });
    expect(first.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', options: lib(s, 'p2') });
  });

  it('CR 701.20a, 701.23e: "reveal it" is printed only when the handler shows the found card to everybody', () => {
    const quiet = search({ filter: { zone: 'library', types: ['Creature'] } });
    const loud = search({ filter: { zone: 'library', types: ['Creature'] }, reveal: true });
    expect(text(quiet)).toBe('Search your library for a creature card.');
    expect(text(loud)).toBe('Search your library for a creature card, reveal it.');
    const { s, id } = onStack(s0, { name: SPELL });
    const bears = lib(s, 'p1')[3]!;
    const pick = [{ kind: 'chooseObjects' as const, ids: [bears] }];
    expect(visibleTo(runOn(s, id, quiet, pick).s, 'p2', bears)).toBe(false);
    expect(visibleTo(runOn(s, id, loud, pick).s, 'p2', bears)).toBe(true);
  });
});

describe('discard (CR 701.9b): mode', () => {
  const discard = (mode?: 'random' | 'opponentChooses'): EffectProgram =>
    prog([{ op: 'discard', who: t0, count: 1, ...(mode ? { mode } : {}) }], [targetPlayer]);

  it('CR 701.9b: no mode: the discarding player chooses', () => {
    expect(text(discard())).toBe('Target player discards a card.');
    expect(run(discard(), { targets: true }).first.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2' });
  });

  it('CR 701.9b: "at random": nobody chooses', () => {
    expect(text(discard('random'))).toBe('Target player discards a card at random.');
    const { first } = run(discard('random'), { targets: true });
    expect(first.pending).toBeNull();
    expect(first.events.filter((e) => e.type === 'zoneChanged')).toHaveLength(1);
  });

  it('CR 701.9b: "of your choice": the controller chooses', () => {
    expect(text(discard('opponentChooses'))).toBe('Target player discards a card of your choice.');
    expect(run(discard('opponentChooses'), { targets: true }).first.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1' });
  });
});

describe('reveal (CR 701.20a): to', () => {
  it('CR 701.20a: no `to`: revealed to every player', () => {
    const program = prog([{ op: 'reveal', who: you, what: { ref: 'topCards', player: you, count: 1 } }]);
    expect(text(program)).toBe('Reveal the top card of your library.');
    const { s, first } = run(program);
    expect(visibleTo(first.s, 'p2', lib(s, 'p1')[0]!)).toBe(true);
  });

  it('CR 701.20a, 701.20e: "to target player": shown to that player only', () => {
    const program = prog([{ op: 'reveal', who: you, what: { ref: 'topCards', player: you, count: 1 }, to: t0 }], [targetPlayer]);
    expect(text(program)).toBe('Reveal the top card of your library to target player.');
    const { s, first } = run(program, { targets: true });
    expect(visibleTo(first.s, 'p2', lib(s, 'p1')[0]!)).toBe(true);
    expect(visibleTo(first.s, 'p1', lib(s, 'p1')[0]!)).toBe(false);
  });
});

describe('piles (CR 608.2d): separator and chooser', () => {
  it('CR 608.2d: the player the text names as separating separates, and the one it names as choosing chooses', () => {
    const program = prog([
      { op: 'reveal', who: you, what: { ref: 'topCards', player: you, count: 3 }, as: 'cards' },
      { op: 'piles', cards: { ref: 'bound', name: 'cards' }, separator: t0, chooser: you, chosen: 'keep', other: 'rest' },
    ], [targetPlayer]);
    const words = text(program);
    expect(words).toContain('Target player separates');
    expect(words).toContain('two piles');
    const { s, id, first } = run(program, { targets: true });
    expect(first.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2' });
    expect(runOn(s, id, program, [{ kind: 'chooseObjects', ids: [] }]).pending).toMatchObject({ kind: 'chooseOption', player: 'p1' });
  });
});

describe('addMana (CR 106.6): restriction', () => {
  it('CR 106.6: "Spend this mana only to cast creature spells" is printed exactly when the unit carries the restriction', () => {
    const restricted = prog([{ op: 'addMana', who: you, units: [['G']], restriction: { spells: { types: ['Creature'] } } }]);
    const plain = prog([{ op: 'addMana', who: you, units: [['G']] }]);
    expect(text(restricted)).toBe('Add {G}. Spend this mana only to cast a creature spell.');
    expect(text(plain)).toBe('Add {G}.');
    expect(run(restricted).first.s.players[0]!.manaPool[0]!.restriction).toEqual({ spells: { types: ['Creature'] } });
    expect(run(plain).first.s.players[0]!.manaPool[0]!.restriction).toBeUndefined();
  });
});
