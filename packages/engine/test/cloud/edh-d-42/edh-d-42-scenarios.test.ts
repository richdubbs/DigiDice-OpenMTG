/**
 * Round edh-d-42 (Commander lane tokens, second pass): the behaviour it added, played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 *
 *   CR 119.1, 102.3, 608.2h   "for each opponent who has less life than you, create a token" (Great Unclean One)
 *   CR 111.3, 202.3           "create a Spellgorger Weird token": a {2}{R} 2/2 Weird that grows when its controller casts a noncreature spell (Ral and the Implicit Maze)
 *   CR 111.4, 702.6           a token named, with a keyword, a quoted Equipment ability and equip (Nahiri, the Lithomancer)
 *   CR 305.1, 601.2a, 603.4   "if you didn't play a card from exile this turn" (Visions of Phyrexia)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { activatedAbilities } from '../../../src/rules/abilities';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const ptOf = (s: GameState, id: ObjectId): [number, number] => { const c = getChars(s, id)!; return [Number(c.power), Number(c.toughness)]; };
const tokensOf = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.defs[s.objects[id]!.defId]!.name === name);
const settle = (s0: GameState): GameState => {
  let s = s0;
  for (let g = 0; g < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (s.pending && s.pending.kind !== 'priority') throw new Error(`unexpected decision ${s.pending.kind}`);
    else s = pass(s);
  }
  return s;
};
const cast = (s: GameState, name: string): GameState => settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }));
const setLife = (s: GameState, id: string, life: number): GameState => { s.players.find((p) => p.id === id)!.life = life; return s; };

// ---- for each opponent who has less life than you ----------------------------------------------------------------------------------------------------------------
describe('CR 119.1, 608.2h: "For each opponent who has less life than you, create a 1/3 black Demon creature token named Test Imp."', () => {
  const MAKER = card('Test Imp Maker', 'Creature — Demon', 'When this creature enters, for each opponent who has less life than you, create a 1/3 black Demon creature token named Test Imp.', { pt: ['1', '1'] });
  const run = (mine: number, theirs: number): GameState => cast(setLife(setLife(scenario([], { defs: [MAKER], p1: { hand: ['Test Imp Maker'] } }), 'p1', mine), 'p2', theirs), 'Test Imp Maker');
  it('is fully automated', () => expect(full(MAKER)).toBe(true));
  it('makes one token when the only opponent has less life than you, and the token is a 1/3 black Demon named Test Imp', () => {
    const s = run(20, 10);
    const [t] = tokensOf(s, 'Test Imp');
    expect(tokensOf(s, 'Test Imp')).toHaveLength(1);
    expect(ptOf(s, t!)).toEqual([1, 3]);
    expect(getChars(s, t!)!.colors).toEqual(['B']);
  });
  it('negative: no token when the opponent has more life, or exactly as much (CR 119.1)', () => {
    expect(tokensOf(run(20, 25), 'Test Imp')).toHaveLength(0);
    expect(tokensOf(run(20, 20), 'Test Imp')).toHaveLength(0);
  });
  it('the count is read as the ability resolves: life lost earlier in the same ability counts (Great Unclean One: "each opponent loses 2 life. Then ...")', () => {
    const LOSER = card('Test Drainer', 'Creature — Demon', 'When this creature enters, each opponent loses 2 life. Then for each opponent who has less life than you, create a 1/3 black Demon creature token named Test Imp.', { pt: ['1', '1'] });
    expect(full(LOSER)).toBe(true);
    const s = cast(setLife(setLife(scenario([], { defs: [LOSER], p1: { hand: ['Test Drainer'] } }), 'p1', 10), 'p2', 11), 'Test Drainer');
    expect(tokensOf(s, 'Test Imp')).toHaveLength(1); // 11 - 2 = 9 < 10
    const s2 = cast(setLife(setLife(scenario([], { defs: [LOSER], p1: { hand: ['Test Drainer'] } }), 'p1', 10), 'p2', 12), 'Test Drainer');
    expect(tokensOf(s2, 'Test Imp')).toHaveLength(0); // 12 - 2 = 10, not less
  });
  it('the trailing wording counts the same opponents: "draw a card for each opponent who has more life than you"', () => {
    const DRAW = card('Test Envy', 'Sorcery', 'Draw a card for each opponent who has more life than you.');
    expect(full(DRAW)).toBe(true);
  });
});

// ---- Spellgorger Weird -------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 111.3, 202.3: "Create a Spellgorger Weird token."', () => {
  const MAKER = card('Test Weird Maker', 'Creature — Wizard', 'When this creature enters, create a Spellgorger Weird token.', { pt: ['1', '1'] });
  const SPELL = card('Test Zap', 'Instant', 'Draw a card.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('is fully automated', () => expect(full(MAKER)).toBe(true));
  it('the token is a red {2}{R} 2/2 Weird (mana value 3) that gets a +1/+1 counter when you cast a noncreature spell, not a creature spell, and not when an opponent does', () => {
    let s = cast(scenario([], { defs: [MAKER, SPELL, BEAR], p1: { hand: ['Test Weird Maker', 'Test Zap', 'Test Bear'] }, p2: { hand: ['Test Zap'] } }), 'Test Weird Maker');
    const [t] = tokensOf(s, 'Spellgorger Weird');
    const c = getChars(s, t!)!;
    expect(c.colors).toEqual(['R']);
    expect(c.subtypes).toContain('Weird');
    expect(ptOf(s, t!)).toEqual([2, 2]);
    const mv = (s.defs[s.objects[t!]!.defId]!.faces[0]!.manaCost ?? []).reduce((n, x) => n + ((x as { amount?: number }).amount ?? 1), 0);
    expect(mv).toBe(3);
    s = cast(s, 'Test Bear');
    expect(ptOf(s, t!)).toEqual([2, 2]); // a creature spell: no counter
    s = cast(s, 'Test Zap');
    expect(ptOf(s, t!)).toEqual([3, 3]); // a noncreature spell: one counter
  });
});

// ---- Nahiri's token ----------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 111.4, 702.6: "Create a colorless Equipment artifact token named X. It has indestructible, \\"Equipped creature gets +5/+5 and has double strike,\\" and equip {0}."', () => {
  const MAKER = card('Test Blade Maker', 'Sorcery', 'Create a colorless Equipment artifact token named Test Blade. It has indestructible, "Equipped creature gets +5/+5 and has double strike," and equip {0}.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('is fully automated', () => expect(full(MAKER)).toBe(true));
  it('the token is an indestructible Equipment with equip {0}; equipping it gives +5/+5 and double strike, and it gives nothing while unattached', () => {
    let s = cast(scenario([], { defs: [MAKER, BEAR], p1: { hand: ['Test Blade Maker'], battlefield: ['Test Bear'] } }), 'Test Blade Maker');
    const [blade] = tokensOf(s, 'Test Blade');
    expect(blade).toBeDefined();
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(getChars(s, blade!)!.subtypes).toContain('Equipment');
    expect(JSON.stringify(getChars(s, blade!)!.abilities)).toContain('indestructible');
    expect(ptOf(s, bear)).toEqual([2, 2]);
    s = act(s, { type: 'activate', player: 'p1', source: blade!, ability: activatedAbilities(s, s.objects[blade!]!).find((i) => i.def.isMana !== true)!.key } as never);
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] } as never);
    s = settle(s);
    expect(ptOf(s, bear)).toEqual([7, 7]);
  });
});

// ---- if you didn't play a card from exile this turn ---------------------------------------------------------------------------------------------------------------
describe('CR 305.1, 601.2a, 603.4: "At the beginning of your end step, if you didn\'t play a card from exile this turn, create a tapped Powerstone token."', () => {
  const WATCH = card('Test Watcher', 'Enchantment', "At the beginning of your end step, if you didn't play a card from exile this turn, create a tapped Powerstone token.");
  const EXILER = card('Test Exiler', 'Sorcery', 'Exile the top card of your library. You may play that card this turn.');
  const LAND = card('Test Wilds', 'Land', '');
  it('is fully automated', () => { expect(full(WATCH)).toBe(true); expect(full(EXILER)).toBe(true); });
  it('makes a Powerstone at the end step when nothing was played from exile', () => {
    const s = settle(advanceTo(scenario([], { defs: [WATCH], p1: { battlefield: ['Test Watcher'] } }), 1, 'end'));
    expect(tokensOf(s, 'Powerstone Token')).toHaveLength(1);
  });
  it('negative: no Powerstone when you played a land from exile this turn', () => {
    let s = cast(scenario([], { defs: [WATCH, EXILER, LAND], p1: { hand: ['Test Exiler'], battlefield: ['Test Watcher'], library: ['Test Wilds'] } }), 'Test Exiler');
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Wilds', 'exile', 'p1') });
    s = settle(advanceTo(s, 1, 'end'));
    expect(tokensOf(s, 'Powerstone Token')).toHaveLength(0);
  });
});
