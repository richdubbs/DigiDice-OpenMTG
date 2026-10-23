/**
 * FAST5 T71: "mill N cards, then take a card from among the milled cards", played through the engine with synthetic cards compiled by the game's default
 * compiler (wordings are invented, design 6.10).
 *
 *   CR 701.17a, 701.17c  mill: the top cards of the library go to the graveyard; only the cards just milled can be chosen "from among them", never a card
 *                        that was already in the graveyard
 *   CR 608.2d            "then put a creature card from among them into your hand" is not optional; "you may return ..." and "up to two" are
 *   CR 110.4, 400.7j     "permanent card" is a card of any of the six permanent types (an instant or sorcery is none)
 *   CR 401.5, 701.17a    "on top of your library": the chosen card is the next one drawn
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, pass, scenario, zoneNames } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

function settle(s0: GameState, answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Cast the named sorcery from p1's hand and let it resolve; the game stops at the first decision of the spell. */
const cast = (s0: GameState, name: string): GameState => settle(pass(pass(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }))));

const ELF = card('Test Elf', 'Creature — Elf', '', ['2', '2']);
const ROCK = card('Test Rock', 'Artifact', '');
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 1 damage to any target.');

describe('CR 701.17a, 701.17c, 608.2d: "Mill three cards, then put a creature card from among them into your hand."', () => {
  const BOUNTY = card('Test Bounty', 'Sorcery', 'Mill three cards, then put a creature card from among them into your hand.');
  it('is automated; exactly one of the milled creature cards is put into the hand (a creature card already in the graveyard is not offered)', () => {
    expect(full(BOUNTY)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Bounty'], graveyard: ['Test Elf'], library: ['Test Elf', 'Test Rock', 'Test Elf', 'Test Rock'] }, defs: [BOUNTY, ELF, ROCK] });
    const old = find(s0, 'Test Elf', 'graveyard', 'p1');
    const s = cast(s0, 'Test Bounty');
    expect(s.pending?.kind).toBe('chooseObjects');
    if (s.pending?.kind !== 'chooseObjects') return;
    expect(s.pending.min).toBe(1);
    expect(s.pending.max).toBe(1);
    expect(s.pending.options).toHaveLength(2);
    expect(s.pending.options).not.toContain(old);
    const done = settle(s, [{ kind: 'chooseObjects', ids: [s.pending.options[0]!] }]);
    expect(zoneNames(done, 'hand', 'p1')).toEqual(['Test Elf']);
    expect(zoneNames(done, 'graveyard', 'p1')).toHaveLength(4); // the old Elf, the two milled cards that stayed and the sorcery
  });
  it('no creature card among the milled cards: nothing is put into the hand', () => {
    const s0 = scenario([], { p1: { hand: ['Test Bounty'], library: ['Test Rock', 'Test Rock', 'Test Rock', 'Test Elf'] }, defs: [BOUNTY, ELF, ROCK] });
    const done = settle(cast(s0, 'Test Bounty'));
    expect(zoneNames(done, 'hand', 'p1')).toEqual([]);
  });
});

describe('CR 701.17a, 608.2d, 110.4: "Mill four cards, then you may return a permanent card from among them to your hand." (an instant is no permanent card)', () => {
  const TILL = card('Test Tilling', 'Instant', 'Mill four cards, then you may return a permanent card from among them to your hand.');
  const game = (): GameState => scenario([], { p1: { hand: ['Test Tilling'], library: ['Test Bolt', 'Test Rock', 'Test Bolt', 'Test Elf', 'Test Bolt'] }, defs: [TILL, ELF, ROCK, BOLT] });
  it('offers only the milled permanent cards, at most one, and you may decline', () => {
    expect(full(TILL)).toBe(true);
    const s = cast(game(), 'Test Tilling');
    expect(s.pending?.kind).toBe('chooseObjects');
    if (s.pending?.kind !== 'chooseObjects') return;
    expect(s.pending.min).toBe(0);
    expect(s.pending.max).toBe(1);
    expect(s.pending.options).toHaveLength(2); // the Rock and the Elf; the three Bolts are instants
    const taken = settle(s, [{ kind: 'chooseObjects', ids: [s.pending.options[0]!] }]);
    expect(zoneNames(taken, 'hand', 'p1')).toHaveLength(1);
    const declined = settle(s, [{ kind: 'chooseObjects', ids: [] }]);
    expect(zoneNames(declined, 'hand', 'p1')).toEqual([]);
  });
});

describe('CR 701.17a, 608.2d: "Mill five cards, then return up to two permanent cards from among them to your hand."', () => {
  const GROW = card('Test Greenery', 'Instant', 'Mill five cards, then return up to two permanent cards from among them to your hand.');
  it('two of the milled permanent cards go to the hand; at most two can be chosen', () => {
    expect(full(GROW)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Greenery'], library: ['Test Elf', 'Test Rock', 'Test Elf', 'Test Bolt', 'Test Rock', 'Test Elf'] }, defs: [GROW, ELF, ROCK, BOLT] });
    const s = cast(s0, 'Test Greenery');
    expect(s.pending?.kind).toBe('chooseObjects');
    if (s.pending?.kind !== 'chooseObjects') return;
    expect(s.pending.max).toBe(2);
    expect(s.pending.options).toHaveLength(4);
    const done = settle(s, [{ kind: 'chooseObjects', ids: s.pending.options.slice(0, 2) }]);
    expect(zoneNames(done, 'hand', 'p1')).toHaveLength(2);
  });
});

describe('CR 701.17a, 401.5: "Mill four cards, then you may put a creature or land card from among the milled cards on top of your library."', () => {
  const NATURE = card('Test Naturalist', 'Instant', 'Mill four cards, then you may put a creature or land card from among the milled cards on top of your library.');
  it('the chosen milled card is the top card of the library afterwards', () => {
    expect(full(NATURE)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Naturalist'], library: ['Test Rock', 'Test Elf', 'Plains', 'Test Rock', 'Test Rock'] }, defs: [NATURE, ELF, ROCK] });
    const s = cast(s0, 'Test Naturalist');
    expect(s.pending?.kind).toBe('chooseObjects');
    if (s.pending?.kind !== 'chooseObjects') return;
    expect(s.pending.options).toHaveLength(2); // the Elf and the Plains
    const pick = s.pending.options[0]!;
    const picked = s.objects[pick]!.defId;
    const done = settle(s, [{ kind: 'chooseObjects', ids: [pick] }]);
    const top = done.zones.library['p1']![0]!;
    expect(done.objects[top]!.defId).toBe(picked);
    expect(done.zones.graveyard['p1']).not.toContain(pick);
  });
});
