/**
 * Third pass top-rank-t5, edh-next-117 (code edhn117): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names, design 6.10).
 * Each test is named after the rule it checks, with its negative case. CR cites are from memory of the 2026-09-25 text unless the record says it checked them.
 *
 *   CR 601.2i, 702.51a, 700.6   "The first historic spell you cast each turn has convoke." (Peri Brown)
 *   CR 702.29a, 602.2b, 118.9   "You may pay {0} rather than pay the cycling cost of the first card you cycle each turn." (Gavi, Nest Warden)
 *   CR 701.20a, 118.9, 402.1    "If you have no land cards in hand, you may reveal your hand rather than pay this spell's mana cost." (Land Grant)
 *   CR 401.7, 400.3             "Target nonland permanent's owner puts it into their library second from the top or on the bottom." (Wan Shi Tong, All-Knowing)
 *   CR 701.23a, 201.2, 202.3    "Search your library for up to X creature cards with different names that each have mana value X, ..." (Uncage the Menagerie)
 *   CR 400.3, 603.3d           "you may put two cards your opponents own from exile into their owners' graveyards. If you do, ..." (Ulamog's Nullifier)
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { act, answer, card, cast, drive, find, full, legal, obj, passBoth, resolveAll, scenario } from '../r4-cost/support';

const handNames = (s: GameState, p: 'p1' | 'p2' = 'p1'): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.defId);
const zoneOf = (s: GameState, name: string): string => s.objects[Object.keys(s.objects).find((id) => s.objects[id]!.defId === name)!]!.zone;

// ---- Peri Brown ----------------------------------------------------------------------------------------------------------------------------------------
describe('CR 601.2i, 702.51a, 700.6: "The first historic spell you cast each turn has convoke."', () => {
  const PERI = card('Test Peri', 'Creature — Human', 'The first historic spell you cast each turn has convoke.', '{1}', ['1', '1']);
  const ELDER = card('Test Elder', 'Legendary Creature — Elf', '', '{0}', ['2', '2']);
  const ELDER2 = card('Test Elder Two', 'Legendary Creature — Elf', '', '{2}', ['2', '2']);
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', '{2}', ['2', '2']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{2}', ['2', '2']);
  const FOOT = card('Test Footman', 'Creature — Soldier', '', '{0}', ['1', '1']);
  const defs = [PERI, ELDER, ELDER2, GOLEM, OGRE, FOOT];
  const canCast = (s: GameState, name: string): boolean => legal(s, 'p1', 'cast').some((x) => x.object === find(s, name, 'hand', 'p1'));
  it('negative (fail closed): a first spell described by a field the cast history cannot answer (flying) stays out of full automation', () => {
    expect(full(card('Test Peri Two', 'Creature — Human', 'The first spell with flying you cast each turn has convoke.', '{1}', ['1', '1']))).toBe(false);
  });
  it('is full (the convoke template is stable)', () => { expect(full(PERI), JSON.stringify(PERI.automation)).toBe(true); expect(PERI.automation.level).toBe('full'); });
  it('the first historic spell (a legendary creature, an artifact creature) can be paid by tapping creatures', () => {
    const s = scenario([], { defs, p1: { hand: ['Test Elder Two', 'Test Golem'], battlefield: ['Test Peri', 'Test Footman', 'Test Footman'] } });
    expect(canCast(s, 'Test Elder Two')).toBe(true);
    expect(canCast(s, 'Test Golem')).toBe(true);
  });
  it('negative: a spell that is not historic (a plain creature) gets no convoke, and neither does the second historic spell of the turn', () => {
    const s = scenario([], { defs, p1: { hand: ['Test Ogre', 'Test Elder', 'Test Golem'], battlefield: ['Test Peri', 'Test Footman', 'Test Footman'] } });
    expect(canCast(s, 'Test Ogre')).toBe(false);
    const after = resolveAll(cast(s, 'Test Elder'));
    expect(canCast(after, 'Test Golem')).toBe(false); // the Elder (cost {0}) was the first historic spell: no convoke for the Golem, and there is no mana
  });
});

// ---- Gavi, Nest Warden ---------------------------------------------------------------------------------------------------------------------------------
describe('CR 702.29a, 602.2b, 118.9: "You may pay {0} rather than pay the cycling cost of the first card you cycle each turn."', () => {
  const GAVI = card('Test Gavi', 'Creature — Cat', 'You may pay {0} rather than pay the cycling cost of the first card you cycle each turn.', '{1}', ['2', '2']);
  const NOTE = card('Test Cycler', 'Sorcery', 'Cycling {3}\nYou gain 1 life.', '{5}');
  const NOTE2 = card('Test Cycler Two', 'Sorcery', 'Cycling {3}\nYou gain 2 life.', '{5}');
  const defs = [GAVI, NOTE, NOTE2];
  const cycleOffers = (s: GameState): number => legal(s, 'p1', 'activate').filter((x) => ['Test Cycler', 'Test Cycler Two'].some((n) => x.object === find(s, n, 'hand', 'p1'))).length;
  const cycle = (s: GameState, name: string): GameState => {
    const a = legal(s, 'p1', 'activate').find((x) => x.object === find(s, name, 'hand', 'p1'));
    if (a === undefined) throw new Error('cycling not offered');
    return resolveAll(drive(act(s, a.action)));
  };
  it('is full', () => expect(full(GAVI), JSON.stringify(GAVI.automation)).toBe(true));
  it('the first card cycled each turn costs nothing (no mana available), the second one does not', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Cycler', 'Test Cycler Two'], battlefield: ['Test Gavi'] } });
    expect(cycleOffers(s0)).toBe(2); // free with no mana at all
    const s1 = cycle(s0, 'Test Cycler');
    expect(zoneOf(s1, 'Test Cycler')).toBe('graveyard');
    expect(handNames(s1)).toContain('Test Cycler Two');
    expect(cycleOffers(s1)).toBe(0); // the second card needs {3}: no mana
  });
  it('negative: without the static ability a cycling cost with no mana cannot be paid', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Cycler'], battlefield: [] } });
    expect(cycleOffers(s0)).toBe(0);
  });
});

// ---- Land Grant ----------------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.20a, 118.9, 402.1: "If you have no land cards in hand, you may reveal your hand rather than pay this spell\'s mana cost."', () => {
  const GRANT = card('Test Grant', 'Sorcery', "If you have no land cards in hand, you may reveal your hand rather than pay this spell's mana cost.\nYou gain 3 life.", '{1}{G}', undefined, ['G']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{2}', ['2', '2']);
  const FOREST = card('Test Forest', 'Basic Land — Forest', '');
  const defs = [GRANT, BEAR, FOREST];
  const castable = (s: GameState): boolean => legal(s, 'p1', 'cast').some((x) => x.object === find(s, 'Test Grant', 'hand', 'p1'));
  it('is full', () => expect(full(GRANT), JSON.stringify(GRANT.automation)).toBe(true));
  it('with no land card in hand the spell can be cast for free by revealing the hand', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Grant', 'Test Bear'] } });
    expect(castable(s0)).toBe(true);
    const s1 = resolveAll(cast(s0, 'Test Grant', {}, 'p1', 'alternative'));
    expect(s1.players.find((p) => p.id === 'p1')!.life).toBe(23);
    expect(zoneOf(s1, 'Test Grant')).toBe('graveyard');
    expect(handNames(s1)).toEqual(['Test Bear']); // revealing costs no card
  });
  it('negative: with a land card in hand the free cast is not available', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Grant', 'Test Forest'] } });
    expect(castable(s0)).toBe(false);
  });
});

// ---- Wan Shi Tong ----------------------------------------------------------------------------------------------------------------------------------------
describe('CR 401.7, 400.3: "When ~ enters, target nonland permanent\'s owner puts it into their library second from the top or on the bottom."', () => {
  const OWL = card('Test Owl', 'Creature — Bird', "When ~ enters, target nonland permanent's owner puts it into their library second from the top or on the bottom.", '{0}', ['1', '1']);
  const ROCK = card('Test Idol', 'Artifact', '', '{0}');
  const defs = [OWL, ROCK];
  const setup = (): GameState => scenario([], { defs, p1: { hand: ['Test Owl'] }, p2: { battlefield: ['Test Idol'] } });
  /** Casts the Owl (the trigger targets the rock) and lets the player the decision names pick the option whose label says `place`; the owner must be the one asked. */
  const resolveOwner = (s0: GameState, rock: string, place: string): GameState => {
    let s = cast(s0, 'Test Owl');
    for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) {
      s = passBoth(s);
      for (let g = 0; g < 8 && s.pending !== null && s.pending.kind !== 'priority'; g++) {
        const p = s.pending;
        if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [obj(rock)] });
        else if (p.kind === 'chooseOption') {
          expect(p.player).toBe('p2'); // the owner chooses, not the controller of the trigger
          s = answer(s, { kind: 'chooseOption', ids: [p.options.find((o) => o.label.includes(place))!.id] });
        } else s = drive(s);
      }
    }
    return s;
  };
  const libOf = (s: GameState): string[] => s.zones.library.p2!.map((id) => s.objects[id]!.defId);
  it('is full', () => expect(full(OWL), JSON.stringify(OWL.automation)).toBe(true));
  it('the owner (the opponent) chooses: second from the top', () => {
    const s0 = setup();
    const rock = find(s0, 'Test Idol', 'battlefield', 'p2');
    const s = resolveOwner(s0, rock, 'second from the top');
    expect(libOf(s).indexOf('Test Idol')).toBe(1); // second from the top: one card above it
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Idol')).toBe(false);
  });
  it('the owner chooses the bottom', () => {
    const s0 = setup();
    const rock = find(s0, 'Test Idol', 'battlefield', 'p2');
    const s = resolveOwner(s0, rock, 'bottom');
    expect(libOf(s).at(-1)).toBe('Test Idol');
    expect(libOf(s).indexOf('Test Idol')).toBe(libOf(s).length - 1);
  });
});

