/**
 * Commander lane edh-c, round edh-c-58 (EDHREC ranks 19,501 to 20,000): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler. p1 is the active player of turn 1. Each test is named after the rule it checks and has its negative case. CR cites checked against
 * the Comprehensive Rules of 2026-09-25.
 *
 *   CR 109.1, 205.3m, 608.2c       "{0}: Green creatures and blue creatures you control gain first strike until end of turn."
 *   CR 608.2d, 611.2c, 613.4c      "{0}: Until end of turn, ~ gets -1/-1 and gains your choice of flying, vigilance, deathtouch, or haste."
 *   CR 601.2h, 614.1c, 122.6       "~ enters with a +1/+1 counter on it for each mana spent to cast it."
 *   CR 102.2, 102.3, 601.2f        "If an opponent controls at least two more creatures than you, this spell costs {3} less to cast."
 *   CR 608.2c, 613.4b, 107.3       "Whenever ~ attacks, you may sacrifice another creature. If you do, creatures you control have base power and toughness X/X until end of turn, where X is the sacrificed creature's mana value."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, legal, pass } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

interface Opts { targets?: TargetChoice[][]; answers?: DecisionAnswer[] }
function settle(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && o.targets && o.targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets.shift()! });
    else if (o.answers && o.answers.length > 0) s = answer(s, o.answers.shift()!);
    else break;
  }
  return s;
}
const queued = (o: Opts): Opts => ({ targets: [...(o.targets ?? [])], answers: [...(o.answers ?? [])] });
function drain(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), o);
  return s;
}
function cast(s0: GameState, name: string, opts: Opts = {}, player = 'p1'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) } as never), q), q);
}
function activate(s0: GameState, source: ObjectId, opts: Opts = {}, ability = 'p:0:0', player = 'p1'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'activate', player, source, ability } as never), q), q);
}
const castable = (s: GameState, name: string, player = 'p1'): boolean => legal(s, player, 'cast').some((a) => a.object === find(s, name, 'hand', player));
const byName = (s: GameState, name: string, zone: 'battlefield' | 'hand' | 'graveyard' | 'exile' = 'battlefield', owner?: string): ObjectId =>
  Object.values(s.objects).find((o) => s.defs[o.defId]?.name === name && o.zone === zone && (owner === undefined || o.owner === owner))!.id;
const stat = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const kw = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword?: string }).keyword ?? ''));
const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]!.counters[kind] ?? 0;

const GREEN = card('Test Green Bear', 'Creature — Bear', '', ['2', '2'], '{0}', ['G']);
const BLUE = card('Test Blue Bird', 'Creature — Bird', '', ['1', '1'], '{0}', ['U']);
const RED = card('Test Red Imp', 'Creature — Imp', '', ['1', '1'], '{0}', ['R']);
const ENCH = card('Test Hobgoblin Rise', 'Enchantment', '{0}: Green creatures and blue creatures you control gain first strike until end of turn.');
const SHIFTER = card('Test Shifter', 'Artifact Creature — Shapeshifter', '{0}: Until end of turn, ~ gets -1/-1 and gains your choice of flying, vigilance, deathtouch, or haste.', ['3', '3']);
const SPLIT = card('Test Split Serpent', 'Legendary Creature — Serpent', '~ enters with a +1/+1 counter on it for each mana spent to cast it.', ['0', '0'], '{2}{G}', ['G']);
const FREE_SPLIT = card('Test Free Serpent', 'Creature — Serpent', '~ enters with a +1/+1 counter on it for each mana spent to cast it.', ['1', '1'], '{0}', ['G']);
const AVATAR = card('Test Avatar', 'Creature — Avatar', 'If an opponent controls at least two more creatures than you, this spell costs {3} less to cast.', ['3', '3'], '{3}', ['G']);
const MEEP = card('Test Alien', 'Legendary Creature — Alien', 'Whenever ~ attacks, you may sacrifice another creature. If you do, creatures you control have base power and toughness X/X until end of turn, where X is the sacrificed creature\'s mana value.', ['1', '1']);
const WILDS = card('Test Wilds', 'Basic Land — Forest', '');
const WATCH = card('Test Watchtower', 'Land', '{T}: Draw a card. Activate only if an opponent controls at least two more lands than you.');
const COSTLY = card('Test Costly Ally', 'Creature — Soldier', '', ['1', '1'], '{4}');

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [GREEN, BLUE, RED, ENCH, SHIFTER, SPLIT, FREE_SPLIT, AVATAR, MEEP, COSTLY, WILDS, WATCH]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 109.1, 608.2c: "Green creatures and blue creatures you control gain first strike until end of turn."', () => {
  const game = () => mpScenario({ players: 3, defs: [GREEN, BLUE, RED, ENCH], zones: { p1: { battlefield: ['Test Hobgoblin Rise', 'Test Green Bear', 'Test Blue Bird', 'Test Red Imp'] }, p2: { battlefield: ['Test Green Bear'] } } });
  it('your green and blue creatures gain first strike; your red creature and the opponent\'s green creature do not', () => {
    const s0 = game();
    const s = activate(s0, byName(s0, 'Test Hobgoblin Rise'));
    expect(kw(s, byName(s, 'Test Green Bear', 'battlefield', 'p1'))).toContain('first strike');
    expect(kw(s, byName(s, 'Test Blue Bird'))).toContain('first strike');
    expect(kw(s, byName(s, 'Test Red Imp'))).not.toContain('first strike');
    expect(kw(s, byName(s, 'Test Green Bear', 'battlefield', 'p2'))).not.toContain('first strike');
  });
  it('negative: before the ability is activated nothing has first strike', () => {
    const s0 = game();
    expect(kw(s0, byName(s0, 'Test Blue Bird'))).not.toContain('first strike');
  });
});

describe('CR 608.2d, 611.2c, 613.4c: "Until end of turn, ~ gets -1/-1 and gains your choice of flying, vigilance, deathtouch, or haste."', () => {
  const game = () => mpScenario({ players: 3, defs: [SHIFTER], zones: { p1: { battlefield: ['Test Shifter'] } } });
  const choose = (i: number): DecisionAnswer => ({ kind: 'chooseOption', ids: [String(i)] });
  it('it is a 2/2 with the one keyword chosen (deathtouch, then haste) and none of the others', () => {
    const s0 = game();
    const id = byName(s0, 'Test Shifter');
    const a = activate(s0, id, { answers: [choose(2)] });
    expect(stat(a, id)).toBe('2/2');
    expect(kw(a, id)).toContain('deathtouch');
    for (const other of ['flying', 'vigilance', 'haste']) expect(kw(a, id)).not.toContain(other);
    const b = activate(s0, id, { answers: [choose(3)] });
    expect(kw(b, id)).toContain('haste');
    expect(kw(b, id)).not.toContain('deathtouch');
  });
  it('negative: activated twice it is a 1/1 with the two keywords chosen', () => {
    const s0 = game();
    const id = byName(s0, 'Test Shifter');
    const a = activate(activate(s0, id, { answers: [choose(0)] }), id, { answers: [choose(1)] });
    expect(stat(a, id)).toBe('1/1');
    expect(kw(a, id)).toEqual(expect.arrayContaining(['flying', 'vigilance']));
  });
});

describe('CR 601.2h, 614.1c, 122.6: "~ enters with a +1/+1 counter on it for each mana spent to cast it."', () => {
  const lands = ['Test Wilds', 'Test Wilds', 'Test Wilds'];
  it('cast with three mana it enters with three +1/+1 counters', () => {
    const s0 = mpScenario({ players: 3, defs: [SPLIT, WILDS], zones: { p1: { hand: ['Test Split Serpent'], battlefield: lands } } });
    const s = cast(s0, 'Test Split Serpent');
    const id = byName(s, 'Test Split Serpent');
    expect(counters(s, id, '+1/+1')).toBe(3);
    expect(stat(s, id)).toBe('3/3');
  });
  it('negative: cast for no mana it enters with no counters', () => {
    const s0 = mpScenario({ players: 3, defs: [FREE_SPLIT], zones: { p1: { hand: ['Test Free Serpent'] } } });
    const s = cast(s0, 'Test Free Serpent');
    expect(counters(s, byName(s, 'Test Free Serpent'), '+1/+1')).toBe(0);
    expect(stat(s, byName(s, 'Test Free Serpent'))).toBe('1/1');
  });
});

describe('CR 102.2, 102.3, 601.2f: "If an opponent controls at least two more creatures than you, this spell costs {3} less to cast."', () => {
  const crowd = (n: number): string[] => Array.from({ length: n }, () => 'Test Green Bear');
  const game = (mine: number, p2: number, p3: number) => mpScenario({ players: 3, defs: [AVATAR, GREEN], zones: { p1: { hand: ['Test Avatar'], battlefield: crowd(mine) }, p2: { battlefield: crowd(p2) }, p3: { battlefield: crowd(p3) } } });
  it('one opponent with two more creatures: the {3} spell is cast for nothing', () => {
    expect(castable(game(1, 3, 0), 'Test Avatar')).toBe(true);
    expect(castable(game(0, 5, 0), 'Test Avatar')).toBe(true);
  });
  it('negative: one more, or two opponents with one more each (each judged alone), or no creatures at all: it costs {3}', () => {
    expect(castable(game(1, 2, 0), 'Test Avatar')).toBe(false);
    expect(castable(game(1, 2, 2), 'Test Avatar')).toBe(false);
    expect(castable(game(0, 0, 0), 'Test Avatar')).toBe(false);
  });
});

describe('CR 608.2c, 613.4b, 107.3: "Whenever ~ attacks, you may sacrifice another creature. If you do, creatures you control have base power and toughness X/X until end of turn, where X is the sacrificed creature\'s mana value."', () => {
  const game = () => mpScenario({ players: 3, defs: [MEEP, COSTLY, GREEN], zones: { p1: { battlefield: ['Test Alien', 'Test Costly Ally', 'Test Green Bear'] } } });
  const attack = (s0: GameState, sacrifice: boolean): GameState => {
    let s = s0;
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s, {});
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: byName(s, 'Test Alien'), defender: 'p2' }] } as never);
    const costly = byName(s0, 'Test Costly Ally');
    for (let i = 0; i < 40 && s.pending && s.pending.kind !== 'declareBlockers'; i++) {
      const p = s.pending;
      if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); }
      else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: sacrifice });
      else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [costly] });
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else break;
    }
    return s;
  };
  it('sacrificing a creature of mana value 4 makes every creature you control 4/4 until end of turn', () => {
    const s = attack(game(), true);
    expect(Object.values(s.objects).some((o) => s.defs[o.defId]?.name === 'Test Costly Ally' && o.zone === 'graveyard')).toBe(true);
    expect(stat(s, byName(s, 'Test Alien'))).toBe('4/4');
    expect(stat(s, byName(s, 'Test Green Bear'))).toBe('4/4');
  });
  it('negative: declining the sacrifice leaves every creature as it was', () => {
    const s = attack(game(), false);
    expect(stat(s, byName(s, 'Test Alien'))).toBe('1/1');
    expect(stat(s, byName(s, 'Test Green Bear'))).toBe('2/2');
    expect(Object.values(s.objects).some((o) => s.defs[o.defId]?.name === 'Test Costly Ally' && o.zone === 'battlefield')).toBe(true);
  });
});

describe('CR 602.5b, 102.2: "Activate only if an opponent controls at least two more lands than you."', () => {
  const lands = (n: number): string[] => Array.from({ length: n }, () => 'Test Wilds');
  const game = (p2: number, p3: number) => mpScenario({ players: 3, defs: [WATCH, WILDS], zones: { p1: { battlefield: ['Test Watchtower'] }, p2: { battlefield: lands(p2) }, p3: { battlefield: lands(p3) } } });
  const can = (s: GameState): boolean => legal(s, 'p1', 'activate').some((a) => a.label.toLowerCase().includes('draw'));
  it('one opponent with two more lands than you (you control one): you can activate it', () => {
    expect(can(game(3, 0))).toBe(true);
  });
  it('negative: one more land, or two opponents with one more each, cannot', () => {
    expect(can(game(2, 0))).toBe(false);
    expect(can(game(2, 2))).toBe(false);
  });
});
