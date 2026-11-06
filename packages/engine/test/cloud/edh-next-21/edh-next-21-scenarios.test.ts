/**
 * Commander lane edh-next, round edh-next-21: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case.
 *
 *   CR 400.3, 404.1       "You may put a land card from your graveyard on top of your library." (Glowspore Shaman, Sequestered Stash)
 *   CR 504.1, 303.4       "At the beginning of the draw step of enchanted creature's controller, that player draws an additional card." (Righteous Authority)
 *   CR 122.1f, 701.9a     "Each opponent who has three or more poison counters loses 3 life." / "... discards a card for each poison counter they have." (Feed the Infection, Whispering Specter)
 *   CR 120.3, 608.2d      "You may have ~ deal 1 damage to itself." (Vrondiss, Rage of Ancients)
 *   CR 401.7, 400.7       "Put it into your library third from the top." (Enigma Sphinx)
 *   CR 109.4, 614.1c      "Enters with a number of counters equal to the greatest number of creatures a player controls." (Investigator's Journal)
 *   CR 611.2a, 613.1b     "You gain control of all enchantments." (Aura Thief)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { controllerOf } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const settle = (t: GameState): GameState => {
  let s = t;
  for (let g = 0; g < 20 && s.pending && s.pending.kind === 'payCost'; g++) s = answer(s, { kind: 'payCost', auto: true });
  return s;
};
const resolveAll = (s0: GameState, yes = true, pick = 0): GameState => {
  let s = settle(s0);
  for (let g = 0; g < 40 && s.pending !== null && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); g++) {
    const d = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number };
    if (d.kind === 'priority') s = settle(pass(s));
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes } as DecisionAnswer);
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d.options ?? []).slice(pick, pick + Math.max(1, d.min ?? 1)) } as DecisionAnswer);
    else s = settle(s);
  }
  return s;
};
type Tgt = ObjectId | { player: 'p1' | 'p2' };
const cast = (s: GameState, name: string, targets: Tgt[] = [], yes = true, pick = 0): GameState => {
  let t = settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') } as never));
  if (t.pending?.kind === 'chooseTargets') t = settle(answer(t, { kind: 'chooseTargets', targets: targets.map((t) => (typeof t === 'string' ? { kind: 'object' as const, id: t } : { kind: 'player' as const, id: t.player })) } as DecisionAnswer));
  return resolveAll(t, yes, pick);
};
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id)!.name;
const lib = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.library[p]!.map((id) => nameOf(s, id));
const gy = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.graveyard[p]!.map((id) => nameOf(s, id));
const hand = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;
const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;

const LAND = card('Test Moor', 'Land', '');
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });

describe('CR 400.3, 404.1: "You may put a land card from your graveyard on top of your library."', () => {
  const DIGGER = card('Test Digger', 'Creature — Elf', 'When this creature enters, you may put a land card from your graveyard on top of your library.', { pt: ['1', '1'] });
  const setup = (gyCards: string[]): GameState => scenario([], { defs: [DIGGER, LAND, BEAR], p1: { hand: ['Test Digger'], graveyard: gyCards } });
  it('is automated', () => { expect(noManual(DIGGER)).toEqual([]); });
  it('puts the chosen land card of your graveyard on top of your library, and no other card', () => {
    const s = cast(setup(['Test Bear', 'Test Moor']), 'Test Digger');
    expect(lib(s, 'p1')[0]).toBe('Test Moor');
    expect(gy(s, 'p1')).toEqual(['Test Bear']);
  });
  it('does nothing when you decline, or when the graveyard has no land card', () => {
    const declined = cast(setup(['Test Moor']), 'Test Digger', [], false);
    expect(lib(declined, 'p1')[0]).toBe('Plains');
    expect(gy(declined, 'p1')).toEqual(['Test Moor']);
    const none = cast(setup(['Test Bear']), 'Test Digger');
    expect(lib(none, 'p1')[0]).toBe('Plains');
    expect(gy(none, 'p1')).toEqual(['Test Bear']);
  });
  it("does not take a card from the opponent's graveyard", () => {
    const s0 = scenario([], { defs: [DIGGER, LAND], p1: { hand: ['Test Digger'] }, p2: { graveyard: ['Test Moor'] } });
    const s = cast(s0, 'Test Digger');
    expect(gy(s, 'p2')).toEqual(['Test Moor']);
    expect(lib(s, 'p1')[0]).toBe('Plains');
  });
});

describe('CR 504.1, 303.4, 121.1: "At the beginning of the draw step of enchanted creature\'s controller, that player draws an additional card."', () => {
  const AURA = card('Test Boon', 'Enchantment — Aura', 'Enchant creature\nAt the beginning of the draw step of enchanted creature\'s controller, that player draws an additional card.');
  it('is automated', () => { expect(noManual(AURA)).toEqual([]); });
  it("the controller of the enchanted creature draws a second card in their own draw step; the Aura's owner does not", () => {
    let s = scenario([], { defs: [AURA, BEAR], p1: { hand: ['Test Boon'] }, p2: { battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Boon', [find(s, 'Test Bear', 'battlefield', 'p2')]);
    expect(findAll(s, 'Test Boon', 'battlefield').length).toBe(1);
    const p1Hand = hand(s, 'p1');
    const p2Hand = hand(s, 'p2');
    // turn 2 is Bob's: the draw step draws one card, the trigger one more
    s = advanceTo(s, 2, 'draw');
    s = resolveAll(s);
    expect(hand(s, 'p2')).toBe(p2Hand + 2);
    // turn 3 is Alice's own: her draw step is not the enchanted creature's controller's
    s = advanceTo(s, 3, 'draw');
    s = resolveAll(s);
    expect(hand(s, 'p1')).toBe(p1Hand + 1);
  });
});

describe('CR 122.1f, 104.3d, 119.3: "Each opponent who has three or more poison counters loses 3 life."', () => {
  const INFECT = card('Test Blight', 'Sorcery', 'Each opponent who has three or more poison counters loses 3 life.');
  const run = (poison: number): GameState => {
    const s0 = scenario([], { defs: [INFECT], p1: { hand: ['Test Blight'] } });
    s0.players.find((p) => p.id === 'p2')!.poison = poison;
    return cast(s0, 'Test Blight');
  };
  it('is automated', () => { expect(noManual(INFECT)).toEqual([]); });
  it('an opponent with three or more poison counters loses 3 life; with two they lose nothing, and you never do', () => {
    expect(life(run(3), 'p2')).toBe(17);
    expect(life(run(5), 'p2')).toBe(17);
    expect(life(run(2), 'p2')).toBe(20);
    expect(life(run(3), 'p1')).toBe(20);
  });
});

describe('CR 122.1f, 701.9a, 608.2h: "Target player discards a card for each poison counter they have."', () => {
  const CURSE = card('Test Curse', 'Sorcery', 'Target player discards a card for each poison counter they have.');
  const run = (poison: number): GameState => {
    const s0 = scenario([], { defs: [CURSE, BEAR], p1: { hand: ['Test Curse'] }, p2: { hand: ['Test Bear', 'Test Bear', 'Test Bear'] } });
    s0.players.find((p) => p.id === 'p2')!.poison = poison;
    return cast(s0, 'Test Curse', [{ player: 'p2' }]);
  };
  it('is automated', () => { expect(noManual(CURSE)).toEqual([]); });
  it('discards one card per poison counter the target player has, and none with no counters', () => {
    const two = run(2);
    expect(hand(two, 'p2')).toBe(1);
    expect(gy(two, 'p2').length).toBe(2);
    expect(hand(run(0), 'p2')).toBe(3);
  });
});

describe('CR 120.3, 608.2d: "You may have ~ deal 1 damage to itself."', () => {
  const HOTHEAD = card('Test Hothead', 'Creature — Dragon', 'Whenever you gain life, you may have ~ deal 1 damage to itself.', { pt: ['3', '3'] });
  const HEAL = card('Test Heal', 'Sorcery', 'You gain 2 life.');
  const run = (yes: boolean): GameState => {
    const s0 = scenario([], { defs: [HOTHEAD, HEAL], p1: { hand: ['Test Heal'], battlefield: ['Test Hothead'] } });
    return cast(s0, 'Test Heal', [], yes);
  };
  it('is automated', () => { expect(noManual(HOTHEAD)).toEqual([]); });
  it('deals 1 damage to the creature when you agree, none when you decline', () => {
    const yes = run(true);
    expect(yes.objects[find(yes, 'Test Hothead', 'battlefield', 'p1')]!.damage).toBe(1);
    const no = run(false);
    expect(no.objects[find(no, 'Test Hothead', 'battlefield', 'p1')]!.damage).toBe(0);
  });
});

describe('CR 401.7, 400.7, 603.10a: "When ~ is put into your graveyard from the battlefield, put it into your library third from the top."', () => {
  const SPHINX = card('Test Sphinx', 'Artifact Creature — Sphinx', 'When this creature is put into your graveyard from the battlefield, put it into your library third from the top.', { pt: ['2', '2'] });
  const SMITE = card('Test Smite', 'Sorcery', 'Destroy target creature.');
  it('is automated', () => { expect(noManual(SPHINX)).toEqual([]); });
  it('the dead creature ends up third from the top of its owner\'s library', () => {
    const s0 = scenario([], { defs: [SPHINX, SMITE], p1: { hand: ['Test Smite'], battlefield: ['Test Sphinx'] } });
    const s = cast(s0, 'Test Smite', [find(s0, 'Test Sphinx', 'battlefield', 'p1')]);
    expect(lib(s, 'p1').indexOf('Test Sphinx')).toBe(2);
    expect(gy(s, 'p1')).not.toContain('Test Sphinx');
  });
  it("a creature you control but do not own goes to its owner's graveyard, so the trigger of its controller does not happen (the creature must be put into YOUR graveyard)", () => {
    const s0 = scenario([], { defs: [SPHINX, SMITE], p1: { hand: ['Test Smite'] }, p2: { battlefield: ['Test Sphinx'] } });
    const id = find(s0, 'Test Sphinx', 'battlefield', 'p2');
    s0.objects[id]!.controller = 'p1';
    const s = cast(s0, 'Test Smite', [id]);
    expect(gy(s, 'p2')).toContain('Test Sphinx');
    expect(lib(s, 'p1')).not.toContain('Test Sphinx');
    expect(lib(s, 'p2')).not.toContain('Test Sphinx');
  });
  it('with fewer than three cards in the library it goes to the bottom (CR 401.7)', () => {
    const s0 = scenario([], { defs: [SPHINX, SMITE], p1: { hand: ['Test Smite'], battlefield: ['Test Sphinx'] } });
    for (const id of s0.zones.library.p1!.slice(1)) delete s0.objects[id];
    s0.zones.library.p1 = s0.zones.library.p1!.slice(0, 1);
    const s = cast(s0, 'Test Smite', [find(s0, 'Test Sphinx', 'battlefield', 'p1')]);
    expect(lib(s, 'p1')).toEqual(['Plains', 'Test Sphinx']);
  });
  it("an opponent's creature dying does not trigger it (the creature must be put into your graveyard)", () => {
    const s0 = scenario([], { defs: [SPHINX, SMITE], p1: { hand: ['Test Smite'] }, p2: { battlefield: ['Test Sphinx'] } });
    const s = cast(s0, 'Test Smite', [find(s0, 'Test Sphinx', 'battlefield', 'p2')]);
    // it is Bob's creature, so it is put into Bob's graveyard and Bob's trigger puts it into Bob's library
    expect(lib(s, 'p2').indexOf('Test Sphinx')).toBe(2);
    expect(lib(s, 'p1')).not.toContain('Test Sphinx');
  });
});

describe('CR 109.4, 614.1c, 122.6: "enters with a number of counters equal to the greatest number of creatures a player controls."', () => {
  const JOURNAL = card('Test Journal', 'Artifact', 'This artifact enters with a number of charge counters on it equal to the greatest number of creatures a player controls.');
  const run = (mine: number, theirs: number): GameState => {
    const s0 = scenario([], { defs: [JOURNAL, BEAR], p1: { hand: ['Test Journal'], battlefield: Array(mine).fill('Test Bear') }, p2: { battlefield: Array(theirs).fill('Test Bear') } });
    return cast(s0, 'Test Journal');
  };
  const counters = (s: GameState): number => s.objects[find(s, 'Test Journal', 'battlefield', 'p1')]!.counters.charge ?? 0;
  it('is automated', () => { expect(noManual(JOURNAL)).toEqual([]); });
  it('counts the most creatures one player controls: yours or an opponent\'s, not the total', () => {
    expect(counters(run(1, 3))).toBe(3);
    expect(counters(run(4, 2))).toBe(4);
    expect(counters(run(2, 2))).toBe(2);
    expect(counters(run(0, 0))).toBe(0);
  });
});

describe('CR 611.2a, 613.1b: "When ~ dies, you gain control of all enchantments."', () => {
  const THIEF = card('Test Thief', 'Creature — Illusion', 'When this creature dies, you gain control of all enchantments.', { pt: ['1', '1'] });
  const SMITE = card('Test Smite', 'Sorcery', 'Destroy target creature.');
  const SHRINE = card('Test Shrine', 'Enchantment', '');
  it('is automated', () => { expect(noManual(THIEF)).toEqual([]); });
  it("takes every enchantment, whoever controls it, and leaves other permanents alone", () => {
    const s0 = scenario([], { defs: [THIEF, SMITE, SHRINE, BEAR], p1: { hand: ['Test Smite'], battlefield: ['Test Thief'] }, p2: { battlefield: ['Test Shrine', 'Test Shrine', 'Test Bear'] } });
    const s = cast(s0, 'Test Smite', [find(s0, 'Test Thief', 'battlefield', 'p1')]);
    const controlled = (name: string, p: 'p1' | 'p2'): number => findAll(s, name, 'battlefield').filter((id) => controllerOf(s, id) === p).length;
    expect(controlled('Test Shrine', 'p1')).toBe(2);
    expect(controlled('Test Shrine', 'p2')).toBe(0);
    expect(controlled('Test Bear', 'p2')).toBe(1);
  });
});
