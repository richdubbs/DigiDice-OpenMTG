/**
 * Top-rank round edh-next-92 (code edhn92): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names,
 * design 6.10). Each test is named after the rule it checks, with its negative case. CR cites are from memory of the 2026-09-25 text (no rules/cr folder in this session): unverified.
 *
 *   CR 701.23a-b, 701.24a, 406.3      "Search target player's library for up to three cards, exile them, then that player shuffles." (Sadistic Sacrament)
 *   CR 614.10, 500.11, 611.2a         "Target opponent skips all combat phases of their next turn." (Empty City Ruse)
 *   CR 101.4, 608.2d, 701.21a         "Each player chooses up to two creatures they control, then sacrifices the rest." (Covetous Elegy)
 *   CR 702, 508.1, 603.2c, 608.2d     "... deals 1 damage to each creature that doesn't have first strike, ...", "Whenever you attack with at least two creatures that have flying, ...",
 *                                     "Choose a creature at random that attacked this turn. Destroy that creature." (Path of Mettle // Metzali, Tower of Triumph)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, pass } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';
import { declareAttackers, declareBlockers, lifeOf, passUntil, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const plr = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);
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
type Zone = 'battlefield' | 'hand' | 'graveyard' | 'library' | 'exile';
const names = (s: GameState, name: string, zone: Zone = 'battlefield'): ObjectId[] =>
  Object.values(s.objects).filter((o) => o.zone === zone && s.defs[o.defId]?.name === name).map((o) => o.id);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);

// ---- Sadistic Sacrament -----------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.23a-b, 701.24a, 406.3: "Search target player\'s library for up to three cards, exile them, then that player shuffles."', () => {
  const SACRAMENT = card('Test Sacrament', 'Sorcery', "Search target player's library for up to three cards, exile them, then that player shuffles.");
  const game = () => mpScenario({ players: 3, defs: [SACRAMENT, BEAR], zones: { p1: { hand: ['Test Sacrament'] }, p2: { library: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] } } });
  it('is full', () => expect(full(SACRAMENT), JSON.stringify(SACRAMENT.automation)).toBe(true));
  it('exiles the three cards you pick from the target player\'s library (not yours)', () => {
    const s0 = game();
    const bears = names(s0, 'Test Bear', 'library');
    const s = cast(s0, 'Test Sacrament', { targets: [[plr('p2')]], answers: [{ kind: 'chooseObjects', ids: bears.slice(0, 3) }] });
    expect(names(s, 'Test Bear', 'exile').length).toBe(3);
    expect(s.zones.library['p2']!.length).toBe(s0.zones.library['p2']!.length - 3);
    expect(s.zones.library['p1']!.length).toBe(s0.zones.library['p1']!.length);
  });
  it('negative: up to three means fewer is allowed (none exiled when you pick none)', () => {
    const s0 = game();
    const s = cast(s0, 'Test Sacrament', { targets: [[plr('p2')]], answers: [{ kind: 'chooseObjects', ids: [] }] });
    expect(names(s, 'Test Bear', 'exile').length).toBe(0);
  });
  it('negative: four cards are refused (the maximum is three)', () => {
    const s0 = game();
    const bears = names(s0, 'Test Bear', 'library');
    expect(() => cast(s0, 'Test Sacrament', { targets: [[plr('p2')]], answers: [{ kind: 'chooseObjects', ids: bears.slice(0, 4) }] })).toThrow();
  });
});

// ---- Empty City Ruse --------------------------------------------------------------------------------------------------------------------------------------
describe('CR 614.10, 500.11, 611.2a: "Target opponent skips all combat phases of their next turn."', () => {
  const RUSE = card('Test Ruse', 'Sorcery', 'Target opponent skips all combat phases of their next turn.');
  const game = () => mpScenario({ players: 3, defs: [RUSE], zones: { p1: { hand: ['Test Ruse'] } } });
  /** Passes priority until the given turn number has begun its cleanup, recording "<active player>:<step>" for every priority stop. */
  function steps(s0: GameState, untilTurn: number): string[] {
    let s = s0;
    const seen: string[] = [];
    for (let i = 0; i < 400 && s.turn.number <= untilTurn && !s.result; i++) {
      if (s.pending?.kind !== 'priority') break;
      seen.push(`${s.turn.activePlayer}:${s.turn.step}`);
      s = pass(s);
    }
    return seen;
  }
  it('is full', () => expect(full(RUSE), JSON.stringify(RUSE.automation)).toBe(true));
  it('the target opponent has no combat phase in their next turn; the caster\'s own combat and the opponent\'s later turn are untouched', () => {
    const s0 = game();
    const s = cast(s0, 'Test Ruse', { targets: [[plr('p2')]] });
    const seen = steps(s, 4);
    const p2Turn = seen.filter((x) => x.startsWith('p2:'));
    expect(p2Turn.length).toBeGreaterThan(0);
    expect(p2Turn.some((x) => /combat|attackers/i.test(x)), p2Turn.join(' ')).toBe(false);
  });
  it('negative: without the spell the opponent\'s turn has its combat steps', () => {
    const seen = steps(game(), 3).filter((x) => x.startsWith('p2:'));
    expect(seen.some((x) => /combat|attackers/i.test(x)), seen.join(' ')).toBe(true);
  });
});

