/**
 * Commander lane edh-next, round edh-next-41: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case.
 *
 *   CR 701.34a, 603.1, 113.6k   "When you proliferate, return ~ from your graveyard to your hand." (Voidwing Hybrid)
 *   CR 608.2g, 601.2, 118.9      "You may cast an instant or sorcery spell with mana value N or less from among them without paying its mana cost." (Velomachus Lorehold)
 *   CR 701.20a, 402.3, 608.2g    "Target opponent reveals their hand. You may cast an instant or sorcery spell from among those cards without paying its mana cost." (Mindclaw Shaman)
 *   CR 205.3m, 608.2c, 701.20a   "You may reveal a creature card that doesn't share a creature type with a creature you control from among those cards and put it into your hand." (Radagast the Brown)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, pass, reject, scenario } from '../../m3/scenario';

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
/** Resolve everything on the stack. `yes` answers every yes/no; `take` picks which of the offered objects a choice takes. */
const resolveAll = (s0: GameState, yes = true, take: 'one' | 'all' | 'none' | 'last' = 'one'): GameState => {
  let s = settle(s0);
  for (let g = 0; g < 60 && s.pending !== null && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); g++) {
    const d = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number };
    if (d.kind === 'priority') s = settle(pass(s));
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes } as DecisionAnswer);
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } as DecisionAnswer);
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: take === 'none' ? [] : take === 'all' ? (d.options ?? []) : take === 'last' ? (d.options ?? []).slice(-1) : (d.options ?? []).slice(0, Math.max(1, d.min ?? 1)) } as DecisionAnswer);
    else s = settle(s);
  }
  return s;
};
const cast = (s: GameState, name: string, yes = true, take: 'one' | 'all' | 'none' | 'last' = 'one'): GameState =>
  resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') } as never)), yes, take);
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id)!.name;
const lib = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.library[p]!.map((id) => nameOf(s, id));
const gy = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.graveyard[p]!.map((id) => nameOf(s, id));
const handNames = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.hand[p]!.map((id) => nameOf(s, id));
const count = (xs: string[], n: string): number => xs.filter((x) => x === n).length;
const counters = (s: GameState, name: string): number => s.objects[find(s, name, 'battlefield')]!.counters?.['+1/+1'] ?? 0;

const LAND = card('Test Moor', 'Land', '');
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const ELF = card('Test Elf', 'Creature — Elf Warrior', '', { pt: ['1', '1'] });
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', { pt: ['1', '1'] });
const HUMAN = card('Test Human', 'Creature — Human', '', { pt: ['1', '1'] });
const RING = card('Test Ring', 'Artifact', '');
const CHARM = card('Test Charm', 'Instant', 'You gain 1 life.');
const BIGCHARM = card('Test Big Charm', 'Instant', 'You gain 5 life.', { cost: '{3}' });
const BOLT = card('Test Surge', 'Sorcery', 'You gain 2 life.');

/** Cast `name` from p1's hand and answer until a choice among objects is pending. */
const untilChoice = (s0: GameState, name: string): GameState => {
  let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') } as never));
  for (let g = 0; g < 30 && s.pending !== null && s.pending.kind !== 'chooseObjects'; g++) {
    const d = s.pending as unknown as { kind: string };
    s = d.kind === 'priority' ? settle(pass(s)) : d.kind === 'yesNo' ? answer(s, { kind: 'yesNo', yes: true } as DecisionAnswer) : d.kind === 'chooseTargets' ? answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } as DecisionAnswer) : settle(s);
  }
  return s;
};
const options = (s: GameState): string[] => ((s.pending as unknown as { options?: ObjectId[] })?.options ?? []).map((id) => nameOf(s, id));
const lifeOf = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.life;

describe('CR 701.34a, 603.1, 113.6k: "When you proliferate, return ~ from your graveyard to your hand."', () => {
  const BAT = card('Test Bat', 'Creature — Bat', 'When you proliferate, return this card from your graveyard to your hand.', { pt: ['1', '1'] });
  const PROL = card('Test Spread', 'Sorcery', 'Proliferate.');
  const defs = [BAT, PROL, BEAR, LAND];
  it('is automated', () => { expect(noManual(BAT)).toEqual([]); });
  it('returns the card from the graveyard to its owner\'s hand when its owner proliferates', () => {
    const s = cast(scenario([], { defs, p1: { hand: ['Test Spread'], graveyard: ['Test Bat'] } }), 'Test Spread');
    expect(handNames(s, 'p1')).toContain('Test Bat');
    expect(gy(s, 'p1')).not.toContain('Test Bat');
  });
  it('does nothing while no one proliferates, and a card of the same name in hand is not duplicated', () => {
    const s = scenario([], { defs, p1: { hand: ['Test Bear'], graveyard: ['Test Bat'] } });
    expect(gy(s, 'p1')).toContain('Test Bat');
    expect(handNames(s, 'p1')).not.toContain('Test Bat');
  });
});

