/**
 * Commander lane edh-cast, round edh-cast-10: scenarios with synthetic cards (invented names, design 6.10), compiled by the default compiler.
 * CR cites are from the Comprehensive Rules 2026-09-25 (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt) where the round checked them,
 * and the Scryfall rulings of each card were fetched live.
 *
 *   CR 701.20a, 601.2, 118.9, 202.3  "reveal the top X cards ..., where X is that spell's mana value. You may cast a spell with mana value X or less from among cards revealed this way
 *                                    without paying its mana cost. Put the rest on the bottom ..." (Sunbird's Invocation)
 *   CR 701.20e, 402.3, 601.2, 118.9  "Look at that player's hand. You may cast a spell from among those cards without paying its mana cost." (Silent-Blade Oni)
 *   CR 601.3, 611.2a, 400.7          "Until the end of your next turn, you may cast an instant or sorcery spell from among those exiled cards." (Chandra, Hope's Beacon): ONE spell
 *                                    in all, even over two turns (the one-card counter outlasts the turn)
 *   CR 701.17a, 601.3                "each player mills a card. ... Until end of turn, you may cast a spell from among those cards." (Locke, Treasure Hunter)
 *   CR 305.1, 601.3, 118.9           "Until end of turn, you may play one of those cards. If you cast a spell this way, pay life equal to its mana value rather than paying its mana cost." (Nashi)
 *   CR 305.1, 601.2a, 603.2          "Whenever you play a card from exile, create a Treasure token." (Prosper, Tome-Bound)
 *   CR 603.7b, 707.10                "When you cast your next instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy." (Twinferno)
 *   CR 707.10, 111.1, 702.10         "If it's a permanent spell, the copy gains haste and ... sacrifice this permanent" (Nalfeshnee)
 *   CR 707.9b, 205.4a                "Copy target creature spell you control, except it isn't legendary if the spell is legendary." (Double Major)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, pass, reject, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; supertypes?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? (type.includes('Land') ? '' : '{0}'), type_line: opts.supertypes ? `${opts.supertypes} ${type}` : type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const give = (s: GameState, player: 'p1' | 'p2', mana: string): void => { for (const t of mana) s.players[player === 'p1' ? 0 : 1]!.manaPool.push({ type: t } as never); };
const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const named = (s: GameState, zone: 'battlefield' | 'exile', name: string): ObjectId[] => s.zones[zone].filter((id) => s.objects[id]!.defId === name);
const onField = (s: GameState, name: string, player?: 'p1' | 'p2'): boolean => named(s, 'battlefield', name).some((id) => player === undefined || s.objects[id]!.controller === player);
/** The permanents on the battlefield with this name as they are now (a token copy has the name of the card it copies). */
const called = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => getChars(s, id)?.name === name);
const inYard = (s: GameState, player: 'p1' | 'p2', name: string): boolean => s.zones.graveyard[player]!.some((id) => s.objects[id]!.defId === name);
const libraryNames = (s: GameState, player: 'p1' | 'p2'): string[] => s.zones.library[player]!.map((id) => s.objects[id]!.defId);

interface Choices {
  /** The cards to choose among options, by name (every chooseObjects of the run). */
  pick?: string[];
  yes?: boolean;
  /** The targets to answer every chooseTargets with. */
  targets?: { kind: 'object' | 'player'; id: string }[];
}
/** Answer the decisions in front of us (choosing the named cards among the options) until a player has priority with nothing to answer; returns the state and the options each choice offered. */
function drive(s0: GameState, c: Choices = {}): { s: GameState; offered: string[][] } {
  let s = s0;
  const offered: string[][] = [];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const d = s.pending;
    if (d.kind === 'chooseObjects') {
      const options = (d as unknown as { options: ObjectId[] }).options;
      offered.push(options.map((id) => s.objects[id]!.defId));
      const ids = options.filter((id) => (c.pick ?? []).includes(s.objects[id]!.defId)).slice(0, (d as unknown as { max: number | 'any' }).max === 'any' ? 99 : ((d as unknown as { max: number }).max));
      s = answer(s, { kind: 'chooseObjects', ids });
    } else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (c.targets ?? []) as never });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: c.yes ?? true });
    else if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [(d as unknown as { options: { id: string }[] }).options[0]!.id] });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: (d as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else break;
  }
  return { s, offered };
}
/** Pass priority (answering decisions) until the stack is empty. */
function resolveStack(s0: GameState, c: Choices = {}): { s: GameState; offered: string[][] } {
  let { s, offered } = drive(s0, c);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) {
    const r = drive(pass(s), c);
    s = r.s;
    offered = [...offered, ...r.offered];
  }
  return { s, offered };
}
/** Can p1 cast this card from where it is right now (is there a legal cast action)? */
function castable(s: GameState, id: ObjectId, player: 'p1' | 'p2' = 'p1'): boolean {
  try {
    const r = reject(s, { type: 'cast', player, card: id });
    return !/cannot|can't|not allowed|illegal|no permission|not permitted/i.test(r.message) && false;
  } catch {
    // reject() throws when the action was accepted: the spell can be cast
    return true;
  }
}

