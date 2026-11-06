/**
 * Commander lane edh-c, round edh-c-93 (third pass over EDHREC ranks 28,501-29,000): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler, in 4-player games. Each test is named after the rule it checks and the groups have their negative cases. CR cites are from the Comprehensive
 * Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 119.3, 601.2i, 608.2c        "Destroy target nongreen creature. Its controller loses 3 life if you've cast another black spell this turn."
 *   CR 120.3, 107.3, 608.2h         "~ deals X damage to any target and X damage to itself, where X is the number of Elemental cards in your graveyard."
 *   CR 607.2a, 110.2a, 608.2d       "Whenever a nontoken creature is put into your graveyard from the battlefield, exile that card. ... return a card exiled with ~ to the battlefield."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act as mact, answer as manswer, find as mfind, mpScenario, pass as mpass } from '../../m12/rules/helpers';
import { card, full } from '../cmd3/helpers';

const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const bf = (s: GameState, defId: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));
const exiled = (s: GameState, defId: string): ObjectId[] => s.zones.exile.filter((id) => s.objects[id]!.defId === defId);

interface Script { targets?: ObjectId[]; playerTargets?: PlayerId[]; yes?: boolean; objects?: (options: ObjectId[], prompt: string, state: GameState) => ObjectId[] }
/** Answers whatever is asked, from the script, and passes priority until the stack is empty. */
function run(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  const targets = [...(sc.targets ?? [])];
  const players = [...(sc.playerTargets ?? [])];
  for (let i = 0; i < 300; i++) {
    const p = s.pending;
    if (p === null || p === undefined) break;
    let a: DecisionAnswer | undefined;
    const d = p as unknown as { min?: number; max?: number; prompt: string; player: PlayerId };
    if (p.kind === 'chooseTargets') {
      const t = p as unknown as { objects?: ObjectId[]; min?: number };
      a = { kind: 'chooseTargets', targets: targets.length > 0 ? [{ kind: 'object', id: targets.shift()! }] : players.length > 0 ? [{ kind: 'player', id: players.shift()! }] : (t.objects ?? []).slice(0, t.min ?? 0).map((id) => ({ kind: 'object' as const, id })) } as DecisionAnswer;
    } else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: sc.yes ?? true };
    else if (p.kind === 'chooseObjects') {
      const o = (p as unknown as { options: ObjectId[] }).options;
      a = { kind: 'chooseObjects', ids: sc.objects !== undefined ? sc.objects(o, d.prompt, s) : o.slice(0, d.min ?? 0) };
    } else if (p.kind === 'chooseOption') a = { kind: 'chooseOption', ids: [(p as unknown as { options: { id: string }[] }).options[0]!.id] };
    else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) };
    else if (p.kind === 'declareBlockers') a = { kind: 'declareBlockers', blocks: [] };
    else if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = mpass(s); continue; }
    else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
    s = manswer(s, a);
  }
  return s;
}
const castBy = (s: GameState, name: string, player: PlayerId = 'p1'): GameState => mact(s, { type: 'cast', player, card: mfind(s, name, 'hand', player) });
const spell = (name: string, type: string, text: string, color: 'B' | 'W' | 'R' | 'G'): ReturnType<typeof card> =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [color] } as OracleCard);
const creature = (name: string, type: string, text: string, color: 'B' | 'W' | 'R' | 'G', pt: [string, string]): ReturnType<typeof card> =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [color], power: pt[0], toughness: pt[1] } as OracleCard);
const activate = (s: GameState, name: string): GameState => {
  const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && s.objects[x.object!]?.defId === name);
  return mact(s, (a as unknown as { action: never }).action);
};

