/**
 * Commander batch, slice cmd4: wordings the render gate (G6) now accepts, each with the engine playing the ability it lets through (synthetic cards compiled by
 * the game's default compiler, invented names and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 701.9a    "Whenever an opponent discards a creature card, ...": what is discarded is a card (render/evt.ts), matched by its card type
 *   CR 400.1     "for each Elf on the battlefield" / "the number of Elves on the battlefield": every such permanent, whoever controls it (render/qty.ts)
 *   CR 208.1     "Draw cards equal to the power of target creature you control.": the target's power as the spell resolves (render/qty.ts)
 *   CR 601.2f    "This spell costs {1} less to cast for each creature your opponents control." (render/stat.ts: a "for each" noun phrase)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
function drive(s0: GameState, targets: { kind: 'object'; id: string }[][] = []): GameState {
  const q = [...targets];
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min ?? 1) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)));
  return s;
}
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;

describe('CR 701.9a: "Whenever an opponent discards a creature card, ..."', () => {
  const WATCH = card('Test Watch', 'Enchantment', 'Whenever an opponent discards a creature card, you gain 2 life.\nWhenever an opponent discards a land card, you gain 5 life.');
  const RACK = card('Test Rack', 'Sorcery', 'Each opponent discards a card.');
  const PUP = card('Test Pup', 'Creature — Dog', '', { pt: ['1', '1'] });
  const DEFS = [WATCH, RACK, PUP];
  it('is understood: the render gate reads the discarded thing as a card', () => expect(noManual(WATCH)).toBe(true));
  it('CR 701.9a: a creature card discarded by the opponent triggers the creature ability only', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Rack'], battlefield: ['Test Watch'] }, p2: { hand: ['Test Pup'] } });
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rack', 'hand', 'p1') })));
    expect(s.zones.graveyard['p2']!.some((id) => s.objects[id]!.defId === 'Test Pup')).toBe(true);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 2);
  });
  it('CR 701.9a: a land card triggers the land ability only', () => {
    const s0 = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Rack'], battlefield: ['Test Watch'] }, p2: { hand: ['Forest'] } });
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rack', 'hand', 'p1') })));
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 5);
  });
});

describe('CR 400.1, 608.2h: "for each Elf on the battlefield" counts the Elves of every player', () => {
  const HYMN = card('Test Hymn', 'Sorcery', 'You gain 1 life for each Elf on the battlefield.');
  const GROW = card('Test Grow', 'Instant', 'Target creature gets +X/+X until end of turn, where X is the number of Elves on the battlefield.');
  const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
  const DEFS = [HYMN, GROW, ELF];
  it('is understood: "on the battlefield" is the count of every such permanent (G6)', () => {
    for (const d of [HYMN, GROW]) expect(noManual(d), d.name).toBe(true);
  });
  it('CR 400.1, 608.2h: the Elves of both players are counted as the spell resolves', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Hymn'], battlefield: ['Test Elf', 'Test Elf'] }, p2: { battlefield: ['Test Elf'] } });
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Hymn', 'hand', 'p1') })));
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 3);
  });
});

describe('CR 208.1, 608.2h: "Draw cards equal to the power of target creature you control."', () => {
  const MAJESTY = card('Test Majesty', 'Sorcery', 'Draw cards equal to the power of target creature you control.');
  const OX = card('Test Ox', 'Creature — Ox', '', { pt: ['3', '4'] });
  it('is understood: the statistic after the target is the target\'s power (G6)', () => expect(noManual(MAJESTY)).toBe(true));
  it('CR 208.1: its controller draws as many cards as the target\'s power', () => {
    const s0 = scenario([], { defs: [MAJESTY, OX], p1: { hand: ['Test Majesty'], battlefield: ['Test Ox'] } });
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Majesty', 'hand', 'p1') }), [[{ kind: 'object', id: find(s0, 'Test Ox', 'battlefield', 'p1') }]]));
    expect(s.zones.hand['p1']!.length).toBe(s0.zones.hand['p1']!.length - 1 + 3);
  });
});

describe('CR 601.2f: "This spell costs {1} less to cast for each creature your opponents control."', () => {
  const PROTECTOR = card('Test Protector', 'Creature — Beast', 'This spell costs {1} less to cast for each creature your opponents control.', { pt: ['5', '5'], cost: '{3}' });
  const PUP = card('Test Pup', 'Creature — Dog', '', { pt: ['1', '1'] });
  it('is understood (G6)', () => expect(noManual(PROTECTOR)).toBe(true));
  it('CR 601.2f: with two creatures an opponent controls it costs {1}: one land pays for it', () => {
    const s0 = scenario(['Forest'], { defs: [PROTECTOR, PUP], p1: { hand: ['Test Protector'], battlefield: ['Forest'] }, p2: { battlefield: ['Test Pup', 'Test Pup'] } });
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Protector', 'hand', 'p1') })));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Protector')).toBe(true);
  });
});
