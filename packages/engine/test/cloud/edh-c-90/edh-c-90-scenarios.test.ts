/**
 * Commander lane edh-c, round edh-c-90 (EDHREC ranks 17,501-18,000, later pass): the round's readings played through the engine with synthetic cards (invented names,
 * design 6.10), compiled by the game's default compiler. Each test is named after the rule it checks, with its negative case. CR cites are from the Comprehensive
 * Rules of 2026-09-25 (see the round's record for the ones not checked).
 *
 *   CR 205.1b, 611.2a, 613.1d     "~ becomes a 3/3 Elemental artifact creature that's still a land." (Stalking Stones): lasts for good, keeps the land type
 *   CR 205.1b, 302.6, 611.2a      "Until end of turn, ~ becomes a 5/5 white Soldier creature that's still a planeswalker." (Gideon, the Oathsworn)
 *   CR 205.1b, 611.2a             "Target noncreature artifact you control becomes an 8/8 Robot Villain artifact creature in addition to its other types." (Doc Ock)
 *   CR 205.1b, 608.2d             "You may have ~ become an artifact creature until end of turn." (The Fantasticar)
 *   CR 121.1, 608.2d, 701.13a     "You exile the top three cards of your library. Then each player draws up to two cards." (Diminishing Returns)
 *   CR 508.1d, 611.2a             "Target creature attacks target opponent this turn if able." (Dulcet Sirens)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { passUntil } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', loyalty?: string): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...(loyalty ? { loyalty } : {}) } as unknown as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
type Target = { kind: 'object' | 'player'; id: string };
function settle(s0: GameState, targets: Target[] = [], yes = true, n = 0): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending as unknown as { kind: string; options: { id: string }[] & string[]; min: number; items?: { id: string }[] };
    if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (p.options as string[]).slice(0, Math.max(p.min, 0)) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets } as never);
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: yes ? [p.options[0]!.id] : [] });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items!.map((x) => x.id) });
    else break;
  }
  return s;
}
function resolveAll(s0: GameState, targets: Target[] = [], yes = true, n = 0): GameState {
  let s = settle(s0, targets, yes, n);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 40; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, targets, yes, n);
  return s;
}
const activate = (s: GameState, name: string, ability: string, targets: Target[] = [], yes = true, who: 'p1' | 'p2' = 'p1'): GameState =>
  resolveAll(settle(act(s, { type: 'activate', player: who, source: find(s, name, 'battlefield', who), ability } as never), targets, yes), targets, yes);
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;
const has = (s: GameState, id: ObjectId, w: string): boolean => [...(chars(s, id).types ?? []), ...(chars(s, id).subtypes ?? [])].includes(w as never);
const toNextTurn = (s0: GameState): GameState => {
  let s = s0;
  const start = s.turn.number;
  for (let guard = 0; s.turn.number === start && guard < 600; guard++) s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : pass(s);
  return s;
};

const STONES = card('Test Stones', 'Land', "{0}: This land becomes a 3/3 Elemental artifact creature that's still a land.");
const GUARD = card('Test Guard', 'Legendary Planeswalker — Testa', "+1: Until end of turn, this planeswalker becomes a 5/5 white Soldier creature that's still a planeswalker.", undefined, '{3}', '4');
const FORGE = card('Test Forge', 'Artifact', '{0}: Target noncreature artifact you control becomes an 8/8 Robot Villain artifact creature in addition to its other types.');
const TRINKET = card('Test Trinket', 'Artifact — Equipment', '');
const CART = card('Test Cart', 'Artifact — Vehicle', '{0}: You may have this artifact become an artifact creature until end of turn.', ['4', '4']);
const RETURNS = card('Test Returns', 'Sorcery', 'Each player shuffles their hand and graveyard into their library. You exile the top three cards of your library. Then each player draws up to two cards.');
const FILLER = card('Test Filler', 'Sorcery', '');
const SIRENS = card('Test Sirens', 'Creature — Siren', '{T}: Target creature attacks target opponent this turn if able.', ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '3']);
const DEFS = [STONES, GUARD, FORGE, TRINKET, CART, RETURNS, FILLER, SIRENS, BEAR];
const obj = (id: ObjectId): Target => ({ kind: 'object', id });

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 205.1b, 611.2a, 613.1d: "~ becomes a 3/3 Elemental artifact creature that\'s still a land." (Stalking Stones)', () => {
  it('becomes a 3/3 Elemental artifact creature, still a land, and stays so after the turn ends', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Stones'] } });
    const id = find(s, 'Test Stones', 'battlefield', 'p1');
    expect(has(s, id, 'Creature')).toBe(false);
    s = activate(s, 'Test Stones', 'p:0:0');
    expect(has(s, id, 'Creature') && has(s, id, 'Artifact') && has(s, id, 'Land') && has(s, id, 'Elemental')).toBe(true);
    expect(`${chars(s, id).power}/${chars(s, id).toughness}`).toBe('3/3');
    s = toNextTurn(s);
    expect(has(s, find(s, 'Test Stones', 'battlefield', 'p1'), 'Creature')).toBe(true);
  });
  it('negative: before the ability resolves the land is only a land', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Stones'] } });
    const id = find(s, 'Test Stones', 'battlefield', 'p1');
    expect(has(s, id, 'Land') && !has(s, id, 'Artifact') && !has(s, id, 'Elemental')).toBe(true);
  });
});

describe('CR 205.1b, 302.6, 611.2a: "Until end of turn, ~ becomes a 5/5 white Soldier creature that\'s still a planeswalker." (Gideon, the Oathsworn)', () => {
  it('is a white 5/5 Soldier creature and still a planeswalker until the turn ends, then only a planeswalker', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Guard', counters: { loyalty: 4 } }] } });
    const id = find(s, 'Test Guard', 'battlefield', 'p1');
    s = activate(s, 'Test Guard', 'p:0:0');
    expect(has(s, id, 'Creature') && has(s, id, 'Planeswalker') && has(s, id, 'Soldier')).toBe(true);
    expect(`${chars(s, id).power}/${chars(s, id).toughness}`).toBe('5/5');
    expect([...(chars(s, id).colors ?? [])]).toEqual(['W']);
    s = toNextTurn(s);
    const id2 = find(s, 'Test Guard', 'battlefield', 'p1');
    expect(has(s, id2, 'Creature')).toBe(false);
    expect(has(s, id2, 'Planeswalker')).toBe(true);
  });
});

describe('CR 205.1b, 611.2a: "Target noncreature artifact you control becomes an 8/8 Robot Villain artifact creature in addition to its other types." (Doc Ock)', () => {
  it('the target keeps its Equipment type, gains Creature and the creature types, is 8/8, and stays so', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Forge', 'Test Trinket'] } });
    const t = find(s, 'Test Trinket', 'battlefield', 'p1');
    s = activate(s, 'Test Forge', 'p:0:0', [obj(t)]);
    expect(has(s, t, 'Creature') && has(s, t, 'Artifact') && has(s, t, 'Equipment') && has(s, t, 'Robot') && has(s, t, 'Villain')).toBe(true);
    expect(`${chars(s, t).power}/${chars(s, t).toughness}`).toBe('8/8');
    s = toNextTurn(s);
    expect(has(s, find(s, 'Test Trinket', 'battlefield', 'p1'), 'Creature')).toBe(true);
  });
  it('negative: a creature is not a legal target ("noncreature artifact")', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Forge'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    expect(() => settle(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Forge', 'battlefield', 'p1'), ability: 'p:0:0' } as never), [obj(bear)])).toThrow();
  });
});

describe('CR 205.1b, 608.2d: "You may have ~ become an artifact creature until end of turn." (The Fantasticar)', () => {
  it('yes: a 4/4 artifact creature until end of turn, a Vehicle again after it', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Cart'] } });
    const id = find(s, 'Test Cart', 'battlefield', 'p1');
    expect(has(s, id, 'Creature')).toBe(false);
    s = activate(s, 'Test Cart', 'p:0:0', [], true);
    expect(has(s, id, 'Creature') && has(s, id, 'Artifact') && has(s, id, 'Vehicle')).toBe(true);
    expect(`${chars(s, id).power}/${chars(s, id).toughness}`).toBe('4/4');
    s = toNextTurn(s);
    expect(has(s, find(s, 'Test Cart', 'battlefield', 'p1'), 'Creature')).toBe(false);
  });
  it('negative: declining leaves it a plain artifact', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Cart'] } });
    s = activate(s, 'Test Cart', 'p:0:0', [], false);
    expect(has(s, find(s, 'Test Cart', 'battlefield', 'p1'), 'Creature')).toBe(false);
  });
});

describe('CR 121.1, 608.2d, 701.13a: "Each player shuffles their hand and graveyard into their library. You exile the top three cards of your library. Then each player draws up to two cards." (Diminishing Returns)', () => {
  const lib = (n: number): string[] => Array.from({ length: n }, () => 'Test Filler');
  const play = (n: number): GameState => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Returns', 'Test Filler'], library: lib(6) }, p2: { hand: ['Test Filler', 'Test Filler'], library: lib(5) } });
    return resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Returns', 'hand', 'p1') }), [], true, n), [], true, n);
  };
  it('the casting player exiles three cards of their own library, the other player none; each player draws the chosen number up to two', () => {
    const s = play(2);
    expect(s.zones.exile.length).toBe(3);
    expect(s.zones.exile.every((id) => s.objects[id]!.owner === 'p1')).toBe(true);
    // p1: the other filler in hand is shuffled in (the spell itself is on the stack), then 3 exiled and 2 drawn; p2: 2 shuffled in, 2 drawn
    expect(s.zones.hand['p1']!.length).toBe(2);
    expect(s.zones.hand['p2']!.length).toBe(2);
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Returns', 'Test Filler'], library: lib(6) }, p2: { hand: ['Test Filler', 'Test Filler'], library: lib(5) } });
    expect(s.zones.library['p1']!.length).toBe(s0.zones.library['p1']!.length + 1 - 3 - 2);
    expect(s.zones.library['p2']!.length).toBe(s0.zones.library['p2']!.length + 2 - 2);
  });
  it('negative: choosing none draws none ("up to"), and the exile still happens', () => {
    const s = play(0);
    expect(s.zones.hand['p1']!.length).toBe(0);
    expect(s.zones.hand['p2']!.length).toBe(0);
    expect(s.zones.exile.length).toBe(3);
  });
});

describe('CR 508.1d, 611.2a: "Target creature attacks target opponent this turn if able." (Dulcet Sirens)', () => {
  const toAttackers = (use: boolean): GameState => {
    let s = mpScenario({ players: 3, defs: DEFS, zones: { p1: { battlefield: ['Test Sirens'] }, p2: { battlefield: ['Test Bear'] } } });
    for (let guard = 0; guard < 800 && !(s.turn.activePlayer === 'p2' && s.turn.step === 'beginCombat' && s.pending?.kind === 'priority' && s.pending.player === 'p1'); guard++) {
      s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : pass(s);
    }
    expect(s.turn.activePlayer).toBe('p2');
    if (use) {
      const queue: Target[][] = [[obj(find(s, 'Test Bear', 'battlefield', 'p2'))], [{ kind: 'player', id: 'p3' }]];
      s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Sirens', 'battlefield', 'p1'), ability: 'p:0:0' } as never);
      for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
        const k = s.pending.kind as string;
        s = k === 'chooseTargets' ? answer(s, { kind: 'chooseTargets', targets: queue.shift() ?? [] } as never) : k === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : settle(s);
      }
      s = resolveAll(s);
    }
    return passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'the declare attackers decision');
  };
  it('the Bear must attack the named opponent: attacking nobody and attacking the other opponent are refused, attacking p3 is accepted', () => {
    const s = toAttackers(true);
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    expect(() => answer(s, { kind: 'declareAttackers', attacks: [] })).toThrow();
    expect(() => answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p1' }] })).toThrow();
    expect(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p3' }] }).turn).toBeDefined();
  });
  it('negative: without the ability attacking nobody is allowed', () => {
    const s = toAttackers(false);
    expect(answer(s, { kind: 'declareAttackers', attacks: [] }).turn).toBeDefined();
  });
});