describe('CR 701.20a, 601.2, 118.9, 202.3: "Whenever you cast a spell from your hand, reveal the top X cards of your library, where X is that spell\'s mana value. You may cast a spell with mana value X or less from among cards revealed this way without paying its mana cost. Put the rest on the bottom of your library in a random order." (Sunbird\'s Invocation)', () => {
  const SUN = card('Test Sun Reveal', 'Enchantment', "Whenever you cast a spell from your hand, reveal the top X cards of your library, where X is that spell's mana value. You may cast a spell with mana value X or less from among cards revealed this way without paying its mana cost. Put the rest on the bottom of your library in a random order.");
  const TWO = card('Test Two Rock', 'Artifact', '', { cost: '{2}' });
  const ONE = card('Test One Rock', 'Artifact', '', { cost: '{1}' });
  const THREE = card('Test Three Rock', 'Artifact', '', { cost: '{3}' });
  const ZAP = card('Test Zero Zap', 'Instant', 'You gain 5 life.');
  const defs = [SUN, TWO, ONE, THREE, ZAP];
  const run = (library: string[], pick: string[], spell = 'Test Two Rock', mana = 'RR', yes = true): { s: GameState; offered: string[][] } => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Sun Reveal'], hand: [spell], library } });
    give(s0, 'p1', mana);
    return resolveStack(act(s0, { type: 'cast', player: 'p1', card: find(s0, spell, 'hand', 'p1') }), { pick, yes });
  };
  it('is automated', () => { expect(SUN.automation.level).toBe('full'); });
  it('casting a spell of mana value 2 reveals the top 2 cards; a revealed card of mana value 2 or less is cast free and the rest goes to the bottom', () => {
    const { s, offered } = run(['Test One Rock', 'Test Three Rock', 'Plains'], ['Test One Rock']);
    expect(offered[0]).toEqual(['Test One Rock']); // the card of mana value 3 is no choice (X = 2); a land is never cast
    expect(onField(s, 'Test One Rock')).toBe(true);
    expect(onField(s, 'Test Two Rock')).toBe(true); // the spell that triggered it resolves too
    const lib = libraryNames(s, 'p1');
    expect(lib[lib.length - 1]).toBe('Test Three Rock'); // the revealed card that was not cast is on the bottom (the third card, a Plains, stays on top)
    expect(lib[0]).toBe('Plains');
  });
  it('X is the mana value of the spell: a spell of mana value 3 reveals three cards and may cast one of mana value 3', () => {
    const { s } = run(['Test One Rock', 'Test Three Rock', 'Plains', 'Test Two Rock'], ['Test Three Rock'], 'Test Three Rock', 'RRR');
    expect(named(s, 'battlefield', 'Test Three Rock').length).toBe(2);
    expect(libraryNames(s, 'p1').slice(-2).sort()).toEqual(['Plains', 'Test One Rock']);
  });
  it('declining to cast puts every revealed card on the bottom; the cards below stay on top', () => {
    const { s } = run(['Test One Rock', 'Test Two Rock', 'Test Three Rock'], []);
    expect(onField(s, 'Test One Rock')).toBe(false);
    expect(libraryNames(s, 'p1')[0]).toBe('Test Three Rock'); // the third card was never revealed
    expect(libraryNames(s, 'p1').slice(-2).sort()).toEqual(['Test One Rock', 'Test Two Rock']);
  });
  it('a spell of mana value 0 reveals nothing (the ability resolves and does nothing, ruling 2017-09-29)', () => {
    const { s, offered } = run(['Test One Rock', 'Test Two Rock'], ['Test One Rock'], 'Test Zero Zap', '');
    expect(offered.length).toBe(0);
    expect(libraryNames(s, 'p1').slice(0, 2)).toEqual(['Test One Rock', 'Test Two Rock']);
    expect(life(s, 'p1')).toBe(25);
  });
});

