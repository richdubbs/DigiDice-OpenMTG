/**
 * FAST5 T43: the library-dig shapes of parser/templates/zz-fast5/t43.json played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings are invented, design 6.10).
 *
 *   CR 701.20e, 608.2d   "Look at the top four cards of your library. Put two of them into your hand and the rest into your graveyard."
 *   CR 701.20e, 401.4    "... Put one of them into your hand and the other on the bottom of your library." (the card not chosen goes to the bottom)
 *   CR 701.20a, 400.7    "... You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom ... in a random order."
 *   CR 110.2, 701.20e    "... You may put a land card from among them onto the battlefield tapped. Put the rest on the bottom ..."
 *   CR 401.4, 701.20e    "... You may put one of those cards back on top of your library. Put the rest into your graveyard."
 *   CR 406.1, 401.4      "... You may exile a nonland card from among them. Put the rest on the bottom of your library in any order." (the owner orders)
 *   CR 107.3, 608.2h     "Look at the top X cards of your library, where X is the number of creatures you control."
 *   CR 110.4, 208.1      "a permanent card"; "a creature card with power 2 or less" (only the cards that qualify can be chosen)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, pass, scenario, zoneNames } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (experimental templates cap the card at partial, never an ability). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer the decisions that come up, in order; pay costs automatically; stop at priority. */
function settle(s0: GameState, answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
const castWith = (s0: GameState, name: string): GameState => settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }));
const resolve = (s: GameState, answers: DecisionAnswer[] = []): GameState => settle(pass(pass(s)), answers);

const ELF = card('Test Elf', 'Creature — Elf', '', ['2', '2'], '{1}');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{3}');
const ROCK = card('Test Rock', 'Artifact', '');
const BOLT = card('Test Bolt', 'Instant', '');
const DEFS = [ELF, OGRE, ROCK, BOLT];
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.objects[id]!.defId);

/** Cast the spell and resolve it: the first pending decision is the one the shape asks for. */
function run(text: string, library: string[], extra: { battlefield?: string[] } = {}): { s0: GameState; s: GameState } {
  const SPELL = card('Test Dig', 'Sorcery', text);
  expect(automated(SPELL), text).toBe(true);
  const s0 = scenario([], { p1: { hand: ['Test Dig'], library, ...(extra.battlefield ? { battlefield: extra.battlefield } : {}) }, defs: [SPELL, ...DEFS] });
  return { s0, s: resolve(castWith(s0, 'Test Dig')) };
}
const pick = (s: GameState, ids: string[]): GameState => settle(s, [{ kind: 'chooseObjects', ids }]);
/** The pending choice of cards, or a failed expectation. */
function choice(s: GameState): Extract<NonNullable<GameState['pending']>, { kind: 'chooseObjects' }> {
  expect(s.pending?.kind).toBe('chooseObjects');
  return s.pending as Extract<NonNullable<GameState['pending']>, { kind: 'chooseObjects' }>;
}

