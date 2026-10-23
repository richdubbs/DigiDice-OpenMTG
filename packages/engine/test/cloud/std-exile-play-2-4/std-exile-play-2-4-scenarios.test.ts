/**
 * std-exile-play-2-4 (lane std-exile-play-2): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in
 * the cloud checkout).
 *
 *   CR 611.2a, 611.2c, 202.3, 118.9  "Each player exiles the top card of their library. Until end of turn, you may play the card you own exiled this way and each
 *                                    other card exiled this way with lesser mana value than it without paying their mana costs."
 *                                    (eff.sxp24.permit.play.yoursAndLesserMv.free): the set is picked as the effect begins
 *   CR 105.2, 608.2d, 701.20a        "For each of those colors, you may exile a card of that color from among the revealed cards." after "reveal ... until you reveal X
 *                                    nonland cards, where X is the number of colors among permanents you control" (eff.sxp24.forEachColor.mayExileOfThatColor.fromRevealed)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';
import { passUntil } from '../../m4/helpers';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const TRIAD = card('Test Triad', 'Artifact',
  '{T}: Each player exiles the top card of their library. Until end of turn, you may play the card you own exiled this way and each other card exiled this way with lesser mana value than it without paying their mana costs.');
const CUB = card('Test Cub', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
const GIANT = card('Test Giant', 'Creature — Giant', '', ['5', '5'], '{4}{R}');
const TITAN = card('Test Titan', 'Creature — Giant', '', ['5', '5'], '{3}{G}{G}');
const DEFS = [TRIAD, CUB, GIANT, TITAN];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const inExile = (s: GameState, defId: string, owner: string): ObjectId | undefined => s.zones.exile.find((id) => s.objects[id]!.defId === defId && s.objects[id]!.owner === owner);
const casts = (s: GameState, id: ObjectId | undefined) => legalActions(s, 'p1').filter((a) => a.kind === 'cast' && a.object === id);
const plays = (s: GameState, id: ObjectId | undefined) => legalActions(s, 'p1').filter((a) => a.kind === 'playLand' && a.object === id);
const onBattlefield = (s: GameState, defId: string): boolean => s.zones.battlefield.some((id) => s.objects[id]!.defId === defId && s.objects[id]!.controller === 'p1');

function exile(mine: string, theirs: string): GameState {
  let s = scenario(['Plains'], { p1: { battlefield: ['Test Triad'], library: [mine] }, p2: { library: [theirs] }, defs: DEFS });
  const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && /Test Triad/.test(x.label));
  if (!a) throw new Error('no Triad activation');
  s = resolveAll(settle(act(s, a.action)));
  return s;
}

describe('CR 611.2c, 202.3: you may play your exiled card and each other card exiled this way with lesser mana value, without paying their mana costs', () => {
  it('your Giant (5) and the opponent\'s Cub (2, lesser) are both cast free (you control no land)', () => {
    let s = exile('Test Giant', 'Test Cub');
    const giant = inExile(s, 'Test Giant', 'p1');
    const cub = inExile(s, 'Test Cub', 'p2');
    expect(casts(s, giant).length).toBeGreaterThan(0);
    expect(casts(s, cub).length).toBeGreaterThan(0);
    s = resolveAll(settle(act(s, casts(s, cub)[0]!.action)));
    s = resolveAll(settle(act(s, casts(s, giant)[0]!.action)));
    expect(onBattlefield(s, 'Test Cub')).toBe(true);
    expect(onBattlefield(s, 'Test Giant')).toBe(true);
  });
  it('a card of equal mana value is not lesser: the opponent\'s Titan (5) next to your Giant (5) is not offered', () => {
    const s = exile('Test Giant', 'Test Titan');
    expect(casts(s, inExile(s, 'Test Giant', 'p1')).length).toBeGreaterThan(0);
    expect(casts(s, inExile(s, 'Test Titan', 'p2')).length).toBe(0);
  });
  it('your land (mana value 0) is played with a land play; the opponent\'s Cub (2) is not lesser than it', () => {
    const s = exile('Plains', 'Test Cub');
    const land = s.zones.exile.find((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.owner === 'p1');
    expect(plays(s, land).length).toBe(1);
    expect(casts(s, inExile(s, 'Test Cub', 'p2')).length).toBe(0);
  });
  it('CR 611.2a: the permission ends with the turn', () => {
    const s0 = exile('Test Giant', 'Test Cub');
    const giant = inExile(s0, 'Test Giant', 'p1')!;
    let s = advanceTo(s0, 3, 'main1');
    s = passUntil(s, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p1', 'priority for p1 on turn 3');
    expect(casts(s, giant).length).toBe(0);
  });
  it('CR 611.2c: the set is picked as the effect begins; the opponent may not use it', () => {
    const s = exile('Test Giant', 'Test Cub');
    expect(legalActions(s, 'p2').some((a) => a.kind === 'cast' && a.object === inExile(s, 'Test Cub', 'p2'))).toBe(false);
    void find;
  });
});

/** A synthetic card with its colors stated (the shared helper makes colorless ones). */
const colored = (name: string, type: string, text: string, colors: string[], pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
const SEER = card('Test Seer', 'Artifact',
  '{T}: Reveal cards from the top of your library until you reveal X nonland cards, where X is the number of colors among permanents you control. For each of those colors, you may exile a card of that color from among the revealed cards. Then shuffle. You may cast the exiled cards this turn.');
const RED_PUP = colored('Test Red Pup', 'Creature — Dog', '', ['R'], ['1', '1']);
const GREEN_PUP = colored('Test Green Pup', 'Creature — Dog', '', ['G'], ['1', '1']);
const EMBER = colored('Test Ember', 'Sorcery', 'You gain 2 life.', ['R']);
const TIDE = colored('Test Tide', 'Sorcery', 'You gain 3 life.', ['U']);
const MOSS = colored('Test Moss', 'Sorcery', 'You gain 4 life.', ['G']);
const DEFS2 = [SEER, RED_PUP, GREEN_PUP, EMBER, TIDE, MOSS];

describe('the Sanar-shaped synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS2) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 105.2, 608.2d: for each color among your permanents, you may exile a revealed card of that color; then you may cast the exiled cards this turn', () => {
  /** Activate the Seer and answer each color's choice with the first option whose name is in `take` (or none); returns the state and the options offered. */
  function seer(library: string[], take: string[]): { s: GameState; offered: string[][] } {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Seer', 'Test Red Pup', 'Test Green Pup'], library }, defs: DEFS2 });
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && /Test Seer/.test(x.label));
    if (!a) throw new Error('no Seer activation');
    s = act(s, a.action);
    const offered: string[][] = [];
    for (let guard = 0; guard < 40; guard++) {
      const d = s.pending;
      if (d?.kind === 'chooseObjects') {
        const opts = (d as unknown as { options: ObjectId[] }).options;
        offered.push(opts.map((o) => s.objects[o]!.defId));
        const id = opts.find((o) => take.includes(s.objects[o]!.defId));
        s = answer(s, { kind: 'chooseObjects', ids: id === undefined ? [] : [id] });
      } else if (d?.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
      else if (d?.kind === 'priority') break;
      else s = settle(s);
    }
    return { s, offered };
  }
  it('with red and green permanents (X = 2) the reveal stops at the second nonland card; red offers the red card, green the green one; both are exiled and castable', () => {
    const { s, offered } = seer(['Test Ember', 'Plains', 'Test Moss', 'Test Tide'], ['Test Ember', 'Test Moss']);
    expect(offered).toEqual([['Test Ember'], ['Test Moss']]); // CR 105.2: white, blue and black are not among the colors of your permanents
    const ember = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Ember');
    const moss = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Moss');
    expect(ember).toBeDefined();
    expect(moss).toBeDefined();
    expect(casts(s, ember).length).toBeGreaterThan(0);
    expect(casts(s, moss).length).toBeGreaterThan(0);
    expect(s.zones.library['p1']!.some((id) => s.objects[id]!.defId === 'Test Tide')).toBe(true); // never revealed, still in the library
  });
  it('a revealed card of a color you control no permanent of (blue) is never offered; declining a color exiles nothing for it', () => {
    const { s, offered } = seer(['Test Tide', 'Test Ember', 'Test Moss'], ['Test Ember']);
    expect(offered.flat()).not.toContain('Test Tide');
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Moss')).toBe(false);
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Ember')).toBe(true);
  });
  it('CR 611.2a: the exiled cards may be cast this turn only', () => {
    const { s: s0 } = seer(['Test Ember', 'Test Moss'], ['Test Ember']);
    const ember = s0.zones.exile.find((id) => s0.objects[id]!.defId === 'Test Ember')!;
    let s = advanceTo(s0, 3, 'main1');
    s = passUntil(s, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p1', 'priority for p1 on turn 3');
    expect(casts(s, ember).length).toBe(0);
  });
});