// ---- Ulamog's Nullifier ----------------------------------------------------------------------------------------------------------------------------------
describe("CR 400.3, 608.2c: \"When ~ enters, you may put two cards your opponents own from exile into their owners' graveyards. If you do, gain 4 life.\"", () => {
  const PROC = card('Test Processor', 'Creature — Eldrazi', "When ~ enters, you may put two cards your opponents own from exile into their owners' graveyards. If you do, you gain 4 life.", '{0}', ['2', '2']);
  const JUNK = card('Test Junk', 'Artifact', '');
  const defs = [PROC, JUNK];
  const life = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.life;
  it('is full', () => expect(full(PROC), JSON.stringify(PROC.automation)).toBe(true));
  it('with two opponent cards in exile it puts them into their owners\' graveyards and then you gain life', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Processor'] }, p2: { exile: ['Test Junk', 'Test Junk', 'Test Junk'] } });
    const s = resolveAll(cast(s0, 'Test Processor'), { yes: [true] });
    expect(s.zones.graveyard.p2!.length).toBe(2);
    expect(life(s)).toBe(24);
  });
  it('negative: declining does nothing; with only one such card in exile nothing is put and no life is gained', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Processor'] }, p2: { exile: ['Test Junk', 'Test Junk'] } });
    const declined = resolveAll(cast(s0, 'Test Processor'), { yes: [false] });
    expect(declined.zones.graveyard.p2!.length).toBe(0);
    expect(life(declined)).toBe(20);
    const one = scenario([], { defs, p1: { hand: ['Test Processor'] }, p2: { exile: ['Test Junk'] } });
    const s = resolveAll(cast(one, 'Test Processor'), { yes: [true] });
    expect(s.zones.graveyard.p2!.length).toBe(0);
    expect(life(s)).toBe(20);
  });
});