describe('CR 608.2g, 601.2, 118.9: "You may cast an instant or sorcery spell with mana value N or less from among them without paying its mana cost."', () => {
  const DIG = card('Test Dig', 'Sorcery', 'Look at the top four cards of your library. You may cast an instant or sorcery spell with mana value less than or equal to 1 from among them without paying its mana cost. Put the rest on the bottom of your library in a random order.');
  const defs = [DIG, BEAR, CHARM, BIGCHARM, RING, LAND];
  const setup = (): GameState => scenario([], { defs, p1: { hand: ['Test Dig'], library: ['Test Bear', 'Test Charm', 'Test Big Charm', 'Test Ring', 'Test Moor'] } });
  it('is automated', () => { expect(noManual(DIG)).toEqual([]); });
  it('offers only the instant or sorcery spells of mana value 1 or less among the four cards looked at (not the creature, the artifact or the mana value 3 instant)', () => {
    expect(options(untilChoice(setup(), 'Test Dig'))).toEqual(['Test Charm']);
  });
  it('casts the chosen spell without paying (you gain its life) and the other three go to the bottom, below the fifth card', () => {
    const t = untilChoice(setup(), 'Test Dig');
    const s = resolveAll(answer(t, { kind: 'chooseObjects', ids: (t.pending as unknown as { options: ObjectId[] }).options } as DecisionAnswer));
    expect(lifeOf(s)).toBe(21);
    expect(lib(s, 'p1')[0]).toBe('Test Moor');
    expect(lib(s, 'p1').slice(-3).sort()).toEqual(['Test Bear', 'Test Big Charm', 'Test Ring']);
  });
  it('may decline: nothing is cast and all four go to the bottom', () => {
    const t = untilChoice(setup(), 'Test Dig');
    const s = resolveAll(answer(t, { kind: 'chooseObjects', ids: [] } as DecisionAnswer));
    expect(lifeOf(s)).toBe(20);
    expect(lib(s, 'p1')[0]).toBe('Test Moor');
    expect(lib(s, 'p1').slice(-4).sort()).toEqual(['Test Bear', 'Test Big Charm', 'Test Charm', 'Test Ring']);
  });
});

describe('CR 205.3m, 608.2c, 701.20a: "You may reveal a creature card that doesn\'t share a creature type with a creature you control from among those cards and put it into your hand."', () => {
  const SEER = card('Test Seer', 'Creature — Human Wizard', 'When this creature enters, look at the top four cards of your library. You may reveal a creature card that doesn\'t share a creature type with a creature you control from among those cards and put it into your hand. Put the rest on the bottom of your library in a random order.', { pt: ['1', '1'] });
  const defs = [SEER, ELF, GOBLIN, HUMAN, RING, BEAR, LAND];
  it('is automated', () => { expect(noManual(SEER)).toEqual([]); });
  it('offers only the creature cards that share no type with a creature you control (the Elf, the Human and the artifact are not offered); the card taken goes to hand and the rest to the bottom', () => {
    const base = scenario([], { defs, p1: { hand: ['Test Seer'], battlefield: ['Test Elf'], library: ['Test Elf', 'Test Goblin', 'Test Human', 'Test Ring', 'Test Moor'] } });
    const t = untilChoice(base, 'Test Seer');
    expect(options(t)).toEqual(['Test Goblin']);
    const s = resolveAll(answer(t, { kind: 'chooseObjects', ids: (t.pending as unknown as { options: ObjectId[] }).options } as DecisionAnswer));
    expect(handNames(s, 'p1')).toEqual(['Test Goblin']);
    expect(lib(s, 'p1')[0]).toBe('Test Moor');
  });
  it('with only creatures that share a type, nothing is offered and the four cards go to the bottom', () => {
    const base = scenario([], { defs, p1: { hand: ['Test Seer'], battlefield: ['Test Elf'], library: ['Test Elf', 'Test Human', 'Test Ring', 'Test Elf', 'Test Moor'] } });
    const s = resolveAll(settle(act(base, { type: 'cast', player: 'p1', card: find(base, 'Test Seer', 'hand', 'p1') } as never)));
    expect(handNames(s, 'p1')).toEqual([]);
    expect(lib(s, 'p1')[0]).toBe('Test Moor');
  });
});

describe('CR 701.20a, 402.3, 608.2g: "Target opponent reveals their hand. You may cast an instant or sorcery spell from among those cards without paying its mana cost."', () => {
  const SHAM = card('Test Shaman', 'Creature — Lizard', 'When this creature enters, target opponent reveals their hand. You may cast an instant or sorcery spell from among those cards without paying its mana cost.', { pt: ['1', '1'] });
  const defs = [SHAM, BEAR, CHARM, RING, LAND];
  const setup = (): GameState => scenario([], { defs, p1: { hand: ['Test Shaman'] }, p2: { hand: ['Test Bear', 'Test Charm', 'Test Ring'] } });
  it('is automated', () => { expect(noManual(SHAM)).toEqual([]); });
  it('offers only the opponent\'s instant or sorcery cards (not the creature or the artifact); the spell is cast from their hand for free and its effect is yours', () => {
    const t = untilChoice(setup(), 'Test Shaman');
    expect(options(t)).toEqual(['Test Charm']);
    const s = resolveAll(answer(t, { kind: 'chooseObjects', ids: (t.pending as unknown as { options: ObjectId[] }).options } as DecisionAnswer));
    expect(lifeOf(s)).toBe(21);
    expect(handNames(s, 'p2').sort()).toEqual(['Test Bear', 'Test Ring']);
  });
  it('may decline: nothing is cast, the opponent keeps all three cards', () => {
    const t = untilChoice(setup(), 'Test Shaman');
    const s = resolveAll(answer(t, { kind: 'chooseObjects', ids: [] } as DecisionAnswer));
    expect(lifeOf(s)).toBe(20);
    expect(handNames(s, 'p2').length).toBe(3);
  });
});
