/**
 * THIRD PASS 6 edh-next-118 (code edhn118): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names, design 6.10).
 * CR cites are from memory (no rules text in a cloud session): unverified.
 *
 *   CR 611.2c, 608.2c, 613.4c   "At the beginning of combat on your turn, choose any number of creatures with different powers. Each of them gets +X/+X and gains vigilance until end of turn, where X is
 *                               this creature's power." (Sigardian Zealot)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { answer, find, pass } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');

const ZEAL = card('Test Zealot', 'Creature — Human', 'At the beginning of combat on your turn, choose any number of creatures with different powers. Each of them gets +X/+X and gains vigilance until end of turn, where X is this creature\'s power.', ['3', '3']);
const A = card('Test Ant', 'Creature — Insect', '', ['1', '1']);
const B = card('Test Boar', 'Creature — Boar', '', ['2', '2']);
const C = card('Test Crab', 'Creature — Crab', '', ['2', '3']);
const defs = [ZEAL, A, B, C];
const game = () => mpScenario({ defs, zones: { p1: { battlefield: ['Test Zealot', 'Test Ant', 'Test Boar', 'Test Crab'] } } });

/**
 * Pass until the trigger asks which creatures. The engine asks one creature at a time (min 0, max 1; the options are the creatures whose power is not yet taken, CR 608.2d):
 * answer each question with the next name of `picks`, then with none. `asked` collects the card names offered at each question.
 */
function combat(picks: string[], asked: string[][] = []): { s: GameState; id: (n: string) => ObjectId } {
  let s = game();
  const id0 = (st: GameState, n: string) => find(st, n, 'battlefield', 'p1');
  const queue = [...picks];
  for (let i = 0; i < 60 && (s.pending?.kind !== 'declareAttackers'); i++) {
    const p = s.pending;
    if (p?.kind === 'chooseObjects') {
      asked.push(p.options.map((o) => s.objects[o]!.defId));
      const n = queue.shift();
      s = answer(s, { kind: 'chooseObjects', ids: n === undefined ? [] : [id0(s, n)] });
    } else s = pass(s);
  }
  return { s, id: (n) => id0(s, n) };
}
describe('CR 611.2c, 608.2c, 613.4c: "choose any number of creatures with different powers. Each of them gets +X/+X and gains vigilance until end of turn, where X is this creature\'s power."', () => {
  it('is full', () => expect(full(ZEAL)).toBe(true));
  it('two creatures of different powers: each gets +3/+3 (the Zealot\'s power) and vigilance; the creature not chosen gets nothing', () => {
    const { s, id } = combat(['Test Ant', 'Test Boar']);
    expect(Number(getChars(s, id('Test Ant'))!.power)).toBe(4);
    expect(Number(getChars(s, id('Test Boar'))!.power)).toBe(5);
    expect(Number(getChars(s, id('Test Boar'))!.toughness)).toBe(5);
    expect(hasKeyword(getChars(s, id('Test Ant'))!, 'vigilance')).toBe(true);
    expect(Number(getChars(s, id('Test Crab'))!.power)).toBe(2);
    expect(hasKeyword(getChars(s, id('Test Crab'))!, 'vigilance')).toBe(false);
    expect(hasKeyword(getChars(s, id('Test Zealot'))!, 'vigilance')).toBe(false);
  });
  it('negative: choosing none changes nothing', () => {
    const { s, id } = combat([]);
    for (const n of ['Test Ant', 'Test Boar', 'Test Crab']) expect(hasKeyword(getChars(s, id(n))!, 'vigilance')).toBe(false);
    expect(Number(getChars(s, id('Test Ant'))!.power)).toBe(1);
  });
  it('negative: after the Boar (power 2) is chosen the Crab (also power 2) is no longer offered, and it gets nothing', () => {
    const asked: string[][] = [];
    const { s, id } = combat(['Test Boar', 'Test Ant'], asked);
    expect(asked[0]).toContain('Test Crab');
    expect(asked[1]).not.toContain('Test Crab');
    expect(asked[1]).not.toContain('Test Boar');
    expect(hasKeyword(getChars(s, id('Test Crab'))!, 'vigilance')).toBe(false);
    expect(hasKeyword(getChars(s, id('Test Boar'))!, 'vigilance')).toBe(true);
  });
});