// ---- Uncage the Menagerie --------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.23a, 201.2, 202.3, 107.3: "Search your library for up to X creature cards with different names that each have mana value X, reveal them, put them into your hand, then shuffle."', () => {
  const UNCAGE = card('Test Uncage', 'Sorcery', 'Search your library for up to X creature cards with different names that each have mana value X, reveal them, put them into your hand, then shuffle.', '{X}{G}{G}', undefined, ['G']);
  const ELF = card('Test Elf', 'Creature — Elf', '', '{1}{G}', ['1', '1']);
  const IMP = card('Test Imp', 'Creature — Imp', '', '{1}{B}', ['1', '1']);
  const GIANT = card('Test Giant', 'Creature — Giant', '', '{2}{R}', ['3', '3']);
  const defs = [UNCAGE, ELF, IMP, GIANT];
  const board = (): GameState => scenario(['Forest'], { defs, p1: { hand: ['Test Uncage'], battlefield: ['Forest', 'Forest', 'Forest', 'Forest'], library: ['Test Elf', 'Test Elf', 'Test Imp', 'Test Giant'] } });
  const idsIn = (s: GameState, name: string): string[] => s.zones.library.p1!.filter((id) => s.objects[id]!.defId === name);
  const handNow = (s: GameState): string[] => s.zones.hand.p1!.map((id) => s.objects[id]!.defId).sort();
  it('is full', () => expect(full(UNCAGE), JSON.stringify(UNCAGE.automation)).toBe(true));
  it('X = 2: two creature cards of mana value 2 with different names go to the hand', () => {
    const s0 = board();
    const s = resolveAll(cast(s0, 'Test Uncage', { x: [2] }), { objects: [[idsIn(s0, 'Test Elf')[0]!], [idsIn(s0, 'Test Imp')[0]!]] }); // the search asks for one card at a time
    expect(handNow(s)).toEqual(['Test Elf', 'Test Imp']);
  });
  it('negative: two cards with the same name, or a card of another mana value, cannot be chosen', () => {
    const s0 = board();
    const s1 = cast(s0, 'Test Uncage', { x: [2] });
    // the search is answered at resolution: pass until it asks
    let s = s1;
    for (let i = 0; i < 6 && (s.pending === null || s.pending.kind === 'priority'); i++) s = passBoth(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    const pend = s.pending as { id: string; options: string[] };
    expect(pend.options).not.toContain(idsIn(s0, 'Test Giant')[0]); // mana value 3 is not X
    expect(pend.options).toHaveLength(3); // two Elves and the Imp: all of mana value 2
    const first = answer(s, { kind: 'chooseObjects', ids: [idsIn(s0, 'Test Elf')[0]!] });
    const next = first.pending as { options: string[] } | null;
    expect(next?.options).toContain(idsIn(s0, 'Test Imp')[0]); // after an Elf only a card of another name can follow
    expect(next?.options).not.toContain(idsIn(s0, 'Test Elf')[1]); // the second Elf shares the name
  });
});