describe("CR 119.3, 601.2i, 608.2c: \"Its controller loses 3 life if you've cast another black spell this turn.\"", () => {
  const REAPER = spell('Test Dusk Reaper', 'Sorcery', "Destroy target nongreen creature. Its controller loses 3 life if you've cast another black spell this turn.", 'B');
  const BLACK = spell('Test Black Whisper', 'Instant', 'You gain 1 life.', 'B');
  const WHITE = spell('Test White Whisper', 'Instant', 'You gain 1 life.', 'W');
  const GRUNT = creature('Test Red Grunt', 'Creature — Goblin', '', 'R', ['2', '2']);
  const defs = [REAPER, BLACK, WHITE, GRUNT];
  const start = (hand: string[]): GameState => mpScenario({ defs, zones: { p1: { hand: [...hand, 'Test Dusk Reaper'] }, p2: { battlefield: ['Test Red Grunt'] } } });
  const reap = (hand: string[]): GameState => {
    let s = start(hand);
    for (const n of hand) s = run(castBy(s, n));
    return run(castBy(s, 'Test Dusk Reaper'), { targets: bf(s, 'Test Red Grunt') });
  };
  it('is automated', () => expect(full(REAPER)).toBe(true));
  it('after another black spell this turn, the destroyed creature\'s controller loses 3 life', () => {
    const s = reap(['Test Black Whisper']);
    expect(bf(s, 'Test Red Grunt')).toHaveLength(0);
    expect(lifeOf(s, 'p2')).toBe(17);
  });
  it('negative: with no other spell cast, the creature is destroyed and no life is lost', () => {
    const s = reap([]);
    expect(bf(s, 'Test Red Grunt')).toHaveLength(0);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('negative: another spell that is not black (a white one) does not count; the Reaper itself is no "other" spell', () => {
    const s = reap(['Test White Whisper']);
    expect(bf(s, 'Test Red Grunt')).toHaveLength(0);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});

describe('CR 120.3, 107.3, 608.2h: "~ deals X damage to any target and X damage to itself, where X is the number of Elemental cards in your graveyard."', () => {
  const SHAMAN = creature('Test Ember Shaman', 'Creature — Human Shaman', 'Haste\n{0}, {T}: ~ deals X damage to any target and X damage to itself, where X is the number of Elemental cards in your graveyard.', 'R', ['1', '6']);
  const ELEM = creature('Test Cinder Elemental', 'Creature — Elemental', '', 'R', ['1', '1']);
  const OTHER = creature('Test Plain Goblin', 'Creature — Goblin', '', 'R', ['1', '1']);
  const defs = [SHAMAN, ELEM, OTHER];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Ember Shaman'], graveyard: ['Test Cinder Elemental', 'Test Cinder Elemental', 'Test Plain Goblin'] } } });
  it('is automated', () => expect(full(SHAMAN)).toBe(true));
  it('with two Elementals (and a Goblin) in the graveyard it deals 2 to the target player and 2 to itself', () => {
    const s = run(activate(start(), 'Test Ember Shaman'), { playerTargets: ['p2'] });
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(s.objects[bf(s, 'Test Ember Shaman')[0]!]!.damage).toBe(2);
  });
  it('negative: with no Elemental in the graveyard it deals no damage to the target or to itself', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Ember Shaman'], graveyard: ['Test Plain Goblin'] } } });
    const s = run(activate(s0, 'Test Ember Shaman'), { playerTargets: ['p2'] });
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(s.objects[bf(s, 'Test Ember Shaman')[0]!]!.damage).toBe(0);
  });
});

describe('CR 607.2a, 110.2a, 608.2d: "return a card exiled with ~ to the battlefield" (Purgatory-style)', () => {
  const PURG = card('Test Grim Purgatory', 'Enchantment', 'Whenever a nontoken creature is put into your graveyard from the battlefield, exile that card.\nAt the beginning of your upkeep, you may pay {0} and 2 life. If you do, return a card exiled with ~ to the battlefield.');
  const BEAR = creature('Test Grey Bear', 'Creature — Bear', '', 'G', ['2', '2']);
  const KILL = spell('Test Quick Kill', 'Instant', 'Destroy target creature.', 'B');
  const defs = [PURG, BEAR, KILL];
  it('is automated', () => expect(full(PURG)).toBe(true));
  it('a nontoken creature that dies is exiled with it (it does go to the graveyard first, CR 700.4)', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Grim Purgatory', 'Test Grey Bear'], hand: ['Test Quick Kill'] } } });
    const s = run(castBy(s0, 'Test Quick Kill'), { targets: bf(s0, 'Test Grey Bear') });
    expect(bf(s, 'Test Grey Bear')).toHaveLength(0);
    expect(exiled(s, 'Test Grey Bear')).toHaveLength(1);
  });
  it('returning it: the exiled card comes back onto the battlefield under the controller of the ability (CR 110.2a); with nothing exiled the ability does nothing', () => {
    const VAULT = card('Test Grave Vault', 'Artifact', 'Whenever a nontoken creature is put into your graveyard from the battlefield, exile that card.\n{0}: Return a card exiled with ~ to the battlefield.');
    const d2 = [VAULT, BEAR, KILL];
    const s0 = mpScenario({ defs: d2, zones: { p1: { battlefield: ['Test Grave Vault', 'Test Grey Bear'], hand: ['Test Quick Kill'] } } });
    const dead = run(castBy(s0, 'Test Quick Kill'), { targets: bf(s0, 'Test Grey Bear') });
    expect(exiled(dead, 'Test Grey Bear')).toHaveLength(1);
    const back = run(activate(dead, 'Test Grave Vault'), { objects: (o) => o.slice(0, 1) });
    expect(bf(back, 'Test Grey Bear', 'p1')).toHaveLength(1);
    expect(exiled(back, 'Test Grey Bear')).toHaveLength(0);
    const again = run(activate(back, 'Test Grave Vault'), { objects: (o) => o.slice(0, 1) }); // (nothing is left exiled with it)
    expect(bf(again, 'Test Grey Bear')).toHaveLength(1);
  });
  it('negative: a creature of an opponent that dies is not exiled (only creatures put into YOUR graveyard)', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Grim Purgatory'], hand: ['Test Quick Kill'] }, p2: { battlefield: ['Test Grey Bear'] } } });
    const s = run(castBy(s0, 'Test Quick Kill'), { targets: bf(s0, 'Test Grey Bear') });
    expect(exiled(s, 'Test Grey Bear')).toHaveLength(0);
    expect(s.zones.graveyard['p2']!.map((id) => s.objects[id]!.defId)).toContain('Test Grey Bear');
  });
});
