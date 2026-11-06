/**
 * Commander lane each-player, round edh-next-83 (third round): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case.
 *
 *   CR 119.1, 103.4, 107.1a  "~ gets +3/+3 for each opponent whose life total is less than half their starting life total." / "As long as an opponent's life total is less than half ..." (Anya, Merciless Angel)
 *   CR 608.2c, 118.12a, 101.4 "For each player, ~ deals 1 damage to that player unless they pay {B} or {3}." (Lim-Dul's Hex)
 *   CR 603.7a-b, 505.1       "At the beginning of the next main phase this turn, draw a card for each player who was dealt combat damage this turn." (Vivien's Stampede)
 *   CR 406.3, 603.7, 101.4   "Each player exiles all cards from their hand face down and draws seven cards. At the beginning of the next end step, each player discards their hand and returns ..." (Memory Jar, Magus of the Jar)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, pass } from '../../m3/scenario';
import { mpScenario, passUntil } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id)!.name;
const zoneNames = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: PlayerId): string[] => s.zones[zone][p]!.map((id) => nameOf(s, id));
const exiledOf = (s: GameState, p: PlayerId): string[] => s.zones.exile.filter((id) => s.objects[id]!.owner === p).map((id) => s.defs[s.objects[id]!.defId]!.name);
const real = (xs: string[]): string[] => xs.filter((x) => x !== 'Plains');
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const setLife = (p: PlayerId, n: number) => (s: GameState): void => { s.players.find((x) => x.id === p)!.life = n; };

/** Answer decisions until the stack is empty and a player has priority: yes/no per player, costs paid automatically. */
function drive(s0: GameState, yes: Record<string, boolean> = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 300 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
    const p = s.pending as unknown as { kind: string; player: string };
    if (p.kind === 'priority') s = pass(s);
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: yes[p.player] ?? true } as DecisionAnswer);
    else throw new Error(`unexpected decision ${JSON.stringify(s.pending)}`);
  }
  return s;
}
const cast = (s: GameState, name: string, yes: Record<string, boolean> = {}): GameState => drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') } as never), yes);
const power = (s: GameState, name: string): number => Number(getChars(s, find(s, name, 'battlefield', 'p1'))!.power);
const toughness = (s: GameState, name: string): number => Number(getChars(s, find(s, name, 'battlefield', 'p1'))!.toughness);
const hasKw = (s: GameState, name: string, kw: string): boolean => (getChars(s, find(s, name, 'battlefield', 'p1'))!.keywords ?? []).some((k: unknown) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword) === kw);

describe('CR 119.1, 103.4, 107.1a: Anya, Merciless Angel ("less than half their starting life total", Commander starting life 40)', () => {
  const ANGEL = card('Test Anya', 'Legendary Creature — Angel', 'Test Anya gets +3/+3 for each opponent whose life total is less than half their starting life total.\nAs long as an opponent\'s life total is less than half their starting life total, Test Anya has indestructible.'.replace(/Test Anya/g, '~'), { pt: ['4', '4'] });
  const start = (lives: Partial<Record<PlayerId, number>>): GameState => mpScenario({
    players: 3, life: 40, defs: [ANGEL], zones: { p1: { battlefield: ['Test Anya'] } },
    setup: (s) => { for (const [p, n] of Object.entries(lives)) setLife(p as PlayerId, n!)(s); },
  });
  it('is automated', () => { expect(noManual(ANGEL)).toEqual([]); });
  it('counts each opponent below 20 life (half of 40) alone: one opponent +3/+3, two +6/+6, and indestructible', () => {
    expect([power(start({ p2: 19 }), 'Test Anya'), toughness(start({ p2: 19 }), 'Test Anya')]).toEqual([7, 7]);
    expect(power(start({ p2: 19, p3: 5 }), 'Test Anya')).toBe(10);
    expect(hasKw(start({ p2: 19 }), 'Test Anya', 'indestructible')).toBe(true);
  });
  it('negative: exactly half (20) is not less than half, and the controller\'s own low life does not count', () => {
    expect(power(start({ p2: 20, p3: 20 }), 'Test Anya')).toBe(4);
    expect(hasKw(start({ p2: 20 }), 'Test Anya', 'indestructible')).toBe(false);
    expect(power(start({ p1: 3 }), 'Test Anya')).toBe(4);
    expect(hasKw(start({ p1: 3 }), 'Test Anya', 'indestructible')).toBe(false);
  });
  it('uses the game\'s starting life total: in a 20-life game 10 is half', () => {
    const s = mpScenario({ players: 3, life: 20, defs: [ANGEL], zones: { p1: { battlefield: ['Test Anya'] } }, setup: setLife('p2', 9) });
    expect(power(s, 'Test Anya')).toBe(7);
    const t = mpScenario({ players: 3, life: 20, defs: [ANGEL], zones: { p1: { battlefield: ['Test Anya'] } }, setup: setLife('p2', 10) });
    expect(power(t, 'Test Anya')).toBe(4);
  });
});