describe('CR 701.20e, 608.2d: "Look at the top four cards of your library. Put two of them into your hand and the rest into your graveyard"', () => {
  const GRAB = card('Test Grab', 'Sorcery', 'Look at the top four cards of your library. Put two of them into your hand and the rest into your graveyard.');
  it('you choose two of the four cards looked at; those go to your hand, the other two to your graveyard, the cards below stay', () => {
    expect(automated(GRAB)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Grab'], library: ['Test Elf', 'Test Ogre', 'Test Rock', 'Test Elf', 'Test Ogre'] }, defs: [GRAB, ...DEFS] });
    const top = s0.zones.library['p1']!.slice(0, 4);
    const s = resolve(castWith(s0, 'Test Grab'));
    const c = choice(s);
    expect([...c.options].sort()).toEqual([...top].sort());
    expect(c.min).toBe(2);
    expect(c.max).toBe(2);
    const done = settle(s, [{ kind: 'chooseObjects', ids: [top[0]!, top[2]!] }]);
    expect(zoneNames(done, 'hand', 'p1').sort()).toEqual(['Test Elf', 'Test Rock']);
    expect(zoneNames(done, 'graveyard', 'p1').sort()).toEqual(['Test Grab', 'Test Ogre', 'Test Elf'].sort());
    expect(done.zones.library['p1']).toHaveLength(s0.zones.library['p1']!.length - 4); // the other cards of the library were never looked at
  });
});

describe('CR 701.20e, 401.4: "Put one of them into your hand and the other on the bottom of your library"', () => {
  it('the card you do not choose goes to the bottom of the library, the chosen one to your hand', () => {
    const { s0, s } = run('Look at the top two cards of your library. Put one of them into your hand and the other on the bottom of your library.', ['Test Ogre', 'Test Rock']);
    const [, rock] = s0.zones.library['p1']!.slice(0, 2) as [string, string];
    choice(s);
    const done = pick(s, [rock]);
    expect(zoneNames(done, 'hand', 'p1')).toEqual(['Test Rock']);
    const lib = done.zones.library['p1']!;
    expect(lib).toHaveLength(s0.zones.library['p1']!.length - 1);
    expect(done.objects[lib[lib.length - 1]!]!.defId).toBe('Test Ogre');
  });
});

describe('CR 701.20a, 701.20e, 400.7: "You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in a random order"', () => {
  const TEXT = 'Look at the top four cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.';
  it('only the creature cards among the four looked at can be chosen; the chosen one is revealed and goes to your hand, the three others to the bottom', () => {
    const { s0, s } = run(TEXT, ['Test Rock', 'Test Elf', 'Test Bolt', 'Test Ogre', 'Test Elf']);
    const top4 = s0.zones.library['p1']!.slice(0, 4);
    const c = choice(s);
    expect(c.min).toBe(0);
    expect(c.max).toBe(1);
    expect(names(s, c.options).sort()).toEqual(['Test Elf', 'Test Ogre']); // the fifth card (an Elf) was never looked at
    expect(c.options.every((id) => top4.includes(id))).toBe(true);
    const ogre = c.options.find((id) => s.objects[id]!.defId === 'Test Ogre')!;
    const done = pick(s, [ogre]);
    expect(zoneNames(done, 'hand', 'p1')).toEqual(['Test Ogre']);
    expect(done.log.some((l) => /reveals/.test(l.text))).toBe(true); // CR 701.20a: shown to every player
    const lib = done.zones.library['p1']!;
    expect(lib).toHaveLength(s0.zones.library['p1']!.length - 1);
    expect(names(done, lib.slice(0, 1))).toEqual(['Test Elf']); // the card below the four is now on top
    expect(names(done, lib.slice(-3)).sort()).toEqual(['Test Bolt', 'Test Elf', 'Test Rock']);
  });
  it('choosing nothing is allowed: no card goes to your hand, and all four go to the bottom', () => {
    const { s0, s } = run(TEXT, ['Test Rock', 'Test Elf', 'Test Bolt', 'Test Ogre']);
    const done = pick(s, []);
    expect(zoneNames(done, 'hand', 'p1')).toEqual([]);
    expect(done.zones.library['p1']).toHaveLength(s0.zones.library['p1']!.length);
    expect(names(done, done.zones.library['p1']!.slice(-4)).sort()).toEqual(['Test Bolt', 'Test Elf', 'Test Ogre', 'Test Rock']);
  });
});

describe('CR 110.2, 701.20e: "You may put a land card from among them onto the battlefield tapped"', () => {
  it('the land you choose enters tapped under your control; the others go to the bottom', () => {
    const { s0, s } = run('Look at the top three cards of your library. You may put a land card from among them onto the battlefield tapped. Put the rest on the bottom in a random order.', ['Test Elf', 'Plains', 'Test Rock']);
    const c = choice(s);
    expect(names(s, c.options)).toEqual(['Plains']);
    const done = pick(s, [c.options[0]!]);
    const lands = done.zones.battlefield.filter((id) => done.objects[id]!.defId === 'Plains' && done.objects[id]!.controller === 'p1');
    expect(lands).toHaveLength(1);
    expect(done.objects[lands[0]!]!.tapped).toBe(true);
    expect(done.zones.library['p1']).toHaveLength(s0.zones.library['p1']!.length - 1);
    expect(names(done, done.zones.library['p1']!.slice(-2)).sort()).toEqual(['Test Elf', 'Test Rock']);
  });
});

describe('CR 401.4, 701.20e: "You may put one of those cards back on top of your library. Put the rest into your graveyard"', () => {
  const TEXT = 'Look at the top three cards of your library. You may put one of those cards back on top of your library. Put the rest into your graveyard.';
  it('the card you keep is on top afterwards; the two others are in the graveyard', () => {
    const { s0, s } = run(TEXT, ['Test Elf', 'Test Ogre', 'Test Rock']);
    const c = choice(s);
    const ogre = c.options.find((id) => s.objects[id]!.defId === 'Test Ogre')!;
    const done = pick(s, [ogre]);
    expect(names(done, done.zones.library['p1']!.slice(0, 1))).toEqual(['Test Ogre']);
    expect(zoneNames(done, 'graveyard', 'p1').sort()).toEqual(['Test Dig', 'Test Elf', 'Test Rock'].sort());
    expect(done.zones.library['p1']).toHaveLength(s0.zones.library['p1']!.length - 2);
  });
  it('keeping none puts all three cards into the graveyard', () => {
    const { s } = run(TEXT, ['Test Elf', 'Test Ogre', 'Test Rock']);
    const done = pick(s, []);
    expect(zoneNames(done, 'graveyard', 'p1')).toHaveLength(4);
  });
});

describe('CR 406.1, 401.4: "You may exile a nonland card from among them. Put the rest on the bottom of your library in any order"', () => {
  it('only nonland cards can be exiled; you order the rest (CR 401.4)', () => {
    const { s } = run('Look at the top four cards of your library. You may exile a nonland card from among them. Put the rest on the bottom of your library in any order.', ['Plains', 'Test Elf', 'Test Rock', 'Plains']);
    const c = choice(s);
    expect(names(s, c.options).sort()).toEqual(['Test Elf', 'Test Rock']);
    const elf = c.options.find((id) => s.objects[id]!.defId === 'Test Elf')!;
    const next = pick(s, [elf]);
    expect(names(next, next.zones.exile)).toEqual(['Test Elf']);
    expect(next.pending?.kind).toBe('order'); // the three cards left are put on the bottom in the order you choose
  });
});

describe('CR 107.3, 608.2h: "Look at the top X cards of your library, where X is the number of creatures you control"', () => {
  it('X is counted as the spell resolves: two creatures, two cards looked at', () => {
    const { s } = run('Look at the top X cards of your library, where X is the number of creatures you control. Put one of them into your hand and the rest into your graveyard.', ['Test Rock', 'Test Elf', 'Test Ogre'], { battlefield: ['Test Elf', 'Test Ogre'] });
    const c = choice(s);
    expect(c.options).toHaveLength(2);
    expect(names(s, c.options).sort()).toEqual(['Test Elf', 'Test Rock']);
  });
});

describe('CR 110.4, 208.1: "a permanent card" and "a creature card with power 2 or less"', () => {
  it('a permanent card: the instant among the cards looked at cannot be chosen', () => {
    const { s } = run('Look at the top three cards of your library. You may reveal a permanent card from among them and put it into your hand. Put the rest on the bottom of your library in any order.', ['Test Bolt', 'Test Rock', 'Plains']);
    expect(names(s, choice(s).options).sort()).toEqual(['Plains', 'Test Rock']);
  });
  it('a creature card with power 2 or less: the 3/3 cannot be chosen', () => {
    const { s } = run('Look at the top four cards of your library. You may reveal a creature card with power 2 or less from among them and put it into your hand. Put the rest on the bottom of your library in a random order.', ['Test Ogre', 'Test Elf', 'Test Rock', 'Plains']);
    expect(names(s, choice(s).options)).toEqual(['Test Elf']);
  });
});