// ---- Blight Herder (a cast trigger that uses the same step) ---------------------------------------------------------------------------------------------
describe("CR 603.2, 112.1, 400.3: \"When you cast this spell, you may put two cards your opponents own from exile into their owners' graveyards. If you do, create three 1/1 ... tokens.\"", () => {
  const HERDER = card('Test Herder', 'Creature — Eldrazi', "When you cast this spell, you may put two cards your opponents own from exile into their owners' graveyards. If you do, create three 1/1 colorless Eldrazi Scion creature tokens. They have \"Sacrifice this token: Add {C}.\"", '{0}', ['5', '4']);
  const JUNK = card('Test Junk', 'Artifact', '');
  const tokens = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length;
  it('is full', () => expect(full(HERDER), JSON.stringify(HERDER.automation)).toBe(true));
  it('with two opponent cards in exile and a yes: two cards go to graveyards and three tokens are created', () => {
    const s0 = scenario([], { defs: [HERDER, JUNK], p1: { hand: ['Test Herder'] }, p2: { exile: ['Test Junk', 'Test Junk'] } });
    const s = resolveAll(cast(s0, 'Test Herder'), { yes: [true] });
    expect(s.zones.graveyard.p2!.length).toBe(2);
    expect(tokens(s)).toBe(3);
  });
  it('negative: with one card in exile (or a no) no card moves and no token is created', () => {
    const one = scenario([], { defs: [HERDER, JUNK], p1: { hand: ['Test Herder'] }, p2: { exile: ['Test Junk'] } });
    expect(tokens(resolveAll(cast(one, 'Test Herder'), { yes: [true] }))).toBe(0);
    const two = scenario([], { defs: [HERDER, JUNK], p1: { hand: ['Test Herder'] }, p2: { exile: ['Test Junk', 'Test Junk'] } });
    expect(tokens(resolveAll(cast(two, 'Test Herder'), { yes: [false] }))).toBe(0);
  });
});
