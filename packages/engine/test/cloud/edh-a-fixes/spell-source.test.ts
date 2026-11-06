/**
 * Coordinator A's fix of 2026-10-31 (found by edh-b-8's reviewer, NOTES-B 02:00Z): a damage source described as a spell matched any card object, so "If a red
 * spell would deal damage ..." also changed a red creature's ability, combat and fight damage (triggers/filters.ts#stackKindMatches). Played with synthetic
 * cards (invented names, design 6.10), compiled by the game's default compiler. CR cites checked against the 2026-09-25 text.
 *
 *   CR 112.1, 112.1a, 614.1a  "If a red spell would deal damage to a permanent or player, it deals that much damage plus 1 to that permanent or player instead.":
 *                             a red sorcery deals 1 more; a red creature's ability, combat and fight damage do not (a card on the battlefield is not a spell)
 *   CR 112.1, 614.1a, 102.3   "If a spell you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 1
 *                             instead.": your sorcery deals 1 more to the opponent; your creature's ability does not
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, legal, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
type Target = { kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId };
const P2: Target = { kind: 'player', id: 'p2' };
const obj = (id: ObjectId): Target => ({ kind: 'object', id });
const marked = (s: GameState, id: ObjectId): number => s.objects[id]!.damage;

/** Answer the decisions that come up until priority (payments automatic; targets in order). */
function drive(s0: GameState, targets: Target[][] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, Math.max(1, p.min)) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, targets: Target[][] = []): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), targets);
  return s;
}
const cast = (s: GameState, name: string, targets: Target[][] = []): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets), targets);
function activate(s0: GameState, src: ObjectId, targets: Target[][] = []): GameState {
  const a = legal(s0, 'p1', 'activate').find((x) => x.object === src);
  if (a === undefined) throw new Error(`no activation of ${src}`);
  return resolveAll(drive(act(s0, a.action), targets), targets);
}
/** Pass to the declare-attackers decision, attack p2 with `attackers`, and play on until combat damage was dealt (no blocks). */
function attackAndDamage(s0: GameState, attackers: ObjectId[]): GameState {
  let s = s0;
  for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  s = answer(s, { kind: 'declareAttackers', attacks: attackers.map((attacker) => ({ attacker, defender: 'p2' })) });
  for (let i = 0; i < 60 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  return s;
}

const RED_BLASTER = card('Test Red Blaster', 'Creature — Goblin', '{0}: This creature deals 3 damage to any target.', { pt: ['2', '2'], colors: ['R'] });
const BOLT = card('Test Firebolt', 'Sorcery', 'Test Firebolt deals 3 damage to any target.', { colors: ['R'] });
const BRAWL = card('Test Red Brawl', 'Sorcery', 'Target creature you control fights target creature you don\'t control.', { colors: ['R'] });
const BEAR = card('Test Brown Bear', 'Creature — Bear', '', { pt: ['2', '20'] });
const BASE = [RED_BLASTER, BOLT, BRAWL, BEAR];

describe('CR 112.1, 112.1a, 614.1a: "If a red spell would deal damage to a permanent or player, it deals that much damage plus 1 to that permanent or player instead."', () => {
  const VAPORS = card('Test Acid Haze', 'Enchantment', 'If a red spell would deal damage to a permanent or player, it deals that much damage plus 1 to that permanent or player instead.');
  const defs = [...BASE, VAPORS];
  it('is automated', () => expect(full(VAPORS)).toBe(true));
  it('a red sorcery deals 1 more, to a player and to a creature', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Firebolt'], battlefield: ['Test Acid Haze'] }, p2: { battlefield: ['Test Brown Bear'] } });
    expect(life(cast(s0, 'Test Firebolt', [[P2]]), 'p2')).toBe(20 - 4);
    const bear = find(s0, 'Test Brown Bear', 'battlefield', 'p2');
    expect(marked(cast(s0, 'Test Firebolt', [[obj(bear)]]), bear)).toBe(4);
  });
  it('a red creature is not a spell: its ability, combat and fight damage are unchanged', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Red Brawl'], battlefield: ['Test Acid Haze', 'Test Red Blaster'] }, p2: { battlefield: ['Test Brown Bear'] } });
    const red = find(s0, 'Test Red Blaster', 'battlefield', 'p1');
    const bear = find(s0, 'Test Brown Bear', 'battlefield', 'p2');
    expect(life(activate(s0, red, [[P2]]), 'p2')).toBe(20 - 3);
    expect(marked(activate(s0, red, [[obj(bear)]]), bear)).toBe(3);
    expect(marked(cast(s0, 'Test Red Brawl', [[obj(red)], [obj(bear)]]), bear)).toBe(2);
    expect(life(attackAndDamage(s0, [red]), 'p2')).toBe(20 - 2);
  });
});

describe('CR 112.1, 614.1a, 102.3: "If a spell you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 1 instead."', () => {
  const SLAYER = card('Test Spell Slayer', 'Enchantment', 'If a spell you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 1 instead.');
  const defs = [...BASE, SLAYER];
  it('is automated', () => expect(full(SLAYER)).toBe(true));
  it('your sorcery deals 1 more to the opponent; your creature\'s ability does not', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Firebolt'], battlefield: ['Test Spell Slayer', 'Test Red Blaster'] } });
    expect(life(cast(s0, 'Test Firebolt', [[P2]]), 'p2')).toBe(20 - 4);
    expect(life(activate(s0, find(s0, 'Test Red Blaster', 'battlefield', 'p1'), [[P2]]), 'p2')).toBe(20 - 3);
  });
});