describe('CR 608.2c, 118.12a, 101.4: "For each player, ~ deals 1 damage to that player unless they pay {B} or {3}." (Lim-Dul\'s Hex)', () => {
  const HEX = card('Test Hex', 'Sorcery', 'For each player, ~ deals 1 damage to that player unless they pay {B} or {3}.');
  const start = (): GameState => mpScenario({
    players: 3, defs: [HEX], zones: { p1: { hand: ['Test Hex'] }, p2: { battlefield: ['Plains', 'Plains', 'Plains'] }, p3: { battlefield: ['Plains', 'Plains', 'Plains'] } },
  });
  it('is automated', () => { expect(noManual(HEX)).toEqual([]); });
  it('each player is asked on their own: one who pays {3} takes nothing, one who declines is dealt 1 damage, and so is the caster who declines', () => {
    const s = cast(start(), 'Test Hex', { p1: false, p2: true, p3: false });
    expect([life(s, 'p1'), life(s, 'p2'), life(s, 'p3')]).toEqual([19, 20, 19]);
  });
  it('negative: everyone declining is everyone dealt 1; nobody is dealt more than 1', () => {
    const s = cast(start(), 'Test Hex', { p1: false, p2: false, p3: false });
    expect([life(s, 'p1'), life(s, 'p2'), life(s, 'p3')]).toEqual([19, 19, 19]);
  });
});

describe('CR 603.7a-b, 505.1: "At the beginning of the next main phase this turn, draw a card for each player who was dealt combat damage this turn." (Vivien\'s Stampede)', () => {
  const STAMPEDE = card('Test Stampede', 'Sorcery', 'Each creature you control gains vigilance until end of turn. At the beginning of the next main phase this turn, draw a card for each player who was dealt combat damage this turn.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const start = (): GameState => mpScenario({
    players: 3, defs: [STAMPEDE, BEAR], zones: { p1: { hand: ['Test Stampede'], battlefield: ['Test Bear'] } },
  });
  it('is automated', () => { expect(noManual(STAMPEDE)).toEqual([]); });
  it('cast before combat: the trigger waits for the second main phase and draws one card for the one player dealt combat damage', () => {
    let s = cast(start(), 'Test Stampede');
    const before = s.zones.hand.p1!.length;
    s = passUntil(s, (t) => t.pending?.kind === 'declareAttackers', 'declare attackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Bear', 'battlefield'), defender: 'p2' }] });
    expect(s.zones.hand.p1!.length).toBe(before);
    s = passUntil(s, (t) => t.turn.step === 'main2', 'second main phase');
    s = drive(s);
    expect(s.zones.hand.p1!.length).toBe(before + 1);
  });
  it('negative: with no combat damage dealt nothing is drawn', () => {
    let s = cast(start(), 'Test Stampede');
    const before = s.zones.hand.p1!.length;
    s = passUntil(s, (t) => t.turn.step === 'main2', 'second main phase');
    s = drive(s);
    expect(s.zones.hand.p1!.length).toBe(before);
  });
});

describe('CR 406.3, 603.7, 101.4: Memory Jar ("each player exiles all cards from their hand face down and draws seven cards ... next end step ...")', () => {
  const JAR = card('Test Jar', 'Instant', 'Each player exiles all cards from their hand face down and draws seven cards. At the beginning of the next end step, each player discards their hand and returns to their hand each card they exiled this way.');
  const start = (): GameState => mpScenario({
    players: 3, defs: [JAR, card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] }), card('Test Gear', 'Artifact', ''), card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] })],
    zones: { p1: { hand: ['Test Jar', 'Test Bear'] }, p2: { hand: ['Test Gear', 'Test Ogre'] }, p3: { hand: [] } },
  });
  it('is automated', () => { expect(noManual(JAR)).toEqual([]); });
  it('exiles every hand, every player draws seven, and at the end step each hand is discarded and the exiled cards come back to their owners', () => {
    let s = cast(start(), 'Test Jar');
    expect(real(exiledOf(s, 'p1'))).toEqual(['Test Bear']);
    expect(real(exiledOf(s, 'p2')).sort()).toEqual(['Test Gear', 'Test Ogre']);
    for (const p of ['p1', 'p2', 'p3'] as const) expect(s.zones.hand[p]!.length).toBe(7);
    expect(real(zoneNames(s, 'hand', 'p1'))).toEqual([]);
    s = passUntil(s, (t) => t.turn.step === 'end', 'end step');
    s = drive(s);
    expect(real(zoneNames(s, 'hand', 'p1'))).toEqual(['Test Bear']);
    expect(real(zoneNames(s, 'hand', 'p2')).sort()).toEqual(['Test Gear', 'Test Ogre']);
    expect(s.zones.hand.p3!.length).toBe(0); // (p3 had no cards in hand; the 7 drawn Plains were discarded)
    expect(zoneNames(s, 'graveyard', 'p2').length).toBe(7);
  });
  it('negative: the cards are not returned before the end step', () => {
    const s = cast(start(), 'Test Jar');
    expect(real(zoneNames(s, 'hand', 'p2'))).toEqual([]);
    expect(s.zones.hand.p2!.length).toBe(7);
  });
});
