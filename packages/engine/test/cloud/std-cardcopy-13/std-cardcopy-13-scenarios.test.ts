/**
 * Lane std-cardcopy, round std-cardcopy-13 (carried over from std-cardcopy-4): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 608.2c        "If the exiled card is a land card, repeat this process.": the process runs again for as long as the card it exiled last is a land card
 *                    (std-cardcopy-1's `repeat.again`), the condition checked again after every run; it stops at the first card that is not one, and when
 *                    there is nothing left to exile
 *   CR 608.2d        "exile a permanent card from your graveyard at random": a card of that kind, chosen at random (no player decides), never another kind
 *   CR 707.2, 110.5b "create a tapped token that's a copy of that card": the token copy of the card exiled, tapped
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** The card is parsed and automated without a manual unit (a template's experimental status caps the level; that is not checked here). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Pass priority, answering targets, costs, yes/no and choices, until the stack is empty and p1 has priority again. */
function settle(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; guard < 200 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === 'p1'); guard++) {
    const d = s.pending;
    if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [] });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
  }
  return s;
}
const tokens = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1');
const tokenNames = (s: GameState): string[] => tokens(s).map((id) => getChars(s, id)!.name).sort();

describe('CR 608.2c: "If the exiled card is a land card, repeat this process." (std-cardcopy-1\'s repeat.again)', () => {
  const ENGINE = card('Test Tide Engine', 'Artifact', "{0}: Exile a permanent card from your graveyard at random, then create a tapped token that's a copy of that card. If the exiled card is a land card, repeat this process.");
  const MARSH = card('Test Salt Marsh', 'Land', '{T}: Add {C}.');
  const OX = card('Test Plow Ox', 'Creature — Ox', '', ['3', '3']);
  const IDEA = card('Test Passing Idea', 'Instant', 'You gain 1 life.');
  const DEFS = [ENGINE, MARSH, OX, IDEA];
  const run = (graveyard: string[]): GameState => {
    const s = scenario([], { p1: { battlefield: ['Test Tide Engine'], graveyard }, defs: DEFS });
    return settle(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Tide Engine', 'battlefield', 'p1'), ability: 'p:0:0' }));
  };
  it('is parsed and automated: the process (choose at random, exile, copy) and a repeat of it while the card exiled is a land card', () => {
    expect(automated(ENGINE)).toBe(true);
    const json = JSON.stringify(ENGINE.faces[0]!.abilities);
    expect(json).toContain('"op":"if","cond":{"cond":"matches","object":{"ref":"bound","name":"chosen"},"filter":{"types":["Land"],"isCard":true}}');
    expect(json).toContain('"process":true,"again":true');
    expect(json).not.toContain('"while"');
    expect(json).toContain('"random":true');
  });
  it('lands keep the process going until a card that is not a land is exiled: every card exiled gives a tapped token copy', () => {
    const s = run(['Test Salt Marsh', 'Test Salt Marsh', 'Test Plow Ox']);
    // whatever the random order, the process stops at the Ox: the lands exiled before it are copied, and the Ox too
    const names = tokenNames(s);
    expect(names).toContain('Test Plow Ox');
    expect(names.filter((n) => n !== 'Test Plow Ox').every((n) => n === 'Test Salt Marsh')).toBe(true);
    for (const id of tokens(s)) expect(s.objects[id]!.tapped).toBe(true);
    const exiled = s.zones.exile.map((id) => s.objects[id]!.defId);
    expect(exiled.length).toBe(names.length);
  });
  it('the negative case: the first card is not a land, so the process runs once', () => {
    const s = run(['Test Plow Ox']);
    expect(tokenNames(s)).toEqual(['Test Plow Ox']);
  });
  it('a graveyard of lands only: the loop stops when nothing is left to exile (never runs on the card exiled before)', () => {
    const s = run(['Test Salt Marsh', 'Test Salt Marsh']);
    expect(tokenNames(s)).toEqual(['Test Salt Marsh', 'Test Salt Marsh']);
    expect(s.zones.graveyard['p1']!.length).toBe(0);
  });
  it('"a permanent card": an instant card in the graveyard is never exiled', () => {
    const s = run(['Test Passing Idea']);
    expect(tokens(s).length).toBe(0);
    expect(s.zones.graveyard['p1']!.map((id) => s.objects[id]!.defId)).toEqual(['Test Passing Idea']);
  });
});

describe('CR 707.2, 110.5b: "create a tapped token that\'s a copy of <object>"', () => {
  const PRESS = card('Test Copy Press', 'Artifact', "{0}: Create a tapped token that's a copy of target artifact you control.");
  const ROCK = card('Test Humming Rock', 'Artifact', '{T}: Add {C}.');
  it('is parsed and automated; the token is a tapped copy of the target', () => {
    expect(automated(PRESS)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Copy Press', 'Test Humming Rock'] }, defs: [PRESS, ROCK] });
    const rock = find(s, 'Test Humming Rock', 'battlefield', 'p1');
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Copy Press', 'battlefield', 'p1'), ability: 'p:0:0' });
    for (let g = 0; g < 40 && s.pending?.kind !== 'priority'; g++) {
      if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: rock }] });
      else if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else break;
    }
    s = settle(s);
    expect(tokenNames(s)).toEqual(['Test Humming Rock']);
    for (const id of tokens(s)) expect(s.objects[id]!.tapped).toBe(true);
  });
});