// ---- Covetous Elegy ---------------------------------------------------------------------------------------------------------------------------------------
describe('CR 101.4, 608.2d, 701.21a: "Each player chooses up to two creatures they control, then sacrifices the rest. Then you create a tapped Treasure token for each creature your opponents control."', () => {
  const ELEGY = card('Test Elegy', 'Sorcery', 'Each player chooses up to two creatures they control, then sacrifices the rest. Then you create a tapped Treasure token for each creature your opponents control.');
  const TREASURE_NAME = 'Treasure Token';
  const game = () => mpScenario({ players: 3, defs: [ELEGY, BEAR], zones: { p1: { hand: ['Test Elegy'], battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] } } });
  it('is full', () => expect(full(ELEGY), JSON.stringify(ELEGY.automation)).toBe(true));
  it('each player keeps the two creatures they chose and sacrifices the others; the Treasures are counted after the sacrifice', () => {
    const s0 = game();
    const mine = Object.values(s0.objects).filter((o) => o.zone === 'battlefield' && o.controller === 'p1' && s0.defs[o.defId]?.name === 'Test Bear').map((o) => o.id);
    const theirs = Object.values(s0.objects).filter((o) => o.zone === 'battlefield' && o.controller === 'p2' && s0.defs[o.defId]?.name === 'Test Bear').map((o) => o.id);
    const s = cast(s0, 'Test Elegy', { answers: [{ kind: 'chooseObjects', ids: mine.slice(0, 2) }, { kind: 'chooseObjects', ids: theirs.slice(0, 2) }] });
    const left = (p: string) => Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.controller === p && s.defs[o.defId]?.name === 'Test Bear').length;
    expect(left('p1')).toBe(2);
    expect(left('p2')).toBe(2);
    const treasures = Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.controller === 'p1' && s.defs[o.defId]?.name === TREASURE_NAME);
    expect(treasures.length).toBe(2);
    expect(treasures.every((t) => t.tapped)).toBe(true);
  });
  it('negative: a player with fewer than two creatures keeps all of them', () => {
    const s0 = mpScenario({ players: 3, defs: [ELEGY, BEAR], zones: { p1: { hand: ['Test Elegy'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] } } });
    const theirs = Object.values(s0.objects).filter((o) => o.zone === 'battlefield' && o.controller === 'p2' && s0.defs[o.defId]?.name === 'Test Bear').map((o) => o.id);
    const mine = Object.values(s0.objects).filter((o) => o.zone === 'battlefield' && o.controller === 'p1' && s0.defs[o.defId]?.name === 'Test Bear').map((o) => o.id);
    const s = cast(s0, 'Test Elegy', { answers: [{ kind: 'chooseObjects', ids: mine }, { kind: 'chooseObjects', ids: theirs.slice(0, 2) }] });
    expect(Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.controller === 'p1' && s.defs[o.defId]?.name === 'Test Bear').length).toBe(1);
  });
});

