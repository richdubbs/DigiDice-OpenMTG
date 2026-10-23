/**
 * Phase 2 lane p2-replace-damage, round p2-replace-damage-4: the round's prevention readings played through the engine with synthetic cards (invented names, design
 * 6.10), compiled by the game's default compiler. Each test is named after the rule it checks and has its negative case. CR cites from memory, unverified (rules/cr/
 * is not in the cloud checkout).
 *
 *   CR 615.1a, 120.3         "Prevent all damage that would be dealt to creatures you control by sources you control.": your sources only
 *   CR 615.1a, 500.1         "During your turn, prevent all damage that would be dealt to you.": not during an opponent's turn
 *   CR 615.7                 "The next time ~ would deal damage to you this turn, prevent that damage.": once, and only its damage to you
 *   CR 609.7a, 615.7         "The next time an artifact source of your choice would deal damage to you this turn, prevent that damage.": only an artifact is offered
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, advanceTo, answer, find, legal, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
type Target = { kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId };
const P1: Target = { kind: 'player', id: 'p1' };
const P2: Target = { kind: 'player', id: 'p2' };
const obj = (id: ObjectId): Target => ({ kind: 'object', id });
const marked = (s: GameState, id: ObjectId): number => s.objects[id]!.damage;

/** Answer the decisions that come up until priority (payments automatic; targets in order; object choices from `objects` in order, else the first allowed). */
function drive(s0: GameState, targets: Target[][] = [], objects: ObjectId[][] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: objects.shift() ?? p.options.slice(0, Math.max(1, p.min)) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, targets: Target[][] = [], objects: ObjectId[][] = []): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), targets, objects);
  return s;
}
const cast = (s: GameState, name: string, targets: Target[][] = [], objects: ObjectId[][] = []): GameState =>
  resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets, objects), targets, objects);
/** `player` activates the first ability of `src` (p2 gets priority by p1 passing first), and the stack resolves. */
function activate(s0: GameState, src: ObjectId, targets: Target[][] = [], player: PlayerId = 'p1'): GameState {
  let s = s0;
  if (player === 'p2') s = pass(s);
  const a = legal(s, player, 'activate').find((x) => x.object === src);
  if (a === undefined) throw new Error(`no activation of ${src} for ${player}`);
  return resolveAll(drive(act(s, a.action), targets), targets);
}
/** Pass to the declare-attackers decision, attack p2 with `attackers`, and play on until combat damage was dealt (no blocks). */
function attackAndDamage(s0: GameState, attackers: ObjectId[]): GameState {
  let s = s0;
  for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  s = answer(s, { kind: 'declareAttackers', attacks: attackers.map((attacker) => ({ attacker, defender: 'p2' })) });
  for (let i = 0; i < 60 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  return s;
}

const RED_BLASTER = card('Test Red Blaster', 'Creature — Goblin', '{0}: This creature deals 3 damage to any target.', { pt: ['1', '1'], colors: ['R'] });
const IRON_BLASTER = card('Test Iron Blaster', 'Artifact — Contraption', '{0}: This artifact deals 3 damage to any target.');
const BEAR = card('Test Brown Bear', 'Creature — Bear', '', { pt: ['2', '20'] });
const BASE = [RED_BLASTER, IRON_BLASTER, BEAR];

describe('CR 615.1a, 120.3: "Prevent all damage that would be dealt to creatures you control by sources you control."', () => {
  const LIGHT = card('Test Gentle Light', 'Enchantment', 'Prevent all damage that would be dealt to creatures you control by sources you control.');
  const defs = [...BASE, LIGHT];
  it('is automated', () => expect(full(LIGHT)).toBe(true));
  it('your source deals your creature no damage; the opponent\'s source does, and your source still damages the opponent\'s creature', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Gentle Light', 'Test Red Blaster', 'Test Brown Bear'] }, p2: { battlefield: ['Test Red Blaster', 'Test Brown Bear'] } });
    const mine = find(s0, 'Test Brown Bear', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Brown Bear', 'battlefield', 'p2');
    expect(marked(activate(s0, find(s0, 'Test Red Blaster', 'battlefield', 'p1'), [[obj(mine)]]), mine)).toBe(0);
    expect(marked(activate(s0, find(s0, 'Test Red Blaster', 'battlefield', 'p1'), [[obj(theirs)]]), theirs)).toBe(3);
    expect(marked(activate(s0, find(s0, 'Test Red Blaster', 'battlefield', 'p2'), [[obj(mine)]], 'p2'), mine)).toBe(3);
  });
});

describe('CR 615.1a, 500.1: "During your turn, prevent all damage that would be dealt to you."', () => {
  const SANCTUARY = card('Test Quiet Shrine', 'Enchantment', 'During your turn, prevent all damage that would be dealt to you.');
  const defs = [...BASE, SANCTUARY];
  it('is automated', () => expect(full(SANCTUARY)).toBe(true));
  it('on your turn you are dealt no damage; on the opponent\'s turn you are', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Quiet Shrine'] }, p2: { battlefield: ['Test Red Blaster'] } });
    const red = find(s0, 'Test Red Blaster', 'battlefield', 'p2');
    expect(life(activate(s0, red, [[P1]], 'p2'), 'p1')).toBe(20);
    const s1 = advanceTo(s0, 2, 'main1');
    const a = legal(s1, 'p2', 'activate').find((x) => x.object === red)!;
    expect(life(resolveAll(drive(act(s1, a.action), [[P1]]), [[P1]]), 'p1')).toBe(20 - 3);
  });
});

