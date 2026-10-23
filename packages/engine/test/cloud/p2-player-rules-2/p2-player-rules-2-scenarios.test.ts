/**
 * p2-player-rules-2 (Phase 2 lane p2-player-rules): clash (CR 701.30) played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case.
 *
 *   CR 701.30a-c   both players reveal their top card; you win only with a greater mana value (a tie is not a win); each keeps it on top or puts it on the bottom
 *   CR 701.30c     a player with an empty library reveals nothing: the other player wins with any card
 *   CR 608.2c      "If you win, X. Otherwise, Y.": exactly one branch runs
 *   CR 608.2n      "If you win, return ~ to its owner's hand": the spell goes to its owner's hand, not the graveyard
 *   CR 608.2h      "you gain life equal to that creature's toughness" after destroying it: its last known toughness
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { answer, find, life, pass, scenario, zoneNames } from '../../m3/scenario';
import { castCard } from '../../m5/announce/support';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);
}
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'))
  && (d.automation.faces ?? []).every((f) => f.abilities.every((a) => a.level !== 'manual' && a.manual.length === 0));

/** Answer decisions (payment automatic; a clash's top-or-bottom question by `bottom`, per player; targets as given); stop at the next priority. */
function settle(s0: GameState, bottom: Record<string, boolean> = {}, targets: { kind: 'object' | 'player'; id: string }[] = []): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    const p = s.pending as unknown as { kind: string; player: string; options: string[]; min: number };
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets } as never);
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: bottom[p.player] === true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else break;
  }
  return s;
}
function resolveAll(s0: GameState, bottom: Record<string, boolean> = {}): GameState {
  let s = s0;
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, bottom);
  return s;
}

const SAGE = card('Test Sage Study', 'Sorcery', 'Draw a card. Clash with an opponent. If you win, return ~ to its owner\'s hand.');
const DUEL = card('Test Duel of Wits', 'Sorcery', 'Clash with an opponent. If you win, you gain 3 life. Otherwise, you lose 1 life.');
const BLIGHT = card('Test Root Blight', 'Sorcery', 'Destroy target creature. Clash with an opponent. If you win, you gain life equal to that creature\'s toughness.');
const ONE = card('Test Pebble', 'Artifact', '', undefined, '{1}');
const THREE = card('Test Stone', 'Artifact', '', undefined, '{3}');
const FIVE = card('Test Boulder', 'Artifact', '', undefined, '{5}');
const OX = card('Test Ox', 'Creature — Ox', '', ['2', '6'], '{4}');
const defs = [SAGE, DUEL, BLIGHT, ONE, THREE, FIVE, OX];

