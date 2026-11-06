/**
 * edh-c-107 (Commander lane edh-c, EDHREC ranks 18,001-18,500, later pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10).
 *
 *   CR 401.4, 400.3   "Put target card from a graveyard on your choice of the top or bottom of its owner's library." (Not Forgotten): YOU choose the end, the card goes to its OWNER's library
 */
import { describe, expect, it } from 'vitest';
import { put, answer } from '../../m3/scenario';
import type { GameState, PlayerId } from '../../../src/index';
import { card, cast, find, full, obj, passBoth, resolveAll, scenario } from '../r3-cost/support';
import { getChars } from '../../../src/rules/characteristics';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const libNames = (s: GameState, p: PlayerId): string[] => s.zones.library[p]!.map((id) => nameOf(s, id));
const bfNames = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => nameOf(s, id)).sort();
const exileNames = (s: GameState): string[] => s.zones.exile.map((id) => nameOf(s, id)).sort();
const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const GROVE = card('Test Grove', 'Basic Land — Forest', '');

describe('"Put target card from a graveyard on your choice of the top or bottom of its owner\'s library." (CR 401.4, 400.3; Not Forgotten)', () => {
  const SPELL = card('Test Forget', 'Sorcery', 'Put target card from a graveyard on your choice of the top or bottom of its owner\'s library. Create a 1/1 white Spirit creature token with flying.', '{0}');
  const defs = [SPELL, BEAR, GROVE];
  const run = (end: 'top' | 'bottom'): { s: GameState; asked: { player: string; prompt: string }[] } => {
    const s0 = scenario([], { p1: { hand: ['Test Forget'] }, p2: { graveyard: ['Test Bear'] }, defs });
    for (const id of s0.zones.library.p2!) delete s0.objects[id];
    s0.zones.library.p2 = [];
    put(s0, 'p2', 'library', 'Test Grove');
    let s = cast(s0, 'Test Forget', { targets: [[obj(find(s0, 'Test Bear', 'graveyard', 'p2'))]] });
    s = passBoth(s);
    const asked: { player: string; prompt: string }[] = [];
    while (s.pending && s.pending.kind === 'chooseOption') {
      asked.push({ player: s.pending.player, prompt: s.pending.prompt ?? '' });
      s = answer(s, { kind: 'chooseOption', ids: [end] });
    }
    return { s, asked };
  };
  it('has no manual part', () => expect(full(SPELL)).toBe(true));
  it('YOU (the caster) choose the end, not the owner: the card goes on top of its OWNER\'s library', () => {
    const { s, asked } = run('top');
    expect(asked.map((a) => a.player)).toEqual(['p1']);
    expect(libNames(s, 'p2')).toEqual(['Test Bear', 'Test Grove']);
    expect(libNames(s, 'p1').includes('Test Bear')).toBe(false);
  });
  it('and on the bottom when you say so; the token is made either way', () => {
    const { s } = run('bottom');
    expect(libNames(s, 'p2')).toEqual(['Test Grove', 'Test Bear']);
    expect(bfNames(s, 'p1').length).toBe(1);
  });
});


describe('"When this creature dies, you may put it on your choice of the top or bottom of its owner\'s library." (CR 401.4, 400.3, 700.4; the same move for the creature itself)', () => {
  const DRAKE = card('Test Drake', 'Creature — Drake', 'When this creature dies, you may put it on your choice of the top or bottom of its owner\'s library.', '{0}', ['1', '1']);
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.', '{0}');
  const defs = [DRAKE, KILL];
  it('has no manual part', () => expect(full(DRAKE)).toBe(true));
  it("the drake that dies goes to its OWNER's library, on the bottom when its controller says so (the creature itself, not a target)", () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Kill'] }, p2: { battlefield: ['Test Drake'] } });
    for (const id of s0.zones.library.p2!) delete s0.objects[id];
    s0.zones.library.p2 = [];
    put(s0, 'p2', 'library', 'Test Kill');
    let s = cast(s0, 'Test Kill', { targets: [[obj(find(s0, 'Test Drake', 'battlefield', 'p2'))]] });
    s = passBoth(s); // the spell resolves, the drake dies and its ability goes on the stack
    s = resolveAll(s, { yes: [true], options: [['bottom']] }); // ... resolves: Bob may, and picks the bottom
    expect(libNames(s, 'p2')).toEqual(['Test Kill', 'Test Drake']);
    expect(s.zones.graveyard.p2!.some((id) => nameOf(s, id) === 'Test Drake')).toBe(false);
  });
  it('negative: declining the "may" leaves the drake in its graveyard', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Kill'] }, p2: { battlefield: ['Test Drake'] } });
    let s = cast(s0, 'Test Kill', { targets: [[obj(find(s0, 'Test Drake', 'battlefield', 'p2'))]] });
    s = resolveAll(passBoth(s), { yes: [false] });
    expect(s.zones.graveyard.p2!.some((id) => nameOf(s, id) === 'Test Drake')).toBe(true);
  });
});