describe('CR 615.7: "The next time ~ would deal damage to you this turn, prevent that damage."', () => {
  const MERC = card('Test Hired Blade', 'Creature — Human Mercenary', '{0}: This creature deals 3 damage to any target.\n{1}: The next time this creature would deal damage to you this turn, prevent that damage.', { pt: ['3', '3'] });
  const defs = [...BASE, MERC];
  it('is automated', () => expect(full(MERC)).toBe(true));
  it('its next damage to you is prevented once; its damage to the opponent is not', () => {
    const s0 = scenario(['Plains'], { defs, p1: { battlefield: ['Test Hired Blade', 'Plains'] } });
    const merc = find(s0, 'Test Hired Blade', 'battlefield');
    const ab = legal(s0, 'p1', 'activate').filter((x) => x.object === merc);
    const shield = ab.find((x) => x.label.includes('next time'))!;
    const deal = (s: GameState, t: Target): GameState => { const d = legal(s, 'p1', 'activate').find((x) => x.object === merc && x.label.includes('deals 3'))!; return resolveAll(drive(act(s, d.action), [[t]]), [[t]]); };
    const s1 = resolveAll(drive(act(s0, shield.action)));
    expect(life(deal(s1, P2), 'p2')).toBe(20 - 3);
    const s2 = deal(s1, P1);
    expect(life(s2, 'p1')).toBe(20);
    expect(life(deal(s2, P1), 'p1')).toBe(20 - 3);
  });
});

describe('CR 609.7a, 615.7: "The next time an artifact source of your choice would deal damage to you this turn, prevent that damage."', () => {
  const RUNE = card('Test Iron Ward', 'Enchantment', '{0}: The next time an artifact source of your choice would deal damage to you this turn, prevent that damage.');
  const IDOL = card('Test Copper Idol', 'Artifact', '');
  const defs = [...BASE, RUNE];
  it('is automated', () => expect(full(RUNE)).toBe(true));
  it('only artifacts are offered; the chosen one\'s next damage to you is prevented, once', () => {
    const s0 = scenario([], { defs: [...defs, IDOL], p1: { battlefield: ['Test Iron Ward', 'Test Iron Blaster', 'Test Red Blaster', 'Test Copper Idol'] } });
    const iron = find(s0, 'Test Iron Blaster', 'battlefield');
    const idol = find(s0, 'Test Copper Idol', 'battlefield');
    const rune = find(s0, 'Test Iron Ward', 'battlefield');
    let s = act(s0, legal(s0, 'p1', 'activate').find((x) => x.object === rune)!.action);
    let offered: ObjectId[] | undefined;
    for (let i = 0; i < 30 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
      const p = s.pending!;
      if (p.kind === 'chooseObjects') { offered = [...p.options]; s = answer(s, { kind: 'chooseObjects', ids: [iron] }); }
      else if (p.kind === 'priority') s = pass(s);
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${p.kind}`);
    }
    expect([...(offered ?? [])].sort()).toEqual([iron, idol].sort());
    const s2 = activate(s, iron, [[P1]]);
    expect(life(s2, 'p1')).toBe(20);
    expect(life(activate(s2, iron, [[P1]]), 'p1')).toBe(20 - 3);
  });
});