describe('CR 701.30a-c, 608.2n: "Clash with an opponent. If you win, return ~ to its owner\'s hand."', () => {
  it('is automated; with the greater mana value you win and the spell returns to your hand', () => {
    expect(automated(SAGE)).toBe(true);
    let s = scenario([], { defs, p1: { hand: ['Test Sage Study'], library: ['Test Pebble', 'Test Boulder'] }, p2: { library: ['Test Stone'] } });
    s = resolveAll(settle(castCard(s, 'Test Sage Study')));
    expect(zoneNames(s, 'hand', 'p1')).toContain('Test Sage Study');
    expect(zoneNames(s, 'graveyard', 'p1')).not.toContain('Test Sage Study');
    expect(zoneNames(s, 'library', 'p1')[0]).toBe('Test Boulder'); // kept on top
  });
  it('a lower mana value or a tie is not a win: the spell goes to the graveyard', () => {
    for (const theirs of ['Test Boulder', 'Test Stone']) {
      let s = scenario([], { defs, p1: { hand: ['Test Sage Study'], library: ['Test Pebble', 'Test Stone'] }, p2: { library: [theirs] } });
      s = resolveAll(settle(castCard(s, 'Test Sage Study')));
      expect(zoneNames(s, 'graveyard', 'p1'), theirs).toContain('Test Sage Study');
    }
  });
  it('an opponent with an empty library reveals nothing, so any card of yours wins; with your own library empty you don\'t win', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Sage Study'], library: ['Test Pebble', 'Test Pebble'] } });
    s = tweak(s, (x) => { for (const id of x.zones.library['p2']!) delete x.objects[id]; x.zones.library['p2'] = []; });
    s = resolveAll(settle(castCard(s, 'Test Sage Study')));
    expect(zoneNames(s, 'hand', 'p1')).toContain('Test Sage Study');
    let t = scenario([], { defs, p1: { hand: ['Test Sage Study'] }, p2: { library: ['Test Pebble'] } });
    t = tweak(t, (x) => { for (const id of x.zones.library['p1']!) delete x.objects[id]; x.zones.library['p1'] = []; });
    t = resolveAll(settle(castCard(t, 'Test Sage Study')));
    expect(zoneNames(t, 'graveyard', 'p1')).toContain('Test Sage Study');
  });
  it('each player may put the revealed card on the bottom of their library', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Sage Study'], library: ['Test Pebble', 'Test Boulder'] }, p2: { library: ['Test Stone'] } });
    s = resolveAll(settle(castCard(s, 'Test Sage Study'), { p1: true, p2: true }), { p1: true, p2: true });
    const mine = zoneNames(s, 'library', 'p1');
    const theirs = zoneNames(s, 'library', 'p2');
    expect(mine[mine.length - 1]).toBe('Test Boulder');
    expect(theirs[theirs.length - 1]).toBe('Test Stone');
    expect(theirs[0]).not.toBe('Test Stone');
  });
});

describe('CR 608.2c: "If you win, you gain 3 life. Otherwise, you lose 1 life."', () => {
  it('exactly one branch runs', () => {
    expect(automated(DUEL)).toBe(true);
    let won = scenario([], { defs, p1: { hand: ['Test Duel of Wits'], library: ['Test Boulder'] }, p2: { library: ['Test Pebble'] } });
    const l0 = life(won, 'p1');
    won = resolveAll(settle(castCard(won, 'Test Duel of Wits')));
    expect(life(won, 'p1')).toBe(l0 + 3);
    let lost = scenario([], { defs, p1: { hand: ['Test Duel of Wits'], library: ['Test Pebble'] }, p2: { library: ['Test Boulder'] } });
    lost = resolveAll(settle(castCard(lost, 'Test Duel of Wits')));
    expect(life(lost, 'p1')).toBe(l0 - 1);
  });
});

describe('CR 608.2h: "Destroy target creature. Clash ... If you win, you gain life equal to that creature\'s toughness."', () => {
  it('the destroyed creature\'s last known toughness is gained when you win; nothing when you don\'t', () => {
    expect(automated(BLIGHT)).toBe(true);
    let s = scenario([], { defs, p1: { hand: ['Test Root Blight'], library: ['Test Boulder'] }, p2: { battlefield: ['Test Ox'], library: ['Test Pebble'] } });
    const ox = find(s, 'Test Ox', 'battlefield', 'p2');
    const l0 = life(s, 'p1');
    s = resolveAll(settle(castCard(s, 'Test Root Blight'), {}, [{ kind: 'object', id: ox }]));
    expect(zoneNames(s, 'graveyard', 'p2')).toContain('Test Ox');
    expect(life(s, 'p1')).toBe(l0 + 6);
    let t = scenario([], { defs, p1: { hand: ['Test Root Blight'], library: ['Test Pebble'] }, p2: { battlefield: ['Test Ox'], library: ['Test Boulder'] } });
    t = resolveAll(settle(castCard(t, 'Test Root Blight'), {}, [{ kind: 'object', id: find(t, 'Test Ox', 'battlefield', 'p2') }]));
    expect(life(t, 'p1')).toBe(l0);
  });
});