// ---- Path of Mettle // Metzali ----------------------------------------------------------------------------------------------------------------------------
describe('CR 702, 205.3: "~ deals 1 damage to each creature that doesn\'t have first strike, double strike, vigilance, or haste."', () => {
  const FLASH = card('Test Flash', 'Sorcery', "~ deals 1 damage to each creature that doesn't have first strike, double strike, vigilance, or haste.");
  const FIRST = card('Test Duelist', 'Creature — Human', 'First strike', ['1', '1']);
  const WATCH = card('Test Watcher', 'Creature — Human', 'Vigilance', ['1', '1']);
  const PLAIN = card('Test Plain', 'Creature — Human', '', ['1', '1']);
  it('is full', () => expect(full(FLASH), JSON.stringify(FLASH.automation)).toBe(true));
  it('kills the 1/1 without any of the four keywords and spares those with one of them', () => {
    const s0 = mpScenario({ players: 3, defs: [FLASH, FIRST, WATCH, PLAIN], zones: { p1: { hand: ['Test Flash'], battlefield: ['Test Duelist', 'Test Plain'] }, p2: { battlefield: ['Test Watcher', 'Test Plain'] } } });
    const s = cast(s0, 'Test Flash');
    expect(names(s, 'Test Plain').length).toBe(0);
    expect(names(s, 'Test Duelist').length).toBe(1);
    expect(names(s, 'Test Watcher').length).toBe(1);
  });
});

describe('CR 508.1, 603.2c: "Whenever you attack with at least two creatures that have flying, you gain 1 life."', () => {
  const HERALD = card('Test Herald', 'Enchantment', 'Whenever you attack with at least two creatures that have flying, you gain 1 life.');
  const WING = card('Test Wing', 'Creature — Bird', 'Flying', ['1', '1']);
  const WALKER = card('Test Walker', 'Creature — Human', '', ['1', '1']);
  it('is full', () => expect(full(HERALD), JSON.stringify(HERALD.automation)).toBe(true));
  const board = (flyers: number) => mpScenario({ players: 3, defs: [HERALD, WING, WALKER], zones: { p1: { battlefield: ['Test Herald', ...Array(flyers).fill('Test Wing'), ...Array(2 - flyers).fill('Test Walker')] } } });
  const attackAll = (s0: GameState): GameState => {
    const s1 = toDeclareAttackers(s0);
    const mine = s1.zones.battlefield.filter((id) => s1.objects[id]!.controller === 'p1' && s1.defs[s1.objects[id]!.defId]?.name !== 'Test Herald');
    return passUntil(declareAttackers(s1, mine.map((id) => [id, 'p2'] as [string, string])), (x) => x.turn.step === 'declareBlockers' || x.turn.step === 'main2', 'blockers');
  };
  it('two flyers in the declaration trigger it (life 20 -> 21)', () => {
    expect(lifeOf(passUntil(attackAll(board(2)), (x) => x.zones.stack.length === 0 && lifeOf(x, 'p1') === 21, 'the trigger resolving', 30), 'p1')).toBe(21);
  });
  it('negative: one flyer and one walker do not trigger it', () => {
    const s = attackAll(board(1));
    let t = s;
    for (let i = 0; i < 12 && t.pending?.kind === 'priority' && t.turn.step !== 'main2'; i++) t = pass(t);
    expect(lifeOf(t, 'p1')).toBe(20);
  });
});
describe('CR 608.2d, 508.1: "Choose a creature at random that attacked this turn. Destroy that creature."', () => {
  const AXE = card('Test Axe', 'Sorcery', 'Choose a creature at random that attacked this turn. Destroy that creature.');
  it('is full', () => expect(full(AXE), JSON.stringify(AXE.automation)).toBe(true));
  it('destroys the creature that attacked this turn (the only one), after combat; a creature that did not attack survives', () => {
    const s0 = mpScenario({ players: 3, defs: [AXE, BEAR], zones: { p1: { hand: ['Test Axe'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } } });
    const s1 = toDeclareAttackers(s0);
    const mine = names(s1, 'Test Bear').filter((id) => s1.objects[id]!.controller === 'p1');
    const s1b = passUntil(declareAttackers(s1, [[mine[0]!, 'p2']]), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    const s2 = passUntil(declareBlockers(s1b, []), (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase');
    const s = cast(s2, 'Test Axe');
    expect(names(s, 'Test Bear').length).toBe(1);
    expect(s.objects[mine[0]!]?.zone ?? 'gone').not.toBe('battlefield');
  });
  it('negative: when nothing attacked this turn nothing is destroyed', () => {
    const s0 = mpScenario({ players: 3, defs: [AXE, BEAR], zones: { p1: { hand: ['Test Axe'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } } });
    expect(names(cast(s0, 'Test Axe'), 'Test Bear').length).toBe(2);
  });
});