describe('CR 701.20e, 402.3, 601.2, 118.9: "Look at target opponent\'s hand. You may cast a spell from among those cards without paying its mana cost." (Silent-Blade Oni)', () => {
  const PEEK = card('Test Peek Plan', 'Sorcery', "Look at target opponent's hand. You may cast a spell from among those cards without paying its mana cost.");
  const ROCK = card('Test Two Rock', 'Artifact', '', { cost: '{2}' });
  const ZAP = card('Test Zap', 'Instant', 'You gain 3 life.', { cost: '{1}' });
  const defs = [PEEK, ROCK, ZAP];
  const run = (hand: string[], pick: string[]): { s: GameState; offered: string[][] } => {
    const s0 = scenario(['Plains'], { defs, p1: { hand: ['Test Peek Plan'] }, p2: { hand } });
    const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Peek Plan', 'hand', 'p1') });
    return resolveStack(s1, { pick, targets: [{ kind: 'player', id: 'p2' }] });
  };
  it('is automated', () => { expect(PEEK.automation.level).toBe('full'); });
  it("the opponent's card is cast free by you (it enters under your control; it left their hand); the land in their hand is no choice", () => {
    const { s, offered } = run(['Test Two Rock', 'Plains'], ['Test Two Rock']);
    expect(offered[0]).toEqual(['Test Two Rock']);
    expect(onField(s, 'Test Two Rock', 'p1')).toBe(true);
    expect(s.zones.hand.p2!.some((id) => s.objects[id]!.defId === 'Test Two Rock')).toBe(false);
  });
  it('declining casts nothing and the cards stay in their hand', () => {
    const { s } = run(['Test Two Rock', 'Test Zap'], []);
    expect(onField(s, 'Test Two Rock')).toBe(false);
    expect(s.zones.hand.p2!.length).toBe(2);
  });
  it('only a spell: with just lands in their hand nothing can be chosen', () => {
    const { s, offered } = run(['Plains', 'Plains'], ['Plains']);
    expect(offered.flat()).toEqual([]);
    expect(s.zones.hand.p2!.length).toBe(2);
  });
});

describe('CR 601.3, 611.2a, 400.7: "Exile the top three cards of your library. Until the end of your next turn, you may cast an instant or sorcery spell from among those exiled cards." (Chandra, Hope\'s Beacon)', () => {
  const PLAN = card('Test Exile Plan', 'Sorcery', 'Exile the top three cards of your library. Until the end of your next turn, you may cast an instant or sorcery spell from among those exiled cards.');
  const INSTANT = card('Test Gain Three', 'Instant', 'You gain 3 life.');
  const SORCERY = card('Test Gain Four', 'Sorcery', 'You gain 4 life.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [PLAN, INSTANT, SORCERY, BEAR];
  const start = (library: string[]): GameState => {
    const s0 = scenario(['Plains'], { defs, p1: { hand: ['Test Exile Plan'], library } });
    return resolveStack(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Exile Plan', 'hand', 'p1') })).s;
  };
  const exiled = (s: GameState, name: string): ObjectId => named(s, 'exile', name)[0]!;
  it('is automated', () => { expect(PLAN.automation.level).toBe('full'); });
  it('an instant or sorcery of the exiled cards may be cast (the creature card may not); once one is cast no other may be, in this turn', () => {
    let s = start(['Test Gain Three', 'Test Gain Four', 'Test Bear']);
    expect(named(s, 'exile', 'Test Gain Three').length + named(s, 'exile', 'Test Gain Four').length + named(s, 'exile', 'Test Bear').length).toBe(3);
    expect(castable(s, exiled(s, 'Test Bear'))).toBe(false);
    expect(castable(s, exiled(s, 'Test Gain Four'))).toBe(true); // a sorcery in your own main phase
    s = resolveStack(act(s, { type: 'cast', player: 'p1', card: exiled(s, 'Test Gain Three') })).s;
    expect(life(s, 'p1')).toBe(23);
    expect(castable(s, exiled(s, 'Test Gain Four'))).toBe(false); // the one spell was cast
  });
  it('the permission lasts until the end of your NEXT turn and is still ONE spell over the two turns: cast none now, one on your next turn, then no other', () => {
    let s = start(['Test Gain Three', 'Test Gain Four', 'Plains']);
    s = advanceTo(s, 3, 'main1'); // p1's next turn
    expect(castable(s, exiled(s, 'Test Gain Four'))).toBe(true);
    s = resolveStack(act(s, { type: 'cast', player: 'p1', card: exiled(s, 'Test Gain Four') })).s;
    expect(life(s, 'p1')).toBe(24);
    expect(castable(s, exiled(s, 'Test Gain Three'))).toBe(false);
  });
  it('a spell cast in this turn leaves the permission spent on the next turn too (the counter outlasts the turn)', () => {
    let s = start(['Test Gain Three', 'Test Gain Four', 'Plains']);
    s = resolveStack(act(s, { type: 'cast', player: 'p1', card: exiled(s, 'Test Gain Three') })).s;
    s = advanceTo(s, 3, 'main1');
    expect(castable(s, exiled(s, 'Test Gain Four'))).toBe(false);
  });
  it('after the end of your next turn the cards cannot be cast', () => {
    let s = start(['Test Gain Three', 'Test Gain Four', 'Plains']);
    s = advanceTo(s, 5, 'main1');
    expect(castable(s, exiled(s, 'Test Gain Four'))).toBe(false);
  });
});

describe('CR 701.17a, 601.3: "Each player mills a card. Until end of turn, you may cast a spell from among those cards." (Locke, Treasure Hunter)', () => {
  const MILL = card('Test Mill Plan', 'Sorcery', 'Each player mills a card. Until end of turn, you may cast a spell from among those cards.');
  const ROCK = card('Test Two Rock', 'Artifact', '', { cost: '{2}' });
  const ROCK3 = card('Test Three Rock', 'Artifact', '', { cost: '{3}' });
  const defs = [MILL, ROCK, ROCK3];
  const start = (mine: string, theirs: string): GameState => {
    const s0 = scenario(['Plains'], { defs, p1: { hand: ['Test Mill Plan'], library: [mine] }, p2: { library: [theirs] } });
    give(s0, 'p1', 'RRRRRRRR');
    return resolveStack(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Mill Plan', 'hand', 'p1') })).s;
  };
  it('is automated', () => { expect(MILL.automation.level).toBe('full'); });
  it("a milled card of either player's graveyard may be cast (one spell only)", () => {
    let s = start('Test Two Rock', 'Test Three Rock');
    expect(inYard(s, 'p1', 'Test Two Rock') && inYard(s, 'p2', 'Test Three Rock')).toBe(true);
    const theirs = s.zones.graveyard.p2!.find((id) => s.objects[id]!.defId === 'Test Three Rock')!;
    const mine = s.zones.graveyard.p1!.find((id) => s.objects[id]!.defId === 'Test Two Rock')!;
    expect(castable(s, theirs)).toBe(true);
    s = resolveStack(act(s, { type: 'cast', player: 'p1', card: theirs })).s;
    expect(onField(s, 'Test Three Rock', 'p1')).toBe(true);
    expect(castable(s, mine)).toBe(false);
  });
  it('only the milled cards: a card already in the graveyard is no choice, and after the turn the permission is over', () => {
    const s0 = scenario(['Plains'], { defs, p1: { hand: ['Test Mill Plan'], graveyard: ['Test Two Rock'], library: ['Test Three Rock'] }, p2: { library: ['Plains'] } });
    const s = resolveStack(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Mill Plan', 'hand', 'p1') })).s;
    const old = s.zones.graveyard.p1!.find((id) => s.objects[id]!.defId === 'Test Two Rock')!;
    expect(castable(s, old)).toBe(false);
    const later = advanceTo(s, 3, 'main1');
    const milled = later.zones.graveyard.p1!.find((id) => later.objects[id]!.defId === 'Test Three Rock')!;
    expect(castable(later, milled)).toBe(false);
  });
});

describe('CR 305.1, 601.3, 118.9: "Exile the top card of each player\'s library. Until end of turn, you may play one of those cards. If you cast a spell this way, pay life equal to its mana value rather than paying its mana cost." (Nashi, Moon Sage\'s Scion)', () => {
  const NASHI = card('Test Greedy Plan', 'Sorcery', "Exile the top card of each player's library. Until end of turn, you may play one of those cards. If you cast a spell this way, pay life equal to its mana value rather than paying its mana cost.");
  const ROCK = card('Test Two Rock', 'Artifact', '', { cost: '{2}' });
  const ROCK3 = card('Test Three Rock', 'Artifact', '', { cost: '{3}' });
  const defs = [NASHI, ROCK, ROCK3];
  const start = (mine: string, theirs: string): GameState => {
    const s0 = scenario(['Plains'], { defs, p1: { hand: ['Test Greedy Plan'], library: [mine] }, p2: { library: [theirs] } });
    return resolveStack(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Greedy Plan', 'hand', 'p1') })).s;
  };
  it('is automated', () => { expect(NASHI.automation.level).toBe('full'); });
  it('a spell cast this way costs life equal to its mana value instead of its mana cost (no mana needed); the other exiled card then cannot be played', () => {
    let s = start('Test Two Rock', 'Test Three Rock');
    expect(life(s, 'p1')).toBe(20);
    s = resolveStack(act(s, { type: 'cast', player: 'p1', card: named(s, 'exile', 'Test Three Rock')[0]! })).s; // their card, 3 life
    expect(onField(s, 'Test Three Rock', 'p1')).toBe(true);
    expect(life(s, 'p1')).toBe(17);
    expect(castable(s, named(s, 'exile', 'Test Two Rock')[0]!)).toBe(false); // "one of those cards"
  });
  it('a land is played as a land (no life) and then no spell may be cast this way', () => {
    let s = start('Test Two Rock', 'Plains');
    const land = named(s, 'exile', 'Plains')[0]!;
    s = act(s, { type: 'playLand', player: 'p1', card: land });
    expect(life(s, 'p1')).toBe(20);
    expect(onField(s, 'Plains', 'p1')).toBe(true); // (a card that changes zones is a new object: the land is on the battlefield under its name)
    expect(castable(s, named(s, 'exile', 'Test Two Rock')[0]!)).toBe(false);
  });
  it('when the turn ends the cards stay exiled and cannot be played', () => {
    let s = start('Test Two Rock', 'Test Three Rock');
    s = advanceTo(s, 3, 'main1');
    expect(castable(s, named(s, 'exile', 'Test Two Rock')[0]!)).toBe(false);
  });
});

describe('CR 305.1, 601.2a, 603.2: "Whenever you play a card from exile, create a Treasure token." (Prosper, Tome-Bound)', () => {
  const PROSPER = card('Test Pact Boon', 'Enchantment', 'Whenever you play a card from exile, create a Treasure token.');
  const IMPULSE = card('Test Impulse Plan', 'Sorcery', 'Exile the top card of your library. Until end of turn, you may play that card.');
  const ROCK = card('Test Zero Rock', 'Artifact', '');
  const defs = [PROSPER, IMPULSE, ROCK];
  const treasures = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1').length;
  const start = (top: string): GameState => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Pact Boon'], hand: ['Test Impulse Plan', 'Test Zero Rock', 'Plains'], library: [top] } });
    return resolveStack(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Impulse Plan', 'hand', 'p1') })).s;
  };
  it('is automated', () => { expect(PROSPER.automation.level).toBe('full'); });
  it('playing a land from exile makes a Treasure', () => {
    let s = start('Plains');
    expect(treasures(s)).toBe(0);
    s = resolveStack(act(s, { type: 'playLand', player: 'p1', card: named(s, 'exile', 'Plains')[0]! })).s;
    expect(treasures(s)).toBe(1);
  });
  it('casting a spell from exile makes a Treasure', () => {
    let s = start('Test Zero Rock');
    s = resolveStack(act(s, { type: 'cast', player: 'p1', card: named(s, 'exile', 'Test Zero Rock')[0]! })).s;
    expect(treasures(s)).toBe(1);
  });
  it('a spell cast from your hand, and a land played from your hand, make none', () => {
    let s = start('Plains');
    s = resolveStack(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Zero Rock', 'hand', 'p1') })).s;
    expect(treasures(s)).toBe(0);
    s = resolveStack(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Plains', 'hand', 'p1') })).s;
    expect(onField(s, 'Plains', 'p1')).toBe(true);
    expect(treasures(s)).toBe(0);
  });
});

describe('CR 603.7b, 707.10: "When you cast your next instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy." (Twinferno)', () => {
  const PLAN = card('Test Twin Plan', 'Sorcery', 'When you cast your next instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.');
  const ZAP = card('Test Gain Three', 'Instant', 'You gain 3 life.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [PLAN, ZAP, BEAR];
  const afterPlan = (hand: string[]): GameState => {
    const s0 = scenario(['Plains'], { defs, p1: { hand: ['Test Twin Plan', ...hand] } });
    return resolveStack(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Twin Plan', 'hand', 'p1') })).s;
  };
  it('is automated', () => { expect(PLAN.automation.level).toBe('full'); });
  it('the next instant is copied (the copy resolves too: 6 life), and the one after it is not', () => {
    let s = afterPlan(['Test Gain Three', 'Test Gain Three']);
    s = resolveStack(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Gain Three', 'hand', 'p1') })).s;
    expect(life(s, 'p1')).toBe(26);
    s = resolveStack(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Gain Three', 'hand', 'p1') })).s;
    expect(life(s, 'p1')).toBe(29);
  });
  it('a creature spell is not an instant or sorcery: it is not copied and does not use up the trigger', () => {
    let s = afterPlan(['Test Bear', 'Test Gain Three']);
    s = resolveStack(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bear', 'hand', 'p1') })).s;
    expect(named(s, 'battlefield', 'Test Bear').length).toBe(1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(0);
    s = resolveStack(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Gain Three', 'hand', 'p1') })).s;
    expect(life(s, 'p1')).toBe(26);
  });
  it('only this turn: the trigger is gone on the next turn', () => {
    let s = afterPlan(['Test Gain Three']);
    s = advanceTo(s, 3, 'main1');
    s = resolveStack(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Gain Three', 'hand', 'p1') })).s;
    expect(life(s, 'p1')).toBe(23);
  });
});

describe('CR 707.10, 111.1: "Whenever you cast a spell from exile, copy it. You may choose new targets for the copy. If it\'s a permanent spell, the copy gains haste and \\"At the beginning of the end step, sacrifice this permanent.\\"" (Nalfeshnee)', () => {
  const NALF = card('Test Twin Demon', 'Creature — Demon', 'Flying\nWhenever you cast a spell from exile, copy it. You may choose new targets for the copy. If it\'s a permanent spell, the copy gains haste and "At the beginning of the end step, sacrifice this permanent."', { pt: ['3', '3'] });
  const IMPULSE = card('Test Impulse Plan', 'Sorcery', 'Exile the top card of your library. Until end of turn, you may cast that card.');
  const ZAP = card('Test Gain Three', 'Instant', 'You gain 3 life.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [NALF, IMPULSE, ZAP, BEAR];
  const fromExile = (top: string): GameState => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Twin Demon'], hand: ['Test Impulse Plan', 'Test Gain Three', 'Test Bear'], library: [top] } });
    const s1 = resolveStack(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Impulse Plan', 'hand', 'p1') })).s;
    return resolveStack(act(s1, { type: 'cast', player: 'p1', card: named(s1, 'exile', top)[0]! })).s;
  };
  it('is automated', () => { expect(NALF.automation.level).toBe('full'); });
  it('an instant cast from exile is copied: 6 life', () => {
    expect(life(fromExile('Test Gain Three'), 'p1')).toBe(26);
  });
  it('a permanent spell cast from exile is copied; the copy is a token with haste that is sacrificed at the beginning of the end step', () => {
    let s = fromExile('Test Bear');
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token' && getChars(s, id)?.name === 'Test Bear');
    expect(token).toBeDefined();
    expect(JSON.stringify(getChars(s, token!)!.keywords)).toContain('haste');
    expect(called(s, 'Test Bear').length).toBe(2);
    s = advanceTo(s, 1, 'end');
    for (let guard = 0; guard < 6 && s.zones.stack.length > 0; guard++) s = resolveStack(s).s;
    expect(s.zones.battlefield.some((id) => s.objects[id]!.kind === 'token' && getChars(s, id)?.name === 'Test Bear')).toBe(false);
    expect(called(s, 'Test Bear').length).toBe(1);
  });
  it('a spell cast from your hand is not copied', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Twin Demon'], hand: ['Test Gain Three'] } });
    const s = resolveStack(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Gain Three', 'hand', 'p1') })).s;
    expect(life(s, 'p1')).toBe(23);
  });
});

describe('CR 707.9b, 205.4a, 707.10: "Copy target creature spell you control, except it isn\'t legendary if the spell is legendary." (Double Major)', () => {
  const MAJOR = card('Test Double Plan', 'Instant', "Copy target creature spell you control, except it isn't legendary if the spell is legendary.");
  const KING = card('Test Flash King', 'Creature — Human', 'Flash', { pt: ['2', '2'], supertypes: 'Legendary' });
  const BEAR = card('Test Flash Bear', 'Creature — Bear', 'Flash', { pt: ['2', '2'] });
  const defs = [MAJOR, KING, BEAR];
  const run = (creature: string): GameState => {
    const s0 = scenario(['Plains'], { defs, p1: { hand: [creature, 'Test Double Plan'] } });
    const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, creature, 'hand', 'p1') });
    const spell = s1.zones.stack[s1.zones.stack.length - 1]!;
    return resolveStack(act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Double Plan', 'hand', 'p1') }), { targets: [{ kind: 'object', id: spell }] }).s;
  };
  it('is automated', () => { expect(MAJOR.automation.level).toBe('full'); });
  it('the copy of a legendary creature spell becomes a token that is not legendary (so both stay: no legend rule), the original stays legendary', () => {
    const s = run('Test Flash King');
    const all = called(s, 'Test Flash King');
    expect(all.length).toBe(2);
    const supers = all.map((id) => (getChars(s, id)!.supertypes ?? []).map(String));
    expect(supers.filter((x) => x.includes('Legendary')).length).toBe(1);
    expect(all.some((id) => s.objects[id]!.kind === 'token')).toBe(true);
  });
  it('the copy of a creature spell that is not legendary is just a copy', () => {
    const s = run('Test Flash Bear');
    expect(called(s, 'Test Flash Bear').length).toBe(2);
  });
});

describe('CR 701.20e, 402.3, 601.2, 118.9: "You may look at target opponent\'s hand. If you do, you may cast a spell from among those cards without paying its mana cost." (the form of Mindleech Mass, outside the top 5,000, opened for verification)', () => {
  const PEEK = card('Test Optional Peek', 'Sorcery', "You may look at target opponent's hand. If you do, you may cast a spell from among those cards without paying its mana cost.");
  const ROCK = card('Test Two Rock', 'Artifact', '', { cost: '{2}' });
  const defs = [PEEK, ROCK];
  const run = (yes: boolean, pick: string[]): GameState => {
    const s0 = scenario(['Plains'], { defs, p1: { hand: ['Test Optional Peek'] }, p2: { hand: ['Test Two Rock', 'Plains'] } });
    return resolveStack(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Optional Peek', 'hand', 'p1') }), { pick, yes, targets: [{ kind: 'player', id: 'p2' }] }).s;
  };
  it('is automated', () => { expect(PEEK.automation.level).toBe('full'); });
  it('after looking, a spell of their hand is cast free (the look happened inside the optional step and its cards are still the ones chosen from)', () => {
    expect(onField(run(true, ['Test Two Rock']), 'Test Two Rock', 'p1')).toBe(true);
  });
  it('declining the look casts nothing (if you do: no look, no cast)', () => {
    const s = run(false, ['Test Two Rock']);
    expect(onField(s, 'Test Two Rock')).toBe(false);
    expect(s.zones.hand.p2!.length).toBe(2);
  });
});

describe('CR 305.1, 601.3, 611.2a: "Exile the top two cards of your library. Until your next end step, you may play one of those cards." (the form of Unlucky Witness, outside the top 5,000, opened for verification)', () => {
  const PLAN = card('Test Witness Plan', 'Sorcery', 'Exile the top two cards of your library. Until your next end step, you may play one of those cards.');
  const ROCK = card('Test Zero Rock', 'Artifact', '');
  const defs = [PLAN, ROCK];
  it('is automated', () => { expect(PLAN.automation.level).toBe('full'); });
  it('one of the two exiled cards may be played, not both', () => {
    const s0 = scenario(['Plains'], { defs, p1: { hand: ['Test Witness Plan'], library: ['Test Zero Rock', 'Plains'] } });
    let s = resolveStack(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Witness Plan', 'hand', 'p1') })).s;
    s = act(s, { type: 'playLand', player: 'p1', card: named(s, 'exile', 'Plains')[0]! });
    expect(onField(s, 'Plains', 'p1')).toBe(true);
    expect(castable(s, named(s, 'exile', 'Test Zero Rock')[0]!)).toBe(false);
  });
});
